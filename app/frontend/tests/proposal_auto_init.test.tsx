import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProposalStoreProvider } from '../src/state/proposalStore'
import ProposalScreen from '../src/components/proposal/ProposalScreen'

// Mock the client so the panels never hit the network. getPreset/createRun are
// the two auto-init calls we assert on (the panel is preset-first — feature 018).
vi.mock('../src/api/proposalClient', async () => {
  const actual = await vi.importActual<typeof import('../src/api/proposalClient')>('../src/api/proposalClient')
  return {
    ...actual,
    getPackages: vi.fn(),
    getMatrix: vi.fn(),
    getDatasets: vi.fn(),
    getCatalog: vi.fn(),
    getSeeds: vi.fn(),
    getPresets: vi.fn(),
    getPreset: vi.fn(),
    listProfiles: vi.fn(),
    validateWorld: vi.fn(),
    createRun: vi.fn(),
    selectService: vi.fn(),
    journeyPreview: vi.fn(),
  }
})

import {
  getPackages,
  getPreset,
  getPresets,
  createRun,
  selectService,
  getDatasets,
  getCatalog,
  getSeeds,
  listProfiles,
  validateWorld,
  journeyPreview,
} from '../src/api/proposalClient'

const AUTO_PRESET = 'preset-monotone-highway-energize'

function pkg(id: string, family: string) {
  return { id, version: '1.0.0', label: { ja: id, en: id }, family, approach: 'transparent', supported_services: [], parameters: {}, hyperparameters: [] }
}

const world = {
  control_inputs: { trigger_purpose: 'rest_recommended', lifecycle_stage: 'before_rest_until_stop', motion_state: 'driving', matrix_version: 'v1', dataset_id: 'ds-1' },
  situation: {},
  driver_profile: {},
  catalog_ref: { dataset_id: 'ds-1', dataset_version: {}, dataset_hash: 'sha256:x' },
}

const preset = {
  preset_id: AUTO_PRESET,
  schema_version: '1.0.0',
  label: { ja: '', en: 'Monotone highway — energize' },
  brief: { ja: '', en: '' },
  family: 'mood_coherence',
  contrast_with: 'preset-late-night-winddown',
  world,
  algorithm_config_overrides: null,
  expectation: { hypothesis: '', expected_top: { must_be_oshi: true }, top_fit_min: 0.38, gradient: 'none', expected_service: { top_should_be_in: ['humming_karaoke'] }, override_required: false },
}

function runLog() {
  return {
    run_id: 'run-auto-1',
    status: 'service_selected',
    opportunity: { opportunity_id: 'op-1', trigger_purpose: 'rest_recommended', lifecycle_stage: 'before_rest_until_stop', allowed_service_ids: ['humming_karaoke', 'full_karaoke'], simulation_time: '2026-07-17T00:00:00Z', run_seed: 'seed-x' },
    journey_state: { active_service_id: 'humming_karaoke', lifecycle_stage: 'before_rest_until_stop', motion_state: 'driving' },
    events: [],
    evidence: [
      {
        step: 'service',
        input_snapshot: { eligible_candidates: [{ candidate_id: 'humming_karaoke' }], excluded_candidates: [] },
        output: {
          decision_type: 'ranked_candidates',
          ranked_candidates: [
            { rank: 1, candidate_id: 'humming_karaoke', score: 0.5, rationale: [], supporting_feature_ids: [], opposing_feature_ids: [], uncertainty: null, feature_contributions: [], situation_fit: 0.4, preference_fit: 0.1, history_fit: 0, strongest_support: null, strongest_oppose: null, dominance: null },
          ],
        },
      },
    ],
  }
}

describe('Proposal auto-init', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getPackages).mockResolvedValue({
      packages: [
        pkg('aica_transparent_service_selector_v1', 'service_selector'),
        // Task 5 (Choose scope-gate): supported_services must include the
        // fixture's rank-1 candidate (humming_karaoke) or the panel's
        // content-backed gate — reused by autoInit's rank-1 auto-choose —
        // would skip auto-choosing it, breaking this fixture's premise.
        { ...pkg('aica_transparent_content_selector_v1', 'content_selector'), supported_services: ['humming_karaoke', 'full_karaoke'] },
      ],
      slots: [],
      errors: [],
    } as never)
    vi.mocked(getPreset).mockResolvedValue(preset as never)
    vi.mocked(getPresets).mockResolvedValue({ presets: [{ preset_id: AUTO_PRESET, label: preset.label, brief: preset.brief, family: preset.family, contrast_with: preset.contrast_with, hypothesis: '' }] } as never)
    vi.mocked(createRun).mockResolvedValue(runLog() as never)
    // STEP 2 result after the rank-1 service is auto-chosen.
    vi.mocked(selectService).mockResolvedValue({ ...runLog(), status: 'content_selected' } as never)
    vi.mocked(getDatasets).mockResolvedValue({ datasets: [], errors: [] } as never)
    vi.mocked(getCatalog).mockResolvedValue({ provenance: null, total: 0, songs: [] } as never)
    vi.mocked(getSeeds).mockResolvedValue({ seeds: [] } as never)
    vi.mocked(listProfiles).mockResolvedValue({ profiles: [] } as never)
    vi.mocked(validateWorld).mockResolvedValue({ valid: true, issues: [] } as never)
    vi.mocked(journeyPreview).mockResolvedValue({ steps: [] } as never)
  })

  it('auto-loads the reference preset and runs STEP 1 on load (no Run click)', async () => {
    render(
      <ProposalStoreProvider>
        <ProposalScreen autoInit />
      </ProposalStoreProvider>,
    )
    // getPreset called with the reference preset, createRun fired automatically…
    await waitFor(() => expect(getPreset).toHaveBeenCalledWith(AUTO_PRESET))
    await waitFor(() => expect(createRun).toHaveBeenCalled())
    // …and the persisted run origin records the ACTUAL preset (not null) — guards
    // the LOAD_PRESET/runWith stale-closure race.
    expect(vi.mocked(createRun).mock.calls[0][0].origin_preset_id).toBe(AUTO_PRESET)
    // …STEP 2 auto-ran with the rank-1 service (no user interaction)…
    await waitFor(() =>
      expect(selectService).toHaveBeenCalledWith('run-auto-1', 'humming_karaoke', expect.anything()),
    )
    // …and the rank-1 candidate card is rendered.
    await waitFor(() => expect(screen.getByTestId('candidate-card-humming_karaoke')).toBeTruthy())
  })

  it('choosing a different preset auto-runs STEP 1 → STEP 2 again', async () => {
    const preset2 = { ...preset, preset_id: 'preset-late-night-winddown', label: { ja: '', en: 'Late-night wind down' } }
    vi.mocked(getPresets).mockResolvedValue({
      presets: [
        { preset_id: AUTO_PRESET, label: preset.label, brief: preset.brief, family: preset.family, contrast_with: preset.contrast_with, hypothesis: '' },
        { preset_id: 'preset-late-night-winddown', label: preset2.label, brief: preset2.brief, family: preset2.family, contrast_with: AUTO_PRESET, hypothesis: '' },
      ],
    } as never)
    vi.mocked(getPreset).mockImplementation((id: string) =>
      Promise.resolve((id === AUTO_PRESET ? preset : preset2) as never),
    )

    render(
      <ProposalStoreProvider>
        <ProposalScreen autoInit />
      </ProposalStoreProvider>,
    )
    // Initial preset auto-runs once.
    await waitFor(() => expect(createRun).toHaveBeenCalledTimes(1))
    expect(vi.mocked(createRun).mock.calls[0][0].origin_preset_id).toBe(AUTO_PRESET)

    // Selecting a DIFFERENT preset in the picker re-runs STEP 1 → STEP 2.
    const select = await screen.findByTestId('preset-picker-select')
    fireEvent.change(select, { target: { value: 'preset-late-night-winddown' } })
    await waitFor(() => expect(getPreset).toHaveBeenCalledWith('preset-late-night-winddown'))
    await waitFor(() => expect(createRun).toHaveBeenCalledTimes(2))
    expect(vi.mocked(createRun).mock.calls[1][0].origin_preset_id).toBe('preset-late-night-winddown')
  })

  it('does NOT auto-run when autoInit is absent', async () => {
    render(
      <ProposalStoreProvider>
        <ProposalScreen />
      </ProposalStoreProvider>,
    )
    await waitFor(() => expect(getPackages).toHaveBeenCalled())
    // Give any stray effects a tick, then assert no preset auto-load / no run happened.
    await new Promise((r) => setTimeout(r, 50))
    expect(getPreset).not.toHaveBeenCalled()
    expect(createRun).not.toHaveBeenCalled()
    expect(selectService).not.toHaveBeenCalled()
  })
})
