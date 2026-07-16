"""T007+T008 — errors: test-first (TDD).

Validates:
- All codes from error-taxonomy.md are present in ErrorCode.
- Run-fatal codes are in FATAL_CODES and is_fatal() returns True.
- Miss-signal codes are in MISS_CODES / MissReason.
- judge_disagreement is a plain string code — NOT an exception subclass.
- MdgFatalError and MdgMissSignal are distinct exception hierarchies.
"""
import pytest
from mdg.errors import (
    ErrorCode,
    FATAL_CODES,
    MISS_CODES,
    MissReason,
    MdgFatalError,
    MdgMissSignal,
    is_fatal,
    is_miss,
)


# ---------------------------------------------------------------------------
# All error codes present
# ---------------------------------------------------------------------------

EXPECTED_FATAL = {
    "catalog_generation_failed",
    "coverage_contract_failed",
    "synthetic_identity_violation",
    "cross_object_identity_mismatch",
    "lineage_integrity_failed",
    "world_reference_failed",
    "invalid_genre_extension",
    "isrc_probe_gate_failed",
    "strategy_unavailable",
    "soundcharts_harvest_failed",
}

EXPECTED_MISS = {
    "song_not_found_in_sources",
    "isrc_not_in_soundcharts",
    "audio_unavailable",
    "language_mismatch",
    "wrong_cell",
    "cell_unfillable_from_source",
    "genre_unmappable_to_vocabulary",
}


class TestAllCodesPresent:
    def test_fatal_codes_all_present(self):
        for code in EXPECTED_FATAL:
            assert code in ErrorCode.__members__ or ErrorCode(code), f"Missing fatal code: {code}"

    def test_miss_codes_all_present(self):
        for code in EXPECTED_MISS:
            assert code in ErrorCode.__members__ or ErrorCode(code), f"Missing miss code: {code}"

    def test_judge_disagreement_present(self):
        """judge_disagreement must be a code value, not an exception."""
        assert ErrorCode.judge_disagreement is not None

    def test_error_code_is_enum(self):
        """ErrorCode must be an enum (or enum-like) with string values."""
        assert hasattr(ErrorCode, "__members__")


# ---------------------------------------------------------------------------
# Category queries
# ---------------------------------------------------------------------------

class TestCategories:
    def test_is_fatal_true_for_all_fatal_codes(self):
        for code in EXPECTED_FATAL:
            ec = ErrorCode(code)
            assert is_fatal(ec), f"is_fatal should be True for {code}"

    def test_is_fatal_false_for_miss_codes(self):
        for code in EXPECTED_MISS:
            ec = ErrorCode(code)
            assert not is_fatal(ec), f"is_fatal should be False for {code}"

    def test_is_miss_true_for_all_miss_codes(self):
        for code in EXPECTED_MISS:
            ec = ErrorCode(code)
            assert is_miss(ec), f"is_miss should be True for {code}"

    def test_is_miss_false_for_fatal_codes(self):
        for code in EXPECTED_FATAL:
            ec = ErrorCode(code)
            assert not is_miss(ec), f"is_miss should be False for {code}"

    def test_fatal_codes_set(self):
        for code in EXPECTED_FATAL:
            assert ErrorCode(code) in FATAL_CODES

    def test_miss_codes_set(self):
        for code in EXPECTED_MISS:
            assert ErrorCode(code) in MISS_CODES


# ---------------------------------------------------------------------------
# judge_disagreement — data, not an exception
# ---------------------------------------------------------------------------

class TestJudgeDisagreementIsNotException:
    def test_judge_disagreement_is_not_exception_subclass(self):
        """judge_disagreement must not be (or produce) an exception."""
        jd = ErrorCode.judge_disagreement
        # It must be an ErrorCode enum member (a value), not a class/exception
        assert not isinstance(jd, type), "judge_disagreement must not be a class"
        assert not issubclass(type(jd), BaseException), "judge_disagreement must not be an exception"

    def test_judge_disagreement_not_in_fatal(self):
        assert ErrorCode.judge_disagreement not in FATAL_CODES

    def test_judge_disagreement_not_in_miss(self):
        assert ErrorCode.judge_disagreement not in MISS_CODES


# ---------------------------------------------------------------------------
# Exception hierarchy
# ---------------------------------------------------------------------------

class TestExceptionHierarchy:
    def test_mdg_fatal_error_is_exception(self):
        assert issubclass(MdgFatalError, Exception)

    def test_mdg_miss_signal_is_exception(self):
        assert issubclass(MdgMissSignal, Exception)

    def test_fatal_not_subclass_of_miss(self):
        assert not issubclass(MdgFatalError, MdgMissSignal)

    def test_miss_not_subclass_of_fatal(self):
        assert not issubclass(MdgMissSignal, MdgFatalError)

    def test_fatal_error_carries_code(self):
        err = MdgFatalError(ErrorCode.catalog_generation_failed, "detail text")
        assert err.code == ErrorCode.catalog_generation_failed
        assert "detail text" in str(err)

    def test_miss_signal_carries_code(self):
        err = MdgMissSignal(ErrorCode.song_not_found_in_sources, "some detail")
        assert err.code == ErrorCode.song_not_found_in_sources

    def test_raise_fatal_error(self):
        with pytest.raises(MdgFatalError):
            raise MdgFatalError(ErrorCode.coverage_contract_failed, "halting")

    def test_raise_miss_signal(self):
        with pytest.raises(MdgMissSignal):
            raise MdgMissSignal(ErrorCode.language_mismatch, "expected ja got en")


# ---------------------------------------------------------------------------
# MissReason completeness
# ---------------------------------------------------------------------------

class TestMissReason:
    def test_miss_reason_contains_all_miss_codes(self):
        """MissReason must be usable as the LedgerEntry miss_reason enum."""
        mr_values = {m.value for m in MissReason}
        for code in EXPECTED_MISS:
            assert code in mr_values, f"MissReason missing: {code}"
