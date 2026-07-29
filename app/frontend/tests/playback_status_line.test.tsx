/**
 * The read-only status line that replaced the checkpoint rail + decision band.
 *
 * Two modes: the car's live status during playback, the first PROJECTED
 * trigger before it.
 */
import { render, screen } from '@testing-library/react'
import PlaybackStatusLine from '../src/components/merged/PlaybackStatusLine'
import { LanguageProvider } from '../src/state/language'
import type { MergedTriggerTick } from '../src/api/mergedClient'
import type { FirePoint } from '../src/api/types'

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

const fire = (over: Partial<FirePoint> = {}): FirePoint => ({
  category: 'rest_required',
  strength: 'strong',
  tick: 12,
  time_min: 47.4,
  ...over,
})

function mount(props: Partial<React.ComponentProps<typeof PlaybackStatusLine>>, lang: 'ja' | 'en' = 'en') {
  return render(
    <LanguageProvider initialLanguage={lang}>
      <PlaybackStatusLine
        playback={false}
        latestTrigger={null}
        firstFire={null}
        hasProjection={false}
        {...props}
      />
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

  it('names the trigger that fired on this tick', () => {
    mount({
      playback: true,
      latestTrigger: tick({
        // Only the fields the line reads; the rest of DecisionResult is
        // irrelevant here.
        decision: { selected_category: 'rest_required' } as never,
      }),
    })
    expect(text()).toContain('rest_required')
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

  it('shows the FIRST projected trigger before playback starts', () => {
    mount({ playback: false, hasProjection: true, firstFire: fire() })
    expect(text()).toContain('rest_required')
    expect(text()).toContain('strong')
    expect(text()).toContain('47 min')
  })

  it('distinguishes "no trigger fired" from "nothing has run yet"', () => {
    // A quickview that produced no fire is a RESULT and must read as one.
    mount({ playback: false, hasProjection: true, firstFire: null })
    expect(text()).toContain('No trigger fired')

    screen.getByTestId('playback-status-text') // sanity: single line
  })

  it('says so when nothing has run at all', () => {
    mount({})
    expect(text()).toContain('Run or preview')
  })

  it('renders Japanese with no English leaking into the sentence', () => {
    mount({ playback: true, latestTrigger: tick({ motion_state: 'STOPPED', recovery_phase: 'nap' }) }, 'ja')
    expect(text()).toContain('休憩地点で停車中')
    expect(text()).toContain('仮眠')
    expect(text()).toContain('高速道路')
  })

  it('shows an untranslated backend token rather than dropping the fact', () => {
    mount({ playback: true, latestTrigger: tick({ motion_state: 'TAXIING' }) })
    expect(text()).toContain('TAXIING')
  })
})
