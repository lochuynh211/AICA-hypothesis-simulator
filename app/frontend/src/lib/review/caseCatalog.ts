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

export type CaseGroup =
  | 'rest'
  | 'monotony'
  | 'environment'
  | 'service'
  | 'content'
  | 'integrated'

export type TriggerOutcome = 'rest_required' | 'monotony_prevention' | 'none'

export type CaseContrast = {
  role: 'baseline' | 'variant'
  with_case_id: string
  kind: 'controlled_one_factor' | 'semantic_real_world'
  changed_inputs: string[]
  expected_delta: BilingualLabel
}

export type CaseRealWorld = {
  before_trip: BilingualLabel
  trip_reason: BilingualLabel
  state_at_departure: BilingualLabel
  journey_evolution: BilingualLabel
}

export type CaseHypothesis = {
  rationale: BilingualLabel
}

export type CaseTriggerExpectation = {
  outcome: TriggerOutcome
  /** One-based occurrence of the expected category to evaluate. Defaults to 1. */
  occurrence?: number
  /** Inclusive [earliest, latest] selected-fire window, in journey minutes. */
  time_window_min?: [number, number]
  max_fire_count?: number
  required_positive_feature_ids?: string[]
}

export type CaseServiceExpectation = {
  rank_1_acceptable_ids?: string[]
  top_3_required_ids?: string[]
  top_3_prohibited_ids?: string[]
  /** Positive evidence required on the actual rank-1 candidate. */
  required_positive_feature_ids?: string[]
}

export type ContentStageOutcome = 'complete_plan' | 'unsupported_service' | 'not_applicable'

export type CaseContentExpectation = {
  expected_stage_outcome: ContentStageOutcome
  returned_count?: number
  required_track_ids?: string[]
  excluded_track_ids?: string[]
  oshi_artist_id?: string
  mean_arousal_range?: [number, number]
}

export type CaseExpectations = {
  trigger: CaseTriggerExpectation
  service: CaseServiceExpectation
  content: CaseContentExpectation
}

export type CasePersona = {
  persona_id: string
  name: BilingualLabel
  narrative: BilingualLabel
  goals?: BilingualLabel[]
  preferences?: BilingualLabel[]
  constraints?: BilingualLabel[]
  assumptions?: BilingualLabel[]
  /** A committed proposal preset/profile id; its driver_profile is resolved into the run. */
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
  display_id: string
  schema_version: string
  version: string
  title: BilingualLabel
  brief: BilingualLabel
  group: CaseGroup
  purpose: BilingualLabel
  what_to_watch: BilingualLabel[]
  real_world: CaseRealWorld
  hypothesis: CaseHypothesis
  expectations: CaseExpectations
  contrast?: CaseContrast
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
