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
 *     (lines 87-114): renders `<ServiceResultOverlay/>` once
 *     `state.proposalLog` has service evidence and no service is chosen yet,
 *     else `<ContentResultOverlay/>` once a service IS chosen. Overlay props
 *     are derived from `state.proposalLog.evidence` (filter
 *     step==='service'|'content', take the latest) + `journey_state
 *     .active_service_id` — the same derivation
 *     `ServiceProposalPanel`/`ContentProposalPanel` do from `proposalStore`.
 */
import { useMergedCoordinator } from '../../state/mergedCoordinator'
import ScoreTimeline from '../playback/ScoreTimeline'
import type { TimelineData, TimelineFire, TimelinePoint } from '../playback/timelineData'
import type { TraceEntry } from '../../api/types'
import type { RankedCandidate, ExcludedCandidate, CompletePlan } from '../../api/proposalClient'
import { ServiceResultOverlay } from './ServiceResultOverlay'
import { ContentResultOverlay } from './ContentResultOverlay'

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
  const showServiceOverlay = serviceEv != null && activeServiceId == null
  const showContentOverlay = !showServiceOverlay && activeServiceId != null

  const hasRun = state.mergedRunId != null

  async function handleChoose(candidateId: string): Promise<void> {
    await coordinator.selectService(candidateId)
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

      {/* Dock — mirrors CenterPlaybackPanel's proposal dock (lines 87-114). */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {showServiceOverlay && (
          <div data-testid="service-result-overlay" style={dockStyle}>
            <ServiceResultOverlay
              output={serviceOutput}
              eligibleCandidates={eligibleCandidates}
              excludedCandidates={excludedCandidates}
              activeServiceId={activeServiceId}
              choosingId={null}
              onChoose={handleChoose}
              explanationProvider="off"
              lang="en"
            />
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
