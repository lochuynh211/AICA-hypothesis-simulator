/**
 * ModeToggle (P7 T031/T035, US3/US5) — interactive/quick_check selector in
 * Panel ②. The chosen mode is carried in `proposalStore.state.mode` and
 * included verbatim in the create-run request body (FR-011); JA-default +
 * EN labels (FR-024).
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProposalStoreProvider, useProposalStore } from '../src/state/proposalStore'
import ModeToggle from '../src/components/proposal/ModeToggle'
import ServiceProposalPanel from '../src/components/proposal/panels/ServiceProposalPanel'
import type { ProposalRunLog } from '../src/api/proposalClient'

vi.mock('../src/api/proposalClient', async () => {
  const actual = await vi.importActual<typeof import('../src/api/proposalClient')>('../src/api/proposalClient')
  return {
    ...actual,
    getPackages: vi.fn(),
    createRun: vi.fn(),
  }
})

import { getPackages, createRun } from '../src/api/proposalClient'

const SERVICE_PACKAGE = {
  id: 'mock_service_selector_v1',
  version: '1.0.0',
  label: { ja: 'モック・サービス選定 v1.0', en: 'Mock Service Selector v1.0' },
  family: 'service_selector' as const,
  approach: 'transparent' as const,
  contract_version: '1.0.0',
  supported_services: [],
  parameters: { top_k: 3 },
  hyperparameters: [],
}

const CONTENT_PACKAGE = {
  id: 'mock_content_selector_v1',
  version: '1.0.0',
  label: { ja: 'モック・コンテンツ選定 v1.0', en: 'Mock Content Selector v1.0' },
  family: 'content_selector' as const,
  approach: 'transparent' as const,
  contract_version: '1.0.0',
  supported_services: [],
  parameters: {},
  hyperparameters: [],
}

function packagesResponse() {
  return { slots: [], packages: [SERVICE_PACKAGE, CONTENT_PACKAGE], errors: [] }
}

function createdRunLog(): ProposalRunLog {
  return {
    run_id: 'prun_20260717-000000_modetest',
    created_at: '2026-07-17T00:00:00Z',
    opportunity: {
      opportunity_id: 'op_1',
      trigger_purpose: 'rest_recommended',
      lifecycle_stage: 'after_rest_before_restart',
      allowed_service_ids: [],
      simulation_time: '2026-07-17T00:00:00Z',
      run_seed: 'seed-1',
    },
    matrix_version: 'v1',
    world_snapshot: {},
    service_package_id: 'mock_service_selector_v1',
    content_package_id: 'mock_content_selector_v1',
    parameters: {},
    hyperparameters: {},
    journey_state: {
      lifecycle_stage: 'after_rest_before_restart',
      motion_state: 'stopped',
      active_service_id: null,
      active_plan_id: null,
    },
    events: [],
    evidence: [],
    status: 'created',
  } as unknown as ProposalRunLog
}

describe('ModeToggle', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('defaults to interactive and renders JA labels by default', () => {
    render(
      <ProposalStoreProvider>
        <ModeToggle />
      </ProposalStoreProvider>,
    )
    expect(screen.getByTestId('mode-toggle-interactive')).toBeChecked()
    expect(screen.getByTestId('mode-toggle-quick_check')).not.toBeChecked()
    expect(screen.getByText('インタラクティブ')).toBeInTheDocument()
    expect(screen.getByText('クイックチェック')).toBeInTheDocument()
  })

  it('renders EN labels when uiLanguage is en', () => {
    render(
      <ProposalStoreProvider initialLanguage="en">
        <ModeToggle />
      </ProposalStoreProvider>,
    )
    expect(screen.getByText('Interactive')).toBeInTheDocument()
    expect(screen.getByText('Quick check')).toBeInTheDocument()
  })

  it('selecting quick_check updates the store mode', () => {
    function Probe() {
      const { state } = useProposalStore()
      return <span data-testid="probe-mode">{state.mode}</span>
    }
    render(
      <ProposalStoreProvider>
        <ModeToggle />
        <Probe />
      </ProposalStoreProvider>,
    )
    fireEvent.click(screen.getByTestId('mode-toggle-quick_check'))
    expect(screen.getByTestId('probe-mode')).toHaveTextContent('quick_check')
  })

  it('the chosen mode is included in the create-run request body', async () => {
    vi.mocked(getPackages).mockResolvedValue(packagesResponse())
    vi.mocked(createRun).mockResolvedValue(createdRunLog())

    // ServiceProposalPanel already wires <ModeToggle /> internally (P7 T036)
    // — rendering it standalone here would duplicate the `mode-toggle-*`
    // testids, so this exercises the toggle through the panel that actually
    // ships it, not a second freestanding instance.
    render(
      <ProposalStoreProvider>
        <ServiceProposalPanel />
      </ProposalStoreProvider>,
    )

    await waitFor(() => expect(getPackages).toHaveBeenCalled())
    await screen.findByTestId('service-run-button')

    fireEvent.click(screen.getByTestId('mode-toggle-quick_check'))
    fireEvent.click(screen.getByTestId('service-run-button'))

    await waitFor(() =>
      expect(createRun).toHaveBeenCalledWith(expect.objectContaining({ mode: 'quick_check' })),
    )
  })
})
