"""Feature 018 — end-to-end: a preset's algorithm_config_overrides and
origin_preset_id flow through the REAL router (POST /api/proposal/runs,
quick_check) to the REAL content selector and actually change the outcome.

This closes the loop that the unit tests leave open: merge_algorithm_config is
pure and tested, the endpoints accept the fields, and here we prove the router
applies them before dispatch (the identical world + the `keep_alert` content
override yields a different #1 content track than the default `soothe_destress`).
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from aica_api.config import settings
from aica_api.main import app

client = TestClient(app)

_REAL_SERVICE = "aica_transparent_service_selector_v1"
_REAL_CONTENT = "aica_transparent_content_selector_v1"


@pytest.fixture(autouse=True)
def _isolate_runs_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(tmp_path))
    yield


def _preset(pid: str) -> dict:
    return json.loads((settings.proposal_presets_dir / f"{pid}.json").read_text(encoding="utf-8"))


def _run(world: dict, *, overrides=None, origin_preset_id=None) -> dict:
    body = {
        "world": world,
        "service_package_id": _REAL_SERVICE,
        "content_package_id": _REAL_CONTENT,
        "mode": "quick_check",
        "run_seed": "seed-1",
        "simulation_time": "2026-07-17T10:00:00Z",
    }
    if overrides is not None:
        body["algorithm_config_overrides"] = overrides
    if origin_preset_id is not None:
        body["origin_preset_id"] = origin_preset_id
    resp = client.post("/api/proposal/runs", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _content_top(run: dict):
    evs = [e for e in run["evidence"] if e["step"] == "content" and e.get("output")]
    if not evs:
        return None
    plan = evs[-1]["output"]
    items = plan.get("ordered_items") or []
    return items[0]["item_id"] if items else None


def _content_seq(run: dict):
    evs = [e for e in run["evidence"] if e["step"] == "content" and e.get("output")]
    if not evs:
        return None
    return [it["item_id"] for it in (evs[-1]["output"].get("ordered_items") or [])]


def test_content_override_changes_ranking_through_router():
    # preset-showa-nostalgia carries an isolated content override (raised age-band
    # weight); routed through the REAL dispatch it must change the content ranking
    # vs. the un-overridden run — proving overrides are merged before evaluate.
    sp = _preset("preset-showa-nostalgia")
    world = sp["world"]

    base = _run(world)  # no override
    overridden = _run(world, overrides=sp["algorithm_config_overrides"])

    base_seq = _content_seq(base)
    ov_seq = _content_seq(overridden)
    assert base_seq and ov_seq, (base["status"], overridden["status"])
    assert base_seq != ov_seq, (
        "the preset's algorithm_config_overrides did not change the content ranking "
        f"through the router (both = {base_seq}) — override not applied before dispatch")


def test_origin_preset_id_recorded_in_setup_provenance():
    p = _preset("preset-monotone-highway-energize")
    run = _run(p["world"], origin_preset_id=p["preset_id"])
    origin = (run.get("setup_snapshot") or {}).get("origin") or {}
    assert origin.get("origin_preset_id") == "preset-monotone-highway-energize", origin
