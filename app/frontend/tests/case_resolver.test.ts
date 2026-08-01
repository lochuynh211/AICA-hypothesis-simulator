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
    expect(setup.tickSeconds).toBe(180)
  })

  it('resolves all three algorithm defaults', () => {
    const setup = resolveCase(c01)
    // S5b: the 6 committed cases moved their trigger default from
    // 'aica_transparent_hybrid_trigger_v1' to 'nri_fatigue_score_v1' (sibling
    // slice) — updated here to match the committed test-case data.
    expect(setup.triggerPackageId).toBe('nri_fatigue_score_v1')
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
    // The contrast value must actually DIFFER from the case's own default —
    // c03's default trigger package is itself migrating (S5b, sibling slice)
    // from 'aica_transparent_hybrid_trigger_v1' to 'nri_fatigue_score_v1', so
    // a hardcoded 'nri_fatigue_score_v1' contrast would silently stop proving
    // a package SWAP is detected the moment that migration lands (same value
    // in == no drift, not a swap). Picking whichever of the two known
    // packages ISN'T the case's own default keeps this meaningful on either
    // side of that migration.
    const otherPackage = setup.triggerPackageId === 'nri_fatigue_score_v1'
      ? 'aica_transparent_hybrid_trigger_v1'
      : 'nri_fatigue_score_v1'
    expect(differsFromCase(setup, { ...asLive, triggerPackageId: otherPackage }))
      .toEqual(['triggerPackageId'])
  })

  // C-04/C-05's whole premise is the painted mountain/jam band — repainting
  // it must surface as drift, or the right column keeps explaining the
  // decision as though the setup still matched the case (review MUST FIX 1).
  it('reports drift when a painted range is repainted', () => {
    const painted = resolveCase({
      ...c03,
      journey: { ...c03.journey, fixed_overrides: { ...c03.journey.fixed_overrides, jam_range_km: [40, 60] } },
    } as typeof c03)
    const liveWithSamePainting = { ...asLive, jamRangeKm: painted.jamRangeKm }
    expect(differsFromCase(painted, liveWithSamePainting)).toEqual([])
    expect(differsFromCase(painted, { ...liveWithSamePainting, jamRangeKm: [10, 20] }))
      .toEqual(['jamRangeKm'])
  })

  it('reports no drift when neither side has a painted range (both null)', () => {
    // c03 itself pins no mountain range — both sides are null, which must
    // read as "matches", not as drift (null !== null-as-a-range would be a
    // bug in `sameRange`'s short-circuit).
    expect(setup.mountainRangeKm).toBeNull()
    expect(differsFromCase(setup, { ...asLive, mountainRangeKm: null })).toEqual([])
  })

  // C-02's whole premise is the night context — flipping it must surface as
  // drift, or the right column keeps explaining the decision as though it
  // still happened at night (review MUST FIX 1).
  it('reports drift when a context override is flipped', () => {
    const c02 = getCase('case-c02-night-highway-drowsiness')!
    const nightSetup = resolveCase(c02)
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
