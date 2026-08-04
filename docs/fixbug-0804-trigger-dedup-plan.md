# Fixbug-0804 — Post-response trigger de-duplication plan

**Branch:** `fixbug-0804`
**Status:** Awaiting user review before implementation
**Author:** Claude (orchestration session)
**Date:** 2026-08-04

---

## 1. The bug (as reported)

In **animation / live-run mode**:

1. **Accept case.** When the driver **accepts** a monotony proposal, after continuing the
   animation the system immediately/continuously shows *another* monotony proposal.
   Desired behavior — after the driver accepts a trigger, the **same trigger type must not
   fire again until a state change**:
   - **Monotony** proposal must **not** re-fire until a **rest** proposal has triggered.
   - **Rest** proposal must **not** re-fire until the driver has **arrived at a rest spot**.
2. **Decline case.** When the driver **declines** a trigger, the **same trigger type must
   not re-fire within a 30-minute interval** (cooldown).

Scope for this branch: **backend + frontend application first.** The `htmlapp` mirror is a
follow-up, done only after the user reviews the backend fix. When mirroring htmlapp, **skip
regenerating parity fixtures** (done at the very end; some fixture tests may fail in the
interim and can be skipped).

---

## 2. Confirmed scope decisions (from the user)

| Question | Decision |
|---|---|
| Which package(s) to fix | **Both** `nri_fatigue_score_v1` **and** `aica_transparent_hybrid_trigger_v1` |
| 30-min decline cooldown granularity | **Per category** (declining monotony blocks only monotony; declining rest blocks only rest; each independent) |
| What counts as "accept" for a monotony proposal | **`acknowledge` = accept** (NRI monotony proposal only offers `acknowledge` / `decline`; there is no `accept_rest` option on it) |

---

## 3. Root cause (investigated, with evidence)

All dedup / cooldown / suppression logic currently lives **inside each package's
`algorithm.py::evaluate()`**. The tick engine and `run_manager` are (almost) stateless
pass-throughs. Evidence:

### 3.1 The per-tick evaluation flow
- `app/api/aica_api/services/run_manager.py::tick()` (starts **line 578**) is the loop the
  frontend drives one call at a time (`POST /api/runs/{id}/tick`).
- Each tick it re-derives `proposal_history` and `user_action_history` by replaying the
  **entire** append-only event log via `_derive_history()`
  (`run_manager.py:262-380`), and injects them into `context`
  (`run_manager.py:680-686`). It also injects
  `context["recovery_active"]` (`run_manager.py:694-696`).
- It calls `_adapter.evaluate(...)` (`run_manager.py:716-723`), then decides whether to
  **pause** the run:
  - `proposal_fired = decision_result.fire_control.fired and decision_result.proposal is not None`
    (`run_manager.py:811-814`)
  - `proposal_is_actionable = proposal_fired and (proposal.options ∩ scenario.allowed_actions)`
    (`run_manager.py:820-822`)
  - If actionable → `run_state.status = paused`, `run_state.pending_proposal = proposal.id`
    (`run_manager.py:837-839`).

### 3.2 The existing centralized suppression precedent ✅ (this is the anchor for the fix)
`run_manager.py:824-835` **already** contains a centralized fire-control gate that suppresses
a REST proposal during active recovery — by clearing `proposal_is_actionable` (so the run
does **not** pause) **while still leaving the fired proposal recorded in the evidence log**:

```python
# ── Fire-control: suppress REST_PROPOSAL during active recovery ───────────
recovery_active = bool(run_state.recovery and run_state.recovery.active)
if recovery_active and proposal_is_actionable and decision_result.result_type == "REST_PROPOSAL":
    proposal_is_actionable = False
```

This is exactly the shape the new dedup gate should take.

### 3.3 Why the same trigger re-fires (the actual defect)
- **`nri_fatigue_score_v1`** — on **any** answer (accept *or* decline) it relieves the
  monotony accumulator to 0 (`mono_intervention_handled_sec`, `algorithm.py:452-480`), then
  lets it climb straight back up with **no cooldown** and **no "wait for a state change"
  gate**. Its fire-control block (`algorithm.py:671-693`) has zero cooldown / rate checks.
  So the same monotony proposal re-fires within a couple of ticks. The recent bugfix commits
  (`c526521 fix recovery monotony`, `e212e90 fix recovery rest proposal`) fixed a *different*
  problem (accumulator never falling), and the existing test
  `test_monotony_relief_fires_only_once` actually **codifies immediate re-fire as intended**.
- **`aica_transparent_hybrid_trigger_v1`** — has a blanket `monotony_cooldown_sec`
  (default 900 s = **15 min**, not 30), applied **uniformly** to accept and decline, with **no**
  "suppress until rest fires" gate and **no** per-outcome (accept vs decline) distinction.

**Neither package** implements "monotony suppressed until a rest proposal fires" or a
30-minute **decline-specific** cooldown.

### 3.4 The signals already available (no new persistent state needed)
- **Accept vs decline** — `proposal_history["lastProposalResult"]` is the literal action
  string (`"accept_rest"` / `"acknowledge"` / `"decline"` / `"postpone"`), computed as the
  first action at or after the last fired proposal's tick (`_derive_history`,
  `run_manager.py:345-350`). Category is `lastProposalCategory`; sim-time is
  `lastProposalTimeSec`.
- The **full** ordered lists of fired proposals are already collected inside
  `_derive_history` — `fired_proposal_ticks`, `fired_proposal_categories`,
  `fired_proposal_secs` (`run_manager.py:304-324`) — only the *last* is currently surfaced.
  These, plus `action_by_order` (`run_manager.py:326`), are enough to reconstruct the full
  per-category answer history.
- **"Arrived at rest spot" / rest recovery** — the existing `recovery_active` gate
  (`run_manager.py:833-835`) already suppresses rest through the entire recovery window; on
  `recovery_just_completed` the NRI accumulators reset to 0 so a fresh rest proposal must
  rebuild from scratch. This already implements "rest must not re-fire until arrival at rest
  spot" for the **accept-rest** case.

### 3.5 Category / result-type strings (identical across both packages)
| | NRI | Hybrid |
|---|---|---|
| rest result_type / category | `REST_PROPOSAL` / `rest_required` (`algorithm.py:673-674`) | `REST_PROPOSAL` / `rest_required` (`algorithm.py:845-846`) |
| monotony result_type / category | `MONOTONY_PROPOSAL` / `monotony_prevention` (`algorithm.py:677-678`) | `MONOTONY_PROPOSAL` / `monotony_prevention` (`algorithm.py:848`) |

Because the strings match, a **single** gate keyed on `selected_category` / `result_type`
covers both packages.

---

## 4. Chosen architecture — centralized gate in `run_manager.py`

**Decision: implement the dedup as a centralized fire-control gate in `run_manager.tick()`,
NOT inside either `algorithm.py`.**

### Why centralized (over per-algorithm)
1. **Precedent already exists** — the `recovery_active` REST gate (`run_manager.py:824-835`)
   is the same kind of *review-harness fire-control policy*. Dedup belongs at the same layer.
2. **One location covers both packages** automatically (gate keys off the shared
   `selected_category` strings). No duplicated logic; any future UC-01 package is covered.
3. **Easiest to mirror in htmlapp** — a single pure helper + one gate block, versus editing
   two separate mirrored algorithm ports.
4. **Preserves the recent bugfixes** — we do **not** touch the algorithms' internal relief
   logic, so those commits and `test_monotony_relief_fires_only_once` stay valid. The
   algorithm's score curve still shows in evidence; we only stop it from **re-pausing** the
   run.
5. **Conceptually correct for a "hypothesis simulator"** — the algorithm's job is to express
   *what it thinks*; suppressing a duplicate interruption of the review animation is harness
   policy, not the trigger hypothesis. Keeping it out of the algorithm keeps the algorithm's
   decision trace honest.

### Trade-off acknowledged
The gate suppresses the *pause*, not the *fired* flag — so evidence still records that the
algorithm wanted to fire (same as the existing recovery gate). This is intentional and
consistent: a reviewer can still see the algorithm's raw intent in the decision trace; the
animation simply isn't interrupted by a duplicate.

---

## 5. The state machine (per category, derived from the event log)

New **pure** helper in `run_manager.py`:

```
_derive_response_suppression(events, current_sim_sec, tick_seconds) -> dict[str, bool]
    returns {"rest_required": bool, "monotony_prevention": bool}
```

It walks the append-only log chronologically (same single pass style as `_derive_history`),
pairing each fired proposal with the first action at/after its tick, and applies:

| Trigger | Rule | Release condition |
|---|---|---|
| **Monotony ACCEPTED** (`acknowledge`) | suppress `monotony_prevention` | released the moment **any REST_PROPOSAL fires** after that acknowledge |
| **Monotony DECLINED** (`decline`) | suppress `monotony_prevention` | released when `current_sim_sec - declineTimeSec >= 1800` |
| **Rest DECLINED** (`decline`) | suppress `rest_required` | released when `current_sim_sec - declineTimeSec >= 1800` |
| **Rest ACCEPTED** (`accept_rest`) | *already handled* by the existing `recovery_active` gate (suppressed through the whole recovery → until arrival at rest spot; accumulators reset so rest rebuilds) | **no new code** — verify + add a covering test |
| **Rest POSTPONED** (`postpone`) | treat as 30-min cooldown (semantically "not now") — see Open Question Q1 | released after 1800 s |

Gate application in `tick()` — immediately **after** the existing recovery gate
(`run_manager.py:835`), before the `if proposal_is_actionable:` branch:

```python
if proposal_is_actionable and decision_result.selected_category is not None:
    suppression = _derive_response_suppression(
        recorder.run_log.events,
        current_sim_sec=float(tick_state.elapsed_seconds),
        tick_seconds=float(run_state.event_plan.tick_seconds),
    )
    if suppression.get(decision_result.selected_category):
        proposal_is_actionable = False
```

Module constant: `_DECLINE_COOLDOWN_SEC = 1800.0`.

### Key properties
- **Per-category & independent**: a monotony decline never blocks rest, so a genuine safety
  escalation to a rest proposal still fires during a monotony cooldown. ✅ (matches the
  user's "per category" choice.)
- **Accept-monotony has no timer** — it stays suppressed until a rest proposal fires, however
  long that takes. Per the requirement this is acceptable/desired.
- **Suppressed proposals stay in evidence** (`fired=True`) — identical to the recovery gate.
- **Time base**: uses `tick_state.elapsed_seconds` as `current_sim_sec` and each proposal's
  stored `elapsed_seconds` — the same clock `_derive_history` already uses, so the 1800 s
  window is a real elapsed duration on both M1 and M2 cadence paths (this correctness point
  was the subject of the `_derive_history` time-convention comment, `run_manager.py:279-285`).

---

## 6. Edge cases

| Case | Handling |
|---|---|
| Driver never answers a proposal | Run is paused waiting for an action; no re-fire question arises until an action is recorded. |
| Multiple declines of the same category | Each decline resets the 1800 s window from its own sim-time (latest decline wins). |
| 30-min boundary | Suppress iff `current_sim_sec - declineTimeSec < 1800`; at exactly 1800 s the trigger is allowed again (tested at boundary). |
| Monotony accepted, then rest never fires | Monotony stays suppressed for the rest of the run — acceptable per requirement. |
| Rest accepted → recovery → arrival | Existing `recovery_active` gate + accumulator reset handles re-arming; new gate does not interfere (rest not in the decline/accept-monotony map during recovery). |
| Escalation monotony→rest while monotony suppressed | Rest is independent; rest still fires (unless rest itself is under its own cooldown). |
| Postpone | See Q1 — default: 30-min cooldown. |

---

## 7. TDD test plan (tests written first, must fail before the fix)

New file: **`app/api/tests/test_run_manager_response_suppression.py`**

### 7.1 Unit tests on the pure helper `_derive_response_suppression`
- `test_monotony_acknowledge_suppresses_monotony_until_rest_fires`
- `test_monotony_acknowledge_released_when_rest_proposal_fires`
- `test_monotony_decline_suppresses_for_30min`
- `test_monotony_decline_released_after_30min` (boundary at exactly 1800 s)
- `test_rest_decline_suppresses_rest_for_30min`
- `test_rest_decline_does_not_block_monotony` (per-category independence)
- `test_monotony_decline_does_not_block_rest_escalation`
- `test_postpone_rest_cooldown` (locks in Q1 decision)
- `test_no_actions_no_suppression`

### 7.2 Integration tests through `tick()` — for BOTH packages
Parametrized over `nri_fatigue_score_v1` and `aica_transparent_hybrid_trigger_v1`:
- `test_accepted_monotony_does_not_repause_before_rest[<pkg>]`
- `test_declined_monotony_does_not_repause_within_30min[<pkg>]`
- `test_declined_rest_does_not_repause_within_30min[<pkg>]`
- `test_accepted_rest_suppressed_until_arrival[<pkg>]` (verifies the existing recovery gate
  still holds — regression guard, likely already green)

### 7.3 Existing tests to check / possibly adjust
- `app/api/tests/test_nri_fatigue_score.py::test_monotony_relief_fires_only_once`
  (~lines 1025-1052) — codifies immediate re-fire **at the algorithm layer**. Because the fix
  is in `run_manager` (not the algorithm), this **algorithm-level test should stay green**
  (the algorithm still fires; only the harness suppresses the pause). Confirm during
  implementation; if it exercises the run loop, update its expectation with a comment
  referencing this plan.
- `app/api/tests/test_transparent_hybrid.py` cooldown tests (~lines 619-700) — verify still
  pass; the harness gate is additive.
- `app/api/tests/test_run_manager_recovery.py`, `test_uc01_recovery_e2e.py` — regression check.

---

## 8. Files to change

| File | Change |
|---|---|
| `app/api/aica_api/services/run_manager.py` | Add `_DECLINE_COOLDOWN_SEC = 1800.0`; add pure helper `_derive_response_suppression(...)`; add gate block in `tick()` right after line 835. |
| `app/api/tests/test_run_manager_response_suppression.py` | **New** — unit + integration tests (§7). |

**No frontend change** — the frontend never decides when to pause; it renders whatever the
backend returns. Backend is the single source of truth. (Confirmed via `ProposalPanel.tsx` →
`actRun` → `POST /api/runs/{id}/actions`; pausing is entirely backend-driven.)

**No `package.json` change** — the cooldown is harness fire-control policy, not an algorithm
hyperparameter. (Deliberately not adding a per-package config field, to keep both packages
uniform and the htmlapp mirror simple.)

---

## 9. Explicitly NOT doing (scoping guardrails)

- **Not** editing `algorithm.py` in either package (keeps decision traces honest; preserves
  recent bugfix commits and their tests).
- **Not** touching `preview.py` (the instant-preview / non-animation path) — the reported bug
  is live/animation mode. See Q2 if you want preview consistency too.
- **Not** adding `package.json` fields.
- **Not** changing `_derive_history` (the new helper is separate; it may share the same walk
  style but does not alter existing derived fields).

---

## 10. htmlapp mirror (follow-up, after backend review)

Mirror target: `htmlapp/frontend/src/engine/services/preview_ticks.ts` and/or the htmlapp live
tick loop that corresponds to `run_manager.tick()` (the file already mirrors
`deriveProposalHistory` and the recovery/actionable gate — see
`preview_ticks.ts:515`, `:551`, `:649`). Port the pure helper + gate 1:1.
**Skip parity-fixture regeneration** until everything is complete (per user instruction);
tolerate interim fixture-test failures.

---

## 11. Open questions for reviewer

**Q1 — Postpone semantics (rest proposal).** Default in this plan: `postpone` is treated like
`decline` → 30-min cooldown ("not now"). Alternative: postpone should re-prompt sooner / on
next threshold crossing. **Which do you want?**

**Q2 — Preview / instant mode.** Should the same dedup apply to the instant-preview path
(`preview.py` / `preview_ticks.ts`), or is live/animation mode the only place it matters for
this branch?

**Q3 — Hybrid's existing 15-min `monotony_cooldown_sec`.** Leave it as-is (the new 30-min
harness decline-gate sits on top, and is the stricter of the two for declines), or align the
package default to 30 min? Default in this plan: **leave it**, since the harness gate now
authoritatively enforces the required behavior and I don't want to change algorithm tuning.

---

## 12. Execution order (once approved)

1. Subagent A (TDD): write the failing tests in `test_run_manager_response_suppression.py`.
2. Subagent B: implement `_derive_response_suppression` + gate; run tests to green; run the
   surrounding suites (`test_run_manager_recovery`, `test_nri_fatigue_score`,
   `test_transparent_hybrid`, `test_uc01_recovery_e2e`).
3. Subagent C (independent review): adversarially verify correctness (per-category
   independence, boundary, evidence still records fired, no regression).
4. Report back for user review of the backend fix.
5. **Only after user sign-off:** htmlapp mirror (skip fixture regen).

*(Per session policy, every implementation/test/review task runs in a subagent; this main
session orchestrates only.)*
