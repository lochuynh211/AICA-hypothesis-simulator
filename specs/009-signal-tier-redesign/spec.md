# Feature Specification: Signal-Tier Re-design & Clean Setup Screen

**Feature Branch**: `009-signal-tier-redesign`

**Created**: 2026-07-03

**Status**: Draft

**Input**: User description: "Raw-state / feature / hyperparameter separation re-design + clean setup screen." Authoritative design: `others/aica_trigger_algorithms_math_comparison.md` (Part 2 — AFTER) and `others/aica_setup_screen_uiux.md`.

## Clarifications

### Session 2026-07-03

- Q: Is the instant-result preview persisted to evidence, or ephemeral? → A: Ephemeral — the instant preview is a headless, non-persisting computation; it is never written to `runs/`/evidence. Only "Open full run" creates a persisted run.
- Q: Migrate scenarios via a mechanism, or rewrite the shipped files? → A: Rewrite the shipped scenario files in-place; the loader rejects old-shape files with a clear "incompatible — re-author" error. No migration tool (YAGNI).
- Q: Is the htmlapp offline build in scope for this feature? → A: No — this feature is backend + primary `app/frontend` only; the htmlapp TS port + parity-fixture regeneration are deferred to a separate follow-up feature.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Instantly see the effect of a tuning change (Priority: P1)

On the setup screen, the reviewer changes an algorithm hyperparameter (a weight or threshold) or an editable signal and immediately sees, on a static timeline, whether and when the trigger fires, where the rest spot is, and how the risk score crosses its threshold — without launching the full animated run.

**Why this priority**: This is the core value of the re-design — a tight *tune → observe* loop. It turns hyperparameter review from "configure, run, watch, repeat" into instant feedback.

**Independent Test**: With a scenario and algorithm selected, change one weight and confirm the instant-result timeline's fire marker and result line update, with no full run started.

**Acceptance Scenarios**:

1. **Given** a selected scenario + algorithm, **When** the reviewer edits a hyperparameter, **Then** the instant-result timeline recomputes and shows the new firing time (or an explicit "no trigger") near-instantly.
2. **Given** a change that suppresses firing, **When** applied, **Then** the timeline shows "no trigger" with the peak score relative to the threshold.
3. **Given** the reviewer clicks "Open full run", **Then** the detailed animated review opens with exactly the previewed configuration.

---

### User Story 2 - Understand what feeds each decision (Priority: P1)

The setup screen shows every raw signal grouped by kind (Fixed / Dynamic / Simulated), both editable and read-only, with each simulated signal carrying a plain-language explanation of how it is formed. The algorithm is shown as its formulation — features as formulas over named signals, with hyperparameters editable inline as the coefficients.

**Why this priority**: Trust and transparency. A reviewer must see the full input picture and trace every feature to its source, not a decontextualized list of knobs.

**Independent Test**: Open the setup screen and confirm every signal appears under its tier, simulated signals have an info explanation, and each algorithm feature references its source signal.

**Acceptance Scenarios**:

1. **Given** the setup screen, **Then** all signals appear grouped as Fixed / Dynamic / Simulated, with read-only signals visibly non-editable.
2. **Given** a simulated signal, **When** the reviewer opens its info, **Then** a plain-language explanation of how it is formulated is shown.
3. **Given** the algorithm area, **Then** features are shown as formulas with hyperparameters editable in place, and feature names cross-reference the corresponding signal.

---

### User Story 3 - Trust the simulation's honesty and reproducibility (Priority: P2)

Drowsiness and fatigue are presented as *derived* quantities, not pretend sensor measurements. The only random signal — behavioral anomaly events — is driven by a run seed, so identical setups reproduce identical runs. Hyperparameter defaults come from a single authoritative source, and the overrides view shows only the values the reviewer changed.

**Why this priority**: Credibility of the evidence and comparability across runs. A reviewer must trust that results are reproducible and that no fabricated sensor is being handed to the algorithm as ground truth.

**Independent Test**: Run the same setup with the same seed twice and confirm identical results, including the anomaly events.

**Acceptance Scenarios**:

1. **Given** the same scenario, algorithm, hyperparameters, and seed, **When** run twice, **Then** the decision trace is identical.
2. **Given** the seed is re-rolled, **Then** the anomaly-event pattern changes, but the run remains reproducible under the new seed.
3. **Given** a hyperparameter left at default, **Then** its value comes from the package definition (no hidden fallback), and the overrides view lists only changed values.

---

### User Story 4 - Compare two algorithms on one signal contract (Priority: P3)

Both the Hybrid and NRI algorithms consume the same coherent, shared signal set. The reviewer runs each on the identical scenario and compares outcomes.

**Why this priority**: Cross-algorithm review is a core purpose of the tool, but it depends on Stories 1–3 landing first.

**Independent Test**: Run Hybrid and NRI on the same scenario; confirm both draw from the same signal set and complete.

**Acceptance Scenarios**:

1. **Given** a scenario, **When** Hybrid and NRI run on it, **Then** both draw from the same shared signal set.
2. **Given** NRI, **Then** its realtime fatigue term is active because drowsiness/fatigue exist as signals.

---

### Edge Cases

- **No trigger** fires within a run → the instant timeline shows "no trigger" with peak score vs threshold (not a blank or an error).
- Reviewer edits a hyperparameter to an **out-of-range** value → it is validated and blocked or clamped with visible feedback; the instant result never runs on invalid input.
- Scenario with **no rest spot ahead** → rest-window / rest-scarcity features resolve without error; the timeline shows no rest marker.
- **Re-roll seed** mid-setup → the instant result updates deterministically to the new seed.
- An **algorithm error** during the instant preview → shown as an explicit error state, never a fabricated normal trigger result.
- Loading a **legacy scenario** authored before the tier re-design → rejected with a clear "incompatible — re-author" error; never silently mis-read (no auto-migration).

## Requirements *(mandatory)*

### Functional Requirements

**Signals & tiers**

- **FR-001**: The system MUST organize every raw signal into exactly one of three named tiers — **Fixed** (scenario constants), **Dynamic** (observable dynamics), **Simulated** (values the simulator derives) — replacing the single undifferentiated signal set.
- **FR-002**: The system MUST expose all signals (all tiers) to each algorithm; each algorithm decides which to use.
- **FR-003**: Simulated signals MUST consist of the derived driver-state values (`drowsiness`, `fatigue`) plus exactly one stochastic behavioral-anomaly signal (`anomaly_rate`). The previously fabricated deterministic vehicle sensors (steering, pedal, lane-departure, ADAS) and the `attention` signal MUST be removed.
- **FR-004**: The anomaly signal MUST be produced by a seeded random (point-process) generator whose event rate increases with driver drowsiness, such that identical (scenario, seed) inputs reproduce identical anomaly events.

**Determinism & reproducibility**

- **FR-005**: Each run MUST freeze a seed at start; replaying or re-running with the same setup and seed MUST reproduce a byte-identical decision trace.
- **FR-006**: No source of randomness other than the seeded anomaly generator may affect results.

**Algorithms**

- **FR-007**: The Hybrid algorithm MUST be re-defined to consume only the shared signal set (a compact feature set with no route look-ahead inputs), while its scoring, smoothing, state-machine, fire-control, and priority behavior are otherwise preserved in structure.
- **FR-008**: The NRI algorithm MUST remain behaviorally as-is; its realtime fatigue term becomes active because `drowsiness`/`fatigue` now exist as signals.
- **FR-009**: Hyperparameter and feature defaults MUST live in a single authoritative place per algorithm package; algorithms MUST NOT carry hidden fallback defaults.
- **FR-010**: Any algorithm evaluation error (including during the instant preview) MUST surface as an error event and MUST NEVER be presented as a normal trigger result.

**Setup screen**

- **FR-011**: The setup screen MUST present two editing areas — **Scenario & Signals** and **Algorithm** — plus a full-width **Instant Result** area.
- **FR-012**: The Scenario & Signals area MUST show all signals grouped by tier, indicate which are editable vs read-only, and provide a plain-language explanation for each simulated signal (surfaced via an info affordance).
- **FR-013**: The Algorithm area MUST present the algorithm as its formulation, with hyperparameters editable inline as the coefficients in the formulas, and feature names cross-referenced to their source signals.
- **FR-014**: The Instant Result area MUST, on every setup change, recompute the run headlessly (no animation) and display a timeline showing the risk score vs threshold, segment context, trigger fire point(s), the rest spot, an auto-chosen rest option with its recovery window, and completion — or an explicit "no trigger" state.
- **FR-014a**: The instant-result recompute MUST be **ephemeral** — a headless evaluation that is NEVER written to `runs/`/evidence. Only the "Open full run" action creates a persisted, append-only run.
- **FR-015**: The Instant Result MUST show the run seed and the set of hyperparameter overrides (changed-from-default only), and MUST offer an action to open the full animated review with the identical configuration (which is the point at which a run is persisted).
- **FR-016**: Setup parameters MUST remain setup-time only; the instant result recomputes on change, consistent with the existing rule that a started run's parameters are immutable.

**Migration & compatibility**

- **FR-017**: The shipped scenario files MUST be rewritten in-place to the new signal-tier structure and renamed parameter groups (driver-signal params, anomaly-signal params); runs of the rewritten scenarios MUST complete end-to-end. The scenario loader MUST reject an old-shape (pre-re-design) scenario with a clear "incompatible — re-author" error rather than silently mis-reading it. No automatic migration tool is built (Constitution VI / YAGNI).
- **FR-018**: Behavioral test baselines and any cross-implementation parity fixtures MUST be regenerated to reflect the deliberately changed behavior; the change set MUST record that this behavior change is intentional.

**Out of scope (deferred, with defined return paths)**

- **FR-019**: The `attention` signal + monotony-content recovery loop, richer camera/CAN sensors, and route look-ahead signals MUST NOT be implemented in this feature; the design records how each returns later.
- **FR-020**: The **htmlapp offline build** (TS engine port + cross-implementation parity fixtures) is OUT of scope for this feature; it is deferred to a separate follow-up. This feature targets the backend and the primary `app/frontend` only.

### Key Entities

- **Raw signal (tiered)**: a named input with a tier (Fixed / Dynamic / Simulated), an editability flag, and — for simulated signals — a formulation explanation.
- **Simulated signal**: a derived value (`drowsiness`, `fatigue`) or the seeded `anomaly_rate` event stream.
- **Algorithm package**: features (formulas over signals), hyperparameters (with single-source defaults), scores, and fire-control.
- **Run configuration**: selected scenario + algorithm + hyperparameter overrides + seed, frozen at run start.
- **Instant result**: a headless, static computed outcome (score curve, fire points, rest, recovery, completion) for the current setup.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A reviewer can change a hyperparameter and see the updated firing outcome on the instant-result timeline in under 1 second, without starting a full run.
- **SC-002**: The overrides view shows 100% of changed hyperparameters and 0 unchanged ones.
- **SC-003**: Re-running an identical setup with the same seed yields an identical decision trace 100% of the time.
- **SC-004**: Every raw signal on the setup screen is attributable to exactly one tier, and every simulated signal has an explanation a non-technical reviewer can read.
- **SC-005**: Every algorithm feature shown on the setup screen can be traced to its source signal(s) without reading code.
- **SC-006**: Both algorithms run to completion on the same scenario drawing from the same signal set; NRI's realtime fatigue term is non-zero when drowsiness/fatigue are present.
- **SC-007**: No algorithm evaluation (instant or full) ever emits a normal trigger result in place of a surfaced error.
- **SC-008**: 100% of shipped scenarios load and complete a run after being rewritten to the new tier/param structure; an old-shape scenario is rejected with a clear error 100% of the time.

## Assumptions

- The **backend is the source of truth** for all signals, scores, and the instant-result computation; the setup screen's instant result is produced by the backend, not the view layer (Constitution I).
- The instant-result recompute feels immediate because the deterministic tick engine runs a full scenario in a few milliseconds (Constitution III).
- The **primary frontend** (`app/frontend`) receives the new setup screen in this feature; the **htmlapp offline build** is explicitly out of scope (FR-020) and deferred to a separate follow-up feature.
- Existing scenarios can be **mechanically migrated** to the new tier / parameter-group structure.
- The target use case remains the **UC-01 fatigue/rest** family; no new use cases are introduced.
- The "auto-chosen rest option" used by the instant preview is a **deterministic default** (e.g., the first defined recovery option) so the previewed run resolves end-to-end.
- This is a **deliberately behavior-changing** re-design; regenerating test baselines and parity fixtures is expected, not a regression.
