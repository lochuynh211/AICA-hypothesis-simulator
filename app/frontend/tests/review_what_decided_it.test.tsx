// app/frontend/tests/review_what_decided_it.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import WhatDecidedIt from '../src/components/review/WhatDecidedIt'
import { LanguageProvider } from '../src/state/language'
import type { ReviewOption } from '../src/lib/review/types'

const row = (featureId: string, value: number, w: number, band: string | null = null) => ({
  featureId, value, band, r: 1, w, contribution: value * w,
})

const options: ReviewOption[] = [
  { id: 'rest_required', label: { ja: '休憩の提案', en: 'Rest proposal' }, score: 0.72, clamped: false,
    rows: [row('fatigue', 0.8, 0.3, 'high'), row('monotony', 0.2, 0.1)] },
  { id: 'monotony_prevention', label: { ja: '単調さへの介入', en: 'Monotony intervention' }, score: 0.55, clamped: false,
    rows: [row('monotony', 0.9, 0.4), row('fatigue', 0.1, 0.1)] },
]

// LanguageProvider defaults to 'ja' (i18n global-language architecture).
// This suite asserts literal English phrase/band text ('high', 'how tired the
// driver is'), so — following the same pattern as merged_setup.test.tsx:356
// and merged_center.test.tsx:266 — the wrapper pins the language explicitly
// rather than relying on the default.
const wrap = (ui: React.ReactNode) =>
  render(<LanguageProvider initialLanguage="en">{ui}</LanguageProvider>)
const mount = (extra: Partial<React.ComponentProps<typeof WhatDecidedIt>> = {}) =>
  wrap(
    <WhatDecidedIt
      options={options} leftId="rest_required" rightId="monotony_prevention"
      onChangeLeft={() => {}} onChangeRight={() => {}} thresholdNote={null} {...extra}
    />,
  )

describe('WhatDecidedIt', () => {
  it('displays the shared scale bound — bars are never shown without it', () => {
    mount()
    expect(screen.getByTestId('margin-scale-bound')).toHaveTextContent(/±/)
  })

  it('draws each bar in proportion to the displayed bound', () => {
    mount()
    // The bound being PRINTED proves nothing about the bars. Without this, a
    // regression that hardcodes a width or divides by the wrong denominator
    // passes every other test while the chart silently misrepresents the data —
    // worse than drawing no chart at all.
    //
    // fatigue's left contribution is 0.8 * 0.3 = 0.24 (not 0.30 — checked by
    // running scaleBound/marginRows directly against this fixture rather than
    // hand-deriving it); scaleBound for this fixture's four magnitudes
    // (0.24, 0.01, 0.02, 0.36) is 0.4. The two sides share one physical track
    // split at its center line, so a magnitude equal to the bound fills half
    // the track (50%), not the whole of it: width = (magnitude / bound) * 50
    // = (0.24 / 0.4) * 50 = 30.
    const fill = screen.getByTestId('margin-bar-left-fatigue')
    expect(parseFloat(fill.style.width)).toBeCloseTo(30, 0)
  })

  it('draws one mirrored row per feature across both options', () => {
    mount()
    expect(screen.getAllByTestId('margin-row')).toHaveLength(2)
  })

  it('orders rows by how much they decided the GAP, not by size in the winner', () => {
    mount()
    // fatigue margin = +0.23; monotony margin = −0.34 → monotony decided more of the gap
    const ids = screen.getAllByTestId('margin-feature-id').map((n) => n.textContent)
    expect(ids[0]).toContain('monotony')
  })

  it('marks which side each feature pulls toward, per row', () => {
    mount()
    // Pinned per feature, not just "an arrow appears somewhere": fatigue leans
    // left (+0.23) and monotony leans right (-0.34). Matching /[◀▶]/ across the
    // whole set would pass against a hardcoded arrow on every row.
    expect(screen.getByTestId('margin-lean-fatigue').textContent).toContain('◀')
    expect(screen.getByTestId('margin-lean-monotony').textContent).toContain('▶')
  })

  it('leads each row with the raw value the reviewer already understands', () => {
    mount()
    expect(screen.getByTestId('margin-anchor-fatigue')).toHaveTextContent('high')
  })

  it('shows plain phrasing as the label and the identifier only in support', () => {
    mount()
    expect(screen.getByTestId('margin-row-fatigue')).toHaveTextContent('how tired the driver is')
  })

  it('opens with a verdict sentence naming both sides', () => {
    mount()
    const verdict = screen.getByTestId('verdict-sentence').textContent ?? ''
    expect(verdict.length).toBeGreaterThan(0)
  })

  it('groups contributions into the four domains', () => {
    mount()
    expect(screen.getAllByTestId('domain-group').length).toBeGreaterThan(0)
  })

  it('shows the threshold note under the pickers when one is given', () => {
    mount({ thresholdNote: 'firing threshold 0.70 · clearance +0.010' })
    expect(screen.getByTestId('threshold-note')).toHaveTextContent('0.70')
  })

  it('reports the comparison change', () => {
    const onChangeRight = vi.fn()
    mount({ onChangeRight })
    fireEvent.change(screen.getByTestId('compare-right'), { target: { value: 'rest_required' } })
    expect(onChangeRight).toHaveBeenCalledWith('rest_required')
  })

  it('says shares will not reconcile when clamping bound', () => {
    const clamped = [{ ...options[0], clamped: true }, options[1]]
    mount({ options: clamped })
    expect(screen.getByTestId('clamp-note')).toBeTruthy()
  })

  it('says so instead of drawing bars when there is nothing to compare', () => {
    mount({ options: [], leftId: '', rightId: '' })
    expect(screen.getByTestId('comparison-unavailable')).toBeTruthy()
    expect(screen.queryByTestId('margin-row')).toBeNull()
  })
})
