import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MAX,
  APP_MAX,
  DATA_MAX,
  sumDir,
  measureMulti,
  measureSingle,
  evaluateBudget,
} from '../scripts/check-size.mjs'

/** Write a file of an exact byte size — the fixture only cares about size. */
function writeBytes(path: string, size: number) {
  writeFileSync(path, Buffer.alloc(size, 'a'))
}

describe('budget arithmetic (the thing task 2 exists to resolve)', () => {
  it('APP_MAX + DATA_MAX intentionally exceeds MAX — confirmed, not assumed', () => {
    expect(APP_MAX + DATA_MAX).toBeGreaterThan(MAX)
    expect(APP_MAX + DATA_MAX - MAX).toBe(512 * 1024) // exactly 0.5 MB of intentional slack
  })

  it('MAX is still asserted even when both sub-budgets independently pass', () => {
    // app 1.4 MB (< 1.5 MB budget), data 1.9 MB (< 2 MB budget), sum 3.3 MB > MAX 3 MB.
    // If MAX were only checked as a consequence of the sub-budgets, this would
    // wrongly pass. It must not.
    const appBytes = 1.4 * 1024 * 1024
    const dataBytes = 1.9 * 1024 * 1024
    const totalBytes = appBytes + dataBytes
    const { ok, errors } = evaluateBudget({ appBytes, dataBytes, totalBytes })
    expect(appBytes).toBeLessThan(APP_MAX)
    expect(dataBytes).toBeLessThan(DATA_MAX)
    expect(totalBytes).toBeGreaterThan(MAX)
    expect(ok).toBe(false)
    expect(errors).toEqual(['over the 3 MB hard cap.'])
  })
})

describe('evaluateBudget failure paths — each budget observed to actually fail', () => {
  const under = { appBytes: 1024, dataBytes: 1024, totalBytes: 2048 }

  it('passes when everything is under budget', () => {
    const { ok, errors } = evaluateBudget(under)
    expect(ok).toBe(true)
    expect(errors).toEqual([])
  })

  it('fails when app alone exceeds APP_MAX', () => {
    const { ok, errors } = evaluateBudget({ ...under, appBytes: APP_MAX + 1, totalBytes: APP_MAX + 1 + under.dataBytes })
    expect(ok).toBe(false)
    expect(errors).toContain('app bundle over budget.')
    expect(errors).not.toContain('data bundle over budget.')
  })

  it('fails when data alone exceeds DATA_MAX', () => {
    const { ok, errors } = evaluateBudget({ ...under, dataBytes: DATA_MAX + 1, totalBytes: DATA_MAX + 1 + under.appBytes })
    expect(ok).toBe(false)
    expect(errors).toContain('data bundle over budget.')
    expect(errors).not.toContain('app bundle over budget.')
  })

  it('fails when total alone exceeds MAX, even with app and data individually tiny', () => {
    const { ok, errors } = evaluateBudget({ appBytes: 1024, dataBytes: 1024, totalBytes: MAX + 1 })
    expect(ok).toBe(false)
    expect(errors).toEqual(['over the 3 MB hard cap.'])
  })

  it('reports all three failures at once when everything is over', () => {
    const { ok, errors } = evaluateBudget({
      appBytes: APP_MAX + 1,
      dataBytes: DATA_MAX + 1,
      totalBytes: MAX + 1,
    })
    expect(ok).toBe(false)
    expect(errors).toHaveLength(3)
  })

  it('exactly at each ceiling passes (budgets are inclusive), checked one at a time', () => {
    // APP_MAX + DATA_MAX together exceed MAX by design (see the arithmetic
    // describe block above), so ceilings are asserted one at a time here,
    // each paired with a total that stays under MAX.
    expect(evaluateBudget({ appBytes: APP_MAX, dataBytes: 1024, totalBytes: APP_MAX + 1024 }).ok).toBe(true)
    expect(evaluateBudget({ appBytes: 1024, dataBytes: DATA_MAX, totalBytes: DATA_MAX + 1024 }).ok).toBe(true)
    expect(evaluateBudget({ appBytes: 1024, dataBytes: 1024, totalBytes: MAX }).ok).toBe(true)
  })
})

describe('sumDir', () => {
  let dir: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'check-size-sumdir-'))
    writeBytes(join(dir, 'a.txt'), 100)
    mkdirSync(join(dir, 'nested'))
    writeBytes(join(dir, 'nested', 'b.txt'), 250)
    mkdirSync(join(dir, 'nested', 'deeper'))
    writeBytes(join(dir, 'nested', 'deeper', 'c.txt'), 7)
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('sums file sizes recursively through nested directories', () => {
    expect(sumDir(dir)).toBe(100 + 250 + 7)
  })
})

describe('measureMulti — dist/ in full is the deliverable', () => {
  let dir: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'check-size-multi-'))
    writeBytes(join(dir, 'index.html'), 500)
    writeBytes(join(dir, 'app.js'), 1500)
    writeBytes(join(dir, 'aica-data.js'), 300)
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('reads dist/aica-data.js directly and derives app as the remainder', () => {
    const { appBytes, dataBytes, totalBytes } = measureMulti(dir)
    expect(totalBytes).toBe(500 + 1500 + 300)
    expect(dataBytes).toBe(300)
    expect(appBytes).toBe(500 + 1500)
  })

  it('treats a missing aica-data.js as zero data bytes, not a crash', () => {
    const noData = mkdtempSync(join(tmpdir(), 'check-size-multi-nodata-'))
    try {
      writeBytes(join(noData, 'index.html'), 42)
      const { appBytes, dataBytes, totalBytes } = measureMulti(noData)
      expect(dataBytes).toBe(0)
      expect(appBytes).toBe(42)
      expect(totalBytes).toBe(42)
    } finally {
      rmSync(noData, { recursive: true, force: true })
    }
  })
})

describe('measureSingle — index.html plus every sibling chunk in dist/', () => {
  let dir: string
  let dataSource: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'check-size-single-dist-'))
    const dataDir = mkdtempSync(join(tmpdir(), 'check-size-single-public-'))
    writeBytes(join(dir, 'index.html'), 1_800_000)
    // The sibling worker chunk vite/rollup cannot inline — this is exactly
    // the 298,587 B file the old --single path never looked at.
    writeBytes(join(dir, 'backend.worker-abc123.js'), 298_587)
    dataSource = join(dataDir, 'aica-data.js')
    writeBytes(dataSource, 1_001_764)
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('sums index.html AND the sibling chunk into totalBytes — the bug this task fixes', () => {
    const { totalBytes } = measureSingle(dir, dataSource)
    expect(totalBytes).toBe(1_800_000 + 298_587)
    // The regression this guards: measuring index.html alone would report
    // 1,800,000 and silently miss the worker chunk entirely.
    expect(totalBytes).not.toBe(1_800_000)
  })

  it('derives dataBytes from the external data source, not from anything inside dist/', () => {
    const { dataBytes } = measureSingle(dir, dataSource)
    expect(dataBytes).toBe(1_001_764)
  })

  it('derives appBytes as total minus data — includes the worker chunk in app, not data', () => {
    const { appBytes, totalBytes, dataBytes } = measureSingle(dir, dataSource)
    expect(appBytes).toBe(totalBytes - dataBytes)
    expect(appBytes).toBe(1_800_000 + 298_587 - 1_001_764)
  })

  it('throws — refuses to guess — when the data source file is missing', () => {
    const missing = join(dir, 'does-not-exist.js')
    expect(() => measureSingle(dir, missing)).toThrow(/not found/)
  })

  it('a bloated worker chunk alone is enough to fail the hard cap, and evaluateBudget catches it', () => {
    const bloated = mkdtempSync(join(tmpdir(), 'check-size-single-bloated-'))
    try {
      // index.html well under budget on its own, but a worker chunk pushed
      // past MAX must still fail — this is exactly the scenario the old
      // index.html-only gate would have shipped without a warning.
      writeBytes(join(bloated, 'index.html'), 1_000_000)
      writeBytes(join(bloated, 'backend.worker-bloated.js'), MAX)
      const measurement = measureSingle(bloated, dataSource)
      expect(measurement.totalBytes).toBeGreaterThan(MAX)
      const { ok, errors } = evaluateBudget(measurement)
      expect(ok).toBe(false)
      expect(errors).toContain('over the 3 MB hard cap.')
    } finally {
      rmSync(bloated, { recursive: true, force: true })
    }
  })
})

describe('regression: the real single-file deliverable\'s known-good shape stays under budget', () => {
  it('the verified baseline figures (index.html 1,872,516 B + worker 298,587 B, data 1,001,764 B) pass', () => {
    const measurement = { appBytes: 1_169_339, dataBytes: 1_001_764, totalBytes: 2_171_103 }
    expect(measurement.totalBytes).toBe(1_872_516 + 298_587)
    const { ok } = evaluateBudget(measurement)
    expect(ok).toBe(true)
  })
})
