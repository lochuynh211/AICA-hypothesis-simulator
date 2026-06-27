"""TDD tests for the maps normalizer — analyze_route_maps (U3 / T004).

RED → GREEN cycle:
  1.  Write all tests; confirm they fail (ImportError / AttributeError).
  2.  Implement analyze_route_maps in services/route_analysis.py.
  3.  Confirm GREEN; run full suite.

Pure function — no network, no maps_client call here.
Inputs are hand-built dicts that mirror the RawRoute / RawPlace shapes
produced by maps_client (see u2-report.md for the contract).
"""

from __future__ import annotations

import pytest

from aica_api.models.run import DisplayRoute, RouteFacts, RouteSegmentFact
from aica_api.services.route_analysis import analyze_route_maps

# ---------------------------------------------------------------------------
# Shared test data — mirror the RawRoute / RawPlace shapes from U2
# ---------------------------------------------------------------------------

# A 150 km / 90-min route: LOCAL start, HIGHWAY main, LOCAL exit
RAW_ROUTE_0: dict = {
    "route_id": "route-0",
    "summary": "via I-5 N",
    "distance_m": 150_000,
    "duration_s": 5_400,
    "encoded_polyline": "mzneFnpyjV_}t@nhEb|FA",
    "segments": [
        {"road_class": "LOCAL", "maneuver": "straight", "distance_m": 5_000},
        {"road_class": "HIGHWAY", "maneuver": "merge", "distance_m": 130_000},
        {"road_class": "LOCAL", "maneuver": "turn-right", "distance_m": 15_000},
    ],
}

# A 200 km / 120-min pure-highway route (all segments HIGHWAY)
RAW_ROUTE_1: dict = {
    "route_id": "route-1",
    "summary": "via US-101",
    "distance_m": 200_000,
    "duration_s": 7_200,
    "encoded_polyline": "abc123",
    "segments": [
        {"road_class": "HIGHWAY", "maneuver": "merge", "distance_m": 100_000},
        {"road_class": "HIGHWAY", "maneuver": "straight", "distance_m": 100_000},
    ],
}

# A 100 km / 60-min pure-local route (all segments LOCAL)
RAW_ROUTE_2: dict = {
    "route_id": "route-2",
    "summary": "via CA-1",
    "distance_m": 100_000,
    "duration_s": 3_600,
    "encoded_polyline": "xyz789",
    "segments": [
        {"road_class": "LOCAL", "maneuver": "straight", "distance_m": 50_000},
        {"road_class": "LOCAL", "maneuver": "turn-right", "distance_m": 50_000},
    ],
}

# A fourth route (should be capped to 3)
RAW_ROUTE_3: dict = {
    "route_id": "route-3",
    "summary": "via CA-99",
    "distance_m": 180_000,
    "duration_s": 6_480,
    "encoded_polyline": "cap456",
    "segments": [
        {"road_class": "LOCAL", "maneuver": "straight", "distance_m": 180_000},
    ],
}

# Places for route-0 (highway context → service_area expected)
PLACES_ROUTE_0: list[dict] = [
    {
        "name": "Highway 5 Service Area",
        "type": "service_area",
        "location": {"lat": 37.5, "lng": -121.8},
        "distance_along_route_m": 75_000.0,   # → 75.0 km
    },
    {
        "name": "Rest Area Northbound",
        "type": "service_area",
        "location": {"lat": 37.9, "lng": -121.5},
        "distance_along_route_m": 120_000.0,  # → 120.0 km
    },
]

# One convenience store for route-1
PLACES_ROUTE_1: list[dict] = [
    {
        "name": "Corner Store",
        "type": "convenience_store",
        "location": {"lat": 36.5, "lng": -120.0},
        "distance_along_route_m": 50_000.0,  # → 50.0 km
    },
]

# Deliberately unordered (by distance) — should be sorted ascending
PLACES_UNORDERED: list[dict] = [
    {
        "name": "Far Stop",
        "type": "service_area",
        "location": {"lat": 37.9, "lng": -121.5},
        "distance_along_route_m": 120_000.0,  # 120 km
    },
    {
        "name": "Near Stop",
        "type": "service_area",
        "location": {"lat": 37.2, "lng": -122.0},
        "distance_along_route_m": 30_000.0,   # 30 km
    },
]

START_LABEL = "San Francisco, CA"
END_LABEL = "Sacramento, CA"


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


def _run_single(raw_route: dict, places: list[dict] | None = None) -> "RouteAlternative":
    """Run analyze_route_maps with one route and return the first (only) result."""
    raw_routes = [raw_route]
    places_by_route = {raw_route["route_id"]: places or []}
    results = analyze_route_maps(raw_routes, places_by_route, START_LABEL, END_LABEL)
    assert len(results) == 1
    return results[0]


# ---------------------------------------------------------------------------
# T1 — basic shape: N routes → N RouteAlternatives
# ---------------------------------------------------------------------------


class TestBasicShape:
    def test_single_route_returns_one_alternative(self):
        results = analyze_route_maps(
            [RAW_ROUTE_0], {"route-0": []}, START_LABEL, END_LABEL
        )
        assert len(results) == 1

    def test_three_routes_returns_three_alternatives(self):
        results = analyze_route_maps(
            [RAW_ROUTE_0, RAW_ROUTE_1, RAW_ROUTE_2],
            {"route-0": [], "route-1": [], "route-2": []},
            START_LABEL,
            END_LABEL,
        )
        assert len(results) == 3

    def test_route_id_preserved_in_alternative(self):
        alt = _run_single(RAW_ROUTE_0)
        assert alt["route_id"] == "route-0"

    def test_summary_preserved_in_alternative(self):
        alt = _run_single(RAW_ROUTE_0)
        assert alt["summary"] == "via I-5 N"

    def test_alternative_has_route_facts_key(self):
        alt = _run_single(RAW_ROUTE_0)
        assert "route_facts" in alt

    def test_alternative_has_display_key(self):
        alt = _run_single(RAW_ROUTE_0)
        assert "display" in alt

    def test_route_facts_is_RouteFacts_instance(self):
        alt = _run_single(RAW_ROUTE_0)
        assert isinstance(alt["route_facts"], RouteFacts)

    def test_display_is_DisplayRoute_instance(self):
        alt = _run_single(RAW_ROUTE_0)
        assert isinstance(alt["display"], DisplayRoute)


# ---------------------------------------------------------------------------
# T2 — RouteFacts fields: distance, duration, route_source
# ---------------------------------------------------------------------------


class TestRouteFactsFields:
    def test_total_route_distance_km_converted_from_m(self):
        alt = _run_single(RAW_ROUTE_0)
        assert alt["route_facts"].total_route_distance_km == pytest.approx(150.0)

    def test_estimated_route_duration_min_converted_from_s(self):
        alt = _run_single(RAW_ROUTE_0)
        assert alt["route_facts"].estimated_route_duration_min == pytest.approx(90.0)

    def test_route_source_is_maps(self):
        alt = _run_single(RAW_ROUTE_0)
        assert alt["route_facts"].route_source == "maps"

    def test_route_progress_checkpoints_25_50_75_percent(self):
        alt = _run_single(RAW_ROUTE_0)
        total = 150.0
        expected = [0.25 * total, 0.50 * total, 0.75 * total]
        assert alt["route_facts"].route_progress_checkpoints == pytest.approx(expected)

    def test_second_route_distance_and_duration(self):
        results = analyze_route_maps(
            [RAW_ROUTE_0, RAW_ROUTE_1],
            {"route-0": [], "route-1": []},
            START_LABEL,
            END_LABEL,
        )
        facts1 = results[1]["route_facts"]
        assert facts1.total_route_distance_km == pytest.approx(200.0)
        assert facts1.estimated_route_duration_min == pytest.approx(120.0)


# ---------------------------------------------------------------------------
# T3 — segment classification: HIGHWAY → highway, LOCAL → normal_road
# ---------------------------------------------------------------------------


class TestSegmentClassification:
    def test_highway_segment_classified_highway(self):
        alt = _run_single(RAW_ROUTE_0)
        segs = alt["route_facts"].route_segments
        highway_segs = [s for s in segs if s.segment_type == "highway"]
        assert len(highway_segs) >= 1

    def test_local_segment_classified_normal_road(self):
        alt = _run_single(RAW_ROUTE_0)
        segs = alt["route_facts"].route_segments
        normal_segs = [s for s in segs if s.segment_type == "normal_road"]
        assert len(normal_segs) >= 1

    def test_pure_highway_route_all_highway_segments(self):
        alt = _run_single(RAW_ROUTE_1)
        segs = alt["route_facts"].route_segments
        assert len(segs) >= 1
        for seg in segs:
            assert seg.segment_type == "highway"

    def test_pure_local_route_all_normal_road_segments(self):
        alt = _run_single(RAW_ROUTE_2)
        segs = alt["route_facts"].route_segments
        assert len(segs) >= 1
        for seg in segs:
            assert seg.segment_type == "normal_road"

    def test_segment_total_length_equals_route_distance(self):
        """Sum of segment lengths must equal total_route_distance_km."""
        alt = _run_single(RAW_ROUTE_0)
        segs = alt["route_facts"].route_segments
        total = sum(s.length_km for s in segs)
        assert total == pytest.approx(150.0, abs=0.001)

    def test_segment_start_km_accumulates_correctly(self):
        """First segment starts at 0; each subsequent start is prev start + length."""
        alt = _run_single(RAW_ROUTE_0)
        segs = alt["route_facts"].route_segments
        # Verify segments are sorted by start_km
        for i in range(1, len(segs)):
            prev = segs[i - 1]
            cur = segs[i]
            assert cur.start_km == pytest.approx(prev.start_km + prev.length_km, abs=0.001)

    def test_segments_are_RouteSegmentFact_instances(self):
        alt = _run_single(RAW_ROUTE_0)
        for seg in alt["route_facts"].route_segments:
            assert isinstance(seg, RouteSegmentFact)


# ---------------------------------------------------------------------------
# T4 — consecutive same-type segment merging
# ---------------------------------------------------------------------------


class TestSegmentMerging:
    def test_consecutive_highway_segments_merged(self):
        """RAW_ROUTE_1 has two consecutive HIGHWAY steps — should merge to one."""
        alt = _run_single(RAW_ROUTE_1)
        segs = alt["route_facts"].route_segments
        # After merging: one segment of type highway, total 200 km
        assert len(segs) == 1
        assert segs[0].segment_type == "highway"
        assert segs[0].length_km == pytest.approx(200.0)
        assert segs[0].start_km == pytest.approx(0.0)

    def test_consecutive_local_segments_merged(self):
        """RAW_ROUTE_2 has two consecutive LOCAL steps — should merge to one."""
        alt = _run_single(RAW_ROUTE_2)
        segs = alt["route_facts"].route_segments
        assert len(segs) == 1
        assert segs[0].segment_type == "normal_road"
        assert segs[0].length_km == pytest.approx(100.0)

    def test_alternating_types_not_merged(self):
        """RAW_ROUTE_0: LOCAL(5km) + HIGHWAY(130km) + LOCAL(15km) — 3 distinct types."""
        alt = _run_single(RAW_ROUTE_0)
        segs = alt["route_facts"].route_segments
        # LOCAL + HIGHWAY + LOCAL → 3 segments (no two adjacent have same type)
        assert len(segs) == 3
        assert segs[0].segment_type == "normal_road"
        assert segs[1].segment_type == "highway"
        assert segs[2].segment_type == "normal_road"


# ---------------------------------------------------------------------------
# T5 — rest spot positions from places
# ---------------------------------------------------------------------------


class TestRestSpotPositions:
    def test_places_converted_to_km_positions(self):
        alt = _run_single(RAW_ROUTE_0, places=PLACES_ROUTE_0)
        positions = alt["route_facts"].rest_spot_positions
        assert positions == pytest.approx([75.0, 120.0])

    def test_positions_sorted_ascending(self):
        """Unordered places by distance → sorted ascending km positions."""
        alt = _run_single(RAW_ROUTE_0, places=PLACES_UNORDERED)
        positions = alt["route_facts"].rest_spot_positions
        assert positions == pytest.approx([30.0, 120.0])
        assert positions == sorted(positions)

    def test_single_place_returns_single_position(self):
        alt = _run_single(RAW_ROUTE_1, places=PLACES_ROUTE_1)
        positions = alt["route_facts"].rest_spot_positions
        assert positions == pytest.approx([50.0])

    def test_empty_places_returns_empty_rest_spots(self):
        """Empty places list → empty rest_spot_positions (no fabrication)."""
        alt = _run_single(RAW_ROUTE_0, places=[])
        assert alt["route_facts"].rest_spot_positions == []

    def test_missing_route_in_places_by_route_returns_empty(self):
        """Route not present in places_by_route → empty rest_spot_positions."""
        results = analyze_route_maps(
            [RAW_ROUTE_0],
            {},  # empty dict — route-0 not present
            START_LABEL,
            END_LABEL,
        )
        assert results[0]["route_facts"].rest_spot_positions == []

    def test_places_isolated_per_route(self):
        """Places for route-0 must not bleed into route-1's rest spots."""
        results = analyze_route_maps(
            [RAW_ROUTE_0, RAW_ROUTE_1],
            {"route-0": PLACES_ROUTE_0, "route-1": []},
            START_LABEL,
            END_LABEL,
        )
        assert results[0]["route_facts"].rest_spot_positions == pytest.approx([75.0, 120.0])
        assert results[1]["route_facts"].rest_spot_positions == []


# ---------------------------------------------------------------------------
# T6 — DisplayRoute fields
# ---------------------------------------------------------------------------


class TestDisplayRoute:
    def test_display_summary_from_raw_route(self):
        alt = _run_single(RAW_ROUTE_0)
        assert alt["display"].summary == "via I-5 N"

    def test_display_encoded_polyline_from_raw_route(self):
        alt = _run_single(RAW_ROUTE_0)
        assert alt["display"].encoded_polyline == "mzneFnpyjV_}t@nhEb|FA"

    def test_display_start_label_matches_param(self):
        alt = _run_single(RAW_ROUTE_0)
        assert alt["display"].start_label == START_LABEL

    def test_display_end_label_matches_param(self):
        alt = _run_single(RAW_ROUTE_0)
        assert alt["display"].end_label == END_LABEL


# ---------------------------------------------------------------------------
# T7 — defensive cap at 3 alternatives
# ---------------------------------------------------------------------------


class TestAlternativesCap:
    def test_four_raw_routes_capped_to_three(self):
        results = analyze_route_maps(
            [RAW_ROUTE_0, RAW_ROUTE_1, RAW_ROUTE_2, RAW_ROUTE_3],
            {"route-0": [], "route-1": [], "route-2": [], "route-3": []},
            START_LABEL,
            END_LABEL,
        )
        assert len(results) == 3

    def test_capped_result_preserves_first_three(self):
        results = analyze_route_maps(
            [RAW_ROUTE_0, RAW_ROUTE_1, RAW_ROUTE_2, RAW_ROUTE_3],
            {"route-0": [], "route-1": [], "route-2": [], "route-3": []},
            START_LABEL,
            END_LABEL,
        )
        assert results[0]["route_id"] == "route-0"
        assert results[1]["route_id"] == "route-1"
        assert results[2]["route_id"] == "route-2"


# ---------------------------------------------------------------------------
# T8 — determinism
# ---------------------------------------------------------------------------


class TestDeterminism:
    def test_same_inputs_same_route_facts(self):
        """Same inputs → identical RouteFacts (stable ordering, no float nondeterminism)."""
        places = PLACES_ROUTE_0
        raw_routes = [RAW_ROUTE_0]
        places_by_route = {"route-0": places}

        result_a = analyze_route_maps(raw_routes, places_by_route, START_LABEL, END_LABEL)
        result_b = analyze_route_maps(raw_routes, places_by_route, START_LABEL, END_LABEL)

        facts_a = result_a[0]["route_facts"]
        facts_b = result_b[0]["route_facts"]

        assert facts_a.total_route_distance_km == facts_b.total_route_distance_km
        assert facts_a.estimated_route_duration_min == facts_b.estimated_route_duration_min
        assert facts_a.rest_spot_positions == facts_b.rest_spot_positions
        assert [s.segment_type for s in facts_a.route_segments] == [
            s.segment_type for s in facts_b.route_segments
        ]

    def test_route_order_stable_across_calls(self):
        """Route ordering in output is deterministic and matches input order."""
        raw_routes = [RAW_ROUTE_0, RAW_ROUTE_1, RAW_ROUTE_2]
        places_by_route = {"route-0": [], "route-1": [], "route-2": []}

        result_a = analyze_route_maps(raw_routes, places_by_route, START_LABEL, END_LABEL)
        result_b = analyze_route_maps(raw_routes, places_by_route, START_LABEL, END_LABEL)

        assert [r["route_id"] for r in result_a] == [r["route_id"] for r in result_b]


# ---------------------------------------------------------------------------
# T9 — edge cases
# ---------------------------------------------------------------------------


class TestEdgeCases:
    def test_zero_distance_route(self):
        raw = {**RAW_ROUTE_0, "distance_m": 0, "duration_s": 0, "segments": []}
        alt = _run_single(raw)
        assert alt["route_facts"].total_route_distance_km == pytest.approx(0.0)
        assert alt["route_facts"].estimated_route_duration_min == pytest.approx(0.0)
        assert alt["route_facts"].route_segments == []

    def test_empty_segments_list(self):
        raw = {**RAW_ROUTE_0, "segments": []}
        alt = _run_single(raw)
        assert alt["route_facts"].route_segments == []

    def test_single_segment_highway(self):
        raw = {
            **RAW_ROUTE_0,
            "distance_m": 100_000,
            "duration_s": 3_600,
            "segments": [
                {"road_class": "HIGHWAY", "maneuver": "merge", "distance_m": 100_000}
            ],
        }
        alt = _run_single(raw)
        segs = alt["route_facts"].route_segments
        assert len(segs) == 1
        assert segs[0].segment_type == "highway"
        assert segs[0].length_km == pytest.approx(100.0)
        assert segs[0].start_km == pytest.approx(0.0)

    def test_unknown_road_class_defaults_to_normal_road(self):
        """Unknown road_class (not HIGHWAY or LOCAL) defaults to normal_road."""
        raw = {
            **RAW_ROUTE_0,
            "distance_m": 50_000,
            "duration_s": 1_800,
            "segments": [
                {"road_class": "UNKNOWN_FUTURE_CLASS", "maneuver": "straight", "distance_m": 50_000}
            ],
        }
        alt = _run_single(raw)
        segs = alt["route_facts"].route_segments
        assert len(segs) == 1
        assert segs[0].segment_type == "normal_road"

    def test_empty_raw_routes_returns_empty_list(self):
        results = analyze_route_maps([], {}, START_LABEL, END_LABEL)
        assert results == []
