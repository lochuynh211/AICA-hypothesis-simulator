import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProposalStoreProvider } from '../src/state/proposalStore'
import ProposalShell from '../src/components/proposal/ProposalShell'
import ProposalScreen from '../src/components/proposal/ProposalScreen'

vi.mock('../src/api/proposalClient', async () => {
  const actual = await vi.importActual<typeof import('../src/api/proposalClient')>('../src/api/proposalClient')
  return {
    ...actual,
    getPackages: vi.fn().mockResolvedValue({ slots: [], packages: [], errors: [] }),
    getMatrix: vi.fn().mockResolvedValue({ matrix_version: 'v1', rows: [] }),
    listRuns: vi.fn().mockResolvedValue([]),
  }
})

import { getPackages } from '../src/api/proposalClient'

describe('ProposalScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders all three panels: World, Service proposal, Content proposal', async () => {
    render(
      <ProposalStoreProvider>
        <ProposalScreen />
      </ProposalStoreProvider>,
    )
    expect(screen.getByTestId('world-panel')).toBeInTheDocument()
    expect(screen.getByTestId('service-panel')).toBeInTheDocument()
    expect(screen.getByTestId('content-panel')).toBeInTheDocument()
    await waitFor(() => expect(getPackages).toHaveBeenCalled())
  })
})

describe('ProposalShell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a [Screen | Runs] sub-nav defaulting to Screen', async () => {
    render(
      <ProposalStoreProvider>
        <ProposalShell />
      </ProposalStoreProvider>,
    )
    expect(screen.getByTestId('world-panel')).toBeInTheDocument()
    expect(screen.getByTestId('proposal-subnav-screen')).toBeInTheDocument()
    expect(screen.getByTestId('proposal-subnav-runs')).toBeInTheDocument()
    await waitFor(() => expect(getPackages).toHaveBeenCalled())
  })

  it('switching to Runs hides the 3-panel screen and shows the Runs placeholder', async () => {
    render(
      <ProposalStoreProvider>
        <ProposalShell />
      </ProposalStoreProvider>,
    )
    await waitFor(() => expect(getPackages).toHaveBeenCalled())
    fireEvent.click(screen.getByTestId('proposal-subnav-runs'))
    expect(screen.queryByTestId('world-panel')).not.toBeInTheDocument()
    expect(screen.getByTestId('proposal-runs-screen')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('proposal-subnav-screen'))
    await waitFor(() => expect(screen.getByTestId('world-panel')).toBeInTheDocument())
  })
})
