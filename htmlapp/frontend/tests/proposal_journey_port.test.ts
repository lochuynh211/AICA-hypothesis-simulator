import { describe, expect, it } from 'vitest'
import { applyAction, type ProposalRunLog, type JourneyAction } from '../src/engine/proposal/journey'
import { preview } from '../src/engine/proposal/journey_preview'
import { buildServiceCapabilities, type ServiceCapabilitiesDoc } from '../src/engine/proposal/eligibility'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'

/**
 * Parity tests — reproduces `apply_action()` (`services/proposal_journey.py`)
 * and `preview()` (`services/proposal_journey_preview.py`) byte-for-byte
 * over the cases captured from the real Python functions (see
 * `scripts/gen/capture_all.py#_capture_journey` /
 * `#_capture_journey_preview`, C2 Task 5).
 *
 * Every one of `apply_action`'s twelve action handlers gets both a success
 * case (where reachable — some handlers have no success-independent guard
 * beyond the ones already covered) and its precondition/payload rejection
 * cases, all captured from the real Python engine — so a rejection's
 * bilingual message text is proven against Python's literal output, not
 * hand-transcribed. Per-handler branch-coverage table and hazard verdicts
 * are in the task report.
 */

describe('applyAction parity (captured from proposal_journey.py)', () => {
  const { input, output } = loadFixture('proposal_journey')

  input.cases.forEach((c: any, i: number) => {
    it(`case[${i}] ${c.name}`, () => {
      const runLog = c.run_log as unknown as ProposalRunLog
      const action = c.action as JourneyAction
      const capabilities = c.capabilities ? buildServiceCapabilities(c.capabilities as ServiceCapabilitiesDoc) : null

      const transition = applyAction(runLog, action, c.now, capabilities)

      const expected = output.results[i]
      expect(expected.name).toBe(c.name)
      expectParity(transition, expected.transition, `${c.name}`)
    })
  })

  it('captured every one of the twelve JourneyActionType values at least once', () => {
    const seen = new Set(input.cases.map((c: any) => c.action.action_type))
    const twelve = [
      'accept', 'reject', 'postpone', 'choose_another', 'request_more', 'complete',
      'continue', 'stop', 'motion_change', 'rest_spot_arrived', 'rest_started', 'rest_completed',
    ]
    for (const actionType of twelve) expect(seen.has(actionType), actionType).toBe(true)
  })
})

describe('preview parity (captured from proposal_journey_preview.py)', () => {
  const { input, output } = loadFixture('proposal_journey_preview')

  input.cases.forEach((c: any, i: number) => {
    it(`case[${i}] ${c.name}`, () => {
      const runLog = c.run_log as unknown as ProposalRunLog
      const result = preview(runLog)

      const expected = output.results[i]
      expect(expected.name).toBe(c.name)
      expectParity(result, expected.preview, `${c.name}`)
    })
  })

  it('binding is always false, mirroring the model default no case ever overrides', () => {
    input.cases.forEach((c: any) => {
      const runLog = c.run_log as unknown as ProposalRunLog
      expect(preview(runLog).binding).toBe(false)
    })
  })
})
