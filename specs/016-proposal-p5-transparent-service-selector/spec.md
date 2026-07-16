# Feature Specification: P5 — Transparent Service-Selector Package

**Feature Branch**: `proposal-p5-transparent-service-selector`

**Created**: 2026-07-16

**Status**: Draft

**Input**: Milestone P5 of `docs/master/aica_proposal_simulator_milestones.md` §7. Approved design: `docs/superpowers/specs/2026-07-16-proposal-p5-transparent-service-selector-design.md`. Authoritative math: `docs/master/aica_transparent_service_proposal_algorithm.md`.

## Clarifications

### Session 2026-07-16

- Q: Where should the `confidence_shrinkage_v1` toggle live — an algorithm hyperparameter, a run-level `enabled_feature_extensions` entry, or a driver-profile/world flag? → A: An algorithm hyperparameter of the transparent service package (a boolean in the package definition, editable in the Panel ③ algorithm-parameter surface), because it describes algorithm behavior rather than a property of the world/driver; the World and driver-profile contracts stay unchanged, and its on/off value is persisted with the run's resolved hyperparameters.

## User Scenarios & Testing *(mandatory)*

The "user" is a **reviewer** of AICA proposal algorithms using the standalone 4-panel Proposal Simulator. Today, Panel ③ (service proposal) is driven by a fixed mock that returns the same illustrative ranking regardless of the world. This feature replaces the mock with a real, transparent, fully inspectable service scorer.

### User Story 1 — Rank eligible services with a real, inspectable score (Priority: P1)

A reviewer picks the transparent service-selector package, chooses a purpose/stage and a world (driver state, environment, passengers, preferences, history), and runs the service step. Panel ③ shows up to three ranked eligible services, each with a real signed score (`service_fit ∈ [−1,+1]`) and a complete feature-by-feature breakdown of how the score was reached, drawn only from the frozen allowed-service set the eligibility step produced.

**Why this priority**: This is the milestone's core deliverable and the first meaningful customer demonstration of the central proposal idea — a real, expert-scorecard ranking that a reviewer can trust and inspect. Without it, the proposal screen only shows a mock.

**Independent Test**: Configure the inattentive-driving worked-example world, run the service step, and confirm Panel ③ ranks the eligible driving services by real `service_fit` with the top candidate's total reproducing the documented worked example (`humming_karaoke ≈ +0.772`), and that every ranked candidate lists only services from the eligible set.

**Acceptance Scenarios**:

1. **Given** a purpose/stage and a world snapshot, **When** the reviewer runs the service selection with the transparent package, **Then** Panel ③ shows up to three services ordered by descending `service_fit`, each with a signed score in `[−1,+1]`, and no candidate outside the eligible allowed-service set.
2. **Given** the documented inattentive-driving worked-example world, **When** `humming_karaoke` is scored, **Then** its `service_fit` reproduces the documented total within a tiny numeric tolerance and ranks above `music_playlist` on the same world.
3. **Given** two candidates with an exactly equal `service_fit`, **When** the ranking is produced, **Then** the tie is resolved by ascending candidate identifier (deterministic order).
4. **Given** a world where the eligible service list is empty (every allowed service was excluded upstream), **When** the service step runs, **Then** the result is "no proposal" with an empty ranking and no fabricated candidate.

### User Story 2 — Read the reasoning behind each ranking (Priority: P1)

For any ranked service, the reviewer can see exactly why it scored the way it did: each of the 17 baseline features shows its raw world value, the normalized evidence, the candidate's response to that evidence, the feature's effective weight, and the resulting contribution — plus the Situation / Preference / History subtotals, the strongest supporting and opposing features, and a safety-dominance readout. The reviewer can answer "why is A ranked above B?" without reading any code.

**Why this priority**: Transparency and explainability are the entire point of the "transparent" package; a score with no visible arithmetic delivers no review value.

**Independent Test**: Expand a ranked candidate's breakdown and confirm every one of the 17 features appears with its value → evidence → response → weight → contribution row and a provenance label, the three subtotals reconcile to the score, and the dominance readout states whether the material-safety separation is preserved.

**Acceptance Scenarios**:

1. **Given** a ranked candidate, **When** the reviewer expands its breakdown, **Then** all 17 baseline features are listed, each with raw value, normalized evidence, response coefficient (as a real number, not a class code), effective weight, contribution, and a source/hypothesis/override provenance label.
2. **Given** a ranked candidate, **When** the breakdown is shown, **Then** the Situation, Preference, and History subtotals reconcile to the candidate's `service_fit` within tolerance, and the strongest supporting and opposing contributions are named.
3. **Given** any built-in configuration, **When** a ranking is produced, **Then** a dominance readout reports whether the material driver-state-plus-environment-plus-recovery advantage cannot be overturned by all lower-priority evidence, showing the preserved/not-guaranteed status and the safety share (~79% for defaults).
4. **Given** a service that the source material does not name as preferred for a feature, **When** its response to that feature is shown, **Then** it is neutral (0), never a fabricated negative.

### User Story 3 — Tune the hypothesis and see the explanation change (Priority: P2)

Before a run, the reviewer edits the algorithm's weights, purpose multipliers, or response coefficients and starts a new run; the ranking and the per-feature explanation change accordingly, and the edited values are recorded in the run's evidence alongside the resolved (normalized) values.

**Why this priority**: The package exists to let a reviewer test hypotheses, not just observe one fixed scorecard. This is the "expert can modify the model" acceptance criterion.

**Independent Test**: Run the same world twice — once with default weights and once with the route-context weight raised — and confirm the ranking of route-preferred services (music/humming) shifts, with both the entered and resolved weights visible in each run's evidence.

**Acceptance Scenarios**:

1. **Given** a world and the default configuration, **When** the reviewer raises the route-context importance and re-runs, **Then** route-preferred services move up in the ranking and the changed contribution is visible in the breakdown.
2. **Given** an edited configuration, **When** the run is recorded, **Then** the evidence contains both the reviewer-entered values and the resolved normalized weights, plus the configuration versions.
3. **Given** an edit that breaks the material-safety separation, **When** the run is produced, **Then** the ranking still evaluates but the dominance readout reports "not guaranteed" with the required gap — the system never silently alters the reviewer's weights.

### User Story 4 — Optionally weaken sparse history via confidence (Priority: P3)

A reviewer who wants sparse synthetic acceptance/recovery history to count for less can enable a confidence-shrinkage option — a boolean algorithm hyperparameter of the transparent service package, edited in the Panel ③ algorithm-parameter surface before a run. With it off (the default), the ranking is exactly the documented baseline; with it on, a low-confidence acceptance or recovery rate influences the ranking less than an identical high-confidence rate, and the change is visible in the evidence.

**Why this priority**: An explicitly requested capability, but secondary to the core scorecard; it is an opt-in refinement that must not disturb the frozen baseline.

**Independent Test**: Run a world with a low-confidence and a high-confidence candidate that have identical acceptance rates; confirm that with the option off both contribute identically, and with the option on the low-confidence candidate contributes less.

**Acceptance Scenarios**:

1. **Given** the confidence-shrinkage option is off, **When** any world is scored, **Then** the result is identical to the documented baseline (the two confidence fields are marked available-but-not-used).
2. **Given** the confidence-shrinkage option is on and two candidates share an identical acceptance rate, **When** they are scored, **Then** the candidate with lower confidence has a smaller acceptance contribution, and the shrink is shown with its provenance in the breakdown.

### Edge Cases

- **Missing candidate history** (no acceptance/recovery/usage entry for a service): the feature contributes zero, is marked "missing/neutral", and weight is never redistributed or fabricated into positive/negative evidence.
- **Present raw value of 0** on a 0–100 feature is a valid low value, not treated as missing.
- **Unknown route/destination tag** (syntactically valid, not in the taxonomy): does not count toward recognized tags and is reported as an unused-available feature.
- **Stopped-lifecycle snapshot**: during-rest and post-rest stages reset traffic/road/monotony per the stopped-snapshot rule; the selector must not retain pre-stop congestion, road, or monotony.
- **Invalid input** (wrong type, out-of-range number, unsupported enum, contradictory oshi state, non-finite configurable value, all-zero sibling weight group, zero active-weight denominator): blocks evaluation with a typed error and is recorded as an algorithm error event — never coerced into a normal ranking.
- **Low or negative `service_fit`**: never suppresses a proposal; every eligible candidate is always ranked (the upstream trigger already established the opportunity).
- **Candidate returned outside the eligible set**: downgraded to an algorithm error, never persisted or shown as a legitimate recommendation.

## Requirements *(mandatory)*

### Functional Requirements

**Package & ranking**

- **FR-001**: The system MUST provide a new transparent service-selector package that ranks eligible service candidates using the documented expert scorecard, and MUST make it selectable in the service-selector slot as the default while retaining the existing mock as a selectable regression fixture.
- **FR-002**: The package MUST compute each candidate's score as the documented symbol chain — for every feature, evidence × candidate response, clamped, scaled by the feature's normalized effective weight, summed to `service_fit ∈ [−1,+1]`.
- **FR-003**: The package MUST score exactly the 17 CDC-SU baseline features and MUST NOT let purpose, lifecycle stage, eligibility, catalog, motion/screen/readiness, UI/run state, or any other package's score enter `service_fit`.
- **FR-004**: The package MUST implement the documented candidate response matrices for the driving, road-type, during-rest, and post-rest families, including all five post-rest candidates (including `call_response_stopped`); each candidate × feature cell MUST carry a real coefficient in `[−1,+1]`, a provenance label, and a source reference or explicit hypothesis label.
- **FR-005**: The package MUST resolve effective weights by multiplying category × subgroup × leaf, applying the per-purpose subgroup multipliers, and normalizing so weights sum to 1; lifecycle stage MUST NOT select a different weight set.
- **FR-006**: The package MUST return up to three ranked candidates ordered by descending `service_fit` with ascending candidate identifier as the tiebreak, and MUST return "no proposal" only when the eligible candidate list is empty.
- **FR-007**: The package MUST draw ranked candidates only from the eligible allowed-service set supplied to it; a candidate outside that set MUST be rejected as an algorithm error, never presented as a recommendation.

**Eligibility, safety & advisory behavior**

- **FR-008**: Hard eligibility (purpose/stage matrix ∩ motion/capability/readiness) MUST be applied before scoring and MUST NOT be reversible by any score or weight; excluded services MUST be retained with platform reason codes and carry no score.
- **FR-009**: The package MUST compute and record the continuous dominance status after every configuration resolve, reporting "preserved" or "not guaranteed" with the required gap; every built-in configuration MUST satisfy the invariant, and a configuration that violates it MUST still evaluate (never silently altered).
- **FR-010**: The package MUST remain advisory: a low or negative `service_fit` MUST NOT suppress a candidate or the proposal.
- **FR-011**: `trigger_purpose` and `lifecycle_stage` MUST be treated as explicit control inputs and MUST NEVER be converted into preference/utility feature scores.

**Explainability & evidence**

- **FR-012**: For each candidate × feature the system MUST record the documented explainability row: feature id, source reference, raw value, normalization function, normalized evidence, response coefficient + provenance, normalized feature response, hierarchy path, base weight, purpose multiplier, effective weight, feature contribution, and status.
- **FR-013**: For each candidate the system MUST record `service_fit`, the Situation/Preference/History subtotals (which reconcile to the score within tolerance and are never additional sort keys), the strongest supporting and opposing contributions, missing/unknown inputs, response provenance, and the configuration versions.
- **FR-014**: The system MUST mark every feature contract row (independent Spec §8 / Appendix A.1 table) as used or available-but-not-used, distinguishing CDC-SU baseline rows from enabled Additional-proposed rows by provenance, and MUST never silently drop a contract row.
- **FR-015**: The persisted run evidence MUST record inputs, configuration (dataset/algorithm/parameter-set versions), output, and the reviewer action, and MUST separate simulator facts from any human-review commentary.
- **FR-016**: Panel ③ MUST render the real trace for a ranked candidate — score, the three subtotals, strongest supporting/opposing features, the dominance readout, and an expandable per-feature contribution table — bilingually with Japanese as the default presentation language.

**Configuration**

- **FR-017**: All structural parameters (response matrices, ordinal/recency maps, scene taxonomy, tie-breaker, material-safety gap) and numeric hyperparameters (hierarchy weights as ratios, purpose multipliers, normalization exponents, tag saturations, monotony bin thresholds, safety-share warning floor, response-coefficient overrides) MUST be externalized to the package definition and be reviewer-editable before a run; a missing configuration key MUST surface as an invalid-configuration error, never a silent default.
- **FR-018**: Setup-time-only mutation MUST hold: configuration is editable before a run starts; changing it requires a new run; the resolved normalized values MUST be recorded beside the reviewer-entered ones.

**Confidence-shrinkage extension**

- **FR-019**: The system MUST provide an opt-in, off-by-default confidence-shrinkage extension, controlled by a boolean hyperparameter of the transparent service package (not a world/driver-profile field and not a run-level feature-extension entry). When off, the result MUST be byte-for-byte identical to the documented baseline and the two acceptance/recovery confidence fields MUST be marked available-but-not-used.
- **FR-020**: When the confidence-shrinkage extension is on, acceptance and recovery evidence MUST be shrunk toward neutral by its confidence value (a missing confidence value treated as full confidence and disclosed), so that a lower-confidence rate influences the ranking less than an identical higher-confidence rate, and the shrink MUST be shown with its provenance in the breakdown.

**Determinism & isolation**

- **FR-021**: Identical frozen inputs and configuration versions MUST reproduce an identical ranking and evidence (within the documented numeric tolerance); same-runtime canonical replay MUST be byte-equivalent. The selector MUST be deterministic and stateless (no carried runtime state, no uncertainty value).
- **FR-022**: The package and all proposal code MUST remain isolated from the trigger simulator (no trigger-model imports); the trigger simulator and its tests, and the existing proposal test suite, MUST continue to pass.
- **FR-023**: The output MUST NOT describe `service_fit` as an acceptance probability, recovery probability, or safety certification anywhere in evidence or presentation.

### Key Entities

- **Transparent service-selector package**: the ranking algorithm plus its externalized configuration (weights, multipliers, response matrices, maps, thresholds); selectable in the service slot; the authority for `service_fit`.
- **Service candidate response profile**: one stable response profile per service identity — its coefficient for each of the 17 features, with provenance; independent of purpose and stage.
- **Effective weight set**: the per-purpose normalized weights derived from the hierarchy and purpose multipliers, summing to 1.
- **Ranked candidate**: a service with its `service_fit`, rank, subtotals, dominance readout, support/oppose summary, and the per-feature contribution rows.
- **Feature contribution row**: one feature's value → evidence → response → weight → contribution, with provenance and status.
- **Dominance readout**: the material-safety separation status (preserved / not guaranteed), the safety share, and the required gap.
- **Confidence-shrinkage extension**: the opt-in, off-by-default modifier that shrinks sparse acceptance/recovery evidence by its confidence.
- **Run evidence**: the append-only record of inputs, configuration versions, output, and reviewer action for a service-selection run.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For the documented inattentive-driving worked-example world, the transparent package reproduces the documented top-candidate `service_fit` within a numeric tolerance of 1e-12 and ranks it above the low-scoring alternative.
- **SC-002**: 100% of ranked candidates are members of the eligible allowed-service set; no run ever presents a candidate outside it.
- **SC-003**: For every built-in configuration and every default purpose, the effective weights sum to 1 and the material-safety dominance invariant holds (and is reported).
- **SC-004**: Every ranked candidate exposes all 17 feature contribution rows, and the Situation/Preference/History subtotals reconcile to `service_fit` within 1e-12.
- **SC-005**: Every feature contract row appears in the evidence marked used or available-but-not-used; 0 rows are silently dropped.
- **SC-006**: Re-running an identical frozen world + configuration reproduces an identical ranking and evidence (byte-equivalent on the same runtime).
- **SC-007**: A reviewer editing a weight/multiplier/response coefficient before a run produces a visibly different ranking and/or explanation, with both entered and resolved values recorded.
- **SC-008**: With the confidence-shrinkage extension off, results are identical to the baseline for the full test corpus; with it on, an identical acceptance rate contributes strictly less at lower confidence.
- **SC-009**: The existing proposal test suite (838 tests at baseline) and the trigger simulator tests remain green; no proposal code imports the trigger models.
- **SC-010**: The documented 13 one-field contrast scenarios each produce the documented reorder direction.

## Assumptions

- The frozen purpose/stage matrix (5 post-rest services, including `call_response_stopped`), the service-capabilities artifact, and the eligibility resolver from P4 are present and authoritative; P5 consumes them and does not re-implement eligibility.
- The typed World / driver-profile snapshot from P3 already supplies every Appendix A.1 service feature; the backend context builder already delivers this snapshot to the selector, and the eligibility-narrowed allowed-service set is already handed to the selector — the router wiring is reused unchanged.
- The authoritative math document supersedes any placeholder scoring elsewhere; where the milestone document and the algorithm document diverged on confidence shrinkage, the resolution recorded in §17 (opt-in, off-by-default extension) governs.
- The neutral service-selector output contract can be extended with optional fields without breaking the existing mock or other consumers.
- The Proposal Simulator remains a standalone, single-user, local tool; the service and content selection remain separate algorithms and separate packages sharing contracts, never scores.
- htmlapp contains no proposal-simulator screen, so no htmlapp synchronization is required for this milestone.
- Japanese is the default presentation language; English is the fallback.
