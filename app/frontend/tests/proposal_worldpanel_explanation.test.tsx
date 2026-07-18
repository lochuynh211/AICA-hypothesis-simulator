/**
 * feature 019 — WorldPanel renders the 3-way Explanation-source selector and
 * dispatches SET_EXPLANATION_PROVIDER (the controlled value reflects the store).
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProposalStoreProvider } from '../src/state/proposalStore'
import WorldPanel from '../src/components/proposal/panels/WorldPanel'

vi.mock('../src/api/proposalClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/proposalClient')>()
  return {
    ...actual,
    getCatalog: vi.fn().mockRejectedValue(new Error('no fetch in this test')),
    getSeeds: vi.fn().mockResolvedValue({ seeds: [] }),
    listProfiles: vi.fn().mockResolvedValue({ profiles: [] }),
  }
})

function renderPanel() {
  return render(
    <ProposalStoreProvider>
      <WorldPanel />
    </ProposalStoreProvider>,
  )
}

describe('WorldPanel — explanation source selector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a 3-way selector defaulting to off', () => {
    renderPanel()
    const select = screen.getByTestId('explanation-provider-select') as HTMLSelectElement
    expect(select.value).toBe('off')
    const values = Array.from(select.querySelectorAll('option')).map((o) => o.value)
    expect(values).toEqual(['off', 'backend', 'browser'])
  })

  it('dispatches the flag on change (controlled value updates to backend)', () => {
    renderPanel()
    const select = screen.getByTestId('explanation-provider-select') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'backend' } })
    expect(select.value).toBe('backend')
  })
})
