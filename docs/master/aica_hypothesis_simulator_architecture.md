# AICA Hypothesis Simulator — Architecture Specification Draft v1

**Document status:** Draft architecture specification  
**Source specification:** `docs/master/aica_hypothesis_simulator_specification.md`  
**Purpose:** Define the implementation architecture for AICA Hypothesis Simulator as a simple local, single-user, containerized simulator.  
**Primary runtime goal:** Open browser, test hypotheses, inspect traces, and receive automatically persisted run logs.

> **Design update — 2026-07-03 (feature `009-signal-tier-redesign`), landed.** The raw-state / feature
> model was re-designed: raw signals are organized into **three tiers** — Fixed, Dynamic, and **Simulated
> signals** (§8.1) — replacing the earlier undifferentiated driver/vehicle-profile model. `drowsiness` and
> `fatigue` are simulated *derived* values (not pretend sensors); the only stochastic signal is a single
> **seeded-Poisson `anomaly_rate`** (replayable via a frozen `run_seed`). The deterministic vehicle sensors
> (steering, pedal, lane-departure, ADAS) and `attention` are retired, along with route look-ahead signals
> and the `declarative_rule` / `weighted_score` built-in algorithm types (§9, §11) — `python_module` is now
> the sole supported algorithm type. The setup screen is two editor panels + a full-width **ephemeral
> instant-result** preview via `POST /api/runs/preview` (§13.11, §14) — headless, never persisted. See
> `specs/009-signal-tier-redesign/` and `others/aica_trigger_algorithms_math_comparison.md` (Part 2) for full
> authoritative detail.

---

## 1. Architecture Goal

The AICA Hypothesis Simulator shall be implemented as a simple local simulator, not as a full platform.

The intended user workflow is:

```text
docker compose up
→ open browser
→ select hypothesis package and scenario
→ edit parameters/hyperparameters
→ run simulation
→ inspect AICA decision trace
→ backend persists run log automatically
```

The architecture shall support Python trigger algorithms without requiring a cloud service, user accounts, a database, or multi-user collaboration.

---

## 2. Architecture Choice

The selected architecture is a **local containerized frontend + lightweight backend**.

Rejected alternatives:

- **Browser-only static app**: too limited for Python algorithm execution and automatic persisted logs.
- **Full platform backend**: too heavy for the current goal; accounts, permissions, database, collaboration, and cloud deployment are intentionally out of scope.

The backend exists only for responsibilities the browser should not own:

- executing Python algorithms;
- loading local package and scenario files;
- validating package and scenario contracts;
- normalizing algorithm outputs;
- recording decision traces;
- persisting run logs to disk.

---

## 3. Runtime Shape

```text
Docker Compose
  frontend: browser UI
  backend: lightweight API
  volumes:
    packages/
    scenarios/
    runs/

Browser UI
  → select package/scenario
  → edit parameters/hyperparameters
  → run playback
  → inspect trace/log

Backend
  → validate package
  → manage run state
  → call algorithm adapter
  → normalize decision result
  → append trace entries
  → persist run log to runs/
```

Non-goals for V1:

- no user accounts;
- no multi-user collaboration;
- no cloud dependency;
- no production vehicle integration;
- no database requirement;
- no live map dependency for correctness.

---

## 4. Technology Baseline

| Area | Choice |
|---|---|
| Frontend | React + TypeScript + Vite |
| Backend | Python FastAPI |
| Backend validation | Pydantic models |
| Package format | JSON package manifests plus optional algorithm files |
| Scenario format | JSON |
| Run log format | JSON |
| Container runtime | Docker Compose |

The backend may serve built frontend static files for simple local deployment. During development, the frontend may run as a Vite dev server.

V1 should avoid database, authentication, queue workers, cloud services, plugin marketplaces, and required map APIs.

---

## 5. Proposed Project File Structure

The project should be organized around clear runtime boundaries: backend API, frontend UI, local package/scenario data, persisted runs, and documentation.

```text
AICA-hypothesis-simulator/
  app/
    api/
      aica_api/
        __init__.py
        main.py
        config.py
        models/
          __init__.py
          package.py
          scenario.py
          run.py
          decision.py
          feedback.py
        services/
          __init__.py
          package_registry.py
          scenario_registry.py
          run_manager.py
          evidence_recorder.py
        algorithms/
          __init__.py
          adapter.py
          python_module.py
        storage/
          __init__.py
          file_store.py
        tests/
          test_package_validation.py
          test_scenario_validation.py
          test_run_manager.py
          test_algorithm_adapter.py
          test_evidence_recorder.py
      pyproject.toml

    frontend/
      package.json
      vite.config.ts
      index.html
      src/
        main.tsx
        App.tsx
        api/
          client.ts
          types.ts
        components/
          layout/
            AppShell.tsx
            LeftContextPanel.tsx
            CenterPlaybackPanel.tsx
            RightReviewPanel.tsx
          setup/
            PackageSelector.tsx
            ScenarioSelector.tsx
            ParameterEditor.tsx
            HyperparameterEditor.tsx
          playback/
            PlaybackControls.tsx
            RouteTimeline.tsx
            CockpitView.tsx
            ProposalPanel.tsx
          trace/
            DecisionTracePanel.tsx
          feedback/
            FeedbackForm.tsx
          runs/
            RunLogViewer.tsx
        state/
          runStore.ts
        styles/
          app.css
      tests/
        setup.test.tsx
        playback.test.tsx
        feedback.test.tsx

  packages/
    aica_transparent_hybrid_trigger_v1/
      package.json
      algorithm.py
      README.md
    nri_fatigue_score_v1/
      package.json
      algorithm.py
      README.md

  scenarios/
    uc01_fatigue_friend_drive_v0_1.json
    uc01_overtime_driver_v0_1.json

  runs/
    .gitkeep

  docs/
    master/
      aica_hypothesis_simulator_specification.md
      aica_hypothesis_simulator_architecture.md
    superpowers/
      specs/

  docker-compose.yml
  Dockerfile.api
  Dockerfile.frontend
  README.md
```

### 5.1 File Structure Responsibilities

| Path | Responsibility |
|---|---|
| `app/api/aica_api/main.py` | FastAPI app setup, route registration, health endpoint. |
| `app/api/aica_api/config.py` | Runtime paths for `packages/`, `scenarios/`, and `runs/`. |
| `app/api/aica_api/models/` | Pydantic request, response, manifest, scenario, run, decision, and feedback models. |
| `app/api/aica_api/services/package_registry.py` | Package discovery, loading, summary generation, validation. |
| `app/api/aica_api/services/scenario_registry.py` | Scenario discovery, loading, compatibility validation. |
| `app/api/aica_api/services/run_manager.py` | Run creation, state updates, evaluation orchestration. |
| `app/api/aica_api/services/evidence_recorder.py` | Append-only run event handling and persisted log writing. |
| `app/api/aica_api/algorithms/adapter.py` | Common algorithm dispatch and decision-result normalization. |
| `app/api/aica_api/algorithms/python_module.py` | Local trusted Python algorithm module loading and execution — the sole supported algorithm type (feature 009 retired the `declarative_rule` / `weighted_score` built-ins). |
| `app/api/aica_api/storage/file_store.py` | Safe JSON read/write helpers for local files. |
| `app/frontend/src/api/` | Typed API client and shared frontend API response types. |
| `app/frontend/src/components/setup/` | Package/scenario selection and editable parameter controls. |
| `app/frontend/src/components/playback/` | Playback controls, route/timeline visualization, cockpit proposal view. |
| `app/frontend/src/components/trace/` | Decision trace display. |
| `app/frontend/src/components/feedback/` | Structured and free-text review feedback capture. |
| `app/frontend/src/components/runs/` | Current and previous run log display. |
| `packages/` | Local hypothesis package folders. |
| `scenarios/` | Local scenario JSON files. |
| `runs/` | Automatically persisted backend run logs. |

The structure intentionally keeps algorithm execution, evidence persistence, and frontend display separate.

---

## 6. Backend Responsibilities

The backend is the simulator runtime authority.

### 6.1 Package Registry

The backend shall:

- read hypothesis packages from `packages/`;
- validate package metadata, parameters, hyperparameters, algorithm reference, proposals, feedback schema, and metrics schema;
- return package summaries to the frontend;
- prevent runs from starting with invalid packages.

### 6.2 Scenario Registry

The backend shall:

- read scenario definitions from `scenarios/`;
- validate scenario structure;
- validate scenario compatibility with the selected package;
- return scenario summaries, default profiles, setup presets, and initial state.

### 6.3 Route Analyzer And Plan Generator

The backend shall:

- accept Google Maps route data or local route fixtures;
- derive route facts such as distance, segments, segment type, rest spots, and route progress checkpoints;
- classify route segments for simulator use;
- generate concrete event plans from route-derived facts and user-controlled presets;
- freeze the generated event plan when a run starts.

### 6.4 Run Manager

The backend shall:

- create run IDs;
- snapshot selected package/scenario metadata, route facts, presets, profiles, and generated event plan;
- initialize run state;
- apply parameter and hyperparameter changes only before run start;
- reject normal parameter and hyperparameter mutation after run start and require a new simulation;
- receive test-user actions;
- receive expert override edits only when expert override mode was selected before start;
- maintain run state for evaluation.

### 6.5 Tick Engine

The backend shall:

- advance simulation time by the configured tick size;
- calculate effective speed and route progress;
- update route, driver, and vehicle state;
- maintain rolling-window vehicle event counts;
- build skeleton-aligned feature groups;
- pause simulation when interaction is required.

### 6.6 Algorithm Adapter

The backend shall:

- dispatch evaluation to supported algorithm types;
- call Python algorithms when package manifests reference Python modules;
- normalize algorithm outputs into one decision result shape;
- catch algorithm errors and append error events.

### 6.7 Trace And Evidence Recorder

The backend shall:

- append decision trace entries;
- append user actions;
- append feedback;
- persist run logs automatically under `runs/`;
- return current run evidence to the frontend.

---

## 7. Frontend Responsibilities

The frontend owns the review experience. It must not be the source of truth for trigger results, fire-control decisions, or persisted evidence.

### 7.1 Setup Workflow

The frontend shall:

- show package list;
- show compatible scenarios;
- show setup-time editable parameters and hyperparameters;
- show changed-vs-default values.

### 7.2 Playback UI

The frontend should follow the accepted skeleton direction:

- left: scenario, route, or timeline context;
- center: playback, vehicle/cabin state, and cockpit proposal experience;
- right: package controls, hyperparameters, decision trace, and feedback.

The frontend shall support:

- start;
- pause;
- step;
- reset;
- jump to decision points;
- evaluation requests to backend at configured decision points.

### 7.3 Interaction UI

The frontend shall:

- show AICA proposal messages and options;
- send user actions to backend;
- show resulting state changes returned by backend.

### 7.4 Trace, Feedback, And Log UI

The frontend shall:

- display backend decision trace entries;
- collect structured labels and free-text comments;
- submit feedback to backend;
- show current run log/evidence;
- allow copy/download of run evidence even though backend persists logs automatically.

The frontend may calculate display-only values such as progress position or animation state.

---

## 8. File-Based Package And Scenario Model

V1 shall use file-based packages, scenarios, and run logs.

Example package and scenario folders:

```text
packages/
  aica_transparent_hybrid_trigger_v1/
    package.json
    algorithm.py
    README.md
  nri_fatigue_score_v1/
    package.json
    algorithm.py
    README.md

scenarios/
  uc01_fatigue_friend_drive_v0_1.json
  uc01_overtime_driver_v0_1.json

runs/
  2026-06-26T120000Z_uc01_nri_fatigue_score_<run-id>.json
```

Only files referenced by a package manifest are active. Optional files may be absent.

---

### 8.1 Raw Signal Tiers (Fixed / Dynamic / Simulated)

Feature 009 replaced the earlier undifferentiated driver/vehicle-profile state with one **tiered raw-state
contract** that every algorithm reads from. Every per-tick signal belongs to exactly one of three named
tiers, and the tick engine emits all three on every tick (`signals.fixed` / `signals.dynamic` /
`signals.simulated`; see `specs/009-signal-tier-redesign/contracts/tiered-context.md`):

| Tier | Example signals | Editable at setup | Notes |
|---|---|---|---|
| **1 — Fixed** | `isNight`, `familiarRoute`, `childPassenger`, `weatherRiskLevel`, route/segments, rest options | some (scenario constants) | constant for the whole run |
| **2 — Dynamic** | `segmentType`, `motionState`, `continuousDrivingMin`, `speedKph`, `routeFraction`, `nextRestSpotMin`, `isTrafficJam`, `recoveryPhase` | read-only (derived) | `= f(fixed + elapsed time + user actions)` |
| **3 — Simulated** | `drowsiness`, `fatigue` (deterministic derived) · `anomaly_rate` (seeded-stochastic) | curve parameters editable | see below |

**Simulated signals are derived, not fabricated sensors.** `drowsiness` and `fatigue` accumulate
deterministically from elapsed driving time, time of day, road monotony, and traffic jams (per-scenario
`driver_signal_params`); they are display-labeled as derived quantities, never presented as ground-truth
sensor readings. The **only stochastic signal** is `anomaly_rate` — a seeded Poisson (point-process)
generator whose event rate increases with drowsiness, so identical `(scenario, run_seed)` pairs always
reproduce identical anomaly events. Each simulated signal carries a plain-language `explanation` string,
surfaced by the setup screen's signal-info popover.

**Retired in this re-design** (no replacement in V1; see the feature spec's Assumptions for return paths):
the deterministic vehicle sensors (`steeringInstabilityLevel`, `pedalAbnormalityLevel`,
`laneDepartureCount`, `adasWarningCount`), the `attentionLevel` signal, and all route look-ahead signals
(e.g. `*RemainingMin`, `restSpotDensityNext30Min`). Each algorithm derives its own features from the shared
signal set — the backend does not pre-select which tiers a given algorithm may read.

---

## 9. Package Contract

A package manifest shall define:

- metadata and version;
- compatible scenario types;
- parameter definitions;
- feature definitions;
- hyperparameter definitions;
- algorithm type and entrypoint;
- fire-control rules;
- proposal definitions;
- package runtime state defaults when the algorithm carries state across ticks;
- trigger category definitions and priority order when the package can emit multiple candidates;
- feedback schema;
- evidence metrics.

V1 supported algorithm type:

- `python_module` — local trusted Python module (the sole supported type; `AlgorithmDef.type` is
  `Literal["python_module"]`). The earlier `declarative_rule` and `weighted_score` built-in types were
  retired by feature `009-signal-tier-redesign` — see Constitution Principle V.

Future algorithm types may include:

- `javascript_module`;
- `state_machine`;
- `external_runner`.

---

## 10. Scenario Contract

A scenario file shall define:

- scenario metadata and version;
- persona;
- route intent and rest-opportunity defaults;
- Tier-1 fixed context (`is_night`, `child_passenger`, `familiar_route`, weather);
- generated-event presets;
- simulated-signal generator parameters — `driver_signal_params` (drowsiness/fatigue curves + recovery)
  and `anomaly_signal_params` (seeded-Poisson rate) (§8.1; renamed from the retired `driver_profile` /
  `vehicle_profile` model);
- default speed profile;
- a `run_seed_default` suggested at setup and frozen per run;
- allowed test-user actions;
- review focus.

The scenario loader rejects an old-shape scenario (one still carrying `driver_profile` / `vehicle_profile`)
with a clear "incompatible — re-author" error rather than silently mis-reading it (no automatic migration
tool; feature `009-signal-tier-redesign`, FR-017).

The backend validates package/scenario compatibility before run creation. The scenario is a backbone; the concrete event plan is generated after route selection and before run start.

---

## 11. Algorithm Adapter Contract

All algorithms shall pass through one backend adapter contract.

Standard backend call:

```text
evaluate(package, scenario_state, parameters, hyperparameters, history, package_runtime_state)
→ decision_result
```

Standard decision result shape:

```json
{
  "result_type": "REST_PROPOSAL",
  "trigger_candidate": true,
  "selected_category": "rest_required",
  "score": 0.78,
  "features": {
    "drowsiness_score": 0.74,
    "fatigue_score": 0.62,
    "rest_window_score": 0.9
  },
  "scores": {
    "base_safety_risk": 0.58,
    "rest_required_score": 0.78,
    "monotony_prevention_score": 0.44
  },
  "states": {
    "rest": "REST_RECOMMEND",
    "monotony": "MONOTONY_WATCH"
  },
  "criteria": {
    "risk_threshold": 0.72
  },
  "candidates": [
    {
      "category": "rest_required",
      "exists": true,
      "score": 0.78,
      "state": "REST_RECOMMEND",
      "strength": "clear",
      "fire_control": {
        "fired": true,
        "suppressed": false,
        "override": false,
        "reason": "fire_control_passed"
      }
    },
    {
      "category": "monotony_prevention",
      "exists": false,
      "score": 0.44,
      "state": "MONOTONY_WATCH",
      "strength": null,
      "fire_control": {
        "fired": false,
        "suppressed": false,
        "override": false,
        "reason": "below_threshold"
      }
    }
  ],
  "fire_control": {
    "suppressed": false,
    "override": false,
    "reason": null
  },
  "proposal": {
    "id": "rest_guidance",
    "message": "...",
    "options": ["accept_rest", "postpone"]
  },
  "reason_inputs": ["drowsiness_level", "fatigue_level", "rest_opportunity_score"],
  "explanation": "Risk score exceeded threshold and a rest spot is reachable.",
  "next_package_runtime_state": {
    "smoothed_scores": {
      "rest_required_score": 0.73,
      "monotony_prevention_score": 0.42
    },
    "persistence_counters": {
      "rest_required": 2,
      "monotony_prevention": 0
    }
  }
}
```

For simpler algorithms, `features`, `scores`, `states`, `candidates`, and `next_package_runtime_state` may be empty or omitted when the schema permits it. For hybrid algorithms, these fields are the primary evidence surface and should be preserved in the trace.

Suppressed candidates are normal decision results. A suppressed result shall keep the candidate in `candidates`, set the candidate fire-control `suppressed` flag, and usually return `proposal: null` with `result_type: "SUPPRESSED"`.

`result_type` also defines a `NO_PRACTICAL_ACTION_FALLBACK` value in the schema for a trigger that fires
with no actionable proposal available. As of feature `009-signal-tier-redesign` neither surviving package
(the compact Hybrid or NRI) emits it — a product-visible change from the earlier built-in algorithms. The
value is kept in the schema (not removed) since a future package may still need it; the adapter does not
require every algorithm to use every enum value.

The `context` passed to `evaluate` carries the tiered `signals` object (§8.1: `signals.fixed` /
`signals.dynamic` / `signals.simulated`) alongside history and `package_runtime_state`; the algorithm
selects which signals/tiers it needs and computes its own features from them.

For Python packages, the backend imports a package-local module and calls:

```python
def evaluate(context: dict) -> dict:
    ...
```

The backend validates and normalizes the returned dictionary. Missing fields, invalid values, or exceptions produce an `algorithm_error` event rather than a normal AICA decision.

Python algorithms are treated as local trusted code in V1. They are not untrusted uploads. `python_module`
is the only supported algorithm type (§9) — the earlier `declarative_rule` and `weighted_score` built-ins
were retired.

Python packages may implement the transparent hybrid trigger pattern: feature extraction, score smoothing, state thresholds, persistence, multi-category candidate generation, fire-control, priority resolution, and bilingual proposal generation. The backend remains generic by passing context in and validating the normalized result out.

---

## 12. Run State, Trace, And Logs

The backend shall treat a run as an append-only evidence record.

Run lifecycle:

```text
create_run
→ freeze package + scenario + route + generated plan snapshot
→ initialize state
→ receive tick events
→ update route/driver/vehicle state
→ call algorithm adapter
→ append tick and decision trace
→ pause when interaction is required
→ receive user action or expert override
→ append action event
→ receive feedback
→ append feedback event
→ persist log after every append
```

The run log shall be a JSON file under `runs/`.

Each run log shall contain:

- run ID;
- created timestamp;
- simulator version;
- package snapshot: ID, version, path/hash;
- scenario snapshot: ID, version, path/hash;
- route snapshot and route-derived facts;
- generated event plan;
- run mode and evidence status;
- the frozen `run_seed` (§8.1; drives the seeded `anomaly_rate` generator so `(scenario, run_seed)`
  reproduces byte-identical decision traces — FR-005/FR-006);
- simulated-signal generator parameter snapshots (`driver_signal_params`, `anomaly_signal_params`; the
  `driver_profile`/`vehicle_profile` log fields are kept for pre-009 evidence-log compatibility only —
  `vehicle_profile` is unused going forward since the deterministic vehicle sensors were retired);
- speed profile;
- initial parameters;
- current/final parameters;
- initial hyperparameters;
- current/final hyperparameters;
- tick events and timeline events;
- tiered raw-state (`raw_state`: fixed/dynamic/simulated signals) and feature-group updates per tick
  (`driver_update`; `vehicle_update` is kept in the per-tick schema for log back-compat but is always
  empty post-009 — no vehicle-signal producer sets it);
- decision trace entries;
- AICA proposal events;
- user action events;
- expert override events when any occur;
- feedback events;
- algorithm errors when any occur.

Persistence rule:

> After each meaningful run event, the backend writes the updated run log to disk.

This avoids losing evidence if the browser refreshes or the container stops.

---

## 13. Architecture Workflow Sequence

This section describes the sequence of runtime interactions.

### 13.1 Startup Sequence

```text
1. User runs docker compose up.
2. Backend starts and reads runtime configuration.
3. Backend scans packages/ and validates package manifests.
4. Backend scans scenarios/ and validates scenario files.
5. Frontend starts or is served by backend.
6. User opens browser.
7. Frontend calls GET /api/packages and GET /api/scenarios.
8. Frontend renders package and scenario setup UI.
```

### 13.2 Setup And Generated Plan Sequence

```text
1. User selects a package.
2. Frontend requests package detail from backend.
3. User selects a compatible scenario.
4. Frontend requests scenario detail from backend.
5. User enters start/end locations or selects a local route fixture.
6. Frontend calls POST /api/routes/analyze.
7. Backend derives route facts and returns candidate route summaries.
8. User selects route, presets, profiles, initial state, hyperparameters, and run mode.
9. Frontend calls POST /api/run-plans.
10. Backend generates a draft event plan from route facts and presets.
11. Frontend displays generated plan summary.
12. User may regenerate or edit allowed advanced generated-plan details before start.
```

### 13.3 Run Creation And Start Sequence

```text
1. User presses Start.
2. Frontend calls POST /api/runs with selected package, scenario, route facts, presets, profiles, hyperparameters, run mode, and generated event plan.
3. Backend validates package/scenario/route/plan compatibility.
4. Backend creates run ID.
5. Backend freezes the setup snapshot and generated event plan.
6. Backend initializes run state.
7. Backend writes initial run log to runs/.
8. Backend returns run state to frontend.
```

### 13.4 Playback And Evaluation Sequence

```text
1. User starts or steps playback.
2. Frontend calls POST /api/runs/{run_id}/tick.
3. Backend tick engine advances simulation time when not paused.
4. Backend calculates route progress, active generated events, driver state, vehicle state, rolling counts, and skeleton-aligned feature groups.
5. Backend builds evaluation context from run state, route facts, generated plan, parameters, hyperparameters, profiles, history, and package runtime state.
6. Backend dispatches to algorithm adapter.
7. Algorithm adapter calls the package's `python_module` implementation.
8. Backend validates and normalizes decision result.
9. Backend stores returned `next_package_runtime_state` into the run state when present.
10. Backend appends tick event and decision trace entry, including all candidates and suppressed candidates.
11. Backend pauses the run if proposal or required interaction exists.
12. Backend persists updated run log to runs/.
13. Backend returns decision result, trace entry, pause state, and updated run state.
14. Frontend updates cockpit proposal, timeline marker, and trace panel.
```

### 13.5 User Action Sequence

```text
1. AICA proposal is visible in frontend.
2. User selects an option such as accept rest, postpone, reject, or choose content.
3. Frontend calls POST /api/runs/{run_id}/actions.
4. Backend validates action against current run state and package-defined allowed actions.
5. Backend applies state transition when defined.
6. Backend appends action event.
7. Backend persists updated run log to runs/.
8. Backend returns updated run state.
9. Frontend updates playback and available controls.
```

### 13.6 Setup Value Change Sequence

```text
1. User edits before run start.
2. User changes a permitted parameter or hyperparameter.
3. Frontend calls POST /api/run-plans or updates draft setup state.
4. Backend validates value against package definition.
5. Backend regenerates or updates the draft generated event plan when needed.
6. Frontend shows the updated setup and generated-plan summary.
7. After run start, the same change requires a new simulation rather than mutating the active run.
```

### 13.7 Expert Override Sequence

```text
1. Run is paused and run mode is expert_override.
2. User edits an allowed runtime state field and provides a reason.
3. Frontend calls POST /api/runs/{run_id}/expert-overrides.
4. Backend validates the field is override-allowed.
5. Backend appends expert_override event and marks evidence_status as non_standard.
6. Backend persists updated run log to runs/.
7. Backend returns updated run state.
```

### 13.8 Feedback And Log Sequence

```text
1. User submits structured labels and/or free-text feedback.
2. Frontend calls POST /api/runs/{run_id}/feedback.
3. Backend validates feedback against package feedback schema.
4. Backend appends feedback event.
5. Backend persists updated run log to runs/.
6. Frontend calls GET /api/runs/{run_id}/log when user opens log view.
7. Backend returns persisted evidence JSON.
8. Frontend displays log and optionally allows copy/download.
```

### 13.9 Evidence Replay Sequence

```text
1. User opens an existing run log.
2. Frontend calls GET /api/runs/{run_id}/log.
3. Backend returns the persisted evidence JSON.
4. Frontend renders read-only playback from recorded tick, proposal, action, and feedback events.
5. Algorithm decisions are not recalculated.
6. No new user actions are collected.
```

### 13.10 Algorithm Error Sequence

```text
1. Frontend requests evaluation.
2. Backend calls algorithm adapter.
3. Algorithm raises exception or returns invalid result.
4. Backend catches failure.
5. Backend appends algorithm_error event to run log.
6. Backend persists updated run log to runs/.
7. Backend returns error trace response.
8. Frontend shows error in trace panel and avoids showing a normal AICA decision.
```

### 13.11 Instant Result Preview Sequence

Feature `009-signal-tier-redesign` added an ephemeral, non-persisting preview so the setup screen can show
the *tune → observe* effect of a hyperparameter or signal change without starting a full run.

```text
1. User edits a hyperparameter, signal, or the run seed on the setup screen (before Start).
2. Frontend debounces the change and calls POST /api/runs/preview with the candidate RunConfig
   (package_id, scenario_id, hyperparameter_overrides, run_seed, rest_option_id).
3. Backend runs the SAME tick engine + algorithm adapter loop as a persisted run, headlessly (no
   animation), to completion or first fire.
4. Backend returns an InstantResult: fired/not, fire point + category + strength, peak score vs
   threshold, a per-tick score series, segments, rest spot, auto-chosen rest option, completion time,
   the seed, and the overrides actually applied — or an algorithm_error descriptor (never a fabricated
   normal decision; FR-010).
5. The EvidenceRecorder is NEVER invoked for this path — nothing is written to runs/.
6. Frontend renders the instant-result timeline. "Open full run" re-issues the identical configuration
   through the normal POST /api/run-plans → POST /api/runs sequence (§13.2–§13.3), which is the point a
   run is actually persisted.
```

---

## 14. API Shape

The API should be small and explicit.

```text
GET  /api/packages
GET  /api/packages/{package_id}

GET  /api/scenarios
GET  /api/scenarios/{scenario_id}

POST /api/routes/analyze
POST /api/run-plans
POST /api/run-plans/{plan_id}/regenerate

POST /api/runs
POST /api/runs/preview
POST /api/runs/{run_id}/tick
POST /api/runs/{run_id}/actions
POST /api/runs/{run_id}/expert-overrides
POST /api/runs/{run_id}/feedback

GET  /api/runs
GET  /api/runs/{run_id}
GET  /api/runs/{run_id}/log
```

Endpoint behavior:

- `POST /api/routes/analyze` derives route facts from Google Maps route data or a local fixture.
- `POST /api/run-plans` generates a draft event plan from route facts and setup presets.
- `POST /api/run-plans/{plan_id}/regenerate` regenerates the draft plan before run start.
- `POST /api/runs` freezes selected setup and generated plan, creates a run, and persists the first log file.
- `POST /api/runs/preview` (feature 009, §13.11) runs the same tick engine + algorithm adapter loop
  headlessly for a candidate RunConfig and returns an `InstantResult` — **ephemeral**, never persisted;
  the EvidenceRecorder is never invoked. 400 for an unknown/incompatible package or scenario, an
  old-shape (pre-re-design) scenario, or invalid hyperparameter overrides.
- `POST /api/runs/{run_id}/tick` advances the deterministic tick engine, calls the algorithm adapter, and appends tick/trace entries.
- `POST /api/runs/{run_id}/actions` records reviewer choices.
- `POST /api/runs/{run_id}/expert-overrides` records allowed paused-state edits only for expert override runs.
- `POST /api/runs/{run_id}/feedback` records structured and free-text feedback.
- `GET /api/runs/{run_id}/log` returns the evidence JSON persisted on disk.

Parameter and hyperparameter edits are setup-time operations for V1. After run start, changed setup values require a new simulation rather than active-run mutation.

No authentication is required for V1 local single-user operation.

---

## 15. Error Handling And Safety Boundaries

The simulator must not silently turn failures into trusted evidence.

### 15.1 Invalid Package

If a package is invalid:

- backend rejects package at validation;
- frontend shows package validation errors;
- no run can start with that package.

### 15.2 Invalid Scenario

If a scenario is invalid or incompatible:

- backend rejects scenario or marks it incompatible with the selected package;
- frontend shows compatibility errors;
- no run can start with that scenario/package pair.

### 15.3 Algorithm Error

If an algorithm raises an exception or returns an invalid result:

- backend catches the failure;
- backend appends an `algorithm_error` event to the run log;
- frontend shows the error in the trace panel;
- run may continue only after reset, value change, or package/scenario change depending on error type.

### 15.4 Persistence Error

If persistence fails:

- backend returns an error;
- backend marks the run as not safely persisted;
- frontend shows that evidence persistence failed.

### 15.5 Python Safety

V1 is local and trusted-user only. Python algorithms are local code executed inside the container. The architecture does not provide sandboxing for untrusted uploaded algorithms.

Boundary rule:

> The simulator records what happened and what failed. It never hides failures behind normal-looking AICA decisions.

---

## 16. Testing Strategy

Testing should focus on the contracts that make the simulator trustworthy.

### 16.1 Backend Tests

Backend tests shall cover:

- package validation accepts valid package fixtures;
- package validation rejects missing metadata;
- package validation rejects invalid hyperparameters;
- package validation rejects invalid algorithm entrypoints;
- scenario validation checks package compatibility;
- route analysis returns route-derived facts for local route fixtures;
- generated plan creation freezes concrete traffic/rest events before run start;
- run creation writes an initial log file;
- setup-time parameter and hyperparameter changes are reflected in generated runs;
- active-run parameter and hyperparameter mutation is rejected for standard runs;
- tick engine advances route progress from numeric speed profile;
- traffic jam speed overrides road speed;
- driver and vehicle profile updates are deterministic;
- rolling-window vehicle counts are calculated correctly;
- algorithm adapter normalizes declarative, weighted-score, and Python results;
- algorithm failures append `algorithm_error` events;
- evaluation appends decision trace entries;
- actions append events;
- expert overrides append events and mark evidence as non-standard;
- feedback appends events;
- run log can be reloaded from disk;
- evidence replay can render from a persisted log without recalculating algorithm decisions.

### 16.2 Frontend Tests

Frontend tests shall cover:

- package/scenario selection renders backend data;
- editable parameters and hyperparameters render from schema;
- route setup and generated-plan summary render backend data;
- playback controls send expected API calls;
- AICA proposal options send user actions;
- trace panel displays backend decision results;
- feedback form submits structured and free-text data;
- run log view loads persisted evidence;
- evidence replay displays recorded events read-only.

### 16.3 Integration Tests

An integration test should:

1. start the app;
2. create a UC-01 run;
3. generate a route plan;
4. start playback;
5. tick until evaluation appends trace;
6. accept a proposal;
7. submit feedback;
8. verify `runs/<run-id>.json` exists and contains route facts, generated plan, tick trace, action, and feedback.

Testing rule:

> Algorithm outputs, trace entries, and persisted run logs are contract surfaces. They need stronger tests than visual animation.

---

## 17. Open Architecture Decisions For Later

The following decisions should be handled during milestone/version planning or V1 implementation planning:

- exact package JSON schema;
- exact scenario JSON schema;
- whether frontend TypeScript types are manually maintained or generated from backend schema;
- whether run logs should be JSON only or JSON plus Markdown export;
- whether optional map support belongs in V1 or a later milestone;
- how much logic from the functional skeleton should be reused directly versus rewritten against the new contracts.
