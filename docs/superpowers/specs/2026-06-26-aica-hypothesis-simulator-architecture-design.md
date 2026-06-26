# AICA Hypothesis Simulator Architecture Design

Date: 2026-06-26
Status: Approved brainstorming design
Source specification: `docs/master/aica_hypothesis_simulator_specification.md`

## 1. Goal

Define the implementation architecture for AICA Hypothesis Simulator as a simple local, single-user, containerized simulator.

The intended workflow is:

```text
docker compose up
→ open browser
→ select hypothesis package and scenario
→ edit parameters/hyperparameters
→ run simulation
→ inspect AICA decision trace
→ backend persists run log automatically
```

The architecture should support Python trigger algorithms without becoming a full platform backend.

## 2. Architecture Choice

The selected architecture is a **local containerized frontend + lightweight backend**.

Rejected alternatives:

- Browser-only static app: too limited for Python algorithm execution and automatic persisted logs.
- Full platform backend: too heavy for the current goal; accounts, permissions, database, collaboration, and cloud deployment are intentionally out of scope.

The backend exists only for responsibilities the browser should not own:

- executing Python algorithms;
- loading local package and scenario files;
- validating package/scenario contracts;
- normalizing algorithm outputs;
- recording decision trace;
- persisting run logs to disk.

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

Non-goals:

- no user accounts;
- no multi-user collaboration;
- no cloud dependency;
- no production vehicle integration;
- no database requirement for V1;
- no live map dependency for V1 correctness.

## 4. Technology Baseline

| Area | Choice |
|---|---|
| Frontend | React + TypeScript + Vite |
| Backend | Python FastAPI |
| Validation | Pydantic models on backend |
| Package format | JSON package manifests plus optional algorithm files |
| Scenario format | JSON |
| Run log format | JSON |
| Container | Docker Compose |

The backend may serve built frontend static files for simple local deployment. During development, the frontend may run as a Vite dev server.

V1 should avoid database, authentication, queue workers, cloud services, plugin marketplaces, and required map APIs.

## 5. Backend Responsibilities

The backend is the simulator runtime authority.

### 5.1 Package Registry

The backend shall:

- read hypothesis packages from `packages/`;
- validate package metadata, parameters, hyperparameters, algorithm reference, proposals, feedback schema, and metrics schema;
- return package summaries to the frontend;
- prevent runs from starting with invalid packages.

### 5.2 Scenario Registry

The backend shall:

- read scenario definitions from `scenarios/`;
- validate scenario structure;
- validate scenario compatibility with the selected package;
- return scenario summaries and initial state.

### 5.3 Run Manager

The backend shall:

- create run IDs;
- snapshot selected package/scenario metadata;
- initialize run state;
- apply parameter and hyperparameter changes;
- receive test-user actions;
- maintain run state for evaluation.

### 5.4 Algorithm Adapter

The backend shall:

- dispatch evaluation to supported algorithm types;
- call Python algorithms when package manifests reference Python modules;
- normalize algorithm outputs into one decision result shape;
- catch algorithm errors and append error events.

### 5.5 Trace And Evidence Recorder

The backend shall:

- append decision trace entries;
- append user actions;
- append feedback;
- persist run logs automatically under `runs/`;
- return current run evidence to the frontend.

## 6. Frontend Responsibilities

The frontend owns the review experience. It must not be the source of truth for trigger results, fire-control decisions, or persisted evidence.

### 6.1 Setup Workflow

The frontend shall:

- show package list;
- show compatible scenarios;
- show editable parameters and hyperparameters;
- show changed-vs-default values.

### 6.2 Playback UI

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

### 6.3 Interaction UI

The frontend shall:

- show AICA proposal messages and options;
- send user actions to backend;
- show resulting state changes returned by backend.

### 6.4 Trace, Feedback, And Log UI

The frontend shall:

- display backend decision trace entries;
- collect structured labels and free-text comments;
- submit feedback to backend;
- show current run log/evidence;
- allow copy/download of run evidence even though backend persists logs automatically.

The frontend may calculate display-only values such as progress position or animation state.

## 7. File-Based Package And Scenario Model

V1 shall use file-based packages, scenarios, and run logs.

Proposed folder structure:

```text
packages/
  rest_weighted_score_v0_1/
    package.json
    algorithm.py
    algorithm.js
    README.md

scenarios/
  uc01_fatigue_friend_drive_v0_1.json
  uc01_overtime_driver_v0_1.json

runs/
  2026-06-26T120000Z_uc01_rest_weighted_score_<run-id>.json
```

Only files referenced by a package manifest are active. Optional files may be absent.

## 8. Package Contract

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

## 9. Scenario Contract

A scenario file shall define:

- scenario metadata and version;
- persona;
- route and rest opportunities;
- initial state;
- timeline events;
- allowed test-user actions;
- review focus.

The backend validates package/scenario compatibility before run creation.

## 10. Algorithm Adapter Contract

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

## 11. Run State, Trace, And Logs

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

## 12. API Shape

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

## 13. Error Handling And Safety Boundaries

The simulator must not silently turn failures into trusted evidence.

### 13.1 Invalid Package

If a package is invalid:

- backend rejects package at validation;
- frontend shows package validation errors;
- no run can start with that package.

### 13.2 Invalid Scenario

If a scenario is invalid or incompatible:

- backend rejects scenario or marks it incompatible with the selected package;
- frontend shows compatibility errors;
- no run can start with that scenario/package pair.

### 13.3 Algorithm Error

If an algorithm raises an exception or returns an invalid result:

- backend catches the failure;
- backend appends an `algorithm_error` event to the run log;
- frontend shows the error in the trace panel;
- run may continue only after reset, value change, or package/scenario change depending on error type.

### 13.4 Persistence Error

If persistence fails:

- backend returns an error;
- backend marks the run as not safely persisted;
- frontend shows that evidence persistence failed.

### 13.5 Python Safety

V1 is local and trusted-user only. Python algorithms are local code executed inside the container. The architecture does not provide sandboxing for untrusted uploaded algorithms.

Boundary rule:

> The simulator records what happened and what failed. It never hides failures behind normal-looking AICA decisions.

## 14. Testing Strategy

Testing should focus on the contracts that make the simulator trustworthy.

### 14.1 Backend Tests

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

### 14.2 Frontend Tests

Frontend tests shall cover:

- package/scenario selection renders backend data;
- editable parameters and hyperparameters render from schema;
- playback controls send expected API calls;
- AICA proposal options send user actions;
- trace panel displays backend decision results;
- feedback form submits structured and free-text data;
- run log view loads persisted evidence.

### 14.3 Integration Tests

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

## 15. Open Architecture Decisions For Later

The following decisions should be deferred until milestone/version planning:

- exact package JSON schema;
- exact scenario JSON schema;
- whether frontend TypeScript types are manually maintained or generated from backend schema;
- whether run logs should be JSON only or JSON plus Markdown export;
- whether optional map support belongs in V1 or a later milestone;
- how much logic from the functional skeleton should be reused directly versus rewritten against the new contracts.

