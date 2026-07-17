import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ResponseMatrixTable from '../src/components/proposal/ResponseMatrixTable'
import HierarchyWeightsTable from '../src/components/proposal/HierarchyWeightsTable'
import ScalarTable from '../src/components/proposal/ScalarTable'
import ContentHierarchyTable from '../src/components/proposal/ContentHierarchyTable'

describe('ContentHierarchyTable', () => {
  const hierarchy = {
    Situation: {
      driver_state: {
        share: 0.35,
        leaves: { drowsiness: { share: 0.55, mask: 1 }, fatigue: { share: 0.45, mask: 1 } },
      },
    },
  }

  it('renders one row per Category·subgroup with an editable share and a leaves text summary', () => {
    render(<ContentHierarchyTable value={hierarchy} onChange={vi.fn()} />)
    expect(screen.getByRole('rowheader', { name: 'Situation·driver_state' })).toBeInTheDocument()
    expect((screen.getByTestId('chw-share-Situation-driver_state') as HTMLInputElement).value).toBe('0.35')
    // leaves rendered as compact "share·mask" text
    expect(screen.getByText('drowsiness 0.55·1 / fatigue 0.45·1')).toBeInTheDocument()
  })

  it('editing a subgroup share updates only that subgroup', () => {
    const onChange = vi.fn()
    render(<ContentHierarchyTable value={hierarchy} onChange={onChange} />)
    fireEvent.change(screen.getByTestId('chw-share-Situation-driver_state'), { target: { value: '0.4' } })
    const next = onChange.mock.calls[0][0]
    expect(next.Situation.driver_state.share).toBe(0.4)
    // leaves preserved
    expect(next.Situation.driver_state.leaves.drowsiness.share).toBe(0.55)
  })
})

describe('ScalarTable', () => {
  const fields = [
    { key: 'gamma_drowsiness', label: { ja: '眠気ガンマ', en: 'Drowsiness Gamma' }, value: 1.0, min: 0.25, max: 4, step: 0.05 },
    { key: 'route_tag_saturation', label: { ja: 'ルートタグ飽和', en: 'Route Tag Saturation' }, value: 3 },
  ]

  it('renders each scalar as a parameter|value table row with an editable number input', () => {
    render(<ScalarTable fields={fields} onChange={vi.fn()} lang="en" />)
    expect(screen.getByRole('rowheader', { name: /Drowsiness Gamma/ })).toBeInTheDocument()
    const input = screen.getByTestId('scalar-gamma_drowsiness') as HTMLInputElement
    expect(input.type).toBe('number')
    expect(input.value).toBe('1')
    // findable by its localized label (accessible)
    expect(screen.getByLabelText('Route Tag Saturation')).toBeInTheDocument()
  })

  it('editing a cell calls onChange(key, numericValue)', () => {
    const onChange = vi.fn()
    render(<ScalarTable fields={fields} onChange={onChange} lang="en" />)
    fireEvent.change(screen.getByTestId('scalar-gamma_drowsiness'), { target: { value: '1.5' } })
    expect(onChange).toHaveBeenCalledWith('gamma_drowsiness', 1.5)
  })
})

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
