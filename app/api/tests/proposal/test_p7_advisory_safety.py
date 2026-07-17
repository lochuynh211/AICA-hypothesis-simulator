"""TDD: P7 Unit E T027-T029 -- US4 advisory safety: reject-all after a
recompute exits safely, and a non-binding preview never commits (specs/017-
proposal-p7-e2e-vertical-slice/spec.md User Story 4; FR-016, FR-017; SC-004,
SC-005).

Both invariants are P4-era mechanisms (``_reject_service``/``_choose_another``/
``_eligible_pool`` in ``services/proposal_journey.py``; the pure-read ``GET
.../journey/preview`` handler) exercised ACROSS the P7 recompute boundary
(``POST /runs/{id}/recompute``, Unit B) -- this module drives them through
the REAL HTTP endpoints, the REAL transparent service-selector package
(``aica_transparent_service_selector_v1``), and the committed
``seed-night-highway-oshi`` seed (mirrors ``test_p7_recompute.py``'s
pattern), advancing to ``after_rest_before_restart`` where a recompute
yields five eligible after-rest services (disjoint from the pre-rest
driving-stage pool -- see ``purpose_stage_matrix.v1.json``), to prove:

  - FR-016/SC-005: rejecting every eligible service after a recompute
    reaches an explicit ``NO_ELIGIBLE_CANDIDATE`` end-state -- HTTP success
    throughout, never a 5xx, never a dead-ended run -- and the rejection
    pool drawn from is the RECOMPUTED opportunity's eligible set (the new
    head service evidence), not the stale pre-recompute one.
  - FR-017/SC-004: ``GET .../journey/preview`` on an in-progress
    (post-recompute) run leaves both the on-disk run file and the
    ``GET /runs/{id}`` response byte-identical / value-identical before and
    after the call -- the preview commits nothing.
"""
from __future__ import annotations

import json
import pathlib

import pytest
from fastapi.testclient import TestClient

from aica_api.config import settings
from aica_api.main import app

client = TestClient(app)

_SEED_ID = "seed-night-highway-oshi"
_REAL_SERVICE_PACKAGE_ID = "aica_transparent_service_selector_v1"
_MOCK_CONTENT_PACKAGE_ID = "mock_content_selector_v1"

# The seed's own pre-rest drowsiness/fatigue (test_p7_recompute.py's
# _HIGH_POST_REST) -- used as the recompute overrides here too; the exact
# values are inert to this unit (any post-rest pair still yields the same
# five-service after-rest eligible pool), only the STAGE transition matters.
_POST_REST = {"drowsiness_level": 80, "fatigue_level": 70}

# after_rest_before_restart's full allowed row, per
# proposal_contracts/matrix/purpose_stage_matrix.v1.json -- all five remain
# eligible while stopped with this seed's registered "oshi" entity (verified
# by direct harness experimentation; see Unit E report). Disjoint from the
# pre-rest before_rest_until_stop/driving row (music_playlist, humming_
# karaoke, quiz, ranking_creation, radio_style, call_response_driving).
_EXPECTED_RECOMPUTED_POOL = {
    "live_viewing",
    "stretch_video",
    "full_karaoke",
    "oshi_reexperience",
    "call_response_stopped",
}


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


def _recompute(run_id: str, overrides: list[dict] | None = None):
    return client.post(
        f"/api/proposal/runs/{run_id}/recompute",
        json={"overrides": overrides if overrides is not None else []},
    )


def _post_rest_overrides(drowsiness: int, fatigue: int) -> list[dict]:
    return [
        {"path": "situation.drowsiness_level", "value": drowsiness},
        {"path": "situation.fatigue_level", "value": fatigue},
    ]


def _service_evidence_list(run_log: dict) -> list[dict]:
    return [ev for ev in run_log["evidence"] if ev["step"] == "service"]


def _get_run(run_id: str):
    return client.get(f"/api/proposal/runs/{run_id}")


def _run_file_bytes(run_id: str, runs_dir: pathlib.Path) -> bytes:
    return (runs_dir / f"{run_id}.json").read_bytes()


def _recomputed_run(run_id_holder: list[str]) -> dict:
    """Create a run, advance it through the real rest sequence, recompute
    with the post-rest overrides, and return the recomputed body. Appends
    the run_id to ``run_id_holder`` (a 1-element list used as an out-param)
    so callers keep a handle on it."""
    created = _create_run()
    run_id = created["run_id"]
    run_id_holder.append(run_id)
    pre_pool = {c["candidate_id"] for c in _service_evidence_list(created)[-1]["input_snapshot"]["eligible_candidates"]}
    assert pre_pool != _EXPECTED_RECOMPUTED_POOL  # sanity: genuinely different stage/pool

    _advance_to_after_rest(run_id, drowsiness=_POST_REST["drowsiness_level"], fatigue=_POST_REST["fatigue_level"])

    resp = _recompute(run_id, _post_rest_overrides(_POST_REST["drowsiness_level"], _POST_REST["fatigue_level"]))
    assert resp.status_code == 200, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# T027 -- reject-all after a recompute exits safely to NO_ELIGIBLE_CANDIDATE
# (FR-016, SC-005), drawing from the RECOMPUTED opportunity's eligible pool.
# ---------------------------------------------------------------------------


def test_reject_all_after_recompute_reaches_no_eligible_candidate_safely():
    """Reject every eligible after-rest service (explicit selected_service_id
    each time, mirroring how a reviewer can name any offered candidate) --
    the run must stay HTTP-success throughout and end at an explicit
    NO_ELIGIBLE_CANDIDATE success event, never a 5xx / dead end."""
    run_id_holder: list[str] = []
    body = _recomputed_run(run_id_holder)
    run_id = run_id_holder[0]

    recomputed_pool = [
        c["candidate_id"] for c in _service_evidence_list(body)[-1]["input_snapshot"]["eligible_candidates"]
    ]
    assert set(recomputed_pool) == _EXPECTED_RECOMPUTED_POOL
    assert len(recomputed_pool) > 1  # "SEVERAL" eligible services (FR-016)

    for i, service_id in enumerate(recomputed_pool):
        resp = _journey_action(run_id, "reject", {"selected_service_id": service_id})
        assert resp.status_code == 200, resp.text  # never a 5xx
        tail = [e["event_type"] for e in resp.json()["events"][-2:]]

        is_last = i == len(recomputed_pool) - 1
        if is_last:
            assert tail == ["SERVICE_REJECTED", "NO_ELIGIBLE_CANDIDATE"]
        else:
            assert tail[-1] == "SERVICE_REJECTED"

    # The run remains reopenable -- a plain GET still returns 200 with the
    # full accumulated log, never an error status.
    final = _get_run(run_id)
    assert final.status_code == 200, final.text
    final_body = final.json()
    assert final_body["status"] == "service_selected"  # success end-state, not "error"
    assert final_body["journey_state"]["active_service_id"] is None

    # FR-016/SC-005: the rejection pool used was the RECOMPUTED opportunity's
    # eligible set, not the stale pre-recompute one -- every rejected id is
    # drawn from the after-rest pool and none from the pre-rest driving pool.
    assert set(final_body["journey_state"]["rejected_service_ids"]) == _EXPECTED_RECOMPUTED_POOL

    pre_recompute_pool = {
        "music_playlist", "humming_karaoke", "quiz", "ranking_creation", "radio_style", "call_response_driving",
    }
    assert set(final_body["journey_state"]["rejected_service_ids"]).isdisjoint(pre_recompute_pool)

    # choose_another now has nothing left to switch to -- a structured 422,
    # never a crash.
    exhausted = _journey_action(run_id, "choose_another")
    assert exhausted.status_code == 422
    assert exhausted.json()["detail"]["code"] == "no_eligible_candidate"


def test_reject_all_after_recompute_via_offered_walk_reaches_no_eligible_candidate():
    """Same invariant, walked the OTHER way the engine supports: reject the
    currently-offered service (no selected_service_id payload) then
    choose_another to the next eligible candidate, repeating until
    NO_ELIGIBLE_CANDIDATE. Proves the offered-service walk also terminates
    safely across the recompute boundary, not just the explicit-id path."""
    run_id_holder: list[str] = []
    body = _recomputed_run(run_id_holder)
    run_id = run_id_holder[0]
    pool_size = len(_service_evidence_list(body)[-1]["input_snapshot"]["eligible_candidates"])
    assert pool_size == len(_EXPECTED_RECOMPUTED_POOL)

    rejected_offered_ids: list[str] = []
    for i in range(pool_size + 1):  # +1 guard: never loop past the known pool size
        before = _get_run(run_id).json()
        offered = before["journey_state"]["active_service_id"]
        assert offered is not None, "expected an offered service before each reject"

        resp = _journey_action(run_id, "reject")
        assert resp.status_code == 200, resp.text  # never a 5xx
        rejected_offered_ids.append(offered)
        tail = [e["event_type"] for e in resp.json()["events"][-2:]]

        if "NO_ELIGIBLE_CANDIDATE" in tail:
            break

        choose = _journey_action(run_id, "choose_another")
        assert choose.status_code == 200, choose.text
    else:
        pytest.fail("reject/choose_another walk did not reach NO_ELIGIBLE_CANDIDATE within the pool size")

    assert set(rejected_offered_ids) == _EXPECTED_RECOMPUTED_POOL

    final = _get_run(run_id)
    assert final.status_code == 200, final.text
    assert final.json()["status"] == "service_selected"
    assert set(final.json()["journey_state"]["rejected_service_ids"]) == _EXPECTED_RECOMPUTED_POOL


# ---------------------------------------------------------------------------
# T028 -- GET .../journey/preview never commits (FR-017, SC-004).
# ---------------------------------------------------------------------------


def test_preview_on_in_progress_recomputed_run_leaves_it_byte_identical(tmp_path):
    """After a recompute (run is in-progress, at service_selected), capture
    the persisted run file bytes AND GET /runs/{id}; call the preview
    endpoint; re-read both -- assert byte-identical / value-identical."""
    run_id_holder: list[str] = []
    _recomputed_run(run_id_holder)
    run_id = run_id_holder[0]

    before_get = _get_run(run_id)
    assert before_get.status_code == 200
    before_body = before_get.json()
    before_bytes = _run_file_bytes(run_id, tmp_path)
    before_evidence_count = len(before_body["evidence"])
    assert before_body["status"] == "service_selected"

    preview_resp = client.get(f"/api/proposal/runs/{run_id}/journey/preview")
    assert preview_resp.status_code == 200, preview_resp.text
    assert preview_resp.json()["binding"] is False

    after_get = _get_run(run_id)
    assert after_get.status_code == 200
    after_body = after_get.json()
    after_bytes = _run_file_bytes(run_id, tmp_path)

    assert after_bytes == before_bytes, "preview must leave the on-disk run file byte-identical"
    assert after_body == before_body, "preview must leave the full GET /runs/{id} response identical"
    assert len(after_body["evidence"]) == before_evidence_count, (
        "preview must never invoke a selector / append AlgorithmEvidence"
    )
