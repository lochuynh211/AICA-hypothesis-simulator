import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { ensureRegistry } from '../src/data/registry'
import { seedDefaults } from '../src/storage/db'
import { resetDispatchState } from '../src/engine/worker/dispatch'
import { clearDraftRegistry } from '../src/engine/run_plan'
import { clearRegistry } from '../src/engine/run_manager'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import { worldSeedStore } from '../src/engine/proposal/stores'
import { proposalRunsStore } from '../src/storage/proposal_runs_store'
import { runsStore } from '../src/storage/runs_store'
import { listHandles } from '../src/storage/merged_runs_store'
import {
  project,
  projectFire,
  buildMergedRestOptions,
  withTickSeconds,
  readableErrorText,
  readableValidationText,
} from '../src/engine/merged/quickview'
import * as previewTicksModule from '../src/engine/services/preview_ticks'
import * as createRunModule from '../src/engine/proposal/orchestrator/create_run'
import type { MergedQuickviewBody } from '../src/engine/merged/types'
import type { PreviewFireEvent, PreviewLoopRestOption, PreviewLoopResult } from '../src/engine/services/preview_ticks'
import type { TickState } from '../src/engine/tick_engine'
import type { DecisionResult, PreviewError } from '../src/api/types'

/**
 * Conformance test for `src/engine/merged/quickview.ts` — the port of
 * `services/merged_quickview.py` (312 LOC) — feature 026 (htmlapp Combined
 * export), slice C4 Task 4. See `quickview.ts`'s own module doc for the
 * full `.get`/hazard-8 audit, the `ValidationError`-catch structural-no-op
 * finding, and `../src/engine/services/preview_ticks.ts`'s own module doc
 * for the `iterPreviewTicks` extraction this task required beyond the
 * brief's stated file list (a same-task scope finding, disclosed in
 * task-4-report.md).
 *
 * Fixture: `src/engine/__fixtures__/parity/merged_quickview.json`, captured
 * by `scripts/gen/capture_all.py#_capture_merged_quickview` via the REAL
 * `POST /api/merged-runs/quickview` endpoint (never a hand-rolled stand-in)
 * — `(nri_fatigue_score_v1, uc01_fatigue_recovery_v0_1, run_seed=42)`, the
 * SAME combo `preview.json`'s own second case already captures, chosen
 * because it is a known-deterministic run producing 3 fires across BOTH
 * mapped categories (monotony, rest, monotony) plus one auto-accepted rest
 * that reaches a stopped recovery tick — exercising `_project_fire`'s
 * proposal-set path 3x and `_project_after_rest`'s proposal-set path once,
 * in the SAME run. A second captured case reuses the identical body with an
 * unknown `service_package_id`, capturing the proposal_error-set path on a
 * REAL fire (the endpoint itself still returns 200 — the error is caught
 * INSIDE `_project_fire`/`_project_after_rest`, never surfaced as an
 * endpoint-level 4xx).
 *
 * ── Branch coverage table (per the task brief's reporting rule) ────────────
 * `mapTriggerPurpose` mapped vs unmapped (invariant 3's three-state
 *   encoding): mapped+success via `fires_and_after_rest_proposal_all_success`;
 *   mapped+error via `fires_proposal_error_unknown_service_package_id`;
 *   unmapped (both null) via a SYNTHETIC `PreviewFireEvent`
 *   (`result_type: 'SUPPRESSED'`/`'NO_PROPOSAL'` — Task 2's own enumeration
 *   of what `mapTriggerPurpose` does not map) — no real fire ever reaches
 *   this branch (every actionable fire is REST_PROPOSAL or
 *   MONOTONY_PROPOSAL, both mapped), so this is the one branch a capture
 *   cannot reach by construction, exercised directly instead.
 * `after_rest_proposal`/`after_rest_proposal_error`'s SAME three-state
 *   pairing: proposal-set and error-set reached the same way as fires
 *   (both real captures, since the after-rest projection reuses the same
 *   `service_package_id`); "both null" has TWO distinct causes in Python
 *   (`post_tick is None` OR `result["error"] is not None`) — neither
 *   reachable from a real captured run without engineering a mid-run
 *   algorithm error after a completed recovery, so both are exercised
 *   directly against the extracted `buildMergedRestOptions` (a Task-4-local
 *   testability seam, not a Python `__all__` member — see that function's
 *   own doc comment).
 * `readableErrorText`'s 4 branches (dict-with-message, list-with-message,
 *   list-with-msg-only, bare string) plus its 2 fallback branches (empty
 *   array, dict-without-message) — reached via the two real captures
 *   (dict-with-message, through `ProposalHttpError`'s real detail shape)
 *   PLUS direct unit tests for every OTHER branch, since no real
 *   `ProposalHttpDetail` in this port's own union produces the list-shaped
 *   or fallback branches through `project()`'s actual call sites (disclosed
 *   in `quickview.ts`'s own doc comment) — "ported-to-green is not
 *   evidence," so every branch gets its own direct assertion regardless of
 *   real-call-site reachability.
 * `readableValidationText`: NO live call site at all in this port (TS
 *   object-literal construction cannot throw the way pydantic model
 *   construction can — see `quickview.ts`'s own doc comment for the full
 *   argument). All 3 of its branches (usable msg, empty errors, no usable
 *   msg) are exercised directly against a duck-typed input, matching this
 *   port's established precedent for a function with no live call site.
 * `withTickSeconds`'s 2 branches (null tickSeconds passthrough, non-null
 *   fold) both reached directly; the passthrough case additionally asserts
 *   reference equality (mirrors Python returning `presets` unchanged, not a
 *   copy) and the fold case asserts the INPUT was not mutated.
 * Hazard 4 (ordering): `fires[]` category/tick order asserted against the
 *   captured golden's own known sequence (monotony, rest, monotony);
 *   `score_series`/`progress` asserted strictly tick-index-ordered.
 * "Nothing persisted": asserted NEGATIVELY (the store stays empty), not
 *   merely that the return value looks right — see that describe block's
 *   own comment for why this is the one assertion shape that actually
 *   catches a store-polluting regression.
 */

ensureRegistry()

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  resetDispatchState()
  await seedDefaults()
  clearDraftRegistry()
  clearRegistry()
})

const SEED_ID = 'seed-night-highway-oshi'
const SERVICE_PKG_ID = 'aica_transparent_service_selector_v1'
const CONTENT_PKG_ID = 'aica_transparent_content_selector_v1'

function deepCopy<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => deepCopy(v)) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = deepCopy(v)
    return out as unknown as T
  }
  return value
}

function baseWorld(): Record<string, unknown> {
  const seed = worldSeedStore.getSeed(SEED_ID)
  if (!seed) throw new Error(`fixture seed not found: ${SEED_ID}`)
  return deepCopy(seed.world as Record<string, unknown>)
}

/** Mirrors the capture script's own `_base_body`.
 *
 * `hyperparameter_overrides: { threshold_fire: 90.0 }` (Bugfix 2026-08-04
 * follow-up): `nri_fatigue_score_v1`'s own monotony-relief bugfix (see
 * `packages/nri_fatigue_score_v1/algorithm.py`'s "Bugfix (2026-08-04)"
 * docstring) makes this scenario's auto-acknowledged monotony proposal
 * correctly relieve `cumulative_monotonous_min`, pushing the package
 * DEFAULT's `rest_required` fire past this scenario's only named rest spot
 * (so the auto-accept step finds nothing ahead, and the run drops to only 2
 * fires with zero rest_options). Lowering `threshold_fire` to 90.0 restores
 * the ORIGINAL 3-fire/1-rest-option coverage this fixture (and this test
 * file's "hazard 4" / invariant-3 assertions below) depend on, using the
 * real (fixed) algorithm — mirrors `_capture_merged_quickview`'s own
 * `_base_body` in capture_all.py. */
function baseBody(overrides: Partial<MergedQuickviewBody> = {}): MergedQuickviewBody {
  return {
    package_id: 'nri_fatigue_score_v1',
    scenario_id: 'uc01_fatigue_recovery_v0_1',
    route_preset_id: null,
    run_seed: 42,
    mountain_range_km: null,
    jam_range_km: null,
    jam_speed_kph: 15.0,
    hyperparameter_overrides: { threshold_fire: 90.0 },
    rest_option_id: null,
    context_overrides: null,
    initial_state: null,
    profiles: null,
    tick_seconds: null,
    world: baseWorld(),
    service_package_id: SERVICE_PKG_ID,
    content_package_id: CONTENT_PKG_ID,
    run_seed_proposal: 'seed-quickview-test',
    service_parameters: {},
    service_hyperparameters: {},
    content_parameters: {},
    content_hyperparameters: {},
    ...overrides,
  }
}

/** Mirrors the capture script's own generalized `_freeze_ids` — replaces
 * every embedded ProposalRunLog's freshly-minted run_id/opportunity_id/
 * created_at/event `at` with the SAME fixed literals the Python capture
 * wrote, so a structural `expectParity` against the golden is meaningful.
 * Prefix-matched (not compared against one known id) because this response
 * embeds an UNBOUNDED number of independent ProposalRunLogs. */
function freezeIds(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(freezeIds)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'created_at' || k === 'at') out[k] = '2026-01-01T00:00:00.000000Z'
      else if (k === 'run_id' && typeof val === 'string' && val.startsWith('prun_')) out[k] = 'prun_TEST_FIXED'
      else if (k === 'opportunity_id' && typeof val === 'string' && val.startsWith('op_')) out[k] = 'op_TEST_FIXED'
      else out[k] = freezeIds(val)
    }
    return out
  }
  return v
}

type GoldenCase = { name: string; status_code: number; result: Record<string, unknown> }
const { output } = loadFixture('merged_quickview') as { output: { cases: GoldenCase[] } }
const CASES: Record<string, GoldenCase> = Object.fromEntries(output.cases.map((c) => [c.name, c]))

// ---------------------------------------------------------------------------
// project — full parity against real Python
// ---------------------------------------------------------------------------

describe('project — parity against real Python (POST /api/merged-runs/quickview)', () => {
  it('fires_and_after_rest_proposal_all_success: every fire gets a proposal, the auto-accepted rest gets an after-rest proposal', async () => {
    const golden = CASES.fires_and_after_rest_proposal_all_success
    const result = await project(baseBody())
    expectParity(freezeIds(result), golden.result)
  })

  it('fires_proposal_error_unknown_service_package_id: every fire (and the after-rest proposal) gets a proposal_error, endpoint-level success', async () => {
    const golden = CASES.fires_proposal_error_unknown_service_package_id
    const result = await project(baseBody({ service_package_id: 'not_a_real_package_id' }))
    expectParity(freezeIds(result), golden.result)
  })
})

// ---------------------------------------------------------------------------
// Hazard 4 — dict/insertion order (the primary risk for this slice)
// ---------------------------------------------------------------------------

describe('hazard 4 — structural ordering', () => {
  it('fires[] preserves tick order across a non-uniform category sequence (monotony, rest, monotony)', async () => {
    const result = await project(baseBody())
    expect(result.fires.map((f) => f.category)).toEqual([
      'monotony_prevention',
      'rest_required',
      'monotony_prevention',
    ])
    expect(result.fires.map((f) => f.tick)).toEqual([12, 18, 37])
  })

  it('score_series/progress/monotony_series are tick-index ordered (strictly increasing t, no gaps or reordering)', async () => {
    const result = await project(baseBody())
    const scoreTicks = result.score_series.map((p) => p.t)
    for (let i = 1; i < scoreTicks.length; i++) expect(scoreTicks[i]).toBe(scoreTicks[i - 1] + 1)

    const progressTicks = result.progress.map((p) => p.t)
    for (let i = 1; i < progressTicks.length; i++) expect(progressTicks[i]).toBe(progressTicks[i - 1] + 1)

    const monotonyTicks = result.monotony_series.map((p) => p.t)
    for (let i = 1; i < monotonyTicks.length; i++) expect(monotonyTicks[i]).toBeGreaterThan(monotonyTicks[i - 1])
  })
})

// ---------------------------------------------------------------------------
// Invariant 1 — the singular `fire` is deliberately UNAUGMENTED
// ---------------------------------------------------------------------------

describe('invariant 1 — MergedInstantResult.fire (singular) has no proposal key while fires[0] does', () => {
  it('fire carries only the plain FirePoint fields; fires[0] additionally carries proposal/proposal_error', async () => {
    const result = await project(baseBody())
    expect(result.fire).not.toBeNull()
    expect(Object.keys(result.fire as object).sort()).toEqual(
      ['category', 'criteria', 'feature_contributions', 'strength', 'tick', 'time_min'].sort(),
    )
    expect(result.fire).not.toHaveProperty('proposal')
    expect(result.fire).not.toHaveProperty('proposal_error')

    expect(result.fires[0]).toHaveProperty('proposal')
    expect(result.fires[0]).toHaveProperty('proposal_error')
    expect(result.fires[0].proposal).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Invariant 3 (part 1) — fires[].proposal/proposal_error three-state encoding
// ---------------------------------------------------------------------------

describe('invariant 3 — proposal/proposal_error three-state encoding (fires[])', () => {
  it('state: proposal SET (mapped result_type, create_proposal_run succeeds)', async () => {
    const result = await project(baseBody())
    expect(result.fires.length).toBeGreaterThan(0)
    for (const f of result.fires) {
      expect(f.proposal).not.toBeNull()
      expect(f.proposal_error).toBeNull()
    }
  })

  it('state: proposal_error SET (mapped result_type, create_proposal_run throws)', async () => {
    const result = await project(baseBody({ service_package_id: 'not_a_real_package_id' }))
    expect(result.fires.length).toBeGreaterThan(0)
    for (const f of result.fires) {
      expect(f.proposal).toBeNull()
      expect(f.proposal_error).toBeTruthy()
    }
  })

  it('state: BOTH null (result_type SUPPRESSED — no mapped trigger_purpose)', async () => {
    // Deliberately invalid tickState/routeFacts/effectiveScenario/world:
    // if projectFire ever reached buildWorldFromTick/createProposalRun past
    // its early return, this would throw (proving the early return, not
    // merely a coincidental null result).
    const ev: PreviewFireEvent = {
      tickIndex: 0,
      tickState: undefined as unknown as TickState,
      decision: { result_type: 'SUPPRESSED' } as unknown as DecisionResult,
      elapsedMin: 0,
      routeFacts: undefined as unknown as PreviewFireEvent['routeFacts'],
      effectiveScenario: undefined as unknown as PreviewFireEvent['effectiveScenario'],
      restSpot: null,
    }
    const body = baseBody({ world: null as unknown as Record<string, unknown> })
    const [proposal, proposalError] = await projectFire(ev, body)
    expect(proposal).toBeNull()
    expect(proposalError).toBeNull()
  })

  it('state: BOTH null (result_type NO_PROPOSAL — the OTHER unmapped result_type Task 2 enumerated)', async () => {
    const ev: PreviewFireEvent = {
      tickIndex: 0,
      tickState: undefined as unknown as TickState,
      decision: { result_type: 'NO_PROPOSAL' } as unknown as DecisionResult,
      elapsedMin: 0,
      routeFacts: undefined as unknown as PreviewFireEvent['routeFacts'],
      effectiveScenario: undefined as unknown as PreviewFireEvent['effectiveScenario'],
      restSpot: null,
    }
    const body = baseBody({ world: null as unknown as Record<string, unknown> })
    const [proposal, proposalError] = await projectFire(ev, body)
    expect(proposal).toBeNull()
    expect(proposalError).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Invariant 3 (part 2) — the SAME pairing for after_rest_proposal/
// after_rest_proposal_error, via the extracted buildMergedRestOptions.
// ---------------------------------------------------------------------------

describe('invariant 3 — after_rest_proposal/after_rest_proposal_error three-state encoding (rest_options[])', () => {
  it('state: proposal SET', async () => {
    const result = await project(baseBody())
    expect(result.rest_options.length).toBeGreaterThan(0)
    expect(result.rest_options[0].after_rest_proposal).not.toBeNull()
    expect(result.rest_options[0].after_rest_proposal_error).toBeNull()
  })

  it('state: proposal_error SET', async () => {
    const result = await project(baseBody({ service_package_id: 'not_a_real_package_id' }))
    expect(result.rest_options.length).toBeGreaterThan(0)
    expect(result.rest_options[0].after_rest_proposal).toBeNull()
    expect(result.rest_options[0].after_rest_proposal_error).toBeTruthy()
  })

  it('state: BOTH null — no _post_rest_tick_state stash (rest never reached a stopped tick)', async () => {
    const opts: PreviewLoopRestOption[] = [
      { id: 'nap_x', auto_chosen: true, recovery_from_min: null, to_min: null },
    ]
    // world: null would throw if projectAfterRest were (wrongly) invoked —
    // proves the skip, not a coincidental null.
    const merged = await buildMergedRestOptions(opts, null, baseBody({ world: null as unknown as Record<string, unknown> }))
    expect(merged).toHaveLength(1)
    expect(merged[0].after_rest_proposal).toBeNull()
    expect(merged[0].after_rest_proposal_error).toBeNull()
    // The rest of the entry's fields pass through unchanged, and the
    // private stash key never leaks (there wasn't one here, but confirm
    // the OUTPUT object doesn't carry it regardless).
    expect(merged[0]).not.toHaveProperty('_post_rest_tick_state')
    expect(merged[0].id).toBe('nap_x')
  })

  it('state: BOTH null — stash present but the run ended in an algorithm error', async () => {
    const fakeTickState = {} as TickState
    const opts: PreviewLoopRestOption[] = [
      {
        id: 'nap_x',
        auto_chosen: true,
        recovery_from_min: 10,
        to_min: 20,
        _post_rest_tick_state: fakeTickState,
      },
    ]
    const runError: PreviewError = { tick_index: 5, error_type: 'algorithm_error', message: 'boom' }
    // world: null would throw if projectAfterRest were (wrongly) invoked
    // despite the stash being present — proves the error-guard, not a
    // coincidental null.
    const merged = await buildMergedRestOptions(opts, runError, baseBody({ world: null as unknown as Record<string, unknown> }))
    expect(merged).toHaveLength(1)
    expect(merged[0].after_rest_proposal).toBeNull()
    expect(merged[0].after_rest_proposal_error).toBeNull()
    expect(merged[0]).not.toHaveProperty('_post_rest_tick_state')
  })

  it('the private _post_rest_tick_state stash never reaches the output even when a real after-rest proposal IS projected', async () => {
    const result = await project(baseBody())
    for (const opt of result.rest_options) {
      expect(opt).not.toHaveProperty('_post_rest_tick_state')
    }
  })
})

// ---------------------------------------------------------------------------
// Prove nothing persisted — the payoff for C4 Task 1's cache seam.
// ---------------------------------------------------------------------------

describe('non-persisting — the defect C4 Task 1 exists to prevent', () => {
  it('project() leaves proposalRunsStore/runsStore/merged_runs_store empty, even across BOTH the success and error paths', async () => {
    // Baseline: confirm empty BEFORE running anything (a store that already
    // had rows would make the post-run assertion meaningless).
    expect(await proposalRunsStore.listHeaders()).toEqual([])
    expect(await runsStore.listHeaders()).toEqual([])
    expect(await listHandles()).toEqual([])

    await project(baseBody())
    await project(baseBody({ service_package_id: 'not_a_real_package_id' }))

    // Negative assertion — the store was NEVER WRITTEN, not merely that the
    // return value looks right. An implementation that writes to both the
    // cache and proposalRunsStore would pass every positive-only test in
    // this file while permanently polluting the user's append-only
    // evidence record with ephemeral projections.
    expect(await proposalRunsStore.listHeaders()).toEqual([])
    expect(await runsStore.listHeaders()).toEqual([])
    expect(await listHandles()).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// readableErrorText — every branch, direct assertions
// ---------------------------------------------------------------------------

describe('readableErrorText', () => {
  it('dict with a truthy message -> that message', () => {
    expect(readableErrorText({ code: 'x', message: 'human text' })).toBe('human text')
  })

  it('array of dict, first entry has message -> that message', () => {
    expect(readableErrorText([{ path: 'a', code: 'x', message: 'human text' }])).toBe('human text')
  })

  it('array of dict, first entry has ONLY msg (no message) -> msg (the "or" fallback branch)', () => {
    expect(readableErrorText([{ msg: 'validation text' }])).toBe('validation text')
  })

  it('array of dict, both message and msg present -> message wins (Python truthy `or` short-circuits on the first truthy operand)', () => {
    expect(readableErrorText([{ message: 'M', msg: 'X' }])).toBe('M')
  })

  it('bare string -> that string', () => {
    expect(readableErrorText('plain text')).toBe('plain text')
  })

  // The 3 fallback cases below assert LITERAL expected strings, not
  // `String(detail)` — an earlier draft compared against `String(detail)`
  // itself, which is tautological (it can never fail, regardless of what
  // `readableErrorText` actually returns) and would have silently hidden a
  // real, verified divergence: Python's `str([])` is the 2-character string
  // `'[]'` and `str({'code': 'x'})` is `"{'code': 'x'}"` (checked directly
  // against a live interpreter), while JS's `String([])` is `''` (empty)
  // and `String({code: 'x'})` is `'[object Object]'`. `readableErrorText`
  // mirrors Python's CONTROL FLOW (which branch fires) exactly but its
  // final `String(detail)` fallback is NOT byte-identical to Python's
  // `str(detail)` for non-primitive values — disclosed here rather than
  // silently assumed identical, and inconsequential because (per the
  // module doc's own "no reachable call site" finding) no real
  // `ProposalHttpDetail` in this port's own union ever reaches this
  // fallback through `project()`'s actual call sites.
  it('fallback: empty array -> the empty string (verified divergence from Python str([]) == "[]", disclosed — unreachable in practice)', () => {
    expect(readableErrorText([])).toBe('')
  })

  it('fallback: dict without a message key -> "[object Object]" (verified divergence from Python\'s dict repr, disclosed — unreachable in practice)', () => {
    const detail = { code: 'x' }
    expect(readableErrorText(detail)).toBe('[object Object]')
  })

  it('fallback: dict with an empty-string message (falsy) -> the fallback, not the empty string', () => {
    const detail = { code: 'x', message: '' }
    expect(readableErrorText(detail)).toBe('[object Object]')
  })

  it('fallback: a non-dict/list/string value -> String(detail) (happens to match Python str() for a bare number)', () => {
    expect(readableErrorText(42)).toBe('42')
  })
})

// ---------------------------------------------------------------------------
// readableValidationText — no live call site (see quickview.ts's module
// doc); every branch exercised directly against a duck-typed input.
// ---------------------------------------------------------------------------

describe('readableValidationText', () => {
  it('errors() yields an entry with a usable msg -> that msg', () => {
    expect(readableValidationText({ errors: () => [{ msg: 'bad field' }] })).toBe('bad field')
  })

  // Literal expected strings, not `String(exc)` — see readableErrorText's
  // own describe block above for why comparing against `String(exc)` itself
  // would be a tautological, non-discriminating assertion.
  it('errors() yields nothing -> "[object Object]" fallback', () => {
    const exc = { errors: () => [] }
    expect(readableValidationText(exc)).toBe('[object Object]')
  })

  it('errors() yields an entry with no usable msg -> "[object Object]" fallback', () => {
    const exc = { errors: () => [{}] }
    expect(readableValidationText(exc)).toBe('[object Object]')
  })

  it('a value with no errors() method at all -> String(exc) fallback', () => {
    expect(readableValidationText(42)).toBe('42')
  })
})

// ---------------------------------------------------------------------------
// withTickSeconds
// ---------------------------------------------------------------------------

describe('withTickSeconds', () => {
  it('null tickSeconds leaves presets untouched — returns the SAME reference (mirrors Python returning presets unchanged)', () => {
    const presets = { traffic_events: [] }
    expect(withTickSeconds(presets, null)).toBe(presets)
  })

  it('null presets + a tickSeconds folds into a fresh {tick_seconds} object', () => {
    expect(withTickSeconds(null, 5)).toEqual({ tick_seconds: 5 })
  })

  it('non-null presets + tickSeconds merges without mutating the input', () => {
    const presets = { traffic_events: [{ a: 1 }] }
    const result = withTickSeconds(presets, 5)
    expect(result).toEqual({ traffic_events: [{ a: 1 }], tick_seconds: 5 })
    expect(presets).toEqual({ traffic_events: [{ a: 1 }] })
  })
})

// ---------------------------------------------------------------------------
// project — the `result.error !== null` fires-suppression branch. No real
// captured run reaches this (neither golden's underlying trigger run hits an
// algorithm_error), so it is exercised directly against a mocked
// `iterPreviewTicks` — the SAME `vi.spyOn`-on-the-module-namespace technique
// `tests/proposal_create_run_port.test.ts` already establishes for a branch
// real committed data cannot reach.
// ---------------------------------------------------------------------------

describe('project — fires are suppressed when the trigger run ends in an algorithm error', () => {
  it('mergedFires is [] even though a fire WAS yielded before the error (mirrors iterPreviewTicks own fires-emptying-on-error rule, not merely "nothing fired")', async () => {
    async function* fakeGen(): AsyncGenerator<PreviewFireEvent, PreviewLoopResult, void> {
      // An UNMAPPED result_type so projectFire takes its early-return branch
      // without needing a valid tickState/registries — isolates THIS
      // branch (project's own suppression) from projectFire's own logic,
      // already covered elsewhere.
      yield {
        tickIndex: 0,
        tickState: undefined as unknown as TickState,
        decision: { result_type: 'SUPPRESSED' } as unknown as DecisionResult,
        elapsedMin: 0,
        routeFacts: undefined as unknown as PreviewFireEvent['routeFacts'],
        effectiveScenario: undefined as unknown as PreviewFireEvent['effectiveScenario'],
        restSpot: null,
      }
      return {
        fired: true,
        fire: { category: 'rest_required', strength: 'high', tick: 0, time_min: 0, feature_contributions: {}, criteria: {} },
        // Mirrors iterPreviewTicks's OWN rule: fires/spikes emptied to []
        // whenever the run ends in an algorithm error, even though ONE fire
        // (and its yield, captured in `projected` above) already happened.
        fires: [],
        peak_score: 0.5,
        threshold: 0.4,
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
        seed: 1,
        overrides: [],
        error: { tick_index: 5, error_type: 'algorithm_error', message: 'boom' },
      }
    }
    const spy = vi.spyOn(previewTicksModule, 'iterPreviewTicks').mockImplementation(fakeGen)
    try {
      const result = await project(baseBody({ world: null as unknown as Record<string, unknown> }))
      expect(result.error).not.toBeNull()
      expect(result.fires).toEqual([])
      // fire (singular) is NOT suppressed by the error path — mirrors
      // Python's own `MergedInstantResult(**{**result, "fires": merged_fires})`,
      // which only ever overrides "fires", never "fire".
      expect(result.fire).not.toBeNull()
    } finally {
      spy.mockRestore()
    }
  })
})

// ---------------------------------------------------------------------------
// projectFire — a non-ProposalHttpError exception from createProposalRun
// propagates rather than being swallowed/miscategorized as a proposal_error.
// No real call site produces this (createProposalRun's own documented
// @throws is ProposalHttpError(422) at every raise site it owns), so this is
// exercised directly against a mocked createProposalRun, mirroring the SAME
// module-namespace `vi.spyOn` technique used above.
// ---------------------------------------------------------------------------

describe('projectFire — a non-ProposalHttpError exception propagates (not swallowed)', () => {
  it('rethrows rather than returning it as [null, proposalError]', async () => {
    const spy = vi.spyOn(createRunModule, 'createProposalRun').mockRejectedValue(new Error('unexpected bug'))
    try {
      const ev: PreviewFireEvent = {
        tickIndex: 0,
        tickState: { signals: {} } as unknown as TickState,
        decision: { result_type: 'REST_PROPOSAL' } as unknown as DecisionResult,
        elapsedMin: 0,
        routeFacts: undefined as unknown as PreviewFireEvent['routeFacts'],
        effectiveScenario: undefined as unknown as PreviewFireEvent['effectiveScenario'],
        restSpot: null,
      }
      await expect(projectFire(ev, baseBody())).rejects.toThrow('unexpected bug')
    } finally {
      spy.mockRestore()
    }
  })
})
