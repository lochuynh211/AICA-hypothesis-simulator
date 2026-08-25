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
import { useEffect } from 'react'
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
import { LanguageProvider } from '../src/state/language'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'
import { ProposalStoreProvider as _PSP, useProposalStore } from '../src/state/proposalStore'
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
  const rsStore = useRunStore()
  return (
    <>
      <MergedSetupPanel />
      <button type="button" data-testid="test-play" onClick={() => void c.startAndPlay()}>
        play
      </button>
      {/* A stand-in for "the reviewer edited a setup field during a live run" —
          dispatches a real setup change into the shared runStore (issue 2). */}
      <button
        type="button"
        data-testid="test-change-setup"
        onClick={() => rsStore.dispatch({ type: 'SET_TICK_SECONDS', seconds: 42 })}
      >
        change setup
      </button>
      <span data-testid="test-merged-run-id">{c.state.mergedRunId ?? 'none'}</span>
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

  it('shows the preset distance but NOT the unvalidated duration ETA', async () => {
    setupMocks()
    renderPanel()
    const select = await screen.findByTestId('merged-route-preset-select')
    // Distance stays; the "~90 min" / "約90分" ETA is gone.
    expect(select.textContent ?? '').toContain('120 km')
    expect(select.textContent ?? '').not.toContain('90 min')
    expect(select.textContent ?? '').not.toContain('約90分')
    expect(select.textContent ?? '').not.toContain('~90')
  })

  it('no longer renders the removed rest-ceiling editor; the reused spacing editor + a 180s-default tick-duration field remain (owner review)', async () => {
    renderPanel()
    // The Trigger screen's spacing editor, reused verbatim.
    expect(await screen.findByTestId('rest-spacing-editor')).toBeInTheDocument()
    // Task 9: the ceiling editor was removed — reachability is now driven
    // purely by the backend's 30-min ETA filter, not a user-set ceiling.
    expect(screen.queryByTestId('rest-ceiling-editor')).toBeNull()
    // Tick duration defaults to 180s.
    expect((screen.getByTestId('merged-tick-seconds-input') as HTMLInputElement).value).toBe('180')
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

  it('resets the live run when a setup field changes after Play (owner review issue 2)', async () => {
    renderPanel()
    await fillSetup()

    await waitFor(() => expect(screen.getByTestId('test-play')).toBeEnabled())
    fireEvent.click(screen.getByTestId('test-play'))
    await waitFor(() => expect(createMergedRun).toHaveBeenCalledTimes(1))
    // The run now exists (its id is shown by the harness).
    await waitFor(() => expect(screen.getByTestId('test-merged-run-id')).not.toHaveTextContent('none'))

    // Editing a setup field (here: tick duration) invalidates the created run.
    fireEvent.click(screen.getByTestId('test-change-setup'))
    await waitFor(() => expect(screen.getByTestId('test-merged-run-id')).toHaveTextContent('none'))
  })
})

describe("the case's trigger package survives the packages[0] fallback race (S5b bug 2)", () => {
  /**
   * Mirrors what `useCaseSelection`'s synchronous `run`-dispatch loop does on
   * mount (see `useCaseSelection.ts`): it dispatches SELECT_PACKAGE for the
   * case's OWN trigger package synchronously, in a mount effect of a PARENT
   * component — before `MergedSetupPanel`'s own registry-loading effect's
   * `listPackages()` promise gets a chance to resolve (promise callbacks are
   * always deferred to the microtask queue, so they run strictly after every
   * synchronous mount-effect dispatch has already landed).
   *
   * Reproduced directly here (rather than by selecting a real committed case)
   * so this test pins the ordering guarantee itself, independent of which
   * package any individual case currently declares as its default — that
   * data is being migrated by a sibling slice (see the case-catalog/
   * case-resolver test updates in this same change).
   */
  function CaseHarness() {
    const rsStore = useRunStore()
    useEffect(() => {
      rsStore.dispatch({ type: 'SELECT_PACKAGE', id: 'nri_fatigue_score_v1' })
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    return <MergedSetupPanel />
  }

  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
    vi.mocked(mergedQuickview).mockResolvedValue(EMPTY_QUICKVIEW)
    vi.mocked(tickMergedRun).mockResolvedValue(PAUSED_TICK)
  })

  it('leaves the case package selected instead of snapping back to the alphabetically-first registry entry', async () => {
    // The registry lists the case's OWN package SECOND — alphabetically after
    // 'aica_transparent_hybrid_trigger_v1' — so an unconditional
    // `packages[0]` fallback would silently swap the case's algorithm out
    // from under the reviewer the moment `listPackages()` resolves.
    vi.mocked(listPackages).mockResolvedValue({
      packages: [
        {
          id: 'aica_transparent_hybrid_trigger_v1',
          version: '1.0',
          label: { ja: 'x', en: 'x' },
          algorithm_type: 'python_module',
          compatible_scenario_types: ['fatigue_buildup'],
        },
        {
          id: 'nri_fatigue_score_v1',
          version: '1.0',
          label: { ja: 'x', en: 'x' },
          algorithm_type: 'python_module',
          compatible_scenario_types: ['fatigue_buildup'],
        },
      ],
      errors: [],
    })

    render(
      <LanguageProvider initialLanguage="en">
        <MergedCoordinatorProvider>
          <RunStoreProvider>
            <ProposalStoreProvider>
              <CaseHarness />
            </ProposalStoreProvider>
          </RunStoreProvider>
        </MergedCoordinatorProvider>
      </LanguageProvider>,
    )

    const select = (await screen.findByTestId('merged-trigger-package-select')) as HTMLSelectElement
    // Wait for the registry to actually finish loading (both packages present,
    // alongside the placeholder option) before asserting — the bug only shows
    // up once `listPackages()` has resolved and its fallback dispatch (if any)
    // has already fired.
    await waitFor(() =>
      expect(select.querySelector('option[value="nri_fatigue_score_v1"]')).toBeInTheDocument(),
    )
    expect(select.value).toBe('nri_fatigue_score_v1')
  })
})

describe("the case's driver profile survives the default-preset seed race (first-load bug)", () => {
  /**
   * The first-load twin of the packages[0] race above. On the Combined screen
   * `MergedShell` bootstraps the default case, whose `useCaseSelection` fetches
   * the case's own driver profile and dispatches LOAD_CASE_WORLD — while THIS
   * panel's mount effect independently fetches the generic default preset
   * (`preset-journey-a-1-cruising-fresh`) and dispatches LOAD_PRESET, a full
   * world replacement. Both writes target `world.driver_profile`; whichever
   * fetch resolves LAST wins. Over real HTTP the default preset can land after
   * the case's, silently clobbering the case's driver profile with the generic
   * one (the reported bug — htmlapp's in-process transport never reorders, so
   * it doesn't show it).
   *
   * Reproduced deterministically here the same way the packages test does: a
   * PARENT mount effect dispatches the case's LOAD_CASE_WORLD synchronously, so
   * it lands strictly before the panel's `loadDefaultPresetWorld` getPreset
   * promise callback (microtask) runs — pinning the ordering guarantee itself.
   */
  function CaseWorldHarness() {
    const ps = useProposalStore()
    useEffect(() => {
      ps.dispatch({
        type: 'LOAD_CASE_WORLD',
        profileId: 'case-profile',
        profile: { ...fullWorld().driver_profile, age_band: '60plus' },
        situation: fullWorld().situation,
      } as never)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    return (
      <>
        <MergedSetupPanel />
        {/* Read the STORE directly — the bug is the store's driver_profile being
            clobbered, independent of whether that profile matches a dropdown
            option (the case's synthetic profile here does not). */}
        <span data-testid="test-store-age-band">{ps.state.world.driver_profile.age_band}</span>
        <span data-testid="test-store-profile-id">{String(ps.state.selectedProfileId)}</span>
      </>
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
    vi.mocked(mergedQuickview).mockResolvedValue(EMPTY_QUICKVIEW)
    vi.mocked(tickMergedRun).mockResolvedValue(PAUSED_TICK)
  })

  it('keeps the case driver profile instead of letting the generic default preset clobber it', async () => {
    // The default-preset mock (setupMocks) returns fullWorld() with age_band
    // '30s'; the case above pins '60plus'. If the unguarded LOAD_PRESET wins the
    // race, the profile snaps back to '30s'.
    render(
      <LanguageProvider initialLanguage="en">
        <MergedCoordinatorProvider>
          <RunStoreProvider>
            <ProposalStoreProvider>
              <CaseWorldHarness />
            </ProposalStoreProvider>
          </RunStoreProvider>
        </MergedCoordinatorProvider>
      </LanguageProvider>,
    )

    await screen.findByTestId('merged-profile-select')
    // Let the panel's mount fetches (getPreset/getPresets) resolve, so the
    // default-preset seed has had its chance to (wrongly) fire.
    await waitFor(() => expect(getPreset).toHaveBeenCalled())
    // The generic default preset must NOT have overwritten the case's profile.
    await waitFor(() =>
      expect(screen.getByTestId('test-store-age-band')).toHaveTextContent('60plus'),
    )
    expect(screen.getByTestId('test-store-profile-id')).toHaveTextContent('case-profile')
  })
})

describe('explanation-source selector (moved from the proposal panel)', () => {
  it('wires the selector to the shared proposal store', async () => {
    renderPanel()

    const select = (await screen.findByTestId(
      'merged-explanation-provider-select',
    )) as HTMLSelectElement

    // Defaults to the deterministic template — the LLM is opt-in.
    expect(select.value).toBe('off')

    // Round-trips through the scoped proposal store (it is a controlled value,
    // so a stuck display would fail here).
    fireEvent.change(select, { target: { value: 'backend' } })
    await waitFor(() => expect(select.value).toBe('backend'))
  })

  it('offers exactly the three providers', async () => {
    renderPanel()
    const select = (await screen.findByTestId(
      'merged-explanation-provider-select',
    )) as HTMLSelectElement

    // Pinned to the values, not the count.
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['off', 'backend', 'browser'])
  })

  it('has an accessible name', async () => {
    renderPanel()
    // It configures how the rationale is produced; a screen reader must be able
    // to say which control this is.
    expect(await screen.findByLabelText(/Explanation source/i)).toBeInTheDocument()
  })
})

describe('MergedSetupPanel — driver-profile dropdown reflects the store', () => {
  /**
   * Selecting a different test case dispatches LOAD_PROFILE into the shared
   * proposal store (see `useCaseSelection`), which correctly replaces
   * `world.driver_profile`. The dropdown, however, used to render from a LOCAL
   * `selectedProfileKey` that only `loadDefaultPresetWorld` (mount) and
   * `handleSelectProfile` (manual pick) ever wrote — so after the reviewer
   * changed the profile and then switched case, the store said one thing and
   * the control on screen said another. A reviewer files a verdict against the
   * setup the panel SHOWS them, so a stale label here is a wrong-evidence bug,
   * not a cosmetic one.
   */
  function ProfileHarness() {
    const ps = useProposalStore()
    return (
      <>
        <MergedSetupPanel />
        <button
          type="button"
          data-testid="test-load-profile-b"
          onClick={() =>
            ps.dispatch({
              type: 'LOAD_PROFILE',
              profileId: 'preset-b',
              profile: { ...fullWorld().driver_profile, age_band: '60plus' },
            })
          }
        >
          load B
        </button>
      </>
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
    // Two presets carrying DIFFERENT driver profiles, so the dropdown has a
    // second entry to move to (the default mocks only expose one).
    vi.mocked(getPresets).mockResolvedValue({
      presets: [
        { preset_id: 'preset-a', label: { ja: 'A', en: 'Profile A' }, brief: { ja: '', en: '' },
          category: 'baseline', family: 'baseline', journey: null, contrast_with: null, hypothesis: '' },
        { preset_id: 'preset-b', label: { ja: 'B', en: 'Profile B' }, brief: { ja: '', en: '' },
          category: 'baseline', family: 'baseline', journey: null, contrast_with: null, hypothesis: '' },
      ],
    })
    const mk = (id: string, ageBand: string) => ({
      preset_id: id, schema_version: '1.0', label: { ja: id, en: id },
      brief: { ja: '', en: '' }, category: 'baseline', family: 'baseline',
      journey: null, contrast_with: null,
      world: { ...fullWorld(), driver_profile: { ...fullWorld().driver_profile, age_band: ageBand } },
      algorithm_config_overrides: null,
      expectation: { hypothesis: '', expected_top: {}, top_fit_min: 0, gradient: 'none',
        expected_service: { top_should_be_in: [] }, override_required: false },
    })
    vi.mocked(getPreset).mockImplementation(async (id: string) =>
      (id === 'preset-b' ? mk('preset-b', '60plus') : mk('preset-a', '30s')) as never)
    vi.mocked(mergedQuickview).mockResolvedValue(EMPTY_QUICKVIEW)
    // No `tickMergedRun` mock: neither test here starts or ticks a run, and the
    // shared PAUSED_TICK fixture does not typecheck against MergedTickResponse.
  })

  it('follows a LOAD_PROFILE dispatched from outside the panel (i.e. a case switch)', async () => {
    render(
      <LanguageProvider initialLanguage="en">
        <MergedCoordinatorProvider>
          <RunStoreProvider>
            <ProposalStoreProvider>
              <ProfileHarness />
            </ProposalStoreProvider>
          </RunStoreProvider>
        </MergedCoordinatorProvider>
      </LanguageProvider>,
    )

    const select = (await screen.findByTestId('merged-profile-select')) as HTMLSelectElement
    await waitFor(() => expect(select.options.length).toBeGreaterThan(1))
    const before = select.value

    fireEvent.click(screen.getByTestId('test-load-profile-b'))

    await waitFor(() => {
      expect(select.value).not.toBe(before)
    })
    // And it names the profile the store actually holds, not merely "something else".
    expect(JSON.parse(select.value).age_band).toBe('60plus')
  })

  it('says the profile is edited rather than naming a preset it no longer matches', async () => {
    function EditHarness() {
      const ps = useProposalStore()
      return (
        <>
          <MergedSetupPanel />
          <button
            type="button"
            data-testid="test-edit-field"
            onClick={() => ps.dispatch({ type: 'SET_DRIVER_PROFILE_FIELD', key: 'age_band', value: '50s' } as never)}
          >
            edit
          </button>
        </>
      )
    }

    render(
      <LanguageProvider initialLanguage="en">
        <MergedCoordinatorProvider>
          <RunStoreProvider>
            <ProposalStoreProvider>
              <EditHarness />
            </ProposalStoreProvider>
          </RunStoreProvider>
        </MergedCoordinatorProvider>
      </LanguageProvider>,
    )

    const select = (await screen.findByTestId('merged-profile-select')) as HTMLSelectElement
    await waitFor(() => expect(select.options.length).toBeGreaterThan(1))

    fireEvent.click(screen.getByTestId('test-edit-field'))

    // A field edit makes the profile match no preset. The control must say so —
    // silently falling back to the first option would name a profile the run is
    // not using.
    await waitFor(() => expect(select.value).toBe('__edited__'))
    expect(select.selectedOptions[0].textContent).toMatch(/Edited/i)
  })
})
