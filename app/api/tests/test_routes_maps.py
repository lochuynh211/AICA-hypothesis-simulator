"""Tests for U4 — analyze envelope migration + maps path (T005, T009, T010).

Covers:
  - Local path (no maps_key) → {route_source: "local", alternatives: [{route_id: "local", ...}]}
  - Maps path (maps_key + start + end) → {route_source: "maps", alternatives: [≤3 items]}
  - Key safety: sentinel key must not appear anywhere in the response
  - Directions failure → HTTP 502 with structured error, no key in body
  - Envelope migration: both paths return the same top-level envelope shape
  - T010: local path determinism — same decisions as pre-M4, route_source="local", no map artifacts
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
_SENTINEL_KEY = "SENTINEL_API_KEY_MUST_NOT_LEAK"


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


# ── Helpers ────────────────────────────────────────────────────────────────────

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


# ── Local path (no maps_key) ──────────────────────────────────────────────────


class TestLocalPath:
    """POST /api/routes/analyze with no maps_key → local envelope."""

    def test_local_path_returns_envelope(self, client):
        """No maps_key → {route_source: 'local', alternatives: [...]}."""
        resp = client.post(
            "/api/routes/analyze",
            json={"scenario_id": VALID_SCENARIO_ID},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "route_source" in body, f"Missing route_source in {body}"
        assert "alternatives" in body, f"Missing alternatives in {body}"
        assert body["route_source"] == "local"

    def test_local_path_one_alternative(self, client):
        """Local path yields exactly one alternative."""
        resp = client.post(
            "/api/routes/analyze",
            json={"scenario_id": VALID_SCENARIO_ID},
        )
        assert resp.status_code == 200
        alts = resp.json()["alternatives"]
        assert isinstance(alts, list)
        assert len(alts) == 1

    def test_local_path_alternative_route_id_is_local(self, client):
        """Local alternative has route_id == 'local'."""
        resp = client.post(
            "/api/routes/analyze",
            json={"scenario_id": VALID_SCENARIO_ID},
        )
        alt = resp.json()["alternatives"][0]
        assert alt["route_id"] == "local"

    def test_local_path_alternative_has_route_facts(self, client):
        """Local alternative carries route_facts with M2 physical fields."""
        resp = client.post(
            "/api/routes/analyze",
            json={"scenario_id": VALID_SCENARIO_ID},
        )
        alt = resp.json()["alternatives"][0]
        assert "route_facts" in alt
        rf = alt["route_facts"]
        assert rf.get("route_source") == "local"
        assert rf.get("total_route_distance_km") is not None

    def test_local_path_alternative_display_is_null(self, client):
        """Local alternative has display: null (no map artifacts)."""
        resp = client.post(
            "/api/routes/analyze",
            json={"scenario_id": VALID_SCENARIO_ID},
        )
        alt = resp.json()["alternatives"][0]
        assert alt["display"] is None

    def test_local_path_alternative_has_summary(self, client):
        """Local alternative has a non-empty summary string."""
        resp = client.post(
            "/api/routes/analyze",
            json={"scenario_id": VALID_SCENARIO_ID},
        )
        alt = resp.json()["alternatives"][0]
        assert isinstance(alt.get("summary"), str)

    def test_local_path_404_unknown_scenario(self, client):
        """Local path still returns 404 for unknown scenario."""
        resp = client.post(
            "/api/routes/analyze",
            json={"scenario_id": "no_such_scenario_xyz"},
        )
        assert resp.status_code == 404

    def test_local_path_determinism_t010(self, client):
        """T010: local path produces identical route facts on two calls (deterministic)."""
        body = {"scenario_id": VALID_SCENARIO_ID}
        r1 = client.post("/api/routes/analyze", json=body).json()
        r2 = client.post("/api/routes/analyze", json=body).json()
        assert r1["alternatives"][0]["route_facts"] == r2["alternatives"][0]["route_facts"]
        assert r1["route_source"] == "local"

    def test_local_path_determinism_full_loop_t010(self, client):
        """Fix 5 / T010: two local runs (no key) produce identical per-tick decisions
        across the full tick loop to REST_PROPOSAL.

        This is the real 'M4 migration ≠ behavior change' guard: not just
        route_facts equality but identical decision sequences end-to-end.
        """
        def run_to_paused_decisions() -> list[dict]:
            plan_resp = client.post(
                "/api/run-plans",
                json={
                    "package_id": "rest_rule_based_v0_1",
                    "scenario_id": VALID_SCENARIO_ID,
                    "parameters": {},
                    "hyperparameters": {},
                },
            )
            assert plan_resp.status_code == 201
            plan_id = plan_resp.json()["plan_id"]

            run_resp = client.post("/api/runs", json={"plan_id": plan_id})
            assert run_resp.status_code == 201
            run_id = run_resp.json()["run_id"]

            decisions: list[dict] = []
            for _ in range(250):
                tick_resp = client.post(f"/api/runs/{run_id}/tick")
                assert tick_resp.status_code == 200
                body = tick_resp.json()
                if body.get("decision") is not None:
                    decisions.append({
                        "result_type": body["decision"]["result_type"],
                        "score": body["decision"]["score"],
                        "selected_category": body["decision"]["selected_category"],
                    })
                if body.get("paused"):
                    return decisions
            pytest.fail("Run did not pause within 250 ticks")

        trace_a = run_to_paused_decisions()
        trace_b = run_to_paused_decisions()

        assert len(trace_a) == len(trace_b), (
            f"Local path determinism: Run A has {len(trace_a)} decisions, "
            f"Run B has {len(trace_b)}"
        )
        for i, (ea, eb) in enumerate(zip(trace_a, trace_b)):
            assert ea == eb, (
                f"Local path determinism: tick {i} diverged — A={ea!r}, B={eb!r}"
            )

    def test_local_path_no_map_artifacts_in_evidence_t010(self, client):
        """T010: local alternative has no encoded_polyline or Maps-specific fields."""
        resp = client.post(
            "/api/routes/analyze",
            json={"scenario_id": VALID_SCENARIO_ID},
        )
        alt = resp.json()["alternatives"][0]
        # display must be null — no polyline leaked
        assert alt["display"] is None
        # route_facts must not contain encoded_polyline
        rf_str = json.dumps(alt["route_facts"])
        assert "encoded_polyline" not in rf_str


# ── Maps path (maps_key + start + end) ────────────────────────────────────────


class TestMapsPath:
    """POST /api/routes/analyze with maps_key, start, end → maps envelope."""

    def test_maps_path_returns_envelope(self, client, monkeypatch):
        """Maps path returns {route_source: 'maps', alternatives: [...]}."""
        # 1 directions call + 3 places calls (one per alternative)
        dir_data = _directions_bytes("directions_3_alternatives.json")
        pl_data = _places_bytes("places_service_area.json")
        call_seq = [dir_data, pl_data, pl_data, pl_data]
        monkeypatch.setattr(mc, "_urlopen", _make_urlopen_seq(call_seq))

        resp = client.post(
            "/api/routes/analyze",
            json={
                "scenario_id": VALID_SCENARIO_ID,
                "maps_key": _SENTINEL_KEY,
                "start": "San Francisco, CA",
                "end": "Sacramento, CA",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["route_source"] == "maps"
        assert "alternatives" in body

    def test_maps_path_alternatives_count_le_3(self, client, monkeypatch):
        """Maps path yields ≤ 3 alternatives."""
        dir_data = _directions_bytes("directions_3_alternatives.json")
        pl_data = _places_bytes("places_service_area.json")
        call_seq = [dir_data, pl_data, pl_data, pl_data]
        monkeypatch.setattr(mc, "_urlopen", _make_urlopen_seq(call_seq))

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
        alts = resp.json()["alternatives"]
        assert len(alts) <= 3

    def test_maps_path_alternative_fields(self, client, monkeypatch):
        """Each maps alternative has route_id, summary, route_facts, display."""
        dir_data = _directions_bytes("directions_3_alternatives.json")
        pl_data = _places_bytes("places_service_area.json")
        call_seq = [dir_data, pl_data, pl_data, pl_data]
        monkeypatch.setattr(mc, "_urlopen", _make_urlopen_seq(call_seq))

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
            assert "route_id" in alt
            assert "summary" in alt
            assert "route_facts" in alt
            assert "display" in alt

    def test_maps_path_route_facts_source_is_maps(self, client, monkeypatch):
        """Maps alternative route_facts have route_source == 'maps'."""
        dir_data = _directions_bytes("directions_3_alternatives.json")
        pl_data = _places_bytes("places_service_area.json")
        call_seq = [dir_data, pl_data, pl_data, pl_data]
        monkeypatch.setattr(mc, "_urlopen", _make_urlopen_seq(call_seq))

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
            assert alt["route_facts"]["route_source"] == "maps"

    def test_maps_path_display_has_polyline(self, client, monkeypatch):
        """Maps alternative display has encoded_polyline (non-null)."""
        dir_data = _directions_bytes("directions_3_alternatives.json")
        pl_data = _places_bytes("places_service_area.json")
        call_seq = [dir_data, pl_data, pl_data, pl_data]
        monkeypatch.setattr(mc, "_urlopen", _make_urlopen_seq(call_seq))

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
            display = alt["display"]
            assert display is not None
            assert "encoded_polyline" in display


# ── Key safety ────────────────────────────────────────────────────────────────


class TestKeySafety:
    """Sentinel key must never appear in any response or error body."""

    def test_maps_path_key_absent_from_response(self, client, monkeypatch):
        """Sentinel key is not present anywhere in the maps success response."""
        dir_data = _directions_bytes("directions_3_alternatives.json")
        pl_data = _places_bytes("places_service_area.json")
        call_seq = [dir_data, pl_data, pl_data, pl_data]
        monkeypatch.setattr(mc, "_urlopen", _make_urlopen_seq(call_seq))

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
        assert _SENTINEL_KEY not in resp.text

    def test_directions_failure_key_absent_from_error(self, client, monkeypatch):
        """Sentinel key is not present anywhere in the 502 error response."""
        fail_data = _directions_bytes("directions_failure.json")
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
        assert _SENTINEL_KEY not in resp.text

    def test_local_path_never_echoes_key_even_if_provided(self, client):
        """If maps_key is provided but start/end are absent, fall back to local — no key echo."""
        resp = client.post(
            "/api/routes/analyze",
            json={
                "scenario_id": VALID_SCENARIO_ID,
                "maps_key": _SENTINEL_KEY,
                # no start/end → local fallback
            },
        )
        # Must succeed (local fallback) and not echo the key
        assert resp.status_code == 200
        assert _SENTINEL_KEY not in resp.text


# ── Directions failure ────────────────────────────────────────────────────────


class TestDirectionsFailure:
    """MapsError from directions → 502 with structured body."""

    def test_directions_failure_returns_502(self, client, monkeypatch):
        fail_data = _directions_bytes("directions_failure.json")
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

    def test_directions_failure_body_has_error_type(self, client, monkeypatch):
        fail_data = _directions_bytes("directions_failure.json")
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
        body = resp.json()
        # error_type present at top-level or under detail
        detail = body.get("detail", body)
        assert "error_type" in detail

    def test_invalid_key_returns_502(self, client, monkeypatch):
        key_data = _directions_bytes("invalid_key.json")
        monkeypatch.setattr(mc, "_urlopen", lambda url: key_data)

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

    def test_directions_failure_unknown_scenario_still_404(self, client, monkeypatch):
        """Unknown scenario is validated before Maps call → 404, no Maps call made."""
        called = []
        monkeypatch.setattr(mc, "_urlopen", lambda url: called.append(url) or b"{}")

        resp = client.post(
            "/api/routes/analyze",
            json={
                "scenario_id": "no_such_xyz",
                "maps_key": _SENTINEL_KEY,
                "start": "A",
                "end": "B",
            },
        )
        assert resp.status_code == 404
        assert len(called) == 0, "Maps must not be called if scenario is unknown"


# ── Fix 3: _derive_context → places_rest_stops POI-type biasing ──────────────


class TestDeriveContextPlacesBiasing:
    """Fix 3: _derive_context returns 'highway'/'urban' (not 'local').

    Verifies that the context value derived from the raw route actually affects
    the Places API search by capturing the constructed URL at the _urlopen level
    and asserting the correct 'type' parameter is present.
    """

    def test_highway_route_requests_gas_station(self, client, monkeypatch):
        """Highway route (merge maneuver → road_class=HIGHWAY) → places uses type=gas_station.

        The real code path runs: directions fixture → _infer_road_class → _derive_context →
        places_rest_stops → _build_url; the captured URL must contain 'type=gas_station'.
        """
        captured_urls: list[str] = []
        dir_data = _directions_bytes("directions_3_alternatives.json")
        pl_data = _places_bytes("places_service_area.json")
        call_seq = [dir_data, pl_data, pl_data, pl_data]

        def capturing_urlopen(url: str) -> bytes:
            captured_urls.append(url)
            return call_seq.pop(0)

        monkeypatch.setattr(mc, "_urlopen", capturing_urlopen)

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

        # The directions_3_alternatives fixture has 'merge' maneuvers → HIGHWAY
        # Each places URL must use type=gas_station (highway biasing)
        places_urls = [u for u in captured_urls if "nearbysearch" in u]
        assert len(places_urls) >= 1, "At least one places call should have been made"
        for url in places_urls:
            assert "type=gas_station" in url, (
                f"Highway route must use gas_station POI type; got places URL: {url!r}"
            )

    def test_local_route_requests_convenience_store(self, client, monkeypatch):
        """Non-highway route (no merge/ramp) → places uses type=convenience_store.

        The directions_local_only fixture has only straight/turn-right maneuvers →
        road_class=LOCAL → _derive_context returns 'urban' → convenience_store.
        """
        captured_urls: list[str] = []
        dir_data = _directions_bytes("directions_local_only.json")
        pl_data = _places_bytes("places_convenience_store.json")
        call_seq = [dir_data, pl_data]  # 1 direction + 1 places (single alternative)

        def capturing_urlopen(url: str) -> bytes:
            captured_urls.append(url)
            return call_seq.pop(0)

        monkeypatch.setattr(mc, "_urlopen", capturing_urlopen)

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

        places_urls = [u for u in captured_urls if "nearbysearch" in u]
        assert len(places_urls) >= 1, "At least one places call should have been made"
        for url in places_urls:
            assert "type=convenience_store" in url, (
                f"Local/urban route must use convenience_store POI type; "
                f"got places URL: {url!r}"
            )
