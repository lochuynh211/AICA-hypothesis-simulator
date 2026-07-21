import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import App, { AppModeToggle } from '../src/App'
import { AppModeProvider } from '../src/state/appMode'
import { LanguageProvider } from '../src/state/language'

// Route fetch by URL so App/AppShell/ProposalShell's health + registry effects
// don't reject (App defaults to the proposal shell — see appMode.test.tsx).
function mockFetchByUrl(healthBody: unknown) {
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    if (url === '/api/health') {
      return { ok: true, json: async () => healthBody }
    }
    if (url === '/api/packages') {
      return { ok: true, json: async () => ({ packages: [], errors: [] }) }
    }
    if (url === '/api/scenarios') {
      return { ok: true, json: async () => ({ scenarios: [], errors: [] }) }
    }
    if (url === '/api/proposal/packages') {
      return { ok: true, json: async () => ({ slots: [], packages: [], errors: [] }) }
    }
    if (url === '/api/proposal/matrix') {
      return { ok: true, json: async () => ({ matrix_version: 'v1', rows: [] }) }
    }
    return { ok: false, status: 404 }
  })
}

describe('merged appMode', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('selects the Combined mode and renders the merged shell stub', async () => {
    mockFetchByUrl({ status: 'ok', service: 'aica-api', version: '0.0.0' })

    render(<App />)

    // The app defaults to Japanese, so the Combined mode button reads 統合.
    fireEvent.click(await screen.findByRole('button', { name: '統合' }))

    expect(await screen.findByTestId('merged-shell')).toBeInTheDocument()
  })

  it('renders the Japanese label 統合 for the Combined mode toggle', () => {
    render(
      <LanguageProvider>
        <AppModeProvider>
          <AppModeToggle />
        </AppModeProvider>
      </LanguageProvider>,
    )
    expect(screen.getByRole('button', { name: '統合' })).toBeInTheDocument()
  })
})
