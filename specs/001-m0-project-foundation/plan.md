# Implementation Plan: M0 Project Foundation

**Branch**: `001-m0-project-foundation` | **Date**: 2026-06-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-m0-project-foundation/spec.md`

**Companion ADR**: [docs/superpowers/specs/2026-06-27-m0-project-foundation-design.md](../../docs/superpowers/specs/2026-06-27-m0-project-foundation-design.md)

## Summary

Establish the runnable, testable foundation of the AICA Hypothesis Simulator:
the agreed directory structure, a Docker Compose dev environment that starts a
FastAPI backend and a React/Vite frontend, a backend `GET /api/health` endpoint,
a frontend shell that fetches and displays that health once on load, and a test
runner on each side covering the health round-trip. No package, scenario, run, or
algorithm logic — skeleton only. Technical choices are fixed by the companion ADR
(uv + npm, dev hot-reload Compose, ports 8137/5180, Vite dev-server proxy,
minimal/YAGNI scaffold).

## Technical Context

**Language/Version**: Python 3.12 (backend); TypeScript 5.x on Node.js 22 LTS (frontend)

**Primary Dependencies**: Backend — FastAPI, uvicorn[standard], managed by uv (PEP 621 `pyproject.toml`). Frontend — React 18, react-dom, Vite 5, managed by npm.

**Storage**: Files only. `packages/`, `scenarios/`, `runs/` directories created as empty placeholders (`.gitkeep`); no reads/writes in M0.

**Testing**: pytest + httpx (FastAPI `TestClient`) for backend; Vitest + Testing Library + jsdom for frontend.

**Target Platform**: Local single-developer machine via Docker Compose (Linux containers); browser at `http://localhost:5180`.

**Project Type**: Web application — separate backend (`app/api`) and frontend (`app/frontend`) services.

**Performance Goals**: None for M0 beyond a responsive local dev loop (hot-reload on both services). No latency/throughput targets — this is a skeleton.

**Constraints**: Local-only, offline-capable (no external services in M0). Host ports 8137 (api) and 5180 (frontend), documented as changeable. Frontend reaches backend via relative `/api/*` through the Vite dev-server proxy (no CORS config).

**Scale/Scope**: One developer, one machine, one health endpoint, one frontend shell, one test each side. Minimal/YAGNI scaffold — no architecture-tree files beyond what M0 acceptance needs.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against constitution v1.0.0. M0 is a pre-behavioral skeleton, so most
runtime principles are not yet exercised; none are violated.

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Backend Is The Source Of Truth | ✅ Pass | The only datum (health) originates in the backend; the frontend merely displays it. No decision/evidence logic in the view layer. |
| II. Evidence Is Append-Only / Failures Never Hidden | ✅ Pass (N/A) | No runs or evidence in M0. `runs/` placeholder is created for later milestones; nothing is persisted or hidden. |
| III. Deterministic, Replayable Simulation | ✅ Pass (N/A) | No tick engine or replay in M0. |
| IV. Qualitative Trigger Discipline | ✅ Pass (N/A) | No triggers or route quantities in M0. |
| V. One Generic Algorithm Adapter Contract | ✅ Pass (N/A) | No algorithms in M0; FR-010 forbids evaluation logic. |
| VI. Local-First Simplicity (YAGNI) | ✅ Pass (reinforced) | Smallest runnable vertical slice; file-based dirs; no DB/accounts/cloud/queues. Minimal scaffold by explicit decision. |
| Security & Safety Boundaries | ✅ Pass | No external keys exist in M0 (BYO-key N/A); Python is local trusted code in-container; nothing persisted to leak. |
| Dev Workflow & Quality Gates | ✅ Pass | Built via the Spec Kit cycle. The health endpoint is M0's only contract surface and is covered by a contract test (TDD, red→green). Milestone stays runnable + testable. |

**Result: PASS — no violations.** Complexity Tracking table intentionally empty.

**Post-design re-check (after Phase 1):** PASS — research.md, data-model.md
(single transient HealthStatus, no persistence), contracts/health.md, and
quickstart.md introduce no algorithms, evidence, persistence, or external
services. The one contract surface (health endpoint) is covered by required
contract tests. No new violations.

## Project Structure

### Documentation (this feature)

```text
specs/001-m0-project-foundation/
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── health.md        # GET /api/health contract
├── checklists/
│   └── requirements.md  # spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

M0 creates only the files its acceptance needs. Later milestones add the rest of
the architecture tree in their own slices.

```text
app/
├── api/                          # FastAPI backend service
│   ├── pyproject.toml            # uv-managed; fastapi, uvicorn[standard]; dev: pytest, httpx
│   ├── aica_api/
│   │   ├── __init__.py
│   │   └── main.py               # FastAPI app + GET /api/health
│   └── tests/
│       └── test_health.py        # contract test for /api/health
└── frontend/                     # React + TS + Vite frontend
    ├── package.json              # react, react-dom; dev: vite, typescript, vitest, @testing-library/react, jsdom
    ├── vite.config.ts            # server.port 5180, proxy /api -> http://api:8137
    ├── tsconfig.json
    ├── index.html
    ├── src/
    │   ├── main.tsx
    │   ├── App.tsx               # shell: fetch health on load, render status / error
    │   └── api/client.ts         # getHealth() -> fetch('/api/health')
    └── tests/
        └── App.test.tsx          # renders health status (fetch mocked); error-state case

packages/   .gitkeep              # empty registry dir (M1+)
scenarios/  .gitkeep              # empty registry dir (M1+)
runs/       .gitkeep              # append-only evidence dir (runtime)

docker-compose.yml                # services: api (:8137), frontend (:5180), source bind-mounted
Dockerfile.api                    # python:3.12-slim + uv
Dockerfile.frontend               # node:22 + npm
README.md                         # start command, ports + how to change, test commands
```

**Structure Decision**: Web application with two services under `app/` (`app/api`,
`app/frontend`), matching `docs/master/aica_hypothesis_simulator_architecture.md` §5.
The Compose root holds `docker-compose.yml` and the two Dockerfiles. Data
directories (`packages/`, `scenarios/`, `runs/`) sit at repository root per the
architecture, preserved via `.gitkeep`.

## Complexity Tracking

> No constitution violations. Table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
