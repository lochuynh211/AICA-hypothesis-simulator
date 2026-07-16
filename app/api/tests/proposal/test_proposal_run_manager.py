"""TDD: proposal_run_manager core — T017.

Covers:
  - create_run(...) builds a ProposalRunLog and persists it atomically to
    <proposal_runs_dir>/<run_id>.json.
  - run_id format: prun_<YYYYMMDD-HHMMSS>_<6hex>.
  - Params/hyperparameters are frozen into the log at creation (a later
    mutation of the caller's dict does not retroactively change the
    persisted log).
  - get_run() reopens a persisted run and deep-equals the created log.
  - list_runs() returns summaries sourced from disk.
  - delete_run() removes the file; a second delete / get returns
    False / None.
  - A create writes ONLY under proposal_runs/ and never touches a sibling
    trigger runs/ directory.
  - append_event / append_evidence extend the log and re-persist
    atomically (append-only: prior entries are preserved).
"""
from __future__ import annotations

import re

import pytest

from aica_api.models.proposal.enums import (
    DiscreteEventType,
    LifecycleStage,
    ProposalRunStatus,
    ServiceId,
    TriggerPurpose,
)
from aica_api.models.proposal.events import DiscreteEvent
from aica_api.models.proposal.evidence import AlgorithmEvidence, EvidenceError
from aica_api.models.proposal.journey import JourneyState
from aica_api.models.proposal.opportunity import ProposalOpportunity
from aica_api.models.proposal.proposal_run import ProposalRunLog
from aica_api.services import proposal_run_manager as prm

_RUN_ID_RE = re.compile(r"^prun_\d{8}-\d{6}_[0-9a-f]{6}$")


def _opportunity() -> ProposalOpportunity:
    return ProposalOpportunity(
        opportunity_id="op-test-1",
        trigger_purpose=TriggerPurpose.rest_recommended,
        lifecycle_stage=LifecycleStage.after_rest_before_restart,
        allowed_service_ids=[ServiceId.live_viewing, ServiceId.stretch_video],
        simulation_time="2026-07-16T10:00:00Z",
        run_seed="seed-1",
    )


def _journey_state() -> JourneyState:
    return JourneyState(
        lifecycle_stage=LifecycleStage.after_rest_before_restart,
        motion_state="stopped",
        active_service_id=None,
        active_plan_id=None,
    )


def _create(runs_dir, **overrides) -> ProposalRunLog:
    kwargs = dict(
        opportunity=_opportunity(),
        matrix_version="v1",
        world_snapshot={"feature_snapshot": {}, "feature_provenance": {}},
        service_package_id="mock_service_selector_v1",
        content_package_id=None,
        parameters={"top_k": 3},
        hyperparameters={"response_matrix": {}},
        journey_state=_journey_state(),
        runs_dir=runs_dir,
    )
    kwargs.update(overrides)
    return prm.create_run(**kwargs)


# ---------------------------------------------------------------------------
# create_run — shape, run_id format, atomic persistence
# ---------------------------------------------------------------------------


def test_create_run_returns_proposal_run_log(tmp_path):
    log = _create(tmp_path)
    assert isinstance(log, ProposalRunLog)
    assert log.status == ProposalRunStatus.created
    assert log.service_package_id == "mock_service_selector_v1"


def test_create_run_id_matches_prun_format(tmp_path):
    log = _create(tmp_path)
    assert _RUN_ID_RE.match(log.run_id), log.run_id


def test_create_run_persists_file_under_runs_dir(tmp_path):
    log = _create(tmp_path)
    path = tmp_path / f"{log.run_id}.json"
    assert path.exists()


def test_create_run_two_calls_yield_distinct_run_ids(tmp_path):
    log1 = _create(tmp_path)
    log2 = _create(tmp_path)
    assert log1.run_id != log2.run_id


# ---------------------------------------------------------------------------
# Frozen params/hyperparameters
# ---------------------------------------------------------------------------


def test_parameters_are_frozen_at_creation(tmp_path):
    params = {"top_k": 3}
    log = _create(tmp_path, parameters=params)
    params["top_k"] = 999  # mutate caller's dict after creation
    reopened = prm.get_run(log.run_id, tmp_path)
    assert reopened.parameters["top_k"] == 3


# ---------------------------------------------------------------------------
# get_run — reopen deep-equals the created log
# ---------------------------------------------------------------------------


def test_get_run_reopen_deep_equals_created(tmp_path):
    log = _create(tmp_path)
    reopened = prm.get_run(log.run_id, tmp_path)
    assert reopened == log


def test_get_run_unknown_returns_none(tmp_path):
    assert prm.get_run("prun_does_not_exist", tmp_path) is None


# ---------------------------------------------------------------------------
# list_runs
# ---------------------------------------------------------------------------


def test_list_runs_returns_created_runs(tmp_path):
    log1 = _create(tmp_path)
    log2 = _create(tmp_path)
    summaries = prm.list_runs(tmp_path)
    ids = {s.run_id for s in summaries}
    assert {log1.run_id, log2.run_id} <= ids


def test_list_runs_empty_dir_returns_empty_list(tmp_path):
    empty = tmp_path / "empty"
    assert prm.list_runs(empty) == []


# ---------------------------------------------------------------------------
# delete_run
# ---------------------------------------------------------------------------


def test_delete_run_removes_file(tmp_path):
    log = _create(tmp_path)
    assert prm.delete_run(log.run_id, tmp_path) is True
    assert not (tmp_path / f"{log.run_id}.json").exists()
    assert prm.get_run(log.run_id, tmp_path) is None


def test_delete_run_unknown_returns_false(tmp_path):
    assert prm.delete_run("prun_does_not_exist", tmp_path) is False


# ---------------------------------------------------------------------------
# Isolation: create writes ONLY under proposal_runs/, never runs/
# ---------------------------------------------------------------------------


def test_create_run_never_touches_sibling_trigger_runs_dir(tmp_path):
    proposal_runs_dir = tmp_path / "proposal_runs"
    trigger_runs_dir = tmp_path / "runs"
    trigger_runs_dir.mkdir()

    _create(proposal_runs_dir)

    assert list(trigger_runs_dir.iterdir()) == []


# ---------------------------------------------------------------------------
# append_event / append_evidence — append-only, re-persisted
# ---------------------------------------------------------------------------


def test_append_event_persists_and_preserves_prior_events(tmp_path):
    log = _create(tmp_path)
    event = DiscreteEvent(
        event_type=DiscreteEventType.SERVICE_SELECTED,
        at="2026-07-16T10:01:00Z",
        payload={"selected_service_id": "live_viewing"},
    )
    updated = prm.append_event(log.run_id, event, tmp_path)
    assert len(updated.events) == 1
    assert updated.events[0].event_type == DiscreteEventType.SERVICE_SELECTED

    reopened = prm.get_run(log.run_id, tmp_path)
    assert len(reopened.events) == 1

    event2 = DiscreteEvent(
        event_type=DiscreteEventType.CONTENT_SELECTED,
        at="2026-07-16T10:02:00Z",
        payload={},
    )
    updated2 = prm.append_event(log.run_id, event2, tmp_path)
    assert len(updated2.events) == 2
    assert updated2.events[0].event_type == DiscreteEventType.SERVICE_SELECTED
    assert updated2.events[1].event_type == DiscreteEventType.CONTENT_SELECTED


def test_append_evidence_persists_and_preserves_prior_entries(tmp_path):
    log = _create(tmp_path)
    ev = AlgorithmEvidence(
        step="service",
        package_id="mock_service_selector_v1",
        contract_version="1.0.0",
        schema_version="1.0.0",
        matrix_version="v1",
        input_snapshot={},
        output={"decision_type": "no_proposal"},
        error=None,
        used_feature_ids=[],
        unused_available_features=[],
        missing_features=[],
    )
    updated = prm.append_evidence(log.run_id, ev, tmp_path)
    assert len(updated.evidence) == 1

    err_ev = AlgorithmEvidence(
        step="content",
        package_id="mock_content_selector_v1",
        contract_version="1.0.0",
        schema_version="1.0.0",
        matrix_version="v1",
        input_snapshot={},
        output=None,
        error=EvidenceError(category="algorithm_exception", message="boom"),
        used_feature_ids=[],
        unused_available_features=[],
        missing_features=[],
    )
    updated2 = prm.append_evidence(log.run_id, err_ev, tmp_path)
    assert len(updated2.evidence) == 2
    assert updated2.evidence[0].error is None
    assert updated2.evidence[1].error is not None


def test_append_event_unknown_run_raises(tmp_path):
    event = DiscreteEvent(event_type=DiscreteEventType.SERVICE_SELECTED, at="x", payload={})
    with pytest.raises(prm.ProposalRunNotFoundError):
        prm.append_event("prun_does_not_exist", event, tmp_path)
