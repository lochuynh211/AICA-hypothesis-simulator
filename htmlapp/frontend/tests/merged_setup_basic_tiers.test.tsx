/**
 * BasicTriggerView / BasicSituationView — the basic-tier controls
 * `MergedSetupPanel` mounts inside its Situation / Trigger Edit popups
 * (task 18), covering two bugfixes:
 *
 *  - Bug 2: `BasicTriggerView`'s two thresholds are now MANIFEST-DRIVEN
 *    (`fire_control.threshold_source` / `monotony_threshold_source`), not the
 *    two literal hyperparameter keys of one package
 *    (`threshold_suggest`/`monotony_suggest_threshold`) — a different
 *    package naming its thresholds differently (e.g. nri_fatigue_score_v1's
 *    `threshold_fire`/`threshold_monotony`) must show ITS OWN keys/defaults.
 *
 *  - Bug 3: `BasicSituationView`'s context-override checkboxes and initial
 *    drowsiness/fatigue inputs must read the SAME fallback the DETAILED tier
 *    reads (`FixedConditionsSection`: `contextOverrides[key] ?? scenario[key]
 *    ?? false`) — not the case's pinned value — so the two tiers of the same
 *    popup never disagree once a scenario change has cleared
 *    `contextOverrides`.
 *
 * Both components take their `rs`/`ps`/`scenarioDef`/`manifest` as plain
 * props (see `MergedSetupPanel.tsx`), so they are mounted directly here with
 * hand-built fixtures rather than through the whole panel + its network
 * mocks.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import {
  BasicTriggerView,
  BasicSituationView,
} from '../src/components/merged/MergedSetupPanel'
import { initialState as runStoreInitialState } from '../src/state/runStore'
import type { RunStoreState } from '../src/state/runStore'
import type { ProposalStoreState } from '../src/state/proposalStore'
import type { PackageManifest, ScenarioDef } from '../src/api/types'
import type { ResolvedCaseSetup } from '../src/lib/review/caseResolver'
import type { World } from '../src/api/proposalClient'

// ── Fixtures ─────────────────────────────────────────────────────────────

/** aica_transparent_hybrid_trigger_v1's own threshold keys (fire_control
 * names `threshold_suggest`/`monotony_suggest_threshold`, defaults 0.7/0.5
 * here — deliberately NOT the package's real defaults, so a passing
 * assertion proves the view read THESE fixture's numbers, not some
 * coincidental match). */
const HYBRID_MANIFEST: PackageManifest = {
  id: 'aica_transparent_hybrid_trigger_v1',
  version: '0.2',
  label: { ja: 'ハイブリッド', en: 'Hybrid' },
  compatible_scenario_types: ['uc01_fatigue'],
  algorithm: { type: 'python_module', entrypoint: 'algorithm.py' },
  parameters: [],
  features: [],
  hyperparameters: [
    { key: 'threshold_suggest', label: { ja: '発火しきい値', en: 'Rest Suggest Threshold' }, kind: 'numeric', default: 0.7, min: 0, max: 1, step: 0.01 },
    { key: 'monotony_suggest_threshold', label: { ja: '単調性しきい値', en: 'Monotony Suggest Threshold' }, kind: 'numeric', default: 0.5, min: 0, max: 1, step: 0.01 },
  ],
  trigger_categories: [],
  rules: [],
  fire_control: { threshold_source: 'threshold_suggest', monotony_threshold_source: 'monotony_suggest_threshold', actionability_guard: {} },
  proposals: [],
  feedback_schema: [],
  evidence_metrics: [],
}

/** nri_fatigue_score_v1's own threshold keys (fire_control names
 * `threshold_fire`/`threshold_monotony`, defaults 100/60 — mirrors the real
 * committed manifest under packages/nri_fatigue_score_v1/package.json). */
const NRI_MANIFEST: PackageManifest = {
  id: 'nri_fatigue_score_v1',
  version: '0.1',
  label: { ja: 'NRI', en: 'NRI' },
  compatible_scenario_types: ['uc01_fatigue'],
  algorithm: { type: 'python_module', entrypoint: 'algorithm.py' },
  parameters: [],
  features: [],
  hyperparameters: [
    { key: 'threshold_fire', label: { ja: '休憩提案閾値 (点)', en: 'Rest Suggest Threshold (pts)' }, kind: 'numeric', default: 100, min: 20, max: 200, step: 5 },
    { key: 'threshold_monotony', label: { ja: '単調性提案閾値 (点)', en: 'Monotony Suggest Threshold (pts)' }, kind: 'numeric', default: 60, min: 10, max: 200, step: 5 },
    { key: 'rest_min_gap_after_monotony_min', label: { ja: '休憩提案の単調提案後の最小間隔 (分)', en: 'Rest Min Gap After Monotony (min)' }, kind: 'numeric', default: 20, min: 0, max: 120, step: 1 },
  ],
  trigger_categories: [],
  rules: [],
  fire_control: { threshold_source: 'threshold_fire', monotony_threshold_source: 'threshold_monotony', actionability_guard: {} },
  proposals: [],
  feedback_schema: [],
  evidence_metrics: [],
}

function fixtureProposalState(overrides: Partial<ProposalStoreState> = {}): ProposalStoreState {
  const world = {
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
    driver_profile: {} as World['driver_profile'],
    catalog_ref: { dataset_id: 'ds-1', dataset_version: { schema_version: '1.0.0', spotify_track_reference_version: '1.0.0', spotify_audio_features_reference_version: '1.0.0' }, dataset_hash: 'sha256:abc' },
  } as World
  return {
    uiLanguage: 'en',
    triggerPurpose: 'rest_recommended',
    lifecycleStage: 'before_rest_until_stop',
    motionState: 'driving',
    world,
    selectedSeedId: null,
    selectedProfileId: null,
    selectedPresetId: null,
    presetOverrides: null,
    worldValidationIssues: [],
    datasets: [],
    seeds: [],
    profiles: [],
    presets: [],
    catalog: [],
    catalogTotal: 0,
    servicePackageId: null,
    mode: 'interactive',
    serviceParameterOverrides: {},
    serviceHyperparameterOverrides: {},
    contentPackageId: null,
    contentParameterOverrides: {},
    contentHyperparameterOverrides: {},
    explanationProvider: 'off',
    runLog: null,
    error: null,
    ...overrides,
  } as ProposalStoreState
}

const SCENARIO_NIGHT_FALSE: ScenarioDef = {
  id: 'scn_fatigue_1',
  version: '1.0',
  type: 'fatigue_buildup',
  persona: {},
  route_intent: { rest_facility: { label: 'Roadside Station' }, segments: [] },
  initial_state: { drowsiness_level: '20', fatigue_level: '15' },
  event_presets: { drowsiness_schedule: [], signal_duration_at_trigger: 'persistent' },
  total_duration_seconds: 7200,
  tick_seconds: 60,
  allowed_actions: [],
  review_focus: 'fatigue',
  is_night: false,
} as unknown as ScenarioDef

describe('BasicTriggerView (bug 2 — manifest-driven thresholds, not hardcoded keys)', () => {
  it('reads threshold_suggest/monotony_suggest_threshold (0.7/0.5) for the hybrid package', () => {
    render(
      <BasicTriggerView manifest={HYBRID_MANIFEST} edited={{}} dispatch={vi.fn()} lang="en" />,
    )
    expect((screen.getByTestId('basic-threshold_suggest') as HTMLInputElement).value).toBe('0.7')
    expect((screen.getByTestId('basic-monotony_suggest_threshold') as HTMLInputElement).value).toBe('0.5')
    // Never the raw key when a label exists.
    expect(screen.getByText('Rest Suggest Threshold')).toBeInTheDocument()
    expect(screen.getByText('Monotony Suggest Threshold')).toBeInTheDocument()
  })

  it('reads threshold_fire/threshold_monotony (100/60) for the NRI package — different keys, same view', () => {
    render(
      <BasicTriggerView manifest={NRI_MANIFEST} edited={{}} dispatch={vi.fn()} lang="en" />,
    )
    expect((screen.getByTestId('basic-threshold_fire') as HTMLInputElement).value).toBe('100')
    expect((screen.getByTestId('basic-threshold_monotony') as HTMLInputElement).value).toBe('60')
    // The hybrid package's keys must NOT appear for this manifest.
    expect(screen.queryByTestId('basic-threshold_suggest')).not.toBeInTheDocument()
    expect(screen.queryByTestId('basic-monotony_suggest_threshold')).not.toBeInTheDocument()
  })

  it('degrades gracefully (filter(Boolean)) when a manifest lacks monotony_threshold_source', () => {
    const noMonotony: PackageManifest = {
      ...NRI_MANIFEST,
      fire_control: { threshold_source: 'threshold_fire', actionability_guard: {} },
    }
    render(
      <BasicTriggerView manifest={noMonotony} edited={{}} dispatch={vi.fn()} lang="en" />,
    )
    expect(screen.getByTestId('basic-threshold_fire')).toBeInTheDocument()
    expect(screen.queryByTestId('basic-threshold_monotony')).not.toBeInTheDocument()
  })

  it('shows an edited (non-default) value from `edited`, not the manifest default', () => {
    render(
      <BasicTriggerView manifest={NRI_MANIFEST} edited={{ threshold_fire: 120 }} dispatch={vi.fn()} lang="en" />,
    )
    expect((screen.getByTestId('basic-threshold_fire') as HTMLInputElement).value).toBe('120')
  })

  it('surfaces the rest-after-monotony minimum spacing control (default 20 min) — not named by fire_control', () => {
    render(
      <BasicTriggerView manifest={NRI_MANIFEST} edited={{}} dispatch={vi.fn()} lang="en" />,
    )
    expect((screen.getByTestId('basic-rest_min_gap_after_monotony_min') as HTMLInputElement).value).toBe('20')
  })

  it('edits to the rest-min-gap control dispatch SET_HYPERPARAMETER with the manifest default', () => {
    const dispatch = vi.fn()
    render(
      <BasicTriggerView manifest={NRI_MANIFEST} edited={{}} dispatch={dispatch} lang="en" />,
    )
    fireEvent.change(screen.getByTestId('basic-rest_min_gap_after_monotony_min'), { target: { value: '30' } })
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_HYPERPARAMETER', key: 'rest_min_gap_after_monotony_min', value: 30, default: 20 })
  })

  it('does NOT surface the rest-min-gap control for a package that lacks it (Hybrid)', () => {
    render(
      <BasicTriggerView manifest={HYBRID_MANIFEST} edited={{}} dispatch={vi.fn()} lang="en" />,
    )
    expect(screen.queryByTestId('basic-rest_min_gap_after_monotony_min')).not.toBeInTheDocument()
  })
})

describe('BasicSituationView (bug 3 — same source of truth as the detailed tier)', () => {
  const caseSetupWithIsNightPin: ResolvedCaseSetup = {
    scenarioId: 'scn_fatigue_1',
    routePresetId: 'preset-route-1',
    triggerPackageId: 'nri_fatigue_score_v1',
    servicePackageId: 'svc_pkg_1',
    contentPackageId: 'content_pkg_1',
    seed: 42,
    tickSeconds: 180,
    initialDrowsiness: null,
    initialFatigue: null,
    contextOverrides: { is_night: true },
    situationFields: {},
    mountainRangeKm: null,
    jamRangeKm: null,
    profileRef: 'preset-a',
  }

  it('unchecks is_night when contextOverrides is empty and scenarioDef.is_night=false — even though the case pins is_night=true', () => {
    render(
      <BasicSituationView
        caseSetup={caseSetupWithIsNightPin}
        rs={{ ...runStoreInitialState, contextOverrides: {} } as RunStoreState}
        ps={fixtureProposalState()}
        scenarioDef={SCENARIO_NIGHT_FALSE}
        dispatchRun={vi.fn()}
        dispatchProposal={vi.fn()}
        lang="en"
      />,
    )
    // This is the exact bug-3 mismatch: falling back to the CASE's pinned
    // value (true) would check this box; falling back to the scenario's own
    // default (false) — the same thing the detailed tier reads — leaves it
    // unchecked.
    expect((screen.getByTestId('basic-is_night') as HTMLInputElement).checked).toBe(false)
  })

  it('checks is_night when a live contextOverrides entry is present, regardless of the scenario default', () => {
    render(
      <BasicSituationView
        caseSetup={caseSetupWithIsNightPin}
        rs={{ ...runStoreInitialState, contextOverrides: { is_night: true } } as RunStoreState}
        ps={fixtureProposalState()}
        scenarioDef={SCENARIO_NIGHT_FALSE}
        dispatchRun={vi.fn()}
        dispatchProposal={vi.fn()}
        lang="en"
      />,
    )
    expect((screen.getByTestId('basic-is_night') as HTMLInputElement).checked).toBe(true)
  })

  it('shows the scenario initial_state.drowsiness_level (20) when rs.initialDrowsiness is null, not 0', () => {
    render(
      <BasicSituationView
        caseSetup={caseSetupWithIsNightPin}
        rs={{ ...runStoreInitialState, initialDrowsiness: null, initialFatigue: null } as RunStoreState}
        ps={fixtureProposalState()}
        scenarioDef={SCENARIO_NIGHT_FALSE}
        dispatchRun={vi.fn()}
        dispatchProposal={vi.fn()}
        lang="en"
      />,
    )
    expect((screen.getByTestId('basic-initial_drowsiness') as HTMLInputElement).value).toBe('20')
    expect((screen.getByTestId('basic-initial_fatigue') as HTMLInputElement).value).toBe('15')
  })

  it('shows the live override (not the scenario default) once rs.initialDrowsiness is set', () => {
    render(
      <BasicSituationView
        caseSetup={caseSetupWithIsNightPin}
        rs={{ ...runStoreInitialState, initialDrowsiness: 77, initialFatigue: null } as RunStoreState}
        ps={fixtureProposalState()}
        scenarioDef={SCENARIO_NIGHT_FALSE}
        dispatchRun={vi.fn()}
        dispatchProposal={vi.fn()}
        lang="en"
      />,
    )
    expect((screen.getByTestId('basic-initial_drowsiness') as HTMLInputElement).value).toBe('77')
  })

  it('falls back to 0 when neither the live override nor a scenario initial_state value is available', () => {
    render(
      <BasicSituationView
        caseSetup={caseSetupWithIsNightPin}
        rs={{ ...runStoreInitialState, initialDrowsiness: null, initialFatigue: null } as RunStoreState}
        ps={fixtureProposalState()}
        scenarioDef={null}
        dispatchRun={vi.fn()}
        dispatchProposal={vi.fn()}
        lang="en"
      />,
    )
    expect((screen.getByTestId('basic-initial_drowsiness') as HTMLInputElement).value).toBe('0')
    expect((screen.getByTestId('basic-initial_fatigue') as HTMLInputElement).value).toBe('0')
  })
})
