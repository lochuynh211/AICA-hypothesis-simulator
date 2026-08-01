import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { buildData, renderBundleJs } from '../scripts/build-data.mjs'

const REPO_ROOT = resolve(__dirname, '..', '..', '..')

describe('renderBundleJs', () => {
  it('emits a frozen global assignment', () => {
    const js = renderBundleJs({ schema_version: 1, presets: {} })
    expect(js).toContain('window.__AICA_DATA__')
    expect(js).toContain('Object.freeze')
    expect(js.trimEnd().endsWith(')')).toBe(true)
  })

  it('escapes every < so the payload cannot close its own tag', () => {
    // Not just `</script>`: the HTML tokenizer also ends script data on
    // `</script `, `</script/` and `</script>`, so all three must be neutralised.
    for (const evil of ['</script><script>alert(1)</script>', '</script /><script>x</script>', '</script/>']) {
      const js = renderBundleJs({ evil })
      expect(js).not.toMatch(/<\/script/i)
      expect(js).not.toContain('<')
    }
  })

  it('round-trips through JSON.parse of the embedded literal', () => {
    const payload = { schema_version: 1, presets: { a: { preset_id: 'a' } } }
    const js = renderBundleJs(payload)
    const literal = js.slice(js.indexOf('Object.freeze(') + 'Object.freeze('.length, js.lastIndexOf(')'))
    expect(JSON.parse(literal)).toEqual(payload)
  })
})

describe('buildData', () => {
  let out: string
  let pub: string
  let result: ReturnType<typeof buildData>

  beforeAll(() => {
    const tmp = mkdtempSync(join(tmpdir(), 'aica-data-'))
    out = join(tmp, 'data')
    pub = join(tmp, 'public')
    result = buildData({ repoRoot: REPO_ROOT, outDir: out, publicDir: pub })
  })

  it('reports no problems against committed repo data', () => {
    expect(result.problems).toEqual([])
  })

  it('writes the merged payload JSON', () => {
    const p = join(out, 'aica-data.json')
    expect(existsSync(p)).toBe(true)
    const parsed = JSON.parse(readFileSync(p, 'utf8'))
    expect(parsed.schema_version).toBe(1)
    expect(Object.keys(parsed.presets).length).toBeGreaterThan(0)
  })

  it('writes the browser bundle', () => {
    expect(existsSync(join(pub, 'aica-data.js'))).toBe(true)
  })

  it('copies the source tree for inspection', () => {
    expect(existsSync(join(out, 'proposal_contracts', 'presets'))).toBe(true)
    expect(existsSync(join(out, 'combined_contracts', 'test_cases'))).toBe(true)
  })

  it('is idempotent — a second run produces an identical payload', () => {
    const again = buildData({ repoRoot: REPO_ROOT, outDir: out, publicDir: pub })
    expect(JSON.stringify(again.payload)).toBe(JSON.stringify(result.payload))
  })

  it('emitOnly writes just the bundle', () => {
    const tmp2 = mkdtempSync(join(tmpdir(), 'aica-emit-'))
    const r = buildData({ repoRoot: REPO_ROOT, outDir: out, publicDir: pub, emitOnly: tmp2 })
    expect(existsSync(join(tmp2, 'aica-data.js'))).toBe(true)
    expect(r.written).toEqual([join(tmp2, 'aica-data.js')])
    rmSync(tmp2, { recursive: true, force: true })
  })
})

describe('buildData — outDir safety guard', () => {
  // Every fixture here lives under a fresh mkdtempSync temp directory and is
  // cleaned up in a `finally`. Never point a test's outDir at anything inside
  // the real repo — these tests exercise a recursive delete.

  it('throws when outDir equals repoRoot, without deleting anything', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aica-guard-'))
    const marker = join(tmp, 'marker.txt')
    writeFileSync(marker, 'still here', 'utf8')
    try {
      expect(() => buildData({ repoRoot: tmp, outDir: tmp, publicDir: join(tmp, 'public') })).toThrow()
      // Proof of refusal, not a crash after the damage: the marker must survive.
      expect(existsSync(marker)).toBe(true)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('throws when outDir is an ancestor of repoRoot', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aica-guard-'))
    const repo = join(tmp, 'repo')
    mkdirSync(repo, { recursive: true })
    try {
      expect(() => buildData({ repoRoot: repo, outDir: tmp, publicDir: join(tmp, 'public') })).toThrow()
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it("throws when outDir's basename is not 'data'", () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aica-guard-'))
    const repo = join(tmp, 'repo')
    const badOut = join(tmp, 'not-data')
    mkdirSync(repo, { recursive: true })
    try {
      expect(() => buildData({ repoRoot: repo, outDir: badOut, publicDir: join(tmp, 'public') })).toThrow()
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('emitOnly still works with an output directory not named data', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aica-guard-emit-'))
    const emitDir = join(tmp, 'not-data')
    try {
      const r = buildData({
        repoRoot: REPO_ROOT,
        outDir: join(tmp, 'data'),
        publicDir: join(tmp, 'public'),
        emitOnly: emitDir,
      })
      expect(existsSync(join(emitDir, 'aica-data.js'))).toBe(true)
      expect(r.written).toEqual([join(emitDir, 'aica-data.js')])
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
