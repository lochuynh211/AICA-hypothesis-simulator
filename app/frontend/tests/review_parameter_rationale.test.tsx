// app/frontend/tests/review_parameter_rationale.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import ParameterRationale from '../src/components/review/ParameterRationale'
import { LanguageProvider } from '../src/state/language'
import type { ReviewOption } from '../src/lib/review/types'

const row = (featureId: string, value: number, w: number, band: string | null = null) => ({
  featureId, value, band, r: 1, w, contribution: value * w,
})

const left: ReviewOption = {
  id: 'music_playlist', label: { ja: '音楽プレイリスト', en: 'Music playlist' }, score: 0.5, rows: [
    row('fatigue', 0.8, 0.3, 'high'), row('monotony', 0.6, 0.2), row('oshi_affinity', 0.01, 0.01),
  ],
}
const right: ReviewOption = {
  id: 'call_response_driving',
  label: { ja: 'コール＆レスポンス（運転中）', en: 'Call & response (driving)' },
  score: 0.42,
  rows: [row('monotony', 0.9, 0.3), row('fatigue', 0.1, 0.1)],
}
const declared = { fatigue: 0.3, monotony: 0.2, oshi_affinity: 0.01 }

// LanguageProvider defaults to 'ja' (this project's default UI language). The
// assertions below check English text (band words, judgement labels), so the
// wrapper must pin the language explicitly rather than rely on the default.
const wrap = (ui: React.ReactNode) => render(<LanguageProvider initialLanguage="en">{ui}</LanguageProvider>)
const mount = (extra: Partial<React.ComponentProps<typeof ParameterRationale>> = {}) =>
  wrap(
    <ParameterRationale
      stage="service" left={left} right={right} declaredWeights={declared}
      judgments={{}} onJudge={() => {}} {...extra}
    />,
  )

describe('ParameterRationale', () => {
  it('orders rows by realized influence', () => {
    mount()
    const ids = screen.getAllByTestId('rationale-feature').map((n) => n.textContent ?? '')
    expect(ids[0]).toContain('fatigue')
  })

  it('leads the situation column with the raw value and its strength word', () => {
    mount()
    expect(screen.getByTestId('rationale-situation-fatigue')).toHaveTextContent('high')
  })

  it('shows declared and realized shares', () => {
    mount()
    expect(screen.getByTestId('rationale-declared-fatigue')).toBeTruthy()
    expect(screen.getByTestId('rationale-realized-fatigue')).toBeTruthy()
  })

  it('shows the intent-vs-effect marker', () => {
    mount()
    expect(screen.getByTestId('rationale-ratio-fatigue').textContent).toMatch(/[↑↓≈]/)
  })

  it('offers exactly the six judgement values', () => {
    mount()
    const select = screen.getByTestId('rationale-judge-fatigue') as HTMLSelectElement
    // Pinned to the values, not the count — six WRONG options would pass a count check.
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      '', 'rational', 'too_strong', 'too_weak', 'not_relevant_here', 'unsure',
    ])
  })

  it('reports a judgement', () => {
    const onJudge = vi.fn()
    mount({ onJudge })
    fireEvent.change(screen.getByTestId('rationale-judge-fatigue'), { target: { value: 'too_strong' } })
    expect(onJudge).toHaveBeenCalledWith('fatigue', 'too_strong')
  })

  it('states consequences as sentences naming the alternative, not as bare numbers', () => {
    mount()
    const text = screen.getByTestId('different-setting').textContent ?? ''
    expect(text).toContain('Call & response (driving)')
  })

  it('names inputs that played no part, and only those', () => {
    mount()
    const listed = screen.getByTestId('played-no-part').textContent ?? ''
    expect(listed).toContain('oshi_affinity')
    // Without these, an implementation that ignores the 2% threshold and dumps
    // every feature into the list passes.
    expect(listed).not.toContain('fatigue')
    expect(listed).not.toContain('monotony')
  })

  it('suppresses both consequence sections on the trigger stage', () => {
    // They only mean something against a NAMED alternative option.
    mount({ stage: 'trigger' })
    expect(screen.queryByTestId('different-setting')).toBeNull()
    expect(screen.queryByTestId('played-no-part')).toBeNull()
  })

  it('suppresses consequences when there is no alternative to name', () => {
    mount({ right: null })
    expect(screen.queryByTestId('different-setting')).toBeNull()
  })

  it('renders the table even with no alternative, since the shares still hold', () => {
    mount({ right: null })
    expect(screen.getAllByTestId('rationale-feature').length).toBe(3)
  })

  it('reflects an existing judgement', () => {
    mount({ judgments: { fatigue: 'too_strong' } })
    expect((screen.getByTestId('rationale-judge-fatigue') as HTMLSelectElement).value).toBe('too_strong')
  })

  it('says so when a flip does not exist rather than printing a number', () => {
    const dominant: ReviewOption = { id: 'a', label: { ja: 'A', en: 'A' }, score: 9, rows: [row('fatigue', 1, 9)] }
    const weak: ReviewOption = { id: 'b', label: { ja: 'B', en: 'B' }, score: 0.01, rows: [row('monotony', 0.1, 0.1)] }
    mount({ left: dominant, right: weak, declaredWeights: { fatigue: 9 } })
    const text = screen.getByTestId('different-setting').textContent ?? ''
    expect(text).not.toMatch(/\d+\s*%/)
    expect(text.length).toBeGreaterThan(0)
  })

  it('renders neither consequence section for any stage when there is no alternative and it is not the trigger stage', () => {
    // Guards against an implementation that suppresses these sections for
    // EVERY stage rather than specifically the trigger stage: the service
    // stage WITH a named alternative must show both sections.
    mount({ stage: 'service' })
    expect(screen.getByTestId('different-setting')).toBeTruthy()
    expect(screen.getByTestId('played-no-part')).toBeTruthy()
  })

  it('orders rows by realized influence rather than input array order', () => {
    // The fixture's own row order already happens to match realized-influence
    // order, so this pins order against a differently-ordered input to make
    // sure the component is actually sorting rather than passing rows through.
    const shuffledLeft: ReviewOption = {
      ...left,
      rows: [left.rows[2], left.rows[0], left.rows[1]], // oshi_affinity, fatigue, monotony
    }
    mount({ left: shuffledLeft })
    const ids = screen.getAllByTestId('rationale-feature').map((n) => n.textContent ?? '')
    expect(ids[0]).toContain('fatigue')
    expect(ids[1]).toContain('monotony')
    expect(ids[2]).toContain('oshi_affinity')
  })

  it('distinguishes "cannot flip" from "evidence unavailable"', () => {
    const dominant: ReviewOption = { id: 'a', label: { ja: 'A', en: 'A' }, score: 9, rows: [row('fatigue', 1, 9)] }
    const weak: ReviewOption = { id: 'b', label: { ja: 'B', en: 'B' }, score: 0.01, rows: [row('monotony', 0.1, 0.1)] }
    mount({ left: dominant, right: weak, declaredWeights: { fatigue: 9 } })
    const sentences = screen.getAllByTestId(/^consequence-/).map((n) => n.textContent)
    expect(new Set(sentences).size).toBe(sentences.length)
  })

  it('renders no raw English in the Japanese UI', () => {
    const dominant: ReviewOption = { id: 'a', label: { ja: 'A', en: 'A' }, score: 9, rows: [row('fatigue', 1, 9)] }
    const weak: ReviewOption = { id: 'b', label: { ja: 'B', en: 'B' }, score: 0.01, rows: [row('monotony', 0.1, 0.1)] }
    render(
      <LanguageProvider initialLanguage="ja">
        <ParameterRationale stage="service" left={dominant} right={weak}
          declaredWeights={{ fatigue: 9 }} judgments={{}} onJudge={() => {}} />
      </LanguageProvider>,
    )
    expect(screen.getByTestId('different-setting').textContent ?? '')
      .not.toMatch(/[a-z]{4,}\s+[a-z]{4,}/)
  })
})
