"""TDD tests for recovery API surface in /api/runs (Task 6).

Verifies:
  - GET  /api/runs/{id}/rest-spots returns deterministic fallback spots from
    route_facts.rest_spot_positions when no maps_key is supplied.
  - POST /api/runs/{id}/actions accepts recovery_option_id + rest_spot in the body.
  - POST /api/runs/{id}/tick response includes motion_state + recovery_phase fields.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from aica_api.main import app
from aica_api.services.run_manager import clear_registry
from aica_api.services.run_plan import clear_draft_registry
from tests.helpers_recovery import create_paused_rest_run

client = TestClient(app)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def reset_registry():
    """Isolate each test — clear both in-memory registries before and after."""
    clear_registry()
    clear_draft_registry()
    yield
    clear_registry()
    clear_draft_registry()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_rest_spots_fallback_without_key():
    """GET /rest-spots without maps_key returns deterministic scenario-derived spots."""
    run_id = create_paused_rest_run()
    r = client.get(f"/api/runs/{run_id}/rest-spots")
    assert r.status_code == 200
    spots = r.json()["rest_spots"]
    assert len(spots) >= 1
    assert "route_fraction" in spots[0]


def test_action_body_accepts_recovery_payload():
    """POST /actions with recovery_option_id + rest_spot accepted; run resumes playing."""
    run_id = create_paused_rest_run()
    r = client.post(f"/api/runs/{run_id}/actions", json={
        "action": "accept_rest",
        "recovery_option_id": "nap_karaoke",
        "rest_spot": {"id": "p1", "label": {"ja": "SA", "en": "SA"}, "route_fraction": 0.5},
    })
    assert r.status_code == 200
    assert r.json()["status"] == "playing"


def test_tick_response_exposes_motion_and_phase():
    """POST /tick response includes motion_state and recovery_phase keys."""
    run_id = create_paused_rest_run()
    client.post(f"/api/runs/{run_id}/actions", json={
        "action": "accept_rest",
        "recovery_option_id": "nap_karaoke",
        "rest_spot": {"id": "p1", "label": {"ja": "SA", "en": "SA"}, "route_fraction": 0.5},
    })
    r = client.post(f"/api/runs/{run_id}/tick")
    body = r.json()
    assert "motion_state" in body and "recovery_phase" in body


def test_rest_spots_404_for_unknown_run():
    """GET /rest-spots returns 404 for an unknown run_id."""
    r = client.get("/api/runs/nonexistent_run_xyz/rest-spots")
    assert r.status_code == 404


def test_rest_spots_has_distance_eta_reachable_keys():
    """GET /rest-spots returns distance_km, eta_min, reachable on each spot."""
    run_id = create_paused_rest_run()
    r = client.get(f"/api/runs/{run_id}/rest-spots")
    assert r.status_code == 200
    spots = r.json()["rest_spots"]
    assert len(spots) >= 1
    for spot in spots:
        assert "distance_km" in spot, f"missing distance_km in {spot}"
        assert "eta_min" in spot, f"missing eta_min in {spot}"
        assert "reachable" in spot, f"missing reachable in {spot}"
        assert isinstance(spot["distance_km"], (int, float))
        assert isinstance(spot["reachable"], bool)


def test_rest_spots_at_least_one_reachable_normal_run():
    """For a normal paused run (ceiling=80), at least one spot is reachable."""
    run_id = create_paused_rest_run()
    r = client.get(f"/api/runs/{run_id}/rest-spots")
    spots = r.json()["rest_spots"]
    # Default ceiling is 80.0; base_growth_per_min=0.5; drowsiness at tick 29 is
    # well under the ceiling (started at "weak" ~20, grew ~14.5 pts over 29 min).
    assert any(spot["reachable"] for spot in spots), (
        "expected at least one reachable spot for a normal run (ceiling=80)"
    )


def test_rest_spots_ceiling_override_via_query_param():
    """drowsiness_ceiling query param overrides scenario ceiling; a far spot unreachable at
    default ceiling=80 becomes reachable at ceiling=200."""
    run_id = create_paused_rest_run()

    # With a very tight ceiling (1.0) at least one spot is unreachable
    r_tight = client.get(f"/api/runs/{run_id}/rest-spots?drowsiness_ceiling=1.0")
    assert r_tight.status_code == 200
    spots_tight = r_tight.json()["rest_spots"]
    assert any(not s["reachable"] for s in spots_tight), "expected some unreachable at ceiling=1.0"

    # With a very high ceiling (200) those spots become reachable
    r_high = client.get(f"/api/runs/{run_id}/rest-spots?drowsiness_ceiling=200")
    assert r_high.status_code == 200
    spots_high = r_high.json()["rest_spots"]
    assert any(s["reachable"] for s in spots_high), (
        f"expected at least one spot reachable at ceiling=200; got {spots_high}"
    )


def test_rest_spots_unreachable_when_ceiling_very_low():
    """All spots unreachable when rest_drowsiness_ceiling is lower than current drowsiness."""
    import json as _json
    import pathlib
    import tempfile

    from aica_api.models.package import PackageManifest
    from aica_api.services.run_manager import clear_registry as _clear
    from aica_api.services.run_manager import create_run as _create_run
    from aica_api.services.run_manager import tick as _tick
    from aica_api.services.run_plan import clear_draft_registry as _clear_drafts
    from aica_api.services.run_plan import create_draft as _create_draft
    from tests.helpers_recovery import m2_scenario_with_recovery

    _REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
    _PKG_PATH = _REPO_ROOT / "packages" / "rest_rule_based_v0_1" / "package.json"
    package = PackageManifest(**_json.loads(_PKG_PATH.read_text(encoding="utf-8")))

    # ceiling=1.0: any drowsiness > 1.0 makes all spots unreachable
    scenario = m2_scenario_with_recovery(total_km=64.0, initial_drowsiness="weak")
    scenario = scenario.model_copy(update={"rest_drowsiness_ceiling": 1.0})

    run_id = "ceiling_test_run"
    plan_id = f"plan_{run_id}"
    runs_dir = pathlib.Path(tempfile.mkdtemp())
    _create_draft(
        plan_id=plan_id,
        package=package,
        scenario=scenario,
        presets={},
        parameters={},
        hyperparameters={},
        run_mode="standard",
    )
    _create_run(plan_id, run_id, runs_dir)

    # Tick a few times to accumulate drowsiness (proposal doesn't fire until ~tick 29)
    for _ in range(5):
        outcome = _tick(run_id)
        if outcome.paused or outcome.completed:
            break

    r = client.get(f"/api/runs/{run_id}/rest-spots")
    assert r.status_code == 200
    spots = r.json()["rest_spots"]
    assert len(spots) >= 1
    # With ceiling=1.0 and drowsiness growing from ~20 (initial "weak"), all spots unreachable
    assert all(not spot["reachable"] for spot in spots), (
        f"expected all spots unreachable with ceiling=1.0; got {spots}"
    )
