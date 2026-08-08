# Recovery Semantics Refactor — Design

**Date:** 2026-08-08
**Branch:** `fixbug-0806`
**Scope:** backend + frontend (`app/`). The `htmlapp/` port is a follow-up after owner review.

---

## 1. Problem

The simulator has two unrelated things both called "recovery", and they were never
distinguished:

| | Mechanism | Effect |
|---|---|---|
| **A** | `RecoveryState` state machine, started only by `accept_rest` | Physical: motion, position, drowsiness/fatigue, and the `recovery_active` window |
| **B** | `proposal_history` bookkeeping on any answered proposal | Algorithm-internal exposure baselines + fire suppression. **No physical effect.** |

Consequences observable today:

1. **The inattentive trigger has nothing to recover.** Accepting content moves only a
   hidden internal number — Hybrid sets `accum_baseline["mono_min"] = mono_min`, NRI sets
   `cumulative_monotonous_min = 0.0`. Nothing visible changes, and hours of accumulated
   exposure are erased in a single tick.
2. **The two algorithms react in different shapes to the same event.** NRI freezes four
   accumulators for the whole recovery window then resets them at resume; Hybrid
   re-pins three baselines every tick. Same driver, same event, two different curves —
   which defeats the comparison the simulator exists to support.
3. **The score lies during the drive to the rest spot.** NRI freezes exposure from the
   acceptance tick, so the curve is flat while the driver is still genuinely driving and
   still accumulating risk.
4. **En-route recovery is dead code.** `RecoveryStage.grants_moving_recovery` +
   `apply_rest_recovery_rate_capped` exist, but no scenario sets the flag, so the
   drive-to-spot stage recovers nothing.
5. **Rest recovery is a step, not a curve.** A 30-minute nap is one instantaneous −60
   jump on the entry tick, then flat.

The root cause is not a set of small bugs. It is that "the driver got better" and
"AICA already asked, don't nag" were fused into one concept.

---

## 2. Spec grounding (CDC-SU_specplan.md)

The refactor is not invented; it follows the customer's own specification.

| Slide | Content | Bearing |
|---|---|---|
| **35** 提案分類 | Class ① 危険運転防止向け提案 has three purposes: 休憩提案による疲労回復 / **休憩場所到着までの覚醒** / 休憩場所でのリフレッシュ. Class ② 漫然運転予防・疲労回復向け提案 fires when 直ちに休憩は不要だが…漫然運転発生の懸念がある | The three recoveries are named in the spec |
| **31** 特徴量 | The inattention feature group is **刺激がない状態の継続** — *continuation of a state with no stimulus* (単調な道 / 長いトンネル / 夜間 / 慣れている道) | Content is stimulus → the continuation is interrupted. **Freeze**, not erase |
| **17** 注意力低下UC | 50s persona, familiar road home, 帰宅後の家事の段取りで頭がいっぱい、無意識気味. Aim: 運転への意識を維持させる / 車内への意識を取り戻させる | The inattentive driver is **not** sleepy and **not** tired |
| **46** 合いの手練習UC ※要休憩 | ③ 休憩所に目的地設定してナビ開始。**休憩所までの間の覚醒支援のコンテンツ**を複数案提示 → ⑤ **選択コンテンツを開始し、休憩所に到着したら終了** | En-route content exists, and its episode ends **at arrival** |
| **38** コンテンツ分類 | 走行中コンテンツ = 疲労回復・覚醒をサポート during 休憩所に着くまでの間. 停車中コンテンツ = 休憩所でのリフレッシュやご褒美 | Stopped content is a reward, not a countermeasure |
| **81** 終了条件 | 走行中: 一定曲数再生完了 / 1セット完了. 停車中: 1曲(1本)再生完了. Header reads 終了条件（**手動停止以外**） | Content episodes have a finite natural duration |
| **33** チューニング | Tuning targets include **回復率** — 「提案状況ごとに疲労度・眠気の回復率を分析」 | Recovery is a **rate**, tuned **per 提案状況** — not a step, not per-content-alone |
| **34** 発火制御 | 提案間隔 + 単位時間あたり提案回数, tuned by 利用/離脱/無視/拒否; no control when しきい値の大幅超過 or fast rate of rise | Fire-control is a separate concern from recovery (P1). §9 brings the first two into conformance |

---

## 3. Principles

> **P1 — Suppression is not recovery.** Fire-control owns *don't nag*. The recovery model
> owns *the driver changed*. After the split, every score movement the customer sees is a
> real change in the driver.

> **P2 — Each trigger recovers what it is about.** Inattentive restores focus and never
> repays sleep debt. Pre-rest holds drowsiness at bay en route and never resets
> time-on-task. Rest restores physiology and resets exposure.

> **P3 — Freeze, don't erase.** The spec's quantity is 刺激がない状態の継続, a
> *continuation*. Stimulus interrupts it; stimulus does not undo the hours already driven.

> **P4 — One shape.** Every recovery in the system is applied **per tick, with an
> aggregate cap**. No one-shot steps anywhere.
>
> *Precision, added after implementation:* this is one *shape*, not literally one
> function. Three functions in `driver_signals.py` implement it — `apply_stage_recovery_tick`
> (STOPPED dwell), `apply_rest_recovery_rate_capped` (MOVING content), and
> `apply_stimulus_relief` (accumulator drain) — because they cap against different things:
> the dwell divides a pre-known legacy total evenly so calibration is preserved exactly,
> while content relief runs open-ended until the episode completes. Collapsing them into one
> function would mean parameterising away that difference, not removing it. The invariant
> that matters — no recovery is ever applied as a single instantaneous step — holds
> everywhere.

> **P5 — Both algorithms react identically to the same event.** Any remaining difference
> in the curves must come from the algorithms' own scoring math, never from two different
> recovery implementations.

---

## 4. Architecture

**Two mechanisms, split by motion — not by trigger.**

| | Driven by | Applies | Covers |
|---|---|---|---|
| **Driving-content recovery** | `contentActive` + the `(content, purpose)` effect entry | per tick, **MOVING only** | cases 1 & 2 |
| **Rest-activity recovery** | `RecoveryState` STOPPED stage + `recovery_model` | per tick, across the dwell | case 3 |

Case 4 (post-rest) is not a mechanism — it is the resume edge where exposure resets.

Because driving-content recovery is MOVING-only, 停車中コンテンツ played at the rest spot
has no recovery effect, which is exactly what slide 38 says it is (ご褒美).

### `contentActive`

Derived from the proposal side's `journey_state.playback_state`:

```
active | backgrounded   -> contentActive = true
completed | stopped     -> contentActive = false
```

Threaded into `context.signals.dynamic.contentActive` by the merged adapter. It is
**orthogonal to `recovery_active`**, which keeps its exact current meaning (a rest
sequence is in progress). Keeping them independent is deliberate: if content playback
set `recovery_active`, NRI's `recovered = recovery_active` would suppress the *rest*
channel too — a regression, and fire-control is out of scope for this refactor.

### Episode termination

A content episode ends on the first of:

1. **Natural completion** — elapsed ≥ `CompletePlan.expected_duration_sec` (already exists,
   `models/proposal/content_output.py:209`). The engine emits `complete`.
2. **Arrival at the rest spot** — `rest_spot_arrived`, for en-route content (slide 46 ⑤).

There is **no manual stop button** (owner decision) and no play button — content starts on
acceptance, as the spec has no separate play step.

---

## 5. Data model

### `recovery_model` — two namespaces, one per mechanism

```jsonc
// (1) DRIVING CONTENT — keyed "<service_id>@<purpose>", explicit per pair
"humming_karaoke@monotony": {
  "drowsiness_per_min": 0.0,          // ~0: the effect is growth-suppression, not subtraction
  "fatigue_per_min":    0.0,
  "stimulus_relief_per_min": 1.2,
  "cap_stimulus": 20
},
"humming_karaoke@pre_rest": {
  "drowsiness_per_min": -0.4,         // 覚醒支援 — active arousal on top
  "fatigue_per_min":    -0.2,
  "stimulus_relief_per_min": 1.2,
  "cap_drowsiness": 12, "cap_fatigue": 8, "cap_stimulus": 20
},
"quiz@monotony": {
  "drowsiness_per_min": 0.0, "stimulus_relief_per_min": 2.0, "cap_stimulus": 20
},

// (2) REST-STAGE ACTIVITIES — plain key, named by the stage's `content`
"sleep":   { /* existing totals, now applied as a per-tick curve */ },
"stretch": { /* existing totals, now applied as a per-tick curve */ }
```

**Units.** `drowsiness_per_min` / `fatigue_per_min` are 0–100 signal points per minute of
playback (negative = recovery), capped by `cap_drowsiness` / `cap_fatigue` in points
across the episode. `stimulus_relief_per_min` is **accumulator-minutes drained per minute
of playback** (so `1.2` means one minute of content removes 1.2 minutes of accumulated
monotonous exposure), capped by `cap_stimulus` in accumulator-minutes across the episode.
The drained accumulator is floored at 0.

**Purposes:** `monotony` | `pre_rest` | `post_rest`.

**Explicit per pair, no multipliers** (owner decision). A customer reads the exact number
for every reachable combination with no arithmetic.

**A missing `<service>@<purpose>` entry recovers nothing** — same discipline as today's
unknown-activity rule. No silent defaults.

### Matrix size

Not a full 11 × 3 product. Slide 39/40 partitions the catalogue and
`service_capabilities.v1.json` + the P4 eligibility resolver already constrain which
service is reachable in which motion state:

Reachability is `driving_capable or background_on_motion` in
`proposal_contracts/service_capabilities/service_capabilities.v1.json` — a service that can
never play while MOVING needs no entry at all, because driving-content recovery is
MOVING-only. That yields **eight** services: `music_playlist`, `humming_karaoke`,
`call_response_driving`, `quiz`, `ranking_creation`, `radio_style`, `conversation_audio`,
`live_viewing`.

Eight services × three purposes = **24 authored entries per scenario**. The six 停車中-only
services (`stretch_video`, `full_karaoke`, `call_response_stopped`, `oshi_reexperience`,
`relaxation_multisensory`, `linked_video_recommendation`) get none — at the rest spot they
are ご褒美, not countermeasures (slide 38).

This is deliberately a **superset** of what the response matrix actually offers per
lifecycle stage: a few unused entries are cheap, and it guarantees no reachable pair can be
silently missing. A test enumerates the reachable pairs from the capabilities artifact and
asserts each has an entry, so the sparsity is verified rather than accidental.

### Model changes

| Model | Change |
|---|---|
| `ActivityRecovery` (`models/profile.py`) | add `stimulus_relief_per_min`, `cap_stimulus` |
| `RecoveryStage` (`models/scenario.py`) | **delete** `grants_moving_recovery` |
| `ContentReliefState` (`models/run.py`, new) | `{content_key, accrued_drowsiness, accrued_fatigue, accrued_stimulus}`; reset on each false→true `contentActive` edge. Case 1 has no `RecoveryState` to hang the accrual on |

---

## 6. Per-case semantics

### Case 1 — Inattentive / 漫然運転予防 (class ②)

**Starts:** driver picks a service on the monotony proposal → `playback_state = active` →
`contentActive`.

**Per tick while playing and MOVING:**

1. **Suppress** the monotony-sourced drowsiness growth term — `d_monotony`
   (`drowsiness_model.monotony_add_per_min`, `driver_signals.py:98`). The driver is
   engaged, so boredom stops driving drowsiness upward. Base/night/jam growth terms
   continue.
2. **Freeze** the three monotony accumulators (§7).
3. **Drain** them at `stimulus_relief_per_min × minutes`, floored at 0, aggregate-capped
   per episode. This is the "continuation was broken" half of 継続 — partial, because
   three songs must not erase three hours of highway.
4. Apply `drowsiness_per_min` / `fatigue_per_min` — **≈ 0 for `@monotony`**. UC-1's driver
   has almost nothing to recover, and that is correct.

**Ends:** `expected_duration_sec` elapsed. The accumulators resume climbing **from where
they are** — no cliff.

**What the customer sees:** the monotony curve goes **flat, then bends down, then climbs
again**. Today it drops to zero in one tick with no visible cause.

**Emergent, and intended:** in NRI, monotony is frozen but `S_base` time-damage keeps
climbing, so `S_total` keeps rising during the content. Content held the boredom; it did
not stop the clock. Escalation to a rest proposal arrives on its own.

### Case 2 — Pre-rest 覚醒支援 (slide 46 ③④⑤)

**Starts:** `accept_rest` → `RecoveryState` stage 0 (MOVING) → driver picks en-route
content → `contentActive`.

**Per tick:** the *same four steps as case 1*. The difference is step 4 — a `@pre_rest`
entry carries a real negative `drowsiness_per_min`, and that extra term **is** 覚醒支援:
active arousal on top of removing monotony. The two purposes therefore differ in **kind**,
not merely in magnitude.

**Cap sized to hold the line, not fix:** starting calibration ≈ `−0.4 drowsiness/min,
cap 12`. Net visible effect is drowsiness **plateauing or bending slightly down** — never
reaching safe. En-route countermeasures buy margin to reach the stop; they are not a
substitute for it.

**Ends at arrival** (slide 46 ⑤). This is a fix: today the merged tick completes/stops the
pre-rest content at `rest_completed`, after the nap. It moves to `rest_spot_arrived`.

**Exposure keeps accruing.** The driver is still driving. NRI's blanket freeze of all four
accumulators across the whole `recovery_active` window is removed; the score keeps
climbing en route, so arriving at the rest spot is visibly *earned*.

### Case 3 — Rest at the spot

**Same primitive, per tick across the dwell** instead of one instantaneous jump on the
entry tick. Total recovery over the dwell equals what the current duration-scaled model
gives, so existing calibration does not shift — only the shape does.

**Exposure accumulators freeze here.** This is the one place freezing is honest, because
the wheels are stopped.

**What the customer sees:** drowsiness and fatigue **fall as a curve across the nap**,
instead of a −60 step followed by a flat line.

### Case 4 — Resume

The **resume edge**, not a recovery. Both algorithms reset exposure to zero at this one
tick. Hybrid stops re-pinning its baseline every tick of the window and snaps it once,
here, so the two algorithms share one event with one meaning.

Post-rest content is then driving content again once moving, back under the case-1/2 rule
with `@post_rest` numbers.

---

## 7. What freezes, and what does not

The freeze must move in **lockstep across all three** — this is the parity test for P5.

| Quantity | Owner | Feeds |
|---|---|---|
| `monotony_accrued_min` | engine (`tick_engine.py`) | `monotony_level` 0–100, the displayed curve |
| `mono_min` | Hybrid `advance_accumulators` | `monotony` = `clamp(mono_min / saturation_min)` |
| `cumulative_monotonous_min` | NRI | `S_env` term `× w_monotonous` |

Plus the driver-signal term `d_monotony` (§6 case 1 step 1).

**Does NOT freeze:**

- `isNight`, `familiarRoute` — facts, and they stay true. In Hybrid they are raw additive
  terms (`w_night`, `w_familiar`) on the monotony score, so after the freeze the score
  **plateaus at a floor**, it does not fall to zero:

  ```
  monotony_prevention_score = w_night·isNight + w_familiar·familiar
                            + w_env_mono·env_load + w_monotony·(frozen monotony)
  ```

  Singing does not make it stop being night on a road you know by heart.
- NRI's `m_night` / `m_familiar` — they multiply the *time-damage* term, not the monotony
  term, so they are untouched for the same reason.
- `driving_min_since_rest`, `cumulative_highway_min`, `cumulative_jam_min` — content does
  not stop the clock or clear traffic.
- The base / night / jam drowsiness growth terms — only the monotony-sourced term is
  suppressed.

---

## 8. Code changes

| File | Change |
|---|---|
| `models/profile.py` | `ActivityRecovery` gains `stimulus_relief_per_min`, `cap_stimulus` |
| `models/scenario.py` | **delete** `RecoveryStage.grants_moving_recovery` |
| `models/run.py` | new `ContentReliefState` (§5) |
| `services/behavior/driver_signals.py` | keep only `apply_rest_recovery_rate_capped`; **delete** `apply_rest_recovery`, `apply_rest_recovery_minutes`. `advance_driver_state` gains a `suppress_monotony_growth: bool` parameter |
| `services/tick_engine.py` | remove the `grants_moving_recovery` branch; add the `contentActive` branch (MOVING only); STOPPED dwell becomes per-tick instead of one-shot-on-entry; freeze `monotony_accrued_min` while `contentActive`; publish `contentActive` + `stimulusFrozen` into dynamic signals |
| `services/merged_adapter.py`, `routers/merged_runs.py` | derive `contentActive` from `playback_state`; end the episode on `expected_duration_sec`; move pre-rest content `complete`/`stop` from `rest_completed` to `rest_spot_arrived` |
| `packages/aica_transparent_hybrid_trigger_v1/algorithm.py` | `advance_accumulators` skips `mono_min` while `stimulusFrozen`; **delete** the `mono_min` rebaseline and `mono_intervention_handled_sec`; snap `accum_baseline` once at the resume edge |
| `packages/nri_fatigue_score_v1/algorithm.py` | same freeze on `cumulative_monotonous_min`; **delete** relief-to-0 and its guard; narrow the four-accumulator freeze to the STOPPED dwell only |
| `services/run_manager.py` | `_derive_response_suppression`: acknowledge → bounded window (§9.1); add the per-category count cap over a trailing window (§9.2) |
| `models/scenario.py` | add `default_content_episode_min`, `default_content_service_id` (§11) |
| `scenarios/*.json` | author the `<service>@<purpose>` entries (§5) and the §11 defaults |

### Deletions

This refactor is mostly subtraction. Two different erase-hacks and their two guards
collapse into one identical freeze:

- `RecoveryStage.grants_moving_recovery` (never enabled; `contentActive` replaces it)
- `apply_rest_recovery`, `apply_rest_recovery_minutes`
- Hybrid's `accum_baseline["mono_min"]` rebaseline on a served monotony proposal
- NRI's `cumulative_monotonous_min = 0.0` relief
- `mono_intervention_handled_sec` in **both** packages — a freeze is stateless per tick,
  so the once-per-intervention guard has nothing left to guard
- NRI's blanket freeze of all four accumulators across the whole `recovery_active` window

---

## 9. Fire-control changes (in scope)

Fire-control is a **separate concern** from recovery (P1), and it is **harness-level and
package-agnostic** — it lives in `run_manager._derive_response_suppression`
(`run_manager.py:272-392`), applied in `tick()` at line ~975. It is not part of either
algorithm.

Current state, for reference:

| Layer | Has |
|---|---|
| Harness (`_derive_response_suppression`) | 30-min window on monotony **declined**, rest **declined**, rest **postponed**. Monotony **acknowledged** → **indefinite**, released only when any `REST_PROPOSAL` fires. No count cap. |
| Hybrid, in-algorithm | per-category `rest_cooldown_sec` / `monotony_cooldown_sec`, `proposalCountLast30Min` cap, emergency override |
| NRI, in-algorithm | **nothing** — by design ("NO … persistence gate, cooldown, 30-min cap, or emergency override", `algorithm.py:29`). The harness is its only fire control. |

### Why this is coupled to the refactor

After the refactor, an acknowledged monotony proposal no longer drops NRI's `S_total` — the
freeze stops the monotonous term growing, but `S_base` time-damage keeps climbing, so the
score stays inside the band. Since NRI has no in-algorithm cooldown, the indefinite
acknowledge suppression stops being merely spec-nonconformant and becomes **load-bearing**.
Deferring it would leave the follow-up harder to reason about, not easier.

### 9.1 Acknowledge → bounded window

```
monotony acknowledged
-   monotony_indefinite = True          # released only when a REST_PROPOSAL fires
+   monotony_release_sec = sec + _DECLINE_COOLDOWN_SEC
```

Same rule as decline. Implements slide 81's 一定時間後に再度閾値チェック. Both packages
benefit; neither algorithm file is touched.

### 9.2 単位時間あたり提案回数 cap

A harness-level per-category count cap over a trailing window — the second half of slide 34,
which Hybrid has in-algorithm and NRI has nowhere. A module constant alongside
`_DECLINE_COOLDOWN_SEC`, documented the same way (harness fire-control policy, **not** an
algorithm tuning knob).

The count is over **actionable** (non-suppressed) fires per category, derived by extending
`_derive_response_suppression`'s existing single-pass chronological walk to track, as it
goes, whether each fire was suppressed at the time.

**Calibration constraint:** for Hybrid this is an *outer* cap on top of its own
`proposalCountLast30Min`. It must be set no tighter than Hybrid's in-algorithm cap, or it
would silently change Hybrid's behaviour rather than only adding a floor for NRI. Verify
against the 32 presets.

### Still out of scope

1. **Slide 34's override** — 「しきい値の大幅超過、または見込まれる増加速度が早い場合は制御しない」.
   Hybrid has it (emergency override); NRI has none. Not added here.
2. **Post-rest ordering.** Slide 46 selects post-rest content *before* the nap (⑥⑦⑧⑨) and
   uses that choice as motivation to rest. We keep recomputing the proposal after
   `rest_completed`.
3. **Customer-facing vocabulary** (覚醒 / リフレッシュ / 漫然運転予防) in the trace and
   Combined screen.
4. **`htmlapp/` port** — follow-up after owner review of the `app/` change.

---

## 10. Test plan

| Area | Test |
|---|---|
| Primitive | aggregate cap holds across an episode; floors at 0; unknown key recovers nothing |
| Case 1 | accumulators freeze; drain at the configured rate; on episode end resume **from where they were**, not from 0; `d_monotony` suppressed while base/night/jam growth continues |
| Case 2 | `@pre_rest` negative rate applies while MOVING; episode ends at `rest_spot_arrived`; exposure accumulators keep accruing throughout |
| Case 3 | per-tick curve; total across the dwell equals the current duration-scaled total (calibration-preserving) |
| Case 4 | exactly one reset edge; both algorithms reset there |
| **Parity (P5)** | given the same tick stream, Hybrid and NRI apply **identical** freeze semantics — the regression test for the whole coherence claim |
| Matrix coverage | enumerate reachable `(service, purpose)` pairs from the eligibility matrix; assert each has a `recovery_model` entry |
| Floor behaviour | on a night familiar highway, the frozen Hybrid monotony score plateaus at `w_night + w_familiar + w_env_mono·env_load`, not at 0 |
| Trigger-only fallback (§11) | an `acknowledge` with no proposal side produces the **same** accumulator trace as the equivalent Combined-screen episode of the same length |
| Fire-control §9.1 | an acknowledged monotony proposal is suppressed for exactly the window, then re-checks the threshold; a `REST_PROPOSAL` no longer needs to fire to release it |
| Fire-control §9.2 | the count cap suppresses the (N+1)th actionable fire of a category inside the window and releases as the window rolls; suppressed fires are **not** counted |
| Fire-control regression | the harness count cap does not change Hybrid's fire pattern on any of the 32 presets — i.e. it is no tighter than Hybrid's own `proposalCountLast30Min` |
| Regression | the 32 presets and combined C-01…C-06 re-run through generate→tune→verify. **Numbers will move; retune is part of the work, not a surprise.** |

---

## 11. Trigger-only screen fallback

The trigger-only screen (`AppMode = 'trigger'`) has no proposal run, so `playback_state`
does not exist and `contentActive` can never be true there. Once the erase-hacks are
deleted, answering a monotony proposal on that screen would relieve nothing — the
accumulator would climb for the rest of the run, bounded only by cooldown. That is a
regression on an existing screen.

**Decision: synthesise a content episode.** When an `acknowledge` is recorded and there is
no proposal side, the adapter opens a synthetic episode:

```
acknowledge @ T0
scenario.default_content_episode_min = 15
-> contentActive = true while (sim_time - T0) < 15 min
-> the scenario's default "<service>@monotony" entry applies:
   same suppression, same freeze, same drain
```

Identical code path and identical numbers to the Combined screen — only the *window* is
synthetic (a timer) instead of real (`playback_state`). The algorithms never learn the
difference, so both screens agree on what relief looks like.

**Adds:** `ScenarioDef.default_content_episode_min` and
`ScenarioDef.default_content_service_id` (which `@monotony` entry to use), plus one branch
in the merged adapter's `contentActive` derivation.

**Scope note.** Only case 1 is affected on this screen. `accept_rest` → drive → nap →
resume is entirely trigger-side (`RecoveryState`), so cases 3 and 4 work unchanged. Case
2's en-route 覚醒支援 cannot happen there either, but that is not a regression —
`grants_moving_recovery` was never enabled, so it is zero today and zero after.
