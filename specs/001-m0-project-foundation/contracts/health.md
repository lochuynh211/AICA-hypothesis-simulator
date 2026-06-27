# Contract: `GET /api/health`

M0's single external interface. This is the contract surface the constitution
requires to be tested first (Dev Workflow & Quality Gates).

## Request

```
GET /api/health
```

- No authentication (local-only tool).
- No request body, no query parameters, no required headers.
- Reached by the frontend as the relative path `/api/health`, proxied by the Vite
  dev server to `http://api:8137/api/health` (ADR D7).

## Success response

- **Status**: `200 OK`
- **Content-Type**: `application/json`
- **Body**:

```json
{
  "status": "ok",
  "service": "aica-api",
  "version": "0.0.0"
}
```

| Field | Type | Constraint |
|-------|------|------------|
| `status` | string | MUST equal `"ok"` when the service is up |
| `service` | string | MUST equal `"aica-api"` (backend identifier) |
| `version` | string | semver-ish string; `"0.0.0"` in M0 |

## Failure modes (observed by the client, not produced by this endpoint)

These are not error responses from the endpoint but conditions the **frontend**
must handle (FR-004), since the backend may be down or starting:

| Condition | What the frontend sees | Frontend behavior |
|-----------|------------------------|-------------------|
| Backend not started / unreachable | network error / fetch rejection | render error state |
| Backend up but returns non-200 | non-200 status | render error state |
| 200 but `status !== "ok"` | unexpected body | render error state |

The frontend does **not** auto-retry; the developer reloads the page once the
backend is ready (clarified 2026-06-27).

## Contract tests (required)

**Backend** (`app/api/tests/test_health.py`, pytest + `TestClient`):

1. `GET /api/health` returns `200`.
2. Response JSON equals `{"status":"ok","service":"aica-api","version":"0.0.0"}`
   (or at minimum: `status == "ok"` and `service == "aica-api"` and `version`
   present).

**Frontend** (`app/frontend/tests/App.test.tsx`, Vitest + Testing Library):

1. With `fetch` mocked to resolve the success body, `<App>` renders a healthy
   status indicating the backend service.
2. With `fetch` mocked to reject (or resolve non-200), `<App>` renders the error
   state.
