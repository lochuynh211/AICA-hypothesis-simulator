"""TDD: feature 020 (Slice-2c, Task 2) -- the non-persisting `cache` kwarg.

Covers:
  - Low-level `proposal_run_manager` contract: `create_run`/`get_run`/
    `append_event`/`append_evidence`/`update_state` all read/write a
    caller-supplied `cache: dict[str, ProposalRunLog]` instead of disk when
    `cache` is not `None`; `runs_dir` is then never touched (no file
    created). `cache=None` (the default) is byte-identical to pre-feature
    disk-persisting behavior.
  - Router-level acceptance (the brief's own acceptance criterion):
    `create_proposal_run(quick_check body, cache={})` returns a
    fully-resolved `ProposalRunLog` (service AND content evidence present,
    status == content_selected) and writes NOTHING under
    `proposal_runs_dir` -- a quick-check proposal can be built entirely in
    memory. `cache=None` (omitted) still persists exactly as before.

`create_proposal_run` is called directly as a plain Python function (not
through the FastAPI TestClient/HTTP layer) so the Python-only `cache` kwarg
can be passed -- mirrors how `merged_quickview` (a later Slice-2c task) will
call it in-process.
"""
from __future__ import annotations

import json

import pytest

from aica_api.config import settings
from aica_api.models.proposal.enums import (
    DiscreteEventType,
    LifecycleStage,
    ProposalRunMode,
    ProposalRunStatus,
    ServiceId,
    TriggerPurpose,
)
from aica_api.models.proposal.events import DiscreteEvent
from aica_api.models.proposal.evidence import AlgorithmEvidence
from aica_api.models.proposal.journey import JourneyState
from aica_api.models.proposal.opportunity import ProposalOpportunity
from aica_api.models.proposal.proposal_run import ProposalRunLog
from aica_api.routers.proposal import CreateProposalRunBody, create_proposal_run
from aica_api.services import proposal_run_manager as prm

_SEED_ID = "seed-night-highway-oshi"
_REAL_SERVICE_PACKAGE_ID = "aica_transparent_service_selector_v1"
_REAL_CONTENT_PACKAGE_ID = "aica_transparent_content_selector_v1"


@pytest.fixture(autouse=True)
def isolate_proposal_runs_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(tmp_path))
    yield tmp_path


# ---------------------------------------------------------------------------
# Low-level proposal_run_manager cache contract
# ---------------------------------------------------------------------------


def _opportunity() -> ProposalOpportunity:
    return ProposalOpportunity(
        opportunity_id="op-cache-test-1",
        trigger_purpose=TriggerPurpose.rest_recommended,
        lifecycle_stage=LifecycleStage.after_rest_before_restart,
        allowed_service_ids=[ServiceId.live_viewing, ServiceId.stretch_video],
        simulation_time="2026-07-18T10:00:00Z",
        run_seed="seed-1",
    )


def _journey_state() -> JourneyState:
    return JourneyState(
        lifecycle_stage=LifecycleStage.after_rest_before_restart,
        motion_state="stopped",
        active_service_id=None,
        active_plan_id=None,
    )


def _create(runs_dir, *, cache=None, **overrides) -> ProposalRunLog:
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
        cache=cache,
    )
    kwargs.update(overrides)
    return prm.create_run(**kwargs)


def test_create_run_with_cache_writes_dict_not_disk(tmp_path):
    cache: dict[str, ProposalRunLog] = {}
    log = _create(tmp_path, cache=cache)

    assert log.run_id in cache
    assert cache[log.run_id] is log
    assert list(tmp_path.glob("*.json")) == []


def test_create_run_without_cache_still_persists_to_disk(tmp_path):
    log = _create(tmp_path)  # cache omitted -> None -> existing behavior

    path = tmp_path / f"{log.run_id}.json"
    assert path.exists()


def test_get_run_with_cache_reads_dict_not_disk(tmp_path):
    cache: dict[str, ProposalRunLog] = {}
    log = _create(tmp_path, cache=cache)

    # Nothing on disk to read from -- get_run must come from the dict.
    reopened = prm.get_run(log.run_id, tmp_path, cache=cache)
    assert reopened is log

    # An unknown run_id under a non-empty cache is a plain miss, like disk.
    assert prm.get_run("prun_unknown", tmp_path, cache=cache) is None


def test_get_run_without_cache_reads_disk_as_before(tmp_path):
    log = _create(tmp_path)
    reopened = prm.get_run(log.run_id, tmp_path)
    assert reopened == log


def test_append_event_with_cache_updates_dict_and_never_touches_disk(tmp_path):
    cache: dict[str, ProposalRunLog] = {}
    log = _create(tmp_path, cache=cache)
    event = DiscreteEvent(
        event_type=DiscreteEventType.SERVICE_SELECTED,
        at="2026-07-18T10:01:00Z",
        payload={"selected_service_id": "live_viewing"},
    )

    updated = prm.append_event(log.run_id, event, tmp_path, cache=cache)

    assert len(updated.events) == 1
    assert cache[log.run_id] is updated
    assert list(tmp_path.glob("*.json")) == []


def test_append_evidence_with_cache_updates_dict_and_never_touches_disk(tmp_path):
    cache: dict[str, ProposalRunLog] = {}
    log = _create(tmp_path, cache=cache)
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

    updated = prm.append_evidence(log.run_id, ev, tmp_path, cache=cache)

    assert len(updated.evidence) == 1
    assert cache[log.run_id] is updated
    assert list(tmp_path.glob("*.json")) == []


def test_update_state_with_cache_updates_dict_and_never_touches_disk(tmp_path):
    cache: dict[str, ProposalRunLog] = {}
    log = _create(tmp_path, cache=cache)

    updated = prm.update_state(
        log.run_id,
        tmp_path,
        status=ProposalRunStatus.content_selected,
        cache=cache,
    )

    assert updated.status == ProposalRunStatus.content_selected
    assert cache[log.run_id] is updated
    assert list(tmp_path.glob("*.json")) == []


def test_cache_round_trip_matches_disk_round_trip_content(tmp_path):
    """The cached log and a disk-persisted log carry the same content --
    only the storage medium differs."""
    cache: dict[str, ProposalRunLog] = {}
    cached_log = _create(tmp_path, cache=cache, journey_state=_journey_state())
    disk_log = _create(tmp_path, journey_state=_journey_state())

    cached_dump = cached_log.model_dump(mode="json")
    disk_dump = disk_log.model_dump(mode="json")
    for key in ("run_id", "created_at"):
        cached_dump.pop(key)
        disk_dump.pop(key)
    assert cached_dump == disk_dump


# ---------------------------------------------------------------------------
# Router-level acceptance: create_proposal_run(quick_check body, cache={})
# ---------------------------------------------------------------------------


def _load_seed_world_dict(seed_id: str = _SEED_ID) -> dict:
    path = settings.proposal_contracts_dir / "seeds" / f"{seed_id}.json"
    return json.loads(path.read_text(encoding="utf-8"))["world"]


def _quick_check_body(**overrides) -> CreateProposalRunBody:
    body = {
        "world": _load_seed_world_dict(),
        "service_package_id": _REAL_SERVICE_PACKAGE_ID,
        "content_package_id": _REAL_CONTENT_PACKAGE_ID,
        "mode": "quick_check",
        "run_seed": "seed-1",
        "simulation_time": "2026-07-18T10:00:00Z",
    }
    body.update(overrides)
    return CreateProposalRunBody(**body)


def test_create_proposal_run_with_cache_returns_fully_resolved_log_and_persists_nothing(tmp_path):
    cache: dict[str, ProposalRunLog] = {}

    run_log = create_proposal_run(_quick_check_body(), cache=cache)

    # Fully resolved: STEP 1 (service) AND STEP 2 (content) both landed in
    # the SAME in-memory call, exactly like the disk-backed quick_check path.
    assert run_log.status == ProposalRunStatus.content_selected
    service_evidence = [e for e in run_log.evidence if e.step == "service"]
    content_evidence = [e for e in run_log.evidence if e.step == "content"]
    assert len(service_evidence) == 1
    assert len(content_evidence) == 1
    assert content_evidence[0].error is None
    assert content_evidence[0].output["ordered_items"]

    # In-memory only: the cache holds the finished log...
    assert cache[run_log.run_id] is run_log
    # ...and NOTHING was written under proposal_runs_dir (assert file
    # absent, and the directory has no new file at all).
    assert not (tmp_path / f"{run_log.run_id}.json").exists()
    assert list(tmp_path.glob("*.json")) == []


def test_create_proposal_run_without_cache_still_persists_exactly_as_before(tmp_path):
    run_log = create_proposal_run(_quick_check_body())  # cache omitted -> None

    assert run_log.status == ProposalRunStatus.content_selected
    path = tmp_path / f"{run_log.run_id}.json"
    assert path.exists()
    persisted = json.loads(path.read_text(encoding="utf-8"))
    assert persisted["run_id"] == run_log.run_id
    assert persisted["status"] == "content_selected"
