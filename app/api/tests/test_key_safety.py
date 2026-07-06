"""T011 — Comprehensive key-safety guard.

Drives a FULL mocked-maps flow with a sentinel API key and asserts the key
appears in NONE of:
  - the analyze response body
  - the run-plans response
  - the run creation response
  - each tick response
  - the GET /runs/{id}/log HTTP response body
  - the persisted log file on disk

Two paths are tested:
  (1) Places succeeds with data (normal maps flow)
  (2) Places fails → degraded fallback path (T012)

The key must never surface in any payload, regardless of the code path taken.
"""

from __future__ import annotations

import json
import pathlib

import pytest
from fastapi.testclient import TestClient

import aica_api.services.maps_client as mc
from aica_api.main import app
from aica_api.services.run_manager import clear_registry
from aica_api.services.run_plan import clear_draft_registry

_FIXTURE_DIR = pathlib.Path(__file__).parent / "fixtures" / "maps"

VALID_SCENARIO_ID = "uc01_fatigue_recovery_v0_1"  # feature 009: friend_drive retired
VALID_PACKAGE_ID = "aica_transparent_hybrid_trigger_v1"  # feature 009: rest_rule_based_v0_1 retired
_SENTINEL = "SENTINEL_KEY_DO_NOT_LEAK"


def _fixture_bytes(name: str) -> bytes:
    return (_FIXTURE_DIR / name).read_bytes()


def _make_urlopen_seq(responses: list[bytes]):
    calls = list(responses)

    def _mock(url: str) -> bytes:
        return calls.pop(0)

    return _mock


def _assert_sentinel_absent(text: str, context: str) -> None:
    assert _SENTINEL not in text, (
        f"Sentinel key leaked in {context}! Found in: {text[:200]!r}"
    )


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


class TestComprehensiveKeySafety:
    """End-to-end proof: sentinel API key must never surface in any HTTP payload or disk file."""

    def test_key_absent_full_flow_places_success(self, client, tmp_path, monkeypatch):
        """Full flow (places succeed): sentinel absent from all HTTP responses and disk log."""
        monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))

        dir_data = _fixture_bytes("directions_3_alternatives.json")
        places_data = _fixture_bytes("places_service_area.json")
        monkeypatch.setattr(
            mc,
            "_urlopen",
            _make_urlopen_seq([dir_data] + [places_data] * (3 * mc._PLACES_SAMPLE_POINTS)),
        )

        # 1. Analyze
        analyze_resp = client.post(
            "/api/routes/analyze",
            json={
                "scenario_id": VALID_SCENARIO_ID,
                "maps_key": _SENTINEL,
                "start": "Origin City",
                "end": "Destination City",
            },
        )
        assert analyze_resp.status_code == 200
        _assert_sentinel_absent(analyze_resp.text, "analyze response")

        alt0 = analyze_resp.json()["alternatives"][0]

        # 2. Run-plans (no key)
        plan_resp = client.post(
            "/api/run-plans",
            json={
                "package_id": VALID_PACKAGE_ID,
                "scenario_id": VALID_SCENARIO_ID,
                "route_id": alt0["route_id"],
                "route_source": "maps",
                "route_facts": alt0["route_facts"],
                "display_route": alt0["display"],
                "parameters": {},
                "hyperparameters": {},
            },
        )
        assert plan_resp.status_code == 201
        _assert_sentinel_absent(plan_resp.text, "run-plans response")
        plan_id = plan_resp.json()["plan_id"]

        # 3. Create run
        run_resp = client.post("/api/runs", json={"plan_id": plan_id})
        assert run_resp.status_code == 201
        _assert_sentinel_absent(run_resp.text, "run creation response")
        run_id = run_resp.json()["run_id"]

        # 4. Tick several times
        for i in range(5):
            tick_resp = client.post(f"/api/runs/{run_id}/tick")
            assert tick_resp.status_code == 200
            _assert_sentinel_absent(tick_resp.text, f"tick {i} response")
            if tick_resp.json().get("completed") or tick_resp.json().get("paused"):
                break

        # 5. GET log via HTTP
        log_resp = client.get(f"/api/runs/{run_id}/log")
        assert log_resp.status_code == 200
        _assert_sentinel_absent(log_resp.text, "GET /log HTTP response")

        # 6. Read persisted log from disk
        log_files = list(tmp_path.glob("*.json"))
        assert len(log_files) >= 1, "Expected at least one persisted log file on disk"
        for log_file in log_files:
            content = log_file.read_text(encoding="utf-8")
            _assert_sentinel_absent(content, f"persisted log file {log_file.name}")

    def test_key_absent_full_flow_places_degraded(self, client, tmp_path, monkeypatch):
        """Full flow (places fail → degraded): sentinel absent from all HTTP responses and disk log."""
        monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))

        dir_data = _fixture_bytes("directions_3_alternatives.json")
        fail_data = _fixture_bytes("places_failure.json")
        monkeypatch.setattr(mc, "_urlopen", _make_urlopen_seq([dir_data, fail_data, fail_data, fail_data]))

        # 1. Analyze with degraded Places
        analyze_resp = client.post(
            "/api/routes/analyze",
            json={
                "scenario_id": VALID_SCENARIO_ID,
                "maps_key": _SENTINEL,
                "start": "Origin City",
                "end": "Destination City",
            },
        )
        assert analyze_resp.status_code == 200
        _assert_sentinel_absent(analyze_resp.text, "analyze response (degraded path)")

        alt0 = analyze_resp.json()["alternatives"][0]
        assert "rest_data_degraded" in alt0.get("notices", []), (
            f"Expected degraded path to produce rest_data_degraded notice, got: {alt0}"
        )

        # 2. Run-plans
        plan_resp = client.post(
            "/api/run-plans",
            json={
                "package_id": VALID_PACKAGE_ID,
                "scenario_id": VALID_SCENARIO_ID,
                "route_id": alt0["route_id"],
                "route_source": "maps",
                "route_facts": alt0["route_facts"],
                "display_route": alt0["display"],
                "parameters": {},
                "hyperparameters": {},
            },
        )
        assert plan_resp.status_code == 201
        _assert_sentinel_absent(plan_resp.text, "run-plans response (degraded path)")
        plan_id = plan_resp.json()["plan_id"]

        # 3. Create run
        run_resp = client.post("/api/runs", json={"plan_id": plan_id})
        assert run_resp.status_code == 201
        _assert_sentinel_absent(run_resp.text, "run creation response (degraded path)")
        run_id = run_resp.json()["run_id"]

        # 4. Tick several times
        for i in range(5):
            tick_resp = client.post(f"/api/runs/{run_id}/tick")
            assert tick_resp.status_code == 200
            _assert_sentinel_absent(tick_resp.text, f"tick {i} response (degraded path)")
            if tick_resp.json().get("completed") or tick_resp.json().get("paused"):
                break

        # 5. GET log via HTTP
        log_resp = client.get(f"/api/runs/{run_id}/log")
        assert log_resp.status_code == 200
        _assert_sentinel_absent(log_resp.text, "GET /log HTTP response (degraded path)")

        # 6. Read persisted log from disk
        log_files = list(tmp_path.glob("*.json"))
        assert len(log_files) >= 1
        for log_file in log_files:
            content = log_file.read_text(encoding="utf-8")
            _assert_sentinel_absent(content, f"persisted log file {log_file.name} (degraded path)")

    def test_key_absent_directions_error_502(self, client, monkeypatch):
        """Directions failure: sentinel absent from 502 error response body."""
        fail_data = _fixture_bytes("directions_failure.json")
        monkeypatch.setattr(mc, "_urlopen", lambda url: fail_data)

        resp = client.post(
            "/api/routes/analyze",
            json={
                "scenario_id": VALID_SCENARIO_ID,
                "maps_key": _SENTINEL,
                "start": "A",
                "end": "B",
            },
        )
        assert resp.status_code == 502
        _assert_sentinel_absent(resp.text, "502 error response")

    def test_key_absent_evidence_endpoint_places_success(self, client, tmp_path, monkeypatch):
        """Evidence endpoints: sentinel absent from GET /evidence and GET /evidence.md."""
        monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))

        dir_data = _fixture_bytes("directions_3_alternatives.json")
        places_data = _fixture_bytes("places_service_area.json")
        monkeypatch.setattr(
            mc,
            "_urlopen",
            _make_urlopen_seq([dir_data] + [places_data] * (3 * mc._PLACES_SAMPLE_POINTS)),
        )

        # Full setup: analyze → plan → run → tick
        analyze_resp = client.post(
            "/api/routes/analyze",
            json={
                "scenario_id": VALID_SCENARIO_ID,
                "maps_key": _SENTINEL,
                "start": "Origin City",
                "end": "Destination City",
            },
        )
        assert analyze_resp.status_code == 200
        alt0 = analyze_resp.json()["alternatives"][0]

        plan_resp = client.post(
            "/api/run-plans",
            json={
                "package_id": VALID_PACKAGE_ID,
                "scenario_id": VALID_SCENARIO_ID,
                "route_id": alt0["route_id"],
                "route_source": "maps",
                "route_facts": alt0["route_facts"],
                "display_route": alt0["display"],
                "parameters": {},
                "hyperparameters": {},
            },
        )
        assert plan_resp.status_code == 201
        plan_id = plan_resp.json()["plan_id"]

        run_resp = client.post("/api/runs", json={"plan_id": plan_id})
        assert run_resp.status_code == 201
        run_id = run_resp.json()["run_id"]

        for i in range(5):
            tick_resp = client.post(f"/api/runs/{run_id}/tick")
            assert tick_resp.status_code == 200
            if tick_resp.json().get("completed") or tick_resp.json().get("paused"):
                break

        # GET /evidence (JSON)
        evidence_resp = client.get(f"/api/runs/{run_id}/evidence")
        assert evidence_resp.status_code == 200
        _assert_sentinel_absent(evidence_resp.text, "GET /evidence response")

        # GET /evidence.md
        evidence_md_resp = client.get(f"/api/runs/{run_id}/evidence.md")
        assert evidence_md_resp.status_code == 200
        _assert_sentinel_absent(evidence_md_resp.text, "GET /evidence.md response")

    def test_key_absent_evidence_endpoint_places_degraded(self, client, tmp_path, monkeypatch):
        """Evidence endpoints (degraded): sentinel absent from GET /evidence and GET /evidence.md."""
        monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))

        dir_data = _fixture_bytes("directions_3_alternatives.json")
        fail_data = _fixture_bytes("places_failure.json")
        monkeypatch.setattr(mc, "_urlopen", _make_urlopen_seq([dir_data, fail_data, fail_data, fail_data]))

        analyze_resp = client.post(
            "/api/routes/analyze",
            json={
                "scenario_id": VALID_SCENARIO_ID,
                "maps_key": _SENTINEL,
                "start": "Origin City",
                "end": "Destination City",
            },
        )
        assert analyze_resp.status_code == 200
        alt0 = analyze_resp.json()["alternatives"][0]

        plan_resp = client.post(
            "/api/run-plans",
            json={
                "package_id": VALID_PACKAGE_ID,
                "scenario_id": VALID_SCENARIO_ID,
                "route_id": alt0["route_id"],
                "route_source": "maps",
                "route_facts": alt0["route_facts"],
                "display_route": alt0["display"],
                "parameters": {},
                "hyperparameters": {},
            },
        )
        assert plan_resp.status_code == 201
        plan_id = plan_resp.json()["plan_id"]

        run_resp = client.post("/api/runs", json={"plan_id": plan_id})
        assert run_resp.status_code == 201
        run_id = run_resp.json()["run_id"]

        for i in range(5):
            tick_resp = client.post(f"/api/runs/{run_id}/tick")
            assert tick_resp.status_code == 200
            if tick_resp.json().get("completed") or tick_resp.json().get("paused"):
                break

        # GET /evidence (JSON)
        evidence_resp = client.get(f"/api/runs/{run_id}/evidence")
        assert evidence_resp.status_code == 200
        _assert_sentinel_absent(evidence_resp.text, "GET /evidence response (degraded)")

        # GET /evidence.md
        evidence_md_resp = client.get(f"/api/runs/{run_id}/evidence.md")
        assert evidence_md_resp.status_code == 200
        _assert_sentinel_absent(evidence_md_resp.text, "GET /evidence.md response (degraded)")
