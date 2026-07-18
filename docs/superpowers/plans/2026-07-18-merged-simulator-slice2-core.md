# Merged "Combined Simulator" — Slice 2 CORE Plan: Full Rest Journey + Enriched Recovery (feature 020)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** In the Combined screen, a REST fire now plays through the whole rest journey — before-rest driving proposal → accept rest (pick a recovery option + set sleep minutes) → the trigger recovery mechanic advances (en-route + nap + after-rest) with **realistic, duration/time-scaled recovery** → an after-rest stopped-content proposal appears via the proposal journey + recompute. Recovery realism lives entirely in the simulator (no algorithm-package change).

**Architecture:** Enrich the simulator recovery mechanic additively (`ActivityRecovery` + `apply_rest_recovery` + `tick_engine`), keeping today's fixed-once behavior as the default so every existing scenario/test is byte-identical. The merged orchestrator (Slice 1) gains rest-journey drive: on accept-rest it starts the trigger recovery; on subsequent ticks it watches the trigger recovery state and auto-issues the proposal journey actions (`rest_spot_arrived` → `rest_started` → `rest_completed(post_rest=computed drowsiness/fatigue)`) + `recompute`, opening the after-rest ranked opportunity. One proposal run per journey (never a 2nd `create`).

**Tech Stack:** Python 3.12 / FastAPI / Pydantic v2 / pytest; React 18 / TS / Vitest.

## Global Constraints

- **Do not change existing trigger or proposal API/screen behavior.** Existing suites stay green (backend 2293, frontend 640). Recovery enrichment is **additive**: a `RecoveryStage`/`recovery_model` entry with only the flat `{drowsiness, fatigue}` fields keeps the exact current fixed-once-on-nap-entry behavior. New per-minute/rate fields are opt-in.
- The merged coordination module stays the only cross-importer; isolation tests unchanged.
- **The rest chain is ONE proposal run.** Advance stages only via `journey/action` (`rest_spot_arrived`→`during_rest_stopped`, `rest_completed`→`after_rest_before_restart`) then `recompute` for the after-rest ranking. `during_rest_stopped` has an EMPTY matrix row — NEVER call `recompute` there (it 422s). `rest_completed` REQUIRES `payload.post_rest={drowsiness_level:int 0-100, fatigue_level:int 0-100}`.
- Recovery lives in the simulator: `scenario.recovery_options` (list[RecoveryOption]), applied by `tick_engine` via `driver_signals.apply_rest_recovery`. The trigger package never reduces signals. Verified.
- MotionState 2-field sync on any World mutation (both `control_inputs.motion_state` and `situation.motion_state`).
- Determinism governed by the trigger run_seed. TDD, DRY, YAGNI, frequent commits, branch `020-merged-simulator` (continue on it).

## Key current shapes (from signature extraction — use verbatim)

- `ActivityRecovery` (profile.py:70): `{drowsiness: float=0.0, fatigue: float=0.0}`, `extra="forbid"`, `@field_validator` non-negative. On `DriverSignalParams.recovery_model: dict[str, ActivityRecovery]`, keyed by a stage's `content`.
- `RecoveryStage` (scenario.py:101): `{phase:str, content:str, motion:Literal["MOVING","STOPPED"], ticks:int|None=None}`, `extra="allow"`. `RecoveryOption`: `{id, label:dict, stages:list[RecoveryStage], postpone:bool=False}`.
- `apply_rest_recovery(params: DriverSignalParams, current: DriverState, activity: str) -> DriverState` (driver_signals.py:136) — flat subtract once.
- tick_engine recovery block (tick_engine.py:240-306): MOVING stage → zero recovery, held until `at_spot`; STOPPED stage → holds position, applies `apply_rest_recovery` once on entry (`_is_activity_entry = stage_ticks_remaining == (stage.ticks or 0)`), keyed by `stage.content`; surfaces `recoveryPhase` into `signals["dynamic"]`.
- Trigger `POST /api/runs/{id}/actions` body `ActionBody{action:str, recovery_option_id:str|None, rest_spot:RestSpot|None}`; `action="accept_rest"` with a valid option+spot → `run_state.recovery = start_recovery(option, rest_spot)`, status→playing. `run_manager.action(run_id, action, recovery_option_id, rest_spot)`.
- Proposal journey: `apply_journey_action(run_id, JourneyAction{action_type, payload})` (importable inline handler). `rest_spot_arrived` (purpose must be rest_recommended) → during_rest_stopped+stopped; `rest_started` (needs during_rest_stopped); `rest_completed` (needs during_rest_stopped + payload.post_rest) → after_rest_before_restart. Then `recompute_proposal_run(run_id, RecomputeRequest{overrides:[FieldOverride{path,value}]})` re-ranks the 5 after-rest services `[live_viewing, stretch_video, full_karaoke, oshi_reexperience, call_response_stopped]`. Recompute uses the run's current `journey_state.lifecycle_stage`; it 422s if `playback_state ∈ {active,backgrounded}` (must `complete`/`stop` content first) or if row empty.
- Slice-1 merged handle: `MergedRunHandle{merged_run_id, trigger_run_id, world_template, service_package_id, content_package_id, proposal_mode, run_seed, proposal_run_ids, current_proposal_run_id, correlation_log}`. Tick endpoint returns `MergedTickResponse{trigger, proposal, correlation}`.

---

## Task 1: Enrich `ActivityRecovery` + `apply_rest_recovery` (duration/rate-scaled, additive)

**Files:** Modify `app/api/aica_api/models/profile.py` (ActivityRecovery); Modify `app/api/aica_api/services/behavior/driver_signals.py`; Test `app/api/tests/test_enriched_recovery.py`.

**Interfaces (produce):** Add opt-in fields to `ActivityRecovery`:
```python
class ActivityRecovery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    drowsiness: float = 0.0            # flat amount (legacy, fixed-once) — unchanged default
    fatigue: float = 0.0
    drowsiness_per_min: float = 0.0    # NEW opt-in rate (per stopped/moving minute)
    fatigue_per_min: float = 0.0       # NEW
    cap_drowsiness: float | None = None  # NEW optional saturation cap on the accrued rate portion
    cap_fatigue: float | None = None
    # non-neg validators on all four amount/rate fields
```
Add a rate function (keep `apply_rest_recovery` unchanged for back-compat):
```python
def apply_rest_recovery_minutes(params: DriverSignalParams, current: DriverState, activity: str, minutes: float) -> DriverState:
    """Duration-scaled recovery for a STOPPED activity of `minutes` length.
    recovery = flat_amount + min(cap, per_min * minutes) with diminishing return not required (linear+cap).
    If only flat fields set -> equals flat amount once (independent of minutes)."""
def apply_rest_recovery_rate(params: DriverSignalParams, current: DriverState, activity: str, tick_minutes: float) -> DriverState:
    """Per-tick accrual for a MOVING/en-route activity: subtract per_min*tick_minutes each call (capped over the accrual)."""
```

- [ ] Step 1: failing tests — (a) `apply_rest_recovery_minutes` with only flat fields recovers the flat amount regardless of minutes (back-compat); (b) with `drowsiness_per_min=1.0, minutes=20` recovers ~20 (capped by `cap_drowsiness` if set); (c) `apply_rest_recovery_rate` subtracts `per_min*tick_minutes` per call and never goes below 0; (d) unknown activity recovers nothing.
- [ ] Step 2: run `cd app/api && .venv/bin/pytest tests/test_enriched_recovery.py -q` → FAIL.
- [ ] Step 3: implement the model fields + two functions (reuse `_clamp`).
- [ ] Step 4: run → PASS; run `tests/` recovery-adjacent (`.venv/bin/pytest tests/ -k recovery -q`) → green.
- [ ] Step 5: commit `feat(merged): slice2 enriched recovery model (duration/rate scaled, additive)`.

**Acceptance:** flat-only recovery is byte-identical to before; per-min fields scale by duration/rate with optional cap.

---

## Task 2: tick_engine applies enriched recovery (en-route MOVING rate + STOPPED duration-scaled)

**Files:** Modify `app/api/aica_api/services/tick_engine.py` (the recovery block ~240-306); Test `app/api/tests/test_tick_engine_enriched_recovery.py`.

**Behavior:** In the recovery block:
- **STOPPED stage:** if the stage's `recovery_model[content]` has any `*_per_min` set, use `apply_rest_recovery_minutes(..., minutes = (stage.ticks * tick_seconds)/60)` **once on activity entry** (duration-scaled). Else keep today's fixed-once `apply_rest_recovery` (flat). Detection stays the existing `_is_activity_entry`.
- **MOVING content stage (NEW):** a stage with `motion=="MOVING"` and `phase=="content"` (or `content != "wakefulness"`) accrues `apply_rest_recovery_rate(..., tick_minutes = tick_seconds/60)` **every moving tick** while en route to the spot → total ∝ time-until-spot, capped. (Today MOVING stages get zero recovery — this is additive; a plain wakefulness MOVING stage with no rate fields still recovers nothing.)

- [ ] Step 1: failing tests via `advance_tick` (or the engine entrypoint): (a) a scenario recovery option with a STOPPED nap stage keyed to a `recovery_model` entry using `drowsiness_per_min` recovers more with larger `stage.ticks` (duration-scaled); (b) a MOVING content stage with `drowsiness_per_min` recovers a small amount that grows with more moving ticks before arrival; (c) a legacy flat-only option recovers exactly the flat amount once (unchanged). Build minimal ScenarioDef fixtures.
- [ ] Step 2: run → FAIL.
- [ ] Step 3: implement (import the Task-1 functions; branch on whether the activity's recovery entry has per-min fields).
- [ ] Step 4: run → PASS; run full backend suite `.venv/bin/pytest -q` → no regression (2293+).
- [ ] Step 5: commit `feat(merged): slice2 tick-engine enriched recovery application`.

**Acceptance:** longer sleep → more recovery; en-route content gives small time-scaled recovery; existing scenarios unchanged (full suite green).

---

## Task 3: Merged orchestrator — rest-journey auto-drive

**Files:** Modify `app/api/aica_api/routers/merged_runs.py`; Modify `app/api/aica_api/models/merged_run.py` (handle: track journey progress + accept-rest inputs); maybe `app/api/aica_api/services/merged_adapter.py` (a `post_rest_overrides` helper); Test `app/api/tests/test_merged_rest_journey.py`.

**Interfaces:**
- `POST /api/merged-runs/{id}/accept-rest` body `{recovery_option_id: str, rest_spot: RestSpot, nap_minutes: int | None}` → calls trigger `run_manager.action(trigger_run_id, "accept_rest", recovery_option_id, rest_spot)` (starting the trigger recovery; if `nap_minutes` given, the merged layer overrides the chosen option's nap STOPPED stage `ticks = round(nap_minutes*60/tick_seconds)` on a per-run copy — record on the handle so tick derivation matches). Returns the trigger state. Set `handle.rest_stage_synced = "before"`.
- Extend `POST /api/merged-runs/{id}/tick`: after ticking the trigger, inspect `outcome.tick_state` dynamic signals for recovery transitions and drive the proposal journey **once per transition** (guarded by `handle.rest_stage_synced`):
  - motion just became `stopped` (recovery reached spot) and stage not yet `arrived` → `apply_journey_action(current_proposal_run_id, JourneyAction(action_type="rest_spot_arrived"))` then `rest_started`; set `rest_stage_synced="during"`.
  - trigger recovery just went active→inactive (recovery complete) and stage `during` → read computed post-rest `drowsiness`/`fatigue` from tick_state.simulated → `apply_journey_action(..., "rest_completed", payload={"post_rest": {"drowsiness_level": round(drows), "fatigue_level": round(fatig)}})`, then (once content playback is idle) `recompute_proposal_run(run_id, RecomputeRequest(overrides=[{path:"situation.drowsiness_level", value:...},{path:"situation.fatigue_level", value:...}]))` → after-rest ranked proposal; set `rest_stage_synced="after"`; append correlation entry; set `resp.proposal` to the updated log.
- Add handle fields: `rest_stage_synced: str | None = None` (None|before|during|after), `nap_minutes: int | None = None`, and (if needed) the per-run recovery-option override.

- [ ] Step 1: failing integration test `test_merged_rest_journey.py` (TestClient): create a merged run on a rest scenario with recovery_options; tick to REST fire (before-rest proposal); `POST accept-rest` with the scenario's option + a rest_spot + nap_minutes; keep ticking; assert across the ticks that the proposal log advances `lifecycle_stage` before→during_rest_stopped→after_rest_before_restart, that a `RECOMPUTED`/`OPPORTUNITY_OPENED` + `SERVICE_SELECTED`(after-rest, from the 5 stopped services) appears, and that the after-rest world drowsiness reflects the recovery (lower than at fire). Assert only ONE proposal run id used throughout.
- [ ] Step 2: run → FAIL.
- [ ] Step 3: implement. Reuse `apply_journey_action`/`recompute_proposal_run`/`run_manager.action` (eligibility runs inside recompute). Handle the recompute 422-if-not-idle guard by ensuring any active before-rest content is completed/stopped first (issue `complete`/`stop` journey action if playback active) — or document that slice-2 auto-completes before-rest content on rest acceptance.
- [ ] Step 4: run → PASS; full backend suite green.
- [ ] Step 5: commit `feat(merged): slice2 orchestrator rest-journey auto-drive`.

**Acceptance:** a single merged run drives before→during→after rest in one proposal run, with the after-rest proposal reflecting the enriched recovery; existing behavior untouched.

---

## Task 4: Frontend — accept-rest UI (recovery option + sleep-minutes) + auto-drive through Play

**Files:** Modify `app/frontend/src/api/mergedClient.ts` (add `acceptRest`); Modify `app/frontend/src/state/mergedCoordinator.tsx` (acceptRest action; tick loop already surfaces the advancing proposalLog); Modify `app/frontend/src/components/merged/MergedCenterPanel.tsx` (a rest-accept affordance when the before-rest proposal offers rest: RecoveryOption select + sleep-minutes number input + Accept-rest button; after-rest proposal renders in the same dock once the journey advances); Test `app/frontend/tests/merged_rest_journey.test.tsx`.

**Interfaces:** `acceptRest(mergedRunId, { recovery_option_id, rest_spot, nap_minutes })` → the trigger state; coordinator stores it and continues Play. The center panel reads recovery options from the scenario (reuse `getScenario`/`getRestSpots` clients as `RecoveryPicker` does) and rest spots.

- [ ] Step 1: failing test (mock clients): given a coordinator state with a before-rest proposalLog + a chosen service, render the rest-accept controls; select option + set minutes + click Accept-rest → assert `acceptRest` called with those args; then feed a coordinator state whose proposalLog has advanced to after_rest_before_restart → assert the after-rest service overlay renders.
- [ ] Step 2: run `cd app/frontend && npx vitest run merged_rest_journey` → FAIL.
- [ ] Step 3: implement; reuse existing scenario/rest-spot clients + the sleep-minutes numeric input.
- [ ] Step 4: run focused test + `npx tsc --noEmit` (no new merged errors); full `npx vitest run` green.
- [ ] Step 5: commit `feat(merged): slice2 accept-rest UI + sleep-minutes, journey auto-drive`.

**Acceptance:** user accepts rest (option + minutes) in the center panel; Play walks the journey; the after-rest proposal appears in the dock.

---

## Task 5: Frontend — merged log surfaces rest-journey + recovery-phase events

**Files:** Modify `app/frontend/src/components/merged/MergedLogPanel.tsx`; Test extend `app/frontend/tests/merged_log.test.tsx`.

**Behavior:** The proposal-event rows already union in (Slice 1). Add: render `REST_SPOT_ARRIVED`/`REST_STARTED`/`REST_COMPLETED`/`RECOMPUTED` proposal events with clear labels, and surface the trigger's `recovery_phase` on trigger trace rows during recovery (the TraceEntry already carries `recovery_phase`). Keep the purple/blue subsystem convention.

- [ ] Step 1: failing test: a coordinator state whose proposalLog.events include the rest-journey events + trigger trace entries with `recovery_phase` set → assert the log renders labeled rest rows and shows recovery phase on the relevant trigger rows, in tick order.
- [ ] Step 2: run → FAIL.
- [ ] Step 3: implement.
- [ ] Step 4: run focused + full vitest green.
- [ ] Step 5: commit `feat(merged): slice2 merged log rest-journey + recovery phases`.

**Acceptance:** the merged log tells the rest-journey story (arrive → nap → recover → after-rest proposal) across both subsystems.

---

## Task 6: End-to-end verification

- [ ] Step 1: backend full suite green; frontend full suite green + `vite build` clean.
- [ ] Step 2: live integration — via the backend integration test (Task 3) confirm the full chain; note the browser walkthrough remains a manual user step.
- [ ] Step 3: update design doc §12 Slice-2 status (core done; painter/quickview/replay pending); update ledger.
- [ ] Step 4: commit `chore(merged): slice2-core e2e verification`.

## Self-Review
- Coverage: enriched recovery (design §8) → T1,T2; full rest journey (§7.2) → T3,T4; merged log (§10 rest) → T5. Deferred to Slice-2b: route-conditions painter (§5), quickview projection (§7.1), correlation replay. Monotony (§6) = Slice 3.
- Types: `apply_rest_recovery_minutes`/`apply_rest_recovery_rate` (T1) used T2; `accept-rest` endpoint + handle `rest_stage_synced` (T3) used T4; journey events (T3) surfaced T5.
- No placeholders; every task real files + real interfaces from signature extraction + concrete tests.
