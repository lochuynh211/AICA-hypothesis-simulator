"""Content-relief model tests (recovery semantics refactor, Task 1)."""
import pytest
from pydantic import ValidationError

from aica_api.models.profile import ActivityRecovery
from aica_api.models.run import ContentContext, ContentReliefState


@pytest.fixture(autouse=True)
def isolate_run_registries():
    """Task 4 tests drive run_manager with a fixed run_id — clear both
    in-memory registries so runs from one test don't leak into the next."""
    from aica_api.services.run_manager import clear_registry
    from aica_api.services.run_plan import clear_draft_registry

    clear_registry()
    clear_draft_registry()
    yield
    clear_registry()
    clear_draft_registry()


def test_activity_recovery_stimulus_fields_default_to_inert():
    rec = ActivityRecovery()
    assert rec.stimulus_relief_per_min == 0.0
    assert rec.cap_stimulus is None


def test_activity_recovery_rejects_negative_stimulus_rate():
    with pytest.raises(ValidationError):
        ActivityRecovery(stimulus_relief_per_min=-1.0)


def test_content_context_builds_the_recovery_key():
    ctx = ContentContext(service_id="humming_karaoke", purpose="pre_rest")
    assert ctx.recovery_key == "humming_karaoke@pre_rest"


def test_content_context_rejects_an_unknown_purpose():
    with pytest.raises(ValidationError):
        ContentContext(service_id="humming_karaoke", purpose="nap")


def test_content_relief_state_starts_with_zero_accrual():
    state = ContentReliefState(content_key="quiz@monotony")
    assert state.accrued_drowsiness == 0.0
    assert state.accrued_fatigue == 0.0
    assert state.accrued_stimulus == 0.0


# ── Tick-engine content relief (Task 3) ─────────────────────────────────────

from tests.helpers_recovery import m2_event_plan, m2_route_facts, m2_scenario_with_recovery


def _advance(scenario, prior, tick_index, *, content=None, content_relief=None, recovery=None):
    from aica_api.services.tick_engine import advance_tick

    route_facts = m2_route_facts(scenario)
    plan = m2_event_plan(scenario)
    return advance_tick(
        prior, tick_index, plan, route_facts, scenario,
        recovery=recovery, run_seed=1,
        content=content, content_relief=content_relief,
    )


def _content_scenario():
    """m2_scenario_with_recovery + the two driving-content entries these tests use."""
    return m2_scenario_with_recovery(
        extra_recovery_entries={
            "quiz@monotony": {"stimulus_relief_per_min": 2.0, "cap_stimulus": 20.0},
            "music_recommend@monotony": {"stimulus_relief_per_min": 0.8, "cap_stimulus": 20.0},
        }
    )


def test_content_active_freezes_the_engine_monotony_accumulator():
    from aica_api.models.run import ContentContext

    scenario = _content_scenario()          # monotonous highway, MOVING
    baseline = _advance(scenario, None, 0)
    assert baseline.monotony_accrued_min > 0.0

    frozen = _advance(
        scenario, None, 0,
        content=ContentContext(service_id="quiz", purpose="monotony"),
    )
    assert frozen.monotony_accrued_min == 0.0
    assert frozen.signals["dynamic"]["contentActive"] is True
    assert frozen.signals["dynamic"]["stimulusFrozen"] is True


def test_no_content_reports_both_flags_false():
    scenario = _content_scenario()
    ts = _advance(scenario, None, 0)
    assert ts.signals["dynamic"]["contentActive"] is False
    assert ts.signals["dynamic"]["stimulusFrozen"] is False


def test_content_relief_accrual_is_threaded_out_for_the_next_tick():
    from aica_api.models.run import ContentContext

    scenario = _content_scenario()
    ts = _advance(
        scenario, None, 0,
        content=ContentContext(service_id="quiz", purpose="monotony"),
    )
    nxt = (ts.model_extra or {}).get("_content_relief_next")
    assert nxt is not None
    assert nxt.content_key == "quiz@monotony"


def test_a_new_episode_resets_the_accrual():
    from aica_api.models.run import ContentContext, ContentReliefState

    scenario = _content_scenario()
    stale = ContentReliefState(
        content_key="music_recommend@monotony", accrued_stimulus=99.0
    )
    ts = _advance(
        scenario, None, 0,
        content=ContentContext(service_id="quiz", purpose="monotony"),
        content_relief=stale,
    )
    nxt = (ts.model_extra or {}).get("_content_relief_next")
    assert nxt.content_key == "quiz@monotony"
    assert nxt.accrued_stimulus < 99.0


# ── run_manager threading + trigger-only fallback (Task 4) ──────────────────


def test_tick_accepts_and_applies_a_content_context():
    from aica_api.models.run import ContentContext
    from aica_api.services import run_manager
    from tests.helpers_recovery import create_content_run

    run_id = create_content_run()
    run_manager.tick(run_id)                            # warm up one plain tick
    outcome = run_manager.tick(
        run_id, content_context=ContentContext(service_id="quiz", purpose="monotony")
    )
    assert outcome.tick_state.signals["dynamic"]["contentActive"] is True
    assert outcome.tick_state.signals["dynamic"]["stimulusFrozen"] is True


def test_acknowledge_synthesises_an_episode_when_there_is_no_proposal_side():
    """§11 — the trigger-only screen has no playback_state, so an acknowledge
    opens a scenario-configured window instead."""
    from aica_api.services import run_manager
    from tests.helpers_recovery import create_content_run

    run_id = create_content_run(
        default_content_episode_min=15.0,
        default_content_service_id="quiz",
    )
    for _ in range(3):
        run_manager.tick(run_id)
    run_manager.action(run_id, "acknowledge")
    outcome = run_manager.tick(run_id)
    assert outcome.tick_state.signals["dynamic"]["stimulusFrozen"] is True


def test_the_synthesised_episode_expires_after_its_window():
    from aica_api.services import run_manager
    from tests.helpers_recovery import create_content_run

    # tick_seconds is 60 in this fixture, so a 1-minute window covers exactly
    # one tick and the tick after it is outside.
    run_id = create_content_run(
        default_content_episode_min=1.0,
        default_content_service_id="quiz",
    )
    for _ in range(3):
        run_manager.tick(run_id)
    run_manager.action(run_id, "acknowledge")
    run_manager.tick(run_id)
    later = run_manager.tick(run_id)
    assert later.tick_state.signals["dynamic"]["stimulusFrozen"] is False


def test_no_fallback_configured_means_no_synthetic_episode():
    from aica_api.services import run_manager
    from tests.helpers_recovery import create_content_run

    run_id = create_content_run()               # both defaults None
    for _ in range(3):
        run_manager.tick(run_id)
    run_manager.action(run_id, "acknowledge")
    outcome = run_manager.tick(run_id)
    assert outcome.tick_state.signals["dynamic"]["contentActive"] is False
