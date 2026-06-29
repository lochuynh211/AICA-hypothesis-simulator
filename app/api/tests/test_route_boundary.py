"""T013 — Two-layer numeric boundary guard.

For a maps-sourced run, asserts that:
  1. The algorithm context carries simulator-owned numeric raw_state fields
     (e.g. nextRestSpotMin) and ordinal feature_groups.
  2. No raw Google payload values (distance_m, duration_s, encoded_polyline,
     distance_along_route_m) appear as keys in raw_state, feature_groups,
     or the decision features dict.

This proves constitution IV: external raw numerics are barred from triggers,
but simulator-owned derived numerics are fine.
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

VALID_SCENARIO_ID = "uc01_fatigue_friend_drive_v0_1"
VALID_PACKAGE_ID = "rest_rule_based_v0_1"
_SENTINEL_KEY = "SENTINEL_API_KEY_MUST_NOT_LEAK"

# Raw Google field names that must NEVER cross the boundary into algorithm context
_RAW_GOOGLE_KEYS = frozenset(
    {"distance_m", "duration_s", "encoded_polyline", "distance_along_route_m"}
)

# Simulator-owned fields that MUST be present in raw_state
_EXPECTED_RAW_STATE_KEYS = {"nextRestSpotMin", "drowsinessLevel", "fatigueLevel"}

# Ordinal fields that MUST be present in feature_groups.ordinal
_EXPECTED_ORDINAL_KEYS = {"rest_spot_eta", "drowsiness_level", "fatigue_level"}


def _fixture_bytes(name: str) -> bytes:
    return (_FIXTURE_DIR / name).read_bytes()


def _make_urlopen_seq(responses: list[bytes]):
    calls = list(responses)

    def _mock(url: str) -> bytes:
        return calls.pop(0)

    return _mock


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


def _run_maps_and_get_log(client, tmp_path, monkeypatch, n_ticks: int = 5) -> dict:
    """Helper: run a maps-sourced flow and return the full log dict."""
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))

    dir_data = _fixture_bytes("directions_3_alternatives.json")
    places_data = _fixture_bytes("places_service_area.json")
    # 1 directions + 3 alts × mc._PLACES_SAMPLE_POINTS places calls
    monkeypatch.setattr(
        mc,
        "_urlopen",
        _make_urlopen_seq(
            [dir_data] + [places_data] * (3 * mc._PLACES_SAMPLE_POINTS)
        ),
    )

    analyze_resp = client.post(
        "/api/routes/analyze",
        json={
            "scenario_id": VALID_SCENARIO_ID,
            "maps_key": _SENTINEL_KEY,
            "start": "A",
            "end": "B",
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

    for _ in range(n_ticks):
        tick_resp = client.post(f"/api/runs/{run_id}/tick")
        assert tick_resp.status_code == 200
        if tick_resp.json().get("completed") or tick_resp.json().get("paused"):
            break

    log_resp = client.get(f"/api/runs/{run_id}/log")
    assert log_resp.status_code == 200
    return log_resp.json()


class TestTwoLayerBoundary:
    """Assert that only simulator-owned numerics (and ordinal bands) cross the algorithm boundary."""

    def test_raw_state_contains_simulator_owned_fields(self, client, tmp_path, monkeypatch):
        """raw_state in tick events must have simulator-owned numeric fields."""
        log = _run_maps_and_get_log(client, tmp_path, monkeypatch)
        tick_events = [e for e in log["events"] if e["kind"] == "tick"]
        assert len(tick_events) >= 1, "Need at least one tick event"

        for ev in tick_events:
            raw_state = ev.get("raw_state", {})
            for key in _EXPECTED_RAW_STATE_KEYS:
                assert key in raw_state, (
                    f"Simulator-owned raw_state field '{key}' missing from tick {ev['tick_index']}: "
                    f"raw_state keys = {list(raw_state.keys())}"
                )

    def test_feature_groups_ordinal_contains_expected_fields(self, client, tmp_path, monkeypatch):
        """feature_groups.ordinal in tick events must have the expected ordinal band fields."""
        log = _run_maps_and_get_log(client, tmp_path, monkeypatch)
        tick_events = [e for e in log["events"] if e["kind"] == "tick"]
        assert len(tick_events) >= 1

        for ev in tick_events:
            fg = ev.get("feature_groups", {})
            ordinal = fg.get("ordinal", {})
            for key in _EXPECTED_ORDINAL_KEYS:
                assert key in ordinal, (
                    f"Expected ordinal field '{key}' missing from tick {ev['tick_index']}: "
                    f"ordinal keys = {list(ordinal.keys())}"
                )

    def test_raw_state_has_no_raw_google_keys(self, client, tmp_path, monkeypatch):
        """raw_state must NOT contain any raw Google API field names."""
        log = _run_maps_and_get_log(client, tmp_path, monkeypatch)
        tick_events = [e for e in log["events"] if e["kind"] == "tick"]
        assert len(tick_events) >= 1

        for ev in tick_events:
            raw_state = ev.get("raw_state", {})
            leaked = _RAW_GOOGLE_KEYS & set(raw_state.keys())
            assert not leaked, (
                f"Raw Google field(s) {leaked} found in raw_state at tick {ev['tick_index']}! "
                f"Only simulator-owned numerics should cross the boundary."
            )

    def test_feature_groups_has_no_raw_google_keys(self, client, tmp_path, monkeypatch):
        """feature_groups must NOT contain any raw Google API field names at any level."""
        log = _run_maps_and_get_log(client, tmp_path, monkeypatch)
        tick_events = [e for e in log["events"] if e["kind"] == "tick"]
        assert len(tick_events) >= 1

        for ev in tick_events:
            fg_str = json.dumps(ev.get("feature_groups", {}))
            for bad_key in _RAW_GOOGLE_KEYS:
                assert f'"{bad_key}"' not in fg_str, (
                    f"Raw Google key '{bad_key}' found in feature_groups at tick {ev['tick_index']}!"
                )

    def test_decision_features_are_ordinal_strings_only(self, client, tmp_path, monkeypatch):
        """Decision features dict must contain only string ordinal values (no raw numerics)."""
        log = _run_maps_and_get_log(client, tmp_path, monkeypatch)
        tick_events = [e for e in log["events"] if e["kind"] == "tick"]
        assert len(tick_events) >= 1

        for ev in tick_events:
            trace = ev.get("trace", {})
            decision = trace.get("decision_result", {})
            features = decision.get("features", {})
            for key, val in features.items():
                assert isinstance(val, str), (
                    f"Decision features must be ordinal strings; "
                    f"found non-string value for '{key}': {val!r} at tick {ev['tick_index']}"
                )
                # No raw Google key names should appear as feature keys
                assert key not in _RAW_GOOGLE_KEYS, (
                    f"Raw Google key '{key}' found in decision features at tick {ev['tick_index']}!"
                )

    def test_run_log_route_facts_has_no_raw_google_keys(self, client, tmp_path, monkeypatch):
        """RunLog route_facts must NOT contain raw Google API field names."""
        log = _run_maps_and_get_log(client, tmp_path, monkeypatch)
        route_facts = log.get("route_facts", {})
        route_facts_str = json.dumps(route_facts)

        for bad_key in _RAW_GOOGLE_KEYS:
            assert f'"{bad_key}"' not in route_facts_str, (
                f"Raw Google key '{bad_key}' found in RunLog.route_facts! "
                f"route_facts = {route_facts}"
            )

    def test_run_log_route_facts_has_simulator_owned_fields(self, client, tmp_path, monkeypatch):
        """RunLog route_facts must carry simulator-computed fields (not raw Google values)."""
        log = _run_maps_and_get_log(client, tmp_path, monkeypatch)
        rf = log.get("route_facts", {})

        assert "total_route_distance_km" in rf, "route_facts should have total_route_distance_km"
        assert "rest_spot_positions" in rf, "route_facts should have rest_spot_positions"
        assert "route_source" in rf, "route_facts should have route_source"
        assert rf.get("route_source") == "maps", f"Expected route_source='maps', got {rf.get('route_source')}"

    def test_display_route_polyline_not_in_route_facts(self, client, tmp_path, monkeypatch):
        """encoded_polyline lives only in display_route, never bleeds into route_facts."""
        log = _run_maps_and_get_log(client, tmp_path, monkeypatch)
        rf_str = json.dumps(log.get("route_facts", {}))
        assert "encoded_polyline" not in rf_str, (
            "encoded_polyline must not appear in route_facts; it belongs only in display_route"
        )
