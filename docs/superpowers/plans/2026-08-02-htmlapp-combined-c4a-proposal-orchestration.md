# HTMLApp Combined Export — C4a: The Proposal Orchestration Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the proposal-router internals the merged layer calls directly, so C4's remaining tasks have the dependency they assumed existed.

**Architecture:** New `src/engine/proposal/orchestrator/` mirroring the reachable half of `app/api/aica_api/routers/proposal.py`, plus `src/engine/proposal/matrix.ts` for `models/proposal/matrix.py`. These are *functions*, not HTTP handlers — the RPC surface stays where it is.

**Tech Stack:** TypeScript 5.8, Vitest 1.6, Python 3.12 for capture. No new dependencies.

## Why this slice exists (a planning gap, found by being blocked)

C4 Task 4 (`merged_quickview`) returned BLOCKED rather than improvising, and it was right to.

`merged_runs.py` imports eleven names directly from `routers.proposal` — not over HTTP, but as Python functions:

```
$ sed -n '/^from aica_api.routers.proposal import (/,/^)/p' app/api/aica_api/routers/merged_runs.py
    CreateProposalRunBody, ExplainRequestBody, ExplainResponse, SelectServiceBody,
    _generate_explanation, apply_journey_action, create_proposal_run,
    explain_from_run_log, get_proposal_run, recompute_proposal_run, select_service,
```

**None of them are ported.** Slice C2 ported the proposal *components* — `eligibility`, `selector`, `journey`, `run_manager`, `stores`, `world_overrides`, `world_validation`, `algorithm_config` — but not the orchestrator that composes them into a run. The parts exist; the assembly does not.

The mistake was mine, and worth naming so it is not repeated: an earlier note recorded that "merged endpoints call proposal router internals, not HTTP — only 4 `proposal.*` ops are needed, not the whole Proposal API." That note was correct. It means only four functions need *exposing as RPC ops* — it does not mean only four need *porting*. C4's plan was written against the second reading.

Task 4 is simply the first task to hit the gap. Tasks 6, 7 and 8 would each have hit it again.

## Scope, measured not estimated

Reachability computed by transitively walking calls from the seven merged-facing orchestrators through every `def` in `routers/proposal.py`:

| | LOC | Functions |
|---|---|---|
| Reachable from the orchestrators | 1,750 | 29 |
| `models/proposal/matrix.py` | 193 | — |
| **In scope** | **~1,943** | **30** |
| Not reachable — HTTP endpoints, profile/seed/dataset CRUD | 460 | 16 |

The 460 unreachable LOC stay unported. If a later task needs one of them, that is a finding, not a silent extension — say so rather than absorbing it.

**Known limitation of that measurement, found by Task 3.** The walk followed `def`s *within* `routers/proposal.py` only; it did not follow calls into `models/` or `services/`. Task 3 hit the first consequence — `_freeze_setup_snapshot` calls `World.project()` (`models/proposal/world.py:497-541`, ~55 LOC), which no task had been assigned. It ported it rather than blocking, correctly: 55 pure lines needed by an in-scope function is not the 1,943-LOC gap that justified a BLOCKED. A follow-up sweep of model/service methods reached from the in-scope set found one further gap, now written into Task 7: **`prompt_hash`**. Both are accounted for; the lesson is that the boundary is per-module, so a task finding a small unported model-layer helper should port it and say so.

## Global Constraints

- **No new runtime or dev dependencies.**
- **The Python is the behaviour of record.** Never edit `packages/`, `app/api/`, or `app/frontend/`. If port and Python disagree, the port is wrong; if you believe the Python is wrong, stop and report.
- **Never edit an existing golden entry.** Adding entries is expected.
- No changes under `src/components/**`.
- **Reuse, do not rewrite.** C2 (`src/engine/proposal/`), C3 (`src/engine/explanation/`), C4 Tasks 1-3 (`src/engine/merged/`, `src/storage/merged_runs_store.ts`), and `src/data/packages/builtin/mathUtils.ts` (`neumaierSum`, `pyFixed`) are all ported and reviewed. A `pyFloatRepr` also exists. `pyFixed` mirrors a `:.Nf` format spec; `pyFloatRepr` mirrors a bare `str(float)` — do not conflate them or write a third.
- **These are functions, not endpoints.** Port the function bodies. HTTP framing (status codes, path params, `Depends`) belongs to C4's handler tasks. Where Python raises `HTTPException`, mirror the error *shape* so a caller can map it, and say how you did.
- Capture rig from the repo root: `PYTHONPATH=app/api app/api/.venv/bin/python htmlapp/frontend/scripts/gen/capture_all.py`. Deterministic — a second run leaves `git status` clean.
- `grep -rn "PINNED-TO-C1" htmlapp/frontend/tests` must keep returning nothing.
- Run npm from `htmlapp/frontend/`. Verify with `npm test` and `npm run typecheck`. Expect 0 failing, 0 skipped. **Baseline entering this slice: 647 passing.**
- **Report the single-file build size** (`npm run build:singlefile`); baseline 1,498,985 bytes against a hard 3 MB cap — the customer deliverable.
- **Every count in a report must be followed by the command that produced it and that command's raw output, verbatim.** Label commands accurately — `grep -c` counts lines, `grep -o | wc -l` counts occurrences.

## Hazard ranking for this slice

- **Hazard 8 (`isinstance(x,(int,float))` accepts bool; `typeof x === 'number'` rejects it) must be decided PER SITE.** Six tasks have now found six different distributions — 4-of-4 accepting, 1-of-10, 10-of-11, an intra-file split where one function accepts bool and another rejects it *on the same field*, and two files with none at all. No level of aggregation is safe to generalise over.
- **Hazard 4 (dict/insertion order)** — these functions build the run log and evidence records the UI renders in order. Reproduce ordering structurally, not incidentally.
- **Hazard 1 (banker's rounding)** and **hazard 3 (`//`/`%` floor toward −∞)** apply wherever scores and tick/minute arithmetic appear.
- **Hazards 5-7** (float repr, Neumaier `sum()`, `:.Nf`) apply wherever a float reaches a string or a comparison.

## "Ported-to-green is not evidence"

This program has repeatedly found ports that passed their golden and still diverged, because no fixture reached the other branch. Every task's report must state, per conditional, which branches the golden exercises and which it does not, add cases for reachable gaps, and say explicitly where a case reaches a branch but produces output identical to a neighbour.

If you add coverage and find the test cannot distinguish correct from incorrect behaviour, **say so**. Three tasks in this program have reported exactly that and it was the most valuable content in each.

---

### Task 1: Foundation — `matrix.py` and the small resolvers

Everything else depends on these. Small, mechanical, and worth its own gate so later tasks build on reviewed ground.

**Files:**
- Create: `src/engine/proposal/matrix.ts`, `src/engine/proposal/orchestrator/context_base.ts`
- Modify: `scripts/gen/capture_all.py`
- Test: `tests/proposal_matrix_port.test.ts`, `tests/proposal_context_base.test.ts`
- Reference: `models/proposal/matrix.py` (193 LOC); in `routers/proposal.py` — `_resolve_run_setup` (29), `_make_opportunity_id` (12), `_get_service_capabilities` (5), `_get_registry` (5), `_get_dataset_registry` (5), `_service_capabilities_path` (4), `_now_iso` (4), `_matrix_path` (4)

- [ ] **Step 1** — enumerate; report before coding. The `_get_*` accessors and `_*_path` helpers read files or module state in Python; state how each maps to htmlapp's data registry (`src/data/registry.ts`) instead, since there is no filesystem.
- [ ] **Step 2** — `_now_iso` and `_make_opportunity_id` involve a clock. Say how the port stays deterministic under test, following the `makeProposalRunId`/`makeMergedRunId` precedent already established and reviewed in this codebase.
- [ ] **Step 3** — capture, failing tests, port.
- [ ] **Step 4** — hazard pass; branch-coverage table.
- [ ] **Step 5** — verify, report size, commit.

---

### Task 2: The context builders

**Files:**
- Create: `src/engine/proposal/orchestrator/context.ts`
- Modify: `scripts/gen/capture_all.py`
- Test: `tests/proposal_context_port.test.ts`
- Reference: `_build_service_context` (44), `_build_content_context` (56), `_build_real_content_context` (76), `_resolve_oshi_artist` (31), `_genre_affinity_artist_genres` (20), `_resolve_song_name` (19), `_resolve_song_artist` (19), `_dataset_id_for_run` (17), `_catalog_map_for_dataset` (14), `_redact_catalog_for_evidence` (35)

~331 LOC. These turn a run's setup plus the song/service catalogs into the context the selectors consume.

- [ ] **Step 1** — enumerate; report before coding. Note which read the catalog and how that maps to the data registry.
- [ ] **Step 2** — capture from **real committed catalog data**, not invented songs — these functions resolve real artist/genre/song relationships and a synthetic catalog would not exercise the lookup paths.
- [ ] **Step 3** — failing tests, then port.
- [ ] **Step 4** — hazard pass. `_redact_catalog_for_evidence` shapes what gets persisted into evidence; ordering matters (hazard 4).
- [ ] **Step 5** — branch coverage: the oshi-artist resolution has several falsy short-circuits, and a prior slice found three of them collapse to an identical result. Where that recurs, disclose it rather than counting each as ordinary coverage.
- [ ] **Step 6** — verify, report size, commit.

---

### Task 3: `create_proposal_run`

The orchestrator C4 Task 4 was blocked on. 281 LOC plus `_freeze_setup_snapshot` (80).

**Files:**
- Create: `src/engine/proposal/orchestrator/create_run.ts`
- Modify: `scripts/gen/capture_all.py`
- Test: `tests/proposal_create_run_port.test.ts`
- Reference: `create_proposal_run` (`routers/proposal.py` lines 818-1098), `_freeze_setup_snapshot` (80)

- [ ] **Step 1** — enumerate the control flow before writing anything: this resolves setup, freezes a snapshot, builds context, runs eligibility, dispatches the service selector, optionally dispatches content, and writes a run log. Draw that sequence in the report first.
- [ ] **Step 2** — **the `cache` parameter is the reason C4 Task 1 exists.** Python's signature takes `cache: dict[str, ProposalRunLog] | None`; when supplied, the run is built entirely in memory and never persisted. `src/engine/proposal/run_manager.ts` already has the seam on `createRun`/`getRun`/`appendEvent`/`appendEvidence`/`updateState`. Thread it through faithfully — this is what makes `merged.quickview` non-persisting, and getting it wrong corrupts the user's evidence record.
- [ ] **Step 3** — capture, failing tests, port.
- [ ] **Step 4** — hazard pass, all eight.
- [ ] **Step 5** — branch coverage: quick-check versus full mode, content dispatched versus not, eligibility rejecting every candidate, and the `cache` supplied versus absent paths.
- [ ] **Step 6** — **prove the non-persisting path.** With a cache supplied, assert the proposal-run store is untouched. Make the assertion negative (the store was not written), not merely that the return value looks right — an implementation writing to both would pass a positive-only test.
- [ ] **Step 7** — verify, report size, commit.

---

### Task 4: `select_service` and content dispatch

**Files:**
- Create: `src/engine/proposal/orchestrator/select_service.ts`
- Modify: `scripts/gen/capture_all.py`
- Test: `tests/proposal_select_service_port.test.ts`
- Reference: `select_service` (164), `_dispatch_content_for_service` (88), `_apply_quick_check_content` (141)

~393 LOC. `_apply_quick_check_content` is the largest helper in the slice.

- [ ] **Step 1** — enumerate; report before coding.
- [ ] **Step 2** — capture; failing tests; port.
- [ ] **Step 3** — hazard pass.
- [ ] **Step 4** — branch coverage. An earlier slice established that `quick_check` mode and the interactive path **share the content-dispatch code** deliberately, so that the two stay at parity. Verify that sharing survives the port rather than becoming two implementations that can drift.
- [ ] **Step 5** — verify, report size, commit.

---

### Task 5: `recompute_proposal_run`

324 LOC — the largest single function in the slice, and the one that mutates an existing run.

**Files:**
- Create: `src/engine/proposal/orchestrator/recompute.ts`
- Modify: `scripts/gen/capture_all.py`
- Test: `tests/proposal_recompute_port.test.ts`
- Reference: `recompute_proposal_run` (`routers/proposal.py` lines 1492-1815)

- [ ] **Step 1** — enumerate the control flow and report it before coding. **`recompute_proposal_run` also calls `_freeze_setup_snapshot`, which Task 3 already ported** as `freezeSetupSnapshot` in `orchestrator/create_run.ts`, together with `projectWorld` (its port of `World.project()`, `models/proposal/world.py:497-541`). Import both; do not re-port them.
- [ ] **Step 2** — capture; failing tests; port.
- [ ] **Step 3** — hazard pass, hazard 4 first: recompute appends to history collections the UI renders in order.
- [ ] **Step 4** — **append-only discipline.** This mutates a run. Assert that it appends rather than rewrites: everything present before must still be present afterwards, in the same order, plus the new entries. A recompute that silently rewrites history defeats the evidence record the tool exists to provide.
- [ ] **Step 5** — branch coverage across each recompute trigger and each field it can change.
- [ ] **Step 6** — verify, report size, commit.

---

### Task 6: `apply_journey_action` and `get_proposal_run`

**Files:**
- Create: `src/engine/proposal/orchestrator/journey_action.ts`
- Modify: `scripts/gen/capture_all.py`
- Test: `tests/proposal_journey_action_port.test.ts`
- Reference: `apply_journey_action` (53), `get_proposal_run` (18)

- [ ] **Step 1** — enumerate; report before coding.
- [ ] **Step 2** — capture; failing tests; port.
- [ ] **Step 3** — branch coverage across every journey action kind and its rejection paths. C2's `journey.ts` already enumerates the twelve actions — reuse that enumeration rather than rebuilding it, and say whether all twelve reach this function.
- [ ] **Step 4** — append-only: assert the event list grows and never loses an entry.
- [ ] **Step 5** — verify, report size, commit.

---

### Task 7: `explain_from_run_log` and `_generate_explanation`

Where C3's explanation layer finally gets a caller.

**Files:**
- Create: `src/engine/proposal/orchestrator/explain.ts`
- Modify: `scripts/gen/capture_all.py`
- Test: `tests/proposal_explain_port.test.ts`
- Reference: `explain_from_run_log` (98), `_generate_explanation` (68), `_find_explain_target` (36)

- [ ] **Step 1** — enumerate; report before coding.
- [ ] **Step 2** — **the LLM provider decision lands here.** C3 Task 4 dropped Ollama (`provider: 'backend'`) because the offline build has no server, and specified — but did not code — what a caller asking for it receives. Read the contract in `.superpowers/sdd/2026-08-01-htmlapp-combined-c3-explanation/task-4-report.md` and implement it. `off` and `browser` both survive and must mirror Python exactly. A silent fallback to a template while reporting `backend` would misattribute which provider produced a rationale — the defect C3 refused.
- [ ] **Step 3** — **`prompt_hash` is not ported and you need it.** `_generate_explanation` calls `explanation_builder.prompt_hash(prompt)` (`routers/proposal.py:2214`) and stores the result on every `Explanation` (`models/proposal/explanation.py:67`). C3 deliberately left it out — `src/engine/explanation/builder.ts:14` says so explicitly. **Byte-parity matters here:** the hash is persisted evidence, so an offline build that hashes differently from docker makes the two records incomparable, which is the premise this whole program rests on. Port it against `explanation_builder.py:718`, and verify the digest against a live Python interpreter rather than assuming the algorithms agree.
- [ ] **Step 4** — capture; failing tests; port.
- [ ] **Step 5** — branch coverage across the three providers, every `_find_explain_target` outcome, and both explanation steps.
- [ ] **Step 6** — verify, report size, commit.

---

### Task 8: C4a acceptance

- [ ] **Step 1** — clean-state: `rm -rf data public/aica-data.js dist`, then `npm run build:data && npm test && npm run typecheck && npm run build && npm run build:singlefile`. 0 failing, 0 skipped; both builds exit 0. Report the single-file total and the multi-file app/data split.
- [ ] **Step 2** — capture reproducibility: re-run the rig, `git status` clean.
- [ ] **Step 3** — port boundary: `git diff --stat $(git merge-base develop HEAD)..HEAD -- app/ packages/` empty.
- [ ] **Step 4** — **prove the gap is closed.** For each of the eleven names `merged_runs.py` imports from `routers.proposal`, show the TypeScript counterpart that now exists. Any still missing is a finding — report it rather than closing the slice.
- [ ] **Step 5** — **independent spot-check:** drive one `create_proposal_run` with a fixed input through the real Python and through the port, and compare the resulting run logs field by field. This slice's product is a composed run, so verify the composition, not only its parts.
- [ ] **Step 6** — confirm the 460 out-of-scope LOC stayed unported, and that nothing quietly pulled one of those functions in.
- [ ] **Step 7** — tick the checkboxes and commit, only if every check passed.

---

## Self-Review

**Spec coverage.** All eleven names `merged_runs.py` imports are assigned: `create_proposal_run` → T3; `select_service` → T4; `recompute_proposal_run` → T5; `apply_journey_action` and `get_proposal_run` → T6; `explain_from_run_log` and `_generate_explanation` → T7; the four body/response models are type declarations that land with their consuming task. Foundation and context builders (T1, T2) are dependencies of all of them.

**Why this is a slice and not a C4 task.** ~1,943 LOC across 30 functions, comparable to C2 or C3. Folding it into one C4 task would put a slice-sized port behind a single review gate, which is exactly the granularity this process exists to avoid.

**Why Task 1 leads.** Every other task calls the resolvers and the matrix. Porting them first means later tasks build on reviewed ground rather than each stubbing what it needs.

**Why the boundary is stated as a measurement.** The 460 unreachable LOC were computed by transitive call-walking, not judgement, so a later task that needs one of them has a clear signal that the boundary moved rather than quietly widening it.

**Type consistency.** `create_proposal_run` → `createProposalRun`, `select_service` → `selectService`, `recompute_proposal_run` → `recomputeProposalRun`, `apply_journey_action` → `applyJourneyAction`, `get_proposal_run` → `getProposalRun`, `explain_from_run_log` → `explainFromRunLog`, `_generate_explanation` → `generateExplanation`, `_freeze_setup_snapshot` → `freezeSetupSnapshot`, `_resolve_run_setup` → `resolveRunSetup`, `_build_service_context` → `buildServiceContext`, `_build_content_context` → `buildContentContext`, `_build_real_content_context` → `buildRealContentContext`, `_apply_quick_check_content` → `applyQuickCheckContent`, `_dispatch_content_for_service` → `dispatchContentForService`, `_find_explain_target` → `findExplainTarget`, `_make_opportunity_id` → `makeOpportunityId`.
