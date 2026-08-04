# Recovery Mode — How It Works

> How the AICA Hypothesis Simulator models what happens **after** the driver
> answers a proposal: accepting a recovery option, driving toward a rest spot,
> arriving, resting, and resuming. Covers both the **rest proposal** and the
> **monotony proposal**, and how each trigger algorithm (NRI, Hybrid) responds
> across the recovery window.

This document describes the code as it stands in:

- `app/api/aica_api/services/recovery.py` — the pure recovery **state machine**
- `app/api/aica_api/services/tick_engine.py` — the per-tick **motion / distance / recovery application** (lines ~242–371)
- `app/api/aica_api/models/scenario.py` — `RecoveryStage` / `RecoveryOption` schema
- `packages/nri_fatigue_score_v1/algorithm.py` — NRI algorithm's recovery handling
- `packages/aica_transparent_hybrid_trigger_v1/algorithm.py` — Hybrid algorithm's recovery handling

The backend is the **source of truth**; the frontend/htmlapp only renders what
the backend (or its faithful htmlapp port) computes.

---

## 1. Vocabulary

| Term | Meaning |
|---|---|
| **Recovery option** | A named, ordered list of **stages** the driver picks when accepting a proposal (e.g. `nap_karaoke`, `convenience_stretch`). Defined per scenario under `recovery_options`. |
| **Stage** | One step of an option. Has a `phase` (`wakefulness` / `nap` / `content`), a `content` (`audio_karaoke` / `sleep` / `stretch` / …), a `motion` (`MOVING` or `STOPPED`), and optional `ticks` (dwell length; `None` = "until the rest spot"). |
| **Rest spot** | A point on the route (`route_fraction` ∈ [0,1]) the driver heads to when a stage is `MOVING` toward it. |
| **`RecoveryState`** | The live cursor through an option: `active`, `phase`, `stage_index`, `stage_ticks_remaining`, plus MOVING-recovery accruals. |
| **`recovery_active`** | True for the **entire** window from acceptance until the driver resumes. While true, firing is suppressed and exposure accumulators are frozen. |
| **`motion_state`** | Simulator-owned per tick: `MOVING` (driving, including en route to the spot) or `STOPPED` (dwelling at the spot). |

### Two `motion` kinds, two recovery mechanics

- **`MOVING` stage** — the car keeps driving. Recovery is applied **only** if the
  stage explicitly opts in with `grants_moving_recovery: true` (rate-based,
  per-tick, aggregate-capped). A plain `wakefulness` MOVING stage recovers
  **nothing** — it exists to hold the "on the way to the spot" phase.
- **`STOPPED` stage** — the car holds position at the rest spot. Recovery is
  applied **once, on entry** to the stage (flat, or duration-scaled if the
  recovery model has `*_per_min` fields).

---

## 2. A concrete option (from `uc01_fatigue_recovery_v0_1`)

```jsonc
{
  "id": "nap_karaoke",
  "stages": [
    { "phase": "wakefulness", "content": "audio_karaoke", "motion": "MOVING"            },  // drive to the spot
    { "phase": "nap",         "content": "sleep",         "motion": "STOPPED", "ticks": 3 }, // nap at the spot
    { "phase": "content",     "content": "audio_karaoke", "motion": "STOPPED", "ticks": 3 }  // karaoke at the spot
  ]
}
```

Read this as a timeline: **drive to the rest spot → nap 3 ticks → karaoke 3
ticks → resume.** A simpler option (`convenience_stretch`) is
`wakefulness/MOVING → stretch/content/STOPPED (2 ticks) → resume`. A `postpone`
option has `postpone: true` and **no stages** (nothing to drive; the proposal is
simply deferred).

---

## 3. The recovery state machine (`recovery.py`)

Pure, no I/O. One `advance_recovery` call per tick moves the cursor forward.

### 3.1 `start_recovery(option, rest_spot)`

Called the moment the driver **accepts**. It seeds the cursor at the first stage:

```python
RecoveryState(
    active=True,
    option_id=option.id,
    phase=first.phase,               # e.g. "wakefulness"
    stage_index=0,
    stage_ticks_remaining=first.ticks,   # None for a "until-the-spot" MOVING stage
    rest_spot=rest_spot,
)
```

### 3.2 `advance_recovery(state, option, *, at_rest_spot)` — one tick

```python
if state.phase == "resuming":
    return state.model_copy(update={"active": False, "phase": None})   # recovery ends

stage = current_stage(state, option)
if stage is None:                                    # ran off the end of the stage list
    return state.model_copy(update={"phase": "resuming", "stage_ticks_remaining": 0})

if stage.motion == "MOVING":
    if not at_rest_spot:
        return state                                 # keep driving toward the spot
    return _enter_stage(state, option, state.stage_index + 1)   # arrived → next stage

# STOPPED stage: count down the dwell
remaining = state.stage_ticks_remaining - 1
if remaining > 0:
    return state.model_copy(update={"stage_ticks_remaining": remaining})
return _enter_stage(state, option, state.stage_index + 1)       # dwell done → next stage
```

Key behaviors:

- A **MOVING** stage does **not** count down ticks. It persists tick after tick
  **until the car reaches the rest spot** (`at_rest_spot` becomes true), then
  advances. This is why `ticks` is `None` for the drive-to-spot `wakefulness`
  stage — its length is "however long the drive takes."
- A **STOPPED** stage counts `stage_ticks_remaining` down by one each tick; when
  it hits zero it advances to the next stage.
- When the cursor advances **past the last stage**, the phase becomes
  `"resuming"`; on the **next** tick that flips `active=False` and recovery ends.
- `_enter_stage` resets this stage's `moving_recovery_accrued_drowsiness/_fatigue`
  to `0.0`, so each MOVING stage's aggregate recovery cap is per-stage.

---

## 4. The tick-engine override (`tick_engine.py` ~242–261)

Each tick, after computing the tentative new distance, the engine consults
recovery to decide motion and whether to hold at the spot:

```python
motion_state = "MOVING"
recovery_phase = None
if recovery is not None and recovery.active:
    option = <the option matching recovery.option_id>
    stage  = current_stage(recovery, option)
    spot_frac = recovery.rest_spot.route_fraction if recovery.rest_spot else 1.0
    at_spot   = new_distance_km / total_km >= spot_frac
    if stage is not None and stage.motion == "STOPPED":
        # Hold position at the rest spot; do not advance distance.
        new_distance_km = spot_frac * total_km
        route_fraction  = spot_frac
        completed       = False
        motion_state    = "STOPPED"
    recovery_phase = recovery.phase
    recovery_next  = advance_recovery(recovery, option, at_rest_spot=at_spot)
```

- During a **MOVING** stage, the engine leaves distance alone — the car advances
  normally down the route toward `spot_frac`. `at_spot` becomes true once the
  car's fraction reaches the rest spot's fraction.
- During a **STOPPED** stage, the engine **pins** distance to the rest spot
  (`new_distance_km = spot_frac * total_km`) and forces `motion_state="STOPPED"`.
  The car does not move and the run is **not** marked complete while dwelling.

### 4.1 Applying a stage's recovery (`tick_engine.py` ~321–371)

- **STOPPED stage — once on entry.** The "first dwell tick" is detected as
  `recovery.stage_ticks_remaining == stage.ticks` (advance_recovery decrements
  from this tick onward). On that tick only:
  - if the `recovery_model` entry for the stage's `content` has any `*_per_min`
    field > 0 → **enriched**: recovery is duration-scaled over the whole dwell
    (`apply_rest_recovery_minutes`, minutes = `ticks * tick_seconds / 60`);
  - otherwise → legacy **flat** once-off amount (`apply_rest_recovery`).
- **MOVING stage with `grants_moving_recovery: true`** — **rate-based every
  moving tick**, using `apply_rest_recovery_rate_capped` so the total across the
  stage is aggregate-capped (the per-call cap alone would let the total grow
  unbounded over many ticks). The accrued-so-far totals are threaded on
  `recovery_next`, but only while it's still the **same** stage (a transition
  already reset the new stage's accrual to 0 in `_enter_stage`).
- A plain `wakefulness` MOVING stage (no opt-in) recovers **nothing** — by
  design; it only marks the drive-to-spot phase.

### 4.2 Monotony proxy signal (`tick_engine.py` ~263–276)

Independent of any package's internal state, the engine derives a 0–100
`monotony_level`: it **accrues** while driving a monotonous segment
(highway / normal_road) `MOVING`, **decays at 2×** otherwise, and adds a flat
`+20` at night. Because a STOPPED stage forces `motion_state="STOPPED"`, this
proxy **decays throughout the dwell** — resting mechanically bleeds off the
simulator's monotony proxy.

---

## 5. Rest proposal — full sequence (accept → drive → arrive → rest → resume)

This is the flagship UC-01 flow. The proposal says "rest at a nearby facility";
its options include `accept_rest`.

1. **Fire.** The algorithm emits a `REST_PROPOSAL`. Fire-control gates it on a
   reachable rest spot (`actionability_guard: rest_spot_reachable`).
2. **Accept.** The driver picks a recovery option (e.g. `nap_karaoke`).
   `start_recovery(option, spot)` runs. `recovery_active` becomes true and stays
   true for the whole remaining sequence.
3. **Drive to the spot** (stage 0, `wakefulness / MOVING`). The car keeps moving
   down the route. `advance_recovery` returns the same state every tick until
   `at_rest_spot` is true. No recovery is applied (plain wakefulness). Firing is
   suppressed the entire time.
4. **Arrive.** When the car's fraction reaches the rest spot's fraction,
   `at_rest_spot` flips true and the cursor advances to stage 1.
5. **Rest at the spot** (STOPPED stages, e.g. `nap` 3 ticks, then `content` 3
   ticks). The engine pins the car at the spot (`motion_state="STOPPED"`), the
   run is not completed, and each STOPPED stage applies its recovery **once on
   entry**. Drowsiness/fatigue drop.
6. **Resume.** When the last stage's dwell completes, phase → `"resuming"`, then
   the next tick sets `active=False`. `recovery_active` goes false; normal
   driving and normal firing resume. The next proposal can fire once the signals
   rebuild.

---

## 6. Monotony proposal — how it differs

The monotony proposal ("monotonous driving detected; consider a break or
refreshing content") is about **content relief, not a physical rest**. Its
options are `acknowledge` / `decline` — there is no `accept_rest`, so **no
drive-to-spot and no STOPPED dwell** are involved in the pure-monotony case. The
driver keeps driving.

What relieves monotony instead is **rebaselining the monotony exposure when the
proposal is served** (acknowledged or declined). This is a content duty cycle:
answering the proposal drops the monotony score, which then rebuilds over
continued monotonous driving so a later monotony proposal can fire again. Both
algorithms implement this (see §7), guarded so a single served proposal
rebaselines **once** (not every tick while `lastProposal*` still points at it).

> Note: if a scenario's monotony situation is answered by **accepting a rest**
> (some combined scenarios offer recovery options on the monotony channel), then
> the §5 drive→arrive→rest→resume sequence applies exactly as above — the
> distinction is the *option chosen*, not the proposal label.

---

## 7. How each algorithm responds through the recovery window

Both algorithms receive `recovery_active` (and NRI additionally `recoveryPhase`)
from the adapter, and both **suppress firing** while recovery is active. They
differ in how they treat the exposure they've accumulated.

### 7.1 NRI (`nri_fatigue_score_v1`) — **freeze, then reset at resume**

NRI's score is **unbounded** and **exposure-dominated** (cumulative minutes of
jam / highway / monotony / driving-since-rest). Its recovery handling:

- `recovery_phase = dynamic.get("recoveryPhase")`; `recovery_active = recovery_phase is not None`.
- `recovered = recovery_active` → **unconditionally suppresses firing** for the
  whole window.
- **Freeze during recovery:** `accrue = is_moving and not recovery_active`. While
  recovery is active, the four accumulators (`cumulative_jam_min`,
  `cumulative_highway_min`, `cumulative_monotonous_min`, `driving_min_since_rest`)
  do **not** grow — even during the MOVING drive-to-spot phase.
- **Reset at resume:** `recovery_just_completed = was_in_recovery and not recovery_active`.
  On the single tick recovery ends, all four accumulators reset to `0.0`. This is
  what makes a rest actually pay off in NRI's unbounded world — otherwise the
  score would resume exactly where it left off. `was_in_recovery` is threaded
  forward as `recovery_active` of the current tick.
- **Monotony relief:** when NRI's **own** monotony proposal is served, it relieves
  only `cumulative_monotonous_min` (not jam/highway), guarded by
  `mono_intervention_handled_sec` so it happens once per intervention.

### 7.2 Hybrid (`aica_transparent_hybrid_trigger_v1`) — **continuous rebaseline + clamp**

Hybrid's score is **clamped to [0,1]** and **drowsiness-dominated**. It never
resets to zero; instead it keeps a moving **baseline** it measures exposure
against:

- `recovery_active = bool(context.get("recovery_active"))`.
- **Time-on-task rebaseline:** while `recovery_active`, `drive_min_baseline` is
  pinned to the current `continuousDrivingMin`, so `drive_min_since_rest` drops
  to ~0 right after a rest (the engine never resets `continuousDrivingMin`, so
  Hybrid keeps its own baseline).
- **Env/monotony rebaseline on rest:** while `recovery_active`, `accum_baseline`
  for `jam_min` / `hw_min` / `mono_min` is set to the current cumulative totals,
  so `env_load` and `monotony` fall to ~0 and rebuild afterward (a rest relieves
  monotony; without this, monotony would saturate and never fall).
- **Monotony rebaseline on a served monotony proposal:** a served
  `monotony_prevention` proposal rebaselines **only** `mono_min` (content does
  not clear a jam or un-drive the highway), once per intervention, tracked via
  `mono_intervention_handled_sec`. This gives the monotony channel a real duty
  cycle instead of pinning above threshold forever.
- **Firing suppression via `rest_recovered`:** `rest_recovered` is true only
  while `recovery_active` **and** the last answered proposal was `accept_rest`
  (category rest/none). It's scoped to the active rest sequence so it doesn't
  latch forever — once the driver resumes, it clears and a fresh rest proposal
  can fire when drowsiness rebuilds.

### 7.3 Side-by-side

| | **NRI** | **Hybrid** |
|---|---|---|
| Score shape | Unbounded, exposure-dominated | Clamped [0,1], drowsiness-dominated |
| During recovery | **Freezes** accumulators | **Rebaselines** exposure to current totals |
| At resume | **Resets** accumulators to 0 | Baseline already moved; score rebuilds from ~0 |
| Firing while recovering | Suppressed via `recovered = recovery_active` | Suppressed via `rest_recovered` (accept-rest scoped) |
| Monotony relief | Relieve `cumulative_monotonous_min` on served monotony proposal | Rebaseline `mono_min` on served monotony proposal |
| Drive-to-spot (MOVING wakefulness) | Frozen, no accrual, no fire | Rebaselined continuously, no fire |

---

## 8. One-line summary

> **Accepting a proposal starts a `RecoveryState` that walks an option's ordered
> stages, one `advance_recovery` per tick: a `MOVING` `wakefulness` stage drives
> the car to the rest spot (recovering nothing unless it opts in), then `STOPPED`
> stages pin the car at the spot and apply recovery once each on entry, then the
> cursor runs off the end into `"resuming"` and recovery ends. Throughout the
> window firing is suppressed; NRI freezes its exposure accumulators and resets
> them to zero at resume, while Hybrid continuously rebaselines its exposure so
> its clamped score falls and rebuilds. A monotony proposal instead keeps the
> car driving and relieves only the monotony exposure when the proposal is
> served.**
