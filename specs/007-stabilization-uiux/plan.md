# Implementation Plan: M6 V1 Stabilization & UI/UX Polish

**Branch**: `007-stabilization-uiux` | **Date**: 2026-06-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-stabilization-uiux/spec.md`

**Companion ADR**: [docs/superpowers/specs/2026-06-28-m6-stabilization-uiux-design.md](../../docs/superpowers/specs/2026-06-28-m6-stabilization-uiux-design.md)

## Summary

The V1 release candidate, built as internal slices: **S1** fix the UI-freeze blocker (first);
**S2** a three-view app shell (`viewMode: setup|review|runs` store toggle — no router) relocating
the setup editors onto a Setup screen; **S3** JA/EN language switching (a `t()` helper, `uiLanguage`
store, the export records the selected language); **S4** reset/restart (session-scoped, same plan) +
a Runs view listing past runs from `runs/`; **S5** uniform error surfacing + prototype cleanup +
a consolidated verify-no-Maps-key check; **S6** a Setup-screen profile editor (all driver/vehicle/
speed fields) whose edits thread through the **already-present** `CreateRunPlanBody.profiles` field
(currently dropped — now validated + frozen at run start + used by the tick engine); **S7** a visual
replay (a replay-source feeding the playback components read-only, a tick scrubber, on the Runs view —
no recalculation); **S8** a pure-Python Markdown evidence export; **S9** full UC-01 integration tests
+ README + final sweep. No new dependencies.

## Technical Context

**Language/Version**: Python 3.12 (backend, uv); TypeScript 5 / Node 18 (frontend, Vite 5).

**Primary Dependencies**: FastAPI, Pydantic v2 (backend); React 18, Vite 5 (frontend). **No new deps**
(view-mode toggle not a router; `t()` helper not an i18n library; pure-Python Markdown not a library).

**Storage**: File-based `runs/` JSON (unchanged). Profile overrides are frozen into the run snapshot;
the Maps key is never persisted.

**Testing**: pytest + httpx (backend); Vitest + Testing Library (frontend).

**Target Platform**: Local Docker Compose; browser :5180, api :8137.

**Project Type**: Web application — `app/api` + `app/frontend`.

**Constraints**: Deterministic pipeline unchanged — profile overrides validated + **frozen at run
start** (no mid-run change); replay renders recorded values with **no recalculation**; evidence
append-only + facts/review separated; backend source of truth; Maps key provably never persisted; no
new deps. S1's root cause is unknown until reproduced (investigation deliverable).

**Scale/Scope**: Single user; UC-01 packages/scenarios; the V1 release candidate.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|-----------|--------|----------|
| I. Backend Is The Source Of Truth | ✅ Pass | Profile overrides validated/frozen backend; export+markdown backend; replay renders the recorded log; frontend renders only. |
| II. Evidence Append-Only / Failures Never Hidden | ✅ Pass | Evidence unchanged + facts/review separated; errors surfaced honestly; overrides recorded in the snapshot/export. |
| III. Deterministic, Replayable | ✅ Pass | Overrides frozen at run start (no mid-run change); replay renders recorded values with NO recalculation; restart re-runs the same frozen plan. |
| IV. Qualitative Trigger Discipline | ✅ Pass | Profile editing is setup-time scenario-behavior config; no external-service numeric on a trigger path. |
| V. One Generic Algorithm Adapter Contract | ✅ Pass | Adapter/decision/tick pipeline untouched (the tick engine reads the effective profiles, same as before). |
| VI. Local-First Simplicity (YAGNI) | ✅ Pass | View-toggle/helper/formatter, no libraries; reuse existing endpoints; no DB/cloud; no new deps. |
| Security & Safety Boundaries | ✅ Pass | Maps key still never persisted — now an explicit consolidated verification (S5). |
| Dev Workflow & Quality Gates | ✅ Pass | Spec-driven; contract surfaces (profile-override threading, evidence ui_language + markdown, replay-source, run list) tested first (TDD); S1 gets a regression test. |

**Result: PASS — no violations.** Complexity Tracking empty.

**Post-design re-check (after Phase 1):** PASS — no DB/cloud, no new deps; the deterministic pipeline +
append-only evidence are preserved; profile overrides frozen; replay read-only. No new violations.

## Project Structure

### Documentation (this feature)
```text
specs/007-stabilization-uiux/
├── plan.md  research.md  data-model.md  quickstart.md
├── contracts/
│   ├── profile-overrides.md   # CreateRunPlanBody.profiles wiring + validate + freeze + effective profiles
│   └── evidence-language-markdown.md  # GET /evidence?ui_language + GET /evidence.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (by slice)
```text
# S1 — fix the UI freeze (investigation-driven)
app/frontend/src/...            # the file(s) the diagnosis points to + a regression test

# S2 — three-view app shell
app/frontend/src/App.tsx + components/layout/AppShell.tsx   # render by viewMode setup|review|runs
app/frontend/src/components/screens/SetupScreen.tsx (NEW)   # relocate the setup editors here
app/frontend/src/components/screens/RunsScreen.tsx (NEW)    # run list + past-run evidence/replay
app/frontend/src/state/runStore.ts                          # viewMode: 'setup'|'review'|'runs'; transitions
# (the Review screen = the existing 3-panel CenterPlaybackPanel/Left/Right composition)

# S3 — language switching
app/frontend/src/i18n/t.ts (NEW)                            # t(label, uiLanguage) -> label[lang]
app/frontend/src/components/layout/LanguageToggle.tsx (NEW) # header JA/EN toggle
app/frontend/src/state/runStore.ts                          # uiLanguage: 'ja'|'en' (default ja)
# audit every {ja,en} render site to use t(); api/client.ts getEvidence(runId, uiLanguage)
app/api/aica_api/routers/runs.py                            # GET /evidence accepts ui_language

# S4 — run management
app/frontend/src/components/runs/RunList.tsx (NEW)          # GET /api/runs list; open a past run
app/frontend/src/state/runStore.ts                         # RESET / RESTART actions
app/frontend/src/components/setup/PlanPreview.tsx          # restart re-runs the current plan_id

# S5 — errors + cleanup + key-verify
app/frontend/src/components/common/ErrorNotice.tsx (NEW)    # uniform error/notice presentation
app/... sweep for prototype-only assumptions / dead code / TODOs
app/api/tests/test_no_maps_key_persisted.py (NEW) + frontend storage test  # consolidated verify

# S6 — profile editor + override threading
app/api/aica_api/services/run_plan.py                      # use CreateRunPlanBody.profiles: validate
#   (DriverModelProfile/VehicleBehaviorProfile/SpeedProfile) -> effective profiles in the draft (was dropped)
app/api/aica_api/routers/run_plans.py / scenarios.py       # expose scenario profiles for prefill if needed
app/api/aica_api/services/run_manager.py / tick_engine     # effective (override-or-scenario) profiles used + frozen
app/frontend/src/components/setup/ProfileEditor.tsx (NEW)  # all driver/vehicle/speed fields + reset-to-default

# S7 — visual replay
app/frontend/src/replay/replaySource.ts (NEW)              # RunLog -> per-tick recorded state
app/frontend/src/components/playback/*                      # accept a 'source' (live store | replay) abstraction
app/frontend/src/components/replay/ReplayControls.tsx (NEW) # tick scrubber/step; on the Runs view

# S8 — Markdown export
app/api/aica_api/services/evidence_markdown.py (NEW)       # pure-Python md from build_evidence_report
app/api/aica_api/routers/runs.py                           # GET /evidence.md (or format param)
app/frontend/src/components/evidence/EvidencePanel.tsx     # copy/download .md alongside JSON

# S9 — integration + docs
app/api/tests/test_api_run_loop.py / a UC-01 integration test (all package types + maps mocked + feedback + evidence + replay)
README.md
```

**Structure Decision**: extends the M1–M5 tree. The biggest structural change is the frontend
three-view shell (S2); the backend changes are small and additive (wire the existing `profiles`
field, add `ui_language` to `/evidence`, add `/evidence.md`). The decision/tick/adapter pipeline and
the append-only evidence model are unchanged; profile overrides are frozen, replay is read-only.

## Complexity Tracking

> No constitution violations. Table intentionally empty. (M6 is large but sliced; each slice leaves
> the app runnable.)

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
