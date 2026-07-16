import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import App, { AppModeToggle } from '../src/App'
import { AppModeProvider } from '../src/state/appMode'

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

  it('defaults to the trigger shell and switches to the proposal placeholder and back', async () => {
    mockFetchByUrl({ status: 'ok', service: 'aica-api', version: '0.0.0' })

    render(<App />)

    // Trigger shell renders by default (health status is an AppShell-only string).
    expect(await screen.findByText('Backend: ok — aica-api')).toBeInTheDocument()
    expect(screen.queryByTestId('proposal-shell')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Proposal' }))

    expect(screen.getByTestId('proposal-shell')).toBeInTheDocument()
    expect(screen.queryByText('Backend: ok — aica-api')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('world-panel')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }))

    expect(await screen.findByText('Backend: ok — aica-api')).toBeInTheDocument()
    expect(screen.queryByTestId('proposal-shell')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// FR-004 bilingual labels — the toggle previously hardcoded English strings
// ('Trigger'/'Proposal') directly rather than resolving them via the shared
// t() helper. Covers both the (unchanged) default rendering and the
// previously-impossible Japanese rendering.
// ---------------------------------------------------------------------------

describe('AppModeToggle bilingual labels', () => {
  it('renders the English labels by default (t() resolving {ja,en} via the "en" default)', () => {
    render(
      <AppModeProvider>
        <AppModeToggle />
      </AppModeProvider>,
    )
    expect(screen.getByRole('button', { name: 'Trigger' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Proposal' })).toBeInTheDocument()
  })

  it('renders the Japanese labels when passed lang="ja"', () => {
    render(
      <AppModeProvider>
        <AppModeToggle lang="ja" />
      </AppModeProvider>,
    )
    expect(screen.getByRole('button', { name: 'トリガー' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '提案' })).toBeInTheDocument()
  })
})
