# Combined-screen timing line redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline per-event timing list under the 提案分類 strip with (1) a route-duration line + a popup-opener button, and (2) a single "active trigger" line that follows the same selection the 提案分類 strip describes; move the full list into a quickview-only popup with proposal-category vocabulary.

**Architecture:** Pure display change. A new pure helper `selectActiveEvent` picks the single trigger to show; a new `EventsListModal` wraps the existing shared `Modal`; `MergedProposalPanel` swaps its inline animated list for the two sub-lines + button + modal. `buildEventTimeline` and `formatDuration` are unchanged.

**Tech Stack:** React 18 + TypeScript, Vitest + @testing-library/react. `npm test` = `vitest run`; `npm run build` = `vite build` (no tsc gate).

## Global Constraints

- **Vocabulary coherence (owner requirement):** the popup's trigger rows MUST use the specification's own 提案分類 wording, resolved through `purposeLabel` in `app/frontend/src/lib/review/reviewVocabulary.ts`:
  - monotony → `purposeLabel('inattentive_driving_prevention_recovery')` = `漫然運転予防のためサービス提案`
  - safety → `purposeLabel('rest_recommended')` = `危険運転防止のため休憩推奨`
  Never a fresh literal, never「モノトニートリガー」/「安全トリガー」.
- **Sub-line 2 carries NO category** — the 提案分類 strip above already does. It is a neutral firing line using the screen's own word **発火** (JA) / **Trigger** (EN).
- Sub-line 2 follows the status strip's selection exactly (click / default-first-fire in quickview; latest-passed-trigger during a live run; nothing before the first trigger in a live run).
- Control (zero-fire) case: route line only — no button, no sub-line 2, no status strip. Must still render above the status-strip early return so no false proposal category is announced.
- No backend change. htmlapp mirror is a separate later step (skip parity fixtures). BYO-key Google Maps invariant untouched (this feature reads no key).
- All work in `app/frontend`. Do NOT touch `htmlapp/`.

---

### Task 1: Add `selectActiveEvent` to the timeline helper

**Files:**
- Modify: `app/frontend/src/lib/merged/eventTimeline.ts` (append one exported function)
- Test: `app/frontend/tests/merged_event_timeline.test.ts` (append one describe block)

**Interfaces:**
- Consumes: existing `MergedTimingModel`, `MergedTimingEvent` (already exported from this file).
- Produces: `selectActiveEvent(model: MergedTimingModel, opts: { fireTick?: number | null; livePos?: number | null }): MergedTimingEvent | null`

- [ ] **Step 1: Write the failing test**

Open `app/frontend/tests/merged_event_timeline.test.ts`. Add `selectActiveEvent` and the `MergedTimingModel` type to the EXISTING import from `../src/lib/merged/eventTimeline` (it already imports `buildEventTimeline`). If `MergedTimingModel` is not already imported, add it. Then append this describe block at the end of the file:

```ts
describe('selectActiveEvent', () => {
  const model: MergedTimingModel = {
    routeDrivingMin: 300,
    events: [
      { kind: 'monotony_trigger', whenMin: 40, arriveInMin: 260, reachTick: 20 },
      { kind: 'rest_begin', whenMin: 120, arriveInMin: null, reachTick: 45 },
      { kind: 'rest_restart', whenMin: 150, arriveInMin: 180, reachTick: 55 },
      { kind: 'safety_trigger', whenMin: 240, arriveInMin: 60, reachTick: 80 },
    ],
  }

  it('returns the trigger matching an inspected/defaulted fireTick', () => {
    expect(selectActiveEvent(model, { fireTick: 80 })?.whenMin).toBe(240)
    expect(selectActiveEvent(model, { fireTick: 20 })?.kind).toBe('monotony_trigger')
  })

  it('returns null when fireTick matches no trigger', () => {
    expect(selectActiveEvent(model, { fireTick: 999 })).toBeNull()
  })

  it('never selects a rest boundary via fireTick (rest ticks are ineligible)', () => {
    // reachTick 45 is a rest_begin — not a trigger, so no active event.
    expect(selectActiveEvent(model, { fireTick: 45 })).toBeNull()
  })

  it('during a live run returns the most-recently-reached trigger', () => {
    expect(selectActiveEvent(model, { livePos: 30 })?.whenMin).toBe(40)  // past fire#0, before fire#1
    expect(selectActiveEvent(model, { livePos: 90 })?.whenMin).toBe(240) // past both
  })

  it('returns null during a live run before the first trigger is reached', () => {
    expect(selectActiveEvent(model, { livePos: 5 })).toBeNull()
  })

  it('prefers an explicit fireTick over livePos', () => {
    // Clicking fire#0 while the run has advanced past fire#1 → show fire#0.
    expect(selectActiveEvent(model, { fireTick: 20, livePos: 90 })?.whenMin).toBe(40)
  })

  it('returns null when neither fireTick nor livePos is given', () => {
    expect(selectActiveEvent(model, {})).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/frontend && npx vitest run tests/merged_event_timeline.test.ts`
Expected: FAIL — `selectActiveEvent is not a function` / not exported.

- [ ] **Step 3: Implement `selectActiveEvent`**

Append to the end of `app/frontend/src/lib/merged/eventTimeline.ts`:

```ts
/**
 * selectActiveEvent — the single trigger event the Combined panel's active-event
 * line shows, chosen to mirror the status strip's `statusSource`:
 *
 *   1. fireTick != null → the trigger with reachTick === fireTick (an explicit
 *      map-marker click, or the default-first-fire in pure quickview).
 *   2. else livePos != null → the most-recently-reached trigger
 *      (greatest reachTick ≤ livePos); none reached yet → null.
 *   3. else → null.
 *
 * Only trigger events are eligible — the active line is a firing (発火) line, so
 * rest boundaries never appear on it (they show only in the full-list popup).
 */
export function selectActiveEvent(
  model: MergedTimingModel,
  opts: { fireTick?: number | null; livePos?: number | null },
): MergedTimingEvent | null {
  const triggers = model.events.filter(
    (e) => e.kind === 'monotony_trigger' || e.kind === 'safety_trigger',
  )
  const fireTick = opts.fireTick ?? null
  const livePos = opts.livePos ?? null

  if (fireTick != null) {
    return triggers.find((e) => e.reachTick === fireTick) ?? null
  }
  if (livePos != null) {
    let best: MergedTimingEvent | null = null
    for (const e of triggers) {
      if (e.reachTick != null && e.reachTick <= livePos) {
        if (best == null || (best.reachTick ?? -Infinity) < e.reachTick) best = e
      }
    }
    return best
  }
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app/frontend && npx vitest run tests/merged_event_timeline.test.ts`
Expected: PASS (all existing cases + the 7 new ones).

- [ ] **Step 5: Commit**

```bash
git add app/frontend/src/lib/merged/eventTimeline.ts app/frontend/tests/merged_event_timeline.test.ts
git commit -m "feat(merged): add selectActiveEvent — pick the proposal-linked trigger for the timing line"
```

---

### Task 2: `EventsListModal` — quickview-only popup

**Files:**
- Create: `app/frontend/src/components/merged/EventsListModal.tsx`
- Test: `app/frontend/tests/events_list_modal.test.tsx` (new)

**Interfaces:**
- Consumes: shared `Modal` (`./Modal`), `purposeLabel` (`../../lib/review/reviewVocabulary`), `formatDuration`, `MergedTimingEvent` type.
- Produces: `export default function EventsListModal({ open, events, onClose }: { open: boolean; events: MergedTimingEvent[]; onClose: () => void }): JSX.Element | null`. DOM hooks: `events-list-modal` (body), `events-list-row-<i>` (each row).

- [ ] **Step 1: Write the failing test**

Create `app/frontend/tests/events_list_modal.test.tsx`:

```tsx
/**
 * events_list_modal.test.tsx — the quickview-only full event list popup.
 * Verifies proposal-category vocabulary (owner requirement), arrive-in display,
 * and that NO reached-marker leaks in (pure projection, no animation).
 */
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { LanguageProvider } from '../src/state/language'
import EventsListModal from '../src/components/merged/EventsListModal'
import type { MergedTimingEvent } from '../src/lib/merged/eventTimeline'

const EVENTS: MergedTimingEvent[] = [
  { kind: 'monotony_trigger', whenMin: 40, arriveInMin: 260, reachTick: 20 },
  { kind: 'rest_begin', whenMin: 120, arriveInMin: null, reachTick: 45 },
  { kind: 'rest_restart', whenMin: 150, arriveInMin: 180, reachTick: 55 },
  { kind: 'safety_trigger', whenMin: 240, arriveInMin: 60, reachTick: 80 },
]

function renderModal(lang: 'ja' | 'en') {
  render(
    <LanguageProvider initialLanguage={lang}>
      <EventsListModal open events={EVENTS} onClose={() => {}} />
    </LanguageProvider>,
  )
}

describe('EventsListModal', () => {
  it('renders every event with the specification 提案分類 vocabulary (JA)', () => {
    renderModal('ja')
    expect(screen.getByTestId('events-list-modal')).toBeInTheDocument()
    expect(screen.getByTestId('events-list-row-0').textContent).toContain('漫然運転予防のためサービス提案')
    expect(screen.getByTestId('events-list-row-3').textContent).toContain('危険運転防止のため休憩推奨')
    // rest boundaries use the screen-coherent begin/restart wording
    expect(screen.getByTestId('events-list-row-1').textContent).toContain('休憩開始')
    expect(screen.getByTestId('events-list-row-2').textContent).toContain('休憩から再開')
  })

  it('shows arrive-in where known and is a pure projection (no reached-marker)', () => {
    renderModal('en')
    // monotony @40m: arrive-in 260 = 4h 20m
    expect(screen.getByTestId('events-list-row-0').textContent).toContain('4h 20m')
    // rest_begin has no arrive-in
    expect(screen.getByTestId('events-list-row-1').textContent).not.toContain('arrive in')
    // No animation/reached marker anywhere in the popup
    expect(screen.getByTestId('events-list-modal').textContent).not.toContain('✓')
  })

  it('renders nothing when closed', () => {
    render(
      <LanguageProvider initialLanguage="en">
        <EventsListModal open={false} events={EVENTS} onClose={() => {}} />
      </LanguageProvider>,
    )
    expect(screen.queryByTestId('events-list-modal')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/frontend && npx vitest run tests/events_list_modal.test.tsx`
Expected: FAIL — cannot resolve `EventsListModal`.

- [ ] **Step 3: Create the component**

Create `app/frontend/src/components/merged/EventsListModal.tsx`:

```tsx
/**
 * EventsListModal — the Combined screen's full projected-event list, shown in a
 * popup (the shared Modal primitive). QUICKVIEW-ONLY: a pure projection with no
 * reached-marker and no dependence on the live tick — the "which trigger is
 * current" concept lives on the panel's active-event line, not here.
 *
 * Trigger rows use the specification's own 提案分類 wording via `purposeLabel`
 * (the SAME table the 提案分類 strip and the map overlay read), so the popup
 * never invents a vocabulary the rest of the screen does not use.
 */
import Modal from './Modal'
import { useLanguage } from '../../state/language'
import { t } from '../../i18n/t'
import type { BilingualLabel } from '../../i18n/t'
import { formatDuration } from '../../lib/formatDuration'
import { purposeLabel } from '../../lib/review/reviewVocabulary'
import type { MergedTimingEvent } from '../../lib/merged/eventTimeline'

const LABELS = {
  title: { ja: 'すべてのイベント（予測）', en: 'All projected events' },
  arriveIn: { ja: '到着まで', en: 'arrive in' },
  restBegin: { ja: '休憩開始', en: 'Rest begins' },
  restRestart: { ja: '休憩から再開', en: 'Restart from rest' },
} satisfies Record<string, BilingualLabel>

/** Category/boundary label for one event — trigger rows resolve through the
 *  shared `purposeLabel` table (proposal-category wording); rest boundaries use
 *  the local begin/restart labels. */
function eventLabel(kind: MergedTimingEvent['kind']): BilingualLabel {
  switch (kind) {
    case 'monotony_trigger':
      return purposeLabel('inattentive_driving_prevention_recovery')
    case 'safety_trigger':
      return purposeLabel('rest_recommended')
    case 'rest_begin':
      return LABELS.restBegin
    case 'rest_restart':
      return LABELS.restRestart
  }
}

export default function EventsListModal({
  open,
  events,
  onClose,
}: {
  open: boolean
  events: MergedTimingEvent[]
  onClose: () => void
}): JSX.Element | null {
  const { lang } = useLanguage()
  return (
    <Modal open={open} title={t(LABELS.title, lang)} onClose={onClose}>
      <div
        data-testid="events-list-modal"
        style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}
      >
        {events.map((ev, i) => (
          <div
            key={i}
            data-testid={`events-list-row-${i}`}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '4px 10px',
              alignItems: 'baseline',
              padding: '6px 8px',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              fontSize: '0.85em',
            }}
          >
            <span style={{ fontWeight: 600 }}>{t(eventLabel(ev.kind), lang)}</span>
            <span style={{ color: '#1d4ed8', fontWeight: 600 }}>@ {formatDuration(ev.whenMin, lang)}</span>
            {ev.arriveInMin != null && (
              <span style={{ color: '#64748b' }}>
                · {t(LABELS.arriveIn, lang)} {formatDuration(ev.arriveInMin, lang)}
              </span>
            )}
          </div>
        ))}
      </div>
    </Modal>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app/frontend && npx vitest run tests/events_list_modal.test.tsx`
Expected: PASS (all 3 cases).

- [ ] **Step 5: Commit**

```bash
git add app/frontend/src/components/merged/EventsListModal.tsx app/frontend/tests/events_list_modal.test.tsx
git commit -m "feat(merged): add EventsListModal — quickview-only event list with proposal-category vocabulary"
```

---

### Task 3: Rewire `MergedProposalPanel` to the two sub-lines + button + popup

**Files:**
- Modify: `app/frontend/src/components/merged/MergedProposalPanel.tsx`
- Test: `app/frontend/tests/merged_proposal_time.test.tsx` (rewrite in place)

**Interfaces:**
- Consumes: `selectActiveEvent` + `buildEventTimeline` (Task 1); `EventsListModal` (Task 2); existing `state.inspectedFireIndex`, `inspectedFire`, `state.latestTrigger`, `state.quickviewResult`; `useRunStore()`.
- Produces: DOM hooks — `merged-route-timing` (block), `merged-route-duration` (value), `merged-view-events-button` (opener, only when events exist), `merged-active-event` (sub-line 2, only when an active trigger resolves). Removes `merged-timing-event-<i>`, `data-reached`, `merged-timing-no-triggers`.

- [ ] **Step 1: Rewrite the panel test file**

Replace the ENTIRE contents of `app/frontend/tests/merged_proposal_time.test.tsx` with:

```tsx
/**
 * merged_proposal_time.test.tsx — the timing line under the 提案分類 strip
 * (Combined screen), redesigned. Verifies: sub-line 1 (route duration + a
 * view-events button); sub-line 2 (the single active trigger) follows the
 * default fire, an explicit click, and the live tick; the quickview-only popup;
 * and the zero-fire control case (route line only, no status strip).
 */
import { render, screen, act, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MergedCoordinatorProvider, useMergedCoordinator } from '../src/state/mergedCoordinator'
import { LanguageProvider } from '../src/state/language'
import { RunStoreProvider } from '../src/state/runStore'
import { ProposalStoreProvider } from '../src/state/proposalStore'
import { ReviewStoreProvider } from '../src/state/reviewStore'
import type { MergedInstantResult, MergedTickResponse } from '../src/api/mergedClient'
import MergedCenterPanel from '../src/components/merged/MergedCenterPanel'

vi.mock('../src/api/mergedClient', () => ({
  createMergedRun: vi.fn(),
  tickMergedRun: vi.fn(),
  mergedProposalAction: vi.fn(),
  mergedQuickview: vi.fn(),
  afterRestProposal: vi.fn(),
}))

import { createMergedRun, tickMergedRun, mergedQuickview } from '../src/api/mergedClient'

function baseResult(partial: Partial<MergedInstantResult>): MergedInstantResult {
  return {
    fired: true, fire: null, fires: [], peak_score: 0, threshold: null,
    score_series: [], progress: [], monotony_series: [], monotony_threshold: null,
    spikes: [], segments: [], traffic_jams: [], rest_spot: null, rest_option: null,
    rest_spots: [], rest_options: [], completed_min: null, seed: 42, overrides: [],
    error: null, ...partial,
  } as MergedInstantResult
}

// Two fires (monotony @tick20/40min, safety @tick80/240min), route D = 300.
function firesFixture(): MergedInstantResult {
  return baseResult({
    completed_min: 300,
    fires: [
      { category: 'monotony_prevention', strength: 'high', tick: 20, time_min: 40, proposal: null, proposal_error: null } as never,
      { category: 'rest_required', strength: 'high', tick: 80, time_min: 240, proposal: null, proposal_error: null } as never,
    ],
  })
}

function controlFixture(): MergedInstantResult {
  return baseResult({ completed_min: 300, fires: [], rest_options: [] })
}

function tickAt(tickIndex: number): MergedTickResponse {
  return {
    trigger: {
      decision: null, error: null, paused: false, completed: false,
      tick_index: tickIndex, route_fraction: 0.3, distance_km: null, speed_kph: 60,
      motion_state: 'MOVING', recovery_phase: null, is_traffic_jam: false, segment_type: 'highway',
    } as never,
    proposal: null,
    correlation: null,
  }
}

function renderCenter(lang: 'ja' | 'en' = 'en') {
  const ref: { current: ReturnType<typeof useMergedCoordinator> | null } = { current: null }
  function Capture() {
    ref.current = useMergedCoordinator()
    return null
  }
  render(
    <LanguageProvider initialLanguage={lang}>
      <MergedCoordinatorProvider>
        <RunStoreProvider>
          <ProposalStoreProvider>
            <ReviewStoreProvider>
              <Capture />
              <MergedCenterPanel />
            </ReviewStoreProvider>
          </ProposalStoreProvider>
        </RunStoreProvider>
      </MergedCoordinatorProvider>
    </LanguageProvider>,
  )
  return ref
}

const QUICKVIEW_ARGS = {
  package_id: 'nri_fatigue_score_v1',
  scenario_id: 'uc01_fatigue_recovery_v0_1',
  run_seed: 42,
  world: {} as never,
  service_package_id: 'mock_service_selector_v1',
  content_package_id: 'mock_content_selector_v1',
  run_seed_proposal: '42',
}

const CREATE_ARGS = {
  trigger_plan_id: 'plan_1', world: {} as never,
  service_package_id: 'mock_service_selector_v1',
  content_package_id: 'mock_content_selector_v1', run_seed: '7',
}

describe('Combined-screen timing line', () => {
  beforeEach(() => vi.resetAllMocks())

  it('shows route duration, a view-events button, and the default fire on sub-line 2 (quickview)', async () => {
    vi.mocked(mergedQuickview).mockResolvedValue(firesFixture())
    const ref = renderCenter('en')
    await act(async () => { await ref.current!.quickview(QUICKVIEW_ARGS) })

    expect((await screen.findByTestId('merged-route-duration')).textContent).toContain('5h')
    expect(screen.getByTestId('merged-view-events-button')).toBeInTheDocument()
    // Default = fire#0 (monotony @40m); arrive-in = 300 − 40 = 260 = 4h 20m.
    const active = screen.getByTestId('merged-active-event')
    expect(active.textContent).toContain('40m')
    expect(active.textContent).toContain('4h 20m')
  })

  it('sub-line 2 follows an explicit trigger click and clears on re-click', async () => {
    vi.mocked(mergedQuickview).mockResolvedValue(firesFixture())
    const ref = renderCenter('en')
    await act(async () => { await ref.current!.quickview(QUICKVIEW_ARGS) })
    // Click fire#1 (safety @240m = 4h); arrive-in = 300 − 240 = 60 = 1h.
    await act(async () => { ref.current!.inspectFire(1) })
    const active = screen.getByTestId('merged-active-event')
    expect(active.textContent).toContain('4h')
    expect(active.textContent).toContain('1h')
    // Re-click (toggle off) → back to the default fire#0 (@40m).
    await act(async () => { ref.current!.inspectFire(null) })
    expect(screen.getByTestId('merged-active-event').textContent).toContain('40m')
  })

  it('during a live run shows nothing on sub-line 2 before the first trigger is passed', async () => {
    vi.mocked(mergedQuickview).mockResolvedValue(firesFixture())
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_t', trigger_run_id: 'run_t' })
    vi.mocked(tickMergedRun).mockResolvedValue(tickAt(5)) // before fire#0 (tick 20)
    const ref = renderCenter('en')
    await act(async () => { await ref.current!.quickview(QUICKVIEW_ARGS) })
    await act(async () => { await ref.current!.create(CREATE_ARGS) })
    await act(async () => { await ref.current!.step() })

    expect(screen.getByTestId('merged-route-duration')).toBeInTheDocument()
    expect(screen.queryByTestId('merged-active-event')).toBeNull()
  })

  it('during a live run sub-line 2 shows the latest passed trigger', async () => {
    vi.mocked(mergedQuickview).mockResolvedValue(firesFixture())
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_t', trigger_run_id: 'run_t' })
    vi.mocked(tickMergedRun).mockResolvedValue(tickAt(30)) // past fire#0 (tick 20), before fire#1 (tick 80)
    const ref = renderCenter('en')
    await act(async () => { await ref.current!.quickview(QUICKVIEW_ARGS) })
    await act(async () => { await ref.current!.create(CREATE_ARGS) })
    await act(async () => { await ref.current!.step() })

    // latest passed trigger = fire#0 (@40m)
    expect(screen.getByTestId('merged-active-event').textContent).toContain('40m')
  })

  it('opens a quickview-only popup listing every event with 提案分類 vocabulary (JA)', async () => {
    vi.mocked(mergedQuickview).mockResolvedValue(firesFixture())
    const ref = renderCenter('ja')
    await act(async () => { await ref.current!.quickview(QUICKVIEW_ARGS) })
    fireEvent.click(screen.getByTestId('merged-view-events-button'))

    const modal = await screen.findByTestId('events-list-modal')
    expect(screen.getByTestId('events-list-row-0').textContent).toContain('漫然運転予防のためサービス提案')
    expect(screen.getByTestId('events-list-row-1').textContent).toContain('危険運転防止のため休憩推奨')
    expect(modal.textContent).not.toContain('✓') // no reached-marker in the popup
  })

  it('control (zero-fire) case: route line only — no button, no sub-line 2, no status strip', async () => {
    vi.mocked(mergedQuickview).mockResolvedValue(controlFixture())
    const ref = renderCenter('en')
    await act(async () => { await ref.current!.quickview(QUICKVIEW_ARGS) })

    expect(screen.getByTestId('merged-route-duration').textContent).toContain('5h')
    expect(screen.queryByTestId('merged-view-events-button')).toBeNull()
    expect(screen.queryByTestId('merged-active-event')).toBeNull()
    expect(screen.queryByTestId('merged-status-strip')).toBeNull()
  })
})
```

> **Note for the implementer:** the click test calls `ref.current!.inspectFire(1)` / `inspectFire(null)`. Confirm the coordinator returned by `useMergedCoordinator()` exposes `inspectFire` (it is used by `MergedCenterPanel` via `coordinator.inspectFire`). If the method is named differently on the returned object, adjust the test call to the actual name — do NOT change production wiring to fit the test.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/frontend && npx vitest run tests/merged_proposal_time.test.tsx`
Expected: FAIL — `merged-view-events-button` / `merged-active-event` not found; old `merged-timing-event-0` gone.

- [ ] **Step 3: Update imports**

In `app/frontend/src/components/merged/MergedProposalPanel.tsx`:

Change the React import at the top to include `useState`. The file currently has no `import ... from 'react'` line at the very top (it imports from other modules). Add this as the FIRST import line:

```tsx
import { useState } from 'react'
```

Replace the existing timeline import line:

```tsx
import { buildEventTimeline, type MergedTimingEvent } from '../../lib/merged/eventTimeline'
```

with:

```tsx
import { buildEventTimeline, selectActiveEvent } from '../../lib/merged/eventTimeline'
import EventsListModal from './EventsListModal'
```

Add `purposeLabel` is already imported via `import { purposeLabel, optionLabel } from '../../lib/review/reviewVocabulary'` — leave that line unchanged.

- [ ] **Step 4: Update the LABELS timing entries**

In the `LABELS` object, DELETE these six entries (they belonged to the old inline list; rest labels now live in `EventsListModal`):

```tsx
  eventsHeading: { ja: 'イベント', en: 'Events' },
  evMonotony: { ja: 'モノトニートリガー', en: 'Monotony trigger' },
  evSafety: { ja: '安全トリガー', en: 'Safety trigger' },
  evRestBegin: { ja: '休憩開始', en: 'Rest begins' },
  evRestRestart: { ja: '休憩から再開', en: 'Restart from rest' },
  noTriggers: { ja: '予測されるトリガーはありません', en: 'No projected triggers' },
```

KEEP `overallRoute` and `arriveIn`. ADD these two (after `arriveIn`):

```tsx
  firing: { ja: '発火', en: 'Trigger' },
  viewEvents: { ja: 'すべてのイベント', en: 'View all events' },
```

- [ ] **Step 5: Replace the timing-model computation and block**

Replace the ENTIRE existing timing section — from the comment `// ── Timing block (feature: combined-screen time display) ──` down to the `timingBlock ... ) : null` assignment (the block currently spanning roughly lines 243–302, ending just before the `// No proposal → the panel contributes NOTHING` comment) — with:

```tsx
  // ── Timing line (feature: combined-screen time display, redesigned) ────────
  // Display-only. One projection (preserved by the coordinator across run
  // creation AND playback) feeds both quickview and animation.
  //   • Sub-line 1: overall driving-only route duration + a button opening the
  //     full event list (quickview-only, in a popup).
  //   • Sub-line 2: the SINGLE trigger the panel is currently describing — the
  //     same selection the 提案分類 strip reads (selectActiveEvent). No category
  //     here; the strip above already carries it.
  const { state: runState } = useRunStore()
  const [eventsOpen, setEventsOpen] = useState(false)
  const routeFactsDurationMin =
    runState.alternatives.find((a) => a.route_id === runState.selectedRouteId)?.route_facts
      .estimated_route_duration_min ?? null
  const timing = buildEventTimeline(state.quickviewResult, routeFactsDurationMin)
  const livePos = state.latestTrigger?.tick_index ?? null

  // Sub-line 2's trigger follows the status strip's selection:
  //  • an explicit fire click (inspectedFireIndex) always wins;
  //  • else, in PURE QUICKVIEW only, the default-first-fire;
  //  • during a live run with no explicit click, livePos drives it instead
  //    (selectActiveEvent branch 2), so nothing shows before the first trigger.
  const fireTick =
    state.inspectedFireIndex != null || livePos == null ? (inspectedFire?.tick ?? null) : null
  const activeEvent = selectActiveEvent(timing, { fireTick, livePos })

  // Rendered only when a projection exists AND yields a route duration or events.
  const hasTiming =
    state.quickviewResult != null && (timing.routeDrivingMin != null || timing.events.length > 0)
  const timingBlock = hasTiming ? (
    <div data-testid="merged-route-timing" style={timingBlockStyle}>
      {/* Sub-line 1: overall driving route duration + open-popup button */}
      <div style={timingRow1Style}>
        {timing.routeDrivingMin != null && (
          <span>
            <span style={statusLabelStyle}>{t(LABELS.overallRoute, lang)}:</span>{' '}
            <span data-testid="merged-route-duration" style={statusValueStyle}>
              {formatDuration(timing.routeDrivingMin, lang)}
            </span>
          </span>
        )}
        {timing.events.length > 0 && (
          <button
            type="button"
            data-testid="merged-view-events-button"
            onClick={() => setEventsOpen(true)}
            style={viewEventsButtonStyle}
          >
            {t(LABELS.viewEvents, lang)}
          </button>
        )}
      </div>
      {/* Sub-line 2: the active trigger (neutral 発火 — the category is on the
          提案分類 strip above, never repeated here). */}
      {activeEvent != null && (
        <div data-testid="merged-active-event" style={timingRow2Style}>
          <span>➤ {t(LABELS.firing, lang)}</span>
          <span style={timingWhenStyle}>@ {formatDuration(activeEvent.whenMin, lang)}</span>
          {activeEvent.arriveInMin != null && (
            <span style={timingArriveStyle}>
              · {t(LABELS.arriveIn, lang)} {formatDuration(activeEvent.arriveInMin, lang)}
            </span>
          )}
        </div>
      )}
      <EventsListModal open={eventsOpen} events={timing.events} onClose={() => setEventsOpen(false)} />
    </div>
  ) : null
```

The early-return block and the normal-return `{timingBlock}` placement are UNCHANGED — the control case still renders `<div data-testid="merged-proposal-panel">{timingBlock}</div>` and the normal return still renders `{timingBlock}` right after the `merged-status-strip` closing `</div>`. Leave both as they are.

- [ ] **Step 6: Swap the timing-block styles**

At the bottom of the file, DELETE `timingRowStyle` (it belonged to the old inline rows):

```tsx
const timingRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '4px 10px',
  alignItems: 'baseline',
}
```

KEEP `timingBlockStyle`, `timingWhenStyle`, `timingArriveStyle`. ADD (next to them):

```tsx
const timingRow1Style: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: '8px',
  flexWrap: 'wrap',
}
const timingRow2Style: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '4px 8px',
  alignItems: 'baseline',
}
const viewEventsButtonStyle: React.CSSProperties = {
  fontSize: '0.9em',
  fontWeight: 700,
  padding: '2px 10px',
  border: '1px solid #cbd5e1',
  borderRadius: '5px',
  background: '#fff',
  color: '#1d4ed8',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}
```

- [ ] **Step 7: Run the panel test to verify it passes**

Run: `cd app/frontend && npx vitest run tests/merged_proposal_time.test.tsx`
Expected: PASS (all 6 cases).

- [ ] **Step 8: Run the merged regression suite**

Run: `cd app/frontend && npx vitest run tests/merged_center.test.tsx tests/merged_quickview_ui.test.tsx tests/merged_review_layout.test.tsx tests/merged_rest_journey.test.tsx`
Expected: PASS. In particular `merged_center.test.tsx`'s "renders nothing until there is a proposal" test must still pass (no quickview → `quickviewResult` null → `timingBlock` null → panel returns null).

- [ ] **Step 9: Commit**

```bash
git add app/frontend/src/components/merged/MergedProposalPanel.tsx app/frontend/tests/merged_proposal_time.test.tsx
git commit -m "feat(merged): proposal-linked timing line + view-events popup (replaces inline event list)"
```

---

### Task 4: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole frontend suite**

Run: `cd app/frontend && npm test`
Expected: PASS across the suite. Two files (`key_safety.test.tsx`, `map.test.tsx`) fail ONLY from a pre-existing Node-26 global-`localStorage` env issue unrelated to this change — note them, do not treat them as regressions. Any failure traceable to Tasks 1–3 must be fixed before completing.

- [ ] **Step 2: Type-check / build**

Run: `cd app/frontend && npm run build`
Expected: no NEW TypeScript errors in `eventTimeline.ts`, `EventsListModal.tsx`, or `MergedProposalPanel.tsx`. (The project carries a known pre-existing tsc baseline in unrelated test files; `vite build` has no tsc gate, so it should complete. If build fails on a file this plan touched, fix it.)

- [ ] **Step 3: Commit any fixups** (only if Steps 1–2 required changes)

```bash
git add -A
git commit -m "fix(merged): resolve type/test fixups for timing line redesign"
```

## Self-Review

**1. Spec coverage:**
- Sub-line 1 route duration + button → Task 3 (`merged-route-duration`, `merged-view-events-button`). ✔
- Sub-line 2 single active trigger, follows click/default/live → Task 1 `selectActiveEvent` + Task 3 `fireTick`/`livePos` wiring + tests. ✔
- No category on sub-line 2 (neutral 発火) → Task 3 `LABELS.firing`. ✔
- Nothing before first trigger in a live run → `selectActiveEvent` branch 2 returns null + Task 3 gate + test. ✔
- Popup quickview-only, no animation → Task 2 (no `livePos`, no reached-marker) + tests asserting no ✓. ✔
- 提案分類 vocabulary in popup → Task 2 `purposeLabel(...)` + JA tests asserting exact strings. ✔
- Control case route-only, no status strip → Task 3 control test (unchanged early-return path). ✔
- Old inline-list hooks removed → Task 3 deletes `merged-timing-event-<i>`/`data-reached`/`merged-timing-no-triggers` and their labels. ✔
- No backend / no htmlapp → Global Constraints. ✔

**2. Placeholder scan:** No TBD/TODO/"similar to Task N". Every code step has complete code. The one flagged uncertainty (coordinator method name `inspectFire`) is called out with a concrete resolution instruction. ✔

**3. Type consistency:**
- `selectActiveEvent(model, { fireTick?, livePos? })` signature identical in Task 1 (def), Task 1 tests, and Task 3 (use). ✔
- `EventsListModal({ open, events, onClose })` identical in Task 2 (def + test) and Task 3 (use). ✔
- `MergedTimingEvent` fields (`kind`, `whenMin`, `arriveInMin`, `reachTick`) used consistently across all three files. ✔
- `purposeLabel(purposeId: string): BilingualLabel` matches its use in `EventsListModal`. ✔
- Removed symbols (`MergedTimingEvent` type import, `timingRowStyle`, six LABELS entries, `eventLabel`/`isReached` locals) are all deleted together in Task 3 — no dangling references. ✔

No gaps found.
