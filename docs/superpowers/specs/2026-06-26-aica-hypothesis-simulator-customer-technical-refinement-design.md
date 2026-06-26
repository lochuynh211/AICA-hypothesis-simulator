# AICA Hypothesis Simulator Customer Technical Refinement Design

Date: 2026-06-26
Status: Approved brainstorming design
Target future document: `docs/master/aica_hypothesis_simulator_specification.md`

## 1. Purpose

This design defines how to refine the AICA Hypothesis Simulator master specification for a customer-facing technical and algorithm-review audience.

The refined master specification should position the simulator as a technical review environment for AICA trigger hypotheses. It should not position the simulator as an autonomous algorithm judge, a production safety system, or a general driving demo.

The central product message should be:

> The AICA Hypothesis Simulator lets reviewers experience how a selected AICA trigger hypothesis behaves in a simulated driving scenario, inspect the decision evidence behind each AICA action, and record structured human feedback for requirement and algorithm refinement.

The final purpose of this companion design is to guide a future merge into the master specification before architecture planning and V1 implementation planning.

## 2. Primary Audience

The refined master specification should primarily satisfy technical and algorithm reviewers.

Those reviewers need to understand:

- what hypothesis is being tested;
- what inputs, features, and hyperparameters influenced AICA;
- why AICA fired, suppressed, or did not fire;
- what changed when parameters or hyperparameters changed;
- what evidence can be taken back into requirement and algorithm refinement.

Business and product readers should still understand the value, but the refinement should prioritize technical confidence over marketing language.

## 3. Product Positioning

The master specification should clearly separate four concepts:

| Concept | Meaning |
|---|---|
| AICA concept | The future in-car assistant behavior being explored. |
| Hypothesis package | One candidate definition of trigger logic, variables, hyperparameters, proposal behavior, labels, and feedback schema. |
| Simulator runtime | The stable environment that loads packages, plays scenarios, calls algorithms, records traces, and exports evidence. |
| Human reviewer | The person who judges whether timing, safety impression, intrusiveness, and explainability are acceptable. |

The refined positioning should emphasize that AICA trigger design is too context-dependent to validate from static documents alone. The simulator makes hypotheses experiential, inspectable, comparable, and reviewable by humans.

## 4. Confidence Pillars

The refined master specification should explicitly present three technical confidence pillars.

### 4.1 Hypothesis Package Clarity

Reviewers must be able to identify the selected hypothesis package and understand what it controls.

A hypothesis package should define:

- metadata and version;
- compatible scenarios;
- scenario parameters;
- derived features;
- algorithm hyperparameters;
- trigger algorithm reference or definition;
- fire-control rules;
- proposal definitions;
- bilingual labels where needed;
- feedback schema;
- metrics and evidence schema.

The package contract should make package variability acceptable while preserving a stable simulator workflow.

### 4.2 Decision Trace And Evidence Rigor

Reviewers must be able to inspect why AICA behaved as it did.

Every algorithm evaluation point should produce a trace entry that records:

- simulation time;
- state snapshot reference;
- parameter values;
- feature values;
- hyperparameter values;
- trigger candidate result;
- score, rule result, or equivalent decision basis;
- threshold or criteria comparison when applicable;
- fire-control result;
- suppression or override state;
- proposal result;
- human-readable explanation;
- test-user action after the decision, when applicable.

The evidence report should preserve the complete review context without claiming that the simulator independently judged correctness.

### 4.3 Simulator Boundary Clarity

The refined master specification should make the simulator boundary explicit.

The simulator may show facts such as:

- a proposal fired at a specific simulation time;
- a score crossed a configured threshold;
- fire control suppressed a proposal;
- a reviewer marked the timing as too late.

The simulator must not claim:

- the algorithm is correct;
- the algorithm is safe for production;
- a threshold is optimal;
- a requirement should be changed automatically;
- the simulation replaces vehicle validation, safety certification, or domain review.

The simulator records evidence for human review. The human review process decides what the evidence means.

## 5. Technical Contracts

The refined master specification should add or strengthen the following contracts.

### 5.1 Hypothesis Package Contract

Each package should provide enough information for validation before playback.

Required package elements:

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

### 5.2 Algorithm Evaluation Contract

At each configured evaluation point, the simulator should call the selected package algorithm with a complete simulation context.

Algorithm input should include:

- current simulation time;
- current parameters;
- calculated features;
- current hyperparameters;
- route and rest-opportunity state;
- proposal history;
- test-user action history;
- package-specific custom state.

Algorithm output should include:

- trigger candidate status;
- score, rule result, state-machine state, or equivalent decision basis;
- threshold or criteria used when applicable;
- fire-control status;
- suppression or override status;
- selected proposal category when fired;
- proposal message and options when fired;
- explanation data for the trace;
- parameter, feature, and hyperparameter references used in the decision.

### 5.3 Decision Trace Contract

Decision trace is the main trust mechanism for algorithm reviewers.

The trace should be readable by non-implementation reviewers while still precise enough for algorithm owners. It should answer:

- What did AICA evaluate?
- Which values mattered?
- Which condition passed or failed?
- Was the proposal suppressed?
- Was suppression overridden?
- What proposal, if any, was selected?
- What did the test user do afterward?

### 5.4 Evidence Report Contract

Evidence reports should make runs reproducible and reviewable.

Each report should include:

- report ID and run ID;
- timestamp;
- selected UI language;
- package ID and version;
- scenario ID and version;
- initial and final parameter values;
- initial and final hyperparameter values;
- timeline events;
- decision trace entries;
- AICA proposal events;
- test-user actions;
- structured feedback labels;
- free-text comments;
- run comparison references when applicable.

The report should distinguish simulator-generated facts from human review comments.

### 5.5 Boundary Contract

The master specification should explicitly distinguish:

- simulated values from real sensor values;
- scenario parameters from algorithm hyperparameters;
- reviewer feedback from simulator-generated trace;
- evidence collection from correctness judgment;
- prototype behavior from production AICA behavior.

## 6. Prototype Rationale

The refined master specification should briefly mention the two prototype skeletons as rationale.

The accepted skeleton demonstrates the customer-accepted review-room UX direction:

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

## 7. Scope Boundary For This Refinement

This customer-facing technical refinement should not become the full architecture spec or the build-ready V1 spec.

It should include:

- product purpose and technical-review workflow;
- hypothesis package contract;
- scenario and playback contract;
- algorithm evaluation contract;
- decision trace contract;
- evidence report contract;
- simulator boundary and non-claims;
- prototype rationale;
- customer-facing acceptance criteria for technical confidence.

It should keep implementation details light. It may identify UC-01 dangerous-driving prevention as the recommended first focus, while keeping UC-02, UC-03, and UC-04 as future expansion pressure.

Detailed module boundaries, file structure, concrete schemas, and implementation tasks should be handled in later architecture and V1 implementation specs.

## 8. Master Spec Refinement Map

The future master-spec revision should apply this design as follows.

| Current master area | Refinement |
|---|---|
| Executive Summary | Strengthen technical-review positioning and explain why static documents are insufficient. |
| Background and Source Interpretation | Keep the source reading, but connect it more directly to algorithm-review confidence. |
| Product Definition | Add explicit separation of AICA concept, package, runtime, and human reviewer. |
| Scope | Clarify which parts support customer-facing technical confidence and which are future implementation details. |
| Key Concepts | Tighten definitions for hypothesis package, parameter, feature, hyperparameter, trace, evidence, and reviewer feedback. |
| Hypothesis Package Requirements | Promote this into a clearer package contract with validation expectations. |
| Trigger Algorithm Requirements | Add a stronger algorithm input/output contract. |
| Playback Requirements | Clarify playback as evidence-producing review experience, not linear demo playback. |
| Review Feedback Requirements | Distinguish simulator facts from human judgments. |
| UI and UX Requirements | Keep high-level review workflow; postpone detailed UI choices to the V1 build spec. |
| Evidence Report Requirements | Strengthen reproducibility and traceability expectations. |
| Non-Functional Requirements | Add technical trust, reproducibility, and boundary clarity as explicit qualities. |
| Guardrails and Clarifications | Expand non-claims and simulated-vs-real boundaries. |
| New Prototype Lessons Section | Briefly explain accepted skeleton and functional skeleton lessons. |

## 9. Acceptance Criteria For The Refined Master Spec

The master-spec revision guided by this design is successful when a technical reviewer can answer these questions without extra explanation:

- What problem does the simulator solve?
- Who reviews the hypothesis, and what does the simulator only record?
- What is a hypothesis package?
- What inputs and outputs does an algorithm evaluation have?
- What exactly is captured in a decision trace?
- What makes an evidence report reproducible and useful?
- What is simulated, what is real, and what is explicitly out of scope?
- How do the two existing prototypes inform the target product?
- Why is UC-01 the recommended first focus while UC-02, UC-03, and UC-04 remain future expansion pressure?

## 10. Follow-On Sequence

After this companion design is approved, the recommended sequence is:

1. Merge this refinement direction into `docs/master/aica_hypothesis_simulator_specification.md`.
2. Create an architecture spec focused on package schema, runtime modules, data flow, trace/evidence storage, and extension points.
3. Create a build-ready V1 spec focused on UC-01, the accepted skeleton UI direction, and functional skeleton behavior lessons.

