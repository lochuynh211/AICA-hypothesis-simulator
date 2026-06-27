# Feature Specification: M0 Project Foundation

**Feature Branch**: `001-m0-project-foundation`

**Created**: 2026-06-27

**Status**: Draft

**Input**: User description: "M0 Project Foundation — implement the M0 skeleton per docs/superpowers/specs/2026-06-27-m0-project-foundation-design.md: project structure (app/api, app/frontend, packages, scenarios, runs), Docker Compose (dev hot-reload), backend skeleton with a health endpoint, frontend shell that calls backend health, backend and frontend test runners, and placeholder directories. No package/scenario/evaluation logic."

## Clarifications

### Session 2026-06-27

- Q: When the frontend loads before the backend is ready, should it retry automatically or require a manual reload? → A: Fetch health once on page load; on failure show an error state and the developer reloads the page to retry. No automatic retry or polling in M0.

## User Scenarios & Testing *(mandatory)*

The primary audience for this milestone is the **developer/reviewer** working on
the AICA Hypothesis Simulator. M0 delivers no simulator behavior — its value is a
runnable, testable foundation that every later milestone builds on.

### User Story 1 - Start the application and see it is alive (Priority: P1)

A developer clones the repository and starts the whole application with a single
command, then opens the served page in a browser. The page shows an application
shell that reports whether the backend is reachable and healthy.

**Why this priority**: This is the core proof that the foundation exists and the
two halves of the system (frontend shell + backend service) are wired together.
Without it, no later milestone can be demonstrated. It is the minimal viable
slice of M0.

**Independent Test**: Run the single start command, open the served page, and
confirm it displays a positive backend-health status sourced from the backend
service. Fully testable on its own, delivering a visible end-to-end round-trip.

**Acceptance Scenarios**:

1. **Given** a freshly cloned repository, **When** the developer runs the single
   start command, **Then** both the backend service and the frontend shell start
   and remain running.
2. **Given** both services are running, **When** the developer opens the frontend
   page in a browser, **Then** the page renders an application shell that displays
   the backend health status.
3. **Given** the backend reports healthy, **When** the frontend requests health,
   **Then** the shell shows a clear "healthy/ok" indication identifying the
   backend service.

---

### User Story 2 - Run the automated tests on both sides (Priority: P2)

A developer runs the backend test suite and the frontend test suite to confirm
the project is testable and the health round-trip is covered by an automated
check.

**Why this priority**: A foundation that cannot be tested invites regressions
from milestone one. Establishing both test runners now gives every later
milestone a place to add tests immediately. It depends on Story 1's code existing
but is independently verifiable.

**Independent Test**: Invoke the backend test command and the frontend test
command separately; both discover and pass at least one test covering the health
behavior.

**Acceptance Scenarios**:

1. **Given** the backend code is present, **When** the developer runs the backend
   test command, **Then** the suite executes and a test asserting the health
   endpoint's success response passes.
2. **Given** the frontend code is present, **When** the developer runs the
   frontend test command, **Then** the suite executes and a test asserting the
   shell renders the backend health status passes.

---

### User Story 3 - Have the expected project skeleton in place (Priority: P3)

A developer inspects the repository and finds the agreed directory structure and
placeholder data directories ready to receive future milestone work.

**Why this priority**: The structure is required by the master design, but it
delivers no runtime value on its own; it is supporting scaffolding for Stories 1
and 2 and for later milestones.

**Independent Test**: Inspect the repository tree and confirm the required
top-level directories and placeholders exist and are preserved by version
control.

**Acceptance Scenarios**:

1. **Given** the repository, **When** a developer lists the project tree, **Then**
   the backend area, frontend area, and the `packages/`, `scenarios/`, and
   `runs/` data directories all exist.
2. **Given** the data directories are empty, **When** the repository is checked
   out fresh, **Then** the empty data directories are still present (preserved via
   placeholder files).

---

### Edge Cases

- **Backend not reachable**: When the frontend requests health but the backend is
  down or unreachable, the shell MUST show a clear non-healthy/error state rather
  than crashing or rendering a blank page.
- **Port already in use**: When a configured host port is occupied on the
  developer's machine, the start command will fail to bind; the project
  documentation MUST tell the developer which ports are used and how to change
  them.
- **Cold start timing**: When the frontend loads before the backend has finished
  starting, the shell shows the error state; reloading the page once the backend
  is ready MUST resolve it to a healthy state. M0 does not auto-retry.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST start the backend service and the frontend shell
  together from a single documented start command.
- **FR-002**: The backend MUST expose a health endpoint that returns a successful
  response containing a status indicator and an identifier of the backend service.
- **FR-003**: The frontend MUST present an application shell that requests the
  backend health status and displays it to the developer.
- **FR-004**: The frontend MUST request backend health once on page load and
  display a clear non-healthy/error state when the request does not succeed. M0
  performs no automatic retry or polling; the developer reloads the page to retry.
- **FR-005**: The system MUST provide a backend test runner that discovers and
  executes backend tests, including a test that verifies the health endpoint's
  successful response.
- **FR-006**: The system MUST provide a frontend test runner that discovers and
  executes frontend tests, including a test that verifies the shell renders the
  backend health status.
- **FR-007**: The repository MUST contain the foundation directory structure: a
  backend application area, a frontend application area, and the `packages/`,
  `scenarios/`, and `runs/` data directories.
- **FR-008**: The empty data directories MUST be preserved under version control
  via placeholder files so a fresh checkout retains them.
- **FR-009**: The project documentation MUST describe how to start the
  application, which host ports it uses, how to change those ports if occupied,
  and how to run each test suite.
- **FR-010**: M0 MUST NOT include any package loading, scenario loading, run
  creation, tick-engine, or algorithm-evaluation logic; the foundation is a
  skeleton only.

### Key Entities

- **Health status**: The information the backend reports about its own
  availability — at minimum a success/ok indicator and a backend-service
  identifier — consumed and displayed by the frontend shell.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer can go from a fresh clone to a running application
  showing backend health using only the single documented start command and no
  additional manual setup steps.
- **SC-002**: When both services are running, the frontend shell displays the
  backend health status on first page load (or after a reload once the backend is
  ready).
- **SC-003**: The backend test suite runs to completion and reports all tests
  passing, including at least one health-endpoint test.
- **SC-004**: The frontend test suite runs to completion and reports all tests
  passing, including at least one test of the health-status display.
- **SC-005**: A fresh checkout of the repository contains all required foundation
  directories and the preserved empty data directories with zero manual creation
  steps.
- **SC-006**: A reviewer following only the project documentation can start the
  app, observe health, and run both test suites without developer assistance.

## Assumptions

- **Stack and topology are fixed by the M0 ADR**
  (`docs/superpowers/specs/2026-06-27-m0-project-foundation-design.md`) and the
  master architecture doc: Python/FastAPI backend, React/TypeScript/Vite
  frontend, Docker Compose runtime, pytest and Vitest test runners. This spec
  states the *capabilities*; the ADR/plan owns the *technology choices*.
- **Single-user, local-only**: M0 targets one developer on one machine. No
  accounts, no remote deployment, no concurrency requirements.
- **Host ports**: 8137 (backend) and 5180 (frontend) are the chosen defaults per
  the ADR, verified free in the reference workspace; documentation covers changing
  them if occupied elsewhere.
- **Frontend↔backend transport in development** uses a dev-server proxy so the
  frontend addresses the backend via a relative path, avoiding cross-origin
  configuration (per ADR decision D7).
- **Minimal/YAGNI scaffold**: only files required by M0 acceptance are created;
  component/service/algorithm files from the full architecture tree arrive in
  their own later milestones.
- **No prototype migration** is required in M0; the reference prototype under
  `others/` is not a dependency.
