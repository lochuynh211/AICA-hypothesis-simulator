"""Merged-run domain models — feature 020 (Combined Simulator), Task 1: slice1 run models.

A "merged run" pairs one trigger run (deterministic tick engine, `aica_api.models.run`)
with the proposal simulator (`aica_api.models.proposal.*`): each trigger fire may spawn
or update a proposal run, and `CorrelationEntry` records which trigger tick produced
which proposal run/events. These models only shape that pairing — the merged-runs
router (a later task) owns persistence (`merged_runs/<merged_run_id>.json`) and the
tick/action orchestration itself.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from aica_api.models.proposal.world import World
from aica_api.models.run import RestSpot


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
