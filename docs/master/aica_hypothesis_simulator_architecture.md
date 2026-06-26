# AICA Hypothesis Simulator — Architecture Specification Draft v1

**Document status:** Draft architecture specification  
**Source specification:** `docs/master/aica_hypothesis_simulator_specification.md`  
**Purpose:** Define the implementation architecture for AICA Hypothesis Simulator as a simple local, single-user, containerized simulator.  
**Primary runtime goal:** Open browser, test hypotheses, inspect traces, and receive automatically persisted run logs.

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
          declarative_rule.py
          weighted_score.py
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
    rest_weighted_score_v0_1/
      package.json
      algorithm.py
      README.md
    rest_rule_based_v0_1/
      package.json
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
| `app/api/aica_api/algorithms/declarative_rule.py` | Built-in declarative rule algorithm support. |
| `app/api/aica_api/algorithms/weighted_score.py` | Built-in weighted-score algorithm support. |
| `app/api/aica_api/algorithms/python_module.py` | Local trusted Python algorithm module loading and execution. |
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
- return scenario summaries and initial state.

### 6.3 Run Manager

The backend shall:

- create run IDs;
- snapshot selected package/scenario metadata;
- initialize run state;
- apply parameter and hyperparameter changes;
- receive test-user actions;
- maintain run state for evaluation.

### 6.4 Algorithm Adapter

The backend shall:

- dispatch evaluation to supported algorithm types;
- call Python algorithms when package manifests reference Python modules;
- normalize algorithm outputs into one decision result shape;
- catch algorithm errors and append error events.

### 6.5 Trace And Evidence Recorder

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
- show editable parameters and hyperparameters;
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
  rest_weighted_score_v0_1/
    package.json
    algorithm.py
    README.md

scenarios/
  uc01_fatigue_friend_drive_v0_1.json
  uc01_overtime_driver_v0_1.json

runs/
  2026-06-26T120000Z_uc01_rest_weighted_score_<run-id>.json
```

Only files referenced by a package manifest are active. Optional files may be absent.

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
- feedback schema;
- evidence metrics.

V1 supported algorithm types:

- `declarative_rule`;
- `weighted_score`;
- `python_module`.

Future algorithm types may include:

- `javascript_module`;
- `state_machine`;
- `external_runner`.

---

## 10. Scenario Contract

A scenario file shall define:

- scenario metadata and version;
- persona;
- route and rest opportunities;
- initial state;
- timeline events;
- allowed test-user actions;
- review focus.

The backend validates package/scenario compatibility before run creation.

---

## 11. Algorithm Adapter Contract

All algorithms shall pass through one backend adapter contract.

Standard backend call:

```text
evaluate(package, scenario_state, parameters, hyperparameters, history)
→ decision_result
```

Standard decision result shape:

```json
{
  "result_type": "REST_PROPOSAL",
  "trigger_candidate": true,
  "score": 0.78,
  "criteria": {
    "risk_threshold": 0.72
  },
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
  "explanation": "Risk score exceeded threshold and a rest spot is reachable."
}
```

For Python packages, the backend imports a package-local module and calls:

```python
def evaluate(context: dict) -> dict:
    ...
```

The backend validates and normalizes the returned dictionary. Missing fields, invalid values, or exceptions produce an `algorithm_error` event rather than a normal AICA decision.

Python algorithms are treated as local trusted code in V1. They are not untrusted uploads.

---

## 12. Run State, Trace, And Logs

The backend shall treat a run as an append-only evidence record.

Run lifecycle:

```text
create_run
→ load package + scenario snapshot
→ initialize state
→ receive playback/evaluation events
→ call algorithm adapter
→ append decision trace
→ receive user action
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
- initial parameters;
- current/final parameters;
- initial hyperparameters;
- current/final hyperparameters;
- timeline events;
- decision trace entries;
- AICA proposal events;
- user action events;
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

### 13.2 Run Creation Sequence

```text
1. User selects a package.
2. Frontend requests package detail from backend.
3. User selects a compatible scenario.
4. Frontend requests scenario detail from backend.
5. User edits allowed initial parameters and hyperparameters.
6. Frontend calls POST /api/runs.
7. Backend validates package/scenario compatibility.
8. Backend creates run ID.
9. Backend snapshots package/scenario metadata and initial values.
10. Backend writes initial run log to runs/.
11. Backend returns run state to frontend.
```

### 13.3 Playback And Evaluation Sequence

```text
1. User starts or steps playback.
2. Frontend updates display-only playback state.
3. At a decision point, frontend calls POST /api/runs/{run_id}/evaluate.
4. Backend builds evaluation context from run state, parameters, hyperparameters, timeline, and history.
5. Backend dispatches to algorithm adapter.
6. Algorithm adapter calls declarative, weighted-score, or Python algorithm implementation.
7. Backend validates and normalizes decision result.
8. Backend appends decision trace entry.
9. Backend persists updated run log to runs/.
10. Backend returns decision result and trace entry.
11. Frontend updates cockpit proposal, timeline marker, and trace panel.
```

### 13.4 User Action Sequence

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

### 13.5 Parameter Or Hyperparameter Change Sequence

```text
1. User pauses playback or edits before run start.
2. User changes a permitted parameter or hyperparameter.
3. Frontend calls POST /api/runs/{run_id}/parameters or POST /api/runs/{run_id}/hyperparameters.
4. Backend validates value against package definition.
5. Backend updates run state.
6. Backend appends value-change event.
7. Backend persists updated run log to runs/.
8. Next evaluation uses the updated value.
```

### 13.6 Feedback And Log Sequence

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

### 13.7 Algorithm Error Sequence

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

---

## 14. API Shape

The API should be small and explicit.

```text
GET  /api/packages
GET  /api/packages/{package_id}

GET  /api/scenarios
GET  /api/scenarios/{scenario_id}

POST /api/runs
POST /api/runs/{run_id}/parameters
POST /api/runs/{run_id}/hyperparameters
POST /api/runs/{run_id}/evaluate
POST /api/runs/{run_id}/actions
POST /api/runs/{run_id}/feedback

GET  /api/runs
GET  /api/runs/{run_id}
GET  /api/runs/{run_id}/log
```

Endpoint behavior:

- `POST /api/runs` creates a run from selected package/scenario and persists the first log file.
- `POST /api/runs/{run_id}/parameters` applies parameter changes and persists the run log.
- `POST /api/runs/{run_id}/hyperparameters` applies hyperparameter changes and persists the run log.
- `POST /api/runs/{run_id}/evaluate` calls the algorithm adapter and appends a trace entry.
- `POST /api/runs/{run_id}/actions` records reviewer choices.
- `POST /api/runs/{run_id}/feedback` records structured and free-text feedback.
- `GET /api/runs/{run_id}/log` returns the evidence JSON persisted on disk.

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
- run creation writes an initial log file;
- parameter updates are persisted;
- hyperparameter updates are persisted;
- algorithm adapter normalizes declarative, weighted-score, and Python results;
- algorithm failures append `algorithm_error` events;
- evaluation appends decision trace entries;
- actions append events;
- feedback appends events;
- run log can be reloaded from disk.

### 16.2 Frontend Tests

Frontend tests shall cover:

- package/scenario selection renders backend data;
- editable parameters and hyperparameters render from schema;
- playback controls send expected API calls;
- AICA proposal options send user actions;
- trace panel displays backend decision results;
- feedback form submits structured and free-text data;
- run log view loads persisted evidence.

### 16.3 Integration Tests

An integration test should:

1. start the app;
2. create a UC-01 run;
3. change a hyperparameter;
4. evaluate;
5. accept a proposal;
6. submit feedback;
7. verify `runs/<run-id>.json` exists and contains trace, action, and feedback.

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

