import { describe, expect, it } from 'vitest'
import {
  resolveRunSetup,
  assertServiceCapabilitiesComplete,
  nowIso,
  makeOpportunityId,
  getServiceCapabilities,
  getMatrix,
  type RunSetupBody,
} from '../src/engine/proposal/orchestrator/context_base'
import { resolveMatrix } from '../src/engine/proposal/matrix'
import { ensureRegistry, getServiceCapabilities as getRawServiceCapabilities } from '../src/data/registry'
import { loadFixture } from '../src/engine/__fixtures__/parity'

/**
 * Conformance test for `src/engine/proposal/orchestrator/context_base.ts` —
 * the port of the small, non-endpoint private helpers at the top of
 * `app/api/aica_api/routers/proposal.py` (feature 026, htmlapp Combined
 * export, slice C4a Task 1).
 *
 * Fixture: `src/engine/__fixtures__/parity/proposal_context_base.json`,
 * captured by `scripts/gen/capture_all.py#_capture_proposal_context_base` —
 * REAL `CreateProposalRunBody`/`World` pydantic types, over a REAL
 * committed seed (seed-night-highway-oshi).
 *
 * `_get_registry`/`_get_dataset_registry` are NOT re-tested here: they map
 * 1:1 onto `proposalPackageRegistry`/`datasetCatalogRegistry`
 * (`../src/engine/proposal/stores.ts`, C2 Task 1), already covered by
 * `tests/proposal_stores.test.ts` — see context_base.ts's own module doc
 * for the full mapping. `_matrix_path`/`_service_capabilities_path` have no
 * TS equivalent to test (folded into `getMatrix`/`getServiceCapabilities`
 * below).
 *
 * ── Branch coverage table (per the task brief's reporting rule) ────────────
 *
 * `resolveRunSetup` — golden's 6 cases, ALL REAL (real `CreateProposalRunBody`
 * construction + the real router function, never a hand-rolled stand-in):
 *   - typed-world path, NO top-level override (all 3 fall back to
 *     `ci.*`) -> REACHED (`typed_world_no_override`).
 *   - typed-world path, FULL top-level override (all 3 from `body.*`) ->
 *     REACHED (`typed_world_full_override`).
 *   - typed-world path, PARTIAL override (only `trigger_purpose` set,
 *     `lifecycle_stage`/`motion_state` still fall back to `ci.*`) ->
 *     REACHED (`typed_world_partial_override_trigger_purpose_only`) — this
 *     is the branch a test that only tries "all-override" or
 *     "no-override" would miss: it proves each of the 3 `??` expressions
 *     is evaluated independently, not as one all-or-nothing switch.
 *   - legacy path, all 3 top-level fields present -> REACHED
 *     (`legacy_path_all_three_present`).
 *   - legacy path, exactly 1 of 3 missing -> REACHED
 *     (`legacy_path_missing_motion_state`), raises with the byte-exact
 *     Python `detail` text.
 *   - legacy path, all 3 missing -> REACHED (`legacy_path_all_three_missing`),
 *     same error — proves the guard is an OR across all three fields, not
 *     just the first.
 * All 6 branches of the function are therefore exercised; nothing left
 * unreached.
 *
 * `nowIso`/`makeOpportunityId` — NOT golden-tested (no Python capture
 * exists for either — see context_base.ts's own doc for why: nothing
 * parses either format back apart, and two independent clocks can never
 * be compared byte-for-byte). Format-tested only, the same convention
 * already established for `makeProposalRunId`
 * (`tests/proposal_run_manager.test.ts`) and `makeMergedRunId`
 * (`tests/merged_runs_store.test.ts`).
 *
 * `getServiceCapabilities`/`getMatrix` — exercised against the REAL
 * installed data registry (`ensureRegistry()`), proving the composition
 * (`../../../data/registry.ts` raw payload + `./eligibility.ts`/
 * `./matrix.ts`'s own validated builders) actually wires together, not
 * merely type-checks.
 */

ensureRegistry()

const { input, output } = loadFixture('proposal_context_base')

describe('resolveRunSetup', () => {
  const seedControlInputs = input.seed_control_inputs as {
    trigger_purpose: string
    lifecycle_stage: string
    motion_state: string
  }

  function bodyFor(c: any): RunSetupBody {
    const body: RunSetupBody = {
      trigger_purpose: c.body.trigger_purpose ?? undefined,
      lifecycle_stage: c.body.lifecycle_stage ?? undefined,
      motion_state: c.body.motion_state ?? undefined,
    }
    if (c.body.world_control_inputs != null) {
      body.world = { control_inputs: c.body.world_control_inputs }
    }
    return body
  }

  output.resolve_run_setup_cases.forEach((c: any) => {
    if (c.raises) {
      it(`${c.name}: throws with the byte-exact Python detail text`, () => {
        expect(() => resolveRunSetup(bodyFor(c))).toThrow(c.detail)
      })
    } else {
      it(`${c.name}: resolves to the expected (triggerPurpose, lifecycleStage, motionState)`, () => {
        const result = resolveRunSetup(bodyFor(c))
        expect(result).toEqual(c.result)
      })
    }
  })

  it('sanity: the seed world\'s own control_inputs (real committed data) match the captured input', () => {
    expect(seedControlInputs.trigger_purpose).toBe('rest_recommended')
    expect(seedControlInputs.lifecycle_stage).toBe('before_rest_until_stop')
    expect(seedControlInputs.motion_state).toBe('driving')
  })
})

describe('nowIso', () => {
  it('produces an ISO-8601 UTC string (format-tested only — see module doc)', () => {
    const iso = nowIso()
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(() => new Date(iso).toISOString()).not.toThrow()
  })
})

describe('makeOpportunityId', () => {
  it('matches the op_<id>_<6hex> shape (format diverges from Python\'s strftime by design — see module doc)', () => {
    const id = makeOpportunityId()
    expect(id).toMatch(/^op_[0-9a-z]+_[0-9a-f]{6}$/)
  })

  it('generates distinct ids across many calls', () => {
    const ids = new Set(Array.from({ length: 50 }, () => makeOpportunityId()))
    expect(ids.size).toBe(50)
  })
})

describe('getServiceCapabilities', () => {
  it('composes the real committed payload into a working ServiceCapabilities lookup', () => {
    const capabilities = getServiceCapabilities()
    const musicPlaylist = capabilities.get('music_playlist')
    expect(musicPlaylist.service_id).toBe('music_playlist')
    expect(typeof musicPlaylist.driving_capable).toBe('boolean')
  })

  it('throws for an unknown service id (mirrors the underlying builder)', () => {
    expect(() => getServiceCapabilities().get('not_a_real_service_id' as any)).toThrow()
  })
})

describe('getMatrix', () => {
  it('composes the real committed payload into a working, validated matrix', () => {
    const matrix = getMatrix()
    expect(matrix.matrix_version).toBe('v1')
    expect(matrix.rows).toHaveLength(6)
  })

  it('the composed matrix resolves exactly like the direct loadMatrix() path', () => {
    const matrix = getMatrix()
    const resolved = resolveMatrix(matrix, 'rest_recommended', 'after_rest_before_restart')
    expect(resolved).toEqual(['live_viewing', 'stretch_video', 'full_karaoke', 'oshi_reexperience', 'call_response_stopped'])
  })
})

// ---------------------------------------------------------------------------
// assertServiceCapabilitiesComplete — mirrors ServiceCapabilities.load()'s
// EAGER completeness check (models/proposal/service_capabilities.py:90-95).
// Python fails once at load naming EVERY missing ServiceId; without this the
// only guard is `.get()`'s lazy per-key throw, which fires mid-run naming one
// id. That is a divergence in WHEN the failure happens, not just its wording.
//
// The check sits at the load() seam, not in `buildServiceCapabilities`: in
// Python the model constructor validates nothing, so a partial
// ServiceCapabilities is legitimate and the eligibility parity tests build one.
// ---------------------------------------------------------------------------
describe('assertServiceCapabilitiesComplete', () => {
  it('accepts the real committed artifact unchanged', () => {
    expect(() => assertServiceCapabilitiesComplete(getRawServiceCapabilities())).not.toThrow()
  })

  it('names ALL missing members at once, sorted, in Python list-repr shape', () => {
    const full = getRawServiceCapabilities()
    const partial = {
      ...full,
      services: full.services.filter(
        (s) => s.service_id !== 'humming_karaoke' && s.service_id !== 'radio_style',
      ),
    }
    // Byte-for-byte the message a live Python interpreter emits for these two.
    expect(() => assertServiceCapabilitiesComplete(partial)).toThrow(
      "service_capabilities artifact is missing ServiceId member(s): ['humming_karaoke', 'radio_style']",
    )
  })

  it('reports every missing member, not merely the first', () => {
    const full = getRawServiceCapabilities()
    let message = ''
    try {
      assertServiceCapabilitiesComplete({ ...full, services: [full.services[0]] })
    } catch (err) {
      message = (err as Error).message
    }
    // 14 ServiceId members, 1 supplied -> 13 named. The lazy .get() guard this
    // replaces could only ever have named one.
    expect(message.split(',')).toHaveLength(13)
  })
})
