import { resolveCase, caseDispatches, differsFromCase } from '../src/lib/review/caseResolver'
import { getCase } from '../src/lib/review/caseCatalog'

const c01 = getCase('case-c01-alert-daytime-control')!
const c03 = getCase('case-c03-monotonous-highway')!

describe('resolveCase', () => {
  it('resolves the journey references', () => {
    const setup = resolveCase(c03)
    expect(setup.scenarioId).toBe('uc02_monotony_v0_1')
    expect(setup.routePresetId).toBe('long_tokyo_osaka')
    expect(setup.seed).toBe(1042)
    expect(setup.tickSeconds).toBe(60)
  })

  it('resolves all three algorithm defaults', () => {
    const setup = resolveCase(c01)
    expect(setup.triggerPackageId).toBe('aica_transparent_hybrid_trigger_v1')
    expect(setup.servicePackageId).toBe('aica_transparent_service_selector_v1')
    expect(setup.contentPackageId).toBe('aica_transparent_content_selector_v1')
  })

  it('resolves the persona profile reference', () => {
    expect(resolveCase(c01).profileRef).toBe('preset-journey-a-1-cruising-fresh')
  })

  it('maps fixed overrides onto initial state and context overrides', () => {
    const setup = resolveCase(c01)
    expect(setup.initialDrowsiness).toBe(10)
    expect(setup.initialFatigue).toBe(12)
    expect(setup.contextOverrides.is_night).toBe(false)
    expect(setup.contextOverrides.child_passenger).toBe(false)
  })

  it('leaves unset overrides null rather than inventing a default', () => {
    const bare = { ...c01, journey: { ...c01.journey, fixed_overrides: undefined } }
    const setup = resolveCase(bare)
    expect(setup.initialDrowsiness).toBeNull()
    expect(setup.initialFatigue).toBeNull()
    expect(setup.contextOverrides).toEqual({})
    expect(setup.mountainRangeKm).toBeNull()
  })

  it('carries painted ranges through when the case pins them', () => {
    const painted = {
      ...c03,
      journey: { ...c03.journey, fixed_overrides: { ...c03.journey.fixed_overrides, jam_range_km: [40, 60] } },
    }
    expect(resolveCase(painted as typeof c03).jamRangeKm).toEqual([40, 60])
  })
})

describe('caseDispatches', () => {
  const { run, proposal } = caseDispatches(resolveCase(c03))
  const runTypes = run.map((a) => a.type)

  it('selects the scenario even though it is hidden from the manual picker', () => {
    expect(run).toContainEqual({ type: 'SELECT_SCENARIO', id: 'uc02_monotony_v0_1' })
  })

  it('selects the trigger package and pins the seed and tick', () => {
    expect(runTypes).toContain('SELECT_PACKAGE')
    expect(run).toContainEqual({ type: 'SET_RUN_SEED', seed: 1042 })
    expect(run).toContainEqual({ type: 'SET_TICK_SECONDS', seconds: 60 })
  })

  it('sets both proposal packages and loads the persona profile', () => {
    const types = proposal.map((a) => a.type)
    expect(types).toContain('SET_SERVICE_PACKAGE')
    expect(types).toContain('SET_CONTENT_PACKAGE')
    expect(types).toContain('LOAD_PROFILE')
  })

  it('emits no route dispatch — the route is panel-local', () => {
    expect(runTypes).not.toContain('SELECT_ROUTE')
    expect(runTypes).not.toContain('SET_ALTERNATIVES')
  })

  it('emits no initial-state dispatch when the case pins none', () => {
    const bare = { ...c01, journey: { ...c01.journey, fixed_overrides: undefined } }
    const types = caseDispatches(resolveCase(bare)).run.map((a) => a.type)
    expect(types).not.toContain('SET_INITIAL_DROWSINESS')
    expect(types).not.toContain('SET_CONTEXT_OVERRIDE')
  })

  // Discrepancy coverage: runStore's real SET_CONTEXT_OVERRIDE reducer case
  // (src/state/runStore.ts) destructures `{ key, value, default }` — it clears
  // the override when `value === default` (a revert-to-scenario-default
  // optimization). caseResolver has no access to the scenario's actual
  // default, so it must supply a `default` distinct from `value` or a
  // case-pinned override could silently vanish. This locks that contract in;
  // it would fail against a `{ key, value }`-only payload (the field would be
  // absent, so `'default' in action` is false).
  it('pins a context override with a default distinct from the pinned value', () => {
    const setup = resolveCase(c01)
    const { run } = caseDispatches(setup)
    const isNight = run.find((a) => a.type === 'SET_CONTEXT_OVERRIDE' && a.key === 'is_night')
    expect(isNight).toBeDefined()
    expect(isNight?.value).toBe(false)
    expect('default' in (isNight as object)).toBe(true)
    expect(isNight?.default).not.toBe(isNight?.value)
  })

  // Discrepancy coverage: proposalStore's real SET_SITUATION_FIELD reducer
  // case (src/state/proposalStore.ts) destructures `action.key`, not
  // `action.field`. This would fail against a `{ field, value }` payload.
  it('emits SET_SITUATION_FIELD with the key property the reducer expects', () => {
    const withTags = {
      ...c01,
      journey: { ...c01.journey, fixed_overrides: { ...c01.journey.fixed_overrides, route_tags: ['coastal'] } },
    }
    const { proposal: dispatchedProposal } = caseDispatches(resolveCase(withTags))
    expect(dispatchedProposal).toContainEqual({ type: 'SET_SITUATION_FIELD', key: 'route_tags', value: ['coastal'] })
  })
})

describe('differsFromCase', () => {
  const setup = resolveCase(c03)
  const asLive = {
    scenarioId: setup.scenarioId, routePresetId: setup.routePresetId,
    triggerPackageId: setup.triggerPackageId, servicePackageId: setup.servicePackageId,
    contentPackageId: setup.contentPackageId, seed: setup.seed, tickSeconds: setup.tickSeconds,
    initialDrowsiness: setup.initialDrowsiness, initialFatigue: setup.initialFatigue,
    profileRef: setup.profileRef,
  }

  it('reports nothing when the live setup matches the case', () => {
    expect(differsFromCase(setup, asLive)).toEqual([])
  })

  it('names the drifted field', () => {
    expect(differsFromCase(setup, { ...asLive, seed: 7 })).toEqual(['seed'])
  })

  it('names every drifted field', () => {
    expect(differsFromCase(setup, { ...asLive, seed: 7, tickSeconds: 30 }).sort())
      .toEqual(['seed', 'tickSeconds'])
  })

  it('treats a swapped algorithm package as drift, since it is the tuning loop', () => {
    expect(differsFromCase(setup, { ...asLive, triggerPackageId: 'nri_fatigue_score_v1' }))
      .toEqual(['triggerPackageId'])
  })
})
