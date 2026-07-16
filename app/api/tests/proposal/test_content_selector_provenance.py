"""P6 T023 (US4) — Complete, provenance-marked feature contract (§9 / A.2).

Every row of the frozen disposition registry is accounted for in the plan as
active / context_only / missing_neutral, each carrying feature-origin + response
provenance; a single history change moves only its own contribution.
"""
from __future__ import annotations

import copy

from tests.proposal.conftest import (
    build_content_context,
    load_catalog,
    load_content_selector,
    load_dispositions,
    manifest_hyperparameters,
)

CS = load_content_selector()
HP = manifest_hyperparameters()
CATALOG = load_catalog("fixtures/catalog/smoke-catalog.json")
REGISTRY = load_dispositions()
REG_IDS = {e["feature_id"] for e in REGISTRY}


def _plan(situation=None, preference=None, history=None, service="music_playlist"):
    snap = {"catalog": CATALOG, "situation": situation or {"drowsiness_level": 80, "motion_state": "stopped"}}
    if preference is not None:
        snap["preference"] = preference
    if history is not None:
        snap["history"] = history
    ctx = build_content_context(selected_service_id=service, feature_snapshot=snap,
                                hyperparameters={**HP, "plan_item_count": 5})
    return CS.evaluate(ctx)


def test_every_registry_row_is_accounted_for():
    result = _plan()
    prov = result["algorithm_provenance"]
    covered = (set(prov["active_features"]) | set(prov["context_only_features"])
               | set(result["unused_available_features"]) | set(result["missing_features"]))
    missing = REG_IDS - covered
    assert not missing, f"registry rows dropped from provenance: {sorted(missing)}"


def test_disposition_report_has_one_entry_per_registry_row():
    result = _plan()
    report = result["algorithm_provenance"]["feature_dispositions"]
    reported_ids = {r["feature_id"] for r in report}
    assert REG_IDS <= reported_ids
    # each reported registry row carries feature-origin + response provenance
    by_id = {r["feature_id"]: r for r in report}
    for fid in REG_IDS:
        row = by_id[fid]
        assert row["feature_origin"], f"{fid} missing feature_origin"
        assert row["response_provenance"], f"{fid} missing response_provenance"
        assert row["effective_disposition"] in {"active", "context_only", "missing_neutral"}


def test_context_only_registry_rows_are_context_only():
    # A registry row declared context_only must never appear as an active feature.
    result = _plan()
    active = set(result["algorithm_provenance"]["active_features"])
    for e in REGISTRY:
        if e["disposition"] == "context_only":
            assert e["feature_id"] not in active, f"{e['feature_id']} should be context_only"


def test_scored_leaves_are_active_when_present():
    # With drowsiness + motion present, those scored leaves must be active.
    result = _plan(situation={"drowsiness_level": 90, "fatigue_level": 40, "motion_state": "stopped"})
    active = set(result["algorithm_provenance"]["active_features"])
    assert {"drowsiness_level", "fatigue_level"} <= active


def _contrib_map(result, track_id):
    for it in result["ordered_items"]:
        if it["item_id"] == track_id:
            return {c["feature_id"]: c["contribution"] for c in it["feature_contributions"]}
    return {}


def test_acceptance_change_moves_only_its_own_contribution():
    tid = "synthetic-track-1003"
    base = _plan(history={})
    bumped = _plan(history={"content_proposal_acceptance_rate": {tid: 100}})
    base_c = _contrib_map(base, tid)
    bump_c = _contrib_map(bumped, tid)
    assert base_c and bump_c
    changed = {k for k in base_c if abs(base_c[k] - bump_c.get(k, 0.0)) > 1e-12}
    assert changed == {"content_proposal_acceptance_rate"}, f"unexpected movers: {changed}"


def test_recovery_change_moves_only_its_own_contribution():
    tid = "synthetic-track-1003"
    base = _plan(history={})
    bumped = _plan(history={"content_recovery_rate": {tid: 100}})
    base_c = _contrib_map(base, tid)
    bump_c = _contrib_map(bumped, tid)
    changed = {k for k in base_c if abs(base_c[k] - bump_c.get(k, 0.0)) > 1e-12}
    assert changed == {"content_recovery_rate"}, f"unexpected movers: {changed}"


def test_played_change_moves_only_its_own_contribution():
    tid = "synthetic-track-1003"
    base = _plan(preference={})
    bumped = _plan(preference={"played_items": [{"track_id": tid, "last_played_at": "2026-07-14T21:00:00Z"}]})
    base_c = _contrib_map(base, tid)
    bump_c = _contrib_map(bumped, tid)
    changed = {k for k in base_c if abs(base_c[k] - bump_c.get(k, 0.0)) > 1e-12}
    assert changed == {"played_items"}, f"unexpected movers: {changed}"
