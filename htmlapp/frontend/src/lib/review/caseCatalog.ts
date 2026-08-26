// htmlapp/frontend/src/lib/review/caseCatalog.ts
//
// PROTECTED htmlapp-owned re-implementation, NOT a sync of
// app/frontend/src/lib/review/caseCatalog.ts. Mechanically guarded via
// RESTORE_FROM_GIT in scripts/sync-from-app.mjs (not PROTECTED — this file
// lives inside `lib/`, a whole-directory DIRS entry the sync bulk-copies;
// see that array's comment for why RESTORE_FROM_GIT, not PROTECTED, is what
// actually survives a directory-level sync). The next `npm run sync` restores
// this exact file from git HEAD after the bulk copy overwrites it.
//
// WHY THIS EXISTS: upstream bundles cases at build time via
//   import.meta.glob('@contracts/test_cases/case-*.json', { eager: true })
// htmlapp has no `@contracts` alias, and deliberately never adds one — the
// data seam this program exists to build promises that changing preset
// test-case data never requires changing htmlapp code. That promise is
// delivered by ONE generated-data reader, src/data/registry.ts, fed by
// `npm run build:data` from combined_contracts/test_cases (see
// data.manifest.mjs's `combinedCases` source entry). This module reads
// through that seam instead of the filesystem.
//
// NOT eager, and NOT memoized: unlike upstream's `{ eager: true }` glob
// (which resolves once at module load because Vite inlines the matched files
// as plain object literals — there is nothing to defer or recompute), this
// module recomputes from the registry on every listCases()/getCase() call,
// same as every other registry.ts getter (`getPresets`, `getScenarioDefs`,
// …) — none of them cache either. Three reasons that matters, not just style
// or consistency:
//   1. Safety — the registry is only guaranteed installed once
//      `ensureRegistry()` has run (main.tsx does this synchronously before
//      `./App`, and therefore this module, is ever reached, via a *dynamic*
//      `import()` that nothing can race). A prod app-boot call sequence
//      guarantees that ordering, but a Vitest module graph does not: static
//      imports across a test file's whole dependency closure are evaluated
//      before that test file's own top-level code runs, so an eager
//      `const CASES = getCombinedCases()...` at import time could run before
//      a test has had any chance to install the registry. Reading at call
//      time — well after any test's `beforeEach`/`ensureRegistry()` — avoids
//      that ordering hazard entirely.
//   2. Honest failure — the registry "not installed" / "generated data
//      missing" case must surface as a thrown DataRegistryError (see
//      registry.ts's `req()`), never as a silently-empty catalog. Reading on
//      every call means that failure is not a one-time thing a first success
//      would paper over for the rest of the process.
//   3. Testability — a module-level `const CASES = …` computed once at
//      import time cannot be exercised against more than one registry state
//      per test file: ES module evaluation is cached per path, so
//      re-importing the same module later in the same test run does not
//      re-run its top level, and nothing could reset a `const`. Reading
//      fresh on every call makes both "against the real payload" and
//      "against a synthetic payload" straightforwardly testable in the same
//      file, and makes resetRegistryForTests() behave exactly as it does for
//      every other registry consumer.
// `listCases()`'s stable-order guarantee is unaffected: the same
// deterministic sort runs every call, so the same input always yields the
// same output — "sorted", just not "cached".
//
// EXPORTED SIGNATURES AND SEMANTICS MUST STAY IDENTICAL to upstream's file:
// seven synced modules import from here (useCaseSelection.ts,
// caseResolver.ts, feedbackSummary.ts, ExperienceCasePicker.tsx,
// ReviewColumn.tsx, ExperienceCaseCard.tsx, MergedSetupPanel.tsx) and must
// compile and behave unchanged.
//
// The shapes here mirror combined_contracts/schema/combined_test_case.schema.json,
// same as upstream — that schema is the authority, and pytest validates every
// committed file against it; these types are the reader's view, not a second
// contract.
import { getCombinedCases } from '../../data/registry'
import type { BilingualLabel } from './reviewVocabulary'

export type { BilingualLabel }

export type CasePersona = {
  persona_id: string
  name: BilingualLabel
  narrative: BilingualLabel
  goals?: BilingualLabel[]
  preferences?: BilingualLabel[]
  constraints?: BilingualLabel[]
  assumptions?: BilingualLabel[]
  /** A committed proposal preset id; its driver_profile is resolved into the run. */
  profile_ref: string
  profile_ref_version?: string
}

export type CaseFixedOverrides = {
  initial_drowsiness?: number
  initial_fatigue?: number
  is_night?: boolean
  child_passenger?: boolean
  route_tags?: string[]
  destination_tags?: string[]
  multiple_passengers?: boolean
  mountain_range_km?: [number, number]
  jam_range_km?: [number, number]
}

export type CaseJourney = {
  narrative: BilingualLabel
  scenario_ref: string
  route_preset_ref: string
  seed: number
  tick_seconds: number
  fixed_overrides?: CaseFixedOverrides
  automatic_path?: {
    service_choice?: 'rank_1'
    rest_response?: 'accept' | 'decline' | 'ignore'
    sleep_minutes?: number
  }
}

export type CaseAlgorithmDefaults = { trigger: string; service: string; content: string }

export type CombinedTestCase = {
  case_id: string
  schema_version: string
  version: string
  title: BilingualLabel
  brief: BilingualLabel
  what_to_watch: BilingualLabel[]
  persona: CasePersona
  journey: CaseJourney
  algorithm_defaults: CaseAlgorithmDefaults
}

// VISIBILITY + ORDER — mirrors upstream's caseCatalog.ts (app/frontend). The
// five UC demo cases are the ONLY cases the review UI offers, in this exact
// order; the C-01…C-06 algorithm-probe cases stay committed and resolvable by
// id (see `getCase`) but are hidden from the picker and the coverage summary —
// they were authored to exercise the trigger algorithm, not as coherent
// end-to-end demo journeys, so listing them beside the UC demos misleads a
// reviewer. Visibility AND order both live here, not in the case JSON: the
// schema is strict (additionalProperties:false), so neither an `order` nor a
// `hidden` field can be added, and renaming case_ids is destructive (tests,
// run/feedback logs, this data registry).
const VISIBLE_CASE_ORDER = [
  'case-uc01-01-oshikatsu-c',
  'case-uc01-02-commuter-b',
  'case-uc03-01-monotony-a',
  'case-uc04-01-longhaul-d',
  'case-uc05-01-forecast-jam-c',
]
// -1 for a hidden case; every visible case has a unique rank, so the rank
// alone orders them (no secondary tiebreak needed).
const orderRank = (id: string): number => VISIBLE_CASE_ORDER.indexOf(id)

// ALL committed cases, read FRESH from the registry on every call (no memo —
// see the module doc at the top for the three reasons nothing here caches).
// This is htmlapp's equivalent of upstream's `ALL_CASES = Object.values(MODULES)`
// feeding `BY_ID`: `getCase` must resolve against the WHOLE set (a hidden case
// still has to map to its real title, never become null just because it is
// hidden), and `listCases` filters this down to the visible UC set.
//
// Sorted with the same localeCompare comparator upstream's file used before the
// visibility split, so the id→case map `getCase` builds has a deterministic
// winner for a duplicate case_id. That duplicate cannot currently arise
// (collect-data.mjs rejects a duplicate id before the registry is ever built),
// so this is belt-and-suspenders: `new Map(...)` keeps the LAST entry for a
// repeated key, and a sorted input makes that the later one in case_id order,
// exactly as upstream would. registry.getCombinedCases() already returns
// records in `Object.keys(...).sort()` order, but that is an implementation
// detail of the registry's generic `values()` helper, not a contract this
// module should lean on.
//
// registry.getCombinedCases() is typed as CombinedCaseDoc[] (only `case_id`
// is guaranteed) because the registry is schema-agnostic by design — it does
// not know the shape of any one collection's records. The richer
// CombinedTestCase shape is validated upstream by pytest against
// combined_test_case.schema.json before a case file is ever committed, so
// this cast carries the same trust the original `import.meta.glob<CombinedTestCase>`
// generic parameter did: a compile-time assertion, not a runtime check.
function allCases(): CombinedTestCase[] {
  return (getCombinedCases() as unknown as CombinedTestCase[])
    .slice()
    .sort((a, b) => a.case_id.localeCompare(b.case_id))
}

// EXACTLY the visible UC cases, in VISIBLE_CASE_ORDER order. `filter` preserves
// order and the rank `sort` then fully orders the survivors, so the result is
// the same regardless of `allCases()`'s own sort — recomputed on every call,
// same as every other registry getter.
export const listCases = (): CombinedTestCase[] =>
  allCases()
    .filter((c) => orderRank(c.case_id) !== -1)
    .sort((a, b) => orderRank(a.case_id) - orderRank(b.case_id))

/** Null rather than a throw: an unknown id is a stale selection, not a crash.
 *  Resolves hidden cases too — `byId` is built from `allCases()`, the FULL set
 *  — so a run-log replay or feedback filed against a now-hidden case still
 *  names it. Rebuilds the map from a fresh `allCases()` on every call (see the
 *  module doc for why nothing here is memoized). */
export const getCase = (caseId: string): CombinedTestCase | null => {
  const byId = new Map(allCases().map((c) => [c.case_id, c]))
  return byId.get(caseId) ?? null
}
