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

// Note: routesAnalyze envelope behaviour (local path, maps path, 502 MapsError)
// and createRunPlan route selection fields are covered in client.test.tsx, which
// tests the real client implementation directly (no vi.mock on the client module).
