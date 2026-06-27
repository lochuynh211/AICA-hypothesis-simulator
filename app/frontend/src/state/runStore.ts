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
  | { type: 'RESET' }

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
