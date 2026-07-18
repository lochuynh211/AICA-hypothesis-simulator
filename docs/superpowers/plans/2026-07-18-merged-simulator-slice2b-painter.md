# Merged Simulator — Slice 2b Plan: Route-Conditions Painter + MOVING-Recovery Hardening (feature 020)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Let the reviewer paint a **mountain section** and a **traffic-jam section** onto the route via 2-dot range sliders in the Combined-screen Route setup — since Google Directions can't label mountains or predict jam position — and harden the MOVING-recovery eligibility from a name-heuristic to an explicit flag.

**Architecture:** Additive. A new merged painter service injects a `mountain_road` `RouteSegmentFact` (position-native) and a time-converted `TrafficEvent` preset into the trigger run-plan build; a new merged plan-build endpoint applies it and returns a `plan_id` consumable by the existing merged-create. The MOVING-recovery gate becomes an explicit `RecoveryStage` flag.

**Tech Stack:** Python 3.12 / FastAPI / Pydantic v2 / pytest; React 18 / TS / Vitest.

## Global Constraints
- Additive; existing trigger/proposal behavior unchanged; existing suites green (backend 2332, frontend 644). Merged module the only cross-importer.
- Painter is INLINE-SETUP (frozen at run start). Mountain is **position-native** (`RouteSegmentFact.start_km`/`length_km`); traffic-jam is **time-based** (`TrafficEvent.start_min`/`duration_min`) so a km-range slider MUST be converted: `start_min=(start_km/total_km)*est_duration_min`, `duration_min=((end_km-start_km)/total_km)*est_duration_min`. `affected_segment_id` is display-only (never read by the engine).
- Route segments are a flat ascending non-overlapping `list[RouteSegmentFact]`; `create_draft(route_facts=...)` accepts a pre-built RouteFacts (the mountain seam); traffic-jams inject via `presets["traffic_events"]` (list of `{id,start_min,duration_min,affected_segment_id,speed_kph}`).
- TDD, DRY, YAGNI, commit per task + trailer. Branch `020-merged-simulator`.

---

## Task 1: Painter service (mountain split + jam-preset conversion)

**Files:** Create `app/api/aica_api/services/merged_painter.py`; Test `app/api/tests/test_merged_painter.py`.

**Interfaces:**
```python
def inject_mountain_segment(segments: list[RouteSegmentFact], start_km: float, end_km: float) -> list[RouteSegmentFact]:
    """Split the ascending non-overlapping segments so [start_km,end_km) becomes a mountain_road run.
    Each seg covers [seg.start_km, seg.start_km+seg.length_km). Overlapped segs split into up to 3 pieces
    (before keeps type, [start,end) -> mountain_road, after keeps type). Returns a new ascending list; input unchanged.
    Clamp to [0, total]; ignore empty/invalid ranges (start>=end) by returning segments unchanged."""

def jam_traffic_event(start_km: float, end_km: float, total_km: float, est_duration_min: float,
                      *, speed_kph: float = 15.0, event_id: str = "manual_jam", affected_segment_id: str = "manual") -> dict:
    """Convert a km range to a time-based traffic_events preset dict {id,start_min,duration_min,affected_segment_id,speed_kph}."""
```

- [ ] Step 1: failing tests — (a) mountain range fully inside one segment → 3 pieces with correct types/start_km/length_km, total length preserved; (b) mountain range spanning 2 segments → correct split; (c) invalid range (start>=end) → unchanged; (d) `jam_traffic_event(30,50,120,144)` → start_min=36, duration_min=24, speed_kph=15.
- [ ] Step 2: run `cd app/api && .venv/bin/pytest tests/test_merged_painter.py -q` → FAIL.
- [ ] Step 3: implement (pure functions; RouteSegmentFact from models.run).
- [ ] Step 4: run → PASS; full suite green.
- [ ] Step 5: commit `feat(merged): slice2b painter service (mountain split + jam conversion)`.

**Acceptance:** pure painter transforms verified; segments stay ascending/non-overlapping/total-length-preserving.

---

## Task 2: Merged plan-build endpoint (applies painter)

**Files:** Modify `app/api/aica_api/routers/merged_runs.py` (add endpoint); Test `app/api/tests/test_merged_plan_endpoint.py`.

**Interfaces:**
- `POST /api/merged-runs/plan` body `{package_id, scenario_id, route_preset_id: str|None, run_seed: int, mountain_range_km: [float,float]|None, jam_range_km: [float,float]|None, jam_speed_kph: float=15.0, presets: dict={}, parameters: dict={}, hyperparameters: dict={}}` → `{plan_id: str}`.
- Logic: resolve package + scenario (existing registries); build `route_facts` (reuse the existing local/preset route path — `analyze_route(scenario)` or `load_route_preset(route_preset_id)` — same as the run-plans router does); if `mountain_range_km` → `route_facts.route_segments = inject_mountain_segment(route_facts.route_segments, *mountain_range_km)`; if `jam_range_km` → append `jam_traffic_event(*jam_range_km, route_facts.total_route_distance_km, route_facts.estimated_route_duration_min, speed_kph=jam_speed_kph)` to `presets["traffic_events"]`; call `run_plan.create_draft(plan_id, package, scenario, presets, parameters, hyperparameters, route_facts=route_facts, route_source=route_facts.route_source, run_seed=run_seed)`; return its `plan_id`. (Read the existing run-plans router to mirror how it resolves package/scenario/route and generates plan_id.)

- [ ] Step 1: failing integration test (TestClient): POST /api/merged-runs/plan with a rest scenario + a mountain_range + jam_range → 200 + plan_id; then feed that plan_id into POST /api/merged-runs (Slice-1 create) and tick a few times → assert the draft's route_facts has a mountain_road segment in range and the event plan has the manual jam; assert ticking eventually reports `road_type`/`segmentType=mountain_road` and `isTrafficJam` at the expected positions/times.
- [ ] Step 2: run → FAIL.
- [ ] Step 3: implement.
- [ ] Step 4: run → PASS; full backend suite green (2332+).
- [ ] Step 5: commit `feat(merged): slice2b merged plan-build endpoint with painter`.

**Acceptance:** a painted plan drives real mountain_road segments + a positioned jam through the merged run; existing run-plans endpoint untouched.

---

## Task 3: MOVING-recovery explicit flag (harden the name-heuristic)

**Files:** Modify `app/api/aica_api/models/scenario.py` (`RecoveryStage`); Modify `app/api/aica_api/services/tick_engine.py` (the MOVING-recovery gate); Test `app/api/tests/test_moving_recovery_flag.py`.

**Interfaces:** Add `RecoveryStage.grants_moving_recovery: bool = False` (opt-in; `extra="allow"` already). In the tick-engine recovery block, gate MOVING-stage rate recovery on `stage.motion == "MOVING" and stage.grants_moving_recovery` (replacing the `phase=="content" or content!="wakefulness"` name-heuristic). Default False → today's real scenarios (which never set it) get **zero** MOVING recovery (matches current inert behavior); explicit opt-in enables en-route recovery.

- [ ] Step 1: failing tests — (a) a MOVING stage WITHOUT the flag → zero en-route recovery even if its `recovery_model` entry has `*_per_min` (closes the landmine); (b) a MOVING stage WITH `grants_moving_recovery=True` + per-min entry → accrues en-route recovery (as Slice-2 T2 did). Update any Slice-2 T2 test that relied on the name-heuristic to set the flag.
- [ ] Step 2: run → FAIL.
- [ ] Step 3: implement.
- [ ] Step 4: run → PASS; full suite green (existing recovery tests unaffected since no real scenario sets the flag).
- [ ] Step 5: commit `feat(merged): slice2b explicit grants_moving_recovery flag`.

**Acceptance:** en-route recovery is opt-in via an explicit flag, not name inference; the confirmed-live landmine is closed.

---

## Task 4: Frontend — route-conditions painter (2-dot sliders)

**Files:** Modify `app/frontend/src/api/mergedClient.ts` (add `buildMergedPlan`); Modify `app/frontend/src/components/merged/MergedSetupPanel.tsx` (Route popup: two dual-handle range sliders over the route km axis for mountain + jam, wired to `buildMergedPlan`); optionally Create `app/frontend/src/components/merged/RouteConditionsPainter.tsx`; Test `app/frontend/tests/merged_painter_ui.test.tsx`.

**Interfaces:** `buildMergedPlan({package_id, scenario_id, route_preset_id, run_seed, mountain_range_km, jam_range_km, jam_speed_kph})` → `{plan_id}`. The Route popup renders a horizontal route bar (reuse RouteTimeline visual vocabulary if clean; else a labeled range input pair) with two 2-handle sliders: Mountain `[start,end]` and Traffic-jam `[start,end]` in km (0..total route km), each with position readouts and a distinct color band. On Start, MergedSetupPanel calls `buildMergedPlan` (instead of the plain run-plan build) when a painter range is set, then `coordinator.create({ trigger_plan_id: plan_id, ... })`.

- [ ] Step 1: failing test (mock clients): open Route popup → assert two range sliders (mountain/jam) render; set a mountain range + jam range; click Start → assert `buildMergedPlan` called with the expected `mountain_range_km`/`jam_range_km`, then `coordinator.create` called with the returned plan_id.
- [ ] Step 2: run `cd app/frontend && npx vitest run merged_painter_ui` → FAIL.
- [ ] Step 3: implement (dual-handle slider = two `<input type=range>` with min-gap clamping, or a small controlled component; follow inline-style + data-testid conventions).
- [ ] Step 4: run focused + `npx tsc --noEmit` (no new merged errors); full vitest green.
- [ ] Step 5: commit `feat(merged): slice2b route-conditions painter UI (2-dot sliders)`.

**Acceptance:** reviewer paints mountain + jam onto the route; Start builds a painted plan; the run reflects them.

---

## Task 5: End-to-end verification
- [ ] Step 1: backend full suite green; frontend full suite green + `vite build` clean.
- [ ] Step 2: painted-run integration proven by Task 2 test; note browser walkthrough remains a manual user step.
- [ ] Step 3: update design doc §12 (Slice-2b painter+hardening done; quickview + replay still pending); update ledger + memory.
- [ ] Step 4: commit `chore(merged): slice2b e2e verification`.

## Self-Review
- Coverage: route painter (design §5) → T1,T2,T4; MOVING-hardening (§8 review item) → T3. Deferred: quickview (§7.1) + correlation replay — seams mapped in scratchpad `s2-quickview-seam.md`, need preview-loop generator extraction + non-persisting proposal path.
- Types: `inject_mountain_segment`/`jam_traffic_event` (T1) used T2; `POST /api/merged-runs/plan` + body (T2) used by `buildMergedPlan` (T4); `grants_moving_recovery` (T3) additive.
