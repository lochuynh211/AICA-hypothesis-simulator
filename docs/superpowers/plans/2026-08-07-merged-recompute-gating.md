# Combined-screen recompute gating + busy overlay — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the Combined Simulator's recompute (`quickview`) from colliding when setup fields change rapidly, by gating recompute behind popup-close + a latest-wins guard, and locking the screen with a busy overlay while a recompute is in flight.

**Architecture:** Three coordinated changes in `app/frontend`: (1) the merged coordinator gains a `quickviewPending` flag + a monotonic request-sequence guard so only the newest `quickview` response wins; (2) `MergedSetupPanel` suppresses the debounced auto-quickview and the live-run-reset effects while any Edit popup is open, firing exactly one recompute when the popup closes; (3) a new `BusyOverlay` covers the whole `.merged-shell` and swallows input while `quickviewPending` is true.

**Tech Stack:** React 18 + TypeScript + Vite; Vitest + @testing-library/react; plain inline styles + `app.css`.

## Global Constraints

- **`app/frontend` only.** The `htmlapp/frontend` mirror is a separate follow-up task after owner review — do NOT edit any `htmlapp/` file in this plan.
- **Backend is source of truth; frontend never decides.** `quickview` is display-only — dropping a stale response is safe and must not surface as an error or write evidence.
- **No Confirm button.** Closing a popup by any path (× / Escape / backdrop) is the "apply" action that triggers the single recompute.
- **Bilingual UI (JA/EN).** Any user-visible string uses `t(label, lang)` with both `ja` and `en` — no hardcoded English. Follow the existing `LABELS` object pattern.
- **Test runner:** `docker compose exec frontend npm test -- <testfile>` (from repo root). `npm test` maps to `vitest run`. If Docker is unavailable, fall back to `cd app/frontend && npm test -- <testfile>`.
- **Never commit until explicitly commanded by the user** (fixbug-0806 branch discipline). The "Commit" steps below are staged for when the user gives the word — do NOT run `git commit` unprompted; stop after the implementation+test steps of each task and report.

---

## File Structure

- **Modify** `app/frontend/src/state/mergedCoordinator.tsx` — add `quickviewPending` state, `QUICKVIEW_PENDING`/`QUICKVIEW_SETTLED` actions, and the seq-guarded `quickview()` body.
- **Create** `app/frontend/src/components/merged/BusyOverlay.tsx` — the input-blocking spinner overlay, driven by `coordinator.state.quickviewPending`.
- **Modify** `app/frontend/src/components/merged/MergedShell.tsx` — mount `<BusyOverlay/>` inside `.merged-shell`.
- **Modify** `app/frontend/src/components/merged/MergedSetupPanel.tsx` — add `openEdit !== null` guards to the auto-quickview effect (~:1044) and the live-run-reset effect (~:1121).
- **Modify** `app/frontend/src/styles/app.css` — `.merged-shell { position: relative }` + `.merged-busy-overlay` + spinner keyframes.
- **Create** `app/frontend/tests/merged_quickview_gating.test.tsx` — coordinator latest-wins + pending-flag tests, and setup-panel suppress/fire-on-close + overlay test.

---

## Task 1: Coordinator — `quickviewPending` state + latest-wins guard

**Files:**
- Modify: `app/frontend/src/state/mergedCoordinator.tsx`
- Test: `app/frontend/tests/merged_quickview_gating.test.tsx` (create)

**Interfaces:**
- Consumes: existing `MergedInstantResult`, `mergedQuickview` (from `api/mergedClient`), `useMergedCoordinator`.
- Produces:
  - `MergedCoordinatorState.quickviewPending: boolean`
  - actions `{ type: 'QUICKVIEW_PENDING' }` and `{ type: 'QUICKVIEW_SETTLED' }`
  - `quickview(body)` unchanged signature (`(body: MergedQuickviewReq) => Promise<void>`) but now: sets pending true before await; only the newest call's result dispatches `QUICKVIEW_LOADED`; the newest call clears pending via `QUICKVIEW_SETTLED` in `finally`.

- [ ] **Step 1: Write the failing test**

Create `app/frontend/tests/merged_quickview_gating.test.tsx` with the coordinator tests. Mirror `merged_coordinator.test.tsx`'s mock + `renderHook` conventions.

```tsx
/**
 * merged_quickview_gating.test.tsx (fixbug-0806) — the Combined screen's
 * recompute-collision fix:
 *   - coordinator.quickview() sets state.quickviewPending true while in
 *     flight and clears it when it settles;
 *   - two overlapping quickview() calls: only the LATEST response is applied
 *     to state.quickviewResult (an older, slower response is dropped);
 *   - MergedSetupPanel suppresses the auto-quickview while an Edit popup is
 *     open, and fires exactly one on close;
 *   - the BusyOverlay blocks the screen while quickviewPending is true.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import React from 'react'
import { MergedCoordinatorProvider, useMergedCoordinator } from '../src/state/mergedCoordinator'
import type { MergedInstantResult } from '../src/api/mergedClient'

vi.mock('../src/api/mergedClient', () => ({
  createMergedRun: vi.fn(),
  tickMergedRun: vi.fn(),
  mergedProposalAction: vi.fn(),
  mergedQuickview: vi.fn(),
  afterRestProposal: vi.fn(),
}))

import { mergedQuickview } from '../src/api/mergedClient'

function resultWithSeed(seed: number): MergedInstantResult {
  return {
    fired: false, fire: null, fires: [], peak_score: 0, threshold: 0,
    score_series: [], monotony_series: [], monotony_threshold: null, spikes: [],
    segments: [], rest_spot: null, rest_option: null, rest_spots: [], rest_options: [],
    completed_min: 0, seed, overrides: [], error: null,
  } as unknown as MergedInstantResult
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <MergedCoordinatorProvider>{children}</MergedCoordinatorProvider>
)

const qvBody = {
  package_id: 'p', scenario_id: 's', run_seed: 1, world: {} as never,
  service_package_id: 'svc', content_package_id: 'cnt', run_seed_proposal: '1',
} as never

describe('mergedCoordinator quickview gating (fixbug-0806)', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('sets quickviewPending while in flight and clears it when settled', async () => {
    let resolve: (r: MergedInstantResult) => void = () => {}
    vi.mocked(mergedQuickview).mockReturnValue(
      new Promise<MergedInstantResult>((r) => { resolve = r }),
    )
    const { result } = renderHook(() => useMergedCoordinator(), { wrapper })

    let pending: Promise<void>
    act(() => { pending = result.current.quickview(qvBody) })
    await waitFor(() => expect(result.current.state.quickviewPending).toBe(true))

    await act(async () => { resolve(resultWithSeed(1)); await pending })
    expect(result.current.state.quickviewPending).toBe(false)
    expect(result.current.state.quickviewResult?.seed).toBe(1)
  })

  it('drops a stale (older) response when a newer quickview started', async () => {
    // First call resolves LAST; second call resolves FIRST. The newest call
    // (second) must own the result — the first response is dropped.
    let resolveFirst: (r: MergedInstantResult) => void = () => {}
    let resolveSecond: (r: MergedInstantResult) => void = () => {}
    vi.mocked(mergedQuickview)
      .mockReturnValueOnce(new Promise<MergedInstantResult>((r) => { resolveFirst = r }))
      .mockReturnValueOnce(new Promise<MergedInstantResult>((r) => { resolveSecond = r }))

    const { result } = renderHook(() => useMergedCoordinator(), { wrapper })

    let firstCall: Promise<void>
    let secondCall: Promise<void>
    act(() => { firstCall = result.current.quickview(qvBody) })
    act(() => { secondCall = result.current.quickview(qvBody) })

    // Newer (second) resolves first and wins.
    await act(async () => { resolveSecond(resultWithSeed(2)); await secondCall })
    expect(result.current.state.quickviewResult?.seed).toBe(2)

    // Older (first) resolves late and is DROPPED — result stays seed 2,
    // and pending stays false (the newest call already cleared it).
    await act(async () => { resolveFirst(resultWithSeed(1)); await firstCall })
    expect(result.current.state.quickviewResult?.seed).toBe(2)
    expect(result.current.state.quickviewPending).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec frontend npm test -- merged_quickview_gating`
Expected: FAIL — `quickviewPending` is `undefined` (property does not exist yet) and the stale-drop assertion fails because the current `quickview` applies every response.

- [ ] **Step 3: Add `quickviewPending` to state + initial state**

In `mergedCoordinator.tsx`, add to the `MergedCoordinatorState` type (after `speed: 1 | 2 | 4`):

```tsx
  /** True while a `quickview()` recompute is in flight. Drives the
   * whole-shell BusyOverlay that locks the screen so no setup field/dropdown
   * can change mid-recompute (fixbug-0806). */
  quickviewPending: boolean
```

Add to `initialMergedCoordinatorState` (after `speed: 4,`):

```tsx
  quickviewPending: false,
```

- [ ] **Step 4: Add the two actions + reducer cases**

Add to the `MergedCoordinatorAction` union (after the `QUICKVIEW_LOADED` entry):

```tsx
  /** A quickview recompute started — lock the screen. */
  | { type: 'QUICKVIEW_PENDING' }
  /** A quickview recompute settled (success, failure, or dropped-as-stale) —
   * unlock the screen. Dispatched only by the NEWEST call (fixbug-0806). */
  | { type: 'QUICKVIEW_SETTLED' }
```

In the reducer, change the existing `QUICKVIEW_LOADED` case to also clear pending, and add the two new cases just after it:

```tsx
    case 'QUICKVIEW_LOADED':
      // A fresh projection invalidates any previously-inspected fire / rest-option
      // index (they indexed into the PRIOR quickviewResult, which this replaces).
      return {
        ...state,
        quickviewResult: action.result,
        quickviewPending: false,
        inspectedFireIndex: null,
        inspectedRestOptionIndex: null,
        afterRestOverride: null,
      }

    case 'QUICKVIEW_PENDING':
      return { ...state, quickviewPending: true }

    case 'QUICKVIEW_SETTLED':
      return { ...state, quickviewPending: false }
```

- [ ] **Step 5: Add the seq ref and rewrite `quickview()`**

In `MergedCoordinatorProvider`, add a ref alongside the other refs (near `choosingRef`):

```tsx
  // Monotonic sequence for quickview() — a slower/older response must never
  // overwrite a newer one (fixbug-0806 collision fix). Only the call whose
  // captured seq still equals `.current` applies its result and clears pending.
  const quickviewSeqRef = useRef(0)
```

Replace the existing `quickview` function body with:

```tsx
  const quickview = async (body: MergedQuickviewReq): Promise<void> => {
    const seq = ++quickviewSeqRef.current
    dispatch({ type: 'QUICKVIEW_PENDING' })
    try {
      const result = await mergedQuickview(body)
      // Only the NEWEST call applies its result — an older, slower response is
      // dropped (display-only, so dropping is safe — CLAUDE.md: never disguised).
      if (seq === quickviewSeqRef.current) {
        dispatch({ type: 'QUICKVIEW_LOADED', result })
      }
    } catch (err) {
      if (seq === quickviewSeqRef.current) {
        dispatch({
          type: 'ERROR',
          message: resolveErrorMessage(err, FAILURE_LABELS.quickview, lang),
        })
      }
    } finally {
      // Only the newest call owns the pending flag — a stale call settling must
      // not clear an overlay a newer in-flight call still needs.
      if (seq === quickviewSeqRef.current) {
        dispatch({ type: 'QUICKVIEW_SETTLED' })
      }
    }
  }
```

(Note: `QUICKVIEW_LOADED` already sets `quickviewPending:false`; the `QUICKVIEW_SETTLED` in `finally` is the belt-and-braces path for the error/dropped branches. Dispatching both on success is harmless — the second is a no-op on an already-false flag.)

- [ ] **Step 6: Run test to verify it passes**

Run: `docker compose exec frontend npm test -- merged_quickview_gating`
Expected: PASS (both coordinator tests).

- [ ] **Step 7: Run the existing coordinator + quickview suites (no regression)**

Run: `docker compose exec frontend npm test -- merged_coordinator merged_quickview_ui merged_proposal_time`
Expected: PASS — the added state field is additive; `QUICKVIEW_LOADED`'s existing behavior is preserved.

- [ ] **Step 8: Stage for commit (do NOT commit — await user command)**

```bash
git add app/frontend/src/state/mergedCoordinator.tsx app/frontend/tests/merged_quickview_gating.test.tsx
# git commit deferred — fixbug-0806: never commit until commanded
```

---

## Task 2: BusyOverlay component + CSS

**Files:**
- Create: `app/frontend/src/components/merged/BusyOverlay.tsx`
- Modify: `app/frontend/src/components/merged/MergedShell.tsx`
- Modify: `app/frontend/src/styles/app.css`
- Test: extend `app/frontend/tests/merged_quickview_gating.test.tsx`

**Interfaces:**
- Consumes: `useMergedCoordinator()` (`state.quickviewPending`), `useLanguage()`, `t`.
- Produces: default export `BusyOverlay` (zero props) rendering `null` when not pending, else a `data-testid="merged-busy-overlay"` blocker with a `role="status"` spinner + label.

- [ ] **Step 1: Write the failing test**

Append to `app/frontend/tests/merged_quickview_gating.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import BusyOverlay from '../src/components/merged/BusyOverlay'
import { LanguageProvider } from '../src/state/language'

describe('BusyOverlay (fixbug-0806)', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('renders nothing when no quickview is pending', () => {
    render(
      <LanguageProvider initialLanguage="en">
        <MergedCoordinatorProvider>
          <BusyOverlay />
        </MergedCoordinatorProvider>
      </LanguageProvider>,
    )
    expect(screen.queryByTestId('merged-busy-overlay')).toBeNull()
  })

  it('renders the blocking overlay while a quickview is in flight', async () => {
    let resolve: (r: MergedInstantResult) => void = () => {}
    vi.mocked(mergedQuickview).mockReturnValue(
      new Promise<MergedInstantResult>((r) => { resolve = r }),
    )
    const coordinatorRef: { current: ReturnType<typeof useMergedCoordinator> | null } = { current: null }
    function Capture() { coordinatorRef.current = useMergedCoordinator(); return null }

    render(
      <LanguageProvider initialLanguage="en">
        <MergedCoordinatorProvider>
          <Capture />
          <BusyOverlay />
        </MergedCoordinatorProvider>
      </LanguageProvider>,
    )

    let pending: Promise<void>
    act(() => { pending = coordinatorRef.current!.quickview(qvBody) })
    await waitFor(() => expect(screen.getByTestId('merged-busy-overlay')).toBeInTheDocument())

    await act(async () => { resolve(resultWithSeed(1)); await pending })
    expect(screen.queryByTestId('merged-busy-overlay')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec frontend npm test -- merged_quickview_gating`
Expected: FAIL — `BusyOverlay` module does not exist (import error).

- [ ] **Step 3: Create the BusyOverlay component**

Create `app/frontend/src/components/merged/BusyOverlay.tsx`:

```tsx
/**
 * BusyOverlay (fixbug-0806) — a translucent, input-swallowing blocker over the
 * whole `.merged-shell` while a `quickview()` recompute is in flight
 * (`coordinator.state.quickviewPending`). It prevents any setup field or
 * left-panel dropdown from changing mid-recompute, which is what caused
 * overlapping quickview requests to resolve out of order.
 *
 * Rendered as a direct child of the `.merged-shell` div (which is
 * `position: relative`), so it is absolutely positioned within the 3-column
 * grid and covers all of it. It does NOT need to cover open Edit popups: while
 * a popup is open the recompute is SUPPRESSED (MergedSetupPanel), so the
 * overlay only appears after a popup has closed.
 */
import { useMergedCoordinator } from '../../state/mergedCoordinator'
import { useLanguage } from '../../state/language'
import { t } from '../../i18n/t'

const LABELS = {
  recomputing: { ja: '再計算中…', en: 'Recomputing…' },
}

export default function BusyOverlay(): JSX.Element | null {
  const { state } = useMergedCoordinator()
  const { lang } = useLanguage()
  if (!state.quickviewPending) return null
  return (
    <div className="merged-busy-overlay" data-testid="merged-busy-overlay" aria-hidden={false}>
      <div className="merged-busy-overlay__box" role="status" aria-live="polite">
        <span className="merged-busy-overlay__spinner" />
        <span>{t(LABELS.recomputing, lang)}</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add the CSS**

In `app/frontend/src/styles/app.css`, add `position: relative` to the `.merged-shell` rule (it currently has none). Change:

```css
.merged-shell {
  display: grid;
  grid-template-columns: 20fr 45fr 35fr;
  grid-template-rows: 1fr;
  height: 100%;
  width: 100%;
  overflow: hidden;
}
```

to add one line:

```css
.merged-shell {
  display: grid;
  grid-template-columns: 20fr 45fr 35fr;
  grid-template-rows: 1fr;
  height: 100%;
  width: 100%;
  overflow: hidden;
  position: relative; /* anchors .merged-busy-overlay (fixbug-0806) */
}
```

Then append this block after the `.merged-shell .left-panel` rule:

```css
/* ── Busy overlay (fixbug-0806) — locks the whole Combined screen while a
   quickview recompute is in flight so no field/dropdown can change and cause
   overlapping requests. z-index below the modal backdrop (1000) — it never
   needs to cover a popup, since recompute is suppressed while one is open. ── */
.merged-busy-overlay {
  position: absolute;
  inset: 0;
  z-index: 900;
  background: rgba(248, 250, 252, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: progress;
}

.merged-busy-overlay__box {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
  padding: 12px 18px;
  font-size: 0.85em;
  font-weight: 600;
  color: #334155;
}

.merged-busy-overlay__spinner {
  width: 16px;
  height: 16px;
  border: 2px solid #cbd5e1;
  border-top-color: #7c3aed;
  border-radius: 50%;
  animation: merged-busy-spin 0.7s linear infinite;
}

@keyframes merged-busy-spin {
  to { transform: rotate(360deg); }
}
```

- [ ] **Step 5: Mount BusyOverlay in MergedShell**

In `app/frontend/src/components/merged/MergedShell.tsx`, add the import near the other component imports:

```tsx
import BusyOverlay from './BusyOverlay'
```

Then render it as the FIRST child of the `.merged-shell` div in `MergedLiveBody` (so it overlays all three panels):

```tsx
    <div className="merged-shell" data-testid="merged-shell">
      <BusyOverlay />
      <div className="left-panel">
```

- [ ] **Step 6: Run test to verify it passes**

Run: `docker compose exec frontend npm test -- merged_quickview_gating`
Expected: PASS (both BusyOverlay tests + the Task 1 coordinator tests).

- [ ] **Step 7: Run the merged layout suite (no regression)**

Run: `docker compose exec frontend npm test -- merged_review_layout merged_center`
Expected: PASS — `BusyOverlay` renders `null` when idle, so it adds nothing to the DOM in existing tests.

- [ ] **Step 8: Stage for commit (do NOT commit — await user command)**

```bash
git add app/frontend/src/components/merged/BusyOverlay.tsx app/frontend/src/components/merged/MergedShell.tsx app/frontend/src/styles/app.css app/frontend/tests/merged_quickview_gating.test.tsx
# git commit deferred — fixbug-0806: never commit until commanded
```

---

## Task 3: Suppress recompute while an Edit popup is open

**Files:**
- Modify: `app/frontend/src/components/merged/MergedSetupPanel.tsx`
- Test: extend `app/frontend/tests/merged_quickview_gating.test.tsx`

**Interfaces:**
- Consumes: existing `openEdit` state (`EditKey | null`) already in the panel; `coordinator.quickview` from Task 1.
- Produces: the auto-quickview effect and the live-run-reset effect now both no-op while `openEdit !== null`, and re-run (firing exactly one quickview / one reset check) when `openEdit` returns to `null`.

- [ ] **Step 1: Write the failing test**

Append a setup-panel gating test to `app/frontend/tests/merged_quickview_gating.test.tsx`. This mounts the REAL `MergedSetupPanel` with the same mock scaffold `merged_setup.test.tsx` uses. Copy the full mock block and the render helper from `tests/merged_setup.test.tsx` (do not paraphrase — reuse its `vi.mock` for `api/client`, `api/proposalClient`, `api/mergedClient`, and its registry-list mock return values), then add:

```tsx
// (After the existing merged_setup.test.tsx-style mocks + a renderSetupPanel
// helper that mounts MergedSetupPanel inside the real providers and returns
// the coordinatorRef — see merged_setup.test.tsx for the exact helper shape.)

it('does NOT recompute while an Edit popup is open, then fires exactly once on close', async () => {
  // Wait until the panel has auto-selected route/scenario/packages and fired
  // its initial debounced quickview, then reset the spy so we count only what
  // happens around the popup.
  const coordinatorRef = renderSetupPanel()
  await waitFor(() => expect(mergedQuickview).toHaveBeenCalled())
  vi.mocked(mergedQuickview).mockClear()

  // Open the Situation Edit popup.
  await act(async () => { fireEvent.click(screen.getByTestId('edit-situation')) })

  // Change a field INSIDE the popup (basic tier initial-drowsiness input).
  await act(async () => {
    fireEvent.change(screen.getByTestId('basic-initial_drowsiness'), { target: { value: '77' } })
  })
  // Advance past the 500ms debounce — still no recompute, because the popup is open.
  await act(async () => { await new Promise((r) => setTimeout(r, 600)) })
  expect(mergedQuickview).not.toHaveBeenCalled()

  // Close the popup (× button) — this is the "apply" action.
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /close|閉じる/i })) })
  await act(async () => { await new Promise((r) => setTimeout(r, 600)) })
  await waitFor(() => expect(mergedQuickview).toHaveBeenCalledTimes(1))
})
```

Note for the implementer: `renderSetupPanel()` is the local helper you build by copying `merged_setup.test.tsx`'s render setup (real `MergedCoordinatorProvider`/`RunStoreProvider`/`ProposalStoreProvider`/`ReviewStoreProvider`/`LanguageProvider`, mocked network). Use real timers (do not enable `vi.useFakeTimers`) so the `setTimeout(600)` waits work with the panel's 500ms debounce. Ensure the registry-list mocks resolve so `isComplete` becomes true and the initial quickview fires.

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec frontend npm test -- merged_quickview_gating`
Expected: FAIL — today the field change inside the open popup schedules a quickview after 500ms, so `mergedQuickview` IS called while the popup is open (the `not.toHaveBeenCalled()` assertion fails).

- [ ] **Step 3: Add the `openEdit` guard to the auto-quickview effect**

In `MergedSetupPanel.tsx`, find the auto-quickview effect (comment `// Auto-quickview (debounced) on ANY setup change, before a run exists.`, ~line 1044). Change its early-return guard and add `openEdit` to the dependency array.

Change:

```tsx
  useEffect(() => {
    if (!isComplete || hasRun) return
    const timer = setTimeout(() => {
```

to:

```tsx
  useEffect(() => {
    // Suppress recompute while an Edit popup is open (fixbug-0806): fields still
    // write to the store live (map overlays / drift note stay accurate), but the
    // projection is NOT recomputed until the popup closes. When `openEdit` returns
    // to null this effect re-runs and fires exactly one quickview against the
    // final edited values — closing the popup IS the "apply" action (no Confirm
    // button). This is what stops rapid in-popup edits from firing overlapping
    // quickview requests that resolve out of order.
    if (!isComplete || hasRun || openEdit !== null) return
    const timer = setTimeout(() => {
```

Then add `openEdit` to that effect's dependency array (append it to the existing list ending `...rs.contextOverrides, rs.profileOverrides, rs.tickSecondsOverride])`):

```tsx
      quickviewInitialState, rs.contextOverrides, rs.profileOverrides, rs.tickSecondsOverride, openEdit])
```

- [ ] **Step 4: Add the `openEdit` guard to the live-run-reset effect**

Find the live-run-reset effect (comment `// Issue 2: editing ANY setup field after a live run has been created...`, the `useEffect` at ~line 1121 keyed on `[setupSignature, coordinator]`). Add an `openEdit` guard so a keystroke inside a popup does not reset a running sim mid-edit; the reset happens once on close when the signature has actually changed.

Change:

```tsx
  const prevSetupSig = useRef(setupSignature)
  useEffect(() => {
    if (prevSetupSig.current === setupSignature) return
    prevSetupSig.current = setupSignature
    if (coordinator.state.mergedRunId != null || coordinator.state.running) {
      coordinator.reset()
    }
  }, [setupSignature, coordinator])
```

to:

```tsx
  const prevSetupSig = useRef(setupSignature)
  useEffect(() => {
    // Don't reset a live run on every keystroke inside an open popup
    // (fixbug-0806) — defer until the popup closes. `prevSetupSig` is NOT
    // updated while suppressed, so the accumulated change is still detected on
    // close and triggers a single reset.
    if (openEdit !== null) return
    if (prevSetupSig.current === setupSignature) return
    prevSetupSig.current = setupSignature
    if (coordinator.state.mergedRunId != null || coordinator.state.running) {
      coordinator.reset()
    }
  }, [setupSignature, coordinator, openEdit])
```

- [ ] **Step 5: Run test to verify it passes**

Run: `docker compose exec frontend npm test -- merged_quickview_gating`
Expected: PASS — no quickview while the popup is open; exactly one after close.

- [ ] **Step 6: Run the full merged setup suite (no regression)**

Run: `docker compose exec frontend npm test -- merged_setup merged_setup_basic_tiers merged_painter_ui`
Expected: PASS — the guard only defers recompute during an open popup; all other paths are unchanged.

- [ ] **Step 7: Stage for commit (do NOT commit — await user command)**

```bash
git add app/frontend/src/components/merged/MergedSetupPanel.tsx app/frontend/tests/merged_quickview_gating.test.tsx
# git commit deferred — fixbug-0806: never commit until commanded
```

---

## Task 4: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the entire frontend test suite**

Run: `docker compose exec frontend npm test`
Expected: PASS with no NEW failures relative to the pre-change baseline. If any merged-screen test regressed, fix it before reporting done. (Frontend suite is expected green; unlike the backend suite, it has no known pre-existing failures noted in memory — but if a failure is clearly unrelated and pre-existing, note it rather than force-fixing.)

- [ ] **Step 2: Manual smoke (report to user, do not automate)**

Report to the user that the fix is ready for their manual review at `http://localhost:5180`:
- Open the Combined screen, open an Edit popup, change several fields fast → no recompute flicker; on close, the busy overlay appears once and the projection updates once.
- Change left-panel dropdowns rapidly → overlay locks the screen each time; final selection's projection wins (no stale result).

- [ ] **Step 3: Await user's commit command**

Do NOT commit. Report that all `app/frontend` changes are staged and tests pass, and that the htmlapp mirror is the pending follow-up once the user has reviewed.

---

## Self-Review Notes

- **Spec coverage:** Task 1 = coordinator pending flag + latest-wins guard (spec §Design.1, §Decisions.4); Task 2 = whole-shell busy overlay (§Design.3, §Decisions.3); Task 3 = suppress-while-open + fire-on-close + no Confirm button (§Design.2, §Decisions.1–2). Testing section (§Testing) is covered across Tasks 1–4.
- **Type consistency:** `quickviewPending` used identically in state, initial state, reducer, `BusyOverlay`, and tests. Actions `QUICKVIEW_PENDING`/`QUICKVIEW_SETTLED` match between the union, reducer, and `quickview()` body. `BusyOverlay` is a default export, imported as such in `MergedShell` and the test.
- **No htmlapp edits** — enforced by Global Constraints and file lists.
- **Commit discipline** — every task ends with a staged-but-not-committed step per fixbug-0806 rule.
