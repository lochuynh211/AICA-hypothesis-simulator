import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
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

// ── Comment commit boundary (Task 16 fix round) ──────────────────────────
//
// `onComment` is the cheap, local, every-keystroke channel; `onCommentCommit`
// is the persistence boundary and must fire on BLUR only, and only when the
// text actually changed since the field was focused.

// `DecisionAssessment`'s comment field is a fully controlled input (`value={comment}`) —
// exactly like `ReviewColumn` drives it (the `comment` prop is re-supplied from the
// store on every `onComment`). A test that calls `fireEvent.change` WITHOUT also
// feeding the new text back in as the `comment` prop leaves the DOM value snapping
// back to the stale controlled value on the next render — silently masking a broken
// blur handler by never giving it real edited text to see. This harness closes that
// gap by actually wiring `onComment` back into local state, so `assess-comment`'s DOM
// value is real edited text by the time `blur` fires, matching production wiring.
function ControlledCommentHarness({ onCommentCommit }: { onCommentCommit: (text: string) => void }) {
  const [comment, setComment] = useState('')
  return (
    <LanguageProvider>
      <DecisionAssessment
        caseId="case-c03-monotonous-highway" checkpointId="monotony_prevention"
        stage="service" targetId="music_playlist"
        judgmentSummary={{ judged: 3, total: 8, flags: 2 }}
        assessment={null} comment={comment}
        onAssess={() => {}} onComment={setComment} onCommentCommit={onCommentCommit} onExport={() => {}}
      />
    </LanguageProvider>
  )
}

describe('DecisionAssessment — comment commit boundary', () => {
  it('does not call onCommentCommit on change — only onComment', () => {
    const onComment = vi.fn()
    const onCommentCommit = vi.fn()
    mount({ onComment, onCommentCommit })
    fireEvent.change(screen.getByTestId('assess-comment'), { target: { value: 'e' } })
    fireEvent.change(screen.getByTestId('assess-comment'), { target: { value: 'ex' } })
    fireEvent.change(screen.getByTestId('assess-comment'), { target: { value: 'expected rest' } })
    expect(onComment).toHaveBeenCalledTimes(3)
    expect(onCommentCommit).not.toHaveBeenCalled()
  })

  it('calls onCommentCommit exactly once, with the final text, on blur after an edit', () => {
    const onCommentCommit = vi.fn()
    render(<ControlledCommentHarness onCommentCommit={onCommentCommit} />)
    const textarea = screen.getByTestId('assess-comment')
    fireEvent.focus(textarea)
    fireEvent.change(textarea, { target: { value: 'e' } })
    fireEvent.change(textarea, { target: { value: 'ex' } })
    fireEvent.change(textarea, { target: { value: 'expected rest' } })
    fireEvent.blur(textarea)
    expect(onCommentCommit).toHaveBeenCalledTimes(1)
    expect(onCommentCommit).toHaveBeenCalledWith('expected rest')
  })

  it('does not call onCommentCommit when the field is blurred without an edit', () => {
    const onCommentCommit = vi.fn()
    mount({ comment: 'already saved', onCommentCommit })
    const textarea = screen.getByTestId('assess-comment')
    fireEvent.focus(textarea)
    fireEvent.blur(textarea)
    expect(onCommentCommit).not.toHaveBeenCalled()
  })

  it('does not call onCommentCommit on blur when the edit was reverted back to the original text', () => {
    // Not just "text changed at some point" — the DOM value AT BLUR must differ
    // from the value AT FOCUS. Typing then undoing back to the original is not
    // a completed edit and must not emit a spurious commit.
    const onCommentCommit = vi.fn()
    render(<ControlledCommentHarness onCommentCommit={onCommentCommit} />)
    const textarea = screen.getByTestId('assess-comment')
    fireEvent.focus(textarea)
    fireEvent.change(textarea, { target: { value: 'typo' } })
    fireEvent.change(textarea, { target: { value: '' } })
    fireEvent.blur(textarea)
    expect(onCommentCommit).not.toHaveBeenCalled()
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
