# M4 — Google Maps Route Surface (Design / ADR)

**Date:** 2026-06-27
**Milestone:** M4 (Google Maps default route surface)
**Status:** Approved design — pre-spec
**Branch (planned):** `005-m4-google-maps-route-surface`

## Context

M0–M3 are complete and merged to `develop`: a deterministic, file-based AICA trigger
simulator with a backend tick engine + algorithm adapter (declarative_rule,
weighted_score, python_module incl. the transparent hybrid), append-only evidence,
and a React review UI. Route facts today come **only** from local scenario fixtures
(`POST /api/routes/analyze` → `RouteFacts` → frozen event plan → tick engine →
numeric `raw_state` + ordinal `feature_groups`, runtime workflow §467).

M4 makes **Google Maps the default route surface when a BYO key is present**, while
keeping the existing deterministic local route as the fallback. Authoritative scope:
`docs/master/aica_hypothesis_simulator_milestones.md` §6 (M4), runtime workflow §3.3–3.4
+ §11.1, architecture §6.3 + §endpoints. The master invariants this design must honor:
the map key is **BYO at runtime, never shipped/persisted/logged/exported**; route-derived
numerics are **boundary-binned before reaching algorithms**; the simulator must **work
with a deterministic local fallback** when no key is present or Maps fails; **run logs
never contain the key**.

## Decisions

### D1 — Backend-proxied Directions + Places (key per-request, transient)
The backend derives the authoritative route facts by calling Google **Directions**
(route + alternatives) and **Places** (rest POIs) **server-side**, with the BYO key
passed as a request-scoped field on `POST /api/routes/analyze` and **discarded after
the call** (never stored on draft/run, never logged, never echoed). This keeps the
backend the single source of truth for bounded route facts (Principle I) and keeps
raw-numeric derivation + binning server-side (Principle IV). Rejected: deriving route
facts in the browser and trusting frontend-sent route data.

### D2 — Interactive Google Maps JS for the visual surface (key in browser memory)
The on-screen map is a real interactive Google Map rendered via the Maps **JS API**,
loaded at runtime by injecting the loader script with the user's key (no npm
dependency, nothing key-related baked at build). The browser holds the key in
**in-memory state only** (never localStorage / never the persisted draft). Thus the
BYO key is used in exactly **two transient places** — browser memory (map display) and
one per-request analyze field (Directions/Places) — and **persisted in neither**. The
map shows car / progress / decision markers driven by the tick's `route_fraction`.
Rejected for V1: backend Static-Maps images (no live animation) and a no-Google
schematic canvas (loses the real map the milestone calls for). Note this means the key
does live client-side for *display*; the data calls remain backend-proxied per D1.

### D3 — Reviewer enters start/end at runtime; pick-then-finalize alternatives flow
Per runtime workflow §3.3, the reviewer enters **start** and **end** at setup time and
**picks among Directions alternatives**; the scenario stays the abstract experiment
definition. Concrete flow (resolves the per-alternative ambiguity):
`POST /api/routes/analyze` returns the alternatives **each with its own bounded
per-alternative `RouteFacts` + display geometry + a `route_id`** (segment classification
and Places rest-spot derivation run per alternative; alternatives are few, ~2–3). The
reviewer picks one; its **`route_id` is passed to `POST /api/run-plans`**, which builds
the draft plan from that alternative's facts. The chosen start/end + that alternative's
bounded facts are **frozen into the run log** at run start, so a past run reproduces
deterministically. Rejected for V1: geocodable locations baked into scenarios, and a
fixed curated preset set.

### D4 — Rest spots = real, context-typed Places POIs, computed server-side and frozen
The backend computes rest opportunities from **Google Places along the chosen route**,
classified by road context: on a **highway** → the next **Service/Parking Area**;
otherwise → the nearest **convenience store**. These populate `RouteFacts.rest_spot_positions`
(with a type tag), are **frozen at run start**, and the existing M2 tick engine computes
`nextRestSpotMin` from them **unchanged**. Places is therefore the second Google API in
M4. Graceful degradation (D6) covers Places failure.

### D5 — Maps/Places called once at analyze; replay never re-fetches (determinism)
All external calls happen at **analyze/plan time**; the bounded facts (incl. any
traffic-aware duration as a captured snapshot value) are **frozen at run start**. The
tick engine and replay read frozen facts only — **no Maps call during ticking or
replay** — preserving Principle III (deterministic, replayable).

### D6 — Deterministic local fallback; honest failure, never start without facts
- **No key** → the existing M2 deterministic local route (no map; `RouteTimeline`
  surface). `route_source: "local"`.
- **Directions failure** → show error, **allow retry**, **allow local-fixture
  fallback**; **never start a run without route facts** (master §11.1).
- **Places failure** → degrade to synthetic-cadence / scenario rest spots (surfaced as
  a notice), so the rest trigger still has actionable targets.

### D7 — Two-layer numeric boundary: Google-raw → frozen route facts → simulator raw_state
The external boundary is between **Google's raw API payload** (metres, seconds, live
durations, geometry, Places raw distances) and the **simulator's own state**. Google raw
numerics **never directly drive a trigger**. At analyze they are normalized into
**frozen, simulator-owned `RouteFacts`** (total distance, segment types, rest-spot
positions+types, checkpoints). The tick engine then derives the simulator's **numeric
`raw_state` route fields** (`nextRestSpotMin`, `highwayRemainingMin`,
`trafficJamAheadMin`, `monotonousRoadRemainingMin`, …) **from those frozen facts**, plus
normalized/ordinal `feature_groups` — **exactly the M2 pipeline** (runtime workflow §467:
algorithm context carries both `raw_state` and `feature_groups`), with Google merely
replacing the local fixture as the SOURCE of the frozen facts. The transparent hybrid
(and weighted_score) legitimately consume those **simulator-owned numeric** raw_state
fields they need (hybrid proposal §184); constitution IV bans only **external-service**
raw numerics reaching a trigger — not the simulator's own derived numerics. **No raw
Google payload value is handed to an algorithm or persisted as a decision input.**

**Persisted evidence** carries: the bounded `RouteFacts`, a `route_source` flag, and a
**minimal display route snapshot** (selected route summary + an encoded/simplified
polyline) sufficient for replay to render the same route (runtime workflow §595, §713) —
**never the key, never raw Places payloads, never unnecessary raw geometry.**

### D8 — No new dependencies
Backend server-side HTTP uses **stdlib `urllib.request`** (`httpx` is test-only here;
the supply-chain incident bans new runtime deps). Frontend loads Maps JS via runtime
**script injection** (no npm dependency). Reuse the prototype's BYO-key / binning ideas
conceptually only.

## Architecture / Data Flow

1. Reviewer enters BYO key (browser memory) + start + end.
2. Browser injects the Maps JS loader with the key → interactive map.
3. Frontend `POST /api/routes/analyze { maps_key, start, end, scenario_id }`.
4. Backend `maps_client` (stdlib urllib) → Directions **alternatives** + Places (rest
   POIs per alternative); `route_analysis` classifies segments + derives context-typed
   `rest_spot_positions` and **normalizes each alternative into its own
   frozen-ready `RouteFacts`**; returns **`alternatives[{route_id, RouteFacts, display
   geometry}]`** + `route_source`; **discards the key**.
5. Browser draws each alternative; reviewer picks one (`route_id`).
6. `POST /api/run-plans { route_id }` → draft event plan from that alternative's bounded
   facts (unchanged M2 path); `POST /api/runs` **freezes** the chosen `RouteFacts` +
   start/end + minimal display snapshot into the run log; the tick engine derives the
   numeric `raw_state` route fields + `feature_groups` from the frozen facts each tick;
   replay never re-fetches. Key absent from all evidence.

## Components

**Backend**
- `services/maps_client.py` (NEW) — isolated stdlib-urllib Directions + Places; the only
  key user; fully mockable (recorded JSON fixtures; no live network in tests).
- `services/route_analysis.py` (EXTEND) — Maps-derived path beside the local-fixture
  path; V1 segment classification = highway + normal_road (mountain/sightseeing
  best-effort via tags, else default); context-typed rest spots; bin → `RouteFacts`.
- `routers/routes.py::/api/routes/analyze` (EXTEND) — optional `maps_key`/`start`/`end`;
  key present+valid → Maps path else local fallback; returns
  `alternatives[{route_id, RouteFacts, display geometry}]` + `route_source`. Key
  request-scoped only.
- `routers/run_plans.py::/api/run-plans` (EXTEND) — accept the selected `route_id`; build
  the draft from that alternative's bounded facts.
- Models — minimal display route snapshot (summary + encoded/simplified polyline) on the
  frozen evidence, separate from algorithm-facing facts; `route_source` on frozen
  evidence; **no key field anywhere**.

**Frontend**
- BYO-key input + start/end entry (in-memory state only).
- `components/map/MapSurface.tsx` (NEW) — dynamic Maps-JS loader; interactive map with
  car/progress/decision markers driven by tick `route_fraction`; alternative picker.
  Route surface when a key is present; `RouteTimeline` remains the no-key fallback.

## Scope / Non-Goals (YAGNI)
V1 segment classification prioritizes highway + normal_road. No route drawing/editing,
no saved routes, no multi-key, no offline tiles, no Static-Maps path. The downstream
tick/decision/evidence pipeline is unchanged below `analyze`.

## Testing Strategy
- `maps_client` mocked with recorded Google JSON — **offline, deterministic; no live
  network in any test.**
- **Key-safety guard tests**: the key never appears in any run log, API response, or
  persisted draft.
- **Boundary tests**: raw Google numerics are normalized into frozen `RouteFacts`;
  algorithm context may contain simulator-owned numeric `raw_state` (e.g.
  `nextRestSpotMin`) plus ordinal `feature_groups`; **no raw external-service payload
  value reaches the algorithm**.
- **Determinism**: analyze freezes; replay performs no Maps call; repeat run identical.
- **Fallback tests**: no-key path = existing local route still fully works;
  Directions-failure → error + retry + local fallback; Places-failure → degraded rest
  spots.
- **Frontend**: markers render from tick progress; key stays in-memory (not persisted);
  alternative picker; no-key surface = RouteTimeline.
- **e2e (mocked Maps)**: analyze(maps) → plan → run → proposal → log; key absent from
  evidence; `route_source` recorded.

## Constitution Check (preliminary)
- I Backend source of truth — PASS (bounded facts derived server-side).
- II Append-only / failures-never-hidden — PASS (honest Maps failure + fallback; never
  start without facts).
- III Deterministic/replayable — PASS (call-once-at-analyze, freeze, no replay re-fetch).
- IV Qualitative trigger discipline — PASS (Google raw numerics are normalized into
  frozen simulator-owned route facts; the tick engine then derives numeric `raw_state` +
  ordinal `feature_groups` from those facts, as in M2 — no **external-service** raw
  numeric reaches a trigger. This two-layer boundary is the headline interaction).
- V One adapter contract — PASS (unchanged; M4 is upstream of the adapter).
- VI Local-first / YAGNI / no new deps — PASS (stdlib urllib + script-injection loader;
  local fallback preserved; no DB/cloud).
- Security — the BYO key is the sensitive value: transient in two places, persisted in
  neither, never logged/exported; guard-tested.

## Open Questions for the Spec Phase
- Exact Directions/Places request shape + the recorded-fixture set for offline tests.
- The exact minimal display-snapshot representation (encoded polyline vs simplified
  decimated path) and its size budget in the run log.
- Geocoding of free-text start/end (Directions accepts addresses directly; a separate
  Geocoding call is likely unnecessary for V1).
- Per-alternative Places cost (≤3 alternatives): D3 stands (analyze returns
  per-alternative facts). If cost proves material, an allowed implementation optimization
  is to derive rest spots only for the selected route at run-plans — but it MUST yield the
  same selected-route facts before the plan is built (no behavior change).
