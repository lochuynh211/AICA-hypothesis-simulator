/**
 * proposalStore — isolated Context + useReducer store for the Proposal
 * Simulator (P1 T004, extended T026-T029).
 *
 * Same pattern as `runStore.ts` (Context + useReducer, a Provider + a
 * `use*Store` hook) but deliberately ISOLATED: this module must not import
 * `runStore` or any trigger state. `uiLanguage` defaults to `'ja'` — the
 * Proposal screen's JA-default convention (design decision D6) — distinct
 * from the trigger store's `'en'` default.
 *
 * Holds everything the three panels (World / Service / Content) read and
 * write: the world/situation feature snapshot, the driver-profile selection,
 * the trigger signal + car state (control inputs, not scored), the selected
 * service/content packages + mode, EDITED parameter/hyperparameter overrides
 * per package (sparse — mirrors the trigger `editedHyperparameters`
 * convention: an override is present only once the reviewer has touched that
 * field; the effective value is `override ?? manifest default`), and the
 * current `ProposalRunLog` (opportunity + service/content evidence).
 *
 * Editing this store MUST NEVER mutate `runStore` — see
 * `tests/proposalStore.isolation.test.ts`.
 */
import React, { createContext, useContext, useReducer } from 'react'
import type { ProposalRunLog } from '../api/proposalClient'

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

/** The World · situation + Preference & history feature snapshot (editable). */
const initialFeatureSnapshot: Record<string, unknown> = {
  drowsiness_level: 62,
  fatigue_level: 48,
  monotony_level: 70,
  traffic_state: 'normal',
  road_type: 'highway',
  night_state: 'night',
  route_tags: 'coastal, night',
  destination_tags: 'resort',
  child_present: false,
  multiple_passengers: false,
  age_band: '30s',
  gender: 'unspecified',
  oshi_registered: true,
  oshi_mode: 'on',
  service_usage_level: { music_playlist: 'high', quiz: 'low' },
  service_proposal_acceptance_rate: { music_playlist: 72, humming_karaoke: 55 },
  service_recovery_rate: { music_playlist: 64, radio_style: 48 },
}

export type ProposalStoreState = {
  /** The language shown in the Proposal UI. Session-only. Default 'ja'. */
  uiLanguage: 'ja' | 'en'

  // ── World panel (control inputs + editable feature snapshot) ───────────
  triggerPurpose: TriggerPurposeValue
  lifecycleStage: LifecycleStageValue
  motionState: MotionStateValue
  featureSnapshot: Record<string, unknown>
  selectedProfileId: string | null

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
  featureSnapshot: { ...initialFeatureSnapshot },
  selectedProfileId: null,
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
  | { type: 'SET_FEATURE_FIELD'; key: string; value: unknown }
  /** Loads a driver profile's preference/history fields into the snapshot. */
  | { type: 'SET_PROFILE'; profileId: string; fields: Record<string, unknown> }
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
      return { ...state, triggerPurpose: action.purpose }

    case 'SET_LIFECYCLE_STAGE':
      return { ...state, lifecycleStage: action.stage }

    case 'SET_MOTION_STATE':
      return { ...state, motionState: action.motionState }

    case 'SET_FEATURE_FIELD':
      return { ...state, featureSnapshot: { ...state.featureSnapshot, [action.key]: action.value } }

    case 'SET_PROFILE':
      return {
        ...state,
        selectedProfileId: action.profileId,
        featureSnapshot: { ...state.featureSnapshot, ...action.fields },
      }

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
