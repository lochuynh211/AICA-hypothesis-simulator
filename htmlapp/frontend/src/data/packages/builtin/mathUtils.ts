/**
 * Small numeric helpers shared across the `builtin_js_module` TS ports
 * (`./aica_transparent_hybrid_trigger_v1.ts`, `./aica_transparent_service_selector_v1.ts`,
 * ...) — extracted here specifically to avoid a second hand-copy of
 * `neumaierSum` (see its own doc comment for why it must not be reused
 * outside the exact call sites that mirror a real Python `sum()` call).
 */

/**
 * Mirrors CPython 3.12+'s Neumaier-compensated `sum()` for floats.
 *
 * Use this ONLY at a call site that ports a Python line which itself calls
 * the `sum()` builtin over floats — everywhere else, a package's algorithm.py
 * deliberately uses a plain manual accumulator INSTEAD of `sum()` (often
 * specifically to avoid this compensation), and reaching for this helper
 * there would silently reintroduce a divergence rather than fix one. Grep
 * the target algorithm.py for `sum(` and match call sites 1:1 — do not use
 * this speculatively.
 *
 * First identified porting `aica_transparent_hybrid_trigger_v1`
 * (`category_scores`'s `"clamped": sum(r["contribution"] for r in rest_rows)
 * > rest_required_score`, algorithm.py:368) — verified empirically to matter
 * there, not just theoretically: at tick[3] of that package's golden, the 8
 * `rest_rows` contributions' plain left-to-right total is a float ULP BELOW
 * `rest_required_score` (`clamped` would be `false`), while CPython's actual
 * `sum()` compensates that rounding error and lands a ULP ABOVE it
 * (`clamped` is `true`).
 *
 * Confirmed relevant again porting `aica_transparent_service_selector_v1`:
 * both `_normalize_siblings`'s `sum(float(v) for v in shares.values())` and
 * `compute_dominance`'s `w_d = sum(e["effective_weight"] for e in
 * weights.values() if ...)` diverge from a naive left-to-right accumulator
 * for the package's own default `hierarchy_weights` (verified in a
 * python3.12 REPL — e.g. `compute_dominance`'s `w_d` under the
 * `route_music` purpose: compensated `sum()` = 0.6949152542372882, naive
 * left-to-right = 0.6949152542372881).
 */
export function neumaierSum(values: number[]): number {
  let total = 0.0
  let c = 0.0
  for (const v of values) {
    const t = total + v
    if (Math.abs(total) >= Math.abs(v)) {
      c += (total - t) + v
    } else {
      c += (v - t) + total
    }
    total = t
  }
  return total + c
}

/**
 * Decompose a finite double into its EXACT value as `numerator / denominator`
 * (both non-negative BigInts) plus a sign — i.e. the double's true binary
 * value, not its shortest round-trip decimal. Used by `pyFixed()` to detect
 * an EXACT decimal tie the way Python's float formatter does.
 */
function exactFraction(x: number): { negative: boolean; numerator: bigint; denominator: bigint } {
  const buf = new ArrayBuffer(8)
  const dv = new DataView(buf)
  dv.setFloat64(0, x)
  const hi = dv.getUint32(0)
  const lo = dv.getUint32(4)
  const negative = hi >>> 31 === 1
  const expBits = (hi >>> 20) & 0x7ff
  const mantissaHigh = hi & 0xfffff
  let exponent: number
  let mantissa: bigint
  if (expBits === 0) {
    // Subnormal: no implicit leading 1 bit.
    exponent = -1074
    mantissa = (BigInt(mantissaHigh) << 32n) | BigInt(lo >>> 0)
  } else {
    exponent = expBits - 1075
    mantissa = ((BigInt(mantissaHigh) << 32n) | BigInt(lo >>> 0)) | (1n << 52n)
  }
  if (exponent >= 0) {
    return { negative, numerator: mantissa << BigInt(exponent), denominator: 1n }
  }
  return { negative, numerator: mantissa, denominator: 1n << BigInt(-exponent) }
}

/**
 * Mirrors Python's `f"{x:.{n}f}"` fixed-decimal formatting EXACTLY,
 * including its ROUND-HALF-TO-EVEN tie-breaking (divergence hazard #1,
 * "Python `round()` is banker's rounding" — the SAME underlying rounding
 * algorithm also governs `:.Nf` format specs, not just the `round()`
 * builtin). `Number.prototype.toFixed` is NOT a substitute: the
 * ECMAScript spec has it round ties AWAY from zero (picks the larger
 * magnitude of the two equally-close candidates), which is a REAL,
 * empirically-confirmed divergence at any double whose exact binary value
 * lands precisely on a decimal half-way point at the target precision —
 * e.g. `(0.65625).toFixed(4)` -> `"0.6563"`, but Python's `f"{0.65625:.4f}"`
 * -> `"0.6562"` (round to the EVEN last digit, 2, not up to 3). Verified via
 * a 4000-sample stress comparison against a live `python3.12` process (2
 * exact-tie mismatches out of 4000 uniform-random + boundary-constructed
 * doubles — `toFixed` is correct on every NON-tie case, wrong only exactly
 * at a tie); this implementation reproduces the exact-binary-value tie test
 * via BigInt rational arithmetic (`exactFraction`), so it is correct for
 * every double, not just the sampled ones.
 *
 * `aica_transparent_service_selector_v1`'s `_build_rationale` is the first
 * call site needing this (`f"...{c['contribution']:.4f}..."`,
 * algorithm.py:708-713) — a real, character-exact-compared explanation
 * string, so getting this wrong would be a silent, hard-to-notice
 * divergence rather than a crash.
 */
export function pyFixed(x: number, n: number): string {
  if (Number.isNaN(x)) return 'nan'
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf'
  const negative = x < 0 || Object.is(x, -0)
  if (x === 0) {
    return (negative ? '-' : '') + '0.' + '0'.repeat(n)
  }
  const { numerator, denominator } = exactFraction(Math.abs(x))
  const scale = 10n ** BigInt(n)
  const scaledNumerator = numerator * scale
  let quotient = scaledNumerator / denominator
  const remainder = scaledNumerator % denominator
  const twiceRemainder = remainder * 2n
  if (twiceRemainder > denominator || (twiceRemainder === denominator && quotient % 2n === 1n)) {
    quotient += 1n
  }
  let digits = quotient.toString()
  while (digits.length <= n) digits = `0${digits}`
  const intPart = digits.slice(0, digits.length - n)
  const fracPart = digits.slice(digits.length - n)
  return (negative ? '-' : '') + intPart + (n > 0 ? `.${fracPart}` : '')
}
