# Phase 1 Data Model: M0 Project Foundation

M0 has no domain/persistence model — no packages, scenarios, runs, or evidence.
The only data structure is the **health status** payload exchanged over the
health round-trip. Richer domain models (manifests, scenarios, run state,
decision results, trace entries, feedback) arrive in M2+ per the architecture.

## Entity: HealthStatus

The information the backend reports about its own availability, consumed and
displayed by the frontend shell.

| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|---------|
| `status` | string | yes | Liveness indicator. Fixed literal `"ok"` when the service is up. | `"ok"` |
| `service` | string | yes | Identifier of the backend service (FR-002). | `"aica-api"` |
| `version` | string | yes | Service version; pre-release placeholder in M0. | `"0.0.0"` |

### Rules & notes

- **Producer**: backend `GET /api/health` (the single source of truth — constitution I).
- **Consumer**: frontend `getHealth()` → `App` shell renders the status.
- **Healthy interpretation**: the frontend treats an HTTP `200` whose `status ===
  "ok"` as healthy; anything else (non-200, network failure, missing/!=`ok`
  status) renders the error state (FR-004).
- **No persistence**: HealthStatus is not written to `runs/` or anywhere else; it
  is a transient liveness signal. (Constitution II is not engaged in M0.)
- **No state transitions**: a single fetch on page load; no lifecycle, no polling
  (clarified 2026-06-27 — fetch once, manual reload to retry).

## Placeholder data directories (no schema in M0)

| Directory | M0 contents | Future owner |
|-----------|-------------|--------------|
| `packages/` | `.gitkeep` only | Package registry (M1+) |
| `scenarios/` | `.gitkeep` only | Scenario registry (M1+) |
| `runs/` | `.gitkeep` only | Append-only evidence recorder (runtime, M1+) |

These exist solely so the structure is in place and version-controlled; M0 writes
no files into them.
