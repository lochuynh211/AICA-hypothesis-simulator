/**
 * proposalStore — isolated Context + useReducer store for the Proposal
 * Simulator (P1 T004, extended T026-T029, rebuilt P3 T025 over a typed
 * `World`).
 *
 * Same pattern as `runStore.ts` (Context + useReducer, a Provider + a
 * `use*Store` hook) but deliberately ISOLATED: this module must not import
 * `runStore` or any trigger state. `uiLanguage` defaults to `'ja'` — the
 * Proposal screen's JA-default convention (design decision D6) — distinct
 * from the trigger store's `'en'` default.
 *
 * P3 (feature 014) replaces the old flat `featureSnapshot: Record<string,
 * unknown>` with a typed `world: World` (`control_inputs` / `situation` /
 * `driver_profile` / `catalog_ref`, mirroring
 * `app/api/aica_api/models/proposal/world.py`), plus cache slices for the
 * read-only `datasets`/`seeds`/`profiles`/`catalog` lists and
 * `worldValidationIssues` from `POST /worlds/validate`. `triggerPurpose`/
 * `lifecycleStage`/`motionState` remain top-level fields for backward
 * compatibility with existing panels/tests — the reducer keeps them in sync
 * with `world.control_inputs` (and, for motion, `world.situation`) on every
 * change, so there is exactly one source of truth per value, just read from
 * two places.
 *
 * Editing this store MUST NEVER mutate `runStore` — see
 * `tests/proposalStore.isolation.test.ts`.
 */
import React, { createContext, useContext, useReducer } from 'react'
import type {
  ProposalRunLog,
  World,
  Situation,
  DriverProfile,
  CatalogRef,
  SeedSummary,
  ProfileSummary,
  DatasetSummary,
  CatalogSongSummary,
  WorldValidationIssue,
  GenreLiteralValue,
  UsageLevelValue,
  WorldClone,
  WorldCloneSummary,
} from '../api/proposalClient'

// ── State ────────────────────────────────────────────────────────────────

export type TriggerPurposeValue =
  | 'rest_recommended'
  | 'inattentive_driving_prevention_recovery'
  | 'route_music'
  | 'child_passenger_experience'

export type LifecycleStageValue =
  | 'before_rest_until_stop'
  | 'during_rest_stopped'
  | 'after_rest_before_restart'
  | 'active_driving_content'

export type MotionStateValue = 'driving' | 'stopped'

// ── Default world (the P3 frozen demonstration dataset; matches every
// committed seed under proposal_contracts/seeds/) ──────────────────────────

const DEFAULT_DATASET_ID = 'soundcharts-grounded-spotify-compatible-demonstration-seed-1042'

const DEFAULT_CATALOG_REF: CatalogRef = {
  dataset_id: DEFAULT_DATASET_ID,
  dataset_version: {
    schema_version: '1.0.0',
    spotify_track_reference_version: '1.0.0',
    spotify_audio_features_reference_version: '1.0.0',
  },
  dataset_hash: 'sha256:83d8079c7a81bc6afbd01cdba65fe2330de66b900a113723814fa938fce516cd',
}

const DEFAULT_SITUATION: Situation = {
  drowsiness_level: 62,
  fatigue_level: 48,
  traffic_state: 'normal',
  road_type: 'highway',
  night_state: 'night',
  monotony_level: 70,
  route_tags: ['coastal', 'night'],
  destination_tags: ['resort'],
  child_present: false,
  multiple_passengers: false,
  motion_state: 'stopped',
  estimated_min_until_rest_spot: null,
  rest_spot_type: 'unknown',
  active_service: null,
  recent_service_rejections: [],
}

const DEFAULT_DRIVER_PROFILE: DriverProfile = {
  oshi_registered: true,
  oshi_mode: 'on',
  oshi_id: null,
  oshi_type: null,
  oshi_tags: [],
  age_band: '30s',
  gender: 'unspecified',
  hobby_interest_tags: [],
  service_usage_level: { music_playlist: 'high', quiz: 'low' },
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
  service_proposal_acceptance_rate: { music_playlist: 72, humming_karaoke: 55 },
  service_recovery_rate: { music_playlist: 64, radio_style: 48 },
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
}

const DEFAULT_WORLD: World = {
  control_inputs: {
    trigger_purpose: 'rest_recommended',
    lifecycle_stage: 'after_rest_before_restart',
    motion_state: 'stopped',
    matrix_version: 'v1',
    dataset_id: DEFAULT_DATASET_ID,
  },
  situation: { ...DEFAULT_SITUATION },
  driver_profile: { ...DEFAULT_DRIVER_PROFILE },
  catalog_ref: DEFAULT_CATALOG_REF,
}

export type ProposalStoreState = {
  /** The language shown in the Proposal UI. Session-only. Default 'ja'. */
  uiLanguage: 'ja' | 'en'

  // ── World panel — control inputs (kept as top-level mirrors of
  // world.control_inputs for backward-compatible reads by other panels) ──
  triggerPurpose: TriggerPurposeValue
  lifecycleStage: LifecycleStageValue
  motionState: MotionStateValue

  // ── World panel — the typed editable world (P3) ─────────────────────────
  world: World
  /** Which committed seed/profile/clone the current world was loaded from,
   * if any (frozen into the run's SetupSnapshot.origin at create-run time). */
  selectedSeedId: string | null
  selectedProfileId: string | null
  selectedCloneId: string | null
  worldValidationIssues: WorldValidationIssue[]

  // ── World panel — read-only reference caches (fetched by pickers) ──────
  datasets: DatasetSummary[]
  seeds: SeedSummary[]
  profiles: ProfileSummary[]
  /** The active dataset's catalog page, for `CatalogView` / provenance. */
  catalog: CatalogSongSummary[]
  catalogTotal: number

  // ── World panel — contrast clones (P3 / feature 014, T028-T031) ────────
  clones: WorldCloneSummary[]
  /** The most recently created/loaded clone — drives `WorldDiffView`. */
  activeClone: WorldClone | null

  // ── Service panel (STEP 1) setup ─────────────────────────────────────────
  servicePackageId: string | null
  mode: string
  serviceParameterOverrides: Record<string, unknown>
  serviceHyperparameterOverrides: Record<string, unknown>

  // ── Content panel (STEP 2) setup ─────────────────────────────────────────
  contentPackageId: string | null
  contentParameterOverrides: Record<string, unknown>
  contentHyperparameterOverrides: Record<string, unknown>

  // ── Run state (populated by createRun / selectService) ──────────────────
  runLog: ProposalRunLog | null
  error: string | null
}

const initialState: ProposalStoreState = {
  uiLanguage: 'ja',
  triggerPurpose: 'rest_recommended',
  lifecycleStage: 'after_rest_before_restart',
  motionState: 'stopped',
  world: DEFAULT_WORLD,
  selectedSeedId: null,
  selectedProfileId: null,
  selectedCloneId: null,
  worldValidationIssues: [],
  datasets: [],
  seeds: [],
  profiles: [],
  catalog: [],
  catalogTotal: 0,
  clones: [],
  activeClone: null,
  servicePackageId: null,
  mode: 'interactive',
  serviceParameterOverrides: {},
  serviceHyperparameterOverrides: {},
  contentPackageId: null,
  contentParameterOverrides: {},
  contentHyperparameterOverrides: {},
  runLog: null,
  error: null,
}

// ── Actions ──────────────────────────────────────────────────────────────

export type ProposalStoreAction =
  /** Switch the Proposal UI language. Session-only. */
  | { type: 'SET_LANGUAGE'; lang: 'ja' | 'en' }
  | { type: 'SET_TRIGGER_PURPOSE'; purpose: TriggerPurposeValue }
  | { type: 'SET_LIFECYCLE_STAGE'; stage: LifecycleStageValue }
  | { type: 'SET_MOTION_STATE'; motionState: MotionStateValue }
  /** Set one Situation field (world.situation[key] = value). */
  | { type: 'SET_SITUATION_FIELD'; key: keyof Situation; value: unknown }
  /** Set one DriverProfile field (world.driver_profile[key] = value). */
  | { type: 'SET_DRIVER_PROFILE_FIELD'; key: keyof DriverProfile; value: unknown }
  /** Toggle the genre_affinity_v1 extension; entered usage_by_genre /
   * scene_genre_usage values are preserved across on/off toggles — only
   * `genre_affinity_v1_enabled` flips (initializing the two maps to `{}`
   * the FIRST time it is turned on, if they are still `null`). */
  | { type: 'SET_GENRE_EXTENSION_ENABLED'; enabled: boolean }
  | { type: 'SET_USAGE_BY_GENRE'; genre: GenreLiteralValue; level: UsageLevelValue }
  | { type: 'SET_SCENE_GENRE_USAGE'; scene: string; genre: GenreLiteralValue; level: UsageLevelValue }
  | { type: 'ADD_GENRE_SCENE'; scene: string }
  | { type: 'REMOVE_GENRE_SCENE'; scene: string }
  /** Select the active dataset (updates world.control_inputs.dataset_id +
   * world.catalog_ref together, from a fetched DatasetSummary). */
  | { type: 'SET_DATASET'; dataset: DatasetSummary }
  /** Loads a full seed world, replacing the entire editable world. */
  | { type: 'LOAD_SEED'; seedId: string; world: World }
  /** Loads a saved/built-in driver profile into world.driver_profile only. */
  | { type: 'LOAD_PROFILE'; profileId: string; profile: DriverProfile }
  /** Clears `selectedProfileId` without touching world.driver_profile (e.g.
   * after the currently-loaded profile is deleted). */
  | { type: 'CLEAR_SELECTED_PROFILE' }
  | { type: 'SET_DATASETS'; datasets: DatasetSummary[] }
  | { type: 'SET_SEEDS'; seeds: SeedSummary[] }
  | { type: 'SET_PROFILES'; profiles: ProfileSummary[] }
  | { type: 'SET_CATALOG'; catalog: CatalogSongSummary[]; total: number }
  | { type: 'SET_WORLD_VALIDATION_ISSUES'; issues: WorldValidationIssue[] }
  /** Cache of persisted clone summaries ({clone_id, base_seed_id}). */
  | { type: 'SET_CLONES'; clones: WorldCloneSummary[] }
  /** A clone was created (or reloaded): replaces the entire editable world
   * with the clone's world and sets `activeClone` for `WorldDiffView`. */
  | { type: 'CLONE_CREATED'; clone: WorldClone }
  /** Clears the active clone's diff display without touching the world
   * (e.g. after the diff banner is dismissed). */
  | { type: 'CLEAR_ACTIVE_CLONE' }
  | { type: 'SET_SERVICE_PACKAGE'; packageId: string }
  | { type: 'SET_MODE'; mode: string }
  | { type: 'SET_SERVICE_PARAMETER'; key: string; value: unknown }
  | { type: 'SET_SERVICE_HYPERPARAMETER'; key: string; value: unknown }
  | { type: 'SET_CONTENT_PACKAGE'; packageId: string }
  | { type: 'SET_CONTENT_PARAMETER'; key: string; value: unknown }
  | { type: 'SET_CONTENT_HYPERPARAMETER'; key: string; value: unknown }
  | { type: 'RUN_CREATED'; runLog: ProposalRunLog }
  | { type: 'CONTENT_SELECTED'; runLog: ProposalRunLog }
  | { type: 'SET_ERROR'; message: string | null }
  | { type: 'RESET_RUN' }

// ── Reducer ──────────────────────────────────────────────────────────────

export function proposalReducer(
  state: ProposalStoreState,
  action: ProposalStoreAction,
): ProposalStoreState {
  switch (action.type) {
    case 'SET_LANGUAGE':
      return { ...state, uiLanguage: action.lang }

    case 'SET_TRIGGER_PURPOSE':
      return {
        ...state,
        triggerPurpose: action.purpose,
        world: {
          ...state.world,
          control_inputs: { ...state.world.control_inputs, trigger_purpose: action.purpose },
        },
      }

    case 'SET_LIFECYCLE_STAGE':
      return {
        ...state,
        lifecycleStage: action.stage,
        world: {
          ...state.world,
          control_inputs: { ...state.world.control_inputs, lifecycle_stage: action.stage },
        },
      }

    case 'SET_MOTION_STATE':
      return {
        ...state,
        motionState: action.motionState,
        world: {
          ...state.world,
          control_inputs: { ...state.world.control_inputs, motion_state: action.motionState },
          situation: { ...state.world.situation, motion_state: action.motionState },
        },
      }

    case 'SET_SITUATION_FIELD':
      return {
        ...state,
        world: { ...state.world, situation: { ...state.world.situation, [action.key]: action.value } },
      }

    case 'SET_DRIVER_PROFILE_FIELD':
      return {
        ...state,
        world: {
          ...state.world,
          driver_profile: { ...state.world.driver_profile, [action.key]: action.value },
        },
      }

    case 'SET_GENRE_EXTENSION_ENABLED': {
      const profile = state.world.driver_profile
      return {
        ...state,
        world: {
          ...state.world,
          driver_profile: {
            ...profile,
            genre_affinity_v1_enabled: action.enabled,
            usage_by_genre: profile.usage_by_genre ?? (action.enabled ? {} : profile.usage_by_genre),
            scene_genre_usage: profile.scene_genre_usage ?? (action.enabled ? {} : profile.scene_genre_usage),
          },
        },
      }
    }

    case 'SET_USAGE_BY_GENRE':
      return {
        ...state,
        world: {
          ...state.world,
          driver_profile: {
            ...state.world.driver_profile,
            usage_by_genre: { ...(state.world.driver_profile.usage_by_genre ?? {}), [action.genre]: action.level },
          },
        },
      }

    case 'SET_SCENE_GENRE_USAGE': {
      const sceneUsage = state.world.driver_profile.scene_genre_usage ?? {}
      return {
        ...state,
        world: {
          ...state.world,
          driver_profile: {
            ...state.world.driver_profile,
            scene_genre_usage: {
              ...sceneUsage,
              [action.scene]: { ...(sceneUsage[action.scene] ?? {}), [action.genre]: action.level },
            },
          },
        },
      }
    }

    case 'ADD_GENRE_SCENE': {
      const sceneUsage = state.world.driver_profile.scene_genre_usage ?? {}
      if (sceneUsage[action.scene]) return state
      return {
        ...state,
        world: {
          ...state.world,
          driver_profile: {
            ...state.world.driver_profile,
            scene_genre_usage: { ...sceneUsage, [action.scene]: {} },
          },
        },
      }
    }

    case 'REMOVE_GENRE_SCENE': {
      const sceneUsage = { ...(state.world.driver_profile.scene_genre_usage ?? {}) }
      delete sceneUsage[action.scene]
      return {
        ...state,
        world: { ...state.world, driver_profile: { ...state.world.driver_profile, scene_genre_usage: sceneUsage } },
      }
    }

    case 'SET_DATASET':
      return {
        ...state,
        world: {
          ...state.world,
          control_inputs: { ...state.world.control_inputs, dataset_id: action.dataset.dataset_id },
          catalog_ref: {
            dataset_id: action.dataset.dataset_id,
            dataset_version: action.dataset.dataset_version,
            dataset_hash: action.dataset.dataset_hash,
          },
        },
      }

    case 'LOAD_SEED':
      return {
        ...state,
        world: action.world,
        selectedSeedId: action.seedId,
        selectedProfileId: null,
        triggerPurpose: action.world.control_inputs.trigger_purpose,
        lifecycleStage: action.world.control_inputs.lifecycle_stage,
        motionState: action.world.control_inputs.motion_state,
        worldValidationIssues: [],
      }

    case 'LOAD_PROFILE':
      return {
        ...state,
        world: { ...state.world, driver_profile: action.profile },
        selectedProfileId: action.profileId,
      }

    case 'CLEAR_SELECTED_PROFILE':
      return { ...state, selectedProfileId: null }

    case 'SET_DATASETS':
      return { ...state, datasets: action.datasets }

    case 'SET_SEEDS':
      return { ...state, seeds: action.seeds }

    case 'SET_PROFILES':
      return { ...state, profiles: action.profiles }

    case 'SET_CATALOG':
      return { ...state, catalog: action.catalog, catalogTotal: action.total }

    case 'SET_WORLD_VALIDATION_ISSUES':
      return { ...state, worldValidationIssues: action.issues }

    case 'SET_CLONES':
      return { ...state, clones: action.clones }

    case 'CLONE_CREATED':
      return {
        ...state,
        world: action.clone.world,
        selectedSeedId: action.clone.base_seed_id,
        selectedCloneId: action.clone.clone_id,
        selectedProfileId: null,
        activeClone: action.clone,
        triggerPurpose: action.clone.world.control_inputs.trigger_purpose,
        lifecycleStage: action.clone.world.control_inputs.lifecycle_stage,
        motionState: action.clone.world.control_inputs.motion_state,
        worldValidationIssues: [],
      }

    case 'CLEAR_ACTIVE_CLONE':
      return { ...state, activeClone: null }

    case 'SET_SERVICE_PACKAGE':
      return { ...state, servicePackageId: action.packageId }

    case 'SET_MODE':
      return { ...state, mode: action.mode }

    case 'SET_SERVICE_PARAMETER':
      return {
        ...state,
        serviceParameterOverrides: { ...state.serviceParameterOverrides, [action.key]: action.value },
      }

    case 'SET_SERVICE_HYPERPARAMETER':
      return {
        ...state,
        serviceHyperparameterOverrides: { ...state.serviceHyperparameterOverrides, [action.key]: action.value },
      }

    case 'SET_CONTENT_PACKAGE':
      return { ...state, contentPackageId: action.packageId }

    case 'SET_CONTENT_PARAMETER':
      return {
        ...state,
        contentParameterOverrides: { ...state.contentParameterOverrides, [action.key]: action.value },
      }

    case 'SET_CONTENT_HYPERPARAMETER':
      return {
        ...state,
        contentHyperparameterOverrides: { ...state.contentHyperparameterOverrides, [action.key]: action.value },
      }

    case 'RUN_CREATED':
      return { ...state, runLog: action.runLog, error: null }

    case 'CONTENT_SELECTED':
      return { ...state, runLog: action.runLog, error: null }

    case 'SET_ERROR':
      return { ...state, error: action.message }

    case 'RESET_RUN':
      return { ...state, runLog: null, error: null }

    default:
      return state
  }
}

// ── Context ──────────────────────────────────────────────────────────────

type ProposalStoreContextValue = {
  state: ProposalStoreState
  dispatch: React.Dispatch<ProposalStoreAction>
}

const ProposalStoreContext = createContext<ProposalStoreContextValue | null>(null)

// ── Provider ─────────────────────────────────────────────────────────────

export function ProposalStoreProvider({
  children,
  initialLanguage,
}: {
  children: React.ReactNode
  /** Optional override for the initial UI language. Defaults to 'ja'. */
  initialLanguage?: 'ja' | 'en'
}) {
  const [state, dispatch] = useReducer(
    proposalReducer,
    initialLanguage ? { ...initialState, uiLanguage: initialLanguage } : initialState,
  )
  const value: ProposalStoreContextValue = { state, dispatch }
  return React.createElement(ProposalStoreContext.Provider, { value }, children)
}

// ── Hook ─────────────────────────────────────────────────────────────────

export function useProposalStore(): ProposalStoreContextValue {
  const ctx = useContext(ProposalStoreContext)
  if (!ctx) {
    throw new Error('useProposalStore must be used within a ProposalStoreProvider')
  }
  return ctx
}
