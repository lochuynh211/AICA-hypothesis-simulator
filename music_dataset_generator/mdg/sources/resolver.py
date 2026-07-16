"""S2b — ISRC resolver: (title, artist, year) → ordered candidate ISRCs (design §4.5b).

Reconciles MusicBrainz (multi-ISRC + first-release-date) and Deezer (one ISRC per track)
into a **deduped, ordered candidate-ISRC list**. Ordering is original-release-first:
candidates whose release year is within ±1 of the requested year rank ahead of later
remasters/regional editions, then by ascending release date. No ISRC from either source
raises the per-candidate miss `song_not_found_in_sources` (drives the fill loop).
"""
from __future__ import annotations

from mdg.errors import ErrorCode, MdgMissSignal


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

        def _record(isrc: str, date: str | None) -> None:
            if not isrc:
                return
            if isrc not in best_date:
                best_date[isrc] = date
            elif date and (best_date[isrc] is None or date < best_date[isrc]):
                best_date[isrc] = date

        for rec in self._mb.recordings_by_name(title, artist, year):
            for isrc in rec.get("isrcs") or []:
                _record(isrc, rec.get("first_release_date"))
        for hit in self._dz.isrcs_for(title, artist, year):
            _record(hit.get("isrc"), hit.get("release_date"))

        if not best_date:
            raise MdgMissSignal(
                ErrorCode.song_not_found_in_sources,
                f"no ISRC for '{title}' / '{artist}' in MusicBrainz or Deezer",
            )

        def _rank(isrc: str) -> tuple:
            date = best_date[isrc]
            yr = _year(date)
            year_match = 0 if (year is not None and yr is not None and abs(yr - year) <= 1) else 1
            # Sort: year-matches first, then ascending release date, then ISRC for stability.
            return (year_match, date or "9999-99-99", isrc)

        return sorted(best_date, key=_rank)
