"""Tests for T012 — rest empty-vs-failure handling + notices.

Two cases:
  (a) Places succeeds but returns EMPTY → rest_spot_positions=[] + notice "no_rest_stops_found"
  (b) Places FAILS (MapsError) → scaled scenario fallback + notice "rest_data_degraded"

End-to-end: UC-01 run over a maps-sourced route with empty rest spots eventually
produces NO_PRACTICAL_ACTION_FALLBACK (no pause, drive continues).

Directions failure is unchanged: still returns 502.
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


# ── Case (a): Places succeeds but EMPTY ──────────────────────────────────────


class TestPlacesEmpty:
    """Places returns [] (ZERO_RESULTS) → honest empty + notice."""

    def test_empty_places_alternative_has_no_rest_positions(self, client, monkeypatch):
        """When Places returns empty, rest_spot_positions must be []."""
        dir_data = _fixture_bytes("directions_3_alternatives.json")
        empty_data = _fixture_bytes("places_empty.json")
        monkeypatch.setattr(mc, "_urlopen", _make_urlopen_seq([dir_data, empty_data, empty_data, empty_data]))

        resp = client.post(
            "/api/routes/analyze",
            json={
                "scenario_id": VALID_SCENARIO_ID,
                "maps_key": _SENTINEL_KEY,
                "start": "A",
                "end": "B",
            },
        )
        assert resp.status_code == 200
        for alt in resp.json()["alternatives"]:
            assert alt["route_facts"]["rest_spot_positions"] == []

    def test_empty_places_alternative_has_notice(self, client, monkeypatch):
        """When Places returns empty, each alternative must have notices: ['no_rest_stops_found']."""
        dir_data = _fixture_bytes("directions_3_alternatives.json")
        empty_data = _fixture_bytes("places_empty.json")
        monkeypatch.setattr(mc, "_urlopen", _make_urlopen_seq([dir_data, empty_data, empty_data, empty_data]))

        resp = client.post(
            "/api/routes/analyze",
            json={
                "scenario_id": VALID_SCENARIO_ID,
                "maps_key": _SENTINEL_KEY,
                "start": "A",
                "end": "B",
            },
        )
        assert resp.status_code == 200
        for alt in resp.json()["alternatives"]:
            assert "notices" in alt, f"'notices' key missing from alternative: {alt.keys()}"
            assert "no_rest_stops_found" in alt["notices"], (
                f"Expected 'no_rest_stops_found' in notices, got: {alt['notices']}"
            )

    def test_normal_places_alternative_has_empty_notices(self, client, monkeypatch):
        """When Places succeeds with data, notices must be [] (no warning)."""
        dir_data = _fixture_bytes("directions_3_alternatives.json")
        places_data = _fixture_bytes("places_service_area.json")
        monkeypatch.setattr(mc, "_urlopen", _make_urlopen_seq([dir_data, places_data, places_data, places_data]))

        resp = client.post(
            "/api/routes/analyze",
            json={
                "scenario_id": VALID_SCENARIO_ID,
                "maps_key": _SENTINEL_KEY,
                "start": "A",
                "end": "B",
            },
        )
        assert resp.status_code == 200
        for alt in resp.json()["alternatives"]:
            assert "notices" in alt
            assert alt["notices"] == [], f"Expected empty notices for success path, got: {alt['notices']}"

    def test_local_path_has_empty_notices(self, client):
        """Local path (no maps_key) must also return notices: [] on alternatives."""
        resp = client.post(
            "/api/routes/analyze",
            json={"scenario_id": VALID_SCENARIO_ID},
        )
        assert resp.status_code == 200
        for alt in resp.json()["alternatives"]:
            assert "notices" in alt
            assert alt["notices"] == []


# ── Case (b): Places FAILS (MapsError) ───────────────────────────────────────


class TestPlacesFailure:
    """Places raises MapsError → scenario-scaled fallback + rest_data_degraded notice."""

    def test_places_failure_alternative_has_degraded_notice(self, client, monkeypatch):
        """When places_rest_stops raises, alternative must have notices: ['rest_data_degraded']."""
        dir_data = _fixture_bytes("directions_3_alternatives.json")
        fail_data = _fixture_bytes("places_failure.json")
        monkeypatch.setattr(mc, "_urlopen", _make_urlopen_seq([dir_data, fail_data, fail_data, fail_data]))

        resp = client.post(
            "/api/routes/analyze",
            json={
                "scenario_id": VALID_SCENARIO_ID,
                "maps_key": _SENTINEL_KEY,
                "start": "A",
                "end": "B",
            },
        )
        assert resp.status_code == 200
        for alt in resp.json()["alternatives"]:
            assert "notices" in alt
            assert "rest_data_degraded" in alt["notices"], (
                f"Expected 'rest_data_degraded' in notices, got: {alt['notices']}"
            )

    def test_places_failure_alternative_has_nonempty_rest_positions(self, client, monkeypatch):
        """When places fails, rest_spot_positions must be non-empty (scenario fallback)."""
        dir_data = _fixture_bytes("directions_3_alternatives.json")
        fail_data = _fixture_bytes("places_failure.json")
        monkeypatch.setattr(mc, "_urlopen", _make_urlopen_seq([dir_data, fail_data, fail_data, fail_data]))

        resp = client.post(
            "/api/routes/analyze",
            json={
                "scenario_id": VALID_SCENARIO_ID,
                "maps_key": _SENTINEL_KEY,
                "start": "A",
                "end": "B",
            },
        )
        assert resp.status_code == 200
        for alt in resp.json()["alternatives"]:
            positions = alt["route_facts"]["rest_spot_positions"]
            assert isinstance(positions, list)
            assert len(positions) > 0, (
                f"Expected non-empty rest_spot_positions after Places failure (scenario fallback), "
                f"got: {positions}"
            )

    def test_places_failure_analyze_still_succeeds_200(self, client, monkeypatch):
        """Places failure must NOT fail the analyze (200, not 502)."""
        dir_data = _fixture_bytes("directions_3_alternatives.json")
        fail_data = _fixture_bytes("places_failure.json")
        monkeypatch.setattr(mc, "_urlopen", _make_urlopen_seq([dir_data, fail_data, fail_data, fail_data]))

        resp = client.post(
            "/api/routes/analyze",
            json={
                "scenario_id": VALID_SCENARIO_ID,
                "maps_key": _SENTINEL_KEY,
                "start": "A",
                "end": "B",
            },
        )
        assert resp.status_code == 200, f"Expected 200 on Places failure, got {resp.status_code}"

    def test_places_failure_rest_positions_are_scaled_fractions_of_maps_distance(self, client, monkeypatch):
        """Fallback rest positions must be fractions of the Maps route distance, not local distance."""
        dir_data = _fixture_bytes("directions_3_alternatives.json")
        fail_data = _fixture_bytes("places_failure.json")
        monkeypatch.setattr(mc, "_urlopen", _make_urlopen_seq([dir_data, fail_data, fail_data, fail_data]))

        resp = client.post(
            "/api/routes/analyze",
            json={
                "scenario_id": VALID_SCENARIO_ID,
                "maps_key": _SENTINEL_KEY,
                "start": "A",
                "end": "B",
            },
        )
        assert resp.status_code == 200
        # directions_3_alternatives.json has distance_value=150000m → 150km
        for alt in resp.json()["alternatives"]:
            maps_total_km = alt["route_facts"]["total_route_distance_km"]
            for pos_km in alt["route_facts"]["rest_spot_positions"]:
                assert 0 < pos_km < maps_total_km, (
                    f"Fallback rest position {pos_km}km should be within Maps route "
                    f"({maps_total_km}km), not the local scenario distance"
                )


# ── Fix 2: correct notice when Places fails — degraded vs unavailable ─────────


class TestPlacesFailureFallbackNotice:
    """Fix 2: when Places fails, the notice depends on whether a local fallback exists.

    Notice string set: {no_rest_stops_found, rest_data_degraded, rest_data_unavailable}.

    Sub-case A — scenario HAS a local rest pattern (is_rest_facility=True segment exists):
      → fallback is non-empty → notice = "rest_data_degraded".
    Sub-case B — scenario has NO local rest pattern (no is_rest_facility segments):
      → fallback is [] → notice = "rest_data_unavailable" (honest absence, not false claim).
    """

    def test_places_failure_with_local_rest_pattern_has_degraded_notice_and_nonempty_positions(
        self, client, monkeypatch
    ):
        """Sub-case A: Places fails + scenario HAS local rest → degraded + non-empty positions."""
        # uc01_fatigue_friend_drive_v0_1 has a rest facility (is_rest_facility=True) at 0.5
        dir_data = _fixture_bytes("directions_3_alternatives.json")
        fail_data = _fixture_bytes("places_failure.json")
        monkeypatch.setattr(
            mc, "_urlopen",
            _make_urlopen_seq([dir_data, fail_data, fail_data, fail_data]),
        )

        resp = client.post(
            "/api/routes/analyze",
            json={
                "scenario_id": VALID_SCENARIO_ID,
                "maps_key": _SENTINEL_KEY,
                "start": "A",
                "end": "B",
            },
        )
        assert resp.status_code == 200
        for alt in resp.json()["alternatives"]:
            assert "rest_data_degraded" in alt["notices"], (
                f"Expected 'rest_data_degraded' when scenario has local rest pattern; "
                f"got notices: {alt['notices']}"
            )
            assert "rest_data_unavailable" not in alt["notices"]
            positions = alt["route_facts"]["rest_spot_positions"]
            assert len(positions) > 0, (
                f"Expected non-empty rest positions when scenario has local rest pattern; "
                f"got: {positions}"
            )

    def test_places_failure_without_local_rest_pattern_has_unavailable_notice_and_empty_positions(
        self, client, monkeypatch
    ):
        """Sub-case B: Places fails + scenario has NO local rest → unavailable + empty positions.

        Monkeypatches _scale_scenario_rest_positions (in the routes module) to return []
        to simulate a scenario whose route_intent has no is_rest_facility segments.
        """
        import aica_api.routers.routes as routes_mod

        # Simulate a scenario with no local rest positions
        monkeypatch.setattr(routes_mod, "_scale_scenario_rest_positions", lambda *args: [])

        dir_data = _fixture_bytes("directions_3_alternatives.json")
        fail_data = _fixture_bytes("places_failure.json")
        monkeypatch.setattr(
            mc, "_urlopen",
            _make_urlopen_seq([dir_data, fail_data, fail_data, fail_data]),
        )

        resp = client.post(
            "/api/routes/analyze",
            json={
                "scenario_id": VALID_SCENARIO_ID,
                "maps_key": _SENTINEL_KEY,
                "start": "A",
                "end": "B",
            },
        )
        assert resp.status_code == 200
        for alt in resp.json()["alternatives"]:
            assert "rest_data_unavailable" in alt["notices"], (
                f"Expected 'rest_data_unavailable' when scenario has no local rest pattern; "
                f"got notices: {alt['notices']}"
            )
            assert "rest_data_degraded" not in alt["notices"], (
                "Must NOT claim 'rest_data_degraded' when fallback is empty (false claim of "
                "present-but-degraded data); got notices: {alt['notices']}"
            )
            assert alt["route_facts"]["rest_spot_positions"] == [], (
                f"Expected empty rest positions when scenario has no local rest pattern; "
                f"got: {alt['route_facts']['rest_spot_positions']}"
            )


# ── Directions failure still 502 ──────────────────────────────────────────────


class TestDirectionsFailureUnchanged:
    """Directions MapsError → hard 502 (unchanged from U4)."""

    def test_directions_failure_still_502(self, client, monkeypatch):
        fail_data = _fixture_bytes("directions_failure.json")
        monkeypatch.setattr(mc, "_urlopen", lambda url: fail_data)

        resp = client.post(
            "/api/routes/analyze",
            json={
                "scenario_id": VALID_SCENARIO_ID,
                "maps_key": _SENTINEL_KEY,
                "start": "A",
                "end": "B",
            },
        )
        assert resp.status_code == 502


# ── End-to-end: UC-01 run with empty rest → NO_PRACTICAL_ACTION_FALLBACK ─────


class TestEndToEndEmptyRestRun:
    """Maps route with empty places → run eventually produces NO_PRACTICAL_ACTION_FALLBACK."""

    def test_empty_rest_run_produces_no_practical_action_fallback(self, client, monkeypatch, tmp_path):
        """End-to-end: empty places → rest_spot_positions=[] → eventually NO_PRACTICAL_ACTION_FALLBACK."""
        monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))

        # Analyze: directions succeeds, places returns empty for all alternatives
        dir_data = _fixture_bytes("directions_3_alternatives.json")
        empty_data = _fixture_bytes("places_empty.json")
        monkeypatch.setattr(mc, "_urlopen", _make_urlopen_seq([dir_data, empty_data, empty_data, empty_data]))

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
        alts = analyze_resp.json()["alternatives"]
        alt0 = alts[0]

        # Confirm empty rest positions
        assert alt0["route_facts"]["rest_spot_positions"] == []
        assert "no_rest_stops_found" in alt0["notices"]

        # Create a run plan using the maps route with empty rest spots
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

        # Tick until we see NO_PRACTICAL_ACTION_FALLBACK or exhaust ticks
        result_types_seen = set()
        for _ in range(400):
            tick_resp = client.post(f"/api/runs/{run_id}/tick")
            assert tick_resp.status_code == 200
            body = tick_resp.json()
            if body.get("decision") is not None:
                result_types_seen.add(body["decision"]["result_type"])
            if body.get("completed"):
                break

        assert "NO_PRACTICAL_ACTION_FALLBACK" in result_types_seen, (
            f"Expected NO_PRACTICAL_ACTION_FALLBACK in a run with empty rest spots. "
            f"Result types seen: {result_types_seen}"
        )
        # Must NOT have paused (no REST_PROPOSAL with empty rest spots)
        assert "REST_PROPOSAL" not in result_types_seen, (
            "REST_PROPOSAL should not fire when rest_spot_positions=[] (rest_spot_eta='none')"
        )
