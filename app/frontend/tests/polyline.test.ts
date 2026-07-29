import { decodePolyline, projectToUnitBox, cumulativeFractions, pointAtFraction } from '../src/components/map/polyline'

describe('decodePolyline', () => {
  it('decodes the reference example from Google’s own format documentation', () => {
    // The canonical worked example: (38.5,-120.2) (40.7,-120.95) (43.252,-126.453).
    const points = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')
    expect(points).toHaveLength(3)
    expect(points[0].lat).toBeCloseTo(38.5, 5)
    expect(points[0].lng).toBeCloseTo(-120.2, 5)
    expect(points[2].lat).toBeCloseTo(43.252, 5)
    expect(points[2].lng).toBeCloseTo(-126.453, 5)
  })

  it('returns an empty list for empty or missing input rather than throwing', () => {
    expect(decodePolyline('')).toEqual([])
    expect(decodePolyline(null)).toEqual([])
    expect(decodePolyline(undefined)).toEqual([])
  })

  it('degrades to the points decoded so far on malformed input', () => {
    // A truncated polyline should not take the panel down; drawing a partial
    // route is strictly better than an exception.
    expect(() => decodePolyline('_p~iF~ps|U_ulL')).not.toThrow()
  })
})

describe('projectToUnitBox', () => {
  it('places every point inside the unit box', () => {
    const projected = projectToUnitBox(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@'))
    for (const p of projected) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(1)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(1)
    }
  })

  it('flips y, because SVG grows downward while latitude grows north', () => {
    const projected = projectToUnitBox([
      { lat: 10, lng: 0 },
      { lat: 20, lng: 0 },
    ])
    // The northern point must sit HIGHER on screen, i.e. at a smaller y.
    expect(projected[1].y).toBeLessThan(projected[0].y)
  })

  it('preserves aspect ratio instead of stretching each axis independently', () => {
    // A due-north route must not render as though it were as wide as it is tall.
    const projected = projectToUnitBox([
      { lat: 35.0, lng: 139.0 },
      { lat: 36.0, lng: 139.0 },
    ])
    const dx = Math.abs(projected[1].x - projected[0].x)
    const dy = Math.abs(projected[1].y - projected[0].y)
    expect(dx).toBeLessThan(0.01)
    expect(dy).toBeGreaterThan(0.9)
  })

  it('centres a degenerate route rather than dividing by zero', () => {
    const projected = projectToUnitBox([
      { lat: 35, lng: 139 },
      { lat: 35, lng: 139 },
    ])
    expect(projected.every((p) => p.x === 0.5 && p.y === 0.5)).toBe(true)
  })

  it('returns nothing for no points', () => {
    expect(projectToUnitBox([])).toEqual([])
  })
})

describe('cumulativeFractions', () => {
  it('runs from 0 to 1 along the path', () => {
    const cum = cumulativeFractions([
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 1, y: 0 },
    ])
    expect(cum[0]).toBe(0)
    expect(cum[cum.length - 1]).toBeCloseTo(1, 6)
  })

  it('measures DISTANCE, not point index', () => {
    // Unevenly spaced vertices: the midpoint by index sits at 10% by distance.
    const cum = cumulativeFractions([
      { x: 0, y: 0 },
      { x: 0.1, y: 0 },
      { x: 1, y: 0 },
    ])
    expect(cum[1]).toBeCloseTo(0.1, 6)
    // Indexing would have put it at 0.5 — the drift this function exists to avoid.
    expect(cum[1]).not.toBeCloseTo(0.5, 1)
  })
})

describe('pointAtFraction', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ]
  const cum = cumulativeFractions(points)

  it('interpolates between vertices rather than snapping to them', () => {
    expect(pointAtFraction(points, cum, 0.25)?.x).toBeCloseTo(0.25, 6)
    expect(pointAtFraction(points, cum, 0.5)?.x).toBeCloseTo(0.5, 6)
  })

  it('clamps out-of-range fractions to the ends', () => {
    expect(pointAtFraction(points, cum, -1)?.x).toBeCloseTo(0, 6)
    expect(pointAtFraction(points, cum, 2)?.x).toBeCloseTo(1, 6)
  })

  it('returns null when there is no path', () => {
    expect(pointAtFraction([], [], 0.5)).toBeNull()
  })
})
