"""Typed error/status taxonomy for the music-dataset generator.

All codes from specs/012-music-dataset-generator/contracts/error-taxonomy.md.

Three categories:
  - Run-fatal (halt): MdgFatalError; FATAL_CODES set; is_fatal(code) → True
  - Miss signals (non-fatal, logged): MdgMissSignal; MISS_CODES set; is_miss(code) → True
  - Data status: judge_disagreement — NOT an exception; a plain ErrorCode member.

Usage:
    raise MdgFatalError(ErrorCode.catalog_generation_failed, "detail …")
    raise MdgMissSignal(ErrorCode.language_mismatch, "expected ja got en")
"""
from __future__ import annotations

from enum import Enum


# ---------------------------------------------------------------------------
# ErrorCode — stable string enum covering all taxonomy codes
# ---------------------------------------------------------------------------

class ErrorCode(str, Enum):
    """All typed error / status codes for mdg.

    Values are the stable string representations used in CLI output and logs.
    """

    # Run-fatal codes
    catalog_generation_failed = "catalog_generation_failed"
    coverage_contract_failed = "coverage_contract_failed"
    synthetic_identity_violation = "synthetic_identity_violation"
    cross_object_identity_mismatch = "cross_object_identity_mismatch"
    lineage_integrity_failed = "lineage_integrity_failed"
    world_reference_failed = "world_reference_failed"
    invalid_genre_extension = "invalid_genre_extension"
    isrc_probe_gate_failed = "isrc_probe_gate_failed"
    strategy_unavailable = "strategy_unavailable"
    soundcharts_harvest_failed = "soundcharts_harvest_failed"

    # Per-candidate miss-signal codes
    song_not_found_in_sources = "song_not_found_in_sources"
    isrc_not_in_soundcharts = "isrc_not_in_soundcharts"
    audio_unavailable = "audio_unavailable"
    language_mismatch = "language_mismatch"
    wrong_cell = "wrong_cell"
    cell_unfillable_from_source = "cell_unfillable_from_source"
    genre_unmappable_to_vocabulary = "genre_unmappable_to_vocabulary"

    # Data status (NOT an exception — a recordable value)
    judge_disagreement = "judge_disagreement"


# ---------------------------------------------------------------------------
# Category sets
# ---------------------------------------------------------------------------

FATAL_CODES: frozenset[ErrorCode] = frozenset({
    ErrorCode.catalog_generation_failed,
    ErrorCode.coverage_contract_failed,
    ErrorCode.synthetic_identity_violation,
    ErrorCode.cross_object_identity_mismatch,
    ErrorCode.lineage_integrity_failed,
    ErrorCode.world_reference_failed,
    ErrorCode.invalid_genre_extension,
    ErrorCode.isrc_probe_gate_failed,
    ErrorCode.strategy_unavailable,
    ErrorCode.soundcharts_harvest_failed,
})

MISS_CODES: frozenset[ErrorCode] = frozenset({
    ErrorCode.song_not_found_in_sources,
    ErrorCode.isrc_not_in_soundcharts,
    ErrorCode.audio_unavailable,
    ErrorCode.language_mismatch,
    ErrorCode.wrong_cell,
    ErrorCode.cell_unfillable_from_source,
    ErrorCode.genre_unmappable_to_vocabulary,
})


# ---------------------------------------------------------------------------
# Category query helpers
# ---------------------------------------------------------------------------

def is_fatal(code: ErrorCode) -> bool:
    """Return True if the code is a run-fatal error."""
    return code in FATAL_CODES


def is_miss(code: ErrorCode) -> bool:
    """Return True if the code is a per-candidate miss signal."""
    return code in MISS_CODES


# ---------------------------------------------------------------------------
# MissReason — enum for LedgerEntry.miss_reason (miss codes only)
# ---------------------------------------------------------------------------

class MissReason(str, Enum):
    """Subset of ErrorCode values valid as LedgerEntry.miss_reason."""

    song_not_found_in_sources = "song_not_found_in_sources"
    isrc_not_in_soundcharts = "isrc_not_in_soundcharts"
    audio_unavailable = "audio_unavailable"
    language_mismatch = "language_mismatch"
    wrong_cell = "wrong_cell"
    cell_unfillable_from_source = "cell_unfillable_from_source"
    genre_unmappable_to_vocabulary = "genre_unmappable_to_vocabulary"


# ---------------------------------------------------------------------------
# Exception classes
# ---------------------------------------------------------------------------

class MdgFatalError(Exception):
    """Run-fatal error — halts the generator run.

    Always carries a typed ErrorCode from FATAL_CODES.
    """

    def __init__(self, code: ErrorCode, detail: str = "") -> None:
        self.code = code
        self.detail = detail
        super().__init__(f"[{code.value}] {detail}" if detail else f"[{code.value}]")


class MdgMissSignal(Exception):
    """Per-candidate miss signal — logged, non-fatal; drives the fill loop.

    Always carries a typed ErrorCode from MISS_CODES.
    """

    def __init__(self, code: ErrorCode, detail: str = "") -> None:
        self.code = code
        self.detail = detail
        super().__init__(f"[{code.value}] {detail}" if detail else f"[{code.value}]")
