"""Merged-run domain models — feature 020 (Combined Simulator), Task 1: slice1 run models.

A "merged run" pairs one trigger run (deterministic tick engine, `aica_api.models.run`)
with the proposal simulator (`aica_api.models.proposal.*`): each trigger fire may spawn
or update a proposal run, and `CorrelationEntry` records which trigger tick produced
which proposal run/events. These models only shape that pairing — the merged-runs
router (a later task) owns persistence (`merged_runs/<merged_run_id>.json`) and the
tick/action orchestration itself.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from aica_api.models.proposal.world import World
from aica_api.models.run import (
    FirePoint,
    PreviewError,
    PreviewRestOption,
    PreviewRestSpot,
    PreviewSegment,
    PreviewTrafficJam,
    ProgressPoint,
    RestSpot,
    ScoreSeriesPoint,
    SpikePoint,
)


class CorrelationEntry(BaseModel):
    """Links one trigger tick to the proposal run/events it produced.

    `proposal_event_ids` has no natural id on `DiscreteEvent` to reference, so
    entries are keyed as ``f"{event_type}@{at}"``.
    """

    trigger_tick_index: int
    proposal_run_id: str
    proposal_event_ids: list[str] = []


class MergedRunHandle(BaseModel):
    """Persisted merged-run record — `merged_runs/<merged_run_id>.json`.

    `world_template` is `World.model_dump()`: the INLINE proposal world fields used
    as a base for each fire-spawned proposal run; GENERATED fields (e.g. situation
    values derived from the trigger's tick state) are overwritten per fire.
    """

    merged_run_id: str
    trigger_run_id: str
    world_template: dict
    service_package_id: str
    content_package_id: str
    proposal_mode: str = "interactive"  # interactive | quick_check
    run_seed: str
    proposal_run_ids: list[str] = []
    current_proposal_run_id: str | None = None
    # The trigger category (`selected_category`) the CURRENT proposal run was
    # spawned for. A fire of a DIFFERENT category is a different opportunity and
    # gets its own proposal run — without this the once-per-fire guard latched on
    # whichever category fired first, so a run that reached monotony and then
    # escalated to rest silently dropped the rest proposal. None on handles
    # written before this field existed (and before the first fire).
    current_proposal_category: str | None = None
    correlation_log: list[CorrelationEntry] = []

    # Slice-2 core (Task 3): rest-journey auto-drive progress.
    # None       — no accept-rest issued yet (or scenario has no recovery_options).
    # "before"   — accept-rest issued; waiting for the trigger recovery to reach
    #              the rest spot (motion -> stopped).
    # "during"   — arrived; rest_spot_arrived/rest_started applied; waiting for
    #              the trigger recovery to complete (active -> inactive).
    # "after"    — rest_completed + the after-rest recompute have both run.
    # Guards the tick endpoint's auto-drive so each transition fires exactly
    # once, regardless of how many further ticks are issued afterward.
    rest_stage_synced: str | None = None
    # The nap-duration override supplied to accept-rest, if any (record-only —
    # the actual stage.ticks override lives on a per-run ScenarioDef COPY
    # installed into the trigger run's own registry entry via
    # run_manager.replace_scenario at accept-rest time; the shared
    # run_plan._draft_registry[plan_id] ScenarioDef is never mutated, so
    # another run created from the same plan_id is unaffected).
    nap_minutes: int | None = None

    # feature 020 (Combined Simulator) service/content override plumbing:
    # non-default setup-time params/hyperparams for the proposal side, carried
    # from CreateMergedRunBody so the fire-spawned proposal run (SERVICE, at
    # tick-fire creation) and the later content dispatch (proposal-action
    # select_service) can use them instead of each package's own defaults.
    # Empty (default) means "use the package defaults" -- identical to today's
    # behavior. `service_*` mirrors CreateProposalRunBody.parameters/
    # hyperparameters (the SERVICE selector's); `content_*` mirrors
    # SelectServiceBody.parameters/hyperparameters (the CONTENT selector's,
    # applied at content-dispatch time in interactive mode).
    service_parameters: dict = {}
    service_hyperparameters: dict = {}
    content_parameters: dict = {}
    content_hyperparameters: dict = {}


class CreateMergedRunBody(BaseModel):
    """Request body to create a merged run.

    `trigger_plan_id` refers to a draft already built via the existing
    `POST /api/run-plans`; `world` is the base `World` template (typed) that seeds
    `MergedRunHandle.world_template`.

    `service_parameters`/`service_hyperparameters` and `content_parameters`/
    `content_hyperparameters` (feature 020 override plumbing) are optional,
    additive setup-time overrides for the paired proposal run's service and
    content selectors respectively -- empty (default `{}`) means "use each
    package's own defaults", byte-identical to pre-override behavior. See
    `MergedRunHandle`'s matching fields for how they are threaded through.
    """

    trigger_plan_id: str
    world: World
    service_package_id: str
    content_package_id: str
    proposal_mode: str = "interactive"
    run_seed: str
    service_parameters: dict = {}
    service_hyperparameters: dict = {}
    content_parameters: dict = {}
    content_hyperparameters: dict = {}


class AcceptRestBody(BaseModel):
    """Request body for ``POST /api/merged-runs/{id}/accept-rest``.

    ``nap_minutes``, when supplied, overrides the chosen recovery option's
    nap STOPPED stage duration (see ``routers/merged_runs.py``'s
    ``accept_rest_endpoint``) — the ticks are derived as
    ``round(nap_minutes * 60 / scenario.tick_seconds)`` and applied to a
    per-run ``ScenarioDef`` copy before the trigger recovery starts.
    """

    recovery_option_id: str
    rest_spot: RestSpot
    nap_minutes: int | None = None


class MergedProposalActionBody(BaseModel):
    """Request body for a proposal-side action taken during a merged run."""

    kind: Literal["select_service", "journey_action"]
    selected_service_id: str | None = None  # kind=select_service
    action_type: str | None = None  # kind=journey_action
    payload: dict = Field(default_factory=dict)


class MergedTickResponse(BaseModel):
    """Response for advancing a merged run by one trigger tick.

    `trigger` mirrors the shape `routers/runs.py`'s tick endpoint returns.
    `proposal`/`correlation` are populated only when this tick's trigger fire
    created or updated a proposal run.
    """

    trigger: dict
    proposal: dict | None = None  # ProposalRunLog.model_dump() when a fire created/updated one
    correlation: CorrelationEntry | None = None


# ---------------------------------------------------------------------------
# Quickview projection — feature 020, Slice-2c (Task 3)
# ---------------------------------------------------------------------------


class MergedFirePoint(FirePoint):
    """One trigger fire (rising edge), projected through a default,
    non-persisting quick-check proposal.

    Extends the trigger-side ``FirePoint`` (``category``/``strength``/
    ``tick``/``time_min``) with the proposal ``merged_quickview.project``
    built for THIS fire — ``ProposalRunLog.model_dump()`` when
    ``create_proposal_run(..., cache={})`` succeeded, else ``None`` with
    ``proposal_error`` set to the caught ``HTTPException.detail`` (never
    both set, and both ``None`` only when the fire's ``result_type`` had no
    mapped ``trigger_purpose`` — see ``services/merged_adapter.py
    ::map_trigger_purpose``).
    """

    proposal: dict | None = None
    proposal_error: str | None = None


class MergedRestOption(PreviewRestOption):
    """A projected auto-accepted rest, extended (feature 020 — clickable
    journey dots) with the AFTER-REST proposal ``merged_quickview.project``
    builds from the recovered driver state (quick_check → both service+content).
    ``dict | None`` (``ProposalRunLog.model_dump()``) mirrors ``MergedFirePoint
    .proposal``; ``after_rest_proposal_error`` carries a caught
    ``HTTPException.detail`` instead (never both set)."""

    after_rest_proposal: dict | None = None
    after_rest_proposal_error: str | None = None


class MergedInstantResult(BaseModel):
    """Ephemeral, non-persisting projection of the WHOLE merged chain
    (feature 020, Slice-2c): one headless trigger preview pass
    (``services.preview.iter_preview_ticks``) plus a default quick-check
    proposal attached to every actionable fire.

    Same shape as ``aica_api.models.run.InstantResult`` (the trigger-only
    preview result) except ``fires`` carries a ``MergedFirePoint`` (with the
    projected proposal) per entry instead of a bare ``FirePoint`` — the
    singular back-compat ``fire`` field (first entry, unaugmented) is kept
    as a plain ``FirePoint`` on purpose (mirrors ``InstantResult.fire``,
    which the setup-strip UI reads for its "first trigger" marker without
    caring about a proposal). Never persisted anywhere: not the trigger run
    (``iter_preview_ticks`` is the same non-persisting engine
    ``/api/runs/preview`` uses), not any projected proposal run (built with
    ``cache={}`` — feature 020, Slice-2c's in-memory stand-in for disk).
    """

    fired: bool
    fire: FirePoint | None = None
    fires: list[MergedFirePoint] = []
    peak_score: float
    threshold: float | None = None
    score_series: list[ScoreSeriesPoint] = []
    # Per-tick route-progress map (feature 020 — trigger-point alignment): lets the
    # quickview remap onto the DISTANCE axis so its fires align with the live animation.
    progress: list[ProgressPoint] = []
    monotony_series: list[ScoreSeriesPoint] = []
    monotony_threshold: float | None = None
    spikes: list[SpikePoint] = []
    segments: list[PreviewSegment] = []
    traffic_jams: list[PreviewTrafficJam] = []
    rest_spot: PreviewRestSpot | None = None
    rest_option: PreviewRestOption | None = None
    rest_spots: list[PreviewRestSpot] = []
    rest_options: list[MergedRestOption] = []
    completed_min: float | None = None
    seed: int
    overrides: list[dict[str, Any]] = []
    error: PreviewError | None = None


class MergedQuickviewBody(BaseModel):
    """Request body for ``POST /api/merged-runs/quickview`` (feature 020,
    Slice-2c, Task 3).

    Trigger-side fields (``package_id``/``scenario_id``/``run_seed``/
    ``hyperparameter_overrides``/``rest_option_id``) mirror
    ``aica_api.routers.runs.PreviewRunBody`` — this drives the SAME
    non-persisting ``iter_preview_ticks`` engine. ``route_preset_id``/
    ``mountain_range_km``/``jam_range_km``/``jam_speed_kph`` mirror
    ``CreateMergedPlanBody`` (``routers/merged_runs.py``) — an ad-hoc
    "painted" route (mountain segment / manual traffic jam), built the SAME
    way ``POST /api/merged-runs/plan`` does, BEFORE the preview tick loop
    runs.

    ``world`` is the INLINE proposal ``World`` template whose GENERATED
    situation/control fields (drowsiness, road_type, ...) get overwritten
    per fire by ``build_world_from_tick`` — the same role
    ``CreateMergedRunBody.world``/``MergedRunHandle.world_template`` plays
    for a real (persisted) merged run. ``service_package_id``/
    ``content_package_id`` select the proposal selectors; ``run_seed_proposal``
    is the proposal side's OWN run_seed (``ProposalOpportunity.run_seed`` is
    ``str``-typed — distinct from the trigger's int ``run_seed`` above, so
    both are threaded independently rather than coercing one into the
    other).

    ``service_parameters``/``service_hyperparameters`` (feature 020 override
    plumbing) are additive setup-time overrides for each projected fire's
    quick-check proposal's SERVICE selector -- empty (default ``{}``) means
    "use the service package's own defaults", byte-identical to pre-override
    behavior. ``content_parameters``/``content_hyperparameters`` are accepted
    for symmetry with ``CreateMergedRunBody`` but are NOT currently wired into
    the projected quick-check proposal's content dispatch -- see
    ``services/merged_quickview.py``'s module docstring for why (the only
    content-hyperparameter override channel ``create_proposal_run`` exposes,
    ``algorithm_config_overrides.content``, requires importing a
    proposal-scoped model this module's isolation constraint forbids; there
    is no channel at all for raw content ``parameters`` in quick_check mode).
    """

    package_id: str
    scenario_id: str
    route_preset_id: str | None = None
    run_seed: int
    mountain_range_km: tuple[float, float] | None = None
    jam_range_km: tuple[float, float] | None = None
    jam_speed_kph: float = 15.0
    hyperparameter_overrides: dict[str, Any] = {}
    rest_option_id: str | None = None
    # Setup pins. Without these the quickview projects from the scenario's own
    # defaults while the LIVE run starts from the pinned values, so the two
    # disagree on drowsiness/fatigue — visibly, on the same screen. All optional
    # so an unpinned quickview behaves exactly as before.
    context_overrides: dict[str, Any] | None = None
    initial_state: dict[str, Any] | None = None
    profiles: dict[str, Any] | None = None
    tick_seconds: int | None = None
    world: World
    service_package_id: str
    content_package_id: str
    run_seed_proposal: str
    service_parameters: dict[str, Any] = {}
    service_hyperparameters: dict[str, Any] = {}
    content_parameters: dict[str, Any] = {}
    content_hyperparameters: dict[str, Any] = {}
