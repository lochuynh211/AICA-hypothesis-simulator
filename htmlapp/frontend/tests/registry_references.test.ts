import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  installRegistry,
  resetRegistryForTests,
  validateReferences,
  DataRegistryError,
  type AicaDataPayload,
} from '../src/data/registry'

const REAL: AicaDataPayload = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'data', 'aica-data.json'), 'utf8'),
)

const clone = (): AicaDataPayload => JSON.parse(JSON.stringify(REAL))

beforeEach(() => resetRegistryForTests())

describe('validateReferences', () => {
  it('passes on the real committed data', () => {
    expect(validateReferences(REAL)).toEqual([])
  })

  it('catches a case pointing at a missing profile preset', () => {
    const p = clone()
    const caseId = Object.keys(p.combinedCases)[0]
    ;(p.combinedCases[caseId] as any).persona.profile_ref = 'preset-does-not-exist'
    const problems = validateReferences(p)
    expect(problems.some((m) => m.includes('profile_ref') && m.includes('preset-does-not-exist'))).toBe(true)
  })

  it('catches a case pointing at a missing scenario', () => {
    const p = clone()
    const caseId = Object.keys(p.combinedCases)[0]
    ;(p.combinedCases[caseId] as any).journey.scenario_ref = 'no_such_scenario'
    expect(validateReferences(p).some((m) => m.includes('scenario_ref'))).toBe(true)
  })

  it('catches a case pointing at a missing route preset', () => {
    const p = clone()
    const caseId = Object.keys(p.combinedCases)[0]
    ;(p.combinedCases[caseId] as any).journey.route_preset_ref = 'no_such_route'
    expect(validateReferences(p).some((m) => m.includes('route_preset_ref'))).toBe(true)
  })

  it('catches a case naming an algorithm package that is not installed', () => {
    const p = clone()
    const caseId = Object.keys(p.combinedCases)[0]
    ;(p.combinedCases[caseId] as any).algorithm_defaults.trigger = 'ghost_package_v9'
    expect(validateReferences(p).some((m) => m.includes('ghost_package_v9'))).toBe(true)
  })

  it('reports every broken reference at once', () => {
    const p = clone()
    const ids = Object.keys(p.combinedCases)
    ;(p.combinedCases[ids[0]] as any).journey.scenario_ref = 'bad_a'
    ;(p.combinedCases[ids[1]] as any).journey.route_preset_ref = 'bad_b'
    const problems = validateReferences(p)
    expect(problems.some((m) => m.includes('bad_a'))).toBe(true)
    expect(problems.some((m) => m.includes('bad_b'))).toBe(true)
  })

  it('is enforced by installRegistry, not merely available', () => {
    const p = clone()
    const caseId = Object.keys(p.combinedCases)[0]
    ;(p.combinedCases[caseId] as any).journey.scenario_ref = 'no_such_scenario'
    expect(() => installRegistry(p)).toThrow(DataRegistryError)
  })
})
