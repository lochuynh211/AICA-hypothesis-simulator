"""Route analysis service — derive RouteFacts from a ScenarioDef or Google Maps data.

Two entry points, both pure, deterministic, side-effect-free:

  analyze_route(scenario)  — LOCAL path (T012)
      Converts the qualitative scenario structure (route_intent.segments with
      at-fractions, type labels, speed_band) into M2 RouteFacts.

  analyze_route_maps(raw_routes, places_by_route, start_label, end_label)  — MAPS path (T004/U3)
      Normalises already-fetched Google Directions + Places data into
      RouteFacts + DisplayRoute per alternative.  Does NOT call maps_client
      or the network.

Segment type mapping for the LOCAL path
  (M1 RouteSegment.type → M2 segment_type vocabulary):
  highway               → highway
  start / urban / national / residential / rest / end → normal_road
  (mountain / sightseeing not in M1 Literal; reserved for future scenarios)

Segment type mapping for the MAPS path (V1 classification):
  HIGHWAY               → highway
  LOCAL                 → normal_road
  anything else         → normal_road  (mountain/sightseeing have no reliable
                                        Google signal in V1)

Total route distance for the LOCAL path is taken from
scenario.presets["total_route_distance_km"] when present; otherwise estimated
as: total_km = (total_duration_seconds / 3600) * default_speed_kph
where default_speed_kph = 60.
"""

from __future__ import annotations

from typing import Any

from aica_api.models.run import DisplayRoute, NamedRestSpot, RouteFacts, RouteSegmentFact
from aica_api.models.scenario import ScenarioDef

# Type aliases (plain dicts at runtime — same convention as maps_client)
RawRoute = dict[str, Any]
RawPlace = dict[str, Any]
RouteAlternative = dict[str, Any]  # {route_id, route_facts, display, summary}

# Default speed used to estimate total route distance when not specified in presets.
_DEFAULT_SPEED_KPH = 60.0

# Mapping from M1 RouteSegment.type to M2 segment_type vocabulary.
_SEGMENT_TYPE_MAP: dict[str, str] = {
    "start": "normal_road",
    "urban": "normal_road",
    "national": "normal_road",
    "residential": "normal_road",
    "rest": "normal_road",
    "end": "normal_road",
    "highway": "highway",
    "mountain": "mountain_road",
    "sightseeing": "sightseeing_road",
}


def analyze_route(scenario: ScenarioDef) -> RouteFacts:
    """Derive physical route facts from a ScenarioDef.

    Args:
        scenario: A validated ScenarioDef.

    Returns:
        RouteFacts with M2 physical fields populated and M1 backward-compat
        fields (segments, bands) also set.
    """
    # ── Total route distance ──────────────────────────────────────────────────
    total_km: float = float(
        scenario.presets.get(
            "total_route_distance_km",
            (scenario.total_duration_seconds / 3600.0) * _DEFAULT_SPEED_KPH,
        )
    )

    # ── Route segments ────────────────────────────────────────────────────────
    segments = scenario.route_intent.segments
    route_segments: list[RouteSegmentFact] = []

    for i, seg in enumerate(segments):
        # The segment starts at seg.at and ends at the next segment's at (or 1.0).
        next_at = segments[i + 1].at if i + 1 < len(segments) else 1.0
        fraction = next_at - seg.at
        length_km = fraction * total_km
        start_km = seg.at * total_km
        seg_type = _SEGMENT_TYPE_MAP.get(seg.type, "normal_road")

        # Skip zero-length terminal segments (e.g., an end segment at 1.0 that
        # has no following segment; length_km would be 0.0).
        if length_km > 0:
            route_segments.append(
                RouteSegmentFact(
                    segment_type=seg_type,
                    start_km=start_km,
                    length_km=length_km,
                )
            )

    # ── Rest spot positions (km from start) ───────────────────────────────────
    rest_spot_positions: list[float] = [
        seg.at * total_km
        for seg in segments
        if seg.is_rest_facility
    ]

    # ── Named rest spots (M8) — same segments, but with human name ─────────
    # Uses the segment's EN name; falls back to the route_intent.rest_facility
    # label (EN) if the segment name is blank.  lat/lng not available on the
    # local path.
    _rf_label_en: str = scenario.route_intent.rest_facility.label.get("en", "Rest Stop")
    named_rest_spots: list[NamedRestSpot] = [
        NamedRestSpot(
            name=seg.name.get("en") or _rf_label_en,
            position_km=seg.at * total_km,
        )
        for seg in segments
        if seg.is_rest_facility
    ]

    # ── Route progress checkpoints (25 %, 50 %, 75 % of total km) ────────────
    route_progress_checkpoints: list[float] = [
        0.25 * total_km,
        0.50 * total_km,
        0.75 * total_km,
    ]

    # ── Estimated route duration ──────────────────────────────────────────────
    # Derived from speed profile if available, else from total_duration_seconds.
    if scenario.speed_profile is not None:
        estimated_min = _estimate_duration_min(route_segments, scenario.speed_profile)
    else:
        estimated_min = scenario.total_duration_seconds / 60.0

    return RouteFacts(
        # M1 backward-compat fields
        segments=segments,
        bands={},  # Populated by run_manager from package.features

        # M2 physical fields
        total_route_distance_km=total_km,
        estimated_route_duration_min=estimated_min,
        route_segments=route_segments,
        rest_spot_positions=rest_spot_positions,
        route_progress_checkpoints=route_progress_checkpoints,

        # M8: named rest facilities (local path — lat/lng not available)
        named_rest_spots=named_rest_spots,
    )


# ---------------------------------------------------------------------------
# Maps normalizer (T004 / U3)
# ---------------------------------------------------------------------------

# Maximum alternatives to return (maps_client already caps; enforce here too).
_MAX_ALTERNATIVES = 3

# V1 road-class mapping: Google step road_class → simulator segment_type.
# mountain_road / sightseeing_road have no reliable Google signal in V1 →
# default to normal_road for anything not explicitly HIGHWAY.
_ROAD_CLASS_MAP: dict[str, str] = {
    "HIGHWAY": "highway",
    "LOCAL": "normal_road",
}


def analyze_route_maps(
    raw_routes: list[RawRoute],
    places_by_route: dict[str, list[RawPlace]],
    start_label: str,
    end_label: str,
) -> list[RouteAlternative]:
    """Normalise already-fetched Google data into simulator route facts.

    Pure, deterministic — does NOT call maps_client or the network.

    Args:
        raw_routes:       Up to 3 RawRoute dicts from maps_client.directions().
        places_by_route:  RawPlace lists keyed by route_id; missing keys are
                          treated as an empty list (no fabrication).
        start_label:      Human-readable origin label for DisplayRoute.
        end_label:        Human-readable destination label for DisplayRoute.

    Returns:
        list[RouteAlternative] — one per raw route, capped at 3.
        Each RouteAlternative is a dict: {route_id, route_facts, display, summary}.
    """
    alternatives: list[RouteAlternative] = []

    for raw in raw_routes[:_MAX_ALTERNATIVES]:
        route_id: str = raw["route_id"]
        total_km: float = raw["distance_m"] / 1000.0
        duration_min: float = raw["duration_s"] / 60.0

        # ── Route segments — classify + merge consecutive same-type ───────────
        route_segments = _build_route_segments_maps(raw.get("segments", []))

        # ── Rest spot positions (km) — sorted ascending, empty-safe ──────────
        places: list[RawPlace] = places_by_route.get(route_id, [])
        # Sort places once by along-route distance to keep both lists in sync.
        places_sorted = sorted(places, key=lambda p: p["distance_along_route_m"])
        rest_spot_positions: list[float] = [
            p["distance_along_route_m"] / 1000.0 for p in places_sorted
        ]

        # ── Named rest spots (M8) — preserve facility names from Places ───────
        named_rest_spots: list[NamedRestSpot] = [
            NamedRestSpot(
                name=p["name"],
                position_km=p["distance_along_route_m"] / 1000.0,
                lat=p["location"]["lat"],
                lng=p["location"]["lng"],
                synthetic=p.get("synthetic", False),
            )
            for p in places_sorted
        ]

        # ── Route progress checkpoints (25 %, 50 %, 75 % of total km) ────────
        route_progress_checkpoints: list[float] = [
            0.25 * total_km,
            0.50 * total_km,
            0.75 * total_km,
        ]

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
            summary=raw.get("summary", ""),
            encoded_polyline=raw.get("encoded_polyline", ""),
            start_label=start_label,
            end_label=end_label,
        )

        alternatives.append(
            {
                "route_id": route_id,
                "summary": raw.get("summary", ""),
                "route_facts": route_facts,
                "display": display,
            }
        )

    return alternatives


def _build_route_segments_maps(raw_segments: list[dict[str, Any]]) -> list[RouteSegmentFact]:
    """Convert raw step dicts into RouteSegmentFact list, merging consecutive same-type.

    Accumulates start_km as we walk; merges adjacent segments of identical type.
    """
    if not raw_segments:
        return []

    result: list[RouteSegmentFact] = []
    start_km: float = 0.0

    # Initialise with the first step
    first = raw_segments[0]
    current_type = _ROAD_CLASS_MAP.get(first["road_class"], "normal_road")
    current_length_km = first["distance_m"] / 1000.0
    current_start_km = 0.0

    for step in raw_segments[1:]:
        step_type = _ROAD_CLASS_MAP.get(step["road_class"], "normal_road")
        step_length_km = step["distance_m"] / 1000.0

        if step_type == current_type:
            # Merge: extend the current segment
            current_length_km += step_length_km
        else:
            # Emit the current segment and start a new one
            result.append(
                RouteSegmentFact(
                    segment_type=current_type,
                    start_km=current_start_km,
                    length_km=current_length_km,
                )
            )
            current_start_km += current_length_km
            current_type = step_type
            current_length_km = step_length_km

    # Emit the final (possibly only) segment
    result.append(
        RouteSegmentFact(
            segment_type=current_type,
            start_km=current_start_km,
            length_km=current_length_km,
        )
    )

    return result


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _estimate_duration_min(
    route_segments: list[RouteSegmentFact],
    speed_profile,
) -> float:
    """Estimate driving duration in minutes given segment km extents and speed profile."""
    speed_map = {
        "normal_road": speed_profile.normal_road_kph,
        "highway": speed_profile.highway_kph,
        "mountain_road": speed_profile.mountain_road_kph,
        "sightseeing_road": speed_profile.sightseeing_road_kph,
    }
    total_minutes = 0.0
    for seg in route_segments:
        kph = speed_map.get(seg.segment_type, speed_profile.normal_road_kph)
        if kph > 0:
            total_minutes += (seg.length_km / kph) * 60.0
    return total_minutes
