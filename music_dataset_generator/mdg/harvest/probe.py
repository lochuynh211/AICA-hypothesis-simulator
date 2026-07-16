"""S2c pre-flight — audio-coverage probe gate (design §4.5c, FR-008).

Fetch a hand-picked ISRC set via `by-isrc` and count how many return a complete, non-null
audio block. The probe defines the achievable era/region ceiling; below the 60% threshold
it raises `isrc_probe_gate_failed` so Strategy B constrains its plan before committing
quota to thin cells.
"""
from __future__ import annotations

from mdg.errors import ErrorCode, MdgFatalError
from mdg.harvest.by_isrc import audio_complete

_THRESHOLD = 0.60


def run_probe(sc, isrcs: list[str], *, threshold: float = _THRESHOLD) -> dict:
    """Probe `isrcs`; return the result dict; raise isrc_probe_gate_failed if below gate."""
    fetched = len(isrcs)
    populated = 0
    for isrc in isrcs:
        song = sc.by_isrc(isrc)
        if song is not None and audio_complete(song.get("audio")):
            populated += 1

    ratio = (populated / fetched) if fetched else 0.0
    passed = ratio >= threshold
    result = {
        "fetched": fetched,
        "populated_audio": populated,
        "threshold": threshold,
        "ratio": ratio,
        "passed": passed,
    }
    if not passed:
        raise MdgFatalError(
            ErrorCode.isrc_probe_gate_failed,
            f"probe populated audio {populated}/{fetched} "
            f"({ratio:.0%}) below {threshold:.0%} gate",
        )
    return result
