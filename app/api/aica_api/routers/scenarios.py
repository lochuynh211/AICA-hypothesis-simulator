"""Scenario registry router — /api/scenarios."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from aica_api.config import settings
from aica_api.services.scenario_registry import ScenarioRegistry

router = APIRouter()


def _get_registry() -> ScenarioRegistry:
    """Instantiate a ScenarioRegistry from the configured scenarios directory."""
    return ScenarioRegistry(settings.scenarios_dir)


@router.get("/api/scenarios")
def list_scenarios() -> dict:
    """Return all loaded scenario summaries plus any load errors."""
    reg = _get_registry()
    errors = [
        {"source": e.get("file", ""), "message": e.get("error", "")}
        for e in reg.list_errors()
    ]
    return {"scenarios": reg.list_summaries(), "errors": errors}


@router.get("/api/scenarios/{scenario_id}")
def get_scenario(scenario_id: str):
    """Return the full ScenarioDef for a scenario, or 404."""
    reg = _get_registry()
    sc = reg.get(scenario_id)
    if sc is None:
        raise HTTPException(
            status_code=404,
            detail="Scenario not found or invalid. / シナリオが見つからないか、無効です。",
        )
    return sc
