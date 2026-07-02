/**
 * Evidence export service — derives the §14.2 EvidenceReport from a run's
 * RunLog. Ported from `app/api/aica_api/services/evidence.py`
 * (`build_evidence_report`), behavior-of-record.
 *
 * Design constraints (mirrors the Python docstring):
 *   - The report is a DERIVED view — it is NEVER persisted.
 *   - Separation invariant: FeedbackEvents appear ONLY under human_review;
 *     simulator_facts NEVER contains a feedback value.
 *   - Conditional sections (final_parameters, final_hyperparameters) are
 *     omitted when not applicable (i.e. current === initial). V1 never uses
 *     expert_override_events / run_comparison_reference, so those sections
 *     are always omitted, exactly like the Python (they're V1-unused too).
 *   - Pre-M5 runs with no driver/vehicle/speed profiles export them as null
 *     — never an error.
 *   - The report MUST NOT claim the simulator independently judged the
 *     algorithm.
 *
 * Substrate difference from Python: `build_evidence_report` is a pure
 * function taking an already-resolved `RunLog` plus a router-generated
 * `report_id`/`timestamp` (see runs.py @619-651 — report_id/timestamp are
 * generated at the ROUTER boundary, never inside the pure service
 * function). This offline build has no separate router layer, so
 * `buildEvidenceReport` folds that router-boundary responsibility in:
 * it resolves the run log via `getActiveRunLog` (mirrors
 * `_resolve_run_log`'s active-registry branch — this build has no on-disk
 * `runs/{id}.json` fallback path to port; every run this seam can reach is
 * either active or does not exist) and generates report_id/timestamp itself,
 * OUTSIDE any decision-affecting path (report generation never feeds back
 * into the tick loop), exactly like `_make_report_id()`/`datetime.now()` at
 * the Python router boundary.
 *
 * MAP KEY EXCLUSION (master invariant): nothing in RunLog ever carries a
 * Google Maps API key (the key is never persisted — see maps_client.ts /
 * routes.py), so nothing here can leak one either; this module never reads
 * settingsStore or any key material.
 */
import type {
  ActionEvent,
  AlgorithmErrorEvent,
  EvidenceHumanReview,
  EvidenceReport,
  EvidenceSimulatorFacts,
  FeedbackEvent,
  TickEvent,
} from '../../api/types'
import { getActiveRunLog, RunNotFoundError, type RunLogM2 } from '../run_manager'

// ---------------------------------------------------------------------------
// EvidenceReport M2 extension — speed_profile/profile_overrides are genuinely
// absent from the synced ../../api/types.ts EvidenceSimulatorFacts (M1/M5-era
// shape; U5 added profile_overrides to RunLog itself but the evidence-report
// type was never updated to match — see RunLogM2's own note in run_manager.ts
// for the same class of gap). Mirrors that module's local-extension pattern
// rather than editing the synced file.
// ---------------------------------------------------------------------------

export type EvidenceSimulatorFactsM2 = EvidenceSimulatorFacts & {
  speed_profile: Record<string, unknown> | null
  profile_overrides: Record<string, unknown> | null
}

export type EvidenceReportM2 = EvidenceReport & {
  simulator_facts: EvidenceSimulatorFactsM2
}

// ---------------------------------------------------------------------------
// report_id generation — outside the deterministic decision path, exactly
// like Python's `_make_report_id()` (wall clock + random suffix) at the
// router boundary. Uniqueness (not exact format) is the only contract any
// caller depends on — mirrors client.ts's `makeRunId()` rationale.
// ---------------------------------------------------------------------------

let _reportIdCounter = 0

function makeReportId(): string {
  _reportIdCounter += 1
  return `report_${String(_reportIdCounter).padStart(6, '0')}`
}

/** Structural (JSON-shape) deep equality — mirrors Python's `dict != dict`. */
function deepEqualJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Derive the §14.2 evidence report from a run's RunLog (resolved via
 * `getActiveRunLog`).
 *
 * @param runId      The active run identifier.
 * @param uiLanguage The reviewer's selected UI language at export time (e.g.
 *                   `"ja"`, `"en"`). Defaults to `"bilingual"` — matching
 *                   Python's back-compat default for pre-M6 callers.
 * @throws RunNotFoundError if runId is not in the active registry.
 */
export async function buildEvidenceReport(
  runId: string,
  uiLanguage: string = 'bilingual',
): Promise<EvidenceReportM2> {
  const runLog = await getActiveRunLog(runId)
  if (runLog === null) {
    throw new RunNotFoundError(`Run '${runId}' not found`)
  }

  const reportId = makeReportId()
  const timestamp = new Date().toISOString()

  return buildFromRunLog(runLog, reportId, timestamp, uiLanguage)
}

/**
 * Pure derivation — mirrors Python's `build_evidence_report(run_log, *,
 * report_id, timestamp, ui_language)` exactly, given an already-resolved
 * RunLog and router-generated report_id/timestamp. Kept as a separate
 * (non-exported) helper purely for internal readability; `buildEvidenceReport`
 * above is the only public seam, matching the interface contract.
 */
function buildFromRunLog(
  runLog: RunLogM2,
  reportId: string,
  timestamp: string,
  uiLanguage: string = 'bilingual',
): EvidenceReportM2 {
  // ── Partition events by kind ────────────────────────────────────────────
  const tickEvents: TickEvent[] = []
  const actionEvents: ActionEvent[] = []
  const algorithmErrors: AlgorithmErrorEvent[] = []
  const feedbackEvents: FeedbackEvent[] = []

  for (const event of runLog.events) {
    const kind = event.kind
    if (kind === 'tick') {
      tickEvents.push(event as TickEvent)
    } else if (kind === 'action') {
      actionEvents.push(event as ActionEvent)
    } else if (kind === 'algorithm_error') {
      algorithmErrors.push(event as AlgorithmErrorEvent)
    } else if (kind === 'feedback') {
      feedbackEvents.push(event as FeedbackEvent)
    }
    // Unknown kinds are silently ignored (forward-compat)
  }

  // ── simulator_facts derivations ─────────────────────────────────────────

  // timeline_events = all NON-feedback events in their recorded order
  const timelineEvents = runLog.events.filter((e) => e.kind !== 'feedback')

  // decision_trace = {tick_index, decision_result} for every TickEvent
  const decisionTrace = tickEvents.map((e) => ({
    tick_index: e.tick_index,
    decision_result: e.trace.decision_result,
  }))

  // proposal_events = TickEvents where fire_control.fired=True AND proposal is not null
  const proposalEvents = tickEvents.filter(
    (e) => e.trace.decision_result.fire_control.fired && e.trace.decision_result.proposal !== null,
  )

  const actions = actionEvents
  const algErrors = algorithmErrors

  // ── Conditional parameters / hyperparameters ────────────────────────────
  const simulatorFacts: EvidenceSimulatorFactsM2 = {
    route_snapshot: runLog.display_route ?? null,
    route_facts: runLog.route_facts,
    event_plan: runLog.event_plan,
    run_mode: runLog.run_mode,
    evidence_status: runLog.evidence_status,
    initial_parameters: runLog.initial_parameters,
    initial_hyperparameters: runLog.initial_hyperparameters,
    // Pre-M5 runs export profiles as null — no error (RunLog fields default null)
    driver_profile: runLog.driver_profile,
    vehicle_profile: runLog.vehicle_profile,
    // speed_profile / profile_overrides: null for pre-M5/pre-U5 runs (back-compat)
    speed_profile: runLog.speed_profile,
    profile_overrides: runLog.profile_overrides,
    timeline_events: timelineEvents,
    decision_trace: decisionTrace,
    proposal_events: proposalEvents,
    actions,
    algorithm_errors: algErrors,
  }

  // final_parameters: only when different from initial (setup change)
  if (!deepEqualJson(runLog.current_parameters, runLog.initial_parameters)) {
    simulatorFacts.final_parameters = runLog.current_parameters
  }

  // final_hyperparameters: only when different from initial
  if (!deepEqualJson(runLog.current_hyperparameters, runLog.initial_hyperparameters)) {
    simulatorFacts.final_hyperparameters = runLog.current_hyperparameters
  }

  // expert_override_events: V1 — not used; omit section entirely
  // run_comparison_reference: V1 — not used; omit section entirely

  // ── human_review (ONLY place feedback values appear) ───────────────────
  const feedbackLabels = feedbackEvents.map((e) => ({
    target: e.target,
    labels: e.labels,
  }))

  const freeTextComments = feedbackEvents
    .filter((e) => e.comment != null)
    .map((e) => ({
      target: e.target,
      comment: e.comment as string,
    }))

  const humanReview: EvidenceHumanReview = {
    feedback_labels: feedbackLabels,
    free_text_comments: freeTextComments,
  }

  // ── Assemble final report ───────────────────────────────────────────────
  return {
    report_id: reportId,
    run_id: runLog.run_id,
    timestamp,
    ui_language: uiLanguage,
    simulator_version: runLog.simulator_version,
    package: {
      id: runLog.snapshot.package.id,
      version: runLog.snapshot.package.version,
    },
    scenario: {
      id: runLog.snapshot.scenario.id,
      version: runLog.snapshot.scenario.version,
    },
    simulator_facts: simulatorFacts,
    human_review: humanReview,
  }
}
