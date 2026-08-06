/**
 * StageFeedbackPanel — the review verdict for ALL THREE stages at once, at the
 * top of the review column.
 *
 * It replaced `DecisionAssessment`, which asked the same question but only for
 * whichever stage tab happened to be open. A reviewer forms an opinion about
 * the trigger, the service and the content together; making them switch tabs to
 * record each one lost that, and made "I only judged the trigger" and "I judged
 * all three and two were fine" look identical.
 *
 * Each row keeps its own verdict + comment, scoped to that stage's own review
 * target, so the three are independent records — not one verdict applied three
 * times.
 *
 * A stage with nothing to review says so in its row rather than offering
 * buttons that would record a verdict about nothing.
 */
import { useRef } from 'react'
import { useLanguage } from '../../state/language'
import { t } from '../../i18n/t'
import type { BilingualLabel } from '../../lib/review/reviewVocabulary'
import type { ReviewStage } from '../../lib/review/checkpoints'

const TITLE: BilingualLabel = { ja: 'レビュー評価', en: 'Review verdict' }
const EXPORT_MARKDOWN: BilingualLabel = { ja: '全件Markdown', en: 'All (Markdown)' }
const SUMMARY_BUTTON: BilingualLabel = { ja: 'ケース別結果', en: 'By test case' }
const MODIFIED_NOTE: BilingualLabel = { ja: '（設定を編集済み）', en: '(setup edited)' }
const NO_CASE_NAME: BilingualLabel = { ja: '（テストケース未選択）', en: '(no test case selected)' }
const NEEDS_CASE: BilingualLabel = {
  ja: 'フィードバックはテストケースごとに記録されます。まずテストケースを選択してください。',
  en: 'Feedback is recorded per test case. Choose a test case first.',
}
const COMMENT_PLACEHOLDER: Record<ReviewStage, BilingualLabel> = {
  trigger: { ja: '発火へのコメント', en: 'Comment on the trigger' },
  service: { ja: 'サービスへのコメント', en: 'Comment on the service' },
  content: { ja: 'コンテンツへのコメント', en: 'Comment on the content' },
}

// Owner directive: the user-facing word for the decision event is 発火, not
// トリガー — this ReviewStage names the review target for whether AICA fired
// (rest_required / monotony_prevention), i.e. the 発火 decision. EN stays
// 'Trigger', matching the ja:発火/en:Trigger pairing used across this app.
const STAGE_LABEL: Record<ReviewStage, BilingualLabel> = {
  trigger: { ja: '発火', en: 'Trigger' },
  service: { ja: 'サービス', en: 'Service' },
  content: { ja: 'コンテンツ', en: 'Content' },
}

/** The three verdicts. Same stored values as before, so records written by the
 *  earlier decision-level card stay readable; only the JA wording is the
 *  owner's shorter 妥当 / 不適 / 不明. */
const VERDICTS: { value: string; slug: string; tone: string; label: BilingualLabel }[] = [
  { value: 'appropriate', slug: 'appropriate', tone: 'good', label: { ja: '妥当', en: 'Appropriate' } },
  { value: 'not_appropriate', slug: 'not-appropriate', tone: 'bad', label: { ja: '不適', en: 'Not appropriate' } },
  { value: 'not_sure', slug: 'not-sure', tone: 'unsure', label: { ja: '不明', en: 'Not sure' } },
]

export type StageFeedbackRow = {
  stage: ReviewStage
  /** False when this stage has nothing reviewable at this decision point. */
  available: boolean
  /** Why it is unavailable — shown in place of the buttons. */
  unavailableReason?: string | null
  assessment: string | null
  comment: string
}

const headerButtonStyle: React.CSSProperties = {
  fontSize: '0.72em',
  fontWeight: 700,
  padding: '3px 8px',
  border: '1px solid #cbd5e1',
  borderRadius: '4px',
  background: '#f8fafc',
  color: '#334155',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

export default function StageFeedbackPanel({
  rows,
  onAssess,
  onComment,
  onCommentCommit = () => {},
  onExportMarkdown,
  onOpenSummary,
  caseName = null,
  caseModified = false,
  caseSelected = true,
}: {
  rows: StageFeedbackRow[]
  onAssess: (stage: ReviewStage, assessment: string) => void
  onComment: (stage: ReviewStage, text: string) => void
  /** Fired on blur, and only when the text changed — the persistence boundary.
   *  The feedback store is append-only, so committing per keystroke would turn
   *  one comment into dozens of near-duplicate events. */
  onCommentCommit?: (stage: ReviewStage, text: string) => void
  /** Every case's feedback, as readable Markdown (from the in-memory store). */
  onExportMarkdown: () => void
  onOpenSummary: () => void
  /** The selected case's title — shown read-only, so the reviewer can always
   *  see WHICH case the verdict is being filed against. */
  caseName?: string | null
  /** True once the setup has been edited away from the case as authored. The
   *  case stays selected; the label says it is no longer verbatim. */
  caseModified?: boolean
  /** Feedback is filed per test case, so with none selected there is nothing to
   *  file it against. The rows are disabled rather than hidden, so the reviewer
   *  can see what they would be able to record. */
  caseSelected?: boolean
}): JSX.Element {
  const { lang } = useLanguage()
  const focusValues = useRef<Partial<Record<ReviewStage, string>>>({})

  return (
    <div
      data-testid="stage-feedback-panel"
      className="review-card"
      // NOT sticky: the right column must have exactly ONE scroller (owner
      // review). With the comment boxes at their full height a pinned block
      // would occupy most of the column, so the verdict scrolls with the
      // evidence it is about.
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '8px' }}>
        <p className="review-card-h" style={{ margin: 0 }}>{t(TITLE, lang)}</p>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '5px' }}>
          <button
            type="button"
            data-testid="open-feedback-summary"
            onClick={onOpenSummary}
            style={headerButtonStyle}
          >
            {t(SUMMARY_BUTTON, lang)}
          </button>
          <button
            type="button"
            data-testid="export-review-markdown"
            onClick={onExportMarkdown}
            style={headerButtonStyle}
          >
            {t(EXPORT_MARKDOWN, lang)}
          </button>
        </div>
      </div>

      <p
        data-testid="feedback-case-name"
        style={{ fontSize: '0.8em', fontWeight: 700, color: '#1e293b', margin: '0 0 8px' }}
      >
        {caseName ?? t(NO_CASE_NAME, lang)}
        {caseModified && (
          <span data-testid="case-modified" style={{ marginLeft: '6px', fontWeight: 600, color: '#b45309' }}>
            {t(MODIFIED_NOTE, lang)}
          </span>
        )}
      </p>

      {!caseSelected && (
        <p
          data-testid="feedback-needs-case"
          style={{
            fontSize: '0.78em', color: '#92400e', background: '#fffbeb',
            border: '1px solid #fcd34d', borderRadius: '4px', padding: '6px 8px', margin: '0 0 8px',
          }}
        >
          {t(NEEDS_CASE, lang)}
        </p>
      )}

      {rows.map((row, index) => (
        <div
          key={row.stage}
          data-testid={`feedback-row-${row.stage}`}
          style={{ marginBottom: index === rows.length - 1 ? 0 : '10px' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '4px' }}>
            <span style={{ fontSize: '0.82em', fontWeight: 700, color: '#1e293b' }}>
              {index + 1}. {t(STAGE_LABEL[row.stage], lang)}
            </span>

            {row.available ? (
              <div
                className="verdict-btns"
                data-testid={`verdicts-${row.stage}`}
                style={{ marginLeft: 'auto', flex: '0 1 62%' }}
              >
                {VERDICTS.map((v) => (
                  <button
                    key={v.value}
                    type="button"
                    data-testid={`assess-${row.stage}-${v.slug}`}
                    className={row.assessment === v.value ? `on ${v.tone}` : undefined}
                    aria-pressed={row.assessment === v.value}
                    disabled={!caseSelected}
                    onClick={() => onAssess(row.stage, v.value)}
                  >
                    {t(v.label, lang)}
                  </button>
                ))}
              </div>
            ) : (
              <span
                data-testid={`feedback-unavailable-${row.stage}`}
                style={{ marginLeft: 'auto', fontSize: '0.76em', color: '#94a3b8' }}
              >
                {row.unavailableReason ?? ''}
              </span>
            )}

          </div>

          {row.available && (
            <textarea
              data-testid={`assess-comment-${row.stage}`}
              aria-label={t(COMMENT_PLACEHOLDER[row.stage], lang)}
              placeholder={t(COMMENT_PLACEHOLDER[row.stage], lang)}
              value={row.comment}
              disabled={!caseSelected}
              onChange={(e) => onComment(row.stage, e.target.value)}
              onFocus={(e) => { focusValues.current[row.stage] = e.target.value }}
              onBlur={(e) => {
                const before = focusValues.current[row.stage]
                focusValues.current[row.stage] = undefined
                // A focus/blur with no edit records nothing.
                if (before !== undefined && before !== e.target.value) {
                  onCommentCommit(row.stage, e.target.value)
                }
              }}
              rows={6}
              style={{
                width: '100%',
                fontSize: '0.8em',
                padding: '5px 7px',
                border: '1px solid #e2e8f0',
                borderRadius: '4px',
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
          )}
        </div>
      ))}
    </div>
  )
}
