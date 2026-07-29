/**
 * The map must hand over from the PROJECTION to the live run.
 *
 * `MapSurface` grew a `playback` prop for this, but the centre panel did not
 * pass it — so `playback` stayed `false` for the whole animation and the map
 * kept drawing the projected triggers/rest spots. Accepting a rest spot never
 * changed what the map showed.
 *
 * This asserts the WIRING (the prop the centre panel hands down), which is
 * exactly what was missing; `map.test.tsx` covers what MapSurface does with it.
 */
import { render, screen, act, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('../src/api/mergedClient', () => ({
  createMergedRun: vi.fn(),
  tickMergedRun: vi.fn(),
  mergedProposalAction: vi.fn(),
  mergedQuickview: vi.fn(),
}))

// A probe standing in for the real canvas: it publishes the props it received.
vi.mock('../src/components/map/MapSurface', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="map-probe" data-playback={String(props.playback)}>
      <button
        type="button"
        data-testid="map-probe-fire-0"
        onClick={() => (props.onFireMarkerClick as (i: number) => void)?.(0)}
      >
        fire 0
      </button>
    </div>
  ),
}))

import { createMergedRun, tickMergedRun } from '../src/api/mergedClient'
import { MergedCoordinatorProvider, useMergedCoordinator } from '../src/state/mergedCoordinator'
import { LanguageProvider } from '../src/state/language'
import { RunStoreProvider } from '../src/state/runStore'
import { ProposalStoreProvider } from '../src/state/proposalStore'
import { ReviewStoreProvider, useReviewStore } from '../src/state/reviewStore'
import MergedCenterPanel from '../src/components/merged/MergedCenterPanel'

const reviewRef: { current: ReturnType<typeof useReviewStore>['state'] | null } = { current: null }
const reviewDispatchRef: { current: ReturnType<typeof useReviewStore>['dispatch'] | null } = { current: null }

function renderPanel() {
  const ref: { current: ReturnType<typeof useMergedCoordinator> | null } = { current: null }
  function Capture() {
    ref.current = useMergedCoordinator()
    const review = useReviewStore()
    reviewRef.current = review.state
    reviewDispatchRef.current = review.dispatch
    return null
  }
  render(
    <LanguageProvider initialLanguage="en">
      <RunStoreProvider>
        <ProposalStoreProvider>
          <ReviewStoreProvider>
            <MergedCoordinatorProvider>
              <Capture />
              <MergedCenterPanel />
            </MergedCoordinatorProvider>
          </ReviewStoreProvider>
        </ProposalStoreProvider>
      </RunStoreProvider>
    </LanguageProvider>,
  )
  return ref
}

const playbackFlag = () => screen.getByTestId('map-probe').getAttribute('data-playback')

describe('map projection → playback handover', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('shows the projection before a run exists', () => {
    renderPanel()
    expect(playbackFlag()).toBe('false')
  })

  it('switches the map to live markers once a run is created', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_1', trigger_run_id: 'run_1' })
    const ref = renderPanel()

    await act(async () => {
      await ref.current!.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })

    expect(playbackFlag()).toBe('true')
    expect(tickMergedRun).not.toHaveBeenCalled() // creation alone is enough
  })
})

describe('clicking a trigger dot on the map', () => {
  it('sends the review column to the TRIGGER comparison', () => {
    renderPanel()
    // The column OPENS on the trigger stage, so move it away first — otherwise
    // this passes whether or not the click dispatches anything.
    act(() => { reviewDispatchRef.current!({ type: 'SELECT_STAGE', stage: 'content' }) })
    expect(reviewRef.current!.stage).toBe('content')

    act(() => { fireEvent.click(screen.getByTestId('map-probe-fire-0')) })

    expect(reviewRef.current!.stage).toBe('trigger')
  })
})
