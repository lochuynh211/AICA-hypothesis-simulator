# Combined coherent reaction chain — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Combined screen's animation mode conversation-driven — the tick loop resumes only when the driver resolves the on-map overlay (or the reviewer manually un-pauses) — and reopen the post-rest proposal as its own conversation.

**Architecture:** Frontend-only change to `app/frontend`. A pure step-machine (`guidedSteps.ts`) gains after-rest awareness; the coordinator (`mergedCoordinator.tsx`) gains a `pausedByUser` distinction and a `nowPlaying` badge signal plus two resume affordances; `MergedCenterPanel.tsx` drops the Step button, gates Continue to manual pauses, and renders OK/Reject on the content list, the now-playing badge, and the after-rest "Continue driving" button.

**Tech Stack:** React 18 + TypeScript + Vite, Vitest + @testing-library/react (jsdom). Tests live in `app/frontend/tests/`.

## Global Constraints

- **Backend is source of truth** — the frontend never computes decisions/evidence (CLAUDE.md). This change only alters *when the loop resumes* and *what overlay shows*, never proposal content.
- **No new npm dependencies.** Reuse existing components/styles.
- **Bilingual copy (JA/EN)** for every user-facing string, via the existing `t()` / `LABELS` pattern in each file. JA first, then EN.
- **Failures are never disguised** — keep the existing `role="alert"` error surfaces intact.
- **htmlapp is OUT of scope** — do not touch `htmlapp/`. It is mirrored in a later pass after owner review.
- **Do not commit** until explicitly told (branch discipline: bundle all app/ fixes into one commit later). Each task's "Commit" step below is written for completeness but the executor MUST skip committing and instead report the task complete; the human batches the commit.
- Run tests with: `docker compose exec frontend npm test -- <file>` OR locally `cd app/frontend && npx vitest run tests/<file>`.

Key `trigger_purpose` / `lifecycle_stage` values (verbatim from `models/proposal/enums.py`):
- `trigger_purpose`: `rest_recommended`, `inattentive_driving_prevention_recovery` (monotony), `route_music`, `child_passenger_experience`.
- `lifecycle_stage`: `before_rest_until_stop`, `during_rest_stopped`, `after_rest_before_restart`, `active_driving_content`.

---

### Task 1: `guidedSteps.ts` — after-rest awareness + `awaitingContinue`

**Files:**
- Modify: `app/frontend/src/components/merged/guidedSteps.ts`
- Test: `app/frontend/tests/guided_steps.test.ts`

**Interfaces:**
- Produces:
  - `GuidedStep = 'rest' | 'service' | 'content' | 'awaitingContinue' | 'done'`
  - `guidedState(args)` where `args` adds two optional booleans:
    - `isAfterRest?: boolean` — the proposal is a post-rest conversation (`journey_state.lifecycle_stage === 'after_rest_before_restart'`).
    - `afterRestResolved?: boolean` — reviewer pressed OK/Reject on the after-rest content (show "Continue driving").
    - `afterRestContinued?: boolean` — reviewer pressed "Continue driving" (conversation done).
  - Existing `isRestFlow` / `activeServiceId` outputs unchanged; `step` may now be `'awaitingContinue'`.

- [ ] **Step 1: Write the failing tests**

Append to `app/frontend/tests/guided_steps.test.ts`:

```ts
describe('guidedState — after-rest conversation reopens', () => {
  const afterRest = (activeServiceId: string | null) =>
    log({
      opportunity: { opportunity_id: 'opp-post', trigger_purpose: 'inattentive_driving_prevention_recovery' },
      journey_state: { lifecycle_stage: 'after_rest_before_restart', active_service_id: activeServiceId },
    })

  it('re-opens on the service step even though recovery was already seen', () => {
    // conversationOver would force `done` for a pre-rest fire — an after-rest
    // proposal is a fresh opportunity and must NOT be suppressed by it.
    const s = guidedState({
      proposalLog: afterRest(null),
      restDecided: true,
      serviceChosen: false,
      hasContentPlan: false,
      conversationOver: true,
      isAfterRest: true,
    })
    expect(s.step).toBe('service')
  })

  it('walks to the content step once a music service is chosen', () => {
    const s = guidedState({
      proposalLog: afterRest('music_playlist'),
      restDecided: true,
      serviceChosen: true,
      hasContentPlan: true,
      conversationOver: true,
      isAfterRest: true,
    })
    expect(s.step).toBe('content')
  })

  it('shows awaitingContinue once the after-rest content is resolved (car is stopped)', () => {
    const s = guidedState({
      proposalLog: afterRest('music_playlist'),
      restDecided: true,
      serviceChosen: true,
      hasContentPlan: true,
      isAfterRest: true,
      afterRestResolved: true,
    })
    expect(s.step).toBe('awaitingContinue')
  })

  it('is done once the reviewer presses Continue driving', () => {
    const s = guidedState({
      proposalLog: afterRest('music_playlist'),
      restDecided: true,
      serviceChosen: true,
      hasContentPlan: true,
      isAfterRest: true,
      afterRestResolved: true,
      afterRestContinued: true,
    })
    expect(s.step).toBe('done')
  })
})

describe('guidedState — a moving-car conversation still auto-resumes (no awaitingContinue)', () => {
  it('never returns awaitingContinue when isAfterRest is false', () => {
    const s = guidedState({
      proposalLog: log({
        opportunity: { opportunity_id: 'opp-mono', trigger_purpose: 'inattentive_driving_prevention_recovery' },
        journey_state: { lifecycle_stage: 'active_driving_content', active_service_id: 'music_playlist' },
      }),
      restDecided: false,
      serviceChosen: true,
      hasContentPlan: true,
      afterRestResolved: true, // ignored when not after-rest
    })
    expect(s.step).toBe('content')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app/frontend && npx vitest run tests/guided_steps.test.ts`
Expected: FAIL — `awaitingContinue` not produced; `isAfterRest`/`afterRestResolved`/`afterRestContinued` unknown.

- [ ] **Step 3: Implement**

In `guidedSteps.ts`:

1. Widen the step type:
```ts
export type GuidedStep = 'rest' | 'service' | 'content' | 'awaitingContinue' | 'done'
```

2. Add the three optional inputs to the `guidedState` parameter object (with JSDoc) and the logic. The new branches go at the TOP of the resolved-conversation logic, and the `conversationOver` gate becomes after-rest-aware:

```ts
export function guidedState({
  proposalLog,
  restDecided,
  serviceChosen,
  hasContentPlan,
  conversationOver = false,
  isAfterRest = false,
  afterRestResolved = false,
  afterRestContinued = false,
}: {
  proposalLog: ProposalRunLog | null
  restDecided: boolean
  serviceChosen: boolean
  hasContentPlan: boolean
  conversationOver?: boolean
  /** The proposal is a post-rest conversation (car stopped at the spot). */
  isAfterRest?: boolean
  /** Reviewer resolved (OK/Reject) the after-rest content — show "Continue driving". */
  afterRestResolved?: boolean
  /** Reviewer pressed "Continue driving" — the after-rest conversation is over. */
  afterRestContinued?: boolean
}): GuidedState {
  const opportunity = proposalLog?.opportunity
  const journey = proposalLog?.journey_state
  const activeServiceId = journey?.active_service_id ?? null

  const isRestFlow =
    opportunity?.trigger_purpose === 'rest_recommended' &&
    journey?.lifecycle_stage === 'before_rest_until_stop'

  if (proposalLog == null || opportunity == null) {
    return { step: 'done', isRestFlow: false, activeServiceId }
  }

  // After-rest conversation (car stopped at the spot): it is a fresh
  // opportunity and must NOT be closed by the pre-rest `conversationOver`
  // gate. Once resolved it does not auto-resume — it waits for an explicit
  // "Continue driving" (the car is stopped).
  if (isAfterRest) {
    if (afterRestContinued) return { step: 'done', isRestFlow: false, activeServiceId }
    if (afterRestResolved) return { step: 'awaitingContinue', isRestFlow: false, activeServiceId }
  } else if (conversationOver) {
    return { step: 'done', isRestFlow: Boolean(isRestFlow), activeServiceId }
  }

  if (isRestFlow && !restDecided) {
    return { step: 'rest', isRestFlow: true, activeServiceId }
  }
  if (!serviceChosen) {
    return { step: 'service', isRestFlow: Boolean(isRestFlow), activeServiceId }
  }
  if (isMusicService(activeServiceId) && hasContentPlan) {
    return { step: 'content', isRestFlow: Boolean(isRestFlow), activeServiceId }
  }
  return { step: 'done', isRestFlow: Boolean(isRestFlow), activeServiceId }
}
```

Update the module doc comment to mention the post-rest conversation reopens.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app/frontend && npx vitest run tests/guided_steps.test.ts`
Expected: PASS (all existing + new tests).

- [ ] **Step 5: Commit** (SKIP per Global Constraints — report complete instead)

```bash
git add app/frontend/src/components/merged/guidedSteps.ts app/frontend/tests/guided_steps.test.ts
git commit -m "feat(merged): guidedSteps after-rest reopens with awaitingContinue"
```

---

### Task 2: Coordinator — `pausedByUser` (manual vs proposal pause)

**Files:**
- Modify: `app/frontend/src/state/mergedCoordinator.tsx`
- Test: `app/frontend/tests/merged_coordinator.test.tsx`

**Interfaces:**
- Produces on `MergedCoordinatorState`: `pausedByUser: boolean` (default `false`).
- `pause()` sets `pausedByUser = true`; `play()` / `startAndPlay()` / `declineRest()` / `reset()` clear it to `false`.
- A tick that halts on a fire (`trigger.paused`) leaves `pausedByUser` unchanged (stays `false`).

- [ ] **Step 1: Write the failing tests**

Append to `app/frontend/tests/merged_coordinator.test.tsx` (reuse its existing `renderHook`/fixtures; add a small quiet + fired tick if not already present — the file already imports `MergedTickResponse`). Add:

```ts
describe('mergedCoordinator — pausedByUser distinguishes manual from proposal pause', () => {
  function firedPausedTick(): MergedTickResponse {
    return {
      trigger: {
        decision: restProposalDecision, error: null, paused: true, completed: false,
        tick_index: 10, route_fraction: 0.1, distance_km: null, speed_kph: 0,
        motion_state: 'STOPPED', recovery_phase: null, is_traffic_jam: false, segment_type: 'highway',
      },
      proposal: baseProposalLog(), correlation: null,
    }
  }

  it('is false initially and after create', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'm', trigger_run_id: 't' })
    const { result } = renderHook(() => useMergedCoordinator(), { wrapper })
    expect(result.current.state.pausedByUser).toBe(false)
    await act(async () => {
      await result.current.create({ trigger_plan_id: 'p', world: {} as never, service_package_id: 's', content_package_id: 'c', run_seed: '7' })
    })
    expect(result.current.state.pausedByUser).toBe(false)
  })

  it('pause() sets pausedByUser true; play() clears it', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'm', trigger_run_id: 't' })
    vi.mocked(tickMergedRun).mockResolvedValue(firedPausedTick())
    const { result } = renderHook(() => useMergedCoordinator(), { wrapper })
    await act(async () => {
      await result.current.create({ trigger_plan_id: 'p', world: {} as never, service_package_id: 's', content_package_id: 'c', run_seed: '7' })
    })
    act(() => { result.current.pause() })
    expect(result.current.state.pausedByUser).toBe(true)
    await act(async () => {
      result.current.play()
      await Promise.resolve(); await Promise.resolve()
    })
    expect(result.current.state.pausedByUser).toBe(false)
  })

  it('a fire-driven pause leaves pausedByUser false', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'm', trigger_run_id: 't' })
    vi.mocked(tickMergedRun).mockResolvedValue(firedPausedTick())
    const { result } = renderHook(() => useMergedCoordinator(), { wrapper })
    await act(async () => {
      await result.current.create({ trigger_plan_id: 'p', world: {} as never, service_package_id: 's', content_package_id: 'c', run_seed: '7' })
    })
    await act(async () => { await result.current.step() })
    expect(result.current.state.paused).toBe(true)
    expect(result.current.state.pausedByUser).toBe(false)
  })
})
```

If the file has no `wrapper` const, add near the top after imports:
```ts
const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(MergedCoordinatorProvider, null, children)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app/frontend && npx vitest run tests/merged_coordinator.test.tsx`
Expected: FAIL — `pausedByUser` undefined.

- [ ] **Step 3: Implement**

In `mergedCoordinator.tsx`:

1. Add to `MergedCoordinatorState` (after `running`): `pausedByUser: boolean`, with a doc comment: `/** True only when the reviewer clicked Pause (not a fire's proposal pause). Gates the Continue button. */`
2. Add to `initialMergedCoordinatorState`: `pausedByUser: false,`.
3. Add action variants: `| { type: 'SET_PAUSED_BY_USER'; value: boolean }`.
4. Reducer:
   - `SET_PAUSED_BY_USER`: `return { ...state, pausedByUser: action.value }`.
   - `SET_RUNNING` with `running: true`: also set `pausedByUser: false` (resuming clears it).
   - `CREATED` and `RESET`: `pausedByUser` resets to `false` (already covered by spreading `initialMergedCoordinatorState`).
   - `TICK_APPENDED`: do NOT change `pausedByUser` (leave as-is).
5. `pause()`: after `dispatch({ type: 'SET_RUNNING', running: false })`, add `dispatch({ type: 'SET_PAUSED_BY_USER', value: true })`.
6. `play()` already dispatches `SET_RUNNING running:true` (which now clears the flag). No extra change needed. `declineRest()` calls `play()`, so it clears it too.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app/frontend && npx vitest run tests/merged_coordinator.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit** (SKIP — report complete)

```bash
git add app/frontend/src/state/mergedCoordinator.tsx app/frontend/tests/merged_coordinator.test.tsx
git commit -m "feat(merged): coordinator pausedByUser distinguishes manual vs proposal pause"
```

---

### Task 3: Coordinator — `nowPlaying` badge signal + `acceptContentAndResume` + `continueDriving`

**Files:**
- Modify: `app/frontend/src/state/mergedCoordinator.tsx`
- Test: `app/frontend/tests/merged_coordinator.test.tsx`

**Interfaces:**
- Produces on state: `nowPlaying: { serviceId: string; opportunityId: string } | null` (default `null`).
- New context methods:
  - `acceptContentAndResume(serviceId: string, opportunityId: string): void` — records `nowPlaying` then resumes (`play()`).
  - `continueDriving(): void` — resumes (`play()`) after an after-rest conversation.
- `nowPlaying` is cleared: when a tick brings a fire for a DIFFERENT opportunity, when `recovery_phase != null`, on `pause()`, and on `reset()`.

- [ ] **Step 1: Write the failing tests**

Append to `app/frontend/tests/merged_coordinator.test.tsx`:

```ts
describe('mergedCoordinator — nowPlaying badge', () => {
  function movingTick(recovery: string | null, oppId: string): MergedTickResponse {
    return {
      trigger: {
        decision: restProposalDecision, error: null, paused: true, completed: false,
        tick_index: 20, route_fraction: 0.2, distance_km: null, speed_kph: 30,
        motion_state: recovery ? 'STOPPED' : 'DRIVING', recovery_phase: recovery,
        is_traffic_jam: false, segment_type: 'highway',
      },
      proposal: baseProposalLog({ opportunity: { opportunity_id: oppId, trigger_purpose: 'inattentive_driving_prevention_recovery', lifecycle_stage: 'active_driving_content', allowed_service_ids: ['music_playlist'], simulation_time: 20, run_seed: '7' } as never }),
      correlation: null,
    }
  }

  it('acceptContentAndResume records nowPlaying and resumes', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'm', trigger_run_id: 't' })
    vi.mocked(tickMergedRun).mockResolvedValue({ ...movingTick(null, 'opp-a'), trigger: { ...movingTick(null,'opp-a').trigger, paused: true } })
    const { result } = renderHook(() => useMergedCoordinator(), { wrapper })
    await act(async () => {
      await result.current.create({ trigger_plan_id: 'p', world: {} as never, service_package_id: 's', content_package_id: 'c', run_seed: '7' })
    })
    await act(async () => {
      result.current.acceptContentAndResume('music_playlist', 'opp-a')
      await Promise.resolve(); await Promise.resolve()
    })
    expect(result.current.state.nowPlaying).toEqual({ serviceId: 'music_playlist', opportunityId: 'opp-a' })
  })

  it('clears nowPlaying when recovery begins', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'm', trigger_run_id: 't' })
    vi.mocked(tickMergedRun).mockResolvedValue(movingTick('nap', 'opp-a'))
    const { result } = renderHook(() => useMergedCoordinator(), { wrapper })
    await act(async () => {
      await result.current.create({ trigger_plan_id: 'p', world: {} as never, service_package_id: 's', content_package_id: 'c', run_seed: '7' })
    })
    await act(async () => { result.current.acceptContentAndResume('music_playlist', 'opp-a') })
    await act(async () => { await result.current.step() })
    expect(result.current.state.nowPlaying).toBeNull()
  })

  it('pause clears nowPlaying', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'm', trigger_run_id: 't' })
    const { result } = renderHook(() => useMergedCoordinator(), { wrapper })
    await act(async () => {
      await result.current.create({ trigger_plan_id: 'p', world: {} as never, service_package_id: 's', content_package_id: 'c', run_seed: '7' })
    })
    await act(async () => { result.current.acceptContentAndResume('music_playlist', 'opp-a') })
    act(() => { result.current.pause() })
    expect(result.current.state.nowPlaying).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app/frontend && npx vitest run tests/merged_coordinator.test.tsx`
Expected: FAIL — `nowPlaying` / `acceptContentAndResume` / `continueDriving` undefined.

- [ ] **Step 3: Implement**

In `mergedCoordinator.tsx`:

1. State field (after `pausedByUser`): `nowPlaying: { serviceId: string; opportunityId: string } | null` with doc comment `/** The song badge shown on the moving map after the driver accepts content. Cleared on the next fire, on recovery, on pause, and on reset. */`.
2. `initialMergedCoordinatorState`: `nowPlaying: null,`.
3. Actions:
   - `| { type: 'SET_NOW_PLAYING'; value: { serviceId: string; opportunityId: string } | null }`
4. Reducer:
   - `SET_NOW_PLAYING`: `return { ...state, nowPlaying: action.value }`.
   - `TICK_APPENDED`: after computing, clear `nowPlaying` when recovery is active OR a different opportunity fired:
     ```ts
     const recoveryActive = trigger.recovery_phase != null
     const firedOppId = proposal?.opportunity?.opportunity_id ?? null
     const clearBadge =
       recoveryActive ||
       (firedOppId != null && state.nowPlaying != null && firedOppId !== state.nowPlaying.opportunityId)
     // in the returned object:
     nowPlaying: clearBadge ? null : state.nowPlaying,
     ```
   - `pause()` path: dispatch `SET_NOW_PLAYING value:null` (add to the `pause` function, not the reducer's SET_RUNNING, to avoid clearing it on every proposal pause). Actually clear in `pause()` function directly.
   - `RESET`: covered by spreading `initialMergedCoordinatorState`.
5. Methods:
   ```ts
   const acceptContentAndResume = (serviceId: string, opportunityId: string): void => {
     dispatch({ type: 'SET_NOW_PLAYING', value: { serviceId, opportunityId } })
     play()
   }
   const continueDriving = (): void => {
     play()
   }
   ```
6. `pause()`: add `dispatch({ type: 'SET_NOW_PLAYING', value: null })`.
7. Add both methods to the context `value` object and to the `MergedCoordinatorContextValue` type with doc comments.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app/frontend && npx vitest run tests/merged_coordinator.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit** (SKIP — report complete)

```bash
git add app/frontend/src/state/mergedCoordinator.tsx app/frontend/tests/merged_coordinator.test.tsx
git commit -m "feat(merged): coordinator nowPlaying badge + acceptContentAndResume/continueDriving"
```

---

### Task 4: `MergedCenterPanel` — remove Step; Continue only after manual pause

**Files:**
- Modify: `app/frontend/src/components/merged/MergedCenterPanel.tsx`
- Test: `app/frontend/tests/merged_center.test.tsx`

**Interfaces:**
- Consumes: `state.pausedByUser` (Task 2), `guided.step` (Task 1).
- Produces: no `merged-step-button` in the DOM; the `merged-play-button` shows **Continue** only when paused-by-user, is hidden during a proposal pause (an active guided conversation), and shows **Play** before/without a run.

- [ ] **Step 1: Write the failing tests**

Append to `app/frontend/tests/merged_center.test.tsx` a new describe block. It reuses the file's existing helpers (`renderCenterPanel`, `firedTickWithProposal`, `createMergedRun`, `tickMergedRun`, mocks):

```ts
describe('MergedCenterPanel — controls: no Step, Continue only after manual pause', () => {
  it('renders no Step button', () => {
    renderCenterPanel()
    expect(screen.queryByTestId('merged-step-button')).toBeNull()
  })

  it('after a manual pause the Play button reads Continue and is enabled', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_p', trigger_run_id: 'run_p' })
    // A quiet tick so play()'s loop halts without a fire on screen.
    vi.mocked(tickMergedRun).mockResolvedValue({
      trigger: { decision: null, error: null, paused: true, completed: false, tick_index: null,
        route_fraction: 0.3, distance_km: null, speed_kph: 20, motion_state: 'DRIVING',
        recovery_phase: null, is_traffic_jam: false, segment_type: 'highway' },
      proposal: null, correlation: null,
    })
    const coordinatorRef = renderCenterPanel()
    await act(async () => {
      await coordinatorRef.current!.create({ trigger_plan_id: 'plan_1', world: {} as never,
        service_package_id: 'mock_service_selector_v1', content_package_id: 'mock_content_selector_v1', run_seed: '7' })
    })
    act(() => { coordinatorRef.current!.pause() })
    const btn = screen.getByTestId('merged-play-button') as HTMLButtonElement
    expect(btn).toHaveTextContent('Continue')
    expect(btn).not.toBeDisabled()
  })

  it('hides the Play/Continue button during a proposal pause (fire on screen)', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_pp', trigger_run_id: 'run_pp' })
    // A monotony fire → guided overlay is up (proposal pause), not a manual one.
    vi.mocked(tickMergedRun).mockResolvedValueOnce({
      ...firedTickWithProposal(45),
      proposal: baseProposalLog({
        opportunity: { opportunity_id: 'opp-pp', trigger_purpose: 'inattentive_driving_prevention_recovery' } as never,
        journey_state: { lifecycle_stage: 'active_driving_content', motion_state: 'driving', active_service_id: null, active_plan_id: null },
        evidence: [serviceEvidence()],
      }),
    })
    const coordinatorRef = renderCenterPanel()
    await act(async () => {
      await coordinatorRef.current!.create({ trigger_plan_id: 'plan_1', world: {} as never,
        service_package_id: 'mock_service_selector_v1', content_package_id: 'mock_content_selector_v1', run_seed: '7' })
    })
    await act(async () => { await coordinatorRef.current!.step() })
    expect(screen.getByTestId('guided-overlay')).toBeInTheDocument()
    expect(screen.queryByTestId('merged-play-button')).toBeNull()
  })
})
```

Also update the pre-existing `'the Play button drives coordinator.play()'` test only if it referenced Step; it does not, so leave it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app/frontend && npx vitest run tests/merged_center.test.tsx`
Expected: FAIL — Step button still present; Continue/hide gating not implemented.

- [ ] **Step 3: Implement**

In `MergedCenterPanel.tsx`:

1. Delete the entire `merged-step-button` `<button>` block (lines ~340-347).
2. Replace the `playLabel` computation and Play button gating. Compute:
```ts
// A proposal conversation is on screen (a fire's pause) whenever the guided
// overlay is showing something to resolve — including the after-rest
// "Continue driving" step. That pause is resolved by the overlay, never by
// the top button, so the button hides.
const proposalOnScreen = guidedActive // guided.step !== 'done'
// Continue is offered ONLY for a manual pause. A defensive fallback also
// offers it when the run is paused, not by a fire's overlay, and not by the
// user flag — so a reviewer is never stranded with no way to resume.
const showContinue =
  hasRun && !state.running && !state.completed && (state.pausedByUser || !proposalOnScreen)
const playLabel = hasRun && !state.running && state.pausedByUser ? t(LABELS.continue, lang) : t(LABELS.play, lang)
```
Note: `guidedActive` is defined later in the file (line ~213). MOVE the `guided`/`guidedActive` computation above the controls JSX, or compute `proposalOnScreen`/`showContinue` just before the `return`. Simplest: the controls are inside the returned JSX, and `guidedActive` is already computed before the `return` — verify ordering and, if needed, hoist `showContinue`/`proposalOnScreen`/`playLabel` to just before `return (`.

3. Gate the Play button render:
```tsx
{(!hasRun || showContinue || (!state.running && !proposalOnScreen)) && (
  <button
    type="button"
    data-testid="merged-play-button"
    disabled={(!hasRun && !state.ready) || state.running || state.completed}
    onClick={() => { void coordinator.startAndPlay() }}
  >
    {playLabel}
  </button>
)}
```
The `onClick` no longer sets `dismissedOpportunityId` (that dismissal moves to the OK button in Task 5). Keep Pause, Reset, and speed exactly as-is.

Wait — when `!hasRun`, show Play. When `hasRun && running`, the render condition `showContinue` is false and `!running` is false → button hidden while running (Pause handles it). When `hasRun && paused by fire (proposalOnScreen)` → `showContinue` false, `!proposalOnScreen` false → hidden. When `hasRun && manual pause` → `showContinue` true → shown as Continue. When `hasRun && paused, no overlay, not by user` (defensive) → `showContinue` true → shown as Continue. Confirm this matches the render condition; simplify the condition to just `{(!hasRun || showContinue) && (...)}` since `showContinue` already covers the not-proposalOnScreen fallback and `!hasRun` covers the initial Play. Use:
```tsx
{(!hasRun || showContinue) && ( ... )}
```
and keep `disabled` guarding `running`/`completed`/ready.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app/frontend && npx vitest run tests/merged_center.test.tsx`
Expected: PASS. If the pre-existing `'closes the song list when Continue is pressed'` test (line ~1110) now fails because the top button no longer dismisses, it is superseded by Task 5 — mark it and move its assertion there. Prefer: update that test to press the new content **OK** button once Task 5 lands; for THIS task, if it fails only due to the moved dismissal, temporarily keep the top-button dismissal for the monotony case AND add the OK button in Task 5, then remove it. To avoid churn, the cleanest path: implement Task 5 immediately after Task 4 and run the file once at the end of Task 5.

- [ ] **Step 5: Commit** (SKIP — report complete)

```bash
git add app/frontend/src/components/merged/MergedCenterPanel.tsx app/frontend/tests/merged_center.test.tsx
git commit -m "feat(merged): remove Step, gate Continue to manual pause"
```

---

### Task 5: `MergedCenterPanel` — OK/Reject on content list + now-playing badge

**Files:**
- Modify: `app/frontend/src/components/merged/MergedCenterPanel.tsx`
- Test: `app/frontend/tests/merged_center.test.tsx`

**Interfaces:**
- Consumes: `coordinator.acceptContentAndResume` (Task 3), `coordinator.declineRest`, `state.nowPlaying`.
- Produces DOM: under the guided song list — a `guided-content-ok` button and a `guided-content-reject` button (both only for a MOVING conversation, i.e. `!isAfterRest`). A `now-playing-badge` on the map while `state.nowPlaying != null` and the car is moving.

- [ ] **Step 1: Write the failing tests**

Append to `app/frontend/tests/merged_center.test.tsx`:

```ts
describe('MergedCenterPanel — content OK/Reject + now-playing badge (moving)', () => {
  async function driveToMonotonySongs(suffix: string) {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: `mrun_${suffix}`, trigger_run_id: `run_${suffix}` })
    const logWithPlan = baseProposalLog({
      opportunity: { opportunity_id: `opp-${suffix}`, trigger_purpose: 'inattentive_driving_prevention_recovery' } as never,
      journey_state: { lifecycle_stage: 'active_driving_content', motion_state: 'driving', active_service_id: 'music_playlist', active_plan_id: 'plan_1' },
      evidence: [serviceEvidence(), contentEvidence()],
    })
    vi.mocked(tickMergedRun).mockResolvedValue({ ...firedTickWithProposal(45), proposal: logWithPlan })
    vi.mocked(mergedProposalAction).mockResolvedValue(logWithPlan)
    vi.mocked(declineRest).mockResolvedValue({} as never)
    const coordinatorRef = renderCenterPanel()
    await act(async () => {
      await coordinatorRef.current!.create({ trigger_plan_id: 'plan_1', world: {} as never,
        service_package_id: 'mock_service_selector_v1', content_package_id: 'mock_content_selector_v1', run_seed: '7' })
    })
    await act(async () => { await coordinatorRef.current!.step() })
    await act(async () => { fireEvent.click(screen.getByTestId('guided-choose-music_playlist')) })
    return coordinatorRef
  }

  it('shows OK and Reject under the content song list', async () => {
    await driveToMonotonySongs('ok1')
    expect(screen.getByTestId('guided-song-list')).toBeInTheDocument()
    expect(screen.getByTestId('guided-content-ok')).toBeInTheDocument()
    expect(screen.getByTestId('guided-content-reject')).toBeInTheDocument()
  })

  it('OK dismisses the songs, resumes, and shows the now-playing badge', async () => {
    const coordinatorRef = await driveToMonotonySongs('ok2')
    await act(async () => {
      fireEvent.click(screen.getByTestId('guided-content-ok'))
      await Promise.resolve(); await Promise.resolve()
    })
    expect(screen.queryByTestId('guided-overlay')).toBeNull()
    expect(coordinatorRef.current!.state.nowPlaying).toEqual({ serviceId: 'music_playlist', opportunityId: 'opp-ok2' })
    // Badge shows while the car is moving.
    expect(screen.getByTestId('now-playing-badge')).toBeInTheDocument()
  })

  it('Reject on the content step calls declineRest and clears the overlay', async () => {
    await driveToMonotonySongs('rej1')
    await act(async () => {
      fireEvent.click(screen.getByTestId('guided-content-reject'))
      await Promise.resolve(); await Promise.resolve()
    })
    expect(declineRest).toHaveBeenCalledWith('mrun_rej1')
    expect(screen.queryByTestId('guided-overlay')).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app/frontend && npx vitest run tests/merged_center.test.tsx`
Expected: FAIL — no `guided-content-ok`/`guided-content-reject`/`now-playing-badge`.

- [ ] **Step 3: Implement**

In `MergedCenterPanel.tsx`:

1. Add LABELS: `ok: { ja: 'OK（この内容で走行）', en: 'OK — play while driving' }`, `nowPlaying: { ja: '♪ 再生中', en: '♪ Now playing' }`. Reuse `declineMonotony` for the content Reject label.
2. Compute `isAfterRest`:
```ts
const isAfterRest = journeyStage === 'after_rest_before_restart'
```
(`journeyStage` already exists at line ~152.)
3. In the guided overlay's content branch (the `<ol data-testid="guided-song-list">` block), after the list, add OK/Reject for a moving (`!isAfterRest`) conversation:
```tsx
{guided.step === 'content' && !isAfterRest && (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '6px' }}>
    <button
      type="button"
      data-testid="guided-content-ok"
      disabled={submittingRest}
      onClick={() => {
        setDismissedOpportunityId(opportunity?.opportunity_id ?? null)
        coordinator.acceptContentAndResume(overlay.activeServiceId ?? '', opportunity?.opportunity_id ?? '')
      }}
      style={spotButtonStyle}
    >
      {t(LABELS.ok, lang)}
    </button>
    <button
      type="button"
      data-testid="guided-content-reject"
      disabled={submittingRest}
      onClick={() => void handleReject()}
      style={rejectButtonStyle}
    >
      {t(LABELS.declineMonotony, lang)}
    </button>
  </div>
)}
```
4. Keep the existing `isMonotonyFire` service-step decline button so a monotony fire can be rejected at the SERVICE step too. (No change needed there; it already renders for `isMonotonyFire`. To also allow rejecting a pre-rest music proposal at the service step, leave as-is for now — spec §2 focuses on monotony + content-step reject; the service-step reject for monotony already exists.)
5. Add the now-playing badge inside the map's `position:relative` container (near `RecoveryVisual`), shown while a badge is set and the car is moving:
```tsx
{state.nowPlaying != null && state.latestTrigger?.motion_state !== 'STOPPED' && (
  <div data-testid="now-playing-badge" style={nowPlayingBadgeStyle}>
    <span style={{ fontSize: '1.15em' }}>♪</span>
    <span>{t(LABELS.nowPlaying, lang)}</span>
  </div>
)}
```
6. Add the style (mirrors `RecoveryVisualization`'s wakefulness badge):
```ts
const nowPlayingBadgeStyle: React.CSSProperties = {
  position: 'absolute', top: '12px', left: '12px', background: 'rgba(0,0,0,0.62)',
  borderRadius: '20px', padding: '7px 16px', color: '#ffe066', fontSize: '0.95em',
  fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', zIndex: 25,
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app/frontend && npx vitest run tests/merged_center.test.tsx`
Expected: PASS. Now fix the pre-existing `'closes the song list when Continue is pressed'` test (line ~1110): replace the `fireEvent.click(screen.getByTestId('merged-play-button'))` with `fireEvent.click(screen.getByTestId('guided-content-ok'))` and wrap in the extra `await Promise.resolve()` pair. Rerun until green.

- [ ] **Step 5: Commit** (SKIP — report complete)

```bash
git add app/frontend/src/components/merged/MergedCenterPanel.tsx app/frontend/tests/merged_center.test.tsx
git commit -m "feat(merged): content OK/Reject + now-playing badge for moving conversations"
```

---

### Task 6: `MergedCenterPanel` — after-rest conversation reopens + "Continue driving"

**Files:**
- Modify: `app/frontend/src/components/merged/MergedCenterPanel.tsx`
- Test: `app/frontend/tests/merged_center.test.tsx`

**Interfaces:**
- Consumes: `guidedState` after-rest inputs (Task 1), `coordinator.continueDriving` (Task 3).
- Produces DOM: for an `after_rest_before_restart` proposal, the guided service→content overlay reopens (car stopped); after the reviewer resolves it (an after-rest OK/Reject), a `guided-continue-driving` button appears; clicking it calls `continueDriving()` and hides the overlay.

- [ ] **Step 1: Write the failing tests**

Append to `app/frontend/tests/merged_center.test.tsx`:

```ts
describe('MergedCenterPanel — after-rest conversation + Continue driving', () => {
  function afterRestLog(suffix: string, active: string | null) {
    return baseProposalLog({
      opportunity: { opportunity_id: `opp-post-${suffix}`, trigger_purpose: 'inattentive_driving_prevention_recovery',
        lifecycle_stage: 'after_rest_before_restart' } as never,
      journey_state: { lifecycle_stage: 'after_rest_before_restart', motion_state: 'stopped',
        active_service_id: active, active_plan_id: active ? 'plan_1' : null },
      evidence: active ? [serviceEvidence(), contentEvidence()] : [serviceEvidence()],
    })
  }

  async function driveToAfterRest(suffix: string) {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: `mrun_${suffix}`, trigger_run_id: `run_${suffix}` })
    // The post-rest proposal arrives on a stopped, paused tick (backend recompute).
    vi.mocked(tickMergedRun).mockResolvedValue({
      trigger: { decision: restProposalDecision, error: null, paused: true, completed: false,
        tick_index: 80, route_fraction: 0.8, distance_km: null, speed_kph: 0, motion_state: 'STOPPED',
        recovery_phase: null, is_traffic_jam: false, segment_type: 'highway' },
      proposal: afterRestLog(suffix, null), correlation: null,
    })
    vi.mocked(mergedProposalAction).mockResolvedValue(afterRestLog(suffix, 'music_playlist'))
    const coordinatorRef = renderCenterPanel()
    await act(async () => {
      await coordinatorRef.current!.create({ trigger_plan_id: 'plan_1', world: {} as never,
        service_package_id: 'mock_service_selector_v1', content_package_id: 'mock_content_selector_v1', run_seed: '7' })
    })
    await act(async () => { await coordinatorRef.current!.step() })
    return coordinatorRef
  }

  it('reopens the service step for the post-rest proposal (car stopped)', async () => {
    await driveToAfterRest('ar1')
    const guided = screen.getByTestId('guided-overlay')
    expect(guided.textContent).toContain('Service proposal')
    expect(screen.getByTestId('guided-choose-music_playlist')).toBeInTheDocument()
  })

  it('after resolving the post-rest content, shows Continue driving; clicking it resumes', async () => {
    const coordinatorRef = await driveToAfterRest('ar2')
    await act(async () => { fireEvent.click(screen.getByTestId('guided-choose-music_playlist')) })
    // On the content step, an after-rest OK resolves the conversation.
    await act(async () => { fireEvent.click(screen.getByTestId('guided-content-ok')) })
    const cont = screen.getByTestId('guided-continue-driving')
    expect(cont).toBeInTheDocument()
    const playSpy = vi.spyOn(coordinatorRef.current!, 'continueDriving')
    await act(async () => {
      fireEvent.click(screen.getByTestId('guided-continue-driving'))
      await Promise.resolve(); await Promise.resolve()
    })
    // The overlay is gone (conversation done) after Continue driving.
    expect(screen.queryByTestId('guided-continue-driving')).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app/frontend && npx vitest run tests/merged_center.test.tsx`
Expected: FAIL — after-rest overlay stays `done` (suppressed) and no `guided-continue-driving`.

- [ ] **Step 3: Implement**

In `MergedCenterPanel.tsx`:

1. Add two per-opportunity state fields near the other `useState` hooks:
```ts
// The after-rest opportunity the reviewer has RESOLVED (OK/Reject) — shows the
// on-map "Continue driving" (car is stopped), instead of auto-resuming.
const [afterRestResolvedOpportunityId, setAfterRestResolvedOpportunityId] = useState<string | null>(null)
// The after-rest opportunity whose "Continue driving" was pressed — ends it.
const [afterRestContinuedOpportunityId, setAfterRestContinuedOpportunityId] = useState<string | null>(null)
```
2. Feed the new signals into `guidedState`:
```ts
const afterRestResolved =
  opportunity?.opportunity_id != null && opportunity.opportunity_id === afterRestResolvedOpportunityId
const afterRestContinued =
  opportunity?.opportunity_id != null && opportunity.opportunity_id === afterRestContinuedOpportunityId
const guided = guidedState({
  proposalLog: state.proposalLog,
  restDecided,
  serviceChosen,
  hasContentPlan: overlay.contentPlan != null,
  conversationOver,
  isAfterRest,
  afterRestResolved,
  afterRestContinued,
})
```
3. In the content branch, the OK/Reject for an AFTER-REST conversation resolves (does not resume). Extend the content-step buttons so they branch on `isAfterRest`:
```tsx
{guided.step === 'content' && (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '6px' }}>
    <button
      type="button"
      data-testid="guided-content-ok"
      disabled={submittingRest}
      onClick={() => {
        if (isAfterRest) {
          setAfterRestResolvedOpportunityId(opportunity?.opportunity_id ?? null)
        } else {
          setDismissedOpportunityId(opportunity?.opportunity_id ?? null)
          coordinator.acceptContentAndResume(overlay.activeServiceId ?? '', opportunity?.opportunity_id ?? '')
        }
      }}
      style={spotButtonStyle}
    >
      {t(LABELS.ok, lang)}
    </button>
    <button
      type="button"
      data-testid="guided-content-reject"
      disabled={submittingRest}
      onClick={() => {
        if (isAfterRest) {
          setAfterRestResolvedOpportunityId(opportunity?.opportunity_id ?? null)
        } else {
          void handleReject()
        }
      }}
      style={rejectButtonStyle}
    >
      {t(LABELS.declineMonotony, lang)}
    </button>
  </div>
)}
```
4. Render the "Continue driving" button when `guided.step === 'awaitingContinue'`. Add it inside the map's `position:relative` container as its own overlay card (so it shows even though the guided service/content overlay is gone):
```tsx
{guided.step === 'awaitingContinue' && (
  <div data-testid="guided-continue-driving-overlay" style={restOverlayStyle}>
    <p style={{ fontSize: '0.82em', color: '#334155', margin: '0 0 8px' }}>{t(LABELS.postRestDone, lang)}</p>
    <button
      type="button"
      data-testid="guided-continue-driving"
      onClick={() => {
        setAfterRestContinuedOpportunityId(opportunity?.opportunity_id ?? null)
        coordinator.continueDriving()
      }}
      style={spotButtonStyle}
    >
      {t(LABELS.continueDriving, lang)}
    </button>
  </div>
)}
```
5. Add LABELS: `continueDriving: { ja: '▶ 走行を再開', en: '▶ Continue driving' }`, `postRestDone: { ja: '休憩後の提案を確認しました。走行を再開します。', en: 'Post-rest proposal reviewed. Ready to continue.' }`.
6. Ensure `guidedActive` (used by Task 4's `proposalOnScreen`) counts `awaitingContinue` as active — it does, since `guided.step !== 'done'`.
7. In `handleReset`, also clear the two new ids:
```ts
setAfterRestResolvedOpportunityId(null)
setAfterRestContinuedOpportunityId(null)
```

- [ ] **Step 4: Run the full merged suite to verify green**

Run: `cd app/frontend && npx vitest run tests/merged_center.test.tsx tests/guided_steps.test.ts tests/merged_coordinator.test.tsx tests/merged_rest_journey.test.tsx tests/merged_overlays.test.tsx`
Expected: PASS. Fix any regressions in `merged_rest_journey`/`merged_overlays` caused by the removed Step button or the moved dismissal (update those tests to the new controls; do not weaken assertions).

- [ ] **Step 5: Commit** (SKIP — report complete)

```bash
git add app/frontend/src/components/merged/MergedCenterPanel.tsx app/frontend/tests/merged_center.test.tsx
git commit -m "feat(merged): after-rest conversation reopens with Continue driving"
```

---

### Task 7: Full frontend suite + typecheck

**Files:** none (verification only).

- [ ] **Step 1: Run the whole frontend test suite**

Run: `cd app/frontend && npx vitest run`
Expected: PASS (or only pre-existing unrelated failures — compare against the baseline; the merged suite must be green).

- [ ] **Step 2: Typecheck**

Run: `cd app/frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Report** the final state (green suite, typecheck clean) and STOP — do not commit. The human batches all app/ changes into one commit and later mirrors to htmlapp.

---

## Self-Review

**Spec coverage:**
- §Decision 1 (two pauses, remove Step) → Task 2 (`pausedByUser`) + Task 4 (remove Step, gate Continue). ✓
- §Decision 2 (moving auto-resume, stopped needs Continue driving) → Task 5 (moving OK→resume) + Task 6 (`awaitingContinue`/Continue driving). ✓
- §Decision 3 (now-playing badge, wakefulness style) → Task 3 (`nowPlaying`) + Task 5 (badge). ✓
- §Decision 4 (post-rest reuses conversation) → Task 1 (`isAfterRest` reopen) + Task 6. ✓
- §Decision 5 (reject = dismiss + auto-resume) → Task 5 (content reject → declineRest; service-step monotony decline pre-existing). ✓
- §Risks (never-stranded fallback) → Task 4 `showContinue` fallback. ✓
- §Risks (per-opportunity bookkeeping) → Task 6 reuses opportunity-id-keyed state. ✓
- §Risks (sleep screen vs overlay overlap) → after-rest overlay only renders when a post-rest proposal is present and `RecoveryVisual` renders on `recovery_phase`; the recompute tick clears recovery, so they do not overlap. Covered by Task 6's stopped/paused fixture (recovery_phase null). ✓

**Placeholder scan:** No TBD/TODO; every code step has concrete code. ✓

**Type consistency:** `pausedByUser: boolean`, `nowPlaying: {serviceId, opportunityId} | null`, `acceptContentAndResume(serviceId, opportunityId)`, `continueDriving()`, `GuidedStep` adds `awaitingContinue`, `guidedState` adds `isAfterRest`/`afterRestResolved`/`afterRestContinued` — used consistently across Tasks 1/3/5/6. Test IDs consistent: `guided-content-ok`, `guided-content-reject`, `now-playing-badge`, `guided-continue-driving`. ✓
