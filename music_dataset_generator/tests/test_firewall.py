"""T031 [US1] — firewall structural tests (SC-002, FR-011, FR-032).

- No score/rank/label/target key enters S0–S6; `why_fits_cell`/`web_evidence` never reach
  a `Song`; a song's cell derives only from binned real audio.
- No Soundcharts credential value appears in any committed artifact (FR-011).
- The deterministic transform performs no network I/O (FR-032).
"""
from __future__ import annotations

import json
import socket

import pytest

from mdg.transform import run_transform

_FORBIDDEN = ("recommended", "best_for_world", "target_rank", "item_fit",
              "why_fits_cell", "web_evidence", "\"score\"", "\"rank\"", "\"label\"")


def _run(cache_dir, **kw):
    return run_transform(
        cache_dir, seed=42, tier="demonstration",
        candidate_source="isrc_resolved", generated_at="2026-07-16T00:00:00Z", **kw
    )


def test_no_score_or_label_in_catalog(fixtures_dir) -> None:
    result = _run(fixtures_dir / "cache")
    blob = json.dumps(result.catalog)
    for token in _FORBIDDEN:
        assert token not in blob, f"firewall breach: {token} in frozen catalog"


def test_cell_derives_from_binned_audio_not_llm_guess(fixtures_dir) -> None:
    # A candidate carrying a wrong LLM target_cell_id still bins by real audio.
    from mdg.binner import bin_song
    from mdg.selector import select_catalog

    payload = json.loads(
        (fixtures_dir / "cache" / "JPXX01900124.json").read_text(encoding="utf-8")
    )  # real cell is low-energy/low-tempo
    coords = bin_song(payload)
    cand = {
        "identity": {"isrc": "JPXX01900124", "normalized_name": "x|y"},
        "coords": coords,
        "target_cell_id": "E-hi_T-hi_P-bv",  # deliberately wrong LLM guess
    }
    result = select_catalog([cand])
    assert coords["cell_id"] != "E-hi_T-hi_P-bv"
    assert "JPXX01900124" in result["cells"][coords["cell_id"]]


def test_no_credential_value_in_manifest_or_catalog(fixtures_dir, monkeypatch) -> None:
    sentinel_id = "SENTINEL_APP_ID_9f3a"
    sentinel_key = "SENTINEL_API_KEY_c71e"
    monkeypatch.setenv("SOUNDCHARTS_APP_ID", sentinel_id)
    monkeypatch.setenv("SOUNDCHARTS_API_KEY", sentinel_key)
    result = _run(fixtures_dir / "cache")
    serialized = json.dumps(result.catalog) + json.dumps(result.manifest)
    assert sentinel_id not in serialized
    assert sentinel_key not in serialized


def test_transform_performs_no_network_io(fixtures_dir, monkeypatch) -> None:
    def _boom(*args, **kwargs):  # any socket creation is a firewall breach
        raise AssertionError("transform attempted network I/O (FR-032)")

    monkeypatch.setattr(socket, "socket", _boom)
    result = _run(fixtures_dir / "cache")
    assert result.catalog  # completed with no socket created
