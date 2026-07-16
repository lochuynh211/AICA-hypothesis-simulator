import { describe, it, expect } from 'vitest'
import { PROPOSAL_API_BASE } from '../src/api/proposalClient'

describe('proposalClient skeleton', () => {
  it('exports a base-URL helper for the /api/proposal namespace', () => {
    expect(PROPOSAL_API_BASE).toBe('/api/proposal')
  })
})
