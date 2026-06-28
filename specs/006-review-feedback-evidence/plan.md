# Implementation Plan: M5 Review Feedback & Evidence Completeness

**Branch**: `006-review-feedback-evidence` | **Date**: 2026-06-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-review-feedback-evidence/spec.md`

**Companion ADR**: [docs/superpowers/specs/2026-06-28-m5-review-feedback-evidence-design.md](../../docs/superpowers/specs/2026-06-28-m5-review-feedback-evidence-design.md)

## Summary

Complete the human-review evidence loop. Add a `FeedbackEvent` (append-only) and a fixed V1
categorical feedback schema (master §13.2) + optional per-package extras; validate submitted
feedback against the effective schema (V1 ∪ extras) and against the persisted log (target
`event_ref` references a real event). Endpoints: `POST /api/runs/{id}/feedback` (active run →
its recorder; inactive run → **disk-backed** load-append-repersist), `GET .../feedback-schema`,
`GET .../evidence`. The evidence export derives the full master §14.2 report from the persisted
`RunLog`, separating `simulator_facts` from `human_review`; reproducible per §14.3. Persist the
**driver/vehicle/speed profiles** into `RunLog` (M2 carry-forward) so the export carries them.
Frontend: a schema-driven `FeedbackForm`, upgrade `RunLogViewer` into a read-only evidence
timeline (feedback visually distinct), and copy/download of the evidence JSON. No new deps;
feedback never alters facts or feeds an algorithm; replay never recalculates.

## Technical Context

**Language/Version**: Python 3.12 (backend, uv, pinned deps); TypeScript 5 / Node 18 host
(frontend, Vite 5).

**Primary Dependencies**: FastAPI, Pydantic v2, uvicorn (backend); React 18, Vite 5 (frontend).
**No new dependencies** (no Markdown library — Markdown deferred to M6).

**Storage**: File-based JSON append-only run logs in `runs/`. Feedback appends `FeedbackEvent`s;
inactive runs are append via a disk-backed load-append-repersist path.

**Testing**: pytest + httpx (backend); Vitest + Testing Library (frontend).

**Target Platform**: Local single-developer Docker Compose; browser :5180, api :8137.

**Project Type**: Web application — `app/api` + `app/frontend`.

**Performance Goals**: None beyond a responsive local loop.

**Constraints**: Feedback is append-only human evidence — NEVER alters a recorded decision,
NEVER feeds an algorithm; the simulator never auto-judges. Feedback is event-precisely traceable
(`event_ref`). The evidence timeline + export render from the persisted log with NO algorithm
recalculation (determinism preserved). Export separates `simulator_facts` from `human_review` and
carries §14.3 reproducibility data. Works for any persisted run (active or on-disk). No new deps.

**Scale/Scope**: Single user; the existing UC-01 packages/scenarios; V1 feedback labels fixed.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|-----------|--------|----------|
| I. Backend Is The Source Of Truth | ✅ Pass | Schema, validation, append, and evidence export are all backend-owned. |
| II. Evidence Append-Only / Failures Never Hidden | ✅ Pass | Feedback is append-only; separated from facts in the export; never alters recorded decisions; invalid feedback recorded nothing; the simulator never auto-judges. |
| III. Deterministic, Replayable | ✅ Pass | The timeline + export render from the persisted log WITHOUT recalculation; feedback never affects decisions; reproducibility data preserved (§14.3). |
| IV. Qualitative Trigger Discipline | ✅ Pass | Feedback is post-hoc human input; it never reaches a trigger or feature path. |
| V. One Generic Algorithm Adapter Contract | ✅ Pass | M5 does not touch the adapter or the decision pipeline. |
| VI. Local-First Simplicity (YAGNI) | ✅ Pass | Pure Python + React; no Markdown lib, no DB, no new deps; reuse the recorder + file store. |
| Security & Safety Boundaries | ✅ Pass | Feedback is human review text; no secrets; standard handling. |
| Dev Workflow & Quality Gates | ✅ Pass | Spec-driven; contract surfaces (feedback validation, schema, evidence export, disk-backed append) tested first (TDD). |

**Result: PASS — no violations.** Complexity Tracking empty.

**Post-design re-check (after Phase 1):** PASS — research.md, data-model.md, contracts/,
quickstart.md add no DB/cloud, no new deps; keep the append-only recorder + file store as
boundaries; feedback strengthens principle II (human review separated from facts). No new violations.

## Project Structure

### Documentation (this feature)
```text
specs/006-review-feedback-evidence/
├── plan.md  research.md  data-model.md  quickstart.md
├── contracts/
│   ├── feedback-api.md     # POST /feedback + GET /feedback-schema + effective schema + validation
│   └── evidence-export.md  # GET /evidence: master §14.2 contents, facts vs human_review
├── checklists/requirements.md
└── tasks.md                # /speckit-tasks
```

### Source Code (repository root)
```text
app/api/aica_api/
├── models/
│   ├── feedback.py         # NEW: FieldDef, V1_FEEDBACK_SCHEMA, FeedbackTarget, FeedbackEvent
│   └── log.py              # EXTEND: add FeedbackEvent to the Event union; add driver/vehicle/speed
│                           #   profiles to RunLog (M2 carry-forward, for the §14.2 export)
├── services/
│   ├── feedback.py         # NEW: effective_schema(package); validate(payload, schema, run_log);
│   │                       #   append_feedback (active→recorder; inactive→disk load-append-repersist)
│   └── evidence.py         # NEW: build_evidence_report(run_log) → {report meta, simulator_facts, human_review}
├── routers/
│   └── runs.py             # EXTEND: POST /feedback, GET /feedback-schema, GET /evidence
├── services/run_manager.py # EXTEND: persist driver/vehicle/speed profiles into RunLog at create_run;
│                           #   append_feedback(run_id, event) for active runs
└── tests/
    ├── test_feedback_schema.py   # effective schema (baseline ∪ extras; collision rejected)
    ├── test_feedback_api.py      # validation matrix; POST appends; active + disk-backed; GET schema
    ├── test_evidence_export.py   # §14.2 contents; facts vs human_review; reproducibility; conditional sections
    └── (test_models / test_api_run_loop updated for FeedbackEvent + profile persistence)

packages/_fixtures or app/api/tests/fixtures/  # a fixture package declaring extra feedback fields

app/frontend/src/
├── components/feedback/FeedbackForm.tsx     # NEW: schema-driven form (choice→radio/select, text→textarea)
├── components/runs/RunLogViewer.tsx         # UPGRADE: read-only evidence timeline; feedback distinct
├── api/types.ts + api/client.ts             # feedback/evidence types + submitFeedback/getFeedbackSchema/getEvidence
└── state/runStore.ts                        # light feedback state
```

**Structure Decision**: extends the M1–M4 tree; the run log gains one event kind (feedback) +
profile fields; two new read surfaces (schema-driven form, evidence timeline) + an export
endpoint. The decision/tick/adapter pipeline is untouched; feedback is purely additive evidence.

## Complexity Tracking

> No constitution violations. Table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
