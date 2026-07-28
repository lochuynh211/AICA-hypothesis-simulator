// app/frontend/src/components/review/DecisionAssessment.tsx
/**
 * DecisionAssessment — the decision-level card that closes the review loop
 * (Task 16). It sits below `ParameterRationale` and asks ONE question that
 * the per-input judgements above it don't: "given everything you just
 * looked at, was THIS decision appropriate?"
 *
 * It opens with a summary of the per-input judgements made at this decision
 * (`n / m inputs judged · k still open`, 07-27 §10) so the reviewer can see
 * how much of the decision they actually examined before assessing it —
 * never a blind rubber stamp.
 *
 * "Not sure" (an assessment value here, `not_sure`) and the per-input
 * "Not sure" (`unsure`, see `ParameterRationale`) are both requests for
 * explanation, not complaints — `summarizeJudgments` below is the ONE place
 * that decides what counts as a "flag", and deliberately excludes both the
 * per-input `unsure` and `rational` judgements from that count.
 */
import { useRef } from 'react'
import { useLanguage } from '../../state/language'
import { t } from '../../i18n/t'
import type { BilingualLabel } from '../../lib/review/reviewVocabulary'
import type { ReviewStage } from '../../lib/review/checkpoints'

/** The three criticisms. "Not sure" and "Makes sense" are deliberately absent. */
const FLAG_JUDGMENTS = new Set(['too_strong', 'too_weak', 'not_relevant_here'])

export function summarizeJudgments(
  judgments: Record<string, string>,
  total: number,
): { judged: number; total: number; flags: number } {
  const set = Object.values(judgments).filter(Boolean)
  return {
    judged: set.length,
    total,
    // "Not sure" is a request for explanation, not a complaint — counting it
    // here would inflate a number that means "these need attention".
    flags: set.filter((j) => FLAG_JUDGMENTS.has(j)).length,
  }
}

export type JudgmentSummary = { judged: number; total: number; flags: number }

const TITLE: BilingualLabel = { ja: 'この決定の評価', en: 'Decision assessment' }
const APPROPRIATE: BilingualLabel = { ja: '妥当', en: 'Appropriate' }
const NOT_SURE: BilingualLabel = { ja: 'わからない', en: 'Not sure' }
const NOT_APPROPRIATE: BilingualLabel = { ja: '妥当ではない', en: 'Not appropriate' }
const COMMENT_LABEL: BilingualLabel = {
  ja: '期待していた内容とその理由（任意）',
  en: 'What you expected instead, and why (optional)',
}
const EXPORT_BUTTON: BilingualLabel = { ja: 'この評価をエクスポート', en: 'Export this review' }
const NO_RUN_NOTE: BilingualLabel = {
  ja: 'あなたの評価はこの画面に保存されています。実行が作成されると、そこから記録が始まります。',
  en: 'Your judgements are kept on this screen. Persistence begins once a run exists.',
}

function summarySentence(judged: number, total: number, lang: 'ja' | 'en'): string {
  const open = Math.max(total - judged, 0)
  return lang === 'ja'
    ? `入力 ${judged} / ${total} 件を評価済み ・ 未評価 ${open} 件`
    : `${judged} / ${total} inputs judged · ${open} still open`
}

const ASSESSMENTS: { value: string; testid: string; label: BilingualLabel }[] = [
  { value: 'appropriate', testid: 'assess-appropriate', label: APPROPRIATE },
  { value: 'not_sure', testid: 'assess-not-sure', label: NOT_SURE },
  { value: 'not_appropriate', testid: 'assess-not-appropriate', label: NOT_APPROPRIATE },
]

export default function DecisionAssessment({
  caseId,
  checkpointId,
  stage,
  targetId,
  judgmentSummary,
  assessment,
  comment,
  onAssess,
  onComment,
  onCommentCommit = () => {},
  onExport,
  hasRun = true,
}: {
  caseId: string
  checkpointId: string
  stage: ReviewStage
  targetId: string
  judgmentSummary: JudgmentSummary
  assessment: string | null
  comment: string
  onAssess: (assessment: string) => void
  onComment: (text: string) => void
  /** Fired on blur, and ONLY when the text changed since the field was
   * focused — never on every keystroke. This is the persistence boundary:
   * `onComment` above is for cheap, local, no-network updates (keeps the
   * textarea responsive); this is "the reviewer decided this is my
   * comment." A focus/blur with no edit emits nothing. Optional (defaults
   * to a no-op) so call sites that don't persist comments are unaffected. */
  onCommentCommit?: (text: string) => void
  onExport: () => void
  /** False when no live merged run exists yet — judgements still land in the
   * store, but nothing is persisted server-side until a run does. Defaults
   * to true so every existing call site (and every test) is unaffected. */
  hasRun?: boolean
}): JSX.Element {
  const { lang } = useLanguage()
  const commentId = `assess-comment-${caseId}-${checkpointId}-${stage}-${targetId}`
  // Snapshot of the field's value when it was focused, so blur can tell
  // "the reviewer edited this" apart from "the reviewer just tabbed
  // through it" — only the former should emit `onCommentCommit`.
  const focusValueRef = useRef<string | null>(null)

  return (
    <div data-testid="decision-assessment" style={{ padding: '12px', borderTop: '1px solid #e2e8f0' }}>
      <p
        style={{
          fontSize: '0.72em', fontWeight: 800, textTransform: 'uppercase',
          letterSpacing: '0.05em', color: '#94a3b8', margin: '0 0 8px',
        }}
      >
        {t(TITLE, lang)}
      </p>

      <p data-testid="judgment-summary" style={{ fontSize: '0.84em', color: '#475569', margin: '0 0 12px' }}>
        {summarySentence(judgmentSummary.judged, judgmentSummary.total, lang)}
      </p>

      {!hasRun && (
        <p data-testid="assess-no-run-yet" style={{ fontSize: '0.78em', color: '#92400e', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '4px', padding: '6px 8px', margin: '0 0 12px' }}>
          {t(NO_RUN_NOTE, lang)}
        </p>
      )}

      <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
        {ASSESSMENTS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            data-testid={opt.testid}
            aria-pressed={assessment === opt.value}
            onClick={() => onAssess(opt.value)}
            style={{
              padding: '6px 12px',
              fontSize: '0.82em',
              fontWeight: 700,
              border: '1px solid #e2e8f0',
              borderRadius: '4px',
              background: assessment === opt.value ? '#eff6ff' : '#f8fafc',
              color: assessment === opt.value ? '#2563eb' : '#1e293b',
              cursor: 'pointer',
            }}
          >
            {t(opt.label, lang)}
          </button>
        ))}
      </div>

      <div style={{ marginBottom: '12px' }}>
        <label htmlFor={commentId} style={{ display: 'block', fontSize: '0.8em', color: '#4b5563', marginBottom: '4px' }}>
          {t(COMMENT_LABEL, lang)}
        </label>
        <textarea
          id={commentId}
          data-testid="assess-comment"
          value={comment}
          onChange={(e) => onComment(e.target.value)}
          onFocus={(e) => {
            focusValueRef.current = e.target.value
          }}
          onBlur={(e) => {
            const editedSinceFocus = focusValueRef.current !== null && e.target.value !== focusValueRef.current
            focusValueRef.current = null
            if (editedSinceFocus) onCommentCommit(e.target.value)
          }}
          rows={3}
          style={{ width: '100%', fontSize: '0.84em', padding: '6px', boxSizing: 'border-box' }}
        />
      </div>

      <button
        type="button"
        data-testid="assess-export"
        onClick={onExport}
        style={{
          padding: '6px 12px',
          fontSize: '0.82em',
          fontWeight: 700,
          border: '1px solid #cbd5e1',
          borderRadius: '4px',
          background: '#f8fafc',
          color: '#1e293b',
          cursor: 'pointer',
        }}
      >
        {t(EXPORT_BUTTON, lang)}
      </button>
    </div>
  )
}
