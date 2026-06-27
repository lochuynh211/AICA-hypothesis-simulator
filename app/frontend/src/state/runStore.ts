import React, { createContext, useContext, useReducer } from 'react'
import type {
  PackageSummary,
  ScenarioSummary,
  RegistryError,
  RunState,
  DecisionResult,
  AlgorithmError,
  TraceEntry,
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
  | { type: 'ALGORITHM_ERROR_APPENDED'; runState: RunState; error: AlgorithmError }
  | { type: 'SET_RUN_ERROR'; message: string | null }
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
      return { ...state, selectedPackageId: action.id }

    case 'SELECT_SCENARIO':
      return { ...state, selectedScenarioId: action.id }

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
      // Update runState, append error — do NOT update latestDecision or set paused
      return {
        ...state,
        runState: action.runState,
        algorithmErrors: [...state.algorithmErrors, action.error],
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
