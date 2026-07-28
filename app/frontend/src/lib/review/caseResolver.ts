/**
 * Resolve a committed case into the existing Combined setup.
 *
 * Builds PLAIN objects and dispatches nothing itself — that is what lets it be
 * tested without mounting React, and it keeps the panel in charge of what the
 * panel owns (the route preset and painted ranges are panel-local `useState`,
 * NOT store state, because SELECT_SCENARIO clears a local-source route).
 *
 * Selecting a case SEEDS the setup; it does not lock it. Any later edit is
 * legitimate — `differsFromCase` exists so the panel can SAY the setup drifted,
 * not to prevent it.
 */
import type { CombinedTestCase } from './caseCatalog'
import type { SetupValue } from '../../api/types'

export type ResolvedCaseSetup = {
  scenarioId: string
  routePresetId: string
  triggerPackageId: string
  servicePackageId: string
  contentPackageId: string
  seed: number
  tickSeconds: number
  initialDrowsiness: number | null
  initialFatigue: number | null
  contextOverrides: Record<string, unknown>
  situationFields: Record<string, unknown>
  mountainRangeKm: [number, number] | null
  jamRangeKm: [number, number] | null
  profileRef: string
}

/** The subset of live setup compared against a case. */
export type LiveSetupSnapshot = Pick<
  ResolvedCaseSetup,
  | 'scenarioId' | 'routePresetId' | 'triggerPackageId' | 'servicePackageId'
  | 'contentPackageId' | 'seed' | 'tickSeconds' | 'initialDrowsiness'
  | 'initialFatigue' | 'profileRef'
>

export type RunAction = { type: string; [key: string]: unknown }
export type ProposalAction = { type: string; [key: string]: unknown }

export function resolveCase(testCase: CombinedTestCase): ResolvedCaseSetup {
  const { journey, persona, algorithm_defaults: defaults } = testCase
  const fixed = journey.fixed_overrides ?? {}

  // ONLY what the case actually pins reaches the setup. An absent override stays
  // null/absent so the scenario's own default applies — never a guessed value.
  const contextOverrides: Record<string, unknown> = {}
  if (fixed.is_night !== undefined) contextOverrides.is_night = fixed.is_night
  if (fixed.child_passenger !== undefined) contextOverrides.child_passenger = fixed.child_passenger

  const situationFields: Record<string, unknown> = {}
  if (fixed.route_tags !== undefined) situationFields.route_tags = fixed.route_tags
  if (fixed.destination_tags !== undefined) situationFields.destination_tags = fixed.destination_tags
  if (fixed.multiple_passengers !== undefined) {
    situationFields.multiple_passengers = fixed.multiple_passengers
  }

  return {
    scenarioId: journey.scenario_ref,
    routePresetId: journey.route_preset_ref,
    triggerPackageId: defaults.trigger,
    servicePackageId: defaults.service,
    contentPackageId: defaults.content,
    seed: journey.seed,
    tickSeconds: journey.tick_seconds,
    initialDrowsiness: fixed.initial_drowsiness ?? null,
    initialFatigue: fixed.initial_fatigue ?? null,
    contextOverrides,
    situationFields,
    mountainRangeKm: fixed.mountain_range_km ?? null,
    jamRangeKm: fixed.jam_range_km ?? null,
    profileRef: persona.profile_ref,
  }
}

/**
 * Sentinel `default` for a case-driven SET_CONTEXT_OVERRIDE dispatch.
 *
 * runStore's real reducer case (`src/state/runStore.ts`) destructures
 * `{ key, value, default }` and CLEARS the override when `value === default`
 * — a revert-to-scenario-default optimization used by SignalsPanel, which
 * knows the scenario's actual default when the reviewer edits by hand.
 * caseResolver has no access to that default (it only knows the case's
 * pinned value), and a case's fixed_overrides are deliberately non-default
 * pins that must survive. `null` is never a legal `SetupValue`
 * (`string | boolean | number`), so it can never accidentally equal a real
 * pinned value — the reducer's else-branch (store the override) always runs.
 */
const CASE_OVERRIDE_SENTINEL_DEFAULT = null as unknown as SetupValue

/**
 * The store actions that apply a resolved case.
 *
 * No route action: the route preset is panel-local. The profile uses
 * LOAD_PROFILE (replaces ONLY world.driver_profile) rather than LOAD_PRESET
 * (replaces the whole world), so the case's situation overrides are not
 * immediately overwritten by the preset's own world.
 */
export function caseDispatches(setup: ResolvedCaseSetup): {
  run: RunAction[]
  proposal: ProposalAction[]
} {
  const run: RunAction[] = [
    { type: 'SELECT_PACKAGE', id: setup.triggerPackageId },
    { type: 'SELECT_SCENARIO', id: setup.scenarioId },
    { type: 'SET_RUN_SEED', seed: setup.seed },
    { type: 'SET_TICK_SECONDS', seconds: setup.tickSeconds },
  ]
  if (setup.initialDrowsiness !== null) {
    run.push({ type: 'SET_INITIAL_DROWSINESS', value: setup.initialDrowsiness })
  }
  if (setup.initialFatigue !== null) {
    run.push({ type: 'SET_INITIAL_FATIGUE', value: setup.initialFatigue })
  }
  for (const [key, value] of Object.entries(setup.contextOverrides)) {
    run.push({ type: 'SET_CONTEXT_OVERRIDE', key, value, default: CASE_OVERRIDE_SENTINEL_DEFAULT })
  }

  const proposal: ProposalAction[] = [
    { type: 'SET_SERVICE_PACKAGE', packageId: setup.servicePackageId },
    { type: 'SET_CONTENT_PACKAGE', packageId: setup.contentPackageId },
    { type: 'LOAD_PROFILE', profileId: setup.profileRef },
  ]
  for (const [key, value] of Object.entries(setup.situationFields)) {
    // proposalStore's real SET_SITUATION_FIELD reducer case destructures
    // `action.key` (src/state/proposalStore.ts) — NOT `action.field`.
    proposal.push({ type: 'SET_SITUATION_FIELD', key, value })
  }

  return { run, proposal }
}

const COMPARED_KEYS: (keyof LiveSetupSnapshot)[] = [
  'scenarioId', 'routePresetId', 'triggerPackageId', 'servicePackageId',
  'contentPackageId', 'seed', 'tickSeconds', 'initialDrowsiness',
  'initialFatigue', 'profileRef',
]

/**
 * Which setup fields have drifted from the case as defined.
 *
 * A swapped algorithm package counts as drift and is REPORTED, not prevented —
 * reviewing the same situation under a different configuration is the tuning
 * loop, and the note exists so the reviewer knows which loop they are in.
 */
export function differsFromCase(setup: ResolvedCaseSetup, live: LiveSetupSnapshot): string[] {
  return COMPARED_KEYS.filter((key) => setup[key] !== live[key]) as string[]
}
