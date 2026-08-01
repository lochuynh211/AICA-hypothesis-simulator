/**
 * useCatalogLoader — the catalog-loading effect extracted out of `WorldPanel`
 * (S5b) so it travels with any component that needs `state.catalog`
 * populated, not just `WorldPanel` itself.
 *
 * `WorldPanel`'s OWN catalog-loading behaviour is already covered by the
 * existing (untouched, sibling-owned) `tests/proposal_world_panel*.test.tsx`
 * files — this file instead pins the extracted hook's own contract directly,
 * since that is the shared unit both `WorldPanel` and `MergedSetupPanel` now
 * depend on: given a dataset id, it (a) dispatches `SET_CATALOG` into
 * whichever `proposalStore` is nearest in the tree and (b) returns that
 * dataset's provenance.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/api/proposalClient', async (orig) => ({
  ...(await orig<typeof import('../src/api/proposalClient')>()),
  getCatalog: vi.fn(),
}))

import { getCatalog } from '../src/api/proposalClient'
import { ProposalStoreProvider, useProposalStore } from '../src/state/proposalStore'
import { LanguageProvider } from '../src/state/language'
import { useCatalogLoader } from '../src/components/proposal/useCatalogLoader'

const SONGS = [
  { spotify_track: { id: 'track-1', name: 'Song One', artists: [{ id: 'artist-1', name: 'Artist One' }] } },
]

const PROVENANCE = {
  dataset_id: 'ds-loader-test',
  dataset_version: {
    schema_version: '1.0.0',
    spotify_track_reference_version: '1.0.0',
    spotify_audio_features_reference_version: '1.0.0',
  },
  dataset_hash: 'sha256:test',
  tier: 'demo',
  provenance_note: 'test fixture',
}

function Harness({ datasetId }: { datasetId: string | null }) {
  const { state } = useProposalStore()
  const provenance = useCatalogLoader(datasetId)
  return (
    <>
      <span data-testid="loader-catalog-length">{state.catalog.length}</span>
      <span data-testid="loader-provenance">{provenance?.dataset_id ?? 'none'}</span>
    </>
  )
}

function mount(datasetId: string | null) {
  return render(
    <LanguageProvider>
      <ProposalStoreProvider>
        <Harness datasetId={datasetId} />
      </ProposalStoreProvider>
    </LanguageProvider>,
  )
}

describe('useCatalogLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('dispatches SET_CATALOG into the nearest proposalStore and returns the provenance', async () => {
    vi.mocked(getCatalog).mockResolvedValue({ provenance: PROVENANCE, total: SONGS.length, songs: SONGS })

    mount('ds-loader-test')

    expect(getCatalog).toHaveBeenCalledWith('ds-loader-test')
    await waitFor(() =>
      expect(screen.getByTestId('loader-catalog-length')).toHaveTextContent(String(SONGS.length)),
    )
    expect(screen.getByTestId('loader-provenance')).toHaveTextContent('ds-loader-test')
  })

  it('does nothing for a falsy dataset id — no fetch, catalog stays empty', () => {
    mount(null)
    expect(getCatalog).not.toHaveBeenCalled()
    expect(screen.getByTestId('loader-catalog-length')).toHaveTextContent('0')
  })

  it('leaves the provenance null when the fetch fails, without throwing', async () => {
    vi.mocked(getCatalog).mockRejectedValue(new Error('network down'))

    mount('ds-loader-test')

    await waitFor(() => expect(getCatalog).toHaveBeenCalled())
    // Best-effort — a failed fetch must not crash the hook or leave a stale
    // provenance from a previous dataset lying around.
    await waitFor(() => expect(screen.getByTestId('loader-provenance')).toHaveTextContent('none'))
  })
})
