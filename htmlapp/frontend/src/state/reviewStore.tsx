// app/frontend/src/state/reviewStore.tsx
/**
 * reviewStore — isolated Context + useReducer store for the combined review
 * column (feature 023, Task 14).
 *
 * Same pattern as `proposalStore.ts`: a plain `createContext` + `useReducer`,
 * a Provider, and a `use*Store()` hook that throws a clear error outside the
 * Provider.
 *
 * `SELECT_CHECKPOINT` and `SELECT_STAGE` both clear `targetId`,
 * `compareLeftId` and `compareRightId` — a comparison chosen at one decision
 * point is meaningless at another, and leaving it set would silently compare
 * unrelated options at the new one.
 *
 * `judgments` is keyed by the compound string `judgmentKey(...)` — a
 * judgement made at one decision point (case · checkpoint · stage · target ·
 * feature) never leaks into another, even when the same feature id recurs
 * across stages (e.g. `monotony` in both the trigger and service chains).
 * Task 16 persists `judgments`/`assessments` over the M5 feedback store using
 * the identical key, which is why the builder is exported rather than
 * reimplemented there.
 */
import React, { createContext, useContext, useReducer } from 'react'
import type { ReviewStage } from '../lib/review/checkpoints'

// ── State ────────────────────────────────────────────────────────────────

export type ReviewState = {
  selectedCaseId: string | null
  checkpointId: string | null
  stage: ReviewStage
  /** Which service candidate / plan item is under review. */
  targetId: string | null
  compareLeftId: string | null
  compareRightId: string | null
  /** Keyed by `judgmentKey(caseId, checkpointId, stage, targetId, featureId)`. */
  judgments: Record<string, string>
  /** Keyed by the same compound shape minus the feature (a decision-level
   * assessment, not a per-input one) — Task 16 builds that key. */
  assessments: Record<string, { assessment: string; comment: string }>
}

const initialState: ReviewState = {
  selectedCaseId: null,
  checkpointId: null,
  stage: 'trigger',
  targetId: null,
  compareLeftId: null,
  compareRightId: null,
  judgments: {},
  assessments: {},
}

// ── Actions ──────────────────────────────────────────────────────────────

export type ReviewAction =
  | { type: 'SELECT_CASE'; caseId: string | null }
  | { type: 'SELECT_CHECKPOINT'; checkpointId: string | null }
  | { type: 'SELECT_STAGE'; stage: ReviewStage }
  | { type: 'SELECT_TARGET'; targetId: string | null }
  | { type: 'SET_COMPARISON'; leftId: string | null; rightId: string | null }
  | { type: 'SET_JUDGMENT'; key: string; judgment: string }
  | { type: 'SET_ASSESSMENT'; key: string; assessment: string; comment: string }
  | { type: 'RESET' }

// ── Key builder — Task 16 must use this exact string shape ─────────────────

export const judgmentKey = (
  caseId: string,
  checkpointId: string,
  stage: string,
  targetId: string,
  featureId: string,
): string => [caseId, checkpointId, stage, targetId, featureId].join('|')

/** Inverse of `judgmentKey`: the case id embedded in a judgment key. Kept
 * next to the builder (rather than re-derived at each call site) so the
 * delimiter convention only ever exists in one place — see
 * `DecisionAssessment.tsx`'s `caseFlagCounts`, which rolls judgments up per
 * case for the picker's flag chip. */
export const caseIdFromJudgmentKey = (key: string): string => key.split('|')[0]

// ── Reducer ──────────────────────────────────────────────────────────────

export function reviewReducer(state: ReviewState, action: ReviewAction): ReviewState {
  switch (action.type) {
    case 'SELECT_CASE':
      return { ...state, selectedCaseId: action.caseId }

    case 'SELECT_CHECKPOINT':
      return {
        ...state,
        checkpointId: action.checkpointId,
        targetId: null,
        compareLeftId: null,
        compareRightId: null,
      }

    case 'SELECT_STAGE':
      return {
        ...state,
        stage: action.stage,
        targetId: null,
        compareLeftId: null,
        compareRightId: null,
      }

    case 'SELECT_TARGET':
      return { ...state, targetId: action.targetId }

    case 'SET_COMPARISON':
      return { ...state, compareLeftId: action.leftId, compareRightId: action.rightId }

    case 'SET_JUDGMENT':
      return { ...state, judgments: { ...state.judgments, [action.key]: action.judgment } }

    case 'SET_ASSESSMENT':
      return {
        ...state,
        assessments: {
          ...state.assessments,
          [action.key]: { assessment: action.assessment, comment: action.comment },
        },
      }

    case 'RESET':
      return initialState

    default:
      return state
  }
}

// ── Context / Provider / hook ───────────────────────────────────────────

type ReviewStoreContextValue = {
  state: ReviewState
  dispatch: React.Dispatch<ReviewAction>
}

const ReviewStoreContext = createContext<ReviewStoreContextValue | null>(null)

export function ReviewStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reviewReducer, initialState)
  const value: ReviewStoreContextValue = { state, dispatch }
  return React.createElement(ReviewStoreContext.Provider, { value }, children)
}

export function useReviewStore(): ReviewStoreContextValue {
  const ctx = useContext(ReviewStoreContext)
  if (!ctx) {
    throw new Error('useReviewStore must be used within a ReviewStoreProvider')
  }
  return ctx
}
