import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import App from '../src/App'

// Route fetch by URL so the 3-panel layout's component effects don't reject
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

    // After the async fetch resolves — health status appears in the left panel
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
