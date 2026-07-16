"""S2b — ISRC resolver: (title, artist, year) → ordered candidate ISRCs (design §4.5b).

Reconciles MusicBrainz (multi-ISRC + first-release-date) and Deezer (one ISRC per track)
into a **deduped, ordered candidate-ISRC list**. Ordering is original-release-first:
candidates whose release year is within ±1 of the requested year rank ahead of later
remasters/regional editions, then by ascending release date. No ISRC from either source
raises the per-candidate miss `song_not_found_in_sources` (drives the fill loop).
"""
from __future__ import annotations

import re

from mdg.errors import ErrorCode, MdgMissSignal

# Title markers that indicate a non-studio-original edition. Down-ranked so the canonical
# studio version wins when it is among the candidates (design "original-release-first").
# English markers are word-bounded to avoid false positives (e.g. "Live" inside "Alive");
# Japanese markers are matched as substrings.
_VARIANT_EN = re.compile(
    r"\b(karaoke|live|instrumental|acoustic|remix|cover|off vocal|"
    r"tv size|tv ver|edit|reprise|rearrange|re-?recorded)\b",
    re.IGNORECASE,
)
_VARIANT_JA = ("カラオケ", "ライブ", "ライヴ", "インスト", "オフボーカル", "オフヴォーカル",
               "サイズ", "リミックス", "カバー", "カヴァー")


def _is_variant(title: str | None) -> bool:
    """True if a title looks like a karaoke/live/instrumental/remix edition."""
    if not title:
        return False
    if _VARIANT_EN.search(title):
        return True
    return any(marker in title for marker in _VARIANT_JA)


def _year(date: str | None) -> int | None:
    if not date:
        return None
    try:
        return int(str(date)[:4])
    except ValueError:
        return None


def _coerce_year(year) -> int | None:
    """Coerce a release_year (int or numeric string) to int; None if unparseable."""
    if year is None:
        return None
    try:
        return int(str(year)[:4])
    except (ValueError, TypeError):
        return None


class ISRCResolver:
    def __init__(self, musicbrainz, deezer) -> None:
        self._mb = musicbrainz
        self._dz = deezer

    def resolve(self, title: str, artist: str, year: int | None) -> list[str]:
        """Return an ordered, deduped candidate-ISRC list; raise if none found."""
        year = _coerce_year(year)  # tolerate a string release_year from the handoff
        # (isrc -> earliest known release date) so dedup keeps the original release.
        best_date: dict[str, str | None] = {}
        # (isrc -> is this ISRC ever seen with a NON-variant title?) — a studio title from
        # any source clears the variant flag even if another source's title was a variant.
        non_variant_seen: dict[str, bool] = {}

        def _record(isrc: str, date: str | None, title: str | None) -> None:
            if not isrc:
                return
            if isrc not in best_date:
                best_date[isrc] = date
            elif date and (best_date[isrc] is None or date < best_date[isrc]):
                best_date[isrc] = date
            non_variant_seen[isrc] = non_variant_seen.get(isrc, False) or not _is_variant(title)

        for rec in self._mb.recordings_by_name(title, artist, year):
            for isrc in rec.get("isrcs") or []:
                _record(isrc, rec.get("first_release_date"), rec.get("title"))
        for hit in self._dz.isrcs_for(title, artist, year):
            _record(hit.get("isrc"), hit.get("release_date"), hit.get("title"))

        if not best_date:
            raise MdgMissSignal(
                ErrorCode.song_not_found_in_sources,
                f"no ISRC for '{title}' / '{artist}' in MusicBrainz or Deezer",
            )

        def _rank(isrc: str) -> tuple:
            date = best_date[isrc]
            yr = _year(date)
            year_match = 0 if (year is not None and yr is not None and abs(yr - year) <= 1) else 1
            variant_penalty = 0 if non_variant_seen.get(isrc) else 1
            # Sort: studio-original titles first, then year-matches, then ascending release
            # date, then ISRC for stability. Variant editions (karaoke/live/…) rank last so
            # the harvester tries the canonical version before any variant.
            return (variant_penalty, year_match, date or "9999-99-99", isrc)

        return sorted(best_date, key=_rank)
