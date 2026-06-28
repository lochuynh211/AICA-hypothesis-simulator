import { useState } from 'react'
import { useRunStore } from '../../state/runStore'
import { routesAnalyze } from '../../api/client'
import { MapsError } from '../../api/types'
import type { RouteAlternative, RouteNotice } from '../../api/types'

/**
 * MapKeyAndRouteInput (T007 / M4) — BYO Maps API key + route input + alternative picker.
 *
 * - Key field: password-type input; value dispatched to SET_MAPS_KEY (in-memory only,
 *   never written to localStorage/sessionStorage/any persistence).
 * - Start/End: free-text fields for the Google Maps origin/destination.
 * - Analyze Route button: calls routesAnalyze with key + start + end when a scenario
 *   is selected; populates the store with the returned alternatives.
 * - Alternative picker: radio list showing summary, distance, and any notices.
 *   Selecting an alternative dispatches SELECT_ROUTE.
 * - 502 MapsError: surfaces the message and a "Use local route" button that clears
 *   the Maps error and falls back to the local path.
 */

const NOTICE_LABELS: Record<RouteNotice, string> = {
  no_rest_stops_found: 'No rest stops found on this route',
  rest_data_degraded: 'Rest stop data is degraded (using scenario fallback)',
  rest_data_unavailable: 'Rest stop data unavailable',
}

export default function MapKeyAndRouteInput() {
  const { state, dispatch } = useRunStore()
  const {
    selectedScenarioId,
    mapsKey,
    mapsStart,
    mapsEnd,
    alternatives,
    selectedRouteId,
    mapsError,
  } = state

  const [localKey, setLocalKey] = useState(mapsKey)
  const [analyzing, setAnalyzing] = useState(false)

  function handleKeyChange(e: React.ChangeEvent<HTMLInputElement>) {
    setLocalKey(e.target.value)
    dispatch({ type: 'SET_MAPS_KEY', key: e.target.value })
  }

  function handleStartChange(e: React.ChangeEvent<HTMLInputElement>) {
    dispatch({ type: 'SET_MAPS_ROUTE_INPUT', start: e.target.value, end: mapsEnd })
  }

  function handleEndChange(e: React.ChangeEvent<HTMLInputElement>) {
    dispatch({ type: 'SET_MAPS_ROUTE_INPUT', start: mapsStart, end: e.target.value })
  }

  async function handleAnalyze() {
    if (!selectedScenarioId) return
    setAnalyzing(true)
    dispatch({ type: 'SET_MAPS_ERROR', error: null })
    try {
      const envelope = await routesAnalyze({
        scenarioId: selectedScenarioId,
        mapsKey: mapsKey || undefined,
        start: mapsStart || undefined,
        end: mapsEnd || undefined,
      })
      dispatch({ type: 'SET_ALTERNATIVES', envelope })
      // Auto-select the first alternative when there's only one (local path)
      if (envelope.alternatives.length === 1) {
        dispatch({ type: 'SELECT_ROUTE', routeId: envelope.alternatives[0].route_id })
      }
    } catch (err: unknown) {
      if (err instanceof MapsError) {
        dispatch({ type: 'SET_MAPS_ERROR', error: err.body })
      } else {
        dispatch({
          type: 'SET_MAPS_ERROR',
          error: {
            error_type: 'UNKNOWN',
            message: err instanceof Error ? err.message : 'Route analysis failed',
            suggestion: 'Try again or use the local route fallback.',
          },
        })
      }
    } finally {
      setAnalyzing(false)
    }
  }

  function handleUseLocalRoute() {
    dispatch({ type: 'SET_MAPS_ERROR', error: null })
    // Clear key + inputs so the user can proceed with the local path via PlanPreview
    setLocalKey('')
    dispatch({ type: 'SET_MAPS_KEY', key: '' })
    dispatch({ type: 'SET_MAPS_ROUTE_INPUT', start: '', end: '' })
  }

  function handleSelectRoute(routeId: string) {
    dispatch({ type: 'SELECT_ROUTE', routeId })
  }

  return (
    <div data-testid="map-key-route-input" style={{ marginBottom: '8px' }}>
      <div style={{ marginBottom: '4px' }}>
        <label htmlFor="maps-api-key" style={{ display: 'block', fontSize: '0.8em' }}>
          Maps API Key
        </label>
        <input
          id="maps-api-key"
          type="password"
          value={localKey}
          onChange={handleKeyChange}
          placeholder="Enter Google Maps API key"
          autoComplete="off"
          style={{ width: '100%', fontSize: '0.8em', padding: '4px' }}
        />
      </div>

      <div style={{ marginBottom: '4px' }}>
        <label htmlFor="route-start" style={{ display: 'block', fontSize: '0.8em' }}>
          Start
        </label>
        <input
          id="route-start"
          type="text"
          value={mapsStart}
          onChange={handleStartChange}
          placeholder="e.g. Tokyo Station"
          style={{ width: '100%', fontSize: '0.8em', padding: '4px' }}
        />
      </div>

      <div style={{ marginBottom: '6px' }}>
        <label htmlFor="route-end" style={{ display: 'block', fontSize: '0.8em' }}>
          End
        </label>
        <input
          id="route-end"
          type="text"
          value={mapsEnd}
          onChange={handleEndChange}
          placeholder="e.g. Osaka Station"
          style={{ width: '100%', fontSize: '0.8em', padding: '4px' }}
        />
      </div>

      <button
        onClick={handleAnalyze}
        disabled={analyzing || !selectedScenarioId}
        style={{ width: '100%', padding: '6px', marginBottom: '6px' }}
      >
        {analyzing ? 'Analyzing…' : 'Analyze Route'}
      </button>

      {/* 502 Maps error */}
      {mapsError && (
        <div
          role="alert"
          data-testid="maps-error"
          style={{ background: '#fff3f3', border: '1px solid #fca5a5', borderRadius: '4px', padding: '8px', marginBottom: '6px' }}
        >
          <p style={{ margin: '0 0 6px', fontSize: '0.8em', color: '#b91c1c' }}>
            {mapsError.message}
          </p>
          {mapsError.suggestion && (
            <p style={{ margin: '0 0 6px', fontSize: '0.75em', color: '#666' }}>
              {mapsError.suggestion}
            </p>
          )}
          <button
            onClick={handleUseLocalRoute}
            style={{ fontSize: '0.8em', padding: '4px 8px' }}
          >
            Use local route
          </button>
        </div>
      )}

      {/* Alternatives list */}
      {alternatives.length > 1 && (
        <div data-testid="alternatives-list" style={{ marginTop: '6px' }}>
          <p style={{ margin: '0 0 4px', fontSize: '0.75em', color: '#555' }}>
            Select a route:
          </p>
          {alternatives.map((alt: RouteAlternative) => (
            <div
              key={alt.route_id}
              style={{
                border: selectedRouteId === alt.route_id ? '2px solid #2563eb' : '1px solid #ccc',
                borderRadius: '4px',
                padding: '6px',
                marginBottom: '4px',
                cursor: 'pointer',
              }}
            >
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="route-alternative"
                  value={alt.route_id}
                  checked={selectedRouteId === alt.route_id}
                  onChange={() => handleSelectRoute(alt.route_id)}
                  style={{ marginTop: '2px' }}
                />
                <span style={{ flex: 1 }}>
                  <strong style={{ fontSize: '0.85em' }}>{alt.summary}</strong>
                  {alt.route_facts.total_route_distance_km !== null && (
                    <span style={{ fontSize: '0.75em', color: '#666', marginLeft: '8px' }}>
                      {alt.route_facts.total_route_distance_km.toFixed(0)} km
                    </span>
                  )}
                  {alt.notices.length > 0 && (
                    <ul style={{ margin: '4px 0 0', padding: '0 0 0 16px', fontSize: '0.75em', color: '#92400e' }}>
                      {alt.notices.map((n) => (
                        <li key={n}>{NOTICE_LABELS[n] ?? n}</li>
                      ))}
                    </ul>
                  )}
                </span>
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
