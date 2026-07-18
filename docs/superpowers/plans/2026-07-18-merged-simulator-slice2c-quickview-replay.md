# Merged Simulator — Slice 2c Plan: Quickview + Correlation Replay (feature 020)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** (1) **Quickview** — a headless `quick_check` projection of the whole trigger+proposal chain shown before animating, so every fire/rest point is **clickable to inspect its proposal without Play**. (2) **Correlation replay** — open a persisted merged run read-only and scrub the interleaved trigger+proposal timeline.

**Architecture:** Additive throughout. Quickview extracts `evaluate_preview`'s loop into an `iter_preview_ticks` generator (zero behavior change) and threads an optional in-memory `cache` dict through `proposal_run_manager`'s mutating functions so a quick_check proposal resolves in memory (never persisted); a new `services/merged_quickview.py` composes them. Replay adds one `GET /api/merged-runs/{id}` assembly endpoint (pure disk reads) and composes the existing trigger replay infra.

**Tech Stack:** Python 3.12 / FastAPI / Pydantic v2 / pytest; React 18 / TS / Vitest.

## Global Constraints
- Additive; existing trigger/proposal behavior unchanged; existing suites green (backend 2357, frontend 648). Merged module the only cross-importer.
- **`evaluate_preview`'s return dict shape/values MUST be byte-identical** after the generator extraction — all existing preview tests stay green.
- The `cache` kwarg is keyword-only, default `None` → every existing `proposal_run_manager`/`create_proposal_run` call behaves exactly as today (persists to disk). Only quickview passes a fresh `{}`.
- `merged_quickview.py` follows `merged_adapter.py`'s isolation precedent: it may import `services.preview` (trigger, returns plain dicts) + `models.proposal.world.World` + `routers.proposal.create_proposal_run`, but must NOT import trigger Pydantic models (`models.run`/`package`/`scenario`). Endpoints live in `routers/merged_runs.py` (the sanctioned cross-importer).
- Replay is read-only (renders persisted logs, never recalculates) — mirror `RunsScreen`'s explicit-`runId`, no-live-controls discipline.
- TDD, DRY, YAGNI, commit per task + trailer. Branch `020-merged-simulator`.

## Key shapes (from signature extraction — verbatim)
- `iter_preview_ticks(*, package_id, scenario_id, hyperparameter_overrides, run_seed, rest_option_id, packages_dir, scenarios_dir, profiles=None, context_overrides=None, route_source="local", route_facts=None, display_route=None) -> Iterator[PreviewFireEvent]` where `PreviewFireEvent` carries `tick_index, tick_state, decision, elapsed_min, route_facts, effective_scenario, rest_spot`. `evaluate_preview` becomes a thin consumer accumulating into today's lists.
- `proposal_run_manager` mutating fns gain `cache: dict[str, ProposalRunLog] | None = None`: if `cache is not None` read/write the dict instead of disk. `create_proposal_run(body, *, cache=None)` + `_apply_quick_check_content(..., cache=None)` thread it.
- `MergedFirePoint(FirePoint)` adds `proposal: dict|None`, `proposal_error: str|None`. `MergedInstantResult` = InstantResult fields with `fires: list[MergedFirePoint]`. `MergedQuickviewBody{package_id, scenario_id, route_preset_id, run_seed:int, mountain_range_km, jam_range_km, jam_speed_kph, hyperparameter_overrides, rest_option_id, world:World, service_package_id, content_package_id, run_seed_proposal:str}`.
- `ScoreTimeline` `FireGroup` markers are SVG `<line>`; add `onFireClick?(fire,index)` + a transparent hit-rect. `TimelineData.fires: {x,kind}[]`.
- Replay: `GET /api/runs/{id}/log` (raw trigger RunLog) + `proposal_run_manager.get_run(id, dir)` (ProposalRunLog) exist. `MergedRunHandle.correlation_log[].trigger_tick_index` is the join key. Trigger replay infra: `createReplaySource(log)→{getAt(tick)}`, `ReplayControls`, `ReplayViewer`, `RunsScreen` list-select pattern. `MergedLogPanel.buildMergedEntries` already joins trigger `TraceEntry[]` + proposal `DiscreteEvent[]` by tick.

---

## Task 1: Extract `iter_preview_ticks` generator (zero behavior change)

**Files:** Modify `app/api/aica_api/services/preview.py`; Test `app/api/tests/test_iter_preview_ticks.py`.

**Interfaces:** define `PreviewFireEvent` (dataclass/pydantic: `tick_index:int, tick_state, decision, elapsed_min:float, route_facts, effective_scenario, rest_spot`) and `iter_preview_ticks(...) -> Iterator[PreviewFireEvent]` (signature above). Move `evaluate_preview`'s setup + tick loop into the generator, yielding a `PreviewFireEvent` at the exact rising-edge `if not fire_active:` point (keeping the auto-accept side effects for non-merged callers). `evaluate_preview` becomes: build its accumulator locals, `for ev in iter_preview_ticks(...): <append into fires/score_series/segments/rest_spots_out/... exactly as today>`, return the identical dict.

- [ ] Step 1: failing test — assert `iter_preview_ticks` yields a `PreviewFireEvent` per rising-edge fire for a rest scenario (tick_index ascending; the event carries a non-None `decision.proposal`); AND a characterization test that `evaluate_preview(same args)` returns the SAME dict as a captured baseline (fired/fires/score_series length/peak/segments) — proving the refactor is behavior-preserving.
- [ ] Step 2: run `cd app/api && .venv/bin/pytest tests/test_iter_preview_ticks.py -q` and the whole existing preview suite `.venv/bin/pytest -k preview -q` → the preview suite must stay green.
- [ ] Step 3: implement the extraction.
- [ ] Step 4: run → PASS; full backend suite green (2357+; existing preview/instant-result tests byte-identical).
- [ ] Step 5: commit `feat(merged): slice2c extract iter_preview_ticks generator (no behavior change)`.

**Acceptance:** the preview loop is reusable as a generator; `evaluate_preview` output unchanged (all preview tests green).

---

## Task 2: Non-persisting proposal cache (`cache` kwarg)

**Files:** Modify `app/api/aica_api/services/proposal_run_manager.py` (`create_run`/`get_run`/`append_event`/`append_evidence`/`update_state`); Modify `app/api/aica_api/routers/proposal.py` (`create_proposal_run`/`_apply_quick_check_content` thread `cache`); Test `app/api/tests/test_proposal_cache.py`.

**Interfaces:** add `cache: dict[str, ProposalRunLog] | None = None` (keyword-only where practical) to the 5 `proposal_run_manager` fns: when `cache is not None`, read/write `cache[run_id]` instead of disk (`get_run` returns `cache.get(run_id)`; the writers do `cache[run_id]=run_log` else `_persist(...)`). `create_proposal_run(body, *, cache=None)` passes it to both `prm.create_run` sites + `_apply_quick_check_content(..., cache=cache)`, which passes it to its 3 `prm.*` calls.

- [ ] Step 1: failing test — `create_proposal_run(quick_check body, cache={})` returns a fully-resolved `ProposalRunLog` (service + content evidence present) AND writes nothing to `proposal_runs/` (assert the dir has no new file / the run_id file doesn't exist); a second test confirms `cache=None` (default) still persists exactly as before (existing behavior).
- [ ] Step 2: run → FAIL.
- [ ] Step 3: implement (additive, keyword-only; do not change any existing call site's behavior).
- [ ] Step 4: run → PASS; full backend suite green (all existing proposal-run tests unchanged — they never pass `cache`).
- [ ] Step 5: commit `feat(merged): slice2c non-persisting proposal cache kwarg`.

**Acceptance:** a quick_check proposal can be built entirely in memory; disk-backed behavior byte-identical when `cache` is omitted.

---

## Task 3: `merged_quickview` service + models + endpoint

**Files:** Modify `app/api/aica_api/models/merged_run.py` (`MergedFirePoint`/`MergedInstantResult`/`MergedQuickviewBody`); Create `app/api/aica_api/services/merged_quickview.py`; Modify `app/api/aica_api/routers/merged_runs.py` (`POST /api/merged-runs/quickview`); Test `app/api/tests/test_merged_quickview.py`.

**Interfaces:** `merged_quickview.project(body: MergedQuickviewBody, *, packages_dir, scenarios_dir, ...) -> MergedInstantResult`: build `route_facts` (reuse the plan endpoint's painter path if `mountain/jam` set), run `iter_preview_ticks(...)`; accumulate the trigger-side `InstantResult` fields (fires/score_series/segments/…) exactly as `evaluate_preview` does (reuse its accumulation helpers or call `evaluate_preview` for the trigger projection AND `iter_preview_ticks` for the fire hooks — pick the cleaner: recommended = one pass through `iter_preview_ticks`, accumulating both); at each `PreviewFireEvent` with a mapped `trigger_purpose`, `world = build_world_from_tick(World(**body.world...), ev.tick_state, trigger_purpose=map_trigger_purpose(...), lifecycle_stage=map_lifecycle_stage(...))`, then `plog = create_proposal_run(CreateProposalRunBody(world=world, mode=quick_check, ...), cache={})` and attach `plog.model_dump()` to that fire's `MergedFirePoint.proposal` (or `proposal_error` on HTTPException). Endpoint wraps it (400 on `PreviewValidationError`).

- [ ] Step 1: failing integration test (TestClient): `POST /api/merged-runs/quickview` for a rest scenario → 200 `MergedInstantResult` with `fired==True`, ≥1 `MergedFirePoint` whose `proposal` has a `rest_recommended` opportunity + ranked service evidence; assert NOTHING was written to `proposal_runs/` (ephemeral); a monotony-scenario case → fire with `inattentive_driving_prevention_recovery` proposal.
- [ ] Step 2: run → FAIL.
- [ ] Step 3: implement (reuse `merged_adapter`, `merged_painter`, `create_proposal_run(cache={})`, `iter_preview_ticks`).
- [ ] Step 4: run → PASS; full backend suite green.
- [ ] Step 5: commit `feat(merged): slice2c quickview projection endpoint`.

**Acceptance:** a single headless call projects the whole chain with a default proposal per fire, persisting nothing.

---

## Task 4: `GET /api/merged-runs/{id}` (+ list) replay-assembly endpoint

**Files:** Modify `app/api/aica_api/routers/merged_runs.py`; Test `app/api/tests/test_merged_run_get.py`.

**Interfaces:** `GET /api/merged-runs/{merged_run_id}` → `{handle, trigger_log, proposal_logs}` (pure disk reads: `get_handle` + raw `runs/<trigger_run_id>.json` + `prm.get_run` per `handle.proposal_run_ids`; 404 if handle unknown). `GET /api/merged-runs` → a list of summaries (glob `merged_runs/*.json` like `list_runs`, return `{merged_run_id, trigger_run_id, created_at?, proposal_run_ids count}`).

- [ ] Step 1: failing test: create a merged run + tick to a fire (real handle + trigger log + proposal log on disk), then `GET /api/merged-runs/{id}` → asserts `handle.trigger_run_id`, a non-null `trigger_log` with tick events, and `proposal_logs[0]` with the fire's opportunity + events; unknown id → 404; `GET /api/merged-runs` lists it.
- [ ] Step 2: run → FAIL.
- [ ] Step 3: implement (pure assembly; reuse existing loaders).
- [ ] Step 4: run → PASS; full backend suite green.
- [ ] Step 5: commit `feat(merged): slice2c merged-run GET + list (replay assembly)`.

**Acceptance:** a persisted merged run is fully reconstructable read-only via one endpoint.

---

## Task 5: Frontend quickview — clickable projection strip

**Files:** Modify `app/frontend/src/api/mergedClient.ts` (`mergedQuickview`); Modify `app/frontend/src/components/playback/ScoreTimeline.tsx` (`onFireClick` + hit-rect); Modify `app/frontend/src/components/playback/timelineData.ts` (`mergedInstantResultToTimeline` or extend); Modify `app/frontend/src/state/mergedCoordinator.tsx` (`quickview` action + `quickviewResult` state + `inspectedFireIndex`); Modify `app/frontend/src/components/merged/MergedCenterPanel.tsx` (quickview strip + inspect); Test `app/frontend/tests/merged_quickview_ui.test.tsx`.

**Interfaces:** `mergedQuickview(body) -> MergedInstantResult`. Coordinator: `quickview(body)` stores `quickviewResult`; `inspectFire(index)` sets `inspectedFireIndex`. MergedCenterPanel: when `quickviewResult` present and not playing, render a `ScoreTimeline` strip (via `mergedInstantResultToTimeline`) with `onFireClick={(f,i)=>inspectFire(i)}`; when `inspectedFireIndex != null`, render that `MergedFirePoint.proposal` in the dock overlays (read-only) via the existing `ServiceResultOverlay`/`ContentResultOverlay` fed from the ephemeral proposal's evidence. MergedSetupPanel calls `coordinator.quickview(...)` on Start (before Play), or a dedicated "Quickview" button.

- [ ] Step 1: failing test (mock clients): with a coordinator `quickviewResult` (2 fires, each with a proposal) → assert a projection `ScoreTimeline` renders with clickable fire markers; click fire #2 → assert `inspectFire(1)` and the dock shows that fire's service overlay (its `proposal.evidence`).
- [ ] Step 2: run `cd app/frontend && npx vitest run merged_quickview_ui` → FAIL.
- [ ] Step 3: implement (`onFireClick` additive on ScoreTimeline — existing usages omit it, no regression).
- [ ] Step 4: run focused + `npx tsc --noEmit` (no new merged errors); full vitest green + `ScoreTimeline` existing tests green.
- [ ] Step 5: commit `feat(merged): slice2c quickview strip + click-to-inspect`.

**Acceptance:** after setup the projection appears; clicking any fire point shows its service→content proposal without animating.

---

## Task 6: Frontend correlation replay — merged runs list + read-only viewer

**Files:** Modify `app/frontend/src/api/mergedClient.ts` (`getMergedRun`, `listMergedRuns`); Create `app/frontend/src/replay/mergedReplaySource.ts`, `app/frontend/src/components/merged/MergedReplayViewer.tsx`, `app/frontend/src/components/merged/MergedRunsScreen.tsx`; Modify `MergedShell.tsx`/`App.tsx` to add a "Runs" view toggle in merged mode; Test `app/frontend/tests/merged_replay.test.tsx`.

**Interfaces:** `getMergedRun(id) -> {handle, trigger_log, proposal_logs}`; `listMergedRuns() -> summaries[]`. `createMergedReplaySource({trigger_log, proposal_logs, correlation}) -> { tickCount, minIndex, maxIndex, getAt(tick) -> { trigger: ReplayTick|null, proposalEvents: DiscreteEvent[] } }` (reuse `createReplaySource` for the trigger side; index proposal events by `correlation_log[].trigger_tick_index`, lifting `MergedLogPanel.buildMergedEntries`'s join). `MergedReplayViewer` fetches `getMergedRun(id)`, memoizes the source, renders `ReplayControls` (reused) + a read-only merged log/trace fed by `getAt(currentTick)`. `MergedRunsScreen` lists runs (`listMergedRuns`) → select → mount `MergedReplayViewer`. Add a small "Live / Runs" toggle in merged mode (mirror `RunsScreen`'s screen-level read-only discipline).

- [ ] Step 1: failing test (mock clients): `MergedRunsScreen` lists a run; selecting it mounts `MergedReplayViewer` which fetches `getMergedRun` and renders `ReplayControls`; scrubbing to a tick with a correlated proposal event shows both the trigger trace row and the proposal event (read-only, no live controls).
- [ ] Step 2: run `npx vitest run merged_replay` → FAIL.
- [ ] Step 3: implement (compose `createReplaySource`/`ReplayControls`; new merged source joins proposal events by tick).
- [ ] Step 4: run focused + tsc (no new merged errors); full vitest green.
- [ ] Step 5: commit `feat(merged): slice2c correlation replay (list + read-only viewer)`.

**Acceptance:** a persisted merged run can be reopened and scrubbed read-only, showing the interleaved trigger+proposal timeline.

---

## Task 7: End-to-end verification
- [ ] Step 1: backend full suite green; frontend full suite green + `vite build` clean.
- [ ] Step 2: quickview + replay proven by Tasks 3/4/5/6 tests; note browser walkthrough remains a manual user step.
- [ ] Step 3: update design doc §12 (Slice 2c done → feature fully complete); update ledger + memory.
- [ ] Step 4: commit `chore(merged): slice2c e2e verification`.

## Self-Review
- Coverage: quickview (design §7.1) → T1,T2,T3,T5; correlation replay → T4,T6. No remaining deferrals after this slice (the multi-fire `proposal_suppressed` follow-up is separate/optional).
- Types: `iter_preview_ticks`/`PreviewFireEvent` (T1) → T3; `cache` kwarg (T2) → T3; `MergedInstantResult`/`MergedQuickviewBody` (T3) → `mergedQuickview` (T5); `GET /api/merged-runs/{id}` (T4) → `getMergedRun` (T6); `onFireClick` (T5) additive on ScoreTimeline.
- Risk: T1 (preview refactor) + T2 (cache threading) touch heavily-tested files — behavior-preservation characterization tests + full-suite-green are the guard.
