/**
 * MergedCenterPanel — CENTER panel of the Combined Simulator (owner layout,
 * feature 020). Uses `useMergedCoordinator()` for the run loop + the SCOPED
 * `runStore` (via the zero-prop `<MapSurface/>`) for the route map.
 *
 * Top-to-bottom:
 *   1. QUICKVIEW PROJECTION — persistent ephemeral preview (legend + jam
 *
 * Order (owner review): controls → map → service|content side by side →
 * quickview strip at the bottom. The standalone ANIMATION timeline was removed
 * — it duplicated the quickview on the same distance axis and earned no space.
 *
 *   1. Play/Continue · Pause · Step · Reset (+ speed), directly above the map.
 *   2. GOOGLE MAP — `<MapSurface/>` with the live car + decision/rest markers,
 *      and the on-map REST overlay (rest message + spot options w/ distance +
 *      Reject). Choose a spot → auto-select service+content (rank-1) and PAUSE
 *      until Continue; Reject → keep ticking.
 *   3. Checkpoint rail + decision band, then the service and content proposals
 *      SIDE BY SIDE (`MergedProposalPanel` owns that split internally).
 *   4. QUICKVIEW strip — the projected run on the DISTANCE axis, with the
 *      score curves, threshold, fire markers and journey markers.
 *
 * The playback subtree (controls + map) is a SIBLING of the proposal split, so
 * a tick never re-renders the proposal cards and collapses an expanded
 * contribution chain mid-run.
 */
import { useEffect, useState } from 'react'
import { useMergedCoordinator } from '../../state/mergedCoordinator'
import { useRunStore } from '../../state/runStore'
import { useReviewStore } from '../../state/reviewStore'
import { deriveCheckpoints } from '../../lib/review/checkpoints'
import CheckpointRail from '../review/CheckpointRail'
import DecisionBand from '../review/DecisionBand'
import MergedProposalPanel from './MergedProposalPanel'
import ScoreTimeline from '../playback/ScoreTimeline'
import { mergedInstantResultToTimeline } from '../playback/timelineData'
import type { RecoveryOption, RestSpot } from '../../api/types'
import { getScenario, getRestSpots } from '../../api/client'
import MapSurface from '../map/MapSurface'
import { t } from '../../i18n/t'
import { useLanguage } from '../../state/language'

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
  play: { ja: '再生', en: 'Play' },
  continue: { ja: '▶ 続行', en: '▶ Continue' },
  pause: { ja: '一時停止', en: 'Pause' },
  step: { ja: 'ステップ', en: 'Step' },
  reset: { ja: '↺ リセット', en: '↺ Reset' },
  speed: { ja: '速度', en: 'Speed' },
  loadingSpots: { ja: '休憩スポットを読み込み中…', en: 'Loading rest spots…' },
}

export default function MergedCenterPanel() {
  const coordinator = useMergedCoordinator()
  const { state } = coordinator
  const { lang } = useLanguage()
  // The setup panel mirrors the route + rest-filter fields into this scoped
  // runStore (whole shell is wrapped) — read them for the road bands + the
  // rest-spot fetch filters.
  const { state: rs } = useRunStore()

  // The reviewable decision points (task-17-brief) are derived from the SAME
  // ephemeral quickview projection `ReviewColumn` reads (`MergedShell` hands
  // it the identical `state.quickviewResult`) — so the rail, the band and the
  // review column always agree on which fire is index N.
  const { state: reviewState, dispatch: reviewDispatch } = useReviewStore()
  const checkpoints = deriveCheckpoints(state.quickviewResult)
  const activeCheckpoint = checkpoints.find((c) => c.id === reviewState.checkpointId) ?? checkpoints[0] ?? null

  // TOP strip = the projection (time axis, journey markers).
  const quickviewTimeline = state.quickviewResult ? mergedInstantResultToTimeline(state.quickviewResult) : null
  const hasQuickview = quickviewTimeline != null

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

  const playLabel = hasRun && !state.running ? t(LABELS.continue, lang) : t(LABELS.play, lang)

  return (
    <div
      data-testid="merged-center-panel"
      style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '12px', minHeight: 0, overflowY: 'auto', gap: '10px' }}
    >
      {/* The animated subtree: quickview + playback controls + live timeline
          + map, all redrawn every tick. `CheckpointRail`/`DecisionBand`/the
          proposal split below are SIBLINGS of this element, never
          descendants — a tick re-rendering this subtree must not remount the
          proposal cards next to it and collapse an expanded contribution
          chain mid-run (task-17-brief's structural rule). */}
      <div
        data-testid="merged-playback-subtree"
        style={{ display: 'flex', flexDirection: 'column', gap: '10px', minHeight: 0 }}
      >
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
          {t(LABELS.pause, lang)}
        </button>
        <button
          type="button"
          data-testid="merged-step-button"
          disabled={!hasRun || state.running || state.completed}
          onClick={() => coordinator.step()}
        >
          {t(LABELS.step, lang)}
        </button>
        <button type="button" data-testid="merged-reset-button" disabled={!hasRun && !state.error} onClick={handleReset}>
          {t(LABELS.reset, lang)}
        </button>
        {/* Animation speed (1×/2×/4×) — paces the tick loop (owner review). */}
        <label style={{ fontSize: '0.78em', color: '#6b7280', display: 'flex', alignItems: 'center', gap: '4px' }}>
          {t(LABELS.speed, lang)}
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

      {state.error && (
        <p role="alert" style={{ color: '#dc2626', fontSize: '0.82em' }}>
          {state.error}
        </p>
      )}

      {restDecided && showRestAccept && (
        <p data-testid="rest-accepted-hint" style={{ fontSize: '0.78em', color: '#0f766e', margin: 0, flexShrink: 0 }}>
          ✓ {t(LABELS.restAccepted, lang)}
        </p>
      )}

      {/* 2. GOOGLE MAP + on-map REST overlay. */}
      <div style={{ flex: '1 1 auto', minHeight: '240px', display: 'flex', flexDirection: 'column' }}>
        <p style={{ fontSize: '0.72em', fontWeight: 700, color: '#6b7280', margin: '0 0 2px', flexShrink: 0 }}>{t(LABELS.map, lang)}</p>
        <div data-testid="merged-map-surface" style={{ flex: '1 1 auto', minHeight: '220px', position: 'relative' }}>
          <MapSurface
            fractionOverride={state.latestTrigger?.route_fraction ?? undefined}
            proposalFractionsOverride={decisionFractions}
            restSpotsOverride={state.acceptedRestSpots}
            jamRangesKm={rs.mergedJamRangesKm}
          />

          {showRestOverlay && (
            <div data-testid="rest-accept-panel" style={restOverlayStyle}>
              <p style={{ fontSize: '0.85em', fontWeight: 700, margin: '0 0 2px', color: '#0f766e' }}>🛑 {t(LABELS.restTitle, lang)}</p>
              <p style={{ fontSize: '0.78em', color: '#334155', margin: '0 0 8px' }}>{t(LABELS.restPrompt, lang)}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '8px' }}>
                {restSpots.length === 0 && <span style={{ fontSize: '0.78em', color: '#94a3b8' }}>{t(LABELS.loadingSpots, lang)}</span>}
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
                      <span>📍 {t(spot.label, lang)}</span>
                      <span style={{ fontSize: '0.86em', color: unreachable ? '#b91c1c' : '#0d9488', fontWeight: 400 }}>
                        {spot.distance_km != null ? `${spot.distance_km} km` : ''}
                        {spot.eta_min != null ? ` · ETA ${spot.eta_min} min` : ''}
                        {unreachable ? ` · ${t(LABELS.tooFar, lang)}` : ''}
                      </span>
                    </button>
                  )
                })}
              </div>
              <button type="button" data-testid="rest-reject-button" disabled={submittingRest} onClick={() => void handleReject()} style={rejectButtonStyle}>
                {t(LABELS.reject, lang)}
              </button>
              {restLoadError && (
                <p role="alert" style={{ color: '#dc2626', fontSize: '0.78em', margin: '6px 0 0' }}>
                  {t(LABELS.loadError, lang)}: {restLoadError}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
      </div>

      {/* Siblings of the animated subtree above — a playback tick redraws that
          subtree but never these. */}
      <CheckpointRail
        checkpoints={checkpoints}
        selectedId={activeCheckpoint?.id ?? null}
        onSelect={(checkpointId) => reviewDispatch({ type: 'SELECT_CHECKPOINT', checkpointId })}
      />
      <DecisionBand checkpoint={activeCheckpoint} />
      <div className="merged-proposal-split">
        <MergedProposalPanel />
      </div>

      {/* 1. QUICKVIEW PROJECTION (top, persistent). */}
      {hasQuickview && (
        <section data-testid="quickview-strip" style={{ flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' }}>
            <p style={{ fontSize: '0.72em', fontWeight: 700, color: '#6b7280', margin: '0 0 2px' }}>{t(LABELS.title, lang)}</p>
            <p style={{ fontSize: '0.68em', color: '#94a3b8', margin: 0 }}>{t(LABELS.hint, lang)}</p>
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
