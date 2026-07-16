"""US3 trust invariant — frozen allowed-set + matrix versioning (T040).
FR-011/012/013, SC-002, SC-009.

Covers:
  - Every ranked service candidate returned for EVERY (trigger_purpose,
    lifecycle_stage) row of the frozen matrix that has a non-empty
    allowed_service_ids set is a member of that row's allowed set (SC-002),
    swept across all such rows -- not just the one row exercised by
    ``test_ep_create_run.py``.
  - The one row with an EMPTY allowed set (``during_rest_stopped``) can never
    produce a run at all (the opportunity itself rejects an empty allowed
    set) -- confirms the empty-set row is honestly unusable rather than
    silently widened.
  - A created run records the exact ``matrix_version`` of the frozen matrix
    it resolved against (FR-012/013).
  - The post-rest row (``rest_recommended`` / ``after_rest_before_restart``)
    resolves to EXACTLY the 5 expected services, including
    ``call_response_stopped`` (SC-009).
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from aica_api.config import settings
from aica_api.main import app
from aica_api.models.proposal.enums import LifecycleStage, TriggerPurpose
from aica_api.models.proposal.matrix import PurposeStageServiceMatrix

client = TestClient(app)

_MATRIX_PATH = settings.proposal_contracts_dir / "matrix" / "purpose_stage_matrix.v1.json"


@pytest.fixture(autouse=True)
def isolate_proposal_runs_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(tmp_path))
    yield


def _create_run_body(*, trigger_purpose: str, lifecycle_stage: str, motion_state: str) -> dict:
    return {
        "trigger_purpose": trigger_purpose,
        "lifecycle_stage": lifecycle_stage,
        "motion_state": motion_state,
        "world_snapshot": {"feature_snapshot": {}, "feature_provenance": {}},
        "service_package_id": "mock_service_selector_v1",
        "content_package_id": "mock_content_selector_v1",
        "mode": "interactive",
        "enabled_feature_extensions": [],
        "parameters": {},
        "hyperparameters": {},
        "run_seed": "seed-allowed-set-test",
        "simulation_time": "2026-07-16T10:00:00Z",
    }


def _motion_state_for(lifecycle_stage: str) -> str:
    return "driving" if lifecycle_stage == "active_driving_content" else "stopped"


# ---------------------------------------------------------------------------
# Post-rest row -- exactly 5 services incl. call_response_stopped (SC-009)
# ---------------------------------------------------------------------------


def test_post_rest_row_resolves_to_exactly_five_services_incl_call_response_stopped():
    matrix = PurposeStageServiceMatrix.load(_MATRIX_PATH)
    allowed = matrix.resolve(
        trigger_purpose=TriggerPurpose.rest_recommended,
        lifecycle_stage=LifecycleStage.after_rest_before_restart,
    )
    ids = {s.value for s in allowed}
    assert ids == {
        "live_viewing",
        "stretch_video",
        "full_karaoke",
        "oshi_reexperience",
        "call_response_stopped",
    }
    assert len(ids) == 5


def test_post_rest_row_via_endpoint_matches_frozen_five():
    resp = client.post(
        "/api/proposal/runs",
        json=_create_run_body(
            trigger_purpose="rest_recommended",
            lifecycle_stage="after_rest_before_restart",
            motion_state="stopped",
        ),
    )
    assert resp.status_code == 201
    allowed = set(resp.json()["opportunity"]["allowed_service_ids"])
    assert allowed == {
        "live_viewing",
        "stretch_video",
        "full_karaoke",
        "oshi_reexperience",
        "call_response_stopped",
    }


# ---------------------------------------------------------------------------
# Every non-empty matrix row: ranked candidates are always a subset of that
# row's frozen allowed set (SC-002), swept across the whole matrix.
# ---------------------------------------------------------------------------


def _non_empty_rows():
    matrix = PurposeStageServiceMatrix.load(_MATRIX_PATH)
    return [row for row in matrix.rows if row.allowed_service_ids]


@pytest.mark.parametrize(
    "row_index",
    range(len(_non_empty_rows())),
    ids=[f"{r.trigger_purpose.value}/{r.lifecycle_stage.value}" for r in _non_empty_rows()],
)
def test_ranked_candidates_subset_of_allowed_set_for_every_non_empty_row(row_index):
    row = _non_empty_rows()[row_index]
    resp = client.post(
        "/api/proposal/runs",
        json=_create_run_body(
            trigger_purpose=row.trigger_purpose.value,
            lifecycle_stage=row.lifecycle_stage.value,
            motion_state=_motion_state_for(row.lifecycle_stage.value),
        ),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()

    allowed = set(body["opportunity"]["allowed_service_ids"])
    assert allowed == {s.value for s in row.allowed_service_ids}

    service_ev = body["evidence"][0]
    assert service_ev["error"] is None
    ranked = service_ev["output"]["ranked_candidates"]
    assert len(ranked) <= 3
    for cand in ranked:
        assert cand["candidate_id"] in allowed


def test_empty_allowed_set_row_can_never_produce_a_run():
    """during_rest_stopped resolves to an empty allowed_service_ids set; the
    ProposalOpportunity contract honestly refuses to construct such an
    opportunity rather than silently widening it -- so create-run 422s."""
    matrix = PurposeStageServiceMatrix.load(_MATRIX_PATH)
    empty_rows = [row for row in matrix.rows if not row.allowed_service_ids]
    assert len(empty_rows) == 1
    row = empty_rows[0]
    assert row.lifecycle_stage.value == "during_rest_stopped"

    resp = client.post(
        "/api/proposal/runs",
        json=_create_run_body(
            trigger_purpose=row.trigger_purpose.value,
            lifecycle_stage=row.lifecycle_stage.value,
            motion_state="stopped",
        ),
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# matrix_version is recorded on every created run (FR-012/013)
# ---------------------------------------------------------------------------


def test_created_run_records_the_frozen_matrix_version():
    matrix = PurposeStageServiceMatrix.load(_MATRIX_PATH)

    resp = client.post(
        "/api/proposal/runs",
        json=_create_run_body(
            trigger_purpose="rest_recommended",
            lifecycle_stage="after_rest_before_restart",
            motion_state="stopped",
        ),
    )
    body = resp.json()
    assert body["matrix_version"] == matrix.matrix_version

    service_ev = body["evidence"][0]
    assert service_ev["matrix_version"] == matrix.matrix_version


def test_get_matrix_endpoint_reports_the_same_version_used_by_runs():
    matrix_resp = client.get("/api/proposal/matrix").json()

    run_resp = client.post(
        "/api/proposal/runs",
        json=_create_run_body(
            trigger_purpose="rest_recommended",
            lifecycle_stage="after_rest_before_restart",
            motion_state="stopped",
        ),
    ).json()

    assert matrix_resp["matrix_version"] == run_resp["matrix_version"]
