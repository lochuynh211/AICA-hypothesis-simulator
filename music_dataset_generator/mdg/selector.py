"""S3 — Selector: admit songs to the catalog by coverage pigeonhole.

`select_catalog(candidates, ledger_keys=None)` groups candidates into their **real
binned cell** (`coords.cell_id`) and admits them by pigeonhole. Per D13, cells may hold
multiple songs; a candidate is skipped only when it is a duplicate identity — either
already in the carry-over ledger (`ledger_duplicate`) or seen earlier in this batch
(`batch_duplicate`). It is **never** admitted or rejected by a score, and the LLM's
`target_cell_id` guess never assigns the cell (the `wrong_cell` firewall case: a wrong
guess simply lands where its real audio bins).

Candidate shape:

    {
      "identity": {"isrc"?, "soundcharts_uuid"?, "normalized_name"},
      "coords": {..., "cell_id": "E-hi_T-hi_P-bv"},   # from mdg.binner.bin_song
      "target_cell_id": "..."?,                        # LLM guess — advisory only
    }

Returns::

    {
      "accepted": [candidate, ...],        # input order preserved (deterministic)
      "skipped":  [{"candidate", "reason"}, ...],
      "cells":    {cell_id: [identity-key, ...]},
    }

Input order is preserved verbatim; the caller (transform CLI) feeds candidates in a
deterministic order (sorted by ISRC / cache filename) so the whole transform is
byte-reproducible.
"""
from __future__ import annotations

from typing import Any, Iterable

_IDENTITY_FIELDS = ("isrc", "soundcharts_uuid", "normalized_name")


def _identity_tokens(identity: dict) -> set[tuple[str, str]]:
    """Return the set of (field, value) identity tokens present on a candidate."""
    return {
        (field, identity[field])
        for field in _IDENTITY_FIELDS
        if identity.get(field)
    }


def _identity_label(identity: dict) -> str:
    """Pick a stable display label for the cells map (isrc preferred)."""
    for field in _IDENTITY_FIELDS:
        if identity.get(field):
            return identity[field]
    return "<unknown>"


def select_catalog(
    candidates: Iterable[dict],
    ledger_keys: list[dict] | None = None,
) -> dict[str, Any]:
    """Admit candidates by coverage pigeonhole; skip duplicate identities only."""
    ledger_tokens: set[tuple[str, str]] = set()
    for keys in (ledger_keys or []):
        ledger_tokens |= _identity_tokens(keys)

    seen_tokens: set[tuple[str, str]] = set()
    accepted: list[dict] = []
    skipped: list[dict] = []
    cells: dict[str, list[str]] = {}

    for cand in candidates:
        identity = cand["identity"]
        tokens = _identity_tokens(identity)

        if tokens & ledger_tokens:
            skipped.append({"candidate": cand, "reason": "ledger_duplicate"})
            continue
        if tokens & seen_tokens:
            skipped.append({"candidate": cand, "reason": "batch_duplicate"})
            continue

        seen_tokens |= tokens

        cell_id = cand["coords"]["cell_id"]  # real binned cell — never target_cell_id
        cells.setdefault(cell_id, []).append(_identity_label(identity))
        accepted.append(cand)

    return {"accepted": accepted, "skipped": skipped, "cells": cells}
