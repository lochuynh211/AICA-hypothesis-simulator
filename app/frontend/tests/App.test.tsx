import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import App from '../src/App'

// Route fetch by URL so the 3-panel layout's component effects don't reject.
// The app now opens in proposal mode by default, so also stub the proposal
// endpoints ProposalShell fetches on mount.
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

describe('App — backend health display', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('shows loading then success when backend is healthy', async () => {
    mockFetchByUrl({ status: 'ok', service: 'aica-api', version: '0.0.0' })

    render(<App />)

    // Initial loading state
    expect(screen.getByText('Checking backend…')).toBeInTheDocument()

    // The app now opens in proposal mode by default, so the health status
    // (an AppShell-only string) isn't visible until switched to trigger mode.
    // Combined is now the default screen.
    expect(await screen.findByTestId('merged-shell')).toBeInTheDocument()

    // The app defaults to Japanese, so the Trigger mode button reads トリガー.
    fireEvent.click(screen.getByRole('button', { name: 'トリガー' }))

    // After the async fetch resolves — health status appears in the AppShell header
    expect(await screen.findByText('Backend: ok — aica-api')).toBeInTheDocument()
    expect(global.fetch).toHaveBeenCalledWith('/api/health')
  })

  it('shows error state when fetch rejects (network error)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network failure'))

    render(<App />)

    expect(await screen.findByText('Backend unavailable')).toBeInTheDocument()
  })

  it('shows error state when response is non-ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
    })

    render(<App />)

    expect(await screen.findByText('Backend unavailable')).toBeInTheDocument()
  })

  it('shows error state when response body has unexpected shape', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: 'fine' }),
    })

    render(<App />)

    expect(await screen.findByText('Backend unavailable')).toBeInTheDocument()
  })
})
