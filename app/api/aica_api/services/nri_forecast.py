"""Committed-state continuation forecast for NRI (design §8–§10).

A NON-PERSISTING projection: it copies the post-current-tick state and steps the
deterministic tick/adapter loop forward, CONTINUING the already-committed
intervention but ACCEPTING NO projected-future proposal, to answer one question —
when the score next crosses threshold_fire, will a rest facility be actionable
there? It never touches the live run, never appends events, never advances the
real tick. See the plan's Shared contract reference for the returned block shape.
"""
from __future__ import annotations

from typing import Callable

from aica_api.services.tick_engine import (
    advance_tick,
    rest_spot_actionability,
    _NO_REST_SENTINEL,
)

EvaluateFn = Callable[..., dict]

_MAX_FORECAST_TICKS = 2000


def _unavailable(error: str | None, threshold_order_valid: bool = True) -> dict:
    return {
        "evaluated": False, "error": error,
        "threshold_order_valid": threshold_order_valid,
        "forecast_mode": "committed_state_continuation",
        "forecast_start": {"content_active": False, "service_id": None, "content_remaining_min": 0.0},
        "future_fire": {"found": False, "tick_index": None, "elapsed_min": None,
                        "distance_km": None, "route_fraction": None, "s_total": None},
        "forecast_rest_spot": {"exists": False, "position_km": None, "eta_from_fire_min": None,
                               "eta_to_destination_min": None, "actionable": False},
        "forecast_future_rest_unactionable": False,
        "forecast_rest_unactionable_reason": None,
        "current_rest_spot": {"exists": False, "position_km": None, "eta_from_current_min": None,
                              "eta_to_destination_min": None, "actionable": False,
                              "unactionable_reason": None},
    }


def run_forecast(
    *,
    start_tick_state,
    start_tick_index: int,
    current_elapsed_min: float,
    current_distance_km: float,
    event_plan,
    route_facts,
    scenario,
    run_seed,
    package_runtime_state: dict,
    committed_content=None,
    committed_content_remaining_min: float = 0.0,
    committed_content_relief=None,
    evaluate: EvaluateFn,
    threshold_fire: float,
    threshold_forecast_rest: float,
    threshold_monotony: float,
    eta_filter_min: float,
) -> dict:
    sp = scenario.speed_profile
    tick_seconds = event_plan.tick_seconds

    # Current rest spot (design §10) — always computable from the actual tick.
    current = rest_spot_actionability(
        from_km=current_distance_km, from_elapsed_min=current_elapsed_min,
        route_facts=route_facts, event_plan=event_plan, sp=sp, eta_filter_min=eta_filter_min,
    )
    current_block = {
        "exists": current.exists, "position_km": current.position_km,
        "eta_from_current_min": (None if not current.exists else current.eta_from_position_min),
        "eta_to_destination_min": current.eta_to_destination_min,
        "actionable": current.actionable, "unactionable_reason": current.unactionable_reason,
    }

    start_block = {
        "content_active": committed_content is not None,
        "service_id": getattr(committed_content, "service_id", None),
        "content_remaining_min": float(committed_content_remaining_min or 0.0),
    }

    # ── Project forward, continuing committed state, accepting no proposal ──
    prior = start_tick_state
    state = dict(package_runtime_state)
    fire = None
    try:
        for step in range(1, _MAX_FORECAST_TICKS + 1):
            idx = start_tick_index + step - 1
            projected_elapsed_from_start_min = (step - 1) * tick_seconds / 60.0
            content_playing = (
                committed_content is not None
                and projected_elapsed_from_start_min < committed_content_remaining_min
            )
            content = committed_content if content_playing else None
            relief = committed_content_relief if content_playing else None

            ts = advance_tick(
                prior, idx, event_plan, route_facts, scenario,
                recovery=None,               # §8.2 item 10 — never start recovery
                run_seed=run_seed, content=content, content_relief=relief,
            )
            decision = evaluate(ts, state)   # §8.2 items 6-9 — ignore its proposal/fire
            state = dict(decision["next_package_runtime_state"])
            s_total = float(decision["scores"]["s_total"])

            if s_total >= threshold_fire:
                fire = {
                    "found": True, "tick_index": idx,
                    "elapsed_min": idx * tick_seconds / 60.0,
                    "distance_km": ts.distance_km, "route_fraction": ts.route_fraction,
                    "s_total": s_total,
                }
                break
            if ts.completed:
                break
            prior = ts
    except Exception as exc:                 # §18 — fail open; forecast is advisory
        block = _unavailable(f"forecast_error: {exc!r}")
        block["current_rest_spot"] = current_block
        block["forecast_start"] = start_block
        return block

    # ── No crossing before destination → future rest is not unactionable ──
    if fire is None:
        block = _unavailable(None)
        block["evaluated"] = True
        block["current_rest_spot"] = current_block
        block["forecast_start"] = start_block
        return block

    # ── Future rest spot at the crossing (design §9) ──
    fspot = rest_spot_actionability(
        from_km=fire["distance_km"], from_elapsed_min=fire["elapsed_min"],
        route_facts=route_facts, event_plan=event_plan, sp=sp, eta_filter_min=eta_filter_min,
    )
    # Map the shared reason to the forecast-spot reason vocabulary (§9/§13/§18):
    _reason_map = {"rest_spot_eta_over_limit": "eta_over_30_min"}
    forecast_rest_spot = {
        "exists": fspot.exists, "position_km": fspot.position_km,
        "eta_from_fire_min": (None if not fspot.exists else fspot.eta_from_position_min),
        "eta_to_destination_min": fspot.eta_to_destination_min,
        "actionable": fspot.actionable,
    }
    future_unactionable = not fspot.actionable
    future_reason = (
        _reason_map.get(fspot.unactionable_reason, fspot.unactionable_reason)
        if future_unactionable else None
    )

    return {
        "evaluated": True, "error": None, "threshold_order_valid": True,
        "forecast_mode": "committed_state_continuation",
        "forecast_start": start_block,
        "future_fire": fire,
        "forecast_rest_spot": forecast_rest_spot,
        "forecast_future_rest_unactionable": future_unactionable,
        "forecast_rest_unactionable_reason": future_reason,
        "current_rest_spot": current_block,
    }
