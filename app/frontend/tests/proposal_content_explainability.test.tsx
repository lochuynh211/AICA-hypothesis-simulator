import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ContentExplainability from '../src/components/proposal/ContentExplainability'
import type { OrderedItem, ItemFeatureContribution } from '../src/api/proposalClient'

function fc(feature_id: string, contribution: number): ItemFeatureContribution {
  return {
    feature_id,
    e_i: 0.5,
    a_i: 0.5,
    alpha: null,
    beta: null,
    exact_match: null,
    response_provenance: null,
    r_i: 0.25,
    base_weight: 0.1,
    purpose_multiplier: 1,
    mask: 1,
    effective_weight: 0.1,
    contribution,
    formula_version: '1.0.0',
  }
}

const ITEM: OrderedItem = {
  position: 1,
  item_id: 'synthetic-track-1',
  item_fit: 0.635,
  trait_values: null,
  rationale: ['理由', 'because'],
  situation_fit: 0.623,
  preference_fit: 0.012,
  history_fit: 0.0,
  strongest_support: { feature_id: 'drowsiness_level', contribution: 0.205 },
  strongest_oppose: null,
  feature_contributions: [
    fc('drowsiness_level', 0.205),
    fc('monotony_level', 0.18),
    fc('fatigue_level', 0.12),
    fc('night_state', 0.06),
    fc('traffic_state', -0.05),
    fc('road_type', 0.03),
    fc('child_present', 0.0),
  ],
}

describe('ContentExplainability', () => {
  it('renders situation/preference/history subtotals and strongest support/oppose, labelled by name not id', () => {
    render(<ContentExplainability item={ITEM} lang="en" />)
    const subtotals = screen.getByTestId('content-subtotals')
    expect(subtotals.textContent).toContain('Situation: 0.623')
    expect(subtotals.textContent).toContain('Preference: 0.012')
    // The `History` judgement axis renders through nodeLabel(), which spells
    // it out as "Past results" (spec Slide 66-70's own wording) rather than
    // the raw JSON key.
    expect(subtotals.textContent).toContain('Past results: 0.000')
    expect(screen.getByTestId('content-strongest-support')).toHaveTextContent('Drowsiness (+0.205)')
    expect(screen.getByTestId('content-strongest-support')).not.toHaveTextContent('drowsiness_level')
    expect(screen.getByTestId('content-strongest-oppose')).toHaveTextContent('None')
  })

  it('feature trace shows top-5 by |contribution|, expandable, with 0-contribution rows blurred', () => {
    render(<ContentExplainability item={ITEM} lang="en" />)
    const table = screen.getByTestId('content-explainability-table')
    // top 5 before expand
    expect(within(table).getAllByTestId(/^content-explain-row-/)).toHaveLength(5)
    // ordered by |contribution| desc → drowsiness_level (0.205) is first
    const firstRow = within(table).getAllByTestId(/^content-explain-row-/)[0]
    expect(firstRow).toHaveAttribute('data-testid', 'content-explain-row-drowsiness_level')
    // expand reveals all 7
    fireEvent.click(within(table).getByTestId('content-trace-show-more'))
    const allRows = within(table).getAllByTestId(/^content-explain-row-/)
    expect(allRows).toHaveLength(7)
    // the 0-contribution row is blurred (still in the DOM)
    const zeroRow = within(table).getByTestId('content-explain-row-child_present')
    expect(zeroRow.getAttribute('style')).toContain('blur')
  })

  it('renders nothing for an item without the §14 roll-up fields (mock/LLM shape)', () => {
    const lean: OrderedItem = { ...ITEM, situation_fit: null, preference_fit: null, history_fit: null, strongest_support: null, strongest_oppose: null }
    const { container } = render(<ContentExplainability item={lean} lang="en" />)
    expect(container.querySelector('[data-testid="content-explainability"]')).toBeNull()
  })
})
