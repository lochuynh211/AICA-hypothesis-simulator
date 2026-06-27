# Phase 0 Research: M4 Google Maps Route Surface

Most unknowns were resolved in the ADR + spec clarifications; this records the decisions
the plan depends on.

- **R1 — Server-side HTTP without a new dep.** Decision: stdlib `urllib.request` for
  Directions + Places. Rationale: `httpx` is test-only here; the supply-chain incident
  bans new runtime deps. Alternatives: add `httpx`/`requests` as runtime deps — rejected.

- **R2 — Frontend Maps JS without an npm dep.** Decision: load the Google Maps JS API at
  runtime by injecting the loader `<script>` with the in-memory key. Rationale: keeps the
  BYO-key runtime-injection model, no build-time key, no new npm dependency. Alternative:
  `@googlemaps/js-api-loader` npm dep — rejected (new dep).

- **R3 — Key locus.** Decision: backend-proxied Directions/Places (key per-request,
  transient) + interactive Maps JS display (key in browser memory). Rationale: ADR D1/D2;
  backend owns bounded facts, key persisted nowhere.

- **R4 — Start/end input.** Decision: free-text addresses geocoded directly by Directions
  (no separate Geocoding call). Rationale: clarify Q1; simplest, Directions accepts
  addresses. Resolved endpoints frozen.

- **R5 — Alternatives.** Decision: ≤3, each with its own bounded `RouteFacts` + display
  geometry + `route_id` at analyze; selected `route_id` → run-plans. Rationale: clarify
  Q3 + ADR D3.

- **R6 — Rest spots.** Decision: context-typed Google Places POIs (highway → service/
  parking area, else nearest convenience store) along the route, computed server-side and
  frozen. Two edge cases (clarify Q2 + spec FR-008): **lookup-empty** → honest empty list
  → `NO_PRACTICAL_ACTION_FALLBACK` (no fabrication); **lookup-failure** → scenario local
  rest pattern + visible degraded-data notice.

- **R7 — Numeric boundary.** Decision: Google raw numerics normalize into frozen
  simulator-owned `RouteFacts`; the M2 tick engine then derives numeric `raw_state` route
  fields + ordinal `feature_groups`. No external-service raw value reaches a trigger or is
  persisted as a decision input (constitution IV bans only external raw numerics).

- **R8 — Determinism.** Decision: Maps/Places called once at analyze; the selected
  alternative's facts + a snapshot of any live value frozen at run start; ticking + replay
  never re-fetch. Rationale: principle III; mirrors M2/M3 freeze-at-run-start.

- **R9 — Persistence.** Decision: evidence carries bounded `RouteFacts` + `route_source`
  ("maps"|"local") + a minimal display route snapshot (route summary + encoded/simplified
  polyline); never the key, raw Places payloads, or unnecessary geometry. Rationale: ADR
  D7 + runtime workflow §595/§713 (replay renders the same route).

- **R10 — Segment classification.** Decision: V1 classifies highway + normal_road from
  Directions road/maneuver hints; mountain/sightseeing best-effort, else normal_road.
  Rationale: runtime workflow §123.

- **R11 — Offline tests.** Decision: `maps_client` is mocked with recorded Google JSON
  fixtures; no test makes a live network call. Rationale: determinism + CI.
