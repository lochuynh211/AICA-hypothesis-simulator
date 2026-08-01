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

  it('every entry names a specific error, not a blanket exclusion', () => {
    for (const [file, reason] of Object.entries(KNOWN_UPSTREAM_ONLY_ERRORS)) {
      expect(reason, `${file} must document which error it is hiding`).toMatch(/TS\d{4}/)
    }
  })
})

describe('filterKnownUpstreamErrors', () => {
  const known = {
    'src/a.ts': 'known bug',
  }

  it('suppresses only diagnostics from files in the allowlist', () => {
    const output = [
      'src/a.ts(1,1): error TS2345: known bug detail.',
      '  continuation line for the known bug.',
      'src/b.ts(2,2): error TS2322: a real, unrelated bug.',
    ].join('\n')

    const { kept, suppressed } = filterKnownUpstreamErrors(output, known)
    expect(suppressed).toHaveLength(1)
    expect(suppressed[0].file).toBe('src/a.ts')
    expect(kept).toHaveLength(1)
    expect(kept[0].file).toBe('src/b.ts')
  })

  it('keeps everything when nothing matches the allowlist', () => {
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
})
