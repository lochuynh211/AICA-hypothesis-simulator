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
#
# NOT a general rate limiter: _DECLINE_COOLDOWN_SEC already bounds every
# NORMALLY-spaced (cooldown-setting) fire. This is a backstop for the ONE
# path that sets no cooldown — rest_required answered with accept_rest (the
# recovery_active gate in tick() is what suppresses a second REST_PROPOSAL
# while resting; that's not this function's job). See the constant
# definitions in run_manager.py for the full sizing rationale.
# ---------------------------------------------------------------------------


def test_count_cap_suppresses_the_fire_past_the_limit_inside_the_window():
    """The backstop path: accept_rest sets no interval cooldown, so nothing
    else bounds a burst of accepted rest proposals — only the count cap
    can."""
    from aica_api.services.run_manager import (
        _MAX_PROPOSALS_PER_WINDOW, _PROPOSAL_COUNT_WINDOW_SEC,
    )

    events = []
    spacing = 60.0
    for i in range(_MAX_PROPOSALS_PER_WINDOW):
        at = i * spacing
        events.append(fired_tick_event(tick_index=i, category="rest_required",
                                       elapsed_seconds=at))
        events.append(action_event(tick_index=i, action="accept_rest"))
    last_at = (_MAX_PROPOSALS_PER_WINDOW - 1) * spacing

    capped = _derive_response_suppression(events, current_sim_sec=last_at, tick_seconds=60.0)
    assert capped["rest_required"] is True, "count cap must backstop the accept_rest path"

    rolled = _derive_response_suppression(
        events, current_sim_sec=last_at + _PROPOSAL_COUNT_WINDOW_SEC, tick_seconds=60.0
    )
    assert rolled["rest_required"] is False, "cap releases as the window rolls"


def test_normally_spaced_fires_are_never_count_capped():
    """Pins the ruling: cooldown-respecting fires (the normal path, spaced
    at the _DECLINE_COOLDOWN_SEC cadence) must never be suppressed by the
    count cap. If they were, the cap would silently tighten a package's own
    tuned fire-control (e.g. Hybrid's max_proposals_per_30min) instead of
    only backstopping the un-cooldowned accept_rest path.

    Mirrors the REAL call site (run_manager.tick(), ~line 1105): the harness
    always evaluates with current_sim_sec equal to the CURRENT, still-
    UNANSWERED fire's own sim time — its TickEvent is already written to the
    evidence log, but no ActionEvent exists for it yet (the driver hasn't
    responded). Evaluating instead at some later, fully-answered point (as
    an earlier version of this test did) shifts the effective window and
    hides the count cap's true boundary — verified: with the current fire
    left unanswered like this, the no-override boundary is exactly
    window <= 3600 (window=3601 already suppresses a legitimate fire),
    whereas evaluating post-answer only goes red around window>=5401 — a
    dead band wide enough for a plausible bad retune (e.g. 5000) to sail
    through undetected. Fires well past _MAX_PROPOSALS_PER_WINDOW times so a
    future regression can't sneak by on a small sample."""
    from aica_api.services.run_manager import _MAX_PROPOSALS_PER_WINDOW

    events = []
    n = _MAX_PROPOSALS_PER_WINDOW * 3
    for i in range(n - 1):
        at = i * _DECLINE_COOLDOWN_SEC
        events.append(fired_tick_event(tick_index=i, category="monotony_prevention",
                                       elapsed_seconds=at))
        events.append(action_event(tick_index=i, action="acknowledge"))
    # The current candidate fire — TickEvent only, no matching ActionEvent,
    # exactly as it exists at the point run_manager.tick() calls this.
    current_at = (n - 1) * _DECLINE_COOLDOWN_SEC
    events.append(fired_tick_event(tick_index=n - 1, category="monotony_prevention",
                                   elapsed_seconds=current_at))

    result = _derive_response_suppression(events, current_sim_sec=current_at, tick_seconds=60.0)
    assert result["monotony_prevention"] is False, (
        "the count cap must never bite on a normally cooldown-spaced, "
        "still-unanswered fire"
    )


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
    """A rest_required burst that hits the count backstop must not gag
    monotony_prevention, and vice versa. Both categories are driven through
    an un-cooldowned path (rest: accept_rest; monotony: an action outside
    {acknowledge, decline}, which likewise sets no cooldown) so this
    genuinely exercises per-category isolation of the count mechanism
    itself, not just an always-empty list for the other category."""
    from aica_api.services.run_manager import _MAX_PROPOSALS_PER_WINDOW

    spacing = 60.0
    events = []
    for i in range(_MAX_PROPOSALS_PER_WINDOW):
        at = i * spacing
        events.append(fired_tick_event(tick_index=2 * i, category="rest_required",
                                       elapsed_seconds=at))
        events.append(action_event(tick_index=2 * i, action="accept_rest"))
    # Monotony fires interleaved in time, one fewer than the cap, answered
    # with a non-cooldown-setting action so its count is close behind too.
    for i in range(_MAX_PROPOSALS_PER_WINDOW - 1):
        at = i * spacing + spacing / 2.0
        events.append(fired_tick_event(tick_index=2 * i + 1, category="monotony_prevention",
                                       elapsed_seconds=at))
        events.append(action_event(tick_index=2 * i + 1, action="dismiss"))

    last_at = (_MAX_PROPOSALS_PER_WINDOW - 1) * spacing

    result = _derive_response_suppression(events, current_sim_sec=last_at, tick_seconds=60.0)
    assert result["rest_required"] is True, "rest_required must hit its own count backstop"
    assert result["monotony_prevention"] is False, (
        "a rest_required burst must not gag monotony_prevention, even with "
        "monotony fires close behind on its own count"
    )
