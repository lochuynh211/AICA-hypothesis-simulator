# Service Proposal Panel Refinements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trim the middle "Service proposal" panel (STEP 1) to the essentials — one clean feature trace, scope-gated Choose, mockup-aligned parameter/hyperparameter layout, 3-decimal numbers, and edit-driven recompute.

**Architecture:** Frontend-only refinement of `ServiceProposalPanel.tsx` and `ServiceExplainability.tsx`, plus one additive prop on the shared `ReasonBreakdown.tsx`. No backend, adapter, or evidence changes — the panel keeps rendering backend evidence verbatim (Constitution I). Removed UI (journey bar, timeline, recompute, mode toggle) is only unmounted from this panel; the components themselves stay in the tree for other screens.

**Tech Stack:** React 18 + TypeScript + Vite, Vitest + @testing-library/react. Tests live in `app/frontend/tests/`. Run from `app/frontend/`.

## Global Constraints

- All commands run from `app/frontend/`. Test command: `npm run test` (vitest run); single file: `npx vitest run tests/<file>`.
- The frontend never computes decisions/eligibility; it only renders backend evidence (Constitution I).
- Bilingual labels use the `t(LABELS.x, lang)` pattern with `{ ja, en }` objects (see existing `LABELS` in each file).
- Content-backed services (the only ones with a downstream STEP-2 content selector) are read from the **content package's** `supported_services` — never hardcoded. Current value: `music_playlist, humming_karaoke, full_karaoke`.
- Number formatting for computed values: `toFixed(3)`. Raw categorical feature values and percentages are exempt.
- Keep every existing `data-testid` that isn't part of a removed feature; tests key off them.

---

### Task 1: Three-decimal number formatting

**Files:**
- Modify: `app/frontend/src/components/proposal/ServiceExplainability.tsx` (`fmt`, ~line 52-56)
- Modify: `app/frontend/src/components/proposal/ReasonBreakdown.tsx` (`fmt`, ~line 53-57)
- Modify: `app/frontend/src/components/proposal/panels/ServiceProposalPanel.tsx` (score badge, ~line 429-434)
- Test: `app/frontend/tests/proposal_service_panel.test.tsx`

**Interfaces:**
- Produces: `fmt(n)` in both components returns a fixed-3-decimal string for finite numbers; `'—'` for null/undefined (ServiceExplainability only).

- [ ] **Step 1: Update `ServiceExplainability.fmt` to 3 decimals**

Replace the body of `fmt` (keep the null guard):

```tsx
function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return n.toFixed(3)
}
```

Leave `fmtPercent` unchanged (percentages are exempt).

- [ ] **Step 2: Update `ReasonBreakdown.fmt` to 3 decimals**

```tsx
function fmt(n: number): string {
  return n.toFixed(3)
}
```

- [ ] **Step 3: Route the candidate score badge through 3-decimal formatting**

In `ServiceProposalPanel.tsx`, the score badge currently prints `candidate.score` raw. Replace the badge's inner expression (the `{candidate.score >= 0 ? '+' : ''}{candidate.score}` pair) with a formatted form:

```tsx
{candidate.score >= 0 ? '+' : ''}
{candidate.score.toFixed(3)}
```

- [ ] **Step 4: Add a test asserting 3-decimal rendering**

In `proposal_service_panel.test.tsx`, inside the real-shaped-candidate test block (the one around line 452 that renders the §14 table), add assertions that a contribution/subtotal cell shows exactly 3 decimals, e.g.:

```tsx
// situation subtotal renders with 3 decimals (e.g. "0.420", not "0.42")
expect(screen.getByTestId('service-subtotals').textContent).toMatch(/\d\.\d{3}/)
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/proposal_service_panel.test.tsx`
Expected: PASS (existing assertions like `safety-share` `82.3%` still pass — percent unchanged).

- [ ] **Step 6: Commit**

```bash
git add app/frontend/src/components/proposal app/frontend/tests/proposal_service_panel.test.tsx
git commit -m "feat(proposal): 3-decimal formatting for service scores and traces"
```

---

### Task 2: `ReasonBreakdown` gains opt-out `showTable` prop; export `hasFeatureTrace`

**Files:**
- Modify: `app/frontend/src/components/proposal/ReasonBreakdown.tsx`
- Modify: `app/frontend/src/components/proposal/ServiceExplainability.tsx` (export predicate)
- Test: `app/frontend/tests/proposal_reason_breakdown.test.tsx`

**Interfaces:**
- Produces: `ReasonBreakdownProps.showTable?: boolean` (default `true`). When `false`, the score `<table>` is not rendered; chips + rationale still render.
- Produces: `export function hasFeatureTrace(candidate: RankedCandidate): boolean` in `ServiceExplainability.tsx` — `true` when any `feature_contributions[].normalized_evidence != null` (i.e. the rich §14 table will render).

- [ ] **Step 1: Add a failing test for `showTable={false}`**

In `proposal_reason_breakdown.test.tsx`, add:

```tsx
it('hides the score table but keeps chips + rationale when showTable is false', () => {
  render(
    <ReasonBreakdown
      rows={[{ featureId: 'monotony', value: 70, r: 0.7, w: 0.3, contribution: 0.21 }]}
      supportingFeatureIds={['monotony']}
      opposingFeatureIds={[]}
      rationale={['理由', 'because monotony']}
      lang="en"
      defaultOpen
      showTable={false}
    />,
  )
  expect(screen.queryByRole('table')).toBeNull()
  expect(screen.getByTestId('reason-supporting')).toHaveTextContent('monotony')
  expect(screen.getByText('because monotony')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/proposal_reason_breakdown.test.tsx`
Expected: FAIL (`showTable` not a prop; table still renders).

- [ ] **Step 3: Implement the prop**

In `ReasonBreakdown.tsx`, add to `ReasonBreakdownProps`:

```tsx
  /** When false, omit the per-feature score table (chips + rationale stay). */
  showTable?: boolean
```

Destructure with a default in the function signature: `showTable = true,`. Wrap the existing `<div style={{ overflowX: 'auto' }}>…</table></div>` block in `{showTable && ( … )}`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/proposal_reason_breakdown.test.tsx`
Expected: PASS.

- [ ] **Step 5: Export `hasFeatureTrace` from `ServiceExplainability.tsx`**

`ServiceExplainability` already computes `hasFeatureTrace` inline. Promote it to an exported module function and use it internally:

```tsx
/** Does this candidate carry the rich §14 per-feature trace (evidence detail)? */
export function hasFeatureTrace(candidate: RankedCandidate): boolean {
  return candidate.feature_contributions.some((fc) => fc.normalized_evidence != null)
}
```

Then inside the component, replace the local `const hasFeatureTrace = …` with `const showFeatureTrace = hasFeatureTrace(candidate)` and use `showFeatureTrace` where the local was used.

- [ ] **Step 6: Run full frontend tests (no regressions)**

Run: `npm run test`
Expected: PASS (content panel unaffected — it never passes `showTable`, so it defaults to `true`).

- [ ] **Step 7: Commit**

```bash
git add app/frontend/src/components/proposal/ReasonBreakdown.tsx app/frontend/src/components/proposal/ServiceExplainability.tsx app/frontend/tests/proposal_reason_breakdown.test.tsx
git commit -m "feat(proposal): add ReasonBreakdown.showTable opt-out and export hasFeatureTrace"
```

---

### Task 3: Feature-trace table — sort by |k|, top-5 + expand, drop Provenance/Status, blur missing/neutral

**Files:**
- Modify: `app/frontend/src/components/proposal/ServiceExplainability.tsx`
- Test: `app/frontend/tests/proposal_service_panel.test.tsx`

**Interfaces:**
- Consumes: `candidate.feature_contributions` (`FeatureContribution[]`), each with `contribution: number` and optional `status?: string | null`.
- Produces: the `service-explainability-table` disclosure now renders ≤5 rows by default with a "show more" toggle; header columns are `Feature · Raw · e · a · r=e·a · w · k=r×w` (no Provenance, no Status).

- [ ] **Step 1: Add failing tests for the new table behavior**

In `proposal_service_panel.test.tsx`, in the real-shaped candidate area, add a dedicated test (the fixture has 17 feature rows):

```tsx
it('feature trace: top-5 by |contribution|, expandable, no provenance/status columns', async () => {
  // …render the real-shaped candidate (reuse the existing 17-row fixture setup)…
  const table = await screen.findByTestId('service-explainability-table')
  // Provenance/Status headers are gone
  expect(within(table).queryByText('Provenance')).toBeNull()
  expect(within(table).queryByText('Status')).toBeNull()
  // Only 5 data rows visible before expanding
  const openTrace = within(table).getByTestId('trace-show-more')
  const bodyBefore = within(table).getAllByTestId(/^explain-row-/)
  expect(bodyBefore.length).toBe(5)
  fireEvent.click(openTrace)
  expect(within(table).getAllByTestId(/^explain-row-/).length).toBe(17)
})
```

Add `within` to the `@testing-library/react` import if not already present.

- [ ] **Step 2: Migrate the existing "all 17 rows visible" test**

The existing test around line 452 (`renders a real-shaped candidate with all 17 feature rows … visible`) asserts every `explain-row-${featureId}` is present without expanding. Update it to expand the trace first:

```tsx
const explain = await screen.findByTestId('service-explainability')
fireEvent.click(within(explain).getByTestId('trace-show-more'))
for (const featureId of ALL_17_FEATURE_IDS) {
  expect(screen.getByTestId(`explain-row-${featureId}`)).toBeInTheDocument()
}
```

(Keep the subtotals/dominance assertions in that test unchanged.)

- [ ] **Step 3: Run to verify the new/updated tests fail**

Run: `npx vitest run tests/proposal_service_panel.test.tsx`
Expected: FAIL (no `trace-show-more`, still 17 rows, Provenance/Status still present).

- [ ] **Step 4: Implement sort + top-5 + expand + column removal + blur**

In `ServiceExplainability.tsx`:

Add local expand state at the top of the component:

```tsx
const [traceExpanded, setTraceExpanded] = useState(false)
```

(Add `import { useState } from 'react'` at the top.)

Compute a sorted, sliced view just before the table render:

```tsx
const TOP_N = 5
const sortedContribs = [...candidate.feature_contributions].sort(
  (a, b) => Math.abs(b.contribution) - Math.abs(a.contribution),
)
const visibleContribs = traceExpanded ? sortedContribs : sortedContribs.slice(0, TOP_N)
const hiddenCount = sortedContribs.length - visibleContribs.length
```

Remove the `LABELS.colProvenance` and `LABELS.colStatus` entries from the header array (leave the label defs in place or delete — delete to avoid dead code). Header array becomes:

```tsx
{[
  LABELS.colFeature,
  LABELS.colRaw,
  LABELS.colE,
  LABELS.colA,
  LABELS.colR,
  LABELS.colW,
  LABELS.colK,
].map((label, idx) => (
  <th key={idx} style={thStyle}>{t(label, lang)}</th>
))}
```

Map over `visibleContribs` (not `candidate.feature_contributions`), drop the last two `<td>` cells (provenance, status), and blur missing/neutral rows:

```tsx
{visibleContribs.map((fc) => {
  const muted = fc.status === 'missing' || fc.status === 'neutral'
  return (
    <tr
      key={fc.feature_id}
      data-testid={`explain-row-${fc.feature_id}`}
      style={muted ? mutedRowStyle : undefined}
    >
      <td style={tdStyle}>{fc.feature_id}</td>
      <td style={tdStyleMono}>{fc.raw_value ?? fc.feature_value}</td>
      <td style={tdStyleMono}>{fmt(fc.normalized_evidence)}</td>
      <td style={tdStyleMono}>{fmt(fc.response_coefficient)}</td>
      <td style={tdStyleMono}>{fmt(fc.normalized_feature_response)}</td>
      <td style={tdStyleMono}>{fmt(fc.effective_weight ?? fc.weight)}</td>
      <td style={tdStyleMono}>{fmt(fc.contribution)}</td>
    </tr>
  )
})}
```

Add the muted style near the other style consts:

```tsx
const mutedRowStyle: React.CSSProperties = {
  filter: 'blur(1.5px)',
  opacity: 0.45,
  pointerEvents: 'none',
}
```

Add the expand toggle immediately after the `</table></div>` inside the disclosure (only when rows are hidden or already expanded):

```tsx
{(hiddenCount > 0 || traceExpanded) && (
  <button
    type="button"
    data-testid="trace-show-more"
    onClick={() => setTraceExpanded((v) => !v)}
    style={{ margin: '6px 0', fontSize: '0.76em', color: '#1d4ed8', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
  >
    {traceExpanded
      ? t({ ja: '折りたたむ', en: 'Show fewer' }, lang)
      : t({ ja: `他 ${hiddenCount} 件を表示`, en: `Show ${hiddenCount} more` }, lang)}
  </button>
)}
```

- [ ] **Step 5: Run to verify tests pass**

Run: `npx vitest run tests/proposal_service_panel.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/frontend/src/components/proposal/ServiceExplainability.tsx app/frontend/tests/proposal_service_panel.test.tsx
git commit -m "feat(proposal): feature trace sorted top-5 with expand, drop provenance/status, blur missing/neutral"
```

---

### Task 4: Drop the redundant `ReasonBreakdown` table on the service side

**Files:**
- Modify: `app/frontend/src/components/proposal/panels/ServiceProposalPanel.tsx`
- Test: `app/frontend/tests/proposal_service_panel.test.tsx`

**Interfaces:**
- Consumes: `hasFeatureTrace(candidate)` (Task 2), `RankedCandidate`.
- Produces: for candidates with the §14 trace, the `ReasonBreakdown` table is suppressed (`showTable={false}`); mock candidates keep it.

- [ ] **Step 1: Add a failing test**

```tsx
it('renders a single feature table (no ReasonBreakdown table) for the transparent candidate, keeping chips', async () => {
  // …render real-shaped candidate…
  const card = await screen.findByTestId('candidate-card-live_viewing')
  // exactly one <table> in the card body region (the §14 trace, once expanded it's still one table element pre-expand)
  // ReasonBreakdown's table is gone; its chips remain:
  expect(within(card).getByTestId('reason-supporting')).toBeInTheDocument()
})
```

Also update the existing "reason breakdown" assertion in the Run test (line ~234-246) that expects a `reason-breakdown` table for the real candidate: assert the `reason-breakdown` disclosure still exists (chips/rationale) but not its `<table>`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/proposal_service_panel.test.tsx`
Expected: FAIL if the assertion expects suppression not yet wired.

- [ ] **Step 3: Wire `showTable`**

In `ServiceProposalPanel.tsx`, import the predicate:

```tsx
import ServiceExplainability, { hasFeatureTrace } from '../ServiceExplainability'
```

Pass to `ReasonBreakdown` inside the candidate card:

```tsx
<ReasonBreakdown
  rows={serviceRows(candidate)}
  supportingFeatureIds={candidate.supporting_feature_ids}
  opposingFeatureIds={candidate.opposing_feature_ids}
  rationale={candidate.rationale}
  lang={lang}
  variant="service"
  showTable={!hasFeatureTrace(candidate)}
/>
```

- [ ] **Step 4: Run to verify passing**

Run: `npx vitest run tests/proposal_service_panel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/frontend/src/components/proposal/panels/ServiceProposalPanel.tsx app/frontend/tests/proposal_service_panel.test.tsx
git commit -m "feat(proposal): single feature trace per candidate (suppress ReasonBreakdown table on transparent package)"
```

---

### Task 5: Scope-gate the Choose button to content-backed services

**Files:**
- Modify: `app/frontend/src/components/proposal/panels/ServiceProposalPanel.tsx`
- Test: `app/frontend/tests/proposal_service_panel.test.tsx`

**Interfaces:**
- Consumes: `contentPackages` (already in component state) → `contentPackages.find(...).supported_services`.
- Produces: `contentBackedServices: Set<string>`; a disabled Choose + "out of V1 scope" note for candidates not in that set; `autoInit` rank-1 auto-choose skips non-backed services.

- [ ] **Step 1: Add failing tests**

```tsx
it('disables Choose with an out-of-scope note for a non-content-backed service', async () => {
  // fixture candidates include stretch_video (NOT content-backed) and full_karaoke (backed)
  // …run…
  const stretchBtn = screen.getByTestId('choose-candidate-stretch_video')
  expect(stretchBtn).toBeDisabled()
  expect(screen.getByTestId('out-of-scope-stretch_video')).toBeInTheDocument()
})
```

Update the existing "choosing a candidate calls selectService" test (line ~250-264): it currently chooses `stretch_video`, which is now disabled. Change it to choose **`full_karaoke`** (content-backed) and assert `selectService` was called with `full_karaoke`. Ensure the mock content package fixture in this test exposes `supported_services: ['music_playlist','humming_karaoke','full_karaoke']`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/proposal_service_panel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Compute the content-backed set**

In `ServiceProposalPanel.tsx`, after `manifest` is resolved, derive:

```tsx
const contentManifestForScope =
  contentPackages.find((p) => p.id === state.contentPackageId) ?? contentPackages[0]
const contentBackedServices = new Set<string>(contentManifestForScope?.supported_services ?? [])
```

- [ ] **Step 4: Add the label + gate the button**

Add to `LABELS`:

```tsx
outOfScope: { ja: 'V1対象外', en: 'Out of V1 scope' },
```

In the candidate card's action row, compute `const backed = contentBackedServices.has(candidate.candidate_id)` and change the Choose button + add the note:

```tsx
<button
  type="button"
  data-testid={`choose-candidate-${candidate.candidate_id}`}
  disabled={!backed || choosingId === candidate.candidate_id}
  onClick={() => handleChoose(candidate.candidate_id)}
  style={{
    fontSize: '0.8em', fontWeight: 700, padding: '5px 12px', borderRadius: '7px',
    border: '1px solid #1d4ed8',
    background: !backed ? '#f1f5f9' : isActive ? '#fff' : '#1d4ed8',
    color: !backed ? '#9ca3af' : isActive ? '#1d4ed8' : '#fff',
    cursor: backed ? 'pointer' : 'not-allowed',
  }}
>
  {choosingId === candidate.candidate_id ? '…' : t(LABELS.choose, lang)}
</button>
{!backed && (
  <span data-testid={`out-of-scope-${candidate.candidate_id}`} style={{ fontSize: '0.72em', color: '#9ca3af' }}>
    {t(LABELS.outOfScope, lang)}
  </span>
)}
```

- [ ] **Step 5: Guard `autoInit`'s rank-1 auto-choose**

In the `autoInit` effect, only auto-choose when rank-1 is content-backed:

```tsx
const rank1 = out?.ranked_candidates?.[0]?.candidate_id
const backedIds = new Set<string>(contentPackages[0]?.supported_services ?? [])
if (rank1 && backedIds.has(rank1)) await chooseWith(log.run_id, rank1)
```

- [ ] **Step 6: Run to verify passing**

Run: `npx vitest run tests/proposal_service_panel.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/frontend/src/components/proposal/panels/ServiceProposalPanel.tsx app/frontend/tests/proposal_service_panel.test.tsx
git commit -m "feat(proposal): gate Choose to content-backed services with out-of-scope note"
```

---

### Task 6: Remove journey readout, journey bar, timeline, recompute, mode toggle; fix mode to interactive

**Files:**
- Modify: `app/frontend/src/components/proposal/panels/ServiceProposalPanel.tsx`
- Test: `app/frontend/tests/proposal_service_panel.test.tsx`

**Interfaces:**
- Produces: the panel no longer renders `journey-readout`, `JourneyActionBar`, `EventTimeline`, `RecomputePanel`, `mode-toggle`; `createRun` is called with `mode: 'interactive'` (literal).

- [ ] **Step 1: Add failing tests for absence**

```tsx
it('does not render journey readout, journey bar, timeline, recompute, or mode toggle', async () => {
  // …run…
  expect(screen.queryByTestId('journey-readout')).toBeNull()
  expect(screen.queryByTestId('mode-toggle')).toBeNull()
  // JourneyActionBar / EventTimeline / RecomputePanel have their own testids:
  expect(screen.queryByTestId('journey-action-bar')).toBeNull()
  expect(screen.queryByTestId('event-timeline')).toBeNull()
  expect(screen.queryByTestId('recompute-panel')).toBeNull()
})
```

(Confirm the exact testids by grepping the four components; adjust the strings to match, e.g. `grep -n "data-testid" src/components/proposal/JourneyActionBar.tsx EventTimeline.tsx RecomputePanel.tsx`.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/proposal_service_panel.test.tsx`
Expected: FAIL (elements present).

- [ ] **Step 3: Delete the blocks and imports**

In `ServiceProposalPanel.tsx`:
- Remove the `import ... JourneyActionBar`, `EventTimeline`, `ModeToggle`, `RecomputePanel` lines.
- Remove `<ModeToggle />` (and its surrounding comment) from the package/mode area.
- Remove the entire "Current journey state" readout `{state.runLog && (<>…journey-readout…</>)}` block.
- Remove the `{state.runLog && (<><JourneyActionBar /><RecomputePanel /><EventTimeline /></>)}` block.
- Remove now-unused `LABELS`: `journeyReadoutTitle`, `lifecycleStage`, `motionState`, `allowedServices`; and the `readoutRowStyle` const.

- [ ] **Step 4: Fix the run mode to `interactive`**

In `runWith`, replace `mode: state.mode,` with `mode: 'interactive',`.

- [ ] **Step 5: Run tests + typecheck (unused-var cleanup)**

Run: `npm run test`
Expected: PASS. Then `npm run build` to catch unused imports/vars — fix any TS errors (remove leftover unused `activeServiceId` only if it became unused; it's still used by the card border, so keep it).

- [ ] **Step 6: Commit**

```bash
git add app/frontend/src/components/proposal/panels/ServiceProposalPanel.tsx app/frontend/tests/proposal_service_panel.test.tsx
git commit -m "feat(proposal): remove journey/timeline/recompute/mode-toggle from service panel; lock mode=interactive"
```

---

### Task 7: Parameters box — editable max_candidates, read-only gamma/confidence, hide the rest

**Files:**
- Modify: `app/frontend/src/components/proposal/panels/ServiceProposalPanel.tsx`
- Test: `app/frontend/tests/proposal_service_panel.test.tsx`

**Interfaces:**
- Consumes: `manifest.parameters` (`top_k` scalar), `manifest.hyperparameters` (for gamma/confidence effective values).
- Produces: Parameters grid shows an editable `max_candidates` (bound to `top_k`), read-only `gamma_drowsiness/fatigue/monotony` and `confidence_shrinkage_v1`; `missing_policy`, `tie_breaker`, `material_safety_gap` are not rendered.

- [ ] **Step 1: Add failing tests**

The manifest's editable scalar is `top_k`. The panel currently renders a field labelled `top_k` (test at line 209). Update that test to expect the friendly label `max_candidates`, and add:

```tsx
it('parameters: max_candidates editable; gamma/confidence read-only; policy/tie/gap hidden', async () => {
  await screen.findByText('mock_service_selector_v1')
  expect(screen.getByLabelText('max_candidates')).toBeEnabled()
  expect(screen.getByTestId('param-gamma_drowsiness')).toHaveAttribute('readonly')
  expect(screen.getByTestId('param-confidence_shrinkage_v1')).toBeInTheDocument()
  expect(screen.queryByText('missing_policy')).toBeNull()
  expect(screen.queryByText('tie_breaker')).toBeNull()
  expect(screen.queryByText('material_safety_gap')).toBeNull()
})
```

Note: these tests must use a service manifest fixture whose `parameters` include `top_k` and whose `hyperparameters` include the gamma + `confidence_shrinkage_v1` keys. If the current fixture lacks them, extend the fixture manifest in this test file to mirror `packages/aica_transparent_service_selector_v1/package.json` (keys only, minimal shapes).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/proposal_service_panel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Rewrite the Parameters grid**

Replace the current `Object.entries(manifest.parameters).filter(...).map(...)` grid with an explicit, curated layout. Add helper lookups near the top of the render:

```tsx
const HIDDEN_PARAMS = new Set(['missing_policy', 'tie_breaker', 'material_safety_gap'])
const READONLY_HP_KEYS = ['gamma_drowsiness', 'gamma_fatigue', 'gamma_monotony', 'confidence_shrinkage_v1']
function hpEffective(key: string): string {
  const hp = manifest?.hyperparameters.find((h) => h.key === key)
  const v = state.serviceHyperparameterOverrides[key] ?? hp?.default
  return v === undefined || v === null ? '—' : String(v)
}
const topKValue = state.serviceParameterOverrides['top_k'] ?? manifest?.parameters['top_k'] ?? 3
```

Add labels:

```tsx
maxCandidates: { ja: '最大候補数', en: 'max_candidates' },
```

Render the grid (editable max_candidates + read-only knobs):

```tsx
<div style={sectionLabelStyle}>{t(LABELS.parameters, lang)}</div>
<div style={grid2Style}>
  <label style={fieldLabelStyle}>
    max_candidates
    <input
      aria-label="max_candidates"
      type="number"
      value={Number(topKValue)}
      onChange={(e) =>
        dispatch({ type: 'SET_SERVICE_PARAMETER', key: 'top_k', value: Number(e.target.value) })
      }
    />
  </label>
  {READONLY_HP_KEYS.map((key) => (
    <label key={key} style={fieldLabelStyle}>
      <code>{key}</code>
      <input data-testid={`param-${key}`} type="text" value={hpEffective(key)} readOnly />
    </label>
  ))}
</div>
```

Keep this block where the current Parameters block lives (after the run result, per the existing comment). Leave the Hyperparameters disclosure below (Task 8 restyles it).

- [ ] **Step 4: Run to verify passing**

Run: `npx vitest run tests/proposal_service_panel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/frontend/src/components/proposal/panels/ServiceProposalPanel.tsx app/frontend/tests/proposal_service_panel.test.tsx
git commit -m "feat(proposal): curated Parameters box (editable max_candidates, read-only gamma/confidence)"
```

---

### Task 8: Hyperparameters disclosure — mockup `subslab` grammar

**Files:**
- Modify: `app/frontend/src/components/proposal/panels/ServiceProposalPanel.tsx`
- Reference: `specs/013-proposal-p1-screen-foundation/ui-mockup.html` lines 284–343
- Test: `app/frontend/tests/proposal_service_panel.test.tsx`

**Interfaces:**
- Consumes: `manifest.hyperparameters` (`HyperparameterDef[]` with `key`, `kind`, `label`).
- Produces: each hyperparameter is wrapped in a labeled sub-block (kind badge + `<code>` key + JA/EN label) above its `HyperparamMatrix` control.

- [ ] **Step 1: Add a failing test**

```tsx
it('hyperparameters render as labeled subslabs with a kind badge per entry', async () => {
  await screen.findByText('mock_service_selector_v1')
  const disc = screen.getByTestId('hyperparameters-disclosure')
  fireEvent.click(within(disc).getByText(/Hyperparameters|ハイパーパラメータ/))
  // e.g. a table-kind hyperparam shows its kind badge
  expect(within(disc).getAllByTestId('hp-kind-badge').length).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/proposal_service_panel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Wrap each HyperparamMatrix in a subslab**

In the hyperparameters `<details>` body, replace the bare `.map` with:

```tsx
{manifest.hyperparameters.map((hp) => (
  <div key={hp.key} style={{ margin: '10px 0 4px' }}>
    <div style={subslabStyle}>
      <span data-testid="hp-kind-badge" style={kindBadgeStyle}>{hp.kind}</span>{' '}
      <code>{hp.key}</code>{' '}
      <span style={{ color: '#6b7280' }}>{t(hp.label, lang)}</span>
    </div>
    <HyperparamMatrix
      def={hp}
      value={state.serviceHyperparameterOverrides[hp.key]}
      onChange={(value) => dispatch({ type: 'SET_SERVICE_HYPERPARAMETER', key: hp.key, value })}
      lang={lang}
    />
  </div>
))}
```

Add styles matching the mockup's `.subslab` / `.kind`:

```tsx
const subslabStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap',
  fontSize: '0.78em', fontWeight: 700, color: '#4b5563',
  borderTop: '1px dashed #e5e7eb', paddingTop: '6px', marginBottom: '4px',
}
const kindBadgeStyle: React.CSSProperties = {
  fontSize: '0.68em', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em',
  background: '#eef2ff', color: '#1d4ed8', border: '1px solid #c7d2fe',
  borderRadius: '999px', padding: '1px 7px',
}
```

- [ ] **Step 4: Run to verify passing**

Run: `npx vitest run tests/proposal_service_panel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/frontend/src/components/proposal/panels/ServiceProposalPanel.tsx app/frontend/tests/proposal_service_panel.test.tsx
git commit -m "feat(proposal): hyperparameters rendered as mockup-style labeled subslabs"
```

---

### Task 9: Auto-recompute STEP 1 on `max_candidates` edit (debounced)

**Files:**
- Modify: `app/frontend/src/components/proposal/panels/ServiceProposalPanel.tsx`
- Test: `app/frontend/tests/proposal_service_panel.test.tsx`

**Interfaces:**
- Consumes: `state.serviceParameterOverrides['top_k']`, `runWith`, `state.runLog`.
- Produces: after a run exists, changing `top_k` re-runs STEP 1 once, debounced ~400 ms, guarded against the initial autoInit and in-flight runs.

- [ ] **Step 1: Add a failing test (fake timers)**

```tsx
it('editing max_candidates triggers a debounced STEP-1 re-run', async () => {
  vi.useFakeTimers()
  // …render + initial run so a runLog exists…
  const createRunMock = /* the mocked createRun */
  createRunMock.mockClear()
  fireEvent.change(screen.getByLabelText('max_candidates'), { target: { value: '2' } })
  expect(createRunMock).not.toHaveBeenCalled() // debounced, not yet
  await act(async () => { vi.advanceTimersByTime(450) })
  expect(createRunMock).toHaveBeenCalledTimes(1)
  vi.useRealTimers()
})
```

(Match the existing mocking style in this file — `createRun` is already mocked via `vi.mock('../src/api/proposalClient', …)`; reuse that handle. Import `act`, `vi` as needed.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/proposal_service_panel.test.tsx`
Expected: FAIL (no re-run fires).

- [ ] **Step 3: Implement the debounced effect**

Add near the other effects, keyed on the top_k override and gated on an existing run:

```tsx
const topKOverride = state.serviceParameterOverrides['top_k']
const didInitialRun = useRef(false)
useEffect(() => {
  // Only recompute for edits AFTER the first run exists; skip the very first
  // time a runLog appears (that was the initial/autoInit run, not an edit).
  if (!state.runLog) return
  if (!didInitialRun.current) { didInitialRun.current = true; return }
  if (running) return
  const contentPackageId = state.contentPackageId ?? contentPackages[0]?.id
  if (!manifest || !contentPackageId) return
  const handle = setTimeout(() => {
    void runWith(state.world, manifest.id, contentPackageId)
  }, 400)
  return () => clearTimeout(handle)
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [topKOverride])
```

- [ ] **Step 4: Run to verify passing**

Run: `npx vitest run tests/proposal_service_panel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/frontend/src/components/proposal/panels/ServiceProposalPanel.tsx app/frontend/tests/proposal_service_panel.test.tsx
git commit -m "feat(proposal): debounced auto-recompute of STEP 1 on max_candidates edit"
```

---

### Task 10: Full suite, build, and live verification

**Files:**
- Test: entire `app/frontend/tests/`

- [ ] **Step 1: Full test suite**

Run: `npm run test`
Expected: PASS. Investigate and fix any regressions in `proposal_mode_toggle.test.tsx`, `journey_action_bar.test.tsx`, `proposal_timeline_recompute.test.tsx` — those components still exist and their unit tests should still pass (we only stopped rendering them in the service panel). If any of those tests asserted rendering *via the service panel*, migrate the assertion to render the component directly.

- [ ] **Step 2: Typecheck + build**

Run: `npm run build`
Expected: clean (no unused imports/vars left from Task 6).

- [ ] **Step 3: Live verification**

Start the app (`docker compose up` from repo root, or the frontend dev server) and open the Proposal screen (auto-init reference journey). Confirm:
- One feature trace per candidate, top-5 with a working "Show more", no Provenance/Status columns, missing/neutral rows blurred.
- Choose enabled only for `music_playlist`/`humming_karaoke`/`full_karaoke`; others disabled with "Out of V1 scope".
- Numbers show 3 decimals.
- No journey readout / journey bar / timeline / recompute / mode toggle.
- Parameters box: editable max_candidates, read-only gamma/confidence, no policy/tie/gap.
- Hyperparameters render as labeled subslabs.
- Editing max_candidates re-runs STEP 1 after a short pause.

- [ ] **Step 4: Final commit (if any verification fixes)**

```bash
git add -A
git commit -m "test(proposal): migrate suite for service-panel refinements; verify build"
```

## Self-Review

- **Spec coverage:** #1 → Task 3; #2 → Task 5; #3 → Task 1; #4 → Task 8; #5/#6/#7 + mode → Task 6; #8 → Task 7; #9 → Tasks 6 (mode) + 9 (recompute); drop-Table-A → Tasks 2+4. All nine points + both owner Q's covered.
- **Placeholder scan:** every code step shows concrete code; test steps show concrete assertions. Fixture extension (Task 7) is described with the exact source manifest to mirror.
- **Type consistency:** `hasFeatureTrace(candidate: RankedCandidate): boolean` defined in Task 2, consumed in Task 4. `showTable?: boolean` defined + consumed consistently. `top_k` is the manifest key; `max_candidates` is the display label only.
