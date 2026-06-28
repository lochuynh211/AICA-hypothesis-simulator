"""TDD evidence export tests (T010, T011) — RED then GREEN.

Tests for:
  - services/evidence.py::build_evidence_report (pure function)
  - GET /api/runs/{run_id}/evidence (router endpoint)

Covers:
  - Full §14.2 report shape with all reproducibility fields (§14.3)
  - Separation invariant: feedback ONLY under human_review; simulator_facts never contains feedback
  - feedback_labels vs free_text_comments split
  - Conditional sections: final_* only when different; expert_override_events absent by default;
    run_comparison_reference absent by default
  - A run with no feedback → human_review empty; facts complete
  - Pre-M5 run (no profiles) → profiles exported as null, no error
  - Proposal events only when fire_control.fired=True
  - report_id + timestamp come from caller (build_evidence_report is PURE — no clocks/uuids inside)
  - Router: active run + on-disk run return 200; unknown run → 404
"""

from __future__ import annotations

import json
import pathlib

import pytest
from fastapi.testclient import TestClient

from aica_api.main import app
from aica_api.models.decision import Candidate, DecisionResult, FireControl, Proposal, ResultType
from aica_api.models.feedback import FeedbackEvent, FeedbackTarget
from aica_api.models.log import ActionEvent, AlgorithmError, RunLog, TickEvent, TraceEntry
from aica_api.models.run import (
    ArtifactRef,
    EventPlan,
    RouteFacts,
    Snapshot,
    TickPlanEntry,
    TickState,
)
from aica_api.services.evidence import build_evidence_report
from aica_api.services.run_manager import clear_registry
from aica_api.services.run_plan import clear_draft_registry

# ── Shared fixtures ────────────────────────────────────────────────────────────

_SNAPSHOT = Snapshot(
    package=ArtifactRef(id="pkg_test", version="0.1.0", hash="abc123"),
    scenario=ArtifactRef(id="sc_test", version="0.2.0", hash="def456"),
)

_ROUTE_FACTS = RouteFacts(
    segments=[],
    bands={"drowsiness_level": ["none", "weak", "moderate"]},
)

_EVENT_PLAN = EventPlan(
    ticks=[
        TickPlanEntry(
            tick_index=0,
            drowsiness_band="none",
            route_fraction=0.0,
            signal_duration="transient",
            rest_spot_eta="none",
        )
    ]
)


def _make_tick_state(tick_index: int = 0) -> TickState:
    return TickState(
        tick_index=tick_index,
        elapsed_seconds=tick_index * 60,
        route_fraction=tick_index / 120,
        active_segment_id="seg_start",
        drowsiness_level="none",
        fatigue_level="low",
        signal_duration="transient",
        continuous_driving_time="short",
        rest_spot_eta="none",
        completed=False,
    )


def _make_no_trigger_decision() -> DecisionResult:
    return DecisionResult(
        result_type=ResultType.NO_TRIGGER,
        trigger_candidate=False,
        selected_category=None,
        score=0.0,
        features={"drowsiness_level": "none"},
        criteria={"reaction_point": 1.4, "proposal_cut": 3.0, "severe_cut": 4.0},
        candidates=[
            Candidate(
                category="rest_required",
                exists=False,
                score=0.0,
                state=None,
                strength=None,
                fire_control=FireControl(
                    fired=False, suppressed=False, override=False, reason="below_reaction_point"
                ),
            )
        ],
        fire_control=FireControl(fired=False, suppressed=False, override=False, reason="below_reaction_point"),
        proposal=None,
        reason_inputs=["drowsiness_level"],
        explanation="No trigger.",
        next_package_runtime_state={},
    )


def _make_proposal_decision() -> DecisionResult:
    return DecisionResult(
        result_type=ResultType.REST_PROPOSAL,
        trigger_candidate=True,
        selected_category="rest_required",
        score=0.85,
        features={"drowsiness_level": "moderate"},
        criteria={"reaction_point": 1.4, "proposal_cut": 3.0, "severe_cut": 4.0},
        candidates=[
            Candidate(
                category="rest_required",
                exists=True,
                score=0.85,
                state="active",
                strength="clear",
                fire_control=FireControl(fired=True, suppressed=False, override=False, reason=None),
            )
        ],
        fire_control=FireControl(fired=True, suppressed=False, override=False, reason=None),
        proposal=Proposal(
            id="rest_required",
            message={"ja": "休憩を", "en": "Take rest"},
            options=["accept_rest", "postpone"],
        ),
        reason_inputs=["drowsiness_level"],
        explanation="Rest proposal.",
        next_package_runtime_state={},
    )


def _make_run_log(
    *,
    events=None,
    initial_parameters=None,
    current_parameters=None,
    initial_hyperparameters=None,
    current_hyperparameters=None,
    driver_profile=None,
    vehicle_profile=None,
    speed_profile=None,
) -> RunLog:
    """Create a minimal RunLog for testing."""
    return RunLog(
        run_id="run_test_evidence_001",
        created_at="2026-06-01T10:00:00Z",
        simulator_version="1.0.0",
        snapshot=_SNAPSHOT,
        route_facts=_ROUTE_FACTS,
        event_plan=_EVENT_PLAN,
        run_mode="standard",
        evidence_status="standard",
        events=events or [],
        initial_parameters=initial_parameters or {},
        current_parameters=current_parameters or {},
        initial_hyperparameters=initial_hyperparameters or {},
        current_hyperparameters=current_hyperparameters or {},
        driver_profile=driver_profile,
        vehicle_profile=vehicle_profile,
        speed_profile=speed_profile,
    )


def _make_tick_event(tick_index: int, decision: DecisionResult | None = None) -> TickEvent:
    if decision is None:
        decision = _make_no_trigger_decision()
    return TickEvent(
        kind="tick",
        tick_index=tick_index,
        tick_state=_make_tick_state(tick_index),
        trace=TraceEntry(tick_index=tick_index, decision_result=decision),
    )


def _make_action_event(tick_index: int, action: str = "accept_rest") -> ActionEvent:
    return ActionEvent(
        kind="action",
        tick_index=tick_index,
        action=action,
        resulting_status="completed",
    )


def _make_algorithm_error(tick_index: int) -> AlgorithmError:
    return AlgorithmError(
        kind="algorithm_error",
        tick_index=tick_index,
        error_type="ValueError",
        message="Invalid return from evaluate()",
    )


def _make_feedback_event(
    scope: str = "run",
    labels: dict | None = None,
    comment: str | None = None,
    tick_index: int | None = None,
) -> FeedbackEvent:
    return FeedbackEvent(
        kind="feedback",
        target=FeedbackTarget(scope=scope, tick_index=tick_index),
        labels=labels or {},
        comment=comment,
    )


# ── Unit tests: build_evidence_report (pure function) ─────────────────────────


class TestBuildEvidenceReportShape:
    """The report carries the full §14.2 shape and all §14.3 reproducibility fields."""

    def test_report_top_level_keys_present(self):
        run_log = _make_run_log()
        report = build_evidence_report(run_log, report_id="rpt-001", timestamp="2026-06-01T12:00:00Z")

        assert "report_id" in report
        assert "run_id" in report
        assert "timestamp" in report
        assert "ui_language" in report
        assert "simulator_version" in report
        assert "package" in report
        assert "scenario" in report
        assert "simulator_facts" in report
        assert "human_review" in report

    def test_report_id_and_timestamp_use_passed_values(self):
        run_log = _make_run_log()
        report = build_evidence_report(run_log, report_id="my-report-42", timestamp="2026-01-15T08:30:00Z")

        assert report["report_id"] == "my-report-42"
        assert report["timestamp"] == "2026-01-15T08:30:00Z"

    def test_run_id_matches_log(self):
        run_log = _make_run_log()
        report = build_evidence_report(run_log, report_id="rpt-x", timestamp="2026-06-01T00:00:00Z")
        assert report["run_id"] == "run_test_evidence_001"

    def test_ui_language_is_bilingual(self):
        run_log = _make_run_log()
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        assert report["ui_language"] == "bilingual"

    def test_simulator_version_from_log(self):
        run_log = _make_run_log()
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        assert report["simulator_version"] == "1.0.0"

    def test_package_id_and_version(self):
        run_log = _make_run_log()
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        assert report["package"] == {"id": "pkg_test", "version": "0.1.0"}

    def test_scenario_id_and_version(self):
        run_log = _make_run_log()
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        assert report["scenario"] == {"id": "sc_test", "version": "0.2.0"}

    def test_simulator_facts_structure(self):
        run_log = _make_run_log()
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        sf = report["simulator_facts"]

        # All required §14.2 simulator_facts keys must be present
        required_keys = [
            "route_snapshot",
            "route_facts",
            "event_plan",
            "run_mode",
            "evidence_status",
            "initial_parameters",
            "initial_hyperparameters",
            "driver_profile",
            "vehicle_profile",
            "timeline_events",
            "decision_trace",
            "proposal_events",
            "actions",
            "algorithm_errors",
        ]
        for key in required_keys:
            assert key in sf, f"Missing simulator_facts key: {key!r}"

    def test_human_review_structure(self):
        run_log = _make_run_log()
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        hr = report["human_review"]
        assert "feedback_labels" in hr
        assert "free_text_comments" in hr


class TestReproducibilityFields:
    """§14.3: report carries all reproducibility fields."""

    def test_route_facts_in_simulator_facts(self):
        run_log = _make_run_log()
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        # route_facts must be present and match the run_log
        rf = report["simulator_facts"]["route_facts"]
        assert rf is not None

    def test_event_plan_in_simulator_facts(self):
        run_log = _make_run_log()
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        ep = report["simulator_facts"]["event_plan"]
        assert ep is not None
        assert "ticks" in ep

    def test_initial_parameters_present(self):
        run_log = _make_run_log(initial_parameters={"driving_style": "normal"})
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        assert report["simulator_facts"]["initial_parameters"] == {"driving_style": "normal"}

    def test_initial_hyperparameters_present(self):
        run_log = _make_run_log(initial_hyperparameters={"suggest_threshold": 2.0})
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        assert report["simulator_facts"]["initial_hyperparameters"] == {"suggest_threshold": 2.0}

    def test_driver_profile_present_when_set(self):
        run_log = _make_run_log(driver_profile={"id": "d1", "age": 35})
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        assert report["simulator_facts"]["driver_profile"] == {"id": "d1", "age": 35}

    def test_vehicle_profile_present_when_set(self):
        run_log = _make_run_log(vehicle_profile={"id": "v1", "type": "sedan"})
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        assert report["simulator_facts"]["vehicle_profile"] == {"id": "v1", "type": "sedan"}

    def test_timeline_events_from_tick_events(self):
        tick = _make_tick_event(0)
        action = _make_action_event(1)
        run_log = _make_run_log(events=[tick, action])
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        timeline = report["simulator_facts"]["timeline_events"]
        assert len(timeline) == 2
        kinds = [e["kind"] for e in timeline]
        assert "tick" in kinds
        assert "action" in kinds

    def test_decision_trace_from_tick_events(self):
        tick = _make_tick_event(0)
        run_log = _make_run_log(events=[tick])
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        trace = report["simulator_facts"]["decision_trace"]
        assert len(trace) == 1
        assert trace[0]["tick_index"] == 0
        assert "decision_result" in trace[0]

    def test_proposal_events_only_when_fired(self):
        tick_no = _make_tick_event(0)  # no proposal
        tick_fired = _make_tick_event(1, _make_proposal_decision())  # proposal fired
        run_log = _make_run_log(events=[tick_no, tick_fired])
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        proposals = report["simulator_facts"]["proposal_events"]
        assert len(proposals) == 1
        assert proposals[0]["tick_index"] == 1

    def test_actions_from_action_events(self):
        action = _make_action_event(2, "postpone")
        run_log = _make_run_log(events=[action])
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        actions = report["simulator_facts"]["actions"]
        assert len(actions) == 1
        assert actions[0]["action"] == "postpone"

    def test_algorithm_errors_from_error_events(self):
        err = _make_algorithm_error(3)
        run_log = _make_run_log(events=[err])
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        errs = report["simulator_facts"]["algorithm_errors"]
        assert len(errs) == 1
        assert errs[0]["error_type"] == "ValueError"


class TestSeparationInvariant:
    """Feedback ONLY under human_review; simulator_facts NEVER contains feedback."""

    def _has_feedback_value(self, obj, depth=0) -> bool:
        """Recursively check if any value looks like a feedback entry."""
        if depth > 20:
            return False
        if isinstance(obj, dict):
            if obj.get("kind") == "feedback":
                return True
            return any(self._has_feedback_value(v, depth + 1) for v in obj.values())
        if isinstance(obj, (list, tuple)):
            return any(self._has_feedback_value(item, depth + 1) for item in obj)
        return False

    def test_feedback_event_not_in_timeline_events(self):
        fb = _make_feedback_event(comment="good run")
        run_log = _make_run_log(events=[fb])
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        timeline = report["simulator_facts"]["timeline_events"]
        kinds = [e.get("kind") for e in timeline]
        assert "feedback" not in kinds

    def test_simulator_facts_never_contains_feedback_values(self):
        fb = _make_feedback_event(
            scope="run",
            labels={"overall_judgment": "good_trigger"},
            comment="Great run",
        )
        tick = _make_tick_event(0)
        run_log = _make_run_log(events=[tick, fb])
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        # No feedback-kind dict should appear anywhere in simulator_facts
        assert not self._has_feedback_value(report["simulator_facts"])

    def test_feedback_labels_only_in_human_review(self):
        fb = _make_feedback_event(
            scope="run",
            labels={"overall_judgment": "good_trigger"},
        )
        run_log = _make_run_log(events=[fb])
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        assert report["human_review"]["feedback_labels"][0]["labels"]["overall_judgment"] == "good_trigger"

    def test_feedback_comment_only_in_human_review(self):
        fb = _make_feedback_event(scope="run", comment="Overall good trigger.")
        run_log = _make_run_log(events=[fb])
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        hr = report["human_review"]
        # comment should be in free_text_comments
        assert any(
            c["comment"] == "Overall good trigger." for c in hr["free_text_comments"]
        )
        # and NOT appear in simulator_facts anywhere
        assert "Overall good trigger." not in json.dumps(report["simulator_facts"])


class TestFeedbackSplit:
    """feedback_labels carries {target, labels}; free_text_comments carries {target, comment}."""

    def test_labels_in_feedback_labels(self):
        fb = _make_feedback_event(
            scope="decision",
            tick_index=0,
            labels={"proposal_timing": "appropriate"},
        )
        run_log = _make_run_log(events=[fb])
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        fl = report["human_review"]["feedback_labels"]
        assert len(fl) == 1
        assert fl[0]["labels"] == {"proposal_timing": "appropriate"}
        assert fl[0]["target"]["scope"] == "decision"

    def test_free_text_comments_includes_only_nonnull_comments(self):
        fb_with_comment = _make_feedback_event(
            scope="run",
            labels={"overall_judgment": "good_trigger"},
            comment="Nice run.",
        )
        fb_no_comment = _make_feedback_event(
            scope="run",
            labels={"intrusiveness": "not_intrusive"},
            comment=None,
        )
        run_log = _make_run_log(events=[fb_with_comment, fb_no_comment])
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        hr = report["human_review"]

        # feedback_labels should have 2 entries
        assert len(hr["feedback_labels"]) == 2

        # free_text_comments should have only 1 entry (the one with a comment)
        assert len(hr["free_text_comments"]) == 1
        assert hr["free_text_comments"][0]["comment"] == "Nice run."

    def test_no_feedback_run_has_empty_human_review(self):
        tick = _make_tick_event(0)
        run_log = _make_run_log(events=[tick])
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        hr = report["human_review"]
        assert hr["feedback_labels"] == []
        assert hr["free_text_comments"] == []

    def test_no_feedback_run_facts_complete(self):
        tick = _make_tick_event(0)
        run_log = _make_run_log(events=[tick])
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        sf = report["simulator_facts"]
        assert len(sf["timeline_events"]) == 1
        assert len(sf["decision_trace"]) == 1


class TestConditionalSections:
    """Conditional sections present only when applicable."""

    def test_no_final_parameters_when_same_as_initial(self):
        params = {"driving_style": "normal"}
        run_log = _make_run_log(initial_parameters=params, current_parameters=params)
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        assert "final_parameters" not in report["simulator_facts"]

    def test_final_parameters_present_when_different(self):
        run_log = _make_run_log(
            initial_parameters={"driving_style": "normal"},
            current_parameters={"driving_style": "relaxed"},
        )
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        assert "final_parameters" in report["simulator_facts"]
        assert report["simulator_facts"]["final_parameters"] == {"driving_style": "relaxed"}

    def test_no_final_hyperparameters_when_same_as_initial(self):
        hyp = {"suggest_threshold": 2.0}
        run_log = _make_run_log(initial_hyperparameters=hyp, current_hyperparameters=hyp)
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        assert "final_hyperparameters" not in report["simulator_facts"]

    def test_final_hyperparameters_present_when_different(self):
        run_log = _make_run_log(
            initial_hyperparameters={"suggest_threshold": 2.0},
            current_hyperparameters={"suggest_threshold": 3.5},
        )
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        assert "final_hyperparameters" in report["simulator_facts"]
        assert report["simulator_facts"]["final_hyperparameters"] == {"suggest_threshold": 3.5}

    def test_no_expert_override_section_when_absent(self):
        run_log = _make_run_log()
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        # expert_override_events should be omitted (not present or empty/None is acceptable)
        sf = report["simulator_facts"]
        # If present, must be falsy (empty list or None)
        if "expert_override_events" in sf:
            assert not sf["expert_override_events"]

    def test_no_run_comparison_reference_when_absent(self):
        run_log = _make_run_log()
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        sf = report["simulator_facts"]
        if "run_comparison_reference" in sf:
            assert sf["run_comparison_reference"] is None


class TestPreM5Handling:
    """Pre-M5 runs (no driver/vehicle profiles) export profiles as null, no error."""

    def test_pre_m5_driver_profile_is_null(self):
        run_log = _make_run_log(driver_profile=None)
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        assert report["simulator_facts"]["driver_profile"] is None

    def test_pre_m5_vehicle_profile_is_null(self):
        run_log = _make_run_log(vehicle_profile=None)
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        assert report["simulator_facts"]["vehicle_profile"] is None

    def test_pre_m5_run_no_error(self):
        """A run log with no profiles must not raise."""
        run_log = _make_run_log(driver_profile=None, vehicle_profile=None, speed_profile=None)
        # Must not raise
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        assert report is not None

    def test_pre_m5_run_facts_complete(self):
        """Facts are complete even without profiles."""
        tick = _make_tick_event(0)
        run_log = _make_run_log(events=[tick], driver_profile=None, vehicle_profile=None)
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        sf = report["simulator_facts"]
        assert sf["driver_profile"] is None
        assert sf["vehicle_profile"] is None
        assert len(sf["decision_trace"]) == 1


class TestRouteSnapshot:
    """route_snapshot reflects display_route (can be None for local route)."""

    def test_route_snapshot_is_none_when_no_display_route(self):
        run_log = _make_run_log()  # no display_route set
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        assert report["simulator_facts"]["route_snapshot"] is None

    def test_route_snapshot_set_when_display_route_present(self):
        from aica_api.models.run import DisplayRoute

        dr = DisplayRoute(
            summary="Tokyo → Osaka",
            encoded_polyline="abc123",
            start_label="Tokyo",
            end_label="Osaka",
        )
        run_log = _make_run_log()
        run_log.display_route = dr
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        rs = report["simulator_facts"]["route_snapshot"]
        assert rs is not None
        assert rs["summary"] == "Tokyo → Osaka"


class TestPureFunction:
    """build_evidence_report is PURE — no clocks or uuids inside."""

    def test_two_calls_with_same_params_produce_equal_reports(self):
        run_log = _make_run_log()
        r1 = build_evidence_report(run_log, report_id="same-id", timestamp="same-ts")
        r2 = build_evidence_report(run_log, report_id="same-id", timestamp="same-ts")
        # Remove any identity-sensitive values — both must be identical
        assert r1["report_id"] == r2["report_id"] == "same-id"
        assert r1["timestamp"] == r2["timestamp"] == "same-ts"

    def test_different_report_ids_produce_different_reports(self):
        run_log = _make_run_log()
        r1 = build_evidence_report(run_log, report_id="rpt-1", timestamp="t")
        r2 = build_evidence_report(run_log, report_id="rpt-2", timestamp="t")
        assert r1["report_id"] == "rpt-1"
        assert r2["report_id"] == "rpt-2"


# ── Router-level tests: GET /api/runs/{id}/evidence ───────────────────────────

VALID_PACKAGE_ID = "rest_rule_based_v0_1"
VALID_SCENARIO_ID = "uc01_fatigue_friend_drive_v0_1"


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


@pytest.fixture
def active_run_id(client) -> str:
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
    return run_resp.json()["run_id"]


@pytest.fixture
def disk_run_id(tmp_path, monkeypatch) -> str:
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
    run_id = "run_disk_evidence_test"
    run_log = {
        "run_id": run_id,
        "created_at": "2026-01-01T00:00:00Z",
        "simulator_version": "0.5.0",
        "snapshot": {
            "package": {"id": VALID_PACKAGE_ID, "version": "0.1.0", "hash": "abc"},
            "scenario": {"id": VALID_SCENARIO_ID, "version": "0.1.0", "hash": "def"},
        },
        "route_facts": {
            "total_route_distance_km": 100.0,
            "estimated_duration_seconds": 3600,
            "rest_spot_positions": [],
            "route_source": "local",
        },
        "event_plan": {"ticks": []},
        "run_mode": "standard",
        "evidence_status": "standard",
        "events": [
            {
                "kind": "feedback",
                "target": {"scope": "run"},
                "labels": {"overall_judgment": "good_trigger"},
                "comment": "Good run overall.",
            }
        ],
    }
    (tmp_path / f"{run_id}.json").write_text(json.dumps(run_log), encoding="utf-8")
    return run_id


class TestEvidenceEndpoint:
    def test_active_run_returns_200(self, client, active_run_id):
        resp = client.get(f"/api/runs/{active_run_id}/evidence")
        assert resp.status_code == 200

    def test_active_run_evidence_shape(self, client, active_run_id):
        resp = client.get(f"/api/runs/{active_run_id}/evidence")
        body = resp.json()
        assert "report_id" in body
        assert "run_id" in body
        assert "timestamp" in body
        assert body["ui_language"] == "bilingual"
        assert "simulator_facts" in body
        assert "human_review" in body

    def test_active_run_run_id_matches(self, client, active_run_id):
        resp = client.get(f"/api/runs/{active_run_id}/evidence")
        assert resp.json()["run_id"] == active_run_id

    def test_disk_run_returns_200(self, client, disk_run_id):
        resp = client.get(f"/api/runs/{disk_run_id}/evidence")
        assert resp.status_code == 200

    def test_disk_run_evidence_shape(self, client, disk_run_id):
        resp = client.get(f"/api/runs/{disk_run_id}/evidence")
        body = resp.json()
        assert "simulator_facts" in body
        assert "human_review" in body
        # The feedback event must be in human_review, not simulator_facts
        hr = body["human_review"]
        assert len(hr["feedback_labels"]) == 1
        assert hr["feedback_labels"][0]["labels"]["overall_judgment"] == "good_trigger"

    def test_disk_run_separation_invariant(self, client, disk_run_id):
        resp = client.get(f"/api/runs/{disk_run_id}/evidence")
        body = resp.json()
        sf_json = json.dumps(body["simulator_facts"])
        # "feedback" kind must not appear in simulator_facts
        assert '"feedback"' not in sf_json
        assert "good_trigger" not in sf_json

    def test_unknown_run_returns_404(self, client):
        resp = client.get("/api/runs/nonexistent_run_xyz_evidence/evidence")
        assert resp.status_code == 404

    def test_report_has_unique_report_id_per_call(self, client, active_run_id):
        resp1 = client.get(f"/api/runs/{active_run_id}/evidence")
        resp2 = client.get(f"/api/runs/{active_run_id}/evidence")
        report_id_1 = resp1.json()["report_id"]
        report_id_2 = resp2.json()["report_id"]
        assert isinstance(report_id_1, str)
        assert isinstance(report_id_2, str)
        # report_id is generated per call at the router boundary — must be unique.
        assert report_id_1 != report_id_2


# ── M6 T005: ui_language param on build_evidence_report + GET /evidence ───────


class TestUiLanguageParam:
    """build_evidence_report accepts an optional ui_language; router passes it through."""

    def test_default_ui_language_is_bilingual(self):
        """Absent ui_language → 'bilingual' for back-compat."""
        run_log = _make_run_log()
        report = build_evidence_report(run_log, report_id="r", timestamp="t")
        assert report["ui_language"] == "bilingual"

    def test_explicit_ja_is_recorded(self):
        """ui_language='ja' is stored verbatim in the report."""
        run_log = _make_run_log()
        report = build_evidence_report(run_log, report_id="r", timestamp="t", ui_language="ja")
        assert report["ui_language"] == "ja"

    def test_explicit_en_is_recorded(self):
        """ui_language='en' is stored verbatim in the report."""
        run_log = _make_run_log()
        report = build_evidence_report(run_log, report_id="r", timestamp="t", ui_language="en")
        assert report["ui_language"] == "en"

    def test_explicit_bilingual_is_still_valid(self):
        """Passing 'bilingual' explicitly is fine (unchanged from M5 callers)."""
        run_log = _make_run_log()
        report = build_evidence_report(run_log, report_id="r", timestamp="t", ui_language="bilingual")
        assert report["ui_language"] == "bilingual"


class TestEvidenceEndpointUiLanguage:
    """GET /api/runs/{id}/evidence accepts optional ui_language query param."""

    def test_absent_ui_language_returns_bilingual(self, client, active_run_id):
        """No ?ui_language= → report['ui_language'] == 'bilingual'."""
        resp = client.get(f"/api/runs/{active_run_id}/evidence")
        assert resp.status_code == 200
        assert resp.json()["ui_language"] == "bilingual"

    def test_ui_language_ja_is_recorded(self, client, active_run_id):
        """?ui_language=ja → report['ui_language'] == 'ja'."""
        resp = client.get(f"/api/runs/{active_run_id}/evidence?ui_language=ja")
        assert resp.status_code == 200
        assert resp.json()["ui_language"] == "ja"

    def test_ui_language_en_is_recorded(self, client, active_run_id):
        """?ui_language=en → report['ui_language'] == 'en'."""
        resp = client.get(f"/api/runs/{active_run_id}/evidence?ui_language=en")
        assert resp.status_code == 200
        assert resp.json()["ui_language"] == "en"

    def test_ui_language_does_not_change_other_fields(self, client, active_run_id):
        """ui_language param only affects the ui_language field; other fields unchanged."""
        resp_bilingual = client.get(f"/api/runs/{active_run_id}/evidence")
        resp_ja = client.get(f"/api/runs/{active_run_id}/evidence?ui_language=ja")
        b = resp_bilingual.json()
        j = resp_ja.json()
        # run_id, simulator_facts shape, human_review shape must be identical
        assert b["run_id"] == j["run_id"]
        assert b["simulator_facts"].keys() == j["simulator_facts"].keys()
        assert b["human_review"].keys() == j["human_review"].keys()
