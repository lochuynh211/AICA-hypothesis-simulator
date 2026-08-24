"""Two-pass forecast seam in run_manager.tick() (spec §15.4, §20.3)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import aica_api.services.run_manager as rm
import aica_api.algorithms.adapter as adapter_mod
from aica_api.main import app
from aica_api.services.run_manager import clear_registry
from aica_api.services.run_plan import clear_draft_registry

NRI_PACKAGE_ID = "nri_fatigue_score_v1"
SCENARIO_ID = "uc01_fatigue_recovery_v0_1"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset():
    clear_registry(); clear_draft_registry()
    yield
    clear_registry(); clear_draft_registry()


def _make_run(client):
    plan = client.post("/api/run-plans", json={
        "package_id": NRI_PACKAGE_ID, "scenario_id": SCENARIO_ID,
        "parameters": {}, "hyperparameters": {},
    })
    assert plan.status_code == 201
    run = client.post("/api/runs", json={"plan_id": plan.json()["plan_id"]})
    assert run.status_code == 201
    return run.json()["run_id"]


def test_second_pass_runs_only_when_score_in_forecast_band(client, monkeypatch):
    """When pass-1 s_total is in (80,100), tick() attaches an evaluated forecast
    block and re-evaluates; the context the algorithm sees on the *persisted*
    pass has nri_forecast.evaluated True."""
    seen_contexts = []
    real_eval = adapter_mod.evaluate

    def _spy(*, package, context, **kw):
        seen_contexts.append(dict(context.get("nri_forecast") or {}))
        # Force pass-1 score into the forecast band so the seam runs pass 2.
        result = real_eval(package=package, context=context, **kw)
        object.__setattr__(result, "scores", {**result.scores, "s_total": 88.0})
        return result

    monkeypatch.setattr(rm._adapter, "evaluate", _spy)
    run_id = _make_run(client)
    # Tick past the start edge so eligibility isn't blocked by trip-edge.
    for _ in range(30):
        r = client.post(f"/api/runs/{run_id}/tick"); assert r.status_code == 200
        if r.json().get("completed"):
            break
    # At least one tick evaluated twice (pass 1 evaluated False -> pass 2 True).
    assert any(b.get("evaluated") for b in seen_contexts), seen_contexts[-3:]


def test_low_score_never_triggers_second_pass(client, monkeypatch):
    """s_total below the forecast threshold -> no evaluated forecast block ever."""
    real_eval = adapter_mod.evaluate

    def _spy(*, package, context, **kw):
        result = real_eval(package=package, context=context, **kw)
        object.__setattr__(result, "scores", {**result.scores, "s_total": 10.0})
        return result

    monkeypatch.setattr(rm._adapter, "evaluate", _spy)
    seen = []
    orig_rf = rm.run_forecast
    monkeypatch.setattr(rm, "run_forecast", lambda **kw: seen.append(1) or orig_rf(**kw))
    run_id = _make_run(client)
    for _ in range(20):
        r = client.post(f"/api/runs/{run_id}/tick")
        if r.json().get("completed"):
            break
    assert seen == []  # run_forecast never called below threshold


def test_persisted_event_uses_second_pass_runtime_state(client, monkeypatch):
    """Only the 2nd-pass (final) next_package_runtime_state is persisted (§15.4).

    Deviation from the brief's literal test body: the brief tagged
    `next_package_runtime_state` with a GLOBAL call ordinal and asserted every
    persisted ordinal was even (pass 1 = odd, pass 2 = even). That assumes
    exactly two `_adapter.evaluate` calls per two-pass tick. In reality
    `run_forecast`'s projection loop (Task 4) also calls `_adapter.evaluate`
    (via `_projected_evaluate`) once per projected tick — often dozens of
    times — before the seam's own final (2nd) real-context call, so the
    ordinal of that final call is NOT reliably even; it depends on how many
    projected ticks the forecast ran. The even/odd assumption does not hold
    against the real implementation.

    This still proves the same requirement the brief's test was after — the
    persisted state is from the LAST `_adapter.evaluate` call made while
    processing this tick (which, for a two-pass tick, is the seam's own final
    call with the real `context`; the many calls run_forecast makes along the
    way, and pass-1's scaffold-only call, are never what gets stored) — by
    comparing the persisted ordinal against the running call counter itself
    rather than against a fixed parity.
    """
    real_eval = adapter_mod.evaluate
    calls = {"n": 0}

    def _spy(*, package, context, **kw):
        calls["n"] += 1
        result = real_eval(package=package, context=context, **kw)
        object.__setattr__(result, "scores", {**result.scores, "s_total": 88.0})
        # tag runtime state with the pass ordinal so we can tell which was stored
        object.__setattr__(result, "next_package_runtime_state",
                           {**result.next_package_runtime_state, "_pass": calls["n"]})
        return result

    monkeypatch.setattr(rm._adapter, "evaluate", _spy)
    run_id = _make_run(client)
    two_pass_seen = False
    for _ in range(25):
        before = calls["n"]
        r = client.post(f"/api/runs/{run_id}/tick")
        body = r.json()
        after = calls["n"]
        if after - before > 1:
            # This tick ran the two-pass path (pass 1 + >=1 projected calls +
            # the final pass-2 call). Confirm the LAST call's ordinal — not
            # pass 1's, not any of run_forecast's internal ones — is what got
            # persisted.
            two_pass_seen = True
            log = client.get(f"/api/runs/{run_id}/log").json()
            ticks = [e for e in log["events"] if e["kind"] == "tick"]
            last_tick = ticks[-1]
            assert last_tick["package_runtime_state"]["_pass"] == after
        if body.get("completed"):
            break
    assert two_pass_seen, "expected at least one two-pass tick in this run"
