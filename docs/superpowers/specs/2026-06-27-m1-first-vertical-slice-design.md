# ADR / Design — M1 First Runnable Vertical Slice

**Date:** 2026-06-27
**Milestone:** M1 — First Runnable Vertical Slice
**Status:** Accepted (pending implementation)
**Source docs:** `docs/master/aica_hypothesis_simulator_milestones.md` §3,
`aica_hypothesis_simulator_architecture.md` §§9–14,
`aica_hypothesis_simulator_runtime_workflow.md`; constitution v1.0.0
**Builds on:** M0 (`docs/superpowers/specs/2026-06-27-m0-project-foundation-design.md`)

---

## 1. Context

M0 delivered the runnable skeleton (FastAPI + React/Vite + Docker, health
round-trip). M1 proves the smallest **useful** simulator loop end-to-end: pick a
package + scenario, run a deterministic UC-01 fatigue drive, evaluate decision
points through the one algorithm-adapter contract, see a decision trace, and find
an auto-persisted JSON run log in `runs/`.

The two reference prototypes under `others/` already embody the principled
behavior we want: the **functional skeleton** uses qualitative ordinal bands,
server-side boundary-binning, route fractions (`at` 0..1) instead of raw km, and a
first-match rule list producing a decision — exactly what the constitution
mandates. M1 mirrors those *concepts* (the prototype is not a dependency) and the
**accepted skeleton**'s 3-panel layout.

## 2. Scope decisions (settled in brainstorming)

| # | Decision | Choice | Note |
|---|----------|--------|------|
| D1 | Tick engine depth | **Minimal-but-real** | Freeze event plan at run start; per-tick state; adapter each tick; scenario shaped so exactly one tick triggers. |
| D2 | Branch base | **Merge M0 → develop first**, then branch `002` off develop | Done at the Phase-2 transition, not during design. |
| D3 | Decision-result shape | **Full §11** `DecisionResult` | Pulls M2's decision-result schema forward (deliberate). |
| D4 | Frontend fidelity | **Close-to-skeleton, fully functional** | 3-panel; real backend data; no premature polish (UX tightening stays M6). |
| D5 | Google Maps | **Defer to M4** | M1 uses the deterministic local segmented route (what the skeleton shows). A `binning` seam lets M4 plug Maps in. Avoids BYO-key security + binning scope now. |
| D6 | Actions / feedback | **Minimal actions; defer feedback** | `accept_rest`/`postpone` actions affect run state; structured feedback + evidence replay stay M5. |

### Honest scope note

D3 + D4 make this a **thick** vertical slice: M1 absorbs M2's decision-result and
manifest/scenario schema work. This is intentional. Consequence: **M2 becomes
"harden the rest of the schema + add the second (weighted-score) package + the
setup/run-plan flow"** rather than "introduce schemas." The slice remains a single
end-to-end loop, so the constitution's vertical-slice principle still holds.

## 3. In scope / out of scope

**In:** package registry, scenario registry, boundary-bin seam, event-plan freeze,
deterministic tick engine, the one algorithm-adapter contract + a built-in
`declarative_rule` algorithm normalized to the full §11 `DecisionResult`,
append-only evidence recorder → `runs/`, the API subset below, one rule package,
one UC-01 scenario, a close-to-skeleton functional 3-panel frontend with
accept/postpone actions.

**Out (later milestones):** `POST /api/routes/analyze` + `/api/run-plans` setup
flow (M2); Google Maps surface (M4); structured feedback capture + evidence
replay (M5); `weighted_score` (M2) and `python_module` (M3) algorithms;
expert-override (M5+); full bilingual/UX polish (M6).

**API subset (of architecture §14):**

```
GET  /api/packages                GET  /api/packages/{package_id}
GET  /api/scenarios               GET  /api/scenarios/{scenario_id}
POST /api/runs                    POST /api/runs/{run_id}/tick
POST /api/runs/{run_id}/actions
GET  /api/runs                    GET  /api/runs/{run_id}
GET  /api/runs/{run_id}/log
```

## 4. Backend architecture (`app/api/aica_api/`)

### 4.1 Models (`models/`) — Pydantic

- `package.py` — `PackageManifest`, `ParameterDef`, `FeatureDef`,
  `HyperparameterDef`, `ProposalDef`, `TriggerCategoryDef`, `FireControlRule`.
- `scenario.py` — `ScenarioDef`, `Persona`, `RouteIntent`, `RouteSegment`
  (`id`, `name`, `type`, `at` 0..1, `speed_band`, `length_band`,
  `is_rest_facility`), `EventPreset`, `DriverProfile`, `VehicleProfile`.
- `run.py` — `RunState`, `EventPlan`, `TickState`, `RouteFacts`, `Snapshot`.
- `decision.py` — the **full §11** `DecisionResult`: `result_type`,
  `trigger_candidate`, `selected_category`, `score`, `features`, `scores`,
  `states`, `criteria`, `candidates[]` (`Candidate` + `FireControl`),
  `fire_control`, `proposal`, `reason_inputs`, `explanation`,
  `next_package_runtime_state`.
- `log.py` — `RunLog`, `TraceEntry`, `TickEvent`, `ActionEvent`, `AlgorithmError`.

### 4.2 Services (`services/`)

- `package_registry.py` — scan `packages/`, load + validate manifests, summaries +
  detail. Invalid package → visible error, never loaded (architecture §15.1).
- `scenario_registry.py` — scan `scenarios/`, load + validate, package/scenario
  compatibility check (§15.2).
- `binning.py` — the boundary-bin seam (raw → ordinal bands). For M1 the local
  scenario authors bands directly, so this is near-identity; it is the single
  server-side place raw values would enter, satisfying constitution principle IV
  and giving M4 (Maps) a plug-in point.
- `event_plan.py` — freeze a concrete `EventPlan` from scenario `event_presets` at
  run start (deterministic).
- `tick_engine.py` — per-tick: advance sim time, compute route position from `at`
  fractions, resolve active events, derive qualitative driver/vehicle bands and
  rolling state, build the evaluation **context**.
- `run_manager.py` — `create_run` (freeze snapshot + plan, init state, first log
  write), `tick` (engine → adapter → trace → persist → pause), `action` (validate
  against allowed actions, apply transition, persist).
- `evidence_recorder.py` — append-only writer; persist after every meaningful
  event; keeps simulator facts separate from (future) human comments.

### 4.3 Algorithms (`algorithms/`)

- `adapter.py` — the **one** contract
  `evaluate(package, context, parameters, hyperparameters, history,
  package_runtime_state) → DecisionResult`; dispatch by `algorithm.type`;
  validate + normalize to the full `DecisionResult`; exceptions / invalid returns
  become an `algorithm_error` event, never a normal decision (constitution II, V).
- `declarative_rule.py` — built-in first-match rule engine (R1 severe override →
  R2 fallback-if-unreachable → R3 rest-proposal → R4 soft-warning → R5 no-trigger,
  ported from the functional skeleton) producing the populated `DecisionResult`
  with the `rest_required` candidate, fire-control, and proposal. Hybrid-only
  fields (`features`/`scores`/`states` smoothing, `next_package_runtime_state`)
  stay empty — honest for a non-hybrid rule algorithm (§11 permits this).

### 4.4 Storage

- `storage/file_store.py` — safe atomic JSON read/write for local files.

### 4.5 One-tick data flow

```
POST /api/runs/{id}/tick
  → run_manager.tick
    → tick_engine builds context (frozen plan + position + history)
    → adapter.evaluate → declarative_rule → normalized DecisionResult
    → append TraceEntry + TickEvent
    → evidence_recorder persists runs/<id>.json
    → pause if proposal present
  → return decision + trace + pause + run state
```

The **adapter contract** and the **append-only recorder** are the two boundaries
everything routes through (constitution I, II, V).

## 5. Data files

Both authored in **qualitative bands only** — no concrete number reaches the
trigger (constitution IV).

### 5.1 `packages/rest_rule_based_v0_1/package.json` (+ `README.md`)

A `declarative_rule` rest-proposal package. Manifest carries: metadata + version;
`compatible_scenario_types: ["uc01_fatigue"]`; `algorithm.type = "declarative_rule"`;
parameter defs (e.g. `rest_spot_sensitivity` band); feature defs
(`drowsiness_level`, `fatigue_level`, `signal_duration`,
`continuous_driving_time`, `rest_spot_eta`); hyperparameter defs
(`trigger_sensitivity`, `proposal_threshold`, `severe_threshold`,
`persistence_requirement`, `require_actionable`); `trigger_categories`
(`rest_required`, priority 1); declarative `rules` (R1–R5 first-match);
`fire_control` (threshold + actionability guard); `proposals`
(`rest_guidance`, options `accept_rest`/`postpone`, bilingual message);
placeholder `feedback_schema` (real capture is M5); minimal `evidence_metrics`.

### 5.2 `scenarios/uc01_fatigue_friend_drive_v0_1.json`

UC-01 fatigue friend-drive. Carries: persona; `route_intent` with segments using
`at` fractions + `speed_band`/`length_band` (no km) and a `rest` facility at
`at: 0.5`; `initial_state` (`drowsiness_level: none`, `fatigue_level: low`);
`event_presets` with a deterministic drowsiness schedule by route fraction
(`none → weak @0.3 → moderate @0.42`), `signal_duration_at_trigger: sustained`,
and rest reachable before the rest segment; default driver/vehicle profiles;
`allowed_actions: ["accept_rest","postpone"]`; review focus.

**Determinism by construction:** the frozen event plan derives from
`event_presets`. As route fraction crosses ~0.42 with `rest_spot_eta = near` and
`sustained` signal, the rule hits **R3 REST_PROPOSAL exactly once**; earlier ticks
are no-trigger/soft-warning; the run pauses at the proposal;
`accept_rest`/`postpone` drive the transition.

## 6. Frontend (`app/frontend/src/`)

Close-to-skeleton 3-panel, real backend data, plain CSS mirroring the accepted
skeleton. Builds on M0's `App.tsx`.

- **Layout (`components/layout/`):** `AppShell` → `LeftContextPanel`,
  `CenterPlaybackPanel`, `RightReviewPanel`.
- **Left (`components/setup/`, `context/`):** `PackageSelector`,
  `ScenarioSelector` (real selectors, single option in M1); route segment list
  with active-segment highlight; live readouts (position %, driving time,
  drowsiness/fatigue **band labels** from tick state — not progress-derived bars).
- **Center (`components/playback/`):** `PlaybackControls` (play/pause/step,
  1×/2×/4×; play polls `POST /tick` on an interval, step ticks once; the frontend
  computes *display-only* animation position between ticks); `RouteTimeline`
  (scrubable bar, car icon, fire marker at the proposal's route fraction from the
  trace, segment dividers); state cards (driver / environment bands from tick
  state); `CockpitView` ↔ `ProposalPanel` (nav normally; on a fired proposal,
  overlay with message, rationale from `reason_inputs`/`explanation`, and
  `accept_rest`/`postpone` → `POST /actions`).
- **Right (`components/trace/`, `runs/`):** `DecisionTracePanel` (per-tick
  `TraceEntry`: `result_type`, `selected_category`, `score`, candidates **incl.
  suppressed shown as suppressed**, `fire_control`, `reason_inputs`,
  `explanation`); `RunLogViewer` (`GET /api/runs/{id}/log` → persisted evidence
  JSON, proving auto-persistence).
- **State/data (`state/runStore.ts`, `api/client.ts`):** typed client mirrors
  backend models; `runStore` holds run state, latest decision, trace list, pause
  flag. The frontend **never owns decisions/evidence** (constitution I); it renders
  backend results and computes only display-only animation. The skeleton's
  `structuralSignature` becomes a memo key so the cockpit re-renders on structural
  change, not every animation frame.

## 7. Testing strategy (TDD)

Contract surfaces (adapter, decision result, registries, persisted log) carry the
strongest tests (constitution: contract surfaces tested first).

**Backend (pytest):**
- `declarative_rule`/adapter: R1 severe override; R3 full conjunction + each broken
  conjunct; R2/R3 actionability boundary; R4 soft-warning; R5 no-trigger;
  **totality** (always one of the 5 result_types) and **determinism**.
- Adapter normalization: rule output → full §11 `DecisionResult`; invalid/exception
  → `algorithm_error` event, never a normal decision.
- Registries: valid fixture loads; invalid manifest/scenario → visible validation
  error (not silently skipped); compatibility check.
- `tick_engine`: deterministic position from `at` fractions; frozen plan → exactly
  one tick crosses into `REST_PROPOSAL`; same plan reproduces the same trace.
- `evidence_recorder`: log written after every event; append-only; required
  snapshot fields present.
- API integration: `POST /api/runs` → tick to proposal → `action` → `GET /log`
  reflects persisted JSON; **backend-only run with no frontend** (acceptance).

**Frontend (Vitest + Testing Library):**
- Client maps each endpoint to typed models; panels render real shapes (trace shows
  suppressed candidates; cockpit swaps to proposal on a fired result; action buttons
  call `POST /actions`); `runStore` transitions select → run → tick → pause →
  action → resume; display-only animation never mutates decision state.

**End-to-end (controller-run):** `docker compose up`, drive a UC-01 run (start →
tick to proposal → accept) and confirm `runs/<id>.json` exists with the full trace
+ action — the M1 acceptance proof.

## 8. Acceptance mapping (milestone §3)

| Milestone criterion | M1 satisfies it |
|---|---|
| Open browser, start UC-01 playback, evaluate, see AICA result, find persisted log | Frontend run loop + `runs/<id>.json` |
| Backend API can perform the same run without frontend | API-integration test drives the full loop |
| Deterministic local route sufficient; no Maps | Local segmented route + frozen event plan |
| UI can be rough; correctness of package/evaluate/log loop matters | Close-skeleton functional UI; contract-tested loop |

## 9. Consequences

- A reviewer can run a real UC-01 fatigue drive and inspect a full decision trace +
  auto-persisted evidence — the first genuinely useful slice.
- The full §11 `DecisionResult`, the adapter contract, the registries, the tick
  engine, and the evidence recorder all land now, so M2/M3 add *algorithms and the
  setup/run-plan flow* on top of a real schema rather than inventing it.
- The `binning` seam and route-fraction model keep Maps (M4) and qualitative
  discipline clean; no raw numerics in the decision path.
- M2's framing shifts to "harden remaining schema + weighted-score package + setup
  flow" (documented here so the milestone docs stay coherent).
