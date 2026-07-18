"""Integration test for POST /api/merged-runs/plan (feature 020, Slice-2b Task 2).

Exercises the full HTTP stack: the merged plan-build endpoint applies the
Task-1 painter (``inject_mountain_segment`` / ``jam_traffic_event``) onto a
locally-analyzed route, registers a draft via the existing
``run_plan.create_draft``, and returns its ``plan_id``. That ``plan_id`` is
then fed into the existing ``POST /api/merged-runs`` (Slice-1 create) +
``POST /api/merged-runs/{id}/tick`` so the whole chain is proven end-to-end:
a painted plan drives real ``mountain_road`` segments and a positioned
traffic jam through the merged run's per-tick trigger signals.
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from aica_api.config import settings
from aica_api.main import app
from aica_api.services.run_manager import clear_registry
from aica_api.services.run_plan import clear_draft_registry, get_draft_entry

client = TestClient(app)

_TRIGGER_PACKAGE_ID = "nri_fatigue_score_v1"
_TRIGGER_SCENARIO_ID = "uc01_fatigue_recovery_v0_1"
_SEED_ID = "seed-night-highway-oshi"
_SERVICE_PACKAGE_ID = "mock_service_selector_v1"
_CONTENT_PACKAGE_ID = "mock_content_selector_v1"
_MAX_TICKS = 400

# uc01_fatigue_recovery_v0_1's local route: total_route_distance_km=120.0,
# estimated_route_duration_min=108.0, segments normal_road[0,24) normal_road
# [24,60) normal_road[60,90) highway[90,120).
_MOUNTAIN_RANGE_KM = (40.0, 70.0)
_JAM_RANGE_KM = (10.0, 20.0)


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


def _create_merged_plan(**overrides) -> str:
    body = {
        "package_id": _TRIGGER_PACKAGE_ID,
        "scenario_id": _TRIGGER_SCENARIO_ID,
        "run_seed": 7,
        "mountain_range_km": list(_MOUNTAIN_RANGE_KM),
        "jam_range_km": list(_JAM_RANGE_KM),
    }
    body.update(overrides)
    resp = client.post("/api/merged-runs/plan", json=body)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert set(data.keys()) == {"plan_id"}
    return data["plan_id"]


def test_plan_endpoint_paints_mountain_and_jam_into_registered_draft():
    plan_id = _create_merged_plan()

    entry = get_draft_entry(plan_id)
    assert entry is not None, "plan_id must be registered in the draft registry"
    draft, _package, _scenario = entry

    mountain_segments = [
        seg for seg in draft.route_facts.route_segments if seg.segment_type == "mountain_road"
    ]
    assert mountain_segments, "expected an injected mountain_road segment"
    assert min(seg.start_km for seg in mountain_segments) == pytest.approx(_MOUNTAIN_RANGE_KM[0])
    assert max(seg.start_km + seg.length_km for seg in mountain_segments) == pytest.approx(
        _MOUNTAIN_RANGE_KM[1]
    )

    jam_events = [e for e in draft.draft_event_plan.traffic_events if e.id == "manual_jam"]
    assert len(jam_events) == 1
    jam = jam_events[0]
    total_km = draft.route_facts.total_route_distance_km
    est_dur_min = draft.route_facts.estimated_route_duration_min
    expected_start_min = (_JAM_RANGE_KM[0] / total_km) * est_dur_min
    expected_duration_min = ((_JAM_RANGE_KM[1] - _JAM_RANGE_KM[0]) / total_km) * est_dur_min
    assert jam.start_min == pytest.approx(expected_start_min)
    assert jam.duration_min == pytest.approx(expected_duration_min)
    assert jam.speed_kph == pytest.approx(15.0)  # jam_speed_kph default


def test_plan_id_feeds_into_merged_run_and_ticks_report_mountain_and_jam(base_world_dict):
    plan_id = _create_merged_plan()

    r = client.post(
        "/api/merged-runs",
        json={
            "trigger_plan_id": plan_id,
            "world": base_world_dict,
            "service_package_id": _SERVICE_PACKAGE_ID,
            "content_package_id": _CONTENT_PACKAGE_ID,
            "run_seed": "7",
        },
    )
    assert r.status_code == 201, r.text
    mid = r.json()["merged_run_id"]

    saw_mountain = False
    saw_jam = False
    for _ in range(_MAX_TICKS):
        tr = client.post(f"/api/merged-runs/{mid}/tick")
        assert tr.status_code == 200, tr.text
        trigger = tr.json()["trigger"]
        if trigger.get("segment_type") == "mountain_road":
            saw_mountain = True
        if trigger.get("is_traffic_jam"):
            saw_jam = True
        if trigger.get("completed"):
            break

    assert saw_mountain, "expected at least one tick reporting segment_type == mountain_road"
    assert saw_jam, "expected at least one tick reporting is_traffic_jam == True"


def test_plan_endpoint_custom_jam_speed_kph_is_threaded_through():
    plan_id = _create_merged_plan(jam_speed_kph=5.0)

    entry = get_draft_entry(plan_id)
    assert entry is not None
    draft, _package, _scenario = entry
    jam_events = [e for e in draft.draft_event_plan.traffic_events if e.id == "manual_jam"]
    assert len(jam_events) == 1
    assert jam_events[0].speed_kph == pytest.approx(5.0)


def test_plan_endpoint_without_mountain_or_jam_matches_local_analysis():
    plan_id = _create_merged_plan(mountain_range_km=None, jam_range_km=None)

    entry = get_draft_entry(plan_id)
    assert entry is not None
    draft, _package, _scenario = entry
    assert all(seg.segment_type != "mountain_road" for seg in draft.route_facts.route_segments)
    assert all(e.id != "manual_jam" for e in draft.draft_event_plan.traffic_events)


def test_plan_endpoint_unknown_package_400():
    resp = client.post(
        "/api/merged-runs/plan",
        json={
            "package_id": "does_not_exist_pkg",
            "scenario_id": _TRIGGER_SCENARIO_ID,
            "run_seed": 1,
        },
    )
    assert resp.status_code == 400


def test_plan_endpoint_unknown_scenario_400():
    resp = client.post(
        "/api/merged-runs/plan",
        json={
            "package_id": _TRIGGER_PACKAGE_ID,
            "scenario_id": "does_not_exist_scenario",
            "run_seed": 1,
        },
    )
    assert resp.status_code == 400
