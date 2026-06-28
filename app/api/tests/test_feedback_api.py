"""TDD feedback service tests (M5 T005/T006 — service level; HTTP endpoints are U3).

Tests for:
  validate(payload, schema, run_log) -> list[ValidationError]
  append_feedback(run_id, feedback_event, runs_dir) -> None
    - active run path (via run_manager registry)
    - on-disk run path (no active registry entry)
    - run-not-found error
    - NON-ALGORITHMIC: decision trace unchanged before vs after
"""
from __future__ import annotations

import json
import pathlib

import pytest

# ---------------------------------------------------------------------------
# Repo paths
# ---------------------------------------------------------------------------

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
_SCENARIO_PATH = _REPO_ROOT / "scenarios" / "uc01_fatigue_friend_drive_v0_1.json"
_PACKAGE_PATH = _REPO_ROOT / "packages" / "rest_rule_based_v0_1" / "package.json"


# ---------------------------------------------------------------------------
# Helpers: minimal RunLog construction
# ---------------------------------------------------------------------------


def _make_run_log(events=None):
    """Build a minimal RunLog for validation tests (no real run needed)."""
    from aica_api.models.log import RunLog
    from aica_api.models.run import ArtifactRef, EventPlan, RouteFacts, Snapshot

    if events is None:
        events = []
    return RunLog(
        run_id="test_validate_run",
        created_at="2026-01-01T00:00:00Z",
        simulator_version="0.1.0",
        snapshot=Snapshot(
            package=ArtifactRef(id="pkg_test", version="0.1.0", hash="abc"),
            scenario=ArtifactRef(id="sc_test", version="0.1.0", hash="def"),
        ),
        route_facts=RouteFacts(),
        event_plan=EventPlan(),
        events=events,
    )


def _make_tick_state(tick_index=0):
    from aica_api.models.run import TickState

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


def _make_no_trigger_decision():
    from aica_api.models.decision import (
        Candidate,
        DecisionResult,
        FireControl,
        ResultType,
    )

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
                    fired=False, suppressed=False, override=False, reason=None
                ),
            )
        ],
        fire_control=FireControl(
            fired=False, suppressed=False, override=False, reason=None
        ),
        proposal=None,
        reason_inputs=["drowsiness_level"],
        explanation="No trigger",
        next_package_runtime_state={},
    )


def _make_proposal_decision():
    from aica_api.models.decision import (
        Candidate,
        DecisionResult,
        FireControl,
        Proposal,
        ResultType,
    )

    return DecisionResult(
        result_type=ResultType.REST_PROPOSAL,
        trigger_candidate=True,
        selected_category="rest_required",
        score=3.5,
        features={"drowsiness_level": "moderate"},
        criteria={"reaction_point": 1.4, "proposal_cut": 3.0, "severe_cut": 4.0},
        candidates=[
            Candidate(
                category="rest_required",
                exists=True,
                score=3.5,
                state="triggered",
                strength="clear",
                fire_control=FireControl(
                    fired=True, suppressed=False, override=False, reason=None
                ),
            )
        ],
        fire_control=FireControl(
            fired=True, suppressed=False, override=False, reason=None
        ),
        proposal=Proposal(
            id="rest_proposal",
            message={"ja": "休憩を提案します", "en": "We suggest a rest"},
            options=["accept_rest", "postpone"],
        ),
        reason_inputs=["drowsiness_level"],
        explanation="Proposal fired",
        next_package_runtime_state={},
    )


def _make_tick_event(tick_index=0, decision=None):
    from aica_api.models.log import TickEvent, TraceEntry

    if decision is None:
        decision = _make_no_trigger_decision()
    return TickEvent(
        kind="tick",
        tick_index=tick_index,
        tick_state=_make_tick_state(tick_index),
        trace=TraceEntry(tick_index=tick_index, decision_result=decision),
    )


def _make_action_event(tick_index=0):
    from aica_api.models.log import ActionEvent

    return ActionEvent(
        kind="action",
        tick_index=tick_index,
        action="postpone",
        resulting_status="playing",
    )


def _make_feedback_event(scope="run", event_ref=None, labels=None, comment=None):
    from aica_api.models.feedback import FeedbackEvent, FeedbackTarget

    return FeedbackEvent(
        kind="feedback",
        target=FeedbackTarget(scope=scope, event_ref=event_ref),
        labels=labels or {},
        comment=comment,
    )


def _v1_schema():
    from aica_api.models.feedback import V1_FEEDBACK_SCHEMA

    return list(V1_FEEDBACK_SCHEMA)


# ---------------------------------------------------------------------------
# Test registry isolation (for append tests that use run_manager)
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def reset_registries():
    from aica_api.services.run_manager import clear_registry
    from aica_api.services.run_plan import clear_draft_registry

    clear_registry()
    clear_draft_registry()
    yield
    clear_registry()
    clear_draft_registry()


# ---------------------------------------------------------------------------
# T005 — validate: valid payloads
# ---------------------------------------------------------------------------


def test_validate_empty_payload_is_valid():
    """Empty labels + no comment → valid (empty error list)."""
    from aica_api.services.feedback import validate

    event = _make_feedback_event(scope="run")
    errors = validate(event, _v1_schema(), _make_run_log())
    assert errors == []


def test_validate_comment_only_is_valid():
    """Comment with no labels → valid."""
    from aica_api.services.feedback import validate

    event = _make_feedback_event(scope="run", comment="Felt rushed")
    errors = validate(event, _v1_schema(), _make_run_log())
    assert errors == []


def test_validate_full_valid_labels():
    """All-valid labels (subset of V1) → no errors."""
    from aica_api.services.feedback import validate

    labels = {
        "proposal_timing": "appropriate",
        "safety_impression": "safe",
        "overall_judgment": "good_trigger",
    }
    event = _make_feedback_event(scope="run", labels=labels, comment="Good")
    errors = validate(event, _v1_schema(), _make_run_log())
    assert errors == []


def test_validate_note_field_plain_string_is_valid():
    """Note-capable choice field with a plain option string → valid."""
    from aica_api.services.feedback import validate

    labels = {"acceptance_reason": "rest_needed"}
    event = _make_feedback_event(scope="run", labels=labels)
    errors = validate(event, _v1_schema(), _make_run_log())
    assert errors == []


def test_validate_note_field_dict_with_choice_and_note_is_valid():
    """Note-capable choice field as {choice, note} dict → valid."""
    from aica_api.services.feedback import validate

    labels = {"rejection_reason": {"choice": "bad_timing", "note": "Road works ahead"}}
    event = _make_feedback_event(scope="run", labels=labels)
    errors = validate(event, _v1_schema(), _make_run_log())
    assert errors == []


def test_validate_note_field_dict_without_note_key_is_valid():
    """Note-capable choice field as {choice} dict (no note key) → valid."""
    from aica_api.services.feedback import validate

    labels = {"acceptance_reason": {"choice": "convenient_timing"}}
    event = _make_feedback_event(scope="run", labels=labels)
    errors = validate(event, _v1_schema(), _make_run_log())
    assert errors == []


# ---------------------------------------------------------------------------
# T005 — validate: invalid label keys
# ---------------------------------------------------------------------------


def test_validate_unknown_label_key_returns_error():
    """A label key not in the effective schema → error."""
    from aica_api.services.feedback import validate

    labels = {"nonexistent_field": "some_value"}
    event = _make_feedback_event(scope="run", labels=labels)
    errors = validate(event, _v1_schema(), _make_run_log())

    assert len(errors) == 1
    assert "nonexistent_field" in errors[0].field


def test_validate_choice_value_not_in_options_returns_error():
    """A choice value not listed in FieldDef.options → error."""
    from aica_api.services.feedback import validate

    labels = {"proposal_timing": "maybe"}  # "maybe" is not a valid option
    event = _make_feedback_event(scope="run", labels=labels)
    errors = validate(event, _v1_schema(), _make_run_log())

    assert len(errors) == 1
    assert "proposal_timing" in errors[0].field


def test_validate_note_field_bad_note_type_returns_error():
    """Note value that is not a string → error."""
    from aica_api.services.feedback import validate

    labels = {"acceptance_reason": {"choice": "rest_needed", "note": 42}}
    event = _make_feedback_event(scope="run", labels=labels)
    errors = validate(event, _v1_schema(), _make_run_log())

    assert len(errors) == 1
    assert "note" in errors[0].field


def test_validate_note_field_choice_not_in_options_returns_error():
    """Note-form dict with an invalid choice → error on choice."""
    from aica_api.services.feedback import validate

    labels = {"rejection_reason": {"choice": "INVALID", "note": "ok note"}}
    event = _make_feedback_event(scope="run", labels=labels)
    errors = validate(event, _v1_schema(), _make_run_log())

    assert len(errors) == 1
    assert "rejection_reason" in errors[0].field


# ---------------------------------------------------------------------------
# T005 — validate: target scopes + event_ref
# ---------------------------------------------------------------------------


def test_validate_target_run_no_event_ref_valid():
    """scope='run' with no event_ref → valid."""
    from aica_api.services.feedback import validate

    run_log = _make_run_log([_make_tick_event(0)])
    event = _make_feedback_event(scope="run", event_ref=None)
    errors = validate(event, _v1_schema(), run_log)
    assert errors == []


def test_validate_target_decision_with_tick_event_valid():
    """scope='decision' with event_ref pointing to a TickEvent → valid."""
    from aica_api.services.feedback import validate

    tick = _make_tick_event(0)
    run_log = _make_run_log([tick])
    event = _make_feedback_event(scope="decision", event_ref=0)
    errors = validate(event, _v1_schema(), run_log)
    assert errors == []


def test_validate_target_decision_with_action_event_returns_error():
    """scope='decision' with event_ref pointing to an ActionEvent → error."""
    from aica_api.services.feedback import validate

    action_ev = _make_action_event(0)
    run_log = _make_run_log([action_ev])
    event = _make_feedback_event(scope="decision", event_ref=0)
    errors = validate(event, _v1_schema(), run_log)

    assert len(errors) == 1
    assert "event_ref" in errors[0].field


def test_validate_target_proposal_with_fired_proposal_valid():
    """scope='proposal' with event_ref pointing to a TickEvent with fired proposal → valid."""
    from aica_api.services.feedback import validate

    tick = _make_tick_event(0, decision=_make_proposal_decision())
    run_log = _make_run_log([tick])
    event = _make_feedback_event(scope="proposal", event_ref=0)
    errors = validate(event, _v1_schema(), run_log)
    assert errors == []


def test_validate_target_proposal_with_no_proposal_fired_returns_error():
    """scope='proposal' with event_ref pointing to a no-proposal TickEvent → error."""
    from aica_api.services.feedback import validate

    tick = _make_tick_event(0, decision=_make_no_trigger_decision())
    run_log = _make_run_log([tick])
    event = _make_feedback_event(scope="proposal", event_ref=0)
    errors = validate(event, _v1_schema(), run_log)

    assert len(errors) == 1
    assert "event_ref" in errors[0].field


def test_validate_target_action_with_action_event_valid():
    """scope='action' with event_ref pointing to an ActionEvent → valid."""
    from aica_api.services.feedback import validate

    action_ev = _make_action_event(0)
    run_log = _make_run_log([action_ev])
    event = _make_feedback_event(scope="action", event_ref=0)
    errors = validate(event, _v1_schema(), run_log)
    assert errors == []


def test_validate_target_action_with_tick_event_returns_error():
    """scope='action' with event_ref pointing to a TickEvent → error."""
    from aica_api.services.feedback import validate

    tick = _make_tick_event(0)
    run_log = _make_run_log([tick])
    event = _make_feedback_event(scope="action", event_ref=0)
    errors = validate(event, _v1_schema(), run_log)

    assert len(errors) == 1
    assert "event_ref" in errors[0].field


def test_validate_non_run_missing_event_ref_returns_error():
    """scope='decision' with no event_ref → error."""
    from aica_api.services.feedback import validate

    tick = _make_tick_event(0)
    run_log = _make_run_log([tick])
    event = _make_feedback_event(scope="decision", event_ref=None)
    errors = validate(event, _v1_schema(), run_log)

    assert len(errors) == 1
    assert "event_ref" in errors[0].field


def test_validate_non_run_out_of_range_event_ref_returns_error():
    """scope='decision' with event_ref >= len(events) → error."""
    from aica_api.services.feedback import validate

    tick = _make_tick_event(0)
    run_log = _make_run_log([tick])
    event = _make_feedback_event(scope="decision", event_ref=99)
    errors = validate(event, _v1_schema(), run_log)

    assert len(errors) == 1
    assert "event_ref" in errors[0].field


# ---------------------------------------------------------------------------
# T005 — validate: multiple errors
# ---------------------------------------------------------------------------


def test_validate_multiple_errors_returned():
    """Multiple invalid labels → multiple errors."""
    from aica_api.services.feedback import validate

    labels = {
        "proposal_timing": "INVALID",  # bad choice
        "bogus_key": "whatever",  # unknown key
    }
    event = _make_feedback_event(scope="run", labels=labels)
    errors = validate(event, _v1_schema(), _make_run_log())
    assert len(errors) == 2


# ---------------------------------------------------------------------------
# T006 — append_feedback: active run path
# ---------------------------------------------------------------------------


@pytest.fixture
def active_run(tmp_path):
    """Create a real active run with one tick event."""
    from aica_api.models.package import PackageManifest
    from aica_api.models.scenario import ScenarioDef
    from aica_api.services.run_manager import create_run, tick
    from aica_api.services.run_plan import create_draft

    pkg_data = json.loads(_PACKAGE_PATH.read_text(encoding="utf-8"))
    pkg = PackageManifest(**pkg_data)

    sc_data = json.loads(_SCENARIO_PATH.read_text(encoding="utf-8"))
    sc = ScenarioDef(**sc_data)

    plan_id = "plan_feedback_active"
    run_id = "run_feedback_active"

    create_draft(
        plan_id=plan_id,
        package=pkg,
        scenario=sc,
        presets={},
        parameters={},
        hyperparameters={},
        run_mode="standard",
    )
    create_run(plan_id, run_id, tmp_path)

    # Tick once so there's at least one TickEvent
    tick(run_id)

    return run_id, tmp_path


def test_append_feedback_active_run_persists_event(active_run):
    """Appending feedback to an active run persists a FeedbackEvent in the log."""
    from aica_api.services.feedback import append_feedback

    run_id, tmp_path = active_run
    fb = _make_feedback_event(scope="run", comment="Active run feedback")

    append_feedback(run_id, fb, tmp_path)

    data = json.loads((tmp_path / f"{run_id}.json").read_text(encoding="utf-8"))
    feedback_events = [e for e in data["events"] if e.get("kind") == "feedback"]
    assert len(feedback_events) == 1
    assert feedback_events[0]["comment"] == "Active run feedback"


def test_append_feedback_active_run_feedback_target_persisted(active_run):
    """Feedback target is persisted correctly in the active-run log."""
    from aica_api.models.feedback import FeedbackTarget
    from aica_api.services.feedback import append_feedback

    run_id, tmp_path = active_run
    fb = _make_feedback_event(
        scope="run",
        labels={"proposal_timing": "appropriate"},
        comment="Felt right",
    )

    append_feedback(run_id, fb, tmp_path)

    data = json.loads((tmp_path / f"{run_id}.json").read_text(encoding="utf-8"))
    feedback_events = [e for e in data["events"] if e.get("kind") == "feedback"]
    assert feedback_events[0]["target"]["scope"] == "run"
    assert feedback_events[0]["labels"]["proposal_timing"] == "appropriate"


def test_append_feedback_active_run_decision_trace_unchanged(active_run):
    """Appending feedback to an active run does NOT alter any prior TickEvent."""
    from aica_api.services.feedback import append_feedback

    run_id, tmp_path = active_run
    run_file = tmp_path / f"{run_id}.json"

    # Capture tick events before feedback
    before = json.loads(run_file.read_text(encoding="utf-8"))
    tick_events_before = [e for e in before["events"] if e.get("kind") == "tick"]
    assert len(tick_events_before) >= 1, "precondition: at least one tick event"

    # Append feedback
    fb = _make_feedback_event(scope="run", comment="Should not change ticks")
    append_feedback(run_id, fb, tmp_path)

    # Capture tick events after feedback
    after = json.loads(run_file.read_text(encoding="utf-8"))
    tick_events_after = [e for e in after["events"] if e.get("kind") == "tick"]

    # TickEvents must be byte-for-byte identical
    assert tick_events_before == tick_events_after


# ---------------------------------------------------------------------------
# T006 — append_feedback: disk (inactive) run path
# ---------------------------------------------------------------------------


@pytest.fixture
def disk_run(tmp_path):
    """Write a RunLog with TickEvents directly to disk (no active registry entry)."""
    from aica_api.models.run import ArtifactRef, EventPlan, RouteFacts, Snapshot
    from aica_api.storage.file_store import write_json_atomic

    run_id = "run_feedback_disk"

    from aica_api.models.log import RunLog

    run_log = RunLog(
        run_id=run_id,
        created_at="2026-01-01T00:00:00Z",
        simulator_version="0.1.0",
        snapshot=Snapshot(
            package=ArtifactRef(id="rest_rule_based_v0_1", version="0.1.0", hash="abc"),
            scenario=ArtifactRef(id="sc_test", version="0.1.0", hash="def"),
        ),
        route_facts=RouteFacts(),
        event_plan=EventPlan(),
        events=[
            _make_tick_event(0),
            _make_tick_event(1),
        ],
    )
    path = str(tmp_path / f"{run_id}.json")
    write_json_atomic(path, run_log.model_dump(mode="json"))

    return run_id, tmp_path


def test_append_feedback_disk_run_persists_event(disk_run):
    """Appending feedback to an on-disk run persists a FeedbackEvent."""
    from aica_api.services.feedback import append_feedback

    run_id, tmp_path = disk_run
    fb = _make_feedback_event(scope="run", comment="Disk run feedback")

    append_feedback(run_id, fb, tmp_path)

    data = json.loads((tmp_path / f"{run_id}.json").read_text(encoding="utf-8"))
    feedback_events = [e for e in data["events"] if e.get("kind") == "feedback"]
    assert len(feedback_events) == 1
    assert feedback_events[0]["comment"] == "Disk run feedback"


def test_append_feedback_disk_run_event_at_end(disk_run):
    """FeedbackEvent is appended at the END of the event list (not inserted)."""
    from aica_api.services.feedback import append_feedback

    run_id, tmp_path = disk_run
    fb = _make_feedback_event(scope="run", comment="End of list")

    append_feedback(run_id, fb, tmp_path)

    data = json.loads((tmp_path / f"{run_id}.json").read_text(encoding="utf-8"))
    events = data["events"]
    assert events[-1]["kind"] == "feedback"


def test_append_feedback_disk_run_decision_trace_unchanged(disk_run):
    """Appending feedback to an on-disk run does NOT alter any prior TickEvent."""
    from aica_api.services.feedback import append_feedback

    run_id, tmp_path = disk_run
    run_file = tmp_path / f"{run_id}.json"

    # Capture tick events before feedback
    before = json.loads(run_file.read_text(encoding="utf-8"))
    tick_events_before = [e for e in before["events"] if e.get("kind") == "tick"]
    assert len(tick_events_before) == 2, "precondition: exactly 2 tick events"

    # Append feedback
    fb = _make_feedback_event(scope="run", comment="Should not change ticks")
    append_feedback(run_id, fb, tmp_path)

    # Capture tick events after feedback
    after = json.loads(run_file.read_text(encoding="utf-8"))
    tick_events_after = [e for e in after["events"] if e.get("kind") == "tick"]

    # TickEvents must be byte-for-byte identical
    assert tick_events_before == tick_events_after


def test_append_feedback_disk_run_multiple_feedbacks(disk_run):
    """Multiple feedback appends accumulate correctly on an on-disk run."""
    from aica_api.services.feedback import append_feedback

    run_id, tmp_path = disk_run

    fb1 = _make_feedback_event(scope="run", comment="First feedback")
    fb2 = _make_feedback_event(scope="decision", event_ref=0, comment="Second feedback")

    append_feedback(run_id, fb1, tmp_path)
    append_feedback(run_id, fb2, tmp_path)

    data = json.loads((tmp_path / f"{run_id}.json").read_text(encoding="utf-8"))
    feedback_events = [e for e in data["events"] if e.get("kind") == "feedback"]
    assert len(feedback_events) == 2
    assert feedback_events[0]["comment"] == "First feedback"
    assert feedback_events[1]["comment"] == "Second feedback"


# ---------------------------------------------------------------------------
# T006 — append_feedback: run-not-found error
# ---------------------------------------------------------------------------


def test_append_feedback_not_found_raises(tmp_path):
    """append_feedback for a nonexistent run (no registry + no file) → error."""
    from aica_api.services.run_manager import RunNotFoundError
    from aica_api.services.feedback import append_feedback

    fb = _make_feedback_event(scope="run")

    with pytest.raises(RunNotFoundError):
        append_feedback("nonexistent_run_xyz", fb, tmp_path)
