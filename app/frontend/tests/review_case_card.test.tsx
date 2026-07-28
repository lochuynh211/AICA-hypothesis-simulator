// app/frontend/tests/review_case_card.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import ExperienceCasePicker from '../src/components/review/ExperienceCasePicker'
import ExperienceCaseCard from '../src/components/review/ExperienceCaseCard'
import CaseDetailsModal from '../src/components/review/CaseDetailsModal'
import { getCase, listCases } from '../src/lib/review/caseCatalog'
import { LanguageProvider } from '../src/state/language'

const c03 = getCase('case-c03-monotonous-highway')!
const wrap = (ui: React.ReactNode) => render(<LanguageProvider>{ui}</LanguageProvider>)

describe('ExperienceCasePicker', () => {
  it('lists every committed case', () => {
    wrap(<ExperienceCasePicker selectedCaseId={null} flagCounts={{}} onSelect={() => {}} />)
    const select = screen.getByTestId('experience-case-select') as HTMLSelectElement
    expect(select.options.length).toBe(listCases().length)
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
    wrap(<ExperienceCaseCard testCase={c03} onOpenDetails={() => {}} />)
    expect(screen.getByTestId('case-brief')).toHaveTextContent(c03.brief.ja)
    expect(screen.getAllByTestId('case-watch-chip')).toHaveLength(c03.what_to_watch.length)
  })

  it('shows a one-line persona summary', () => {
    wrap(<ExperienceCaseCard testCase={c03} onOpenDetails={() => {}} />)
    expect(screen.getByTestId('case-persona-line')).toHaveTextContent(c03.persona.name.ja)
  })

  it('omits everything the customer does not read', () => {
    // 07-27 §6.1: no expected outcome, no expected causal path, no journey
    // narrative, no event list, no automatic path, no artifact references.
    wrap(<ExperienceCaseCard testCase={c03} onOpenDetails={() => {}} />)
    const text = screen.getByTestId('experience-case-card').textContent ?? ''
    expect(text).not.toContain(c03.journey.narrative.ja)
    expect(text).not.toContain(c03.journey.scenario_ref)
    expect(text).not.toContain(c03.journey.route_preset_ref)
    expect(text).not.toContain(c03.algorithm_defaults.trigger)
  })

  it('opens the details popup', () => {
    const onOpenDetails = vi.fn()
    wrap(<ExperienceCaseCard testCase={c03} onOpenDetails={onOpenDetails} />)
    fireEvent.click(screen.getByTestId('case-details-button'))
    expect(onOpenDetails).toHaveBeenCalled()
  })
})

describe('CaseDetailsModal', () => {
  it('renders nothing when closed', () => {
    wrap(<CaseDetailsModal open={false} testCase={c03} onClose={() => {}} />)
    expect(screen.queryByTestId('case-details-modal')).toBeNull()
  })

  it('shows the persona narrative and the conditions the case fixes', () => {
    wrap(<CaseDetailsModal open testCase={c03} onClose={() => {}} />)
    expect(screen.getByTestId('case-details-modal')).toHaveTextContent(c03.persona.narrative.ja)
    expect(screen.getByTestId('case-fixed-conditions')).toBeTruthy()
  })

  it('survives a case with no goals or constraints', () => {
    const bare = { ...c03, persona: { ...c03.persona, goals: undefined, constraints: undefined } }
    wrap(<CaseDetailsModal open testCase={bare} onClose={() => {}} />)
    expect(screen.getByTestId('case-details-modal')).toBeTruthy()
  })

  it('renders nothing when no case is selected', () => {
    wrap(<CaseDetailsModal open testCase={null} onClose={() => {}} />)
    expect(screen.queryByTestId('case-details-modal')).toBeNull()
  })
})
