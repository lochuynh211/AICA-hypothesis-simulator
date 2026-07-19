/**
 * MergedCenterPanel — CENTER panel of the Combined Simulator (owner layout,
 * feature 020). Uses `useMergedCoordinator()` for the run loop + the SCOPED
 * `runStore` (via the zero-prop `<MapSurface/>`) for the route map.
 *
 * Top-to-bottom:
 *   1. QUICKVIEW PROJECTION — persistent ephemeral preview (legend + jam
 *      sub-bar + journey markers); click a fire to inspect it (right panel).
 *   2. Play/Continue · Pause · Step · Reset controls.
 *   3. ANIMATION — the SAME quickview timeline (so it's identical) with only a
 *      moving playhead (driven by a TICK fraction, so the live playhead aligns
 *      with the projection's time-axis geometry). No legend (the quickview has
 *      one right above).
 *   4. GOOGLE MAP — `<MapSurface/>` with the live car + decision/rest markers,
 *      and the on-map REST overlay (rest message + spot options w/ distance +
 *      Reject). Choose a spot → auto-select service+content (rank-1) and PAUSE
 *      until Continue; Reject → keep ticking.
 */
import { useEffect, useState } from 'react'
import { useMergedCoordinator } from '../../state/mergedCoordinator'
import ScoreTimeline from '../playback/ScoreTimeline'
import { mergedInstantResultToTimeline, type TimelineData, type TimelineFire, type TimelinePoint } from '../playback/timelineData'
import type { TraceEntry, RecoveryOption, RestSpot } from '../../api/types'
import { getScenario, getRestSpots } from '../../api/client'
import MapSurface from '../map/MapSurface'
import { t } from '../../i18n/t'

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

const LABELS = {
  title: { ja: 'クイックビュー・プロジェクション', en: 'Quickview projection' },
  hint: { ja: '発火をクリックして提案を確認（右パネル）', en: 'Click a fire to inspect its proposal (right panel)' },
  animation: { ja: 'ライブ再生', en: 'Live playback' },
  map: { ja: 'ルートマップ', en: 'Route map' },
  restTitle: { ja: '休憩推奨', en: 'Rest recommended' },
  restPrompt: { ja: '休憩スポットを選ぶ、または拒否して走行を続けます。', en: 'Choose a rest spot, or reject to keep driving.' },
  reject: { ja: '拒否して走行継続', en: 'Reject — keep driving' },
  tooFar: { ja: '遠すぎる', en: 'too far' },
  restAccepted: { ja: '休憩を受け入れました。提案（右）を確認して「続行」を押してください。', en: 'Rest accepted — inspect the proposal (right), then press Continue.' },
  loadError: { ja: '休憩スポットの読み込みに失敗しました', en: 'Failed to load rest spots' },
}

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)

function restY(e: TraceEntry): number {
  return num(e.scores?.['rest_required_score']) ?? num(e.score) ?? 0
}
function fireKind(cat: string | null): 'rest' | 'monotony' {
  return (cat ?? '').startsWith('rest') ? 'rest' : 'monotony'
}

/** Bare trace-only `TimelineData` — used only as the fallback before any
 * quickview projection exists (once it does, the animation reuses it verbatim). */
function buildTimelineData(trace: TraceEntry[]): TimelineData {
  const fracFor = (e: TraceEntry): number => (typeof e.route_fraction === 'number' ? e.route_fraction : 0)
  const restScore: TimelinePoint[] = trace.map((e) => ({ x: fracFor(e), y: restY(e) }))
  const monotonyScore: TimelinePoint[] = trace
    .filter((e) => num(e.scores?.['monotony_prevention_score']) != null)
    .map((e) => ({ x: fracFor(e), y: num(e.scores?.['monotony_prevention_score']) as number }))
  const last = trace.length > 0 ? trace[trace.length - 1] : null
  const restThreshold =
    num(last?.criteria?.['rest_required_threshold']) ?? num(last?.criteria?.['threshold_suggest']) ?? num(last?.criteria?.['threshold_fire']) ?? null
  const monotonyThreshold = num(last?.criteria?.['monotony_suggest_threshold']) ?? null
  const fires: TimelineFire[] = []
  let active = false
  for (const e of trace) {
    const paused = e.proposal_paused === true
    if (paused && !active) fires.push({ x: fracFor(e), kind: fireKind(e.selected_category) })
    active = paused
  }
  return {
    segments: [], trafficJams: [], restScore, monotonyScore, restThreshold, monotonyThreshold,
    spikes: [], fires, restDots: [], recoveryWindows: [], completionX: null,
  }
}

export default function MergedCenterPanel() {
  const coordinator = useMergedCoordinator()
  const { state } = coordinator

  // The quickview projection powers BOTH the top strip AND the live animation
  // (owner review: they must be identical). The animation only differs by a
  // moving playhead driven off the live tick index on the SAME time axis.
  const quickviewTimeline = state.quickviewResult ? mergedInstantResultToTimeline(state.quickviewResult) : null
  const tickMax = state.quickviewResult
    ? Math.max(1, ...state.quickviewResult.score_series.map((p) => p.t), ...(state.quickviewResult.monotony_series ?? []).map((p) => p.t))
    : 1
  const liveTimeline = quickviewTimeline ?? buildTimelineData(state.triggerTrace)
  const liveTickIndex = state.latestTrigger?.tick_index ?? 0
  const revealFraction = quickviewTimeline ? clamp01(liveTickIndex / tickMax) : state.latestTrigger?.route_fraction ?? 0

  const hasQuickview = state.quickviewResult != null
  const hasRun = state.mergedRunId != null

  // Decision (fire) positions + accepted rest spots for the map markers (the
  // merged run has no runStore trace/restHistory).
  const decisionFractions = state.triggerTrace
    .filter((e) => e.proposal_paused === true)
    .map((e) => (typeof e.route_fraction === 'number' ? e.route_fraction : 0))

  // ── Rest overlay (on the map) ─────────────────────────────────────────────
  const opportunity = state.proposalLog?.opportunity
  const journeyStage = state.proposalLog?.journey_state.lifecycle_stage
  const isBeforeRestOpportunity =
    opportunity?.trigger_purpose === 'rest_recommended' && journeyStage === 'before_rest_until_stop'
  const liveActiveServiceId = state.proposalLog?.journey_state.active_service_id ?? null
  const showRestAccept = isBeforeRestOpportunity && liveActiveServiceId != null

  const [recoveryOptions, setRecoveryOptions] = useState<RecoveryOption[]>([])
  const [restSpots, setRestSpots] = useState<RestSpot[]>([])
  const [restLoadError, setRestLoadError] = useState<string | null>(null)
  const [submittingRest, setSubmittingRest] = useState(false)
  // The opportunity_id whose rest decision (accept/reject) is already made — so
  // the choose/reject overlay hides after the reviewer decides, per opportunity.
  const [resolvedOpportunityId, setResolvedOpportunityId] = useState<string | null>(null)

  const restDecided = opportunity?.opportunity_id != null && opportunity.opportunity_id === resolvedOpportunityId
  const showRestOverlay = showRestAccept && !restDecided

  useEffect(() => {
    if (!showRestAccept || !state.scenarioId || !state.triggerRunId) return
    let cancelled = false
    Promise.all([getScenario(state.scenarioId), getRestSpots(state.triggerRunId)])
      .then(([scenario, spotsResp]) => {
        if (cancelled) return
        setRecoveryOptions((scenario.recovery_options ?? []).filter((opt) => !opt.postpone))
        setRestSpots(spotsResp.rest_spots)
      })
      .catch((err: unknown) => {
        if (!cancelled) setRestLoadError(err instanceof Error ? err.message : 'Failed to load rest spots')
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRestAccept, state.scenarioId, state.triggerRunId])

  // Choose a rest spot → accept (default recovery option) + auto-select the
  // rank-1 content (service rank-1 was auto-selected at the fire), then STAY
  // paused (no play) so the reviewer inspects the proposal before Continue.
  async function handleChooseSpot(spot: RestSpot): Promise<void> {
    const option = recoveryOptions[0]
    if (!option) return
    setSubmittingRest(true)
    try {
      await coordinator.acceptRest({ recovery_option_id: option.id, rest_spot: spot, nap_minutes: null })
      if (liveActiveServiceId) await coordinator.selectService(liveActiveServiceId)
      setResolvedOpportunityId(opportunity?.opportunity_id ?? null)
    } finally {
      setSubmittingRest(false)
    }
  }

  async function handleReject(): Promise<void> {
    setSubmittingRest(true)
    try {
      setResolvedOpportunityId(opportunity?.opportunity_id ?? null)
      await coordinator.declineRest()
    } finally {
      setSubmittingRest(false)
    }
  }

  function handleReset(): void {
    setResolvedOpportunityId(null)
    setRestLoadError(null)
    coordinator.reset()
  }

  const playLabel = hasRun && !state.running ? '▶ Continue' : 'Play'

  return (
    <div
      data-testid="merged-center-panel"
      style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '12px', minHeight: 0, overflowY: 'auto', gap: '10px' }}
    >
      {/* 1. QUICKVIEW PROJECTION (top, persistent). */}
      {hasQuickview && (
        <section data-testid="quickview-strip" style={{ flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' }}>
            <p style={{ fontSize: '0.72em', fontWeight: 700, color: '#6b7280', margin: '0 0 2px' }}>{t(LABELS.title, 'en')}</p>
            <p style={{ fontSize: '0.68em', color: '#94a3b8', margin: 0 }}>{t(LABELS.hint, 'en')}</p>
          </div>
          <ScoreTimeline
            data={quickviewTimeline!}
            revealFraction={1}
            showLegend
            showJourneyMarkers
            testIds={{
              root: 'quickview-timeline',
              fireGroup: 'quickview-fire-group',
              fire: 'quickview-fire',
              monotonyFire: 'quickview-monotony-fire',
              jamGroup: 'quickview-jam-group',
              restSpotGroup: 'quickview-rest-group',
              fireHit: (i) => `quickview-fire-hit-${i}`,
            }}
            onFireClick={(_fire, i) => coordinator.inspectFire(state.inspectedFireIndex === i ? null : i)}
          />
        </section>
      )}

      <hr style={{ border: 'none', borderTop: '1px dashed #cbd5e1', margin: 0, flexShrink: 0 }} />

      {/* 2. Controls: Play/Continue · Pause · Step · Reset */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, flexWrap: 'wrap' }}>
        <button
          type="button"
          data-testid="merged-play-button"
          disabled={(!hasRun && !state.ready) || state.running || state.completed}
          onClick={() => void coordinator.startAndPlay()}
        >
          {playLabel}
        </button>
        <button type="button" data-testid="merged-pause-button" disabled={!state.running} onClick={() => coordinator.pause()}>
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
        <button type="button" data-testid="merged-reset-button" disabled={!hasRun && !state.error} onClick={handleReset}>
          ↺ Reset
        </button>
      </div>

      {/* 3. ANIMATION — identical to the quickview + a moving playhead, no legend. */}
      <div style={{ flexShrink: 0 }}>
        <p style={{ fontSize: '0.72em', fontWeight: 700, color: '#6b7280', margin: '0 0 2px' }}>{t(LABELS.animation, 'en')}</p>
        <ScoreTimeline data={liveTimeline} revealFraction={revealFraction} showPlayhead testIds={{ root: 'merged-timeline' }} />
      </div>

      {state.error && (
        <p role="alert" style={{ color: '#dc2626', fontSize: '0.82em' }}>
          {state.error}
        </p>
      )}

      {restDecided && showRestAccept && (
        <p data-testid="rest-accepted-hint" style={{ fontSize: '0.78em', color: '#0f766e', margin: 0, flexShrink: 0 }}>
          ✓ {t(LABELS.restAccepted, 'en')}
        </p>
      )}

      {/* 4. GOOGLE MAP + on-map REST overlay. */}
      <div style={{ flex: '1 1 auto', minHeight: '240px', display: 'flex', flexDirection: 'column' }}>
        <p style={{ fontSize: '0.72em', fontWeight: 700, color: '#6b7280', margin: '0 0 2px', flexShrink: 0 }}>{t(LABELS.map, 'en')}</p>
        <div data-testid="merged-map-surface" style={{ flex: '1 1 auto', minHeight: '220px', position: 'relative' }}>
          <MapSurface
            fractionOverride={state.latestTrigger?.route_fraction ?? undefined}
            proposalFractionsOverride={decisionFractions}
            restSpotsOverride={state.acceptedRestSpots}
          />

          {showRestOverlay && (
            <div data-testid="rest-accept-panel" style={restOverlayStyle}>
              <p style={{ fontSize: '0.85em', fontWeight: 700, margin: '0 0 2px', color: '#0f766e' }}>🛑 {t(LABELS.restTitle, 'en')}</p>
              <p style={{ fontSize: '0.78em', color: '#334155', margin: '0 0 8px' }}>{t(LABELS.restPrompt, 'en')}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '8px' }}>
                {restSpots.length === 0 && <span style={{ fontSize: '0.78em', color: '#94a3b8' }}>Loading rest spots…</span>}
                {restSpots.map((spot) => {
                  const unreachable = spot.reachable === false
                  return (
                    <button
                      key={spot.id}
                      type="button"
                      data-testid={`rest-spot-choice-${spot.id}`}
                      disabled={submittingRest || recoveryOptions.length === 0 || unreachable}
                      onClick={() => void handleChooseSpot(spot)}
                      style={{ ...spotButtonStyle, ...(unreachable ? spotButtonUnreachable : {}) }}
                    >
                      <span>📍 {t(spot.label, 'en')}</span>
                      <span style={{ fontSize: '0.86em', color: unreachable ? '#b91c1c' : '#0d9488', fontWeight: 400 }}>
                        {spot.distance_km != null ? `${spot.distance_km} km` : ''}
                        {spot.eta_min != null ? ` · ETA ${spot.eta_min} min` : ''}
                        {unreachable ? ` · ${t(LABELS.tooFar, 'en')}` : ''}
                      </span>
                    </button>
                  )
                })}
              </div>
              <button type="button" data-testid="rest-reject-button" disabled={submittingRest} onClick={() => void handleReject()} style={rejectButtonStyle}>
                {t(LABELS.reject, 'en')}
              </button>
              {restLoadError && (
                <p role="alert" style={{ color: '#dc2626', fontSize: '0.78em', margin: '6px 0 0' }}>
                  {t(LABELS.loadError, 'en')}: {restLoadError}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Inline styles ────────────────────────────────────────────────────────────

const restOverlayStyle: React.CSSProperties = {
  position: 'absolute', top: '10px', left: '10px', maxWidth: 'min(340px, 72%)', zIndex: 20,
  background: 'rgba(255,255,255,0.97)', border: '2px solid #5bc0be', borderRadius: '10px',
  padding: '10px 12px', boxShadow: '0 4px 14px rgba(0,0,0,0.2)',
}
const spotButtonStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '1px',
  textAlign: 'left', fontSize: '0.82em', padding: '6px 10px', borderRadius: '7px',
  border: '1px solid #14b8a6', background: '#f0fdfa', color: '#0f766e', fontWeight: 600, cursor: 'pointer',
}
const spotButtonUnreachable: React.CSSProperties = {
  border: '1px solid #e5e7eb', background: '#f3f4f6', color: '#9ca3af', cursor: 'not-allowed',
}
const rejectButtonStyle: React.CSSProperties = {
  width: '100%', fontSize: '0.82em', padding: '6px 10px', borderRadius: '7px',
  border: '1px solid #cbd5e1', background: '#fff', color: '#475569', cursor: 'pointer',
}
