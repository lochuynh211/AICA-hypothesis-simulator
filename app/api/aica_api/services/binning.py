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
# T011: build_feature_groups(raw_state) → {normalized, ordinal}
# ---------------------------------------------------------------------------
#
# raw_state keys (camelCase, simulator-internal numerics):
#   drowsinessLevel, fatigueLevel, attentionLevel, speedKph,
#   steeringInstabilityLevel, pedalAbnormalityLevel, laneDepartureCount,
#   adasWarningCount, nextRestSpotMin (9999 = no rest ahead), routeFraction,
#   continuousDrivingMin, isNight, weatherRiskLevel, segmentType,
#   drowsinessAboveWeakTicks (consecutive ticks with drowsiness ≥ 20)
#
# Ordinal thresholds:
#   drowsiness_level: none<20, weak 20–40, moderate 40–60, strong 60–80, severe≥80
#   fatigue_level:    low<30, medium 30–60, high≥60
#   signal_duration:  transient=0, brief=1, sustained 2–9, persistent≥10 (AboveWeakTicks)
#   rest_spot_eta:    none=nextRestSpotMin≥9999, near≤20min, far>20min
#   continuous_driving_time: short<30min, moderate 30–90min, long≥90min


def _bin_drowsiness(level: float) -> str:
    if level < 20.0:
        return "none"
    if level < 40.0:
        return "weak"
    if level < 60.0:
        return "moderate"
    if level < 80.0:
        return "strong"
    return "severe"


def _bin_fatigue(level: float) -> str:
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
    """Derive {normalized, ordinal} feature groups from a tick raw_state dict.

    This is the single seam between simulator-internal numeric state and the
    decision layer.  Algorithms consume feature_groups; raw_state is
    available for the evidence trace and for packages' own scoring formulas.

    Args:
        raw_state: Dict of camelCase simulator-internal numeric fields produced
                   by the tick engine per tick.

    Returns:
        Dict with two sub-dicts:
        - ``normalized``: {feature_name: float in [0, 1]}
        - ``ordinal``:    {feature_name: str band label}
    """
    drowsiness = float(raw_state.get("drowsinessLevel", 0.0))
    fatigue = float(raw_state.get("fatigueLevel", 0.0))
    attention = float(raw_state.get("attentionLevel", 100.0))
    steering = float(raw_state.get("steeringInstabilityLevel", 0.0))
    pedal = float(raw_state.get("pedalAbnormalityLevel", 0.0))
    continuous_min = float(raw_state.get("continuousDrivingMin", 0.0))
    next_rest_min = float(raw_state.get("nextRestSpotMin", 9999.0))
    above_weak = int(raw_state.get("drowsinessAboveWeakTicks", 0))

    ordinal = {
        "drowsiness_level": _bin_drowsiness(drowsiness),
        "fatigue_level": _bin_fatigue(fatigue),
        "signal_duration": _bin_signal_duration(above_weak),
        "rest_spot_eta": _bin_rest_spot_eta(next_rest_min),
        "continuous_driving_time": _bin_continuous_driving(continuous_min),
    }

    normalized = {
        "drowsiness_score": min(1.0, max(0.0, drowsiness / 100.0)),
        "fatigue_score": min(1.0, max(0.0, fatigue / 100.0)),
        "attention_score": min(1.0, max(0.0, attention / 100.0)),
        "driving_anomaly_score": min(1.0, max(0.0, steering / 100.0)),
        "pedal_anomaly_score": min(1.0, max(0.0, pedal / 100.0)),
    }

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
