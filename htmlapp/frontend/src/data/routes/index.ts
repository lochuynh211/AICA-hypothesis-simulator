/**
 * Bundled route presets — offline replacement for the docker app's
 * `routes/presets/*.json` directory served by
 * `app/api/aica_api/routers/route_presets.py`.
 *
 * `RoutePreset` mirrors the on-disk preset JSON shape (genuinely absent from
 * the synced `../../api/types.ts`, same pattern as the locally-declared
 * `RawRoute`/`RawPlace`/`DisplayRoute` types in
 * `../../engine/services/route_analysis.ts`).
 */
import longTokyoOsaka from './long_tokyo_osaka.json'
import middleTokyoKaruizawa from './middle_tokyo_karuizawa.json'
import shortTokyoChichibu from './short_tokyo_chichibu.json'

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

export const DEFAULT_ROUTE_PRESETS: RoutePreset[] = [
  longTokyoOsaka as unknown as RoutePreset,
  middleTokyoKaruizawa as unknown as RoutePreset,
  shortTokyoChichibu as unknown as RoutePreset,
]
