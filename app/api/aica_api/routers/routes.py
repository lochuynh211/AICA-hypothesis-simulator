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
    # Feature 009 UX (route-first): scenario_id is OPTIONAL so a real Maps search
    # can run before a scenario is chosen. When present it still 404-validates and
    # supplies the local-route geometry + Places-failure rest fallback (unchanged).
    scenario_id: str | None = None
    # M4: optional Maps fields — all three must be present to use the maps path
    maps_key: str | None = None
    start: str | None = None
    end: str | None = None


def _scale_scenario_rest_positions(local_facts: RouteFacts, maps_total_km: float) -> list[dict[str, Any]]:
    """Fallback for Places failure: scale scenario local rest positions onto a Maps route.

    Takes pre-computed local route facts and scales their rest positions (as fractions
    of the local total distance) onto the Maps route distance, returning
    RawPlace-compatible dicts.  Returns [] if the scenario has no local rest positions.

    ``local_facts`` must be pre-computed by the caller (once per analyze request, not
    once per alternative) to avoid re-calling ``analyze_route`` for each failing
    alternative.
    """
    local_total = local_facts.total_route_distance_km or 1.0
    return [
        {
            "name": "scenario_fallback_rest_stop",
            "type": "rest_stop",
            "location": {"lat": 0.0, "lng": 0.0},
            "distance_along_route_m": (pos / local_total) * maps_total_km * 1000.0,
            "synthetic": True,
        }
        for pos in local_facts.rest_spot_positions
    ]


def _derive_context(raw_route: dict[str, Any]) -> dict[str, str]:
    """Return route_type context for places_rest_stops.

    Returns ``{"route_type": "highway"}`` if any segment has road_class == "HIGHWAY",
    else ``{"route_type": "urban"}`` — matching the vocabulary expected by
    ``maps_client.places_rest_stops`` (``"highway" | "urban" | ...``).
    """
    segments = raw_route.get("segments", [])
    route_type = "highway" if any(s.get("road_class") == "HIGHWAY" for s in segments) else "urban"
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
    # Feature 009 UX: scenario_id is optional. When omitted, the route is derived
    # from Maps alone (route-first flow); when present it 404-validates as before.
    scenario = None
    if body.scenario_id is not None:
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

        # ── Local fallback facts (pre-computed once for all alternatives) ────
        # analyze_route is pure and scenario-constant; compute once here so it
        # is NOT re-called for each failing Places alternative (Fix 3).
        # None when no scenario was supplied (route-first flow) — Places failures
        # then degrade to an honest "unavailable" notice with no rest fallback.
        local_fallback_facts = analyze_route(scenario) if scenario is not None else None

        # ── Places (one call per route) ───────────────────────────────────────
        # Empty result is honest (no rest stops on route).
        # Transport failure degrades gracefully to scenario-scaled fallback.
        places_by_route: dict[str, list[dict[str, Any]]] = {}
        notices_by_route: dict[str, list[str]] = {}
        for raw in raw_routes:
            rid = raw["route_id"]
            context = _derive_context(raw)
            try:
                places = maps_client.places_rest_stops(key, raw["encoded_polyline"], context)
                notices_by_route[rid] = ["no_rest_stops_found"] if not places else []
            except MapsError:
                # Places failure: fall back to scenario rest positions scaled onto Maps distance.
                # local_fallback_facts is pre-computed once above — not re-derived here.
                # With no scenario (route-first), there is nothing to fall back to.
                if local_fallback_facts is not None:
                    maps_total_km = raw["distance_m"] / 1000.0
                    places = _scale_scenario_rest_positions(local_fallback_facts, maps_total_km)
                else:
                    places = []
                # Fix 2: honest notice — degraded only when fallback is non-empty;
                # unavailable when the scenario has no local rest pattern either.
                if places:
                    notices_by_route[rid] = ["rest_data_degraded"]
                else:
                    notices_by_route[rid] = ["rest_data_unavailable"]
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
                "notices": notices_by_route.get(alt["route_id"], []),
            })

        return {"route_source": "maps", "alternatives": serialized}

    else:
        # ── Local path ────────────────────────────────────────────────────────
        # The local route geometry comes entirely from the scenario. With neither
        # a scenario nor a Maps key there is nothing to derive a route from — the
        # route-first flow expects the caller to pick a preset or run a Maps search.
        if scenario is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    "No route source: provide a Maps key with start/end, or select "
                    "a preset route / scenario to derive a local route."
                ),
            )
        route_facts = analyze_route(scenario)
        return {
            "route_source": "local",
            "alternatives": [
                {
                    "route_id": "local",
                    "summary": scenario.id,
                    "route_facts": route_facts.model_dump(mode="json"),
                    "display": None,
                    "notices": [],
                }
            ],
        }
