"""Tests for U4 — run-plans route selection + provenance threading (T006).

Covers:
  - Local selection (no route_id / route_source="local"): backward compat
  - Local selection: client-supplied display_route discarded (Fix 1)
  - Maps selection: route_id + route_facts + display_route + route_source threaded
    into draft → RunState → RunLog
  - Maps selection missing route_facts → 400
  - route_source + display_route frozen in RunLog (no key in evidence)
  - Non-vacuous key-safety test: sentinel submitted to analyze, absent from all evidence (Fix 2)
"""

from __future__ import annotations

import pathlib

import aica_api.services.maps_client as mc
import pytest
from fastapi.testclient import TestClient

from aica_api.main import app
from aica_api.services.run_manager import clear_registry
from aica_api.services.run_plan import clear_draft_registry

_FIXTURE_DIR = pathlib.Path(__file__).parent / "fixtures" / "maps"


def _directions_bytes(name: str = "directions_3_alternatives.json") -> bytes:
    return (_FIXTURE_DIR / name).read_bytes()


def _places_bytes(name: str = "places_service_area.json") -> bytes:
    return (_FIXTURE_DIR / name).read_bytes()


def _make_urlopen_seq(responses: list[bytes]):
    """Return a _urlopen mock that pops from a sequence on each call."""
    calls = list(responses)

    def _mock(url: str) -> bytes:
        return calls.pop(0)

    return _mock

VALID_PACKAGE_ID = "rest_rule_based_v0_1"
VALID_SCENARIO_ID = "uc01_fatigue_friend_drive_v0_1"

_SENTINEL_KEY = "SENTINEL_API_KEY_MUST_NOT_LEAK"

_FAKE_ROUTE_FACTS = {
    "total_route_distance_km": 200.0,
    "estimated_route_duration_min": 150.0,
    "route_segments": [
        {"segment_type": "highway", "start_km": 0.0, "length_km": 200.0}
    ],
    "rest_spot_positions": [100.0],
    "route_progress_checkpoints": [50.0, 100.0, 150.0],
    "route_source": "maps",
}

_FAKE_DISPLAY_ROUTE = {
    "summary": "via I-5 N",
    "encoded_polyline": "mzneFnpyjV_}t@nhEb|FA",
    "start_label": "San Francisco, CA",
    "end_label": "Sacramento, CA",
}


@pytest.fixture(autouse=True)
def reset_registries():
    clear_registry()
    clear_draft_registry()
    yield
    clear_registry()
    clear_draft_registry()


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
    return TestClient(app)


# ── Local selection (backward compat) ─────────────────────────────────────────


class TestLocalSelection:
    """CreateRunPlanBody with no route_id / route_source='local' → local behavior."""

    def test_local_selection_creates_plan(self, client):
        """POST /api/run-plans without route selection fields → 201."""
        resp = client.post(
            "/api/run-plans",
            json={
                "package_id": VALID_PACKAGE_ID,
                "scenario_id": VALID_SCENARIO_ID,
                "parameters": {},
                "hyperparameters": {},
                "run_mode": "standard",
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert "plan_id" in body

    def test_local_selection_run_has_route_source_local(self, client):
        """Run created from local plan has route_source='local' in RunState."""
        plan_resp = client.post(
            "/api/run-plans",
            json={
                "package_id": VALID_PACKAGE_ID,
                "scenario_id": VALID_SCENARIO_ID,
                "parameters": {},
                "hyperparameters": {},
            },
        )
        assert plan_resp.status_code == 201
        plan_id = plan_resp.json()["plan_id"]

        run_resp = client.post("/api/runs", json={"plan_id": plan_id})
        assert run_resp.status_code == 201
        run_state = run_resp.json()
        assert run_state.get("route_source") == "local"

    def test_local_selection_log_has_route_source_local(self, client):
        """RunLog created from local plan has route_source='local'."""
        plan_resp = client.post(
            "/api/run-plans",
            json={
                "package_id": VALID_PACKAGE_ID,
                "scenario_id": VALID_SCENARIO_ID,
                "parameters": {},
                "hyperparameters": {},
            },
        )
        plan_id = plan_resp.json()["plan_id"]
        run_resp = client.post("/api/runs", json={"plan_id": plan_id})
        run_id = run_resp.json()["run_id"]

        log_resp = client.get(f"/api/runs/{run_id}/log")
        assert log_resp.status_code == 200
        log = log_resp.json()
        assert log.get("route_source") == "local"
        assert log.get("display_route") is None

    def test_local_selection_ignores_display_route(self, client):
        """Fix 1: route_source='local' with a client-supplied display_route → display_route is None.

        The local path must discard any display_route submitted by the client;
        local analysis is used and the map-display snapshot must not leak into the draft or log.
        """
        resp = client.post(
            "/api/run-plans",
            json={
                "package_id": VALID_PACKAGE_ID,
                "scenario_id": VALID_SCENARIO_ID,
                "route_source": "local",
                "display_route": _FAKE_DISPLAY_ROUTE,  # must be discarded by the router
                "parameters": {},
                "hyperparameters": {},
            },
        )
        assert resp.status_code == 201
        plan_id = resp.json()["plan_id"]

        run_resp = client.post("/api/runs", json={"plan_id": plan_id})
        assert run_resp.status_code == 201
        run_id = run_resp.json()["run_id"]

        # RunState must have null display_route
        run_state = run_resp.json()
        assert run_state.get("display_route") is None, (
            f"Local path must discard client-supplied display_route in RunState; "
            f"got {run_state.get('display_route')!r}"
        )
        assert run_state.get("route_source") == "local"

        # RunLog must also have null display_route
        log_resp = client.get(f"/api/runs/{run_id}/log")
        assert log_resp.status_code == 200
        log = log_resp.json()
        assert log.get("display_route") is None, (
            f"Local path must discard client-supplied display_route in RunLog; "
            f"got {log.get('display_route')!r}"
        )
        assert log.get("route_source") == "local"


# ── Maps selection ────────────────────────────────────────────────────────────


class TestMapsSelection:
    """CreateRunPlanBody with maps route_id + route_facts + display_route."""

    def test_maps_selection_creates_plan(self, client):
        """POST /api/run-plans with maps route_id + route_facts → 201."""
        resp = client.post(
            "/api/run-plans",
            json={
                "package_id": VALID_PACKAGE_ID,
                "scenario_id": VALID_SCENARIO_ID,
                "route_id": "route-0",
                "route_source": "maps",
                "route_facts": _FAKE_ROUTE_FACTS,
                "display_route": _FAKE_DISPLAY_ROUTE,
                "parameters": {},
                "hyperparameters": {},
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert "plan_id" in body

    def test_maps_selection_run_state_has_route_source_maps(self, client):
        """Run created from maps plan has route_source='maps' in RunState."""
        plan_resp = client.post(
            "/api/run-plans",
            json={
                "package_id": VALID_PACKAGE_ID,
                "scenario_id": VALID_SCENARIO_ID,
                "route_id": "route-0",
                "route_source": "maps",
                "route_facts": _FAKE_ROUTE_FACTS,
                "display_route": _FAKE_DISPLAY_ROUTE,
                "parameters": {},
                "hyperparameters": {},
            },
        )
        assert plan_resp.status_code == 201
        plan_id = plan_resp.json()["plan_id"]

        run_resp = client.post("/api/runs", json={"plan_id": plan_id})
        assert run_resp.status_code == 201
        run_state = run_resp.json()
        assert run_state.get("route_source") == "maps"

    def test_maps_selection_run_state_has_display_route(self, client):
        """Run created from maps plan has display_route in RunState."""
        plan_resp = client.post(
            "/api/run-plans",
            json={
                "package_id": VALID_PACKAGE_ID,
                "scenario_id": VALID_SCENARIO_ID,
                "route_id": "route-0",
                "route_source": "maps",
                "route_facts": _FAKE_ROUTE_FACTS,
                "display_route": _FAKE_DISPLAY_ROUTE,
                "parameters": {},
                "hyperparameters": {},
            },
        )
        plan_id = plan_resp.json()["plan_id"]
        run_resp = client.post("/api/runs", json={"plan_id": plan_id})
        run_state = run_resp.json()
        dr = run_state.get("display_route")
        assert dr is not None
        assert dr["summary"] == _FAKE_DISPLAY_ROUTE["summary"]
        assert dr["encoded_polyline"] == _FAKE_DISPLAY_ROUTE["encoded_polyline"]

    def test_maps_selection_log_has_route_source_maps(self, client):
        """RunLog from maps plan has route_source='maps'."""
        plan_resp = client.post(
            "/api/run-plans",
            json={
                "package_id": VALID_PACKAGE_ID,
                "scenario_id": VALID_SCENARIO_ID,
                "route_id": "route-0",
                "route_source": "maps",
                "route_facts": _FAKE_ROUTE_FACTS,
                "display_route": _FAKE_DISPLAY_ROUTE,
                "parameters": {},
                "hyperparameters": {},
            },
        )
        plan_id = plan_resp.json()["plan_id"]
        run_resp = client.post("/api/runs", json={"plan_id": plan_id})
        run_id = run_resp.json()["run_id"]

        log_resp = client.get(f"/api/runs/{run_id}/log")
        assert log_resp.status_code == 200
        log = log_resp.json()
        assert log.get("route_source") == "maps"

    def test_maps_selection_log_has_display_route(self, client):
        """RunLog from maps plan has display_route with polyline."""
        plan_resp = client.post(
            "/api/run-plans",
            json={
                "package_id": VALID_PACKAGE_ID,
                "scenario_id": VALID_SCENARIO_ID,
                "route_id": "route-0",
                "route_source": "maps",
                "route_facts": _FAKE_ROUTE_FACTS,
                "display_route": _FAKE_DISPLAY_ROUTE,
                "parameters": {},
                "hyperparameters": {},
            },
        )
        plan_id = plan_resp.json()["plan_id"]
        run_resp = client.post("/api/runs", json={"plan_id": plan_id})
        run_id = run_resp.json()["run_id"]

        log_resp = client.get(f"/api/runs/{run_id}/log")
        log = log_resp.json()
        dr = log.get("display_route")
        assert dr is not None
        assert dr["encoded_polyline"] == _FAKE_DISPLAY_ROUTE["encoded_polyline"]

    def test_maps_selection_log_route_facts_from_selection(self, client):
        """RunLog route_facts come from the maps selection, not local analysis."""
        plan_resp = client.post(
            "/api/run-plans",
            json={
                "package_id": VALID_PACKAGE_ID,
                "scenario_id": VALID_SCENARIO_ID,
                "route_id": "route-0",
                "route_source": "maps",
                "route_facts": _FAKE_ROUTE_FACTS,
                "display_route": _FAKE_DISPLAY_ROUTE,
                "parameters": {},
                "hyperparameters": {},
            },
        )
        plan_id = plan_resp.json()["plan_id"]
        run_resp = client.post("/api/runs", json={"plan_id": plan_id})
        run_id = run_resp.json()["run_id"]

        log_resp = client.get(f"/api/runs/{run_id}/log")
        log = log_resp.json()
        rf = log.get("route_facts", {})
        assert rf.get("total_route_distance_km") == _FAKE_ROUTE_FACTS["total_route_distance_km"]
        assert rf.get("route_source") == "maps"

    def test_maps_selection_no_key_in_evidence(self, client, monkeypatch):
        """Fix 2: Non-vacuous key-safety test — sentinel is actually submitted to
        /api/routes/analyze (mocked at _urlopen level), then the returned alternative
        is used to create a run plan WITHOUT the key.  The sentinel must not appear
        in ANY downstream response: analyze, run-plans, run creation, tick, or RunLog.
        """
        # 1. Prepare mock: 1 directions call + 3 places calls (3 alternatives)
        dir_data = _directions_bytes("directions_3_alternatives.json")
        pl_data = _places_bytes("places_service_area.json")
        call_seq = [dir_data, pl_data, pl_data, pl_data]
        monkeypatch.setattr(mc, "_urlopen", _make_urlopen_seq(call_seq))

        # 2. Submit sentinel key to /api/routes/analyze
        analyze_resp = client.post(
            "/api/routes/analyze",
            json={
                "scenario_id": VALID_SCENARIO_ID,
                "maps_key": _SENTINEL_KEY,
                "start": "San Francisco, CA",
                "end": "Sacramento, CA",
            },
        )
        assert analyze_resp.status_code == 200
        # Key must not appear in the analyze response (it was only in the request)
        assert _SENTINEL_KEY not in analyze_resp.text, (
            "Sentinel key must not appear in /api/routes/analyze response"
        )

        # 3. Take the first returned alternative; call run-plans WITHOUT the key
        alts = analyze_resp.json()["alternatives"]
        assert len(alts) >= 1, "Need at least one alternative"
        chosen = alts[0]

        plan_resp = client.post(
            "/api/run-plans",
            json={
                "package_id": VALID_PACKAGE_ID,
                "scenario_id": VALID_SCENARIO_ID,
                "route_id": chosen["route_id"],
                "route_source": "maps",
                "route_facts": chosen["route_facts"],
                "display_route": chosen["display"],
                "parameters": {},
                "hyperparameters": {},
            },
        )
        assert plan_resp.status_code == 201
        assert _SENTINEL_KEY not in plan_resp.text, (
            "Sentinel key must not appear in /api/run-plans response"
        )
        plan_id = plan_resp.json()["plan_id"]

        # 4. Create run
        run_resp = client.post("/api/runs", json={"plan_id": plan_id})
        assert run_resp.status_code == 201
        assert _SENTINEL_KEY not in run_resp.text, (
            "Sentinel key must not appear in run creation response"
        )
        run_id = run_resp.json()["run_id"]

        # 5. Tick once (key must not appear in tick response)
        tick_resp = client.post(f"/api/runs/{run_id}/tick")
        assert tick_resp.status_code == 200
        assert _SENTINEL_KEY not in tick_resp.text, (
            "Sentinel key must not appear in tick response"
        )

        # 6. GET RunLog — key must not appear anywhere in the persisted evidence
        log_resp = client.get(f"/api/runs/{run_id}/log")
        assert log_resp.status_code == 200
        assert _SENTINEL_KEY not in log_resp.text, (
            "Sentinel key must not appear anywhere in the persisted RunLog"
        )

    def test_maps_selection_uses_provided_route_facts_not_local(self, client):
        """The draft uses maps route_facts (200 km), not local scenario route analysis."""
        plan_resp = client.post(
            "/api/run-plans",
            json={
                "package_id": VALID_PACKAGE_ID,
                "scenario_id": VALID_SCENARIO_ID,
                "route_id": "route-0",
                "route_source": "maps",
                "route_facts": _FAKE_ROUTE_FACTS,
                "display_route": _FAKE_DISPLAY_ROUTE,
                "parameters": {},
                "hyperparameters": {},
            },
        )
        assert plan_resp.status_code == 201

        # Verify a run can start from this draft (200 km maps facts)
        plan_id = plan_resp.json()["plan_id"]
        run_resp = client.post("/api/runs", json={"plan_id": plan_id})
        assert run_resp.status_code == 201
        run_state = run_resp.json()
        # route_facts in RunState must reflect maps distance, not local scenario distance
        rf = run_state.get("route_facts", {})
        assert rf.get("total_route_distance_km") == 200.0


# ── Missing facts validation ───────────────────────────────────────────────────


class TestMissingFactsValidation:
    """Maps route_source requires route_facts; missing → 400."""

    def test_maps_source_without_route_facts_returns_400(self, client):
        """route_source='maps' with no route_facts → 400 (cannot run without facts)."""
        resp = client.post(
            "/api/run-plans",
            json={
                "package_id": VALID_PACKAGE_ID,
                "scenario_id": VALID_SCENARIO_ID,
                "route_id": "route-0",
                "route_source": "maps",
                # route_facts intentionally absent
                "parameters": {},
                "hyperparameters": {},
            },
        )
        assert resp.status_code == 400

    def test_maps_source_without_route_id_returns_400(self, client):
        """route_source='maps' with route_facts but no route_id → 400."""
        resp = client.post(
            "/api/run-plans",
            json={
                "package_id": VALID_PACKAGE_ID,
                "scenario_id": VALID_SCENARIO_ID,
                "route_source": "maps",
                "route_facts": _FAKE_ROUTE_FACTS,
                # route_id intentionally absent
                "parameters": {},
                "hyperparameters": {},
            },
        )
        assert resp.status_code == 400
