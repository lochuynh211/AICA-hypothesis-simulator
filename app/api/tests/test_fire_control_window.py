"""Fire-control conformance (recovery design §9). CDC-SU slides 34 and 81."""
import pytest

from aica_api.services.run_manager import _DECLINE_COOLDOWN_SEC, _derive_response_suppression
from tests.helpers_recovery import fired_tick_event, action_event   # add these helpers


def test_acknowledged_monotony_is_suppressed_only_for_the_window():
    events = [
        fired_tick_event(tick_index=1, category="monotony_prevention", elapsed_seconds=600.0),
        action_event(tick_index=1, action="acknowledge"),
    ]
    inside = _derive_response_suppression(events, current_sim_sec=700.0, tick_seconds=60.0)
    assert inside["monotony_prevention"] is True

    outside = _derive_response_suppression(
        events, current_sim_sec=600.0 + _DECLINE_COOLDOWN_SEC + 1.0, tick_seconds=60.0
    )
    assert outside["monotony_prevention"] is False


def test_a_rest_proposal_is_no_longer_needed_to_release_the_window():
    """Previously an acknowledge latched until any REST_PROPOSAL fired."""
    events = [
        fired_tick_event(tick_index=1, category="monotony_prevention", elapsed_seconds=0.0),
        action_event(tick_index=1, action="acknowledge"),
    ]
    released = _derive_response_suppression(
        events, current_sim_sec=_DECLINE_COOLDOWN_SEC + 1.0, tick_seconds=60.0
    )
    assert released["monotony_prevention"] is False
    assert released["rest_required"] is False


def test_declined_monotony_is_unchanged():
    events = [
        fired_tick_event(tick_index=1, category="monotony_prevention", elapsed_seconds=600.0),
        action_event(tick_index=1, action="decline"),
    ]
    assert _derive_response_suppression(
        events, current_sim_sec=700.0, tick_seconds=60.0
    )["monotony_prevention"] is True


# ---------------------------------------------------------------------------
# 単位時間あたり提案回数 — per-category proposal count cap (CDC-SU slide 34)
# ---------------------------------------------------------------------------


def test_count_cap_suppresses_the_fire_past_the_limit_inside_the_window():
    from aica_api.services.run_manager import (
        _MAX_PROPOSALS_PER_WINDOW, _PROPOSAL_COUNT_WINDOW_SEC,
    )

    events = []
    # N actionable monotony fires, each answered, spaced past the cooldown so
    # only the COUNT cap can suppress the next one.
    for i in range(_MAX_PROPOSALS_PER_WINDOW):
        at = i * (_DECLINE_COOLDOWN_SEC + 60.0)
        events.append(fired_tick_event(tick_index=i, category="monotony_prevention",
                                       elapsed_seconds=at))
        events.append(action_event(tick_index=i, action="acknowledge"))
    last_at = (_MAX_PROPOSALS_PER_WINDOW - 1) * (_DECLINE_COOLDOWN_SEC + 60.0)
    just_after = last_at + _DECLINE_COOLDOWN_SEC + 1.0

    capped = _derive_response_suppression(events, current_sim_sec=just_after, tick_seconds=60.0)
    assert capped["monotony_prevention"] is True, "count cap must suppress"

    rolled = _derive_response_suppression(
        events, current_sim_sec=just_after + _PROPOSAL_COUNT_WINDOW_SEC, tick_seconds=60.0
    )
    assert rolled["monotony_prevention"] is False, "cap releases as the window rolls"


def test_suppressed_fires_are_not_counted_towards_the_cap():
    """Only fires the driver actually saw count — otherwise a suppressed burst
    would silently consume the whole allowance."""
    events = [
        fired_tick_event(tick_index=1, category="monotony_prevention", elapsed_seconds=0.0),
        action_event(tick_index=1, action="acknowledge"),
    ]
    # Unanswered fires inside the suppression window were never shown.
    for i in range(2, 40):
        events.append(fired_tick_event(tick_index=i, category="monotony_prevention",
                                       elapsed_seconds=float(i * 10)))
    released = _derive_response_suppression(
        events, current_sim_sec=_DECLINE_COOLDOWN_SEC + 1.0, tick_seconds=60.0
    )
    assert released["monotony_prevention"] is False


def test_the_cap_is_per_category():
    """A monotony burst that hits its own cap must not gag rest_required —
    exercised with rest fires interleaved in time and one shy of ITS cap, so
    a bug that shared the count across categories (or leaked interleaved
    timing) would be caught, not just an always-empty rest_required list."""
    from aica_api.services.run_manager import (
        _MAX_PROPOSALS_PER_WINDOW, _PROPOSAL_COUNT_WINDOW_SEC,
    )

    spacing = _DECLINE_COOLDOWN_SEC + 60.0
    events = []
    for i in range(_MAX_PROPOSALS_PER_WINDOW):
        at = i * spacing
        events.append(fired_tick_event(tick_index=2 * i, category="monotony_prevention",
                                       elapsed_seconds=at))
        events.append(action_event(tick_index=2 * i, action="acknowledge"))
    # Rest fires interleaved in time between the monotony fires, one fewer
    # than the cap, each accepted (no cooldown latch) so only the count
    # dimension is in play for rest too.
    for i in range(_MAX_PROPOSALS_PER_WINDOW - 1):
        at = i * spacing + spacing / 2.0
        events.append(fired_tick_event(tick_index=2 * i + 1, category="rest_required",
                                       elapsed_seconds=at))
        events.append(action_event(tick_index=2 * i + 1, action="accept_rest"))

    last_at = (_MAX_PROPOSALS_PER_WINDOW - 1) * spacing
    just_after = last_at + _DECLINE_COOLDOWN_SEC + 1.0

    result = _derive_response_suppression(events, current_sim_sec=just_after, tick_seconds=60.0)
    assert result["monotony_prevention"] is True, "monotony must hit its own count cap"
    assert result["rest_required"] is False, (
        "a monotony burst must not gag rest_required, even with rest fires "
        "close behind on its own count"
    )
