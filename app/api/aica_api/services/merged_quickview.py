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


def _readable_error_text(detail: Any) -> str:
    """Best-effort plain-text rendering of an ``HTTPException.detail``.

    Mirrors ``routers/merged_runs.py``'s helper of the same name (kept as a
    private duplicate rather than a shared import — this module's own
    isolation guard forbids new cross-package imports beyond the ones its
    docstring already documents). ``detail`` is normally a
    ``{"code": ..., "message": ...}`` dict, or a list of such dicts, whose
    already-written human sentence lives under ``message`` (or, for a raw
    pydantic error entry, ``msg``); only when neither shape applies does this
    fall back to ``str(detail)``, so a caller never surfaces the raw Python
    dict/list repr (curly braces, single quotes) that ``str()``-ing the whole
    ``detail`` used to produce.
    """
    if isinstance(detail, dict):
        msg = detail.get("message")
        if isinstance(msg, str) and msg:
            return msg
    elif isinstance(detail, list) and detail:
        first = detail[0]
        if isinstance(first, dict):
            msg = first.get("message") or first.get("msg")
            if isinstance(msg, str) and msg:
                return msg
    if isinstance(detail, str):
        return detail
    return str(detail)


def _readable_validation_text(exc: ValidationError) -> str:
    """Plain-text rendering of a pydantic ``ValidationError`` — its default
    ``str()`` is a multi-line dump of raw field paths and type jargon (never
    localized, never natural language), so this surfaces just the first
    error's own message instead of that whole dump."""
    errors = exc.errors()
    if errors:
        msg = errors[0].get("msg")
        if isinstance(msg, str) and msg:
            return msg
    return str(exc)


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
            # feature 020 override plumbing: SERVICE parameters/
            # hyperparameters. Empty (default {}) is identical to
            # CreateProposalRunBody's own field defaults, so an existing
            # caller that omits them is unaffected. NOTE: body.content_parameters/
            # content_hyperparameters are deliberately NOT threaded here --
            # CreateProposalRunBody has no field for raw content parameters in
            # quick_check mode, and the one channel that can reach content
            # HYPERparameters (algorithm_config_overrides.content) requires
            # importing a proposal-scoped model (AlgorithmConfigOverrides,
            # under aica_api.models.proposal.preset) that this module's
            # isolation constraint forbids (see module docstring) — a real,
            # unresolved gap, not an oversight.
            parameters=body.service_parameters,
            hyperparameters=body.service_hyperparameters,
        )
    except ValidationError as exc:
        return None, _readable_validation_text(exc)

    try:
        plog = create_proposal_run(proposal_body, cache={})
    except HTTPException as exc:
        return None, _readable_error_text(exc.detail)

    return plog.model_dump(mode="json"), None


def _project_after_rest(tick_state: Any, body: MergedQuickviewBody) -> tuple[dict | None, str | None]:
    """Build ONE quick-check proposal for the AFTER-NAP moment of a projected
    rest (feature 020 — the clickable purple "after-nap" journey dot), from the
    recovered driver state captured on the last stopped recovery tick.

    Modeled as the SAME rest journey that started this recovery:
    ``trigger_purpose="rest_recommended"`` at ``lifecycle_stage=
    "after_rest_before_restart"`` (the "after spot" stage — frozen §7.5 matrix
    row 3), motion left as the captured ``stopped`` state. This is the genuine
    after-nap proposal: the after-rest service row (live_viewing / stretch_video /
    full_karaoke / oshi_reexperience / call_response_stopped) is ranked and, when
    the top service isn't one the single wired music content package can serve,
    the content step surfaces an honest ``unsupported_service`` error inside the
    run (never a faked plan — CLAUDE.md). quick_check dispatches service + content
    in one call. Returns ``(proposal_dict, proposal_error)`` — at most one
    non-None (``proposal_error`` only on a caught ``HTTPException``, e.g. a
    mis-slotted package; an in-run content error is carried in the proposal's own
    evidence, not here).

    NOTE (owner decision, feature 020): the green "driving-after-rest" dot was
    dropped — under ``rest_recommended`` the frozen §7.5 matrix has no
    ``active_driving_content`` row, and the real journey keeps a resumed drive at
    ``after_rest_before_restart`` (only motion flips), so there is no distinct
    matrix-valid proposal to project for it. Only the purple after-nap dot is
    clickable."""
    purpose = "rest_recommended"
    stage = "after_rest_before_restart"
    # The captured tick is the last STOPPED recovery tick, so build_world_from_tick
    # copies motion=stopped — exactly the after-nap state; no override needed.
    world = build_world_from_tick(body.world, tick_state, trigger_purpose=purpose, lifecycle_stage=stage)
    try:
        proposal_body = CreateProposalRunBody(
            world=world,
            trigger_purpose=purpose,
            lifecycle_stage=stage,
            motion_state=world.control_inputs.motion_state,
            service_package_id=body.service_package_id,
            content_package_id=body.content_package_id,
            mode="quick_check",
            run_seed=body.run_seed_proposal,
            simulation_time=0,
            parameters=body.service_parameters,
            hyperparameters=body.service_hyperparameters,
        )
    except ValidationError as exc:
        return None, _readable_validation_text(exc)
    try:
        plog = create_proposal_run(proposal_body, cache={})
    except HTTPException as exc:
        return None, _readable_error_text(exc.detail)
    return plog.model_dump(mode="json"), None



def _with_tick_seconds(presets: dict[str, Any] | None, tick_seconds: int | None) -> dict[str, Any] | None:
    """Fold a pinned tick duration into the presets the tick engine receives.

    `tick_seconds` travels in `presets` on the live-run path too, so folding it
    here keeps the projection and the run on the same clock. An unset value
    leaves `presets` untouched.
    """
    if tick_seconds is None:
        return presets
    return {**(presets or {}), "tick_seconds": tick_seconds}

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
    # fixbug-0806: discover the content service the proposal selector actually
    # picks at the first actionable fire, so the projected recovery curve below
    # uses the SAME service the live merged run will play (its
    # _derive_content_context reads the proposal's active_service_id). Without
    # this the curve uses the scenario's default_content_service_id while the
    # live run — and this projection's OWN proposal cards — use the selector's
    # pick, so the two Combined-screen charts diverge whenever those services
    # have different per-service recovery rates.
    #
    # Known limitation (documented, not hidden — CLAUDE.md "no silent caps"): a
    # single service is used for the WHOLE projection. If the monotony proposal
    # and the rest proposal were to pick DIFFERENT services, the pre-rest episode
    # would still use the monotony pick. In every shipped scenario both pick the
    # same service, and the recovery feedback loop is only fully modelled for the
    # first episode — matching how faithfully the live run's first episode is
    # reproduced.
    _discovery = iter_preview_ticks(
        package_id=body.package_id,
        scenario_id=body.scenario_id,
        hyperparameter_overrides=body.hyperparameter_overrides,
        run_seed=body.run_seed,
        rest_option_id=body.rest_option_id,
        packages_dir=packages_dir,
        scenarios_dir=scenarios_dir,
        route_source=route_source,
        route_facts=route_facts,
        presets=_with_tick_seconds(presets, body.tick_seconds),
        profiles=body.profiles,
        context_overrides=body.context_overrides,
        initial_state=body.initial_state,
    )
    selected_service_id: str | None = None
    try:
        first_ev = next(_discovery)
        _proposal, _err = _project_fire(first_ev, body)
        if _proposal is not None:
            selected_service_id = (_proposal.get("journey_state") or {}).get("active_service_id")
    finally:
        _discovery.close()

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
        presets=_with_tick_seconds(presets, body.tick_seconds),
        profiles=body.profiles,
        context_overrides=body.context_overrides,
        initial_state=body.initial_state,
        content_service_id=selected_service_id,
    )

    projected: list[tuple[dict | None, str | None]] = []
    try:
        while True:
            ev = next(ticks)
            projected.append(_project_fire(ev, body))
    except StopIteration as stop:
        result = stop.value

    # feature 020 — clickable journey dots: iter_preview_ticks stashes the
    # recovered driver `tick_state` (private `_post_rest_tick_state`) on each
    # projected auto-accepted rest. Pop it (it must NEVER reach the response —
    # the models are extra=allow) and, when the run didn't end in an algorithm
    # error, project the AFTER-REST proposal (both service + content) the
    # purple/green dots reveal. `rest_option` (singular) IS `rest_options[0]`
    # (same dict object — see services/preview.py), so mutating the list entry
    # cleans/augments the singular alias too.
    for opt in result.get("rest_options", []):
        post_tick = opt.pop("_post_rest_tick_state", None)
        if post_tick is not None and result["error"] is None:
            proposal, proposal_error = _project_after_rest(post_tick, body)
            opt["after_rest_proposal"] = proposal
            opt["after_rest_proposal_error"] = proposal_error

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
