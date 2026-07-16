"""TDD: US1 eligibility resolver wired into POST /api/proposal/runs — T015/T016/T017a.

Eligibility runs BEFORE the (mock) service selector ranks candidates
(research.md D1): excluded services are RETAINED in the STEP-1 evidence with
platform reason codes — never dropped — and carry no score; only eligible
services can ever appear in the ranked output (SC-003).
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from aica_api.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def isolate_proposal_runs_dir(tmp_path, monkeypatch):
    """Never let these tests write into the real proposal_runs/ directory."""
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(tmp_path))
    yield


def _body(**overrides) -> dict:
    body = {
        "trigger_purpose": "rest_recommended",
        "lifecycle_stage": "after_rest_before_restart",
        "motion_state": "driving",
        "world_snapshot": {
            "feature_snapshot": {"oshi_registered": False},
            "feature_provenance": {},
        },
        "service_package_id": "mock_service_selector_v1",
        "content_package_id": "mock_content_selector_v1",
        "mode": "interactive",
        "enabled_feature_extensions": [],
        "parameters": {},
        "hyperparameters": {},
        "run_seed": "seed-1",
        "simulation_time": "2026-07-16T10:00:00Z",
    }
    body.update(overrides)
    return body


# ---------------------------------------------------------------------------
# rest_recommended / after_rest_before_restart, driving, no oshi registered
# ---------------------------------------------------------------------------


class TestEligibilityNarrowsWhileDriving:
    def test_excluded_candidates_retained_with_platform_reasons(self):
        resp = client.post("/api/proposal/runs", json=_body())
        assert resp.status_code == 201
        body = resp.json()
        ev = body["evidence"][0]
        excluded = {
            c["candidate_id"]: c["platform_reason"]
            for c in ev["input_snapshot"]["excluded_candidates"]
        }
        assert excluded["full_karaoke"] == "full_karaoke_requires_stopped"
        assert excluded["stretch_video"] == "stopped_only_while_driving"
        assert excluded["call_response_stopped"] == "stopped_only_while_driving"
        assert excluded["oshi_reexperience"] == "stopped_only_while_driving,missing_required_entity"

    def test_eligible_candidates_excludes_them_but_includes_live_viewing(self):
        resp = client.post("/api/proposal/runs", json=_body())
        body = resp.json()
        ev = body["evidence"][0]
        eligible_ids = {c["candidate_id"] for c in ev["input_snapshot"]["eligible_candidates"]}
        assert eligible_ids == {"live_viewing"}

    def test_ranked_service_output_contains_only_eligible_services(self):
        """SC-003: the ranked output must never contain an out-of-row or
        excluded service."""
        resp = client.post("/api/proposal/runs", json=_body())
        body = resp.json()
        ev = body["evidence"][0]
        assert ev["error"] is None
        ranked_ids = {c["candidate_id"] for c in ev["output"]["ranked_candidates"]}
        assert ranked_ids == {"live_viewing"}
        assert body["journey_state"]["active_service_id"] == "live_viewing"

    def test_platform_reason_strings_carry_no_numeric_score(self):
        resp = client.post("/api/proposal/runs", json=_body())
        body = resp.json()
        ev = body["evidence"][0]
        excluded = ev["input_snapshot"]["excluded_candidates"]
        assert excluded, "expected at least one excluded candidate in this fixture"
        for c in excluded:
            assert isinstance(c["platform_reason"], str)
            assert not any(ch.isdigit() for ch in c["platform_reason"])


# ---------------------------------------------------------------------------
# Same row, stopped + oshi registered -> nothing excluded
# ---------------------------------------------------------------------------


class TestEligibilityWidensWhenStoppedAndOshiRegistered:
    def test_all_five_eligible_none_excluded(self):
        resp = client.post(
            "/api/proposal/runs",
            json=_body(
                motion_state="stopped",
                world_snapshot={
                    "feature_snapshot": {"oshi_registered": True},
                    "feature_provenance": {},
                },
            ),
        )
        assert resp.status_code == 201
        body = resp.json()
        ev = body["evidence"][0]
        assert ev["input_snapshot"]["excluded_candidates"] == []
        eligible_ids = {c["candidate_id"] for c in ev["input_snapshot"]["eligible_candidates"]}
        assert eligible_ids == {
            "live_viewing",
            "stretch_video",
            "full_karaoke",
            "oshi_reexperience",
            "call_response_stopped",
        }


# ---------------------------------------------------------------------------
# T017a — empty-eligible at create-time
# ---------------------------------------------------------------------------


class TestNoEligibleCandidateAtCreateTime:
    def test_during_rest_stopped_still_422s_upstream_never_a_500(self):
        """during_rest_stopped resolves to an EMPTY allowed row in the frozen
        matrix (proposal_contracts/matrix/purpose_stage_matrix.v1.json). That
        empty row already fails ``ProposalOpportunity``'s own non-empty
        ``allowed_service_ids`` validator (see
        test_opportunity_contract.py::test_during_rest_stopped_rejected_as_expected)
        BEFORE eligibility resolution is ever reached in this handler — a
        coherent 422, never a fabricated run or a 500. This pins that
        pre-existing (and still correct) behavior; the genuinely-reachable
        T017a case — a NON-empty allowed row narrowed to zero by
        eligibility — is covered by
        ``test_all_allowed_excluded_yields_no_eligible_candidate_event``
        below, since no real matrix row + capability combination can produce
        an empty ELIGIBLE set on its own (``live_viewing``'s
        ``background_on_motion`` always survives motion exclusion, and no
        other row's services carry a ``requires_entity`` capability)."""
        resp = client.post(
            "/api/proposal/runs",
            json=_body(lifecycle_stage="during_rest_stopped", motion_state="stopped"),
        )
        assert resp.status_code == 422

    def test_all_allowed_excluded_yields_no_eligible_candidate_event(self, monkeypatch):
        """Force every allowed service to be excluded (monkeypatching
        resolve_eligibility as imported into the router) to exercise the
        genuinely-reachable T017a branch: dispatch_selector is never called,
        an OPPORTUNITY_OPENED + NO_ELIGIBLE_CANDIDATE event pair is
        recorded, status is service_selected with no active service, and no
        service AlgorithmEvidence is fabricated."""
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
                        service_id=sid,
                        reason_codes=[EligibilityReasonCode.catalog_item_unavailable],
                    )
                    for sid in allowed_service_ids
                ],
            )

        monkeypatch.setattr(
            "aica_api.routers.proposal.resolve_eligibility", _fake_resolve_eligibility
        )

        resp = client.post("/api/proposal/runs", json=_body())
        assert resp.status_code == 201
        body = resp.json()

        assert body["status"] == "service_selected"
        assert body["journey_state"]["active_service_id"] is None
        assert body["evidence"] == []

        event_types = [e["event_type"] for e in body["events"]]
        assert event_types == ["OPPORTUNITY_OPENED", "NO_ELIGIBLE_CANDIDATE"]

        no_eligible_event = body["events"][-1]
        excluded_payload = no_eligible_event["payload"]["excluded"]
        assert len(excluded_payload) == 5
        assert all(e["reason_codes"] == ["catalog_item_unavailable"] for e in excluded_payload)
