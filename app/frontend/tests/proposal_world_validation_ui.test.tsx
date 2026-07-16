/**
 * proposal_world_validation_ui (P3 polish MF1 — US1 AC#3 / SC-002).
 *
 * WorldPanel wires `proposalClient.validateWorld(world)` on every edit
 * (debounced) and renders the returned `{path, code, message}` issues both
 * as a general summary list (`world-validation-issues`) and inline next to
 * the offending field (`feature-field-<key>-issue`) — especially for
 * catalog-reference fields like `driver_profile.oshi_id`, per the note in
 * the acceptance scenario.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProposalStoreProvider } from '../src/state/proposalStore'
import WorldPanel from '../src/components/proposal/panels/WorldPanel'

vi.mock('../src/api/proposalClient', async () => {
  const actual = await vi.importActual<typeof import('../src/api/proposalClient')>('../src/api/proposalClient')
  return {
    ...actual,
    getDatasets: vi.fn(),
    getCatalog: vi.fn(),
    getSeeds: vi.fn(),
    getSeed: vi.fn(),
    listProfiles: vi.fn(),
    getProfile: vi.fn(),
    saveProfile: vi.fn(),
    deleteProfile: vi.fn(),
    validateWorld: vi.fn(),
  }
})

import { getDatasets, getCatalog, getSeeds, listProfiles, validateWorld } from '../src/api/proposalClient'

function setupBaselineMocks() {
  vi.mocked(getDatasets).mockResolvedValue({ datasets: [], errors: [] })
  vi.mocked(getCatalog).mockResolvedValue({
    provenance: {
      dataset_id: 'soundcharts-grounded-spotify-compatible-demonstration-seed-1042',
      dataset_version: {
        schema_version: '1.0.0',
        spotify_track_reference_version: '1.0.0',
        spotify_audio_features_reference_version: '1.0.0',
      },
      dataset_hash: 'sha256:83d8079c7a81bc6afbd01cdba65fe2330de66b900a113723814fa938fce516cd',
      tier: 'demonstration',
      provenance_note: 'P2 Soundcharts-grounded synthetic dataset',
    },
    total: 0,
    songs: [],
  })
  vi.mocked(getSeeds).mockResolvedValue({ seeds: [] })
  vi.mocked(listProfiles).mockResolvedValue({
    profiles: [{ profile_id: 'profile-neutral-default', label: { ja: '標準', en: 'Neutral' }, builtin: true }],
  })
}

function renderWithStore() {
  return render(
    <ProposalStoreProvider>
      <WorldPanel />
    </ProposalStoreProvider>,
  )
}

describe('WorldPanel inline world validation (MF1)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setupBaselineMocks()
  })

  it('a valid world shows no validation issues anywhere', async () => {
    vi.mocked(validateWorld).mockResolvedValue({ valid: true, issues: [] })
    renderWithStore()

    await waitFor(() => expect(validateWorld).toHaveBeenCalled())
    // Give the debounced effect's resolved promise a tick to apply.
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(screen.queryByTestId('world-validation-issues')).not.toBeInTheDocument()
    expect(screen.queryByTestId('feature-field-oshi_id-issue')).not.toBeInTheDocument()
  })

  it('an invalid world (unknown oshi_id reference) surfaces a field-level message near oshi_id and in the summary list', async () => {
    vi.mocked(validateWorld).mockResolvedValue({
      valid: false,
      issues: [
        {
          path: 'driver_profile.oshi_id',
          code: 'unknown_catalog_reference',
          message:
            "driver_profile.oshi_id: unknown artist id 'synthetic-artist-9999' — not present in dataset's catalog.",
        },
      ],
    })
    renderWithStore()

    const issue = await screen.findByTestId('feature-field-oshi_id-issue')
    expect(issue).toHaveTextContent('synthetic-artist-9999')

    const summary = screen.getByTestId('world-validation-issues')
    expect(summary).toHaveTextContent('synthetic-artist-9999')
  })

  it('editing a field re-triggers validateWorld (debounced) with the updated world', async () => {
    vi.mocked(validateWorld).mockResolvedValue({ valid: true, issues: [] })
    renderWithStore()

    await waitFor(() => expect(validateWorld).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByTestId('feature-field-oshi_id'), { target: { value: 'synthetic-artist-0157' } })

    await waitFor(() => expect(validateWorld).toHaveBeenCalledTimes(2))
    const [lastCallArg] = vi.mocked(validateWorld).mock.calls[1]
    expect(lastCallArg.driver_profile.oshi_id).toBe('synthetic-artist-0157')
  })

  it('a validateWorld rejection (e.g. network error) never crashes the editor', async () => {
    vi.mocked(validateWorld).mockRejectedValue(new Error('network down'))
    renderWithStore()

    await waitFor(() => expect(validateWorld).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Still renders normally — no thrown/uncaught error surfaced to the DOM.
    expect(screen.getByTestId('world-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('world-validation-issues')).not.toBeInTheDocument()
  })
})
