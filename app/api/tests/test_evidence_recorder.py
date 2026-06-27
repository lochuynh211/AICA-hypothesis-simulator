"""TDD evidence_recorder tests (T017) — RED then GREEN.

Tests for EvidenceRecorder: writes run log to runs/<run_id>.json (via
file_store) on init and appends events, persisting after every append;
prior events are never mutated; required snapshot fields present.
"""

from __future__ import annotations

import json
import pathlib

import pytest

from aica_api.models.log import ActionEvent, AlgorithmError, RunLog, TickEvent
from aica_api.models.run import (
    ArtifactRef,
    EventPlan,
    RouteFacts,
    RunStatus,
    Snapshot,
    TickPlanEntry,
    TickState,
)
from aica_api.models.decision import (
    Candidate,
    DecisionResult,
    FireControl,
    ResultType,
)
from aica_api.models.log import TraceEntry
from aica_api.storage.evidence_recorder import EvidenceRecorder


# ---------------------------------------------------------------------------
# Shared fixtures / helpers
# ---------------------------------------------------------------------------

_SNAPSHOT = Snapshot(
    package=ArtifactRef(id="pkg_test", version="0.1.0", hash="abc123"),
    scenario=ArtifactRef(id="sc_test", version="0.1.0", hash="def456"),
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


def _make_run_log(run_id: str = "test_run_001") -> RunLog:
    return RunLog(
        run_id=run_id,
        created_at="2026-01-01T00:00:00Z",
        simulator_version="0.1.0",
        snapshot=_SNAPSHOT,
        route_facts=_ROUTE_FACTS,
        event_plan=_EVENT_PLAN,
        events=[],
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


def _make_decision_result() -> DecisionResult:
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
        fire_control=FireControl(
            fired=False, suppressed=False, override=False, reason="below_reaction_point"
        ),
        proposal=None,
        reason_inputs=["drowsiness_level"],
        explanation="No trigger.",
        next_package_runtime_state={},
    )


# ---------------------------------------------------------------------------
# Initialization — writes file on creation
# ---------------------------------------------------------------------------


def test_recorder_creates_file_on_init(tmp_path):
    log = _make_run_log("run_init_test")
    recorder = EvidenceRecorder(log, tmp_path)
    log_file = tmp_path / "run_init_test.json"
    assert log_file.exists()


def test_recorder_initial_file_is_valid_json(tmp_path):
    log = _make_run_log("run_json_test")
    recorder = EvidenceRecorder(log, tmp_path)
    data = json.loads((tmp_path / "run_json_test.json").read_text(encoding="utf-8"))
    assert data["run_id"] == "run_json_test"


def test_recorder_initial_events_empty(tmp_path):
    log = _make_run_log("run_empty_events")
    recorder = EvidenceRecorder(log, tmp_path)
    data = json.loads((tmp_path / "run_empty_events.json").read_text(encoding="utf-8"))
    assert data["events"] == []


def test_recorder_snapshot_fields_present(tmp_path):
    log = _make_run_log("run_snapshot_test")
    recorder = EvidenceRecorder(log, tmp_path)
    data = json.loads((tmp_path / "run_snapshot_test.json").read_text(encoding="utf-8"))
    assert "snapshot" in data
    assert data["snapshot"]["package"]["id"] == "pkg_test"
    assert data["snapshot"]["scenario"]["id"] == "sc_test"


# ---------------------------------------------------------------------------
# Appending TickEvent
# ---------------------------------------------------------------------------


def test_append_tick_event_increments_event_count(tmp_path):
    log = _make_run_log("run_tick_evt")
    recorder = EvidenceRecorder(log, tmp_path)

    ts = _make_tick_state(0)
    dr = _make_decision_result()
    trace = TraceEntry(tick_index=0, decision_result=dr)
    event = TickEvent(kind="tick", tick_index=0, tick_state=ts, trace=trace)

    recorder.append(event)

    data = json.loads((tmp_path / "run_tick_evt.json").read_text(encoding="utf-8"))
    assert len(data["events"]) == 1
    assert data["events"][0]["kind"] == "tick"


def test_append_tick_event_persisted_immediately(tmp_path):
    """After append, the file on disk already contains the event."""
    log = _make_run_log("run_immediate_persist")
    recorder = EvidenceRecorder(log, tmp_path)

    ts = _make_tick_state(0)
    dr = _make_decision_result()
    trace = TraceEntry(tick_index=0, decision_result=dr)
    event = TickEvent(kind="tick", tick_index=0, tick_state=ts, trace=trace)

    recorder.append(event)

    # Read from disk — should already reflect the append
    raw = (tmp_path / "run_immediate_persist.json").read_text(encoding="utf-8")
    data = json.loads(raw)
    assert len(data["events"]) == 1


def test_multiple_tick_events_appended_in_order(tmp_path):
    log = _make_run_log("run_multi_tick")
    recorder = EvidenceRecorder(log, tmp_path)

    for i in range(3):
        ts = _make_tick_state(i)
        dr = _make_decision_result()
        trace = TraceEntry(tick_index=i, decision_result=dr)
        event = TickEvent(kind="tick", tick_index=i, tick_state=ts, trace=trace)
        recorder.append(event)

    data = json.loads((tmp_path / "run_multi_tick.json").read_text(encoding="utf-8"))
    assert len(data["events"]) == 3
    for i, ev in enumerate(data["events"]):
        assert ev["tick_index"] == i


# ---------------------------------------------------------------------------
# Appending ActionEvent
# ---------------------------------------------------------------------------


def test_append_action_event(tmp_path):
    log = _make_run_log("run_action_evt")
    recorder = EvidenceRecorder(log, tmp_path)

    event = ActionEvent(
        kind="action",
        tick_index=5,
        action="accept_rest",
        resulting_status="completed",
    )
    recorder.append(event)

    data = json.loads((tmp_path / "run_action_evt.json").read_text(encoding="utf-8"))
    assert len(data["events"]) == 1
    assert data["events"][0]["kind"] == "action"
    assert data["events"][0]["action"] == "accept_rest"


# ---------------------------------------------------------------------------
# Appending AlgorithmError
# ---------------------------------------------------------------------------


def test_append_algorithm_error_event(tmp_path):
    log = _make_run_log("run_algo_err")
    recorder = EvidenceRecorder(log, tmp_path)

    event = AlgorithmError(
        kind="algorithm_error",
        tick_index=2,
        error_type="algorithm_exception",
        message="Something went wrong.",
    )
    recorder.append(event)

    data = json.loads((tmp_path / "run_algo_err.json").read_text(encoding="utf-8"))
    assert len(data["events"]) == 1
    assert data["events"][0]["kind"] == "algorithm_error"
    assert data["events"][0]["error_type"] == "algorithm_exception"


# ---------------------------------------------------------------------------
# Prior events are never rewritten (append-only guarantee)
# ---------------------------------------------------------------------------


def test_prior_events_not_mutated(tmp_path):
    """Appending a second event does not change the content of the first."""
    log = _make_run_log("run_immutable")
    recorder = EvidenceRecorder(log, tmp_path)

    ts0 = _make_tick_state(0)
    dr0 = _make_decision_result()
    trace0 = TraceEntry(tick_index=0, decision_result=dr0)
    evt0 = TickEvent(kind="tick", tick_index=0, tick_state=ts0, trace=trace0)
    recorder.append(evt0)

    # Snapshot what event[0] looks like on disk
    data_before = json.loads(
        (tmp_path / "run_immutable.json").read_text(encoding="utf-8")
    )
    event_0_before = data_before["events"][0]

    # Append a second event
    evt_action = ActionEvent(
        kind="action",
        tick_index=0,
        action="postpone",
        resulting_status="playing",
    )
    recorder.append(evt_action)

    data_after = json.loads(
        (tmp_path / "run_immutable.json").read_text(encoding="utf-8")
    )
    # Event[0] must be identical
    assert data_after["events"][0] == event_0_before
    # Total events now 2
    assert len(data_after["events"]) == 2


# ---------------------------------------------------------------------------
# run_log property exposes the in-memory log
# ---------------------------------------------------------------------------


def test_run_log_property_accessible(tmp_path):
    log = _make_run_log("run_prop")
    recorder = EvidenceRecorder(log, tmp_path)
    assert recorder.run_log is log


def test_run_log_property_updated_after_append(tmp_path):
    log = _make_run_log("run_prop_upd")
    recorder = EvidenceRecorder(log, tmp_path)

    evt = ActionEvent(
        kind="action",
        tick_index=0,
        action="accept_rest",
        resulting_status="completed",
    )
    recorder.append(evt)

    assert len(recorder.run_log.events) == 1
