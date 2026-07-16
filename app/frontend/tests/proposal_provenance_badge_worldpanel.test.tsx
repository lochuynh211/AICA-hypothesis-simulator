/**
 * T043b — WorldPanel renders a ProvenanceBadge for every world feature field
 * (FR-005). Complements `proposal_provenance_badge.test.tsx` (ProvenanceBadge
 * in isolation) and `proposal_world_panel.test.tsx`'s loose ">5" badge-count
 * check with an EXPLICIT per-field assertion: every `feature-field-<key>`
 * control WorldPanel renders has its own adjacent provenance badge, and the
 * total badge count matches the full field set exactly (no field silently
 * missing a badge, and no stray/duplicate badges).
 */
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ProposalStoreProvider } from '../src/state/proposalStore'
import WorldPanel from '../src/components/proposal/panels/WorldPanel'

// Mirrors WorldPanel.tsx's WORLD_SITUATION_FIELDS + PREFERENCE_FIELDS keys.
const WORLD_SITUATION_FIELD_KEYS = [
  'drowsiness_level',
  'fatigue_level',
  'monotony_level',
  'traffic_state',
  'road_type',
  'night_state',
  'route_tags',
  'destination_tags',
  'child_present',
  'multiple_passengers',
]

const PREFERENCE_FIELD_KEYS = ['age_band', 'gender']

const ALL_FIELD_KEYS = [...WORLD_SITUATION_FIELD_KEYS, ...PREFERENCE_FIELD_KEYS]

function renderWithStore() {
  return render(
    <ProposalStoreProvider>
      <WorldPanel />
    </ProposalStoreProvider>,
  )
}

describe('WorldPanel provenance badge coverage (FR-005, T043b)', () => {
  it.each(ALL_FIELD_KEYS)('field "%s" has an adjacent provenance badge', (key) => {
    renderWithStore()
    const field = screen.getByTestId(`feature-field-${key}`)
    const row = field.parentElement
    expect(row).not.toBeNull()
    const badge = row!.querySelector('[data-testid="provenance-badge"]')
    expect(badge).not.toBeNull()
    expect(badge?.textContent).toBeTruthy()
  })

  it('renders exactly one provenance badge per world/situation + preference field, plus the motion_state and section-level badges', () => {
    renderWithStore()
    // One badge per Field() row (world/situation + preference) ...
    for (const key of ALL_FIELD_KEYS) {
      const field = screen.getByTestId(`feature-field-${key}`)
      const badgesInRow = field.parentElement!.querySelectorAll('[data-testid="provenance-badge"]')
      expect(badgesInRow.length).toBe(1)
    }
    // ... plus motion_state's own badge and the "Preference & history"
    // section-level "from profile" badge (both outside the Field() rows).
    const totalBadges = screen.getAllByTestId('provenance-badge')
    expect(totalBadges.length).toBe(ALL_FIELD_KEYS.length + 2)
  })

  it('road_type is badged normalized_cdc_su_concept, distinct from the cdc_su_baseline fields', () => {
    renderWithStore()
    const roadTypeRow = screen.getByTestId('feature-field-road_type').parentElement!
    const roadTypeBadge = roadTypeRow.querySelector('[data-testid="provenance-badge"]')
    const drowsinessRow = screen.getByTestId('feature-field-drowsiness_level').parentElement!
    const drowsinessBadge = drowsinessRow.querySelector('[data-testid="provenance-badge"]')

    expect(roadTypeBadge?.getAttribute('title')).not.toBe(drowsinessBadge?.getAttribute('title'))
  })
})
