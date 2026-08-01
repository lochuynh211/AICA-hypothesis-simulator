/**
 * Case selection → the MAP, through the real shell.
 *
 * `tests/case_route_applies.test.tsx` covers the same wiring by mounting
 * `MergedSetupPanel` alone with its own providers. That passed while the app
 * was still visibly broken, because the reported failures lived in the seams
 * the isolated mount skips: the picker's own value/option matching, and the
 * shared scoped store the setup panel writes and `MapSurface` reads. These
 * tests mount `MergedShell` so those seams are exercised.
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('../src/api/client', async (orig) => ({
  ...(await orig<typeof import('../src/api/client')>()),
  listRoutePresets: vi.fn(),
  loadRoutePreset: vi.fn(),
  listScenarios: vi.fn(),
  listPackages: vi.fn(),
  getScenario: vi.fn(),
  getPackage: vi.fn(),
}))
vi.mock('../src/api/proposalClient', async (orig) => ({
  ...(await orig<typeof import('../src/api/proposalClient')>()),
  getPackages: vi.fn(),
  getPresets: vi.fn(),
  getPreset: vi.fn(),
}))

import {
  listRoutePresets, loadRoutePreset, listScenarios, listPackages, getScenario, getPackage,
} from '../src/api/client'
import { getPackages, getPresets, getPreset } from '../src/api/proposalClient'
import MergedShell from '../src/components/merged/MergedShell'
import { LanguageProvider } from '../src/state/language'

/** A complete world — the proposal store reads situation/control_inputs, and a
 *  partial one crashes the shell (which has no error boundary). */
const WORLD = {
  control_inputs: {
    trigger_purpose: 'rest_recommended', lifecycle_stage: 'before_rest_until_stop',
    motion_state: 'driving', matrix_version: 'v1', dataset_id: 'ds-1',
  },
  situation: {
    drowsiness_level: 40, fatigue_level: 30, traffic_state: 'normal', road_type: 'highway',
    night_state: 'day', monotony_level: 20, route_tags: [], destination_tags: [],
    child_present: false, multiple_passengers: false, motion_state: 'driving',
    estimated_min_until_rest_spot: null, rest_spot_type: 'unknown', active_service: null,
    recent_service_rejections: [],
  },
  driver_profile: {
    oshi_registered: false, oshi_mode: 'off', oshi_artists: [], oshi_tags: [],
    age_band: '30s', gender: 'unspecified', hobby_interest_tags: [],
    service_usage_level: {}, service_recency_state: {}, scene_service_usage_level: {},
    catalog_item_usage_level: {}, catalog_item_recency_state: {},
    content_tag_usage_level: {}, content_tag_recency_state: {}, scene_content_tag_usage_level: {},
    played_items: [], skipped_items: [], changed_from_items: [], cancelled_content_plans: [],
    completed_items: [], manually_selected_items: [], repeated_items: [],
    service_proposal_acceptance_rate: {}, service_recovery_rate: {},
    content_proposal_acceptance_rate: {}, content_recovery_rate: {},
    service_proposal_acceptance_confidence: {}, service_recovery_confidence: {},
    content_proposal_acceptance_confidence: {}, content_recovery_confidence: {},
    scheduled_event_type: null, scheduled_event_timing: null, scheduled_event_tags: [],
    genre_affinity_v1_enabled: false, usage_by_genre: null, scene_genre_usage: null,
  },
  catalog_ref: {
    dataset_id: 'ds-1',
    dataset_version: {
      schema_version: '1.0.0', spotify_track_reference_version: '1.0.0',
      spotify_audio_features_reference_version: '1.0.0',
    },
    dataset_hash: 'sha256:abc',
  },
}

// A real (short) polyline so the schematic actually draws.
const POLY = '_p~iF~ps|U_ulLnnqC_mqNvxq`@'

const ROUTES: Record<string, { start: string; end: string; km: number; poly: string }> = {
  short_tokyo_chichibu: { start: 'Tokyo Station', end: 'Chichibu Station', km: 112, poly: POLY },
  long_tokyo_osaka: { start: 'Tokyo Station', end: 'Osaka Station', km: 502, poly: 'kwo}Fh`bxOoDmM{FyPaCiI' },
  middle_tokyo_karuizawa: { start: 'Tokyo Station', end: 'Karuizawa Station', km: 165, poly: 'gfo}Fh`bxOoDmM{FyPaCiI' },
}

function mount(lang: 'ja' | 'en' = 'en') {
  return render(
    <LanguageProvider initialLanguage={lang}>
      <MergedShell />
    </LanguageProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  // Registry order deliberately puts the LONG route first, so a case pinning a
  // different route only shows on the map if the case actually won.
  vi.mocked(listRoutePresets).mockResolvedValue({
    presets: Object.keys(ROUTES)
      .sort((a, b) => (a === 'long_tokyo_osaka' ? -1 : b === 'long_tokyo_osaka' ? 1 : 0))
      .map((id) => ({ id, label: { ja: id, en: id } })),
  } as never)
  vi.mocked(loadRoutePreset).mockImplementation(async (id: string) => {
    const r = ROUTES[id] ?? ROUTES.long_tokyo_osaka
    return {
      route_source: 'maps',
      alternatives: [{
        route_id: `${id}_r`,
        label: id,
        display: { summary: id, encoded_polyline: r.poly, start_label: r.start, end_label: r.end },
        route_facts: {
          total_route_distance_km: r.km, route_segments: [],
          rest_spot_positions: [], named_rest_spots: [],
        },
      }],
    } as never
  })
  // Registries carry the ids C-01 actually references, so the case can reach a
  // CLEAN match. Without that the setup never equals the case, and the
  // clear-on-edit rule (which only fires after a clean match, so a
  // half-applied case cannot cancel itself) would never arm.
  vi.mocked(listScenarios).mockResolvedValue({
    scenarios: [{
      id: 'uc01_fatigue_recovery_v0_1', version: '1.0', type: 'fatigue_buildup',
      persona_label: 'x', review_focus: 'y',
    }],
    errors: [],
  } as never)
  vi.mocked(listPackages).mockResolvedValue({
    packages: [{
      id: 'aica_transparent_hybrid_trigger_v1', version: '1.0',
      label: { ja: 'x', en: 'x' }, algorithm_type: 'python_module',
      compatible_scenario_types: ['fatigue_buildup'],
    }],
    errors: [],
  } as never)
  vi.mocked(getScenario).mockResolvedValue({} as never)
  vi.mocked(getPackage).mockResolvedValue({} as never)
  vi.mocked(getPackages).mockResolvedValue({
    packages: [
      {
        id: 'aica_transparent_service_selector_v1', version: '1.0', label: { ja: 'x', en: 'x' },
        family: 'service_selector', approach: 'transparent', contract_version: '1.0',
        supported_services: [], parameters: {}, hyperparameters: [],
      },
      {
        id: 'aica_transparent_content_selector_v1', version: '1.0', label: { ja: 'x', en: 'x' },
        family: 'content_selector', approach: 'transparent', contract_version: '1.0',
        supported_services: [], parameters: {}, hyperparameters: [],
      },
    ],
  } as never)
  vi.mocked(getPresets).mockResolvedValue({
    presets: [{ preset_id: 'preset-journey-a-1-cruising-fresh', label: { ja: 'x', en: 'x' } }],
  } as never)
  vi.mocked(getPreset).mockResolvedValue({
    preset_id: 'preset-journey-a-1-cruising-fresh',
    label: { ja: 'x', en: 'x' },
    world: WORLD,
    algorithm_config_overrides: {},
  } as never)
})

const picker = () => screen.getByTestId('experience-case-select') as HTMLSelectElement

/**
 * Force the KEYLESS branch, so these tests read the route off the schematic
 * (which renders its start/end names as text) instead of the Google canvas.
 * Without this the assertions would depend on whether the machine running the
 * suite happens to have `VITE_GOOGLE_MAPS_KEY` in `.env.local` — it does on
 * the developer box, which is why the schematic never appeared here at first.
 * The Google branch's own route-change behaviour is covered in `map.test.tsx`.
 */
async function useSchematicMap() {
  await waitFor(() => expect(screen.getByTestId('merged-maps-key')).toBeInTheDocument())
  fireEvent.change(screen.getByTestId('merged-maps-key'), { target: { value: '' } })
}

describe('the case picker and the map, in the real shell', () => {
  it('opens on C-01, actually APPLIED — not merely displayed', async () => {
    mount()
    await useSchematicMap()

    // The picker must agree with the store. The earlier bug was the reverse:
    // the browser displayed the first case while the state said null, so the
    // setup on screen belonged to no case and re-picking it fired no change
    // event. Asserting the ROUTE proves the case was really applied, not just
    // shown.
    await waitFor(() => expect(picker().value).toBe('case-c01-alert-daytime-control'))
    expect(Array.from(picker().options).some((o) => o.value === '')).toBe(false)
    await waitFor(() =>
      expect(screen.getByTestId('fallback-map-end')).toHaveTextContent('Chichibu Station'),
    )
  })

  it("moves the map to the case's route when a case is selected", async () => {
    mount()
    await useSchematicMap()
    // Opens on C-01 (short route).
    await waitFor(() =>
      expect(screen.getByTestId('fallback-map-end')).toHaveTextContent('Chichibu Station'),
    )

    fireEvent.change(picker(), { target: { value: 'case-c04-mountain-road-workload' } })

    await waitFor(() => {
      expect(screen.getByTestId('fallback-map-end')).toHaveTextContent('Karuizawa Station')
    })
  })

  it("moves the map again when switching to a case with a different route", async () => {
    mount()
    await useSchematicMap()
    await waitFor(() => expect(screen.getByTestId('fallback-map-end')).toBeInTheDocument())

    fireEvent.change(picker(), { target: { value: 'case-c01-alert-daytime-control' } })
    await waitFor(() => expect(screen.getByTestId('fallback-map-end')).toHaveTextContent('Chichibu'))

    // C-04 pins the Karuizawa route.
    fireEvent.change(picker(), { target: { value: 'case-c04-mountain-road-workload' } })
    await waitFor(() => expect(screen.getByTestId('fallback-map-end')).toHaveTextContent('Karuizawa'))
  })

  it('moves the map when the route preset is changed by hand', async () => {
    mount()
    await useSchematicMap()
    await waitFor(() =>
      expect(screen.getByTestId('fallback-map-end')).toHaveTextContent('Chichibu'),
    )

    fireEvent.change(screen.getByTestId('merged-route-preset-select'), {
      target: { value: 'middle_tokyo_karuizawa' },
    })

    await waitFor(() => expect(screen.getByTestId('fallback-map-end')).toHaveTextContent('Karuizawa'))
  })

  it('marks the case as edited — and KEEPS the edited route', async () => {
    mount()
    await useSchematicMap()
    await waitFor(() =>
      expect(screen.getByTestId('fallback-map-end')).toHaveTextContent('Chichibu'),
    )

    // Changing the route is a setup edit: this is no longer C-01 as authored.
    fireEvent.change(screen.getByTestId('merged-route-preset-select'), {
      target: { value: 'middle_tokyo_karuizawa' },
    })

    // The case STAYS selected — there is no null entry to fall back to, and a
    // null selection would make the picker display a case that is not applied.
    // (The "(setup edited)" label itself is asserted in the review-column
    // tests, where a run exists for the column to render.)
    await waitFor(() =>
      expect(screen.getByTestId('fallback-map-end')).toHaveTextContent('Karuizawa'),
    )
    expect(picker().value).toBe('case-c01-alert-daytime-control')
  })
})
