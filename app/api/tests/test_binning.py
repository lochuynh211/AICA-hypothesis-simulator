"""TDD binning tests (T012 + T011) — written BEFORE implementation; confirm RED, implement to GREEN.

binning.py maps a context dict through the qualitative boundary:
- Already-banded context: identity pass-through (band fields preserved unchanged).
- Raw form {travel_time_sec, remaining_to_destination_sec, rest_spot_metres}:
  converted to ordinal bands; NEVER emits raw numbers into the decision context.

Thresholds mirror surface_binning.mjs (the prototype reference):
  travel_time_sec → continuous_driving_time:  <1800s → short, <5400s → moderate, else long
  rest_spot_metres → rest_spot_eta:            None → none, ≤20000m → near, else far
"""

import json
import pathlib

import pytest

from aica_api.services.binning import bin_context, build_feature_groups


# ─── Fixture validation ────────────────────────────────────────────────────────


def test_package_fixture_parses():
    """The package fixture must parse cleanly under the Unit-2 PackageManifest model."""
    from aica_api.models.package import PackageManifest

    fixture_path = (
        pathlib.Path(__file__).parents[3]
        / "packages"
        / "rest_rule_based_v0_1"
        / "package.json"
    )
    raw = json.loads(fixture_path.read_text(encoding="utf-8"))
    manifest = PackageManifest.model_validate(raw)
    assert manifest.id == "rest_rule_based_v0_1"
    assert manifest.algorithm.type == "declarative_rule"
    assert len(manifest.features) == 5
    assert len(manifest.hyperparameters) == 6


def test_scenario_fixture_parses():
    """The scenario fixture must parse cleanly under the Unit-2 ScenarioDef model."""
    from aica_api.models.scenario import ScenarioDef

    fixture_path = (
        pathlib.Path(__file__).parents[3]
        / "scenarios"
        / "uc01_fatigue_friend_drive_v0_1.json"
    )
    raw = json.loads(fixture_path.read_text(encoding="utf-8"))
    # Strip the _comment key (not part of the model)
    raw.pop("_comment", None)
    scenario = ScenarioDef.model_validate(raw)
    assert scenario.id == "uc01_fatigue_friend_drive_v0_1"
    assert scenario.type == "uc01_fatigue"
    rest_count = sum(1 for s in scenario.route_intent.segments if s.is_rest_facility)
    assert rest_count == 1
    assert scenario.total_duration_seconds == 7200
    assert scenario.tick_seconds == 60


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


# ─── T011: build_feature_groups(raw_state) ────────────────────────────────────
#
# raw_state keys (camelCase, simulator-internal numerics):
#   drowsinessLevel, fatigueLevel, attentionLevel, speedKph,
#   steeringInstabilityLevel, pedalAbnormalityLevel, laneDepartureCount,
#   adasWarningCount, nextRestSpotKm, routeFraction, continuousDrivingMin,
#   isNight, weatherRiskLevel, segmentType, drowsinessAboveWeakTicks
#
# Returns {normalized: {key: 0..1}, ordinal: {key: "band_string"}}


def _raw(
    *,
    drowsinessLevel: float = 0.0,
    fatigueLevel: float = 0.0,
    attentionLevel: float = 100.0,
    speedKph: float = 80.0,
    steeringInstabilityLevel: float = 5.0,
    pedalAbnormalityLevel: float = 3.0,
    laneDepartureCount: int = 0,
    adasWarningCount: int = 0,
    nextRestSpotMin: float = 9999.0,
    routeFraction: float = 0.0,
    continuousDrivingMin: float = 0.0,
    isNight: bool = False,
    weatherRiskLevel: float = 0.0,
    segmentType: str = "normal_road",
    drowsinessAboveWeakTicks: int = 0,
) -> dict:
    return {
        "drowsinessLevel": drowsinessLevel,
        "fatigueLevel": fatigueLevel,
        "attentionLevel": attentionLevel,
        "speedKph": speedKph,
        "steeringInstabilityLevel": steeringInstabilityLevel,
        "pedalAbnormalityLevel": pedalAbnormalityLevel,
        "laneDepartureCount": laneDepartureCount,
        "adasWarningCount": adasWarningCount,
        "nextRestSpotMin": nextRestSpotMin,
        "routeFraction": routeFraction,
        "continuousDrivingMin": continuousDrivingMin,
        "isNight": isNight,
        "weatherRiskLevel": weatherRiskLevel,
        "segmentType": segmentType,
        "drowsinessAboveWeakTicks": drowsinessAboveWeakTicks,
    }


# ── Return shape ──────────────────────────────────────────────────────────────

def test_build_feature_groups_returns_normalized_and_ordinal():
    fg = build_feature_groups(_raw())
    assert "normalized" in fg
    assert "ordinal" in fg


def test_normalized_values_are_floats_in_0_1():
    fg = build_feature_groups(_raw(drowsinessLevel=50.0, fatigueLevel=30.0))
    for key, val in fg["normalized"].items():
        assert isinstance(val, float), f"{key} not float"
        assert 0.0 <= val <= 1.0, f"{key}={val} out of [0,1]"


def test_ordinal_values_are_strings():
    fg = build_feature_groups(_raw())
    for key, val in fg["ordinal"].items():
        assert isinstance(val, str), f"{key} not string"


# ── Ordinal: drowsiness_level ─────────────────────────────────────────────────

def test_ordinal_drowsiness_none():
    fg = build_feature_groups(_raw(drowsinessLevel=0.0))
    assert fg["ordinal"]["drowsiness_level"] == "none"


def test_ordinal_drowsiness_none_boundary_below_20():
    fg = build_feature_groups(_raw(drowsinessLevel=19.9))
    assert fg["ordinal"]["drowsiness_level"] == "none"


def test_ordinal_drowsiness_weak():
    fg = build_feature_groups(_raw(drowsinessLevel=20.0))
    assert fg["ordinal"]["drowsiness_level"] == "weak"


def test_ordinal_drowsiness_moderate():
    fg = build_feature_groups(_raw(drowsinessLevel=40.0))
    assert fg["ordinal"]["drowsiness_level"] == "moderate"


def test_ordinal_drowsiness_strong():
    fg = build_feature_groups(_raw(drowsinessLevel=60.0))
    assert fg["ordinal"]["drowsiness_level"] == "strong"


def test_ordinal_drowsiness_severe():
    fg = build_feature_groups(_raw(drowsinessLevel=80.0))
    assert fg["ordinal"]["drowsiness_level"] == "severe"


def test_ordinal_drowsiness_severe_at_100():
    fg = build_feature_groups(_raw(drowsinessLevel=100.0))
    assert fg["ordinal"]["drowsiness_level"] == "severe"


# ── Ordinal: fatigue_level ────────────────────────────────────────────────────

def test_ordinal_fatigue_low():
    fg = build_feature_groups(_raw(fatigueLevel=0.0))
    assert fg["ordinal"]["fatigue_level"] == "low"


def test_ordinal_fatigue_medium():
    fg = build_feature_groups(_raw(fatigueLevel=30.0))
    assert fg["ordinal"]["fatigue_level"] == "medium"


def test_ordinal_fatigue_high():
    fg = build_feature_groups(_raw(fatigueLevel=60.0))
    assert fg["ordinal"]["fatigue_level"] == "high"


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


# ── Ordinal: rest_spot_eta (from nextRestSpotKm) ──────────────────────────────

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


# ── Normalized: drowsiness_score ──────────────────────────────────────────────

def test_normalized_drowsiness_score():
    fg = build_feature_groups(_raw(drowsinessLevel=50.0))
    assert fg["normalized"]["drowsiness_score"] == pytest.approx(0.5)


def test_normalized_fatigue_score():
    fg = build_feature_groups(_raw(fatigueLevel=75.0))
    assert fg["normalized"]["fatigue_score"] == pytest.approx(0.75)


def test_normalized_attention_score():
    fg = build_feature_groups(_raw(attentionLevel=80.0))
    assert fg["normalized"]["attention_score"] == pytest.approx(0.80)


def test_normalized_driving_anomaly_score_clamped():
    """driving_anomaly_score is clamped to [0, 1]."""
    fg = build_feature_groups(_raw(steeringInstabilityLevel=200.0))
    assert fg["normalized"]["driving_anomaly_score"] == pytest.approx(1.0)


# ── Determinism ───────────────────────────────────────────────────────────────

def test_build_feature_groups_deterministic():
    raw = _raw(drowsinessLevel=35.0, fatigueLevel=45.0, drowsinessAboveWeakTicks=5)
    assert build_feature_groups(raw) == build_feature_groups(raw)
