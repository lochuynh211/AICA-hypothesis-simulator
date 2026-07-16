"""US3 — carry-over ledger: persistent, gitignored, append-only dedup state (design §4.13).

One entry per song identity ever touched (accepted or miss), keyed by ISRC / Soundcharts
UUID / normalized name. The ledger makes loops **additive and non-redundant**: a known
identity is never re-proposed/re-resolved/re-fetched, and a known miss is never retried.
Keys are identity-only (never a score) so resumability adds no selection pressure.

Storage is a JSON list of entries (each validated by `mdg.models.LedgerEntry`).
"""
from __future__ import annotations

import json
from pathlib import Path

from mdg.models import LedgerEntry

_IDENTITY_FIELDS = ("isrc", "soundcharts_uuid", "normalized_name")


def load_ledger(path: Path) -> list[dict]:
    """Load the ledger as a list of entry dicts (empty list if absent)."""
    path = Path(path)
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict):  # tolerate {"entries": [...]}
        data = data.get("entries", [])
    return data


def append_entry(path: Path, entry: dict) -> None:
    """Validate and append one entry (append-only; never rewrites prior entries)."""
    LedgerEntry.model_validate(entry)  # reject malformed entries early
    ledger = load_ledger(path)
    ledger.append(entry)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(
        json.dumps(ledger, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def _tokens(keys: dict) -> set[tuple[str, str]]:
    return {(f, keys[f]) for f in _IDENTITY_FIELDS if keys.get(f)}


def known_identity_tokens(ledger: list[dict]) -> set[tuple[str, str]]:
    """All identity tokens present in the ledger (for dedup at any stage)."""
    tokens: set[tuple[str, str]] = set()
    for entry in ledger or []:
        tokens |= _tokens(entry.get("keys", {}))
    return tokens


def is_known(ledger: list[dict], keys: dict) -> bool:
    """True if any identity token of `keys` is already in the ledger (accepted or miss)."""
    return bool(_tokens(keys) & known_identity_tokens(ledger))


def current_loop_number(ledger: list[dict]) -> int:
    """The highest loop number present in the ledger (0 for an empty ledger)."""
    return max((e.get("loop", 0) for e in (ledger or [])), default=0)


def accepted_cells(ledger: list[dict]) -> list[str]:
    """Cells filled by accepted entries (for ledger-relative coverage)."""
    return [
        e["cell"] for e in (ledger or [])
        if e.get("outcome") == "accepted" and e.get("cell")
    ]
