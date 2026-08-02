import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mergeAlgorithmConfig } from '../src/engine/proposal/algorithm_config'
import { validateWorld, hasCatalogReferences, type SongDoc } from '../src/engine/proposal/world_validation'
import { applyOverrides, InvalidOverrideError, type FieldOverride, type WorldDoc } from '../src/engine/proposal/world_overrides'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'

/**
 * Parity tests — reproduces `merge_algorithm_config()`, `validate_world()`,
 * and `apply_overrides()` byte-for-byte over the cases captured from the
 * real Python functions (see `scripts/gen/capture_all.py`'s
 * `_capture_algorithm_config` / `_capture_world_validation` /
 * `_capture_world_overrides`). Per-rule coverage table and hazard verdicts
 * are in the task report. `InvalidOverrideError` raise-condition TS-logic
 * assertions (including the un-capturable empty-path case) live in
 * `world_overrides_validation.test.ts`.
 */

describe('mergeAlgorithmConfig parity', () => {
  it('reproduces merge_algorithm_config() over the captured case set', () => {
    const { input, output } = loadFixture('algorithm_config')
    input.cases.forEach((c: any, i: number) => {
      const merged = mergeAlgorithmConfig(c.defaults, c.overrides)
      expectParity(merged, output.results[i].merged, `case[${i}] (${c.name})`)
    })
  })

  it('never mutates defaults, and result is a fresh object even for a None override (TS-logic isolation check)', () => {
    const defaults = { nested: { x: 1 } }
    const result = mergeAlgorithmConfig(defaults, null)
    expect(result).toEqual(defaults)
    expect(result).not.toBe(defaults)
    expect(result.nested).not.toBe(defaults.nested)
  })

  it('repeated merges against the same defaults do not accumulate state (TS-logic isolation check)', () => {
    const defaults = { x: { y: 1 } }
    const r1 = mergeAlgorithmConfig(defaults, { x: { y: 2 } })
    const r2 = mergeAlgorithmConfig(defaults, { x: { y: 3 } })
    expect((r1.x as any).y).toBe(2)
    expect((r2.x as any).y).toBe(3)
    expect(defaults).toEqual({ x: { y: 1 } })
  })
})

describe('validateWorld parity', () => {
  it('reproduces validate_world() over the real committed seed, mutated per case, plus real dataset catalog', () => {
    const { input, output } = loadFixture('world_validation')
    input.cases.forEach((c: any, i: number) => {
      const issues = validateWorld(c.world as WorldDoc, REAL_CATALOG)
      expectParity(issues, output.results[i].issues, `case[${i}] (${c.name})`)
    })
  })
})

describe('applyOverrides parity', () => {
  it('reproduces apply_overrides() success cases (empty overrides, FieldOverride-shape, dict-shape)', () => {
    const { output } = loadFixture('world_overrides')
    output.success.forEach((c: any) => {
      const overrides = c.overrides as FieldOverride[]
      const { world, diffs } = applyOverrides(BASE_WORLD, overrides, {
        catalog: c.use_catalog ? REAL_CATALOG : null,
      })
      expectParity(world, c.world, `success case (${c.name}) world`)
      expectParity(diffs, c.diffs, `success case (${c.name}) diffs`)
    })
  })

  it('reproduces apply_overrides() raise cases — thrown InvalidOverrideError.issues byte-for-byte', () => {
    const { output } = loadFixture('world_overrides')
    output.raises.forEach((c: any) => {
      const overrides = c.overrides as FieldOverride[]
      let thrown: unknown
      try {
        applyOverrides(BASE_WORLD, overrides, { catalog: c.use_catalog ? REAL_CATALOG : null })
      } catch (e) {
        thrown = e
      }
      expect(thrown, `raise case (${c.name}) should throw`).toBeInstanceOf(InvalidOverrideError)
      expectParity((thrown as InvalidOverrideError).issues, c.issues, `raise case (${c.name}) issues`)
    })
  })

  it('a world with NO catalog references applies without a catalog and never raises unresolvable_catalog (TS-logic — hasCatalogReferences false branch)', () => {
    // BASE_WORLD (seed-night-highway-oshi) DOES have catalog references
    // (oshi_artists, played_items, content_*_rate all non-empty — see the
    // dangling_catalog_reference_without_catalog raise case above, which
    // exercises the TRUE branch). This strips every catalog-reference-
    // bearing driver_profile field to empty, proving the FALSE branch: no
    // catalog supplied, but none is needed either.
    const stripped: WorldDoc = JSON.parse(JSON.stringify(BASE_WORLD))
    const profile = stripped.driver_profile as Record<string, unknown>
    for (const field of [
      'oshi_artists', 'played_items', 'skipped_items', 'changed_from_items',
      'completed_items', 'manually_selected_items', 'repeated_items',
    ]) {
      profile[field] = []
    }
    for (const field of [
      'catalog_item_usage_level', 'catalog_item_recency_state',
      'content_proposal_acceptance_rate', 'content_recovery_rate',
      'content_proposal_acceptance_confidence', 'content_recovery_confidence',
    ]) {
      profile[field] = {}
    }

    expect(hasCatalogReferences(stripped)).toBe(false)

    const { world, diffs } = applyOverrides(stripped, [{ path: 'situation.drowsiness_level', value: 5 }])
    expect((world.situation as Record<string, unknown>).drowsiness_level).toBe(5)
    expect(diffs).toEqual([{ path: 'situation.drowsiness_level', before: 80, after: 5 }])
  })
})

// ---------------------------------------------------------------------------
// Shared fixture data — the same real committed seed/catalog the capture rig
// used (world_validation.json / world_overrides.json both embed `dataset_id`;
// the base world itself is embedded per-case in world_validation.json's
// `valid_world_no_issues` case, and reused here as BASE_WORLD for the
// apply_overrides parity block, matching the capture rig's own
// `seed-night-highway-oshi` base).
// ---------------------------------------------------------------------------

const worldValidationFixture = loadFixture('world_validation')
const BASE_WORLD: WorldDoc = worldValidationFixture.input.cases.find(
  (c: any) => c.name === 'valid_world_no_issues',
).world

const REAL_CATALOG: SongDoc[] = (() => {
  const datasetId = worldValidationFixture.input.dataset_id as string
  const path = resolve(__dirname, '..', '..', '..', 'proposal_contracts', 'dataset', datasetId, 'catalog.json')
  return JSON.parse(readFileSync(path, 'utf8'))
})()
