"""Live <-> preview parity for NRI's forecast-rest seam (Task 11, spec §21).

The two-pass forecast seam (Task 6/7, spec §15.4) is implemented as TWO
PARALLEL tick loops that must stay behaviorally identical:
  - `run_manager.tick()`      — the live, HTTP-driven run loop.
  - `iter_preview_ticks()`    — the headless preview/quickview loop
                                 (`evaluate_preview`'s `fires` list is built
                                 from this generator; see
                                 test_iter_preview_ticks.py).

This test drives the SAME package/scenario/seed through both loops and
asserts they agree on exactly which ticks fire, and what category each fire
is — the guard that a change to one loop's forecast/fire-control wiring
cannot silently drift from the other (memory `trip-edge-guard-two-loops`,
`nri-forecast-shared-trigger-scope`).

--- History: Finding 3 diagnosed a dispatch-seam bug; it is now FIXED ---

A second parity test driving a genuine REST_FORECAST_FIRE was attempted
(final-review Finding 3) and was, AT THE TIME, IMPOSSIBLE through the real
`run_manager.tick()` / `iter_preview_ticks()` loops — not merely hard to
schedule, but structurally unreachable, for a reason unrelated to scenario
choice or hyperparameter tuning:

`aica_api.algorithms.python_module.dispatch()` used to build the
`py_context` dict handed to a package's `evaluate()` from a FIXED, explicit
key set (`simulation_time_sec`, `signals`, `feature_groups`, `parameters`,
`hyperparameters`, `proposal_history`, `user_action_history`,
`package_runtime_state`, `recovery_active` — see `dispatch()`'s body). It
never forwarded `context["nri_forecast"]`, the key `run_manager.tick()` and
`preview.iter_preview_ticks()` both set on the OUTER context they pass to
`aica_api.algorithms.adapter.evaluate(...)` (see `run_manager.py` lines
~1187/1310 and `preview.py` lines ~677/753). Verified empirically: spying at
`adapter.evaluate`'s entry showed the outer context correctly carrying
`nri_forecast["evaluated"] == True` on a pass-2 tick, but spying one layer
deeper, at `python_module.dispatch()`'s OWN entry, then diffing against the
`py_context` it built, showed the key was silently dropped before
`nri_fatigue_score_v1.algorithm.evaluate()` ever ran — so
`context.get("nri_forecast")` inside the algorithm always saw `{}`, and
`forecast_evaluated`/`early_fire` could never be True in a live or preview
run, on ANY scenario, under ANY hyperparameters. This matched an independent
observation: every `REST_FORECAST_FIRE` assertion in the test suite
(`test_nri_fatigue_score.py`, grep for the string) calls
`nri_fatigue_score_v1.algorithm.evaluate()` directly with a hand-built
context — none exercised it through the real adapter/dispatch path — and
`test_iter_preview_ticks.py::test_preview_mirrors_forecast_seam`'s own
docstring already noted its `calls` list came back empty on the shared
scenario, without diagnosing why.

What was tried before finding this (per Finding 3's brief, in order):
  1. `uc01_fatigue_recovery_commuter_v0_1` (40 kph): the sole rest spot's
     `eta_from_current_min` only drops under the 30 min actionability filter
     once `s_total` is already far past `threshold_fire` (~198 vs. 100) — the
     scaffold's current-spot check never lands in the (80, 100) band while
     actionable, so pass-2 never becomes eligible.
  2. Hyperparameter tuning on `uc01_fatigue_recovery_v0_1` (the scenario THIS
     file already uses): lowering `threshold_forecast_rest` (e.g. to 75.0)
     does land `s_total` in-band with an actionable current spot at tick 18,
     and pass-2 DOES run (confirmed via the outer-context spy above) and
     DOES compute `future_fire.found = True` with an unactionable future
     spot — exactly the early-fire condition. At the time, the dispatch bug
     above meant none of that reached the algorithm's actual decision: the
     re-evaluated tick's `criteria.forecast_fire_found` and
     `selected_category` came back as if no forecast block existed at all
     (`monotony_prevention`, not `rest_required`/`REST_FORECAST_FIRE`).

--- Fix + closure ---

`python_module.dispatch()` now forwards `context["nri_forecast"]` into
`py_context` (a single conditional line right after the fixed-key literal —
see `python_module.py`), forwarded only when the key is present so every
non-NRI package's `py_context` is byte-identical to before. The seam itself
is proven end-to-end by `test_forecast_dispatch_seam.py`: it drives the exact
early-fire `nri_forecast` block a passing `test_nri_fatigue_score.py` unit
test already builds through the REAL `adapter.evaluate()` ->
`python_module.dispatch()` path against the real `nri_fatigue_score_v1`
manifest, and asserts `REST_FORECAST_FIRE` is reached WITH the block and NOT
reached WITHOUT it — the tightest possible regression, since `dispatch()` is
the only layer between that test and the already-passing
`algorithm.evaluate()` unit tests.

With the fix in place, hyperparameter tuning approach #2 above now produces
a genuine live/preview `REST_FORECAST_FIRE` episode:
`test_live_and_preview_agree_on_rest_forecast_fire_episode` (below) drives
`uc01_fatigue_recovery_v0_1` with `threshold_forecast_rest` lowered to 75.0
(seed 42, local route — the same scenario/seed this file's monotony-parity
test already uses) through BOTH `run_manager` (live, HTTP) and
`iter_preview_ticks` (preview) and asserts both produce a
`REST_FORECAST_FIRE` fire at tick 18 with matching category/`states.rest`.
It uses `iter_preview_ticks` directly rather than `evaluate_preview`'s
collapsed `fires` summary (which this file's first test drives) because that
summary does not carry `decision.states` — `iter_preview_ticks` is the exact
same generator `evaluate_preview` consumes internally (see this docstring's
opening paragraph), so this is still the real preview code path, just read
one layer earlier to recover the field the assertion needs. It does NOT
assert full-list tick-for-tick parity the way the monotony test does: it
reuses this file's own `_choose_action` for the LIVE loop, which — like
every other test in this file — DECLINES a `rest_required` proposal;
`iter_preview_ticks` has no such override hook and always auto-ACCEPTS a
`rest_required` proposal when the scenario declares `recovery_options` (see
`preview.py`'s `can_accept` branch), which `uc01_fatigue_recovery_v0_1` does.
So after the shared tick-18 `REST_FORECAST_FIRE` episode the two runs
legitimately diverge — live declines and soon completes, preview accepts and
starts a recovery, later firing `monotony_prevention` again at tick 38 with
no live counterpart. That divergence is real but orthogonal to the forecast
seam this fix/test targets, so the assertion below is scoped to the shared
`REST_FORECAST_FIRE` episode rather than the whole fire list.

Scenario choice: `uc01_fatigue_recovery_v0_1` (the plain 60kph route, NOT the
40kph commuter variant) — verified ground truth: on this scenario, AT DEFAULT
HYPERPARAMETERS, NRI's monotony band is reached first and DOES fire;
`rest_required` correctly does NOT fire because the route's sole rest spot is
behind the vehicle by the time `s_total` reaches the (default) fire band
(the sentinel-9999.0-not-actionable behavior this feature specs, not a bug —
see
test_t012_rest_handling.py::TestEndToEndEmptyRestRunNRI and
test_iter_preview_ticks.py::test_monotony_then_rest_on_consecutive_ticks_are_separate_episodes's
docstring). That still yields >=1 real, deterministic fire
(`monotony_prevention`) on the SHARED default scenario/seed already exercised
by the other forecast tests, giving a non-vacuous parity check without
pulling in the commuter scenario's extra escalation machinery. The SAME
scenario/seed, with `threshold_forecast_rest` lowered (below), is what the
`REST_FORECAST_FIRE` parity test reuses — see that test's own docstring.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from aica_api.config import settings
from aica_api.main import app
from aica_api.services.preview import evaluate_preview, iter_preview_ticks
from aica_api.services.run_manager import clear_registry
from aica_api.services.run_plan import clear_draft_registry

_NRI_PKG_ID = "nri_fatigue_score_v1"
_SCENARIO_ID = "uc01_fatigue_recovery_v0_1"
_SEED = 42
_MAX_TICKS = 500
# Above the manifest default (65.0) so `s_total` lands strictly inside
# the (threshold_forecast_rest, threshold_fire) early band, with an
# actionable CURRENT rest spot, at tick 18 on this scenario/seed — the exact
# deterministic state test_forecast_parity's Finding-3 investigation found
# (see module docstring). 60.0 < 75.0 < 100.0 keeps the threshold order valid
# (threshold_monotony < threshold_forecast_rest < threshold_fire, §7).
_FORECAST_HP_OVERRIDES = {"threshold_forecast_rest": 75.0}


@pytest.fixture(autouse=True)
def reset_registries():
    clear_registry()
    clear_draft_registry()
    yield
    clear_registry()
    clear_draft_registry()


@pytest.fixture
def client(tmp_path, monkeypatch):
    # Dir-isolation: never write into the real repo-root runs/ (mirrors
    # test_run_manager_forecast.py / test_t012_rest_handling.py's `client` fixture).
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path))
    return TestClient(app)


def _choose_action(decision: dict) -> str:
    """Mirror preview.py's own post-fire action choice (evaluate_preview /
    iter_preview_ticks, around the `proposal_is_actionable` branch): a
    `rest_required` proposal is declined here (this scenario's sole rest spot
    is behind the vehicle by the time NRI's score reaches the fire band, so
    it never actually fires — see module docstring — but this stays faithful
    to preview's own branch order rather than assuming it), and any OTHER
    category (here, `monotony_prevention`) is ACKNOWLEDGED whenever
    "acknowledge" is offered, exactly like preview's
    `elif "acknowledge" in decision.proposal.options:` branch.

    This choice is load-bearing for parity, not cosmetic: acknowledging a
    monotony proposal starts content relief that measurably lowers
    monotony_prevention_score (freeze+drain, Design §6 case 1), which changes
    whether/when the SAME category can legitimately re-fire later. A live
    loop that always declines instead would diverge from preview's fires by
    construction, not because the two tick loops actually disagree.
    """
    proposal = decision["proposal"]
    options = proposal["options"]
    category = decision["selected_category"]
    if category != "rest_required" and "acknowledge" in options:
        return "acknowledge"
    return "decline" if "decline" in options else options[0]


def _run_live(client: TestClient) -> tuple[list[int], list[str]]:
    """Drive NRI over uc01 via the HTTP tick loop (live run_manager path).

    Collects (tick_index, selected_category) at each actionable episode —
    i.e. each tick the run PAUSES for a proposal — then answers it via
    `_choose_action` (mirroring preview.py's own action choice) so the run
    always reaches completion. Mirrors
    test_t012_rest_handling.py::TestEndToEndEmptyRestRunNRI's tick loop,
    except the action chosen matches preview's per-category branch instead of
    unconditionally declining.
    """
    plan = client.post(
        "/api/run-plans",
        json={
            "package_id": _NRI_PKG_ID,
            "scenario_id": _SCENARIO_ID,
            "parameters": {},
            "hyperparameters": {},
            "run_seed": _SEED,
        },
    )
    assert plan.status_code == 201, plan.text
    run = client.post("/api/runs", json={"plan_id": plan.json()["plan_id"]})
    assert run.status_code == 201, run.text
    run_id = run.json()["run_id"]

    fire_ticks: list[int] = []
    fire_categories: list[str] = []
    for _ in range(_MAX_TICKS):
        r = client.post(f"/api/runs/{run_id}/tick")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("error") is None, body["error"]
        if body.get("paused"):
            decision = body["decision"]
            fire_ticks.append(body["tick_index"])
            fire_categories.append(decision["selected_category"])
            action_name = _choose_action(decision)
            action = client.post(f"/api/runs/{run_id}/actions", json={"action": action_name})
            assert action.status_code == 200, action.text
        if body.get("completed"):
            break
    else:
        pytest.fail(f"live run did not complete within {_MAX_TICKS} ticks")

    return fire_ticks, fire_categories


def _run_preview() -> tuple[list[int], list[str]]:
    """Drive the SAME package/scenario/seed through evaluate_preview's `fires`
    list (built from `iter_preview_ticks` — see preview.py) — the preview/
    quickview path."""
    result = evaluate_preview(
        package_id=_NRI_PKG_ID,
        scenario_id=_SCENARIO_ID,
        hyperparameter_overrides={},
        run_seed=_SEED,
        rest_option_id=None,
        packages_dir=settings.packages_dir,
        scenarios_dir=settings.scenarios_dir,
    )
    fire_ticks = [f["tick"] for f in result["fires"]]
    fire_categories = [f["category"] for f in result["fires"]]
    return fire_ticks, fire_categories


def test_live_and_preview_agree_on_forecast_fires(client):
    live_fire_ticks, live_fire_types = _run_live(client)

    # Reset between the two runs — evaluate_preview registers its own ephemeral
    # draft/plan entries and must not see the live run's registry state (mirrors
    # every reset pattern in test_iter_preview_ticks.py).
    clear_registry()
    clear_draft_registry()
    preview_fire_ticks, preview_fire_types = _run_preview()

    # Non-vacuous: on uc01_fatigue_recovery_v0_1, NRI's monotony band fires at
    # least once (verified ground truth — see module docstring). A test that
    # silently passed on zero fires from both sides would prove nothing.
    assert live_fire_ticks, (
        "expected at least one live fire on uc01_fatigue_recovery_v0_1 "
        "(NRI's monotony_prevention band) — got none; this parity check "
        "would be vacuous"
    )
    assert preview_fire_ticks, (
        "expected at least one preview fire on uc01_fatigue_recovery_v0_1 — "
        "got none; this parity check would be vacuous"
    )

    assert live_fire_ticks == preview_fire_ticks
    assert live_fire_types == preview_fire_types


# ---------------------------------------------------------------------------
# REST_FORECAST_FIRE episode parity (Fix A follow-up — dispatch-seam brief)
# ---------------------------------------------------------------------------


def _run_live_with_states(
    client: TestClient, hyperparameter_overrides: dict
) -> tuple[list[int], list[str], list[str | None]]:
    """Same drive as `_run_live`, plus each episode's `states.rest` (needed to
    identify the `REST_FORECAST_FIRE` episode specifically, not just its
    category — `rest_required` also covers the ordinary, non-forecast rest
    path)."""
    plan = client.post(
        "/api/run-plans",
        json={
            "package_id": _NRI_PKG_ID,
            "scenario_id": _SCENARIO_ID,
            "parameters": {},
            "hyperparameters": hyperparameter_overrides,
            "run_seed": _SEED,
        },
    )
    assert plan.status_code == 201, plan.text
    run = client.post("/api/runs", json={"plan_id": plan.json()["plan_id"]})
    assert run.status_code == 201, run.text
    run_id = run.json()["run_id"]

    fire_ticks: list[int] = []
    fire_categories: list[str] = []
    fire_rest_states: list[str | None] = []
    for _ in range(_MAX_TICKS):
        r = client.post(f"/api/runs/{run_id}/tick")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("error") is None, body["error"]
        if body.get("paused"):
            decision = body["decision"]
            fire_ticks.append(body["tick_index"])
            fire_categories.append(decision["selected_category"])
            fire_rest_states.append(decision.get("states", {}).get("rest"))
            action_name = _choose_action(decision)
            action = client.post(f"/api/runs/{run_id}/actions", json={"action": action_name})
            assert action.status_code == 200, action.text
        if body.get("completed"):
            break
    else:
        pytest.fail(f"live run did not complete within {_MAX_TICKS} ticks")

    return fire_ticks, fire_categories, fire_rest_states


def _run_preview_iter_with_states(
    hyperparameter_overrides: dict,
) -> tuple[list[int], list[str], list[str | None]]:
    """Drive the SAME package/scenario/seed through `iter_preview_ticks`
    directly — the exact generator `evaluate_preview` consumes internally
    (see module docstring) — so `decision.states` (not carried by
    `evaluate_preview`'s collapsed `fires` summary) is available per
    episode."""
    events = list(
        iter_preview_ticks(
            package_id=_NRI_PKG_ID,
            scenario_id=_SCENARIO_ID,
            hyperparameter_overrides=hyperparameter_overrides,
            run_seed=_SEED,
            rest_option_id=None,
            packages_dir=settings.packages_dir,
            scenarios_dir=settings.scenarios_dir,
        )
    )
    fire_ticks = [ev.tick_index for ev in events]
    fire_categories = [ev.decision.selected_category for ev in events]
    fire_rest_states = [ev.decision.states.get("rest") for ev in events]
    return fire_ticks, fire_categories, fire_rest_states


def test_live_and_preview_agree_on_rest_forecast_fire_episode(client):
    """With `threshold_forecast_rest` tuned to 75.0 (`_FORECAST_HP_OVERRIDES`
    — see module docstring's "Fix + closure" section), both the live
    `run_manager` loop and the preview `iter_preview_ticks` loop reach a
    genuine `REST_FORECAST_FIRE` episode at tick 18 on
    `uc01_fatigue_recovery_v0_1` / seed 42 — proof, on top of the dispatch-
    seam unit proof in `test_forecast_dispatch_seam.py`, that Fix A's
    `nri_forecast` forward reaches the algorithm through BOTH real tick
    loops, not just one.

    Scoped to the shared `REST_FORECAST_FIRE` episode rather than full-list
    parity — see the module docstring for why the two loops legitimately
    diverge afterward (live declines the rest proposal like every other test
    in this file; `iter_preview_ticks` auto-accepts it because this scenario
    declares `recovery_options`).
    """
    live_fire_ticks, live_fire_types, live_fire_states = _run_live_with_states(
        client, _FORECAST_HP_OVERRIDES
    )

    clear_registry()
    clear_draft_registry()
    preview_fire_ticks, preview_fire_types, preview_fire_states = _run_preview_iter_with_states(
        _FORECAST_HP_OVERRIDES
    )

    # Non-vacuous: both sides must have fired at least once at all.
    assert live_fire_ticks, (
        "expected at least one live fire on uc01_fatigue_recovery_v0_1 with "
        "threshold_forecast_rest=75.0 — got none; this parity check would be "
        "vacuous"
    )
    assert preview_fire_ticks, (
        "expected at least one preview fire on uc01_fatigue_recovery_v0_1 "
        "with threshold_forecast_rest=75.0 — got none; this parity check "
        "would be vacuous"
    )

    # Non-vacuous (forecast-specific): both sides must reach the actual
    # REST_FORECAST_FIRE state, not merely an ordinary rest_required fire —
    # this is the assertion Fix A makes possible.
    assert "REST_FORECAST_FIRE" in live_fire_states, (
        f"expected a live REST_FORECAST_FIRE episode; got states={live_fire_states} "
        f"categories={live_fire_types}"
    )
    assert "REST_FORECAST_FIRE" in preview_fire_states, (
        f"expected a preview REST_FORECAST_FIRE episode; got "
        f"states={preview_fire_states} categories={preview_fire_types}"
    )

    live_idx = live_fire_states.index("REST_FORECAST_FIRE")
    preview_idx = preview_fire_states.index("REST_FORECAST_FIRE")

    # The episode itself must land at the SAME tick with the SAME category on
    # both loops — the actual live<->preview parity claim.
    assert live_fire_ticks[live_idx] == preview_fire_ticks[preview_idx] == 18
    assert live_fire_types[live_idx] == preview_fire_types[preview_idx] == "rest_required"
    assert live_fire_states[live_idx] == preview_fire_states[preview_idx] == "REST_FORECAST_FIRE"
