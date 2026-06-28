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

### D3 — Attach scopes, each traceable via a precise `FeedbackTarget` (master §14.4)
`FeedbackTarget` anchors feedback to a **specific log event by index** so it is uniquely
traceable even when actions/decisions repeat:
`{ scope, event_ref?: int (log event index), tick_index?, proposal_id?, action?: str }` —
`event_ref` is the unique anchor; `tick_index`/`proposal_id`/`action` are display metadata.
M5 V1 scopes (master §14.4 traceability):
- `run` — entire run (end of playback)
- `decision` — a specific decision point (`event_ref` → that tick event)
- `proposal` — a specific proposal (`event_ref` → the proposal-bearing tick event, + `proposal_id`)
- `action` — a specific test-user **action** (`event_ref` → that action event; `tick_index`/`action`
  display-only — this is the fix for "repeated actions aren't uniquely identified")

Validation: `event_ref` must point to an event of the matching kind in the persisted log. The
master's remaining traceability scopes — `setup_change` (a parameter/hyperparameter change) and
`comparison` (between runs) — are **reserved** in the model but not wired until those features exist
(M6+). All fields optional; feedback never blocks the run. Feedback **timing** follows master §13.4
(end of playback / each decision point when configured / after accepting or rejecting a proposal).

### D4 — Evidence replay = structured event-timeline viewer (no recalculation)
"Evidence replay" for M5 upgrades `RunLogViewer` into a read-only, ordered, expandable
**timeline** of the recorded events (tick + its recorded decision trace, proposal, action,
feedback, algorithm error), feedback visually distinct from facts. It renders **purely from
the persisted log without recalculating any algorithm decision** (constitution III /
architecture §13.9). The richer **visual scrubbable playback** (re-driving the cockpit/map
from the log) is deferred to the M6 UI/UX-polish milestone.

### D5 — Backend-derived evidence export with the full master §14.2 contents
`GET /api/runs/{id}/evidence` returns a derived report carrying the complete master §14.2
contents, separating machine facts from human review:
```
{ report_id, run_id, timestamp, ui_language, simulator_version,
  package: {id, version}, scenario: {id, version},
  simulator_facts: {
    route_snapshot,                 # M4 display_route snapshot (when a maps run)
    route_facts, event_plan, run_mode, evidence_status,
    initial_parameters, final_parameters,          # final_* only when changed
    initial_hyperparameters, final_hyperparameters, # final_* only when changed
    driver_profile, vehicle_profile,
    timeline_events, decision_trace, proposal_events, actions,
    expert_override_events,         # when any occur (M6+ feature; empty for now)
    algorithm_errors,
    run_comparison_reference        # when applicable (compare is future; omitted for now)
  },
  human_review: { feedback_labels: [...], free_text_comments: [...] } }
```
Conditional sections (`expert_override_events`, `run_comparison_reference`, `final_*` values)
appear only when present. The master §13.1 record distinction maps as: simulator trace →
`simulator_facts`; test-user labels → `human_review.feedback_labels`; test-user comments →
`human_review.free_text_comments` (optional reviewer-notes / analyst-conclusions are future).
The report is **reproducible** per master §14.3 (it carries simulator version, package/scenario
ids+versions, route snapshot + facts, plan, parameter/hyperparameter values, profiles, timeline,
and actions). Deriving server-side keeps the separation in the source of truth + unit-testable.
Frontend offers **copy + download** of this JSON (required). **Markdown deferred** to M6.

### D6 — V1 field schema = master §13.2 categoricals; localized; all optional
Field vocabulary: `choice` (options) and `text`; `scale` remains available for package extras,
but the **V1 baseline uses categorical `choice` fields to match the master spec** (NOT numeric
scales). The V1 baseline fields (per master §13.2; all optional):
- `proposal_timing` — choice: too_early / appropriate / too_late / unnecessary / missed_opportunity
- `safety_impression` — choice: safe / somewhat_risky / unsafe / unclear
- `intrusiveness` — choice: not_intrusive / acceptable / intrusive / very_intrusive
- `understandability` — choice: clear / somewhat_clear / unclear
- `rest_spot_suitability` — choice: suitable / acceptable / unsuitable / no_suitable_rest_spot
- `proposal_content_suitability` — choice: suitable / acceptable / unsuitable
- `acceptance_reason` — text (surfaced when the proposal was accepted)
- `rejection_reason` — text (surfaced when the proposal was declined) — master lists acceptance
  and rejection reasons as SEPARATE labels
- `overall_judgment` — choice: good_trigger / acceptable / poor_trigger (exact option set finalized in spec)

Plus an always-available free-text `comment` with no forced language (master §13.3). Labels
localized `{ja,en}`.

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
- Backend: effective-schema build (baseline ∪ extras; collision rejected); the V1 baseline matches
  master §13.2 categoricals; validation matrix (valid; unknown key; value not in a field's `choice`
  options; `event_ref` missing or pointing to the wrong event kind); `POST .../feedback` appends a
  persisted `FeedbackEvent`; `GET .../feedback-schema`; `GET .../evidence` carries the full master
  §14.2 contents, with feedback ONLY under `human_review` (labels vs free-text comments separated) and
  facts never including feedback; conditional sections (expert_override_events, run_comparison_reference,
  final_* values) present only when applicable; reproducibility fields (§14.3) all present.
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
- `overall_judgment` exact option set (proposed good_trigger / acceptable / poor_trigger).
- Whether `acceptance_reason` / `rejection_reason` are free `text` or `choice` (a fixed reason set) +
  optional note; and whether the form shows acceptance vs rejection based on the recorded action.
- `rest_spot_suitability` already includes `no_suitable_rest_spot` as a choice value (master §13.2) —
  confirm no separate not-applicable flag is needed.
- The exact UI placement of the decision-scoped (per-tick) feedback affordance in the trace — it IS in
  scope (master §13.4 lists "each decision point when configured"); only its presentation is a UX detail.
- The forward-compatible `setup_change` / `comparison` scopes are reserved but not wired in M5 (depend on
  expert_override / compare, which are M6+) — confirm they stay out of M5 implementation.
