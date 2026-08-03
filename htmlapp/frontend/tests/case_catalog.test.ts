// tests/case_catalog.test.ts
//
// Unit coverage for src/lib/review/caseCatalog.ts's PROTECTED
// registry-backed re-implementation (feature 026, htmlapp Combined export,
// slice C5 Task 3b). This is deliberately NOT the whole proof of that task:
// a unit test only shows the module behaves correctly once it is already
// importable — it cannot show the Vite build-time `import.meta.glob`
// resolution failure the task exists to fix is actually gone. See the task
// report for the separate `npm run build` reachability proof.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  installRegistry,
  resetRegistryForTests,
  ensureRegistry,
  type AicaDataPayload,
} from '../src/data/registry'
import { listCases, getCase } from '../src/lib/review/caseCatalog'

// tests/setup.ts only assigns globalThis.__AICA_DATA__; this call is what
// actually installs it into the registry's own `installed` singleton (see
// registry.ts's req()/installed distinction) that getCombinedCases() reads.
ensureRegistry()

// Read independently from disk (same idiom as tests/registry.test.ts's own
// REAL), not from globalThis.__AICA_DATA__ — the last describe block below
// deletes that global to simulate "generated data missing", so a fixture
// sourced from it would be gone by the time later tests need to restore it.
const REAL: AicaDataPayload = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'data', 'aica-data.json'), 'utf8'),
)

const REAL_CASE_IDS = [
  'case-c01-alert-daytime-control',
  'case-c02-night-highway-drowsiness',
  'case-c03-monotonous-highway',
  'case-c04-mountain-road-workload',
  'case-c05-late-night-traffic-jam',
  'case-c06-full-rest-lifecycle',
]

describe('caseCatalog — against the real generated payload', () => {
  it('listCases() returns every committed case, sorted ascending by case_id', () => {
    const ids = listCases().map((c) => c.case_id)
    // Exact equality, not just "contains" / "length > 0": guards against a
    // sort that silently drops or duplicates an entry, not just a wrong count.
    expect(ids).toEqual(REAL_CASE_IDS)
  })

  it('listCases() entries carry the full CombinedTestCase shape, not just an id', () => {
    const c01 = listCases().find((c) => c.case_id === 'case-c01-alert-daytime-control')!
    expect(c01.persona.profile_ref).toBeTruthy()
    expect(c01.journey.scenario_ref).toBeTruthy()
    expect(c01.algorithm_defaults.trigger).toBeTruthy()
    expect(typeof c01.title.ja).toBe('string')
    expect(typeof c01.title.en).toBe('string')
  })

  it('getCase(id) returns the same object listCases() lists for that id', () => {
    const fromList = listCases().find((c) => c.case_id === 'case-c03-monotonous-highway')
    const direct = getCase('case-c03-monotonous-highway')
    expect(direct).not.toBeNull()
    expect(direct).toEqual(fromList)
  })

  it('getCase() returns null, not a throw, for an id that does not exist', () => {
    expect(getCase('case-does-not-exist')).toBeNull()
  })

  it('getCase() returns null for an empty string id', () => {
    expect(getCase('')).toBeNull()
  })
})

describe('caseCatalog — ordering, against a synthetic payload', () => {
  function withCombinedCases(combinedCases: AicaDataPayload['combinedCases']): AicaDataPayload {
    // Deep clone: mutate a copy, never the shared REAL fixture other tests
    // in this file/process depend on (same discipline as tests/data.test.ts).
    const synthetic = JSON.parse(JSON.stringify(REAL)) as AicaDataPayload
    synthetic.combinedCases = combinedCases
    return synthetic
  }

  it("sorts by case_id via localeCompare — NOT whatever order the registry's own default-string-sorted values() happens to produce", () => {
    // Deliberately chosen so the two comparators disagree: JS's default
    // `Array.prototype.sort()` (what registry.ts's `values()` helper —
    // `Object.keys(rec).sort()` — uses) ranks 'case-B' before 'case-a'
    // (UTF-16 code unit order: 'B' is 66, 'a' is 97), while
    // `'case-a'.localeCompare('case-B')` ranks the other way (locale
    // collation). If this module ever stopped applying its own localeCompare
    // sort — e.g. trusted the registry's order outright — this is the case
    // that would catch it: the registry's own sort still produces SOME
    // order, so a test that only asserted "some sorted order" would stay
    // green for the wrong reason.
    //
    // Cloned from a real committed case rather than hand-built, so its
    // persona/journey/algorithm_defaults refs are real preset/scenario/
    // route/package ids and pass validateReferences() unmodified — only
    // case_id changes.
    const template = REAL.combinedCases['case-c01-alert-daytime-control']
    const minimalCase = (id: string) => ({ ...template, case_id: id })

    resetRegistryForTests()
    try {
      installRegistry(
        withCombinedCases({
          'case-B': minimalCase('case-B'),
          'case-a': minimalCase('case-a'),
        }),
      )
      expect(listCases().map((c) => c.case_id)).toEqual(['case-a', 'case-B'])
      // getCase must still resolve both individually after the reorder.
      expect(getCase('case-a')?.case_id).toBe('case-a')
      expect(getCase('case-B')?.case_id).toBe('case-B')
    } finally {
      resetRegistryForTests()
      installRegistry(REAL)
    }
  })
})

describe('caseCatalog — fails honestly when the generated data is missing', () => {
  it('listCases()/getCase() throw (do not silently return empty) when the registry was never installed', () => {
    resetRegistryForTests()
    const savedGlobal = (globalThis as Record<string, unknown>).__AICA_DATA__
    delete (globalThis as Record<string, unknown>).__AICA_DATA__
    try {
      // No ensureRegistry()/installRegistry() call — simulates the real
      // "npm run build:data was never run, aica-data.js never loaded, no
      // globalThis.__AICA_DATA__" case. A silent `[]` here would render the
      // picker with zero cases and no explanation; the actual behaviour must
      // be a thrown, readable error — this is the honest-failure end-to-end
      // path build:data's absence is supposed to produce.
      expect(() => listCases()).toThrow()
      expect(() => getCase('case-c01-alert-daytime-control')).toThrow()
    } finally {
      ;(globalThis as Record<string, unknown>).__AICA_DATA__ = savedGlobal
      resetRegistryForTests()
      installRegistry(REAL)
    }
  })
})
