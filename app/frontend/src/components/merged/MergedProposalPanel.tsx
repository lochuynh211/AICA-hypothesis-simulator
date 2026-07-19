/**
 * MergedProposalPanel — RIGHT panel of the Combined Simulator (owner layout,
 * feature 020): the proposal output, split TOP = Service / BOTTOM = Content.
 *
 * Shows EITHER the live proposal (`state.proposalLog`) OR — while a quickview
 * fire is being inspected (`state.inspectedFireIndex`, set by clicking a fire
 * in the center panel's projection) — that fire's ephemeral projected proposal,
 * READ-ONLY. Both halves render together (no recency either/or swap); the
 * content half shows a placeholder until a content plan exists (live: after
 * Choose; read-only: when the fire projected no content).
 *
 * Coordinator-driven only (no runStore/proposalStore — 020 isolation): the
 * quickview click-to-inspect lives in the center panel; this panel reads the
 * resulting `inspectedFireIndex`/`proposalLog` off the shared coordinator.
 */
import { useMergedCoordinator } from '../../state/mergedCoordinator'
import type { RankedCandidate, ExcludedCandidate, CompletePlan, ProposalRunLog, EvidenceError } from '../../api/proposalClient'
import { ServiceResultOverlay } from './ServiceResultOverlay'
import { ContentResultOverlay } from './ContentResultOverlay'
import { t } from '../../i18n/t'

const LABELS = {
  algorithmError: { ja: 'アルゴリズムエラー', en: 'Algorithm error' },
  service: { ja: 'サービス提案', en: 'Service proposal' },
  content: { ja: 'コンテンツ提案', en: 'Content proposal' },
  inspecting: { ja: 'クイックビュー発火を確認中', en: 'Inspecting a quickview fire' },
  close: { ja: '閉じる', en: 'Close' },
  awaitingLive: { ja: 'サービスを選ぶとコンテンツプランが表示されます。', en: 'Choose a service (top) to see its content plan.' },
  awaitingReadonly: { ja: 'この発火にはコンテンツプランがありません。', en: 'No content plan for this fire.' },
  empty: { ja: '発火するとここに提案が表示されます（またはクイックビューの発火をクリック）。', en: 'Proposals appear here on a trigger fire — or click a fire in the quickview.' },
}

type ProposalOverlayDerivation = {
  hasService: boolean
  serviceOutput: { decision_type: string; ranked_candidates: RankedCandidate[] } | undefined
  eligibleCandidates: { candidate_id: string }[]
  excludedCandidates: ExcludedCandidate[]
  serviceError: EvidenceError | null | undefined
  contentPlan: CompletePlan | undefined
  contentError: EvidenceError | null | undefined
  activeServiceId: string | null
}

/** Derive service+content overlay props from a proposal log. Both are surfaced
 * together; content is gated on opportunity freshness (an after-rest recompute
 * appends fresh SERVICE evidence for a NEW opportunity while the prior
 * opportunity's content evidence still sits last in the array). */
export function deriveProposalOverlay(proposalLog: ProposalRunLog | null): ProposalOverlayDerivation {
  const serviceEv = proposalLog?.evidence.filter((ev) => ev.step === 'service').slice(-1)[0]
  const serviceOutput = serviceEv?.output as
    | { decision_type: string; ranked_candidates: RankedCandidate[] }
    | undefined
  const serviceSnapshot = (serviceEv?.input_snapshot ?? {}) as {
    eligible_candidates?: { candidate_id: string }[]
    excluded_candidates?: ExcludedCandidate[]
  }
  const contentEv = proposalLog?.evidence.filter((ev) => ev.step === 'content').slice(-1)[0]

  const currentOppId = proposalLog?.opportunity?.opportunity_id
  const contentOppId = (contentEv?.input_snapshot as { opportunity_id?: string } | undefined)?.opportunity_id
  const contentFresh = contentEv != null && (contentOppId == null || contentOppId === currentOppId)

  return {
    hasService: serviceEv != null,
    serviceOutput,
    eligibleCandidates: serviceSnapshot.eligible_candidates ?? [],
    excludedCandidates: serviceSnapshot.excluded_candidates ?? [],
    serviceError: serviceEv?.error,
    contentPlan: contentFresh ? (contentEv?.output as CompletePlan | undefined) : undefined,
    contentError: contentFresh ? contentEv?.error : undefined,
    activeServiceId: proposalLog?.journey_state.active_service_id ?? null,
  }
}

/** Read-only Choose no-op for an inspected (ephemeral) quickview proposal. */
function noopChoose(): void {
  /* read-only */
}

export default function MergedProposalPanel() {
  const coordinator = useMergedCoordinator()
  const { state } = coordinator

  const inspectedFire =
    state.inspectedFireIndex != null ? (state.quickviewResult?.fires[state.inspectedFireIndex] ?? null) : null
  const isInspectingFire = inspectedFire != null

  const overlay = deriveProposalOverlay(isInspectingFire ? inspectedFire.proposal : state.proposalLog)
  const choosingId = isInspectingFire ? null : state.choosingId
  const onChoose = isInspectingFire
    ? noopChoose
    : (candidateId: string) => void coordinator.selectService(candidateId)

  const hasContent = overlay.contentPlan != null || overlay.contentError != null

  return (
    <div data-testid="merged-proposal-panel" style={panelStyle}>
      {isInspectingFire && (
        <div data-testid="inspected-fire-readonly-badge" style={readonlyBadgeStyle}>
          <span>{t(LABELS.inspecting, 'en')}</span>
          <button
            type="button"
            data-testid="quickview-inspect-close"
            onClick={() => coordinator.inspectFire(null)}
            style={{ marginLeft: '8px', fontSize: '0.85em' }}
          >
            {t(LABELS.close, 'en')}
          </button>
        </div>
      )}
      {isInspectingFire && inspectedFire.proposal_error && (
        <p role="alert" style={{ color: '#dc2626', fontSize: '0.82em' }}>
          {inspectedFire.proposal_error}
        </p>
      )}

      {!overlay.hasService ? (
        <p data-testid="merged-proposal-empty" style={{ fontSize: '0.82em', color: '#94a3b8', fontStyle: 'italic', padding: '10px' }}>
          {t(LABELS.empty, 'en')}
        </p>
      ) : (
        <>
          {/* TOP half — Service proposal */}
          <div data-testid="service-result-overlay" style={halfStyle}>
            <p style={halfTitleStyle}>① {t(LABELS.service, 'en')}</p>
            <ServiceResultOverlay
              output={overlay.serviceOutput}
              eligibleCandidates={overlay.eligibleCandidates}
              excludedCandidates={overlay.excludedCandidates}
              activeServiceId={overlay.activeServiceId}
              choosingId={choosingId}
              onChoose={onChoose}
              explanationProvider="off"
              lang="en"
            />
            {overlay.serviceError && (
              <p role="alert" style={{ color: '#dc2626', fontSize: '0.82em' }}>
                {t(LABELS.algorithmError, 'en')}: {overlay.serviceError.message}
              </p>
            )}
          </div>

          {/* BOTTOM half — Content proposal */}
          <div style={{ ...halfStyle, borderTop: '2px solid #e5e7eb' }}>
            <p style={halfTitleStyle}>② {t(LABELS.content, 'en')}</p>
            {hasContent ? (
              <div data-testid="content-result-overlay">
                <ContentResultOverlay
                  plan={overlay.contentPlan}
                  error={overlay.contentError ?? undefined}
                  songNames={{}}
                  explanationProvider="off"
                  lang="en"
                />
              </div>
            ) : (
              <p data-testid="content-awaiting" style={{ fontSize: '0.82em', color: '#94a3b8', fontStyle: 'italic' }}>
                {t(isInspectingFire ? LABELS.awaitingReadonly : LABELS.awaitingLive, 'en')}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── Inline styles ────────────────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
  overflowY: 'auto',
  padding: '10px',
  gap: '6px',
}

const halfStyle: React.CSSProperties = {
  flex: '1 1 50%',
  minHeight: 0,
  overflowY: 'auto',
  paddingTop: '8px',
}

const halfTitleStyle: React.CSSProperties = {
  fontSize: '0.72em',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: '#1d4ed8',
  margin: '0 0 6px',
}

const readonlyBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontSize: '0.72em',
  fontWeight: 700,
  color: '#92400e',
  background: '#fffbeb',
  border: '1px solid #fde68a',
  borderRadius: '999px',
  padding: '3px 10px',
  flexShrink: 0,
}
