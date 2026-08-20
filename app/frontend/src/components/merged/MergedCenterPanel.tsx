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
import { guidedState, isMusicService } from './guidedSteps'
import { deriveProposalOverlay } from './MergedProposalPanel'
import { SUPPORTED_SERVICE_IDS } from './ServiceResultOverlay'
import { RecoveryVisual } from '../playback/RecoveryVisualization'
import { purposeShortLabel, serviceLabel } from '../../lib/review/reviewVocabulary'
import { songDisplayName } from '../proposal/useSongNames'
import { useProposalStore } from '../../state/proposalStore'
import { useSongNames } from '../proposal/useSongNames'
import MergedProposalPanel from './MergedProposalPanel'
import ScoreTimeline from '../playback/ScoreTimeline'
import { mergedInstantResultToTimeline, timelineYDomain } from '../playback/timelineData'
import { mergedLiveTimeline } from '../playback/mergedLiveTimeline'
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
  /** The live chart stacked under the projection: same axes, actual run. */
  liveTitle: { ja: '実走行の推移（ライブ）', en: 'Live run — actual' },
  liveHint: {
    ja: 'ドライバーの反応を反映した実測値（上は予測）',
    en: 'Measured as the driver responds (projection above)',
  },
  map: { ja: 'ルートマップ', en: 'Route map' },
  restTitle: { ja: '危険運転防止のため休憩推奨', en: 'Rest recommended to prevent dangerous driving' },
  restPrompt: { ja: '休憩場所を選ぶ、または拒否して走行を続けます。', en: 'Choose a rest spot, or reject to keep driving.' },
  /** Every decline control across the guided flow reads the same (owner
   *  review): rest chooser, service step, content step. */
  reject: { ja: '拒否', en: 'Cancel' },
  /** The monotony/service/content guided overlay's decline — same wording as
   *  `reject` above; kept as its own key only so callers read clearly. */
  declineMonotony: { ja: '拒否', en: 'Cancel' },
  tooFar: { ja: '遠すぎる', en: 'too far' },
  restAccepted: { ja: '休憩を受け入れました。提案（右）を確認して「続行」を押してください。', en: 'Rest accepted — inspect the proposal (right), then press Continue.' },
  loadError: { ja: '休憩場所の読み込みに失敗しました', en: 'Failed to load rest spots' },
  play: { ja: '再生', en: 'Play' },
  continue: { ja: '▶ 続行', en: '▶ Continue' },
  pause: { ja: '一時停止', en: 'Pause' },
  reset: { ja: '↺ リセット', en: '↺ Reset' },
  /** The content step's accept — plays the chosen songs while the drive
   *  continues (moving conversation, Task 5). */
  ok: { ja: '受諾', en: 'OK' },
  /** The now-playing badge on the moving map after content is accepted. */
  nowPlaying: { ja: '♪ 再生中', en: '♪ Now playing' },
  /** The after-rest "Continue driving" control (Task 6) — the car is stopped
   *  at the rest spot, so resuming is an explicit action, not automatic. */
  continueDriving: { ja: '▶ 走行を再開', en: '▶ Continue driving' },
  /** The after-rest conversation's resolved state, shown alongside the
   *  Continue-driving button. */
  postRestDone: { ja: '休憩後の提案を確認しました。走行を再開します。', en: 'Post-rest proposal reviewed. Ready to continue.' },
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

/** Smallest score-axis domain containing both charts' own domains, so the
 *  projection and the live run are drawn on ONE scale. `undefined` (→ each
 *  chart self-fits, ScoreTimeline's default) when neither has any data yet. */
function unionYDomain(
  a: { yMin: number; yMax: number } | null,
  b: { yMin: number; yMax: number } | null,
): { yMin: number; yMax: number } | undefined {
  if (a == null) return b ?? undefined
  if (b == null) return a
  return { yMin: Math.min(a.yMin, b.yMin), yMax: Math.max(a.yMax, b.yMax) }
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

  // LIVE chart, stacked directly under the projection once the animation has
  // started: the same chart on the same route-fraction axis, but drawn from the
  // ticks that ACTUALLY ran — so the driver-state band shows how the driver
  // responded to what the reviewer accepted or declined, next to what the
  // projection predicted. Road bands + jams are borrowed from the projection so
  // both charts share one background (the tick stream knows the road under the
  // car, not the route ahead of it).
  const liveTimeline = mergedLiveTimeline({
    trace: state.triggerTrace,
    restSpots: state.acceptedRestSpots,
    completed: state.completed,
    segments: quickviewTimeline?.segments ?? [],
    trafficJams: quickviewTimeline?.trafficJams ?? [],
  })
  // Both charts share ONE score axis, so the same score sits at the same height
  // in both and they can be read against each other. It is the PROJECTION's
  // domain (it spans the whole run, so it does not move as the car advances),
  // widened to cover the live curves whenever the real run leaves the projected
  // range — a live score drawn outside the band would be clipped away by the
  // SVG viewport, i.e. silently missing exactly where it diverges most. The
  // live fit is only folded in once there is something live to plot: an empty
  // live chart fits to a default 0–1 and would drag the projection's axis with
  // it.
  const liveHasCurve = liveTimeline.restScore.length > 0 || liveTimeline.monotonyScore.length > 0
  const sharedYDomain = unionYDomain(
    quickviewTimeline != null ? timelineYDomain(quickviewTimeline) : null,
    liveHasCurve ? timelineYDomain(liveTimeline) : null,
  )
  const liveFraction = state.latestTrigger?.route_fraction ?? 0

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
  // The after-rest opportunity the reviewer has RESOLVED (OK/Reject) — shows the
  // on-map "Continue driving" (car is stopped), instead of auto-resuming.
  const [afterRestResolvedOpportunityId, setAfterRestResolvedOpportunityId] = useState<string | null>(null)
  // The after-rest opportunity whose "Continue driving" was pressed — ends it.
  const [afterRestContinuedOpportunityId, setAfterRestContinuedOpportunityId] = useState<string | null>(null)

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
  // The proposal is a post-rest conversation (car stopped at the spot) — moved
  // up so it can feed `guidedState` below (Task 6).
  const isAfterRest = journeyStage === 'after_rest_before_restart'
  const afterRestResolved =
    opportunity?.opportunity_id != null && opportunity.opportunity_id === afterRestResolvedOpportunityId
  const afterRestContinued =
    opportunity?.opportunity_id != null && opportunity.opportunity_id === afterRestContinuedOpportunityId
  const guided = guidedState({
    proposalLog: state.proposalLog,
    restDecided,
    serviceChosen,
    hasContentPlan: overlay.contentPlan != null,
    conversationOver,
    isAfterRest,
    afterRestResolved,
    afterRestContinued,
  })

  async function handleChooseService(candidateId: string): Promise<void> {
    const log = await coordinator.selectService(candidateId)
    setServiceChosenOpportunityId(opportunity?.opportunity_id ?? null)
    // fixbug-0806 (Bug 1 regression guard / Bug 2-3's B2 companion): a
    // content step follows only for a music service WITH a freshly dispatched
    // plan — the SAME predicate `guidedState` uses to decide step 'content'
    // vs 'done' (guidedSteps.ts). When no content step follows, choosing the
    // service IS the driver's acceptance — there is nothing further to
    // confirm — so accept it immediately: without this, a non-music service
    // (e.g. a podcast/navigation-only offer) would never start its content
    // episode (`playback_state` stays idle, so `_derive_content_context`
    // keeps returning null — Bug 1 again) and the trigger side would never
    // `acknowledge` (the accept-only acknowledge trigger point moved in B2).
    // This deliberately does NOT run from `handleChooseSpot`'s automatic
    // rank-1 `selectService` call — that pick is the SYSTEM's default, not a
    // reviewer decision, so it must not auto-accept on the reviewer's behalf.
    // `log == null` means the selection never landed (no run yet, a
    // double-submit guard, or a failed call — `selectService` has already
    // dispatched ERROR in that last case). There is nothing to accept, and
    // accepting anyway would fire a second doomed request whose own failure
    // message would overwrite the accurate one already on screen.
    const willShowContentStep =
      isMusicService(log?.journey_state.active_service_id ?? null) &&
      deriveProposalOverlay(log).contentPlan != null
    if (log != null && !willShowContentStep) {
      await coordinator.acceptContent()
    }
  }
  const guidedActive = hasRun && guided.step !== 'done'
  // Dismissal ends the SERVICE/CONTENT conversation only. The rest chooser is a
  // decision the run is blocked on — Continue must not dismiss it, or the
  // reviewer could tick past a rest proposal without answering it.
  const guidedDismissed =
    opportunity?.opportunity_id != null && opportunity.opportunity_id === dismissedOpportunityId
  const showRestOverlay = guidedActive && guided.step === 'rest' && showRestAccept
  // The guided service/content overlay's own render condition (Finding 2,
  // final whole-branch review) — extracted so `proposalOnScreen` below can
  // ask the EXACT same question the JSX asks, rather than re-deriving it and
  // risking drift. Excludes 'rest'/'awaitingContinue' (their own overlays
  // below) and a dismissed conversation (Continue already ended it).
  const showGuidedServiceContentOverlay =
    guidedActive && guided.step !== 'rest' && guided.step !== 'awaitingContinue' && !guidedDismissed

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
    setAfterRestResolvedOpportunityId(null)
    setAfterRestContinuedOpportunityId(null)
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

  // A proposal conversation is on screen (a fire's pause) whenever an overlay
  // is ACTUALLY rendering something to resolve — including the after-rest
  // "Continue driving" step (Task 6). That pause is resolved by the overlay,
  // never by the top button, so the button hides while it is up.
  //
  // Finding 2 (final whole-branch review): `guidedActive` (guided.step !==
  // 'done') alone is NOT enough — `guidedState` returns step 'rest' whenever
  // isRestFlow && !restDecided, regardless of whether there is any eligible
  // service to choose. When the backend leaves `active_service_id` null
  // (zero eligible candidates, NO_ELIGIBLE_CANDIDATE / T017a), `showRestAccept`
  // is false and the rest chooser never renders — so `guidedActive` alone
  // would hide Continue with NOTHING on screen to resolve it, stranding the
  // reviewer (only Reset, which discards the run). Checking each overlay's
  // OWN render condition instead — rather than the abstract step — keeps
  // this in lockstep with the JSX below by construction: it can never hide
  // Continue for a step whose overlay isn't actually rendering, and it can
  // never fail to hide Continue for a step whose overlay IS rendering.
  const proposalOnScreen =
    showRestOverlay || showGuidedServiceContentOverlay || guided.step === 'awaitingContinue'
  // Continue is offered ONLY for a manual pause. A defensive fallback also
  // offers it when the run is paused, not by a fire's overlay, and not by the
  // user flag — so a reviewer is never stranded with no way to resume.
  const showContinue =
    hasRun && !state.running && !state.completed && (state.pausedByUser || !proposalOnScreen)
  const playLabel = hasRun && !state.running && state.pausedByUser ? t(LABELS.continue, lang) : t(LABELS.play, lang)

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
      {/* 1. Controls: Play/Continue · Pause · Reset. Step was removed
          (owner review) — the guided overlay now walks each fire's
          conversation one answer at a time, so a separate single-tick
          control just duplicated (and could desync from) that flow. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, flexWrap: 'wrap' }}>
        {/* Continue is offered ONLY for a manual pause (`showContinue`); it
            is HIDDEN while a fire's guided overlay is up — that pause is
            resolved by the overlay's own OK/Reject/Continue-driving controls,
            never by this button. `!hasRun` still shows Play before a run. */}
        {(!hasRun || showContinue) && (
          <button
            type="button"
            data-testid="merged-play-button"
            disabled={(!hasRun && !state.ready) || state.running || state.completed}
            onClick={() => { void coordinator.startAndPlay() }}
          >
            {playLabel}
          </button>
        )}
        <button type="button" data-testid="merged-pause-button" disabled={!state.running} onClick={() => coordinator.pause()}>
          {t(LABELS.pause, lang)}
        </button>
        <button type="button" data-testid="merged-reset-button" disabled={!hasRun && !state.error} onClick={handleReset}>
          {t(LABELS.reset, lang)}
        </button>
        {/* Animation speed (9×/18×/36×) — paces the tick loop; 9× baseline
            because the combined screen runs a 20s tick (9× finer than the
            180s Trigger cadence), so 9/18/36× keeps the same wall-clock feel. */}
        <label style={{ fontSize: '0.78em', color: '#6b7280', display: 'flex', alignItems: 'center', gap: '4px' }}>
          {t(LABELS.speed, lang)}
          <select
            data-testid="merged-speed-select"
            value={state.speed}
            onChange={(e) => coordinator.setSpeed(Number(e.target.value) as 9 | 18 | 36)}
          >
            <option value={9}>9×</option>
            <option value={18}>18×</option>
            <option value={36}>36×</option>
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
              copy of the cards) inside the guided overlay. Excludes
              'awaitingContinue' (Task 6): once the after-rest content is
              resolved, this overlay is GONE — the "Continue driving" card
              below is its own, separate overlay. */}
          {showGuidedServiceContentOverlay && (
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
              {/* Content-step OK/Reject — rendered for BOTH the MOVING and
                  the AFTER-REST conversation (Task 6); the two branch inside
                  the handlers. Moving: OK dismisses the overlay, starts the
                  content plan + records the now-playing badge, and resumes
                  (`acceptContentAndResume`); Reject is a PROPOSAL-side reject
                  (`coordinator.rejectProposal`, fixbug-0806 — NOT
                  `handleReject`/`declineRest`, which requires a trigger-side
                  pending proposal that no longer exists by this step).
                  After-rest: the car is stopped, so neither OK nor Reject
                  auto-resumes — both simply RESOLVE the conversation, which
                  surfaces the "Continue driving" control instead. OK and Reject
                  sit SIDE BY SIDE with a shared button treatment (owner
                  review) — the accept is a real button, not a song-row lookalike. */}
              {guided.step === 'content' && (
                <div style={guidedActionRowStyle}>
                  <button
                    type="button"
                    data-testid="guided-content-ok"
                    disabled={submittingRest}
                    onClick={() => {
                      if (isAfterRest) {
                        // Car is stopped — no resume. `acceptContent()` still
                        // starts the plan server-side (fixbug-0806 Bug 1) so
                        // post-rest relief applies once driving resumes; the
                        // "Continue driving" overlay (guided.step ===
                        // 'awaitingContinue') is what actually resumes ticking.
                        void coordinator.acceptContent()
                        setAfterRestResolvedOpportunityId(opportunity?.opportunity_id ?? null)
                      } else {
                        setDismissedOpportunityId(opportunity?.opportunity_id ?? null)
                        void coordinator.acceptContentAndResume(overlay.activeServiceId ?? '', opportunity?.opportunity_id ?? '')
                      }
                    }}
                    style={okActionStyle}
                  >
                    {t(LABELS.ok, lang)}
                  </button>
                  <button
                    type="button"
                    data-testid="guided-content-reject"
                    disabled={submittingRest}
                    onClick={() => {
                      // fixbug-0806 (Bugs 2/3): a reject HERE is a
                      // proposal-side rejection of the offered content, never
                      // `handleReject()`/`declineRest` — the trigger-side rest
                      // decline requires the trigger run still paused on a
                      // pending REST proposal, a precondition already
                      // consumed by accept-rest/a prior acknowledge by the
                      // time the reviewer reaches the content step (that 422
                      // was the bug). `setDismissedOpportunityId` is required
                      // in both branches: `rejectProposal` leaves
                      // `active_service_id === null` on the proposal log
                      // (declined=false path), which alone would make
                      // `guidedState` fall back to step 'service' and keep
                      // the overlay glued over the map for the rest of the
                      // drive — `guidedDismissed` is what gates it closed.
                      if (isAfterRest) {
                        void coordinator.rejectProposal({ resume: false })
                        setAfterRestResolvedOpportunityId(opportunity?.opportunity_id ?? null)
                      } else {
                        void coordinator.rejectProposal()
                      }
                      setDismissedOpportunityId(opportunity?.opportunity_id ?? null)
                    }}
                    style={rejectActionStyle}
                  >
                    {t(LABELS.reject, lang)}
                  </button>
                </div>
              )}
              {/* Service-step Reject — the accept at this step is picking a
                  service from the list above, so there is no OK button here,
                  only a decline. Shown for EVERY fire type (owner review): a
                  pre-rest or post-rest service proposal is just as declinable
                  as a monotony one, which previously only monotony offered.
                  Branches like the content reject: after-rest RESOLVES the
                  conversation (car stopped → "Continue driving"); every other
                  conversation proposal-side rejects and auto-resumes
                  (`coordinator.rejectProposal`, fixbug-0806). The rest
                  CHOOSER (step 'rest') keeps its own trigger-side
                  `handleReject`/`declineRest` below and is untouched — this
                  only fires at the 'service' step. */}
              {guided.step === 'service' && (
                <button
                  type="button"
                  data-testid="guided-decline-button"
                  disabled={submittingRest}
                  onClick={() => {
                    // fixbug-0806 (Bug 2): same proposal-side reject as the
                    // content-step Reject above — declining the OFFERED
                    // SERVICE (e.g. after accept-rest already consumed the
                    // trigger's pending proposal) must not go through
                    // `declineRest`, which requires that pending proposal to
                    // still exist. `setDismissedOpportunityId` closes the
                    // overlay for the same reason documented on the
                    // content-step Reject handler above.
                    if (isAfterRest) {
                      void coordinator.rejectProposal({ resume: false })
                      setAfterRestResolvedOpportunityId(opportunity?.opportunity_id ?? null)
                    } else {
                      void coordinator.rejectProposal()
                    }
                    setDismissedOpportunityId(opportunity?.opportunity_id ?? null)
                  }}
                  style={{ ...rejectButtonStyle, marginTop: '6px' }}
                >
                  {t(LABELS.reject, lang)}
                </button>
              )}
            </div>
          )}

          {/* Task 6: after the after-rest content is resolved (OK/Reject),
              the guided-overlay above is gone (car is stopped) — this is its
              own overlay card, so the reviewer still sees a control to leave
              the rest spot. Clicking it ends the after-rest conversation
              (guidedState → 'done') and resumes the tick loop. */}
          {guided.step === 'awaitingContinue' && (
            <div data-testid="guided-continue-driving-overlay" style={restOverlayStyle}>
              <p style={{ fontSize: '0.82em', color: '#334155', margin: '0 0 8px' }}>{t(LABELS.postRestDone, lang)}</p>
              <button
                type="button"
                data-testid="guided-continue-driving"
                onClick={() => {
                  setAfterRestContinuedOpportunityId(opportunity?.opportunity_id ?? null)
                  coordinator.continueDriving()
                }}
                style={spotButtonStyle}
              >
                {t(LABELS.continueDriving, lang)}
              </button>
            </div>
          )}

          {/* The nap / karaoke / wake-up animation, over the map — the SAME
              component the Trigger screen uses, so the two screens show the
              same recovery. */}
          <RecoveryVisual phase={recoveryPhase} motionState={state.latestTrigger?.motion_state ?? null} />

          {/* Now-playing badge — the moving-map equivalent of the wakefulness
              "♪ audio" badge (RecoveryVisualization.tsx): shown while content
              was accepted (`state.nowPlaying`) and the car is actually moving
              (not STOPPED, e.g. arrived and about to nap). */}
          {state.nowPlaying != null && state.latestTrigger?.motion_state !== 'STOPPED' && (
            <div data-testid="now-playing-badge" style={nowPlayingBadgeStyle}>
              <span style={{ fontSize: '1.15em' }}>♪</span>
              <span>{t(LABELS.nowPlaying, lang)}</span>
            </div>
          )}

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

      {/* 3. LIVE CHART — placed directly UNDER THE MAP (owner review), ABOVE the
          projection, from the moment the animation starts. Same route-fraction
          x-axis (the axis the car moves along above) and the same score y-axis
          (`sharedYDomain`) as the projection below, so the two stack into one
          reading: ACTUAL on top, predicted below. The driver-state band is the
          point of it — drowsiness/fatigue only fall where the reviewer actually
          accepted a rest, and monotony only bends where content was actually
          taken up, which is exactly what the auto-accepting projection cannot
          show. It reveals left-to-right with the car (`revealFraction`), and
          the road ahead is ghosted so the route is legible before the car
          reaches it. It does NOT draw its own legend (owner review) — the two
          charts share the same curves/colors, so the projection below carries
          the SOLE legend for the stacked pair; a second copy would just be
          noise. */}
      {hasRun && (
        <section data-testid="live-signal-strip" style={{ flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' }}>
            <p style={{ fontSize: '0.72em', fontWeight: 700, color: '#6b7280', margin: '0 0 2px' }}>{t(LABELS.liveTitle, lang)}</p>
            <p style={{ fontSize: '0.68em', color: '#94a3b8', margin: 0 }}>{t(LABELS.liveHint, lang)}</p>
          </div>
          <ScoreTimeline
            data={liveTimeline}
            revealFraction={liveFraction}
            ghostAhead
            animated
            showPlayhead
            playheadAriaLabel={t(LABELS.animation, lang)}
            yDomain={sharedYDomain}
            height={168}
            lang={lang}
            testIds={{
              root: 'live-timeline',
              curve: 'live-curve',
              threshold: 'live-threshold',
              signalBand: 'live-signal-band',
              drowsinessCurve: 'live-drowsiness',
              fatigueCurve: 'live-fatigue',
              monotonyLevelCurve: 'live-monotony-level',
              fireGroup: 'live-fire-group',
              fire: 'live-fire',
              monotonyFire: 'live-monotony-fire',
              jamGroup: 'live-jam-group',
              restSpotGroup: 'live-rest-group',
              legend: 'live-legend',
              playhead: 'live-playhead',
            }}
          />
        </section>
      )}

      {/* 3b. QUICKVIEW PROJECTION — the same chart, directly under the live run.
          Same route-fraction x-axis and the same score y-axis (`sharedYDomain`)
          as the live chart above, so the geo position and the score/driver
          curves are read together. Its curves carry the driver-state band
          (drowsiness / fatigue / monotony) below the road bar, so what the
          algorithm decided and what the driver was doing are visible in one
          glance. It carries the SOLE legend for the stacked pair (owner
          review, `showLegend`) — the live chart above draws the same curves in
          the same colors, so one legend describes both. */}
      {hasQuickview && (
        <section data-testid="quickview-strip" style={{ flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' }}>
            <p style={{ fontSize: '0.72em', fontWeight: 700, color: '#6b7280', margin: '0 0 2px' }}>{t(LABELS.title, lang)}</p>
            <p style={{ fontSize: '0.68em', color: '#94a3b8', margin: 0 }}>{t(LABELS.hint, lang)}</p>
          </div>
          <ScoreTimeline
            data={quickviewTimeline!}
            revealFraction={1}
            yDomain={sharedYDomain}
            // Taller than the default 92px (owner review): this chart now stacks
            // score curves + thresholds ABOVE the road bar and the driver-state
            // band BELOW it, and at the default height the two bands squeezed
            // each other flat enough to read as noise.
            height={168}
            showLegend
            // `ScoreTimeline.lang` DEFAULTS to 'en'. Every other caller passes
            // it; this one did not, so the legend stayed English on a Japanese
            // screen while every label around it was translated.
            lang={lang}
            showJourneyMarkers
            testIds={{
              root: 'quickview-timeline',
              curve: 'quickview-curve',
              threshold: 'quickview-threshold',
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

      {/* Siblings of the animated subtree above — a playback tick redraws that
          subtree but never these.

          A read-only one-line status (owner review): during playback the car's
          live status, before it the first projected trigger. It replaced the
          checkpoint rail + decision band; picking WHICH decision the review
          column examines is now done by clicking a trigger marker on the map,
          which dispatches SELECT_CHECKPOINT below. */}
      <PlaybackStatusLine playback={hasRun} latestTrigger={state.latestTrigger} />
      {/* 4. SERVICE | CONTENT proposals. The panel owns its own 40/60 split;
          it must NOT be wrapped in a grid here. It used to be, and since that
          grid had two columns but only this one child, the panel was confined
          to the first column and the 40/60 ratio inside it was squeezed into
          ~42% of the available width. */}
      <MergedProposalPanel />

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
/** The content step's OK + Reject sit SIDE BY SIDE (owner review), each taking
 *  half the width, centered — a clear pair of actions rather than the earlier
 *  stacked full-width buttons that made OK read like another song row. */
const guidedActionRowStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'row', gap: '6px', marginTop: '6px',
}
/** OK: a solid accept, centered, half-width. Shares its size/shape with the
 *  Reject beside it — same padding, radius, font, flex — differing only in the
 *  accept vs. neutral color treatment. */
const okActionStyle: React.CSSProperties = {
  flex: 1, justifyContent: 'center', textAlign: 'center', fontSize: '0.82em',
  padding: '6px 10px', borderRadius: '7px', border: '1px solid #14b8a6',
  background: '#f0fdfa', color: '#0f766e', fontWeight: 600, cursor: 'pointer',
}
/** Reject beside OK: identical geometry, neutral color (matches
 *  `rejectButtonStyle` but half-width in the row). */
const rejectActionStyle: React.CSSProperties = {
  flex: 1, justifyContent: 'center', textAlign: 'center', fontSize: '0.82em',
  padding: '6px 10px', borderRadius: '7px', border: '1px solid #cbd5e1',
  background: '#fff', color: '#475569', cursor: 'pointer',
}
/** Mirrors `RecoveryVisualization`'s wakefulness "♪ audio" badge — the two
 *  screens' now-playing indicators must look the same. */
const nowPlayingBadgeStyle: React.CSSProperties = {
  position: 'absolute', top: '12px', left: '12px', background: 'rgba(0,0,0,0.62)',
  borderRadius: '20px', padding: '7px 16px', color: '#ffe066', fontSize: '0.95em',
  fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', zIndex: 25,
}
