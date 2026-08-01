/**
 * proposal_oshi_artists_editor (feature 025 slice S4 — customer feedback:
 * "I cannot set up the artist. And it should be able to set up multiple oshi
 * favourite artists, each with a favourite degree (熱狂度) from 0 to 1.0,
 * step 0.1.").
 *
 * `PreferenceHistorySection`'s oshi block used to be a single artist-ID
 * `<select>` bound to `driver_profile.oshi_id`. It is now a repeatable list
 * bound to `driver_profile.oshi_artists` (`{artist_id, oshi_type,
 * enthusiasm}[]`), matching the backend `OshiArtist` model
 * (`app/api/aica_api/models/proposal/world.py`) verbatim — see
 * `worldFields.tsx`'s `oshi_artists` field kind.
 *
 * These tests mount `PreferenceHistorySection` directly (not the full
 * `WorldPanel`, which is a sibling slice's file) — it reads/writes the store
 * on its own and needs no API mocks, since the artist options come from
 * `state.catalog` (seeded here via `SET_CATALOG`, exactly as `WorldPanel`
 * does after a real `getCatalog` call).
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import React from 'react'
import { ProposalStoreProvider, useProposalStore } from '../src/state/proposalStore'
import PreferenceHistorySection from '../src/components/proposal/panels/sections/PreferenceHistorySection'
import type { CatalogSongSummary, OshiArtist } from '../src/api/proposalClient'

const ARTISTS = [
  { id: 'artist-1', name: 'Artist One' },
  { id: 'artist-2', name: 'Artist Two' },
  { id: 'artist-3', name: 'Artist Three' },
]

function catalogSongs(): CatalogSongSummary[] {
  return ARTISTS.map((a, i) => ({
    spotify_track: { id: `track-${i}`, name: `Track ${i}`, artists: [{ id: a.id, name: a.name }] },
  }))
}

/** Seeds `state.catalog` (so the artist <select> options exist) and,
 * optionally, `driver_profile.oshi_artists` — mirrors how a real run would
 * arrive at this screen (catalog loaded by WorldPanel, profile loaded from a
 * seed/preset/save). */
function Setup({ oshiArtists }: { oshiArtists?: OshiArtist[] }) {
  const { dispatch } = useProposalStore()
  React.useEffect(() => {
    const songs = catalogSongs()
    dispatch({ type: 'SET_CATALOG', catalog: songs, total: songs.length })
    if (oshiArtists) {
      dispatch({ type: 'SET_DRIVER_PROFILE_FIELD', key: 'oshi_artists', value: oshiArtists })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch])
  return null
}

/** Reads the store's current `oshi_artists` back out as plain JSON — proves
 * what actually reached the store, not just what a control's DOM attribute
 * claims. */
function Probe() {
  const { state } = useProposalStore()
  return <span data-testid="probe-oshi">{JSON.stringify(state.world.driver_profile.oshi_artists)}</span>
}

function renderEditor(oshiArtists?: OshiArtist[]) {
  return render(
    <ProposalStoreProvider>
      <Setup oshiArtists={oshiArtists} />
      <PreferenceHistorySection />
      <Probe />
    </ProposalStoreProvider>,
  )
}

function readOshiArtists(): OshiArtist[] {
  return JSON.parse(screen.getByTestId('probe-oshi').textContent ?? '[]')
}

describe('PreferenceHistorySection — oshi_artists editor (feature 025 slice S4)', () => {
  it('starts with no rows and an "add artist" button when oshi_artists is empty', () => {
    renderEditor()
    expect(screen.getByTestId('oshi-artist-add')).toBeInTheDocument()
    expect(screen.queryByTestId('oshi-artist-row-0')).not.toBeInTheDocument()
    expect(readOshiArtists()).toEqual([])
  })

  it('clicking "add artist" appends a row defaulting to 熱狂度 1.0', () => {
    renderEditor()
    fireEvent.click(screen.getByTestId('oshi-artist-add'))

    expect(screen.getByTestId('oshi-artist-row-0')).toBeInTheDocument()
    expect(readOshiArtists()).toEqual([{ artist_id: '', oshi_type: 'artist', enthusiasm: 1.0 }])
  })

  it('adding two artists and setting 0.7 / 0.3 produces exactly that array in the store', () => {
    renderEditor()
    fireEvent.click(screen.getByTestId('oshi-artist-add'))
    // Slice S9: the "add artist" button is disabled while any row is still
    // unassigned (artist_id: ''), so row 0 must be assigned an artist before
    // a second row can be added — this is what stops two blank rows from
    // both carrying artist_id: '' and colliding on the backend's
    // no-duplicate-artist_id rule.
    fireEvent.change(screen.getByTestId('oshi-artist-select-0'), { target: { value: 'artist-1' } })
    fireEvent.click(screen.getByTestId('oshi-artist-add'))

    fireEvent.change(screen.getByTestId('oshi-artist-select-1'), { target: { value: 'artist-2' } })
    fireEvent.change(screen.getByTestId('oshi-artist-enthusiasm-0'), { target: { value: '0.7' } })
    fireEvent.change(screen.getByTestId('oshi-artist-enthusiasm-1'), { target: { value: '0.3' } })

    expect(readOshiArtists()).toEqual([
      { artist_id: 'artist-1', oshi_type: 'artist', enthusiasm: 0.7 },
      { artist_id: 'artist-2', oshi_type: 'artist', enthusiasm: 0.3 },
    ])
  })

  it('clicking "add artist" a second time while the current row is still unassigned does not create a second blank row (bug: two blank rows both carry artist_id "", which the backend rejects as a duplicate oshi_artists id)', () => {
    renderEditor()
    fireEvent.click(screen.getByTestId('oshi-artist-add'))
    fireEvent.click(screen.getByTestId('oshi-artist-add'))

    expect(screen.getByTestId('oshi-artist-row-0')).toBeInTheDocument()
    expect(screen.queryByTestId('oshi-artist-row-1')).not.toBeInTheDocument()
    expect(readOshiArtists()).toEqual([{ artist_id: '', oshi_type: 'artist', enthusiasm: 1.0 }])
  })

  it('the "add artist" button is disabled while a row is unassigned, and explains why via its title', () => {
    renderEditor()
    const addButton = screen.getByTestId('oshi-artist-add') as HTMLButtonElement
    expect(addButton.disabled).toBe(false)

    fireEvent.click(addButton)
    expect(addButton.disabled).toBe(true)
    expect(addButton.title).toBeTruthy()

    fireEvent.change(screen.getByTestId('oshi-artist-select-0'), { target: { value: 'artist-1' } })
    expect(addButton.disabled).toBe(false)
  })

  it('the enthusiasm control cannot produce an off-grid value — off-grid raw input is rounded to the nearest 0.1 before it reaches the store', () => {
    renderEditor()
    fireEvent.click(screen.getByTestId('oshi-artist-add'))
    fireEvent.change(screen.getByTestId('oshi-artist-select-0'), { target: { value: 'artist-1' } })

    // A raw event value between grid steps (bypassing the <input step>
    // attribute, as a real browser's own slider UI never would) must still
    // round to the nearest tenth, not pass through untouched.
    fireEvent.change(screen.getByTestId('oshi-artist-enthusiasm-0'), { target: { value: '0.53' } })
    expect(readOshiArtists()[0].enthusiasm).toBe(0.5)

    // Out-of-range values clamp into [0, 1] first, then land on the grid.
    fireEvent.change(screen.getByTestId('oshi-artist-enthusiasm-0'), { target: { value: '1.4' } })
    expect(readOshiArtists()[0].enthusiasm).toBe(1.0)

    fireEvent.change(screen.getByTestId('oshi-artist-enthusiasm-0'), { target: { value: '-0.2' } })
    expect(readOshiArtists()[0].enthusiasm).toBe(0.0)
  })

  it('an artist already chosen in one row is not offered as an option in another row', () => {
    renderEditor()
    fireEvent.click(screen.getByTestId('oshi-artist-add'))
    // Slice S9: row 0 must be assigned before the add button unblocks.
    fireEvent.change(screen.getByTestId('oshi-artist-select-0'), { target: { value: 'artist-1' } })
    fireEvent.click(screen.getByTestId('oshi-artist-add'))

    const row1Select = screen.getByTestId('oshi-artist-select-1') as HTMLSelectElement
    const row1OptionValues = Array.from(row1Select.options).map((o) => o.value)
    expect(row1OptionValues).not.toContain('artist-1')
    expect(row1OptionValues).toContain('artist-2')
    expect(row1OptionValues).toContain('artist-3')

    // Row 0's own select still offers its OWN currently-selected artist (it
    // must not vanish from its own dropdown just because it is "claimed").
    const row0Select = screen.getByTestId('oshi-artist-select-0') as HTMLSelectElement
    expect(Array.from(row0Select.options).map((o) => o.value)).toContain('artist-1')
  })

  it("removing a row removes exactly that row and leaves the others' enthusiasm intact", () => {
    renderEditor([
      { artist_id: 'artist-1', oshi_type: 'artist', enthusiasm: 0.2 },
      { artist_id: 'artist-2', oshi_type: 'artist', enthusiasm: 0.5 },
      { artist_id: 'artist-3', oshi_type: 'artist', enthusiasm: 0.9 },
    ])
    expect(screen.getByTestId('oshi-artist-row-2')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('oshi-artist-remove-1'))

    expect(readOshiArtists()).toEqual([
      { artist_id: 'artist-1', oshi_type: 'artist', enthusiasm: 0.2 },
      { artist_id: 'artist-3', oshi_type: 'artist', enthusiasm: 0.9 },
    ])
    expect(screen.queryByTestId('oshi-artist-row-2')).not.toBeInTheDocument()
  })

  it('a profile loaded with 3 artists renders 3 rows with the right values', () => {
    renderEditor([
      { artist_id: 'artist-1', oshi_type: 'artist', enthusiasm: 0.1 },
      { artist_id: 'artist-2', oshi_type: 'artist', enthusiasm: 0.6 },
      { artist_id: 'artist-3', oshi_type: 'artist', enthusiasm: 1.0 },
    ])

    expect((screen.getByTestId('oshi-artist-select-0') as HTMLSelectElement).value).toBe('artist-1')
    expect((screen.getByTestId('oshi-artist-select-1') as HTMLSelectElement).value).toBe('artist-2')
    expect((screen.getByTestId('oshi-artist-select-2') as HTMLSelectElement).value).toBe('artist-3')
    expect(Number((screen.getByTestId('oshi-artist-enthusiasm-0') as HTMLInputElement).value)).toBe(0.1)
    expect(Number((screen.getByTestId('oshi-artist-enthusiasm-1') as HTMLInputElement).value)).toBe(0.6)
    expect(Number((screen.getByTestId('oshi-artist-enthusiasm-2') as HTMLInputElement).value)).toBe(1)
  })
})
