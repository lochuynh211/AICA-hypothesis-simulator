---
description: "Task list for M6 V1 Stabilization & UI/UX Polish"
---

# Tasks: M6 V1 Stabilization & UI/UX Polish

**Input**: Design documents from `/specs/007-stabilization-uiux/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: INCLUDED (TDD). S1 gets a regression test; backend contract surfaces (profile-override
threading, evidence ui_language + markdown, key-not-persisted) tested first; frontend slices tested.

**Organization**: by slice (the design's S1–S9). **S1 (freeze fix) lands first; S2 (three-view shell)
is foundational for the UI slices.** MVP for the V1-RC = S1 + S2 + S6 + S9 (interactive, configurable
on the Setup screen, run UC-01 unaided); the rest are polish/enhancements.

## Format: `[ID] [P?] [Story] Description`
Backend `app/api/aica_api/`, tests `app/api/tests/`; frontend `app/frontend/src/`, tests `app/frontend/tests/`.

---

## Phase 1: S1 — Fix the UI freeze (FIRST, blocking)
- [ ] T001 [US1] **Reproduce + diagnose** the "buttons unresponsive / no playback animation" freeze
  (run the app; inspect the browser console for a runtime error; prime suspects: Maps-JS script
  injection when a key is present, a thrown error in the analyze/preview path, the Play→tick loop not
  advancing). Then write a **failing frontend regression test** capturing the condition, fix the root
  cause, confirm GREEN. Document the root cause in the report.

## Phase 2: S2 — Three-view app shell (foundational UI)
- [ ] T002 [US2] `state/runStore.ts`: add `viewMode: 'setup'|'review'|'runs'` (default `'setup'`) +
  transitions (Start Run → review; New run/Setup → setup + clear run; Runs nav → runs). Tests for the
  reducer transitions.
- [ ] T003 [US2] Restructure `App.tsx` + `AppShell.tsx` to render by `viewMode`; NEW
  `components/screens/SetupScreen.tsx` hosting the relocated setup editors (PackageSelector,
  ScenarioSelector, ParameterEditor, HyperparameterEditor, MapKeyAndRouteInput, PlanPreview); the
  Review screen = the existing 3-panel composition; a NEW `RunsScreen.tsx` placeholder (filled by S4/S7);
  a header nav + "← New run / Setup" affordance. Tests: each view renders; Start Run → review; setup
  editors are on the Setup screen.

## Phase 3: S3 — Language switching (US3)
- [ ] T004 [US3] NEW `i18n/t.ts` (`t(label, lang) -> label[lang]`) + `state/runStore.ts`
  `uiLanguage: 'ja'|'en'` (default ja, session-only) + NEW `components/layout/LanguageToggle.tsx`.
  **Audit every `{ja,en}` render site** (package/scenario labels, proposals, explanations, feedback
  field labels, notices) to use `t()` — one language, never both/raw. Tests: toggle switches all labels.
- [ ] T005 [US3] Backend `routers/runs.py` `GET /evidence` accepts optional `ui_language` and records it
  (default `"bilingual"`); frontend `client.getEvidence(runId, uiLanguage)` passes the current language.
  Tests: `ui_language=ja` → report records `ja`; absent → `bilingual`.

## Phase 4: S4 — Run management (US4)
- [ ] T006 [US4] `state/runStore.ts` RESET (clear run → setup) + RESTART; `PlanPreview`/run flow:
  **restart** re-runs the current session's frozen `plan_id` from tick 0 (no re-setup). Tests.
- [ ] T007 [US4] NEW `components/runs/RunList.tsx` (from `GET /api/runs`: run_id, package, scenario,
  status, created_at) on the Runs screen; selecting a past run opens its evidence (timeline + export +
  the S7 replay), **read-only** (no restart for a past run). Tests: list renders, selecting opens evidence.

## Phase 5: S6 — Profile editor + override threading (US5) 🎯 (enables behavior tuning)
- [ ] T008 [US5] Write failing `tests/test_profile_overrides.py` then WIRE the existing-but-dropped
  `CreateRunPlanBody.profiles` in `services/run_plan.py`: parse + **validate** against
  `DriverModelProfile`/`VehicleBehaviorProfile`/`SpeedProfile` (invalid → structured error, no run);
  the draft uses the **effective** (override-or-scenario) profiles; `run_manager.create_run` snapshots
  the effective profiles into `RunLog`; `tick_engine.advance_tick` uses them; **frozen at run start**.
  Tests: override changes the run (visible in log/evidence, e.g. edited speed_profile → changed speedKph);
  no override = scenario unchanged; invalid → error/no-run; frozen (no mid-run change).
- [ ] T009 [US5] Frontend NEW `components/setup/ProfileEditor.tsx` on the Setup screen: render EVERY
  driver/vehicle/speed field, pre-filled from the selected scenario's profiles, with **reset-to-scenario-
  default**; edits sent as `profiles` in the run-plan body. Tests: fields render from scenario defaults,
  an edit threads into the run-plan body, reset restores.

## Phase 6: S7 — Visual replay (US6)
- [ ] T010 [US6] NEW `replay/replaySource.ts`: from a persisted `RunLog`, expose per-`tickIndex` recorded
  state (tick_state, raw_state, feature_groups, decision_result, route_fraction, proposal marker). Pure,
  read-only. Tests: returns the recorded values at an index; no recalculation.
- [ ] T011 [US6] Give the playback components (cockpit, route/map, decision trace) a `source` abstraction
  (live store | replay source); NEW `components/replay/ReplayControls.tsx` (tick scrubber/step) on the
  Runs view; opening a past run → read-only full 3-panel re-drive. Tests: scrubbing shows each recorded
  tick's state/markers; NO engine call / NO recalculation.

## Phase 7: S8 — Markdown export (US7)
- [ ] T012 [US7] Write failing `tests/test_evidence_markdown.py` then NEW
  `services/evidence_markdown.py` (PURE-Python; from `build_evidence_report` → a `## Simulator Facts`
  section + a separated `## Human Review` section; feedback only under Human Review; never a verdict) +
  `routers/runs.py` `GET /evidence.md` (active + on-disk). Tests: sections present + separated; consistent
  with the JSON.
- [ ] T013 [P] [US7] Frontend `components/evidence/EvidencePanel.tsx`: Markdown copy/download
  (`evidence-<run_id>.md`) alongside JSON. Tests: copy/download the markdown.

## Phase 8: S5 — Errors + cleanup + key-verify
- [ ] T014 NEW `components/common/ErrorNotice.tsx`: uniform error/notice presentation; route the
  scattered states (setup/validation/run/maps/feedback) through it. Tests.
- [ ] T015 [P] Sweep `app/` for prototype-only assumptions / dead code / TODOs and tidy (the
  `others/prototype_*` reference is UNTOUCHED). Note removals in the report.
- [ ] T016 Consolidated **verify-no-Maps-key**: `tests/test_no_maps_key_persisted.py` (a sentinel key
  through the maps flow → absent from every `runs/` log) + a frontend test (key never in localStorage/
  sessionStorage). The V1-RC criterion provably met.

## Phase 9: S9 — Integration + docs + sweep
- [ ] T017 Full UC-01 integration test (`tests/test_api_run_loop.py` or new): the whole loop for ALL
  package types (rule-based, weighted-score, python, transparent-hybrid) + the Maps surface (mocked) +
  feedback + evidence + replay-source — proving the loop works end-to-end.
- [ ] T018 [P] Update root `README.md` with the M6 run instructions (start → Setup screen config →
  run → review → feedback → find logs → export/replay → switch language) from quickstart.md.
- [ ] T019 Final stabilization sweep + `quickstart.md` docker validation (controller): every M6
  acceptance criterion; both suites green; the freeze gone; the key never persisted.

---

## Dependencies & Execution Order
- **S1 (T001)** → first (blocks usable testing). **S2 (T002–T003)** → foundational for all UI slices.
- S3/S4/S6/S7/S8 build on S2; S6 backend (T008) is independent of the shell and can proceed in parallel
  with frontend shell work. S7 (T010–T011) needs S2 + the run list (T007). S8 backend (T012) is
  independent. **S5 (T014–T016)** and **S9 (T017–T019)** last.

### Parallel Opportunities
- T008 (backend profiles) ∥ T002/T003 (frontend shell). T012 (markdown backend) ∥ frontend slices.
  T013/T015/T018 [P] within their phases.

## Implementation Strategy
**MVP (V1-RC core)** = S1 (interactive) → S2 (Setup screen) → S6 (profile tuning) → S9 (UC-01 unaided).
Then language (S3), run management (S4), replay (S7), markdown (S8), errors/cleanup (S5) as polish.

## Notes
- TDD: every test task precedes its impl and MUST fail first. S1's test reproduces the freeze.
- Determinism: profile overrides validated + frozen at run start; replay renders recorded values with NO
  recalculation; restart re-runs the same frozen plan. NO new deps.
- The Maps key is provably never persisted (T016). Profile overrides reuse the existing
  `CreateRunPlanBody.profiles` field (currently dropped — now wired).
- Total: 19 tasks (T001–T019).
