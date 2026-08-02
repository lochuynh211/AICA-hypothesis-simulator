import { describe, expect, it, vi, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { recomputeProposalRun, type RecomputeRequest } from '../src/engine/proposal/orchestrator/recompute'
import { ProposalHttpError } from '../src/engine/proposal/orchestrator/create_run'
import * as contextBase from '../src/engine/proposal/orchestrator/context_base'
import * as matrixModule from '../src/engine/proposal/matrix'
import * as selectorModule from '../src/engine/proposal/selector'
import * as selectServiceModule from '../src/engine/proposal/orchestrator/select_service'
import { proposalPackageRegistry } from '../src/engine/proposal/stores'
import { ensureRegistry } from '../src/data/registry'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import { proposalRunsStore } from '../src/storage/proposal_runs_store'
import {
  createRun as runManagerCreateRun,
  updateState,
  type CreateRunArgs,
  type ProposalRunLog,
} from '../src/engine/proposal/run_manager'

/**
 * Conformance test for `src/engine/proposal/orchestrator/recompute.ts` — the
 * port of `recompute_proposal_run` (`app/api/aica_api/routers/proposal.py`,
 * 1492-1815) — feature 026 (htmlapp Combined export), slice C4a Task 5. See
 * that file's own module doc for the full control-flow enumeration, the
 * "DIVERGES...NEVER PERSISTED" / "WHICH matrix_version" / two "UNREACHABLE"
 * notes, and the hazard pass — this file does not repeat that reasoning,
 * only the resulting test evidence.
 *
 * Fixture: `src/engine/__fixtures__/parity/proposal_recompute.json`,
 * captured by `scripts/gen/capture_all.py#_capture_proposal_recompute` —
 * every case calls the REAL `recompute_proposal_run` directly (disk-mode,
 * Python's own function has no `cache` parameter), over the REAL committed
 * seed `seed-night-highway-oshi` and the two REAL ported packages. Group A
 * drives a run through the REAL journey-action sequence
 * (`rest_spot_arrived`->`rest_started`->`rest_completed`,
 * `select-service`->`accept`->`stop`) exactly like
 * `app/api/tests/proposal/test_p7_recompute.py`'s own helpers. Group B
 * hand-builds a typed-world run via `prm.create_run` directly for the
 * package-id edge cases a normal `create_proposal_run` call can never reach.
 *
 * `seedRun` below reproduces a golden's `before` snapshot via
 * `runManagerCreateRun` (mirrors `proposal_select_service_port.test.ts`'s own
 * `seedRun`) PLUS an `updateState` patch for `content_parameters`/
 * `content_hyperparameters` when the golden's own `before` already has them
 * non-empty (the quick_check goldens, whose CREATE step itself already
 * dispatched content before the journey advance this file's own `before`
 * snapshot was taken after) — `runManagerCreateRun`'s own `createRun`
 * ALWAYS starts those two fields empty (`run_manager.ts`'s own documented
 * "STEP 1"/"STEP 2" split), so a golden with non-empty ones cannot be
 * reproduced by `toCreateArgs` alone.
 *
 * `Scenario`/`freezeValue` mirror the capture script's own `_Scenario`/
 * `_freeze` (see that function's own doc comment) — recompute can mint
 * MULTIPLE fresh opportunity_ids on the SAME run (one per recompute call),
 * so `op_TEST_FIXED_0` (the golden's own already-frozen seed opportunity_id,
 * which round-trips VERBATIM through `runManagerCreateRun` — never
 * re-minted) is reserved, and each NEWLY minted id this test's own call
 * produces is frozen to `op_TEST_FIXED_1`, `_2`, ... in MINTING order,
 * matching the golden's own numbering exactly.
 *
 * ── Branch coverage table (per the task brief's reporting rule) ────────────
 *
 * Every guard raise site: ALL reached — 404 (`run_not_found_404`), no typed
 *   world (`legacy_run_no_typed_world_422`), playback active (real journey,
 *   `playback_active_blocks_recompute_422`) AND backgrounded (synthetic,
 *   `playback_state handling` describe block — same condition, no separate
 *   golden needed), `InvalidOverrideError` (out-of-range/unknown-path/
 *   dangling-catalog, 3 goldens), unknown/mis-slotted service package (2),
 *   unknown/mis-slotted/None content package (3), empty `allowed_service_ids`
 *   (`empty_matrix_row_422`, via `buildProposalOpportunity`, propagated).
 * `MatrixResolutionError`'s own catch: UNREACHABLE through real committed
 *   data (see module doc) — covered via `vi.spyOn(matrixModule,
 *   'resolveMatrix')`.
 * `eligibilityResult.eligible.length === 0` (`NO_ELIGIBLE_CANDIDATE`):
 *   UNREACHABLE through real committed data (same T017a class `create_run
 *   .ts` documents) — covered via `vi.spyOn(contextBase,
 *   'getServiceCapabilities')`, including the quick_check sub-case (proves
 *   `applyQuickCheckContent` is never reached when `selectedServiceId` stays
 *   `null`).
 * `evidence.error !== null` (service dispatch, `ALGORITHM_ERROR`):
 *   UNREACHABLE through real committed data (the real ported selector never
 *   throws for structurally valid input, same reasoning `create_run.ts`'s
 *   own port documents) — covered via `vi.spyOn(selectorModule,
 *   'dispatchSelector')`.
 * `ranked_candidates` empty/absent/explicit-null (the `pyGetDefault`
 *   mechanical proof AND the `pyTruthy(rankedCandidatesRaw)`-not-`.length`
 *   fix — see module doc): covered via the SAME `dispatchSelector` spy, 3
 *   sub-cases (falsy `output` short-circuits before `.get` ever runs;
 *   `output` truthy but key ABSENT falls back to `[]`; key PRESENT but
 *   explicit `null` passes through and is handled WITHOUT crashing).
 * CONTEXT_EDITED present vs absent: BOTH —
 *   `interactive_after_rest_full_sequence_with_overrides` (diffs.length>0)
 *   vs `empty_overrides_no_context_edited_event`/
 *   `interactive_no_journey_advance_success` (overrides=[]).
 * quick_check content-dispatch reached vs not: BOTH —
 *   `quick_check_content_dispatch_succeeds_before_rest_stage`/`_hyperparameters_override_applied` vs
 *   every interactive-mode case (mode gates the branch, not merely
 *   `selectedServiceId !== null` — proven the same way `create_run.ts`'s own
 *   `interactive_full_mode_service_selected_no_content` case proves it) AND
 *   the zero-eligible quick_check sub-case above (selectedServiceId gates
 *   the branch too, not merely `mode`).
 * `applyQuickCheckContent`'s own mis-slotted-package raise: proven
 *   UNREACHABLE from `recomputeProposalRun`'s call site — a `vi.spyOn` on
 *   `selectServiceModule.applyQuickCheckContent` confirms it is NEVER
 *   invoked for a quick_check run whose `content_package_id` is mis-slotted
 *   (recompute's OWN pre-check 422s first, every time).
 * `body.parameters`/`.hyperparameters`/`.content_parameters`/
 *   `.content_hyperparameters` supplied vs absent: ALL 4 reached —
 *   `parameters_explicit_override_supplied_at_recompute` /
 *   `hyperparameters_fallback_carries_run_not_package_defaults` (absent) /
 *   `quick_check_content_hyperparameters_override_applied` (content
 *   supplied) / `quick_check_content_dispatch_succeeds_before_rest_stage` (content absent, package
 *   defaults). The service-side two are proven via `evidence[-1].
 *   input_snapshot`, NOT `result.parameters`/`.hyperparameters` — see the
 *   dedicated "NEVER PERSISTED" describe block for why.
 * append-only discipline (Step 4): a dedicated describe block asserts, for
 *   every multi-step/multi-recompute case, that everything present in
 *   `events`/`evidence`/`opportunity_history`/`setup_snapshot_history`
 *   BEFORE a recompute is still present AFTERWARDS, in the SAME order, plus
 *   the new entries — not merely that the final result looks right.
 */

ensureRegistry()
beforeEach(() => { globalThis.indexedDB = new IDBFactory() })

const { output } = loadFixture('proposal_recompute')
const CASES: Record<string, any> = Object.fromEntries(
  output.recompute_cases.map((c: any) => [c.name, c]),
)

const SERVICE_PKG_ID = 'aica_transparent_service_selector_v1'
const CONTENT_PKG_ID = 'aica_transparent_content_selector_v1'

// ---------------------------------------------------------------------------
// Seeding + freezing helpers — see module doc.
// ---------------------------------------------------------------------------

function toCreateArgs(raw: any): CreateRunArgs {
  return {
    opportunity: raw.opportunity,
    matrixVersion: raw.matrix_version,
    worldSnapshot: raw.world_snapshot,
    servicePackageId: raw.service_package_id,
    contentPackageId: raw.content_package_id,
    parameters: raw.parameters,
    hyperparameters: raw.hyperparameters,
    journeyState: raw.journey_state,
    events: raw.events,
    evidence: raw.evidence,
    status: raw.status,
    setupSnapshot: raw.setup_snapshot,
    world: raw.world,
    mode: raw.mode,
  }
}

async function seedRun(before: any): Promise<ProposalRunLog> {
  const seeded = await runManagerCreateRun(toCreateArgs(before))
  const hasContentParams = Object.keys(before.content_parameters ?? {}).length > 0
  const hasContentHyperparams = Object.keys(before.content_hyperparameters ?? {}).length > 0
  if (hasContentParams || hasContentHyperparams) {
    return await updateState(seeded.run_id, {
      contentParameters: before.content_parameters,
      contentHyperparameters: before.content_hyperparameters,
    })
  }
  return seeded
}

function freezeValue(value: unknown, freezeMap: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((v) => freezeValue(v, freezeMap))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'created_at' || k === 'at') out[k] = '2026-01-01T00:00:00.000000Z'
      else if (typeof v === 'string' && freezeMap.has(v)) out[k] = freezeMap.get(v)
      else out[k] = freezeValue(v, freezeMap)
    }
    return out
  }
  return value
}

/** Mirrors the capture script's own `_Scenario` — see module doc. */
class Scenario {
  private freezeMap = new Map<string, string>()
  private n = 1 // "op_TEST_FIXED_0" is the golden's own seed id, reserved, never re-minted.

  constructor(runId: string) {
    this.freezeMap.set(runId, 'prun_TEST_FIXED')
  }

  private addOpportunityId(id: string): void {
    if (id === 'op_TEST_FIXED_0' || this.freezeMap.has(id)) return
    this.freezeMap.set(id, `op_TEST_FIXED_${this.n}`)
    this.n++
  }

  snap(log: ProposalRunLog): unknown {
    this.addOpportunityId(log.opportunity.opportunity_id)
    return freezeValue(log, this.freezeMap)
  }
}

// ---------------------------------------------------------------------------
// Success-path parity — full run log, structurally compared against the
// REAL captured Python recompute_proposal_run() output.
// ---------------------------------------------------------------------------

describe('recomputeProposalRun — success-path parity against real Python recompute_proposal_run()', () => {
  it('interactive_no_journey_advance_success: recompute immediately after create, empty overrides -- new opportunity_id/SERVICE_SELECTED for the SAME row, no CONTEXT_EDITED', async () => {
    const golden = CASES.interactive_no_journey_advance_success
    const seeded = await seedRun(golden.before)
    const scn = new Scenario(seeded.run_id)
    const result = await recomputeProposalRun(seeded.run_id, { overrides: [] })
    expectParity(scn.snap(result), golden.result)
    expect(result.events.map((e) => e.event_type)).not.toContain('CONTEXT_EDITED')
  })

  it('interactive_after_rest_full_sequence_with_overrides: real journey advance to after_rest_before_restart/stopped, matching post-rest overrides -- CONTEXT_EDITED, OPPORTUNITY_OPENED, RECOMPUTED, SERVICE_SELECTED in order; journey_state reset+preserved fields', async () => {
    const golden = CASES.interactive_after_rest_full_sequence_with_overrides
    const seeded = await seedRun(golden.before)
    const scn = new Scenario(seeded.run_id)
    const body: RecomputeRequest = {
      overrides: [
        { path: 'situation.drowsiness_level', value: 80 },
        { path: 'situation.fatigue_level', value: 70 },
      ],
    }
    const result = await recomputeProposalRun(seeded.run_id, body)
    expectParity(scn.snap(result), golden.result)
    const newEventTypes = result.events.slice(seeded.events.length).map((e) => e.event_type)
    expect(newEventTypes).toEqual(['CONTEXT_EDITED', 'OPPORTUNITY_OPENED', 'RECOMPUTED', 'SERVICE_SELECTED'])
    expect(result.journey_state).toMatchObject({
      lifecycle_stage: 'after_rest_before_restart',
      motion_state: 'stopped',
      rejected_service_ids: [],
    })
  })

  it('recompute_twice_history_grows_and_top_ranked_changes: SC-003 -- high vs low post-rest on the SAME run yields a DIFFERENT top-ranked service, opportunity_history/setup_snapshot_history grow 0 -> 1 -> 2', async () => {
    const golden = CASES.recompute_twice_history_grows_and_top_ranked_changes
    const seeded = await seedRun(golden.before)
    const scn = new Scenario(seeded.run_id)

    const first = await recomputeProposalRun(seeded.run_id, {
      overrides: [
        { path: 'situation.drowsiness_level', value: 80 },
        { path: 'situation.fatigue_level', value: 70 },
      ],
    })
    expectParity(scn.snap(first), golden.result_first)
    expect(first.opportunity_history).toHaveLength(1)

    const second = await recomputeProposalRun(seeded.run_id, {
      overrides: [
        { path: 'situation.drowsiness_level', value: 10 },
        { path: 'situation.fatigue_level', value: 5 },
      ],
    })
    expectParity(scn.snap(second), golden.result_second)
    expect(second.opportunity_history).toHaveLength(2)

    const topOf = (log: ProposalRunLog) => {
      const serviceEvidence = log.evidence.filter((e) => e.step === 'service')
      return (serviceEvidence.at(-1)!.output as any).ranked_candidates[0].candidate_id
    }
    expect(topOf(first)).not.toBe(topOf(second))

    // Append-only across BOTH recomputes: the first opportunity/setup_
    // snapshot survives into the second result's own history, untouched.
    expect(second.opportunity_history[0]).toEqual(first.opportunity_history[0])
    expect(second.opportunity_history[1]).toEqual(first.opportunity)
  })

  it('empty_overrides_no_context_edited_event: overrides=[] (genuinely empty, not merely unchanged values) -- no CONTEXT_EDITED event', async () => {
    const golden = CASES.empty_overrides_no_context_edited_event
    const seeded = await seedRun(golden.before)
    const scn = new Scenario(seeded.run_id)
    const result = await recomputeProposalRun(seeded.run_id, { overrides: [] })
    expectParity(scn.snap(result), golden.result)
    expect(result.events.map((e) => e.event_type)).not.toContain('CONTEXT_EDITED')
  })

  it('playback_stopped_recompute_succeeds: after journey/action stop, recompute (which 422d while active) now succeeds', async () => {
    const golden = CASES.playback_stopped_recompute_succeeds
    const seeded = await seedRun(golden.before)
    expect(seeded.journey_state.playback_state).toBe('stopped')
    const scn = new Scenario(seeded.run_id)
    const result = await recomputeProposalRun(seeded.run_id, { overrides: [] })
    expectParity(scn.snap(result), golden.result)
  })

  it('quick_check_content_dispatch_succeeds_before_rest_stage: recompute additionally dispatches content for rank-1 in the SAME call (mode gates the branch), and succeeds when the content package supports that stage\'s own rank-1', async () => {
    const golden = CASES.quick_check_content_dispatch_succeeds_before_rest_stage
    const seeded = await seedRun(golden.before)
    expect(seeded.mode).toBe('quick_check')
    const scn = new Scenario(seeded.run_id)
    const result = await recomputeProposalRun(seeded.run_id, { overrides: [] })
    expectParity(scn.snap(result), golden.result)
    const newEventTypes = result.events.slice(seeded.events.length).map((e) => e.event_type)
    expect(newEventTypes).toContain('CONTENT_SELECTED')
    const newEvidenceSteps = result.evidence.slice(seeded.evidence.length).map((e) => e.step)
    expect(newEvidenceSteps).toEqual(['service', 'content'])
    expect(result.status).toBe('content_selected')
  })

  it('quick_check_content_hyperparameters_override_applied: body.content_hyperparameters explicitly supplied -> used verbatim instead of contentPkg\'s own defaults', async () => {
    const golden = CASES.quick_check_content_hyperparameters_override_applied
    const seeded = await seedRun(golden.before)
    const scn = new Scenario(seeded.run_id)
    const contentPkg = proposalPackageRegistry.get(CONTENT_PKG_ID)!
    const contentHyperparameters: Record<string, unknown> = {}
    for (const hp of contentPkg.hyperparameters as Array<{ key: string; default: unknown }>) contentHyperparameters[hp.key] = hp.default
    contentHyperparameters.plan_item_count = 1
    const result = await recomputeProposalRun(seeded.run_id, { overrides: [], content_hyperparameters: contentHyperparameters })
    expectParity(scn.snap(result), golden.result)
    expect(result.status).toBe('content_selected')
    expect((result.content_hyperparameters as any).plan_item_count).toBe(1)
  })

  it('quick_check_content_unsupported_service_after_rest: recompute\'s own service dispatch ranks a service the real content package does NOT support -- ALGORITHM_ERROR + status=error, NEVER raises (quick_check has no HTTP request to 422 back to)', async () => {
    const golden = CASES.quick_check_content_unsupported_service_after_rest
    const seeded = await seedRun(golden.before)
    const scn = new Scenario(seeded.run_id)
    const result = await recomputeProposalRun(seeded.run_id, {
      overrides: [
        { path: 'situation.drowsiness_level', value: 80 },
        { path: 'situation.fatigue_level', value: 70 },
      ],
    })
    expectParity(scn.snap(result), golden.result)
    expect(result.status).toBe('error')
    const lastEvent = result.events.at(-1)
    expect(lastEvent?.event_type).toBe('ALGORITHM_ERROR')
    expect(lastEvent?.payload.category).toBe('unsupported_service')
  })
})

// ---------------------------------------------------------------------------
// "NEVER PERSISTED" — parameters/hyperparameters are resolved for THIS
// recompute's own dispatch/freeze only; run_log.parameters/.hyperparameters
// never change. See recompute.ts's own module doc for the full reasoning
// (a surprise found empirically while capturing this exact golden).
// ---------------------------------------------------------------------------

describe('parameters/hyperparameters resolution -- used for dispatch, NEVER written back to the run', () => {
  it('hyperparameters_fallback_carries_run_not_package_defaults: body.hyperparameters ABSENT -> falls back to run_log\'s OWN current hyperparameters (0.123456, from algorithm_config_overrides at create time), NOT service_pkg\'s manifest default (1.0)', async () => {
    const golden = CASES.hyperparameters_fallback_carries_run_not_package_defaults
    expect(golden.before.hyperparameters.gamma_drowsiness).toBe(0.123456)
    const seeded = await seedRun(golden.before)
    const scn = new Scenario(seeded.run_id)
    const result = await recomputeProposalRun(seeded.run_id, { overrides: [] })
    expectParity(scn.snap(result), golden.result)

    // The discriminating field: the FRESHLY-dispatched evidence's own input
    // snapshot -- proves the LOCAL `hyperparameters` variable this recompute
    // resolved and used for dispatch, distinct from the persisted field.
    const latestServiceEvidence = result.evidence.filter((e) => e.step === 'service').at(-1)!
    expect((latestServiceEvidence.input_snapshot as any).hyperparameters.gamma_drowsiness).toBe(0.123456)
    const servicePkg = proposalPackageRegistry.get(SERVICE_PKG_ID)!
    const pkgDefault = (servicePkg.hyperparameters as Array<{ key: string; default: unknown }>).find(
      (hp) => hp.key === 'gamma_drowsiness',
    )!.default
    expect(pkgDefault).not.toBe(0.123456) // sanity: the two fallback targets genuinely differ

    // The run's OWN top-level field is BYTE-IDENTICAL before/after -- proves
    // it is never written back (update_state has no such kwarg in Python).
    expect(result.hyperparameters).toEqual(seeded.hyperparameters)
  })

  it('parameters_explicit_override_supplied_at_recompute: body.parameters explicitly supplied (pyTruthy true branch) -> used verbatim for dispatch, but result.parameters itself stays untouched', async () => {
    const golden = CASES.parameters_explicit_override_supplied_at_recompute
    const seeded = await seedRun(golden.before)
    const scn = new Scenario(seeded.run_id)
    const probeParams = { probe_marker_C4A_TASK5: true }
    const result = await recomputeProposalRun(seeded.run_id, { overrides: [], parameters: probeParams })
    expectParity(scn.snap(result), golden.result)

    const latestServiceEvidence = result.evidence.filter((e) => e.step === 'service').at(-1)!
    expect(latestServiceEvidence.input_snapshot.parameters).toEqual(probeParams)

    // result.parameters (the run's own top-level field) is UNCHANGED.
    expect(result.parameters).toEqual(seeded.parameters)
    expect(result.parameters).not.toEqual(probeParams)
  })
})

// ---------------------------------------------------------------------------
// Raising paths — ProposalHttpError.status/.detail match the real captured
// Python HTTPException.status_code/.detail.
// ---------------------------------------------------------------------------

describe('recomputeProposalRun — raising paths, byte-exact against real Python HTTPException detail', () => {
  it('run_not_found_404', async () => {
    const golden = CASES.run_not_found_404
    await expect(recomputeProposalRun('not-a-real-run-id-at-all', { overrides: [] }))
      .rejects.toMatchObject({ status: golden.status_code, detail: golden.detail })
  })

  it('legacy_run_no_typed_world_422: a legacy world_snapshot-only run has no typed world', async () => {
    const golden = CASES.legacy_run_no_typed_world_422
    const seeded = await seedRun(golden.before)
    expect(seeded.world).toBeNull()
    await expect(recomputeProposalRun(seeded.run_id, { overrides: [] }))
      .rejects.toMatchObject({ status: golden.status_code, detail: golden.detail })
  })

  it('playback_active_blocks_recompute_422: STRUCTURED {code: recompute_requires_idle_playback, message} detail (widened ProposalHttpDetail)', async () => {
    const golden = CASES.playback_active_blocks_recompute_422
    const seeded = await seedRun(golden.before)
    expect(seeded.journey_state.playback_state).toBe('active')
    await expect(recomputeProposalRun(seeded.run_id, { overrides: [] }))
      .rejects.toMatchObject({ status: golden.status_code, detail: golden.detail })
    try {
      await recomputeProposalRun(seeded.run_id, { overrides: [] })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(ProposalHttpError)
      expect((err as ProposalHttpError).detail).toEqual({
        code: 'recompute_requires_idle_playback',
        message:
          'Recompute requires the current content plan to be completed or stopped first / ' +
          'recomputeの前に現在のコンテンツプランを完了または停止してください',
      })
    }
  })

  it('invalid_override_out_of_range_422: drowsiness_level=999 -- InvalidOverrideError -> 422 array-of-issues; the run is BYTE-IDENTICAL afterward (no snapshot ever appended)', async () => {
    const golden = CASES.invalid_override_out_of_range_422
    const seeded = await seedRun(golden.before)
    const scn = new Scenario(seeded.run_id)
    await expect(
      recomputeProposalRun(seeded.run_id, { overrides: [{ path: 'situation.drowsiness_level', value: 999 }] }),
    ).rejects.toMatchObject({ status: golden.status_code, detail: golden.detail })

    const { getRun } = await import('../src/engine/proposal/run_manager')
    const unchanged = (await getRun(seeded.run_id))!
    expectParity(scn.snap(unchanged), golden.unchanged_after_fetch)
  })

  it('unknown_override_path_422', async () => {
    const golden = CASES.unknown_override_path_422
    const seeded = await seedRun(golden.before)
    await expect(
      recomputeProposalRun(seeded.run_id, { overrides: [{ path: 'situation.does_not_exist', value: 1 }] }),
    ).rejects.toMatchObject({ status: golden.status_code, detail: golden.detail })
  })

  it('dangling_catalog_reference_422: issue.code == unknown_catalog_reference', async () => {
    const golden = CASES.dangling_catalog_reference_422
    const seeded = await seedRun(golden.before)
    await expect(
      recomputeProposalRun(seeded.run_id, {
        overrides: [{ path: 'driver_profile.oshi_artists[0].artist_id', value: 'synthetic-artist-DOES-NOT-EXIST' }],
      }),
    ).rejects.toMatchObject({ status: golden.status_code, detail: golden.detail })
  })

  it('empty_matrix_row_422: lifecycle_stage -> during_rest_stopped (compatible pair, empty row) -- buildProposalOpportunity\'s OWN empty-list validator raises, NOT MatrixResolutionError', async () => {
    const golden = CASES.empty_matrix_row_422
    const seeded = await seedRun(golden.before)
    await expect(
      recomputeProposalRun(seeded.run_id, {
        overrides: [{ path: 'control_inputs.lifecycle_stage', value: 'during_rest_stopped' }],
      }),
    ).rejects.toMatchObject({ status: golden.status_code, message: 'allowed_service_ids must not be empty; supply at least one ServiceId.' })
  })

  it('service_package_unknown_422', async () => {
    const golden = CASES.service_package_unknown_422
    const seeded = await seedRun(golden.before)
    await expect(recomputeProposalRun(seeded.run_id, { overrides: [] }))
      .rejects.toMatchObject({ status: golden.status_code, detail: golden.detail })
  })

  it('service_package_mis_slotted_422: service_package_id points at the REAL CONTENT package', async () => {
    const golden = CASES.service_package_mis_slotted_422
    const seeded = await seedRun(golden.before)
    expect(seeded.service_package_id).toBe(CONTENT_PKG_ID)
    await expect(recomputeProposalRun(seeded.run_id, { overrides: [] }))
      .rejects.toMatchObject({ status: golden.status_code, detail: golden.detail })
  })

  it('content_package_unknown_422', async () => {
    const golden = CASES.content_package_unknown_422
    const seeded = await seedRun(golden.before)
    await expect(recomputeProposalRun(seeded.run_id, { overrides: [] }))
      .rejects.toMatchObject({ status: golden.status_code, detail: golden.detail })
  })

  it('content_package_mis_slotted_422: content_package_id points at the REAL SERVICE package', async () => {
    const golden = CASES.content_package_mis_slotted_422
    const seeded = await seedRun(golden.before)
    expect(seeded.content_package_id).toBe(SERVICE_PKG_ID)
    await expect(recomputeProposalRun(seeded.run_id, { overrides: [] }))
      .rejects.toMatchObject({ status: golden.status_code, detail: golden.detail })
  })

  it("content_package_none_422: content_package_id is null -- repr(None) == 'None' (bare, unquoted)", async () => {
    const golden = CASES.content_package_none_422
    const seeded = await seedRun(golden.before)
    expect(seeded.content_package_id).toBeNull()
    await expect(recomputeProposalRun(seeded.run_id, { overrides: [] }))
      .rejects.toMatchObject({ status: golden.status_code, detail: golden.detail })
    expect(golden.detail).toBe('Unknown or mis-slotted content_package_id: None')
  })
})

// ---------------------------------------------------------------------------
// Append-only discipline (brief Step 4) — assert that a recompute APPENDS
// rather than rewrites: everything present before must still be present
// afterwards, in the SAME order, plus the new entries.
// ---------------------------------------------------------------------------

describe('append-only discipline — recompute mutates by appending only, never rewriting history', () => {
  it('events: the ENTIRE prior events array survives as an exact prefix', async () => {
    const golden = CASES.interactive_after_rest_full_sequence_with_overrides
    const seeded = await seedRun(golden.before)
    const priorEvents = structuredClone(seeded.events)
    const result = await recomputeProposalRun(seeded.run_id, {
      overrides: [
        { path: 'situation.drowsiness_level', value: 80 },
        { path: 'situation.fatigue_level', value: 70 },
      ],
    })
    expect(result.events.slice(0, priorEvents.length)).toEqual(priorEvents)
    expect(result.events.length).toBeGreaterThan(priorEvents.length)
  })

  it('evidence: the ENTIRE prior evidence array survives as an exact prefix', async () => {
    const golden = CASES.interactive_after_rest_full_sequence_with_overrides
    const seeded = await seedRun(golden.before)
    const priorEvidence = structuredClone(seeded.evidence)
    const result = await recomputeProposalRun(seeded.run_id, {
      overrides: [
        { path: 'situation.drowsiness_level', value: 80 },
        { path: 'situation.fatigue_level', value: 70 },
      ],
    })
    expect(result.evidence.slice(0, priorEvidence.length)).toEqual(priorEvidence)
    expect(result.evidence.length).toBeGreaterThan(priorEvidence.length)
  })

  it('opportunity_history/setup_snapshot_history: the PRIOR head is pushed, never replaced -- proven across TWO successive recomputes on the same run', async () => {
    const golden = CASES.recompute_twice_history_grows_and_top_ranked_changes
    const seeded = await seedRun(golden.before)
    expect(seeded.opportunity_history).toEqual([])
    expect(seeded.setup_snapshot_history).toEqual([])

    const first = await recomputeProposalRun(seeded.run_id, {
      overrides: [
        { path: 'situation.drowsiness_level', value: 80 },
        { path: 'situation.fatigue_level', value: 70 },
      ],
    })
    expect(first.opportunity_history).toEqual([seeded.opportunity])
    expect(first.setup_snapshot_history).toEqual([seeded.setup_snapshot])

    const second = await recomputeProposalRun(seeded.run_id, {
      overrides: [
        { path: 'situation.drowsiness_level', value: 10 },
        { path: 'situation.fatigue_level', value: 5 },
      ],
    })
    // The prior history entry SURVIVES unchanged, plus one new entry (the
    // FIRST recompute's own head) is appended -- never rewritten.
    expect(second.opportunity_history[0]).toEqual(first.opportunity_history[0])
    expect(second.opportunity_history[1]).toEqual(first.opportunity)
    expect(second.setup_snapshot_history[0]).toEqual(first.setup_snapshot_history[0])
    expect(second.setup_snapshot_history[1]).toEqual(first.setup_snapshot)
    expect(second.opportunity_history).toHaveLength(2)
  })

  it('a REJECTED recompute (422) appends NOTHING at all -- events/evidence/history are byte-identical to before the attempt', async () => {
    const golden = CASES.invalid_override_out_of_range_422
    const seeded = await seedRun(golden.before)
    const before = structuredClone({
      events: seeded.events, evidence: seeded.evidence,
      opportunity_history: seeded.opportunity_history, setup_snapshot_history: seeded.setup_snapshot_history,
    })
    await expect(
      recomputeProposalRun(seeded.run_id, { overrides: [{ path: 'situation.drowsiness_level', value: 999 }] }),
    ).rejects.toThrow(ProposalHttpError)

    const { getRun } = await import('../src/engine/proposal/run_manager')
    const after = (await getRun(seeded.run_id))!
    expect(after.events).toEqual(before.events)
    expect(after.evidence).toEqual(before.evidence)
    expect(after.opportunity_history).toEqual(before.opportunity_history)
    expect(after.setup_snapshot_history).toEqual(before.setup_snapshot_history)
  })
})

// ---------------------------------------------------------------------------
// matrix_version immutability — see module doc's "WHICH matrix_version".
// ---------------------------------------------------------------------------

describe('matrix_version is frozen at create time -- never updated by a recompute', () => {
  it('result.matrix_version and result.setup_snapshot.matrix_version both equal the run\'s ORIGINAL value, not any freshly-loaded matrix version', async () => {
    const golden = CASES.interactive_after_rest_full_sequence_with_overrides
    const seeded = await seedRun(golden.before)
    const originalMatrixVersion = seeded.matrix_version
    const result = await recomputeProposalRun(seeded.run_id, {
      overrides: [
        { path: 'situation.drowsiness_level', value: 80 },
        { path: 'situation.fatigue_level', value: 70 },
      ],
    })
    expect(result.matrix_version).toBe(originalMatrixVersion)
    expect((result.setup_snapshot as any).matrix_version).toBe(originalMatrixVersion)
  })
})

// ---------------------------------------------------------------------------
// playback_state handling — 'active'/'backgrounded' both block; 'backgrounded'
// has no dedicated golden (identical condition to 'active') -- covered
// directly here instead of a second Python capture for the same branch.
// ---------------------------------------------------------------------------

describe("playback_state guard — 'active' (golden) and 'backgrounded' (synthetic, same condition) both block", () => {
  it("playback_state: 'backgrounded' also 422s with the SAME structured detail", async () => {
    const golden = CASES.playback_active_blocks_recompute_422
    const before = structuredClone(golden.before)
    before.journey_state = { ...before.journey_state, playback_state: 'backgrounded' }
    const seeded = await seedRun(before)
    await expect(recomputeProposalRun(seeded.run_id, { overrides: [] })).rejects.toMatchObject({
      status: 422,
      detail: { code: 'recompute_requires_idle_playback' },
    })
  })

  it("playback_state: 'paused'/'completed' do NOT block (only active/backgrounded do)", async () => {
    const golden = CASES.playback_active_blocks_recompute_422
    for (const state of ['paused', 'completed'] as const) {
      const before = structuredClone(golden.before)
      before.journey_state = { ...before.journey_state, playback_state: state }
      const seeded = await seedRun(before)
      await expect(recomputeProposalRun(seeded.run_id, { overrides: [] })).resolves.toBeTruthy()
    }
  })
})

// ---------------------------------------------------------------------------
// UNREACHABLE branches (brief: "say so, cover another way") — real committed
// data provably cannot reach these; each is proven via a targeted vi.spyOn.
// ---------------------------------------------------------------------------

describe('recomputeProposalRun — branches UNREACHABLE with real committed data (spied, per module doc)', () => {
  it('MatrixResolutionError: caught and wrapped as ProposalHttpError(422, message) -- resolveMatrix itself is already tested elsewhere, this proves the catch-and-wrap', async () => {
    const golden = CASES.interactive_no_journey_advance_success
    const seeded = await seedRun(golden.before)
    const spy = vi.spyOn(matrixModule, 'resolveMatrix').mockImplementation(() => {
      throw new matrixModule.MatrixResolutionError('synthetic unrepresented pair')
    })
    try {
      await expect(recomputeProposalRun(seeded.run_id, { overrides: [] })).rejects.toMatchObject({
        status: 422, message: 'synthetic unrepresented pair',
      })
    } finally {
      spy.mockRestore()
    }
  })

  it('NO_ELIGIBLE_CANDIDATE: every candidate excluded -> event appended, status service_selected, NO selector dispatch, NO fabricated evidence', async () => {
    const golden = CASES.interactive_after_rest_full_sequence_with_overrides
    const seeded = await seedRun(golden.before)
    // requires_entity, NOT stopped_only/screen_dependent: this scenario's
    // motion_state is 'stopped' (after-rest), so a motion-based exclusion
    // (stopped_only/screen_dependent-while-driving) would exclude NOTHING
    // here -- an entity requirement nothing registers is motion-independent
    // and reliably excludes every candidate regardless of stage.
    const allExcludedViaMissingEntity = {
      get: (serviceId: string) => ({
        service_id: serviceId, driving_capable: true, screen_dependent: false, stopped_only: false,
        background_on_motion: true, lighting_compatible: true, requires_entity: 'definitely_not_registered_entity',
      }),
    }
    const spy = vi.spyOn(contextBase, 'getServiceCapabilities').mockReturnValue(allExcludedViaMissingEntity as any)
    try {
      const priorEvidenceLength = seeded.evidence.length
      const result = await recomputeProposalRun(seeded.run_id, {
        overrides: [
          { path: 'situation.drowsiness_level', value: 80 },
          { path: 'situation.fatigue_level', value: 70 },
        ],
      })
      expect(result.status).toBe('service_selected')
      expect(result.journey_state.active_service_id).toBeNull()
      expect(result.evidence).toHaveLength(priorEvidenceLength) // no NEW evidence appended
      const newEventTypes = result.events.slice(seeded.events.length).map((e) => e.event_type)
      expect(newEventTypes).toEqual(['CONTEXT_EDITED', 'OPPORTUNITY_OPENED', 'RECOMPUTED', 'NO_ELIGIBLE_CANDIDATE'])
    } finally {
      spy.mockRestore()
    }
  })

  it('NO_ELIGIBLE_CANDIDATE + quick_check mode: selectedServiceId stays null -> applyQuickCheckContent is NEVER invoked (selectedServiceId gates the branch, not merely mode)', async () => {
    const golden = CASES.quick_check_content_dispatch_succeeds_before_rest_stage
    const seeded = await seedRun(golden.before)
    // Every candidate excluded via a required entity nothing registers --
    // motion-independent, so it works regardless of this scenario's own
    // (driving, before_rest_until_stop) motion state too.
    const allExcludedViaMissingEntity = {
      get: (serviceId: string) => ({
        service_id: serviceId, driving_capable: true, screen_dependent: false, stopped_only: false,
        background_on_motion: true, lighting_compatible: true, requires_entity: 'definitely_not_registered_entity',
      }),
    }
    const capSpy = vi.spyOn(contextBase, 'getServiceCapabilities').mockReturnValue(allExcludedViaMissingEntity as any)
    const quickCheckSpy = vi.spyOn(selectServiceModule, 'applyQuickCheckContent')
    try {
      const result = await recomputeProposalRun(seeded.run_id, { overrides: [] })
      expect(result.journey_state.active_service_id).toBeNull()
      expect(quickCheckSpy).not.toHaveBeenCalled()
    } finally {
      capSpy.mockRestore()
      quickCheckSpy.mockRestore()
    }
  })

  it('ALGORITHM_ERROR (service dispatch): evidence.error set -> ALGORITHM_ERROR event, status=error, selectedServiceId stays null', async () => {
    const golden = CASES.interactive_after_rest_full_sequence_with_overrides
    const seeded = await seedRun(golden.before)
    const spy = vi.spyOn(selectorModule, 'dispatchSelector').mockReturnValue({
      step: 'service', package_id: SERVICE_PKG_ID, contract_version: '1.0.0', schema_version: '1.0.0',
      matrix_version: 'v1', input_snapshot: {}, output: null,
      error: { category: 'algorithm_exception', message: 'boom' },
      used_feature_ids: [], unused_available_features: [], missing_features: [],
    })
    try {
      const result = await recomputeProposalRun(seeded.run_id, {
        overrides: [
          { path: 'situation.drowsiness_level', value: 80 },
          { path: 'situation.fatigue_level', value: 70 },
        ],
      })
      expect(result.status).toBe('error')
      expect(result.journey_state.active_service_id).toBeNull()
      const lastEvent = result.events.at(-1)
      expect(lastEvent?.event_type).toBe('ALGORITHM_ERROR')
      expect(lastEvent?.payload).toEqual({ step: 'service', category: 'algorithm_exception', message: 'boom' })
    } finally {
      spy.mockRestore()
    }
  })

  it('dict.get(key, default) mechanical proof, 3 sub-cases: falsy output short-circuits, truthy-output-absent-key defaults to [], truthy-output-present-explicit-null passes through WITHOUT crashing', async () => {
    const golden = CASES.interactive_after_rest_full_sequence_with_overrides
    const body: RecomputeRequest = {
      overrides: [
        { path: 'situation.drowsiness_level', value: 80 },
        { path: 'situation.fatigue_level', value: 70 },
      ],
    }
    const baseEvidence = {
      step: 'service' as const, package_id: SERVICE_PKG_ID, contract_version: '1.0.0', schema_version: '1.0.0',
      matrix_version: 'v1', input_snapshot: {}, error: null,
      used_feature_ids: [], unused_available_features: [], missing_features: [],
    }

    // Sub-case 1: evidence.output is FALSY ({}) -- pyTruthy(evidence.output)
    // is false, the ternary short-circuits BEFORE pyGetDefault ever runs.
    {
      const seeded = await seedRun(golden.before)
      const spy = vi.spyOn(selectorModule, 'dispatchSelector').mockReturnValue({ ...baseEvidence, output: {} })
      try {
        const priorEventCount = seeded.events.length
        const result = await recomputeProposalRun(seeded.run_id, body)
        expect(result.journey_state.active_service_id).toBeNull()
        // Slice off the pre-existing (create-time) events -- golden.before
        // already contains one SERVICE_SELECTED from create; only the NEW
        // events this recompute appended matter here.
        expect(result.events.slice(priorEventCount).map((e) => e.event_type)).not.toContain('SERVICE_SELECTED')
      } finally {
        spy.mockRestore()
      }
    }

    // Sub-case 2: evidence.output TRUTHY, "ranked_candidates" key ABSENT --
    // pyGetDefault substitutes the default [].
    {
      const seeded = await seedRun(golden.before)
      const spy = vi.spyOn(selectorModule, 'dispatchSelector').mockReturnValue({ ...baseEvidence, output: { some_other_key: 1 } })
      try {
        const priorEventCount = seeded.events.length
        const result = await recomputeProposalRun(seeded.run_id, body)
        expect(result.journey_state.active_service_id).toBeNull()
        expect(result.events.slice(priorEventCount).map((e) => e.event_type)).not.toContain('SERVICE_SELECTED')
      } finally {
        spy.mockRestore()
      }
    }

    // Sub-case 3: evidence.output TRUTHY, "ranked_candidates" PRESENT but
    // explicit null -- pyGetDefault passes the null THROUGH (key present),
    // NOT the default []. Mirrors Python's `if ranked_candidates:` (falsy
    // for None) -- must NOT throw reading `.length` off null (see module
    // doc's fix note: this discriminates recompute.ts's own `pyTruthy`
    // guard from create_run.ts's otherwise-identical `.length > 0`, which
    // would crash on exactly this input).
    {
      const seeded = await seedRun(golden.before)
      const priorEventCount = seeded.events.length
      const spy = vi.spyOn(selectorModule, 'dispatchSelector').mockReturnValue({
        ...baseEvidence, output: { ranked_candidates: null, decision_type: 'ranked_candidates' },
      })
      try {
        await expect(recomputeProposalRun(seeded.run_id, body)).resolves.toBeTruthy()
        const result = await (async () => {
          const { getRun } = await import('../src/engine/proposal/run_manager')
          return (await getRun(seeded.run_id))!
        })()
        expect(result.journey_state.active_service_id).toBeNull()
        expect(result.events.slice(priorEventCount).map((e) => e.event_type)).not.toContain('SERVICE_SELECTED')
      } finally {
        spy.mockRestore()
      }
    }
  })
})

// ---------------------------------------------------------------------------
// UNREACHABLE: applyQuickCheckContent's own mis-slotted-package raise — see
// module doc. Proven structurally: the spy is NEVER CALLED, not merely that
// the observable error message happens to match either shape.
// ---------------------------------------------------------------------------

describe("recomputeProposalRun's own content-package pre-check makes applyQuickCheckContent's internal re-check UNREACHABLE from this call site", () => {
  it('a quick_check run with a mis-slotted content_package_id 422s at recompute\'s OWN pre-check -- applyQuickCheckContent is NEVER invoked', async () => {
    const golden = CASES.content_package_mis_slotted_422
    const before = structuredClone(golden.before)
    before.mode = 'quick_check'
    const seeded = await seedRun(before)
    expect(seeded.content_package_id).toBe(SERVICE_PKG_ID)

    const spy = vi.spyOn(selectServiceModule, 'applyQuickCheckContent')
    try {
      await expect(recomputeProposalRun(seeded.run_id, { overrides: [] })).rejects.toMatchObject({
        status: 422,
        detail: `Unknown or mis-slotted content_package_id: 'aica_transparent_service_selector_v1'`,
      })
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})

// ---------------------------------------------------------------------------
// UNREACHABLE-WITH-REAL-DATA, disclosed and covered directly (per the
// coordinator's mid-task note: a same-shaped `setup_snapshot == null` guard
// in select_service.ts's own FIX-2 block was left untested in a prior task
// -- this is recompute.ts's OWN separate instance of that same idiom, `origin
// = runLog.setup_snapshot != null ? ... .origin : null`, and it gets its own
// direct test here rather than being asserted only from reading the code).
// A typed-world run always has a non-null setup_snapshot in practice (frozen
// together at create time, guaranteed by the SAME `world == null` guard this
// function checks first) -- the type permits the combination `world != null`
// + `setup_snapshot == null` anyway (two independently-nullable fields on
// `ProposalRunLog`), so this hand-seeds exactly that otherwise-unreachable
// state to prove the branch doesn't crash and resolves origin to all-null,
// not merely that it "looks obviously fine by inspection".
// ---------------------------------------------------------------------------

describe('setup_snapshot == null on an otherwise-typed-world run (unreachable via any real call site, still exercised directly)', () => {
  it('origin falls back to {seed_id: null, clone_id: null, profile_id: null, origin_preset_id: null} -- no crash, recompute still succeeds and freezes a BRAND NEW non-null setup_snapshot', async () => {
    const golden = CASES.interactive_no_journey_advance_success
    const before = structuredClone(golden.before)
    expect(before.setup_snapshot).not.toBeNull() // sanity: the golden's OWN natural state is non-null
    before.setup_snapshot = null
    const seeded = await seedRun(before)
    expect(seeded.world).not.toBeNull()
    expect(seeded.setup_snapshot).toBeNull()

    const result = await recomputeProposalRun(seeded.run_id, { overrides: [] })
    expect(result.setup_snapshot).not.toBeNull()
    expect((result.setup_snapshot as any).origin).toEqual({
      seed_id: null, clone_id: null, profile_id: null, origin_preset_id: null,
    })
    expect(result.status).toBe('service_selected')
  })
})

// ---------------------------------------------------------------------------
// Sanity: the store stays untouched by a rejected recompute attempt, and IS
// written for a successful one (recompute is always disk-mode -- no `cache`
// parameter exists on this function at all, unlike createProposalRun).
// ---------------------------------------------------------------------------

describe('recomputeProposalRun is always disk-mode (no cache parameter, unlike createProposalRun)', () => {
  it('a successful recompute persists through proposalRunsStore', async () => {
    const golden = CASES.interactive_no_journey_advance_success
    const seeded = await seedRun(golden.before)
    const putHeaderSpy = vi.spyOn(proposalRunsStore, 'putHeader')
    await recomputeProposalRun(seeded.run_id, { overrides: [] })
    expect(putHeaderSpy).toHaveBeenCalled()
  })
})
