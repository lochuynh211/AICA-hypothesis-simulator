# Combined-screen time display — design

**Date:** 2026-08-05
**Branch of work:** fixbug-0804 (frontend/backend first, then htmlapp mirror)
**Scope:** Combined ("Merged") simulator screen — two frontend-only UI changes. No backend change.

## Problem

Two adjustments to the Combined screen, requested from owner review:

1. **Route-preset ETA is misleading.** The Google-Maps route-preset dropdown (left / setup panel) shows an estimated duration (`約180分` / `~180 min`) that is *not* what a real run computes. It is a raw preset figure with no bearing on the simulated drive, so it reads as authoritative when it is not. Remove it.

2. **The Proposal area shows no timing.** Under the "Proposal category" (提案分類) status strip in the centre panel, a reviewer cannot see *when* the projected events happen, how long the drive is, or how much driving remains at each event. Add a compact timing block that answers all three, working identically in quickview and animation.

Both changes are UI-only. The backend remains the source of truth; the frontend already holds every value these displays need.

## Non-goals

- No new backend endpoint, model field, or computation. Everything is derived from data the frontend already has (`quickviewResult`, `latestTrigger`, `route_facts`).
- No change to what fires or when — only to how existing projection data is displayed.
- No change to the map overlay's per-spot ETA (a separate element; not in scope).
- Parity-fixture regeneration is deferred (per the working agreement for this branch).

## Data facts (verified against the code)

All types below are in `app/frontend/src/api/` and mirrored byte-identically in `htmlapp/frontend/src/`.

- **`FirePoint`** (`api/types.ts`): `category: string | null` (`rest_required` → safety trigger; a `monotony…` category → monotony trigger), `tick: number`, `time_min: number` (wall-clock elapsed minutes at the fire).
- **`PreviewRestOption`** (`api/types.ts`): `recovery_from_min: number | null`, `to_min: number | null` — the parked recovery window in wall-clock minutes. An option is a *real* recovered rest only when `recovery_from_min != null` (same predicate the panel already uses for clickable after-nap dots).
- **`MergedInstantResult`** (`api/mergedClient.ts` / `engine/merged/types.ts`): `fires: MergedFirePoint[]`, `rest_options: MergedRestOption[]`, `completed_min: number | null` (total elapsed **including** parked rests), `progress: ProgressPoint[]` where `ProgressPoint = {t, min, frac}` and `frac` (route fraction 0–1) is flat across a parked rest.
- **Live position**: `state.latestTrigger.tick_index` — the most-recent ticked position during an animation run; `null` in pure quickview (no run started). `TraceEntry.tick_index` is the same axis if a per-tick source is preferred.
- **Persistence across modes**: `mergedCoordinatorReducer` copies `quickviewResult` forward across `CREATED` and `SET_RUNNING`; only `RESET` clears it. So the projected schedule is available identically in quickview *and* animation from one source — no re-fetch, no backend call.
- **`RouteFacts.estimated_route_duration_min`** (`api/types.ts`): raw driving-only route duration, in scope via `useRunStore()`. Used only as a fallback.

## Change #1 — Remove the route-preset ETA

**Site:** `app/frontend/src/components/merged/MergedSetupPanel.tsx`, the route-preset `<option>` (~line 1194).

Current:

```tsx
{t(p.label, lang)} {lang === 'ja'
  ? `（${p.distance_km} km、約${p.duration_min}分）`
  : `(${p.distance_km} km, ~${p.duration_min} min)`}
```

Change: drop the duration fragment only, keep distance:

```tsx
{t(p.label, lang)} {lang === 'ja'
  ? `（${p.distance_km} km）`
  : `(${p.distance_km} km)`}
```

`RoutePresetSummary.duration_min` stays on the type and in the payload — it still feeds the real route model. We simply stop *rendering* the unvalidated preset estimate. Single-site edit.

## Change #2 — Timing block under "Proposal category"

**Site:** `app/frontend/src/components/merged/MergedProposalPanel.tsx`, rendered directly under the existing `merged-status-strip` (~line 265), **above** the `if (!overlay.hasService && …) return null` early return (see placement below).

### What it renders

```
Overall route (driving): 5h 0m
Events
  ● Monotony trigger    @ 2h 0m   → arrive in 3h 0m
  ● Safety trigger      @ 2h 30m  → arrive in 2h 30m
  ● Rest (nap) begins   @ 2h 30m
  ● Restart from rest   @ 3h 0m   → arrive in 2h 30m
```

- **Overall route (driving)** shown once at top.
- **Events** listed chronologically by wall-clock minute. Each shows **when** it happens (`@`) and, where meaningful, **arrive in** (driving-only remaining).
- Rest events: "Rest (nap) begins" carries a `@` only (no remaining). "Restart from rest" carries both.

### Time model

Three quantities, all derived from `quickviewResult`:

- **`D` = overall route driving duration**
  `D = completed_min − Σ(to_min − recovery_from_min)` over recovered rest options (total elapsed minus all parked dwell → driving-only; **includes** slow-driving through jams, **excludes** parked naps).
  Fallbacks, in order, when `completed_min` is null: last `progress[].min − Σ parked`, then `route_facts.estimated_route_duration_min`.

- **When (`@`)** = **wall-clock elapsed** from start.
  - Fire event: its `time_min`.
  - "Rest begins": `recovery_from_min`. "Restart from rest": `to_min`.

- **Arrive in** = **driving-only remaining** = `D − driving_elapsed(event)`, where
  `driving_elapsed(w) = w − parked_before(w)` and `parked_before(w) = Σ over rests fully completed at-or-before w of (min(to_min, w) − recovery_from_min)`.
  A nap therefore does **not** shrink remaining drive: an event at wall-clock 2h30m that sits just after a 30m nap has `driving_elapsed = 2h30m − 30m = 2h0m`, so `arrive in = D − 2h0m`. This is the owner's "just running time" rule.

  Confirmed decision: this differs from the initial mock's numbers (which subtracted from wall-clock total); the driving-only rule is authoritative.

### Event taxonomy

Built by merging two sources into one chronological list keyed by wall-clock minute:

- From `fires[]`: one event per fire. Category → label:
  - `rest_required` → **Safety trigger** (安全トリガー)
  - anything else (monotony family) → **Monotony trigger** (モノトニートリガー)
- From `rest_options[]` filtered to `recovery_from_min != null` (real recovered rests): two events per rest — **Rest (nap) begins** at `recovery_from_min`, **Restart from rest** at `to_min`.

Sort ascending by `@` minute; ties keep fire-before-rest ordering (a trigger fires, then the rest it produced begins).

Each event carries its own reach-marker key: a fire uses its `tick`; a rest boundary uses the tick nearest its minute via `progress[]` (or the minute directly, compared against the live run's elapsed minute). Fire `tick` compared against live `tick_index` is exact and preferred.

### Reached-marker (animation only)

- If `latestTrigger?.tick_index != null` (a run is live/complete): an event is **reached** when its position ≤ the live tick position. Reached → solid dot + ✓; not-yet-reached → dimmed (reduced opacity), no ✓.
- If `latestTrigger == null` (pure quickview): nothing is marked — every event renders in the neutral projected style. Same block, both modes ("Projected + reached marker").

### Placement / control-case behaviour

The panel currently returns `null` for designed-not-to-fire control cases, so it never announces a false proposal category. The timing block is driven by `quickviewResult` (which always projects the whole route, even with zero fires) and route duration is a neutral fact, not a proposal-category claim.

Decision (confirmed): render the timing block **above** the early return, so it shows for control cases too. A zero-fire control case shows:

```
Overall route (driving): 5h 0m
(no projected triggers)
```

The status strip's early-return guard is unchanged — the strip still only renders a proposal category when a proposal carried one. Only the neutral timing block is lifted above the guard.

Guard the block's own render on `quickviewResult != null` so it contributes nothing before any projection exists.

### Plumbing

- **New helper `formatDuration(min, lang)`** → `"5h 20m"` / `"5時間20分"`. Rules: round to whole minutes; drop a leading `0h` (`"20m"` / `"20分"`); drop a trailing `0m` (`"5h"` / `"5時間"`); `0` → `"0m"` / `"0分"`. Negative/NaN guards to `"—"`. New module (e.g. `lib/formatDuration.ts`) with unit tests; reusable elsewhere.
- **Event assembly**: a small pure function `buildEventTimeline(quickviewResult, routeFacts)` → `{ routeDrivingMin, events: EventRow[] }`, unit-testable independent of React. `EventRow = { kind, labelKey, whenMin, arriveInMin?, reachKey }`.
- **Labels** added to the panel's `LABELS` table (JA/EN): overall-route, events-heading, arrive-in, the four event names, no-triggers. Existing shared `reviewVocabulary` is not extended — these are panel-local display strings.

## Components & boundaries

- `formatDuration` — pure, no deps, own tests. One job: minutes → localized "Xh Ym".
- `buildEventTimeline` — pure, depends only on the projection types. One job: projection → ordered event rows + route duration. Testable without a DOM.
- `MergedProposalPanel` — consumes both; owns layout, the reached-marker comparison against `latestTrigger`, and placement relative to the early return. No new state, no new store.

This keeps the arithmetic (the part most likely to be wrong or to change) out of the component and under test.

## Error handling / edge cases

- `quickviewResult == null` → timing block renders nothing (guarded).
- Zero fires, zero rests → "Overall route (driving): D" + "(no projected triggers)".
- `completed_min == null` → duration fallback chain (progress, then route_facts); if all null, omit the overall-route line rather than show a wrong number.
- Rest option with `recovery_from_min != null` but `to_min == null` (never-completed tail) → show "Rest begins", omit "Restart"/its remaining.
- `arrive in` computed as `max(0, D − driving_elapsed)` so rounding never yields a negative.
- Algorithm-error projection (`quickviewResult.error` set / `fires == []`): the timing block shows overall route + "(no projected triggers)"; the existing error rendering path is untouched.

## Testing

- **`formatDuration`**: unit tests for `0`, `<60`, exact hours, `h+m`, rounding, negative/NaN, both languages.
- **`buildEventTimeline`**: unit tests over crafted `MergedInstantResult` fixtures —
  - monotony-then-safety-then-rest ordering and `@` values;
  - `D` excludes parked dwell but includes jam slow-driving (a fixture with a jam segment and a rest);
  - `arrive in` uses driving-only remaining (nap does not shrink it — the worked 2h30m/2h0m case);
  - `completed_min == null` fallback path;
  - zero-fire control case;
  - `to_min == null` tail.
- **Panel render** (existing merged-panel test harness): timing block appears under the status strip in quickview; reached-marker reflects `latestTrigger.tick_index` in animation; control-case shows overall-route + no-triggers and still returns the (otherwise-empty) panel rather than `null`.

## Rollout

1. Implement in `app/frontend` (this branch), with tests. Owner reviews.
2. After approval, mirror byte-identically to `htmlapp/frontend` (same files exist there). **Skip parity-fixture regeneration** per the branch agreement; skip any fixture tests that fail for that reason.

Both features are frontend-only and the target files are byte-identical between `app/frontend` and `htmlapp/frontend`, so the mirror is a near-copy.
