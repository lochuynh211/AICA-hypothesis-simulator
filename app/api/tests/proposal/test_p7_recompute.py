"""TDD: P7 Unit B T013-T016 -- POST /api/proposal/runs/{run_id}/recompute (US1 MVP).

Covers (specs/017-proposal-p7-e2e-vertical-slice/):
  - contracts/recompute-api.md: request/response/error shapes + event order.
  - data-model.md: recompute's effect on ProposalRunLog history + JourneyState.
  - spec.md FR-001..FR-008, FR-006a, FR-019; SC-002, SC-003.

Drives the run through the real journey-action sequence
(rest_spot_arrived -> rest_started -> rest_completed) to reach
after_rest_before_restart/stopped -- the same sequence a reviewer performs on
the 4-panel screen (spec US2) -- then recomputes, using the REAL transparent
service-selector package (``aica_transparent_service_selector_v1``) and the
committed ``seed-night-highway-oshi`` seed (mirrors
``test_p5_run_integration.py``'s pattern). The content package is the P1 mock
(``mock_content_selector_v1``) throughout except where a test needs a broken
package -- US1 (interactive mode) never dispatches content from recompute
itself (that's US3/T025), so the content package choice is otherwise inert.
"""
from __future__ import annotations

import json
import shutil

import pytest
from fastapi.testclient import TestClient

from aica_api.config import settings
from aica_api.main import app

client = TestClient(app)

_SEED_ID = "seed-night-highway-oshi"
_REAL_SERVICE_PACKAGE_ID = "aica_transparent_service_selector_v1"
_MOCK_CONTENT_PACKAGE_ID = "mock_content_selector_v1"

# FR-008/SC-003 demonstration pair -- found by direct algorithm-harness
# experimentation (see Unit B report) against the real
# aica_transparent_service_selector_v1 package, the after_rest_before_restart
# allowed row ({live_viewing, stretch_video, full_karaoke, oshi_reexperience,
# call_response_stopped}), motion_state=stopped, and this seed's driver
# profile: high (80/70, the seed's own pre-rest values) ranks
# "stretch_video" #1; low (10/5) ranks "oshi_reexperience" #1.
_HIGH_POST_REST = {"drowsiness_level": 80, "fatigue_level": 70}
_LOW_POST_REST = {"drowsiness_level": 10, "fatigue_level": 5}


@pytest.fixture(autouse=True)
def isolate_proposal_runs_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(tmp_path))
    yield


def _load_seed_world_dict(seed_id: str = _SEED_ID) -> dict:
    path = settings.proposal_contracts_dir / "seeds" / f"{seed_id}.json"
    return json.loads(path.read_text(encoding="utf-8"))["world"]


def _typed_world_body(**overrides) -> dict:
    body = {
        "world": _load_seed_world_dict(),
        "service_package_id": _REAL_SERVICE_PACKAGE_ID,
        "content_package_id": _MOCK_CONTENT_PACKAGE_ID,
        "mode": "interactive",
        "run_seed": "seed-1",
        "simulation_time": "2026-07-17T10:00:00Z",
    }
    body.update(overrides)
    return body


def _create_run(**overrides) -> dict:
    resp = client.post("/api/proposal/runs", json=_typed_world_body(**overrides))
    assert resp.status_code == 201, resp.text
    return resp.json()


def _journey_action(run_id: str, action_type: str, payload: dict | None = None):
    return client.post(
        f"/api/proposal/runs/{run_id}/journey/action",
        json={"action_type": action_type, "payload": payload or {}},
    )


def _advance_to_after_rest(run_id: str, *, drowsiness: int, fatigue: int) -> dict:
    """Drive rest_spot_arrived -> rest_started -> rest_completed (US2
    sequence) so the run's journey_state reaches
    after_rest_before_restart/stopped, with the explicit post-rest values
    recorded on the REST_COMPLETED event (research.md D6)."""
    resp = _journey_action(run_id, "rest_spot_arrived")
    assert resp.status_code == 200, resp.text
    resp = _journey_action(run_id, "rest_started")
    assert resp.status_code == 200, resp.text
    resp = _journey_action(
        run_id,
        "rest_completed",
        {"post_rest": {"drowsiness_level": drowsiness, "fatigue_level": fatigue}},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _recompute(run_id: str, overrides: list[dict] | None = None, **body_overrides):
    body: dict = {"overrides": overrides if overrides is not None else []}
    body.update(body_overrides)
    return client.post(f"/api/proposal/runs/{run_id}/recompute", json=body)


def _post_rest_overrides(drowsiness: int, fatigue: int) -> list[dict]:
    return [
        {"path": "situation.drowsiness_level", "value": drowsiness},
        {"path": "situation.fatigue_level", "value": fatigue},
    ]


def _service_evidence_list(run_log: dict) -> list[dict]:
    return [ev for ev in run_log["evidence"] if ev["step"] == "service"]


def _get_run(run_id: str) -> dict:
    resp = client.get(f"/api/proposal/runs/{run_id}")
    assert resp.status_code == 200
    return resp.json()


# ---------------------------------------------------------------------------
# T013 -- contract + history (FR-004, SC-002)
# ---------------------------------------------------------------------------


def test_recompute_appends_new_decision_point_installs_new_head():
    created = _create_run()
    run_id = created["run_id"]
    _advance_to_after_rest(run_id, drowsiness=80, fatigue=70)
    pre_recompute = _get_run(run_id)

    resp = _recompute(run_id, _post_rest_overrides(80, 70))
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # History gained exactly the prior head (opportunity/setup_snapshot).
    assert len(body["opportunity_history"]) == 1
    assert body["opportunity_history"][0] == pre_recompute["opportunity"]
    assert len(body["setup_snapshot_history"]) == 1
    assert body["setup_snapshot_history"][0] == pre_recompute["setup_snapshot"]

    # A NEW head opportunity/setup_snapshot is installed.
    assert body["opportunity"]["opportunity_id"] != pre_recompute["opportunity"]["opportunity_id"]
    assert body["opportunity"]["lifecycle_stage"] == "after_rest_before_restart"
    assert body["opportunity"]["trigger_purpose"] == "rest_recommended"
    assert set(body["opportunity"]["allowed_service_ids"]) == {
        "live_viewing",
        "stretch_video",
        "full_karaoke",
        "oshi_reexperience",
        "call_response_stopped",
    }
    assert body["setup_snapshot"] is not None
    # Not asserted != pre_recompute["setup_snapshot"]: SetupSnapshot's shape
    # (origin/versions/feature_provenance) doesn't vary with lifecycle_stage
    # or situation *values* -- feature_provenance is structural metadata, not
    # the projected values themselves -- so identical package/dataset/origin
    # legitimately yields an identical SetupSnapshot here. It IS a genuinely
    # NEW object (installed as the head, with the prior one now in history),
    # asserted below via the history-length/identity checks instead.

    # Events appended in contract order (contracts/recompute-api.md). The
    # overrides list is non-empty (even though the values match the seed's
    # own pre-rest drowsiness/fatigue), so CONTEXT_EDITED is recorded too --
    # the contract keys it on a non-empty *overrides list*, not a value
    # change (see test_recompute_empty_overrides_no_context_edited_event for
    # the genuinely-empty-list case).
    new_event_types = [e["event_type"] for e in body["events"][len(pre_recompute["events"]) :]]
    assert new_event_types == ["CONTEXT_EDITED", "OPPORTUNITY_OPENED", "RECOMPUTED", "SERVICE_SELECTED"]

    recomputed_event = next(e for e in body["events"] if e["event_type"] == "RECOMPUTED")
    assert recomputed_event["payload"] == {
        "from_opportunity_id": pre_recompute["opportunity"]["opportunity_id"],
        "to_opportunity_id": body["opportunity"]["opportunity_id"],
    }

    # A new service AlgorithmEvidence entry was appended.
    service_evidence = _service_evidence_list(body)
    assert len(service_evidence) == 2
    assert service_evidence[0] == _service_evidence_list(pre_recompute)[0]
    assert service_evidence[1]["error"] is None
    assert service_evidence[1]["output"]["decision_type"] == "ranked_candidates"


def test_recompute_earlier_decision_point_unchanged():
    created = _create_run()
    run_id = created["run_id"]
    _advance_to_after_rest(run_id, drowsiness=80, fatigue=70)
    pre_recompute = _get_run(run_id)

    resp = _recompute(run_id, _post_rest_overrides(80, 70))
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["events"][: len(pre_recompute["events"])] == pre_recompute["events"]
    assert _service_evidence_list(body)[0] == _service_evidence_list(pre_recompute)[0]


def test_recompute_journey_state_resets_active_service_and_rejections():
    created = _create_run()
    run_id = created["run_id"]
    _advance_to_after_rest(run_id, drowsiness=80, fatigue=70)

    resp = _recompute(run_id, _post_rest_overrides(80, 70))
    assert resp.status_code == 200, resp.text
    body = resp.json()

    top_candidate = _service_evidence_list(body)[1]["output"]["ranked_candidates"][0]
    assert body["journey_state"]["active_service_id"] == top_candidate["candidate_id"]
    assert body["journey_state"]["rejected_service_ids"] == []
    # Preserved fields (data-model.md "State transitions").
    assert body["journey_state"]["lifecycle_stage"] == "after_rest_before_restart"
    assert body["journey_state"]["motion_state"] == "stopped"


# ---------------------------------------------------------------------------
# T014 -- determinism + no-override + context-edited (FR-007, D8)
# ---------------------------------------------------------------------------


def test_recompute_identical_overrides_are_byte_identical_deterministic():
    created_a = _create_run()
    created_b = _create_run()
    _advance_to_after_rest(created_a["run_id"], drowsiness=80, fatigue=70)
    _advance_to_after_rest(created_b["run_id"], drowsiness=80, fatigue=70)

    resp_a = _recompute(created_a["run_id"], _post_rest_overrides(20, 15))
    resp_b = _recompute(created_b["run_id"], _post_rest_overrides(20, 15))
    assert resp_a.status_code == 200 and resp_b.status_code == 200
    body_a, body_b = resp_a.json(), resp_b.json()

    assert body_a["setup_snapshot"] == body_b["setup_snapshot"]
    ev_a = _service_evidence_list(body_a)[1]
    ev_b = _service_evidence_list(body_b)[1]
    assert ev_a["input_snapshot"].get("feature_snapshot") == ev_b["input_snapshot"].get("feature_snapshot")
    assert ev_a["output"]["ranked_candidates"] == ev_b["output"]["ranked_candidates"]


def test_recompute_empty_overrides_no_context_edited_event():
    created = _create_run()
    run_id = created["run_id"]
    _advance_to_after_rest(run_id, drowsiness=80, fatigue=70)

    resp = _recompute(run_id, overrides=[])
    assert resp.status_code == 200, resp.text
    body = resp.json()

    event_types = [e["event_type"] for e in body["events"]]
    assert "CONTEXT_EDITED" not in event_types
    # Still recomputes for the current stage.
    assert body["opportunity"]["lifecycle_stage"] == "after_rest_before_restart"
    assert len(body["opportunity_history"]) == 1


def test_recompute_nonempty_overrides_records_one_context_edited_with_diffs():
    created = _create_run()
    run_id = created["run_id"]
    _advance_to_after_rest(run_id, drowsiness=80, fatigue=70)

    resp = _recompute(run_id, _post_rest_overrides(20, 15))
    assert resp.status_code == 200, resp.text
    body = resp.json()

    context_edited = [e for e in body["events"] if e["event_type"] == "CONTEXT_EDITED"]
    assert len(context_edited) == 1
    diffs = context_edited[0]["payload"]["diffs"]
    paths = {d["path"] for d in diffs}
    assert paths == {"situation.drowsiness_level", "situation.fatigue_level"}
    by_path = {d["path"]: d for d in diffs}
    assert by_path["situation.drowsiness_level"]["before"] == 80
    assert by_path["situation.drowsiness_level"]["after"] == 20
    assert by_path["situation.fatigue_level"]["before"] == 70
    assert by_path["situation.fatigue_level"]["after"] == 15

    # CONTEXT_EDITED precedes OPPORTUNITY_OPENED/RECOMPUTED/SERVICE_SELECTED.
    tail_types = [e["event_type"] for e in body["events"][-4:]]
    assert tail_types == ["CONTEXT_EDITED", "OPPORTUNITY_OPENED", "RECOMPUTED", "SERVICE_SELECTED"]


# ---------------------------------------------------------------------------
# T015 -- guards (FR-005, FR-006, FR-006a)
# ---------------------------------------------------------------------------


def test_recompute_legacy_run_without_typed_world_422():
    body = {
        "trigger_purpose": "rest_recommended",
        "lifecycle_stage": "after_rest_before_restart",
        "motion_state": "stopped",
        "world_snapshot": {
            "feature_snapshot": {"drowsiness_level": 72, "fatigue_level": 55},
            "feature_provenance": {},
        },
        "service_package_id": "mock_service_selector_v1",
        "content_package_id": _MOCK_CONTENT_PACKAGE_ID,
        "mode": "interactive",
        "run_seed": "seed-1",
        "simulation_time": "2026-07-16T10:00:00Z",
    }
    resp = client.post("/api/proposal/runs", json=body)
    assert resp.status_code == 201, resp.text
    run_id = resp.json()["run_id"]
    assert resp.json()["world"] is None

    recompute_resp = _recompute(run_id, overrides=[])
    assert recompute_resp.status_code == 422


def test_recompute_invalid_override_422_no_snapshot_appended():
    created = _create_run()
    run_id = created["run_id"]
    _advance_to_after_rest(run_id, drowsiness=80, fatigue=70)
    pre_recompute = _get_run(run_id)

    resp = _recompute(
        run_id,
        overrides=[{"path": "situation.drowsiness_level", "value": 999}],
    )
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert isinstance(detail, list) and detail
    assert all("path" in issue and "code" in issue and "message" in issue for issue in detail)

    unchanged = _get_run(run_id)
    assert unchanged == pre_recompute


def test_recompute_unknown_override_path_422():
    created = _create_run()
    run_id = created["run_id"]
    _advance_to_after_rest(run_id, drowsiness=80, fatigue=70)

    resp = _recompute(
        run_id,
        overrides=[{"path": "situation.does_not_exist", "value": 1}],
    )
    assert resp.status_code == 422


def test_recompute_dangling_catalog_reference_422():
    created = _create_run()
    run_id = created["run_id"]
    _advance_to_after_rest(run_id, drowsiness=80, fatigue=70)

    resp = _recompute(
        run_id,
        overrides=[{"path": "driver_profile.oshi_id", "value": "synthetic-artist-DOES-NOT-EXIST"}],
    )
    assert resp.status_code == 422


def test_recompute_rejected_while_playback_active_then_succeeds_after_stop():
    created = _create_run()
    run_id = created["run_id"]

    top_candidate = _service_evidence_list(created)[0]["output"]["ranked_candidates"][0]["candidate_id"]
    resp = client.post(
        f"/api/proposal/runs/{run_id}/select-service",
        json={"selected_service_id": top_candidate},
    )
    assert resp.status_code == 200, resp.text

    resp = _journey_action(run_id, "accept")
    assert resp.status_code == 200, resp.text
    assert resp.json()["journey_state"]["playback_state"] == "active"

    pre_recompute = _get_run(run_id)
    blocked = _recompute(run_id, overrides=[])
    assert blocked.status_code == 422
    detail = blocked.json()["detail"]
    assert isinstance(detail, dict)
    assert detail["code"] == "recompute_requires_idle_playback"

    # The run is unchanged by the rejected attempt.
    assert _get_run(run_id) == pre_recompute

    resp = _journey_action(run_id, "stop")
    assert resp.status_code == 200, resp.text
    assert resp.json()["journey_state"]["playback_state"] == "stopped"

    succeeded = _recompute(run_id, overrides=[])
    assert succeeded.status_code == 200, succeeded.text


# ---------------------------------------------------------------------------
# T016 -- post-rest change (FR-008/SC-003) + failure visibility (FR-019)
# ---------------------------------------------------------------------------


def test_recompute_high_vs_low_post_rest_changes_top_ranked_service():
    """FR-008/SC-003: a high-vs-low post-rest drowsiness/fatigue pair yields
    a different rank-1 SERVICE for the identical after_rest_before_restart
    opportunity -- proven against the REAL transparent service-selector
    package and the seed-night-highway-oshi seed (values found by direct
    algorithm-harness experimentation; see Unit B report)."""
    created = _create_run()
    run_id = created["run_id"]
    _advance_to_after_rest(
        run_id, drowsiness=_HIGH_POST_REST["drowsiness_level"], fatigue=_HIGH_POST_REST["fatigue_level"]
    )

    high_resp = _recompute(
        run_id, _post_rest_overrides(_HIGH_POST_REST["drowsiness_level"], _HIGH_POST_REST["fatigue_level"])
    )
    assert high_resp.status_code == 200, high_resp.text
    high_top = _service_evidence_list(high_resp.json())[-1]["output"]["ranked_candidates"][0]["candidate_id"]

    low_resp = _recompute(
        run_id, _post_rest_overrides(_LOW_POST_REST["drowsiness_level"], _LOW_POST_REST["fatigue_level"])
    )
    assert low_resp.status_code == 200, low_resp.text
    low_top = _service_evidence_list(low_resp.json())[-1]["output"]["ranked_candidates"][0]["candidate_id"]

    assert high_top != low_top

    # And the run genuinely accumulated a second recomputed decision point.
    final = low_resp.json()
    assert len(final["opportunity_history"]) == 2


def test_recompute_selector_error_records_algorithm_error_event_status_error(tmp_path, monkeypatch):
    pkgs_dir = tmp_path / "pkgs"
    pkgs_dir.mkdir()
    shutil.copytree(
        settings.packages_dir / "mock_content_selector_v1",
        pkgs_dir / "mock_content_selector_v1",
    )
    broken_dir = pkgs_dir / "broken_service_selector"
    broken_dir.mkdir()
    (broken_dir / "package.json").write_text(
        json.dumps(
            {
                "id": "broken_service_selector",
                "version": "1.0.0",
                "label": {"ja": "x", "en": "x"},
                "kind": "service_selector",
                "family": "service_selector",
                "approach": "transparent",
                "contract_version": "1.0.0",
                "algorithm": {
                    "type": "python_module",
                    "entrypoint": "algorithm.py",
                    "error_mode": "blocking",
                },
                "supported_services": [],
                "parameters": {},
                "hyperparameters": [],
            }
        ),
        encoding="utf-8",
    )
    (broken_dir / "algorithm.py").write_text(
        "def evaluate(context):\n    raise RuntimeError('boom')\n", encoding="utf-8"
    )
    monkeypatch.setenv("AICA_PACKAGES_DIR", str(pkgs_dir))

    created = _create_run(
        service_package_id="broken_service_selector", content_package_id="mock_content_selector_v1"
    )
    run_id = created["run_id"]
    assert created["status"] == "error"

    _advance_to_after_rest(run_id, drowsiness=80, fatigue=70)

    resp = _recompute(run_id, _post_rest_overrides(80, 70))
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["status"] == "error"
    event_types = [e["event_type"] for e in body["events"]]
    assert "ALGORITHM_ERROR" in event_types
    assert "SERVICE_SELECTED" not in event_types[-3:]

    service_evidence = _service_evidence_list(body)
    assert len(service_evidence) == 2
    assert service_evidence[-1]["error"] is not None
    assert "boom" in service_evidence[-1]["error"]["message"]
    assert service_evidence[-1]["output"] is None


def test_recompute_zero_eligible_records_no_eligible_candidate_never_fabricated(monkeypatch):
    from aica_api.models.proposal.eligibility import EligibilityExclusion, EligibilityResult
    from aica_api.models.proposal.enums import EligibilityReasonCode

    def _fake_resolve_eligibility(
        allowed_service_ids, motion_state, capabilities, *, registered_entities,
        unavailable_service_ids=frozenset(),
    ):
        return EligibilityResult(
            eligible=[],
            excluded=[
                EligibilityExclusion(
                    service_id=sid, reason_codes=[EligibilityReasonCode.catalog_item_unavailable]
                )
                for sid in allowed_service_ids
            ],
        )

    created = _create_run()
    run_id = created["run_id"]
    _advance_to_after_rest(run_id, drowsiness=80, fatigue=70)

    monkeypatch.setattr("aica_api.routers.proposal.resolve_eligibility", _fake_resolve_eligibility)

    resp = _recompute(run_id, _post_rest_overrides(80, 70))
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["journey_state"]["active_service_id"] is None
    event_types = [e["event_type"] for e in body["events"]]
    assert event_types[-3:] == ["OPPORTUNITY_OPENED", "RECOMPUTED", "NO_ELIGIBLE_CANDIDATE"]

    # No fabricated candidate: no new service evidence was appended.
    assert len(_service_evidence_list(body)) == len(_service_evidence_list(created))
