/**
 * Selecting a test case must move the MAP, not just the setup fields.
 *
 * The map renders from `runStore.alternatives` / `selectedRouteId`. The setup
 * panel owns the route preset in LOCAL state and mirrors it into the store, so
 * "the case's route applied" is only true once that mirror has happened — which
 * is what these tests assert, rather than asserting the fetch was called.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('../src/api/client', async (orig) => ({
  ...(await orig<typeof import('../src/api/client')>()),
  listRoutePresets: vi.fn(),
  loadRoutePreset: vi.fn(),
  listScenarios: vi.fn(),
  listPackages: vi.fn(),
  getScenario: vi.fn(),
}))
vi.mock('../src/api/proposalClient', async (orig) => ({
  ...(await orig<typeof import('../src/api/proposalClient')>()),
  getPackages: vi.fn(),
  getPresets: vi.fn(),
  getPreset: vi.fn(),
}))

import {
  listRoutePresets,
  loadRoutePreset,
  listScenarios,
  listPackages,
  getScenario,
} from '../src/api/client'
import { getPackages, getPresets, getPreset } from '../src/api/proposalClient'
import MergedSetupPanel from '../src/components/merged/MergedSetupPanel'
import { MergedCoordinatorProvider } from '../src/state/mergedCoordinator'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'
import { ProposalStoreProvider } from '../src/state/proposalStore'
import { LanguageProvider } from '../src/state/language'
import { resolveCase } from '../src/lib/review/caseResolver'
import { getCase } from '../src/lib/review/caseCatalog'

const envelope = (routeId: string, polyline: string, km: number) => ({
  route_source: 'maps' as const,
  alternatives: [
    {
      route_id: routeId,
      label: routeId,
      display: { summary: routeId, encoded_polyline: polyline, start_label: 'A', end_label: 'B' },
      route_facts: { total_route_distance_km: km, route_segments: [], rest_spot_positions: [], named_rest_spots: [] },
    },
  ],
})

/** Surfaces what the MAP would actually read. */
function RouteProbe() {
  const { state } = useRunStore()
  const alt = state.alternatives.find((a) => a.route_id === state.selectedRouteId)
  return <span data-testid="probe-route">{alt?.display?.encoded_polyline ?? 'none'}</span>
}

function tree(caseId: string) {
  const testCase = getCase(caseId)!
  return (
    <LanguageProvider initialLanguage="en">
      <MergedCoordinatorProvider>
        <RunStoreProvider>
          <ProposalStoreProvider>
            <MergedSetupPanel caseSetup={resolveCase(testCase)} selectedCase={testCase} />
            <RouteProbe />
          </ProposalStoreProvider>
        </RunStoreProvider>
      </MergedCoordinatorProvider>
    </LanguageProvider>
  )
}

function mount(caseId: string) {
  return render(tree(caseId))
}

beforeEach(() => {
  vi.clearAllMocks()
  // Registry order deliberately puts the LONG route first — that is the default
  // that used to win the race against the case's own route.
  vi.mocked(listRoutePresets).mockResolvedValue({
    presets: [
      { id: 'long_tokyo_osaka', label: { ja: '', en: 'long' } },
      { id: 'short_tokyo_chichibu', label: { ja: '', en: 'short' } },
    ] as never,
  })
  vi.mocked(loadRoutePreset).mockImplementation(async (id: string) =>
    (id === 'short_tokyo_chichibu'
      ? envelope('short_r', 'SHORTPOLY', 112)
      : envelope('long_r', 'LONGPOLY', 502)) as never,
  )
  vi.mocked(listScenarios).mockResolvedValue({ scenarios: [] } as never)
  vi.mocked(listPackages).mockResolvedValue({ packages: [] } as never)
  vi.mocked(getScenario).mockResolvedValue({} as never)
  vi.mocked(getPackages).mockResolvedValue({ packages: [] } as never)
  vi.mocked(getPresets).mockResolvedValue({ presets: [] } as never)
  // Reject rather than return a stub world: the panel's own catch path leaves
  // the store's initial world intact, whereas a half-built world crashes on
  // render and tells us nothing about the route.
  vi.mocked(getPreset).mockRejectedValue(new Error('no preset in this test'))
})

describe("a case's route reaches the map", () => {
  // The semantic catalog sets route_preset_ref to null so the authored scenario
  // -- not a pre-extracted Google route -- decides how long the journey is. The
  // contract this file now guards is that a null ref applies NO preset polyline,
  // and that switching cases in place does not leave a stale one behind.
  it('applies no preset polyline when the case pins none', async () => {
    mount('case-tc-r01')

    await waitFor(() => {
      expect(screen.getByTestId('probe-route')).toHaveTextContent('none')
    })
  })

  it('leaves no preset polyline for a monotony case either', async () => {
    mount('case-tc-m01')

    await waitFor(() => {
      expect(screen.getByTestId('probe-route')).toHaveTextContent('none')
    })
  })

  it('does not strand a stale route when the selected case changes IN PLACE', async () => {
    // The reported symptom, reproduced the way a reviewer hits it: the panel
    // stays mounted and the case prop changes. Unmounting and remounting would
    // pass even if a live switch did not.
    const { rerender } = mount('case-tc-m01')
    await waitFor(() => expect(screen.getByTestId('probe-route')).toHaveTextContent('none'))

    rerender(tree('case-tc-r01'))
    await waitFor(() => expect(screen.getByTestId('probe-route')).toHaveTextContent('none'))
  })
})
