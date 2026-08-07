/**
 * merged_setup_gating.test.tsx (fixbug-0806) — htmlapp mirror of
 * app/frontend/tests/merged_setup_gating.test.tsx. The Combined screen's
 * setup panel must SUPPRESS its debounced auto-quickview (and the live-run
 * reset check) while an Edit popup is open, firing exactly one recompute when
 * the popup closes (no Confirm button — closing IS the "apply" action).
 *
 * Mocking scaffold copied from `merged_painter_ui.test.tsx` / this repo's own
 * `merged_setup_basic_tiers.test.tsx` conventions: only `api/client.ts`,
 * `api/proposalClient.ts`, `api/mergedClient.ts` are mocked (spread the real
 * module via `orig`, override only the network boundary) so `MergedSetupPanel`
 * mounts with its real Modal/store wiring.
 */
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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
import { mergedQuickview } from '../src/api/mergedClient'
import { MergedCoordinatorProvider } from '../src/state/mergedCoordinator'
import { LanguageProvider } from '../src/state/language'
import { RunStoreProvider } from '../src/state/runStore'
import { ProposalStoreProvider } from '../src/state/proposalStore'
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
      oshi_artists: [],
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
  // The situation popup's trigger sections resolve the ScenarioDef; a minimal
  // stub is enough for the basic tier to render.
  vi.mocked(getScenario).mockResolvedValue({
    id: 'scn_fatigue_1',
    is_night: false,
    familiar_route: false,
    child_passenger: false,
    weather_risk: 0,
    speed_profile: {},
  } as unknown as Awaited<ReturnType<typeof getScenario>>)
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

async function selectValue(testId: string, value: string) {
  const el = await screen.findByTestId(testId)
  await waitFor(() => expect(el).not.toBeDisabled())
  fireEvent.change(el, { target: { value } })
}

/** Fills every inline dropdown (route preset → trigger pkg → scenario →
 * service pkg → content pkg) so the panel reaches its complete/ready state —
 * mirrors `merged_painter_ui.test.tsx`'s `fillSetup`. */
async function fillSetup() {
  await selectValue('merged-route-preset-select', 'preset-route-1')
  await waitFor(() => expect(loadRoutePreset).toHaveBeenCalledWith('preset-route-1'))
  await selectValue('merged-trigger-package-select', 'trigger_pkg_1')
  await selectValue('merged-scenario-select', 'scn_fatigue_1')
  await selectValue('merged-service-package-select', 'svc_pkg_1')
  await selectValue('merged-content-package-select', 'content_pkg_1')
}

function renderSetupPanel() {
  return render(
    <LanguageProvider initialLanguage="en">
      <MergedCoordinatorProvider>
        <RunStoreProvider>
          <ProposalStoreProvider>
            <MergedSetupPanel />
          </ProposalStoreProvider>
        </RunStoreProvider>
      </MergedCoordinatorProvider>
    </LanguageProvider>,
  )
}

describe('MergedSetupPanel — suppress recompute while an Edit popup is open (fixbug-0806)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
    vi.mocked(mergedQuickview).mockResolvedValue(EMPTY_QUICKVIEW)
  })

  it('does NOT recompute while an Edit popup is open, then fires exactly once on close', async () => {
    renderSetupPanel()
    await fillSetup()

    // Wait for the initial debounced quickview (setup complete), then reset the
    // spy so the assertions below count only what happens around the popup.
    await waitFor(() => expect(mergedQuickview).toHaveBeenCalled(), { timeout: 2000 })
    vi.mocked(mergedQuickview).mockClear()

    // Open the Situation Edit popup.
    const editBtn = await screen.findByTestId('edit-situation')
    await act(async () => { fireEvent.click(editBtn) })

    // Change a field INSIDE the popup (basic tier initial-drowsiness input).
    const drowsinessInput = await screen.findByTestId('basic-initial_drowsiness')
    await act(async () => { fireEvent.change(drowsinessInput, { target: { value: '77' } }) })

    // Advance past the 500ms debounce — still no recompute, because the popup
    // is open (real timers — the panel debounces with a real setTimeout).
    await act(async () => { await new Promise((r) => setTimeout(r, 600)) })
    expect(mergedQuickview).not.toHaveBeenCalled()

    // Close the popup — the ONLY open Modal's close button (aria-label from
    // Modal's LABELS.close = {ja:'閉じる', en:'Close'}).
    const dialog = screen.getByRole('dialog')
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /close|閉じる/i }))
    })

    await act(async () => { await new Promise((r) => setTimeout(r, 600)) })
    await waitFor(() => expect(mergedQuickview).toHaveBeenCalledTimes(1))
  })
})
