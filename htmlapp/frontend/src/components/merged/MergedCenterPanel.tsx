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
import { useEffect, useRef, useState } from 'react'
import { useMergedCoordinator } from '../../state/mergedCoordinator'
import { useRunStore } from '../../state/runStore'
import { useReviewStore } from '../../state/reviewStore'
import { deriveCheckpoints } from '../../lib/review/checkpoints'
import PlaybackStatusLine from './PlaybackStatusLine'
import { guidedState } from './guidedSteps'
import { deriveProposalOverlay } from './MergedProposalPanel'
import { SUPPORTED_SERVICE_IDS } from './ServiceResultOverlay'
import { RecoveryVisual } from '../playback/RecoveryVisualization'
import { purposeShortLabel, serviceLabel } from '../../lib/review/reviewVocabulary'
import { songDisplayName } from '../proposal/useSongNames'
import { useProposalStore } from '../../state/proposalStore'
import { useSongNames } from '../proposal/useSongNames'
import MergedProposalPanel from './MergedProposalPanel'
import ScoreTimeline from '../playback/ScoreTimeline'
import { mergedInstantResultToTimeline } from '../playback/timelineData'
import type { RecoveryOption, RestSpot } from '../../api/types'
import { getScenario, getRestSpots } from '../../api/client'
import MapSurface from '../map/MapSurface'
import type { ProposalMarker } from '../playback/useRouteProgress'
import { t } from '../../i18n/t'
import { useLanguage } from '../../state/language'

const LABELS = {
  title: { ja: '発火予測プレビュー', en: 'Projected firing preview' },
  hint: { ja: '発火をクリックして提案を確認（右パネル）', en: 'Click a fire to inspect its proposal (right panel)' },
  animation: { ja: 'ライブ再生', en: 'Live playback' },
  map: { ja: 'ルートマップ', en: 'Route map' },
  restTitle: { ja: '危険運転防止のため休憩推奨', en: 'Rest recommended to prevent dangerous driving' },
  restPrompt: { ja: '休憩場所を選ぶ、または拒否して走行を続けます。', en: 'Choose a rest spot, or reject to keep driving.' },
  reject: { ja: '拒否して走行継続', en: 'Reject — keep driving' },
  /** The monotony guided overlay's decline — same intent as `reject` above
   *  (drop the proposal, keep driving) but worded for a service/content
   *  conversation rather than a rest stop. */
  declineMonotony: { ja: '提案を見送って走行継続', en: 'Dismiss — keep driving' },
  tooFar: { ja: '遠すぎる', en: 'too far' },
  restAccepted: { ja: '休憩を受け入れました。提案（右）を確認して「続行」を押してください。', en: 'Rest accepted — inspect the proposal (right), then press Continue.' },
  loadError: { ja: '休憩場所の読み込みに失敗しました', en: 'Failed to load rest spots' },
  play: { ja: '再生', en: 'Play' },
  continue: { ja: '▶ 続行', en: '▶ Continue' },
  pause: { ja: '一時停止', en: 'Pause' },
  step: { ja: 'ステップ', en: 'Step' },
  reset: { ja: '↺ リセット', en: '↺ Reset' },
  speed: { ja: '速度', en: 'Speed' },
  loadingSpots: { ja: '休憩場所を読み込み中…', en: 'Loading rest spots…' },
  // The overlay title names the PROPOSAL, not a position in a sequence: the
  // reviewer needs to know which trigger they are looking at and what is being
  // asked, not that this is "step 2 of 3".
  stageService: { ja: 'サービス提案', en: 'Service proposal' },
  stageContent: { ja: 'コンテンツ提案', en: 'Content proposal' },
  /** The rest-spot chooser's title: which rest ACTIVITY the spot is for. */
  stageRestAt: { ja: '{activity}（休憩場所を選択）', en: '{activity} at a rest spot' },
  notSupported: { ja: '本バージョンでは未対応', en: 'not supported in this version' },
  errorGeneric: { ja: '発火処理でエラーが発生しました。', en: 'An error occurred while processing the fire.' },
  technicalDetail: { ja: '技術的な詳細', en: 'Technical detail' },
}

export default function MergedCenterPanel() {
  const coordinator = useMergedCoordinator()
  const { state } = coordinator
  const { lang } = useLanguage()
  // The setup panel mirrors the route + rest-filter fields into this scoped
  // runStore (whole shell is wrapped) — read them for the road bands + the
  // rest-spot fetch filters.
  const { state: rs } = useRunStore()
  const { state: proposalState } = useProposalStore()

  // The reviewable decision points (task-17-brief) are derived from the SAME
  // ephemeral quickview projection `ReviewColumn` reads (`MergedShell` hands
  // it the identical `state.quickviewResult`) — so a map marker click and the
  // review column always agree on which fire is index N.
  const { dispatch: reviewDispatch } = useReviewStore()
  const checkpoints = deriveCheckpoints(state.quickviewResult)

  const selectedAltDisplay =
    rs.alternatives.find((a) => a.route_id === rs.selectedRouteId)?.display ?? null

  // TOP strip = the projection (time axis, journey markers).
  const quickviewTimeline = state.quickviewResult ? mergedInstantResultToTimeline(state.quickviewResult) : null
  const hasQuickview = quickviewTimeline != null

  // Map markers from the SAME projection the strip draws — one source, so the
  // map and the strip can never disagree about where a fire happened.
  const mapFireMarkers = (quickviewTimeline?.fires ?? []).map((f, i) => ({
    fraction: f.x,
    index: i,
    category: state.quickviewResult?.fires[i]?.category ?? null,
    timeMin: state.quickviewResult?.fires[i]?.time_min ?? null,
  }))
  const mapRestMarkers = (quickviewTimeline?.restDots ?? []).map((x) => ({ fraction: x }))
  const quickviewFires = state.quickviewResult?.fires ?? []

  const hasRun = state.mergedRunId != null

  /** Clicking a trigger marker both inspects that fire AND points the review
   *  column at the matching checkpoint. The checkpoint rail used to be the only
   *  way to do the latter; the map is now that control. Checkpoints are keyed
   *  by CATEGORY, so the fire's category is the link. */
  function selectFire(index: number): void {
    const clearing = state.inspectedFireIndex === index
    coordinator.inspectFire(clearing ? null : index)
    if (clearing) return
    const category = quickviewFires[index]?.category ?? null
    const checkpoint = checkpoints.find((c) => c.id === category)
    if (checkpoint) reviewDispatch({ type: 'SELECT_CHECKPOINT', checkpointId: checkpoint.id })
    // …and put the review column on the TRIGGER comparison for that fire —
    // clicking a trigger dot is a request to see why THAT trigger fired.
    reviewDispatch({ type: 'SELECT_STAGE', stage: 'trigger' })
  }

  // Decision (fire) positions + accepted rest spots for the map markers (the
  // merged run has no runStore trace/restHistory).
  // Carries `selected_category` alongside the position so the live map colors a
  // monotony fire orange and a rest fire red — without it every live marker was
  // painted the same red regardless of which trigger actually fired.
  const decisionFractions: ProposalMarker[] = state.triggerTrace
    .filter((e) => e.proposal_paused === true)
    .map((e) => ({
      fraction: typeof e.route_fraction === 'number' ? e.route_fraction : 0,
      category: e.selected_category ?? null,
    }))

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
  // The opportunity whose service the REVIEWER picked. Kept per opportunity so a
  // later fire asks again rather than inheriting the previous answer.
  const [serviceChosenOpportunityId, setServiceChosenOpportunityId] = useState<string | null>(null)
  // The opportunity whose guided conversation the reviewer has ENDED by pressing
  // Continue. A monotony fire's sequence (service → songs) has no terminal step
  // of its own, so without this the song list stayed over the map for the rest
  // of the run: across Continue, and across the re-pause on the next fire of the
  // SAME category (which correctly spawns no new proposal run, so nothing
  // replaced the stale overlay). Keyed per opportunity, so the NEXT fire — a
  // different opportunity_id — opens the overlay again.
  const [dismissedOpportunityId, setDismissedOpportunityId] = useState<string | null>(null)

  const restDecided = opportunity?.opportunity_id != null && opportunity.opportunity_id === resolvedOpportunityId

  // A fire is a short conversation, walked one step at a time (owner review):
  // rest → service → songs, or service → songs when nothing is being proposed
  // about resting. `guidedState` reads the RECORDED log, so the overlay can
  // never show a step the evidence does not support.
  const overlay = deriveProposalOverlay(state.proposalLog)
  const songNames = useSongNames(proposalState.world?.catalog_ref?.dataset_id)
  const serviceChosen =
    opportunity?.opportunity_id != null && opportunity.opportunity_id === serviceChosenOpportunityId

  // Recovery has begun (or already ran) for this opportunity: the proposing is
  // over. `recoveredOpportunities` makes it STICK — once the nap starts, the
  // overlay must not reappear when recovery ends and the car drives on, which
  // is what a live `recovery_phase` check alone would do.
  const recoveryPhase = state.latestTrigger?.recovery_phase ?? null
  const recoveredOpportunities = useRef<Set<string>>(new Set())
  const currentOpportunityId = opportunity?.opportunity_id ?? null
  if (recoveryPhase != null && currentOpportunityId != null) {
    recoveredOpportunities.current.add(currentOpportunityId)
  }
  const conversationOver =
    recoveryPhase != null ||
    (currentOpportunityId != null && recoveredOpportunities.current.has(currentOpportunityId))
  const guided = guidedState({
    proposalLog: state.proposalLog,
    restDecided,
    serviceChosen,
    hasContentPlan: overlay.contentPlan != null,
    conversationOver,
  })

  async function handleChooseService(candidateId: string): Promise<void> {
    await coordinator.selectService(candidateId)
    setServiceChosenOpportunityId(opportunity?.opportunity_id ?? null)
  }
  const guidedActive = hasRun && guided.step !== 'done'
  // Dismissal ends the SERVICE/CONTENT conversation only. The rest chooser is a
  // decision the run is blocked on — Continue must not dismiss it, or the
  // reviewer could tick past a rest proposal without answering it.
  const guidedDismissed =
    opportunity?.opportunity_id != null && opportunity.opportunity_id === dismissedOpportunityId
  const showRestOverlay = guidedActive && guided.step === 'rest' && showRestAccept
  // A monotony fire (`inattentive_driving_prevention_recovery` — the actual
  // `trigger_purpose` value; `monotony_prevention` is the CATEGORY id used
  // elsewhere, not this field) has no rest step of its own to decline at, so
  // the guided service/content overlay is its only pause — unlike a rest
  // fire, which already offers Reject at the 'rest' step (`rest-accept-panel`
  // below) and must not get a second decline path here.
  const isMonotonyFire = opportunity?.trigger_purpose === 'inattentive_driving_prevention_recovery'

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
  }, [showRestAccept, state.scenarioId, state.triggerRunId, currentOpportunityId])

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
    setDismissedOpportunityId(null)
    setRestLoadError(null)
    coordinator.reset()
  }

  // The recovery option `handleChooseSpot` will actually apply — the same
  // `recoveryOptions[0]`, so the title can never promise an activity the chooser
  // does not perform. Null until the options have loaded.
  const restActivityLabel =
    recoveryOptions[0] != null
      ? t(LABELS.stageRestAt, lang).replace('{activity}', t(recoveryOptions[0].label, lang))
      : null

  const playLabel = hasRun && !state.running ? t(LABELS.continue, lang) : t(LABELS.play, lang)

  return (
    <div
      data-testid="merged-center-panel"
      // ONE scroll container for the whole middle column: `.center-panel`
      // (the grid cell) owns `overflow-y: auto`. This inner element used to
      // set `height: 100%` + `overflowY: auto` as well, so the column had two
      // nested scrollers — the outer one scrolled the inner scroller rather
      // than the content, which is what made the map appear to sit on top of
      // the proposals instead of above them.
      style={{ display: 'flex', flexDirection: 'column', padding: '12px', minHeight: 0, gap: '10px' }}
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
      {/* 1. Controls: Play/Continue · Pause · Step · Reset */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, flexWrap: 'wrap' }}>
        <button
          type="button"
          data-testid="merged-play-button"
          disabled={(!hasRun && !state.ready) || state.running || state.completed}
          onClick={() => {
            // Continue means "I am done looking at this proposal" — close the
            // guided overlay for THIS opportunity before resuming.
            //
            // NOT while the rest chooser is up: the service/content steps come
            // AFTER the spot is chosen, so dismissing at the rest step would
            // suppress the very steps the reviewer has not seen yet. The rest
            // chooser has its own answer buttons and is not dismissible here.
            if (guided.step !== 'rest') {
              setDismissedOpportunityId(opportunity?.opportunity_id ?? null)
            }
            void coordinator.startAndPlay()
          }}
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
        <div role="alert">
          <p style={{ color: '#dc2626', fontSize: '0.82em', margin: 0 }}>{t(LABELS.errorGeneric, lang)}</p>
          <p style={{ color: '#991b1b', fontSize: '0.7em', margin: '2px 0 0', fontFamily: 'monospace' }}>
            {t(LABELS.technicalDetail, lang)}: {state.error}
          </p>
        </div>
      )}

      {restDecided && showRestAccept && (
        <p data-testid="rest-accepted-hint" style={{ fontSize: '0.78em', color: '#0f766e', margin: 0, flexShrink: 0 }}>
          ✓ {t(LABELS.restAccepted, lang)}
        </p>
      )}

      {/* 2. GOOGLE MAP (or keyless schematic) + on-map REST overlay. */}
      {/* The map is a FIXED-height band, not a flex-grower: the proposals
          below are the main content of this panel and must keep the space.
          A growing map with a `52vh` child also overflowed its own box and
          drew over them. */}
      <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column' }}>
        <p style={{ fontSize: '0.72em', fontWeight: 700, color: '#6b7280', margin: '0 0 2px', flexShrink: 0 }}>{t(LABELS.map, lang)}</p>
        <div data-testid="merged-map-surface" style={{ flex: '0 0 auto', position: 'relative', overflow: 'hidden' }}>
          <MapSurface
            fractionOverride={state.latestTrigger?.route_fraction ?? undefined}
            proposalFractionsOverride={decisionFractions}
            restSpotsOverride={state.acceptedRestSpots}
            jamRangesKm={rs.mergedJamRangesKm}
            mountainRangesKm={rs.mergedMountainRangesKm}
            // A colour key directly under the canvas — the quickview timeline
            // has always had one, and the map's road classes and painted
            // conditions are no more self-explanatory than its curves.
            showLegend
            // Projected markers, visible BEFORE Play (owner review) so the
            // reviewer can see where the trigger fires and where the rest spots
            // are without running the animation first. `quickviewTimeline.fires`
            // is already on the DISTANCE axis and index-aligned with
            // `quickviewResult.fires`, so a click maps straight to inspectFire.
            fireMarkers={mapFireMarkers}
            restMarkers={mapRestMarkers}
            inspectedFireIndex={state.inspectedFireIndex}
            onFireMarkerClick={selectFire}
            // Hand the map over to LIVE markers once a run exists. Without
            // this the map kept drawing the projection for the whole
            // animation, so accepting a rest spot never changed what it
            // showed.
            playback={hasRun}
            startName={selectedAltDisplay?.start_label ?? null}
            endName={selectedAltDisplay?.end_label ?? null}
            // Shorter than the Trigger screen's 52vh — the proposals below are
            // this panel's main content and need the room.
            // 1.5x the first pass (owner review) — the map is the primary
            // spatial view and 300px read as cramped.
            height="450px"
            minHeight="330px"
          />

          {/* The service proposal, then the songs for the drive. Rendered with
              the SAME components as the panel below (never a second, drifting
              copy of the cards) inside the guided overlay. */}
          {guidedActive && guided.step !== 'rest' && !guidedDismissed && (
            <div data-testid="guided-overlay" style={guidedOverlayStyle}>
              <p style={guidedStepCaptionStyle}>
                {/* Which trigger fired, then what this overlay is asking for. */}
                {t(purposeShortLabel(opportunity?.trigger_purpose), lang)}
                {' · '}
                {guided.step === 'service' ? t(LABELS.stageService, lang) : t(LABELS.stageContent, lang)}
              </p>
              {guided.step === 'service' ? (
                <ul data-testid="guided-service-list" style={guidedListStyle}>
                  {(overlay.serviceOutput?.ranked_candidates ?? []).map((candidate) => {
                    const supported = SUPPORTED_SERVICE_IDS.has(candidate.candidate_id)
                    return (
                      <li key={candidate.candidate_id}>
                        <button
                          type="button"
                          data-testid={`guided-choose-${candidate.candidate_id}`}
                          disabled={!supported || state.choosingId != null}
                          onClick={() => void handleChooseService(candidate.candidate_id)}
                          style={{ ...guidedItemButtonStyle, ...(supported ? {} : guidedItemDisabledStyle) }}
                        >
                          {t(serviceLabel(candidate.candidate_id), lang)}
                          {!supported && <span style={{ fontSize: '0.86em' }}> · {t(LABELS.notSupported, lang)}</span>}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              ) : overlay.contentPlan ? (
                <ol data-testid="guided-song-list" style={guidedListStyle}>
                  {overlay.contentPlan.ordered_items.map((item) => (
                    <li key={item.item_id} data-testid={`guided-song-${item.item_id}`} style={guidedSongStyle}>
                      {songDisplayName(item.item_id, songNames, lang)}
                    </li>
                  ))}
                </ol>
              ) : null}
              {/* A monotony fire has no rest step to decline at — the rest
                  flow's own Reject lives in `rest-accept-panel` below and must
                  stay the only decline path there, so this control is
                  restricted to a monotony fire (`isMonotonyFire`). */}
              {isMonotonyFire && (
                <button
                  type="button"
                  data-testid="guided-decline-button"
                  disabled={submittingRest}
                  onClick={() => void handleReject()}
                  style={{ ...rejectButtonStyle, marginTop: '6px' }}
                >
                  {t(LABELS.declineMonotony, lang)}
                </button>
              )}
            </div>
          )}

          {/* The nap / karaoke / wake-up animation, over the map — the SAME
              component the Trigger screen uses, so the two screens show the
              same recovery. */}
          <RecoveryVisual phase={recoveryPhase} motionState={state.latestTrigger?.motion_state ?? null} />

          {showRestOverlay && (
            <div data-testid="rest-accept-panel" style={restOverlayStyle}>
              {/* Category, then the rest ACTIVITY the spot is being chosen for
                  ("Rest proposal · Nap + Karaoke at a rest spot") — the
                  recovery option's own label, so the wording follows the
                  scenario rather than being restated here. */}
              <p style={{ fontSize: '0.85em', fontWeight: 700, margin: '0 0 2px', color: '#0f766e' }}>
                🛑 {t(purposeShortLabel(opportunity?.trigger_purpose), lang)}
                {restActivityLabel != null && <> · {restActivityLabel}</>}
              </p>
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
                        {spot.eta_min != null
                          ? lang === 'ja'
                            ? `・到着まで${spot.eta_min}分`
                            : ` · ETA ${spot.eta_min} min`
                          : ''}
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
                <div role="alert" style={{ margin: '6px 0 0' }}>
                  <p style={{ color: '#dc2626', fontSize: '0.78em', margin: 0 }}>{t(LABELS.loadError, lang)}</p>
                  <p style={{ color: '#991b1b', fontSize: '0.68em', margin: '2px 0 0', fontFamily: 'monospace' }}>
                    {t(LABELS.technicalDetail, lang)}: {restLoadError}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      </div>

      {/* Siblings of the animated subtree above — a playback tick redraws that
          subtree but never these.

          A read-only one-line status (owner review): during playback the car's
          live status, before it the first projected trigger. It replaced the
          checkpoint rail + decision band; picking WHICH decision the review
          column examines is now done by clicking a trigger marker on the map,
          which dispatches SELECT_CHECKPOINT below. */}
      <PlaybackStatusLine playback={hasRun} latestTrigger={state.latestTrigger} />
      {/* 3. SERVICE | CONTENT proposals. The panel owns its own 40/60 split;
          it must NOT be wrapped in a grid here. It used to be, and since that
          grid had two columns but only this one child, the panel was confined
          to the first column and the 40/60 ratio inside it was squeezed into
          ~42% of the available width. */}
      <MergedProposalPanel />

      {/* 4. QUICKVIEW PROJECTION (persistent). */}
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
            // `ScoreTimeline.lang` DEFAULTS to 'en'. Every other caller passes
            // it; this one did not, so the legend stayed English on a Japanese
            // screen while every label around it was translated.
            lang={lang}
            showJourneyMarkers
            testIds={{
              root: 'quickview-timeline',
              fireGroup: 'quickview-fire-group',
              fire: 'quickview-fire',
              monotonyFire: 'quickview-monotony-fire',
              jamGroup: 'quickview-jam-group',
              restSpotGroup: 'quickview-rest-group',
              legend: 'quickview-legend',
              fireHit: (i) => `quickview-fire-hit-${i}`,
              restOptionHit: (i) => `quickview-rest-hit-${i}`,
            }}
            onFireClick={(_fire, i) => coordinator.inspectFire(state.inspectedFireIndex === i ? null : i)}
            // After-rest status is no longer reviewable (owner review), so the
            // rest dots are NOT clickable. They are deliberately still drawn —
            // where the driver stops is journey context worth seeing — but
            // omitting the handler means ScoreTimeline renders no hit areas.
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

/** The SAME card as the rest prompt (owner review) — the three steps are one
 *  conversation and must look like it. Bounded, not the whole map: the reviewer
 *  needs to keep seeing where the car is while they choose. */
const guidedOverlayStyle: React.CSSProperties = {
  ...restOverlayStyle,
  maxHeight: 'calc(100% - 20px)',
  overflowY: 'auto',
}
const guidedListStyle: React.CSSProperties = {
  listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '4px',
}
const guidedItemButtonStyle: React.CSSProperties = { ...spotButtonStyle, width: '100%' }
const guidedItemDisabledStyle: React.CSSProperties = spotButtonUnreachable
const guidedSongStyle: React.CSSProperties = {
  fontSize: '0.82em', color: '#0f766e', padding: '5px 10px', borderRadius: '7px',
  border: '1px solid #14b8a6', background: '#f0fdfa', fontWeight: 600,
}
const guidedStepCaptionStyle: React.CSSProperties = {
  fontSize: '0.72em', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em',
  color: '#0f766e', margin: '0 0 6px',
}
const rejectButtonStyle: React.CSSProperties = {
  width: '100%', fontSize: '0.82em', padding: '6px 10px', borderRadius: '7px',
  border: '1px solid #cbd5e1', background: '#fff', color: '#475569', cursor: 'pointer',
}
