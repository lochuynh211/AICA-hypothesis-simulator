# M5 — Review Feedback & Evidence Completeness (Design / ADR)

**Date:** 2026-06-28
**Milestone:** M5 (Review feedback and evidence completeness)
**Status:** Approved design — pre-spec
**Branch (planned):** `006-review-feedback-evidence`

## Context

M0–M4 are complete and merged to `develop`: a deterministic, file-based AICA trigger
simulator with a backend tick engine + algorithm adapter (declarative_rule, weighted_score,
python_module incl. the transparent hybrid), append-only evidence, a React review UI, and
the BYO-key Google Maps route surface. The run log already records route facts, the frozen
plan, profiles, the per-tick decision trace, actions, setup values, and algorithm errors.

M5 completes the **human-review evidence loop** for V1: structured + free-text **feedback**
captured at the decision/proposal/action/end-of-run points and persisted as append-only
events; a **structured evidence-timeline viewer** over the persisted log; and a JSON
**evidence export** that clearly separates simulator facts from human review comments.
Authoritative scope: milestones §7 (M5), architecture §7.4 + §13.8 (feedback) + §13.9
(evidence replay) + the endpoints table (`POST /api/runs/{id}/feedback`).

Current state: there is **no** feedback model or endpoint yet; packages carry an unused
empty `feedback_schema: list[dict] = []`; a **basic** `RunLogViewer` already loads and shows
the persisted log JSON statically (M5 upgrades it into the timeline viewer).

## Decisions

### D1 — Fixed V1 feedback schema (backend constant) + optional per-package extras
The 8 V1 review labels are a backend constant `V1_FEEDBACK_SCHEMA` (always present). A
package MAY append extra fields via its manifest `feedback_schema`; the **effective schema**
= V1 baseline ∪ package extras. A package extra MUST NOT redefine a V1 key (collision →
load/validation error). Rejected: per-package-only (every package must author a schema; the
V1 packages ship empty) and fixed-only (no package customization).

### D2 — Feedback is append-only human-review evidence; never alters the run
Feedback is captured as `FeedbackEvent`s appended to the run log via the existing
append-only evidence recorder (persisted immediately). It NEVER blocks the run, alters
simulator facts, or feeds an algorithm — it is post-hoc human judgment, kept distinct from
machine-generated evidence (constitution II).

### D3 — Three attach points, traceable via `FeedbackTarget`
Feedback may be submitted after a **decision** (`{scope:"decision", tick_index}`), a
**proposal** (`{scope:"proposal", tick_index, proposal_id}`), an **action**
(`{scope:"action", tick_index, action}`), or at **end of run** (`{scope:"run"}`). The
target is validated to reference something real in the log (the tick_index / proposal_id /
action exists), so every feedback is traceable to run/decision/proposal/action (acceptance
criterion). All fields optional; feedback is never required to proceed.

### D4 — Evidence replay = structured event-timeline viewer (no recalculation)
"Evidence replay" for M5 upgrades `RunLogViewer` into a read-only, ordered, expandable
**timeline** of the recorded events (tick + its recorded decision trace, proposal, action,
feedback, algorithm error), feedback visually distinct from facts. It renders **purely from
the persisted log without recalculating any algorithm decision** (constitution III /
architecture §13.9). The richer **visual scrubbable playback** (re-driving the cockpit/map
from the log) is deferred to the M6 UI/UX-polish milestone.

### D5 — Backend-derived evidence export separating facts from human review
`GET /api/runs/{id}/evidence` returns a derived structure
`{ simulator_facts: {snapshot, route_facts, event_plan, profiles, setup_values, trace,
actions, algorithm_errors}, human_review: {feedback: [...]} }`. Deriving it server-side keeps
the fact/review separation in the source of truth and unit-testable. The frontend offers
**copy-to-clipboard + download** of this JSON (required). **Markdown export deferred** to M6.

### D6 — Field-type vocabulary; localized; all optional
A small typed vocabulary: `scale` (min/max, e.g. 1–5), `choice` (options), `text`. The V1
fields: `timing` (choice), `safety_impression` / `intrusiveness` / `understandability` /
`rest_spot_suitability` / `proposal_content_suitability` (scale 1–5), `acceptance_rejection_reason`
(choice + text note), `overall_judgment` (choice). Plus an always-available free-text
`comment`. Labels localized `{ja,en}` like the rest of the system. All fields optional.

### D7 — Per-package extras exercised via a test fixture
Shipped packages keep `feedback_schema: []`; the baseline-∪-extras path is exercised with a
**test fixture package** that declares extra fields — no need to bloat the shipped manifests.

### D8 — No new dependencies
Pure Python + Pydantic (backend) and React/TS (frontend). No Markdown library (deferred), no
DB, no new deps. See the supply-chain discipline.

## Architecture / Data Flow
1. Reviewer opens **FeedbackForm** at an attach point (decision / proposal / action / end-of-run).
2. Form fetches the effective schema (`GET /api/runs/{id}/feedback-schema`) and renders fields
   by type + a free-text comment.
3. Submit → `POST /api/runs/{id}/feedback {target, labels, comment}`.
4. Backend builds the effective schema, **validates** (keys/types/target-exists), appends a
   `FeedbackEvent` via the run's recorder (persisted), returns 201 (or structured 400 — nothing appended).
5. The **evidence timeline viewer** renders the persisted log read-only (no recalculation),
   feedback distinct from facts.
6. **Export**: `GET /api/runs/{id}/evidence` → `{simulator_facts, human_review}` → copy + download.

## Components

**Backend**
- `models/feedback.py` (NEW) — `FieldDef`, `V1_FEEDBACK_SCHEMA`, `FeedbackTarget`, `FeedbackEvent`.
- `models/log.py` (EXTEND) — add `FeedbackEvent` to the `RunLogEvent` union.
- `services/feedback.py` (NEW) — `effective_schema(package)` (baseline ∪ extras, collision-checked);
  `validate(payload, schema, run_log)`.
- `routers/runs.py` (EXTEND) — `POST .../feedback`, `GET .../feedback-schema`, `GET .../evidence`;
  `run_manager.append_feedback(run_id, event)`.

**Frontend**
- `components/feedback/FeedbackForm.tsx` (NEW) — schema-driven form (scale→radio, choice→select,
  text→textarea) + comment; submits with the attach-point target; surfaced after a proposal/action,
  at end-of-run, and per-tick in the trace.
- `components/runs/RunLogViewer.tsx` (UPGRADE) — ordered, expandable evidence timeline; feedback distinct.
- Copy/Download evidence buttons (calling `GET /evidence`).
- `api/types.ts` + `api/client.ts` — feedback/evidence types + `submitFeedback`/`getFeedbackSchema`/`getEvidence`.

## Scope / Non-Goals (YAGNI)
No visual scrubbable replay (M6), no Markdown export (M6), no feedback edit/delete (append-only),
no cross-run analytics/aggregation, no auth. Feedback never feeds an algorithm or alters facts.

## Testing Strategy
- Backend: effective-schema build (baseline ∪ extras; collision rejected); validation matrix
  (valid; unknown key; wrong type / out-of-range; bad target); `POST .../feedback` appends a
  persisted `FeedbackEvent`; `GET .../feedback-schema`; `GET .../evidence` separation (feedback ONLY
  under `human_review`; facts never include feedback).
- Frontend: FeedbackForm renders each field type + submits with the right target; a package-extra
  field renders (fixture); timeline viewer renders feedback distinct from facts; copy + download evidence.
- e2e: run → submit feedback at a proposal + end-of-run → persisted log contains the feedback events →
  evidence export cleanly separates simulator_facts vs human_review.

## Constitution Check (preliminary)
- I Backend source of truth — PASS (schema/validation/append/export all backend-owned).
- II Append-only / failures never hidden — PASS (feedback append-only; separated from facts; never alters them).
- III Deterministic/replayable — PASS (timeline renders from the log without recalculation; feedback
  doesn't affect decisions).
- IV Qualitative trigger discipline — PASS (feedback is post-hoc human input; never feeds a trigger).
- V One adapter contract — PASS (M5 doesn't touch the adapter).
- VI Local-first / YAGNI / no new deps — PASS (pure Python + React; no Markdown lib, no DB, no new deps).
- Security — feedback is human review text; no secrets; standard handling.

## Open Questions for the Spec Phase
- Exact `acceptance_rejection_reason` option set + which reasons map to accept vs reject.
- Whether `rest_spot_suitability` "N/A" is a choice value or an explicit not-applicable flag.
- The exact UI placement of the decision-scoped (per-tick) feedback affordance in the trace — it
  IS in scope (the master lists "decision point" alongside proposal action and end of run); only its
  presentation is a spec/UX detail.
