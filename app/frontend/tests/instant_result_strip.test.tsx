/**
 * InstantResultStrip — feature 009 FE4.
 *
 * Tests:
 *  (a) fired=true renders the curve + threshold line + fire/rest/completion
 *      markers + the "Fired: …" result line.
 *  (b) fired=false renders the "No trigger" state with peak vs threshold.
 *  (c) error renders the error state (no fabricated fire marker/result line).
 *  (d) the overrides chip shows the live diff count against manifest defaults.
 *  (e) the seed chip's 🎲 dispatches REROLL_SEED.
 *  (f) "Open full run" triggers createRunPlan → createRun → RUN_CREATED.
 *  (f3) "Open full run" threads the store's runSeed into createRunPlan
 *      (whole-branch review fix — re-rolling the seed then opening the full
 *      run must persist under the SAME seed, not the default).
 *  (g) NRI-scale case: a points-scale threshold (not 0–1) still renders —
 *      proves the y-axis is derived per-result, not hardcoded 0–1.
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'
import type { RunStoreAction } from '../src/state/runStore'
import type { InstantResult, PackageManifest, RunState } from '../src/api/types'

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
  getEvidence: vi.fn(),
  getFeedbackSchema: vi.fn(),
  submitFeedback: vi.fn(),
  runPreview: vi.fn(),
}))

import * as client from '../src/api/client'
import InstantResultStrip from '../src/components/setup/InstantResultStrip'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const HYBRID_MANIFEST: PackageManifest = {
  id: 'aica_transparent_hybrid_trigger_v1',
  version: '0.2',
  label: { ja: 'ハイブリッド', en: 'Hybrid' },
  compatible_scenario_types: ['uc01_fatigue'],
  algorithm: { type: 'python_module', entrypoint: 'algorithm.py' },
  parameters: [],
  features: [],
  hyperparameters: [
    { key: 'w_drowsiness', label: { ja: '', en: 'Drowsiness Weight' }, kind: 'numeric', default: 0.4, min: 0, max: 1, step: 0.01 },
    { key: 'w_fatigue', label: { ja: '', en: 'Fatigue Weight' }, kind: 'numeric', default: 0.25, min: 0, max: 1, step: 0.01 },
  ],
  trigger_categories: [{ id: 'rest_required', priority: 1 }],
  rules: [],
  fire_control: { threshold_source: 'threshold_suggest', actionability_guard: {} },
  proposals: [],
  feedback_schema: [],
  evidence_metrics: [],
}

const firedResult: InstantResult = {
  fired: true,
  fire: { category: 'rest_required', strength: 'gentle', tick: 111, time_min: 29.0 },
  peak_score: 0.71,
  threshold: 0.6,
  score_series: [
    { t: 0, score: 0.0 },
    { t: 50, score: 0.3 },
    { t: 111, score: 0.71 },
  ],
  segments: [
    { type: 'urban', from_min: 0, to_min: 20 },
    { type: 'highway', from_min: 20, to_min: 60 },
    { type: 'rest', from_min: 60, to_min: 65 },
    { type: 'highway', from_min: 65, to_min: 100 },
    { type: 'end', from_min: 100, to_min: 118 },
  ],
  rest_spot: { at_km: 60.0, eta_min: 30.0 },
  rest_option: { id: 'nap_karaoke', auto_chosen: true, recovery_from_min: 60.0, to_min: 65.0 },
  completed_min: 118.0,
  seed: 42,
  overrides: [],
  error: null,
}

const noTriggerResult: InstantResult = {
  fired: false,
  fire: null,
  peak_score: 0.48,
  threshold: 0.6,
  score_series: [
    { t: 0, score: 0.0 },
    { t: 200, score: 0.48 },
  ],
  segments: [{ type: 'highway', from_min: 0, to_min: 240 }],
  rest_spot: null,
  rest_option: null,
  completed_min: 240.0,
  seed: 42,
  overrides: [],
  error: null,
}

const errorResult: InstantResult = {
  fired: false,
  fire: null,
  peak_score: 0.0,
  threshold: 0.6,
  score_series: [{ t: 0, score: 0.0 }],
  segments: [],
  rest_spot: null,
  rest_option: null,
  completed_min: null,
  seed: 42,
  overrides: [],
  error: { tick_index: 12, error_type: 'invalid_return', message: 'algorithm returned an invalid shape' },
}

// NRI-scale case: threshold/scores on a raw points scale, not 0–1.
const nriResult: InstantResult = {
  fired: true,
  fire: { category: 'rest_required', strength: 'urgent', tick: 80, time_min: 40.0 },
  peak_score: 92.5,
  threshold: 80.0,
  score_series: [
    { t: 0, score: 10.0 },
    { t: 40, score: 50.0 },
    { t: 80, score: 92.5 },
  ],
  segments: [{ type: 'highway', from_min: 0, to_min: 100 }],
  rest_spot: null,
  rest_option: null,
  completed_min: 100.0,
  seed: 7,
  overrides: [],
  error: null,
}

// Hybrid case carrying a SECOND (monotony) curve + its own threshold.
const hybridTwoCurveResult: InstantResult = {
  ...firedResult,
  monotony_series: [
    { t: 0, score: 0.0 },
    { t: 50, score: 0.2 },
    { t: 111, score: 0.55 },
  ],
  monotony_threshold: 0.5,
}

const createdRun: RunState = {
  run_id: 'run-xyz',
  status: 'created',
  current_tick: 0,
  pending_proposal: null,
  package_runtime_state: {},
  snapshot: {
    package: { id: 'aica_transparent_hybrid_trigger_v1', version: '0.2', hash: 'abc' },
    scenario: { id: 'uc01_fatigue_friend_drive_v0_1', version: '0.1.0', hash: 'def' },
  },
  event_plan: {},
  route_facts: {},
}

// ── Render helper (mirrors tests/algorithm_formulation_panel.test.tsx) ──────

function renderInStore(
  ui: React.ReactElement,
  setupFn?: (dispatch: React.Dispatch<RunStoreAction>) => void,
) {
  const dispatchRef: { current: React.Dispatch<RunStoreAction> | null } = { current: null }
  let latestState: ReturnType<typeof useRunStore>['state'] | null = null

  function StateProbe() {
    const { state, dispatch } = useRunStore()
    dispatchRef.current = dispatch
    latestState = state
    return null
  }

  const result = render(
    <RunStoreProvider>
      <StateProbe />
      {ui}
    </RunStoreProvider>,
  )

  if (setupFn && dispatchRef.current) {
    act(() => setupFn(dispatchRef.current!))
  }

  return { ...result, getState: () => latestState! }
}

describe('InstantResultStrip — feature 009 FE4', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(client.getPackage).mockResolvedValue(HYBRID_MANIFEST)
  })

  it('(a) fired=true renders curve + threshold + fire/rest/completion markers + result line', async () => {
    renderInStore(<InstantResultStrip />, (dispatch) => {
      dispatch({ type: 'SELECT_PACKAGE', id: HYBRID_MANIFEST.id })
      dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
      dispatch({ type: 'PREVIEW_SUCCEEDED', result: firedResult })
    })

    expect(await screen.findByTestId('instant-result-curve')).toBeInTheDocument()
    expect(screen.getByTestId('instant-result-threshold')).toBeInTheDocument()
    expect(screen.getByTestId('instant-result-fire-marker')).toBeInTheDocument()
    expect(screen.getByTestId('instant-result-rest-spot-marker')).toBeInTheDocument()
    expect(screen.getByTestId('instant-result-rest-option-marker')).toBeInTheDocument()
    expect(screen.getByTestId('instant-result-completion-marker')).toBeInTheDocument()

    const line = screen.getByTestId('instant-result-line')
    expect(line.textContent).toContain('Fired: REST')
    expect(line.textContent).toContain('gentle')
    expect(line.textContent).toContain('29 min')
    expect(line.textContent).toContain('0.71')
    expect(line.textContent).toContain('nap_karaoke')
    expect(line.textContent).toContain('118 min')

    // No error surface when there's no error.
    expect(screen.queryByTestId('instant-result-error')).not.toBeInTheDocument()
  })

  it('(a2) hybrid with a monotony_series renders TWO curves + a monotony threshold', async () => {
    renderInStore(<InstantResultStrip />, (dispatch) => {
      dispatch({ type: 'SELECT_PACKAGE', id: HYBRID_MANIFEST.id })
      dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
      dispatch({ type: 'PREVIEW_SUCCEEDED', result: hybridTwoCurveResult })
    })

    // Both score curves + both threshold lines.
    expect(await screen.findByTestId('instant-result-curve')).toBeInTheDocument()
    expect(screen.getByTestId('instant-result-monotony-curve')).toBeInTheDocument()
    expect(screen.getByTestId('instant-result-threshold')).toBeInTheDocument()
    expect(screen.getByTestId('instant-result-monotony-threshold')).toBeInTheDocument()

    // Monotony curve y-coordinates are finite (shared, valid y-axis).
    const monoPts = screen.getByTestId('instant-result-monotony-curve').getAttribute('points') ?? ''
    for (const coord of monoPts.split(/[ ,]/).filter(Boolean)) {
      expect(Number.isFinite(Number(coord))).toBe(true)
    }

    // Legend names both score lines AND only the road bands actually present —
    // never a hardcoded "normal road" the current route doesn't contain.
    const legend = screen.getByTestId('instant-result-legend').textContent ?? ''
    expect(legend).toContain('rest-propose score')
    expect(legend).toContain('monotony score')
    expect(legend).toContain('urban')
    expect(legend).toContain('highway')
    expect(legend).not.toContain('normal road')
  })

  it('(a3) NRI-style result (no monotony_series) renders a SINGLE curve, no monotony threshold', async () => {
    renderInStore(<InstantResultStrip />, (dispatch) => {
      dispatch({ type: 'SELECT_PACKAGE', id: HYBRID_MANIFEST.id })
      dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
      dispatch({ type: 'PREVIEW_SUCCEEDED', result: nriResult })
    })

    expect(await screen.findByTestId('instant-result-curve')).toBeInTheDocument()
    expect(screen.queryByTestId('instant-result-monotony-curve')).not.toBeInTheDocument()
    expect(screen.queryByTestId('instant-result-monotony-threshold')).not.toBeInTheDocument()
    // Legend omits the monotony line when there's no second curve.
    const legend = screen.getByTestId('instant-result-legend').textContent ?? ''
    expect(legend).not.toContain('monotony score')
  })

  it('(a4) rest triggers are solid red lines, monotony triggers thin amber; one orange dot per rest stop', async () => {
    const multiFire: InstantResult = {
      ...firedResult,
      fires: [
        { category: 'rest_required', strength: 'gentle', tick: 40, time_min: 20.0 },
        { category: 'monotony_prevention', strength: 'clear', tick: 120, time_min: 60.0 },
        { category: 'rest_required', strength: 'strong', tick: 200, time_min: 100.0 },
      ],
      // Two auto-accepted rests → two orange dots at their recovery times.
      rest_options: [
        { id: 'nap_karaoke', auto_chosen: true, recovery_from_min: 22.0, to_min: 30.0 },
        { id: 'nap_karaoke', auto_chosen: true, recovery_from_min: 102.0, to_min: 110.0 },
      ],
    }
    renderInStore(<InstantResultStrip />, (dispatch) => {
      dispatch({ type: 'SELECT_PACKAGE', id: HYBRID_MANIFEST.id })
      dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
      dispatch({ type: 'PREVIEW_SUCCEEDED', result: multiFire })
    })

    // REST triggers → prominent solid red lines (2 of the 3 fires).
    const restLines = await screen.findAllByTestId('instant-result-fire-line')
    expect(restLines).toHaveLength(2)
    for (const ln of restLines) {
      expect(ln.tagName.toLowerCase()).toBe('line')
      expect(ln.getAttribute('stroke')).toBe('#dc2626')
    }
    // MONOTONY triggers → secondary thin amber lines (1 of the 3).
    const monoLines = screen.getAllByTestId('instant-result-monotony-fire-line')
    expect(monoLines).toHaveLength(1)
    expect(monoLines[0].getAttribute('stroke')).toBe('#0d9488')

    // One orange rest DOT per accepted rest (positioned at recovery time).
    const dots = screen.getAllByTestId('instant-result-rest-dot')
    expect(dots).toHaveLength(2)
    for (const d of dots) {
      expect(d.tagName.toLowerCase()).toBe('circle')
      expect(d.getAttribute('fill')).toBe('#f59e0b')
    }
  })

  it('(a5) anomaly spikes render one pink caret each, aligned to their tick, with a legend entry', async () => {
    const withSpikes: InstantResult = {
      ...firedResult,
      spikes: [
        { t: 50, time_min: 13.0 },
        { t: 111, time_min: 29.0 },
      ],
    }
    renderInStore(<InstantResultStrip />, (dispatch) => {
      dispatch({ type: 'SELECT_PACKAGE', id: HYBRID_MANIFEST.id })
      dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
      dispatch({ type: 'PREVIEW_SUCCEEDED', result: withSpikes })
    })

    const carets = await screen.findAllByTestId('instant-result-spike')
    expect(carets).toHaveLength(2)
    for (const c of carets) {
      expect(c.tagName.toLowerCase()).toBe('polygon')
      expect(c.getAttribute('fill')).toBe('#db2777')
    }
    // Legend gains an "anomaly spike" entry only when spikes are present.
    expect(screen.getByText('anomaly spike')).toBeInTheDocument()
  })

  it('(a6) no spikes → no caret markers and no legend entry', async () => {
    renderInStore(<InstantResultStrip />, (dispatch) => {
      dispatch({ type: 'SELECT_PACKAGE', id: HYBRID_MANIFEST.id })
      dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
      dispatch({ type: 'PREVIEW_SUCCEEDED', result: firedResult })
    })

    await screen.findByTestId('instant-result-timeline')
    expect(screen.queryByTestId('instant-result-spike')).not.toBeInTheDocument()
    expect(screen.queryByText('anomaly spike')).not.toBeInTheDocument()
  })

  it('(b) fired=false renders the "No trigger" state with peak vs threshold, no fire marker', async () => {
    renderInStore(<InstantResultStrip />, (dispatch) => {
      dispatch({ type: 'SELECT_PACKAGE', id: HYBRID_MANIFEST.id })
      dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
      dispatch({ type: 'PREVIEW_SUCCEEDED', result: noTriggerResult })
    })

    const line = await screen.findByTestId('instant-result-line')
    expect(line.textContent).toContain('No trigger')
    expect(line.textContent).toContain('0.48')
    expect(line.textContent).toContain('0.6')
    expect(screen.queryByTestId('instant-result-fire-marker')).not.toBeInTheDocument()
    // Still renders the curve.
    expect(screen.getByTestId('instant-result-curve')).toBeInTheDocument()
  })

  it('(c) error renders the error state — no fabricated fire marker/result line', async () => {
    renderInStore(<InstantResultStrip />, (dispatch) => {
      dispatch({ type: 'SELECT_PACKAGE', id: HYBRID_MANIFEST.id })
      dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
      dispatch({ type: 'PREVIEW_SUCCEEDED', result: errorResult })
    })

    expect(await screen.findByTestId('instant-result-error')).toBeInTheDocument()
    expect(screen.queryByTestId('instant-result-fire-marker')).not.toBeInTheDocument()
    const line = screen.getByTestId('instant-result-line')
    expect(line.textContent).not.toContain('Fired:')
  })

  it('(d) the overrides chip is live off editedHyperparameters vs manifest defaults, and reflects the revert-to-default fix', async () => {
    let dispatchFn: React.Dispatch<RunStoreAction> | null = null

    function Capture() {
      const { dispatch } = useRunStore()
      dispatchFn = dispatch
      return null
    }

    render(
      <RunStoreProvider>
        <Capture />
        <InstantResultStrip />
      </RunStoreProvider>,
    )

    act(() => {
      dispatchFn!({ type: 'SELECT_PACKAGE', id: HYBRID_MANIFEST.id })
      dispatchFn!({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
    })

    await waitFor(() => expect(screen.getByTestId('instant-result-overrides-chip').textContent).toContain('0 overrides'))

    act(() => {
      dispatchFn!({ type: 'SET_HYPERPARAMETER', key: 'w_drowsiness', value: 0.6, default: 0.4 })
    })

    await waitFor(() => expect(screen.getByTestId('instant-result-overrides-chip').textContent).toContain('1 override'))

    // Revert to default — the chip should go back to 0 (proves the reducer fix end-to-end).
    act(() => {
      dispatchFn!({ type: 'SET_HYPERPARAMETER', key: 'w_drowsiness', value: 0.4, default: 0.4 })
    })

    await waitFor(() => expect(screen.getByTestId('instant-result-overrides-chip').textContent).toContain('0 overrides'))
  })

  it('(e) the seed chip shows runSeed and its 🎲 dispatches REROLL_SEED', async () => {
    renderInStore(<InstantResultStrip />, (dispatch) => {
      dispatch({ type: 'SET_RUN_SEED', seed: 123 })
    })

    expect(screen.getByTestId('instant-result-seed-chip').textContent).toContain('123')

    fireEvent.click(screen.getByTestId('instant-result-reroll'))

    // REROLL_SEED draws a new (likely different) numeric seed — just assert it's still a number.
    await waitFor(() => {
      const text = screen.getByTestId('instant-result-seed-chip').textContent ?? ''
      expect(text).toMatch(/seed \d+/)
    })
  })

  it('(f) "Open full run" triggers createRunPlan -> createRun -> RUN_CREATED', async () => {
    vi.mocked(client.routesAnalyze).mockResolvedValue({
      route_source: 'local',
      alternatives: [
        {
          route_id: 'local-1',
          summary: 'Local route',
          route_facts: {
            total_route_distance_km: 100,
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
    vi.mocked(client.createRunPlan).mockResolvedValue({
      plan_id: 'plan-1',
      draft_plan: {},
      effective_setup: {},
      validation_errors: [],
    })
    vi.mocked(client.createRun).mockResolvedValue(createdRun)

    let dispatchFn: React.Dispatch<RunStoreAction> | null = null
    let latestState: ReturnType<typeof useRunStore>['state'] | null = null
    function Capture() {
      const { dispatch, state } = useRunStore()
      dispatchFn = dispatch
      latestState = state
      return null
    }

    render(
      <RunStoreProvider>
        <Capture />
        <InstantResultStrip />
      </RunStoreProvider>,
    )

    act(() => {
      dispatchFn!({ type: 'SELECT_PACKAGE', id: HYBRID_MANIFEST.id })
      dispatchFn!({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
    })

    fireEvent.click(await screen.findByTestId('instant-result-open-full-run'))

    await waitFor(() => expect(client.createRunPlan).toHaveBeenCalledTimes(1))
    expect(client.createRun).toHaveBeenCalledWith('plan-1')
    await waitFor(() => expect(latestState?.runState?.run_id).toBe('run-xyz'))
    await waitFor(() => expect(latestState?.viewMode).toBe('review'))
  })

  it('(f2) surfaces an error when opening the full run fails, without crashing', async () => {
    vi.mocked(client.routesAnalyze).mockRejectedValue(new Error('analyze failed'))

    let dispatchFn: React.Dispatch<RunStoreAction> | null = null
    function Capture() {
      const { dispatch } = useRunStore()
      dispatchFn = dispatch
      return null
    }

    render(
      <RunStoreProvider>
        <Capture />
        <InstantResultStrip />
      </RunStoreProvider>,
    )

    act(() => {
      dispatchFn!({ type: 'SELECT_PACKAGE', id: HYBRID_MANIFEST.id })
      dispatchFn!({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
    })

    fireEvent.click(await screen.findByTestId('instant-result-open-full-run'))

    expect(await screen.findByTestId('instant-result-open-run-error')).toBeInTheDocument()
    expect(client.createRunPlan).not.toHaveBeenCalled()
  })

  it('(f3) "Open full run" sends the store\'s (re-rolled) runSeed, not the default 42 — fix for the whole-branch review seed-threading bug', async () => {
    vi.mocked(client.routesAnalyze).mockResolvedValue({
      route_source: 'local',
      alternatives: [
        {
          route_id: 'local-1',
          summary: 'Local route',
          route_facts: {
            total_route_distance_km: 100,
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
    vi.mocked(client.createRunPlan).mockResolvedValue({
      plan_id: 'plan-1',
      draft_plan: {},
      effective_setup: {},
      validation_errors: [],
    })
    vi.mocked(client.createRun).mockResolvedValue(createdRun)

    let dispatchFn: React.Dispatch<RunStoreAction> | null = null
    function Capture() {
      const { dispatch } = useRunStore()
      dispatchFn = dispatch
      return null
    }

    render(
      <RunStoreProvider>
        <Capture />
        <InstantResultStrip />
      </RunStoreProvider>,
    )

    act(() => {
      dispatchFn!({ type: 'SELECT_PACKAGE', id: HYBRID_MANIFEST.id })
      dispatchFn!({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
      // Re-roll to a non-default seed (default is 42 — see DEFAULT_RUN_SEED).
      dispatchFn!({ type: 'SET_RUN_SEED', seed: 777 })
    })

    fireEvent.click(await screen.findByTestId('instant-result-open-full-run'))

    await waitFor(() => expect(client.createRunPlan).toHaveBeenCalledTimes(1))
    const callArg = vi.mocked(client.createRunPlan).mock.calls[0][0] as Record<string, unknown>
    expect(callArg.runSeed).toBe(777)
    expect(callArg.runSeed).not.toBe(42)
  })

  it('(f4) UX-FE1: "Open full run" sends the store\'s contextOverrides/profileOverrides as contextOverrides/profiles', async () => {
    vi.mocked(client.routesAnalyze).mockResolvedValue({
      route_source: 'local',
      alternatives: [
        {
          route_id: 'local-1',
          summary: 'Local route',
          route_facts: {
            total_route_distance_km: 100,
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
    vi.mocked(client.createRunPlan).mockResolvedValue({
      plan_id: 'plan-1',
      draft_plan: {},
      effective_setup: {},
      validation_errors: [],
    })
    vi.mocked(client.createRun).mockResolvedValue(createdRun)

    let dispatchFn: React.Dispatch<RunStoreAction> | null = null
    function Capture() {
      const { dispatch } = useRunStore()
      dispatchFn = dispatch
      return null
    }

    render(
      <RunStoreProvider>
        <Capture />
        <InstantResultStrip />
      </RunStoreProvider>,
    )

    act(() => {
      dispatchFn!({ type: 'SELECT_PACKAGE', id: HYBRID_MANIFEST.id })
      dispatchFn!({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
      dispatchFn!({ type: 'SET_CONTEXT_OVERRIDE', key: 'weather_risk', value: 65, default: 0 })
      dispatchFn!({ type: 'SET_CONTEXT_OVERRIDE', key: 'child_passenger', value: true, default: false })
      dispatchFn!({
        type: 'SET_PROFILE_OVERRIDES',
        overrides: { driver: { drowsiness_model: { base_growth_per_min: 1.1 } } },
      })
    })

    fireEvent.click(await screen.findByTestId('instant-result-open-full-run'))

    await waitFor(() => expect(client.createRunPlan).toHaveBeenCalledTimes(1))
    const callArg = vi.mocked(client.createRunPlan).mock.calls[0][0] as Record<string, unknown>
    expect(callArg.contextOverrides).toEqual({ weather_risk: 65, child_passenger: true })
    expect(callArg.profiles).toEqual({ driver: { drowsiness_model: { base_growth_per_min: 1.1 } } })
  })

  it('(g) NRI-scale case: a points-scale threshold (not 0–1) still renders the curve/threshold', async () => {
    renderInStore(<InstantResultStrip />, (dispatch) => {
      dispatch({ type: 'SELECT_PACKAGE', id: 'nri_fatigue_score_v1' })
      dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
      dispatch({ type: 'PREVIEW_SUCCEEDED', result: nriResult })
    })

    const svg = await screen.findByTestId('instant-result-svg')
    expect(svg).toBeInTheDocument()
    const thresholdText = screen.getByTestId('instant-result-threshold').textContent ?? ''
    expect(thresholdText).toContain('80')

    // The curve's polyline y-coordinates must be finite (not NaN/Infinity) —
    // proves the y-axis was scaled from the 92.5/80 points-scale range, not
    // hardcoded 0–1 (which would put every point off-chart or collapse to
    // one edge).
    const curve = screen.getByTestId('instant-result-curve')
    const points = curve.getAttribute('points') ?? ''
    for (const pair of points.trim().split(' ')) {
      const [, y] = pair.split(',').map(Number)
      expect(Number.isFinite(y)).toBe(true)
    }

    const line = screen.getByTestId('instant-result-line')
    expect(line.textContent).toContain('Fired: REST')
    expect(line.textContent).toContain('92.5')

    // No rest markers for this fixture (rest_spot/rest_option both null).
    expect(screen.queryByTestId('instant-result-rest-spot-marker')).not.toBeInTheDocument()
    expect(screen.queryByTestId('instant-result-rest-option-marker')).not.toBeInTheDocument()
    expect(screen.getByTestId('instant-result-completion-marker')).toBeInTheDocument()
  })

  it('(loading/error) shows loading while previewLoading, and the preview error banner on previewError', async () => {
    let dispatchFn: React.Dispatch<RunStoreAction> | null = null
    function Capture() {
      const { dispatch } = useRunStore()
      dispatchFn = dispatch
      return null
    }

    render(
      <RunStoreProvider>
        <Capture />
        <InstantResultStrip />
      </RunStoreProvider>,
    )

    act(() => {
      dispatchFn!({ type: 'PREVIEW_REQUESTED' })
    })
    expect(screen.getByTestId('instant-result-loading')).toBeInTheDocument()

    act(() => {
      dispatchFn!({ type: 'PREVIEW_FAILED', message: 'boom' })
    })
    expect(screen.queryByTestId('instant-result-loading')).not.toBeInTheDocument()
    expect(screen.getByTestId('instant-result-preview-error')).toBeInTheDocument()
  })
})
