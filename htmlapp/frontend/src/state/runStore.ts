import React, { createContext, useContext, useEffect, useReducer } from 'react'
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
  ContextOverrides,
  RestChoice,
  InstantResult,
} from '../api/types'
import { runPreview as runPreviewClient } from '../api/client'
import { useLanguage } from './language'
import { t } from '../i18n/t'
import type { BilingualLabel } from '../i18n/t'

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
   * Default 'en'; toggled via SET_LANGUAGE.
   */
  uiLanguage: 'ja' | 'en'

  // ── M6 T009: ProfileEditor overrides ───────────────────────────────────────
  /**
   * Sparse profile overrides computed by ProfileEditor.
   * Null means no overrides (omit profiles from run-plan body).
   * Cleared on SELECT_SCENARIO and RESET.
   */
  profileOverrides: ProfileOverrides | null

  // ── Feature 009 (UX-FE1): Fixed-tier scenario-context overrides ────────────
  /**
   * Sparse, changed-from-scenario-default Fixed-tier signal overrides
   * (child_passenger, familiar_route, weather_risk). A key is present ONLY
   * when its value differs from the scenario's own default — mirrors the
   * editedHyperparameters/SET_HYPERPARAMETER revert-to-default convention
   * (see SET_CONTEXT_OVERRIDE below). Sent as `context_overrides` in BOTH
   * useRunPreview's POST /runs/preview body and the "Open full run"
   * createRunPlan call, so preview and real run stay faithful to each other.
   * Cleared on SELECT_SCENARIO and RESET (a new scenario has its own defaults).
   */
  contextOverrides: ContextOverrides

  // ── Tick seconds override (setup-time) ─────────────────────────────────────
  /**
   * User-set tick duration in seconds. Null means "use scenario default" —
   * nothing is sent in presets. A positive integer sends presets.tick_seconds.
   * Cleared on SELECT_SCENARIO and RESET so each new scenario starts fresh.
   */
  tickSecondsOverride: number | null

  // ── Rest-spot reachability ceiling override (setup-time) ──────────────────
  /**
   * User-set rest-spot reachability ceiling (drowsiness %). Null means "use
   * scenario default" — nothing is sent as a query param. A number (may exceed
   * 100) overrides the scenario default. This is the REST-SPOT ceiling only,
   * independent of the algorithm trigger threshold.
   * Cleared on SELECT_SCENARIO and RESET.
   */
  restDrowsinessCeiling: number | null

  // ── Rest-spot minimum spacing override (setup-time) ───────────────────────
  /**
   * User-set minimum distance (km) between returned rest spots. Null means
   * "use backend default (2 km)" — nothing is sent as a query param.
   * A positive number overrides the backend default.
   * Cleared on SELECT_SCENARIO and RESET.
   */
  minRestSpacingKm: number | null

  // ── feature 020: painted traffic-jam ranges (km) for the Combined Simulator ─
  /**
   * Traffic-jam ranges painted in the merged setup panel, as `[start_km, end_km]`
   * pairs on the selected route. Bridged into the runStore so the center panel's
   * `<MapSurface/>` can draw them in red over the route (the setup panel that
   * paints them is a sibling of the map). Empty = no jam painted. Setup-only —
   * survives RESET (a run reset shouldn't wipe the painted setup).
   */
  mergedJamRangesKm: [number, number][]

  /**
   * Mountain-road ranges painted in the merged setup panel, as
   * `[start_km, end_km]` pairs on the selected route. Bridged here for the same
   * reason as the jam ranges — but the gap it closes is bigger: a painted
   * mountain range is spliced into `route_facts.route_segments` SERVER-side,
   * into the trigger run plan, while `<MapSurface/>` colours segments from the
   * UNPAINTED route alternative it holds in this store. Without this bridge the
   * painted stretch showed in the quickview and nowhere on the map.
   * Empty = none painted. Setup-only — survives RESET.
   */
  mergedMountainRangesKm: [number, number][]

  // ── M7: last applied action (for beat timeline / recovery) ─────────────────
  /**
   * The action string from the most recent ACTION_APPLIED dispatch.
   * Used by downstream components (e.g. recovery beat timeline) to know what
   * the reviewer just did. Null until the first action is taken; cleared on RESET.
   */
  lastAction: string | null

  /**
   * Accepted rests this run, in order. Captured at accept time so the chosen
   * spot + option persist after the transient recovery state clears — drives
   * the persistent rest markers (map + progress bar) and the event-log
   * "driver chose rest" line. Cleared on new run / scenario change / reset.
   */
  restHistory: RestChoice[]

  // ── Initial driver state override (setup-time) ────────────────────────────
  /**
   * User-set starting drowsiness (0–100). Null = use scenario default. Cleared on SELECT_SCENARIO and RESET.
   */
  initialDrowsiness: number | null

  /**
   * User-set starting fatigue (0–100). Null = use scenario default. Cleared on SELECT_SCENARIO and RESET.
   */
  initialFatigue: number | null

  // ── Feature 009: setup-screen instant-result preview ───────────────────────
  /**
   * The run_seed used for the setup-screen preview (POST /runs/preview) and,
   * eventually, the real run. Defaults to 42 (mirrors the backend ScenarioDef
   * default); a SignalsPanel that has loaded the full ScenarioDef should
   * dispatch SET_RUN_SEED with the scenario's actual run_seed_default once
   * known. Reset to the default on SELECT_SCENARIO / RESET.
   */
  runSeed: number
  /** Latest ephemeral InstantResult from POST /runs/preview; null before the first preview or after it errors. */
  instantResult: InstantResult | null
  /** True while a preview request is in flight (debounced — see useRunPreview). */
  previewLoading: boolean
  /** Error message from the most recent failed preview request; null when the last preview succeeded. */
  previewError: string | null
  /**
   * The signal key currently cross-highlighted between SignalsPanel and
   * AlgorithmFormulationPanel (hover/click a feature name ↔ its signal row).
   * Null when nothing is highlighted.
   */
  highlightedSignalKey: string | null
}

/** The seed used before a scenario's real run_seed_default is known (mirrors the backend ScenarioDef default). */
const DEFAULT_RUN_SEED = 42

export const initialState: RunStoreState = {
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
  // M6 T004 — default to English
  uiLanguage: 'en',
  // M6 T009 — no profile overrides initially
  profileOverrides: null,
  // Feature 009 (UX-FE1) — no Fixed-tier context overrides initially
  contextOverrides: {},
  // tick seconds — null means "use scenario default"
  tickSecondsOverride: null,
  // rest-spot reachability ceiling — null means "use scenario default"
  restDrowsinessCeiling: null,
  // rest-spot minimum spacing — null means "use backend default (2 km)"
  minRestSpacingKm: null,
  // feature 020 — no traffic jam painted yet
  mergedJamRangesKm: [],
  // feature 020 — no mountain road painted yet
  mergedMountainRangesKm: [],
  // M7 — no action taken yet
  lastAction: null,
  // M7 — no rests accepted yet
  restHistory: [],
  // initial driver state overrides — null means "use scenario default"
  initialDrowsiness: null,
  initialFatigue: null,
  // Feature 009 — setup-screen instant-result preview
  runSeed: DEFAULT_RUN_SEED,
  instantResult: null,
  previewLoading: false,
  previewError: null,
  highlightedSignalKey: null,
}

// ── Actions ────────────────────────────────────────────────────────────────

export type RunStoreAction =
  | { type: 'LOAD_PACKAGES'; packages: PackageSummary[]; errors?: RegistryError[] }
  | { type: 'LOAD_SCENARIOS'; scenarios: ScenarioSummary[]; errors?: RegistryError[] }
  | { type: 'SELECT_PACKAGE'; id: string }
  | { type: 'SELECT_SCENARIO'; id: string }
  | { type: 'RUN_CREATED'; runState: RunState }
  | { type: 'RUN_COMPLETED'; runState: RunState }
  | {
      type: 'TICK_APPENDED'
      runState: RunState
      decision: DecisionResult
      tickIndex: number
      paused: boolean
      completed: boolean
      /** Authoritative route position (0–1) from the tick response, if present. */
      routeFraction?: number | null
      /** Current motion state (e.g. 'MOVING', 'STOPPED') from the recovery engine. */
      motionState?: string | null
      /** Current recovery phase label from the recovery engine. */
      recoveryPhase?: string | null
      /** Active content string shown during a recovery stage. */
      activeContent?: string | null
      /** True when the current segment is a traffic jam. */
      isTrafficJam?: boolean | null
      /** Current road segment class from the tick engine. */
      segmentType?: string | null
      /** Current effective speed (kph) from the tick engine. */
      speedKph?: number | null
      /** True when this tick's proposal actually paused the run (not suppressed during recovery). */
      proposalPaused?: boolean
    }
  | {
      type: 'ACTION_APPLIED'
      runState: RunState
      /** The action string applied — recorded for the beat timeline. */
      action: string
      /**
       * Present only for an accepted rest: the chosen option + spot, appended
       * to restHistory so the markers/log survive after recovery ends.
       */
      restChoice?: RestChoice
    }
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
  | {
      type: 'SET_HYPERPARAMETER'
      key: string
      value: SetupValue
      /**
       * The hyperparameter's manifest default, when known to the caller.
       * When `value` equals `default`, the reducer REMOVES `key` from
       * `editedHyperparameters` instead of storing it — this is the fix for
       * the FE3 "stale override" bug (see reducer case below). Callers that
       * omit `default` keep the old always-set behavior (back-compat for
       * call sites that don't have the manifest default at hand).
       */
      default?: SetupValue
    }
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
  // ── Feature 009 (UX-FE1): Fixed-tier scenario-context overrides ───────────
  /**
   * Set a single Fixed-tier context-override field (child_passenger,
   * familiar_route, weather_risk). When `value` equals `default` (the
   * scenario's own default for this key), the reducer REMOVES `key` from
   * `contextOverrides` instead of storing it — same changed-from-default
   * discipline as SET_HYPERPARAMETER (see its reducer case for the bug this
   * pattern fixes: a stale override sitting around after a revert-to-default
   * edit would otherwise still be sent to the preview/real run).
   */
  | {
      type: 'SET_CONTEXT_OVERRIDE'
      key: keyof ContextOverrides
      value: SetupValue
      default: SetupValue
    }
  // ── Tick seconds override ─────────────────────────────────────────────────
  /** Set the tick duration override (positive integer), or null to clear (use scenario default). */
  | { type: 'SET_TICK_SECONDS'; seconds: number | null }
  // ── Rest-spot reachability ceiling override ───────────────────────────────
  /** Set the rest-spot reachability ceiling (drowsiness %), or null to clear (use scenario default). */
  | { type: 'SET_REST_DROWSINESS_CEILING'; value: number | null }
  // ── Rest-spot minimum spacing override ───────────────────────────────────
  /** Set the minimum distance (km) between rest spots, or null to clear (use backend default 2 km). */
  | { type: 'SET_MIN_REST_SPACING_KM'; value: number | null }
  // ── feature 020: painted traffic-jam ranges (km) for the merged map ─────────
  /** Set the painted traffic-jam km ranges (Combined Simulator map overlay). */
  | { type: 'SET_MERGED_JAM_RANGES'; ranges: [number, number][] }
  /** Set the painted mountain-road km ranges (Combined Simulator map overlay). */
  | { type: 'SET_MERGED_MOUNTAIN_RANGES'; ranges: [number, number][] }
  // ── Initial driver state overrides ─────────────────────────────────────────
  /** Set the starting drowsiness (0–100), or null to clear (use scenario default). */
  | { type: 'SET_INITIAL_DROWSINESS'; value: number | null }
  /** Set the starting fatigue (0–100), or null to clear (use scenario default). */
  | { type: 'SET_INITIAL_FATIGUE'; value: number | null }
  // ── Feature 009: setup-screen instant-result preview ───────────────────────
  /** Set the run_seed used for the preview (and eventually the real run). */
  | { type: 'SET_RUN_SEED'; seed: number }
  /** Draw a fresh random seed (re-rolls the anomaly_rate event pattern). */
  | { type: 'REROLL_SEED' }
  /** A debounced preview request has been sent; clears any previous error. */
  | { type: 'PREVIEW_REQUESTED' }
  /** The preview request succeeded; stores the InstantResult. */
  | { type: 'PREVIEW_SUCCEEDED'; result: InstantResult }
  /** The preview request failed; stores the error message. */
  | { type: 'PREVIEW_FAILED'; message: string }
  /** Cross-link highlight between SignalsPanel and AlgorithmFormulationPanel. */
  | { type: 'SET_HIGHLIGHTED_SIGNAL'; key: string | null }

// ── Reducer ────────────────────────────────────────────────────────────────

export function reducer(state: RunStoreState, action: RunStoreAction): RunStoreState {
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
      // A same-id re-select (e.g. committing a test case, which re-dispatches
      // SELECT_PACKAGE with the trigger package already in state) must NOT
      // wipe the reviewer's tuning — mirrors how service/content overrides
      // (SET_SERVICE_PACKAGE / SET_CONTENT_PACKAGE) are left untouched.
      if (action.id === state.selectedPackageId) {
        return state
      }
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
        // A different algorithm invalidates the previous preview.
        instantResult: null,
        previewError: null,
      }

    case 'SELECT_SCENARIO': {
      // Changing the scenario invalidates the draft (route facts change).
      // A LOCALLY-analyzed route is scenario-derived, so it's cleared; a
      // Maps/preset route is a real geographic route independent of the scenario,
      // so it's PRESERVED (else picking route→scenario→package would silently drop
      // the chosen preset and the preview would fall back to the local route).
      const keepMapsRoute = state.routeSource === 'maps' && state.selectedRouteId != null
      return {
        ...state,
        selectedScenarioId: action.id,
        planId: null,
        draftPlan: null,
        effectiveSetup: null,
        setupError: null,
        // Clear a locally-analyzed route; keep a maps/preset selection.
        alternatives: keepMapsRoute ? state.alternatives : [],
        selectedRouteId: keepMapsRoute ? state.selectedRouteId : null,
        routeSource: keepMapsRoute ? 'maps' : 'local',
        mapsError: null,
        // T009: clear profile overrides — new scenario has its own defaults.
        profileOverrides: null,
        // Feature 009 (UX-FE1): clear context overrides — new scenario has its own defaults.
        contextOverrides: {},
        // Clear tick seconds override — new scenario has its own default.
        tickSecondsOverride: null,
        // Clear rest-spot ceiling override — new scenario has its own default.
        restDrowsinessCeiling: null,
        // Clear rest-spot spacing override — new scenario has its own default.
        minRestSpacingKm: null,
        // Clear initial driver state overrides — new scenario has its own defaults.
        initialDrowsiness: null,
        initialFatigue: null,
        // New scenario — discard any prior accepted-rest history.
        restHistory: [],
        // Feature 009: new scenario invalidates the previous preview + seed
        // (a SignalsPanel that loads the ScenarioDef should re-seed via
        // SET_RUN_SEED with the scenario's own run_seed_default).
        runSeed: DEFAULT_RUN_SEED,
        instantResult: null,
        previewError: null,
      }
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

    case 'SET_HYPERPARAMETER': {
      // Bug fix (feature 009 FE4): when the caller supplies the manifest
      // default and the new value equals it, REMOVE the key from
      // editedHyperparameters rather than storing it. Without this, reverting
      // a previously-overridden value back to its default left a stale
      // override sitting in editedHyperparameters — sent verbatim as
      // hyperparameter_overrides to POST /runs/preview (via useRunPreview)
      // and baked into a real run via PlanPreview → createRunPlan. The
      // "N overrides" chip was also wrong (selectOverridesDiff compares
      // against the SAME defaults, so a stale-but-equal-to-default entry
      // would previously survive as a bogus override until the diff was
      // rechecked externally).
      if (action.default !== undefined && action.value === action.default) {
        const { [action.key]: _removed, ...rest } = state.editedHyperparameters
        return {
          ...state,
          editedHyperparameters: rest,
          planId: null,
          draftPlan: null,
          effectiveSetup: null,
        }
      }
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
        // Fresh run — no rests accepted yet.
        restHistory: [],
      }

    case 'RUN_COMPLETED':
      // M2 (distance-based) runs complete via a no-op tick (decision: null) from
      // the backend — TICK_APPENDED is never dispatched for that tick, so this
      // action is the only way to set completed=true and update runState.
      return { ...state, runState: action.runState, completed: true }

    case 'TICK_APPENDED': {
      const entry: TraceEntry = {
        ...action.decision,
        tick_index: action.tickIndex,
        route_fraction: action.routeFraction ?? null,
        motion_state: action.motionState ?? null,
        recovery_phase: action.recoveryPhase ?? null,
        active_content: action.activeContent ?? null,
        is_traffic_jam: action.isTrafficJam ?? null,
        segment_type: action.segmentType ?? null,
        speed_kph: action.speedKph ?? null,
        proposal_paused: action.proposalPaused ?? false,
      }
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
        lastAction: action.action,
        restHistory: action.restChoice
          ? [...state.restHistory, action.restChoice]
          : state.restHistory,
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

    case 'SET_CONTEXT_OVERRIDE': {
      if (action.value === action.default) {
        const next = { ...state.contextOverrides }
        delete next[action.key]
        return { ...state, contextOverrides: next }
      }
      return {
        ...state,
        contextOverrides: { ...state.contextOverrides, [action.key]: action.value } as ContextOverrides,
      }
    }

    case 'SET_TICK_SECONDS':
      return { ...state, tickSecondsOverride: action.seconds }

    case 'SET_REST_DROWSINESS_CEILING':
      return { ...state, restDrowsinessCeiling: action.value }

    case 'SET_MIN_REST_SPACING_KM':
      return { ...state, minRestSpacingKm: action.value }

    case 'SET_MERGED_JAM_RANGES':
      return { ...state, mergedJamRangesKm: action.ranges }

    case 'SET_MERGED_MOUNTAIN_RANGES':
      return { ...state, mergedMountainRangesKm: action.ranges }

    case 'SET_INITIAL_DROWSINESS':
      return { ...state, initialDrowsiness: action.value }

    case 'SET_INITIAL_FATIGUE':
      return { ...state, initialFatigue: action.value }

    // ── Feature 009: setup-screen instant-result preview ────────────────────
    case 'SET_RUN_SEED':
      return { ...state, runSeed: action.seed }

    case 'REROLL_SEED':
      return { ...state, runSeed: Math.floor(Math.random() * 1_000_000) }

    case 'PREVIEW_REQUESTED':
      return { ...state, previewLoading: true, previewError: null }

    case 'PREVIEW_SUCCEEDED':
      return { ...state, previewLoading: false, instantResult: action.result, previewError: null }

    case 'PREVIEW_FAILED':
      return { ...state, previewLoading: false, previewError: action.message }

    case 'SET_HIGHLIGHTED_SIGNAL':
      return { ...state, highlightedSignalKey: action.key }

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
        // Feature 009 (UX-FE1): clear context overrides on reset
        contextOverrides: {},
        // Clear tick seconds override on reset
        tickSecondsOverride: null,
        // Clear rest-spot ceiling override on reset
        restDrowsinessCeiling: null,
        // Clear rest-spot spacing override on reset
        minRestSpacingKm: null,
        // M7: clear last action on reset
        lastAction: null,
        // M7: clear accepted-rest history on reset
        restHistory: [],
        // Clear initial driver state overrides on reset
        initialDrowsiness: null,
        initialFatigue: null,
        // Feature 009: clear the preview + seed on reset
        runSeed: DEFAULT_RUN_SEED,
        instantResult: null,
        previewLoading: false,
        previewError: null,
        highlightedSignalKey: null,
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

export function RunStoreProvider({
  children,
  initialLanguage,
}: {
  children: React.ReactNode
  /**
   * Optional override for the initial UI language. When omitted, the store
   * uses its default (English). Lets a caller seed a preferred language.
   */
  initialLanguage?: 'ja' | 'en'
}) {
  const [state, dispatch] = useReducer(
    reducer,
    initialLanguage ? { ...initialState, uiLanguage: initialLanguage } : initialState,
  )
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

// ── Feature 009: overrides-diff selector + debounced preview hook ──────────

/** One changed-from-manifest-default hyperparameter (mirrors InstantResult.overrides shape). */
export type OverridesDiffEntry = { key: string; default: SetupValue; value: SetupValue }

/**
 * Pure selector: the subset of `edited` that actually differs from `defaults`
 * (changed-from-manifest-default). `defaults` is keyed by hyperparameter key,
 * e.g. built from a fetched PackageManifest's `hyperparameters[].default`.
 * Keys absent from `defaults` (unknown to the current package) are ignored.
 */
export function selectOverridesDiff(
  edited: Record<string, SetupValue>,
  defaults: Record<string, SetupValue>,
): OverridesDiffEntry[] {
  return Object.entries(edited)
    .filter(([key, value]) => key in defaults && value !== defaults[key])
    .map(([key, value]) => ({ key, default: defaults[key], value }))
}

/** Debounce window (ms) for the setup-screen instant-result preview. */
const PREVIEW_DEBOUNCE_MS = 400

/** Fallback shown when the preview request fails with no `.bilingual` pair
 *  to resolve (see `resolvePreviewErrorMessage` below). */
const PREVIEW_ERROR_LABEL: BilingualLabel = {
  ja: 'プレビューの取得に失敗しました。',
  en: 'Failed to load the preview.',
}

/**
 * Resolves a caught preview-request error to a UI-language-appropriate
 * string. Prefers the `.bilingual` pair `api/client.ts`'s `apiFetch` attaches
 * to HTTP-status failures — resolved through `t()`, never shown as raw
 * English (rule 3) — and otherwise states the failure in the reviewer's
 * language.
 *
 * A thrown value with no bilingual pair (a network fault, a bug) still
 * contributes its own text, appended as clearly-labelled TECHNICAL DETAIL
 * rather than as the message itself. Dropping it would leave a failure with
 * no record of what went wrong, which is the one thing an error surface must
 * not do.
 */
const TECHNICAL_DETAIL_LABEL: BilingualLabel = { ja: '技術的な詳細', en: 'Technical detail' }

function resolvePreviewErrorMessage(err: unknown, lang: 'ja' | 'en'): string {
  if (err && typeof err === 'object' && 'bilingual' in err) {
    return t((err as { bilingual: BilingualLabel }).bilingual, lang)
  }
  const raw = err instanceof Error ? err.message : String(err ?? '')
  const stated = t(PREVIEW_ERROR_LABEL, lang)
  if (!raw) return stated
  // Full-width brackets in Japanese, ASCII in English — punctuation is part of
  // the language, and a 「（）」 inside an English sentence reads as wrong as a
  // stray English word inside a Japanese one.
  const [open, close] = lang === 'ja' ? ['（', '）'] : [' (', ')']
  return `${stated}${open}${t(TECHNICAL_DETAIL_LABEL, lang)}: ${raw}${close}`
}

/**
 * Fires a debounced POST /runs/preview whenever the setup changes (package,
 * scenario, hyperparameter overrides, or run_seed), storing the resulting
 * InstantResult (or error) back into the store. Call this ONCE from a
 * top-level setup component (e.g. SetupScreen) — it reads/writes the shared
 * store, so multiple call sites would fire duplicate requests.
 *
 * hyperparameter_overrides is sent as-is from `editedHyperparameters` — by
 * convention that map holds changed-from-default values only (see
 * RunStoreState.editedHyperparameters); callers that populate it should keep
 * that invariant (use selectOverridesDiff against the package manifest before
 * dispatching SET_HYPERPARAMETER for values equal to the default).
 */
export function useRunPreview(debounceMs: number = PREVIEW_DEBOUNCE_MS): void {
  const { state, dispatch } = useRunStore()
  // Resolves the catch-block fallback below to the active UI language. Safe
  // with no LanguageProvider ancestor — useLanguage() defaults to 'en'.
  const { lang } = useLanguage()
  const {
    selectedPackageId,
    selectedScenarioId,
    editedHyperparameters,
    runSeed,
    profileOverrides,
    contextOverrides,
    alternatives,
    selectedRouteId,
    routeSource,
  } = state

  // Selected Maps/preset route (if any) — threaded into the preview so the strip
  // reflects the chosen route, matching "Open full run". Null on the local path.
  const selectedAlt =
    routeSource === 'maps' && selectedRouteId != null
      ? alternatives.find((a) => a.route_id === selectedRouteId) ?? null
      : null

  useEffect(() => {
    if (!selectedPackageId || !selectedScenarioId) return

    let cancelled = false
    const timer = setTimeout(() => {
      dispatch({ type: 'PREVIEW_REQUESTED' })
      runPreviewClient({
        package_id: selectedPackageId,
        scenario_id: selectedScenarioId,
        hyperparameter_overrides: editedHyperparameters,
        run_seed: runSeed,
        // Feature 009 (FE1): thread sparse profile/context overrides through
        // so the preview stays faithful to the real run (createRunPlan
        // already receives both — see InstantResultStrip's handleOpenFullRun).
        ...(profileOverrides != null ? { profiles: profileOverrides } : {}),
        ...(Object.keys(contextOverrides).length > 0 ? { context_overrides: contextOverrides } : {}),
        // Selected Maps/preset route — so a chosen preset actually changes the strip.
        ...(selectedAlt != null
          ? {
              route_source: 'maps',
              route_id: selectedAlt.route_id,
              route_facts: selectedAlt.route_facts,
              display_route: selectedAlt.display,
            }
          : {}),
      })
        .then((result) => {
          if (!cancelled) dispatch({ type: 'PREVIEW_SUCCEEDED', result })
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            dispatch({
              type: 'PREVIEW_FAILED',
              message: resolvePreviewErrorMessage(err, lang),
            })
          }
        })
    }, debounceMs)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedPackageId,
    selectedScenarioId,
    editedHyperparameters,
    runSeed,
    profileOverrides,
    contextOverrides,
    selectedAlt,
    debounceMs,
    dispatch,
  ])
}
