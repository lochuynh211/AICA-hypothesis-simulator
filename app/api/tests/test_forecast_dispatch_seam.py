"""Dispatch-seam regression for the `nri_forecast` forward (final-review Finding 3
follow-up; see `test_forecast_parity.py`'s module docstring for the original
diagnosis).

`aica_api.algorithms.python_module.dispatch()` used to build the `py_context`
dict handed to a package's `evaluate()` from a FIXED, explicit key set that
never included `context["nri_forecast"]` — the key `run_manager.tick()` and
`preview.iter_preview_ticks()` both set on the OUTER context before calling
`aica_api.algorithms.adapter.evaluate(...)`. That silently dropped the
forecast block one layer below the adapter boundary, so
`nri_fatigue_score_v1.algorithm`'s `context.get("nri_forecast")` always saw
`{}` through the real dispatch path, and its forecast early-rest path
(`REST_FORECAST_FIRE`) was structurally unreachable in any live/preview run —
even though every existing forecast unit test in `test_nri_fatigue_score.py`
passed, because they all call `nri_fatigue_score_v1.algorithm.evaluate()`
DIRECTLY, bypassing `dispatch()` entirely.

This test closes that gap by driving the SAME early-fire context through the
REAL adapter path — `adapter.evaluate(...)` -> `python_module.dispatch(...)`
-> the real `nri_fatigue_score_v1` package loaded from disk via
`PackageRegistry` — the tightest possible regression for the fix: the ONLY
layer between `algorithm.evaluate()` (already covered) and this test is
`dispatch()`, which is exactly what was dropping the key.

RED-first confirmation (reasoned, not re-broken-and-rerun): before the fix,
`dispatch()`'s `py_context` literal (`python_module.py:172-182`) had no
`nri_forecast` key and nothing else added one, so
`test_dispatch_seam_fires_forecast_rest_with_block_present` would have failed
its `states.rest == "REST_FORECAST_FIRE"` assertion — the algorithm always
sees `context.get("nri_forecast")` as `None`/absent and takes its native
(non-forecast) path. Only the one-line conditional forward added right after
that literal makes it pass.
"""

from __future__ import annotations

import copy
import json
import pathlib

from aica_api.algorithms import adapter
from aica_api.config import settings
from aica_api.services.package_registry import PackageRegistry

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
_PKG_ID = "nri_fatigue_score_v1"
_PKG_JSON = _REPO_ROOT / "packages" / _PKG_ID / "package.json"

_EMPTY_PH = {
    "lastProposalTimeSec": None,
    "lastProposalCategory": None,
    "lastProposalResult": None,
    "proposalCountLast30Min": 0,
    "acceptanceRateRecent": 0.0,
}


def _default_hp() -> dict:
    """Read declared hyperparameter defaults from the real package manifest
    (single source — mirrors test_nri_fatigue_score.py's `_default_hp`)."""
    data = json.loads(_PKG_JSON.read_text(encoding="utf-8"))
    return {hp["key"]: hp["default"] for hp in data["hyperparameters"]}


HP = _default_hp()


def _signals() -> dict:
    """Tiered signals with `motionState="STOPPED"` so nothing accrues this
    tick (mirrors test_nri_fatigue_score.py's `_early_ctx` deterministic
    score control: s_total == cumulative_jam_min * w_jam == 110.0 * 0.8 ==
    88.0, strictly inside the (80, 100) early band)."""
    return {
        "fixed": {
            "isNight": False,
            "familiarRoute": False,
            "childPassenger": False,
            "weatherRiskLevel": 0.0,
        },
        "dynamic": {
            "segmentType": "normal_road",
            "motionState": "STOPPED",
            "continuousDrivingMin": 0.0,
            "speedKph": 80.0,
            "routeFraction": 0.0,
            "nextRestSpotMin": 9999.0,
            "isTrafficJam": False,
            "recoveryPhase": None,
        },
        "simulated": {
            "drowsiness": 0.0,
            "fatigue": 0.0,
            "anomaly_rate": 0.0,
        },
    }


def _forecast_block() -> dict:
    """An orchestration-supplied `nri_forecast` block (Task 4 shape)
    describing an eligible early-rest situation — byte-for-byte the same
    shape as test_nri_fatigue_score.py's `_forecast_block()` default
    (current spot actionable, future fire found, future rest spot
    unactionable, threshold order valid)."""
    return {
        "evaluated": True,
        "error": None,
        "threshold_order_valid": True,
        "forecast_mode": "committed_state_continuation",
        "forecast_start": {
            "content_active": True,
            "service_id": "humming_karaoke",
            "content_remaining_min": 11.0,
        },
        "future_fire": {
            "found": True,
            "tick_index": 42,
            "elapsed_min": 126.0,
            "distance_km": 101.5,
            "route_fraction": 0.84,
            "s_total": 100.8,
        },
        "forecast_rest_spot": {
            "exists": True,
            "position_km": 116.0,
            "eta_from_fire_min": 34.0,
            "eta_to_destination_min": 22.0,
            "actionable": False,
        },
        "forecast_future_rest_unactionable": True,
        "forecast_rest_unactionable_reason": "eta_over_30_min",
        "current_rest_spot": {
            "exists": True,
            "position_km": 83.0,
            "eta_from_current_min": 18.0,
            "eta_to_destination_min": 31.0,
            "actionable": True,
            "unactionable_reason": None,
        },
    }


def _base_context(*, nri_forecast) -> dict:
    """The OUTER context shape run_manager.tick()/iter_preview_ticks() build
    (tiered signals + injected fields), optionally carrying `nri_forecast`
    exactly the way those two call sites attach it — see the module
    docstring and python_module.py's forwarding comment."""
    ctx = {
        "simulation_time_sec": 60.0,
        "signals": _signals(),
        "feature_groups": {"normalized": {}, "ordinal": {"signal_duration": "transient"}},
        "proposal_history": dict(_EMPTY_PH),
        "user_action_history": [],
        "recovery_active": False,
    }
    if nri_forecast is not None:
        ctx["nri_forecast"] = nri_forecast
    return ctx


def _load_real_nri_package():
    registry = PackageRegistry(settings.packages_dir)
    package = registry.get(_PKG_ID)
    assert package is not None, (
        f"expected the real {_PKG_ID!r} package manifest to load from "
        f"{settings.packages_dir} — registry errors: {registry.list_errors()}"
    )
    return package


def test_dispatch_seam_fires_forecast_rest_with_block_present():
    """Assertion 1 (brief): through the REAL adapter.evaluate(...) ->
    python_module.dispatch(...) path, WITH `context["nri_forecast"]`
    present, the real nri_fatigue_score_v1 package fires
    `REST_FORECAST_FIRE`. This FAILS before Fix A (dispatch() silently drops
    the block) and PASSES after it — see the RED-first reasoning in the
    module docstring."""
    package = _load_real_nri_package()
    context = _base_context(nri_forecast=_forecast_block())
    # Rest-after-monotony spacing is no longer an algorithm concern (the engine's
    # _apply_rest_min_gap_guard owns it), so this seam test observes the un-gated
    # early fire directly (spacing itself is exercised in
    # test_rest_min_gap_guard.py).
    package_runtime_state = {"cumulative_jam_min": 110.0}

    result = adapter.evaluate(
        package=package,
        context=context,
        parameters={},
        hyperparameters=HP,
        history=[],
        package_runtime_state=package_runtime_state,
    )

    assert 80.0 < result.scores["s_total"] < 100.0
    assert result.states.get("rest") == "REST_FORECAST_FIRE"
    assert result.fire_control.reason == "forecast_rest_opportunity_passed"
    assert result.selected_category == "rest_required"
    assert result.trigger_candidate is True


def test_dispatch_seam_does_not_early_fire_when_block_absent():
    """Assertion 2 (brief): the SAME call with `context` MINUS the
    `nri_forecast` key does NOT early-fire — proving the forwarded block is
    what drives the path, and that its absence stays legal (native
    fallback), matching every non-forecast call site of this same package
    that never sets `nri_forecast` at all."""
    package = _load_real_nri_package()
    context = _base_context(nri_forecast=None)
    assert "nri_forecast" not in context
    package_runtime_state = {"cumulative_jam_min": 110.0}

    result = adapter.evaluate(
        package=package,
        context=copy.deepcopy(context),
        parameters={},
        hyperparameters=HP,
        history=[],
        package_runtime_state=package_runtime_state,
    )

    assert result.states.get("rest") != "REST_FORECAST_FIRE"
    assert result.fire_control.reason != "forecast_rest_opportunity_passed"
