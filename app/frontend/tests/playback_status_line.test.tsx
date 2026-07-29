/**
 * The read-only status line that replaced the checkpoint rail + decision band.
 * PLAYBACK ONLY: the car's live status. It renders nothing before playback.
 */
import { render, screen } from '@testing-library/react'
import PlaybackStatusLine from '../src/components/merged/PlaybackStatusLine'
import { LanguageProvider } from '../src/state/language'
import type { MergedTriggerTick } from '../src/api/mergedClient'

const tick = (over: Partial<MergedTriggerTick> = {}): MergedTriggerTick => ({
  decision: null,
  error: null,
  paused: false,
  completed: false,
  tick_index: 3,
  route_fraction: 0.4,
  distance_km: 42.5,
  speed_kph: 88,
  motion_state: 'MOVING',
  recovery_phase: null,
  is_traffic_jam: false,
  segment_type: 'highway',
  ...over,
})

function mount(props: Partial<React.ComponentProps<typeof PlaybackStatusLine>>, lang: 'ja' | 'en' = 'en') {
  return render(
    <LanguageProvider initialLanguage={lang}>
      <PlaybackStatusLine playback={false} latestTrigger={null} {...props} />
    </LanguageProvider>,
  )
}

const text = () => screen.getByTestId('playback-status-text').textContent ?? ''

describe('PlaybackStatusLine', () => {
  it('shows the car status during playback', () => {
    mount({ playback: true, latestTrigger: tick() })
    expect(text()).toContain('driving')
    expect(text()).toContain('88 km/h')
    expect(text()).toContain('42.5 km')
    expect(text()).toContain('highway')
  })

  it('names, in words, the proposal category that fired on this tick', () => {
    mount({
      playback: true,
      latestTrigger: tick({
        // Only the fields the line reads; the rest of DecisionResult is
        // irrelevant here.
        decision: { selected_category: 'rest_required' } as never,
      }),
    })
    // The category reads as the specification's own 提案分類 wording, never
    // as the raw `selected_category` token.
    expect(text()).toContain('Rest recommended to prevent dangerous driving')
    expect(text()).not.toContain('rest_required')
    expect(text()).toContain('fired')
  })

  it('says the car is stopped at the rest spot, and in which phase', () => {
    mount({
      playback: true,
      latestTrigger: tick({ motion_state: 'STOPPED', recovery_phase: 'nap', speed_kph: 0 }),
    })
    expect(text()).toContain('stopped at the rest spot')
    expect(text()).toContain('nap')
    // The speed is noise while stopped — the phase is the headline.
    expect(text()).not.toContain('km/h')
  })

  it('reports traffic jam when the tick is in one', () => {
    mount({ playback: true, latestTrigger: tick({ is_traffic_jam: true }) })
    expect(text()).toContain('traffic jam')
  })

  it('renders NOTHING before playback starts', () => {
    // Removed on owner review: the quickview strip and the map markers already
    // say where the fires are, so a third restatement under the map was noise.
    mount({ playback: false })
    expect(screen.queryByTestId('playback-status-line')).toBeNull()
  })

  it('renders nothing during playback until a tick has been recorded', () => {
    mount({ playback: true, latestTrigger: null })
    expect(screen.queryByTestId('playback-status-line')).toBeNull()
  })

  it('renders Japanese with no English leaking into the sentence', () => {
    mount({ playback: true, latestTrigger: tick({ motion_state: 'STOPPED', recovery_phase: 'nap' }) }, 'ja')
    expect(text()).toContain('休憩場所で停車中')
    expect(text()).toContain('仮眠')
    expect(text()).toContain('高速道路')
  })

  it('still states the fact when a backend token has no translation — without printing the token', () => {
    mount({ playback: true, latestTrigger: tick({ motion_state: 'TAXIING' }) })
    // The fact is still reported; the raw identifier is not.
    expect(text()).toContain('unknown')
    expect(text()).not.toContain('TAXIING')
  })
})
