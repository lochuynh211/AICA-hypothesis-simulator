/**
 * feature 019 — ReasonBreakdown AI slot: renders the AI sentence + badge when
 * ready (replacing only the italic line, never the numeric trace), shows the
 * fell-back / error notes with the template otherwise, and fires onExpand.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ReasonBreakdown, { type ReasonRow } from '../src/components/proposal/ReasonBreakdown'

const rows: ReasonRow[] = [{ featureId: 'drowsiness_level', value: 70, r: 0.8, w: 0.3, contribution: 0.24 }]

function baseProps() {
  return {
    rows,
    supportingFeatureIds: ['drowsiness_level'],
    opposingFeatureIds: [],
    rationale: ['テンプレ理由', 'template rationale'],
    lang: 'en' as const,
    defaultOpen: true,
  }
}

describe('ReasonBreakdown AI explanation slot', () => {
  it('renders the AI sentence + "AI · model" badge when ready, keeping the numeric trace', () => {
    render(
      <ReasonBreakdown
        {...baseProps()}
        aiExplanation={{ status: 'ready', text: 'High drowsiness drove this pick.', model: 'qwen2.5:3b', fellBack: false }}
      />,
    )
    expect(screen.getByTestId('ai-rationale')).toHaveTextContent('High drowsiness drove this pick.')
    expect(screen.getByTestId('ai-rationale-badge')).toHaveTextContent('AI · qwen2.5:3b')
    // The AI text replaces the templated sentence, not the score trace:
    expect(screen.queryByText('template rationale')).toBeNull()
    expect(screen.getByRole('cell', { name: 'drowsiness_level' })).toBeInTheDocument()
  })

  it('shows a fell-back note when the AI degraded to the template', () => {
    render(
      <ReasonBreakdown
        {...baseProps()}
        aiExplanation={{ status: 'ready', text: 'template rationale', model: 'template', fellBack: true }}
      />,
    )
    expect(screen.getByTestId('ai-fellback-note')).toBeInTheDocument()
  })

  it('on error shows the deterministic template plus an error note', () => {
    render(<ReasonBreakdown {...baseProps()} aiExplanation={{ status: 'error' }} />)
    expect(screen.getByText('template rationale')).toBeInTheDocument()
    expect(screen.getByTestId('ai-error-note')).toBeInTheDocument()
  })

  it('shows a generating placeholder while loading', () => {
    render(<ReasonBreakdown {...baseProps()} aiExplanation={{ status: 'loading' }} />)
    expect(screen.getByTestId('ai-rationale-loading')).toBeInTheDocument()
  })

  it('with no aiExplanation, renders the plain template (backward compatible)', () => {
    render(<ReasonBreakdown {...baseProps()} />)
    expect(screen.getByText('template rationale')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-rationale-badge')).toBeNull()
  })

  it('fires onExpand when the disclosure starts open (defaultOpen)', () => {
    const onExpand = vi.fn()
    render(<ReasonBreakdown {...baseProps()} onExpand={onExpand} />)
    expect(onExpand).toHaveBeenCalled()
  })

  it('fires onExpand when the user opens a closed disclosure', () => {
    const onExpand = vi.fn()
    render(<ReasonBreakdown {...baseProps()} defaultOpen={false} onExpand={onExpand} />)
    const details = screen.getByTestId('reason-breakdown') as HTMLDetailsElement
    details.open = true
    fireEvent(details, new Event('toggle'))
    expect(onExpand).toHaveBeenCalled()
  })
})
