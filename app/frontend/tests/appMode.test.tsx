import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import App, { AppModeToggle } from '../src/App'
import { AppModeProvider } from '../src/state/appMode'
import { LanguageProvider } from '../src/state/language'

// Route fetch by URL so App/AppShell's health + registry effects don't reject.
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

describe('appMode toggle', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('defaults to the proposal shell and switches to the trigger shell and back', async () => {
    mockFetchByUrl({ status: 'ok', service: 'aica-api', version: '0.0.0' })

    render(<App />)

    // Proposal shell renders by default (health status is an AppShell-only string).
    expect(await screen.findByTestId('proposal-shell')).toBeInTheDocument()
    expect(screen.queryByText('Backend: ok — aica-api')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('world-panel')).toBeInTheDocument())

    // The app now defaults to Japanese, so the mode buttons render JA labels.
    fireEvent.click(screen.getByRole('button', { name: 'トリガー' }))

    expect(await screen.findByText('Backend: ok — aica-api')).toBeInTheDocument()
    expect(screen.queryByTestId('proposal-shell')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '提案' }))

    expect(screen.getByTestId('proposal-shell')).toBeInTheDocument()
    expect(screen.queryByText('Backend: ok — aica-api')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// FR-004 bilingual labels — the toggle resolves its labels via the shared t()
// helper, driven by the single global LanguageProvider. Covers the JA default
// and the EN override.
// ---------------------------------------------------------------------------

describe('AppModeToggle bilingual labels', () => {
  it('renders the Japanese labels by default (LanguageProvider defaults to ja)', () => {
    render(
      <LanguageProvider>
        <AppModeProvider>
          <AppModeToggle />
        </AppModeProvider>
      </LanguageProvider>,
    )
    expect(screen.getByRole('button', { name: 'トリガー' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '提案' })).toBeInTheDocument()
  })

  it('renders the English labels when the global language is en', () => {
    render(
      <LanguageProvider initialLanguage="en">
        <AppModeProvider>
          <AppModeToggle />
        </AppModeProvider>
      </LanguageProvider>,
    )
    expect(screen.getByRole('button', { name: 'Trigger' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Proposal' })).toBeInTheDocument()
  })
})
