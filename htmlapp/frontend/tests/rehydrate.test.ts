/**
 * PARITY-GAP fix (REHYDRATE task) — offline durability invariant.
 *
 * Python's `_resolve_run_log` (app/api/aica_api/routers/runs.py:89-107)
 * resolves a RunLog by: (1) active in-memory registry, (2) inactive → read
 * `runs/<id>.json` from disk, (3) neither → 404. The offline app's read
 * seams (getRunLog/getEvidence/getEvidenceMarkdown/submitFeedback/exportRun)
 * only ever consulted the in-memory registry (`getActiveRunLog`) — after a
 * page reload (registry empty, IndexedDB persists) every one of those seams
 * broke for a run that had already completed. This suite proves the fix:
 * `resolveRunLog` (active → IndexedDB → 404) restores parity with Python and
 * closes the durability gap, and reuses the SAME assembly helper
 * `getActiveRunLog` uses, so active and inactive resolution produce
 * byte-identical RunLog shapes (asserted directly below via `expectParity`).
 *
 * `clearRegistry()` is used throughout to simulate "a page reload": the
 * in-memory `_registry` Map is wiped but `globalThis.indexedDB` (backed by
 * fake-indexeddb per-test, see beforeEach) is untouched — exactly the state
 * a real page reload leaves behind (module-level Map reset to empty; the
 * browser's IndexedDB database persists across the reload).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import { createDraft, clearDraftRegistry } from '../src/engine/run_plan'
import {
  createRun,
  tick,
  action,
  getActiveRunLog,
  resolveRunLog,
  getRun,
  clearRegistry,
} from '../src/engine/run_manager'
import { createRunPlan, createRun as clientCreateRun, tickRun, getRunLog, getEvidence, getEvidenceMarkdown } from '../src/api/client'
import { renderEvidenceMarkdown } from '../src/engine/services/evidence_markdown'
import { exportRun, exportAllRuns, importRun } from '../src/engine/services/portability'
import { seedDefaults } from '../src/storage/db'
import { resetDispatchState } from '../src/engine/worker/dispatch'

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  resetDispatchState()
  clearDraftRegistry()
  clearRegistry()
  await seedDefaults()
})

// Same fixture/flow as run_manager.test.ts's S4.2 keystone test — a
// declarative_rule package + M2 profile-driven scenario that reliably fires
// REST_PROPOSAL, gets accepted once (exercising recovery), then completes.
// See that file's docstring for full fixture provenance.
async function driveToCompletion(planId: string, runId: string): Promise<void> {
  const fx = loadFixture('run_log_e2e')
  const { package: pkg, scenario, presets, parameters, hyperparameters, runMode, recoveryOptionId, restSpot } = fx.input

  const { draft } = createDraft({ planId, package: pkg, scenario, presets, parameters, hyperparameters, runMode })
  expect(draft.validation_errors).toEqual([])

  await createRun(planId, runId)

  let acceptedOnce = false
  let outcome
  let guard = 0
  do {
    guard += 1
    if (guard > 1000) throw new Error('run did not complete within 1000 ticks — REST_PROPOSAL likely never fired')
    outcome = await tick(runId)
    if (outcome.completed) break
    if (outcome.paused) {
      if (!acceptedOnce) {
        expect(outcome.decision?.result_type).toBe('REST_PROPOSAL')
        await action(runId, 'accept_rest', { recoveryOptionId, restSpot })
        acceptedOnce = true
      } else {
        await action(runId, 'decline')
      }
    }
  } while (!outcome.completed)

  expect(acceptedOnce, 'the fixture flow must exercise exactly one accept_rest action').toBe(true)
}

describe('resolveRunLog — IndexedDB rehydration for inactive runs (parity with Python _resolve_run_log)', () => {
  it('reconstructs the RunLog for a completed run after "reload" (clearRegistry), byte-identical to the pre-clear active RunLog', async () => {
    const planId = 'plan-rehydrate-test'
    const runId = 'run-rehydrate-test'
    await driveToCompletion(planId, runId)

    const activeLog = await getActiveRunLog(runId)
    expect(activeLog).not.toBeNull()

    // Capture pre-clear evidence artifacts for later parity checks.
    const evidenceBefore = await getEvidence(runId)
    const exportBefore = await exportRun(runId)

    // ── Simulate a page reload: registry wiped, IndexedDB persists ─────────
    clearRegistry()
    expect(getRun(runId)).toBeNull() // confirms the run is now inactive

    // ── resolveRunLog directly ──────────────────────────────────────────────
    const rehydrated = await resolveRunLog(runId)
    expectParity(rehydrated, activeLog)

    // ── getRunLog (api/client.ts seam) ──────────────────────────────────────
    const logViaClient = await getRunLog(runId)
    expectParity(logViaClient, activeLog)

    // ── getEvidence (report_id/timestamp regenerate — normalize before compare) ──
    const evidenceAfter = await getEvidence(runId)
    const evidenceAfterNormalized = {
      ...evidenceAfter,
      report_id: evidenceBefore.report_id,
      timestamp: evidenceBefore.timestamp,
    }
    expectParity(evidenceAfterNormalized, evidenceBefore)

    // ── getEvidenceMarkdown — render both sides from the SAME normalized
    // report so report_id/timestamp non-determinism doesn't break the compare.
    const mdBefore = renderEvidenceMarkdown(evidenceBefore)
    const mdAfterViaSeam = await getEvidenceMarkdown(runId)
    const mdAfterNormalized = renderEvidenceMarkdown(evidenceAfterNormalized)
    expect(mdAfterNormalized).toBe(mdBefore)
    // The seam's own (non-normalized) output differs only in the Report
    // ID/Timestamp lines — strip them before the final equality check.
    const stripReportMeta = (md: string) =>
      md.replace(/^- \*\*Report ID\*\*:.*$/m, '').replace(/^- \*\*Timestamp\*\*:.*$/m, '')
    expect(stripReportMeta(mdAfterViaSeam)).toBe(stripReportMeta(mdBefore))

    // ── exportRun ────────────────────────────────────────────────────────────
    const exportAfter = await exportRun(runId)
    expectParity(exportAfter, exportBefore)
  })

  it('throws a 404-equivalent error for an unknown run_id (neither active nor persisted)', async () => {
    await expect(resolveRunLog('run-does-not-exist')).rejects.toThrow(/not found/i)
  })

  it('getRunLog also throws for an unknown run_id, matching resolveRunLog', async () => {
    await expect(getRunLog('run-does-not-exist')).rejects.toThrow(/not found/i)
  })
})

describe('exportAllRuns — no longer session-active-only (S8.3 review finding)', () => {
  it('returns persisted runs after clearRegistry, not just currently-active ones', async () => {
    const planId = 'plan-rehydrate-export-all'
    const runId = 'run-rehydrate-export-all'
    await driveToCompletion(planId, runId)

    clearRegistry()
    expect(getRun(runId)).toBeNull()

    const dump = await exportAllRuns()
    expect(dump.runs.some((r) => r.run_id === runId)).toBe(true)

    const exported = dump.runs.find((r) => r.run_id === runId)!
    const direct = await exportRun(runId)
    expectParity(exported, direct)
  })
})

describe('importRun active-guard (S8.3 Important finding)', () => {
  async function makeActiveRun(): Promise<string> {
    const plan = await createRunPlan({ packageId: 'nri_fatigue_score_v1', scenarioId: 'uc01_fatigue_recovery_v0_1' })
    const run = await clientCreateRun((plan as any).plan_id)
    await tickRun(run.run_id) // produces an algorithm_error event (python_module unsupported) — run stays active/paused
    return run.run_id
  }

  it('refuses to import over a currently-active run_id', async () => {
    const runId = await makeActiveRun()
    expect(getRun(runId)).not.toBeNull() // confirms the run is active

    const dump = await exportRun(runId)
    await expect(importRun(dump)).rejects.toThrow(/active/i)
  })

  it('still allows importing for a non-active run_id (existing round-trip, unaffected)', async () => {
    const runId = await makeActiveRun()
    const dump = await exportRun(runId)

    // Simulate the run no longer being active (reload) before re-importing —
    // the realistic scenario the guard is meant to allow.
    clearRegistry()
    expect(getRun(runId)).toBeNull()

    await expect(importRun(dump)).resolves.not.toThrow()
  })
})
