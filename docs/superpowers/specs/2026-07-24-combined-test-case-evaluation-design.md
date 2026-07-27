# Combined Experience Test Cases and Expected-vs-Actual Evaluation

**Date:** 2026-07-24  
**Status:** Deferred — phase 2. The review surface is superseded by
`2026-07-27-combined-rationale-review-design.md`; the contract, registry, resolver
and evidence-adapter design below remain valid.  
**Scope:** Existing Combined Simulator; trigger, service proposal, and content proposal algorithms  
**Related designs:**

- `docs/superpowers/specs/2026-07-18-merged-simulator-design.md`
- `docs/superpowers/specs/2026-07-17-proposal-preset-testcases-design.md`
- `docs/superpowers/specs/2026-07-16-proposal-p5-transparent-service-selector-design.md`
- `docs/superpowers/specs/2026-07-16-proposal-p6-content-selector-design.md`

> **Superseded for now (2026-07-27).** This design treats the expectation as an
> *input* — checkpoints are authored, then graded. The customer needs the
> expectation as an *output*: it is what human review produces. The `expectation`
> blocks in the committed presets were LLM-generated from the default algorithms,
> so they record the baseline and cannot serve as an independent reference.
>
> Phase 1 is `2026-07-27-combined-rationale-review-design.md` — baseline plus
> traceable explanation plus human judgement per parameter. Once enough ratified
> expectations accumulate from that review, this design becomes buildable and
> catches regressions and the "right output for the wrong reason" case.

## 1. Problem

The Combined Simulator already executes one real trigger → service → content journey, provides quickview and replay, correlates trigger ticks with proposal runs, and exposes detailed service/content contribution traces. However, it still behaves primarily as an interactive simulator.

The customer needs a simpler product-evaluation flow:

```text
Persona + journey test case
  → real Combined Simulator outcome
  → expected-versus-actual comparison
  → detailed explanation of why
  → evidence for improving algorithms and specifications
```

They do not need a live-review workflow, UI research, collaborative approval process, or a fine-grained tuning console. They want to select a carefully designed persona-and-journey preset, watch what the product would do, and understand whether the three algorithms produced a rational and expected experience.

The missing layer is therefore not another simulation engine. It is an executable test-case contract and an evaluator over the evidence already produced by the real Combined Simulator.

## 2. Goals

1. Provide a catalog of detailed, bilingual, committed experience test cases.
2. Bind each test case to one persona, one journey, deterministic inputs, and default algorithm configurations.
3. Run each case through the existing production trigger, service, and content paths.
4. Compare both the visible outcome and the causal reasoning with explicit expectations.
5. Detect the “right output for the wrong reason” case.
6. Explain the first divergence using recorded inputs, transformations, weights, contributions, gates, and alternatives.
7. Use controlled contrast cases to reveal simulated feature sensitivity without adding an algorithm-tuning interface.
8. Persist the exact completed evaluation shown for the resolved case so historical replay remains auditable.

## 3. Non-goals

- No test-case authoring UI. Test cases are version-controlled artifacts.
- No comments, ratings, approval states, reviewer assignments, or live-review workflow.
- No batch dashboard in the first version.
- No automatic parameter optimization or recommended numeric tuning.
- No replacement or reimplementation of any algorithm.
- No use of LLM prose as evaluation evidence.
- No claim that simulator sensitivity proves real-world causality or product validity.
- No new trigger categories beyond those supported by the current Combined Simulator.

## 4. Chosen approach

Use **Executable Combined Test Cases**.

Two smaller and larger alternatives were rejected:

- A static description beside the existing screen would be inexpensive but could not automatically detect mismatches or stale explanations.
- A full cross-persona batch dashboard would be valuable later but adds unnecessary workflow and UI before the individual test-case contract is trustworthy.

The executable contract is the smallest approach that can compare outcomes, compare reasoning, and expose meaningful feature influence.

## 5. User experience

### 5.1 Select one Experience Test Case

The Combined screen gains one selector above its existing setup controls. A single selection binds persona and journey; the user does not independently combine them.

Example:

> A-01 · Energetic music fan on a monotonous night highway

The case card shows:

- Persona story, goals, relevant preferences, and constraints.
- Journey story and important events.
- What the case is designed to test.
- Expected outcome in plain language.
- Expected causal path and important features.
- A link to its controlled contrast case, when one exists.

Selecting the case resolves and populates the existing Combined setup. The current center simulation, quickview, playback, route display, service output, and content output remain the primary experience.

### 5.2 Watch the existing simulator

The center panel continues to show the route, generated signals, trigger scores, fire points, rest lifecycle, and proposal points. Expected/actual markers are additive; they do not replace current simulator behavior.

### 5.3 Inspect expected versus actual

A compact result summary appears above the existing service and content output:

```text
Trigger     MATCH
Context     MATCH
Service     MISMATCH
Content     MISMATCH
Reasoning   MISMATCH
Overall     MISMATCH
```

Selecting a row navigates to the corresponding decision point and opens:

- Expected output.
- Actual output.
- Expected causal factors.
- Actual dominant supporting and opposing factors.
- Relevant gate, threshold, or eligibility decision.
- Leading eligible alternative, with exclusions shown separately.
- First point of divergence.

The detailed numeric trace remains authoritative. Optional deterministic or LLM-generated prose may summarize the evidence but never determines an evaluation status.

## 6. Test-case contract

### 6.1 Storage and identity

Committed cases live under:

```text
combined_contracts/test_cases/case-<slug>.json
combined_contracts/schema/combined_test_case.schema.json
```

Each case has a stable ID and semantic version. A reference uses the artifact's semantic version when that artifact has one; otherwise it pins the artifact's SHA-256 content hash. Resolution fails visibly when a required artifact has drifted or disappeared.

The run persists the fully resolved setup snapshot in addition to the references.

### 6.2 Top-level shape

```text
CombinedTestCase
├── case_id
├── schema_version
├── version
├── bilingual title and purpose
├── persona
├── journey
├── algorithm_defaults
├── hypothesis
├── checkpoints
└── contrast
```

### 6.3 Persona

The persona is an explicit review artifact, not a deduplicated driver-profile blob.

```text
Persona
├── persona_id
├── bilingual name and narrative
├── goals
├── preferences
├── constraints
├── relevant assumptions
└── version/hash-pinned proposal preset or driver-profile reference
```

Only assumptions relevant to the case are included. Decorative demographic detail with no algorithm or experience relevance is excluded. The referenced profile is resolved and frozen into the run snapshot; the test-case file does not embed a second copy of it.

### 6.4 Journey

```text
Journey
├── bilingual narrative
├── trigger scenario reference
├── route-preset reference
├── fixed seed
├── fixed simulation/reference time
├── fixed input overrides
├── important journey events
└── automatic path
```

The journey owns product context. Live-generated values such as drowsiness, fatigue, monotony, traffic, road type, motion, and time to rest continue to come from the existing trigger simulation and `merged_adapter` boundary.

`automatic path` contains only deterministic choices needed to complete the existing simulation, such as selecting rank 1, accepting or declining a rest proposal, choosing a named recovery option, and fixing sleep duration. It is not a general walkthrough language. The initial cases use the existing quickview convention of selecting rank 1 unless a case explicitly names another supported choice.

### 6.5 Algorithm defaults

The case declares the default:

- Trigger package and configuration.
- Service package and configuration.
- Content package and configuration.

These are defaults, not part of the expected product behavior. A candidate algorithm version or configuration may be substituted while retaining the same persona, journey, and expectations. Every actual package and configuration version is recorded in the evaluation report.

### 6.6 Checkpoints

Each checkpoint has a stable ID and exactly one of two scopes.

An **event checkpoint** has an unambiguous anchor such as:

- First matching trigger category.
- Nth matching trigger category.
- Arrival at the selected rest spot.
- During-rest stopped stage.
- First after-rest proposal.

An **interval checkpoint** covers a declared time or route-fraction range and asserts event cardinality, including an expected absence. For example, the alert daytime control can assert `trigger_count: {min: 0, max: 0}` over the complete journey, while another case can assert that no trigger occurs before minute 40.

Example:

```yaml
checkpoint_id: monotony_intervention
anchor:
  event: first_trigger
  category: MONOTONY_PROPOSAL

expected:
  trigger:
    category: MONOTONY_PROPOSAL
    window_minutes: [50, 70]

  service:
    top_one_of:
      - humming_karaoke
      - call_response_driving
    prohibited:
      - full_karaoke
      - live_viewing

  content:
    arousal_band: high
    familiarity: familiar_or_oshi

  proposal_context:
    trigger_purpose: inattentive_driving_prevention_recovery
    lifecycle_stage: active_driving_content

  reasoning:
    must_contribute:
      - stage: trigger
        target: selected_category
        feature_id: monotony_level
        direction: supporting
      - stage: service
        target: rank_1
        feature_id: road_type
        direction: supporting
    should_rank_top:
      - stage: trigger
        target: selected_category
        feature_id: monotony_level
        direction: supporting
    must_not_dominate:
      - stage: trigger
        target: selected_category
        feature_id: fatigue_level
```

The corresponding negative interval is a separate checkpoint:

```yaml
checkpoint_id: no_premature_intervention
interval:
  minutes: [0, 40]
expected:
  trigger_count:
    min: 0
    max: 0
```

Expected outputs use acceptable sets, ranges, predicates, and prohibitions. Exact scores or exact item IDs are used only when the case specifically tests them.

`top_one_of` evaluates the actual rank-1 result. A prohibited service must not appear in the ranked candidates; appearing only in the recorded exclusion list satisfies that prohibition. A prohibited content item or property must not appear in the emitted ordered plan. The existence of an item in the source catalog alone is irrelevant.

### 6.7 Expected reasoning

Reasoning expectations are rank- and direction-based to avoid brittle coupling to exact floating-point values:

- `must_contribute`: the stage-and-target-qualified feature is present with a non-zero contribution in its declared `supporting` or `opposing` direction.
- `should_rank_top`: the feature appears among the top three absolute contributions for that exact stage and target and has its declared direction.
- `must_not_dominate`: the feature does not appear among the top three absolute contributions for that exact stage and target.
- `must_gate`: named rule or gate must determine eligibility, suppression, or exclusion.
- `must_not_gate`: named rule or gate must not determine the result.

Targets are explicit and executable:

- Trigger: `selected_category`, a named category, or `overall_fire_control`.
- Bridge: `proposal_context`.
- Service: `rank_1`, `selected_service`, or a named candidate ID.
- Content: `position_1`, a named item ID, or a declared plan-level target.

“Top three” is always computed within the factor list recorded for that one target; factors from different candidates or stages are never mixed.

An output can match while its reasoning fails. That produces `PARTIAL_MATCH`, not `MATCH`.

### 6.8 Contrast contract

A contrast is reciprocal and executable:

```text
Contrast
├── paired_case_id
├── changed_input_path
├── baseline_value
├── variant_value
└── expected_deltas
```

`changed_input_path` points into the fully resolved Combined setup, for example `proposal_world.driver_profile.oshi_mode` or `proposal_world.driver_profile.played_items`. A contrast test verifies that this is the only resolved business input that differs between the pair. `expected_deltas` may assert a direction or minimum material change in trigger time, causal contribution, service rank, or content properties.

## 7. Unified causal evidence

The evaluator consumes a neutral explanatory projection:

```text
CausalFactor
├── stage: trigger | bridge | service | content
├── target
├── feature_id
├── source: persona | journey | generated_signal | history
├── raw_value
├── normalized_value
├── response_coefficient
├── effective_weight
├── signed_contribution
├── role: supporting | opposing | neutral
└── configuration_provenance
```

Rules and discontinuous decisions use:

```text
DecisionGate
├── stage
├── target
├── gate_id
├── evaluated inputs
├── threshold or rule
├── passed
├── effect: allow | exclude | suppress | override
└── provenance
```

Stage-specific adapters project existing evidence into these shapes:

- Trigger decision trace → trigger causal factors and fire/suppression gates.
- `merged_adapter` input/output snapshots → bridge facts showing how the trigger became proposal context.
- Service `FeatureContribution`, eligibility, and exclusion evidence → service factors and gates.
- Content item contributions, exclusions, and plan policy → content factors and gates.

The adapters are read-only. They never call an algorithm and never modify a score, ranking, threshold, or persisted source record.

Where the trigger trace lacks data needed for an asserted reasoning check, the trace contract is extended additively. The evaluator must return `UNVERIFIABLE` until required evidence exists; it must not infer missing factors from human-readable prose.

Comparable alternatives use one canonical shape:

```text
DecisionAlternative
├── stage
├── target_id
├── rank or score
├── delta_to_winner
└── evidence_reference
```

The leading alternative is the highest-ranked eligible non-winner: the highest-scoring non-selected trigger category, rank-2 service candidate, or next eligible content item after the inspected item. If no comparable eligible alternative exists, the report says so and shows exclusions separately; it does not pretend that an excluded candidate has a comparable score.

## 8. Evaluation report

```text
EvaluationReport
├── report_version
├── evaluator_version
├── test_case_id and version
├── run or quickview-projection identifiers
├── resolved artifact and algorithm versions
├── overall_status
├── checkpoint_results
├── first_divergence
├── evidence_references
└── contrast_delta, when applicable
```

Each check result contains:

- Stage and expectation ID.
- Expected value or predicate.
- Actual value.
- Status.
- Short deterministic explanation.
- Evidence references into the trigger trace, proposal evidence, or correlation record.

### 8.1 Status semantics

- `MATCH`: every required output, proposal-context, and reasoning assertion passed.
- `PARTIAL_MATCH`: every required output and proposal-context assertion passed, but at least one reasoning assertion failed.
- `MISMATCH`: at least one required output or proposal-context assertion failed, regardless of its reasoning result.
- `NOT_EVALUATED`: the stage could not occur because an expected upstream event did not occur.
- `EXECUTION_ERROR`: an algorithm or orchestration operation failed.
- `UNVERIFIABLE`: the run completed but required evidence is absent or ambiguous.

`NOT_EVALUATED` is a per-check state. If an expected upstream event is absent, that absence is a `MISMATCH`; dependent checks are `NOT_EVALUATED`.

Overall aggregation is deterministic:

1. Any `EXECUTION_ERROR` → `EXECUTION_ERROR`.
2. Otherwise, any output/context `MISMATCH` → `MISMATCH`.
3. Otherwise, any required `UNVERIFIABLE` → `UNVERIFIABLE`.
4. Otherwise, any reasoning `MISMATCH` → `PARTIAL_MATCH`.
5. Otherwise → `MATCH`.

### 8.2 First divergence

The report identifies the earliest mismatch in journey order and then in stage order:

```text
trigger → trigger-to-proposal mapping → service → content
```

It identifies relevant evidence and configuration keys but does not prescribe a replacement numeric value.

## 9. Feature sensitivity through contrast cases

Each contrast pair changes exactly one declared business-level input while holding every other resolved input, the seed, and the algorithm configuration constant.

The contrast report shows:

```text
Changed input
  → changed causal contribution
  → trigger-time delta
  → service-rank delta
  → content-result delta
```

This is labeled **simulated sensitivity**, not global feature importance or real-world causality.

For a single case, “important” means one of:

- A top-three absolute contribution.
- A gate that changed eligibility or suppression.
- A factor whose controlled contrast changed a required outcome.

No SHAP-style global explanation or combinatorial sensitivity search is required.

## 10. Architecture

### 10.1 Backend units

**`CombinedTestCaseRegistry`**

- Scans and validates committed case files.
- Returns list summaries and full case records.
- Has no dependency on algorithm implementations.

**`CombinedTestCaseResolver`**

- Resolves and version-checks scenario, route, profile/preset, and package references.
- Produces the existing merged-create and quickview input shapes.
- Freezes the resolved setup snapshot.

**`CausalEvidenceAdapter`**

- Projects recorded trigger/service/content evidence into neutral causal evidence.
- Has one isolated adapter per stage.

**`CombinedTestCaseEvaluator`**

- Purely compares one resolved contract with one completed quickview evidence snapshot.
- Produces an `EvaluationReport`.
- Never invokes or reimplements an algorithm.

### 10.2 API surface

Add:

```text
GET /api/merged-test-cases
GET /api/merged-test-cases/{case_id}
```

The detail endpoint returns a `ResolvedCombinedTestCase`: the validated contract, its resolved existing Combined setup, and resolution/version metadata. This is the single source used by the frontend selector.

Add optional `test_case_id` and `test_case_version` fields to the existing merged quickview and create requests. A completed quickview response gains an optional `evaluation_report`.

Completed quickview is the authoritative evaluation path. When an official live run is created, the backend resolves and evaluates the same deterministic quickview once more with the frozen setup and seed, persists that report, and then starts normal playback. Tick and proposal-action responses do not continuously reevaluate the case.

### 10.3 Persistence

The merged-run record gains optional additive fields:

```text
test_case_ref
resolved_test_case_snapshot
evaluation_evidence_snapshot
evaluation_report
```

`evaluation_evidence_snapshot` contains the immutable quickview evidence addressed by the report's evidence references; the report never points at a later live-run event merely because it looks equivalent. Historical replay renders the persisted completed-quickview report and its own evidence snapshot. Recalculation against a newer test-case or evaluator version requires an explicit future migration tool and is outside this scope.

### 10.4 Frontend units

**`ExperienceTestCaseSelector`**

- Lists cases and applies one resolved case to the scoped run/proposal stores.

**`ExperienceTestCaseCard`**

- Shows persona, journey, hypothesis, expected causal path, and contrast link.

**`ExpectedActualSummary`**

- Shows stage statuses and navigates to relevant simulator evidence.

**`CausalComparisonPanel`**

- Shows expected versus actual factors, gates, alternatives, and first divergence.
- Reuses existing `ReasonBreakdown`, service explainability, and content explainability.

**`TriggerReasonBreakdown`**

- Brings trigger explanation to the same input → normalization → contribution → threshold/gate grammar as service and content.

The existing Combined center simulation and proposal output remain structurally intact.

## 11. Data flow

1. The frontend fetches the test-case catalog.
2. The user selects one case.
3. The resolver validates references and applies persona/journey inputs to the existing setup.
4. The existing merged quickview runs the real trigger, adapter, service, and content pipeline.
5. Stage adapters normalize the evidence that the real pipeline recorded.
6. The evaluator compares the evidence with checkpoint expectations.
7. The quickview response returns its report for immediate display.
8. Starting official playback causes the backend to reproduce and persist the same completed quickview evaluation with the frozen setup and seed, then creates the merged run.
9. Live playback navigates through the already evaluated decisions and existing evidence; it does not run a second incremental evaluation subsystem.
10. The persisted report and its immutable evaluation-evidence snapshot support faithful replay.

## 12. Editing behavior

Persona and journey inputs are locked in an official test-case run. Editing either switches the screen to **Ad hoc mode** and disables authoritative expected/actual status because the contract no longer describes the inputs.

Algorithm packages and configurations remain replaceable candidate implementations. The selected test case and expectations stay active, and the actual algorithm/configuration versions are recorded.

Making a manual service, rest, or journey choice that differs from the case's declared automatic path also switches playback to Ad hoc mode. The completed quickview report remains visible as a labeled reference, but it is not presented as the evaluation of the divergent path.

Returning all persona and journey inputs to the exact resolved snapshot restores official test-case mode.

## 13. Initial test-case catalog

The first catalog contains six complete journeys and two controlled contrast pairs. A pair is stored as two independently runnable case artifacts, so the initial catalog contains ten artifacts:

| ID | Case | Primary purpose |
|---|---|---|
| C-01 | Alert daytime control | Confirm there is no premature trigger or proposal |
| C-02 | Night highway drowsiness | Verify rest-trigger timing and safety-oriented proposals |
| C-03 | Monotonous highway, low fatigue | Verify monotony rather than fatigue causes an interactive intervention |
| C-04 | Mountain road, high workload | Verify distracting moving services are excluded |
| C-05 | Late-night traffic jam | Expose conflicts among fatigue, monotony, calming, and energizing responses |
| C-06 | Full rest lifecycle | Verify before-rest → stopped/rest → after-nap proposals remain coherent |
| X-01A | Oshi enabled | Personalization side of the safety-preserving contrast |
| X-01B | Oshi disabled | Control side of X-01; differs only in oshi mode |
| X-02A | Recent-play history present | Verify the history penalty prevents irrational repetition |
| X-02B | Recent-play history absent | Control side of X-02; differs only in recent-play history |

All cases include:

- Bilingual customer-facing narrative.
- Fixed seed, fixed reference time, and versioned artifact references.
- At least one expected-output assertion.
- At least one expected-reasoning assertion.
- At least one forbidden or negative assertion.
- A human-readable explanation of why the expected behavior is rational.

The catalog deliberately covers positive, negative, boundary, conflict, lifecycle, and controlled-contrast behavior.

## 14. Failure behavior

- Missing expected fire: trigger `MISMATCH`; dependent service/content checks `NOT_EVALUATED`.
- Unexpected extra fire: separate trigger mismatch tied to that event.
- Interval cardinality outside its declared minimum/maximum: `MISMATCH`, with references to every offending event.
- Multiple possible anchors: use the checkpoint’s declared first/nth rule; unresolved ambiguity is `UNVERIFIABLE`.
- Algorithm exception: `EXECUTION_ERROR`, never an ordinary mismatch.
- Missing required trace: `UNVERIFIABLE`, never a pass.
- Missing or drifted referenced artifact: case is unavailable and cannot start.
- Unsupported proposal stage or service: evaluate against the case’s explicit expectation; do not fabricate content.
- Edited persona or journey: Ad hoc mode.
- Matching output with different dominant causes: outcome check `MATCH`, reasoning check `MISMATCH`, overall `PARTIAL_MATCH`.

## 15. Prerequisite correctness work

Before reports are described as authoritative:

1. Fix merged quickview so content parameters and hyperparameters used by the UI reach quick-check content dispatch.
2. Ensure live merged logs and replay can reference every correlated proposal run, not only the currently displayed proposal log.
3. Confirm trigger evidence records every feature and gate asserted by the initial cases.
4. Remove stale inferred-persona counts and stop discarding preset hypothesis/expectation metadata when resolving a test case.

These are targeted correctness prerequisites, not unrelated refactoring.

## 16. Verification strategy

### 16.1 Contract tests

- Validate every committed case against JSON Schema and the backend model.
- Validate artifact references and expected versions/hashes.
- Reject ambiguous checkpoint anchors, invalid interval/cardinality scopes, and empty required expectation groups.

### 16.2 Evaluator unit tests

- Cover every status and aggregation precedence rule.
- Cover absent expected events, extra events, ambiguous anchors, missing evidence, and algorithm errors.
- Assert “matching output, mismatching reason” becomes `PARTIAL_MATCH`.
- Assert dependent checks become `NOT_EVALUATED` after an upstream mismatch.

### 16.3 Evidence-adapter tests

- Prove each field is copied from recorded evidence without recomputation.
- Verify service/content contribution parity with current explanation panels.
- Verify trigger thresholds, suppression, and contributions retain their source semantics.

### 16.4 Production-path integration tests

- Run every committed case through the real merged production path.
- Assert acceptable sets, ranges, predicates, causal rankings, and prohibitions.
- Avoid exact floating-point assertions except for tests explicitly targeting formula math.
- Preserve the full evaluation report as a test artifact for diagnosis.

### 16.5 Contrast tests

- Assert exactly one declared business-level input differs within each contrast pair.
- Assert both cases carry reciprocal pair IDs and the same declared `changed_input_path`.
- Assert the expected causal contribution changes in the expected direction.
- Assert any required behavioral delta is material and reported.

### 16.6 Frontend tests

- Test selection and automatic setup resolution.
- Test the case card and expected/actual summary.
- Test navigation from a mismatch to recorded evidence.
- Test Ad hoc mode and restoration to the resolved snapshot.
- Test authoritative quickview, official playback reference, Ad hoc divergence, persisted replay, error, and unverifiable states.

## 17. Implementation boundaries

This design is suitable for one implementation plan split into vertical slices:

1. Correctness prerequisites plus contracts, registry, and resolver.
2. Neutral causal evidence and pure evaluator with C-01/C-03.
3. Combined-screen selector, case card, expected/actual summary, and persistence.
4. Full initial catalog, causal comparison, contrast deltas, and replay coverage.

Each slice must leave existing Trigger, Proposal, and Combined behavior backward-compatible when no test case is selected.

## 18. Acceptance criteria

1. A user can select one detailed persona-and-journey test case with one action.
2. The existing Combined Simulator runs that case through all three real algorithms.
3. The UI displays expected and actual trigger, service, content, and reasoning outcomes.
4. Every mismatch links to recorded numeric or rule evidence.
5. Correct output caused by unexpected dominant features is not reported as a full match.
6. Missing evidence cannot produce a passing result.
7. Historical replay shows the original test case, algorithm versions, and evaluation report.
8. A controlled contrast explains which changed input altered which simulated decisions.
9. No evaluator or explanation component changes algorithm scores, rankings, or gates.
10. An observer can identify the first divergence and relevant feature/parameter provenance without reading source code.
