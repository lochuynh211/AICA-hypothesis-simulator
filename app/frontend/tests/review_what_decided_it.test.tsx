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
      onChangeLeft={() => {}} onChangeRight={() => {}} {...extra}
    />,
  )

describe('WhatDecidedIt', () => {
  it('drops the scale-bound line (support info the reviewer did not want)', () => {
    // The bars are still scaled by the bound — only the printed line is gone.
    mount()
    expect(screen.queryByTestId('margin-scale-bound')).toBeNull()
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

  it('orders rows by A’s own contribution, high → low', () => {
    // A (rest_required): fatigue 0.8*0.3 = 0.24, monotony 0.2*0.1 = 0.02.
    // Ordering by the GAP instead would put monotony first (margin −0.34), so
    // this fixture tells the two rules apart.
    mount()
    const order = screen.getAllByTestId('margin-row').map(
      (n) => n.querySelector('[data-testid^="margin-row-"]')!.getAttribute('data-testid'),
    )
    expect(order).toEqual(['margin-row-fatigue', 'margin-row-monotony'])
  })

  it('drops features that contributed to neither side', () => {
    const withDead: ReviewOption[] = [
      { ...options[0], rows: [...options[0].rows, row('weather_risk', 0, 0)] },
      { ...options[1], rows: [...options[1].rows, row('weather_risk', 0, 0)] },
    ]
    mount({ options: withDead })
    // A row that is zero on BOTH sides says nothing and pushes real rows down.
    expect(screen.queryByTestId('margin-row-weather_risk')).toBeNull()
    expect(screen.getByTestId('margin-row-fatigue')).toBeTruthy()
  })

  it('marks which side each feature pulls toward, per row', () => {
    mount()
    // Pinned per feature, not just "an arrow appears somewhere": fatigue leans
    // left (+0.23) and monotony leans right (-0.34). Matching /[◀▶]/ across the
    // whole set would pass against a hardcoded arrow on every row.
    expect(screen.getByTestId('margin-lean-fatigue').textContent).toContain('◀')
    expect(screen.getByTestId('margin-lean-monotony').textContent).toContain('▶')
  })

  it('shows the value alone — no strength word', () => {
    mount()
    const anchor = screen.getByTestId('margin-anchor-fatigue')
    // fatigue is authored 0-100 and recorded /100, so 0.8 reads back as 80/100.
    expect(anchor).toHaveTextContent('80/100')
    expect(anchor.textContent).not.toMatch(/high|低|高/)
  })

  it('shows a plain value for features that are not 0-100 signals', () => {
    mount()
    // monotony is a derived score: shown as-is, trailing zeros trimmed.
    expect(screen.getByTestId('margin-anchor-monotony')).toHaveTextContent('0.2')
  })

  it('labels rows with the field NAME and never the raw variable id', () => {
    mount()
    const row = screen.getByTestId('margin-row-fatigue')
    expect(row).toHaveTextContent('Fatigue')
    // Neither the raw id nor the old prose fragment.
    expect(row.textContent).not.toContain('fatigue')
    expect(row.textContent).not.toContain('how tired the driver is')
    expect(screen.queryAllByTestId('margin-feature-id')).toHaveLength(0)
  })

  it('drops the verdict sentence (support info the reviewer did not want)', () => {
    mount()
    expect(screen.queryByTestId('verdict-sentence')).toBeNull()
  })

  it('does NOT show a cross-stage domain-group split', () => {
    // Removed on owner review: the same group names do not mean the same thing
    // for a trigger, a service and a content item, so one shared percentage
    // split invited a comparison the numbers do not support.
    mount()
    expect(screen.queryAllByTestId('domain-group')).toHaveLength(0)
  })

  it('shows no firing-threshold note', () => {
    mount()
    expect(screen.queryByTestId('threshold-note')).toBeNull()
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
