import React, { createContext, useContext, useReducer } from 'react'
import type {
  PackageSummary,
  ScenarioSummary,
  RunState,
  DecisionResult,
  AlgorithmError,
  TraceEntry,
} from '../api/types'

// ── State ──────────────────────────────────────────────────────────────────

export type RunStoreState = {
  packages: PackageSummary[]
  scenarios: ScenarioSummary[]
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
  | { type: 'LOAD_PACKAGES'; packages: PackageSummary[] }
  | { type: 'LOAD_SCENARIOS'; scenarios: ScenarioSummary[] }
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
  | { type: 'RESET' }

// ── Reducer ────────────────────────────────────────────────────────────────

function reducer(state: RunStoreState, action: RunStoreAction): RunStoreState {
  switch (action.type) {
    case 'LOAD_PACKAGES':
      return { ...state, packages: action.packages }

    case 'LOAD_SCENARIOS':
      return { ...state, scenarios: action.scenarios }

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
