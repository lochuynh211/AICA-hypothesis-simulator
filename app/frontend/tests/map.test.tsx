/**
 * M4 — Frontend: MapSurface (T008) + MapKeyAndRouteInput (T007) + envelope migration
 *
 * Tests:
 *  MapSurface:
 *    (a) renders nothing when no alternative is selected
 *    (b) renders nothing when selected alternative has display === null (local path)
 *    (c) renders car-marker from route_fraction when display is present
 *    (d) places car-marker aria-label reflecting the current fraction percentage
 *    (e) renders decision-marker when a proposal has fired
 *    (f) mapsKey is never written to localStorage or sessionStorage
 *
 *  MapKeyAndRouteInput:
 *    (g) renders key/start/end inputs and an "Analyze Route" button
 *    (h) calls routesAnalyze with { scenarioId, mapsKey, start, end }
 *    (i) lists returned alternatives after a successful analyze
 *    (j) selecting an alternative dispatches SELECT_ROUTE
 *    (k) shows notice labels for routes with notices
 *    (l) shows the 502 error message and a "Use local route" button on MapsError
 *
 *  Envelope integration:
 *    (m) routesAnalyze returns RouteEnvelope for the local path
 *    (n) routesAnalyze returns RouteEnvelope for the maps path
 *    (o) routesAnalyze throws MapsError on 502
 *    (p) createRunPlan passes route selection fields to /api/run-plans
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'
import type { RunStoreAction } from '../src/state/runStore'
import type { DecisionResult } from '../src/api/types'
import type { RouteEnvelope, MapsErrorBody } from '../src/api/types'
// MapsError is a runtime class (not a type) — import separately so it isn't erased
import { MapsError } from '../src/api/types'

// ── Google Maps mock ──────────────────────────────────────────────────────────

function setupGoogleMapsMock() {
  const mockMap = { fitBounds: vi.fn(), setCenter: vi.fn(), setZoom: vi.fn() }
  const mockPolyline = { setMap: vi.fn(), setPath: vi.fn() }
  const decodePath = vi.fn().mockReturnValue([
    { lat: () => 35.0, lng: () => 135.0 },
    { lat: () => 35.5, lng: () => 135.5 },
  ])

  const mockMaps = {
    Map: vi.fn().mockReturnValue(mockMap),
    Polyline: vi.fn().mockReturnValue(mockPolyline),
    LatLng: vi.fn().mockImplementation((lat: number, lng: number) => ({ lat: () => lat, lng: () => lng })),
    LatLngBounds: vi.fn().mockReturnValue({ extend: vi.fn() }),
    geometry: { encoding: { decodePath } },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).google = { maps: mockMaps }
  return { mockMaps, mockMap, mockPolyline, decodePath }
}

// ── Mock the client module ────────────────────────────────────────────────────

vi.mock('../src/api/client', () => ({
  listPackages: vi.fn(),
  listScenarios: vi.fn(),
  createRun: vi.fn(),
  createRunPlan: vi.fn(),
  regenerateRunPlan: vi.fn(),
  routesAnalyze: vi.fn(),
  actRun: vi.fn(),
  tickRun: vi.fn(),
  getPackage: vi.fn(),
  getScenario: vi.fn(),
  listRuns: vi.fn(),
  getRun: vi.fn(),
  getRunLog: vi.fn(),
  getHealth: vi.fn(),
}))

import * as client from '../src/api/client'
import MapSurface from '../src/components/map/MapSurface'
import MapKeyAndRouteInput from '../src/components/setup/MapKeyAndRouteInput'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TEST_POLYLINE = '_p~iF~ps|U_ulLnnqC_mqNvxq`@'

const localEnvelope: RouteEnvelope = {
  route_source: 'local',
  alternatives: [
    {
      route_id: 'local',
      summary: 'test-scenario',
      route_facts: {
        total_route_distance_km: 120,
        estimated_route_duration_min: 120,
        route_segments: [],
        rest_spot_positions: [],
        route_progress_checkpoints: [],
      },
      display: null,
      notices: [],
    },
  ],
}

const mapsEnvelope: RouteEnvelope = {
  route_source: 'maps',
  alternatives: [
    {
      route_id: 'route-0',
      summary: 'Via Highway A',
      route_facts: {
        total_route_distance_km: 200,
        estimated_route_duration_min: 150,
        route_segments: [],
        rest_spot_positions: [50, 120],
        route_progress_checkpoints: [],
      },
      display: { encoded_polyline: TEST_POLYLINE, viewport: null },
      notices: [],
    },
    {
      route_id: 'route-1',
      summary: 'Via City Center',
      route_facts: {
        total_route_distance_km: 180,
        estimated_route_duration_min: 200,
        route_segments: [],
        rest_spot_positions: [60],
        route_progress_checkpoints: [],
      },
      display: { encoded_polyline: TEST_POLYLINE, viewport: null },
      notices: ['no_rest_stops_found'],
    },
  ],
}

const runStateWithTicks = {
  run_id: 'run-map-001',
  status: 'playing' as const,
  current_tick: 2,
  pending_proposal: null,
  package_runtime_state: {},
  snapshot: {
    package: { id: 'pkg1', version: '0.1.0', hash: 'a' },
    scenario: { id: 'scen1', version: '0.1.0', hash: 'b' },
  },
  event_plan: {
    ticks: [
      { tick_index: 0, route_fraction: 0.0 },
      { tick_index: 1, route_fraction: 0.25 },
      { tick_index: 2, route_fraction: 0.5 },
    ],
  },
  route_facts: {},
}

const noTriggerDecision: DecisionResult = {
  result_type: 'NO_TRIGGER',
  trigger_candidate: false,
  selected_category: null,
  score: null,
  features: {},
  scores: {},
  states: {},
  criteria: {},
  candidates: [],
  fire_control: { fired: false, suppressed: false, override: false, reason: null },
  proposal: null,
  reason_inputs: [],
  explanation: 'No trigger',
  next_package_runtime_state: {},
}

const proposalDecision: DecisionResult = {
  ...noTriggerDecision,
  result_type: 'REST_PROPOSAL',
  proposal: {
    id: 'rest_guidance',
    message: { ja: '休憩', en: 'Take a rest' },
    options: ['accept_rest', 'postpone'],
  },
  fire_control: { fired: true, suppressed: false, override: false, reason: null },
}

// ── Store helper ──────────────────────────────────────────────────────────────

function renderInStore(
  ui: React.ReactElement,
  setupFn?: (dispatch: React.Dispatch<RunStoreAction>) => void,
) {
  const dispatchRef: { current: React.Dispatch<RunStoreAction> | null } = { current: null }

  function DispatchCapture() {
    const { dispatch } = useRunStore()
    dispatchRef.current = dispatch
    return null
  }

  const result = render(
    <RunStoreProvider>
      <DispatchCapture />
      {ui}
    </RunStoreProvider>,
  )

  if (setupFn && dispatchRef.current) {
    act(() => setupFn(dispatchRef.current!))
  }

  return result
}

// ── MapSurface tests ──────────────────────────────────────────────────────────

describe('MapSurface', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setupGoogleMapsMock()
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).google
  })

  it('(a) renders nothing when no route alternative is selected', () => {
    const { container } = renderInStore(<MapSurface />)
    expect(container.querySelector('[data-testid="map-surface"]')).toBeNull()
  })

  it('(b) renders nothing when selected alternative has display === null (local path)', () => {
    const { container } = renderInStore(<MapSurface />, (dispatch) => {
      dispatch({ type: 'SET_ALTERNATIVES', envelope: localEnvelope })
      dispatch({ type: 'SELECT_ROUTE', routeId: 'local' })
    })
    expect(container.querySelector('[data-testid="map-surface"]')).toBeNull()
  })

  it('(c) renders map-surface and car-marker when a maps alternative with display is selected', () => {
    renderInStore(<MapSurface />, (dispatch) => {
      dispatch({ type: 'SET_MAPS_KEY', key: 'test-key' })
      dispatch({ type: 'SET_ALTERNATIVES', envelope: mapsEnvelope })
      dispatch({ type: 'SELECT_ROUTE', routeId: 'route-0' })
      dispatch({ type: 'RUN_CREATED', runState: runStateWithTicks })
      dispatch({
        type: 'TICK_APPENDED',
        runState: runStateWithTicks,
        decision: noTriggerDecision,
        tickIndex: 1,
        paused: false,
        completed: false,
      })
    })

    expect(screen.getByTestId('map-surface')).toBeInTheDocument()
    expect(screen.getByTestId('car-marker')).toBeInTheDocument()
  })

  it('(d) car-marker aria-label reflects the current route_fraction percentage', () => {
    renderInStore(<MapSurface />, (dispatch) => {
      dispatch({ type: 'SET_MAPS_KEY', key: 'test-key' })
      dispatch({ type: 'SET_ALTERNATIVES', envelope: mapsEnvelope })
      dispatch({ type: 'SELECT_ROUTE', routeId: 'route-0' })
      dispatch({ type: 'RUN_CREATED', runState: runStateWithTicks })
      // tick_index=1 → route_fraction=0.25 → 25%
      dispatch({
        type: 'TICK_APPENDED',
        runState: runStateWithTicks,
        decision: noTriggerDecision,
        tickIndex: 1,
        paused: false,
        completed: false,
      })
    })

    const carMarker = screen.getByTestId('car-marker')
    expect(carMarker).toHaveAttribute('aria-label', expect.stringContaining('25%'))
  })

  it('(e) renders decision-marker when a proposal has fired', () => {
    renderInStore(<MapSurface />, (dispatch) => {
      dispatch({ type: 'SET_MAPS_KEY', key: 'test-key' })
      dispatch({ type: 'SET_ALTERNATIVES', envelope: mapsEnvelope })
      dispatch({ type: 'SELECT_ROUTE', routeId: 'route-0' })
      dispatch({ type: 'RUN_CREATED', runState: runStateWithTicks })
      // tick_index=2 → route_fraction=0.5, with a proposal
      dispatch({
        type: 'TICK_APPENDED',
        runState: runStateWithTicks,
        decision: proposalDecision,
        tickIndex: 2,
        paused: true,
        completed: false,
      })
    })

    expect(screen.getByTestId('decision-marker')).toBeInTheDocument()
  })

  it('(f) mapsKey is never written to localStorage or sessionStorage', () => {
    renderInStore(<MapSurface />, (dispatch) => {
      dispatch({ type: 'SET_MAPS_KEY', key: 'super-secret-api-key-12345' })
      dispatch({ type: 'SET_ALTERNATIVES', envelope: mapsEnvelope })
      dispatch({ type: 'SELECT_ROUTE', routeId: 'route-0' })
    })

    const lsContents = JSON.stringify(
      Object.keys(localStorage).map((k) => `${k}=${localStorage.getItem(k)}`),
    )
    const ssContents = JSON.stringify(
      Object.keys(sessionStorage).map((k) => `${k}=${sessionStorage.getItem(k)}`),
    )

    expect(lsContents).not.toContain('super-secret-api-key-12345')
    expect(ssContents).not.toContain('super-secret-api-key-12345')
  })
})

// ── MapKeyAndRouteInput tests ─────────────────────────────────────────────────

describe('MapKeyAndRouteInput', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('(g) renders Maps API key, start, and end inputs and the Analyze Route button', () => {
    renderInStore(<MapKeyAndRouteInput />)
    expect(screen.getByLabelText(/maps api key/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^start/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^end/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /analyze route/i })).toBeInTheDocument()
  })

  it('(h) calls routesAnalyze with { scenarioId, mapsKey, start, end }', async () => {
    vi.mocked(client.routesAnalyze).mockResolvedValue(mapsEnvelope)

    renderInStore(
      <MapKeyAndRouteInput />,
      (dispatch) => {
        dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
      },
    )

    fireEvent.change(screen.getByLabelText(/maps api key/i), { target: { value: 'my-key' } })
    fireEvent.change(screen.getByLabelText(/^start/i), { target: { value: 'Tokyo' } })
    fireEvent.change(screen.getByLabelText(/^end/i), { target: { value: 'Osaka' } })
    fireEvent.click(screen.getByRole('button', { name: /analyze route/i }))

    await waitFor(() => {
      expect(vi.mocked(client.routesAnalyze)).toHaveBeenCalledWith({
        scenarioId: 'uc01_fatigue_friend_drive_v0_1',
        mapsKey: 'my-key',
        start: 'Tokyo',
        end: 'Osaka',
      })
    })
  })

  it('(i) lists alternatives returned by the analyze call', async () => {
    vi.mocked(client.routesAnalyze).mockResolvedValue(mapsEnvelope)

    renderInStore(
      <MapKeyAndRouteInput />,
      (dispatch) => {
        dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
      },
    )

    fireEvent.change(screen.getByLabelText(/maps api key/i), { target: { value: 'my-key' } })
    fireEvent.change(screen.getByLabelText(/^start/i), { target: { value: 'Tokyo' } })
    fireEvent.change(screen.getByLabelText(/^end/i), { target: { value: 'Osaka' } })
    fireEvent.click(screen.getByRole('button', { name: /analyze route/i }))

    await screen.findByText(/Via Highway A/)
    expect(screen.getByText(/Via City Center/)).toBeInTheDocument()
  })

  it('(j) selecting an alternative dispatches SELECT_ROUTE with the right routeId', async () => {
    vi.mocked(client.routesAnalyze).mockResolvedValue(mapsEnvelope)

    let capturedRouteId: string | null = null

    function RouteIdCapture() {
      const { state } = useRunStore()
      capturedRouteId = state.selectedRouteId
      return null
    }

    renderInStore(
      <>
        <RouteIdCapture />
        <MapKeyAndRouteInput />
      </>,
      (dispatch) => {
        dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
      },
    )

    fireEvent.change(screen.getByLabelText(/maps api key/i), { target: { value: 'my-key' } })
    fireEvent.change(screen.getByLabelText(/^start/i), { target: { value: 'Tokyo' } })
    fireEvent.change(screen.getByLabelText(/^end/i), { target: { value: 'Osaka' } })
    fireEvent.click(screen.getByRole('button', { name: /analyze route/i }))

    await screen.findByText(/Via Highway A/)

    const radios = screen.getAllByRole('radio')
    fireEvent.click(radios[1]) // select second alternative (route-1)

    await waitFor(() => {
      expect(capturedRouteId).toBe('route-1')
    })
  })

  it('(k) shows a notice label for alternatives that have notices', async () => {
    vi.mocked(client.routesAnalyze).mockResolvedValue(mapsEnvelope)

    renderInStore(
      <MapKeyAndRouteInput />,
      (dispatch) => {
        dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
      },
    )

    fireEvent.change(screen.getByLabelText(/maps api key/i), { target: { value: 'my-key' } })
    fireEvent.change(screen.getByLabelText(/^start/i), { target: { value: 'Tokyo' } })
    fireEvent.change(screen.getByLabelText(/^end/i), { target: { value: 'Osaka' } })
    fireEvent.click(screen.getByRole('button', { name: /analyze route/i }))

    await screen.findByText(/Via City Center/)
    // The 'no_rest_stops_found' notice should be surfaced
    expect(screen.getByText(/no rest stops found/i)).toBeInTheDocument()
  })

  it('(l) shows 502 error message and a "Use local route" button on MapsError', async () => {
    const errorBody: MapsErrorBody = {
      error_type: 'DIRECTIONS_ERROR',
      message: 'Google Maps API request failed',
      suggestion: 'Check your API key or use the local route fallback.',
    }
    vi.mocked(client.routesAnalyze).mockRejectedValue(new MapsError(errorBody))

    renderInStore(
      <MapKeyAndRouteInput />,
      (dispatch) => {
        dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
      },
    )

    fireEvent.change(screen.getByLabelText(/maps api key/i), { target: { value: 'bad-key' } })
    fireEvent.change(screen.getByLabelText(/^start/i), { target: { value: 'Tokyo' } })
    fireEvent.change(screen.getByLabelText(/^end/i), { target: { value: 'Osaka' } })
    fireEvent.click(screen.getByRole('button', { name: /analyze route/i }))

    await screen.findByText(/Google Maps API request failed/)
    expect(screen.getByRole('button', { name: /use local route/i })).toBeInTheDocument()
  })
})

// ── I2 regression: async Maps script load triggers canvas init ───────────────

describe('MapSurface — async script load (I2 regression)', () => {
  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).google
    delete (window as Record<string, unknown>).__aicaHypSimMapsInit
  })

  it('(q) initializes the Maps canvas after the global init callback fires (no pre-loaded SDK)', async () => {
    // Ensure google.maps is NOT available at mount time.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).google

    renderInStore(<MapSurface />, (dispatch) => {
      dispatch({ type: 'SET_MAPS_KEY', key: 'test-key' })
      dispatch({ type: 'SET_ALTERNATIVES', envelope: mapsEnvelope })
      dispatch({ type: 'SELECT_ROUTE', routeId: 'route-0' })
    })

    // Component renders the surface (display is non-null) but Map is not yet initialized.
    expect(screen.getByTestId('map-surface')).toBeInTheDocument()

    // Now install the Google Maps mock and fire the global init callback,
    // simulating the async script load completing.
    const { mockMaps } = setupGoogleMapsMock()

    await act(async () => {
      const cb = (window as Record<string, unknown>).__aicaHypSimMapsInit as
        | (() => void)
        | undefined
      expect(cb).toBeDefined()
      cb?.()
    })

    // After setMapsReady(true) triggers a re-render, the map-init effect should
    // have run and constructed the Google Maps instance.
    await waitFor(() => {
      expect(mockMaps.Map).toHaveBeenCalled()
    })
  })
})

// ── I3 regression: Maps SDK auth failure / init failure causes UI freeze ────────
//
// Root cause: MapSurface had no `window.gm_authfailure` handler registered and no
// try-catch in the canvas-init effect.  When the Maps SDK detects an invalid or
// domain-restricted key it either:
//   (a) calls `window.gm_authfailure()` — if undefined the SDK falls back to
//       rendering a full-page blocking dialog (`position:fixed; z-index:9999999`)
//       that intercepts ALL clicks → "can't press any button" freeze.
//   (b) the `new gmaps.Map()` constructor itself throws → uncaught React-effect
//       error → React dev overlay covers the page → same symptom + no animation.
//
// The fix registers `gm_authfailure` BEFORE injecting the script (so the SDK
// never reaches its blocking overlay path) and wraps the canvas init in a
// try-catch so constructor errors degrade gracefully instead of crashing.

describe('MapSurface — I3 regression: Maps SDK auth failure causes UI freeze', () => {
  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).google
    delete (window as Record<string, unknown>).__aicaHypSimMapsInit
    delete (window as Record<string, unknown>).gm_authfailure
  })

  it(
    '(r) registers gm_authfailure BEFORE injecting the Maps script ' +
      'so the SDK never shows its blocking overlay',
    () => {
      // Ensure google.maps is NOT available at mount time (script not yet loaded).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).google
      delete (window as Record<string, unknown>).gm_authfailure

      renderInStore(<MapSurface />, (dispatch) => {
        dispatch({ type: 'SET_MAPS_KEY', key: 'invalid-key' })
        dispatch({ type: 'SET_ALTERNATIVES', envelope: mapsEnvelope })
        dispatch({ type: 'SELECT_ROUTE', routeId: 'route-0' })
      })

      // gm_authfailure MUST be a function after mount.
      // Without the fix it is undefined, allowing the Maps SDK to render
      // its full-page blocking dialog instead of calling our handler.
      expect(typeof (window as Record<string, unknown>).gm_authfailure).toBe('function')
    },
  )

  it(
    '(s) calling gm_authfailure shows an inline error and keeps controls interactive',
    async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).google
      delete (window as Record<string, unknown>).gm_authfailure

      renderInStore(<MapSurface />, (dispatch) => {
        dispatch({ type: 'SET_MAPS_KEY', key: 'invalid-key' })
        dispatch({ type: 'SET_ALTERNATIVES', envelope: mapsEnvelope })
        dispatch({ type: 'SELECT_ROUTE', routeId: 'route-0' })
      })

      // map-surface is in the DOM (display is non-null)
      expect(screen.getByTestId('map-surface')).toBeInTheDocument()

      // Simulate the Maps SDK detecting auth failure and calling our handler
      const authFailureHandler = (window as Record<string, unknown>).gm_authfailure as
        | (() => void)
        | undefined
      expect(authFailureHandler).toBeDefined()

      await act(async () => {
        authFailureHandler?.()
      })

      // Component must show an inline error — NOT crash or go blank
      expect(screen.getByTestId('map-init-error')).toBeInTheDocument()
      // Car marker still rendered so animation position still tracks
      expect(screen.getByTestId('car-marker')).toBeInTheDocument()
      // No map canvas (avoids SDK injecting its overlay inside the container)
      expect(screen.queryByTestId('map-container')).not.toBeInTheDocument()
    },
  )

  it(
    '(t) Maps constructor throwing does NOT propagate as uncaught error ' +
      '(no React dev overlay / page freeze)',
    async () => {
      // Maps SDK is present BUT Map constructor throws (e.g. SDK-level auth error)
      // In the current code this throws out of useEffect → React dev error overlay
      // covers the viewport → "can't press any button" + "no animation".
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).google = {
        maps: {
          Map: vi.fn().mockImplementation(() => {
            throw new Error('InvalidKey: Google Maps API key is not authorized.')
          }),
          Polyline: vi.fn().mockReturnValue({ setMap: vi.fn() }),
          geometry: {
            encoding: {
              decodePath: vi.fn().mockReturnValue([
                { lat: () => 35.0, lng: () => 135.0 },
                { lat: () => 35.5, lng: () => 135.5 },
              ]),
            },
          },
        },
      }

      // Render — MUST NOT throw or propagate an unhandled error
      renderInStore(<MapSurface />, (dispatch) => {
        dispatch({ type: 'SET_MAPS_KEY', key: 'invalid-key' })
        dispatch({ type: 'SET_ALTERNATIVES', envelope: mapsEnvelope })
        dispatch({ type: 'SELECT_ROUTE', routeId: 'route-0' })
      })

      // map-surface must remain in the DOM (React tree did NOT crash)
      expect(screen.getByTestId('map-surface')).toBeInTheDocument()

      // An inline error indicator must appear so the user understands the map is broken
      expect(await screen.findByTestId('map-init-error')).toBeInTheDocument()

      // Car marker is still rendered — route position animation is NOT lost
      expect(screen.getByTestId('car-marker')).toBeInTheDocument()
    },
  )

  it(
    '(u) gm_authfailure is removed from window after unmount on the already-loaded path',
    () => {
      // Google Maps is already present at mount time — the effect hits the
      // early-return ("already loaded") branch.  Before Fix 1 that path had no
      // cleanup so the handler lingered on window after unmount.
      setupGoogleMapsMock()

      const { unmount } = renderInStore(<MapSurface />, (dispatch) => {
        dispatch({ type: 'SET_MAPS_KEY', key: 'test-key' })
        dispatch({ type: 'SET_ALTERNATIVES', envelope: mapsEnvelope })
        dispatch({ type: 'SELECT_ROUTE', routeId: 'route-0' })
      })

      // Handler must be registered while the component is mounted.
      expect(typeof (window as Record<string, unknown>).gm_authfailure).toBe('function')

      // After unmount the effect cleanup (authCleanup) must delete it.
      unmount()
      expect((window as Record<string, unknown>).gm_authfailure).toBeUndefined()
    },
  )

  it(
    '(v) a new valid key after an error clears the stale error and renders the map container',
    async () => {
      // Start without Google Maps so the script-injection path runs.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).google
      delete (window as Record<string, unknown>).gm_authfailure

      // We need a dispatch reference accessible after initial render so we can
      // simulate the user entering a new valid key.
      let capturedDispatch: React.Dispatch<RunStoreAction> | null = null
      function CaptureDispatch() {
        const { dispatch } = useRunStore()
        capturedDispatch = dispatch
        return null
      }

      const { RunStoreProvider: Provider } = await import('../src/state/runStore')

      render(
        <Provider>
          <CaptureDispatch />
          <MapSurface />
        </Provider>,
      )

      act(() => {
        capturedDispatch!({ type: 'SET_MAPS_KEY', key: 'bad-key' })
        capturedDispatch!({ type: 'SET_ALTERNATIVES', envelope: mapsEnvelope })
        capturedDispatch!({ type: 'SELECT_ROUTE', routeId: 'route-0' })
      })

      // Simulate the Maps SDK calling our auth-failure handler.
      const authFailureHandler = (window as Record<string, unknown>).gm_authfailure as
        | (() => void)
        | undefined
      expect(authFailureHandler).toBeDefined()
      await act(async () => { authFailureHandler?.() })

      // Confirm the stale error banner is showing.
      expect(screen.getByTestId('map-init-error')).toBeInTheDocument()
      expect(screen.queryByTestId('map-container')).not.toBeInTheDocument()

      // Install the valid Google Maps mock and switch to a new valid key.
      // The mapsKey change reruns the effect which calls setMapError(null) first.
      setupGoogleMapsMock()
      await act(async () => {
        capturedDispatch!({ type: 'SET_MAPS_KEY', key: 'valid-key' })
      })

      // The stale error banner must be gone and the map canvas must appear.
      await waitFor(() => {
        expect(screen.queryByTestId('map-init-error')).not.toBeInTheDocument()
        expect(screen.getByTestId('map-container')).toBeInTheDocument()
      })
    },
  )
})

// ── T011: rest-spot marker ────────────────────────────────────────────────────

describe('MapSurface — T011: rest-spot marker', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setupGoogleMapsMock()
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).google
  })

  it('(w) renders rest-spot-marker for an accepted rest in restHistory', () => {
    renderInStore(<MapSurface />, (dispatch) => {
      dispatch({ type: 'SET_MAPS_KEY', key: 'test-key' })
      dispatch({ type: 'SET_ALTERNATIVES', envelope: mapsEnvelope })
      dispatch({ type: 'SELECT_ROUTE', routeId: 'route-0' })
      dispatch({ type: 'RUN_CREATED', runState: runStateWithTicks })
      // Marker now persists from restHistory (captured at accept time), so it
      // survives after recovery ends rather than vanishing with recovery state.
      dispatch({
        type: 'ACTION_APPLIED',
        runState: runStateWithTicks,
        action: 'accept_rest',
        restChoice: {
          tickIndex: 1,
          optionId: 'rest_short',
          optionLabel: { ja: '短い休憩', en: 'Short Rest' },
          spot: {
            id: 'spot-1',
            label: { ja: '道の駅', en: 'Rest Area' },
            lat: 35.2,
            lng: 135.2,
            route_fraction: 0.6,
          },
        },
      })
    })

    const marker = screen.getByTestId('rest-spot-marker')
    expect(marker).toBeInTheDocument()
    // Positioned at 60% (route_fraction=0.6)
    expect(marker).toHaveStyle({ left: '60%' })
  })

  it('(x) does not render rest-spot-marker when recovery.rest_spot is absent', () => {
    renderInStore(<MapSurface />, (dispatch) => {
      dispatch({ type: 'SET_MAPS_KEY', key: 'test-key' })
      dispatch({ type: 'SET_ALTERNATIVES', envelope: mapsEnvelope })
      dispatch({ type: 'SELECT_ROUTE', routeId: 'route-0' })
      dispatch({ type: 'RUN_CREATED', runState: runStateWithTicks })
    })

    expect(screen.queryByTestId('rest-spot-marker')).not.toBeInTheDocument()
  })
})

// Note: routesAnalyze envelope behaviour (local path, maps path, 502 MapsError)
// and createRunPlan route selection fields are covered in client.test.tsx, which
// tests the real client implementation directly (no vi.mock on the client module).

// ── Road-class colored polyline ──────────────────────────────────────────────

describe('MapSurface — road-class colored polyline', () => {
  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).google
  })

  it('(y) draws one Polyline per route_segment with the correct road-class strokeColor', () => {
    const decodePath = vi.fn().mockReturnValue([
      { lat: () => 35.0, lng: () => 135.0 },
      { lat: () => 35.3, lng: () => 135.3 },
      { lat: () => 35.6, lng: () => 135.6 },
    ])
    // Mock spherical so buildCumulative + slicePath work
    const computeDistanceBetween = vi.fn().mockReturnValue(30000) // 30 km each leg
    const interpolate = vi.fn().mockImplementation((a: any, _b: any, _t: number) => a)

    const mockPolyline = { setMap: vi.fn() }
    const mockMaps = {
      Map: vi.fn().mockReturnValue({ fitBounds: vi.fn() }),
      Polyline: vi.fn().mockReturnValue(mockPolyline),
      LatLngBounds: vi.fn().mockReturnValue({ extend: vi.fn() }),
      geometry: {
        encoding: { decodePath },
        spherical: { computeDistanceBetween, interpolate },
      },
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).google = { maps: mockMaps }

    const colorEnvelope: RouteEnvelope = {
      route_source: 'maps',
      alternatives: [
        {
          route_id: 'route-color',
          summary: 'Colored Route',
          route_facts: {
            total_route_distance_km: 60,
            estimated_route_duration_min: 60,
            route_segments: [
              { segment_type: 'normal_road', start_km: 0, length_km: 30 },
              { segment_type: 'highway', start_km: 30, length_km: 30 },
            ],
            rest_spot_positions: [],
            route_progress_checkpoints: [],
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          display: { encoded_polyline: TEST_POLYLINE } as any,
          notices: [],
        },
      ],
    }

    renderInStore(<MapSurface />, (dispatch) => {
      dispatch({ type: 'SET_MAPS_KEY', key: 'test-key' })
      dispatch({ type: 'SET_ALTERNATIVES', envelope: colorEnvelope })
      dispatch({ type: 'SELECT_ROUTE', routeId: 'route-color' })
    })

    // 2 Polylines (one per segment), not 1
    expect(mockMaps.Polyline).toHaveBeenCalledTimes(2)
    // First: normal_road → blue #2563eb
    expect(mockMaps.Polyline).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ strokeColor: '#2563eb' }),
    )
    // Second: highway → cyan #06b6d4
    expect(mockMaps.Polyline).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ strokeColor: '#06b6d4' }),
    )
  })
})
