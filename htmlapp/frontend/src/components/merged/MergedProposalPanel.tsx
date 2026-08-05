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
import { useState } from 'react'
import { useMergedCoordinator } from '../../state/mergedCoordinator'
import type { RankedCandidate, ExcludedCandidate, CompletePlan, ProposalRunLog, EvidenceError } from '../../api/proposalClient'
import { useSongNames, useSongArtists } from '../proposal/useSongNames'
import { ServiceResultOverlay } from './ServiceResultOverlay'
import { ContentResultOverlay } from './ContentResultOverlay'
import { useProposalStore } from '../../state/proposalStore'
import { useReviewStore } from '../../state/reviewStore'
import { useRunStore } from '../../state/runStore'
import { formatDuration } from '../../lib/formatDuration'
import { buildEventTimeline, selectActiveEvent } from '../../lib/merged/eventTimeline'
import EventsListModal from './EventsListModal'
import { t } from '../../i18n/t'
import { useLanguage } from '../../state/language'
import { purposeLabel, optionLabel } from '../../lib/review/reviewVocabulary'

const LABELS = {
  // An algorithm failure is EVIDENCE (architecture §11: a failure is never
  // disguised as a normal AICA decision), so the backend's own message is
  // still shown — it is the only record of what actually went wrong. What
  // changed is the framing: the sentence a reviewer reads is in their own
  // language, and the backend string is labelled as the technical detail it
  // is rather than being the whole message.
  algorithmErrorGeneric: {
    ja: 'アルゴリズムでエラーが発生しました。',
    en: 'The algorithm reported an error.',
  },
  technicalDetail: { ja: '技術的な詳細', en: 'Technical detail' },
  service: { ja: 'サービス提案', en: 'Service proposal' },
  content: { ja: 'コンテンツ提案', en: 'Content proposal' },
  awaitingLive: { ja: 'サービスを選ぶとコンテンツプランが表示されます。', en: 'Choose a service (top) to see its content plan.' },
  awaitingReadonly: { ja: 'この発火にはコンテンツプランがありません。', en: 'No content plan for this fire.' },
  explanationSource: { ja: '説明の生成元', en: 'Explanation source' },
  explOff: { ja: 'オフ（既定テンプレート）', en: 'Off (template)' },
  explBackend: { ja: 'サーバー側の生成AI（Ollama）', en: 'Server-side generative AI (Ollama)' },
  explBrowser: { ja: 'ブラウザ内蔵の生成AI（Gemini Nano）', en: 'In-browser generative AI (Gemini Nano)' },
  // 提案分類 is the specification's own name for this field (Slide 35: the
  // four 提案分類 with their purposes). It carries a proposal CATEGORY, not
  // a signal, and the value shown under it is that category's spec wording.
  triggerSignal: { ja: '提案分類', en: 'Proposal category' },
  carState: { ja: '車両状態', en: 'Car status' },
  motion: { ja: '走行・停車', en: 'Motion' },
  inspectedError: {
    ja: 'この発火の再計算でエラーが発生しました。',
    en: 'An error occurred while recomputing this fire.',
  },
  overallRoute: { ja: 'ルート全体（走行）', en: 'Overall route (driving)' },
  arriveIn: { ja: '到着まで', en: 'arrive in' },
  firing: { ja: '発火', en: 'Trigger' },
  viewEvents: { ja: 'すべてのイベント', en: 'View all events' },
}

// The read-only status strip's trigger-purpose / lifecycle-stage / motion-state
// values resolve through the SHARED reviewVocabulary table (`purposeLabel` /
// `optionLabel`) rather than a local lookup — the same three fields are shown
// elsewhere in the Combined screen (map markers, playback status line) and must
// read identically everywhere. An unmapped value falls back to that shared
// table's own "unnamed" wording, never to the raw backend string.

type ProposalOverlayDerivation = {
  hasService: boolean
  serviceOutput: { decision_type: string; ranked_candidates: RankedCandidate[] } | undefined
  eligibleCandidates: { candidate_id: string }[]
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
  const { state: ps } = useProposalStore()

  /**
   * Clicking a card sends the RIGHT column to that stage's comparison, with
   * A = the top-ranked option (the one that won) and B = the clicked one — the
   * question a click is asking is "why this instead of the winner?".
   *
   * `SELECT_STAGE` clears the comparison in the reducer, so it must be
   * dispatched FIRST; clicking the winner itself leaves the stage's own
   * default (rank 1 vs rank 2) rather than comparing it with itself.
   */
  const { dispatch: reviewDispatch } = useReviewStore()

  function inspectStage(stage: 'service' | 'content', firstId: string | undefined, clickedId: string) {
    reviewDispatch({ type: 'SELECT_STAGE', stage })
    if (!firstId || firstId === clickedId) return
    reviewDispatch({ type: 'SET_COMPARISON', leftId: firstId, rightId: clickedId })
    reviewDispatch({ type: 'SELECT_TARGET', targetId: firstId })
  }

  const inspectService = (candidateId: string) =>
    inspectStage('service', overlay.serviceOutput?.ranked_candidates[0]?.candidate_id, candidateId)

  const inspectContentItem = (itemId: string) =>
    inspectStage('content', overlay.contentPlan?.ordered_items[0]?.item_id, itemId)

  // item_id → song display name, so the content plan shows "Name (id)" like the
  // Proposal screen (issue #3). Shared with the review column via `useSongNames`
  // so both resolve names from the SAME dataset.
  const songNames = useSongNames(ps.world?.catalog_ref?.dataset_id)
  const songArtists = useSongArtists(ps.world?.catalog_ref?.dataset_id)

  // Show a proposal IMMEDIATELY (owner review): before any run exists, fall back
  // to the FIRST projected fire so the reviewer sees a service+content result
  // without having to click a dot first. An explicit click still wins, and once
  // a live run exists the live proposal takes over.
  const defaultsToFirstFire =
    state.inspectedFireIndex == null &&
    state.inspectedRestOptionIndex == null &&
    state.proposalLog == null &&
    (state.quickviewResult?.fires.length ?? 0) > 0
  const effectiveFireIndex = state.inspectedFireIndex ?? (defaultsToFirstFire ? 0 : null)
  const inspectedFire =
    effectiveFireIndex != null ? (state.quickviewResult?.fires[effectiveFireIndex] ?? null) : null
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

  // ── Timing line (feature: combined-screen time display, redesigned) ────────
  // Display-only. One projection (preserved by the coordinator across run
  // creation AND playback) feeds both quickview and animation.
  //   • Sub-line 1: overall driving-only route duration + a button opening the
  //     full event list (quickview-only, in a popup).
  //   • Sub-line 2: the SINGLE trigger the panel is currently describing — the
  //     same selection the 提案分類 strip reads (selectActiveEvent). No category
  //     here; the strip above already carries it.
  const { state: runState } = useRunStore()
  const [eventsOpen, setEventsOpen] = useState(false)
  const routeFactsDurationMin =
    runState.alternatives.find((a) => a.route_id === runState.selectedRouteId)?.route_facts
      .estimated_route_duration_min ?? null
  const timing = buildEventTimeline(state.quickviewResult, routeFactsDurationMin)
  const livePos = state.latestTrigger?.tick_index ?? null

  // Sub-line 2's trigger follows the status strip's selection:
  //  • an explicit fire click (inspectedFireIndex) always wins;
  //  • else, in PURE QUICKVIEW only (no live run — mergedRunId == null), the
  //    default-first-fire;
  //  • during a live run with no explicit click, livePos drives it instead
  //    (selectActiveEvent branch 2), so nothing shows before the first trigger.
  // The run-exists signal is `mergedRunId` (set synchronously on CREATED, cleared
  // only on RESET) — NOT `livePos`, which is still null in the gap between create()
  // and the first tick landing and would otherwise leak the quickview
  // default-first-fire onto sub-line 2 of a just-started run.
  const fireTick =
    state.inspectedFireIndex != null || state.mergedRunId == null ? (inspectedFire?.tick ?? null) : null
  const activeEvent = selectActiveEvent(timing, { fireTick, livePos })

  // Rendered only when a projection exists AND yields a route duration or events.
  const hasTiming =
    state.quickviewResult != null && (timing.routeDrivingMin != null || timing.events.length > 0)
  const timingBlock = hasTiming ? (
    <div data-testid="merged-route-timing" style={timingBlockStyle}>
      {/* Sub-line 1: overall driving route duration + open-popup button */}
      <div style={timingRow1Style}>
        {timing.routeDrivingMin != null && (
          <span>
            <span style={statusLabelStyle}>{t(LABELS.overallRoute, lang)}:</span>{' '}
            <span data-testid="merged-route-duration" style={statusValueStyle}>
              {formatDuration(timing.routeDrivingMin, lang)}
            </span>
          </span>
        )}
        {timing.events.length > 0 && (
          <button
            type="button"
            data-testid="merged-view-events-button"
            onClick={() => setEventsOpen(true)}
            style={viewEventsButtonStyle}
          >
            {t(LABELS.viewEvents, lang)}
          </button>
        )}
      </div>
      {/* Sub-line 2: the active trigger (neutral 発火 — the category is on the
          提案分類 strip above, never repeated here). */}
      {activeEvent != null && (
        <div data-testid="merged-active-event" style={timingRow2Style}>
          <span>➤ {t(LABELS.firing, lang)}</span>
          <span style={timingWhenStyle}>@ {formatDuration(activeEvent.whenMin, lang)}</span>
          {activeEvent.arriveInMin != null && (
            <span style={timingArriveStyle}>
              · {t(LABELS.arriveIn, lang)} {formatDuration(activeEvent.arriveInMin, lang)}
            </span>
          )}
        </div>
      )}
      <EventsListModal open={eventsOpen} events={timing.events} onClose={() => setEventsOpen(false)} />
    </div>
  ) : null

  // No proposal → the panel contributes NOTHING to the centre column. Not a
  // placeholder, and above all not the status strip: with no proposal to read
  // from, `statusSource` is null and the strip falls back to the SETUP world,
  // so it would announce a "proposal category" that no proposal ever carried —
  // exactly what a designed-to-not-fire control case must never show.
  //
  // A recompute ERROR is the one thing that still renders on its own: a
  // failure is recorded evidence (architecture §11) and is never silently
  // dropped just because it produced no service candidates.
  //
  // Declared AFTER every hook above, so the early return cannot reorder them.
  if (!overlay.hasService && inspectedProposalError == null) {
    if (timingBlock == null) return null
    return (
      <div data-testid="merged-proposal-panel" style={panelStyle}>
        {timingBlock}
      </div>
    )
  }

  return (
    <div data-testid="merged-proposal-panel" style={panelStyle}>
      {/* Read-only trigger signal + car status (like the Proposal screen). */}
      <div data-testid="merged-status-strip" style={statusStripStyle}>
        <span>
          <span style={statusLabelStyle}>{t(LABELS.triggerSignal, lang)}:</span>{' '}
          <span data-testid="merged-status-trigger" style={statusValueStyle}>
            {t(purposeLabel(triggerPurpose), lang)}
          </span>
        </span>
        <span>
          <span style={statusLabelStyle}>{t(LABELS.carState, lang)}:</span>{' '}
          <span data-testid="merged-status-lifecycle" style={statusValueStyle}>
            {t(optionLabel('lifecycle_stage', lifecycleStage), lang)}
          </span>
          <span style={{ color: '#94a3b8' }}> · {t(LABELS.motion, lang)} </span>
          <span data-testid="merged-status-motion" style={statusValueStyle}>
            {t(optionLabel('motion_state', motionState), lang)}
          </span>
        </span>
      </div>

      {timingBlock}

      {/* The "Inspecting a quickview fire" badge was removed (owner review).
          Clearing an inspection is still one click — the map's trigger markers
          toggle, so clicking the selected one deselects it. */}
      {isInspecting && inspectedProposalError && (
        <div role="alert">
          <p style={{ color: '#dc2626', fontSize: '0.82em', margin: 0 }}>{t(LABELS.inspectedError, lang)}</p>
          <p style={{ color: '#991b1b', fontSize: '0.7em', margin: '2px 0 0', fontFamily: 'ui-monospace, monospace' }}>
            {t(LABELS.technicalDetail, lang)}: {inspectedProposalError}
          </p>
        </div>
      )}

      {overlay.hasService && (
        <>
          <div data-testid="proposal-split" style={splitStyle}>
          {/* LEFT — Service proposal */}
          <div data-testid="service-result-overlay" style={halfStyle}>
            <p style={halfTitleStyle}>① {t(LABELS.service, lang)}</p>
            <ServiceResultOverlay
              output={overlay.serviceOutput}
              eligibleCandidates={overlay.eligibleCandidates}
              activeServiceId={overlay.activeServiceId}
              choosingId={choosingId}
              onChoose={onChoose}
              onInspect={inspectService}
              runId={explanationRunId}
              explanationProvider={explanationProvider}
              inlineProposal={explanationInlineProposal}
              lang={lang}
            />
            {overlay.serviceError && (
              <div role="alert">
                <p style={{ color: '#dc2626', fontSize: '0.82em', margin: 0 }}>
                  {t(LABELS.algorithmErrorGeneric, lang)}
                </p>
                <p style={{ color: '#991b1b', fontSize: '0.7em', margin: '2px 0 0', fontFamily: 'ui-monospace, monospace' }}>
                  {t(LABELS.technicalDetail, lang)}: {overlay.serviceError.message}
                </p>
              </div>
            )}
          </div>

          {/* RIGHT — Content proposal */}
          <div style={{ ...halfStyle, borderLeft: '2px solid #e5e7eb', paddingLeft: '10px' }}>
            <p style={halfTitleStyle}>② {t(LABELS.content, lang)}</p>
            {hasContent ? (
              <div data-testid="content-result-overlay">
                <ContentResultOverlay
                  plan={overlay.contentPlan}
                  error={overlay.contentError ?? undefined}
                  songNames={songNames}
                  songArtists={songArtists}
                  onInspect={inspectContentItem}
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

const timingBlockStyle: React.CSSProperties = {
  flexShrink: 0,
  fontSize: '0.78em',
  color: '#334155',
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  padding: '6px 10px',
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
}
const timingWhenStyle: React.CSSProperties = { color: '#1d4ed8', fontWeight: 600 }
const timingArriveStyle: React.CSSProperties = { color: '#64748b' }
const timingRow1Style: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: '8px',
  flexWrap: 'wrap',
}
const timingRow2Style: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '4px 8px',
  alignItems: 'baseline',
}
const viewEventsButtonStyle: React.CSSProperties = {
  fontSize: '0.9em',
  fontWeight: 700,
  padding: '2px 10px',
  border: '1px solid #cbd5e1',
  borderRadius: '5px',
  background: '#fff',
  color: '#1d4ed8',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
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

/** Service and content SIDE BY SIDE at 40/60 (owner review) — content is wider
 *  because it carries more rows. Previously these were stacked in a column,
 *  which is why the split grid one level up had nothing to split. */
const splitStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 40fr) minmax(0, 60fr)',
  gap: '10px',
  alignItems: 'start',
  flex: '1 1 auto',
  minHeight: 0,
}

const halfStyle: React.CSSProperties = {
  minWidth: 0,
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

