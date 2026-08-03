/**
 * ServiceResultOverlay (020 Task 10) — the docked STEP-1 result view for the
 * Combined Simulator: the eligible-service tag row + ranked candidate cards
 * (score, subtotals/trace, why, Choose). Extracted
 * verbatim from ServiceProposalPanel's RESULT region so BOTH the original
 * proposal-screen panel AND the merged center dock render the identical
 * markup from one source (true DRY — see 020 Task 10 brief).
 *
 * Pure presentational: props only, no store coupling. `ServiceProposalPanel`
 * derives every prop from `proposalStore`; the merged screen derives them
 * from `coordinator.state.proposalLog.evidence` instead — this component
 * doesn't know or care which.
 */
import { t } from '../../i18n/t'
import type { RankedCandidate, ProposalRunLog } from '../../api/proposalClient'
import ReasonBreakdown, { type ReasonRow } from '../proposal/ReasonBreakdown'
import ServiceExplainability, { hasFeatureTrace } from '../proposal/ServiceExplainability'
import { useExplanation, type ExplanationProvider } from '../proposal/useExplanation'
import { serviceLabel } from '../../lib/review/reviewVocabulary'

/**
 * The services V1 can actually deliver. Everything else still ranks and still
 * explains itself — a reviewer needs to see WHY an unsupported service scored
 * where it did — but it cannot be chosen, because there is nothing behind it.
 */
export const SUPPORTED_SERVICE_IDS = new Set(['music_playlist', 'humming_karaoke', 'full_karaoke'])

const LABELS = {
  recommended: { ja: '推奨サービス（最大3件）', en: 'Recommended (≤3)' },
  choose: { ja: 'これを選ぶ', en: 'Choose' },
  selected: { ja: '選択中 → コンテンツ提案へ', en: 'Selected → on to the content proposal' },
  noProposal: { ja: '候補なし', en: 'No candidates' },
  outOfScope: { ja: '本シミュレーターでは対象外(コンテンツ未対応)', en: 'Not available in this simulator (no content backing)' },
  eligibleTitle: { ja: '適格サービス', en: 'Eligible services' },
  noneEligible: { ja: '適格なサービスはありません。', en: 'No eligible services.' },
  notSupported: { ja: '本シミュレーターでは未対応', en: 'Not supported in this simulator' },
}

function serviceRows(candidate: RankedCandidate): ReasonRow[] {
  return candidate.feature_contributions.map((fc) => ({
    featureId: fc.feature_id,
    value: fc.feature_value,
    r: fc.response_coefficient,
    w: fc.weight,
    contribution: fc.contribution,
  }))
}

/** One candidate's ReasonBreakdown, wired to the explanation hook. Its own
 * component so the hook (one per candidate) obeys the rules of hooks even
 * though candidates are rendered in a `.map()`. When the provider is 'off' the
 * hook is inert and the deterministic template shows. */
function ServiceReason({
  candidate,
  runId,
  provider,
  lang,
  inlineProposal,
}: {
  candidate: RankedCandidate
  runId: string | undefined
  provider: ExplanationProvider
  lang: 'ja' | 'en'
  inlineProposal?: ProposalRunLog | null
}) {
  const { ai, request } = useExplanation(runId, 'service', candidate.candidate_id, provider, lang, inlineProposal)
  return (
    <ReasonBreakdown
      rows={serviceRows(candidate)}
      supportingFeatureIds={candidate.supporting_feature_ids}
      opposingFeatureIds={candidate.opposing_feature_ids}
      rationale={candidate.rationale}
      lang={lang}
      variant="service"
      showTable={!hasFeatureTrace(candidate)}
      aiExplanation={ai}
      onExpand={request}
    />
  )
}

export function ServiceResultOverlay(props: {
  output?: { decision_type: string; ranked_candidates: RankedCandidate[] }
  eligibleCandidates: { candidate_id: string }[]
  activeServiceId: string | null
  choosingId: string | null
  onChoose: (candidateId: string) => void
  /** Content-backed gate (Task 5's Choose scope-gate): a candidate whose
   * content package can't actually serve it gets a disabled Choose button +
   * an "out of V1 scope" note. Defaults to always-backed (every candidate
   * choosable) when the caller doesn't need the gate. */
  isBacked?: (candidateId: string) => boolean
  /** Clicking a card asks to COMPARE it (right column), which is a different
   *  act from choosing it. Optional: the standalone Proposal screen has no
   *  review column, and passes nothing. */
  onInspect?: (candidateId: string) => void
  runId?: string
  explanationProvider: ExplanationProvider
  /** An EPHEMERAL proposal (quickview/after-nap projection) to explain inline —
   * feature 020. Undefined for a persisted run (uses the run-id endpoint). */
  inlineProposal?: ProposalRunLog | null
  lang: 'ja' | 'en'
}) {
  const {
    output,
    eligibleCandidates,
    activeServiceId,
    choosingId,
    onChoose,
    isBacked = () => true,
    onInspect,
    runId,
    explanationProvider,
    inlineProposal,
    lang,
  } = props

  return (
    <>
      {/* Eligible services only, as one line of tags (owner review). The
          excluded list was dropped from this panel: it is platform-gate
          bookkeeping, not something a reviewer weighs while comparing the
          services that ARE on the table. */}
      <div style={sectionLabelStyle}>{t(LABELS.eligibleTitle, lang)}</div>
      <div data-testid="eligible-list" style={eligibleTagRowStyle}>
        {eligibleCandidates.length === 0 ? (
          <span style={{ fontSize: '0.8em', color: '#6b7280' }}>{t(LABELS.noneEligible, lang)}</span>
        ) : (
          eligibleCandidates.map(({ candidate_id }) => (
            <span key={candidate_id} data-testid={`eligible-${candidate_id}`} style={eligibleTagStyle}>
              {t(serviceLabel(candidate_id), lang)}
            </span>
          ))
        )}
      </div>

      {output && (
        <>
          <div style={sectionLabelStyle}>{t(LABELS.recommended, lang)}</div>
          {output.decision_type === 'no_proposal' && (
            <p style={{ fontSize: '0.82em', color: '#6b7280' }}>{t(LABELS.noProposal, lang)}</p>
          )}
          {output.ranked_candidates.slice(0, 3).map((candidate) => {
            const isActive = candidate.candidate_id === activeServiceId
            const supported = SUPPORTED_SERVICE_IDS.has(candidate.candidate_id)
            // Two independent reasons a Choose can be dead: the content package
            // cannot serve it, or V1 does not implement it at all. Keep them
            // distinct so the note explains the actual cause.
            const backed = supported && isBacked(candidate.candidate_id)
            return (
              <div
                key={candidate.candidate_id}
                data-testid={`candidate-card-${candidate.candidate_id}`}
                onClick={onInspect ? () => onInspect(candidate.candidate_id) : undefined}
                style={{
                  border: isActive ? '1px solid #1d4ed8' : '1px solid #e5e7eb',
                  borderRadius: '9px',
                  margin: '8px 0',
                  overflow: 'hidden',
                  cursor: onInspect ? 'pointer' : undefined,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '8px 10px' }}>
                  <span
                    style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '6px',
                      background: '#1d4ed8',
                      color: '#fff',
                      fontSize: '0.72em',
                      fontWeight: 800,
                      display: 'grid',
                      placeItems: 'center',
                    }}
                  >
                    {candidate.rank}
                  </span>
                  <span style={{ fontWeight: 700, fontSize: '0.86em' }}>{t(serviceLabel(candidate.candidate_id), lang)}</span>
                  {candidate.score !== null && (
                    <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontWeight: 800, color: '#1d4ed8' }}>
                      {candidate.score >= 0 ? '+' : ''}
                      {candidate.score.toFixed(3)}
                    </span>
                  )}
                </div>
                <ServiceExplainability candidate={candidate} lang={lang} />
                <ServiceReason candidate={candidate} runId={runId} provider={explanationProvider} lang={lang} inlineProposal={inlineProposal} />
                <div
                  style={{
                    display: 'flex',
                    gap: '7px',
                    alignItems: 'center',
                    padding: '7px 10px',
                    borderTop: '1px solid #e5e7eb',
                    background: '#f8fafc',
                  }}
                >
                  {isActive ? (
                    <span
                      style={{
                        fontSize: '0.78em',
                        padding: '2px 9px',
                        borderRadius: '999px',
                        background: '#1d4ed8',
                        color: '#fff',
                      }}
                    >
                      {t(LABELS.selected, lang)}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    data-testid={`choose-candidate-${candidate.candidate_id}`}
                    disabled={!backed || choosingId === candidate.candidate_id}
                    onClick={(e) => { e.stopPropagation(); onChoose(candidate.candidate_id) }}
                    style={{
                      fontSize: '0.8em',
                      fontWeight: 700,
                      padding: '5px 12px',
                      borderRadius: '7px',
                      border: '1px solid #1d4ed8',
                      background: !backed ? '#f1f5f9' : isActive ? '#fff' : '#1d4ed8',
                      color: !backed ? '#9ca3af' : isActive ? '#1d4ed8' : '#fff',
                      cursor: backed ? 'pointer' : 'not-allowed',
                    }}
                  >
                    {choosingId === candidate.candidate_id ? '…' : t(LABELS.choose, lang)}
                  </button>
                  {!backed && (
                    <span
                      data-testid={`out-of-scope-${candidate.candidate_id}`}
                      style={{ fontSize: '0.72em', color: '#9ca3af' }}
                    >
                      {supported ? t(LABELS.outOfScope, lang) : t(LABELS.notSupported, lang)}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </>
      )}
    </>
  )
}

// ── Shared inline styles ─────────────────────────────────────────────────────

const sectionLabelStyle: React.CSSProperties = {
  fontSize: '0.68em',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  fontWeight: 800,
  color: '#6b7280',
  margin: '16px 0 6px',
}

const eligibleTagRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '4px',
  margin: '0 0 8px',
}

const eligibleTagStyle: React.CSSProperties = {
  fontSize: '0.72em',
  padding: '1px 7px',
  borderRadius: '999px',
  background: '#f1f5f9',
  border: '1px solid #e2e8f0',
  color: '#475569',
  whiteSpace: 'nowrap',
}

