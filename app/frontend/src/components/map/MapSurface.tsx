import { useEffect, useRef, useState } from 'react'
import { useRunStore } from '../../state/runStore'
import type { RestSpot } from '../../api/types'
import { useRouteProgress } from '../playback/useRouteProgress'
import { useSmoothFraction } from '../playback/useSmoothFraction'
import { t } from '../../i18n/t'
import FallbackRouteMap, { type MapFireMarker, type MapRestMarker } from './FallbackRouteMap'
import { useLanguage } from '../../state/language'

const LABELS = {
  authFailed: {
    ja: 'Google Maps の認証に失敗しました。API キーとドメイン制限を確認してください。',
    en: 'Google Maps authorization failed. Verify your API key and domain restrictions.',
  },
  start: { ja: '出発地', en: 'Start' },
  destination: { ja: '目的地', en: 'Destination' },
  initFailed: { ja: '地図の初期化に失敗しました', en: 'Map initialization failed' },
  mapUnavailable: { ja: '地図を利用できません — ', en: 'Map unavailable — ' },
  routePosition: { ja: 'ルート上の位置', en: 'Route position' },
  proposalPosition: { ja: '提案の位置', en: 'Proposal position' },
  chosenRestSpot: { ja: '選択済みの休憩スポット', en: 'Chosen Rest Spot' },
  chosenRestSpotPrefix: { ja: '選択済みの休憩スポット: ', en: 'Chosen rest spot: ' },
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

export default function MapSurface({
  fractionOverride,
  proposalFractionsOverride,
  restSpotsOverride,
  jamRangesKm,
  fireMarkers = [],
  restMarkers = [],
  inspectedFireIndex = null,
  onFireMarkerClick,
  startName,
  endName,
}: {
  fractionOverride?: number | null
  /** Decision/fire positions (route_fraction 0-1) — the Combined Simulator feeds
   * these from its coordinator (the merged run has no runStore trace). */
  proposalFractionsOverride?: number[]
  /** Accepted rest spots — the Combined Simulator feeds these from its
   * coordinator (no runStore `restHistory`). */
  restSpotsOverride?: RestSpot[]
  /** Painted traffic-jam ranges as `[start_km, end_km]` pairs (feature 020) —
   * drawn as thick RED polylines over the route so the reviewer sees where the
   * jam sits. Empty/undefined → no jam overlay. */
  jamRangesKm?: [number, number][]
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

    // Skip if already initialized for this polyline.
    if (mapInstanceRef.current) return

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

      // Road-class colors (mobile Google Maps inspired).
      // Red is reserved for future traffic zone rendering — traffic zones are
      // not modeled per-segment yet and will be layered on top when available.
      const ROAD_COLORS: Record<string, string> = {
        highway: '#06b6d4',           // cyan
        normal_road: '#2563eb',       // blue (default)
        mountain_road: '#f59e0b',     // orange
        sightseeing_road: '#22c55e',  // green
      }
      const routeSegments = selectedAlt?.route_facts?.route_segments ?? []
      const totalKm = selectedAlt?.route_facts?.total_route_distance_km ?? 0
      const canColorSegments =
        routeSegments.length > 0 &&
        Boolean(gmaps.geometry?.spherical) &&
        totalKm > 0

      if (canColorSegments) {
        const { cum, total } = buildCumulative(path, gmaps.geometry.spherical)
        for (const seg of routeSegments) {
          const fStart = seg.start_km / totalKm
          const fEnd = (seg.start_km + seg.length_km) / totalKm
          const segPath = slicePath(path, cum, total, fStart, fEnd, gmaps.geometry.spherical)
          const segPolyline = new gmaps.Polyline({
            path: segPath,
            strokeColor: ROAD_COLORS[seg.segment_type] ?? '#2563eb',
            strokeOpacity: 0.9,
            strokeWeight: 5,
          })
          segPolyline.setMap(mapInstanceRef.current)
        }
      } else {
        const polyline = new gmaps.Polyline({
          path,
          strokeColor: '#2563eb',
          strokeOpacity: 0.9,
          strokeWeight: 4,
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
        const { cum, total } = buildCumulative(path, gmaps.geometry.spherical)
        pathRef.current = { path, cum, total }
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
      setMapError(err instanceof Error ? err.message : t(LABELS.initFailed, lang))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // NOTE: `lang` is deliberately NOT a dependency here. This effect builds the
    // map canvas + Start/Destination markers once per polyline (guarded by
    // `mapInstanceRef.current`); adding `lang` would either be a no-op (guard
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

    // Car — interpolated position at the eased fraction.
    const carPos = latLngAt(path, cum, total, shownFraction, sph)
    if (carPos && carRef.current) carRef.current.setPosition(carPos)

    // Fire markers (orange) — one per proposal that fired.
    proposalFractions.forEach((pf, i) => {
      const fp = latLngAt(path, cum, total, pf, sph)
      if (!fp) return
      if (!fireRefs.current[i]) {
        fireRefs.current[i] = new gmaps.Marker({
          map: mapInstanceRef.current,
          icon: { path: gmaps.SymbolPath.CIRCLE, scale: 7, fillColor: '#dc2626', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
          zIndex: 998,
        })
      }
      fireRefs.current[i].setPosition(fp)
    })
    // Remove stale markers when proposal count decreases (e.g. after reset).
    if (fireRefs.current.length > proposalFractions.length) {
      for (const m of fireRefs.current.splice(proposalFractions.length)) {
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
    restSpots.forEach((spot, i) => {
      const rsp = latLngAt(path, cum, total, spot.route_fraction, sph)
      if (!rsp) return
      if (!chosenRestRefs.current[i]) {
        chosenRestRefs.current[i] = new gmaps.Marker({
          map: mapInstanceRef.current,
          icon: { path: gmaps.SymbolPath.CIRCLE, scale: 8, fillColor: '#f59e0b', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 },
          title: spot.label ? t(spot.label, lang) : t(LABELS.chosenRestSpot, lang),
          zIndex: 999,
        })
      }
      chosenRestRefs.current[i].setPosition(rsp)
    })
    if (chosenRestRefs.current.length > restSpots.length) {
      for (const m of chosenRestRefs.current.splice(restSpots.length)) {
        m.setMap(null)
      }
    }
  }, [shownFraction, proposalFractions, restSpots.length])

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
        zIndex: 500,
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

  return (
    <div
      data-testid="map-surface"
      style={{ position: 'relative', margin: '12px 0' }}
    >
      {/* No key → the route SCHEMATIC, not a grey box. It draws the same route
          from the same polyline, so the reviewer still sees where the trigger
          fired and where the rest spots are. */}
      {!mapsKey ? (
        <div style={{ height: '52vh', minHeight: '360px' }}>
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
            height: '52vh',
            minHeight: '360px',
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
          style={{ height: '52vh', minHeight: '360px', background: '#e8e8e8', borderRadius: '4px' }}
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
          aria-label={t(LABELS.proposalPosition, lang)}
          style={{
            position: 'absolute',
            bottom: '0',
            left: `${Math.round(pf * 100)}%`,
            transform: 'translateX(-50%)',
            width: '4px',
            height: '24px',
            background: '#dc2626',
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
          aria-label={`${t(LABELS.chosenRestSpotPrefix, lang)}${spot.label ? t(spot.label, lang) : spot.id}`}
          style={{
            position: 'absolute',
            bottom: '0',
            left: `${Math.round(spot.route_fraction * 100)}%`,
            transform: 'translateX(-50%)',
            width: '16px',
            height: '16px',
            background: '#f59e0b',
            borderRadius: '50%',
            border: '3px solid white',
            zIndex: 11,
            visibility: realMarkers ? 'hidden' : 'visible',
          }}
        />
      ))}
    </div>
  )
}
