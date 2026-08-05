# Combined-screen timing line redesign — design

**Date:** 2026-08-05
**Branch:** refine-preset-testcase
**Status:** approved (autonomous execution authorised by owner)
**Supersedes:** the inline per-event timing list shipped at `2353ea8`
(`feat(merged): show route + per-event timing under the proposal category`).

## Problem

The shipped timing block prints the **entire** projected event list inline
under the 提案分類 (Proposal category) strip, with a reached-marker that
animates. On review the owner rejected that: the inline list is noise, and it
is not *connected* to the one proposal the panel is currently describing. When
a reviewer clicks a trigger point on the map, the status strip already switches
to that trigger's proposal category — but the timing block does not follow.

## What the owner asked for

1. Do **not** list all events inline. Show the timing that belongs to the
   **currently-inspected proposal** — the same trigger the 提案分類 strip is
   describing — on a single line, and have it change on map-click and during
   animation exactly as the strip does.
2. The overall driving-only route duration and that active trigger's timing
   sit together, directly under the 提案分類 strip.
3. Move the full event list into a **popup** opened by a button beside the
   line. The popup is **quickview-only** — no reached-marker, no animation.
4. Sub-line 2 must **not** repeat the trigger category (it is already on the
   提案分類 strip); it is a neutral "trigger @ …" line.
5. Vocabulary must be coherent with the rest of the screen. The popup's
   per-trigger rows use the specification's own 提案分類 wording —
   `漫然運転予防のためサービス提案` and `危険運転防止のため休憩推奨` — not
   invented words like「モノトニートリガー」/「安全トリガー」.

## Design

### Layout (replaces the inline list under `merged-status-strip`)

```
提案分類: 危険運転防止のため休憩推奨    車両状態: 休憩地点へ移動中 · 走行 走行中
────────────────────────────────────────────────────────────
ルート全体（走行）: 5時間0分                        [ すべてのイベント ]
➤ 発火  @ 2時間30分  ·  到着まで 2時間30分
```

- **Sub-line 1 (always, when a projection exists):** overall driving-only
  route duration on the left (`formatDuration(model.routeDrivingMin)`), and a
  **すべてのイベント / View all events** button on the right. The button is
  shown only when `model.events.length > 0`.
- **Sub-line 2 (only when an active trigger resolves):** a neutral firing
  marker — the screen's own word **発火** (JA) / **Trigger** (EN), NOT the
  category — followed by `@ <when>` and, when known, `· 到着まで <arrive-in>`.
  The category is deliberately omitted; the 提案分類 strip above already
  carries it, and repeating it is what the owner rejected.

### The active trigger (`selectActiveEvent`)

A new pure helper in `eventTimeline.ts` selects the single `MergedTimingEvent`
sub-line 2 shows, priority-ordered to mirror how the status strip's
`statusSource` is chosen — so line 2 always agrees with the strip:

```
selectActiveEvent(model, { fireTick, livePos }):
  1. fireTick != null      → the trigger event with reachTick === fireTick
                             (covers an explicit map-marker click AND the
                              default-first-fire quickview view — both set
                              inspectedFire)
  2. livePos != null       → the most-recently-reached trigger event
                             (greatest reachTick ≤ livePos); none reached → null
  3. otherwise             → null
```

Only **trigger** events (`monotony_trigger` / `safety_trigger`) are eligible —
sub-line 2 is a firing line (発火), so a rest boundary is never shown there.
Rest boundaries appear only in the popup.

Rationale for each branch:

- **Branch 1 tracks clicks and the default.** Clicking a trigger marker sets
  `inspectedFireIndex` (`INSPECT_FIRE`, toggles off on re-click) — the same
  inspection state that drives `statusSource`. In pure quickview with nothing
  clicked, `defaultsToFirstFire` makes `inspectedFire` point at fire #0, which
  is exactly what the strip shows by default, so sub-line 2 matches it.
- **Branch 2 makes the line advance during animation.** In a live run
  `inspectedFire` is null (no default while a run exists) and `livePos =
  latestTrigger.tick_index` is set; the line shows the latest trigger the run
  has passed. Before the first trigger is reached, no trigger qualifies, so
  sub-line 2 is absent — the owner's "nothing yet" choice.
- **When a rest is inspected** (inert on this screen today), `inspectedFire` is
  null and — because `inspectedRestOptionIndex` is set — `defaultsToFirstFire`
  is false, so `fireTick` is null and (outside a live run) sub-line 2 is
  simply absent. No rest boundary is mislabelled as 発火.

### The popup (`EventsListModal`)

A new component wrapping the shared `Modal` (`components/merged/Modal.tsx` —
portal, dimmed backdrop, ESC, focus-trap; the same primitive
`FeedbackSummaryModal` uses). It lists **all** `model.events` in order, each
row:

```
<category / boundary label>   @ <when>   · 到着まで <arrive-in>   (arrive-in omitted when null)
```

- **Quickview-only:** no reached-marker, no ✓/•, no dimming, no dependence on
  `livePos`. Pure projection.
- **Vocabulary (owner requirement 5):** trigger rows use the canonical
  proposal-category wording from `reviewVocabulary.ts`, resolved through
  `purposeLabel`:
  - `monotony_trigger` → `purposeLabel('inattentive_driving_prevention_recovery')`
    → `漫然運転予防のためサービス提案`
  - `safety_trigger` → `purposeLabel('rest_recommended')`
    → `危険運転防止のため休憩推奨`
  - `rest_begin` → 休憩開始 / Rest begins; `rest_restart` → 休憩から再開 /
    Restart from rest (the panel's existing `evRestBegin` / `evRestRestart`
    labels — already screen-coherent).

  Using `purposeLabel` (not a fresh literal) keeps the single source of truth:
  the popup, the 提案分類 strip, and the map overlay all read the same table.

### Control case (scenario designed NOT to fire)

Sub-line 1 route duration **only** — no button, no sub-line 2, no "no
triggers" text. Rendered above the status-strip early return exactly as today,
so a designed-to-not-fire scenario never announces a false proposal category.

### Out of scope / unchanged

- `buildEventTimeline` and `formatDuration` are unchanged (their tests stay
  green). The redesign only adds `selectActiveEvent` and changes how the panel
  *displays* the model.
- No backend change.
- **htmlapp mirror is a separate later step**, gated on the owner reviewing the
  `app/frontend` result. When mirrored: skip parity-fixture regeneration and
  skip fixture tests that fail only for that reason.
- BYO-key Google Maps invariant untouched — this feature reads no key.

## Files

| File | Change |
|---|---|
| `app/frontend/src/lib/merged/eventTimeline.ts` | add `selectActiveEvent` (pure) |
| `app/frontend/src/components/merged/EventsListModal.tsx` | **new** — quickview-only event list in a `Modal` |
| `app/frontend/src/components/merged/MergedProposalPanel.tsx` | replace inline list with sub-line 1 (route + button) + sub-line 2 (active trigger) + modal state; drop reached-marker rendering |
| `app/frontend/tests/merged_event_timeline.test.ts` | add `selectActiveEvent` cases |
| `app/frontend/tests/merged_proposal_time.test.tsx` | rewrite for the two-sub-lines + popup design |

## Test hooks (DOM contract)

- `merged-route-timing` — the block (unchanged id)
- `merged-route-duration` — overall driving duration value (unchanged id)
- `merged-view-events-button` — the popup-opener (shown only when events exist)
- `merged-active-event` — sub-line 2 (present only when an active trigger resolves)
- `events-list-modal` — the popup body
- `events-list-row-<i>` — each event row in the popup

The old `merged-timing-event-<i>`, `data-reached`, and `merged-timing-no-triggers`
hooks are **removed** (the inline animated list they belonged to is gone).

## Success criteria

1. Pure quickview, nothing clicked → sub-line 1 shows route duration + button;
   sub-line 2 shows the first fire's 発火 @ when · 到着まで remaining.
2. Clicking a different trigger marker → sub-line 2 switches to that trigger's
   when/arrive-in (matches the 提案分類 strip); clicking it again clears both.
3. Live run before the first trigger → sub-line 1 only, no sub-line 2; after
   playback passes a trigger → sub-line 2 shows the latest passed trigger.
4. Popup lists every event with category vocabulary, no reached-marker.
5. Control (zero-fire) case → route line only, no button, no sub-line 2, no
   status strip.
6. `npm test` green (pre-existing Node-26 localStorage failures excepted) and
   `npm run build` clean.
