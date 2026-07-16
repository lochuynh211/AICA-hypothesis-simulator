"""TDD (T029/T030): US5 — non-binding rolling-horizon journey preview
(spec.md User Story 5; FR-017; SC-007; contracts/journey-api.md §"GET
/api/proposal/runs/{run_id}/journey/preview"; data-model.md
§"JourneyPreview").

``GET /api/proposal/runs/{run_id}/journey/preview`` is a PURE, READ-ONLY
projection: it always returns ``binding: false``, invokes no selector, and
leaves the run's events/evidence/journey_state — and the on-disk run file
byte-for-byte — unchanged (SC-007). This module covers:

  - a ``rest_recommended`` run: the preview chains
    ``before_rest_until_stop -> during_rest_stopped -> after_rest_before_
    restart`` (the §3.2 rolling-horizon chain) from the run's CURRENT stage
    forward, with bilingual ("EN / JA") labels.
  - a non-rest (e.g. ``route_music``) run: a short current-content ->
    continue/complete chain, also bilingual.
  - SC-007: byte-identical on-disk run file + identical ``GET /runs/{id}``
    body before and after calling preview (repeated calls too); no new
    ``AlgorithmEvidence`` is ever appended.
  - 404 for an unknown run_id.
"""
from __future__ import annotations

import pathlib

import pytest
from fastapi.testclient import TestClient

from aica_api.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def isolate_proposal_runs_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(tmp_path))
    yield


def _create_run_body(**overrides) -> dict:
    body = {
        "trigger_purpose": "rest_recommended",
        "lifecycle_stage": "before_rest_until_stop",
        "motion_state": "driving",
        "world_snapshot": {"feature_snapshot": {}, "feature_provenance": {}},
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


def _has_bilingual_form(label: str) -> bool:
    """True if ``label`` looks like ``"<EN> / <JA>"``: an ASCII-letter
    segment, a literal ``" / "`` separator, and a segment containing at
    least one non-ASCII (Japanese) character."""
    if " / " not in label:
        return False
    en_part, _, ja_part = label.partition(" / ")
    has_ascii_letters = any(ch.isalpha() and ch.isascii() for ch in en_part)
    has_non_ascii = any(not ch.isascii() for ch in ja_part)
    return has_ascii_letters and has_non_ascii


def _run_file_bytes(run_id: str, runs_dir: pathlib.Path) -> bytes:
    return (runs_dir / f"{run_id}.json").read_bytes()


# ---------------------------------------------------------------------------
# rest_recommended: before_rest_until_stop -> during_rest_stopped ->
# after_rest_before_restart chain.
# ---------------------------------------------------------------------------


def test_preview_rest_recommended_chains_rest_stages():
    created = client.post("/api/proposal/runs", json=_create_run_body())
    assert created.status_code == 201, created.text
    run_id = created.json()["run_id"]

    resp = client.get(f"/api/proposal/runs/{run_id}/journey/preview")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["binding"] is False
    steps = body["steps"]
    assert len(steps) >= 1

    stages = [s["lifecycle_stage"] for s in steps]
    assert stages == [
        "before_rest_until_stop",
        "during_rest_stopped",
        "after_rest_before_restart",
    ]
    for step in steps:
        assert _has_bilingual_form(step["label"]), step["label"]
        assert "label" in step and "lifecycle_stage" in step and "note" in step


def test_preview_rest_recommended_from_current_stage_forward():
    """Preview projects from the run's CURRENT ``journey_state.lifecycle_
    stage`` forward — not always the full three-stage chain. After
    ``rest_spot_arrived`` the run's current stage is ``during_rest_stopped``,
    so the preview should chain only ``during_rest_stopped ->
    after_rest_before_restart``."""
    created = client.post("/api/proposal/runs", json=_create_run_body())
    assert created.status_code == 201, created.text
    run_id = created.json()["run_id"]

    action = client.post(
        f"/api/proposal/runs/{run_id}/journey/action",
        json={"action_type": "rest_spot_arrived", "payload": {}},
    )
    assert action.status_code == 200, action.text
    assert action.json()["journey_state"]["lifecycle_stage"] == "during_rest_stopped"

    resp = client.get(f"/api/proposal/runs/{run_id}/journey/preview")
    assert resp.status_code == 200, resp.text
    stages = [s["lifecycle_stage"] for s in resp.json()["steps"]]
    assert stages == ["during_rest_stopped", "after_rest_before_restart"]


# ---------------------------------------------------------------------------
# Non-rest purposes: short current-content -> continue/complete chain.
# ---------------------------------------------------------------------------


def test_preview_non_rest_purpose_short_chain():
    created = client.post(
        "/api/proposal/runs",
        json=_create_run_body(
            trigger_purpose="route_music",
            lifecycle_stage="active_driving_content",
        ),
    )
    assert created.status_code == 201, created.text
    run_id = created.json()["run_id"]

    resp = client.get(f"/api/proposal/runs/{run_id}/journey/preview")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["binding"] is False
    steps = body["steps"]
    assert len(steps) >= 1
    for step in steps:
        assert _has_bilingual_form(step["label"]), step["label"]


# ---------------------------------------------------------------------------
# SC-007: preview is read-only — byte-identical run file, no new evidence.
# ---------------------------------------------------------------------------


def test_preview_persists_nothing(tmp_path):
    created = client.post("/api/proposal/runs", json=_create_run_body())
    assert created.status_code == 201, created.text
    run_id = created.json()["run_id"]

    before_get = client.get(f"/api/proposal/runs/{run_id}")
    assert before_get.status_code == 200
    before_body = before_get.json()
    before_bytes = _run_file_bytes(run_id, tmp_path)
    before_evidence_count = len(before_body["evidence"])

    # Call preview twice — repetition must not accumulate any side effect.
    for _ in range(2):
        preview_resp = client.get(f"/api/proposal/runs/{run_id}/journey/preview")
        assert preview_resp.status_code == 200, preview_resp.text
        assert preview_resp.json()["binding"] is False

    after_get = client.get(f"/api/proposal/runs/{run_id}")
    assert after_get.status_code == 200
    after_body = after_get.json()
    after_bytes = _run_file_bytes(run_id, tmp_path)

    assert after_bytes == before_bytes, "preview must leave the on-disk run file byte-identical"
    assert after_body == before_body, "preview must leave events/evidence/journey_state unchanged"
    assert len(after_body["evidence"]) == before_evidence_count, (
        "preview must never invoke a selector / append AlgorithmEvidence"
    )


# ---------------------------------------------------------------------------
# 404 for an unknown run.
# ---------------------------------------------------------------------------


def test_preview_unknown_run_404():
    resp = client.get("/api/proposal/runs/prun_does_not_exist/journey/preview")
    assert resp.status_code == 404
