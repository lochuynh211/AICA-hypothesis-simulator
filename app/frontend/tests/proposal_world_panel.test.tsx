import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProposalStoreProvider, useProposalStore } from '../src/state/proposalStore'
import WorldPanel from '../src/components/proposal/panels/WorldPanel'

// WorldPanel (and its SeedPicker/DriverProfilePicker children) fetch
// datasets/catalog/seeds/profiles on mount (P3). Mock the client so these
// structural tests stay deterministic and don't depend on network/fetch.
vi.mock('../src/api/proposalClient', async () => {
  const actual = await vi.importActual<typeof import('../src/api/proposalClient')>('../src/api/proposalClient')
  return {
    ...actual,
    getDatasets: vi.fn().mockResolvedValue({ datasets: [], errors: [] }),
    getCatalog: vi.fn().mockResolvedValue({
      provenance: {
        dataset_id: 'soundcharts-grounded-spotify-compatible-demonstration-seed-1042',
        dataset_version: {
          schema_version: '1.0.0',
          spotify_track_reference_version: '1.0.0',
          spotify_audio_features_reference_version: '1.0.0',
        },
        dataset_hash: 'sha256:test',
        tier: 'demonstration',
        provenance_note: 'test fixture',
      },
      total: 0,
      songs: [],
    }),
    getSeeds: vi.fn().mockResolvedValue({ seeds: [] }),
    listProfiles: vi.fn().mockResolvedValue({ profiles: [] }),
  }
})

function renderWithStore() {
  function Wrapper() {
    return (
      <ProposalStoreProvider>
        <WorldPanel />
      </ProposalStoreProvider>
    )
  }
  return render(<Wrapper />)
}

describe('WorldPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the section order: trigger signal, car state, world/situation, preference & history', async () => {
    renderWithStore()
    await screen.findByTestId('dataset-provenance-banner')
    const headings = screen.getAllByTestId('world-section-label').map((el) => el.textContent)
    // EN default labels, in document order. The driver-profile picker no
    // longer has its own trailing section — it moved to the TOP of
    // "Preference & history" (owner feedback 2026-07-17).
    expect(headings.length).toBe(4)
    expect(headings[0]).toMatch(/提案分類|proposal category/i)
    expect(headings[headings.length - 1]).toMatch(/好み・履歴|preference & history/i)
  })

  it('shows the 4 trigger_purpose options as selectable, with rest_recommended selected by default', () => {
    renderWithStore()
    const selected = screen.getByTestId('trigger-purpose-rest_recommended')
    expect(selected.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('trigger-purpose-route_music')).toBeInTheDocument()
    expect(screen.getByTestId('trigger-purpose-inattentive_driving_prevention_recovery')).toBeInTheDocument()
    expect(screen.getByTestId('trigger-purpose-child_passenger_experience')).toBeInTheDocument()
  })

  it('clicking a different trigger_purpose dispatches SET_TRIGGER_PURPOSE', () => {
    function Probe() {
      const { state } = useProposalStore()
      return <span data-testid="probe">{state.triggerPurpose}</span>
    }
    render(
      <ProposalStoreProvider>
        <WorldPanel />
        <Probe />
      </ProposalStoreProvider>,
    )
    expect(screen.getByTestId('probe').textContent).toBe('rest_recommended')
    fireEvent.click(screen.getByTestId('trigger-purpose-route_music'))
    expect(screen.getByTestId('probe').textContent).toBe('route_music')
  })

  it('renders only the car states valid for the current signal (during_rest_stopped is never selectable — it is the nap)', () => {
    renderWithStore()
    // Default signal is rest_recommended → only the two rest stages appear.
    expect(screen.getByTestId('lifecycle-stage-before_rest_until_stop')).toBeInTheDocument()
    expect(screen.getByTestId('lifecycle-stage-after_rest_before_restart')).toBeInTheDocument()
    // The nap (during_rest_stopped) proposes nothing and is never user-selectable here.
    expect(screen.queryByTestId('lifecycle-stage-during_rest_stopped')).not.toBeInTheDocument()
    // active_driving_content belongs to the non-rest signals, not rest_recommended.
    expect(screen.queryByTestId('lifecycle-stage-active_driving_content')).not.toBeInTheDocument()
    // No editable motion control — it's derived (owner feedback 2026-07-17).
    expect(screen.queryByTestId('motion-state-select')).not.toBeInTheDocument()
    expect(screen.getByTestId('motion-state-readonly')).toBeInTheDocument()
  })

  it('a non-rest signal locks the car state to active_driving_content and hides the rest stages', () => {
    renderWithStore()
    fireEvent.click(screen.getByTestId('trigger-purpose-route_music'))
    expect(screen.getByTestId('lifecycle-stage-active_driving_content')).toBeInTheDocument()
    expect(screen.queryByTestId('lifecycle-stage-before_rest_until_stop')).not.toBeInTheDocument()
    expect(screen.queryByTestId('lifecycle-stage-after_rest_before_restart')).not.toBeInTheDocument()
    // active_driving_content ⇒ motion derives to driving.
    expect(screen.getByTestId('motion-state-readonly').textContent).toBe('driving')
  })

  it('clicking a "stopped" lifecycle stage derives motion_state=stopped; a "driving" stage derives motion_state=driving', () => {
    renderWithStore()
    // rest_recommended default: after_rest ⇒ stopped, before_rest ⇒ driving.
    fireEvent.click(screen.getByTestId('lifecycle-stage-after_rest_before_restart'))
    expect(screen.getByTestId('motion-state-readonly').textContent).toBe('stopped')

    fireEvent.click(screen.getByTestId('lifecycle-stage-before_rest_until_stop'))
    expect(screen.getByTestId('motion-state-readonly').textContent).toBe('driving')

    // active_driving_content (driving) is reached via a non-rest signal.
    fireEvent.click(screen.getByTestId('trigger-purpose-inattentive_driving_prevention_recovery'))
    expect(screen.getByTestId('motion-state-readonly').textContent).toBe('driving')
  })

  it('editing a world/situation slider field (drowsiness_level, 0-100 step 5) dispatches SET_SITUATION_FIELD', () => {
    function Probe() {
      const { state } = useProposalStore()
      return <span data-testid="probe">{String(state.world.situation.drowsiness_level)}</span>
    }
    render(
      <ProposalStoreProvider>
        <WorldPanel />
        <Probe />
      </ProposalStoreProvider>,
    )
    const input = screen.getByTestId('feature-field-drowsiness_level') as HTMLInputElement
    expect(input.type).toBe('range')
    expect(input.min).toBe('0')
    expect(input.max).toBe('100')
    expect(input.step).toBe('5')
    fireEvent.change(input, { target: { value: '80' } })
    expect(screen.getByTestId('probe').textContent).toBe('80')
  })

  it('renders a usage badge (S/C/S·C) for every world/situation feature field', () => {
    renderWithStore()
    const badges = screen.getAllByTestId('usage-badge')
    expect(badges.length).toBeGreaterThan(5)
  })

  it('is preset-first: the Preset picker is present and the old Seed / Driver-Profile pickers are gone', async () => {
    renderWithStore()
    await waitFor(() => expect(screen.getByTestId('preset-picker-select')).toBeInTheDocument())
    // The standalone Seed and Driver-Profile pickers were removed from the
    // panel in favor of the parent Preset selector (feature 018).
    expect(screen.queryByTestId('seed-picker-select')).toBeNull()
    expect(screen.queryByTestId('profile-picker-select')).toBeNull()
  })
})
