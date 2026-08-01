/**
 * T043b (updated P3 T026; reworked per owner feedback 2026-07-17) — WorldPanel
 * used to badge every field with its CDC-SU/normalized/proposed_addition
 * PROVENANCE. That label answered "where did this field come from", not the
 * question reviewers actually asked ("does moving this do anything"), and the
 * panel showed dozens of fields no V1 algorithm ever reads. The panel now
 * shows ONLY fields actually scored by the service and/or content algorithm
 * (per aica_transparent_service_proposal_algorithm.md /
 * aica_transparent_content_proposal_algorithm.md), each with a `UsageBadge`
 * (S / C / S·C) instead. This asserts the new invariant directly against the
 * rendered DOM: every `feature-field-*` control has exactly one adjacent
 * usage badge, no field is silently missing one, and no stray/duplicate
 * badges are attached to a single field's row.
 */
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProposalStoreProvider } from '../src/state/proposalStore'
import WorldPanel from '../src/components/proposal/panels/WorldPanel'

vi.mock('../src/api/proposalClient', async () => {
  const actual = await vi.importActual<typeof import('../src/api/proposalClient')>('../src/api/proposalClient')
  return {
    ...actual,
    getCatalog: vi.fn().mockRejectedValue(new Error('no fetch in this test')),
    getSeeds: vi.fn().mockResolvedValue({ seeds: [] }),
    listProfiles: vi.fn().mockResolvedValue({ profiles: [] }),
  }
})

function renderWithStore() {
  return render(
    <ProposalStoreProvider>
      <WorldPanel />
    </ProposalStoreProvider>,
  )
}

describe('WorldPanel usage badge coverage (S/C/S·C, replaces provenance badges)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('every world-field row has exactly one adjacent usage badge', () => {
    const { container } = renderWithStore()
    const rows = container.querySelectorAll('[data-world-field]')
    // Situation (10 scored fields) + driver-profile (~11 scored fields across
    // 5 groups) — far fewer than the old all-fields count, since only
    // actually-scored fields remain.
    expect(rows.length).toBeGreaterThan(15)
    rows.forEach((row) => {
      const badges = row.querySelectorAll('[data-testid="usage-badge"]')
      expect(badges.length).toBe(1)
      expect(badges[0].textContent).toBeTruthy()
    })
  })

  it('a service-only field (route_tags) is badged S only, and a content-only field (oshi_artists) is badged C only', () => {
    renderWithStore()
    const routeTagsRow = screen.getByTestId('feature-field-route_tags').closest('[data-world-field]')!
    expect(routeTagsRow.querySelector('[data-testid="usage-badge"]')?.textContent).toBe('S')

    const oshiArtistsRow = screen.getByTestId('feature-field-oshi_artists').closest('[data-world-field]')!
    expect(oshiArtistsRow.querySelector('[data-testid="usage-badge"]')?.textContent).toBe('C')
  })

  it('a dual-scored field (drowsiness_level) is badged with both S and C', () => {
    renderWithStore()
    const row = screen.getByTestId('feature-field-drowsiness_level').closest('[data-world-field]')!
    expect(row.querySelector('[data-testid="usage-badge"]')?.textContent).toBe('SC')
  })

  it('the CDC-SU / norm. / added provenance vocabulary is gone from the panel', () => {
    const { container } = renderWithStore()
    expect(container.textContent).not.toMatch(/CDC-SU/)
    expect(container.textContent).not.toMatch(/\bnorm\.\b/)
    expect(container.querySelectorAll('[data-testid="provenance-badge"]').length).toBe(0)
  })

  it('motion_state is now a read-only readout, not an editable control with its own badge', () => {
    renderWithStore()
    expect(screen.queryByTestId('motion-state-select')).not.toBeInTheDocument()
    expect(screen.getByTestId('motion-state-readonly')).toBeInTheDocument()
  })
})
