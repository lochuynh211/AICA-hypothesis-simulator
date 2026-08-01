/**
 * S5b bug 1 — the Combined screen's oshi-artist picker had no options.
 *
 * Root cause: `PreferenceHistorySection` (reused verbatim by
 * `MergedSetupPanel`'s driver-profile popup) derives its artist options from
 * `state.catalog`. `state.catalog` is populated by exactly ONE dispatch site
 * — `SET_CATALOG` — which used to be fired only from `WorldPanel`'s own mount
 * effect. `MergedShell` mounts its OWN scoped `ProposalStoreProvider` but
 * never mounts `WorldPanel`, so on that scoped store `state.catalog` stayed
 * at its initial `[]` forever and the artist picker had nothing to offer —
 * even though the control and its `onChange` were both fine.
 *
 * The fix extracts the catalog-loading effect into `useCatalogLoader`
 * (`src/components/proposal/useCatalogLoader.ts`) and calls it from
 * `MergedSetupPanel` too, so the dependency travels with
 * `PreferenceHistorySection` instead of being re-forgotten. This file pins
 * that fix at two levels: the scoped STORE actually receives a catalog
 * (the durable, implementation-level regression pin), and the actual
 * customer-facing symptom — opening the driver-profile popup and adding an
 * oshi-artist row shows real options — is gone.
 */
import { useEffect } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/api/client', async (orig) => ({
  ...(await orig<typeof import('../src/api/client')>()),
  listRoutePresets: vi.fn(),
  loadRoutePreset: vi.fn(),
  listScenarios: vi.fn(),
  listPackages: vi.fn(),
  getScenario: vi.fn(),
}))

vi.mock('../src/api/proposalClient', async (orig) => ({
  ...(await orig<typeof import('../src/api/proposalClient')>()),
  getPackages: vi.fn(),
  getPresets: vi.fn(),
  getPreset: vi.fn(),
  getCatalog: vi.fn(),
}))

import {
  listRoutePresets, loadRoutePreset, listScenarios, listPackages, getScenario,
} from '../src/api/client'
import { getPackages, getPresets, getPreset, getCatalog } from '../src/api/proposalClient'
import type { World } from '../src/api/proposalClient'
import { MergedCoordinatorProvider } from '../src/state/mergedCoordinator'
import { LanguageProvider } from '../src/state/language'
import { RunStoreProvider } from '../src/state/runStore'
import { ProposalStoreProvider, useProposalStore } from '../src/state/proposalStore'
import MergedSetupPanel from '../src/components/merged/MergedSetupPanel'

// A catalog with TWO songs sharing one artist and a second, distinct artist —
// enough to prove de-duplication-by-id still works once the catalog actually
// reaches the scoped store (mirrors `PreferenceHistorySection`'s own dedup).
const CATALOG_SONGS = [
  {
    spotify_track: {
      id: 'track-1', name: 'Song One',
      artists: [{ id: 'artist-1', name: 'Artist One' }],
    },
  },
  {
    spotify_track: {
      id: 'track-2', name: 'Song Two',
      artists: [{ id: 'artist-1', name: 'Artist One' }, { id: 'artist-2', name: 'Artist Two' }],
    },
  },
]

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

function setupMocks() {
  vi.mocked(listRoutePresets).mockResolvedValue({ presets: [] })
  vi.mocked(loadRoutePreset).mockResolvedValue({ route_source: 'local', alternatives: [] })
  vi.mocked(listScenarios).mockResolvedValue({ scenarios: [], errors: [] })
  vi.mocked(listPackages).mockResolvedValue({ packages: [], errors: [] })
  vi.mocked(getScenario).mockResolvedValue({} as never)
  vi.mocked(getPackages).mockResolvedValue({ packages: [], errors: [] } as never)
  vi.mocked(getPresets).mockResolvedValue({
    presets: [{ preset_id: 'preset-journey-a-1-cruising-fresh', label: { ja: 'A', en: 'Journey A' } }],
  } as never)
  vi.mocked(getPreset).mockResolvedValue({
    preset_id: 'preset-journey-a-1-cruising-fresh',
    label: { ja: 'A', en: 'Journey A' },
    world: fullWorld(),
    algorithm_config_overrides: {},
  } as never)
  vi.mocked(getCatalog).mockResolvedValue({
    provenance: null,
    total: CATALOG_SONGS.length,
    songs: CATALOG_SONGS,
  } as never)
}

/** Exposes the scoped proposalStore's `state.catalog` length as text, so the
 * store-level assertion doesn't need to reach into React internals. */
function CatalogProbe() {
  const { state } = useProposalStore()
  return <span data-testid="catalog-probe-length">{state.catalog.length}</span>
}

function renderPanel() {
  return render(
    <LanguageProvider initialLanguage="en">
      <MergedCoordinatorProvider>
        <RunStoreProvider>
          <ProposalStoreProvider>
            <CatalogProbe />
            <MergedSetupPanel />
          </ProposalStoreProvider>
        </RunStoreProvider>
      </MergedCoordinatorProvider>
    </LanguageProvider>,
  )
}

describe("the Combined screen's scoped store loads a catalog (S5b bug 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  it('populates state.catalog on the SCOPED proposal store MergedSetupPanel reads (was stuck at [] forever)', async () => {
    renderPanel()

    await waitFor(() => expect(getCatalog).toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.getByTestId('catalog-probe-length')).toHaveTextContent(String(CATALOG_SONGS.length)),
    )
  })

  it('gives the driver-profile popup real oshi-artist options once opened (the actual customer-reported symptom)', async () => {
    renderPanel()

    fireEvent.click(await screen.findByTestId('edit-profile'))
    // The popup opens on the BASIC (summary) view (task-18 two-tier editor) —
    // switch to DETAILED to reach the real `PreferenceHistorySection`, the
    // component the bug report is actually about.
    fireEvent.click(await screen.findByTestId('setup-detailed-toggle'))
    fireEvent.click(await screen.findByTestId('oshi-artist-add'))

    const select = (await screen.findByTestId('oshi-artist-select-0')) as HTMLSelectElement
    // Before the fix this select had ONLY its blank placeholder — the bug
    // report verbatim ("the oshi dropdown has no options"). De-duplicated by
    // artist id, so 2 songs sharing 'artist-1' still yield exactly 2 options.
    await waitFor(() => expect(select.options.length).toBeGreaterThan(1))
    const optionTexts = Array.from(select.options).map((o) => o.textContent)
    expect(optionTexts).toContain('Artist One')
    expect(optionTexts).toContain('Artist Two')
  })
})
