# HTMLApp Combined Export — C4: The Merged Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the merged layer — the Combined screen's own engine, which drives a trigger run and a proposal run as one correlated timeline — so the offline htmlapp serves all fourteen `merged.*` operations behind the worker seam.

**Architecture:** New `src/engine/merged/` mirroring `app/api/aica_api/services/merged_*.py` plus the endpoint bodies of `routers/merged_runs.py`; a new `src/storage/merged_runs_store.ts` for run handles; a new `src/engine/worker/handlers/merged.ts` registering fourteen ops.

**Tech Stack:** TypeScript 5.8, Vitest 1.6, `idb` (already a dependency), Python 3.12 for capture. No new dependencies.

## Why this is the headline gate

C1–C3 ported leaves: algorithms, the proposal engine, explanation prose. Each was verifiable against a golden in isolation. C4 is the join — it is the only slice whose product is *the screen the customer actually uses*. Everything before it is scaffolding for this.

It is also the slice where an unexercised branch stops being a wrong number or a wrong sentence and becomes **a wrong correlation between a trigger fire and the proposal it caused** — the exact claim the tool exists to let a reviewer audit.

## Global Constraints

- **No new runtime or dev dependencies.** `idb` is already present; use it.
- **The Python is the behaviour of record.** Never edit `packages/`, `app/api/`, or `app/frontend/`. If port and Python disagree, the port is wrong; if you believe the Python is wrong, stop and report.
- **Never edit an existing golden** to make a port pass.
- No changes under `src/components/**`.
- Reuse, do not rewrite: `src/data/packages/builtin/mathUtils.ts` (`neumaierSum`, `pyFixed`), the C1 `pyFloatRepr` helper, `src/engine/explanation/*` (C3), `src/engine/proposal/*` (C2).
- Capture rig: `PYTHONPATH=app/api app/api/.venv/bin/python htmlapp/frontend/scripts/gen/capture_all.py` from the repo root; deterministic, a re-run leaves `git status` clean.
- `grep -rn "PINNED-TO-C1" htmlapp/frontend/tests` must keep returning nothing.
- Run npm commands from `htmlapp/frontend/`. Verify with `npm test` and `npm run typecheck`.
- **Report the single-file build size in every task.** `build:singlefile` is the customer deliverable against a hard 3 MB cap (owner decision). It was 1.43 MB entering C4; this slice adds the most code of any, so watch it.
- **Every count in a report must be followed by the command that produced it and that command's raw output, verbatim.** A bare number is an unsupported claim. Label commands accurately — `grep -c` counts lines, `grep -o | wc -l` counts occurrences.

## Hazard ranking for this slice

C3's product was prose, so hazard 7 dominated. C4's product is **correlated state over time**, which re-ranks them again:

- **Hazard 4 (dict/insertion order) is the primary risk.** The merged layer builds ordered event lists, correlation entries and per-tick histories, and the UI renders them in order. Any place Python's dict or list order feeds output, the port must reproduce it structurally — via a construct whose ordering is guaranteed — not incidentally.
- **Hazard 3 (`//` and `%` floor toward −∞; JS truncates toward zero)** matters wherever tick counts, minute conversions or stage boundaries are computed. Negative operands are the trap; prove whether any input can go negative before declaring the site safe.
- **Hazard 1 (banker's rounding)** applies to every tick→minute and score→display conversion.
- **Hazards 5–8** still apply. Report them honestly rather than skipping the check.

## Two invariants a port will "helpfully" break

Both are documented in the Python's own docstrings. Both look like oversights and are not:

1. **`MergedInstantResult.fire` (singular) is deliberately UNAUGMENTED.** `fires[]` carries `MergedFirePoint` (with the projected proposal); the singular back-compat `fire` stays a plain `FirePoint` because the setup-strip UI reads it for a "first trigger" marker and does not want a proposal. Augmenting it for consistency is a defect.
2. **`proposal` and `proposal_error` are NEVER both set**, and both are `None` only when the fire's `result_type` had no mapped `trigger_purpose`. The same pairing holds for `after_rest_proposal` / `after_rest_proposal_error`. This is a three-state encoding in two nullable fields — assert all three states.

---

### Task 1: The `cache` seam — the functional blocker

**This must land first.** C2's `run_manager.ts` documented this gap (lines 35-40) and did not implement it: every writer persists through `proposalRunsStore` unconditionally. `merged.quickview` and `merged.afterRestProposal` build **non-persisting** proposal runs via `create_proposal_run(..., cache={})`. Without this seam, every quickview permanently pollutes the user's persisted run list — a data-integrity defect, not a cosmetic one.

**Files:**
- Modify: `src/engine/proposal/run_manager.ts`
- Test: `tests/proposal_run_manager_cache.test.ts`
- Reference (read, never edit): `services/proposal_run_manager.py` lines 23-33 (contract), 131-204 (`create_run`), 219-229 (`get_run`), 287-297 (`update_state`)

**Interfaces produced:** **five** functions gain an optional trailing cache argument — `createRun`, `getRun`, `appendEvent`, `appendEvidence`, `updateState`. Python's is keyword-only (`*, cache=None`); mirror it in TS as an optional final parameter on an options object so no positional call site changes.

`listRuns`, `deleteRun` and `appendExplanation` **do not** take a cache in Python and must not gain one here. This is coherent by design, not an upstream gap: `create_proposal_run` forwards `cache` only to the five above, and `append_explanation` is called solely on a persisted run id (`routers/proposal.py:2254`), so the `cache={}` path never reaches any of the three. Verified — nothing in the repo passes `cache=` to them.

- [x] **Step 1** — enumerate all eight candidates and state, per function, what Python does when `cache is not None`. Report before coding. Do not assume symmetry — only five actually take a cache.
- [ ] **Step 2** — write failing tests first. The load-bearing assertion is **negative**: with a cache supplied, the IDB store is never written. Assert that directly (spy or post-hoc store read), not merely that the returned object looks right — a port that writes to both would pass a positive-only test.
- [ ] **Step 3** — implement. `cache` absent must remain byte-identical to today's behaviour; every existing call site keeps working untouched.
- [ ] **Step 4** — remove the now-stale comment at `run_manager.ts:35-40` describing the gap, and confirm no other file documents it as unported.
- [ ] **Step 5** — verify, size, commit.

---

### Task 2: `merged_adapter` and `merged_painter`

Pure functions, no I/O — the most testable code in the slice. Port together.

**Files:**
- Create: `src/engine/merged/adapter.ts`, `src/engine/merged/painter.ts`
- Modify: `scripts/gen/capture_all.py`
- Test: `tests/merged_adapter_port.test.ts`, `tests/merged_painter_port.test.ts`
- Reference: `services/merged_adapter.py` (172 LOC) — `map_trigger_purpose`, `map_lifecycle_stage`, `map_road_type`, `build_world_from_tick`; `services/merged_painter.py` (136 LOC) — `inject_mountain_segment`, `jam_traffic_event`

- [ ] **Step 1** — enumerate; report before coding.
- [ ] **Step 2** — capture, driven from real committed trigger goldens so `build_world_from_tick` sees tick states the engine really produces.
- [ ] **Step 3** — failing tests, then port.
- [ ] **Step 4** — hazard pass. `map_lifecycle_stage` takes three inputs (`fired`, `result_type`, `recovery_phase`) — a small cross-product; enumerate it exhaustively rather than sampling.
- [ ] **Step 5** — branch coverage: every `result_type` `map_trigger_purpose` recognises **plus** at least one it does not (the unmapped case is load-bearing — it is what makes both `proposal` and `proposal_error` `None`); every `segment_type` `map_road_type` maps plus its fallback.
- [ ] **Step 6** — verify, size, commit.

---

### Task 3: Merged models and the run-handle store

**Files:**
- Create: `src/engine/merged/types.ts`, `src/storage/merged_runs_store.ts`
- Test: `tests/merged_runs_store.test.ts`
- Reference: `models/merged_run.py` (308 LOC); `services/merged_run_coordinator.py` (126 LOC) — `make_merged_run_id`, `create_handle`, `save_handle`, `get_handle`

A merged run handle is the join record: it points at one trigger run and the proposal runs its fires created. Python persists it as JSON under `merged_runs_dir`; htmlapp persists it in a new IDB object store alongside the existing run stores.

- [ ] **Step 1** — enumerate the model fields and the coordinator's four functions; report before coding.
- [ ] **Step 2** — failing tests, then port. Follow the established store shape in `src/storage/runs_store.ts` and `proposal_runs_store.ts` — same DB, new object store, same version-upgrade discipline.
- [ ] **Step 3** — **the IDB double-rejection trap.** Both existing stores wrap writes as `try { …; await tx.done } catch (err) { tx.done.catch(() => {}); throw err }`. Without the inner catch an aborted transaction rejects `tx.done` with nobody awaiting it, producing an unhandled rejection that crashes the worker. Reuse the pattern; add a test that forces an abort and asserts no unhandled rejection.
- [ ] **Step 4** — schema upgrade: adding an object store bumps the IDB version. Test the upgrade path from a database created at the previous version — an existing user's runs must survive.
- [ ] **Step 5** — verify, size, commit.

---

> **BLOCKED and re-planned 2026-08-02.** Task 4 returned BLOCKED rather than
> improvising: `merged_quickview.project()` reduces to `create_proposal_run(...,
> cache={})`, and **none of the eleven names `merged_runs.py` imports from
> `routers.proposal` were ported.** C2 ported the proposal *components*
> (eligibility, selector, journey, run_manager, stores) but not the orchestrator
> that composes them. Measured by transitive call-walking: 1,750 LOC across 29
> reachable functions, plus `models/proposal/matrix.py` (193). Tasks 6, 7 and 8
> would each have hit the same gap.
>
> **Slice C4a now precedes Tasks 4-10** —
> `docs/superpowers/plans/2026-08-02-htmlapp-combined-c4a-proposal-orchestration.md`.
> **C4a COMPLETE 2026-08-02 (c292ba0), acceptance passed all 7 steps** — all 11
> imported names ported and confirmed non-stub, and a composed run verified
> field-by-field against real Python (10,323 leaf fields, 0 mismatches outside
> clock/random ids). Tasks 4-10 resume from here.

### Task 4: `merged_quickview`

**Files:**
- Create: `src/engine/merged/quickview.ts`
- Modify: `scripts/gen/capture_all.py`
- Test: `tests/merged_quickview_port.test.ts`
- Reference: `services/merged_quickview.py` (312 LOC) — `project`, `_project_fire`, `_project_after_rest`, `_with_tick_seconds`, `_readable_error_text`, `_readable_validation_text`

Depends on Task 1's cache seam (this is its only consumer at this point) and Task 2's adapter.

- [ ] **Step 1** — enumerate; report before coding.
- [ ] **Step 2** — capture from real preview passes.
- [ ] **Step 3** — failing tests, then port.
- [ ] **Step 4** — hazard pass, hazard 4 first: `project` returns ordered `fires[]`, `score_series[]`, `progress[]` and `monotony_series[]`, all rendered in order.
- [ ] **Step 5** — **assert the two invariants from this plan's preamble as explicit tests**: (a) `fire` (singular) has no `proposal` key while `fires[0]` does; (b) all three states of the `proposal`/`proposal_error` pairing — proposal set, error set, and both `None` for an unmapped `result_type`. The third needs a fire whose `result_type` `map_trigger_purpose` does not map; Task 2's enumeration tells you which.
- [ ] **Step 6** — **prove nothing persisted.** After running a quickview in a test, assert the proposal-run store is empty. This is the payoff for Task 1 and the defect the seam exists to prevent.
- [ ] **Step 7** — verify, size, commit.

---

### Task 5: Setup endpoints — plan, create, get, list

**Files:**
- Create: `src/engine/merged/run_setup.ts`
- Modify: `scripts/gen/capture_all.py`
- Test: `tests/merged_run_setup_port.test.ts`
- Reference: `routers/merged_runs.py` — `_make_trigger_run_id`, `_make_merged_plan_id`, `_readable_error_text`, `_build_quickview_route_facts` (lines 363-444), and the endpoint bodies at 216 (`plan`), 681 (`create`), 712 (`get`), 756 (`list`)

Port the endpoint **bodies** as plain functions. HTTP framing (status codes, path params) belongs to Task 9's handlers, not here.

- [ ] **Step 1** — enumerate; report before coding. Note which `HTTPException`s each body raises and with what detail — the error text is user-visible and must survive the port.
- [ ] **Step 2** — capture; failing tests; port.
- [ ] **Step 3** — hazard pass.
- [ ] **Step 4** — branch coverage across each body's validation failures, not just its happy path. An error path that returns the wrong message is a real defect here because the Combined screen renders it.
- [ ] **Step 5** — verify, size, commit.

---

### Task 6: The tick endpoint

`tick_merged_run_endpoint` is 272 LOC — the single largest function in the slice and the heart of the Combined screen. It gets its own task.

**Files:**
- Create: `src/engine/merged/tick.ts`
- Modify: `scripts/gen/capture_all.py`
- Test: `tests/merged_tick_port.test.ts`
- Reference: `routers/merged_runs.py` lines 934-1206, plus `_serialize_trigger_tick` (183) and `_override_nap_stage_ticks` (784)

- [ ] **Step 1** — enumerate the control flow before writing anything: this function advances the trigger run, decides whether the tick's outcome creates or updates a proposal run, and emits a `CorrelationEntry`. Draw that decision tree in the report first.
- [ ] **Step 2** — capture **whole tick sequences**, not isolated ticks. A merged run is stateful; a per-tick fixture cannot catch an error that only appears on the third fire. Capture at least one full run that fires more than once.
- [ ] **Step 3** — failing tests, then port.
- [ ] **Step 4** — hazard pass. Hazard 3 (`//`/`%`) is most likely here — tick↔minute conversion and nap-stage overrides. For each such site state whether the operand can be negative, with evidence.
- [ ] **Step 5** — branch coverage: tick with no fire; tick with a fire that creates a proposal; tick with a fire that updates an existing one; tick during recovery; the nap-stage override path. Name which the golden reaches.
- [ ] **Step 6** — **correlation is the product.** Assert that the `CorrelationEntry` a tick emits points at the proposal run that tick actually created — not merely that one exists. A port that emits a well-formed entry pointing at the wrong run passes every shape check and defeats the tool's purpose.
- [ ] **Step 7** — verify, size, commit.

---

### Task 7: Action endpoints — accept-rest, decline, proposal-action

**Files:**
- Create: `src/engine/merged/actions.ts`
- Modify: `scripts/gen/capture_all.py`
- Test: `tests/merged_actions_port.test.ts`
- Reference: `routers/merged_runs.py` lines 824-892 (`accept-rest`), 892-934 (`decline`), 1206-1327 (`proposal-action`), plus `_override_nap_stage_ticks` (784) if Task 6 did not already own it — say which task ported it and do not port it twice

- [ ] **Step 1** — enumerate; report before coding. State explicitly where `_override_nap_stage_ticks` lives after this task.
- [ ] **Step 2** — capture; failing tests; port.
- [ ] **Step 3** — hazard pass.
- [ ] **Step 4** — branch coverage: every `JourneyAction` kind `proposal-action` dispatches on, plus its rejection paths. C2's journey engine already enumerates the twelve actions — reuse that enumeration rather than rebuilding it.
- [ ] **Step 5** — **append-only discipline.** These endpoints mutate run state. Assert that each appends rather than rewrites: the event list after an action must contain everything it contained before, in the same order, plus the new entry.
- [ ] **Step 6** — verify, size, commit.

---

### Task 8: Explanation and review-feedback endpoints

**Files:**
- Create: `src/engine/merged/explain.ts`, `src/engine/merged/review_feedback.ts`
- Modify: `scripts/gen/capture_all.py`
- Test: `tests/merged_explain_port.test.ts`, `tests/merged_review_feedback_port.test.ts`
- Reference: `routers/merged_runs.py` lines 553-600 (`explain`), 600-681 (`explain-trigger`), 1327-1366 (POST `review-feedback`), 1366-1415 (GET `review-feedback`)

This is where C3's explanation layer is finally consumed by a caller. `explain-trigger` routes through `services/trigger_explanation` (C3 Task 2); `explain` through `explanation_builder` (C3 Tasks 1 and 4).

- [ ] **Step 1** — enumerate; report before coding.
- [ ] **Step 2** — capture; failing tests; port.
- [ ] **Step 3** — **the LLM provider gap.** C3 Task 4 dropped Ollama (`provider: 'backend'`) because the offline build has no server, and specified — but deliberately did not code — what an htmlapp caller receives if it asks for it. **You implement it.** Read the contract in `.superpowers/sdd/2026-08-01-htmlapp-combined-c3-explanation/task-4-report.md` and mirror it exactly. A merged endpoint that silently falls back to a template while reporting `backend` would misattribute which provider produced a rationale — the same defect C3 refused. Note the five ported façade functions take no `provider` parameter: dispatch is router-level in Python, so it is router-level here too.
- [ ] **Step 3b** — **the error must survive the RPC boundary.** C3 Task 4's review flagged this and it is easy to miss: `serializeError`'s generic fallback in `src/api/rpc.ts` preserves only `type` and `message`, so a custom field on the error class (the contract's `readonly provider = 'backend'`) is silently dropped in transit. `RunPlanError` and `MapsError` each have a dedicated branch for exactly this reason — follow that precedent and add one. Test the round trip through the real worker seam, not just the throw site: an error that serializes correctly in-process and loses a field over RPC is invisible until a user hits it.
- [ ] **Step 4** — branch coverage across the three providers (`off`, `browser`, and the refused `backend`) and both feedback verbs.
- [ ] **Step 5** — **this task lands C3's entire explanation layer in the bundle for the first time.** Through C3 the builds were byte-identical because nothing outside `engine/explanation/` imported the façade, so tree-shaking dropped all four modules. Your handler is the first reachable importer. Expect a real jump; report the before/after single-file total and multi-file split, and attribute the delta.
- [ ] **Step 6** — verify, size, commit.

---

### Task 9: Worker ops — registration and the RPC contract

**Files:**
- Create: `src/engine/worker/handlers/merged.ts`
- Modify: `src/engine/worker/router.ts`, `src/api/rpc.ts`
- Test: `tests/merged_ops.test.ts`
- Reference: the fourteen routes listed in `routers/merged_runs.py`

`router.ts` is typed `Record<RpcOp, (params: any) => Promise<unknown>>` — exhaustive over the `RpcOp` union. Widening `RpcOp` without adding a handler is therefore a **compile error**, which is the completeness gate for this task. Use it: add all fourteen op names to `RpcOp` first and let `npm run typecheck` enumerate what is missing.

The fourteen: `merged.plan`, `merged.quickview`, `merged.afterRestProposal`, `merged.explain`, `merged.explainTrigger`, `merged.create`, `merged.get`, `merged.list`, `merged.acceptRest`, `merged.decline`, `merged.tick`, `merged.proposalAction`, `merged.reviewFeedback.post`, `merged.reviewFeedback.get`.

- [ ] **Step 1** — widen `RpcOp` with all fourteen; run `npm run typecheck` and paste the resulting error list into the report. That list is your task definition.
- [ ] **Step 2** — failing tests, then implement each handler as a thin adapter over Tasks 4-8. Handlers own HTTP framing (path params, status codes, error shape); they must contain no engine logic.
- [ ] **Step 3** — **round-trip each op through the real worker seam**, not by calling the handler directly. A handler that works in isolation and is unreachable through `dispatch.ts` is the exact failure the C0 install-gate review caught.
- [ ] **Step 4** — verify no op is registered but unreachable, and none reachable but unregistered.
- [ ] **Step 5** — verify, size, commit.

---

### Task 10: C4 acceptance

- [ ] **Step 1** — clean-state: `rm -rf data public/aica-data.js dist`, then `npm run build:data && npm test && npm run typecheck && npm run build && npm run build:singlefile`. Expect 0 failing, 0 skipped; both builds exit 0. **Report BOTH the single-file total against the 3 MB cap AND the app/data split** (the multi-file `check-size.mjs` run prints the split; the single-file run prints only the total). Report all three numbers. Rationale: `scripts/check-size.mjs` applies `APP_MAX`/`DATA_MAX` only on the multi-file path, so the single-file build — now the customer deliverable — is gated by one aggregate number with no app/data separation. Entering C4 the measured figures are: multi-file **app 0.63 MB / data 0.96 MB / total 1.58 MB**, and single-file **1.43 MB**. Do not subtract one build's numbers from the other's — the split is only meaningful on the multi-file build. This slice adds the most code of any; C5 still has ~15.6k LOC of UI after it. Surfacing the split here is what makes a squeeze visible before C5 rather than during it.
- [ ] **Step 2** — capture reproducibility: re-run the rig, `git status` clean.
- [ ] **Step 3** — port boundary: `git diff --stat $(git merge-base develop HEAD)..HEAD -- app/ packages/` empty.
- [ ] **Step 4** — **the full-session op transcript.** The ADR requires 6 whole-session transcripts as C4's parity evidence, above the per-module goldens. Drive one complete Combined session — plan → create → tick to a fire → proposal-action → accept-rest → tick through recovery → explain → review-feedback — through the worker seam in TS and through the Python endpoints, and diff the op-by-op results. Per-module goldens cannot catch a state divergence that only appears when the ops run in sequence.
- [ ] **Step 5** — **prove the non-persisting path stays non-persisting** end to end: run a quickview through the real seam, then list runs, and assert nothing was added.
- [ ] **Step 6** — confirm no `backend`/Ollama code path shipped: grep the built output for any HTTP call to a local model server.
- [ ] **Step 7** — tick the checkboxes and commit, only if every check passed.

---

## Self-Review

**Spec coverage.** Against the ADR's C4 row — the merged layer and its fourteen ops: the cache seam it depends on (T1), adapter and painter (T2), models and handle storage (T3), quickview (T4), setup endpoints (T5), tick (T6), actions (T7), explanation and feedback (T8), op registration (T9), acceptance (T10). All fourteen routes are assigned: plan/create/get/list → T5; quickview/after-rest → T4; explain/explain-trigger/review-feedback ×2 → T8; accept-rest/decline/proposal-action → T7; tick → T6. Covered.

**Why the cache seam is Task 1 and not folded into Task 4.** It modifies C2's already-reviewed `run_manager.ts` rather than adding new code, so it carries a regression risk the rest of the slice does not, and it deserves its own reviewer gate. Folding it into the quickview task would bury an eight-function change to reviewed code inside a 312-LOC port.

**Why tick gets its own task.** At 272 LOC it is larger than three of the other tasks combined, it is the only stateful-across-calls endpoint, and the correlation entry it emits is the product claim of the whole tool.

**Why the hazard ranking is restated per-slice.** C1's list was written for numeric ports and C3's for prose. This slice's output is correlated state over time, so hazard 4 (order) leads and hazard 3 (floor division on tick arithmetic) rises. Stating it once at the top is cheaper than each task rediscovering it.

**Type consistency.** `map_trigger_purpose` → `mapTriggerPurpose`, `map_lifecycle_stage` → `mapLifecycleStage`, `map_road_type` → `mapRoadType`, `build_world_from_tick` → `buildWorldFromTick`, `inject_mountain_segment` → `injectMountainSegment`, `jam_traffic_event` → `jamTrafficEvent`, `make_merged_run_id` → `makeMergedRunId`, `create_handle` → `createHandle`, `save_handle` → `saveHandle`, `get_handle` → `getHandle`, `project` → `project`. Endpoint bodies take the name of their op in camelCase (`quickview`, `afterRestProposal`, `explainTrigger`, `proposalAction`).
