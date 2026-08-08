/**
 * Merged-run domain types — TS port of `app/api/aica_api/models/merged_run.py`
 * (feature 026, htmlapp Combined export, slice C4 Task 3).
 *
 * A "merged run" pairs one trigger run (deterministic tick engine,
 * `aica_api.models.run`) with the proposal simulator
 * (`aica_api.models.proposal.*`): each trigger fire may spawn or update a
 * proposal run, and `CorrelationEntry` records which trigger tick produced
 * which proposal run/events. These are pure type declarations — no runtime
 * code, no I/O — mirroring the fact that `merged_run.py` itself is a plain
 * Pydantic models module. The coordinator functions that build/persist a
 * `MergedRunHandle` (`makeMergedRunId`/`createHandle`/`saveHandle`/
 * `getHandle`) live in `../../storage/merged_runs_store.ts`, mirroring
 * `services/merged_run_coordinator.py`.
 *
 * ── Reuse, not rewrite ───────────────────────────────────────────────────
 * `FirePoint`, `ScoreSeriesPoint`, `SpikePoint`, `PreviewSegment`,
 * `PreviewRestSpot`, `PreviewRestOption`, `PreviewError`,
 * `PreviewOverrideEntry`, `ProgressPoint`, `PreviewTrafficJam`, `RestSpot`
 * already have byte-for-byte TS mirrors of their `run.py` Pydantic
 * counterparts in `../../api/types.ts` (verified field-by-field against
 * `app/api/aica_api/models/run.py` before reuse) — imported below rather
 * than redeclared. `World`/`world_template`/`world` (Python `dict`, or a
 * `World`-typed field that is only ever passed through opaquely here) are
 * kept as `Record<string, unknown>`, matching the established convention
 * for this port (`engine/proposal/run_manager.ts`'s `World`,
 * `engine/proposal/world_overrides.ts`'s `WorldDoc`, `engine/merged/
 * adapter.ts`'s own `World`) — no fully-typed TS mirror of
 * `models/proposal/world.py`'s nested `World` model exists anywhere in this
 * port, and building one is out of this task's scope (nothing here inspects
 * `world`'s internals; it is only ever constructed/forwarded whole).
 *
 * ── Divergence hazard pass ──────────────────────────────────────────────
 * This file has zero runtime logic (pure type declarations), so hazards
 * 1/2/3/5/6/7/8 (all about runtime computation — rounding, sorting, floor
 * division, float formatting, isinstance-on-bool, ...) do not apply to it;
 * they are audited instead in `../../storage/merged_runs_store.ts`, which
 * carries this slice's only runtime code for these models.
 * - Hazard 4 (dict/insertion order): field ORDER within these TS object
 *   types has no runtime effect (TS structural types aren't serialized by
 *   declaration order the way a Pydantic `model_dump()` is) — declared here
 *   in the SAME order as the Python class body purely for side-by-side
 *   diffability, not because order is load-bearing in this file.
 *
 * ── Two invariants from the C4 plan preamble, preserved here structurally
 * ──────────────────────────────────────────────────────────────────────
 * 1. `MergedInstantResult.fire` (singular) is deliberately typed as the
 *    PLAIN `FirePoint` (no `proposal`/`proposal_error`) — only `fires[]`
 *    entries are `MergedFirePoint`. Widening `fire` to `MergedFirePoint`
 *    for "consistency" would be a defect (see `merged_quickview.py`'s own
 *    docstring, ported in a later C4 task).
 * 2. `MergedFirePoint.proposal`/`proposal_error` and `MergedRestOption
 *    .after_rest_proposal`/`after_rest_proposal_error` are a three-state
 *    encoding in two nullable fields (proposal set / error set / both
 *    null) — both fields are independently nullable here on purpose; a
 *    later task's tests assert all three states, not this type file.
 */
import type {
  FirePoint,
  PreviewError,
  PreviewOverrideEntry,
  PreviewRestOption,
  PreviewRestSpot,
  PreviewSegment,
  PreviewTrafficJam,
  ProgressPoint,
  RestSpot,
  ScoreSeriesPoint,
  SignalSeriesPoint,
  SpikePoint,
} from '../../api/types'

// ---------------------------------------------------------------------------
// CorrelationEntry — merged_run.py:32-41
// ---------------------------------------------------------------------------

/** Links one trigger tick to the proposal run/events it produced.
 * `proposal_event_ids` has no natural id on a `DiscreteEvent` to reference,
 * so entries are keyed as `` `${event_type}@${at}` `` (built by a later C4
 * task's tick port, not here). */
export type CorrelationEntry = {
  trigger_tick_index: number
  proposal_run_id: string
  proposal_event_ids: string[]
}

// ---------------------------------------------------------------------------
// MergedRunHandle — merged_run.py:44-101
// ---------------------------------------------------------------------------

/** Persisted merged-run record — one Python `merged_runs/<merged_run_id>.json`
 * file; one htmlapp `merged_runs` IDB object store row (keyPath
 * `merged_run_id`) — see `../../storage/merged_runs_store.ts`.
 *
 * `world_template` is the INLINE proposal world fields used as a base for
 * each fire-spawned proposal run; GENERATED fields (e.g. situation values
 * derived from the trigger's tick state) are overwritten per fire by a
 * later task's `buildWorldFromTick` call. */
export type MergedRunHandle = {
  merged_run_id: string
  trigger_run_id: string
  world_template: Record<string, unknown>
  service_package_id: string
  content_package_id: string
  /** `"interactive" | "quick_check"` in practice (Python types this as a
   * bare `str`, not a `Literal`, so the port mirrors that looseness). */
  proposal_mode: string
  run_seed: string
  proposal_run_ids: string[]
  current_proposal_run_id: string | null
  // The trigger category (`selected_category`) the CURRENT proposal run was
  // spawned for. A fire of a DIFFERENT category is a different opportunity
  // and gets its own proposal run — without this the once-per-fire guard
  // latched onto whichever category fired first, so a run that reached
  // monotony and then escalated to rest silently dropped the rest
  // proposal. `null` on handles written before this field existed (and
  // before the first fire).
  current_proposal_category: string | null
  correlation_log: CorrelationEntry[]

  // Slice-2 core (Python Task 3): rest-journey auto-drive progress.
  // null       — no accept-rest issued yet (or scenario has no recovery_options).
  // "before"   — accept-rest issued; waiting for the trigger recovery to reach
  //              the rest spot (motion -> stopped).
  // "during"   — arrived; rest_spot_arrived/rest_started applied; waiting for
  //              the trigger recovery to complete (active -> inactive).
  // "after"    — rest_completed + the after-rest recompute have both run.
  // Guards the tick endpoint's auto-drive so each transition fires exactly
  // once, regardless of how many further ticks are issued afterward.
  rest_stage_synced: string | null
  // The nap-duration override supplied to accept-rest, if any (record-only —
  // the actual stage.ticks override lives on a per-run ScenarioDef copy
  // installed into the trigger run's own registry entry at accept-rest
  // time; the shared draft-registry ScenarioDef is never mutated).
  nap_minutes: number | null

  // feature 020 (Combined Simulator) service/content override plumbing:
  // non-default setup-time params/hyperparams for the proposal side.
  // Empty (default) means "use the package defaults" -- identical to the
  // pre-override behavior. `service_*` mirrors CreateProposalRunBody's
  // parameters/hyperparameters (the SERVICE selector's); `content_*`
  // mirrors SelectServiceBody's (the CONTENT selector's, applied at
  // content-dispatch time in interactive mode).
  service_parameters: Record<string, unknown>
  service_hyperparameters: Record<string, unknown>
  content_parameters: Record<string, unknown>
  content_hyperparameters: Record<string, unknown>

  // Recovery-semantics refactor (fixbug-0806): simulated-clock timestamp
  // (the trigger tick's `elapsed_seconds`) at which the CURRENT content
  // episode began, or `null` when nothing is playing. Used to end the
  // episode after the plan's own `expected_duration_sec` (CDC-SU slide 81
  // 一定曲数再生完了 / 1セット完了) — see `../merged/tick.ts`'s
  // `committedPlanDurationSec`/`tickMergedRun`. Never a wall clock — the
  // tick engine's clock is the only clock.
  content_started_elapsed_sec: number | null
}

// ---------------------------------------------------------------------------
// CreateMergedRunBody — merged_run.py:104-128
// ---------------------------------------------------------------------------

/** Request body to create a merged run. `trigger_plan_id` refers to a draft
 * already built via the existing run-plans setup flow; `world` seeds
 * `MergedRunHandle.world_template`. */
export type CreateMergedRunBody = {
  trigger_plan_id: string
  world: Record<string, unknown>
  service_package_id: string
  content_package_id: string
  proposal_mode: string
  run_seed: string
  service_parameters: Record<string, unknown>
  service_hyperparameters: Record<string, unknown>
  content_parameters: Record<string, unknown>
  content_hyperparameters: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// AcceptRestBody — merged_run.py:131-144
// ---------------------------------------------------------------------------

/** Request body for the accept-rest action. `nap_minutes`, when supplied,
 * overrides the chosen recovery option's nap STOPPED-stage duration. */
export type AcceptRestBody = {
  recovery_option_id: string
  rest_spot: RestSpot
  nap_minutes: number | null
}

// ---------------------------------------------------------------------------
// MergedProposalActionBody — merged_run.py:146-152
// ---------------------------------------------------------------------------

/** Request body for a proposal-side action taken during a merged run. */
export type MergedProposalActionBody = {
  kind: 'select_service' | 'journey_action'
  /** kind === 'select_service' */
  selected_service_id: string | null
  /** kind === 'journey_action' */
  action_type: string | null
  payload: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// MergedTickResponse — merged_run.py:155-165
// ---------------------------------------------------------------------------

/** Response for advancing a merged run by one trigger tick. `proposal`/
 * `correlation` are populated only when this tick's trigger fire created or
 * updated a proposal run. */
export type MergedTickResponse = {
  trigger: Record<string, unknown>
  /** A `ProposalRunLog`-shaped object when a fire created/updated one. */
  proposal: Record<string, unknown> | null
  correlation: CorrelationEntry | null
}

// ---------------------------------------------------------------------------
// Quickview projection types — merged_run.py:168-308
// ---------------------------------------------------------------------------

/** One trigger fire (rising edge), projected through a default,
 * non-persisting quick-check proposal. Extends the trigger-side
 * `FirePoint` with the proposal `merged_quickview.project` built for THIS
 * fire — `proposal` set when the fire's `result_type` had a mapped
 * `trigger_purpose` and the projection succeeded; `proposal_error` set to
 * the caught error detail when it had a mapped purpose but the projection
 * failed; both `null` only when `result_type` had no mapped
 * `trigger_purpose` at all (never both set — see this file's module
 * doc comment, invariant 2). */
export type MergedFirePoint = FirePoint & {
  proposal: Record<string, unknown> | null
  proposal_error: string | null
}

/** A projected auto-accepted rest, extended (feature 020 — clickable
 * journey dots) with the AFTER-REST proposal `merged_quickview.project`
 * builds from the recovered driver state (quick_check → both
 * service+content). `after_rest_proposal`/`after_rest_proposal_error`
 * mirror `MergedFirePoint.proposal`/`proposal_error`'s never-both-set
 * pairing (invariant 2). */
export type MergedRestOption = PreviewRestOption & {
  after_rest_proposal: Record<string, unknown> | null
  after_rest_proposal_error: string | null
}

/** Ephemeral, non-persisting projection of the WHOLE merged chain (feature
 * 020, Slice-2c): one headless trigger preview pass plus a default
 * quick-check proposal attached to every actionable fire. Same shape as
 * the trigger-only `InstantResult` (`../../api/types.ts`) except `fires`
 * carries a `MergedFirePoint` (with the projected proposal) per entry
 * instead of a bare `FirePoint` — the singular back-compat `fire` field
 * (first entry, unaugmented) is kept as a plain `FirePoint` ON PURPOSE
 * (invariant 1 above). Never persisted anywhere. */
export type MergedInstantResult = {
  fired: boolean
  fire: FirePoint | null
  fires: MergedFirePoint[]
  peak_score: number
  threshold: number | null
  score_series: ScoreSeriesPoint[]
  // Per-tick driver-state signals behind the curves (drowsiness/fatigue/
  // monotony) — what the Combined screen draws UNDER the road bar
  // (`models/run.py::SignalSeriesPoint`, threaded onto `MergedInstantResult`
  // by the same models change that added it to the trigger-only
  // `InstantResult`). Additive; empty is fine.
  signal_series: SignalSeriesPoint[]
  // Per-tick route-progress map (feature 020 — trigger-point alignment):
  // lets the quickview remap onto the DISTANCE axis so its fires align
  // with the live animation.
  progress: ProgressPoint[]
  monotony_series: ScoreSeriesPoint[]
  monotony_threshold: number | null
  spikes: SpikePoint[]
  segments: PreviewSegment[]
  traffic_jams: PreviewTrafficJam[]
  rest_spot: PreviewRestSpot | null
  rest_option: PreviewRestOption | null
  rest_spots: PreviewRestSpot[]
  rest_options: MergedRestOption[]
  completed_min: number | null
  seed: number
  overrides: PreviewOverrideEntry[]
  error: PreviewError | null
}

/** Request body for the merged quickview projection (feature 020,
 * Slice-2c). Trigger-side fields mirror the trigger preview body; `world`/
 * `service_package_id`/`content_package_id`/`run_seed_proposal` mirror
 * `CreateMergedRunBody.world`/`MergedRunHandle.world_template`'s role for
 * a real (persisted) merged run — `run_seed_proposal` is the proposal
 * side's OWN (string) run seed, distinct from the trigger's int
 * `run_seed` above (deliberately not coerced into one shared field).
 * `content_parameters`/`content_hyperparameters` are accepted for
 * symmetry with `CreateMergedRunBody` but are NOT wired into the
 * projected quick-check proposal's content dispatch on the Python side —
 * see `services/merged_quickview.py`'s module docstring (ported in a
 * later C4 task) for why. */
export type MergedQuickviewBody = {
  package_id: string
  scenario_id: string
  route_preset_id: string | null
  run_seed: number
  mountain_range_km: [number, number] | null
  jam_range_km: [number, number] | null
  jam_speed_kph: number
  hyperparameter_overrides: Record<string, unknown>
  rest_option_id: string | null
  // Setup pins. Without these the quickview projects from the scenario's
  // own defaults while the LIVE run starts from the pinned values, so the
  // two disagree on drowsiness/fatigue — visibly, on the same screen. All
  // optional (nullable) so an unpinned quickview behaves exactly as before.
  context_overrides: Record<string, unknown> | null
  initial_state: Record<string, unknown> | null
  profiles: Record<string, unknown> | null
  tick_seconds: number | null
  world: Record<string, unknown>
  service_package_id: string
  content_package_id: string
  run_seed_proposal: string
  service_parameters: Record<string, unknown>
  service_hyperparameters: Record<string, unknown>
  content_parameters: Record<string, unknown>
  content_hyperparameters: Record<string, unknown>
}
