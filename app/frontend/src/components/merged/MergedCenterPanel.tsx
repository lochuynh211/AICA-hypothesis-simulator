/**
 * MergedCenterPanel — center-panel for the Combined Simulator (020 Task 9,
 * replacing the Task-6 stub). Uses `useMergedCoordinator()` directly (no
 * `runStore`/`proposalStore` import — 020 isolation constraint).
 *
 * Top-to-bottom:
 *   - Play/Pause/Step bar        — drives `coordinator.play()`/`pause()`/`step()`
 *   - ScoreTimeline               — fed by a minimal `TimelineData` built from
 *     `state.triggerTrace` (trigger-only view for slice 1: no road-segment
 *     geometry/rest markers, since the coordinator carries no route/
 *     alternatives state the way `useLiveTimelineData` reads off `runStore`)
 *   - a `position:relative` dock — mirrors `CenterPlaybackPanel`'s dock
 *     (lines 87-114): renders `<ServiceResultOverlay/>` or
 *     `<ContentResultOverlay/>` depending on which step's evidence is MOST
 *     RECENT in the append-only `state.proposalLog.evidence` list (slice-2
 *     verification fix — `activeServiceId == null` alone is not a reliable
 *     signal: the after-rest `recompute_proposal_run` unconditionally sets
 *     `journey_state.active_service_id` to the fresh rank-1 candidate
 *     without dispatching content, so a non-null `activeServiceId` can still
 *     mean "fresh service decision awaiting Choose"). Overlay PROPS are
 *     still derived from `state.proposalLog.evidence` (filter
 *     step==='service'|'content', take the latest) + `journey_state
 *     .active_service_id` — the same derivation
 *     `ServiceProposalPanel`/`ContentProposalPanel` do from `proposalStore`.
 */
import { useEffect, useState } from 'react'
import { useMergedCoordinator } from '../../state/mergedCoordinator'
import ScoreTimeline from '../playback/ScoreTimeline'
import type { TimelineData, TimelineFire, TimelinePoint } from '../playback/timelineData'
import type { TraceEntry, RecoveryOption, RestSpot } from '../../api/types'
import type { RankedCandidate, ExcludedCandidate, CompletePlan } from '../../api/proposalClient'
import { getScenario, getRestSpots } from '../../api/client'
import { ServiceResultOverlay } from './ServiceResultOverlay'
import { ContentResultOverlay } from './ContentResultOverlay'
import { t } from '../../i18n/t'

const LABELS = {
  algorithmError: { ja: 'アルゴリズムエラー', en: 'Algorithm error' },
}

const RECOVERY_LABELS = {
  title: { ja: '休憩を受け入れる', en: 'Accept rest' },
  option: { ja: '休憩オプション', en: 'Recovery option' },
  spot: { ja: '休憩場所', en: 'Rest spot' },
  minutes: { ja: '仮眠時間（分）', en: 'Sleep minutes' },
  accept: { ja: '休憩を受け入れる', en: 'Accept rest' },
  loadError: { ja: '休憩オプションの読み込みに失敗しました', en: 'Failed to load recovery options' },
}

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)

function restY(e: TraceEntry): number {
  return num(e.scores?.['rest_required_score']) ?? num(e.score) ?? 0
}
function fireKind(cat: string | null): 'rest' | 'monotony' {
  return (cat ?? '').startsWith('rest') ? 'rest' : 'monotony'
}

/** Minimal `TimelineData` built straight from the coordinator's
 * `triggerTrace` — mirrors `useLiveTimelineData`'s score/threshold/fire
 * derivation, but reads `TraceEntry.route_fraction` directly (always set by
 * `mergedCoordinator`'s `buildTraceEntry`) instead of `useRouteProgress`'s
 * scenario-geometry fallback, since the coordinator has no route/
 * alternatives state to derive segments/rest-dots from. A trigger-only view
 * (empty segments/restDots/recoveryWindows) is fine for slice 1 (brief). */
function buildTimelineData(trace: TraceEntry[]): TimelineData {
  const fracFor = (e: TraceEntry): number => (typeof e.route_fraction === 'number' ? e.route_fraction : 0)

  const restScore: TimelinePoint[] = trace.map((e) => ({ x: fracFor(e), y: restY(e) }))
  const monotonyScore: TimelinePoint[] = trace
    .filter((e) => num(e.scores?.['monotony_prevention_score']) != null)
    .map((e) => ({ x: fracFor(e), y: num(e.scores?.['monotony_prevention_score']) as number }))

  const last = trace.length > 0 ? trace[trace.length - 1] : null
  const restThreshold =
    num(last?.criteria?.['rest_required_threshold']) ??
    num(last?.criteria?.['threshold_suggest']) ??
    num(last?.criteria?.['threshold_fire']) ??
    null
  const monotonyThreshold = num(last?.criteria?.['monotony_suggest_threshold']) ?? null

  const fires: TimelineFire[] = []
  let active = false
  for (const e of trace) {
    const paused = e.proposal_paused === true
    if (paused && !active) fires.push({ x: fracFor(e), kind: fireKind(e.selected_category) })
    active = paused
  }

  return {
    segments: [],
    restScore,
    monotonyScore,
    restThreshold,
    monotonyThreshold,
    spikes: [],
    fires,
    restDots: [],
    recoveryWindows: [],
    completionX: null,
  }
}

export default function MergedCenterPanel() {
  const coordinator = useMergedCoordinator()
  const { state } = coordinator

  const timelineData = buildTimelineData(state.triggerTrace)
  const revealFraction = state.latestTrigger?.route_fraction ?? 0

  // Derive overlay props from state.proposalLog.evidence, the same way
  // ServiceProposalPanel/ContentProposalPanel derive them from proposalStore.
  const serviceEv = state.proposalLog?.evidence.filter((ev) => ev.step === 'service').slice(-1)[0]
  const serviceOutput = serviceEv?.output as
    | { decision_type: string; ranked_candidates: RankedCandidate[] }
    | undefined
  const serviceSnapshot = (serviceEv?.input_snapshot ?? {}) as {
    eligible_candidates?: { candidate_id: string }[]
    excluded_candidates?: ExcludedCandidate[]
  }
  const eligibleCandidates = serviceSnapshot.eligible_candidates ?? []
  const excludedCandidates = serviceSnapshot.excluded_candidates ?? []

  const contentEv = state.proposalLog?.evidence.filter((ev) => ev.step === 'content').slice(-1)[0]
  const contentPlan = contentEv?.output as CompletePlan | undefined

  const activeServiceId = state.proposalLog?.journey_state.active_service_id ?? null

  // Which overlay docks is decided by RECENCY, not `activeServiceId` —
  // `recompute_proposal_run` (the after-rest recompute) unconditionally sets
  // `journey_state.active_service_id` to the fresh rank-1 candidate AND
  // appends a new step='service' evidence entry, WITHOUT dispatching content
  // in interactive mode (proposal.py ~1687-1721). So right after an after-rest
  // recompute, `activeServiceId` is non-null but there is no content evidence
  // for it yet — keying off `activeServiceId == null` would wrongly dock the
  // (empty) ContentResultOverlay instead of the fresh ServiceResultOverlay.
  // `evidence` is append-only and ordered, so the step whose evidence is MOST
  // RECENT tells us which decision the reviewer is actually facing.
  const evidence = state.proposalLog?.evidence ?? []
  const lastServiceIdx = evidence.map((ev) => ev.step).lastIndexOf('service')
  const lastContentIdx = evidence.map((ev) => ev.step).lastIndexOf('content')
  const showContentOverlay = lastContentIdx > lastServiceIdx
  const showServiceOverlay = lastServiceIdx >= 0 && !showContentOverlay

  const hasRun = state.mergedRunId != null

  async function handleChoose(candidateId: string): Promise<void> {
    await coordinator.selectService(candidateId)
  }

  // ── Rest-accept affordance (slice-2 core Task 4) ──────────────────────────
  //
  // Shown once the CURRENT before-rest proposal is a rest opportunity
  // (opportunity.trigger_purpose === 'rest_recommended') that hasn't yet
  // advanced past before_rest_until_stop (journey_state.lifecycle_stage —
  // the LIVE stage tracker, unlike opportunity.lifecycle_stage which stays
  // frozen at 'before_rest_until_stop' for the opportunity's whole rest
  // journey) AND a service has been chosen (activeServiceId set) — mirrors
  // RecoveryPicker's own visibility guard, adapted to the coordinator's
  // proposalLog-derived state instead of runStore's latestDecision.
  const opportunity = state.proposalLog?.opportunity
  const journeyStage = state.proposalLog?.journey_state.lifecycle_stage
  const isBeforeRestOpportunity =
    opportunity?.trigger_purpose === 'rest_recommended' && journeyStage === 'before_rest_until_stop'
  const showRestAccept = isBeforeRestOpportunity && activeServiceId != null

  const [recoveryOptions, setRecoveryOptions] = useState<RecoveryOption[]>([])
  const [restSpots, setRestSpots] = useState<RestSpot[]>([])
  const [selectedOptionId, setSelectedOptionId] = useState('')
  const [selectedSpotId, setSelectedSpotId] = useState('')
  const [napMinutes, setNapMinutes] = useState('')
  const [restLoadError, setRestLoadError] = useState<string | null>(null)
  const [submittingRest, setSubmittingRest] = useState(false)

  useEffect(() => {
    if (!showRestAccept || !state.scenarioId || !state.triggerRunId) return
    let cancelled = false
    Promise.all([getScenario(state.scenarioId), getRestSpots(state.triggerRunId)])
      .then(([scenario, spotsResp]) => {
        if (cancelled) return
        // Exclude `postpone: true` options (e.g. uc01_fatigue_recovery_v0_1's
        // `{id:'postpone', stages:[]}`) — unlike RecoveryPicker (which routes
        // opt.postpone through a DIFFERENT action with no rest_spot,
        // RecoveryPicker.tsx:67-70), this panel's Accept-rest button ALWAYS
        // submits via coordinator.acceptRest -> POST accept-rest ->
        // run_manager.action(..., 'accept_rest', recovery_option_id, rest_spot).
        // A postpone option has no recovery stages, so that call would leave
        // motion stuck MOVING forever (the rest-journey auto-drive in
        // routers/merged_runs.py never sees a stopped transition to key off
        // of) while reporting success — review finding (slice-2 core Task 4).
        // Slice-2 core has no separate postpone/decline action for merged
        // runs, so these options simply aren't offered here yet.
        setRecoveryOptions((scenario.recovery_options ?? []).filter((opt) => !opt.postpone))
        setRestSpots(spotsResp.rest_spots)
      })
      .catch((err: unknown) => {
        if (!cancelled) setRestLoadError(err instanceof Error ? err.message : 'Failed to load recovery options')
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRestAccept, state.scenarioId, state.triggerRunId])

  async function handleAcceptRest(): Promise<void> {
    const spot = restSpots.find((s) => s.id === selectedSpotId)
    if (!selectedOptionId || !spot) return
    setSubmittingRest(true)
    try {
      await coordinator.acceptRest({
        recovery_option_id: selectedOptionId,
        rest_spot: spot,
        nap_minutes: napMinutes === '' ? null : Number(napMinutes),
      })
    } finally {
      setSubmittingRest(false)
    }
  }

  return (
    <div
      data-testid="merged-center-panel"
      style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '12px', minHeight: 0 }}
    >
      {/* Controls row: Play/Pause/Step */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <button
          type="button"
          data-testid="merged-play-button"
          disabled={!hasRun || state.running || state.completed}
          onClick={() => coordinator.play()}
        >
          Play
        </button>
        <button
          type="button"
          data-testid="merged-pause-button"
          disabled={!state.running}
          onClick={() => coordinator.pause()}
        >
          Pause
        </button>
        <button
          type="button"
          data-testid="merged-step-button"
          disabled={!hasRun || state.running || state.completed}
          onClick={() => coordinator.step()}
        >
          Step
        </button>
      </div>

      <ScoreTimeline data={timelineData} revealFraction={revealFraction} showPlayhead testIds={{ root: 'merged-timeline' }} />

      {state.error && (
        <p role="alert" style={{ color: '#dc2626', fontSize: '0.82em' }}>
          {state.error}
        </p>
      )}

      {/* Rest-accept affordance — RecoveryOption select + rest-spot select +
          sleep-minutes input + Accept-rest button (slice-2 core Task 4).
          Once accepted, the existing tick loop (Play) auto-drives the rest
          journey server-side; this affordance disappears on its own once
          journey_state.lifecycle_stage advances past before_rest_until_stop. */}
      {showRestAccept && (
        <div
          data-testid="rest-accept-panel"
          style={{
            flexShrink: 0,
            margin: '8px 0',
            padding: '10px 12px',
            border: '2px solid #5bc0be',
            borderRadius: '8px',
            background: '#f0fbff',
          }}
        >
          <p style={{ fontSize: '0.85em', fontWeight: 700, marginBottom: '8px' }}>
            {t(RECOVERY_LABELS.title, 'en')}
          </p>

          <label htmlFor="rest-accept-option-select" style={{ display: 'block', fontSize: '0.8em', marginBottom: '2px' }}>
            {t(RECOVERY_LABELS.option, 'en')}
          </label>
          <select
            id="rest-accept-option-select"
            data-testid="recovery-option-select"
            value={selectedOptionId}
            onChange={(e) => setSelectedOptionId(e.target.value)}
            disabled={recoveryOptions.length === 0}
          >
            <option value="" disabled>
              {recoveryOptions.length === 0 ? 'Loading…' : 'Select a recovery option'}
            </option>
            {recoveryOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {t(opt.label, 'en')}
              </option>
            ))}
          </select>

          <label htmlFor="rest-accept-spot-select" style={{ display: 'block', fontSize: '0.8em', margin: '8px 0 2px' }}>
            {t(RECOVERY_LABELS.spot, 'en')}
          </label>
          <select
            id="rest-accept-spot-select"
            data-testid="rest-spot-select"
            value={selectedSpotId}
            onChange={(e) => setSelectedSpotId(e.target.value)}
            disabled={restSpots.length === 0}
          >
            <option value="" disabled>
              {restSpots.length === 0 ? 'Loading…' : 'Select a rest spot'}
            </option>
            {restSpots.map((spot) => (
              <option key={spot.id} value={spot.id}>
                {t(spot.label, 'en')}
              </option>
            ))}
          </select>

          <label htmlFor="rest-accept-nap-minutes" style={{ display: 'block', fontSize: '0.8em', margin: '8px 0 2px' }}>
            {t(RECOVERY_LABELS.minutes, 'en')}
          </label>
          <input
            id="rest-accept-nap-minutes"
            data-testid="nap-minutes-input"
            type="number"
            min={0}
            value={napMinutes}
            onChange={(e) => setNapMinutes(e.target.value)}
          />

          {restLoadError && (
            <p role="alert" style={{ color: '#dc2626', fontSize: '0.82em' }}>
              {t(RECOVERY_LABELS.loadError, 'en')}: {restLoadError}
            </p>
          )}

          <div style={{ marginTop: '8px' }}>
            <button
              type="button"
              data-testid="accept-rest-button"
              disabled={submittingRest || !selectedOptionId || !selectedSpotId}
              onClick={() => void handleAcceptRest()}
            >
              {submittingRest ? '…' : t(RECOVERY_LABELS.accept, 'en')}
            </button>
          </div>
        </div>
      )}

      {/* Dock — mirrors CenterPlaybackPanel's proposal dock (lines 87-114). */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {showServiceOverlay && (
          <div data-testid="service-result-overlay" style={dockStyle}>
            <ServiceResultOverlay
              output={serviceOutput}
              eligibleCandidates={eligibleCandidates}
              excludedCandidates={excludedCandidates}
              activeServiceId={activeServiceId}
              choosingId={state.choosingId}
              onChoose={handleChoose}
              explanationProvider="off"
              lang="en"
            />
            {serviceEv?.error && (
              <p role="alert" style={{ color: '#dc2626', fontSize: '0.82em' }}>
                {t(LABELS.algorithmError, 'en')}: {serviceEv.error.message}
              </p>
            )}
          </div>
        )}

        {showContentOverlay && (
          <div data-testid="content-result-overlay" style={dockStyle}>
            <ContentResultOverlay
              plan={contentPlan}
              error={contentEv?.error ?? undefined}
              songNames={{}}
              explanationProvider="off"
              lang="en"
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Shared inline styles ─────────────────────────────────────────────────────

const dockStyle: React.CSSProperties = {
  position: 'absolute',
  left: '8px',
  right: '8px',
  bottom: '8px',
  zIndex: 15,
  maxHeight: '80%',
  overflowY: 'auto',
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: '10px',
  padding: '10px 12px',
  boxShadow: '0 4px 14px rgba(0,0,0,0.12)',
}
