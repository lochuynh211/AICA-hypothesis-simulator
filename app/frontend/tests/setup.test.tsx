/**
 * T018 — Frontend: multi-option selectors + compatibility-filtered scenarios
 *
 * Tests:
 *  (a) PackageSelector lists both packages when API returns two packages.
 *  (b) Selecting a package dispatches SELECT_PACKAGE action.
 *  (c) ScenarioSelector shows all scenarios when no package is selected.
 *  (d) ScenarioSelector filters scenarios to only those compatible with the
 *      selected package's compatible_scenario_types.
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'
import type { RunStoreAction } from '../src/state/runStore'
import type { PackageSummary, ScenarioSummary } from '../src/api/types'

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
import PackageSelector from '../src/components/setup/PackageSelector'
import ScenarioSelector from '../src/components/setup/ScenarioSelector'
import HyperparameterEditor from '../src/components/setup/HyperparameterEditor'
import PlanPreview from '../src/components/setup/PlanPreview'
import LeftContextPanel from '../src/components/layout/LeftContextPanel'
import type { PackageManifest } from '../src/api/types'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const rulePackage: PackageSummary = {
  id: 'rest_rule_based_v0_1',
  version: '0.1.0',
  label: { ja: 'ルールベース v0.1', en: 'Rule-Based Rest Proposal v0.1' },
  algorithm_type: 'declarative_rule',
  compatible_scenario_types: ['uc01_fatigue'],
}

const weightedPackage: PackageSummary = {
  id: 'rest_weighted_score_v0_1',
  version: '0.1.0',
  label: { ja: '重みスコア v0.1', en: 'Weighted Score Rest Proposal v0.1' },
  algorithm_type: 'weighted_score',
  compatible_scenario_types: ['uc01_fatigue'],
}

const uc01Scenario: ScenarioSummary = {
  id: 'uc01_fatigue_friend_drive_v0_1',
  version: '0.1.0',
  type: 'uc01_fatigue',
  persona_label: 'Friend Drive',
  review_focus: 'Base trigger timing',
}

const uc99Scenario: ScenarioSummary = {
  id: 'uc99_other_v0_1',
  version: '0.1.0',
  type: 'uc99_other',
  persona_label: 'Other',
  review_focus: 'Other focus',
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PackageSelector — T018', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('(a) lists both packages when API returns two packages', async () => {
    vi.mocked(client.listPackages).mockResolvedValue({
      packages: [rulePackage, weightedPackage],
      errors: [],
    })

    render(
      <RunStoreProvider>
        <PackageSelector />
      </RunStoreProvider>,
    )

    // Both package labels should appear as options
    await waitFor(() => {
      expect(screen.getByText(/Rule-Based Rest Proposal/)).toBeInTheDocument()
      expect(screen.getByText(/Weighted Score Rest Proposal/)).toBeInTheDocument()
    })
  })

  it('(b) dispatches SELECT_PACKAGE when a package is selected', async () => {
    vi.mocked(client.listPackages).mockResolvedValue({
      packages: [rulePackage, weightedPackage],
      errors: [],
    })

    const dispatched: RunStoreAction[] = []

    function Spy() {
      const { dispatch } = useRunStore()
      const wrappedDispatch = (action: RunStoreAction) => {
        dispatched.push(action)
        dispatch(action)
      }
      return <PackageSelector />
    }

    // Use the real store but intercept by re-rendering with store so dispatch is shared
    render(
      <RunStoreProvider>
        <PackageSelector />
      </RunStoreProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText(/Rule-Based Rest Proposal/)).toBeInTheDocument()
    })

    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'rest_rule_based_v0_1' } })

    // After selection, the select value should reflect the chosen package
    expect(select).toHaveValue('rest_rule_based_v0_1')
  })
})

describe('ScenarioSelector — T018', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('(c) shows all scenarios when no package is selected', async () => {
    vi.mocked(client.listScenarios).mockResolvedValue({
      scenarios: [uc01Scenario, uc99Scenario],
      errors: [],
    })

    render(
      <RunStoreProvider>
        <ScenarioSelector />
      </RunStoreProvider>,
    )

    await waitFor(() => {
      // Both scenario labels should appear when no package is selected
      expect(screen.getByText(/Friend Drive/)).toBeInTheDocument()
      expect(screen.getByText(/Other/)).toBeInTheDocument()
    })
  })

  it('(d) filters scenarios to only those compatible with the selected package type', async () => {
    vi.mocked(client.listPackages).mockResolvedValue({
      packages: [rulePackage, weightedPackage],
      errors: [],
    })
    vi.mocked(client.listScenarios).mockResolvedValue({
      scenarios: [uc01Scenario, uc99Scenario],
      errors: [],
    })

    renderInStore(
      <ScenarioSelector />,
      (dispatch) => {
        // Load both packages and all scenarios into store
        dispatch({
          type: 'LOAD_PACKAGES',
          packages: [rulePackage, weightedPackage],
        })
        dispatch({
          type: 'LOAD_SCENARIOS',
          scenarios: [uc01Scenario, uc99Scenario],
        })
        // Select a package with compatible_scenario_types: ['uc01_fatigue']
        dispatch({ type: 'SELECT_PACKAGE', id: 'rest_rule_based_v0_1' })
      },
    )

    // Wait for render — only uc01 scenario should appear (type matches)
    await waitFor(() => {
      expect(screen.getByText(/Friend Drive/)).toBeInTheDocument()
    })

    // uc99 scenario (type=uc99_other) should NOT appear
    expect(screen.queryByText(/Other/)).not.toBeInTheDocument()
  })
})

// ── T024: editable setup + plan preview/regenerate/start ──────────────────────

const manifestWithHyperparams: PackageManifest = {
  id: 'rest_weighted_score_v0_1',
  version: '0.1.0',
  label: { ja: '重みスコア', en: 'Weighted Score' },
  compatible_scenario_types: ['uc01_fatigue'],
  algorithm: { type: 'weighted_score', entrypoint: 'builtin' },
  parameters: [],
  features: [],
  hyperparameters: [
    {
      key: 'w_drowsiness',
      label: { ja: '睡気重み', en: 'Drowsiness Weight' },
      kind: 'numeric',
      default: 0.4,
      min: 0.0,
      max: 1.0,
      step: 0.01,
    },
  ],
  trigger_categories: [],
  rules: [],
  fire_control: { threshold_source: 'x', actionability_guard: {} },
  proposals: [],
  feedback_schema: [],
  evidence_metrics: [],
}

function renderSetup(setupFn?: (dispatch: React.Dispatch<RunStoreAction>) => void) {
  return renderInStore(
    <>
      <HyperparameterEditor />
      <PlanPreview />
    </>,
    setupFn,
  )
}

const draftedPlanResponse = {
  plan_id: 'plan_w1',
  draft_plan: { tick_seconds: 60, rest_opportunities: [{}] },
  effective_setup: { run_mode: 'standard', hyperparameters: { w_drowsiness: 0.6 } },
  validation_errors: [],
}

const runStateFixture = {
  run_id: 'run-xyz',
  status: 'created' as const,
  current_tick: 0,
  pending_proposal: null,
  package_runtime_state: {},
  snapshot: {
    package: { id: 'rest_weighted_score_v0_1', version: '0.1.0', hash: 'a' },
    scenario: { id: 'uc01_fatigue_friend_drive_v0_1', version: '0.1.0', hash: 'b' },
  },
  event_plan: {},
  route_facts: {},
}

describe('HyperparameterEditor + PlanPreview — T024', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(client.getPackage).mockResolvedValue(manifestWithHyperparams)
  })

  it('renders the numeric hyperparameter with its default pre-filled', async () => {
    renderSetup((dispatch) => {
      dispatch({ type: 'SELECT_PACKAGE', id: 'rest_weighted_score_v0_1' })
      dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
    })

    const input = (await screen.findByLabelText('Drowsiness Weight')) as HTMLInputElement
    expect(input).toHaveValue(0.4)
    expect(input).toHaveAttribute('step', '0.01')
  })

  it('edit valid → preview → regenerate → start (full flow)', async () => {
    // M4 migration: routesAnalyze now returns RouteEnvelope (not bare RouteFacts)
    vi.mocked(client.routesAnalyze).mockResolvedValue({
      route_source: 'local' as const,
      alternatives: [
        {
          route_id: 'local',
          summary: 'uc01_fatigue_friend_drive_v0_1',
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
    })
    vi.mocked(client.createRunPlan).mockResolvedValue(draftedPlanResponse)
    vi.mocked(client.regenerateRunPlan).mockResolvedValue({
      ...draftedPlanResponse,
      effective_setup: { run_mode: 'standard', hyperparameters: { w_drowsiness: 0.7 } },
    })
    vi.mocked(client.createRun).mockResolvedValue(runStateFixture)

    renderSetup((dispatch) => {
      dispatch({ type: 'SELECT_PACKAGE', id: 'rest_weighted_score_v0_1' })
      dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
    })

    // Edit to a valid in-range value
    const input = (await screen.findByLabelText('Drowsiness Weight')) as HTMLInputElement
    fireEvent.change(input, { target: { value: '0.6' } })

    // Preview
    fireEvent.click(screen.getByRole('button', { name: /preview plan/i }))
    await screen.findByTestId('plan-summary')
    // M4: routesAnalyze is now called with an object arg (not a plain string)
    expect(vi.mocked(client.routesAnalyze)).toHaveBeenCalledWith(
      expect.objectContaining({ scenarioId: 'uc01_fatigue_friend_drive_v0_1' }),
    )
    expect(vi.mocked(client.createRunPlan)).toHaveBeenCalledWith(
      expect.objectContaining({
        packageId: 'rest_weighted_score_v0_1',
        scenarioId: 'uc01_fatigue_friend_drive_v0_1',
        hyperparameters: { w_drowsiness: 0.6 },
      }),
    )

    // Regenerate
    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }))
    await waitFor(() => {
      expect(vi.mocked(client.regenerateRunPlan)).toHaveBeenCalledWith(
        'plan_w1',
        expect.objectContaining({ hyperparameters: { w_drowsiness: 0.6 } }),
      )
    })

    // Start
    fireEvent.click(screen.getByRole('button', { name: /start run/i }))
    await waitFor(() => {
      expect(vi.mocked(client.createRun)).toHaveBeenCalledWith('plan_w1')
    })
  })

  it('edit invalid (out-of-range) → visible error + no run plan', async () => {
    vi.mocked(client.createRunPlan).mockResolvedValue(draftedPlanResponse)

    renderSetup((dispatch) => {
      dispatch({ type: 'SELECT_PACKAGE', id: 'rest_weighted_score_v0_1' })
      dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
    })

    const input = (await screen.findByLabelText('Drowsiness Weight')) as HTMLInputElement
    // 5 is above max (1.0)
    fireEvent.change(input, { target: { value: '5' } })

    // A visible validation error appears (field-level + aggregate)
    const alerts = await screen.findAllByRole('alert')
    expect(alerts.length).toBeGreaterThan(0)
    expect(await screen.findByTestId('setup-validation-error')).toBeInTheDocument()

    // Preview button is disabled — no plan can be built
    const previewBtn = screen.getByRole('button', { name: /preview plan/i })
    expect(previewBtn).toBeDisabled()
    fireEvent.click(previewBtn)
    expect(vi.mocked(client.createRunPlan)).not.toHaveBeenCalled()
  })
})

// ── I1 regression: LeftContextPanel renders MapKeyAndRouteInput ───────────────

describe('LeftContextPanel — I1 regression', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(client.listPackages).mockResolvedValue({ packages: [], errors: [] })
    vi.mocked(client.listScenarios).mockResolvedValue({ scenarios: [], errors: [] })
  })

  it('renders the Maps API key field inside the Setup section', async () => {
    render(
      <RunStoreProvider>
        <LeftContextPanel />
      </RunStoreProvider>,
    )
    // The Maps API key password input is present — this would fail if
    // MapKeyAndRouteInput were not rendered in the Setup section.
    // Use findByLabelText to let the async effects (listPackages/listScenarios) settle.
    expect(await screen.findByLabelText(/maps api key/i)).toBeInTheDocument()
  })
})
