/**
 * Google encoded-polyline decoder — dependency-free.
 *
 * The real map decodes via `google.maps.geometry.encoding.decodePath`, but the
 * fallback map has to draw the SAME route with no SDK loaded (no API key), so it
 * needs its own decoder. This is the standard algorithm from Google's encoded
 * polyline format: signed values, chunked into 5-bit groups, each offset by 63,
 * with the continuation bit set on all but the last chunk, and each coordinate
 * stored as a delta from the previous one.
 *
 * Kept in its own module so it is unit-testable without mounting a component or
 * faking the SDK.
 */

export type LatLng = { lat: number; lng: number }

/**
 * Decode an encoded polyline into lat/lng points.
 *
 * Returns `[]` for empty or malformed input rather than throwing — a bad
 * polyline should degrade to "no route drawn", not take the panel down with it.
 */
export function decodePolyline(encoded: string | null | undefined): LatLng[] {
  if (!encoded) return []

  const points: LatLng[] = []
  let index = 0
  let lat = 0
  let lng = 0

  while (index < encoded.length) {
    let result = 0
    let shift = 0
    let byte: number

    // latitude delta
    do {
      byte = encoded.charCodeAt(index++) - 63
      if (Number.isNaN(byte)) return points
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20 && index < encoded.length)
    lat += result & 1 ? ~(result >> 1) : result >> 1

    result = 0
    shift = 0

    // longitude delta
    do {
      byte = encoded.charCodeAt(index++) - 63
      if (Number.isNaN(byte)) return points
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20 && index < encoded.length)
    lng += result & 1 ? ~(result >> 1) : result >> 1

    points.push({ lat: lat / 1e5, lng: lng / 1e5 })
  }

  return points
}

export type Projected = { x: number; y: number }

/**
 * Project lat/lng onto a 0-1 box, preserving the route's aspect ratio.
 *
 * Longitude degrees shrink with latitude, so a naive independent scale of each
 * axis stretches the route — a north-south motorway would render as wide as an
 * east-west one. Scaling longitude by cos(mean latitude) keeps the shape
 * recognisable as the road it is.
 *
 * `y` is flipped because SVG's origin is top-left while latitude grows north.
 * A degenerate route (one point, or all points identical) centres rather than
 * dividing by zero.
 */
export function projectToUnitBox(points: LatLng[]): Projected[] {
  if (points.length === 0) return []

  const lats = points.map((p) => p.lat)
  const lngs = points.map((p) => p.lng)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)

  const meanLatRad = (((minLat + maxLat) / 2) * Math.PI) / 180
  const lngScale = Math.cos(meanLatRad) || 1

  const spanLat = maxLat - minLat
  const spanLng = (maxLng - minLng) * lngScale
  const span = Math.max(spanLat, spanLng)

  if (span === 0) return points.map(() => ({ x: 0.5, y: 0.5 }))

  // Centre the smaller axis so the route sits in the middle of the box rather
  // than hugging an edge.
  const padLat = (span - spanLat) / 2
  const padLng = (span - spanLng) / 2

  return points.map((p) => ({
    x: ((p.lng - minLng) * lngScale + padLng) / span,
    y: 1 - (p.lat - minLat + padLat) / span,
  }))
}

/**
 * Cumulative along-path distance of each point, normalised to 0-1.
 *
 * Used to place a marker at a given route_fraction on the drawn path: the
 * engine's fractions are fractions of DISTANCE, so stepping by point index
 * instead would drift wherever the polyline's points are unevenly spaced —
 * which they are, densely around junctions and sparsely on long straights.
 */
export function cumulativeFractions(points: Projected[]): number[] {
  if (points.length === 0) return []
  if (points.length === 1) return [0]

  const cum: number[] = [0]
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x
    const dy = points[i].y - points[i - 1].y
    total += Math.hypot(dx, dy)
    cum.push(total)
  }
  if (total === 0) return points.map(() => 0)
  return cum.map((d) => d / total)
}

/**
 * The point at `fraction` (0-1) along the drawn path, interpolating between
 * the two surrounding vertices so the marker moves smoothly rather than
 * snapping from vertex to vertex.
 */
export function pointAtFraction(points: Projected[], fractions: number[], fraction: number): Projected | null {
  if (points.length === 0) return null
  if (points.length === 1) return points[0]

  const f = Math.max(0, Math.min(1, fraction))
  let i = fractions.findIndex((v) => v >= f)
  if (i <= 0) i = f <= 0 ? 1 : points.length - 1

  const prev = points[i - 1]
  const next = points[i]
  const segSpan = fractions[i] - fractions[i - 1]
  const t = segSpan === 0 ? 0 : (f - fractions[i - 1]) / segSpan

  return { x: prev.x + (next.x - prev.x) * t, y: prev.y + (next.y - prev.y) * t }
}
