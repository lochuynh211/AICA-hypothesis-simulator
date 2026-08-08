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
