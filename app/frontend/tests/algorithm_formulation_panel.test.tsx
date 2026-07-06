/**
 * AlgorithmFormulationPanel — feature 009 FE3.
 *
 * Tests:
 *  (a) Renders the Hybrid formulation: base_safety_risk formula line with
 *      its feature names + inline coefficient inputs (pre-filled from
 *      manifest defaults).
 *  (b) Editing a coefficient to a NON-default value dispatches
 *      SET_HYPERPARAMETER (verified via the resulting store state).
 *  (c) Editing a coefficient to its OWN default value does NOT add an
 *      override (the key never appears in editedHyperparameters).
 *  (d) Clicking a feature-name cross-link dispatches SET_HIGHLIGHTED_SIGNAL.
 *  (e) Renders the NRI formulation without error (no authored-template gap,
 *      no crash on the differently-shaped package).
 */

import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'
import type { RunStoreAction } from '../src/state/runStore'
import type { PackageManifest } from '../src/api/types'

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
import AlgorithmFormulationPanel from '../src/components/setup/AlgorithmFormulationPanel'

// ── Fixtures (mirror the real manifests' hyperparameters/features) ─────────

const HYBRID_MANIFEST: PackageManifest = {
  id: 'aica_transparent_hybrid_trigger_v1',
  version: '0.2',
  label: { ja: 'ハイブリッド', en: 'Hybrid' },
  compatible_scenario_types: ['uc01_fatigue'],
  algorithm: { type: 'python_module', entrypoint: 'algorithm.py' },
  parameters: [],
  features: [
    { key: 'drowsiness', band_values: [] },
    { key: 'fatigue', band_values: [] },
    { key: 'driving_anomaly', band_values: [] },
    { key: 'driving_time', band_values: [] },
    { key: 'env_load', band_values: [] },
    { key: 'monotony', band_values: [] },
    { key: 'rest_window', band_values: [] },
    { key: 'rest_scarcity', band_values: [] },
    { key: 'familiar_route', band_values: [] },
  ],
  hyperparameters: [
    { key: 'smoothing_alpha', label: { ja: '平滑化係数 α', en: 'Smoothing Alpha' }, kind: 'numeric', default: 0.35, min: 0.05, max: 1.0, step: 0.05 },
    { key: 'w_drowsiness', label: { ja: '', en: 'Drowsiness Weight' }, kind: 'numeric', default: 0.4, min: 0, max: 1, step: 0.01 },
    { key: 'w_fatigue', label: { ja: '', en: 'Fatigue Weight' }, kind: 'numeric', default: 0.25, min: 0, max: 1, step: 0.01 },
    { key: 'w_driving_anomaly', label: { ja: '', en: 'Driving Anomaly Weight' }, kind: 'numeric', default: 0.25, min: 0, max: 1, step: 0.01 },
    { key: 'w_driving_time', label: { ja: '連続運転時間重み', en: 'Time-on-Task Weight' }, kind: 'numeric', default: 0.15, min: 0, max: 1, step: 0.01 },
    { key: 'w_env', label: { ja: '', en: 'Environment Load Weight' }, kind: 'numeric', default: 0.1, min: 0, max: 1, step: 0.01 },
    { key: 'w_child_bonus', label: { ja: '子供同乗ボーナス', en: 'Child-Passenger Rest Bonus' }, kind: 'numeric', default: 0.05, min: 0, max: 1, step: 0.01 },
    { key: 'K', label: { ja: '', en: 'Anomaly-Rate Normalization K' }, kind: 'numeric', default: 5, min: 1, max: 50, step: 1 },
    { key: 'minimum_risk_for_rest_bonus', label: { ja: '', en: 'Minimum Risk for Rest Bonus' }, kind: 'numeric', default: 0.45, min: 0, max: 1, step: 0.01 },
    { key: 'w_rest_window', label: { ja: '', en: 'Rest Window Weight' }, kind: 'numeric', default: 0.1, min: 0, max: 1, step: 0.01 },
    { key: 'w_rest_scarcity', label: { ja: '', en: 'Rest Scarcity Weight' }, kind: 'numeric', default: 0.08, min: 0, max: 1, step: 0.01 },
    { key: 'w_monotony', label: { ja: '', en: 'Monotony Weight' }, kind: 'numeric', default: 0.45, min: 0, max: 1, step: 0.01 },
    { key: 'w_env_mono', label: { ja: '', en: 'Monotony Environment-Load Weight' }, kind: 'numeric', default: 0.3, min: 0, max: 1, step: 0.01 },
    { key: 'w_familiar', label: { ja: '', en: 'Familiar Route Weight' }, kind: 'numeric', default: 0.25, min: 0, max: 1, step: 0.01 },
    { key: 'rest_watch_threshold', label: { ja: '', en: 'Rest Watch Threshold' }, kind: 'numeric', default: 0.45, min: 0, max: 1, step: 0.01 },
    { key: 'threshold_suggest', label: { ja: '', en: 'Rest Suggest Threshold' }, kind: 'numeric', default: 0.58, min: 0, max: 1, step: 0.01 },
    { key: 'threshold_recommend', label: { ja: '', en: 'Rest Recommend Threshold' }, kind: 'numeric', default: 0.76, min: 0, max: 1, step: 0.01 },
    { key: 'threshold_urgent', label: { ja: '', en: 'Rest Urgent Threshold' }, kind: 'numeric', default: 0.88, min: 0, max: 1, step: 0.01 },
    { key: 'monotony_watch_threshold', label: { ja: '', en: 'Monotony Watch Threshold' }, kind: 'numeric', default: 0.4, min: 0, max: 1, step: 0.01 },
    { key: 'monotony_suggest_threshold', label: { ja: '', en: 'Monotony Content-Suggest Threshold' }, kind: 'numeric', default: 0.58, min: 0, max: 1, step: 0.01 },
    { key: 'monotony_recommend_threshold', label: { ja: '', en: 'Monotony Recommend Threshold' }, kind: 'numeric', default: 0.72, min: 0, max: 1, step: 0.01 },
    { key: 'monotony_urgent_threshold', label: { ja: '', en: 'Monotony Urgent Threshold' }, kind: 'numeric', default: 0.85, min: 0, max: 1, step: 0.01 },
    { key: 'rest_persistence_ticks', label: { ja: '', en: 'Rest Persistence Ticks' }, kind: 'numeric', default: 2, min: 1, max: 10, step: 1 },
    { key: 'monotony_persistence_ticks', label: { ja: '', en: 'Monotony Persistence Ticks' }, kind: 'numeric', default: 3, min: 1, max: 10, step: 1 },
    { key: 'skip_if_score', label: { ja: '', en: 'Skip-If Score Threshold' }, kind: 'numeric', default: 0.88, min: 0, max: 1, step: 0.01 },
    { key: 'skip_if_velocity', label: { ja: '', en: 'Skip-If Velocity Threshold' }, kind: 'numeric', default: 0.08, min: 0, max: 1, step: 0.01 },
    { key: 'emergency_override_threshold', label: { ja: '', en: 'Emergency Override Threshold' }, kind: 'numeric', default: 0.88, min: 0, max: 1, step: 0.01 },
    { key: 'rest_cooldown_sec', label: { ja: '', en: 'Rest Cooldown (sec)' }, kind: 'numeric', default: 600, min: 0, max: 3600, step: 30 },
    { key: 'monotony_cooldown_sec', label: { ja: '', en: 'Monotony Cooldown (sec)' }, kind: 'numeric', default: 900, min: 0, max: 3600, step: 30 },
    { key: 'max_proposals_per_30min', label: { ja: '', en: 'Max Proposals per 30 min' }, kind: 'numeric', default: 3, min: 1, max: 10, step: 1 },
  ],
  trigger_categories: [
    { id: 'rest_required', priority: 1 },
    { id: 'monotony_prevention', priority: 2 },
  ],
  rules: [],
  fire_control: { threshold_source: 'threshold_suggest', actionability_guard: {} },
  proposals: [],
  feedback_schema: [],
  evidence_metrics: [],
}

const NRI_MANIFEST: PackageManifest = {
  id: 'nri_fatigue_score_v1',
  version: '0.1',
  label: { ja: 'NRI', en: 'NRI' },
  compatible_scenario_types: ['uc01_fatigue'],
  algorithm: { type: 'python_module', entrypoint: 'algorithm.py' },
  parameters: [],
  features: [
    { key: 'drowsiness', band_values: [] },
    { key: 'fatigue', band_values: [] },
    { key: 'driving_anomaly', band_values: [] },
    { key: 'future_fatigue', band_values: [] },
    { key: 'rest_window', band_values: [] },
    { key: 'rest_scarcity', band_values: [] },
    { key: 'monotony', band_values: [] },
    { key: 'familiar_route', band_values: [] },
    { key: 'attention_drop', band_values: [] },
    { key: 'traffic_jam', band_values: [] },
    { key: 'long_highway', band_values: [] },
  ],
  hyperparameters: [
    { key: 'w_base', label: { ja: '', en: 'Base Accumulation Rate' }, kind: 'numeric', default: 0.5, min: 0.1, max: 2, step: 0.05 },
    { key: 'w_child', label: { ja: '', en: 'Child Passenger Offset' }, kind: 'numeric', default: 20, min: 0, max: 50, step: 1 },
    { key: 'm_night', label: { ja: '', en: 'Night Multiplier' }, kind: 'numeric', default: 1.2, min: 1, max: 2, step: 0.05 },
    { key: 'm_familiar', label: { ja: '', en: 'Familiar Route Multiplier' }, kind: 'numeric', default: 1.2, min: 1, max: 2, step: 0.05 },
    { key: 'w_jam', label: { ja: '', en: 'Traffic Jam Weight' }, kind: 'numeric', default: 0.8, min: 0, max: 3, step: 0.05 },
    { key: 'w_highway', label: { ja: '', en: 'Highway Weight' }, kind: 'numeric', default: 0.2, min: 0, max: 2, step: 0.05 },
    { key: 'w_monotonous', label: { ja: '', en: 'Monotonous Road Weight' }, kind: 'numeric', default: 0.3, min: 0, max: 2, step: 0.05 },
    { key: 'theta_sleep', label: { ja: '', en: 'Drowsiness Dead-zone Threshold' }, kind: 'numeric', default: 60, min: 0, max: 100, step: 5 },
    { key: 'w_sleep', label: { ja: '', en: 'Drowsiness Penalty Weight' }, kind: 'numeric', default: 1.5, min: 0, max: 5, step: 0.1 },
    { key: 'theta_fatigue', label: { ja: '', en: 'Fatigue Dead-zone Threshold' }, kind: 'numeric', default: 60, min: 0, max: 100, step: 5 },
    { key: 'w_fatigue', label: { ja: '', en: 'Fatigue Penalty Weight' }, kind: 'numeric', default: 1.5, min: 0, max: 5, step: 0.1 },
    { key: 'threshold_fire', label: { ja: '', en: 'Fire Threshold' }, kind: 'numeric', default: 80, min: 20, max: 200, step: 5 },
    { key: 'rest_spot_eta_filter_min', label: { ja: '', en: 'Rest Spot ETA Filter' }, kind: 'numeric', default: 15, min: 1, max: 60, step: 1 },
  ],
  trigger_categories: [{ id: 'rest_required', priority: 1 }],
  rules: [],
  fire_control: { threshold_source: 'threshold_fire', actionability_guard: {} },
  proposals: [],
  feedback_schema: [],
  evidence_metrics: [],
}

// ── Render helper (mirrors tests/signals_panel.test.tsx) ────────────────────

function StateProbe() {
  const { state } = useRunStore()
  return (
    <div
      data-testid="state-probe"
      data-hyperparams={JSON.stringify(state.editedHyperparameters)}
      data-highlighted={state.highlightedSignalKey ?? ''}
    />
  )
}

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
      <StateProbe />
      {ui}
    </RunStoreProvider>,
  )

  if (setupFn && dispatchRef.current) {
    act(() => setupFn(dispatchRef.current!))
  }

  return { ...result, dispatch: dispatchRef.current as React.Dispatch<RunStoreAction> }
}

function editedHyperparams(): Record<string, unknown> {
  const el = screen.getByTestId('state-probe')
  return JSON.parse(el.getAttribute('data-hyperparams') ?? '{}')
}

function highlightedKey(): string {
  return screen.getByTestId('state-probe').getAttribute('data-highlighted') ?? ''
}

describe('AlgorithmFormulationPanel — feature 009 FE3', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // UX-FE1: PackageSelector now renders at the top of this panel — its own
    // effect calls listPackages() on mount, so it must resolve here too.
    vi.mocked(client.listPackages).mockResolvedValue({ packages: [], errors: [] })
  })

  it('(a) renders the Hybrid formulation with feature names + inline coefficient inputs', async () => {
    vi.mocked(client.getPackage).mockResolvedValue(HYBRID_MANIFEST)

    renderInStore(<AlgorithmFormulationPanel />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_recovery_v0_1' })
      dispatch({ type: 'SELECT_PACKAGE', id: HYBRID_MANIFEST.id })
    })

    await waitFor(() => {
      expect(screen.getByTestId('formula-line-base_safety_risk')).toBeInTheDocument()
    })

    // Feature names appear as cross-links inside the base_safety_risk line.
    // 'drowsiness'/'fatigue' are real signals (signalLabels.ts) so UX-FE3
    // renders their localized label ("Drowsiness"/"Fatigue"), not the raw
    // key; 'driving_anomaly'/'env_load' are computed formula quantities with
    // no registry entry, so they still render as their own math notation.
    const line = screen.getByTestId('formula-line-base_safety_risk')
    expect(line.textContent).toContain('Drowsiness')
    expect(line.textContent).toContain('Fatigue')
    // #2: features render as localized text, not raw variable names.
    expect(line.textContent).toContain('Driving Anomaly')
    expect(line.textContent).toContain('Environmental Load')
    expect(line.textContent).not.toContain('env_load')

    // Inline coefficient inputs, pre-filled from manifest defaults.
    expect((screen.getByTestId('coef-w_drowsiness') as HTMLInputElement).value).toBe('0.4')
    expect((screen.getByTestId('coef-w_fatigue') as HTMLInputElement).value).toBe('0.25')
    expect((screen.getByTestId('coef-w_driving_anomaly') as HTMLInputElement).value).toBe('0.25')
    expect((screen.getByTestId('coef-w_env') as HTMLInputElement).value).toBe('0.1')

    // The two new terms live INSIDE the formula, not in an "Other" bucket:
    // w_driving_time in base_safety_risk, w_child_bonus in rest_required.
    expect(line.textContent).toContain('Time-on-Task')
    expect((screen.getByTestId('coef-w_driving_time') as HTMLInputElement).value).toBe('0.15')
    const restLine = screen.getByTestId('formula-line-rest_required_score')
    expect(restLine.textContent).toContain('Child Passenger') // localized childPassenger cross-link
    expect((screen.getByTestId('coef-w_child_bonus') as HTMLInputElement).value).toBe('0.05')
    // No leftover "Other" section — every hyperparameter is placed in context.
    expect(screen.queryByTestId('formulation-section-other')).toBeNull()

    // rest_required / monotony_prevention / fire-control sections present.
    expect(screen.getByTestId('formulation-section-rest_required')).toBeInTheDocument()
    expect(screen.getByTestId('formulation-section-monotony_prevention')).toBeInTheDocument()
    expect(screen.getByTestId('formulation-section-fire_control')).toBeInTheDocument()
  })

  it('(b) editing a coefficient to a NON-default value dispatches SET_HYPERPARAMETER', async () => {
    vi.mocked(client.getPackage).mockResolvedValue(HYBRID_MANIFEST)

    renderInStore(<AlgorithmFormulationPanel />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_recovery_v0_1' })
      dispatch({ type: 'SELECT_PACKAGE', id: HYBRID_MANIFEST.id })
    })

    const input = await screen.findByTestId('coef-w_drowsiness')
    fireEvent.change(input, { target: { value: '0.45' } })

    await waitFor(() => {
      expect(editedHyperparams().w_drowsiness).toBe(0.45)
    })
  })

  it('(c) editing a coefficient to its own default value does NOT add an override', async () => {
    vi.mocked(client.getPackage).mockResolvedValue(HYBRID_MANIFEST)

    renderInStore(<AlgorithmFormulationPanel />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_recovery_v0_1' })
      dispatch({ type: 'SELECT_PACKAGE', id: HYBRID_MANIFEST.id })
    })

    // w_fatigue defaults to 0.25 and has never been touched; typing the same
    // default value in must not add it to editedHyperparameters.
    const input = await screen.findByTestId('coef-w_fatigue')
    fireEvent.change(input, { target: { value: '0.25' } })

    // Give any (incorrect) dispatch a chance to land before asserting absence.
    await waitFor(() => expect((input as HTMLInputElement).value).toBe('0.25'))
    expect(editedHyperparams().w_fatigue).toBeUndefined()
  })

  it('(d) clicking a feature-name cross-link dispatches SET_HIGHLIGHTED_SIGNAL', async () => {
    vi.mocked(client.getPackage).mockResolvedValue(HYBRID_MANIFEST)

    renderInStore(<AlgorithmFormulationPanel />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_recovery_v0_1' })
      dispatch({ type: 'SELECT_PACKAGE', id: HYBRID_MANIFEST.id })
    })

    await waitFor(() => {
      expect(screen.getAllByTestId('formula-link-drowsiness').length).toBeGreaterThan(0)
    })
    const link = screen.getAllByTestId('formula-link-drowsiness')[0]
    fireEvent.click(link)

    await waitFor(() => expect(highlightedKey()).toBe('drowsiness'))
  })

  it('(g) UX-FE3: renders a hyperparameter by its manifest label (not its key), switching with uiLanguage', async () => {
    vi.mocked(client.getPackage).mockResolvedValue(HYBRID_MANIFEST)

    const { dispatch } = renderInStore(<AlgorithmFormulationPanel />, (d) => {
      d({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_recovery_v0_1' })
      d({ type: 'SELECT_PACKAGE', id: HYBRID_MANIFEST.id })
    })

    // fire_control renders each stage's coefficient with its manifest label as
    // visible text (not the raw key), inside the step-by-step explanation.
    const section = await screen.findByTestId('formulation-section-fire_control')
    expect(section).toHaveTextContent('Smoothing Alpha')
    expect(section).not.toHaveTextContent('smoothing_alpha')

    act(() => dispatch({ type: 'SET_LANGUAGE', lang: 'ja' }))
    await waitFor(() => {
      expect(screen.getByTestId('formulation-section-fire_control')).toHaveTextContent('平滑化係数 α')
    })
  })

  it('(i) #4: env_load + monotony live in a separate "combined features" section, not among per-signal features', async () => {
    vi.mocked(client.getPackage).mockResolvedValue(HYBRID_MANIFEST)

    renderInStore(<AlgorithmFormulationPanel />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_recovery_v0_1' })
      dispatch({ type: 'SELECT_PACKAGE', id: HYBRID_MANIFEST.id })
    })

    const combined = await screen.findByTestId('formulation-section-combined')
    expect(within(combined).getByTestId('formula-line-env_load')).toBeInTheDocument()
    expect(within(combined).getByTestId('formula-line-monotony')).toBeInTheDocument()

    // The per-signal Features section must NOT contain the combined ones.
    const features = screen.getByTestId('formulation-section-features')
    expect(within(features).queryByTestId('formula-line-env_load')).toBeNull()
  })

  it('(j) #3+#2: feature output lines read as localized text (Normalized Drowsiness / Environmental Load)', async () => {
    vi.mocked(client.getPackage).mockResolvedValue(HYBRID_MANIFEST)

    renderInStore(<AlgorithmFormulationPanel />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_recovery_v0_1' })
      dispatch({ type: 'SELECT_PACKAGE', id: HYBRID_MANIFEST.id })
    })

    const drow = await screen.findByTestId('formula-line-drowsiness')
    expect(drow.textContent).toContain('Normalized Drowsiness')
    const env = screen.getByTestId('formula-line-env_load')
    expect(env.textContent).toContain('Environmental Load')
  })

  it('(k) #1: features referenced in the score formulas are wired cross-links (highlight their feature line)', async () => {
    vi.mocked(client.getPackage).mockResolvedValue(HYBRID_MANIFEST)

    renderInStore(<AlgorithmFormulationPanel />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_recovery_v0_1' })
      dispatch({ type: 'SELECT_PACKAGE', id: HYBRID_MANIFEST.id })
    })

    const base = await screen.findByTestId('formula-line-base_safety_risk')
    // env_load / driving_anomaly / driving_time inside base_safety_risk are links.
    const envLink = within(base).getByTestId('formula-link-env_load')
    expect(within(base).getByTestId('formula-link-driving_anomaly')).toBeInTheDocument()
    expect(within(base).getByTestId('formula-link-driving_time')).toBeInTheDocument()

    // Hovering the link highlights the env_load quantity across the panel.
    fireEvent.mouseEnter(envLink)
    await waitFor(() => expect(highlightedKey()).toBe('env_load'))

    // And the env_load feature DEFINITION line reflects the highlight (wired both ways).
    const envDef = screen.getByTestId('formula-line-env_load')
    expect(envDef.getAttribute('data-highlighted')).toBe('true')
  })

  it('(l) #1: signals inside the combined-feature definitions wire to their SignalsPanel rows', async () => {
    vi.mocked(client.getPackage).mockResolvedValue(HYBRID_MANIFEST)

    renderInStore(<AlgorithmFormulationPanel />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_recovery_v0_1' })
      dispatch({ type: 'SELECT_PACKAGE', id: HYBRID_MANIFEST.id })
    })

    const env = await screen.findByTestId('formula-line-env_load')
    // env_load blends Traffic Jam + Highway(segmentType) + Weather Risk signals.
    // Traffic Jam is referenced twice (the boolean gate and the jam-minutes term),
    // so both wire to the isTrafficJam row.
    expect(within(env).getAllByTestId('formula-link-isTrafficJam').length).toBeGreaterThanOrEqual(1)
    expect(within(env).getByTestId('formula-link-weatherRisk')).toBeInTheDocument()
    const mono = screen.getByTestId('formula-line-monotony')
    expect(within(mono).getByTestId('formula-link-isNight')).toBeInTheDocument()
  })

  it('(m) bins() features expose an ⓘ that reveals the band table (ranges + values)', async () => {
    vi.mocked(client.getPackage).mockResolvedValue(HYBRID_MANIFEST)

    renderInStore(<AlgorithmFormulationPanel />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_recovery_v0_1' })
      dispatch({ type: 'SELECT_PACKAGE', id: HYBRID_MANIFEST.id })
    })

    const btn = await screen.findByTestId('formula-bin-info-driving_time')
    fireEvent.click(btn)
    const bands = await screen.findByTestId('formula-bin-bands-driving_time')
    expect(bands.textContent).toMatch(/60/) // a band boundary
    expect(bands.textContent).toContain('0.4') // a band value
    expect(bands.textContent).toContain('1.0')

    // rest_window is banded too.
    expect(screen.getByTestId('formula-bin-info-rest_window')).toBeInTheDocument()
  })

  it('(n) threshold reads name the compared score and what each level does', async () => {
    vi.mocked(client.getPackage).mockResolvedValue(HYBRID_MANIFEST)

    renderInStore(<AlgorithmFormulationPanel />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_recovery_v0_1' })
      dispatch({ type: 'SELECT_PACKAGE', id: HYBRID_MANIFEST.id })
    })

    const thr = await screen.findByTestId('formula-threshold-rest_required')
    // Names the score being compared (localized), and links to its definition line.
    expect(thr.textContent).toMatch(/Rest-Required Score/i)
    expect(within(thr).getByTestId('formula-link-rest_required_score')).toBeInTheDocument()
    // Shows the comparison operator explicitly on each level.
    expect(thr.textContent).toContain('≥')
    // Explains what crossing each level does.
    expect(thr.textContent).toMatch(/watch/i)
    expect(thr.textContent).toMatch(/proposal|suggest/i)
  })

  it('(o) the emergency step spells out that it overrides cooldown and the 30-min cap', async () => {
    vi.mocked(client.getPackage).mockResolvedValue(HYBRID_MANIFEST)

    renderInStore(<AlgorithmFormulationPanel />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_recovery_v0_1' })
      dispatch({ type: 'SELECT_PACKAGE', id: HYBRID_MANIFEST.id })
    })

    const section = await screen.findByTestId('formulation-section-fire_control')
    const emg = within(section).getByTestId('formulation-step-fire_control-3')
    expect(emg.textContent).toMatch(/cooldown/i)
    expect(emg.textContent).toMatch(/30/)
    expect(emg.textContent).toMatch(/even|override|regardless/i)
  })

  it('(p) each fire-control threshold names WHAT is compared (operand + operator + outcome)', async () => {
    vi.mocked(client.getPackage).mockResolvedValue(HYBRID_MANIFEST)

    renderInStore(<AlgorithmFormulationPanel />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_recovery_v0_1' })
      dispatch({ type: 'SELECT_PACKAGE', id: HYBRID_MANIFEST.id })
    })

    const section = await screen.findByTestId('formulation-section-fire_control')
    const text = section.textContent || ''
    // Operands are named for each threshold, and skip-if/emergency name BOTH
    // scores explicitly (they are two independent scores, not one final score).
    expect(text).toMatch(/Rest-Required.*Monotony|Monotony.*Rest-Required/i)
    expect(text).toMatch(/tick/i) // persistence compares consecutive ticks
    expect(text).toMatch(/second/i) // cooldown compares seconds since last proposal
    expect(text).toMatch(/30 min/i) // rate cap compares proposals in 30 minutes
    // Comparison operators are shown explicitly.
    expect(text).toContain('≥')
    expect(text).toContain('<')
    // The threshold hyperparameters are still editable inline.
    expect(within(section).getByTestId('coef-skip_if_velocity')).toBeInTheDocument()
    expect(within(section).getByTestId('coef-emergency_override_threshold')).toBeInTheDocument()
  })

  it('(r) fire-control step explanations are localized to Japanese', async () => {
    vi.mocked(client.getPackage).mockResolvedValue(HYBRID_MANIFEST)

    const { dispatch } = renderInStore(<AlgorithmFormulationPanel />, (d) => {
      d({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_recovery_v0_1' })
      d({ type: 'SELECT_PACKAGE', id: HYBRID_MANIFEST.id })
    })
    await screen.findByTestId('formulation-section-fire_control')

    act(() => dispatch({ type: 'SET_LANGUAGE', lang: 'ja' }))
    await waitFor(() => {
      const section = screen.getByTestId('formulation-section-fire_control')
      // Step prose (not just coef labels) is Japanese.
      expect(section.textContent).toMatch(/平滑化|クールダウン|持続ゲート/)
    })
    // And no English step prose leaks through.
    expect(screen.getByTestId('formulation-section-fire_control').textContent).not.toMatch(/Smoothing —/)
  })

  it('(q) the smoothing step shows the EWMA formula that α drives', async () => {
    vi.mocked(client.getPackage).mockResolvedValue(HYBRID_MANIFEST)

    renderInStore(<AlgorithmFormulationPanel />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_recovery_v0_1' })
      dispatch({ type: 'SELECT_PACKAGE', id: HYBRID_MANIFEST.id })
    })

    const section = await screen.findByTestId('formulation-section-fire_control')
    const step0 = within(section).getByTestId('formulation-step-fire_control-0')
    expect(step0.textContent).toMatch(/smoothed\[t\]/)
    expect(step0.textContent).toContain('α')
    expect(step0.textContent).toMatch(/1\s*[−-]\s*α/) // the (1 − α) term
    // α remains editable inline.
    expect(within(step0).getByTestId('coef-smoothing_alpha')).toBeInTheDocument()
  })

  it('(h) fire-control is a step-by-step explanation, each stage naming the hyperparameter it uses', async () => {
    vi.mocked(client.getPackage).mockResolvedValue(HYBRID_MANIFEST)

    renderInStore(<AlgorithmFormulationPanel />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_recovery_v0_1' })
      dispatch({ type: 'SELECT_PACKAGE', id: HYBRID_MANIFEST.id })
    })

    const section = await screen.findByTestId('formulation-section-fire_control')

    // Numbered explanatory steps (not a bare parameter list).
    const steps = within(section).getAllByTestId(/^formulation-step-fire_control-/)
    expect(steps.length).toBeGreaterThanOrEqual(5)

    // The step text explains the fire-control pipeline in words.
    expect(section.textContent).toMatch(/persist/i)
    expect(section.textContent).toMatch(/cooldown/i)
    expect(section.textContent).toMatch(/emergenc/i)

    // Every fire-control hyperparameter is still an editable inline coefficient,
    // now shown within the stage that uses it.
    for (const key of [
      'smoothing_alpha',
      'rest_persistence_ticks',
      'skip_if_score',
      'skip_if_velocity',
      'emergency_override_threshold',
      'rest_cooldown_sec',
      'max_proposals_per_30min',
    ]) {
      expect(within(section).getByTestId(`coef-${key}`)).toBeInTheDocument()
    }
  })

  it('(f) UX-FE1: renders PackageSelector at the top once the scenario step unlocks it, before a package is selected', async () => {
    // Feature 009 forced order: the package step is gated behind a scenario.
    renderInStore(<AlgorithmFormulationPanel />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_recovery_v0_1' })
    })

    // The "Algorithm Package" select is now rendered inside this panel,
    // regardless of whether a package is already selected.
    await waitFor(() => {
      expect(screen.getByLabelText(/Algorithm Package/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/Select a package to view its formulation\./)).toBeInTheDocument()
  })

  it('(g) feature 009: the package step is locked until a scenario is selected', async () => {
    renderInStore(<AlgorithmFormulationPanel />)
    // No scenario yet → the package gate shows its lock hint and no formulation prompt.
    expect(await screen.findByTestId('package-gate')).toHaveAttribute('data-locked', 'true')
    expect(screen.queryByText(/Select a package to view its formulation\./)).not.toBeInTheDocument()
  })

  it('(e) renders the NRI formulation without error', async () => {
    vi.mocked(client.getPackage).mockResolvedValue(NRI_MANIFEST)

    renderInStore(<AlgorithmFormulationPanel />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_recovery_v0_1' })
      dispatch({ type: 'SELECT_PACKAGE', id: NRI_MANIFEST.id })
    })

    await waitFor(() => {
      expect(screen.getByTestId('formula-line-S_total')).toBeInTheDocument()
    })
    expect(screen.getByTestId('formula-line-S_base')).toBeInTheDocument()
    expect(screen.getByTestId('formula-line-S_env')).toBeInTheDocument()
    expect(screen.getByTestId('formula-line-S_realtime')).toBeInTheDocument()
    // No "coef-missing-*" placeholders — every referenced hyperparameter key
    // exists in the fixture manifest.
    expect(screen.queryAllByTestId(/coef-missing-/).length).toBe(0)
  })

  it('(u) NRI S_env terms wire to their real source signals (isTrafficJam / segmentType)', async () => {
    vi.mocked(client.getPackage).mockResolvedValue(NRI_MANIFEST)

    renderInStore(<AlgorithmFormulationPanel />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_recovery_v0_1' })
      dispatch({ type: 'SELECT_PACKAGE', id: NRI_MANIFEST.id })
    })

    const env = await screen.findByTestId('formula-line-S_env')
    // jam-minutes wire to the Traffic Jam signal; highway/monotonous minutes to Segment Type.
    expect(within(env).getByTestId('formula-link-isTrafficJam')).toBeInTheDocument()
    expect(within(env).getAllByTestId('formula-link-segmentType').length).toBeGreaterThanOrEqual(2)
    // The terms read as cumulative minutes, not bare signal names.
    expect(env.textContent).toMatch(/min/i)
  })
})
