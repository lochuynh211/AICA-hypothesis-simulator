"""T014 — Maps analyze determinism + replay-no-refetch (M4).

Proves two properties:

1. Deterministic analyze: calling POST /api/routes/analyze twice with the same
   mocked fixtures yields identical alternatives (route_ids, route_facts, display,
   notices).  No non-determinism from dict ordering, float arithmetic, or Places
   fetch ordering.

2. Replay-no-refetch: a run created from a maps alternative requires ZERO further
   Maps API calls during ticking or log reading.  Proven by replacing
   ``maps_client._urlopen`` with a RAISING function immediately after run creation
   — the full tick loop and GET /api/runs/{id}/log must succeed.  A second
   independent run from fresh-analyze over the same fixtures must fire the
   REST_PROPOSAL at the same tick (same-fixture determinism across runs).

Note: the mocked fixtures put rest_spot_positions at 0 km (the toy polyline in
directions_3_alternatives.json does not reach the Places lat/lngs).  For the
determinism proof this is intentional — the assertion is about identical outputs,
not about proposal trigger mechanics.  For the tick-level determinism assertion
the run uses ``require_actionable: false`` so REST_PROPOSAL fires on the same tick
as a local run would with the same scenario + package.
"""

from __future__ import annotations

import pathlib

import pytest
from fastapi.testclient import TestClient

import aica_api.services.maps_client as mc
from aica_api.main import app
from aica_api.services.run_manager import clear_registry
from aica_api.services.run_plan import clear_draft_registry

_FIXTURE_DIR = pathlib.Path(__file__).parent / "fixtures" / "maps"

VALID_PACKAGE_ID = "aica_transparent_hybrid_trigger_v1"  # feature 009: rest_rule_based_v0_1 retired
VALID_SCENARIO_ID = "uc01_fatigue_recovery_v0_1"  # feature 009: friend_drive retired
_TEST_KEY = "T014_DETERMINISM_TEST_KEY"

_MAX_TICKS = 300


# ── Fixtures ──────────────────────────────────────────────────────────────────


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


def _dir_bytes(name: str = "directions_3_alternatives.json") -> bytes:
    return (_FIXTURE_DIR / name).read_bytes()


def _pl_bytes(name: str = "places_service_area.json") -> bytes:
    return (_FIXTURE_DIR / name).read_bytes()


def _make_urlopen_seq(responses: list[bytes]):
    """_urlopen mock that returns responses in order; raises on overrun."""
    calls = list(responses)

    def _mock(url: str) -> bytes:
        if not calls:
            raise AssertionError(
                "_urlopen called more times than expected — "
                "Maps must not be contacted after route analysis is done."
            )
        return calls.pop(0)

    return _mock


def _analyze_seq(n_alts: int = 3) -> list[bytes]:
    """One directions call + _PLACES_SAMPLE_POINTS places calls per alternative.

    Each alternative now triggers exactly mc._PLACES_SAMPLE_POINTS Nearby Search
    calls (multi-point sampling along the route).
    """
    return [_dir_bytes()] + [_pl_bytes()] * (n_alts * mc._PLACES_SAMPLE_POINTS)


def _do_analyze(client) -> dict:
    """POST /api/routes/analyze with test key. Returns response JSON."""
    resp = client.post(
        "/api/routes/analyze",
        json={
            "scenario_id": VALID_SCENARIO_ID,
            "maps_key": _TEST_KEY,
            "start": "San Francisco, CA",
            "end": "Sacramento, CA",
        },
    )
    assert resp.status_code == 200, f"Analyze failed: {resp.json()}"
    return resp.json()


def _create_maps_run(client, alt: dict) -> str:
    """Create plan + run from a maps alternative.  Returns run_id.

    Feature 009: python_module packages have no "require_actionable"
    hyperparameter (that was a declarative_rule-only actionability-guard
    concept, retired along with the built-in algorithm types) — the hybrid
    trigger fires from its own persisted score thresholds regardless of
    rest-spot position.
    """
    plan_resp = client.post(
        "/api/run-plans",
        json={
            "package_id": VALID_PACKAGE_ID,
            "scenario_id": VALID_SCENARIO_ID,
            "route_id": alt["route_id"],
            "route_source": "maps",
            "route_facts": alt["route_facts"],
            "display_route": alt["display"],
            "parameters": {},
            "hyperparameters": {},
        },
    )
    assert plan_resp.status_code == 201, f"Plan creation failed: {plan_resp.json()}"
    plan_id = plan_resp.json()["plan_id"]

    run_resp = client.post("/api/runs", json={"plan_id": plan_id})
    assert run_resp.status_code == 201, f"Run creation failed: {run_resp.json()}"
    return run_resp.json()["run_id"]


def _tick_until_paused(client, run_id: str) -> tuple[list[dict], dict]:
    """Tick until paused=True.  Returns (all_bodies, paused_body)."""
    all_bodies: list[dict] = []
    for _ in range(_MAX_TICKS):
        resp = client.post(f"/api/runs/{run_id}/tick")
        assert resp.status_code == 200
        body = resp.json()
        all_bodies.append(body)
        if body.get("paused"):
            return all_bodies, body
    pytest.fail(
        f"Run {run_id!r} did not pause within {_MAX_TICKS} ticks — "
        "REST_PROPOSAL never fired."
    )


# ── T014a: Analyze determinism ────────────────────────────────────────────────


class TestAnalyzeDeterminism:
    """POST /api/routes/analyze with same mocked data → identical output."""

    def test_two_calls_return_identical_alternatives(self, client, monkeypatch):
        """Calling analyze twice with the same mocked fixtures yields identical output.

        Covers: route_ids (stable slot-based strings), route_facts (all fields
        including rest_spot_positions), display (polyline, labels), notices.
        No non-determinism from dict iteration order, float operations, or
        the Places loop ordering.
        """
        # (1 directions + 3 alts × _PLACES_SAMPLE_POINTS places) × 2 = 38 total
        call_seq = _analyze_seq(3) + _analyze_seq(3)
        monkeypatch.setattr(mc, "_urlopen", _make_urlopen_seq(call_seq))

        r1 = _do_analyze(client)
        r2 = _do_analyze(client)

        assert r1["route_source"] == "maps"
        assert r2["route_source"] == "maps"
        assert len(r1["alternatives"]) == len(r2["alternatives"]), (
            "Both calls must return the same number of alternatives"
        )

        for i, (a1, a2) in enumerate(zip(r1["alternatives"], r2["alternatives"])):
            assert a1["route_id"] == a2["route_id"], (
                f"Alternative {i}: route_id diverged "
                f"({a1['route_id']!r} vs {a2['route_id']!r})"
            )
            assert a1["route_facts"] == a2["route_facts"], (
                f"Alternative {i}: route_facts diverged between the two calls"
            )
            assert a1["display"] == a2["display"], (
                f"Alternative {i}: display diverged between the two calls"
            )
            assert a1["summary"] == a2["summary"], (
                f"Alternative {i}: summary diverged between the two calls"
            )
            assert a1["notices"] == a2["notices"], (
                f"Alternative {i}: notices diverged between the two calls"
            )

    def test_route_ids_are_stable_slot_strings(self, client, monkeypatch):
        """Maps alternatives use stable slot-based IDs 'route-0', 'route-1', ...."""
        monkeypatch.setattr(mc, "_urlopen", _make_urlopen_seq(_analyze_seq(3)))
        body = _do_analyze(client)
        for i, alt in enumerate(body["alternatives"]):
            assert alt["route_id"] == f"route-{i}", (
                f"Expected route_id='route-{i}', got {alt['route_id']!r}"
            )

    def test_route_facts_fields_identical_on_repeat(self, client, monkeypatch):
        """Each route_facts field (distance, duration, segments, rest_spots) is stable."""
        call_seq = _analyze_seq(3) + _analyze_seq(3)
        monkeypatch.setattr(mc, "_urlopen", _make_urlopen_seq(call_seq))

        r1 = _do_analyze(client)
        r2 = _do_analyze(client)

        for i, (a1, a2) in enumerate(zip(r1["alternatives"], r2["alternatives"])):
            rf1 = a1["route_facts"]
            rf2 = a2["route_facts"]
            assert rf1["total_route_distance_km"] == rf2["total_route_distance_km"]
            assert rf1["estimated_route_duration_min"] == rf2["estimated_route_duration_min"]
            assert rf1["route_segments"] == rf2["route_segments"]
            assert rf1["rest_spot_positions"] == rf2["rest_spot_positions"]
            assert rf1["route_progress_checkpoints"] == rf2["route_progress_checkpoints"]
            assert rf1["route_source"] == "maps"

    def test_display_polyline_identical_on_repeat(self, client, monkeypatch):
        """The encoded_polyline in display is identical across calls."""
        call_seq = _analyze_seq(3) + _analyze_seq(3)
        monkeypatch.setattr(mc, "_urlopen", _make_urlopen_seq(call_seq))

        r1 = _do_analyze(client)
        r2 = _do_analyze(client)

        for i, (a1, a2) in enumerate(zip(r1["alternatives"], r2["alternatives"])):
            assert a1["display"]["encoded_polyline"] == a2["display"]["encoded_polyline"], (
                f"Alternative {i}: encoded_polyline diverged"
            )


# ── T014b: Replay-no-refetch ──────────────────────────────────────────────────


class TestReplayNoRefetch:
    """After run creation, tick and log operations must make NO Maps calls."""

    def test_tick_loop_succeeds_with_raising_urlopen(self, client, monkeypatch):
        """Replace _urlopen with a RAISING function immediately after run creation.

        The full tick loop to REST_PROPOSAL must succeed — proving that no Maps
        call happens during tick execution (route facts are frozen at analyze time).
        """
        # 1. Analyze with real mock responses.
        monkeypatch.setattr(mc, "_urlopen", _make_urlopen_seq(_analyze_seq(3)))
        analyze_body = _do_analyze(client)
        chosen = analyze_body["alternatives"][0]

        # 2. Create plan + run from the chosen alternative.
        run_id = _create_maps_run(client, chosen)

        # 3. After run creation, replace _urlopen with a function that RAISES.
        #    Any tick or log operation that contacts Maps will fail the test.
        def _maps_forbidden(url: str) -> bytes:
            raise RuntimeError(
                "_urlopen called during tick/replay — Maps must not be "
                "contacted after the run has been created from frozen route facts."
            )

        monkeypatch.setattr(mc, "_urlopen", _maps_forbidden)

        # 4. Tick to a fired proposal — must succeed despite the raising mock.
        # The hybrid trigger may fire REST_PROPOSAL or MONOTONY_PROPOSAL first
        # depending on the maps-derived route's segment mix (both actionable via
        # "decline") — this test is about Maps-call isolation, not which
        # category fires first.
        all_bodies, paused_body = _tick_until_paused(client, run_id)

        decision = paused_body["decision"]
        assert decision is not None
        assert decision["result_type"] in ("REST_PROPOSAL", "MONOTONY_PROPOSAL"), (
            f"Expected a fired proposal at pause, got {decision['result_type']!r}"
        )
        assert decision["proposal"] is not None

    def test_log_read_succeeds_with_raising_urlopen(self, client, monkeypatch):
        """GET /api/runs/{id}/log must succeed after tick-to-completion with raising mock.

        Proves that log reading (which just reads from disk) does not re-invoke
        any route analysis or Maps API calls.
        """
        # Analyze + create run.
        monkeypatch.setattr(mc, "_urlopen", _make_urlopen_seq(_analyze_seq(3)))
        chosen = _do_analyze(client)["alternatives"][0]
        run_id = _create_maps_run(client, chosen)

        # Replace with raising mock.
        def _maps_forbidden(url: str) -> bytes:
            raise RuntimeError("Maps contacted during replay — must not happen.")

        monkeypatch.setattr(mc, "_urlopen", _maps_forbidden)

        # Tick to proposal.
        _tick_until_paused(client, run_id)

        # Resolve the proposal via "decline" — uc01_fatigue_recovery_v0_1 has
        # recovery_options, so accept_rest would require recovery_option_id +
        # rest_spot (dedicated coverage: test_run_manager_recovery.py); decline
        # always resolves a pause regardless of which category fired.
        action_resp = client.post(
            f"/api/runs/{run_id}/actions",
            json={"action": "decline"},
        )
        assert action_resp.status_code == 200
        assert action_resp.json()["status"] == "playing"

        # GET /log — must succeed without any Maps contact.
        log_resp = client.get(f"/api/runs/{run_id}/log")
        assert log_resp.status_code == 200, (
            "Log read must succeed without contacting Maps"
        )
        log = log_resp.json()

        # Assert log carries maps provenance.
        assert log["route_source"] == "maps"
        dr = log.get("display_route")
        assert dr is not None, "RunLog must carry display_route for maps run"
        assert dr["encoded_polyline"], "display_route.encoded_polyline must be non-empty"

        # Assert tick events are fully populated.
        tick_events = [e for e in log["events"] if e.get("kind") == "tick"]
        assert len(tick_events) >= 1
        for evt in tick_events:
            assert "trace" in evt
            assert "decision_result" in evt["trace"]

    def test_same_fixtures_yield_same_proposal_tick(self, tmp_path, monkeypatch):
        """Two runs from fresh-analyze over the same fixtures fire at the same tick.

        Run A: analyze → create run → RAISE urlopen → tick to proposal → tick count.
        Run B: restore mock → analyze again → create run → RAISE urlopen → tick count.
        tick_count_A must equal tick_count_B (deterministic proposal timing).
        """
        monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
        client = TestClient(app)

        def _run_one(label: str) -> int:
            """Full analyze→create→tick cycle; returns tick count to REST_PROPOSAL."""
            # Fresh analyze mock for each run.
            monkeypatch.setattr(mc, "_urlopen", _make_urlopen_seq(_analyze_seq(3)))
            chosen = _do_analyze(client)["alternatives"][0]
            run_id = _create_maps_run(client, chosen)

            # Block Maps after run creation.
            def _forbidden(url: str) -> bytes:
                raise RuntimeError(f"Maps called during tick for run {label!r}")

            monkeypatch.setattr(mc, "_urlopen", _forbidden)

            bodies, _ = _tick_until_paused(client, run_id)
            return len(bodies)

        tick_a = _run_one("A")
        tick_b = _run_one("B")

        assert tick_a == tick_b, (
            f"Same fixtures must yield the same proposal tick: "
            f"Run A fired at tick {tick_a}, Run B fired at tick {tick_b}"
        )
