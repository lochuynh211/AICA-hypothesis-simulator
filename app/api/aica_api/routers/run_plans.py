"""Run-plans router — /api/run-plans.

M4 changes:
- CreateRunPlanBody gains route_id, route_source, display_route.
- Maps selection contract (stateless): frontend passes the chosen alternative
  back with {route_id, route_source:"maps", route_facts, display_route}.
  The router validates the selection and threads it into create_draft.
- Local selection: route_source omitted or "local" → existing behavior.
- Unknown/missing selection for maps request → 400.
- No API key anywhere in the router or draft.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from aica_api.config import settings
from aica_api.models.run import DisplayRoute, RouteFacts
from aica_api.services.package_registry import PackageRegistry
from aica_api.services.run_plan import create_draft, get_draft_entry, regenerate_draft
from aica_api.services.scenario_registry import ScenarioRegistry

router = APIRouter()


# ── Plan-ID generation (only place timestamps/randomness allowed) ─────────────


def _make_plan_id() -> str:
    """Generate a unique plan_id: plan_<YYYYMMDD-HHMMSS>_<6-hex>."""
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    rand = os.urandom(3).hex()
    return f"plan_{ts}_{rand}"


# ── Request body models ───────────────────────────────────────────────────────


class CreateRunPlanBody(BaseModel):
    package_id: str
    scenario_id: str
    route_facts: Any = None  # optional; computed locally if absent (local path)
    presets: dict = {}
    profiles: Any = None
    parameters: dict = {}
    hyperparameters: dict = {}
    run_mode: str = "standard"

    # M4: route selection fields (all optional; local path if route_source absent / "local")
    route_id: str | None = None     # "local" or "route-0"…"route-2"
    route_source: str = "local"     # "local" | "maps"
    display_route: Any = None       # DisplayRoute dict from maps selection (None for local)


class RegenerateRunPlanBody(BaseModel):
    presets: dict = {}
    parameters: dict = {}
    hyperparameters: dict = {}


# ── Helpers ───────────────────────────────────────────────────────────────────


def _coerce_route_facts(raw: Any) -> RouteFacts | None:
    """Coerce a raw dict (from JSON body) to a RouteFacts model, or return None."""
    if raw is None:
        return None
    if isinstance(raw, RouteFacts):
        return raw
    return RouteFacts.model_validate(raw)


def _coerce_display_route(raw: Any) -> DisplayRoute | None:
    """Coerce a raw dict (from JSON body) to a DisplayRoute model, or return None."""
    if raw is None:
        return None
    if isinstance(raw, DisplayRoute):
        return raw
    return DisplayRoute.model_validate(raw)


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.post("/api/run-plans", status_code=201)
def create_run_plan_endpoint(body: CreateRunPlanBody):
    """Validate edits, build draft event plan, register draft. 400 on errors.

    M4: if route_source=="maps", route_id and route_facts must both be provided
    (the frontend selects an alternative from /api/routes/analyze and passes it
    back). Missing either → 400.  No API key is ever stored or echoed.
    """
    pkg_reg = PackageRegistry(settings.packages_dir)
    sc_reg = ScenarioRegistry(settings.scenarios_dir)

    package = pkg_reg.get(body.package_id)
    if package is None:
        raise HTTPException(
            status_code=400,
            detail=f"Package {body.package_id!r} not found or invalid",
        )

    scenario = sc_reg.get(body.scenario_id)
    if scenario is None:
        raise HTTPException(
            status_code=400,
            detail=f"Scenario {body.scenario_id!r} not found or invalid",
        )

    if not pkg_reg.is_compatible(package, scenario):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Package {body.package_id!r} is not compatible with "
                f"scenario {body.scenario_id!r} (type={scenario.type!r})"
            ),
        )

    # ── M4 route selection validation ─────────────────────────────────────────
    if body.route_source == "maps":
        if body.route_id is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    "route_id is required when route_source is 'maps'. "
                    "Pass the route_id from the chosen /api/routes/analyze alternative."
                ),
            )
        if body.route_facts is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    "route_facts is required when route_source is 'maps'. "
                    "A run cannot be created without route facts. "
                    "Pass the route_facts from the chosen /api/routes/analyze alternative."
                ),
            )

    # Coerce raw dicts to Pydantic models for type safety
    route_facts = _coerce_route_facts(body.route_facts) if body.route_source == "maps" else None
    display_route = _coerce_display_route(body.display_route)

    plan_id = _make_plan_id()
    draft = create_draft(
        plan_id=plan_id,
        package=package,
        scenario=scenario,
        presets=body.presets,
        parameters=body.parameters,
        hyperparameters=body.hyperparameters,
        run_mode=body.run_mode,
        route_facts=route_facts,
        route_source=body.route_source,
        display_route=display_route,
    )

    if draft.validation_errors:
        raise HTTPException(
            status_code=400,
            detail={
                "detail": "One or more parameter/hyperparameter values are invalid.",
                "validation_errors": draft.validation_errors,
            },
        )

    return {
        "plan_id": draft.plan_id,
        "draft_plan": draft.draft_event_plan,
        "effective_setup": draft.effective_setup,
        "validation_errors": draft.validation_errors,
    }


@router.post("/api/run-plans/{plan_id}/regenerate")
def regenerate_run_plan_endpoint(plan_id: str, body: RegenerateRunPlanBody):
    """Regenerate draft with updated presets/parameters/hyperparameters.

    404 for unknown plan, 400 for validation errors.
    """
    if get_draft_entry(plan_id) is None:
        raise HTTPException(
            status_code=404,
            detail=f"Run plan {plan_id!r} not found",
        )

    try:
        draft = regenerate_draft(
            plan_id=plan_id,
            presets=body.presets,
            parameters=body.parameters,
            hyperparameters=body.hyperparameters,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    if draft.validation_errors:
        raise HTTPException(
            status_code=400,
            detail={
                "detail": "One or more parameter/hyperparameter values are invalid.",
                "validation_errors": draft.validation_errors,
            },
        )

    return {
        "plan_id": draft.plan_id,
        "draft_plan": draft.draft_event_plan,
        "effective_setup": draft.effective_setup,
        "validation_errors": draft.validation_errors,
    }
