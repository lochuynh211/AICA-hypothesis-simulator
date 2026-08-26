"""UC-05-01 forecast-jam calibration harness (Task 5, forecast on/off oracle).

Drives the NRI (`nri_fatigue_score_v1`) forecast trigger over the UC-05-01
Minatomirai -> Gotemba Outlets route/scenario TWICE — once with the
"forecast NEW" hyperparameters (`threshold_forecast_rest=65.0`,
`rest_spot_eta_filter_min=30.0`, i.e. the package defaults) and once with the
"forecast OLD" (effectively forecast-disabled) hyperparameters
(`threshold_forecast_rest=100.0`, `rest_spot_eta_filter_min=120.0`) — and
returns a per-fire-episode tick trace (`TickRow`) for each pass.

This is the oracle Task 6 uses to calibrate the scenario's placeholder
traffic jam (`scenarios/uc05_01_forecast_jam_v0_1.json` presets.traffic_events)
so that NEW produces an early `REST_FORECAST_FIRE` (the forecast sees the jam
coming and proposes rest before it starts) while OLD only fires an ordinary,
late rest proposal whose nearest rest spot sits deep inside/after the jam
(ETA far beyond the tighter 30 min actionability filter). It is also the
source of the Task 7 htmlapp cross-check golden.

Implementation notes (see
`.superpowers/sdd/2026-08-25-uc05-01-forecast-jam-demo/task-5-interface-supplement.md`
for the full rationale):

- Driven via the headless `iter_preview_ticks` generator (`services/preview.py`)
  rather than the HTTP run loop — no persistence, one `PreviewFireEvent` per
  fire EPISODE (rising edge), which is exactly what a `TickRow` needs here.
- Models the CONTENT-relief feedback of the Combined path: this demo is the
  Combined screen (a monotony content-nudge is accepted mid-drive, then the
  forecast fires). `run_uc05_01` runs the SAME two passes `merged_quickview
  .project` does — a content-free discovery pass to learn the selector's
  recovery-content pick, then the real pass with that pick set as
  `content_service_id` so its recovery curve feeds back into the projected
  fatigue score. Without this the harness would "prove" a divergence the live
  Combined run never shows (the exact bug this re-calibration fixes).
- UC-05-01 is a MAPS route (`routes/presets/uc05_01_minatomirai_gotemba.json`,
  87.7 km on the Tomei). `_load_route()` reuses
  `routers.route_presets.load_route_preset` (the SAME function
  `POST /api/routes/presets/{id}/load` calls) to build the `route_facts` +
  `display_route` dicts, then passes them into `iter_preview_ticks` with
  `route_source="maps"` — it does not re-derive the route.
- The scenario's own placeholder jam
  (`uc05_01_forecast_jam_v0_1.json` -> `presets.traffic_events`) is NOT
  forwarded explicitly via `iter_preview_ticks(presets=...)`. Verified
  (empirically, and by reading `event_plan.build_event_plan`): `create_draft`
  ->`build_event_plan(route_facts, scenario, effective_presets)` always merges
  `scenario.presets` underneath whatever `presets` dict the caller supplies
  (caller keys win on conflict) — so passing `presets=None` (the default) already
  carries the scenario's own `traffic_events` through untouched. Forwarding
  them again here would be redundant, not additive.
- `proposed_spot_eta_min` is read from the fire tick's raw
  `tick_state.signals["dynamic"]["nextRestSpotMin"]` (see
  `services/tick_engine.py` — this is the SAME raw number
  `services/binning.py::build_feature_groups` bins into the `rest_spot_eta`
  ordinal band, and the same number the `rest_spot_eta_filter_min`
  actionability gate compares against in `nri_fatigue_score_v1`'s
  `algorithm.py`). The 9999.0 "no rest spot ahead" sentinel maps to `None`.
  This is deliberately NOT read from `PreviewFireEvent.rest_spot` — that
  object never carries an ETA (`_pick_rest_spot` only sets id/label/
  route_fraction).
- `rest_state` = `decision.states.get("rest")` (carries the literal
  `"REST_FORECAST_FIRE"` string for the forecast-early-fire state).
- `fire_reason` = `decision.fire_control.reason`.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, TypedDict

# Make `aica_api` importable when this script is run directly (mirrors the
# PYTHONPATH=app/api convention the project's own test runner uses) without
# requiring callers to set PYTHONPATH themselves.
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
_ROUTE_PRESET_ID = "uc05_01_minatomirai_gotemba"
# scenario.run_seed_default (uc05_01_forecast_jam_v0_1.json) — kept as a
# module constant rather than re-reading the scenario file, since the
# scenario's own default is itself the deterministic seed this harness needs
# and Tasks 1-3 already fixed it at 42.
_RUN_SEED = 42

# Mirrors services/tick_engine.py's `_NO_REST_SENTINEL` / binning.py's
# `_bin_rest_spot_eta` threshold: 9999.0 means "no rest spot ahead at all",
# not a real (if large) ETA.
_NO_REST_SENTINEL = 9999.0

# The brief's two hyperparameter sets (Step 1). NEW == the NRI package
# defaults (forecast enabled, tight actionability filter); OLD widens the
# forecast threshold to effectively the ordinary fire threshold and relaxes
# the ETA filter, i.e. "forecast off".
NEW_HYPERPARAMETER_OVERRIDES = {
    "threshold_forecast_rest": 65.0,
    "rest_spot_eta_filter_min": 30.0,
}
OLD_HYPERPARAMETER_OVERRIDES = {
    "threshold_forecast_rest": 100.0,
    "rest_spot_eta_filter_min": 120.0,
}

# Demo pins — these mirror the master preset `combined_contracts/test_cases/
# case-uc05-01-forecast-jam-c.json` (`journey.tick_seconds` + `fixed_overrides`)
# so this harness reproduces the ACTUAL app-UI reproduction path (the review UI
# resolves that case and runs it), NOT the raw scenario defaults. The distinction
# is load-bearing:
#
#   * `_TICK_SECONDS = 20` overrides the package's declared cadence
#     (`nri_fatigue_score_v1` `algorithm.tick_seconds = 180`). At the coarse
#     180 s cadence the forecast band `(65, 100)` — a narrow score window — is
#     only sampled every 3 min and the forecast gate's momentary geometry
#     (future spot unactionable AND pre-jam spot reachable NOW) is stepped over
#     for this solo persona. The app runs the case at 20 s; the harness must
#     match or it would "prove" a divergence the app never shows (the bug this
#     re-calibration fixes).
#   * `child_passenger = False` / `is_night = False` keep the persona faithful —
#     Ms. C drives solo home from a fan event on a Saturday evening (day). The
#     scenario file still carries the UC-01 template's `child_passenger = true`;
#     the case overrides it to false (via `caseResolver.ts` -> context_overrides),
#     so the harness overrides both here too. Without a child the fatigue score
#     climbs slower, so the entry state is pinned higher (below) to reach the
#     forecast band while a pre-jam SA is still reachable.
#   * `initial_state` drowsiness 90 / fatigue 55 is the calibrated solo entry
#     state. It is deliberately high on BOTH axes: the persona is
#     sleep-deprived with low self-awareness ("still fine"), and — the
#     load-bearing part — the initial *fatigue* is the CONTENT-IMMUNE lever.
#     After the ~km26 monotony content-nudge is accepted, the selector-picked
#     recovery content (humming_karaoke) drains only the monotony accumulator,
#     flattening the projected fatigue-score curve; a low-fatigue persona then
#     only re-enters the forecast band *inside* the jam (where the current spot
#     is already unactionable) and the forecast never fires — the safety
#     trigger fires late instead. Raising the realtime fatigue floor (never
#     drained by content) lifts the whole curve so NEW crosses the forecast
#     band `(65, 100)` at ~km49.6 / ~37.7 min — Nakai PA (km55.77) still reachable
#     (ETA ~4.7 min) — while OLD's ordinary score-100 fire lands ~7 min later
#     (~km59.3) pointing at a spot deep in/after the jam (ETA far beyond NEW's
#     30-min actionability filter). Mirrors the case's
#     `fixed_overrides.initial_drowsiness` / `initial_fatigue`.
_TICK_SECONDS = 20
_CONTEXT_OVERRIDES = {"child_passenger": False, "is_night": False}
_INITIAL_STATE = {"drowsiness_level": 90, "fatigue_level": 55}

# Combined-path content modeling (Combined acknowledge-monotony reproduction).
# The demo IS the Combined screen: at the first (monotony) fire the proposal
# selector picks a recovery content service, and that service's per-service
# recovery curve then feeds back into the trigger's projected fatigue score
# (see `merged_quickview.project` — its two-pass discovery + `content_service_id`
# re-run). This harness must model the SAME feedback or it would "prove" a
# forecast divergence the live Combined run never shows (content relief there
# flattens the curve and suppresses the forecast) — the exact bug this
# re-calibration fixes. So `run_uc05_01` runs the same two passes: a content-
# free discovery pass to learn the selector's pick, then the real pass with
# `content_service_id` set to it. The proposal wiring below mirrors
# `case-uc05-01-forecast-jam-c.json` -> `algorithm_defaults` and the
# `preset-uc05-01-forecast-c.json` world template.
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
    """Load the baked UC-05-01 maps route preset via the same loader the
    `/api/routes/presets/{id}/load` endpoint uses.

    Returns (route_facts, display_route) as plain dicts — the shapes
    `iter_preview_ticks(route_facts=..., display_route=...)` accepts and
    coerces to `RouteFacts`/`DisplayRoute` itself.
    """
    envelope = load_route_preset(_ROUTE_PRESET_ID)
    alternative = envelope["alternatives"][0]
    return alternative["route_facts"], alternative["display"]


def _load_world() -> dict[str, Any]:
    """The INLINE proposal `World` template for Ms. C (the oshi persona), read
    from the master proposal preset. `build_world_from_tick` overwrites its
    GENERATED situation fields (drowsiness/road_type/...) per fire, but the
    driver_profile (oshi artists, usage levels) it carries is what makes the
    service selector pick her oshi recovery content — the pick this harness
    then models as `content_service_id`.
    """
    return json.loads(_PROPOSAL_PRESET_PATH.read_text(encoding="utf-8"))["world"]


def _discover_content_service(
    hyperparameter_overrides: dict[str, Any],
    route_facts: dict[str, Any],
    display_route: dict[str, Any],
) -> str | None:
    """Mirror `merged_quickview.project`'s discovery pass: run one content-free
    trigger preview, project a quick-check proposal at the FIRST actionable fire
    (the ~km26 monotony nudge), and read the service the selector actually picked
    (`journey_state.active_service_id`). That is the recovery content the live
    Combined run plays — and the service whose recovery curve the real pass below
    must feed back into the projected fatigue score. Returns None if there is no
    fire to discover from (then the real pass falls back to the scenario's
    `default_content_service_id`, exactly like `project`).
    """
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


def discover_content_service(hyperparameter_overrides: dict[str, Any]) -> str | None:
    """Public wrapper over `_discover_content_service` (loads the route first).

    The recovery-content service the Combined proposal selector picks at the
    first fire under these hyperparameters — the content this harness models and
    the SAME content the htmlapp OLD-parity reproduction must play. Exposed so
    the htmlapp golden capture can record it into the fixture (rather than the
    parity test hard-coding a service id that could silently drift from what the
    Combined path actually picks).
    """
    route_facts, display_route = _load_route()
    return _discover_content_service(hyperparameter_overrides, route_facts, display_route)


def run_uc05_01(hyperparameter_overrides: dict[str, Any]) -> list[TickRow]:
    """Drive NRI over the UC-05-01 maps route/scenario once, headlessly, on the
    content-modeled Combined path.

    Two passes, mirroring `merged_quickview.project`: a content-free discovery
    pass to learn the selector's recovery-content pick, then the real pass with
    that pick set as `content_service_id` so its recovery curve feeds back into
    the projected fatigue score (the feedback that flattens the curve and is the
    reason the forecast must be calibrated against a content-immune lever).

    Returns one `TickRow` per fire EPISODE (rising edge) — i.e. per
    `PreviewFireEvent` `iter_preview_ticks` yields, in tick order.
    """
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
        # Reproduce the app-UI reproduction path (the master preset's demo
        # pins), not the raw scenario defaults — see the _TICK_SECONDS /
        # _CONTEXT_OVERRIDES / _INITIAL_STATE constants above for why each is
        # load-bearing to the forecast-vs-ordinary divergence.
        presets={"tick_seconds": _TICK_SECONDS},
        context_overrides=_CONTEXT_OVERRIDES,
        initial_state=_INITIAL_STATE,
        # Combined content feedback: play the SAME recovery content the live
        # merged run's proposal selector picks at the first fire, so the
        # projected fatigue-score curve drains the way the live one does.
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


def assert_divergence(new_rows: list[TickRow], old_rows: list[TickRow]) -> None:
    """The two behavioral invariants the whole demo exists to show.

    Raises AssertionError with a readable message if either invariant fails.
    """
    new_fire = next((r for r in new_rows if r["rest_state"] == "REST_FORECAST_FIRE"), None)
    # OLD's "ordinary rest fire" is the score-100 crossing fire the spec (§2/§6)
    # names — `states.rest == "REST_FIRE"` / `fire_control.reason ==
    # "fire_threshold_passed"`. It is NOT the monotony content-nudge episode
    # (`REST_NORMAL` / `monotony_threshold_passed`), which fires earlier with a
    # near spot; matching that would compare the forecast fire against the wrong
    # episode and mis-read the divergence.
    old_fire = next(
        (r for r in old_rows if r["fire_reason"] == "fire_threshold_passed"),
        None,
    )

    if new_fire is None:
        raise AssertionError(
            f"NEW must produce a REST_FORECAST_FIRE episode; got rest_states="
            f"{[r['rest_state'] for r in new_rows]}"
        )
    if old_fire is None:
        raise AssertionError(
            f"OLD must produce an ordinary (non-forecast) rest fire episode; got "
            f"rest_states={[r['rest_state'] for r in old_rows]}"
        )

    if not (new_fire["elapsed_min"] < old_fire["elapsed_min"]):
        raise AssertionError(
            "NEW must fire strictly earlier than OLD — the whole point of the "
            f"demo — but NEW fired at {new_fire['elapsed_min']} min and OLD at "
            f"{old_fire['elapsed_min']} min"
        )

    if not (old_fire["proposed_spot_eta_min"] is not None and old_fire["proposed_spot_eta_min"] > 30.0):
        raise AssertionError(
            "OLD's ordinary fire must propose a FAR spot (ETA > 30 min, i.e. only "
            "reachable under OLD's relaxed 120-min filter, not NEW's 30-min filter) — "
            f"got proposed_spot_eta_min={old_fire['proposed_spot_eta_min']}"
        )


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


if __name__ == "__main__":
    new_rows = run_uc05_01(NEW_HYPERPARAMETER_OVERRIDES)
    old_rows = run_uc05_01(OLD_HYPERPARAMETER_OVERRIDES)

    _print_table(f"NEW (forecast on) {NEW_HYPERPARAMETER_OVERRIDES}", new_rows)
    _print_table(f"OLD (forecast off) {OLD_HYPERPARAMETER_OVERRIDES}", old_rows)

    print()
    try:
        assert_divergence(new_rows, old_rows)
    except AssertionError as exc:
        print(f"FAIL: {exc}")
        if "--assert" in sys.argv:
            sys.exit(1)
    else:
        print("PASS")
