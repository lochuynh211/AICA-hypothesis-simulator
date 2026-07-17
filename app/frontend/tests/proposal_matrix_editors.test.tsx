import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ResponseMatrixTable from '../src/components/proposal/ResponseMatrixTable'
import HierarchyWeightsTable from '../src/components/proposal/HierarchyWeightsTable'

describe('ResponseMatrixTable', () => {
  const profiles = {
    music_playlist: {
      drowsiness_level: { coefficient: 0.8, provenance: 'slide_67', source_reference: 'row A' },
      fatigue_level: { coefficient: 0.4, provenance: 'slide_67' },
    },
    humming_karaoke: {
      drowsiness_level: { coefficient: 0.7, provenance: 'slide_67' },
      fatigue_level: { coefficient: 0.3, provenance: 'slide_67' },
    },
  }

  it('pivots to feature rows × service columns with editable coefficients', () => {
    render(<ResponseMatrixTable value={profiles} onChange={vi.fn()} cornerLabel="feature × service" />)
    // service columns
    expect(screen.getByRole('columnheader', { name: 'music_playlist' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'humming_karaoke' })).toBeInTheDocument()
    // feature rows
    expect(screen.getByRole('rowheader', { name: 'drowsiness_level' })).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: 'fatigue_level' })).toBeInTheDocument()
    // the cell carries the real coefficient
    expect((screen.getByTestId('resp-cell-music_playlist-drowsiness_level') as HTMLInputElement).value).toBe('0.8')
  })

  it('editing a cell updates ONLY that coefficient and preserves provenance/source', () => {
    const onChange = vi.fn()
    render(<ResponseMatrixTable value={profiles} onChange={onChange} />)
    fireEvent.change(screen.getByTestId('resp-cell-music_playlist-drowsiness_level'), { target: { value: '0.9' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0]
    // coefficient changed
    expect(next.music_playlist.drowsiness_level.coefficient).toBe(0.9)
    // provenance + source_reference preserved (real data kept)
    expect(next.music_playlist.drowsiness_level.provenance).toBe('slide_67')
    expect(next.music_playlist.drowsiness_level.source_reference).toBe('row A')
    // other cells untouched
    expect(next.music_playlist.fatigue_level.coefficient).toBe(0.4)
    expect(next.humming_karaoke.drowsiness_level.coefficient).toBe(0.7)
  })
})

describe('HierarchyWeightsTable', () => {
  const hierarchy = {
    Situation: {
      share: 0.8,
      subgroups: {
        driver_state: {
          share: 0.5,
          leaves: { drowsiness_level: { share: 0.55 }, fatigue_level: { share: 0.45 } },
        },
      },
    },
  }

  it('renders all three levels with editable share inputs (nothing read-only)', () => {
    render(<HierarchyWeightsTable value={hierarchy} onChange={vi.fn()} />)
    expect(screen.getByRole('rowheader', { name: 'Situation' })).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: 'driver_state' })).toBeInTheDocument()
    expect(screen.getByText('drowsiness_level')).toBeInTheDocument()
    // every share level is an editable input
    expect((screen.getByTestId('hw-cat-Situation') as HTMLInputElement).value).toBe('0.8')
    expect((screen.getByTestId('hw-sub-driver_state') as HTMLInputElement).value).toBe('0.5')
    expect((screen.getByTestId('hw-leaf-drowsiness_level') as HTMLInputElement).value).toBe('0.55')
  })

  it('editing a leaf share updates only that leaf and preserves the rest', () => {
    const onChange = vi.fn()
    render(<HierarchyWeightsTable value={hierarchy} onChange={onChange} />)
    fireEvent.change(screen.getByTestId('hw-leaf-drowsiness_level'), { target: { value: '0.6' } })
    const next = onChange.mock.calls[0][0]
    expect(next.Situation.subgroups.driver_state.leaves.drowsiness_level.share).toBe(0.6)
    // siblings + parents preserved
    expect(next.Situation.subgroups.driver_state.leaves.fatigue_level.share).toBe(0.45)
    expect(next.Situation.subgroups.driver_state.share).toBe(0.5)
    expect(next.Situation.share).toBe(0.8)
  })
})
