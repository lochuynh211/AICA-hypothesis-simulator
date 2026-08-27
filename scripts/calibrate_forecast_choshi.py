"""DUPLICATE of calibrate_forecast_demo.py, re-pointed to the tokyo_choshi
route with initial drowsiness = 60 — to verify the user's reported UC-05-01
observation ("forecast fires @~40 min, closest rest spot ~51 min").

Everything is identical to calibrate_forecast_demo.py EXCEPT:
  * _ROUTE_PRESET_ID = "tokyo_choshi"      (was uc05_01_minatomirai_gotemba)
  * _INITIAL_STATE drowsiness_level = 60   (was 90)

It drives the SAME content-relief-modeled Combined path (discovery pass +
real pass with content_service_id), then prints, per fire episode, both:
  * proposed_spot_eta_min  = nextRestSpotMin (the trigger's actionability ETA)
  * current_rest_spot_*     = the forecast gate's OFFERED spot (from criteria)
  * forecast_* future spot  = the REASON spot
and replicates the /api/runs/{id}/rest-spots picker at the fire position so we
see exactly which spot the UI would offer and its reachable flag.
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
from aica_api.models.run import RouteFacts  # noqa: E402
from aica_api.routers.route_presets import load_route_preset  # noqa: E402
from aica_api.services.merged_quickview import _project_fire  # noqa: E402
from aica_api.services.preview import (  # noqa: E402
    _resolve_package_and_scenario,
    iter_preview_ticks,
)
from aica_api.services.run_plan import create_draft, get_draft_entry  # noqa: E402
from aica_api.services.tick_engine import _eta_min_to_km  # noqa: E402

_PACKAGE_ID = "nri_fatigue_score_v1"
_SCENARIO_ID = "uc05_01_forecast_jam_v0_1"
_ROUTE_PRESET_ID = "tokyo_choshi"  # CHANGED
_RUN_SEED = 42
_NO_REST_SENTINEL = 9999.0

NEW_HYPERPARAMETER_OVERRIDES = {
    "threshold_forecast_rest": 65.0,
    "rest_spot_eta_filter_min": 30.0,
}

_TICK_SECONDS = 20
_CONTEXT_OVERRIDES = {"child_passenger": False, "is_night": False}
_INITIAL_STATE = {"drowsiness_level": 60, "fatigue_level": 55}  # CHANGED (was 90)

_SERVICE_PACKAGE_ID = "aica_transparent_service_selector_v1"
_CONTENT_PACKAGE_ID = "aica_transparent_content_selector_v1"
_RUN_SEED_PROPOSAL = "42"
_PROPOSAL_PRESET_PATH = (
    _REPO_ROOT / "proposal_contracts" / "presets" / "preset-uc05-01-forecast-c.json"
)

# picker constants (mirror routers/runs.py rest_spots_endpoint)
_REST_SPOTS_MAX = 5
_REST_SPOTS_MIN_AHEAD_KM = 1.0


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


class TickRow(TypedDict):
    tick_index: int
    elapsed_min: float
    distance_km: float
    rest_state: str | None
    fire_reason: str | None
    proposed_spot_eta_min: float | None
    current_rest_spot_eta_min: float | None
    current_rest_spot_actionable: bool | None
    forecast_rest_spot_eta_from_fire_min: float | None
    forecast_future_rest_unactionable: bool | None


def _picker_at(route_facts: RouteFacts, event_plan: Any, sp: Any,
               current_km: float, current_elapsed_min: float,
               eta_filter: float, spacing: float = 20.0) -> list[dict[str, Any]]:
    """Replicate rest_spots_endpoint candidate selection + ETA at a position."""
    named = route_facts.named_rest_spots or []
    real = [s for s in named if not s.synthetic]
    cands = [(s.position_km, s.name) for s in real]
    ahead = [(p, n) for p, n in cands if p > current_km + _REST_SPOTS_MIN_AHEAD_KM]
    if not ahead:
        ahead = [(p, n) for p, n in cands if p > current_km]
    ahead.sort(key=lambda t: t[0])
    spaced: list[tuple[float, str]] = []
    last = None
    for p, n in ahead:
        if last is None or (p - last) >= spacing:
            spaced.append((p, n)); last = p
            if len(spaced) >= _REST_SPOTS_MAX:
                break
    out = []
    for p, n in spaced:
        raw = _eta_min_to_km(target_km=p, from_km=current_km,
                             from_elapsed_min=current_elapsed_min,
                             route_facts=route_facts, event_plan=event_plan, sp=sp)
        out.append({
            "km": p,
            "dist_km": round(max(0.0, p - current_km), 1),
            "eta_min": round(raw, 1),
            "reachable": raw <= eta_filter,
            "name_ascii": n.encode("ascii", "replace").decode(),
        })
    return out


def run() -> None:
    route_facts, display_route = _load_route()
    hp = NEW_HYPERPARAMETER_OVERRIDES

    content_service_id = _discover_content_service(hp, route_facts, display_route)
    print(f"discovered content_service_id = {content_service_id}")

    # Build a draft to get event_plan + speed profile for the picker replica.
    package, scenario = _resolve_package_and_scenario(
        _PACKAGE_ID, _SCENARIO_ID, settings.packages_dir, settings.scenarios_dir)
    rfacts = (route_facts if isinstance(route_facts, RouteFacts)
              else RouteFacts.model_validate(route_facts))
    create_draft(
        plan_id="choshi_probe", package=package, scenario=scenario,
        presets={"tick_seconds": _TICK_SECONDS}, parameters={},
        hyperparameters=hp, run_mode="standard",
        route_facts=rfacts, route_source="maps", display_route=display_route,
        profiles=None, context_overrides=_CONTEXT_OVERRIDES, initial_state=_INITIAL_STATE,
    )
    _d, _pkg, eff_scen = get_draft_entry("choshi_probe")
    ep = _d.draft_event_plan
    sp = eff_scen.speed_profile
    eta_filter = float(hp["rest_spot_eta_filter_min"])

    events = iter_preview_ticks(
        package_id=_PACKAGE_ID, scenario_id=_SCENARIO_ID,
        hyperparameter_overrides=hp, run_seed=_RUN_SEED, rest_option_id=None,
        packages_dir=settings.packages_dir, scenarios_dir=settings.scenarios_dir,
        route_source="maps", route_facts=route_facts, display_route=display_route,
        presets={"tick_seconds": _TICK_SECONDS},
        context_overrides=_CONTEXT_OVERRIDES, initial_state=_INITIAL_STATE,
        content_service_id=content_service_id,
    )

    print(f"\nroute={_ROUTE_PRESET_ID} drowsiness={_INITIAL_STATE['drowsiness_level']} "
          f"tick_seconds={_TICK_SECONDS} content={content_service_id}")
    for ev in events:
        c = ev.decision.criteria or {}
        dyn = (ev.tick_state.signals or {}).get("dynamic", {}) or {}
        raw_eta = dyn.get("nextRestSpotMin")
        proposed = None if raw_eta is None or float(raw_eta) >= _NO_REST_SENTINEL else float(raw_eta)
        km = float(ev.tick_state.distance_km or 0.0)
        print("\n" + "=" * 70)
        print(f"FIRE tick={ev.tick_index} @{ev.elapsed_min:.1f}min km={km:.2f} "
              f"cat={ev.decision.selected_category} rest_state={ev.decision.states.get('rest')} "
              f"reason={ev.decision.fire_control.reason}")
        print(f"  nextRestSpotMin (actionability ETA) = {proposed}")
        print(f"  OFFERED spot: current_rest_spot_eta={c.get('current_rest_spot_eta_min')} "
              f"actionable={c.get('current_rest_spot_actionable')} "
              f"unreason={c.get('current_rest_spot_unactionable_reason')}")
        print(f"  REASON spot (future): eta_from_fire={c.get('forecast_rest_spot_eta_from_fire_min')} "
              f"future_unactionable={c.get('forecast_future_rest_unactionable')} "
              f"unreason={c.get('forecast_rest_unactionable_reason')}")
        picker = _picker_at(rfacts, ep, sp, km, float(ev.elapsed_min), eta_filter)
        print("  PICKER (what the UI rest-spot list shows at this position):")
        for s in picker:
            print(f"     km={s['km']:.2f} dist={s['dist_km']}km eta={s['eta_min']}min "
                  f"reachable={s['reachable']}  {s['name_ascii']}")


if __name__ == "__main__":
    run()
