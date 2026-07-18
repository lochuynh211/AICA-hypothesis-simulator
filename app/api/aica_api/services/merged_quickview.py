"""Merged quickview projection service — feature 020 (Combined Simulator),
Slice-2c, Task 3.

Runs ONE headless pass through the non-persisting trigger preview engine
(``services.preview.iter_preview_ticks`` — the same generator
``/api/runs/preview`` drives) and, at every actionable-proposal fire (rising
edge), projects a default quick-check proposal through the SAME
``create_proposal_run`` handler the interactive merged-run path uses —
entirely in memory (``cache={}``, feature 020 Slice-2c), so a single call
projects the whole merged chain without writing anything under
``runs/``/``proposal_runs/``.

Isolation (feature-020 plan, brief GLOBAL CONSTRAINTS): this module may
import ``services.preview`` (``PreviewFireEvent``/``iter_preview_ticks`` —
plain dicts/dataclass, no trigger Pydantic model surface),
``routers.proposal`` (``CreateProposalRunBody``/``create_proposal_run``),
``models.merged_run`` (its own body/result types), and the merged-only pure
helpers in ``services.merged_adapter`` (``build_world_from_tick``,
``map_trigger_purpose``, ``map_lifecycle_stage``) — it must NEVER import a
trigger Pydantic model (``models.run``/``models.package``/
``models.scenario``). ``route_facts``/``route_source``/``presets`` are
threaded straight through to ``iter_preview_ticks`` untyped (``Any``)
precisely so this module never needs the trigger ``RouteFacts``/preset
shapes — the caller (``routers/merged_runs.py``, which already straddles
both sides of the merge boundary for the sibling ``/api/merged-runs/plan``
endpoint) is responsible for building any painted route_facts/jam preset
(mountain/jam) via ``services.merged_painter`` BEFORE calling ``project``.

Deliberately does NOT import anything under ``models.proposal.*`` (not even
``ProposalRunMode``/``World`` — both are used only structurally, via
``body.world``/the plain string ``"quick_check"``, never referenced by
type): the existing isolation guard
(``tests/proposal/test_p1_isolation_imports.py``) auto-classifies any
``services/*.py`` module that imports ``aica_api.models.proposal*`` as
"proposal-scoped" and then forbids it from also importing anything under
``aica_api.models*`` that isn't ``aica_api.models.proposal`` — which would
collide with this module's own, necessary ``aica_api.models.merged_run``
import. Avoiding the ``models.proposal.*`` import entirely sidesteps that
guard rather than fighting it, with no loss of behavior (pydantic coerces
the plain string identically to the enum member).
"""
from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from pydantic import ValidationError

from aica_api.models.merged_run import MergedFirePoint, MergedInstantResult, MergedQuickviewBody
from aica_api.routers.proposal import CreateProposalRunBody, create_proposal_run
from aica_api.services.merged_adapter import build_world_from_tick, map_lifecycle_stage, map_trigger_purpose
from aica_api.services.preview import PreviewFireEvent, iter_preview_ticks

__all__ = ["project"]


def _project_fire(ev: PreviewFireEvent, body: MergedQuickviewBody) -> tuple[dict | None, str | None]:
    """Build and run ONE default quick-check proposal for a single fire episode.

    Returns ``(proposal_dict, proposal_error)`` — at most one is non-None.
    ``(None, None)`` when the fire's ``result_type`` has no mapped
    ``trigger_purpose`` (defensive: every fire ``iter_preview_ticks`` yields
    today is REST_PROPOSAL or MONOTONY_PROPOSAL, both mapped — see
    ``services/merged_adapter.py::map_trigger_purpose``). ``proposal_error``
    is set from a caught ``HTTPException`` (an unknown/mis-slotted
    service/content package id, an unresolvable matrix row, ...) exactly
    like ``routers/merged_runs.py``'s own ``/tick`` endpoint does for its
    single first-fire proposal.
    """
    purpose = map_trigger_purpose(ev.decision.result_type)
    if purpose is None:
        return None, None

    stage = map_lifecycle_stage(fired=True, result_type=ev.decision.result_type, recovery_phase=None)
    world = build_world_from_tick(
        body.world,
        ev.tick_state,
        trigger_purpose=purpose,
        lifecycle_stage=stage,
    )

    try:
        proposal_body = CreateProposalRunBody(
            world=world,
            trigger_purpose=purpose,
            lifecycle_stage=stage,
            motion_state=world.control_inputs.motion_state,
            service_package_id=body.service_package_id,
            content_package_id=body.content_package_id,
            mode="quick_check",  # ProposalRunMode.quick_check.value — see
            # module docstring for why this is a plain string, not the enum.
            run_seed=body.run_seed_proposal,
            simulation_time=ev.tick_index,
        )
    except ValidationError as exc:
        return None, str(exc)

    try:
        plog = create_proposal_run(proposal_body, cache={})
    except HTTPException as exc:
        return None, str(exc.detail)

    return plog.model_dump(mode="json"), None


def project(
    body: MergedQuickviewBody,
    *,
    packages_dir: Any,
    scenarios_dir: Any,
    route_facts: Any = None,
    route_source: str = "local",
    presets: dict[str, Any] | None = None,
) -> MergedInstantResult:
    """Run one headless trigger preview, projecting a default quick-check
    proposal at every actionable fire (rising edge).

    Nothing is persisted: the trigger side never touches ``runs_dir``
    (``iter_preview_ticks`` is the same non-persisting engine
    ``/api/runs/preview`` uses) and every projected proposal run is built
    with ``cache={}`` (feature 020, Slice-2c) — a fresh, isolated in-memory
    dict per fire, thrown away when this call returns.

    ``route_facts``/``route_source``/``presets`` are opaque pass-throughs to
    ``iter_preview_ticks`` (see module docstring) — the caller builds any
    painted route/jam BEFORE calling this.

    Raises:
        PreviewValidationError: propagated verbatim from
            ``iter_preview_ticks`` (unknown/incompatible package or
            scenario, an old-shape scenario, invalid hyperparameter
            overrides, ...).
    """
    ticks = iter_preview_ticks(
        package_id=body.package_id,
        scenario_id=body.scenario_id,
        hyperparameter_overrides=body.hyperparameter_overrides,
        run_seed=body.run_seed,
        rest_option_id=body.rest_option_id,
        packages_dir=packages_dir,
        scenarios_dir=scenarios_dir,
        route_source=route_source,
        route_facts=route_facts,
        presets=presets,
    )

    projected: list[tuple[dict | None, str | None]] = []
    try:
        while True:
            ev = next(ticks)
            projected.append(_project_fire(ev, body))
    except StopIteration as stop:
        result = stop.value

    # `iter_preview_ticks` deliberately empties its OWN `fires`/`spikes` to
    # `[]` whenever the run ends in an algorithm error (`result["error"]` set)
    # — even if one or more fires (and their PreviewFireEvent yields) already
    # happened earlier in the SAME run, before the later tick that errored.
    # Mirror that same "don't trust fires from an errored run" suppression
    # here: on error, `result["fires"]` (len 0) and `projected` (len == the
    # number of fires actually yielded before the error) can legitimately
    # disagree in length, so zipping them positionally would be wrong (and
    # `strict=True` would raise) — just report no fires, exactly like the
    # underlying trigger-only InstantResult does.
    if result["error"] is not None:
        merged_fires: list[MergedFirePoint] = []
    else:
        merged_fires = [
            MergedFirePoint(**fire, proposal=proposal, proposal_error=proposal_error)
            for fire, (proposal, proposal_error) in zip(result["fires"], projected, strict=True)
        ]

    return MergedInstantResult(**{**result, "fires": merged_fires})
