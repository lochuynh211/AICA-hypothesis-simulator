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

vi.mock('../src/api/client', () => ({
  listRoutePresets: vi.fn(),
  loadRoutePreset: vi.fn(),
  listScenarios: vi.fn(),
  listPackages: vi.fn(),
  createRunPlan: vi.fn(),
}))

vi.mock('../src/api/proposalClient', () => ({
  getPackages: vi.fn(),
  getPresets: vi.fn(),
  getPreset: vi.fn(),
}))

vi.mock('../src/api/mergedClient', () => ({
  createMergedRun: vi.fn(),
  tickMergedRun: vi.fn(),
  mergedProposalAction: vi.fn(),
}))

import {
  listRoutePresets,
  loadRoutePreset,
  listScenarios,
  listPackages,
  createRunPlan,
} from '../src/api/client'
import { getPackages, getPresets, getPreset } from '../src/api/proposalClient'
import { createMergedRun } from '../src/api/mergedClient'
import { MergedCoordinatorProvider } from '../src/state/mergedCoordinator'
import MergedSetupPanel from '../src/components/merged/MergedSetupPanel'

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
}

function renderPanel() {
  return render(
    <MergedCoordinatorProvider>
      <MergedSetupPanel />
    </MergedCoordinatorProvider>,
  )
}

describe('MergedSetupPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  it('opens the Route popup and lists the fetched route presets', async () => {
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: /route/i }))

    const dialog = await screen.findByRole('dialog')
    const option = await within(dialog).findByText(/Route Preset 1/)
    expect(option).toBeInTheDocument()
  })

  it('configures a full run via the popups and starts it, calling coordinator.create with the built trigger_plan_id + package ids', async () => {
    renderPanel()

    // Route: open popup, pick the preset route.
    fireEvent.click(screen.getByRole('button', { name: /route/i }))
    let dialog = await screen.findByRole('dialog')
    const routeSelect = await within(dialog).findByLabelText(/route preset/i)
    fireEvent.change(routeSelect, { target: { value: 'preset-route-1' } })
    await waitFor(() => expect(loadRoutePreset).toHaveBeenCalledWith('preset-route-1'))
    fireEvent.click(within(dialog).getByRole('button', { name: /close/i }))

    // Scenario: open popup, pick the scenario.
    fireEvent.click(screen.getByRole('button', { name: /scenario/i }))
    dialog = await screen.findByRole('dialog')
    const scenarioSelect = await within(dialog).findByLabelText(/scenario/i)
    fireEvent.change(scenarioSelect, { target: { value: 'scn_fatigue_1' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /close/i }))

    // Packages: open popup, pick trigger + service + content packages.
    fireEvent.click(screen.getByRole('button', { name: /packages/i }))
    dialog = await screen.findByRole('dialog')
    fireEvent.change(await within(dialog).findByLabelText(/trigger package/i), {
      target: { value: 'trigger_pkg_1' },
    })
    fireEvent.change(within(dialog).getByLabelText(/service package/i), {
      target: { value: 'svc_pkg_1' },
    })
    fireEvent.change(within(dialog).getByLabelText(/content package/i), {
      target: { value: 'content_pkg_1' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: /close/i }))

    // Start run.
    fireEvent.click(screen.getByRole('button', { name: /start run/i }))

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
