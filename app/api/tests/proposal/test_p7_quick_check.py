"""TDD: P7 Unit D T022-T023 -- per-run `quick_check` mode (US3).

Covers (specs/017-proposal-p7-e2e-vertical-slice/):
  - contracts/recompute-api.md: "Behavior change: POST /runs (create) — mode"
    + the quick-check content-dispatch rule shared with recompute.
  - spec.md US3 scenarios; FR-011..FR-014; SC-006, SC-007; FR-009.

Drives the REAL FastAPI TestClient against the REAL transparent packages
(``aica_transparent_service_selector_v1`` / ``aica_transparent_content_selector_v1``)
and the committed ``seed-night-highway-oshi`` seed -- quick-check's whole
point is dispatching REAL content, so the P1 mock content package would
under-test the interesting path (real service catalogue, real supported-
services gate).

Two override combinations were found by direct experimentation against this
seed + these packages (mirrors Unit B's own documented method):
  - After ``rest_completed`` with HIGH drowsiness/fatigue (80/70), the
    after-rest rank-1 is ``stretch_video`` -- NOT in the content package's
    ``supported_services`` ({music_playlist, humming_karaoke, full_karaoke}).
    Used to prove the unsupported-service content gate (never a fabricated
    plan).
  - Adding ``situation.child_present=True`` (with moderate drowsiness/
    fatigue) tips the after-rest rank-1 to ``full_karaoke`` -- a SUPPORTED
    service -- used to prove a quick-check recompute reaches
    ``content_selected`` in one response.
  - At the pre-rest (``before_rest_until_stop``/driving) stage, this seed's
    OWN pre-rest drowsiness/fatigue values (80/70, no overrides) already
    rank ``humming_karaoke`` #1 -- also SUPPORTED -- used for the create-time
    and parity assertions.
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from aica_api.config import settings
from aica_api.main import app

client = TestClient(app)

_SEED_ID = "seed-night-highway-oshi"
_REAL_SERVICE_PACKAGE_ID = "aica_transparent_service_selector_v1"
_REAL_CONTENT_PACKAGE_ID = "aica_transparent_content_selector_v1"

# FR-008/SC-003-style demonstration values (found by direct algorithm-harness
# experimentation against the real packages + this seed -- see module
# docstring and the Unit D report).
_UNSUPPORTED_RANK1_OVERRIDES = [
    {"path": "situation.drowsiness_level", "value": 80},
    {"path": "situation.fatigue_level", "value": 70},
]  # after-rest rank-1 = "stretch_video" (unsupported by the content package)

_SUPPORTED_RANK1_OVERRIDES = [
    {"path": "situation.drowsiness_level", "value": 30},
    {"path": "situation.fatigue_level", "value": 30},
    {"path": "situation.child_present", "value": True},
    {"path": "situation.multiple_passengers", "value": True},
]  # after-rest rank-1 = "full_karaoke" (supported by the content package)


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
        "content_package_id": _REAL_CONTENT_PACKAGE_ID,
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


def _recompute(run_id: str, overrides: list[dict] | None = None, **body_overrides):
    body: dict = {"overrides": overrides if overrides is not None else []}
    body.update(body_overrides)
    return client.post(f"/api/proposal/runs/{run_id}/recompute", json=body)


def _get_run(run_id: str) -> dict:
    resp = client.get(f"/api/proposal/runs/{run_id}")
    assert resp.status_code == 200, resp.text
    return resp.json()


def _service_evidence_list(run_log: dict) -> list[dict]:
    return [ev for ev in run_log["evidence"] if ev["step"] == "service"]


def _content_evidence_list(run_log: dict) -> list[dict]:
    return [ev for ev in run_log["evidence"] if ev["step"] == "content"]


def _event_types(run_log: dict) -> list[str]:
    return [e["event_type"] for e in run_log["events"]]


# ---------------------------------------------------------------------------
# T022 -- create: quick_check reaches content_selected in one response;
# interactive stops at service_selected (FR-011-FR-013).
# ---------------------------------------------------------------------------


def test_create_quick_check_reaches_content_selected_in_one_response():
    run = _create_run(mode="quick_check")

    assert run["status"] == "content_selected"
    assert run["mode"] == "quick_check"

    event_types = _event_types(run)
    assert event_types == ["OPPORTUNITY_OPENED", "SERVICE_SELECTED", "CONTENT_SELECTED"]

    service_ev = _service_evidence_list(run)
    assert len(service_ev) == 1
    rank1 = service_ev[0]["output"]["ranked_candidates"][0]["candidate_id"]

    content_ev = _content_evidence_list(run)
    assert len(content_ev) == 1
    assert content_ev[0]["package_id"] == _REAL_CONTENT_PACKAGE_ID
    assert content_ev[0]["error"] is None
    plan = content_ev[0]["output"]
    assert plan["decision_type"] == "complete_plan"
    assert plan["selected_service_id"] == rank1
    assert plan["ordered_items"]

    # active_service_id already reflects the auto-selected rank-1 (create's
    # existing unconditional convention -- unchanged by quick-check).
    assert run["journey_state"]["active_service_id"] == rank1


def test_create_interactive_stops_at_service_selected():
    run = _create_run(mode="interactive")

    assert run["status"] == "service_selected"
    assert run["mode"] == "interactive"
    assert _event_types(run) == ["OPPORTUNITY_OPENED", "SERVICE_SELECTED"]
    assert _content_evidence_list(run) == []


# ---------------------------------------------------------------------------
# T023 -- recompute quick_check + parity + no-probabilistic + no-eligible.
# ---------------------------------------------------------------------------


def test_recompute_quick_check_reaches_content_selected_in_one_response():
    created = _create_run(mode="quick_check")
    run_id = created["run_id"]
    _advance_to_after_rest(run_id, drowsiness=30, fatigue=30)
    pre_recompute = _get_run(run_id)

    resp = _recompute(run_id, _SUPPORTED_RANK1_OVERRIDES)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["status"] == "content_selected"
    new_event_types = _event_types(body)[len(_event_types(pre_recompute)) :]
    assert new_event_types == [
        "CONTEXT_EDITED",
        "OPPORTUNITY_OPENED",
        "RECOMPUTED",
        "SERVICE_SELECTED",
        "CONTENT_SELECTED",
    ]

    rank1 = _service_evidence_list(body)[-1]["output"]["ranked_candidates"][0]["candidate_id"]
    assert rank1 == "full_karaoke"

    content_ev = _content_evidence_list(body)
    # `created` was itself quick_check (content_selected already at create,
    # pre-rest humming_karaoke) -- this recompute's dispatch is the SECOND.
    assert len(content_ev) == len(_content_evidence_list(pre_recompute)) + 1
    assert content_ev[-1]["error"] is None
    plan = content_ev[-1]["output"]
    assert plan["decision_type"] == "complete_plan"
    assert plan["selected_service_id"] == "full_karaoke"
    assert plan["lighting_configuration"] is not None

    assert body["journey_state"]["active_service_id"] == "full_karaoke"


def test_recompute_quick_check_unsupported_rank1_records_algorithm_error_never_fabricates_plan():
    created = _create_run(mode="quick_check")
    run_id = created["run_id"]
    # `created` is itself quick_check (content_selected already at create,
    # pre-rest humming_karaoke) -- this recompute's own content dispatch is
    # the one under test here, and must NOT add a second content evidence.
    _advance_to_after_rest(run_id, drowsiness=80, fatigue=70)

    resp = _recompute(run_id, _UNSUPPORTED_RANK1_OVERRIDES)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    rank1 = _service_evidence_list(body)[-1]["output"]["ranked_candidates"][0]["candidate_id"]
    assert rank1 == "stretch_video"  # confirmed not in the content package's supported_services

    assert body["status"] == "error"
    event_types = _event_types(body)
    assert event_types[-2:] == ["SERVICE_SELECTED", "ALGORITHM_ERROR"]

    # No NEW content evidence was ever appended for this recompute -- never
    # a fabricated plan (only the earlier create-time entry still exists).
    assert len(_content_evidence_list(body)) == len(_content_evidence_list(created))

    error_event = next(
        e for e in body["events"] if e["event_type"] == "ALGORITHM_ERROR" and e["payload"].get("step") == "content"
    )
    assert "unsupported" in error_event["payload"]["category"]


def test_quick_check_parity_rank1_equals_interactive_rank1_for_same_snapshot():
    """FR-014/SC-006: for the SAME frozen world/seed/packages/params, the
    quick-check auto-selected rank-1 service equals the interactive rank-1
    (top of ``ranked_candidates``)."""
    quick = _create_run(mode="quick_check")
    interactive = _create_run(mode="interactive")

    quick_rank1 = _service_evidence_list(quick)[0]["output"]["ranked_candidates"][0]["candidate_id"]
    interactive_rank1 = _service_evidence_list(interactive)[0]["output"]["ranked_candidates"][0]["candidate_id"]

    assert quick_rank1 == interactive_rank1
    # And quick-check's own journey_state/active_service_id reflects it.
    assert quick["journey_state"]["active_service_id"] == quick_rank1

    # The content dispatched by quick-check is the SAME content select-service
    # would produce for the identical rank-1 (both paths call
    # `_dispatch_content_for_service`) -- select-service the interactive
    # run explicitly and diff the two plans' decision-relevant fields.
    selected = client.post(
        f"/api/proposal/runs/{interactive['run_id']}/select-service",
        json={"selected_service_id": interactive_rank1},
    )
    assert selected.status_code == 200, selected.text
    interactive_plan = _content_evidence_list(selected.json())[-1]["output"]
    quick_plan = _content_evidence_list(quick)[-1]["output"]

    assert quick_plan["decision_type"] == interactive_plan["decision_type"]
    assert quick_plan["selected_service_id"] == interactive_plan["selected_service_id"]
    assert quick_plan["ordered_items"] == interactive_plan["ordered_items"]


def _walk_keys(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield k
            yield from _walk_keys(v)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            yield from _walk_keys(v)


def test_no_probabilistic_acceptance_or_recovery_anywhere_in_run(monkeypatch):
    """FR-009/SC-007: no acceptance/recovery PROBABILITY field is generated
    anywhere in the run output/evidence (the transparent packages set
    ``uncertainty: null``, never a probability), and post-rest values in the
    persisted output trace back only to the EXPLICIT override supplied --
    never something the system computed on its own."""
    created = _create_run(mode="quick_check")
    run_id = created["run_id"]
    _advance_to_after_rest(run_id, drowsiness=30, fatigue=30)

    resp = _recompute(run_id, _SUPPORTED_RANK1_OVERRIDES)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "content_selected"

    forbidden_key_hits = [k for k in _walk_keys(body) if "probability" in k.lower()]
    assert forbidden_key_hits == []

    # uncertainty is explicitly present and null -- not a probability.
    rank1_candidate = _service_evidence_list(body)[-1]["output"]["ranked_candidates"][0]
    assert rank1_candidate["uncertainty"] is None

    # Post-rest drowsiness/fatigue are exactly the explicit overrides applied
    # -- traced through the persisted head world_snapshot's projected
    # feature_snapshot, never independently generated.
    situation = body["world_snapshot"]["feature_snapshot"]["situation"]
    applied = {o["path"].split(".")[-1]: o["value"] for o in _SUPPORTED_RANK1_OVERRIDES}
    assert situation["drowsiness_level"] == applied["drowsiness_level"]
    assert situation["fatigue_level"] == applied["fatigue_level"]


def test_quick_check_no_eligible_service_stays_at_service_selected_no_content_fabricated(monkeypatch):
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

    monkeypatch.setattr("aica_api.routers.proposal.resolve_eligibility", _fake_resolve_eligibility)

    run = _create_run(mode="quick_check")

    assert run["status"] == "service_selected"
    assert _event_types(run) == ["OPPORTUNITY_OPENED", "NO_ELIGIBLE_CANDIDATE"]
    assert run["journey_state"]["active_service_id"] is None
    assert _service_evidence_list(run) == []
    assert _content_evidence_list(run) == []
