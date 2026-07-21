/**
 * MergedProposalPanel — RIGHT panel of the Combined Simulator (owner layout,
 * feature 020): the proposal output, split TOP = Service / BOTTOM = Content.
 *
 * Shows EITHER the live proposal (`state.proposalLog`) OR — while a quickview
 * fire is being inspected (`state.inspectedFireIndex`, set by clicking a fire
 * in the center panel's projection) OR the purple "after-nap" journey dot is
 * inspected (`state.inspectedRestOptionIndex` → that rest's `after_rest_proposal`,
 * a rest_recommended / after_rest_before_restart / stopped projection) — the
 * ephemeral projected proposal, READ-ONLY. Both halves render together (no
 * recency either/or swap); the content half shows a placeholder until a content
 * plan exists (live: after Choose; read-only: when the projection produced no
 * content — e.g. an after-nap service the music content package can't serve).
 *
 * Coordinator-driven only (no runStore/proposalStore — 020 isolation): the
 * quickview click-to-inspect lives in the center panel; this panel reads the
 * resulting `inspectedFireIndex`/`proposalLog` off the shared coordinator.
 */
import { useEffect, useState } from 'react'
import { useMergedCoordinator } from '../../state/mergedCoordinator'
import type { RankedCandidate, ExcludedCandidate, CompletePlan, ProposalRunLog, EvidenceError } from '../../api/proposalClient'
import { getDatasetCatalog } from '../../api/proposalClient'
import { ServiceResultOverlay } from './ServiceResultOverlay'
import { ContentResultOverlay } from './ContentResultOverlay'
import { useProposalStore } from '../../state/proposalStore'
import { t } from '../../i18n/t'
import { useLanguage } from '../../state/language'

const LABELS = {
  algorithmError: { ja: 'アルゴリズムエラー', en: 'Algorithm error' },
  service: { ja: 'サービス提案', en: 'Service proposal' },
  content: { ja: 'コンテンツ提案', en: 'Content proposal' },
  inspecting: { ja: 'クイックビュー発火を確認中', en: 'Inspecting a quickview fire' },
  inspectingRest: { ja: '仮眠後の提案を確認中', en: 'Inspecting the after-nap projection' },
  close: { ja: '閉じる', en: 'Close' },
  awaitingLive: { ja: 'サービスを選ぶとコンテンツプランが表示されます。', en: 'Choose a service (top) to see its content plan.' },
  awaitingReadonly: { ja: 'この発火にはコンテンツプランがありません。', en: 'No content plan for this fire.' },
  empty: { ja: '発火するとここに提案が表示されます（またはクイックビューの発火をクリック）。', en: 'Proposals appear here on a trigger fire — or click a fire in the quickview.' },
  explanationSource: { ja: '説明の生成元', en: 'Explanation source' },
  explOff: { ja: 'オフ（既定テンプレート）', en: 'Off (template)' },
  explBackend: { ja: 'バックエンドLLM（Ollama）', en: 'Backend LLM (Ollama)' },
  explBrowser: { ja: 'ブラウザ（Gemini Nano）', en: 'Browser (Gemini Nano)' },
  triggerSignal: { ja: '発火シグナル', en: 'Trigger signal' },
  carState: { ja: '車両状態', en: 'Car status' },
  motion: { ja: '走行/停車', en: 'Motion' },
}

// Friendly bilingual labels — read-only status strip. Unlike WorldPanel (whose
// `en` column is deliberately the raw enum, used there as button captions), the
// `en` text here is a genuine human-readable label so the strip never shows a
// raw variable name. Unknown/future values fall back to the raw string below.
const TRIGGER_PURPOSE_LABELS: Record<string, { ja: string; en: string }> = {
  rest_recommended: { ja: '休憩推奨', en: 'Rest recommended' },
  inattentive_driving_prevention_recovery: { ja: '注意力低下防止・回復', en: 'Inattentive driving prevention & recovery' },
  route_music: { ja: 'ルート音楽', en: 'Route music' },
  child_passenger_experience: { ja: '子ども同乗体験', en: 'Child passenger experience' },
}
const LIFECYCLE_STAGE_LABELS: Record<string, { ja: string; en: string }> = {
  before_rest_until_stop: { ja: 'スポットへ向かう', en: 'Heading to spot' },
  during_rest_stopped: { ja: 'スポットで停車', en: 'Stopped at spot' },
  after_rest_before_restart: { ja: '休憩後・再開前', en: 'After spot' },
  active_driving_content: { ja: '走行中', en: 'Driving' },
}
const MOTION_STATE_LABELS: Record<string, { ja: string; en: string }> = {
  in_motion: { ja: '走行中', en: 'In motion' },
  moving: { ja: '走行中', en: 'Moving' },
  stopped: { ja: '停車中', en: 'Stopped' },
  parked: { ja: '駐車中', en: 'Parked' },
  idle: { ja: 'アイドリング', en: 'Idle' },
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
  const { lang } = useLanguage()
  // Read the SETUP world for the read-only status strip before a run/fire exists,
  // and the shared explanation-source preference (feature 019) — same scoped-store
  // precedent MergedCenterPanel already relies on.
  const { state: ps, dispatch: psDispatch } = useProposalStore()

  // item_id → song display name, so the content plan shows "Name (id)" like the
  // Proposal screen (issue #3). Fetched from the world's dataset catalog.
  const datasetId = ps.world?.catalog_ref?.dataset_id
  const [songNames, setSongNames] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!datasetId) {
      setSongNames({})
      return
    }
    let cancelled = false
    getDatasetCatalog(datasetId)
      .then((resp) => {
        if (cancelled) return
        const map: Record<string, string> = {}
        for (const song of resp.songs) map[song.spotify_track.id] = song.spotify_track.name
        setSongNames(map)
      })
      .catch(() => {
        if (!cancelled) setSongNames({})
      })
    return () => {
      cancelled = true
    }
  }, [datasetId])

  const inspectedFire =
    state.inspectedFireIndex != null ? (state.quickviewResult?.fires[state.inspectedFireIndex] ?? null) : null
  // The clickable purple after-nap dots (restDots in timelineData) are
  // rest_options FILTERED to those that actually recovered (recovery_from_min
  // set) — the SAME predicate under which the backend attaches after_rest_proposal
  // — so the click index must resolve through the identical filtered subset, not
  // the raw rest_options array (which may include a never-recovered tail entry).
  const inspectableRestOptions = (state.quickviewResult?.rest_options ?? []).filter(
    (o) => o.recovery_from_min != null,
  )
  const inspectedRestOption =
    state.inspectedRestOptionIndex != null
      ? (inspectableRestOptions[state.inspectedRestOptionIndex] ?? null)
      : null

  // ONE inspected proposal, from EITHER a fire dot OR the purple after-nap
  // journey dot — mutually exclusive in the coordinator. The fire proposal stays
  // read-only; the after-nap proposal is the quick_check projection
  // (rest_recommended / after_rest_before_restart / stopped) whose Choose IS
  // interactive — picking a service re-projects its content into
  // `state.afterRestOverride` (shown in place of the default rank-1 projection).
  const isInspectingFire = inspectedFire != null
  const isInspectingRest = inspectedRestOption != null
  const isInspecting = isInspectingFire || isInspectingRest
  // The base after-nap proposal (default rank-1) — always the re-projection SOURCE
  // (its recovered `world`), even after an override swaps what's displayed.
  const baseRestProposal = inspectedRestOption?.after_rest_proposal ?? null
  const inspectedProposal = isInspectingFire
    ? inspectedFire!.proposal
    : isInspectingRest
      ? (state.afterRestOverride ?? baseRestProposal)
      : null
  const inspectedProposalError = isInspectingFire
    ? inspectedFire!.proposal_error
    : (inspectedRestOption?.after_rest_proposal_error ?? null)

  const overlay = deriveProposalOverlay(isInspecting ? inspectedProposal : state.proposalLog)
  // Fire inspection is read-only; after-nap inspection + the live dock both use
  // the coordinator's `choosingId` (its Choose dispatches a real call).
  const choosingId = isInspectingFire ? null : state.choosingId
  const onChoose = isInspectingFire
    ? noopChoose
    : isInspectingRest
      ? (candidateId: string) => {
          if (baseRestProposal) void coordinator.chooseAfterRestService(candidateId, baseRestProposal)
        }
      : (candidateId: string) => void coordinator.selectService(candidateId)

  const hasContent = overlay.contentPlan != null || overlay.contentError != null

  // Lazy-explanation wiring (feature 019 + 020). The displayed proposal's run_id
  // is the stable cache key. A LIVE (persisted) proposal uses the run-id explain
  // endpoint; an inspected EPHEMERAL projection (quickview / after-nap, built with
  // cache={} and never written to proposal_runs/) is explained INLINE — the panel
  // posts the whole projected proposal back to /api/merged-runs/explain — so the
  // LLM reason works for inspections too, not just the live run.
  const explanationProvider = ps.explanationProvider
  const displayedProposal = isInspecting ? inspectedProposal : state.proposalLog
  const explanationRunId = displayedProposal?.run_id ?? undefined
  const explanationInlineProposal = isInspecting ? inspectedProposal : undefined

  // Read-only trigger signal + car status (owner review): the LIVE proposal /
  // inspected fire / inspected after-rest projection when present, else the
  // setup world.
  const statusSource = isInspecting ? inspectedProposal : state.proposalLog
  const triggerPurpose = statusSource?.opportunity?.trigger_purpose ?? ps.world.control_inputs.trigger_purpose
  const lifecycleStage = statusSource?.journey_state?.lifecycle_stage ?? ps.world.control_inputs.lifecycle_stage
  const motionState = statusSource?.journey_state?.motion_state ?? ps.world.control_inputs.motion_state

  return (
    <div data-testid="merged-proposal-panel" style={panelStyle}>
      {/* Read-only trigger signal + car status (like the Proposal screen). */}
      <div data-testid="merged-status-strip" style={statusStripStyle}>
        <span>
          <span style={statusLabelStyle}>{t(LABELS.triggerSignal, lang)}:</span>{' '}
          <span data-testid="merged-status-trigger" style={statusValueStyle}>
            {t(TRIGGER_PURPOSE_LABELS[triggerPurpose] ?? { ja: triggerPurpose, en: triggerPurpose }, lang)}
          </span>
        </span>
        <span>
          <span style={statusLabelStyle}>{t(LABELS.carState, lang)}:</span>{' '}
          <span data-testid="merged-status-lifecycle" style={statusValueStyle}>
            {t(LIFECYCLE_STAGE_LABELS[lifecycleStage] ?? { ja: lifecycleStage, en: lifecycleStage }, lang)}
          </span>
          <span style={{ color: '#94a3b8' }}> · {t(LABELS.motion, lang)} </span>
          <span data-testid="merged-status-motion" style={statusValueStyle}>
            {t(MOTION_STATE_LABELS[motionState] ?? { ja: motionState, en: motionState }, lang)}
          </span>
        </span>
      </div>

      {/* Explanation source (feature 019) — drives lazy LLM rationale for BOTH
          service and content reasons, same as the Proposal screen. */}
      <label style={explSelectStyle}>
        <span style={statusLabelStyle}>{t(LABELS.explanationSource, lang)}</span>
        <select
          data-testid="merged-explanation-provider-select"
          value={explanationProvider}
          onChange={(e) =>
            psDispatch({
              type: 'SET_EXPLANATION_PROVIDER',
              provider: e.target.value as 'off' | 'backend' | 'browser',
            })
          }
          style={{ fontSize: '0.82em', padding: '3px' }}
        >
          <option value="off">{t(LABELS.explOff, lang)}</option>
          <option value="backend">{t(LABELS.explBackend, lang)}</option>
          <option value="browser">{t(LABELS.explBrowser, lang)}</option>
        </select>
      </label>

      {isInspecting && (
        <div data-testid="inspected-fire-readonly-badge" style={readonlyBadgeStyle}>
          <span>{t(isInspectingRest ? LABELS.inspectingRest : LABELS.inspecting, lang)}</span>
          <button
            type="button"
            data-testid="quickview-inspect-close"
            onClick={() => coordinator.inspectFire(null)}
            style={{ marginLeft: '8px', fontSize: '0.85em' }}
          >
            {t(LABELS.close, lang)}
          </button>
        </div>
      )}
      {isInspecting && inspectedProposalError && (
        <p role="alert" style={{ color: '#dc2626', fontSize: '0.82em' }}>
          {inspectedProposalError}
        </p>
      )}

      {!overlay.hasService ? (
        <p data-testid="merged-proposal-empty" style={{ fontSize: '0.82em', color: '#94a3b8', fontStyle: 'italic', padding: '10px' }}>
          {t(LABELS.empty, lang)}
        </p>
      ) : (
        <>
          {/* TOP half — Service proposal */}
          <div data-testid="service-result-overlay" style={halfStyle}>
            <p style={halfTitleStyle}>① {t(LABELS.service, lang)}</p>
            <ServiceResultOverlay
              output={overlay.serviceOutput}
              eligibleCandidates={overlay.eligibleCandidates}
              excludedCandidates={overlay.excludedCandidates}
              activeServiceId={overlay.activeServiceId}
              choosingId={choosingId}
              onChoose={onChoose}
              runId={explanationRunId}
              explanationProvider={explanationProvider}
              inlineProposal={explanationInlineProposal}
              lang={lang}
            />
            {overlay.serviceError && (
              <p role="alert" style={{ color: '#dc2626', fontSize: '0.82em' }}>
                {t(LABELS.algorithmError, lang)}: {overlay.serviceError.message}
              </p>
            )}
          </div>

          {/* BOTTOM half — Content proposal */}
          <div style={{ ...halfStyle, borderTop: '2px solid #e5e7eb' }}>
            <p style={halfTitleStyle}>② {t(LABELS.content, lang)}</p>
            {hasContent ? (
              <div data-testid="content-result-overlay">
                <ContentResultOverlay
                  plan={overlay.contentPlan}
                  error={overlay.contentError ?? undefined}
                  songNames={songNames}
                  runId={explanationRunId}
                  explanationProvider={explanationProvider}
                  inlineProposal={explanationInlineProposal}
                  lang={lang}
                />
              </div>
            ) : (
              <p data-testid="content-awaiting" style={{ fontSize: '0.82em', color: '#94a3b8', fontStyle: 'italic' }}>
                {t(isInspecting ? LABELS.awaitingReadonly : LABELS.awaitingLive, lang)}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── Inline styles ────────────────────────────────────────────────────────────

const statusStripStyle: React.CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  flexWrap: 'wrap',
  gap: '4px 14px',
  fontSize: '0.78em',
  color: '#334155',
  background: '#f1f5f9',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  padding: '6px 10px',
}
const statusLabelStyle: React.CSSProperties = {
  fontSize: '0.9em',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  color: '#64748b',
}
const statusValueStyle: React.CSSProperties = { fontWeight: 600, color: '#1d4ed8' }
const explSelectStyle: React.CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '0.78em',
  color: '#334155',
}

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
