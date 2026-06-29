# UC-01 Rest & Recovery + Scenario Beat Timeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `accept_rest` enter a staged, recoverable rest sequence (wakefulness → rest spot → nap → karaoke → resume) that actually lowers drowsiness/fatigue and resumes the run, with a per-scenario recovery menu, Places-hybrid rest-spot selection frozen for deterministic replay, recovery visuals, and a redesigned Scenario Beat Timeline.

**Architecture:** Approach A — the driver's choice (recovery option + rest spot) is frozen into a `recovery` block on `RunState` at selection time; the existing deterministic `advance_tick` loop drives the recovery **phases** (no second engine). The post-rest drive continues through the normal trigger algorithm. The frontend reads authoritative `route_fraction` / `motion_state` / `recovery_phase` from the tick response; the beat timeline is a pure projection over the trace + recovery phases.

**Tech Stack:** Backend = Python 3 / FastAPI / Pydantic (`app/api`, tests with pytest via `uv run pytest`). Frontend = React + TypeScript + Vite (`app/frontend`, tests with Vitest via `npx vitest run`).

## Global Constraints

- NO new runtime dependencies (backend uses stdlib `urllib` for Maps; frontend adds no npm deps). — verbatim from repo constraints / supply-chain memory.
- BYO Maps key is **in-memory only**: never persisted, logged, or exported.
- Replay renders from the log **without recalculating** decisions; recovery choices must be frozen into the log.
- Setup params are setup-time only; recovery state is runtime and lives on `RunState`, not the setup snapshot.
- Qualitative/boundary-binned trigger discipline preserved — recovery is engine/run-state, never a numeric fed to a trigger.
- All localizable labels are `{ja, en}` and resolved via `t()` on the frontend.
- Bilingual UI default is English (`uiLanguage: 'en'`).
- Backend test runner: `uv run pytest` (the bare `python` binary is absent; use `uv run`).

---

## File Structure

**Backend (create/modify):**
- `app/api/aica_api/models/scenario.py` — add `RecoveryStage`, `RecoveryOption`; add `recovery_options: list[RecoveryOption] = []` to `ScenarioDef`.
- `app/api/aica_api/models/run.py` — add `RestSpot`, `RecoveryState`; add `recovery: RecoveryState | None = None` to `RunState`.
- `app/api/aica_api/services/recovery.py` — **new**: pure recovery-phase state machine (`start_recovery`, `advance_recovery`) used by the tick engine.
- `app/api/aica_api/services/tick_engine.py` — call into `recovery.py` when `recovery.active`; apply `apply_rest_recovery`; set motion/phase on the tick state.
- `app/api/aica_api/services/run_manager.py` — `action()` accepts option+spot and starts recovery (resume, not complete); `tick()` threads recovery; fire-control suppression while guidance active.
- `app/api/aica_api/routers/runs.py` — extend `ActionBody`; surface `motion_state`/`recovery_phase`/`active_content` in the tick response; add `GET /api/runs/{id}/rest-spots`.
- `scenarios/uc01_fatigue_friend_drive_v0_1.json` — add `recovery_options`.

**Frontend (create/modify):**
- `app/frontend/src/api/types.ts` — recovery types; extend tick response + `RunState`.
- `app/frontend/src/api/client.ts` — `actRun` payload; `getRestSpots`.
- `app/frontend/src/state/runStore.ts` — store recovery state + applied action.
- `app/frontend/src/components/playback/RecoveryPicker.tsx` — **new** option + spot picker.
- `app/frontend/src/components/playback/RecoveryVisualization.tsx` — **new** karaoke/sleep/dim visuals.
- `app/frontend/src/components/playback/MotionBadge.tsx` — **new** MOVING/STOPPED badge.
- `app/frontend/src/components/context/ScenarioBeats.tsx` — rebuild as projection.
- `app/frontend/src/components/layout/CenterPlaybackPanel.tsx` — wire picker + visualization + badge.
- `app/frontend/src/components/map/MapSurface.tsx` — rest-spot candidate markers + chosen highlight.

---

## Phase 1 — Backend: scenario recovery model

### Task 1: `RecoveryOption` / `RecoveryStage` scenario model + validation

**Files:**
- Modify: `app/api/aica_api/models/scenario.py`
- Test: `app/api/tests/test_models.py`

**Interfaces:**
- Produces: `RecoveryStage(phase: str, content: str, motion: Literal["MOVING","STOPPED"], ticks: int | None)`, `RecoveryOption(id: str, label: dict, rest_type: Literal["short","long"] | None, stages: list[RecoveryStage], postpone: bool)`, and `ScenarioDef.recovery_options: list[RecoveryOption]`.

- [ ] **Step 1: Write the failing test**

```python
# app/api/tests/test_models.py  (append)
from aica_api.models.scenario import RecoveryOption, RecoveryStage

def test_recovery_option_parses_stages_and_postpone():
    opt = RecoveryOption(
        id="nap_karaoke",
        label={"ja": "仮眠後にカラオケ", "en": "Brief nap, then karaoke"},
        rest_type="long",
        stages=[
            {"phase": "wakefulness", "content": "audio_karaoke", "motion": "MOVING"},
            {"phase": "nap", "content": "sleep", "motion": "STOPPED", "ticks": 3},
        ],
    )
    assert opt.stages[1].ticks == 3
    assert opt.stages[0].ticks is None
    assert opt.postpone is False

    postpone = RecoveryOption(id="postpone", label={"ja": "見送る", "en": "Postpone"}, postpone=True)
    assert postpone.postpone is True
    assert postpone.stages == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/api && uv run pytest tests/test_models.py::test_recovery_option_parses_stages_and_postpone -v`
Expected: FAIL with `ImportError: cannot import name 'RecoveryOption'`.

- [ ] **Step 3: Add the models**

```python
# app/api/aica_api/models/scenario.py  (add near the other route models)
from typing import Literal

class RecoveryStage(BaseModel):
    phase: str                                   # wakefulness | nap | content
    content: str                                 # audio_karaoke | sleep | video_karaoke | stretch | ...
    motion: Literal["MOVING", "STOPPED"]
    ticks: int | None = None                     # None = lasts until rest spot (wakefulness)
    model_config = {"extra": "allow"}

class RecoveryOption(BaseModel):
    id: str
    label: dict                                  # {ja, en}
    rest_type: Literal["short", "long"] | None = None
    stages: list[RecoveryStage] = []
    postpone: bool = False
    model_config = {"extra": "allow"}
```

Then add to `ScenarioDef` (after `allowed_actions`):

```python
    recovery_options: list[RecoveryOption] = []
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app/api && uv run pytest tests/test_models.py::test_recovery_option_parses_stages_and_postpone -v`
Expected: PASS.

- [ ] **Step 5: Run the full models suite + commit**

Run: `cd app/api && uv run pytest tests/test_models.py -q`
Expected: PASS (no regressions).

```bash
git add app/api/aica_api/models/scenario.py app/api/tests/test_models.py
git commit -m "feat(recovery): scenario RecoveryOption/RecoveryStage model"
```

---

## Phase 2 — Backend: RunState recovery block

### Task 2: `RecoveryState` + `RestSpot` on `RunState`

**Files:**
- Modify: `app/api/aica_api/models/run.py`
- Test: `app/api/tests/test_models.py`

**Interfaces:**
- Produces: `RestSpot(id, label: dict, lat: float | None, lng: float | None, route_fraction: float)`, `RecoveryState(active: bool, option_id: str | None, rest_spot: RestSpot | None, phase: str | None, stage_index: int, stage_ticks_remaining: int)`, and `RunState.recovery: RecoveryState | None`.

- [ ] **Step 1: Write the failing test**

```python
# app/api/tests/test_models.py  (append)
from aica_api.models.run import RecoveryState, RestSpot

def test_recovery_state_defaults():
    rs = RecoveryState(active=True, option_id="nap_karaoke",
                        rest_spot=RestSpot(id="p1", label={"ja":"SA","en":"SA"}, route_fraction=0.6),
                        phase="wakefulness")
    assert rs.stage_index == 0
    assert rs.stage_ticks_remaining == 0
    assert rs.rest_spot.route_fraction == 0.6
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/api && uv run pytest tests/test_models.py::test_recovery_state_defaults -v`
Expected: FAIL with `ImportError: cannot import name 'RecoveryState'`.

- [ ] **Step 3: Add the models**

```python
# app/api/aica_api/models/run.py  (add above class RunState)
class RestSpot(BaseModel):
    id: str
    label: dict
    lat: float | None = None
    lng: float | None = None
    route_fraction: float
    model_config = {"extra": "allow"}

class RecoveryState(BaseModel):
    active: bool = False
    option_id: str | None = None
    rest_spot: RestSpot | None = None
    phase: str | None = None              # wakefulness|arriving|nap|content|resuming
    stage_index: int = 0
    stage_ticks_remaining: int = 0
    model_config = {"extra": "allow"}
```

Add to `RunState` (after `last_error`):

```python
    recovery: RecoveryState | None = None
```

- [ ] **Step 4: Run + commit**

Run: `cd app/api && uv run pytest tests/test_models.py -q` → PASS

```bash
git add app/api/aica_api/models/run.py app/api/tests/test_models.py
git commit -m "feat(recovery): RunState recovery block (RecoveryState/RestSpot)"
```

---

## Phase 3 — Backend: recovery state machine (pure)

### Task 3: `recovery.py` — `start_recovery` + `advance_recovery`

**Files:**
- Create: `app/api/aica_api/services/recovery.py`
- Test: `app/api/tests/test_recovery.py`

**Interfaces:**
- Consumes: `RecoveryOption` (Task 1), `RecoveryState`/`RestSpot` (Task 2).
- Produces:
  - `start_recovery(option: RecoveryOption, rest_spot: RestSpot) -> RecoveryState` — returns an active state at the first stage (phase from stage 0; `stage_ticks_remaining` from stage 0 `ticks or 0`).
  - `advance_recovery(state: RecoveryState, option: RecoveryOption, *, at_rest_spot: bool) -> RecoveryState` — returns the next state. Rules: during a `MOVING` wakefulness stage, stay until `at_rest_spot` is True, then move to the next stage; during a `STOPPED` stage with `ticks`, decrement `stage_ticks_remaining`, advancing to the next stage at 0; after the last stage, return a state with `phase="resuming"`; advancing a `resuming` state returns `active=False, phase=None` (recovery done).
  - `current_stage(state, option) -> RecoveryStage | None`.

- [ ] **Step 1: Write the failing tests**

```python
# app/api/tests/test_recovery.py  (new)
from aica_api.models.scenario import RecoveryOption
from aica_api.models.run import RestSpot
from aica_api.services.recovery import start_recovery, advance_recovery

OPT = RecoveryOption(
    id="nap_karaoke", label={"ja": "x", "en": "x"}, rest_type="long",
    stages=[
        {"phase": "wakefulness", "content": "audio_karaoke", "motion": "MOVING"},
        {"phase": "nap", "content": "sleep", "motion": "STOPPED", "ticks": 2},
        {"phase": "content", "content": "video_karaoke", "motion": "STOPPED", "ticks": 1},
    ],
)
SPOT = RestSpot(id="p1", label={"ja": "SA", "en": "SA"}, route_fraction=0.6)

def test_start_recovery_begins_at_wakefulness():
    s = start_recovery(OPT, SPOT)
    assert s.active and s.phase == "wakefulness" and s.stage_index == 0

def test_wakefulness_holds_until_at_rest_spot():
    s = start_recovery(OPT, SPOT)
    s = advance_recovery(s, OPT, at_rest_spot=False)
    assert s.phase == "wakefulness"          # still en route
    s = advance_recovery(s, OPT, at_rest_spot=True)
    assert s.phase == "nap" and s.stage_ticks_remaining == 2

def test_stopped_stages_count_down_then_resume():
    s = start_recovery(OPT, SPOT)
    s = advance_recovery(s, OPT, at_rest_spot=True)   # -> nap, 2
    s = advance_recovery(s, OPT, at_rest_spot=True)   # nap tick -> 1
    assert s.phase == "nap" and s.stage_ticks_remaining == 1
    s = advance_recovery(s, OPT, at_rest_spot=True)   # nap tick -> 0 -> content,1
    assert s.phase == "content" and s.stage_ticks_remaining == 1
    s = advance_recovery(s, OPT, at_rest_spot=True)   # content tick -> 0 -> resuming
    assert s.phase == "resuming"
    s = advance_recovery(s, OPT, at_rest_spot=True)   # resuming -> done
    assert s.active is False and s.phase is None
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd app/api && uv run pytest tests/test_recovery.py -v`
Expected: FAIL (`ModuleNotFoundError: aica_api.services.recovery`).

- [ ] **Step 3: Implement `recovery.py`**

```python
# app/api/aica_api/services/recovery.py  (new)
"""Pure recovery-phase state machine (Approach A).

Drives a RecoveryState through an option's ordered stages. No I/O, no engine
coupling — the tick engine calls advance_recovery once per tick and applies the
motion/recovery effects from the returned phase.
"""
from __future__ import annotations
from aica_api.models.run import RecoveryState, RestSpot
from aica_api.models.scenario import RecoveryOption, RecoveryStage


def current_stage(state: RecoveryState, option: RecoveryOption) -> RecoveryStage | None:
    if state.stage_index < 0 or state.stage_index >= len(option.stages):
        return None
    return option.stages[state.stage_index]


def start_recovery(option: RecoveryOption, rest_spot: RestSpot) -> RecoveryState:
    first = option.stages[0] if option.stages else None
    return RecoveryState(
        active=True,
        option_id=option.id,
        rest_spot=rest_spot,
        phase=(first.phase if first else "resuming"),
        stage_index=0,
        stage_ticks_remaining=(first.ticks or 0) if first else 0,
    )


def _enter_stage(state: RecoveryState, option: RecoveryOption, index: int) -> RecoveryState:
    if index >= len(option.stages):
        return state.model_copy(update={"phase": "resuming", "stage_index": index, "stage_ticks_remaining": 0})
    stage = option.stages[index]
    return state.model_copy(update={
        "phase": stage.phase, "stage_index": index, "stage_ticks_remaining": stage.ticks or 0,
    })


def advance_recovery(state: RecoveryState, option: RecoveryOption, *, at_rest_spot: bool) -> RecoveryState:
    if state.phase == "resuming":
        return state.model_copy(update={"active": False, "phase": None})

    stage = current_stage(state, option)
    if stage is None:
        return state.model_copy(update={"phase": "resuming", "stage_ticks_remaining": 0})

    # MOVING wakefulness: hold until the car reaches the rest spot.
    if stage.motion == "MOVING":
        if not at_rest_spot:
            return state                      # keep driving toward the spot
        return _enter_stage(state, option, state.stage_index + 1)

    # STOPPED stage: count down its dwell ticks, then move on.
    remaining = state.stage_ticks_remaining - 1
    if remaining > 0:
        return state.model_copy(update={"stage_ticks_remaining": remaining})
    return _enter_stage(state, option, state.stage_index + 1)
```

- [ ] **Step 4: Run to verify pass**

Run: `cd app/api && uv run pytest tests/test_recovery.py -v` → PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/aica_api/services/recovery.py app/api/tests/test_recovery.py
git commit -m "feat(recovery): pure recovery-phase state machine"
```

---

## Phase 4 — Backend: wire recovery into the tick engine

### Task 4: `advance_tick` honors recovery (motion + position + apply_rest_recovery)

**Files:**
- Modify: `app/api/aica_api/services/tick_engine.py`
- Test: `app/api/tests/test_tick_engine_recovery.py`

**Interfaces:**
- Consumes: `advance_recovery` (Task 3), `apply_rest_recovery` (existing `behavior/driver_model.py`), `RecoveryState`.
- Produces: when `recovery and recovery.active`, `advance_tick` (a) holds `route_fraction` at the rest spot during STOPPED phases, (b) calls `apply_rest_recovery(profile, state, rest_type)` on each STOPPED tick, (c) writes `motionState` + `recoveryPhase` + `activeContent` into `raw_state`, and (d) returns the advanced `RecoveryState` via `tick_state.model_extra["_recovery_next"]`.

> Integration note: `advance_tick(prior_state, tick_index, event_plan, route_facts, scenario)` currently has no `recovery` arg. Add an optional `recovery: RecoveryState | None = None` parameter (keyword, default None) so all existing callers/tests are unaffected. `run_manager` passes the run's recovery in Task 6.

- [ ] **Step 1: Write the failing test**

```python
# app/api/tests/test_tick_engine_recovery.py  (new)
from aica_api.models.run import RecoveryState, RestSpot
from aica_api.models.scenario import RecoveryOption
from aica_api.services.tick_engine import advance_tick
from aica_api.services.behavior.driver_model import DriverState
# Reuse an existing M2 scenario+plan fixture builder from the recovery conftest/helpers.
from tests.helpers_recovery import m2_scenario_with_recovery, m2_event_plan, m2_route_facts

def test_stopped_recovery_tick_holds_position_and_recovers():
    scenario = m2_scenario_with_recovery()       # driver_profile.recovery_model set; one rest segment
    plan = m2_event_plan(scenario, tick_seconds=60)
    facts = m2_route_facts(scenario)
    spot = RestSpot(id="p1", label={"ja": "SA", "en": "SA"}, route_fraction=0.5)
    # Recovery already at a STOPPED nap stage:
    rec = RecoveryState(active=True, option_id="nap_karaoke", rest_spot=spot,
                        phase="nap", stage_index=1, stage_ticks_remaining=2)
    # prior driver state: drowsy
    prior = advance_tick(None, 0, plan, facts, scenario)            # tick 0 establishes raw_state
    drowsy_before = float(prior.raw_state["drowsinessLevel"])
    out = advance_tick(prior, 1, plan, facts, scenario, recovery=rec)
    assert out.raw_state["motionState"] == "STOPPED"
    assert out.raw_state["recoveryPhase"] == "nap"
    assert abs(out.route_fraction - 0.5) < 1e-6                     # held at the spot
    assert float(out.raw_state["drowsinessLevel"]) < drowsy_before  # recovered
```

> The helper module `tests/helpers_recovery.py` (create it in this step) returns a minimal M2 scenario whose `driver_profile.recovery_model` has positive `short_/long_rest_*` values, one `is_rest_facility` segment at `at=0.5`, and `recovery_options=[nap_karaoke]`. Build it by copying the smallest existing M2 scenario fixture used in `tests/test_tick_engine.py` and adding the recovery fields. (Show the exact fixture in the helper file; do not leave it abstract.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd app/api && uv run pytest tests/test_tick_engine_recovery.py -v`
Expected: FAIL (`advance_tick() got an unexpected keyword argument 'recovery'`).

- [ ] **Step 3: Implement recovery handling in `advance_tick`**

Add the `recovery` parameter and, right after `route_fraction`/`new_distance_km` are computed (tick_engine.py ~line 216) but before driver-state advance, branch:

```python
# app/api/aica_api/services/tick_engine.py  (inside advance_tick)
def advance_tick(prior_state, tick_index, event_plan, route_facts, scenario, *, recovery=None):
    ...
    # ── Recovery override (Approach A) ────────────────────────────────────
    from aica_api.services.recovery import advance_recovery, current_stage
    recovery_next = None
    motion_state = "MOVING"
    recovery_phase = None
    active_content = None
    if recovery is not None and recovery.active:
        option = next((o for o in scenario.recovery_options if o.id == recovery.option_id), None)
        if option is not None:
            stage = current_stage(recovery, option)
            spot_frac = recovery.rest_spot.route_fraction if recovery.rest_spot else 1.0
            at_spot = new_distance_km / total_km >= spot_frac
            if stage is not None and stage.motion == "STOPPED":
                # Hold position at the rest spot; do not advance distance.
                new_distance_km = spot_frac * total_km
                route_fraction = spot_frac
                completed = False
                motion_state = "STOPPED"
            recovery_phase = recovery.phase
            active_content = stage.content if stage is not None else None
            recovery_next = advance_recovery(recovery, option, at_rest_spot=at_spot)
```

Then, in the driver-state advance block, when the current phase is STOPPED apply recovery instead of (or in addition to) normal growth:

```python
    if recovery is not None and recovery.active and motion_state == "STOPPED" and scenario.driver_profile is not None:
        from aica_api.services.behavior.driver_model import DriverState, apply_rest_recovery
        option = next((o for o in scenario.recovery_options if o.id == recovery.option_id), None)
        rest_type = (option.rest_type if option and option.rest_type else "short")
        recovered = apply_rest_recovery(
            scenario.driver_profile,
            DriverState(drowsiness=drowsiness, fatigue=fatigue, attention=attention),
            rest_type,
        )
        new_drowsiness, new_fatigue, new_attention = recovered.drowsiness, recovered.fatigue, recovered.attention
```

Add the fields to `raw_state` (`is_traffic_jam` is already computed earlier in `advance_tick`):

```python
        "motionState": motion_state,
        "recoveryPhase": recovery_phase,
        "activeContent": active_content,
        "isTrafficJam": is_traffic_jam,
```

And stash the advanced recovery for the caller (after building the TickState `ts`):

```python
    if recovery_next is not None:
        ts.model_extra["_recovery_next"] = recovery_next
```

> Apply the full per-stage recovery on each STOPPED tick (simplest correct behavior; magnitudes come from the profile). The `nap`/`content` stages both count as STOPPED recovery ticks.

- [ ] **Step 4: Run to verify pass**

Run: `cd app/api && uv run pytest tests/test_tick_engine_recovery.py -v` → PASS
Then: `cd app/api && uv run pytest tests/test_tick_engine.py -q` → PASS (recovery defaults to None; existing behavior unchanged).

- [ ] **Step 5: Commit**

```bash
git add app/api/aica_api/services/tick_engine.py app/api/tests/test_tick_engine_recovery.py app/api/tests/helpers_recovery.py
git commit -m "feat(recovery): tick engine honors recovery phases + apply_rest_recovery"
```

---

## Phase 5 — Backend: action handler + tick threading + fire-control

### Task 5: `action()` starts recovery (resume, not complete); `tick()` threads recovery; suppress duplicate proposals

**Files:**
- Modify: `app/api/aica_api/services/run_manager.py`
- Test: `app/api/tests/test_run_manager_recovery.py`

**Interfaces:**
- Consumes: `start_recovery` (Task 3), `RecoveryState` (Task 2), `advance_tick(..., recovery=...)` (Task 4).
- Produces:
  - `action(run_id, action_str, *, recovery_option_id=None, rest_spot=None) -> RunState` — for `accept_rest` **when the scenario has `recovery_options`**: validate `recovery_option_id` ∈ options and `rest_spot` present; `run_state.recovery = start_recovery(option, rest_spot)`; `status = playing`; `pending_proposal = None`. For scenarios with **no** `recovery_options`, keep the existing `accept_rest → completed`. `postpone`/`decline` set a cooldown marker on `run_state.recovery` (a `RecoveryState(active=False)` with `model_extra["cooldown_until_tick"]`).
  - `tick()` passes `run_state.recovery` to `advance_tick`, stores `tick_state.model_extra["_recovery_next"]` back onto `run_state.recovery`, and clears `recovery` when it becomes inactive; when `recovery and recovery.active`, sets `run_state.status` based on phase (running) and does NOT complete the run.
  - Fire-control: while `recovery and recovery.active`, a fired `REST_PROPOSAL` is suppressed (not paused); recorded as suppression in the trace.

- [ ] **Step 1: Write the failing tests**

```python
# app/api/tests/test_run_manager_recovery.py  (new)
import aica_api.services.run_manager as rm
from aica_api.models.run import RestSpot
from tests.helpers_recovery import create_paused_rest_run   # seeds a run paused on a REST_PROPOSAL

def test_accept_rest_with_option_resumes_into_recovery():
    run_id = create_paused_rest_run()                       # scenario has recovery_options
    spot = RestSpot(id="p1", label={"ja": "SA", "en": "SA"}, route_fraction=0.5)
    rs = rm.action(run_id, "accept_rest", recovery_option_id="nap_karaoke", rest_spot=spot)
    assert rs.status.value == "playing"
    assert rs.recovery is not None and rs.recovery.active
    assert rs.recovery.option_id == "nap_karaoke"
    assert rs.recovery.rest_spot.id == "p1"

def test_accept_rest_missing_option_is_rejected():
    run_id = create_paused_rest_run()
    try:
        rm.action(run_id, "accept_rest")
        assert False, "expected ActionNotAllowedError"
    except rm.ActionNotAllowedError:
        pass

def test_recovery_runs_to_resume_and_completes():
    run_id = create_paused_rest_run()
    spot = RestSpot(id="p1", label={"ja": "SA", "en": "SA"}, route_fraction=0.5)
    rm.action(run_id, "accept_rest", recovery_option_id="nap_karaoke", rest_spot=spot)
    phases = []
    for _ in range(40):
        out = rm.tick(run_id)
        ts = out.tick_state
        if ts is not None and ts.raw_state.get("recoveryPhase"):
            phases.append(ts.raw_state["recoveryPhase"])
        if out.completed:
            break
    assert "nap" in phases and "content" in phases     # staged recovery happened
    assert out.completed                                # resumed and reached destination
```

> Add `create_paused_rest_run()` to `tests/helpers_recovery.py`: create a run via `run_manager` for `m2_scenario_with_recovery()`, tick until a `REST_PROPOSAL` pauses it, return the `run_id`. Use the existing run-creation helper pattern from `tests/test_run_manager.py`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd app/api && uv run pytest tests/test_run_manager_recovery.py -v`
Expected: FAIL (`action() got an unexpected keyword argument 'recovery_option_id'`).

- [ ] **Step 3: Implement**

In `action()` (run_manager.py ~line 691), replace the resulting-status block:

```python
def action(run_id, action_str, *, recovery_option_id=None, rest_spot=None):
    ... # existing guards unchanged
    if action_str == "accept_rest":
        if scenario.recovery_options:
            from aica_api.services.recovery import start_recovery
            option = next((o for o in scenario.recovery_options if o.id == recovery_option_id), None)
            if option is None or rest_spot is None:
                raise ActionNotAllowedError(
                    f"accept_rest requires a valid recovery_option_id + rest_spot "
                    f"(got {recovery_option_id!r})."
                )
            run_state.recovery = start_recovery(option, rest_spot)
            new_status = RunStatus.playing
        else:
            new_status = RunStatus.completed     # back-compat: no recovery menu
    else:
        new_status = RunStatus.playing
    ... # append ActionEvent (unchanged), then:
    run_state.status = new_status
    run_state.pending_proposal = None
    return run_state
```

In `tick()`: pass and thread recovery around the `advance_tick` call (run_manager.py ~line 507):

```python
        tick_state = advance_tick(prior_tick_state, current_tick, run_state.event_plan,
                                  run_state.route_facts, scenario, recovery=run_state.recovery)
        rec_next = (tick_state.model_extra or {}).get("_recovery_next")
        if rec_next is not None:
            run_state.recovery = rec_next if rec_next.active else None
```

In the status block (run_manager.py ~line 655): when `run_state.recovery and run_state.recovery.active`, force `run_state.status = RunStatus.playing`, `paused=False`, `completed=False` (recovery never completes the run mid-sequence). Add fire-control: before pausing on a fired proposal, if `run_state.recovery and run_state.recovery.active`, do NOT pause — record the proposal as suppressed in the trace and continue.

- [ ] **Step 4: Run to verify pass**

Run: `cd app/api && uv run pytest tests/test_run_manager_recovery.py -v` → PASS
Then: `cd app/api && uv run pytest tests/test_run_manager.py -q` → PASS (no recovery_options scenarios keep old behavior).

- [ ] **Step 5: Commit**

```bash
git add app/api/aica_api/services/run_manager.py app/api/tests/test_run_manager_recovery.py app/api/tests/helpers_recovery.py
git commit -m "feat(recovery): action starts recovery + tick threading + fire-control suppression"
```

---

## Phase 6 — Backend: API surface (action body, tick fields, rest-spots)

### Task 6: Extend `ActionBody`, tick response fields, add `GET /api/runs/{id}/rest-spots`

**Files:**
- Modify: `app/api/aica_api/routers/runs.py`
- Test: `app/api/tests/test_routes_recovery.py`

**Interfaces:**
- Produces:
  - `ActionBody { action: str, recovery_option_id: str | None, rest_spot: RestSpot | None }`.
  - tick response adds `motion_state`, `recovery_phase`, `active_content` (from `outcome.tick_state.raw_state`).
  - `GET /api/runs/{id}/rest-spots?maps_key=...` → `{ "rest_spots": [RestSpot, ...] }` — Places-derived when a key is supplied (reuse `routes.py` Places helper), else scenario/route fallback (`route_facts.rest_spot_positions` → `RestSpot`s).

- [ ] **Step 1: Write the failing test**

```python
# app/api/tests/test_routes_recovery.py  (new)
from fastapi.testclient import TestClient
from aica_api.main import app
from tests.helpers_recovery import create_paused_rest_run

client = TestClient(app)

def test_rest_spots_fallback_without_key():
    run_id = create_paused_rest_run()
    r = client.get(f"/api/runs/{run_id}/rest-spots")
    assert r.status_code == 200
    spots = r.json()["rest_spots"]
    assert len(spots) >= 1
    assert "route_fraction" in spots[0]

def test_action_body_accepts_recovery_payload():
    run_id = create_paused_rest_run()
    r = client.post(f"/api/runs/{run_id}/actions", json={
        "action": "accept_rest", "recovery_option_id": "nap_karaoke",
        "rest_spot": {"id": "p1", "label": {"ja": "SA", "en": "SA"}, "route_fraction": 0.5},
    })
    assert r.status_code == 200
    assert r.json()["status"] == "playing"

def test_tick_response_exposes_motion_and_phase():
    run_id = create_paused_rest_run()
    client.post(f"/api/runs/{run_id}/actions", json={
        "action": "accept_rest", "recovery_option_id": "nap_karaoke",
        "rest_spot": {"id": "p1", "label": {"ja": "SA", "en": "SA"}, "route_fraction": 0.5}})
    r = client.post(f"/api/runs/{run_id}/tick")
    body = r.json()
    assert "motion_state" in body and "recovery_phase" in body
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app/api && uv run pytest tests/test_routes_recovery.py -v`
Expected: FAIL (404 on `/rest-spots`; action body lacks fields).

- [ ] **Step 3: Implement**

Extend `ActionBody` (runs.py:70):

```python
from aica_api.models.run import RestSpot
class ActionBody(BaseModel):
    action: str
    recovery_option_id: str | None = None
    rest_spot: RestSpot | None = None
```

Pass through in `action_endpoint`:

```python
    updated = action(run_id, body.action,
                     recovery_option_id=body.recovery_option_id, rest_spot=body.rest_spot)
```

Add tick-response fields (in both return dicts):

```python
    raw = (ts.raw_state or {}) if ts is not None else {}
    motion_state = raw.get("motionState")
    recovery_phase = raw.get("recoveryPhase")
    active_content = raw.get("activeContent")
    is_traffic_jam = raw.get("isTrafficJam")
    # add to each returned dict:
    #   "motion_state": motion_state, "recovery_phase": recovery_phase,
    #   "active_content": active_content, "is_traffic_jam": is_traffic_jam,
```

Add the rest-spots endpoint (reuse the run registry + `route_facts`):

```python
@router.get("/api/runs/{run_id}/rest-spots")
def rest_spots_endpoint(run_id: str, maps_key: str | None = None):
    rs = get_run(run_id)
    if rs is None:
        raise HTTPException(status_code=404, detail=f"Run {run_id!r} not found")
    spots = []
    total_km = rs.route_facts.total_route_distance_km or 120.0
    # Fallback: scenario/route positions → RestSpot (deterministic, offline).
    for i, pos_km in enumerate(rs.route_facts.rest_spot_positions):
        spots.append({"id": f"rest_{i}",
                      "label": {"ja": f"休憩所{i+1}", "en": f"Rest stop {i+1}"},
                      "route_fraction": min(1.0, pos_km / total_km)})
    # (When maps_key is present, replace `spots` with Places results via the
    #  routes.py Places helper; key stays in-memory, never persisted.)
    return {"rest_spots": spots}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd app/api && uv run pytest tests/test_routes_recovery.py -v` → PASS
Then: `cd app/api && uv run pytest -q` → 1030+ PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/aica_api/routers/runs.py app/api/tests/test_routes_recovery.py
git commit -m "feat(recovery): action payload + tick motion/phase fields + rest-spots endpoint"
```

---

## Phase 7 — Frontend: types, client, store

### Task 7: Recovery types + `actRun` payload + `getRestSpots` + store state

**Files:**
- Modify: `app/frontend/src/api/types.ts`, `app/frontend/src/api/client.ts`, `app/frontend/src/state/runStore.ts`
- Test: `app/frontend/tests/recovery_store.test.tsx`

**Interfaces:**
- Produces: TS types `RecoveryOption`, `RecoveryStage`, `RestSpot`, `RecoveryStateT`; `TickResponseSuccess` adds `motion_state?`, `recovery_phase?`, `active_content?`; `RunState` adds `recovery?: RecoveryStateT | null`; `actRun(runId, action, opts?: {recovery_option_id?, rest_spot?})`; `getRestSpots(runId, mapsKey?) → {rest_spots: RestSpot[]}`. Store: `ACTION_APPLIED` carries the applied `action` string (recorded for beats); `TICK_APPENDED` carries `motionState`/`recoveryPhase`/`activeContent` onto the trace entry.

- [ ] **Step 1: Write the failing test**

```tsx
// app/frontend/tests/recovery_store.test.tsx  (new)
import { describe, it, expect } from 'vitest'
import { reducer, initialState } from '../src/state/runStore'
import type { RunState } from '../src/api/types'

const baseRun: RunState = {
  run_id: 'r1', status: 'paused', current_tick: 3, pending_proposal: 'rest',
  package_runtime_state: {}, snapshot: { package: {id:'p',version:'1',hash:'h'}, scenario:{id:'s',version:'1',hash:'h'} },
  event_plan: {}, route_facts: {},
}

it('ACTION_APPLIED records the applied action for the beat timeline', () => {
  const s = reducer({ ...initialState, runState: baseRun },
    { type: 'ACTION_APPLIED', runState: { ...baseRun, status: 'playing' }, action: 'accept_rest' })
  expect(s.lastAction).toBe('accept_rest')
  expect(s.paused).toBe(false)
})
```

> If `reducer`/`initialState` aren't exported, export them from `runStore.ts` (they are used by existing tests via the provider; add named exports). Confirm by grep before editing.

- [ ] **Step 2: Run to verify it fails**

Run: `cd app/frontend && npx vitest run tests/recovery_store.test.tsx`
Expected: FAIL (`lastAction` undefined / `action` not on ACTION_APPLIED).

- [ ] **Step 3: Implement**

In `types.ts` add:

```ts
export type RecoveryStage = { phase: string; content: string; motion: 'MOVING'|'STOPPED'; ticks?: number|null }
export type RecoveryOption = { id: string; label: { ja: string; en: string }; rest_type?: 'short'|'long'|null; stages?: RecoveryStage[]; postpone?: boolean }
export type RestSpot = { id: string; label: { ja: string; en: string }; lat?: number|null; lng?: number|null; route_fraction: number }
export type RecoveryStateT = { active: boolean; option_id: string|null; rest_spot: RestSpot|null; phase: string|null; stage_index: number; stage_ticks_remaining: number }
```

Add to `TickResponseSuccess`: `motion_state?: string | null; recovery_phase?: string | null; active_content?: string | null; is_traffic_jam?: boolean | null`.
Add to `RunState`: `recovery?: RecoveryStateT | null`.
Add to `TraceEntry`: `motion_state?: string | null; recovery_phase?: string | null; is_traffic_jam?: boolean | null`.

In `client.ts`:

```ts
export async function actRun(runId: string, action: string, opts: { recovery_option_id?: string; rest_spot?: RestSpot } = {}): Promise<RunState> {
  return apiFetch(`/api/runs/${runId}/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...opts }) })
}
export async function getRestSpots(runId: string, mapsKey?: string): Promise<{ rest_spots: RestSpot[] }> {
  const q = mapsKey ? `?maps_key=${encodeURIComponent(mapsKey)}` : ''
  return apiFetch(`/api/runs/${runId}/rest-spots${q}`, { method: 'GET' })
}
```

In `runStore.ts`: add `lastAction: string | null` (init `null`); `ACTION_APPLIED` action gains `action: string` and sets `lastAction`; `TICK_APPENDED` gains `motionState?`, `recoveryPhase?` and stores them on the entry + `recovery` from `runState`.

- [ ] **Step 4: Run to verify pass**

Run: `cd app/frontend && npx vitest run tests/recovery_store.test.tsx` → PASS

- [ ] **Step 5: Commit**

```bash
git add app/frontend/src/api/types.ts app/frontend/src/api/client.ts app/frontend/src/state/runStore.ts app/frontend/tests/recovery_store.test.tsx
git commit -m "feat(recovery): frontend types, client payload, store action recording"
```

---

## Phase 8 — Frontend: recovery picker

### Task 8: `RecoveryPicker` (option + rest-spot selection)

**Files:**
- Create: `app/frontend/src/components/playback/RecoveryPicker.tsx`
- Test: `app/frontend/tests/recovery_picker.test.tsx`

**Interfaces:**
- Consumes: `getRestSpots` (Task 7), `actRun` (Task 7), scenario `recovery_options` (via `getScenario`).
- Produces: `<RecoveryPicker />` — when paused on a `REST_PROPOSAL`, fetches rest spots + reads the scenario's `recovery_options`, renders option cards + a spot list + Postpone/Decline, and on selection calls `actRun(runId, opt.postpone ? 'postpone' : 'accept_rest', opt.postpone ? {} : { recovery_option_id: opt.id, rest_spot })` then dispatches `ACTION_APPLIED`. `data-testid="recovery-picker"`, option buttons `data-testid="recovery-option-<id>"`, spot buttons `data-testid="rest-spot-<id>"`.

- [ ] **Step 1: Write the failing test**

```tsx
// app/frontend/tests/recovery_picker.test.tsx  (new)
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'

vi.mock('../src/api/client', () => ({
  getScenario: vi.fn(), getRestSpots: vi.fn(), actRun: vi.fn(),
  listPackages: vi.fn(), listScenarios: vi.fn(),
}))
import * as client from '../src/api/client'
import RecoveryPicker from '../src/components/playback/RecoveryPicker'
// ...seed a paused-on-rest-proposal run, mock getScenario → recovery_options=[nap_karaoke, postpone],
//    mock getRestSpots → [{id:'p1',...}], actRun → resolved RunState.

it('selecting an option + spot calls actRun with the recovery payload', async () => {
  // (full setup as in other component tests; render <RecoveryPicker/> in provider)
  // fireEvent.click(getByTestId('rest-spot-p1')); fireEvent.click(getByTestId('recovery-option-nap_karaoke'))
  // await waitFor(() => expect(actRun).toHaveBeenCalledWith('r1','accept_rest',{recovery_option_id:'nap_karaoke', rest_spot: expect.objectContaining({id:'p1'})}))
})
```

> Fill the setup body following the pattern in `tests/feedback.test.tsx` (provider + DispatchCapture + seed via dispatch). Keep the single assertion above.

- [ ] **Step 2: Run to verify it fails**

Run: `cd app/frontend && npx vitest run tests/recovery_picker.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `RecoveryPicker.tsx`** (option cards + spot list; on confirm → `actRun` + `ACTION_APPLIED`). Read `recovery_options` from `getScenario(selectedScenarioId)`, spots from `getRestSpots(runId, mapsKey || undefined)`. Resolve labels via `t()`.

- [ ] **Step 4: Run to verify pass** → PASS

- [ ] **Step 5: Commit**

```bash
git add app/frontend/src/components/playback/RecoveryPicker.tsx app/frontend/tests/recovery_picker.test.tsx
git commit -m "feat(recovery): RecoveryPicker option + rest-spot selection"
```

---

## Phase 9 — Frontend: visualization + motion badge + wiring

### Task 9: `RecoveryVisualization` + `MotionBadge`, wired into `CenterPlaybackPanel`

**Files:**
- Create: `app/frontend/src/components/playback/RecoveryVisualization.tsx`, `app/frontend/src/components/playback/MotionBadge.tsx`
- Modify: `app/frontend/src/components/layout/CenterPlaybackPanel.tsx`
- Test: `app/frontend/tests/recovery_visualization.test.tsx`

**Interfaces:**
- Consumes: `recovery_phase`/`motion_state`/`active_content` from the latest trace entry / store `recovery`.
- Produces: `<RecoveryVisualization />` renders, by phase+motion: `nap`+STOPPED → `data-testid="recovery-sleep"` (dim + 🌙 + Z's); `content`+STOPPED → `data-testid="recovery-karaoke"` (EQ bars + scrolling lyrics); `wakefulness`+MOVING → `data-testid="recovery-wakefulness"` (♪ audio, no lyrics); otherwise renders null. `<MotionBadge />` renders `data-testid="motion-badge"` with text `Driving`/`Stopped`. `CenterPlaybackPanel` renders the picker (Task 8) when paused on a rest proposal, the visualization overlaying the map during recovery, and the motion badge.

- [ ] **Step 1: Write the failing test**

```tsx
// app/frontend/tests/recovery_visualization.test.tsx  (new)
// seed store with recovery active phase='content', motion='STOPPED' on the last trace entry
it('shows the karaoke visual during the content stage when stopped', async () => {
  // render <RecoveryVisualization/> in provider with seeded state
  // expect(screen.getByTestId('recovery-karaoke')).toBeInTheDocument()
})
it('shows the sleep visual during the nap stage', async () => {
  // phase='nap' motion='STOPPED' -> getByTestId('recovery-sleep')
})
```

- [ ] **Step 2: Run to verify it fails** → FAIL (module not found)

- [ ] **Step 3: Implement** both components (lightweight CSS/SVG; EQ bars = a row of divs with a CSS keyframe; lyrics = a marquee div; sleep = dim overlay + 🌙 + floating Z spans). Wire into `CenterPlaybackPanel`: replace the current proposal overlay with `<RecoveryPicker/>` when `paused && latestDecision.proposal`; render `<RecoveryVisualization/>` over the map when `recovery?.active`; render `<MotionBadge/>` near the controls.

- [ ] **Step 4: Run to verify pass** → PASS; then `npx vitest run tests/playback.test.tsx tests/feedback.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/frontend/src/components/playback/RecoveryVisualization.tsx app/frontend/src/components/playback/MotionBadge.tsx app/frontend/src/components/layout/CenterPlaybackPanel.tsx app/frontend/tests/recovery_visualization.test.tsx
git commit -m "feat(recovery): karaoke/sleep visualization + motion badge wiring"
```

---

## Phase 10 — Frontend: Scenario Beat Timeline (projection)

### Task 10: Rebuild `ScenarioBeats` as a projection over trace + recovery phases

**Files:**
- Modify: `app/frontend/src/components/context/ScenarioBeats.tsx`
- Test: `app/frontend/tests/review_panels.test.tsx` (extend the existing `ScenarioBeats` describe)

**Interfaces:**
- Consumes: store `trace` (each entry carries `result_type`, `proposal`, `route_fraction`, `recovery_phase`, `motion_state`), `lastAction`, `useRouteProgress` (segments + `fractionAtTick`).
- Produces: a chronological beat list emitting one beat per status change with kinds: `start`, `segment` (road-type change), `traffic` (`is_traffic_jam`/low-speed flag — see note), `alert` (`SOFT_WARNING`), `propose` (`REST_PROPOSAL`), `action` (from `lastAction`), recovery (`wakefulness|arriving|nap|content|resuming` from `recovery_phase` change), `destination` (completed). **No drowsiness-band beats.** Current beat marked `▶ now`.

> Traffic-jam beat source: `is_traffic_jam` is threaded end-to-end — `raw_state.isTrafficJam` (Task 4) → tick response `is_traffic_jam` (Task 6) → `TraceEntry.is_traffic_jam` (Task 7). The beat fires on its rising edge.

- [ ] **Step 1: Write the failing test** — extend the `ScenarioBeats` describe with: drive through start→highway, fire a `REST_PROPOSAL` tick, apply `lastAction='accept_rest'`, then ticks with `recovery_phase` `nap` then `content`; assert beats `Entered Highway`, `AICA proposes rest`, `Resting (nap)`, `Karaoke after nap` are present and **no** `Drowsiness:` text appears.

```tsx
expect(screen.getByText(/Karaoke after nap/)).toBeInTheDocument()
expect(screen.queryByText(/Drowsiness:/)).not.toBeInTheDocument()
```

- [ ] **Step 2: Run to verify it fails** → FAIL (recovery/action beats absent; drowsiness beats present).

- [ ] **Step 3: Implement** the projection: walk `trace`; emit `segment` on active-segment change, `traffic` on `isTrafficJam` rising edge, `alert` on `SOFT_WARNING`, `propose` on `REST_PROPOSAL`, recovery beats on `recovery_phase` change; append an `action` beat from `lastAction`; `destination` when `completed`. Remove the `DROWSY_RANK` drowsiness logic entirely.

- [ ] **Step 4: Run to verify pass** → PASS; then `npx vitest run tests/review_panels.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/frontend/src/components/context/ScenarioBeats.tsx app/frontend/tests/review_panels.test.tsx
git commit -m "feat(recovery): Scenario Beat Timeline as trace+recovery projection (no drowsiness spam)"
```

---

## Phase 11 — Frontend: map rest-spot markers

### Task 11: Rest-spot candidate markers + chosen highlight on the map

**Files:**
- Modify: `app/frontend/src/components/map/MapSurface.tsx`
- Test: `app/frontend/tests/map.test.tsx` (extend)

**Interfaces:**
- Consumes: store `recovery.rest_spot` (chosen) + the picker's candidate list (lifted to store or fetched in MapSurface via `getRestSpots`). Produces: geographic markers for candidate spots (guarded by real `Marker`), the chosen spot emphasized, alongside the existing car/start/end/fire markers. DOM-overlay fallback `data-testid="rest-spot-marker"` for the chosen spot so it's testable under the mock.

- [ ] **Step 1: Write the failing test** — with `recovery.rest_spot` set, `getByTestId('rest-spot-marker')` is present.
- [ ] **Step 2: Run to verify it fails** → FAIL.
- [ ] **Step 3: Implement** the chosen-spot DOM overlay (positioned by `route_fraction` like the fire marker) + guarded geographic candidate markers.
- [ ] **Step 4: Run to verify pass** → PASS; `npx vitest run tests/map.test.tsx` → PASS.
- [ ] **Step 5: Commit**

```bash
git add app/frontend/src/components/map/MapSurface.tsx app/frontend/tests/map.test.tsx
git commit -m "feat(recovery): rest-spot markers + chosen-spot highlight on map"
```

---

## Phase 12 — Scenario data + end-to-end

### Task 12: Add `recovery_options` to a UC-01 scenario; full-stack e2e test

**Files:**
- Modify: `scenarios/uc01_fatigue_friend_drive_v0_1.json`
- Test: `app/api/tests/test_uc01_recovery_e2e.py`

**Interfaces:**
- Consumes: everything above.
- Produces: a runnable UC-01 scenario whose rest proposal leads to a real staged recovery and completion.

- [ ] **Step 1: Write the failing e2e test**

```python
# app/api/tests/test_uc01_recovery_e2e.py  (new)
from fastapi.testclient import TestClient
from aica_api.main import app
client = TestClient(app)

def test_uc01_rest_recovery_full_run():
    # create a run for uc01_fatigue_friend_drive_v0_1 via the run-plan + runs endpoints
    # tick until paused on REST_PROPOSAL
    # GET /rest-spots → pick first
    # POST /actions accept_rest with nap_karaoke + spot
    # tick to completion; assert recovery phases appeared and run completed
    ...
```

> Build the create-run steps from the existing `tests/test_run_manager.py` / route tests (route-plan → create run). Keep one end-to-end assertion: phases observed + `completed` true.

- [ ] **Step 2: Run to verify it fails** → FAIL (scenario has no `recovery_options`).

- [ ] **Step 3: Add `recovery_options`** to `scenarios/uc01_fatigue_friend_drive_v0_1.json` (the `nap_karaoke`, `convenience_stretch`, `postpone` set from the spec §5). Ensure `allowed_actions` includes `accept_rest`, `postpone`, `decline`.

- [ ] **Step 4: Run to verify pass** → PASS.

- [ ] **Step 5: Full suite + commit**

Run: `cd app/api && uv run pytest -q` → PASS; `cd app/frontend && npx vitest run` → PASS; `npm run build` → clean.

```bash
git add scenarios/uc01_fatigue_friend_drive_v0_1.json app/api/tests/test_uc01_recovery_e2e.py
git commit -m "feat(recovery): UC-01 scenario recovery_options + end-to-end test"
```

---

## Final verification

- [ ] `cd app/api && uv run pytest -q` — all pass.
- [ ] `cd app/frontend && npx vitest run` — all pass.
- [ ] `cd app/frontend && npm run build` — clean.
- [ ] Manual: `docker compose up`, run UC-01, hit a rest proposal, pick option + spot, watch wakefulness → arrive → nap (sleep visual) → karaoke (visual) → resume → destination, with the beat timeline narrating it and drowsiness/fatigue dropping at the stop.
- [ ] Replay the saved run: recovery beats + chosen spot reproduce from the log (no Places calls).
