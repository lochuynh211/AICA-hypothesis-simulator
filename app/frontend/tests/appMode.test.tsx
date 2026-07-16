import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import App from '../src/App'

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
    expect(screen.queryByText('Proposal (coming soon)')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Proposal' }))

    expect(screen.getByText('Proposal (coming soon)')).toBeInTheDocument()
    expect(screen.queryByText('Backend: ok — aica-api')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }))

    expect(await screen.findByText('Backend: ok — aica-api')).toBeInTheDocument()
    expect(screen.queryByText('Proposal (coming soon)')).not.toBeInTheDocument()
  })
})
