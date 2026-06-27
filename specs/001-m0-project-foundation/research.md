# Phase 0 Research: M0 Project Foundation

The contentious decisions were already resolved in the companion ADR
(`docs/superpowers/specs/2026-06-27-m0-project-foundation-design.md`, decisions
D1–D7). This file records the few remaining concrete choices the plan needed to
pin (language/runtime versions, base images, exact health contract) so there are
no `NEEDS CLARIFICATION` items left for Phase 1.

## R1 — Backend Python version & base image

- **Decision**: Python **3.12**, container base `python:3.12-slim`, dependencies
  via **uv** with a PEP 621 `pyproject.toml`.
- **Rationale**: 3.12 is a stable, widely-supported release with no compatibility
  concerns for FastAPI/uvicorn; `-slim` keeps the image small. uv (ADR D1) gives
  fast installs and a lockfile, and is installed into the image in one step.
- **Alternatives considered**: 3.11 (older, no benefit here); 3.13 (newer, minor
  ecosystem-lag risk for a foundation we want boring). pip/poetry rejected in ADR D1.

## R2 — Frontend Node version & base image

- **Decision**: Node.js **22 LTS**, container base `node:22`, dependencies via
  **npm**; React 18 + Vite 5 + TypeScript 5.
- **Rationale**: Node 22 is an active LTS line — safe and long-supported. Vite 5 +
  React 18 + Vitest is a mature, well-documented combination. npm (ADR D2) needs
  no extra image tooling.
- **Alternatives considered**: Node 20 LTS (also fine, slightly older); pnpm
  rejected in ADR D2 to avoid an extra image dependency.

## R3 — Health endpoint contract

- **Decision**: `GET /api/health` → `200` with JSON
  `{ "status": "ok", "service": "aica-api", "version": "0.0.0" }`.
- **Rationale**: Minimal liveness signal. `status` is the boolean-ish health flag
  the frontend keys on; `service` identifies the backend (satisfies FR-002's
  "identifier of the backend service"); `version` is a forward-looking field set
  to the pre-release `0.0.0`. No dependency/readiness checks — M0 has no
  dependencies (constitution principle VI, YAGNI).
- **Alternatives considered**: A bare `{"status":"ok"}` (rejected — FR-002 wants a
  service identifier); a richer readiness/dependency payload (rejected — no
  dependencies exist in M0; would be speculative).

## R4 — Frontend↔backend transport in dev

- **Decision** (from ADR D7, recorded here for completeness): Vite dev-server
  proxy — `vite.config.ts` proxies `/api/*` → `http://api:8137`. Frontend code
  calls the relative path `/api/health`.
- **Rationale**: No CORS configuration, no hardcoded backend host, no
  `VITE_API_URL` env juggling for a local-only tool. `api` resolves over the
  Compose network.
- **Alternatives considered**: CORS + explicit base URL (more moving parts);
  backend-serves-static (a later-milestone option, too heavy for the dev loop).

## R5 — Compose topology & hot reload

- **Decision**: Two services. `api` runs
  `uvicorn aica_api.main:app --reload --host 0.0.0.0 --port 8137`; `frontend` runs
  the Vite dev server on `5180` with `--host` so it is reachable from the host.
  Source is bind-mounted into both for live reload; dependency artifacts
  (`.venv`, `node_modules`) stay inside the container (not shadowed by the mount).
- **Rationale**: Fast inner loop for a skeleton under active iteration (ADR D3).
- **Alternatives considered**: Prod-style build (slow rebuilds, rejected in ADR D3
  for the M0 dev phase).

## R6 — Testing approach

- **Decision**: Backend — pytest with FastAPI `TestClient` (httpx) asserting the
  R3 contract. Frontend — Vitest + Testing Library + jsdom rendering `<App>` with
  `fetch` mocked, asserting both the healthy-status render and the error-state
  render (per the clarified fetch-once/no-retry behavior).
- **Rationale**: These are the standard, lightest-weight runners for each stack
  and directly exercise M0's single contract surface (the health round-trip),
  satisfying the constitution's "contract surfaces are tested first" gate.
- **Alternatives considered**: Full browser E2E (Playwright) — out of scope for a
  skeleton; deferred until there is real UI flow to drive.

## Outcome

All Technical Context items are concrete. **No `NEEDS CLARIFICATION` remain.**
