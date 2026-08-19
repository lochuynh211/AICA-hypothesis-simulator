import { describe, it, expect, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { ensureRegistry } from '../src/data/registry'
import { seedDefaults, type EvidenceEvent } from '../src/storage/db'
import { resetDispatchState } from '../src/engine/worker/dispatch'
import { clearDraftRegistry } from '../src/engine/run_plan'
import { clearRegistry, tick as tickTriggerRun, appendFeedback as runManagerAppendFeedback } from '../src/engine/run_manager'
import type { FeedbackEvent } from '../src/api/types'
import { worldSeedStore } from '../src/engine/proposal/stores'
import { createMergedPlan, createMergedRun, type CreateMergedPlanBody, type CreateMergedRunBody } from '../src/engine/merged/run_setup'
import { getHandle, saveHandle } from '../src/storage/merged_runs_store'
import { runsStore } from '../src/storage/runs_store'
import { ProposalHttpError } from '../src/engine/proposal/orchestrator/create_run'
import {
  postReviewFeedbackEndpoint,
  getReviewFeedbackEndpoint,
  type ReviewFeedbackBody,
} from '../src/engine/merged/review_feedback'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'

/**
 * Conformance test for `src/engine/merged/review_feedback.ts` — the port of
 * `post_review_feedback_endpoint` (routers/merged_runs.py:1327-1366) and
 * `get_review_feedback_endpoint` (1366-1415) — feature 026 (htmlapp
 * Combined export), slice C4 Task 8. See `review_feedback.ts`'s own module
 * doc for the full control-flow enumeration, the `append_feedback` two-tier
 * design, the `.get`/truthiness audit, and the hazard pass.
 *
 * Fixture: `src/engine/__fixtures__/parity/merged_review_feedback.json`,
 * captured by `scripts/gen/capture_all.py#_capture_merged_review_feedback`
 * — same package/scenario/seed combo `merged_tick.json`/`merged_actions
 * .json` use (`nri_fatigue_score_v1` x `uc01_fatigue_recovery_v0_1`,
 * `seed-night-highway-oshi`).
 *
 * ── Branch coverage table (per the task brief's reporting rule) ────────────
 *
 * `postReviewFeedbackEndpoint`: golden-covered — `merged_run_not_found`
 *   (404, exact), `trigger_run_not_found` (404, semantic — golden scrubs
 *   the real bogus id; this test rebuilds the same message shape against
 *   its OWN known id), the append-only two-judgement sequence (exact, both
 *   `scope="review_input"` WITH `feature_id` and `scope="review_decision"`
 *   WITHOUT — both feedback verbs/scopes this endpoint accepts). NOT
 *   golden-covered (disclosed, TS-only): `appendFeedbackAnyRun`'s tier-2
 *   (on-disk, not-currently-active) SUCCESS path — the golden's own
 *   `trigger_run_not_found` case proves tier-2 FAILS for a trigger_run_id
 *   that was never created in EITHER tier, but does not exercise tier-2
 *   actually landing an append for a REAL run whose in-memory registry
 *   entry was merely cleared (e.g. a page reload) — genuinely reachable in
 *   THIS offline SPA (see `review_feedback.ts`'s own module doc), tested
 *   directly below with a real `runsStore.getEvents` read-back proving the
 *   event physically landed in the persisted store, not merely that the
 *   call didn't throw.
 * `getReviewFeedbackEndpoint`: golden-covered — `merged_run_not_found`
 *   (404, exact), `get_before_any_feedback_empty_events` (`events: []`,
 *   NOT a 404, `package_versions.trigger` populated from the run's own
 *   snapshot), the two-judgement read-back (exact, same order as posted,
 *   `package_versions` for all three of trigger/service/content). A
 *   MISSING trigger log (as opposed to a never-created one) has no
 *   dedicated golden case — `tryResolveRunLog`'s own `null` return mirrors
 *   `get_before_any_feedback_empty_events`'s reachable shape either way, so
 *   this is not a distinct observable branch worth a second capture.
 *
 * ── Append-only discipline (per the brief's own instruction) ───────────────
 *
 * `two_review_judgements_appended_in_order describe block below asserts
 * DIRECTLY, not merely "the result looks right": a DEEP COPY of the run's
 * event list is taken BEFORE each POST (the IN-PLACE MUTATION TRAP guard —
 * `assembleRunLog`/`resolveRunLog` never mutate a shared object in place
 * here, since no `ProposalRunCache` is ever threaded through this file, but
 * the deep-copy-before discipline is applied anyway, as a direct proof
 * rather than an assumption), then AFTER the second POST: `events.length
 * === before.length + 1`, `events.slice(0, before.length)` deep-equals the
 * BEFORE snapshot (the first judgement is untouched), and the new tail
 * entry is exactly the second judgement — proving append, not rewrite, at
 * the underlying trigger-run event-log level (not just "the GET response
 * looks right").
 */

ensureRegistry()

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  resetDispatchState()
  await seedDefaults()
  clearDraftRegistry()
  clearRegistry()
})

const PACKAGE_ID = 'nri_fatigue_score_v1'
const SCENARIO_ID = 'uc01_fatigue_recovery_v0_1'
const SEED_ID = 'seed-night-highway-oshi'
const SERVICE_PKG_ID = 'aica_transparent_service_selector_v1'
const CONTENT_PKG_ID = 'aica_transparent_content_selector_v1'
const TRIGGER_RUN_SEED = 42
const PROPOSAL_RUN_SEED = '7'

function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function baseWorld(): Record<string, unknown> {
  const seed = worldSeedStore.getSeed(SEED_ID)
  if (!seed) throw new Error(`fixture seed not found: ${SEED_ID}`)
  return deepCopy(seed.world as Record<string, unknown>)
}

async function setupMergedRun(): Promise<{ mergedRunId: string; triggerRunId: string }> {
  const planBody: CreateMergedPlanBody = {
    package_id: PACKAGE_ID, scenario_id: SCENARIO_ID, route_preset_id: null,
    route_facts: null, route_source: null,
    run_seed: TRIGGER_RUN_SEED, mountain_range_km: null, jam_range_km: null,
    jam_speed_kph: 15.0, presets: {}, parameters: {}, hyperparameters: {},
    profiles: null, initial_state: null, context_overrides: null,
  }
  const plan = await createMergedPlan(planBody)
  const runBody: CreateMergedRunBody = {
    trigger_plan_id: plan.plan_id, world: baseWorld(),
    service_package_id: SERVICE_PKG_ID, content_package_id: CONTENT_PKG_ID,
    proposal_mode: 'interactive', run_seed: PROPOSAL_RUN_SEED,
    service_parameters: {}, service_hyperparameters: {}, content_parameters: {}, content_hyperparameters: {},
  }
  const run = await createMergedRun(runBody)
  return { mergedRunId: run.merged_run_id, triggerRunId: run.trigger_run_id }
}

const { output } = loadFixture('merged_review_feedback')

// ---------------------------------------------------------------------------
// postReviewFeedbackEndpoint / getReviewFeedbackEndpoint — golden parity
// ---------------------------------------------------------------------------

describe('postReviewFeedbackEndpoint / getReviewFeedbackEndpoint — 404 paths', () => {
  it('merged_run_not_found_post — byte-exact', async () => {
    const golden = output.merged_run_not_found_post
    const body: ReviewFeedbackBody = {
      scope: 'review_decision', case_id: 'c1', checkpoint_id: 'cp1', stage: 'trigger', review_target: 'decision',
    }
    let thrown: unknown
    try {
      await postReviewFeedbackEndpoint('mrun_bogus_id', body)
      expect.unreachable()
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(ProposalHttpError)
    expect((thrown as ProposalHttpError).status).toBe(golden.status_code)
    expect((thrown as ProposalHttpError).detail).toBe(golden.detail)
  })

  it('merged_run_not_found_get — byte-exact', async () => {
    const golden = output.merged_run_not_found_get
    let thrown: unknown
    try {
      await getReviewFeedbackEndpoint('mrun_bogus_id')
      expect.unreachable()
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(ProposalHttpError)
    expect((thrown as ProposalHttpError).status).toBe(golden.status_code)
    expect((thrown as ProposalHttpError).detail).toBe(golden.detail)
  })

  it('trigger_run_not_found_post — a real merged run whose HANDLE is overwritten with a trigger_run_id that was never created in EITHER tier', async () => {
    const golden = output.trigger_run_not_found_post
    const { mergedRunId } = await setupMergedRun()
    const handle = await getHandle(mergedRunId)
    if (!handle) throw new Error('handle not found')
    const bogusTriggerId = 'run_bogus_never_created_000000'
    handle.trigger_run_id = bogusTriggerId
    await saveHandle(handle)

    const body: ReviewFeedbackBody = {
      scope: 'review_decision', case_id: 'c1', checkpoint_id: 'cp1', stage: 'trigger', review_target: 'decision',
    }
    let thrown: unknown
    try {
      await postReviewFeedbackEndpoint(mergedRunId, body)
      expect.unreachable()
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(ProposalHttpError)
    expect((thrown as ProposalHttpError).status).toBe(golden.status_code)
    // Golden scrubs the real (Python-side, wall-clock+random) trigger_run_id
    // to a fixed placeholder -- rebuild the SAME message shape against this
    // test's OWN known bogus id rather than comparing byte-for-byte against
    // an id that can never match.
    const expectedDetail = (golden.detail as string).replace('<TRIGGER_RUN_ID>', bogusTriggerId)
    expect((thrown as ProposalHttpError).detail).toBe(expectedDetail)
  })
})

describe('getReviewFeedbackEndpoint — before any feedback', () => {
  it('get_before_any_feedback_empty_events — events: [], NOT a 404, package_versions populated', async () => {
    const golden = output.get_before_any_feedback_empty_events
    const { mergedRunId } = await setupMergedRun()
    const result = await getReviewFeedbackEndpoint(mergedRunId)
    expectParity(result, golden.result)
  })
})

describe('postReviewFeedbackEndpoint + getReviewFeedbackEndpoint — append-only, both feedback verbs, byte-exact', () => {
  it('two_review_judgements_appended_in_order — review_input (with feature_id) then review_decision (no feature_id), same order, package_versions attached', async () => {
    const golden = output.two_review_judgements_appended_in_order
    const { mergedRunId, triggerRunId } = await setupMergedRun()

    // IN-PLACE MUTATION TRAP guard: snapshot BEFORE the first mutating call,
    // deep-copied, not merely referenced.
    const beforeAnyPost = deepCopy(await runsStore.getEvents(triggerRunId))

    const post1 = await postReviewFeedbackEndpoint(mergedRunId, {
      scope: 'review_input', case_id: 'case-1', checkpoint_id: 'cp-trigger',
      stage: 'trigger', review_target: 'feature', feature_id: 'continuousDrivingMin',
      labels: { agreement: 'agree' }, comment: 'looks right',
    })
    expectParity(post1, golden.post_1)

    // Deep copy AFTER the first call, BEFORE the second -- proves the FIRST
    // judgement is untouched by the SECOND append, not just "length grew".
    const afterFirstPost = deepCopy(await runsStore.getEvents(triggerRunId))

    const post2 = await postReviewFeedbackEndpoint(mergedRunId, {
      scope: 'review_decision', case_id: 'case-1', checkpoint_id: 'cp-trigger',
      stage: 'trigger', review_target: 'decision',
      labels: { overall_judgment: 'good_trigger' }, comment: null,
    })
    expectParity(post2, golden.post_2)

    const afterSecondPost = await runsStore.getEvents(triggerRunId)

    // Append-only, proven directly against the underlying event log:
    expect(afterFirstPost.length).toBe(beforeAnyPost.length + 1)
    expect(afterSecondPost.length).toBe(afterFirstPost.length + 1)
    // Everything present before the second call is STILL present, in the
    // SAME order, byte-for-byte -- not merely "the result looks right".
    const afterSecondPrefix = afterSecondPost.slice(0, afterFirstPost.length).map((e) => {
      const { seq: _seq, runId: _runId, ...rest } = e as EvidenceEvent & { runId: string }
      return rest
    })
    const afterFirstStripped = afterFirstPost.map((e) => {
      const { seq: _seq, runId: _runId, ...rest } = e as EvidenceEvent & { runId: string }
      return rest
    })
    expect(afterSecondPrefix).toEqual(afterFirstStripped)

    const getAfter = await getReviewFeedbackEndpoint(mergedRunId)
    expectParity(getAfter, golden.get_after)
    expect(getAfter.events.length).toBe(2)
    expect(getAfter.events[0].target.scope).toBe('review_input')
    expect(getAfter.events[1].target.scope).toBe('review_decision')
  })
})

// ---------------------------------------------------------------------------
// appendFeedbackAnyRun's tier-2 (on-disk, not-active) SUCCESS path -- no
// Python golden captures this specific "succeeds via fallback" shape (the
// golden's own trigger_run_not_found case proves the FAILURE shape when
// NEITHER tier has it); tested directly here because it is a REAL,
// reachable path in this offline SPA (a page reload empties the in-memory
// registry while IndexedDB persistence survives) -- see review_feedback
// .ts's own module doc.
// ---------------------------------------------------------------------------

describe('postReviewFeedbackEndpoint — tier-2 (on-disk) fallback, real success (not merely "does not throw")', () => {
  it('a run whose in-memory registry entry is cleared (e.g. a page reload) still accepts feedback via the persisted store, and the event is physically readable back from runsStore', async () => {
    const { mergedRunId, triggerRunId } = await setupMergedRun()

    // Mirrors a page reload: the in-memory active registry is gone, but
    // IndexedDB (this run's already-persisted header + zero events) is not.
    clearRegistry()

    const before = deepCopy(await runsStore.getEvents(triggerRunId))
    expect(before.length).toBe(0) // sanity: nothing appended yet

    const event = await postReviewFeedbackEndpoint(mergedRunId, {
      scope: 'review_decision', case_id: 'tier2-case', checkpoint_id: 'cp1',
      stage: 'trigger', review_target: 'decision', labels: {}, comment: null,
    })
    expect(event.target.scope).toBe('review_decision')

    const after = await runsStore.getEvents(triggerRunId)
    expect(after.length).toBe(1)
    expect((after[0] as unknown as { kind: string }).kind).toBe('feedback')
    expect((after[0] as unknown as { target: { case_id: string } }).target.case_id).toBe('tier2-case')

    // GET (also a fresh, non-active read) sees it too.
    const getResult = await getReviewFeedbackEndpoint(mergedRunId)
    expect(getResult.events.length).toBe(1)
    expect(getResult.events[0].target.case_id).toBe('tier2-case')
  })

  it('a trigger_run_id that exists in NEITHER tier (bogus, never created at all) throws RunNotFoundError-derived 404 -- mirrors the golden trigger_run_not_found_post shape structurally', async () => {
    const { mergedRunId } = await setupMergedRun()
    const handle = await getHandle(mergedRunId)
    if (!handle) throw new Error('handle not found')
    handle.trigger_run_id = 'run_genuinely_never_existed'
    await saveHandle(handle)

    await expect(
      postReviewFeedbackEndpoint(mergedRunId, {
        scope: 'review_decision', case_id: 'c', checkpoint_id: 'cp', stage: 'trigger', review_target: 'decision',
      }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('tier-2 fallback preserves append ORDER across two separate not-active posts (proves the seq computation, not just a single append)', async () => {
    const { mergedRunId, triggerRunId } = await setupMergedRun()

    clearRegistry()
    await postReviewFeedbackEndpoint(mergedRunId, {
      scope: 'review_input', case_id: 'first', checkpoint_id: 'cp1', stage: 'trigger',
      review_target: 'feature', feature_id: 'x', labels: {}, comment: null,
    })
    clearRegistry() // simulate a SECOND reload between the two posts
    await postReviewFeedbackEndpoint(mergedRunId, {
      scope: 'review_decision', case_id: 'second', checkpoint_id: 'cp1', stage: 'trigger',
      review_target: 'decision', labels: {}, comment: null,
    })

    const events = await runsStore.getEvents(triggerRunId)
    expect(events.length).toBe(2)
    expect((events[0] as unknown as { target: { case_id: string } }).target.case_id).toBe('first')
    expect((events[1] as unknown as { target: { case_id: string } }).target.case_id).toBe('second')
  })
})

// ---------------------------------------------------------------------------
// getReviewFeedbackEndpoint's own compound filter
// (`kind === 'feedback' && scope.startsWith('review_')`) -- BOTH halves
// exercised directly, not merely implied by their absence from the run log.
// ---------------------------------------------------------------------------

describe('getReviewFeedbackEndpoint — filter excludes non-feedback events AND non-review-scoped feedback', () => {
  it('a TickEvent (kind != "feedback") and a pre-existing scope="run" FeedbackEvent (kind == "feedback" but NOT review-scoped) are both excluded; only the review_input judgement is returned', async () => {
    const { mergedRunId, triggerRunId } = await setupMergedRun()

    // A real TickEvent -- kind="tick", must fail the first half of the guard.
    await tickTriggerRun(triggerRunId)

    // A real, ORIGINAL M5-style feedback event (scope="run") -- kind ==
    // "feedback" but does NOT start with "review_", must fail the SECOND
    // half of the guard independently of the first.
    const nonReviewEvent: FeedbackEvent = {
      kind: 'feedback',
      target: { scope: 'run' },
      labels: { proposal_timing: 'appropriate' },
      comment: 'ordinary M5 feedback, not a review judgement',
    }
    await runManagerAppendFeedback(triggerRunId, nonReviewEvent)

    const post = await postReviewFeedbackEndpoint(mergedRunId, {
      scope: 'review_input', case_id: 'only-this-one', checkpoint_id: 'cp1',
      stage: 'trigger', review_target: 'feature', feature_id: 'x', labels: {}, comment: null,
    })

    const result = await getReviewFeedbackEndpoint(mergedRunId)
    expect(result.events.length).toBe(1)
    expect(result.events[0]).toEqual(post)
    expect(result.events[0].target.scope).toBe('review_input')
    expect(result.events[0].target.case_id).toBe('only-this-one')
  })

  // MUTATION-TESTING FINDING: a first draft of this file relied on the test
  // above alone to cover the `kind !== 'feedback'` half of the guard. It
  // did not: a real TickEvent has no `.target` field at all, so
  // `pyGetDefault(raw, 'target', null)` already returns `null` -> `{}` ->
  // `scope === ''` -> rejected by the SECOND half of the guard regardless
  // of the first. Mutating `kind !== 'feedback'` to `false` (never reject
  // on kind) left all 9 tests green -- the DATA was masking the mutation,
  // not the assertion being wrong. This case hand-constructs a malformed
  // event that HAS a review-scoped target but a non-"feedback" kind,
  // injected directly into the store (bypassing the normal typed append
  // API, the only way to construct this shape at all -- no real code path
  // in either language ever produces it) to pin the kind check
  // independently. Re-ran the same mutation afterward: 1 of 10 tests now
  // fails (this one), 9 still pass.
  it('a malformed event with a review-scoped target but kind != "feedback" is excluded (pins the kind check independently of the scope check)', async () => {
    const { mergedRunId, triggerRunId } = await setupMergedRun()

    const malformed = {
      kind: 'not_a_feedback_kind',
      target: {
        scope: 'review_input', case_id: 'should-not-appear', checkpoint_id: 'cp',
        stage: 'trigger', review_target: 'feature', feature_id: 'x',
      },
      labels: {},
      comment: null,
    }
    const existing = await runsStore.getEvents(triggerRunId)
    await runsStore.appendEvent(triggerRunId, existing.length, malformed as unknown as EvidenceEvent)
    // The direct `runsStore.appendEvent` write bypasses the ACTIVE
    // in-memory registry entirely (it never touches `entry.events`) --
    // `clearRegistry()` forces both the POST (via `appendFeedbackAnyRun`'s
    // own tier-2) and the GET (via `resolveRunLog`'s disk branch) to read
    // from the PERSISTED store, where the injected event is actually
    // visible. Without this, `getActiveRunLog` would keep serving the
    // STALE in-memory (still-active) events list and this test would pass
    // for the wrong reason (the malformed event invisible to BOTH the real
    // code and a mutated version alike) -- caught live while mutation-
    // testing this exact case (see this describe block's own comment on
    // the sibling test above).
    clearRegistry()

    const post = await postReviewFeedbackEndpoint(mergedRunId, {
      scope: 'review_decision', case_id: 'the-real-one', checkpoint_id: 'cp1',
      stage: 'trigger', review_target: 'decision', labels: {}, comment: null,
    })

    const result = await getReviewFeedbackEndpoint(mergedRunId)
    expect(result.events.length).toBe(1)
    expect(result.events[0]).toEqual(post)
    expect(result.events[0].target.case_id).toBe('the-real-one')
  })
})
