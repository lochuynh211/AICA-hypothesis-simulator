import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ReasonBreakdown, { type ReasonRow } from '../src/components/proposal/ReasonBreakdown'

const rows: ReasonRow[] = [
  { featureId: 'monotony_level', value: 70, r: 0.7, w: 0.3, contribution: 0.21 },
  { featureId: 'drowsiness_level', value: 62, r: 0.8, w: 0.22, contribution: 0.176 },
]

describe('ReasonBreakdown', () => {
  it('renders a feature -> value -> r(a) -> w -> contribution row per feature', () => {
    render(
      <ReasonBreakdown
        rows={rows}
        supportingFeatureIds={['monotony_level']}
        opposingFeatureIds={[]}
        rationale={['日本語の理由', 'English rationale']}
        lang="en"
      />,
    )
    expect(screen.getByRole('cell', { name: 'monotony_level' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'drowsiness_level' })).toBeInTheDocument()
    expect(screen.getByText('0.21')).toBeInTheDocument()
    expect(screen.getByText('0.176')).toBeInTheDocument()
  })

  it('resolves the positional bilingual rationale by language', () => {
    const { rerender } = render(
      <ReasonBreakdown rows={rows} supportingFeatureIds={[]} opposingFeatureIds={[]} rationale={['JAテキスト', 'EN text']} lang="ja" />,
    )
    expect(screen.getByText('JAテキスト')).toBeInTheDocument()

    rerender(
      <ReasonBreakdown rows={rows} supportingFeatureIds={[]} opposingFeatureIds={[]} rationale={['JAテキスト', 'EN text']} lang="en" />,
    )
    expect(screen.getByText('EN text')).toBeInTheDocument()
  })

  it('renders supporting and opposing feature chips', () => {
    render(
      <ReasonBreakdown
        rows={rows}
        supportingFeatureIds={['monotony_level', 'drowsiness_level']}
        opposingFeatureIds={['night_state']}
        rationale={['a', 'b']}
        lang="en"
      />,
    )
    expect(screen.getByTestId('reason-supporting')).toHaveTextContent('monotony_level')
    expect(screen.getByTestId('reason-supporting')).toHaveTextContent('drowsiness_level')
    expect(screen.getByTestId('reason-opposing')).toHaveTextContent('night_state')
  })

  it('is collapsible (details/summary) and starts closed by default', () => {
    render(
      <ReasonBreakdown rows={rows} supportingFeatureIds={[]} opposingFeatureIds={[]} rationale={['a', 'b']} lang="en" />,
    )
    const details = screen.getByTestId('reason-breakdown') as HTMLDetailsElement
    expect(details.tagName.toLowerCase()).toBe('details')
    expect(details.open).toBe(false)
    fireEvent.click(screen.getByTestId('reason-summary'))
    expect(details.open).toBe(true)
  })

  it('respects an explicit defaultOpen', () => {
    render(
      <ReasonBreakdown
        rows={rows}
        supportingFeatureIds={[]}
        opposingFeatureIds={[]}
        rationale={['a', 'b']}
        lang="en"
        defaultOpen
      />,
    )
    const details = screen.getByTestId('reason-breakdown') as HTMLDetailsElement
    expect(details.open).toBe(true)
  })
})
