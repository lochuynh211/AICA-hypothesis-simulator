"""Tokyo -> Nikko forecast-spacing calibration harness.

A duplicate of `scripts/calibrate_forecast_demo.py` (see that file's module
docstring for the full content-relief-modeled Combined path rationale) repointed
at the `tokyo_nikko` maps route to verify the NEW
`forecast_rest_min_gap_after_monotony_min` hyperparameter.

Only the constants at the top differ from the base harness:
  * `_ROUTE_PRESET_ID = "tokyo_nikko"` — the route the UC-05-01 master preset was
    switched to, where the forecast fired only ~9 min after the first monotony
    trigger (monotony @~20 min, forecast @~29 min).
  * The two passes are NOT "forecast on vs off". Both keep the forecast ON
    (package default `threshold_forecast_rest=65.0`); they differ ONLY in the new
    spacing hyperparameter:
      - GAP_OFF: `forecast_rest_min_gap_after_monotony_min=0.0`  → baseline, the
        ~29 min early fire the user observed.
      - GAP_ON:  `forecast_rest_min_gap_after_monotony_min=20.0` → the manifest
        default; the forecast fire should be DEFERRED to >= (monotony_anchor +
        20 min), i.e. land ~40 min instead of ~29 min, and must NOT be swallowed.

Run:  PYTHONPATH=app/api python scripts/calibrate_forecast_nikko.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, TypedDict

_REPO_ROOT = Path(__file__).resolve().parent.parent
_API_ROOT = _REPO_ROOT / "app" / "api"
if str(_API_ROOT) not in sys.path:
    sys.path.insert(0, str(_API_ROOT))

from aica_api.config import settings  # noqa: E402
from aica_api.models.merged_run import MergedQuickviewBody  # noqa: E402
from aica_api.routers.route_presets import load_route_preset  # noqa: E402
from aica_api.services.merged_quickview import _project_fire  # noqa: E402
from aica_api.services.preview import iter_preview_ticks  # noqa: E402

_PACKAGE_ID = "nri_fatigue_score_v1"
_SCENARIO_ID = "uc05_01_forecast_jam_v0_1"
_ROUTE_PRESET_ID = "tokyo_nikko"
_RUN_SEED = 42

_NO_REST_SENTINEL = 9999.0

# Both passes keep the forecast ON; they differ ONLY in the spacing gap. The
# gap is now applied by the control/simulation engine (run_manager.tick /
# iter_preview_ticks), NOT the NRI algorithm — it gates any surfacing
# rest_required fire (forecast REST_FORECAST_FIRE + ordinary REST_FIRE) within
# `rest_min_gap_after_monotony_min` of the last SURFACED monotony proposal.
GAP_OFF_OVERRIDES = {
    "threshold_forecast_rest": 65.0,
    "rest_spot_eta_filter_min": 30.0,
    "rest_min_gap_after_monotony_min": 0.0,
}
GAP_ON_OVERRIDES = {
    "threshold_forecast_rest": 65.0,
    "rest_spot_eta_filter_min": 30.0,
    "rest_min_gap_after_monotony_min": 20.0,
}

_TICK_SECONDS = 20
_CONTEXT_OVERRIDES = {"child_passenger": False, "is_night": False}
_INITIAL_STATE = {"drowsiness_level": 90, "fatigue_level": 55}

_SERVICE_PACKAGE_ID = "aica_transparent_service_selector_v1"
_CONTENT_PACKAGE_ID = "aica_transparent_content_selector_v1"
_RUN_SEED_PROPOSAL = "42"
_PROPOSAL_PRESET_PATH = (
    _REPO_ROOT / "proposal_contracts" / "presets" / "preset-uc05-01-forecast-c.json"
)


class TickRow(TypedDict):
    tick_index: int
    elapsed_min: float
    distance_km: float
    rest_state: str | None
    fire_reason: str | None
    proposed_spot_eta_min: float | None


def _load_route() -> tuple[dict[str, Any], dict[str, Any]]:
    envelope = load_route_preset(_ROUTE_PRESET_ID)
    alternative = envelope["alternatives"][0]
    return alternative["route_facts"], alternative["display"]


def _load_world() -> dict[str, Any]:
    return json.loads(_PROPOSAL_PRESET_PATH.read_text(encoding="utf-8"))["world"]


def _discover_content_service(
    hyperparameter_overrides: dict[str, Any],
    route_facts: dict[str, Any],
    display_route: dict[str, Any],
) -> str | None:
    body = MergedQuickviewBody(
        package_id=_PACKAGE_ID,
        scenario_id=_SCENARIO_ID,
        run_seed=_RUN_SEED,
        route_facts=route_facts,
        route_source="maps",
        hyperparameter_overrides=hyperparameter_overrides,
        context_overrides=_CONTEXT_OVERRIDES,
        initial_state=_INITIAL_STATE,
        tick_seconds=_TICK_SECONDS,
        world=_load_world(),
        service_package_id=_SERVICE_PACKAGE_ID,
        content_package_id=_CONTENT_PACKAGE_ID,
        run_seed_proposal=_RUN_SEED_PROPOSAL,
    )
    discovery = iter_preview_ticks(
        package_id=_PACKAGE_ID,
        scenario_id=_SCENARIO_ID,
        hyperparameter_overrides=hyperparameter_overrides,
        run_seed=_RUN_SEED,
        rest_option_id=None,
        packages_dir=settings.packages_dir,
        scenarios_dir=settings.scenarios_dir,
        route_source="maps",
        route_facts=route_facts,
        display_route=display_route,
        presets={"tick_seconds": _TICK_SECONDS},
        context_overrides=_CONTEXT_OVERRIDES,
        initial_state=_INITIAL_STATE,
    )
    try:
        try:
            first_ev = next(discovery)
        except StopIteration:
            first_ev = None
        if first_ev is not None:
            proposal, _err = _project_fire(first_ev, body)
            if proposal is not None:
                return (proposal.get("journey_state") or {}).get("active_service_id")
    finally:
        discovery.close()
    return None


def run_nikko(hyperparameter_overrides: dict[str, Any]) -> list[TickRow]:
    route_facts, display_route = _load_route()
    content_service_id = _discover_content_service(
        hyperparameter_overrides, route_facts, display_route
    )

    rows: list[TickRow] = []
    events = iter_preview_ticks(
        package_id=_PACKAGE_ID,
        scenario_id=_SCENARIO_ID,
        hyperparameter_overrides=hyperparameter_overrides,
        run_seed=_RUN_SEED,
        rest_option_id=None,
        packages_dir=settings.packages_dir,
        scenarios_dir=settings.scenarios_dir,
        route_source="maps",
        route_facts=route_facts,
        display_route=display_route,
        presets={"tick_seconds": _TICK_SECONDS},
        context_overrides=_CONTEXT_OVERRIDES,
        initial_state=_INITIAL_STATE,
        content_service_id=content_service_id,
    )
    for ev in events:
        signals = ev.tick_state.signals or {}
        dynamic = signals.get("dynamic", {}) or {}
        raw_eta = dynamic.get("nextRestSpotMin")
        proposed_spot_eta_min = (
            None if raw_eta is None or float(raw_eta) >= _NO_REST_SENTINEL else float(raw_eta)
        )
        rows.append(
            TickRow(
                tick_index=ev.tick_index,
                elapsed_min=float(ev.elapsed_min),
                distance_km=float(ev.tick_state.distance_km or 0.0),
                rest_state=ev.decision.states.get("rest"),
                fire_reason=ev.decision.fire_control.reason,
                proposed_spot_eta_min=proposed_spot_eta_min,
            )
        )
    return rows


def _format_eta(eta: float | None) -> str:
    return "-" if eta is None else f"{eta:.1f}"


def _print_table(label: str, rows: list[TickRow]) -> None:
    print(f"\n--- {label} ---")
    header = f"{'tick':>5} {'min':>8} {'km':>8}  {'rest_state':<20} {'spot_eta':>9}  fire_reason"
    print(header)
    print("-" * len(header))
    if not rows:
        print("(no fire episodes)")
        return
    for r in rows:
        print(
            f"{r['tick_index']:>5} {r['elapsed_min']:>8.1f} {r['distance_km']:>8.1f}  "
            f"{str(r['rest_state']):<20} {_format_eta(r['proposed_spot_eta_min']):>9}  "
            f"{r['fire_reason'] or ''}"
        )


_REST_STATES = {"REST_FORECAST_FIRE", "REST_FIRE"}


def _first_monotony_min(rows: list[TickRow]) -> float | None:
    r = next((r for r in rows if r["rest_state"] == "REST_NORMAL"), None)
    return r["elapsed_min"] if r else None


def _forecast_fire_min(rows: list[TickRow]) -> float | None:
    r = next((r for r in rows if r["rest_state"] == "REST_FORECAST_FIRE"), None)
    return r["elapsed_min"] if r else None


def _first_rest_fire_min(rows: list[TickRow]) -> float | None:
    """First surfacing rest_required fire of EITHER kind (forecast early-fire or
    ordinary safety fire) — the spacing invariant applies to both uniformly."""
    r = next((r for r in rows if r["rest_state"] in _REST_STATES), None)
    return r["elapsed_min"] if r else None


if __name__ == "__main__":
    off_rows = run_nikko(GAP_OFF_OVERRIDES)
    on_rows = run_nikko(GAP_ON_OVERRIDES)

    _print_table(f"GAP OFF (gap=0)  {GAP_OFF_OVERRIDES}", off_rows)
    _print_table(f"GAP ON  (gap=20) {GAP_ON_OVERRIDES}", on_rows)

    off_mono = _first_monotony_min(off_rows)
    off_fc = _forecast_fire_min(off_rows)
    off_rest = _first_rest_fire_min(off_rows)
    on_mono = _first_monotony_min(on_rows)
    on_fc = _forecast_fire_min(on_rows)
    on_rest = _first_rest_fire_min(on_rows)

    gap = 20.0

    print("\n--- summary ---")
    print(f"GAP OFF: monotony@{off_mono} min  forecast@{off_fc} min  "
          f"first_rest@{off_rest} min  "
          f"spacing={None if (off_mono is None or off_rest is None) else round(off_rest - off_mono, 1)} min")
    print(f"GAP ON : monotony@{on_mono} min  forecast@{on_fc} min  "
          f"first_rest@{on_rest} min  "
          f"spacing={None if (on_mono is None or on_rest is None) else round(on_rest - on_mono, 1)} min")

    print()
    # Finalized design (user decisions, nri-forecast-rest-0824):
    #   * gap=20 applies UNIFORMLY to any rest_required fire (forecast early-fire
    #     AND ordinary safety fire) — no safety exception.
    #   * On tokyo_nikko the gap DELETES the early forecast (it fires ~8.7 min
    #     after monotony, inside the window) — the accepted fallback. The driver
    #     is NOT left un-served: the ordinary safety fire still surfaces, just
    #     spaced >= 20 min past the monotony card.
    # So the PASS condition is the spacing INVARIANT, not "forecast still fires".
    if on_mono is None:
        print("NOTE: no monotony fired in GAP ON — spacing invariant is vacuous")
    elif on_rest is None:
        print(f"WARN: GAP ON produced NO rest fire at all after monotony@{on_mono} "
              f"(driver never offered a rest for the whole trip)")
        sys.exit(1) if "--assert" in sys.argv else None
    elif on_rest - on_mono >= gap:
        deleted = " (early forecast deleted — accepted fallback)" if on_fc is None else ""
        print(f"PASS: GAP ON spaced the first rest fire to {on_rest} min, "
              f"{round(on_rest - on_mono, 1)} min after monotony@{on_mono} "
              f"(>= {gap} min gap){deleted}")
    else:
        print(f"FAIL: GAP ON first rest fire @{on_rest} min is only "
              f"{round(on_rest - on_mono, 1)} min after monotony@{on_mono} "
              f"(< {gap} min gap) — spacing not enforced")
        sys.exit(1) if "--assert" in sys.argv else None
