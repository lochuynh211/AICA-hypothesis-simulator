/**
 * ServiceResultOverlay (020 Task 10) — the docked STEP-1 result view for the
 * Combined Simulator: eligible/excluded candidate lists + ranked candidate
 * cards (score, ReasonBreakdown, ServiceExplainability, Choose). Extracted
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
import { fitBand } from '../../lib/fitBand'
import type { RankedCandidate, ExcludedCandidate } from '../../api/proposalClient'
import ReasonBreakdown, { type ReasonRow } from '../proposal/ReasonBreakdown'
import ServiceExplainability, { hasFeatureTrace } from '../proposal/ServiceExplainability'
import { useExplanation, type ExplanationProvider } from '../proposal/useExplanation'

const LABELS = {
  recommended: { ja: '推奨サービス（最大3件）', en: 'Recommended (≤3)' },
  choose: { ja: 'これを選ぶ', en: 'Choose' },
  selected: { ja: '選択中 → STEP 2 へ', en: 'Selected → to STEP 2' },
  noProposal: { ja: '候補なし（no_proposal）', en: 'No candidates (no_proposal)' },
  fitBand: { ja: '適合', en: 'fit' },
  fitBandTitle: {
    ja: '0〜100の目安スコア = (raw + 1) × 50。生スコアの表示用変換であり、判定には使用しません。',
    en: 'A friendlier 0-100 band = (raw + 1) × 50. A display transform of the raw score only — never used in scoring.',
  },
  outOfScope: { ja: 'V1対象外', en: 'Out of V1 scope' },
  eligibleTitle: { ja: '適格サービス', en: 'Eligible services' },
  excludedTitle: { ja: '除外サービス（理由コード）', en: 'Excluded services (reason codes)' },
  noneExcluded: { ja: 'なし', en: 'None' },
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
}: {
  candidate: RankedCandidate
  runId: string | undefined
  provider: ExplanationProvider
  lang: 'ja' | 'en'
}) {
  const { ai, request } = useExplanation(runId, 'service', candidate.candidate_id, provider, lang)
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
  excludedCandidates: ExcludedCandidate[]
  activeServiceId: string | null
  choosingId: string | null
  onChoose: (candidateId: string) => void
  /** Content-backed gate (Task 5's Choose scope-gate): a candidate whose
   * content package can't actually serve it gets a disabled Choose button +
   * an "out of V1 scope" note. Defaults to always-backed (every candidate
   * choosable) when the caller doesn't need the gate. */
  isBacked?: (candidateId: string) => boolean
  runId?: string
  explanationProvider: ExplanationProvider
  lang: 'ja' | 'en'
}) {
  const {
    output,
    eligibleCandidates,
    excludedCandidates,
    activeServiceId,
    choosingId,
    onChoose,
    isBacked = () => true,
    runId,
    explanationProvider,
    lang,
  } = props

  return (
    <>
      <div style={sectionLabelStyle}>{t(LABELS.eligibleTitle, lang)}</div>
      <ul data-testid="eligible-list" style={eligibilityListStyle}>
        {eligibleCandidates.map(({ candidate_id }) => (
          <li key={candidate_id} data-testid={`eligible-${candidate_id}`}>
            {candidate_id}
          </li>
        ))}
      </ul>

      <div style={sectionLabelStyle}>{t(LABELS.excludedTitle, lang)}</div>
      {excludedCandidates.length === 0 ? (
        <p style={{ fontSize: '0.82em', color: '#6b7280' }}>{t(LABELS.noneExcluded, lang)}</p>
      ) : (
        <ul data-testid="excluded-list" style={eligibilityListStyle}>
          {excludedCandidates.map((excluded) => (
            <li key={excluded.candidate_id} data-testid={`excluded-${excluded.candidate_id}`}>
              {excluded.candidate_id} — <code>{excluded.platform_reason}</code>
            </li>
          ))}
        </ul>
      )}

      {output && (
        <>
          <div style={sectionLabelStyle}>{t(LABELS.recommended, lang)}</div>
          {output.decision_type === 'no_proposal' && (
            <p style={{ fontSize: '0.82em', color: '#6b7280' }}>{t(LABELS.noProposal, lang)}</p>
          )}
          {output.ranked_candidates.slice(0, 3).map((candidate) => {
            const isActive = candidate.candidate_id === activeServiceId
            const backed = isBacked(candidate.candidate_id)
            return (
              <div
                key={candidate.candidate_id}
                data-testid={`candidate-card-${candidate.candidate_id}`}
                style={{
                  border: isActive ? '1px solid #1d4ed8' : '1px solid #e5e7eb',
                  borderRadius: '9px',
                  margin: '8px 0',
                  overflow: 'hidden',
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
                  <span style={{ fontWeight: 700, fontSize: '0.86em' }}>{candidate.candidate_id}</span>
                  {candidate.score !== null && (
                    <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontWeight: 800, color: '#1d4ed8' }}>
                      {candidate.score >= 0 ? '+' : ''}
                      {candidate.score.toFixed(3)}
                    </span>
                  )}
                  {candidate.score !== null && (
                    <span
                      data-testid={`fit-band-${candidate.candidate_id}`}
                      title={t(LABELS.fitBandTitle, lang)}
                      style={fitBandBadgeStyle}
                    >
                      {t(LABELS.fitBand, lang)} {Math.round(fitBand(candidate.score))}/100
                    </span>
                  )}
                </div>
                <ServiceReason candidate={candidate} runId={runId} provider={explanationProvider} lang={lang} />
                <ServiceExplainability candidate={candidate} lang={lang} />
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
                    onClick={() => onChoose(candidate.candidate_id)}
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
                      {t(LABELS.outOfScope, lang)}
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

const eligibilityListStyle: React.CSSProperties = {
  margin: '0 0 8px',
  padding: '0 0 0 18px',
  fontSize: '0.82em',
  color: '#4b5563',
}

// feature 018 (US4) — the friendlier 0-100 fit-band badge, rendered next to
// (never instead of) the raw score.
const fitBandBadgeStyle: React.CSSProperties = {
  fontSize: '0.68em',
  fontWeight: 700,
  color: '#1d4ed8',
  background: '#eef2ff',
  border: '1px solid #c7d2fe',
  borderRadius: '999px',
  padding: '2px 8px',
  fontFamily: 'monospace',
}
