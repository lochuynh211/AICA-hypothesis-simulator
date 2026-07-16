"""T048 [US4] — strategy parity (SC-008).

A fixed raw-response cache yields a **byte-identical catalog** regardless of which
`candidate_source` populated it — the transform (S3+) is strategy-agnostic. Only the
manifest's provenance field records which strategy ran.
"""
from __future__ import annotations

import json

from mdg.transform import run_transform


def test_catalog_byte_identical_across_strategies(fixtures_dir) -> None:
    cache = fixtures_dir / "cache"
    common = dict(seed=42, tier="demonstration", generated_at="2026-07-16T00:00:00Z")
    a = run_transform(cache, candidate_source="isrc_resolved", **common)
    b = run_transform(cache, candidate_source="soundcharts_search", **common)

    assert json.dumps(a.catalog, sort_keys=True) == json.dumps(b.catalog, sort_keys=True)
    assert a.manifest["dataset_hash"] == b.manifest["dataset_hash"]  # hash over catalog only
    # Only provenance differs.
    assert a.manifest["candidate_source"] == "isrc_resolved"
    assert b.manifest["candidate_source"] == "soundcharts_search"
