/**
 * ProposalScreen.i18n (P1 T030) — JA is the default language for the whole
 * Proposal shell; toggling to EN switches every panel heading/label;
 * toggling back to JA restores the original JA text (FR-004, SC-007).
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProposalStoreProvider } from '../src/state/proposalStore'
import ProposalShell from '../src/components/proposal/ProposalShell'

// vi.mock factories are hoisted above top-level consts, so fixtures used
// inside the factory must themselves be declared via vi.hoisted().
const { SERVICE_PACKAGE, CONTENT_PACKAGE } = vi.hoisted(() => ({
  SERVICE_PACKAGE: {
    id: 'mock_service_selector_v1',
    version: '1.0.0',
    label: { ja: 'モック・サービス選定 v1.0', en: 'Mock Service Selector v1.0' },
    family: 'service_selector' as const,
    approach: 'transparent' as const,
    contract_version: '1.0.0',
    supported_services: [] as string[],
    parameters: { top_k: 3 },
    hyperparameters: [
      {
        key: 'category_weights',
        kind: 'table' as const,
        label: { ja: 'カテゴリ重み', en: 'Category Weights' },
        default: { Situation: 0.8, Preference: 0.12, History: 0.08 },
      },
    ],
  },
  CONTENT_PACKAGE: {
    id: 'mock_content_selector_v1',
    version: '1.0.0',
    label: { ja: 'モック・コンテンツ選定 v1.0', en: 'Mock Content Selector v1.0' },
    family: 'content_selector' as const,
    approach: 'transparent' as const,
    contract_version: '1.0.0',
    supported_services: ['music_playlist'],
    parameters: { plan_item_count: 5 },
    hyperparameters: [] as unknown[],
  },
}))

vi.mock('../src/api/proposalClient', async () => {
  const actual = await vi.importActual<typeof import('../src/api/proposalClient')>('../src/api/proposalClient')
  return {
    ...actual,
    getPackages: vi.fn().mockResolvedValue({
      slots: [],
      packages: [SERVICE_PACKAGE, CONTENT_PACKAGE],
      errors: [],
    }),
    getMatrix: vi.fn().mockResolvedValue({ matrix_version: 'v1', rows: [] }),
  }
})

import { getPackages } from '../src/api/proposalClient'

describe('ProposalScreen bilingual (JA default / EN toggle / back to JA)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders JA labels by default across all three panels', async () => {
    render(
      <ProposalStoreProvider>
        <ProposalShell />
      </ProposalStoreProvider>,
    )
    await waitFor(() => expect(getPackages).toHaveBeenCalled())
    await screen.findByText('mock_service_selector_v1')

    // Panel headings (JA default)
    expect(screen.getByText('入力・世界')).toBeInTheDocument()
    expect(screen.getByText('サービス提案')).toBeInTheDocument()
    expect(screen.getByText('コンテンツ提案')).toBeInTheDocument()

    // A section label from each panel + a hyperparameter label from the manifest.
    expect(screen.getByText('発火シグナル（4つ）')).toBeInTheDocument()
    expect(screen.getAllByText('パラメータ（編集可）').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('カテゴリ重み')).toBeInTheDocument()
  })

  it('toggling to EN switches every panel heading/label, and back to JA restores them', async () => {
    render(
      <ProposalStoreProvider>
        <ProposalShell />
      </ProposalStoreProvider>,
    )
    await waitFor(() => expect(getPackages).toHaveBeenCalled())
    await screen.findByText('mock_service_selector_v1')

    expect(screen.getByText('入力・世界')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('proposal-lang-toggle-en'))

    expect(screen.queryByText('入力・世界')).not.toBeInTheDocument()
    expect(screen.getByText('Input · World')).toBeInTheDocument()
    expect(screen.getByText('Service proposal')).toBeInTheDocument()
    expect(screen.getByText('Content proposal')).toBeInTheDocument()
    expect(screen.getByText('Trigger signal (4)')).toBeInTheDocument()
    expect(screen.getAllByText('Parameters (editable)').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Category Weights')).toBeInTheDocument()
    expect(screen.queryByText('カテゴリ重み')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('proposal-lang-toggle-ja'))

    expect(screen.queryByText('Input · World')).not.toBeInTheDocument()
    expect(screen.getByText('入力・世界')).toBeInTheDocument()
    expect(screen.getByText('サービス提案')).toBeInTheDocument()
    expect(screen.getByText('コンテンツ提案')).toBeInTheDocument()
    expect(screen.getByText('発火シグナル（4つ）')).toBeInTheDocument()
    expect(screen.getByText('カテゴリ重み')).toBeInTheDocument()
  })
})
