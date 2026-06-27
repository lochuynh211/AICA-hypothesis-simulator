"""TDD binning tests (T012) — written BEFORE implementation; confirm RED, implement to GREEN.

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

from aica_api.services.binning import bin_context


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
    raw = json.loads(fixture_path.read_text())
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
    raw = json.loads(fixture_path.read_text())
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
