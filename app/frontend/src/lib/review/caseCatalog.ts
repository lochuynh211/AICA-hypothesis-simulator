// app/frontend/src/lib/review/caseCatalog.ts
/**
 * The committed experience test cases, bundled at build time.
 *
 * Bundled rather than fetched: there is no registry endpoint, and a bundled
 * catalog is the form that survives a later export to a server-less
 * distribution unchanged. `import.meta.glob(..., { eager: true })` inlines
 * every matching file; Vite re-imports on change so cases stay live in dev.
 *
 * The shapes here mirror combined_contracts/schema/combined_test_case.schema.json.
 * That schema is the authority, and pytest validates every committed file
 * against it — these types are the reader's view, not a second contract.
 */
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

const MODULES = import.meta.glob<CombinedTestCase>('@contracts/test_cases/case-*.json', {
  eager: true,
  import: 'default',
})

// The five UC demo cases are the ONLY cases the review UI offers, in this exact
// order. The C-01…C-06 algorithm-probe cases stay committed (and resolvable by
// id — see `getCase`) but are hidden from the picker and the coverage summary:
// they were authored to exercise the trigger algorithm, not as coherent
// end-to-end demo journeys, so listing them beside the UC demos misleads a
// reviewer. Visibility AND order live here, not in the case JSON — the schema
// is strict (additionalProperties:false), so neither an `order` nor a `hidden`
// field can be added, and renaming case_ids is destructive (tests, run/feedback
// logs, htmlapp registry).
const VISIBLE_CASE_ORDER = [
  'case-uc01-01-oshikatsu-c',
  'case-uc01-02-commuter-b',
  'case-uc03-01-monotony-a',
  'case-uc04-01-longhaul-d',
  'case-uc05-01-forecast-jam-c',
]
// -1 for a hidden case; every visible case has a unique rank, so the rank alone
// orders them (no secondary tiebreak needed).
const orderRank = (id: string): number => VISIBLE_CASE_ORDER.indexOf(id)

// `getCase` must resolve EVERY committed case — a stale selection, a run-log
// replay, or feedback filed against a now-hidden case still has to map to its
// real title, never become null just because it is hidden — so BY_ID is built
// from ALL cases. `listCases` returns only the visible UC set.
const ALL_CASES: CombinedTestCase[] = Object.values(MODULES)
const BY_ID = new Map(ALL_CASES.map((c) => [c.case_id, c]))

// Computed once at module load — the picker's order must not depend on glob
// order, which is not guaranteed stable across platforms.
const VISIBLE_CASES: CombinedTestCase[] = ALL_CASES.filter(
  (c) => orderRank(c.case_id) !== -1,
).sort((a, b) => orderRank(a.case_id) - orderRank(b.case_id))

export const listCases = (): CombinedTestCase[] => VISIBLE_CASES

/** Null rather than a throw: an unknown id is a stale selection, not a crash.
 *  Resolves hidden cases too (see BY_ID above), so a run-log replay of a
 *  now-hidden case still names it. */
export const getCase = (caseId: string): CombinedTestCase | null => BY_ID.get(caseId) ?? null
