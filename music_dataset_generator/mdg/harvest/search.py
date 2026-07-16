"""S1a/S2a — Strategy A (`soundcharts_search`) front-half (design §4.2–4.5, D9).

The original candidate strategy: LLM search seeds (S0.5) → Soundcharts SEARCH (S1a) → LLM
narrowing (S1.5) → by-UUID harvest (S2a). The SEARCH-by-metric endpoint is unavailable on
the current subscription, so `search_candidates` raises `strategy_unavailable` (FR-009);
Strategy A is retained as a documented fallback. The by-UUID harvest (`harvest_shortlist`)
still works from a recorded/known UUID shortlist and terminates at the same raw-response
cache + lineage boundary the transform consumes — so S3+ is strategy-agnostic.
"""
from __future__ import annotations

from mdg.harvest.by_uuid import harvest_by_uuid


def search_candidates(sc, seeds) -> list[dict]:
    """S1a — execute the Soundcharts search for candidate seeds.

    Raises `strategy_unavailable` because search-by-metric is off-subscription (D9).
    """
    return sc.search(query=seeds)  # SoundchartsClient.search raises strategy_unavailable


def harvest_shortlist(sc, uuids, *, target_language: str | None = None) -> list:
    """S2a — fetch each shortlisted UUID, returning the accepted harvest outcomes.

    Downstream of this call the raw cache + lineage are identical to Strategy B's, so the
    transform is strategy-agnostic (SC-008).
    """
    outcomes = []
    for uuid in uuids:
        outcomes.append(harvest_by_uuid(sc, uuid, target_language=target_language))
    return outcomes
