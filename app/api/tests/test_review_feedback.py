"""Review judgements ride the existing M5 append-only feedback store.

Model tests (FeedbackTarget's two new scopes) plus router tests for
``POST``/``GET /api/merged-runs/{merged_run_id}/review-feedback`` — both
delegate to the SAME append-only ``append_feedback`` (see
``services/feedback.py``) via the merged run's ``trigger_run_id``, so there
remains exactly one feedback store rather than a second parallel one.

Router-test merged-run construction mirrors ``tests/test_merged_runs_router.py``
(the established pattern for building a real merged run over HTTP): a trigger
run-plan draft + a committed typed World seed feed ``POST /api/merged-runs``.
The TestClient/env-dir-redirect fixture pattern mirrors
``tests/test_feedback_router.py``.
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from aica_api.config import settings
from aica_api.main import app
from aica_api.models.feedback import FeedbackEvent, FeedbackTarget
from aica_api.services.run_manager import clear_registry
from aica_api.services.run_plan import clear_draft_registry


# ── Model tests ────────────────────────────────────────────────────────────


def test_target_accepts_the_review_input_scope():
    target = FeedbackTarget(
        scope="review_input", case_id="case-tc-m01",
        checkpoint_id="monotony_prevention", stage="service",
        review_target="music_playlist", feature_id="monotony",
    )
    assert target.scope == "review_input"
    assert target.feature_id == "monotony"


def test_target_accepts_the_review_decision_scope_without_a_feature():
    target = FeedbackTarget(
        scope="review_decision", case_id="case-tc-m01",
        checkpoint_id="monotony_prevention", stage="service", review_target="music_playlist",
    )
    assert target.feature_id is None


def test_existing_scopes_still_validate():
    assert FeedbackTarget(scope="run").scope == "run"
    assert FeedbackTarget(scope="decision", event_ref=3).event_ref == 3


def test_an_unknown_scope_is_rejected():
    with pytest.raises(Exception):
        FeedbackTarget(scope="not_a_scope")


def test_review_event_round_trips():
    event = FeedbackEvent(
        kind="feedback",
        target=FeedbackTarget(
            scope="review_input", case_id="c", checkpoint_id="rest_required",
            stage="trigger", review_target="rest_required", feature_id="fatigue",
        ),
        labels={"judgment": "too_strong"},
    )
    assert FeedbackEvent(**event.model_dump()).labels["judgment"] == "too_strong"


# ── Router tests ───────────────────────────────────────────────────────────

client = TestClient(app)

_TRIGGER_PACKAGE_ID = "nri_fatigue_score_v1"
_TRIGGER_SCENARIO_ID = "uc01_fatigue_recovery_v0_1"
_SEED_ID = "seed-night-highway-oshi"
_SERVICE_PACKAGE_ID = "mock_service_selector_v1"
_CONTENT_PACKAGE_ID = "mock_content_selector_v1"


@pytest.fixture(autouse=True)
def isolate_dirs(tmp_path, monkeypatch):
    """Never let these tests write into real runs/proposal_runs/merged_runs."""
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path / "runs"))
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(tmp_path / "proposal_runs"))
    monkeypatch.setenv("AICA_MERGED_RUNS_DIR", str(tmp_path / "merged_runs"))
    clear_registry()
    clear_draft_registry()
    yield
    clear_registry()
    clear_draft_registry()


@pytest.fixture()
def rest_plan_id() -> str:
    resp = client.post(
        "/api/run-plans",
        json={"package_id": _TRIGGER_PACKAGE_ID, "scenario_id": _TRIGGER_SCENARIO_ID},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["plan_id"]


@pytest.fixture()
def base_world_dict() -> dict:
    path = settings.proposal_contracts_dir / "seeds" / f"{_SEED_ID}.json"
    return json.loads(path.read_text(encoding="utf-8"))["world"]


@pytest.fixture()
def merged_run_id(rest_plan_id, base_world_dict) -> str:
    r = client.post(
        "/api/merged-runs",
        json={
            "trigger_plan_id": rest_plan_id,
            "world": base_world_dict,
            "service_package_id": _SERVICE_PACKAGE_ID,
            "content_package_id": _CONTENT_PACKAGE_ID,
            "run_seed": "7",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()["merged_run_id"]


def _review_input_body(**overrides) -> dict:
    body = {
        "scope": "review_input",
        "case_id": "case-tc-m01",
        "checkpoint_id": "monotony_prevention",
        "stage": "service",
        "review_target": "music_playlist",
        "feature_id": "monotony",
        "labels": {"judgment": "too_strong"},
    }
    body.update(overrides)
    return body


class TestPostReviewFeedback:
    def test_posting_a_review_judgement_appends_to_the_trigger_run_log(self, merged_run_id):
        resp = client.post(
            f"/api/merged-runs/{merged_run_id}/review-feedback",
            json=_review_input_body(),
        )
        assert resp.status_code == 201, resp.text

        get_resp = client.get(f"/api/merged-runs/{merged_run_id}")
        assert get_resp.status_code == 200
        trigger_log = get_resp.json()["trigger_log"]
        feedback_events = [e for e in trigger_log["events"] if e.get("kind") == "feedback"]
        assert len(feedback_events) == 1
        assert feedback_events[0]["target"]["scope"] == "review_input"
        assert feedback_events[0]["target"]["feature_id"] == "monotony"

    def test_posting_twice_appends_rather_than_replacing(self, merged_run_id):
        """Append-only: two judgements on the SAME feature append twice — the
        reviewer's earlier opinion is never overwritten."""
        first = client.post(
            f"/api/merged-runs/{merged_run_id}/review-feedback",
            json=_review_input_body(labels={"judgment": "too_strong"}),
        )
        assert first.status_code == 201, first.text
        second = client.post(
            f"/api/merged-runs/{merged_run_id}/review-feedback",
            json=_review_input_body(labels={"judgment": "rational"}),
        )
        assert second.status_code == 201, second.text

        get_resp = client.get(f"/api/merged-runs/{merged_run_id}")
        trigger_log = get_resp.json()["trigger_log"]
        feedback_events = [e for e in trigger_log["events"] if e.get("kind") == "feedback"]
        # Both judgements must be present — a replacing implementation would
        # leave exactly one event (the second), which this length check catches.
        assert len(feedback_events) == 2
        judgments = [e["labels"]["judgment"] for e in feedback_events]
        assert judgments == ["too_strong", "rational"]

    def test_an_unknown_merged_run_is_404(self):
        resp = client.post(
            "/api/merged-runs/mrun_does_not_exist/review-feedback",
            json=_review_input_body(),
        )
        assert resp.status_code == 404


class TestGetReviewFeedback:
    def test_getting_review_feedback_returns_the_package_versions(self, merged_run_id):
        client.post(
            f"/api/merged-runs/{merged_run_id}/review-feedback",
            json=_review_input_body(),
        )
        resp = client.get(f"/api/merged-runs/{merged_run_id}/review-feedback")
        assert resp.status_code == 200, resp.text
        body = resp.json()

        assert len(body["events"]) == 1
        versions = body["package_versions"]
        assert versions["trigger"]["id"] == _TRIGGER_PACKAGE_ID
        assert versions["trigger"]["version"] == "0.1"
        assert versions["service"]["id"] == _SERVICE_PACKAGE_ID
        assert versions["service"]["version"] == "1.0.0"
        assert versions["content"]["id"] == _CONTENT_PACKAGE_ID
        assert versions["content"]["version"] == "1.0.0"

    def test_an_unknown_merged_run_is_404(self):
        resp = client.get("/api/merged-runs/mrun_does_not_exist/review-feedback")
        assert resp.status_code == 404

    def test_non_review_feedback_on_the_trigger_run_is_excluded(self, merged_run_id):
        """GET only returns review_input/review_decision records — a plain
        scope="run" feedback event on the SAME trigger run (e.g. left over
        from the trigger-only screen) must not leak into the review export."""
        get_resp = client.get(f"/api/merged-runs/{merged_run_id}")
        trigger_run_id = get_resp.json()["handle"]["trigger_run_id"]

        plain = client.post(
            f"/api/runs/{trigger_run_id}/feedback",
            json={"target": {"scope": "run"}, "comment": "unrelated trigger-screen note"},
        )
        assert plain.status_code == 201, plain.text

        client.post(
            f"/api/merged-runs/{merged_run_id}/review-feedback",
            json=_review_input_body(),
        )

        resp = client.get(f"/api/merged-runs/{merged_run_id}/review-feedback")
        assert resp.status_code == 200
        events = resp.json()["events"]
        assert len(events) == 1
        assert events[0]["target"]["scope"] == "review_input"
