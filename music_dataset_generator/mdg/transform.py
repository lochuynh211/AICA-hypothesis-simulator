"""S3→S6 — Deterministic transform: raw cache → frozen catalog + manifest + hash.

`run_transform(cache_dir, ...)` orchestrates the deterministic core:

    S3 bin + select → S4 map → S5 validate + repair → S6 freeze

over the accumulated raw-response cache. It does **no network I/O, no LLM call, and no
wall-clock read** (`generated_at` is supplied by the caller). Given the same accumulated
cache + seed it produces a **byte-identical** catalog + manifest + hash (SC-001):
payloads are consumed in filename-sorted (ISRC) order and all synthesized fields are
seed-pinned.

The firewall lives here: the coverage cell of every song is decided by `bin_song` on the
real audio, never by an LLM guess or a score.
"""
from __future__ import annotations

import json
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from mdg.binner import bin_song
from mdg.freeze import build_manifest
from mdg.mapper import CatalogMapper
from mdg.repair import validate_and_repair
from mdg.selector import select_catalog
from mdg.validator import validate_coverage


@dataclass
class TransformResult:
    catalog: list[dict]
    manifest: dict
    cells: dict[str, list[str]] = field(default_factory=dict)
    repairs: list[dict] = field(default_factory=list)
    skipped: list[dict] = field(default_factory=list)


def normalized_name(title: str, artist: str) -> str:
    """The ledger normalized-name key: nfkc(lower(strip(title)))|nfkc(...artist)."""
    def norm(s: str) -> str:
        return unicodedata.normalize("NFKC", (s or "").strip().lower())
    return f"{norm(title)}|{norm(artist)}"


def _load_payloads(cache_dir: Path) -> list[dict]:
    """Load all cached raw payloads in deterministic (filename-sorted) order."""
    payloads = []
    for path in sorted(cache_dir.glob("*.json")):
        payloads.append(json.loads(path.read_text(encoding="utf-8")))
    return payloads


def _candidate(payload: dict) -> dict:
    """Build a selector candidate (identity + binned coords) from a raw payload."""
    artists = payload.get("artists") or payload.get("mainArtists") or []
    artist_name = artists[0]["name"] if artists else ""
    isrc = (payload.get("isrc") or {}).get("value")
    return {
        "identity": {
            "isrc": isrc,
            "normalized_name": normalized_name(payload.get("name", ""), artist_name),
        },
        "coords": bin_song(payload),
        "payload": payload,
    }


def run_transform(
    cache_dir: Path,
    *,
    seed: int,
    tier: str,
    candidate_source: str,
    generated_at: str,
    required_cells: set[str] | None = None,
    ledger_keys: list[dict] | None = None,
    negative_isrcs: set[str] | None = None,
) -> TransformResult:
    """Run S3→S6 over the raw cache and return the frozen catalog + manifest."""
    negative_isrcs = negative_isrcs or set()
    payloads = _load_payloads(Path(cache_dir))
    candidates = [_candidate(p) for p in payloads]

    selection = select_catalog(candidates, ledger_keys=ledger_keys)

    mapper = CatalogMapper(seed=seed)
    catalog: list[dict] = []
    repairs: list[dict] = []
    for cand in selection["accepted"]:
        payload = cand["payload"]
        isrc = cand["identity"]["isrc"]
        song = mapper.map_song(payload, negative_fixture=isrc in negative_isrcs)
        repaired, log = validate_and_repair(song)
        for record in log:
            repairs.append({"isrc": isrc, **record})
        catalog.append(repaired)

    covered_cells = {c["coords"]["cell_id"] for c in selection["accepted"]}
    if required_cells is not None:
        validate_coverage(covered_cells=covered_cells, required_cells=required_cells)

    manifest = build_manifest(
        catalog,
        seed=seed,
        tier=tier,
        candidate_source=candidate_source,
        generated_at=generated_at,
    )

    return TransformResult(
        catalog=catalog,
        manifest=manifest,
        cells=selection["cells"],
        repairs=repairs,
        skipped=selection["skipped"],
    )


def write_dataset(result: TransformResult, dataset_dir: Path) -> Path:
    """Write catalog.json + dataset_manifest.json under dataset_dir/<dataset_id>/.

    Uses sorted-key, newline-terminated JSON so the on-disk bytes are reproducible.
    Returns the dataset directory written.
    """
    out_dir = Path(dataset_dir) / result.manifest["dataset_id"]
    out_dir.mkdir(parents=True, exist_ok=True)
    _write_json(out_dir / "catalog.json", result.catalog)
    _write_json(out_dir / "dataset_manifest.json", result.manifest)
    return out_dir


def _write_json(path: Path, obj: Any) -> None:
    path.write_text(
        json.dumps(obj, sort_keys=True, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
