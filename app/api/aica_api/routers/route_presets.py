"""Route presets router — /api/routes/presets.

Serves pre-extracted Google Maps route data so the user can skip
live API calls during testing. Presets are stored as JSON files
in the routes/presets/ directory.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

from aica_api.config import settings
from aica_api.models.run import DisplayRoute, NamedRestSpot, RouteFacts, RouteSegmentFact
from aica_api.services.route_analysis import _build_route_segments_maps

router = APIRouter()


def _presets_dir() -> Path:
    return settings.routes_dir / "presets"


def _load_preset(preset_id: str) -> dict[str, Any]:
    path = _presets_dir() / f"{preset_id}.json"
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail="Route preset not found. / ルートプリセットが見つかりません。",
        )
    with open(path, encoding="utf-8") as f:
        return json.load(f)


@router.get("/api/routes/presets")
def list_route_presets():
    """List available route presets (id + label + summary distance)."""
    presets_dir = _presets_dir()
    if not presets_dir.exists():
        return {"presets": []}

    presets: list[dict[str, Any]] = []
    for path in sorted(presets_dir.glob("*.json")):
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            raw_route = data.get("raw_route", {})
            presets.append({
                "id": data["id"],
                "label": data["label"],
                "start": data.get("start", ""),
                "end": data.get("end", ""),
                "distance_km": round(raw_route.get("distance_m", 0) / 1000, 1),
                "duration_min": round(raw_route.get("duration_s", 0) / 60),
                "summary": raw_route.get("summary", ""),
            })
        except (json.JSONDecodeError, KeyError):
            continue

    return {"presets": presets}


@router.post("/api/routes/presets/{preset_id}/load")
def load_route_preset(preset_id: str):
    """Load a preset and return a RouteEnvelope matching the /routes/analyze response.

    This allows the frontend to treat preset routes identically to live Maps routes
    — same data shape flows into the run-plan and review screens.
    """
    data = _load_preset(preset_id)
    raw_route = data["raw_route"]
    places = data.get("places", [])

    total_km = raw_route["distance_m"] / 1000.0
    duration_min = raw_route["duration_s"] / 60.0

    route_segments = _build_route_segments_maps(raw_route.get("segments", []))

    places_sorted = sorted(places, key=lambda p: p["distance_along_route_m"])
    rest_spot_positions = [p["distance_along_route_m"] / 1000.0 for p in places_sorted]

    named_rest_spots = [
        NamedRestSpot(
            name=p["name"],
            position_km=p["distance_along_route_m"] / 1000.0,
            lat=p["location"]["lat"],
            lng=p["location"]["lng"],
            synthetic=p.get("synthetic", False),
        )
        for p in places_sorted
    ]

    route_progress_checkpoints = [0.25 * total_km, 0.50 * total_km, 0.75 * total_km]

    route_facts = RouteFacts(
        total_route_distance_km=total_km,
        estimated_route_duration_min=duration_min,
        route_segments=route_segments,
        rest_spot_positions=rest_spot_positions,
        route_progress_checkpoints=route_progress_checkpoints,
        route_source="maps",
        named_rest_spots=named_rest_spots,
    )

    display = DisplayRoute(
        summary=raw_route.get("summary", ""),
        encoded_polyline=raw_route.get("encoded_polyline", ""),
        start_label=data.get("start", ""),
        end_label=data.get("end", ""),
    )

    alternative = {
        "route_id": raw_route["route_id"],
        "summary": raw_route.get("summary", ""),
        "route_facts": route_facts.model_dump(mode="json"),
        "display": display.model_dump(mode="json"),
        "notices": [],
    }

    return {
        "route_source": "maps",
        "alternatives": [alternative],
    }
