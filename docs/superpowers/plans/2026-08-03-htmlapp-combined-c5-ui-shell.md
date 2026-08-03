# HTMLApp Combined Export — C5: UI and Shell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Combined screen's UI into htmlapp and make it the only screen the shell renders — keeping the tab structure intact, per the owner's requirement.

**Architecture:** The docker app's network access is entirely contained in three `api/` client files. htmlapp re-implements those three over the worker RPC seam and marks them PROTECTED; everything above them — `components/merged`, `components/review`, `lib/review`, and the merged/proposal/review state modules — syncs verbatim and compiles unchanged because the clients keep their exported signatures.

**Tech Stack:** React 18, TypeScript 5.8, Vite, Vitest 1.6. No new dependencies.

## The survey that shapes this slice

Three facts were established by direct measurement before this plan was written. Each is load-bearing; re-verify rather than assume if the tree has moved.

**1. The network seam is contained.** Every raw `fetch`/`XMLHttpRequest`/`WebSocket`/`EventSource` in `app/frontend/src` lives in exactly three files:

```
api/client.ts          5 sites
api/proposalClient.ts  5 sites
api/mergedClient.ts    1 site
```

Zero in `components/`, `state/`, `lib/`, `replay/`. htmlapp's already-synced tree has zero live `fetch` calls. This is why ~9k LOC of UI can sync untouched: it never talks to the network directly.

**2. The sync exclusion list is currently the exact inverse of what ships.** `scripts/sync-from-app.mjs`'s `EXCLUDE` was written when htmlapp shipped Trigger only, and it excludes precisely the Combined surface:

| Excluded today | LOC | Needed by Combined |
|---|---|---|
| `components/merged/` (14 files) | 4,564 | yes |
| `components/review/` (11 files) | 2,403 | yes |
| `lib/review/` (9 files) | 1,958 | yes |
| `state/mergedCoordinator.tsx` | 656 | yes |
| `state/proposalStore.ts` | 598 | yes |
| `state/reviewStore.tsx` | 155 | yes |
| `state/appMode.tsx` | 43 | yes |
| `state/languageBridges.tsx` | 39 | yes |
| `replay/mergedReplaySource.ts` | 134 | yes |
| `api/mergedClient.ts` | 448 | re-implement, not sync |
| `api/proposalClient.ts` | 1,166 | re-implement, not sync |

Roughly 12.2k LOC total, of which ~10.5k syncs and ~1.6k is re-implemented.

**3. Combined uses far less of `proposalClient` than its size suggests.** Of 1,166 LOC, the entire Combined surface imports exactly **three** value exports — `getPackages`, `getPreset`, `getPresets` — all three of which map to `proposal.*` ops C2 already registered. Everything else it takes from that file is **type-only** (`CompletePlan`, `EvidenceError`, `OrderedItem`, `ProposalRunLog`, `DiscreteEvent`, `DriverProfile`, `ProposalPackageSummary`, `Situation`, `RankedCandidate`, `ExcludedCandidate`), and types erase at runtime.

**The trap this hides:** `proposalClient.ts` is also where the two *merged* explain endpoints are called, via raw `fetch('/api/merged-runs/explain')` and `fetch('/api/merged-runs/explain-trigger')` on absolute paths that deliberately bypass the file's own `apiFetch` helper (the endpoints sit outside its base path). Anyone who reasons "Combined only needs three functions from proposalClient" will drop them and silently lose the explain feature in the offline build — it compiles, tests pass, and it fails only when a user clicks Explain at `file://`.

## Global Constraints

- **No new runtime or dev dependencies.**
- **Never edit `packages/`, `app/api/`, or `app/frontend/`.** The docker app is the behaviour of record.
- Run npm from `htmlapp/frontend/`. Verify with `npm test` and `npm run typecheck`.
- `grep -rn "PINNED-TO-C1" htmlapp/frontend/tests` must keep returning nothing.
- **Report the single-file total AND the multi-file app/data split in every task.** `build:singlefile` is the customer deliverable against a hard 3 MB cap; `check-size.mjs` prints the app/data split only on the multi-file path. This slice adds the most UI of any.
- **Every count in a report must be followed by the command that produced it and that command's raw output, verbatim.** Label commands accurately — `grep -c` counts lines, `grep -o | wc -l` counts occurrences.
- A synced file is never hand-edited in htmlapp. If a synced file will not compile, the fix goes in a PROTECTED file or in the sync script's transform step — never in the synced copy, which the next sync would silently revert.

---

### Task 1: Re-implement `mergedClient` over the RPC seam

**Files:**
- Create: `htmlapp/frontend/src/api/mergedClient.ts`
- Modify: `htmlapp/frontend/scripts/sync-from-app.mjs` (add to `PROTECTED`, remove from `EXCLUDE`)
- Test: `htmlapp/frontend/tests/merged_client.test.ts`
- Reference (read, never edit): `app/frontend/src/api/mergedClient.ts` (448 LOC)

Depends on C4's fourteen `merged.*` ops.

The twelve exports to reproduce, with their reference counts across the Combined surface (measure again — do not trust these): `createMergedRun` (2), `tickMergedRun` (2), `mergedProposalAction` (2), `acceptRest` (8), `declineRest` (7), `buildMergedPlan` (4), `mergedQuickview` (3), `afterRestProposal` (2), `getMergedRun` (3), `listMergedRuns` (3), `postReviewFeedback` (2), `getReviewFeedback` (2).

- [ ] **Step 1** — enumerate every export with its exact signature and its `merged.*` op. Report before coding. Signatures must match the app's **character for character** — synced components compile against them.
- [ ] **Step 2** — failing tests, then implement each as a thin RPC call. No logic here; the engine is in C4.
- [ ] **Step 3** — `mergedClient.ts` has one raw `fetch` (its `apiFetch` helper). Confirm your re-implementation has **zero** `fetch` calls, by grep, and paste the output.
- [ ] **Step 4** — error mapping: the app's helper turns non-2xx into typed errors the UI renders. Mirror the error shape exactly; a component that switches on an error type must behave identically.
- [ ] **Step 5** — add to `PROTECTED`, remove from `EXCLUDE`, verify a sync run does not overwrite it.
- [ ] **Step 6** — verify, report both sizes, commit.

---

### Task 2: Re-implement `proposalClient` — the three functions, the two explain calls, and all the types

**Files:**
- Create: `htmlapp/frontend/src/api/proposalClient.ts`
- Modify: `htmlapp/frontend/scripts/sync-from-app.mjs`
- Test: `htmlapp/frontend/tests/proposal_client.test.ts`
- Reference: `app/frontend/src/api/proposalClient.ts` (1,166 LOC)

- [ ] **Step 1** — enumerate what the Combined surface actually needs, by measurement, and report before coding: which value exports, and which type-only exports. Re-derive the list; the survey above may be stale.
- [ ] **Step 2** — **the explain functions are not optional.** `explain`/`explainTrigger` call `/api/merged-runs/explain` and `/api/merged-runs/explain-trigger` by raw absolute-path `fetch`, bypassing this file's own `apiFetch`. They route to C4 Task 8's `merged.explain` / `merged.explainTrigger` ops. Port them. State in your report how you found every raw-fetch site rather than only the ones reachable from a named import.
- [ ] **Step 3** — types: every type a synced file imports must exist and be structurally identical, or the sync will not typecheck. Enumerate them from the synced tree's imports, not from the app file's export list.
- [ ] **Step 4** — decide what to do about value exports Combined does **not** use (profile writes, run deletion — the app calls these on `PROPOSAL_API_BASE` paths). Omitting them is fine if nothing imports them; if you keep any, it must have a real op behind it. **Do not ship a function that silently no-ops** — an unimplemented path must throw a clear error, not pretend to succeed.
- [ ] **Step 5** — confirm zero `fetch` calls by grep; paste the output.
- [ ] **Step 6** — add to `PROTECTED`, remove from `EXCLUDE`, verify sync leaves it alone.
- [ ] **Step 7** — verify, report both sizes, commit.

---

### Task 3: Sync the Combined UI

**Files:**
- Modify: `htmlapp/frontend/scripts/sync-from-app.mjs` (`EXCLUDE` removals)
- Synced in: `components/merged/`, `components/review/`, `lib/review/`, `state/{appMode,proposalStore,mergedCoordinator,reviewStore,languageBridges}`, `replay/mergedReplaySource.ts`

- [ ] **Step 0** — **`replay/mergedReplaySource.ts` carries a known upstream bug; syncing it verbatim inherits it.** `merged_runs.py` builds `proposal_event_ids` as `f"{e.event_type}@{e.at}"`, which under Python 3.11+ yields `"DiscreteEventType.MEMBER@..."` (the enum is a `(str, Enum)` mixin with no `__str__`), while `mergedReplaySource.ts:102` builds its lookup key from the serialized log's bare `.value`. The two can never match, so every event falls through to the fallback that buckets them all at the last entry's tick — per-tick replay attribution silently does not work. Report what you intend to do before syncing: inherit it faithfully (consistent with "the docker app is the behaviour of record"), or diverge deliberately. **Do not fix it silently**, and do not fix `app/frontend`.
- [ ] **Step 1** — remove the Combined entries from `EXCLUDE`; run the sync; report exactly what arrived (`git status --porcelain | wc -l` plus the file list) with raw output.
- [ ] **Step 2** — run `npm run typecheck`. Expect fallout. Report the **complete** error list before fixing anything.
- [ ] **Step 3** — fix the fallout **in PROTECTED files or the sync transform only**. A synced file is never hand-edited — the next sync reverts it silently, which is a defect that reappears months later with no trace. If a synced file genuinely cannot work unmodified, say so and stop; that is a design question, not a patch.
- [ ] **Step 4** — re-run the sync a second time and confirm `git status` is unchanged. A sync that is not idempotent will overwrite the fixes it just needed.
- [ ] **Step 5** — verify, report both sizes (this is the slice's largest single size jump — say how much), commit.

---

### Task 4: The shell — one honest tab

**Files:**
- Modify: `htmlapp/frontend/src/App.tsx` (already PROTECTED, htmlapp-owned)
- Test: `htmlapp/frontend/tests/shell_modes.test.tsx`

The owner's requirement: *"we don't need trigger screen and proposal anymore, but we don't want to change the structure of the code, so just keep the tab structure, but we just export and show combine screen only."*

So the mode machinery stays exactly as the app has it; htmlapp restricts which modes are enabled and renders one tab.

- [ ] **Step 1** — read `state/appMode.tsx` (43 LOC, newly synced) and report how the app enumerates modes before changing anything.
- [ ] **Step 2** — set the enabled set to Combined only, in `App.tsx`. Do not delete the Trigger or Proposal components, do not alter `appMode.tsx`, and do not change the tab component's structure — the requirement is explicitly to keep it.
- [ ] **Step 3** — test that exactly one tab renders, that it is Combined, and that the app boots into it with no mode-switch UI dead-end.
- [ ] **Step 4** — **check whether the disabled screens still get bundled.** They are unreferenced from the enabled path, so tree-shaking should drop them — but a barrel import (`export * from './screens'`) defeats that and silently costs bundle bytes against a hard-capped deliverable. Verify by measurement, not inspection: compare the bundle with and without the Trigger/Proposal component tree reachable, and report both numbers.
- [ ] **Step 5** — verify, report both sizes, commit.

---

### Task 5: C5 acceptance

- [ ] **Step 1** — clean-state: `rm -rf data public/aica-data.js dist`, then `npm run build:data && npm test && npm run typecheck && npm run build && npm run build:singlefile`. 0 failing, 0 skipped; both builds exit 0. Report single-file total and the multi-file app/data split.
- [ ] **Step 2** — sync idempotence: run the sync twice; `git status` unchanged after the second.
- [ ] **Step 3** — port boundary: `git diff --stat $(git merge-base develop HEAD)..HEAD -- app/ packages/` empty.
- [ ] **Step 4** — **zero-network proof.** `grep -rn "\bfetch(\|XMLHttpRequest\|new WebSocket\|EventSource" htmlapp/frontend/src` must show no live call outside a comment. Paste the raw output. This is the invariant the whole slice rests on: at `file://` there is no server, and a single surviving raw fetch is a feature that fails only in the customer's hands.
- [ ] **Step 5** — **open the actual deliverable.** Load `dist/index.html` from `file://` in a real browser, drive one Combined session end to end, and confirm no console errors. Every earlier check is a proxy for this one. The multi-file build is known to blank-page at `file://` (Vite emits a CORS-fetched module script and `file://` origin is `null`) — single-file is the deliverable and is what must be opened.
- [ ] **Step 6** — tick the checkboxes and commit, only if every check passed.

---

## Self-Review

**Spec coverage.** Against the ADR's C5 row — UI and shell, Combined only, tab structure preserved: the two client re-implementations that let the UI sync unchanged (T1, T2), the sync itself (T3), the shell restriction (T4), acceptance including a real `file://` walkthrough (T5). Covered.

**Why the clients are re-implemented and everything else is synced.** Because measurement said so: all 11 raw network calls in the app live in three `api/` files and none live above them. That is what makes a ~10.5k-LOC verbatim sync safe, and it is the single fact that would most change this plan if it stopped being true.

**Why `proposalClient` gets its own task despite Combined using three of its functions.** Its size is misleading in both directions: most of it is unreachable, but it also hides the two merged explain calls behind raw absolute-path fetches that no import list reveals. A task scoped from the import list alone would drop them and lose the explain feature in a way tests do not catch.

**Why Task 4 measures the bundle instead of reasoning about tree-shaking.** "Unreferenced code gets dropped" is true until a barrel export makes it referenced. Against a hard-capped deliverable that is worth a number, not an assumption.

**Type consistency.** Both re-implemented clients keep the app's exported names and signatures exactly — that is the contract that lets synced components compile untouched. `mergedClient`: `createMergedRun`, `tickMergedRun`, `mergedProposalAction`, `acceptRest`, `declineRest`, `buildMergedPlan`, `mergedQuickview`, `afterRestProposal`, `getMergedRun`, `listMergedRuns`, `postReviewFeedback`, `getReviewFeedback`. `proposalClient`: `getPackages`, `getPreset`, `getPresets`, `explain`, `explainTrigger`, plus the type-only surface.
