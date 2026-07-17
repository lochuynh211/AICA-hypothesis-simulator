"""TDD (T002): P7 foundational model back-compat + shape tests.

Covers (data-model.md "Modified: ProposalRunLog" / "Modified: ProposalRun
summary" / "New enum: ProposalRunMode" / "Modified enum: DiscreteEventType"
/ "New model: RecomputeRequest"):

  - a pre-P7 ``ProposalRunLog`` dict (no ``world``/``opportunity_history``/
    ``setup_snapshot_history``/``mode``) loads with the new defaults;
  - ``ProposalRunMode`` has exactly the two legal values;
  - ``DiscreteEventType.RECOMPUTED``/``CONTEXT_EDITED`` exist, append-only
    (no existing member's value changed);
  - ``RecomputeRequest`` validates with an empty and a populated
    ``overrides`` list;
  - the history-length invariant (``len(opportunity_history) ==
    len(setup_snapshot_history)``) holds for a legacy log (both empty).
"""
from __future__ import annotations

from aica_api.models.proposal.enums import DiscreteEventType, ProposalRunMode, ProposalRunStatus
from aica_api.models.proposal.proposal_run import ProposalRun, ProposalRunLog
from aica_api.models.proposal.recompute import RecomputeRequest
from aica_api.models.proposal.world import FieldOverride, World

# ---------------------------------------------------------------------------
# A pre-P7 ProposalRunLog dict (the exact shape P1-P6 persisted) — no world/
# opportunity_history/setup_snapshot_history/mode keys at all.
# ---------------------------------------------------------------------------

_PRE_P7_RUN_LOG_DICT = {
    "run_id": "prun_20260716-100000_abcdef",
    "created_at": "2026-07-16T10:00:00Z",
    "opportunity": {
        "opportunity_id": "op-test-1",
        "trigger_purpose": "rest_recommended",
        "lifecycle_stage": "before_rest_until_stop",
        "allowed_service_ids": ["music_playlist"],
        "simulation_time": "2026-07-16T10:00:00Z",
        "run_seed": "seed-1",
    },
    "matrix_version": "v1",
    "world_snapshot": {"feature_snapshot": {}, "feature_provenance": {}},
    "setup_snapshot": None,
    "service_package_id": "mock_service_selector_v1",
    "content_package_id": None,
    "parameters": {"top_k": 3},
    "hyperparameters": {"response_matrix": {}},
    "content_parameters": {},
    "content_hyperparameters": {},
    "journey_state": {
        "lifecycle_stage": "before_rest_until_stop",
        "motion_state": "driving",
        "active_service_id": None,
        "active_plan_id": None,
    },
    "events": [],
    "evidence": [],
    "status": "created",
}


def test_pre_p7_run_log_dict_loads_with_new_defaults():
    log = ProposalRunLog(**_PRE_P7_RUN_LOG_DICT)

    assert log.world is None
    assert log.opportunity_history == []
    assert log.setup_snapshot_history == []
    assert log.mode == ProposalRunMode.interactive


def test_pre_p7_run_log_round_trips_through_json_dump():
    log = ProposalRunLog(**_PRE_P7_RUN_LOG_DICT)
    dumped = log.model_dump(mode="json")

    assert dumped["world"] is None
    assert dumped["opportunity_history"] == []
    assert dumped["setup_snapshot_history"] == []
    assert dumped["mode"] == "interactive"

    reloaded = ProposalRunLog(**dumped)
    assert reloaded == log


def test_history_length_invariant_holds_for_legacy_log():
    log = ProposalRunLog(**_PRE_P7_RUN_LOG_DICT)
    assert len(log.opportunity_history) == len(log.setup_snapshot_history)


# ---------------------------------------------------------------------------
# ProposalRun summary — new `mode` field, defaulted
# ---------------------------------------------------------------------------


def test_proposal_run_summary_mode_defaults_to_interactive():
    run = ProposalRun(
        run_id="prun_x",
        status=ProposalRunStatus.created,
        opportunity_id="op-x",
        created_at="2026-07-16T10:00:00Z",
        service_package_id="mock_service_selector_v1",
        content_package_id=None,
    )
    assert run.mode == ProposalRunMode.interactive


def test_proposal_run_summary_accepts_explicit_quick_check_mode():
    run = ProposalRun(
        run_id="prun_x",
        status=ProposalRunStatus.created,
        opportunity_id="op-x",
        created_at="2026-07-16T10:00:00Z",
        service_package_id="mock_service_selector_v1",
        content_package_id=None,
        mode=ProposalRunMode.quick_check,
    )
    assert run.mode == ProposalRunMode.quick_check


# ---------------------------------------------------------------------------
# ProposalRunMode enum
# ---------------------------------------------------------------------------


def test_proposal_run_mode_has_exactly_two_values():
    assert {m.value for m in ProposalRunMode} == {"interactive", "quick_check"}


# ---------------------------------------------------------------------------
# DiscreteEventType — append-only new members
# ---------------------------------------------------------------------------


def test_discrete_event_type_has_recomputed_and_context_edited():
    assert DiscreteEventType.RECOMPUTED.value == "RECOMPUTED"
    assert DiscreteEventType.CONTEXT_EDITED.value == "CONTEXT_EDITED"


def test_discrete_event_type_existing_members_unchanged():
    assert DiscreteEventType.OPPORTUNITY_OPENED.value == "OPPORTUNITY_OPENED"
    assert DiscreteEventType.SERVICE_SELECTED.value == "SERVICE_SELECTED"
    assert DiscreteEventType.CONTENT_SELECTED.value == "CONTENT_SELECTED"
    assert DiscreteEventType.ALGORITHM_ERROR.value == "ALGORITHM_ERROR"
    assert DiscreteEventType.NO_ELIGIBLE_CANDIDATE.value == "NO_ELIGIBLE_CANDIDATE"


# ---------------------------------------------------------------------------
# RecomputeRequest — empty + populated overrides
# ---------------------------------------------------------------------------


def test_recompute_request_defaults_to_empty_overrides_and_dicts():
    req = RecomputeRequest()
    assert req.overrides == []
    assert req.parameters == {}
    assert req.hyperparameters == {}
    assert req.content_parameters == {}
    assert req.content_hyperparameters == {}


def test_recompute_request_accepts_populated_overrides_and_dicts():
    req = RecomputeRequest(
        overrides=[FieldOverride(path="situation.drowsiness_level", value=80)],
        parameters={"top_k": 3},
        hyperparameters={"response_matrix": {}},
        content_parameters={"foo": "bar"},
        content_hyperparameters={"baz": 1},
    )
    assert len(req.overrides) == 1
    assert req.overrides[0].path == "situation.drowsiness_level"
    assert req.overrides[0].value == 80
    assert req.parameters == {"top_k": 3}
    assert req.content_hyperparameters == {"baz": 1}


def test_recompute_request_overrides_accept_dict_shape():
    req = RecomputeRequest(overrides=[{"path": "situation.fatigue_level", "value": 70}])
    assert isinstance(req.overrides[0], FieldOverride)
    assert req.overrides[0].value == 70
