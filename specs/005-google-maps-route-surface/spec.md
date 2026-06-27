# Feature Specification: M4 Google Maps Route Surface

**Feature Branch**: `005-google-maps-route-surface`

**Created**: 2026-06-27

**Status**: Draft

**Input**: User description: "M4 Google Maps Route Surface — make Google Maps the default
route surface when a reviewer supplies their own map key, while keeping the existing
deterministic local route as a fallback. The map key is entered at runtime and never
persisted, logged, or exported. Route-derived external numbers are converted into the
simulator's own bounded route state before reaching any trigger; runs stay deterministic
and replayable."

## Overview

Today a reviewer drives the simulator over a route defined by a local scenario fixture.
M4 lets a reviewer **bring their own Google Maps key at runtime** and review trigger
algorithms over a **real Google Maps route** between a start and an end they enter,
including realistic rest stops (highway service areas or nearby convenience stores). The
real Google map is shown with the car, progress, and decision markers during playback.

When no key is present — or when the map service fails — the simulator falls back to the
existing deterministic local route so review is never blocked. The map key is a sensitive
secret: it is used only transiently and is **never written to any run log, response, or
saved file**. Real route runs are **frozen at run start and replay without re-contacting
the map service**, so every run remains deterministic and reproducible. External map
numbers (distances, durations, geometry) are converted into the simulator's own bounded
route state **before** any trigger evaluates them; the simulator's own derived numeric
route fields and ordinal bands continue to drive algorithms exactly as before.

Authoritative design:
`docs/superpowers/specs/2026-06-27-m4-google-maps-route-surface-design.md`. Master scope:
milestones §6 (M4), runtime workflow §3.3–3.4 + §11.1, architecture §6.3.

## Clarifications

### Session 2026-06-27

- Q: How does the reviewer enter the start and end for a Maps route? → A: Free-text place
  names / addresses, geocoded directly by the route service; the resolved endpoints are
  frozen into the run log for reproducibility.
- Q: When no rest stops are found along the route, how should the simulator behave? → A:
  Do NOT fabricate rest stops. The route facts carry an honest empty rest list (surfaced
  as a notice), so the trigger recognizes the rest need but, with no reachable rest
  target, yields its existing non-actionable `NO_PRACTICAL_ACTION_FALLBACK` alert — which
  does not pause the run — and the drive continues. (Distinct from a rest-stop lookup
  *failure*, where data could not be obtained — see FR-008: that degrades to the
  scenario's local rest pattern with a visible degraded-data notice, so rest targets
  remain available rather than falsely asserting absence.)
- Q: How many route alternatives should the reviewer be offered? → A: Up to 3 (whatever
  the route service returns, capped at 3).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Review an algorithm over a real Google Maps route (Priority: P1)

A reviewer enters their own map key plus a start and an end, sees the real route drawn on
a map, picks among the offered route alternatives, runs a trigger package over it, and
reviews the decision trace with the car/progress/decision markers moving along the real
route.

**Why this priority**: This is the headline M4 value — reviewing trigger behavior over
realistic routes instead of only hand-authored fixtures.

**Independent Test**: With a (mocked) map key, enter a start/end, confirm route
alternatives appear each with derived route facts, select one, run a UC-01 package to a
rest proposal, and confirm the trace and the on-map markers reflect the run.

**Acceptance Scenarios**:

1. **Given** a reviewer has entered a map key and a start/end, **When** they request a
   route, **Then** the simulator offers one or more route alternatives, each with its own
   derived route facts (distance, segment types, rest-stop positions) and a drawable
   route, and the real map is displayed.
2. **Given** alternatives are offered, **When** the reviewer selects one and starts a run,
   **Then** the run uses the selected route's facts, and during playback the car/progress/
   decision markers move along that route.
3. **Given** a real-route run reaches a rest proposal, **When** the reviewer inspects the
   trace, **Then** the rest proposal reflects realistic rest stops (a highway service area
   when on a highway, otherwise a nearby convenience store) derived from the route.

---

### User Story 2 - Review without a key using the deterministic local route (Priority: P1)

A reviewer with no map key runs the simulator exactly as before, over the deterministic
local route, with no map surface required.

**Why this priority**: The simulator must remain fully usable offline / without a key;
the Maps surface is additive, never a precondition.

**Independent Test**: With no key, run an existing UC-01 scenario end-to-end and confirm
it behaves exactly as it does today (local route, same deterministic result).

**Acceptance Scenarios**:

1. **Given** no map key is provided, **When** the reviewer sets up and runs a scenario,
   **Then** the run uses the deterministic local route and completes normally, and the
   route source is recorded as local.
2. **Given** a no-key run, **When** the reviewer reviews the evidence, **Then** nothing
   about a map service or map key appears anywhere in it.

---

### User Story 3 - Map failures degrade safely and the key never leaks (Priority: P2)

When the map service cannot return a route (or rest stops), the reviewer is told, can
retry or fall back to the local route, and is never allowed to start a run without route
facts; in all cases the key is never stored or shown.

**Why this priority**: Honest failure and secret-safety are constitutional boundaries;
the feature must fail safe, never silently or by leaking the key.

**Independent Test**: Force a route-service failure and a rest-stop-service failure
(mocked); confirm the surfaced error + retry + local fallback, that a run cannot start
without route facts, and that no run log/response/saved file ever contains the key.

**Acceptance Scenarios**:

1. **Given** the route service fails, **When** the reviewer requests a route, **Then** an
   error is shown, retry is offered, the local-route fallback is offered, and no run can
   start without route facts.
2. **Given** the rest-stop lookup **finds nothing** on a valid route, **When** the route
   facts are built, **Then** no rest stops are fabricated — the rest list is honestly
   empty (a surfaced notice) and the trigger yields its non-actionable
   `NO_PRACTICAL_ACTION_FALLBACK` alert (no pause), so the drive continues. **And given**
   the rest-stop lookup instead **fails**, **Then** the system falls back to the
   scenario's local rest pattern with a visible degraded-data notice (rest targets remain
   available), never falsely asserting absence.
3. **Given** any real-route interaction, **When** the run log, any API response, and any
   saved file are inspected, **Then** the map key never appears in any of them.

---

### Edge Cases

- **Key present but route service unreachable / invalid key**: surfaced error, retry, and
  local-route fallback; never start a run without route facts (master §11.1).
- **Rest-stop lookup returns nothing vs fails**: a successful-but-empty lookup → no rest
  stops fabricated, `nextRestSpotMin` is "none", so the trigger yields its non-actionable
  `NO_PRACTICAL_ACTION_FALLBACK` alert (not a pause), the drive continues, and the absence
  is surfaced. A rest-stop lookup *failure* (data unobtainable) → fall back to the
  scenario's local rest pattern (scaled onto the route) with a visible degraded-data
  notice, so rest targets remain available.
- **Replay / refresh after a real-route run**: the run replays from frozen route facts
  and the saved display snapshot — the map service is never re-contacted, and the result
  is identical.
- **Route segment types the map service does not label** (mountain/sightseeing): V1
  classifies highway and normal_road; others are best-effort and otherwise treated as
  normal_road.
- **Reviewer switches start/end or picks a different alternative before starting**: facts
  are recomputed for the new selection; a started run is frozen and immutable.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The reviewer MUST be able to enter their own map key at runtime; the system
  MUST use Google Maps as the default route surface when a key is present and fall back to
  the existing deterministic local route when no key is present.
- **FR-002**: The map key MUST be treated as a transient secret: it MUST NOT be written to
  any run log, any persisted file, any API response body, or any application log, and MUST
  NOT be exported. It is used only for the live map display and for the per-request route
  derivation, and is discarded immediately after use.
- **FR-003**: The reviewer MUST be able to enter a start and an end at runtime as
  **free-text place names / addresses** (geocoded directly by the route service); the
  system MUST offer **up to 3** route alternatives, each carrying its own derived route
  facts (total distance, segment types, rest-stop positions, progress checkpoints) and a
  drawable route. The reviewer selects one alternative for the run; the resolved endpoints
  and the chosen route are frozen into the run log.
- **FR-004**: Rest-stop positions for a real route MUST be derived from real points of
  interest along the route, classified by road context (a highway service/parking area
  when on a highway; otherwise the nearest convenience store), and frozen with the route
  facts.
- **FR-005**: External map numbers (distances, durations, geometry, point-of-interest
  distances) MUST be converted into the simulator's own bounded route facts before any
  trigger evaluates them. The simulator's own derived numeric route fields (e.g. time to
  the next rest stop, remaining highway/monotony minutes) and ordinal bands continue to
  drive algorithms; **no raw external-service value is handed to an algorithm or persisted
  as a decision input.**
- **FR-006**: The map service MUST be contacted only at route-analysis time. The selected
  route's facts (and a captured snapshot of any live-varying value) MUST be frozen at run
  start; ticking and replay MUST NOT contact the map service, so a run reproduces
  identically.
- **FR-007**: Persisted evidence for a real-route run MUST include the bounded route
  facts, a route-source indicator (maps vs local), and a minimal display route snapshot
  (route summary plus a compact route path) sufficient to replay-render the same route —
  and MUST NOT include the key, raw point-of-interest payloads, or unnecessary raw
  geometry.
- **FR-008**: If the route service cannot return a route, the system MUST show an error,
  allow retry, allow the local-route fallback, and MUST NOT start a run without route
  facts. Rest-stop handling distinguishes two cases: **(a) lookup succeeds but finds no
  rest stops** along the route → the system MUST NOT fabricate rest stops; the route facts
  carry an **honest empty rest list** (surfaced as a notice), so the trigger recognizes
  the rest need but, with no reachable target, yields its existing non-actionable
  `NO_PRACTICAL_ACTION_FALLBACK` alert (no pause) and the drive continues. **(b) the
  rest-stop lookup itself fails** (data could not be obtained) → the system MUST fall back
  to the scenario's local rest pattern (scaled onto the route) with a **visible
  degraded-data notice**, so the rest trigger still has estimated targets and review is
  not blocked by a transient failure (the simulator must not falsely assert absence when
  it simply could not check).
- **FR-009**: During playback of a real-route run, the map MUST display the car, progress,
  and decision (proposal) markers positioned from the run's deterministic per-tick
  progress.
- **FR-010**: The no-key local-route path MUST remain fully functional and behave exactly
  as it does today (same deterministic results), with the route source recorded as local.
- **FR-011**: Real-route review MUST work for the existing UC-01 packages without changes
  to the trigger algorithms, the tick engine's decision logic, or the evidence/replay
  contract below route analysis.

### Key Entities

- **Map key (BYO secret)**: a reviewer-supplied key, held only transiently for the live
  map and per-request route derivation; never persisted, logged, or exported.
- **Route request**: the reviewer's start and end (and chosen alternative).
- **Route alternative**: one candidate route with its own bounded route facts + drawable
  route + identifier.
- **Bounded route facts**: the simulator-owned route state (distance, segment types,
  rest-stop positions+types, checkpoints) derived from the map data and frozen at run
  start.
- **Display route snapshot**: the minimal persisted route summary + compact path used to
  replay-render the map; carries no key or raw service payloads.
- **Route source**: an indicator of whether a run's route came from the map service or the
  local fallback.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With a key, a reviewer can enter a start/end, choose among offered route
  alternatives, and run a UC-01 package over the real route to a decision — end to end.
- **SC-002**: The map key never appears in any run log, API response, or saved file — for
  every real-route interaction (verified across the failure paths too).
- **SC-003**: A real-route run repeated from the same selection produces an identical
  per-tick trace and identical decisions, with no map-service contact during ticking or
  replay.
- **SC-004**: Without a key, every existing scenario runs exactly as it does today
  (unchanged deterministic results), and no map artifacts appear in its evidence.
- **SC-005**: A map-service failure does not prevent review: the reviewer sees an error,
  can retry, and can fall back to the local route; a run never starts without route facts.
- **SC-006**: Algorithm inputs for a real-route run are the simulator's bounded route
  facts / derived fields, never raw external-service values — verifiable in the recorded
  evidence.
- **SC-007**: Real rest stops on a real route are reflected in the rest proposal (a
  highway service area or a nearby convenience store, by context).

## Assumptions

- **Stack/architecture fixed by the M4 ADR and master docs**: existing FastAPI/Pydantic
  backend + React/Vite frontend, file-based data, the M2 route-facts → frozen plan → tick
  engine → raw_state + feature_groups pipeline. This spec states *what*; the ADR/plan own
  *how* (backend-proxied route derivation, the in-browser interactive map, the freezing).
- **Start/end are free-text addresses** geocoded by the route service (no separate
  geocoding step); up to **3** route alternatives are offered.
- **One reviewer, one key at a time**; no saved keys, no multi-key, no route
  editing/drawing, no offline map tiles — deferred to later milestones.
- **V1 segment classification** prioritizes highway and normal_road; mountain/sightseeing
  are best-effort and otherwise treated as normal_road.
- **Determinism via freeze**: live-varying values (e.g. traffic-aware duration) are
  captured once as a frozen snapshot; the tick/decision/evidence pipeline below route
  analysis is unchanged from M2/M3.
- **Tests run fully offline** against recorded map-service responses; no live network call
  is made in any automated test.
