/**
 * Two-tier basic/detailed setup editors (task 18, combined-review-screen).
 *
 * `MergedSetupPanel`'s five "Edit" popups now open in a compact BASIC view
 * (only the handful of fields a reviewer routinely turns, 07-27 §9.1) with a
 * `▸ Detailed setup` toggle that reveals the EXISTING setup/proposal editor
 * component, mounted verbatim (unchanged from before this task — see the
 * `git diff --stat` gate over `components/setup/` and
 * `components/proposal/panels/sections/` in the task report).
 *
 * Provider stack copied from `tests/merged_setup.test.tsx` (the panel's own
 * test file) — `MergedSetupPanel` calls `api/client`, `api/proposalClient`
 * and `api/mergedClient` directly, so those need mocking here too (unlike
 * `tests/merged_center.test.tsx`, which only needed the store providers).
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { World } from '../src/api/proposalClient'
import type { ResolvedCaseSetup } from '../src/lib/review/caseResolver'
import type { CombinedTestCase } from '../src/lib/review/caseCatalog'

vi.mock('../src/api/client', async (orig) => ({
  ...(await orig<typeof import('../src/api/client')>()),
  listRoutePresets: vi.fn(),
  loadRoutePreset: vi.fn(),
  listScenarios: vi.fn(),
  listPackages: vi.fn(),
  createRunPlan: vi.fn(),
  getScenario: vi.fn(),
  getPackage: vi.fn(),
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
  getPackage,
} from '../src/api/client'
import { getPackages, getPresets, getPreset } from '../src/api/proposalClient'
import { createMergedRun, mergedQuickview, tickMergedRun } from '../src/api/mergedClient'
import { LanguageProvider } from '../src/state/language'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'
import { ProposalStoreProvider } from '../src/state/proposalStore'
import { MergedCoordinatorProvider } from '../src/state/mergedCoordinator'
import MergedSetupPanel from '../src/components/merged/MergedSetupPanel'

// ── fixtures ─────────────────────────────────────────────────────────────

const ROUTE_FACTS = {
  total_route_distance_km: 120,
  estimated_route_duration_min: 90,
  route_segments: [],
  rest_spot_positions: [],
  route_progress_checkpoints: [],
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

/** A `ResolvedCaseSetup` that matches exactly what the mocked registries
 * below auto-select (the single route/scenario/package/service/content
 * option each), so a test can assert "no drift" without hand-driving every
 * dropdown. `profileRef: ''` matches `ps.selectedProfileId` (`null` → `''`)
 * — this test never runs a real case-selection flow (`useCaseSelection`
 * lives above `MergedSetupPanel`, not exercised here), so no LOAD_PROFILE is
 * ever dispatched and `selectedProfileId` stays `null`. */
const MATCHING_CASE_SETUP: ResolvedCaseSetup = {
  scenarioId: 'scn_fatigue_1',
  routePresetId: 'preset-route-1',
  triggerPackageId: 'trigger_pkg_1',
  servicePackageId: 'svc_pkg_1',
  contentPackageId: 'content_pkg_1',
  seed: 42,
  tickSeconds: 180,
  initialDrowsiness: null,
  initialFatigue: null,
  contextOverrides: {},
  situationFields: {},
  mountainRangeKm: null,
  jamRangeKm: null,
  profileRef: '',
}

/** The shell always passes `selectedCase` alongside `caseSetup`; the
 *  clear-on-edit effect keys off its `case_id`, so drift tests need one. */
function caseNamed(caseId: string): CombinedTestCase {
  return {
    case_id: caseId,
    schema_version: '1.0',
    version: '1.0',
    title: { ja: 'テストケース', en: 'Test case' },
    brief: { ja: '', en: '' },
    what_to_watch: [],
    persona: {
      persona_id: 'persona-test',
      name: { ja: 'テスト太郎', en: 'Test Taro' },
      narrative: { ja: '', en: '' },
      preferences: [],
      profile_ref: '',
    },
    journey: {
      narrative: { ja: '', en: '' },
      scenario_ref: 'scn_fatigue_1',
      route_preset_ref: 'preset-route-1',
      seed: 42,
      tick_seconds: 180,
    },
    algorithm_defaults: { trigger: 'trigger_pkg_1', service: 'svc_pkg_1', content: 'content_pkg_1' },
  }
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
      { route_id: 'route-1', summary: 'Tokyo to Osaka', route_facts: ROUTE_FACTS, display: null, notices: [] },
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
  vi.mocked(getPackage).mockResolvedValue({
    id: 'trigger_pkg_1',
    version: '1.0',
    label: { ja: 'トリガー', en: 'Trigger Package 1' },
    compatible_scenario_types: ['fatigue_buildup'],
    algorithm: { type: 'python_module', entrypoint: 'algorithm:evaluate' },
    parameters: [],
    features: [],
    hyperparameters: [
      {
        key: 'threshold_suggest', kind: 'numeric',
        label: { ja: '休憩提案閾値', en: 'Rest Suggest Threshold' },
        default: 0.7, min: 0, max: 1, step: 0.01,
      },
      {
        key: 'monotony_suggest_threshold', kind: 'numeric',
        label: { ja: '単調性提案閾値', en: 'Monotony Suggest Threshold' },
        default: 0.7, min: 0, max: 1, step: 0.01,
      },
    ],
    trigger_categories: [],
    rules: [],
    fire_control: { threshold_source: 'threshold_suggest', actionability_guard: {} },
    proposals: [],
    feedback_schema: [],
    evidence_metrics: [],
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
        parameters: { top_k: 5 },
        hyperparameters: [
          {
            key: 'hierarchy_weights', kind: 'table',
            label: { ja: '階層重み', en: 'Hierarchy Weights' },
            default: { Situation: { share: 0.8 }, Preference: { share: 0.2 } },
          },
        ],
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
        hyperparameters: [
          {
            key: 'content_category_weights', kind: 'table',
            label: { ja: 'カテゴリ重み', en: 'Content Category Weights' },
            default: { Situation: 0.45, Preference: 0.35, History: 0.2 },
          },
          {
            key: 'plan_item_count', kind: 'numeric',
            label: { ja: 'プラン曲数', en: 'Plan Item Count' },
            default: 5, min: 1, max: 20, step: 1,
          },
          {
            key: 'context_response_matrix', kind: 'matrix',
            label: { ja: 'コンテキスト応答行列', en: 'Context Response Matrix' },
            default: { drowsiness: { alpha: 0.55, beta: 0.45 } },
          },
        ],
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
  vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_1', trigger_run_id: 'run_1' })
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
  fired: false, fire: null, fires: [], peak_score: 0, threshold: null, score_series: [], monotony_series: [],
  monotony_threshold: null, spikes: [], segments: [], rest_spot: null, rest_option: null, rest_spots: [],
  rest_options: [], completed_min: null, seed: 42, overrides: [], error: null,
}
const PAUSED_TICK = {
  trigger: {
    tick_index: null, decision: null, route_fraction: null, motion_state: null, recovery_phase: null,
    is_traffic_jam: null, segment_type: null, paused: true, completed: false,
  },
  proposal: null,
  correlation: null,
} as unknown as Awaited<ReturnType<typeof tickMergedRun>>

/** Captures the real `runStore` context alongside the panel — needed to
 * assert on DISPATCHED state (e.g. `contextOverrides.is_night`), not just
 * what the checkbox displays. Display alone can't catch review Finding 1
 * (a deleted override still shows checked because the checkbox's display
 * falls back to the case's own pinned value when no override is present). */
function renderPanel(
  caseSetup: ResolvedCaseSetup | null = null,
  lang: 'ja' | 'en' = 'en',
  extra: { selectedCase?: CombinedTestCase | null; onCaseDrift?: () => void } = {},
) {
  const runRef: { current: ReturnType<typeof useRunStore> | null } = { current: null }
  function Capture() {
    runRef.current = useRunStore()
    return null
  }
  const utils = render(
    <LanguageProvider initialLanguage={lang}>
      <MergedCoordinatorProvider>
        <RunStoreProvider>
          <ProposalStoreProvider>
            <Capture />
            <MergedSetupPanel
              caseSetup={caseSetup}
              selectedCase={extra.selectedCase ?? null}
              onCaseDrift={extra.onCaseDrift}
            />
          </ProposalStoreProvider>
        </RunStoreProvider>
      </MergedCoordinatorProvider>
    </LanguageProvider>,
  )
  return { ...utils, runRef }
}

/** Waits for every inline dropdown to land on the single mocked option — the
 * panel's own auto-select effects do this without any user interaction since
 * each registry above has exactly one entry. */
async function waitForSettled() {
  await waitFor(() => expect(screen.getByTestId('merged-route-preset-select')).toHaveValue('preset-route-1'))
  await waitFor(() => expect(screen.getByTestId('merged-trigger-package-select')).toHaveValue('trigger_pkg_1'))
  await waitFor(() => expect(screen.getByTestId('merged-scenario-select')).toHaveValue('scn_fatigue_1'))
  await waitFor(() => expect(screen.getByTestId('merged-service-package-select')).toHaveValue('svc_pkg_1'))
  await waitFor(() => expect(screen.getByTestId('merged-content-package-select')).toHaveValue('content_pkg_1'))
}

describe('two-tier setup editors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
    vi.mocked(mergedQuickview).mockResolvedValue(EMPTY_QUICKVIEW)
    vi.mocked(tickMergedRun).mockResolvedValue(PAUSED_TICK)
  })

  it('opens the trigger editor in the basic view', async () => {
    renderPanel()
    await waitForSettled()
    fireEvent.click(screen.getByTestId('edit-trigger'))

    expect(await screen.findByTestId('setup-basic-trigger')).toBeTruthy()
    expect(screen.queryByTestId('algorithm-formulation-panel')).toBeNull()
  })

  it('shows only the two thresholds in the basic trigger view', async () => {
    renderPanel()
    await waitForSettled()
    fireEvent.click(screen.getByTestId('edit-trigger'))

    expect(await screen.findByTestId('basic-threshold_suggest')).toBeTruthy()
    expect(screen.getByTestId('basic-monotony_suggest_threshold')).toBeTruthy()
  })

  it('reveals the EXISTING editor component on the detailed switch', async () => {
    renderPanel()
    await waitForSettled()
    fireEvent.click(screen.getByTestId('edit-trigger'))
    await screen.findByTestId('setup-basic-trigger')

    fireEvent.click(screen.getByTestId('setup-detailed-toggle'))

    expect(await screen.findByTestId('algorithm-formulation-panel')).toBeTruthy()
  })

  it('switches back to basic', async () => {
    renderPanel()
    await waitForSettled()
    fireEvent.click(screen.getByTestId('edit-trigger'))
    await screen.findByTestId('setup-basic-trigger')
    fireEvent.click(screen.getByTestId('setup-detailed-toggle'))
    await screen.findByTestId('algorithm-formulation-panel')

    fireEvent.click(screen.getByTestId('setup-detailed-toggle'))

    expect(await screen.findByTestId('setup-basic-trigger')).toBeTruthy()
  })

  it('mounts the detailed editor in a WIDE modal', async () => {
    renderPanel()
    await waitForSettled()
    fireEvent.click(screen.getByTestId('edit-trigger'))
    await screen.findByTestId('setup-basic-trigger')

    fireEvent.click(screen.getByTestId('setup-detailed-toggle'))
    await screen.findByTestId('algorithm-formulation-panel')

    expect(document.querySelector('.modal-card--wide')).toBeTruthy()
  })

  it('says so when the case pins nothing in this area', async () => {
    // No case selected — the Situation editor's "what this case fixes"
    // section has nothing to show (07-27 §9.1: say so, not an empty box).
    renderPanel(null)
    await waitForSettled()
    fireEvent.click(screen.getByTestId('edit-situation'))

    expect(await screen.findByTestId('basic-pins-nothing')).toBeTruthy()
  })

  it('badges each control as situation or algorithm', async () => {
    renderPanel()
    await waitForSettled()

    expect(screen.getAllByTestId('setup-badge').length).toBeGreaterThan(0)
  })

  it('never disables a control — the badges are labels, not locks', async () => {
    renderPanel()
    await waitForSettled()

    const comboboxes = screen.getAllByRole('combobox')
    expect(comboboxes.length).toBeGreaterThan(0)
    for (const el of comboboxes) {
      expect((el as HTMLSelectElement).disabled).toBe(false)
    }
  })

  // A case DEFINES a setup, so editing the setup means it is no longer that
  // case: the selection is dropped rather than annotated. (This replaced the
  // earlier "differs from case" note + Reset button.)
  it('clears the case selection once the setup is edited away from it', async () => {
    const onCaseDrift = vi.fn()
    renderPanel(MATCHING_CASE_SETUP, 'en', { onCaseDrift, selectedCase: caseNamed('case-drift-1') })
    await waitForSettled()
    expect(onCaseDrift).not.toHaveBeenCalled()

    // Change the tick duration — the setup now differs from the case's 180s.
    fireEvent.change(screen.getByTestId('merged-tick-seconds-input'), { target: { value: '240' } })

    await waitFor(() => expect(onCaseDrift).toHaveBeenCalled())
  })

  it('keeps the case selected while the setup still matches it', async () => {
    const onCaseDrift = vi.fn()
    renderPanel(MATCHING_CASE_SETUP, 'en', { onCaseDrift, selectedCase: caseNamed('case-drift-2') })
    await waitForSettled()

    expect(onCaseDrift).not.toHaveBeenCalled()
  })

  // ── Review MUST FIX 1: differsFromCase must see contextOverrides too ─────
  // C-02's whole premise is the night context — flipping it while exploring
  // must drop the case, or the right column keeps explaining the decision as
  // though the setup still matched the case.
  it('clears the case selection when a case-pinned context override is flipped', async () => {
    const onCaseDrift = vi.fn()
    const caseWithNightPin: ResolvedCaseSetup = { ...MATCHING_CASE_SETUP, contextOverrides: { is_night: true } }
    renderPanel(caseWithNightPin, 'en', { onCaseDrift, selectedCase: caseNamed('case-drift-3') })
    await waitForSettled()
    expect(onCaseDrift).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('edit-situation'))
    const checkbox = (await screen.findByTestId('basic-is_night')) as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    fireEvent.click(checkbox) // flips to false, away from the case's pinned true

    await waitFor(() => expect(onCaseDrift).toHaveBeenCalled())
  })

  it('renders the basic trigger view bilingually, JA by default', async () => {
    renderPanel(null, 'ja')
    await waitForSettled()
    fireEvent.click(screen.getByTestId('edit-trigger'))
    await screen.findByTestId('setup-basic-trigger')

    // The detailed-toggle button and the thresholds' own manifest labels are
    // Japanese — an earlier task on this branch shipped English inside
    // Japanese sentences and 821 passing tests missed it (see task-18-brief).
    expect(screen.getByTestId('setup-detailed-toggle').textContent).toContain('詳細設定')
    expect(screen.getByText('休憩提案閾値')).toBeTruthy()
    expect(screen.getByText('単調性提案閾値')).toBeTruthy()
  })

  // ── Review Finding 1: sentinel default, not the case's own value ─────────
  it('toggling a case-pinned boolean off then back to the SAME value the case pins keeps the override in the store (review Finding 1)', async () => {
    // The case pins is_night=true precisely BECAUSE the scenario default is
    // false — the exact shape the review flagged as hazardous.
    const caseWithNightPin: ResolvedCaseSetup = { ...MATCHING_CASE_SETUP, contextOverrides: { is_night: true } }
    const { runRef } = renderPanel(caseWithNightPin)
    await waitForSettled()
    fireEvent.click(screen.getByTestId('edit-situation'))

    const checkbox = (await screen.findByTestId('basic-is_night')) as HTMLInputElement
    expect(checkbox.checked).toBe(true)

    fireEvent.click(checkbox) // off
    expect(runRef.current!.state.contextOverrides.is_night).toBe(false)

    fireEvent.click(checkbox) // back on — the SAME value the case itself pins
    // Broken version (default: the case's own value): value===default, the
    // reducer DELETES the key — this would read `undefined` here even
    // though the checkbox still renders checked (its display falls back to
    // the case's value when no override is present).
    expect(runRef.current!.state.contextOverrides.is_night).toBe(true)
    expect('is_night' in runRef.current!.state.contextOverrides).toBe(true)
  })

  // Applying a case is not atomic (profile + route are fetched), so the
  // half-applied setup reads as drift. Clearing on that would cancel the very
  // selection the reviewer just made — the case could never be applied.
  it('does not clear the case while it is still being applied', async () => {
    const onCaseDrift = vi.fn()
    const driftingSetup: ResolvedCaseSetup = { ...MATCHING_CASE_SETUP, tickSeconds: 240 }
    renderPanel(driftingSetup, 'en', { onCaseDrift, selectedCase: caseNamed('case-drift-4') })
    await waitForSettled()

    expect(onCaseDrift).not.toHaveBeenCalled()
  })

  // ── Review Finding 3: the CASE's authored preferences, not the resolved
  // profile's scoring inputs ────────────────────────────────────────────────
  it("shows the persona's authored preferences (not the resolved profile's scoring inputs) in the basic driver-profile view", async () => {
    const testCase: CombinedTestCase = {
      case_id: 'case-test-basic-profile',
      schema_version: '1.0',
      version: '1.0',
      title: { ja: 'テストケース', en: 'Test case' },
      brief: { ja: '', en: '' },
      what_to_watch: [],
      persona: {
        persona_id: 'persona-test',
        name: { ja: 'テスト太郎', en: 'Test Taro' },
        narrative: { ja: '', en: '' },
        preferences: [{ ja: '静かな曲を好む', en: 'Prefers calm music' }],
        profile_ref: 'preset-journey-a-1-cruising-fresh',
      },
      journey: {
        narrative: { ja: '', en: '' },
        scenario_ref: 'scn_fatigue_1',
        route_preset_ref: 'preset-route-1',
        seed: 42,
        tick_seconds: 180,
      },
      algorithm_defaults: { trigger: 'trigger_pkg_1', service: 'svc_pkg_1', content: 'content_pkg_1' },
    }
    const caseSetupForTestCase: ResolvedCaseSetup = { ...MATCHING_CASE_SETUP, profileRef: 'preset-journey-a-1-cruising-fresh' }
    renderPanel(caseSetupForTestCase, 'en', { selectedCase: testCase })
    await waitForSettled()
    fireEvent.click(screen.getByTestId('edit-profile'))

    expect(await screen.findByTestId('basic-persona-preferences')).toHaveTextContent('Prefers calm music')
    // Not the resolved profile's scoring inputs — those aren't rendered here.
    expect(screen.queryByText(/oshi_registered|hobby_interest_tags/i)).toBeNull()
  })

  it('says the persona has no authored preferences rather than showing an empty box', async () => {
    const testCase: CombinedTestCase = {
      case_id: 'case-test-no-prefs',
      schema_version: '1.0',
      version: '1.0',
      title: { ja: 'テストケース', en: 'Test case' },
      brief: { ja: '', en: '' },
      what_to_watch: [],
      persona: {
        persona_id: 'persona-test-2',
        name: { ja: 'テスト次郎', en: 'Test Jiro' },
        narrative: { ja: '', en: '' },
        profile_ref: 'preset-journey-a-1-cruising-fresh',
      },
      journey: {
        narrative: { ja: '', en: '' },
        scenario_ref: 'scn_fatigue_1',
        route_preset_ref: 'preset-route-1',
        seed: 42,
        tick_seconds: 180,
      },
      algorithm_defaults: { trigger: 'trigger_pkg_1', service: 'svc_pkg_1', content: 'content_pkg_1' },
    }
    renderPanel(MATCHING_CASE_SETUP, 'en', { selectedCase: testCase })
    await waitForSettled()
    fireEvent.click(screen.getByTestId('edit-profile'))

    expect(await screen.findByTestId('basic-no-persona-preferences')).toBeTruthy()
  })
})
