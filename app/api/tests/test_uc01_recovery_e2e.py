"""End-to-end test for UC-01 scenario with recovery_options (Task 12 / M7).

Exercises the full HTTP stack:
  route-plan → create run → tick until paused on REST_PROPOSAL →
  GET rest-spots → POST accept_rest(nap_karaoke) →
  tick to completion, asserting recovery phases appeared and the run completed.

The scenario used is uc01_fatigue_recovery_v0_1 — a copy of friend_drive with
recovery_options added (nap_karaoke, convenience_stretch, postpone).
The original uc01_fatigue_friend_drive_v0_1 is left untouched.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from aica_api.main import app
from aica_api.services.run_manager import clear_registry
from aica_api.services.run_plan import clear_draft_registry


@pytest.fixture(autouse=True)
def reset_registries():
    """Isolate each test — clear both in-memory registries."""
    clear_registry()
    clear_draft_registry()
    yield
    clear_registry()
    clear_draft_registry()


def test_uc01_rest_recovery_full_run(monkeypatch, tmp_path):
    """Full UC-01 recovery e2e: REST_PROPOSAL → accept_rest(nap_karaoke) → completion.

    Verifies:
    - uc01_fatigue_recovery_v0_1 (with recovery_options) loads and fires a REST_PROPOSAL.
    - accept_rest with recovery_option_id="nap_karaoke" + the first fallback rest-spot
      starts the staged recovery (status=playing, recovery active).
    - Recovery phases "nap" and "content" appear in subsequent tick-response
      recovery_phase fields.
    - The run reaches completed=True after the full recovery sequence.
    """
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
    client = TestClient(app)

    # ── Step 1: Create a run plan ────────────────────────────────────────────
    plan_resp = client.post(
        "/api/run-plans",
        json={
            "package_id": "rest_rule_based_v0_1",
            "scenario_id": "uc01_fatigue_recovery_v0_1",
        },
    )
    assert plan_resp.status_code == 201, (
        f"Expected 201 from /api/run-plans; got {plan_resp.status_code}: {plan_resp.text}"
    )
    plan_id = plan_resp.json()["plan_id"]

    # ── Step 2: Create the run ────────────────────────────────────────────────
    run_resp = client.post("/api/runs", json={"plan_id": plan_id})
    assert run_resp.status_code == 201, (
        f"Expected 201 from /api/runs; got {run_resp.status_code}: {run_resp.text}"
    )
    run_id = run_resp.json()["run_id"]

    # ── Step 3: Tick until paused on REST_PROPOSAL ────────────────────────────
    # The friend_drive profile + declarative_rule fires at ~tick 29 with the
    # uc01_fatigue_recovery_v0_1 scenario (same initial_state + driver_profile).
    paused = False
    for _ in range(80):  # generous budget; proposal fires at ~tick 29
        tick_resp = client.post(f"/api/runs/{run_id}/tick")
        assert tick_resp.status_code == 200, tick_resp.text
        body = tick_resp.json()
        if body.get("paused"):
            paused = True
            break
        if body.get("completed"):
            pytest.fail("Run completed before a REST_PROPOSAL fired")

    assert paused, "REST_PROPOSAL should pause the run within 80 ticks"
    run_state = client.get(f"/api/runs/{run_id}").json()
    assert run_state["pending_proposal"] is not None, "Expected a pending proposal"

    # ── Step 4: GET rest-spots → pick first ──────────────────────────────────
    spots_resp = client.get(f"/api/runs/{run_id}/rest-spots")
    assert spots_resp.status_code == 200, spots_resp.text
    spots = spots_resp.json()["rest_spots"]
    assert len(spots) > 0, "Expected at least one fallback rest spot"
    first_spot = spots[0]

    # ── Step 5: Accept rest with nap_karaoke recovery option ─────────────────
    action_resp = client.post(
        f"/api/runs/{run_id}/actions",
        json={
            "action": "accept_rest",
            "recovery_option_id": "nap_karaoke",
            "rest_spot": first_spot,
        },
    )
    assert action_resp.status_code == 200, (
        f"accept_rest failed: {action_resp.status_code}: {action_resp.text}"
    )
    assert action_resp.json()["status"] == "playing", (
        "After accept_rest with recovery_options, run should be playing (not completed)"
    )

    # ── Step 6: Tick to completion, collecting recovery_phase values ──────────
    # Expected phases: wakefulness (MOVING toward rest spot) → nap (STOPPED, 3 ticks)
    # → content (STOPPED, 3 ticks) → resuming → normal driving → completed.
    # Total: ~30 wakefulness + 3 nap + 3 content + ~60 resume = ~96 ticks; budget 200.
    observed_phases: list[str] = []
    completed = False
    for _ in range(200):
        tick_resp = client.post(f"/api/runs/{run_id}/tick")
        assert tick_resp.status_code == 200, tick_resp.text
        body = tick_resp.json()
        phase = body.get("recovery_phase")
        if phase:
            observed_phases.append(phase)
        if body.get("completed"):
            completed = True
            break
        if body.get("run_state", {}).get("status") == "completed":
            completed = True
            break

    # ── Assertions ────────────────────────────────────────────────────────────
    assert "nap" in observed_phases, (
        f"Expected 'nap' phase in tick responses; observed phases: {observed_phases}"
    )
    assert "content" in observed_phases, (
        f"Expected 'content' phase in tick responses; observed phases: {observed_phases}"
    )
    assert completed, (
        f"Run did not complete within 200 ticks after recovery. "
        f"Observed phases: {observed_phases}"
    )
