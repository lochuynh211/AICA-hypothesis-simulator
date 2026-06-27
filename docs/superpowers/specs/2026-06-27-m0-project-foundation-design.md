# ADR / Design — M0 Project Foundation

**Date:** 2026-06-27
**Milestone:** M0 — Project Foundation
**Status:** Accepted (pending implementation)
**Source docs:** `docs/master/aica_hypothesis_simulator_milestones.md` §2,
`docs/master/aica_hypothesis_simulator_architecture.md` §5

---

## 1. Context

The AICA Hypothesis Simulator has authoritative master design docs but no
application code yet. M0 establishes the implementation foundation — the
container topology, backend/frontend skeletons, a health round-trip, and test
runners on both sides — **without** pretending the simulator is usable. No
package, scenario, or evaluation logic is in scope for M0.

This ADR records the decisions that are hard to reverse later (toolchain,
container topology, ports, frontend↔backend transport) and the concrete
minimal scaffold that satisfies every M0 acceptance criterion.

## 2. Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Python toolchain (backend) | **uv** | Fast resolver/installer, PEP 621 `pyproject.toml`, lockfile, clean in Docker. |
| D2 | Node package manager (frontend) | **npm** | Ships with Node, zero extra image setup, simplest for a single-app frontend. |
| D3 | Compose mode for M0 | **Dev hot-reload** | `uvicorn --reload` + Vite dev server, source bind-mounted. Fast inner loop for a skeleton under active iteration. |
| D4 | Scaffold scope | **Minimal / YAGNI** | Only files M0 acceptance needs. Component/service/algorithm files arrive in their milestones, not as rotting empty stubs. |
| D5 | Backend host port | **8137** | 8000 is occupied locally; 8137 verified free. |
| D6 | Frontend host port | **5180** | 5173/5174/5175 occupied locally; 5180 verified free. |
| D7 | Frontend↔backend transport (dev) | **Vite dev-server proxy** | `vite.config.ts` proxies `/api/*` → `http://api:8137`. Frontend calls relative `/api/health` — no CORS config, no hardcoded host, no `VITE_API_URL` juggling for a local-only tool. |

### Stack (fixed by architecture doc §5, not re-litigated here)

- **Backend:** Python + FastAPI + Pydantic. `pyproject.toml`. Tests: pytest.
- **Frontend:** React + TypeScript + Vite. `package.json`, `vite.config.ts`.
  Tests: Vitest.
- **Runtime:** Docker Compose.

## 3. Architecture & dev topology

Two containers started by `docker compose up`:

| Service | Container command | Host port | Purpose |
|---------|-------------------|-----------|---------|
| `api` | `uvicorn aica_api.main:app --reload --host 0.0.0.0 --port 8137` | 8137 | FastAPI app; exposes `GET /api/health`. |
| `frontend` | `vite` (dev server) | 5180 | App shell; fetches `/api/health` and renders status. |

The user opens **`http://localhost:5180`**. The Vite dev server proxies
`/api/*` to `http://api:8137` over the compose network, so `:8137` need not be
opened directly (though it is published for `curl`/test convenience).

Health response shape:

```json
{ "status": "ok", "service": "aica-api", "version": "0.0.0" }
```

## 4. File layout (M0)

```
app/
  api/
    pyproject.toml              # uv-managed, PEP 621; deps: fastapi, uvicorn[standard]; dev: pytest, httpx
    aica_api/
      __init__.py
      main.py                   # FastAPI app + GET /api/health
    tests/
      test_health.py            # /api/health -> 200 {"status":"ok","service":"aica-api","version":"0.0.0"}
  frontend/
    package.json                # react, react-dom; dev: vite, typescript, vitest, @testing-library/react, jsdom
    vite.config.ts              # server.port 5180, proxy /api -> http://api:8137
    tsconfig.json
    index.html
    src/
      main.tsx
      App.tsx                   # shell: fetches health via client, renders status
      api/client.ts             # getHealth() -> fetch('/api/health')
    tests/
      App.test.tsx              # mocks fetch, asserts health status renders

packages/        .gitkeep       # empty registry dir, populated in M1+
scenarios/       .gitkeep       # empty registry dir, populated in M1+
runs/            .gitkeep       # append-only evidence dir, populated at runtime

docker-compose.yml              # services: api (:8137), frontend (:5180)
Dockerfile.api                  # python base + uv
Dockerfile.frontend             # node base + npm
docs/superpowers/specs/         # this ADR
README.md                       # updated: docker compose up, ports, test commands
```

Design notes:

- **`src/api/client.ts`** is the single seam the frontend uses to reach the
  backend. It keeps `App.tsx` free of fetch details and makes the component
  test trivial to mock. This is the one structural boundary worth having on
  day one.
- `packages/` and `scenarios/` get `.gitkeep` (the architecture mandates it
  only for `runs/`, but empty dirs do not survive git and M1 expects all
  three to exist).
- No component/service/algorithm files are created in M0 — they would be
  empty stubs that rot before their milestone.

## 5. Testing & acceptance mapping

**Backend** (pytest + httpx via FastAPI `TestClient`): assert `GET /api/health`
returns `200` and the expected JSON. Run: `cd app/api && uv run pytest`.

**Frontend** (Vitest + Testing Library + jsdom): render `<App>` with `fetch`
mocked to the health payload, assert the status text renders; unit-test that
`getHealth()` requests `/api/health`. Run: `cd app/frontend && npm test`.

| M0 acceptance criterion | Proof in M0 |
|---|---|
| `docker compose up` starts backend + frontend | `docker-compose.yml` with `api` + `frontend` services |
| Browser opens a simple app shell | `App.tsx` served by Vite on :5180 |
| Frontend shows backend health status | `App` fetches `/api/health` via proxy, renders status |
| Backend tests run | `test_health.py` via `uv run pytest` |
| Frontend tests run | `App.test.tsx` via `npm test` (vitest) |
| `.gitkeep` for `runs/` | present (+ `packages/`, `scenarios/`) |
| No package/scenario/eval logic required | none added — pure skeleton |

## 6. Implementation approach (Phase 3 — TDD)

Tests first, then code to green:

1. **Red:** `test_health.py` asserting the health contract → **Green:**
   `main.py` implements `GET /api/health`.
2. **Red:** `App.test.tsx` asserting health status renders (fetch mocked) →
   **Green:** `App.tsx` + `client.ts`.
3. **Infra** (Dockerfiles, compose, pyproject, package.json) is verified by
   actually running `docker compose up` and curling `:8137/api/health` — not
   by unit tests.

## 7. Scope boundary

In scope: directory structure, Docker Compose, FastAPI skeleton, React/Vite
shell, health endpoint + round-trip, one test each side, `.gitkeep`s, README.

Out of scope (later milestones): package/scenario registries, run manager,
evidence recorder, algorithm adapters, any UI panel beyond the health shell,
Pydantic domain models, the tick engine, Google Maps surface.

## 8. Consequences

- A reviewer can `docker compose up`, open `:5180`, and see a live
  backend-health round-trip — the foundation is demonstrably runnable.
- Both test runners exist and pass, so every later milestone has a place to
  add tests from day one.
- Choosing the Vite proxy means there is no CORS config to carry; if a future
  milestone serves the frontend as static assets from FastAPI (architecture
  §allows it), the proxy is dev-only and drops away cleanly.
- Minimal scaffold means later milestones create their own files; this ADR
  deliberately does not pre-create the full architecture tree.
```
