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
    run_log_e2e.json          — services/run_manager (full run, reconstructed rest_rule_based_v0_1)
    route_analysis.json       — services/route_analysis.analyze_route
    recovery.json             — services/recovery (start_recovery / advance_recovery)
    preview.json              — POST /api/runs/preview (TestClient)
    rest_spots.json           — POST /api/run-plans + /api/runs + tick + GET /api/runs/{id}/rest-spots (TestClient)
    nri_fatigue_score_v1.json — packages/nri_fatigue_score_v1/algorithm.evaluate (direct import)
    aica_transparent_hybrid_trigger_v1.json — packages/aica_transparent_hybrid_trigger_v1/algorithm.evaluate (direct import)
    feedback.json             — services/feedback.effective_schema / validate
    evidence_report.json      — services/evidence.build_evidence_report (full nri run)
    evidence_markdown.json    — services/evidence_markdown.render_evidence_markdown
    evidence_markdown_nri.json — same (nri run, whole-number float hyperparameter guard)
    nri_tick_by_tick.json     — POST /api/run-plans + runs + tick loop (TestClient), per-tick decision_result

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

# Bundled scenario (same JSON the offline app ships)
_SCENARIO_PATH = _REPO / "htmlapp" / "frontend" / "src" / "data" / "scenarios" / "uc01_fatigue_recovery_v0_1.json"

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
# 8. run_log_e2e (reconstructed rest_rule_based_v0_1 declarative_rule package)
# ---------------------------------------------------------------------------

_REST_RULE_BASED_V0_1 = {
    "id": "rest_rule_based_v0_1",
    "version": "0.1",
    "label": {"ja": "ルールベース休憩提案 v0.1", "en": "Rule-Based Rest Proposal v0.1"},
    "compatible_scenario_types": ["uc01_fatigue"],
    "algorithm": {"type": "declarative_rule", "entrypoint": "rules"},
    "parameters": [],
    "features": [
        {"key": "drowsiness_level", "band_values": ["none", "weak", "moderate", "strong", "severe"]},
        {"key": "fatigue_level", "band_values": ["low", "medium", "high"]},
        {"key": "continuous_driving_time", "band_values": ["short", "moderate", "long"]},
        {"key": "rest_spot_eta", "band_values": ["none", "near", "far"]},
        {"key": "signal_duration", "band_values": ["transient", "brief", "sustained", "persistent"]},
    ],
    "hyperparameters": [],
    "trigger_categories": [{"id": "rest_required", "priority": 1}],
    "rules": [
        {
            "id": "R1",
            "category": "rest_required",
            "conditions": {"drowsiness_level": ["strong", "severe"], "signal_duration": ["sustained", "persistent"], "rest_spot_eta": ["near", "far"]},
            "result": "REST_PROPOSAL",
            "strength": "strong",
        },
        {
            "id": "R2",
            "category": "rest_required",
            "conditions": {"fatigue_level": ["high"], "continuous_driving_time": ["long"], "rest_spot_eta": ["near", "far"]},
            "result": "REST_PROPOSAL",
            "strength": "gentle",
        },
        {
            "id": "R3",
            "category": "rest_required",
            "conditions": {"drowsiness_level": ["moderate"], "continuous_driving_time": ["moderate", "long"], "rest_spot_eta": ["near"]},
            "result": "REST_PROPOSAL",
            "strength": "gentle",
        },
    ],
    "fire_control": {"threshold_source": "trigger_categories", "actionability_guard": "rest_spot_eta"},
    "proposals": [
        {
            "id": "rest_required_proposal",
            "message": {"ja": "休憩を取ってください。", "en": "Please take a rest."},
            "options": ["accept_rest", "postpone", "decline"],
        }
    ],
    "feedback_schema": [],
    "evidence_metrics": [],
}


def _capture_run_log_e2e() -> None:
    import tempfile
    from aica_api.services.run_plan import create_draft, clear_draft_registry
    from aica_api.services.run_manager import create_run, tick, action, get_active_run_log, clear_registry
    from aica_api.models.scenario import ScenarioDef
    from aica_api.models.package import PackageManifest
    from aica_api.models.run import RestSpot

    # Load the existing fixture's package + scenario inputs to preserve them.
    existing = _load_json(_OUT / "run_log_e2e.json")
    inp = existing["input"]
    pkg_raw = inp["package"]
    pkg = PackageManifest.model_validate(pkg_raw)
    scenario_raw = inp["scenario"]
    scenario = ScenarioDef.model_validate(scenario_raw)
    recovery_option_id = inp.get("recoveryOptionId", "nap_karaoke")
    rest_spot_raw = inp.get("restSpot", {"id": "p1", "label": {"ja": "SA", "en": "SA"}, "lat": None, "lng": None, "route_fraction": 0.5})
    rest_spot = RestSpot.model_validate(rest_spot_raw)
    run_seed = inp.get("run_seed", 0) or 0

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
                if not accepted_once:
                    action(run_id, "accept_rest",
                           recovery_option_id=recovery_option_id,
                           rest_spot=rest_spot)
                    accepted_once = True
                else:
                    action(run_id, "decline")

        assert accepted_once, "no REST_PROPOSAL fired in run_log_e2e"
        run_log = get_active_run_log(run_id)
        assert run_log is not None

    _write("run_log_e2e", {
        "input": inp,
        "output": json.loads(run_log.model_dump_json()),
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
# 12. rest_spots (via TestClient, using reconstructed declarative_rule package)
# ---------------------------------------------------------------------------

def _capture_rest_spots() -> None:
    from fastapi.testclient import TestClient
    from aica_api.main import app

    c = TestClient(app)

    # The fixture was originally captured using nri, but the output only depends
    # on run position + scenario rest spots (not the algorithm). We re-capture
    # using nri (what the fixture input records) via TestClient.
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
# 13. nri_fatigue_score_v1 (direct algorithm.evaluate call)
# ---------------------------------------------------------------------------

def _run_algorithm_over_ticks(alg_path: pathlib.Path, pkg_id: str) -> None:
    """Regenerate a python_module algorithm fixture by replaying recorded tick inputs."""
    import importlib.util

    spec = importlib.util.spec_from_file_location(f"{pkg_id}_algorithm", alg_path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[attr-defined]
    evaluate = mod.evaluate

    existing = _load_json(_OUT / f"{pkg_id}.json")
    inp = existing["input"]
    ticks_input = inp["ticks"]

    pkg_runtime_state: dict = {}
    decisions_output = []

    for tick_ctx in ticks_input:
        ctx = dict(tick_ctx)
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
        "input": inp,
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

    existing = _load_json(_OUT / "evidence_report.json")
    inp = existing["input"]
    pkg_raw = inp["package"]
    pkg = PackageManifest.model_validate(pkg_raw)
    scenario_raw = inp["scenario"]
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

        accepted_once = False
        proposal_tick_index = None
        for _ in range(1000):
            outcome = tick(run_id)
            if outcome.completed:
                break
            if outcome.paused:
                if not accepted_once:
                    proposal_tick_index = outcome.evaluated_tick_index
                    action(run_id, "accept_rest",
                           recovery_option_id=recovery_option_id,
                           rest_spot=rest_spot)
                    accepted_once = True
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

        # evidence_markdown_nri: same run but render markdown from the report
        # (this fixture is specifically about the nri whole-number float formatting)
        _write("evidence_markdown_nri", {
            "input": report,
            "output": markdown,
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
            tick_index = body.get("tick_index")
            if not accepted_once:
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
    ("rest_spots", _capture_rest_spots),
    ("nri_fatigue_score_v1", _capture_nri_fatigue_score_v1),
    ("aica_transparent_hybrid_trigger_v1", _capture_aica_transparent_hybrid_trigger_v1),
    ("feedback", _capture_feedback),
    ("evidence_report+evidence_markdown+evidence_markdown_nri", _capture_evidence_fixtures),
    ("nri_tick_by_tick", _capture_nri_tick_by_tick),
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
