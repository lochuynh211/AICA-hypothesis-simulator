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
        if sec is None or sec < 1200:
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
