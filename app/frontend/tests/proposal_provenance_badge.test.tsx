import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ProvenanceBadge from '../src/components/proposal/ProvenanceBadge'

describe('ProvenanceBadge', () => {
  it('renders the CDC-SU baseline badge (JA default)', () => {
    render(<ProvenanceBadge provenance="cdc_su_baseline" lang="ja" />)
    expect(screen.getByTestId('provenance-badge')).toHaveTextContent('CDC-SU')
  })

  it('renders the normalized-concept badge distinctly in JA vs EN', () => {
    const { rerender } = render(<ProvenanceBadge provenance="normalized_cdc_su_concept" lang="ja" />)
    const ja = screen.getByTestId('provenance-badge').textContent
    rerender(<ProvenanceBadge provenance="normalized_cdc_su_concept" lang="en" />)
    const en = screen.getByTestId('provenance-badge').textContent
    expect(ja).toBeTruthy()
    expect(en).toBeTruthy()
    expect(en).toMatch(/norm/i)
  })

  it('renders the proposed_addition badge', () => {
    render(<ProvenanceBadge provenance="proposed_addition" lang="en" />)
    expect(screen.getByTestId('provenance-badge').textContent).toBeTruthy()
  })

  it('renders a distinct "from profile" variant', () => {
    render(<ProvenanceBadge provenance="from_profile" lang="en" />)
    expect(screen.getByTestId('provenance-badge')).toHaveTextContent(/profile/i)
  })

  it('renders a distinct "from profile" variant in JA', () => {
    render(<ProvenanceBadge provenance="from_profile" lang="ja" />)
    expect(screen.getByTestId('provenance-badge').textContent).toBeTruthy()
  })
})
