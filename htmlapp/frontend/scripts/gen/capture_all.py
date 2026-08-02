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
    content_selector.json     — packages/aica_transparent_content_selector_v1/algorithm.evaluate
                                  (direct import, 21-case representative set; C1 Task 5, fix round 1)
    proposal_eligibility.json — services/proposal_eligibility.resolve_eligibility /
                                  derive_registered_entities (direct import; C2 Task 2)
    algorithm_config.json     — services/algorithm_config.merge_algorithm_config (direct import; C2 Task 2)
    world_validation.json     — services/world_validation.validate_world (direct import,
                                  real committed seed + dataset catalog; C2 Task 2)
    world_overrides.json      — services/world_clone_store.apply_overrides, success + raising
                                  cases (direct import, real committed seed + dataset catalog; C2 Task 2)
    proposal_selector_dispatch.json — services/proposal_selector.dispatch_selector, both
                                  families' success path (direct import, real committed packages; C2 Task 3)
    proposal_run_manager.json — services/proposal_run_manager's 8 public functions, one
                                  scripted scenario (direct import; C2 Task 4)

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
# 19. content_selector (aica_transparent_content_selector_v1.algorithm.evaluate,
#     direct import over a representative case set — C1 Task 5)
# ---------------------------------------------------------------------------
#
# Proposal-family package (package.json: kind/family="content_selector"), NOT
# wired to any trigger-side capture above and not yet dispatched by anything
# in the app — the proposal engine is a later slice (C2). Verified standalone
# by calling `evaluate(context)` directly, once per case.
#
# Most cases are built from the small, committed `smoke-catalog.json` fixture
# (6 hand-authored songs, proposal_contracts/fixtures/catalog/smoke-catalog.json
# — the SAME fixture app/api/tests/proposal's own content-selector test suite
# uses) so each case's expected outcome is easy to reason about by hand. ONE
# case (`real_dataset_slice`) instead uses the real, large song catalog
# (proposal_contracts/dataset/soundcharts-grounded-.../catalog.json, 300
# songs) SLICED DOWN to the first 10 entries plus a matching slice of
# genre_affinity_v1.json (only the artist ids actually credited on those 10
# songs) — bounding it at 10 keeps the fixture reviewable (roughly ~1000
# lines of embedded real Spotify-shaped JSON, vs. ~30,000 for the full
# catalog) while still exercising the real schema's extra fields (images,
# external_urls, analysis_url, ...) that the algorithm must safely ignore,
# and giving genuine ranking diversity across real audio features.
#
# Unlike aica_transparent_service_selector_v1 (C1 Task 4), content_selector's
# evaluate() CATCHES its own _ConfigError/_CatalogError internally and
# returns a structured decision_type ("invalid_configuration"/
# "invalid_catalog") rather than raising — so those ARE golden-capturable
# "success" (non-throwing) cases here, unlike the service selector's raise
# paths. See the C1 Task 5 report for the full per-branch coverage table and
# for which hyperparameter-key accesses are NOT caught by evaluate() at all
# (bare Python KeyError, uncaught) — those remain deliberately unverified by
# this golden (a raising call can't be captured as a golden "success" case)
# and are instead covered by tests/content_selector_validation.test.ts.

def _capture_content_selector() -> None:
    import copy
    import importlib.util

    pkg_id = "aica_transparent_content_selector_v1"
    pkg_raw = _load_json(_PACKAGES_DIR / pkg_id / "package.json")
    default_hp = {h["key"]: h["default"] for h in pkg_raw["hyperparameters"]}
    default_params = pkg_raw["parameters"]

    dispositions_raw = _load_json(_REPO / "proposal_contracts" / "dispositions" / "content_feature_dispositions.v1.json")
    dispositions = dispositions_raw["entries"]

    smoke_list = _load_json(_REPO / "proposal_contracts" / "fixtures" / "catalog" / "smoke-catalog.json")

    def smoke_catalog() -> dict:
        return {song["spotify_track"]["id"]: copy.deepcopy(song) for song in smoke_list}

    def base_context(
        *,
        selected_service_id: str = "music_playlist",
        trigger_purpose: str = "rest_recommended",
        lifecycle_stage: str = "before_rest_until_stop",
        feature_snapshot: dict,
        enabled_feature_extensions: list | None = None,
        eligible_candidates: list | None = None,
        excluded_candidates: list | None = None,
        hyperparameters: dict | None = None,
        parameters: dict | None = None,
        simulation_time: str = "2026-07-14T22:10:00Z",
        catalog_version: str = "smoke-1",
    ) -> dict:
        """Assemble a runtime context dict for the content selector. Mirrors
        app/api/tests/proposal/conftest.py's build_content_context() (not
        imported directly, to avoid the documented tests/-package-collision
        gotcha — the same construction is re-derived here, exactly like
        _capture_service_selector does for its own sibling harness)."""
        catalog = feature_snapshot.get("catalog", {})
        if eligible_candidates is None:
            eligible_candidates = [{"candidate_id": tid} for tid in catalog]
        return {
            "contract_version": pkg_raw.get("contract_version", "1.0.0"),
            "opportunity_id": "opportunity-content-selector-fixture",
            "simulation_time": simulation_time,
            "trigger_purpose": trigger_purpose,
            "lifecycle_stage": lifecycle_stage,
            "allowed_service_ids": [selected_service_id],
            "selected_service_id": selected_service_id,
            "feature_snapshot": feature_snapshot,
            "feature_provenance": {},
            "enabled_feature_extensions": enabled_feature_extensions or [],
            "eligible_candidates": eligible_candidates,
            "excluded_candidates": excluded_candidates or [],
            "parameters": copy.deepcopy(parameters) if parameters is not None else copy.deepcopy(default_params),
            "hyperparameters": copy.deepcopy(hyperparameters) if hyperparameters is not None else copy.deepcopy(default_hp),
            "package_runtime_state": {},
            "feature_dispositions": dispositions,
            "catalog_version": catalog_version,
            "run_seed": "seed-content-selector-fixture",
        }

    cases: list[tuple[str, dict]] = []

    # 1. baseline_complete_plan — smoke catalog (6 songs), music_playlist,
    # driving, extension OFF (every genre-gated leaf must land context_only),
    # rich situation/preference/history so drowsiness/fatigue/monotony/
    # traffic/road/night/motion/age/item_usage/played/acceptance/recovery are
    # all "used"; oshi_registered=False (gate=0, the FIRST of 3 distinct oshi
    # gate=0 shapes exercised across this case set). plan_item_count=5 over 6
    # eligible candidates -> non-empty scored_tail (1) with a real cut_margin.
    # music_playlist is not in lighting_compatible_services -> lighting=None.
    #
    # Fix round 1: this case ALSO carries every `_played_evidence` time
    # bucket (algorithm.py:434-452, previously only `le_7d` was reached) and
    # 3 of the remaining 4 `_era_bucket` shapes (algorithm.py:189-206,
    # previously only 2010s/2020s were reached, via distinct songs' own
    # `album.release_date`), reusing this case's already-populated
    # preference/catalog rather than adding new cases:
    #   - track1001: played le_30m (20 min before sim_time -> <=1800s).
    #   - track1002: played today (~12h10m before -> >1800s, <=86400s) AND
    #     release_date moved to 1975 -> pre1980 era bucket.
    #   - track1004: played le_7d (UNCHANGED from before this fix -> >86400s,
    #     <=604800s) AND release_date corrupted to a non-empty, non-parseable
    #     string -> `_era_bucket`'s `int(str(release_date)[:4])` raises
    #     ValueError, caught, returns None -> the "band present but era
    #     unresolvable" branch (distinct from "no release_date at all").
    #   - track1006: played else (44 days before -> >604800s) AND release_date
    #     moved to 1985 -> 1980s era bucket.
    # track1003/1005 keep their existing acceptance/recovery-only roles,
    # untouched. (1990s/2000s era buckets are exercised by `real_dataset_slice`
    # below — see the coverage table.)
    cat1 = smoke_catalog()
    cat1["synthetic-track-1002"]["spotify_track"]["album"]["release_date"] = "1975-06-01"
    cat1["synthetic-track-1004"]["spotify_track"]["album"]["release_date"] = "not-a-parseable-date"
    cat1["synthetic-track-1006"]["spotify_track"]["album"]["release_date"] = "1985-03-01"
    cases.append(("baseline_complete_plan", base_context(
        selected_service_id="music_playlist",
        trigger_purpose="rest_recommended",
        lifecycle_stage="before_rest_until_stop",
        feature_snapshot={
            "catalog": cat1,
            "situation": {
                "drowsiness_level": 70, "fatigue_level": 40, "monotony_level": 50,
                "traffic_state": "congested", "road_type": "highway", "night_state": "night",
                "motion_state": "driving", "route_tags": ["highway", "unknown_tag_xyz"],
                "destination_tags": ["resort"], "child_present": False, "multiple_passengers": False,
            },
            "preference": {
                "age_band": "30s", "oshi_registered": False, "oshi_mode": "off",
                "catalog_item_usage_level": {"synthetic-track-1002": "high"},
                "hobby_interest_tags": ["anime-fan"],
                "played_items": [
                    {"track_id": "synthetic-track-1001", "last_played_at": "2026-07-14T21:50:00Z"},
                    {"track_id": "synthetic-track-1002", "last_played_at": "2026-07-14T10:00:00Z"},
                    {"track_id": "synthetic-track-1004", "last_played_at": "2026-07-13T20:00:00Z"},
                    {"track_id": "synthetic-track-1006", "last_played_at": "2026-06-01T00:00:00Z"},
                ],
                "changed_from_items": [],
            },
            "history": {
                "content_proposal_acceptance_rate": {"synthetic-track-1003": 80},
                "content_recovery_rate": {"synthetic-track-1005": 30},
            },
        },
    )))

    # 2. humming_genre_oshi_on — humming_karaoke, genre_affinity_v1 ON with
    # REAL matches on all 6 genre-gated leaves (route/destination/child/
    # hobbies/genre_usage/scene_genre), oshi ON with a match, AND a
    # multi-artist-credited clone song exercising the "MAX not sum" oshi
    # comment (algorithm.py:366-372) directly: two credited artists both
    # registered as oshi at different enthusiasm levels on the SAME track.
    # service_ease -> humming_ease; mode.fixed_segment_sec; humming_karaoke IS
    # lighting-compatible. plan_item_count=4 over 6 -> tail of 2.
    cat2 = smoke_catalog()
    # track1003 gets a second credited artist (also an oshi, lower enthusiasm)
    # to exercise "two oshi on one song -> max, not sum".
    cat2["synthetic-track-1003"]["spotify_track"]["artists"].append(
        {"id": "synthetic-artist-9002", "name": "Second Oshi", "type": "artist", "uri": "spotify:artist:synthetic-artist-9002"}
    )
    cases.append(("humming_genre_oshi_on", base_context(
        selected_service_id="humming_karaoke",
        trigger_purpose="route_music",
        lifecycle_stage="active_driving_content",
        enabled_feature_extensions=["genre_affinity_v1"],
        feature_snapshot={
            "catalog": cat2,
            "situation": {
                "drowsiness_level": 30, "fatigue_level": 20, "monotony_level": 40,
                "traffic_state": "normal", "road_type": "highway", "night_state": "day",
                "motion_state": "driving", "route_tags": ["highway"], "destination_tags": ["resort"],
                "child_present": True, "multiple_passengers": False,
            },
            "preference": {
                "oshi_registered": True, "oshi_mode": "on",
                "oshi_artists": [
                    {"artist_id": "synthetic-artist-1003", "enthusiasm": 0.4, "oshi_type": "artist"},
                    {"artist_id": "synthetic-artist-9002", "enthusiasm": 0.9, "oshi_type": "artist"},
                ],
                "hobby_interest_tags": ["anime-fan"],
                "age_band": "20s",
            },
            "history": {},
            "current_scene": "monotony:medium",
            "genre_affinity_v1": {
                "artist_genres": {
                    "synthetic-artist-1003": ["j-rock"],
                    "synthetic-artist-9002": ["j-rock"],
                },
                "usage_by_genre": {"j-rock": "high", "city pop": "med"},
                "scene_genre_usage": {"monotony:medium": {"j-rock": "high"}},
            },
        },
        hyperparameters={**default_hp, "plan_item_count": 4},
    )))

    # 3. full_karaoke_stopped_directional_keep_alert — full_karaoke, stopped
    # (required), directional_hypothesis="keep_alert" (flips fatigue/
    # traffic/night alphas; the default "soothe_destress" never flips, only
    # exercised by cases that DON'T override it, e.g. case 1/2 above).
    # oshi_registered=True but oshi_mode="off" -> gate=0, the SECOND distinct
    # oshi gate=0 shape (case 1 was registered=False; this one is
    # mode=off). service_ease -> full_karaoke_ease. plan_item_count=4 over 6
    # -> tail of 2.
    cat3 = smoke_catalog()
    cases.append(("full_karaoke_stopped_directional_keep_alert", base_context(
        selected_service_id="full_karaoke",
        trigger_purpose="rest_recommended",
        lifecycle_stage="after_rest_before_restart",
        feature_snapshot={
            "catalog": cat3,
            "situation": {
                "drowsiness_level": 20, "fatigue_level": 60, "monotony_level": 20,
                "traffic_state": "congested", "road_type": "mountain", "night_state": "night",
                "motion_state": "stopped", "route_tags": [], "destination_tags": [],
                "child_present": False, "multiple_passengers": True,
            },
            "preference": {"oshi_registered": True, "oshi_mode": "off"},
            "history": {},
        },
        hyperparameters={**default_hp, "plan_item_count": 4, "directional_hypothesis": "keep_alert"},
    )))

    # 4. full_karaoke_driving_refused — full_karaoke while still driving ->
    # decision_type "full_karaoke_requires_stopped" BEFORE any scoring; mode
    # still reflects full_karaoke's own plan_mode (stopped_only/
    # simulated_queue True) even though the decision blocked.
    cases.append(("full_karaoke_driving_refused", base_context(
        selected_service_id="full_karaoke",
        feature_snapshot={"catalog": smoke_catalog(), "situation": {"motion_state": "driving"}},
    )))

    # 5. invalid_request_missing_service — selected_service_id is None ->
    # decision_type "invalid_request"; mode/selected_service_id fall back to
    # "music_playlist" (service_id not in _MUSIC_SERVICES).
    cases.append(("invalid_request_missing_service", base_context(
        selected_service_id="music_playlist",  # placeholder for allowed_service_ids
        feature_snapshot={"catalog": smoke_catalog(), "situation": {"motion_state": "driving"}},
    )))
    cases[-1] = (cases[-1][0], {**cases[-1][1], "selected_service_id": None})

    # 6. unsupported_recipe — selected_service_id is a non-music recipe ->
    # decision_type "unsupported_recipe"; same fallback mode as case 5.
    cases.append(("unsupported_recipe", base_context(
        selected_service_id="music_playlist",
        feature_snapshot={"catalog": smoke_catalog(), "situation": {"motion_state": "driving"}},
    )))
    cases[-1] = (cases[-1][0], {**cases[-1][1], "selected_service_id": "quiz"})

    # 7. invalid_catalog_unknown_candidate — an eligible_candidate id that is
    # NOT a key in feature_snapshot.catalog -> _CatalogError caught ->
    # decision_type "invalid_catalog". excluded_items on THIS path is always
    # [] (the _error() helper never merges in the partially-accumulated
    # excluded_items — a real divergence-prone detail, see the port's module
    # doc), verified even though excluded_candidates is non-empty below.
    cases.append(("invalid_catalog_unknown_candidate", base_context(
        feature_snapshot={"catalog": smoke_catalog(), "situation": {"motion_state": "stopped"}},
        eligible_candidates=[{"candidate_id": "synthetic-track-DOES-NOT-EXIST"}],
        excluded_candidates=[{"candidate_id": "some-other-id", "platform_reason": "not_available_this_trip"}],
    )))

    # 8. invalid_catalog_missing_audio_field — one song's spotify_audio_features
    # is missing a required field (energy) -> _CatalogError from
    # _audio_components, caught -> decision_type "invalid_catalog" (a
    # DIFFERENT raise site than case 7, same outer except/decision_type).
    cat8 = smoke_catalog()
    del cat8["synthetic-track-1001"]["spotify_audio_features"]["energy"]
    cases.append(("invalid_catalog_missing_audio_field", base_context(
        feature_snapshot={"catalog": cat8, "situation": {"motion_state": "stopped"}},
    )))

    # 9. invalid_configuration_zero_denominator — content_category_weights
    # all zeroed -> raw_total <= 0 -> _ConfigError caught -> decision_type
    # "invalid_configuration".
    hp_zero = copy.deepcopy(default_hp)
    hp_zero["content_category_weights"] = {"Situation": 0.0, "Preference": 0.0, "History": 0.0}
    cases.append(("invalid_configuration_zero_denominator", base_context(
        feature_snapshot={"catalog": smoke_catalog(), "situation": {"motion_state": "stopped"}},
        hyperparameters=hp_zero,
    )))

    # 10. insufficient_eligible_items — 3 candidates (1 explicitly excluded
    # via not_playable, so excluded_items carries a REAL entry -- unlike
    # cases 7-9's always-[] excluded_items, this path's excluded_items IS the
    # accumulated list), default plan_item_count=5 -> only 2 scored ->
    # decision_type "insufficient_eligible_items".
    cat10 = smoke_catalog()
    small10 = {k: cat10[k] for k in ["synthetic-track-1001", "synthetic-track-1002", "synthetic-track-1003"]}
    small10["synthetic-track-1002"]["spotify_track"]["is_playable"] = False
    cases.append(("insufficient_eligible_items", base_context(
        feature_snapshot={"catalog": small10, "situation": {"motion_state": "stopped"}},
    )))

    # 11. no_proposal_all_excluded — every catalog song not_playable ->
    # decision_type "no_proposal"; excluded_items = context-provided
    # excluded_candidates PASSTHROUGH ++ the 6 catalog-loop exclusions (the
    # Python dict-union `_error(...) | {"excluded_items": ...}` merge).
    cat11 = smoke_catalog()
    for song in cat11.values():
        song["spotify_track"]["is_playable"] = False
    cases.append(("no_proposal_all_excluded", base_context(
        feature_snapshot={"catalog": cat11, "situation": {"motion_state": "stopped"}},
        excluded_candidates=[{"candidate_id": "ext-1", "platform_reason": "not_available_this_trip"}],
    )))

    # 12. eligibility_reasons_bundle — one case exercising EVERY
    # eligibility_reasons() branch at once (algorithm.py:484-522, exact
    # append order): explicit_under_child (1001), not_playable (1002),
    # market_unavailable (1003), restricted (1004), recent_skip (1005),
    # older_skip -- scored -0.5, NOT excluded -- + duplicate (1006, listed
    # twice), identity_mismatch (a fresh clone, 1099: audio_features
    # duration_ms deliberately differs from spotify_track duration_ms).
    # Exactly ONE clean candidate (1006) remains -> plan_item_count=1 ->
    # decision_type "complete_plan" with an EMPTY scored_tail (the
    # "everything scored was picked" branch, distinct from case 1's non-empty
    # tail) despite 7 of 8 listed candidates being excluded.
    cat12 = smoke_catalog()
    cat12["synthetic-track-1001"]["spotify_track"]["explicit"] = True
    cat12["synthetic-track-1002"]["spotify_track"]["is_playable"] = False
    cat12["synthetic-track-1003"]["spotify_track"]["available_markets"] = ["US"]
    cat12["synthetic-track-1004"]["spotify_track"]["restrictions"] = {"reason": "market"}
    clone99 = copy.deepcopy(cat12["synthetic-track-1001"])
    clone99["spotify_track"]["id"] = "synthetic-track-1099"
    clone99["spotify_track"]["uri"] = "spotify:track:synthetic-track-1099"
    clone99["spotify_track"]["explicit"] = False
    clone99["spotify_audio_features"]["id"] = "synthetic-track-1099"
    clone99["spotify_audio_features"]["uri"] = "spotify:track:synthetic-track-1099"
    clone99["spotify_audio_features"]["duration_ms"] = 999999  # != spotify_track.duration_ms -> identity_mismatch
    cat12["synthetic-track-1099"] = clone99
    cases.append(("eligibility_reasons_bundle", base_context(
        feature_snapshot={
            "catalog": cat12,
            "market": "JP",
            "situation": {
                "drowsiness_level": 60, "fatigue_level": 20, "monotony_level": 30,
                "traffic_state": "normal", "road_type": "local", "night_state": "day",
                "motion_state": "driving", "child_present": True,
            },
            "preference": {
                "skipped_items": [
                    {"track_id": "synthetic-track-1005", "skipped_at": "2026-07-14T21:50:00Z"},  # 20 min before -> in-window
                    {"track_id": "synthetic-track-1006", "skipped_at": "2026-06-01T00:00:00Z"},   # weeks before -> older, scored
                ],
            },
            "history": {},
        },
        eligible_candidates=[
            {"candidate_id": "synthetic-track-1001"},
            {"candidate_id": "synthetic-track-1002"},
            {"candidate_id": "synthetic-track-1003"},
            {"candidate_id": "synthetic-track-1004"},
            {"candidate_id": "synthetic-track-1005"},
            {"candidate_id": "synthetic-track-1006"},
            {"candidate_id": "synthetic-track-1006"},
            {"candidate_id": "synthetic-track-1099"},
        ],
        hyperparameters={**default_hp, "plan_item_count": 1},
    )))

    # 13. humming_unavailable_excluded — humming_karaoke, one song flagged
    # humming_karaoke_available=0 -> excluded "humming_unavailable";
    # plan_item_count=3 over 5 remaining -> tail of 2. Fix round 1: also
    # carries `road_type: "parking"` — a real, distinct entry in
    # context_response_matrix.road (alpha=0, beta=0, package.json), never
    # exercised by any other case (which use highway/mountain/local, or omit
    # road_type entirely -> "local" default).
    cat13 = smoke_catalog()
    cat13["synthetic-track-1001"]["simulation_flags"]["humming_karaoke_available"] = 0
    cases.append(("humming_unavailable_excluded", base_context(
        selected_service_id="humming_karaoke",
        feature_snapshot={"catalog": cat13, "situation": {"motion_state": "driving", "road_type": "parking"}},
        hyperparameters={**default_hp, "plan_item_count": 3},
    )))

    # 14. full_karaoke_available_flag_excluded — full_karaoke (stopped), one
    # song flagged full_karaoke_available=0 -> excluded
    # "full_karaoke_unavailable"; plan_item_count=3 over 5 remaining -> tail
    # of 2. Fix round 1: also carries an UNRECOGNIZED `road_type` (not one of
    # highway/local/mountain/parking) -> `crm["road"].get(rtype, {"alpha":
    # 0.0, "beta": 0.0})`'s fallback-default branch (algorithm.py:278),
    # distinct from "parking" above (a real, present table entry).
    cat14 = smoke_catalog()
    cat14["synthetic-track-1002"]["simulation_flags"]["full_karaoke_available"] = 0
    cases.append(("full_karaoke_available_flag_excluded", base_context(
        selected_service_id="full_karaoke",
        feature_snapshot={"catalog": cat14, "situation": {"motion_state": "stopped", "road_type": "not_a_real_road_type"}},
        hyperparameters={**default_hp, "plan_item_count": 3},
    )))

    # 15. lighting_mid_cue — deterministic: exactly ONE eligible/scored song
    # (trivially chosen[0]) with a hand-tuned trait valence in
    # [low_threshold, high_threshold) = [0.33, 0.66) (valence=0.60, mode=0 ->
    # trait valence = 0.65*0.60 + 0.35*0 = 0.39) -> _lighting()'s "mid_cue"
    # branch, the one lighting cue band not naturally reached by the other
    # humming/full_karaoke cases above (their smoke-catalog songs' valence
    # traits cluster at the high/low extremes).
    cat15 = smoke_catalog()
    only15 = {"synthetic-track-1005": cat15["synthetic-track-1005"]}
    only15["synthetic-track-1005"]["spotify_audio_features"]["valence"] = 0.60
    only15["synthetic-track-1005"]["spotify_audio_features"]["mode"] = 0
    cases.append(("lighting_mid_cue", base_context(
        selected_service_id="humming_karaoke",
        feature_snapshot={"catalog": only15, "situation": {"motion_state": "driving"}},
        hyperparameters={**default_hp, "plan_item_count": 1},
    )))

    # 16. real_dataset_slice — the first 10 songs of the real, committed
    # dataset catalog (proposal_contracts/dataset/soundcharts-grounded-.../
    # catalog.json, 300 songs total; see the module comment above this
    # function for the bound and the reasoning), with a matching slice of
    # genre_affinity_v1.json (only artist ids credited on those 10 songs).
    # genre_affinity_v1 extension ON but WITHOUT populating route_tags/
    # destination_tags/hobby_interest_tags/usage_by_genre/scene_genre_usage
    # -> the genre-on-but-NO-match branch for route/destination/hobbies/
    # genre_usage/scene_genre (distinct from case 2's genre-on-WITH-match).
    # oshi ON with a registered artist NOT credited on any of the 10 sliced
    # songs -> gate=1 but affinity=0 (matched=[]) -- the THIRD distinct oshi
    # shape (cases 1/3 were gate=0; case 2 was gate=1 WITH a match; this is
    # gate=1 WITHOUT one).
    real_catalog_path = _REPO / "proposal_contracts" / "dataset" / "soundcharts-grounded-spotify-compatible-demonstration-seed-1042" / "catalog.json"
    real_genre_path = _REPO / "proposal_contracts" / "dataset" / "soundcharts-grounded-spotify-compatible-demonstration-seed-1042" / "genre_affinity_v1.json"
    real_songs = _load_json(real_catalog_path)[:10]
    real_catalog = {song["spotify_track"]["id"]: song for song in real_songs}
    real_artist_ids = {
        artist["id"]
        for song in real_songs
        for artist in song["spotify_track"].get("artists", [])
        if artist.get("id")
    }
    real_genre_raw = _load_json(real_genre_path)
    real_genre_slice = {
        "artist_genres": {
            aid: genres for aid, genres in real_genre_raw["artist_genres"].items() if aid in real_artist_ids
        },
    }
    cases.append(("real_dataset_slice", base_context(
        selected_service_id="music_playlist",
        trigger_purpose="route_music",
        lifecycle_stage="active_driving_content",
        enabled_feature_extensions=["genre_affinity_v1"],
        feature_snapshot={
            "catalog": real_catalog,
            "situation": {
                "drowsiness_level": 45, "fatigue_level": 25, "monotony_level": 35,
                "traffic_state": "normal", "road_type": "highway", "night_state": "night",
                "motion_state": "driving", "child_present": False, "multiple_passengers": False,
            },
            "preference": {
                "oshi_registered": True, "oshi_mode": "on",
                "oshi_artists": [{"artist_id": "synthetic-artist-9999-not-credited", "enthusiasm": 1.0, "oshi_type": "artist"}],
                "age_band": "40s",
            },
            "history": {},
            "genre_affinity_v1": real_genre_slice,
        },
        catalog_version="soundcharts-grounded-spotify-compatible-demonstration-seed-1042",
        hyperparameters={**default_hp, "plan_item_count": 5},
    )))

    # 17. tie_break_item_fit_clone — two BIT-FOR-BIT identical songs (a clone
    # with a different track id, no preference/history table entries for
    # either) -> identical item_fit -> forces the
    # `(-item_fit, track_id)` tuple tie-break (divergence hazard 2).
    # track_id ascending must place "synthetic-track-1005" ahead of its
    # "synthetic-track-1005-clone".
    cat17 = smoke_catalog()
    base_song = cat17["synthetic-track-1005"]
    clone17 = copy.deepcopy(base_song)
    clone17["spotify_track"]["id"] = "synthetic-track-1005-clone"
    clone17["spotify_track"]["uri"] = "spotify:track:synthetic-track-1005-clone"
    clone17["spotify_audio_features"]["id"] = "synthetic-track-1005-clone"
    clone17["spotify_audio_features"]["uri"] = "spotify:track:synthetic-track-1005-clone"
    cases.append(("tie_break_item_fit_clone", base_context(
        feature_snapshot={
            "catalog": {"synthetic-track-1005": base_song, "synthetic-track-1005-clone": clone17},
            "situation": {"drowsiness_level": 50, "motion_state": "driving"},
        },
        hyperparameters={**default_hp, "plan_item_count": 1},
    )))

    # 18. lighting_low_cue — same deterministic single-song technique as
    # lighting_mid_cue, but tuned for top_valence <= low_threshold (0.33):
    # valence=0.10, mode=0 -> trait valence = 0.65*0.10 + 0.35*0 = 0.065.
    # None of the other humming/full_karaoke cases land here naturally (their
    # smoke-catalog songs' traits cluster at the high extreme once the
    # winning candidate is picked) -> closes the third and last
    # `_lighting()` cue band (high/mid already covered above).
    cat18b = smoke_catalog()
    only18b = {"synthetic-track-1002": cat18b["synthetic-track-1002"]}
    only18b["synthetic-track-1002"]["spotify_audio_features"]["valence"] = 0.10
    only18b["synthetic-track-1002"]["spotify_audio_features"]["mode"] = 0
    cases.append(("lighting_low_cue", base_context(
        selected_service_id="humming_karaoke",
        feature_snapshot={"catalog": only18b, "situation": {"motion_state": "driving"}},
        hyperparameters={**default_hp, "plan_item_count": 1},
    )))

    # 19. purpose_multiplier_fallback — resolve_weights's
    # `multipliers.get(subgroup, {}).get(purpose, 1.0)` (algorithm.py:146) is
    # a SAFE, defaulted read (never a raise) that none of cases 1-17 reach:
    # the package's own default purpose_multipliers table is complete for all
    # 4 purposes x every subgroup, so `.get(purpose, 1.0)` always finds a
    # REAL entry in every other case. Here the driver_state/route_music entry
    # (0.90 by default, deliberately NOT 1.0 so the fallback is observable)
    # is deleted via an hp override -> drowsiness/fatigue's purpose_multiplier
    # must come back as the bare default 1.0 instead.
    #
    # Fix round 1: this case ALSO deletes the "changed" leaf's "mask" key
    # entirely from hierarchy_weights (Preference/operations/changed) ->
    # `leaf_def.get("mask", 0)` (algorithm.py:140) must fall back to 0 ->
    # "changed_from_items" is excluded from scored_leaves entirely (distinct
    # from every other case, where it is always explicitly mask=1 and lands
    # "active"/"missing_neutral" -> here it must land "context_only" instead,
    # the disposition classification only reachable when a leaf's own
    # feature_id is absent from scored_fids).
    hp_pmult = copy.deepcopy(default_hp)
    del hp_pmult["purpose_multipliers"]["driver_state"]["route_music"]
    del hp_pmult["hierarchy_weights"]["Preference"]["operations"]["leaves"]["changed"]["mask"]
    cases.append(("purpose_multiplier_fallback", base_context(
        trigger_purpose="route_music",
        lifecycle_stage="active_driving_content",
        feature_snapshot={"catalog": smoke_catalog(), "situation": {"motion_state": "driving", "drowsiness_level": 50}},
        hyperparameters=hp_pmult,
    )))

    # 20. oshi_registered_on_empty_artists — preference.oshi_registered=True,
    # oshi_mode="on", but oshi_artists=[] (empty list -> by_id stays empty)
    # -> gate=0 via a DIFFERENT path than cases 1 (registered=False) or 3
    # (mode="off"): here BOTH registered and mode_on are truthy, only the
    # emptiness of by_id makes the `registered and mode_on and by_id` gate
    # condition false (algorithm.py:363).
    cases.append(("oshi_registered_on_empty_artists", base_context(
        feature_snapshot={
            "catalog": smoke_catalog(),
            "situation": {"motion_state": "stopped", "drowsiness_level": 40},
            "preference": {"oshi_registered": True, "oshi_mode": "on", "oshi_artists": []},
        },
        hyperparameters={**default_hp, "plan_item_count": 2},
    )))

    # 21. all_neutral_rationale — a fully "quiet" input (no contrivance: every
    # situation flag at its neutral/default value, no oshi, no age band, no
    # history) makes EVERY scored leaf's contribution exactly 0.0 for EVERY
    # candidate (drowsiness/fatigue/monotony/traffic/night/motion all have
    # e_i=0 at these values; "road" has e_i=1 but road_type="highway" has
    # alpha=beta=0 -> a_i=0 regardless of trait values; oshi/age/item_usage/
    # played/skipped/changed/acceptance/recovery all read absent
    # preference/history -> e_i=0; genre leaves are masked off entirely,
    # extension OFF) -> `_build_reasons`'s `pos`/`neg` lists both end up
    # empty -> the "中立的なスコア。 / Neutral score." fallback (algorithm.py:
    # 578-579), never otherwise reached in this case set. Also incidentally a
    # 6-way item_fit tie (every smoke-catalog song scores exactly 0.0),
    # exercising the tuple tie-break again on a much wider tie than case 17.
    cases.append(("all_neutral_rationale", base_context(
        feature_snapshot={
            "catalog": smoke_catalog(),
            "situation": {
                "drowsiness_level": 0, "fatigue_level": 0, "monotony_level": 0,
                "traffic_state": "normal", "road_type": "highway", "night_state": "day",
                "motion_state": "stopped",
            },
            "preference": {},
            "history": {},
        },
        hyperparameters={**default_hp, "plan_item_count": 1},
    )))

    spec = importlib.util.spec_from_file_location(
        "aica_content_selector_v1_algorithm", _PACKAGES_DIR / pkg_id / "algorithm.py"
    )
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[attr-defined]
    evaluate = mod.evaluate

    results = []
    for name, ctx in cases:
        decision = evaluate(ctx)
        results.append({"name": name, "decision": decision})

    # Self-checks: this fixture set only earns its keep if it actually
    # discriminates the branches the report claims it does.
    by_name = {r["name"]: r["decision"] for r in results}
    assert by_name["baseline_complete_plan"]["decision_type"] == "complete_plan"
    assert len(by_name["baseline_complete_plan"]["scored_tail"]) == 1

    def _contrib(decision, track_id, feature_id):
        rows = decision["ordered_items"] + [
            {"item_id": t["item_id"], "feature_contributions": t["feature_contributions"]}
            for t in decision.get("scored_tail", [])
        ]
        for it in rows:
            if it["item_id"] == track_id:
                for c in it["feature_contributions"]:
                    if c["feature_id"] == feature_id:
                        return c
        raise AssertionError(f"{track_id}/{feature_id} not found in decision")

    baseline = by_name["baseline_complete_plan"]
    # played_items time buckets (algorithm.py:434-452, history_curves.played
    # default {le_30m:-1.0, today:-0.5, le_7d:-0.25, else:0.0}). le_30m/today/
    # le_7d are numerically distinctive; "else" coincides with 0.0 (the same
    # value an ABSENT played_items entry would produce) -- asserted anyway
    # because the underlying delta-threshold computation still has to land on
    # the right branch for parity to hold (a wrong threshold could just as
    # easily have landed on le_7d's -0.25), even though this specific value
    # can't visually prove which branch fired on its own.
    assert _contrib(baseline, "synthetic-track-1001", "played_items")["e_i"] == -1.0
    assert _contrib(baseline, "synthetic-track-1002", "played_items")["e_i"] == -0.5
    assert _contrib(baseline, "synthetic-track-1004", "played_items")["e_i"] == -0.25
    assert _contrib(baseline, "synthetic-track-1006", "played_items")["e_i"] == 0.0
    # _era_bucket shapes (algorithm.py:189-206). age_band="30s" throughout.
    # pre1980 (-0.3) is numerically distinctive. 1980s's affinity for "30s"
    # happens to be exactly 0.0 (package.json's own age_era_affinity table) --
    # e_i=1.0 (band&&era both resolved) still distinguishes it from the
    # "band absent"/"era unresolvable" shapes, which are e_i=0.0.
    pre1980_age = _contrib(baseline, "synthetic-track-1002", "age_band")
    assert pre1980_age["e_i"] == 1.0 and pre1980_age["a_i"] == -0.3, pre1980_age
    unresolvable_age = _contrib(baseline, "synthetic-track-1004", "age_band")
    assert unresolvable_age["e_i"] == 0.0 and unresolvable_age["a_i"] == 0.0, unresolvable_age
    era1980s_age = _contrib(baseline, "synthetic-track-1006", "age_band")
    assert era1980s_age["e_i"] == 1.0 and era1980s_age["a_i"] == 0.0, era1980s_age
    assert by_name["humming_genre_oshi_on"]["decision_type"] == "complete_plan"
    assert by_name["full_karaoke_stopped_directional_keep_alert"]["decision_type"] == "complete_plan"
    assert by_name["full_karaoke_driving_refused"]["decision_type"] == "full_karaoke_requires_stopped"
    assert by_name["invalid_request_missing_service"]["decision_type"] == "invalid_request"
    assert by_name["unsupported_recipe"]["decision_type"] == "unsupported_recipe"
    assert by_name["invalid_catalog_unknown_candidate"]["decision_type"] == "invalid_catalog"
    assert by_name["invalid_catalog_unknown_candidate"]["excluded_items"] == []
    assert by_name["invalid_catalog_missing_audio_field"]["decision_type"] == "invalid_catalog"
    assert by_name["invalid_configuration_zero_denominator"]["decision_type"] == "invalid_configuration"
    assert by_name["insufficient_eligible_items"]["decision_type"] == "insufficient_eligible_items"
    assert len(by_name["insufficient_eligible_items"]["excluded_items"]) == 1
    assert by_name["no_proposal_all_excluded"]["decision_type"] == "no_proposal"
    assert len(by_name["no_proposal_all_excluded"]["excluded_items"]) == 7
    bundle = by_name["eligibility_reasons_bundle"]
    assert bundle["decision_type"] == "complete_plan"
    assert bundle["scored_tail"] == []
    assert bundle["ordered_items"][0]["item_id"] == "synthetic-track-1006"
    bundle_reasons = {e["item_id"]: e["reason_codes"] for e in bundle["excluded_items"]}
    assert bundle_reasons["synthetic-track-1001"] == ["explicit_under_child"]
    assert bundle_reasons["synthetic-track-1002"] == ["not_playable"]
    assert bundle_reasons["synthetic-track-1003"] == ["market_unavailable"]
    assert bundle_reasons["synthetic-track-1004"] == ["restricted"]
    assert bundle_reasons["synthetic-track-1005"] == ["recent_skip"]
    assert bundle_reasons["synthetic-track-1099"] == ["identity_mismatch"]
    assert by_name["humming_unavailable_excluded"]["decision_type"] == "complete_plan"
    assert any(e["item_id"] == "synthetic-track-1001" and e["reason_codes"] == ["humming_unavailable"]
               for e in by_name["humming_unavailable_excluded"]["excluded_items"])
    assert by_name["full_karaoke_available_flag_excluded"]["decision_type"] == "complete_plan"
    assert any(e["item_id"] == "synthetic-track-1002" and e["reason_codes"] == ["full_karaoke_unavailable"]
               for e in by_name["full_karaoke_available_flag_excluded"]["excluded_items"])
    mid_cue = by_name["lighting_mid_cue"]["lighting_configuration"]
    assert mid_cue is not None and mid_cue["notes"] == default_hp["lighting_lookup"]["mid_cue"], mid_cue
    low_cue = by_name["lighting_low_cue"]["lighting_configuration"]
    assert low_cue is not None and low_cue["notes"] == default_hp["lighting_lookup"]["low_cue"], low_cue
    assert by_name["real_dataset_slice"]["decision_type"] == "complete_plan"
    tie = by_name["tie_break_item_fit_clone"]
    assert tie["decision_type"] == "complete_plan"
    assert tie["ordered_items"][0]["item_id"] == "synthetic-track-1005"
    assert tie["scored_tail"][0]["item_id"] == "synthetic-track-1005-clone"
    assert abs(tie["ordered_items"][0]["item_fit"] - tie["scored_tail"][0]["item_fit"]) < 1e-15
    pmult_fallback = by_name["purpose_multiplier_fallback"]
    assert pmult_fallback["decision_type"] == "complete_plan"
    for it in pmult_fallback["ordered_items"] + [{"feature_contributions": t["feature_contributions"]} for t in pmult_fallback["scored_tail"]]:
        for c in it["feature_contributions"]:
            if c["feature_id"] == "drowsiness_level":
                assert c["purpose_multiplier"] == 1.0, c
            # mask key-absent default (algorithm.py:140, leaf_def.get("mask",
            # 0)): "changed_from_items" must be ABSENT from every candidate's
            # feature_contributions entirely (masked out, never scored).
            assert c["feature_id"] != "changed_from_items", c
    pmult_active = set(pmult_fallback["algorithm_provenance"]["active_features"])
    pmult_context_only = set(pmult_fallback["algorithm_provenance"]["context_only_features"])
    pmult_missing = set(pmult_fallback["algorithm_provenance"]["missing_features"])
    assert "changed_from_items" not in pmult_active
    assert "changed_from_items" not in pmult_missing
    assert "changed_from_items" in pmult_context_only, (
        "mask key-absent leaf must classify as context_only (never scored), not active/missing_neutral"
    )

    # road_type="parking" (case 13) / an unrecognized road_type (case 14):
    # both a REAL table entry lookup and the `.get(rtype, default)` fallback
    # coincide numerically with highway/local's alpha=0,beta=0 in this
    # package's own data (parking IS defined as alpha=0,beta=0; the inline
    # Python default is ALSO {"alpha":0.0,"beta":0.0}) -- so neither can be
    # visually distinguished from an "absent road_type" contribution by value
    # alone. Asserted only for "doesn't crash / still produces a plan";
    # parity with the real Python capture is what actually proves the two
    # DIFFERENT code paths (real dict hit vs. synthesized fallback) each
    # landed on the correct branch, since a wrong lookup (e.g. accidentally
    # hitting "mountain", alpha=-1) WOULD have produced a visibly different,
    # parity-breaking a_i.
    assert by_name["humming_unavailable_excluded"]["decision_type"] == "complete_plan"
    assert by_name["full_karaoke_available_flag_excluded"]["decision_type"] == "complete_plan"

    oshi_empty = by_name["oshi_registered_on_empty_artists"]
    assert oshi_empty["decision_type"] == "complete_plan"
    for it in oshi_empty["ordered_items"] + [{"item_id": t["item_id"], "feature_contributions": t["feature_contributions"]} for t in oshi_empty["scored_tail"]]:
        for c in it["feature_contributions"]:
            if c["feature_id"] == "oshi_artists":
                assert c["e_i"] == 0.0 and c["a_i"] == 0.0 and c["matched_artist_ids"] == [], c

    neutral = by_name["all_neutral_rationale"]
    assert neutral["decision_type"] == "complete_plan"
    assert neutral["ordered_items"][0]["item_fit"] == 0.0
    assert neutral["ordered_items"][0]["rationale"] == ["中立的なスコア。 / Neutral score."], neutral["ordered_items"][0]["rationale"]
    assert all(c["contribution"] == 0.0 for c in neutral["ordered_items"][0]["feature_contributions"])

    _write("content_selector", {
        "input": {"cases": [{"name": name, "context": ctx} for name, ctx in cases]},
        "output": {"results": results},
    })


# ---------------------------------------------------------------------------
# 20. proposal_eligibility (services/proposal_eligibility.resolve_eligibility /
#     derive_registered_entities — C2 Task 2)
# ---------------------------------------------------------------------------
#
# Pure, direct-import capture (no TestClient). `resolve_eligibility` cases 1-2
# and the `derive_registered_entities` cases mirror
# app/api/tests/proposal/test_eligibility_resolver.py's own scenarios
# one-for-one (same POST_REST_ROW, same motion/registration combinations).
# Cases 3-5 fill branch-coverage gaps that Python's OWN test suite does not
# exercise (verified by reading that file in full): rule 3
# (catalog_item_unavailable), rule 1's third branch (screen_dependent_while_
# driving — unreachable via the real committed service_capabilities.v1.json,
# since every screen_dependent service there is either stopped_only or
# background_on_motion; exercised instead via a synthetic single-service
# capabilities table, since `capabilities` is a parameter, not hardwired to
# the committed file), and the fixed multi-reason ordering (motion, then
# entity, then catalog) on one service that trips all three simultaneously.

def _capture_eligibility() -> None:
    from aica_api.models.proposal.enums import MotionState, ServiceId
    from aica_api.models.proposal.service_capabilities import ServiceCapabilities, ServiceCapability
    from aica_api.services.proposal_eligibility import derive_registered_entities, resolve_eligibility

    capabilities_path = _REPO / "proposal_contracts" / "service_capabilities" / "service_capabilities.v1.json"
    capabilities = ServiceCapabilities.load(capabilities_path)

    post_rest_row = [
        ServiceId.live_viewing, ServiceId.stretch_video, ServiceId.full_karaoke,
        ServiceId.oshi_reexperience, ServiceId.call_response_stopped,
    ]

    cases: list[tuple[str, dict, object]] = []

    r1 = resolve_eligibility(post_rest_row, MotionState.driving, capabilities, registered_entities=set())
    cases.append(("post_rest_driving_no_oshi", {
        "allowed_service_ids": [s.value for s in post_rest_row],
        "motion_state": "driving",
        "registered_entities": [],
        "unavailable_service_ids": [],
    }, r1))

    r2 = resolve_eligibility(post_rest_row, MotionState.stopped, capabilities, registered_entities={"oshi"})
    cases.append(("post_rest_stopped_with_oshi", {
        "allowed_service_ids": [s.value for s in post_rest_row],
        "motion_state": "stopped",
        "registered_entities": ["oshi"],
        "unavailable_service_ids": [],
    }, r2))

    r3 = resolve_eligibility(
        [ServiceId.music_playlist, ServiceId.quiz], MotionState.stopped, capabilities,
        registered_entities=set(), unavailable_service_ids={"quiz"},
    )
    cases.append(("unavailable_catalog_item", {
        "allowed_service_ids": ["music_playlist", "quiz"],
        "motion_state": "stopped",
        "registered_entities": [],
        "unavailable_service_ids": ["quiz"],
    }, r3))

    synthetic_service = ServiceCapability(
        service_id=ServiceId.music_playlist, driving_capable=True, screen_dependent=True,
        stopped_only=False, background_on_motion=False, lighting_compatible=True, requires_entity=None,
    )
    synthetic_caps = ServiceCapabilities(
        capabilities_version="synthetic-branch-coverage",
        services={ServiceId.music_playlist: synthetic_service},
    )
    r4 = resolve_eligibility([ServiceId.music_playlist], MotionState.driving, synthetic_caps, registered_entities=set())
    cases.append(("screen_dependent_while_driving_synthetic", {
        "allowed_service_ids": ["music_playlist"],
        "motion_state": "driving",
        "registered_entities": [],
        "unavailable_service_ids": [],
        "synthetic_capabilities": {
            "capabilities_version": "synthetic-branch-coverage",
            "services": [json.loads(synthetic_service.model_dump_json())],
        },
    }, r4))

    r5 = resolve_eligibility(
        [ServiceId.oshi_reexperience], MotionState.driving, capabilities,
        registered_entities=set(), unavailable_service_ids={"oshi_reexperience"},
    )
    cases.append(("combined_all_three_reasons_ordering", {
        "allowed_service_ids": ["oshi_reexperience"],
        "motion_state": "driving",
        "registered_entities": [],
        "unavailable_service_ids": ["oshi_reexperience"],
    }, r5))

    results = [{"name": name, "output": json.loads(r.model_dump_json())} for name, _inp, r in cases]

    derive_cases: list[tuple[str, object]] = [
        ("typed_nested_true", {"feature_snapshot": {"preference": {"oshi_registered": True}}}),
        ("typed_nested_false", {"feature_snapshot": {"preference": {"oshi_registered": False}}}),
        ("legacy_flat_true", {"feature_snapshot": {"oshi_registered": True}}),
        ("legacy_flat_false", {"feature_snapshot": {"oshi_registered": False}}),
        ("no_feature_snapshot_key", {}),
        ("empty_feature_snapshot", {"feature_snapshot": {}}),
        ("none_world_snapshot", None),
    ]
    derive_results = [
        {"name": name, "registered_entities": sorted(derive_registered_entities(ws))}
        for name, ws in derive_cases
    ]

    _write("proposal_eligibility", {
        "input": {
            "cases": [{"name": name, **inp} for name, inp, _r in cases],
            "derive_cases": [{"name": name, "world_snapshot": ws} for name, ws in derive_cases],
        },
        "output": {"results": results, "derive_results": derive_results},
    })


# ---------------------------------------------------------------------------
# 21. algorithm_config (services/algorithm_config.merge_algorithm_config — C2 Task 2)
# ---------------------------------------------------------------------------
#
# Pure dict deep-merge. Cases 1-7 mirror
# app/api/tests/proposal/test_config_override_merge.py's own scenarios
# one-for-one; case 4 is grounded in a REAL package's default hyperparameters
# (aica_transparent_service_selector_v1's own nested hierarchy_weights)
# rather than a synthetic literal, per the task's "driven from committed
# data" instruction.

def _capture_algorithm_config() -> None:
    from aica_api.services.algorithm_config import merge_algorithm_config

    pkg_raw = _load_json(_PACKAGES_DIR / "aica_transparent_service_selector_v1" / "package.json")
    real_defaults = {h["key"]: h["default"] for h in pkg_raw["hyperparameters"]}

    cases: list[tuple[str, dict, object]] = []
    cases.append(("none_override", real_defaults, None))
    cases.append(("empty_dict_override", real_defaults, {}))
    cases.append(("top_level_scalar_override", {"directional_hypothesis": "soothe", "other_key": "unchanged"}, {"directional_hypothesis": "keep_alert"}))
    cases.append(("nested_dict_merge_real_hierarchy", real_defaults, {"hierarchy_weights": {"Situation": {"share": 0.01}}}))
    cases.append(("non_dict_override_replaces_dict_default", real_defaults, {"hierarchy_weights": "not-a-dict-anymore"}))
    cases.append(("list_override_replaces_wholesale", {"tags": ["a", "b", "c"]}, {"tags": ["z"]}))
    cases.append(("new_key_added", {"a": 1}, {"b": 2}))
    cases.append((
        "deep_nested_merge_siblings_untouched",
        {
            "hierarchy_weights": {
                "Preference": {"upro_oshi": {"leaves": {
                    "age": {"feature_id": "age_band", "mask": 1, "share": 0.2},
                    "oshi": {"feature_id": "oshi_id", "mask": 1, "share": 0.3},
                }}}
            },
            "norm_bounds": {"loudness_min": -60},
        },
        {"hierarchy_weights": {"Preference": {"upro_oshi": {"leaves": {"age": {"share": 0.35}}}}}},
    ))

    results = []
    for name, defaults, overrides in cases:
        merged = merge_algorithm_config(defaults, overrides)
        results.append({"name": name, "merged": merged})

    _write("algorithm_config", {
        "input": {"cases": [{"name": name, "defaults": defaults, "overrides": overrides} for name, defaults, overrides in cases]},
        "output": {"results": results},
    })


# ---------------------------------------------------------------------------
# 22. world_validation (services/world_validation.validate_world — C2 Task 2)
# ---------------------------------------------------------------------------
#
# Direct import over a real committed seed (seed-night-highway-oshi) + the
# real dataset catalog it references. Cases mirror
# app/api/tests/proposal/test_world_validation.py's own scenarios
# one-for-one (mutating an already-validated World in place — the same
# "invalid but in-memory" manufacturing technique that test file uses, since
# these models don't set validate_assignment), plus two extra cases
# (percent-map range violation, enthusiasm-grid violation) strengthening
# rule 1's "numeric ranges" bucket beyond the two fields Python's own suite
# happens to pick.

def _capture_world_validation() -> None:
    from aica_api.models.proposal.enums import ServiceId, TriggerPurpose, UsageLevel
    from aica_api.models.proposal.song_schema import Song
    from aica_api.models.proposal.world import ChangedFromItem, PlayedItem, SkippedItem, World
    from aica_api.services.world_seed_store import WorldSeedStore
    from aica_api.services.world_validation import validate_world

    dataset_id = "soundcharts-grounded-spotify-compatible-demonstration-seed-1042"
    dataset_dir = _REPO / "proposal_contracts" / "dataset" / dataset_id
    catalog_raw = json.loads((dataset_dir / "catalog.json").read_text(encoding="utf-8"))
    catalog = [Song.model_validate(entry) for entry in catalog_raw]

    seed_store = WorldSeedStore(_REPO / "proposal_contracts" / "seeds")
    base_seed = seed_store.get_seed("seed-night-highway-oshi")
    assert base_seed is not None
    base_world_dict = base_seed.world.model_dump(mode="json")

    def fresh_world() -> World:
        return World.model_validate(json.loads(json.dumps(base_world_dict)))

    cases: list[tuple[str, dict, list]] = []

    def add(name: str, mutate) -> None:
        world = fresh_world()
        mutate(world)
        issues = validate_world(world, catalog)
        cases.append((name, json.loads(world.model_dump_json()), [json.loads(i.model_dump_json()) for i in issues]))

    add("valid_world_no_issues", lambda w: None)
    add("out_of_range_int", lambda w: setattr(w.situation, "drowsiness_level", 150))
    add("invalid_enum_member", lambda w: setattr(w.situation, "traffic_state", "bogus-state"))
    add("incompatible_purpose_stage", lambda w: setattr(w.control_inputs, "trigger_purpose", TriggerPurpose.route_music))
    add("unknown_oshi_artist_id", lambda w: setattr(w.driver_profile.oshi_artists[0], "artist_id", "synthetic-artist-DOES-NOT-EXIST"))

    def mutate_played_item(w: World) -> None:
        w.driver_profile.played_items = [
            PlayedItem(track_id="synthetic-track-DOES-NOT-EXIST", last_played_at="2026-07-16T10:00:00Z")
        ]
    add("unknown_played_item_track_id", mutate_played_item)

    def mutate_usage_level(w: World) -> None:
        w.driver_profile.catalog_item_usage_level = {"synthetic-track-NOPE": UsageLevel.high}
    add("unknown_catalog_item_usage_level_key", mutate_usage_level)

    def mutate_multiple(w: World) -> None:
        w.situation.drowsiness_level = 999
        w.driver_profile.oshi_artists[0].artist_id = "synthetic-artist-DOES-NOT-EXIST"
    add("multiple_violations_all_reported", mutate_multiple)

    def mutate_percent_map(w: World) -> None:
        w.driver_profile.service_proposal_acceptance_rate = {ServiceId.music_playlist: 150}
    add("percent_map_out_of_range", mutate_percent_map)

    def mutate_enthusiasm_grid(w: World) -> None:
        w.driver_profile.oshi_artists[0].enthusiasm = 0.35
    add("enthusiasm_not_on_grid", mutate_enthusiasm_grid)

    def mutate_duplicate_oshi(w: World) -> None:
        a = w.driver_profile.oshi_artists[0]
        w.driver_profile.oshi_artists = [a, a.model_copy()]
    add("duplicate_oshi_artist_id", mutate_duplicate_oshi)

    # --- fix round 1: service_usage_level / service_recency_state /
    # scene_service_usage_level (live-scored inputs to the service selector's
    # resolve_direct_evidence, per algorithm.py:535-558 — confirmed via grep,
    # not assumed). Built-in dict[K, V] validation, NOT a custom
    # field_validator: checks BOTH key (ServiceId) and value (the enum), and
    # reports EVERY invalid entry, not just the first.

    def mutate_service_usage_level_bad_key(w: World) -> None:
        w.driver_profile.service_usage_level = {"not_a_service": "high"}
    add("service_usage_level_bad_key", mutate_service_usage_level_bad_key)

    def mutate_service_usage_level_bad_value(w: World) -> None:
        w.driver_profile.service_usage_level = {"music_playlist": "bogus_level"}
    add("service_usage_level_bad_value", mutate_service_usage_level_bad_value)

    def mutate_service_recency_state_bad_key(w: World) -> None:
        w.driver_profile.service_recency_state = {"not_a_service": "recent"}
    add("service_recency_state_bad_key", mutate_service_recency_state_bad_key)

    def mutate_service_recency_state_bad_value(w: World) -> None:
        w.driver_profile.service_recency_state = {"music_playlist": "bogus_recency"}
    add("service_recency_state_bad_value", mutate_service_recency_state_bad_value)

    def mutate_scene_service_usage_level_bad_inner(w: World) -> None:
        w.driver_profile.scene_service_usage_level = {
            "scene_a": {"music_playlist": "bogus"},
            "scene_b": {"not_a_service": "high"},
        }
    add("scene_service_usage_level_bad_inner", mutate_scene_service_usage_level_bad_inner)

    def mutate_service_usage_level_multiple_bad(w: World) -> None:
        # Proves ALL invalid entries are reported (not just the first) —
        # the divergence risk that makes this a built-in-type-validation
        # field genuinely different from the custom-validator rate maps
        # above (which raise on first violation only).
        w.driver_profile.service_usage_level = {"music_playlist": "bogus1", "quiz": "bogus2"}
    add("service_usage_level_multiple_bad_entries", mutate_service_usage_level_multiple_bad)

    def mutate_gate_interaction(w: World) -> None:
        # Proves the SAME model-validator skip-on-field-failure gate already
        # verified for the rate maps also holds for these built-in-validated
        # fields: a service_usage_level entry error blocks the sibling
        # duplicate-oshi-id model validator from firing, even though a
        # genuine duplicate is also present.
        a = w.driver_profile.oshi_artists[0]
        w.driver_profile.oshi_artists = [a, a.model_copy()]
        w.driver_profile.service_usage_level = {"music_playlist": "bogus"}
    add("service_usage_level_error_blocks_duplicate_check", mutate_gate_interaction)

    # --- fix round 2: catalog_item_usage_level's dict VALUE (a UsageLevel).
    # disposition:scored for the content selector (packages/
    # aica_transparent_content_selector_v1/algorithm.py:396, grep-verified) —
    # the residual gap named at the end of fix round 1's report. The KEY here
    # is an UNCONSTRAINED str (a track id), unlike service_usage_level's
    # ServiceId-typed key — so no `.[key]` marker branch applies to this field.

    def mutate_catalog_item_usage_level_bad_value(w: World) -> None:
        w.driver_profile.catalog_item_usage_level = {"synthetic-track-0001": "bogus_level"}
    add("catalog_item_usage_level_bad_value", mutate_catalog_item_usage_level_bad_value)

    def mutate_catalog_item_usage_level_multiple_bad(w: World) -> None:
        w.driver_profile.catalog_item_usage_level = {
            "synthetic-track-0001": "bogus1",
            "synthetic-track-0002": "bogus2",
        }
    add("catalog_item_usage_level_multiple_bad_entries", mutate_catalog_item_usage_level_multiple_bad)

    def mutate_catalog_item_usage_level_bad_value_and_unknown_ref(w: World) -> None:
        # Same key is BOTH an enum-invalid value (rule 1) AND an unknown
        # catalog reference (rule 3) — proves the two rules fire
        # independently, with their own distinct path SHAPES (dot-joined vs
        # bracketed) — verified via a direct validate_world() capture before
        # writing this case, not assumed from the structural-only case above.
        w.driver_profile.catalog_item_usage_level = {"synthetic-track-DOES-NOT-EXIST": "bogus_level"}
    add("catalog_item_usage_level_bad_value_and_unknown_ref", mutate_catalog_item_usage_level_bad_value_and_unknown_ref)

    # --- fix round 2 re-audit: the remaining `disposition: scored` entries
    # in the content dispositions registry not yet covered by rounds 1-2 —
    # route_tags/destination_tags/child_present (Situation), hobby_interest_tags/
    # content_tag_usage_level/scene_content_tag_usage_level/played_items/
    # skipped_items/changed_from_items (DriverProfile). See the module doc for
    # which of these the shipped content-selector algorithm.py actually reads
    # today vs. which are declared scored but currently dead in that file —
    # checked regardless, since the registry is the authoritative
    # classification this whole rule system is built on.

    def mutate_route_tags_bad_item(w: World) -> None:
        w.situation.route_tags = ["ok", 123]  # type: ignore[list-item]
    add("route_tags_bad_item_type", mutate_route_tags_bad_item)

    def mutate_destination_tags_bad_item(w: World) -> None:
        w.situation.destination_tags = [456]  # type: ignore[list-item]
    add("destination_tags_bad_item_type", mutate_destination_tags_bad_item)

    def mutate_child_present_bad_type(w: World) -> None:
        w.situation.child_present = []  # type: ignore[assignment]
    add("child_present_bad_type", mutate_child_present_bad_type)

    def mutate_hobby_interest_tags_bad_item(w: World) -> None:
        w.driver_profile.hobby_interest_tags = ["ok", True]  # type: ignore[list-item]
    add("hobby_interest_tags_bad_item_type", mutate_hobby_interest_tags_bad_item)

    def mutate_content_tag_usage_level_bad_value(w: World) -> None:
        w.driver_profile.content_tag_usage_level = {"some-tag": "bogus"}  # type: ignore[dict-item]
    add("content_tag_usage_level_bad_value", mutate_content_tag_usage_level_bad_value)

    def mutate_scene_content_tag_usage_level_bad_inner(w: World) -> None:
        w.driver_profile.scene_content_tag_usage_level = {"scene_a": {"some-tag": "bogus"}}  # type: ignore[dict-item]
    add("scene_content_tag_usage_level_bad_inner", mutate_scene_content_tag_usage_level_bad_inner)

    def mutate_played_items_bad_shape(w: World) -> None:
        w.driver_profile.played_items = [PlayedItem(track_id="x", last_played_at="2026-01-01T00:00:00Z")]
        w.driver_profile.played_items[0].track_id = 123  # type: ignore[assignment] — same direct-mutation technique as oshi_artists[0].artist_id above (no validate_assignment on these models)
    add("played_items_bad_track_id_type", mutate_played_items_bad_shape)

    def mutate_skipped_items_bad_shape(w: World) -> None:
        w.driver_profile.skipped_items = [SkippedItem(track_id="x", skipped_at="2026-01-01T00:00:00Z")]
        w.driver_profile.skipped_items[0].track_id = 5  # type: ignore[assignment]
    add("skipped_items_bad_track_id_type", mutate_skipped_items_bad_shape)

    def mutate_changed_from_items_bad_shape(w: World) -> None:
        w.driver_profile.changed_from_items = [ChangedFromItem(track_id="x", changed_at="2026-01-01T00:00:00Z")]
        w.driver_profile.changed_from_items[0].changed_at = 5  # type: ignore[assignment]
    add("changed_from_items_bad_timestamp_type", mutate_changed_from_items_bad_shape)

    # --- fix round 2, second pass: multiple_passengers/oshi_registered are
    # in the SERVICE selector's own FEATURE_ORDER (packages/
    # aica_transparent_service_selector_v1/algorithm.py:58-59) but NOT
    # `disposition: scored` in the CONTENT dispositions registry (context_only
    # there) — the registry only covers the content selector; the service
    # selector never consults it. Found by a selector-source grep, the OTHER
    # half of "per the dispositions registry OR a selector-source grep".

    def mutate_multiple_passengers_bad_type(w: World) -> None:
        w.situation.multiple_passengers = []  # type: ignore[assignment]
    add("multiple_passengers_bad_type", mutate_multiple_passengers_bad_type)

    def mutate_oshi_registered_bad_type(w: World) -> None:
        w.driver_profile.oshi_registered = []  # type: ignore[assignment]
    add("oshi_registered_bad_type", mutate_oshi_registered_bad_type)

    # service_proposal_acceptance_rate/service_recovery_rate/*_confidence are
    # dict[ServiceId, float] — the KEY is pydantic's own built-in dict-key
    # type coercion, which runs BEFORE the custom range-check field_validator
    # (_rate_maps_in_percent_range/_confidence_maps_in_unit_range) even gets a
    # chance to run. Verified via a direct capture with BOTH a bad key AND an
    # out-of-range value on a valid key in the SAME dict: only the key error
    # is reported, proving the range check is skipped entirely when a key
    # fails to coerce — not merely that the key error happens to be listed
    # first.
    def mutate_service_proposal_acceptance_rate_bad_key(w: World) -> None:
        w.driver_profile.service_proposal_acceptance_rate = {"not_a_service": 50}  # type: ignore[dict-item]
    add("service_proposal_acceptance_rate_bad_key", mutate_service_proposal_acceptance_rate_bad_key)

    def mutate_service_proposal_acceptance_rate_bad_key_and_bad_value(w: World) -> None:
        w.driver_profile.service_proposal_acceptance_rate = {  # type: ignore[dict-item]
            "not_a_service": 50,
            "music_playlist": 150,
        }
    add(
        "service_proposal_acceptance_rate_bad_key_suppresses_value_check",
        mutate_service_proposal_acceptance_rate_bad_key_and_bad_value,
    )

    # --- fix round 2, third pass: the genre extension (opt-in,
    # genre_affinity_v1_enabled) — NOT in the content dispositions registry
    # at all, found only via a selector-source grep
    # (packages/aica_transparent_content_selector_v1/algorithm.py:335,340).
    # usage_by_genre_bad_key also exercises GenreLiteral's "children's music"
    # member, the ONE enum value in this whole port whose Python repr needs
    # double quotes (contains an apostrophe) — verified via direct capture.

    def mutate_usage_by_genre_bad_key(w: World) -> None:
        w.driver_profile.usage_by_genre = {"not-a-genre": "high"}  # type: ignore[dict-item]
    add("usage_by_genre_bad_key", mutate_usage_by_genre_bad_key)

    def mutate_usage_by_genre_bad_value(w: World) -> None:
        w.driver_profile.usage_by_genre = {"j-pop": "bogus"}  # type: ignore[dict-item]
    add("usage_by_genre_bad_value", mutate_usage_by_genre_bad_value)

    def mutate_scene_genre_usage_bad_inner(w: World) -> None:
        w.driver_profile.scene_genre_usage = {"scene_a": {"j-pop": "bogus"}}  # type: ignore[dict-item]
    add("scene_genre_usage_bad_inner", mutate_scene_genre_usage_bad_inner)

    _write("world_validation", {
        "input": {"dataset_id": dataset_id, "cases": [{"name": name, "world": world} for name, world, _issues in cases]},
        "output": {"results": [{"name": name, "issues": issues} for name, _world, issues in cases]},
    })


# ---------------------------------------------------------------------------
# 23. world_overrides (services/world_clone_store.apply_overrides — C2 Task 2)
# ---------------------------------------------------------------------------
#
# Direct import over the same real committed seed + dataset catalog as
# world_validation above. `success` cases + `raises` cases (capturing
# InvalidOverrideError.issues as a structured value, not just "did it
# throw") mirror app/api/tests/proposal/test_p7_apply_overrides.py's own
# scenarios one-for-one, PLUS malformed_path/list_index_out_of_range (not
# individually named in that Python file, but reachable through the same
# function via a syntactically-embedded bad path segment — verified via
# direct interpreter capture, not guessed).
#
# NOT captured here: an EMPTY override path. `FieldOverride`'s own
# `path_non_empty` field validator intercepts an empty path before
# `apply_overrides`'s `_split_path` ever runs, for BOTH a raw dict input
# (`FieldOverride.model_validate({"path": "", ...})`) and a directly
# constructed instance (`FieldOverride(path="", ...)` raises at
# construction) — there is no real Python call path that reaches
# `_split_path`'s own empty-path guard with an empty string. Covered instead
# by a direct TS-logic assertion (see world_overrides_validation.test.ts) —
# see world_overrides.ts's module doc for the full reasoning.

def _capture_world_overrides() -> None:
    from aica_api.models.proposal.song_schema import Song
    from aica_api.models.proposal.world import FieldOverride, World
    from aica_api.services.world_clone_store import InvalidOverrideError, apply_overrides
    from aica_api.services.world_seed_store import WorldSeedStore

    dataset_id = "soundcharts-grounded-spotify-compatible-demonstration-seed-1042"
    dataset_dir = _REPO / "proposal_contracts" / "dataset" / dataset_id
    catalog_raw = json.loads((dataset_dir / "catalog.json").read_text(encoding="utf-8"))
    catalog = [Song.model_validate(entry) for entry in catalog_raw]

    seed_store = WorldSeedStore(_REPO / "proposal_contracts" / "seeds")
    base_seed = seed_store.get_seed("seed-night-highway-oshi")
    assert base_seed is not None
    base_world: World = base_seed.world

    def overrides_json(overrides: list) -> list:
        return [json.loads(o.model_dump_json()) if isinstance(o, FieldOverride) else o for o in overrides]

    success_cases: list[tuple[str, list, bool, dict, list]] = []

    def add_success(name: str, overrides: list, use_catalog: bool) -> None:
        world, diffs = apply_overrides(base_world, overrides, catalog=catalog if use_catalog else None)
        success_cases.append((
            name, overrides_json(overrides), use_catalog,
            json.loads(world.model_dump_json()), [json.loads(d.model_dump_json()) for d in diffs],
        ))

    add_success("empty_overrides_with_catalog", [], True)
    add_success("empty_overrides_without_catalog", [], False)
    add_success("one_valid_override_instance_shape", [FieldOverride(path="situation.drowsiness_level", value=10)], True)
    add_success("one_valid_override_dict_shape", [{"path": "situation.fatigue_level", "value": 20}], True)

    raise_cases: list[tuple[str, list, bool, list]] = []

    def add_raise(name: str, overrides: list, use_catalog: bool) -> None:
        try:
            apply_overrides(base_world, overrides, catalog=catalog if use_catalog else None)
            raise AssertionError(f"{name}: expected InvalidOverrideError, nothing was raised")
        except InvalidOverrideError as exc:
            raise_cases.append((name, overrides_json(overrides), use_catalog, [json.loads(i.model_dump_json()) for i in exc.issues]))

    add_raise("malformed_path_segment", [FieldOverride(path="situation.drowsiness_level[bad]", value=10)], True)
    add_raise("unknown_path", [FieldOverride(path="situation.no_such_field", value=1)], True)
    add_raise("list_index_out_of_range", [FieldOverride(path="driver_profile.oshi_artists[99].artist_id", value="x")], True)
    add_raise("out_of_range_value", [FieldOverride(path="situation.drowsiness_level", value=999)], True)
    # A NESTED (list-index) structural failure reached through apply_overrides'
    # own re-validate step — proves it produces the SAME dot-joined `loc`-tuple
    # path format (`driver_profile.oshi_artists.0.enthusiasm`, NOT bracketed)
    # as world_validation.validate_world's, even though the OVERRIDE PATH that
    # reached it is bracketed (`oshi_artists[0].enthusiasm`) — the two path
    # conventions coexist in the same error.
    add_raise("nested_structural_error_via_override", [FieldOverride(path="driver_profile.oshi_artists[0].enthusiasm", value=1.5)], True)
    add_raise(
        "dangling_catalog_reference_with_catalog",
        [FieldOverride(path="driver_profile.oshi_artists[0].artist_id", value="synthetic-artist-DOES-NOT-EXIST")],
        True,
    )
    add_raise(
        "dangling_catalog_reference_without_catalog",
        [FieldOverride(path="driver_profile.oshi_artists[0].artist_id", value="synthetic-artist-DOES-NOT-EXIST")],
        False,
    )
    # --- fix round 1: catalog_ref / DatasetVersion. CatalogRef is
    # frozen=True in Python, but that's irrelevant to apply_overrides — it
    # never mutates a live instance, always re-validating a plain dict from
    # scratch (verified: `del world.catalog_ref.dataset_version` on the real
    # live instance raises `frozen_instance` immediately, but overriding
    # through apply_overrides' own dict-based path mechanism works exactly
    # like any other field, reached through the SAME structural re-validate
    # step as situation.drowsiness_level above).
    add_raise("catalog_ref_dataset_id_bad_type", [FieldOverride(path="catalog_ref.dataset_id", value=123)], True)
    add_raise(
        "catalog_ref_dataset_version_subfield_bad_type",
        [FieldOverride(path="catalog_ref.dataset_version.schema_version", value=123)],
        True,
    )

    _write("world_overrides", {
        "input": {"dataset_id": dataset_id},
        "output": {
            "success": [
                {"name": name, "overrides": ov, "use_catalog": uc, "world": world, "diffs": diffs}
                for name, ov, uc, world, diffs in success_cases
            ],
            "raises": [
                {"name": name, "overrides": ov, "use_catalog": uc, "issues": issues}
                for name, ov, uc, issues in raise_cases
            ],
        },
    })


# ---------------------------------------------------------------------------
# 26. proposal_selector_dispatch (services/proposal_selector.dispatch_selector
#     — C2 Task 3)
# ---------------------------------------------------------------------------
#
# Wraps the REAL dispatch_selector() around already-committed, already-valid
# contexts (the "worked_example"/first case from the already-written
# service_selector.json / content_selector.json fixtures — re-loaded here
# rather than duplicated) so this capture exercises dispatch_selector's OWN
# evidence-shaping (step/package_id/contract_version/schema_version/
# matrix_version stamping, used_feature_ids passthrough, an
# evidence_input_snapshot redaction, and the allowed_service_ids
# candidate-membership check on its PASSING branch) around a real,
# successful evaluate() call for EACH family (service_selector,
# content_selector).
#
# The FAILURE branches (unregistered/unported package, a thrown exception, a
# non-dict return, a candidate outside allowed_service_ids) are deliberately
# NOT captured here: Python's own test_proposal_selector.py reaches them by
# writing a fake `algorithm.py` to `tmp_path` — a filesystem technique htmlapp
# has no equivalent of (the task brief's "one place the port must NOT mirror
# Python's mechanism"). Those branches are instead covered by
# tests/proposal_selector_port.test.ts's own direct TS-logic assertions: the
# algorithm_exception branch by feeding the REAL ported
# aica_transparent_service_selector_v1 evaluator a deliberately-invalid
# trigger_purpose (still a real, dispatch_selector-mediated call — just not a
# byte-parity golden, since the exact exception message text is not asserted
# — see the task report's hazard notes), and the two branches no real
# evaluator can reach (invalid_result_shape, candidate_outside_allowed_set)
# via `dispatchSelector`'s injectable `options.evaluators` testability seam.

def _capture_proposal_selector_dispatch() -> None:
    from aica_api.services.proposal_selector import dispatch_selector
    from aica_api.models.proposal.package_manifest import ProposalPackageManifest

    service_pkg_raw = _load_json(_PACKAGES_DIR / "aica_transparent_service_selector_v1" / "package.json")
    service_pkg = ProposalPackageManifest.model_validate(service_pkg_raw)
    content_pkg_raw = _load_json(_PACKAGES_DIR / "aica_transparent_content_selector_v1" / "package.json")
    content_pkg = ProposalPackageManifest.model_validate(content_pkg_raw)

    service_ctx = _load_json(_OUT / "service_selector.json")["input"]["cases"][0]["context"]
    content_ctx = _load_json(_OUT / "content_selector.json")["input"]["cases"][0]["context"]

    inputs = []
    results = []

    # 1. service family, success, allowed_service_ids check ACTIVE and
    # passing — every candidate the real algorithm ranks/excludes for this
    # context is a member of allowed_service_ids, proving the
    # checked-and-passed branch, not merely the None-skips-the-check branch.
    ev1 = dispatch_selector(
        service_pkg, service_ctx, _PACKAGES_DIR,
        matrix_version="v-selector-dispatch-1",
        used_feature_ids=["drowsiness_level", "fatigue_level"],
        allowed_service_ids=service_ctx["allowed_service_ids"],
    )
    inputs.append({
        "name": "service_family_success_allowed_ids_checked",
        "package": service_pkg_raw,
        "context": service_ctx,
        "matrix_version": "v-selector-dispatch-1",
        "used_feature_ids": ["drowsiness_level", "fatigue_level"],
        "allowed_service_ids": service_ctx["allowed_service_ids"],
        "evidence_input_snapshot": None,
    })
    results.append({
        "name": "service_family_success_allowed_ids_checked",
        "evidence": json.loads(ev1.model_dump_json()),
    })

    # 2. content family, success, evidence_input_snapshot REDACTS the
    # persisted input_snapshot while evaluate() still runs on the full
    # context (proves the redaction seam is independent of evaluate()'s own
    # input) — allowed_service_ids intentionally omitted (content family
    # never runs that check regardless of whether it's passed).
    redacted_snapshot = {"redacted": True, "reason": "bulky read-only catalog omitted from persisted evidence"}
    ev2 = dispatch_selector(
        content_pkg, content_ctx, _PACKAGES_DIR,
        matrix_version="v-selector-dispatch-1",
        evidence_input_snapshot=redacted_snapshot,
    )
    inputs.append({
        "name": "content_family_success_redacted_snapshot",
        "package": content_pkg_raw,
        "context": content_ctx,
        "matrix_version": "v-selector-dispatch-1",
        "used_feature_ids": None,
        "allowed_service_ids": None,
        "evidence_input_snapshot": redacted_snapshot,
    })
    results.append({
        "name": "content_family_success_redacted_snapshot",
        "evidence": json.loads(ev2.model_dump_json()),
    })

    _write("proposal_selector_dispatch", {
        "input": {"cases": inputs},
        "output": {"results": results},
    })


# ---------------------------------------------------------------------------
# 29. proposal_run_manager (direct import; C2 Task 4)
# ---------------------------------------------------------------------------
#
# Exercises all 8 public functions of services/proposal_run_manager.py against
# a single scripted scenario (one "minimal" run mutated step-by-step, plus a
# "full" run exercising create_run's world/setup_snapshot/events/evidence/
# status/mode optional args, plus a dedicated single-run dir for list_runs so
# the array isn't order-ambiguous once run_id is stripped for parity).
#
# run_id/created_at are the ONLY randomness/wall-clock in this module
# (_make_run_id/_now_iso) — frozen to fixed literals post-hoc (same technique
# _capture_run_log_e2e uses for created_at) so a re-run is a git-clean no-op.
# The TS port's parity test strips both via normalizeForParity (src/engine/
# __fixtures__/transcript.ts) rather than relying on the frozen literal
# matching — see that module's VOLATILE set, which already lists run_id/
# created_at (ported run_ids use a different format on purpose).

def _capture_proposal_run_manager() -> None:
    import pathlib
    import tempfile

    from aica_api.models.proposal.enums import ProposalRunMode, ProposalRunStatus
    from aica_api.models.proposal.events import DiscreteEvent
    from aica_api.models.proposal.evidence import AlgorithmEvidence
    from aica_api.models.proposal.explanation import Explanation
    from aica_api.models.proposal.journey import JourneyState
    from aica_api.models.proposal.opportunity import ProposalOpportunity
    from aica_api.models.proposal.world import SetupSnapshot, World
    from aica_api.services import proposal_run_manager as prm

    _DATASET_ID = "soundcharts-grounded-spotify-compatible-demonstration-seed-1042"

    def _opportunity_raw(opp_id: str) -> dict:
        return {
            "opportunity_id": opp_id,
            "trigger_purpose": "rest_recommended",
            "lifecycle_stage": "after_rest_before_restart",
            "allowed_service_ids": ["live_viewing", "stretch_video"],
            "simulation_time": "2026-07-16T10:00:00Z",
            "run_seed": "seed-1",
        }

    def _journey_state_raw(**overrides: object) -> dict:
        # Pydantic-defaulted (feature 019/P4 fields filled in) so "input" is
        # already the shape the router would hand create_run/update_state --
        # the TS side never has to independently know Python's defaults.
        base = {
            "lifecycle_stage": "after_rest_before_restart",
            "motion_state": "stopped",
            "active_service_id": None,
            "active_plan_id": None,
        }
        base.update(overrides)
        return json.loads(JourneyState.model_validate(base).model_dump_json())

    def _world_raw() -> dict:
        return {
            "control_inputs": {
                "trigger_purpose": "rest_recommended",
                "lifecycle_stage": "before_rest_until_stop",
                "motion_state": "driving",
                "matrix_version": "v1",
                "dataset_id": _DATASET_ID,
            },
            "situation": {
                "drowsiness_level": 50, "fatigue_level": 50, "traffic_state": "normal",
                "road_type": "highway", "night_state": "day", "monotony_level": 50,
                "route_tags": [], "destination_tags": [], "child_present": False,
                "multiple_passengers": False, "motion_state": "driving",
                "estimated_min_until_rest_spot": 10, "rest_spot_type": "sa_pa",
                "active_service": None, "recent_service_rejections": [],
            },
            "driver_profile": {
                "oshi_registered": False, "oshi_mode": "off", "age_band": "30s", "gender": "unspecified",
            },
            "catalog_ref": {
                "dataset_id": _DATASET_ID,
                "dataset_version": {
                    "schema_version": "1.0.0",
                    "spotify_track_reference_version": "1.0.0",
                    "spotify_audio_features_reference_version": "1.0.0",
                },
                "dataset_hash": "sha256:83d8079c7a81bc6afbd01cdba65fe2330de66b900a113723814fa938fce516cd",
            },
        }

    def _setup_snapshot_raw() -> dict:
        return {
            "origin": {"seed_id": "seed-night-highway-oshi", "clone_id": None, "profile_id": None, "origin_preset_id": None},
            "matrix_version": "v1",
            "dataset_id": _DATASET_ID,
            "dataset_hash": "sha256:83d8079c7a81bc6afbd01cdba65fe2330de66b900a113723814fa938fce516cd",
            "service_package_id": "aica_transparent_service_selector_v1",
            "service_contract_version": "1.0.0",
            "content_package_id": None,
            "content_contract_version": None,
            "service_parameter_set_version": "1.0.0",
            "content_parameter_set_version": None,
            "feature_provenance": {},
        }

    create_minimal_raw = {
        "opportunity": _opportunity_raw("op-test-1"),
        "matrix_version": "v1",
        "world_snapshot": {"feature_snapshot": {}, "feature_provenance": {}},
        "service_package_id": "mock_service_selector_v1",
        "content_package_id": None,
        "parameters": {"top_k": 3},
        "hyperparameters": {"response_matrix": {}},
        "journey_state": _journey_state_raw(),
    }

    create_full_raw = {
        "opportunity": _opportunity_raw("op-test-full"),
        "matrix_version": "v1",
        "world_snapshot": {"feature_snapshot": {"drowsiness_level": 72}, "feature_provenance": {}},
        "service_package_id": "mock_service_selector_v1",
        "content_package_id": "mock_content_selector_v1",
        "parameters": {"top_k": 5},
        "hyperparameters": {"response_matrix": {"a": 1}},
        "journey_state": _journey_state_raw(active_service_id="music_playlist"),
        "events": [
            {"event_type": "OPPORTUNITY_OPENED", "at": "2026-07-16T10:00:00Z", "payload": {}},
        ],
        "evidence": [
            {
                "step": "service", "package_id": "mock_service_selector_v1", "contract_version": "1.0.0",
                "schema_version": "1.0.0", "matrix_version": "v1", "input_snapshot": {},
                "output": {"decision_type": "no_proposal"}, "error": None,
                "used_feature_ids": [], "unused_available_features": [], "missing_features": [],
            },
        ],
        "status": "service_selected",
        "mode": "quick_check",
        "world": _world_raw(),
        "setup_snapshot": _setup_snapshot_raw(),
    }

    def _build_create_kwargs(raw: dict) -> dict:
        kwargs = dict(raw)
        kwargs["opportunity"] = ProposalOpportunity.model_validate(raw["opportunity"])
        kwargs["journey_state"] = JourneyState.model_validate(raw["journey_state"])
        if "events" in raw:
            kwargs["events"] = [DiscreteEvent.model_validate(e) for e in raw["events"]]
        if "evidence" in raw:
            kwargs["evidence"] = [AlgorithmEvidence.model_validate(e) for e in raw["evidence"]]
        if "status" in raw:
            kwargs["status"] = ProposalRunStatus(raw["status"])
        if "mode" in raw:
            kwargs["mode"] = ProposalRunMode(raw["mode"])
        if "world" in raw:
            kwargs["world"] = World.model_validate(raw["world"])
        if "setup_snapshot" in raw:
            kwargs["setup_snapshot"] = SetupSnapshot.model_validate(raw["setup_snapshot"])
        return kwargs

    event_1_raw = {"event_type": "SERVICE_SELECTED", "at": "2026-07-16T10:01:00Z", "payload": {"selected_service_id": "live_viewing"}}
    event_2_raw = {"event_type": "CONTENT_SELECTED", "at": "2026-07-16T10:02:00Z", "payload": {}}
    evidence_1_raw = {
        "step": "service", "package_id": "mock_service_selector_v1", "contract_version": "1.0.0",
        "schema_version": "1.0.0", "matrix_version": "v1", "input_snapshot": {},
        "output": {"decision_type": "no_proposal"}, "error": None,
        "used_feature_ids": [], "unused_available_features": [], "missing_features": [],
    }
    evidence_2_raw = {
        "step": "content", "package_id": "mock_content_selector_v1", "contract_version": "1.0.0",
        "schema_version": "1.0.0", "matrix_version": "v1", "input_snapshot": {},
        "output": None, "error": {"category": "algorithm_exception", "message": "boom"},
        "used_feature_ids": [], "unused_available_features": [], "missing_features": [],
    }
    explanation_1_raw = {
        "step": "service", "target_id": "rest_stop", "requested_provider": "backend",
        "provider_used": "backend", "model": "qwen2.5:3b", "rationale": ["理由1", "reason1"],
        "fell_back": False, "error": None, "prompt_hash": "deadbeef1", "generated_at": "2026-07-17T00:00:00Z",
    }
    explanation_2_raw = {
        "step": "content", "target_id": "other", "requested_provider": "backend",
        "provider_used": "template", "model": "template", "rationale": ["理由2", "reason2"],
        "fell_back": True, "error": "ollama timeout", "prompt_hash": "deadbeef2", "generated_at": "2026-07-17T00:01:00Z",
    }

    update_full_raw = {
        "status": "content_selected",
        "journey_state": _journey_state_raw(motion_state="driving"),
        "content_parameters": {"volume": 0.5},
        "content_hyperparameters": {"style": "chill"},
        "setup_snapshot": _setup_snapshot_raw(),
        "opportunity": _opportunity_raw("op-test-2"),
        "world_snapshot": {"feature_snapshot": {"situation": {"drowsiness_level": 90}}, "feature_provenance": {}},
        "opportunity_history": [_opportunity_raw("op-test-0")],
        "setup_snapshot_history": [_setup_snapshot_raw()],
    }
    update_partial_raw = {"status": "content_started"}

    with tempfile.TemporaryDirectory() as td:
        runs_dir = pathlib.Path(td)

        log_min = prm.create_run(**_build_create_kwargs(create_minimal_raw), runs_dir=runs_dir)
        log_full = prm.create_run(**_build_create_kwargs(create_full_raw), runs_dir=runs_dir)

        after_event_1 = prm.append_event(log_min.run_id, DiscreteEvent.model_validate(event_1_raw), runs_dir)
        after_event_2 = prm.append_event(log_min.run_id, DiscreteEvent.model_validate(event_2_raw), runs_dir)
        after_evidence_1 = prm.append_evidence(log_min.run_id, AlgorithmEvidence.model_validate(evidence_1_raw), runs_dir)
        after_evidence_2 = prm.append_evidence(log_min.run_id, AlgorithmEvidence.model_validate(evidence_2_raw), runs_dir)
        after_explanation_1 = prm.append_explanation(log_min.run_id, Explanation.model_validate(explanation_1_raw), runs_dir)
        after_explanation_2 = prm.append_explanation(log_min.run_id, Explanation.model_validate(explanation_2_raw), runs_dir)

        update_full_kwargs = dict(update_full_raw)
        update_full_kwargs["status"] = ProposalRunStatus(update_full_raw["status"])
        update_full_kwargs["journey_state"] = JourneyState.model_validate(update_full_raw["journey_state"])
        update_full_kwargs["setup_snapshot"] = SetupSnapshot.model_validate(update_full_raw["setup_snapshot"])
        update_full_kwargs["opportunity"] = ProposalOpportunity.model_validate(update_full_raw["opportunity"])
        update_full_kwargs["opportunity_history"] = [ProposalOpportunity.model_validate(o) for o in update_full_raw["opportunity_history"]]
        update_full_kwargs["setup_snapshot_history"] = [SetupSnapshot.model_validate(s) for s in update_full_raw["setup_snapshot_history"]]
        after_update_full = prm.update_state(log_min.run_id, runs_dir, **update_full_kwargs)

        after_update_partial = prm.update_state(
            log_min.run_id, runs_dir, status=ProposalRunStatus(update_partial_raw["status"]),
        )

        get_found = prm.get_run(log_min.run_id, runs_dir)
        get_missing = prm.get_run("prun_does_not_exist_at_all", runs_dir)

        with tempfile.TemporaryDirectory() as td_list:
            list_dir = pathlib.Path(td_list)
            list_log = prm.create_run(**_build_create_kwargs(create_minimal_raw), runs_dir=list_dir)
            list_single = prm.list_runs(list_dir)
            list_empty = prm.list_runs(pathlib.Path(td_list) / "nonexistent-subdir")

            deleted_true = prm.delete_run(list_log.run_id, list_dir)
            deleted_false = prm.delete_run(list_log.run_id, list_dir)
            get_after_delete = prm.get_run(list_log.run_id, list_dir)

    def _dump(obj) -> dict:
        return json.loads(obj.model_dump_json())

    def _freeze(d: dict, run_id_literal: str) -> dict:
        d = dict(d)
        d["run_id"] = run_id_literal
        d["created_at"] = "2026-07-01T00:00:00+00:00"
        return d

    _write("proposal_run_manager", {
        "input": {
            "create_minimal": create_minimal_raw,
            "create_full": create_full_raw,
            "event_1": event_1_raw,
            "event_2": event_2_raw,
            "evidence_1": evidence_1_raw,
            "evidence_2": evidence_2_raw,
            "explanation_1": explanation_1_raw,
            "explanation_2": explanation_2_raw,
            "update_full": update_full_raw,
            "update_partial": update_partial_raw,
        },
        "output": {
            "create_minimal": _freeze(_dump(log_min), "prun_TEST_FIXED_MIN"),
            "create_full": _freeze(_dump(log_full), "prun_TEST_FIXED_FULL"),
            "after_event_1": _freeze(_dump(after_event_1), "prun_TEST_FIXED_MIN"),
            "after_event_2": _freeze(_dump(after_event_2), "prun_TEST_FIXED_MIN"),
            "after_evidence_1": _freeze(_dump(after_evidence_1), "prun_TEST_FIXED_MIN"),
            "after_evidence_2": _freeze(_dump(after_evidence_2), "prun_TEST_FIXED_MIN"),
            "after_explanation_1": _freeze(_dump(after_explanation_1), "prun_TEST_FIXED_MIN"),
            "after_explanation_2": _freeze(_dump(after_explanation_2), "prun_TEST_FIXED_MIN"),
            "after_update_full": _freeze(_dump(after_update_full), "prun_TEST_FIXED_MIN"),
            "after_update_partial": _freeze(_dump(after_update_partial), "prun_TEST_FIXED_MIN"),
            "get_found": _freeze(_dump(get_found), "prun_TEST_FIXED_MIN"),
            "get_missing": get_missing,
            "list_single": [_freeze(_dump(list_single[0]), "prun_TEST_FIXED_LIST")],
            "list_empty": list_empty,
            "deleted_true": deleted_true,
            "deleted_false": deleted_false,
            "get_after_delete": get_after_delete,
        },
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
    ("content_selector", _capture_content_selector),
    ("proposal_eligibility", _capture_eligibility),
    ("algorithm_config", _capture_algorithm_config),
    ("world_validation", _capture_world_validation),
    ("world_overrides", _capture_world_overrides),
    ("proposal_selector_dispatch", _capture_proposal_selector_dispatch),
    ("proposal_run_manager", _capture_proposal_run_manager),
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
