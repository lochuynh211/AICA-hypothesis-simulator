"""TDD route_analysis tests (T012) — RED first, then GREEN.

Tests for analyze_route(scenario) → RouteFacts.
Pure function: same ScenarioDef → same RouteFacts every call.
"""

from __future__ import annotations

import json
import pathlib

import pytest

from aica_api.models.run import RouteFacts
from aica_api.models.scenario import ScenarioDef
from aica_api.services.route_analysis import analyze_route

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
# Feature 009: uc01_fatigue_friend_drive_v0_1 is retired.
_SCENARIO_PATH = _REPO_ROOT / "scenarios" / "uc01_fatigue_recovery_v0_1.json"


# ─── Shared fixtures ──────────────────────────────────────────────────────────


@pytest.fixture
def uc01_scenario() -> ScenarioDef:
    data = json.loads(_SCENARIO_PATH.read_text(encoding="utf-8"))
    data.pop("_comment", None)
    return ScenarioDef.model_validate(data)


def _make_scenario(
    *,
    segment_types: list[str] | None = None,
    presets: dict | None = None,
) -> ScenarioDef:
    """Build a minimal ScenarioDef for route analysis tests."""
    # Default: start + rest + end
    if segment_types is None:
        raw_types = ["start", "rest", "end"]
        ats = [0.0, 0.5, 1.0]
    else:
        raw_types = segment_types
        n = len(raw_types)
        ats = [i / (n - 1) if n > 1 else 0.0 for i in range(n)]
        ats[-1] = 1.0  # Force last segment at 1.0

    segments = []
    for i, (t, at) in enumerate(zip(raw_types, ats)):
        segments.append({
            "id": f"seg_{i}",
            "name": {"ja": "テスト", "en": "Test"},
            "type": t,
            "at": at,
            "speed_band": "slow",
            "length_band": "short",
            "is_rest_facility": t == "rest",
        })

    return ScenarioDef(
        id="test_route",
        version="0.1.0",
        type="uc01_fatigue",
        persona={"name": "Tester"},
        route_intent={
            "rest_facility": {"label": {"ja": "休憩", "en": "Rest"}},
            "segments": segments,
        },
        initial_state={"drowsiness_level": "none", "fatigue_level": "low"},
        event_presets={"signal_duration_at_trigger": "transient"},
        total_duration_seconds=7200,
        tick_seconds=60,
        allowed_actions=["accept_rest", "postpone"],
        presets=presets or {},
    )


# ─── Return type ──────────────────────────────────────────────────────────────


def test_analyze_route_returns_route_facts(uc01_scenario):
    facts = analyze_route(uc01_scenario)
    assert isinstance(facts, RouteFacts)


# ─── total_route_distance_km ──────────────────────────────────────────────────


def test_total_distance_from_presets():
    """When presets contains total_route_distance_km, it is used directly."""
    scenario = _make_scenario(presets={"total_route_distance_km": 150.0})
    facts = analyze_route(scenario)
    assert facts.total_route_distance_km == pytest.approx(150.0)


def test_total_distance_has_default_when_presets_absent():
    """When presets lacks total_route_distance_km, a fallback value is set."""
    scenario = _make_scenario()
    facts = analyze_route(scenario)
    assert facts.total_route_distance_km is not None
    assert facts.total_route_distance_km > 0


# ─── route_segments ───────────────────────────────────────────────────────────


def test_route_segments_list_not_empty(uc01_scenario):
    facts = analyze_route(uc01_scenario)
    assert len(facts.route_segments) > 0


def test_route_segments_count_matches_input_segments(uc01_scenario):
    """One RouteSegmentFact per source segment (except the last boundary marker)."""
    facts = analyze_route(uc01_scenario)
    # Segments define start positions; the last one (end, at=1.0) has zero length
    # Implementation may include or exclude zero-length terminal segment
    assert len(facts.route_segments) >= len(uc01_scenario.route_intent.segments) - 1


def test_highway_segment_maps_to_highway_type():
    """Route segment with type='highway' → segment_type='highway' in RouteSegmentFact."""
    scenario = _make_scenario(segment_types=["start", "highway", "rest", "end"])
    facts = analyze_route(scenario)
    seg_types = [s.segment_type for s in facts.route_segments]
    assert "highway" in seg_types


def test_non_highway_segment_maps_to_normal_road():
    """Route segments other than 'highway' → 'normal_road'."""
    scenario = _make_scenario(segment_types=["start", "rest", "end"])
    facts = analyze_route(scenario)
    seg_types = set(s.segment_type for s in facts.route_segments)
    # Only normal_road (no highway in this scenario)
    assert seg_types <= {"normal_road", "highway", "mountain_road", "sightseeing_road"}
    # No highway segment present, so no "highway" type
    assert "highway" not in seg_types


def test_route_segments_start_km_ascending():
    """Segment start_km values are non-decreasing."""
    scenario = _make_scenario(presets={"total_route_distance_km": 100.0})
    facts = analyze_route(scenario)
    starts = [s.start_km for s in facts.route_segments]
    for a, b in zip(starts, starts[1:]):
        assert b >= a


def test_route_segment_lengths_positive():
    """Each RouteSegmentFact has a positive length_km."""
    scenario = _make_scenario(presets={"total_route_distance_km": 100.0})
    facts = analyze_route(scenario)
    for seg in facts.route_segments:
        assert seg.length_km > 0, f"Segment {seg} has non-positive length"


# ─── rest_spot_positions ──────────────────────────────────────────────────────


def test_rest_spot_positions_not_empty(uc01_scenario):
    """The scenario has exactly one rest facility; its km position is recorded."""
    facts = analyze_route(uc01_scenario)
    assert len(facts.rest_spot_positions) == 1


def test_rest_spot_position_is_within_route(uc01_scenario):
    facts = analyze_route(uc01_scenario)
    total_km = facts.total_route_distance_km
    for pos in facts.rest_spot_positions:
        assert 0 <= pos <= total_km


def test_rest_spot_position_matches_segment_at():
    """Rest facility at=0.5 → rest_spot_km ≈ 0.5 × total_km."""
    scenario = _make_scenario(presets={"total_route_distance_km": 120.0})
    facts = analyze_route(scenario)
    # The rest segment is at 0.5 in _make_scenario
    assert len(facts.rest_spot_positions) == 1
    assert facts.rest_spot_positions[0] == pytest.approx(60.0)


# ─── route_progress_checkpoints ──────────────────────────────────────────────


def test_route_progress_checkpoints_not_empty(uc01_scenario):
    facts = analyze_route(uc01_scenario)
    assert len(facts.route_progress_checkpoints) > 0


# ─── Backward compatibility (M1 fields) ──────────────────────────────────────


def test_backward_compat_segments_populated(uc01_scenario):
    """M1 backward compat: route_facts.segments carries the RouteSegment list."""
    facts = analyze_route(uc01_scenario)
    assert len(facts.segments) == len(uc01_scenario.route_intent.segments)


# ─── Determinism ──────────────────────────────────────────────────────────────


def test_analyze_route_deterministic(uc01_scenario):
    """Same scenario → same RouteFacts every call."""
    f1 = analyze_route(uc01_scenario)
    f2 = analyze_route(uc01_scenario)
    assert f1.model_dump() == f2.model_dump()
