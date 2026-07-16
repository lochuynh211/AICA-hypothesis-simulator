/**
 * T043b (updated P3 T026) — WorldPanel renders a ProvenanceBadge for every
 * world feature field (FR-005). P3 rebuilt WorldPanel into a real editor over
 * the typed `World`, with far more `Situation`/`DriverProfile` fields than
 * the P1 subset this test used to hardcode — rather than re-mirroring a
 * long, fragile key list, this asserts the INVARIANT directly against the
 * rendered DOM: every `feature-field-*` control has exactly one adjacent
 * provenance badge, no field is silently missing one, and no stray/duplicate
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
    getDatasets: vi.fn().mockResolvedValue({ datasets: [], errors: [] }),
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

describe('WorldPanel provenance badge coverage (FR-005, T043b)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('every world-field row has exactly one adjacent provenance badge', () => {
    // `data-world-field` marks each FieldRow's own row wrapper (distinct from
    // the `feature-field-<key>` testid, which some complex editors — record
    // maps, item lists — also apply to their OWN internal sub-controls, e.g.
    // `feature-field-recent_service_rejections-add`; querying by that prefix
    // would over-match into rows with no badge of their own).
    const { container } = renderWithStore()
    const rows = container.querySelectorAll('[data-world-field]')
    expect(rows.length).toBeGreaterThan(20) // situation (14) + driver-profile (~34)
    rows.forEach((row) => {
      const badges = row.querySelectorAll('[data-testid="provenance-badge"]')
      expect(badges.length).toBe(1)
      expect(badges[0].textContent).toBeTruthy()
    })
  })

  it('road_type is badged normalized_cdc_su_concept, distinct from the cdc_su_baseline fields', () => {
    renderWithStore()
    const roadTypeRow = screen.getByTestId('feature-field-road_type').parentElement!
    const roadTypeBadge = roadTypeRow.querySelector('[data-testid="provenance-badge"]')
    const drowsinessRow = screen.getByTestId('feature-field-drowsiness_level').parentElement!
    const drowsinessBadge = drowsinessRow.querySelector('[data-testid="provenance-badge"]')

    expect(roadTypeBadge?.getAttribute('title')).not.toBe(drowsinessBadge?.getAttribute('title'))
  })

  it('the motion_state control (outside the Field-row loop) also carries its own provenance badge', () => {
    renderWithStore()
    const motionSelect = screen.getByTestId('motion-state-select')
    const row = motionSelect.parentElement!
    expect(row.querySelectorAll('[data-testid="provenance-badge"]').length).toBe(1)
  })
})
