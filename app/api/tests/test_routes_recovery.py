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
from tests.helpers_recovery import create_paused_rest_run, create_paused_rest_run_multi_spots

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
    """For a normal paused run (default ceiling=100), at least one spot is reachable."""
    run_id = create_paused_rest_run()
    r = client.get(f"/api/runs/{run_id}/rest-spots")
    spots = r.json()["rest_spots"]
    # Default ceiling is 100.0; base_growth_per_min=0.5; drowsiness at tick 29 is
    # well under the ceiling (started at "weak" ~20, grew ~14.5 pts over 29 min).
    assert any(spot["reachable"] for spot in spots), (
        "expected at least one reachable spot for a normal run (default ceiling=100)"
    )


def test_rest_spots_ceiling_override_via_query_param():
    """drowsiness_ceiling query param overrides scenario ceiling; a spot unreachable at
    ceiling=1.0 becomes reachable at ceiling=200."""
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


# ---------------------------------------------------------------------------
# M8: named rest spots — cap, spacing, ahead-filter, real names
# ---------------------------------------------------------------------------


def test_rest_spots_capped_at_five():
    """GET /rest-spots returns at most 5 spots even when more than 5 are seeded.

    Default fixture has 8 spots (1 behind, 7 ahead).  After the AHEAD filter
    and default spacing (20 km) the greedy walk produces up to 5 results.
    """
    run_id = create_paused_rest_run_multi_spots()
    r = client.get(f"/api/runs/{run_id}/rest-spots")
    assert r.status_code == 200
    spots = r.json()["rest_spots"]
    assert len(spots) <= 5, f"expected at most 5 spots, got {len(spots)}: {spots}"


def test_rest_spots_all_ahead_of_current_position():
    """GET /rest-spots only returns spots strictly ahead of the current driving position.

    The default fixture has 'Behind SA' at 20 km; the run pauses around 29 km.
    That spot must not appear in the response.
    """
    run_id = create_paused_rest_run_multi_spots()
    # Retrieve current position via prior tick state.
    from aica_api.services.run_manager import get_prior_tick_state, get_run

    rs = get_run(run_id)
    prior = get_prior_tick_state(run_id)
    current_km = prior.distance_km if prior else 0.0

    r = client.get(f"/api/runs/{run_id}/rest-spots")
    assert r.status_code == 200
    spots = r.json()["rest_spots"]
    total_km = rs.route_facts.total_route_distance_km or 200.0
    for spot in spots:
        # Recover position_km from route_fraction
        pos_km = spot["route_fraction"] * total_km
        assert pos_km > current_km, (
            f"spot at {pos_km:.1f} km is not strictly ahead of current {current_km:.1f} km: {spot}"
        )


def test_rest_spots_default_spacing_20km():
    """With default min_distance_km=20, consecutive returned spots are ≥ 20 km apart."""
    run_id = create_paused_rest_run_multi_spots()
    r = client.get(f"/api/runs/{run_id}/rest-spots")
    assert r.status_code == 200
    spots = r.json()["rest_spots"]
    assert len(spots) >= 2, "need at least 2 spots to verify spacing"

    from aica_api.services.run_manager import get_run
    rs = get_run(run_id)
    total_km = rs.route_facts.total_route_distance_km or 200.0

    positions_km = [s["route_fraction"] * total_km for s in spots]
    for i in range(1, len(positions_km)):
        gap = positions_km[i] - positions_km[i - 1]
        assert gap >= 20.0, (
            f"consecutive spots too close: {positions_km[i - 1]:.1f} km and "
            f"{positions_km[i]:.1f} km (gap={gap:.1f} < 20)"
        )


def test_rest_spots_explicit_min_distance_50km():
    """?min_distance_km=50 returns spots at least 50 km apart."""
    run_id = create_paused_rest_run_multi_spots()
    r = client.get(f"/api/runs/{run_id}/rest-spots?min_distance_km=50")
    assert r.status_code == 200
    spots = r.json()["rest_spots"]
    # With spots at [35, 45, 65, 85, 105, 125, 145] and spacing=50:
    # take 35, skip 45/65, take 85 (85-35=50>=50), skip 105/125, take 145 (145-85=60>=50)
    assert len(spots) >= 1, "expected at least 1 spot with min_distance_km=50"
    assert len(spots) <= 5, f"expected at most 5 spots, got {len(spots)}"

    from aica_api.services.run_manager import get_run
    rs = get_run(run_id)
    total_km = rs.route_facts.total_route_distance_km or 200.0

    positions_km = [s["route_fraction"] * total_km for s in spots]
    for i in range(1, len(positions_km)):
        gap = positions_km[i] - positions_km[i - 1]
        assert gap >= 50.0, (
            f"consecutive spots too close at min_distance_km=50: "
            f"{positions_km[i - 1]:.1f} km and {positions_km[i]:.1f} km (gap={gap:.1f})"
        )


def test_rest_spots_use_real_names_when_named_spots_present():
    """Each spot's label uses the real facility name, not a generic 'Rest stop N'."""
    run_id = create_paused_rest_run_multi_spots()
    r = client.get(f"/api/runs/{run_id}/rest-spots")
    assert r.status_code == 200
    spots = r.json()["rest_spots"]
    assert len(spots) >= 1, "expected at least one spot"
    for spot in spots:
        label_en = spot["label"]["en"]
        # Must be a real name from the fixture, not a generic label
        assert not label_en.startswith("Rest stop "), (
            f"expected real facility name, got generic label: {label_en!r}"
        )
        assert label_en in {"Near SA", "Mid SA 1", "Mid SA 2", "Far SA 1", "Far SA 2", "Far SA 3"}, (
            f"unexpected spot label: {label_en!r} (Behind SA should be filtered; "
            "Close SA should be dropped by spacing)"
        )
