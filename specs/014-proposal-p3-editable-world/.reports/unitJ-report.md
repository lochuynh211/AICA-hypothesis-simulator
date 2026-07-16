# P3 POLISH unit (unitJ) report — MF1-MF3, T038-T039

## Status: COMPLETE

## Scope covered

### MF1 — inline world validation in the UI (US1 AC#3 / SC-002)
- `app/frontend/src/components/proposal/panels/WorldPanel.tsx`: wired
  `proposalClient.validateWorld(world)` via a 300ms-debounced `useEffect`
  keyed on `world`. Defensive `Promise.resolve().then(() => validateWorld(world))`
  chain so a non-mocked/rejecting call in tests or a real network failure
  never crashes the editor (silently caught, prior issues left as-is).
- Renders a general `world-validation-issues` summary list (bilingual
  heading via `t()`) plus an inline `feature-field-<key>-issue` message next
  to any `situation.<key>` / `driver_profile.<key>` field whose path exactly
  matches an issue (covers `driver_profile.oshi_id`, the catalog-reference
  field called out in the acceptance scenario).
- Updated `app/frontend/tests/proposal_world_panel_p3.test.tsx`'s
  `setupDefaultMocks()` to default `validateWorld` to `{valid:true,issues:[]}`.
- New `app/frontend/tests/proposal_world_validation_ui.test.tsx` (4 tests):
  valid world -> no issues anywhere; invalid world (unknown `oshi_id`
  catalog reference) -> inline + summary message; editing a field
  re-triggers `validateWorld` with the updated world; a rejected
  `validateWorld` call never crashes the panel.

### MF2 — redact the frozen catalog from persisted evidence
- `app/api/aica_api/services/proposal_selector.py`: `dispatch_selector` gained
  an optional `evidence_input_snapshot: dict | None` kwarg. When given, it is
  recorded as `AlgorithmEvidence.input_snapshot` on EVERY return path
  (success and every error path) instead of `context`; `evaluate(context)`
  itself is always called with the full, un-redacted `context` regardless.
  `None` (all existing call sites) is fully backward compatible (falls back
  to `context`, unchanged behavior).
- `app/api/aica_api/routers/proposal.py`: new `_redact_catalog_for_evidence()`
  helper (deep-copies the context, replaces `feature_snapshot.catalog` with
  `{"_redacted_catalog": {"dataset_id", "song_count"}}`); `select_service`
  builds this redacted snapshot only for the real content package
  (`aica_transparent_content_selector_v1`) + typed-world runs, and passes it
  as `evidence_input_snapshot` to `dispatch_selector`. Added `import copy`.
- New `app/api/tests/proposal/test_evidence_catalog_redaction.py` (5 tests):
  persisted evidence redacts catalog but keeps `{dataset_id, song_count}`
  reference (both via the API response and reading the on-disk JSON
  directly); persisted run stays well under 200KB (vs. ~1.5MB unredacted);
  reopened run still renders with the redacted evidence; identical world ->
  identical plan AND identical redaction marker; an `algorithm_error` is
  still recorded normally with a redacted `input_snapshot` (never suppressed
  by the redaction step).

### MF3 — extend the isolation import-guard to services
- `app/api/tests/proposal/test_p1_isolation_imports.py`: added
  `TestServicesProposalIsolation`, an explicit filename allowlist (not a
  glob, since `services/` also holds trigger modules) covering
  `dataset_catalog_registry.py`, `world_seed_store.py`, `world_clone_store.py`,
  `driver_profile_store.py`, `world_validation.py`, `proposal_selector.py`,
  `proposal_run_manager.py`, `proposal_package_registry.py`. Also generalized
  `_is_forbidden()` to reject any `mdg`/`mdg.*` import (previously only
  checked in the models/proposal test's docstring, not enforced in code).
  No real violations found — all 8 modules were already clean.

### T038 — FR-021 boundary guard
- New `app/api/tests/proposal/test_boundary_p3.py` (4 tests): only a MOCK
  `service_selector` package is registered (no real one); the only
  non-mock proposal package anywhere is the content selector; STEP 1
  (`create_proposal_run`) actually dispatches `mock_service_selector_v1`;
  no `/api/proposal/*` route path contains
  eligibility/narrow/motion-state/schedule/journey/progress/advance
  substrings (with a sanity check that the real in-scope routes are still
  present, guarding against a vacuous pass).

### T039 — determinism / read-only / reopen-no-recompute
- New `app/api/tests/proposal/test_determinism_readonly_p3.py` (4 tests):
  (a) `proposal_contracts/dataset/` is byte-identical (sha256 over every
  file, hashed before/after) across a full create-run + real STEP-2 session,
  including exercising the read-only dataset endpoints; (b) `GET /runs/{id}`
  never invokes `dispatch_selector` — proven by monkeypatching it to raise
  (still 200, identical persisted output) and separately by pointing
  `AICA_PACKAGES_DIR` at an empty directory after the run exists (still 200,
  identical output); (c) identical world -> identical plan over the typed
  World + real content selector path.

## Verify

- Backend: `cd app/api && uv run pytest -q` -> **1713 passed, 3 skipped, 0
  failed** (pyc cache cleared first, though some stale root-owned `.pyc`
  files could not be removed due to permissions — pytest re-compiled/ran
  correctly regardless; count is consistent with "no accidental
  under-collection").
- Frontend: `cd app/frontend && CI=true npx vitest run` -> **53 files / 501
  tests passed, 0 failed**. Pre-existing `act(...)` console warnings (50
  occurrences both before and after this change, confirmed via `git stash`)
  are unrelated to this unit.
- `npm run build` -> clean, no errors/warnings.
- No Pydantic model shapes changed (only a service-layer optional kwarg and
  router-layer helper), so `export_schema` was not re-run.

## Constraints honored
- ISOLATION preserved; no new pyproject deps; the extended isolation-guard
  test (MF3) found zero violations — no proposal-scoped module imports the
  trigger `aica_api.models` or `mdg`.
- MF2: `evaluate()` always receives the full, un-redacted context; only the
  persisted `AlgorithmEvidence.input_snapshot` is redacted; the returned
  `CompletePlan` is byte-identical to the unredacted-context path (verified
  against `test_step2_real_content.py`'s existing assertions plus new
  determinism checks); `algorithm_error` evidence is still recorded normally.
- Catalog stays read-only (T039a directly verifies this via a directory hash).
- Frontend: 3-panel layout unchanged; JA default preserved; bilingual
  (`t()`) used for new UI copy; `proposalStore` isolation unaffected (no
  `runStore` import added).

## Files changed
- `app/api/aica_api/routers/proposal.py`
- `app/api/aica_api/services/proposal_selector.py`
- `app/api/tests/proposal/test_p1_isolation_imports.py`
- `app/api/tests/proposal/test_boundary_p3.py` (new)
- `app/api/tests/proposal/test_determinism_readonly_p3.py` (new)
- `app/api/tests/proposal/test_evidence_catalog_redaction.py` (new)
- `app/frontend/src/components/proposal/panels/WorldPanel.tsx`
- `app/frontend/tests/proposal_world_panel_p3.test.tsx`
- `app/frontend/tests/proposal_world_validation_ui.test.tsx` (new)

## Concerns
- None blocking. Minor: the general `world-validation-issues` list and the
  per-field inline message can both show the same issue text (intentional
  duplication per the task's "inline ... (or a clear issues list)" wording —
  chosen to satisfy both phrasings rather than picking one).
- The debounce (300ms) is a UX tuning knob, not a contract — safe to adjust
  later without touching tests (they use `waitFor`, not fake timers).
