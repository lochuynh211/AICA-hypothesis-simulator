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
    explanation_builder.json  — services/explanation_builder's shared vocabulary + sentence
                                  machinery (label_for, feature_meaning, feature_family,
                                  situation_sentence, trigger_sentence, preference_sentence,
                                  history_sentences, score_evidence, category_readout, and
                                  the internal display/factor helpers; direct calls, one
                                  named case per branch; C3 Task 1)
    trigger_explanation.json — services/trigger_explanation's resolve_category/build_target/
                                  template + the display helpers (_num, _threshold_for,
                                  _ranked_rows, _fmt_num, _score_display, _signed_score_display,
                                  _unit_kind_for, _fmt_multiplier, _row_value_display,
                                  _row_phrase, _dead_band_reason_applies). Real fires are built
                                  from REAL nri_fatigue_score_v1 / aica_transparent_hybrid_trigger_v1
                                  algorithm.evaluate() calls (mirrors
                                  app/api/tests/proposal/test_trigger_explanation.py's own
                                  fixture-building technique) rather than hand-faked chain
                                  shapes; synthetic cases are hand-built ONLY in the recorded
                                  chain SHAPE, for edge/boundary branches a real run cannot
                                  reach on demand. C3 Task 2.

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

    # --- C2 follow-up fix wave, item 1: an apostrophe-bearing dict key.
    # `content_proposal_acceptance_rate` is BOTH a `_TRACK_ID_MAP_FIELDS`
    # entry (rule 3, catalog reference — `{key!r}` at world_validation.py:209)
    # AND a non-ServiceId-keyed percent rate map (rule 1,
    # `_validate_percent_map` — `{key!r}` at world.py:295/302); a single key
    # that is neither a real catalog track id nor a value in [0, 100]
    # independently exercises `{key!r}`'s double-quote branch at BOTH sites
    # in the SAME captured case (verified via direct capture: both issues
    # fire, each repr-quoting the same key). This is the one previously-
    # unexercised branch that was reachable with real data — no ServiceId
    # member ever contains an apostrophe (closed, fixed, snake_case enum), so
    # the sibling ServiceId-keyed maps' `<ServiceId.x: 'x'>` shape has no
    # equivalent apostrophe-bearing capture and is instead verified directly
    # against a real interpreter (see the C2 follow-up report).
    def mutate_content_proposal_acceptance_rate_apostrophe_key(w: World) -> None:
        w.driver_profile.content_proposal_acceptance_rate = {"o'brien-track": 150}
    add(
        "content_proposal_acceptance_rate_apostrophe_key",
        mutate_content_proposal_acceptance_rate_apostrophe_key,
    )

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
    # --- C2 follow-up fix wave, item 1: an apostrophe-bearing path segment,
    # proving the shared repr helper's double-quote branch is wired into
    # BOTH `_split_path`'s `{segment!r}` (malformed_path) and
    # `_get_at_path`'s `{full_path!r}`/`{token!r}` (unknown_override_path).
    # These two are the only `apply_overrides` error branches an
    # apostrophe-bearing segment can actually reach: both check an ARBITRARY
    # string against a regex / dict lookup, with no requirement that it name
    # a real field. The OTHER two `_set_at_path`-own branches
    # (list_index_out_of_range / "not an object", see
    # world_overrides_validation.test.ts) structurally CANNOT carry an
    # apostrophe — both require the "before" read (always against the
    # UNMUTATED base dict) to succeed at that exact final segment first,
    # which means the segment must be a REAL field/index name in the World
    # schema, and no field name in this schema contains an apostrophe.
    # Verified, not assumed: substituting an apostrophe-bearing segment there
    # reaches `_get_at_path`'s own "no such field" error instead (the base
    # object was never mutated by a prior override, so the field genuinely
    # doesn't exist) — never `_set_at_path`'s branch.
    add_raise("malformed_path_segment_apostrophe", [FieldOverride(path="situation.o'clock[bad]", value=10)], True)
    add_raise("unknown_path_apostrophe", [FieldOverride(path="situation.o'clock", value=1)], True)

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
# 30. proposal_journey (services/proposal_journey.apply_action — C2 Task 5)
# ---------------------------------------------------------------------------
#
# apply_action is PURE (no clock/random/IO) -- `now` is caller-supplied, so
# every case is deterministic with no post-hoc freezing needed (unlike
# proposal_run_manager.json). Each case is a fully independent
# ProposalRunLog + JourneyAction construction (not a scripted multi-step
# scenario) -- this keeps every branch isolated and separately named, and
# lets a chained scenario (e.g. reject -> choose_another) be expressed as two
# independent cases sharing hand-built state rather than a stateful replay.
#
# Real committed `service_capabilities.v1.json` is used for every case except
# the one synthetic-capabilities case explicitly proving the
# `screen_dependent and not background_on_motion` leg (unreachable via the
# real 14-service artifact -- see the task report).

def _capture_journey() -> None:
    from aica_api.models.proposal.enums import (
        JourneyActionType, LifecycleStage, MotionState, PlaybackState,
        ProposalRunStatus, ServiceId, TriggerPurpose,
    )
    from aica_api.models.proposal.evidence import AlgorithmEvidence
    from aica_api.models.proposal.journey import JourneyState, PreviousContent
    from aica_api.models.proposal.journey_action import JourneyAction
    from aica_api.models.proposal.opportunity import ProposalOpportunity
    from aica_api.models.proposal.proposal_run import ProposalRunLog
    from aica_api.models.proposal.service_capabilities import ServiceCapabilities, ServiceCapability
    from aica_api.services.proposal_journey import apply_action

    capabilities_path = _REPO / "proposal_contracts" / "service_capabilities" / "service_capabilities.v1.json"
    real_capabilities = ServiceCapabilities.load(capabilities_path)

    # All 14 real ServiceId values, in ServiceId enum declaration order --
    # used by the rank>=10 numeric-sort pin below (fix round 1).
    _ALL_SERVICE_IDS = [s.value for s in ServiceId]

    def _opportunity(opp_id: str, purpose: str, stage: str, allowed: list[str]) -> ProposalOpportunity:
        return ProposalOpportunity(
            opportunity_id=opp_id,
            trigger_purpose=TriggerPurpose(purpose),
            lifecycle_stage=LifecycleStage(stage),
            allowed_service_ids=[ServiceId(s) for s in allowed],
            simulation_time="2026-07-20T09:00:00Z",
            run_seed="seed-journey-1",
        )

    def _journey_state(**overrides: object) -> JourneyState:
        base: dict = dict(
            lifecycle_stage=LifecycleStage.active_driving_content,
            motion_state=MotionState.driving,
            active_service_id=None,
            active_plan_id=None,
            playback_state=PlaybackState.idle,
            current_plan_ref=None,
            previous_content=None,
            rejected_service_ids=[],
        )
        base.update(overrides)
        return JourneyState(**base)

    def _service_evidence(eligible_ids: list[str], ranked: list[tuple[str, int]]) -> AlgorithmEvidence:
        return AlgorithmEvidence(
            step="service", package_id="mock_service_selector_v1", contract_version="1.0.0",
            schema_version="1.0.0", matrix_version="v1",
            input_snapshot={"eligible_candidates": [{"candidate_id": cid} for cid in eligible_ids]},
            output={
                "decision_type": "ranked_candidates",
                "ranked_candidates": [{"candidate_id": cid, "rank": r} for cid, r in ranked],
            },
            error=None, used_feature_ids=[], unused_available_features=[], missing_features=[],
        )

    def _content_evidence(
        selected_service_id: str | None = None,
        next_transition_policy: str = "auto_advance",
        error: str | None = None,
    ) -> AlgorithmEvidence:
        return AlgorithmEvidence(
            step="content", package_id="mock_content_selector_v1", contract_version="1.0.0",
            schema_version="1.0.0", matrix_version="v1", input_snapshot={},
            output=None if error else {
                "selected_service_id": selected_service_id,
                "next_transition_policy": next_transition_policy,
                "approval_policy": "auto",
                "completion_rule": "duration_elapsed",
            },
            error={"category": "algorithm_exception", "message": error} if error else None,
            used_feature_ids=[], unused_available_features=[], missing_features=[],
        )

    def _run_log(
        *, status: str, journey_state: JourneyState, opportunity: ProposalOpportunity,
        evidence: list[AlgorithmEvidence] = (), world_snapshot: dict | None = None,
    ) -> ProposalRunLog:
        return ProposalRunLog(
            run_id="prun_journey_test",
            created_at="2026-07-20T09:00:00Z",
            opportunity=opportunity,
            matrix_version="v1",
            world_snapshot=world_snapshot if world_snapshot is not None else {"feature_snapshot": {}, "feature_provenance": {}},
            service_package_id="mock_service_selector_v1",
            content_package_id="mock_content_selector_v1",
            parameters={}, hyperparameters={},
            journey_state=journey_state,
            events=[], evidence=list(evidence),
            status=ProposalRunStatus(status),
        )

    cases: list[dict] = []

    def _case(
        name: str, run_log: ProposalRunLog, action_type: str, payload: dict | None = None,
        now: str = "2026-07-20T10:00:00Z", capabilities: ServiceCapabilities | None = None,
    ) -> None:
        action = JourneyAction(action_type=JourneyActionType(action_type), payload=payload or {})
        transition = apply_action(run_log, action, now=now, capabilities=capabilities)
        cases.append({
            "name": name,
            "input": {
                "run_log": json.loads(run_log.model_dump_json()),
                "action": json.loads(action.model_dump_json()),
                "now": now,
                # Array-shaped (matches the raw `service_capabilities.v1.json`
                # artifact format the TS side's `buildServiceCapabilities`
                # consumes) -- NOT `capabilities.model_dump_json()` directly,
                # which pydantic would dict-key by service_id instead.
                "capabilities": (
                    {
                        "capabilities_version": capabilities.capabilities_version,
                        "services": [json.loads(c.model_dump_json()) for c in capabilities.services.values()],
                    }
                    if capabilities is not None else None
                ),
            },
            "output": json.loads(transition.model_dump_json()),
        })

    # === reject (_reject_service): 7 cases ===================================
    _case(
        "reject_wrong_status",
        _run_log(status="content_selected", journey_state=_journey_state(), opportunity=_opportunity(
            "op-reject-1", "route_music", "active_driving_content", ["music_playlist"])),
        "reject",
    )
    _case(
        "reject_success_remaining_nonempty",
        _run_log(
            status="service_selected",
            journey_state=_journey_state(active_service_id=ServiceId.music_playlist),
            opportunity=_opportunity("op-reject-2", "route_music", "active_driving_content",
                                      ["music_playlist", "live_viewing", "stretch_video"]),
            evidence=[_service_evidence(
                ["music_playlist", "live_viewing", "stretch_video"],
                [("music_playlist", 1), ("live_viewing", 2)],
            )],
        ),
        "reject",
    )
    _case(
        "reject_invalid_payload_service_id",
        _run_log(
            status="service_selected",
            journey_state=_journey_state(active_service_id=ServiceId.music_playlist),
            opportunity=_opportunity("op-reject-3", "route_music", "active_driving_content", ["music_playlist"]),
        ),
        "reject", payload={"selected_service_id": "not_a_real_service"},
    )
    _case(
        "reject_no_offered_service",
        _run_log(
            status="service_selected", journey_state=_journey_state(active_service_id=None),
            opportunity=_opportunity("op-reject-4", "route_music", "active_driving_content", ["music_playlist"]),
        ),
        "reject",
    )
    _case(
        "reject_success_pool_exhausted_emits_no_eligible_candidate",
        _run_log(
            status="service_selected",
            journey_state=_journey_state(active_service_id=ServiceId.music_playlist),
            opportunity=_opportunity("op-reject-5", "route_music", "active_driving_content", ["music_playlist"]),
            evidence=[_service_evidence(["music_playlist"], [("music_playlist", 1)])],
        ),
        "reject",
    )
    _case(
        "reject_already_rejected_no_duplicate",
        _run_log(
            status="service_selected",
            journey_state=_journey_state(
                active_service_id=ServiceId.music_playlist,
                rejected_service_ids=[ServiceId.music_playlist],
            ),
            opportunity=_opportunity("op-reject-6", "route_music", "active_driving_content",
                                      ["music_playlist", "live_viewing"]),
            evidence=[_service_evidence(
                ["music_playlist", "live_viewing"], [("music_playlist", 1), ("live_viewing", 2)],
            )],
        ),
        "reject",
    )
    _case(
        "reject_payload_overrides_active_service",
        _run_log(
            status="service_selected",
            journey_state=_journey_state(active_service_id=ServiceId.live_viewing),
            opportunity=_opportunity("op-reject-7", "route_music", "active_driving_content",
                                      ["music_playlist", "live_viewing"]),
            evidence=[_service_evidence(
                ["music_playlist", "live_viewing"], [("music_playlist", 1), ("live_viewing", 2)],
            )],
        ),
        "reject", payload={"selected_service_id": "music_playlist"},
    )

    # === choose_another (_choose_another): 5 cases ============================
    _case(
        "choose_another_wrong_status",
        _run_log(status="content_selected", journey_state=_journey_state(), opportunity=_opportunity(
            "op-choose-1", "route_music", "active_driving_content", ["music_playlist"])),
        "choose_another",
    )
    _case(
        "choose_another_success_with_rank",
        _run_log(
            status="service_selected",
            journey_state=_journey_state(active_service_id=ServiceId.music_playlist),
            opportunity=_opportunity("op-choose-2", "route_music", "active_driving_content",
                                      ["music_playlist", "live_viewing", "stretch_video"]),
            evidence=[_service_evidence(
                ["music_playlist", "live_viewing", "stretch_video"],
                [("music_playlist", 1), ("live_viewing", 2)],
            )],
        ),
        "choose_another",
    )
    _case(
        "choose_another_success_without_rank",
        _run_log(
            status="service_selected",
            journey_state=_journey_state(active_service_id=ServiceId.music_playlist),
            opportunity=_opportunity("op-choose-3", "route_music", "active_driving_content",
                                      ["music_playlist", "stretch_video"]),
            evidence=[_service_evidence(["music_playlist", "stretch_video"], [("music_playlist", 1)])],
        ),
        "choose_another",
    )
    _case(
        "choose_another_no_further_candidate",
        _run_log(
            status="service_selected",
            journey_state=_journey_state(
                active_service_id=ServiceId.music_playlist,
                rejected_service_ids=[ServiceId.live_viewing],
            ),
            opportunity=_opportunity("op-choose-4", "route_music", "active_driving_content",
                                      ["music_playlist", "live_viewing"]),
            evidence=[_service_evidence(
                ["music_playlist", "live_viewing"], [("music_playlist", 1), ("live_viewing", 2)],
            )],
        ),
        "choose_another",
    )
    _case(
        "choose_another_defensive_invalid_pool_candidate",
        _run_log(
            status="service_selected",
            journey_state=_journey_state(active_service_id=None),
            opportunity=_opportunity("op-choose-5", "route_music", "active_driving_content", ["music_playlist"]),
            evidence=[_service_evidence(["bogus_service_xyz"], [])],
        ),
        "choose_another",
    )

    # === request_more (_request_more): 4 cases =================================
    _case(
        "request_more_wrong_status",
        _run_log(status="created", journey_state=_journey_state(), opportunity=_opportunity(
            "op-more-1", "route_music", "active_driving_content", ["music_playlist"])),
        "request_more",
    )
    _case(
        "request_more_success_nonempty",
        _run_log(
            status="service_selected", journey_state=_journey_state(active_service_id=ServiceId.music_playlist),
            opportunity=_opportunity("op-more-2", "route_music", "active_driving_content",
                                      ["music_playlist", "live_viewing"]),
            evidence=[_service_evidence(
                ["music_playlist", "live_viewing"], [("music_playlist", 1), ("live_viewing", 2)],
            )],
        ),
        "request_more",
    )
    _case(
        "request_more_success_empty_all_rejected",
        _run_log(
            status="service_selected",
            journey_state=_journey_state(
                active_service_id=ServiceId.music_playlist,
                rejected_service_ids=[ServiceId.music_playlist, ServiceId.live_viewing],
            ),
            opportunity=_opportunity("op-more-3", "route_music", "active_driving_content",
                                      ["music_playlist", "live_viewing"]),
            evidence=[_service_evidence(
                ["music_playlist", "live_viewing"], [("music_playlist", 1), ("live_viewing", 2)],
            )],
        ),
        "request_more",
    )
    # Pins eligiblePool's numeric rank sort (journey.ts:222-224) against a
    # regression to a bare `.sort()`: all 14 real ServiceIds, ranked 14
    # DOWN TO 1 (reverse of both insertion order and the correct output
    # order) so the ONLY way `remaining_candidate_ids` comes out correctly
    # ascending-by-rank is a genuine numeric comparator. Fix round 1 (C2
    # Task 5 review): the prior fixture never used a rank >= 10, the only
    # range where numeric and (a hypothetical) lexicographic-of-the-rank
    # sort would diverge -- see the task report for what actually happens
    # with a bare `.sort()` on this object array (empirically confirmed,
    # not assumed).
    _case(
        "request_more_rank_ge_10_pins_numeric_sort",
        _run_log(
            status="service_selected",
            journey_state=_journey_state(active_service_id=ServiceId.music_playlist),
            opportunity=_opportunity("op-more-4", "route_music", "active_driving_content", _ALL_SERVICE_IDS),
            evidence=[_service_evidence(
                _ALL_SERVICE_IDS, list(zip(_ALL_SERVICE_IDS, range(14, 0, -1))),
            )],
        ),
        "request_more",
    )

    # === postpone (_postpone): 3 cases ==========================================
    _case(
        "postpone_wrong_status",
        _run_log(status="content_started", journey_state=_journey_state(playback_state=PlaybackState.active),
                  opportunity=_opportunity("op-postpone-1", "route_music", "active_driving_content", ["music_playlist"])),
        "postpone",
    )
    _case(
        "postpone_from_service_selected",
        _run_log(status="service_selected", journey_state=_journey_state(active_service_id=ServiceId.music_playlist),
                  opportunity=_opportunity("op-postpone-2", "route_music", "active_driving_content", ["music_playlist"])),
        "postpone",
    )
    _case(
        "postpone_from_content_selected",
        _run_log(status="content_selected", journey_state=_journey_state(active_service_id=ServiceId.music_playlist),
                  opportunity=_opportunity("op-postpone-3", "route_music", "active_driving_content", ["music_playlist"])),
        "postpone",
    )

    # === accept (_accept): 3 cases ==============================================
    _case(
        "accept_wrong_status",
        _run_log(status="service_selected", journey_state=_journey_state(),
                  opportunity=_opportunity("op-accept-1", "route_music", "active_driving_content", ["music_playlist"])),
        "accept",
    )
    _case(
        "accept_no_committed_plan",
        _run_log(
            status="content_selected", journey_state=_journey_state(active_service_id=ServiceId.music_playlist),
            opportunity=_opportunity("op-accept-2", "route_music", "active_driving_content", ["music_playlist"]),
            evidence=[_content_evidence(error="boom")],
        ),
        "accept",
    )
    _case(
        "accept_success",
        _run_log(
            status="content_selected", journey_state=_journey_state(active_service_id=ServiceId.music_playlist),
            opportunity=_opportunity("op-accept-3", "route_music", "active_driving_content", ["music_playlist"]),
            evidence=[_content_evidence(selected_service_id="music_playlist", next_transition_policy="auto_advance")],
        ),
        "accept",
    )

    # === complete (_complete): 2 cases ==========================================
    _case(
        "complete_wrong_playback_state",
        _run_log(status="content_started", journey_state=_journey_state(playback_state=PlaybackState.idle),
                  opportunity=_opportunity("op-complete-1", "route_music", "active_driving_content", ["music_playlist"])),
        "complete",
    )
    _case(
        "complete_success",
        _run_log(
            status="content_started",
            journey_state=_journey_state(active_service_id=ServiceId.music_playlist, playback_state=PlaybackState.active),
            opportunity=_opportunity("op-complete-2", "route_music", "active_driving_content", ["music_playlist"]),
        ),
        "complete",
    )

    # === continue_ (_continue): 3 cases =========================================
    _case(
        "continue_wrong_playback_state",
        _run_log(status="content_started", journey_state=_journey_state(playback_state=PlaybackState.active),
                  opportunity=_opportunity("op-continue-1", "route_music", "active_driving_content", ["music_playlist"])),
        "continue",
    )
    _case(
        "continue_no_committed_plan",
        _run_log(
            status="content_completed",
            journey_state=_journey_state(active_service_id=ServiceId.music_playlist, playback_state=PlaybackState.completed),
            opportunity=_opportunity("op-continue-2", "route_music", "active_driving_content", ["music_playlist"]),
            evidence=[_content_evidence(error="boom")],
        ),
        "continue",
    )
    _case(
        "continue_success",
        _run_log(
            status="content_completed",
            journey_state=_journey_state(active_service_id=ServiceId.music_playlist, playback_state=PlaybackState.completed),
            opportunity=_opportunity("op-continue-3", "route_music", "active_driving_content", ["music_playlist"]),
            evidence=[_content_evidence(selected_service_id="music_playlist", next_transition_policy="auto_advance")],
        ),
        "continue",
    )

    # === stop (_stop): 4 cases ===================================================
    _case(
        "stop_wrong_playback_state",
        _run_log(status="content_selected", journey_state=_journey_state(playback_state=PlaybackState.idle),
                  opportunity=_opportunity("op-stop-1", "route_music", "active_driving_content", ["music_playlist"])),
        "stop",
    )
    _case(
        "stop_from_active_no_previous_content",
        _run_log(
            status="content_started",
            journey_state=_journey_state(active_service_id=ServiceId.music_playlist, playback_state=PlaybackState.active,
                                          previous_content=None),
            opportunity=_opportunity("op-stop-2", "route_music", "active_driving_content", ["music_playlist"]),
        ),
        "stop",
    )
    _case(
        "stop_from_backgrounded_with_previous_content",
        _run_log(
            status="content_started",
            journey_state=_journey_state(
                active_service_id=ServiceId.live_viewing, playback_state=PlaybackState.backgrounded,
                previous_content=PreviousContent(service_id=ServiceId.music_playlist, plan_ref="music_playlist-plan"),
            ),
            opportunity=_opportunity("op-stop-3", "route_music", "active_driving_content",
                                      ["music_playlist", "live_viewing"]),
        ),
        "stop",
    )
    _case(
        "stop_from_completed_no_previous_content",
        _run_log(
            status="content_completed",
            journey_state=_journey_state(active_service_id=ServiceId.music_playlist, playback_state=PlaybackState.completed,
                                          previous_content=None),
            opportunity=_opportunity("op-stop-4", "route_music", "active_driving_content", ["music_playlist"]),
        ),
        "stop",
    )

    # === motion_change (_motion_change): 10 cases ===============================
    _case(
        "motion_change_capabilities_unavailable",
        _run_log(status="service_selected", journey_state=_journey_state(),
                  opportunity=_opportunity("op-motion-1", "route_music", "active_driving_content", ["music_playlist"])),
        "motion_change", payload={"motion_state": "stopped"}, capabilities=None,
    )
    _case(
        "motion_change_invalid_payload_motion_state",
        _run_log(status="service_selected", journey_state=_journey_state(),
                  opportunity=_opportunity("op-motion-2", "route_music", "active_driving_content", ["music_playlist"])),
        "motion_change", payload={"motion_state": "flying"}, capabilities=real_capabilities,
    )
    _case(
        "motion_change_no_active_plan",
        _run_log(
            status="service_selected",
            journey_state=_journey_state(active_service_id=None, playback_state=PlaybackState.idle),
            opportunity=_opportunity("op-motion-3", "route_music", "active_driving_content", ["music_playlist"]),
        ),
        "motion_change", payload={"motion_state": "stopped"}, capabilities=real_capabilities,
    )
    _case(
        "motion_change_driving_background_on_motion",
        _run_log(
            status="content_started",
            journey_state=_journey_state(active_service_id=ServiceId.live_viewing, motion_state=MotionState.stopped,
                                          playback_state=PlaybackState.active),
            opportunity=_opportunity("op-motion-4", "route_music", "active_driving_content", ["live_viewing"]),
        ),
        "motion_change", payload={"motion_state": "driving"}, capabilities=real_capabilities,
    )
    _case(
        "motion_change_driving_stopped_only",
        _run_log(
            status="content_started",
            journey_state=_journey_state(active_service_id=ServiceId.stretch_video, motion_state=MotionState.stopped,
                                          playback_state=PlaybackState.active),
            opportunity=_opportunity("op-motion-5", "route_music", "active_driving_content", ["stretch_video"]),
        ),
        "motion_change", payload={"motion_state": "driving"}, capabilities=real_capabilities,
    )
    _case(
        "motion_change_driving_full_karaoke_special_case",
        _run_log(
            status="content_started",
            journey_state=_journey_state(active_service_id=ServiceId.full_karaoke, motion_state=MotionState.stopped,
                                          playback_state=PlaybackState.active),
            opportunity=_opportunity("op-motion-6", "route_music", "active_driving_content", ["full_karaoke"]),
        ),
        "motion_change", payload={"motion_state": "driving"}, capabilities=real_capabilities,
    )
    _case(
        "motion_change_driving_unchanged_audio_only",
        _run_log(
            status="content_started",
            journey_state=_journey_state(active_service_id=ServiceId.music_playlist, motion_state=MotionState.stopped,
                                          playback_state=PlaybackState.active),
            opportunity=_opportunity("op-motion-7", "route_music", "active_driving_content", ["music_playlist"]),
        ),
        "motion_change", payload={"motion_state": "driving"}, capabilities=real_capabilities,
    )
    synthetic_service = ServiceCapability(
        service_id=ServiceId.music_playlist, driving_capable=True, screen_dependent=True,
        stopped_only=False, background_on_motion=False, lighting_compatible=True, requires_entity=None,
    )
    synthetic_caps = ServiceCapabilities(
        capabilities_version="synthetic-branch-coverage",
        services={ServiceId.music_playlist: synthetic_service},
    )
    _case(
        "motion_change_driving_screen_dependent_not_backgroundable_synthetic",
        _run_log(
            status="content_started",
            journey_state=_journey_state(active_service_id=ServiceId.music_playlist, motion_state=MotionState.stopped,
                                          playback_state=PlaybackState.active),
            opportunity=_opportunity("op-motion-8", "route_music", "active_driving_content", ["music_playlist"]),
        ),
        "motion_change", payload={"motion_state": "driving"}, capabilities=synthetic_caps,
    )
    # Isolates the LEFTMOST leg of the 3-way `or` (`active_service_id ==
    # full_karaoke`) from the `stopped_only` leg immediately after it: the
    # real committed full_karaoke capability has stopped_only=True too, so
    # motion_change_driving_full_karaoke_special_case above can't prove leg
    # 1 fires independently of leg 2. This synthetic full_karaoke capability
    # sets stopped_only=False AND screen_dependent=False (so leg 3 can't
    # fire either) -- the ONLY way this case reaches "stopped" is via
    # `active_service_id == full_karaoke` itself. Fix round 1 (C2 Task 5
    # review) -- same synthetic-capability technique as the case above.
    synthetic_full_karaoke = ServiceCapability(
        service_id=ServiceId.full_karaoke, driving_capable=False, screen_dependent=False,
        stopped_only=False, background_on_motion=False, lighting_compatible=True, requires_entity=None,
    )
    synthetic_full_karaoke_caps = ServiceCapabilities(
        capabilities_version="synthetic-branch-coverage-full-karaoke-leg",
        services={ServiceId.full_karaoke: synthetic_full_karaoke},
    )
    _case(
        "motion_change_driving_full_karaoke_leg_isolated_synthetic",
        _run_log(
            status="content_started",
            journey_state=_journey_state(active_service_id=ServiceId.full_karaoke, motion_state=MotionState.stopped,
                                          playback_state=PlaybackState.active),
            opportunity=_opportunity("op-motion-8b", "route_music", "active_driving_content", ["full_karaoke"]),
        ),
        "motion_change", payload={"motion_state": "driving"}, capabilities=synthetic_full_karaoke_caps,
    )
    _case(
        "motion_change_stopped_from_backgrounded_resumes_active",
        _run_log(
            status="content_started",
            journey_state=_journey_state(active_service_id=ServiceId.live_viewing, motion_state=MotionState.driving,
                                          playback_state=PlaybackState.backgrounded),
            opportunity=_opportunity("op-motion-9", "route_music", "active_driving_content", ["live_viewing"]),
        ),
        "motion_change", payload={"motion_state": "stopped"}, capabilities=real_capabilities,
    )
    _case(
        "motion_change_stopped_from_active_stays_unchanged",
        _run_log(
            status="content_started",
            journey_state=_journey_state(active_service_id=ServiceId.music_playlist, motion_state=MotionState.driving,
                                          playback_state=PlaybackState.active),
            opportunity=_opportunity("op-motion-10", "route_music", "active_driving_content", ["music_playlist"]),
        ),
        "motion_change", payload={"motion_state": "stopped"}, capabilities=real_capabilities,
    )

    # === rest_spot_arrived (_rest_spot_arrived): 2 cases ========================
    _case(
        "rest_spot_arrived_wrong_purpose",
        _run_log(status="service_selected", journey_state=_journey_state(lifecycle_stage=LifecycleStage.active_driving_content),
                  opportunity=_opportunity("op-rsa-1", "route_music", "active_driving_content", ["music_playlist"])),
        "rest_spot_arrived",
    )
    _case(
        "rest_spot_arrived_success",
        _run_log(
            status="created",
            journey_state=_journey_state(lifecycle_stage=LifecycleStage.before_rest_until_stop, motion_state=MotionState.driving),
            opportunity=_opportunity("op-rsa-2", "rest_recommended", "before_rest_until_stop", ["live_viewing"]),
        ),
        "rest_spot_arrived",
    )

    # === rest_started (_rest_started): 2 cases ==================================
    _case(
        "rest_started_wrong_lifecycle_stage",
        _run_log(status="created", journey_state=_journey_state(lifecycle_stage=LifecycleStage.before_rest_until_stop),
                  opportunity=_opportunity("op-rst-1", "rest_recommended", "before_rest_until_stop", ["live_viewing"])),
        "rest_started",
    )
    _case(
        "rest_started_success",
        _run_log(
            status="created",
            journey_state=_journey_state(lifecycle_stage=LifecycleStage.during_rest_stopped, motion_state=MotionState.stopped),
            opportunity=_opportunity("op-rst-2", "rest_recommended", "during_rest_stopped", ["live_viewing"]),
        ),
        "rest_started",
    )

    # === rest_completed (_rest_completed): 5 cases ==============================
    _case(
        "rest_completed_wrong_lifecycle_stage",
        _run_log(status="created", journey_state=_journey_state(lifecycle_stage=LifecycleStage.before_rest_until_stop),
                  opportunity=_opportunity("op-rc-1", "rest_recommended", "before_rest_until_stop", ["live_viewing"])),
        "rest_completed", payload={"post_rest": {"drowsiness_level": 20, "fatigue_level": 15}},
    )
    _case(
        "rest_completed_missing_post_rest",
        _run_log(status="created",
                  journey_state=_journey_state(lifecycle_stage=LifecycleStage.during_rest_stopped, motion_state=MotionState.stopped),
                  opportunity=_opportunity("op-rc-2", "rest_recommended", "during_rest_stopped", ["live_viewing"])),
        "rest_completed", payload={},
    )
    _case(
        "rest_completed_drowsiness_out_of_range",
        _run_log(status="created",
                  journey_state=_journey_state(lifecycle_stage=LifecycleStage.during_rest_stopped, motion_state=MotionState.stopped),
                  opportunity=_opportunity("op-rc-3", "rest_recommended", "during_rest_stopped", ["live_viewing"])),
        "rest_completed", payload={"post_rest": {"drowsiness_level": 150, "fatigue_level": 20}},
    )
    _case(
        "rest_completed_fatigue_is_boolean_not_int",
        _run_log(status="created",
                  journey_state=_journey_state(lifecycle_stage=LifecycleStage.during_rest_stopped, motion_state=MotionState.stopped),
                  opportunity=_opportunity("op-rc-4", "rest_recommended", "during_rest_stopped", ["live_viewing"])),
        "rest_completed", payload={"post_rest": {"drowsiness_level": 20, "fatigue_level": True}},
    )
    _case(
        "rest_completed_success",
        _run_log(status="created",
                  journey_state=_journey_state(lifecycle_stage=LifecycleStage.during_rest_stopped, motion_state=MotionState.stopped),
                  opportunity=_opportunity("op-rc-5", "rest_recommended", "during_rest_stopped", ["live_viewing"])),
        "rest_completed", payload={"post_rest": {"drowsiness_level": 20, "fatigue_level": 15}},
    )

    # === apply_action dispatch fallback: unrecognized action_type (1 case) =====
    # Bypasses pydantic validation via model_construct -- mirrors the
    # docstring's own "fabricated/bypassed value" defensive scenario; a
    # normal JourneyAction(action_type=...) can never hold a value outside
    # the closed JourneyActionType enum.
    bogus_run_log = _run_log(status="created", journey_state=_journey_state(),
                              opportunity=_opportunity("op-bogus-1", "route_music", "active_driving_content", ["music_playlist"]))
    bogus_action = JourneyAction.model_construct(action_type="totally_bogus_action_type", payload={})
    bogus_transition = apply_action(bogus_run_log, bogus_action, now="2026-07-20T10:00:00Z")
    cases.append({
        "name": "apply_action_unrecognized_action_type",
        "input": {
            "run_log": json.loads(bogus_run_log.model_dump_json()),
            "action": {"action_type": "totally_bogus_action_type", "payload": {}},
            "now": "2026-07-20T10:00:00Z",
            "capabilities": None,
        },
        "output": json.loads(bogus_transition.model_dump_json()),
    })

    _write("proposal_journey", {
        "input": {"cases": [{"name": c["name"], **c["input"]} for c in cases]},
        "output": {"results": [{"name": c["name"], "transition": c["output"]} for c in cases]},
    })


# ---------------------------------------------------------------------------
# 31. proposal_journey_preview (services/proposal_journey_preview.preview — C2 Task 5)
# ---------------------------------------------------------------------------

def _capture_journey_preview() -> None:
    from aica_api.models.proposal.enums import LifecycleStage, MotionState, PlaybackState, ProposalRunStatus, ServiceId, TriggerPurpose
    from aica_api.models.proposal.evidence import AlgorithmEvidence
    from aica_api.models.proposal.journey import JourneyState
    from aica_api.models.proposal.opportunity import ProposalOpportunity
    from aica_api.models.proposal.proposal_run import ProposalRunLog
    from aica_api.services.proposal_journey_preview import preview

    def _opportunity(opp_id: str, purpose: str, stage: str, allowed: list[str]) -> ProposalOpportunity:
        return ProposalOpportunity(
            opportunity_id=opp_id, trigger_purpose=TriggerPurpose(purpose), lifecycle_stage=LifecycleStage(stage),
            allowed_service_ids=[ServiceId(s) for s in allowed],
            simulation_time="2026-07-20T09:00:00Z", run_seed="seed-preview-1",
        )

    def _journey_state(**overrides: object) -> JourneyState:
        base: dict = dict(
            lifecycle_stage=LifecycleStage.before_rest_until_stop, motion_state=MotionState.driving,
            active_service_id=None, active_plan_id=None, playback_state=PlaybackState.idle,
            current_plan_ref=None, previous_content=None, rejected_service_ids=[],
        )
        base.update(overrides)
        return JourneyState(**base)

    def _content_evidence(selected_service_id: str, next_transition_policy: str) -> AlgorithmEvidence:
        return AlgorithmEvidence(
            step="content", package_id="mock_content_selector_v1", contract_version="1.0.0",
            schema_version="1.0.0", matrix_version="v1", input_snapshot={},
            output={
                "selected_service_id": selected_service_id, "next_transition_policy": next_transition_policy,
                "approval_policy": "auto", "completion_rule": "duration_elapsed",
            },
            error=None, used_feature_ids=[], unused_available_features=[], missing_features=[],
        )

    def _run_log(*, journey_state: JourneyState, opportunity: ProposalOpportunity,
                 evidence: list[AlgorithmEvidence] = ()) -> ProposalRunLog:
        return ProposalRunLog(
            run_id="prun_preview_test", created_at="2026-07-20T09:00:00Z", opportunity=opportunity,
            matrix_version="v1", world_snapshot={"feature_snapshot": {}, "feature_provenance": {}},
            service_package_id="mock_service_selector_v1", content_package_id="mock_content_selector_v1",
            parameters={}, hyperparameters={}, journey_state=journey_state, events=[],
            evidence=list(evidence), status=ProposalRunStatus.content_selected,
        )

    cases: list[dict] = []

    def _case(name: str, run_log: ProposalRunLog) -> None:
        result = preview(run_log)
        cases.append({
            "name": name,
            "input": {"run_log": json.loads(run_log.model_dump_json())},
            "output": json.loads(result.model_dump_json()),
        })

    _case(
        "rest_chain_from_before_rest",
        _run_log(
            journey_state=_journey_state(lifecycle_stage=LifecycleStage.before_rest_until_stop),
            opportunity=_opportunity("op-prev-1", "rest_recommended", "before_rest_until_stop", ["live_viewing"]),
        ),
    )
    _case(
        "rest_chain_from_during_rest",
        _run_log(
            journey_state=_journey_state(lifecycle_stage=LifecycleStage.during_rest_stopped, motion_state=MotionState.stopped),
            opportunity=_opportunity("op-prev-2", "rest_recommended", "during_rest_stopped", ["live_viewing"]),
        ),
    )
    _case(
        "rest_chain_from_after_rest",
        _run_log(
            journey_state=_journey_state(lifecycle_stage=LifecycleStage.after_rest_before_restart),
            opportunity=_opportunity("op-prev-3", "rest_recommended", "after_rest_before_restart", ["live_viewing"]),
        ),
    )
    _case(
        "active_content_chain_with_policy_note",
        _run_log(
            journey_state=_journey_state(
                lifecycle_stage=LifecycleStage.active_driving_content, active_service_id=ServiceId.music_playlist,
            ),
            opportunity=_opportunity("op-prev-4", "route_music", "active_driving_content", ["music_playlist"]),
            evidence=[_content_evidence("music_playlist", "auto_advance")],
        ),
    )
    _case(
        "active_content_chain_no_committed_plan_note_none",
        _run_log(
            journey_state=_journey_state(lifecycle_stage=LifecycleStage.active_driving_content),
            opportunity=_opportunity("op-prev-5", "inattentive_driving_prevention_recovery",
                                      "active_driving_content", ["music_playlist"]),
        ),
    )
    # rest_recommended purpose, but journey_state.lifecycle_stage is NOT one
    # of the three rest stages (no cross-validator ties journey_state's
    # lifecycle_stage to the opportunity's own -- they're independent
    # fields) -- exercises `_rest_chain_from`'s `next(..., 0)` not-found
    # fallback. Expected to be byte-IDENTICAL to "rest_chain_from_before_rest"
    # (see the task report): `next(..., 0)` defaults to the SAME index 0 a
    # found match at `before_rest_until_stop` would give.
    _case(
        "rest_chain_stage_not_found_falls_back_to_full_chain",
        _run_log(
            journey_state=_journey_state(lifecycle_stage=LifecycleStage.active_driving_content),
            opportunity=_opportunity("op-prev-6", "rest_recommended", "before_rest_until_stop", ["live_viewing"]),
        ),
    )

    _write("proposal_journey_preview", {
        "input": {"cases": [{"name": c["name"], **c["input"]} for c in cases]},
        "output": {"results": [{"name": c["name"], "preview": c["output"]} for c in cases]},
    })


# ---------------------------------------------------------------------------
# 31. explanation_builder (direct calls — C3 task 1, shared vocabulary +
#     sentence machinery every step module builds on)
# ---------------------------------------------------------------------------
#
# Every case below is named for the branch it targets (see task-1-report.md's
# branch-coverage table for the full cross-reference). Two cases
# ("real_service_candidate"/"real_content_item") are pulled from the ALREADY
# COMMITTED service_selector.json / content_selector.json goldens (real
# algorithm.evaluate() output, not hand-authored) so at least one case per
# function runs against a genuine candidate/item shape, not just synthetic
# boundary probes. The rest are hand-authored dicts shaped exactly like the
# real `RankedCandidate` / `OrderedItem` / `FeatureContribution` /
# `ItemFeatureContribution` contracts (see app/api/aica_api/models/proposal/
# service_output.py + content_output.py) — this file's own capture rig has
# precedent for hand-authored "input" cases (see e.g. _capture_driver_signals,
# _capture_anomaly: "preserve existing inputs, re-derive outputs"), and a
# pure function operating on plain dicts does not need a full algorithm run
# to exercise a specific branch honestly.

def _capture_explanation_builder() -> None:
    from aica_api.services import explanation_builder as eb

    # ── real candidate/item pulled from already-committed goldens ──────────
    service_selector_golden = _load_json(_OUT / "service_selector.json")
    real_service_candidate = None
    for case in service_selector_golden["output"]["results"]:
        cands = case["decision"].get("ranked_candidates") or []
        if cands:
            real_service_candidate = cands[0]
            break
    assert real_service_candidate is not None, "no ranked_candidates in service_selector.json to sample from"

    content_selector_golden = _load_json(_OUT / "content_selector.json")
    real_content_item = None
    for case in content_selector_golden["output"]["results"]:
        items = case["decision"].get("ordered_items") or []
        if items:
            real_content_item = items[0]
            break
    assert real_content_item is not None, "no ordered_items in content_selector.json to sample from"

    # ======================================================================
    # label_for / feature_meaning
    # ======================================================================
    label_ids = [
        "drowsiness_level", "drowsiness", "oshi_artists", "continuous_driving_min",
        "totally_unknown_feature", "",
    ]
    labels_out = {fid: eb.label_for(fid) for fid in label_ids}

    meaning_ids = ["drowsiness_level", "age_band", "driving_anomaly", "totally_unknown_feature"]
    meanings_out = {fid: eb.feature_meaning(fid) for fid in meaning_ids}

    # ======================================================================
    # feature_family
    # ======================================================================
    family_ids = [
        "drowsiness_level", "drowsiness", "oshi_artists", "catalog_item_usage_level",
        "service_recovery_rate", "motion_state", "totally_unknown",
    ]
    family_out = {fid: eb.feature_family(fid) for fid in family_ids}

    # ======================================================================
    # _value_display
    # ======================================================================
    value_display_cases = [
        ("bool_true", True), ("bool_false", False),
        ("numeric_high", 0.72), ("numeric_medium", 0.50), ("numeric_low", 0.20),
        ("numeric_boundary_high_0.62", 0.62), ("numeric_boundary_medium_0.40", 0.40),
        ("string_passthrough", "heavy"), ("string_empty", ""), ("none_value", None),
    ]
    value_display_out = {name: eb._value_display(v) for name, v in value_display_cases}

    # ======================================================================
    # _lvl3
    # ======================================================================
    lvl3_cases = [
        ("none", None, 0.34, 0.66),
        ("low", 0.10, 0.34, 0.66),
        ("boundary_lo_is_mid_not_low", 0.34, 0.34, 0.66),
        ("mid", 0.50, 0.34, 0.66),
        ("boundary_hi_is_high", 0.66, 0.34, 0.66),
        ("high", 0.99, 0.34, 0.66),
    ]
    lvl3_out = {name: eb._lvl3(v, lo, hi) for name, v, lo, hi in lvl3_cases}

    # ======================================================================
    # _reason_row_value / _reason_row_contribution (direct)
    # ======================================================================
    def _row_target(rows):
        return {"feature_contributions": rows}

    reason_row_cases = {
        "feature_value_branch": {
            "target": _row_target([{"feature_id": "drowsiness_level", "feature_value": 70, "contribution": 0.1}]),
            "feature_ids": ["drowsiness_level", "drowsiness"],
        },
        "e_i_scaled_branch": {
            "target": _row_target([{"feature_id": "drowsiness", "e_i": 0.5, "contribution": 0.1}]),
            "feature_ids": ["drowsiness_level", "drowsiness"],
        },
        "no_match": {
            "target": _row_target([{"feature_id": "traffic_state", "feature_value": "heavy", "contribution": 0.1}]),
            "feature_ids": ["drowsiness_level", "drowsiness"],
        },
        "contribution_non_numeric": {
            "target": _row_target([{"feature_id": "drowsiness_level", "feature_value": 70, "contribution": None}]),
            "feature_ids": ["drowsiness_level", "drowsiness"],
        },
        "matched_row_but_neither_value_field_present": {
            "target": _row_target([{"feature_id": "drowsiness_level", "contribution": 0.02}]),
            "feature_ids": ["drowsiness_level", "drowsiness"],
        },
        # ── divergence hazard 8 (design doc): isinstance(x, (int, float))
        # accepts bool in Python; a naive `typeof x === 'number'` TS guard
        # does not. These four synthetic cases (a bool can never reach here
        # from real Pydantic-typed evidence, hence hand-constructed rather
        # than pulled from a golden) pin `_reason_row_value`'s `e_i` branch
        # and `_reason_row_contribution`'s own guard on both True and False.
        "e_i_bool_true_scaled_branch": {
            "target": _row_target([{"feature_id": "drowsiness", "e_i": True, "contribution": 0.1}]),
            "feature_ids": ["drowsiness_level", "drowsiness"],
        },
        "e_i_bool_false_scaled_branch": {
            "target": _row_target([{"feature_id": "drowsiness", "e_i": False, "contribution": 0.1}]),
            "feature_ids": ["drowsiness_level", "drowsiness"],
        },
        "contribution_bool_true": {
            "target": _row_target([{"feature_id": "drowsiness_level", "feature_value": 70, "contribution": True}]),
            "feature_ids": ["drowsiness_level", "drowsiness"],
        },
        "contribution_bool_false": {
            "target": _row_target([{"feature_id": "drowsiness_level", "feature_value": 70, "contribution": False}]),
            "feature_ids": ["drowsiness_level", "drowsiness"],
        },
    }
    reason_row_out = {}
    for name, spec in reason_row_cases.items():
        reason_row_out[name] = {
            "value": eb._reason_row_value(spec["target"], *spec["feature_ids"]),
            "contribution": eb._reason_row_contribution(spec["target"], *spec["feature_ids"]),
        }

    # ======================================================================
    # _factors_from_target
    # ======================================================================
    factors_cases = {
        "normal_sort_and_band": _row_target([
            {"feature_id": "drowsiness_level", "feature_value": 80, "e_i": None, "contribution": 0.05},
            {"feature_id": "traffic_state", "feature_value": "heavy", "contribution": 0.20},
            {"feature_id": "monotony_level", "feature_value": 50, "contribution": -0.10},
        ]),
        "drop_negligible": _row_target([
            {"feature_id": "drowsiness_level", "feature_value": 80, "contribution": 0.05},
            {"feature_id": "road_type", "feature_value": "highway", "contribution": 1e-8},
        ]),
        "missing_value_blank_display": _row_target([
            {"feature_id": "oshi_artists", "contribution": 0.05},
        ]),
        "string_value_passthrough": _row_target([
            {"feature_id": "drowsiness_level", "feature_value": "heavy", "contribution": 0.3},
        ]),
        # divergence hazard 8 (design doc): `contribution = float(fc.get(...)
        # or 0.0)` treats a bool contribution as truthy/falsy, not just
        # "is it a number" — True -> 1.0 (kept), False -> 0.0 (falls below
        # _MIN_ABS_CONTRIBUTION and is dropped, same as an absent/zero row).
        # Hand-constructed: contribution is Pydantic-typed float on real
        # evidence, so a bool value cannot arrive from a real run.
        "bool_contribution_true_kept_false_dropped": _row_target([
            {"feature_id": "drowsiness_level", "feature_value": 80, "contribution": True},
            {"feature_id": "road_type", "feature_value": "highway", "contribution": False},
        ]),
        "cap_at_max_factors": _row_target([
            {"feature_id": f"synthetic_feature_{i:02d}", "feature_value": 50, "contribution": (i + 1) * 0.01}
            for i in range(30)
        ]),
        "stable_sort_ties": _row_target([
            {"feature_id": "feature_a", "feature_value": 50, "contribution": 0.05},
            {"feature_id": "feature_b", "feature_value": 50, "contribution": -0.05},
            {"feature_id": "feature_c", "feature_value": 50, "contribution": 0.05},
        ]),
        "real_service_candidate": real_service_candidate,
        "real_content_item": real_content_item,
    }
    factors_out = {name: eb._factors_from_target(t) for name, t in factors_cases.items()}

    # ======================================================================
    # situation_sentence
    # ======================================================================
    situation_cases = {
        "none_when_no_situation_rows": {
            "target": _row_target([{"feature_id": "oshi_artists", "e_i": 1.0, "contribution": 0.1}]),
            "trigger_purpose": None, "contributing_only": False,
        },
        "alert_engaging_fatigue_excluded": {
            "target": _row_target([
                {"feature_id": "drowsiness_level", "feature_value": 10, "contribution": 0.05},
                {"feature_id": "monotony_level", "feature_value": 15, "contribution": 0.02},
                {"feature_id": "fatigue_level", "feature_value": 40, "contribution": 0.01},
            ]),
            "trigger_purpose": None, "contributing_only": False,
        },
        "getting_drowsy_and_a_little_monotonous_and_fatigue_boundaries": {
            "target": _row_target([
                {"feature_id": "drowsiness_level", "feature_value": 30, "contribution": 0.05},
                {"feature_id": "monotony_level", "feature_value": 35, "contribution": 0.02},
                {"feature_id": "fatigue_level", "feature_value": 55, "contribution": 0.01},
            ]),
            "trigger_purpose": None, "contributing_only": False,
        },
        "very_drowsy_and_very_monotonous_boundary_via_e_i": {
            "target": _row_target([
                {"feature_id": "drowsiness", "e_i": 0.60, "contribution": 0.1},
                {"feature_id": "monotony", "e_i": 0.60, "contribution": 0.1},
            ]),
            "trigger_purpose": None, "contributing_only": False,
        },
        "night_traffic_road_with_rest_trigger_neutral_lead": {
            "target": _row_target([
                {"feature_id": "night_state", "feature_value": "night", "contribution": 0.01},
                {"feature_id": "traffic_state", "feature_value": "heavy", "contribution": 0.02},
                {"feature_id": "road_type", "feature_value": "mountain_road", "contribution": 0.0},
            ]),
            "trigger_purpose": "rest_recommended", "contributing_only": False,
        },
        "traffic_normal_excluded_env_empty_period_only": {
            "target": _row_target([
                {"feature_id": "drowsiness_level", "feature_value": 50, "contribution": 0.05},
                {"feature_id": "traffic_state", "feature_value": "normal", "contribution": 0.02},
            ]),
            "trigger_purpose": None, "contributing_only": False,
        },
        "very_drowsy_feature_value_no_env": {
            "target": _row_target([{"feature_id": "drowsiness_level", "feature_value": 85, "contribution": 0.1}]),
            "trigger_purpose": None, "contributing_only": False,
        },
        "contributing_only_all_gated_out_returns_null": {
            "target": _row_target([
                {"feature_id": "drowsiness_level", "feature_value": 70, "contribution": 0.0},
                {"feature_id": "monotony_level", "feature_value": 65, "contribution": 0.0},
            ]),
            "trigger_purpose": "route_music", "contributing_only": True,
        },
        "contributing_only_keeps_meaningful_drowsiness": {
            "target": _row_target([{"feature_id": "drowsiness_level", "feature_value": 70, "contribution": 0.25}]),
            "trigger_purpose": "inattentive_driving_prevention_recovery", "contributing_only": True,
        },
        "contributing_only_partial_gate_neutral_fallback_with_env": {
            "target": _row_target([
                {"feature_id": "drowsiness_level", "feature_value": 70, "contribution": 0.0},
                {"feature_id": "night_state", "feature_value": "night", "contribution": 0.02},
            ]),
            "trigger_purpose": "route_music", "contributing_only": True,
        },
        "content_default_ignores_contribution_magnitude": {
            "target": _row_target([{"feature_id": "drowsiness_level", "feature_value": 70, "contribution": 0.0}]),
            "trigger_purpose": "route_music", "contributing_only": False,
        },
        "real_service_candidate_contributing_only": {
            "target": real_service_candidate,
            "trigger_purpose": "inattentive_driving_prevention_recovery", "contributing_only": True,
        },
        "real_content_item_default": {
            "target": real_content_item,
            "trigger_purpose": "route_music", "contributing_only": False,
        },
    }
    situation_out = {}
    for name, spec in situation_cases.items():
        situation_out[name] = eb.situation_sentence(spec["target"], spec["trigger_purpose"], spec["contributing_only"])

    # ======================================================================
    # trigger_sentence
    # ======================================================================
    trigger_sentence_cases = {
        "known_purpose_rest_recommended_motion_stopped": {
            "trigger_purpose": "rest_recommended",
            "target": _row_target([{"feature_id": "motion_state", "feature_value": "stopped", "contribution": 0.0}]),
            "lifecycle_stage": None,
        },
        "known_purpose_inattentive_motion_driving": {
            "trigger_purpose": "inattentive_driving_prevention_recovery",
            "target": _row_target([{"feature_id": "motion_state", "feature_value": "driving", "contribution": 0.0}]),
            "lifecycle_stage": None,
        },
        "known_purpose_route_music_lifecycle_fallback_moving": {
            "trigger_purpose": "route_music",
            "target": _row_target([]),
            "lifecycle_stage": "active_driving_content",
        },
        "known_purpose_child_passenger_lifecycle_fallback_stopped": {
            "trigger_purpose": "child_passenger_experience",
            "target": _row_target([]),
            "lifecycle_stage": "during_rest_stopped",
        },
        "unknown_truthy_purpose": {
            "trigger_purpose": "some_future_purpose",
            "target": _row_target([]),
            "lifecycle_stage": None,
        },
        "falsy_purpose_none": {
            "trigger_purpose": None,
            "target": _row_target([]),
            "lifecycle_stage": None,
        },
        "before_rest_until_stop_is_still_moving_trap": {
            "trigger_purpose": "rest_recommended",
            "target": _row_target([]),
            "lifecycle_stage": "before_rest_until_stop",
        },
        "after_rest_before_restart_is_stopped": {
            "trigger_purpose": "rest_recommended",
            "target": _row_target([]),
            "lifecycle_stage": "after_rest_before_restart",
        },
        "motion_value_uppercase_case_insensitive": {
            "trigger_purpose": "route_music",
            "target": _row_target([{"feature_id": "motion_state", "feature_value": "STOPPED", "contribution": 0.0}]),
            "lifecycle_stage": None,
        },
        "motion_value_parked": {
            "trigger_purpose": "route_music",
            "target": _row_target([{"feature_id": "motion", "feature_value": "parked", "contribution": 0.0}]),
            "lifecycle_stage": None,
        },
    }
    trigger_sentence_out = {}
    for name, spec in trigger_sentence_cases.items():
        trigger_sentence_out[name] = eb.trigger_sentence(spec["trigger_purpose"], spec["target"], spec["lifecycle_stage"])

    # ======================================================================
    # preference_sentence
    # ======================================================================
    preference_cases = {
        "oshi_artist_only": {"oshi_artist": "YOASOBI"},
        "empty_context_returns_null": {},
        "oshi_registered_false": {"driver_profile": {"oshi_registered": False}},
        "genres_high_and_med_real_enum_only_high_matches": {
            "driver_profile": {"usage_by_genre": {"jpop": "high", "rock": "med"}, "age_band": "20s"},
        },
        "genres_literal_mid_string_also_matches": {
            "driver_profile": {"usage_by_genre": {"anime_song": "mid"}},
        },
        "age_band_via_context_fallback": {
            "driver_profile": {}, "age_band": "30s",
        },
        "all_three_parts_capitalization_and_join": {
            "oshi_artist": "YOASOBI",
            "driver_profile": {"usage_by_genre": {"jpop": "high"}, "age_band": "20s"},
        },
    }
    preference_out = {name: eb.preference_sentence(ctx) for name, ctx in preference_cases.items()}

    # ======================================================================
    # history_sentences
    # ======================================================================
    history_cases = {
        "content_rows_usage_acceptance_played": _row_target([
            {"feature_id": "catalog_item_usage_level", "e_i": 0.9, "contribution": 0.1},
            {"feature_id": "content_proposal_acceptance_rate", "e_i": 0.95, "contribution": 0.1},
            {"feature_id": "played_items", "e_i": 1.0, "contribution": 0.05},
        ]),
        "service_rows_recovery_and_usage_mid": _row_target([
            {"feature_id": "service_recovery_rate", "e_i": 0.9, "contribution": 0.1},
            {"feature_id": "service_usage_level", "e_i": 0.5, "contribution": 0.05},
        ]),
        "empty_no_history_rows": _row_target([
            {"feature_id": "drowsiness_level", "feature_value": 80, "contribution": 0.1},
        ]),
        "unhandled_history_fid_falls_through_silently": _row_target([
            {"feature_id": "changed_from_items", "e_i": 1.0, "contribution": 0.05},
        ]),
        "skipped_items_recent": _row_target([
            {"feature_id": "skipped_items", "e_i": 1.0, "contribution": 0.03},
        ]),
        "content_tag_usage_mid_and_scene_high": _row_target([
            {"feature_id": "content_tag_usage_level", "e_i": 0.5, "contribution": 0.02},
            {"feature_id": "scene_content_tag_usage_level", "e_i": 0.9, "contribution": 0.02},
        ]),
        "service_proposal_acceptance_high": _row_target([
            {"feature_id": "service_proposal_acceptance_rate", "e_i": 0.95, "contribution": 0.03},
        ]),
        "service_recency_state_non_normal": _row_target([
            {"feature_id": "service_recency_state", "feature_value": "long_unused", "contribution": 0.02},
        ]),
        "service_recency_state_normal_absorbed_silently": _row_target([
            {"feature_id": "service_recency_state", "feature_value": "normal", "contribution": 0.02},
        ]),
        "dedupe_two_fids_same_sentence_text": _row_target([
            {"feature_id": "service_usage_level", "e_i": 0.9, "contribution": 0.02},
            {"feature_id": "scene_service_usage_level", "e_i": 0.9, "contribution": 0.02},
        ]),
        "content_recovery_rate_high": _row_target([
            {"feature_id": "content_recovery_rate", "e_i": 0.9, "contribution": 0.05},
        ]),
        "feature_value_scaling_above_and_below_one": _row_target([
            # fv=90 > 1 -> scaled /100 -> 0.9 -> high -> "often" (catalog_item_usage_level)
            {"feature_id": "catalog_item_usage_level", "feature_value": 90, "contribution": 0.02},
            # fv=0.5 <= 1 -> used UNSCALED -> mid -> "sometimes" (service_usage_level, via the
            # feature_value fallback path rather than e_i — both scaling branches exercised here)
            {"feature_id": "service_usage_level", "feature_value": 0.5, "contribution": 0.02},
        ]),
        # divergence hazard 8 (design doc): `e` starts as `fc.get("e_i")`;
        # `isinstance(e, (int, float))` accepts a bool `e_i` as-is (True/False
        # compare numerically as 1/0 in `_lvl3`), and when `e_i` is absent the
        # `feature_value` fallback's own `isinstance(fv, (int, float))` guard
        # accepts a bool `fv` the same way. Hand-constructed: both fields are
        # Pydantic-typed float on real evidence, so a bool cannot arrive from
        # a real run.
        "history_e_i_bool_true_recovery_high": _row_target([
            {"feature_id": "content_recovery_rate", "e_i": True, "contribution": 0.1},
        ]),
        "history_e_i_bool_false_recovery_low_no_sentence": _row_target([
            {"feature_id": "content_recovery_rate", "e_i": False, "contribution": 0.1},
        ]),
        "history_feature_value_bool_true_usage_high": _row_target([
            {"feature_id": "catalog_item_usage_level", "feature_value": True, "contribution": 0.05},
        ]),
        "history_feature_value_bool_false_usage_low_no_sentence": _row_target([
            {"feature_id": "catalog_item_usage_level", "feature_value": False, "contribution": 0.05},
        ]),
        "real_service_candidate": real_service_candidate,
        "real_content_item": real_content_item,
    }
    history_out = {name: eb.history_sentences(t) for name, t in history_cases.items()}

    # ======================================================================
    # _score_strength (direct)
    # ======================================================================
    score_strength_cases = [
        ("positive_major", 0.30), ("positive_major_boundary_0.08", 0.08),
        ("positive_significant", 0.05), ("positive_significant_boundary_0.04", 0.04),
        ("positive_minor", 0.02), ("positive_minor_boundary_0.015", 0.015),
        ("positive_slight", 0.005),
        ("negative_strongly", -0.30), ("negative_strongly_boundary_0.08", -0.08),
        ("negative_moderately", -0.05), ("negative_moderately_boundary_0.04", -0.04),
        ("negative_slightly", -0.01),
        ("exact_zero_reads_as_slightly_against", 0.0),
    ]
    score_strength_out = {name: eb._score_strength(c) for name, c in score_strength_cases}

    # ======================================================================
    # score_evidence
    # ======================================================================
    def _factor(fid, label_en, contribution):
        return {"feature_id": fid, "label_en": label_en, "label_ja": label_en, "contribution": contribution,
                "value": None, "value_display": "", "meaning": ""}

    score_evidence_cases = {
        "oshi_positive_with_artist_name": (
            [_factor("oshi_artists", "oshi (favorite-artist) match", 0.30)], "YOASOBI",
        ),
        "oshi_positive_without_artist_name": (
            [_factor("oshi_artists", "oshi (favorite-artist) match", 0.30)], None,
        ),
        "oshi_negative_falls_back_to_plain_label": (
            [_factor("oshi_artists", "oshi (favorite-artist) match", -0.10)], "YOASOBI",
        ),
        "mixed_tiers_four_positive_and_three_negative": (
            [
                _factor("a", "feat a", 0.30), _factor("b", "feat b", 0.05),
                _factor("c", "feat c", 0.02), _factor("d", "feat d", 0.010),
                _factor("e", "feat e", -0.30), _factor("f", "feat f", -0.05),
            ], None,
        ),
        "mixed_tiers_negative_slightly_via_score_evidence": (
            [_factor("g", "feat g", -0.01)], None,
        ),
        "skip_below_0.008_threshold": (
            [_factor("a", "feat a", 0.30), _factor("b", "feat b", 0.005), _factor("c", "feat c", 0.02)], None,
        ),
        "cap_at_first_six_no_resort": (
            [_factor(f"f{i}", f"feat {i}", 0.01 * (i + 1)) for i in range(8)], None,
        ),
    }
    score_evidence_out = {name: eb.score_evidence(factors, oshi) for name, (factors, oshi) in score_evidence_cases.items()}

    # ======================================================================
    # category_readout
    # ======================================================================
    category_cases = {
        "dominant_situation": {"situation_fit": 0.30, "preference_fit": 0.05, "history_fit": -0.02},
        "dominant_preference_by_magnitude": {"situation_fit": 0.04, "preference_fit": -0.20, "history_fit": 0.03},
        "dominant_history": {"situation_fit": 0.01, "preference_fit": 0.01, "history_fit": 0.5},
        "none_when_no_subtotals": {"item_id": "x"},
        "partial_only_situation_and_preference": {"situation_fit": 0.02, "preference_fit": 0.10},
        "tie_situation_vs_preference_first_wins": {"situation_fit": 0.05, "preference_fit": -0.05, "history_fit": 0.01},
        "tie_preference_vs_history_first_present_wins": {"preference_fit": -0.08, "history_fit": 0.08},
        "real_service_candidate": real_service_candidate,
        "real_content_item": real_content_item,
    }
    category_out = {name: eb.category_readout(t) for name, t in category_cases.items()}

    # ======================================================================
    # shared kernel constants the step modules (tasks 2-3) read off `_k.*`
    # ======================================================================
    constants_out = {
        "MAX_FACTORS": eb.MAX_FACTORS,
        "MIN_ABS_CONTRIBUTION": eb._MIN_ABS_CONTRIBUTION,
        "CONTRIBUTING_THRESHOLD": eb._CONTRIBUTING_THRESHOLD,
        "CONTENT_LANG_SEP": eb._CONTENT_LANG_SEP,
        "FORMAT_REMINDER": eb._FORMAT_REMINDER,
        "REASON_CLOSING": eb._REASON_CLOSING,
        "CONTENT_REASON_SYSTEM": eb._CONTENT_REASON_SYSTEM,
        "SERVICE_REASON_SYSTEM": eb._SERVICE_REASON_SYSTEM,
    }

    _write("explanation_builder", {
        "input": {
            "label_ids": label_ids,
            "meaning_ids": meaning_ids,
            "family_ids": family_ids,
            "value_display_cases": [{"name": n, "value": v} for n, v in value_display_cases],
            "lvl3_cases": [{"name": n, "v": v, "lo": lo, "hi": hi} for n, v, lo, hi in lvl3_cases],
            "reason_row_cases": reason_row_cases,
            "factors_cases": factors_cases,
            "situation_cases": situation_cases,
            "trigger_sentence_cases": trigger_sentence_cases,
            "preference_cases": preference_cases,
            "history_cases": history_cases,
            "score_strength_cases": [{"name": n, "c": c} for n, c in score_strength_cases],
            "score_evidence_cases": {
                name: {"factors": factors, "oshi_artist": oshi} for name, (factors, oshi) in score_evidence_cases.items()
            },
            "category_cases": category_cases,
        },
        "output": {
            "labels": labels_out,
            "meanings": meanings_out,
            "family": family_out,
            "value_display": value_display_out,
            "lvl3": lvl3_out,
            "reason_row": reason_row_out,
            "factors": factors_out,
            "situation": situation_out,
            "trigger_sentence": trigger_sentence_out,
            "preference": preference_out,
            "history": history_out,
            "score_strength": score_strength_out,
            "score_evidence": score_evidence_out,
            "category": category_out,
            "constants": constants_out,
        },
    })


# ---------------------------------------------------------------------------
# 32. trigger_explanation (direct calls — C3 task 2, trigger-fire rank-1
#     rationale target-building + template rendering)
# ---------------------------------------------------------------------------
#
# Real fires are built from REAL nri_fatigue_score_v1 /
# aica_transparent_hybrid_trigger_v1 algorithm.evaluate() calls — the SAME
# signal/context/prev-state recipes app/api/tests/proposal/
# test_trigger_explanation.py itself uses (duplicated here rather than
# imported, since that module's fixtures are pytest.fixture-wrapped and not
# directly callable outside a pytest session) — so the fixture exercises
# genuine recorded chain shapes, not a hand-faked one. Edge/boundary cases a
# real run cannot reach on demand (malformed rows, an explicit unrecognized
# category, a bool score/threshold, a dead-band zero row, ...) are
# hand-built, but ONLY in the recorded chain SHAPE (feature_id/value/band/
# weight/contribution), mirroring that test module's own precedent for when
# a synthetic-but-legally-shaped chain is fair game.

def _capture_trigger_explanation() -> None:
    from aica_api.services import trigger_explanation as te
    import importlib.util

    def _load_alg_module(name, path):
        spec = importlib.util.spec_from_file_location(name, path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    nri_dir = _PACKAGES_DIR / "nri_fatigue_score_v1"
    hybrid_dir = _PACKAGES_DIR / "aica_transparent_hybrid_trigger_v1"

    def _hp(pkg_dir):
        data = _load_json(pkg_dir / "package.json")
        return {hp["key"]: hp["default"] for hp in data["hyperparameters"]}

    nri = _load_alg_module("nri_alg_trigger_explain_capture", nri_dir / "algorithm.py")
    hybrid = _load_alg_module("hybrid_alg_trigger_explain_capture", hybrid_dir / "algorithm.py")
    nri_hp = _hp(nri_dir)
    hybrid_hp = _hp(hybrid_dir)

    empty_ph = {
        "lastProposalTimeSec": None, "lastProposalCategory": None,
        "lastProposalResult": None, "proposalCountLast30Min": 0,
        "acceptanceRateRecent": 0.0,
    }

    # ── NRI real-run fire builders (mirrors test_trigger_explanation.py) ──

    def _nri_signals(**overrides):
        signals = {
            "fixed": {"isNight": False, "familiarRoute": False, "childPassenger": False, "weatherRiskLevel": 0.0},
            "dynamic": {
                "segmentType": "normal_road", "motionState": "MOVING",
                "continuousDrivingMin": 0.0, "speedKph": 80.0, "routeFraction": 0.0,
                "nextRestSpotMin": 9999.0, "isTrafficJam": False, "recoveryPhase": None,
            },
            "simulated": {"drowsiness": 0.0, "fatigue": 0.0, "anomaly_rate": 0.0},
        }
        for key, value in overrides.items():
            for group in signals.values():
                if key in group:
                    group[key] = value
        return signals

    def _nri_ctx(signals, prev_state=None, sim_time=60.0):
        return {
            "simulation_time_sec": sim_time,
            "signals": signals,
            "feature_groups": {"normalized": {}, "ordinal": {"signal_duration": "transient"}},
            "hyperparameters": nri_hp,
            "parameters": {},
            "proposal_history": dict(empty_ph),
            "user_action_history": [],
            "package_runtime_state": prev_state or {},
            "recovery_active": False,
        }

    def _nri_primed_state(driving_min_since_rest=None):
        if driving_min_since_rest is None:
            driving_min_since_rest = nri_hp["threshold_fire"] / nri_hp["w_base"]
        return {
            "cumulative_jam_min": 0.0, "cumulative_highway_min": 0.0,
            "cumulative_monotonous_min": 0.0,
            "driving_min_since_rest": driving_min_since_rest,
            "last_sim_time": 0.0, "was_in_recovery": False,
        }

    def _nri_between_thresholds_state():
        target = (nri_hp["threshold_monotony"] + nri_hp["threshold_fire"]) / 2.0
        driving_min = target / nri_hp["w_base"] - 1.0
        return _nri_primed_state(driving_min_since_rest=driving_min)

    def _fire_from_result(result, tick=1, time_min=1.0):
        category = result["selected_category"]
        strength = next((c.get("strength") for c in result["candidates"] if c["category"] == category), None)
        return {
            "category": category, "strength": strength, "tick": tick, "time_min": time_min,
            "feature_contributions": result["feature_contributions"], "criteria": result["criteria"],
        }

    nri_rest_fire = _fire_from_result(
        nri.evaluate(_nri_ctx(_nri_signals(), prev_state=_nri_primed_state(), sim_time=60.0))
    )
    assert nri_rest_fire["category"] == "rest_required", "setup sanity"

    nri_monotony_fire = _fire_from_result(
        nri.evaluate(_nri_ctx(_nri_signals(), prev_state=_nri_between_thresholds_state(), sim_time=60.0))
    )
    assert nri_monotony_fire["category"] == "monotony_prevention", "setup sanity"

    nri_drowsiness_led_fire = _fire_from_result(
        nri.evaluate(_nri_ctx(
            _nri_signals(drowsiness=100.0, fatigue=0.0),
            prev_state=_nri_primed_state(driving_min_since_rest=90.0), sim_time=60.0,
        ))
    )
    assert nri_drowsiness_led_fire["category"] == "rest_required", "setup sanity"

    # ── Hybrid real-run fire builder ──

    def _hybrid_signals(**overrides):
        signals = {
            "fixed": {"isNight": False, "familiarRoute": False, "childPassenger": False, "weatherRiskLevel": 0.0},
            "dynamic": {
                "segmentType": "normal_road", "motionState": "MOVING",
                "continuousDrivingMin": 0.0, "speedKph": 80.0, "routeFraction": 0.0,
                "nextRestSpotMin": 9999.0, "isTrafficJam": False, "recoveryPhase": None,
            },
            "simulated": {"drowsiness": 0.0, "fatigue": 0.0, "anomaly_rate": 0.0},
        }
        for key, value in overrides.items():
            for group in signals.values():
                if key in group:
                    group[key] = value
        return signals

    hybrid_high_signals = _hybrid_signals(drowsiness=85.0, fatigue=85.0, anomaly_rate=6.0, nextRestSpotMin=10.0)

    def _hybrid_ctx(signals, prev_state=None, sim_time=3600.0):
        return {
            "simulation_time_sec": sim_time,
            "signals": signals,
            "feature_groups": {"normalized": {}, "ordinal": {}},
            "hyperparameters": hybrid_hp,
            "parameters": {},
            "proposal_history": dict(empty_ph),
            "user_action_history": [],
            "package_runtime_state": prev_state or {},
            "recovery_active": False,
        }

    def _hybrid_steady_state(signals, counter_rest):
        accumulators = {"jam_min": 0.0, "hw_min": 0.0, "mono_min": 0.0}
        feats = hybrid.extract_features(signals, accumulators, hybrid_hp)
        scores = hybrid.category_scores(feats, hybrid_hp)
        return {
            "smoothed_features": dict(feats),
            "smoothed_scores": {
                "rest_required_score": scores["rest_required_score"],
                "monotony_prevention_score": scores["monotony_prevention_score"],
            },
            "persistence_counters": {"rest_required": counter_rest, "monotony_prevention": 0},
            "states": {"rest_state": "REST_NORMAL", "monotony_state": "MONOTONY_NORMAL"},
            "accumulators": accumulators,
        }

    hybrid_prev = _hybrid_steady_state(hybrid_high_signals, counter_rest=int(hybrid_hp["rest_persistence_ticks"]) - 1)
    hybrid_rest_fire = _fire_from_result(hybrid.evaluate(_hybrid_ctx(hybrid_high_signals, prev_state=hybrid_prev)))
    assert hybrid_rest_fire["category"] == "rest_required", "setup sanity"

    # ======================================================================
    # resolve_category
    # ======================================================================
    resolve_category_cases = {
        "defaults_to_fires_own_category": {"fire": nri_rest_fire, "category": None},
        "explicit_choice_wins_over_fires_own": {"fire": nri_rest_fire, "category": "monotony_prevention"},
        "empty_string_category_falls_through_to_fires_own": {"fire": nri_rest_fire, "category": ""},
        "falls_back_to_highest_scoring_chain_when_both_absent": {
            "fire": {
                "category": None,
                "feature_contributions": {
                    "rest_required": {"score": 12.0, "clamped": False, "rows": [], "gates": []},
                    "monotony_prevention": {"score": 40.0, "clamped": False, "rows": [], "gates": []},
                },
            },
            "category": None,
        },
        "none_when_fire_carries_no_chains": {
            "fire": {"category": None, "feature_contributions": {}}, "category": None,
        },
        "zero_score_chain_still_wins_when_it_is_the_highest": {
            "fire": {
                "category": None,
                "feature_contributions": {
                    "rest_required": {"score": 0.0, "clamped": False, "rows": [], "gates": []},
                    "monotony_prevention": {"score": -5.0, "clamped": False, "rows": [], "gates": []},
                },
            },
            "category": None,
        },
        "picks_rest_required_when_it_is_the_higher_scoring_chain": {
            "fire": {
                "category": None,
                "feature_contributions": {
                    "rest_required": {"score": 90.0, "clamped": False, "rows": [], "gates": []},
                    "monotony_prevention": {"score": 40.0, "clamped": False, "rows": [], "gates": []},
                },
            },
            "category": None,
        },
        # divergence hazard 8 (design doc): resolve_category's inner
        # _chain_score is the ONE isinstance guard in this whole module that
        # does NOT exclude bool (line 117) — a bool score IS accepted and
        # coerced (True -> 1.0, False -> 0.0). Hand-constructed: a chain's
        # `score` is always a real float from either package's algorithm.py.
        "bool_score_true_accepted_as_1.0_wins_the_tiebreak": {
            "fire": {
                "category": None,
                "feature_contributions": {
                    "rest_required": {"score": True, "clamped": False, "rows": [], "gates": []},
                    "monotony_prevention": {"score": 0.5, "clamped": False, "rows": [], "gates": []},
                },
            },
            "category": None,
        },
        "bool_score_false_accepted_as_0.0_loses_the_tiebreak": {
            "fire": {
                "category": None,
                "feature_contributions": {
                    "rest_required": {"score": False, "clamped": False, "rows": [], "gates": []},
                    "monotony_prevention": {"score": 0.5, "clamped": False, "rows": [], "gates": []},
                },
            },
            "category": None,
        },
        # divergence hazard 4 (design doc): max(chains, key=...) only
        # replaces the incumbent on a STRICTLY greater score, so a genuine
        # TIE resolves to whichever key comes FIRST in `chains`' own
        # insertion/dict order — this is exactly what happens on every REAL
        # NRI fire (NRI publishes ONE raw score banded by TWO thresholds, so
        # rest_required/monotony_prevention always carry the IDENTICAL
        # score — see the Python module's own docstring). Reusing
        # nri_rest_fire's real (tied) chains with category forced back to
        # None proves the tie-break picks "rest_required" because it is
        # inserted FIRST by `_build_feature_contributions`
        # (packages/nri_fatigue_score_v1/algorithm.py), not because it is
        # hardcoded or alphabetically first.
        "tie_real_nri_scores_first_key_in_insertion_order_wins": {
            "fire": {"category": None, "feature_contributions": nri_rest_fire["feature_contributions"]},
            "category": None,
        },
    }
    resolve_category_out = {
        name: te.resolve_category(spec["fire"], spec["category"]) for name, spec in resolve_category_cases.items()
    }

    # ======================================================================
    # build_target
    # ======================================================================
    build_target_cases = {
        "flattens_chain_and_criteria": {"fire": nri_rest_fire, "category": "rest_required"},
        "degrades_to_an_empty_chain_for_an_unresolved_category": {"fire": {"feature_contributions": {}}, "category": None},
        "category_not_in_chains_degrades_too": {"fire": nri_rest_fire, "category": "totally_unknown_category"},
        "criteria_missing_key_defaults_to_empty": {
            "fire": {
                "category": "rest_required",
                "feature_contributions": {"rest_required": {"score": 10.0, "clamped": False, "rows": [], "gates": []}},
            },
            "category": "rest_required",
        },
        "rows_and_gates_explicit_null_default_to_empty_list": {
            "fire": {
                "category": "rest_required",
                "feature_contributions": {"rest_required": {"score": 10.0, "clamped": False, "rows": None, "gates": None}},
                "criteria": {},
            },
            "category": "rest_required",
        },
        "tick_time_min_strength_pass_through": {"fire": nri_rest_fire, "category": "rest_required"},
    }
    build_target_out = {
        name: te.build_target(spec["fire"], spec["category"]) for name, spec in build_target_cases.items()
    }

    # ======================================================================
    # _num
    # ======================================================================
    num_cases = [
        ("plain_float", 5.5), ("plain_int", 5), ("negative", -3.2), ("zero", 0.0),
        ("bool_true_excluded_reads_as_0", True), ("bool_false_excluded_reads_as_0", False),
        ("string_excluded", "abc"), ("none_excluded", None),
    ]
    num_out = {name: te._num(v) for name, v in num_cases}

    # ======================================================================
    # _threshold_for
    # ======================================================================
    threshold_for_cases = {
        "rest_required_threshold_fire_present": {"category": "rest_required", "criteria": {"threshold_fire": 100.0}},
        "rest_required_falls_back_to_threshold_suggest": {
            "category": "rest_required", "criteria": {"threshold_suggest": 0.7},
        },
        "rest_required_priority_threshold_fire_wins_over_suggest": {
            "category": "rest_required", "criteria": {"threshold_fire": 100.0, "threshold_suggest": 0.7},
        },
        "monotony_prevention_threshold_monotony_present": {
            "category": "monotony_prevention", "criteria": {"threshold_monotony": 60.0},
        },
        "monotony_prevention_falls_back_to_monotony_suggest_threshold": {
            "category": "monotony_prevention", "criteria": {"monotony_suggest_threshold": 0.4},
        },
        "monotony_prevention_priority_threshold_monotony_wins": {
            "category": "monotony_prevention", "criteria": {"threshold_monotony": 60.0, "monotony_suggest_threshold": 0.4},
        },
        "none_category_no_candidate_keys": {"category": None, "criteria": {"threshold_fire": 100.0}},
        "unknown_category_no_candidate_keys": {"category": "totally_unknown_category", "criteria": {"threshold_fire": 100.0}},
        "criteria_missing_all_candidate_keys": {"category": "rest_required", "criteria": {}},
        # divergence hazard 8 (design doc): _threshold_for excludes bool
        # (isinstance(v,(int,float)) and not isinstance(v,bool)) — a bool
        # threshold_fire is skipped, falling through to the next candidate
        # key (or None if exhausted). Hand-constructed: criteria values are
        # always real floats from a package's algorithm.py.
        "bool_first_key_excluded_falls_to_second_key": {
            "category": "rest_required", "criteria": {"threshold_fire": True, "threshold_suggest": 0.7},
        },
        "bool_first_key_excluded_no_second_key_present_returns_none": {
            "category": "rest_required", "criteria": {"threshold_fire": True},
        },
        "string_value_excluded": {"category": "rest_required", "criteria": {"threshold_fire": "not_a_number"}},
    }
    threshold_for_out = {
        name: te._threshold_for(spec["category"], spec["criteria"]) for name, spec in threshold_for_cases.items()
    }

    # ======================================================================
    # _ranked_rows
    # ======================================================================
    ranked_rows_cases = {
        "normal_sort_descending_by_abs_contribution": [
            {"feature_id": "a", "value": 1.0, "band": None, "weight": 1.0, "contribution": 5.0},
            {"feature_id": "b", "value": 1.0, "band": None, "weight": 1.0, "contribution": -20.0},
            {"feature_id": "c", "value": 1.0, "band": None, "weight": 1.0, "contribution": 10.0},
        ],
        "stable_sort_ties_preserve_original_order": [
            {"feature_id": "x", "value": 1.0, "band": None, "weight": 1.0, "contribution": 5.0},
            {"feature_id": "y", "value": 1.0, "band": None, "weight": 1.0, "contribution": -5.0},
            {"feature_id": "z", "value": 1.0, "band": None, "weight": 1.0, "contribution": 5.0},
        ],
        "malformed_rows_dropped_not_raised": [
            None, {"feature_id": "x", "contribution": 3.0}, "not_a_dict", {"contribution": "not_a_number"},
        ],
        "empty_list": [],
        "none_rows_default_to_empty": None,
        "real_nri_rest_rows": nri_rest_fire["feature_contributions"]["rest_required"]["rows"],
        "real_hybrid_rest_rows": hybrid_rest_fire["feature_contributions"]["rest_required"]["rows"],
    }
    ranked_rows_out = {name: te._ranked_rows(rows) for name, rows in ranked_rows_cases.items()}

    # ======================================================================
    # _fmt_num — hazard 7 primary site: banker's-rounding ties at both the
    # .0f (abs>1.5) and .2f (abs<=1.5) branches.
    # ======================================================================
    fmt_num_cases = [
        ("large_scale_tie_2.5_banker_rounds_to_even_2", 2.5),
        ("large_scale_tie_4.5_banker_rounds_to_even_4", 4.5),
        ("large_scale_non_tie", 89.3),
        ("large_scale_negative", -104.0),
        ("boundary_exactly_1.5_uses_2f_branch", 1.5),
        ("boundary_just_above_1.5_uses_0f_branch", 1.5000001),
        ("small_scale_tie_0.125_banker_rounds_to_even_0.12", 0.125),
        ("small_scale_non_tie", 0.781),
        ("small_scale_negative", -0.125),
        ("zero", 0.0),
    ]
    fmt_num_out = {name: te._fmt_num(v) for name, v in fmt_num_cases}

    # ======================================================================
    # _score_display
    # ======================================================================
    score_display_cases = [
        ("nri_scale_raw_score", 63.5),
        ("nri_scale_threshold", 100.0),
        ("hybrid_scale_clamped_score", 0.781),
        ("hybrid_scale_threshold", 0.7),
        ("boundary_1.5_hybrid_branch", 1.5),
        ("tie_2.5_points_branch", 2.5),
        ("zero", 0.0),
    ]
    score_display_out = {name: te._score_display(v) for name, v in score_display_cases}

    # ======================================================================
    # _signed_score_display
    # ======================================================================
    signed_score_display_cases = [
        ("positive_clearance_points_scale", 4.0),
        ("negative_clearance_points_scale", -4.0),
        ("zero_clearance_reads_as_plus", 0.0),
        ("positive_clearance_fraction_scale", 0.081),
        ("negative_clearance_fraction_scale", -0.081),
        ("negative_zero_reads_as_plus", -0.0),
    ]
    signed_score_display_out = {name: te._signed_score_display(v) for name, v in signed_score_display_cases}

    # ======================================================================
    # _unit_kind_for — every table kind + the monotony disambiguation floor
    # ======================================================================
    unit_kind_for_cases = [
        ("table_minutes_continuous_driving_min", "continuous_driving_min", 52.0),
        ("table_minutes_traffic_jam", "traffic_jam", 12.0),
        ("table_minutes_long_highway", "long_highway", 40.0),
        ("table_level_drowsiness", "drowsiness", 66.8),
        ("table_level_fatigue", "fatigue", 31.7),
        ("table_boolean_child_passenger", "child_passenger", 1.0),
        ("table_multiplier_night_amplification", "night_amplification", 1.2),
        ("table_multiplier_familiar_route_amplification", "familiar_route_amplification", 1.0),
        ("unknown_feature_id_returns_none", "totally_unrecognized_feature", 250.0),
        ("monotony_above_floor_is_minutes_nri_style", "monotony", 42.0),
        ("monotony_at_floor_boundary_is_none", "monotony", 1.0),
        ("monotony_below_floor_is_none_hybrid_style", "monotony", 0.75),
        ("monotony_non_numeric_value_is_none", "monotony", "heavy"),
        ("monotony_bool_value_is_none_moot_since_bool_never_exceeds_floor", "monotony", True),
    ]
    unit_kind_for_out = {name: te._unit_kind_for(fid, v) for name, fid, v in unit_kind_for_cases}

    # ======================================================================
    # _fmt_multiplier
    # ======================================================================
    fmt_multiplier_cases = [
        ("trims_trailing_zero_1.20_to_1.2", 1.2),
        ("keeps_one_decimal_1.00_to_1.0", 1.0),
        ("tie_1.125_banker_rounds_to_even_1.12", 1.125),
        ("no_trim_needed_1.23", 1.23),
        ("zero", 0.0),
    ]
    fmt_multiplier_out = {name: te._fmt_multiplier(v) for name, v in fmt_multiplier_cases}

    # ======================================================================
    # _row_value_display / _row_phrase
    # ======================================================================
    row_value_display_cases = {
        "band_wins_over_everything": {"feature_id": "traffic_state", "value": 5.0, "band": "heavy"},
        "band_empty_string_falls_through": {"feature_id": "drowsiness", "value": 70.0, "band": ""},
        "band_none_falls_through": {"feature_id": "drowsiness", "value": 70.0, "band": None},
        "boolean_kind_real_bool_true": {"feature_id": "child_passenger", "value": True},
        "boolean_kind_real_bool_false": {"feature_id": "child_passenger", "value": False},
        "boolean_kind_float_1.0_truthy": {"feature_id": "child_passenger", "value": 1.0},
        "boolean_kind_float_0.0_falsy": {"feature_id": "child_passenger", "value": 0.0},
        "boolean_kind_non_numeric_value_reads_false": {"feature_id": "child_passenger", "value": "yes"},
        "defensive_real_bool_outside_boolean_table_true": {"feature_id": "totally_new_signal", "value": True},
        "defensive_real_bool_outside_boolean_table_false": {"feature_id": "totally_new_signal", "value": False},
        "non_numeric_non_bool_value_renders_dash": {"feature_id": "drowsiness", "value": "heavy"},
        "none_value_renders_dash": {"feature_id": "drowsiness", "value": None},
        "minutes_kind": {"feature_id": "continuous_driving_min", "value": 52.0},
        "multiplier_kind": {"feature_id": "night_amplification", "value": 1.2},
        "level_kind_no_suffix": {"feature_id": "drowsiness", "value": 66.8},
        "unrecognized_feature_id_bare_number": {"feature_id": "totally_new_signal_no_one_has_seen", "value": 250.0},
        "monotony_disambiguated_as_minutes": {"feature_id": "monotony", "value": 42.0},
        "monotony_disambiguated_as_bare": {"feature_id": "monotony", "value": 0.75},
        # divergence hazard 8 corollary: str(row.get("feature_id", "")) — an
        # EXPLICIT None feature_id (key present, value None) prints Python's
        # "None" (not "" and not JS's "null"). No real row omits feature_id
        # or sets it to None (both packages' _row() always supplies a real
        # string), so hand-constructed.
        "explicit_none_feature_id_stringifies_to_python_None": {"feature_id": None, "value": 5.0},
        "missing_feature_id_key_defaults_to_empty_string": {"value": 5.0},
    }
    row_value_display_out = {name: te._row_value_display(row) for name, row in row_value_display_cases.items()}

    row_phrase_cases = {
        "band_wins": {"feature_id": "traffic_state", "value": 5.0, "band": "heavy"},
        "minutes_row": {"feature_id": "continuous_driving_min", "value": 52.0, "band": None},
        "level_row": {"feature_id": "drowsiness", "value": 66.8, "band": None},
        "boolean_row_aboard": {"feature_id": "child_passenger", "value": 1.0, "band": None},
        "multiplier_row": {"feature_id": "night_amplification", "value": 1.2, "band": None},
        "unknown_feature_id_label_falls_back_to_raw_id": {"feature_id": "totally_unrecognized", "value": 5.0, "band": None},
        # divergence hazard 8 corollary (see row_value_display_cases above):
        # str(None) == "None" in Python, not "" and not JS's "null" — this
        # is the ONE case where that actually shows up in rendered text
        # (label_for's fallback echoes the raw id string verbatim, so a
        # wrong stringification would print a visibly wrong label).
        "explicit_none_feature_id_label_becomes_the_python_None_string": {"feature_id": None, "value": 5.0, "band": None},
    }
    row_phrase_out = {name: te._row_phrase(row) for name, row in row_phrase_cases.items()}

    # ======================================================================
    # _dead_band_reason_applies — both ways, plus the boundary
    # ======================================================================
    dead_band_reason_applies_cases = {
        "drowsiness_dead_band_proven": {"feature_id": "drowsiness", "value": 45.0, "weight": 1.5, "contribution": 0.0},
        # Pulled from the ALREADY-COMMITTED nri_fatigue_score_v1.json golden
        # (decision index 12, a real evaluate() call whose fatigue row
        # genuinely lands at value=31.7/weight=1.5/contribution=0.0 — the
        # dead-band proof, from a real run, not a hand-picked shape).
        # nri_rest_fire's OWN fatigue row can't demonstrate this branch —
        # its signals default fatigue=0.0, so value>0.0 never holds there.
        "fatigue_dead_band_proven_from_a_real_captured_run": next(
            r for r in _load_json(_OUT / "nri_fatigue_score_v1.json")["output"]["decisions"][12]
            ["feature_contributions"]["rest_required"]["rows"]
            if r["feature_id"] == "fatigue"
        ),
        "drowsiness_value_zero_does_not_prove_dead_band": {
            "feature_id": "drowsiness", "value": 0.0, "weight": 1.5, "contribution": 0.0,
        },
        "drowsiness_weight_zero_does_not_prove_dead_band": {
            "feature_id": "drowsiness", "value": 45.0, "weight": 0.0, "contribution": 0.0,
        },
        "drowsiness_real_nonzero_contribution_does_not_apply": {
            "feature_id": "drowsiness", "value": 66.8, "weight": 1.5, "contribution": 10.2,
        },
        "feature_id_outside_dead_band_set_short_circuits_false": {
            "feature_id": "continuous_driving_min", "value": 45.0, "weight": 1.5, "contribution": 0.0,
        },
        "boundary_contribution_exactly_at_epsilon_is_false": {
            "feature_id": "drowsiness", "value": 45.0, "weight": 1.5, "contribution": 1e-06,
        },
        "boundary_contribution_just_below_epsilon_is_true": {
            "feature_id": "drowsiness", "value": 45.0, "weight": 1.5, "contribution": 0.9e-06,
        },
        "negative_near_zero_contribution_still_applies": {
            "feature_id": "drowsiness", "value": 45.0, "weight": 1.5, "contribution": -1e-08,
        },
        # divergence hazard 8 (design doc): _dead_band_reason_applies uses
        # THIS module's own bool-EXCLUDING _num — a bool weight reads as
        # 0.0, so `weight > 0.0` fails regardless of value/contribution.
        # Hand-constructed: no package emits a bool weight.
        "bool_weight_excluded_reads_as_0_fails_the_check": {
            "feature_id": "drowsiness", "value": 45.0, "weight": True, "contribution": 0.0,
        },
    }
    dead_band_reason_applies_out = {
        name: te._dead_band_reason_applies(row) for name, row in dead_band_reason_applies_cases.items()
    }

    # ======================================================================
    # template — real fires, the Python test suite's own edge fixtures
    # (hand-built ONLY in the recorded chain shape), and gap-filling cases
    # (see task-2-report.md's branch table for which is which).
    # ======================================================================
    template_cases = {
        "nri_rest_names_category_threshold_and_clearance": te.build_target(nri_rest_fire, "rest_required"),
        "nri_monotony_names_its_own_threshold_not_the_fire_one": te.build_target(nri_monotony_fire, "monotony_prevention"),
        "hybrid_fire_produces_a_real_sentence": te.build_target(hybrid_rest_fire, "rest_required"),
        "drowsiness_led_fire_level_value_never_gets_a_minutes_suffix": te.build_target(nri_drowsiness_led_fire, "rest_required"),
        "unrecognized_feature_id_renders_bare_not_guessed": te.build_target({
            "category": "rest_required",
            "feature_contributions": {
                "rest_required": {
                    "score": 300.0, "clamped": False,
                    "rows": [
                        {"feature_id": "totally_new_signal_no_one_has_seen", "value": 250.0, "band": None, "weight": 1.0, "contribution": 250.0},
                        {"feature_id": "continuous_driving_min", "value": 50.0, "band": None, "weight": 0.5, "contribution": 25.0},
                    ],
                    "gates": [],
                },
            },
            "criteria": {"threshold_fire": 100.0},
        }, "rest_required"),
        "names_the_dead_band_reason_when_a_zero_row_proves_it": te.build_target({
            "category": "rest_required",
            "feature_contributions": {
                "rest_required": {
                    "score": 105.0, "clamped": False,
                    "rows": [
                        {"feature_id": "continuous_driving_min", "value": 150.0, "band": None, "weight": 0.5, "contribution": 75.0},
                        {"feature_id": "drowsiness", "value": 45.0, "band": None, "weight": 1.5, "contribution": 0.0},
                        {"feature_id": "fatigue", "value": 0.0, "band": None, "weight": 1.5, "contribution": 0.0},
                    ],
                    "gates": [],
                },
            },
            "criteria": {"threshold_fire": 100.0},
        }, "rest_required"),
        "does_not_claim_the_dead_band_reason_when_the_row_does_not_support_it": te.build_target({
            "category": "rest_required",
            "feature_contributions": {
                "rest_required": {
                    "score": 100.0, "clamped": False,
                    "rows": [
                        {"feature_id": "continuous_driving_min", "value": 200.0, "band": None, "weight": 0.5, "contribution": 100.0},
                        {"feature_id": "drowsiness", "value": 0.0, "band": None, "weight": 1.5, "contribution": 0.0},
                    ],
                    "gates": [],
                },
            },
            "criteria": {"threshold_fire": 100.0},
        }, "rest_required"),
        "two_strongest_rows_and_the_zero_contribution_row_are_named": te.build_target({
            "category": "rest_required",
            "feature_contributions": {
                "rest_required": {
                    "score": 112.0, "clamped": False,
                    "rows": [
                        {"feature_id": "continuous_driving_min", "value": 142.0, "band": None, "weight": 0.5, "contribution": 71.0},
                        {"feature_id": "monotony", "value": 96.0, "band": None, "weight": 0.3, "contribution": 28.8},
                        {"feature_id": "drowsiness", "value": 15.0, "band": None, "weight": 1.5, "contribution": 0.0},
                        {"feature_id": "child_passenger", "value": 0.0, "band": None, "weight": 20.0, "contribution": 0.0},
                    ],
                    "gates": [],
                },
            },
            "criteria": {"threshold_fire": 100.0},
        }, "rest_required"),
        "never_raises_on_an_empty_rows_list": te.build_target({
            "category": "rest_required",
            "feature_contributions": {"rest_required": {"score": 100.0, "clamped": False, "rows": [], "gates": []}},
            "criteria": {"threshold_fire": 90.0},
        }, "rest_required"),
        "never_raises_on_missing_criteria": te.build_target({
            "category": "rest_required",
            "feature_contributions": {"rest_required": {"score": 100.0, "clamped": False, "rows": [], "gates": []}},
        }, "rest_required"),
        "never_raises_on_a_null_category": te.build_target({"feature_contributions": {}}, None),
        "never_raises_on_an_unrecognized_non_null_category": te.build_target({
            "category": "totally_unknown_category",
            "feature_contributions": {},
        }, "totally_unknown_category"),
        "never_raises_on_malformed_rows": te.build_target({
            "category": "rest_required",
            "feature_contributions": {
                "rest_required": {
                    "score": 100.0, "clamped": False,
                    "rows": [None, {"feature_id": "x"}, "not_a_dict", {"contribution": "not_a_number"}],
                    "gates": [],
                },
            },
            "criteria": {"threshold_fire": 90.0},
        }, "rest_required"),
        "has_threshold_but_no_score_omits_the_score_clause": te.build_target({
            "category": "rest_required",
            "feature_contributions": {"rest_required": {"clamped": False, "rows": [], "gates": []}},
            "criteria": {"threshold_fire": 100.0},
        }, "rest_required"),
        "bool_score_excluded_omits_the_score_clause_despite_being_1": te.build_target({
            "category": "rest_required",
            "feature_contributions": {"rest_required": {"score": True, "clamped": False, "rows": [], "gates": []}},
            "criteria": {"threshold_fire": 100.0},
        }, "rest_required"),
        "exactly_one_contributing_row_no_second_phrase": te.build_target({
            "category": "rest_required",
            "feature_contributions": {
                "rest_required": {
                    "score": 125.0, "clamped": False,
                    "rows": [{"feature_id": "continuous_driving_min", "value": 250.0, "band": None, "weight": 0.5, "contribution": 125.0}],
                    "gates": [],
                },
            },
            "criteria": {"threshold_fire": 100.0},
        }, "rest_required"),
        "zero_contribution_row_with_null_value_excluded_from_zero_rows": te.build_target({
            "category": "rest_required",
            "feature_contributions": {
                "rest_required": {
                    "score": 125.0, "clamped": False,
                    "rows": [
                        {"feature_id": "continuous_driving_min", "value": 250.0, "band": None, "weight": 0.5, "contribution": 125.0},
                        {"feature_id": "drowsiness", "value": None, "band": None, "weight": 1.5, "contribution": 0.0},
                    ],
                    "gates": [],
                },
            },
            "criteria": {"threshold_fire": 100.0},
        }, "rest_required"),
    }
    template_out = {name: te.template(target) for name, target in template_cases.items()}

    _write("trigger_explanation", {
        "input": {
            "resolve_category_cases": resolve_category_cases,
            "build_target_cases": build_target_cases,
            "num_cases": [{"name": n, "v": v} for n, v in num_cases],
            "threshold_for_cases": threshold_for_cases,
            "ranked_rows_cases": ranked_rows_cases,
            "fmt_num_cases": [{"name": n, "v": v} for n, v in fmt_num_cases],
            "score_display_cases": [{"name": n, "v": v} for n, v in score_display_cases],
            "signed_score_display_cases": [{"name": n, "v": v} for n, v in signed_score_display_cases],
            "unit_kind_for_cases": [{"name": n, "feature_id": fid, "value": v} for n, fid, v in unit_kind_for_cases],
            "fmt_multiplier_cases": [{"name": n, "v": v} for n, v in fmt_multiplier_cases],
            "row_value_display_cases": row_value_display_cases,
            "row_phrase_cases": row_phrase_cases,
            "dead_band_reason_applies_cases": dead_band_reason_applies_cases,
            "template_cases": template_cases,
        },
        "output": {
            "resolve_category": resolve_category_out,
            "build_target": build_target_out,
            "num": num_out,
            "threshold_for": threshold_for_out,
            "ranked_rows": ranked_rows_out,
            "fmt_num": fmt_num_out,
            "score_display": score_display_out,
            "signed_score_display": signed_score_display_out,
            "unit_kind_for": unit_kind_for_out,
            "fmt_multiplier": fmt_multiplier_out,
            "row_value_display": row_value_display_out,
            "row_phrase": row_phrase_out,
            "dead_band_reason_applies": dead_band_reason_applies_out,
            "template": template_out,
        },
    })


# ---------------------------------------------------------------------------
# 33. service_explanation (C3 task 3) — direct calls against REAL
#     RankedCandidate output already committed in service_selector.json
#     (C1 Task 4), plus one REAL mock_service_selector_v1.evaluate() call
#     (proves _passthrough's fallback is reachable from a real package, not
#     merely synthetic — mock_service_selector_v1 never sets situation_fit/
#     preference_fit/history_fit, so category_readout returns None on every
#     one of its candidates), plus hand-built edge cases for branches no
#     real ServiceId-typed candidate can reach (unknown candidate id, a
#     malformed rationale shape, a strongest_support/oppose dict missing
#     feature_id).
# ---------------------------------------------------------------------------

def _capture_service_explanation() -> None:
    from aica_api.services import service_explanation as se
    import importlib.util

    golden = _load_json(_OUT / "service_selector.json")
    cases = golden["input"]["cases"]
    results = golden["output"]["results"]

    def _cand(case_idx: int, cand_idx: int) -> dict:
        return results[case_idx]["decision"]["ranked_candidates"][cand_idx]

    def _ctx_for(case_idx: int) -> dict:
        c = cases[case_idx]["context"]
        return {"trigger_purpose": c.get("trigger_purpose"), "lifecycle_stage": c.get("lifecycle_stage")}

    # ── _service_label ──────────────────────────────────────────────────
    service_label_ids = ["humming_karaoke", "music_playlist", "oshi_reexperience", "totally_new_future_service"]
    service_label_out = {sid: se._service_label(sid) for sid in service_label_ids}

    # ── build_prompt — real candidates spanning every _TRIGGER_SENTENCES
    #    lead + the stopped/moving motion distinction (rest_recommended
    #    fires BOTH ways depending on lifecycle_stage, see case 8 vs 9) +
    #    situation-gated-in/out + history present/absent, plus one
    #    hand-built target for the unknown-candidate-id desc/label fallback.
    # ======================================================================
    build_prompt_cases = {
        # case 0 cand 0: inattentive_driving_prevention_recovery, situation
        # fully gated in (drowsiness/fatigue/monotony/night/traffic/road all
        # contribute), history present (service_recency_state + acceptance).
        "worked_example_full_situation_and_history": {"target": _cand(0, 0), "context": _ctx_for(0)},
        # case 0 cand 1: same fire, but THIS candidate's history is empty —
        # exercises the "history section omitted" branch.
        "worked_example_no_history": {"target": _cand(0, 1), "context": _ctx_for(0)},
        # case 2 cand 1 (music_playlist): situation entirely gated OUT
        # (contributing_only=True finds no row above CONTRIBUTING_THRESHOLD
        # for this specific candidate) — situation section omitted; history
        # present.
        "situation_entirely_gated_out": {"target": _cand(2, 1), "context": _ctx_for(2)},
        # case 3 cand 0 (music_playlist, route_music trigger purpose):
        # "neutral state" lead phrase (parts empty but env non-empty).
        "neutral_state_lead_with_env": {"target": _cand(3, 0), "context": _ctx_for(3)},
        # case 8 cand 0: rest_recommended + lifecycle_stage=after_rest_before_restart
        # (a genuinely-stopped stage) -> "the car is stopped" branch.
        "rest_recommended_car_stopped": {"target": _cand(8, 0), "context": _ctx_for(8)},
        # case 9 cand 0: rest_recommended + lifecycle_stage=before_rest_until_stop
        # (STILL DRIVING toward the stop, deliberately excluded from
        # _STOPPED_STAGES) -> "the car is moving" branch DESPITE the
        # rest_recommended trigger purpose — the exact documented distinction.
        "rest_recommended_car_still_moving": {"target": _cand(9, 0), "context": _ctx_for(9)},
        # case 10 cand 0: child_passenger_experience trigger purpose (the
        # 4th _TRIGGER_SENTENCES entry).
        "child_passenger_trigger_purpose": {"target": _cand(10, 0), "context": _ctx_for(10)},
        # Unknown candidate_id: _SERVICE_DESC/_SERVICE_LABELS both fall back
        # (raw id passthrough for desc, neutral phrase for the template()
        # label) — unreachable from real evidence (candidate_id is
        # ServiceId-typed on every real RankedCandidate; all 14 members are
        # covered by both tables), hand-built.
        "unknown_candidate_id_desc_falls_back_to_raw_id": {
            "target": {
                "candidate_id": "totally_new_future_service", "rank": 1, "score": 0.4,
                "rationale": ["a", "b"], "supporting_feature_ids": [], "opposing_feature_ids": [],
                "feature_contributions": [],
            },
            "context": {"trigger_purpose": None, "lifecycle_stage": None},
        },
    }
    build_prompt_out = {name: se.build_prompt(spec["target"], spec["context"]).model_dump() for name, spec in build_prompt_cases.items()}

    # ── template — real dom=situation/preference (both with/without
    #    strongest_oppose), real mock-package passthrough, and hand-built
    #    edge cases for branches no real candidate reaches.
    # ======================================================================
    mock_dir = _PACKAGES_DIR / "mock_service_selector_v1"
    mock_spec = importlib.util.spec_from_file_location("mock_service_selector_v1_explain_capture", mock_dir / "algorithm.py")
    mock_mod = importlib.util.module_from_spec(mock_spec)
    mock_spec.loader.exec_module(mock_mod)  # type: ignore[attr-defined]
    mock_out = mock_mod.evaluate({"allowed_service_ids": ["humming_karaoke", "music_playlist", "quiz"]})
    mock_candidate = mock_out["ranked_candidates"][0]
    assert mock_candidate.get("situation_fit") is None, "setup sanity: mock package must not set §14 fields"

    template_cases = {
        "dom_situation_no_oppose": _cand(0, 0),
        "dom_situation_with_oppose": _cand(3, 0),
        "dom_preference_no_oppose": _cand(2, 0),
        # CORRECTED after verification (per the brief's own warning: build
        # the enumeration first, don't assume a scan of `strongest_oppose`
        # truthiness alone proves the guard passes): case 9 cand 0 was
        # ORIGINALLY intended as "dom_preference_with_oppose", but its
        # `strongest_support` is `None` (only `strongest_oppose` is
        # populated) — `template()`'s guard requires BOTH, so this candidate
        # actually falls through to `_passthrough`, not the composed
        # sentence. Scanned the full 11-case golden: NO real candidate has
        # dom=preference with BOTH strongest_support AND strongest_oppose
        # populated (see task-3-report.md) — kept as a REAL passthrough
        # case (still useful, just renamed honestly) and paired with a
        # genuine synthetic case below for the branch it was meant to prove.
        "real_dom_preference_but_ss_is_none_falls_through_to_passthrough": _cand(9, 0),
        "synthetic_dom_preference_with_oppose": {
            "candidate_id": "music_playlist", "rank": 1, "score": 0.4,
            "rationale": ["ja placeholder", "en placeholder"],
            "supporting_feature_ids": [], "opposing_feature_ids": [], "feature_contributions": [],
            "situation_fit": 0.02, "preference_fit": 0.15, "history_fit": 0.0,
            "strongest_support": {"feature_id": "usage_by_genre", "contribution": 0.15},
            "strongest_oppose": {"feature_id": "drowsiness_level", "contribution": -0.03},
        },
        # REAL mock-package output — category_readout is None for every
        # mock_service_selector_v1 candidate (it never sets situation_fit/
        # preference_fit/history_fit), so this is a REAL, not merely
        # synthetic, path into _passthrough.
        "passthrough_via_real_mock_package_no_readout": mock_candidate,
        # dom=history: NOT reachable in the 11-case service_selector.json
        # golden (scanned all candidates — zero have history as the
        # dominant §14 category), so hand-built in the recorded SHAPE
        # (situation_fit/preference_fit/history_fit + strongest_support),
        # labelled synthetic.
        "dom_history_synthetic": {
            "candidate_id": "stretch_video", "rank": 1, "score": 0.3,
            "rationale": ["ja placeholder", "en placeholder"],
            "supporting_feature_ids": [], "opposing_feature_ids": [], "feature_contributions": [],
            "situation_fit": 0.02, "preference_fit": 0.0, "history_fit": 0.20,
            "strongest_support": {"feature_id": "service_recovery_rate", "contribution": 0.20},
            "strongest_oppose": None,
        },
        # Passthrough sub-branches: rationale key absent / empty list /
        # non-list / exactly one element (ja==en) / two-plus elements.
        # None of these are reachable from a real RankedCandidate
        # (Pydantic-typed rationale: list[str], always populated) so all
        # hand-built, mirroring _passthrough's own degrade contract.
        "passthrough_rationale_key_absent": {"candidate_id": "quiz"},
        "passthrough_rationale_empty_list": {"candidate_id": "quiz", "rationale": []},
        "passthrough_rationale_non_list": {"candidate_id": "quiz", "rationale": "not a list"},
        "passthrough_rationale_one_element": {"candidate_id": "quiz", "rationale": ["only one"]},
        "passthrough_rationale_two_elements": {"candidate_id": "quiz", "rationale": ["日本語", "english"]},
        # readout present, strongest_support present but missing feature_id
        # -> guard fails -> passthrough. Unreachable from real evidence (the
        # P5 selector always sets feature_id when it sets strongest_support
        # at all) — hand-built.
        "readout_present_ss_missing_feature_id": {
            "candidate_id": "quiz", "rationale": ["ja", "en"],
            "situation_fit": 0.1, "preference_fit": 0.0, "history_fit": 0.0,
            "strongest_support": {"contribution": 0.1},
        },
        # cid falsy (candidate_id missing) -> guard fails regardless of
        # readout/ss -> passthrough. Unreachable from real evidence
        # (candidate_id is a required ServiceId field) — hand-built.
        "cid_falsy_forces_passthrough": {
            "rationale": ["ja", "en"],
            "situation_fit": 0.1, "preference_fit": 0.0, "history_fit": 0.0,
            "strongest_support": {"feature_id": "drowsiness_level", "contribution": 0.1},
        },
        # Happy path (readout+ss+cid all valid) but strongest_oppose is a
        # dict MISSING feature_id -> the oppose clause's own guard
        # (`isinstance(so, dict) and so.get("feature_id")`) fails silently,
        # same shape as the ss-missing-feature_id guard above but on the
        # OTHER field — the main sentence still renders normally, just
        # without the oppose clause. Unreachable from real evidence — hand-built.
        "oppose_dict_present_but_missing_feature_id_renders_main_sentence_only": {
            "candidate_id": "quiz", "rationale": ["ja", "en"],
            "situation_fit": 0.1, "preference_fit": 0.0, "history_fit": 0.0,
            "strongest_support": {"feature_id": "drowsiness_level", "contribution": 0.1},
            "strongest_oppose": {"contribution": -0.05},
        },
    }
    template_out = {name: se.template(target) for name, target in template_cases.items()}

    _write("service_explanation", {
        "input": {
            "service_label_ids": service_label_ids,
            "build_prompt_cases": build_prompt_cases,
            "template_cases": template_cases,
        },
        "output": {
            "service_label": service_label_out,
            "build_prompt": build_prompt_out,
            "template": template_out,
        },
    })


# ---------------------------------------------------------------------------
# 34. content_explanation (C3 task 3) — direct calls against REAL
#     OrderedItem output already committed in content_selector.json (C1 Task
#     5), plus one REAL mock_content_selector_v1.evaluate() call (readout is
#     None for every mock item — a REAL, not merely synthetic, path where
#     _situation_led_sentence1 still succeeds), plus a large hand-built
#     matrix for the causal-bridge machinery's branches (dense conditionals
#     that varying REAL selector output cannot reliably hit on demand) and
#     _legacy_join (confirmed NOT reachable from real evidence — see the
#     module's own doc comment and task-3-report.md).
# ---------------------------------------------------------------------------

def _capture_content_explanation() -> None:
    from aica_api.services import content_explanation as ce
    import importlib.util

    golden = _load_json(_OUT / "content_selector.json")
    cases = golden["input"]["cases"]
    results = golden["output"]["results"]

    def _item(case_idx: int, item_idx: int) -> dict:
        return results[case_idx]["decision"]["ordered_items"][item_idx]

    def _ctx_for(case_idx: int, **extra) -> dict:
        c = cases[case_idx]["context"]
        base = {"trigger_purpose": c.get("trigger_purpose"), "lifecycle_stage": c.get("lifecycle_stage")}
        base.update(extra)
        return base

    # ── _effective_alpha_beta ───────────────────────────────────────────
    eab_cases = {
        "both_none_directional_unsafe": (None, None, "fatigue_level"),
        "both_none_in_static_demand": (None, None, "drowsiness_level"),
        "both_none_not_in_static_not_unsafe": (None, None, "totally_unknown_feature"),
        "alpha_none_beta_real": (None, 0.3, "totally_unknown_feature"),
        "alpha_real_beta_none": (0.4, None, "totally_unknown_feature"),
        "both_real_both_near_zero": (1e-7, -1e-7, "totally_unknown_feature"),
        "both_real_normal": (0.5, -0.2, "totally_unknown_feature"),
        "boundary_at_1e6_not_excluded": (1e-6, 0.0, "totally_unknown_feature"),
        "boundary_both_just_below_1e6_excluded": (0.9e-6, 0.9e-6, "totally_unknown_feature"),
        # hazard 8: bool alpha/beta (never real on Pydantic-typed evidence).
        "bool_alpha_true_accepted_as_1.0": (True, None, "totally_unknown_feature"),
        "bool_beta_false_accepted_as_0.0": (0.5, False, "totally_unknown_feature"),
    }
    eab_out = {name: ce._effective_alpha_beta(a, b, fid) for name, (a, b, fid) in eab_cases.items()}

    # ── demand_phrase ────────────────────────────────────────────────────
    demand_phrase_cases = {
        "a_positive_b_not_positive_no_append": (0.5, -0.1, "totally_unknown_feature"),
        "a_positive_b_positive_appends_brighter": (0.8, 0.2, "drowsiness_level"),
        "a_negative_b_not_positive_no_append": (-0.5, -0.1, "totally_unknown_feature"),
        "a_negative_b_positive_appends_brighter": (-0.5, 0.5, "totally_unknown_feature"),
        "a_zero_default_bright_phrase": (0.0, 0.5, "totally_unknown_feature"),
        "resolved_none_directional_unsafe_no_row": (None, None, "fatigue_level"),
    }
    demand_phrase_out = {name: ce.demand_phrase(a, b, fid) for name, (a, b, fid) in demand_phrase_cases.items()}

    # ── _arousal_band ────────────────────────────────────────────────────
    arousal_band_cases = [
        ("high", 0.72), ("boundary_high_0.62", 0.62), ("medium", 0.50),
        ("boundary_low_0.40", 0.40), ("low", 0.20),
    ]
    arousal_band_out = {name: ce._arousal_band(v) for name, v in arousal_band_cases}

    # ── _axis_satisfaction ───────────────────────────────────────────────
    axis_satisfaction_cases = {
        "arousal_energize_satisfied": ("arousal", "energize", "high", None),
        "arousal_energize_unsatisfied": ("arousal", "energize", "medium", None),
        "arousal_soothe_satisfied": ("arousal", "soothe", "low", None),
        "arousal_soothe_unsatisfied": ("arousal", "soothe", "high", None),
        "valence_none_unsatisfied": ("valence", "bright", "medium", None),
        "valence_bright_satisfied": ("valence", "bright", None, 0.7),
        "valence_bright_unsatisfied": ("valence", "bright", None, 0.3),
        "valence_darker_satisfied": ("valence", "darker", None, 0.2),
        "valence_darker_unsatisfied": ("valence", "darker", None, 0.8),
    }
    axis_satisfaction_out = {
        name: ce._axis_satisfaction(axis, direction, band, val)
        for name, (axis, direction, band, val) in axis_satisfaction_cases.items()
    }

    # ── _axis_trait_words ────────────────────────────────────────────────
    axis_trait_words_cases = {
        "arousal_high": ("arousal", "high", None),
        "arousal_medium": ("arousal", "medium", None),
        "arousal_low": ("arousal", "low", None),
        "arousal_band_none_defaults_medium": ("arousal", None, None),
        "valence_none": ("valence", None, None),
        "valence_bright": ("valence", None, 0.7),
        "valence_darker": ("valence", None, 0.2),
        "valence_neutral_zone": ("valence", None, 0.45),
    }
    axis_trait_words_out = {
        name: list(ce._axis_trait_words(axis, band, val)) for name, (axis, band, val) in axis_trait_words_cases.items()
    }

    # ── _axis_choice ─────────────────────────────────────────────────────
    axis_choice_cases = {
        "only_a_arousal_energize": (0.5, 0.0, "medium", None),
        "only_b_valence_bright": (0.0, 0.5, "medium", None),
        "only_a_negative_soothe": (-0.5, 0.0, "medium", None),
        "only_b_negative_darker": (0.0, -0.5, "medium", None),
        "both_arousal_satisfied_only": (0.5, 0.3, "high", 0.3),
        "both_valence_satisfied_only": (0.5, 0.3, "medium", 0.7),
        "both_satisfied_tie_coeff_arousal_wins": (0.5, 0.5, "high", 0.7),
        "both_satisfied_valence_bigger_coeff_wins": (0.3, 0.5, "high", 0.7),
        "neither_satisfied_tie_coeff_arousal_wins": (0.5, 0.5, "low", 0.2),
        "neither_satisfied_arousal_bigger_coeff_wins": (0.6, 0.3, "medium", 0.45),
        "neither_satisfied_valence_bigger_coeff_wins": (0.3, 0.6, "medium", 0.45),
        "no_candidates_both_near_zero": (1e-10, -1e-10, "medium", 0.5),
    }
    axis_choice_out = {
        name: list(ce._axis_choice(a, b, band, val)) if ce._axis_choice(a, b, band, val) is not None else None
        for name, (a, b, band, val) in axis_choice_cases.items()
    }

    # ── _axis_bridge ─────────────────────────────────────────────────────
    axis_bridge_cases = {
        "normal_satisfied": (0.8, 0.2, "high", 0.7),
        "normal_unsatisfied": (0.8, 0.2, "low", 0.2),
        # Defensive-only: choice=None is PROVABLY unreachable when a/b come
        # from _effective_alpha_beta (see content.ts's own comment) — this
        # case calls _axis_bridge DIRECTLY (bypassing _effective_alpha_beta)
        # to exercise the guard itself, which no real call site can trigger.
        "choice_none_direct_call_both_near_zero": (1e-10, -1e-10, "medium", 0.5),
    }
    axis_bridge_out = {name: ce._axis_bridge(a, b, band, val) for name, (a, b, band, val) in axis_bridge_cases.items()}

    # ── _song_facts_lines / causal_bridge_lines — real items ────────────
    real_bridge_item = _item(11, 0)  # eligibility_reasons_bundle, has a motion_state row (skipped) + satisfied lines
    real_bridge_item_unsatisfied = _item(0, 4)  # negative-contribution "leans" branch, synthetic-track-1002
    real_oshi_item = _item(1, 0)  # humming_genre_oshi_on

    song_facts_cases = {
        "real_item_with_oshi_match": {"target": real_oshi_item, "context": {"song_name": "Test Song"}},
        "real_item_no_song_name": {"target": real_bridge_item, "context": {}},
        # hazard 8: e_i bool True for the oshi_artists row equality check
        # (`fc.get("e_i") == 1.0`) — never real (e_i is Pydantic float).
        "oshi_e_i_bool_true_matches_1.0": {
            "target": {"feature_contributions": [{"feature_id": "oshi_artists", "e_i": True, "exact_match": None, "contribution": 0.05}]},
            "context": {},
        },
        "oshi_exact_match_true_no_e_i": {
            "target": {"feature_contributions": [{"feature_id": "oshi_artists", "exact_match": True, "contribution": 0.05}]},
            "context": {},
        },
        "oshi_neither_signal_is_no": {
            "target": {"feature_contributions": [{"feature_id": "oshi_artists", "exact_match": False, "e_i": 0.0, "contribution": 0.0}]},
            "context": {},
        },
    }
    song_facts_out = {name: ce._song_facts_lines(spec["target"], spec["context"]) for name, spec in song_facts_cases.items()}

    causal_bridge_cases = {
        "real_item_satisfied_lines_skips_motion_state": real_bridge_item,
        "real_item_unsatisfied_leans_negative_contribution": real_bridge_item_unsatisfied,
        # HAZARD 7 mutation-test anchor: 0.0625 is an EXACT decimal tie at
        # 3 places (0.0625 * 1000 = 62.5 exactly, in binary too — 1/16 is a
        # power-of-two fraction) — Python's `:+.3f` rounds half-to-even
        # ("+0.062", 62 is even) while `Number.prototype.toFixed` rounds
        # ties away from zero ("+0.063"). No real algorithm.evaluate() run
        # coincidentally lands on an exact tie, so hand-built (contribution
        # is the ONLY field this pins; alpha/beta absent so drowsiness_level
        # resolves via _STATIC_DEMAND, same as several real rows above).
        "hazard7_exact_tie_at_3_decimals": {
            "trait_values": {"arousal": 0.75, "valence": 0.7},
            "feature_contributions": [
                {"feature_id": "drowsiness_level", "contribution": 0.0625},
            ],
        },
    }
    causal_bridge_out = {name: ce.causal_bridge_lines(target) for name, target in causal_bridge_cases.items()}

    # ── build_prompt — real content items ───────────────────────────────
    build_prompt_cases = {
        "real_situation_led_with_song_name_and_artist": {
            "target": _item(0, 0),
            "context": {**_ctx_for(0), "song_name": "Jessica", "song_artist": "The Allman Brothers Band"},
        },
        "real_preference_dominant_with_oshi": {
            "target": _item(1, 0),
            "context": {**_ctx_for(1), "song_name": None, "oshi_artist": "Test Artist"},
        },
        # No song_name in context -> name falls back to target_id.
        "no_song_name_falls_back_to_target_id": {"target": _item(15, 0), "context": _ctx_for(15)},
    }
    build_prompt_out = {
        name: ce.build_prompt(spec["target"], spec["context"]).model_dump() for name, spec in build_prompt_cases.items()
    }

    # ── mock_content_selector_v1 — REAL, readout=None path ─────────────
    mock_dir = _PACKAGES_DIR / "mock_content_selector_v1"
    mock_spec = importlib.util.spec_from_file_location("mock_content_selector_v1_explain_capture", mock_dir / "algorithm.py")
    mock_mod = importlib.util.module_from_spec(mock_spec)
    mock_spec.loader.exec_module(mock_mod)  # type: ignore[attr-defined]
    mock_result = mock_mod.evaluate({"selected_service_id": "humming_karaoke", "motion_state": "moving"})
    mock_item = mock_result["ordered_items"][0]
    from aica_api.services import explanation_builder as _eb_check
    assert _eb_check.category_readout(mock_item) is None, "setup sanity: mock content package must not set §14 fields"

    # ── _family_of ───────────────────────────────────────────────────────
    family_of_ids = [
        "drowsiness_level", "oshi_artists", "catalog_item_usage_level", "genre_affinity", "totally_unknown",
    ]
    family_of_out = {fid: ce._family_of(fid) for fid in family_of_ids}

    # ── _dominant_family_sentence1 ──────────────────────────────────────
    dominant_family_cases = {
        "real_preference_positive_support": (real_oshi_item, "preference"),
        "no_feature_in_family_at_all": (
            {"feature_contributions": [{"feature_id": "drowsiness_level", "contribution": 0.2}]}, "preference",
        ),
        "feature_present_but_negative": (
            {"feature_contributions": [{"feature_id": "oshi_artists", "contribution": -0.1}]}, "preference",
        ),
        # dom=history real case from content_selector.json (case 0 item 3)
        # has its best history feature at a NEGATIVE contribution -> None,
        # falls through — a REAL negative-side proof (not synthetic).
        "real_history_dominant_but_negative_falls_through": (_item(0, 3), "history"),
        # dom=history WITH a genuinely positive support feature — NOT
        # reachable in the 21-case content_selector.json golden (scanned
        # every item; the one real history-dominant item's best feature is
        # negative, per the case above) — hand-built, labelled synthetic.
        "synthetic_history_positive_support": (
            {"feature_contributions": [
                {"feature_id": "content_recovery_rate", "contribution": 0.15},
                {"feature_id": "drowsiness_level", "contribution": 0.02},
            ]}, "history",
        ),
    }
    dominant_family_out = {
        name: ce._dominant_family_sentence1(target, dom) for name, (target, dom) in dominant_family_cases.items()
    }

    # ── _situation_led_sentence1 ─────────────────────────────────────────
    situation_led_cases = {
        "real_item": (real_bridge_item, "high", 0.5),
        "best_none_no_situation_feature": (
            {"feature_contributions": [{"feature_id": "oshi_artists", "e_i": 1.0, "contribution": 0.1}]}, "high", 0.5,
        ),
        "arousal_band_none": (
            {"feature_contributions": [
                {"feature_id": "drowsiness_level", "e_i": 0.8, "alpha": 0.8, "beta": 0.2, "contribution": 0.2},
            ]}, None, 0.5,
        ),
        "value_not_numeric_or_bool_excluded": (
            {"feature_contributions": [
                {"feature_id": "drowsiness_level", "e_i": "not_a_number", "feature_value": "also_not",
                 "alpha": 0.8, "beta": 0.2, "contribution": 0.2},
            ]}, "high", 0.5,
        ),
        # hazard 8: bool `value` (e_i=True) must reach valueDisplay's OWN
        # boolean branch (level_ja/level_en = "高く"/"high"), not a coerced
        # plain-number path — never real (e_i is Pydantic float).
        "value_bool_true_via_value_display_boolean_branch": (
            {"feature_contributions": [
                {"feature_id": "child_present", "e_i": True, "alpha": 0.5, "beta": 0.0, "contribution": 0.05},
            ]}, "high", 0.5,
        ),
        # LEVEL_WORDS branch coverage: "real_item" hits 'medium' ("やや高め
        # で"/"elevated") and the bool-True case above hits 'high' ("高く"/
        # "high") — this one hits the 3rd, otherwise-uncovered 'low' band
        # ("低く"/"low"), via a low e_i value (0.15 < 0.40).
        "value_display_low_band": (
            {"feature_contributions": [
                {"feature_id": "drowsiness_level", "e_i": 0.15, "alpha": 0.8, "beta": 0.2, "contribution": 0.05},
            ]}, "high", 0.5,
        ),
    }
    situation_led_out = {
        name: ce._situation_led_sentence1(target, band, val) for name, (target, band, val) in situation_led_cases.items()
    }

    # ── template — the full opening-sentence + reinforcement matrix ─────
    template_cases: dict = {
        "real_situation_led_satisfied": _item(0, 0),
        "real_preference_dominant_no_reinforcement": _item(1, 0),
        "real_history_dominant_falls_through_with_negative_reinforcement": _item(0, 3),
        "real_mock_package_readout_none_situation_led_succeeds": mock_item,
        # Synthetic reinforcement matrix — verified directly against a live
        # Python interpreter before capture (see task-3-report.md): a real
        # situation-led sentence1 (lead_family=None) with each of
        # preference/history reinforcing positively, isolated from the one
        # real negative-history case above.
        "synthetic_situation_led_preference_reinforces_positive": {
            "situation_fit": 0.20, "preference_fit": 0.08, "history_fit": 0.0,
            "trait_values": {"arousal": 0.75, "valence": 0.7},
            "feature_contributions": [
                {"feature_id": "drowsiness_level", "e_i": 0.8, "alpha": 0.8, "beta": 0.2, "contribution": 0.20},
                {"feature_id": "oshi_artists", "e_i": 1.0, "contribution": 0.08},
            ],
        },
        "synthetic_situation_led_preference_reinforces_negative": {
            "situation_fit": 0.20, "preference_fit": -0.08, "history_fit": 0.0,
            "trait_values": {"arousal": 0.75, "valence": 0.7},
            "feature_contributions": [
                {"feature_id": "drowsiness_level", "e_i": 0.8, "alpha": 0.8, "beta": 0.2, "contribution": 0.20},
                {"feature_id": "oshi_artists", "e_i": 0.0, "contribution": -0.08},
            ],
        },
        "synthetic_situation_led_history_reinforces_positive": {
            "situation_fit": 0.20, "preference_fit": 0.0, "history_fit": 0.09,
            "trait_values": {"arousal": 0.75, "valence": 0.7},
            "feature_contributions": [
                {"feature_id": "drowsiness_level", "e_i": 0.8, "alpha": 0.8, "beta": 0.2, "contribution": 0.20},
                {"feature_id": "content_recovery_rate", "e_i": 0.9, "contribution": 0.09},
            ],
        },
        "synthetic_dominant_family_history_positive_leads": {
            "situation_fit": 0.02, "preference_fit": 0.0, "history_fit": 0.15,
            "trait_values": {"arousal": 0.75, "valence": 0.7},
            "feature_contributions": [
                {"feature_id": "content_recovery_rate", "e_i": 0.9, "contribution": 0.15},
                {"feature_id": "drowsiness_level", "e_i": 0.5, "alpha": 0.8, "beta": 0.2, "contribution": 0.02},
            ],
        },
        "synthetic_dom_preference_attempt_fails_but_still_reinforces_sentence2": {
            "situation_fit": 0.05, "preference_fit": -0.12, "history_fit": 0.0,
            "trait_values": {"arousal": 0.75, "valence": 0.7},
            "feature_contributions": [
                {"feature_id": "oshi_artists", "e_i": 0.0, "contribution": -0.12},
                {"feature_id": "drowsiness_level", "e_i": 0.5, "alpha": 0.8, "beta": 0.2, "contribution": 0.05},
            ],
        },
        # _legacy_join reachability — hand-built, trait_values omitted
        # entirely (see this module's own doc comment + task-3-report.md for
        # why no real evidence reaches this).
        "legacy_join_no_rationale": {"item_id": "x"},
        "legacy_join_empty_rationale": {"item_id": "x", "rationale": []},
        "legacy_join_non_list_rationale": {"item_id": "x", "rationale": "not a list"},
        "legacy_join_one_entry_no_separator": {"item_id": "x", "rationale": ["ある理由"]},
        "legacy_join_one_entry_with_separator": {"item_id": "x", "rationale": ["日本語の理由 / english reason"]},
        "legacy_join_multi_entries": {"item_id": "x", "rationale": ["理由1 / reason1", "理由2 / reason2"]},
    }
    template_out = {name: ce.template(target) for name, target in template_cases.items()}

    # ── _legacy_join direct (non-list entries -> str() coercion, incl.
    #    Python's str(None) == "None") ─────────────────────────────────
    legacy_join_direct_cases = {
        "multi_entries": {"rationale": ["理由1 / reason1", "理由2 / reason2"]},
        "non_string_entries_str_coerced": {"rationale": [None, 5, True]},
    }
    legacy_join_direct_out = {name: ce._legacy_join(spec) for name, spec in legacy_join_direct_cases.items()}

    _write("content_explanation", {
        "input": {
            "effective_alpha_beta_cases": {n: {"alpha": a, "beta": b, "feature_id": fid} for n, (a, b, fid) in eab_cases.items()},
            "demand_phrase_cases": {n: {"alpha": a, "beta": b, "feature_id": fid} for n, (a, b, fid) in demand_phrase_cases.items()},
            "arousal_band_cases": [{"name": n, "v": v} for n, v in arousal_band_cases],
            "axis_satisfaction_cases": {
                n: {"axis": ax, "direction": d, "arousal_band": ab, "valence": v}
                for n, (ax, d, ab, v) in axis_satisfaction_cases.items()
            },
            "axis_trait_words_cases": {
                n: {"axis": ax, "arousal_band": ab, "valence": v} for n, (ax, ab, v) in axis_trait_words_cases.items()
            },
            "axis_choice_cases": {
                n: {"a": a, "b": b, "arousal_band": ab, "valence": v} for n, (a, b, ab, v) in axis_choice_cases.items()
            },
            "axis_bridge_cases": {
                n: {"a": a, "b": b, "arousal_band": ab, "valence": v} for n, (a, b, ab, v) in axis_bridge_cases.items()
            },
            "song_facts_cases": song_facts_cases,
            "causal_bridge_cases": causal_bridge_cases,
            "build_prompt_cases": build_prompt_cases,
            "family_of_ids": family_of_ids,
            "dominant_family_cases": {n: {"target": t, "dom": d} for n, (t, d) in dominant_family_cases.items()},
            "situation_led_cases": {
                n: {"target": t, "arousal_band": b, "valence": v} for n, (t, b, v) in situation_led_cases.items()
            },
            "template_cases": template_cases,
            "legacy_join_direct_cases": legacy_join_direct_cases,
            "mock_item": mock_item,
        },
        "output": {
            "effective_alpha_beta": eab_out,
            "demand_phrase": demand_phrase_out,
            "arousal_band": arousal_band_out,
            "axis_satisfaction": axis_satisfaction_out,
            "axis_trait_words": axis_trait_words_out,
            "axis_choice": axis_choice_out,
            "axis_bridge": axis_bridge_out,
            "song_facts": song_facts_out,
            "causal_bridge": causal_bridge_out,
            "build_prompt": build_prompt_out,
            "family_of": family_of_out,
            "dominant_family": dominant_family_out,
            "situation_led": situation_led_out,
            "template": template_out,
            "legacy_join_direct": legacy_join_direct_out,
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
    ("proposal_journey", _capture_journey),
    ("proposal_journey_preview", _capture_journey_preview),
    ("explanation_builder", _capture_explanation_builder),
    ("trigger_explanation", _capture_trigger_explanation),
    ("service_explanation", _capture_service_explanation),
    ("content_explanation", _capture_content_explanation),
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
