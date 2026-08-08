# Recovery Semantics Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two incoherent, per-algorithm "recovery" hacks with one motion-split recovery model — driving-content relief (`contentActive`) and rest-activity relief (`RecoveryState`) — so NRI and the Hybrid react identically to the same driver event.

**Architecture:** Two mechanisms split by motion, not by trigger. While MOVING and content is playing, the engine suppresses the monotony-sourced drowsiness growth term, freezes its own monotony accumulator, drains it at the content's stimulus rate, and applies the content's drowsiness/fatigue rates — all keyed by a `<service_id>@<purpose>` entry in `recovery_model`. While STOPPED in a `RecoveryState` dwell, rest-activity recovery applies as a per-tick curve. The engine publishes `stimulusFrozen` and both algorithms mirror it exactly, which makes parity structural rather than coincidental.

**Tech Stack:** Python 3.12, FastAPI 0.115.6, Pydantic v2, pytest 8.3.4, `uv` for the API venv. Backend only — no frontend files change.

**Spec:** `docs/superpowers/specs/2026-08-08-recovery-semantics-design.md`

## Global Constraints

- Backend test command: `cd app/api && uv run pytest <path> -v`. Full suite: `cd app/api && uv run pytest -q`.
- Frontend must stay green after every task: `cd app/frontend && npm test`.
- **No new runtime dependencies.** `app/api/pyproject.toml` dependencies are pinned deliberately (supply-chain incident — see the `httpx2` note in that file). Do not add, upgrade, or unpin anything.
- Algorithm packages (`packages/*/algorithm.py`) are **pure**: no backend imports, no clock, no randomness. All time comes from `context["simulation_time_sec"]`.
- Algorithm packages read hyperparameters via direct `hp["key"]` indexing — **never** `hp.get(key, default)`. A missing key must raise `KeyError`.
- `recovery_active` keeps its existing meaning: an accepted rest sequence is in progress. `contentActive` is new and orthogonal. Never conflate them.
- A missing `recovery_model` key recovers nothing. No silent defaults anywhere.
- Every task ends green: full backend suite passing before commit.
- Commit message prefix convention in this repo: `fix(...)`, `feat(...)`, `refactor(...)`, `test(...)`.

---

## File Structure

**Modified:**

| File | Responsibility after this change |
|---|---|
| `app/api/aica_api/models/profile.py` | `ActivityRecovery` carries drowsiness/fatigue **and** stimulus rates + caps |
| `app/api/aica_api/models/run.py` | `ContentContext` (which content, which purpose), `ContentReliefState` (per-episode accrual), `RunState.content_relief` |
| `app/api/aica_api/models/scenario.py` | `RecoveryStage` loses `grants_moving_recovery`; `ScenarioDef` gains the trigger-only fallback defaults |
| `app/api/aica_api/services/behavior/driver_signals.py` | One recovery primitive family: growth suppression, per-tick stage recovery, stimulus relief. The two one-shot functions are gone |
| `app/api/aica_api/services/tick_engine.py` | The single place recovery is applied; publishes `contentActive` / `stimulusFrozen` |
| `app/api/aica_api/services/run_manager.py` | Threads `ContentContext` into the tick; synthesises the trigger-only episode; fire-control §9.1 + §9.2 |
| `app/api/aica_api/routers/merged_runs.py` | Derives `contentActive` from `playback_state`; ends episodes; moves pre-rest teardown to arrival |
| `packages/aica_transparent_hybrid_trigger_v1/algorithm.py` | Freezes `mono_min` mirroring the engine; no rebaseline hack |
| `packages/nri_fatigue_score_v1/algorithm.py` | Freezes `cumulative_monotonous_min` mirroring the engine; no relief hack |
| `scenarios/*.json` | `<service>@<purpose>` recovery entries + fallback defaults |

**Deleted:** `app/api/tests/test_moving_recovery_flag.py` (tests a flag that ceases to exist).

**Created:** `app/api/tests/test_content_relief.py`, `app/api/tests/test_recovery_parity.py`, `app/api/tests/test_recovery_matrix_coverage.py`, `app/api/tests/test_fire_control_window.py`.

---

## Task 1: Models — stimulus fields and content-episode state

Purely additive. Nothing consumes these yet, so the suite stays green.

**Files:**
- Modify: `app/api/aica_api/models/profile.py` (`ActivityRecovery`, ~line 70-103)
- Modify: `app/api/aica_api/models/run.py` (add `ContentContext`, `ContentReliefState`; `RunState`)
- Modify: `app/api/aica_api/models/scenario.py` (`ScenarioDef`)
- Test: `app/api/tests/test_content_relief.py` (create)

**Interfaces:**
- Produces:
  - `ActivityRecovery.stimulus_relief_per_min: float`, `ActivityRecovery.cap_stimulus: float | None`
  - `ContentContext(service_id: str, purpose: str)` with property `recovery_key -> str` returning `f"{service_id}@{purpose}"`
  - `ContentReliefState(content_key: str, accrued_drowsiness: float, accrued_fatigue: float, accrued_stimulus: float)`
  - `RunState.content_relief: ContentReliefState | None`
  - `ScenarioDef.default_content_episode_min: float | None`, `ScenarioDef.default_content_service_id: str | None`

- [ ] **Step 1: Write the failing test**

Create `app/api/tests/test_content_relief.py`:

```python
"""Content-relief model tests (recovery semantics refactor, Task 1)."""
import pytest
from pydantic import ValidationError

from aica_api.models.profile import ActivityRecovery
from aica_api.models.run import ContentContext, ContentReliefState


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/api && uv run pytest tests/test_content_relief.py -v`
Expected: FAIL with `ImportError: cannot import name 'ContentContext' from 'aica_api.models.run'`

- [ ] **Step 3: Add the stimulus fields to `ActivityRecovery`**

In `app/api/aica_api/models/profile.py`, inside `class ActivityRecovery`, add the two fields after `cap_fatigue` and extend the validator tuple:

```python
    drowsiness: float = 0.0
    fatigue: float = 0.0
    drowsiness_per_min: float = 0.0
    fatigue_per_min: float = 0.0
    cap_drowsiness: float | None = None
    cap_fatigue: float | None = None
    # Recovery-semantics refactor: stimulus relief for DRIVING content.
    # `stimulus_relief_per_min` is accumulator-MINUTES drained per minute of
    # playback (1.2 => one minute of content removes 1.2 minutes of accumulated
    # monotonous exposure). `cap_stimulus` bounds the total drained across one
    # content episode, in accumulator-minutes. Both default to 0.0 / None so a
    # rest-activity entry (sleep/stretch) is unaffected.
    stimulus_relief_per_min: float = 0.0
    cap_stimulus: float | None = None

    @field_validator(
        "drowsiness",
        "fatigue",
        "drowsiness_per_min",
        "fatigue_per_min",
        "stimulus_relief_per_min",
    )
    @classmethod
    def _nonneg(cls, v: float) -> float:
        if v < 0:
            raise ValueError(f"recovery amount must be >= 0, got {v!r}")
        return v
```

- [ ] **Step 4: Add `ContentContext` and `ContentReliefState`**

In `app/api/aica_api/models/run.py`, immediately after `class RecoveryState` (which ends at the line `model_config = {"extra": "allow"}`, ~line 350), add:

```python
class ContentContext(BaseModel):
    """Which content is playing, and which trigger purpose it answers.

    Recovery-semantics refactor. The pair — not the content alone — selects the
    `recovery_model` entry, because the same content means different things on
    different channels: 鼻歌カラオケ offered for 漫然運転予防 is stimulus, the
    same content offered en route to a rest spot is 覚醒支援 (CDC-SU slides
    35/38/46). `purpose` is closed: monotony | pre_rest | post_rest.
    """

    service_id: str
    purpose: Literal["monotony", "pre_rest", "post_rest"]

    @property
    def recovery_key(self) -> str:
        """The `driver_signal_params.recovery_model` key for this pair."""
        return f"{self.service_id}@{self.purpose}"


class ContentReliefState(BaseModel):
    """Per-episode accrual for driving-content relief.

    Threaded across ticks by the tick engine so `cap_drowsiness` /
    `cap_fatigue` / `cap_stimulus` bound the TOTAL granted over one content
    episode rather than a single tick's amount. Reset whenever `content_key`
    changes — i.e. on every new episode. Case 1 (inattentive) has no
    `RecoveryState` to hang this on, which is why it is its own model.
    """

    content_key: str
    accrued_drowsiness: float = 0.0
    accrued_fatigue: float = 0.0
    accrued_stimulus: float = 0.0
```

If `Literal` is not already imported in that file, add it to the existing `typing` import line.

- [ ] **Step 5: Add `RunState.content_relief`**

In `app/api/aica_api/models/run.py`, in `class RunState`, add after `route_facts: RouteFacts`:

```python
    # Recovery-semantics refactor: live driving-content episode accrual.
    # None whenever no content is playing. Orthogonal to `recovery` — a driver
    # can be en route to a rest spot (recovery active) WITH content playing.
    content_relief: ContentReliefState | None = None
```

- [ ] **Step 6: Add the trigger-only fallback defaults to `ScenarioDef`**

In `app/api/aica_api/models/scenario.py`, in `class ScenarioDef`, add two optional fields:

```python
    # Recovery-semantics refactor §11 — trigger-only screen fallback. That
    # screen has no proposal run, so `playback_state` (and therefore
    # contentActive) can never be true. When an `acknowledge` is recorded with
    # no proposal side, run_manager synthesises a content episode of
    # `default_content_episode_min` using
    # `<default_content_service_id>@monotony`. Both None => no fallback.
    default_content_episode_min: float | None = None
    default_content_service_id: str | None = None
```

- [ ] **Step 7: Run the new test**

Run: `cd app/api && uv run pytest tests/test_content_relief.py -v`
Expected: PASS (5 tests)

- [ ] **Step 8: Run the full backend suite**

Run: `cd app/api && uv run pytest -q`
Expected: PASS — this task is purely additive with defaults, so no existing test may change.

- [ ] **Step 9: Commit**

```bash
git add app/api/aica_api/models/profile.py app/api/aica_api/models/run.py app/api/aica_api/models/scenario.py app/api/tests/test_content_relief.py
git commit -m "feat(recovery): add stimulus-relief fields and content-episode state models"
```

---

## Task 2: Recovery primitives in `driver_signals`

Additive only — the two one-shot functions stay until Task 3 removes their last caller.

**Files:**
- Modify: `app/api/aica_api/services/behavior/driver_signals.py`
- Test: `app/api/tests/test_driver_signals.py` (append)

**Interfaces:**
- Consumes: `ActivityRecovery.stimulus_relief_per_min` / `.cap_stimulus` (Task 1)
- Produces:
  - `advance_driver_state(..., suppress_monotony_growth: bool = False) -> DriverUpdate`
  - `stage_recovery_total(params, activity: str, minutes: float) -> tuple[float, float]`
  - `apply_stage_recovery_tick(params, current: DriverState, activity: str, stage_ticks: int, tick_seconds: float, accrued_drowsiness: float, accrued_fatigue: float) -> tuple[DriverState, float, float]`
  - `apply_stimulus_relief(params, activity: str, tick_minutes: float, accrued_stimulus: float) -> tuple[float, float]`

- [ ] **Step 1: Write the failing tests**

Append to `app/api/tests/test_driver_signals.py`:

```python
# ── Recovery-semantics refactor (Task 2) ────────────────────────────────────

from aica_api.models.profile import ActivityRecovery
from aica_api.services.behavior.driver_signals import (
    apply_stage_recovery_tick,
    apply_stimulus_relief,
    stage_recovery_total,
)


def _params_with(recovery_model):
    """Minimal DriverSignalParams carrying only the recovery map under test."""
    from aica_api.models.profile import DriverSignalParams, DrowsinessModel, FatigueModel

    return DriverSignalParams(
        id="test",
        drowsiness_model=DrowsinessModel(
            base_growth_per_min=0.1,
            night_add_per_min=0.2,
            monotony_add_per_min=0.5,
            traffic_jam_add_per_min=0.3,
        ),
        fatigue_model=FatigueModel(
            base_growth_per_min=0.1,
            continuous_driving_add_per_min_after_60_min=0.2,
            mountain_road_add_per_min=0.3,
            traffic_jam_add_per_min=0.1,
        ),
        recovery_model=recovery_model,
    )


def test_suppress_monotony_growth_zeroes_only_the_monotony_term():
    params = _params_with({})
    state = DriverState(drowsiness=10.0, fatigue=10.0)
    kwargs = dict(
        is_night=True,
        is_monotonous=True,
        is_traffic_jam=True,
        is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    normal = advance_driver_state(params, state, 60, **kwargs)
    suppressed = advance_driver_state(
        params, state, 60, suppress_monotony_growth=True, **kwargs
    )
    assert normal.delta.drowsiness_monotony == pytest.approx(0.5)
    assert suppressed.delta.drowsiness_monotony == 0.0
    # every other component is untouched
    assert suppressed.delta.drowsiness_base == normal.delta.drowsiness_base
    assert suppressed.delta.drowsiness_night == normal.delta.drowsiness_night
    assert suppressed.delta.drowsiness_jam == normal.delta.drowsiness_jam
    assert suppressed.next.drowsiness == pytest.approx(normal.next.drowsiness - 0.5)


def test_stage_recovery_total_matches_the_legacy_duration_scaled_amount():
    params = _params_with(
        {"sleep": ActivityRecovery(drowsiness=10.0, drowsiness_per_min=1.0, cap_drowsiness=20.0)}
    )
    # flat 10 + min(cap 20, 1.0 * 30 min) = 10 + 20 = 30
    drowsiness_total, fatigue_total = stage_recovery_total(params, "sleep", minutes=30.0)
    assert drowsiness_total == pytest.approx(30.0)
    assert fatigue_total == pytest.approx(0.0)


def test_stage_recovery_tick_spreads_the_total_evenly_and_never_exceeds_it():
    params = _params_with({"sleep": ActivityRecovery(drowsiness=30.0)})
    state = DriverState(drowsiness=100.0, fatigue=100.0)
    accrued_d = accrued_f = 0.0
    # 3 ticks of 600s = 10 min each => 30 minutes total dwell
    for _ in range(3):
        state, accrued_d, accrued_f = apply_stage_recovery_tick(
            params, state, "sleep",
            stage_ticks=3, tick_seconds=600.0,
            accrued_drowsiness=accrued_d, accrued_fatigue=accrued_f,
        )
    assert accrued_d == pytest.approx(30.0)
    assert state.drowsiness == pytest.approx(70.0)
    # a fourth tick grants nothing — the aggregate total is spent
    state, accrued_d, accrued_f = apply_stage_recovery_tick(
        params, state, "sleep",
        stage_ticks=3, tick_seconds=600.0,
        accrued_drowsiness=accrued_d, accrued_fatigue=accrued_f,
    )
    assert accrued_d == pytest.approx(30.0)
    assert state.drowsiness == pytest.approx(70.0)


def test_stimulus_relief_drains_per_minute_and_saturates_at_the_cap():
    params = _params_with(
        {"quiz@monotony": ActivityRecovery(stimulus_relief_per_min=2.0, cap_stimulus=5.0)}
    )
    drained, accrued = apply_stimulus_relief(
        params, "quiz@monotony", tick_minutes=2.0, accrued_stimulus=0.0
    )
    assert drained == pytest.approx(4.0)
    assert accrued == pytest.approx(4.0)
    # next tick may only take the remaining 1.0 of headroom
    drained, accrued = apply_stimulus_relief(
        params, "quiz@monotony", tick_minutes=2.0, accrued_stimulus=accrued
    )
    assert drained == pytest.approx(1.0)
    assert accrued == pytest.approx(5.0)


def test_stimulus_relief_for_an_unknown_key_drains_nothing():
    params = _params_with({})
    drained, accrued = apply_stimulus_relief(
        params, "no_such@monotony", tick_minutes=5.0, accrued_stimulus=0.0
    )
    assert drained == 0.0
    assert accrued == 0.0
```

If `pytest` and `DriverState` / `advance_driver_state` are not already imported at the top of that test file, add them.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app/api && uv run pytest tests/test_driver_signals.py -v -k "suppress_monotony or stage_recovery or stimulus_relief"`
Expected: FAIL with `ImportError: cannot import name 'apply_stimulus_relief'`

- [ ] **Step 3: Add `suppress_monotony_growth` to `advance_driver_state`**

In `app/api/aica_api/services/behavior/driver_signals.py`, add the keyword-only parameter and use it. Change the signature (currently ending `continuous_driving_min: float,`) and the `d_monotony` line:

```python
def advance_driver_state(
    params: DriverSignalParams,
    current: DriverState,
    tick_seconds: int,
    *,
    is_night: bool,
    is_monotonous: bool,
    is_traffic_jam: bool,
    is_mountain_road: bool,
    continuous_driving_min: float,
    suppress_monotony_growth: bool = False,
) -> DriverUpdate:
```

Extend the docstring's Args block with:

```
        suppress_monotony_growth: When True, the monotony-sourced drowsiness
            growth term is zeroed for this tick. Set by the tick engine while
            driving content is playing: the driver is receiving stimulus, so
            boredom is not driving drowsiness upward (CDC-SU slide 31,
            刺激がない状態の継続). Every other growth component is unaffected.
```

And replace the `d_monotony` assignment:

```python
    d_monotony = (
        0.0
        if suppress_monotony_growth
        else (dm.monotony_add_per_min * scale if is_monotonous else 0.0)
    )
```

- [ ] **Step 4: Add the three new functions**

Append to the Public API section of the same file, after `apply_rest_recovery_rate_capped`:

```python
def stage_recovery_total(
    params: DriverSignalParams,
    activity: str,
    minutes: float,
) -> tuple[float, float]:
    """Total (drowsiness, fatigue) recovery a STOPPED stage of ``minutes`` grants.

    Exactly the amount the retired ``apply_rest_recovery_minutes`` computed —
    ``flat + min(cap, per_min * minutes)`` per component, with the cap applying
    only to the rate-derived portion. Kept as its own function so the per-tick
    distribution in ``apply_stage_recovery_tick`` is provably
    calibration-preserving: same total, different shape.

    An unknown activity totals (0.0, 0.0).
    """
    rec = params.recovery_model.get(activity)
    if rec is None:
        return 0.0, 0.0

    drowsiness_rate = rec.drowsiness_per_min * minutes
    if rec.cap_drowsiness is not None:
        drowsiness_rate = min(drowsiness_rate, rec.cap_drowsiness)

    fatigue_rate = rec.fatigue_per_min * minutes
    if rec.cap_fatigue is not None:
        fatigue_rate = min(fatigue_rate, rec.cap_fatigue)

    return rec.drowsiness + drowsiness_rate, rec.fatigue + fatigue_rate


def apply_stage_recovery_tick(
    params: DriverSignalParams,
    current: DriverState,
    activity: str,
    stage_ticks: int,
    tick_seconds: float,
    accrued_drowsiness: float,
    accrued_fatigue: float,
) -> tuple[DriverState, float, float]:
    """Apply ONE tick's share of a STOPPED stage's recovery.

    The stage's whole-dwell total (``stage_recovery_total`` over
    ``stage_ticks * tick_seconds / 60`` minutes) is divided evenly across
    ``stage_ticks`` and granted one share per call, bounded by the remaining
    headroom under that total. So the driver recovers as a CURVE across the
    dwell instead of in one step on the entry tick, while the total is
    identical to the previous one-shot model.

    Args:
        stage_ticks:         The stage's full dwell length in ticks (>= 1).
        accrued_drowsiness:  Total drowsiness recovery already granted THIS stage.
        accrued_fatigue:     Total fatigue recovery already granted THIS stage.

    Returns:
        ``(new_state, new_accrued_drowsiness, new_accrued_fatigue)`` — the
        accrued totals INCLUDE this tick's share, for the caller to thread
        forward. Result state is clamped >= 0. An unknown activity or
        ``stage_ticks <= 0`` recovers nothing.
    """
    if stage_ticks <= 0:
        return current, accrued_drowsiness, accrued_fatigue

    minutes = stage_ticks * tick_seconds / 60.0
    total_drowsiness, total_fatigue = stage_recovery_total(params, activity, minutes)

    drowsiness_share = min(
        total_drowsiness / stage_ticks, max(0.0, total_drowsiness - accrued_drowsiness)
    )
    fatigue_share = min(
        total_fatigue / stage_ticks, max(0.0, total_fatigue - accrued_fatigue)
    )

    new_state = DriverState(
        drowsiness=_clamp(current.drowsiness - drowsiness_share),
        fatigue=_clamp(current.fatigue - fatigue_share),
    )
    return new_state, accrued_drowsiness + drowsiness_share, accrued_fatigue + fatigue_share


def apply_stimulus_relief(
    params: DriverSignalParams,
    activity: str,
    tick_minutes: float,
    accrued_stimulus: float,
) -> tuple[float, float]:
    """Accumulator-minutes of monotonous exposure drained by one tick of content.

    Driving content is stimulus, so it interrupts 刺激がない状態の継続 (CDC-SU
    slide 31). The FREEZE is the caller's job — this function supplies only the
    additional DRAIN: ``stimulus_relief_per_min * tick_minutes``, bounded by the
    remaining headroom under ``cap_stimulus`` across the episode.

    Args:
        activity:         The ``<service_id>@<purpose>`` recovery-model key.
        accrued_stimulus: Accumulator-minutes already drained THIS episode.

    Returns:
        ``(drained_minutes, new_accrued_stimulus)``. An unknown key or an entry
        with no stimulus rate drains 0.0. With ``cap_stimulus is None`` the
        drain is unbounded across the episode.
    """
    rec = params.recovery_model.get(activity)
    if rec is None:
        return 0.0, accrued_stimulus

    drained = rec.stimulus_relief_per_min * tick_minutes
    if rec.cap_stimulus is not None:
        drained = min(drained, max(0.0, rec.cap_stimulus - accrued_stimulus))

    return drained, accrued_stimulus + drained
```

- [ ] **Step 5: Run the new tests**

Run: `cd app/api && uv run pytest tests/test_driver_signals.py -v`
Expected: PASS — all pre-existing tests too (`suppress_monotony_growth` defaults to False, so nothing changes for existing callers).

- [ ] **Step 6: Run the full backend suite**

Run: `cd app/api && uv run pytest -q`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add app/api/aica_api/services/behavior/driver_signals.py app/api/tests/test_driver_signals.py
git commit -m "feat(recovery): add growth suppression, per-tick stage recovery, and stimulus relief primitives"
```

---

## Task 3: Tick engine — one recovery path

The core change. Deletes both one-shot functions and the `grants_moving_recovery` flag along with their last callers, so the tree stays consistent.

**Files:**
- Modify: `app/api/aica_api/services/tick_engine.py` (~lines 243-400, and the `signals` dict ~line 445)
- Modify: `app/api/aica_api/services/behavior/driver_signals.py` (delete two functions)
- Modify: `app/api/aica_api/models/scenario.py` (delete `RecoveryStage.grants_moving_recovery`)
- Delete: `app/api/tests/test_moving_recovery_flag.py`
- Modify: `app/api/tests/test_tick_engine_enriched_recovery.py` (retarget to the curve)
- Test: `app/api/tests/test_content_relief.py` (append)

**Interfaces:**
- Consumes: `apply_stage_recovery_tick`, `apply_stimulus_relief`, `advance_driver_state(..., suppress_monotony_growth=...)` (Task 2); `ContentContext`, `ContentReliefState` (Task 1)
- Produces:
  - `advance_tick(..., content: ContentContext | None = None, content_relief: ContentReliefState | None = None) -> TickState`
  - `TickState.signals["dynamic"]["contentActive"]: bool`
  - `TickState.signals["dynamic"]["stimulusFrozen"]: bool`
  - `TickState.model_extra["_content_relief_next"]: ContentReliefState | None`

- [ ] **Step 1: Write the failing tests**

Append to `app/api/tests/test_content_relief.py`:

```python
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
```

Extend `m2_scenario_with_recovery` in `app/api/tests/helpers_recovery.py` with an
`extra_recovery_entries: dict[str, dict] | None = None` keyword. It merges into the
`recovery_model` it already builds:

```python
def m2_scenario_with_recovery(
    *,
    total_km: float = 120.0,
    initial_drowsiness: str = "none",
    extra_recovery_entries: dict[str, dict] | None = None,
    default_content_episode_min: float | None = None,
    default_content_service_id: str | None = None,
) -> ScenarioDef:
```

Inside, after the existing `recovery_model` dict is built:

```python
    recovery_model = {
        # ... the existing sleep / audio_karaoke / stretch entries, unchanged ...
    }
    for key, values in (extra_recovery_entries or {}).items():
        recovery_model[key] = ActivityRecovery(**values)
```

and pass the two `default_content_*` values through to the returned `ScenarioDef`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app/api && uv run pytest tests/test_content_relief.py -v -k "content_active or both_flags or threaded or new_episode"`
Expected: FAIL with `TypeError: advance_tick() got an unexpected keyword argument 'content'`

- [ ] **Step 3: Add the parameters and resolve the episode**

In `app/api/aica_api/services/tick_engine.py`, extend `advance_tick`'s signature:

```python
def advance_tick(
    prior_state: TickState | None,
    tick_index: int,
    event_plan: EventPlan,
    route_facts: RouteFacts,
    scenario: ScenarioDef,
    *,
    recovery: RecoveryState | None = None,
    run_seed: int | None = None,
    content: ContentContext | None = None,
    content_relief: ContentReliefState | None = None,
) -> TickState:
```

Add to the import at the top of the file:

```python
from aica_api.models.run import (
    ContentContext,
    ContentReliefState,
    EventPlan,
    FeatureGroups,
    RecoveryState,
    RouteFacts,
    TickState,
)
```

Extend the docstring's Args block:

```
        content:        The content episode playing this tick (service + purpose),
                        or None. Selects the `<service>@<purpose>` recovery_model
                        entry. Independent of `recovery` — content can play while
                        driving to a rest spot.
        content_relief: Accrual carried from the previous tick of the SAME
                        episode. Reset automatically when `content.recovery_key`
                        differs from `content_relief.content_key`.
```

- [ ] **Step 4: Freeze the monotony proxy while content is active**

Replace the monotony-proxy block (currently `_MONOTONOUS_SEGMENTS = ...` through the `monotony_level = round(...)` statement, ~lines 294-301) with:

```python
    _MONOTONOUS_SEGMENTS = ("highway", "normal_road")
    # Recovery-semantics refactor: driving content is stimulus, so
    # 刺激がない状態の継続 stops continuing (CDC-SU slide 31). Applies only while
    # MOVING — content at a rest spot is ご褒美, not a countermeasure (slide 38).
    content_active = content is not None
    stimulus_frozen = content_active and motion_state == "MOVING"
    if stimulus_frozen:
        new_monotony_accrued_min = monotony_accrued_min
    elif segment_type in _MONOTONOUS_SEGMENTS and motion_state == "MOVING":
        new_monotony_accrued_min = monotony_accrued_min + tick_seconds / 60.0
    else:
        new_monotony_accrued_min = max(0.0, monotony_accrued_min - 2.0 * tick_seconds / 60.0)

    # Drain on top of the freeze, bounded per episode.
    content_relief_next: ContentReliefState | None = None
    if content is not None:
        key = content.recovery_key
        if content_relief is not None and content_relief.content_key == key:
            content_relief_next = content_relief.model_copy()
        else:
            content_relief_next = ContentReliefState(content_key=key)
        if stimulus_frozen and scenario.driver_signal_params is not None:
            from aica_api.services.behavior.driver_signals import apply_stimulus_relief
            _drained, _accrued_stimulus = apply_stimulus_relief(
                scenario.driver_signal_params,
                key,
                tick_minutes=tick_seconds / 60.0,
                accrued_stimulus=content_relief_next.accrued_stimulus,
            )
            new_monotony_accrued_min = max(0.0, new_monotony_accrued_min - _drained)
            content_relief_next = content_relief_next.model_copy(
                update={"accrued_stimulus": _accrued_stimulus}
            )

    monotony_level = round(
        min(100.0, (new_monotony_accrued_min / 30.0) * 80.0 + (20.0 if is_night else 0.0))
    )
```

- [ ] **Step 5: Suppress the monotony growth term**

In the driver-signal block (~line 304), pass the new flag:

```python
        driver_update = advance_driver_state(
            scenario.driver_signal_params, driver_state, tick_seconds,
            is_night=is_night,
            is_monotonous=is_monotonous,
            is_traffic_jam=is_traffic_jam,
            is_mountain_road=is_mountain_road,
            continuous_driving_min=continuous_driving_min,
            suppress_monotony_growth=stimulus_frozen,
        )
```

- [ ] **Step 6: Replace the whole recovery-application block**

Replace everything from the comment `# ── Recovery: apply a rest activity's recovery ─────` down to (and including) the `moving_recovery_accrued_fatigue` update block — i.e. the entire `if (recovery is not None and recovery.active and scenario.driver_signal_params is not None): ...` statement — with:

```python
    # ── Apply recovery ────────────────────────────────────────────────────
    # Recovery-semantics refactor. TWO mechanisms, split by MOTION:
    #
    #   STOPPED + RecoveryState stage  -> rest-activity recovery, per-tick
    #       curve across the dwell (apply_stage_recovery_tick). Total is
    #       identical to the retired one-shot-on-entry model.
    #   MOVING + content playing       -> driving-content recovery, per-tick
    #       rate from the <service>@<purpose> entry, capped per episode.
    #
    # They are independent: a driver en route to a rest spot is MOVING with
    # content playing, so only the second applies until the wheels stop.
    if scenario.driver_signal_params is not None:
        from aica_api.services.behavior.driver_signals import (
            DriverState, apply_rest_recovery_rate_capped, apply_stage_recovery_tick,
        )

        if motion_state == "STOPPED" and recovery is not None and recovery.active:
            _rec_option = next(
                (o for o in scenario.recovery_options if o.id == recovery.option_id), None
            )
            _stage = (
                _rec_option.stages[recovery.stage_index]
                if _rec_option and 0 <= recovery.stage_index < len(_rec_option.stages)
                else None
            )
            if _stage is not None:
                recovered, _acc_d, _acc_f = apply_stage_recovery_tick(
                    scenario.driver_signal_params,
                    DriverState(drowsiness=new_drowsiness, fatigue=new_fatigue),
                    _stage.content,
                    stage_ticks=(_stage.ticks or 0),
                    tick_seconds=tick_seconds,
                    accrued_drowsiness=recovery.moving_recovery_accrued_drowsiness,
                    accrued_fatigue=recovery.moving_recovery_accrued_fatigue,
                )
                new_drowsiness, new_fatigue = recovered.drowsiness, recovered.fatigue
                if (
                    recovery_next is not None
                    and recovery_next.stage_index == recovery.stage_index
                ):
                    recovery_next = recovery_next.model_copy(update={
                        "moving_recovery_accrued_drowsiness": _acc_d,
                        "moving_recovery_accrued_fatigue": _acc_f,
                    })

        elif stimulus_frozen and content_relief_next is not None:
            recovered, _acc_d, _acc_f = apply_rest_recovery_rate_capped(
                scenario.driver_signal_params,
                DriverState(drowsiness=new_drowsiness, fatigue=new_fatigue),
                content.recovery_key,
                tick_minutes=tick_seconds / 60.0,
                accrued_drowsiness=content_relief_next.accrued_drowsiness,
                accrued_fatigue=content_relief_next.accrued_fatigue,
            )
            new_drowsiness, new_fatigue = recovered.drowsiness, recovered.fatigue
            content_relief_next = content_relief_next.model_copy(update={
                "accrued_drowsiness": _acc_d,
                "accrued_fatigue": _acc_f,
            })
```

Note: `recovery.moving_recovery_accrued_*` is now reused for the STOPPED dwell accrual. `_enter_stage` in `services/recovery.py` already resets both to 0.0 on every stage transition, which is exactly the per-stage boundary this needs — no change there.

- [ ] **Step 7: Publish the two flags and thread the accrual out**

In the `signals` dict, add to the `"dynamic"` block after `"monotonyLevel": monotony_level,`:

```python
            "contentActive": content_active,
            "stimulusFrozen": stimulus_frozen,
```

And just before `return ts`, next to the existing `_recovery_next` stash:

```python
    if recovery_next is not None:
        ts.model_extra["_recovery_next"] = recovery_next
    if content_relief_next is not None:
        ts.model_extra["_content_relief_next"] = content_relief_next
    return ts
```

- [ ] **Step 8: Delete the retired functions and the flag**

In `app/api/aica_api/services/behavior/driver_signals.py`, delete `apply_rest_recovery` and `apply_rest_recovery_minutes`.

**Other callers you must update in the same commit** (found in pre-flight — the suite will
not catch the first one):

- `htmlapp/frontend/scripts/gen/capture_all.py` imports `apply_rest_recovery` at line 298
  and calls it at line 326 to capture golden fixtures for the TypeScript port. It is a
  script, not a test, so nothing fails until someone runs it. Repoint it to
  `apply_stage_recovery_tick`, passing `stage_ticks=1` and `tick_seconds=<the capture's own
  cadence>` so a single call yields the whole activity's amount, and update the module
  docstring at line 12. The captured values will change; that is expected and the htmlapp
  follow-up regenerates them.
- These test modules import or reference the deleted functions and must be updated to the
  new primitives: `tests/test_tick_engine_recovery.py`, `tests/test_enriched_recovery.py`,
  `tests/test_tick_engine.py`, `tests/helpers_recovery.py`, `tests/test_driver_signals.py`.
  Most are one-line import swaps plus the same total-preserving assertion change described
  in Step 9. Keep every fixture's numbers unchanged — only the call shape moves.

In `app/api/aica_api/models/scenario.py`, delete the `grants_moving_recovery` field from `RecoveryStage` and any mention of it in that class's docstring.

Delete the obsolete test file:

```bash
git rm app/api/tests/test_moving_recovery_flag.py
```

- [ ] **Step 9: Retarget the enriched-recovery test**

`app/api/tests/test_tick_engine_enriched_recovery.py` asserts the one-shot-on-entry shape. Change its assertions from "all recovery lands on the entry tick" to "recovery is spread across the dwell and the total is unchanged". Concretely, for a stage of N ticks: assert drowsiness strictly decreases on each of the N ticks, and that the drop from before the dwell to after equals the previous total. Do not change the fixture's numbers.

- [ ] **Step 10: Run the affected tests**

Run: `cd app/api && uv run pytest tests/test_content_relief.py tests/test_driver_signals.py tests/test_tick_engine.py tests/test_tick_engine_recovery.py tests/test_tick_engine_enriched_recovery.py tests/test_enriched_recovery.py tests/test_monotony_signal.py -v`
Expected: PASS

- [ ] **Step 11: Run the full backend suite**

Run: `cd app/api && uv run pytest -q`
Expected: PASS. Failures here are almost certainly scenario fixtures that still carry `grants_moving_recovery` — remove that key from any JSON fixture that sets it (`extra="forbid"` will reject it).

- [ ] **Step 12: Commit**

```bash
git add -A app/api/aica_api/services/tick_engine.py app/api/aica_api/services/behavior/driver_signals.py app/api/aica_api/models/scenario.py app/api/tests/
git commit -m "refactor(recovery): one motion-split recovery path in the tick engine"
```

---

## Task 4: Thread the content episode through `run_manager`, with the trigger-only fallback

**Files:**
- Modify: `app/api/aica_api/services/run_manager.py` (`tick`, ~line 711-800)
- Test: `app/api/tests/test_content_relief.py` (append)

**Interfaces:**
- Consumes: `advance_tick(..., content=..., content_relief=...)` (Task 3); `ScenarioDef.default_content_episode_min` / `.default_content_service_id` (Task 1)
- Produces: `run_manager.tick(run_id, *, content_context: ContentContext | None = None) -> TickOutcome`

- [ ] **Step 1: Write the failing tests**

Append to `app/api/tests/test_content_relief.py`:

```python
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
```

Add `create_content_run` to `app/api/tests/helpers_recovery.py`, modelled directly on the
existing `create_paused_rest_run` in that file (same `create_draft` → `create_run` flow,
same `_PACKAGE_PATH`):

```python
def create_content_run(
    *,
    default_content_episode_min: float | None = None,
    default_content_service_id: str | None = None,
) -> str:
    """A started M2 run whose scenario carries a `quiz@monotony` recovery entry
    and, optionally, the §11 trigger-only fallback defaults.

    Unlike `create_paused_rest_run` this does NOT tick until a fire — the
    content-relief tests drive the ticks themselves so they control exactly
    which tick the episode opens on.

    The caller's autouse fixture must clear both the run_manager and run_plan
    registries between tests.
    """
    from aica_api.services.run_manager import create_run
    from aica_api.services.run_plan import create_draft

    scenario = m2_scenario_with_recovery(
        extra_recovery_entries={
            "quiz@monotony": {"stimulus_relief_per_min": 2.0, "cap_stimulus": 20.0},
        },
        default_content_episode_min=default_content_episode_min,
        default_content_service_id=default_content_service_id,
    )
    package = PackageManifest(**json.loads(_PACKAGE_PATH.read_text(encoding="utf-8")))
    plan_id = create_draft(package=package, scenario=scenario)
    run_id = "content_relief_run"
    with tempfile.TemporaryDirectory() as runs_dir:
        create_run(plan_id, run_id, pathlib.Path(runs_dir))
    return run_id
```

Match `create_draft`'s real signature by copying the call exactly as `create_paused_rest_run`
makes it — including any hyperparameter pins that helper applies. If the scenario's
`allowed_actions` does not already include `acknowledge`, add it in
`m2_scenario_with_recovery`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app/api && uv run pytest tests/test_content_relief.py -v -k "content_context or synthesis or expires or no_fallback"`
Expected: FAIL with `TypeError: tick() got an unexpected keyword argument 'content_context'`

- [ ] **Step 3: Add the fallback resolver**

In `app/api/aica_api/services/run_manager.py`, add above `def tick(`:

```python
def _synthetic_content_context(
    events: list,
    scenario,
    current_sim_sec: float,
    tick_seconds: float,
) -> "ContentContext | None":
    """Trigger-only screen fallback (recovery design §11).

    That screen has no proposal run, so `playback_state` — and therefore
    `contentActive` — can never be true, and after the erase-hacks were deleted
    an acknowledged monotony proposal would relieve nothing at all. When the
    scenario configures both `default_content_episode_min` and
    `default_content_service_id`, the most recent `acknowledge` opens a
    synthetic episode of that length using `<service>@monotony`.

    Identical numbers and identical code path to the Combined screen — only the
    WINDOW is synthetic (a timer) rather than real (`playback_state`).

    Returns None when the fallback is not configured, no acknowledge has
    happened, or the window has expired.
    """
    episode_min = scenario.default_content_episode_min
    service_id = scenario.default_content_service_id
    if episode_min is None or service_id is None:
        return None

    last_ack_sec: float | None = None
    for event in events:
        if event.kind == "action" and event.action == "acknowledge":
            last_ack_sec = float(event.tick_index * tick_seconds)
    if last_ack_sec is None:
        return None
    if current_sim_sec - last_ack_sec >= episode_min * 60.0:
        return None

    return ContentContext(service_id=service_id, purpose="monotony")
```

Add `ContentContext` and `ContentReliefState` to this module's `aica_api.models.run` import line.

- [ ] **Step 4: Thread it through `tick`**

Change the signature:

```python
def tick(run_id: str, *, content_context: ContentContext | None = None) -> TickOutcome:
```

Extend the docstring's Args block:

```
        content_context: The content episode playing this tick, supplied by the
            merged router from the proposal run's `playback_state`. When None
            and the scenario configures the §11 fallback, a synthetic episode is
            derived from the most recent `acknowledge` instead.
```

In the M2 branch, resolve and pass it:

```python
    if _is_m2_scenario(scenario):
        effective_content = content_context
        if effective_content is None:
            effective_content = _synthetic_content_context(
                recorder.run_log.events,
                scenario,
                current_sim_sec=float(current_tick * run_state.event_plan.tick_seconds),
                tick_seconds=float(run_state.event_plan.tick_seconds),
            )
        tick_state = advance_tick(
            prior_tick_state,
            current_tick,
            run_state.event_plan,
            run_state.route_facts,
            scenario,
            recovery=run_state.recovery,
            run_seed=run_state.run_seed,
            content=effective_content,
            content_relief=run_state.content_relief,
        )
        rec_next = (tick_state.model_extra or {}).get("_recovery_next")
        if rec_next is not None:
            run_state.recovery = rec_next if rec_next.active else None
        # Thread the content-episode accrual forward; clear it the moment no
        # content is playing so the next episode starts from zero.
        run_state.content_relief = (tick_state.model_extra or {}).get(
            "_content_relief_next"
        )
```

- [ ] **Step 5: Run the new tests**

Run: `cd app/api && uv run pytest tests/test_content_relief.py -v`
Expected: PASS

- [ ] **Step 6: Run the full backend suite**

Run: `cd app/api && uv run pytest -q`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add app/api/aica_api/services/run_manager.py app/api/tests/
git commit -m "feat(recovery): thread content episodes through the tick, with trigger-only fallback"
```

---

## Task 5: Hybrid — mirror the engine's freeze, delete the rebaseline hack

**Files:**
- Modify: `packages/aica_transparent_hybrid_trigger_v1/algorithm.py` (`advance_accumulators` ~line 146; `evaluate`'s rebaseline block ~lines 696-751)
- Test: `app/api/tests/test_transparent_hybrid.py` (append; confirm the exact filename with `ls app/api/tests | grep -i hybrid`)

**Interfaces:**
- Consumes: `context["signals"]["dynamic"]["stimulusFrozen"]` (Task 3)
- Produces: no signature changes. `next_package_runtime_state` loses `mono_intervention_handled_sec`.

- [ ] **Step 1: Write the failing tests**

```python
def test_stimulus_frozen_stops_mono_min_advancing():
    from aica_transparent_hybrid_trigger_v1.algorithm import advance_accumulators

    dynamic = {"motionState": "MOVING", "segmentType": "highway", "isTrafficJam": False}
    prev = {"accumulators": {"jam_min": 0.0, "hw_min": 0.0, "mono_min": 10.0},
            "prev_sim_time_sec": 0.0}

    thawed = advance_accumulators(dict(dynamic, stimulusFrozen=False), prev, 60.0)
    frozen = advance_accumulators(dict(dynamic, stimulusFrozen=True), prev, 60.0)

    assert thawed["mono_min"] == pytest.approx(11.0)
    assert frozen["mono_min"] == pytest.approx(10.0)
    # highway minutes still accrue — content does not un-drive the highway
    assert frozen["hw_min"] == thawed["hw_min"] == pytest.approx(1.0)


def test_served_monotony_proposal_no_longer_rebaselines_mono_min():
    """The erase hack is gone: relief is the engine's freeze, not a baseline jump."""
    from aica_transparent_hybrid_trigger_v1.algorithm import evaluate

    ctx = _hybrid_context(mono_min=40.0, last_proposal_category="monotony_prevention",
                          last_proposal_result="acknowledge", last_proposal_time_sec=100.0)
    result = evaluate(ctx)
    state = result["next_package_runtime_state"]
    assert state["accum_baseline"].get("mono_min", 0.0) == 0.0
    assert "mono_intervention_handled_sec" not in state


def test_baseline_snaps_once_at_the_resume_edge():
    from aica_transparent_hybrid_trigger_v1.algorithm import evaluate

    during = evaluate(_hybrid_context(mono_min=40.0, recovery_active=True))
    resumed = evaluate(_hybrid_context(
        mono_min=40.0, recovery_active=False,
        prev_state=during["next_package_runtime_state"],
    ))
    assert resumed["next_package_runtime_state"]["accum_baseline"]["mono_min"] == pytest.approx(40.0)
```

Add a `_hybrid_context(**overrides)` helper to that test module building a full tiered context (`signals.fixed/dynamic/simulated`, `hyperparameters`, `proposal_history`, `simulation_time_sec`, `package_runtime_state`) — mirror whatever context builder the module already uses for its existing tests rather than inventing a new shape.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app/api && uv run pytest tests/test_transparent_hybrid.py -v -k "stimulus_frozen or rebaselines or resume_edge"`
Expected: FAIL — `mono_min` advances despite `stimulusFrozen`

- [ ] **Step 3: Freeze `mono_min` in `advance_accumulators`**

```python
    is_moving = dynamic.get("motionState") == "MOVING"
    is_traffic_jam = bool(dynamic.get("isTrafficJam", False))
    segment_type = dynamic.get("segmentType", "normal_road")
    is_highway = segment_type == "highway"
    is_monotonous = segment_type in _MONOTONOUS_SEGMENT_TYPES
    # Recovery-semantics refactor: the engine publishes `stimulusFrozen` when it
    # froze its OWN monotony accumulator this tick. Mirroring it exactly is what
    # makes Hybrid and NRI structurally identical here (design §7, P5) instead of
    # coincidentally similar.
    stimulus_frozen = bool(dynamic.get("stimulusFrozen", False))

    advance = tick_duration_min if is_moving else 0.0
    return {
        "jam_min": prev_jam_min + (advance if is_traffic_jam else 0.0),
        "hw_min": prev_hw_min + (advance if is_highway else 0.0),
        "mono_min": prev_mono_min + (
            advance if (is_monotonous and not stimulus_frozen) else 0.0
        ),
    }
```

Update the function docstring to state that `mono_min` does not advance while `stimulusFrozen`.

- [ ] **Step 4: Delete the rebaseline hack and snap at the resume edge**

Replace the whole `# ── 1d. rebaseline MONOTONY exposure on a served MONOTONY proposal ──` block (~lines 712-751) with:

```python
    # ── 1c/1d. exposure baseline ───────────────────────────────────────────
    # Recovery-semantics refactor. The served-monotony rebaseline is GONE:
    # relief on the monotony channel is the engine's freeze + drain, mirrored in
    # advance_accumulators above, not a baseline jump that erased hours of
    # exposure in one tick (CDC-SU slide 31 — 刺激がない状態の継続 is a
    # continuation, and stimulus interrupts it; it does not undo it).
    #
    # The rest baseline now snaps ONCE, at the resume edge, instead of being
    # re-pinned every tick of the recovery window — one event with one meaning,
    # matching NRI's single reset edge (design §6 case 4).
    was_in_recovery = bool(prev_state.get("was_in_recovery", False))
    recovery_just_completed = was_in_recovery and not recovery_active
    if recovery_just_completed:
        accum_baseline = {
            "jam_min": accumulators["jam_min"],
            "hw_min": accumulators["hw_min"],
            "mono_min": accumulators["mono_min"],
        }
    else:
        accum_baseline = prev_state.get("accum_baseline", {}) or {}
    accum_since = {
        "jam_min": max(0.0, accumulators["jam_min"] - float(accum_baseline.get("jam_min", 0.0))),
        "hw_min": max(0.0, accumulators["hw_min"] - float(accum_baseline.get("hw_min", 0.0))),
        "mono_min": max(0.0, accumulators["mono_min"] - float(accum_baseline.get("mono_min", 0.0))),
    }
```

Delete every remaining reference to `mono_intervention_sec`, `prev_handled_sec` and `mono_intervention_handled_sec` in this module, including the key in the returned `next_package_runtime_state`, and add `"was_in_recovery": recovery_active` to that returned state.

Similarly replace the `# ── 1b` time-on-task block so `drive_min_baseline` snaps at the same edge:

```python
    if recovery_just_completed:
        drive_min_baseline = continuous_driving_min
    else:
        drive_min_baseline = float(prev_state.get("drive_min_baseline", 0.0))
    drive_min_since_rest = max(0.0, continuous_driving_min - drive_min_baseline)
```

Note ordering: `recovery_just_completed` must be computed before both baseline blocks — move the `was_in_recovery` lines above section 1b.

- [ ] **Step 5: Update the module docstring**

Lines 17-19 describe the retired behaviour ("an accepted rest rebaselines all three, and a SERVED monotony proposal rebaselines `mono_min`"). Replace with a description of the freeze-mirroring plus the single resume-edge snap.

- [ ] **Step 6: Run the tests**

Run: `cd app/api && uv run pytest tests/test_transparent_hybrid.py -v`
Expected: PASS

- [ ] **Step 7: Run the full backend suite**

Run: `cd app/api && uv run pytest -q`
Expected: PASS. Some fire-pattern tests may now fire at different ticks — read each failure and confirm the new timing is the intended semantics before adjusting the assertion. Do **not** adjust an assertion you cannot explain.

- [ ] **Step 8: Commit**

```bash
git add packages/aica_transparent_hybrid_trigger_v1/algorithm.py app/api/tests/
git commit -m "refactor(hybrid): mirror the engine monotony freeze, drop the rebaseline hack"
```

---

## Task 6: NRI — mirror the freeze, narrow the recovery freeze to the dwell

**Files:**
- Modify: `packages/nri_fatigue_score_v1/algorithm.py` (relief block ~lines 452-505; accrual gate ~line 470)
- Test: `app/api/tests/test_nri_fatigue_score.py` (append)

**Interfaces:**
- Consumes: `context["signals"]["dynamic"]["stimulusFrozen"]`, `["motionState"]` (Task 3)
- Produces: no signature changes. `next_package_runtime_state` loses `mono_intervention_handled_sec`.

- [ ] **Step 1: Write the failing tests**

```python
def test_stimulus_frozen_stops_cumulative_monotonous_min_advancing():
    from nri_fatigue_score_v1.algorithm import evaluate

    frozen = evaluate(_nri_context(segment_type="highway", stimulus_frozen=True,
                                   cumulative_monotonous_min=20.0))
    thawed = evaluate(_nri_context(segment_type="highway", stimulus_frozen=False,
                                   cumulative_monotonous_min=20.0))
    fs = frozen["next_package_runtime_state"]
    ts = thawed["next_package_runtime_state"]
    assert fs["cumulative_monotonous_min"] == pytest.approx(20.0)
    assert ts["cumulative_monotonous_min"] > 20.0
    # highway exposure still accrues in both
    assert fs["cumulative_highway_min"] == pytest.approx(ts["cumulative_highway_min"])


def test_answered_monotony_proposal_no_longer_zeroes_the_accumulator():
    from nri_fatigue_score_v1.algorithm import evaluate

    result = evaluate(_nri_context(
        cumulative_monotonous_min=40.0,
        last_proposal_category="monotony_prevention",
        last_proposal_result="acknowledge",
    ))
    state = result["next_package_runtime_state"]
    assert state["cumulative_monotonous_min"] >= 40.0
    assert "mono_intervention_handled_sec" not in state


def test_exposure_keeps_accruing_while_driving_to_the_rest_spot():
    """Design §6 case 2 — only the STOPPED dwell freezes, not the approach."""
    from nri_fatigue_score_v1.algorithm import evaluate

    en_route = evaluate(_nri_context(
        recovery_phase="wakefulness", motion_state="MOVING",
        driving_min_since_rest=100.0,
    ))
    assert en_route["next_package_runtime_state"]["driving_min_since_rest"] > 100.0


def test_exposure_freezes_during_the_stopped_dwell():
    from nri_fatigue_score_v1.algorithm import evaluate

    dwelling = evaluate(_nri_context(
        recovery_phase="nap", motion_state="STOPPED",
        driving_min_since_rest=100.0,
    ))
    assert dwelling["next_package_runtime_state"]["driving_min_since_rest"] == pytest.approx(100.0)
```

Add an `_nri_context(**overrides)` helper to that module in the same style as the existing tests there.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app/api && uv run pytest tests/test_nri_fatigue_score.py -v -k "stimulus_frozen or no_longer_zeroes or driving_to_the_rest_spot or stopped_dwell"`
Expected: FAIL

- [ ] **Step 3: Narrow the accrual gate and mirror the freeze**

Replace the `accrue` gate with a motion-aware one, and gate the monotonous accumulator on `stimulusFrozen`:

```python
    # Recovery-semantics refactor. Two corrections to the accrual gate:
    #
    #   1. Only the STOPPED dwell freezes exposure. The MOVING approach to the
    #      rest spot used to freeze too, so the score sat flat while the driver
    #      was genuinely still driving and still accumulating risk (design §6
    #      case 2). The driver is driving until the wheels stop.
    #   2. `cumulative_monotonous_min` additionally stops while the engine
    #      reports `stimulusFrozen` — mirroring the engine exactly, which is what
    #      makes NRI and Hybrid structurally identical here (design §7, P5).
    is_moving = dynamic.get("motionState") == "MOVING"
    stimulus_frozen = bool(dynamic.get("stimulusFrozen", False))
    accrue = is_moving
    accrue_monotonous = accrue and not stimulus_frozen
```

Then apply `accrue_monotonous` to `cumulative_monotonous_min` only, leaving `cumulative_jam_min`, `cumulative_highway_min` and `driving_min_since_rest` on `accrue`.

- [ ] **Step 4: Delete the relief hack**

Remove the entire "Relieve monotony exposure when its OWN proposal is answered" block (~lines 452-505) together with `mono_intervention_sec`, `prev_handled_sec`, and `mono_intervention_handled_sec` — including the key in the returned `next_package_runtime_state`.

Keep `recovery_just_completed` and the four-accumulator reset at the resume edge exactly as they are: that is design §6 case 4 and it stays.

- [ ] **Step 5: Update the module docstring**

Lines 37-44 and 46-63 describe the deleted relief and the whole-window freeze. Rewrite both paragraphs to describe the freeze-mirroring and the dwell-only exposure freeze.

- [ ] **Step 6: Run the tests**

Run: `cd app/api && uv run pytest tests/test_nri_fatigue_score.py -v`
Expected: PASS

- [ ] **Step 7: Run the full backend suite**

Run: `cd app/api && uv run pytest -q`
Expected: PASS, with the same caution as Task 5 Step 7 about fire-timing assertions.

- [ ] **Step 8: Commit**

```bash
git add packages/nri_fatigue_score_v1/algorithm.py app/api/tests/
git commit -m "refactor(nri): mirror the engine monotony freeze, freeze exposure only during the dwell"
```

---

## Task 7: Fire-control §9.1 — bound the acknowledge suppression

**Files:**
- Modify: `app/api/aica_api/services/run_manager.py` (`_derive_response_suppression`, ~lines 336-392)
- Test: `app/api/tests/test_fire_control_window.py` (create)

**Interfaces:**
- Produces: `_derive_response_suppression` unchanged signature; the `monotony_indefinite` concept is gone.

- [ ] **Step 1: Write the failing test**

Create `app/api/tests/test_fire_control_window.py`:

```python
"""Fire-control conformance (recovery design §9). CDC-SU slides 34 and 81."""
import pytest

from aica_api.services.run_manager import _DECLINE_COOLDOWN_SEC, _derive_response_suppression
from tests.helpers_recovery import fired_tick_event, action_event   # add these helpers


def test_acknowledged_monotony_is_suppressed_only_for_the_window():
    events = [
        fired_tick_event(tick_index=1, category="monotony_prevention", elapsed_seconds=600.0),
        action_event(tick_index=1, action="acknowledge"),
    ]
    inside = _derive_response_suppression(events, current_sim_sec=700.0, tick_seconds=60.0)
    assert inside["monotony_prevention"] is True

    outside = _derive_response_suppression(
        events, current_sim_sec=600.0 + _DECLINE_COOLDOWN_SEC + 1.0, tick_seconds=60.0
    )
    assert outside["monotony_prevention"] is False


def test_a_rest_proposal_is_no_longer_needed_to_release_the_window():
    """Previously an acknowledge latched until any REST_PROPOSAL fired."""
    events = [
        fired_tick_event(tick_index=1, category="monotony_prevention", elapsed_seconds=0.0),
        action_event(tick_index=1, action="acknowledge"),
    ]
    released = _derive_response_suppression(
        events, current_sim_sec=_DECLINE_COOLDOWN_SEC + 1.0, tick_seconds=60.0
    )
    assert released["monotony_prevention"] is False
    assert released["rest_required"] is False


def test_declined_monotony_is_unchanged():
    events = [
        fired_tick_event(tick_index=1, category="monotony_prevention", elapsed_seconds=600.0),
        action_event(tick_index=1, action="decline"),
    ]
    assert _derive_response_suppression(
        events, current_sim_sec=700.0, tick_seconds=60.0
    )["monotony_prevention"] is True
```

Add the two builders to `app/api/tests/helpers_recovery.py`. `_derive_response_suppression`
only reads attributes off each event, so lightweight stand-ins are enough and keep these
tests independent of the full evidence models:

```python
import types


def fired_tick_event(*, tick_index: int, category: str, elapsed_seconds: float):
    """A TickEvent stand-in carrying a FIRED proposal of `category`.

    Shaped for `run_manager._derive_response_suppression`, which reads only
    `.kind`, `.tick_index`, `.trace.decision_result.{fire_control.fired,
    proposal, selected_category}` and `.tick_state.elapsed_seconds`.
    """
    return types.SimpleNamespace(
        kind="tick",
        tick_index=tick_index,
        tick_state=types.SimpleNamespace(elapsed_seconds=elapsed_seconds),
        trace=types.SimpleNamespace(
            decision_result=types.SimpleNamespace(
                fire_control=types.SimpleNamespace(fired=True),
                proposal=types.SimpleNamespace(id="p"),
                selected_category=category,
            )
        ),
    )


def action_event(*, tick_index: int, action: str):
    """An ActionEvent stand-in: the driver's answer to the proposal that fired
    at this SAME tick_index (run_manager.action always stamps it that way)."""
    return types.SimpleNamespace(kind="action", tick_index=tick_index, action=action)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/api && uv run pytest tests/test_fire_control_window.py -v`
Expected: FAIL on `test_acknowledged_monotony_is_suppressed_only_for_the_window` — the outside-window assertion returns True because the suppression is indefinite.

- [ ] **Step 3: Replace the indefinite branch with a window**

In `_derive_response_suppression`, delete the `monotony_indefinite` variable and both places that read it. The acknowledge branch becomes identical in shape to decline:

```python
        elif category == "monotony_prevention":
            if matched_action in ("acknowledge", "decline"):
                # CDC-SU slide 81: after the content ends or is refused,
                # 一定時間後に再度閾値チェック. An acknowledge used to suppress
                # this category with NO timer until a REST_PROPOSAL fired, which
                # slide 34 does not permit — it allows only 提案間隔 and
                # 単位時間あたり提案回数.
                monotony_suppressed = True
                monotony_release_sec = sec + _DECLINE_COOLDOWN_SEC
            elif matched_action is not None:
                monotony_suppressed = False
                monotony_release_sec = None
```

Delete the `if monotony_indefinite:` release block inside the `rest_required` branch, and simplify the final result computation:

```python
    result_monotony = False
    if monotony_suppressed and monotony_release_sec is not None:
        result_monotony = current_sim_sec < monotony_release_sec
```

Update the function docstring's rules list to match.

- [ ] **Step 4: Run the test**

Run: `cd app/api && uv run pytest tests/test_fire_control_window.py -v`
Expected: PASS

- [ ] **Step 5: Run the full backend suite**

Run: `cd app/api && uv run pytest -q`
Expected: PASS. Any test asserting a monotony proposal never re-fires after acknowledge is now wrong by design — update it to assert re-fire *after the window*.

- [ ] **Step 6: Commit**

```bash
git add app/api/aica_api/services/run_manager.py app/api/tests/
git commit -m "fix(fire-control): bound acknowledge suppression to the cooldown window (CDC-SU slide 81)"
```

---

## Task 8: Fire-control §9.2 — 単位時間あたり提案回数 cap

**Files:**
- Modify: `app/api/aica_api/services/run_manager.py` (`_derive_response_suppression`)
- Test: `app/api/tests/test_fire_control_window.py` (append)

**Interfaces:**
- Consumes: the §9.1 walk (Task 7)
- Produces: module constants `_PROPOSAL_COUNT_WINDOW_SEC: float`, `_MAX_PROPOSALS_PER_WINDOW: int`

- [ ] **Step 1: Write the failing test**

Append to `app/api/tests/test_fire_control_window.py`:

```python
def test_count_cap_suppresses_the_fire_past_the_limit_inside_the_window():
    from aica_api.services.run_manager import (
        _MAX_PROPOSALS_PER_WINDOW, _PROPOSAL_COUNT_WINDOW_SEC,
    )

    events = []
    # N actionable monotony fires, each answered, spaced past the cooldown so
    # only the COUNT cap can suppress the next one.
    for i in range(_MAX_PROPOSALS_PER_WINDOW):
        at = i * (_DECLINE_COOLDOWN_SEC + 60.0)
        events.append(fired_tick_event(tick_index=i, category="monotony_prevention",
                                       elapsed_seconds=at))
        events.append(action_event(tick_index=i, action="acknowledge"))
    last_at = (_MAX_PROPOSALS_PER_WINDOW - 1) * (_DECLINE_COOLDOWN_SEC + 60.0)
    just_after = last_at + _DECLINE_COOLDOWN_SEC + 1.0

    capped = _derive_response_suppression(events, current_sim_sec=just_after, tick_seconds=60.0)
    assert capped["monotony_prevention"] is True, "count cap must suppress"

    rolled = _derive_response_suppression(
        events, current_sim_sec=just_after + _PROPOSAL_COUNT_WINDOW_SEC, tick_seconds=60.0
    )
    assert rolled["monotony_prevention"] is False, "cap releases as the window rolls"


def test_suppressed_fires_are_not_counted_towards_the_cap():
    """Only fires the driver actually saw count — otherwise a suppressed burst
    would silently consume the whole allowance."""
    events = [
        fired_tick_event(tick_index=1, category="monotony_prevention", elapsed_seconds=0.0),
        action_event(tick_index=1, action="acknowledge"),
    ]
    # Unanswered fires inside the suppression window were never shown.
    for i in range(2, 40):
        events.append(fired_tick_event(tick_index=i, category="monotony_prevention",
                                       elapsed_seconds=float(i * 10)))
    released = _derive_response_suppression(
        events, current_sim_sec=_DECLINE_COOLDOWN_SEC + 1.0, tick_seconds=60.0
    )
    assert released["monotony_prevention"] is False


def test_the_cap_is_per_category():
    events = []
    for i in range(_MAX_PROPOSALS_PER_WINDOW):
        at = i * (_DECLINE_COOLDOWN_SEC + 60.0)
        events.append(fired_tick_event(tick_index=i, category="monotony_prevention",
                                       elapsed_seconds=at))
        events.append(action_event(tick_index=i, action="acknowledge"))
    last_at = (_MAX_PROPOSALS_PER_WINDOW - 1) * (_DECLINE_COOLDOWN_SEC + 60.0)
    result = _derive_response_suppression(
        events, current_sim_sec=last_at + _DECLINE_COOLDOWN_SEC + 1.0, tick_seconds=60.0
    )
    assert result["rest_required"] is False, "a monotony burst must not gag rest"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app/api && uv run pytest tests/test_fire_control_window.py -v -k "count_cap or not_counted or per_category"`
Expected: FAIL with `ImportError: cannot import name '_MAX_PROPOSALS_PER_WINDOW'`

- [ ] **Step 3: Add the constants**

Next to `_DECLINE_COOLDOWN_SEC`:

```python
# CDC-SU slide 34's second control: 単位時間あたり提案回数 — a cap on how many
# proposals of one category may actually be SHOWN inside a rolling window.
# Like _DECLINE_COOLDOWN_SEC this is harness fire-control policy, NOT an
# algorithm tuning knob, so it is a module constant rather than a manifest
# hyperparameter.
#
# The Hybrid already caps itself in-algorithm via proposalCountLast30Min; this
# is an OUTER cap and must stay no tighter than that one, or it would silently
# change Hybrid's fire pattern instead of only giving NRI — which has no
# in-algorithm fire control at all — a floor. Verified by
# tests/test_recovery_parity.py::test_count_cap_never_bites_on_hybrid.
_PROPOSAL_COUNT_WINDOW_SEC = 1800.0
_MAX_PROPOSALS_PER_WINDOW = 3
```

- [ ] **Step 4: Count actionable fires during the existing walk**

`_derive_response_suppression` already walks `pairs` chronologically. Track, per category, the sim-times of fires that were **not** suppressed at the time — reusing the suppression state the loop is already maintaining. Immediately before the loop:

```python
    shown_times: dict[str, list[float]] = {"rest_required": [], "monotony_prevention": []}
```

At the top of each loop iteration, before the branch that updates suppression state for this pair:

```python
        # Was this fire suppressed by the state accumulated from EARLIER pairs?
        # Only fires that got through were shown to the driver, so only those
        # consume the 単位時間あたり提案回数 allowance.
        if category == "monotony_prevention":
            was_suppressed = monotony_suppressed and (
                monotony_release_sec is not None and sec < monotony_release_sec
            )
        else:
            was_suppressed = rest_suppressed and (
                rest_release_sec is not None and sec < rest_release_sec
            )
        if not was_suppressed and category in shown_times:
            shown_times[category].append(sec)
```

Then fold the cap into the final results:

```python
    def _count_capped(category: str) -> bool:
        window_start = current_sim_sec - _PROPOSAL_COUNT_WINDOW_SEC
        recent = [t for t in shown_times[category] if t > window_start]
        return len(recent) >= _MAX_PROPOSALS_PER_WINDOW

    result_rest = result_rest or _count_capped("rest_required")
    result_monotony = result_monotony or _count_capped("monotony_prevention")

    return {"rest_required": result_rest, "monotony_prevention": result_monotony}
```

Extend the function docstring with the count-cap rule.

- [ ] **Step 5: Run the tests**

Run: `cd app/api && uv run pytest tests/test_fire_control_window.py -v`
Expected: PASS

- [ ] **Step 6: Run the full backend suite**

Run: `cd app/api && uv run pytest -q`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add app/api/aica_api/services/run_manager.py app/api/tests/
git commit -m "feat(fire-control): add the per-category proposal count cap (CDC-SU slide 34)"
```

---

## Task 9: Merged router — derive `contentActive`, end episodes, move pre-rest teardown

**Files:**
- Modify: `app/api/aica_api/routers/merged_runs.py` (`tick_merged_run_endpoint`, ~lines 934-1216)
- Test: `app/api/tests/test_merged_rest_journey.py` and `app/api/tests/test_merged_monotony_journey.py` (append)

**Interfaces:**
- Consumes: `run_manager.tick(run_id, *, content_context=...)` (Task 4); `ContentContext` (Task 1)
- Produces: no new public endpoint. Internal helper `_derive_content_context(handle, plog) -> ContentContext | None`.

- [ ] **Step 1: Write the failing tests**

Append to `app/api/tests/test_merged_monotony_journey.py`:

```python
def test_playing_monotony_content_reaches_the_trigger_as_a_content_episode(client):
    merged_run_id = _run_until_monotony_fire(client)
    _choose_service(client, merged_run_id, "quiz")      # playback_state -> active
    resp = client.post(f"/api/merged-runs/{merged_run_id}/tick")
    dynamic = resp.json()["trigger"]["tick_state"]["signals"]["dynamic"]
    assert dynamic["contentActive"] is True
    assert dynamic["stimulusFrozen"] is True


def test_an_episode_ends_once_expected_duration_has_elapsed(client):
    merged_run_id = _run_until_monotony_fire(client)
    _choose_service(client, merged_run_id, "quiz")
    # tick past expected_duration_sec
    for _ in range(30):
        resp = client.post(f"/api/merged-runs/{merged_run_id}/tick")
    dynamic = resp.json()["trigger"]["tick_state"]["signals"]["dynamic"]
    assert dynamic["contentActive"] is False
```

Append to `app/api/tests/test_merged_rest_journey.py`:

```python
def test_pre_rest_content_is_torn_down_at_arrival_not_after_the_nap(client):
    """CDC-SU slide 46 ⑤ 選択コンテンツを開始し、休憩所に到着したら終了."""
    merged_run_id = _run_until_rest_fire(client)
    _choose_service(client, merged_run_id, "humming_karaoke")
    _accept_rest(client, merged_run_id)
    plog = _tick_until_event(client, merged_run_id, "REST_SPOT_ARRIVED")
    assert plog["journey_state"]["playback_state"] in ("completed", "stopped")


def test_exposure_keeps_accruing_while_driving_to_the_rest_spot(client):
    merged_run_id = _run_until_rest_fire(client)
    _accept_rest(client, merged_run_id)
    first = client.post(f"/api/merged-runs/{merged_run_id}/tick").json()
    second = client.post(f"/api/merged-runs/{merged_run_id}/tick").json()
    a = first["trigger"]["tick_state"]["signals"]["dynamic"]["continuousDrivingMin"]
    b = second["trigger"]["tick_state"]["signals"]["dynamic"]["continuousDrivingMin"]
    assert b > a
```

Reuse the `_run_until_*` / `_choose_service` / `_accept_rest` helpers already present in those modules; add only what is genuinely missing.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app/api && uv run pytest tests/test_merged_monotony_journey.py tests/test_merged_rest_journey.py -v -k "content_episode or expected_duration or torn_down or keeps_accruing"`
Expected: FAIL — `contentActive` is False because the router never supplies a `ContentContext`.

- [ ] **Step 3: Add the derivation helper**

In `app/api/aica_api/routers/merged_runs.py`, add above `tick_merged_run_endpoint`:

```python
_PURPOSE_BY_CATEGORY = {
    "monotony_prevention": "monotony",
    "rest_required": "pre_rest",
}


def _derive_content_context(handle, plog) -> ContentContext | None:
    """The content episode playing on the merged run's current proposal, if any.

    Recovery design §4. `contentActive` is true exactly while the proposal's
    plan is `active` or `backgrounded`; the purpose comes from the opportunity
    the content answers, and flips to `post_rest` once the journey has passed
    the rest (lifecycle_stage `after_rest_before_restart`).

    Returns None when nothing is playing, or when the episode has outlived its
    plan's `expected_duration_sec` (CDC-SU slide 81 一定曲数再生完了 / 1セット完了).
    """
    if plog is None:
        return None
    js = plog.journey_state
    if js.playback_state not in (PlaybackState.active, PlaybackState.backgrounded):
        return None
    if js.active_service_id is None:
        return None

    if js.lifecycle_stage == LifecycleStage.after_rest_before_restart:
        purpose = "post_rest"
    else:
        purpose = _PURPOSE_BY_CATEGORY.get(handle.current_proposal_category or "", "monotony")

    return ContentContext(service_id=js.active_service_id.value, purpose=purpose)
```

- [ ] **Step 4: Add the episode-duration field to the handle**

In `app/api/aica_api/models/merged_run.py`, add to `MergedRunHandle`:

```python
    # Recovery-semantics refactor: simulated-clock timestamp (the trigger tick's
    # `elapsed_seconds`) at which the CURRENT content episode began, or None when
    # nothing is playing. Used to end the episode after the plan's own
    # `expected_duration_sec` (CDC-SU slide 81 一定曲数再生完了 / 1セット完了).
    # Never a wall clock — the tick engine's clock is the only clock.
    content_started_elapsed_sec: float | None = None
```

- [ ] **Step 5: Supply the context to the tick, and end expired episodes**

Add the duration helper next to `_derive_content_context`:

```python
def _committed_plan_duration_sec(plog) -> int | None:
    """The playing plan's own `expected_duration_sec`, or None.

    Reads exactly what `select_service` committed as CONTENT-step evidence —
    never fabricated, and never a constant of our own invention.
    """
    for evidence in reversed(plog.evidence):
        if evidence.step == "content" and evidence.error is None:
            value = (evidence.output or {}).get("expected_duration_sec")
            return int(value) if value is not None else None
    return None
```

At the top of `tick_merged_run_endpoint`, replace:

```python
    try:
        outcome = run_manager.tick(handle.trigger_run_id)
```

with:

```python
    current_plog = None
    if handle.current_proposal_run_id is not None:
        try:
            current_plog = get_proposal_run(handle.current_proposal_run_id)
        except HTTPException:
            current_plog = None
    content_ctx = _derive_content_context(handle, current_plog)

    try:
        outcome = run_manager.tick(
            handle.trigger_run_id,
            content_context=content_ctx,
        )
```

Then, immediately after the `RunNotFoundError` handler for that call and before
`trigger_dict = _serialize_trigger_tick(outcome)`, stamp and expire the episode:

```python
    # ── Content-episode lifetime (CDC-SU slide 81) ───────────────────────────
    # An episode has a finite natural length. Without this it would never end
    # and driving-content relief would run for the whole rest of the run.
    now_sec = float(outcome.tick_state.elapsed_seconds) if outcome.tick_state else 0.0
    if content_ctx is None:
        handle.content_started_elapsed_sec = None
    else:
        if handle.content_started_elapsed_sec is None:
            handle.content_started_elapsed_sec = now_sec
        duration_sec = _committed_plan_duration_sec(current_plog)
        if (
            duration_sec is not None
            and now_sec - handle.content_started_elapsed_sec >= duration_sec
        ):
            try:
                apply_journey_action(
                    handle.current_proposal_run_id,
                    JourneyAction(action_type="complete"),
                )
                handle.content_started_elapsed_sec = None
            except HTTPException as exc:
                resp.trigger["proposal_error"] = _readable_error_text(exc.detail)
    save_handle(handle, settings.merged_runs_dir)
```

Move the `resp = MergedTickResponse(trigger=trigger_dict)` construction above this block so
`resp.trigger` is available for the error path.

The episode therefore ends on the first tick at or past its duration, and
`_derive_content_context` returns None from the next tick onward because
`playback_state` is now `completed`.

- [ ] **Step 6: Move the pre-rest teardown to arrival**

In the `rest_stage_synced == "before"` branch, after `rest_started` succeeds and before setting `handle.rest_stage_synced = "during"`, add:

```python
                # CDC-SU slide 46 ⑤: 選択コンテンツを開始し、休憩所に到着したら終了.
                # The en-route 覚醒支援 episode ends AT ARRIVAL. This used to
                # happen in the `during` branch, after the nap, so the pre-rest
                # content kept "playing" through the whole dwell.
                if journey_plog.journey_state.playback_state == PlaybackState.active:
                    journey_plog = apply_journey_action(
                        run_id, JourneyAction(action_type="complete")
                    )
                if journey_plog.journey_state.playback_state in (
                    PlaybackState.active, PlaybackState.backgrounded,
                ):
                    journey_plog = apply_journey_action(
                        run_id, JourneyAction(action_type="stop")
                    )
```

Leave the identical block in the `during` branch in place — it is now a no-op on the happy path but still guarantees `recompute` is never blocked by FR-006a on a retry.

- [ ] **Step 7: Run the tests**

Run: `cd app/api && uv run pytest tests/test_merged_rest_journey.py tests/test_merged_monotony_journey.py tests/test_merged_runs_router.py -v`
Expected: PASS

- [ ] **Step 8: Run both suites**

Run: `cd app/api && uv run pytest -q && cd ../frontend && npm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add app/api/aica_api/routers/merged_runs.py app/api/aica_api/models/merged_run.py app/api/tests/
git commit -m "feat(merged): derive content episodes from playback_state and end pre-rest content at arrival"
```

---

## Task 10: Scenario data — author the `<service>@<purpose>` matrix

**Files:**
- Modify: `scenarios/uc01_fatigue_recovery_v0_1.json`, `scenarios/uc01_fatigue_recovery_commuter_v0_1.json`, `scenarios/uc01_fatigue_recovery_oshikatsu_v0_1.json`, `scenarios/uc02_monotony_v0_1.json`, `scenarios/uc03_01_monotony_daytime_jam.json`, `scenarios/uc04_night_longhaul_v0_1.json`
- Test: `app/api/tests/test_recovery_matrix_coverage.py` (create)

**Interfaces:**
- Consumes: `ActivityRecovery` stimulus fields (Task 1); `ContentContext.recovery_key` (Task 1)
- Produces: `recovery_model` entries for every reachable `(service, purpose)` pair

- [ ] **Step 1: Write the failing test**

Create `app/api/tests/test_recovery_matrix_coverage.py`:

```python
"""Every REACHABLE (service, purpose) pair must have a recovery_model entry.

Recovery design §5. The matrix is deliberately sparse — 停車中コンテンツ at the
rest spot gets no driving-content relief at all (slide 38: ご褒美, not a
countermeasure) — so this test derives reachability from the eligibility
capabilities rather than asserting a full product.
"""
import json
import pathlib

import pytest

from aica_api.config import settings
from aica_api.models.proposal.service_capabilities import ServiceCapabilities

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
SCENARIOS = sorted((_REPO_ROOT / "scenarios").glob("*.json"))

_CAPABILITIES_PATH = (
    settings.proposal_contracts_dir / "service_capabilities" / "service_capabilities.v1.json"
)
_PURPOSES = ("monotony", "pre_rest", "post_rest")


def _reachable_pairs() -> set[tuple[str, str]]:
    """Services that can be playing while the car is MOVING, x every purpose.

    Driving-content relief is MOVING-only (design §4), so a service that can
    never play while moving needs no entry at all. `driving_capable` covers
    audio content; `background_on_motion` covers screen content that keeps
    playing in the background once the car starts (CDC-SU slide 81
    走行開始時の挙動).

    Deliberately a SUPERSET of what the response matrix actually offers per
    lifecycle stage — authoring a few unused entries is cheap, and it
    guarantees no reachable pair can be silently missing.
    """
    caps = ServiceCapabilities.load(_CAPABILITIES_PATH)
    return {
        (service_id.value, purpose)
        for service_id, cap in caps.services.items()
        if cap.driving_capable or cap.background_on_motion
        for purpose in _PURPOSES
    }


@pytest.mark.parametrize("path", SCENARIOS, ids=lambda p: p.name)
def test_every_reachable_pair_has_a_recovery_entry(path):
    scenario = json.loads(path.read_text(encoding="utf-8"))
    recovery_model = (scenario.get("driver_signal_params") or {}).get("recovery_model", {})
    missing = [
        f"{service}@{purpose}"
        for service, purpose in sorted(_reachable_pairs())
        if f"{service}@{purpose}" not in recovery_model
    ]
    assert not missing, f"{path.name} is missing recovery entries: {missing}"


@pytest.mark.parametrize("path", SCENARIOS, ids=lambda p: p.name)
def test_monotony_entries_do_not_claim_meaningful_drowsiness_recovery(path):
    """Design §6 case 1 — the @monotony effect is growth SUPPRESSION, not
    subtraction. UC-1's driver is not sleepy; content must not claim to fix
    sleep debt on that channel."""
    scenario = json.loads(path.read_text(encoding="utf-8"))
    recovery_model = (scenario.get("driver_signal_params") or {}).get("recovery_model", {})
    for key, entry in recovery_model.items():
        if key.endswith("@monotony"):
            assert entry.get("drowsiness_per_min", 0.0) <= 0.1, key


@pytest.mark.parametrize("path", SCENARIOS, ids=lambda p: p.name)
def test_pre_rest_entries_are_capped_so_content_cannot_replace_a_rest(path):
    scenario = json.loads(path.read_text(encoding="utf-8"))
    recovery_model = (scenario.get("driver_signal_params") or {}).get("recovery_model", {})
    for key, entry in recovery_model.items():
        if key.endswith("@pre_rest") and entry.get("drowsiness_per_min", 0.0) > 0.0:
            assert entry.get("cap_drowsiness") is not None, key
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/api && uv run pytest tests/test_recovery_matrix_coverage.py -v`
Expected: FAIL listing every missing `<service>@<purpose>` key

- [ ] **Step 3: Author the entries**

Eight services satisfy `driving_capable or background_on_motion` in
`proposal_contracts/service_capabilities/service_capabilities.v1.json`:
`music_playlist`, `humming_karaoke`, `call_response_driving`, `quiz`, `ranking_creation`,
`radio_style`, `conversation_audio`, `live_viewing`. Times three purposes, that is
**24 entries per scenario**.

In each scenario's `driver_signal_params.recovery_model`, keep the existing `sleep` /
`audio_karaoke` / `stretch` rest-activity entries untouched and add:

```jsonc
"music_playlist@monotony":         { "stimulus_relief_per_min": 0.8, "cap_stimulus": 20.0 },
"humming_karaoke@monotony":        { "stimulus_relief_per_min": 1.2, "cap_stimulus": 20.0 },
"call_response_driving@monotony":  { "stimulus_relief_per_min": 1.5, "cap_stimulus": 20.0 },
"quiz@monotony":                   { "stimulus_relief_per_min": 2.0, "cap_stimulus": 20.0 },
"ranking_creation@monotony":       { "stimulus_relief_per_min": 2.0, "cap_stimulus": 20.0 },
"radio_style@monotony":            { "stimulus_relief_per_min": 1.5, "cap_stimulus": 20.0 },
"conversation_audio@monotony":     { "stimulus_relief_per_min": 1.8, "cap_stimulus": 20.0 },
"live_viewing@monotony":           { "stimulus_relief_per_min": 0.6, "cap_stimulus": 20.0 },

"music_playlist@pre_rest":         { "drowsiness_per_min": 0.15, "fatigue_per_min": 0.05,
                                     "cap_drowsiness": 5.0,  "cap_fatigue": 3.0,
                                     "stimulus_relief_per_min": 0.8, "cap_stimulus": 20.0 },
"humming_karaoke@pre_rest":        { "drowsiness_per_min": 0.4,  "fatigue_per_min": 0.2,
                                     "cap_drowsiness": 12.0, "cap_fatigue": 8.0,
                                     "stimulus_relief_per_min": 1.2, "cap_stimulus": 20.0 },
"call_response_driving@pre_rest":  { "drowsiness_per_min": 0.35, "fatigue_per_min": 0.15,
                                     "cap_drowsiness": 10.0, "cap_fatigue": 6.0,
                                     "stimulus_relief_per_min": 1.5, "cap_stimulus": 20.0 },
"quiz@pre_rest":                   { "drowsiness_per_min": 0.3,  "fatigue_per_min": 0.1,
                                     "cap_drowsiness": 8.0,  "cap_fatigue": 4.0,
                                     "stimulus_relief_per_min": 2.0, "cap_stimulus": 20.0 },
"ranking_creation@pre_rest":       { "drowsiness_per_min": 0.25, "fatigue_per_min": 0.1,
                                     "cap_drowsiness": 8.0,  "cap_fatigue": 4.0,
                                     "stimulus_relief_per_min": 2.0, "cap_stimulus": 20.0 },
"radio_style@pre_rest":            { "drowsiness_per_min": 0.3,  "fatigue_per_min": 0.1,
                                     "cap_drowsiness": 8.0,  "cap_fatigue": 4.0,
                                     "stimulus_relief_per_min": 1.5, "cap_stimulus": 20.0 },
"conversation_audio@pre_rest":     { "drowsiness_per_min": 0.35, "fatigue_per_min": 0.1,
                                     "cap_drowsiness": 10.0, "cap_fatigue": 4.0,
                                     "stimulus_relief_per_min": 1.8, "cap_stimulus": 20.0 },
"live_viewing@pre_rest":           { "drowsiness_per_min": 0.1,  "fatigue_per_min": 0.05,
                                     "cap_drowsiness": 3.0,  "cap_fatigue": 2.0,
                                     "stimulus_relief_per_min": 0.6, "cap_stimulus": 20.0 },

// 休憩後 — ご褒美, not a countermeasure (slide 38), so near-inert across the board.
"music_playlist@post_rest":        { "drowsiness_per_min": 0.05, "cap_drowsiness": 2.0,
                                     "stimulus_relief_per_min": 0.5, "cap_stimulus": 10.0 },
"humming_karaoke@post_rest":       { "drowsiness_per_min": 0.05, "cap_drowsiness": 2.0,
                                     "stimulus_relief_per_min": 0.5, "cap_stimulus": 10.0 },
"call_response_driving@post_rest": { "drowsiness_per_min": 0.05, "cap_drowsiness": 2.0,
                                     "stimulus_relief_per_min": 0.5, "cap_stimulus": 10.0 },
"quiz@post_rest":                  { "drowsiness_per_min": 0.05, "cap_drowsiness": 2.0,
                                     "stimulus_relief_per_min": 0.5, "cap_stimulus": 10.0 },
"ranking_creation@post_rest":      { "drowsiness_per_min": 0.05, "cap_drowsiness": 2.0,
                                     "stimulus_relief_per_min": 0.5, "cap_stimulus": 10.0 },
"radio_style@post_rest":           { "drowsiness_per_min": 0.05, "cap_drowsiness": 2.0,
                                     "stimulus_relief_per_min": 0.5, "cap_stimulus": 10.0 },
"conversation_audio@post_rest":    { "drowsiness_per_min": 0.05, "cap_drowsiness": 2.0,
                                     "stimulus_relief_per_min": 0.5, "cap_stimulus": 10.0 },
"live_viewing@post_rest":          { "drowsiness_per_min": 0.05, "cap_drowsiness": 2.0,
                                     "stimulus_relief_per_min": 0.5, "cap_stimulus": 10.0 }
```

**Note on sign:** `ActivityRecovery`'s validator requires all rates `>= 0` — these are
recovery *amounts* that get **subtracted**. Write them positive. The design doc shows them
negative because it describes the effect on the signal; the data carries magnitudes.

Add the §11 fallback defaults to each scenario whose `allowed_actions` includes
`acknowledge` (all six do):

```jsonc
"default_content_episode_min": 15.0,
"default_content_service_id": "quiz"
```

- [ ] **Step 4: Run the coverage test**

Run: `cd app/api && uv run pytest tests/test_recovery_matrix_coverage.py -v`
Expected: PASS

- [ ] **Step 5: Run the full backend suite**

Run: `cd app/api && uv run pytest -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scenarios/ app/api/tests/test_recovery_matrix_coverage.py
git commit -m "feat(scenarios): author the <service>@<purpose> recovery matrix and fallback defaults"
```

---

## Task 11: Parity, floor behaviour, and the retune pass

The task that proves the whole point of the refactor.

**Files:**
- Test: `app/api/tests/test_recovery_parity.py` (create)
- Modify: `scenarios/*.json` (retune only, if the presets demand it)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the failing tests**

Create `app/api/tests/test_recovery_parity.py`:

```python
"""P5 — both algorithms must react IDENTICALLY to the same driver event.

Any remaining divergence in the curves must come from the algorithms' own
scoring math, never from two different recovery implementations.
"""
import pytest

from aica_api.services import run_manager
from tests.helpers_recovery import run_identical_stream


def test_both_packages_freeze_monotony_on_exactly_the_same_ticks():
    hybrid = run_identical_stream("aica_transparent_hybrid_trigger_v1")
    nri = run_identical_stream("nri_fatigue_score_v1")

    hybrid_frozen = [
        t.signals["dynamic"]["stimulusFrozen"] for t in hybrid.tick_states
    ]
    nri_frozen = [t.signals["dynamic"]["stimulusFrozen"] for t in nri.tick_states]
    assert hybrid_frozen == nri_frozen

    # and each package's own accumulator is flat on exactly those ticks
    hybrid_mono = [s["accumulators"]["mono_min"] for s in hybrid.runtime_states]
    nri_mono = [s["cumulative_monotonous_min"] for s in nri.runtime_states]
    for i, frozen in enumerate(hybrid_frozen[1:], start=1):
        if frozen:
            assert hybrid_mono[i] <= hybrid_mono[i - 1]
            assert nri_mono[i] <= nri_mono[i - 1]


def test_monotony_relief_never_erases_accumulated_exposure():
    """Design P3 — freeze, don't erase. The old hacks dropped hours to zero."""
    result = run_identical_stream(
        "aica_transparent_hybrid_trigger_v1", accept_monotony_at_tick=10
    )
    mono = [s["accumulators"]["mono_min"] for s in result.runtime_states]
    assert min(mono[10:]) > 0.0, "relief must not zero the accumulator"


def test_hybrid_monotony_score_plateaus_at_a_floor_not_zero():
    """Design §7 — night and familiarity are FACTS and do not freeze, so the
    frozen score settles on w_night + w_familiar + w_env_mono*env_load."""
    result = run_identical_stream(
        "aica_transparent_hybrid_trigger_v1",
        is_night=True, familiar_route=True, accept_monotony_at_tick=10,
    )
    scores = [s["smoothed_scores"]["monotony_prevention_score"] for s in result.runtime_states]
    assert min(scores[12:]) > 0.0


def test_count_cap_never_bites_on_hybrid():
    """§9.2 calibration constraint — the harness cap is an OUTER cap on top of
    Hybrid's own `proposalCountLast30Min`. If it ever suppresses a Hybrid fire
    it is tighter than Hybrid's own cap, and is silently changing that
    package's behaviour instead of only giving NRI a floor.

    Asserted directly rather than by a loose bound: walk the stream's fires in
    order and check the COUNT rule's own condition never became true.
    """
    from aica_api.services.run_manager import (
        _MAX_PROPOSALS_PER_WINDOW, _PROPOSAL_COUNT_WINDOW_SEC,
    )

    result = run_identical_stream("aica_transparent_hybrid_trigger_v1")
    shown: dict[str, list[float]] = {"rest_required": [], "monotony_prevention": []}
    for tick_state, decision in zip(result.tick_states, result.decisions):
        if not (decision and decision.fire_control.fired and decision.selected_category):
            continue
        category = decision.selected_category
        now = float(tick_state.elapsed_seconds)
        recent = [t for t in shown[category] if t > now - _PROPOSAL_COUNT_WINDOW_SEC]
        assert len(recent) < _MAX_PROPOSALS_PER_WINDOW, (
            f"{category}: the harness count cap would have suppressed a Hybrid "
            f"fire at t={now}s — it is tighter than Hybrid's own cap"
        )
        shown[category].append(now)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app/api && uv run pytest tests/test_recovery_parity.py -v`
Expected: FAIL with `ImportError: cannot import name 'run_identical_stream'`

- [ ] **Step 3: Implement the helper**

Add to `app/api/tests/helpers_recovery.py`:

```python
import dataclasses


@dataclasses.dataclass
class StreamResult:
    """Everything one package produced over a fixed tick stream."""

    tick_states: list
    runtime_states: list
    decisions: list


_PACKAGE_PATHS = {
    "nri_fatigue_score_v1": _REPO_ROOT / "packages" / "nri_fatigue_score_v1" / "package.json",
    "aica_transparent_hybrid_trigger_v1": (
        _REPO_ROOT / "packages" / "aica_transparent_hybrid_trigger_v1" / "package.json"
    ),
}


def run_identical_stream(
    package_id: str,
    *,
    ticks: int = 60,
    accept_monotony_at_tick: int | None = None,
    is_night: bool = False,
    familiar_route: bool = False,
) -> StreamResult:
    """Run ONE fixed scenario against `package_id` and capture every tick.

    Both packages receive the same scenario, the same run seed and the same tick
    count, so any divergence in the captured series is attributable to the
    algorithms themselves — which is exactly what the parity tests assert.

    NOTE the two packages declare different `tick_seconds` in their manifests
    (60 vs 30), so compare SERIES SHAPE and freeze-tick alignment, never
    absolute minute values, across packages.

    The caller's autouse fixture must clear both the run_manager and run_plan
    registries between tests.
    """
    from aica_api.services.run_manager import ActionNotAllowedError, action, create_run, tick
    from aica_api.services.run_plan import create_draft

    scenario = m2_scenario_with_recovery(
        total_km=300.0,
        initial_drowsiness="weak",
        extra_recovery_entries={
            "quiz@monotony": {"stimulus_relief_per_min": 2.0, "cap_stimulus": 20.0},
        },
        default_content_episode_min=15.0,
        default_content_service_id="quiz",
    )
    scenario = scenario.model_copy(
        update={"is_night": is_night, "familiar_route": familiar_route}
    )
    package = PackageManifest(
        **json.loads(_PACKAGE_PATHS[package_id].read_text(encoding="utf-8"))
    )
    plan_id = create_draft(package=package, scenario=scenario)
    run_id = f"parity_{package_id}"
    with tempfile.TemporaryDirectory() as runs_dir:
        create_run(plan_id, run_id, pathlib.Path(runs_dir))

    tick_states, runtime_states, decisions = [], [], []
    for index in range(ticks):
        outcome = tick(run_id)
        if outcome.tick_state is None:
            break                      # run completed early
        tick_states.append(outcome.tick_state)
        runtime_states.append(dict(outcome.run_state.package_runtime_state))
        decisions.append(outcome.decision)
        if accept_monotony_at_tick is not None and index == accept_monotony_at_tick:
            try:
                action(run_id, "acknowledge")
            except ActionNotAllowedError:
                pass                   # not paused on a proposal at this tick
    return StreamResult(tick_states, runtime_states, decisions)
```

Match `create_draft`'s real signature by copying the call exactly as `create_paused_rest_run`
makes it in the same file, including any hyperparameter pins it applies.

If a parity assertion then fails, that is a **real defect in Tasks 5/6** — fix the algorithm
so it mirrors the engine. Never relax the assertion.

- [ ] **Step 4: Run the tests**

Run: `cd app/api && uv run pytest tests/test_recovery_parity.py -v`
Expected: PASS

- [ ] **Step 5: Run the preset and combined regression suites**

Run: `cd app/api && uv run pytest tests/test_combined_case_contract.py tests/test_combined_case_integration.py tests/proposal/ -v`
Expected: failures are likely and expected — the recovery model changed, so the 32 presets and C-01…C-06 will land on different numbers.

- [ ] **Step 6: Retune**

For each failing preset, decide **which** side is wrong:

- Curve shape is right, threshold crossing moved → retune the scenario's `stimulus_relief_per_min` / `cap_*` values, not the assertion.
- Curve shape is wrong (erases instead of freezing; drops on the wrong tick; freezes en route) → an implementation defect from Tasks 3-6. Fix the code.

Never relax an assertion you cannot explain in one sentence.

- [ ] **Step 7: Run everything**

Run: `cd app/api && uv run pytest -q && cd ../frontend && npm test && npm run build`
Expected: PASS across all three.

- [ ] **Step 8: Commit**

```bash
git add app/api/tests/ scenarios/
git commit -m "test(recovery): parity, floor and no-erase guarantees; retune presets"
```

---

## Follow-ups (not in this plan)

1. **`htmlapp/` port** — after owner review of the `app/` change.
2. **Slide 34's override** — 「しきい値の大幅超過、または見込まれる増加速度が早い場合は制御しない」. Hybrid has it in-algorithm; NRI has none.
3. **Post-rest ordering** (slide 46 ⑥⑦⑧⑨ — choose post-rest content *before* the nap).
4. **Customer-facing vocabulary** (覚醒 / リフレッシュ / 漫然運転予防) in the trace and Combined screen.
