/**
 * FeedbackSummaryModal — every test case and what the reviewer recorded against
 * it, in one list.
 *
 * Cases with NO feedback are listed too, and said to be empty. A coverage
 * report that silently omitted them would read as "all reviewed" when the
 * truth is "not looked at yet".
 *
 * Records listed here are EDITABLE — a reviewer re-reading their own coverage
 * is exactly when they change their mind. Each row edits the record in place
 * using the key that already names its case, checkpoint, stage and target, so
 * nothing about the decision point is invented. A case with no record yet
 * cannot be given one here: there would be no decision point to attach it to,
 * so it is filed by selecting that case and reviewing it.
 */
import { useRef } from 'react'
import Modal from '../merged/Modal'
import { useLanguage } from '../../state/language'
import { t } from '../../i18n/t'
import type { BilingualLabel } from '../../i18n/t'
import { verdictLabel, stageLabel, type CaseFeedback } from '../../lib/review/feedbackSummary'

/** The same three stored values the panel writes. */
const VERDICTS = ['appropriate', 'not_appropriate', 'not_sure']

const LABELS = {
  title: { ja: 'テストケース別フィードバック', en: 'Feedback by test case' },
  coverage: { ja: 'フィードバックのあるケース', en: 'Cases with feedback' },
  none: {
    ja: 'フィードバックなし — このケースを選択してレビューすると記録できます。',
    en: 'No feedback yet — select this case and review it to record some.',
  },
  editComment: { ja: 'コメント', en: 'Comment' },
  inputs: { ja: '個別入力の評価', en: 'per-input judgements' },
  exportMd: { ja: 'Markdown でエクスポート', en: 'Export as Markdown' },
} satisfies Record<string, BilingualLabel>

export default function FeedbackSummaryModal({
  open,
  cases,
  onClose,
  onExportMarkdown,
  onEditRecord,
}: {
  open: boolean
  cases: CaseFeedback[]
  onClose: () => void
  onExportMarkdown: () => void
  /** Re-file an existing record. The first four arguments reconstruct its key
   *  exactly; only the supplied field changes. */
  onEditRecord: (
    caseId: string,
    checkpointId: string,
    stage: string,
    targetId: string,
    next: { assessment?: string; comment?: string },
    opts?: { persist?: boolean },
  ) => void
}): JSX.Element | null {
  const { lang } = useLanguage()
  // Comment typing updates the store but does NOT persist — the feedback store
  // is append-only, so a POST per keystroke would turn one edit into dozens of
  // near-duplicate events. Blur is the persistence boundary, as in the panel.
  const focusValues = useRef<Record<string, string>>({})
  const covered = cases.filter((c) => !c.empty).length

  return (
    <Modal open={open} title={t(LABELS.title, lang)} onClose={onClose} size="wide">
      <div data-testid="feedback-summary-modal" style={{ minHeight: '55vh' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '10px' }}>
          <span data-testid="feedback-coverage" style={{ fontSize: '0.84em', color: '#475569' }}>
            {t(LABELS.coverage, lang)}: <b>{covered}</b> / {cases.length}
          </span>
          <button
            type="button"
            data-testid="summary-export-markdown"
            onClick={onExportMarkdown}
            style={{
              marginLeft: 'auto', fontSize: '0.78em', fontWeight: 700, padding: '4px 10px',
              border: '1px solid #1d4ed8', borderRadius: '4px', background: '#1d4ed8',
              color: '#fff', cursor: 'pointer',
            }}
          >
            {t(LABELS.exportMd, lang)}
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {cases.map((c) => (
            <div
              key={c.caseId}
              data-testid={`summary-case-${c.caseId}`}
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: '7px',
                padding: '8px 10px',
                background: c.empty ? '#f8fafc' : '#fff',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                {/* The raw case id used to sit here in faint grey next to the
                    title. Removed (glossary rule 2, no identifier reaches the
                    screen) — the translated title already identifies the case
                    uniquely, and the id stays reachable in data-testid above. */}
                <span style={{ fontWeight: 700, fontSize: '0.86em' }}>{t(c.title, lang)}</span>
                {c.inputJudgements > 0 && (
                  <span style={{ marginLeft: 'auto', fontSize: '0.74em', color: '#64748b' }}>
                    {c.inputJudgements} {t(LABELS.inputs, lang)}
                  </span>
                )}
              </div>

              {c.empty ? (
                <p
                  data-testid={`summary-empty-${c.caseId}`}
                  style={{ margin: '4px 0 0', fontSize: '0.8em', color: '#94a3b8' }}
                >
                  {t(LABELS.none, lang)}
                </p>
              ) : (
                <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {c.verdicts.map((v, i) => (
                    <div key={`${v.checkpointId}-${v.stage}-${v.targetId}-${i}`}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <b style={{ fontSize: '0.8em' }}>{stageLabel(v.stage, lang)}</b>
                        <span
                          data-testid={`summary-verdict-${c.caseId}-${v.stage}`}
                          style={{ fontSize: '0.76em', color: '#64748b' }}
                        >
                          {v.assessment ? verdictLabel(v.assessment, lang) : '—'}
                        </span>
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
                          {VERDICTS.map((value) => (
                            <button
                              key={value}
                              type="button"
                              data-testid={`summary-assess-${c.caseId}-${v.stage}-${value}`}
                              aria-pressed={v.assessment === value}
                              onClick={() =>
                                onEditRecord(c.caseId, v.checkpointId, v.stage, v.targetId, { assessment: value })
                              }
                              style={{
                                padding: '2px 8px',
                                fontSize: '0.74em',
                                fontWeight: 700,
                                border: `1px solid ${v.assessment === value ? '#2563eb' : '#e2e8f0'}`,
                                borderRadius: '4px',
                                background: v.assessment === value ? '#eff6ff' : '#f8fafc',
                                color: v.assessment === value ? '#2563eb' : '#1e293b',
                                cursor: 'pointer',
                              }}
                            >
                              {verdictLabel(value, lang)}
                            </button>
                          ))}
                        </div>
                      </div>
                      <textarea
                        data-testid={`summary-comment-${c.caseId}-${v.stage}`}
                        aria-label={`${t(LABELS.editComment, lang)} — ${stageLabel(v.stage, lang)}`}
                        placeholder={t(LABELS.editComment, lang)}
                        value={v.comment}
                        rows={3}
                        onChange={(e) =>
                          onEditRecord(
                            c.caseId, v.checkpointId, v.stage, v.targetId,
                            { comment: e.target.value }, { persist: false },
                          )
                        }
                        onFocus={(e) => {
                          focusValues.current[`${c.caseId}|${v.checkpointId}|${v.stage}|${v.targetId}`] = e.target.value
                        }}
                        onBlur={(e) => {
                          const k = `${c.caseId}|${v.checkpointId}|${v.stage}|${v.targetId}`
                          const before = focusValues.current[k]
                          delete focusValues.current[k]
                          // A focus/blur with no edit records nothing.
                          if (before !== undefined && before !== e.target.value) {
                            onEditRecord(c.caseId, v.checkpointId, v.stage, v.targetId, { comment: e.target.value })
                          }
                        }}
                        style={{
                          width: '100%', marginTop: '3px', fontSize: '0.78em', padding: '4px 6px',
                          border: '1px solid #e2e8f0', borderRadius: '4px', resize: 'vertical',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}
