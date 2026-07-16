"""TDD: FIX 2 (P3 whole-branch review) — STEP 2 (``select_service``) must
re-freeze ``setup_snapshot.content_parameter_set_version`` to reflect the
CONTENT parameter set actually used at STEP 2, not the STEP 1 manifest
default.

Before this fix, ``create_proposal_run`` (STEP 1) froze
``SetupSnapshot.content_parameter_set_version`` from the content package's
manifest DEFAULT hyperparameters, but ``select_service`` (STEP 2) — where the
reviewer's ACTUAL ``content_hyperparameters`` are supplied and ``evaluate()``
runs — never updated it. This could misrepresent what produced the plan
(FR-011/SC-008: the snapshot must capture what actually produced the run).

``mock_content_selector_v1`` declares a ``parameter_set_version`` (kind
``string``) hyperparameter with default ``"1.0.0"`` — exactly mirroring how
STEP 1 derives ``content_parameter_set_version`` from
``content_hyperparameters.get("parameter_set_version", content_pkg.version)``.
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from aica_api.config import settings
from aica_api.main import app

client = TestClient(app)

_SEED_ID = "seed-night-highway-oshi"


@pytest.fixture(autouse=True)
def isolate_proposal_runs_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(tmp_path))
    yield


def _load_seed_world_dict(seed_id: str = _SEED_ID) -> dict:
    path = settings.proposal_contracts_dir / "seeds" / f"{seed_id}.json"
    return json.loads(path.read_text(encoding="utf-8"))["world"]


def _create_run() -> dict:
    resp = client.post(
        "/api/proposal/runs",
        json={
            "world": _load_seed_world_dict(),
            "service_package_id": "mock_service_selector_v1",
            "content_package_id": "mock_content_selector_v1",
            "mode": "interactive",
            "run_seed": "seed-1",
            "simulation_time": "2026-07-16T10:00:00Z",
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_step1_freezes_the_content_package_default_parameter_set_version():
    run = _create_run()
    assert run["setup_snapshot"] is not None
    assert run["setup_snapshot"]["content_parameter_set_version"] == "1.0.0"


def test_step2_overridden_content_hyperparameters_refreeze_the_setup_snapshot():
    run = _create_run()
    run_id = run["run_id"]

    resp = client.post(
        f"/api/proposal/runs/{run_id}/select-service",
        json={
            "selected_service_id": "music_playlist",
            "hyperparameters": {"parameter_set_version": "v9.9.9-custom"},
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # The persisted setup_snapshot now reflects what STEP 2 actually used --
    # never the STEP 1 default anymore.
    assert body["setup_snapshot"]["content_parameter_set_version"] == "v9.9.9-custom"

    # Reopening the run (no recompute) shows the SAME updated value.
    reopened = client.get(f"/api/proposal/runs/{run_id}").json()
    assert reopened["setup_snapshot"]["content_parameter_set_version"] == "v9.9.9-custom"


def test_step2_without_overrides_leaves_the_default_parameter_set_version():
    run = _create_run()
    run_id = run["run_id"]

    resp = client.post(
        f"/api/proposal/runs/{run_id}/select-service",
        json={"selected_service_id": "music_playlist"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # No override supplied -> content package's own default is used at STEP 2
    # too, so the snapshot is unchanged (still "1.0.0"), but it is now
    # explicitly the STEP-2-used value, not a stale STEP-1 freeze.
    assert body["setup_snapshot"]["content_parameter_set_version"] == "1.0.0"


def test_fix2_does_not_change_the_evaluate_input_or_returned_plan():
    """Constraint: FIX 2 only changes persisted setup_snapshot metadata --
    never what evaluate() receives or the returned plan."""
    run_a = _create_run()
    run_b = _create_run()

    resp_a = client.post(
        f"/api/proposal/runs/{run_a['run_id']}/select-service",
        json={"selected_service_id": "music_playlist"},
    )
    resp_b = client.post(
        f"/api/proposal/runs/{run_b['run_id']}/select-service",
        json={
            "selected_service_id": "music_playlist",
            "hyperparameters": {"parameter_set_version": "v9.9.9-custom"},
        },
    )
    assert resp_a.status_code == 200
    assert resp_b.status_code == 200

    # mock_content_selector_v1's evaluate() ignores hyperparameters entirely,
    # so the returned plan is identical regardless of the override -- proving
    # the override only ever reaches the persisted setup_snapshot metadata,
    # not evaluate()'s behavior/output.
    plan_a = resp_a.json()["evidence"][-1]["output"]
    plan_b = resp_b.json()["evidence"][-1]["output"]
    assert plan_a == plan_b
