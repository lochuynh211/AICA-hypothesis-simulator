import { describe, expect, it } from 'vitest'
import {
  loadMatrix,
  resolveMatrix,
  MatrixResolutionError,
  MatrixValidationError,
  type PurposeStageServiceMatrix,
} from '../src/engine/proposal/matrix'
import { loadFixture } from '../src/engine/__fixtures__/parity'

/**
 * Conformance test for `src/engine/proposal/matrix.ts` — the port of
 * `app/api/aica_api/models/proposal/matrix.py` (feature 026, htmlapp
 * Combined export, slice C4a Task 1).
 *
 * Fixture: `src/engine/__fixtures__/parity/proposal_matrix.json`, captured
 * by `scripts/gen/capture_all.py#_capture_proposal_matrix` — REAL committed
 * `proposal_contracts/matrix/purpose_stage_matrix.v1.json` for the
 * load()+resolve() success paths, plus SYNTHETIC (labeled) tampered copies
 * for the 3 model_validators' raise branches (the real frozen artifact is
 * always valid, so those branches are unreachable through it — mirrors
 * `app/api/tests/proposal/test_matrix_resolver.py`'s own direct-
 * construction technique for the identical reason).
 *
 * ── Branch coverage table (per the task brief's reporting rule) ────────────
 *
 * `loadMatrix` success path: REAL — the golden's `real_matrix` input loads
 * cleanly and its `matrix_version`/6-row shape (incl. the `during_rest_stopped`
 * row's `_note` extra key, tolerated) are asserted directly.
 *
 * `buildRow` field validation (all reachable, all SYNTHETIC — see fixture doc):
 *   - `trigger_purpose` not a known member -> REACHED
 *     (`invalid_trigger_purpose_raises`).
 *   - `lifecycle_stage` not a known member -> REACHED
 *     (`invalid_lifecycle_stage_raises`).
 *   - `allowed_service_ids` containing an unknown `ServiceId` -> REACHED,
 *     byte-exact message (`invalid_service_id_msg`).
 *   - `trigger_purpose`/`lifecycle_stage` not a string, `allowed_service_ids`
 *     not an array, a row that is not an object at all -> NOT REACHED by
 *     any fixture (no Python test exercises these either — see matrix.ts's
 *     own doc for why these structural checks are out of this port's
 *     documented scope: the one real caller is a single frozen artifact,
 *     never untrusted input). Exercised here by 4 small HAND-WRITTEN
 *     (non-golden) cases below instead, so the throw path itself is at
 *     least smoke-tested even though the exact message text is not
 *     Python-verified for these.
 *
 * `checkRowCompatibility` (both branches of `purpose_stage_compatible`):
 *   - REST_STAGES-incompatible branch -> REACHED, byte-exact message
 *     (`rest_stage_incompatible_msg`).
 *   - `active_driving_content`-incompatible branch -> REACHED for
 *     PASS/FAIL only (`active_driving_incompatible_raises: true`) — the
 *     message text is NOT captured (hash-seed-dependent `frozenset`
 *     iteration order in Python's own `_ACTIVE_DRIVING_PURPOSES`, see
 *     matrix.ts's hazard-4 note); this test independently asserts the TS
 *     message against `matrix.ts`'s own FIXED declaration order instead of
 *     against a Python golden, since no single Python run's order is
 *     reproducible byte-for-byte.
 *
 * `loadMatrix`'s two `PurposeStageServiceMatrix` model_validators:
 *   - wrong row count -> REACHED, byte-exact message (`wrong_row_count_msg`).
 *   - post-rest row wrong COUNT (1 of 5) -> REACHED, byte-exact message
 *     (`post_rest_wrong_count_msg`).
 *   - post-rest row right COUNT but wrong MEMBERS (swap one for
 *     `music_playlist`) -> REACHED, byte-exact message
 *     (`post_rest_wrong_members_msg`) — a DIFFERENT branch reach than the
 *     wrong-count case (both hit the same `if (!sameSet)` guard, but only
 *     the members case proves the guard compares by VALUE, not just length).
 *
 * `resolveMatrix`:
 *   - all 6 real rows resolve to exactly their own committed
 *     `allowed_service_ids`, order preserved -> REACHED
 *     (`resolve_cases`, exercises the row-order-preserving `for...of` scan,
 *     hazard 4 N/A).
 *   - incompatible pair (fails the compatibility rule, never a matrix row)
 *     -> REACHED, byte-exact message (`resolution_error_incompatible`).
 *   - structurally-valid-but-unrepresented pair -> REACHED, byte-exact
 *     message (`resolution_error_unknown_pair`) — a DIFFERENT reason for
 *     "no row matches" than the incompatible case, both produce the SAME
 *     error TYPE (`MatrixResolutionError`) but exercise the loop's
 *     never-found path via two independently real inputs.
 */

const { input, output } = loadFixture('proposal_matrix')

describe('loadMatrix — success path (real committed matrix)', () => {
  it('loads the real frozen matrix, tolerating the during_rest_stopped row\'s `_note` key', () => {
    const matrix = loadMatrix(input.real_matrix)
    expect(matrix.matrix_version).toBe(output.matrix_version)
    expect(matrix.rows).toHaveLength(6)
    const duringRest = matrix.rows.filter(
      (r) => r.trigger_purpose === 'rest_recommended' && r.lifecycle_stage === 'during_rest_stopped',
    )
    expect(duringRest).toHaveLength(1)
    expect(duringRest[0].allowed_service_ids).toEqual([])
  })
})

describe('resolveMatrix — real committed rows', () => {
  it('resolves all 6 real rows to exactly their own committed allowed_service_ids, order preserved', () => {
    const matrix = loadMatrix(input.real_matrix)
    output.resolve_cases.forEach((c: any) => {
      const resolved = resolveMatrix(matrix, c.trigger_purpose, c.lifecycle_stage)
      expect(resolved).toEqual(c.allowed_service_ids)
    })
  })

  it('throws MatrixResolutionError with the byte-exact Python message for an incompatible pair', () => {
    const matrix = loadMatrix(input.real_matrix)
    expect(() => resolveMatrix(matrix, 'route_music', 'before_rest_until_stop')).toThrow(MatrixResolutionError)
    try {
      resolveMatrix(matrix, 'route_music', 'before_rest_until_stop')
      expect.fail('expected loadMatrix/resolveMatrix to throw')
    } catch (e) {
      expect((e as Error).message).toBe(output.resolution_error_incompatible)
    }
  })

  it('throws MatrixResolutionError with the byte-exact Python message for a structurally-valid-but-unrepresented pair', () => {
    const matrix = loadMatrix(input.real_matrix)
    try {
      resolveMatrix(matrix, 'child_passenger_experience', 'during_rest_stopped')
      expect.fail('expected loadMatrix/resolveMatrix to throw')
    } catch (e) {
      expect(e).toBeInstanceOf(MatrixResolutionError)
      expect((e as Error).message).toBe(output.resolution_error_unknown_pair)
    }
  })
})

describe('MatrixRow field validation (synthetic — see fixture doc)', () => {
  it('rejects an unknown trigger_purpose', () => {
    expect(() =>
      loadMatrix({
        matrix_version: 'v1',
        rows: [{ trigger_purpose: 'not_a_real_purpose', lifecycle_stage: 'before_rest_until_stop', allowed_service_ids: [] }],
      }),
    ).toThrow(MatrixValidationError)
    expect(output.row_validators.invalid_trigger_purpose_raises).toBe(true)
  })

  it('rejects an unknown lifecycle_stage', () => {
    expect(() =>
      loadMatrix({
        matrix_version: 'v1',
        rows: [{ trigger_purpose: 'rest_recommended', lifecycle_stage: 'not_a_real_stage', allowed_service_ids: [] }],
      }),
    ).toThrow(MatrixValidationError)
    expect(output.row_validators.invalid_lifecycle_stage_raises).toBe(true)
  })

  it('rejects an unknown service id in allowed_service_ids with the byte-exact Python enum message', () => {
    let message = ''
    try {
      loadMatrix({
        matrix_version: 'v1',
        rows: [
          { trigger_purpose: 'rest_recommended', lifecycle_stage: 'before_rest_until_stop', allowed_service_ids: ['not_a_real_service_id'] },
        ],
      })
      expect.fail('expected loadMatrix/resolveMatrix to throw')
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toContain(output.row_validators.invalid_service_id_msg)
  })

  it('tolerates an extra unrecognised key on a row (mirrors pydantic extra="ignore")', () => {
    const matrix = loadMatrix({
      matrix_version: 'v1',
      rows: [
        {
          trigger_purpose: 'rest_recommended',
          lifecycle_stage: 'during_rest_stopped',
          allowed_service_ids: [],
          _note: 'explanatory text, not part of the contract',
          another_unknown_key: 123,
        },
        ...input.real_matrix.rows.filter((r: any) => r.lifecycle_stage !== 'during_rest_stopped'),
      ],
    })
    expect(matrix.rows[0].allowed_service_ids).toEqual([])
    expect(output.row_validators.tolerates_note_key).toBe(true)
  })

  // Hand-written, non-golden: structural type checks Python's own test
  // suite never exercises either (see the module doc's coverage table) —
  // smoke-tested here so the throw path itself is proven reachable.
  it('rejects a row that is not an object', () => {
    expect(() => loadMatrix({ matrix_version: 'v1', rows: ['not-an-object'] })).toThrow(MatrixValidationError)
  })

  it('rejects a non-array allowed_service_ids', () => {
    expect(() =>
      loadMatrix({
        matrix_version: 'v1',
        rows: [{ trigger_purpose: 'rest_recommended', lifecycle_stage: 'before_rest_until_stop', allowed_service_ids: 'not-an-array' }],
      }),
    ).toThrow(MatrixValidationError)
  })

  it('rejects a non-object top-level payload', () => {
    expect(() => loadMatrix('not-an-object')).toThrow(MatrixValidationError)
    expect(() => loadMatrix(null)).toThrow(MatrixValidationError)
  })

  it('rejects a non-array rows field', () => {
    expect(() => loadMatrix({ matrix_version: 'v1', rows: 'not-an-array' })).toThrow(MatrixValidationError)
  })
})

describe('purpose_stage_compatible (MatrixRow model_validator)', () => {
  it('rejects a rest-stage row whose purpose is not rest_recommended, with the byte-exact Python message', () => {
    let message = ''
    try {
      loadMatrix({
        matrix_version: 'v1',
        rows: [{ trigger_purpose: 'route_music', lifecycle_stage: 'during_rest_stopped', allowed_service_ids: [] }],
      })
      expect.fail('expected loadMatrix/resolveMatrix to throw')
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toBe(output.row_validators.rest_stage_incompatible_msg)
  })

  it('rejects an active_driving_content row whose purpose is rest_recommended (message NOT Python-golden-compared — see doc)', () => {
    expect(output.row_validators.active_driving_incompatible_raises).toBe(true)
    let message = ''
    try {
      loadMatrix({
        matrix_version: 'v1',
        rows: [{ trigger_purpose: 'rest_recommended', lifecycle_stage: 'active_driving_content', allowed_service_ids: [] }],
      })
      expect.fail('expected loadMatrix/resolveMatrix to throw')
    } catch (e) {
      message = (e as Error).message
    }
    // TS's own FIXED declaration order — deliberately NOT compared against
    // a captured Python string (hazard 4, hash-seed-dependent frozenset
    // order — see matrix.ts's doc comment).
    expect(message).toBe(
      "Lifecycle stage 'active_driving_content' is only compatible with purposes ['inattentive_driving_prevention_recovery', 'route_music', 'child_passenger_experience'], but got 'rest_recommended'.",
    )
  })
})

describe('PurposeStageServiceMatrix model_validators', () => {
  const realRows = input.real_matrix.rows

  it('rejects a matrix with the wrong row count, with the byte-exact Python message', () => {
    let message = ''
    try {
      loadMatrix({ matrix_version: 'v1', rows: realRows.slice(0, 5) })
      expect.fail('expected loadMatrix/resolveMatrix to throw')
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toBe(output.matrix_validators.wrong_row_count_msg)
  })

  it('rejects a post-rest row with the wrong service COUNT, with the byte-exact Python message', () => {
    const rows = realRows.map((r: any) =>
      r.trigger_purpose === 'rest_recommended' && r.lifecycle_stage === 'after_rest_before_restart'
        ? { ...r, allowed_service_ids: ['live_viewing'] }
        : r,
    )
    let message = ''
    try {
      loadMatrix({ matrix_version: 'v1', rows })
      expect.fail('expected loadMatrix/resolveMatrix to throw')
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toBe(output.matrix_validators.post_rest_wrong_count_msg)
  })

  it('rejects a post-rest row with the right COUNT but wrong MEMBERS, with the byte-exact Python message', () => {
    const rows = realRows.map((r: any) =>
      r.trigger_purpose === 'rest_recommended' && r.lifecycle_stage === 'after_rest_before_restart'
        ? { ...r, allowed_service_ids: ['live_viewing', 'stretch_video', 'full_karaoke', 'oshi_reexperience', 'music_playlist'] }
        : r,
    )
    let message = ''
    try {
      loadMatrix({ matrix_version: 'v1', rows })
      expect.fail('expected loadMatrix/resolveMatrix to throw')
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toBe(output.matrix_validators.post_rest_wrong_members_msg)
  })
})

describe('MatrixValidationError / MatrixResolutionError shape', () => {
  it('are distinct Error subclasses with distinguishing .name', () => {
    const matrix: PurposeStageServiceMatrix = { matrix_version: 'v1', rows: [] }
    expect(() => resolveMatrix(matrix, 'rest_recommended', 'before_rest_until_stop')).toThrow(MatrixResolutionError)
    try {
      resolveMatrix(matrix, 'rest_recommended', 'before_rest_until_stop')
    } catch (e) {
      expect((e as Error).name).toBe('MatrixResolutionError')
    }
    try {
      loadMatrix({ matrix_version: 'v1', rows: [] })
    } catch (e) {
      expect((e as Error).name).toBe('MatrixValidationError')
    }
  })
})
