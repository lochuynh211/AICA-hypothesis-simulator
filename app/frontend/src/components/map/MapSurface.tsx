import { useEffect, useRef, useState } from 'react'
import { useRunStore } from '../../state/runStore'
import type { TraceEntry } from '../../api/types'

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

export default function MapSurface() {
  const { state } = useRunStore()
  const { mapsKey, alternatives, selectedRouteId, trace, runState } = state

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

  // ── Compute car position (identical logic to RouteTimeline) ───────────────
  const ep = runState?.event_plan as { ticks?: Array<{ route_fraction: number }> } | undefined
  const lastEntry: TraceEntry | null = trace.length > 0 ? trace[trace.length - 1] : null
  const currentFraction = ep?.ticks?.[lastEntry?.tick_index ?? 0]?.route_fraction ?? 0
  const positionPct = `${Math.round(currentFraction * 100)}%`

  // ── Compute proposal position ─────────────────────────────────────────────
  const proposalEntry = trace.find((e: TraceEntry) => e.proposal !== null)
  const proposalFraction = proposalEntry
    ? (ep?.ticks?.[proposalEntry.tick_index]?.route_fraction ?? null)
    : null

  // ── Google Maps script injection ──────────────────────────────────────────
  // Only inject when we have a key, a display, and Maps is not already loaded.
  useEffect(() => {
    if (!display || !mapsKey) return

    // I3 fix: register gm_authfailure BEFORE injecting the script so the SDK
    // calls our handler instead of rendering its full-page blocking overlay.
    // When the Maps SDK detects an invalid/domain-restricted key it looks for
    // window.gm_authfailure; if found it calls it; if not it falls back to its
    // built-in modal dialog that captures all pointer events (UI freeze).
    ;(window as Record<string, unknown>)['gm_authfailure'] = () => {
      setMapError(
        'Google Maps authorization failed. Verify your API key and domain restrictions.',
      )
    }

    if (getGMaps()?.geometry?.encoding) return // already loaded

    const callbackName = '__aicaHypSimMapsInit'
    const scriptId = 'aica-hyp-sim-gmaps-script'

    if (document.getElementById(scriptId)) return // injection already in progress

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
      delete (window as Record<string, unknown>)['gm_authfailure']
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
    } catch (err) {
      // Canvas initialization failed — show inline fallback instead of propagating.
      // Car and decision markers still work; only the actual map canvas is missing.
      console.error('[MapSurface] Maps canvas init failed:', err)
      setMapError(err instanceof Error ? err.message : 'Map initialization failed')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapsReady, display?.encoded_polyline])

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
            height: '280px',
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
          style={{ height: '280px', background: '#e8e8e8', borderRadius: '4px' }}
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
          }}
        />
      )}
    </div>
  )
}
