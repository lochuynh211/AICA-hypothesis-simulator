# Review-screen live timeline — design

**Date:** 2026-07-04
**Branch:** 009-signal-tier-redesign
**Scope:** `app/frontend/` only. The `htmlapp/` mirror is deferred for feature 009 and is intentionally left untouched.

## Problem

The Review (playback) screen's center column currently shows, top to bottom:
`PlaybackControls` + `MotionBadge` → `RouteTimeline` (a plain animated progress bar) → `StateCards` (in-car status + driving environment) → the cockpit/map surface.

`StateCards` carries little value: the "driving environment" card is an empty title, and the "in-car status" card is a pair of drowsiness/fatigue band bars. The reviewer's most information-dense view — the rich SVG timeline on the **Setup** screen's Instant Result strip (`InstantResultStrip` → `InstantResultTimeline`), showing score curves, road bands, thresholds, anomaly spikes, and fire/rest markers — is absent from the Review screen, where a run is actually watched tick by tick.

## Goal

Replace `StateCards` on the Review screen with a richer progress timeline that looks like the Setup screen's Instant Result timeline, but **animates in real time as the run ticks** (progressive reveal), reclaiming the vertical space the removed cards free up.

## Decisions (from brainstorming)

1. **Animation model: progressive reveal.** The algorithm's *decisions* (score curve, monotony curve, anomaly spikes, fire lines, rest dots) draw in left-to-right as each tick arrives; nothing about a future decision is shown until the run reaches it. The playhead (🚗) rides the leading edge.
2. **Future track: faint ghost of the full route.** Because route geometry is known upfront (`useRouteProgress` already fetches the scenario's segments), the **road-band layout** is drawn full-width but dimmed/desaturated ahead of the playhead, saturating to full color as the car reaches each band. This is the one thing shown ahead of time; it is route geometry, not an algorithm decision.
3. **`StateCards` fully removed.** No drowsiness/fatigue readout is retained on the Review screen — the score curve becomes the sole "driver load" signal, per the request. (`features.drowsiness_level` / `fatigue_level` remain available in `latestDecision` should we ever want to reinstate a slim readout.)
4. **Architecture: one shared timeline component, driven two ways** (Approach A). Keeps the Review timeline literally identical to the Setup preview rather than a look-alike that drifts.

## Data feasibility (no backend changes)

Every live run appends a `TICK_APPENDED` action to `state.trace` (`TraceEntry[]`). Each entry already carries everything the timeline needs:

| Timeline element        | Source (per `TraceEntry`)                                            |
|-------------------------|----------------------------------------------------------------------|
| rest-propose curve      | `entry.score` (0–1 for hybrid; raw points for NRI)                    |
| monotony curve (hybrid) | monotony `candidate.score` in `entry.candidates` / `entry.scores`     |
| thresholds              | `entry.criteria` / `effectiveSetup` (per-run constants)              |
| road bands              | full layout from `useRouteProgress().segments` (known upfront); live class per tick from `entry.segment_type` / `is_traffic_jam` |
| fire lines              | `entry.fire_control.fired` + `entry.proposal_paused`, per category   |
| rest dots               | `state.restHistory` (accepted rests)                                 |
| playhead position       | `entry.route_fraction` (authoritative) via `useRouteProgress`        |
| anomaly spikes          | **best-effort** — shown only if the per-tick decision exposes an anomaly indicator (`scores`/`states`); omitted otherwise. Not a blocker. |

y-axis scaling follows `InstantResultTimeline`'s existing rule (fit both curves + both thresholds per result; never hardcode 0–1), so hybrid (0–1) and NRI (raw points) both render correctly.

## Components

### 1. `components/playback/ScoreTimeline.tsx` — new, presentational (no store access)

Pure SVG renderer, extracted from the drawing internals of `InstantResultTimeline`. Props (normalized `TimelineData`):

```
segments:          { fromFrac, toFrac, type }[]      // 0–1 fractions, full route
restScore:         { x: number (0–1), y: number }[]  // rest-propose curve points
monotonyScore:     { x, y }[]                         // empty for NRI
restThreshold:     number | null
monotonyThreshold: number | null
spikes:            number[]                           // x positions (0–1), may be empty
fires:             { x: number, kind: 'rest' | 'monotony' }[]
restDots:          number[]                           // x positions (0–1)
completionX:       number | null
revealFraction:    number                             // 0–1; clip decisions to the left of this
ghostAhead:        boolean                            // dim road bands right of revealFraction
animated:          boolean                            // smooth width/playhead transitions
showPlayhead:      boolean                            // 🚗 marker on the leading edge
```

Rendering rules:
- A neutral grey full-width track behind everything (route length always visible).
- Road bands drawn full width; those (or the portions) right of `revealFraction` rendered at reduced opacity/desaturation when `ghostAhead` (Decision 2).
- Score curves / spikes / fire lines / rest dots clipped to `x ≤ revealFraction` (progressive reveal). A `<clipPath>` at `revealFraction * W` is the mechanism.
- Playhead 🚗 at `revealFraction` when `showPlayhead`; position smoothed by the caller via `useSmoothFraction`, exact `aria-label` reporting the true fraction (matches evidence log — preserves the existing `car-marker` contract).
- Legend identical to today's, built from the road types actually present.
- `data-testid`s preserved so existing tests keep asserting against them:
  `progress-fill` (or an equivalent covered by the reveal), `car-marker`, `fire-marker`,
  `progress-rest-spot-marker`, plus the Instant Result strip's ids where that path renders it.

### 2. `InstantResultStrip` — refactor to consume `ScoreTimeline`

`InstantResultTimeline` maps its `InstantResult` (whole-run headless shape) → normalized `TimelineData` and renders `<ScoreTimeline revealFraction={1} ghostAhead={false} animated={false} showPlayhead={false} />`. Visual output must be byte-identical to today; a red `instant_result_strip.test.tsx` is a regression to fix, never to delete. The `InstantResult`→`TimelineData` mapping lives in a small pure helper (`instantResultToTimeline`) so it is unit-testable.

### 3. `RouteTimeline` — becomes live/replay-driven

A new adapter hook `useLiveTimelineData(replayTick?)` builds `TimelineData` from:
- **live:** `state.trace` accumulated so far + `useRouteProgress` (segments, currentFraction) + `state.restHistory`.
- **replay:** the replay log up to `replayTick` (reveal to `replayTick.route_fraction` / `tick_index`).

`RouteTimeline` renders `<ScoreTimeline animated ghostAhead showPlayhead revealFraction={currentFraction} … />`. All current `data-testid`s (`route-timeline`, `progress-fill`, `car-marker`, `fire-marker`, `progress-rest-spot-marker`) are preserved so playback + replay tests keep passing. The existing `useSmoothFraction` easing of the playhead is retained.

### 4. `CenterPlaybackPanel` — remove `StateCards`

Delete the `<StateCards />` render and its import; update the top-of-file doc comment (drop the "StateCards — in-car status + driving environment" line). Delete `components/playback/StateCards.tsx` and its test file. The taller `RouteTimeline` takes the freed height (give the timeline a slightly larger fixed height than the setup strip's `H_FIXED = 92`, since it now stands in for the removed cards).

## Data flow

```
                 state.trace (live)  ─┐
                 replay log (replay) ─┼─► useLiveTimelineData ─► TimelineData ─► <ScoreTimeline animated reveal=frac>
useRouteProgress (segments, frac) ────┘                                              ▲ (Review screen)
state.restHistory ────────────────────┘                                              │ shared component
                                                                                     │
InstantResult (headless) ─► instantResultToTimeline ─► TimelineData ─► <ScoreTimeline reveal=1 static>
                                                                                     (Setup strip)
```

## Error / edge handling

- **No run yet / empty trace:** `ScoreTimeline` with empty curves renders the grey track + ghosted road bands only (no playhead past 0). Matches the "select a package…" empty state spirit.
- **Algorithm-error tick:** the run pauses; the timeline shows the curve up to the last good tick — never a fabricated fire beyond it (reveal clip enforces this).
- **NRI (no monotony curve):** `monotonyScore` empty, `monotonyThreshold` null — single curve, exactly as the strip already handles it.
- **Missing `route_fraction`:** fall back through `useRouteProgress.fractionAtTick` (already implemented).
- **Missing anomaly data:** spikes array empty → no carets. No error.

## Testing (TDD — write tests first)

1. `instantResultToTimeline` — maps a fixture `InstantResult` to expected `TimelineData` (curves, thresholds, fires, rest dots, spikes).
2. `useLiveTimelineData` — from a synthetic `state.trace` of N ticks, produces a curve of N points, `revealFraction` = latest `route_fraction`, fires at fired ticks, rest dots from `restHistory`; replay variant reveals to `replayTick`.
3. `ScoreTimeline` render — at `revealFraction` 0 / 0.5 / 1: decisions clipped correctly; `ghostAhead` dims road bands right of the reveal; playhead present only when `showPlayhead`.
4. Contract — `RouteTimeline` still exposes `route-timeline`, `progress-fill`, `car-marker`, `fire-marker`, `progress-rest-spot-marker`; `car-marker` `aria-label` still reports the exact fraction.
5. `CenterPlaybackPanel` — `state-cards` testid absent; `route-timeline` present.
6. Regression — full `instant_result_strip.test.tsx` and playback/replay suites stay green.

## Out of scope

- Any `htmlapp/` change (deferred for feature 009).
- Backend changes (none required).
- Reinstating a drowsiness/fatigue readout (explicitly removed).
- New anomaly-spike plumbing if the live decision doesn't already expose it (best-effort only).
