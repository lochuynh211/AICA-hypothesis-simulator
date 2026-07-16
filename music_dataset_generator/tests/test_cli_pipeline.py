"""CLI integration — the documented offline loop runs end-to-end (RUNBOOK happy path).

Covers the orchestration seam the unit tests miss: transform → worlds (with S7 merge) →
judge (blind labels → real P6 score reveal) → certify (real reversals) → report. Uses only
the committed fixture cache + the real P6 package; no network, no agent.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from mdg.cli import main

FIXTURE_CACHE = Path(__file__).parent / "fixtures" / "cache"


@pytest.fixture
def workspace(tmp_path):
    ws = tmp_path / "ws"
    (ws / "cache").mkdir(parents=True)
    for f in FIXTURE_CACHE.glob("*.json"):
        shutil.copy(f, ws / "cache" / f.name)
    return ws


def _run(ws, ds, *args):
    return main([*args, "--workspace", str(ws), "--dataset-dir", str(ds)])


def test_transform_includes_cached_songs_despite_populated_ledger(workspace, tmp_path) -> None:
    # Regression: after a harvest, the ledger records the cached songs as `accepted`.
    # The transform must still freeze them — it must NOT treat ledger-accepted identities
    # as duplicates to skip (that would empty the catalog). Simulate the post-harvest state.
    ws, ds = workspace, tmp_path / "ds"
    ledger = [{"keys": {"isrc": p.stem, "normalized_name": f"{p.stem}|x"},
               "outcome": "accepted", "miss_reason": None,
               "cell": "E-hi_T-hi_P-bv", "loop": 1}
              for p in (ws / "cache").glob("*.json")]
    (ws / "ledger.json").write_text(json.dumps(ledger))
    assert _run(ws, ds, "transform", "--seed", "1", "--tier", "demonstration",
                "--generated-at", "2026-07-16T00:00:00Z") == 0
    catalog = json.loads(next(ds.glob("*/catalog.json")).read_text())
    assert len(catalog) == len(list((ws / "cache").glob("*.json")))  # all cached songs frozen


def test_transform_worlds_judge_certify_report_pipeline(workspace, tmp_path) -> None:
    ws, ds = workspace, tmp_path / "ds"

    # S3–S6 freeze
    assert _run(ws, ds, "transform", "--seed", "1", "--tier", "demonstration",
                "--generated-at", "2026-07-16T00:00:00Z") == 0
    catalog = json.loads(next(ds.glob("*/catalog.json")).read_text())
    assert catalog

    # S7 worlds
    assert _run(ws, ds, "worlds", "--read-output") == 0
    worlds = json.loads((ws / "worlds.json").read_text())
    assert len(worlds) >= 15
    bundle = json.loads((ws / "contrast_pairs.json").read_text())
    assert len(bundle["pairs"]) == 12

    # S8 judge — blind labels (no score) → real P6 reveal
    labels = [{
        "test_case_id": "tc-01", "world_ref": worlds[0]["world_id"],
        "candidate_song_ref": catalog[0]["spotify_track"]["id"],
        "expected_label": "positive",
        "judge_folds": {"context_need": "x", "mood_genre_fit": "x",
                        "era_cultural_fit": "x", "coherence": "x", "web_evidence": "x"},
    }]
    (ws / "handoff").mkdir(exist_ok=True)
    (ws / "handoff" / "s8_output.json").write_text(json.dumps(labels))
    assert _run(ws, ds, "judge", "--read-output") == 0
    cases = json.loads((ds.parent / "test_cases" / "test_cases.json").read_text())
    assert cases[0]["algorithm_score"] is not None          # real score revealed
    assert cases[0]["agreement"] in ("agree", "disagree")

    # S9 certify — real reversal run over the frozen catalog
    assert _run(ws, ds, "certify") == 0
    cert = json.loads((ds.parent / "build_reports" / "certification_report.json").read_text())
    assert len(cert["certified"]) + len(cert["re_harvest_signals"]) == 12

    # report — reads the persisted stats files, not just stdout
    assert _run(ws, ds, "report", "--tier", "demonstration") == 0
    report = json.loads((ds.parent / "build_reports" / "build_report.json").read_text())
    assert report["agreement_stats"]["agree"] + report["agreement_stats"]["disagree"] == 1


def test_judge_rejects_blind_order_violation_with_clean_envelope(workspace, tmp_path, capsys) -> None:
    ws, ds = workspace, tmp_path / "ds"
    _run(ws, ds, "transform", "--seed", "1", "--tier", "demonstration",
         "--generated-at", "2026-07-16T00:00:00Z")
    _run(ws, ds, "worlds", "--read-output")
    worlds = json.loads((ws / "worlds.json").read_text())
    catalog = json.loads(next(ds.glob("*/catalog.json")).read_text())
    (ws / "handoff").mkdir(exist_ok=True)
    (ws / "handoff" / "s8_output.json").write_text(json.dumps([{
        "test_case_id": "tc-01", "world_ref": worlds[0]["world_id"],
        "candidate_song_ref": catalog[0]["spotify_track"]["id"],
        "expected_label": "positive", "judge_folds": {},
        "algorithm_score": 0.5,  # blind-order breach
    }]))
    rc = _run(ws, ds, "judge", "--read-output")
    assert rc == 1  # clean non-zero, not a traceback
    err = capsys.readouterr().err
    assert json.loads(err.strip().splitlines()[-1])["error"] == "blind_ordering_violation"


def test_worlds_merges_s7_profiles(workspace, tmp_path) -> None:
    ws, ds = workspace, tmp_path / "ds"
    _run(ws, ds, "transform", "--seed", "1", "--tier", "demonstration",
         "--generated-at", "2026-07-16T00:00:00Z")
    catalog = json.loads(next(ds.glob("*/catalog.json")).read_text())
    real_track = catalog[0]["spotify_track"]["id"]
    real_artist = catalog[0]["spotify_track"]["artists"][0]["id"]
    # Agent composes a profile for the daytime-commute world.
    (ws / "handoff").mkdir(exist_ok=True)
    (ws / "handoff" / "s7_output.json").write_text(json.dumps({
        "world-daytime-commute": {
            "direct_item_history": {real_track: {"play_count_30d": 9, "acceptance_rate": 0.9}},
            "upro": {"oshi_registered": True, "oshi_mode": "on", "oshi_id": real_artist,
                     "oshi_type": "artist"},
        }
    }))
    assert _run(ws, ds, "worlds", "--read-output") == 0
    worlds = {w["world_id"]: w for w in json.loads((ws / "worlds.json").read_text())}
    # The agent's composed history was merged (not discarded).
    assert real_track in worlds["world-daytime-commute"]["direct_item_history"]
    assert worlds["world-daytime-commute"]["direct_item_history"][real_track]["play_count_30d"] == 9
