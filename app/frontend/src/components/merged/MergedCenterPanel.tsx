/**
 * MergedCenterPanel — CENTER panel of the Combined Simulator (owner layout,
 * feature 020). Uses `useMergedCoordinator()` for the run loop + the SCOPED
 * `runStore` (via the zero-prop `<MapSurface/>`) for the route map.
 *
 * Top-to-bottom:
 *   1. QUICKVIEW PROJECTION — persistent ephemeral preview (legend + jam
 *      sub-bar + journey markers); click a fire to inspect it (right panel).
 *   2. Play/Continue · Pause · Step · Reset controls.
 *   3. ANIMATION — a REALTIME timeline built from the observed trace on the
 *      DISTANCE (route_fraction) axis, with a moving playhead at the car's
 *      route_fraction. The quickview above is remapped onto the SAME distance
 *      axis (`mergedInstantResultToTimeline` uses the preview `progress` map),
 *      so a trigger point sits at the same x in both (owner review issue 2).
 *      No legend (the quickview has one right above).
 *   4. GOOGLE MAP — `<MapSurface/>` with the live car + decision/rest markers,
 *      and the on-map REST overlay (rest message + spot options w/ distance +
 *      Reject). Choose a spot → auto-select service+content (rank-1) and PAUSE
 *      until Continue; Reject → keep ticking.
 */
import { useEffect, useState } from 'react'
import { useMergedCoordinator } from '../../state/mergedCoordinator'
import { useRunStore } from '../../state/runStore'
import ScoreTimeline from '../playback/ScoreTimeline'
import { mergedInstantResultToTimeline, type TimelineData, type TimelineFire, type TimelinePoint, type TimelineSegment } from '../playback/timelineData'
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

/** REALTIME live `TimelineData` (owner review issue 3): everything is derived
 * from actually-observed data on the DISTANCE (route_fraction) axis — NOT the
 * projection. Road bands come from the selected route's geometry (known, static)
 * but traffic jams, the curves/fires, and the rest markers are all realtime, so
 * a rest spot is NEVER shown in advance (only once the driver actually accepts
 * one, from `acceptedRestSpots`). */
function buildLiveTimeline(
  trace: TraceEntry[],
  routeSegments: TimelineSegment[],
  acceptedRestSpots: RestSpot[],
): TimelineData {
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

  // Traffic jams — realtime, from is_traffic_jam transitions (open/close spans).
  const trafficJams: { fromX: number; toX: number }[] = []
  let jamFrom: number | null = null
  for (const e of trace) {
    const x = fracFor(e)
    if (e.is_traffic_jam) {
      if (jamFrom === null) jamFrom = x
    } else if (jamFrom !== null) {
      trafficJams.push({ fromX: jamFrom, toX: x })
      jamFrom = null
    }
  }
  if (jamFrom !== null && last) trafficJams.push({ fromX: jamFrom, toX: fracFor(last) })

  return {
    segments: routeSegments,
    trafficJams,
    restScore,
    monotonyScore,
    restThreshold,
    monotonyThreshold,
    spikes: [],
    fires,
    // Rest markers ONLY for spots the driver actually accepted (realtime) — never
    // the projected candidates (owner review: no rest spot shown in advance).
    restDots: acceptedRestSpots.map((s) => s.route_fraction),
    recoveryWindows: [],
    completionX: null,
  }
}

export default function MergedCenterPanel() {
  const coordinator = useMergedCoordinator()
  const { state } = coordinator
  // The setup panel mirrors the route + rest-filter fields into this scoped
  // runStore (whole shell is wrapped) — read them for the road bands + the
  // rest-spot fetch filters.
  const { state: rs } = useRunStore()

  // TOP strip = the projection (time axis, journey markers).
  const quickviewTimeline = state.quickviewResult ? mergedInstantResultToTimeline(state.quickviewResult) : null
  const hasQuickview = quickviewTimeline != null

  // LIVE animation = REALTIME, built from the observed trace + the known route
  // geometry (distance axis) — NOT the projection (owner review issue 3).
  const routeSegments: TimelineSegment[] = (() => {
    const alt = rs.alternatives.find((a) => a.route_id === rs.selectedRouteId)
    const segs = alt?.route_facts?.route_segments ?? []
    const totalKm = alt?.route_facts?.total_route_distance_km ?? 0
    if (segs.length === 0 || totalKm <= 0) return []
    return segs.map((s) => ({ fromX: s.start_km / totalKm, toX: (s.start_km + s.length_km) / totalKm, type: s.segment_type }))
  })()
  const liveTimeline = buildLiveTimeline(state.triggerTrace, routeSegments, state.acceptedRestSpots)
  const revealFraction = clamp01(state.latestTrigger?.route_fraction ?? 0)

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
    Promise.all([
      getScenario(state.scenarioId),
      // Thread the reviewer's rest-spot filters (drowsiness ceiling / min
      // spacing) the SAME way the Trigger screen's RecoveryPicker does.
      getRestSpots(state.triggerRunId, rs.mapsKey || undefined, rs.restDrowsinessCeiling ?? undefined, rs.minRestSpacingKm ?? undefined),
    ])
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
              restOptionHit: (i) => `quickview-rest-hit-${i}`,
            }}
            onFireClick={(_fire, i) => coordinator.inspectFire(state.inspectedFireIndex === i ? null : i)}
            onRestOptionClick={(i) => coordinator.inspectRestOption(state.inspectedRestOptionIndex === i ? null : i)}
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
        {/* Animation speed (1×/2×/4×) — paces the tick loop (owner review). */}
        <label style={{ fontSize: '0.78em', color: '#6b7280', display: 'flex', alignItems: 'center', gap: '4px' }}>
          Speed
          <select
            data-testid="merged-speed-select"
            value={state.speed}
            onChange={(e) => coordinator.setSpeed(Number(e.target.value) as 1 | 2 | 4)}
          >
            <option value={1}>1×</option>
            <option value={2}>2×</option>
            <option value={4}>4×</option>
          </select>
        </label>
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
            jamRangesKm={rs.mergedJamRangesKm}
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
