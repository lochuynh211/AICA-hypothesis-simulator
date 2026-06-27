"""Routes router — /api/routes/analyze."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from aica_api.config import settings
from aica_api.services.route_analysis import analyze_route
from aica_api.services.scenario_registry import ScenarioRegistry

router = APIRouter()


class AnalyzeRouteBody(BaseModel):
    scenario_id: str


@router.post("/api/routes/analyze")
def analyze_route_endpoint(body: AnalyzeRouteBody):
    """Derive RouteFacts from a scenario. 404 for unknown scenario."""
    sc_reg = ScenarioRegistry(settings.scenarios_dir)
    scenario = sc_reg.get(body.scenario_id)
    if scenario is None:
        raise HTTPException(
            status_code=404,
            detail=f"Scenario {body.scenario_id!r} not found or invalid",
        )
    return analyze_route(scenario)
