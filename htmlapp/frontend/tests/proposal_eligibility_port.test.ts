import { describe, expect, it } from 'vitest'
import {
  resolveEligibility,
  deriveRegisteredEntities,
  buildServiceCapabilities,
  type ServiceId,
  type MotionState,
  type ServiceCapabilitiesDoc,
} from '../src/engine/proposal/eligibility'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import { ensureRegistry, getServiceCapabilities } from '../src/data/registry'

/**
 * Parity tests — reproduces `resolve_eligibility()` / `derive_registered_entities()`
 * byte-for-byte over the cases captured from the real Python functions (see
 * `scripts/gen/capture_all.py#_capture_eligibility`). Per-rule coverage table
 * and hazard verdicts are in the task report.
 */

// tests/setup.ts installs globalThis.__AICA_DATA__ from the generated payload.
ensureRegistry()

describe('resolveEligibility / deriveRegisteredEntities parity', () => {
  it('reproduces resolve_eligibility() over the real committed capabilities + two synthetic branch-coverage cases', () => {
    const { input, output } = loadFixture('proposal_eligibility')
    const realCapabilities = buildServiceCapabilities(getServiceCapabilities() as ServiceCapabilitiesDoc)

    input.cases.forEach((c: any, i: number) => {
      const capabilities = c.synthetic_capabilities
        ? buildServiceCapabilities(c.synthetic_capabilities as ServiceCapabilitiesDoc)
        : realCapabilities
      const result = resolveEligibility(
        c.allowed_service_ids as ServiceId[],
        c.motion_state as MotionState,
        capabilities,
        {
          registeredEntities: new Set<string>(c.registered_entities),
          unavailableServiceIds: new Set<string>(c.unavailable_service_ids),
        },
      )
      expectParity(result, output.results[i].output, `case[${i}] (${c.name})`)
    })
  })

  it('reproduces derive_registered_entities() over both back-compat shapes + the missing/empty/null edge cases', () => {
    const { input, output } = loadFixture('proposal_eligibility')
    input.derive_cases.forEach((c: any, i: number) => {
      const result = Array.from(deriveRegisteredEntities(c.world_snapshot)).sort()
      expectParity(result, output.derive_results[i].registered_entities, `derive_case[${i}] (${c.name})`)
    })
  })
})
