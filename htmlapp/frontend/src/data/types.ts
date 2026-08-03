/**
 * Shapes for records that arrive from the generated data payload.
 *
 * These live here rather than in `api/types.ts` because `api/types.ts` is
 * synced from app/frontend and must stay a faithful copy; these shapes mirror
 * on-disk JSON that has no counterpart there (the same reason
 * `engine/services/route_analysis.ts` declares its own RawRoute/RawPlace).
 */
import type { PackageManifest } from '../api/types'

export type RoutePresetRawSegment = {
  road_class: string
  maneuver?: string
  distance_m: number
}

export type RoutePresetRawRoute = {
  route_id: string
  summary?: string
  distance_m: number
  duration_s: number
  encoded_polyline?: string
  segments?: RoutePresetRawSegment[]
}

export type RoutePresetPlace = {
  name: string
  type?: string
  location: { lat: number; lng: number }
  distance_along_route_m: number
  synthetic?: boolean
}

export type RoutePreset = {
  id: string
  label: { ja: string; en: string }
  start: string
  end: string
  route_source: 'maps' | 'local'
  raw_route: RoutePresetRawRoute
  places: RoutePresetPlace[]
}

export type PackageRecord = {
  id: string
  manifest: PackageManifest
  origin: 'builtin' | 'user'
  /** declarative_rule | weighted_score | builtin_js_module | js_module */
  strategy: string
  source?: string
}
