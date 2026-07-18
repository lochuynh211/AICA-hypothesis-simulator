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


class CreateMergedRunBody(BaseModel):
    """Request body to create a merged run.

    `trigger_plan_id` refers to a draft already built via the existing
    `POST /api/run-plans`; `world` is the base `World` template (typed) that seeds
    `MergedRunHandle.world_template`.
    """

    trigger_plan_id: str
    world: World
    service_package_id: str
    content_package_id: str
    proposal_mode: str = "interactive"
    run_seed: str


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
    monotony_series: list[ScoreSeriesPoint] = []
    monotony_threshold: float | None = None
    spikes: list[SpikePoint] = []
    segments: list[PreviewSegment] = []
    rest_spot: PreviewRestSpot | None = None
    rest_option: PreviewRestOption | None = None
    rest_spots: list[PreviewRestSpot] = []
    rest_options: list[PreviewRestOption] = []
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
    world: World
    service_package_id: str
    content_package_id: str
    run_seed_proposal: str
