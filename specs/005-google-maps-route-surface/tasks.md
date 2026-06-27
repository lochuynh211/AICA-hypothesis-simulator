---
description: "Task list for M4 Google Maps Route Surface"
---

# Tasks: M4 Google Maps Route Surface

**Input**: Design documents from `/specs/005-google-maps-route-surface/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: INCLUDED (TDD; the contract surfaces — maps_client, analyze alternatives,
key-safety, the numeric boundary, determinism, the failure/fallback paths — tested first
against mocked Maps). Test tasks precede implementation and MUST FAIL first.

**Organization**: by user story. **US1 (real Maps route) is the headline**; US2 (no-key
local fallback) is a regression-guard that must stay green; US3 (failure-safe + key never
leaks) is the safety story. MVP = Foundational + US1 + US2.

## Format: `[ID] [P?] [Story] Description`
Backend `app/api/aica_api/`, tests `app/api/tests/`; frontend `app/frontend/src/`, tests
`app/frontend/tests/`.

---

## Phase 1: Setup
- [ ] T001 Add the recorded Google JSON fixtures dir `app/api/tests/fixtures/maps/`
  (Directions 1–3 alternatives; highway service-area Places; convenience-store Places;
  empty Places; Directions failure; Places failure; invalid key) — no code yet.

## Phase 2: Foundational (Blocking — models, no key field)
- [ ] T002 [P] Extend `models/run.py` (+ `tests/test_models.py`): `RouteFacts.route_source:
  Literal["maps","local"]="local"`; NEW `DisplayRoute {summary, encoded_polyline,
  start_label, end_label}`; `RunState`/`RunLog`/`RunPlanDraft` carry `route_source` +
  optional `DisplayRoute`. Assert **no model accepts/stores a key field**; M1–M3 evidence
  still valid (defaults).

**Checkpoint**: evidence schema carries provenance + display snapshot, never a key.

---

## Phase 3: User Story 1 - Review over a real Google Maps route (Priority: P1) 🎯 MVP headline

**Goal**: with a key, enter start/end, get ≤3 alternatives with bounded facts, pick one,
run a UC-01 package over the real route with on-map markers.

**Independent Test**: (mocked Maps) analyze returns alternatives with facts; select one;
run to a rest proposal; trace + persisted evidence reflect the real route; no key in evidence.

- [ ] T003 [US1] Write failing `tests/test_maps_client.py` (injectable transport feeding
  recorded fixtures; Directions ≤3 alternatives parsed; Places rest POIs parsed; empty
  Places ≠ error; `MapsError` on directions/places/invalid-key failure; **key never in any
  error message/log**) then implement `services/maps_client.py` (stdlib `urllib`; key a
  param only).
- [ ] T004 [US1] Write failing `tests/test_route_analysis_maps.py` (per-alternative bounded
  `RouteFacts`; V1 segment classify highway+normal; context-typed rest spots highway→service
  area / else convenience store; lifts Google raw into frozen simulator facts) then EXTEND
  `services/route_analysis.py` with the maps path (consuming maps_client output; key not
  seen here).
- [ ] T005 [US1] Write failing `tests/test_routes_router.py` (maps path → `{route_source:
  "maps", alternatives:[{route_id, route_facts, display, summary}]}`, ≤3; key absent from
  the response) then EXTEND `routers/routes.py::analyze` to accept `maps_key`/`start`/`end`
  (request-scoped; passed only to maps_client; discarded) and return alternatives.
- [ ] T006 [US1] Write failing run-plans test (selected `route_id` builds the draft from
  that alternative's facts; `route_source` + `DisplayRoute` carried into draft→run→log;
  unknown route_id → 400) then EXTEND `routers/run_plans.py` + `services/run_plan.py`.
- [ ] T007 [P] [US1] Frontend `components/setup/MapKeyAndRouteInput.tsx` (NEW): BYO key
  (in-memory state only, never persisted) + free-text start/end; `state/runStore.ts` holds
  mapsKey/start/end/alternatives/selectedRouteId; `api/types.ts` adds alternative/route_source/
  DisplayRoute types; test that the key lives only in memory.
- [ ] T008 [US1] Frontend `components/map/MapSurface.tsx` (NEW): runtime Maps-JS script
  injection with the in-memory key; render the selected route + an alternative picker; car/
  progress/decision markers positioned from the tick's `route_fraction`; `tests/map.test.tsx`
  asserts markers render from tick progress (Maps JS mocked).

**Checkpoint**: real Maps route is selectable + reviewable end to end.

---

## Phase 4: User Story 2 - No-key local fallback unchanged (Priority: P1)

**Goal**: with no key, the existing deterministic local route works exactly as today.

**Independent Test**: no key → analyze returns the local route (uniform shape,
`route_source:"local"`); a UC-01 run is byte-for-byte the same deterministic result.

- [ ] T009 [US2] Write failing test (analyze with NO key → `{route_source:"local",
  alternatives:[one local alternative]}`; an existing UC-01 run is unchanged vs today) then
  wrap the existing `analyze_route` result in the uniform alternatives envelope WITHOUT
  changing local behavior; `route_source="local"` recorded.
- [ ] T010 [US2] Confirm/extend `test_api_run_loop.py` that the no-key path still produces
  identical deterministic decisions and that no map artifacts (key, display snapshot from
  Maps) appear in its evidence.

**Checkpoint**: the simulator is fully usable without a key; Maps is additive.

---

## Phase 5: User Story 3 - Failure-safe + key never leaks (Priority: P2)

**Goal**: honest, safe failure and an unleakable key.

**Independent Test**: forced Directions/Places failures (mocked) degrade per spec; the key
never appears in any run log/response/draft.

- [ ] T011 [US3] `tests/test_key_safety.py`: drive a full mocked-maps analyze→plan→run→log
  with a sentinel key string; assert the sentinel appears in **no** run log, **no** API
  response body, and **no** persisted draft. (Implementation already enforces request-scope;
  this is the guard test — strengthen code if it finds a leak.)
- [ ] T012 [US3] Failure/fallback tests + wiring: Directions failure → analyze error +
  retry affordance + local-route fallback, run NOT creatable without facts; Places **empty**
  → `rest_spot_positions=[]` + `notice:"no_rest_stops_found"` (engine then yields
  `NO_PRACTICAL_ACTION_FALLBACK`, no fabrication); Places **failure** → scenario local rest
  pattern scaled onto the route + `notice:"rest_data_degraded"`. Wire in
  `route_analysis`/`routes.py`.
- [ ] T013 [US3] `tests/test_route_boundary.py`: a maps-sourced run's algorithm context
  carries simulator-owned numeric `raw_state` (e.g. `nextRestSpotMin`) + ordinal
  `feature_groups`, and **no raw Google payload value** appears in the algorithm context or
  the persisted decision inputs (the two-layer boundary).

**Checkpoint**: honest failure + key-safety + boundary, all guarded.

---

## Phase 6: Determinism, Polish & e2e
- [ ] T014 Determinism test: same start/end + recorded fixtures → identical frozen
  `RouteFacts`; replaying from the run log performs **no** Maps call and yields an identical
  trace.
- [ ] T015 [P] e2e in `test_api_run_loop.py`: mocked-maps analyze→run-plans(route_id)→runs→
  tick→action→log for a UC-01 package; assert the proposal reflects a real rest stop,
  `route_source:"maps"`, the `DisplayRoute` snapshot is persisted, and the key is absent.
- [ ] T016 [P] Update root `README.md` + run `quickstart.md` validation (controller, docker)
  with mocked or a real key locally: real-route review, no-key fallback, a forced failure,
  and confirm the key never lands in evidence; both suites green.

---

## Dependencies & Execution Order
- **Setup (T001)** → fixtures. **Foundational (T002)** → blocks all stories.
- **US1 (T003–T008)** → the headline; maps_client (T003) is the root for T004–T006.
- **US2 (T009–T010)** → independent of US1 internals; guards the local path.
- **US3 (T011–T013)** → after US1 wiring exists (failures flow through analyze/route_analysis).
- **Polish (T014–T016)** → after US1–US3.

### Parallel Opportunities
- T002 (models) ∥ T001 (fixtures). T007 (frontend input) ∥ backend US1 tasks. T015/T016 ∥ in polish.

## Implementation Strategy
**MVP** = Setup → Foundational → US1 (real Maps route) + US2 (local fallback). STOP &
validate both route sources work. US3 (failure/key-safety/boundary) folds in next.

## Notes
- TDD: every test task precedes its impl and MUST fail first; **all Maps mocked — no live
  network in any test**.
- Security: the BYO key is request-scoped (backend) + in-memory (frontend), persisted in
  NO model; guard-tested (T011). NO new deps (stdlib urllib + script-injection loader).
- Determinism: Maps called once at analyze; facts frozen; replay never re-fetches (T014).
- Boundary: Google-raw → frozen simulator RouteFacts → numeric raw_state + ordinal
  feature_groups; no external raw value to a trigger (T013).
- Total: 16 tasks (T001–T016).
