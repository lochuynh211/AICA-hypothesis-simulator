"""S2 — raw-response cache + lineage I/O (gitignored generation state, §6.3).

The raw cache is keyed by ISRC (`{isrc}.json`) so the deterministic transform can read it
in filename-sorted order. The lineage file maps each synthetic ID to its Soundcharts
source (real name/genre/resolved ISRC/candidate ISRCs) for audit + integrity checks.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def store_cache_entry(cache_dir: Path, isrc: str, payload: dict) -> Path:
    """Write a raw Soundcharts payload to `<cache_dir>/{isrc}.json`."""
    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"{isrc}.json"
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return path


def load_cache_entry(cache_dir: Path, isrc: str) -> dict:
    return json.loads((Path(cache_dir) / f"{isrc}.json").read_text(encoding="utf-8"))


def load_lineage(lineage_path: Path) -> dict:
    path = Path(lineage_path)
    if not path.exists():
        return {"entries": []}
    return json.loads(path.read_text(encoding="utf-8"))


def append_lineage(lineage_path: Path, entry: dict) -> None:
    """Append a lineage entry (append-only provenance record)."""
    lineage = load_lineage(lineage_path)
    lineage.setdefault("entries", []).append(entry)
    Path(lineage_path).parent.mkdir(parents=True, exist_ok=True)
    Path(lineage_path).write_text(
        json.dumps(lineage, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def store_accepted(
    song: dict,
    *,
    cache_dir: Path,
    lineage_path: Path,
    synthetic_id: str,
    soundcharts_uuid: str,
    resolved_isrc: str,
    candidate_isrcs: list[str],
    loop: int,
) -> None:
    """Store an accepted harvested song to the cache and append its lineage entry."""
    store_cache_entry(cache_dir, resolved_isrc, song)
    genres = song.get("genres") or []
    first_genre = genres[0] if genres else {}
    append_lineage(lineage_path, {
        "synthetic_id": synthetic_id,
        "soundcharts_uuid": soundcharts_uuid,
        "real_name": song.get("name"),
        "real_genre_text": {
            "root": first_genre.get("root"),
            "sub": list(first_genre.get("sub") or []),
        },
        "resolved_isrc": resolved_isrc,
        "candidate_isrcs": list(candidate_isrcs),
        "loop": loop,
    })
