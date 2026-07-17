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


def test_content_override_changes_ranking_through_router():
    kp = _preset("preset-drowsy-keepalert")
    world = kp["world"]  # identical world to preset-drowsy-soothe

    soothe = _run(world)  # default hypothesis, no override
    keepalert = _run(world, overrides=kp["algorithm_config_overrides"])  # {"content": {"directional_hypothesis": "keep_alert"}}

    # Both must actually reach content (service rank-1 is content-supported here).
    top_soothe = _content_top(soothe)
    top_keepalert = _content_top(keepalert)
    assert top_soothe is not None and top_keepalert is not None, (
        soothe["status"], keepalert["status"])
    assert top_soothe != top_keepalert, (
        "keep_alert override did not change the #1 content track through the router "
        f"(both = {top_soothe}) — override not applied before dispatch")


def test_origin_preset_id_recorded_in_setup_provenance():
    p = _preset("preset-monotone-highway-energize")
    run = _run(p["world"], origin_preset_id=p["preset_id"])
    origin = (run.get("setup_snapshot") or {}).get("origin") or {}
    assert origin.get("origin_preset_id") == "preset-monotone-highway-energize", origin
