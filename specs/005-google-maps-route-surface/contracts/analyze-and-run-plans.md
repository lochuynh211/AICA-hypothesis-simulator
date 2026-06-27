# Contract: analyze (alternatives) + run-plans (route_id) + route_source

## POST /api/routes/analyze
Request: `{ scenario_id, maps_key?, start?, end? }`.
- **Maps path** (key + start + end present): backend `maps_client.directions` +
  `places_rest_stops` (key used transiently, then discarded); `route_analysis` normalizes
  each alternative into bounded `RouteFacts` (segment classify; context-typed rest spots;
  empty-vs-failure rest handling), builds a `DisplayRoute`. Response:
  `{ route_source: "maps", alternatives: [{route_id, route_facts, display, summary}], notices?: [..] }`.
- **Local path** (no key): existing behavior, wrapped uniformly:
  `{ route_source: "local", alternatives: [{route_id:"local", route_facts, display?, summary}] }`.
- **Directions failure**: HTTP error payload that the UI shows with retry + a "use local
  route" affordance; a run MUST NOT be creatable without route facts.
- **Key safety**: `maps_key` is read from the body, passed only to `maps_client`, and never
  echoed, logged, or stored. The response contains no key.

## POST /api/run-plans
Request gains `route_id` (+ existing `scenario_id`/setup). The draft is built from the
selected alternative's frozen `RouteFacts`; `route_source` + the `DisplayRoute` snapshot are
carried into the draft → run → log. Unknown `route_id` → structured 400.

## Rest-stop handling (route_analysis, maps path)
- Places returns POIs → `rest_spot_positions` (with context type), frozen.
- Places returns empty → `rest_spot_positions=[]`, `notice: "no_rest_stops_found"`; the
  trigger later yields `NO_PRACTICAL_ACTION_FALLBACK` (engine unchanged).
- `places_rest_stops` raises `MapsError("places_failure")` → fall back to the scenario's
  local rest pattern scaled onto the route, `notice: "rest_data_degraded"`.

## Determinism + evidence
- Maps/Places called ONLY here (analyze). The selected alternative's facts + display
  snapshot are frozen at run start; ticking + replay never call Maps.
- Persisted run log carries `route_source` + `DisplayRoute` + bounded `RouteFacts` — never
  the key, raw Places payloads, or unnecessary geometry.

## Contract tests
- analyze maps path → ≤3 alternatives each with bounded facts + display + route_id; key
  absent from the response.
- analyze local path (no key) → unchanged single-alternative result, `route_source:"local"`.
- run-plans with a chosen route_id builds from that alternative; unknown route_id → 400.
- Directions failure → error + no run without facts; Places empty → empty rest list +
  notice; Places failure → scenario rest fallback + degraded notice.
- Determinism: same inputs + recorded fixtures → identical frozen facts; replay reads the
  log, no Maps call.
- Key-safety: key absent from run log, every response, and the persisted draft.
