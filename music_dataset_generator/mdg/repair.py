"""S5 — Repair loop: deterministic §18 repairs with a 2-strike halt.

`validate_and_repair(song)` validates a mapped song; on a `SongViolation` it applies the
matching deterministic repair (data-spec §18), logs it, and re-validates. The repair
budget is **2**; once exhausted with the record still invalid it raises
`MdgFatalError(catalog_generation_failed)` (worked example §7). No silent hand-edits —
every applied repair is recorded in the returned log for the build report.
"""
from __future__ import annotations

import copy
import math
from typing import Any
from urllib.parse import urlparse

from mdg.errors import ErrorCode, MdgFatalError
from mdg.validator import SongViolation, validate_song

_MAX_REPAIRS = 2
_NOISE = 1e-9
_API = "https://api.synthetic.invalid"

# audio [0,1] fields, for serialization-noise clamping
_ZERO_ONE = ("acousticness", "danceability", "energy", "instrumentalness",
             "liveness", "speechiness", "valence")


def _repair_identity(song: dict) -> dict | None:
    """Repair a cross-object identity or synthetic-ID mismatch (§18).

    Copies the canonical Track id/uri/duration onto the audio-features object and, if a
    non-synthetic ID slipped in, there is nothing to canonicalise → returns None.
    """
    track = song["spotify_track"]
    af = song["spotify_audio_features"]

    if not str(track["id"]).startswith("synthetic-"):
        return None  # the canonical Track ID itself is bad — not deterministically repairable

    changed = None
    if af["id"] != track["id"]:
        af["id"] = track["id"]
        changed = {"rule": "copy_canonical_id", "field": "audio_features.id"}
    elif af["uri"] != track["uri"]:
        af["uri"] = track["uri"]
        changed = {"rule": "copy_canonical_uri", "field": "audio_features.uri"}
    elif af["duration_ms"] != track["duration_ms"]:
        af["duration_ms"] = track["duration_ms"]
        changed = {"rule": "copy_canonical_duration", "field": "audio_features.duration_ms"}
    return changed


# Canonical URL for each field, rebuilt purely from the synthetic track ID (§18) —
# mirrors mdg.mapper's URL scheme so a rebuild reproduces the original good value.
def _canonical_track_url(field: str, track_id: str) -> str:
    return {
        "href": f"{_API}/tracks/{track_id}",
        "preview_url": f"{_API}/previews/{track_id}",
    }[field]


def _canonical_af_url(field: str, track_id: str) -> str:
    return {
        "analysis_url": f"{_API}/audio-analysis/{track_id}",
        "track_href": f"{_API}/tracks/{track_id}",
    }[field]


def _bad_url(url: Any) -> bool:
    if not isinstance(url, str) or not url:
        return False
    host = urlparse(url).hostname or ""
    return not host.endswith(".invalid")


def _repair_url(song: dict) -> dict | None:
    """Rebuild any non-`.invalid` HTTP(S) URL from the canonical synthetic ID (§18)."""
    track = song["spotify_track"]
    track_id = track["id"]

    for field in ("href", "preview_url"):
        if _bad_url(track.get(field)):
            track[field] = _canonical_track_url(field, track_id)
            return {"rule": "rebuild_invalid_url", "field": f"track.{field}"}
    ext = track.get("external_urls") or {}
    if _bad_url(ext.get("spotify")):
        ext["spotify"] = f"https://open.synthetic.invalid/track/{track_id}"
        return {"rule": "rebuild_invalid_url", "field": "track.external_urls.spotify"}
    af = song["spotify_audio_features"]
    for field in ("analysis_url", "track_href"):
        if _bad_url(af.get(field)):
            af[field] = _canonical_af_url(field, track_id)
            return {"rule": "rebuild_invalid_url", "field": f"audio_features.{field}"}
    return None


def _repair_schema(song: dict) -> dict | None:
    """Repair schema/range breakage: clamp [0,1] fields only within serialization noise.

    A value further than 1e-9 outside [0,1] is real corruption, not noise; §18 says
    "otherwise regenerate", which is impossible for real audio, so it returns None and
    the loop escalates to catalog_generation_failed.
    """
    af = song["spotify_audio_features"]
    for field in _ZERO_ONE:
        v = af.get(field)
        if not isinstance(v, (int, float)) or not math.isfinite(v):
            continue
        if 0.0 <= v <= 1.0:
            continue
        nearest = 0.0 if v < 0.0 else 1.0
        if abs(v - nearest) <= _NOISE:
            af[field] = nearest
            return {"rule": "clamp_serialization_noise", "field": f"audio_features.{field}"}
    return None


_REPAIRERS = {
    "identity": _repair_identity,
    "url": _repair_url,
    "schema": _repair_schema,
    "flag": _repair_schema,
}


def validate_and_repair(song: dict) -> tuple[dict, list[dict]]:
    """Validate + deterministically repair a song. Return (repaired_song, repair_log)."""
    current = copy.deepcopy(song)
    log: list[dict] = []

    while True:
        try:
            validate_song(current)
            return current, log
        except SongViolation as violation:
            if len(log) >= _MAX_REPAIRS:
                raise MdgFatalError(
                    ErrorCode.catalog_generation_failed,
                    f"{len(log)} repairs exhausted, still invalid: {violation}",
                ) from violation
            repairer = _REPAIRERS.get(violation.category)
            record = repairer(current) if repairer else None
            if record is None:
                raise MdgFatalError(
                    ErrorCode.catalog_generation_failed,
                    f"no deterministic repair for {violation.category}: {violation}",
                ) from violation
            log.append(record)
