"""S2c — by-ISRC harvest gate: walk candidate ISRCs until populated matching audio.

`harvest_by_isrc(sc, candidate_isrcs, target_language)` applies the deterministic gates in
order (design §4.5b). It never relabels: a real `languageCode` that disagrees with the
cell target discards the whole named song. The firewall holds — the real audio (fetched
here) is what a later `bin_song` uses to decide the cell, not any LLM guess.
"""
from __future__ import annotations

from dataclasses import dataclass, field

# the 12 P6-scored audio fields that must all be present + non-null (design §1.1)
_REQUIRED_AUDIO = (
    "acousticness", "danceability", "energy", "instrumentalness", "key",
    "liveness", "loudness", "mode", "speechiness", "tempo", "timeSignature", "valence",
)


@dataclass
class HarvestOutcome:
    """Result of walking one song's candidate ISRCs.

    status is ``"accepted"`` or a miss code
    (``isrc_not_in_soundcharts`` / ``language_mismatch``).
    """

    status: str
    song: dict | None = None
    isrc: str | None = None
    tried: list[str] = field(default_factory=list)


def audio_complete(audio: dict | None) -> bool:
    """True iff the audio block carries all required P6-scored fields, non-null."""
    if not isinstance(audio, dict):
        return False
    return all(audio.get(field) is not None for field in _REQUIRED_AUDIO)


def harvest_by_isrc(sc, candidate_isrcs, *, target_language: str | None) -> HarvestOutcome:
    """Walk candidate ISRCs; return the first populated, language-matching song."""
    tried: list[str] = []
    saw_incomplete_audio = False  # at least one candidate existed but had null/partial audio
    for isrc in candidate_isrcs:
        tried.append(isrc)
        song = sc.by_isrc(isrc)
        if song is None:
            continue  # isrc_not_in_soundcharts — try next candidate
        if not audio_complete(song.get("audio")):
            saw_incomplete_audio = True
            continue  # audio_unavailable — try next candidate
        language = song.get("languageCode")
        if target_language is not None and language != target_language:
            # Discard the whole named song — never relabel to a different cell/language.
            return HarvestOutcome("language_mismatch", isrc=isrc, tried=tried)
        return HarvestOutcome("accepted", song=song, isrc=isrc, tried=tried)
    # Distinguish the two exhaustion causes: a real record with unusable audio is an
    # audio_unavailable miss, not "ISRC not in Soundcharts".
    status = "audio_unavailable" if saw_incomplete_audio else "isrc_not_in_soundcharts"
    return HarvestOutcome(status, tried=tried)
