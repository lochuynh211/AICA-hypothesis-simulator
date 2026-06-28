import { useEffect, useRef, useState } from 'react'
import { useRunStore } from '../../state/runStore'
import { useRouteProgress } from '../playback/useRouteProgress'
import { useSmoothFraction } from '../playback/useSmoothFraction'

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

export default function MapSurface() {
  const { state } = useRunStore()
  const { mapsKey, alternatives, selectedRouteId } = state

  // Chosen rest spot from the recovery engine (null when no recovery is active
  // or the spot has not been selected yet). Drives the DOM-overlay marker.
  const restSpot = state.runState?.recovery?.rest_spot ?? null

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
  const { currentFraction, proposalFraction, restFraction } = useRouteProgress()
  const positionPct = `${Math.round(currentFraction * 100)}%`
  const shownFraction = useSmoothFraction(currentFraction)

  // Holds the decoded route path + cumulative distances + the live markers, so
  // the car can be interpolated along the real polyline each frame.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pathRef = useRef<{ path: any[]; cum: number[]; total: number } | null>(null)
  const carRef = useRef<GMapsLib>(null)
  const startRef = useRef<GMapsLib>(null)
  const restRef = useRef<GMapsLib>(null)
  const fireRef = useRef<GMapsLib>(null)
  // Geographic marker for the chosen rest spot (real SDK only).
  const chosenRestRef = useRef<GMapsLib>(null)
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
      setMapError(
        'Google Maps authorization failed. Verify your API key and domain restrictions.',
      )
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
  }, [mapsKey, display?.encoded_polyline])

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

      const polyline = new gmaps.Polyline({
        path,
        strokeColor: '#2563eb',
        strokeOpacity: 0.9,
        strokeWeight: 4,
      })
      polyline.setMap(mapInstanceRef.current)

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
          title: 'Start',
          zIndex: 998,
        })
        // End marker — the destination at the end of the polyline.
        new gmaps.Marker({
          position: path[path.length - 1],
          map,
          icon: { path: gmaps.SymbolPath.CIRCLE, scale: 6, fillColor: '#64748b', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
          title: 'Destination',
          zIndex: 998,
        })
        carRef.current = new gmaps.Marker({
          position: path[0],
          map,
          icon: { path: gmaps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 5, fillColor: '#2563eb', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
          zIndex: 999,
        })
        setRealMarkers(true)
      }
    } catch (err) {
      // Canvas initialization failed — show inline fallback instead of propagating.
      // Car and decision markers still work; only the actual map canvas is missing.
      console.error('[MapSurface] Maps canvas init failed:', err)
      setMapError(err instanceof Error ? err.message : 'Map initialization failed')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

    // Rest marker (gold) at the rest-facility fraction.
    if (restFraction != null) {
      const rp = latLngAt(path, cum, total, restFraction, sph)
      if (rp) {
        if (!restRef.current) {
          restRef.current = new gmaps.Marker({
            map: mapInstanceRef.current,
            icon: { path: gmaps.SymbolPath.CIRCLE, scale: 6, fillColor: '#f0c000', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
            zIndex: 997,
          })
        }
        restRef.current.setPosition(rp)
      }
    }

    // Fire marker (orange) where the proposal fired.
    if (proposalFraction != null) {
      const fp = latLngAt(path, cum, total, proposalFraction, sph)
      if (fp) {
        if (!fireRef.current) {
          fireRef.current = new gmaps.Marker({
            map: mapInstanceRef.current,
            icon: { path: gmaps.SymbolPath.CIRCLE, scale: 7, fillColor: '#ff7b54', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
            zIndex: 998,
          })
        }
        fireRef.current.setPosition(fp)
      }
    }

    // Chosen rest-spot marker (gold star / emphasized) — only when a rest spot
    // has been selected by the recovery engine.
    if (restSpot != null) {
      const rsp = latLngAt(path, cum, total, restSpot.route_fraction, sph)
      if (rsp) {
        if (!chosenRestRef.current) {
          chosenRestRef.current = new gmaps.Marker({
            map: mapInstanceRef.current,
            icon: { path: gmaps.SymbolPath.CIRCLE, scale: 8, fillColor: '#f0c000', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 },
            title: restSpot.label?.en ?? 'Chosen Rest Spot',
            zIndex: 999,
          })
        }
        chosenRestRef.current.setPosition(rsp)
      }
    } else if (chosenRestRef.current) {
      // Rest spot cleared — hide the geographic marker.
      chosenRestRef.current.setMap(null)
      chosenRestRef.current = null
    }
  }, [shownFraction, restFraction, proposalFraction, restSpot])

  // ── Guard: nothing to show ────────────────────────────────────────────────
  // When display is null (local path), return null so the caller can fall back
  // to RouteTimeline.  Must be after all hooks.
  if (!display) return null

  return (
    <div
      data-testid="map-surface"
      style={{ position: 'relative', margin: '12px 0' }}
    >
      {/* Google Maps canvas — or inline error fallback when init fails */}
      {mapError ? (
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
            Map unavailable — {mapError}
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
        aria-label={`Route position: ${positionPct}`}
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

      {/* DOM overlay: decision/proposal marker */}
      {proposalFraction !== null && (
        <div
          data-testid="decision-marker"
          aria-label="Proposal position"
          style={{
            position: 'absolute',
            bottom: '0',
            left: `${Math.round(proposalFraction * 100)}%`,
            transform: 'translateX(-50%)',
            width: '4px',
            height: '24px',
            background: '#dc2626',
            borderRadius: '2px',
            zIndex: 10,
            visibility: realMarkers ? 'hidden' : 'visible',
          }}
        />
      )}

      {/* DOM overlay: chosen rest-spot marker (gold circle) — positioned by
          route_fraction from recovery.rest_spot.  Hidden when the real SDK
          geographic marker is active (realMarkers=true). Absent entirely when
          no rest spot has been chosen.  testable under the mock (no Marker). */}
      {restSpot !== null && (
        <div
          data-testid="rest-spot-marker"
          aria-label={`Chosen rest spot: ${restSpot.label?.en ?? restSpot.id}`}
          style={{
            position: 'absolute',
            bottom: '0',
            left: `${Math.round(restSpot.route_fraction * 100)}%`,
            transform: 'translateX(-50%)',
            width: '16px',
            height: '16px',
            background: '#f0c000',
            borderRadius: '50%',
            border: '3px solid white',
            zIndex: 11,
            visibility: realMarkers ? 'hidden' : 'visible',
          }}
        />
      )}
    </div>
  )
}
