import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import HyperparamMatrix from '../src/components/proposal/HyperparamMatrix'
import type { HyperparameterDef } from '../src/api/proposalClient'

describe('HyperparamMatrix', () => {
  it('renders a numeric hyperparameter as a single number input', () => {
    const def: HyperparameterDef = {
      key: 'plan_item_count',
      kind: 'numeric',
      label: { ja: 'プラン曲数', en: 'Plan Item Count' },
      default: 5,
      min: 1,
      max: 20,
      step: 1,
    }
    const onChange = vi.fn()
    render(<HyperparamMatrix def={def} value={undefined} onChange={onChange} lang="en" />)

    const input = screen.getByLabelText('Plan Item Count') as HTMLInputElement
    expect(input.type).toBe('number')
    expect(input.value).toBe('5')

    fireEvent.change(input, { target: { value: '7' } })
    expect(onChange).toHaveBeenCalledWith(7)
  })

  it('renders an enum hyperparameter as a select of its values', () => {
    const def: HyperparameterDef = {
      key: 'directional_hypothesis',
      kind: 'enum',
      label: { ja: '方向性仮説', en: 'Directional Hypothesis' },
      default: 'soothe_destress',
      values: ['soothe_destress', 'keep_alert'],
    }
    const onChange = vi.fn()
    render(<HyperparamMatrix def={def} value={undefined} onChange={onChange} lang="en" />)

    const select = screen.getByLabelText('Directional Hypothesis') as HTMLSelectElement
    expect(select.value).toBe('soothe_destress')
    fireEvent.change(select, { target: { value: 'keep_alert' } })
    expect(onChange).toHaveBeenCalledWith('keep_alert')
  })

  it('renders a boolean-valued enum hyperparameter (P5 confidence_shrinkage_v1) and round-trips real booleans, not strings', () => {
    const def: HyperparameterDef = {
      key: 'confidence_shrinkage_v1',
      kind: 'enum',
      label: { ja: '信頼度縮小（拡張・既定オフ）', en: 'Confidence Shrinkage (extension, default off)' },
      default: false,
      values: [false, true],
    }
    const onChange = vi.fn()
    render(<HyperparamMatrix def={def} value={undefined} onChange={onChange} lang="en" />)

    const select = screen.getByLabelText('Confidence Shrinkage (extension, default off)') as HTMLSelectElement
    expect(select.value).toBe('false')

    fireEvent.change(select, { target: { value: 'true' } })
    expect(onChange).toHaveBeenCalledWith(true)
    expect(onChange).not.toHaveBeenCalledWith('true')

    fireEvent.change(select, { target: { value: 'false' } })
    expect(onChange).toHaveBeenCalledWith(false)
    expect(onChange).not.toHaveBeenCalledWith('false')
  })

  it('renders a string hyperparameter as a text input', () => {
    const def: HyperparameterDef = {
      key: 'formula_version',
      kind: 'string',
      label: { ja: '計算式版', en: 'Formula Version' },
      default: '1.0.0',
    }
    const onChange = vi.fn()
    render(<HyperparamMatrix def={def} value={undefined} onChange={onChange} lang="en" />)
    const input = screen.getByLabelText('Formula Version') as HTMLInputElement
    expect(input.type).toBe('text')
    expect(input.value).toBe('1.0.0')
    fireEvent.change(input, { target: { value: '1.1.0' } })
    expect(onChange).toHaveBeenCalledWith('1.1.0')
  })

  it('renders a flat table hyperparameter (1-level object) as one row of inputs', () => {
    const def: HyperparameterDef = {
      key: 'category_weights',
      kind: 'table',
      label: { ja: 'カテゴリ重み', en: 'Category Weights' },
      default: { Situation: 0.55, Preference: 0.3, History: 0.15 },
    }
    const onChange = vi.fn()
    render(<HyperparamMatrix def={def} value={undefined} onChange={onChange} lang="en" />)

    expect(screen.getByText('Situation')).toBeInTheDocument()
    const situationInput = screen.getByDisplayValue('0.55') as HTMLInputElement
    fireEvent.change(situationInput, { target: { value: '0.6' } })

    expect(onChange).toHaveBeenCalledWith({ Situation: 0.6, Preference: 0.3, History: 0.15 })
  })

  it('renders a nested matrix hyperparameter (2+ level object) and edits a leaf', () => {
    const def: HyperparameterDef = {
      key: 'purpose_multipliers',
      kind: 'table',
      label: { ja: '目的別乗数', en: 'Purpose Multipliers' },
      default: {
        driver_state: { rest_recommended: 1.4, route_music: 1.2 },
        driving_environment: { rest_recommended: 1.1, route_music: 1.0 },
      },
    }
    const onChange = vi.fn()
    render(<HyperparamMatrix def={def} value={undefined} onChange={onChange} lang="en" />)

    const input = screen.getByDisplayValue('1.4') as HTMLInputElement
    fireEvent.change(input, { target: { value: '1.5' } })

    expect(onChange).toHaveBeenCalledWith({
      driver_state: { rest_recommended: 1.5, route_music: 1.2 },
      driving_environment: { rest_recommended: 1.1, route_music: 1.0 },
    })
  })

  it('renders a uniform 2-D matrix (subgroup × purpose) as a single pivot table with row labels and column headers', () => {
    const def: HyperparameterDef = {
      key: 'purpose_multipliers',
      kind: 'table',
      label: { ja: '目的別乗数', en: 'Purpose Multipliers' },
      default: {
        driver_state: { rest_recommended: 1.4, route_music: 1.2 },
        driving_environment: { rest_recommended: 1.1, route_music: 1.0 },
      },
    }
    render(<HyperparamMatrix def={def} value={undefined} onChange={vi.fn()} lang="en" />)

    // Exactly one table (a single pivot), not one per subgroup.
    expect(screen.getAllByRole('table')).toHaveLength(1)
    // Column headers = inner keys; row headers = outer keys.
    expect(screen.getByRole('columnheader', { name: 'rest_recommended' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'route_music' })).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: 'driver_state' })).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: 'driving_environment' })).toBeInTheDocument()
    // Every cell value is present and editable (numbers stringify: 1.0 → "1").
    expect(screen.getByDisplayValue('1.4')).toBeInTheDocument()
    expect(screen.getByDisplayValue('1.1')).toBeInTheDocument()
  })

  it('renders a RAGGED matrix (trait × audio, differing columns per row) as one union-column pivot', () => {
    const def: HyperparameterDef = {
      key: 'trait_composition_matrix',
      kind: 'matrix',
      label: { ja: '曲トレイト構成', en: 'Trait Composition Matrix' },
      default: {
        arousal: { energy: 0.3, tempo: 0.25 },
        valence: { valence: 0.65, mode: 0.35 },
      },
    }
    render(<HyperparamMatrix def={def} value={undefined} onChange={vi.fn()} lang="en" />)
    // one pivot table, columns = union of inner keys
    expect(screen.getAllByRole('table')).toHaveLength(1)
    for (const col of ['energy', 'tempo', 'valence', 'mode']) {
      expect(screen.getByRole('columnheader', { name: col })).toBeInTheDocument()
    }
    // row headers = outer keys
    expect(screen.getByRole('rowheader', { name: 'arousal' })).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: 'valence' })).toBeInTheDocument()
    // present cells are editable; missing cells render a muted dot
    expect(screen.getByDisplayValue('0.3')).toBeInTheDocument()
    expect(screen.getByDisplayValue('0.65')).toBeInTheDocument()
    expect(screen.getAllByText('·').length).toBeGreaterThan(0)
  })

  it('renders deeply-nested data (hierarchy_weights shape) faithfully to its real depth', () => {
    const def: HyperparameterDef = {
      key: 'hierarchy_weights',
      kind: 'table',
      label: { ja: '階層重み', en: 'Hierarchy Weights' },
      default: {
        Situation: { share: 0.8, subgroups: { driver_state: { share: 0.5 } } },
      },
    }
    render(<HyperparamMatrix def={def} value={undefined} onChange={vi.fn()} lang="en" />)

    // Depth is preserved (not flattened): the outer group, the nested subgroup,
    // and the leaf share value all render.
    expect(screen.getByText('Situation')).toBeInTheDocument()
    expect(screen.getByText('driver_state')).toBeInTheDocument()
    expect(screen.getByDisplayValue('0.5')).toBeInTheDocument()
  })

  it('uses the provided override value instead of the manifest default when given', () => {
    const def: HyperparameterDef = {
      key: 'plan_item_count',
      kind: 'numeric',
      label: { ja: 'プラン曲数', en: 'Plan Item Count' },
      default: 5,
    }
    render(<HyperparamMatrix def={def} value={9} onChange={vi.fn()} lang="en" />)
    expect((screen.getByLabelText('Plan Item Count') as HTMLInputElement).value).toBe('9')
  })
})
