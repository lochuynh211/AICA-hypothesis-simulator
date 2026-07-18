# Merged Simulator — Slice 3 Plan: Monotony / Inattentive-Driving Path (feature 020)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** The Combined screen handles the monotony trigger purpose end-to-end: a `MONOTONY_PROPOSAL` fire → `inattentive_driving_prevention_recovery` / `active_driving_content` single-stage driving-content proposal, driven by a real **simulator-level monotony proxy signal** (replacing Slice-1's hardcoded `monotony_level=0`).

**Architecture:** Additive. A package-agnostic monotony accumulator in the tick engine exposes `dynamic.monotonyLevel` (0–100); the merged adapter feeds it into `World.situation.monotony_level`. The Slice-1 orchestrator already maps `MONOTONY_PROPOSAL` correctly and the frontend dock is purpose-blind, so no orchestrator/dock changes — only the signal, a monotony-firing scenario, and a small log label.

**Tech Stack:** Python 3.12 / FastAPI / Pydantic v2 / pytest; React 18 / TS / Vitest.

## Global Constraints
- Additive; existing trigger/proposal behavior unchanged; existing suites green (backend 2350, frontend 647). Merged module the only cross-importer.
- The monotony proxy is **simulator-owned** (in `tick_engine`, from `segment_type`/`motion_state`/`is_night`) — it does NOT touch or read any package's internal `mono_min` (Hybrid keeps its own; the new `dynamic.monotonyLevel` is an unrelated key it ignores). Package-agnostic (works for Hybrid + NRI).
- `MONOTONY_PROPOSAL` is already actionable (options `["acknowledge","decline"]`) and pauses the run when `allowed_actions` includes `decline`/`acknowledge` — so it surfaces in Play like REST, no orchestrator change.
- `map_trigger_purpose("MONOTONY_PROPOSAL")=="inattentive_driving_prevention_recovery"` and `map_lifecycle_stage(...)=="active_driving_content"` already (Slice-1) — do NOT change them.
- `World.situation.monotony_level: int = Field(ge=0, le=100)` — the engine value must be an int in 0–100.
- TDD, DRY, YAGNI, commit per task + trailer. Branch `020-merged-simulator`.

## Key shapes (from signature extraction)
- `tick_engine.py:401-424` builds `signals["dynamic"]`. Accumulator precedent = `TickState.distance_km`/`continuous_driving_min` (plain field read from `prior_state`, recomputed, written into the new `TickState(...)`).
- Hybrid monotony (reference, package-internal): `_monotony_score(mono_min,is_night)=clamp(0.6*clamp(mono_min/30)+0.4*isNight)`; `_MONOTONOUS_SEGMENT_TYPES=("highway","normal_road")`; fires when `monotony_prevention_score>=monotony_suggest_threshold(0.7)`, after persistence(6)/cooldown(900s); **rest wins priority if both fire**.
- `build_world_from_tick` (merged_adapter.py:149): `"monotony_level": 0` → change to read the new signal.
- No MONOTONY scenario exists — only `scenarios/uc01_fatigue_recovery_v0_1.json` (rest-focused). Need a new one.

---

## Task 1: Simulator monotony proxy signal (tick engine + adapter feed)

**Files:** Modify `app/api/aica_api/models/run.py` (`TickState`); Modify `app/api/aica_api/services/tick_engine.py`; Modify `app/api/aica_api/services/merged_adapter.py` (feed + docstrings); Test `app/api/tests/test_monotony_signal.py`.

**Interfaces:**
- `TickState.monotony_accrued_min: float | None = None` (new field, alongside `distance_km`/`continuous_driving_min`).
- In `advance_tick`: read `monotony_accrued_min = prior_state.monotony_accrued_min or 0.0`; after `segment_type`/`is_night`/`motion_state` known, accrue/decay:
```python
_MONOTONOUS = ("highway", "normal_road")
if segment_type in _MONOTONOUS and motion_state == "MOVING":
    new_monotony_accrued_min = monotony_accrued_min + tick_seconds / 60.0
else:
    new_monotony_accrued_min = max(0.0, monotony_accrued_min - 2.0 * tick_seconds / 60.0)   # decay 2 min/min off-monotonous
monotony_level = round(min(100.0, (new_monotony_accrued_min / 30.0) * 80.0 + (20.0 if is_night else 0.0)))
```
add `"monotonyLevel": monotony_level` into `signals["dynamic"]`, and `monotony_accrued_min=new_monotony_accrued_min` into the `TickState(...)` constructor.
- `build_world_from_tick`: `"monotony_level": round(dynamic.get("monotonyLevel", 0))` (default 0 keeps fixtures lacking the field valid); update the stale module + function docstrings that say monotony is a fixed slice-1 default.

- [ ] Step 1: failing tests — (a) `advance_tick` over consecutive highway MOVING ticks → `dynamic.monotonyLevel` strictly increases; (b) a non-monotonous segment (e.g. mountain_road) or STOPPED → level decays toward 0; (c) night adds the +20 bonus vs an otherwise-identical day tick; (d) `build_world_from_tick` with a tick whose `dynamic.monotonyLevel=55` → `World.situation.monotony_level==55` (and a tick lacking the field → 0). Update `test_merged_adapter.py`'s existing monotony assertion if it asserted 0.
- [ ] Step 2: run `cd app/api && .venv/bin/pytest tests/test_monotony_signal.py -q` → FAIL.
- [ ] Step 3: implement.
- [ ] Step 4: run → PASS; full backend suite green (2350+; existing tick/adapter tests must stay green — the new field is optional).
- [ ] Step 5: commit `feat(merged): slice3 simulator monotony proxy signal + adapter feed`.

**Acceptance:** a package-agnostic 0–100 monotony level rises on monotonous highway, decays otherwise, night-boosted; fed into the proposal World.

---

## Task 2: Monotony scenario + merged end-to-end integration

**Files:** Create `scenarios/uc02_monotony_v0_1.json`; Modify `app/api/aica_api/services/scenario_registry.py` only if a manifest/registry list must include it (check how uc01 is registered — likely auto-discovered from `scenarios/`); Test `app/api/tests/test_merged_monotony_journey.py`.

**Scenario recipe (tune until MONOTONY fires before REST):** long uninterrupted `highway`/`normal_road` route (≥60 min continuous), `is_night: true`, `familiar_route: true`, a light/intermittent `traffic_events` entry (to push `env_load` so `monotony_prevention_score` clears 0.7), and `driver_signal_params` tuned for SLOW drowsiness/fatigue growth so `base_safety_risk`/`rest_required_score` stay below their thresholds (rest must NOT win priority). `allowed_actions` must include `"decline"` (or `"acknowledge"`) so the MONOTONY proposal is actionable/pauses. Model it on `uc01_fatigue_recovery_v0_1.json`'s structure. This is a generate→tune→verify loop: run the trigger preview/tick until `MONOTONY_PROPOSAL` fires and `REST_PROPOSAL` does not (or fires later).

- [ ] Step 1: failing integration test `test_merged_monotony_journey.py` (TestClient): build a trigger plan on `uc02_monotony_v0_1` (via `POST /api/run-plans` or the merged plan endpoint), `POST /api/merged-runs`, tick until a fire; assert the tick that fires has `trigger.paused==True`, `response["proposal"]` is set with `opportunity.trigger_purpose=="inattentive_driving_prevention_recovery"` and `lifecycle_stage=="active_driving_content"`, the proposal has real ranked service evidence from the active-driving matrix row (`music_playlist`/`humming_karaoke`/…), and the world's `situation.monotony_level > 0`. Also assert a `select-service` proposal-action advances to content. Assert NO rest-journey (`rest_stage_synced` stays None; no `rest_spot_arrived`).
- [ ] Step 2: run → FAIL (scenario missing / doesn't fire monotony).
- [ ] Step 3: author + tune the scenario until the test passes; implement.
- [ ] Step 4: run → PASS; full backend suite green.
- [ ] Step 5: commit `feat(merged): slice3 monotony scenario + merged e2e`.

**Acceptance:** a monotony drive fires `MONOTONY_PROPOSAL`, the merged run pauses and produces an `inattentive_driving_prevention_recovery` / `active_driving_content` service→content proposal reflecting real monotony_level; no rest chain.

---

## Task 3: Frontend — bilingual trigger-purpose label in merged log (polish)

**Files:** Modify `app/frontend/src/components/merged/MergedLogPanel.tsx`; Test extend `app/frontend/tests/merged_log.test.tsx`.

**Behavior:** `summarizeProposalEvent`'s `OPPORTUNITY_OPENED` case currently prints the raw `trigger_purpose` enum. Map it to a bilingual friendly label (reuse `WorldPanel`'s `TRIGGER_PURPOSES` `{ja,en}` map or a local equivalent) so `rest_recommended` and `inattentive_driving_prevention_recovery` read clearly. Keep it a small, purpose-agnostic lookup with a raw-string fallback.

- [ ] Step 1: failing test: a proposalLog with an `OPPORTUNITY_OPENED` event whose `payload.trigger_purpose='inattentive_driving_prevention_recovery'` → assert the row shows the friendly label (not the raw enum).
- [ ] Step 2: run `cd app/frontend && npx vitest run merged_log` → FAIL.
- [ ] Step 3: implement.
- [ ] Step 4: run focused + `npx tsc --noEmit` (no new merged errors); full vitest green.
- [ ] Step 5: commit `feat(merged): slice3 friendly trigger-purpose label in merged log`.

**Acceptance:** the merged log names the monotony (and rest) purpose in a human-readable, bilingual way.

---

## Task 4: End-to-end verification
- [ ] Step 1: backend full suite green; frontend full suite green + `vite build` clean.
- [ ] Step 2: monotony flow proven by Task 2 integration test; note browser walkthrough remains a manual user step.
- [ ] Step 3: update design doc §12 (Slice 3 done); update ledger + memory.
- [ ] Step 4: commit `chore(merged): slice3 e2e verification`.

## Self-Review
- Coverage: monotony proxy signal (design §6) → T1; MONOTONY→inattentive/active_driving_content path (§B) → T2 (orchestrator already handles it, T2 verifies e2e); log label → T3.
- Types: `TickState.monotony_accrued_min` + `dynamic.monotonyLevel` (T1) consumed by `build_world_from_tick` (T1) + the scenario/test (T2). No orchestrator/dock change (verified purpose-blind).
- Deferred (Slice 2c): quickview + correlation replay (unrelated to monotony).
