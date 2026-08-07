"""Painter service — pure route/event "painting" transforms for the merged simulator.

Feature 020 (Combined Simulator), Slice-2b Task 1: two pure functions used to
compose ad-hoc merged scenarios without needing new scenario JSON fixtures:

- ``inject_mountain_segment`` splits an ascending non-overlapping
  ``RouteSegmentFact`` list (POSITION-native — km extents) so a km range
  becomes a ``mountain_road`` run, preserving total route length.
- ``jam_traffic_event`` converts a km range into a POSITION-native
  ``traffic_events`` preset dict (``TrafficEvent`` shape — ``start_km``/
  ``end_km``, with ``start_min``/``duration_min`` retained as a time-axis
  fallback for consumers that don't read km), the only supported way to
  inject a traffic jam into ``create_draft`` (there is no pre-built
  ``EventPlan`` parameter).

Both functions are pure: no IO, no clock/random, no mutation of inputs.
"""
from __future__ import annotations

from aica_api.models.run import RouteSegmentFact

__all__ = [
    "inject_mountain_segment",
    "jam_traffic_event",
]


# ---------------------------------------------------------------------------
# inject_mountain_segment
# ---------------------------------------------------------------------------


def inject_mountain_segment(
    segments: list[RouteSegmentFact],
    start_km: float,
    end_km: float,
) -> list[RouteSegmentFact]:
    """Split ``segments`` so ``[start_km, end_km)`` becomes a ``mountain_road`` run.

    ``segments`` is an ascending, non-overlapping, contiguous list — each seg
    covers ``[seg.start_km, seg.start_km + seg.length_km)``. The requested
    range is clamped to ``[0, total]`` where ``total`` is the route's overall
    length (end of the last segment). Any segment overlapped by the clamped
    range is split into up to 3 pieces: a "before" piece keeping the original
    type, the overlapped ``[start,end)`` slice retyped to ``mountain_road``,
    and an "after" piece keeping the original type — zero-length before/after
    pieces are dropped. Segments with no overlap are passed through unchanged.

    Total length is preserved and the result stays ascending/non-overlapping.

    Returns a new list; never mutates ``segments`` or its elements. An empty
    ``segments`` list, or an invalid/empty range (clamped ``start >= end``),
    returns a shallow copy of ``segments`` unchanged.
    """
    if not segments:
        return list(segments)

    total_km = segments[-1].start_km + segments[-1].length_km
    clamped_start = max(0.0, min(start_km, total_km))
    clamped_end = max(0.0, min(end_km, total_km))

    if clamped_start >= clamped_end:
        return list(segments)

    result: list[RouteSegmentFact] = []
    for seg in segments:
        seg_start = seg.start_km
        seg_end = seg.start_km + seg.length_km

        overlap_start = max(seg_start, clamped_start)
        overlap_end = min(seg_end, clamped_end)

        if overlap_start >= overlap_end:
            # No overlap with the mountain range — keep as-is.
            result.append(seg)
            continue

        if overlap_start > seg_start:
            result.append(
                RouteSegmentFact(
                    segment_type=seg.segment_type,
                    start_km=seg_start,
                    length_km=overlap_start - seg_start,
                )
            )

        result.append(
            RouteSegmentFact(
                segment_type="mountain_road",
                start_km=overlap_start,
                length_km=overlap_end - overlap_start,
            )
        )

        if seg_end > overlap_end:
            result.append(
                RouteSegmentFact(
                    segment_type=seg.segment_type,
                    start_km=overlap_end,
                    length_km=seg_end - overlap_end,
                )
            )

    return result


# ---------------------------------------------------------------------------
# jam_traffic_event
# ---------------------------------------------------------------------------


def jam_traffic_event(
    start_km: float,
    end_km: float,
    total_km: float,
    est_duration_min: float,
    *,
    speed_kph: float = 15.0,
    event_id: str = "manual_jam",
    affected_segment_id: str = "manual",
) -> dict:
    """Convert a km range into a POSITION-native ``traffic_events`` preset dict.

    ``TrafficEvent`` (the engine's fact model) now carries optional
    ``start_km``/``end_km`` alongside its original TIME fields. Since routes
    are not time-linear in distance (multiple segment speeds + auto-rest
    stops), the km range is set directly on ``start_km``/``end_km`` so the
    tick engine (``_active_traffic_jam``) gates congestion on the actual
    route position the jam was painted at. ``start_min``/``duration_min`` are
    still computed via the naive uniform conversion (``start_min =
    (start_km/total_km) * est_duration_min``, ``duration_min =
    ((end_km-start_km)/total_km) * est_duration_min``) and RETAINED as a
    time-axis fallback for consumers that don't read km (e.g. legacy
    time-only jam handling). ``affected_segment_id`` is display-only (the
    tick engine never reads it to decide congestion).
    """
    return {
        "id": event_id,
        "start_min": (start_km / total_km) * est_duration_min,
        "duration_min": ((end_km - start_km) / total_km) * est_duration_min,
        "affected_segment_id": affected_segment_id,
        "speed_kph": speed_kph,
        "start_km": start_km,
        "end_km": end_km,
    }
