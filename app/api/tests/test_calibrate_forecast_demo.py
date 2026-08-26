"""Task 5: calibration harness for the UC-05-01 forecast-jam demo.

`test_run_returns_tickrows_with_required_keys` is the harness-runs contract —
it MUST pass regardless of jam calibration.

`test_new_fires_forecast_and_old_fires_ordinary_late` is the BEHAVIORAL claim
the whole demo exists to prove. It may legitimately FAIL until Task 6
calibrates `scenarios/uc05_01_forecast_jam_v0_1.json`'s placeholder jam
(`presets.traffic_events`) — that is expected and is not a bug in this
harness; see `scripts/calibrate_forecast_demo.py`'s module docstring and
`.superpowers/sdd/2026-08-25-uc05-01-forecast-jam-demo/task-5-interface-supplement.md`
§6.
"""

import sys
from pathlib import Path

import pytest

# `scripts/` is not a package under app/api's test rootdir — add the repo
# root to sys.path so `scripts.calibrate_forecast_demo` is importable without
# restructuring the repo (per the brief's Step 1 comment).
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import importlib

demo = importlib.import_module("scripts.calibrate_forecast_demo")

NEW = {"threshold_forecast_rest": 65.0, "rest_spot_eta_filter_min": 30.0}
OLD = {"threshold_forecast_rest": 100.0, "rest_spot_eta_filter_min": 90.0}


def test_run_returns_tickrows_with_required_keys():
    rows = demo.run_uc05_01(NEW)
    assert rows, "expected a non-empty tick trace"
    r = rows[0]
    for key in ("tick_index", "elapsed_min", "distance_km", "rest_state", "fire_reason", "proposed_spot_eta_min"):
        assert key in r


def test_new_fires_forecast_and_old_fires_ordinary_late():
    new_rows = demo.run_uc05_01(NEW)
    old_rows = demo.run_uc05_01(OLD)
    new_fire = next((r for r in new_rows if r["rest_state"] == "REST_FORECAST_FIRE"), None)
    # OLD's "ordinary rest fire" is the score-100 crossing (spec §2/§6):
    # `fire_control.reason == "fire_threshold_passed"` / `states.rest ==
    # "REST_FIRE"`. NOT the earlier monotony content-nudge (REST_NORMAL /
    # monotony_threshold_passed), whose near spot would mis-read the divergence.
    old_fire = next((r for r in old_rows if r["fire_reason"] == "fire_threshold_passed"), None)
    assert new_fire is not None, "NEW must produce a REST_FORECAST_FIRE"
    assert old_fire is not None, "OLD must produce an ordinary rest fire"
    # NEW fires strictly earlier than OLD (the whole point of the demo).
    assert new_fire["elapsed_min"] < old_fire["elapsed_min"]
    # OLD's proposed spot is far (deep in the jam, ~90 min); NEW's is reachable
    # (<= its 30-min filter).
    assert old_fire["proposed_spot_eta_min"] is not None and old_fire["proposed_spot_eta_min"] > 30.0
