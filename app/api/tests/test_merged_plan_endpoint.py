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

# routes/presets/short_tokyo_chichibu.json — one of the 3 fixtures committed
# under routes/presets/ in this repo (settings.routes_dir resolves there by
# default; the isolate_dirs fixture above only redirects AICA_RUNS_DIR /
# AICA_PROPOSAL_RUNS_DIR / AICA_MERGED_RUNS_DIR, never AICA_ROUTES_DIR).
# distance_m / duration_s are read from the preset at import time rather than
# hard-coded: the preset is periodically re-extracted from live Google
# Directions, whose ETA (duration_s) drifts run-to-run, so pinning a literal
# made this test break on every re-extraction.
_PRESET_ID = "short_tokyo_chichibu"
_PRESET_RAW_ROUTE = json.loads(
    (settings.routes_dir / "presets" / f"{_PRESET_ID}.json").read_text(encoding="utf-8")
)["raw_route"]
_PRESET_TOTAL_KM = _PRESET_RAW_ROUTE["distance_m"] / 1000.0
_PRESET_DURATION_MIN = _PRESET_RAW_ROUTE["duration_s"] / 60.0
_PRESET_MOUNTAIN_RANGE_KM = (30.0, 50.0)
_PRESET_JAM_RANGE_KM = (5.0, 15.0)


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


def test_plan_endpoint_route_preset_id_alone_loads_maps_route_unpainted():
    """route_preset_id (no mountain/jam) selects the loaded-preset path — NOT
    the local analyze_route(scenario) path the other tests use. Distinguishes
    on total_route_distance_km/estimated_route_duration_min/route_source,
    which only match the preset fixture (112.134 km / ~110.72 min / "maps"),
    never the local route (120.0 km / 108.0 min / "local")."""
    plan_id = _create_merged_plan(
        route_preset_id=_PRESET_ID, mountain_range_km=None, jam_range_km=None
    )

    entry = get_draft_entry(plan_id)
    assert entry is not None
    draft, _package, _scenario = entry

    assert draft.route_facts.route_source == "maps"
    assert draft.route_facts.total_route_distance_km == pytest.approx(_PRESET_TOTAL_KM)
    assert draft.route_facts.estimated_route_duration_min == pytest.approx(_PRESET_DURATION_MIN)
    assert all(seg.segment_type != "mountain_road" for seg in draft.route_facts.route_segments)
    assert all(e.id != "manual_jam" for e in draft.draft_event_plan.traffic_events)


def test_plan_endpoint_route_preset_id_combined_with_mountain_and_jam():
    """route_preset_id combined with mountain_range_km + jam_range_km: the
    painter operates on the LOADED PRESET's route_facts (not the local
    route's), so the km->min jam conversion must use the preset's own
    total_km/estimated_duration_min."""
    plan_id = _create_merged_plan(
        route_preset_id=_PRESET_ID,
        mountain_range_km=list(_PRESET_MOUNTAIN_RANGE_KM),
        jam_range_km=list(_PRESET_JAM_RANGE_KM),
    )

    entry = get_draft_entry(plan_id)
    assert entry is not None
    draft, _package, _scenario = entry

    assert draft.route_facts.route_source == "maps"
    assert draft.route_facts.total_route_distance_km == pytest.approx(_PRESET_TOTAL_KM)

    mountain_segments = [
        seg for seg in draft.route_facts.route_segments if seg.segment_type == "mountain_road"
    ]
    assert mountain_segments, "expected an injected mountain_road segment"
    assert min(seg.start_km for seg in mountain_segments) == pytest.approx(
        _PRESET_MOUNTAIN_RANGE_KM[0]
    )
    assert max(seg.start_km + seg.length_km for seg in mountain_segments) == pytest.approx(
        _PRESET_MOUNTAIN_RANGE_KM[1]
    )

    jam_events = [e for e in draft.draft_event_plan.traffic_events if e.id == "manual_jam"]
    assert len(jam_events) == 1
    jam = jam_events[0]
    expected_start_min = (_PRESET_JAM_RANGE_KM[0] / _PRESET_TOTAL_KM) * _PRESET_DURATION_MIN
    expected_duration_min = (
        (_PRESET_JAM_RANGE_KM[1] - _PRESET_JAM_RANGE_KM[0]) / _PRESET_TOTAL_KM
    ) * _PRESET_DURATION_MIN
    assert jam.start_min == pytest.approx(expected_start_min)
    assert jam.duration_min == pytest.approx(expected_duration_min)
    assert jam.speed_kph == pytest.approx(15.0)


# ── Explicit route_facts precedence (fixbug-0806 full-plumb) ─────────────────
# A realtime maps search (handleAnalyzeMaps on the Combined setup screen)
# clears selectedRoutePresetId and stores its result purely in panel-local
# state — there is no preset id standing in for it, so the plan-build endpoint
# must accept the raw RouteFacts dict directly. Distinct total_route_distance_km
# / estimated_route_duration_min / route_segments (vs. both the preset fixture
# and the local scenario route) make the precedence unambiguous.
_EXPLICIT_ROUTE_FACTS = {
    "total_route_distance_km": 200.0,
    "estimated_route_duration_min": 150.0,
    "route_segments": [{"segment_type": "highway", "start_km": 0.0, "length_km": 200.0}],
    "route_source": "maps",
}
_EXPLICIT_MOUNTAIN_RANGE_KM = (50.0, 100.0)
_EXPLICIT_JAM_RANGE_KM = (10.0, 30.0)


def test_plan_endpoint_route_facts_wins_over_route_preset_id_and_local():
    """route_facts + route_preset_id both supplied: route_facts must win — the
    resulting draft must carry the EXPLICIT route's totals, not the preset
    fixture's (_PRESET_TOTAL_KM/_PRESET_DURATION_MIN) nor the local scenario's
    (120.0 km / 108.0 min)."""
    plan_id = _create_merged_plan(
        route_facts=_EXPLICIT_ROUTE_FACTS,
        route_preset_id=_PRESET_ID,
        mountain_range_km=None,
        jam_range_km=None,
    )

    entry = get_draft_entry(plan_id)
    assert entry is not None
    draft, _package, _scenario = entry

    assert draft.route_facts.total_route_distance_km == pytest.approx(
        _EXPLICIT_ROUTE_FACTS["total_route_distance_km"]
    )
    assert draft.route_facts.estimated_route_duration_min == pytest.approx(
        _EXPLICIT_ROUTE_FACTS["estimated_route_duration_min"]
    )
    assert draft.route_facts.total_route_distance_km != pytest.approx(_PRESET_TOTAL_KM)
    assert draft.route_facts.total_route_distance_km != pytest.approx(120.0)


def test_plan_endpoint_route_facts_alone_wins_over_local_analysis():
    """route_facts with NO route_preset_id: also wins over the local
    analyze_route(scenario) path (120.0 km / 108.0 min)."""
    plan_id = _create_merged_plan(
        route_facts=_EXPLICIT_ROUTE_FACTS,
        mountain_range_km=None,
        jam_range_km=None,
    )

    entry = get_draft_entry(plan_id)
    assert entry is not None
    draft, _package, _scenario = entry

    assert draft.route_facts.total_route_distance_km == pytest.approx(200.0)
    assert draft.route_facts.estimated_route_duration_min == pytest.approx(150.0)
    assert draft.route_facts.route_source == "maps"


def test_plan_endpoint_omitting_route_facts_preserves_old_local_behavior():
    """Regression guard: omitting route_facts entirely (the field's default,
    None) must behave BYTE-IDENTICAL to before this feature — the local
    analyze_route(scenario) path, untouched."""
    plan_id = _create_merged_plan(mountain_range_km=None, jam_range_km=None)

    entry = get_draft_entry(plan_id)
    assert entry is not None
    draft, _package, _scenario = entry

    assert draft.route_facts.route_source == "local"
    assert draft.route_facts.total_route_distance_km == pytest.approx(120.0)
    assert draft.route_facts.estimated_route_duration_min == pytest.approx(108.0)


def test_plan_endpoint_route_source_field_overrides_route_facts_embedded_value():
    """route_source (body field) pins the parsed RouteFacts.route_source
    explicitly, overriding whatever the caller's route_facts dict itself
    carried — guards against a caller-supplied dict that omits/mis-sets its
    own embedded route_source."""
    facts_with_local_source = dict(_EXPLICIT_ROUTE_FACTS, route_source="local")
    plan_id = _create_merged_plan(
        route_facts=facts_with_local_source,
        route_source="maps",
        mountain_range_km=None,
        jam_range_km=None,
    )

    entry = get_draft_entry(plan_id)
    assert entry is not None
    draft, _package, _scenario = entry
    assert draft.route_facts.route_source == "maps"


def test_plan_endpoint_paints_mountain_and_jam_over_explicit_route_facts():
    """Paint operations (mountain_road injection + manual traffic jam) must
    work transparently over a passed-in maps route_facts — the SAME painter
    code path as the preset/local cases, just resolved from route_facts
    instead. The km->min jam conversion must use the EXPLICIT route's own
    total_km/estimated_duration_min (200.0 km / 150.0 min), not the local
    scenario's or the preset's."""
    plan_id = _create_merged_plan(
        route_facts=_EXPLICIT_ROUTE_FACTS,
        mountain_range_km=list(_EXPLICIT_MOUNTAIN_RANGE_KM),
        jam_range_km=list(_EXPLICIT_JAM_RANGE_KM),
    )

    entry = get_draft_entry(plan_id)
    assert entry is not None
    draft, _package, _scenario = entry

    assert draft.route_facts.route_source == "maps"
    assert draft.route_facts.total_route_distance_km == pytest.approx(200.0)

    mountain_segments = [
        seg for seg in draft.route_facts.route_segments if seg.segment_type == "mountain_road"
    ]
    assert mountain_segments, "expected an injected mountain_road segment"
    assert min(seg.start_km for seg in mountain_segments) == pytest.approx(
        _EXPLICIT_MOUNTAIN_RANGE_KM[0]
    )
    assert max(seg.start_km + seg.length_km for seg in mountain_segments) == pytest.approx(
        _EXPLICIT_MOUNTAIN_RANGE_KM[1]
    )

    jam_events = [e for e in draft.draft_event_plan.traffic_events if e.id == "manual_jam"]
    assert len(jam_events) == 1
    jam = jam_events[0]
    expected_start_min = (_EXPLICIT_JAM_RANGE_KM[0] / 200.0) * 150.0
    expected_duration_min = ((_EXPLICIT_JAM_RANGE_KM[1] - _EXPLICIT_JAM_RANGE_KM[0]) / 200.0) * 150.0
    assert jam.start_min == pytest.approx(expected_start_min)
    assert jam.duration_min == pytest.approx(expected_duration_min)


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


# ── Situation overrides threaded from the Combined Situation editor ───────────
# (feature 020 exact-reuse redesign): a PAINTED plan must respect the trigger
# fixed-conditions / speed / initial-signal edits made in the Combined Situation
# editor, threaded into the same create_draft the run-plans router uses, with the
# SAME validation rejections on the unpainted path.


def test_plan_endpoint_accepts_valid_situation_overrides():
    """context_overrides / initial_state / profiles are accepted and the draft
    is registered — the merged Situation editor's fixed-conditions, initial
    drowsiness/fatigue, and speed edits reach the painted trigger plan."""
    plan_id = _create_merged_plan(
        context_overrides={"is_night": True, "child_passenger": True},
        initial_state={"drowsiness_level": 90.0},
        profiles={"speed": {"highway_kph": 88.0}},
    )
    entry = get_draft_entry(plan_id)
    assert entry is not None, "plan_id must be registered even with situation overrides"
    draft, _package, _scenario = entry
    # The speed override deep-merges onto the effective scenario's speed_profile,
    # surfaced in the draft's effective_setup (same path the run-plans router uses).
    assert draft.effective_setup["speed_profile"]["highway_kph"] == pytest.approx(88.0)


def test_plan_endpoint_rejects_invalid_context_override_400():
    resp = client.post(
        "/api/merged-runs/plan",
        json={
            "package_id": _TRIGGER_PACKAGE_ID,
            "scenario_id": _TRIGGER_SCENARIO_ID,
            "run_seed": 1,
            "context_overrides": {"is_night": "yes"},  # must be a boolean
        },
    )
    assert resp.status_code == 400
    assert "context_overrides" in json.dumps(resp.json())


def test_plan_endpoint_rejects_invalid_initial_state_400():
    resp = client.post(
        "/api/merged-runs/plan",
        json={
            "package_id": _TRIGGER_PACKAGE_ID,
            "scenario_id": _TRIGGER_SCENARIO_ID,
            "run_seed": 1,
            "initial_state": {"drowsiness_level": 150.0},  # out of [0, 100]
        },
    )
    assert resp.status_code == 400
    assert "initial_state" in json.dumps(resp.json())
