"""Tests for service/content parameter+hyperparameter override plumbing on the
merged run (feature 020, Combined Simulator) and its quickview projection.

Mirrors the standalone proposal contract's override seams
(``CreateProposalRunBody.parameters``/``hyperparameters`` for the SERVICE
selector; ``SelectServiceBody.parameters``/``hyperparameters`` for the
CONTENT selector at content-dispatch time) onto the merged path:

  - ``CreateMergedRunBody``/``MergedRunHandle``/``MergedQuickviewBody`` gain
    ``service_parameters``/``service_hyperparameters``/``content_parameters``/
    ``content_hyperparameters`` -- all default to ``{}`` (additive-only; an
    existing caller that omits them is unaffected).
  - The tick endpoint's fire -> ``create_proposal_run`` call now threads
    ``handle.service_parameters``/``service_hyperparameters`` into the
    SERVICE side.
  - The ``proposal-action`` ``select_service`` branch threads
    ``handle.content_parameters``/``content_hyperparameters`` into the
    CONTENT side (interactive mode's content-dispatch step).
  - ``services/merged_quickview.py``'s ``project()`` threads
    ``body.service_parameters``/``service_hyperparameters`` into each
    projected fire's SERVICE side. Content overrides are NOT wired into the
    quickview's quick_check content dispatch -- see that module's docstring
    for the isolation-constraint gap (also covered by
    ``test_quickview_content_overrides_not_wired_gap`` below).

``mock_service_selector_v1``/``mock_content_selector_v1`` (same fixtures as
``test_merged_runs_router.py``) both explicitly ignore ``parameters``/
``hyperparameters`` when computing their FIXED illustrative output (see each
package's manifest ``note``), so the override is verified by asserting the
persisted ``ProposalRunLog.hyperparameters``/``content_hyperparameters``
actually reflect what was supplied -- never by an output/ranking change.
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from aica_api.config import settings
from aica_api.main import app
from aica_api.services.run_manager import clear_registry
from aica_api.services.run_plan import clear_draft_registry

client = TestClient(app)

_TRIGGER_PACKAGE_ID = "nri_fatigue_score_v1"
_TRIGGER_SCENARIO_ID = "uc01_fatigue_recovery_v0_1"
_SEED_ID = "seed-night-highway-oshi"
_SERVICE_PACKAGE_ID = "mock_service_selector_v1"
_CONTENT_PACKAGE_ID = "mock_content_selector_v1"
_MAX_TICKS = 400


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


def _create_merged_run(rest_plan_id: str, base_world_dict: dict, **overrides) -> str:
    body = {
        "trigger_plan_id": rest_plan_id,
        "world": base_world_dict,
        "service_package_id": _SERVICE_PACKAGE_ID,
        "content_package_id": _CONTENT_PACKAGE_ID,
        "run_seed": "7",
    }
    body.update(overrides)
    r = client.post("/api/merged-runs", json=body)
    assert r.status_code == 201, r.text
    return r.json()["merged_run_id"]


def _tick_until_proposal(mid: str) -> dict | None:
    proposal = None
    for _ in range(_MAX_TICKS):
        tr = client.post(f"/api/merged-runs/{mid}/tick")
        assert tr.status_code == 200, tr.text
        body = tr.json()
        if body["proposal"]:
            proposal = body["proposal"]
            assert body["correlation"]["trigger_tick_index"] >= 0
            break
        if body["trigger"].get("completed"):
            break
    return proposal


# ---------------------------------------------------------------------------
# Real merged run: SERVICE override at tick-fire creation
# ---------------------------------------------------------------------------


def test_service_hyperparameter_override_reaches_created_proposal_run(rest_plan_id, base_world_dict):
    mid = _create_merged_run(
        rest_plan_id,
        base_world_dict,
        service_hyperparameters={"parameter_set_version": "9.9.9-service-override"},
    )

    proposal = _tick_until_proposal(mid)

    assert proposal is not None
    assert proposal["hyperparameters"]["parameter_set_version"] == "9.9.9-service-override"


def test_service_parameters_override_reaches_created_proposal_run(rest_plan_id, base_world_dict):
    mid = _create_merged_run(
        rest_plan_id,
        base_world_dict,
        service_parameters={"top_k": 1, "tie_breaker": "candidate_id_ascending"},
    )

    proposal = _tick_until_proposal(mid)

    assert proposal is not None
    assert proposal["parameters"]["top_k"] == 1


def test_empty_overrides_behave_identically_to_before(rest_plan_id, base_world_dict):
    """A merged run created WITHOUT the new override fields (exactly like
    ``test_merged_runs_router.py``'s existing requests) must resolve the
    package's own default hyperparameters -- unchanged behavior."""
    mid = _create_merged_run(rest_plan_id, base_world_dict)

    proposal = _tick_until_proposal(mid)

    assert proposal is not None
    assert proposal["hyperparameters"]["parameter_set_version"] == "1.0.0"
    assert proposal["opportunity"]["trigger_purpose"] == "rest_recommended"


# ---------------------------------------------------------------------------
# Real merged run: CONTENT override at proposal-action select_service
# ---------------------------------------------------------------------------


def test_content_hyperparameter_override_reaches_select_service_dispatch(rest_plan_id, base_world_dict):
    mid = _create_merged_run(
        rest_plan_id,
        base_world_dict,
        content_hyperparameters={"parameter_set_version": "9.9.9-content-override"},
    )
    proposal = _tick_until_proposal(mid)
    assert proposal is not None

    first_ranked = proposal["evidence"][0]["output"]["ranked_candidates"][0]["candidate_id"]

    action_resp = client.post(
        f"/api/merged-runs/{mid}/proposal-action",
        json={"kind": "select_service", "selected_service_id": first_ranked},
    )
    assert action_resp.status_code == 200, action_resp.text
    updated = action_resp.json()

    assert updated["content_hyperparameters"]["parameter_set_version"] == "9.9.9-content-override"


def test_content_parameters_override_reaches_select_service_dispatch(rest_plan_id, base_world_dict):
    mid = _create_merged_run(
        rest_plan_id,
        base_world_dict,
        content_parameters={"lighting_compatible_services": ["humming_karaoke"]},
    )
    proposal = _tick_until_proposal(mid)
    assert proposal is not None

    first_ranked = proposal["evidence"][0]["output"]["ranked_candidates"][0]["candidate_id"]

    action_resp = client.post(
        f"/api/merged-runs/{mid}/proposal-action",
        json={"kind": "select_service", "selected_service_id": first_ranked},
    )
    assert action_resp.status_code == 200, action_resp.text
    updated = action_resp.json()

    assert updated["content_parameters"]["lighting_compatible_services"] == ["humming_karaoke"]


def test_empty_content_overrides_behave_identically_to_before(rest_plan_id, base_world_dict):
    """A merged run created WITHOUT content override fields must resolve the
    content package's own defaults at select_service dispatch -- unchanged
    behavior (mirrors ``test_merged_runs_router.py::test_proposal_action_select_service``)."""
    mid = _create_merged_run(rest_plan_id, base_world_dict)
    proposal = _tick_until_proposal(mid)
    assert proposal is not None

    first_ranked = proposal["evidence"][0]["output"]["ranked_candidates"][0]["candidate_id"]

    action_resp = client.post(
        f"/api/merged-runs/{mid}/proposal-action",
        json={"kind": "select_service", "selected_service_id": first_ranked},
    )
    assert action_resp.status_code == 200, action_resp.text
    updated = action_resp.json()

    assert updated["content_hyperparameters"]["parameter_set_version"] == "1.0.0"
    event_types = [e["event_type"] for e in updated["events"]]
    has_content_evidence = any(ev.get("step") == "content" for ev in updated["evidence"])
    assert "CONTENT_SELECTED" in event_types or has_content_evidence


# ---------------------------------------------------------------------------
# Quickview projection: SERVICE override reaches each projected fire
# ---------------------------------------------------------------------------


def _quickview_body(**overrides) -> dict:
    body = {
        "package_id": _TRIGGER_PACKAGE_ID,
        "scenario_id": _TRIGGER_SCENARIO_ID,
        "run_seed": 42,
        "world": overrides.pop("world"),
        "service_package_id": _SERVICE_PACKAGE_ID,
        "content_package_id": _CONTENT_PACKAGE_ID,
        "run_seed_proposal": "seed-1",
    }
    body.update(overrides)
    return body


def test_quickview_service_hyperparameter_override_reaches_projected_fire(base_world_dict):
    resp = client.post(
        "/api/merged-runs/quickview",
        json=_quickview_body(
            world=base_world_dict,
            service_hyperparameters={"parameter_set_version": "9.9.9-quickview-override"},
        ),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["fired"] is True
    fires_with_proposal = [f for f in body["fires"] if f["proposal"] is not None]
    assert fires_with_proposal, f"expected >=1 fire with a proposal; fires={body['fires']}"

    proposal = fires_with_proposal[0]["proposal"]
    assert proposal["hyperparameters"]["parameter_set_version"] == "9.9.9-quickview-override"


def test_quickview_empty_overrides_behave_identically_to_before(base_world_dict):
    resp = client.post(
        "/api/merged-runs/quickview",
        json=_quickview_body(world=base_world_dict),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    fires_with_proposal = [f for f in body["fires"] if f["proposal"] is not None]
    assert fires_with_proposal
    proposal = fires_with_proposal[0]["proposal"]
    assert proposal["hyperparameters"]["parameter_set_version"] == "1.0.0"


def test_quickview_content_overrides_not_wired_gap(base_world_dict):
    """Documents the known gap (see ``MergedQuickviewBody``'s docstring and
    ``services/merged_quickview.py``): ``content_hyperparameters`` is accepted
    on the request but NOT applied to the projected fire's content dispatch,
    which still resolves the content package's own manifest default --
    because the quickview module's isolation constraint forbids importing
    the only mechanism (``algorithm_config_overrides.content``) that could
    reach it, and there is no channel at all for raw content ``parameters``.
    """
    resp = client.post(
        "/api/merged-runs/quickview",
        json=_quickview_body(
            world=base_world_dict,
            content_hyperparameters={"parameter_set_version": "9.9.9-should-not-apply"},
        ),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    fires_with_proposal = [f for f in body["fires"] if f["proposal"] is not None]
    assert fires_with_proposal
    proposal = fires_with_proposal[0]["proposal"]
    # Content hyperparameters resolve to the package default -- the supplied
    # override never reaches the quick_check content dispatch.
    assert proposal["content_hyperparameters"]["parameter_set_version"] == "1.0.0"
