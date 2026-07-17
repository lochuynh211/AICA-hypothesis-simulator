"""TDD: preset endpoints (feature 018 — Proposal Preset Test-Cases).

Covers, per ``specs/018-proposal-preset-testcases/contracts/preset_endpoints.md``:

  - ``GET /api/proposal/presets`` — 18 summaries, sorted by preset_id.
  - ``GET /api/proposal/presets/{preset_id}`` — full Preset; 404 unknown.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from aica_api.main import app

client = TestClient(app)

_EXPECTED_PRESET_IDS = {
    "preset-anime-fan-event-night",
    "preset-child-family-drive",
    "preset-coastal-cruise",
    "preset-coldstart-neutral",
    "preset-drowsy-keepalert",
    "preset-drowsy-soothe",
    "preset-genz-now",
    "preset-high-recovery-regular",
    "preset-jazz-calm-listener",
    "preset-jrock-enthusiast",
    "preset-late-night-winddown",
    "preset-monotone-highway-energize",
    "preset-mountain-pass",
    "preset-oshi-off",
    "preset-oshi-superfan",
    "preset-recently-played-fatigue",
    "preset-reststop-full-karaoke",
    "preset-showa-nostalgia",
}


# ---------------------------------------------------------------------------
# GET /api/proposal/presets
# ---------------------------------------------------------------------------


def test_get_presets_lists_the_18_committed_presets():
    resp = client.get("/api/proposal/presets")
    assert resp.status_code == 200
    body = resp.json()
    presets = body["presets"]
    assert len(presets) == 18
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
            "preset_id", "label", "brief", "family", "contrast_with", "hypothesis",
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
    resp = client.get("/api/proposal/presets/preset-monotone-highway-energize")
    assert resp.status_code == 200
    body = resp.json()
    assert body["preset_id"] == "preset-monotone-highway-energize"
    assert body["family"] == "mood_coherence"
    assert body["contrast_with"] == "preset-late-night-winddown"
    assert body["algorithm_config_overrides"] is None
    assert body["expectation"]["hypothesis"]
    assert body["expectation"]["top_fit_min"] == 0.38
    assert body["world"]["control_inputs"]["dataset_id"]
    assert body["world"]["situation"]["road_type"] == "highway"
    assert body["world"]["driver_profile"]["oshi_id"] == "synthetic-artist-0107"


def test_get_preset_with_algorithm_config_overrides():
    resp = client.get("/api/proposal/presets/preset-drowsy-keepalert")
    assert resp.status_code == 200
    body = resp.json()
    assert body["algorithm_config_overrides"] == {
        "content": {"directional_hypothesis": "keep_alert"},
        "service": None,
    }


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
