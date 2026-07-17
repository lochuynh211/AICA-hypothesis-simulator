# Service Proposal Panel (middle) refinements — design

**Date:** 2026-07-17
**Component under change:** Panel ② "Service proposal" (STEP 1) in the Proposal Simulator.
**Files:** `app/frontend/src/components/proposal/panels/ServiceProposalPanel.tsx`,
`app/frontend/src/components/proposal/ServiceExplainability.tsx`,
`app/frontend/src/components/proposal/ReasonBreakdown.tsx` (additive prop only).
**No backend changes.** This is a frontend review-UX refinement pass; the algorithm
adapter, evidence shape, and run lifecycle are untouched (Constitution I — the
frontend renders backend evidence and never becomes a source of truth).

## Context

The middle panel accreted journey-engine controls (P4/P7) and two overlapping
score tables (P1 `ReasonBreakdown` + P5 `ServiceExplainability`). For a
single-user review tool the result is noisy and exposes internal knobs a reviewer
shouldn't have to reason about. This pass trims the panel to the essentials:
one feature trace, a clean parameter/hyperparameter split matching
`specs/013-proposal-p1-screen-foundation/ui-mockup.html`, scope-gated Choose
buttons, tidy number formatting, and edit-driven recompute.

Owner decisions (2026-07-17):
- Choose active only for the content-backed 3 services.
- Parameters: `max_candidates` editable; gamma + confidence read-only; hide the rest.
- Auto-recompute on edit, no mode toggle.
- Drop the redundant `ReasonBreakdown` table (keep its chips + rationale).

## Changes

### 1. Feature-trace table (`ServiceExplainability.tsx`, "Feature trace" table)

- **Sort** `feature_contributions` by `|contribution|` (k) descending before render.
- **Top 5 shown; rest collapsed.** Render the first 5 rows; put the remainder
  behind an inline "Show N more / Show fewer" toggle (local `useState`), inside
  the existing `<details>` disclosure.
- **Remove the Provenance and Status columns** from the table (both header and
  cells). `status` is still read from the data — used only to decide blur (below) —
  it is just no longer a column.
- **Blur missing/neutral rows.** A row whose `fc.status` is `missing` or
  `neutral` renders de-emphasized: `filter: blur(1.5px)`, reduced opacity
  (~0.45), `pointer-events: none`. Rows stay in place (sorted position); they are
  suppressed, not removed.
- Column set after change: `Feature · Raw · e · a · r=e·a · w · k=r×w`.

### 2. Drop the redundant `ReasonBreakdown` table (service side only)

- `ReasonBreakdown` gains an additive prop `showTable?: boolean` (default `true`)
  so the **content** panel is unaffected.
- `ServiceProposalPanel` passes `showTable={false}` **only when the candidate has
  the rich §14 trace** (i.e. `ServiceExplainability`'s table will render). For the
  mock service package (no `normalized_evidence`), Table A's table is kept so the
  card is never left with zero feature detail.
- `ReasonBreakdown`'s "Supported by / Opposed by" chips and the rationale sentence
  always render (never duplicated by Table B).
- Implementation: export a small predicate from `ServiceExplainability`
  (`hasFeatureTrace(candidate)`) and reuse it in both places so the "which table
  wins" rule lives in one spot.

### 3. Three-decimal number formatting

- `ServiceExplainability.fmt` and `ReasonBreakdown.fmt` → `n.toFixed(3)` for
  computed numeric fields (`e, a, r, w, k, contribution`, subtotals `situation/
  preference/history_fit`, `strongest_support/oppose.contribution`).
- The candidate **score badge** in `ServiceProposalPanel` (currently prints
  `candidate.score` raw) is routed through `fmt` → `toFixed(3)`, keeping the
  leading `+` sign for non-negative scores.
- **Not** reformatted: raw categorical feature values (`raw_value`/`feature_value`
  such as `"on"`, `"congested"`, `70`) and percentages (`safety_share`, which
  keeps its existing `%` form).

### 4. Parameters / Hyperparameters restructure (match `ui-mockup.html`)

Match the mockup's structure and visual grammar (verified against
`specs/013-proposal-p1-screen-foundation/ui-mockup.html` lines 274–343); content
stays bound to the **real** manifest keys/labels.

- **Parameters** slab: a 2-up grid of scalar fields (see §8 for the exact set).
- **Hyperparameters** disclosure: each hyperparameter renders as a labeled
  sub-block styled like the mockup's `subslab` — a `kind` badge (`numeric` /
  `table` / `enum`), the `<code>` key, and the JA/EN label text — with the
  `HyperparamMatrix` control beneath. Matrices/tables keep their `overflow-x`
  scroll. This replaces the current bare list of `HyperparamMatrix` controls.
- The disclosure summary keeps the count (mockup shows e.g. "7").

### 5. Remove "Current journey state" readout

Delete the `journeyReadoutTitle` block (lifecycle stage / motion state / allowed
services) and its now-unused `LABELS`/`readoutRowStyle`.

### 6. Hide journey action bar + event timeline

Stop rendering `<JourneyActionBar />` and `<EventTimeline />` in this panel.
Remove the imports. (They belong to the journey-engine concern, not STEP-1 service
review; not a trigger-screen connection.)

### 7. Remove Recompute panel

Stop rendering `<RecomputePanel />`; remove the import. Same-run recompute is
superseded by §9's edit-driven re-run.

### 8. Parameters content

The service package's scalar parameters are `missing_policy`, `top_k`,
`tie_breaker`, `material_safety_gap` (the object/array params are already filtered
out of the editable grid). Real gamma is three hyperparameters
(`gamma_drowsiness/fatigue/monotony`); confidence is `confidence_shrinkage_v1`
(enum, default off).

- **Editable:** `max_candidates` (backed by `top_k`), a number input.
- **Read-only display:** `gamma_drowsiness`, `gamma_fatigue`, `gamma_monotony`,
  and `confidence_shrinkage_v1` (shows its current value / "off"). Rendered as
  read-only fields (mockup `rdonly` style), reading effective values
  (override ?? manifest default).
- **Hidden:** `missing_policy`, `tie_breaker`, `material_safety_gap`.
- All four read-only knobs remain fully editable inside the Hyperparameters
  disclosure — the Parameters box just surfaces them read-only for orientation.

### 9. Auto-recompute on edit; remove mode toggle

- Remove `<ModeToggle />` and its import. Runs are created with a **fixed
  `mode: 'interactive'`** constant (STEP 1 stops at ranked candidates; the reviewer
  Chooses a content-backed service to run STEP 2).
- Editing the one editable parameter (`max_candidates`) triggers an **automatic
  STEP-1 re-run**, debounced ~400 ms, once a run already exists. This mirrors the
  trigger screen's edit→recompute feel.
- A re-run creates a fresh run and therefore **resets the STEP-2 selection** — a
  parameter edit is a setup change, so a fresh ranking is expected.
- The **Run** button stays as a manual fallback.
- Guard: don't auto-recompute during the initial `autoInit` sequence or while a
  run is already in flight (`running`); debounce must be cleared on unmount.

### Choose gating (owner Q1)

- Enable Choose only for services in the **content package's `supported_services`**
  (currently `music_playlist, humming_karaoke, full_karaoke`). Read from the
  already-fetched `contentPackages` manifest; do not hardcode the list.
- Non-supported candidates: Choose button `disabled`, with a small
  "out of V1 scope" / 「V1対象外」 note (new bilingual `LABELS` entry).
- `autoInit`'s rank-1 auto-choose skips a service that isn't content-backed
  (avoids auto-selecting a disabled candidate).

## Non-goals

- No backend/adapter/evidence changes.
- No change to the content panel (`ReasonBreakdown` change is additive + opt-in).
- No change to the left World panel or right/other screens.
- `quick_check` mode is not deleted from the backend — only removed from this
  panel's UI.

## Testing

Extend `app/frontend/src/components/proposal/**/proposal_service_panel.test.tsx`
(and `ServiceExplainability` tests):

- Choose disabled + "out of V1 scope" for a non-content-backed candidate; enabled
  for `music_playlist`.
- Feature trace: rows sorted by |k| desc; only 5 visible until "Show more";
  no Provenance/Status column; missing/neutral row carries the blur style.
- Single feature table for the transparent package (no `ReasonBreakdown` table),
  chips + rationale still present; mock package still shows its table.
- Numbers render with 3 decimals (score badge, k, subtotals).
- Journey readout / JourneyActionBar / EventTimeline / RecomputePanel / ModeToggle
  are absent.
- Editing `max_candidates` triggers a debounced re-run (assert `createRun` called
  again).
- Parameters box: `max_candidates` editable; gamma/confidence read-only;
  `missing_policy`/`tie_breaker`/`material_safety_gap` absent.

## Verification

`npm run test` + `npm run build` in `app/frontend`, then drive the live app
(auto-init reference journey) to confirm the panel renders one clean trace,
scope-gated Choose, and edit→recompute.
