# AICA Hypothesis Simulator — System Specification Draft v2

**Document status:** Draft specification  
**Purpose:** Define the required behavior and scope of the AICA Hypothesis Simulator as a configurable hypothesis-experience and review-feedback environment.  
**Source context:** Japanese PowerPoint `CDC-SU_音楽企画_システム要求仕様書.pptx`.  
**Important naming rule:** This specification uses **AICA** only in product screens, APIs, documents, and implementation labels.

---

## 1. Executive Summary

AICA is an in-car AI proposal concept that monitors driving context, driver state, route context, user context, and external conditions, then proposes appropriate actions or content such as rest guidance, wakefulness support, fatigue recovery content, monotony-prevention content, route-based music, or child-passenger content.

The AICA Hypothesis Simulator is a configurable simulator for experiencing and reviewing candidate AICA trigger hypotheses. Its purpose is not to judge whether an algorithm is correct by itself. Its purpose is to allow the **test user** — the system planner, algorithm proposer, domain reviewer, or UX reviewer — to experience how a selected hypothesis behaves on a simulation screen, interact with the playback, and provide review feedback.

The simulator shall support multiple runtime-selectable hypothesis packages. Although each package may define different input parameters, algorithms, hyperparameters, proposal types, and scenario values, the simulator outcome shall remain consistent:

1. generate an interactive scenario playback based on the selected hypothesis package and scenario state;
2. allow the test user to interact with AICA choices during playback;
3. expose the decision trace so the test user can understand what happened;
4. collect structured review feedback from the test user;
5. preserve the run, trace, selected options, and feedback as evidence for later requirement and algorithm refinement.

The simulator is therefore a **human-review support tool**, not an autonomous algorithm reviewer.

---

## 2. Background and Source Interpretation

### 2.1 AICA System Structure

The source planning material describes the AICA proposal system as three major functional areas:

1. **Trigger detection and firing control**
   - Monitor input data.
   - Calculate or accumulate feature values.
   - Detect whether a proposal trigger candidate exists.
   - Decide whether to fire or suppress a proposal.
   - Control proposal interval and proposal density.

2. **Proposal content and UX decision**
   - Select the proposal category or service.
   - Decide concrete proposal content.
   - Generate AICA utterance, display content, and user options.

3. **Content provision and ending judgment**
   - Start route guidance, content playback, or another proposed experience.
   - Judge whether content ends, continues, switches to another content, is cancelled, or returns to previous content.

The simulator must be able to represent these three areas, but the first verification priority is the trigger detection and firing-control area.

### 2.2 Simulator Verification Loop

The source planning material implies the following work loop for trigger hypothesis development:

```text
parameter consideration
→ logic-policy hypothesis consideration
→ simulator verification
→ parameter revision and detailed logic consideration
→ system requirement refinement
→ feedback to simulator
```

This specification defines a simulator that supports that loop by making hypotheses selectable, playable, inspectable, and reviewable by test users.

### 2.3 Clarified Product Positioning

The simulator shall not answer “which algorithm is correct” on its own. The simulator shall instead support the test user in answering questions through experience and feedback, such as:

- When I experience this playback, does the proposal timing feel too early, appropriate, or too late?
- Did the simulator show enough context for me to understand why AICA fired or did not fire?
- Did AICA present the proposal in a way that felt safe, understandable, and not overly intrusive?
- Did changing a hyperparameter produce a behavior that is easier or harder to accept?
- Which part of the hypothesis should the planner or algorithm proposer revise based on my feedback?

The human test user performs the review. The simulator records the evidence.

---

## 3. Product Definition

### 3.1 Product Name

**AICA Hypothesis Simulator**

### 3.2 Product Purpose

The AICA Hypothesis Simulator shall provide a configurable, interactive environment where test users can experience candidate trigger hypotheses and provide feedback on the resulting AICA behavior.

The simulator shall allow stakeholders to:

- select a hypothesis package at runtime;
- select or configure a scenario;
- modify hypothesis parameters and trigger-algorithm hyperparameters;
- execute interactive scenario playback;
- interact with AICA proposal choices during playback;
- view the decision trace of the selected hypothesis;
- submit review feedback about timing, safety, UX, intrusiveness, understandability, and proposal suitability;
- compare playback behavior across hypothesis packages or hyperparameter variants;
- export the simulation trace and review feedback for later requirement and algorithm refinement.

### 3.3 Core Product Principle

```text
AICA does not hardcode one trigger hypothesis.
AICA provides a stable simulator experience for many trigger hypotheses.
The test user reviews the experienced behavior.
The simulator records the evidence.
```

The simulator shall not assume that drowsiness, fatigue, monotony, rest opportunity, route emotional level, or child-passenger state are fixed universal variables. These are defined by the selected hypothesis package.

---

## 4. Scope

### 4.1 In Scope

The simulator shall support:

- hypothesis package selection by the test user;
- multiple hypothesis packages in one simulator environment;
- consistent playback and feedback workflow regardless of selected package;
- configurable input parameters;
- configurable feature definitions;
- configurable trigger algorithm definitions;
- editable trigger-algorithm hyperparameters;
- configurable parameter variants for experiments;
- configurable scenario state and timeline events;
- manual interactive scenario playback;
- algorithm evaluation at simulation time;
- trigger candidate judgment;
- fire-control judgment;
- proposal selection and proposal display;
- tester actions such as route selection, rest-spot selection, proposal acceptance, proposal rejection, proposal option selection, content selection, content cancellation, continuation decision, and feedback submission;
- decision-trace display;
- Japanese and English UI switching;
- human review feedback collection;
- simulation evidence report generation;
- comparison of runs produced by different hypothesis packages or hyperparameter values;
- export of simulation evidence for requirement refinement.

### 4.2 First-Version Focus

The first version shall focus on **dangerous-driving prevention through rest proposal**.

The first version shall support:

- driver fatigue/drowsiness hypothesis playback;
- rest guidance proposal;
- rest spot selection;
- pre-rest wakefulness content option;
- simplified post-rest recovery content option;
- fire-control logic to avoid excessive proposal frequency;
- editable trigger hyperparameters such as thresholds, weights, proposal intervals, and override limits;
- human feedback on timing, safety, intrusiveness, understandability, and rest spot suitability;
- Japanese/English language switching.

### 4.3 Future Expansion Scope

The simulator shall be designed so future hypothesis packages can cover:

- monotony or inattentive-driving prevention;
- familiar-road boredom prevention;
- route-based music proposal;
- scenic or oshi-related route content;
- child-passenger experience proposal;
- detailed content selection and ending judgment;
- machine-learning, optimization, or external plugin algorithms;
- richer multimodal content simulation.

### 4.4 Out of Scope for First Version

The first version shall not require:

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

---

## 5. Stakeholders and User Roles

### 5.1 Primary Stakeholders

| Stakeholder | Role in Simulator |
|---|---|
| Product planner | Defines use cases, proposal goals, and review objectives. |
| Algorithm proposer | Defines hypothesis packages, trigger logic, and hyperparameters. |
| Domain expert | Reviews driver-state assumptions and proposal appropriateness. |
| UX planner | Reviews playback, proposal message, interaction timing, and intrusiveness. |
| Requirement analyst | Converts feedback and evidence into requirement updates. |
| Test user | Experiences playback, selects options, and provides review feedback. |
| Engineer | Implements simulator functions based on this specification. |

### 5.2 User Roles

| Role | Main Capabilities |
|---|---|
| Hypothesis Author | Creates or edits hypothesis packages. |
| Scenario Author | Creates or edits scenario definitions. |
| Test User | Selects package/scenario, runs playback, changes allowed values, chooses options, and submits feedback. |
| Reviewer | Reviews traces, feedback, and exported reports. |
| Administrator | Manages hypothesis package versions and simulator configuration. |

### 5.3 Test User Definition

A **test user** is the human who experiences the simulator playback and reviews the behavior of AICA under a selected hypothesis. The test user may be a planner, algorithm proposer, domain expert, UX reviewer, or other evaluator.

The simulator shall be optimized around the test user’s review activity:

- seeing the simulated situation;
- understanding what AICA did;
- understanding why AICA did it;
- selecting options during playback;
- changing hyperparameters when permitted;
- submitting feedback.

---

## 6. Key Concepts and Definitions

### 6.1 AICA

The in-car AI proposal system concept targeted by this simulator.

### 6.2 Hypothesis

A candidate definition of how AICA should detect a condition, decide whether to fire a proposal, select a proposal, and respond to user choices.

Example:

> If drowsiness and fatigue are increasing and the next rest opportunity is near, AICA should propose rest before the driver passes that rest opportunity.

### 6.3 Hypothesis Package

A versioned runtime-selectable package that defines the variables, calculations, algorithm, hyperparameters, proposal behavior, UI labels, and feedback structure used by one simulation hypothesis.

A hypothesis package may include:

- metadata;
- parameter definitions;
- feature definitions;
- trigger algorithm definition;
- algorithm hyperparameters;
- fire-control rules;
- proposal definitions;
- scenario templates;
- timeline event templates;
- UI labels in Japanese and English;
- review feedback labels;
- metrics to record;
- allowed test-user actions.

### 6.4 Parameter Definition

A **parameter definition** describes a value that can be directly configured, selected, edited, or supplied as part of the scenario or hypothesis package.

Parameters are usually input-side or control-side values.

Examples:

| Parameter | Meaning |
|---|---|
| `drowsiness_level` | Simulated driver drowsiness value. |
| `fatigue_level` | Simulated driver fatigue value. |
| `next_rest_spot_minutes` | Time to the next available rest spot. |
| `proposal_cooldown_minutes` | Minimum interval between proposals. |
| `risk_threshold` | Trigger threshold used by the algorithm. |
| `drowsiness_weight` | Weight used by a scoring algorithm. |

Parameters may be edited before playback or during playback when the package allows it.

### 6.5 Feature Definition

A **feature definition** describes a derived value calculated from one or more parameters, scenario states, timeline events, or previous simulation results.

Features are usually algorithm-side values. The trigger algorithm uses features to judge whether a trigger candidate exists, whether to fire, and what to propose.

Examples:

| Feature | Example Calculation |
|---|---|
| `safe_driving_continuity_score` | Derived from drowsiness, fatigue, lane-weaving, and driving duration. |
| `rest_opportunity_score` | Derived from next rest spot distance, rest spot density, and destination distance. |
| `future_fatigue_risk` | Derived from highway duration, traffic prediction, route monotony, and current fatigue. |
| `proposal_intrusiveness_risk` | Derived from recent proposal count, previous rejection, and current driving context. |

### 6.6 Difference Between Parameters and Features

The distinction is:

```text
Parameter = a value the hypothesis or scenario directly provides or allows the test user to change.
Feature = a value calculated from parameters and state, then used by the algorithm.
```

Example:

```text
Parameters:
- drowsiness_level = 72
- fatigue_level = 65
- next_rest_spot_minutes = 6
- drowsiness_weight = 0.45
- fatigue_weight = 0.25
- rest_opportunity_weight = 0.30

Feature:
- trigger_risk_score =
  drowsiness_level * drowsiness_weight
  + fatigue_level * fatigue_weight
  + rest_opportunity_score * rest_opportunity_weight
```

In this example, the test user may modify the parameters and hyperparameters. The feature is recalculated by the simulator.

### 6.7 Trigger Algorithm

A trigger algorithm is the hypothesis-defined logic that evaluates current simulation context and decides:

- whether a trigger candidate exists;
- whether the candidate passes threshold;
- whether fire-control suppresses it;
- whether suppression should be overridden;
- which proposal category and proposal options should be presented.

The trigger algorithm may be rule-based, score-based, state-machine-based, optimization-based, or plugin-based in future versions.

### 6.8 Algorithm Hyperparameter

An **algorithm hyperparameter** is a configurable value that controls the behavior of the trigger algorithm but is not itself a simulated environmental or driver-state value.

Examples:

| Hyperparameter | Meaning |
|---|---|
| `risk_threshold` | Score threshold above which trigger candidate becomes true. |
| `critical_risk_threshold` | Higher score that can override suppression. |
| `drowsiness_weight` | Relative importance of drowsiness in the score. |
| `fatigue_weight` | Relative importance of fatigue in the score. |
| `rest_opportunity_weight` | Relative importance of nearby rest opportunity. |
| `proposal_cooldown_minutes` | Minimum proposal interval. |
| `max_proposals_per_trip` | Maximum number of proposals in one trip. |
| `rejection_penalty_minutes` | Additional suppression interval after rejection. |

The simulator shall allow permitted hyperparameters to be modified in the UI so the test user can verify what happens when values change.

### 6.9 Scenario

A simulated driving situation containing persona, route, driver state, environment, rest spots, timeline events, and possible test-user interactions.

### 6.10 Simulation Run

One execution of a selected hypothesis package against a selected scenario, selected parameter values, and selected hyperparameter values.

### 6.11 Playback

The visible simulation timeline shown to the test user. Playback is dynamic and may change according to test-user actions.

### 6.12 Review Feedback

Structured and free-text feedback submitted by the test user after or during playback.

The feedback belongs to the human reviewer. The simulator stores and organizes it but does not replace the human review.

---

## 7. Hypothesis Package Requirements

### 7.1 Package Selection

The simulator shall allow the test user to select a hypothesis package before starting a simulation run.

The package selector shall display:

- package name;
- package version;
- target proposal category;
- supported scenario types;
- supported language labels;
- short description;
- author or owner if available;
- last modified date if available.

The simulator shall support multiple packages in the same environment.

### 7.2 Common Outcome Across Packages

Regardless of the selected hypothesis package, the simulator shall always produce the same main outcome types:

- interactive playback;
- decision trace;
- test-user choices;
- review feedback;
- simulation evidence report.

This common outcome is required so different packages can be compared even when their internal parameters and algorithms differ.

### 7.3 Package Validation

Before a package can be used, the simulator shall validate that it contains:

- valid metadata;
- at least one scenario-compatible parameter set;
- valid parameter definitions;
- valid feature definitions when features are used;
- a trigger algorithm definition or registered algorithm reference;
- default hyperparameter values;
- proposal definitions;
- playback labels in at least one supported language;
- feedback label definitions.

If validation fails, the simulator shall show a clear error to the user.

### 7.4 Package Structure

A hypothesis package should contain the following logical sections:

| Section | Purpose |
|---|---|
| Metadata | Identify the package and version. |
| Parameter Definitions | Define editable or scenario-provided values. |
| Feature Definitions | Define derived values used by the algorithm. |
| Hyperparameter Definitions | Define editable algorithm-control values. |
| Trigger Algorithm | Define the decision logic or algorithm reference. |
| Fire-Control Rules | Define proposal suppression and override behavior. |
| Proposal Definitions | Define proposal categories, messages, and options. |
| Scenario Templates | Define compatible scenario starting points. |
| UI Labels | Provide display text in Japanese and English. |
| Feedback Schema | Define review labels and free-text fields. |
| Metrics Schema | Define values to record in the evidence report. |

### 7.5 Versioning

Each hypothesis package shall have a version identifier.

When a package is modified, the simulator shall preserve previous run evidence with the package version that produced it.

If a test user edits hyperparameters during a run, the run shall record:

- original package version;
- original hyperparameter values;
- modified hyperparameter values;
- when the values were modified;
- whether the modification occurred before playback or during playback.

---

## 8. Parameter, Feature, and Hyperparameter Requirements

### 8.1 Parameter Definition Requirements

Each parameter definition shall include:

- parameter ID;
- display label in Japanese and English;
- description;
- data type;
- default value;
- allowed range or allowed enum values;
- unit if applicable;
- whether it is editable by the test user;
- whether it can change during the timeline;
- whether it is visible in the UI;
- validation rules.

Example parameter definition:

```yaml
aica_parameter:
  id: drowsiness_level
  labels:
    en: Drowsiness level
    ja: 眠気レベル
  type: number
  unit: score_0_100
  default: 40
  min: 0
  max: 100
  editable_by_test_user: true
  timeline_variable: true
```

### 8.2 Feature Definition Requirements

Each feature definition shall include:

- feature ID;
- display label in Japanese and English;
- description;
- source parameters or source states;
- calculation rule or algorithm reference;
- output type;
- output range if applicable;
- whether it is visible in the decision trace;
- explanation text template.

Example feature definition:

```yaml
aica_feature:
  id: safe_driving_continuity_score
  labels:
    en: Safe driving continuity score
    ja: 安全運転継続可能性スコア
  sources:
    - drowsiness_level
    - fatigue_level
    - lane_weaving_level
    - driving_duration_minutes
  output:
    type: number
    range: [0, 1]
  visible_in_trace: true
```

### 8.3 Hyperparameter Definition Requirements

Each trigger-algorithm hyperparameter shall include:

- hyperparameter ID;
- display label in Japanese and English;
- description;
- data type;
- default value;
- allowed range or enum values;
- step size if numeric;
- whether it is editable before playback;
- whether it is editable during playback;
- whether changing it requires simulation restart;
- whether it should be included in comparison view.

Example hyperparameter definition:

```yaml
aica_hyperparameter:
  id: risk_threshold
  labels:
    en: Risk threshold
    ja: リスクしきい値
  type: number
  default: 0.72
  min: 0
  max: 1
  step: 0.01
  editable_before_playback: true
  editable_during_playback: true
  restart_required: false
  include_in_comparison: true
```

### 8.4 Hyperparameter Modification Behavior

The simulator shall allow the test user to modify permitted hyperparameters to verify what happens when values change.

The simulator shall support at least these modification modes:

| Mode | Description |
|---|---|
| Before-run modification | User changes hyperparameters before playback starts. |
| Pause-and-modify | User pauses playback, changes hyperparameters, and resumes. |
| Fork-and-rerun | User duplicates a run with modified hyperparameters and compares results. |
| Variant comparison | User selects multiple hyperparameter sets and compares behavior. |

The simulator shall clearly show when the playback is using modified hyperparameters rather than package defaults.

### 8.5 Parameter Variant Requirements

The simulator shall support parameter variants for scenario and algorithm exploration.

Variants may include:

- different drowsiness growth patterns;
- different fatigue levels;
- different route lengths;
- different rest spot distances;
- different traffic conditions;
- different proposal cooldown values;
- different risk thresholds;
- different feature weights.

The simulator shall allow variants to be selected manually. Batch or automated execution may be supported in later versions, but manual selection and comparison are required for the first version.

---

## 9. Scenario Requirements

### 9.1 Scenario Composition

Each scenario shall include:

- scenario ID;
- scenario name;
- scenario description;
- persona description;
- initial driver state;
- route state;
- environment state;
- available rest spots;
- initial AICA state;
- timeline events;
- allowed test-user actions;
- expected review focus.

### 9.2 Scenario State

The simulator shall support canonical state categories and custom package-defined state.

Canonical state categories may include:

- time;
- driver state;
- vehicle state;
- route state;
- environment state;
- rest opportunity state;
- proposal history;
- user response history.

Custom state shall allow hypothesis packages to add new variables without changing the simulator core.

### 9.3 Timeline Events

A scenario may define time-based events such as:

- drowsiness increases;
- fatigue increases;
- vehicle enters highway;
- traffic congestion begins;
- next rest spot approaches;
- next rest spot is passed;
- destination becomes near;
- driver response becomes slower;
- AICA proposal is accepted or rejected;
- content starts, continues, switches, or ends.

Timeline events shall update simulation state and may cause the trigger algorithm to re-evaluate.

### 9.4 Test-User Actions During Playback

The simulator shall support interactive actions during playback. The available actions may differ by package and scenario.

Required first-version actions:

- select route option;
- select or skip rest spot;
- accept AICA proposal;
- reject AICA proposal;
- select proposal option;
- continue current content;
- cancel current content;
- pause playback;
- modify allowed hyperparameters;
- submit feedback.

---

## 10. Trigger Algorithm Requirements

### 10.1 Algorithm Evaluation

At configured evaluation points, the simulator shall call the selected hypothesis algorithm with the current simulation context.

The context shall include:

- current time;
- current parameter values;
- current feature values;
- current hyperparameter values;
- route and rest opportunity state;
- proposal history;
- test-user action history;
- package-specific custom state.

### 10.2 Algorithm Output

The algorithm shall return a decision result containing:

- whether a trigger candidate exists;
- trigger score if applicable;
- threshold or criteria used if applicable;
- whether fire-control suppresses the proposal;
- whether suppression is overridden;
- selected proposal category if fired;
- proposal message and options if fired;
- explanation data for trace display;
- feature values used in the decision;
- hyperparameter values used in the decision.

### 10.3 Required Algorithm Styles for First Version

The first version shall support at least:

1. **Rule-based algorithm**
   - Example: fire if drowsiness exceeds threshold and rest spot is near.

2. **Weighted scoring algorithm**
   - Example: calculate a risk score from fatigue, drowsiness, route condition, and rest opportunity.

Future versions may support state machines, optimization models, machine-learning models, or external algorithm plugins.

### 10.4 Algorithm Explainability

The simulator shall display enough information for the test user to understand why AICA behaved as it did.

The decision trace shall show:

- parameter values at decision time;
- feature values at decision time;
- hyperparameter values at decision time;
- trigger score or rule result;
- threshold comparison;
- fire-control result;
- selected proposal or non-proposal result;
- short human-readable explanation.

The simulator shall not claim that the explanation proves correctness. It only supports human review.

### 10.5 Fire-Control Requirements

The simulator shall support fire-control logic such as:

- proposal cooldown interval;
- maximum proposals per trip;
- longer suppression after rejection;
- shorter suppression after acceptance;
- override when risk is critical;
- override when risk increases rapidly;
- suppression when proposal would be too frequent or irrelevant.

Fire-control behavior shall be defined by the hypothesis package and controlled by editable hyperparameters where allowed.

---

## 11. Playback Requirements

### 11.1 Playback Purpose

Playback shall allow the test user to experience AICA behavior in a simulated driving situation.

Playback shall show:

- current scenario state;
- current route/rest spot context;
- AICA proposal timing;
- AICA utterance or display content;
- available test-user actions;
- resulting state changes;
- decision trace when requested.

### 11.2 Dynamic Playback

Playback shall not be a fixed linear video. It shall be generated from:

- selected hypothesis package;
- selected scenario;
- current parameter values;
- current hyperparameter values;
- timeline state;
- algorithm decisions;
- test-user choices.

Different test-user choices may produce different subsequent playback.

### 11.3 Playback Controls

The simulator shall provide:

- start;
- pause;
- resume;
- step forward;
- reset;
- jump to decision point;
- fork run from current point when supported;
- modify allowed hyperparameters when paused;
- show/hide decision trace.

### 11.4 Route and Rest Spot Interaction

For the first version, playback shall allow the test user to experience rest-related choices.

Required interaction examples:

- choose route A or route B;
- choose whether to accept guidance to a rest spot;
- choose a rest spot if multiple are available;
- skip the proposed rest spot;
- continue driving;
- select pre-rest wakefulness content;
- select post-rest recovery content in simplified form.

---

## 12. Review Feedback Requirements

### 12.1 Human Review Ownership

The simulator shall collect feedback from the test user. It shall not automatically review the algorithm as good or bad.

The feedback record shall clearly distinguish:

- simulator-generated trace data;
- test-user-selected labels;
- test-user comments;
- optional reviewer notes;
- later requirement analyst conclusions.

### 12.2 Required Feedback Labels

The first version shall support feedback labels for:

- proposal timing: too early / appropriate / too late / unnecessary / missed opportunity;
- safety impression: safe / somewhat risky / unsafe / unclear;
- intrusiveness: not intrusive / acceptable / intrusive / very intrusive;
- understandability: clear / somewhat clear / unclear;
- rest spot suitability: suitable / acceptable / unsuitable / no suitable rest spot;
- proposal content suitability: suitable / acceptable / unsuitable;
- user acceptance reason;
- user rejection reason;
- overall review judgment by the test user.

### 12.3 Free-Text Feedback

The simulator shall allow free-text comments in Japanese and English.

The UI shall not force the test user to write in one language only.

### 12.4 Feedback Timing

The simulator shall allow feedback:

- at the end of playback;
- at each decision point;
- after accepting or rejecting a proposal;
- after modifying hyperparameters;
- after comparing two runs.

### 12.5 Feedback Export

Feedback shall be included in the evidence report with:

- run ID;
- package ID and version;
- scenario ID;
- parameter values;
- hyperparameter values;
- playback trace;
- selected user actions;
- test-user labels;
- comments;
- language used.

---

## 13. UI and UX Requirements

### 13.1 Main Screens

The simulator shall include the following UI areas or screens:

1. **Hypothesis Package Selection**
   - Select package.
   - View package summary.
   - View package version.
   - View supported scenario types.

2. **Scenario Selection and Setup**
   - Select scenario.
   - View persona and initial state.
   - Modify allowed scenario parameters.
   - Select variant values.

3. **Hyperparameter Control Panel**
   - View trigger-algorithm hyperparameters.
   - Modify allowed hyperparameters.
   - Reset to package defaults.
   - Save temporary variant for comparison.

4. **Simulation Playback**
   - View route/timeline.
   - View driver and context state.
   - View AICA proposals.
   - Select user actions.
   - Pause and step through decisions.

5. **Decision Trace Panel**
   - Show parameter values.
   - Show feature values.
   - Show hyperparameters.
   - Show trigger score/rule result.
   - Show fire-control result.
   - Show proposal result.

6. **Review Feedback Panel**
   - Submit labels and comments.
   - Review previous feedback in the run.

7. **Run Comparison View**
   - Compare two or more runs.
   - Highlight changed package, parameter, and hyperparameter values.
   - Show different trigger times and proposal outcomes.

8. **Evidence Report View**
   - Display exported simulation evidence.
   - Support download or copy as structured text.

### 13.2 Language Switching

The simulator UI shall support both Japanese and English.

Language requirements:

- The user shall be able to switch between Japanese and English.
- Package-defined labels shall support Japanese and English when provided.
- Built-in UI labels shall support Japanese and English.
- Feedback labels shall support Japanese and English.
- Evidence reports shall include the selected UI language.
- If a package label is missing in the selected language, the simulator shall fall back to the available label and clearly indicate the fallback if necessary.

### 13.3 Bilingual Label Model

Package-defined display text shall use a bilingual label model.

Example:

```yaml
labels:
  en: Risk threshold
  ja: リスクしきい値
```

This model shall apply to:

- package name and description;
- parameters;
- features;
- hyperparameters;
- proposal messages;
- proposal options;
- feedback labels;
- scenario names and descriptions.

### 13.4 Test-User-Oriented UX

The UI shall prioritize the test user’s ability to answer:

```text
What did I experience?
Why did AICA behave like this?
What did I choose?
How do I feel about the behavior?
What feedback should be recorded?
```

The UI shall not prioritize implementation internals over review experience.

### 13.5 Hyperparameter Experiment UX

The UI shall make hyperparameter experimentation clear and safe.

The simulator shall:

- show default values;
- show current modified values;
- show whether a value was changed before or during playback;
- allow reset to default;
- allow fork-and-rerun for comparison;
- record every changed value in the evidence report;
- prevent invalid values outside the allowed range.

---

## 14. Evidence Report Requirements

### 14.1 Evidence Report Purpose

The evidence report shall preserve what happened during simulation so stakeholders can use the run for later discussion and requirement refinement.

The report shall not claim that the simulator independently judged the algorithm.

### 14.2 Required Report Contents

Each evidence report shall include:

- report ID;
- run ID;
- timestamp;
- selected UI language;
- selected hypothesis package ID and version;
- selected scenario ID and version;
- initial parameter values;
- final parameter values if changed;
- initial hyperparameter values;
- final hyperparameter values if changed;
- timeline events;
- decision trace entries;
- AICA proposal events;
- test-user actions;
- review feedback labels;
- free-text comments;
- run comparison reference if applicable.

### 14.3 Decision Trace Entry

Each decision trace entry shall include:

- simulation time;
- state snapshot reference;
- parameter values used;
- feature values calculated;
- hyperparameter values used;
- trigger candidate result;
- trigger score or rule result;
- threshold comparison;
- fire-control result;
- proposal result;
- explanation text;
- test-user action after decision if any.

### 14.4 Feedback Traceability

Each feedback item shall be traceable to one of:

- entire run;
- specific decision point;
- specific proposal;
- specific test-user action;
- specific hyperparameter change;
- comparison between runs.

---

## 15. Functional Requirements

### FR-001 — Select Hypothesis Package

The simulator shall allow the test user to select one hypothesis package before simulation setup.

Acceptance criteria:

- User can see available packages.
- User can view package summary and version.
- User can select a package.
- Selected package determines available parameters, hyperparameters, scenarios, proposals, and feedback labels.

### FR-002 — Select Scenario

The simulator shall allow the test user to select a scenario compatible with the selected hypothesis package.

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
- Changed values are recorded in the run evidence.

### FR-004 — Edit Trigger Hyperparameters

The simulator shall allow the test user to edit package-permitted trigger-algorithm hyperparameters.

Acceptance criteria:

- Hyperparameters are shown separately from scenario parameters.
- User can change allowed values within range.
- User can reset to defaults.
- User can see which values differ from defaults.
- Changed hyperparameters affect subsequent algorithm evaluation.
- Changes are recorded in evidence.

### FR-005 — Run Interactive Playback

The simulator shall generate dynamic playback from the selected package, scenario, parameters, hyperparameters, and test-user actions.

Acceptance criteria:

- Playback can start, pause, resume, and reset.
- Timeline state changes are visible.
- AICA proposals appear according to algorithm evaluation.
- User choices affect subsequent playback.

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
- Trace includes parameters, features, hyperparameters, threshold/rule result, and fire-control result.
- Trace is understandable to non-engineering reviewers.

### FR-008 — Collect Review Feedback

The simulator shall collect structured and free-text feedback from the test user.

Acceptance criteria:

- Feedback can be submitted at configured points.
- Required labels are available.
- Free-text comments are supported.
- Feedback is linked to the relevant run or decision point.

### FR-009 — Support Japanese/English UI Switching

The simulator shall support switchable Japanese and English UI.

Acceptance criteria:

- Built-in UI text can switch between Japanese and English.
- Package-defined labels can switch when translations exist.
- Feedback labels can switch.
- Selected language is recorded in evidence.

### FR-010 — Compare Runs

The simulator shall support comparison of at least two simulation runs.

Acceptance criteria:

- User can compare runs with different packages, parameters, or hyperparameters.
- Differences in trigger timing, proposal result, selected actions, and feedback are visible.
- Comparison does not automatically declare a winner unless the test user records that conclusion.

### FR-011 — Export Evidence Report

The simulator shall export a simulation evidence report.

Acceptance criteria:

- Report includes package, scenario, parameters, hyperparameters, trace, actions, and feedback.
- Report can be saved or copied for requirement refinement.
- Report distinguishes simulator data from human review comments.

---

## 16. Non-Functional Requirements

### 16.1 Configurability

The simulator shall be driven by hypothesis packages and scenario definitions rather than hardcoded AICA business logic.

### 16.2 Traceability

Every simulation run shall be reproducible from:

- package version;
- scenario version;
- parameter values;
- hyperparameter values;
- timeline events;
- test-user actions.

### 16.3 Understandability

The simulator shall present decision traces in a way that product planners and UX reviewers can understand.

### 16.4 Extensibility

The simulator shall allow future addition of new proposal categories, parameters, features, algorithms, and feedback schemas without rewriting the core playback workflow.

### 16.5 Separation of Concerns

The simulator shall separate:

- simulator runtime behavior;
- hypothesis package definition;
- scenario definition;
- trigger algorithm logic;
- test-user feedback;
- exported evidence.

### 16.6 Language Support

Japanese and English UI support shall be treated as a core requirement, not a future enhancement.

### 16.7 Safety Framing

The simulator shall clearly indicate that it is a planning and verification support tool, not a production safety system.

---

## 17. First-Version Example Flow

### 17.1 Setup

1. Test user opens the simulator.
2. Test user selects UI language: Japanese or English.
3. Test user selects a hypothesis package, for example `Rest Proposal Weighted Score v0.1`.
4. Test user selects a scenario, for example `Tired driver returning home at night`.
5. Test user reviews and edits allowed parameters.
6. Test user reviews and edits allowed trigger hyperparameters.
7. Test user starts playback.

### 17.2 Playback

1. Driver starts route.
2. Drowsiness and fatigue values increase over simulated time.
3. AICA evaluates the trigger algorithm at configured intervals.
4. AICA does not propose at first because score is below threshold.
5. As the next rest spot approaches, the score exceeds threshold.
6. Fire-control allows proposal.
7. AICA proposes a rest stop.
8. Test user accepts, rejects, or selects another option.
9. Playback continues based on the selected action.
10. Test user pauses playback and changes `risk_threshold`.
11. Playback forks or resumes with the modified hyperparameter.
12. Test user compares behavior before and after the change.

### 17.3 Review

1. Test user submits timing feedback.
2. Test user submits safety and intrusiveness feedback.
3. Test user comments on whether the decision trace was understandable.
4. Simulator exports evidence report.

---

## 18. V1 Acceptance Criteria

The first version shall be considered acceptable when:

1. A test user can select a hypothesis package.
2. A test user can select a compatible scenario.
3. A test user can switch the UI between Japanese and English.
4. A test user can edit allowed scenario parameters.
5. A test user can edit allowed trigger hyperparameters.
6. The simulator can generate dynamic playback from the selected package and scenario.
7. AICA can fire or suppress a proposal according to the selected hypothesis.
8. The test user can accept or reject a proposal.
9. The playback changes based on test-user actions.
10. The test user can inspect decision traces.
11. The test user can submit review feedback.
12. The evidence report records package, scenario, parameter values, hyperparameter values, trace, actions, and feedback.
13. The simulator does not present itself as automatically judging algorithm correctness.

---

## 19. Guardrails and Clarifications

### 19.1 Simulator Does Not Review the Algorithm

The simulator shall not claim:

- this algorithm is correct;
- this algorithm is incorrect;
- this threshold is optimal;
- this proposal timing is objectively safe;
- this requirement should be changed automatically.

The simulator may show facts about the run:

- proposal fired at T+10:30;
- drowsiness score was 0.74;
- threshold was 0.70;
- proposal was suppressed because cooldown was active;
- test user marked the proposal as too late.

The human review and later requirement process determine what to do with that evidence.

### 19.2 AICA Naming Only

All simulator-facing language shall use **AICA** only.

Do not use mixed historical naming across UI, APIs, documents, package labels, or implementation artifacts.

### 19.3 Package Variability With Stable Workflow

Different hypothesis packages may have different input parameters, algorithms, hyperparameters, and proposal types. However, the simulator workflow shall remain stable:

```text
select package
→ select scenario
→ configure parameters and hyperparameters
→ run playback
→ interact with AICA
→ inspect trace
→ submit feedback
→ export evidence
```

### 19.4 Hyperparameter Editing Is Core Scope

The simulator shall treat trigger-algorithm hyperparameter editing as a core requirement.

This is necessary because hypothesis verification requires the test user to experience what changes when thresholds, weights, proposal intervals, and override rules are modified.

---

## 20. Open Questions

The following questions remain for future refinement:

1. Which trigger-algorithm styles must be supported in V1 besides rule-based and weighted scoring?
2. Should hyperparameter changes during playback update the current run immediately, or always fork a new run?
3. Which feedback labels are mandatory for Japanese stakeholder review?
4. Should the simulator support side-by-side playback of two runs in V1?
5. How much custom UI layout should each hypothesis package be allowed to define?
6. Which parts of the evidence report should be exported as Markdown, JSON, or both?
7. Should package authors be able to define custom feedback forms?
8. Should the simulator allow multiple test users to review the same run?

---

## 21. Draft Package Schema Illustration

This section is illustrative and not an implementation mandate.

```yaml
package:
  id: rest_proposal_weighted_score
  version: 0.1.0
  labels:
    en: Rest Proposal Weighted Score
    ja: 休憩提案・重み付きスコア
  description:
    en: Hypothesis package for rest proposal timing based on fatigue, drowsiness, and rest opportunity.
    ja: 疲労、眠気、休憩機会に基づいて休憩提案タイミングを検証する仮説パッケージ。

parameters:
  - id: drowsiness_level
    labels:
      en: Drowsiness level
      ja: 眠気レベル
    type: number
    min: 0
    max: 100
    default: 40
    editable_by_test_user: true

  - id: next_rest_spot_minutes
    labels:
      en: Minutes to next rest spot
      ja: 次の休憩地点までの分数
    type: number
    min: 0
    max: 60
    default: 12
    editable_by_test_user: true

features:
  - id: rest_opportunity_score
    labels:
      en: Rest opportunity score
      ja: 休憩機会スコア
    derived_from:
      - next_rest_spot_minutes
    output_range: [0, 1]

hyperparameters:
  - id: risk_threshold
    labels:
      en: Risk threshold
      ja: リスクしきい値
    type: number
    min: 0
    max: 1
    step: 0.01
    default: 0.72
    editable_before_playback: true
    editable_during_playback: true

  - id: drowsiness_weight
    labels:
      en: Drowsiness weight
      ja: 眠気の重み
    type: number
    min: 0
    max: 1
    step: 0.01
    default: 0.45
    editable_before_playback: true
    editable_during_playback: true

algorithm:
  type: weighted_score
  score:
    terms:
      - feature_or_parameter: drowsiness_level
        weight: drowsiness_weight
      - feature_or_parameter: fatigue_level
        weight: fatigue_weight
      - feature_or_parameter: rest_opportunity_score
        weight: rest_opportunity_weight
  trigger_when:
    score_gte: risk_threshold

feedback:
  labels:
    timing:
      en: Proposal timing
      ja: 提案タイミング
      options:
        - id: too_early
          labels:
            en: Too early
            ja: 早すぎる
        - id: appropriate
          labels:
            en: Appropriate
            ja: 適切
        - id: too_late
          labels:
            en: Too late
            ja: 遅すぎる
```

---

## 22. Revision Notes for v2

This version applies the following corrections:

- Reframed the simulator as a test-user experience and feedback tool, not an autonomous algorithm reviewer.
- Replaced mixed naming with AICA-only naming.
- Added hypothesis package selection as explicit in-scope functionality.
- Added Japanese/English UI switching as a core requirement.
- Clarified the difference between parameter definitions and feature definitions.
- Added trigger-algorithm hyperparameters as a separate concept.
- Added requirements for modifying hyperparameters inside the simulator and recording the effect.
- Clarified that playback and review feedback are the common outcome across all hypothesis packages.
