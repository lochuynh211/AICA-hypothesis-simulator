/**
 * ProposalScreen.i18n (P1 T030) — EN is the default language for the whole
 * Proposal shell; toggling to JA switches every panel heading/label;
 * toggling back to EN restores the original EN text (FR-004, SC-007).
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProposalStoreProvider } from '../src/state/proposalStore'
import { LanguageProvider } from '../src/state/language'
import { ProposalLanguageBridge } from '../src/state/languageBridges'
import GlobalLanguageToggle from '../src/components/layout/GlobalLanguageToggle'
import ProposalShell from '../src/components/proposal/ProposalShell'

/** Mirrors App.tsx's proposal-branch wiring: the single global language toggle
 *  drives the LanguageProvider, whose value the bridge mirrors into the
 *  proposal store's uiLanguage (which the shell reads). */
function ToggleHarness() {
  return (
    <LanguageProvider initialLanguage="en">
      <ProposalStoreProvider initialLanguage="en">
        <ProposalLanguageBridge>
          <GlobalLanguageToggle />
          <ProposalShell />
        </ProposalLanguageBridge>
      </ProposalStoreProvider>
    </LanguageProvider>
  )
}

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

describe('ProposalScreen bilingual (EN default / JA toggle / back to EN)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders EN labels by default across all three panels', async () => {
    render(
      <ProposalStoreProvider>
        <ProposalShell />
      </ProposalStoreProvider>,
    )
    await waitFor(() => expect(getPackages).toHaveBeenCalled())
    await screen.findByText('mock_service_selector_v1')

    // Panel headings (EN default)
    expect(screen.getByText('Input · World')).toBeInTheDocument()
    expect(screen.getByText('Service proposal')).toBeInTheDocument()
    expect(screen.getByText('Content proposal')).toBeInTheDocument()

    // A section label from each panel + a hyperparameter label from the manifest.
    expect(screen.getByText('Trigger signal (4)')).toBeInTheDocument()
    // Both panels group setup under labeled sections now; the service panel's
    // "Setting" header is present (this fixture's content package has no
    // hyperparameters, so the content panel renders no setup sections).
    expect(screen.getByText('Setting')).toBeInTheDocument()
    // Fix (duplicate-label review finding): HyperparamMatrix is rendered with
    // `hideLabel` in the service subslab, and this fixture's CONTENT_PACKAGE
    // has no hyperparameters, so "Category Weights" renders exactly once
    // (the service subslab header).
    expect(screen.getByText('Category Weights')).toBeInTheDocument()
  })

  it('toggling to JA switches every panel heading/label, and back to EN restores them', async () => {
    render(<ToggleHarness />)
    await waitFor(() => expect(getPackages).toHaveBeenCalled())
    await screen.findByText('mock_service_selector_v1')

    expect(screen.getByText('Input · World')).toBeInTheDocument()

    // The single global toggle (App's top bar) drives the language now.
    fireEvent.click(screen.getByTestId('lang-toggle-ja'))

    await waitFor(() => expect(screen.getByText('入力・世界')).toBeInTheDocument())
    expect(screen.queryByText('Input · World')).not.toBeInTheDocument()
    expect(screen.getByText('サービス提案')).toBeInTheDocument()
    expect(screen.getByText('コンテンツ提案')).toBeInTheDocument()
    expect(screen.getByText('発火シグナル（4つ）')).toBeInTheDocument()
    expect(screen.getByText('設定')).toBeInTheDocument()
    // Fix (duplicate-label review finding): single match — see EN-default case above.
    expect(screen.getByText('カテゴリ重み')).toBeInTheDocument()
    expect(screen.queryByText('Category Weights')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('lang-toggle-en'))

    await waitFor(() => expect(screen.getByText('Input · World')).toBeInTheDocument())
    expect(screen.queryByText('入力・世界')).not.toBeInTheDocument()
    expect(screen.getByText('Service proposal')).toBeInTheDocument()
    expect(screen.getByText('Content proposal')).toBeInTheDocument()
    expect(screen.getByText('Trigger signal (4)')).toBeInTheDocument()
    // Fix (duplicate-label review finding): single match — see EN-default case above.
    expect(screen.getByText('Category Weights')).toBeInTheDocument()
  })
})
