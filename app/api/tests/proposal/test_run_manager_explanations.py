"""append_explanation persistence + backward-compat (feature 019).

Uses a real API-created run (so the persisted log matches the current schema),
then exercises the new append helper directly against the run manager.
"""
from __future__ import annotations

import json
import pathlib

import pytest
from fastapi.testclient import TestClient

from aica_api.main import app
from aica_api.models.proposal.explanation import Explanation
from aica_api.services import proposal_run_manager as prm

client = TestClient(app)


@pytest.fixture(autouse=True)
def isolate_proposal_runs_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(tmp_path))
    yield


def _create_run() -> str:
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
        "parameters": {},
        "hyperparameters": {},
        "run_seed": "seed-1",
        "simulation_time": "2026-07-16T10:00:00Z",
    }
    return client.post("/api/proposal/runs", json=body).json()["run_id"]


def _explanation(**overrides) -> Explanation:
    base = dict(
        step="service",
        target_id="rest_stop",
        requested_provider="backend",
        provider_used="backend",
        model="qwen2.5:3b",
        rationale=["理由", "reason"],
        fell_back=False,
        error=None,
        prompt_hash="deadbeef",
        generated_at="2026-07-17T00:00:00Z",
    )
    base.update(overrides)
    return Explanation(**base)


def test_append_explanation_round_trips(tmp_path):
    run_id = _create_run()
    prm.append_explanation(run_id, _explanation(), pathlib.Path(tmp_path))
    prm.append_explanation(run_id, _explanation(target_id="other"), pathlib.Path(tmp_path))

    reloaded = prm.get_run(run_id, pathlib.Path(tmp_path))
    assert [e.target_id for e in reloaded.explanations] == ["rest_stop", "other"]


def test_pre_019_log_without_key_loads_with_empty_default(tmp_path):
    run_id = _create_run()
    # Simulate a pre-019 persisted log: strip the `explanations` key entirely.
    path = tmp_path / f"{run_id}.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data.pop("explanations", None)
    path.write_text(json.dumps(data))

    loaded = prm.get_run(run_id, pathlib.Path(tmp_path))
    assert loaded is not None
    assert loaded.explanations == []


def test_append_explanation_unknown_run_raises(tmp_path):
    with pytest.raises(prm.ProposalRunNotFoundError):
        prm.append_explanation("nope", _explanation(), pathlib.Path(tmp_path))
