"""TDD: preset endpoints (feature 018 — Proposal Preset Test-Cases).

Covers, per ``specs/018-proposal-preset-testcases/contracts/preset_endpoints.md``:

  - ``GET /api/proposal/presets`` — 18 summaries, sorted by preset_id.
  - ``GET /api/proposal/presets/{preset_id}`` — full Preset; 404 unknown.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from aica_api.main import app
from aica_api.config import settings

client = TestClient(app)
_PRESETS_DIR = settings.proposal_contracts_dir / "presets"

_EXPECTED_PRESET_IDS = {p.stem for p in _PRESETS_DIR.glob("preset-*.json")}


# ---------------------------------------------------------------------------
# GET /api/proposal/presets
# ---------------------------------------------------------------------------


def test_get_presets_lists_the_18_committed_presets():
    resp = client.get("/api/proposal/presets")
    assert resp.status_code == 200
    body = resp.json()
    presets = body["presets"]
    assert len(presets) == 32
    ids = {p["preset_id"] for p in presets}
    assert ids == _EXPECTED_PRESET_IDS


def test_get_presets_sorted_by_preset_id():
    resp = client.get("/api/proposal/presets")
    ids = [p["preset_id"] for p in resp.json()["presets"]]
    assert ids == sorted(ids)


def test_get_presets_summary_shape():
    resp = client.get("/api/proposal/presets")
    for summary in resp.json()["presets"]:
        assert set(summary.keys()) == {
            "preset_id", "label", "brief", "category", "family", "journey", "contrast_with", "hypothesis",
        }
        assert set(summary["label"].keys()) == {"ja", "en"}
        assert set(summary["brief"].keys()) == {"ja", "en"}
        assert summary["label"]["ja"] and summary["label"]["en"]
        assert summary["brief"]["ja"] and summary["brief"]["en"]
        assert summary["hypothesis"]
        # world/algorithm_config_overrides/expectation are NOT shipped in the
        # list projection (data-model.md §PresetSummary).
        assert "world" not in summary
        assert "expectation" not in summary
        assert "algorithm_config_overrides" not in summary


# ---------------------------------------------------------------------------
# GET /api/proposal/presets/{preset_id}
# ---------------------------------------------------------------------------


def test_get_preset_returns_the_full_preset():
    resp = client.get("/api/proposal/presets/preset-oshi-superfan")
    assert resp.status_code == 200
    body = resp.json()
    assert body["preset_id"] == "preset-oshi-superfan"
    assert body["category"] == "preference"
    assert body["family"] == "oshi_personalization"
    assert body["journey"] is None
    assert body["contrast_with"] == "preset-oshi-off"
    assert body["algorithm_config_overrides"] is None
    assert body["expectation"]["hypothesis"]
    assert body["expectation"]["top_fit_min"] == 0.15
    assert body["world"]["control_inputs"]["dataset_id"]
    assert body["world"]["situation"]["road_type"] == "highway"
    assert body["world"]["driver_profile"]["oshi_id"] == "synthetic-artist-0122"


def test_get_preset_with_algorithm_config_overrides():
    # preset-showa-nostalgia carries an isolated content override (raised
    # era/age-band weight) — served verbatim on the full preset.
    resp = client.get("/api/proposal/presets/preset-showa-nostalgia")
    assert resp.status_code == 200
    ov = resp.json()["algorithm_config_overrides"]
    assert ov is not None
    assert ov.get("content") is not None  # the AGE_BOOST content-config delta


def test_get_preset_404_unknown_preset_id():
    resp = client.get("/api/proposal/presets/preset-does-not-exist")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "preset not found: preset-does-not-exist"


def test_no_mutation_route_exists_for_presets():
    # Presets are committed, read-only (FR-018) — no POST/PUT/DELETE route.
    resp = client.post("/api/proposal/presets", json={})
    assert resp.status_code in (404, 405)
    resp = client.delete("/api/proposal/presets/preset-coldstart-neutral")
    assert resp.status_code in (404, 405)
