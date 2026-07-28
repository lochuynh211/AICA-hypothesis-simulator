import { listCases, getCase } from '../src/lib/review/caseCatalog'

describe('listCases', () => {
  it('loads every committed case', () => {
    const cases = listCases()
    expect(cases.length).toBeGreaterThanOrEqual(2)
  })

  it('is sorted by case id, so the picker order is stable', () => {
    const ids = listCases().map((c) => c.case_id)
    expect(ids).toEqual([...ids].sort())
  })

  it('includes the two slice-2 cases', () => {
    const ids = listCases().map((c) => c.case_id)
    expect(ids).toContain('case-c01-alert-daytime-control')
    expect(ids).toContain('case-c03-monotonous-highway')
  })

  it('exposes bilingual title, brief and what-to-watch', () => {
    const c = getCase('case-c03-monotonous-highway')!
    expect(c.title.ja).toBeTruthy()
    expect(c.title.en).toBeTruthy()
    expect(c.brief.ja).not.toBe(c.brief.en)
    expect(c.what_to_watch.length).toBeGreaterThan(0)
  })

  it('exposes the journey references the resolver needs', () => {
    const j = getCase('case-c03-monotonous-highway')!.journey
    expect(j.scenario_ref).toBe('uc02_monotony_v0_1')
    expect(j.route_preset_ref).toBe('long_tokyo_osaka')
    expect(j.seed).toBe(1042)
    expect(j.tick_seconds).toBe(60)
  })

  it('exposes the three algorithm defaults', () => {
    const d = getCase('case-c01-alert-daytime-control')!.algorithm_defaults
    expect(d.trigger).toBe('aica_transparent_hybrid_trigger_v1')
    expect(d.service).toBe('aica_transparent_service_selector_v1')
    expect(d.content).toBe('aica_transparent_content_selector_v1')
  })

  it('carries no authored expectation fields', () => {
    for (const c of listCases()) {
      for (const forbidden of ['checkpoints', 'expected', 'hypothesis', 'contrast']) {
        expect(c as Record<string, unknown>).not.toHaveProperty(forbidden)
      }
    }
  })
})

describe('getCase', () => {
  it('returns null for an unknown id rather than throwing', () => {
    expect(getCase('case-does-not-exist')).toBeNull()
  })
})
