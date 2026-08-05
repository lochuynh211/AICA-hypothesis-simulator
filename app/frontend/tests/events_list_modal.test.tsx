/**
 * events_list_modal.test.tsx — the quickview-only full event list popup.
 * Verifies proposal-category vocabulary (owner requirement), arrive-in display,
 * and that NO reached-marker leaks in (pure projection, no animation).
 */
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { LanguageProvider } from '../src/state/language'
import EventsListModal from '../src/components/merged/EventsListModal'
import type { MergedTimingEvent } from '../src/lib/merged/eventTimeline'

const EVENTS: MergedTimingEvent[] = [
  { kind: 'monotony_trigger', whenMin: 40, arriveInMin: 260, reachTick: 20 },
  { kind: 'rest_begin', whenMin: 120, arriveInMin: null, reachTick: 45 },
  { kind: 'rest_restart', whenMin: 150, arriveInMin: 180, reachTick: 55 },
  { kind: 'safety_trigger', whenMin: 240, arriveInMin: 60, reachTick: 80 },
]

function renderModal(lang: 'ja' | 'en') {
  render(
    <LanguageProvider initialLanguage={lang}>
      <EventsListModal open events={EVENTS} onClose={() => {}} />
    </LanguageProvider>,
  )
}

describe('EventsListModal', () => {
  it('renders every event with the specification 提案分類 vocabulary (JA)', () => {
    renderModal('ja')
    expect(screen.getByTestId('events-list-modal')).toBeInTheDocument()
    expect(screen.getByTestId('events-list-row-0').textContent).toContain('漫然運転予防のためサービス提案')
    expect(screen.getByTestId('events-list-row-3').textContent).toContain('危険運転防止のため休憩推奨')
    // rest boundaries use the screen-coherent begin/restart wording
    expect(screen.getByTestId('events-list-row-1').textContent).toContain('休憩開始')
    expect(screen.getByTestId('events-list-row-2').textContent).toContain('休憩から再開')
    // The owner-rejected invented category words must never appear.
    const modalTextJa = screen.getByTestId('events-list-modal').textContent
    expect(modalTextJa).not.toContain('モノトニートリガー')
    expect(modalTextJa).not.toContain('安全トリガー')
  })

  it('shows arrive-in where known and is a pure projection (no reached-marker)', () => {
    renderModal('en')
    // monotony @40m: arrive-in 260 = 4h 20m
    expect(screen.getByTestId('events-list-row-0').textContent).toContain('4h 20m')
    // rest_begin has no arrive-in
    expect(screen.getByTestId('events-list-row-1').textContent).not.toContain('arrive in')
    // No animation/reached marker anywhere in the popup
    const modalTextEn = screen.getByTestId('events-list-modal').textContent
    expect(modalTextEn).not.toContain('✓')
    // The owner-rejected invented category words must never appear.
    expect(modalTextEn).not.toContain('Monotony trigger')
    expect(modalTextEn).not.toContain('Safety trigger')
  })

  it('renders nothing when closed', () => {
    render(
      <LanguageProvider initialLanguage="en">
        <EventsListModal open={false} events={EVENTS} onClose={() => {}} />
      </LanguageProvider>,
    )
    expect(screen.queryByTestId('events-list-modal')).toBeNull()
  })
})
