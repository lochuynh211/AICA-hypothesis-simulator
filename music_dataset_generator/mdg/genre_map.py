"""US5 — real Soundcharts genres → frozen `genre_affinity_v1` vocabulary (design §13).

A **P2 generation artifact only**: the 12-term vocabulary stays frozen (no enum/schema/
algorithm change). The map decides, per real `{root, sub[]}`, which frozen term (if any) an
artist's genre resolves to when writing `artist_genres` (§4.7).

Resolution (total by construction):
1. **Sub-override** — any matching `sub` wins (six vocab terms live as subs under
   generic/surprising roots).
2. **Root-fallback** — else map by `root`.
3. **Unmapped** — else `genre_unmappable_to_vocabulary` → `MISSING_NEUTRAL` (the artist
   contributes no genre for that entry; no weight redistribution — data-spec §21.1).
"""
from __future__ import annotations

from typing import Any

# The frozen 12-term vocabulary (mirrors aica_api GenreLiteral; kept literal so the
# generator has no import-time dependency beyond the reused schema).
GENRE_VOCABULARY: tuple[str, ...] = (
    "j-pop", "j-rock", "city pop", "anime", "vocaloid", "enka",
    "children's music", "classical", "jazz", "ambient", "electronic", "japanese folk",
)

# Sentinel for an unmapped genre (data-spec §21.1 missing_neutral). Distinct object so
# callers test identity, not a magic string that could collide with a vocab term.
MISSING_NEUTRAL = "missing_neutral"

# §13.1 — sub-overrides (case-insensitive), applied first.
_SUB_OVERRIDES: dict[str, str] = {
    "city pop": "city pop",
    "j-rock": "j-rock", "anime rock": "j-rock", "visual kei": "j-rock",
    "enka": "enka", "kayokyoku": "enka",
    "anime": "anime", "anime piano": "anime", "otacore": "anime", "precure": "anime",
    "kamen rider": "anime", "mecha": "anime", "super sentai": "anime",
    "vocaloid": "vocaloid", "vocaloid metal": "vocaloid", "touhou": "vocaloid",
    "doujin": "vocaloid",
    "japanese folk": "japanese folk", "taiko": "japanese folk", "koto": "japanese folk",
    "shakuhachi": "japanese folk", "min'yō": "japanese folk",
    "japanese traditional": "japanese folk",
}

# §13.2 — root-fallback for the 34 Soundcharts roots (only these six map; rest neutral).
_ROOT_FALLBACK: dict[str, str] = {
    "j-pop": "j-pop",
    "classical": "classical",
    "jazz": "jazz",
    "ambient": "ambient",
    "electro": "electronic", "edm": "electronic", "disco": "electronic",
    "kids": "children's music",
}


def map_genre_text(genre: dict) -> str | Any:
    """Map one `{root, sub[]}` to a vocab term, or MISSING_NEUTRAL if unmapped."""
    subs = genre.get("sub") or []
    for sub in subs:
        override = _SUB_OVERRIDES.get(str(sub).strip().lower())
        if override is not None:
            return override
    root = str(genre.get("root", "")).strip().lower()
    fallback = _ROOT_FALLBACK.get(root)
    if fallback is not None:
        return fallback
    return MISSING_NEUTRAL


def resolve_artist_genres(genres: list[dict]) -> list[str]:
    """Union an artist's genre entries into deduped, order-stable vocab terms.

    Unmapped entries (MISSING_NEUTRAL) contribute nothing.
    """
    out: list[str] = []
    for genre in genres or []:
        term = map_genre_text(genre)
        if term is not MISSING_NEUTRAL and term not in out:
            out.append(term)
    return out
