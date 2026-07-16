"""S2a — by-UUID harvest (Strategy A metadata fetch).

Thin gate over the Soundcharts `by-uuid` endpoint mirroring the by-ISRC audio gate: fetch
a song by its Soundcharts UUID and return it only when the audio block is complete.
"""
from __future__ import annotations

from mdg.harvest.by_isrc import HarvestOutcome, audio_complete


def harvest_by_uuid(sc, uuid: str, *, target_language: str | None = None) -> HarvestOutcome:
    """Fetch one song by UUID, applying the audio + language gates."""
    song = sc.by_uuid(uuid)
    if song is None:
        return HarvestOutcome("isrc_not_in_soundcharts", tried=[uuid])
    if not audio_complete(song.get("audio")):
        return HarvestOutcome("audio_unavailable", tried=[uuid])
    language = song.get("languageCode")
    if target_language is not None and language != target_language:
        return HarvestOutcome("language_mismatch", isrc=uuid, tried=[uuid])
    return HarvestOutcome("accepted", song=song, isrc=uuid, tried=[uuid])
