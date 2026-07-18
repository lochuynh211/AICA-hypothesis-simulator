"""TDD: POST /api/proposal/runs/{run_id}/explain — feature 019 (LLM rationale).

Covers: browser build-only (prompt returned, nothing persisted), backend
success (persists exactly one Explanation, returns parsed [ja,en]), backend
Ollama failure (honest fallback to template, still persisted, fell_back=True),
and 404 / 422 validation. Ollama is never called live — ``generate`` is
monkeypatched.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from aica_api.main import app
from aica_api.services import ollama_client

client = TestClient(app)


@pytest.fixture(autouse=True)
def isolate_proposal_runs_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(tmp_path))
    yield


def _create_run_body(**overrides) -> dict:
    body = {
        "trigger_purpose": "rest_recommended",
        "lifecycle_stage": "after_rest_before_restart",
        "motion_state": "stopped",
        "world_snapshot": {
            "feature_snapshot": {"drowsiness_level": 72, "fatigue_level": 55},
            "feature_provenance": {},
            "profile_id": "profile-test-1",
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


def _run_with_service_and_content() -> tuple[str, str, str]:
    """Create a run + select a service, returning (run_id, service_id, item_id).

    The service-step explain target is the real rank-1 candidate (always present
    in the recorded service evidence); ``full_karaoke`` is selected for STEP 2
    because the mock content package can serve it (mirrors test_ep_get_run).
    """
    created = client.post("/api/proposal/runs", json=_create_run_body()).json()
    run_id = created["run_id"]
    svc_ev = next(e for e in created["evidence"] if e["step"] == "service")
    service_id = svc_ev["output"]["ranked_candidates"][0]["candidate_id"]

    resp = client.post(
        f"/api/proposal/runs/{run_id}/select-service",
        json={"selected_service_id": "full_karaoke"},
    )
    assert resp.status_code == 200, resp.text
    selected = resp.json()
    content_ev = next(e for e in selected["evidence"] if e["step"] == "content")
    item_id = content_ev["output"]["ordered_items"][0]["item_id"]
    return run_id, service_id, item_id


def test_browser_provider_returns_prompt_and_persists_nothing():
    run_id, service_id, _ = _run_with_service_and_content()

    resp = client.post(
        f"/api/proposal/runs/{run_id}/explain",
        json={"step": "service", "target_id": service_id, "provider": "browser"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["provider_used"] == "browser"
    assert data["rationale"] == []
    assert data["prompt"]["messages"][0]["role"] == "system"
    assert service_id in data["prompt"]["messages"][1]["content"]

    # Nothing persisted for the browser path (display-only).
    reopened = client.get(f"/api/proposal/runs/{run_id}").json()
    assert reopened["explanations"] == []


def test_backend_provider_generates_persists_and_parses(monkeypatch):
    run_id, service_id, _ = _run_with_service_and_content()

    monkeypatch.setattr(
        ollama_client,
        "generate",
        lambda messages, **kw: "JA: 眠気が高いため休憩を提案します。\nEN: High drowsiness drives this rest suggestion.",
    )

    resp = client.post(
        f"/api/proposal/runs/{run_id}/explain",
        json={"step": "service", "target_id": service_id, "provider": "backend"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["provider_used"] == "backend"
    assert data["fell_back"] is False
    assert data["rationale"] == [
        "眠気が高いため休憩を提案します。",
        "High drowsiness drives this rest suggestion.",
    ]

    # Exactly one append-only Explanation persisted, carrying the model + hash.
    reopened = client.get(f"/api/proposal/runs/{run_id}").json()
    assert len(reopened["explanations"]) == 1
    rec = reopened["explanations"][0]
    assert rec["provider_used"] == "backend"
    assert rec["target_id"] == service_id
    assert rec["prompt_hash"] and rec["generated_at"]


def test_backend_failure_falls_back_to_template_and_records_honestly(monkeypatch):
    run_id, service_id, _ = _run_with_service_and_content()

    def boom(messages, **kw):
        raise ollama_client.OllamaError("unreachable", "no ollama")

    monkeypatch.setattr(ollama_client, "generate", boom)

    resp = client.post(
        f"/api/proposal/runs/{run_id}/explain",
        json={"step": "service", "target_id": service_id, "provider": "backend"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["fell_back"] is True
    assert data["provider_used"] == "template"
    assert data["error"] == "unreachable"
    # The template fallback is a real, non-empty [ja, en] pair (never blank).
    assert len(data["rationale"]) == 2

    reopened = client.get(f"/api/proposal/runs/{run_id}").json()
    assert len(reopened["explanations"]) == 1
    assert reopened["explanations"][0]["fell_back"] is True


def test_backend_content_step(monkeypatch):
    run_id, _, item_id = _run_with_service_and_content()
    monkeypatch.setattr(ollama_client, "generate", lambda messages, **kw: "JA: 曲の理由\nEN: song reason")

    resp = client.post(
        f"/api/proposal/runs/{run_id}/explain",
        json={"step": "content", "target_id": item_id, "provider": "backend"},
    )
    assert resp.status_code == 200
    assert resp.json()["rationale"] == ["曲の理由", "song reason"]


def test_backend_empty_output_falls_back_to_template(monkeypatch):
    """Ollama returns blank/whitespace → honest template fallback (not blank)."""
    run_id, service_id, _ = _run_with_service_and_content()
    monkeypatch.setattr(ollama_client, "generate", lambda messages, **kw: "   \n  \n")

    resp = client.post(
        f"/api/proposal/runs/{run_id}/explain",
        json={"step": "service", "target_id": service_id, "provider": "backend"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["fell_back"] is True
    assert data["provider_used"] == "template"
    assert data["error"] == "unusable_response"
    assert len(data["rationale"]) == 2 and any(r for r in data["rationale"])


def test_explain_422_no_decision_for_step_without_evidence():
    """Explain for a step with no recorded decision yet → 422 no_decision."""
    created = client.post("/api/proposal/runs", json=_create_run_body()).json()
    run_id = created["run_id"]
    # No select-service was called, so there is no 'content' evidence.
    resp = client.post(
        f"/api/proposal/runs/{run_id}/explain",
        json={"step": "content", "target_id": "anything", "provider": "browser"},
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "no_decision"


def test_explain_404_unknown_run():
    resp = client.post(
        "/api/proposal/runs/prun_nope/explain",
        json={"step": "service", "target_id": "x", "provider": "browser"},
    )
    assert resp.status_code == 404


def test_explain_422_unknown_target():
    run_id, _, _ = _run_with_service_and_content()
    resp = client.post(
        f"/api/proposal/runs/{run_id}/explain",
        json={"step": "service", "target_id": "does_not_exist", "provider": "browser"},
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "unknown_target"
