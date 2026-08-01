import { describe, it, expect } from 'vitest'
import { KNOWN_UPSTREAM_ONLY_ERRORS, filterKnownUpstreamErrors } from '../scripts/typecheck.mjs'

describe('typecheck upstream-only error allowlist', () => {
  it('names exactly the 4 files with unfixable upstream errors — no more, no less', () => {
    // TypeScript's tsconfig `exclude` cannot suppress these (see
    // scripts/typecheck.mjs header): all four are imported by other files
    // already in the widened gate, so `exclude` never applies to them. This
    // allowlist is the actual enforcement point — if it quietly grows, the
    // widened gate silently loses coverage without anyone noticing.
    expect(Object.keys(KNOWN_UPSTREAM_ONLY_ERRORS).sort()).toEqual(
      [
        'src/components/context/ScenarioBeats.tsx',
        'src/components/map/MapSurface.tsx',
        'src/components/runs/RunLogViewer.tsx',
        'src/components/trace/DecisionTracePanel.tsx',
      ].sort(),
    )
  })

  it('every entry documents at least one specific TS error code, not a blanket file exclusion', () => {
    // A file-only allowlist would hide EVERY diagnostic in that file, not
    // just the one named error — a future upstream regression landing in
    // one of these four (e.g. via `npm run sync`) would then report green.
    // Matching must be (file, code); an entry with no codes can't do that.
    for (const [file, entry] of Object.entries(KNOWN_UPSTREAM_ONLY_ERRORS)) {
      expect(Array.isArray(entry.codes), `${file} must declare a codes array`).toBe(true)
      expect(entry.codes.length, `${file} must name at least one TS code`).toBeGreaterThan(0)
      for (const code of entry.codes) {
        expect(code, `${file}'s code ${code} must look like TSxxxx`).toMatch(/^TS\d{4,5}$/)
      }
      expect(entry.reason, `${file} must document which error it is hiding`).toMatch(/TS\d{4,5}/)
    }
  })
})

describe('filterKnownUpstreamErrors', () => {
  const known = {
    'src/a.ts': { codes: ['TS2345'], reason: 'known bug' },
  }

  it('suppresses only diagnostics matching BOTH the file and a listed code', () => {
    const output = [
      'src/a.ts(1,1): error TS2345: known bug detail.',
      '  continuation line for the known bug.',
      'src/b.ts(2,2): error TS2322: a real, unrelated bug.',
    ].join('\n')

    const { kept, suppressed } = filterKnownUpstreamErrors(output, known)
    expect(suppressed).toHaveLength(1)
    expect(suppressed[0].file).toBe('src/a.ts')
    expect(suppressed[0].code).toBe('TS2345')
    expect(kept).toHaveLength(1)
    expect(kept[0].file).toBe('src/b.ts')
  })

  it('does NOT suppress a different error code in an allowlisted file — this is the whole point', () => {
    // Regression guard: an earlier version of the filter matched by file
    // path alone, so ANY diagnostic in an allowlisted file was hidden. That
    // silently swallowed a genuinely new bug in the same file (proved by
    // injecting `const x: number = 'string'` into MapSurface.tsx: raw tsc
    // reported it as TS2322/TS6133, but the file-only filter still exited
    // 0). This test fails if that regression is reintroduced.
    const output = 'src/a.ts(5,5): error TS9999: a brand-new, different kind of bug.'
    const { kept, suppressed } = filterKnownUpstreamErrors(output, known)
    expect(suppressed).toHaveLength(0)
    expect(kept).toHaveLength(1)
    expect(kept[0].code).toBe('TS9999')
  })

  it('keeps everything when the file is not in the allowlist at all', () => {
    const output = 'src/c.ts(3,3): error TS9999: something else entirely.'
    const { kept, suppressed } = filterKnownUpstreamErrors(output, known)
    expect(suppressed).toHaveLength(0)
    expect(kept).toHaveLength(1)
  })

  it('suppresses everything when tsc reports no other errors', () => {
    const output = 'src/a.ts(1,1): error TS2345: known bug detail.'
    const { kept, suppressed } = filterKnownUpstreamErrors(output, known)
    expect(suppressed).toHaveLength(1)
    expect(kept).toHaveLength(0)
  })

  it('handles a file with more than one legitimately-known code', () => {
    const multi = {
      'src/multi.ts': { codes: ['TS2345', 'TS2352'], reason: 'two distinct known bugs' },
    }
    const output = [
      'src/multi.ts(1,1): error TS2345: first known bug.',
      'src/multi.ts(2,2): error TS2352: second known bug.',
      'src/multi.ts(3,3): error TS1111: NOT a known bug.',
    ].join('\n')
    const { kept, suppressed } = filterKnownUpstreamErrors(output, multi)
    expect(suppressed).toHaveLength(2)
    expect(kept).toHaveLength(1)
    expect(kept[0].code).toBe('TS1111')
  })
})
