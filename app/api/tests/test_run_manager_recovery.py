"""TDD tests for run_manager recovery integration (Task 5).

Verifies:
  - action("accept_rest", recovery_option_id=..., rest_spot=...) starts recovery
    instead of completing the run, when the scenario has recovery_options.
  - action("accept_rest") without a valid option raises ActionNotAllowedError.
  - tick() threads recovery through advance_tick, phases appear in raw_state,
    and the run completes after the full recovery sequence.
  - Scenarios WITHOUT recovery_options keep the existing accept_rest → completed
    back-compat behaviour (covered by test_run_manager.py).
"""

from __future__ import annotations

import pytest

import aica_api.services.run_manager as rm
from aica_api.models.run import RestSpot
from aica_api.services.run_manager import clear_registry
from aica_api.services.run_plan import clear_draft_registry
from tests.helpers_recovery import create_paused_rest_run


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def reset_registry():
    """Isolate each test — clear both in-memory registries."""
    clear_registry()
    clear_draft_registry()
    yield
    clear_registry()
    clear_draft_registry()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_accept_rest_with_option_resumes_into_recovery():
    """accept_rest with a valid recovery_option_id starts recovery (status=playing)."""
    run_id = create_paused_rest_run()
    spot = RestSpot(id="p1", label={"ja": "SA", "en": "SA"}, route_fraction=0.5)
    rs = rm.action(run_id, "accept_rest", recovery_option_id="nap_karaoke", rest_spot=spot)
    assert rs.status.value == "playing"
    assert rs.recovery is not None and rs.recovery.active
    assert rs.recovery.option_id == "nap_karaoke"
    assert rs.recovery.rest_spot.id == "p1"


def test_accept_rest_missing_option_is_rejected():
    """accept_rest without recovery_option_id raises ActionNotAllowedError."""
    run_id = create_paused_rest_run()
    try:
        rm.action(run_id, "accept_rest")
        assert False, "expected ActionNotAllowedError"
    except rm.ActionNotAllowedError:
        pass


def test_recovery_runs_to_resume_and_completes():
    """Full recovery sequence: phases appear in raw_state and the run completes."""
    run_id = create_paused_rest_run()
    spot = RestSpot(id="p1", label={"ja": "SA", "en": "SA"}, route_fraction=0.5)
    rm.action(run_id, "accept_rest", recovery_option_id="nap_karaoke", rest_spot=spot)
    phases = []
    for _ in range(40):
        out = rm.tick(run_id)
        ts = out.tick_state
        if ts is not None and ts.raw_state.get("recoveryPhase"):
            phases.append(ts.raw_state["recoveryPhase"])
        if out.completed:
            break
    assert "nap" in phases and "content" in phases     # staged recovery happened
    assert out.completed                               # resumed and reached destination
