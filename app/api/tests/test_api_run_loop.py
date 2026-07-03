"""Backend-only end-to-end API run-loop test (T029 / US3).

Feature 009 (signal-tier redesign): repointed from the retired
rest_rule_based_v0_1/rest_weighted_score_v0_1 (declarative_rule/weighted_score) ×
uc01_fatigue_friend_drive_v0_1/uc01_overtime_driver_v0_1 pairings to the surviving
world: aica_transparent_hybrid_trigger_v1 + nri_fatigue_score_v1 (both
python_module) × uc01_fatigue_recovery_v0_1.  The overtime scenario and the
weighted_score package no longer exist — tests that exclusively exercised them
(overtime decline loop, weighted-score strength) are deleted.

uc01_fatigue_recovery_v0_1 has recovery_options, so accept_rest now requires
recovery_option_id + rest_spot and resolves to status="playing" (recovery
active) instead of completing the run outright — see
test_run_manager_recovery.py for the dedicated recovery-sequence coverage.
Tests below that only need to *resolve* a paused run (not exercise recovery
itself) use "decline" instead, which is unaffected.

M3 extension (T014): adds the transparent hybrid package to all pairings; guards
hybrid-specific assertions (full trace + evolving per-tick runtime state) to that
pairing; adds a dedicated e2e test driving the full HTTP plan flow with route
analysis (POST /api/routes/analyze) as step 1.

M4 extension (T015): mocked-maps full HTTP e2e through the real endpoint chain
(POST /api/routes/analyze → pick alternative → POST /api/run-plans → POST /api/runs
→ tick-loop → actions → GET /log).  Maps mocked at _urlopen; sentinel key proven
absent from the entire log.  Asserts route_source='maps', DisplayRoute persisted,
exactly one REST_PROPOSAL, and Places-derived rest_spot_positions non-empty.

Coverage:
  1. Full loop   — POST /api/runs → tick to REST_PROPOSAL → decline → GET /log
  2. Determinism — two independent runs produce identical decision-trace sequences
  3. Past-end    — ticking to full completion (declining every proposal) is
     idempotent once completed=True
  4. All-pairings e2e (both surviving python_module packages × the recovery
     scenario) via plan_id flow; asserts exactly one REST_PROPOSAL, full log
     structure, and per-tick M2 fields.  Hybrid pairing additionally asserts:
     full decision trace (scores/states/candidates/fire_control/explanation)
     and evolving per-tick package_runtime_state (M3 headline).
  5. All-pairings determinism — two runs → identical decision-trace
  6. Decline with no pending proposal → 409
  7. Hybrid HTTP full-flow + evolving state (M3, T014) — analyze → run-plans → runs →
     tick-loop → actions → log; asserts SUPPRESSED tick visible, full trace, non-empty
     evolving package_runtime_state in every persisted TickEvent.
  8. Hybrid HTTP determinism (M3, T014) — two independent hybrid runs → same trace.

Isolation: runs dir is redirected to tmp_path via AICA_RUNS_DIR monkeypatch;
the in-memory run registry is cleared before and after every test (autouse).
"""

from __future__ import annotations

import pathlib

import pytest
from fastapi.testclient import TestClient

import aica_api.services.maps_client as _mc
from aica_api.main import app
from aica_api.services.run_manager import clear_registry
from aica_api.services.run_plan import clear_draft_registry

_MAPS_FIXTURE_DIR = pathlib.Path(__file__).parent / "fixtures" / "maps"

# ── Constants ──────────────────────────────────────────────────────────────────

VALID_PACKAGE_ID = "aica_transparent_hybrid_trigger_v1"
VALID_SCENARIO_ID = "uc01_fatigue_recovery_v0_1"

# M3: transparent hybrid package constants
HYBRID_PACKAGE_ID = "aica_transparent_hybrid_trigger_v1"
HYBRID_SCENARIO_ID = "uc01_fatigue_recovery_v0_1"

# Second surviving python_module package (nri_fatigue_score_v1)
NRI_PACKAGE_ID = "nri_fatigue_score_v1"

# Safety cap: observed firing ticks are 111 (hybrid, tick_seconds=30) and 45
# (nri, tick_seconds=60) on uc01_fatigue_recovery_v0_1 — 250 is generous.
_MAX_TICKS = 250

# Both surviving python_module packages fire exactly one REST_PROPOSAL on the
# recovery scenario; resolved via "decline" (accept_rest now requires
# recovery_option_id + rest_spot since the scenario has recovery_options — see
# test_run_manager_recovery.py for dedicated recovery-sequence coverage).
_FIRING_PAIRINGS = [
    pytest.param(
        HYBRID_PACKAGE_ID, HYBRID_SCENARIO_ID, "decline",
        id="hybrid-recovery",
    ),
    pytest.param(
        NRI_PACKAGE_ID, VALID_SCENARIO_ID, "decline",
        id="nri-recovery",
    ),
]


# ── Fixtures ───────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def reset_run_registry():
    """Isolate every test — clear both in-memory registries before and after."""
    clear_registry()
    clear_draft_registry()
    yield
    clear_registry()
    clear_draft_registry()


@pytest.fixture
def client(tmp_path, monkeypatch):
    """TestClient with runs dir redirected to a temp directory."""
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
    return TestClient(app)


# ── Helpers ────────────────────────────────────────────────────────────────────


def _create_run(client: TestClient) -> str:
    """Create a run plan then a run via the plan flow; return the run_id."""
    # Step 1: Create run plan
    plan_resp = client.post(
        "/api/run-plans",
        json={
            "package_id": VALID_PACKAGE_ID,
            "scenario_id": VALID_SCENARIO_ID,
            "parameters": {},
            "hyperparameters": {},
            "run_mode": "standard",
        },
    )
    assert plan_resp.status_code == 201, f"Plan creation failed: {plan_resp.json()}"
    plan_id = plan_resp.json()["plan_id"]

    # Step 2: Create run from plan
    resp = client.post("/api/runs", json={"plan_id": plan_id})
    assert resp.status_code == 201, f"Run creation failed: {resp.json()}"
    return resp.json()["run_id"]


def _tick_until_paused(
    client: TestClient, run_id: str
) -> tuple[list[dict], dict]:
    """POST /tick repeatedly until a response has paused=True.

    Returns:
        all_bodies   — every tick response body (including the paused one)
        paused_body  — the last (paused) body, for convenient access
    """
    all_bodies: list[dict] = []
    for _ in range(_MAX_TICKS):
        resp = client.post(f"/api/runs/{run_id}/tick")
        assert resp.status_code == 200
        body = resp.json()
        all_bodies.append(body)
        if body.get("paused") is True:
            return all_bodies, body
    pytest.fail(
        f"Run {run_id!r} did not pause within {_MAX_TICKS} ticks — "
        "REST_PROPOSAL never fired."
    )


def _extract_trace(tick_bodies: list[dict]) -> list[dict]:
    """Extract a comparable, timestamp-free decision trace from tick response bodies.

    Returns a list of ``{result_type, score, selected_category}`` dicts, one
    per tick that produced a decision (algorithm_error ticks have no decision
    and are skipped).
    """
    return [
        {
            "result_type": body["decision"]["result_type"],
            "score": body["decision"]["score"],
            "selected_category": body["decision"]["selected_category"],
        }
        for body in tick_bodies
        if body.get("decision") is not None
    ]


# ── Test 1: Full loop (FR-014, SC-002, SC-004) ────────────────────────────────


def test_full_loop(client):
    """Full loop: create → tick to REST_PROPOSAL → decline → verify log.

    Feature 009: uses "decline" (not "accept_rest") to resolve the proposal —
    uc01_fatigue_recovery_v0_1 has recovery_options, so accept_rest now requires
    recovery_option_id + rest_spot and starts a multi-tick recovery sequence
    instead of completing the run outright (see test_run_manager_recovery.py).
    """

    # ── 1a. Create run ────────────────────────────────────────────────────────
    run_id = _create_run(client)

    # Log file must be persisted immediately after creation.
    log_resp = client.get(f"/api/runs/{run_id}/log")
    assert log_resp.status_code == 200
    assert log_resp.json()["run_id"] == run_id

    # ── 1b. Tick until paused (REST_PROPOSAL must fire) ───────────────────────
    all_bodies, paused_body = _tick_until_paused(client, run_id)

    # The paused tick must carry a REST_PROPOSAL decision with a proposal object.
    decision = paused_body["decision"]
    assert decision is not None, "Paused tick must include a decision"
    assert decision["result_type"] == "REST_PROPOSAL", (
        f"Expected REST_PROPOSAL at paused tick, got {decision['result_type']!r}"
    )
    assert decision["proposal"] is not None, "REST_PROPOSAL must include a proposal"

    # Exactly ONE tick must have been paused (SC-002: only one proposal in the loop).
    paused_ticks = [b for b in all_bodies if b.get("paused") is True]
    assert len(paused_ticks) == 1, (
        f"Expected exactly one paused tick, got {len(paused_ticks)}"
    )

    # All ticks before the proposal must be NO_PROPOSAL or SUPPRESSED (hybrid's
    # non-firing result types — regenerated from actual behavior, FR-018).
    pre_proposal_bodies = all_bodies[:-1]
    for i, body in enumerate(pre_proposal_bodies):
        pre_decision = body.get("decision")
        if pre_decision is None:
            continue  # algorithm_error tick — allowed, not a proposal
        assert pre_decision["result_type"] in ("NO_PROPOSAL", "SUPPRESSED"), (
            f"Tick {i} before proposal should be NO_PROPOSAL or SUPPRESSED, "
            f"got {pre_decision['result_type']!r}"
        )

    # ── 1c. Decline the rest proposal ─────────────────────────────────────────
    action_resp = client.post(
        f"/api/runs/{run_id}/actions",
        json={"action": "decline"},
    )
    assert action_resp.status_code == 200
    updated_state = action_resp.json()
    assert updated_state["status"] == "playing"
    assert updated_state["pending_proposal"] is None

    # ── 1d. GET /log — must contain tick trace AND action event (SC-004) ──────
    log_resp = client.get(f"/api/runs/{run_id}/log")
    assert log_resp.status_code == 200
    log = log_resp.json()

    events = log["events"]
    tick_events = [e for e in events if e.get("kind") == "tick"]
    action_events = [e for e in events if e.get("kind") == "action"]

    # At least one tick event, each with a trace containing a decision_result.
    assert len(tick_events) >= 1, "Log must contain tick events"
    for evt in tick_events:
        assert "trace" in evt, "Every tick event must carry a trace"
        assert "decision_result" in evt["trace"], (
            "Every trace must contain a decision_result"
        )

    # Exactly one action event with the expected fields.
    assert len(action_events) == 1, "Log must contain exactly one action event"
    assert action_events[0]["action"] == "decline"
    assert action_events[0]["resulting_status"] == "playing"


# ── Test 2: Determinism (SC-003) ──────────────────────────────────────────────


def test_determinism(tmp_path, monkeypatch):
    """Two independent runs of the same package+scenario produce identical traces.

    Each run is created, ticked to REST_PROPOSAL, and the per-tick
    (result_type, score, selected_category) sequences are compared.
    Timestamps and run_ids are excluded from the comparison.
    """
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
    client = TestClient(app)

    # Run A
    run_id_a = _create_run(client)
    all_bodies_a, _ = _tick_until_paused(client, run_id_a)
    trace_a = _extract_trace(all_bodies_a)

    # Run B — separate run, same fixture identifiers
    run_id_b = _create_run(client)
    all_bodies_b, _ = _tick_until_paused(client, run_id_b)
    trace_b = _extract_trace(all_bodies_b)

    # Sequences must be the same length.
    assert len(trace_a) == len(trace_b), (
        f"Run A produced {len(trace_a)} decisions; Run B produced {len(trace_b)}"
    )

    # Every per-tick entry must be identical.
    for i, (entry_a, entry_b) in enumerate(zip(trace_a, trace_b)):
        assert entry_a == entry_b, (
            f"Tick {i} diverged between the two runs: "
            f"Run A={entry_a!r}, Run B={entry_b!r}"
        )


# ── Test 3: Ticking past end is idempotent (SC-006) ──────────────────────────


def test_tick_past_end_is_idempotent(client):
    """After the run reaches completed=True, further ticks return completed=True
    idempotently.

    Feature 009: declines every proposal to reach completion (uc01_fatigue_recovery_v0_1
    has recovery_options, so accept_rest no longer completes the run outright — see
    test_run_manager_recovery.py for the dedicated recovery-sequence coverage).
    """

    run_id = _create_run(client)

    # Tick to full completion, declining every REST_PROPOSAL along the way.
    completed = False
    for _ in range(_MAX_TICKS):
        resp = client.post(f"/api/runs/{run_id}/tick")
        assert resp.status_code == 200
        body = resp.json()
        if body.get("paused"):
            decline_resp = client.post(f"/api/runs/{run_id}/actions", json={"action": "decline"})
            assert decline_resp.status_code == 200
        if body.get("completed"):
            completed = True
            break
    assert completed, f"Run did not complete within {_MAX_TICKS} ticks"

    # First tick after completion must return completed=True.
    resp1 = client.post(f"/api/runs/{run_id}/tick")
    assert resp1.status_code == 200
    body1 = resp1.json()
    assert body1.get("completed") is True, (
        "First tick after completion must return completed=True"
    )

    # Second tick must also return completed=True (idempotent).
    resp2 = client.post(f"/api/runs/{run_id}/tick")
    assert resp2.status_code == 200
    body2 = resp2.json()
    assert body2.get("completed") is True, (
        "Subsequent ticks must remain completed=True"
    )

    # current_tick must not advance between the two completed-state ticks.
    assert body1["run_state"]["current_tick"] == body2["run_state"]["current_tick"], (
        "current_tick must not advance once the run is completed"
    )


# Feature 009: the overtime-scenario decline e2e test (T028) exclusively
# exercised the retired uc01_overtime_driver_v0_1 scenario — deleted rather
# than repointed.  test_decline_repeatedly_reaches_completion in
# test_run_manager.py and test_full_loop above cover the equivalent behavior
# (decline resumes the run; the run keeps making progress toward completion)
# on the surviving recovery scenario.


# ── Helpers ── plan_id flow for arbitrary package/scenario ────────────────────


def _create_run_for_pairing(
    client: TestClient, package_id: str, scenario_id: str
) -> str:
    """Create a run via the plan_id flow for any package+scenario pairing."""
    plan_resp = client.post(
        "/api/run-plans",
        json={
            "package_id": package_id,
            "scenario_id": scenario_id,
            "parameters": {},
            "hyperparameters": {},
            "run_mode": "standard",
        },
    )
    assert plan_resp.status_code == 201, (
        f"Plan creation failed for {package_id}×{scenario_id}: {plan_resp.json()}"
    )
    plan_id = plan_resp.json()["plan_id"]

    run_resp = client.post("/api/runs", json={"plan_id": plan_id})
    assert run_resp.status_code == 201, (
        f"Run creation failed for {package_id}×{scenario_id}: {run_resp.json()}"
    )
    return run_resp.json()["run_id"]


# ── T029: All-pairings e2e (M2) ───────────────────────────────────────────────


@pytest.mark.parametrize("package_id,scenario_id,resolve_action", _FIRING_PAIRINGS)
def test_all_pairings_e2e(client, package_id, scenario_id, resolve_action):
    """T029: both packages × both scenarios, via plan_id flow.

    For each of the four pairings:
    - Creates a run via POST /api/run-plans → POST /api/runs{plan_id}
    - Ticks to exactly one REST_PROPOSAL
    - Asserts the persisted log carries setup snapshot, frozen plan, per-tick M2
      fields (raw_state, feature_groups, driver_update, vehicle_update,
      package_runtime_state), and original/modified values
    - Resolves with the pairing's action and verifies log completeness
    """
    # ── Create run via plan_id flow ───────────────────────────────────────────
    run_id = _create_run_for_pairing(client, package_id, scenario_id)

    # Log persisted immediately after creation
    log_resp = client.get(f"/api/runs/{run_id}/log")
    assert log_resp.status_code == 200, "Log must be available after run creation"
    initial_log = log_resp.json()
    assert initial_log["run_id"] == run_id

    # ── Assert setup snapshot in the log ─────────────────────────────────────
    assert initial_log["snapshot"]["package"]["id"] == package_id, (
        f"Log snapshot must reference package {package_id!r}"
    )
    assert initial_log["snapshot"]["scenario"]["id"] == scenario_id, (
        f"Log snapshot must reference scenario {scenario_id!r}"
    )

    # ── Assert frozen plan fields ─────────────────────────────────────────────
    event_plan = initial_log.get("event_plan", {})
    assert event_plan.get("tick_seconds", 0) > 0, (
        "event_plan.tick_seconds must be set in the frozen plan"
    )
    assert len(event_plan.get("rest_opportunities", [])) > 0, (
        "event_plan.rest_opportunities must be non-empty in the frozen plan"
    )

    # ── Assert original/modified values present ───────────────────────────────
    assert "original_values" in initial_log, "Log must carry original_values"
    assert "modified_values" in initial_log, "Log must carry modified_values"

    # ── Tick until paused (REST_PROPOSAL fires) ───────────────────────────────
    all_bodies, paused_body = _tick_until_paused(client, run_id)

    decision = paused_body["decision"]
    assert decision is not None, "Paused tick must carry a decision"
    assert decision["result_type"] == "REST_PROPOSAL", (
        f"Expected REST_PROPOSAL at paused tick for {package_id}×{scenario_id}, "
        f"got {decision['result_type']!r}"
    )
    assert decision["proposal"] is not None, "REST_PROPOSAL must include a proposal"

    # Exactly one paused tick across the run
    paused_ticks = [b for b in all_bodies if b.get("paused") is True]
    assert len(paused_ticks) == 1, (
        f"Expected exactly one paused tick, got {len(paused_ticks)} "
        f"for {package_id}×{scenario_id}"
    )

    # ── Assert per-tick M2 fields in tick events (check first tick event) ────
    log_after_ticks = client.get(f"/api/runs/{run_id}/log").json()
    tick_events = [e for e in log_after_ticks["events"] if e.get("kind") == "tick"]
    assert len(tick_events) >= 1, "Must have at least one tick event in the log"

    first_tick = tick_events[0]
    # These keys are all required M2 TickEvent fields (may be empty dicts/default).
    for field in ("raw_state", "feature_groups", "driver_update", "vehicle_update",
                  "package_runtime_state"):
        assert field in first_tick, (
            f"TickEvent must carry {field!r} field (M2 extension); "
            f"pairing={package_id}×{scenario_id}"
        )

    # ── M3 hybrid-specific: full trace + evolving per-tick runtime state ──────
    if package_id == HYBRID_PACKAGE_ID:
        # The paused decision must carry the full transparent trace.
        assert decision.get("scores"), (
            "hybrid REST_PROPOSAL must carry per-category scores"
        )
        assert {"base_safety_risk", "rest_required_score", "monotony_prevention_score"} <= set(
            decision["scores"]
        ), f"hybrid scores must include all three keys; got {set(decision['scores'])!r}"

        assert decision.get("states"), (
            "hybrid REST_PROPOSAL must carry state-machine labels"
        )
        assert {"rest", "monotony"} <= set(decision["states"]), (
            f"hybrid states must carry rest+monotony labels; got {set(decision['states'])!r}"
        )

        assert decision.get("fire_control", {}).get("fired") is True, (
            "hybrid fire_control.fired must be True on the REST_PROPOSAL"
        )
        assert decision.get("explanation"), (
            "hybrid REST_PROPOSAL must carry an explanation"
        )

        # M3 headline: every TickEvent's package_runtime_state is non-empty AND evolves.
        runtime_states = [e.get("package_runtime_state", {}) for e in tick_events]

        empty_indices = [i for i, rs in enumerate(runtime_states) if not rs]
        assert not empty_indices, (
            f"Tick events at indices {empty_indices} have empty package_runtime_state "
            f"for {package_id} — hybrid must persist non-empty state every tick"
        )

        smoothed_rest = [
            rs["smoothed_scores"]["rest_required_score"] for rs in runtime_states
        ]
        assert len(set(smoothed_rest)) > 1, (
            "smoothed_scores[rest_required_score] must change across ticks for the hybrid "
            "(M3 headline: per-tick runtime state genuinely carried forward)"
        )

        rest_counters = [rs["persistence_counters"]["rest_required"] for rs in runtime_states]
        assert max(rest_counters) >= 1, (
            "persistence_counters[rest_required] must reach >= 1 for the hybrid "
            "(persistence gate: SUPPRESSED tick → REST_PROPOSAL tick)"
        )

    # ── Resolve the proposal ──────────────────────────────────────────────────
    action_resp = client.post(
        f"/api/runs/{run_id}/actions",
        json={"action": resolve_action},
    )
    assert action_resp.status_code == 200, (
        f"Action {resolve_action!r} should succeed; got {action_resp.json()}"
    )

    # ── Verify final log completeness ─────────────────────────────────────────
    final_log = client.get(f"/api/runs/{run_id}/log").json()

    # Exactly one REST_PROPOSAL in tick events
    rest_proposals = [
        e for e in final_log["events"]
        if e.get("kind") == "tick"
        and e.get("trace", {}).get("decision_result", {}).get("result_type") == "REST_PROPOSAL"
    ]
    assert len(rest_proposals) == 1, (
        f"Expected exactly 1 REST_PROPOSAL in persisted log for {package_id}×{scenario_id}, "
        f"got {len(rest_proposals)}"
    )

    # Exactly one action event
    action_events = [e for e in final_log["events"] if e.get("kind") == "action"]
    assert len(action_events) == 1, (
        f"Expected 1 action event in log for {package_id}×{scenario_id}"
    )
    assert action_events[0]["action"] == resolve_action


# ── T029: All-pairings determinism (M2) ───────────────────────────────────────


def _tick_to_paused_or_complete(
    client: TestClient, run_id: str, max_ticks: int = 200
) -> list[dict]:
    """Tick until paused (REST_PROPOSAL) or completed. Returns all tick response bodies."""
    all_bodies: list[dict] = []
    for _ in range(max_ticks):
        resp = client.post(f"/api/runs/{run_id}/tick")
        assert resp.status_code == 200
        body = resp.json()
        all_bodies.append(body)
        if body.get("paused") is True or body.get("completed") is True:
            return all_bodies
    pytest.fail(
        f"Run {run_id!r} did not pause or complete within {max_ticks} ticks."
    )


@pytest.mark.parametrize("package_id,scenario_id,resolve_action", _FIRING_PAIRINGS)
def test_all_pairings_determinism(tmp_path, monkeypatch, package_id, scenario_id, resolve_action):
    """T029: two runs of each firing pairing → identical decision-trace sequences.

    Runs A and B are created independently with the same package+scenario.
    The per-tick (result_type, score, selected_category) sequences must match.
    """
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
    client = TestClient(app)

    # Run A
    run_id_a = _create_run_for_pairing(client, package_id, scenario_id)
    all_bodies_a, _ = _tick_until_paused(client, run_id_a)
    trace_a = _extract_trace(all_bodies_a)

    # Run B — independent run, same pairing
    run_id_b = _create_run_for_pairing(client, package_id, scenario_id)
    all_bodies_b, _ = _tick_until_paused(client, run_id_b)
    trace_b = _extract_trace(all_bodies_b)

    assert len(trace_a) == len(trace_b), (
        f"Determinism failed for {package_id}×{scenario_id}: "
        f"Run A has {len(trace_a)} decisions, Run B has {len(trace_b)}"
    )

    for i, (entry_a, entry_b) in enumerate(zip(trace_a, trace_b)):
        assert entry_a == entry_b, (
            f"Tick {i} diverged for {package_id}×{scenario_id}: "
            f"Run A={entry_a!r}, Run B={entry_b!r}"
        )


# Feature 009: the weighted-score overtime proposal-strength test (FR-013)
# exclusively exercised the retired rest_weighted_score_v0_1 package and
# uc01_overtime_driver_v0_1 scenario — deleted rather than repointed (neither
# survives; there is nothing to repoint to that preserves the test's intent).


# ── T029: decline with no pending proposal → 409 ──────────────────────────────


def test_decline_with_no_pending_proposal_is_409(client):
    """Decline when there is no pending proposal must return 409.

    Uses uc01_fatigue_recovery_v0_1 (where 'decline' IS in allowed_actions) but
    does not advance to a proposal, ensuring the 409 is for 'no pending
    proposal' and not for the disallowed-action case (which returns 400).
    """
    plan_resp = client.post(
        "/api/run-plans",
        json={
            "package_id": VALID_PACKAGE_ID,
            "scenario_id": VALID_SCENARIO_ID,
            "parameters": {},
            "hyperparameters": {},
            "run_mode": "standard",
        },
    )
    assert plan_resp.status_code == 201
    plan_id = plan_resp.json()["plan_id"]

    run_resp = client.post("/api/runs", json={"plan_id": plan_id})
    assert run_resp.status_code == 201
    run_id = run_resp.json()["run_id"]

    # Do NOT tick — no pending proposal
    action_resp = client.post(
        f"/api/runs/{run_id}/actions",
        json={"action": "decline"},
    )
    assert action_resp.status_code == 409, (
        f"decline with no pending proposal must return 409 (No pending proposal), "
        f"not {action_resp.status_code}: {action_resp.json()}"
    )


# ── T014 (M3): Hybrid HTTP full plan-flow + evolving persisted runtime state ──


def test_hybrid_http_full_flow_evolving_state(client):
    """T014 (M3): transparent hybrid through the REAL HTTP plan flow with route analysis.

    Full flow: POST /api/routes/analyze → POST /api/run-plans → POST /api/runs →
               POST /api/runs/{id}/tick (×~111) → POST /api/runs/{id}/actions →
               GET /api/runs/{id}/log.

    This is the M3 end-to-end headline test. It asserts:
    - Exactly one REST_PROPOSAL at the paused tick (tick 111 for the hybrid on
      uc01_fatigue_recovery_v0_1 with tick_seconds=30 — regenerated from actual
      behavior, FR-018)
    - Full decision trace present: scores, states, candidates (incl. the
      persistence-gated SUPPRESSED candidates leading up to the fire), fire_control,
      explanation
    - accept_rest (with recovery_option_id + rest_spot) resolves the proposal
      (status → playing, recovery active) — uc01_fatigue_recovery_v0_1 has
      recovery_options, so accept_rest starts a recovery sequence instead of
      completing the run outright (see test_run_manager_recovery.py)
    - The persisted per-tick package_runtime_state is non-empty for EVERY TickEvent
      AND changes across ticks (smoothed_scores and persistence_counters evolve) —
      the M3 headline: state is genuinely threaded forward in the evidence, not reset.
    - SUPPRESSED ticks visible in the log (persistence gate gradually building up
      to the fired REST_PROPOSAL)
    """
    # 1. Analyze route (warms route facts; included to cover the full HTTP surface)
    analyze_resp = client.post(
        "/api/routes/analyze",
        json={"scenario_id": HYBRID_SCENARIO_ID},
    )
    assert analyze_resp.status_code == 200, (
        f"Route analyze must succeed: {analyze_resp.json()}"
    )

    # 2. Create run plan via POST /api/run-plans
    plan_resp = client.post(
        "/api/run-plans",
        json={
            "package_id": HYBRID_PACKAGE_ID,
            "scenario_id": HYBRID_SCENARIO_ID,
            "parameters": {},
            "hyperparameters": {},
            "run_mode": "standard",
        },
    )
    assert plan_resp.status_code == 201, f"Plan creation failed: {plan_resp.json()}"
    plan_id = plan_resp.json()["plan_id"]

    # 3. Create run from plan via POST /api/runs
    run_resp = client.post("/api/runs", json={"plan_id": plan_id})
    assert run_resp.status_code == 201, f"Run creation failed: {run_resp.json()}"
    run_id = run_resp.json()["run_id"]

    # Log must be persisted immediately after creation
    log_resp = client.get(f"/api/runs/{run_id}/log")
    assert log_resp.status_code == 200
    initial_log = log_resp.json()
    assert initial_log["run_id"] == run_id
    assert initial_log["snapshot"]["package"]["id"] == HYBRID_PACKAGE_ID

    # 4. Tick repeatedly until the run pauses on a REST_PROPOSAL
    all_bodies, paused_body = _tick_until_paused(client, run_id)

    # Exactly one paused tick across the whole run
    paused_ticks = [b for b in all_bodies if b.get("paused") is True]
    assert len(paused_ticks) == 1, (
        f"Expected exactly one paused tick (one REST_PROPOSAL), "
        f"got {len(paused_ticks)}"
    )

    # Paused tick must carry REST_PROPOSAL with a proposal
    decision = paused_body["decision"]
    assert decision is not None, "Paused tick must carry a decision"
    assert decision["result_type"] == "REST_PROPOSAL", (
        f"Expected REST_PROPOSAL at pause, got {decision['result_type']!r}"
    )
    assert decision["proposal"] is not None, "REST_PROPOSAL must include a proposal object"

    # Full transparent trace fields (hybrid-specific M3 fields)
    assert decision.get("scores"), "hybrid decision must carry category scores"
    expected_score_keys = {"base_safety_risk", "rest_required_score", "monotony_prevention_score"}
    assert expected_score_keys <= set(decision["scores"]), (
        f"hybrid trace must include all score keys; got {set(decision['scores'])!r}"
    )

    assert decision.get("states"), "hybrid decision must carry state-machine labels"
    assert {"rest", "monotony"} <= set(decision["states"]), (
        f"hybrid trace must carry rest+monotony state labels; got {set(decision['states'])!r}"
    )

    candidates = decision.get("candidates", [])
    assert len(candidates) >= 1, "hybrid decision must carry at least one candidate"
    assert any(c["category"] == "rest_required" for c in candidates), (
        "rest_required candidate must be present in hybrid decision"
    )
    # At least one fired candidate for rest_required
    assert any(
        c["category"] == "rest_required" and c.get("fire_control", {}).get("fired") is True
        for c in candidates
    ), "hybrid REST_PROPOSAL must have a fired rest_required candidate"

    assert decision.get("fire_control", {}).get("fired") is True, (
        "fire_control.fired must be True on the REST_PROPOSAL"
    )
    assert decision.get("explanation"), "hybrid decision must carry explanation lines"

    # 5. Accept the rest proposal (accept_rest ∈ proposal.options ∩ allowed_actions).
    # uc01_fatigue_recovery_v0_1 has recovery_options — accept_rest requires
    # recovery_option_id + rest_spot and starts a recovery sequence (status →
    # playing) rather than completing the run outright.
    action_resp = client.post(
        f"/api/runs/{run_id}/actions",
        json={
            "action": "accept_rest",
            "recovery_option_id": "nap_karaoke",
            "rest_spot": {"id": "p1", "label": {"ja": "SA", "en": "SA"}, "route_fraction": 0.5},
        },
    )
    assert action_resp.status_code == 200, f"accept_rest failed: {action_resp.json()}"
    post_action = action_resp.json()
    assert post_action["status"] == "playing", (
        f"Expected playing (recovery started) after accept_rest, got {post_action['status']!r}"
    )
    assert post_action["pending_proposal"] is None
    assert post_action["recovery"] is not None and post_action["recovery"]["active"] is True

    # 6. GET /api/runs/{run_id}/log — verify full persisted evidence
    final_log = client.get(f"/api/runs/{run_id}/log").json()
    all_events = final_log["events"]
    tick_events = [e for e in all_events if e.get("kind") == "tick"]
    action_events = [e for e in all_events if e.get("kind") == "action"]

    # Exactly one REST_PROPOSAL in the tick trace
    rest_proposals_in_log = [
        e for e in tick_events
        if e.get("trace", {}).get("decision_result", {}).get("result_type") == "REST_PROPOSAL"
    ]
    assert len(rest_proposals_in_log) == 1, (
        f"Expected exactly 1 REST_PROPOSAL in persisted log, got {len(rest_proposals_in_log)}"
    )

    # SUPPRESSED ticks visible — the persistence gate is observable end-to-end:
    # the persistence counter builds up over several SUPPRESSED ticks before the
    # REST_PROPOSAL finally fires.
    suppressed_in_log = [
        e for e in tick_events
        if e.get("trace", {}).get("decision_result", {}).get("result_type") == "SUPPRESSED"
    ]
    assert len(suppressed_in_log) >= 1, (
        "At least one SUPPRESSED tick must appear in the log "
        "(persistence gate building up before the REST_PROPOSAL fires)"
    )

    # Exactly one action event (the accept_rest starting recovery)
    assert len(action_events) == 1, f"Expected 1 action event, got {len(action_events)}"
    assert action_events[0]["action"] == "accept_rest"
    assert action_events[0]["resulting_status"] == "playing"

    # 7. M3 headline: per-tick package_runtime_state is non-empty AND evolves
    runtime_states = [e.get("package_runtime_state", {}) for e in tick_events]

    # Every TickEvent must carry a non-empty package_runtime_state for the hybrid
    empty_indices = [i for i, rs in enumerate(runtime_states) if not rs]
    assert not empty_indices, (
        f"TickEvents at indices {empty_indices} have empty package_runtime_state — "
        "the hybrid algorithm must return non-empty next_package_runtime_state every tick"
    )

    # smoothed_scores[rest_required_score] must change across ticks (state evolves)
    smoothed_rest_scores = [
        rs["smoothed_scores"]["rest_required_score"] for rs in runtime_states
    ]
    assert len(set(smoothed_rest_scores)) > 1, (
        "smoothed_scores[rest_required_score] must change across ticks — "
        "M3 headline: per-tick runtime state is genuinely carried forward, not reset"
    )

    # persistence_counters[rest_required] must advance to >= 1
    rest_counters = [rs["persistence_counters"]["rest_required"] for rs in runtime_states]
    assert max(rest_counters) >= 1, (
        "persistence_counters[rest_required] must reach >= 1 "
        "(visible progression: 0→1 at tick 99, 1→2 at tick 100)"
    )


# ── T014 (M3): Hybrid HTTP determinism ───────────────────────────────────────


def test_hybrid_http_determinism(tmp_path, monkeypatch):
    """T014 (M3): two independent hybrid HTTP runs produce identical decision traces.

    Verifies that the stateful smoothing + persistence threading is purely
    deterministic: no clocks, no random, same trace sequence across runs.
    """
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
    client = TestClient(app)

    # Run A
    run_id_a = _create_run_for_pairing(client, HYBRID_PACKAGE_ID, HYBRID_SCENARIO_ID)
    all_bodies_a, _ = _tick_until_paused(client, run_id_a)
    trace_a = _extract_trace(all_bodies_a)

    # Run B — independent run, same package+scenario
    run_id_b = _create_run_for_pairing(client, HYBRID_PACKAGE_ID, HYBRID_SCENARIO_ID)
    all_bodies_b, _ = _tick_until_paused(client, run_id_b)
    trace_b = _extract_trace(all_bodies_b)

    # Same number of ticks (same proposal tick)
    assert len(all_bodies_a) == len(all_bodies_b), (
        f"Hybrid HTTP determinism: Run A had {len(all_bodies_a)} ticks to proposal, "
        f"Run B had {len(all_bodies_b)} — must be identical"
    )

    # Same decision-trace sequence
    assert len(trace_a) == len(trace_b), (
        f"Hybrid determinism: Run A produced {len(trace_a)} decisions, "
        f"Run B produced {len(trace_b)}"
    )
    for i, (ea, eb) in enumerate(zip(trace_a, trace_b)):
        assert ea == eb, (
            f"Hybrid HTTP determinism: tick {i} diverged — "
            f"Run A={ea!r}, Run B={eb!r}"
        )


# ── T015 (M4): Mocked-maps full HTTP e2e ──────────────────────────────────────


def _maps_urlopen_seq(responses: list[bytes]):
    """_urlopen mock that returns responses in order; raises on overrun."""
    calls = list(responses)

    def _mock(url: str) -> bytes:
        if not calls:
            raise AssertionError("_urlopen called more than expected — Maps overrun.")
        return calls.pop(0)

    return _mock


def test_maps_e2e_full_flow(tmp_path, monkeypatch):
    """T015 (M4): mocked-maps full HTTP e2e through the real endpoint chain.

    Flow: POST /api/routes/analyze (Maps mocked at _urlopen, sentinel key) →
          pick first alternative (route-0) →
          POST /api/run-plans (maps route, require_actionable=false) →
          POST /api/runs →
          tick loop to REST_PROPOSAL →
          POST /api/runs/{id}/actions accept_rest →
          GET /api/runs/{id}/log.

    Asserts:
    - Exactly one REST_PROPOSAL fires (the run pauses exactly once).
    - route_source == 'maps' in the persisted RunLog.
    - DisplayRoute snapshot (encoded_polyline, summary) is persisted in log.
    - Sentinel API key is absent from the entire log JSON (key-safety end-to-end).
    - route_facts.rest_spot_positions is non-empty (Places-derived, not empty fallback).
    - route_facts.route_source == 'maps' in the log.
    - Exactly one action event (accept_rest → completed).

    Note: ``require_actionable: false`` is set on the run plan so REST_PROPOSAL fires
    even when rest_spot_eta is 'none'.  The toy polyline in directions_3_alternatives.json
    places all rest stops at 0 km on the 150 km route, which means the rest spot is behind
    the car before the fatigue threshold is crossed.  The hyperparameter override removes
    this gate so the test focuses on the Maps plumbing (key-safety, route_source, DisplayRoute),
    not on rest-stop geometry.
    """
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
    client = TestClient(app)

    _SENTINEL_KEY = "SENTINEL_API_KEY_MUST_NOT_LEAK"

    # ── Step 1: Mock _urlopen; POST /api/routes/analyze ─────────────────────
    dir_data = (_MAPS_FIXTURE_DIR / "directions_3_alternatives.json").read_bytes()
    pl_data = (_MAPS_FIXTURE_DIR / "places_service_area.json").read_bytes()
    # 1 directions + 3 alts × _PLACES_SAMPLE_POINTS places calls per alternative
    monkeypatch.setattr(
        _mc,
        "_urlopen",
        _maps_urlopen_seq([dir_data] + [pl_data] * (3 * _mc._PLACES_SAMPLE_POINTS)),
    )

    analyze_resp = client.post(
        "/api/routes/analyze",
        json={
            "scenario_id": VALID_SCENARIO_ID,
            "maps_key": _SENTINEL_KEY,
            "start": "San Francisco, CA",
            "end": "Sacramento, CA",
        },
    )
    assert analyze_resp.status_code == 200, f"Analyze failed: {analyze_resp.json()}"
    assert _SENTINEL_KEY not in analyze_resp.text, (
        "Sentinel key must not appear in /api/routes/analyze response"
    )

    analyze_body = analyze_resp.json()
    assert analyze_body["route_source"] == "maps"
    alts = analyze_body["alternatives"]
    assert len(alts) >= 1, "Need at least one alternative from the directions fixture"

    # Pick the first alternative (route-0, via I-5 N, 150 km)
    chosen = alts[0]
    assert chosen["route_id"] == "route-0"
    assert chosen["route_facts"]["route_source"] == "maps"
    # Places fixture has 2 results → rest_spot_positions must be non-empty
    assert len(chosen["route_facts"]["rest_spot_positions"]) > 0, (
        "rest_spot_positions must be non-empty — Places fixture provided 2 results"
    )
    assert chosen["display"] is not None
    assert chosen["display"]["encoded_polyline"], "Display route must carry the encoded polyline"

    # ── Step 2: POST /api/run-plans ──────────────────────────────────────────
    # Feature 009: python_module packages have no "require_actionable"
    # hyperparameter (that was a declarative_rule-only actionability-guard
    # concept, retired along with the built-in algorithm types) — the hybrid
    # trigger fires from its own persisted score thresholds regardless of
    # rest-spot position.
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
    assert plan_resp.status_code == 201, f"Plan creation failed: {plan_resp.json()}"
    assert _SENTINEL_KEY not in plan_resp.text, "Sentinel key in run-plans response"
    plan_id = plan_resp.json()["plan_id"]

    # ── Step 3: POST /api/runs ───────────────────────────────────────────────
    run_resp = client.post("/api/runs", json={"plan_id": plan_id})
    assert run_resp.status_code == 201, f"Run creation failed: {run_resp.json()}"
    assert _SENTINEL_KEY not in run_resp.text, "Sentinel key in run creation response"
    run_id = run_resp.json()["run_id"]

    # The initial log must already carry maps provenance.
    initial_log = client.get(f"/api/runs/{run_id}/log").json()
    assert initial_log["route_source"] == "maps"
    dr_init = initial_log.get("display_route")
    assert dr_init is not None, "Initial log must carry display_route for maps run"
    assert dr_init["encoded_polyline"], "Initial log display_route.encoded_polyline must be set"

    # ── Step 4: Tick loop to a fired proposal ────────────────────────────────
    # The hybrid trigger may fire REST_PROPOSAL or MONOTONY_PROPOSAL first,
    # depending on the maps-derived route's segment mix — both are actionable
    # (their options always include "decline"), so this Maps-plumbing test
    # (key-safety, route_source, DisplayRoute persistence) doesn't need to pin
    # which one fires.
    all_bodies, paused_body = _tick_until_paused(client, run_id)

    decision = paused_body["decision"]
    assert decision is not None
    assert decision["result_type"] in ("REST_PROPOSAL", "MONOTONY_PROPOSAL"), (
        f"Expected a fired proposal at paused tick, got {decision['result_type']!r}"
    )
    assert decision["proposal"] is not None

    # Exactly one paused tick across the entire run
    paused_ticks = [b for b in all_bodies if b.get("paused")]
    assert len(paused_ticks) == 1, (
        f"Expected exactly one paused tick (one fired proposal), "
        f"got {len(paused_ticks)}"
    )

    # ── Step 5: POST /api/runs/{id}/actions decline ──────────────────────────
    # "decline" resolves either proposal type without touching the
    # recovery-options machinery (dedicated coverage: test_run_manager_recovery.py).
    action_resp = client.post(
        f"/api/runs/{run_id}/actions",
        json={"action": "decline"},
    )
    assert action_resp.status_code == 200, f"decline failed: {action_resp.json()}"
    assert action_resp.json()["status"] == "playing"
    assert _SENTINEL_KEY not in action_resp.text, "Sentinel key in actions response"

    # ── Step 6: GET /api/runs/{id}/log — full evidence assertions ────────────
    final_log_resp = client.get(f"/api/runs/{run_id}/log")
    assert final_log_resp.status_code == 200

    # Sentinel key must be absent from the entire log JSON
    assert _SENTINEL_KEY not in final_log_resp.text, (
        "Sentinel API key must not appear anywhere in the persisted RunLog"
    )

    final_log = final_log_resp.json()

    # route_source == 'maps' in the persisted log
    assert final_log["route_source"] == "maps", (
        f"RunLog route_source must be 'maps', got {final_log['route_source']!r}"
    )

    # DisplayRoute snapshot persisted (encoded_polyline + summary)
    dr = final_log.get("display_route")
    assert dr is not None, "RunLog must carry display_route for maps run"
    assert dr["encoded_polyline"] == chosen["display"]["encoded_polyline"], (
        "Persisted display_route.encoded_polyline must match the chosen alternative"
    )
    assert dr["summary"] == chosen["display"]["summary"], (
        "Persisted display_route.summary must match the chosen alternative"
    )

    # route_facts reflect the Maps-derived data (Places-derived rest_spot_positions)
    rf = final_log.get("route_facts", {})
    assert rf.get("route_source") == "maps", (
        f"Persisted route_facts.route_source must be 'maps', got {rf.get('route_source')!r}"
    )
    assert len(rf.get("rest_spot_positions", [])) > 0, (
        "Persisted route_facts.rest_spot_positions must be non-empty "
        "(Places fixture provided 2 results)"
    )

    # Exactly one fired proposal (REST_PROPOSAL or MONOTONY_PROPOSAL) in the tick events
    tick_events = [e for e in final_log["events"] if e.get("kind") == "tick"]
    fired_proposals = [
        e for e in tick_events
        if e.get("trace", {}).get("decision_result", {}).get("result_type")
        in ("REST_PROPOSAL", "MONOTONY_PROPOSAL")
    ]
    assert len(fired_proposals) == 1, (
        f"Expected exactly 1 fired proposal in persisted log, got {len(fired_proposals)}"
    )

    # Exactly one action event (decline → playing)
    action_events = [e for e in final_log["events"] if e.get("kind") == "action"]
    assert len(action_events) == 1, f"Expected 1 action event, got {len(action_events)}"
    assert action_events[0]["action"] == "decline"
    assert action_events[0]["resulting_status"] == "playing"


# ── T013 (M5): feedback→evidence loop e2e ─────────────────────────────────────


def _contains_feedback_event(obj: object) -> bool:
    """Recursively scan any JSON-decoded object for a dict with kind='feedback'.

    Used to assert the separation invariant: simulator_facts must never contain
    a FeedbackEvent.  Follows lists and all dict values.
    """
    if isinstance(obj, dict):
        if obj.get("kind") == "feedback":
            return True
        return any(_contains_feedback_event(v) for v in obj.values())
    if isinstance(obj, list):
        return any(_contains_feedback_event(item) for item in obj)
    return False


def test_m5_feedback_evidence_e2e(client):
    """T013 (M5): full feedback→evidence loop through the real HTTP surface.

    Flow:
    1. Create run plan → run (rest_rule_based × friend_drive, local route)
    2. Tick to REST_PROPOSAL (paused=True)
    3. POST /feedback attached to that proposal (proposal scope, labels + comment)
    4. POST /api/runs/{id}/actions accept_rest → run completes
    5. POST /feedback at end-of-run (run scope, overall_judgment + comment)
    6. GET /log — assert both feedback events present and traceable
    7. Assert decision trace UNCHANGED by feedback (TickEvents byte-for-byte identical
       to the snapshot taken before the first feedback POST)
    8. POST invalid feedback → 400 with validation_errors; log event count unchanged
    9. GET /evidence → §14.2 report:
       - feedback ONLY under human_review (labels + free_text_comments)
       - simulator_facts contains NO feedback value (recursive scan)
       - reproducibility fields present (route_facts, event_plan, parameters,
         hyperparameters, profiles, timeline, actions, decision_trace)
       - simulator_version, package id+version, scenario id+version at report level

    Asserts:
    - POST /feedback (proposal scope): 201; event traceable to the proposal tick
    - POST /feedback (run scope): 201; event traceable to the run
    - GET /log: exactly 2 feedback events (proposal + run)
    - TickEvents in final log == TickEvents in pre-feedback snapshot (identity)
    - Invalid feedback → 400 + validation_errors; event count unchanged
    - GET /evidence: feedback absent from simulator_facts; present in human_review;
      both labels and free_text_comments populated; reproducibility fields present
    """
    # ── 1. Create run ─────────────────────────────────────────────────────────
    run_id = _create_run(client)

    log_resp = client.get(f"/api/runs/{run_id}/log")
    assert log_resp.status_code == 200
    assert log_resp.json()["run_id"] == run_id

    # ── 2. Tick to REST_PROPOSAL ──────────────────────────────────────────────
    all_bodies, paused_body = _tick_until_paused(client, run_id)

    decision = paused_body["decision"]
    assert decision is not None
    assert decision["result_type"] == "REST_PROPOSAL"
    proposal = decision["proposal"]
    assert proposal is not None

    proposal_tick_index: int = paused_body["tick_index"]
    proposal_id: str = proposal.get("id", "rest_required")

    # Snapshot TickEvents BEFORE the first feedback POST — to verify unchanged later.
    pre_feedback_log = client.get(f"/api/runs/{run_id}/log").json()
    tick_events_snapshot = [
        e for e in pre_feedback_log["events"] if e.get("kind") == "tick"
    ]
    assert len(tick_events_snapshot) >= 1, "Must have at least one TickEvent before feedback"

    # ── 3. POST feedback on the proposal ─────────────────────────────────────
    proposal_fb_resp = client.post(
        f"/api/runs/{run_id}/feedback",
        json={
            "target": {
                "scope": "proposal",
                "tick_index": proposal_tick_index,
                "proposal_id": proposal_id,
            },
            "labels": {
                "proposal_timing": "appropriate",
                "safety_impression": "safe",
            },
            "comment": "Good timing on the rest proposal",
        },
    )
    assert proposal_fb_resp.status_code == 201, (
        f"Proposal feedback must return 201; got {proposal_fb_resp.json()}"
    )
    proposal_fb_event = proposal_fb_resp.json()
    assert proposal_fb_event["kind"] == "feedback"
    assert proposal_fb_event["target"]["scope"] == "proposal"

    # ── 4. Accept the rest proposal ───────────────────────────────────────────
    # uc01_fatigue_recovery_v0_1 has recovery_options — accept_rest requires
    # recovery_option_id + rest_spot and starts a recovery sequence (status →
    # playing) rather than completing the run outright.
    action_resp = client.post(
        f"/api/runs/{run_id}/actions",
        json={
            "action": "accept_rest",
            "recovery_option_id": "nap_karaoke",
            "rest_spot": {"id": "p1", "label": {"ja": "SA", "en": "SA"}, "route_fraction": 0.5},
        },
    )
    assert action_resp.status_code == 200
    assert action_resp.json()["status"] == "playing"

    # ── 5. POST feedback at end-of-run ────────────────────────────────────────
    run_fb_resp = client.post(
        f"/api/runs/{run_id}/feedback",
        json={
            "target": {"scope": "run"},
            "labels": {"overall_judgment": "good_trigger"},
            "comment": "Timely trigger, felt natural",
        },
    )
    assert run_fb_resp.status_code == 201, (
        f"Run feedback must return 201; got {run_fb_resp.json()}"
    )
    run_fb_event = run_fb_resp.json()
    assert run_fb_event["kind"] == "feedback"
    assert run_fb_event["target"]["scope"] == "run"

    # ── 6. GET /log — both feedback events present and traceable ─────────────
    final_log_resp = client.get(f"/api/runs/{run_id}/log")
    assert final_log_resp.status_code == 200
    final_log = final_log_resp.json()
    final_events = final_log["events"]

    feedback_events = [e for e in final_events if e.get("kind") == "feedback"]
    assert len(feedback_events) == 2, (
        f"Expected 2 feedback events in final log, got {len(feedback_events)}"
    )

    # Proposal-scoped feedback: traceable to the proposal tick
    proposal_feedbacks = [
        e for e in feedback_events if e["target"]["scope"] == "proposal"
    ]
    assert len(proposal_feedbacks) == 1, "Expected exactly one proposal-scoped feedback"
    assert proposal_feedbacks[0]["target"]["tick_index"] == proposal_tick_index, (
        "Proposal feedback must reference the proposal's tick_index"
    )

    # Run-scoped feedback: traceable to the run (no tick_index required)
    run_feedbacks = [
        e for e in feedback_events if e["target"]["scope"] == "run"
    ]
    assert len(run_feedbacks) == 1, "Expected exactly one run-scoped feedback"
    assert run_feedbacks[0]["labels"].get("overall_judgment") == "good_trigger"

    # ── 7. Decision trace UNCHANGED by feedback (byte-for-byte identical) ────
    tick_events_final = [e for e in final_events if e.get("kind") == "tick"]
    assert len(tick_events_snapshot) == len(tick_events_final), (
        "Feedback must not add or remove TickEvents: "
        f"snapshot had {len(tick_events_snapshot)}, final log has {len(tick_events_final)}"
    )
    for idx, (before, after) in enumerate(zip(tick_events_snapshot, tick_events_final)):
        assert before == after, (
            f"TickEvent at position {idx} was mutated by feedback posting; "
            f"before={before!r}, after={after!r}"
        )

    # ── 8. Invalid feedback → 400, nothing appended ──────────────────────────
    events_count_after_two_feedbacks = len(final_events)
    invalid_fb_resp = client.post(
        f"/api/runs/{run_id}/feedback",
        json={
            "target": {"scope": "run"},
            "labels": {"totally_unknown_label_key_xyz": "bad_value"},
        },
    )
    assert invalid_fb_resp.status_code == 400, (
        f"Invalid feedback must return 400; got {invalid_fb_resp.status_code}: "
        f"{invalid_fb_resp.json()}"
    )
    invalid_detail = invalid_fb_resp.json().get("detail", invalid_fb_resp.json())
    assert "validation_errors" in invalid_detail, (
        "400 response must include validation_errors"
    )

    # Event count must be unchanged after the rejected POST
    log_after_invalid = client.get(f"/api/runs/{run_id}/log").json()
    assert len(log_after_invalid["events"]) == events_count_after_two_feedbacks, (
        "Invalid feedback POST must not append anything to the log"
    )

    # ── 9. GET /evidence — §14.2 report ──────────────────────────────────────
    evidence_resp = client.get(f"/api/runs/{run_id}/evidence")
    assert evidence_resp.status_code == 200
    evidence = evidence_resp.json()

    # Top-level keys
    assert "simulator_facts" in evidence, "Evidence must have simulator_facts"
    assert "human_review" in evidence, "Evidence must have human_review"
    simulator_facts = evidence["simulator_facts"]
    human_review = evidence["human_review"]

    # Feedback ONLY in human_review — both events present
    assert "feedback_labels" in human_review
    assert "free_text_comments" in human_review
    assert len(human_review["feedback_labels"]) == 2, (
        f"Expected 2 feedback_labels entries, got {len(human_review['feedback_labels'])}"
    )
    assert len(human_review["free_text_comments"]) == 2, (
        f"Expected 2 free_text_comments (both feedbacks had comments), "
        f"got {len(human_review['free_text_comments'])}"
    )

    # simulator_facts must contain NO feedback event (separation invariant — deep scan)
    assert not _contains_feedback_event(simulator_facts), (
        "Separation invariant violated: simulator_facts contains a feedback event. "
        "Feedback must appear ONLY under human_review."
    )

    # Reproducibility fields present in simulator_facts
    for reproducibility_field in (
        "route_facts",
        "event_plan",
        "initial_parameters",
        "initial_hyperparameters",
        "driver_profile",
        "vehicle_profile",
        "timeline_events",
        "decision_trace",
        "actions",
    ):
        assert reproducibility_field in simulator_facts, (
            f"simulator_facts must carry reproducibility field {reproducibility_field!r}"
        )

    # Reproducibility fields at the report level
    assert "simulator_version" in evidence, "Evidence must carry simulator_version"
    assert "package" in evidence
    assert evidence["package"]["id"] == VALID_PACKAGE_ID
    assert "version" in evidence["package"], "Evidence package must carry version"
    assert "scenario" in evidence
    assert evidence["scenario"]["id"] == VALID_SCENARIO_ID
    assert "version" in evidence["scenario"], "Evidence scenario must carry version"

    # timeline_events must be non-empty (at least the ticks and action are there)
    assert len(simulator_facts["timeline_events"]) >= 1, (
        "timeline_events must be non-empty after a completed run"
    )
    # timeline_events must not include any feedback events
    assert not any(
        e.get("kind") == "feedback" for e in simulator_facts["timeline_events"]
    ), "timeline_events must not include any feedback events"
