import { render, screen, fireEvent } from '@testing-library/react'
import FallbackRouteMap from '../src/components/map/FallbackRouteMap'
import {
  REST_SPOT_COLOR, TRIGGER_MONOTONY_COLOR, TRIGGER_REST_COLOR,
} from '../src/lib/review/triggerColors'

// Google's own reference polyline: three points, so the path has real shape.
const POLYLINE = '_p~iF~ps|U_ulLnnqC_mqNvxq`@'

function mount(extra: Partial<React.ComponentProps<typeof FallbackRouteMap>> = {}) {
  return render(
    <FallbackRouteMap
      encodedPolyline={POLYLINE}
      startName="Tokyo Station"
      endName="Chichibu Station"
      totalKm={104}
      lang="en"
      {...extra}
    />,
  )
}

describe('FallbackRouteMap', () => {
  it('draws the real route as a path, not a placeholder box', () => {
    mount()
    const svg = screen.getByTestId('fallback-map-svg')
    const paths = svg.querySelectorAll('path')
    expect(paths.length).toBeGreaterThan(0)
    // A real decoded route has several vertices — a stub would have one segment.
    expect(paths[0].getAttribute('d')?.match(/L/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  it('shows the real place names and total distance', () => {
    mount()
    expect(screen.getByTestId('fallback-map-start')).toHaveTextContent('Tokyo Station')
    expect(screen.getByTestId('fallback-map-end')).toHaveTextContent('Chichibu Station')
    expect(screen.getByTestId('fallback-map-distance')).toHaveTextContent('104 km')
  })

  it('says so when there is no route rather than drawing an empty frame', () => {
    mount({ encodedPolyline: null })
    expect(screen.getByTestId('fallback-route-map-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('fallback-map-svg')).not.toBeInTheDocument()
  })

  it('places one marker per trigger and reports the clicked index', () => {
    const onFireClick = vi.fn()
    mount({
      fires: [
        { fraction: 0.25, index: 0, category: 'rest_required', timeMin: 30 },
        { fraction: 0.75, index: 1, category: 'monotony_prevention', timeMin: 90 },
      ],
      onFireClick,
    })

    expect(screen.getByTestId('fallback-map-fire-0')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('fallback-map-fire-1'))
    // The index is the quickview's fire index, so the click drives the same
    // selection the strip does.
    expect(onFireClick).toHaveBeenCalledWith(1)
  })

  it('positions markers by route fraction, so a later trigger sits further along', () => {
    mount({
      fires: [
        { fraction: 0.1, index: 0, category: 'rest_required' },
        { fraction: 0.9, index: 1, category: 'rest_required' },
      ],
    })
    const first = screen.getByTestId('fallback-map-fire-0')
    const second = screen.getByTestId('fallback-map-fire-1')
    // Distinct positions — a stub rendering both at the same spot would fail.
    const pos = (el: Element) => `${el.getAttribute('cx')},${el.getAttribute('cy')}`
    expect(pos(first)).not.toBe(pos(second))
  })

  it('draws the car only once playback has a position', () => {
    mount()
    expect(screen.queryByTestId('fallback-map-car')).not.toBeInTheDocument()

    mount({ carFraction: 0.5 })
    expect(screen.getByTestId('fallback-map-car')).toBeInTheDocument()
  })

  it('renders rest spots', () => {
    mount({ restSpots: [{ fraction: 0.4, label: 'Michi-no-Eki' }] })
    expect(screen.getByTestId('fallback-map-rest-0')).toBeInTheDocument()
  })

  it('renders Japanese when the language is ja', () => {
    // Every other case here runs in English; without this the schematic's own
    // chrome could be English-only and no test would notice.
    render(<FallbackRouteMap encodedPolyline={POLYLINE} totalKm={10} lang="ja" />)
    const svg = screen.getByTestId('fallback-map-svg')
    expect(svg).toBeInTheDocument()
    expect(screen.getByText(/ルート概略図/)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Trigger markers are colored by CATEGORY (owner request), and rest LOCATIONS
// are separated from them by shape rather than by a third warm hue.
// See `src/lib/review/triggerColors` for the measured basis of both choices.
// ---------------------------------------------------------------------------

describe('FallbackRouteMap — trigger marker colors', () => {
  const bothFires = [
    { fraction: 0.25, index: 0, category: 'rest_required', timeMin: 30 },
    { fraction: 0.75, index: 1, category: 'monotony_prevention', timeMin: 90 },
  ]

  it('paints a rest trigger red and a monotony trigger orange', () => {
    mount({ fires: bothFires })
    const rest = screen.getByTestId('fallback-map-fire-dot-0')
    const mono = screen.getByTestId('fallback-map-fire-dot-1')

    expect(rest.getAttribute('fill')).toBe(TRIGGER_REST_COLOR)
    expect(mono.getAttribute('fill')).toBe(TRIGGER_MONOTONY_COLOR)
    // The whole point: the two must not be the same swatch.
    expect(rest.getAttribute('fill')).not.toBe(mono.getAttribute('fill'))
  })

  it('tags each marker with its category so identity is not color-alone', () => {
    mount({ fires: bothFires })
    expect(screen.getByTestId('fallback-map-fire-dot-0')).toHaveAttribute('data-category', 'rest')
    expect(screen.getByTestId('fallback-map-fire-dot-1')).toHaveAttribute('data-category', 'monotony')
  })

  it('treats an unknown/absent category as monotony rather than mislabelling it as rest', () => {
    mount({ fires: [{ fraction: 0.5, index: 0, category: null, timeMin: 10 }] })
    const dot = screen.getByTestId('fallback-map-fire-dot-0')
    expect(dot.getAttribute('fill')).toBe(TRIGGER_MONOTONY_COLOR)
    expect(dot).toHaveAttribute('data-category', 'monotony')
  })

  it('draws rest LOCATIONS as squares, so they never read as an orange trigger', () => {
    mount({
      fires: [{ fraction: 0.75, index: 0, category: 'monotony_prevention', timeMin: 90 }],
      restSpots: [{ fraction: 0.4, label: 'Kanetsu PA' }],
    })
    const spot = screen.getByTestId('fallback-map-rest-0')
    const fire = screen.getByTestId('fallback-map-fire-dot-0')

    expect(spot.tagName.toLowerCase()).toBe('rect')
    expect(fire.tagName.toLowerCase()).toBe('circle')
    expect(spot.getAttribute('fill')).toBe(REST_SPOT_COLOR)
  })
})
