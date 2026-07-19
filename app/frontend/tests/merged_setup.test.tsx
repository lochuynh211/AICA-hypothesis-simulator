/**
 * MergedSetupPanel (020 Task 8) — the Combined Simulator's left setup panel.
 *
 * Slice-1 minimal: six collapsed summary buttons open popups (`Modal`, Task
 * 6); only Route / Scenario / Packages are functional this slice. "Start
 * run" (a) builds a trigger run-plan via `POST /api/run-plans` (`client.ts`
 * `createRunPlan`) from the selected route preset + scenario + trigger
 * package + a run seed, (b) fetches a default typed `World` from a
 * feature-018 proposal preset (`proposalClient` `getPreset`/`getPresets`),
 * then (c) calls `useMergedCoordinator().create(...)` (from a real
 * `MergedCoordinatorProvider`, which in turn calls `createMergedRun`).
 *
 * Rendered inside a REAL `MergedCoordinatorProvider` (the same
 * pattern `merged_coordinator.test.tsx` and every other store-consuming
 * component test in the repo uses — e.g. `proposal_content_panel.test.tsx`
 * wraps `ProposalStoreProvider` and mocks only the network boundary): only
 * `api/client.ts`, `api/proposalClient.ts`, and `api/mergedClient.ts` are
 * mocked, so the assertion exercises the real Context/Provider wiring and a
 * real `createMergedRun` payload, not a stand-in spy shaped like
 * `coordinator.create`.
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { World } from '../src/api/proposalClient'

// Spread the real modules (importActual) and override only the network
// functions — the exact-reuse setup editors the panel now mounts import real
// constants/types from these modules (e.g. GENRE_VOCABULARY, SERVICE_ID_OPTIONS,
// AlgorithmFormulationPanel's getPackage), which must stay real.
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
  mergedQuickview: vi.fn(),
  buildMergedPlan: vi.fn(),
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
import { createMergedRun, tickMergedRun, mergedQuickview } from '../src/api/mergedClient'
import { MergedCoordinatorProvider, useMergedCoordinator } from '../src/state/mergedCoordinator'
import { RunStoreProvider } from '../src/state/runStore'
import { ProposalStoreProvider } from '../src/state/proposalStore'
import MergedSetupPanel from '../src/components/merged/MergedSetupPanel'

/** A live trigger tick with the loop halted (paused) so `startAndPlay()`'s
 * play() loop stops after one tick without needing a full tick fixture. */
const PAUSED_TICK = {
  trigger: {
    tick_index: null,
    decision: null,
    route_fraction: null,
    motion_state: null,
    recovery_phase: null,
    is_traffic_jam: null,
    segment_type: null,
    paused: true,
    completed: false,
  },
  proposal: null,
  correlation: null,
}

/** Renders the panel plus a test-only Play button that drives
 * `coordinator.startAndPlay()` — the real run start now lives on the center
 * panel's Play (no "Start run" button in the setup panel), so setup-panel
 * tests trigger it through the coordinator directly. */
function Harness() {
  const c = useMergedCoordinator()
  return (
    <>
      <MergedSetupPanel />
      <button type="button" data-testid="test-play" onClick={() => void c.startAndPlay()}>
        play
      </button>
    </>
  )
}

async function selectValue(testId: string, value: string) {
  const el = await screen.findByTestId(testId)
  await waitFor(() => expect(el).not.toBeDisabled())
  fireEvent.change(el, { target: { value } })
}

/** Fills every inline dropdown (route preset → trigger pkg → scenario →
 * service pkg → content pkg) so the panel reaches its complete/ready state. */
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
        preset_id: 'preset-journey-a-1-cruising-fresh-monotonous',
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
    preset_id: 'preset-journey-a-1-cruising-fresh-monotonous',
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
  // The situation popup's trigger sections resolve the ScenarioDef; a minimal
  // stub is enough (the tests here don't open the popup, but the panel's effect
  // fetches it on scenario selection).
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
    <MergedCoordinatorProvider>
      <RunStoreProvider>
        <ProposalStoreProvider>
          <Harness />
        </ProposalStoreProvider>
      </RunStoreProvider>
    </MergedCoordinatorProvider>,
  )
}

const EMPTY_QUICKVIEW = {
  fired: false,
  fire: null,
  fires: [],
  peak_score: 0,
  threshold: null,
  score_series: [],
  monotony_series: [],
  monotony_threshold: null,
  spikes: [],
  segments: [],
  rest_spot: null,
  rest_option: null,
  rest_spots: [],
  rest_options: [],
  completed_min: null,
  seed: 42,
  overrides: [],
  error: null,
}

describe('MergedSetupPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
    vi.mocked(mergedQuickview).mockResolvedValue(EMPTY_QUICKVIEW)
    vi.mocked(tickMergedRun).mockResolvedValue(PAUSED_TICK)
  })

  it('lists the fetched route presets in the inline dropdown (no popup)', async () => {
    renderPanel()
    const select = await screen.findByTestId('merged-route-preset-select')
    expect(within(select).getByText(/Route Preset 1/)).toBeInTheDocument()
  })

  it('auto-runs a quickview once the selection is complete — no button, no run created', async () => {
    renderPanel()
    await fillSetup()

    await waitFor(() => expect(mergedQuickview).toHaveBeenCalled(), { timeout: 2000 })
    expect(mergedQuickview).toHaveBeenCalledWith(
      expect.objectContaining({
        package_id: 'trigger_pkg_1',
        scenario_id: 'scn_fatigue_1',
        service_package_id: 'svc_pkg_1',
        content_package_id: 'content_pkg_1',
        world: expect.objectContaining({ control_inputs: expect.any(Object) }),
        run_seed: expect.any(Number),
        run_seed_proposal: expect.any(String),
      }),
    )
    // Auto-quickview is ephemeral — it never creates a real run.
    expect(createMergedRun).not.toHaveBeenCalled()
  })

  it('the center Play starts the run — builds the plan and calls createMergedRun with the selected ids', async () => {
    renderPanel()
    await fillSetup()

    // Play (center panel) lazily creates the run via the registered start fn.
    await waitFor(() => expect(screen.getByTestId('test-play')).toBeEnabled())
    fireEvent.click(screen.getByTestId('test-play'))

    await waitFor(() => expect(createMergedRun).toHaveBeenCalledTimes(1))

    expect(createRunPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        packageId: 'trigger_pkg_1',
        scenarioId: 'scn_fatigue_1',
        routeId: 'route-1',
      }),
    )
    expect(createMergedRun).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger_plan_id: 'plan_abc123',
        service_package_id: 'svc_pkg_1',
        content_package_id: 'content_pkg_1',
        world: expect.objectContaining({ control_inputs: expect.any(Object) }),
        run_seed: expect.any(String),
      }),
    )
  })
})
