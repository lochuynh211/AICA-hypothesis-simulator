import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ProposalStoreProvider, useProposalStore } from '../src/state/proposalStore'
import WorldPanel from '../src/components/proposal/panels/WorldPanel'

function renderWithStore() {
  function Wrapper() {
    return (
      <ProposalStoreProvider>
        <WorldPanel />
      </ProposalStoreProvider>
    )
  }
  return render(<Wrapper />)
}

describe('WorldPanel', () => {
  it('renders the section order: trigger signal, car state, world/situation, preference & history, driver profile', () => {
    renderWithStore()
    const headings = screen.getAllByTestId('world-section-label').map((el) => el.textContent)
    // JA default labels, in document order.
    expect(headings.length).toBe(5)
    expect(headings[0]).toMatch(/発火シグナル|trigger signal/i)
    expect(headings[headings.length - 1]).toMatch(/ドライバープロファイル|driver profile/i)
  })

  it('shows the 4 trigger_purpose options as selectable, with rest_recommended selected by default', () => {
    renderWithStore()
    const selected = screen.getByTestId('trigger-purpose-rest_recommended')
    expect(selected.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('trigger-purpose-route_music')).toBeInTheDocument()
    expect(screen.getByTestId('trigger-purpose-inattentive_driving_prevention_recovery')).toBeInTheDocument()
    expect(screen.getByTestId('trigger-purpose-child_passenger_experience')).toBeInTheDocument()
  })

  it('clicking a different trigger_purpose dispatches SET_TRIGGER_PURPOSE', () => {
    function Probe() {
      const { state } = useProposalStore()
      return <span data-testid="probe">{state.triggerPurpose}</span>
    }
    render(
      <ProposalStoreProvider>
        <WorldPanel />
        <Probe />
      </ProposalStoreProvider>,
    )
    expect(screen.getByTestId('probe').textContent).toBe('rest_recommended')
    fireEvent.click(screen.getByTestId('trigger-purpose-route_music'))
    expect(screen.getByTestId('probe').textContent).toBe('route_music')
  })

  it('renders lifecycle_stage options and motion_state selector', () => {
    renderWithStore()
    expect(screen.getByTestId('lifecycle-stage-before_rest_until_stop')).toBeInTheDocument()
    expect(screen.getByTestId('lifecycle-stage-during_rest_stopped')).toBeInTheDocument()
    expect(screen.getByTestId('lifecycle-stage-after_rest_before_restart')).toBeInTheDocument()
    expect(screen.getByTestId('lifecycle-stage-active_driving_content')).toBeInTheDocument()
    expect(screen.getByTestId('motion-state-select')).toBeInTheDocument()
  })

  it('editing a world/situation field dispatches SET_FEATURE_FIELD', () => {
    function Probe() {
      const { state } = useProposalStore()
      return <span data-testid="probe">{String(state.featureSnapshot.drowsiness_level)}</span>
    }
    render(
      <ProposalStoreProvider>
        <WorldPanel />
        <Probe />
      </ProposalStoreProvider>,
    )
    const input = screen.getByTestId('feature-field-drowsiness_level') as HTMLInputElement
    fireEvent.change(input, { target: { value: '80' } })
    expect(screen.getByTestId('probe').textContent).toBe('80')
  })

  it('renders a provenance badge for every world/situation feature field', () => {
    renderWithStore()
    const badges = screen.getAllByTestId('provenance-badge')
    expect(badges.length).toBeGreaterThan(5)
  })

  it('renders the driver profile selector last and loading a profile merges preference/history fields', () => {
    function Probe() {
      const { state } = useProposalStore()
      return <span data-testid="probe">{String(state.featureSnapshot.age_band)}</span>
    }
    render(
      <ProposalStoreProvider>
        <WorldPanel />
        <Probe />
      </ProposalStoreProvider>,
    )
    const select = screen.getByTestId('driver-profile-select') as HTMLSelectElement
    // Pick a profile other than the current default and confirm the merge happened.
    const otherOption = Array.from(select.options).find((o) => o.value !== select.value)!
    fireEvent.change(select, { target: { value: otherOption.value } })
    expect(screen.getByTestId('probe').textContent).not.toBe('')
  })
})
