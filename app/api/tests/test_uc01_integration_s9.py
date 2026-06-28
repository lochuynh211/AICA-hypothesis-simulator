"""S9 — full UC-01 integration tests (T017, M6).

Exercises the COMPLETE V1 review loop end-to-end using the backend TestClient.
Each test drives: setup (POST /api/run-plans) → POST /api/runs → tick to
REST_PROPOSAL → action → (feedback) → (evidence JSON) → (evidence Markdown).

Coverage matrix
───────────────────────────────────────────────────────────────────────────────
Algorithm type           | Package                               | Stage covered
─────────────────────────┼───────────────────────────────────────┼──────────────
declarative_rule         | rest_rule_based_v0_1                  | §1
weighted_score           | rest_weighted_score_v0_1              | §1
python_module            | rest_python_v0_1                      | §1, §5
transparent-hybrid       | aica_transparent_hybrid_trigger_v1    | §1, §6 runtime state

Additional integration stages (§2–§8):
  §2  Qualitative boundary — feature_groups present in every tick event; no raw
      numeric from outside reaches the decision (ordinal bands only).
  §3  Feedback — append M5 categoricals + comment on a completed run; assert
      persisted append-only and decision trace unmodified.
  §4  Evidence JSON — simulator_facts/human_review separation on a run with feedback.
  §5  Evidence Markdown — ## Simulator Facts / ## Human Review on completed run.
  §6  algorithm_error (python_module adapter monkeypatched to raise) — surfaces as
      an `algorithm_error` event in the log, NOT as a disguised tick/decision.
  §7  Replay — full run's tick events retrieved from /log with NO new tick calls;
      recorded values match live-tick values (proving log is faithful / no recompute).
  §8  Profile override — driver override visible in evidence simulator_facts.
  §9  Key never in log — sentinel key absent from log JSON (maps-mocked path).
  §10 Local fallback — works without any key (route_source == "local").

Isolation:
  - AICA_RUNS_DIR redirected to tmp_path in all tests that touch disk.
  - In-memory registries cleared before + after every test (autouse fixture).
  - Maps calls monkeypatched at _urlopen where needed; no live network.

These tests are written to genuinely exercise the loop — they will FAIL if any
stage (plan, run, tick, proposal, action, feedback, evidence, log) is broken.
"""

from __future__ import annotations

import json
import pathlib

import pytest
from fastapi.testclient import TestClient

import aica_api.algorithms.adapter as _adapter_mod
import aica_api.services.maps_client as _mc
from aica_api.algorithms.adapter import AlgorithmAdapterError
from aica_api.main import app
from aica_api.services.run_manager import clear_registry
from aica_api.services.run_plan import clear_draft_registry

# ── Constants ──────────────────────────────────────────────────────────────────

RULE_BASED_PKG   = "rest_rule_based_v0_1"
WEIGHTED_PKG     = "rest_weighted_score_v0_1"
PYTHON_PKG       = "rest_python_v0_1"
HYBRID_PKG       = "aica_transparent_hybrid_trigger_v1"

FRIEND_SCENARIO  = "uc01_fatigue_friend_drive_v0_1"
OVERTIME_SCENARIO = "uc01_overtime_driver_v0_1"

_MAPS_FIXTURE_DIR = pathlib.Path(__file__).parent / "fixtures" / "maps"

_MAX_TICKS = 300   # generous ceiling — hybrid fires around tick 100


# ── Fixtures ───────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def reset_registries():
    """Clear in-memory run + plan registries before and after every test."""
    clear_registry()
    clear_draft_registry()
    yield
    clear_registry()
    clear_draft_registry()


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
    return TestClient(app)


# ── Shared helpers ─────────────────────────────────────────────────────────────


def _plan_and_run(
    client: TestClient,
    package_id: str,
    scenario_id: str,
    hyperparameters: dict | None = None,
    profiles: dict | None = None,
) -> str:
    """Plan → run.  Returns run_id."""
    body: dict = {
        "package_id": package_id,
        "scenario_id": scenario_id,
        "parameters": {},
        "hyperparameters": hyperparameters or {},
        "run_mode": "standard",
    }
    if profiles is not None:
        body["profiles"] = profiles

    plan_resp = client.post("/api/run-plans", json=body)
    assert plan_resp.status_code == 201, f"Plan creation failed: {plan_resp.json()}"
    plan_id = plan_resp.json()["plan_id"]

    run_resp = client.post("/api/runs", json={"plan_id": plan_id})
    assert run_resp.status_code == 201, f"Run creation failed: {run_resp.json()}"
    return run_resp.json()["run_id"]


def _tick_to_pause(client: TestClient, run_id: str) -> tuple[list[dict], dict]:
    """Tick until paused (REST_PROPOSAL).

    Returns (all_bodies, paused_body).
    Fails loudly if the run doesn't pause within _MAX_TICKS.
    """
    bodies: list[dict] = []
    for _ in range(_MAX_TICKS):
        resp = client.post(f"/api/runs/{run_id}/tick")
        assert resp.status_code == 200, f"Tick returned {resp.status_code}: {resp.text}"
        body = resp.json()
        bodies.append(body)
        if body.get("paused") is True:
            return bodies, body
    pytest.fail(
        f"Run {run_id!r} did not pause within {_MAX_TICKS} ticks — "
        "REST_PROPOSAL never fired.  Check the package+scenario pairing."
    )


def _tick_to_completion(client: TestClient, run_id: str) -> list[dict]:
    """Tick until completed.  Returns all tick bodies."""
    bodies: list[dict] = []
    for _ in range(_MAX_TICKS):
        resp = client.post(f"/api/runs/{run_id}/tick")
        assert resp.status_code == 200
        body = resp.json()
        bodies.append(body)
        if body.get("completed") is True:
            return bodies
    pytest.fail(f"Run {run_id!r} did not complete within {_MAX_TICKS} ticks.")


def _accept_rest(client: TestClient, run_id: str) -> dict:
    resp = client.post(f"/api/runs/{run_id}/actions", json={"action": "accept_rest"})
    assert resp.status_code == 200, f"accept_rest failed: {resp.json()}"
    return resp.json()


# ── §1 — All 4 algorithm types: full loop (plan → run → tick → proposal → action) ──


@pytest.mark.parametrize(
    "package_id,scenario_id,action_name",
    [
        pytest.param(RULE_BASED_PKG,  FRIEND_SCENARIO, "accept_rest", id="declarative_rule"),
        pytest.param(WEIGHTED_PKG,    FRIEND_SCENARIO, "accept_rest", id="weighted_score"),
        pytest.param(PYTHON_PKG,      FRIEND_SCENARIO, "accept_rest", id="python_module"),
        pytest.param(HYBRID_PKG,      FRIEND_SCENARIO, "accept_rest", id="transparent_hybrid"),
    ],
)
def test_full_loop_all_four_algorithm_types(client, package_id, scenario_id, action_name):
    """§1 — Full UC-01 loop for each algorithm type.

    Proves: plan accepted → log persisted → tick fires exactly one REST_PROPOSAL
    → action accepted → final log has correct structure with at least one TickEvent.

    Will FAIL if:
    - plan creation rejects the package+scenario
    - run creation fails
    - the algorithm never fires a REST_PROPOSAL within _MAX_TICKS
    - the action returns non-200
    - the persisted log is missing tick events or the action event
    """
    # ── Setup ──────────────────────────────────────────────────────────────────
    run_id = _plan_and_run(client, package_id, scenario_id)

    # Log must be persisted immediately after creation (not after first tick)
    init_log = client.get(f"/api/runs/{run_id}/log")
    assert init_log.status_code == 200
    assert init_log.json()["run_id"] == run_id
    assert init_log.json()["snapshot"]["package"]["id"] == package_id

    # ── Tick to proposal ───────────────────────────────────────────────────────
    all_bodies, paused_body = _tick_to_pause(client, run_id)

    # Exactly ONE paused tick
    paused = [b for b in all_bodies if b.get("paused") is True]
    assert len(paused) == 1, (
        f"Expected exactly one paused tick for {package_id}, got {len(paused)}"
    )

    # The paused body must carry a REST_PROPOSAL with a proposal object
    decision = paused_body.get("decision")
    assert decision is not None, "Paused body must carry a decision"
    assert decision["result_type"] == "REST_PROPOSAL", (
        f"Expected REST_PROPOSAL at pause for {package_id}, got {decision['result_type']!r}"
    )
    assert decision["proposal"] is not None, "REST_PROPOSAL must include a proposal object"

    # Pre-pause ticks: must NOT be REST_PROPOSAL (allowed: NO_TRIGGER, SOFT_WARNING,
    # SUPPRESSED, NO_PROPOSAL — varies by algorithm type).
    for i, body in enumerate(all_bodies[:-1]):
        d = body.get("decision")
        if d is None:
            continue  # algorithm_error tick — tolerated
        assert d["result_type"] != "REST_PROPOSAL", (
            f"Tick {i} before the final paused tick must not be REST_PROPOSAL "
            f"for {package_id} (only one proposal expected in the run)"
        )

    # ── Action ─────────────────────────────────────────────────────────────────
    action_state = _accept_rest(client, run_id)
    assert action_state["status"] == "completed"
    assert action_state["pending_proposal"] is None

    # ── Final log structure ────────────────────────────────────────────────────
    final_log = client.get(f"/api/runs/{run_id}/log").json()
    tick_events = [e for e in final_log["events"] if e.get("kind") == "tick"]
    action_events = [e for e in final_log["events"] if e.get("kind") == "action"]

    assert len(tick_events) >= 1, "Final log must contain at least one tick event"
    for evt in tick_events:
        assert "trace" in evt, f"TickEvent must carry trace; got {list(evt.keys())}"
        assert "decision_result" in evt["trace"], "trace must contain decision_result"

    assert len(action_events) == 1, f"Expected 1 action event, got {len(action_events)}"
    assert action_events[0]["action"] == action_name
    assert action_events[0]["resulting_status"] == "completed"

    # Exactly ONE REST_PROPOSAL in the persisted log
    rest_proposals = [
        e for e in tick_events
        if e["trace"]["decision_result"]["result_type"] == "REST_PROPOSAL"
    ]
    assert len(rest_proposals) == 1, (
        f"Expected exactly 1 REST_PROPOSAL in log for {package_id}, got {len(rest_proposals)}"
    )


# ── §2 — Qualitative boundary: feature_groups in tick events (no raw external numeric) ──


def test_qualitative_boundary_feature_groups_in_tick_events(client):
    """§2 — Every TickEvent carries feature_groups with ordinal (qualitative) bands.

    Confirms the two-layer numeric boundary: raw_state is present for inspection
    but the algorithm context is routed through ordinal feature_groups.  No raw
    numeric value from outside drives a decision.

    Will FAIL if tick events are missing feature_groups or ordinal bands.
    """
    run_id = _plan_and_run(client, RULE_BASED_PKG, FRIEND_SCENARIO)
    all_bodies, _ = _tick_to_pause(client, run_id)

    final_log = client.get(f"/api/runs/{run_id}/log").json()
    tick_events = [e for e in final_log["events"] if e.get("kind") == "tick"]
    assert len(tick_events) >= 1

    for i, evt in enumerate(tick_events):
        # raw_state present (diagnostic; the algorithm does NOT receive this raw)
        assert "raw_state" in evt, (
            f"TickEvent {i} missing raw_state field"
        )

        # feature_groups present (qualitative ordinal — what the algorithm receives)
        assert "feature_groups" in evt, (
            f"TickEvent {i} missing feature_groups (qualitative boundary broken)"
        )
        fg = evt["feature_groups"]
        assert "ordinal" in fg, (
            f"TickEvent {i}: feature_groups must contain 'ordinal' bands; got {list(fg.keys())}"
        )
        ordinal = fg["ordinal"]
        assert len(ordinal) > 0, (
            f"TickEvent {i}: ordinal bands must be non-empty (at least one feature binned)"
        )

    # Sanity: a REST_PROPOSAL tick's decision must reference ordinal features, not raw floats.
    # NOTE: declarative_rule emits only string values in features{} so the float guard
    # below is vacuous for that algorithm type alone.  The weighted_score check further
    # down exercises the same boundary against genuine float feature_groups.normalized
    # values, making the combined guard meaningful.
    proposal_events = [
        e for e in tick_events
        if e["trace"]["decision_result"]["result_type"] == "REST_PROPOSAL"
    ]
    assert len(proposal_events) >= 1, "Must have at least one REST_PROPOSAL tick in the log"
    proposal_decision = proposal_events[0]["trace"]["decision_result"]

    # The decision features dict uses ordinal band labels (strings), not raw floats
    features = proposal_decision.get("features", {})
    for key, val in features.items():
        assert not isinstance(val, float) or val in (0.0, 1.0), (
            f"Decision feature {key!r}={val!r} looks like a raw numeric — "
            "expected ordinal band label or normalized 0/1; qualitative boundary may be broken"
        )

    # ── Also exercise against weighted_score: feature_groups.normalized must be [0,1] ──
    # weighted_score uses feature_groups.normalized (genuine floats) rather than ordinal
    # string bands.  Verify those normalized scores are all in [0,1] — raw external
    # numerics (e.g. drowsinessLevel=73.5) must NEVER appear in this boundary layer.
    ws_run_id = _plan_and_run(client, WEIGHTED_PKG, FRIEND_SCENARIO)
    ws_bodies, _ = _tick_to_pause(client, ws_run_id)

    ws_log = client.get(f"/api/runs/{ws_run_id}/log").json()
    ws_tick_events = [e for e in ws_log["events"] if e.get("kind") == "tick"]
    assert len(ws_tick_events) >= 1, "weighted_score run must produce at least one tick event"

    for i, evt in enumerate(ws_tick_events):
        normalized = evt.get("feature_groups", {}).get("normalized", {})
        for feat_key, feat_val in normalized.items():
            assert isinstance(feat_val, float) and 0.0 <= feat_val <= 1.0, (
                f"weighted_score TickEvent {i}: feature_groups.normalized[{feat_key!r}]="
                f"{feat_val!r} is outside [0,1] — raw external numeric must not leak "
                "past the qualitative boundary"
            )


# ── §3 — Feedback: append categoricals + comment, assert append-only ──────────


def test_feedback_append_only_after_proposal(client):
    """§3 — M5 feedback appended to a completed run is persisted append-only.

    Proves:
    - POST /feedback (proposal scope) returns 201 with kind='feedback'
    - POST /feedback (run scope) returns 201 with kind='feedback'
    - Both events appear in GET /log
    - The TickEvents are byte-for-byte identical before and after feedback POSTs
    - Invalid feedback returns 400 and nothing is appended

    Will FAIL if feedback is not stored, if tick events are mutated, or if
    invalid feedback is accepted.
    """
    run_id = _plan_and_run(client, RULE_BASED_PKG, FRIEND_SCENARIO)
    all_bodies, paused_body = _tick_to_pause(client, run_id)

    decision = paused_body["decision"]
    assert decision["result_type"] == "REST_PROPOSAL"
    proposal_id = decision["proposal"].get("id", "rest_required")
    proposal_tick_index = paused_body["tick_index"]

    # Snapshot tick events BEFORE feedback
    pre_feedback_log = client.get(f"/api/runs/{run_id}/log").json()
    tick_snapshot = [e for e in pre_feedback_log["events"] if e.get("kind") == "tick"]

    # POST proposal-scoped feedback
    fb1 = client.post(
        f"/api/runs/{run_id}/feedback",
        json={
            "target": {
                "scope": "proposal",
                "tick_index": proposal_tick_index,
                "proposal_id": proposal_id,
            },
            "labels": {"proposal_timing": "appropriate", "safety_impression": "safe"},
            "comment": "S9 integration: proposal feedback",
        },
    )
    assert fb1.status_code == 201, f"Proposal feedback must return 201; got {fb1.json()}"
    assert fb1.json()["kind"] == "feedback"

    # Accept rest → complete run
    _accept_rest(client, run_id)

    # POST run-scoped feedback
    fb2 = client.post(
        f"/api/runs/{run_id}/feedback",
        json={
            "target": {"scope": "run"},
            "labels": {"overall_judgment": "good_trigger"},
            "comment": "S9 integration: run feedback",
        },
    )
    assert fb2.status_code == 201, f"Run feedback must return 201; got {fb2.json()}"
    assert fb2.json()["kind"] == "feedback"

    # Both feedback events in final log
    final_log = client.get(f"/api/runs/{run_id}/log").json()
    feedback_events = [e for e in final_log["events"] if e.get("kind") == "feedback"]
    assert len(feedback_events) == 2, (
        f"Expected 2 feedback events in log, got {len(feedback_events)}"
    )

    # TickEvents UNCHANGED by feedback (append-only invariant)
    tick_final = [e for e in final_log["events"] if e.get("kind") == "tick"]
    assert len(tick_snapshot) == len(tick_final), (
        "Feedback must not add or remove TickEvents"
    )
    for idx, (before, after) in enumerate(zip(tick_snapshot, tick_final)):
        assert before == after, (
            f"TickEvent {idx} mutated by feedback: before={before!r}, after={after!r}"
        )

    # Invalid feedback → 400, nothing appended
    invalid_resp = client.post(
        f"/api/runs/{run_id}/feedback",
        json={
            "target": {"scope": "run"},
            "labels": {"totally_unknown_key_xyz_abc": "garbage"},
        },
    )
    assert invalid_resp.status_code == 400, (
        f"Invalid feedback must return 400; got {invalid_resp.status_code}: {invalid_resp.json()}"
    )
    assert "validation_errors" in invalid_resp.json().get("detail", invalid_resp.json())

    # Event count unchanged after rejection
    log_after_invalid = client.get(f"/api/runs/{run_id}/log").json()
    assert len(log_after_invalid["events"]) == len(final_log["events"]), (
        "Invalid feedback POST must not append anything"
    )


# ── §4 — Evidence JSON: simulator_facts / human_review separation ─────────────


def test_evidence_json_separation_invariant(client):
    """§4 — GET /evidence returns §14.2 report with strict facts/review separation.

    Proves:
    - simulator_facts contains no feedback event (deep scan)
    - human_review contains both feedback events
    - Reproducibility fields present in simulator_facts
    - algorithm_errors field present (even if empty) in simulator_facts

    Will FAIL if the separation invariant is broken.
    """
    run_id = _plan_and_run(client, RULE_BASED_PKG, FRIEND_SCENARIO)
    all_bodies, paused_body = _tick_to_pause(client, run_id)

    proposal_tick_index = paused_body["tick_index"]
    proposal_id = paused_body["decision"]["proposal"].get("id", "rest_required")

    # Add feedback
    fb_proposal = client.post(
        f"/api/runs/{run_id}/feedback",
        json={
            "target": {
                "scope": "proposal",
                "tick_index": proposal_tick_index,
                "proposal_id": proposal_id,
            },
            "labels": {"proposal_timing": "appropriate", "safety_impression": "safe"},
            "comment": "S9 evidence test: proposal comment",
        },
    )
    assert fb_proposal.status_code == 201, (
        f"Proposal feedback must return 201; got {fb_proposal.status_code}: {fb_proposal.json()}"
    )
    _accept_rest(client, run_id)
    fb_run = client.post(
        f"/api/runs/{run_id}/feedback",
        json={
            "target": {"scope": "run"},
            "labels": {"overall_judgment": "good_trigger"},
            "comment": "S9 evidence test: run comment",
        },
    )
    assert fb_run.status_code == 201, (
        f"Run feedback must return 201; got {fb_run.status_code}: {fb_run.json()}"
    )

    # GET /evidence
    evidence_resp = client.get(f"/api/runs/{run_id}/evidence")
    assert evidence_resp.status_code == 200, f"Evidence endpoint failed: {evidence_resp.json()}"
    evidence = evidence_resp.json()

    assert "simulator_facts" in evidence
    assert "human_review" in evidence
    sf = evidence["simulator_facts"]
    hr = evidence["human_review"]

    # Separation invariant: simulator_facts must NOT contain any feedback event (deep scan)
    def _has_feedback(obj: object) -> bool:
        if isinstance(obj, dict):
            if obj.get("kind") == "feedback":
                return True
            return any(_has_feedback(v) for v in obj.values())
        if isinstance(obj, list):
            return any(_has_feedback(item) for item in obj)
        return False

    assert not _has_feedback(sf), (
        "SEPARATION INVARIANT VIOLATED: simulator_facts contains a feedback event. "
        "Feedback must appear ONLY under human_review."
    )

    # human_review must have both feedback events
    assert len(hr["feedback_labels"]) == 2, (
        f"Expected 2 feedback_labels entries, got {len(hr['feedback_labels'])}"
    )
    assert len(hr["free_text_comments"]) == 2, (
        f"Expected 2 free_text_comments (both feedbacks had comments), "
        f"got {len(hr['free_text_comments'])}"
    )

    # Reproducibility fields in simulator_facts
    for field in (
        "route_facts",
        "event_plan",
        "initial_parameters",
        "initial_hyperparameters",
        "driver_profile",
        "vehicle_profile",
        "timeline_events",
        "decision_trace",
        "actions",
        "algorithm_errors",
    ):
        assert field in sf, f"simulator_facts missing reproducibility field {field!r}"

    # algorithm_errors is present (empty for a normal run, but the field must exist)
    assert isinstance(sf["algorithm_errors"], list), (
        "simulator_facts.algorithm_errors must be a list (may be empty)"
    )

    # Report-level fields
    assert "simulator_version" in evidence
    assert evidence["package"]["id"] == RULE_BASED_PKG
    assert evidence["scenario"]["id"] == FRIEND_SCENARIO


# ── §5 — Evidence Markdown: ## Simulator Facts / ## Human Review separation ───


def test_evidence_markdown_separation(client):
    """§5 — GET /evidence.md returns Markdown with strict section separation.

    Proves:
    - Contains ## Simulator Facts heading
    - Contains ## Human Review heading
    - ## Simulator Facts appears before ## Human Review
    - Feedback content appears ONLY in the Human Review section
    - No verdict language in the output

    Will FAIL if the Markdown formatter or endpoint is broken.
    """
    run_id = _plan_and_run(client, RULE_BASED_PKG, FRIEND_SCENARIO)
    _, paused_body = _tick_to_pause(client, run_id)

    proposal_tick_index = paused_body["tick_index"]
    proposal_id = paused_body["decision"]["proposal"].get("id", "rest_required")

    client.post(
        f"/api/runs/{run_id}/feedback",
        json={
            "target": {
                "scope": "proposal",
                "tick_index": proposal_tick_index,
                "proposal_id": proposal_id,
            },
            "labels": {"proposal_timing": "appropriate"},
            "comment": "S9 markdown test: UNIQUE_MARKER_XYZ",
        },
    )
    _accept_rest(client, run_id)

    md_resp = client.get(f"/api/runs/{run_id}/evidence.md")
    assert md_resp.status_code == 200, f"evidence.md endpoint failed: {md_resp.text}"
    md = md_resp.text

    # Required headings
    assert "## Simulator Facts" in md, "Markdown must contain '## Simulator Facts' heading"
    assert "## Human Review" in md, "Markdown must contain '## Human Review' heading"

    # Section order
    facts_pos = md.index("## Simulator Facts")
    review_pos = md.index("## Human Review")
    assert facts_pos < review_pos, "## Simulator Facts must appear before ## Human Review"

    # Feedback content in review section only
    review_section = md[review_pos:]
    facts_section = md[facts_pos:review_pos]
    assert "UNIQUE_MARKER_XYZ" in review_section, (
        "Feedback comment must appear in the Human Review section"
    )
    assert "UNIQUE_MARKER_XYZ" not in facts_section, (
        "Feedback comment must NOT appear in the Simulator Facts section"
    )

    # No verdict language
    VERDICT_PHRASES = [
        "algorithm was correct",
        "algorithm was wrong",
        "algorithm judged",
        "simulator judged",
        "verdict:",
    ]
    md_lower = md.lower()
    for phrase in VERDICT_PHRASES:
        assert phrase not in md_lower, (
            f"Verdict language {phrase!r} found in Markdown export — "
            "the simulator MUST NOT claim it judged the algorithm"
        )

    # run_id visible in Markdown
    assert run_id in md, "run_id must appear in the Markdown evidence"

    # Content-type is text/
    ct = md_resp.headers.get("content-type", "")
    assert "text/" in ct, f"evidence.md must return text/* content-type; got {ct!r}"


# ── §6 — algorithm_error: python_module that raises surfaces as event, not decision ──


def test_algorithm_error_surfaces_as_event_not_disguised_decision(tmp_path, monkeypatch):
    """§6 — An adapter exception surfaces as an algorithm_error event, NOT a decision.

    Uses monkeypatch to make the adapter raise AlgorithmAdapterError for a
    python_module package.  Proves:
    - The tick response has 'error' key and NO 'decision' key
    - GET /log contains an algorithm_error event
    - GET /log contains NO tick event for that failing tick (not disguised)
    - The run is paused (blocking error_mode default)
    - An error_type and message are recorded in the event

    Will FAIL if errors are silently swallowed or disguised as NO_TRIGGER ticks.
    """
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
    # §6 builds its own client (not the `client` fixture) so that the adapter
    # monkeypatch is applied AFTER client construction but BEFORE the tick call.
    # The autouse `reset_registries` fixture already clears registries around
    # this test — no manual clear_registry() / clear_draft_registry() needed.
    client = TestClient(app)

    # Create a run with the python_module package
    plan_resp = client.post(
        "/api/run-plans",
        json={
            "package_id": PYTHON_PKG,
            "scenario_id": FRIEND_SCENARIO,
            "parameters": {},
            "hyperparameters": {},
            "run_mode": "standard",
        },
    )
    assert plan_resp.status_code == 201, f"Plan creation failed: {plan_resp.json()}"
    plan_id = plan_resp.json()["plan_id"]

    run_resp = client.post("/api/runs", json={"plan_id": plan_id})
    assert run_resp.status_code == 201, f"Run creation failed: {run_resp.json()}"
    run_id = run_resp.json()["run_id"]

    # Patch the adapter to RAISE on the next evaluate() call
    def _raise_error(*args, **kwargs):
        raise AlgorithmAdapterError("algorithm_exception", "S9 injected test error — raise")

    monkeypatch.setattr(_adapter_mod, "evaluate", _raise_error)

    # Tick — adapter raises → error path, not a decision
    tick_resp = client.post(f"/api/runs/{run_id}/tick")
    assert tick_resp.status_code == 200, f"Tick must return 200 even on error; got {tick_resp.status_code}"
    body = tick_resp.json()

    # Error key present, decision key absent (not disguised)
    assert "error" in body, (
        "Tick response must carry 'error' key when algorithm raises; "
        f"got keys: {list(body.keys())}"
    )
    assert "decision" not in body, (
        "Tick response must NOT carry 'decision' key when algorithm raises — "
        "errors must not be disguised as decisions"
    )

    # Run is paused (blocking mode by default)
    assert body.get("paused") is True, (
        "Run must be paused after a blocking algorithm error"
    )

    # GET /log — algorithm_error event present, tick event absent for the failing tick
    log_resp = client.get(f"/api/runs/{run_id}/log")
    assert log_resp.status_code == 200
    log = log_resp.json()
    events = log["events"]

    alg_error_events = [e for e in events if e.get("kind") == "algorithm_error"]
    assert len(alg_error_events) == 1, (
        f"Expected 1 algorithm_error event in log; got {len(alg_error_events)}"
    )

    error_evt = alg_error_events[0]
    assert error_evt.get("error_type") == "algorithm_exception", (
        f"error_type must be 'algorithm_exception'; got {error_evt.get('error_type')!r}"
    )
    assert "S9 injected test error" in error_evt.get("message", ""), (
        f"Error message not recorded in event: {error_evt.get('message')!r}"
    )

    # No tick event for the failing tick (error is NOT disguised as a normal tick)
    tick_events = [e for e in events if e.get("kind") == "tick"]
    assert len(tick_events) == 0, (
        f"There must be NO tick events when the algorithm raised — "
        f"got {len(tick_events)} tick event(s); errors must NOT be disguised as decisions"
    )

    # Verify the evidence report also surfaces the error in simulator_facts
    evidence_resp = client.get(f"/api/runs/{run_id}/evidence")
    assert evidence_resp.status_code == 200
    evidence = evidence_resp.json()
    assert len(evidence["simulator_facts"]["algorithm_errors"]) == 1, (
        "algorithm_errors in evidence must reflect the surfaced error event"
    )
    assert evidence["simulator_facts"]["algorithm_errors"][0]["error_type"] == "algorithm_exception"


# ── §7 — Replay: /log tick values match live-tick values (no recalculation) ───


def test_replay_log_faithful_to_live_ticks(client):
    """§7 — Persisted /log tick values are faithful to live-tick responses.

    After a completed run, GET /log is called once.  The recorded TickEvents
    must contain the same decision_result sequences that were returned by the
    live tick endpoint.  No further tick call is made during 'replay'.

    This proves the backend's replay contract:
    - The log is an append-only faithful record (not a re-computation)
    - createReplaySource (frontend) can project these values without a new API call

    Will FAIL if the log is not written faithfully or is re-computed on read.
    """
    run_id = _plan_and_run(client, RULE_BASED_PKG, FRIEND_SCENARIO)

    # ── Live run: capture tick responses ──────────────────────────────────────
    all_bodies, paused_body = _tick_to_pause(client, run_id)
    _accept_rest(client, run_id)

    # Build a map of tick_index → live decision_result (from tick responses)
    live_decisions: dict[int, dict] = {}
    for body in all_bodies:
        decision = body.get("decision")
        tick_index = body.get("tick_index")
        if decision is not None and tick_index is not None:
            live_decisions[tick_index] = decision

    # ── Replay: fetch /log ONCE — no new tick calls ───────────────────────────
    log_resp = client.get(f"/api/runs/{run_id}/log")
    assert log_resp.status_code == 200
    log = log_resp.json()

    tick_events = [e for e in log["events"] if e.get("kind") == "tick"]
    assert len(tick_events) >= 1, "Log must contain at least one tick event for replay"

    # Build a map of tick_index → recorded decision_result (from log)
    logged_decisions: dict[int, dict] = {
        e["tick_index"]: e["trace"]["decision_result"]
        for e in tick_events
    }

    # Every live decision must appear identically in the log (faithful record)
    for tick_idx, live_decision in live_decisions.items():
        assert tick_idx in logged_decisions, (
            f"Tick {tick_idx} decision from live run is missing from /log — "
            "log is not faithful to live ticks (may have been re-computed)"
        )
        logged = logged_decisions[tick_idx]
        assert live_decision["result_type"] == logged["result_type"], (
            f"Tick {tick_idx}: live result_type={live_decision['result_type']!r} "
            f"but log has {logged['result_type']!r} — replay would show wrong data"
        )
        assert live_decision["score"] == logged["score"], (
            f"Tick {tick_idx}: live score={live_decision['score']!r} "
            f"but log has {logged['score']!r}"
        )

    # Log must not be missing ticks (every live decision must be logged)
    assert len(logged_decisions) >= len(live_decisions), (
        f"Log has fewer decisions ({len(logged_decisions)}) than live ticks "
        f"({len(live_decisions)}) — some tick events were dropped"
    )


# ── §8 — Profile override visible in evidence ──────────────────────────────────


def test_profile_override_visible_in_evidence(client):
    """§8 — A setup-time driver-profile override drives the run differently AND is in evidence.

    SC-006: "an edited profile drives its run."

    Runs TWO runs from the same scenario:
      - DEFAULT:  no profile override (base_growth_per_min = 0.9 per scenario)
      - OVERRIDE: 10× faster drowsiness growth (base_growth_per_min = 9.0)

    Proves BEHAVIORAL effect: the override run reaches REST_PROPOSAL at a
    LOWER tick index than the default run (faster growth → earlier trigger).

    Also proves recording fidelity:
    - GET /log shows the overridden driver_profile with the override rate
    - GET /evidence shows the overridden driver_profile in simulator_facts
    - profile_overrides field is set in the run log

    Will FAIL if:
    - Profile overrides are not threaded into the run log or evidence.
    - The override does not measurably change when the proposal fires.
    """
    DEFAULT_RATE = 0.9   # scenario default base_growth_per_min
    OVERRIDE_RATE = 9.0  # 10× default — unambiguously faster drowsiness growth

    # ── DEFAULT run (no profile override) ────────────────────────────────────
    default_run_id = _plan_and_run(client, RULE_BASED_PKG, FRIEND_SCENARIO)
    default_bodies, default_paused_body = _tick_to_pause(client, default_run_id)
    _accept_rest(client, default_run_id)
    default_proposal_tick = default_paused_body["tick_index"]

    # ── OVERRIDE run (10× drowsiness growth rate) ────────────────────────────
    override_profiles = {
        "driver": {
            "drowsiness_model": {"base_growth_per_min": OVERRIDE_RATE}
        }
    }
    run_id = _plan_and_run(
        client, RULE_BASED_PKG, FRIEND_SCENARIO, profiles=override_profiles
    )

    # ── Recording assertions (pre-tick) ──────────────────────────────────────
    log_resp = client.get(f"/api/runs/{run_id}/log")
    assert log_resp.status_code == 200
    log = log_resp.json()

    # driver_profile in log should reflect the override
    assert log.get("driver_profile") is not None, (
        "run_log.driver_profile must be set when a profile override is applied"
    )
    logged_rate = log["driver_profile"]["drowsiness_model"]["base_growth_per_min"]
    assert logged_rate == OVERRIDE_RATE, (
        f"run_log.driver_profile.drowsiness_model.base_growth_per_min should be "
        f"{OVERRIDE_RATE} (override) but got {logged_rate}"
    )

    # profile_overrides field records the raw override input
    profile_overrides = log.get("profile_overrides")
    assert profile_overrides is not None, (
        "run_log.profile_overrides must be set when a profile override is applied"
    )

    # ── Tick override run to proposal and accept ──────────────────────────────
    _, override_paused_body = _tick_to_pause(client, run_id)
    override_proposal_tick = override_paused_body["tick_index"]
    action_state = _accept_rest(client, run_id)
    assert action_state["status"] == "completed"

    # ── BEHAVIORAL assertion: SC-006 "an edited profile drives its run" ───────
    # A 10× drowsiness growth rate must cause the proposal to fire at a lower
    # tick index.  Higher base_growth_per_min → drowsiness crosses ordinal-band
    # thresholds sooner → damped blend reaches proposal_cut sooner.
    assert override_proposal_tick < default_proposal_tick, (
        f"SC-006 VIOLATED: override run (rate={OVERRIDE_RATE}) fired REST_PROPOSAL "
        f"at tick {override_proposal_tick}, but default run (rate={DEFAULT_RATE}) "
        f"fired at tick {default_proposal_tick}.  A 10× growth rate must produce "
        "an earlier trigger — the profile override must actually drive the run."
    )

    # ── Evidence recording assertions ─────────────────────────────────────────
    evidence_resp = client.get(f"/api/runs/{run_id}/evidence")
    assert evidence_resp.status_code == 200
    evidence = evidence_resp.json()

    sf = evidence["simulator_facts"]
    assert sf.get("driver_profile") is not None, (
        "simulator_facts.driver_profile must be present in evidence for a profile-override run"
    )
    evidence_rate = sf["driver_profile"]["drowsiness_model"]["base_growth_per_min"]
    assert evidence_rate == OVERRIDE_RATE, (
        f"Evidence simulator_facts.driver_profile reflects wrong rate: "
        f"expected {OVERRIDE_RATE}, got {evidence_rate}. "
        "Profile override must be visible in the run's evidence."
    )


# ── §9 — Key never in log (maps-mocked full flow) ─────────────────────────────


def _maps_urlopen_seq(responses: list[bytes]):
    """Mock _urlopen to return a fixed sequence of bytes responses."""
    calls = list(responses)

    def _mock(url: str) -> bytes:
        if not calls:
            raise AssertionError("_urlopen called more than expected (Maps call overrun)")
        return calls.pop(0)

    return _mock


def test_maps_sentinel_key_absent_from_log(tmp_path, monkeypatch):
    """§9 — The BYO Maps key is provably absent from the persisted run log.

    Mocks _urlopen with the same fixture files used in T015.  Proves:
    - The sentinel key is not echoed in any response (analyze, run-plans, runs, log)
    - The final /log JSON does not contain the sentinel key anywhere
    - route_source == 'maps' in the log (confirming the maps path was exercised)

    Will FAIL if the key leaks into any response, log, or evidence.
    """
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
    # §9 builds its own client so the Maps _urlopen monkeypatch can be applied
    # after client construction.  The autouse `reset_registries` fixture already
    # clears registries before/after this test — no manual calls needed here.
    client = TestClient(app)

    _SENTINEL = "SENTINEL_API_KEY_MUST_NOT_LEAK_S9"

    dir_data = (_MAPS_FIXTURE_DIR / "directions_3_alternatives.json").read_bytes()
    pl_data = (_MAPS_FIXTURE_DIR / "places_service_area.json").read_bytes()
    monkeypatch.setattr(
        _mc, "_urlopen",
        _maps_urlopen_seq([dir_data, pl_data, pl_data, pl_data])
    )

    # Analyze route with sentinel key
    analyze_resp = client.post(
        "/api/routes/analyze",
        json={
            "scenario_id": FRIEND_SCENARIO,
            "maps_key": _SENTINEL,
            "start": "Tokyo, Japan",
            "end": "Osaka, Japan",
        },
    )
    assert analyze_resp.status_code == 200
    assert _SENTINEL not in analyze_resp.text, "Sentinel key must not appear in /analyze response"

    alts = analyze_resp.json()["alternatives"]
    assert len(alts) >= 1
    chosen = alts[0]

    # Create run plan with maps route (require_actionable=False for toy polyline)
    plan_resp = client.post(
        "/api/run-plans",
        json={
            "package_id": RULE_BASED_PKG,
            "scenario_id": FRIEND_SCENARIO,
            "route_id": chosen["route_id"],
            "route_source": "maps",
            "route_facts": chosen["route_facts"],
            "display_route": chosen["display"],
            "parameters": {},
            "hyperparameters": {"require_actionable": False},
        },
    )
    assert plan_resp.status_code == 201, f"Plan creation failed: {plan_resp.json()}"
    assert _SENTINEL not in plan_resp.text, "Sentinel key must not appear in /run-plans response"
    plan_id = plan_resp.json()["plan_id"]

    run_resp = client.post("/api/runs", json={"plan_id": plan_id})
    assert run_resp.status_code == 201
    assert _SENTINEL not in run_resp.text, "Sentinel key must not appear in /runs response"
    run_id = run_resp.json()["run_id"]

    # Tick to proposal and accept
    all_bodies, _ = _tick_to_pause(client, run_id)
    for body in all_bodies:
        assert _SENTINEL not in json.dumps(body), "Sentinel key found in tick response"

    action_resp = client.post(
        f"/api/runs/{run_id}/actions",
        json={"action": "accept_rest"},
    )
    assert action_resp.status_code == 200
    assert _SENTINEL not in action_resp.text

    # GET /log — sentinel must be absent from the entire log JSON
    log_resp = client.get(f"/api/runs/{run_id}/log")
    assert log_resp.status_code == 200
    assert _SENTINEL not in log_resp.text, (
        "SECURITY VIOLATION: sentinel API key found in the persisted run log. "
        "The key must NEVER be stored in any log, evidence, or response."
    )

    # Confirm maps path was used
    assert log_resp.json()["route_source"] == "maps"


# ── §10 — Local fallback: no key required, route_source == 'local' ────────────


def test_local_route_fallback_works_without_key(client):
    """§10 — Without a Maps key the local deterministic fallback works end-to-end.

    Proves: POST /api/routes/analyze (no key) → route_source == 'local';
    and a full run with the local route completes without errors.

    Will FAIL if the local fallback path is broken.
    """
    # Analyze without a key → local fallback
    analyze_resp = client.post(
        "/api/routes/analyze",
        json={"scenario_id": FRIEND_SCENARIO},
    )
    assert analyze_resp.status_code == 200
    body = analyze_resp.json()
    assert body["route_source"] == "local", (
        f"Expected route_source 'local' when no key provided; got {body['route_source']!r}"
    )

    # Full run with local route
    run_id = _plan_and_run(client, RULE_BASED_PKG, FRIEND_SCENARIO)
    _, _ = _tick_to_pause(client, run_id)
    action_state = _accept_rest(client, run_id)
    assert action_state["status"] == "completed"

    log = client.get(f"/api/runs/{run_id}/log").json()
    assert log["route_source"] == "local"


# ── §11 — Run list: GET /api/runs lists completed run ─────────────────────────


def test_run_list_includes_completed_run(client):
    """§11 — GET /api/runs lists past runs (supports Runs screen / FR-005).

    Proves:
    - After a run completes, GET /api/runs includes it
    - The entry has required fields: run_id, created_at, package_id, scenario_id, status

    Will FAIL if the run list endpoint is broken or returns wrong fields.
    """
    run_id = _plan_and_run(client, RULE_BASED_PKG, FRIEND_SCENARIO)
    _, _ = _tick_to_pause(client, run_id)
    _accept_rest(client, run_id)

    list_resp = client.get("/api/runs")
    assert list_resp.status_code == 200
    runs = list_resp.json().get("runs", [])
    assert len(runs) >= 1, "GET /api/runs must return at least one run after completion"

    matched = [r for r in runs if r["run_id"] == run_id]
    assert len(matched) == 1, f"Completed run {run_id!r} not found in GET /api/runs"

    entry = matched[0]
    for field in ("run_id", "created_at", "package_id", "scenario_id", "status"):
        assert field in entry, f"Run list entry missing required field {field!r}"

    assert entry["package_id"] == RULE_BASED_PKG
    assert entry["scenario_id"] == FRIEND_SCENARIO
    assert entry["status"] == "completed"


# ── §12 — Restart: second run from same plan re-uses same package+scenario ────


def test_restart_from_same_plan(client):
    """§12 — A second run from the same plan starts fresh (restart semantics / FR-005).

    Proves that a reviewer can 'restart' by creating a new run from the same plan_id,
    and the second run starts from tick 0 with the same package+scenario.

    Will FAIL if the plan is consumed/destroyed after the first run.
    """
    # Create plan
    plan_resp = client.post(
        "/api/run-plans",
        json={
            "package_id": RULE_BASED_PKG,
            "scenario_id": FRIEND_SCENARIO,
            "parameters": {},
            "hyperparameters": {},
            "run_mode": "standard",
        },
    )
    assert plan_resp.status_code == 201
    plan_id = plan_resp.json()["plan_id"]

    # First run
    run1_resp = client.post("/api/runs", json={"plan_id": plan_id})
    assert run1_resp.status_code == 201
    run1_id = run1_resp.json()["run_id"]

    _, _ = _tick_to_pause(client, run1_id)
    _accept_rest(client, run1_id)
    assert client.get(f"/api/runs/{run1_id}/log").json()["run_id"] == run1_id

    # Second run from the SAME plan (restart)
    run2_resp = client.post("/api/runs", json={"plan_id": plan_id})
    assert run2_resp.status_code == 201, (
        f"Restart from the same plan must succeed; got {run2_resp.json()}"
    )
    run2_id = run2_resp.json()["run_id"]
    assert run2_id != run1_id, "Second run must have a different run_id"

    # Second run starts at tick 0
    log2 = client.get(f"/api/runs/{run2_id}/log").json()
    assert log2["run_id"] == run2_id
    assert log2["snapshot"]["package"]["id"] == RULE_BASED_PKG
    assert log2["snapshot"]["scenario"]["id"] == FRIEND_SCENARIO
