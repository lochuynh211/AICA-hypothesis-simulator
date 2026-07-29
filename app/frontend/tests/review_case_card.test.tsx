// app/frontend/tests/review_case_card.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import ExperienceCasePicker from '../src/components/review/ExperienceCasePicker'
import ExperienceCaseCard from '../src/components/review/ExperienceCaseCard'
import { getCase, listCases } from '../src/lib/review/caseCatalog'
import { LanguageProvider } from '../src/state/language'

const c03 = getCase('case-c03-monotonous-highway')!
const wrap = (ui: React.ReactNode) => render(<LanguageProvider>{ui}</LanguageProvider>)

describe('ExperienceCasePicker', () => {
  it('lists every committed case, and nothing else', () => {
    // No "no test case" entry any more (owner review): a case is always
    // selected, so the empty option it needed is gone too.
    wrap(<ExperienceCasePicker selectedCaseId={null} flagCounts={{}} onSelect={() => {}} />)
    const select = screen.getByTestId('experience-case-select') as HTMLSelectElement
    expect(select.options.length).toBe(listCases().length)
    expect(Array.from(select.options).some((o) => o.value === '')).toBe(false)
  })

  it('reports the chosen case id', () => {
    const onSelect = vi.fn()
    wrap(<ExperienceCasePicker selectedCaseId={null} flagCounts={{}} onSelect={onSelect} />)
    fireEvent.change(screen.getByTestId('experience-case-select'), {
      target: { value: 'case-c03-monotonous-highway' },
    })
    expect(onSelect).toHaveBeenCalledWith('case-c03-monotonous-highway')
  })

  it('shows the flag count for the selected case', () => {
    wrap(
      <ExperienceCasePicker
        selectedCaseId="case-c03-monotonous-highway"
        flagCounts={{ 'case-c03-monotonous-highway': 3 }}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByTestId('case-flag-chip')).toHaveTextContent('3')
  })

  it('shows no chip when nothing is flagged', () => {
    wrap(
      <ExperienceCasePicker
        selectedCaseId="case-c03-monotonous-highway"
        flagCounts={{ 'case-c03-monotonous-highway': 0 }}
        onSelect={() => {}}
      />,
    )
    expect(screen.queryByTestId('case-flag-chip')).toBeNull()
  })
})

describe('ExperienceCaseCard', () => {
  it('shows the brief and the what-to-watch chips', () => {
    wrap(<ExperienceCaseCard testCase={c03} />)
    expect(screen.getByTestId('case-brief')).toHaveTextContent(c03.brief.ja)
    expect(screen.getAllByTestId('case-watch-chip')).toHaveLength(c03.what_to_watch.length)
  })

  it('shows a one-line persona summary', () => {
    wrap(<ExperienceCaseCard testCase={c03} />)
    expect(screen.getByTestId('case-persona-line')).toHaveTextContent(c03.persona.name.ja)
  })

  it('shows the case detail INLINE — persona narrative and pinned conditions', () => {
    // These used to sit behind a "Case details" button in a popup.
    wrap(<ExperienceCaseCard testCase={c03} />)
    expect(screen.getByTestId('case-persona-narrative')).toHaveTextContent(c03.persona.narrative.ja)
    expect(screen.getByTestId('case-fixed-conditions')).toBeTruthy()
    expect(screen.queryByTestId('case-details-button')).toBeNull()
  })

  it('survives a case with no goals or constraints', () => {
    const bare = { ...c03, persona: { ...c03.persona, goals: undefined, constraints: undefined } }
    wrap(<ExperienceCaseCard testCase={bare} />)
    expect(screen.getByTestId('experience-case-card')).toBeTruthy()
    expect(screen.queryByTestId('case-goals')).toBeNull()
  })

  it('omits everything the customer does not read', () => {
    // 07-27 §6.1: no expected outcome, no expected causal path, no event list,
    // no automatic path, no artifact references. The JOURNEY narrative stays
    // out too — the PERSONA narrative above is a different field.
    wrap(<ExperienceCaseCard testCase={c03} />)
    const text = screen.getByTestId('experience-case-card').textContent ?? ''
    expect(text).not.toContain(c03.journey.narrative.ja)
    expect(text).not.toContain(c03.journey.scenario_ref)
    expect(text).not.toContain(c03.journey.route_preset_ref)
    expect(text).not.toContain(c03.algorithm_defaults.trigger)
  })

})
