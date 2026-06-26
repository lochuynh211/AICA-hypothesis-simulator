# AICA Hypothesis Simulator — System Specification Draft v3

**Document status:** Draft specification  
**Primary audience:** Technical, algorithm, product-planning, and UX reviewers  
**Purpose:** Define AICA Hypothesis Simulator as a configurable, evidence-producing review environment for AICA trigger hypotheses.  
**Source context:** Japanese PowerPoint `AICA_proposed_system_en.md`, translated planning notes, four AICA use cases, and prototype skeletons under `others/`.  
**Naming rule:** Product screens, APIs, documents, and implementation labels shall use **AICA** only.

---

## 1. Executive Summary

AICA is an in-car AI proposal concept that monitors driving context, driver state, route context, user context, and external conditions, then proposes appropriate actions or content such as rest guidance, wakefulness support, fatigue recovery content, monotony-prevention content, route-based music, or child-passenger content.

The AICA Hypothesis Simulator lets reviewers experience how a selected AICA trigger hypothesis behaves in a simulated driving scenario, inspect the decision evidence behind each AICA action, and record structured human feedback for requirement and algorithm refinement.

The simulator is not an autonomous algorithm judge. It does not decide that a trigger algorithm is correct, safe, optimal, or production-ready. It provides a stable technical review workflow where a human reviewer can:

1. select a hypothesis package;
2. select or configure a compatible scenario;
3. run interactive playback;
4. inspect why AICA fired, suppressed, or did not fire;
5. change allowed parameters or hyperparameters;
6. compare behavior across runs or variants;
7. record structured feedback;
8. export evidence for later requirement and algorithm refinement.

The product exists because AICA trigger design is context-dependent. Static documents can describe variables, thresholds, and proposal policy, but they cannot show reviewers how a trigger feels during a drive, whether timing appears too early or too late, whether the proposal is intrusive, or whether the explanation is understandable. The simulator makes trigger hypotheses experiential, inspectable, comparable, and reviewable.

---

## 2. Product Positioning

### 2.1 Core Product Sentence

The AICA Hypothesis Simulator is a configurable technical review environment for experiencing candidate AICA trigger hypotheses and preserving human review evidence.

### 2.2 Concept Separation

The specification separates four concepts that must not be conflated.

| Concept | Meaning |
|---|---|
| AICA concept | The future in-car assistant behavior being explored. |
| Hypothesis package | One versioned candidate definition of trigger logic, variables, hyperparameters, proposal behavior, labels, feedback schema, and evidence metrics. |
| Simulator runtime | The stable environment that loads packages, plays scenarios, calls algorithms, records traces, and exports evidence. |
| Human reviewer | The person who judges whether timing, safety impression, intrusiveness, explainability, and proposal suitability are acceptable. |

### 2.3 Core Product Principle

```text
AICA does not hardcode one trigger hypothesis.
The simulator provides a stable review workflow for many hypotheses.
The selected package defines variables, algorithms, proposals, labels, and feedback schema.
The human reviewer evaluates the experienced behavior.
The simulator records evidence; it does not declare correctness.
```

### 2.4 Technical Confidence Pillars

The simulator must provide technical confidence in three areas:

1. **Hypothesis package clarity**  
   Reviewers can identify what hypothesis is loaded, what it controls, what version produced the run, and what values were changed.

2. **Decision trace and evidence rigor**  
   Reviewers can inspect what AICA evaluated, which values mattered, which criteria passed or failed, whether fire control suppressed or allowed a proposal, and what evidence was exported.

3. **Simulator boundary clarity**  
   Reviewers can distinguish simulated values from real sensor values, package algorithm output from human review judgment, and planning evidence from production safety validation.

---

## 3. Source Interpretation And Prototype Lessons

### 3.1 Source Planning Interpretation

The source planning material describes AICA proposal behavior as three functional areas:

1. **Trigger detection and firing control**
   - Monitor input data.
   - Calculate or accumulate feature values.
   - Detect whether a proposal trigger candidate exists.
   - Decide whether to fire, suppress, or override suppression.
   - Control proposal interval, proposal density, and response to rejection.

2. **Proposal content and UX decision**
   - Select proposal category or service.
   - Decide concrete proposal content.
   - Generate AICA utterance, display content, and user options.
   - Select a proposal tone and modality appropriate to vehicle state and risk level.

3. **Content provision and ending judgment**
   - Start route guidance, content playback, rest support, or another proposed experience.
   - Judge whether content ends, continues, switches, is cancelled, or returns to previous content.

The simulator must represent all three areas at review level, but the first technical verification priority is trigger detection and fire-control behavior.

### 3.2 Hypothesis Development Loop

The source material implies this development loop:

```text
parameter consideration
→ logic-policy hypothesis consideration
→ simulator verification
→ parameter revision and detailed logic consideration
→ system requirement refinement
→ feedback to simulator
```

The AICA Hypothesis Simulator supports this loop by making hypotheses selectable, playable, inspectable, and reviewable.

### 3.3 Use-Case Source Scope

The simulator is informed by four use-case groups:

| Use case | Review value |
|---|---|
| UC-01 Fatigue / drowsiness rest proposal | Primary V1 focus. Validates dangerous-driving prevention, rest proposal timing, rest spot suitability, pre-rest wakefulness support, and post-rest recovery flow. |
| UC-02 Child passenger cabin recovery | Future expansion pressure. Validates passenger context, driver stress reduction, consent, and rear-seat content safety. |
| UC-03 Monotony / habituation recovery | Future expansion pressure. Validates soft-warning bands, monotonous route context, congestion content, and safe audio-first engagement. |
| UC-04 Attention decline recovery | Future expansion pressure. Validates gentle tone, cognitive-load-aware dialogue, and environmental adjustment. |

V1 should focus on UC-01 because it most directly exercises trigger timing, rest opportunity, fire control, proposal acceptance, and evidence review. UC-02, UC-03, and UC-04 should shape extensibility expectations but should not expand V1 beyond a manageable first release.

### 3.4 Prototype Lessons

Two prototype skeletons inform the target product.

The accepted skeleton demonstrates a customer-accepted review-room UX direction:

- route and course context;
- playback progress;
- cockpit proposal view;
- adjustable event settings;
- compact three-panel layout.

The functional skeleton demonstrates behavior value:

- parameter editing;
- scenario flow;
- trigger logic;
- generated timeline;
- map support;
- review export.

The target product should combine the accepted skeleton's clarity with the functional skeleton's configurability. It should avoid hardcoded UC/event behavior and move toward package-driven hypotheses, traceable decisions, and evidence export.

---

## 4. Stakeholders And User Roles

### 4.1 Primary Stakeholders

| Stakeholder | Role in Simulator |
|---|---|
| Product planner | Defines use cases, proposal goals, and review objectives. |
| Algorithm proposer | Defines hypothesis packages, trigger logic, features, and hyperparameters. |
| Domain expert | Reviews driver-state assumptions, safety framing, and proposal appropriateness. |
| UX planner | Reviews playback, proposal message, interaction timing, modality, and intrusiveness. |
| Requirement analyst | Converts feedback and evidence into requirement updates. |
| Test user / reviewer | Experiences playback, changes allowed values, selects options, and submits feedback. |
| Engineer | Implements the simulator runtime, package loading, algorithms, UI, and evidence export. |

### 4.2 User Roles

| Role | Main Capabilities |
|---|---|
| Hypothesis Author | Creates and versions hypothesis packages. |
| Scenario Author | Creates and versions scenario definitions. |
| Test User | Selects package/scenario, runs playback, changes allowed values, chooses options, and submits feedback. |
| Reviewer | Reviews traces, feedback, run comparisons, and exported evidence. |
| Administrator | Manages package availability, simulator configuration, and version policy. |

### 4.3 Test User Definition

A **test user** is the human who experiences simulator playback and reviews AICA behavior under a selected hypothesis. The test user may be a planner, algorithm proposer, domain expert, UX reviewer, or other evaluator.

The simulator shall optimize for the test user's review activity:

- seeing the simulated situation;
- understanding what AICA did;
- understanding why AICA did it;
- selecting options during playback;
- changing parameters or hyperparameters when permitted;
- comparing variants;
- submitting feedback.

---

## 5. Scope

### 5.1 In Scope

The simulator shall support:

- hypothesis package selection;
- multiple packages in one simulator environment;
- package validation before playback;
- compatible scenario selection;
- scenario parameter editing;
- trigger hyperparameter editing;
- manual scenario playback;
- interactive test-user choices during playback;
- algorithm evaluation at configured simulation points;
- trigger candidate judgment;
- fire-control judgment;
- suppression and override judgment;
- proposal selection and proposal display;
- decision trace display;
- structured and free-text review feedback;
- Japanese and English UI labels;
- evidence report generation;
- run comparison by package, scenario, parameter, hyperparameter, trigger timing, proposal result, action, and feedback.

### 5.2 First-Version Focus

The first version shall focus on dangerous-driving prevention through rest proposal using UC-01.

V1 shall support:

- fatigue/drowsiness hypothesis playback;
- at least one rule-based trigger package;
- at least one weighted-scoring trigger package;
- rest guidance proposal;
- rest spot acceptance or rejection;
- pre-rest wakefulness support option;
- simplified post-rest recovery option;
- fire-control logic for proposal cooldown and excessive proposal suppression;
- editable thresholds, weights, intervals, and override limits where allowed by the package;
- human feedback on timing, safety impression, intrusiveness, understandability, rest spot suitability, and proposal content suitability;
- evidence export.

### 5.3 Future Expansion Scope

The simulator shall be designed so future packages can cover:

- monotony or inattentive-driving prevention;
- familiar-road boredom prevention;
- route-based music proposal;
- scenic or oshi-related route content;
- child-passenger experience proposal;
- detailed content ending judgment;
- richer multimodal content simulation;
- optimization, state-machine, machine-learning, or external plugin algorithms.

### 5.4 Out Of Scope For V1

V1 shall not require:

- real vehicle integration;
- real CAN bus integration;
- real camera or millimeter-wave sensor processing;
- real navigation integration;
- real traffic API integration;
- real music, karaoke, video, or external app integration;
- production deployment to a vehicle;
- safety certification;
- autonomous driving control;
- medical diagnosis or health advice;
- automatic judgment that a trigger algorithm is correct or incorrect.

Optional map or route API surfaces may be used as prototype or advanced review aids, but V1 correctness shall not depend on live external services.

---

## 6. Key Concepts

### 6.1 Hypothesis

A **hypothesis** is a candidate definition of how AICA should detect a condition, decide whether to fire or suppress a proposal, select a proposal, and respond to user choices.

Example:

> If drowsiness and fatigue are increasing and the next rest opportunity is near, AICA should propose rest before the driver passes that rest opportunity.

### 6.2 Hypothesis Package

A **hypothesis package** is a versioned, runtime-selectable unit that defines the variables, calculations, algorithm, hyperparameters, proposal behavior, display labels, feedback schema, and evidence metrics used by one simulation hypothesis.

Package variability is expected. The simulator workflow must remain stable even when packages define different variables, algorithms, proposals, and feedback labels.

### 6.3 Parameter

A **parameter** is a value directly configured, selected, edited, or supplied as part of the scenario or package.

Examples:

- `drowsiness_level`
- `fatigue_level`
- `next_rest_spot_minutes`
- `driver_response_delay`
- `passenger_present`

Parameters usually describe simulated state or reviewer-configurable input.

### 6.4 Feature

A **feature** is a value calculated from parameters, scenario state, timeline events, previous run state, or package-specific logic.

Examples:

- `safe_driving_continuity_score`
- `rest_opportunity_score`
- `future_fatigue_risk`
- `proposal_intrusiveness_risk`

Features are algorithm-facing values and should be visible in the decision trace when they influence behavior.

### 6.5 Hyperparameter

A **hyperparameter** is a configurable value that controls trigger algorithm behavior but is not itself a simulated environmental or driver-state value.

Examples:

- `risk_threshold`
- `critical_risk_threshold`
- `drowsiness_weight`
- `fatigue_weight`
- `rest_opportunity_weight`
- `proposal_cooldown_minutes`
- `max_proposals_per_trip`
- `rejection_penalty_minutes`

### 6.6 Scenario

A **scenario** is a simulated driving situation containing persona, route, driver state, environment, rest opportunities, timeline events, allowed test-user interactions, and review focus.

### 6.7 Simulation Run

A **simulation run** is one execution of a selected hypothesis package against a selected scenario with selected parameter values, selected hyperparameter values, timeline state, test-user actions, trace entries, and feedback.

### 6.8 Playback

**Playback** is the visible simulation experience shown to the test user. It is generated from selected package, selected scenario, current state, algorithm decisions, and test-user choices. It is not a fixed linear video.

### 6.9 Decision Trace

A **decision trace** is the structured explanation record for algorithm evaluation. It records what AICA evaluated, which values mattered, which criteria passed or failed, whether fire control suppressed or allowed a proposal, and what AICA did.

### 6.10 Evidence Report

An **evidence report** is the exportable record of a run. It includes package version, scenario version, parameter and hyperparameter values, timeline events, decision trace, AICA proposals, test-user actions, and human feedback.

### 6.11 Review Feedback

**Review feedback** is structured and free-text input submitted by the human test user. It belongs to the human review process. The simulator stores and organizes it but does not replace the reviewer's judgment.

---

## 7. Review Workflow

The simulator shall support this stable workflow:

```text
select package
→ select scenario
→ configure scenario parameters and hyperparameters
→ run playback
→ interact with AICA
→ inspect decision trace
→ submit feedback
→ compare runs or variants
→ export evidence
```

Different packages may change available parameters, features, algorithms, proposals, labels, and feedback forms. They shall not change the fundamental workflow.

The review workflow shall help the test user answer:

- What situation did I experience?
- What did AICA decide?
- Why did AICA decide that?
- What did I choose?
- What changed when values changed?
- What feedback should be recorded?
- What evidence should be exported?

---

## 8. Hypothesis Package Contract

### 8.1 Package Selection

The simulator shall allow the test user to select a hypothesis package before simulation setup.

The package selector shall display:

- package ID;
- package name;
- package version;
- target proposal category;
- supported scenario types;
- supported languages;
- owner or author when available;
- short description;
- last modified date when available.

### 8.2 Required Package Elements

Before playback, a package shall provide enough information for validation.

| Element | Purpose |
|---|---|
| Metadata | Identify package ID, version, name, owner, target proposal category, and description. |
| Compatibility | Declare supported scenarios and required simulator capabilities. |
| Parameters | Define editable or scenario-provided input values. |
| Features | Define derived values used by the algorithm and trace. |
| Hyperparameters | Define editable algorithm-control values. |
| Algorithm | Define or reference the evaluation logic. |
| Fire control | Define cooldown, suppression, override, and proposal-density behavior. |
| Proposals | Define AICA messages, options, and allowed state changes. |
| Labels | Provide display labels in supported languages. |
| Feedback schema | Define structured review labels and free-text fields. |
| Metrics schema | Define values recorded in evidence reports and comparison views. |

### 8.3 Package Validation

Before a package can be used, the simulator shall validate:

- metadata is present and versioned;
- at least one compatible scenario is available;
- parameter definitions are valid;
- feature definitions are valid when features are used;
- hyperparameter defaults are valid;
- trigger algorithm reference or definition is available;
- fire-control rules are defined or explicitly disabled;
- proposal definitions are valid;
- required labels are available in at least one supported language;
- feedback schema is available;
- evidence metrics are declared.

If validation fails, the simulator shall show a clear error and prevent playback for that package.

### 8.4 Package Versioning

Each package shall have a version identifier.

Each run shall record:

- package ID;
- package version;
- original parameter values;
- final parameter values if changed;
- original hyperparameter values;
- final hyperparameter values if changed;
- when each permitted value changed;
- whether a change occurred before playback, during pause, or through a forked rerun.

Evidence produced by old package versions shall remain traceable to the version that produced it.

---

## 9. Parameters, Features, And Hyperparameters

### 9.1 Parameter Definition Requirements

Each parameter definition shall include:

- parameter ID;
- display label in supported languages;
- description;
- data type;
- default value;
- allowed range or allowed enum values;
- unit when applicable;
- whether it is editable by the test user;
- whether it can change during the timeline;
- whether it is visible in the UI;
- validation rules.

### 9.2 Feature Definition Requirements

Each feature definition shall include:

- feature ID;
- display label in supported languages;
- description;
- source parameters, source states, or source events;
- calculation rule or algorithm reference;
- output type;
- output range when applicable;
- whether it is visible in the decision trace;
- human-readable explanation template.

### 9.3 Hyperparameter Definition Requirements

Each hyperparameter definition shall include:

- hyperparameter ID;
- display label in supported languages;
- description;
- data type;
- default value;
- allowed range or enum values;
- step size when numeric;
- whether it is editable before playback;
- whether it is editable during playback;
- whether changing it requires restart, pause, or fork;
- whether it should be included in comparison view.

### 9.4 Hyperparameter Modification Behavior

The simulator shall support the following modification modes when allowed by the package:

| Mode | Behavior |
|---|---|
| Before-run modification | Test user changes values before playback starts. |
| Pause-and-modify | Test user pauses playback, changes values, and resumes with trace recording. |
| Fork-and-rerun | Test user duplicates a run state with modified values and compares outcomes. |
| Variant comparison | Test user selects multiple value sets and compares behavior. |

The simulator shall clearly show when a run uses modified values rather than package defaults.

---

## 10. Scenario And Playback Requirements

### 10.1 Scenario Composition

Each scenario shall include:

- scenario ID;
- scenario version;
- scenario name;
- scenario description;
- persona description;
- initial driver state;
- route state;
- environment state;
- available rest opportunities;
- initial AICA state;
- timeline events;
- allowed test-user actions;
- expected review focus.

### 10.2 Canonical Scenario State

The simulator shall support canonical state categories:

- simulation time;
- driver state;
- vehicle state;
- route state;
- environment state;
- rest opportunity state;
- proposal history;
- user response history.

Packages may add custom state without changing simulator core workflow.

### 10.3 Timeline Events

Timeline events may update state and trigger algorithm evaluation.

Examples:

- drowsiness increases;
- fatigue increases;
- vehicle enters highway;
- traffic congestion begins;
- next rest spot approaches;
- next rest spot is passed;
- destination becomes near;
- driver response becomes slower;
- AICA proposal is accepted;
- AICA proposal is rejected;
- content starts, continues, switches, or ends.

### 10.4 Playback Controls

The simulator shall provide:

- start;
- pause;
- resume;
- step forward;
- reset;
- jump to decision point;
- show or hide decision trace;
- fork run from current point when supported;
- modify allowed values when paused or before rerun.

### 10.5 V1 Rest-Related Interactions

For UC-01 V1, playback shall allow the test user to experience:

- route option selection when available;
- rest guidance acceptance or rejection;
- rest spot selection when multiple rest spots are available;
- skipping a proposed rest spot;
- continuing to drive;
- selecting pre-rest wakefulness support;
- selecting simplified post-rest recovery content;
- cancelling or continuing current content when supported.

---

## 11. Algorithm Evaluation Contract

### 11.1 Evaluation Timing

At configured evaluation points, the simulator shall call the selected package algorithm with current simulation context.

Evaluation points may be:

- fixed simulation intervals;
- scenario timeline events;
- route or rest-opportunity changes;
- parameter changes;
- hyperparameter changes;
- user actions;
- package-defined decision points.

### 11.2 Algorithm Input

Algorithm input shall include:

- current simulation time;
- current parameters;
- calculated features;
- current hyperparameters;
- route and rest-opportunity state;
- proposal history;
- test-user action history;
- package-specific custom state.

### 11.3 Algorithm Output

Algorithm output shall include:

- trigger candidate status;
- score, rule result, state-machine state, or equivalent decision basis;
- threshold or criteria used when applicable;
- fire-control status;
- suppression status;
- override status;
- selected proposal category when fired;
- proposal message and options when fired;
- explanation data for the trace;
- references to parameter, feature, and hyperparameter values used in the decision.

### 11.4 Required Algorithm Styles For V1

V1 shall support at least:

1. **Rule-based algorithm**
   - Example: fire if drowsiness exceeds a threshold and a rest spot is near.

2. **Weighted scoring algorithm**
   - Example: calculate risk from fatigue, drowsiness, route condition, and rest opportunity.

Future versions may support state machines, optimization models, machine-learning models, or external algorithm plugins.

### 11.5 Fire-Control Requirements

The simulator shall support package-defined fire-control behavior such as:

- proposal cooldown interval;
- maximum proposals per trip;
- longer suppression after rejection;
- shorter suppression after acceptance;
- suppression when a proposal would be too frequent or irrelevant;
- override when risk is critical;
- override when risk increases rapidly;
- override when rest opportunity is about to be lost.

Fire-control behavior shall be traceable. If a proposal is suppressed, the trace shall explain why. If suppression is overridden, the trace shall explain why.

---

## 12. Decision Trace Requirements

### 12.1 Trace Purpose

Decision trace is the main trust mechanism for technical and algorithm reviewers.

The trace shall answer:

- What did AICA evaluate?
- Which values mattered?
- Which condition passed or failed?
- Was the proposal suppressed?
- Was suppression overridden?
- What proposal, if any, was selected?
- What did the test user do afterward?

### 12.2 Trace Entry Contents

Each decision trace entry shall include:

- simulation time;
- state snapshot reference;
- parameter values used;
- feature values calculated;
- hyperparameter values used;
- trigger candidate result;
- score, rule result, or equivalent decision basis;
- threshold or criteria comparison when applicable;
- fire-control result;
- suppression or override state;
- proposal result;
- explanation text;
- test-user action after the decision when applicable.

### 12.3 Trace Presentation

The simulator shall present traces in a way that non-implementation reviewers can understand while preserving enough detail for algorithm owners.

The trace view shall distinguish:

- input parameters;
- calculated features;
- hyperparameters;
- algorithm result;
- fire-control result;
- proposal result;
- human action.

The simulator shall not present trace explanation as proof of correctness.

---

## 13. Review Feedback Requirements

### 13.1 Human Review Ownership

The simulator shall collect feedback from the test user. It shall not automatically review the algorithm as good or bad.

The feedback record shall clearly distinguish:

- simulator-generated trace data;
- test-user-selected labels;
- test-user comments;
- optional reviewer notes;
- later requirement analyst conclusions.

### 13.2 Required V1 Feedback Labels

V1 shall support feedback labels for:

- proposal timing: too early / appropriate / too late / unnecessary / missed opportunity;
- safety impression: safe / somewhat risky / unsafe / unclear;
- intrusiveness: not intrusive / acceptable / intrusive / very intrusive;
- understandability: clear / somewhat clear / unclear;
- rest spot suitability: suitable / acceptable / unsuitable / no suitable rest spot;
- proposal content suitability: suitable / acceptable / unsuitable;
- user acceptance reason;
- user rejection reason;
- overall review judgment by the test user.

### 13.3 Free-Text Feedback

The simulator shall allow free-text comments. The UI shall not force the reviewer to write in only one language.

### 13.4 Feedback Timing

The simulator shall allow feedback:

- at the end of playback;
- at each decision point when configured;
- after accepting or rejecting a proposal;
- after modifying parameters or hyperparameters;
- after comparing two runs.

---

## 14. Evidence Report Requirements

### 14.1 Evidence Purpose

Evidence reports preserve what happened during simulation so stakeholders can use the run for later discussion, requirement refinement, and algorithm revision.

The evidence report shall not claim that the simulator independently judged the algorithm.

### 14.2 Required Report Contents

Each evidence report shall include:

- report ID;
- run ID;
- timestamp;
- selected UI language;
- package ID and version;
- scenario ID and version;
- initial parameter values;
- final parameter values if changed;
- initial hyperparameter values;
- final hyperparameter values if changed;
- timeline events;
- decision trace entries;
- AICA proposal events;
- test-user actions;
- structured review feedback labels;
- free-text comments;
- run comparison reference when applicable.

### 14.3 Reproducibility Requirements

A run shall be reproducible from:

- simulator version;
- package ID and version;
- scenario ID and version;
- parameter values;
- hyperparameter values;
- timeline events;
- test-user actions;
- selected branch or fork state when applicable.

If any external or live surface is used, the evidence report shall record enough bounded or snapshot data for review without storing secrets or requiring the external service to remain available.

### 14.4 Feedback Traceability

Each feedback item shall be traceable to one of:

- entire run;
- specific decision point;
- specific proposal;
- specific test-user action;
- specific parameter or hyperparameter change;
- comparison between runs.

---

## 15. UI And UX Requirements

### 15.1 Main UI Areas

The simulator shall include these user-facing areas or equivalent workflows:

1. **Package selection**
   - Select package.
   - View package summary, version, target category, and supported scenarios.

2. **Scenario selection and setup**
   - Select compatible scenario.
   - View persona and review focus.
   - Modify allowed scenario parameters.
   - Select variants.

3. **Hyperparameter controls**
   - View trigger hyperparameters.
   - Modify allowed values.
   - Reset to defaults.
   - Mark changed values for comparison.

4. **Simulation playback**
   - View route/timeline.
   - View driver, vehicle, and context state.
   - View AICA proposals.
   - Select user actions.
   - Pause and step through decisions.

5. **Decision trace**
   - Show parameters, features, hyperparameters, algorithm result, fire-control result, and proposal result.

6. **Review feedback**
   - Submit structured labels and comments.
   - Review previous feedback in the run.

7. **Run comparison**
   - Compare package, parameter, hyperparameter, trigger timing, proposal outcome, user action, and feedback differences.

8. **Evidence report**
   - Display, copy, or download structured evidence.

### 15.2 Test-User-Oriented UX

The UI shall prioritize the test user's ability to answer:

```text
What did I experience?
Why did AICA behave like this?
What did I choose?
What changed when values changed?
How do I feel about the behavior?
What evidence should be recorded?
```

The UI shall not prioritize implementation internals over review experience.

### 15.3 Prototype-Informed UX Direction

The accepted skeleton's compact three-panel review shape is the preferred UX direction for V1:

- left: scenario, route, or timeline context;
- center: playback, vehicle/cabin state, and cockpit proposal experience;
- right: package controls, hyperparameters, decision trace, and feedback.

The final V1 UI may adjust this layout, but it should preserve the review-room clarity demonstrated by the accepted skeleton.

### 15.4 Language Switching

The simulator UI shall support Japanese and English.

Language requirements:

- user can switch between Japanese and English;
- built-in UI labels support both languages;
- package-defined labels support both languages when provided;
- feedback labels support both languages;
- evidence reports include selected UI language;
- if a package label is missing in the selected language, the simulator falls back to an available label and indicates the fallback when necessary.

---

## 16. Run Comparison Requirements

The simulator shall support comparison of at least two runs.

Comparison shall show:

- package ID/version differences;
- scenario differences;
- parameter differences;
- hyperparameter differences;
- trigger timing differences;
- proposal result differences;
- fire-control differences;
- selected user action differences;
- feedback differences.

Comparison shall not automatically declare a winning package or optimal threshold. It may show facts and reviewer feedback; human reviewers draw conclusions.

---

## 17. Non-Functional Requirements

### 17.1 Configurability

The simulator shall be driven by package and scenario definitions rather than hardcoded AICA business logic.

### 17.2 Traceability

Every run shall be traceable to package version, scenario version, parameter values, hyperparameter values, timeline events, user actions, trace entries, and feedback.

### 17.3 Technical Trust

The simulator shall make algorithm behavior inspectable enough that technical reviewers can understand what influenced each decision.

### 17.4 Understandability

Decision traces and evidence reports shall be readable by product planners and UX reviewers while retaining the technical detail required by algorithm owners.

### 17.5 Extensibility

The simulator shall allow future addition of new proposal categories, parameters, features, algorithms, feedback schemas, and scenario types without rewriting the core review workflow.

### 17.6 Separation Of Concerns

The simulator shall separate:

- runtime behavior;
- hypothesis package definition;
- scenario definition;
- trigger algorithm logic;
- playback presentation;
- decision trace;
- test-user feedback;
- exported evidence.

### 17.7 Safety Framing

The simulator shall clearly indicate that it is a planning and verification support tool, not a production safety system.

---

## 18. Simulator Boundary And Non-Claims

The simulator may show facts such as:

- proposal fired at a simulation time;
- drowsiness score was above threshold;
- proposal was suppressed because cooldown was active;
- suppression was overridden because risk was critical;
- reviewer marked the proposal as too late.

The simulator shall not claim:

- this algorithm is correct;
- this algorithm is incorrect;
- this threshold is optimal;
- this proposal timing is objectively safe;
- this requirement should be changed automatically;
- this behavior is certified for production vehicle use.

The simulator records evidence. The human review and later requirement process determine what to do with that evidence.

The simulator shall explicitly distinguish:

- simulated values from real sensor values;
- scenario parameters from algorithm hyperparameters;
- reviewer feedback from simulator-generated trace;
- evidence collection from correctness judgment;
- prototype behavior from production AICA behavior.

---

## 19. Functional Requirements

### FR-001 — Select Hypothesis Package

The simulator shall allow the test user to select one valid hypothesis package before simulation setup.

Acceptance criteria:

- User can see available packages.
- User can view package summary and version.
- User can select a package.
- Selected package determines available parameters, hyperparameters, scenarios, proposals, labels, and feedback schema.

### FR-002 — Select Scenario

The simulator shall allow the test user to select a scenario compatible with the selected package.

Acceptance criteria:

- User can see compatible scenarios.
- User can view scenario summary, persona, and review focus.
- User can select a scenario and proceed to setup.

### FR-003 — Edit Scenario Parameters

The simulator shall allow the test user to edit package-permitted scenario parameters.

Acceptance criteria:

- Editable parameters are visible.
- Non-editable parameters are visible or hidden according to package configuration.
- Invalid values are rejected.
- Changed values are recorded in run evidence.

### FR-004 — Edit Trigger Hyperparameters

The simulator shall allow the test user to edit package-permitted trigger hyperparameters.

Acceptance criteria:

- Hyperparameters are shown separately from scenario parameters.
- User can change allowed values within range.
- User can reset to defaults.
- User can see which values differ from defaults.
- Changed values affect subsequent algorithm evaluation according to package rules.
- Changed values are recorded in evidence.

### FR-005 — Run Interactive Playback

The simulator shall generate dynamic playback from selected package, scenario, parameters, hyperparameters, timeline state, and test-user actions.

Acceptance criteria:

- Playback can start, pause, resume, step, and reset.
- Timeline state changes are visible.
- AICA proposals appear according to algorithm evaluation and fire control.
- User choices affect subsequent playback where defined by the scenario and package.

### FR-006 — Display AICA Proposal

When the hypothesis fires a proposal, the simulator shall display the AICA message and available options.

Acceptance criteria:

- Proposal message is shown in selected UI language when available.
- Proposal options are selectable.
- Selection is recorded.
- State changes after selection are applied.

### FR-007 — Display Decision Trace

The simulator shall display decision trace information for each algorithm evaluation point.

Acceptance criteria:

- User can inspect why AICA fired, did not fire, or was suppressed.
- Trace includes parameters, features, hyperparameters, algorithm result, fire-control result, and proposal result.
- Trace is understandable to non-implementation reviewers.

### FR-008 — Collect Review Feedback

The simulator shall collect structured and free-text feedback from the test user.

Acceptance criteria:

- Feedback can be submitted at configured points.
- Required labels are available.
- Free-text comments are supported.
- Feedback is linked to the relevant run, decision point, proposal, action, or comparison.

### FR-009 — Support Japanese/English UI Switching

The simulator shall support switchable Japanese and English UI.

Acceptance criteria:

- Built-in labels can switch between Japanese and English.
- Package-defined labels can switch when translations exist.
- Feedback labels can switch.
- Selected language is recorded in evidence.

### FR-010 — Compare Runs

The simulator shall support comparison of at least two runs.

Acceptance criteria:

- User can compare runs with different packages, scenarios, parameters, or hyperparameters.
- Differences in trigger timing, proposal result, selected actions, and feedback are visible.
- Comparison does not automatically declare a winner unless the human reviewer records that conclusion as feedback.

### FR-011 — Export Evidence Report

The simulator shall export a simulation evidence report.

Acceptance criteria:

- Report includes package, scenario, parameter values, hyperparameter values, trace, actions, and feedback.
- Report can be saved or copied for requirement refinement.
- Report distinguishes simulator facts from human review comments.

---

## 20. V1 Acceptance Criteria

V1 is acceptable when:

1. A test user can select a valid hypothesis package.
2. A test user can select a compatible UC-01 scenario.
3. A test user can switch the UI between Japanese and English.
4. A test user can edit allowed scenario parameters.
5. A test user can edit allowed trigger hyperparameters.
6. The simulator generates dynamic playback from selected package and scenario.
7. AICA can fire, suppress, or skip a proposal according to the selected hypothesis and fire-control rules.
8. The test user can accept or reject a rest proposal.
9. Playback changes based on test-user actions where defined.
10. The test user can inspect decision traces.
11. The test user can submit review feedback.
12. The evidence report records package, scenario, parameter values, hyperparameter values, trace, actions, and feedback.
13. The simulator does not present itself as automatically judging algorithm correctness.

---

## 21. Open Questions

The following questions remain for architecture and V1 planning:

1. What exact package schema format should be used for V1?
2. Should package algorithms be declarative only in V1, or should JavaScript plugin functions be allowed?
3. Should hyperparameter changes during playback update the current run immediately, always fork a new run, or support both modes?
4. What is the minimum comparison view needed for V1?
5. Which evidence report formats should V1 export: JSON, Markdown, or both?
6. How much custom UI should packages be allowed to define?
7. Which parts of the accepted skeleton layout are mandatory for V1?
8. Which behavior modules from the functional skeleton should be reused, rewritten, or treated only as reference?
9. Should optional map support be included in V1 or deferred until after package/trace/evidence workflow is stable?

---

## 22. Revision Notes For v3

This version applies the customer-facing technical refinement:

- Strengthened technical-review positioning.
- Added explicit separation of AICA concept, hypothesis package, simulator runtime, and human reviewer.
- Added technical confidence pillars.
- Integrated prototype lessons from the accepted and functional skeletons.
- Consolidated repeated package, trace, evidence, and boundary language.
- Promoted hypothesis package, algorithm evaluation, decision trace, and evidence report into clearer contracts.
- Clarified simulator non-claims and simulated-vs-real boundaries.
- Kept architecture and build-ready V1 details as future planning topics.
