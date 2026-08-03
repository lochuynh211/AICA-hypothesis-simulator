/**
 * Route presets, derived from the generated data payload — the offline
 * replacement for `routes/presets/*.json` served by
 * `app/api/aica_api/routers/route_presets.py`.
 */
import { getRoutePresetDocs } from '../registry'
import type { RoutePreset } from '../types'

export type {
  RoutePreset,
  RoutePresetPlace,
  RoutePresetRawRoute,
  RoutePresetRawSegment,
} from '../types'

export function routePresets(): RoutePreset[] {
  return getRoutePresetDocs()
}
