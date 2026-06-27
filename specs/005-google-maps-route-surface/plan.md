# Implementation Plan: M4 Google Maps Route Surface

**Branch**: `005-google-maps-route-surface` | **Date**: 2026-06-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-google-maps-route-surface/spec.md`

**Companion ADR**: [docs/superpowers/specs/2026-06-27-m4-google-maps-route-surface-design.md](../../docs/superpowers/specs/2026-06-27-m4-google-maps-route-surface-design.md)

## Summary

Make Google Maps the default route surface when a reviewer supplies a BYO key, keeping
the existing deterministic local route as fallback. The backend derives bounded route
facts server-side (stdlib `urllib`) from Google **Directions** (route + ≤3 alternatives)
and **Places** (context-typed rest POIs), with the key passed per analyze request and
**discarded** (never persisted/logged/exported). `POST /api/routes/analyze` returns
`alternatives[{route_id, RouteFacts, display geometry}]` + `route_source`; the chosen
`route_id` flows to `POST /api/run-plans`. The browser renders an interactive Google Map
(key in memory only, runtime script injection) with car/progress/decision markers driven
by the tick's `route_fraction`. Google raw numerics are normalized into **frozen,
simulator-owned `RouteFacts`**; the tick engine then derives numeric `raw_state` +
ordinal `feature_groups` exactly as in M2 (Google replaces the local fixture as the
*source*). Maps/Places are called once at analyze, frozen at run start; replay never
re-fetches. Rest-stop edge handling: lookup-empty → honest empty list →
`NO_PRACTICAL_ACTION_FALLBACK`; lookup-failure → scenario local rest pattern + degraded
notice. No new dependencies.

## Technical Context

**Language/Version**: Python 3.12 (backend, uv, pinned deps); TypeScript 5 / Node 18 host
(frontend, Vite 5).

**Primary Dependencies**: FastAPI, Pydantic v2, uvicorn (backend) + **stdlib
`urllib.request`** for the Google calls; React 18, Vite 5 (frontend) + the Google Maps
**JS API loaded via runtime script injection** (no npm dep). **No new dependencies.**

**Storage**: File-based JSON — `packages/`, `scenarios/`, `runs/`. Run evidence gains
`route_source` + a minimal display route snapshot; **never the key**.

**Testing**: pytest + httpx (backend, test-only); Vitest + Testing Library (frontend).
**All Maps interactions mocked with recorded JSON — no live network in any test.**

**Target Platform**: Local single-developer Docker Compose; browser :5180, api :8137.

**Project Type**: Web application — `app/api` + `app/frontend`.

**Performance Goals**: None beyond a responsive local loop; determinism is the hard
requirement.

**Constraints**: Key is a transient secret (never persisted/logged/exported, request-
scoped + browser-memory only); two-layer numeric boundary (Google-raw → frozen
simulator `RouteFacts` → numeric `raw_state` + ordinal `feature_groups`; no external raw
value to a trigger); call-once-at-analyze + freeze + replay-never-refetch (determinism);
deterministic local fallback preserved; ≤3 alternatives; V1 segment classification =
highway + normal_road; no new deps; the tick/decision/evidence pipeline below analyze is
unchanged.

**Scale/Scope**: One reviewer, one key at a time; UC-01 packages; single user.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|-----------|--------|----------|
| I. Backend Is The Source Of Truth | ✅ Pass | Bounded route facts derived + frozen server-side; frontend renders. |
| II. Evidence Append-Only / Failures Never Hidden | ✅ Pass | Honest Maps failure (error+retry+local fallback, never start without facts); no rest stops → honest empty + NO_PRACTICAL_ACTION_FALLBACK (no fabrication); rest-lookup failure → scenario fallback + visible degraded notice; key never in evidence. |
| III. Deterministic, Replayable | ✅ Pass | Maps/Places called once at analyze; facts frozen at run start; ticking + replay never re-fetch; live values captured as frozen snapshot. |
| IV. Qualitative Trigger Discipline | ✅ Pass | Google raw numerics normalized into frozen simulator `RouteFacts`; tick engine derives numeric `raw_state` + ordinal `feature_groups` (M2 pipeline); **no external-service raw value reaches a trigger**. |
| V. One Generic Algorithm Adapter Contract | ✅ Pass | M4 is entirely upstream of the adapter; the adapter + decision/evidence contract are unchanged. |
| VI. Local-First Simplicity (YAGNI) | ✅ Pass | stdlib urllib + script-injection loader; local fallback preserved; no DB/cloud; no new deps; ≤3 alternatives; no route editing/saved routes/offline tiles. |
| Security & Safety Boundaries | ✅ Pass | BYO key is the sensitive value: transient in two places (browser memory, per-request analyze field), persisted in neither, never logged/exported; guard-tested. |
| Dev Workflow & Quality Gates | ✅ Pass | Spec-driven; contract surfaces (maps_client, analyze alternatives, key-safety, boundary, determinism, fallback) tested first (TDD) against mocked Maps. |

**Result: PASS — no violations.** Complexity Tracking empty.

**Post-design re-check (after Phase 1):** PASS — research.md, data-model.md, contracts/,
quickstart.md add no DB/cloud, no new deps; keep the route-analyzer + append-only
recorder as boundaries; the two-layer numeric boundary + freeze strengthen principles
III/IV; the BYO key never enters any persisted artifact. No new violations.

## Project Structure

### Documentation (this feature)
```text
specs/005-google-maps-route-surface/
├── plan.md  research.md  data-model.md  quickstart.md
├── contracts/
│   ├── maps-client.md            # stdlib-urllib Directions+Places contract + recorded fixtures
│   └── analyze-and-run-plans.md  # analyze→alternatives, route_id→run-plans, route_source, snapshot
├── checklists/requirements.md
└── tasks.md                      # /speckit-tasks
```

### Source Code (repository root)
```text
app/api/aica_api/
├── services/
│   ├── maps_client.py        # NEW: stdlib-urllib Directions + Places; the ONLY key user; mockable
│   ├── route_analysis.py     # EXTEND: maps path → per-alternative RouteFacts; segment classify;
│   │                         #   context-typed rest spots; empty-vs-failure rest handling
│   └── run_plan.py           # EXTEND: build draft from the selected route_id's frozen facts;
│                             #   persist route_source + display snapshot (never key)
├── routers/
│   ├── routes.py             # EXTEND: optional maps_key/start/end → alternatives[{route_id,
│   │                         #   RouteFacts, display geometry}] + route_source; key request-scoped
│   └── run_plans.py          # EXTEND: accept route_id; build from the selected alternative
├── models/
│   └── run.py                # EXTEND: RouteFacts.route_source; DisplayRoute snapshot model;
│                             #   RunState/RunLog carry route_source + display snapshot; NO key field
└── tests/
    ├── test_maps_client.py           # mocked Directions+Places; no live network
    ├── test_route_analysis_maps.py   # per-alternative facts; segment classify; rest empty-vs-failure
    ├── test_key_safety.py            # key absent from every run log / response / draft
    ├── test_route_boundary.py        # Google-raw → frozen facts → numeric raw_state + ordinal fg
    ├── test_routes_router.py         # analyze alternatives + route_source; run-plans route_id
    └── test_api_run_loop.py          # UPDATE: mocked-maps e2e analyze→plan→run→proposal→log

app/frontend/src/
├── api/types.ts              # alternatives, route_source, display snapshot, key (in-memory) types
├── state/runStore.ts         # in-memory mapsKey, start/end, alternatives, selected route_id
├── components/map/MapSurface.tsx       # NEW: Maps JS loader (script injection) + markers + picker
└── components/setup/MapKeyAndRouteInput.tsx  # NEW: BYO key + start/end entry (in-memory)
```

**Structure Decision**: extends the M1–M3 tree; the route-analysis layer gains a Maps
*source* beside the local fixture; everything below analyze (tick engine, adapter,
decision, evidence/replay) is unchanged. The BYO key is request-scoped/browser-memory and
appears in **no** persisted model.

## Complexity Tracking

> No constitution violations. Table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
