import { resolveCase, caseDispatches, differsFromCase } from '../src/lib/review/caseResolver'
import { getCase } from '../src/lib/review/caseCatalog'

const r01 = getCase('case-tc-r01')!
const m01 = getCase('case-tc-m01')!

describe('resolveCase', () => {
  it('resolves the journey references', () => {
    const setup = resolveCase(m01)
    expect(setup.scenarioId).toBe('semantic_tc_m01')
    // null: the semantic catalog runs the deterministic local route derived from
    // the authored scenario, so the authored journey length is what executes.
    expect(setup.routePresetId).toBeNull()
    expect(setup.seed).toBe(42)
    expect(setup.tickSeconds).toBe(180)
  })

  it('resolves all three algorithm defaults', () => {
    const setup = resolveCase(r01)
    expect(setup.triggerPackageId).toBe('aica_transparent_hybrid_trigger_v1')
    expect(setup.servicePackageId).toBe('aica_transparent_service_selector_v1')
    expect(setup.contentPackageId).toBe('aica_transparent_content_selector_v1')
  })

  it('resolves the persona profile reference', () => {
    expect(resolveCase(r01).profileRef).toBe('profile-semantic-neutral')
  })

  it('maps fixed overrides onto initial state and context overrides', () => {
    const setup = resolveCase(r01)
    expect(setup.initialDrowsiness).toBe(85)
    expect(setup.initialFatigue).toBe(70)
    expect(setup.contextOverrides.is_night).toBe(true)
    expect(setup.contextOverrides.child_passenger).toBe(false)
  })

  it('leaves unset overrides null rather than inventing a default', () => {
    const bare = { ...r01, journey: { ...r01.journey, fixed_overrides: undefined } }
    const setup = resolveCase(bare)
    expect(setup.initialDrowsiness).toBeNull()
    expect(setup.initialFatigue).toBeNull()
    expect(setup.contextOverrides).toEqual({})
    expect(setup.mountainRangeKm).toBeNull()
  })

  it('carries painted ranges through when the case pins them', () => {
    const painted = {
      ...m01,
      journey: { ...m01.journey, fixed_overrides: { ...m01.journey.fixed_overrides, jam_range_km: [40, 60] } },
    }
    expect(resolveCase(painted as typeof m01).jamRangeKm).toEqual([40, 60])
  })
})

describe('caseDispatches', () => {
  const { run, proposal } = caseDispatches(resolveCase(m01))
  const runTypes = run.map((a) => a.type)

  it('selects the scenario even though it is hidden from the manual picker', () => {
    expect(run).toContainEqual({ type: 'SELECT_SCENARIO', id: 'semantic_tc_m01' })
  })

  it('selects the trigger package and pins the seed and tick', () => {
    expect(runTypes).toContain('SELECT_PACKAGE')
    expect(run).toContainEqual({ type: 'SET_RUN_SEED', seed: 42 })
    expect(run).toContainEqual({ type: 'SET_TICK_SECONDS', seconds: 180 })
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
    const bare = { ...r01, journey: { ...r01.journey, fixed_overrides: undefined } }
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
    const setup = resolveCase(r01)
    const { run } = caseDispatches(setup)
    const isNight = run.find((a) => a.type === 'SET_CONTEXT_OVERRIDE' && a.key === 'is_night')
    expect(isNight).toBeDefined()
    expect(isNight?.value).toBe(true)
    expect('default' in (isNight as object)).toBe(true)
    expect(isNight?.default).not.toBe(isNight?.value)
  })

  // Discrepancy coverage: proposalStore's real SET_SITUATION_FIELD reducer
  // case (src/state/proposalStore.ts) destructures `action.key`, not
  // `action.field`. This would fail against a `{ field, value }` payload.
  it('emits SET_SITUATION_FIELD with the key property the reducer expects', () => {
    const withTags = {
      ...r01,
      journey: { ...r01.journey, fixed_overrides: { ...r01.journey.fixed_overrides, route_tags: ['coastal'] } },
    }
    const { proposal: dispatchedProposal } = caseDispatches(resolveCase(withTags))
    expect(dispatchedProposal).toContainEqual({ type: 'SET_SITUATION_FIELD', key: 'route_tags', value: ['coastal'] })
  })
})

describe('differsFromCase', () => {
  const setup = resolveCase(m01)
  const asLive = {
    scenarioId: setup.scenarioId, routePresetId: setup.routePresetId,
    triggerPackageId: setup.triggerPackageId, servicePackageId: setup.servicePackageId,
    contentPackageId: setup.contentPackageId, seed: setup.seed, tickSeconds: setup.tickSeconds,
    initialDrowsiness: setup.initialDrowsiness, initialFatigue: setup.initialFatigue,
    profileRef: setup.profileRef,
    contextOverrides: { ...setup.contextOverrides },
    situationFields: { ...setup.situationFields },
    mountainRangeKm: setup.mountainRangeKm,
    jamRangeKm: setup.jamRangeKm,
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

  // C-04/C-05's whole premise is the painted mountain/jam band — repainting
  // it must surface as drift, or the right column keeps explaining the
  // decision as though the setup still matched the case (review MUST FIX 1).
  it('reports drift when a painted range is repainted', () => {
    const painted = resolveCase({
      ...m01,
      journey: { ...m01.journey, fixed_overrides: { ...m01.journey.fixed_overrides, jam_range_km: [40, 60] } },
    } as typeof m01)
    const liveWithSamePainting = { ...asLive, jamRangeKm: painted.jamRangeKm }
    expect(differsFromCase(painted, liveWithSamePainting)).toEqual([])
    expect(differsFromCase(painted, { ...liveWithSamePainting, jamRangeKm: [10, 20] }))
      .toEqual(['jamRangeKm'])
  })

  it('reports no drift when neither side has a painted range (both null)', () => {
    // m01 itself pins no mountain range — both sides are null, which must
    // read as "matches", not as drift (null !== null-as-a-range would be a
    // bug in `sameRange`'s short-circuit).
    expect(setup.mountainRangeKm).toBeNull()
    expect(differsFromCase(setup, { ...asLive, mountainRangeKm: null })).toEqual([])
  })

  // C-02's whole premise is the night context — flipping it must surface as
  // drift, or the right column keeps explaining the decision as though it
  // still happened at night (review MUST FIX 1).
  it('reports drift when a context override is flipped', () => {
    const nightSetup = resolveCase(r01)
    const nightAsLive = {
      scenarioId: nightSetup.scenarioId, routePresetId: nightSetup.routePresetId,
      triggerPackageId: nightSetup.triggerPackageId, servicePackageId: nightSetup.servicePackageId,
      contentPackageId: nightSetup.contentPackageId, seed: nightSetup.seed, tickSeconds: nightSetup.tickSeconds,
      initialDrowsiness: nightSetup.initialDrowsiness, initialFatigue: nightSetup.initialFatigue,
      profileRef: nightSetup.profileRef,
      contextOverrides: { ...nightSetup.contextOverrides },
      situationFields: { ...nightSetup.situationFields },
      mountainRangeKm: nightSetup.mountainRangeKm,
      jamRangeKm: nightSetup.jamRangeKm,
    }
    expect(differsFromCase(nightSetup, nightAsLive)).toEqual([])
    expect(
      differsFromCase(nightSetup, {
        ...nightAsLive,
        contextOverrides: { ...nightSetup.contextOverrides, is_night: false },
      }),
    ).toEqual(['contextOverrides'])
  })

  it('reports no drift for an unchanged context-override / situation-field setup', () => {
    expect(differsFromCase(setup, asLive)).toEqual([])
  })
})
