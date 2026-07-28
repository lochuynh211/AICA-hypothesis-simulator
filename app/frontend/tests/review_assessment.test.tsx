import { render, screen, fireEvent } from '@testing-library/react'
import DecisionAssessment from '../src/components/review/DecisionAssessment'
import { LanguageProvider } from '../src/state/language'
import { summarizeJudgments } from '../src/components/review/DecisionAssessment'

const wrap = (ui: React.ReactNode) => render(<LanguageProvider>{ui}</LanguageProvider>)
const mount = (extra = {}) =>
  wrap(
    <DecisionAssessment
      caseId="case-c03-monotonous-highway" checkpointId="monotony_prevention"
      stage="service" targetId="music_playlist"
      judgmentSummary={{ judged: 3, total: 8, flags: 2 }}
      assessment={null} comment="" onAssess={() => {}} onComment={() => {}} onExport={() => {}}
      {...extra}
    />,
  )

describe('summarizeJudgments', () => {
  it('counts a judged input even when the reviewer is unsure', () => {
    const s = summarizeJudgments({ a: 'unsure', b: 'rational' }, 5)
    expect(s.judged).toBe(2)
    expect(s.total).toBe(5)
  })

  it('never counts "not sure" as a flag', () => {
    // It is a request for EXPLANATION, not a complaint, and must not inflate a
    // number that means "these need attention".
    const s = summarizeJudgments({ a: 'unsure', b: 'unsure' }, 4)
    expect(s.flags).toBe(0)
  })

  it('never counts "makes sense" as a flag', () => {
    expect(summarizeJudgments({ a: 'rational' }, 3).flags).toBe(0)
  })

  it('counts exactly the three criticisms as flags', () => {
    const s = summarizeJudgments(
      { a: 'too_strong', b: 'too_weak', c: 'not_relevant_here', d: 'rational', e: 'unsure' }, 5)
    expect(s.flags).toBe(3)
  })

  it('ignores an unset judgement', () => {
    expect(summarizeJudgments({ a: '' }, 2).judged).toBe(0)
  })
})

describe('DecisionAssessment', () => {
  it('opens with the judgement summary and the open count', () => {
    mount()
    const summary = screen.getByTestId('judgment-summary').textContent ?? ''
    expect(summary).toContain('3')
    expect(summary).toContain('8')
    expect(summary).toContain('5')       // 8 − 3 still open
  })

  it('offers the three assessments', () => {
    mount()
    expect(screen.getByTestId('assess-appropriate')).toBeTruthy()
    expect(screen.getByTestId('assess-not-sure')).toBeTruthy()
    expect(screen.getByTestId('assess-not-appropriate')).toBeTruthy()
  })

  it('reports the chosen assessment', () => {
    const onAssess = vi.fn()
    mount({ onAssess })
    fireEvent.click(screen.getByTestId('assess-not-appropriate'))
    expect(onAssess).toHaveBeenCalledWith('not_appropriate')
  })

  it('takes a free comment for what they expected instead', () => {
    const onComment = vi.fn()
    mount({ onComment })
    fireEvent.change(screen.getByTestId('assess-comment'), { target: { value: 'expected rest' } })
    expect(onComment).toHaveBeenCalledWith('expected rest')
  })

  it('reflects an existing assessment', () => {
    mount({ assessment: 'appropriate' })
    expect(screen.getByTestId('assess-appropriate').getAttribute('aria-pressed')).toBe('true')
  })

  it('exports', () => {
    const onExport = vi.fn()
    mount({ onExport })
    fireEvent.click(screen.getByTestId('assess-export'))
    expect(onExport).toHaveBeenCalled()
  })

  it('labels the comment textarea for assistive tech', () => {
    mount()
    const textarea = screen.getByTestId('assess-comment') as HTMLTextAreaElement
    // Either an aria-label or a <label htmlFor> pointing at this control's id.
    const hasAriaLabel = !!textarea.getAttribute('aria-label')
    const hasFieldsetLabel = textarea.id !== '' && !!document.querySelector(`label[for="${textarea.id}"]`)
    expect(hasAriaLabel || hasFieldsetLabel).toBe(true)
  })
})

// ── Language coverage ────────────────────────────────────────────────────
//
// Every assertion above is testid/numeric-based and so passes in either
// language — exactly the shape that let raw English leak into the
// default-JA UI in a previous task despite 821 green tests. These two pin
// actual rendered prose (not just counts) in each language.

describe('DecisionAssessment — language coverage', () => {
  it('renders the judgement summary and assessment labels in English under initialLanguage="en"', () => {
    render(
      <LanguageProvider initialLanguage="en">
        <DecisionAssessment
          caseId="case-c03-monotonous-highway" checkpointId="monotony_prevention"
          stage="service" targetId="music_playlist"
          judgmentSummary={{ judged: 3, total: 8, flags: 2 }}
          assessment={null} comment="" onAssess={() => {}} onComment={() => {}} onExport={() => {}}
        />
      </LanguageProvider>,
    )
    expect(screen.getByTestId('judgment-summary')).toHaveTextContent('3 / 8 inputs judged')
    expect(screen.getByTestId('judgment-summary')).toHaveTextContent('5 still open')
    expect(screen.getByTestId('assess-appropriate')).toHaveTextContent('Appropriate')
    expect(screen.getByTestId('assess-not-sure')).toHaveTextContent('Not sure')
    expect(screen.getByTestId('assess-not-appropriate')).toHaveTextContent('Not appropriate')
  })

  it('renders the judgement summary and assessment labels in Japanese under initialLanguage="ja" (the default)', () => {
    render(
      <LanguageProvider initialLanguage="ja">
        <DecisionAssessment
          caseId="case-c03-monotonous-highway" checkpointId="monotony_prevention"
          stage="service" targetId="music_playlist"
          judgmentSummary={{ judged: 3, total: 8, flags: 2 }}
          assessment={null} comment="" onAssess={() => {}} onComment={() => {}} onExport={() => {}}
        />
      </LanguageProvider>,
    )
    expect(screen.getByTestId('judgment-summary')).toHaveTextContent('3 / 8')
    expect(screen.getByTestId('judgment-summary')).toHaveTextContent('評価済み')
    expect(screen.getByTestId('judgment-summary')).toHaveTextContent('未評価 5 件')
    expect(screen.getByTestId('assess-appropriate')).toHaveTextContent('妥当')
    expect(screen.getByTestId('assess-not-sure')).toHaveTextContent('わからない')
    expect(screen.getByTestId('assess-not-appropriate')).toHaveTextContent('妥当ではない')
    // No stray raw English leaking into the default-JA card.
    const card = screen.getByTestId('decision-assessment')
    expect(card.textContent ?? '').not.toMatch(/[a-z]{4,}\s+[a-z]{4,}/)
  })
})
