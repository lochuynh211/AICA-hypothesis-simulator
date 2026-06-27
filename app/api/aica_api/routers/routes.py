"""Routes router — /api/routes/analyze.

M4 changes:
- AnalyzeRouteBody gains optional maps_key, start, end fields.
- Response is now ALWAYS the envelope {route_source, alternatives:[...]}.
  Maps path: alternatives from Google Directions + Places (via maps_client +
             route_analysis.analyze_route_maps).
  Local path: single alternative wrapping the existing analyze_route result.
- MapsError from directions → HTTP 502 with structured {error_type, message}.
  The API key is NEVER stored, logged, or echoed in any response or error.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from aica_api.config import settings
from aica_api.models.run import RouteFacts
from aica_api.services import maps_client
from aica_api.services.maps_client import MapsError
from aica_api.services.route_analysis import analyze_route, analyze_route_maps
from aica_api.services.scenario_registry import ScenarioRegistry

router = APIRouter()


class AnalyzeRouteBody(BaseModel):
    scenario_id: str
    # M4: optional Maps fields — all three must be present to use the maps path
    maps_key: str | None = None
    start: str | None = None
    end: str | None = None


def _derive_context(raw_route: dict[str, Any]) -> dict[str, str]:
    """Return route_type context for places_rest_stops.

    "highway" if any segment has road_class == "HIGHWAY", else "local".
    """
    segments = raw_route.get("segments", [])
    route_type = "highway" if any(s.get("road_class") == "HIGHWAY" for s in segments) else "local"
    return {"route_type": route_type}


@router.post("/api/routes/analyze")
def analyze_route_endpoint(body: AnalyzeRouteBody):
    """Derive route alternatives from a scenario.

    Returns {route_source, alternatives:[...]} for both paths.

    Maps path (maps_key + start + end present):
      Calls Google Directions + Places via maps_client; returns ≤ 3 alternatives.
      Key is a local variable only — never stored, logged, or echoed.
      MapsError → HTTP 502 with {error_type, message}; no key in the body.

    Local path (no key or missing start/end):
      Wraps the existing deterministic analyze_route result in the envelope.
      Byte-for-byte identical route_facts to pre-M4 behaviour.

    404 for unknown scenario (checked before any Maps call).
    """
    # ── Validate scenario first (before any Maps call) ─────────────────────────
    sc_reg = ScenarioRegistry(settings.scenarios_dir)
    scenario = sc_reg.get(body.scenario_id)
    if scenario is None:
        raise HTTPException(
            status_code=404,
            detail=f"Scenario {body.scenario_id!r} not found or invalid",
        )

    # ── Decide path ────────────────────────────────────────────────────────────
    use_maps = (
        body.maps_key is not None
        and body.start is not None
        and body.end is not None
    )

    if use_maps:
        # key is a local variable: never stored, logged, or included in errors
        key: str = body.maps_key  # type: ignore[assignment]
        start: str = body.start   # type: ignore[assignment]
        end: str = body.end       # type: ignore[assignment]

        # ── Directions ────────────────────────────────────────────────────────
        try:
            raw_routes = maps_client.directions(key, start, end)
        except MapsError as exc:
            raise HTTPException(
                status_code=502,
                detail={
                    "error_type": exc.error_type,
                    "message": exc.message,
                    "suggestion": (
                        "Check your API key and network connection, "
                        "or use the local route fallback."
                    ),
                },
            )

        # ── Places (one call per route; empty result is fine) ─────────────────
        places_by_route: dict[str, list[dict[str, Any]]] = {}
        for raw in raw_routes:
            rid = raw["route_id"]
            context = _derive_context(raw)
            try:
                places = maps_client.places_rest_stops(key, raw["encoded_polyline"], context)
            except MapsError:
                # Places failure is non-fatal: treat as empty list (U5 handles retries)
                places = []
            places_by_route[rid] = places

        # ── Normalize ─────────────────────────────────────────────────────────
        alternatives = analyze_route_maps(
            raw_routes=raw_routes,
            places_by_route=places_by_route,
            start_label=start,
            end_label=end,
        )

        # Serialize RouteAlternative dicts (route_facts is a RouteFacts Pydantic model)
        serialized: list[dict[str, Any]] = []
        for alt in alternatives:
            rf = alt["route_facts"]
            serialized.append({
                "route_id": alt["route_id"],
                "summary": alt["summary"],
                "route_facts": (
                    rf.model_dump(mode="json") if isinstance(rf, RouteFacts) else rf
                ),
                "display": (
                    alt["display"].model_dump(mode="json")
                    if alt["display"] is not None and hasattr(alt["display"], "model_dump")
                    else alt["display"]
                ),
            })

        return {"route_source": "maps", "alternatives": serialized}

    else:
        # ── Local path ────────────────────────────────────────────────────────
        route_facts = analyze_route(scenario)
        return {
            "route_source": "local",
            "alternatives": [
                {
                    "route_id": "local",
                    "summary": scenario.id,
                    "route_facts": route_facts.model_dump(mode="json"),
                    "display": None,
                }
            ],
        }
