"""An accepted content episode lasts the SCENARIO's
``default_content_episode_min`` (15 minutes), or until the car reaches the
rest spot — never the content package's ``expected_duration_sec``
(fixbug-0806, bug 1 follow-up).

WHY THIS FILE EXISTS, ON THIS EXACT CONFIGURATION

``tick_merged_run_endpoint`` completes an accepted content plan once its
episode has run its natural length (CDC-SU slide 81, 一定曲数再生完了 /
1セット完了). That length used to be read from the committed plan's
``expected_duration_sec``, which is the CONTENT PACKAGE's description of the
plan it built — and for ``humming_karaoke`` that is a modelling artifact,
``plan_item_count`` x ``fixed_humming_segment_sec`` = 5 x 30s = 150s
(``duration_basis="simulated_fixed_segment"``), i.e. the length of the
humming segments rather than of a listening session.

The owner's own UC-04-01 preset runs **180-second ticks**, so 150s < one
tick: an accepted episode expired on the very tick after it started.

Why that stayed invisible on the monotony path — the question this file
really exists to answer. Monotony's real episode died after one tick too;
``run_manager._synthetic_content_context``, the ``acknowledge``-keyed
15-minute timer, silently carried the remaining 14 minutes (observable as
``playback_state == "completed"`` while ``contentActive`` stayed true). REST
opportunities are deliberately excluded from that acknowledge — they are
answered by accept-rest/decline — so pre-rest had no such rescue and was the
only place the defect surfaced. Reading the episode length from the scenario
fixes both: the REAL episode now runs the full 15 minutes on either path, so
the driver's ACTUALLY chosen service drives the relief throughout instead of
being replaced after one tick by the fallback's ``default_content_service_id``
(``quiz``).

So this file deliberately pins the REAL preset (transparent selectors,
``long_tokyo_osaka`` route preset, the case's own seed/tick_seconds/initial
state) rather than the mock packages the other merged tests use: with the
mocks the plan is several ~7-minute tracks, comfortably longer than a tick,
and the bug is invisible. A mocked version of these tests would pass against
the broken code.

Kept out of ``test_merged_reject_flow.py`` on purpose — that file is the
reject flow on the mock fixtures; this one is an episode-length and
projection-parity guarantee on a specific authored case.
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from aica_api.config import settings
from aica_api.main import app
from aica_api.services.merged_run_coordinator import get_handle
from aica_api.services.run_manager import clear_registry
from aica_api.services.run_plan import clear_draft_registry

client = TestClient(app)

# Mirrors combined_contracts/test_cases/case-uc04-01-longhaul-d.json. Inlined
# rather than read from disk: that directory is a FRONTEND catalog (served
# through `lib/review/caseCatalog.ts`), has no backend registry or settings
# path, and is not mounted into the api container — a test that read it would
# pass locally and error in Docker.
_TRIGGER_PACKAGE_ID = "nri_fatigue_score_v1"
_SERVICE_PACKAGE_ID = "aica_transparent_service_selector_v1"
_CONTENT_PACKAGE_ID = "aica_transparent_content_selector_v1"
_SCENARIO_ID = "uc04_night_longhaul_v0_1"
_ROUTE_PRESET_ID = "long_tokyo_osaka"
_PROFILE_PRESET_ID = "preset-uc04-01-longhaul-d"
_SEED = 42
_TICK_SECONDS = 180
_INITIAL_STATE = {"drowsiness_level": 60, "fatigue_level": 35}
_MAX_TICKS = 400


@pytest.fixture(autouse=True)
def isolate_dirs(tmp_path, monkeypatch):
    """Never let these tests write into real runs/proposal_runs/merged_runs."""
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path / "runs"))
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(tmp_path / "proposal_runs"))
    monkeypatch.setenv("AICA_MERGED_RUNS_DIR", str(tmp_path / "merged_runs"))
    clear_registry()
    clear_draft_registry()
    yield
    clear_registry()
    clear_draft_registry()


@pytest.fixture()
def case_world() -> dict:
    resp = client.get(f"/api/proposal/presets/{_PROFILE_PRESET_ID}")
    assert resp.status_code == 200, resp.text
    return resp.json()["world"]


def _create_merged_run(world: dict) -> str:
    """Build the case's trigger plan + merged run, exactly as the Combined
    setup panel does on Play (`MergedSetupPanel.buildTriggerPlan` ->
    `coordinator.create`): the route preset, the case seed, its
    `tick_seconds` preset and its pinned initial drowsiness/fatigue."""
    plan = client.post(
        "/api/merged-runs/plan",
        json={
            "package_id": _TRIGGER_PACKAGE_ID,
            "scenario_id": _SCENARIO_ID,
            "route_preset_id": _ROUTE_PRESET_ID,
            "run_seed": _SEED,
            "presets": {"tick_seconds": _TICK_SECONDS},
            "initial_state": _INITIAL_STATE,
        },
    )
    assert plan.status_code == 200, plan.text

    resp = client.post(
        "/api/merged-runs",
        json={
            "trigger_plan_id": plan.json()["plan_id"],
            "world": world,
            "service_package_id": _SERVICE_PACKAGE_ID,
            "content_package_id": _CONTENT_PACKAGE_ID,
            "run_seed": str(_SEED),
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["merged_run_id"]


def _committed_plan_duration_sec(proposal_run_id: str) -> int:
    """The committed CONTENT plan's own ``expected_duration_sec``."""
    log = client.get(f"/api/proposal/runs/{proposal_run_id}").json()
    content = [e for e in log["evidence"] if e["step"] == "content" and e.get("error") is None][-1]
    return (content.get("output") or {})["expected_duration_sec"]


def _answer_monotony(mid: str, proposal: dict) -> None:
    """What the reviewer does at a monotony fire: take the rank-1 service and
    press OK. Both calls matter — `accept` is what starts the plan, and
    without answering these the live driver deteriorates faster than the
    projection (which models the driver taking every monotony proposal up)
    and the run reaches its rest fire at a different tick entirely."""
    service_id = proposal["journey_state"]["active_service_id"]
    r = client.post(
        f"/api/merged-runs/{mid}/proposal-action",
        json={"kind": "select_service", "selected_service_id": service_id},
    )
    assert r.status_code == 200, r.text
    r = client.post(
        f"/api/merged-runs/{mid}/proposal-action",
        json={"kind": "journey_action", "action_type": "accept"},
    )
    assert r.status_code == 200, r.text


def _drive_to_rest_fire(mid: str) -> dict:
    for _ in range(_MAX_TICKS):
        body = client.post(f"/api/merged-runs/{mid}/tick").json()
        result_type = (body["trigger"].get("decision") or {}).get("result_type")
        if body["proposal"] and result_type == "REST_PROPOSAL":
            return body["proposal"]
        if body["proposal"] and result_type == "MONOTONY_PROPOSAL":
            _answer_monotony(mid, body["proposal"])
        assert not body["trigger"].get("completed"), "run completed before a REST fire"
    raise AssertionError("no REST fire within the tick budget")


def test_accepted_episode_lasts_the_scenario_episode_length_not_the_plan_duration(case_world):
    """An accepted episode runs ``default_content_episode_min``, on the
    driver's own service, start to finish.

    Measured on the MONOTONY leg on purpose: nothing else can terminate an
    episode there (no arrival), so the observed length IS the applied rule.
    Two independent assertions, because they fail for different reasons:

      * the episode lasts 15 minutes, not the plan's 150s — the length bug;
      * ``playback_state`` stays ``active`` for the whole of it — proving the
        REAL plan drove it, rather than the plan dying after one tick and
        ``_synthetic_content_context`` quietly substituting a ``quiz`` episode
        for the remaining 14 minutes (which is exactly how this defect hid on
        the monotony path while breaking pre-rest).
    """
    scenario = client.get(f"/api/scenarios/{_SCENARIO_ID}").json()
    episode_min = scenario["default_content_episode_min"]
    expected_ticks = int(round(episode_min * 60 / _TICK_SECONDS))

    mid = _create_merged_run(case_world)
    proposal_run_id = None
    for _ in range(_MAX_TICKS):
        body = client.post(f"/api/merged-runs/{mid}/tick").json()
        result_type = (body["trigger"].get("decision") or {}).get("result_type")
        if body["proposal"] and result_type == "MONOTONY_PROPOSAL":
            _answer_monotony(mid, body["proposal"])
            proposal_run_id = get_handle(mid, settings.merged_runs_dir).current_proposal_run_id
            break
        assert not body["trigger"].get("completed"), "run completed before a monotony fire"
    assert proposal_run_id is not None, "setup: expected a monotony fire"

    plan_duration_sec = _committed_plan_duration_sec(proposal_run_id)
    # The premise that makes this test discriminating: if the code still read
    # the plan's duration, an episode this short could not outlive one tick.
    assert 0 < plan_duration_sec < _TICK_SECONDS, (
        f"premise broken: this test needs a committed plan shorter than one "
        f"{_TICK_SECONDS}s tick, got {plan_duration_sec}s"
    )

    content_ticks = 0
    playback_while_playing: list[str] = []
    for _ in range(expected_ticks + 4):
        trigger = client.post(f"/api/merged-runs/{mid}/tick").json()["trigger"]
        if not trigger["content_active"]:
            break
        content_ticks += 1
        playback = client.get(f"/api/proposal/runs/{proposal_run_id}").json()
        playback_while_playing.append(playback["journey_state"]["playback_state"])

    assert content_ticks == expected_ticks, (
        f"an accepted episode must last the scenario's {episode_min} min "
        f"({expected_ticks} ticks of {_TICK_SECONDS}s), not the plan's "
        f"{plan_duration_sec}s; observed {content_ticks} tick(s)"
    )
    # `complete` is applied AFTER the last relieving tick, so only the final
    # sample may read `completed`; every earlier one must still be `active`.
    assert all(s == "active" for s in playback_while_playing[:-1]), (
        f"the driver's own plan must drive the whole episode, not die after "
        f"one tick and leave the synthetic quiz fallback to carry it; "
        f"playback states were {playback_while_playing}"
    )


def test_pre_rest_content_episode_survives_a_plan_shorter_than_one_tick(case_world):
    mid = _create_merged_run(case_world)
    proposal = _drive_to_rest_fire(mid)
    service_id = proposal["journey_state"]["active_service_id"]

    # Accept the rest at the nearest spot (the on-map chooser sends
    # nap_minutes=None — the scenario's own authored nap length).
    handle = get_handle(mid, settings.merged_runs_dir)
    spots = client.get(f"/api/runs/{handle.trigger_run_id}/rest-spots").json()["rest_spots"]
    scenario = client.get(f"/api/scenarios/{_SCENARIO_ID}").json()
    option = [o for o in scenario["recovery_options"] if not o.get("postpone")][0]
    r = client.post(
        f"/api/merged-runs/{mid}/accept-rest",
        json={"recovery_option_id": option["id"], "rest_spot": spots[0], "nap_minutes": None},
    )
    assert r.status_code == 200, r.text

    # Choose the service, then press OK on its content.
    r = client.post(
        f"/api/merged-runs/{mid}/proposal-action",
        json={"kind": "select_service", "selected_service_id": service_id},
    )
    assert r.status_code == 200, r.text
    content_evidence = [e for e in r.json()["evidence"] if e["step"] == "content"][-1]
    plan_duration_sec = (content_evidence.get("output") or {})["expected_duration_sec"]

    # The premise this whole test rests on. If a package retune ever makes the
    # plan longer than a tick, the duration guard can no longer end the episode
    # early and the assertions below stop discriminating — fail loudly here
    # rather than passing vacuously.
    assert 0 < plan_duration_sec < _TICK_SECONDS, (
        f"premise broken: this test needs a committed plan shorter than one "
        f"{_TICK_SECONDS}s tick to exercise the guard, got {plan_duration_sec}s"
    )

    r = client.post(
        f"/api/merged-runs/{mid}/proposal-action",
        json={"kind": "journey_action", "action_type": "accept"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["journey_state"]["playback_state"] == "active"

    # Drive to the spot. Every MOVING tick of that leg must still be playing
    # content — the episode ends at arrival, not after `expected_duration_sec`.
    moving_drowsiness: list[float] = []
    for _ in range(30):
        trigger = client.post(f"/api/merged-runs/{mid}/tick").json()["trigger"]
        assert trigger.get("error") is None, trigger
        assert trigger.get("proposal_error") is None, trigger
        if trigger["motion_state"] != "MOVING":
            break  # arrived at the rest spot — the leg under test is over
        assert trigger["content_active"] is True, (
            "pre-rest content stopped mid-drive — the slide-81 duration guard "
            f"must not apply to a pre_rest episode; tick={trigger}"
        )
        moving_drowsiness.append(trigger["drowsiness"])

    # Before the fix this leg played content for exactly ONE tick
    # (180s >= the 150s plan), so anything >1 with monotonically falling
    # drowsiness is the regression signal.
    assert len(moving_drowsiness) > 1, (
        f"expected the whole drive-to-spot leg under content, got "
        f"{len(moving_drowsiness)} MOVING tick(s): {moving_drowsiness}"
    )
    assert all(b < a for a, b in zip(moving_drowsiness, moving_drowsiness[1:])), (
        f"drowsiness must fall for the whole pre-rest leg; got {moving_drowsiness}"
    )


def test_live_pre_rest_leg_matches_the_quickview_projection(case_world):
    """Parity: the animation's driver-signal curve and the projection's
    `signal_series` are the SAME numbers over the pre-rest leg.

    This is the owner-visible form of the bug — both curves are drawn on the
    same screen, so a divergence reads as the simulator contradicting itself.
    Comparing the series directly (rather than each side's shape in isolation)
    is what makes a future one-sided change to either rule fail here.
    """
    projection = client.post(
        "/api/merged-runs/quickview",
        json={
            "package_id": _TRIGGER_PACKAGE_ID,
            "scenario_id": _SCENARIO_ID,
            "route_preset_id": _ROUTE_PRESET_ID,
            "run_seed": _SEED,
            "initial_state": _INITIAL_STATE,
            "tick_seconds": _TICK_SECONDS,
            "world": case_world,
            "service_package_id": _SERVICE_PACKAGE_ID,
            "content_package_id": _CONTENT_PACKAGE_ID,
            "run_seed_proposal": str(_SEED),
        },
    )
    assert projection.status_code == 200, projection.text
    preview = projection.json()
    preview_by_tick = {p["t"]: p for p in preview["signal_series"]}
    rest_tick = next(
        (f["tick"] for f in preview["fires"] if f.get("category") == "rest_required"), None
    )
    assert rest_tick is not None, "setup: the projection produced no rest fire"

    mid = _create_merged_run(case_world)
    proposal = _drive_to_rest_fire(mid)
    service_id = proposal["journey_state"]["active_service_id"]

    handle = get_handle(mid, settings.merged_runs_dir)
    spots = client.get(f"/api/runs/{handle.trigger_run_id}/rest-spots").json()["rest_spots"]
    scenario = client.get(f"/api/scenarios/{_SCENARIO_ID}").json()
    option = [o for o in scenario["recovery_options"] if not o.get("postpone")][0]
    client.post(
        f"/api/merged-runs/{mid}/accept-rest",
        json={"recovery_option_id": option["id"], "rest_spot": spots[0], "nap_minutes": None},
    )
    client.post(
        f"/api/merged-runs/{mid}/proposal-action",
        json={"kind": "select_service", "selected_service_id": service_id},
    )
    client.post(
        f"/api/merged-runs/{mid}/proposal-action",
        json={"kind": "journey_action", "action_type": "accept"},
    )

    compared = 0
    for _ in range(10):
        trigger = client.post(f"/api/merged-runs/{mid}/tick").json()["trigger"]
        if trigger["motion_state"] != "MOVING":
            break
        expected = preview_by_tick.get(trigger["tick_index"])
        assert expected is not None, f"projection has no sample at tick {trigger['tick_index']}"
        assert trigger["drowsiness"] == pytest.approx(expected["drowsiness"], abs=0.05), (
            f"tick {trigger['tick_index']}: live drowsiness {trigger['drowsiness']} != "
            f"projected {expected['drowsiness']}"
        )
        assert trigger["fatigue"] == pytest.approx(expected["fatigue"], abs=0.05), (
            f"tick {trigger['tick_index']}: live fatigue {trigger['fatigue']} != "
            f"projected {expected['fatigue']}"
        )
        compared += 1

    assert compared > 1, f"expected to compare the whole pre-rest leg, compared {compared} tick(s)"


def test_projection_models_the_post_rest_content_episode(case_world):
    """The projection must model the driver taking up POST-REST content.

    `iter_preview_ticks` auto-accepts every proposal it simulates (monotony ->
    acknowledge, rest -> accept_rest). Until fixbug-0806 it stopped short of
    the one the live run also answers: after the nap, the merged tick
    recomputes an `after_rest_before_restart` proposal and the reviewer starts
    a post-rest episode. The projection modelled a driver who naps and then
    drives on with nothing playing, so its curve climbed at the full baseline
    rate while the animation's climbed slower — a gap that reached a whole
    tick's worth of drowsiness (~5 points) by the next trigger and read, on
    screen, as "the animation is one tick behind the preview".

    Asserted as a RATE comparison rather than fixed numbers: drowsiness must
    climb strictly slower over the ticks right after the nap (content playing)
    than it does once that episode has finished. That survives recalibration of
    the recovery matrix, which pinned values would not.
    """
    projection = client.post(
        "/api/merged-runs/quickview",
        json={
            "package_id": _TRIGGER_PACKAGE_ID,
            "scenario_id": _SCENARIO_ID,
            "route_preset_id": _ROUTE_PRESET_ID,
            "run_seed": _SEED,
            "initial_state": _INITIAL_STATE,
            "tick_seconds": _TICK_SECONDS,
            "world": case_world,
            "service_package_id": _SERVICE_PACKAGE_ID,
            "content_package_id": _CONTENT_PACKAGE_ID,
            "run_seed_proposal": str(_SEED),
        },
    )
    assert projection.status_code == 200, projection.text
    series = projection.json()["signal_series"]
    assert len(series) > 20, "setup: projection produced too few ticks"

    # Scope to the FIRST rest only. A route this long naps three times, and by
    # the last one drowsiness is pinned at the 100 ceiling — deltas there are
    # clamped, not driven by content, so a global window would compare against
    # a saturated curve. Bound the tail at the NEXT fire too, so the comparison
    # never runs into the next episode's own relief.
    by_tick = {p["t"]: p for p in series}
    fires = projection.json()["fires"]
    rest_tick = next((f["tick"] for f in fires if (f.get("category") or "").startswith("rest")), None)
    assert rest_tick is not None, "setup: projection produced no rest fire"
    next_fire = next((f["tick"] for f in fires if f["tick"] > rest_tick), rest_tick + 30)

    window = [by_tick[t] for t in range(rest_tick, min(next_fire + 1, max(by_tick) + 1)) if t in by_tick]
    bottom = min(range(len(window)), key=lambda i: window[i]["drowsiness"])
    after = [p["drowsiness"] for p in window[bottom:]]
    deltas = [b - a for a, b in zip(after, after[1:]) if b > a]
    assert len(deltas) >= 8, f"setup: not enough post-rest climb to measure ({deltas})"

    with_content = sum(deltas[:4]) / 4
    without_content = sum(deltas[-4:]) / 4
    assert with_content < without_content - 0.1, (
        "drowsiness must climb SLOWER right after the rest, while the post-rest "
        f"content episode plays: {with_content:.2f}/tick with content vs "
        f"{without_content:.2f}/tick after it ends"
    )
