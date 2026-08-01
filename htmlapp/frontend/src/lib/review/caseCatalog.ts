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

// Sorted once at module load — the picker's order must not depend on glob order,
// which is not guaranteed stable across platforms.
const CASES: CombinedTestCase[] = Object.values(MODULES).sort((a, b) =>
  a.case_id.localeCompare(b.case_id),
)

const BY_ID = new Map(CASES.map((c) => [c.case_id, c]))

export const listCases = (): CombinedTestCase[] => CASES

/** Null rather than a throw: an unknown id is a stale selection, not a crash. */
export const getCase = (caseId: string): CombinedTestCase | null => BY_ID.get(caseId) ?? null
