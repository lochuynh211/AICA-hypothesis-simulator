# Feature Specification: Proposal Preset Test-Cases + Grounded Retune + Relative-Fit Display

**Feature Branch**: `018-proposal-preset-testcases`

**Created**: 2026-07-17

**Status**: Draft

**Input**: User description: "Add a parent 'preset' concept to proposal mode that coherently sets both the situation and the driver profile as a documented test case; ship ~18 presets in 9 families with contrast pairs anchored to the real catalog; retune the content scorer's normalization bounds to the real catalog distribution; verify every preset's real outcome against its expected outcome; and show a friendlier relative score alongside the raw score."

**Authoritative design source**: `docs/superpowers/specs/2026-07-17-proposal-preset-testcases-design.md`

---

## Clarifications

### Session 2026-07-17

- Q: How should the 0–100 fit band shown next to the raw score be computed? → A: Absolute remap `(raw + 1) × 50` of the signed raw score — stable across proposals and comparable between presets (a 0.20 always shows 60), NOT relative to the current ranked set.
- Q: For a contrast pair, what counts as a "materially different" outcome the verifier asserts? → A: The top-ranked (#1) content track differs between the two presets.
- Q: How is the "strong-fit" pass threshold enforced across presets? → A: Per-preset `top_fit_min` declared in each preset's expectation contract (strong-fit presets declare ≥0.40; the cold-start control and weak-lens presets declare their own honest floor); the verifier asserts against each preset's declared value.

---

## User Scenarios & Testing *(mandatory)*

The primary actor is a **demonstrator/reviewer** — someone showing a customer (or evaluating for themselves) how the AICA service-proposal and content-proposal algorithms behave. Today they must hand-pick a situation seed and a driver-profile seed separately, with no guidance on what the pairing should demonstrate, and content scores routinely appear as low numbers (0.2–0.3) that read as "the algorithm barely likes anything."

### User Story 1 - One coherent, self-explaining preset (Priority: P1)

The demonstrator opens the proposal screen, picks a single **preset** from a selector above the existing seed controls, and immediately sees (a) a short bilingual brief stating what this case demonstrates and why, and (b) both the service ranking and the content (song) ranking updating to a coherent, on-message result — without separately choosing a situation and a driver profile.

**Why this priority**: This is the core value — it turns a two-step, unguided setup into one narrated, demonstrable action. Everything else builds on it.

**Independent Test**: Select any single preset; confirm the situation and driver profile both change together, the brief text appears, and both algorithm panels re-rank. Deliverable value stands alone even without the retune or contrast pairs.

**Acceptance Scenarios**:

1. **Given** the proposal screen with no preset selected, **When** the demonstrator selects a preset, **Then** the situation and driver profile are both set from that preset in a single action and the existing seed/profile selectors reflect the loaded values.
2. **Given** a preset is selected, **When** the panels render, **Then** a bilingual brief describing the preset's intent and expected outcome is shown, and both the service and content proposals reflect the preset's world.
3. **Given** a preset has been selected and a run is recorded, **When** the run evidence is inspected, **Then** the originating preset is identified in the run's setup provenance.

---

### User Story 2 - Contrast pairs make the algorithm's sensitivity visible (Priority: P2)

The demonstrator selects one preset of a **contrast pair**, notes the top result, then selects its partner (which changes exactly one lens — e.g. mood direction, oshi on/off, driver taste, driver age-band) and sees the top result visibly change, proving the algorithm responds to that input for a defensible reason.

**Why this priority**: "Same lens, flipped input → flipped result" is the most persuasive demonstration of a transparent algorithm and directly fulfills the request for contrast presets.

**Independent Test**: For each of the 7 designed pairs, select both members and confirm the top-ranked content candidate differs between them.

**Acceptance Scenarios**:

1. **Given** the two presets of a contrast pair, **When** each is selected in turn, **Then** their top-ranked content candidates are different and each difference is attributable to the single lens that varies between them.
2. **Given** a contrast pair, **When** the demonstrator reads each preset's brief, **Then** the briefs explain the differing expected outcomes and the reason.

---

### User Story 3 - Every preset is trustworthy (expected vs. real outcome) (Priority: P2)

Before a preset is shown to anyone, its **documented expected outcome is checked against the real measured outcome** of running both algorithms, so the demonstrator is never surprised by a preset that doesn't behave as its brief claims.

**Why this priority**: A demonstration tool that misstates its own results destroys trust. This is the "check the test case works" requirement, and it is the quality gate for the whole feature.

**Independent Test**: Run the verification suite; confirm every preset's real outcome satisfies its expectation contract and a pass/fail report is produced.

**Acceptance Scenarios**:

1. **Given** the full preset catalog, **When** the verification suite runs each preset through both real algorithms, **Then** every preset's measured top candidate, minimum top-score, ranking gradient, and expected service set match its documented expectation.
2. **Given** the verification suite has run, **When** the report is produced, **Then** it lists, per preset, the hypothesis, the expected outcome, and the real measured outcome with a pass/fail verdict.
3. **Given** a preset whose lens is structurally weak, **When** its outcome is measured, **Then** the report shows whether any per-preset adjustment was required to make the intended contrast legible, and the preset's brief discloses it.

---

### User Story 4 - Scores that communicate strength honestly (Priority: P3)

The demonstrator sees content scores that no longer read as misleadingly "low": the raw score is recalibrated to use the real catalog's range, and a clearly-labeled **fit band** (0–100, computed as an absolute remap `(raw + 1) × 50` of the signed raw score) is shown alongside the raw value so a customer can read a score's strength at a glance and compare it across presets.

**Why this priority**: Addresses the original "0.2 is too low" complaint. It is presentation/tuning polish that improves every preset but is not required for the presets themselves to function.

**Independent Test**: Open any preset with personalization; confirm the top content score is materially above the cold-start ceiling and a 0–100 fit band accompanies the raw score.

**Acceptance Scenarios**:

1. **Given** the recalibrated normalization bounds, **When** the content algorithm scores the catalog, **Then** song separation improves and the raw score of a well-matched song under a personalized preset clears a defined strong-fit threshold.
2. **Given** any content or service proposal, **When** it renders, **Then** each candidate shows both the raw signed score and a labeled 0–100 fit band computed as `(raw + 1) × 50`, with the raw value remaining authoritative.
3. **Given** the recalibration changes numeric outputs, **When** the pinned algorithm math tests run, **Then** they are updated to the new grounded values and pass.

### Edge Cases

- **Selecting a preset after manually editing seeds/profile**: the preset overwrites both situation and driver profile atomically and the child selectors re-sync (the current "reflect only while untouched" guard must not block this).
- **Preset with per-preset overrides vs. a later manual run**: overrides apply only while that preset drives the run; they never mutate the frozen package defaults or leak into other seeds.
- **Cold-start control preset**: intentionally scores low; its brief must explain *why* rather than appear broken.
- **Catalog coverage gaps**: presets must reference only genres/eras/artists that actually exist in the frozen catalog (e.g. child → anime, not near-empty children's-music).
- **A preset's real outcome fails its expectation**: the verification suite fails loudly; the preset (or its override) is corrected before ship — a failing preset is never published.
- **Malformed preset file**: an invalid preset is rejected on load with a clear error rather than silently degrading a proposal.

## Requirements *(mandatory)*

### Functional Requirements

**Preset concept & storage**

- **FR-001**: The system MUST provide a **preset** as a committed, read-only artifact that binds one situation and one driver profile into a single selectable unit.
- **FR-002**: Each preset MUST carry a bilingual (JA/EN) label and a bilingual **brief** describing what it demonstrates and the expected outcome, plus an **expectation contract** (hypothesis, expected top content characteristic, a per-preset `top_fit_min` floor, expected ranking gradient, and expected top service set). Each preset declares its own `top_fit_min` honestly: strong-fit personalization presets declare ≥0.40, the cold-start control declares its low ceiling, and structurally-weak-lens presets declare what is genuinely achievable.
- **FR-003**: Each preset MAY carry **isolated algorithm configuration overrides** that apply only when that preset is run and MUST NOT mutate the shared/global algorithm defaults or affect any other seed or preset.
- **FR-004**: Presets MUST be discoverable and loadable through the same read-only, list-and-fetch pattern already used for situation seeds and driver profiles.

**Selection & interaction**

- **FR-005**: The proposal screen MUST present a preset selector positioned above the existing situation-seed controls.
- **FR-006**: Selecting a preset MUST set the situation and the driver profile together in a single, atomic update, keeping the motion-state fields consistent, and MUST update the existing seed and profile selectors to reflect the loaded values.
- **FR-007**: On selection, the system MUST display the preset's brief and MUST re-rank both the service proposal and the content proposal from the preset's world.
- **FR-008**: When a run is recorded after a preset selection, the system MUST record the originating preset's identity in the run's setup provenance.

**The catalog of presets**

- **FR-009**: The feature MUST ship approximately 18 presets organized into the 9 designed families, including at least 7 contrast pairs, a cold-start neutral control, and a multi-lever combination case.
- **FR-010**: Every preset MUST reference only artists, genres, and eras that exist in the frozen catalog, and each contrast pair MUST vary exactly one lens between its two members.

**Retune (data-science, global)** — *the specific global knob is chosen by measurement, not assumed.*

- **FR-011**: The global content-scorer retune MUST be selected empirically: candidate levers are measured against the real catalog before one is adopted. (Measured outcome: recalibrating the loudness normalization bounds moved top scores by ≤0.005 and was **rejected**; shifting `content_category_weights` toward preference/history — `{Situation 0.45, Preference 0.35, History 0.20}`, was 0.55/0.30/0.15 — lifts known-driver scores while lowering cold-start, and was adopted.)
- **FR-012**: The retune MUST preserve the intentional directional (soothe/energize) response conflict as a transparency behavior; coherence for demonstrations is achieved through preset world design and per-preset overrides, not by globally flattening the response model.
- **FR-013**: The adopted retune MUST keep the pinned algorithm math tests passing (the chosen `content_category_weights` change does not touch the §10 mood-block anchor, so no golden values needed editing); the full existing suite MUST remain green.

**Verification (the test-case guarantee)**

- **FR-014**: The system MUST include an automated verification suite that, for every preset, runs BOTH the real service and content algorithms through the production evaluation path and asserts the preset's expectation contract (top candidate intent, the preset's declared `top_fit_min`, gradient direction, expected service set).
- **FR-015**: The verification suite MUST assert that each contrast pair yields a different top-ranked (#1) content track between its two members.
- **FR-016**: The verification suite MUST produce a human-readable report tabulating, per preset, the hypothesis, expected outcome, real measured outcome, and a pass/fail verdict; any per-preset override that was required MUST be visible.

**Score presentation**

- **FR-017**: The content and service proposal displays MUST show, for each candidate, a clearly-labeled **fit band** on a 0–100 scale computed as an absolute remap `(raw + 1) × 50` of the signed raw score, alongside the raw signed score, with the raw score remaining the authoritative value and the underlying scoring math unchanged by the display. The fit band MUST be stable for a given raw score regardless of the other candidates in the proposal.

**Scope guards**

- **FR-018**: The feature MUST NOT introduce in-app authoring/editing of presets, MUST NOT alter trigger mode, MUST NOT change the "missing weight is never redistributed" rule, and MUST NOT add or remove songs/genres in the dataset.

### Key Entities *(include if feature involves data)*

- **Preset**: A named, committed test case binding a situation + driver profile, with a bilingual label/brief, an expectation contract, an optional family and contrast-partner reference, and optional isolated algorithm-config overrides.
- **Expectation Contract**: The documented, machine-checkable claim of a preset — hypothesis, expected top content characteristic, per-preset `top_fit_min` floor, gradient direction, expected top service set.
- **Contrast Pair**: Two presets that differ by exactly one lens and are expected to produce different top outcomes.
- **Retune Parameters**: The catalog-grounded normalization bounds of the content scorer (global), plus per-preset override sets (isolated).
- **Verification Report**: The per-preset table of hypothesis · expected · real-measured · pass/fail produced by the verification suite.
- **Fit Band**: A display-only 0–100 value computed as an absolute remap `(raw + 1) × 50` of a candidate's raw score; stable for a given raw score across proposals; never replaces the raw score.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of shipped presets pass their expectation contract when run through both real algorithms (the verification suite is fully green).
- **SC-002**: Each of the 7 contrast pairs produces a different top-ranked content candidate between its two members.
- **SC-003**: Every preset's top content raw score meets or exceeds its own declared `top_fit_min`; strong-fit personalization presets declare and meet ≥ 0.40, while the cold-start control preset declares and stays at its honest baseline (≈ 0.15–0.20) with a brief that explains why.
- **SC-004**: A demonstrator can go from opening the proposal screen to a fully set, self-explained, on-message demonstration in a single selection (no separate situation+profile picking required).
- **SC-005**: For every candidate in both proposal panels, a labeled 0–100 fit band (`(raw + 1) × 50`) is shown alongside the raw score, the band is identical for equal raw scores across different proposals, and the raw scoring outputs are identical to the algorithm's computed values (display adds nothing to the math).
- **SC-006**: After the loudness recalibration, the catalog's usable arousal separation widens versus the pre-retune baseline (verified by the regression test), and all previously-passing algorithm and application tests pass after their pinned values are updated.
- **SC-007**: The verification report is regenerable on demand and shows, per preset, expected vs. real outcome with any required per-preset override disclosed.

## Assumptions

- The frozen 300-song catalog, the existing situation-seed and driver-profile mechanisms, and the production algorithm evaluation path are reused as-is; presets are a new layer on top, not a replacement.
- "≈18 presets" is a target; the final count may vary slightly as long as all 9 families and the 7 contrast pairs are represented.
- Genre-affinity behavior is exercised via presets that enable the existing opt-in genre extension; no new genre data is added.
- The fit-band scale is resolved (see Clarifications): an absolute remap `(raw + 1) × 50`, chosen over a ranked-set-relative scale so the same raw score always maps to the same band and is comparable across presets.
- The demonstrator is a single local user (consistent with the tool's single-user, no-accounts design); no multi-user or permission concerns apply.
- Per-preset overrides are expected to be needed only for structurally weak lenses (era/age-band and pure-genre families); the verification suite determines necessity empirically.

## Dependencies

- The existing frozen catalog dataset (artists, audio features, release dates) and its opt-in genre-affinity map.
- The existing service and content selector algorithms and their configuration surface (for global retune and per-preset overrides).
- The existing seed/profile read-only registries and proposal-screen left panel, whose selection/sync behavior this feature extends.
- The existing run-evidence/setup-provenance record, extended to note the originating preset.
