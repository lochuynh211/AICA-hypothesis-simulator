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


def test_quickview_rest_option_carries_after_rest_proposal(base_world_dict, tmp_path):
    """feature 020 — the clickable purple "after-nap" journey dot: the auto-
    accepted rest (the REST scenario recovers, so ``rest_options`` are non-empty
    and each recovered one carries ``recovery_from_min``) is projected into an
    AFTER-NAP quick_check proposal (``after_rest_proposal``) built from the
    recovered driver state, modeled as the SAME rest journey that started it —
    ``trigger_purpose="rest_recommended"`` at ``after_rest_before_restart`` (§7.5
    matrix row 3), motion ``stopped``. The private ``_post_rest_tick_state`` stash
    must NOT leak into the response.

    (Owner decision: the green "driving-after-rest" dot was dropped — there is no
    matrix-valid ``rest_recommended``/``active_driving_content`` proposal to
    project for it.)
    """
    resp = client.post(
        "/api/merged-runs/quickview",
        json=_quickview_body(world=base_world_dict),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    rest_options = body["rest_options"]
    assert rest_options, "REST scenario should auto-accept at least one rest"

    recovered = [o for o in rest_options if o.get("recovery_from_min") is not None]
    assert recovered, f"expected a recovered rest option; rest_options={rest_options}"

    opt = recovered[0]
    # The private stash never leaks into the serialized response.
    assert "_post_rest_tick_state" not in opt

    # `after_rest_proposal_error` is only a caught HTTPException; an in-run content
    # error (e.g. an after-rest service the music content package can't serve) lives
    # in the proposal's own evidence, so the proposal itself is still present.
    assert opt["after_rest_proposal_error"] is None, opt["after_rest_proposal_error"]
    after = opt["after_rest_proposal"]
    assert after is not None, "recovered rest option should carry an after_rest_proposal"

    # Trigger signal + car status the purple dot must show: rest_recommended /
    # after spot / stopped — inherited from the rest journey, NOT route_music.
    opportunity = after["opportunity"]
    assert opportunity["trigger_purpose"] == "rest_recommended"
    assert opportunity["lifecycle_stage"] == "after_rest_before_restart"
    assert after["journey_state"]["motion_state"] == "stopped"

    # The after-rest service row IS ranked (a real evaluate() ran — never faked).
    service_evidence = [ev for ev in after["evidence"] if ev["step"] == "service"]
    assert len(service_evidence) == 1
    assert service_evidence[0]["output"]["ranked_candidates"]

    _assert_nothing_persisted(tmp_path)


def test_after_rest_proposal_endpoint_forces_chosen_service_content(base_world_dict, tmp_path):
    """feature 020 — the after-nap inspect panel's interactive Choose:
    ``POST /api/merged-runs/after-rest-proposal`` re-projects the after-nap
    proposal from the SAME recovered ``world`` the quickview built, but forcing
    content dispatch for the reviewer-chosen ``selected_service_id``. Default
    (unset) reproduces the rank-1 projection (``oshi_reexperience``, no music
    content); forcing ``full_karaoke`` (rank-3, the one content-capable after-rest
    service) yields a ``content_selected`` proposal WITH content. Non-persisting.
    """
    qv = client.post("/api/merged-runs/quickview", json=_quickview_body(world=base_world_dict))
    assert qv.status_code == 200, qv.text
    opt = next(o for o in qv.json()["rest_options"] if o.get("recovery_from_min") is not None)
    base = opt["after_rest_proposal"]
    assert base is not None
    world = base["world"]
    assert world is not None, "after_rest_proposal must carry the recovered typed world"

    req = {
        "world": world,
        "service_package_id": _SERVICE_PACKAGE_ID,
        "content_package_id": _CONTENT_PACKAGE_ID,
        "run_seed_proposal": "seed-1",
    }

    # Default (no forced service) — rank-1 auto-selected (oshi_reexperience), no content.
    default_resp = client.post("/api/merged-runs/after-rest-proposal", json=req)
    assert default_resp.status_code == 200, default_resp.text
    default = default_resp.json()
    assert default["opportunity"]["trigger_purpose"] == "rest_recommended"
    assert default["opportunity"]["lifecycle_stage"] == "after_rest_before_restart"
    assert default["journey_state"]["active_service_id"] == "oshi_reexperience"

    # Forcing full_karaoke — a content-capable after-rest service → content dispatched.
    forced_resp = client.post(
        "/api/merged-runs/after-rest-proposal",
        json={**req, "selected_service_id": "full_karaoke"},
    )
    assert forced_resp.status_code == 200, forced_resp.text
    forced = forced_resp.json()
    assert forced["journey_state"]["active_service_id"] == "full_karaoke"
    assert forced["status"] == "content_selected"
    content_ev = [ev for ev in forced["evidence"] if ev["step"] == "content"]
    assert len(content_ev) == 1
    assert content_ev[0].get("error") is None
    assert content_ev[0]["output"] is not None

    _assert_nothing_persisted(tmp_path)


def test_merged_explain_inline_for_ephemeral_projection(base_world_dict, tmp_path):
    """feature 020 — LLM reason for an EPHEMERAL projected proposal. The quickview
    fire proposal is built with cache={} and never written to proposal_runs/, so
    the run-id explain endpoint would 404; POST /api/merged-runs/explain takes the
    proposal inline. Browser path returns the grounded prompt (build-only, no
    inference, no persistence); the backend/Ollama path shares the same
    ``explain_from_run_log`` core the run-id explain tests already cover. An
    unknown target is a clean 422.
    """
    qv = client.post("/api/merged-runs/quickview", json=_quickview_body(world=base_world_dict))
    assert qv.status_code == 200, qv.text
    fire = next(f for f in qv.json()["fires"] if f["proposal"] is not None)
    proposal = fire["proposal"]
    target = [e for e in proposal["evidence"] if e["step"] == "service"][0]["output"]["ranked_candidates"][0][
        "candidate_id"
    ]

    # Browser: build-only — a grounded prompt to run on-device, no inference.
    browser = client.post(
        "/api/merged-runs/explain",
        json={"proposal": proposal, "step": "service", "target_id": target, "provider": "browser"},
    )
    assert browser.status_code == 200, browser.text
    bout = browser.json()
    assert bout["step"] == "service" and bout["target_id"] == target
    assert bout["provider_used"] == "browser"
    assert bout["prompt"]["messages"], "browser path must return a grounded prompt"

    # An unknown target is a clean 422, not a 500.
    bad = client.post(
        "/api/merged-runs/explain",
        json={"proposal": proposal, "step": "service", "target_id": "not_a_candidate", "provider": "browser"},
    )
    assert bad.status_code == 422, bad.text

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


def test_quickview_fire_carries_both_trigger_categories(base_world_dict, tmp_path):
    """Same fixtures/call as
    test_quickview_monotony_scenario_fires_with_inattentive_driving_proposal
    -- the hybrid trigger package is the one that emits `feature_contributions`
    for BOTH categories (nri_fatigue_score_v1, used by the REST test above,
    emits none). The quickview's fire must carry that recorded chain, not just
    the proposal built from it."""
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
    assert body["fires"], "expected at least one fire"

    chain = body["fires"][0]["feature_contributions"]
    assert set(chain) == {"rest_required", "monotony_prevention"}
    assert chain["rest_required"]["rows"], "the winning category needs its terms"
    # The runner-up's terms must be RECORDED, not reconstructed — §7.3 compares
    # the two categories against each other.
    assert chain["monotony_prevention"]["rows"]
    assert body["fires"][0]["criteria"].get("threshold_suggest") is not None

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
