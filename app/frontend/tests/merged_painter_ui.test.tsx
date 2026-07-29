/**
 * merged_painter_ui — Slice-2b frontend Task 4: MergedSetupPanel's Route
 * popup renders two dual-handle "route-conditions painter" sliders (mountain
 * + traffic-jam ranges over the 0..total-route-km axis) wired to
 * `buildMergedPlan` (`POST /api/merged-runs/plan`, Slice-2b Task 2).
 *
 * Mirrors `merged_setup.test.tsx`'s mocking/rendering conventions exactly
 * (real `MergedCoordinatorProvider`; only `api/client.ts`,
 * `api/proposalClient.ts`, `api/mergedClient.ts` are mocked) so this proves
 * the real Context/Provider wiring end to end: when a painter range is set,
 * "Start run" must call `buildMergedPlan` first and feed its `plan_id` into
 * `coordinator.create` (`createMergedRun`) instead of the plain
 * `createRunPlan` path.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { World } from '../src/api/proposalClient'

vi.mock('../src/api/client', async (orig) => ({
  ...(await orig<typeof import('../src/api/client')>()),
  listRoutePresets: vi.fn(),
  loadRoutePreset: vi.fn(),
  listScenarios: vi.fn(),
  listPackages: vi.fn(),
  createRunPlan: vi.fn(),
  getScenario: vi.fn(),
}))

vi.mock('../src/api/proposalClient', async (orig) => ({
  ...(await orig<typeof import('../src/api/proposalClient')>()),
  getPackages: vi.fn(),
  getPresets: vi.fn(),
  getPreset: vi.fn(),
}))

vi.mock('../src/api/mergedClient', async (orig) => ({
  ...(await orig<typeof import('../src/api/mergedClient')>()),
  createMergedRun: vi.fn(),
  tickMergedRun: vi.fn(),
  mergedProposalAction: vi.fn(),
  buildMergedPlan: vi.fn(),
  mergedQuickview: vi.fn(),
}))

import {
  listRoutePresets,
  loadRoutePreset,
  listScenarios,
  listPackages,
  createRunPlan,
  getScenario,
} from '../src/api/client'
import { getPackages, getPresets, getPreset } from '../src/api/proposalClient'
import { createMergedRun, tickMergedRun, buildMergedPlan, mergedQuickview } from '../src/api/mergedClient'
import { MergedCoordinatorProvider, useMergedCoordinator } from '../src/state/mergedCoordinator'
import { LanguageProvider } from '../src/state/language'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'
import { ProposalStoreProvider } from '../src/state/proposalStore'
import MergedSetupPanel from '../src/components/merged/MergedSetupPanel'

const PAUSED_TICK = {
  trigger: {
    tick_index: null, decision: null, route_fraction: null, motion_state: null,
    recovery_phase: null, is_traffic_jam: null, segment_type: null,
    paused: true, completed: false,
  },
  proposal: null,
  correlation: null,
}
const EMPTY_QUICKVIEW = {
  fired: false, fire: null, fires: [], peak_score: 0, threshold: null,
  score_series: [], monotony_series: [], monotony_threshold: null, spikes: [],
  segments: [], rest_spot: null, rest_option: null, rest_spots: [], rest_options: [],
  completed_min: null, seed: 42, overrides: [], error: null,
}

/** The live runStore state, so tests can assert what the panel bridged into it
 *  for the (unmounted here) `<MapSurface/>` to read. */
const runStateRef: { current: ReturnType<typeof useRunStore>['state'] | null } = { current: null }

function Harness() {
  const c = useMergedCoordinator()
  runStateRef.current = useRunStore().state
  return (
    <>
      <MergedSetupPanel />
      <button type="button" data-testid="test-play" onClick={() => void c.startAndPlay()}>play</button>
    </>
  )
}

async function selectValue(testId: string, value: string) {
  const el = await screen.findByTestId(testId)
  await waitFor(() => expect(el).not.toBeDisabled())
  fireEvent.change(el, { target: { value } })
}

/** Fills every inline dropdown so the panel reaches complete/ready. */
async function fillSetup() {
  await selectValue('merged-route-preset-select', 'preset-route-1')
  await waitFor(() => expect(loadRoutePreset).toHaveBeenCalledWith('preset-route-1'))
  await selectValue('merged-trigger-package-select', 'trigger_pkg_1')
  await selectValue('merged-scenario-select', 'scn_fatigue_1')
  await selectValue('merged-service-package-select', 'svc_pkg_1')
  await selectValue('merged-content-package-select', 'content_pkg_1')
}

function fullWorld(): World {
  return {
    control_inputs: {
      trigger_purpose: 'rest_recommended',
      lifecycle_stage: 'before_rest_until_stop',
      motion_state: 'driving',
      matrix_version: 'v1',
      dataset_id: 'ds-1',
    },
    situation: {
      drowsiness_level: 40,
      fatigue_level: 30,
      traffic_state: 'normal',
      road_type: 'highway',
      night_state: 'day',
      monotony_level: 20,
      route_tags: [],
      destination_tags: [],
      child_present: false,
      multiple_passengers: false,
      motion_state: 'driving',
      estimated_min_until_rest_spot: null,
      rest_spot_type: 'unknown',
      active_service: null,
      recent_service_rejections: [],
    },
    driver_profile: {
      oshi_registered: false,
      oshi_mode: 'off',
      oshi_id: null,
      oshi_type: null,
      oshi_tags: [],
      age_band: '30s',
      gender: 'unspecified',
      hobby_interest_tags: [],
      service_usage_level: {},
      service_recency_state: {},
      scene_service_usage_level: {},
      catalog_item_usage_level: {},
      catalog_item_recency_state: {},
      content_tag_usage_level: {},
      content_tag_recency_state: {},
      scene_content_tag_usage_level: {},
      played_items: [],
      skipped_items: [],
      changed_from_items: [],
      cancelled_content_plans: [],
      completed_items: [],
      manually_selected_items: [],
      repeated_items: [],
      service_proposal_acceptance_rate: {},
      service_recovery_rate: {},
      content_proposal_acceptance_rate: {},
      content_recovery_rate: {},
      service_proposal_acceptance_confidence: {},
      service_recovery_confidence: {},
      content_proposal_acceptance_confidence: {},
      content_recovery_confidence: {},
      scheduled_event_type: null,
      scheduled_event_timing: null,
      scheduled_event_tags: [],
      genre_affinity_v1_enabled: false,
      usage_by_genre: null,
      scene_genre_usage: null,
    },
    catalog_ref: {
      dataset_id: 'ds-1',
      dataset_version: {
        schema_version: '1.0.0',
        spotify_track_reference_version: '1.0.0',
        spotify_audio_features_reference_version: '1.0.0',
      },
      dataset_hash: 'sha256:abc',
    },
  }
}

const ROUTE_FACTS = {
  total_route_distance_km: 120,
  estimated_route_duration_min: 90,
  route_segments: [],
  rest_spot_positions: [],
  route_progress_checkpoints: [],
}

function setupMocks() {
  vi.mocked(listRoutePresets).mockResolvedValue({
    presets: [
      {
        id: 'preset-route-1',
        label: { ja: 'ルート1', en: 'Route Preset 1' },
        start: 'Tokyo',
        end: 'Osaka',
        distance_km: 120,
        duration_min: 90,
        summary: 'Tokyo to Osaka',
      },
    ],
  })
  vi.mocked(loadRoutePreset).mockResolvedValue({
    route_source: 'local',
    alternatives: [
      {
        route_id: 'route-1',
        summary: 'Tokyo to Osaka',
        route_facts: ROUTE_FACTS,
        display: null,
        notices: [],
      },
    ],
  })
  vi.mocked(listScenarios).mockResolvedValue({
    scenarios: [
      {
        id: 'scn_fatigue_1',
        version: '1.0',
        type: 'fatigue_buildup',
        persona_label: 'Tired commuter',
        review_focus: 'Late fatigue trigger',
      },
    ],
    errors: [],
  })
  vi.mocked(listPackages).mockResolvedValue({
    packages: [
      {
        id: 'trigger_pkg_1',
        version: '1.0',
        label: { ja: 'トリガー', en: 'Trigger Package 1' },
        algorithm_type: 'python_module',
        compatible_scenario_types: ['fatigue_buildup'],
      },
    ],
    errors: [],
  })
  vi.mocked(createRunPlan).mockResolvedValue({
    plan_id: 'plan_abc123',
    draft_plan: {},
    effective_setup: {},
    validation_errors: [],
  })
  vi.mocked(getPackages).mockResolvedValue({
    slots: [],
    packages: [
      {
        id: 'svc_pkg_1',
        version: '1.0',
        label: { ja: 'サービス', en: 'Service Package 1' },
        family: 'service_selector',
        approach: 'transparent',
        contract_version: '1.0',
        supported_services: [],
        parameters: {},
        hyperparameters: [],
      },
      {
        id: 'content_pkg_1',
        version: '1.0',
        label: { ja: 'コンテンツ', en: 'Content Package 1' },
        family: 'content_selector',
        approach: 'transparent',
        contract_version: '1.0',
        supported_services: [],
        parameters: {},
        hyperparameters: [],
      },
    ],
    errors: [],
  })
  vi.mocked(getPresets).mockResolvedValue({
    presets: [
      {
        preset_id: 'preset-journey-a-1-cruising-fresh',
        label: { ja: 'A', en: 'Journey A' },
        brief: { ja: '', en: '' },
        category: 'baseline',
        family: 'baseline',
        journey: null,
        contrast_with: null,
        hypothesis: '',
      },
    ],
  })
  vi.mocked(getPreset).mockResolvedValue({
    preset_id: 'preset-journey-a-1-cruising-fresh',
    schema_version: '1.0',
    label: { ja: 'A', en: 'Journey A' },
    brief: { ja: '', en: '' },
    category: 'baseline',
    family: 'baseline',
    journey: null,
    contrast_with: null,
    world: fullWorld(),
    algorithm_config_overrides: null,
    expectation: {
      hypothesis: '',
      expected_top: {},
      top_fit_min: 0,
      gradient: 'none',
      expected_service: { top_should_be_in: [] },
      override_required: false,
    },
  })
  vi.mocked(createMergedRun).mockResolvedValue({
    merged_run_id: 'mrun_1',
    trigger_run_id: 'run_1',
  })
  vi.mocked(buildMergedPlan).mockResolvedValue({ plan_id: 'plan_painted_xyz' })
  // The situation popup's trigger sections + painter render once the ScenarioDef
  // resolves (the painter's totalKm comes from the route, but the popup body is
  // gated on a resolved scenario).
  vi.mocked(getScenario).mockResolvedValue({
    id: 'scn_fatigue_1',
    is_night: false,
    familiar_route: false,
    child_passenger: false,
    weather_risk: 0,
    speed_profile: {},
  } as unknown as Awaited<ReturnType<typeof getScenario>>)
}

function renderPanel() {
  return render(
    <LanguageProvider initialLanguage="en">
      <MergedCoordinatorProvider>
      <RunStoreProvider>
        <ProposalStoreProvider>
          <Harness />
        </ProposalStoreProvider>
      </RunStoreProvider>
    </MergedCoordinatorProvider>
    </LanguageProvider>,
  )
}

describe('MergedSetupPanel — route-conditions painter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
    vi.mocked(tickMergedRun).mockResolvedValue(PAUSED_TICK)
    vi.mocked(mergedQuickview).mockResolvedValue(EMPTY_QUICKVIEW)
  })

  it('renders the mountain + jam range sliders in the Situation popup', async () => {
    renderPanel()
    await fillSetup()
    fireEvent.click(screen.getByTestId('edit-situation'))
    // The painter lives in the DETAILED tier (task 18's basic/detailed split) —
    // the popup now opens in the compact basic view first.
    fireEvent.click(await screen.findByTestId('setup-detailed-toggle'))
    expect(await screen.findByTestId('mountain-range-start')).toBeInTheDocument()
    expect(screen.getByTestId('mountain-range-end')).toBeInTheDocument()
    expect(screen.getByTestId('jam-range-start')).toBeInTheDocument()
    expect(screen.getByTestId('jam-range-end')).toBeInTheDocument()
  })

  it('paints a mountain + jam range and, on Play, builds a painted plan via buildMergedPlan before coordinator.create', async () => {
    renderPanel()
    await fillSetup()

    // Paint the mountain + jam ranges (in the Situation popup) onto the 120km route.
    fireEvent.click(screen.getByTestId('edit-situation'))
    // The painter lives in the DETAILED tier (task 18's basic/detailed split).
    fireEvent.click(await screen.findByTestId('setup-detailed-toggle'))
    await screen.findByTestId('mountain-range-start')
    fireEvent.change(screen.getByTestId('mountain-range-start'), { target: { value: '40' } })
    fireEvent.change(screen.getByTestId('mountain-range-end'), { target: { value: '70' } })
    fireEvent.change(screen.getByTestId('jam-range-start'), { target: { value: '10' } })
    fireEvent.change(screen.getByTestId('jam-range-end'), { target: { value: '20' } })

    expect(screen.getByTestId('mountain-range-readout').textContent).toMatch(/40.*70/)
    expect(screen.getByTestId('jam-range-readout').textContent).toMatch(/10.*20/)

    await waitFor(() => expect(screen.getByTestId('test-play')).toBeEnabled())
    fireEvent.click(screen.getByTestId('test-play'))

    await waitFor(() => expect(buildMergedPlan).toHaveBeenCalledTimes(1))
    expect(buildMergedPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        package_id: 'trigger_pkg_1',
        scenario_id: 'scn_fatigue_1',
        mountain_range_km: [40, 70],
        jam_range_km: [10, 20],
      }),
    )

    await waitFor(() => expect(createMergedRun).toHaveBeenCalledTimes(1))
    expect(createRunPlan).not.toHaveBeenCalled()
    expect(createMergedRun).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger_plan_id: 'plan_painted_xyz',
        service_package_id: 'svc_pkg_1',
        content_package_id: 'content_pkg_1',
      }),
    )
  })

  it('bridges the painted mountain range into the runStore for the map', async () => {
    // The painted mountain range is spliced into `route_segments` server-side,
    // inside the trigger run plan — the map has no way to see it. Without this
    // bridge C-04 showed its mountain stretch in the quickview and nowhere on
    // the Google canvas. Mirrors the jam bridge exactly.
    renderPanel()
    await fillSetup()

    fireEvent.click(screen.getByTestId('edit-situation'))
    fireEvent.click(await screen.findByTestId('setup-detailed-toggle'))
    await screen.findByTestId('mountain-range-start')
    fireEvent.change(screen.getByTestId('mountain-range-start'), { target: { value: '40' } })
    fireEvent.change(screen.getByTestId('mountain-range-end'), { target: { value: '70' } })

    await waitFor(() => expect(runStateRef.current?.mergedMountainRangesKm).toEqual([[40, 70]]))
  })

  it('keeps the plain plan-build path when no painter range is set', async () => {
    renderPanel()
    await fillSetup()

    await waitFor(() => expect(screen.getByTestId('test-play')).toBeEnabled())
    fireEvent.click(screen.getByTestId('test-play'))

    await waitFor(() => expect(createMergedRun).toHaveBeenCalledTimes(1))
    expect(buildMergedPlan).not.toHaveBeenCalled()
    expect(createRunPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        packageId: 'trigger_pkg_1',
        scenarioId: 'scn_fatigue_1',
        routeId: 'route-1',
      }),
    )
    expect(createMergedRun).toHaveBeenCalledWith(
      expect.objectContaining({ trigger_plan_id: 'plan_abc123' }),
    )
  })
})
