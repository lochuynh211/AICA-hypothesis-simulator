---
description: "Task list for M0 Project Foundation"
---

# Tasks: M0 Project Foundation

**Input**: Design documents from `/specs/001-m0-project-foundation/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/health.md, quickstart.md

**Tests**: INCLUDED. Phase 3 of this project's milestone cycle is TDD, and the
constitution requires contract-surface tests (the health endpoint). Test tasks
are written FIRST and MUST FAIL before their implementation task.

**Organization**: Tasks grouped by user story (US1 P1, US2 P2, US3 P3) for
independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 / US2 / US3 (setup, foundational, polish have no story label)
- Exact file paths included.

## Path Conventions

Web app per plan.md: backend at `app/api/`, frontend at `app/frontend/`, Compose
and data directories at repository root.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Repository structure and per-side project skeletons that every story builds on. No app logic yet.

- [ ] T001 Create repository directory structure (`app/api/aica_api/`, `app/api/tests/`, `app/frontend/src/api/`, `app/frontend/tests/`, `packages/`, `scenarios/`, `runs/`) and add `.gitkeep` to `packages/`, `scenarios/`, and `runs/`
- [ ] T002 [P] Initialize backend project: `app/api/pyproject.toml` (PEP 621, uv-managed; runtime deps `fastapi`, `uvicorn[standard]`; dev deps `pytest`, `httpx`; configure pytest testpaths=`tests`) and empty `app/api/aica_api/__init__.py`
- [ ] T003 [P] Initialize frontend project: `app/frontend/package.json` (deps `react`, `react-dom`; dev `vite`, `typescript`, `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`; `"test": "vitest run"` script), `app/frontend/tsconfig.json`, `app/frontend/index.html`, and `app/frontend/vite.config.ts` (`server.port` 5180, `server.host` true, proxy `/api` → `http://api:8137`, Vitest `environment: 'jsdom'`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The containerized dev environment that the single-command start (US1) runs through.

**⚠️ CRITICAL**: US1's "start with one command" acceptance depends on this phase.

- [ ] T004 [P] Create `Dockerfile.api` (`python:3.12-slim`, install `uv`, install backend deps from `app/api/pyproject.toml`, run `uvicorn aica_api.main:app --reload --host 0.0.0.0 --port 8137`)
- [ ] T005 [P] Create `Dockerfile.frontend` (`node:22`, `npm install` from `app/frontend/package.json`, run Vite dev server `--host` on port 5180)
- [ ] T006 Create `docker-compose.yml` at repo root: service `api` (build `Dockerfile.api`, publish `8137:8137`, bind-mount `./app/api`, keep container `.venv`), service `frontend` (build `Dockerfile.frontend`, publish `5180:5180`, bind-mount `./app/frontend`, keep container `node_modules`, depends_on `api`)

**Checkpoint**: `docker compose up` builds and starts both services (endpoints/shell still to come in US1).

---

## Phase 3: User Story 1 - Start the application and see it is alive (Priority: P1) 🎯 MVP

**Goal**: A developer starts the app with one command, opens `http://localhost:5180`, and the shell shows the backend health status fetched from the backend.

**Independent Test**: `docker compose up`, open `:5180`, see a healthy status sourced from the backend (`curl :8137/api/health` returns the contract body).

### Tests for User Story 1 (write FIRST, ensure they FAIL) ⚠️

- [ ] T007 [P] [US1] Backend contract test in `app/api/tests/test_health.py`: `GET /api/health` returns 200 and JSON `{"status":"ok","service":"aica-api","version":"0.0.0"}` (FastAPI `TestClient`). MUST FAIL before T009.
- [ ] T008 [P] [US1] Frontend test in `app/frontend/tests/App.test.tsx`: with `fetch` mocked to the success body, `<App>` renders a healthy status naming the backend service; with `fetch` rejecting / non-200, `<App>` renders the error state. MUST FAIL before T010/T011.

### Implementation for User Story 1

- [ ] T009 [US1] Implement `app/api/aica_api/main.py`: FastAPI app exposing `GET /api/health` returning the contract body (makes T007 pass)
- [ ] T010 [P] [US1] Implement `app/frontend/src/api/client.ts`: `getHealth()` calling `fetch('/api/health')`, returning the parsed HealthStatus or throwing on non-ok
- [ ] T011 [US1] Implement `app/frontend/src/App.tsx` (fetch health once on mount via `getHealth()`, render healthy status or error state; no retry/polling) and `app/frontend/src/main.tsx` (mount `<App>`) — makes T008 pass (depends on T010)
- [ ] T012 [US1] Manual end-to-end verification: `docker compose up`, open `http://localhost:5180` (shell shows backend health), and `curl http://localhost:8137/api/health` matches the contract

**Checkpoint**: US1 fully functional — the health round-trip works end-to-end. This is the MVP.

---

## Phase 4: User Story 2 - Run the automated tests on both sides (Priority: P2)

**Goal**: Both test suites are discoverable and pass, including the health-round-trip coverage authored in US1.

**Independent Test**: Run each test command; both discover tests and report all passing.

- [ ] T013 [US2] Verify backend test runner: `cd app/api && uv run pytest` discovers `tests/test_health.py` and passes; fix `pyproject.toml` pytest config if discovery fails
- [ ] T014 [US2] Verify frontend test runner: `cd app/frontend && npm test` runs Vitest, discovers `tests/App.test.tsx` and passes; fix `vite.config.ts` / test setup (jsdom, jest-dom matchers) if discovery fails

**Checkpoint**: Both runners green — the project is testable from milestone one.

---

## Phase 5: User Story 3 - Have the expected project skeleton in place (Priority: P3)

**Goal**: The agreed directory structure and preserved empty data directories exist.

**Independent Test**: Inspect the tree; confirm required dirs and that empty data dirs survive a fresh checkout.

- [ ] T015 [US3] Verify foundation tree and placeholders: `app/api`, `app/frontend`, and `packages/`, `scenarios/`, `runs/` exist with `.gitkeep` so a fresh `git checkout` retains the empty data directories (confirm via `git ls-files packages scenarios runs`)

**Checkpoint**: Repository skeleton complete and version-controlled.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation and environment hygiene spanning the stories.

- [ ] T016 [P] Update `.gitignore` to ignore frontend build/dependency artifacts (`node_modules/`, `dist/`) in addition to the existing Python entries
- [ ] T017 [P] Write `README.md`: single start command (`docker compose up`), host ports 8137/5180 and how to change them if occupied, and the two test commands (FR-009)
- [ ] T018 Run `quickstart.md` validation end-to-end (start, observe health at `:5180`, run both test suites green)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup (needs `pyproject.toml` / `package.json`). Blocks US1's start-command path.
- **US1 (Phase 3)**: Depends on Setup + Foundational.
- **US2 (Phase 4)**: Depends on US1 (its tests are the suites US2 runs).
- **US3 (Phase 5)**: Depends on Setup only — can run any time after Phase 1.
- **Polish (Phase 6)**: After US1–US3 (README/quickstart describe the working system).

### Within User Story 1

- Tests (T007, T008) written and FAILING before implementation (T009–T011).
- `client.ts` (T010) before `App.tsx` (T011). Backend (T009) and frontend (T010) are independent.
- End-to-end verify (T012) last.

### Parallel Opportunities

- T002 and T003 (different project trees) run in parallel after T001.
- T004 and T005 (separate Dockerfiles) run in parallel.
- T007 and T008 (backend vs frontend test files) run in parallel.
- T010 is [P] vs the backend T009 (different sides).
- T016 and T017 run in parallel.
- US3 (T015) can proceed in parallel with US1/US2 once Setup is done.

---

## Parallel Example: User Story 1

```bash
# Write both failing tests together (different files, different stacks):
Task: "Backend contract test in app/api/tests/test_health.py"
Task: "Frontend test in app/frontend/tests/App.test.tsx"

# Then implement backend and frontend client in parallel:
Task: "Implement app/api/aica_api/main.py (GET /api/health)"
Task: "Implement app/frontend/src/api/client.ts (getHealth)"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup → 2. Phase 2 Foundational → 3. Phase 3 US1 (TDD: red → green).
4. **STOP and VALIDATE**: health round-trip works end-to-end (T012).
5. This is a demoable MVP of M0.

### Incremental Delivery

1. Setup + Foundational → environment boots.
2. US1 → health round-trip (MVP). 3. US2 → both test runners green.
4. US3 → skeleton verified. 5. Polish → README + quickstart validation.

---

## Notes

- [P] = different files, no incomplete dependencies.
- TDD: T007/T008 MUST fail before T009–T011 make them pass.
- Commit after each task or logical group.
- M0 stories are a single tight vertical slice; US2 intentionally depends on US1's
  tests (the runners have nothing to run until US1 authors them).
- Total: 18 tasks (T001–T018).
