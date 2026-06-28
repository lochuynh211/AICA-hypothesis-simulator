import React, { createContext, useContext, useReducer } from 'react'
import type {
  PackageSummary,
  ScenarioSummary,
  RegistryError,
  RunState,
  DecisionResult,
  AlgorithmError,
  TraceEntry,
  SetupValue,
  ValidationError,
  RouteAlternative,
  RouteEnvelope,
  MapsErrorBody,
  ProfileOverrides,
} from '../api/types'

// ── State ──────────────────────────────────────────────────────────────────

export type RunStoreState = {
  packages: PackageSummary[]
  scenarios: ScenarioSummary[]
  /** Registry errors reported when loading package manifests. */
  packageErrors: RegistryError[]
  /** Registry errors reported when loading scenario files. */
  scenarioErrors: RegistryError[]
  /** Error message from the most recent createRun / actRun failure. */
  runError: string | null
  selectedPackageId: string | null
  selectedScenarioId: string | null
  runState: RunState | null
  trace: TraceEntry[]
  latestDecision: DecisionResult | null
  paused: boolean
  completed: boolean
  errors: string[]
  algorithmErrors: AlgorithmError[]

  // ── Setup-draft state (M2) ───────────────────────────────────────────────
  /** Edited parameter values (key → value); absent keys use package defaults. */
  editedParameters: Record<string, SetupValue>
  /** Edited hyperparameter values (key → value); absent keys use defaults. */
  editedHyperparameters: Record<string, SetupValue>
  /** The frozen draft plan_id once a plan has been drafted, else null. */
  planId: string | null
  /** The draft EventPlan from the most recent run-plan response. */
  draftPlan: unknown | null
  /** The effective_setup snapshot from the most recent run-plan response. */
  effectiveSetup: Record<string, unknown> | null
  /** Field-level validation errors (client-side or from a 400 response). */
  validationErrors: ValidationError[]
  /** Top-level setup error message (e.g. analyze/plan request failure). */
  setupError: string | null

  // ── M4: Maps route surface ────────────────────────────────────────────────
  /**
   * BYO Maps API key — held in-memory ONLY.
   * NEVER written to localStorage, sessionStorage, or any persisted store.
   * Cleared on RESET.
   */
  mapsKey: string
  /** Start location string (free-text) for the Maps analyze call. */
  mapsStart: string
  /** End location string (free-text) for the Maps analyze call. */
  mapsEnd: string
  /** Route alternatives returned by the most recent routesAnalyze call. */
  alternatives: RouteAlternative[]
  /** Route source from the most recent routesAnalyze envelope. */
  routeSource: 'maps' | 'local'
  /** The route_id selected by the reviewer; null until the user selects one. */
  selectedRouteId: string | null
  /** Structured error from a 502 Maps failure; null when no error. */
  mapsError: MapsErrorBody | null

  // ── M6: view mode ─────────────────────────────────────────────────────────
  /**
   * Which top-level view is active. Drives the three-view app shell.
   * - 'setup'  → SetupScreen (default; also restored on RESET)
   * - 'review' → 3-panel Review screen (auto-transition on RUN_CREATED)
   * - 'runs'   → RunsScreen (browse past runs; placeholder in M6)
   */
  viewMode: 'setup' | 'review' | 'runs'

  // ── M6: UI language (T004) ─────────────────────────────────────────────────
  /**
   * The language shown in the UI. Session-only — NOT persisted to localStorage
   * and NOT cleared by RESET (it is a reviewer preference, not run state).
   * Default 'ja'; toggled via SET_LANGUAGE.
   */
  uiLanguage: 'ja' | 'en'

  // ── M6 T009: ProfileEditor overrides ───────────────────────────────────────
  /**
   * Sparse profile overrides computed by ProfileEditor.
   * Null means no overrides (omit profiles from run-plan body).
   * Cleared on SELECT_SCENARIO and RESET.
   */
  profileOverrides: ProfileOverrides | null

  // ── Tick seconds override (setup-time) ─────────────────────────────────────
  /**
   * User-set tick duration in seconds. Null means "use scenario default" —
   * nothing is sent in presets. A positive integer sends presets.tick_seconds.
   * Cleared on SELECT_SCENARIO and RESET so each new scenario starts fresh.
   */
  tickSecondsOverride: number | null
}

const initialState: RunStoreState = {
  packages: [],
  scenarios: [],
  packageErrors: [],
  scenarioErrors: [],
  runError: null,
  selectedPackageId: null,
  selectedScenarioId: null,
  runState: null,
  trace: [],
  latestDecision: null,
  paused: false,
  completed: false,
  errors: [],
  algorithmErrors: [],
  editedParameters: {},
  editedHyperparameters: {},
  planId: null,
  draftPlan: null,
  effectiveSetup: null,
  validationErrors: [],
  setupError: null,
  // M4 — dev presets (key from gitignored .env.local; start/end default to a
  // Tokyo→Osaka example). All overridable via VITE_* env vars. The key still
  // lives only in in-memory state — never persisted/logged.
  mapsKey: import.meta.env.VITE_GOOGLE_MAPS_KEY ?? '',
  mapsStart: import.meta.env.VITE_MAPS_START ?? 'Tokyo Station',
  mapsEnd: import.meta.env.VITE_MAPS_END ?? 'Osaka Station',
  alternatives: [],
  routeSource: 'local',
  selectedRouteId: null,
  mapsError: null,
  // M6 — default to Setup screen
  viewMode: 'setup',
  // M6 T004 — default to Japanese
  uiLanguage: 'ja',
  // M6 T009 — no profile overrides initially
  profileOverrides: null,
  // tick seconds — null means "use scenario default"
  tickSecondsOverride: null,
}

// ── Actions ────────────────────────────────────────────────────────────────

export type RunStoreAction =
  | { type: 'LOAD_PACKAGES'; packages: PackageSummary[]; errors?: RegistryError[] }
  | { type: 'LOAD_SCENARIOS'; scenarios: ScenarioSummary[]; errors?: RegistryError[] }
  | { type: 'SELECT_PACKAGE'; id: string }
  | { type: 'SELECT_SCENARIO'; id: string }
  | { type: 'RUN_CREATED'; runState: RunState }
  | {
      type: 'TICK_APPENDED'
      runState: RunState
      decision: DecisionResult
      tickIndex: number
      paused: boolean
      completed: boolean
    }
  | { type: 'ACTION_APPLIED'; runState: RunState }
  | {
      type: 'ALGORITHM_ERROR_APPENDED'
      runState: RunState
      error: AlgorithmError
      /**
       * True when the package's error_mode is "blocking" (default).
       * Mirrors the `paused` field in the tick envelope so the store
       * reflects the run's halted state — no proposal/action awaited.
       */
      paused: boolean
    }
  | { type: 'SET_RUN_ERROR'; message: string | null }
  // ── Setup-draft actions (M2) ─────────────────────────────────────────────
  | { type: 'SET_PARAMETER'; key: string; value: SetupValue }
  | { type: 'SET_HYPERPARAMETER'; key: string; value: SetupValue }
  | {
      type: 'PLAN_DRAFTED'
      planId: string
      draftPlan: unknown
      effectiveSetup: Record<string, unknown>
    }
  | { type: 'SET_VALIDATION_ERRORS'; errors: ValidationError[] }
  | { type: 'SET_SETUP_ERROR'; message: string | null }
  // ── M4: Maps route surface actions ────────────────────────────────────────
  /** Set the BYO Maps API key (in-memory only — never persisted). */
  | { type: 'SET_MAPS_KEY'; key: string }
  /** Update the start/end location strings. */
  | { type: 'SET_MAPS_ROUTE_INPUT'; start: string; end: string }
  /** Populate alternatives from a successful routesAnalyze response. */
  | { type: 'SET_ALTERNATIVES'; envelope: RouteEnvelope }
  /** Select a specific alternative by route_id. */
  | { type: 'SELECT_ROUTE'; routeId: string }
  /** Record a Maps API error (502) from routesAnalyze. */
  | { type: 'SET_MAPS_ERROR'; error: MapsErrorBody | null }
  // ── M6: view mode ─────────────────────────────────────────────────────────
  /** Navigate to a specific view. Use RESET to return to Setup and clear run. */
  | { type: 'SET_VIEW_MODE'; mode: 'setup' | 'review' | 'runs' }
  | { type: 'RESET' }
  // ── M6 T004: UI language ──────────────────────────────────────────────────
  /** Switch the UI language. Session-only — survives RESET. */
  | { type: 'SET_LANGUAGE'; lang: 'ja' | 'en' }
  // ── M6 T009: ProfileEditor overrides ─────────────────────────────────────
  /** Sparse profile overrides from ProfileEditor; null to clear. */
  | { type: 'SET_PROFILE_OVERRIDES'; overrides: ProfileOverrides | null }
  // ── Tick seconds override ─────────────────────────────────────────────────
  /** Set the tick duration override (positive integer), or null to clear (use scenario default). */
  | { type: 'SET_TICK_SECONDS'; seconds: number | null }

// ── Reducer ────────────────────────────────────────────────────────────────

function reducer(state: RunStoreState, action: RunStoreAction): RunStoreState {
  switch (action.type) {
    case 'LOAD_PACKAGES':
      return {
        ...state,
        packages: action.packages,
        packageErrors: action.errors ?? [],
      }

    case 'LOAD_SCENARIOS':
      return {
        ...state,
        scenarios: action.scenarios,
        scenarioErrors: action.errors ?? [],
      }

    case 'SELECT_PACKAGE':
      // Changing the package invalidates any edited values + draft.
      return {
        ...state,
        selectedPackageId: action.id,
        editedParameters: {},
        editedHyperparameters: {},
        planId: null,
        draftPlan: null,
        effectiveSetup: null,
        validationErrors: [],
        setupError: null,
      }

    case 'SELECT_SCENARIO':
      // Changing the scenario invalidates the draft (route facts change).
      return {
        ...state,
        selectedScenarioId: action.id,
        planId: null,
        draftPlan: null,
        effectiveSetup: null,
        setupError: null,
        // Changing scenario also invalidates the previously analyzed route.
        alternatives: [],
        selectedRouteId: null,
        routeSource: 'local',
        mapsError: null,
        // T009: clear profile overrides — new scenario has its own defaults.
        profileOverrides: null,
        // Clear tick seconds override — new scenario has its own default.
        tickSecondsOverride: null,
      }

    case 'SET_PARAMETER':
      // Editing a value invalidates the existing draft (must re-preview).
      return {
        ...state,
        editedParameters: { ...state.editedParameters, [action.key]: action.value },
        planId: null,
        draftPlan: null,
        effectiveSetup: null,
      }

    case 'SET_HYPERPARAMETER':
      return {
        ...state,
        editedHyperparameters: {
          ...state.editedHyperparameters,
          [action.key]: action.value,
        },
        planId: null,
        draftPlan: null,
        effectiveSetup: null,
      }

    case 'PLAN_DRAFTED':
      return {
        ...state,
        planId: action.planId,
        draftPlan: action.draftPlan,
        effectiveSetup: action.effectiveSetup,
        validationErrors: [],
        setupError: null,
      }

    case 'SET_VALIDATION_ERRORS':
      return {
        ...state,
        validationErrors: action.errors,
        // An invalid edit cannot have a usable draft.
        planId: action.errors.length > 0 ? null : state.planId,
      }

    case 'SET_SETUP_ERROR':
      return { ...state, setupError: action.message }

    case 'RUN_CREATED':
      // Auto-transition to Review so the user sees the run immediately.
      return {
        ...state,
        runState: action.runState,
        trace: [],
        latestDecision: null,
        paused: false,
        completed: false,
        errors: [],
        algorithmErrors: [],
        runError: null,
        viewMode: 'review',
      }

    case 'TICK_APPENDED': {
      const entry: TraceEntry = { ...action.decision, tick_index: action.tickIndex }
      return {
        ...state,
        runState: action.runState,
        trace: [...state.trace, entry],
        latestDecision: action.decision,
        paused: action.paused,
        completed: action.completed,
      }
    }

    case 'ACTION_APPLIED':
      return {
        ...state,
        runState: action.runState,
        paused: false,
      }

    case 'ALGORITHM_ERROR_APPENDED':
      // Update runState and append the error.  Set paused from the envelope so a
      // blocking error (paused=true) halts the UI — no proposal/action awaited.
      // Do NOT update latestDecision or append to trace (errors are not decisions).
      return {
        ...state,
        runState: action.runState,
        algorithmErrors: [...state.algorithmErrors, action.error],
        paused: action.paused,
      }

    case 'SET_RUN_ERROR':
      return { ...state, runError: action.message }

    // ── M4 actions ─────────────────────────────────────────────────────────
    case 'SET_MAPS_KEY':
      // Key is kept in-memory inside this reducer state — never serialized,
      // never written to localStorage/sessionStorage.
      return { ...state, mapsKey: action.key }

    case 'SET_MAPS_ROUTE_INPUT':
      return {
        ...state,
        mapsStart: action.start,
        mapsEnd: action.end,
        // Changing the route input invalidates any previous analyze result.
        alternatives: [],
        selectedRouteId: null,
        routeSource: 'local',
        mapsError: null,
      }

    case 'SET_ALTERNATIVES':
      return {
        ...state,
        alternatives: action.envelope.alternatives,
        routeSource: action.envelope.route_source,
        selectedRouteId: null,
        mapsError: null,
      }

    case 'SELECT_ROUTE':
      return { ...state, selectedRouteId: action.routeId }

    case 'SET_MAPS_ERROR':
      return { ...state, mapsError: action.error, alternatives: [] }

    // ── M6 actions ─────────────────────────────────────────────────────────
    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.mode }

    case 'SET_LANGUAGE':
      return { ...state, uiLanguage: action.lang }

    case 'SET_PROFILE_OVERRIDES':
      return { ...state, profileOverrides: action.overrides }

    case 'SET_TICK_SECONDS':
      return { ...state, tickSecondsOverride: action.seconds }

    case 'RESET':
      return {
        ...state,
        runState: null,
        trace: [],
        latestDecision: null,
        paused: false,
        completed: false,
        errors: [],
        algorithmErrors: [],
        runError: null,
        editedParameters: {},
        editedHyperparameters: {},
        planId: null,
        draftPlan: null,
        effectiveSetup: null,
        validationErrors: [],
        setupError: null,
        // M4: clear all Maps state on reset (key is ephemeral anyway)
        mapsKey: '',
        mapsStart: '',
        mapsEnd: '',
        alternatives: [],
        routeSource: 'local',
        selectedRouteId: null,
        mapsError: null,
        // M6: return to Setup after resetting
        viewMode: 'setup',
        // T009: clear profile overrides on reset
        profileOverrides: null,
        // Clear tick seconds override on reset
        tickSecondsOverride: null,
      }

    default:
      return state
  }
}

// ── Context ────────────────────────────────────────────────────────────────

type RunStoreContextValue = {
  state: RunStoreState
  dispatch: React.Dispatch<RunStoreAction>
}

const RunStoreContext = createContext<RunStoreContextValue | null>(null)

// ── Provider ───────────────────────────────────────────────────────────────

export function RunStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const value: RunStoreContextValue = { state, dispatch }
  return React.createElement(RunStoreContext.Provider, { value }, children)
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useRunStore(): RunStoreContextValue {
  const ctx = useContext(RunStoreContext)
  if (!ctx) {
    throw new Error('useRunStore must be used within a RunStoreProvider')
  }
  return ctx
}
