# Phase 1 Data Model: M4 Google Maps Route Surface

M4 reuses the M2 `RouteFacts` and the frozen-plan/tick pipeline; the changes are a Maps
*source* for facts, per-alternative results at analyze, a `route_source` flag, and a
minimal display route snapshot. **No model gains a key field.**

## Transient (NOT persisted)
- **Map key** — a request-scoped string on the analyze request body and the in-memory
  frontend state. Used only by `maps_client` (server) and the Maps JS loader (browser).
  Never stored on any draft/run/model, never logged, never in a response.
- **Raw Google payload** — Directions/Places JSON. Consumed by `route_analysis` to produce
  bounded facts; never persisted.

## RouteFacts (`models/run.py`) — EXTENDED
- `route_source: Literal["maps", "local"] = "local"` — provenance of the facts.
- Existing fields unchanged: `total_route_distance_km`, `route_segments[{segment_type,
  start_km, length_km}]`, `rest_spot_positions: list[float]`, checkpoints, M1 compat
  fields. Maps simply populates these from Google data instead of the local fixture.
- `rest_spots` may carry an optional context type tag (service_area | convenience_store)
  for display; the engine uses positions as today.

## RouteAlternative (analyze response, in-memory draft) — NEW
```
{ route_id: str, route_facts: RouteFacts, display: DisplayRoute, summary: str }
```
`POST /api/routes/analyze` (maps path) returns `{ route_source: "maps",
alternatives: [RouteAlternative, …≤3] }`. Local path returns
`{ route_source: "local", alternatives: [one RouteAlternative built from the scenario] }`
(uniform shape; the no-key path keeps working).

## DisplayRoute snapshot (`models/run.py`) — NEW, persisted as evidence
```
DisplayRoute = { summary: str, encoded_polyline: str, start_label: str, end_label: str }
```
Minimal, render-only; carries NO key, NO raw Places payload, NO unnecessary geometry.
Frozen into the run log at run start so replay renders the same route without re-fetching.

## RunPlanDraft / RunState / RunLog — EXTENDED
- `route_id` selects the alternative at `POST /api/run-plans`; the draft is built from that
  alternative's frozen `RouteFacts`.
- `RunState`/`RunLog` carry `route_source` and the `DisplayRoute` snapshot. **No key field.**

## Algorithm context — UNCHANGED (the boundary)
Below analyze nothing changes: the frozen `RouteFacts` feed the tick engine, which derives
numeric `raw_state` route fields (`nextRestSpotMin`, `highwayRemainingMin`,
`trafficJamAheadMin`, `monotonousRoadRemainingMin`, …) **plus** ordinal `feature_groups`,
exactly as in M2. No raw Google value enters the algorithm context.

## Rest-stop edge states
- **Empty** (Places ok, none found): `rest_spot_positions = []` → `nextRestSpotMin` none →
  trigger yields `NO_PRACTICAL_ACTION_FALLBACK` (no pause). A `notice` flags the absence.
- **Failure** (Places unobtainable): `rest_spot_positions` = the scenario's local rest
  pattern scaled onto the route; a `notice` flags degraded data.
