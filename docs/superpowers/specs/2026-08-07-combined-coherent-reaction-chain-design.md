# Combined screen — coherent driver-reaction chain (animation mode)

**Date:** 2026-08-07
**Branch:** fixbug-0806
**Scope:** Frontend only — the Combined ("merged") simulator's live animation mode.
**Backend:** No changes. The backend already surfaces every proposal the flow
needs (fire → proposal, rest recompute → post-rest proposal, re-pause on
`trigger.paused`). This is a **frontend reaction-flow** change concentrated in
`app/frontend/src/components/merged/` + `app/frontend/src/state/mergedCoordinator.tsx`.

## Problem

In animation mode the driver-reaction chain is button-driven and incoherent:

- A **Step** button and an auto-armed **Continue** button (enabled after Play)
  clutter the controls and let the reviewer tick past proposals mechanically,
  bypassing the driver conversation.
- After the nap at a rest spot, the **post-rest proposal never opens a
  conversation** — `guidedState` treats "recovery seen" as a blanket
  `done`, so the reviewer must read the right-hand panel and press Continue,
  breaking the "reaction chain" illusion.
- There is no distinction between a **manual pause** (reviewer clicked Pause,
  wants to resume when ready) and a **proposal pause** (a trigger fired and the
  driver must respond). Both are resolved by the same Continue button.

## Goal

Make the reaction chain **conversation-driven**: the tick loop resumes only
when the driver resolves the on-map overlay, or when the reviewer manually
un-pauses. The overlay carries the whole conversation for every trigger,
including the post-rest one.

## Decisions (locked with owner)

1. **Two distinct pauses.** Manual Pause → a Continue button resumes. A trigger
   fire (proposal pause) shows **no** Continue button; it is resolved only by the
   on-map overlay. **Step button removed entirely.**
2. **Resume trigger.** Moving-car conversations (monotony, pre-rest) **auto-resume**
   when the overlay is resolved. Only after the **post-rest** proposal (car stopped
   at the spot) does an on-map **"▶ Continue driving"** button appear to depart.
3. **Music overlay while driving.** Accepting content (a music service) shows a
   small persistent **♪ Now playing** badge (reusing the wakefulness-style badge),
   on the moving map, until the next fire / rest arrival / manual pause.
4. **Post-rest reuses the same conversation.** After the nap, the post-rest
   proposal runs the **same** service → content accept/reject overlay as
   monotony/safety. On resolve (accept content or reject) → "▶ Continue driving".
5. **Reject = dismiss + auto-resume.** Rejecting a monotony/safety proposal (at
   the service or content step) closes the overlay and the moving car resumes
   immediately (matches today's `declineRest`/monotony-decline resume).

## Current behavior (baseline)

- **Controls** (`MergedCenterPanel.tsx`): Play/Continue, Pause, Step, Reset, speed.
  `playLabel = hasRun && !running ? 'Continue' : 'Play'` — so Continue arms after
  any halt (manual OR proposal pause).
- **Guided overlay** driven by `guidedSteps.ts::guidedState`: `rest → service →
  content → done`. `conversationOver` (recovery phase seen, sticky per
  opportunity) forces `done` — this is what suppresses the post-rest conversation.
- **Rest step**: `rest-accept-panel` overlay with spot buttons + Reject. Choose a
  spot → `acceptRest` + auto-select rank-1 service, stays paused. Reject →
  `declineRest` → `play()`.
- **Monotony**: only the monotony fire gets a `guided-decline-button` at the
  service/content step (`isMonotonyFire`), routing to `handleReject` →
  `declineRest` → resume.
- **Content step**: song list; the reviewer presses the top **Continue** button
  (`setDismissedOpportunityId` + `startAndPlay`) to resume.
- **Coordinator** (`mergedCoordinator.tsx`): `pause()` clears `running`;
  `declineRest()` dispatches `REST_DECLINED` + `play()`; a fire tick sets
  `paused` and stops the loop.
- **Backend** (`merged_runs.py::tick_merged_run_endpoint`): a post-rest recompute
  sets `resp.trigger["paused"] = True` on the tick that surfaces the after-rest
  proposal (new `opportunity_id`, `lifecycle_stage: after_rest_before_restart`).

## Target design

### 1. Controls row

- **Remove the Step button** (`merged-step-button`) and its handler wiring.
- **Continue only after a manual pause.** Introduce a coordinator notion of
  *who* paused:
  - New state field `pausedByUser: boolean` (default `false`).
  - `pause()` sets `pausedByUser = true`.
  - A tick that halts on a **fire** (`trigger.paused && !completed`) leaves
    `pausedByUser = false`.
  - `play()`/`startAndPlay()`/any resume clears `pausedByUser = false`.
  - Completion is unaffected (button stays disabled when `completed`).
- **Button label / visibility**:
  - `hasRun && !running && pausedByUser` → **Continue** (enabled).
  - `hasRun && !running && !pausedByUser && <a proposal is on screen>` →
    Continue is **hidden** (the overlay is the only way forward).
  - otherwise → **Play** (enabled per existing `ready`/`completed` guards).
  - "a proposal is on screen" = there is an unresolved guided conversation OR a
    pending "Continue driving" (see §3). Concretely: `guidedActive` is true, or
    the post-rest `awaitingContinue` step is active.
- Reset + speed selector unchanged.

### 2. Moving-car conversations (monotony + pre-rest) — auto-resume on resolve

- **Reject available at both service and content steps** for a moving-car
  conversation. Today only monotony shows the decline button; generalize the
  decline affordance so a moving-car proposal (monotony, or a pre-rest music
  proposal that is not the rest-spot chooser) can be rejected at either step.
  - The rest-spot chooser (`showRestOverlay`, `guided.step === 'rest'`) keeps its
    own Reject and is unchanged — it must not gain a second decline path.
- **Reject** → dismiss overlay for this opportunity + **auto-resume**
  (`declineRest` already does `REST_DECLINED` + `play()`; monotony reject uses
  the same). No Continue click.
- **Accept content** (music service reaches the `content` step and the reviewer
  confirms) → dismiss the song list, set a **now-playing** indicator, and
  **auto-resume** the moving car.
  - New coordinator affordance `acceptContentAndResume()` (or reuse the existing
    dismiss path): marks the opportunity dismissed, records
    `nowPlaying: { serviceId, opportunityId }` for the badge, and calls `play()`.
  - The song list gets an **OK / accept** button (owner spec: "the OK / Reject
    button will show under content list"). OK = accept-content-and-resume;
    Reject = the reject path above.
- **♪ Now playing badge**: reuse the wakefulness-style small badge. Rendered on
  the moving map while `nowPlaying != null` and the car is moving. Cleared on the
  next fire (a new opportunity), on rest arrival (recovery starts), or on manual
  pause.

### 3. Rest spot: sleep → post-rest conversation → "Continue driving"

- **Drive to spot + sleep screen**: unchanged (`RecoveryVisual`, nap → karaoke →
  wakefulness).
- **Post-rest conversation**: when the backend surfaces the post-rest proposal
  (a **new** `opportunity_id`, `lifecycle_stage: after_rest_before_restart`,
  car stopped), `guidedState` must **re-enter** the `service → content`
  conversation for that opportunity instead of returning `done`.
  - Replace the blanket `conversationOver = (recovery seen)` gate with
    per-opportunity resolution. The **pre-rest** opportunity is over once
    recovery begins for it; the **post-rest** opportunity is a different
    `opportunity_id` and opens fresh.
  - Detection: `journey_state.lifecycle_stage === 'after_rest_before_restart'`
    marks the conversation as post-rest (car stopped). `guidedState` gains an
    `isAfterRest` awareness so the terminal step is not an auto-resume but an
    explicit **`awaitingContinue`** step.
- **Resolve → "▶ Continue driving"**: on accept-content or reject of the
  post-rest proposal, show an on-map **Continue driving** button (car is
  stopped). Clicking it departs the spot and resumes the loop.
  - New coordinator affordance `continueDriving()`: marks the post-rest
    opportunity dismissed and calls `play()`.

### 4. `guidedSteps.ts` changes

Extend `GuidedStep` and `guidedState`:

- Add `isAfterRest: boolean` to the input (derived by the caller from
  `journey_state.lifecycle_stage === 'after_rest_before_restart'`).
- The pre-rest `conversationOver` gate is **scoped to the pre-rest opportunity**:
  recovery-seen ends the pre-rest conversation only. It must NOT force `done`
  for an after-rest opportunity.
- New terminal step **`awaitingContinue`** returned when a stopped (after-rest)
  conversation has been resolved (content accepted or a non-music service /
  reject), so the UI shows the "Continue driving" button instead of
  auto-resuming.
- Moving-car conversations keep returning `done` at their terminus (auto-resume).

Purity is preserved: `guidedState` still only reads recorded state; the caller
supplies `isAfterRest`, `restDecided`, `serviceChosen`, `hasContentPlan`, and the
new resolution signals.

### 5. Coordinator changes (`mergedCoordinator.tsx`)

- **State**: add `pausedByUser: boolean` and `nowPlaying: { serviceId: string;
  opportunityId: string } | null`.
- **Actions**: `SET_PAUSED_BY_USER`, `SET_NOW_PLAYING`, clear-now-playing on
  fire/recovery/reset.
- `pause()` → `pausedByUser = true`.
- `step()` internal loop guard unchanged, but the public `step` method + button
  are removed from the UI (keep `step` internal to `play()`'s loop).
- Resume paths (`play`, `startAndPlay`, `declineRest`) clear `pausedByUser`.
- `TICK_APPENDED`: when `trigger.paused` is set by a fire, ensure `pausedByUser`
  stays `false`; clear `nowPlaying` when a NEW opportunity fires or recovery
  begins.
- New methods: `acceptContentAndResume(serviceId)` and `continueDriving()` as
  described. Both may be thin wrappers over existing dismiss + `play()` logic;
  the component owns per-opportunity dismissed-id bookkeeping as today.

## Testing (TDD)

Write failing tests first, then implement.

### Unit — `guidedSteps.ts` (`app/frontend/tests/`)
- Pre-rest: recovery-seen ends the pre-rest conversation (`done`).
- **Post-rest reopens**: an `after_rest_before_restart` opportunity with an
  unchosen service → `service`; then `content`; then, once resolved,
  `awaitingContinue` (NOT `done`, NOT auto-resume).
- Moving-car monotony: content accepted → `done` (auto-resume terminus).
- Reject at service/content for a moving-car conversation → `done`.

### Component — `MergedCenterPanel` (`app/frontend/tests/`)
- **No Step button** renders.
- **Continue only after manual pause**: after `pause()`, Continue is enabled;
  during a proposal pause (fire on screen), Continue is hidden and the overlay
  is the only control.
- Moving-car reject → overlay dismisses and the loop resumes (`play` called).
- Accept content → song list dismissed, **♪ Now playing** badge shows, loop
  resumes.
- Post-rest: after the nap the **service/content overlay reopens**; resolving it
  shows **"▶ Continue driving"**; clicking it resumes the loop.

### Coordinator — `mergedCoordinator` (`app/frontend/tests/`)
- `pause()` sets `pausedByUser`; `play()`/`declineRest()` clear it.
- Fire-driven pause leaves `pausedByUser` false.
- `nowPlaying` set on accept-content; cleared on next fire / recovery / reset.

## Out of scope

- **htmlapp** port — done in a separate pass after owner review of `app/`
  (per branch workflow: fix `app/` first, then mirror to `htmlapp/`).
- Backend changes — none.
- Quick-view / read-only inspection flow — unchanged.
- Trigger-only (non-merged) review screen — unchanged.

## Risks / notes

- The `pausedByUser` / "proposal on screen" gate must be airtight: a reviewer
  must never be stranded with no way to advance. Fallback: if the coordinator is
  paused, not-by-user, and no overlay is showing, treat it as a manual pause
  (show Continue) — a defensive default so the run is never un-resumable.
- Per-opportunity bookkeeping already exists (`resolvedOpportunityId`,
  `serviceChosenOpportunityId`, `dismissedOpportunityId`); the after-rest step
  should reuse these keyed by `opportunity_id`, not a global "recovery seen".
- `RecoveryVisual` renders on `recovery_phase`/`motion_state`; the post-rest
  overlay must appear only AFTER recovery collapses (wakefulness done, car
  stopped, post-rest proposal present) so the sleep screen and the conversation
  do not overlap.
