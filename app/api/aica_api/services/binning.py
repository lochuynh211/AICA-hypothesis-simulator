"""Boundary-binning service (T012) — surface → qualitative ordinal bands.

This is the single seam between any raw numeric measurements (e.g. future
Google Maps route data in M4) and the decision-making engine.  The engine
consumes ONLY ordinal bands; no raw number ever crosses this boundary.

For M1, scenario inputs are already banded, so ``bin_context`` acts as an
identity pass-through for band fields.  Raw fields
(``travel_time_sec``, ``remaining_to_destination_sec``,
``rest_spot_metres``) are converted using the same thresholds as the
prototype's ``surface_binning.mjs``.

Thresholds (qualitative, not committed engineering specs):
  travel_time_sec → continuous_driving_time:
      < 1 800 s  → "short"    (under ~30 min)
      < 5 400 s  → "moderate" (30–90 min)
        ≥ 5 400 s  → "long"

  rest_spot_metres → rest_spot_eta:
      None / absent → "none"
      ≤ 20 000 m    → "near"
        > 20 000 m    → "far"

``remaining_to_destination_sec`` is accepted and stripped (destination_eta
is not part of the M1 trigger context; inclusion is for forward-compat).

Design contract:
- Pure function of its input (no I/O, no side-effects).
- Output contains ONLY string values (ordinal band labels).
- Raw keys are never forwarded to the output.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Internal binning helpers (mirroring surface_binning.mjs)
# ---------------------------------------------------------------------------

_RAW_KEYS = frozenset(
    {"travel_time_sec", "remaining_to_destination_sec", "rest_spot_metres"}
)


def _bin_drive_time(sec: int | float | None) -> str:
    """Map elapsed driving seconds to a continuous_driving_time band."""
    if sec is None:
        return "short"
    if sec < 1800:
        return "short"
    if sec < 5400:
        return "moderate"
    return "long"


def _bin_rest_eta(metres: int | float | None) -> str:
    """Map rest-spot distance (metres) to a rest_spot_eta band."""
    if metres is None:
        return "none"
    if metres <= 20000:
        return "near"
    return "far"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# T011 / feature 009: build_feature_groups(raw_state) → {normalized, ordinal}
# ---------------------------------------------------------------------------
#
# Feature 009 (signal-tier redesign): drowsiness/fatigue are now Tier-3 SIMULATED
# signals exposed as raw numeric values directly in the adapter context
# (context["signals"]["simulated"]) — algorithms normalize them themselves
# (see data-model.md §5 Compact Hybrid: drowsiness = drowsiness/100).  They are
# therefore NO LONGER banded here; build_feature_groups keeps ONLY the
# route/context ordinal bands that survive the vehicle-model retirement:
# rest_spot_eta, continuous_driving_time, signal_duration.  The
# drowsiness_score/fatigue_score/attention_score/driving_anomaly_score/
# pedal_anomaly_score normalized derivations are removed along with the
# retired vehicle model and attention signal.
#
# bin_drowsiness_level / bin_fatigue_level remain as small public helpers for
# ONLY the legacy top-level TickState.drowsiness_level/fatigue_level fields
# (M1 display bands) — they are NOT part of the feature_groups output.
#
# Input keys (camelCase, simulator-internal numerics) still consumed here:
#   nextRestSpotMin (9999 = no rest ahead), continuousDrivingMin,
#   drowsinessAboveWeakTicks (consecutive ticks with drowsiness ≥ 20)
#
# Ordinal thresholds:
#   signal_duration:  transient=0, brief=1, sustained 2–9, persistent≥10 (AboveWeakTicks)
#   rest_spot_eta:    none=nextRestSpotMin≥9999, near≤20min, far>20min
#   continuous_driving_time: short<30min, moderate 30–90min, long≥90min


def bin_drowsiness_level(level: float) -> str:
    """Map a numeric drowsiness value to its legacy display band.

    NOT part of build_feature_groups' output (Tier-3 drowsiness is exposed as a
    raw number to algorithms) — used only for the legacy TickState.drowsiness_level
    field.
    """
    if level < 20.0:
        return "none"
    if level < 40.0:
        return "weak"
    if level < 60.0:
        return "moderate"
    if level < 80.0:
        return "strong"
    return "severe"


def bin_fatigue_level(level: float) -> str:
    """Map a numeric fatigue value to its legacy display band.

    NOT part of build_feature_groups' output (Tier-3 fatigue is exposed as a raw
    number to algorithms) — used only for the legacy TickState.fatigue_level field.
    """
    if level < 30.0:
        return "low"
    if level < 60.0:
        return "medium"
    return "high"


def _bin_signal_duration(above_weak_ticks: int) -> str:
    if above_weak_ticks <= 0:
        return "transient"
    if above_weak_ticks == 1:
        return "brief"
    if above_weak_ticks < 10:
        return "sustained"
    return "persistent"


def _bin_rest_spot_eta(next_rest_min: float) -> str:
    if next_rest_min >= 9999.0:
        return "none"
    if next_rest_min <= 20.0:
        return "near"
    return "far"


def _bin_continuous_driving(minutes: float) -> str:
    if minutes < 30.0:
        return "short"
    if minutes < 90.0:
        return "moderate"
    return "long"


def build_feature_groups(raw_state: dict) -> dict:
    """Derive {normalized, ordinal} feature groups from a tick's route/context state.

    This is the single seam between simulator-internal route/context numerics and
    the decision layer (Principle IV boundary-binning).  Feature 009: Tier-3
    simulated signals (drowsiness, fatigue, anomaly_rate) are NOT banded here —
    they are exposed as raw numbers directly in context["signals"]["simulated"];
    algorithms normalize them themselves.  Only the surviving route/context
    ordinal bands are produced.

    Args:
        raw_state: Dict of camelCase simulator-internal numeric fields produced
                   by the tick engine per tick.

    Returns:
        Dict with two sub-dicts:
        - ``normalized``: {feature_name: float in [0, 1]}  (currently empty —
          no surviving normalized quantity)
        - ``ordinal``:    {feature_name: str band label}
    """
    continuous_min = float(raw_state.get("continuousDrivingMin", 0.0))
    next_rest_min = float(raw_state.get("nextRestSpotMin", 9999.0))
    above_weak = int(raw_state.get("drowsinessAboveWeakTicks", 0))

    ordinal = {
        "signal_duration": _bin_signal_duration(above_weak),
        "rest_spot_eta": _bin_rest_spot_eta(next_rest_min),
        "continuous_driving_time": _bin_continuous_driving(continuous_min),
    }

    normalized: dict[str, float] = {}

    return {"normalized": normalized, "ordinal": ordinal}


def bin_context(ctx: dict) -> dict:
    """Convert a context dict to a fully-banded context.

    Band fields (strings) pass through unchanged.  Raw measurement fields
    are converted to ordinal bands and removed from the output.  The
    returned dict contains only string values.

    Args:
        ctx: Input context.  May contain a mix of band fields and raw
             measurement fields (``travel_time_sec``,
             ``remaining_to_destination_sec``, ``rest_spot_metres``).

    Returns:
        A new dict with only ordinal-band string values.  Raw keys are
        absent from the output.
    """
    result: dict[str, str] = {}

    # Pass through all non-raw (already-banded) fields.
    for key, value in ctx.items():
        if key not in _RAW_KEYS:
            result[key] = value

    # Convert raw fields when present.
    if "travel_time_sec" in ctx:
        result["continuous_driving_time"] = _bin_drive_time(ctx["travel_time_sec"])

    # remaining_to_destination_sec → destination_eta (forward-compat; not
    # part of M1 decision context — drop after binning if caller wants).
    if "remaining_to_destination_sec" in ctx:
        sec = ctx["remaining_to_destination_sec"]
        if sec is None:
            result["destination_eta"] = "medium"
        elif sec < 1200:
            result["destination_eta"] = "close"
        elif sec < 3600:
            result["destination_eta"] = "medium"
        else:
            result["destination_eta"] = "far"

    # rest_spot_metres → rest_spot_eta; also handle absent key as "none".
    metres = ctx.get("rest_spot_metres", None)
    if "rest_spot_metres" in ctx or "rest_spot_eta" not in result:
        # Only add rest_spot_eta from raw if a band wasn't already present.
        if "rest_spot_metres" in ctx and "rest_spot_eta" not in ctx:
            result["rest_spot_eta"] = _bin_rest_eta(metres)
        elif "rest_spot_metres" not in ctx and "rest_spot_eta" not in result:
            # Neither raw nor banded rest_spot_eta given; default to "none".
            result["rest_spot_eta"] = "none"

    return result
