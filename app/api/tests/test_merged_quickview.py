"""Integration test for POST /api/merged-runs/quickview (feature 020, Slice-2c,
Task 3 -- the merged quickview projection endpoint).

A single headless call projects the WHOLE merged chain: one non-persisting
trigger preview pass (``services.preview.iter_preview_ticks``) plus a
default, non-persisting quick-check proposal (``create_proposal_run(...,
cache={})``) attached to every actionable fire. Nothing is written to
``runs/``, ``proposal_runs/``, or ``merged_runs/`` -- this is a pure
computation, exactly like ``/api/runs/preview``.

Two trigger/scenario pairings (same fixtures as the sibling merged-run
integration tests):
  - REST:     nri_fatigue_score_v1 x uc01_fatigue_recovery_v0_1 (fires ~tick 45,
              REST_PROPOSAL only -- see test_merged_rest_journey.py).
  - MONOTONY: aica_transparent_hybrid_trigger_v1 x uc02_monotony_v0_1 (fires
              ~tick 23, MONOTONY_PROPOSAL -- see test_merged_monotony_journey.py).

Real proposal selectors (aica_transparent_service_selector_v1 /
aica_transparent_content_selector_v1) with mode=quick_check (forced inside
``merged_quickview.project``) so each projected proposal carries fully
ranked service AND content evidence, mirroring test_proposal_cache.py's
router-level acceptance test for the ``cache={}`` contract.
"""
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from aica_api.config import settings
from aica_api.main import app
from aica_api.models.merged_run import MergedQuickviewBody
from aica_api.services import merged_quickview
from aica_api.services.preview import PreviewFireEvent
from aica_api.services.run_manager import clear_registry
from aica_api.services.run_plan import clear_draft_registry

client = TestClient(app)

_SEED_ID = "seed-night-highway-oshi"
_SERVICE_PACKAGE_ID = "aica_transparent_service_selector_v1"
_CONTENT_PACKAGE_ID = "aica_transparent_content_selector_v1"

_REST_TRIGGER_PACKAGE_ID = "nri_fatigue_score_v1"
_REST_TRIGGER_SCENARIO_ID = "uc01_fatigue_recovery_v0_1"

_MONOTONY_TRIGGER_PACKAGE_ID = "aica_transparent_hybrid_trigger_v1"
_MONOTONY_TRIGGER_SCENARIO_ID = "uc02_monotony_v0_1"


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
def base_world_dict() -> dict:
    path = settings.proposal_contracts_dir / "seeds" / f"{_SEED_ID}.json"
    return json.loads(path.read_text(encoding="utf-8"))["world"]


def _quickview_body(**overrides) -> dict:
    body = {
        "package_id": _REST_TRIGGER_PACKAGE_ID,
        "scenario_id": _REST_TRIGGER_SCENARIO_ID,
        "run_seed": 42,
        "world": overrides.pop("world"),
        "service_package_id": _SERVICE_PACKAGE_ID,
        "content_package_id": _CONTENT_PACKAGE_ID,
        "run_seed_proposal": "seed-1",
    }
    body.update(overrides)
    return body


def _assert_nothing_persisted(tmp_path):
    assert list((tmp_path / "runs").glob("*.json")) == [] if (tmp_path / "runs").exists() else True
    assert list((tmp_path / "proposal_runs").glob("*.json")) == [] if (tmp_path / "proposal_runs").exists() else True
    assert list((tmp_path / "merged_runs").glob("*.json")) == [] if (tmp_path / "merged_runs").exists() else True


def test_quickview_rest_scenario_fires_with_rest_recommended_proposal(base_world_dict, tmp_path):
    resp = client.post(
        "/api/merged-runs/quickview",
        json=_quickview_body(world=base_world_dict),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["fired"] is True
    assert body["fires"], "expected at least one fire"

    fires_with_proposal = [f for f in body["fires"] if f["proposal"] is not None]
    assert fires_with_proposal, f"expected >=1 fire with a proposal; fires={body['fires']}"

    fire = fires_with_proposal[0]
    assert fire["proposal_error"] is None
    proposal = fire["proposal"]

    opportunity = proposal["opportunity"]
    assert opportunity["trigger_purpose"] == "rest_recommended"
    assert opportunity["lifecycle_stage"] == "before_rest_until_stop"

    # Ranked service evidence (real transparent selector, quick_check mode
    # dispatches content inline too, so BOTH service and content evidence
    # should be present).
    service_evidence = [ev for ev in proposal["evidence"] if ev["step"] == "service"]
    assert len(service_evidence) == 1
    ranked_candidates = service_evidence[0]["output"]["ranked_candidates"]
    assert ranked_candidates

    content_evidence = [ev for ev in proposal["evidence"] if ev["step"] == "content"]
    assert len(content_evidence) == 1
    assert content_evidence[0].get("error") is None

    assert proposal["status"] == "content_selected"

    # Ephemeral: nothing written anywhere.
    _assert_nothing_persisted(tmp_path)


def test_quickview_monotony_scenario_fires_with_inattentive_driving_proposal(base_world_dict, tmp_path):
    resp = client.post(
        "/api/merged-runs/quickview",
        json=_quickview_body(
            world=base_world_dict,
            package_id=_MONOTONY_TRIGGER_PACKAGE_ID,
            scenario_id=_MONOTONY_TRIGGER_SCENARIO_ID,
            run_seed=7,
        ),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["fired"] is True
    fires_with_proposal = [f for f in body["fires"] if f["proposal"] is not None]
    assert fires_with_proposal, f"expected >=1 fire with a proposal; fires={body['fires']}"

    fire = fires_with_proposal[0]
    assert fire["proposal_error"] is None
    proposal = fire["proposal"]

    opportunity = proposal["opportunity"]
    assert opportunity["trigger_purpose"] == "inattentive_driving_prevention_recovery"
    assert opportunity["lifecycle_stage"] == "active_driving_content"

    service_evidence = [ev for ev in proposal["evidence"] if ev["step"] == "service"]
    assert len(service_evidence) == 1
    assert service_evidence[0]["output"]["ranked_candidates"]

    _assert_nothing_persisted(tmp_path)


def test_quickview_unknown_package_400(base_world_dict):
    resp = client.post(
        "/api/merged-runs/quickview",
        json=_quickview_body(world=base_world_dict, package_id="not_a_real_package"),
    )
    assert resp.status_code == 400, resp.text


def test_quickview_unknown_scenario_400(base_world_dict):
    resp = client.post(
        "/api/merged-runs/quickview",
        json=_quickview_body(world=base_world_dict, scenario_id="not_a_real_scenario"),
    )
    assert resp.status_code == 400, resp.text


def test_quickview_mountain_and_jam_painting_reaches_the_projected_route(base_world_dict):
    """The painter path (``_build_quickview_route_facts``, reusing
    ``services.merged_painter`` exactly like ``POST /api/merged-runs/plan``)
    actually reaches the previewed route: a ``mountain_road`` segment shows
    up in the projected ``segments``, and the request round-trips cleanly
    with a manual jam painted in too (``iter_preview_ticks``'s new additive
    ``presets`` kwarg, feature 020 Slice-2c)."""
    resp = client.post(
        "/api/merged-runs/quickview",
        json=_quickview_body(
            world=base_world_dict,
            mountain_range_km=[40.0, 70.0],
            jam_range_km=[10.0, 20.0],
        ),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    segment_types = {seg["type"] for seg in body["segments"]}
    assert "mountain_road" in segment_types


def test_project_suppresses_fires_when_run_ends_in_algorithm_error(base_world_dict, monkeypatch):
    """Regression: ``iter_preview_ticks`` empties its OWN ``fires``/``spikes``
    to ``[]`` whenever the run ends in an algorithm error -- EVEN IF a fire
    (and its ``PreviewFireEvent`` yield) already happened earlier in the SAME
    run, before the later tick that errored. ``project`` must not zip its own
    per-fire ``projected`` proposals positionally against
    ``result["fires"]`` in that case (their lengths can legitimately
    disagree) -- it must suppress ``fires`` too, mirroring the trigger-only
    contract, instead of raising or silently misaligning proposals to the
    wrong fire.
    """

    def _fake_iter_preview_ticks(*, presets=None, **kwargs):
        tick_state = SimpleNamespace(
            signals={"fixed": {}, "dynamic": {}, "simulated": {}}, distance_km=0.0
        )
        decision = SimpleNamespace(result_type="REST_PROPOSAL")
        yield PreviewFireEvent(
            tick_index=10,
            tick_state=tick_state,
            decision=decision,
            elapsed_min=5.0,
            route_facts=None,
            effective_scenario=None,
            rest_spot=None,
        )
        return {
            "fired": True,
            "fire": {"category": "rest_required", "strength": "high", "tick": 10, "time_min": 5.0},
            "fires": [],  # <- suppressed by the (simulated) later algorithm error
            "peak_score": 0.9,
            "threshold": 0.7,
            "score_series": [],
            "monotony_series": [],
            "monotony_threshold": None,
            "spikes": [],
            "segments": [],
            "rest_spot": None,
            "rest_option": None,
            "rest_spots": [],
            "rest_options": [],
            "completed_min": None,
            "seed": 42,
            "overrides": [],
            "error": {"tick_index": 20, "error_type": "boom", "message": "simulated"},
        }

    monkeypatch.setattr(merged_quickview, "iter_preview_ticks", _fake_iter_preview_ticks)

    body = MergedQuickviewBody(
        package_id=_REST_TRIGGER_PACKAGE_ID,
        scenario_id=_REST_TRIGGER_SCENARIO_ID,
        run_seed=42,
        world=base_world_dict,
        service_package_id=_SERVICE_PACKAGE_ID,
        content_package_id=_CONTENT_PACKAGE_ID,
        run_seed_proposal="seed-1",
    )

    result = merged_quickview.project(
        body, packages_dir=settings.packages_dir, scenarios_dir=settings.scenarios_dir
    )

    assert result.error is not None
    assert result.fires == []
