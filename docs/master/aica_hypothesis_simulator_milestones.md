# AICA Hypothesis Simulator — Milestone And Version Schedule Draft v1

**Document status:** Draft milestone plan  
**Source specification:** `docs/master/aica_hypothesis_simulator_specification.md`  
**Source architecture:** `docs/master/aica_hypothesis_simulator_architecture.md`  
**Schedule style:** Capability milestones only, no calendar dates  
**Implementation strategy:** Vertical slice first

---

## 1. Milestone Strategy

The project shall use capability milestones, not calendar-based dates.

Milestone labels:

```text
M0 — Project foundation
M1 — First runnable vertical slice
M2 — Package/schema hardening
M3 — Python algorithm support
M4 — Google Maps default route surface
M5 — Review feedback and evidence completeness
M6 — V1 stabilization
Post-V1 — Run comparison and expansion use cases
```

Milestone principle:

> Every milestone should leave the project runnable, testable, and easier to review than before.

V1 is reached when UC-01 can be reviewed end-to-end with package selection, scenario playback, backend algorithm evaluation, Google Maps route surface, decision trace, feedback, and automatically persisted run log.

Run comparison is explicitly post-V1 and shall not block V1.

---

## 2. M0 — Project Foundation

### Goal

Create the implementation foundation without pretending the simulator is usable yet.

### Scope

- Create project structure:
  - `app/api`
  - `app/frontend`
  - `packages`
  - `scenarios`
  - `runs`
- Add Docker Compose.
- Add FastAPI backend skeleton.
- Add React/Vite frontend skeleton.
- Add backend health endpoint.
- Add frontend shell that can call backend health.
- Add basic backend test runner.
- Add basic frontend test runner.
- Add placeholder `.gitkeep` for `runs/`.

### Acceptance Criteria

- `docker compose up` starts backend and frontend.
- Browser opens a simple app shell.
- Frontend can show backend health status.
- Backend tests run.
- Frontend tests run.
- No package, scenario, or evaluation logic is required yet.

### Prototype Relation

No prototype migration is required in M0. This milestone establishes only the architecture skeleton.

---

## 3. M1 — First Runnable Vertical Slice

### Goal

Prove the smallest useful simulator loop end-to-end.

### Scope

- Add one UC-01 scenario fixture.
- Add one simple rule-based hypothesis package.
- Backend package registry loads package.
- Backend scenario registry loads scenario.
- Backend creates run.
- Backend evaluates one decision point.
- Backend writes run log to `runs/`.
- Frontend shows rough accepted-skeleton-inspired layout:
  - left: scenario/timeline;
  - center: basic playback/cockpit;
  - right: trace/log.
- Frontend can:
  - select the single package/scenario;
  - start rough playback;
  - trigger evaluation at one decision point;
  - show result/trace;
  - show persisted log content.

### Acceptance Criteria

- User can open browser, start UC-01 playback, evaluate once, see AICA result, and find a persisted JSON log in `runs/`.
- Backend API can perform the same run without frontend dependence.
- Deterministic local route is sufficient; Google Maps is not required yet.
- UI can be rough; correctness of package/evaluate/log loop matters more.

### Prototype Relation

- Borrow layout direction from the accepted skeleton.
- Use the trigger-result idea from the functional skeleton as reference only, not as a direct dependency.

### Schema And Architecture Note (per M1 ADR 2026-06-27)

The accepted M1 design (`docs/superpowers/specs/2026-06-27-m1-first-vertical-slice-design.md`)
makes M1 a deliberately **thick** vertical slice. M1 introduces the core backend
Pydantic models — package manifest, scenario, the **full decision result**
(architecture §11), run state, and trace entry — plus the package and scenario
registries, the single algorithm-adapter contract with the built-in
`declarative_rule` algorithm, the deterministic tick engine (with an internally
frozen generated event plan), and the append-only evidence recorder. M2 therefore
**hardens and extends** these rather than introducing them (see the M2 note below).

---

## 4. M2 — Package And Schema Hardening

### Goal

Make package and scenario contracts real enough to support multiple hypotheses safely.

> **Note (per M1 ADR 2026-06-27):** the base Pydantic models (manifest, scenario,
> full decision result, run state, trace entry), the registries, the adapter
> contract, the deterministic tick engine, and the evidence recorder are
> introduced in M1. M2 hardens the schema (deeper validation, the remaining
> models/fields listed below, editable setup parameters/hyperparameters), adds the
> second (weighted-score) package and second UC-01 scenario, and adds the
> setup / run-plan editing flow with frontend validation errors.

### Scope

- Formalize backend Pydantic models for:
  - package manifest;
  - parameter definitions;
  - hyperparameter definitions;
  - scenario definition;
  - run state;
  - decision result;
  - trace entry;
  - feedback event.
- Include schema support for:
  - package runtime state;
  - fixed evaluation tick metadata;
  - route-derived facts;
  - generated event plan;
  - driver model profile;
  - vehicle behavior profile;
  - numeric speed profile;
  - run mode and evidence status;
  - category scores;
  - state-machine state labels;
  - multi-category trigger candidates;
  - suppressed candidates;
  - selected candidate and priority result.
- Add validation errors visible in frontend.
- Add second built-in package: weighted-score rest proposal.
- Add second UC-01 scenario: overtime driver branch.
- Support editable setup parameters and hyperparameters in frontend before run start.
- Persist setup snapshots, generated plan, and original/modified setup values to run log.
- Add backend tests for invalid packages/scenarios.

### Acceptance Criteria

- Backend rejects invalid packages with clear errors.
- Frontend shows package/scenario validation errors.
- User can choose between rule-based and weighted-score packages.
- User can choose between two UC-01 scenarios.
- User can edit values before starting playback.
- Run log records setup snapshot, generated plan, original values, and modified values.

### Prototype Relation

- Functional skeleton `inputs`, `result_meta`, and weighted-score behavior can guide fixture design.
- No direct Google Maps work is required yet.

---

## 5. M3 — Python Algorithm Support

### Goal

Support Python-authored trigger algorithms as first-class local package algorithms and execute the first transparent hybrid trigger package inside the simulator.

### Scope

- Implement `python_module` algorithm adapter.
- Define required Python function:

```python
def evaluate(context: dict) -> dict:
    ...
```

- Add one Python package fixture equivalent to weighted-score rest proposal.
- Add `aica_transparent_hybrid_trigger_v1` as a trusted local Python package fixture, using the master algorithm result contract.
- Pass package runtime state into Python evaluation and persist returned runtime state for smoothing, velocity, persistence counters, and state-machine behavior.
- Support fixed tick evaluation for Python packages that declare `tick_seconds`.
- Preserve Python-returned features, scores, state labels, candidates, suppressed candidates, selected candidate, priority result, proposal, and explanation in the trace.
- Validate Python algorithm outputs against standard decision result schema.
- Catch Python exceptions and invalid returns.
- Append `algorithm_error` events to run logs.
- Show algorithm errors in frontend trace panel.
- Add backend tests for:
  - successful Python evaluation;
  - missing function;
  - exception during evaluation;
  - invalid return shape.

### Acceptance Criteria

- A package with `algorithm.py` can be selected and evaluated.
- Setup-time parameter/hyperparameter changes are passed into Python evaluation when playback starts.
- The transparent hybrid trigger package can run against at least one UC-01 rest-required scenario.
- The transparent hybrid package can emit a full trace with features, scores, states, candidates, fire-control, selected proposal, and next runtime state.
- Suppressed candidates are persisted and visible in the trace.
- Python output is normalized into the same trace/result shape as other algorithms.
- Python errors are persisted as evidence and shown in UI.
- The simulator remains local/trusted-code only; no untrusted upload sandboxing is required.

### Scope Boundary

M3 proves that the simulator can execute and trace the transparent hybrid algorithm. It does not require full UC-03 monotony scenario coverage. Monotony candidate output may be structurally supported in M3, while full monotony-prevention UX review remains M8 unless the project intentionally moves UC-03 earlier.

---

## 6. M4 — Google Maps Default Route Surface

### Goal

Make Google Maps the normal route surface when a BYO key is available, while keeping deterministic fallback usable.

### Scope

- Add frontend Google Maps route surface.
- Add BYO key runtime input.
- Never persist or export the key.
- Use selected scenario start/end/rest context to draw route.
- Show car/progress/decision markers on the map.
- Use Maps as default route surface when key is present.
- Use deterministic local route fallback when key is absent or Maps fails.
- Boundary-bin route-derived values before evaluation when they affect algorithms.
- Persist only bounded/snapshot route evidence, not raw key or unnecessary raw geometry.

### Acceptance Criteria

- User can enter own Maps key at runtime.
- With key, playback route surface uses Google Maps by default.
- Without key, simulator still works with local deterministic route.
- Backend run logs never contain the Maps key.
- Algorithm inputs receive bounded route values, not raw external-service details.
- Maps failure does not prevent non-map simulation review.

### Prototype Relation

- Functional skeleton BYO-key, map persistence, and boundary-binning ideas can be reused conceptually.
- Accepted skeleton layout still guides screen organization.

---

## 7. M5 — Review Feedback And Evidence Completeness

### Goal

Complete the human-review evidence loop for V1.

### Scope

- Add structured feedback schema rendering.
- Add V1 feedback labels:
  - timing;
  - safety impression;
  - intrusiveness;
  - understandability;
  - rest spot suitability;
  - proposal content suitability;
  - acceptance/rejection reason;
  - overall reviewer judgment.
- Add free-text comments.
- Allow feedback after:
  - decision point;
  - proposal action;
  - end of run.
- Persist all feedback events in run log.
- Add run log viewer.
- Add evidence replay from persisted log.
- Add copy/download evidence JSON.
- Add optional Markdown export if cheap; JSON is required.

### Acceptance Criteria

- User can submit structured and free-text feedback.
- Feedback is traceable to run, decision, proposal, or action.
- Run log includes route facts, generated plan, profiles, trace, actions, setup values, feedback, and algorithm errors.
- Evidence replay can display a persisted run without recalculating algorithm decisions.
- User can inspect persisted log from browser.
- Evidence export clearly separates simulator facts from human review comments.

---

## 8. M6 — V1 Stabilization

### Goal

Make the UC-01 simulator stable enough for real review sessions.

### Scope

- Tighten UX around the accepted skeleton layout.
- Improve Japanese/English label switching.
- Ensure all V1 package/scenario labels display correctly.
- Add reset/restart run behavior.
- Add basic run list from persisted `runs/`.
- Improve error displays.
- Complete integration tests for the full UC-01 loop.
- Add README instructions:
  - start container;
  - open browser;
  - load package/scenario;
  - run simulation;
  - find logs.
- Remove prototype-only assumptions from production code.
- Verify no Google Maps key is persisted.

### Acceptance Criteria

- A reviewer can run UC-01 end-to-end without developer help.
- Rule-based, weighted-score, and Python package types all work.
- Google Maps default route surface works with BYO key and falls back safely.
- Logs persist automatically.
- Feedback and trace are complete enough for review.
- Evidence replay from persisted logs works.
- Setup instructions are clear.
- Run comparison is still not required for V1.

### Release Meaning

M6 is the V1 release candidate.

---

## 9. M7 — UC-01 Rest & Recovery (delivered)

### Goal

Deepen the UC-01 rest/recovery loop beyond the M6 stabilization baseline: a real recovery state machine,
realtime-paced recovery beats, named rest spots, and setup-time recovery controls.

### Scope (delivered)

- Recovery state machine (nap / content / resume phases) driving post-rest driver-state recovery.
- Realtime-paced recovery beats surfaced on the review timeline.
- Named rest spots (persistent markers) carried through to the map surface and recovery log.
- Setup-time recovery controls (rest spacing / rest ceiling editors) and a `REST_RECOVERY` re-arm fix.
- Persistent rest markers + recovery log entries in the evidence record.

### Release Meaning

M7 shipped as a normal feature branch merge to `develop`; V1 scope (M0–M6) was unaffected.

---

## 10. M8 — Signal-Tier Redesign (feature `009-signal-tier-redesign`, delivered)

### Goal

Replace the undifferentiated driver/vehicle-profile raw-state model with a coherent, honest three-tier
signal contract, and give the setup screen an instant *tune → observe* preview loop. Full detail:
`specs/009-signal-tier-redesign/`; architecture/specification/runtime-workflow docs updated in place
(see each doc's 2026-07-03 design-update note).

### Scope (delivered)

- **Tiered raw state**: every signal now belongs to exactly one of **Fixed / Dynamic / Simulated** tiers,
  exposed in full to every algorithm.
- **Honest simulated signals**: `drowsiness`/`fatigue` as deterministic *derived* signals (not pretend
  sensors), plus a single seeded-Poisson `anomaly_rate` — the only source of randomness, reproducible via
  a frozen `run_seed`.
- **Retired with no V1 replacement**: the deterministic vehicle sensors (steering, pedal, lane-departure,
  ADAS), the `attention` signal, and route look-ahead signals.
- **Retired built-in algorithm types**: `declarative_rule` and `weighted_score` are gone; `python_module`
  is the sole supported algorithm type (both shipped packages — the compact Hybrid trigger and NRI — are
  `python_module`).
- **Compact Hybrid**: the transparent hybrid trigger package re-defined to consume only the shared signal
  set (8 features, no route look-ahead), scoring/state-machine/fire-control/priority structure preserved.
- **Ephemeral instant-result preview**: `POST /api/runs/preview` runs the full tick loop headlessly for a
  candidate setup and returns a static timeline — never persisted to `runs/`.
- **Clean setup screen**: two editor panels (Scenario & Signals; Algorithm) + a full-width instant-result
  strip, replacing the earlier three-equal-column layout.
- Shipped scenarios rewritten in-place to the new signal-tier/parameter-group shape; the loader rejects an
  old-shape scenario with a clear "incompatible — re-author" error (no migration tool).

### Release Meaning

M8 shipped as a normal feature branch; V1 (M0–M6) scope and release meaning are unaffected. This is a
**deliberately behavior-changing** re-design — regenerated test baselines are expected, not a regression.

---

## 11. Post-V1 Milestones

Post-V1 should not block the first usable simulator. The candidate list below predates the M7/M8 delivered
above (§9, §10) and was not renumbered to match; read it as a backlog of ideas, not a committed sequence.

Candidate post-V1 milestones:

```text
M7 — Run comparison
M8 — UC-03 monotony / soft-warning expansion
M9 — UC-02 child passenger expansion
M10 — UC-04 attention decline expansion
M11 — Advanced algorithm/plugin support
```

### M7 — Run Comparison

Scope:

- compare two run logs;
- show package, scenario, value, result, timing, action, and feedback differences;
- avoid automatic winner selection.

### M8 — UC-03 Monotony / Soft-Warning Expansion

Scope:

- expand scenario and UI coverage beyond rest proposal into non-urgent intervention;
- add at least one monotony-prevention scenario that exercises the transparent hybrid package's monotony category;
- validate soft-warning and audio-first engagement bands;
- validate that safety-oriented rest proposals can override active monotony content.

### M9 — UC-02 Child Passenger Expansion

Scope:

- add passenger context;
- add consent-oriented proposals;
- validate child-passenger cabin recovery review flow.

### M10 — UC-04 Attention Decline Expansion

Scope:

- add conversational intervention;
- add low-cognitive-load UX review flow;
- validate attention recovery without urgent rest proposal.

### M11 — Advanced Algorithm / Plugin Support

Scope:

- state-machine algorithms;
- external runner;
- stronger package author tooling.

---

## 12. V1 Boundary Summary

V1 includes:

- local containerized frontend/backend;
- UC-01 scenarios;
- rule-based package;
- weighted-score package;
- Python algorithm package;
- editable setup parameters and hyperparameters before run start;
- generated event plan;
- deterministic tick engine;
- driver and vehicle behavior profiles;
- backend algorithm evaluation;
- decision trace;
- Google Maps default route surface with BYO key and local fallback;
- structured/free-text feedback;
- automatic backend run-log persistence;
- evidence JSON viewing and export;
- evidence replay from persisted logs.

V1 excludes:

- run comparison;
- multi-user review;
- accounts and permissions;
- database-backed package registry;
- cloud deployment;
- production vehicle integration;
- untrusted Python sandboxing;
- UC-02, UC-03, and UC-04 full scenario support.
