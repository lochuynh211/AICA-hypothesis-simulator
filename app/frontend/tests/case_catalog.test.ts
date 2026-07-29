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
    expect(ids).toContain('case-tc-r01')
    expect(ids).toContain('case-tc-m01')
  })

  it('exposes bilingual title, brief and what-to-watch', () => {
    const c = getCase('case-tc-m01')!
    expect(c.title.ja).toBeTruthy()
    expect(c.title.en).toBeTruthy()
    expect(c.brief.ja).not.toBe(c.brief.en)
    expect(c.what_to_watch.length).toBeGreaterThan(0)
  })

  it('exposes the journey references the resolver needs', () => {
    const j = getCase('case-tc-m01')!.journey
    expect(j.scenario_ref).toBe('semantic_tc_m01')
    expect(j.route_preset_ref).toBeNull()
    expect(j.seed).toBe(42)
    expect(j.tick_seconds).toBe(180)
  })

  it('exposes the three algorithm defaults', () => {
    const d = getCase('case-tc-r01')!.algorithm_defaults
    expect(d.trigger).toBe('aica_transparent_hybrid_trigger_v1')
    expect(d.service).toBe('aica_transparent_service_selector_v1')
    expect(d.content).toBe('aica_transparent_content_selector_v1')
  })

  // The semantic catalog REPLACED the old "no authored expectations" contract:
  // every case now carries the hypothesis it is testing and the checks that
  // adjudicate it, so the screen can show what a case is for.
  it('carries the authored semantic hypothesis on every case', () => {
    for (const c of listCases()) {
      const record = c as Record<string, unknown>
      expect(record).toHaveProperty('hypothesis')
      expect(record).toHaveProperty('expectations')
      expect(record).toHaveProperty('purpose')
      expect(String(record.display_id)).toMatch(/^TC-/)
    }
  })
})

describe('getCase', () => {
  it('returns null for an unknown id rather than throwing', () => {
    expect(getCase('case-does-not-exist')).toBeNull()
  })
})
