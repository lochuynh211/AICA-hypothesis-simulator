import { useEffect, useRef, useState } from 'react'
import { useRunStore } from '../../state/runStore'
import type { RestSpot } from '../../api/types'
import { useRouteProgress, type ProposalMarker } from '../playback/useRouteProgress'
import { useSmoothFraction } from '../playback/useSmoothFraction'
import { t } from '../../i18n/t'
import type { UiLanguage } from '../../i18n/t'
import FallbackRouteMap, { type MapFireMarker, type MapRestMarker } from './FallbackRouteMap'
import { useLanguage } from '../../state/language'
import { CATEGORY_LABELS } from '../../lib/review/reviewVocabulary'
import { segLabel } from '../playback/ScoreTimeline'
import {
  REST_SPOT_COLOR, TRIGGER_MONOTONY_COLOR, TRIGGER_REST_COLOR, isRestCategory, triggerColor,
} from '../../lib/review/triggerColors'

/**
 * Google Maps symbol path for the rest-LOCATION marker: a rounded-ish square,
 * centred on the anchor, sized to match the old `SymbolPath.CIRCLE` scale 8.
 * See `lib/review/triggerColors` for why this is a square and not a dot.
 */
const REST_SPOT_SQUARE_PATH = 'M -7,-7 L 7,-7 L 7,7 L -7,7 Z'

const LABELS = {
  authFailed: {
    ja: 'Google Maps の認証に失敗しました。API キーとドメイン制限を確認してください。',
    en: 'Google Maps authorization failed. Verify your API key and domain restrictions.',
  },
  start: { ja: '出発地', en: 'Start' },
  destination: { ja: '目的地', en: 'Destination' },
  // Never carries the raw SDK/JS `Error.message` (always English, sometimes
  // stack-trace-like) — that text is logged to the console instead, and only
  // this fixed bilingual message reaches the screen.
  initFailed: {
    ja: '地図の初期化に失敗しました（技術的な詳細は開発者コンソールを参照）',
    en: 'Map initialization failed (see the browser console for technical detail)',
  },
  mapUnavailable: { ja: '地図を利用できません — ', en: 'Map unavailable — ' },
  routePosition: { ja: 'ルート上の位置', en: 'Route position' },
  firePosition: { ja: '発火位置', en: 'Fire position' },
  fire: { ja: '発火', en: 'Firing' },
  chosenRestSpot: { ja: '選択済みの休憩場所', en: 'Chosen rest location' },
  chosenRestSpotPrefix: { ja: '選択済みの休憩場所: ', en: 'Chosen rest location: ' },
  // Legend-only wording. The road-class names are NOT here: they come from
  // `SEGMENT_LABELS`, the same table the quickview timeline's legend reads, so
  // a road is named identically in both places.
  legendJam: { ja: '渋滞', en: 'traffic jam' },
  legendCar: { ja: '現在位置', en: 'current position' },
}

/**
 * MapSurface (T008 / M4) — Google Maps route surface for the playback panel.
 *
 * Shows the selected alternative's polyline on a Google Maps canvas when
 * route_source === "maps" and the selected alternative has a non-null display.
 * Falls back to null (nothing rendered) when display is null — the caller
 * should render RouteTimeline instead.
 *
 * Car and decision markers are rendered as DOM overlays (data-testid elements)
 * so they are accessible and testable without Google Maps API calls.
 * The Google Maps SDK is loaded via runtime script injection using the in-memory
 * key — never a build-time dependency or a persisted value.
 *
 * Key constraints:
 * - mapsKey is NEVER written to localStorage, sessionStorage, or any file.
 * - NO new npm dependencies (google maps loaded via script injection).
 * - Guard: if display === null, return null (no crash, no map rendered).
 *
 * I3 fix: registers window.gm_authfailure before script injection so the Maps SDK
 * calls our handler instead of rendering its full-page blocking overlay when the
 * API key is invalid or domain-restricted.  Canvas init is also wrapped in
 * try-catch so constructor errors degrade to an inline message rather than
 * propagating as an uncaught React effect error (dev overlay / page freeze).
 */

// Minimal type for the Google Maps surface we use — avoids @types/google.maps.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GMapsLib = any

function getGMaps(): GMapsLib | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).google?.maps
}

// ── Road-class paint: colour + priority ─────────────────────────────────────
//
// Colours are mobile-Google-Maps inspired. Priority is the OWNER'S rule for
// what wins when two paints cover the same stretch of route:
//
//     traffic jam  >  mountain / sightseeing  >  normal / highway
//
// It is expressed as polyline `zIndex` rather than draw order, because the
// paints are drawn by three independent effects (base segments at canvas init,
// the painted mountain range and the painted jam range on their own) and draw
// order between them is not something any one of them controls.
const ROAD_COLORS: Record<string, string> = {
  highway: '#06b6d4',           // cyan
  normal_road: '#2563eb',       // blue (default)
  mountain_road: '#f59e0b',     // orange
  sightseeing_road: '#22c55e',  // green
}

/** The plain road classes — the base the other paints sit on top of. */
const BASE_ROAD_Z = 100
/** Character roads: the segment's own nature is what the reviewer is here for. */
const CHARACTER_ROAD_Z = 300
/** A jam outranks everything: it is the most acute thing on the route. */
const JAM_Z = 500

const ROAD_Z: Record<string, number> = {
  highway: BASE_ROAD_Z,
  normal_road: BASE_ROAD_Z,
  mountain_road: CHARACTER_ROAD_Z,
  sightseeing_road: CHARACTER_ROAD_Z,
}

/** True only on a real Maps SDK — the test mock omits Marker + geometry.spherical. */
function hasGeoMarkers(gmaps: GMapsLib | undefined): boolean {
  return Boolean(gmaps?.Marker && gmaps?.geometry?.spherical)
}

/** Cumulative along-path distances + total, for fraction → lat/lng interpolation. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildCumulative(path: any[], spherical: any): { cum: number[]; total: number } {
  const cum = [0]
  let total = 0
  for (let i = 1; i < path.length; i++) {
    total += spherical.computeDistanceBetween(path[i - 1], path[i])
    cum.push(total)
  }
  return { cum, total }
}

/** Interpolate the lat/lng at fraction f (0–1) of the path's total length. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function latLngAt(path: any[], cum: number[], total: number, f: number, spherical: any): any {
  if (path.length === 0) return null
  if (f <= 0) return path[0]
  if (f >= 1) return path[path.length - 1]
  const target = f * total
  let i = 1
  while (i < cum.length && cum[i] < target) i++
  const span = cum[i] - cum[i - 1] || 1
  return spherical.interpolate(path[i - 1], path[i], (target - cum[i - 1]) / span)
}

/**
 * Extracts the sub-path covering the fraction range [fStart, fEnd].
 * Includes interpolated boundary points so adjacent segments join without gaps.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function slicePath(path: any[], cum: number[], total: number, fStart: number, fEnd: number, spherical: any): any[] {
  if (path.length === 0 || total === 0) return []
  const dStart = fStart * total
  const dEnd = fEnd * total
  const pts: any[] = []
  const ptStart = latLngAt(path, cum, total, fStart, spherical)
  if (ptStart) pts.push(ptStart)
  for (let i = 0; i < path.length; i++) {
    if (cum[i] > dStart && cum[i] < dEnd) pts.push(path[i])
  }
  const ptEnd = latLngAt(path, cum, total, fEnd, spherical)
  if (ptEnd) pts.push(ptEnd)
  return pts
}

/** The category-specific proposal phrase for a projected fire marker's native
 *  tooltip — never the raw backend `category` enum literal. Falls back to the
 *  generic 発火/Firing word for a category this table does not recognize. */
function fireCategoryLabel(category: string | null | undefined, lang: UiLanguage): string {
  if (category && CATEGORY_LABELS[category]) return t(CATEGORY_LABELS[category], lang)
  return t(LABELS.fire, lang)
}

export default function MapSurface({
  fractionOverride,
  proposalFractionsOverride,
  restSpotsOverride,
  jamRangesKm,
  mountainRangesKm,
  fireMarkers = [],
  restMarkers = [],
  inspectedFireIndex = null,
  onFireMarkerClick,
  startName,
  endName,
  showLegend = false,
  playback = false,
  height = '52vh',
  minHeight = '360px',
}: {
  fractionOverride?: number | null
  /** Decision/fire positions + trigger category — the Combined Simulator feeds
   * these from its coordinator (the merged run has no runStore trace). The
   * category is what colors each marker (rest red vs monotony orange). */
  proposalFractionsOverride?: ProposalMarker[]
  /** Accepted rest spots — the Combined Simulator feeds these from its
   * coordinator (no runStore `restHistory`). */
  restSpotsOverride?: RestSpot[]
  /** Painted traffic-jam ranges as `[start_km, end_km]` pairs (feature 020) —
   * drawn as thick RED polylines over the route so the reviewer sees where the
   * jam sits. Empty/undefined → no jam overlay. */
  jamRangesKm?: [number, number][]
  /** Painted mountain-road ranges as `[start_km, end_km]` pairs — drawn in the
   * mountain-road colour over the route. Needed as a prop (rather than read off
   * the selected alternative's `route_segments`) because painting splices the
   * segment SERVER-side into the trigger run plan, leaving the alternative this
   * component colours from unpainted. Empty/undefined → no mountain overlay. */
  mountainRangesKm?: [number, number][]
  /** Projected trigger positions shown BEFORE playback starts (owner review) —
   * a reviewer should see where things happen without pressing Play first. */
  fireMarkers?: MapFireMarker[]
  /** Projected rest-spot positions, same purpose. */
  restMarkers?: MapRestMarker[]
  /** Which projected fire is currently inspected, so the map highlights it. */
  inspectedFireIndex?: number | null
  /** Clicking a trigger marker inspects that fire — the same selection the
   * quickview strip drives, so the two views stay in agreement. */
  onFireMarkerClick?: (index: number) => void
  /** Start/destination place names for the keyless schematic. */
  startName?: string | null
  endName?: string | null
  /** True once a run is under way. Until then the map shows the PROJECTED
   *  trigger/rest markers; from then on it shows what actually happened. */
  playback?: boolean
  /** Render a colour key directly under the canvas. Off by default (the same
   * convention `ScoreTimeline.showLegend` uses) so screens that don't want it
   * are untouched. It names only what is actually drawn on THIS route. */
  showLegend?: boolean
  /** Canvas height. The Combined Simulator passes a shorter band because the
   *  service/content proposals below it are that panel's main content; the
   *  Trigger screen keeps the taller default. */
  height?: string
  minHeight?: string
} = {}) {
  const { state } = useRunStore()
  const { mapsKey, alternatives, selectedRouteId } = state
  const { lang } = useLanguage()

  // Accepted rest spots (one per accepted rest), captured at accept time into
  // restHistory so the gold markers persist after recovery ends instead of
  // vanishing with the transient recovery.rest_spot. Drives both the
  // geographic markers and the DOM-overlay fallback markers.
  const restSpots = restSpotsOverride ?? state.restHistory.map((r) => r.spot)

  // mapsReady: true when the Google Maps SDK is available (either pre-loaded or
  // after the async script callback fires). Drives the map-init useEffect so
  // the canvas initializes after the SDK loads, not just on the next unrelated render.
  const [mapsReady, setMapsReady] = useState(() => Boolean(getGMaps()?.geometry?.encoding))

  // mapError: set when the Maps SDK fails to initialize (invalid key, auth error,
  // or constructor throwing). Causes the component to render an inline fallback
  // instead of the canvas — car/decision markers remain functional.
  const [mapError, setMapError] = useState<string | null>(null)

  const mapContainerRef = useRef<HTMLDivElement>(null)
  // Holds the google.maps.Map instance across renders — not React state
  // because we don't want re-renders on Map init.
  const mapInstanceRef = useRef<GMapsLib>(null)
  /** The polyline the current canvas was built for — the map is rebuilt when
   *  the selected route changes to a different one. */
  const builtPolylineRef = useRef<string | null>(null)

  // ── Derive selected alternative display ───────────────────────────────────
  const selectedAlt = alternatives.find((a) => a.route_id === selectedRouteId) ?? null
  const display = selectedAlt?.display ?? null

  // ── Route position (shared, clamped) + eased car fraction ─────────────────
  // `fractionOverride` (feature 020) lets the Combined Simulator drive the car
  // from its coordinator's live `route_fraction` — the merged run has no
  // runStore run, so `useRouteProgress()` (runStore-driven) would stay at 0.
  // Omitted everywhere else → byte-identical store-driven behavior.
  const { currentFraction: storeFraction, proposalFractions: storeProposalFractions } = useRouteProgress()
  const currentFraction = fractionOverride ?? storeFraction
  const proposalFractions = proposalFractionsOverride ?? storeProposalFractions
  const positionPct = `${Math.round(currentFraction * 100)}%`

  // PROJECTION vs PLAYBACK markers. Before a run exists there is nothing in
  // `proposalFractions`/`restSpots` (those are recorded as the run happens), so
  // without this the real Google canvas showed a bare route: the projected
  // triggers and rest spots only ever reached the keyless schematic. Show the
  // projection by default and hand over to the live markers once playback owns
  // the map.
  const projecting = !playback && (fireMarkers.length > 0 || restMarkers.length > 0)
  const prevProjectingRef = useRef(projecting)
  // Both branches carry the trigger CATEGORY, not just a position — the marker
  // color is derived from it, so a monotony proposal is orange in playback for
  // the same reason it is orange in the projection.
  const geoFires: ProposalMarker[] = projecting
    ? fireMarkers.map((f) => ({ fraction: f.fraction, category: f.category }))
    : proposalFractions
  const geoFireFractions = geoFires.map((f) => f.fraction)
  const geoRestFractions = projecting
    ? restMarkers.map((r) => r.fraction)
    : restSpots.map((s) => s.route_fraction)
  // Depend on the VALUES — these arrays are rebuilt on every render, so using
  // them directly as deps would re-run the marker effect continuously. The
  // category is part of the key: a marker whose category changed must be
  // repainted even though its position did not.
  const fireKey = geoFires.map((f) => `${f.fraction}:${f.category ?? ''}`).join(',')
  const restKey = geoRestFractions.join(',')
  const shownFraction = useSmoothFraction(currentFraction)

  // Holds the decoded route path + cumulative distances + the live markers, so
  // the car can be interpolated along the real polyline each frame.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pathRef = useRef<{ path: any[]; cum: number[]; total: number } | null>(null)
  const carRef = useRef<GMapsLib>(null)
  const startRef = useRef<GMapsLib>(null)
  const fireRefs = useRef<GMapsLib[]>([])
  // Red traffic-jam polylines (feature 020) — one per painted jam range, redrawn
  // whenever the ranges change.
  const jamPolyRefs = useRef<GMapsLib[]>([])
  // Mountain-road polylines — one per painted mountain range, same lifecycle.
  const mountainPolyRefs = useRef<GMapsLib[]>([])
  // Geographic markers for the accepted rest spots (real SDK only) — one per
  // restHistory entry, so all accepted rests stay visible on the map.
  const chosenRestRefs = useRef<GMapsLib[]>([])
  // realMarkers: true once geographic markers are drawn — hides the DOM-overlay
  // fallback markers so the car isn't shown twice on a real map.
  const [realMarkers, setRealMarkers] = useState(false)

  // ── Google Maps script injection ──────────────────────────────────────────
  // Only inject when we have a key, a display, and Maps is not already loaded.
  useEffect(() => {
    if (!display || !mapsKey) return

    // Fix 2: clear any stale map error so a fresh key/polyline attempt starts
    // without showing the previous failure banner (e.g. bad key → valid key).
    setMapError(null)

    // I3 fix: register gm_authfailure BEFORE injecting the script so the SDK
    // calls our handler instead of rendering its full-page blocking overlay.
    // When the Maps SDK detects an invalid/domain-restricted key it looks for
    // window.gm_authfailure; if found it calls it; if not it falls back to its
    // built-in modal dialog that captures all pointer events (UI freeze).
    // authCleanup is shared by ALL paths (early-returns and full injection)
    // so the handler is never left on window after unmount.
    const authCleanup = () => {
      delete (window as Record<string, unknown>)['gm_authfailure']
    }
    ;(window as Record<string, unknown>)['gm_authfailure'] = () => {
      setMapError(t(LABELS.authFailed, lang))
    }

    if (getGMaps()?.geometry?.encoding) return authCleanup // already loaded

    const callbackName = '__aicaHypSimMapsInit'
    const scriptId = 'aica-hyp-sim-gmaps-script'

    if (document.getElementById(scriptId)) return authCleanup // injection already in progress

    ;(window as Record<string, unknown>)[callbackName] = () => {
      delete (window as Record<string, unknown>)[callbackName]
      // Trigger a re-render so the map-init effect runs after the SDK is ready.
      setMapsReady(true)
    }

    const script = document.createElement('script')
    script.id = scriptId
    script.src = `https://maps.googleapis.com/maps/api/js?key=${mapsKey}&libraries=geometry&callback=${callbackName}`
    script.async = true
    document.head.appendChild(script)

    return () => {
      const existing = document.getElementById(scriptId)
      if (existing) document.head.removeChild(existing)
      delete (window as Record<string, unknown>)[callbackName]
      authCleanup()
    }
    // `lang` is included so the gm_authfailure handler captures the current
    // language for its (rarely fired) error message; this does not rebuild the
    // map canvas, only re-registers the auth-failure callback / re-runs the
    // (idempotent, ref-guarded) script-injection check.
  }, [mapsKey, display?.encoded_polyline, lang])

  // ── Google Maps canvas initialization ─────────────────────────────────────
  // Runs when the SDK becomes ready (mapsReady) or the selected polyline changes.
  // Uses the pre-loaded google.maps from window (either injected or mocked in tests).
  useEffect(() => {
    if (!display || !mapContainerRef.current) return
    const gmaps = getGMaps()
    if (!gmaps?.geometry?.encoding) return

    // Skip if already initialized FOR THIS POLYLINE. The guard used to be just
    // `if (mapInstanceRef.current) return`, which — despite the comment — never
    // compared polylines: the canvas was built once and every later route
    // change (picking a different preset, or a test case pinning its own
    // route) was silently skipped, so the map kept showing the first route
    // loaded. Selecting a new route must rebuild it.
    const polylineKey = display.encoded_polyline
    if (mapInstanceRef.current && builtPolylineRef.current === polylineKey) return

    if (mapInstanceRef.current) {
      // Detach the previous route's overlays before rebuilding, so the old
      // route is not left drawn underneath the new one.
      startRef.current?.setMap?.(null); startRef.current = null
      carRef.current?.setMap?.(null); carRef.current = null
      for (const m of fireRefs.current) m?.setMap?.(null)
      fireRefs.current = []
      for (const m of chosenRestRefs.current) m?.setMap?.(null)
      chosenRestRefs.current = []
      for (const p of jamPolyRefs.current) p?.setMap?.(null)
      jamPolyRefs.current = []
      for (const p of mountainPolyRefs.current) p?.setMap?.(null)
      mountainPolyRefs.current = []
      pathRef.current = null
      mapInstanceRef.current = null
      setRealMarkers(false)
    }
    builtPolylineRef.current = polylineKey

    // I3 fix: wrap in try-catch so any SDK constructor error (e.g. thrown by an
    // invalid key or a Maps SDK version mismatch) is handled gracefully.
    // Without this the error propagates from useEffect, React re-throws it during
    // commit, and in development the full-page React error overlay appears —
    // identical to the "can't press any button" freeze reported in M4 testing.
    try {
      const path: Array<{ lat: () => number; lng: () => number }> =
        gmaps.geometry.encoding.decodePath(display.encoded_polyline)

      if (path.length === 0) return

      const center = { lat: path[0].lat(), lng: path[0].lng() }

      mapInstanceRef.current = new gmaps.Map(mapContainerRef.current, {
        center,
        zoom: 10,
      })

      // Cache the decoded path + cumulative distances as soon as `spherical` is
      // available, NOT only alongside the geographic markers below. The painted
      // overlays (mountain, jam) are km→fraction slices of this path and are
      // drawn by their own effects, so they need it whether or not the SDK also
      // offers Marker.
      if (gmaps.geometry?.spherical) {
        const { cum, total } = buildCumulative(path, gmaps.geometry.spherical)
        pathRef.current = { path, cum, total }
      }

      const routeSegments = selectedAlt?.route_facts?.route_segments ?? []
      const totalKm = selectedAlt?.route_facts?.total_route_distance_km ?? 0
      const canColorSegments = routeSegments.length > 0 && pathRef.current != null && totalKm > 0

      if (canColorSegments) {
        const { cum, total } = pathRef.current!
        for (const seg of routeSegments) {
          const fStart = seg.start_km / totalKm
          const fEnd = (seg.start_km + seg.length_km) / totalKm
          const segPath = slicePath(path, cum, total, fStart, fEnd, gmaps.geometry.spherical)
          const segPolyline = new gmaps.Polyline({
            path: segPath,
            strokeColor: ROAD_COLORS[seg.segment_type] ?? ROAD_COLORS.normal_road,
            strokeOpacity: 0.9,
            strokeWeight: 5,
            zIndex: ROAD_Z[seg.segment_type] ?? BASE_ROAD_Z,
          })
          segPolyline.setMap(mapInstanceRef.current)
        }
      } else {
        const polyline = new gmaps.Polyline({
          path,
          strokeColor: ROAD_COLORS.normal_road,
          strokeOpacity: 0.9,
          strokeWeight: 4,
          zIndex: BASE_ROAD_Z,
        })
        polyline.setMap(mapInstanceRef.current)
      }

      // Zoom to cover the whole route (start → end) at load.
      if (gmaps.LatLngBounds) {
        const bounds = new gmaps.LatLngBounds()
        path.forEach((p: { lat: () => number; lng: () => number }) => bounds.extend(p))
        mapInstanceRef.current.fitBounds?.(bounds)
      }

      // Real-SDK geographic markers: car (arrow on the route), start, rest, fire.
      // Skipped under the test mock (no Marker / geometry.spherical) — the DOM
      // overlay markers below stay as the testable fallback.
      if (hasGeoMarkers(gmaps)) {
        // `pathRef` was already filled above — markers only need the map handle.
        const map = mapInstanceRef.current

        startRef.current = new gmaps.Marker({
          position: path[0],
          map,
          icon: { path: gmaps.SymbolPath.CIRCLE, scale: 6, fillColor: '#22c55e', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
          title: t(LABELS.start, lang),
          zIndex: 998,
        })
        // End marker — the destination at the end of the polyline.
        new gmaps.Marker({
          position: path[path.length - 1],
          map,
          icon: { path: gmaps.SymbolPath.CIRCLE, scale: 6, fillColor: '#64748b', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
          title: t(LABELS.destination, lang),
          zIndex: 998,
        })
        carRef.current = new gmaps.Marker({
          position: path[0],
          map,
          // A moving DOT, not a heading arrow (owner review) — the arrow implied a
          // bearing we do not compute, and read as noise at route zoom.
          icon: { path: gmaps.SymbolPath.CIRCLE, scale: 6, fillColor: '#2563eb', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
          zIndex: 999,
        })
        setRealMarkers(true)
      }
    } catch (err) {
      // Canvas initialization failed — show inline fallback instead of propagating.
      // Car and decision markers still work; only the actual map canvas is missing.
      console.error('[MapSurface] Maps canvas init failed:', err)
      // Never surface `err.message` itself — it is raw SDK/JS text (always
      // English) and would land unlocalized on a JA screen (rule 3). The
      // technical detail stays in the console log above.
      setMapError(t(LABELS.initFailed, lang))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // NOTE: `lang` is deliberately NOT a dependency here. This effect builds the
    // map canvas + Start/Destination markers once per polyline (guarded by
    // `builtPolylineRef`); adding `lang` would either be a no-op (guard
    // blocks re-creation, so titles wouldn't actually update) or, if the guard
    // were removed, would re-run full canvas/marker initialization on every
    // language switch. The Start/Destination marker titles and this fallback
    // message are localized to whatever `lang` is active at first successful
    // init and do not retroactively relabel on a later language switch.
  }, [mapsReady, display?.encoded_polyline])

  // ── Move/refresh geographic markers as the run progresses ─────────────────
  // Car eases along the route via shownFraction; rest/fire markers track their
  // fractions. No-op under the test mock (pathRef stays null → realMarkers false).
  useEffect(() => {
    const gmaps = getGMaps()
    const built = pathRef.current
    if (!built || !hasGeoMarkers(gmaps) || !mapInstanceRef.current) return
    const sph = gmaps.geometry.spherical
    const { path, cum, total } = built

    if (prevProjectingRef.current !== projecting) {
      // Handover: projected markers carry click handlers and titles that the
      // playback ones must not inherit, and they are reused by index.
      for (const m of fireRefs.current) m?.setMap?.(null)
      fireRefs.current = []
      for (const m of chosenRestRefs.current) m?.setMap?.(null)
      chosenRestRefs.current = []
      prevProjectingRef.current = projecting
    }

    // Car — interpolated position at the eased fraction.
    const carPos = latLngAt(path, cum, total, shownFraction, sph)
    if (carPos && carRef.current) carRef.current.setPosition(carPos)

    // Trigger markers — the PROJECTED fires before playback, the ones that
    // actually fired during it. Projected markers are clickable, so the map is
    // the control for choosing which decision the review column examines.
    geoFires.forEach((gf, i) => {
      const pf = gf.fraction
      const fp = latLngAt(path, cum, total, pf, sph)
      if (!fp) return
      const selected = projecting && inspectedFireIndex === i
      const fill = triggerColor(gf.category)
      if (!fireRefs.current[i]) {
        const marker = new gmaps.Marker({
          map: mapInstanceRef.current,
          icon: {
            path: gmaps.SymbolPath.CIRCLE,
            scale: selected ? 10 : 7,
            fillColor: fill,
            fillOpacity: 1,
            strokeColor: '#fff',
            strokeWeight: selected ? 3 : 2,
          },
          // The category names the marker in BOTH modes now — during playback
          // it is the only thing telling a rest fire from a monotony fire.
          title: fireCategoryLabel(gf.category, lang),
          clickable: projecting,
          zIndex: 998,
        })
        if (projecting && onFireMarkerClick) {
          const index = fireMarkers[i]?.index ?? i
          marker.addListener?.('click', () => onFireMarkerClick(index))
        }
        fireRefs.current[i] = marker
      } else {
        // Keep the highlight AND the category color in step. This used to run
        // only while `projecting`; a live marker reused across a category change
        // then kept its first color.
        fireRefs.current[i].setIcon?.({
          path: gmaps.SymbolPath.CIRCLE,
          scale: selected ? 10 : 7,
          fillColor: fill,
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: selected ? 3 : 2,
        })
      }
      fireRefs.current[i].setPosition(fp)
    })
    // Remove stale markers when the count decreases (e.g. after reset, or on
    // the projection → playback handover).
    if (fireRefs.current.length > geoFireFractions.length) {
      for (const m of fireRefs.current.splice(geoFireFractions.length)) {
        m.setMap(null)
      }
    }

    // Chosen rest-spot markers (gold) — one per accepted rest; they persist as
    // history.  Sync the marker array to restSpots: create/position present
    // ones, drop any extras (e.g. after a reset clears restHistory).
    // `lang` is read from the render closure (not a dep) — this effect already
    // reruns on every `shownFraction` tick during playback, so newly-created
    // markers pick up the current language; a marker's title is set only once
    // at creation, so an already-created marker's title does not retroactively
    // relabel on a later language switch.
    geoRestFractions.forEach((fraction, i) => {
      const rsp = latLngAt(path, cum, total, fraction, sph)
      if (!rsp) return
      if (!chosenRestRefs.current[i]) {
        const spot = projecting ? null : restSpots[i]
        chosenRestRefs.current[i] = new gmaps.Marker({
          map: mapInstanceRef.current,
          // A SQUARE, not a circle, and this is now load-bearing: a rest
          // location shares the rest trigger's red, so shape is the ONLY thing
          // separating a place from a fired decision. See lib/review/triggerColors.
          icon: { path: REST_SPOT_SQUARE_PATH, scale: 1, fillColor: REST_SPOT_COLOR, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 },
          title: spot?.label ? t(spot.label, lang) : t(LABELS.chosenRestSpot, lang),
          zIndex: 999,
        })
      }
      chosenRestRefs.current[i].setPosition(rsp)
    })
    if (chosenRestRefs.current.length > geoRestFractions.length) {
      for (const m of chosenRestRefs.current.splice(geoRestFractions.length)) {
        m.setMap(null)
      }
    }
    // `projecting` and the marker arrays are part of what this draws, so they
    // must be dependencies — otherwise the projected markers never appear
    // (they arrive after the canvas is built) and the handover to playback
    // markers never happens.
  }, [shownFraction, fireKey, restKey, projecting, inspectedFireIndex, realMarkers])

  // ── Painted mountain-road overlay ─────────────────────────────────────────
  // The painted range is spliced into `route_facts.route_segments` SERVER-side,
  // inside the trigger run plan — the alternative this component colours from
  // stays unpainted, so without this the stretch appeared in the quickview and
  // nowhere on the map (C-04).
  //
  // Drawn as its OWN effect rather than inside canvas init, because the canvas
  // is rebuilt per POLYLINE: switching from a case that paints nothing to one
  // that paints a mountain range keeps the same route preset, so an init-time
  // paint would never appear.
  const mountainKey = JSON.stringify(mountainRangesKm ?? [])
  useEffect(() => {
    const gmaps = getGMaps()
    const built = pathRef.current
    // Clear prior overlays first — the ranges may have shrunk or cleared.
    mountainPolyRefs.current.forEach((p) => p.setMap(null))
    mountainPolyRefs.current = []
    if (!built || !gmaps?.geometry?.spherical || !mapInstanceRef.current) return
    const totalKm = selectedAlt?.route_facts?.total_route_distance_km ?? 0
    if (totalKm <= 0) return
    for (const [startKm, endKm] of mountainRangesKm ?? []) {
      if (!(endKm > startKm)) continue
      const fStart = Math.max(0, Math.min(1, startKm / totalKm))
      const fEnd = Math.max(0, Math.min(1, endKm / totalKm))
      const segPath = slicePath(built.path, built.cum, built.total, fStart, fEnd, gmaps.geometry.spherical)
      const poly = new gmaps.Polyline({
        path: segPath,
        strokeColor: ROAD_COLORS.mountain_road,
        strokeOpacity: 0.95,
        strokeWeight: 6,
        zIndex: CHARACTER_ROAD_Z,
      })
      poly.setMap(mapInstanceRef.current)
      mountainPolyRefs.current.push(poly)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mountainKey, mapsReady, display?.encoded_polyline, realMarkers])

  // ── Traffic-jam overlay (feature 020) ─────────────────────────────────────
  // Thick RED polylines over the painted jam km ranges. Redraws whenever the
  // ranges change, the route changes, or the geographic path becomes available
  // (`realMarkers` flips true once the init effect built `pathRef`). No-op under
  // the test mock (pathRef stays null).
  const jamKey = JSON.stringify(jamRangesKm ?? [])
  useEffect(() => {
    const gmaps = getGMaps()
    const built = pathRef.current
    // Clear prior jam polylines first — the ranges may have shrunk or cleared.
    jamPolyRefs.current.forEach((p) => p.setMap(null))
    jamPolyRefs.current = []
    if (!built || !gmaps?.geometry?.spherical || !mapInstanceRef.current) return
    const totalKm = selectedAlt?.route_facts?.total_route_distance_km ?? 0
    if (totalKm <= 0) return
    for (const [startKm, endKm] of jamRangesKm ?? []) {
      if (!(endKm > startKm)) continue
      const fStart = Math.max(0, Math.min(1, startKm / totalKm))
      const fEnd = Math.max(0, Math.min(1, endKm / totalKm))
      const jamPath = slicePath(built.path, built.cum, built.total, fStart, fEnd, gmaps.geometry.spherical)
      const jamPoly = new gmaps.Polyline({
        path: jamPath,
        strokeColor: '#dc2626',
        strokeOpacity: 0.95,
        strokeWeight: 8,
        zIndex: JAM_Z,
      })
      jamPoly.setMap(mapInstanceRef.current)
      jamPolyRefs.current.push(jamPoly)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jamKey, mapsReady, display?.encoded_polyline, realMarkers])

  // ── Guard: nothing to show ────────────────────────────────────────────────
  // When display is null (local path), return null so the caller can fall back
  // to RouteTimeline.  Must be after all hooks.
  if (!display) return null

  // ── Legend rows ───────────────────────────────────────────────────────────
  // Only what is ACTUALLY on this route: a key that lists colours the reviewer
  // cannot see is worse than no key. Ordered to match the paint priority, so
  // reading down the legend is reading down the layers.
  //
  // Deduplicated by LABEL, not by segment type: a painted mountain range and a
  // preset mountain segment are the same orange road and must be named once.
  const legendRows: { color: string; label: string; shape: 'line' | 'dot' | 'square'; weight?: number }[] = []
  if (showLegend) {
    const seen = new Set<string>()
    const addLine = (color: string, label: string, weight?: number) => {
      if (seen.has(label)) return
      seen.add(label)
      legendRows.push({ color, label, shape: 'line', weight })
    }
    if ((jamRangesKm ?? []).length > 0) addLine('#dc2626', t(LABELS.legendJam, lang), 5)
    if ((mountainRangesKm ?? []).length > 0) {
      addLine(ROAD_COLORS.mountain_road, segLabel('mountain_road', lang), 4)
    }
    for (const seg of selectedAlt?.route_facts?.route_segments ?? []) {
      addLine(ROAD_COLORS[seg.segment_type] ?? ROAD_COLORS.normal_road, segLabel(seg.segment_type, lang), 3)
    }
    // Markers, in the order they appear along a journey.
    legendRows.push({ color: '#22c55e', label: t(LABELS.start, lang), shape: 'dot' })
    legendRows.push({ color: '#2563eb', label: t(LABELS.legendCar, lang), shape: 'dot' })
    // One legend row per trigger CATEGORY actually present, so the two marker
    // colors are never identity-by-color-alone.
    if (geoFires.some((f) => isRestCategory(f.category))) {
      legendRows.push({ color: TRIGGER_REST_COLOR, label: t(CATEGORY_LABELS.rest_required, lang), shape: 'dot' })
    }
    if (geoFires.some((f) => !isRestCategory(f.category))) {
      legendRows.push({
        color: TRIGGER_MONOTONY_COLOR,
        label: t(CATEGORY_LABELS.monotony_prevention, lang),
        shape: 'dot',
      })
    }
    if (geoRestFractions.length > 0) {
      legendRows.push({ color: REST_SPOT_COLOR, label: t(LABELS.chosenRestSpot, lang), shape: 'square' })
    }
    legendRows.push({ color: '#64748b', label: t(LABELS.destination, lang), shape: 'dot' })
  }

  return (
    <>
    <div
      data-testid="map-surface"
      style={{ position: 'relative', margin: '12px 0' }}
    >
      {/* No key → the route SCHEMATIC, not a grey box. It draws the same route
          from the same polyline, so the reviewer still sees where the trigger
          fired and where the rest spots are. */}
      {!mapsKey ? (
        <div style={{ height, minHeight }}>
          <FallbackRouteMap
            encodedPolyline={display?.encoded_polyline}
            startName={startName}
            endName={endName}
            totalKm={selectedAlt?.route_facts?.total_route_distance_km ?? null}
            fires={fireMarkers}
            restSpots={restMarkers}
            carFraction={fractionOverride ?? null}
            inspectedFireIndex={inspectedFireIndex}
            onFireClick={onFireMarkerClick}
            lang={lang}
          />
        </div>
      ) : mapError ? (
        <div
          data-testid="map-init-error"
          role="alert"
          style={{
            height,
            minHeight,
            background: '#fff3f3',
            border: '1px solid #fca5a5',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
        >
          <p style={{ color: '#b91c1c', fontSize: '0.85em', textAlign: 'center', margin: 0 }}>
            {t(LABELS.mapUnavailable, lang)}{mapError}
          </p>
        </div>
      ) : (
        <div
          ref={mapContainerRef}
          data-testid="map-container"
          style={{ height, minHeight, background: '#e8e8e8', borderRadius: '4px' }}
        />
      )}

      {/* DOM overlay: car marker — position from route_fraction (0–100%). */}
      {/* CSS left drives display-only position; no store mutation on animation. */}
      <div
        data-testid="car-marker"
        aria-label={`${t(LABELS.routePosition, lang)}: ${positionPct}`}
        style={{
          position: 'absolute',
          bottom: '4px',
          left: positionPct,
          transform: 'translateX(-50%)',
          width: '20px',
          height: '20px',
          background: '#2563eb',
          borderRadius: '50%',
          border: '2px solid white',
          transition: 'left 0.5s ease',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
          zIndex: 10,
          // Hidden when the real on-route car marker is drawn (avoids two cars).
          visibility: realMarkers ? 'hidden' : 'visible',
        }}
      />

      {/* DOM overlay: decision/proposal markers — one per proposal */}
      {proposalFractions.map((pf, i) => (
        <div
          key={`decision-${i}`}
          data-testid="decision-marker"
          data-category={isRestCategory(pf.category) ? 'rest' : 'monotony'}
          aria-label={`${t(LABELS.firePosition, lang)} — ${fireCategoryLabel(pf.category, lang)}`}
          style={{
            position: 'absolute',
            bottom: '0',
            left: `${Math.round(pf.fraction * 100)}%`,
            transform: 'translateX(-50%)',
            width: '4px',
            height: '24px',
            background: triggerColor(pf.category),
            borderRadius: '2px',
            zIndex: 10,
            visibility: realMarkers ? 'hidden' : 'visible',
          }}
        />
      ))}

      {/* DOM overlay: chosen rest-spot markers (gold circles) — one per accepted
          rest from restHistory, positioned by route_fraction. Persist as history.
          Hidden when the real SDK geographic markers are active (realMarkers=true).
          testable under the mock (no Marker). */}
      {restSpots.map((spot, i) => (
        <div
          key={`rest-${i}-${spot.id}`}
          data-testid="rest-spot-marker"
          aria-label={spot.label ? `${t(LABELS.chosenRestSpotPrefix, lang)}${t(spot.label, lang)}` : t(LABELS.chosenRestSpot, lang)}
          style={{
            position: 'absolute',
            bottom: '0',
            left: `${Math.round(spot.route_fraction * 100)}%`,
            transform: 'translateX(-50%)',
            width: '16px',
            height: '16px',
            background: REST_SPOT_COLOR,
            // Square (see the geographic marker above) — with the rest location
            // now sharing the rest trigger's red, shape is the only thing
            // separating this place from a fired decision.
            borderRadius: '2px',
            border: '3px solid white',
            zIndex: 11,
            visibility: realMarkers ? 'hidden' : 'visible',
          }}
        />
      ))}
    </div>

    {/* Directly under the canvas, and a SIBLING of it — the marker overlays
        above are absolutely positioned against `map-surface`, so putting the
        legend inside it would grow that box and drag every `bottom: 0` marker
        down onto the legend. */}
    {showLegend && (
      <div
        data-testid="map-legend"
        style={{
          display: 'flex', flexWrap: 'wrap', gap: '4px 12px',
          fontSize: '0.72em', color: '#6b7280', margin: '-6px 0 8px',
        }}
      >
        {legendRows.map((row) => (
          <span key={row.label} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            {row.shape === 'line' ? (
              <span style={{
                width: '16px', height: 0, display: 'inline-block',
                borderTop: `${row.weight ?? 3}px solid ${row.color}`, borderRadius: '2px',
              }} />
            ) : (
              // The swatch mirrors the marker's own shape — a rest LOCATION is a
              // square on the map, so it must be a square here too, or the key
              // stops matching what it explains.
              <span style={{
                width: '10px', height: '10px', display: 'inline-block', background: row.color,
                borderRadius: row.shape === 'square' ? '2px' : '50%',
                border: '1px solid #fff', boxShadow: '0 0 0 1px #d1d5db',
              }} />
            )}
            {row.label}
          </span>
        ))}
      </div>
    )}
    </>
  )
}
