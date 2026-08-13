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
import urllib.error
from io import BytesIO

import pytest
from fastapi.testclient import TestClient

import aica_api.services.maps_client as mc
from aica_api.main import app
from aica_api.services.run_manager import clear_registry
from aica_api.services.run_plan import clear_draft_registry

_FIXTURE_DIR = pathlib.Path(__file__).parent / "fixtures" / "maps"

# Feature 009: uc01_fatigue_friend_drive_v0_1 / rest_rule_based_v0_1 are retired.
VALID_SCENARIO_ID = "uc01_fatigue_recovery_v0_1"
VALID_PACKAGE_ID = "aica_transparent_hybrid_trigger_v1"
_SENTINEL_KEY = "SENTINEL_API_KEY_MUST_NOT_LEAK"


def _fixture_bytes(name: str) -> bytes:
    return (_FIXTURE_DIR / name).read_bytes()


def _make_urlopen_seq(responses: list[bytes]):
    """Return a _urlopen mock that pops from a sequence on each call.

    Accepts the v1 POST kwargs (``data``/``headers``) as well as the legacy
    GET-only call shape. Once exhausted, keeps returning the last response
    (sticky tail) rather than raising — the Places v1 strategy issues 2
    (highway) or 3 (urban) HTTP calls per sample point, more than the legacy
    single-Nearby-call-per-point model.
    """
    calls = list(responses)
    state: dict[str, bytes] = {}

    def _mock(url: str, **kwargs) -> bytes:
        if calls:
            state["last"] = calls.pop(0)
        return state["last"]

    return _mock


def _places_v1_http_error(status: str, message: str = "simulated failure", code: int = 500):
    """Build a urllib.error.HTTPError shaped like a Places v1 error response,
    for simulating a places_rest_stops() failure under the v1 API (which
    reports errors via HTTP status, not a 200-body ``status`` field)."""
    body = json.dumps({"error": {"status": status, "message": message}}).encode("utf-8")
    return urllib.error.HTTPError(
        "https://places.googleapis.com/v1/places:searchText", code, status, {}, BytesIO(body)
    )


def _make_urlopen_dir_then_places_fail(dir_data: bytes, status: str = "INTERNAL"):
    """Return a _urlopen mock: directions succeeds (GET, no data kwarg), then
    every subsequent Places v1 call (POST, data kwarg present) raises an
    HTTPError — simulating a places_rest_stops() failure.

    places_rest_stops() propagates the first failing call's MapsError
    immediately, so only one Places call is ever made per route/alternative.
    """
    def _mock(url: str, *, data: bytes | None = None, headers: dict | None = None) -> bytes:
        if data is None:
            return dir_data
        raise _places_v1_http_error(status)

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
        monkeypatch.setattr(
            mc,
            "_urlopen",
            _make_urlopen_seq([dir_data] + [empty_data] * (3 * mc._PLACES_SAMPLE_POINTS)),
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
            assert alt["route_facts"]["rest_spot_positions"] == []

    def test_empty_places_alternative_has_notice(self, client, monkeypatch):
        """When Places returns empty, each alternative must have notices: ['no_rest_stops_found']."""
        dir_data = _fixture_bytes("directions_3_alternatives.json")
        empty_data = _fixture_bytes("places_empty.json")
        monkeypatch.setattr(
            mc,
            "_urlopen",
            _make_urlopen_seq([dir_data] + [empty_data] * (3 * mc._PLACES_SAMPLE_POINTS)),
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
            assert "notices" in alt, f"'notices' key missing from alternative: {alt.keys()}"
            assert "no_rest_stops_found" in alt["notices"], (
                f"Expected 'no_rest_stops_found' in notices, got: {alt['notices']}"
            )

    def test_normal_places_alternative_has_empty_notices(self, client, monkeypatch):
        """When Places succeeds with data, notices must be [] (no warning)."""
        dir_data = _fixture_bytes("directions_3_alternatives.json")
        places_data = _fixture_bytes("places_service_area.json")
        monkeypatch.setattr(
            mc,
            "_urlopen",
            _make_urlopen_seq([dir_data] + [places_data] * (3 * mc._PLACES_SAMPLE_POINTS)),
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
        monkeypatch.setattr(mc, "_urlopen", _make_urlopen_dir_then_places_fail(dir_data))

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
        monkeypatch.setattr(mc, "_urlopen", _make_urlopen_dir_then_places_fail(dir_data))

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
        monkeypatch.setattr(mc, "_urlopen", _make_urlopen_dir_then_places_fail(dir_data))

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
        monkeypatch.setattr(mc, "_urlopen", _make_urlopen_dir_then_places_fail(dir_data))

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
        # uc01_fatigue_recovery_v0_1 has a rest facility (is_rest_facility=True) at 0.5
        dir_data = _fixture_bytes("directions_3_alternatives.json")
        monkeypatch.setattr(mc, "_urlopen", _make_urlopen_dir_then_places_fail(dir_data))

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
        monkeypatch.setattr(mc, "_urlopen", _make_urlopen_dir_then_places_fail(dir_data))

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


# ── End-to-end: UC-01 run with empty rest spots ──────────────────────────────


class TestEndToEndEmptyRestRun:
    """Maps route with empty places → run behaves sanely with rest_spot_positions=[].

    Feature 009 (signal-tier redesign): NO_PRACTICAL_ACTION_FALLBACK was a
    declarative_rule-specific "actionability guard" result — the retired
    algorithm suppressed REST_PROPOSAL entirely when no rest spot was reachable
    and surfaced this fallback result_type instead.  Neither surviving
    python_module package reproduces that guard: aica_transparent_hybrid_trigger_v1's
    rest_scarcity feature score MAXES OUT when nextRestSpotMin never resolves
    (sentinel 9999), which if anything makes rest_required MORE likely to cross
    its threshold, not less; nri_fatigue_score_v1's post-fire filter explicitly
    treats nextRestSpotMin>=9999 ("no more rest spot ahead") as a reason to fire
    rather than suppress.  Regenerated from actual behavior (FR-018): with
    rest_spot_positions=[], REST_PROPOSAL still fires normally, and
    NO_PRACTICAL_ACTION_FALLBACK never appears for these packages.
    """

    def test_empty_rest_run_still_fires_rest_proposal(self, client, monkeypatch, tmp_path):
        """End-to-end: empty places → rest_spot_positions=[] → REST_PROPOSAL still fires,
        with zero algorithm_errors and no NO_PRACTICAL_ACTION_FALLBACK."""
        monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))

        # Analyze: directions succeeds, places returns empty for all alternatives
        dir_data = _fixture_bytes("directions_3_alternatives.json")
        empty_data = _fixture_bytes("places_empty.json")
        monkeypatch.setattr(
            mc,
            "_urlopen",
            _make_urlopen_seq([dir_data] + [empty_data] * (3 * mc._PLACES_SAMPLE_POINTS)),
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
        alts = analyze_resp.json()["alternatives"]
        alt0 = alts[0]

        # Confirm empty rest positions
        assert alt0["route_facts"]["rest_spot_positions"] == []
        assert "no_rest_stops_found" in alt0["notices"]

        # The maps fixture route is short (~150 km / ~90 min): at the current
        # tick_seconds=180 cadence that's only ~30-36 ticks total, which the
        # rest_persistence_ticks=6 gate can't reliably clear before the route
        # completes. Scale up the route length/duration (test-local copy of
        # route_facts; the underlying maps fixture and analyze response are
        # untouched) so the run has enough runway to actually fire
        # REST_PROPOSAL — this test's purpose is proving REST_PROPOSAL still
        # fires with empty rest_spot_positions, which requires ticking through
        # a real fire, not exercising a razor-thin route-length edge case.
        route_facts = dict(alt0["route_facts"])
        route_facts["total_route_distance_km"] = route_facts["total_route_distance_km"] * 3
        route_facts["estimated_route_duration_min"] = (
            route_facts["estimated_route_duration_min"] * 3
        )

        # Create a run plan using the maps route with empty rest spots
        plan_resp = client.post(
            "/api/run-plans",
            json={
                "package_id": VALID_PACKAGE_ID,
                "scenario_id": VALID_SCENARIO_ID,
                "route_id": alt0["route_id"],
                "route_source": "maps",
                "route_facts": route_facts,
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

        # Tick until paused (REST_PROPOSAL) or completed; declining every pause
        # so the run can keep progressing (uc01_fatigue_recovery_v0_1 has
        # recovery_options, so "decline" — not "accept_rest" — resolves a pause
        # without requiring recovery_option_id/rest_spot).
        result_types_seen = set()
        algorithm_errors_seen = []
        for _ in range(400):
            tick_resp = client.post(f"/api/runs/{run_id}/tick")
            assert tick_resp.status_code == 200
            body = tick_resp.json()
            if body.get("decision") is not None:
                result_types_seen.add(body["decision"]["result_type"])
            if body.get("error") is not None:
                algorithm_errors_seen.append(body["error"])
            if body.get("paused"):
                decline_resp = client.post(
                    f"/api/runs/{run_id}/actions", json={"action": "decline"}
                )
                assert decline_resp.status_code == 200
            if body.get("completed"):
                break

        assert algorithm_errors_seen == [], (
            f"Empty rest_spot_positions must never cause an algorithm_error; "
            f"got: {algorithm_errors_seen}"
        )
        # REST_PROPOSAL still fires normally — neither surviving package
        # suppresses it when no rest spot is reachable (see class docstring).
        assert "REST_PROPOSAL" in result_types_seen, (
            f"Expected REST_PROPOSAL to still fire with rest_spot_positions=[]. "
            f"Result types seen: {result_types_seen}"
        )
        # NO_PRACTICAL_ACTION_FALLBACK is a retired declarative_rule-only result
        # type — python_module packages never emit it.
        assert "NO_PRACTICAL_ACTION_FALLBACK" not in result_types_seen
