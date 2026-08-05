# Combined-Screen Time Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the misleading route-preset ETA from the Combined-screen setup dropdown, and add a timing block under the "Proposal category" strip that shows overall driving-route duration plus per-event when/arrive-in, working identically in quickview and animation.

**Architecture:** Two frontend-only changes to the Combined ("Merged") simulator, no backend change. Change #1 is a one-line edit to a `<select>` `<option>`. Change #2 adds two pure, unit-tested helpers (`formatDuration`, `buildEventTimeline`) and wires their output into `MergedProposalPanel` as a neutral timing block rendered above the panel's existing "return null for non-firing control cases" guard. All data comes from `state.quickviewResult` (which the coordinator reducer preserves across run creation *and* playback) and `state.latestTrigger.tick_index` (the live position, `null` in pure quickview).

**Tech Stack:** React 18 + TypeScript + Vite, Vitest + @testing-library/react. Tests live in `app/frontend/tests/`, run with `npm test` (`vitest run`). i18n via the local `t(label, lang)` helper — no library.

## Global Constraints

- **Frontend-only.** No backend endpoint, model, or computation changes. Everything derives from data the frontend already holds. (Design §Non-goals)
- **Backend is source of truth.** The frontend may compute display-only values (this timing block is display-only). It must never compute or persist a decision. (CLAUDE.md invariant)
- **BYO-key Google Maps.** Do not ship, persist, log, or export the Maps key. This work does not touch the key; keep it that way. (CLAUDE.md invariant)
- **Bilingual.** Every user-visible string has a `{ ja, en }` entry rendered via `t(label, lang)`. No English may leak onto a Japanese screen and vice-versa. `lang` is `'ja' | 'en'`.
- **Time format:** hours+minutes — `"5h 20m"` (en) / `"5時間20分"` (ja). Drop a zero hour (`"20m"` / `"20分"`), drop a zero minute (`"5h"` / `"5時間"`), zero total → `"0m"` / `"0分"`.
- **Arrive-in is driving-only.** Remaining time excludes parked rest dwell but includes slow-driving through traffic jams. A nap does not shrink remaining drive.
- **Test files** go in `app/frontend/tests/` (flat directory, not co-located). Pure-logic tests import from `../src/...`. Panel tests use a real `MergedCoordinatorProvider` and mock only `../src/api/mergedClient`.
- **htmlapp mirror is a separate, later step** (not in this plan): after owner review of `app/frontend`, mirror byte-identically to `htmlapp/frontend`, **skipping parity-fixture regeneration**.

---

## File Structure

**New files:**
- `app/frontend/src/lib/formatDuration.ts` — pure minutes→localized "Xh Ym" formatter. One job.
- `app/frontend/tests/format_duration.test.ts` — its unit tests.
- `app/frontend/src/lib/merged/eventTimeline.ts` — pure projection→timing-model builder (route driving duration + ordered event rows). One job. (New `lib/merged/` dir; mirrors the existing `lib/review/` convention for pure UI logic.)
- `app/frontend/tests/merged_event_timeline.test.ts` — its unit tests.
- `app/frontend/tests/merged_proposal_time.test.tsx` — panel-level tests (quickview render, reached-marker in animation, control-case).

**Modified files:**
- `app/frontend/src/components/merged/MergedSetupPanel.tsx:1196` — strip the duration fragment from the preset `<option>` (Change #1).
- `app/frontend/tests/merged_setup.test.tsx` — add a Change #1 assertion.
- `app/frontend/src/components/merged/MergedProposalPanel.tsx` — import the two helpers + `useRunStore`; add labels; render the timing block; restructure the early return so control cases show the neutral block (Change #2).

---

### Task 1: Change #1 — remove the route-preset ETA

**Files:**
- Modify: `app/frontend/src/components/merged/MergedSetupPanel.tsx:1196`
- Test: `app/frontend/tests/merged_setup.test.tsx` (add one `it`)

**Interfaces:**
- Consumes: nothing new. Uses the existing `routePresets: RoutePresetSummary[]` state and `p.distance_km` / `p.duration_min`.
- Produces: nothing consumed by later tasks. Purely a display change. `RoutePresetSummary.duration_min` stays on the type and payload (still feeds the route model) — only its rendering is removed.

- [ ] **Step 1: Write the failing test**

Add to `app/frontend/tests/merged_setup.test.tsx`. The existing `setupMocks()` already mocks `listRoutePresets` with `distance_km: 120, duration_min: 90` and `label: { ja: 'ルート1', en: 'Route Preset 1' }`. Place this `it` inside the same top-level `describe` that other setup tests use (find an existing `describe(...)` in the file and add it there):

```tsx
it('shows the preset distance but NOT the unvalidated duration ETA', async () => {
  setupMocks()
  renderSetup() // the file's existing render helper used by other tests
  const select = await screen.findByTestId('merged-route-preset-select')
  // Distance stays; the "~90 min" / "約90分" ETA is gone.
  expect(select.textContent ?? '').toContain('120 km')
  expect(select.textContent ?? '').not.toContain('90 min')
  expect(select.textContent ?? '').not.toContain('約90分')
  expect(select.textContent ?? '').not.toContain('~90')
})
```

Note: use whatever the file's existing render helper is called (grep the file for the helper the other `it(...)` blocks call — e.g. `renderSetup`/`renderPanel`). Match the existing pattern exactly; do not invent a new render harness.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/frontend && npx vitest run tests/merged_setup.test.tsx -t "unvalidated duration"`
Expected: FAIL — the option text still contains `約90分` / `~90 min`.

- [ ] **Step 3: Make the minimal change**

In `app/frontend/src/components/merged/MergedSetupPanel.tsx`, the preset option is at line 1196:

```tsx
{t(p.label, lang)} {lang === 'ja' ? `（${p.distance_km} km、約${p.duration_min}分）` : `(${p.distance_km} km, ~${p.duration_min} min)`}
```

Replace with (drop the duration fragment, keep distance):

```tsx
{t(p.label, lang)} {lang === 'ja' ? `（${p.distance_km} km）` : `(${p.distance_km} km)`}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app/frontend && npx vitest run tests/merged_setup.test.tsx`
Expected: PASS (the new test and all pre-existing setup tests).

- [ ] **Step 5: Commit**

```bash
git add app/frontend/src/components/merged/MergedSetupPanel.tsx app/frontend/tests/merged_setup.test.tsx
git commit -m "feat(merged): remove unvalidated route-preset ETA from setup dropdown"
```

---

### Task 2: `formatDuration` helper

**Files:**
- Create: `app/frontend/src/lib/formatDuration.ts`
- Test: `app/frontend/tests/format_duration.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export function formatDuration(min: number | null | undefined, lang: 'ja' | 'en'): string`. Returns `"Xh Ym"` / `"X時間Y分"` with zero parts dropped; `"—"` for null/undefined/NaN/negative. Task 4 imports this.

- [ ] **Step 1: Write the failing test**

Create `app/frontend/tests/format_duration.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatDuration } from '../src/lib/formatDuration'

describe('formatDuration', () => {
  it('formats hours and minutes (en)', () => {
    expect(formatDuration(320, 'en')).toBe('5h 20m')
    expect(formatDuration(320, 'ja')).toBe('5時間20分')
  })

  it('drops a zero minute part', () => {
    expect(formatDuration(300, 'en')).toBe('5h')
    expect(formatDuration(300, 'ja')).toBe('5時間')
  })

  it('drops a zero hour part', () => {
    expect(formatDuration(20, 'en')).toBe('20m')
    expect(formatDuration(20, 'ja')).toBe('20分')
  })

  it('rounds to whole minutes', () => {
    expect(formatDuration(89.6, 'en')).toBe('1h 30m')
    expect(formatDuration(0.4, 'en')).toBe('0m')
  })

  it('shows zero as 0m / 0分', () => {
    expect(formatDuration(0, 'en')).toBe('0m')
    expect(formatDuration(0, 'ja')).toBe('0分')
  })

  it('guards null / NaN / negative to an em dash', () => {
    expect(formatDuration(null, 'en')).toBe('—')
    expect(formatDuration(undefined, 'en')).toBe('—')
    expect(formatDuration(NaN, 'en')).toBe('—')
    expect(formatDuration(-5, 'en')).toBe('—')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/frontend && npx vitest run tests/format_duration.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/formatDuration'`.

- [ ] **Step 3: Write the implementation**

Create `app/frontend/src/lib/formatDuration.ts`:

```ts
/**
 * Format a duration in minutes as localized hours+minutes.
 *   320 → "5h 20m" / "5時間20分"; 300 → "5h" / "5時間"; 20 → "20m" / "20分";
 *   0 → "0m" / "0分". Rounds to whole minutes. null/undefined/NaN/negative → "—".
 *
 * Display-only (no bearing on any decision) — the Combined screen shows this
 * for the projected route duration and per-event arrive-in times.
 */
export function formatDuration(min: number | null | undefined, lang: 'ja' | 'en'): string {
  if (min == null || Number.isNaN(min) || min < 0) return '—'
  const total = Math.round(min)
  const h = Math.floor(total / 60)
  const m = total % 60
  const hUnit = lang === 'ja' ? '時間' : 'h'
  const mUnit = lang === 'ja' ? '分' : 'm'
  const sep = lang === 'ja' ? '' : ' '
  if (h === 0) return `${m}${mUnit}`
  if (m === 0) return `${h}${hUnit}`
  return `${h}${hUnit}${sep}${m}${mUnit}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app/frontend && npx vitest run tests/format_duration.test.ts`
Expected: PASS (all 6 cases).

- [ ] **Step 5: Commit**

```bash
git add app/frontend/src/lib/formatDuration.ts app/frontend/tests/format_duration.test.ts
git commit -m "feat(merged): add localized hours+minutes duration formatter"
```

---

### Task 3: `buildEventTimeline` helper

**Files:**
- Create: `app/frontend/src/lib/merged/eventTimeline.ts`
- Test: `app/frontend/tests/merged_event_timeline.test.ts`

**Interfaces:**
- Consumes: the `MergedInstantResult` type from `../src/api/mergedClient` (fields used: `fires[].{category,tick,time_min}`, `rest_options[].{recovery_from_min,to_min}`, `completed_min`, `progress[].{t,min}`).
- Produces:
  ```ts
  export type MergedTimingEventKind = 'monotony_trigger' | 'safety_trigger' | 'rest_begin' | 'rest_restart'
  export type MergedTimingEvent = {
    kind: MergedTimingEventKind
    whenMin: number          // wall-clock elapsed at the event
    arriveInMin: number | null   // driving-only remaining to destination; null for rest_begin
    reachTick: number | null     // tick to compare against the live position; null if unknown
  }
  export type MergedTimingModel = {
    routeDrivingMin: number | null   // overall driving-only route duration (parked dwell excluded)
    events: MergedTimingEvent[]      // ascending by whenMin, fire-before-rest on ties
  }
  export function buildEventTimeline(
    result: MergedInstantResult | null | undefined,
    routeFactsDurationMin?: number | null,
  ): MergedTimingModel
  ```
  Task 4 imports `buildEventTimeline` and all four types.

- [ ] **Step 1: Write the failing test**

Create `app/frontend/tests/merged_event_timeline.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildEventTimeline } from '../src/lib/merged/eventTimeline'
import type { MergedInstantResult } from '../src/api/mergedClient'

// Minimal MergedInstantResult factory — only the fields buildEventTimeline reads
// need real values; the rest satisfy the type with inert defaults.
function result(partial: Partial<MergedInstantResult>): MergedInstantResult {
  return {
    fired: true,
    fire: null,
    fires: [],
    peak_score: 0,
    threshold: null,
    score_series: [],
    progress: [],
    monotony_series: [],
    monotony_threshold: null,
    spikes: [],
    segments: [],
    traffic_jams: [],
    rest_spot: null,
    rest_option: null,
    rest_spots: [],
    rest_options: [],
    completed_min: null,
    seed: 42,
    overrides: [],
    error: null,
    ...partial,
  } as MergedInstantResult
}

describe('buildEventTimeline — route duration', () => {
  it('excludes parked dwell but keeps driving time (jam slow-driving counts)', () => {
    // completed_min 330 includes a 30m parked nap → driving route = 300.
    const m = buildEventTimeline(result({
      completed_min: 330,
      rest_options: [{ id: 'r0', auto_chosen: true, recovery_from_min: 150, to_min: 180 } as never],
    }))
    expect(m.routeDrivingMin).toBe(300)
  })

  it('falls back to last progress minute minus parked when completed_min is null', () => {
    const m = buildEventTimeline(result({
      completed_min: null,
      progress: [{ t: 0, min: 0, frac: 0 }, { t: 100, min: 330, frac: 1 }] as never,
      rest_options: [{ id: 'r0', auto_chosen: true, recovery_from_min: 150, to_min: 180 } as never],
    }))
    expect(m.routeDrivingMin).toBe(300)
  })

  it('falls back to route-facts duration when completed_min and progress are absent', () => {
    const m = buildEventTimeline(result({ completed_min: null, progress: [] }), 300)
    expect(m.routeDrivingMin).toBe(300)
  })

  it('returns null route duration when nothing is available', () => {
    expect(buildEventTimeline(result({ completed_min: null }), null).routeDrivingMin).toBeNull()
  })

  it('returns an empty model for a null result', () => {
    expect(buildEventTimeline(null)).toEqual({ routeDrivingMin: null, events: [] })
  })
})

describe('buildEventTimeline — events', () => {
  it('labels categories, orders by minute, and computes driving-only arrive-in', () => {
    // Route D = completed 330 − 30 parked = 300.
    // Monotony @120 (no parked before) → drive elapsed 120 → arrive 180.
    // Rest begins @150, restart @180.
    // Safety @240 (30 parked before) → drive elapsed 210 → arrive 90.
    const m = buildEventTimeline(result({
      completed_min: 330,
      progress: [
        { t: 0, min: 0, frac: 0 }, { t: 40, min: 120, frac: 0.4 },
        { t: 50, min: 150, frac: 0.5 }, { t: 60, min: 180, frac: 0.5 },
        { t: 80, min: 240, frac: 0.8 },
      ] as never,
      fires: [
        { category: 'monotony_prevention', strength: 'high', tick: 40, time_min: 120 } as never,
        { category: 'rest_required', strength: 'high', tick: 80, time_min: 240 } as never,
      ],
      rest_options: [{ id: 'r0', auto_chosen: true, recovery_from_min: 150, to_min: 180 } as never],
    }))

    expect(m.routeDrivingMin).toBe(300)
    expect(m.events.map((e) => [e.kind, e.whenMin, e.arriveInMin])).toEqual([
      ['monotony_trigger', 120, 180],
      ['rest_begin', 150, null],
      ['rest_restart', 180, 120],   // drive elapsed 180 − 30 parked = 150 → arrive 150? see note
      ['safety_trigger', 240, 90],
    ])
  })

  it('reports fire ticks as reachTick', () => {
    const m = buildEventTimeline(result({
      completed_min: 300,
      fires: [{ category: 'rest_required', strength: 'high', tick: 40, time_min: 120 } as never],
    }))
    expect(m.events[0].reachTick).toBe(40)
  })

  it('drops the arrive-in / restart for a rest that never completed (to_min null)', () => {
    const m = buildEventTimeline(result({
      completed_min: 300,
      rest_options: [{ id: 'r0', auto_chosen: true, recovery_from_min: 150, to_min: null } as never],
    }))
    const kinds = m.events.map((e) => e.kind)
    expect(kinds).toContain('rest_begin')
    expect(kinds).not.toContain('rest_restart')
  })

  it('ignores rest options that never recovered (recovery_from_min null)', () => {
    const m = buildEventTimeline(result({
      completed_min: 300,
      rest_options: [{ id: 'r0', auto_chosen: true, recovery_from_min: null, to_min: null } as never],
    }))
    expect(m.events).toHaveLength(0)
  })
})
```

Note on the `rest_restart` expected value: at `to_min` = 180, the whole 30m nap (150→180) is parked-before, so `driving_elapsed = 180 − 30 = 150`, `arrive_in = 300 − 150 = 150`. **Correct the expected `arriveInMin` for the `rest_restart` row to `150`** (the `120` above is a deliberate seeded error to catch during Step 2 — replace it with `150` so the test encodes the driving-only rule). Verify this by hand before running.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/frontend && npx vitest run tests/merged_event_timeline.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/merged/eventTimeline'`. (After creating the module, the `rest_restart` row must read `150`; fix the fixture if you left the seeded `120`.)

- [ ] **Step 3: Write the implementation**

Create `app/frontend/src/lib/merged/eventTimeline.ts`:

```ts
/**
 * buildEventTimeline — derive the Combined screen's timing model from a merged
 * quickview projection. Display-only (no decision logic): it reshapes data the
 * backend already produced.
 *
 *   • routeDrivingMin — overall DRIVING-only route duration: total elapsed minus
 *     all parked rest dwell. Slow-driving through a jam still counts (it is time
 *     the car was moving); a parked nap does not.
 *   • events — the projected schedule (triggers + rest boundaries), ascending by
 *     wall-clock minute, with per-event driving-only "arrive in" remaining.
 *
 * The same projection feeds quickview AND animation (the coordinator preserves
 * `quickviewResult` across run creation and playback), so this one builder serves
 * both modes; the reached-marker is applied by the panel against the live tick.
 */
import type { MergedInstantResult } from '../../api/mergedClient'

export type MergedTimingEventKind = 'monotony_trigger' | 'safety_trigger' | 'rest_begin' | 'rest_restart'

export type MergedTimingEvent = {
  kind: MergedTimingEventKind
  whenMin: number
  arriveInMin: number | null
  reachTick: number | null
}

export type MergedTimingModel = {
  routeDrivingMin: number | null
  events: MergedTimingEvent[]
}

type RestWindow = { from: number; to: number | null }

/** Recovered rests only (recovery_from_min set) — the same predicate the panel
 * uses for clickable after-nap dots. */
function recoveredRests(result: MergedInstantResult): RestWindow[] {
  return (result.rest_options ?? [])
    .filter((o) => o.recovery_from_min != null)
    .map((o) => ({ from: o.recovery_from_min as number, to: o.to_min }))
}

/** Total parked dwell across all completed rest windows. */
function parkedTotal(rests: RestWindow[]): number {
  return rests.reduce((sum, r) => (r.to != null ? sum + Math.max(0, r.to - r.from) : sum), 0)
}

/** Parked minutes accumulated at-or-before wall-clock minute `w`. Partial rests
 * (w falls inside the window) count only the elapsed portion. */
function parkedBefore(rests: RestWindow[], w: number): number {
  return rests.reduce((sum, r) => {
    if (r.to == null) return sum
    return sum + Math.max(0, Math.min(r.to, w) - r.from)
  }, 0)
}

/** The tick whose projected minute is nearest `min`, or null when no progress. */
function nearestTick(result: MergedInstantResult, min: number): number | null {
  const progress = result.progress ?? []
  if (progress.length === 0) return null
  let best = progress[0]
  let bestDelta = Math.abs(progress[0].min - min)
  for (const p of progress) {
    const d = Math.abs(p.min - min)
    if (d < bestDelta) {
      best = p
      bestDelta = d
    }
  }
  return best.t
}

const KIND_ORDER: Record<MergedTimingEventKind, number> = {
  monotony_trigger: 0,
  safety_trigger: 0,
  rest_begin: 1,
  rest_restart: 2,
}

export function buildEventTimeline(
  result: MergedInstantResult | null | undefined,
  routeFactsDurationMin?: number | null,
): MergedTimingModel {
  if (result == null) return { routeDrivingMin: null, events: [] }

  const rests = recoveredRests(result)
  const parked = parkedTotal(rests)

  // Overall driving-only route duration, with an explicit fallback chain.
  let routeDrivingMin: number | null
  if (result.completed_min != null) {
    routeDrivingMin = result.completed_min - parked
  } else if ((result.progress ?? []).length > 0) {
    routeDrivingMin = result.progress[result.progress.length - 1].min - parked
  } else if (routeFactsDurationMin != null) {
    routeDrivingMin = routeFactsDurationMin
  } else {
    routeDrivingMin = null
  }

  const arriveIn = (w: number): number | null => {
    if (routeDrivingMin == null) return null
    const drivingElapsed = w - parkedBefore(rests, w)
    return Math.max(0, routeDrivingMin - drivingElapsed)
  }

  const events: MergedTimingEvent[] = []

  for (const f of result.fires ?? []) {
    events.push({
      kind: f.category === 'rest_required' ? 'safety_trigger' : 'monotony_trigger',
      whenMin: f.time_min,
      arriveInMin: arriveIn(f.time_min),
      reachTick: f.tick,
    })
  }

  for (const r of rests) {
    events.push({
      kind: 'rest_begin',
      whenMin: r.from,
      arriveInMin: null,
      reachTick: nearestTick(result, r.from),
    })
    if (r.to != null) {
      events.push({
        kind: 'rest_restart',
        whenMin: r.to,
        arriveInMin: arriveIn(r.to),
        reachTick: nearestTick(result, r.to),
      })
    }
  }

  events.sort((a, b) => a.whenMin - b.whenMin || KIND_ORDER[a.kind] - KIND_ORDER[b.kind])

  return { routeDrivingMin, events }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app/frontend && npx vitest run tests/merged_event_timeline.test.ts`
Expected: PASS (all cases; `rest_restart` arrive-in = 150).

- [ ] **Step 5: Commit**

```bash
git add app/frontend/src/lib/merged/eventTimeline.ts app/frontend/tests/merged_event_timeline.test.ts
git commit -m "feat(merged): add projection->timing-model builder (driving-only arrive-in)"
```

---

### Task 4: Wire the timing block into `MergedProposalPanel`

**Files:**
- Modify: `app/frontend/src/components/merged/MergedProposalPanel.tsx`
- Test: `app/frontend/tests/merged_proposal_time.test.tsx` (new)

**Interfaces:**
- Consumes: `formatDuration` (Task 2); `buildEventTimeline` + `MergedTimingModel`/`MergedTimingEvent` (Task 3); existing coordinator state `state.quickviewResult`, `state.latestTrigger`; `useRunStore()` for the route-facts fallback.
- Produces: DOM test hooks — `data-testid="merged-route-timing"` (block), `data-testid="merged-route-duration"` (overall value), `data-testid="merged-timing-event-<index>"` (each row, with `data-reached="true|false"`), `data-testid="merged-timing-no-triggers"` (zero-event line). No exported symbols.

- [ ] **Step 1: Write the failing test**

Create `app/frontend/tests/merged_proposal_time.test.tsx`. It reuses the `merged_quickview_ui.test.tsx` harness pattern (real coordinator, only `mergedClient` mocked) and drives both a pure quickview and a live tick.

```tsx
/**
 * merged_proposal_time.test.tsx — the timing block under the Proposal-category
 * strip (Combined screen). Verifies: overall driving route duration + per-event
 * when/arrive-in render from quickviewResult in pure quickview; the reached
 * marker reflects the live tick once an animation run advances; and a zero-fire
 * control case still shows the neutral route line (no false proposal category).
 */
import { render, screen, act } from '@testing-library/react'
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

describe('Combined-screen timing block', () => {
  beforeEach(() => vi.resetAllMocks())

  it('shows overall route duration and per-event arrive-in in pure quickview', async () => {
    vi.mocked(mergedQuickview).mockResolvedValue(firesFixture())
    const ref = renderCenter('en')
    await act(async () => { await ref.current!.quickview(QUICKVIEW_ARGS) })

    expect((await screen.findByTestId('merged-route-duration')).textContent).toContain('5h')
    const first = screen.getByTestId('merged-timing-event-0')
    expect(first.textContent).toContain('40m')       // when: 40 min
    expect(first.textContent).toContain('4h 20m')     // arrive in: 300 − 40 = 260
    // Pure quickview → nothing is marked reached.
    expect(first.getAttribute('data-reached')).toBe('false')
  })

  it('marks reached events once a live run advances past their tick', async () => {
    vi.mocked(mergedQuickview).mockResolvedValue(firesFixture())
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_t', trigger_run_id: 'run_t' })
    // A fired tick at tick_index 30 — past fire#0 (tick 20), before fire#1 (tick 80).
    const tick: MergedTickResponse = {
      trigger: {
        decision: null, error: null, paused: false, completed: false,
        tick_index: 30, route_fraction: 0.3, distance_km: null, speed_kph: 60,
        motion_state: 'MOVING', recovery_phase: null, is_traffic_jam: false, segment_type: 'highway',
      } as never,
      proposal: null,
      correlation: null,
    }
    vi.mocked(tickMergedRun).mockResolvedValue(tick)

    const ref = renderCenter('en')
    await act(async () => { await ref.current!.quickview(QUICKVIEW_ARGS) })
    await act(async () => {
      await ref.current!.create({
        trigger_plan_id: 'plan_1', world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1', run_seed: '7',
      })
    })
    await act(async () => { await ref.current!.step() })

    expect(screen.getByTestId('merged-timing-event-0').getAttribute('data-reached')).toBe('true')
    expect(screen.getByTestId('merged-timing-event-1').getAttribute('data-reached')).toBe('false')
  })

  it('shows the neutral route line for a zero-fire control case (no status strip)', async () => {
    vi.mocked(mergedQuickview).mockResolvedValue(controlFixture())
    const ref = renderCenter('en')
    await act(async () => { await ref.current!.quickview(QUICKVIEW_ARGS) })

    expect(screen.getByTestId('merged-route-duration').textContent).toContain('5h')
    expect(screen.getByTestId('merged-timing-no-triggers')).toBeInTheDocument()
    // The control case must NOT announce a proposal category.
    expect(screen.queryByTestId('merged-status-strip')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/frontend && npx vitest run tests/merged_proposal_time.test.tsx`
Expected: FAIL — `merged-route-duration` / `merged-timing-event-0` / `merged-timing-no-triggers` not found.

- [ ] **Step 3: Add imports and labels**

In `app/frontend/src/components/merged/MergedProposalPanel.tsx`, add to the import block (after the existing `useReviewStore` import, line ~25):

```tsx
import { useRunStore } from '../../state/runStore'
import { formatDuration } from '../../lib/formatDuration'
import { buildEventTimeline, type MergedTimingEvent } from '../../lib/merged/eventTimeline'
```

Add to the `LABELS` object (before its closing `}`, after `inspectedError`):

```tsx
  overallRoute: { ja: 'ルート全体（走行）', en: 'Overall route (driving)' },
  eventsHeading: { ja: 'イベント', en: 'Events' },
  arriveIn: { ja: '到着まで', en: 'arrive in' },
  evMonotony: { ja: 'モノトニートリガー', en: 'Monotony trigger' },
  evSafety: { ja: '安全トリガー', en: 'Safety trigger' },
  evRestBegin: { ja: '休憩開始', en: 'Rest begins' },
  evRestRestart: { ja: '休憩から再開', en: 'Restart from rest' },
  noTriggers: { ja: '予測されるトリガーはありません', en: 'No projected triggers' },
```

- [ ] **Step 4: Compute the timing model and build the block**

Inside the component, after the existing status-source derivation (after line ~230, `const motionState = ...`) and **before** the early-return at line ~243, add:

```tsx
  // ── Timing block (feature: combined-screen time display) ──────────────────
  // Display-only. Driven by the whole-chain projection, which the coordinator
  // preserves across run creation AND playback — so one source serves quickview
  // and animation. The live tick index (null in pure quickview) drives the
  // "reached" marker.
  const { state: runState } = useRunStore()
  const routeFactsDurationMin =
    runState.alternatives.find((a) => a.route_id === runState.selectedRouteId)?.route_facts
      .estimated_route_duration_min ?? null
  const timing = buildEventTimeline(state.quickviewResult, routeFactsDurationMin)
  const livePos = state.latestTrigger?.tick_index ?? null

  const eventLabel = (kind: MergedTimingEvent['kind']) =>
    kind === 'monotony_trigger' ? LABELS.evMonotony
    : kind === 'safety_trigger' ? LABELS.evSafety
    : kind === 'rest_begin' ? LABELS.evRestBegin
    : LABELS.evRestRestart

  const isReached = (ev: MergedTimingEvent) =>
    livePos != null && ev.reachTick != null && ev.reachTick <= livePos

  // Rendered only when a projection exists AND yields a route duration or events.
  const hasTiming = state.quickviewResult != null && (timing.routeDrivingMin != null || timing.events.length > 0)
  const timingBlock = hasTiming ? (
    <div data-testid="merged-route-timing" style={timingBlockStyle}>
      {timing.routeDrivingMin != null && (
        <div>
          <span style={statusLabelStyle}>{t(LABELS.overallRoute, lang)}:</span>{' '}
          <span data-testid="merged-route-duration" style={statusValueStyle}>
            {formatDuration(timing.routeDrivingMin, lang)}
          </span>
        </div>
      )}
      {timing.events.length > 0 ? (
        <div>
          <div style={statusLabelStyle}>{t(LABELS.eventsHeading, lang)}</div>
          {timing.events.map((ev, i) => (
            <div
              key={i}
              data-testid={`merged-timing-event-${i}`}
              data-reached={String(isReached(ev))}
              style={{ ...timingRowStyle, opacity: livePos != null && !isReached(ev) ? 0.45 : 1 }}
            >
              <span>{isReached(ev) ? '✓ ' : '• '}{t(eventLabel(ev.kind), lang)}</span>
              <span style={timingWhenStyle}>@ {formatDuration(ev.whenMin, lang)}</span>
              {ev.arriveInMin != null && (
                <span style={timingArriveStyle}>
                  {t(LABELS.arriveIn, lang)} {formatDuration(ev.arriveInMin, lang)}
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div data-testid="merged-timing-no-triggers" style={{ color: '#94a3b8', fontStyle: 'italic' }}>
          {t(LABELS.noTriggers, lang)}
        </div>
      )}
    </div>
  ) : null
```

- [ ] **Step 5: Restructure the early return and render the block**

Replace the early return (line ~243):

```tsx
  if (!overlay.hasService && inspectedProposalError == null) return null
```

with (control case still shows the neutral timing block, never the status strip):

```tsx
  if (!overlay.hasService && inspectedProposalError == null) {
    if (timingBlock == null) return null
    return (
      <div data-testid="merged-proposal-panel" style={panelStyle}>
        {timingBlock}
      </div>
    )
  }
```

Then, in the normal return's JSX, insert `{timingBlock}` immediately **after** the `merged-status-strip` closing `</div>` (after line ~265, before the inspected-error `role="alert"` block):

```tsx
      </div>

      {timingBlock}

      {/* The "Inspecting a quickview fire" badge was removed ... */}
```

- [ ] **Step 6: Add the timing-block styles**

At the bottom of the file with the other `const ...Style` definitions, add:

```tsx
const timingBlockStyle: React.CSSProperties = {
  flexShrink: 0,
  fontSize: '0.78em',
  color: '#334155',
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  padding: '6px 10px',
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
}
const timingRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '4px 10px',
  alignItems: 'baseline',
}
const timingWhenStyle: React.CSSProperties = { color: '#1d4ed8', fontWeight: 600 }
const timingArriveStyle: React.CSSProperties = { color: '#64748b' }
```

- [ ] **Step 7: Run the panel tests to verify they pass**

Run: `cd app/frontend && npx vitest run tests/merged_proposal_time.test.tsx`
Expected: PASS (all 3 cases).

- [ ] **Step 8: Run the full merged suite for regressions**

Run: `cd app/frontend && npx vitest run tests/merged_center.test.tsx tests/merged_quickview_ui.test.tsx tests/merged_review_layout.test.tsx tests/merged_rest_journey.test.tsx`
Expected: PASS. In particular `merged_center.test.tsx`'s "renders nothing" test (no run, no quickview → `quickviewResult` null → `timingBlock` null → panel returns null) must still pass.

- [ ] **Step 9: Commit**

```bash
git add app/frontend/src/components/merged/MergedProposalPanel.tsx app/frontend/tests/merged_proposal_time.test.tsx
git commit -m "feat(merged): show route + per-event timing under the proposal category"
```

---

### Task 5: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole frontend suite**

Run: `cd app/frontend && npm test`
Expected: PASS across the suite. If any failure is unrelated to these changes (pre-existing), note it; do not mark this task complete while a failure traceable to Tasks 1–4 remains.

- [ ] **Step 2: Type-check / build**

Run: `cd app/frontend && npm run build`
Expected: no TypeScript errors. (Catches any type mismatch in the new imports or the `MergedInstantResult` field access.)

- [ ] **Step 3: Commit any fixups**

Only if Steps 1–2 required changes:

```bash
git add -A
git commit -m "fix(merged): resolve type/test fixups for timing display"
```

---

## Self-Review

**1. Spec coverage:**
- Change #1 (remove preset ETA) → Task 1. ✔
- Change #2 overall route driving duration → Task 3 `routeDrivingMin` (parked excluded, jam driving kept) + Task 4 `merged-route-duration`. ✔
- Per-event *when* (wall-clock) → Task 3 `whenMin` + Task 4 `@` display. ✔
- Per-event *arrive-in* driving-only remaining (nap doesn't shrink) → Task 3 `arriveIn`/`parkedBefore` + tests (`rest_restart` = 150). ✔
- Event taxonomy (monotony/safety triggers, rest begin/restart) → Task 3 `MergedTimingEventKind` + labels in Task 4. ✔
- Projected + reached marker, quickview and animation from one source → Task 4 `livePos`/`isReached` + reached-marker test. ✔
- Control-case placement (neutral block above the null-guard, no false category) → Task 4 Step 5 + control-case test. ✔
- Hours+minutes format (both languages, zero-part dropping) → Task 2. ✔
- Fallback when `completed_min` null → Task 3 progress→route-facts chain + tests. ✔
- htmlapp mirror deferred, parity fixtures skipped → Global Constraints (separate later step, not in this plan). ✔

**2. Placeholder scan:** No TBD/TODO/"add error handling"/"similar to Task N". Every code step has complete code. The one intentional discrepancy (seeded `120` vs correct `150` in the Task 3 test) is called out explicitly with the fix. ✔

**3. Type consistency:**
- `formatDuration(min, lang)` signature identical in Task 2 (def) and Task 4 (use). ✔
- `buildEventTimeline(result, routeFactsDurationMin?)` and the four exported types identical in Task 3 (def) and Task 4 (import: `buildEventTimeline`, `MergedTimingEvent`). ✔
- `MergedTimingEvent` fields (`kind`, `whenMin`, `arriveInMin`, `reachTick`) used consistently in the panel (`ev.kind`, `ev.whenMin`, `ev.arriveInMin`, `ev.reachTick`). ✔
- Coordinator/runStore field names verified against source: `state.quickviewResult`, `state.latestTrigger.tick_index`, `runState.alternatives`, `runState.selectedRouteId`, `route_facts.estimated_route_duration_min`, `RoutePresetSummary.duration_min`, `PreviewRestOption.recovery_from_min`/`.to_min`, `FirePoint.category`/`.tick`/`.time_min`, `ProgressPoint.t`/`.min`. ✔
- Test hooks (`merged-route-timing`, `merged-route-duration`, `merged-timing-event-<i>`, `data-reached`, `merged-timing-no-triggers`) defined in Task 4 Step 4/5 and asserted in Task 4 Step 1. ✔

No gaps found.
