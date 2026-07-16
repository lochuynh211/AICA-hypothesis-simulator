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

  it('renders the section order: trigger signal, car state, world/situation, preference & history, driver profile', async () => {
    renderWithStore()
    await screen.findByTestId('dataset-provenance-banner')
    const headings = screen.getAllByTestId('world-section-label').map((el) => el.textContent)
    // JA default labels, in document order.
    expect(headings.length).toBe(5)
    expect(headings[0]).toMatch(/発火シグナル|trigger signal/i)
    expect(headings[headings.length - 1]).toMatch(/ドライバープロファイル|driver profile/i)
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

  it('renders lifecycle_stage options and motion_state selector', () => {
    renderWithStore()
    expect(screen.getByTestId('lifecycle-stage-before_rest_until_stop')).toBeInTheDocument()
    expect(screen.getByTestId('lifecycle-stage-during_rest_stopped')).toBeInTheDocument()
    expect(screen.getByTestId('lifecycle-stage-after_rest_before_restart')).toBeInTheDocument()
    expect(screen.getByTestId('lifecycle-stage-active_driving_content')).toBeInTheDocument()
    expect(screen.getByTestId('motion-state-select')).toBeInTheDocument()
  })

  it('editing a world/situation field dispatches SET_SITUATION_FIELD', () => {
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
    fireEvent.change(input, { target: { value: '80' } })
    expect(screen.getByTestId('probe').textContent).toBe('80')
  })

  it('renders a provenance badge for every world/situation feature field', () => {
    renderWithStore()
    const badges = screen.getAllByTestId('provenance-badge')
    expect(badges.length).toBeGreaterThan(5)
  })

  it('renders the driver profile picker in the last section', async () => {
    renderWithStore()
    await waitFor(() => expect(screen.getByTestId('profile-picker-select')).toBeInTheDocument())
    const headings = screen.getAllByTestId('world-section-label')
    const lastHeading = headings[headings.length - 1]
    // The DriverProfilePicker (profile-picker-select) is rendered after the
    // last section label in document order.
    const position = lastHeading.compareDocumentPosition(screen.getByTestId('profile-picker-select'))
    // eslint-disable-next-line no-bitwise
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
