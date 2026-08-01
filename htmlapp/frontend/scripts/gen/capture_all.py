"""Regenerate all parity golden fixtures + the nri_tick_by_tick golden.

Run from repo root:
  PYTHONPATH=app/api python htmlapp/frontend/scripts/gen/capture_all.py

No docker required; uses the in-process ASGI app (TestClient) and direct
module imports from the project's Python source (app/api/aica_api/).

Fixtures written:
  src/engine/__fixtures__/parity/
    binning.json              — binning.build_feature_groups / bin_context / bin_drowsiness_level / bin_fatigue_level
    driver_signals.json       — behavior/driver_signals.advance_driver_state / apply_rest_recovery
    anomaly.json              — behavior/anomaly_signal.advance_anomaly
    prng.json                 — services/prng.seeded_uniform / _subseed
    event_plan.json           — services/event_plan.build_event_plan (+ freeze_event_plan)
    tick_sequence.json        — services/tick_engine.advance_tick (full run; 108 ticks)
    run_plan.json             — services/run_plan.create_draft
    run_log_e2e.json          — services/run_manager (full run, real nri_fatigue_score_v1 package)
    route_analysis.json       — services/route_analysis.analyze_route
    recovery.json             — services/recovery (start_recovery / advance_recovery)
    preview.json              — POST /api/runs/preview (TestClient)
    preview_min_ahead.json    — same endpoint, but with 2 extra named rest spots (maps route_facts
                                  override) positioned to discriminate the auto-accept step's
                                  two-stage MIN_AHEAD rest-spot pick (_pick_rest_spot) from an
                                  implementation that only has the "anything ahead" fallback
    rest_spots.json           — POST /api/run-plans + /api/runs + tick + GET /api/runs/{id}/rest-spots (TestClient)
    rest_spots_min_ahead.json — same endpoint, but with 2 extra named rest spots (maps route_facts
                                  override) positioned to discriminate the two-stage MIN_AHEAD
                                  selection (stage 1 vs. the "anything ahead" fallback) from an
                                  implementation that only has the fallback
    nri_fatigue_score_v1.json — packages/nri_fatigue_score_v1/algorithm.evaluate (direct import)
    aica_transparent_hybrid_trigger_v1.json — packages/aica_transparent_hybrid_trigger_v1/algorithm.evaluate (direct import)
    feedback.json             — services/feedback.effective_schema / validate
    evidence_report.json      — services/evidence.build_evidence_report (full nri run)
    evidence_markdown.json    — services/evidence_markdown.render_evidence_markdown
    evidence_markdown_nri.json — separate nri_fatigue_score_v1 run (all pauses declined),
                                  guards whole-number-float hyperparameter formatting
    nri_tick_by_tick.json     — POST /api/run-plans + runs + tick loop (TestClient), per-tick decision_result
    service_selector.json     — packages/aica_transparent_service_selector_v1/algorithm.evaluate
                                  (direct import, 11-case representative set; C1 Task 4)

Usage invariant: every output file is written atomically (write temp, then rename).
"""
from __future__ import annotations

import dataclasses
import json
import pathlib
import sys
import tempfile
import os

# ---------------------------------------------------------------------------
# Repo / output paths
# ---------------------------------------------------------------------------

_REPO = pathlib.Path(__file__).resolve().parents[4]  # repo root
_OUT = _REPO / "htmlapp" / "frontend" / "src" / "engine" / "__fixtures__" / "parity"
_OUT.mkdir(parents=True, exist_ok=True)

# The offline app reads its scenario from the generated data seam
# (htmlapp/frontend/data/, produced by `npm run build:data`). Point the capture
# rig at the SAME file — if these ever diverge, every golden silently encodes a
# scenario the app does not run.
_SCENARIO_PATH = _REPO / "htmlapp" / "frontend" / "data" / "scenarios" / "uc01_fatigue_recovery_v0_1.json"

if not _SCENARIO_PATH.exists():
    raise SystemExit(
        f"missing {_SCENARIO_PATH}\n"
        "Run `npm run build:data` in htmlapp/frontend first — the data tree is generated, not committed."
    )

# packages dir (for evaluate_preview)
_PACKAGES_DIR = _REPO / "packages"
_SCENARIOS_DIR = _REPO / "scenarios"


def _write(name: str, obj: object) -> None:
    """Write fixture atomically via a temp file."""
    dest = _OUT / f"{name}.json"
    tmp = dest.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(dest)
    print(f"  wrote {dest.name}")


def _load_json(path: pathlib.Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# 1. binning
# ---------------------------------------------------------------------------

def _capture_binning() -> None:
    from aica_api.services.binning import (
        bin_context,
        bin_drowsiness_level,
        bin_fatigue_level,
        build_feature_groups,
    )

    existing = _load_json(_OUT / "binning.json")
    inp = existing["input"]

    _write("binning", {
        "input": inp,
        "output": {
            "feature_groups": [build_feature_groups(c) for c in inp["feature_groups"]],
            "drowsiness_bands": [bin_drowsiness_level(v) for v in inp["drowsiness_levels"]],
            "fatigue_bands": [bin_fatigue_level(v) for v in inp["fatigue_levels"]],
            "bin_context": [bin_context(c) for c in inp["bin_context"]],
        },
    })


# ---------------------------------------------------------------------------
# 2. driver_signals — preserve existing inputs, re-derive outputs
# ---------------------------------------------------------------------------

def _capture_driver_signals() -> None:
    from aica_api.services.behavior.driver_signals import (
        DriverState,
        advance_driver_state,
        apply_rest_recovery,
    )
    from aica_api.models.profile import DriverSignalParams

    existing = _load_json(_OUT / "driver_signals.json")
    inp = existing["input"]
    params = DriverSignalParams.model_validate(inp["params"])

    advance_outputs = []
    for c in inp["advance"]:
        state = DriverState(**c["state"])
        upd = advance_driver_state(
            params, state, c["tick_seconds"],
            is_night=c["isNight"],
            is_monotonous=c["isMonotonous"],
            is_traffic_jam=c["isTrafficJam"],
            is_mountain_road=c["isMountainRoad"],
            continuous_driving_min=c["continuousDrivingMin"],
        )
        advance_outputs.append({
            "previous": dataclasses.asdict(upd.previous),
            "delta": dataclasses.asdict(upd.delta),
            "next": dataclasses.asdict(upd.next),
        })

    recovery_outputs = []
    for c in inp["recovery"]:
        state = DriverState(**c["state"])
        out_state = apply_rest_recovery(params, state, c["activity"])
        recovery_outputs.append(dataclasses.asdict(out_state))

    _write("driver_signals", {
        "input": inp,
        "output": {
            "advance": advance_outputs,
            "recovery": recovery_outputs,
        },
    })


# ---------------------------------------------------------------------------
# 3. anomaly — preserve existing inputs, re-derive outputs
# ---------------------------------------------------------------------------

def _capture_anomaly() -> None:
    from aica_api.services.behavior.anomaly_signal import AnomalyState, advance_anomaly
    from aica_api.models.profile import AnomalySignalParams

    existing = _load_json(_OUT / "anomaly.json")
    sequences_input = existing["input"]["sequences"]

    sequences_output = []
    for seq in sequences_input:
        p = AnomalySignalParams.model_validate(seq["params"])
        state = AnomalyState(events=[])
        steps_out = []
        for step in seq["steps"]:
            upd = advance_anomaly(
                p, state,
                drowsiness=step["drowsiness"],
                tick_index=step["tick_index"],
                tick_seconds=seq["tick_seconds"],
                run_seed=seq["run_seed"],
                is_moving=step["is_moving"],
            )
            steps_out.append({
                "spike": upd.spike,
                "anomaly_rate": upd.anomaly_rate,
                "events": upd.next.events,
            })
            state = upd.next
        sequences_output.append({"steps": steps_out})

    _write("anomaly", {
        "input": existing["input"],
        "output": {"sequences": sequences_output},
    })


# ---------------------------------------------------------------------------
# 4. prng — preserve existing inputs, re-derive outputs
# ---------------------------------------------------------------------------

def _capture_prng() -> None:
    from aica_api.services.prng import _subseed, seeded_uniform

    existing = _load_json(_OUT / "prng.json")
    cases = existing["input"]["cases"]

    results = []
    for c in cases:
        ss = _subseed(c["run_seed"], c["tick"], c["channel"])
        u = seeded_uniform(c["run_seed"], c["tick"], c["channel"])
        results.append({"subseed": str(ss), "uniform": u})

    _write("prng", {
        "input": existing["input"],
        "output": {"results": results},
    })


# ---------------------------------------------------------------------------
# 5. event_plan
# ---------------------------------------------------------------------------

def _capture_event_plan() -> None:
    from aica_api.services.event_plan import build_event_plan
    from aica_api.services.route_analysis import analyze_route
    from aica_api.models.scenario import ScenarioDef

    existing = _load_json(_OUT / "event_plan.json")
    scenario_raw = existing["input"]["scenario"]
    scenario = ScenarioDef.model_validate(scenario_raw)
    route_facts = analyze_route(scenario)
    event_plan = build_event_plan(route_facts, scenario, {})

    _write("event_plan", {
        "input": existing["input"],
        "output": json.loads(event_plan.model_dump_json()),
    })


# ---------------------------------------------------------------------------
# 6. tick_sequence
# ---------------------------------------------------------------------------

def _capture_tick_sequence() -> None:
    from aica_api.services.event_plan import build_event_plan
    from aica_api.services.route_analysis import analyze_route
    from aica_api.services.tick_engine import advance_tick
    from aica_api.models.scenario import ScenarioDef
    from aica_api.models.run import RouteFacts, EventPlan

    existing = _load_json(_OUT / "tick_sequence.json")
    inp = existing["input"]
    scenario_raw = inp["scenario"]
    scenario = ScenarioDef.model_validate(scenario_raw)
    route_facts = RouteFacts.model_validate(inp["route_facts"])
    event_plan = EventPlan.model_validate(inp["event_plan"])
    run_seed = inp.get("run_seed", 0) or 0

    prior = None
    states = []
    for i in range(400):
        state = advance_tick(
            prior_state=prior,
            tick_index=i,
            event_plan=event_plan,
            route_facts=route_facts,
            scenario=scenario,
            run_seed=run_seed,
        )
        states.append(json.loads(state.model_dump_json()))
        prior = state
        if state.completed:
            break

    _write("tick_sequence", {
        "input": inp,
        "output": {"states": states},
    })


# ---------------------------------------------------------------------------
# 7. run_plan
# ---------------------------------------------------------------------------

def _capture_run_plan() -> None:
    from aica_api.services.run_plan import create_draft, clear_draft_registry
    from aica_api.models.scenario import ScenarioDef
    from aica_api.models.package import PackageManifest

    existing = _load_json(_OUT / "run_plan.json")
    inp = existing["input"]
    pkg_raw = inp["package"]
    pkg = PackageManifest.model_validate(pkg_raw)
    scenario_raw = inp["scenario"]
    scenario = ScenarioDef.model_validate(scenario_raw)
    plan_id = inp.get("plan_id", "fixture-plan-1")

    from aica_api.services.run_plan import get_draft_entry
    clear_draft_registry()
    create_draft(
        plan_id=plan_id,
        package=pkg,
        scenario=scenario,
        presets=inp.get("presets", {}),
        parameters=inp.get("parameters", {}),
        hyperparameters=inp.get("hyperparameters", {}),
    )
    entry = get_draft_entry(plan_id)
    assert entry is not None, f"No draft registered for plan_id={plan_id!r}"
    draft, eff_pkg, eff_scn = entry

    _write("run_plan", {
        "input": inp,
        "output": {
            "draft": json.loads(draft.model_dump_json()),
            "package": json.loads(eff_pkg.model_dump_json()),
            "scenario": json.loads(eff_scn.model_dump_json()),
        },
    })


# ---------------------------------------------------------------------------
# 8. run_log_e2e (real nri_fatigue_score_v1 package + generated scenario)
# ---------------------------------------------------------------------------
#
# Previously this reconstructed a synthetic `rest_rule_based_v0_1` package
# with algorithm.type='declarative_rule'. Feature 009 narrowed
# AlgorithmDef.type to Literal["python_module"], and the package itself no
# longer exists — that reconstruction is retired per the 021 ADR. This now
# runs the real, committed nri_fatigue_score_v1 package (packages/
# nri_fatigue_score_v1/package.json) against the real generated scenario
# (_SCENARIO_PATH), so the golden always matches what the offline app
# actually ships.
#
# Feature 025 added a MONOTONY_PROPOSAL path (threshold_monotony) that now
# fires before the drowsiness/fatigue-driven REST_PROPOSAL in this scenario.
# The driver loop below is proposal-type aware: it acknowledges/declines
# any non-REST_PROPOSAL pause and only calls accept_rest on the first
# genuine REST_PROPOSAL, so "accept_rest" in the captured log always means
# what it says.


def _capture_run_log_e2e() -> None:
    import tempfile
    from aica_api.services.run_plan import create_draft, clear_draft_registry
    from aica_api.services.run_manager import create_run, tick, action, get_active_run_log, clear_registry
    from aica_api.models.scenario import ScenarioDef
    from aica_api.models.package import PackageManifest
    from aica_api.models.run import RestSpot

    # Non-schema test parameters (which recovery option / rest spot / seed to
    # exercise) are preserved from the existing fixture; the package and
    # scenario themselves are always sourced fresh (see header comment above).
    existing = _load_json(_OUT / "run_log_e2e.json")
    prior_inp = existing.get("input", {})

    pkg_raw = _load_json(_PACKAGES_DIR / "nri_fatigue_score_v1" / "package.json")
    pkg = PackageManifest.model_validate(pkg_raw)
    scenario_raw = _load_json(_SCENARIO_PATH)
    scenario = ScenarioDef.model_validate(scenario_raw)
    recovery_option_id = prior_inp.get("recoveryOptionId", "nap_karaoke")
    rest_spot_raw = prior_inp.get("restSpot", {"id": "p1", "label": {"ja": "SA", "en": "SA"}, "lat": None, "lng": None, "route_fraction": 0.5})
    rest_spot = RestSpot.model_validate(rest_spot_raw)
    run_seed = prior_inp.get("run_seed", 0) or 0

    with tempfile.TemporaryDirectory() as runs_dir:
        runs_dir_path = pathlib.Path(runs_dir)
        clear_draft_registry()
        clear_registry()

        plan_id = "plan-e2e-test"
        create_draft(plan_id=plan_id, package=pkg, scenario=scenario, presets={}, parameters={}, hyperparameters={})

        run_id = "run-e2e-test"
        create_run(plan_id, run_id, runs_dir=runs_dir_path)

        accepted_once = False
        for _ in range(1000):
            outcome = tick(run_id)
            if outcome.completed:
                break
            if outcome.paused:
                proposal = outcome.decision.proposal if outcome.decision else None
                result_type = outcome.decision.result_type if outcome.decision else None
                if result_type == "REST_PROPOSAL" and not accepted_once:
                    action(run_id, "accept_rest",
                           recovery_option_id=recovery_option_id,
                           rest_spot=rest_spot)
                    accepted_once = True
                elif proposal is not None and "acknowledge" in proposal.options:
                    action(run_id, "acknowledge")
                else:
                    action(run_id, "decline")

        assert accepted_once, "no REST_PROPOSAL fired in run_log_e2e"
        run_log = get_active_run_log(run_id)
        assert run_log is not None

    output = json.loads(run_log.model_dump_json())
    # run_manager.create_run() stamps RunLog.created_at with wall-clock time
    # (aica_api/services/run_manager.py:545, _now_iso()) and takes no
    # timestamp parameter to override it — unlike build_evidence_report(),
    # which accepts an explicit `timestamp` (see _capture_evidence_fixtures,
    # frozen to "2026-07-01T00:00:00+00:00"). Freezing there is not an option
    # without editing run_manager.py, which must stay untouched (the Python
    # is the reference). created_at is documented wall-clock metadata, not a
    # decision input (see the module docstring above create_run), so it is
    # safe to normalize post hoc: overwrite it with the same frozen literal
    # used elsewhere in this rig so re-running the capture is a true no-op
    # instead of a permanent one-line timestamp diff on every run.
    output["created_at"] = "2026-07-01T00:00:00+00:00"

    _write("run_log_e2e", {
        "input": {
            "package": pkg_raw,
            "scenario": scenario_raw,
            # Preserved verbatim: this capture always runs with empty
            # overrides / standard mode (matches the create_draft() call
            # above). Several tests (replay/run_manager/feedback/rehydrate/
            # maps_client/expert_override) destructure these keys straight
            # out of fixture.input, so they must stay present even though
            # this function never varies them.
            "presets": prior_inp.get("presets", {}),
            "parameters": prior_inp.get("parameters", {}),
            "hyperparameters": prior_inp.get("hyperparameters", {}),
            "runMode": prior_inp.get("runMode", "standard"),
            "recoveryOptionId": recovery_option_id,
            "restSpot": rest_spot_raw,
            "run_seed": run_seed,
        },
        "output": output,
    })


# ---------------------------------------------------------------------------
# 9. route_analysis
# ---------------------------------------------------------------------------

def _capture_route_analysis() -> None:
    from aica_api.services.route_analysis import analyze_route
    from aica_api.models.scenario import ScenarioDef

    existing = _load_json(_OUT / "route_analysis.json")
    scenario_raw = existing["input"]["scenario"]
    scenario = ScenarioDef.model_validate(scenario_raw)
    result = analyze_route(scenario)

    _write("route_analysis", {
        "input": existing["input"],
        "output": json.loads(result.model_dump_json()),
    })


# ---------------------------------------------------------------------------
# 10. recovery
# ---------------------------------------------------------------------------

def _capture_recovery() -> None:
    from aica_api.services.recovery import start_recovery, advance_recovery
    from aica_api.models.run import RecoveryState, RestSpot
    from aica_api.models.scenario import RecoveryOption

    existing = _load_json(_OUT / "recovery.json")
    # recovery.json is an array of cases, each with {name, input, output}
    new_cases = []
    for case in existing:
        inp = case["input"]
        opt = RecoveryOption.model_validate(inp["option"])
        at_rest_spot = inp["atRestSpot"]

        if inp.get("start"):
            rest_spot_raw = inp["restSpot"]
            rest_spot = RestSpot.model_validate(rest_spot_raw)
            state = start_recovery(opt, rest_spot)
        else:
            state = RecoveryState.model_validate(inp["state"])

        out_state = advance_recovery(state, opt, at_rest_spot=at_rest_spot)
        new_cases.append({
            "name": case.get("name"),
            "input": inp,
            "output": json.loads(out_state.model_dump_json()),
        })

    _write("recovery", new_cases)


# ---------------------------------------------------------------------------
# 11. preview (via TestClient)
# ---------------------------------------------------------------------------

def _capture_preview() -> None:
    from fastapi.testclient import TestClient
    from aica_api.main import app

    existing = _load_json(_OUT / "preview.json")
    cases = existing["input"]["cases"]

    c = TestClient(app)
    results = []
    for case in cases:
        body = {
            "package_id": case["package_id"],
            "scenario_id": case["scenario_id"],
            "hyperparameter_overrides": case.get("hyperparameter_overrides", {}),
            "run_seed": case.get("run_seed", 0),
        }
        if case.get("rest_option_id") is not None:
            body["rest_option_id"] = case["rest_option_id"]
        r = c.post("/api/runs/preview", json=body)
        assert r.status_code == 200, f"preview failed: {r.status_code} {r.text}"
        results.append(r.json())

    _write("preview", {
        "input": existing["input"],
        "output": {"results": results},
    })


# ---------------------------------------------------------------------------
# 11b. preview_min_ahead — discriminates the two-stage MIN_AHEAD selection
#      used by the preview's auto-accept rest-spot pick (_pick_rest_spot)
# ---------------------------------------------------------------------------
#
# NOT built by extending _capture_preview() above: that function treats the
# existing preview.json's "input.cases" as the SOURCE OF TRUTH (it re-derives
# ONLY "output" from cases already committed in the golden), so adding a
# case there means hand-authoring fixture content rather than deriving it —
# exactly what "never edit an existing golden to make code pass" rules out
# in spirit, and a larger, riskier change to a function every other preview
# case still depends on. A dedicated capture (mirroring
# _capture_rest_spots_min_ahead's technique for the sibling endpoint) is
# strictly additive and leaves preview.json's regeneration untouched.

def _capture_preview_min_ahead() -> None:
    """Fixture exercising services/preview.py's `_pick_rest_spot` two-stage
    selection (`_PREVIEW_REST_MIN_AHEAD_KM` = 20km ahead stage, falling back
    to "anything ahead" only when stage 1 is empty) — the same blind spot
    `rest_spots.json` had before this task's earlier fix (task 3c) to the
    LIVE-RUN endpoint, still open here for the quickview/preview auto-accept
    path `_pick_rest_spot` serves.

    Same technique as `_capture_rest_spots_min_ahead`: two extra named rest
    spots are injected via the maps route_facts override, positioned near
    (+5km, inside the min-ahead band) and far (+40km, clears it) of the
    driver's position. Unlike that fixture, the position can't be derived
    from route physics alone — the preview's fire/auto-accept TICK is
    algorithm-driven (drowsiness/fatigue crossing a threshold), not a fixed
    tick count — so it is discovered from an UNMODIFIED probe run via
    `iter_preview_ticks` (the first `rest_required` proposal episode with a
    non-None rest_spot — the same tick and same `tick_state.distance_km`
    `_pick_rest_spot` is called with for both the yielded PreviewFireEvent
    and the accept step immediately after it), then verified — not assumed
    — unchanged by a self-check against the REAL (augmented) run below.
    """
    from fastapi.testclient import TestClient
    from aica_api.main import app
    from aica_api.config import settings
    from aica_api.services.preview import iter_preview_ticks
    from aica_api.services.route_analysis import analyze_route
    from aica_api.models.scenario import ScenarioDef

    c = TestClient(app)

    pkg_id = "nri_fatigue_score_v1"
    scn_id = "uc01_fatigue_recovery_v0_1"
    run_seed = 42

    scenario_raw = _load_json(_SCENARIO_PATH)
    scenario = ScenarioDef.model_validate(scenario_raw)
    route_facts = analyze_route(scenario)
    route_facts_dict = json.loads(route_facts.model_dump_json())

    # ── Probe: unmodified local route/package — find the tick at which the
    # FIRST rest_required proposal becomes actionable (a non-None rest_spot),
    # and the driver's real distance_km there.
    probe_accept_distance_km: float | None = None
    for ev in iter_preview_ticks(
        package_id=pkg_id,
        scenario_id=scn_id,
        hyperparameter_overrides={},
        run_seed=run_seed,
        rest_option_id=None,
        packages_dir=settings.packages_dir,
        scenarios_dir=settings.scenarios_dir,
    ):
        if ev.decision.selected_category == "rest_required" and ev.rest_spot is not None:
            probe_accept_distance_km = ev.tick_state.distance_km
            break
    assert probe_accept_distance_km is not None, (
        "probe preview never reached an actionable rest_required proposal — "
        "this fixture's near/far offsets need a different anchor tick."
    )

    near_km = probe_accept_distance_km + 5.0    # inside the 20km min-ahead band
    far_km = probe_accept_distance_km + 40.0    # clears the 20km min-ahead band

    route_facts_dict["named_rest_spots"] = route_facts_dict["named_rest_spots"] + [
        {"name": "Test Near Rest Area", "position_km": near_km, "lat": None, "lng": None, "synthetic": False},
        {"name": "Test Far Rest Area", "position_km": far_km, "lat": None, "lng": None, "synthetic": False},
    ]
    route_facts_dict["rest_spot_positions"] = route_facts_dict["rest_spot_positions"] + [near_km, far_km]
    route_facts_dict["route_source"] = "maps"

    body = {
        "package_id": pkg_id,
        "scenario_id": scn_id,
        "hyperparameter_overrides": {},
        "run_seed": run_seed,
        "route_source": "maps",
        "route_id": "route-0",
        "route_facts": route_facts_dict,
    }
    r = c.post("/api/runs/preview", json=body)
    assert r.status_code == 200, f"preview failed: {r.status_code} {r.text}"
    result = r.json()

    # Self-check: this fixture only earns its keep if it actually discriminates
    # stage 1 from a stage-2-only implementation. Stage 1 (correct) must never
    # auto-accept the near spot; a stage-2-only implementation would (it is
    # nearest, so it wins the sorted-ascending pick).
    assert result["error"] is None, f"unexpected preview error: {result['error']}"
    assert result["rest_spots"], "expected at least one auto-accepted rest spot"
    assert all(abs(s["at_km"] - near_km) > 1e-6 for s in result["rest_spots"]), (
        "expected the near spot (+5km ahead, inside the 20km min-ahead band) "
        "to never be auto-accepted -- got it in rest_spots. This fixture "
        "would not discriminate stage 1 from a stage-2-only implementation "
        "and needs its offsets revisited."
    )
    assert any(abs(s["at_km"] - far_km) < 1e-6 for s in result["rest_spots"]), (
        "expected the far spot (+40km ahead) to be auto-accepted at least once."
    )

    _write("preview_min_ahead", {
        "input": {
            "package_id": pkg_id,
            "scenario_id": scn_id,
            "hyperparameter_overrides": {},
            "run_seed": run_seed,
            "route_source": "maps",
            "route_id": "route-0",
            "route_facts": route_facts_dict,
        },
        "output": result,
    })


# ---------------------------------------------------------------------------
# 12. rest_spots (via TestClient, real nri_fatigue_score_v1 package)
# ---------------------------------------------------------------------------

def _capture_rest_spots() -> None:
    from fastapi.testclient import TestClient
    from aica_api.main import app

    c = TestClient(app)

    # The output only depends on run position + scenario rest spots, not the
    # algorithm itself — nri_fatigue_score_v1 is used because it is the real,
    # committed package (the earlier declarative_rule rest_rule_based_v0_1
    # package this used to reconstruct no longer exists — retired by feature 009).
    pkg_id = "nri_fatigue_score_v1"
    scn_id = "uc01_fatigue_recovery_v0_1"
    n_ticks = 5

    plan = c.post("/api/run-plans", json={"package_id": pkg_id, "scenario_id": scn_id})
    assert plan.status_code in (200, 201), f"run-plans failed: {plan.status_code}"
    plan_id = plan.json()["plan_id"]

    run = c.post("/api/runs", json={"plan_id": plan_id})
    assert run.status_code == 201, f"runs create failed: {run.status_code}"
    run_id = run.json()["run_id"]

    for _ in range(n_ticks):
        t = c.post(f"/api/runs/{run_id}/tick")
        assert t.status_code == 200, f"tick failed: {t.status_code}"
        body = t.json()
        if body.get("completed"):
            break
        if body.get("paused"):
            a = c.post(f"/api/runs/{run_id}/actions", json={"action": "decline"})
            assert a.status_code == 200, f"decline failed: {a.status_code}"

    # Default rest spots (no overrides)
    rs_default = c.get(f"/api/runs/{run_id}/rest-spots")
    assert rs_default.status_code == 200, f"rest-spots failed: {rs_default.status_code}"

    # Custom ceiling/spacing
    rs_custom = c.get(f"/api/runs/{run_id}/rest-spots?drowsiness_ceiling=5.0&min_distance_km=1.0")
    assert rs_custom.status_code == 200, f"rest-spots custom failed: {rs_custom.status_code}"

    # Load the bundled nri package manifest for the input section
    pkg_path = (_REPO / "packages" / pkg_id / "package.json")
    pkg_raw = _load_json(pkg_path)
    scenario_raw = _load_json(_SCENARIO_PATH)

    _write("rest_spots", {
        "input": {
            "package": pkg_raw,
            "scenario": scenario_raw,
            "n_ticks": n_ticks,
        },
        "output": {
            "default": rs_default.json(),
            "custom_ceiling_5_spacing_1": rs_custom.json(),
        },
    })


# ---------------------------------------------------------------------------
# 12b. rest_spots_min_ahead — discriminates the two-stage MIN_AHEAD selection
# ---------------------------------------------------------------------------

def _capture_rest_spots_min_ahead() -> None:
    """Fixture that exercises the TWO-STAGE selection in routers/runs.py's
    rest_spots_endpoint (stage 1: only candidates more than
    `_REST_SPOTS_MIN_AHEAD_KM` (20km) ahead of the driver; stage 2 fallback:
    "anything ahead" — used only when stage 1 is empty).

    Every OTHER rest_spots fixture drives a route with exactly one
    non-synthetic named rest spot, so stage 1 and the stage-2 fallback always
    pick the SAME candidate — no existing fixture can tell an implementation
    that only has stage 2 apart from one with both stages. This fixture
    injects two EXTRA named rest spots via the maps route-facts override
    (route_source="maps", same contract routers/run_plans.py validates and
    the offline `createDraft` mirrors), positioned relative to the driver's
    position after a known number of ticks:
      near @ +5km ahead  — inside the 20km min-ahead band; a correct stage-1
                            filter drops it. A stage-2-only implementation
                            offers it (and offers it FIRST, since it is
                            nearest).
      far  @ +40km ahead — clears the min-ahead band; the only spot a
                            correct implementation offers by default (the
                            scenario's own "Yuuko Roadside Station" @60km is
                            also >20km ahead, but the greedy spacing filter
                            then drops it as <20km from `far`).

    Driver position after `n_ticks` ticks is deterministic from route
    physics, NOT assumed: the loop below records the real `distance_km` from
    each tick response and the near/far offsets are computed from that
    recorded value, so this capture stays self-consistent even if the route
    physics ever change. A self-check further down asserts the fixture still
    discriminates (the near spot must be ABSENT from stage 1's output) —
    if a future change to route physics or defaults makes that assumption
    false, this capture fails loudly instead of silently degrading into a
    fixture that can no longer catch the bug it exists to catch.
    """
    from fastapi.testclient import TestClient
    from aica_api.main import app
    from aica_api.services.route_analysis import analyze_route
    from aica_api.models.scenario import ScenarioDef

    c = TestClient(app)

    pkg_id = "nri_fatigue_score_v1"
    scn_id = "uc01_fatigue_recovery_v0_1"
    n_ticks = 5

    scenario_raw = _load_json(_SCENARIO_PATH)
    scenario = ScenarioDef.model_validate(scenario_raw)
    route_facts = analyze_route(scenario)
    route_facts_dict = json.loads(route_facts.model_dump_json())

    plan = c.post("/api/run-plans", json={"package_id": pkg_id, "scenario_id": scn_id})
    assert plan.status_code in (200, 201), f"run-plans (probe) failed: {plan.status_code}"
    probe_plan_id = plan.json()["plan_id"]
    probe_run = c.post("/api/runs", json={"plan_id": probe_plan_id})
    assert probe_run.status_code == 201, f"runs create (probe) failed: {probe_run.status_code}"
    probe_run_id = probe_run.json()["run_id"]

    # ── Probe run: unmodified local route, purely to learn the deterministic
    # driver position after n_ticks (physics do not depend on named_rest_spots,
    # so this position is identical to the one the REAL fixture run below
    # reaches — verified by the self-check after the real run, not assumed).
    probe_distance_km: float | None = None
    for _ in range(n_ticks):
        t = c.post(f"/api/runs/{probe_run_id}/tick")
        assert t.status_code == 200, f"tick (probe) failed: {t.status_code}"
        body = t.json()
        probe_distance_km = body.get("distance_km", probe_distance_km)
        if body.get("completed"):
            break
        if body.get("paused"):
            a = c.post(f"/api/runs/{probe_run_id}/actions", json={"action": "decline"})
            assert a.status_code == 200, f"decline (probe) failed: {a.status_code}"
    assert probe_distance_km is not None, "probe run never advanced distance_km"

    near_km = probe_distance_km + 5.0    # inside the 20km min-ahead band
    far_km = probe_distance_km + 40.0    # clears the 20km min-ahead band

    route_facts_dict["named_rest_spots"] = route_facts_dict["named_rest_spots"] + [
        {"name": "Test Near Rest Area", "position_km": near_km, "lat": None, "lng": None, "synthetic": False},
        {"name": "Test Far Rest Area", "position_km": far_km, "lat": None, "lng": None, "synthetic": False},
    ]
    route_facts_dict["rest_spot_positions"] = route_facts_dict["rest_spot_positions"] + [near_km, far_km]
    route_facts_dict["route_source"] = "maps"

    # ── Real fixture run: same package/scenario, but with the augmented
    # route_facts injected via the maps override contract.
    plan2 = c.post("/api/run-plans", json={
        "package_id": pkg_id,
        "scenario_id": scn_id,
        "route_source": "maps",
        "route_id": "route-0",
        "route_facts": route_facts_dict,
    })
    assert plan2.status_code in (200, 201), f"run-plans failed: {plan2.status_code} {plan2.text}"
    plan_id = plan2.json()["plan_id"]

    run = c.post("/api/runs", json={"plan_id": plan_id})
    assert run.status_code == 201, f"runs create failed: {run.status_code}"
    run_id = run.json()["run_id"]

    last_distance_km: float | None = None
    for _ in range(n_ticks):
        t = c.post(f"/api/runs/{run_id}/tick")
        assert t.status_code == 200, f"tick failed: {t.status_code}"
        body = t.json()
        last_distance_km = body.get("distance_km", last_distance_km)
        if body.get("completed"):
            break
        if body.get("paused"):
            a = c.post(f"/api/runs/{run_id}/actions", json={"action": "decline"})
            assert a.status_code == 200, f"decline failed: {a.status_code}"

    assert last_distance_km is not None
    assert abs(last_distance_km - probe_distance_km) < 1e-9, (
        f"augmenting route_facts with extra rest spots changed the driver's "
        f"physical position after {n_ticks} ticks ({probe_distance_km}km -> "
        f"{last_distance_km}km) — the near/far offsets need to be computed "
        "from THIS run's own distance, not the probe run's."
    )

    rs_default = c.get(f"/api/runs/{run_id}/rest-spots")
    assert rs_default.status_code == 200, f"rest-spots failed: {rs_default.status_code}"
    default_body = rs_default.json()

    # Self-check: this fixture only earns its keep if it actually discriminates
    # stage 1 from a stage-2-only implementation. Stage 1 (correct) must
    # EXCLUDE the near spot; a stage-2-only implementation would include it
    # (and would include it FIRST, since it is nearest).
    assert default_body["rest_spots"], "expected at least one rest spot in the default output"
    assert all(s["label"]["en"] != "Test Near Rest Area" for s in default_body["rest_spots"]), (
        "expected the near spot (+5km ahead, inside the 20km min-ahead band) "
        "to be excluded by stage 1 -- got it in the output. This fixture "
        "would not discriminate stage 1 from a stage-2-only implementation "
        "and needs its offsets revisited."
    )
    assert any(s["label"]["en"] == "Test Far Rest Area" for s in default_body["rest_spots"]), (
        "expected the far spot (+40km ahead) to be present in the default output."
    )

    pkg_path = (_REPO / "packages" / pkg_id / "package.json")
    pkg_raw = _load_json(pkg_path)

    _write("rest_spots_min_ahead", {
        "input": {
            "package": pkg_raw,
            "scenario": scenario_raw,
            "route_facts": route_facts_dict,
            "n_ticks": n_ticks,
        },
        "output": {
            "default": default_body,
        },
    })


# ---------------------------------------------------------------------------
# 13. nri_fatigue_score_v1 (direct algorithm.evaluate call)
# ---------------------------------------------------------------------------

def _run_algorithm_over_ticks(alg_path: pathlib.Path, pkg_id: str) -> None:
    """Regenerate a python_module algorithm fixture by replaying recorded tick inputs.

    Per-tick signals/feature_groups/history are preserved as recorded — they
    are synthetic driving state, independent of the algorithm's hyperparameter
    schema. The hyperparameters (and parameters) dict is always refreshed to
    the package's CURRENT committed defaults (packages/<pkg_id>/package.json)
    rather than replayed verbatim: the recorded values go stale whenever a
    package adds/renames/retunes a hyperparameter (e.g. feature 025's
    threshold_fire 80->100 and the new threshold_monotony /
    monotony_saturation_min), and replaying a stale set either crashes
    evaluate() outright (missing required key) or silently exercises the
    algorithm against parameters nobody ships. The refreshed values are
    written back into the fixture's "input" so input and output stay
    self-consistent.
    """
    import importlib.util

    spec = importlib.util.spec_from_file_location(f"{pkg_id}_algorithm", alg_path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[attr-defined]
    evaluate = mod.evaluate

    pkg_raw = _load_json(_PACKAGES_DIR / pkg_id / "package.json")
    current_hyperparameters = {hp["key"]: hp["default"] for hp in pkg_raw.get("hyperparameters", [])}
    current_parameters = {p["key"]: p["default"] for p in pkg_raw.get("parameters", [])}

    existing = _load_json(_OUT / f"{pkg_id}.json")
    inp = existing["input"]
    ticks_input = inp["ticks"]

    pkg_runtime_state: dict = {}
    decisions_output = []
    refreshed_ticks = []

    for tick_ctx in ticks_input:
        refreshed_ctx = dict(tick_ctx)
        refreshed_ctx["hyperparameters"] = current_hyperparameters
        if "parameters" in refreshed_ctx:
            refreshed_ctx["parameters"] = current_parameters
        refreshed_ticks.append(refreshed_ctx)

        ctx = dict(refreshed_ctx)
        ctx["package_runtime_state"] = pkg_runtime_state
        decision = evaluate(ctx)
        if hasattr(decision, "model_dump_json"):
            dec_dict = json.loads(decision.model_dump_json())
        elif dataclasses.is_dataclass(decision):
            dec_dict = dataclasses.asdict(decision)
        else:
            dec_dict = dict(decision)
        decisions_output.append(dec_dict)
        pkg_runtime_state = dec_dict.get("next_package_runtime_state", {})

    _write(pkg_id, {
        "input": {**inp, "ticks": refreshed_ticks},
        "output": {"decisions": decisions_output},
    })


def _capture_nri_fatigue_score_v1() -> None:
    _run_algorithm_over_ticks(
        _PACKAGES_DIR / "nri_fatigue_score_v1" / "algorithm.py",
        "nri_fatigue_score_v1",
    )


# ---------------------------------------------------------------------------
# 14. aica_transparent_hybrid_trigger_v1 (direct algorithm.evaluate call)
# ---------------------------------------------------------------------------

def _capture_aica_transparent_hybrid_trigger_v1() -> None:
    _run_algorithm_over_ticks(
        _PACKAGES_DIR / "aica_transparent_hybrid_trigger_v1" / "algorithm.py",
        "aica_transparent_hybrid_trigger_v1",
    )


# ---------------------------------------------------------------------------
# 15. feedback
# ---------------------------------------------------------------------------

def _capture_feedback() -> None:
    from aica_api.services.feedback import effective_schema, validate
    from aica_api.models.package import PackageManifest, AlgorithmDef
    from aica_api.models.feedback import FeedbackEvent, FeedbackTarget

    existing = _load_json(_OUT / "feedback.json")
    inp = existing["input"]
    manifest_raw = inp["manifest"]
    # The fixture uses a synthetic test package with algorithm.type='declarative_rule',
    # which is no longer accepted by Pydantic validation (only 'python_module' is).
    # effective_schema() only reads package.id and package.feedback_schema,
    # so we use model_construct() to bypass algorithm.type validation.
    alg_raw = manifest_raw.get("algorithm", {})
    alg_type = alg_raw.get("type", "python_module")
    if alg_type != "python_module":
        alg_raw = {**alg_raw, "type": "python_module"}
    alg = AlgorithmDef.model_validate(alg_raw)
    pkg = PackageManifest.model_construct(
        id=manifest_raw["id"],
        version=manifest_raw.get("version", "0.1"),
        label=manifest_raw.get("label", {}),
        compatible_scenario_types=manifest_raw.get("compatible_scenario_types", ["uc01_fatigue"]),
        algorithm=alg,
        parameters=manifest_raw.get("parameters", []),
        hyperparameters=manifest_raw.get("hyperparameters", []),
        features=manifest_raw.get("features", []),
        trigger_categories=manifest_raw.get("trigger_categories", []),
        rules=manifest_raw.get("rules", []),
        fire_control=manifest_raw.get("fire_control"),
        proposals=manifest_raw.get("proposals", []),
        feedback_schema=manifest_raw.get("feedback_schema", []),
        evidence_metrics=manifest_raw.get("evidence_metrics", []),
    )

    schema = effective_schema(pkg)

    valid_body = inp["body"]
    invalid_body = inp["invalid_body"]

    valid_ev = FeedbackEvent(
        kind="feedback",
        target=FeedbackTarget(**valid_body["target"]),
        labels=valid_body["labels"],
        comment=valid_body.get("comment"),
    )

    invalid_ev = FeedbackEvent(
        kind="feedback",
        target=FeedbackTarget(**invalid_body["target"]),
        labels=invalid_body["labels"],
        comment=invalid_body.get("comment"),
    )

    # validate needs a run_log; use a minimal stub.
    # Both valid_body and invalid_body use scope='run' (no event_ref), so
    # the stub log's events list is never consulted.
    import datetime
    from aica_api.models.log import RunLog
    from aica_api.models.run import RouteFacts, EventPlan, Snapshot, ArtifactRef
    stub_log = RunLog(
        run_id="stub",
        created_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        simulator_version="0.0.0",
        snapshot=Snapshot(
            package=ArtifactRef(id="stub", version="0.0", hash="0"),
            scenario=ArtifactRef(id="stub", version="0.0", hash="0"),
        ),
        route_facts=RouteFacts(),
        event_plan=EventPlan(total_ticks=0, tick_seconds=180, ticks=[]),
        events=[],
    )

    valid_errors = validate(valid_ev, schema, stub_log)
    invalid_errors = validate(invalid_ev, schema, stub_log)

    _write("feedback", {
        "input": inp,
        "output": {
            "schema": [json.loads(f.model_dump_json()) for f in schema],
            "valid": len(valid_errors) == 0,
            "invalid_errors": [{"field": e.field, "message": e.message} for e in invalid_errors],
            "event": json.loads(valid_ev.model_dump_json()),
        },
    })


# ---------------------------------------------------------------------------
# 16. evidence_report + evidence_markdown + evidence_markdown_nri
# ---------------------------------------------------------------------------

def _capture_evidence_fixtures() -> None:
    import tempfile
    from aica_api.services.run_plan import create_draft, clear_draft_registry
    from aica_api.services.run_manager import create_run, tick, action, get_active_run_log, clear_registry, append_feedback
    from aica_api.services.evidence import build_evidence_report
    from aica_api.services.evidence_markdown import render_evidence_markdown
    from aica_api.models.scenario import ScenarioDef
    from aica_api.models.package import PackageManifest
    from aica_api.models.run import RestSpot
    from aica_api.models.feedback import FeedbackEvent, FeedbackTarget
    from aica_api.models.log import RunLog

    # Package + scenario are always sourced fresh from the committed sources
    # (packages/nri_fatigue_score_v1/package.json, _SCENARIO_PATH), not from
    # whatever was embedded in the previous capture of this fixture — see the
    # run_log_e2e header comment above for why replaying a stale package here
    # both drifts silently and crashes evaluate() (feature 025 added a
    # required threshold_monotony hyperparameter).
    pkg_raw = _load_json(_PACKAGES_DIR / "nri_fatigue_score_v1" / "package.json")
    pkg = PackageManifest.model_validate(pkg_raw)
    scenario_raw = _load_json(_SCENARIO_PATH)
    scenario = ScenarioDef.model_validate(scenario_raw)

    with tempfile.TemporaryDirectory() as runs_dir:
        runs_dir_path = pathlib.Path(runs_dir)
        clear_draft_registry()
        clear_registry()

        plan_id = "plan_evidence_fixture"
        create_draft(plan_id=plan_id, package=pkg, scenario=scenario, presets={}, parameters={}, hyperparameters={})

        run_id = "run_evidence_fixture"
        create_run(plan_id, run_id, runs_dir=runs_dir_path)

        recovery_option_id = "nap_karaoke"
        rest_spot = RestSpot(id="p1", label={"ja": "SA", "en": "SA"}, lat=None, lng=None, route_fraction=0.5)

        # Feature 025's MONOTONY_PROPOSAL fires before the drowsiness/fatigue
        # REST_PROPOSAL in this scenario — acknowledge/decline it and only
        # accept_rest on the first genuine REST_PROPOSAL, so proposal_tick_index
        # (used for the decision-scoped feedback event below) points at the
        # rest proposal, not an earlier monotony nudge.
        accepted_once = False
        proposal_tick_index = None
        for _ in range(1000):
            outcome = tick(run_id)
            if outcome.completed:
                break
            if outcome.paused:
                proposal = outcome.decision.proposal if outcome.decision else None
                result_type = outcome.decision.result_type if outcome.decision else None
                if result_type == "REST_PROPOSAL" and not accepted_once:
                    proposal_tick_index = outcome.evaluated_tick_index
                    action(run_id, "accept_rest",
                           recovery_option_id=recovery_option_id,
                           rest_spot=rest_spot)
                    accepted_once = True
                elif proposal is not None and "acknowledge" in proposal.options:
                    action(run_id, "acknowledge")
                else:
                    action(run_id, "decline")

        assert accepted_once, "no REST_PROPOSAL fired in evidence fixture run"

        # Append two feedback events (same as the fixture originally had)
        decision_feedback = FeedbackEvent(
            kind="feedback",
            target=FeedbackTarget(
                scope="decision",
                event_ref=proposal_tick_index,
                tick_index=proposal_tick_index,
            ),
            labels={"proposal_timing": "appropriate", "safety_impression": "safe"},
            comment="Felt like a natural moment to suggest a rest.",
        )
        run_feedback = FeedbackEvent(
            kind="feedback",
            target=FeedbackTarget(scope="run"),
            labels={"overall_judgment": "good_trigger"},
            comment=None,
        )
        append_feedback(run_id, decision_feedback)
        append_feedback(run_id, run_feedback)

        run_log = get_active_run_log(run_id)
        assert run_log is not None

        report = build_evidence_report(
            run_log,
            report_id="report_fixture_20260701-000000_abcdef",
            timestamp="2026-07-01T00:00:00+00:00",
            ui_language="en",
        )
        markdown = render_evidence_markdown(report)

        # Key exclusion guard
        report_str = json.dumps(report, ensure_ascii=False)
        assert "googleMapsApiKey" not in report_str
        assert "google_maps_api_key" not in report_str
        import re
        assert not re.search(r"AIza[0-9A-Za-z_-]{10,}", report_str)

        _write("evidence_report", {
            "input": {
                "package": pkg_raw,
                "scenario": scenario_raw,
                "parameters": {},
                "hyperparameters": {},
                "presets": {},
                "runMode": "standard",
                "recoveryOptionId": recovery_option_id,
                "restSpot": json.loads(rest_spot.model_dump_json()),
                "uiLanguage": "en",
                "feedback": {
                    "decision": json.loads(decision_feedback.model_dump_json()),
                    "run": json.loads(run_feedback.model_dump_json()),
                },
            },
            "output": report,
        })

        _write("evidence_markdown", {
            "input": report,
            "output": markdown,
        })

    # evidence_markdown_nri: SEPARATE NRI run (nri_fatigue_score_v1 +
    # uc01_fatigue_recovery_v0_1) with ALL REST_PROPOSAL pauses declined,
    # so the fixture is intentionally distinct from evidence_markdown.json.
    # This guards nri whole-number-float hyperparameter formatting:
    # e.g. w_child: 20.0, theta_sleep: 60.0, rest_cooldown_sec: 600.0 must
    # render as "20.0"/"60.0" not "20"/"60", while genuine-int hyperparameters
    # (max_proposals_per_30min: 3, persistence_ticks: 2) must stay as "3"/"2".
    _capture_evidence_markdown_nri()


def _capture_evidence_markdown_nri() -> None:
    import tempfile
    from aica_api.services.run_plan import create_draft, clear_draft_registry
    from aica_api.services.run_manager import create_run, tick, action, get_active_run_log, clear_registry
    from aica_api.services.evidence import build_evidence_report
    from aica_api.services.evidence_markdown import render_evidence_markdown
    from aica_api.models.package import PackageManifest

    pkg_path = (_REPO / "packages" / "nri_fatigue_score_v1" / "package.json")
    pkg_raw = _load_json(pkg_path)
    pkg = PackageManifest.model_validate(pkg_raw)

    scenario_raw = _load_json(_SCENARIO_PATH)
    from aica_api.models.scenario import ScenarioDef
    scenario = ScenarioDef.model_validate(scenario_raw)

    with tempfile.TemporaryDirectory() as runs_dir:
        runs_dir_path = pathlib.Path(runs_dir)
        clear_draft_registry()
        clear_registry()

        plan_id = "plan_evidence_nri_fixture"
        create_draft(plan_id=plan_id, package=pkg, scenario=scenario, presets={}, parameters={}, hyperparameters={})

        run_id = "run_evidence_nri_fixture"
        create_run(plan_id, run_id, runs_dir=runs_dir_path)

        # Decline ALL REST_PROPOSAL pauses — this produces a distinct run log
        # compared to evidence_markdown.json (which accepts one rest).
        declined_count = 0
        for _ in range(1000):
            outcome = tick(run_id)
            if outcome.completed:
                break
            if outcome.paused:
                action(run_id, "decline")
                declined_count += 1

        assert declined_count > 0, "no REST_PROPOSAL fired in evidence_markdown_nri run"

        run_log = get_active_run_log(run_id)
        assert run_log is not None

        nri_report = build_evidence_report(
            run_log,
            report_id="report_nri_fixture_20260701-000000_abcdef",
            timestamp="2026-07-01T00:00:00+00:00",
            ui_language="en",
        )
        nri_markdown = render_evidence_markdown(nri_report)

        # Key exclusion guard
        report_str = json.dumps(nri_report, ensure_ascii=False)
        assert "googleMapsApiKey" not in report_str
        assert "google_maps_api_key" not in report_str
        import re
        assert not re.search(r"AIza[0-9A-Za-z_-]{10,}", report_str)

        _write("evidence_markdown_nri", {
            "input": nri_report,
            "output": nri_markdown,
        })


# ---------------------------------------------------------------------------
# 17. nri_tick_by_tick (via TestClient — full NRI run, per-tick decision_result)
# ---------------------------------------------------------------------------

def _capture_nri_tick_by_tick() -> None:
    from fastapi.testclient import TestClient
    from aica_api.main import app

    c = TestClient(app)

    pkg_id = "nri_fatigue_score_v1"
    scn_id = "uc01_fatigue_recovery_v0_1"

    plan = c.post("/api/run-plans", json={"package_id": pkg_id, "scenario_id": scn_id})
    assert plan.status_code in (200, 201), f"run-plans failed: {plan.status_code}"
    plan_id = plan.json()["plan_id"]

    run = c.post("/api/runs", json={"plan_id": plan_id})
    assert run.status_code == 201, f"runs create failed: {run.status_code}"
    run_id = run.json()["run_id"]

    accepted_once = False
    accept_at_tick = None
    decisions = []

    for guard in range(400):
        t = c.post(f"/api/runs/{run_id}/tick")
        assert t.status_code == 200, f"tick failed: {t.status_code} {t.text}"
        body = t.json()

        if "error" in body:
            raise RuntimeError(f"algorithm_error at guard {guard}: {body['error']}")

        decision = body.get("decision")
        decisions.append(decision)

        if body.get("completed"):
            break

        if body.get("paused"):
            # Feature 025's MONOTONY_PROPOSAL fires before the drowsiness/
            # fatigue REST_PROPOSAL in this scenario — acknowledge/decline it
            # and only accept_rest on the first genuine REST_PROPOSAL, so
            # acceptAt always points at the rest proposal, not an earlier
            # monotony nudge.
            tick_index = body.get("tick_index")
            result_type = (decision or {}).get("result_type")
            options = ((decision or {}).get("proposal") or {}).get("options", [])
            if result_type == "REST_PROPOSAL" and not accepted_once:
                accept_at_tick = tick_index
                act_body = {
                    "action": "accept_rest",
                    "recovery_option_id": "nap_karaoke",
                    "rest_spot": {
                        "id": "p1",
                        "label": {"ja": "SA", "en": "SA"},
                        "lat": None,
                        "lng": None,
                        "route_fraction": 0.5,
                    },
                }
                a = c.post(f"/api/runs/{run_id}/actions", json=act_body)
                assert a.status_code == 200, f"accept_rest failed: {a.status_code}"
                accepted_once = True
            elif "acknowledge" in options:
                a = c.post(f"/api/runs/{run_id}/actions", json={"action": "acknowledge"})
                assert a.status_code == 200, f"acknowledge failed: {a.status_code}"
            else:
                a = c.post(f"/api/runs/{run_id}/actions", json={"action": "decline"})
                assert a.status_code == 200, f"decline failed: {a.status_code}"
    else:
        raise RuntimeError("nri run did not complete within 400 ticks")

    assert accepted_once, "no REST_PROPOSAL fired in nri_tick_by_tick run"
    print(f"    nri: {len(decisions)} ticks, acceptAt={accept_at_tick}")

    _write("nri_tick_by_tick", {
        "input": {
            "package": pkg_id,
            "scenario": scn_id,
            "acceptAt": accept_at_tick,
        },
        "output": {"decisions": decisions},
    })


# ---------------------------------------------------------------------------
# 18. service_selector (aica_transparent_service_selector_v1.algorithm.evaluate,
#     direct import over an 11-case representative set — C1 Task 4)
# ---------------------------------------------------------------------------
#
# Proposal-family package (package.json: kind/family="service_selector"), NOT
# wired to any trigger-side capture above and not yet dispatched by anything
# in the app — the proposal engine is a later slice (C2). Verified standalone
# by calling `evaluate(context)` directly, once per case (the package is
# stateless across calls: `next_package_runtime_state` is always `{}`, never
# consumed as an accumulator the way the trigger packages' state is).
#
# Every case is built from COMMITTED data: the package's own resolved
# defaults (packages/aica_transparent_service_selector_v1/package.json) and
# the SS10 worked-example fixture (proposal_contracts/fixtures/service/
# worked-example.json — hand-authored from docs/master/
# aica_transparent_service_proposal_algorithm.md SS10/SS11, "never
# score-derived", see that fixture's own _comment and its sibling
# contrast-*.json files) — the SAME committed sources
# app/api/tests/proposal/conftest.py's `build_service_context()` /
# `load_worked_example_context()` test harness draws from. That harness is
# NOT imported directly here — importing anything under app/api/tests/ risks
# the documented "tests/ package collision" gotcha (see htmlapp memory), so
# the same construction is re-derived below instead.
#
# The 11 cases were chosen to reach every semantically significant branch in
# evaluate() that a VALID (non-raising) call can reach — see the C1 Task 4
# report for the full per-branch coverage table. Deliberately EXCLUDED: the
# _RequestError/_ConfigError/_CatalogError raising paths (an invalid
# trigger_purpose/lifecycle_stage combination, a candidate outside
# allowed_service_ids or its stage family, a malformed response-coefficient
# override, ...) — calling evaluate() with one of those inputs raises an
# exception, which cannot be captured as a golden "success" case, exactly
# mirroring how nri_fatigue_score_v1 / aica_transparent_hybrid_trigger_v1's
# own strict hyperparameter accessors are never golden-exercised on their
# throwing path either. The TS port still mirrors those raises faithfully
# (see the report for how).

def _capture_service_selector() -> None:
    import copy
    import importlib.util

    pkg_id = "aica_transparent_service_selector_v1"
    pkg_raw = _load_json(_PACKAGES_DIR / pkg_id / "package.json")
    default_hp = {h["key"]: h["default"] for h in pkg_raw["hyperparameters"]}
    default_params = pkg_raw["parameters"]

    worked_raw = _load_json(
        _REPO / "proposal_contracts" / "fixtures" / "service" / "worked-example.json"
    )
    worked_raw = {k: v for k, v in worked_raw.items() if not k.startswith("_")}

    def worked_context(**overrides: object) -> dict:
        """Deep-copy the SS10 worked-example context, merge in the package's
        resolved defaults (the fixture never embeds config — see
        proposal_contracts/fixtures/service/README.md), apply overrides."""
        ctx = copy.deepcopy(worked_raw)
        ctx["parameters"] = copy.deepcopy(default_params)
        ctx["hyperparameters"] = copy.deepcopy(default_hp)
        ctx.update(copy.deepcopy(overrides))
        return ctx

    def base_context(
        *,
        trigger_purpose: str,
        lifecycle_stage: str,
        allowed_service_ids: list,
        eligible_candidates: list | None = None,
        excluded_candidates: list | None = None,
        feature_snapshot: dict | None = None,
        hyperparameters: dict | None = None,
        parameters: dict | None = None,
        opportunity_id: str = "opportunity-service-selector-fixture",
        simulation_time: str = "2026-08-01T12:00:00Z",
        run_seed: str = "seed-service-selector-fixture",
    ) -> dict:
        """Assemble a full SelectorInput-shaped context from scratch — mirrors
        app/api/tests/proposal/conftest.py's build_service_context() (not
        imported, see module note above)."""
        allowed = list(allowed_service_ids)
        if eligible_candidates is None:
            eligible_candidates = [{"candidate_id": sid} for sid in allowed]
        return {
            "contract_version": pkg_raw.get("contract_version", "1.0.0"),
            "schema_version": pkg_raw.get("schema_version", "1.0.0"),
            "opportunity_id": opportunity_id,
            "simulation_time": simulation_time,
            "trigger_purpose": trigger_purpose,
            "lifecycle_stage": lifecycle_stage,
            "allowed_service_ids": allowed,
            "selected_service_id": None,
            "feature_snapshot": feature_snapshot or {},
            "feature_provenance": {},
            "enabled_feature_extensions": [],
            "eligible_candidates": eligible_candidates,
            "excluded_candidates": excluded_candidates or [],
            "parameters": copy.deepcopy(parameters) if parameters is not None else copy.deepcopy(default_params),
            "hyperparameters": copy.deepcopy(hyperparameters) if hyperparameters is not None else copy.deepcopy(default_hp),
            "package_runtime_state": {},
            "catalog_version": "n/a",
            "run_seed": run_seed,
        }

    cases: list[tuple[str, dict]] = []

    # 1. worked_example — SS10's 6-candidate driving world, verbatim. Default
    # top_k=3 truncates 6 eligible candidates to 3; dominance preserved;
    # multi-row positive AND negative rationale.
    cases.append(("worked_example", worked_context()))

    # 2. tie_break_highway — call_response_driving & quiz share an IDENTICAL
    # service_response_profiles row on every FEATURE_ORDER feature (they
    # differ ONLY at road_response_profiles.mountain: -0.5 vs -1.0), and
    # neither has a preference/history table entry in the worked-example
    # snapshot, so every per-candidate (direct-feature) evidence term is
    # identically 0.0 (missing_neutral) for both. situation.road_type ==
    # "highway" (not mountain) here, so their two scores are bit-for-bit
    # IDENTICAL (verified empirically: both 0.4848812095032397). Exercises
    # the `scored.sort(key=lambda s: (-s["score"], s["candidate_id"]))` tuple
    # comparator (divergence hazard #2): candidate_id ascending must place
    # call_response_driving ('c') above quiz ('q').
    cases.append(("tie_break_highway", worked_context(
        allowed_service_ids=["call_response_driving", "quiz"],
        eligible_candidates=[{"candidate_id": "call_response_driving"}, {"candidate_id": "quiz"}],
    )))

    # 3. custom_weights_dominance_zero_weight — two independent hyperparameter
    # edits on the worked-example snapshot: (a) hierarchy_weights.Situation.
    # share -> 0.01 breaks the SS6.4 W_D*material_safety_gap > 2*W_L
    # invariant (still scores, never blocks — dominance.status ==
    # "dominance_not_guaranteed") AND pushes W_D below the default
    # safety_share_warning_floor (0.4) -> safety_share_warning == true too
    # (verified empirically: W_D == 0.3937 at share=0.01, vs 0.6329 at the
    # more modest 0.15 first tried — 0.15 alone triggers
    # dominance_not_guaranteed but NOT the separate safety_share_warning
    # flag, so both hyperparameter edits are pushed further to reach both
    # branches in one case rather than needing a 12th case); (b)
    # hierarchy_weights.Situation.subgroups.driving_environment.leaves.
    # night_state.share -> 0.0 makes that leaf's effective_weight EXACTLY
    # 0.0, so its contribution row's status == "zero_weight" for every
    # candidate.
    hp_edge = copy.deepcopy(default_hp)
    hp_edge["hierarchy_weights"]["Situation"]["share"] = 0.01
    hp_edge["hierarchy_weights"]["Situation"]["subgroups"]["driving_environment"]["leaves"]["night_state"]["share"] = 0.0
    cases.append(("custom_weights_dominance_zero_weight", worked_context(hyperparameters=hp_edge)))

    # 4. confidence_shrinkage_on — route_music/active_driving_content, the
    # opt-in confidence_shrinkage_v1 hyperparameter ON, THREE candidates so
    # all three _apply_confidence_shrinkage shapes appear in one case:
    #   - music_playlist: confidence PRESENT and exactly 1.0 — a whole-number
    #     float. Python's f-string `f"...[confidence={conf}]"` renders this
    #     "1.0" (float repr always shows a decimal point); a naive JS
    #     template-literal interpolation of the same number renders "1"
    #     (JS Number-to-string drops a trailing ".0") — this is the
    #     float->string-formatting divergence hazard, and this is the one
    #     case in the whole fixture set that actually exercises it (every
    #     other confidence value used below has a nonzero fractional part,
    #     which happens to format identically in both languages and would
    #     NOT have caught a naive port).
    #   - humming_karaoke: confidence PRESENT and fractional (0.2) — the
    #     "ordinary" shrink path.
    #   - quiz: confidence entry ABSENT entirely -> the missing-confidence
    #     branch (treated as 1.0, no shrink, hardcoded "(missing,
    #     disclosed)" text — a Python string literal, not an interpolated
    #     float, so no formatting hazard on that branch).
    # Also moves the two confidence fields out of unused_available_features
    # (scan_unused_snapshot_keys's confidence_shrinkage_on branch) and marks
    # every acceptance/recovery row's response_provenance ==
    # "confidence_shrinkage_v1".
    hp_shrink = copy.deepcopy(default_hp)
    hp_shrink["confidence_shrinkage_v1"] = True
    cases.append(("confidence_shrinkage_on", base_context(
        trigger_purpose="route_music",
        lifecycle_stage="active_driving_content",
        allowed_service_ids=["music_playlist", "humming_karaoke", "quiz"],
        feature_snapshot={
            "situation": {
                "drowsiness_level": 10, "fatigue_level": 15, "traffic_state": "congested",
                "road_type": "mountain", "night_state": "night", "monotony_level": 55,
                "route_tags": ["scenic_byway"], "destination_tags": [], "child_present": True,
                "multiple_passengers": False,
            },
            "preference": {"oshi_registered": True, "oshi_mode": "off"},
            "history": {
                "service_proposal_acceptance_rate": {"music_playlist": 60, "humming_karaoke": 60, "quiz": 60},
                "service_recovery_rate": {"music_playlist": 50, "humming_karaoke": 50, "quiz": 50},
            },
            "additional_proposed": {
                "service_proposal_acceptance_confidence": {"music_playlist": 1.0, "humming_karaoke": 0.2},
                "service_recovery_confidence": {},
            },
        },
        hyperparameters=hp_shrink,
    )))

    # 5. empty_eligible_no_proposal — allowed_service_ids/eligible_candidates
    # both empty -> decision_type == "no_proposal" (dominance/effective_weights/
    # resolved_config_versions are STILL populated on this path — pure
    # functions of the resolved weights, computed before the eligibility
    # check runs). excluded_candidates is non-empty here to verify the
    # straight passthrough.
    cases.append(("empty_eligible_no_proposal", base_context(
        trigger_purpose="inattentive_driving_prevention_recovery",
        lifecycle_stage="active_driving_content",
        allowed_service_ids=[],
        eligible_candidates=[],
        excluded_candidates=[{"candidate_id": "quiz", "platform_reason": "not_available_this_trip"}],
        feature_snapshot=worked_raw["feature_snapshot"],
    )))

    # 6. during_rest_stopped_structurally_empty — the documented limitation
    # (algorithm.py module docstring / package.json candidate_stage_family):
    # during_rest_stopped's candidate family is frozen EMPTY, so a caller can
    # only ever pass eligible_candidates=[] for this stage (anything else
    # raises _CatalogError) — this is the stage's ONLY reachable non-raising
    # shape, always no_proposal.
    cases.append(("during_rest_stopped_structurally_empty", base_context(
        trigger_purpose="rest_recommended",
        lifecycle_stage="during_rest_stopped",
        allowed_service_ids=[],
        eligible_candidates=[],
    )))

    # 7. unknown_tags_missing_fields — a sparse situation (fatigue_level/
    # traffic_state/night_state/monotony_level/child_present/
    # multiple_passengers all OMITTED) + empty preference/history/
    # additional_proposed -> "missing" status on every omitted scalar
    # feature and "missing_neutral" on all 5 direct candidate-indexed
    # features (incl. oshi_registered/oshi_mode entirely absent — which does
    # NOT trip the oshi-consistency check; only an explicit
    # oshi_registered=False + oshi_mode='on' does, and that combination is
    # deliberately never constructed anywhere in this fixture set — see the
    # report's hazard/branch notes). route_tags/destination_tags each carry
    # one unrecognized tag -> unused_available_features. Omitting
    # monotony_level specifically (rather than leaving it present, as an
    # earlier revision of this case did) ALSO exercises
    # derive_scene_ids's `isinstance(monotony, (int, float))` gate on its
    # FALSE branch — with no monotony value at all, the monotony:high/medium
    # scene-tag check is skipped entirely rather than evaluated against a
    # number; every other case always supplies a numeric monotony_level, so
    # this is the only place that branch is reached. (The 3 numeric-value
    # branches — >= high_min, medium_min..high_min, < medium_min — stay
    # covered elsewhere: worked_example, case 4, and cases 6/10/11
    # respectively, so removing monotony_level here costs no other
    # coverage.)
    cases.append(("unknown_tags_missing_fields", base_context(
        trigger_purpose="inattentive_driving_prevention_recovery",
        lifecycle_stage="active_driving_content",
        allowed_service_ids=["music_playlist", "humming_karaoke"],
        feature_snapshot={
            "situation": {
                "drowsiness_level": 50,
                "road_type": "local",
                "route_tags": ["highway", "unknown_tag_xyz"],
                "destination_tags": ["unknown_dest_tag"],
            },
            "preference": {},
            "history": {},
            "additional_proposed": {},
        },
    )))

    # 8. response_coefficient_override — SS4.2/SS12 customer edit:
    # music_playlist/drowsiness_level's default 0.0 (neutral_source_silent)
    # overridden to +0.6. Retains the ORIGINAL provenance and ADDS
    # customer_override.
    hp_override = copy.deepcopy(default_hp)
    hp_override["response_coefficient_overrides"] = {"music_playlist": {"drowsiness_level": 0.6}}
    cases.append(("response_coefficient_override", worked_context(
        allowed_service_ids=["music_playlist"],
        eligible_candidates=[{"candidate_id": "music_playlist"}],
        hyperparameters=hp_override,
    )))

    # 9. after_rest_content — rest_recommended/after_rest_before_restart, the
    # 5-candidate post-rest family (live_viewing/stretch_video/full_karaoke/
    # call_response_stopped/oshi_reexperience). road_type is OMITTED (a
    # stopped/post-rest snapshot commonly carries none) -> "missing" status
    # on the road row for every candidate; every candidate's
    # neutral_source_silent columns (traffic_state, night_state, ...) land on
    # "neutral" status (present, weighted, contributes exactly 0).
    cases.append(("after_rest_content", base_context(
        trigger_purpose="rest_recommended",
        lifecycle_stage="after_rest_before_restart",
        allowed_service_ids=["live_viewing", "stretch_video", "call_response_stopped", "full_karaoke", "oshi_reexperience"],
        feature_snapshot={
            "situation": {
                "drowsiness_level": 15, "fatigue_level": 20,
                "traffic_state": "normal", "night_state": "day", "monotony_level": 10,
                "route_tags": [], "destination_tags": [], "child_present": False,
                "multiple_passengers": False,
            },
            "preference": {"oshi_registered": False, "oshi_mode": "off"},
            "history": {
                "service_proposal_acceptance_rate": {"live_viewing": 60, "stretch_video": 40},
                "service_recovery_rate": {"live_viewing": 55, "stretch_video": 65},
            },
            "additional_proposed": {},
        },
    )))

    # 10. rest_recommended_before_rest — rest_recommended/before_rest_until_stop,
    # the same 6-candidate driving family as the worked example but a
    # DIFFERENT purpose_multipliers row (driver_state 1.4 vs 1.5, route_context
    # 1.0 vs 0.75, ...) and a fresh moderate-fatigue situation. route_tags/
    # destination_tags are OMITTED ENTIRELY (not even an empty list) — the
    # one case in the set that exercises resolve_scalar_evidence's "missing"
    # status for these two features specifically (every other case sets them
    # to a present list, empty or not — status "used" either way, per
    # algorithm.py: `status = "used" if present else "missing"`, independent
    # of whether the present value is actually a list).
    cases.append(("rest_recommended_before_rest", base_context(
        trigger_purpose="rest_recommended",
        lifecycle_stage="before_rest_until_stop",
        allowed_service_ids=["music_playlist", "humming_karaoke", "call_response_driving", "quiz", "ranking_creation", "radio_style"],
        feature_snapshot={
            "situation": {
                "drowsiness_level": 55, "fatigue_level": 50, "traffic_state": "normal",
                "road_type": "local", "night_state": "day", "monotony_level": 30,
                "child_present": False,
                "multiple_passengers": False,
            },
            "preference": {"oshi_registered": False, "oshi_mode": "off"},
            "history": {},
            "additional_proposed": {},
        },
    )))

    # 11. child_passenger_experience — the 4th purpose (never exercised by
    # the other 10 cases), with child_present/multiple_passengers both true
    # -> the passenger_composition subgroup's 5.0x multiplier dominates.
    cases.append(("child_passenger_experience", base_context(
        trigger_purpose="child_passenger_experience",
        lifecycle_stage="active_driving_content",
        allowed_service_ids=["music_playlist", "humming_karaoke", "call_response_driving", "quiz", "ranking_creation", "radio_style"],
        feature_snapshot={
            "situation": {
                "drowsiness_level": 20, "fatigue_level": 15, "traffic_state": "normal",
                "road_type": "highway", "night_state": "day", "monotony_level": 20,
                "route_tags": [], "destination_tags": [], "child_present": True,
                "multiple_passengers": True,
            },
            "preference": {"oshi_registered": False, "oshi_mode": "off"},
            "history": {},
            "additional_proposed": {},
        },
    )))

    spec = importlib.util.spec_from_file_location(
        "aica_service_selector_v1_algorithm", _PACKAGES_DIR / pkg_id / "algorithm.py"
    )
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[attr-defined]
    evaluate = mod.evaluate

    results = []
    for name, ctx in cases:
        decision = evaluate(ctx)
        results.append({"name": name, "decision": decision})

    _write("service_selector", {
        "input": {"cases": [{"name": name, "context": ctx} for name, ctx in cases]},
        "output": {"results": results},
    })


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

CAPTURES = [
    ("binning", _capture_binning),
    ("driver_signals", _capture_driver_signals),
    ("anomaly", _capture_anomaly),
    ("prng", _capture_prng),
    ("event_plan", _capture_event_plan),
    ("tick_sequence", _capture_tick_sequence),
    ("run_plan", _capture_run_plan),
    ("run_log_e2e", _capture_run_log_e2e),
    ("route_analysis", _capture_route_analysis),
    ("recovery", _capture_recovery),
    ("preview", _capture_preview),
    ("preview_min_ahead", _capture_preview_min_ahead),
    ("rest_spots", _capture_rest_spots),
    ("rest_spots_min_ahead", _capture_rest_spots_min_ahead),
    ("nri_fatigue_score_v1", _capture_nri_fatigue_score_v1),
    ("aica_transparent_hybrid_trigger_v1", _capture_aica_transparent_hybrid_trigger_v1),
    ("feedback", _capture_feedback),
    ("evidence_report+evidence_markdown", _capture_evidence_fixtures),
    ("evidence_markdown_nri", _capture_evidence_markdown_nri),
    ("nri_tick_by_tick", _capture_nri_tick_by_tick),
    ("service_selector", _capture_service_selector),
]

if __name__ == "__main__":
    # If specific fixture names are passed on the command line, run only those.
    targets = set(sys.argv[1:]) if len(sys.argv) > 1 else None

    for name, fn in CAPTURES:
        if targets and name not in targets:
            continue
        print(f"[{name}]")
        fn()

    print("\nAll captures complete.")
