import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'
import MapKeyAndRouteInput from '../src/components/setup/MapKeyAndRouteInput'
import type { RouteEnvelope } from '../src/api/types'

vi.mock('../src/api/client', () => ({
  routesAnalyze: vi.fn(),
  listRoutePresets: vi.fn(() => Promise.resolve({ presets: [] })),
  loadRoutePreset: vi.fn(),
}))

import * as client from '../src/api/client'

const mapsEnvelope: RouteEnvelope = {
  route_source: 'maps',
  alternatives: [
    {
      route_id: 'route-0',
      summary: 'Via Highway',
      route_facts: {
        total_route_distance_km: 200,
        estimated_route_duration_min: 150,
        route_segments: [],
        rest_spot_positions: [],
        route_progress_checkpoints: [],
      },
      display: { encoded_polyline: 'abc', viewport: null },
      notices: [],
    },
    {
      route_id: 'route-1',
      summary: 'Via Local Roads',
      route_facts: {
        total_route_distance_km: 180,
        estimated_route_duration_min: 180,
        route_segments: [],
        rest_spot_positions: [],
        route_progress_checkpoints: [],
      },
      display: { encoded_polyline: 'def', viewport: null },
      notices: [],
    },
  ],
}

function StateProbe() {
  const { state } = useRunStore()
  return <div data-testid="state-probe" data-selected-route-id={state.selectedRouteId ?? ''} />
}

describe('MapKeyAndRouteInput', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(client.listRoutePresets).mockResolvedValue({ presets: [] })
  })

  it('selects the first real Maps alternative after search so the next setup step unlocks', async () => {
    vi.mocked(client.routesAnalyze).mockResolvedValue(mapsEnvelope)

    render(
      <RunStoreProvider>
        <MapKeyAndRouteInput />
        <StateProbe />
      </RunStoreProvider>,
    )

    fireEvent.change(screen.getByLabelText(/Maps API Key/i), { target: { value: 'SECRET' } })
    fireEvent.click(screen.getByRole('button', { name: /Analyze Route/i }))

    await waitFor(() => {
      expect(screen.getByTestId('state-probe')).toHaveAttribute('data-selected-route-id', 'route-0')
    })
    expect(screen.getByRole('radio', { name: /Via Highway/i })).toBeChecked()
  })
})
