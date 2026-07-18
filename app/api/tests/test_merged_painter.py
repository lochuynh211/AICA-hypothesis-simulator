"""Tests for the merged-simulator painter service (feature 020, Slice-2b Task 1).

Pure transforms only: no IO, no clock/random. ``inject_mountain_segment``
splits an ascending non-overlapping ``RouteSegmentFact`` list so a km range
becomes a ``mountain_road`` run; ``jam_traffic_event`` converts a km range
into a time-based traffic_events preset dict.
"""
from __future__ import annotations

import pytest

from aica_api.models.run import RouteSegmentFact
from aica_api.services.merged_painter import inject_mountain_segment, jam_traffic_event

# ---------------------------------------------------------------------------
# inject_mountain_segment
# ---------------------------------------------------------------------------


def _total_length(segments: list[RouteSegmentFact]) -> float:
    return sum(seg.length_km for seg in segments)


def _assert_ascending_non_overlapping(segments: list[RouteSegmentFact]) -> None:
    expected_start = 0.0
    for seg in segments:
        assert seg.start_km == pytest.approx(expected_start)
        expected_start += seg.length_km


def test_mountain_range_fully_inside_one_segment_yields_three_pieces() -> None:
    segments = [
        RouteSegmentFact(segment_type="highway", start_km=0.0, length_km=100.0),
    ]

    result = inject_mountain_segment(segments, 30.0, 50.0)

    assert len(result) == 3
    assert [seg.segment_type for seg in result] == ["highway", "mountain_road", "highway"]
    assert result[0].start_km == pytest.approx(0.0)
    assert result[0].length_km == pytest.approx(30.0)
    assert result[1].start_km == pytest.approx(30.0)
    assert result[1].length_km == pytest.approx(20.0)
    assert result[2].start_km == pytest.approx(50.0)
    assert result[2].length_km == pytest.approx(50.0)

    assert _total_length(result) == pytest.approx(_total_length(segments))
    _assert_ascending_non_overlapping(result)

    # Input list/objects are unchanged.
    assert len(segments) == 1
    assert segments[0].segment_type == "highway"
    assert segments[0].start_km == 0.0
    assert segments[0].length_km == 100.0


def test_mountain_range_spanning_two_segments_splits_both() -> None:
    segments = [
        RouteSegmentFact(segment_type="highway", start_km=0.0, length_km=40.0),
        RouteSegmentFact(segment_type="normal_road", start_km=40.0, length_km=60.0),
    ]

    result = inject_mountain_segment(segments, 30.0, 50.0)

    # seg1 [0,40): before [0,30) highway, mid [30,40) mountain_road (after empty, dropped).
    # seg2 [40,100): mid [40,50) mountain_road (before empty, dropped), after [50,100) normal_road.
    assert [(seg.segment_type, seg.start_km, seg.length_km) for seg in result] == [
        ("highway", 0.0, 30.0),
        ("mountain_road", 30.0, 10.0),
        ("mountain_road", 40.0, 10.0),
        ("normal_road", 50.0, 50.0),
    ]

    assert _total_length(result) == pytest.approx(_total_length(segments))
    _assert_ascending_non_overlapping(result)

    # Original segments unchanged.
    assert segments[0].segment_type == "highway"
    assert segments[0].length_km == 40.0
    assert segments[1].segment_type == "normal_road"
    assert segments[1].length_km == 60.0


def test_invalid_range_start_gte_end_returns_unchanged() -> None:
    segments = [
        RouteSegmentFact(segment_type="highway", start_km=0.0, length_km=40.0),
        RouteSegmentFact(segment_type="normal_road", start_km=40.0, length_km=60.0),
    ]

    result = inject_mountain_segment(segments, 50.0, 50.0)

    assert result == segments
    result2 = inject_mountain_segment(segments, 60.0, 10.0)
    assert result2 == segments


def test_range_clamped_to_total_extent() -> None:
    segments = [
        RouteSegmentFact(segment_type="highway", start_km=0.0, length_km=100.0),
    ]

    # end_km beyond total (100) clamps to 100; start_km below 0 clamps to 0.
    result = inject_mountain_segment(segments, -10.0, 200.0)

    assert len(result) == 1
    assert result[0].segment_type == "mountain_road"
    assert result[0].start_km == pytest.approx(0.0)
    assert result[0].length_km == pytest.approx(100.0)


def test_inject_mountain_segment_returns_new_list_not_same_object() -> None:
    segments = [
        RouteSegmentFact(segment_type="highway", start_km=0.0, length_km=100.0),
    ]

    result = inject_mountain_segment(segments, 30.0, 50.0)

    assert result is not segments


# ---------------------------------------------------------------------------
# jam_traffic_event
# ---------------------------------------------------------------------------


def test_jam_traffic_event_converts_km_range_to_time_based_preset() -> None:
    result = jam_traffic_event(30.0, 50.0, 120.0, 144.0)

    assert result == {
        "id": "manual_jam",
        "start_min": pytest.approx(36.0),
        "duration_min": pytest.approx(24.0),
        "affected_segment_id": "manual",
        "speed_kph": pytest.approx(15.0),
    }


def test_jam_traffic_event_accepts_keyword_overrides() -> None:
    result = jam_traffic_event(
        0.0,
        10.0,
        100.0,
        60.0,
        speed_kph=5.0,
        event_id="jam-2",
        affected_segment_id="seg-7",
    )

    assert result == {
        "id": "jam-2",
        "start_min": pytest.approx(0.0),
        "duration_min": pytest.approx(6.0),
        "affected_segment_id": "seg-7",
        "speed_kph": pytest.approx(5.0),
    }
