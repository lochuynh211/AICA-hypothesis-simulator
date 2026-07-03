"""Binning tests (T012 + T011; feature 009 signal-tier redesign).

binning.py maps a context dict through the qualitative boundary:
- Already-banded context: identity pass-through (band fields preserved unchanged).
- Raw form {travel_time_sec, remaining_to_destination_sec, rest_spot_metres}:
  converted to ordinal bands; NEVER emits raw numbers into the decision context.

Thresholds mirror surface_binning.mjs (the prototype reference):
  travel_time_sec → continuous_driving_time:  <1800s → short, <5400s → moderate, else long
  rest_spot_metres → rest_spot_eta:            None → none, ≤20000m → near, else far

Feature 009: build_feature_groups keeps ONLY the route/context ordinal bands that
survive the vehicle-model/attention retirement — rest_spot_eta,
continuous_driving_time, signal_duration.  drowsiness_level/fatigue_level and all
normalized *_score derivations (drowsiness_score, fatigue_score, attention_score,
driving_anomaly_score, pedal_anomaly_score) are removed: Tier-3 drowsiness/fatigue
are now exposed as raw numbers directly in context["signals"]["simulated"] and are
no longer banded/normalized here.
"""

import pytest

from aica_api.services.binning import bin_context, bin_drowsiness_level, bin_fatigue_level, build_feature_groups


# ─── Identity pass-through (already-banded context) ───────────────────────────


def test_banded_context_passes_through_unchanged():
    """Already-banded context fields are returned unchanged."""
    ctx = {
        "drowsiness_level": "moderate",
        "fatigue_level": "medium",
        "signal_duration": "sustained",
        "continuous_driving_time": "long",
        "rest_spot_eta": "near",
    }
    result = bin_context(ctx)
    assert result == ctx


def test_banded_context_preserves_all_fields():
    """All fields in a banded context are present in the output."""
    ctx = {
        "drowsiness_level": "none",
        "fatigue_level": "low",
        "signal_duration": "transient",
        "continuous_driving_time": "short",
        "rest_spot_eta": "none",
    }
    result = bin_context(ctx)
    for key in ctx:
        assert key in result


def test_banded_context_passes_through_severe():
    ctx = {
        "drowsiness_level": "severe",
        "fatigue_level": "high",
        "signal_duration": "persistent",
        "continuous_driving_time": "long",
        "rest_spot_eta": "far",
    }
    result = bin_context(ctx)
    assert result == ctx


# ─── Raw → band conversion ────────────────────────────────────────────────────


def test_raw_travel_time_short():
    """travel_time_sec < 1800 → continuous_driving_time = 'short'."""
    ctx = {"travel_time_sec": 900}
    result = bin_context(ctx)
    assert result["continuous_driving_time"] == "short"
    assert "travel_time_sec" not in result


def test_raw_travel_time_moderate():
    """1800 ≤ travel_time_sec < 5400 → continuous_driving_time = 'moderate'."""
    ctx = {"travel_time_sec": 3000}
    result = bin_context(ctx)
    assert result["continuous_driving_time"] == "moderate"
    assert "travel_time_sec" not in result


def test_raw_travel_time_long():
    """travel_time_sec ≥ 5400 → continuous_driving_time = 'long'."""
    ctx = {"travel_time_sec": 6000}
    result = bin_context(ctx)
    assert result["continuous_driving_time"] == "long"
    assert "travel_time_sec" not in result


def test_raw_travel_time_boundary_1800():
    """Boundary: exactly 1800 → 'moderate' (first value in [1800, 5400))."""
    ctx = {"travel_time_sec": 1800}
    result = bin_context(ctx)
    assert result["continuous_driving_time"] == "moderate"


def test_raw_travel_time_boundary_5400():
    """Boundary: exactly 5400 → 'long'."""
    ctx = {"travel_time_sec": 5400}
    result = bin_context(ctx)
    assert result["continuous_driving_time"] == "long"


def test_raw_rest_spot_none():
    """rest_spot_metres=None → rest_spot_eta = 'none'."""
    ctx = {"rest_spot_metres": None}
    result = bin_context(ctx)
    assert result["rest_spot_eta"] == "none"
    assert "rest_spot_metres" not in result


def test_raw_rest_spot_near():
    """rest_spot_metres ≤ 20000 → rest_spot_eta = 'near'."""
    ctx = {"rest_spot_metres": 15000}
    result = bin_context(ctx)
    assert result["rest_spot_eta"] == "near"


def test_raw_rest_spot_near_boundary():
    """Boundary: exactly 20000 → 'near'."""
    ctx = {"rest_spot_metres": 20000}
    result = bin_context(ctx)
    assert result["rest_spot_eta"] == "near"


def test_raw_rest_spot_far():
    """rest_spot_metres > 20000 → rest_spot_eta = 'far'."""
    ctx = {"rest_spot_metres": 25000}
    result = bin_context(ctx)
    assert result["rest_spot_eta"] == "far"


def test_raw_rest_spot_missing_key():
    """Absent rest_spot_metres (key not present) → rest_spot_eta = 'none'."""
    ctx = {}
    result = bin_context(ctx)
    assert result["rest_spot_eta"] == "none"


# ─── No raw numbers leak into output ──────────────────────────────────────────


def test_no_numbers_in_output_from_raw():
    """Output from a raw context must contain NO numeric values — only strings."""
    ctx = {
        "travel_time_sec": 4000,
        "remaining_to_destination_sec": 2000,
        "rest_spot_metres": 10000,
    }
    result = bin_context(ctx)
    for value in result.values():
        assert isinstance(value, str), f"Expected string, got {type(value)}: {value!r}"


def test_no_raw_keys_in_output():
    """Raw measurement keys must not appear in the output dict."""
    ctx = {
        "travel_time_sec": 3000,
        "remaining_to_destination_sec": 1500,
        "rest_spot_metres": 5000,
    }
    raw_keys = {"travel_time_sec", "remaining_to_destination_sec", "rest_spot_metres"}
    result = bin_context(ctx)
    assert not raw_keys.intersection(result.keys())


# ─── Mixed context: raw fields coexist with band fields ───────────────────────


def test_mixed_raw_and_banded_fields():
    """A context with both raw fields and band fields: raw converted, bands preserved."""
    ctx = {
        "drowsiness_level": "weak",
        "fatigue_level": "low",
        "signal_duration": "brief",
        "travel_time_sec": 2500,
        "rest_spot_metres": 8000,
    }
    result = bin_context(ctx)
    # Band fields pass through
    assert result["drowsiness_level"] == "weak"
    assert result["fatigue_level"] == "low"
    assert result["signal_duration"] == "brief"
    # Raw fields converted
    assert result["continuous_driving_time"] == "moderate"
    assert result["rest_spot_eta"] == "near"
    # No raw keys remain
    assert "travel_time_sec" not in result
    assert "rest_spot_metres" not in result
    # No numbers
    for v in result.values():
        assert isinstance(v, str)


# ─── destination_eta binning ──────────────────────────────────────────────────


def test_dest_eta_null_returns_medium():
    """remaining_to_destination_sec=None → destination_eta='medium' (prototype fidelity).

    Mirrors surface_binning.mjs binDestEta(null) → 'medium'.
    """
    ctx = {"remaining_to_destination_sec": None}
    result = bin_context(ctx)
    assert result["destination_eta"] == "medium"


def test_dest_eta_close():
    """remaining_to_destination_sec < 1200 → destination_eta='close'."""
    ctx = {"remaining_to_destination_sec": 600}
    result = bin_context(ctx)
    assert result["destination_eta"] == "close"


def test_dest_eta_medium():
    """1200 ≤ remaining_to_destination_sec < 3600 → destination_eta='medium'."""
    ctx = {"remaining_to_destination_sec": 2000}
    result = bin_context(ctx)
    assert result["destination_eta"] == "medium"


def test_dest_eta_far():
    """remaining_to_destination_sec ≥ 3600 → destination_eta='far'."""
    ctx = {"remaining_to_destination_sec": 5000}
    result = bin_context(ctx)
    assert result["destination_eta"] == "far"


# ─── Determinism ──────────────────────────────────────────────────────────────


def test_binning_determinism():
    """Same input always produces the same output (pure function)."""
    ctx = {"travel_time_sec": 3600, "rest_spot_metres": 12000}
    assert bin_context(ctx) == bin_context(ctx)


# ─── build_feature_groups(raw_state) — feature 009 reduced shape ─────────────
#
# Input keys consumed (camelCase, simulator-internal numerics):
#   nextRestSpotMin, continuousDrivingMin, drowsinessAboveWeakTicks
#
# Returns {normalized: {} (empty — nothing survives), ordinal: {rest_spot_eta,
# continuous_driving_time, signal_duration}}


def _raw(
    *,
    nextRestSpotMin: float = 9999.0,
    continuousDrivingMin: float = 0.0,
    drowsinessAboveWeakTicks: int = 0,
) -> dict:
    return {
        "nextRestSpotMin": nextRestSpotMin,
        "continuousDrivingMin": continuousDrivingMin,
        "drowsinessAboveWeakTicks": drowsinessAboveWeakTicks,
    }


# ── Return shape ──────────────────────────────────────────────────────────────

def test_build_feature_groups_returns_normalized_and_ordinal():
    fg = build_feature_groups(_raw())
    assert "normalized" in fg
    assert "ordinal" in fg


def test_normalized_is_empty():
    """Feature 009: no surviving normalized quantity — drowsiness/fatigue/anomaly
    are exposed raw via context["signals"]["simulated"], not normalized here."""
    fg = build_feature_groups(_raw())
    assert fg["normalized"] == {}


def test_ordinal_values_are_strings():
    fg = build_feature_groups(_raw())
    for key, val in fg["ordinal"].items():
        assert isinstance(val, str), f"{key} not string"


def test_ordinal_keys_are_exactly_the_surviving_set():
    """ONLY rest_spot_eta, continuous_driving_time, signal_duration survive."""
    fg = build_feature_groups(_raw())
    assert set(fg["ordinal"].keys()) == {
        "rest_spot_eta",
        "continuous_driving_time",
        "signal_duration",
    }


def test_no_drowsiness_or_fatigue_or_score_keys_in_ordinal_or_normalized():
    """Removed keys must never reappear (drowsiness_level, fatigue_level, and
    all *_score normalized derivations)."""
    fg = build_feature_groups(_raw())
    removed = {
        "drowsiness_level",
        "fatigue_level",
        "drowsiness_score",
        "fatigue_score",
        "attention_score",
        "driving_anomaly_score",
        "pedal_anomaly_score",
    }
    all_keys = set(fg["ordinal"].keys()) | set(fg["normalized"].keys())
    assert not removed & all_keys


# ── Ordinal: signal_duration (from drowsinessAboveWeakTicks) ─────────────────

def test_ordinal_signal_duration_transient():
    fg = build_feature_groups(_raw(drowsinessAboveWeakTicks=0))
    assert fg["ordinal"]["signal_duration"] == "transient"


def test_ordinal_signal_duration_brief():
    fg = build_feature_groups(_raw(drowsinessAboveWeakTicks=1))
    assert fg["ordinal"]["signal_duration"] == "brief"


def test_ordinal_signal_duration_sustained():
    fg = build_feature_groups(_raw(drowsinessAboveWeakTicks=2))
    assert fg["ordinal"]["signal_duration"] == "sustained"


def test_ordinal_signal_duration_sustained_at_9():
    fg = build_feature_groups(_raw(drowsinessAboveWeakTicks=9))
    assert fg["ordinal"]["signal_duration"] == "sustained"


def test_ordinal_signal_duration_persistent():
    fg = build_feature_groups(_raw(drowsinessAboveWeakTicks=10))
    assert fg["ordinal"]["signal_duration"] == "persistent"


# ── Ordinal: rest_spot_eta (from nextRestSpotMin) ──────────────────────────────

def test_ordinal_rest_spot_eta_none_when_no_rest():
    """nextRestSpotMin >= 9999 (sentinel) means no rest spot ahead."""
    fg = build_feature_groups(_raw(nextRestSpotMin=9999.0))
    assert fg["ordinal"]["rest_spot_eta"] == "none"


def test_ordinal_rest_spot_eta_near():
    """nextRestSpotMin = 10.0 min is within the near threshold."""
    fg = build_feature_groups(_raw(nextRestSpotMin=10.0))
    assert fg["ordinal"]["rest_spot_eta"] == "near"


def test_ordinal_rest_spot_eta_near_at_20():
    """Boundary: exactly 20 min -> near (inclusive)."""
    fg = build_feature_groups(_raw(nextRestSpotMin=20.0))
    assert fg["ordinal"]["rest_spot_eta"] == "near"


def test_ordinal_rest_spot_eta_far():
    """nextRestSpotMin just over 20 min -> far."""
    fg = build_feature_groups(_raw(nextRestSpotMin=20.1))
    assert fg["ordinal"]["rest_spot_eta"] == "far"


# ── Ordinal: continuous_driving_time ──────────────────────────────────────────

def test_ordinal_continuous_driving_short():
    fg = build_feature_groups(_raw(continuousDrivingMin=0.0))
    assert fg["ordinal"]["continuous_driving_time"] == "short"


def test_ordinal_continuous_driving_moderate():
    fg = build_feature_groups(_raw(continuousDrivingMin=30.0))
    assert fg["ordinal"]["continuous_driving_time"] == "moderate"


def test_ordinal_continuous_driving_long():
    fg = build_feature_groups(_raw(continuousDrivingMin=90.0))
    assert fg["ordinal"]["continuous_driving_time"] == "long"


# ── Determinism ───────────────────────────────────────────────────────────────

def test_build_feature_groups_deterministic():
    raw = _raw(continuousDrivingMin=45.0, drowsinessAboveWeakTicks=5)
    assert build_feature_groups(raw) == build_feature_groups(raw)


# ── bin_drowsiness_level / bin_fatigue_level (legacy display bands) ──────────
# NOT part of build_feature_groups' output — used only for the legacy
# TickState.drowsiness_level/fatigue_level fields.


def test_bin_drowsiness_level_bands():
    assert bin_drowsiness_level(0.0) == "none"
    assert bin_drowsiness_level(19.9) == "none"
    assert bin_drowsiness_level(20.0) == "weak"
    assert bin_drowsiness_level(40.0) == "moderate"
    assert bin_drowsiness_level(60.0) == "strong"
    assert bin_drowsiness_level(80.0) == "severe"
    assert bin_drowsiness_level(100.0) == "severe"


def test_bin_fatigue_level_bands():
    assert bin_fatigue_level(0.0) == "low"
    assert bin_fatigue_level(30.0) == "medium"
    assert bin_fatigue_level(60.0) == "high"
