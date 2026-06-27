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
`feature_groups`).

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

### D3 — Reviewer enters start/end at runtime; route + endpoints frozen
Per runtime workflow §3.3, the reviewer enters **start** and **end** at setup time and
**picks among Directions alternatives**; the scenario stays the abstract experiment
definition. The chosen start/end and the chosen route's bounded facts are **frozen into
the run log** at run start, so a past run reproduces deterministically. Rejected for
V1: geocodable locations baked into scenarios, and a fixed curated preset set.

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

### D7 — Boundary-bin all Maps numerics; persist only bounded/snapshot evidence
Directions/Places return raw external numerics (metres, seconds, live durations, POI
distances). They **only ever populate `RouteFacts`** (distance, segment types,
rest-spot positions, checkpoints), which the M2 tick engine already converts to ordinal
`feature_groups` before any algorithm sees them. **No raw Google numeric reaches an
algorithm or is persisted as a decision input.** Persisted evidence carries only
bounded facts + a `route_source` flag + (optionally) the display polyline as *snapshot
evidence* for replay rendering — **never the key, never unnecessary raw geometry.**

### D8 — No new dependencies
Backend server-side HTTP uses **stdlib `urllib.request`** (`httpx` is test-only here;
the supply-chain incident bans new runtime deps). Frontend loads Maps JS via runtime
**script injection** (no npm dependency). Reuse the prototype's BYO-key / binning ideas
conceptually only.

## Architecture / Data Flow

1. Reviewer enters BYO key (browser memory) + start + end.
2. Browser injects the Maps JS loader with the key → interactive map.
3. Frontend `POST /api/routes/analyze { maps_key, start, end, scenario_id }`.
4. Backend `maps_client` (stdlib urllib) → Directions (+ alternatives) + Places (rest
   POIs); `route_analysis` classifies segments + derives context-typed
   `rest_spot_positions`, **bins into `RouteFacts`**; returns bounded facts + display
   polyline/alternatives + `route_source`; **discards the key**.
5. Browser draws the polyline + segment/rest/marker overlays; reviewer picks an
   alternative.
6. `POST /api/run-plans` → draft event plan from the bounded facts (unchanged M2 path);
   `POST /api/runs` **freezes** facts + chosen start/end into the run log; ticks compute
   from frozen facts; replay never re-fetches. Key absent from all evidence.

## Components

**Backend**
- `services/maps_client.py` (NEW) — isolated stdlib-urllib Directions + Places; the only
  key user; fully mockable (recorded JSON fixtures; no live network in tests).
- `services/route_analysis.py` (EXTEND) — Maps-derived path beside the local-fixture
  path; V1 segment classification = highway + normal_road (mountain/sightseeing
  best-effort via tags, else default); context-typed rest spots; bin → `RouteFacts`.
- `routers/routes.py::/api/routes/analyze` (EXTEND) — optional `maps_key`/`start`/`end`;
  key present+valid → Maps path else local fallback; returns bounded facts + display
  geometry/alternatives + `route_source`. Key request-scoped only.
- Models — display polyline as snapshot evidence (separate from algorithm-facing facts);
  `route_source` on frozen evidence; **no key field anywhere**.

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
- **Binning tests**: raw Google numerics → ordinal bands; no raw numeric in algorithm
  context.
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
- IV Qualitative trigger discipline — PASS (Maps is exactly the external service whose
  raw numerics are binned before algorithms; this is the headline interaction).
- V One adapter contract — PASS (unchanged; M4 is upstream of the adapter).
- VI Local-first / YAGNI / no new deps — PASS (stdlib urllib + script-injection loader;
  local fallback preserved; no DB/cloud).
- Security — the BYO key is the sensitive value: transient in two places, persisted in
  neither, never logged/exported; guard-tested.

## Open Questions for the Spec Phase
- Exact Directions/Places request shape + the recorded-fixture set for offline tests.
- Whether the display polyline is persisted as snapshot evidence or kept display-only
  (lean: keep display-only unless replay rendering needs it).
- Geocoding of free-text start/end (Directions accepts addresses directly; a separate
  Geocoding call is likely unnecessary for V1).
