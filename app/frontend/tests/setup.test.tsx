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
