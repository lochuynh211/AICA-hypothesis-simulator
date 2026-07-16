"""T045 [US3] — loopable, resumable, additive generation (design §4.13, SC-007).

Loop 2 with a populated ledger: re-proposes 0 ledgered names, re-resolves 0 ledgered
(title, artist), re-fetches 0 ledgered ISRC/UUID, retries 0 known misses; enrichment adds
to already-covered cells; the transform over the accumulated cache stays byte-identical.
"""
from __future__ import annotations

import json

from mdg.coverage.plan import build_coverage_plan
from mdg.ledger import is_known
from mdg.selector import select_catalog
from mdg.transform import run_transform


def _ledger_loop1():
    return [
        {"keys": {"isrc": "JPXX01900123", "soundcharts_uuid": "uuid-1",
                  "normalized_name": "night runner|real band"},
         "outcome": "accepted", "miss_reason": None, "cell": "E-hi_T-hi_P-bv", "loop": 1},
        {"keys": {"normalized_name": "ghost song|nobody"},
         "outcome": "miss", "miss_reason": "audio_unavailable", "cell": None, "loop": 1},
    ]


def test_loop2_remaining_excludes_covered_cells() -> None:
    plan = build_coverage_plan("demonstration", ledger=_ledger_loop1())
    assert "E-hi_T-hi_P-bv" not in plan.remaining["cells"]  # already filled in loop 1
    assert len(plan.remaining["cells"]) == 35
    assert plan.enrichment_priority == ["E-hi_T-hi_P-bv"]  # covered cell → enrich


def test_loop2_reproposes_no_ledgered_name() -> None:
    ledger = _ledger_loop1()
    # naming exclusion: a re-proposed accepted name is a known identity
    assert is_known(ledger, {"normalized_name": "night runner|real band"})
    # a known miss is never retried
    assert is_known(ledger, {"normalized_name": "ghost song|nobody"})


def test_loop2_selector_skips_ledgered_identities() -> None:
    ledger = _ledger_loop1()
    cands = [
        {"identity": {"isrc": "JPXX01900123", "normalized_name": "night runner|real band"},
         "coords": {"cell_id": "E-hi_T-hi_P-bv"}},   # ledgered → skip
        {"identity": {"isrc": "NEW", "normalized_name": "new song|new artist"},
         "coords": {"cell_id": "E-lo_T-lo_P-bv"}},   # fresh → accept
    ]
    result = select_catalog(cands, ledger_keys=[e["keys"] for e in ledger])
    accepted = {c["identity"]["isrc"] for c in result["accepted"]}
    assert accepted == {"NEW"}
    assert any(s["reason"] == "ledger_duplicate" for s in result["skipped"])


def test_transform_over_accumulated_cache_byte_identical(fixtures_dir) -> None:
    cache = fixtures_dir / "cache"
    kw = dict(seed=7, tier="demonstration", candidate_source="isrc_resolved",
              generated_at="2026-07-16T00:00:00Z")
    a = run_transform(cache, **kw)
    b = run_transform(cache, **kw)
    assert json.dumps(a.catalog, sort_keys=True) == json.dumps(b.catalog, sort_keys=True)
    assert a.manifest["dataset_hash"] == b.manifest["dataset_hash"]
