# Combined-screen recompute gating + busy overlay

**Date:** 2026-08-07
**Branch:** fixbug-0806
**Scope:** `app/frontend` only (the htmlapp mirror is a follow-up, after owner review).

## Problem

On the Combined Simulator screen (`MergedShell`), every setup edit re-runs the
whole-chain projection ("recompute" = `coordinator.quickview()`), which redraws
the center map/timeline and the right review column.

`MergedSetupPanel.tsx:1044` runs a **debounced (500 ms) auto-quickview effect
on every store change**. Each popup field (`BasicSituationView`,
`BasicTriggerView`, `BasicServiceView`, `BasicContentView`, the detailed
sections) and each left-panel dropdown (route/scenario/profile/trigger/service/
content/explanation) writes to the scoped `runStore`/`proposalStore` on every
`onChange`, which re-arms this effect.

`coordinator.quickview()` (`mergedCoordinator.tsx:572`) has **no in-flight
guard** (unlike `selectService`, which has `choosingRef`). When a reviewer
changes field A, then changes field B before A's projection returns, two
`quickview` POSTs are in flight; whichever response arrives *last* wins via
`QUICKVIEW_LOADED`, regardless of which edit was made last. That is the
"collision" the owner reported.

There is also a companion effect at `MergedSetupPanel.tsx:1121` that resets a
**live run** whenever a `setupSignature` changes — same trigger cascade.

## Decisions (from brainstorming)

1. **Apply live, gate only the recompute.** Fields keep writing to the store on
   each keystroke, so map jam/mountain overlays and the "differs-from-case"
   note stay accurate as the reviewer types. Only the `quickview` recompute (and
   the live-run reset) is deferred.
2. **Close = apply. No Confirm button.** Closing a popup by any path (× button,
   Escape, backdrop click) is itself the "apply" action: it fires exactly one
   recompute against the final edited values. There is **no** separate Confirm
   button — the owner explicitly chose this once "close keeps edits" was agreed.
3. **Busy overlay covers the whole `.merged-shell`.** While a recompute is in
   flight, a translucent blocker + spinner sits over all three columns and
   swallows pointer/keyboard input, so no field or dropdown can change
   mid-recompute.
4. **Latest-wins guard on `quickview`.** A monotonic request sequence ensures a
   slower/older response can never overwrite a newer one — the structural fix
   that removes the collision even if timing slips past the UI gating.

## Design

### 1. Coordinator: in-flight state + latest-wins guard
File: `app/frontend/src/state/mergedCoordinator.tsx`

- Add `quickviewPending: boolean` to `MergedCoordinatorState` (init `false`),
  and to `initialMergedCoordinatorState`.
- Reducer changes (exactly two):
  - New action `QUICKVIEW_PENDING` → sets `quickviewPending: true`.
  - `QUICKVIEW_LOADED` (existing) → additionally sets `quickviewPending: false`
    (keeps its existing inspected-index clearing).
  - New action `QUICKVIEW_SETTLED` → sets `quickviewPending: false` only. Used
    by the `finally`/failure path so the overlay clears even when a call fails
    or its result is dropped as stale. (`ERROR` is NOT overloaded for this —
    it sets `running:false` and is used for run/tick failures too; a dedicated
    action keeps the pending flag's ownership unambiguous.)
- In `quickview()`:
  - Increment a `quickviewSeqRef` (a `useRef<number>`), capture `seq`.
  - `dispatch({ type: 'QUICKVIEW_PENDING' })` before the await.
  - On success, **only** dispatch `QUICKVIEW_LOADED` if
    `seq === quickviewSeqRef.current` (no newer call started). A stale response
    is dropped silently — it is display-only, so dropping it is safe.
  - On failure, route through the existing `ERROR` dispatch (unchanged).
  - In `finally`, dispatch `QUICKVIEW_SETTLED` only when
    `seq === quickviewSeqRef.current` — the newest call owns the pending flag,
    so a stale call settling does not clear an overlay a newer call still needs.
- The existing `QUICKVIEW_LOADED` behavior (clearing inspected fire/rest indices)
  is preserved.

### 2. Setup panel: suppress recompute while a popup is open
File: `app/frontend/src/components/merged/MergedSetupPanel.tsx`

- The auto-quickview effect (`:1044`) gains an `openEdit !== null` guard: it
  does **not** schedule a `quickview` while any Edit popup is open. `openEdit`
  is added to its dependency array, so when the popup closes (`openEdit → null`)
  the effect re-runs and fires **one** debounced quickview against the final
  edited values. (The 500 ms debounce stays as a safety net; on close it is a
  single fire because the store has settled.)
- The live-run reset effect (`:1121`) gains the same `openEdit !== null` guard —
  don't reset the running sim on each keystroke inside a popup; reset once when
  the popup closes if the signature actually changed.
- Left-panel dropdowns are **not** in a popup (`openEdit` stays `null`), so they
  recompute immediately as today — but now behind the busy overlay + latest-wins
  guard, so rapid dropdown changes no longer collide.

### 3. Busy overlay component + CSS
Files: new `app/frontend/src/components/merged/BusyOverlay.tsx`;
`app/frontend/src/styles/app.css`; mount in `MergedShell.tsx`.

- `BusyOverlay` renders `null` unless `coordinator.state.quickviewPending`.
  When pending it renders an absolutely-positioned blocker inside
  `.merged-shell` covering all three columns, with a centered spinner and a
  localized "Recomputing…" label (JA/EN via `t()`).
- CSS: `.merged-busy-overlay` — `position: absolute; inset: 0; z-index: 900;`
  (below the `1000` modal backdrop, which is irrelevant here — see note),
  translucent background, `pointer-events: auto` so it swallows clicks;
  spinner keyframes.
- Mount: `.merged-shell` gets `position: relative` (it is currently a grid with
  no positioning) so the absolute overlay anchors to it. `BusyOverlay` is
  rendered as a direct child of the `.merged-shell` div in `MergedLiveBody`.

**Note on modals vs overlay:** popup Modals portal to `document.body` (outside
`.merged-shell`), so a shell-scoped overlay would not cover an open popup. This
is intentional and correct: while a popup is open, recompute is *suppressed*
(no overlay needed); the overlay only appears after the popup has closed, when
the single on-close recompute runs. So the overlay never needs to cover a modal.

## Data flow (after change)

```
Popup field onChange ─► store dispatch ─► overlays/drift update live
                                          (auto-quickview SUPPRESSED: openEdit != null)
Popup close (×/Esc/backdrop) ─► openEdit=null ─► effect re-runs ─► ONE quickview
                                                                     │
Left dropdown onChange ─► store dispatch ─► effect (openEdit==null) ─┤
                                                                     ▼
                              QUICKVIEW_PENDING (overlay on, screen locked)
                                                                     │ await POST
                              seq===current? ─ yes ─► QUICKVIEW_LOADED (overlay off)
                                             └ no  ─► drop stale response
```

## Error handling
- A failed `quickview` clears `quickviewPending` (overlay never sticks) and
  routes through the existing `ERROR` path (already wired at
  `mergedCoordinator.tsx:576`).
- Stale responses are dropped, not surfaced — display-only, no evidence written.

## Testing
- **Coordinator unit test** (`app/frontend/tests/`): two overlapping
  `quickview()` calls — assert only the second's result lands in
  `quickviewResult`, and `quickviewPending` returns to `false`.
- **Setup panel component test**: (a) editing a field inside an open popup does
  NOT call `coordinator.quickview`; (b) closing the popup calls it exactly once;
  (c) `quickviewPending` shows the overlay (blocker present) and clears it.
- Run the existing `merged_quickview_ui.test.tsx` / `merged_proposal_time.test.tsx`
  to confirm no regression in the debounced-quickview contract.

## Out of scope
- htmlapp mirror (separate task after owner review, per branch discipline).
- Any change to the backend `quickview`/`merged-runs` endpoints.
- The single-screen Trigger and Proposal setup panels (this is Combined-only).
