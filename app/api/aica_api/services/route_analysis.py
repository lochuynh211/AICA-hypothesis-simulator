"""Route analysis service (T012) — derive RouteFacts from a ScenarioDef.

Pure, deterministic, side-effect-free.  Same ScenarioDef → same RouteFacts.

The route analysis function converts the qualitative scenario structure
(route_intent.segments with at-fractions, type labels, speed_band) into the
M2 RouteFacts with physical kilometre extents and rest-spot positions the
M2 tick engine can consume directly.

Segment type mapping (M1 RouteSegment.type → M2 RouteSegmentFact.segment_type):
  highway               → highway
  start / urban / national / residential / rest / end → normal_road
  (mountain / sightseeing not in M1 Literal; reserved for future scenarios)

Total route distance is taken from scenario.presets["total_route_distance_km"]
when present.  When absent, it is estimated as:
  total_km = (total_duration_seconds / 3600) * default_speed_kph
where default_speed_kph = 60 (≈ normal urban/mixed route average).
"""

from __future__ import annotations

from aica_api.models.run import RouteFacts, RouteSegmentFact
from aica_api.models.scenario import ScenarioDef

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
    )


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
