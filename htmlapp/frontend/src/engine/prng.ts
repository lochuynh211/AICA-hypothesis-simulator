/**
 * Seeded deterministic PRNG — bit-parity port of `app/api/aica_api/services/prng.py`.
 *
 * Feature 009 (signal-tier redesign) introduced the ONE stochastic signal in the
 * whole simulator: the seeded-Poisson `anomaly_rate` (see ./behavior/anomaly_signal.ts).
 * All its randomness comes from this module, keyed by `(run_seed, tick, channel)`
 * with `run_seed` frozen in the run config — no global RNG, no `Math.random`.
 *
 * Python does:
 *   _subseed(run_seed, tick, channel) = int.from_bytes(
 *       sha256(f"{run_seed}:{tick}:{channel}").digest()[-8:], "big")
 *   seeded_uniform(...) = random.Random(_subseed(...)).random()
 *
 * `random.Random(int).random()` is CPython's Mersenne-Twister: the integer seed
 * is fed through `init_by_array` (seeded from the int's little-endian 32-bit
 * words), and `.random()` is `genrand_res53()` (53-bit, two 32-bit draws). This
 * file replicates ALL of that exactly — a generic MT/xorshift would NOT match.
 *
 * A small synchronous SHA-256 is bundled so the whole path stays synchronous in
 * both the browser tick loop and the vitest parity harness (Web Crypto's
 * `subtle.digest` is async and cannot be awaited mid-tick).
 *
 * Verified byte-for-byte against __fixtures__/parity/prng.json.
 */

// ---------------------------------------------------------------------------
// SHA-256 (synchronous, minimal) — returns a 32-byte digest.
// ---------------------------------------------------------------------------

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n))
}

/** SHA-256 of a byte array → 32-byte Uint8Array. */
export function sha256(bytes: Uint8Array): Uint8Array {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const bitLen = bytes.length * 8
  // Pad: append 0x80, then zeros, then 64-bit big-endian bit length.
  const withOne = bytes.length + 1
  const padded = new Uint8Array(Math.ceil((withOne + 8) / 64) * 64)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  // 64-bit length, big-endian (high 32 bits are 0 for our small inputs).
  const dv = new DataView(padded.buffer)
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000))
  dv.setUint32(padded.length - 4, bitLen >>> 0)

  const w = new Uint32Array(64)
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0
    }
    let [a, b, c, d, e, f, g, hh] = h
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + S1 + ch + K256[i] + w[i]) | 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) | 0
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0
  }
  const out = new Uint8Array(32)
  const odv = new DataView(out.buffer)
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, h[i] >>> 0)
  return out
}

// ---------------------------------------------------------------------------
// CPython-compatible MT19937 (Mersenne Twister) seeded via init_by_array.
// ---------------------------------------------------------------------------

const N = 624
const M = 397
const MATRIX_A = 0x9908b0df
const UPPER_MASK = 0x80000000
const LOWER_MASK = 0x7fffffff

class MT19937 {
  private mt = new Uint32Array(N)
  private mti = N + 1

  private initGenrand(s: number): void {
    this.mt[0] = s >>> 0
    for (let i = 1; i < N; i++) {
      const prev = this.mt[i - 1] ^ (this.mt[i - 1] >>> 30)
      // 1812433253 * prev + i, in 32-bit — use the standard hi/lo trick.
      const hi = (prev >>> 16) * 1812433253
      const lo = (prev & 0xffff) * 1812433253
      this.mt[i] = (((hi << 16) >>> 0) + lo + i) >>> 0
    }
    this.mti = N
  }

  /** CPython init_by_array(init_key). */
  initByArray(key: Uint32Array): void {
    this.initGenrand(19650218)
    let i = 1
    let j = 0
    let k = Math.max(N, key.length)
    for (; k; k--) {
      const prev = this.mt[i - 1] ^ (this.mt[i - 1] >>> 30)
      // mt[i] = (mt[i] ^ (prev * 1664525)) + key[j] + j
      const m = mul32(prev, 1664525)
      this.mt[i] = (((this.mt[i] ^ m) >>> 0) + key[j] + j) >>> 0
      i++; j++
      if (i >= N) { this.mt[0] = this.mt[N - 1]; i = 1 }
      if (j >= key.length) j = 0
    }
    for (k = N - 1; k; k--) {
      const prev = this.mt[i - 1] ^ (this.mt[i - 1] >>> 30)
      const m = mul32(prev, 1566083941)
      this.mt[i] = (((this.mt[i] ^ m) >>> 0) - i) >>> 0
      i++
      if (i >= N) { this.mt[0] = this.mt[N - 1]; i = 1 }
    }
    this.mt[0] = 0x80000000
  }

  genrandUint32(): number {
    let y: number
    if (this.mti >= N) {
      let kk: number
      for (kk = 0; kk < N - M; kk++) {
        y = ((this.mt[kk] & UPPER_MASK) | (this.mt[kk + 1] & LOWER_MASK)) >>> 0
        this.mt[kk] = (this.mt[kk + M] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0)) >>> 0
      }
      for (; kk < N - 1; kk++) {
        y = ((this.mt[kk] & UPPER_MASK) | (this.mt[kk + 1] & LOWER_MASK)) >>> 0
        this.mt[kk] = (this.mt[kk + (M - N)] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0)) >>> 0
      }
      y = ((this.mt[N - 1] & UPPER_MASK) | (this.mt[0] & LOWER_MASK)) >>> 0
      this.mt[N - 1] = (this.mt[M - 1] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0)) >>> 0
      this.mti = 0
    }
    y = this.mt[this.mti++]
    y ^= y >>> 11
    y = (y ^ ((y << 7) & 0x9d2c5680)) >>> 0
    y = (y ^ ((y << 15) & 0xefc60000)) >>> 0
    y ^= y >>> 18
    return y >>> 0
  }

  /** CPython random_random: genrand_res53 → float in [0, 1). */
  random(): number {
    const a = this.genrandUint32() >>> 5 // 27 bits
    const b = this.genrandUint32() >>> 6 // 26 bits
    return (a * 67108864.0 + b) * (1.0 / 9007199254740992.0)
  }
}

/** 32-bit unsigned multiply (a * b mod 2^32) without precision loss. */
function mul32(a: number, b: number): number {
  const ah = (a >>> 16) & 0xffff
  const al = a & 0xffff
  return (((ah * b) << 16) + al * b) >>> 0
}

// ---------------------------------------------------------------------------
// Public API — mirrors prng.py
// ---------------------------------------------------------------------------

const UTF8 = new TextEncoder()

/** _subseed: last 8 bytes of sha256("run_seed:tick:channel") as unsigned 64-bit big-endian. */
export function subseed(runSeed: number, tick: number, channel: string): bigint {
  const canonical = `${runSeed}:${tick}:${channel}`
  const digest = sha256(UTF8.encode(canonical))
  let v = 0n
  for (let i = 24; i < 32; i++) v = (v << 8n) | BigInt(digest[i])
  return v
}

/** Little-endian 32-bit word array of a non-negative BigInt (CPython seed key). */
function seedKey(n: bigint): Uint32Array {
  if (n === 0n) return new Uint32Array([0])
  const words: number[] = []
  let x = n
  while (x > 0n) {
    words.push(Number(x & 0xffffffffn))
    x >>= 32n
  }
  return new Uint32Array(words)
}

/** seeded_uniform: random.Random(_subseed(...)).random(). */
export function seededUniform(runSeed: number, tick: number, channel: string): number {
  const mt = new MT19937()
  mt.initByArray(seedKey(subseed(runSeed, tick, channel)))
  return mt.random()
}

/** mulberry32 — retained for any non-parity infra needs (unused by the engine). */
export function makePrng(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
