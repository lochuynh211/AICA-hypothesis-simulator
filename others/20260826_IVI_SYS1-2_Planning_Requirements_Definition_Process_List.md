# IVI SYS.1–2 — Planning & Requirements Definition Process List

*English translation of `20260826_IVI_SYS1-2_企画要求定義プロセス一覧.xlsx` (2026-08-26).*

The source workbook has four sheets: **Process List** (the detailed 255-row table), **Process Overview**, **Legend**, and **Dependency Summary**. They are reordered here so the summary material comes before the detailed table.

**Contents**

1. [Legend / Conventions](#1-legend--conventions) — sheet 凡例
2. [Process Overview](#2-process-overview) — sheet プロセス概要
3. [Dependency Summary](#3-dependency-summary) — sheet 依存関係サマリ
4. [Process List (detailed)](#4-process-list-detailed) — sheet プロセス一覧

---

## 1. Legend / Conventions

### Scope (this version)

All steps of Phase ① (activities 1–6), Phase ② (7–9), and Phase ③ (10–16). The big picture is given separately on the "Process Overview" sheet, and the critical path on the "Dependency Summary" sheet.

### Premise on existing verification results (PoC)

This table is written on the premise that a PoC has *not* necessarily been carried out by the time planning study begins. In **SYS1-01-d** you inquire whether in-house existing verification results exist (advanced development, R&D, etc.), and only if they do, you sort them in **SYS1-01-e**. If they do not exist, SYS1-01-e is skipped and the matter is passed on as an "unverified hypothesis" to the falsification hypotheses of SYS1-02 and the verification hypotheses of SYS1-06. When existing verification results *do* exist, their typical sources are: technical verification by the advanced development / R&D department, joint demonstrations with partners or vendors, similar verifications from other vehicle models or other projects, and in-house demos or prototype evaluations. Because generalizability varies with the source, the conditions under which the verification was performed must always be stated explicitly. Note that at the requirements-definition stage, prototypes / PoCs aimed at confirming the validity of requirement values are planned and executed separately in **SYS2-16-h through -j**.

### Step-ID rules

- **L1** = PH1 / PH2 / PH3 (phase)
- **L2** = SYS1-01 (activity number)
- **L3** = SYS1-01-a (branch number of the work item)

Activities 1–9 are prefixed **SYS1**; activities 10–16 are prefixed **SYS2**.

### Process hierarchy

- **L1** = phase
- **L2** = activity (the summary row for the work items beneath it)
- **L3** = work item (1 row = 1 work item; concrete examples are written on this row)

### Premise on the ASPICE-corresponding BPs

Based on Automotive SPICE 3.1: **SYS.1** (BP1 elicit requirements and requests / BP2 understand expectations / BP3 agree on requirements / BP4 establish the baseline / BP5 change management / BP6 mechanism for inquiry and communication) and **SYS.2** (BP1–8). The planning process is treated as the "pre-SYS.1 stage", with the related BPs noted in parentheses. For Phase ②, the mainly corresponding BP is given per L3 row. If you operate against the v4.0 standard, SYS.1 has been abolished, so a re-mapping is required.

### Definition of granularity / completeness

- **Rough version** — created by the planning-support consultant, before review by the business planning department.
- **Draft version** — reviewed by the business planning department (and related departments as needed), but not yet approved by the decision-making meeting.
- **Fixed version** — approved by the decision-making meeting, or settled as a fact / record.

### Premise on the executing party

This table is written as a process carried out by the **business planning department** of an automotive OEM. That department has ownership of every activity, and the premise is that it handles not only decision-making but also the hands-on work — producing materials, doing research, organizing issues. On terminology:

- **"Own department"** = the business planning department (the party executing this process; this also covers cases where it refers to deliverables the department itself produced in an earlier step).
- **"Planning owner"** = the department head / planning manager of the business planning department (the party who reviews, confirms, approves, and decides).

Even when part of the hands-on work is outsourced to external support (consultants, research agencies), ownership does not change, so this table does not distinguish whether or not work is outsourced. The IVI development, ADAS, vehicle control, cloud, legal, quality assurance, operations, product planning, and corporate planning departments are participants who provide information, make technical judgments, review, and decide; development vendors and partners are downstream recipients.

### Subject matter of the concrete examples

Written mainly using a **"rest-suggestion service"** as the subject (acquiring driving time and driver state from other domains and displaying a suggestion on the IVI). When reusing this for another plan, substitute the subject matter.

### Notation for predecessor / successor

"Predecessor: ID / Successor: ID". Multiple entries are separated by "・". Dependencies that cross activities are also written using work-item-level IDs.

### Column correspondence

In the order of the request form's No. 1–9, 11, 15–17, and "+" (10, 12, 13, 14 are unused numbers).

### Delimiters within a cell

Line breaks within a cell are not used; multiple items are separated by ①②③ or by "/".

---

## 2. Process Overview

### Phase ① Planning brush-up (pre-SYS.1 stage)

#### 1. Organizing the starting point of the plan / understanding the premises

| Item | Content |
|---|---|
| **Outline (what this step does)** | Write out the idea-stage plan concept on one page, then work through its positioning against higher-level policy, the separation of decided items from hypotheses, confirmation of whether in-house existing verification results exist (advanced development, R&D, etc.), and grasping the target vehicle models, SOP, IVI technical constraints, and operational constraints — thereby firming up the foundation and the sequencing of the study. |
| **Main outputs** | Planning-premises summary (draft version: one-page plan summary / separation of decided items, hypotheses, and undecided items / sorting of existing verification results / premises and constraints / terminology), target-premises table, IVI technical constraints list, stakeholder map, study WBS |
| **Owner (executing party)** | Business planning department |
| **Departments involved** | Corporate planning & product planning departments, advanced development / R&D department, IVI development department, operations department |
| **Completion criterion (condition to move on)** | Premises, constraints, and hypotheses are organized into a single document, and every undecided item has an owner and a deadline |
| **Common pitfall** | Failing to recognize vague expressions in the concept as hypotheses, and proceeding as if they were settled |

#### 2. Refining the value proposition, personas, and usage context

| Item | Content |
|---|---|
| **Outline** | Put into words — down to a granularity that can be verified and falsified — whose problem, in what situation, and to what degree, is being solved. Define personas and usage contexts, and confirm the hypotheses through user interviews. |
| **Main outputs** | Value-proposition definition (draft version), persona sheet, usage-context matrix, JTBD summary table, falsification-hypothesis list, interview analysis results |
| **Owner** | Business planning department |
| **Departments involved** | External (interview subjects, recruiting agency) |
| **Completion criterion** | The value proposition can be stated outright in one sentence, with supporting evidence and falsification hypotheses linked to it |
| **Common pitfall** | The value stays in abstract wording and can be neither verified nor falsified |

#### 3. Competitor / alternative-means research and differentiation

| Item | Content |
|---|---|
| **Outline** | Compare against other companies' IVI, smartphone apps, retrofit devices, and the company's own existing features, and narrow down to 1–2 axes the necessity of the company providing this on IVI and the differentiation. Actual-vehicle benchmarking and the division of roles when integrating with a smartphone are also confirmed here. |
| **Main outputs** | Differentiation summary (draft version), feature comparison table, UX walkthrough diagram, IVI-necessity summary, price / monetization-model research table |
| **Owner** | Business planning department |
| **Departments involved** | External (public information, actual-vehicle test drives), IVI development department |
| **Completion criterion** | The differentiation axes are narrowed down, and it is clear which features may simply be at parity with competitors |
| **Common pitfall** | Investing in features that a smartphone already covers |

#### 4. Concretizing the experience scenarios / trigger conditions

| Item | Content |
|---|---|
| **Outline** | Make concrete when, where, and in what state the function triggers, how it is shown, how it is responded to, and what happens when it is wrong. Notification means, whether operation while driving is allowed, and rough screen layouts are also decided here. |
| **Main outputs** | Experience-scenario document and trigger-condition definition (draft version), storyboard, trigger-condition trade-off table, notification-means design, rough screen-layout proposals |
| **Owner** | Business planning department |
| **Departments involved** | IVI development department, design department, quality assurance department (HMI constraints) |
| **Completion criterion** | The trigger-condition proposal to adopt is narrowed down to one, and the remaining proposals are recorded as alternatives |
| **Common pitfall** | Never fully nailing down the trade-off between false detection and annoyance |

#### 5. Examining the necessity and scope of domain integration

| Item | Content |
|---|---|
| **Outline** | Enumerate the data the experience needs, confirm whether IVI alone can substitute for it and what integration adds on top, and then decide the integration scope, acquisition means, responsibility demarcation, and constraints. |
| **Main outputs** | Domain-integration policy (draft version), required-data list, 3-proposal comparison table for the integration scope, responsibility-demarcation proposal, integration cost & schedule estimate table |
| **Owner** | Business planning department |
| **Departments involved** | IVI development, vehicle control, ADAS, cloud departments; legal department |
| **Completion criterion** | The integration-scope proposal to adopt is decided, and items still awaiting an answer on whether provision is possible are stated explicitly |
| **Common pitfall** | Studying it on the assumption that integration is a given, and being unable to explain the added value |

#### 6. Verifying acceptability and business viability, and narrowing the plan

| Item | Content |
|---|---|
| **Outline** | Verify through quantitative research whether people will really use it and pay for it, work out the revenue model, cost, P&L, and KPIs, then sort items into initial release / OTA addition / drop with reasons attached, and obtain approval at the decision-making meeting. |
| **Main outputs** | Plan document (fixed version), business-viability assessment (P&L simulation, KPI tree, success criteria), scope-sorting table, risk & precondition list |
| **Owner** | Business planning department (decision-making) |
| **Departments involved** | External (research agency), IVI development department (cost), related departments (advance briefing) |
| **Completion criterion** | The plan document is approved at the decision-making meeting and distributed as the official input to requirements definition |
| **Common pitfall** | No record of the sorting rationale, so it gets reopened later |

### Phase ② Issue extraction → system issue list (SYS.1 BP1–6)

#### 7. Extraction of points to be examined

| Item | Content |
|---|---|
| **Outline** | Consolidate into a single list the matters deferred as "issues" in Phase ① together with the concerns of the departments involved, standardize them to 1 issue = 1 question, and assign a decision-maker, decision deadline, and priority. |
| **Main outputs** | Issue list (fixed version: question × options × decision material × decision-maker × deadline × priority), requirement-candidate notes |
| **Owner** | Business planning department |
| **Departments involved** | IVI development, ADAS, vehicle control, cloud, legal, quality assurance, and operations departments |
| **Completion criterion** | The issue list is fixed, and the solicitation of additions from the departments involved has been closed |
| **Common pitfall** | Failing to fully consolidate the issues scattered across the various documents |

#### 8. Discussing the issues and examining the handling policy

| Item | Content |
|---|---|
| **Outline** | Prepare option-comparison tables, discuss the issues at review meetings, and sort them into decided / conditionally decided / on hold. Confirm with concrete examples that the interpretation of each decision does not diverge between departments, and reflect it into the planning-related documents. |
| **Main outputs** | Handling-policy list (fixed version: decision × rationale × conditions × decision-maker), revised documents, remaining-issue list, condition-management table |
| **Owner** | Business planning department (facilitation and recording) / the decision-maker for each issue |
| **Departments involved** | IVI development and related domain departments; legal, security, and functional-safety departments |
| **Completion criterion** | Every issue has reached a conclusion, and evidence of the decision-maker's approval is on record |
| **Common pitfall** | Proceeding while the interpretation of a decision still diverges between departments |

#### 9. Creating the system issue list

| Item | Content |
|---|---|
| **Outline** | Structure the decided items as constraints and premises and the unresolved items as issues, link them to the requirement candidates, and baseline the result. Decide the operating rules for change management and weekly updates, and hand over to requirements definition. |
| **Main outputs** | System issue list (fixed version, baseline), issue change-management rules, issue operating rules, issue-resolution plan, full handover material set |
| **Owner** | Business planning department |
| **Departments involved** | IVI development department (the receiver), operations department, related domain departments |
| **Completion criterion** | The issue list is baselined and handed over at the requirements-definition kickoff |
| **Common pitfall** | Not recording already-decided matters as constraints, so they get re-examined later |

### Phase ③ Creating the system requirements specification (SYS.2 BP1–8)

#### 10. Creating use cases (fixed version)

| Item | Content |
|---|---|
| **Outline** | Convert the experience scenarios into use cases written down to actors, pre- and post-conditions, and basic / alternative / exception flows. Assigning the trigger conditions, describing integration with other domains, and setting placeholder premises for unresolved issues are also done here. |
| **Main outputs** | Use-case descriptions (fixed version, with UC-IDs), use-case diagram, actor list, integration-point list |
| **Owner** | Business planning department (authoring) / IVI development department (feasibility confirmation) |
| **Departments involved** | IVI development department, operations department |
| **Completion criterion** | The UC-IDs are frozen, and the state is such that screen and requirement authoring can begin |
| **Common pitfall** | Thin exception flows, so the behavior in abnormal situations never gets decided |

#### 11. Creating screen mockups and transition diagrams

| Item | Content |
|---|---|
| **Outline** | Define the information volume, layout, transitions, and operation restrictions that hold up while driving. Coexistence with the map, expression differences per notification means, interrupt priority against existing notifications, and error / degraded screens are all decided (visual design is out of scope). |
| **Main outputs** | Screen list, screen mockups (wireframes), screen transition diagram, expression definitions per notification means, while-driving restriction definitions |
| **Owner** | Business planning department (authoring) / IVI development department (feasibility confirmation) |
| **Departments involved** | Design department, quality assurance department (distraction) |
| **Completion criterion** | The screen IDs are frozen, and the display / operation restrictions while driving are defined |
| **Common pitfall** | Postponing coexistence with the map and interrupt priority |

#### 12. Creating the requirements list (functional / non-functional)

| Item | Content |
|---|---|
| **Outline** | From the use cases, screens, integration policy, and system issues, produce verifiable and unambiguous requirement statements with acceptance criteria. In addition to functional requirements, define non-functional requirements for performance, availability, security, and maintainability / OTA updatability. |
| **Main outputs** | Requirements list (fixed version: REQ-ID × requirement statement × rationale × acceptance criteria × priority), traceability matrix |
| **Owner** | Business planning department (authoring) / IVI development department (feasibility and verifiability confirmation) |
| **Departments involved** | Related domain departments, legal & security departments, quality assurance department |
| **Completion criterion** | The REQ-IDs are frozen, and every requirement has a rationale and acceptance criteria attached |
| **Common pitfall** | Requirements with unverifiable vague wording remain |

#### 13. Creating the function allocation diagram (inter-domain allocation)

| Item | Content |
|---|---|
| **Outline** | Enumerate the function blocks that realize the requirements, and decide — by comparing multiple proposals — whether each goes on the IVI, another domain, or the cloud. Data flows, interface candidates, and the responsibility demarcation are also nailed down here. |
| **Main outputs** | Function allocation diagram, data-flow definitions, interface-candidate list, responsibility-demarcation list |
| **Owner** | Business planning department (organizing) / IVI development department (technical judgment) |
| **Departments involved** | ADAS, vehicle control, cloud departments |
| **Completion criterion** | The allocation is decided, and the responsibility demarcation and interface candidates are agreed with the related domain departments |
| **Common pitfall** | The already-decided location of the decision logic contradicts the allocation proposal |

#### 14. Creating flowcharts

| Item | Content |
|---|---|
| **Outline** | Diagram the branches of trigger determination, suppression conditions, frequency control, response handling, abnormal handling, and state initialization, and expand the condition combinations into a table to surface undefined behavior. |
| **Main outputs** | Flowcharts (fixed version), branch-coverage confirmation results, flow × requirement cross-check results |
| **Owner** | Business planning department (authoring) / IVI development department (implementation-viewpoint confirmation) |
| **Departments involved** | IVI development department |
| **Completion criterion** | The branches are exhaustively covered, and gaps and contradictions have been resolved by cross-checking against the requirements list |
| **Common pitfall** | Condition combinations are not exhaustively covered, leaving undefined behavior |

#### 15. Creating sequence diagrams

| Item | Content |
|---|---|
| **Outline** | Show the interactions between domains and between elements on a time axis, clarifying order, period, timeout, and behavior under contention. Extract the interface items from this and reflect them into the requirements. |
| **Main outputs** | Sequence diagrams (fixed version: normal case / integration / abnormal case / contention), interface-item list |
| **Owner** | Business planning department (authoring) / IVI development department (technical confirmation) |
| **Departments involved** | ADAS, vehicle control, cloud departments |
| **Completion criterion** | The interface items are linked to the requirements list, and the diagrams are mutually consistent |
| **Common pitfall** | Behavior on timeout and under contention is left undefined |

#### 16. Integrating, reviewing, and reflecting PoC results into the system requirements specification (draft)

| Item | Content |
|---|---|
| **Outline** | Integrate each deliverable into a single document and confirm consistency, traceability, and verifiability. Values that cannot be settled on paper are verified with prototypes / PoCs and reflected into the requirements; then baseline the document and communicate it to the departments involved and to vendors. |
| **Main outputs** | System requirements specification (draft version, baseline), traceability matrix (integrated version), PoC plan and result-reflection record, specification change-management rules |
| **Owner** | Business planning department (integration) / business planning & IVI development departments (approval) |
| **Departments involved** | Related domain departments, legal, security, and quality assurance departments, development vendors |
| **Completion criterion** | The specification is baselined and has been distributed and explained together with the change-management rules |
| **Common pitfall** | Fixing provisional values as final, so change management stops working |

---

## 3. Dependency Summary

### Critical path (main series)

| | |
|---|---|
| **Content** | The shortest path that determines the skeleton of the plan. If this slips, every step slips with it. |
| **Path / target steps** | SYS1-01-o → SYS1-02-r → SYS1-03-o → SYS1-04-t → SYS1-05-o → SYS1-06-q → SYS1-07-n → SYS1-08-m → SYS1-09-i → SYS2-10-n → SYS2-12-p → SYS2-16-n |
| **Impact if delayed** | Each node cannot be started without the fixed version from the preceding step, so a single delay becomes a delay of the final baseline as-is |
| **What to get ahead of** | Reserve the review dates for each fixed version in advance, working backwards from the decision-making meeting (SYS1-01-n) |

### External lead time — research

| | |
|---|---|
| **Content** | User interviews and quantitative research take several weeks from arrangement to results |
| **Path / target steps** | SYS1-02-n → SYS1-02-p / SYS1-06-b → SYS1-06-d |
| **Impact if delayed** | While waiting on research results, the value-proposition definition and the business-viability assessment cannot be fixed, and everything downstream stops |
| **What to get ahead of** | In parallel with designing the questionnaire, get ahead on arranging the research agency and fixing the screening conditions |

### External lead time — data provision

| | |
|---|---|
| **Content** | Inquiries to other departments about whether data can be provided take time to answer, and may be refused |
| **Path / target steps** | SYS1-05-i → SYS1-05-k → SYS1-05-o → SYS2-13-f |
| **Impact if delayed** | The integration scope cannot be fixed, so the function allocation diagram and the interface candidates cannot be decided |
| **What to get ahead of** | Send out the inquiry first even while the required-data list is still coarse, and decide the answer deadline and how a non-answer will be handled |

### Hard deadline

| | |
|---|---|
| **Content** | The SOP and IVI specification-freeze date of the target vehicle model dictate the overall deadline |
| **Path / target steps** | SYS1-01-j → SYS1-05-m → SYS1-06-n → SYS1-09-g → SYS2-16-n |
| **Impact if delayed** | Integration that entails vehicle-side ECU changes will not make it in time, requiring a re-sorting of the initial release scope |
| **What to get ahead of** | Set the issues that entail vehicle-side changes as the top priority, and set their decision deadlines working backwards from the specification freeze (SYS1-07-h) |

### Confluence point (where things tend to jam) — plan narrowing

| | |
|---|---|
| **Content** | The three series — experience, integration, and business viability — converge at the narrowing of the plan |
| **Path / target steps** | SYS1-04-t + SYS1-05-o + SYS1-06-i → SYS1-06-n → SYS1-06-q |
| **Impact if delayed** | If even one series' draft version is missing, scope sorting cannot be done and the matter cannot be tabled at the decision-making meeting |
| **What to get ahead of** | Set the draft-version deadlines of all three series on the same day, and decide in advance the rule for setting placeholder premises when one is missing |

### Confluence point (where things tend to jam) — specification integration

| | |
|---|---|
| **Content** | Requirements, screens, allocation, flows, and sequences converge at the specification integration |
| **Path / target steps** | SYS2-11-n + SYS2-12-p + SYS2-13-l + SYS2-14-l + SYS2-15-l → SYS2-16-b → SYS2-16-e |
| **Impact if delayed** | Deliverables at mismatched revisions get mixed together, causing massive rework during the consistency check |
| **What to get ahead of** | Cross-check the revision numbers of each deliverable before integration, and unify the ID notation rules before authoring begins (SYS2-16-a) |

### Work that can run in parallel — competitor research

| | |
|---|---|
| **Content** | Competitor research can partly run in parallel with refining the value proposition |
| **Path / target steps** | SYS1-03-a through -f can start partway through SYS1-02 |
| **Impact if delayed** | If not parallelized, waiting on the arrangement of actual vehicles for the research becomes the cause of delay |
| **What to get ahead of** | Fix the comparison-target list early, and get ahead with arranging test drives and rentals |

### Work that can run in parallel — flowcharts and sequence diagrams

| | |
|---|---|
| **Content** | Flowcharts and sequence diagrams can run in parallel once the requirements list is fixed |
| **Path / target steps** | SYS2-14 and SYS2-15 run in parallel after SYS2-12-p |
| **Impact if delayed** | Doing them serially delays the start of specification integration by 2–3 weeks |
| **What to get ahead of** | Prepare the description guides (SYS2-14-b / SYS2-15-b) first, split the assignments, and start both at once |

### Path prone to rework — PoC results

| | |
|---|---|
| **Content** | Requirement values change as a result of the PoC / prototype |
| **Path / target steps** | SYS2-16-i → SYS2-16-j → updates to the requirements list, screens, flows, and sequences |
| **Impact if delayed** | Already-fixed deliverables have to be revised again, delaying baselining |
| **What to get ahead of** | Tag the values that may change (thresholds, character-count limits, timeouts) with a provisional value and an issue ID, and list the places to be updated in advance |

### Path prone to rework — conditional decisions

| | |
|---|---|
| **Content** | If the condition of a conditional decision is not met, it switches to the alternative proposal |
| **Path / target steps** | SYS1-08-h → SYS1-09-b → SYS2-12-f, SYS2-13-e |
| **Impact if delayed** | The requirements, allocation, and sequences that presuppose integration all have to be swapped out together |
| **What to get ahead of** | State the alternative for an unmet condition explicitly at decision time, and keep the integration-dependent descriptions separated out of the basic flow |

---

## 4. Process List (detailed)

Column meanings (from the source sheet header): Step ID / Process hierarchy / Corresponding ASPICE BP / Activity name / Purpose / Work content / Input deliverables / Input source / Output deliverables / Granularity & completeness definition / Predecessor & successor steps / Entry condition / Exit condition (DoD) / Concrete examples of the work & study / AI hypothesis-driven applicability / Rationale.

### PH1 (L1) — Phase ① Planning brush-up

- **ASPICE BP:** Pre-SYS.1 stage
- **Purpose:** Refine the service concept conceived by the planning owner into a plan that can withstand requirements definition — i.e. a state in which the value proposition, experience, integration scope, business viability, and scope are settled with supporting rationale.
- **Work content:** Carry out activities 1–6 and obtain a plan document (fixed version) approved at the decision-making meeting.
- **Input deliverables:** Study theme; higher-level policy (mid-term management plan, connected strategy, product planning policy); the current plan concept; in-house existing verification results (if any); market & competitor information
- **Input source:** Corporate planning & product planning departments / own department (plan concept) / advanced development & R&D department / external (research agencies, public information)
- **Output deliverables:** Plan document (revised, approved version), value-proposition definition, differentiation summary, experience-scenario document & trigger-condition definition, domain-integration policy, business-viability assessment, scope-sorting table
- **Granularity / completeness:** Fixed version — approved at the decision-making meeting
- **Predecessor / Successor:** Predecessor: none / Successor: PH2 (SYS1-07)
- **Entry:** The study theme is linked to higher-level policy, and the planning owner has agreed to start the study
- **Exit (DoD):** The plan document is approved at the decision-making meeting and distributed as the official input to the requirements-definition phase
- **Concrete examples:** (see the activities beneath) e.g. for a rest-suggestion service, narrow the plan down in this order: clarify the premises → put the value into words → compare competitors → concretize the trigger conditions → determine whether integration is needed for driving time and fatigue estimation → verify acceptability and P&L → sort into initial release / OTA / drop.

---

### SYS1-01 (L2) — Organizing the starting point of the plan / understanding the premises

- **ASPICE BP:** Pre-SYS.1 stage (BP1 preparation)
- **Purpose:** Consolidate into a single summary the plan concept, higher-level policy, existing information, and constraints that form the starting point of the study; clarify what is settled and what is a hypothesis; and then draw up the study plan.
- **Work content:** Carry out work items a–o, produce the planning-premises summary (draft version) and the study WBS, and obtain the planning owner's confirmation.
- **Input deliverables:** Study theme, higher-level policy materials, the current plan concept, in-house existing verification results (if any), market & competitor information, business & operational constraints, target vehicle-model plan, IVI technical constraints
- **Input source:** Corporate planning & product planning departments / own department (plan concept) / advanced development & R&D department / operations department / IVI development department / external (public information)
- **Output deliverables:** Planning-premises summary (draft version: one-page plan summary / separation of decided items, hypotheses, and undecided items / sorting of existing verification results / premises and constraints / terminology), stakeholder map, study WBS
- **Granularity / completeness:** Draft version — confirmed by the planning owner (department head / planning manager)
- **Predecessor / Successor:** Predecessor: none / Successor: SYS1-02, SYS1-03, SYS1-05, SYS1-06
- **Entry:** The study theme is decided and starting the study has been agreed
- **Exit (DoD):** The planning-premises summary (draft version) has been confirmed by the planning owner, and every undecided item has an owner and a deadline
- **Concrete examples:** (see the work items beneath) linking to higher-level policy, condensing the plan concept onto one page, separating decided items from hypotheses, confirming whether existing R&D verification results exist and sorting them, confirming the target vehicle-model and SOP premises.

#### SYS1-01-a — Confirm positioning against higher-level policy

- **Purpose:** Confirm where this plan sits within the higher-level policy, and make the non-negotiable constraints explicit.
- **Work content:** Review the mid-term management plan, the connected strategy, and the product planning policy, and write out this plan's positioning, the contribution expected of it, and the constraints to be observed.
- **Input deliverables:** Mid-term management plan, connected-service strategy materials, product planning policy, the product concept of the target vehicle model
- **Input source:** Corporate planning department / product planning department
- **Output deliverables:** Higher-level-policy mapping table (policy × this plan's positioning × expected contribution × constraints)
- **Granularity / completeness:** Fixed version — confirmed by the planning owner
- **Predecessor / Successor:** Predecessor: none / Successor: SYS1-01-b, SYS1-01-c, SYS1-06-g
- **Entry:** Starting the study on the study theme has been agreed
- **Exit (DoD):** ① The higher-level policy this plan links to has been identified ② the expected contribution is documented ③ constraints and prohibited items are enumerated
- **Concrete examples:** ① Identify which of the connected-service strategy's focus areas (promoting safety and peace of mind, expanding subscription revenue) this links to, and write out the form the contribution takes (subscription rate / brand appeal / safety metrics). ② From the product planning policy, confirm the concept of the target vehicle model (family-oriented, frequent long-distance use) and check that the plan's direction does not contradict it. ③ Put the constraints and prohibited items to be observed (no advertising display, no additional charges, etc.) in writing, and use them as the frame for all subsequent study.

#### SYS1-01-b — Condense the plan concept onto one page

- **Purpose:** Turn the plan concept that exists only in someone's head into a single page others can read and discuss.
- **Work content:** Summarize the current plan concept on one page in the pattern "to whom / what / why / how it is delivered", annotating whether each item has supporting evidence.
- **Input deliverables:** Study theme, higher-level-policy mapping table, idea notes and discussion records
- **Input source:** Own department (plan concept)
- **Output deliverables:** One-page plan summary (Who / What / Why / How × presence of evidence)
- **Granularity / completeness:** Rough version — created by the planning staff, not yet confirmed by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-01-a / Successor: SYS1-01-c, SYS1-02-a
- **Entry:** The positioning against higher-level policy has been confirmed
- **Exit (DoD):** ① Who / What / Why / How fit on one page ② each item is annotated with whether evidence exists ③ expressions open to divergent interpretation are marked
- **Concrete examples:** ① Summarize it in one sentence, e.g. "for families who drive long distances, deliver rest suggestions on the IVI according to the driving situation, reducing the accident risk from fatigue and the stress on passengers". ② Annotate each item with its evidence (in-house data / other companies' cases / idea only), making visible the items whose evidence is "idea only". ③ Mark expressions open to divergent interpretation, such as "at the appropriate time" or "naturally", and make them targets for definition in later steps.

#### SYS1-01-c — Separate decided items, hypotheses, and undecided items

- **Purpose:** Separate what is settled from what is a hypothesis, and clarify what needs to be verified.
- **Work content:** Classify each statement in the one-page plan summary and the higher-level-policy mapping table as a decided item, a hypothesis, or undecided, and rough out a verification method for each hypothesis.
- **Input deliverables:** One-page plan summary, higher-level-policy mapping table
- **Input source:** Own department (plan concept) / planning owner
- **Output deliverables:** Separation table for decided items / hypotheses / undecided items (statement × classification × evidence × verification policy)
- **Granularity / completeness:** Draft version — before confirmation by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-01-a, SYS1-01-b / Successor: SYS1-01-d, SYS1-01-o, SYS1-02-a, SYS1-06-a
- **Entry:** The one-page plan summary has been created
- **Exit (DoD):** ① Every statement is classified into one of the three categories ② every hypothesis has a verification policy attached ③ every decided item records the source of the decision
- **Concrete examples:** ① Classify "the target is our own connected-capable vehicles" as a decided item (source: the product planning policy), and "long-distance drivers want rest suggestions" as a hypothesis. ② Attach a rough verification method to each hypothesis (interviews / quantitative research / referring to existing verification results) and hand it over to downstream activities 2 and 6. ③ Statements whose classification is unclear ("we can detect fatigue") are marked undecided and recorded as matters requiring technical confirmation.

#### SYS1-01-d — Inquire whether usable in-house verification results exist

- **Purpose:** Confirm whether usable existing verification results exist in-house, and obtain only those that do.
- **Work content:** Inquire whether existing verification results relating to the hypotheses and undecided items in the separation table exist (PoCs by advanced development / R&D, track records from other vehicle models, in-house experiments), and obtain those that do.
- **Input deliverables:** Separation table for decided items / hypotheses / undecided items, the in-house list of technology development themes
- **Input source:** Advanced development & R&D department / IVI development department / ADAS department
- **Output deliverables:** Inventory of where existing verification results reside (theme × performing department × exists or not × obtainability × date performed)
- **Granularity / completeness:** Fixed version — settled as the result of the inquiry
- **Predecessor / Successor:** Predecessor: SYS1-01-c / Successor: SYS1-01-e, SYS1-01-f
- **Entry:** The hypotheses and undecided items have been identified
- **Exit (DoD):** ① Existence has been confirmed for every potentially relevant theme ② for those that exist, obtainability and the date performed are recorded ③ where none exist, "none" is stated explicitly
- **Concrete examples:** ① Inquire with each department about verification track records in advanced development / R&D relating to "driver fatigue estimation" and "acceptability of rest suggestions". ② Where they exist, obtain the reports and record the date performed and the conditions (number of subjects, driving environment, target vehicles). ③ Where no verification results exist, state "none" explicitly and hand the hypothesis over as something to be newly verified in activities 2 and 6.

#### SYS1-01-e — Sort the existing verification results (only if results exist)

- **Purpose:** Rather than taking existing verification results at face value, sort them by how far they can actually be claimed to hold (only when results exist).
- **Work content:** Sort the obtained verification results into proven / holds conditionally / anecdotal / unverified, stating explicitly the source, the conditions under which they were performed, and whether they can be generalized.
- **Input deliverables:** Inventory of where existing verification results reside, the obtained verification reports and raw data
- **Input source:** Advanced development & R&D department / own department (sorting)
- **Output deliverables:** Sorting table for existing verification results (item × result × verdict × conditions performed × generalizability)
- **Granularity / completeness:** Rough version — sorted by own department, not yet confirmed by the performing department
- **Predecessor / Successor:** Predecessor: SYS1-01-d / Successor: SYS1-01-o, SYS1-02-b, SYS1-06-a
- **Entry:** The verification results have been obtained (if none exist, skip this work item and treat the matter as a hypothesis)
- **Exit (DoD):** ① Every item is sorted into one of the four categories ② the conditions performed and the generalizability are stated explicitly ③ matters requiring additional verification have been identified
- **Concrete examples:** ① Mark "the accuracy of fatigue estimation holds under certain conditions" as *holds conditionally*, and state the conditions explicitly (daytime, expressway, a specific vehicle configuration). ② Mark an evaluation whose subjects were a handful of employees as *anecdotal*, stating explicitly that it cannot be generalized to general users. ③ Extract as matters requiring additional verification those things not verified but important to the plan (the reaction to a false detection, tolerance of the suggestion frequency, the reaction when passengers are present).

#### SYS1-01-f — Check similar precedents and previously dropped plans

- **Purpose:** Check similar precedents and plans dropped in the past, so as not to repeat the same failure.
- **Work content:** Confirm the track record of similar features in the company's other vehicle models and services, and the reasons why similar plans studied in the past were dropped.
- **Input deliverables:** Inventory of where existing verification results reside, past planning materials, performance data of existing features
- **Input source:** Product planning department / IVI development department / own department (past materials)
- **Output deliverables:** List of similar cases and reasons for dropping (case × content × outcome × implication for this plan)
- **Granularity / completeness:** Draft version — before confirmation by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-01-d / Successor: SYS1-01-o, SYS1-03-a
- **Entry:** The inquiry into existing verification results is complete
- **Exit (DoD):** ① The track record of similar features has been confirmed ② past reasons for dropping have been confirmed ③ the implications for this plan are documented
- **Concrete examples:** ① Check the fitment record of the company's existing rest-warning feature and driver monitor, together with the actual trigger frequency and user feedback. ② If a similar plan was dropped in the past, confirm the reason (cost-effectiveness, liability concerns, technical feasibility) and judge whether that reason still stands today. ③ As an implication, state explicitly that "if the reason for dropping has not been resolved, the conclusion will be the same", and make it an issue to be verified.

#### SYS1-01-g — First-pass grasp of the market and competitors

- **Purpose:** Get a first-pass grasp of the market and competitive situation, and confirm that the plan's premises match the current reality.
- **Work content:** Grasp market trends, competitors' fitment status, and user feedback as primary information, and surface the points that conflict with the plan's premises.
- **Input deliverables:** Market research reports (existing ones), public information (each company's service sites, owner's manuals), one-page plan summary
- **Input source:** External (public information, existing research reports)
- **Output deliverables:** First-pass market & competitor memo (what was grasped × implication × divergence from the plan's premises)
- **Granularity / completeness:** Rough version — primary information only; detailed research is SYS1-03
- **Predecessor / Successor:** Predecessor: SYS1-01-b / Successor: SYS1-01-o, SYS1-03-a
- **Entry:** The one-page plan summary has been created
- **Exit (DoD):** ① Market trends and competitors' fitment status have been grasped ② points conflicting with the plan's premises have been surfaced ③ matters to be passed to detailed research are stated explicitly
- **Concrete examples:** ① From public information, grasp whether competitors offer suggestion-type features and, if so, an outline of their trigger conditions and notification methods. ② Confirm whether the plan's premise "nobody else is doing this" is factually true, and if it is already commonplace, correct the premise. ③ Leave detailed comparison and benchmarking to activity 3; here, limit yourself to confirming the direction.

#### SYS1-01-h — Grasp the operations side's mandatory conditions and constraints

- **Purpose:** Grasp the operations side's mandatory conditions and constraints at an early stage.
- **Work content:** Confirm with the operations department the mandatory conditions and constraints of the operational work that comes with providing the service (data updates, inquiry handling, monitoring).
- **Input deliverables:** One-page plan summary, operating rules of existing services
- **Input source:** Operations department / customer support department
- **Output deliverables:** Business & operations requirements memo (task × mandatory condition × constraint × concern)
- **Granularity / completeness:** Draft version — confirmed by the operations department
- **Predecessor / Successor:** Predecessor: SYS1-01-b / Successor: SYS1-01-i, SYS1-07-d
- **Entry:** The one-page plan summary has been created
- **Exit (DoD):** ① The related operational tasks are enumerated ② the mandatory conditions and constraints are recorded ③ the operations department's concerns are recorded
- **Concrete examples:** ① Confirm how existing services actually operate with regard to updating rest-facility information (frequency, responsible department, cost). ② Confirm the contact point for handling inquiries caused by a suggestion, and whether the existing support structure can absorb them. ③ If constraints emerge from the operations department such as "we cannot take this on if it means more headcount", record them as preconditions of the plan.

#### SYS1-01-i — First-pass split between system scope and operational scope

- **Purpose:** Make a first-pass split between what will be realized by the system and what will be handled operationally.
- **Work content:** Sort the business & operations requirements, at a first pass, into matters realized by system functions and matters handled by operating rules and manual effort, leaving the matters that require a judgment.
- **Input deliverables:** Business & operations requirements memo, one-page plan summary
- **Input source:** Own department (sorting) / operations department
- **Output deliverables:** System vs. operations split table (requirement × system / operations / undecided × reason)
- **Granularity / completeness:** Rough version — sorted by own department, not yet confirmed by the departments involved
- **Predecessor / Successor:** Predecessor: SYS1-01-h / Successor: SYS1-01-o, SYS1-07-d
- **Entry:** The business & operations requirements have been grasped
- **Exit (DoD):** ① Every requirement is sorted into system / operations / undecided ② the reason for "undecided" is documented ③ for matters assigned to operations, the system support they need is recorded
- **Concrete examples:** ① Split it so that detecting errors in facility information is operations (weekly check), while applying the corrections is system (a management function). ② Requirements where the split cannot be judged are marked undecided, with the reason documented (a cost-versus-benefit comparison is needed), and become candidate issues for activity 7. ③ Even for matters assigned to operations, record the system support needed to make that operation work (report output, applying corrections).

#### SYS1-01-j — Fix the target vehicle-model, market, grade, and schedule premises

- **Purpose:** Fix the premises regarding target vehicle models, markets, grades, and the schedule.
- **Work content:** Confirm the premises for target vehicle models, destination markets, grades, SOP, IVI specification-freeze timing, and fitment conditions (DCM, navigation), and make the plan's study deadline explicit.
- **Input deliverables:** Product plan of the target vehicle model, per-model equipment plan, development schedule
- **Input source:** Product planning department / IVI development department
- **Output deliverables:** Target-premises table (model × destination market × grade × SOP × specification-freeze date × fitment conditions)
- **Granularity / completeness:** Fixed version — confirmed by the product planning and IVI development departments
- **Predecessor / Successor:** Predecessor: SYS1-01-a / Successor: SYS1-01-n, SYS1-05-m, SYS1-06-h, SYS1-07-h
- **Entry:** The product plan of the target vehicle model can be referenced
- **Exit (DoD):** ① The target models, destination markets, and grades have been identified ② the SOP and specification-freeze date are recorded ③ the fitment conditions (communication, navigation) have been confirmed
- **Concrete examples:** ① Identify the target as, e.g., "the ○○ segment with 2027 SOP, domestic market, upper grades", and confirm how lower grades are handled (not fitted, or a simplified version). ② Confirm the IVI specification-freeze date and grasp the study deadline derived backwards from it. ③ Confirm the fitment conditions for the DCM (communication module) and the factory navigation system, and record as a premise whether the service can be provided on vehicles without them.

#### SYS1-01-k — Grasp what is feasible on the IVI and its technical constraints

- **Purpose:** Grasp what is feasible on the IVI and its technical constraints, so as to avoid pie in the sky.
- **Work content:** Confirm with the IVI development department the constraints of the target IVI platform on screen specifications, notification means, vehicle-signal acquisition, OTA updates, and processing capacity.
- **Input deliverables:** Target-premises table, IVI platform specifications, existing vehicle-signal acquisition interface specifications
- **Input source:** IVI development department
- **Output deliverables:** IVI technical constraints list (item × constraint × source of confirmation × impact)
- **Granularity / completeness:** Fixed version — confirmed by the IVI development department
- **Predecessor / Successor:** Predecessor: SYS1-01-j / Successor: SYS1-01-o, SYS1-03-l, SYS1-04-k, SYS1-05-e
- **Entry:** The confirmation request to the IVI development department has been accepted
- **Exit (DoD):** ① The constraints on screens, notification, signal acquisition, and OTA are each recorded ② the source of confirmation (person, document) is recorded ③ the constraints that affect the plan have been identified
- **Concrete examples:** ① Confirm the usable notification means (banner, pop-up, voice, instrument-cluster integration) and the display restrictions while driving. ② Confirm the list of signals obtainable through the vehicle-signal acquisition API, and check whether the data you envisage — such as fatigue estimation — is included. ③ Confirm the scope that can be updated over the air (application layer only, or including the decision logic), and grasp how much room there is to change things after release.

#### SYS1-01-l — Decide who is consulted on what, and who decides what

- **Purpose:** Decide at the outset who is consulted on what, and who decides what.
- **Work content:** Enumerate the departments and people involved, and organize their roles (providing information / technical judgment / review / decision) together with the contact points and decision authority.
- **Input deliverables:** One-page plan summary, IVI technical constraints list, business & operations requirements memo, internal organizational information
- **Input source:** Own department (organizing) / planning owner
- **Output deliverables:** Stakeholder map (department × role × contact point × decision authority × timing of involvement)
- **Granularity / completeness:** Draft version — confirmed by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-01-h, SYS1-01-k / Successor: SYS1-01-n, SYS1-05-b, SYS1-05-l, SYS1-07-b, SYS1-07-k
- **Entry:** The potentially relevant departments have been grasped
- **Exit (DoD):** ① The departments involved are enumerated with no omissions ② roles and decision authority are stated explicitly ③ the timing at which involvement becomes necessary is documented
- **Concrete examples:** ① Enumerate IVI development, ADAS, vehicle control, cloud, legal, quality assurance, operations, design, and product planning, and assign a role to each. ② Identify "who in the ADAS department decides whether fatigue-estimation data can be provided", confirming it down to the person holding the decision authority. ③ Document the timing of involvement (at the integration study, at requirements definition) and make clear which departments should be brought in early.

#### SYS1-01-m — Define the terminology

- **Purpose:** Define terms that mean different things in different departments, to prevent later discussions from diverging.
- **Work content:** Define the main terms used in the plan, identify the terms interpreted differently by different departments, and unify them on a single definition.
- **Input deliverables:** One-page plan summary, IVI technical constraints list, specifications of existing features
- **Input source:** Own department (organizing) / IVI development department / ADAS department
- **Output deliverables:** Glossary (term × definition × cautions × interpretation differences between departments)
- **Granularity / completeness:** Draft version — before confirmation by the departments involved
- **Predecessor / Successor:** Predecessor: SYS1-01-b, SYS1-01-k / Successor: SYS1-01-o, SYS2-16-d
- **Entry:** The one-page plan summary and the IVI technical constraints list are both available
- **Exit (DoD):** ① The main terms are defined ② terms open to divergent interpretation have been identified ③ differences in naming versus existing features have been organized
- **Concrete examples:** ① State explicitly the definitions of "rest suggestion", "fatigue", "long-duration driving", and "while driving", provisionally deciding whether "while driving" means vehicle speed above ○ km/h or is based on the shift position. ② Define the difference between a "suggestion" and a "warning" (does it request a response, or does it call attention?), and sort out the overlap in naming with existing instrument-cluster warnings. ③ Build a mapping table for names that differ by department (the ADAS department's "driver state" versus the IVI side's "fatigue level").

#### SYS1-01-n — Set the study sequencing and the decision milestones

- **Purpose:** Decide the sequencing of the study and the decision-making checkpoints, making the plan work backwards from the deadline.
- **Work content:** Set the study tasks, owners, deadlines, and decision milestones, and create a study WBS derived backwards from the specification freeze and SOP.
- **Input deliverables:** Target-premises table, stakeholder map, separation table for decided items / hypotheses / undecided items
- **Input source:** Own department (planning) / planning owner
- **Output deliverables:** Study WBS (task × owner × deadline × deliverable), decision-milestone list
- **Granularity / completeness:** Draft version — approved by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-01-j, SYS1-01-l / Successor: SYS1-01-o, SYS1-06-b, SYS1-07-h
- **Entry:** The target-premises table and the stakeholder map are both available
- **Exit (DoD):** ① The study tasks with owners and deadlines are set ② the decision milestones are set ③ the long-lead-time work has been brought forward
- **Concrete examples:** ① Lay out the tasks of activities 2–6 and, working backwards from the specification-freeze date, place the timing of the decision-making meeting. ② Plan to start the long-lead-time work early (user interviews, quantitative research, inquiries to other departments about whether data can be provided). ③ State explicitly what will be decided at each milestone (the trigger-condition proposal to adopt, the integration scope, the scope).

#### SYS1-01-o — Consolidate the premises, constraints, and hypotheses into one document

- **Purpose:** Consolidate the premises, constraints, and hypotheses into a single document, to serve as the foundation for all subsequent study.
- **Work content:** Integrate the results of work items a–n into the planning-premises summary (draft version), attach an owner and a deadline to each undecided item, and obtain the planning owner's confirmation.
- **Input deliverables:** Higher-level-policy mapping table, one-page plan summary, separation table, sorting table for existing verification results, list of similar cases and reasons for dropping, first-pass market & competitor memo, system vs. operations split table, IVI technical constraints list, glossary, study WBS
- **Input source:** Own department (integration) / planning owner (confirmation)
- **Output deliverables:** Planning-premises summary (draft version), undecided-items list (item × owner × deadline)
- **Granularity / completeness:** Draft version — confirmed by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-01-c, SYS1-01-e, SYS1-01-f, SYS1-01-g, SYS1-01-i, SYS1-01-k, SYS1-01-m, SYS1-01-n / Successor: SYS1-02-a, SYS1-03-a, SYS1-05-a, SYS1-06-a
- **Entry:** The deliverables of work items a–n are all available
- **Exit (DoD):** ① Premises, constraints, hypotheses, and undecided items are consolidated in one document ② every undecided item has an owner and a deadline ③ the planning owner's confirmation is complete
- **Concrete examples:** ① Divide the document into chapters for "what is settled", "hypotheses", and "undecided", stating the source of each explicitly. ② Set a responsible department and an answer deadline for the undecided items (whether fatigue-estimation data can be provided, whether the service is offered on lower grades). ③ Read through it with the planning owner, correct the places where understanding differs (the assumed range of target vehicle models), and finalize the revision.

---

### SYS1-02 (L2) — Refining the value proposition, personas, and usage context

- **ASPICE BP:** Pre-SYS.1 stage (BP2 preparation)
- **Purpose:** Put into words, with supporting rationale, whose inconvenience is being resolved and how, and make clear the contexts where it lands and the constraints.
- **Work content:** Carry out work items a–r, produce the value-proposition definition (draft version), and agree it with the planning owner.
- **Input deliverables:** Planning-premises summary, one-page plan summary, sorting table for existing verification results, research fact–implication table, hearing minutes
- **Input source:** Own department (deliverables from the preceding step) / external (research agencies)
- **Output deliverables:** Value-proposition definition (draft version: value statement / persona sheet / usage-context matrix / JTBD / interview results)
- **Granularity / completeness:** Draft version — reviewed by the planning owner, not yet approved by the decision-making meeting
- **Predecessor / Successor:** Predecessor: SYS1-01 / Successor: SYS1-03, SYS1-04
- **Entry:** The planning-premises summary (draft version) has been distributed
- **Exit (DoD):** The value-proposition definition (draft version) has been confirmed by the planning owner, and every item has been assigned an ID
- **Concrete examples:** (see the work items beneath) making the pain points concrete, writing the value statement in the prescribed pattern, identifying the situations where it lands using the context matrix, exploring the acceptable frequency in interviews.

#### SYS1-02-a — Put the pain points into words

- **Purpose:** Put the abstract aim of the plan into words as concrete pain points.
- **Work content:** Rewrite the aim in the plan document into concrete pain points of the form "who / in what situation / to what degree is troubled", and organize the frequency, severity, and current coping behavior.
- **Input deliverables:** One-page plan summary, hearing minutes, planning-premises summary
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Pain-point list (pain point × situation × frequency × severity × current coping × presence of evidence)
- **Granularity / completeness:** Rough version — created by the planning owner, not yet confirmed by the departments involved
- **Predecessor / Successor:** Predecessor: SYS1-01-o / Successor: SYS1-02-b
- **Entry:** The planning-premises summary (draft version) and the glossary (rough version) can be referenced
- **Exit (DoD):** ① 3–5 pain points are described, each with a concrete situation ② each pain point has its frequency, severity, and current coping documented ③ the presence or absence of evidence is stated explicitly
- **Concrete examples:** ① Rewrite "reducing accident risk from driver fatigue" into pain points such as "on a long drive you cannot decide when to take a break yourself, and by the time you notice you are tired you have already passed the rest facility". ② Enumerate the situations in which the pain point arises (continuous expressway driving, congestion when travelling home for the holidays, driving late at night, being reluctant to stop because a child is asleep). ③ For each pain point, write how people cope today (a passenger speaking up, vaguely stopping at the next service area) and assess how well that coping works.
- **AI hypothesis-driven applicability:** ◯

#### SYS1-02-b — Back up the pain points with third-party data

- **Purpose:** Back up the real existence of the pain points with third-party data, distinguishing hypotheses from facts.
- **Work content:** Collect data backing up the pain points from VOC, call-center records, app reviews, public statistics, and PoC results, and sort them by whether they are backed up.
- **Input deliverables:** Pain-point list, VOC and call-center records, app reviews, public statistics, sorting table for existing verification results, research fact–implication table
- **Input source:** Own department (in-house data) / external (public statistics)
- **Output deliverables:** Pain-point evidence table (pain point × supporting data × source × strength of evidence)
- **Granularity / completeness:** Rough version — created by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-02-a, SYS1-01-e, -h / Successor: SYS1-02-c, SYS1-02-m
- **Entry:** The pain-point list has been created and access to in-house data has been granted
- **Exit (DoD):** ① Each pain point has been assigned the presence and strength of supporting data ② pain points without evidence have been downgraded to hypotheses and passed on as verification items
- **Concrete examples:** ① Extract remarks about "rest", "tiredness", and "long distance" from call-center inquiries, app reviews, and social-media posts, and confirm that the pain points really exist. ② Check public statistics (from JAF, the National Police Agency, etc.) on the share of accidents caused by falling asleep or inattentive driving, obtaining backing for it as a social issue. ③ Pain points for which no backing can be obtained (e.g. "I can't bring myself to suggest a break out of consideration for the passengers") are downgraded to hypotheses and passed on as items to confirm in interviews.

#### SYS1-02-c — Express the value proposition as a one-sentence pattern

- **Purpose:** Express the value proposition in a one-sentence pattern, so that everyone involved can articulate the same value.
- **Work content:** Draft several value statements in the pattern "when 〈persona〉 has 〈pain point〉 in 〈context〉, 〈service〉, unlike 〈alternative means〉, delivers 〈benefit〉 through 〈differentiation〉", and narrow them to one through a read-through.
- **Input deliverables:** Pain-point list, pain-point evidence table, one-page plan summary
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Value statement (1 adopted + alternatives, definitions of the terms)
- **Granularity / completeness:** Rough version — before the read-through / Draft version — read through with the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-02-b / Successor: SYS1-02-d, SYS1-02-e
- **Entry:** The main pain points have been identified in the pain-point evidence table
- **Exit (DoD):** ① 3–5 statements following the pattern have been drafted ② one has been adopted through the read-through, with the reason for adoption recorded ③ the abstract terms have been made concrete
- **Concrete examples:** ① Draft 3–5 following the pattern, read them through with the planning owner, and make concrete the terms that feel off (e.g. "peace of mind" is too abstract, "optimal" has no basis). ② Take the most convincing one as primary, and retain the benefits contained in the remaining ones as hints for candidate features. ③ Show the statement to a few uninvolved colleagues to test whether the wording is understandable to a general user.

#### SYS1-02-d — Decompose the types of value

- **Purpose:** Decompose the types of value, distinguishing value that could be charged for from value where the way it is communicated is what matters.
- **Work content:** Decompose the value proposition into functional, emotional, and economic value, and assess how aware the user is of each and whether it could be charged for.
- **Input deliverables:** Value statement, pain-point list
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Value-decomposition table (value type × content × user awareness × chargeability × hand-off note to experience design)
- **Granularity / completeness:** Rough version — created by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-02-c / Successor: SYS1-02-i, SYS1-06-a
- **Entry:** The value statement has reached draft-version status
- **Exit (DoD):** ① Value is described for all three types (with "not applicable" stated explicitly where relevant) ② each value has user awareness and chargeability assigned ③ the hand-off note to experience design is documented
- **Concrete examples:** ① Describe it split into functional value (guiding to a rest location at the appropriate time), emotional value (peace of mind when driving with family aboard, a trigger for admitting you are tired), and economic value (avoiding accidents and lost time). ② For each value, assess "is the user aware of it?" and "could it be the subject of a monthly subscription?", and if it is mainly emotional value, hand off to the business-viability study the possibility that standalone charging will be difficult. ③ If emotional value is central, make it a hand-off note to experience design that the tone of the suggestion wording (supportive rather than imperative) determines the value.

#### SYS1-02-e — Enumerate the alternative means and hypothesize comparative advantage

- **Purpose:** Surface the alternative means users currently rely on, and form hypotheses about comparative advantage.
- **Work content:** Enumerate the alternative means (smartphone apps, existing in-vehicle features, passengers, one's own senses), and tabulate hypotheses about the advantages and disadvantages of delivering it on the IVI.
- **Input deliverables:** Value statement, pain-point list, IVI technical constraints list
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Alternative-means comparison hypothesis table (alternative means × advantage hypothesis × disadvantage hypothesis × whether verification is needed)
- **Granularity / completeness:** Rough version — hypothesis stage; verified in the competitor research (SYS1-03)
- **Predecessor / Successor:** Predecessor: SYS1-02-c / Successor: SYS1-03-a, SYS1-03-l
- **Entry:** The value statement has reached draft-version status
- **Exit (DoD):** ① At least 5 alternative means are enumerated ② each alternative means has advantage and disadvantage hypotheses documented ③ value elements whose advantage cannot be put into words are recorded as candidates for removal from the plan
- **Concrete examples:** ① Enumerate the alternative means (a smartphone app's rest notification, the existing driving-time warning, a passenger speaking up, one's own senses, the guide signs for service and parking areas). ② For each alternative means, tabulate the advantages of delivering it on the IVI (large screen, linkage with nearby service/parking-area information, accuracy based on vehicle state, no operation required) and the disadvantages (facility information updated more slowly than on a smartphone, limited to when the factory navigation is in use). ③ Record value elements whose advantage cannot be put into words (e.g. a mere notification of elapsed time) as candidates for removal from the plan.

#### SYS1-02-f — Identify the primary persona

- **Purpose:** Identify as the primary persona the audience the value lands with most strongly, and also make clear who is out of scope.
- **Work content:** Set primary and secondary personas from the customer-segment data, and create a persona sheet documenting attributes, vehicle usage, IT literacy, and driving attitude.
- **Input deliverables:** Customer-segment data, market & competitor research reports, pain-point evidence table
- **Input source:** Own department (in-house data) / external (research agencies)
- **Output deliverables:** Persona sheet (1 primary, 2–3 secondary, out-of-scope segments)
- **Granularity / completeness:** Rough version — created by the planning owner; updated after the interviews
- **Predecessor / Successor:** Predecessor: SYS1-02-b / Successor: SYS1-02-g, SYS1-02-n
- **Entry:** The customer-segment data, or the segment information in a research report, can be referenced
- **Exit (DoD):** ① One primary persona is set ② 2–3 secondary personas are set, and the out-of-scope segments are stated explicitly ③ each persona documents attributes, vehicle usage, IT literacy, and driving attitude
- **Concrete examples:** ① From the existing customer-segment data, extract the segments the rest suggestion is likely to land with (long-distance driving at least once a month, frequently carrying children) and set them as primary. ② Set 2–3 secondary personas (sales-fleet drivers, elderly drivers, young drivers who have just got their licence), and also state explicitly the segments treated as "out of scope because they only drive short distances". ③ For each persona, document as a hypothesis "the reaction they are likely to have to a suggestion" (comply readily / find it annoying / defer the judgment to a passenger).

#### SYS1-02-g — Grasp the actual usage per persona

- **Purpose:** Grasp the actual usage per persona, and get a sense of the scale of the opportunities in which the feature would trigger.
- **Work content:** Organize usage frequency, driving distance, time of day, passengers, and destination tendencies per persona, and if driving logs are available, calculate the incidence of long-duration driving.
- **Input deliverables:** Persona sheet, connected driving logs (if any), market & competitor research reports
- **Input source:** Own department (in-house data) / external (research agencies)
- **Output deliverables:** Actual-usage table (persona × frequency × distance × time of day × passengers × purpose), trigger-opportunity estimate (incidence of long-duration driving)
- **Granularity / completeness:** Rough version — accuracy varies with data availability, so state the source explicitly
- **Predecessor / Successor:** Predecessor: SYS1-02-f / Successor: SYS1-02-h, SYS1-06-h
- **Entry:** The persona sheet has been created
- **Exit (DoD):** ① The actual usage per persona is tabulated ② the scale of the trigger opportunity is estimated (e.g. the number of continuous drives of 90 minutes or more per month) ③ items provisionally filled in for lack of data are recorded as research items
- **Concrete examples:** ① From the connected driving logs, calculate the share of all trips accounted for by continuous drives of 90 minutes or more and the number of occurrences per user per month, to grasp the scale of the trigger opportunity. ② Where logs are unavailable, produce a substitute estimate from figures such as "annual number of long-distance drives" in the research reports, noting that the accuracy is low. ③ Because passenger presence and time of day often cannot be obtained from logs, record them as items to be supplemented by survey.

#### SYS1-02-h — Organize the usage-context matrix

- **Purpose:** Organize exhaustively the contexts in which the feature could trigger, and narrow the study scope.
- **Work content:** Create a usage-context matrix of vehicle state × passengers × purpose of use, and fill in for each cell whether triggering is possible and who operates it.
- **Input deliverables:** Persona sheet, actual-usage table, glossary (definitions of "while driving" and "while stopped")
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Usage-context matrix (vehicle state × passengers × purpose × whether triggering is possible × operator)
- **Granularity / completeness:** Rough version — created by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-02-g / Successor: SYS1-02-i, SYS1-02-j, SYS1-04-a
- **Entry:** The actual-usage table has been created and the definitions of "while driving" and "while stopped" have been provisionally set
- **Exit (DoD):** ① Whether triggering is possible is filled in for every cell of the matrix ② the cells where triggering is not envisaged are stated explicitly ③ the operator (driver / passenger) is filled in
- **Concrete examples:** ① Build a matrix with vehicle state on the vertical axis (driving / stopped / parked), passengers on the horizontal axis (alone / family / colleagues or customers), and purpose in depth (commuting / leisure / business). ② Fill in for each cell "could the feature trigger?" and "if it triggers, who operates it?", stating explicitly the cells where triggering is not envisaged — such as a rest suggestion while parked — in order to narrow the study scope. ③ Note the cell-specific cautions, such as the awkwardness of displaying a fatigue estimate while colleagues or customers are aboard.

#### SYS1-02-i — Evaluate the strength of value per context

- **Purpose:** Assess in which context the value is strongest, and provisionally decide the main battleground for the initial release.
- **Work content:** Rate the strength of the value proposition in each context cell on a 3-point scale with supporting rationale, and provisionally set the "strong" contexts as the main battleground for the initial release.
- **Input deliverables:** Usage-context matrix, value-decomposition table, pain-point evidence table
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Per-context value assessment (cell × strength × rationale), provisional decision on the main-battleground context
- **Granularity / completeness:** Rough version — updated with the interview results
- **Predecessor / Successor:** Predecessor: SYS1-02-h, SYS1-02-d / Successor: SYS1-02-n, SYS1-04-a
- **Entry:** The usage-context matrix has been created
- **Exit (DoD):** ① Every cell has a strength rating and rationale assigned ② 1–2 main-battleground contexts have been provisionally decided
- **Concrete examples:** ① Rate the strength of the value for each context cell on a 3-point scale (e.g. long-distance leisure with family aboard = strong, commuting alone = weak, long-distance business driving = medium). ② Note the basis of the rating alongside it (a PoC utterance, research data, the assessment of the person interviewed), and confirm through interviews any cell whose only basis is that person's assessment. ③ Provisionally set the "strong" contexts as the main battleground for the initial release, and leave as an open issue whether to trigger in the "weak" contexts.

#### SYS1-02-j — Grasp the experience-design constraints per context

- **Purpose:** Grasp the experience-design constraints per context, and hand them off to the downstream scenario design.
- **Work content:** Organize the constraints that arise in each context (operation restrictions while driving, the presence of passengers, company rules) and turn them into hand-off items for experience design.
- **Input deliverables:** Usage-context matrix, IVI technical constraints list, HMI guidelines
- **Input source:** Own department (deliverables from the preceding step) / IVI development department
- **Output deliverables:** Per-context constraint table (cell × constraint × hand-off destination)
- **Granularity / completeness:** Rough version — created by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-02-h / Successor: SYS1-04-l, SYS1-04-m
- **Entry:** The usage-context matrix and the IVI technical constraints list have been created
- **Exit (DoD):** ① Constraints are documented for the main cells ② a hand-off destination (experience design / integration study / business viability) is assigned
- **Concrete examples:** ① Record as a constraint that, because gaze movement and operation are restricted while driving, the information volume of the suggestion must be limited. ② Where passengers are present, record both sides: the possibility that a passenger can operate it on the driver's behalf, and conversely the need for consideration of privacy (displaying a fatigue estimate). ③ For business use, include in the constraints the relationship with the company's operations-management rules (recording mandatory rest), and hand off the possibility of a B2B rollout to the business-viability study.

#### SYS1-02-k — Organize the JTBD

- **Purpose:** Organize what users are really trying to accomplish, to have an axis for selecting among feature ideas.
- **Work content:** Write out the functional, emotional, and social jobs, describe the service's contribution to each, and lower the priority of feature ideas that fall outside the jobs.
- **Input deliverables:** Value statement, pain-point list, hearing minutes
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** JTBD summary table (job type × content × the service's contribution × related candidate features)
- **Granularity / completeness:** Rough version — created by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-02-c / Successor: SYS1-02-l, SYS1-06-m
- **Entry:** The value statement has reached draft-version status
- **Exit (DoD):** ① Jobs are described for all three types ② the service's contribution to each job is described ③ candidate features falling outside the jobs are recorded as low priority
- **Concrete examples:** ① Write out the functional job (arrive at the destination safely), the emotional jobs (wanting a trigger to admit you are tired, the felt sense of protecting your family), and the social job (wanting your family to think of you as a good driver). ② Describe in one sentence how the service contributes to each job. ③ Feature ideas that fall outside the jobs (e.g. distributing coupons for the rest destination) are lowered in priority and assessed separately as a revenue means in the business-viability study.

#### SYS1-02-l — Hypothesize the drivers of adoption, continuation, and abandonment

- **Purpose:** Turn the factors behind starting, continuing, and abandoning use into hypotheses, and connect the abandonment factors to experience-design requirements.
- **Work content:** Enumerate at least 5 hypotheses each for reasons to start using, keep using, and stop using, and turn them into hand-off items for experience design.
- **Input deliverables:** JTBD summary table, pain-point list, cancellation-reason data of existing services (if any)
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Usage-motivation & abandonment-factor hypothesis table (category × reason × evidence × hand-off)
- **Granularity / completeness:** Rough version — verified through interviews
- **Predecessor / Successor:** Predecessor: SYS1-02-k / Successor: SYS1-02-n, SYS1-04-f, SYS1-06-f
- **Entry:** The JTBD summary table has been created
- **Exit (DoD):** ① At least 5 hypotheses are enumerated for each of the three categories ② the candidate experience-design requirements that address the abandonment factors are documented
- **Concrete examples:** ① Enumerate at least 5 each of reasons to start using (on by default at initial setup, recommended by family, explained by the dealer), reasons to keep using (the suggestions are on point, the rest destinations are convenient), and reasons to stop (annoying, false detections, the map gets hidden, no perceived point). ② Because the reasons to stop connect directly to experience-design requirements (frequency control, an off setting, a layout that does not hide the map), organize them as hand-offs to the downstream activities. ③ If cancellation-reason data for existing connected services is available, refer to it and extract the abandonment patterns in common.

#### SYS1-02-m — Raise the falsification hypotheses

- **Purpose:** Raise up front the falsification hypotheses that could negate the plan's value, and identify the issues that verification must eliminate.
- **Work content:** Enumerate the falsification hypotheses, assess the impact if each turned out to be true, and assign a verification priority.
- **Input deliverables:** Value statement, pain-point evidence table, alternative-means comparison hypothesis table
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Falsification-hypothesis list (hypothesis × impact if true × verification method × priority)
- **Granularity / completeness:** Rough version — created by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-02-b, SYS1-02-e / Successor: SYS1-02-n, SYS1-06-a
- **Entry:** The pain-point evidence table and the alternative-means comparison hypothesis table have been created
- **Exit (DoD):** ① At least 5 falsification hypotheses are enumerated ② an impact assessment and verification priority are assigned
- **Concrete examples:** ① Enumerate falsification hypotheses such as "users can judge when to rest by themselves, so suggestions are unnecessary", "a smartphone notification is enough", "it is unnecessary when passengers are aboard", and "even when suggested, they do not actually stop". ② Assess the impact on the plan if each falsification hypothesis were true (the value disappears / it is only valid in a specific context / it is a matter of how the value is communicated). ③ Designate the high-impact falsification hypotheses as mandatory confirmation items in the interviews and survey.

#### SYS1-02-n — Design the interviews

- **Purpose:** Design interviews to verify the value proposition and the falsification hypotheses against primary information.
- **Work content:** Create an interview plan covering the target conditions, recruiting method, question items, and the order in which the concept is presented.
- **Input deliverables:** Persona sheet, per-context value assessment, falsification-hypothesis list, usage-motivation & abandonment-factor hypothesis table
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Interview plan (targets, number of participants, recruiting, questionnaire, concept sheet, schedule)
- **Granularity / completeness:** Fixed version — confirmed by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-02-f, -i, -l, -m / Successor: SYS1-02-o
- **Entry:** The persona sheet and the falsification-hypothesis list have been created, and the research budget has been secured
- **Exit (DoD):** ① The target conditions and the number of participants (around 10) are fixed ② the questionnaire includes items confirming the falsification hypotheses ③ recruiting has been arranged
- **Concrete examples:** ① Decide the target conditions (8 people matching the primary persona, 2–3 secondary) and the recruiting method (a monitor panel, dealer cooperation). ② Include in the question items "your recent long-distance driving experience", "how you decide when to rest", "would you find being prompted to rest while driving annoying?", and "what frequency would you accept?", designing it to probe the threshold of acceptable frequency. ③ Order the questions so that reactions before and after presenting the concept sheet (a one-page service outline) can be compared.

#### SYS1-02-o — Conduct the interviews

- **Purpose:** Record users' raw reactions and their own phrasing, obtaining the primary information for analysis.
- **Work content:** Conduct the interviews according to the plan, transcribe the utterances verbatim, and record the contexts in which reactions such as "annoying" appeared, along with unanticipated requests.
- **Input deliverables:** Interview plan, concept sheet
- **Input source:** Own department (execution) / external (recruiting agency)
- **Output deliverables:** Interview records (verbatim transcripts, observation notes, unanticipated requests)
- **Granularity / completeness:** Fixed version — settled as a record
- **Predecessor / Successor:** Predecessor: SYS1-02-n / Successor: SYS1-02-p
- **Entry:** Recruiting is complete, and the note-taker and the interview environment are secured
- **Exit (DoD):** ① There are verbatim records for the planned number of participants ② the question and the material presented immediately before each reaction are recorded ③ unanticipated requests are recorded separately
- **Concrete examples:** ① Run 60 minutes per participant and transcribe the utterances verbatim. ② Record the question and the material presented (frequency, wording, timing) immediately before the moment a participant said "annoying" or "none of your business", using it as a clue to the acceptability threshold. ③ Record separately, as ideas, unanticipated uses and requests (e.g. also wanting to know refuelling / charging timing rather than rest, wanting the children's toilet breaks taken into account).

#### SYS1-02-p — Analyze the interview results

- **Purpose:** Extract from the interview results how strongly the value lands, the acceptable frequency, and any mismatch in the personas.
- **Work content:** Classify and tally the utterances, and analyze the degree of empathy with the value, the threshold of acceptable frequency, and candidate corrections to the persona definitions.
- **Input deliverables:** Interview records, falsification-hypothesis list, persona sheet
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Interview analysis results (empathy classification × proportion × conditions, acceptable-frequency threshold, candidate persona corrections, verdict on each falsification hypothesis)
- **Granularity / completeness:** Fixed version — settled as the analysis result
- **Predecessor / Successor:** Predecessor: SYS1-02-o / Successor: SYS1-02-q
- **Entry:** Interview records for the planned number of participants are all available
- **Exit (DoD):** ① Utterances are classified into empathetic / sceptical / conditional, with proportions calculated ② the acceptable-frequency threshold is extracted with the supporting utterances ③ each falsification hypothesis has a supported / not-supported verdict
- **Concrete examples:** ① Classify the utterances into "empathizes with the value", "sceptical of the value", and "conditional empathy (e.g. only when family is aboard)", and organize the proportions and conditions. ② Extract the acceptable-frequency threshold from the utterances (e.g. once every 2 hours is fine, every 30 minutes is not, repeating the same suggestion is not). ③ Turn the points where the persona definitions diverged from reality (e.g. driving alone is more common than assumed, long distances on ordinary roads are more common than on expressways) into candidate corrections.

#### SYS1-02-q — Update the personas, contexts, and value statement

- **Purpose:** Reflect the verification results, updating the descriptions of personas, contexts, and value to match reality.
- **Work content:** Revise the persona sheet, context matrix, and value statement to reflect the analysis results, and record the reasons for the changes and their impact on the plan's premises.
- **Input deliverables:** Interview analysis results, persona sheet, usage-context matrix, value statement
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Updated persona sheet, context matrix, and value statement (with change history)
- **Granularity / completeness:** Draft version — before the review meeting
- **Predecessor / Successor:** Predecessor: SYS1-02-p / Successor: SYS1-02-r
- **Entry:** The interview analysis results are settled
- **Exit (DoD):** ① The changes and their reasons are recorded in the change history ② the impact on the plan's premises (target market size, etc.) is stated explicitly
- **Concrete examples:** ① Revise the persona sheet, context matrix, and value statement to reflect the analysis results, recording the changes and reasons in the change history. ② If a persona change alters the target market size, state explicitly the impact on the plan document's market-size estimate and hand it off to the business-viability study. ③ Incorporate the phrasing obtained in the interviews (e.g. "I know I ought to take a break, but there's no trigger for it") into the wording of the value statement.

#### SYS1-02-r — Agree the value proposition with the planning owner

- **Purpose:** Obtain the planning owner's agreement on the value proposition, personas, and contexts, making it the reference baseline for downstream study.
- **Work content:** Present the updated versions at the review meeting, confirm alignment with the planning owner's intent, and finalize the value-proposition definition (draft version) reflecting the feedback.
- **Input deliverables:** Updated persona sheet, context matrix, and value statement; JTBD summary table; usage-motivation & abandonment-factor hypothesis table
- **Input source:** Planning owner (presentation, review)
- **Output deliverables:** Value-proposition definition (draft version: IDs assigned to each item, undecided items stated explicitly), review minutes
- **Granularity / completeness:** Draft version — reviewed by the planning owner, not yet approved by the decision-making meeting
- **Predecessor / Successor:** Predecessor: SYS1-02-q / Successor: SYS1-03-a, SYS1-04-a, SYS1-06-a
- **Entry:** The updated deliverables are all available and the review meeting has been scheduled
- **Exit (DoD):** ① Review feedback is sorted into reflected / deferred / declined, with the reasons recorded ② an ID is assigned to each item ③ the decision-makers' concerns are transferred to the issue list
- **Concrete examples:** ① Present the value statement, personas, and context matrix at the review meeting, and confirm whether they match the planning owner's intent and whether the intent changed as a result of the interviews. ② Sort the feedback into "reflect", "defer", and "decline", recording the reasons. ③ Transfer the decision-makers' concerns (e.g. "could displaying a fatigue estimate create a liability problem in the event of an accident?") to the issue list, to be handled in the downstream consultation-driving phase.

---

### SYS1-03 (L2) — Competitor / alternative-means research and differentiation

- **ASPICE BP:** Pre-SYS.1 stage
- **Purpose:** Compare against other companies' IVI, smartphone apps, and retrofit devices, and fix the necessity of the company delivering this on IVI together with the differentiation axes.
- **Work content:** Carry out work items a–o, produce the differentiation summary (draft version), and agree the differentiation axes with the planning owner.
- **Input deliverables:** Value-proposition definition (draft version), alternative-means comparison hypothesis table, market & competitor research reports, planning-premises summary
- **Input source:** Own department (deliverables from the preceding step) / external (public information, actual vehicles)
- **Output deliverables:** Differentiation summary (draft version: feature comparison table / UX walkthrough / differentiation points / IVI necessity / smartphone-integration role division / price benchmarks)
- **Granularity / completeness:** Draft version — reviewed by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-02 / Successor: SYS1-04, SYS1-06
- **Entry:** The value-proposition definition (draft version) is settled
- **Exit (DoD):** The differentiation summary (draft version) has been confirmed, and the differentiation axes are narrowed to 1–2
- **Concrete examples:** (see the work items beneath) benchmarking the behavior of suggestion-type features on actual vehicles and test drives, checking for duplicate notifications alongside smartphone notifications, putting into words why it must be delivered on IVI, and the policy for handling CarPlay use.

#### SYS1-03-a — Select the comparison targets

- **Purpose:** Narrow down to the targets worth comparing, and assign a research method to each.
- **Work content:** Select about 10 comparison targets from other companies' IVI, smartphone navigation, smartphone integration, retrofit devices, and the company's own existing features, and assign a research method according to availability.
- **Input deliverables:** Alternative-means comparison hypothesis table, market & competitor research reports, planning-premises summary
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Comparison-target list (target × category × reason for selection × research method × owner)
- **Granularity / completeness:** Fixed version — confirmed by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-02-r, SYS1-02-e, SYS1-01-g / Successor: SYS1-03-b
- **Entry:** The comparative-advantage hypotheses in the value-proposition definition can be referenced
- **Exit (DoD):** ① The comparison targets are narrowed to about 10 with the reason for selection documented ② a research method (public information / test drive / actual use) is assigned to each target
- **Concrete examples:** ① Put forward as candidates other companies' factory IVI (2–3 Japanese OEMs, 1–2 European OEMs, Tesla, etc.), smartphone navigation (Google Maps, Yahoo! Car Navi), smartphone integration (CarPlay / Android Auto), retrofit devices (drowsiness warnings in dashcams), and the company's own existing features. ② Against the comparative-advantage hypotheses in the value-proposition definition, narrow to the targets worth comparing (e.g. exclude models with no suggestion-type feature). ③ Confirm the availability of dealers or rental cars for test drives, and state explicitly which targets can only be covered by public information.

#### SYS1-03-b — Define the research items and recording format

- **Purpose:** Define research items and a recording format that compare not just the presence of features but the quality of the experience.
- **Work content:** Itemize features, trigger conditions, notification means, frequency control, off settings, facility linkage, monetization, and use of vehicle data, and create the assessment criteria for experience quality together with a recording template.
- **Input deliverables:** Comparison-target list, value-proposition definition, usage-motivation & abandonment-factor hypothesis table
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Research-item definition (item × definition × assessment criteria), research recording template
- **Granularity / completeness:** Fixed version — settled within the planning owner's organization
- **Predecessor / Successor:** Predecessor: SYS1-03-a / Successor: SYS1-03-c, -d, -e, -f
- **Entry:** The comparison-target list is settled
- **Exit (DoD):** ① There are items for both feature presence and experience quality ② the assessment criteria are defined, e.g. on a 5-point scale ③ the recording template has fields for evidence (screenshots, video)
- **Concrete examples:** ① Itemize feature presence, trigger conditions, notification means (banner / voice), frequency control, off settings, nearby-facility linkage, monetization, and cross-domain integration (use of vehicle data). ② Define as 5-point-scale criteria the viewpoints that measure "experience quality" (how pushy the suggestion wording is, how easy it is to dismiss, how much it obstructs the map). ③ Provide fields in the research recording template for screenshots, video, the number of operations required, and the seconds taken.

#### SYS1-03-c — Research the public information

- **Purpose:** Grasp from public information each target's features, future direction, and user ratings.
- **Work content:** Research owner's manuals, press releases, trade-show information, and app-store reviews, and record the relevant features together with complaints and praise.
- **Input deliverables:** Comparison-target list, research-item definition
- **Input source:** External (public information)
- **Output deliverables:** Public-information research record (target × item × content × source)
- **Granularity / completeness:** Rough version — public information only, not confirmed on actual units
- **Predecessor / Successor:** Predecessor: SYS1-03-b / Successor: SYS1-03-g, SYS1-03-n
- **Entry:** The research-item definition is settled
- **Exit (DoD):** ① Manuals and public information have been checked for every target ② features planned for future fitment are recorded ③ complaints and praise have been extracted from the reviews
- **Concrete examples:** ① Search each company's owner's manual (web edition) for keywords such as "rest", "fatigue", "driver monitor", and "recommended", and record the trigger conditions and display methods of the matching features. ② Grasp from press releases and trade-show information the suggestion-type features planned for future fitment. ③ Extract from app-store reviews the complaints ("too many notifications", "gets in the way", "can't work out how to turn it off") and the praise ("it helped"), to get a feel for the going frequency.

#### SYS1-03-d — Benchmark on actual vehicles

- **Purpose:** Experience how suggestion-type features actually behave in a real vehicle, grasping the experience quality that public information cannot reveal.
- **Work content:** Operate other companies' IVI suggestion-type features in an actual vehicle or on a dealer test drive, and record the display timing, frequency, how to dismiss it, the operation restrictions, and how much it obstructs the map.
- **Input deliverables:** Comparison-target list, research recording template
- **Input source:** External (dealers, rental cars)
- **Output deliverables:** Actual-vehicle benchmark record (target × item × rating × evidence)
- **Granularity / completeness:** Fixed version — confirmed on an actual vehicle
- **Predecessor / Successor:** Predecessor: SYS1-03-b / Successor: SYS1-03-g, SYS1-03-h
- **Entry:** The test drive / rental arrangements are complete
- **Exit (DoD):** ① Every item is recorded for the test-drive targets ② the evidence (photos, video) is stored ③ the range of operation restrictions while driving is recorded
- **Concrete examples:** ① Operate the IVI-installed services of Japanese OEMs in an actual vehicle or on a dealer test drive, and benchmark the display timing, frequency, and dismissal method of the suggestion-type features. ② Record the range over which operation restrictions apply while driving (touch disabled, voice only, how passenger operation is handled). ③ Film and record how much the map is hidden while a suggestion is displayed, and whether the route-guidance display is maintained.

#### SYS1-03-e — Benchmark smartphones and smartphone integration

- **Purpose:** Grasp the experience of the closest alternative means — smartphone apps and smartphone integration — and surface coexistence issues such as duplicate notifications.
- **Work content:** Confirm on the road the suggestion features of smartphone navigation apps during long drives, and record the display constraints via CarPlay / Android Auto and the experience of duplicate notifications.
- **Input deliverables:** Comparison-target list, research recording template
- **Input source:** External (apps) / own department (on-road driving)
- **Output deliverables:** Smartphone and smartphone-integration benchmark record
- **Granularity / completeness:** Fixed version — confirmed through actual use
- **Predecessor / Successor:** Predecessor: SYS1-03-b / Successor: SYS1-03-g, SYS1-03-m
- **Entry:** The research recording template is settled
- **Exit (DoD):** ① The presence and display method of the main apps' suggestion features are recorded ② the expression constraints under smartphone integration are recorded ③ the experience of duplicate notifications is recorded
- **Concrete examples:** ① Confirm on the road, using Google Maps and car-navigation apps, whether rest and refuelling suggestions appear during long drives and how they are displayed. ② Confirm the expression constraints when displayed on the IVI screen via CarPlay / Android Auto (the types of notification available, how voice is handled). ③ Record the experience when a smartphone notification and an IVI notification appear simultaneously (duplicate notification, overlapping voice), and organize it as a coexistence issue.

#### SYS1-03-f — Research retrofit devices and the company's own existing features

- **Purpose:** Grasp the warning specifications of retrofit devices and the company's own existing features, and turn overlaps and contradictions with the new service into open issues.
- **Work content:** Research the warning conditions of dashcams and drowsiness-prevention devices, and the specifications and actual trigger record of the company's existing vehicle features (instrument-cluster rest warning, driver monitor).
- **Input deliverables:** Comparison-target list, specifications of the company's existing features, instrument-cluster warning specifications
- **Input source:** External (public information) / vehicle control & ADAS departments
- **Output deliverables:** Existing-feature and retrofit research record, memo on overlap / contradiction issues
- **Granularity / completeness:** Fixed version — specifications confirmed
- **Predecessor / Successor:** Predecessor: SYS1-03-b / Successor: SYS1-03-g, SYS1-05-h
- **Entry:** Permission to view the specifications of the company's existing features has been granted
- **Exit (DoD):** ① The warning conditions and methods of retrofit devices are recorded ② the specifications and actual trigger record of the company's existing features are recorded ③ overlaps and contradictions on simultaneous triggering have been turned into open issues
- **Concrete examples:** ① Research the warning conditions of dashcams and drowsiness-prevention devices (face direction, blinking, continuous driving time) and their warning methods (buzzer, voice). ② Confirm the trigger conditions of the company's existing vehicle features (instrument-cluster rest warning, driver monitor), and check the actual-vehicle trigger-frequency data if it exists. ③ Record as an open issue the overlaps and contradictions if the existing instrument-cluster warning and the new service's rest suggestion trigger at the same time (differences in wording, misaligned timing).

#### SYS1-03-g — Build the feature comparison table

- **Purpose:** Tabulate the research results, making visible the items on which the company's proposal is currently at a disadvantage.
- **Work content:** Create a feature comparison table of research items × comparison targets, provisionally place a column for the company's own proposal, and highlight the disadvantaged items.
- **Input deliverables:** Public-information research record, actual-vehicle benchmark record, smartphone and smartphone-integration benchmark record, existing-feature and retrofit research record
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Feature comparison table (○ △ × plus comments, with an evidence appendix)
- **Granularity / completeness:** Draft version — before review by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-03-c, -d, -e, -f / Successor: SYS1-03-i, SYS1-03-l, SYS1-03-o
- **Entry:** All research records are available
- **Exit (DoD):** ① Every target and every item is filled in (with "not confirmed" stated explicitly) ② the items where the company's proposal is at a disadvantage are highlighted ③ the evidence is compiled as an appendix
- **Concrete examples:** ① Place the research items on the vertical axis and the comparison targets on the horizontal axis, filling in ○ △ × with supplementary comments. ② Provisionally place a column for the company's own proposal (the current plan content) and highlight the items where it is at a disadvantage (e.g. the freshness of facility information, the granularity of frequency settings). ③ Compile the basis for the comparison table (screenshots, source URLs, test-drive dates) as an appendix.

#### SYS1-03-h — Build the UX walkthrough

- **Purpose:** Make visible, on a time axis, the experience differences that a feature list cannot show.
- **Work content:** Lay out each competitor's experience along a time axis for a representative scenario, and diagram the appearance, response, and disappearance of the suggestion together with the "moments of irritation" and "moments of usefulness".
- **Input deliverables:** Actual-vehicle benchmark record, smartphone and smartphone-integration benchmark record, value-proposition definition
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** UX walkthrough diagram (scenario × target × time axis × experience rating)
- **Granularity / completeness:** Draft version — before review by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-03-d, -e / Successor: SYS1-03-i, SYS1-04-c
- **Entry:** The actual-vehicle and actual-use records are available
- **Exit (DoD):** ① Each target's experience is laid out on a time axis for the representative scenario ② the good and bad points of the experience are marked ③ the company's own proposal is provisionally placed on the same time axis
- **Concrete examples:** ① For a representative scenario (2 hours of expressway driving, passing a service area), lay out each competitor's experience along a time axis and diagram the appearance, response, and disappearance of the suggestion. ② Mark the "moments of irritation" (the suggestion hides the map, you are pressed for an answer) and the "moments of usefulness" (the distance to the next service area is shown alongside). ③ Provisionally place the company's own proposed experience on the same time axis, making visible where the differences arise.

#### SYS1-03-i — Analyze the competitors' strengths, weaknesses, and blind spots

- **Purpose:** Organize the competitors' strengths, weaknesses, and blind spots, and extract differentiation opportunities.
- **Work content:** Organize each competitor's strengths, weaknesses, and blind spots, treat the blind spots as candidate differentiation opportunities, and record as considerations the features they may be deliberately not doing.
- **Input deliverables:** Feature comparison table, UX walkthrough diagram
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Competitor analysis table (target × strengths × weaknesses × blind spots × differentiation opportunity)
- **Granularity / completeness:** Draft version — before review by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-03-g, -h / Successor: SYS1-03-j
- **Entry:** The feature comparison table and the UX walkthrough diagram have been created
- **Exit (DoD):** ① Strengths, weaknesses, and blind spots are documented for every target ② candidate differentiation opportunities have been extracted ③ considerations on what they may be "deliberately not doing" are recorded
- **Concrete examples:** ① Organize per competitor the strengths (e.g. smartphones have rich facility information, updated quickly), the weaknesses (e.g. they do not know the vehicle state or driving time), and the blind spots (e.g. passengers are not taken into account). ② Extract the blind spots as candidate differentiation opportunities for the company. ③ Record as considerations the features competitors may be "deliberately not doing" (limiting suggestions to avoid annoyance, not displaying fatigue in order to avoid liability issues).

#### SYS1-03-j — Identify the differentiation points

- **Purpose:** Identify the differentiation points that only the company can deliver, and only on IVI.
- **Work content:** Put forward differentiation candidates such as use of vehicle data, factory-navigation linkage, and dealer-touchpoint linkage, and screen them by whether a one-sentence "reason only we can do this" can be written.
- **Input deliverables:** Competitor analysis table, value-proposition definition, IVI technical constraints list
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Differentiation-point candidate table (candidate × reason × distinction from parity features)
- **Granularity / completeness:** Draft version — before review by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-03-i / Successor: SYS1-03-k, SYS1-03-l
- **Entry:** The competitor analysis table has been created
- **Exit (DoD):** ① The differentiation candidates are enumerated ② each candidate either documents a "reason only we can do this" or is distinguished as a parity feature
- **Concrete examples:** ① Turn into candidates: the use of vehicle data (driving time, driving behavior, fuel / charge remaining), route linkage unique to factory navigation (distance to and congestion at the next service/parking area), and linkage with dealer and service touchpoints. ② Check for each candidate whether a one-sentence "reason only we can do this, and only on IVI" can be written. ③ Candidates where it cannot be written (e.g. listing rest facilities) are treated not as differentiation but as "parity features", avoiding over-investment.

#### SYS1-03-k — Assess how durable the differentiation is

- **Purpose:** Assess how long each differentiation will persist, and separate them by positioning.
- **Work content:** Score the durability of each differentiation candidate on ease of imitation, patents, data exclusivity, and depth of vehicle integration.
- **Input deliverables:** Differentiation-point candidate table, intellectual-property department information (if any)
- **Input source:** Own department (deliverables from the preceding step) / intellectual-property department
- **Output deliverables:** Differentiation-durability assessment table (candidate × ease of imitation × durability score × positioning)
- **Granularity / completeness:** Draft version — before review by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-03-j / Successor: SYS1-03-o, SYS1-06-m
- **Entry:** The differentiation-point candidate table has been created
- **Exit (DoD):** ① A durability score is assigned to every candidate ② the positioning of the low-durability candidates (initial talking point, etc.) is stated explicitly
- **Concrete examples:** ① Assess the ease of imitation of each differentiation candidate (could a smartphone app follow suit within a year?). ② Score durability on the possibility of filing patents, data exclusivity (other companies' apps cannot obtain vehicle signals), and the depth of vehicle integration. ③ Separate the low-durability candidates by positioning them as an "initial talking point", distinguishing them from the long-term differentiation axes.

#### SYS1-03-l — Put the necessity of IVI into words

- **Purpose:** Put into words why it must be delivered on IVI, and where the necessity is weak, propose revisiting the plan's positioning.
- **Work content:** State explicitly the IVI's advantages over the alternative means, together with the conditions under which those advantages are and are not realized, and judge how strong the necessity is.
- **Input deliverables:** Alternative-means comparison hypothesis table, feature comparison table, UX walkthrough diagram, IVI technical constraints list
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** IVI-necessity summary (advantage × conditions where realized × conditions where not realized × verdict)
- **Granularity / completeness:** Draft version — before review by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-03-g, -h, -j, SYS1-02-e / Successor: SYS1-03-m, SYS1-03-o
- **Entry:** The feature comparison table and the UX walkthrough diagram have been created
- **Exit (DoD):** ① The advantages are put into words with their conditions ② the necessity verdict (strong / medium / weak) and its basis are documented ③ where it is weak, the content of the proposal is documented
- **Concrete examples:** ① Surface the alternative means for a rest suggestion (a smartphone app notification, the existing rest warning) and put into words the advantages of delivering it on IVI (screen size, linkage with nearby service/parking-area information, accuracy based on vehicle data, no operation required). ② State explicitly the conditions under which the advantages are realized (DCM communication available, factory navigation in use) and not realized (smartphone navigation in use, out of network coverage), and estimate the proportion of users who satisfy those conditions. ③ If the necessity is judged weak, propose to the planning owner a shift to a smartphone-app-integrated form, or consolidation into an instrument-cluster-side feature.

#### SYS1-03-m — Decide the role division for smartphone integration

- **Purpose:** Decide how smartphone-integration use is handled, and hand it off to experience design and the integration study.
- **Work content:** Examine whether an IVI-side suggestion appears while CarPlay / Android Auto is in use and, if so, by what means; and assess whether a design that delivers value to smartphone-navigation users too is feasible.
- **Input deliverables:** Smartphone and smartphone-integration benchmark record, IVI-necessity summary, IVI technical constraints list
- **Input source:** Own department (deliverables from the preceding step) / IVI development department
- **Output deliverables:** Smartphone-integration role-division policy (proposal × display means × feasibility × hand-off)
- **Granularity / completeness:** Draft version — before review by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-03-e, -l / Successor: SYS1-04-k, SYS1-05-e
- **Entry:** The expression constraints under smartphone integration have been grasped
- **Exit (DoD):** ① The handling of suggestions while smartphone integration is in use has been turned into a policy ② whether value can be delivered to smartphone-navigation users has been assessed
- **Concrete examples:** ① Examine whether or not to show an IVI-side suggestion while CarPlay / Android Auto is in use, and if so, organize the display means (voice only, instrument-cluster display, whether interrupting the integration screen is allowed). ② Confirm with the IVI development department the technical feasibility of a design that delivers value to smartphone-navigation users too (keeping suggestions that use vehicle data on the IVI side). ③ Make the role-division policy a hand-off to experience design (notification means) and to the domain-integration study (acquisition path).

#### SYS1-03-n — Research the price and monetization benchmarks

- **Purpose:** Grasp the going rate for pricing and monetization, as an input to the business-viability study.
- **Work content:** Research each company's connected-service pricing, package composition, and free periods, together with how suggestion-type features are positioned with respect to charging.
- **Input deliverables:** Comparison-target list, public information (each company's service sites)
- **Input source:** External (public information)
- **Output deliverables:** Price / monetization-model research table (target × price × package × free period × positioning of the relevant feature)
- **Granularity / completeness:** Fixed version — settled on the basis of public information
- **Predecessor / Successor:** Predecessor: SYS1-03-c / Successor: SYS1-06-e, SYS1-06-g
- **Entry:** The comparison-target list is settled
- **Exit (DoD):** ① The prices and packages of the main targets are recorded ② whether suggestion-type features are charged standalone or bundled is recorded ③ a sense of the going rate is summarized
- **Concrete examples:** ① Research each company's connected-service pricing (monthly, annual, free period, the number of years included with the vehicle purchase) and package composition. ② Confirm whether the equivalent of a rest suggestion is charged standalone or bundled in the base package, and if there are almost no standalone-charging cases, note that the bundled form is the norm. ③ Organize the going price range (e.g. from a few hundred to around a thousand yen per month) as an input to the business-viability study.

#### SYS1-03-o — Consolidate and agree the differentiation axes

- **Purpose:** Integrate the research results, narrow the differentiation axes, and agree them with the planning owner.
- **Work content:** Produce a differentiation summary (draft version) integrating the feature comparison table, UX walkthrough, differentiation points, necessity, role-division policy, and price benchmarks, and narrow the differentiation axes to 1–2 at the review.
- **Input deliverables:** Feature comparison table, UX walkthrough diagram, competitor analysis table, differentiation-durability assessment table, IVI-necessity summary, smartphone-integration role-division policy, price / monetization-model research table
- **Input source:** Planning owner (authoring, review)
- **Output deliverables:** Differentiation summary (draft version), review minutes (the decision on the differentiation axes, clarification of which features may be at parity)
- **Granularity / completeness:** Draft version — reviewed by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-03-g through -n / Successor: SYS1-04-a, SYS1-06-m
- **Entry:** All research and analysis deliverables are available
- **Exit (DoD):** ① Evidence is linked to each differentiation claim ② the differentiation axes are narrowed to 1–2 ③ the "features that may be at parity with competitors" are made clear ④ unconfirmed matters are stated explicitly
- **Concrete examples:** ① Link evidence (research results, interview utterances) to each differentiation claim, and state explicitly the unconfirmed matters (competitors not verified on actual units, etc.). ② Review with the planning owner and narrow the differentiation axes to 1–2 (e.g. suggestion accuracy from vehicle data, an integrated experience with the factory navigation). ③ Make clear the "features that may be at parity with competitors", obtain agreement to avoid excessive differentiation investment, and minute it.

---

### SYS1-04 (L2) — Making the experience scenarios and trigger conditions concrete

- **ASPICE BP:** Pre-SYS.1 stage (BP2 preparation)
- **Purpose:** Make concrete when, where, and in what state the feature triggers, how it is shown, how it is responded to, and what happens when it misses.
- **Work content:** Carry out work items a–t, produce the experience-scenario document and trigger-condition definition (draft version), and agree them with the planning owner.
- **Input deliverables:** Value-proposition definition (draft version), differentiation summary (draft version), IVI technical constraints list, HMI guidelines, per-context constraint table
- **Input source:** Own department (deliverables from the preceding step) / IVI development department
- **Output deliverables:** Experience-scenario document and trigger-condition definition (draft version: scenario list / storyboards / trigger & suppression conditions / frequency & re-presentation rules / notification means / operation permissions / screen roughs / settings)
- **Granularity / completeness:** Draft version — reviewed by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-02, SYS1-03 / Successor: SYS1-05, SYS1-06
- **Entry:** The value-proposition definition and the differentiation summary have reached draft-version status
- **Exit (DoD):** The experience-scenario document and trigger-condition definition (draft version) have been confirmed, and the trigger-condition proposal has been narrowed to one
- **Concrete examples:** (see the work items beneath) a trade-off table for three trigger-condition proposals, a comparison of re-presentation rules, the correspondence between notification means and degree of driving interference, and a layout rough that does not obstruct the map.

#### SYS1-04-a — Enumerate the scenarios

- **Purpose:** Enumerate happy-path scenarios from the main-battleground contexts, and confirm their correspondence to the value.
- **Work content:** Enumerate 5–8 main scenarios from the contexts rated "strong" in the per-context value assessment, noting alongside each the trouble caused if it does not trigger, and the persona.
- **Input deliverables:** Value-proposition definition (per-context value assessment, persona sheet), differentiation summary
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Scenario list (ID × context × persona × outline × corresponding pain point)
- **Granularity / completeness:** Rough version — created by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-02-r, SYS1-02-i, SYS1-03-o / Successor: SYS1-04-b, SYS1-04-c
- **Entry:** The per-context value assessment in the value-proposition definition can be referenced
- **Exit (DoD):** ① 5–8 main scenarios are enumerated ② each scenario is mapped to a pain point and a persona
- **Concrete examples:** ① From the "strong" contexts, enumerate 5–8 happy paths (e.g. rest is suggested during 2 hours of expressway driving with the family aboard, and they rest at the next service area). ② Note alongside each scenario the "trouble caused if it does not trigger", and confirm its correspondence to the value. ③ Include 1–2 scenarios for the secondary persona too (consecutive visits in a company car), noting the possibility that they fall outside the initial scope.

#### SYS1-04-b — Define the triggers and suppression conditions

- **Purpose:** Define the trigger and suppression conditions per scenario, and identify the data required.
- **Work content:** Describe each scenario's trigger in three elements — when, where, and in what state — noting alongside it the data items required and the conditions under which triggering should be suppressed.
- **Input deliverables:** Scenario list, IVI technical constraints list
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Trigger definition table (scenario × when × where × state × data required × suppression conditions)
- **Granularity / completeness:** Rough version — created by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-04-a / Successor: SYS1-04-d, SYS1-04-i, SYS1-05-a
- **Entry:** The scenario list has been created
- **Exit (DoD):** ① All scenarios have the three trigger elements described ② the required data items are enumerated ③ suppression conditions are noted alongside
- **Concrete examples:** ① Describe the trigger in three elements: "when" (continuous driving time, time of day), "where" (expressway, ordinary road, distance to the destination), and "in what state" (vehicle speed, fatigue estimate, fuel / charge remaining). ② Enumerate the data items the trigger requires, making it an input to the domain-integration study. ③ Note alongside the conditions under which triggering should be suppressed even when the trigger is satisfied (within 10 minutes of the destination, a rest was just taken, a call is in progress).

#### SYS1-04-c — Build the storyboards

- **Purpose:** Make the experience visible on a time axis, grasping in advance the points where emotion dips.
- **Work content:** Divide each scenario into the time sequence before departure → driving → suggestion → response → rest → resuming, and create a storyboard describing the user's actions, thoughts, and emotions alongside the IVI's behavior.
- **Input deliverables:** Scenario list, UX walkthrough diagram, persona sheet
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Storyboard / journey map (scenario × phase × action × thought × emotion × IVI behavior × passengers)
- **Granularity / completeness:** Rough version — created by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-04-a, SYS1-03-h / Successor: SYS1-04-h, SYS1-04-s
- **Entry:** The scenario list has been created
- **Exit (DoD):** ① The main scenarios are divided into phases ② the points where emotion dips are stated explicitly ③ the passengers' actions are described in parallel
- **Concrete examples:** ① Describe the user's actions, thoughts, and emotions at each phase alongside the IVI's behavior. ② State explicitly the points where emotion dips (the suggestion hides the map, you are pressed for an answer, the suggestion is off the mark), making them targets to eliminate in later design. ③ Describe the passengers' actions in parallel too (a child says "toilet", the front passenger starts looking up service areas), as material for considering a passenger-facing display.

#### SYS1-04-d — Enumerate the trigger-condition candidates

- **Purpose:** Put forward a wide range of trigger-condition options, annotated with their feasibility.
- **Work content:** Enumerate multiple proposals for the trigger conditions — time-based, state-based, position-based, and combinations — annotated with the data required, the accuracy, and the implementation difficulty.
- **Input deliverables:** Trigger definition table, IVI technical constraints list, existing-verification-results sorting table
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Trigger-condition candidate table (proposal × condition × data required × accuracy × implementation difficulty)
- **Granularity / completeness:** Rough version — created by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-04-b / Successor: SYS1-04-e
- **Entry:** The trigger definition table has been created
- **Exit (DoD):** ① At least 3 proposals are enumerated ② each proposal is annotated with the data required and the implementation difficulty ③ a combination proposal is included
- **Concrete examples:** ① For the rest suggestion, enumerate multiple proposals for the trigger condition: "90 minutes of continuous driving", "120 minutes", "fatigue estimated from driving behavior", and "the remaining time to the destination together with the location of rest facilities". ② Annotate each with the data and accuracy needed to realize it, and the implementation difficulty (achievable by IVI alone / requires vehicle integration). ③ Include combinations of multiple conditions as candidates too (time + the next facility within 30 km).

#### SYS1-04-e — Compare the trigger conditions on trade-offs

- **Purpose:** Compare the trigger conditions on the trade-off among false detection, missed detection, and annoyance, and recommend a proposal for the initial release.
- **Work content:** Organize into a trade-off table how false and missed detections arise for each proposal, along with the annoyance and safety risk, and present a recommended proposal with its rationale.
- **Input deliverables:** Trigger-condition candidate table, interview analysis results (acceptable frequency), existing-verification-results sorting table
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Trigger-condition trade-off table (proposal × false detection × missed detection × annoyance × safety risk × explainability × recommendation)
- **Granularity / completeness:** Draft version — the adopted proposal is decided at the review
- **Predecessor / Successor:** Predecessor: SYS1-04-d, SYS1-02-p / Successor: SYS1-04-f, SYS1-04-t
- **Entry:** The trigger-condition candidate table and the interview analysis results are both available
- **Exit (DoD):** ① Every proposal states the anticipated false and missed detections ② the basis of the assessment is cited ③ the recommended proposal and the reason are documented
- **Concrete examples:** ① Compare the three proposals "90 minutes of continuous driving", "120 minutes", and "fatigue estimation", anticipating how false detection (appearing when not needed) and missed detection (not appearing when needed) arise, and organize the annoyance and the safety risk into a trade-off table. ② Cite the PoC results and the interview acceptable frequency (once every 2 hours is fine) as the basis of the assessment. ③ Propose a policy of prioritizing, for the initial release, "a simple condition that can be explained to the user (time-based)", with fatigue estimation as an OTA-expansion candidate.

#### SYS1-04-f — Design the frequency and interval rules

- **Purpose:** Design frequency and interval rules that keep annoyance down.
- **Work content:** Define the maximum number of suggestions per trip, the minimum interval, and the range of user settings, and examine whether a suppression rule is needed when suggestions are repeatedly ignored.
- **Input deliverables:** Trigger-condition trade-off table, interview analysis results, usage-motivation & abandonment-factor hypothesis table
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Frequency & interval rule definition (max count × min interval × setting range × suppression rule)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS1-04-e, SYS1-02-l / Successor: SYS1-04-g, SYS1-04-r
- **Entry:** A recommended trigger-condition proposal has been presented
- **Exit (DoD):** ① The maximum count and minimum interval are defined numerically ② the setting range is defined ③ whether a suppression rule is needed, and the policy for it, are documented
- **Concrete examples:** ① Set the maximum number of suggestions per trip (e.g. 3) and the minimum interval between suggestions (e.g. 60 minutes), linking the interview utterances that justify them. ② Examine whether a learning rule that reduces suggestions after consecutive dismissals is needed, and draft a proposal to use a fixed rule initially with learning as an OTA candidate. ③ Define the range over which the user can change the frequency (more / standard / fewer / OFF).

#### SYS1-04-g — Decide the re-presentation rules

- **Purpose:** Decide the behavior when a suggestion is ignored or declined, striking a balance between being pushy and missing the moment.
- **Work content:** Compare multiple proposals for the re-presentation rule, and examine whether "later" and "no thanks" need to be distinguished, and whether the wording changes on re-presentation.
- **Input deliverables:** Frequency & interval rule definition, interview analysis results
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Re-presentation rule definition (proposal × condition × wording × UI burden × adoption)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS1-04-f / Successor: SYS1-04-h, SYS1-04-t
- **Entry:** The frequency and interval rules are defined
- **Exit (DoD):** ① The re-presentation rule is compared across multiple proposals ② whether to distinguish responses has been judged ③ the adopted proposal is documented
- **Concrete examples:** ① Examine multiple proposals for the rule when a suggestion is ignored: "re-present after 15 minutes", "do not re-present the same day", and "re-present only on approaching the next rest facility". ② Assess whether the "later" and "no thanks" responses should be distinguished and, if so, the operation burden while driving that this creates (more buttons). ③ Examine a proposal that changes the wording on re-presentation (first time: a suggestion; second time: information only, the distance to the next service area).

#### SYS1-04-h — Design the post-acceptance experience

- **Purpose:** Design the experience after a suggestion is accepted, carrying it through to the rest actually being taken.
- **Work content:** Define the scope of navigation linkage on acceptance, the behavior when resuming after the rest, and the method for measuring acceptance → rest actually taken.
- **Input deliverables:** Storyboard, re-presentation rule definition, IVI technical constraints list
- **Input source:** Own department (deliverables from the preceding step) / IVI development department
- **Output deliverables:** Post-acceptance experience definition (linkage scope × resume behavior × measurement method)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS1-04-c, -g / Successor: SYS1-04-i, SYS1-06-j, SYS1-06-l
- **Entry:** The storyboard has been created
- **Exit (DoD):** ① The scope of navigation linkage on acceptance is defined ② the behavior on resuming is defined ③ the measurement method has been handed off to the business-viability study
- **Concrete examples:** ① Define the scope of navigation linkage when the suggestion is accepted (adding a waypoint, displaying service/parking-area facility information, parking-availability information). ② Define the behavior when resuming after the rest (resetting the suggestion history, the condition for restarting the continuous-driving timer = stopped for 15 minutes or more). ③ Hand off the method for measuring acceptance → rest actually taken (detecting a stop at a service/parking area, the duration in shift P) to the KPI design in the business-viability study.

#### SYS1-04-i — Surface the edge cases

- **Purpose:** Surface the exceptions and edge cases, provisionally decide a policy, and turn the contentious ones into open issues.
- **Work content:** Enumerate cases such as being in a traffic jam, just before the destination, at night, in bad weather, no rest facility nearby, and just after a driver change, and provisionally decide a trigger / suppress policy for each.
- **Input deliverables:** Trigger definition table, trigger-condition trade-off table
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Edge-case list (case × policy × rationale × whether to raise as an issue)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS1-04-b, -h / Successor: SYS1-04-j, SYS1-07-a
- **Entry:** The trigger definition table has been created
- **Exit (DoD):** ① At least 10 edge cases are enumerated ② each case has a provisional policy ③ the contentious cases are transferred to the issue list
- **Concrete examples:** ① Enumerate cases such as being in a traffic jam (driving time is long but the nature of the fatigue differs), just before the destination, at night, in bad weather, on an ordinary road with no rest facility nearby, just after a driver change, during a call, and when an emergency vehicle is approaching. ② Provisionally decide for each case whether to issue or suppress the suggestion (e.g. suppress in a traffic jam, shorten the interval at night). ③ Transfer the "contentious cases" (should it appear in a traffic jam?) to the issue list.

#### SYS1-04-j — Decide the response to false detection

- **Purpose:** Anticipate the degradation of the experience on a false detection, and design mitigations that do not damage trust.
- **Work content:** Turn the user psychology on a false detection (of the fatigue estimate, etc.) into a scenario, and enumerate mitigations such as wording, showing the reason, a dismiss action, and automatic suppression.
- **Input deliverables:** Edge-case list, trigger-condition trade-off table, interview analysis results
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** False-detection response policy (false-detection scenario × psychology × mitigation × feedback capture)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS1-04-i / Successor: SYS1-04-k, SYS1-04-n
- **Entry:** The edge-case list has been created
- **Exit (DoD):** ① The false-detection scenario is described ② at least 3 mitigations are enumerated ③ whether feedback capture is needed is documented
- **Concrete examples:** ① Turn into a scenario the user psychology when the fatigue estimate wrongly judges "fatigued" (discomfort, a feeling of being suspected, loss of trust). ② Enumerate mitigations (wording that avoids assertion, e.g. "Are you feeling tired?", showing the reason for the suggestion, a one-tap dismiss action). ③ Examine whether automatic suppression after repeated false detections is needed, and whether a mechanism to capture "this was unnecessary" feedback on dismissal is needed.

#### SYS1-04-k — Design the notification means

- **Purpose:** Choose among the notification means by balancing the strength of the alert against the degree of driving interference.
- **Work content:** Assess banner, pop-up, voice, and instrument-cluster linkage on the strength of the alert and the degree of driving interference, and design how they are used according to the importance of the suggestion, together with draft voice wording.
- **Input deliverables:** IVI technical constraints list, false-detection response policy, smartphone-integration role-division policy, HMI guidelines
- **Input source:** Own department (deliverables from the preceding step) / IVI development department
- **Output deliverables:** Notification-means design (means × strength × interference × usage split × draft voice wording)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS1-04-j, SYS1-01-k, SYS1-03-m / Successor: SYS1-04-l, SYS1-04-o
- **Entry:** The available notification means have been grasped from the IVI technical constraints list
- **Exit (DoD):** ① Each means is captured in an assessment table ② the usage split by importance is defined ③ there are 3 draft voice wordings, with their durations measured
- **Concrete examples:** ① Tabulate the strength of the alert and the degree of driving interference for each means: banner (overlaid on part of the map), pop-up (full screen), voice guidance, and instrument-cluster linked display. ② Design the usage split by the importance of the suggestion (normal: banner + short voice; high fatigue estimate: with the instrument cluster as well). ③ Create 3 draft voice wordings, measure their length (in seconds), and check them against the upper limit that can be taken in while driving (e.g. within 5 seconds).

#### SYS1-04-l — Define the operation permissions

- **Purpose:** Limit the operations permitted while driving, achieving both safety and responsiveness.
- **Work content:** Create a restriction proposal in which only a minimal response is touchable while driving, and define the scope of voice response together with the vehicle states used to judge operation permission.
- **Input deliverables:** Notification-means design, per-context constraint table, HMI guidelines
- **Input source:** Own department (deliverables from the preceding step) / IVI development department
- **Output deliverables:** Operation-permission definition (vehicle state × operation × permitted or not × alternative means)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS1-04-k, SYS1-02-j / Successor: SYS1-04-m, SYS1-05-a
- **Entry:** The notification-means design has been created
- **Exit (DoD):** ① Operation permissions while driving and while stopped are defined ② the scope of voice response is defined ③ the vehicle states used for the judgment are defined and handed off to the integration study
- **Concrete examples:** ① Create a restriction proposal in which only the two choices "yes / later" are touchable while driving, with viewing facility details or changing the route deferred until stopped. ② Define the scope over which voice responses ("yes", "later", "stop suggesting") substitute for operation. ③ Define the vehicle states used to judge operation permission (vehicle speed, shift position, parking brake), and hand them off to the domain-integration study.

#### SYS1-04-m — Decide the passenger-facing display policy

- **Purpose:** Decide whether and to what extent a passenger-facing display is needed, and organize the privacy considerations.
- **Work content:** Examine the use cases where a passenger operates it, and provisionally decide whether the same screen suffices, the privacy considerations for displaying the fatigue level, and the scope for rear-seat and smartphone linkage.
- **Input deliverables:** Operation-permission definition, usage-context matrix, per-context constraint table
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Passenger-facing display policy (use case × whether a display is needed × considerations × scope)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS1-04-l, SYS1-02-h, SYS1-02-j / Successor: SYS1-04-n
- **Entry:** The operation-permission definition has been created
- **Exit (DoD):** ① Passenger use cases have been examined ② whether a display is needed and the considerations are documented ③ the scope for rear-seat and smartphone linkage is provisionally decided
- **Concrete examples:** ① Examine the use case where the front-seat passenger operates it to choose the rest destination, and judge whether the same screen as the driver's suffices or whether a layout shifted toward the passenger side is needed. ② Examine the privacy considerations if there is a passenger-facing display (should the driver's fatigue level be shown to passengers?), and draft a proposal in which the fatigue level is not displayed and only the suggestion is. ③ Provisionally decide whether linkage to rear-seat displays and smartphones is outside the initial scope.

#### SYS1-04-n — Decide how information from other domains is expressed

- **Purpose:** Decide how information originating in other domains is expressed on the IVI, and define consistency with the instrument cluster and the behavior when data is missing.
- **Work content:** Examine the display granularity for other domains' judgment results, the rules for keeping expression consistent with instrument-cluster warnings, and the display when data cannot be obtained.
- **Input deliverables:** Passenger-facing display policy, false-detection response policy, existing-feature and retrofit research record
- **Input source:** Own department (deliverables from the preceding step) / ADAS & instrument-cluster departments
- **Output deliverables:** Other-domain information expression policy (information × display granularity × consistency rule × behavior when missing)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS1-04-m, SYS1-04-j, SYS1-03-f / Successor: SYS1-04-o, SYS1-05-h
- **Entry:** The instrument-cluster-side warning specifications have been grasped
- **Exit (DoD):** ① The display granularity is decided ② the consistency rule with the instrument cluster is documented ③ the display when data is missing is defined
- **Concrete examples:** ① Examine at which granularity other domains' judgment results, such as the fatigue estimate, are displayed: a "numeric value", "levels (3 levels)", or "a one-sentence reason for the suggestion (you have been driving for a long time)". ② Organize expression rules so that the wording and timing do not contradict the instrument-cluster-side warning display (while an instrument-cluster warning is active, the IVI shows supplementary information only). ③ Define the display when the integration data cannot be obtained (loss of communication, a non-supporting vehicle, a grade without fatigue estimation): do not issue the suggestion, or switch to a simplified time-based version.

#### SYS1-04-o — Draft the screen layout roughs

- **Purpose:** Create rough screen-layout proposals with the volume and priority of information readable at a glance while driving.
- **Work content:** Order the information included in the suggestion display by priority, set the upper limit readable while driving, and create several rough layout proposals that do not obstruct the map.
- **Input deliverables:** Notification-means design, other-domain information expression policy, IVI technical constraints list, HMI guidelines
- **Input source:** Own department (deliverables from the preceding step) / design department
- **Output deliverables:** Screen-layout rough proposals (information × priority × 2–3 layout proposals)
- **Granularity / completeness:** Rough version — visual design is out of scope; information priority and placement only
- **Predecessor / Successor:** Predecessor: SYS1-04-k, -n / Successor: SYS1-04-p, SYS1-04-s
- **Entry:** The notification means and the information to display are decided
- **Exit (DoD):** ① The displayed information is ordered by priority ② the upper limit on information volume while driving is set ③ there are 2–3 rough layout proposals ④ it is stated explicitly that visual design is out of scope
- **Concrete examples:** ① Order the information included in the suggestion display (the suggestion wording, the rest facility name, the time to arrival, the response buttons) by priority, and set the upper limit readable at a glance while driving (e.g. 2 lines, 15 characters). ② Create 2–3 rough proposals for placements that do not obstruct the map display (a band at the bottom of the screen, a right-hand column, overlaid without shrinking the map). ③ State explicitly that visual design (color scheme, fonts, icon styling) is out of scope, and define only the priority and placement of the information.

#### SYS1-04-p — Draft the screen-transition rough

- **Purpose:** Define screen transitions that can coexist with the existing navigation screens and notifications.
- **Work content:** Sketch the transitions suggestion display → details → navigation setting → end, and organize the interruption relationships and priorities with respect to the existing navigation transitions and other notifications.
- **Input deliverables:** Screen-layout rough proposals, IVI technical constraints list (notification framework)
- **Input source:** Own department (deliverables from the preceding step) / IVI development department
- **Output deliverables:** Screen-transition rough diagram (transitions × interruption relationships × priority × items to confirm)
- **Granularity / completeness:** Rough version — fixed in requirements definition (SYS2-11)
- **Predecessor / Successor:** Predecessor: SYS1-04-o / Successor: SYS1-04-q, SYS2-11
- **Entry:** The screen-layout rough proposals and the notification-framework specification are both available
- **Exit (DoD):** ① The transitions are sketched ② the priority with respect to existing notifications is defined ③ maintaining the map scale and guidance display is an item to confirm
- **Concrete examples:** ① Sketch roughly the transitions suggestion display → details → navigation setting → suggestion end, and organize the interruption relationships with the existing navigation screen transitions (during route guidance, during destination search, while the settings screen is displayed). ② Define the priority when the suggestion coincides with an existing notification (an incoming call, traffic information, a vehicle warning) — vehicle warning > incoming call > suggestion. ③ Make it an item to confirm that the map scale and guidance display are maintained even while the suggestion is displayed.

#### SYS1-04-q — Check the driver-distraction constraints

- **Purpose:** Surface the design constraints from a driver-distraction standpoint, raising the detailed handling as open issues.
- **Work content:** Check the rough UI proposals against the requirements of the internal HMI guidelines and the industry guidelines, and record the elements at risk of non-conformance as design constraints.
- **Input deliverables:** Screen-layout rough proposals, screen-transition rough diagram, notification-means design, HMI guidelines, industry guidelines (JAMA, NHTSA, etc.)
- **Input source:** IVI development department / quality-assurance department / external (published guidelines)
- **Output deliverables:** Distraction-constraint check table (requirement × status of the rough proposal × constraint × open issue)
- **Granularity / completeness:** Draft version — details passed downstream as open issues
- **Predecessor / Successor:** Predecessor: SYS1-04-o, -p / Successor: SYS1-04-r, SYS1-07-a
- **Entry:** Permission to view the HMI guidelines has been granted
- **Exit (DoD):** ① The status of the rough proposals against the main requirements is documented ② the elements at risk of non-conformance are recorded as design constraints ③ detailed regulatory and standards compliance is documented as an open issue
- **Concrete examples:** ① Check the rough suggestion-UI proposals against the requirements of the internal HMI guidelines and the industry guidelines (JAMA, NHTSA, etc.) — eyes-off-road time, number of operation steps, character count while driving. ② Surface the elements that may not conform (the number of characters displayed while driving, the depth of the hierarchy, a full-screen pop-up) and record them as design constraints. ③ Record detailed regulatory and standards compliance (the regulations of each destination market, the certification process) in the issue list as "requires study".

#### SYS1-04-r — Decide the settings-feature policy

- **Purpose:** Decide whether settings features such as consent, ON/OFF, and frequency are needed, and their default values.
- **Work content:** Examine whether the first-run explanation and consent, ON/OFF, frequency setting, and notification-means selection are needed, and decide the validity of the default settings and the path to changing them.
- **Input deliverables:** Frequency & interval rule definition, notification-means design, interview analysis results
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Settings-feature policy (setting item × needed or not × default × rationale × path)
- **Granularity / completeness:** Draft version — before review; whether consent is required is fixed in the integration study (SYS1-05-j)
- **Predecessor / Successor:** Predecessor: SYS1-04-f, -k, -q / Successor: SYS1-04-s, SYS1-05-j
- **Entry:** The frequency rules and the notification means have been designed
- **Exit (DoD):** ① Whether each setting item is needed is decided ② the default values have a rationale ③ the path to changing the settings is documented
- **Concrete examples:** ① Examine whether the first-launch explanation and consent (including data use), ON/OFF, the frequency setting, and notification-means selection are needed. ② Judge the validity of the default settings (ON / standard frequency) on the basis of the interview results (the frequency that is acceptable even when ON by default). ③ Examine the paths for changing settings (the settings menu, and direct change via "stop suggesting" from the suggestion screen).

#### SYS1-04-s — Evaluate the scenarios with users

- **Purpose:** Have users experience the scenarios, confirm comprehension of the wording and hesitation in operation, and narrow the proposals.
- **Work content:** Have several people experience the main scenarios on a paper prototype or click-through dummy, and compare comprehension, hesitation in operation, and annoyance while varying the timing.
- **Input deliverables:** Storyboard, screen-layout rough proposals, notification-means design, settings-feature policy
- **Input source:** Own department (execution) / external (participant recruiting)
- **Output deliverables:** Scenario evaluation results (participant × scenario × comprehension × hesitation × annoyance × implications)
- **Granularity / completeness:** Fixed version — settled as the evaluation result
- **Predecessor / Successor:** Predecessor: SYS1-04-c, -o, -r / Successor: SYS1-04-t
- **Entry:** The prototype is prepared and 5–8 participants are arranged
- **Exit (DoD):** ① There are evaluation records for the planned number of participants ② the trigger-condition and notification-means proposals have been narrowed
- **Concrete examples:** ① Have 5–8 people experience the main scenarios on a paper prototype or click-through dummy, and observe their comprehension of the suggestion wording and their hesitation in responding (does the meaning of "later" get across?). ② Compare "does this feel annoying?" while varying the presentation timing (90 / 120 minutes) and the wording. ③ From the evaluation results, narrow the proposals for the trigger conditions, notification means, and wording, and record the reasons for the narrowing.

#### SYS1-04-t — Consolidate and agree the experience design

- **Purpose:** Consolidate the results of the experience design into a single document, and agree the adopted trigger-condition proposal with the planning owner.
- **Work content:** Produce the experience-scenario document and trigger-condition definition (draft version) integrating the scenarios, conditions, rules, notifications, operations, screen roughs, and settings, and narrow to a single adopted proposal at a walkthrough review.
- **Input deliverables:** All deliverables of work items a–s
- **Input source:** Planning owner (authoring, review)
- **Output deliverables:** Experience-scenario document and trigger-condition definition (draft version: IDs assigned to each item, undecided items stated explicitly), review minutes
- **Granularity / completeness:** Draft version — reviewed by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-04-e, -g, -s (and all other work items) / Successor: SYS1-05-a, SYS1-06-m, SYS2-10
- **Entry:** The deliverables of work items a–s are all available
- **Exit (DoD):** ① An ID is assigned to each scenario and condition ② the trigger-condition proposal is narrowed to one, with the remaining proposals recorded as alternatives ③ safety and legal concerns are transferred to the issue list
- **Concrete examples:** ① Integrate the scenario list, storyboards, trigger & suppression conditions, frequency & re-presentation rules, notification means, operation permissions, screen roughs, and settings policy into a single document, assigning an ID to each item so it can be traced into the requirements list. ② Walk the experience scenarios through with the planning owner and have them point out behavior that differs from their intent (e.g. "I don't want suggestions at night"). ③ Reflect the feedback and narrow the trigger-condition proposal to one (recording the remainder as alternatives), transferring safety and legal concerns to the issue list.

---

### SYS1-05 (L2) — Studying the necessity and scope of domain integration

- **ASPICE BP:** Pre-SYS.1 stage (advance study for SYS.2 BP4)
- **Purpose:** Clarify why it cannot stand on IVI alone and what value integration adds, and fix the integration scope, the responsibility boundary, and the constraints.
- **Work content:** Carry out work items a–o, produce the domain-integration policy (draft version), and agree it with the planning owner and the partner departments.
- **Input deliverables:** Experience-scenario document and trigger-condition definition (draft version), IVI technical constraints list, existing-feature specifications, stakeholder map
- **Input source:** Own department (deliverables from the preceding step) / IVI development, vehicle control, ADAS, cloud departments / legal
- **Output deliverables:** Domain-integration policy (draft version: required-data list / owning domains / acquisition means / responsibility boundary / adopted integration scope / constraints & open issues)
- **Granularity / completeness:** Draft version — reviewed by the planning owner and the partner departments
- **Predecessor / Successor:** Predecessor: SYS1-04 / Successor: SYS1-06, SYS2-13
- **Entry:** The experience-scenario document and trigger-condition definition (draft version) are settled
- **Exit (DoD):** The domain-integration policy (draft version) has been confirmed, and the adopted integration scope and the unresolved matters are stated explicitly
- **Concrete examples:** (see the work items beneath) verifying an IVI-only substitute for driving time, the added value of fatigue-estimate integration, where the judgment logic resides, comparing the three proposals minimum / standard / full, and the data-provision inquiries.

#### SYS1-05-a — Enumerate the required data

- **Purpose:** Surface without omission the data items the experience requires, distinguishing the mandatory from the supplementary.
- **Work content:** Enumerate the required data from the trigger definitions and the operation-permission definition, and define the accuracy, update frequency, and mandatory / supplementary classification.
- **Input deliverables:** Experience-scenario document and trigger-condition definition (trigger definition table, operation-permission definition, post-acceptance experience definition)
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Required-data list (data × use × accuracy × update frequency × mandatory / supplementary)
- **Granularity / completeness:** Rough version — created by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-04-t, SYS1-04-b, -l / Successor: SYS1-05-b
- **Entry:** The experience-scenario document and trigger-condition definition (draft version) can be referenced
- **Exit (DoD):** ① The data required for every trigger and operation judgment is enumerated ② the accuracy and update frequency are defined ③ mandatory and supplementary are distinguished
- **Concrete examples:** ① From the trigger-condition definition, enumerate the required data (continuous driving time, vehicle speed, shift position, fatigue-estimate result, fuel / charge remaining, destination & route, rest-facility information, call status). ② Define for each the accuracy needed (to the minute / to the second) and the update frequency (real time / every few minutes). ③ Distinguish the mandatory data (driving time, vehicle speed) from the "improves accuracy if available" data (fatigue estimate, congestion information).

#### SYS1-05-b — Map the data to the owning domains

- **Purpose:** Identify which domain owns each item of data, stating explicitly where there are multiple candidates.
- **Work content:** Map the required data to the owning domains (IVI / vehicle control / ADAS & driver monitor / cloud / smartphone), and link the responsible departments.
- **Input deliverables:** Required-data list, IVI technical constraints list, stakeholder map
- **Input source:** Own department (deliverables from the preceding step) / IVI development department
- **Output deliverables:** Data-owning-domain map (data × domain × responsible department × multiple candidates)
- **Granularity / completeness:** Rough version — before confirmation by the partner departments
- **Predecessor / Successor:** Predecessor: SYS1-05-a, SYS1-01-l / Successor: SYS1-05-c, SYS1-05-e, SYS1-05-i
- **Entry:** The required-data list has been created
- **Exit (DoD):** ① Every data item is assigned an owning domain ② cases with multiple candidates are stated explicitly ③ the responsible departments are linked
- **Concrete examples:** ① Map each data item to its owning domain (IVI / vehicle control (body, powertrain) / ADAS & driver monitor / cloud / smartphone app). ② State explicitly where the same data is owned by multiple domains (driving time can be derived either from the IVI's uptime or from the vehicle-side trip meter). ③ Link the department name and point of contact for the owning domain from the stakeholder map.

#### SYS1-05-c — Judge whether IVI alone can substitute

- **Purpose:** Determine which data the IVI can substitute for on its own, dropping unnecessary integrations.
- **Work content:** Verify whether acquisition from other domains is really necessary, and assess the loss of accuracy if IVI-only data is substituted.
- **Input deliverables:** Data-owning-domain map, IVI technical constraints list
- **Input source:** Own department (deliverables from the preceding step) / IVI development department
- **Output deliverables:** IVI-only substitutability table (data × substitute means × loss of accuracy × initial-release proposal)
- **Granularity / completeness:** Rough version — before review
- **Predecessor / Successor:** Predecessor: SYS1-05-b / Successor: SYS1-05-d
- **Entry:** The data-owning-domain map has been created
- **Exit (DoD):** ① Substitutability is judged for each data item ② the loss of accuracy on substitution is assessed ③ the integrations that can be omitted for the initial release are documented as a proposal
- **Concrete examples:** ① Verify the necessity of obtaining the driving-time data from another domain, and check whether data the IVI can hold on its own (IVI uptime, navigation guidance time, GPS movement history) can substitute. ② Assess the loss of accuracy on substituting (it includes time when the engine is ON but the vehicle is not moving, it resets when the IVI restarts, etc.). ③ Draft a proposal in which substitutable data omits the integration for the initial release, with the accuracy improvement realized via OTA expansion.

#### SYS1-05-d — Put the added value of integration into words

- **Purpose:** Put into words how integration improves the experience, and exclude integrations that cannot be explained.
- **Work content:** Compare the difference in suggestion accuracy and timing between scenarios without and with integration, and put the added value into words.
- **Input deliverables:** IVI-only substitutability table, experience-scenario document, differentiation summary
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Integration added-value summary (integration × difference in experience × contribution to differentiation × adopt or not)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS1-05-c, SYS1-03-o / Successor: SYS1-05-k
- **Entry:** The IVI-only substitutability table has been created
- **Exit (DoD):** ① The added value of each integration is put into words ② integrations that cannot be explained are candidates for exclusion
- **Concrete examples:** ① Compare in scenarios how the suggestion accuracy and timing change when the driver monitor's fatigue estimate is integrated (detecting fatigue that elapsed time alone cannot capture, and conversely not suggesting when the driver is fresh). ② Put into words the difference in user experience between no integration (time-based) and integration (state-based), and confirm consistency with the differentiation axes in the differentiation summary. ③ Exclude from the scope any integration whose added value cannot be explained (e.g. cabin-temperature data).

#### SYS1-05-e — Organize the data-acquisition means

- **Purpose:** Organize the options for the data-acquisition path and their feasibility.
- **Work content:** Organize the latency, availability, and implementation cost of the in-vehicle-network, cloud, and smartphone routes, and confirm which signals can be obtained through the existing interfaces.
- **Input deliverables:** Data-owning-domain map, IVI technical constraints list, smartphone-integration role-division policy
- **Input source:** IVI development department / cloud department
- **Output deliverables:** Data-acquisition-means summary (data × route × latency × availability × cost × available via existing IF)
- **Granularity / completeness:** Draft version — before confirmation by the partner departments
- **Predecessor / Successor:** Predecessor: SYS1-05-b, SYS1-01-k, SYS1-03-m / Successor: SYS1-05-f, SYS1-05-i, SYS1-05-n
- **Entry:** The IVI's existing interface specifications can be referenced
- **Exit (DoD):** ① Every data item has candidate acquisition paths ② whether it can be obtained via the existing interfaces has been confirmed ③ an alternative is documented where the path is not yet in place
- **Concrete examples:** ① Organize the latency, availability (when out of network coverage), and implementation cost of each means: via the in-vehicle network (CAN / Ethernet), via the cloud (vehicle data aggregated in the cloud and retrieved by the IVI), and via the smartphone. ② Check the list of signals obtainable through the IVI platform's existing interface (the vehicle-signal acquisition API), and confirm whether the fatigue-estimate result is among them. ③ Examine the alternatives where the acquisition means is not yet in place (waiting for the next platform, adding it via OTA, an approximation via the cloud).

#### SYS1-05-f — Confirm the data quality

- **Purpose:** Confirm the accuracy, freshness, and availability of the data, and feed back to the experience design the impact where it falls short of the requirements.
- **Work content:** Confirm with the responsible departments the accuracy and output frequency of the fatigue estimate and the handling of data loss and initialization on communication loss or restart, and assess the impact on the trigger conditions.
- **Input deliverables:** Data-acquisition-means summary, required-data list
- **Input source:** ADAS department / vehicle control department / cloud department
- **Output deliverables:** Data-quality assessment table (data × accuracy × freshness × loss conditions × impact on the experience)
- **Granularity / completeness:** Fixed version — confirmed by the responsible departments
- **Predecessor / Successor:** Predecessor: SYS1-05-e / Successor: SYS1-05-g, SYS1-04-e (revisit)
- **Entry:** The request for confirmation to the responsible departments has been accepted
- **Exit (DoD):** ① The accuracy and output frequency of the main data are recorded ② the loss and initialization conditions are recorded ③ the impact on the experience of data that falls short of the requirements, and the response, are documented
- **Concrete examples:** ① Confirm with the responsible department the accuracy of the fatigue estimate (false-detection rate, detection delay) and its output frequency, and compare them with the false-detection tolerance assumed in the experience design. ② Confirm the handling of data loss and initialization on communication loss or engine restart (does the continuous driving time reset?). ③ Reflect the impact on the experience if the accuracy falls short of the requirement (more mistaken suggestions) in a revisit of the trigger conditions (combining with a time base).

#### SYS1-05-g — Draft the responsibility boundary

- **Purpose:** Decide who performs the "is a rest needed?" judgment, making change impact and root-cause isolation easier.
- **Work content:** Organize the options for where the judgment logic resides, and draft a responsibility-boundary proposal from the viewpoints of the scope of impact on change and the isolation of causes when a suggestion is mistaken.
- **Input deliverables:** Data-quality assessment table, data-acquisition-means summary
- **Input source:** Own department (deliverables from the preceding step) / IVI development department / ADAS department
- **Output deliverables:** Responsibility-boundary proposal (judgment × location proposal × change impact × ease of isolation × recommendation)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS1-05-f / Successor: SYS1-05-h, SYS1-05-k, SYS2-13
- **Entry:** The data-quality assessment table has been created
- **Exit (DoD):** ① Multiple options for where the judgment logic resides are organized ② change impact and ease of isolation are assessed ③ a recommended proposal is documented
- **Concrete examples:** ① Organize the options for the "is a rest needed?" judgment: the IVI performs it (deriving it from time and position), the driver monitor's judgment result is used as-is, or an integrated judgment is made in the cloud. ② For each location of the judgment logic, organize the scope of impact when it changes (does an OTA update of the IVI suffice, or is a vehicle-side ECU update required?). ③ Propose a responsibility boundary that lets you isolate, when a mistaken suggestion occurs, whether "the data was wrong" or "the judgment was wrong".

#### SYS1-05-h — Ensure HMI consistency

- **Purpose:** Make the expression of the instrument cluster / HUD and the IVI consistent, guaranteeing coherence of the experience.
- **Work content:** Organize the priority and expression consistency when an instrument-cluster / HUD fatigue warning and the IVI rest suggestion appear at the same time, and confirm consistency with the company-wide HMI policy.
- **Input deliverables:** Responsibility-boundary proposal, other-domain information expression policy, existing-feature and retrofit research record, HMI policy
- **Input source:** IVI development department / instrument-cluster department / design department
- **Output deliverables:** HMI-consistency summary (simultaneous-trigger case × priority × expression rule × additional data items)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS1-05-g, SYS1-04-n, SYS1-03-f / Successor: SYS1-05-i, SYS2-13
- **Entry:** The instrument-cluster-side warning specifications and the HMI policy can be referenced
- **Exit (DoD):** ① The priority for simultaneous-trigger cases is organized ② consistency with the HMI policy has been confirmed ③ the additional data items required are reflected
- **Concrete examples:** ① Organize the priority and expression consistency (wording, timing, overlapping sounds) when a fatigue warning on the instrument cluster / HUD and the IVI rest suggestion appear at the same time. ② Confirm consistency with the company-wide HMI policy (the use of warning colors, the types of sound, the distinction between a suggestion and a warning). ③ Reflect into the required-data list, as additional data items, the integration information needed to maintain consistency (the instrument-cluster-side warning state, the timing at which the warning clears).

#### SYS1-05-i — Inquire about data provision

- **Purpose:** Inquire with the partner departments about whether, in what form, and when the data can be provided, and grasp the constraints.
- **Work content:** Inquire with the vehicle control, ADAS, and cloud departments about whether, in what form, and when the required data can be provided, and record any reasons for refusal and any conditions.
- **Input deliverables:** Required-data list, data-owning-domain map, data-acquisition-means summary, HMI-consistency summary
- **Input source:** Vehicle control department / ADAS department / cloud department
- **Output deliverables:** Data-provision response table (data × available or not × format × timing × conditions × reason)
- **Granularity / completeness:** Fixed version — settled on the basis of each department's response (non-responses stated explicitly)
- **Predecessor / Successor:** Predecessor: SYS1-05-b, -e, -h / Successor: SYS1-05-j, SYS1-05-k, SYS1-05-l
- **Entry:** The points of contact for the inquiry and the inquiry format are in place
- **Exit (DoD):** ① Every mandatory data item has a response (or the non-response is stated explicitly) ② reasons for non-provision are recorded ③ where provision is conditional, the conditions are reflected in the constraints
- **Concrete examples:** ① Inquire with the vehicle control and ADAS departments about whether the required data can be provided, in what format (signal name, period, unit), and at what timing (in time for the target model's SOP). ② Record the reasons where it cannot be provided (safety constraints, cost, the ECU specification is already frozen). ③ Reflect in the constraints any conditions attached to provision (internal review, security certification, approval by another department).

#### SYS1-05-j — Set the privacy and consent policy

- **Purpose:** Confirm whether and how consent is required for the use of personal data, and set a policy for the feature restrictions when consent is refused.
- **Work content:** Confirm with legal whether consent is required for the use of location, driving-behavior, and driver-state data, and set a policy for the consent-capture method, the feature restrictions on refusal, and the storage scope.
- **Input deliverables:** Required-data list, settings-feature policy, privacy policy
- **Input source:** Legal department / own department (deliverables from the preceding step)
- **Output deliverables:** Privacy & consent policy (data × consent required × capture method × behavior on refusal × storage scope)
- **Granularity / completeness:** Draft version — confirmed by legal; details fixed in requirements definition
- **Predecessor / Successor:** Predecessor: SYS1-05-i, SYS1-04-r / Successor: SYS1-05-o, SYS1-06-l, SYS2-12
- **Entry:** The consultation request to the legal department has been accepted
- **Exit (DoD):** ① Whether consent is required for the main data has been confirmed ② the consent-capture method and the feature restrictions on refusal are set as policy ③ the storage scope is set as policy
- **Concrete examples:** ① Confirm with legal whether consent is required under the Act on the Protection of Personal Information and the privacy policy for the use of location, driving-behavior, and driver-state data. ② Examine the method of capturing consent (a consent screen on the IVI, the terms at the time of contract) and the feature restrictions on refusal (only the simplified time-based version is provided). ③ Set the policy for the data storage scope (contained within the vehicle / transmitted to the cloud / anonymized transmission for KPI measurement).

#### SYS1-05-k — Compare the integration-scope proposals

- **Purpose:** Compare multiple options for the integration scope, and map them to the initial release and OTA expansion.
- **Work content:** Create the three proposals minimum integration / standard / full, and organize the experience quality, delivery timing, cost, and risk into a comparison table.
- **Input deliverables:** Integration added-value summary, responsibility-boundary proposal, data-provision response table
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Integration-scope comparison table (proposal × integrations included × experience × timing × cost × risk × initial / OTA mapping)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS1-05-d, -g, -i / Successor: SYS1-05-l, SYS1-05-m, SYS1-05-n
- **Entry:** The data-provision response table is complete
- **Exit (DoD):** ① Three proposals are defined ② the comparison table is filled in ③ the initial-release proposal and the OTA-expansion proposal are mapped to each other
- **Concrete examples:** ① Create three proposals: minimum integration (IVI alone + vehicle speed only), standard (driving time + route + facility information), and full (fatigue estimate + instrument-cluster linkage). ② Organize into a comparison table each proposal's experience quality (false-detection rate, suggestion accuracy), delivery timing, cost, and risk (dependence on unanswered provision inquiries). ③ Map the initial-release proposal to the OTA-expansion proposal, stating explicitly the advance preparation needed for OTA expansion (the groundwork for data acquisition, capturing consent).

#### SYS1-05-l — Hear out the partner departments

- **Purpose:** Grasp the partner departments' technical concerns and constraints, and make clear the scope that can be agreed.
- **Work content:** Explain the integration proposal in meetings with the partner departments, hear out the technical concerns and the other department's constraints, and make clear the agreed and non-agreed scope.
- **Input deliverables:** Integration-scope comparison table, data-provision response table, stakeholder map
- **Input source:** Partner departments (IVI development, vehicle control, ADAS, cloud)
- **Output deliverables:** Partner-department hearing minutes (concerns × constraints × agreed scope × non-agreed scope × action items)
- **Granularity / completeness:** Fixed version — confirmed by the partner departments
- **Predecessor / Successor:** Predecessor: SYS1-05-k, SYS1-01-l / Successor: SYS1-05-m, SYS1-05-o
- **Entry:** Meetings with the partner departments have been scheduled
- **Exit (DoD):** ① The technical concerns are recorded ② the other departments' constraints are recorded ③ the agreed scope, the non-agreed scope, and the action items are made clear
- **Concrete examples:** ① Explain the integration proposal in meetings with the partner departments, and hear out their technical concerns (real-time behavior of the signals, security, ECU load). ② Record the constraints the other departments face (development resources, the specification-freeze date, priority relative to other projects). ③ Make clear the scope that can be agreed (providing vehicle speed and shift position) and the scope that cannot (providing the fatigue estimate this term), and set the action items and response deadlines.

#### SYS1-05-m — Estimate the integration cost and schedule

- **Purpose:** Roughly estimate the cost and schedule impact of the integration, and sort out the integrations that will not make it in time.
- **Work content:** Surface the development items for each integration proposal, collect rough effort estimates, and confirm and sort them against the IVI specification freeze and the SOP.
- **Input deliverables:** Integration-scope comparison table, partner-department hearing minutes, target-premises table (SOP, specification-freeze date)
- **Input source:** Partner departments (rough effort) / own department (aggregation)
- **Output deliverables:** Integration cost & schedule estimate table (proposal × development item × owner × effort × timing × in-time verdict)
- **Granularity / completeness:** Draft version — a rough estimate, refined in the business-viability study (SYS1-06-h)
- **Predecessor / Successor:** Predecessor: SYS1-05-l, SYS1-01-j / Successor: SYS1-05-o, SYS1-06-h, SYS1-06-n
- **Entry:** The development items have been grasped from the partner-department hearings
- **Exit (DoD):** ① The development items for each proposal are organized by responsible department ② rough effort estimates have been collected ③ the integrations that will not make it in time have been sorted out
- **Concrete examples:** ① List the development items required for each integration proposal (IVI-side reception, judgment, and display; vehicle-side signal output; cloud-side aggregation), and collect rough effort estimates from the responsible departments. ② Confirm consistency with the target model's IVI specification freeze and SOP, and judge whether integrations involving vehicle-side ECU changes will make the specification freeze. ③ Sort the integrations that will not make the schedule into OTA addition (where the IVI side alone can handle it) or deferral.

#### SYS1-05-n — Raise the security and functional-safety issues

- **Purpose:** Surface the security and functional-safety issues, and organize them as study requests to the specialist departments.
- **Work content:** Raise as issues whether security requirements apply to external communication and vehicle-signal access, and the points where a judgment on safety-feature applicability is needed.
- **Input deliverables:** Integration-scope comparison table, data-acquisition-means summary
- **Input source:** Own department (deliverables from the preceding step) / security department / functional-safety department
- **Output deliverables:** Security & functional-safety issue list (issue × related integration × study requested from × deadline)
- **Granularity / completeness:** Rough version — recorded as issues; detailed study is for the specialist departments
- **Predecessor / Successor:** Predecessor: SYS1-05-e, -k / Successor: SYS1-05-o, SYS1-06-o, SYS1-07-a
- **Entry:** The integration-scope comparison table has been created
- **Exit (DoD):** ① The security issues are documented ② whether a judgment on functional-safety applicability is needed is documented ③ the department the study is requested from and the deadline are documented
- **Concrete examples:** ① Record as issues the security requirements relating to external communication and vehicle-signal access (whether UN-R155/156 compliance applies, the treatment under the CSMS). ② Raise as an issue the points where a judgment is needed on whether the rest suggestion constitutes a safety feature (does it fall under ISO 26262; does failing to suggest affect safety?). ③ State explicitly that the detailed study is entrusted to the specialist departments, and set the study request and the response deadline.

#### SYS1-05-o — Consolidate and agree the integration policy

- **Purpose:** Consolidate the results of the integration study, and agree the adopted proposal with the planning owner and the partner departments.
- **Work content:** Produce the domain-integration policy (draft version) integrating the required-data list, owning domains, acquisition means, responsibility boundary, adopted integration scope, constraints, and open issues, and confirm the adopted proposal at the review.
- **Input deliverables:** All deliverables of work items a–n
- **Input source:** Own department (authoring) / planning owner and partner departments (review)
- **Output deliverables:** Domain-integration policy (draft version: IDs assigned to each data item, unresolved matters stated explicitly), review minutes
- **Granularity / completeness:** Draft version — reviewed by the planning owner and the partner departments
- **Predecessor / Successor:** Predecessor: SYS1-05-j, -k, -l, -m, -n / Successor: SYS1-06-h, SYS1-06-m, SYS1-06-o, SYS2-13
- **Entry:** The deliverables of work items a–n are all available
- **Exit (DoD):** ① An ID is assigned to each data item ② the adopted integration scope has been confirmed ③ unresolved matters (unanswered provision inquiries, etc.) are stated explicitly and registered in the issue list
- **Concrete examples:** ① Integrate the required-data list, owning domains, acquisition means, responsibility boundary, adopted integration scope, and constraints & open issues, assigning an ID to each data item so it can be traced into the requirements list and the function-allocation diagram. ② Confirm the adopted proposal at the review with the planning owner and the partner departments (e.g. standard integration initially, with the fatigue estimate as OTA expansion), and minute it. ③ State explicitly the unresolved matters (unanswered provision inquiries, awaiting a legal response) and register them in the issue list.

---

### SYS1-06 (L2) — Verifying acceptability and business viability, and narrowing the plan

- **ASPICE BP:** Pre-SYS.1 stage (BP3 preparation)
- **Purpose:** Verify whether users will really use it and pay for it and whether it stands up as a business, and sort features into initial release / OTA addition / deferral with rationale.
- **Work content:** Carry out work items a–q, produce the plan document (revised version), and obtain approval at the decision-making meeting.
- **Input deliverables:** Value-proposition definition, differentiation summary, experience-scenario document and trigger-condition definition, domain-integration policy, integration cost estimate table, price / monetization-model research table
- **Input source:** Own department (deliverables from the preceding step) / external (research agencies)
- **Output deliverables:** Plan document (revised, fixed version), business-viability assessment (revenue model / cost / P&L simulation / KPI tree / success criteria), scope-sorting table, risk & premises list
- **Granularity / completeness:** Fixed version — approved by the decision-making meeting
- **Predecessor / Successor:** Predecessor: SYS1-02 – SYS1-05 / Successor: PH2 (SYS1-07)
- **Entry:** The various draft-version documents are all available
- **Exit (DoD):** The plan document has been approved (or conditionally approved) at the decision-making meeting, and the conditions and decisions are recorded
- **Concrete examples:** (see the work items beneath) verification design including the falsification hypotheses, willingness to pay via PSM, analysis of the reasons for not using it, KPI design centred on the rest-taken rate, and sorting on value × feasibility × business contribution.

#### SYS1-06-a — Organize the verification hypotheses

- **Purpose:** Organize the hypotheses to be verified with numeric targets, including the falsification hypotheses among the verification subjects.
- **Work content:** Set verification hypotheses for acceptability, willingness to pay, and continued use with numeric targets, and assign a verification method to each including the falsification hypotheses.
- **Input deliverables:** Value-proposition definition (falsification-hypothesis list, value-decomposition table), existing-verification-results sorting table (matters requiring verification)
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Verification-hypothesis list (hypothesis × numeric target × verification method × priority)
- **Granularity / completeness:** Fixed version — confirmed by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-02-r, -m, -d, SYS1-01-e / Successor: SYS1-06-b
- **Entry:** The value-proposition definition (draft version) is settled
- **Exit (DoD):** ① The acceptability, willingness-to-pay, and continuation hypotheses each have a numeric target ② the falsification hypotheses are included ③ a verification method is assigned
- **Concrete examples:** ① Set verification hypotheses with numeric targets, such as "○% of the target find the suggestion useful", "at ¥○ per month, ○% subscribe", and "○% are still using it after 3 months". ② Include the falsification hypotheses (suggestions are unnecessary, a smartphone is enough, they do not stop even when suggested) among the verification items. ③ Assign a verification method to each hypothesis (quantitative survey / PSM / reuse of the interview results / the track record of comparable services).

#### SYS1-06-b — Plan the verification

- **Purpose:** Choose verification methods balanced between accuracy and cost, within the range that produces results before the decision.
- **Work content:** Choose a method per verification hypothesis, compare cost, duration, and accuracy, and narrow to the methods that complete before the decision-making meeting.
- **Input deliverables:** Verification-hypothesis list, study WBS, research budget
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Verification plan (hypothesis × method × sample size × duration × cost × owner)
- **Granularity / completeness:** Fixed version — approved by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-06-a, SYS1-01-n / Successor: SYS1-06-c
- **Entry:** The verification-hypothesis list is settled, and the upper limit of the research budget has been indicated
- **Exit (DoD):** ① A method is assigned to each hypothesis ② the schedule completes before the decision-making meeting ③ the items substituted by existing research are stated explicitly
- **Concrete examples:** ① Set the policy of verifying acceptability by a quantitative survey (n ≈ 500), willingness to pay by PSM analysis, and continued use by a limited actual-vehicle PoC or by referring to the retention track record of comparable services. ② Choose the methods on the balance of cost, duration, and accuracy, and exclude — or defer to post-release verification — the methods that will not produce results before the decision-making meeting (a long-running PoC). ③ Exclude the items that can be substituted by existing research (market research reports, interview results) to hold down the research cost.

#### SYS1-06-c — Design the questionnaire

- **Purpose:** Design a questionnaire that can measure acceptability, the reasons for not using it, the acceptable frequency, and willingness to pay.
- **Work content:** Design a questionnaire and screening conditions asking about intent to use after the concept is presented, the reasons for not using it, the usage context, the acceptable frequency, the notification means, and the reaction to price.
- **Input deliverables:** Verification plan, persona sheet, price / monetization-model research table, usage-motivation & abandonment-factor hypothesis table
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Questionnaire (questions, options, presented concept, screening conditions)
- **Granularity / completeness:** Fixed version — confirmed by the planning owner and the research agency
- **Predecessor / Successor:** Predecessor: SYS1-06-b, SYS1-03-n, SYS1-02-l / Successor: SYS1-06-d
- **Entry:** The verification plan has been approved
- **Exit (DoD):** ① There are questions corresponding to the verification hypotheses ② there are options plus a free-text field for the reasons for not using it ③ the screening conditions are set
- **Concrete examples:** ① Present the concept sheet and ask "would use" / "would not use" and the reason, the usage context, the acceptable frequency, and the preferred notification means. ② Prepare options for the "reason for not using it" (annoying, I can judge for myself, cost, it looks like it would hide the map, I dislike having my fatigue judged) and also capture free text. ③ Set the screening conditions (experience of long-distance driving several times a year or more, ownership of or consideration of purchasing a comparable model), and incorporate the PSM price questions (too expensive / too cheap, etc. — 4 questions).

#### SYS1-06-d — Conduct the survey

- **Purpose:** Conduct the survey and tabulate the results by persona and by context.
- **Work content:** Commission a research agency to run and collect the survey, and cross-tabulate the acceptance rate, willingness to pay, and the distribution of reasons for not using it, by persona and by context.
- **Input deliverables:** Questionnaire, verification plan
- **Input source:** External (research agency) / own department (tabulation)
- **Output deliverables:** Survey tabulation results (simple tabulation, cross-tabulation, raw data)
- **Granularity / completeness:** Fixed version — settled as the tabulation result
- **Predecessor / Successor:** Predecessor: SYS1-06-c / Successor: SYS1-06-e, SYS1-06-f, SYS1-06-i
- **Entry:** The contract with the research agency and the final check of the questionnaire are complete
- **Exit (DoD):** ① The target sample size has been collected ② cross-tabulations by persona and by context are available
- **Concrete examples:** ① Commission the research agency to run and collect it (checking the collection status midway and judging whether the screening conditions need relaxing). ② Cross-tabulate by persona (primary / secondary) and by context (with family aboard / alone). ③ Organize the distribution of the acceptance rate, willingness to pay, and reasons for not using it, and compare them with the numeric targets of the verification hypotheses.

#### SYS1-06-e — Analyze willingness to pay

- **Purpose:** Grasp the willingness-to-pay level and the difference in acceptance across charging forms, as an input to the revenue-model study.
- **Work content:** Derive the reasonable price range by PSM analysis, and compare the difference in acceptance between inclusion in the base package and standalone charging.
- **Input deliverables:** Survey tabulation results, price / monetization-model research table
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Willingness-to-pay analysis results (PSM upper / lower bound, reasonable price range, acceptance rate by charging form, implications)
- **Granularity / completeness:** Fixed version — settled as the analysis result
- **Predecessor / Successor:** Predecessor: SYS1-06-d, SYS1-03-n / Successor: SYS1-06-g, SYS1-06-i
- **Entry:** The survey tabulation results are settled
- **Exit (DoD):** ① The PSM price range has been derived ② the difference in acceptance by charging form is compared ③ implications on the viability of standalone charging are documented
- **Concrete examples:** ① Derive the upper bound, lower bound, and reasonable price range by PSM analysis, and compare them against the competitors' going rates. ② Compare the difference in acceptance rate between "included in the base package (no additional charge)" and "standalone charging (monthly)". ③ If the reaction to price is weak (intent to subscribe does not rise even at a low price), place a question mark over the viability of the standalone charging model and document the implication that the bundled form should be the primary proposal.

#### SYS1-06-f — Analyze the reasons for not using it

- **Purpose:** Analyze the reasons for not using it, distinguishing those that experience design can resolve from those that require revisiting the plan.
- **Work content:** Analyze the distribution of reasons for not using it, judge whether each can be resolved by experience design or requires revisiting the value pitch or the target contexts, and identify the segments at high risk of churn.
- **Input deliverables:** Survey tabulation results, usage-motivation & abandonment-factor hypothesis table, experience-scenario document
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Reasons-for-not-using analysis results (reason × proportion × means of resolution × impact on the plan × high-risk segment)
- **Granularity / completeness:** Fixed version — settled as the analysis result
- **Predecessor / Successor:** Predecessor: SYS1-06-d, SYS1-02-l / Successor: SYS1-06-m, SYS1-06-o
- **Entry:** The survey tabulation results are settled
- **Exit (DoD):** ① The reasons for not using it are classified with proportions calculated ② each reason documents either a means of resolution or the impact on the plan ③ the segments at high risk of churn are identified
- **Concrete examples:** ① If "annoying" is the main cause, assess whether experience design (frequency control, an OFF setting, re-presentation rules) can resolve it, and if so, state it explicitly as a requirement. ② If "I see no need for it" is the main cause, examine either the value pitch (the suggestion wording, the first-run explanation) or a revisit of the target contexts (narrowing to when family is aboard only). ③ Identify from the distribution of reasons the "segments at high risk of churn" (e.g. experienced drivers travelling alone), using this as material for revisiting the default settings.

#### SYS1-06-g — Assess the revenue models

- **Purpose:** Organize the revenue-model options, and assess them on scale, difficulty of realization, and brand impact.
- **Work content:** Enumerate candidate revenue models — subscription, inclusion in the vehicle price, dealer option, B2B, referral fees, etc. — and produce the assessment and combination proposals.
- **Input deliverables:** Willingness-to-pay analysis results, price / monetization-model research table, higher-level-policy correspondence table, higher-level-policy correspondence table (prohibited matters)
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Revenue-model assessment table (model × revenue scale × difficulty of realization × brand impact × combination proposal)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS1-06-e, SYS1-03-n, SYS1-01-a / Successor: SYS1-06-i
- **Entry:** The willingness-to-pay analysis results are settled
- **Exit (DoD):** ① At least 5 models are assessed ② combination proposals have been created ③ consistency with the higher-level policy (subscription revenue targets, etc.) has been confirmed
- **Concrete examples:** ① Enumerate subscription (monthly), inclusion in the vehicle price, a dealer option, B2B (for fleet-operations businesses), referral fees from the rest facilities, and so on. ② Assess each model's revenue scale (subscription rate × unit price × number of vehicles), difficulty of realization (whether a billing platform exists, contracts with the facilities), and brand impact (might referral fees be perceived as "advertising"?). ③ Create combination proposals across multiple models (B2C bundled, B2B paid), and check them against the planning owner's prohibited matters (displaying advertising).

#### SYS1-06-h — Organize the cost structure

- **Purpose:** Organize the development, operations, and promotion cost structure, and tie it to each integration-scope proposal.
- **Work content:** Itemize the development, operations, and promotion costs, tie the costs to each integration-scope proposal, and estimate the per-vehicle cost.
- **Input deliverables:** Integration cost & schedule estimate table, domain-integration policy, usage-reality table, target-premises table
- **Input source:** Partner departments (effort) / own department (sales-volume forecast)
- **Output deliverables:** Cost-structure table (item × integration-scope proposal × amount × per-vehicle cost)
- **Granularity / completeness:** Draft version — a rough estimate for the decision-making meeting
- **Predecessor / Successor:** Predecessor: SYS1-05-m, -o, SYS1-02-g / Successor: SYS1-06-i
- **Entry:** The integration cost estimate table and the sales-volume forecast are both available
- **Exit (DoD):** ① The development, operations, and promotion items are covered comprehensively ② costs are tied to each integration-scope proposal ③ the per-vehicle cost has been estimated
- **Concrete examples:** ① Itemize the development costs (IVI, cloud, vehicle-side integration), operations costs (cloud usage fees, map and facility-data licences, customer support), and promotion costs (dealer explanatory materials, a first-run explanatory video). ② Tie the costs to each integration-scope proposal (minimum / standard / full), and confirm whether the additional cost of the full proposal is commensurate with the added value of the fatigue-estimate integration. ③ Estimate the per-vehicle cost from the target model's sales-volume forecast, and grasp the impact on unit cost if it is included in the vehicle price.

#### SYS1-06-i — Simulate the P&L

- **Purpose:** Estimate the P&L across multiple scenarios, and identify the break-even point and the variables with the highest sensitivity.
- **Work content:** Set the subscription-rate, retention-rate, and price premises across 3 scenarios, estimate the 5-year P&L, and perform break-even and sensitivity analysis.
- **Input deliverables:** Revenue-model assessment table, cost-structure table, willingness-to-pay analysis results, survey tabulation results
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** P&L simulation (3 scenarios × 5 years, break-even point, sensitivity analysis, list of premises)
- **Granularity / completeness:** Draft version — for the decision-making meeting
- **Predecessor / Successor:** Predecessor: SYS1-06-g, -h, -e, -d / Successor: SYS1-06-j, SYS1-06-o
- **Entry:** The revenue model and the cost structure are organized
- **Exit (DoD):** ① The 5-year P&L for 3 scenarios has been estimated ② the break-even point has been derived ③ the variables with the highest sensitivity are identified ④ the premises are listed
- **Concrete examples:** ① Set the subscription-rate, retention-rate, and price premises across 3 scenarios — bullish / standard / bearish (discounting the survey's intent-to-use to set the standard value) — and estimate the 5-year P&L. ② Derive the subscription rate at which it breaks even, and assess its achievability against the survey's acceptance rate. ③ Identify by sensitivity analysis the variable that most affects the P&L (subscription rate, retention rate, or unit price), and make it the focus of the KPI design.

#### SYS1-06-j — Design the KPI tree

- **Purpose:** Design the KPIs around outcome measures, and make the relationship to the business KPIs visible.
- **Work content:** Define the KPIs as outcome measures, build a tree of their relationship to the higher-level business KPIs, distinguish leading from lagging indicators, and record the basis of the target values.
- **Input deliverables:** P&L simulation, post-acceptance experience definition, value-proposition definition
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** KPI tree (business KPI × service KPI × leading / lagging × target value × basis)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS1-06-i, SYS1-04-h / Successor: SYS1-06-k, SYS1-06-l
- **Entry:** The P&L simulation has been created
- **Exit (DoD):** ① The KPIs are defined as outcome measures ② there is a tree relating them to the business KPIs ③ leading and lagging are distinguished and the target values have a basis
- **Concrete examples:** ① Define the KPIs not as "number of suggestion displays" but as outcome measures such as "rate of rests taken via a suggestion", "continued-use rate", and "OFF-setting rate", and build a tree of their relationship to the higher-level business KPIs (revenue, customer satisfaction, safety indicators). ② Distinguish the leading indicators (suggestion response rate, OFF-setting rate) from the lagging indicators (retention rate, cancellation rate). ③ Record for each KPI the basis of the target value (the survey acceptance rate, the track record of comparable services).

#### SYS1-06-k — Set the success criteria

- **Purpose:** Decide in advance criteria that can objectively judge success or failure after release, and the actions if they are not met.
- **Work content:** Set the judgment criteria at 3 months and 1 year after release, and confirm the actions if they are not met and whether the data used for the judgment can be obtained.
- **Input deliverables:** KPI tree, domain-integration policy (data storage scope)
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Success criteria (point in time × indicator × threshold × action if not met × data obtainability)
- **Granularity / completeness:** Fixed version — approved at the decision-making meeting
- **Predecessor / Successor:** Predecessor: SYS1-06-j / Successor: SYS1-06-l, SYS1-06-p
- **Entry:** The KPI tree has been created
- **Exit (DoD):** ① The judgment criteria per point in time are set numerically ② the actions if not met are defined ③ the obtainability of the judgment data has been confirmed
- **Concrete examples:** ① Set the judgment criteria at 3 months and 1 year after the initial release (e.g. suggestion response rate of 30% or more, OFF-setting rate below 20%, rest-taken rate of 15% or more). ② Define in advance the actions if the criteria are not met (relaxing or tightening the trigger conditions, changing the wording, halting the feature or withdrawing), and agree them with the decision-makers. ③ Confirm the obtainability of the data used for the judgment (it cannot be measured if the consent rate for cloud transmission is low).

#### SYS1-06-l — Enumerate the measurement data items

- **Purpose:** Surface the data items needed for KPI measurement, as a hand-off to the requirements list.
- **Work content:** Enumerate the log items for suggestion display, response, rest taken, setting changes, etc., confirm whether consent and transmission are required, and turn this into a hand-off to the non-functional requirements.
- **Input deliverables:** Success criteria, KPI tree, post-acceptance experience definition, privacy & consent policy
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Measurement data item list (KPI × log item × capture point × consent required × transmission required)
- **Granularity / completeness:** Draft version — fixed in requirements definition
- **Predecessor / Successor:** Predecessor: SYS1-06-k, SYS1-04-h, SYS1-05-j / Successor: SYS2-12
- **Entry:** The success criteria are set
- **Exit (DoD):** ① Log items corresponding to every KPI are enumerated ② whether consent and transmission are required has been confirmed ③ it is organized as a hand-off to the requirements list
- **Concrete examples:** ① Enumerate the data items needed for KPI measurement (suggestion-display log, response log, stop detection at a rest facility, setting-change log, the timing of the OFF setting). ② Confirm whether consent is required to capture the data, whether transmission from the vehicle to the cloud is required, and whether anonymization suffices. ③ Make the data items a hand-off to the requirements list (non-functional requirements: logging, data transmission), recorded with IDs.

#### SYS1-06-m — Prioritize the features

- **Purpose:** Score the candidate features on value, feasibility, and business contribution, and rank them taking the dependencies into account.
- **Work content:** Score the candidate features raised so far on user value × feasibility × business contribution, organize the dependencies, and assign priorities.
- **Input deliverables:** Value-proposition definition (JTBD), differentiation summary (durability assessment), experience-scenario document, domain-integration policy, reasons-for-not-using analysis results
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Feature priority table (feature × value × feasibility × business contribution × dependencies × rank)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS1-02-k, SYS1-03-k, -o, SYS1-04-t, SYS1-05-o, SYS1-06-f / Successor: SYS1-06-n
- **Entry:** The various draft-version documents are all available
- **Exit (DoD):** ① Every candidate feature is assigned a score ② the dependencies are organized ③ ranks are assigned
- **Concrete examples:** ① Score the candidate features (the basic time-based suggestion, fatigue-estimate integration, service/parking-area facility-information display, adding a waypoint, passenger-facing display, frequency setting, facility reservation) on user value × feasibility × business contribution. ② Organize the dependencies (facility reservation presupposes facility-information integration and a cloud contract; fatigue-estimate integration depends on the ADAS department's delivery timing). ③ Treat the top scorers as the initial candidates, and link the basis of the scores (survey data, cost estimates).

#### SYS1-06-n — Sort the scope

- **Purpose:** Sort features into initial release / OTA addition / deferral against explicitly stated criteria.
- **Work content:** Sort the candidate features into initial release, later OTA addition, and deferral, state the sorting criteria explicitly, and judge whether the advance preparation needed for OTA addition must be built in initially.
- **Input deliverables:** Feature priority table, integration-scope comparison table, integration cost & schedule estimate table, target-premises table
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Scope-sorting table (feature × category × criterion × advance preparation × rationale)
- **Granularity / completeness:** Draft version — for the decision-making meeting
- **Predecessor / Successor:** Predecessor: SYS1-06-m, SYS1-05-k, -m / Successor: SYS1-06-o
- **Entry:** The feature priority table has been created
- **Exit (DoD):** ① Every candidate feature is sorted into one of the 3 categories ② the sorting criteria are stated explicitly ③ the treatment of the advance preparation for OTA addition has been judged
- **Concrete examples:** ① Sort the candidate features into "initial release", "added later via OTA", and "deferred". ② State the sorting criteria explicitly (the size of the value, the readiness of the integration, whether it makes the SOP, risk, dependencies on other features). ③ For the OTA-addition candidates (fatigue-estimate integration), judge whether the advance preparation needed for the addition (the data-reception interface, the items on the consent screen) should be included in the initial release.

#### SYS1-06-o — Document the sorting rationale, risks, and premises

- **Purpose:** Document the sorting rationale together with the risks and premises, reaching a state that withstands explanation to the decision-makers.
- **Work content:** Record the sorting result and rationale for each feature, and organize the conditions for lifting a deferral, the business, technical, experience, and legal risks with their countermeasures, and the premises on which the plan stands.
- **Input deliverables:** Scope-sorting table, reasons-for-not-using analysis results, P&L simulation, domain-integration policy, security & functional-safety issue list
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Sorting-rationale document, risk & premises list (risk × impact × likelihood × countermeasure, premises)
- **Granularity / completeness:** Draft version — for the decision-making meeting
- **Predecessor / Successor:** Predecessor: SYS1-06-n, -f, -i, SYS1-05-n, -o / Successor: SYS1-06-p
- **Entry:** The scope-sorting table has been created
- **Exit (DoD):** ① The rationale for each feature is recorded one by one ② the conditions for lifting a deferral are recorded ③ each risk has an impact, likelihood, and countermeasure, and the premises are stated explicitly
- **Concrete examples:** ① Record the sorting result and rationale for each feature (survey data, cost, technical constraints, whether it makes the SOP) one by one, and for the deferred features record "the condition under which the reason for deferral is removed" (e.g. the next-generation IVI provides a fatigue-estimate API). ② Organize the business risk (subscription rate not met), technical risk (data cannot be provided), experience risk (churn due to annoyance), and legal risk (liability issues), and document their impact, likelihood, and countermeasures. ③ State explicitly the premises on which the plan stands (the DCM is fitted as standard, a licence contract for the facility data).

#### SYS1-06-p — Produce the revised plan document

- **Purpose:** Produce a revised plan document integrating the study results, together with a summary for the decision-makers.
- **Work content:** Produce a revised plan document integrating the value proposition, personas, differentiation, experience scenarios, integration policy, business viability, and scope, plus a 1–2 page summary, and append the study history.
- **Input deliverables:** All draft-version documents, P&L simulation, KPI tree, success criteria, scope-sorting table, sorting-rationale document, risk & premises list
- **Input source:** Planning owner (authoring, confirmation)
- **Output deliverables:** Plan document (revised version), summary for the decision-makers, appendix (change history, study history, rejected proposals and the reasons)
- **Granularity / completeness:** Draft version — the version submitted to the decision-making meeting
- **Predecessor / Successor:** Predecessor: SYS1-06-o, -i, -j, -k / Successor: SYS1-06-q
- **Entry:** The deliverables of work items a–o are all available
- **Exit (DoD):** ① The revised plan document is integrated ② the summary is 1–2 pages ③ the change history and study history are appended ④ the planning owner's confirmation is complete
- **Concrete examples:** ① Produce a revised plan document integrating the value proposition, personas & contexts, differentiation, experience scenarios, integration policy, business viability, and scope, recording the changes from the original plan document in the change history. ② Produce a summary for the decision-makers (1–2 pages: what, for whom, why, at what price, when, and what you want them to decide). ③ Append the study history (rejected proposals and the reasons — e.g. standalone charging deferred because willingness to pay is weak), so that no one at the meeting asks "why wasn't this considered?".

#### SYS1-06-q — Obtain approval at the decision-making meeting

- **Purpose:** Obtain approval at the decision-making meeting, making it the official input to the requirements-definition phase.
- **Work content:** Submit it to the decision-making meeting after briefing the main stakeholders in advance, record the decision (approval / conditional approval / return) and the conditions, and distribute the fixed version.
- **Input deliverables:** Plan document (revised version), summary for the decision-makers, appendix
- **Input source:** Planning owner (submission, material preparation, recording)
- **Output deliverables:** Plan document (fixed version), decision-making meeting minutes (decision, conditions, action items)
- **Granularity / completeness:** Fixed version — approved by the decision-making meeting
- **Predecessor / Successor:** Predecessor: SYS1-06-p / Successor: SYS1-07-a (start of PH2)
- **Entry:** The decision-making meeting date and the deadline for submitting materials are met
- **Exit (DoD):** ① The decision (approval / conditional approval / return) and the conditions are recorded ② the approved plan document has been distributed as the fixed version ③ the conditions and action items have an owner and a deadline
- **Concrete examples:** ① Brief the main stakeholders (the heads of IVI development, ADAS, and legal) before the meeting, prepare answers to the anticipated questions (liability, cost), and eliminate their concerns. ② Record at the meeting the decision — approval / conditional approval / return — and the conditions (e.g. the fatigue-estimate integration is re-judged after the ADAS department's delivery timing is fixed). ③ Treat the approved plan document as the fixed version and distribute it to the relevant departments as the official input to the requirements-definition phase.

---

### PH2 (L1) — Phase ② Extracting and discussing the study issues, and compiling the system issue list

- **ASPICE BP:** SYS.1 BP1–BP6
- **Purpose:** Extract without omission, as issues, the undecided matters, contradictions, and contentious points remaining in the approved plan document; agree a response policy for each with rationale; and baseline the system issue list that becomes the official input to requirements definition.
- **Work content:** Carry out activities 7–9 and obtain a system issue list (fixed version) and a response-policy list agreed with the relevant departments.
- **Input deliverables:** Plan document (fixed version), the various draft-version documents (value-proposition definition / differentiation summary / experience-scenario document & trigger-condition definition / domain-integration policy), the content transferred to the issue lists at each step, stakeholder map
- **Input source:** Own department (deliverables from the preceding step) / relevant departments (IVI development, ADAS, vehicle control, cloud, legal, quality assurance, operations)
- **Output deliverables:** Issue list (fixed version), response-policy list (fixed version), system issue list (fixed version, baselined), revised planning-related documents
- **Granularity / completeness:** Fixed version — agreed with the relevant departments and baselined
- **Predecessor / Successor:** Predecessor: PH1 (SYS1-06) / Successor: PH3 (SYS2-10)
- **Entry:** The plan document (fixed version) approved at the decision-making meeting has been distributed
- **Exit (DoD):** The system issue list has been baselined, and explained and handed over at the kick-off of the requirements-definition phase
- **Concrete examples:** (see the activities beneath) e.g. for a rest-suggestion service, carry issues such as whether it should trigger in a traffic jam and where the judgment logic resides into requirements definition in this order: consolidate the issues → decide them at the study meetings → manage the undecided matters as issues.

---

### SYS1-07 (L2) — Extracting the study issues

- **ASPICE BP:** SYS.1 BP1, BP2
- **Purpose:** Extract without omission the issues that must be decided before entering requirements definition, and standardize, classify, and prioritize them to settle the issue list.
- **Work content:** Carry out work items a–n, produce the issue list (fixed version), and share it with the relevant departments.
- **Input deliverables:** Plan document (fixed version), the various draft-version documents, the content transferred to the issue lists at each step, the separation table of decided items / hypotheses / undecided items, the systemization vs. operations sorting table, stakeholder map
- **Input source:** Own department (deliverables from the preceding step) / relevant departments
- **Output deliverables:** Issue list (fixed version: issue ID × classification × question × options × decision inputs × decision-maker × deadline × priority × dependencies), candidate-requirements memo
- **Granularity / completeness:** Fixed version — confirmed by the planning owner; the window for additions from the relevant departments has closed
- **Predecessor / Successor:** Predecessor: SYS1-06 / Successor: SYS1-08
- **Entry:** The plan document (fixed version) has been distributed
- **Exit (DoD):** The issue list is settled, and every issue has a decision-maker, a deadline, and a priority
- **Concrete examples:** (see the work items beneath) consolidating the content transferred to the issue lists, reviewing the plan document by rereading it as requirements, standardizing to one issue = one question, and prioritizing by working back from the specification-freeze date.

#### SYS1-07-a — Consolidate the issues

- **Purpose:** Consolidate into a single list the matters transferred as issues at each step of Phase ①, leaving no gaps.
- **Work content:** Collect the content transferred to the issue lists at each step, the undecided matters, and the separation table of decided items / hypotheses / undecided items into a single consolidated issue list, recording the source and the originating step.
- **Input deliverables:** The content transferred to the issue lists at each step (SYS1-01-i, SYS1-02-r, SYS1-04-i, SYS1-04-q, SYS1-04-t, SYS1-05-n, SYS1-05-o, SYS1-06-o), decision-making meeting minutes (conditions, action items)
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Consolidated issue list (candidate issue × originating step × source document × date recorded)
- **Granularity / completeness:** Rough version — created by the planning owner, not yet organized
- **Predecessor / Successor:** Predecessor: SYS1-06-q, SYS1-01-i, SYS1-04-i, SYS1-04-q, SYS1-05-n, SYS1-06-o / Successor: SYS1-07-b, SYS1-07-c, SYS1-07-e
- **Entry:** The plan document (fixed version) and the various draft-version documents are all available
- **Exit (DoD):** ① The passages recording issues in every Phase ① document have been checked ② the conditions and action items from the decision-making meeting are included ③ each candidate issue has its source recorded
- **Concrete examples:** ① Search each draft-version document for the passages "recorded as an issue", "undecided matters", and "contentious cases", extract them, and record them one line at a time with the source document name and step ID. ② Add as candidate issues the conditions of the conditional approval in the decision-making meeting minutes (e.g. the fatigue-estimate integration is re-judged after the ADAS department's delivery timing is fixed) and the action items. ③ Where the same content is raised from multiple steps (whether to trigger in a traffic jam appears in both the edge-case list and the integration policy), note both sources and consolidate into a single entry.

#### SYS1-07-b — Hear out the departments

- **Purpose:** Pick up, as issues, the concerns and requests of the relevant departments that do not appear in the documents.
- **Work content:** Present the plan document (fixed version) to each department on the stakeholder map, briefly hear out their concerns, requests, and premises, and add them to the candidate issues.
- **Input deliverables:** Stakeholder map, plan document (fixed version), consolidated issue list
- **Input source:** Relevant departments (IVI development, ADAS, vehicle control, cloud, legal, quality assurance, operations, design)
- **Output deliverables:** Per-department hearing records, added candidate issues (department × concern × candidate issue)
- **Granularity / completeness:** Fixed version — settled as a hearing record
- **Predecessor / Successor:** Predecessor: SYS1-01-l, SYS1-07-a / Successor: SYS1-07-c, SYS1-07-e
- **Entry:** A point of contact is set for each department on the stakeholder map
- **Exit (DoD):** ① A hearing or a written inquiry has been carried out with every department on the map ② each department's concerns are recorded as candidate issues ③ the departments that did not respond are stated explicitly
- **Concrete examples:** ① Present the plan document to the IVI development department and have them raise the "points we need decided before we can start design" regarding interrupting the notification framework and the unit of OTA update. ② Confirm with the operations department and customer support the responsibility for handling enquiries when a suggestion appears in error and for handling errors in the facility information, and if it is not decided, make it a candidate issue. ③ Run 30-minute slots with each department once, and send a questionnaire (concerns, requests, premises, what you want decided) to the departments for which a written response suffices.

#### SYS1-07-c — Review the documents as requirements

- **Purpose:** Extract as issues the statements that become ambiguous or undefined when the plan document is reread as requirements.
- **Work content:** Read the plan document (fixed version) and the experience-scenario document through from the viewpoint of "can this be turned into a requirement statement as it stands?", and extract vague wording, unset values, undefined conditions, and contradictions.
- **Input deliverables:** Plan document (fixed version), experience-scenario document & trigger-condition definition, domain-integration policy, glossary
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Document-review findings list (passage × finding type × candidate issue)
- **Granularity / completeness:** Rough version — created by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-07-a, SYS1-07-b / Successor: SYS1-07-e, SYS1-07-j
- **Entry:** The plan document (fixed version) can be referenced
- **Exit (DoD):** ① Every chapter of the plan document and the experience-scenario document has been reviewed ② the findings are classified by type (vague wording / unset value / undefined condition / contradiction) ③ the matters that can be written as requirement statements are distinguished from the issues
- **Concrete examples:** ① Mark the vague wording such as "suggest at an appropriate time" and "display it clearly", check whether it can be defined by a value or a condition (90 minutes of continuous driving, within 2 lines and 15 characters), and make what is not defined a candidate issue. ② Cross-check whether the premises diverge between the trigger condition in the experience-scenario document (time-based) and the adopted proposal in the domain-integration policy (standard integration). ③ Flag terms absent from the glossary and terms whose definition wobbles (mixing "suggestion" and "notification").

#### SYS1-07-d — Extract the operational issues

- **Purpose:** Extract as issues the matters left undecided from a business-requirements and operational viewpoint.
- **Work content:** Check the "undecided" items in the systemization vs. operations sorting table and the operations department's business & operational requirements memo, and make candidate issues of the matters where the systemization scope, operating structure, and division of responsibility are undecided.
- **Input deliverables:** Systemization vs. operations sorting table, the operations department's business & operational requirements memo, business & operational requirements memo, per-department hearing records
- **Input source:** Own department (deliverables from the preceding step) / operations department
- **Output deliverables:** Operational candidate-issue list (business × undecided matter × candidate issue × relevant departments)
- **Granularity / completeness:** Rough version — created by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-01-i, SYS1-07-b / Successor: SYS1-07-e
- **Entry:** The systemization vs. operations sorting table can be referenced
- **Exit (DoD):** ① Every undecided item in the sorting table has been checked ② the undecided matters regarding the operating structure and division of responsibility have been turned into candidate issues
- **Concrete examples:** ① If the update frequency and the responsibility for updating the rest-facility information (map vendor / in-house cloud / operations department) are undecided, make it a candidate issue. ② Confirm whether the point of contact and the response policy are decided for complaints caused by a suggestion (they stopped as suggested and the facility was closed). ③ Confirm whether the system features the operations department's work requires (monitoring the facility information, periodic KPI aggregation) — an administration screen, report output — are recognized as requirements.

#### SYS1-07-e — Standardize the issue descriptions

- **Purpose:** Standardize the issues into a form that everyone reads with the same meaning.
- **Work content:** Break the candidate issues down to "one issue = one question", and describe the question, background, options, information needed for the decision, and scope of impact in a fixed format.
- **Input deliverables:** Consolidated issue list, per-department hearing records, document-review findings list, operational candidate-issue list
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Issue description sheets (issue ID × question × background × options × decision inputs × scope of impact)
- **Granularity / completeness:** Rough version — created by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-07-a – d / Successor: SYS1-07-f, SYS1-07-g
- **Entry:** The candidate issues are all in
- **Exit (DoD):** ① Every issue is written in the form of a question ② issues containing multiple questions have been broken down ③ at least 2 options are documented (if there is only one option, it is not an issue but a confirmation item)
- **Concrete examples:** ① Break the candidate "handling of traffic jams" into two questions: "should continuous driving time be counted during a traffic jam (vehicle speed at or below 20 km/h for 10 minutes)?" and "should a suggestion be issued during a traffic jam?". ② Describe for each question the options (count it / do not count it / count it at half weight) and the information needed for the decision (knowledge about fatigue in traffic jams, the traffic-jam data from the PoC). ③ Describe the scope of impact (trigger-condition definition, required data, KPI measurement) so it can be used in the downstream impact analysis.
- **AI hypothesis-driven applicability:** ◯

#### SYS1-07-f — Classify the issues

- **Purpose:** Classify the issues so that the study forum and the responsible department are easy to assign.
- **Work content:** Tag the issues along classification axes (planning / experience & HMI / technology & integration / business / legal, safety & security / operations), stating explicitly the issues that span multiple classifications.
- **Input deliverables:** Issue description sheets
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Classified issue description sheets (issue ID × primary classification × secondary classification)
- **Granularity / completeness:** Rough version — created by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-07-e / Successor: SYS1-07-g, SYS1-07-k
- **Entry:** The issue description sheets have been created
- **Exit (DoD):** ① Every issue has a primary classification assigned ② issues spanning multiple classifications have a secondary classification assigned ③ the count per classification can be grasped
- **Concrete examples:** ① Tag "should the judgment logic sit in the IVI or in the ADAS?" with primary classification = technology & integration and secondary classification = experience & HMI (it affects how a mistaken suggestion is presented). ② Tag "should the fatigue level be shown to passengers?" with primary = experience & HMI and secondary = legal (privacy). ③ Tally the counts by classification, using this as material for deciding to increase the number of study meetings with the IVI development department if there are many technology & integration issues.

#### SYS1-07-g — Map the dependencies between issues

- **Purpose:** Reveal the order of the issues that must be decided first before others can be.
- **Work content:** Organize the dependencies between issues (prerequisite issues, issues that must be decided together), and make the constraints on the study order visible.
- **Input deliverables:** Classified issue description sheets, experience-scenario document, domain-integration policy
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Issue dependency diagram (issue ID × prerequisite issues × issues decided together)
- **Granularity / completeness:** Rough version — created by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-07-e, SYS1-07-f / Successor: SYS1-07-h
- **Entry:** The classified issue description sheets have been created
- **Exit (DoD):** ① The issues with dependencies are identified ② the constraints on the study order are diagrammed ③ the absence of circular dependencies has been confirmed
- **Concrete examples:** ① Draw a line for the prerequisite relationship that "the acquisition path for the fatigue-estimate data" cannot be decided until "whether the trigger condition is time-based or state-based" is decided. ② Group "whether to limit operation while driving to two choices" and "whether to include voice response in the initial scope" as issues that must be decided together. ③ Mark the issues that are the origin of the dependencies (those that are prerequisites for many other issues) as "must-decide-first issues".

#### SYS1-07-h — Prioritize the issues and set the decision deadlines

- **Purpose:** Assign priorities and decision deadlines to the issues by working back from the specification freeze.
- **Work content:** Assess each issue's impact (the range of work that stalls if it is not decided) and urgency (the slack until the specification freeze and the SOP), and set the priority and the decision deadline.
- **Input deliverables:** Classified issue description sheets, issue dependency diagram, target-premises table (SOP, specification-freeze date), study WBS
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Prioritized issue list (issue ID × impact × urgency × priority × decision deadline)
- **Granularity / completeness:** Draft version — before confirmation by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-07-g, SYS1-01-j, SYS1-01-n / Successor: SYS1-07-i, SYS1-07-k
- **Entry:** The specification-freeze date and the target completion date of requirements definition are known
- **Exit (DoD):** ① Every issue has an impact and urgency assessment ② priorities are assigned ③ the decision deadlines are consistent with the specification freeze and the requirements-definition schedule
- **Concrete examples:** ① If the IVI-side specification freeze is 3 months away, make the issues that involve vehicle-side signal changes (whether a new CAN signal must be added) the top priority with a deadline within 2 weeks. ② Assess the impact by the number of "downstream tasks that stall if it is not decided" (use-case creation stalls / the screen-transition diagram stalls). ③ Raise the priority of the must-decide-first issues (the origins of the dependencies) even where the urgency is low.

#### SYS1-07-i — Plan the additional research

- **Purpose:** Identify the information missing to make a decision, and judge whether additional research is needed.
- **Work content:** Confirm per issue whether the decision inputs exist and, where they are missing, set the means of obtaining them (additional research / technical confirmation / estimation / inquiry to a specialist department) and the time required.
- **Input deliverables:** Prioritized issue list, issue description sheets (decision-inputs column)
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Additional-research plan (issue ID × missing information × means of obtaining × owner × deadline)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS1-07-h / Successor: SYS1-08-c
- **Entry:** The prioritized issue list has been created
- **Exit (DoD):** ① The issues lacking decision inputs are identified ② the means of obtaining, the owner, and the deadline are set ③ for information that cannot be obtained by the deadline, an alternative decision method is documented
- **Concrete examples:** ① If knowledge about fatigue in traffic jams is missing as a decision input for "should a suggestion be issued during a traffic jam?", plan a survey of published research (1 week) or a re-analysis of the PoC data. ② Make "the delivery timing of the fatigue-estimate API" an inquiry to the ADAS department (with the response deadline stated explicitly). ③ Where it cannot be obtained within the deadline, document the policy of "provisionally deciding without the information, as a conditional decision to be revisited later".

#### SYS1-07-j — Separate out the already-decided matters

- **Purpose:** Remove the already-decided matters from the issues, and manage them separately as candidate requirements.
- **Work content:** Exclude from the candidate issues the matters already decided in the plan document and the draft-version documents, and hand them off to the creation of the requirements list as a candidate-requirements memo.
- **Input deliverables:** Document-review findings list, issue description sheets, plan document (fixed version), the various draft-version documents
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Candidate-requirements memo (candidate requirement × source × related issue), excluded-issue list (with the reason for exclusion)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS1-07-c, SYS1-07-e / Successor: SYS1-07-l, SYS2-12
- **Entry:** The issue description sheets have been created
- **Exit (DoD):** ① The already-decided matters are excluded from the issues ② the reasons for exclusion are recorded ③ the candidate-requirements memo records the source
- **Concrete examples:** ① "Only the two choices 'yes / later' while driving" has already been agreed as the adopted proposal in the experience-scenario document, so remove it from the issues and record it in the candidate-requirements memo as "operation restriction while driving". ② Also treat "the continuous driving time resets after a stop of 15 minutes or more" as already decided and make it a candidate requirement. ③ Distinguish the matters that are decided but weakly grounded (only the utterances of a few interviewees) as "decided — rationale needs strengthening".

#### SYS1-07-k — Assign the owners and decision-makers

- **Purpose:** Make clear the decision-maker and the study owner per issue, and confirm the decision route.
- **Work content:** On the basis of the issues' classification and priority, assign the study department, the decision-maker, and the forum for the decision (between the individuals / a study meeting / the decision-making meeting), and confirm this with the decision-makers themselves.
- **Input deliverables:** Classified issue description sheets, prioritized issue list, stakeholder map
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Owner & decision-maker assignment table (issue ID × study owner × decision-maker × decision forum × deadline)
- **Granularity / completeness:** Draft version — before confirmation by the decision-makers
- **Predecessor / Successor:** Predecessor: SYS1-07-f, SYS1-07-h, SYS1-01-l / Successor: SYS1-07-l, SYS1-08-a
- **Entry:** The decision authority on the stakeholder map is clear
- **Exit (DoD):** ① Every issue has a study owner and a decision-maker assigned ② the decision-makers themselves have accepted the assignment ③ the decision forum is decided
- **Concrete examples:** ① Make the IVI development and ADAS departments the study owners for the technology & integration issues, the head of IVI development the decision-maker, and the weekly issue-study meeting the decision forum. ② For the issues bearing on business viability (whether to include facility reservation in the initial release), make the planning owner the study owner, the head of business planning the decision-maker, and the decision-making meeting the decision forum. ③ For issues whose decision-maker spans multiple departments (consistency with the HMI policy), where a single decision-maker cannot be settled on, record the premise of escalating to the decision-making meeting.

#### SYS1-07-l — Read the issue list through with the planning owner

- **Purpose:** Confirm with the planning owner that nothing is missing from the issue list.
- **Work content:** Produce the issue list (draft version) integrating the issue description sheets, priorities, and owner assignments, and read it through with the planning owner to confirm that nothing is missing and that the priorities are valid.
- **Input deliverables:** Issue description sheets, prioritized issue list, owner & decision-maker assignment table, candidate-requirements memo
- **Input source:** Planning owner (authoring, confirmation)
- **Output deliverables:** Issue list (draft version), read-through minutes
- **Granularity / completeness:** Draft version — confirmed by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-07-j, SYS1-07-k / Successor: SYS1-07-m
- **Entry:** The issue description sheets and the owner assignment table are both available
- **Exit (DoD):** ① The planning owner has confirmed every issue ② additions, deletions, and priority changes are reflected ③ there are read-through minutes
- **Concrete examples:** ① Order the issue list by priority and go through it with the planning owner one at a time, confirming "does this question match the intent?" and "is there anything else that needs deciding?". ② Where a matter the planning owner "thought was decided" (e.g. facility reservation is outside the initial scope) remains among the issues, confirm the rationale and either exclude it or re-raise it as an issue. ③ Discuss the places where the person compiling the list and the planning owner have a different sense of the priority (whether to prioritize the technical issues or the business-viability issues), and record the reasoning.

#### SYS1-07-m — Share the issue list and solicit additions

- **Purpose:** Share the issue list with the relevant departments and solicit additional issues against a deadline.
- **Work content:** Share the issue list (draft version) with the relevant departments, set an acceptance window for additional issues and corrections, and consolidate the responses.
- **Input deliverables:** Issue list (draft version), stakeholder map
- **Input source:** Relevant departments
- **Output deliverables:** Department-response consolidation table (department × additional issue × correction request × response date)
- **Granularity / completeness:** Fixed version — settled as the responses after the deadline
- **Predecessor / Successor:** Predecessor: SYS1-07-l / Successor: SYS1-07-n
- **Entry:** The issue list (draft version) has been confirmed by the planning owner
- **Exit (DoD):** ① It has been shared with all relevant departments ② a deadline is set and communicated ③ the responses are consolidated and the departments that did not respond are stated explicitly
- **Concrete examples:** ① Share the issue list (draft version), stating explicitly the response deadline (5 business days) and that "if there are no additions by the deadline, the issue list will be fixed". ② If the IVI development department adds "the scope of modification to the notification framework is not among the issues", have them add it in the format of the issue description sheet. ③ Chase the departments that do not respond within the deadline and, if there is still no response, record "no response" and proceed to the finalization procedure.

#### SYS1-07-n — Fix the issue list

- **Purpose:** Fix the issue list, freezing the IDs so they become the unit of management from then on.
- **Work content:** Reflect the department responses to fix the issue list, freeze the issue IDs, assign a version number, and distribute it to the relevant departments.
- **Input deliverables:** Issue list (draft version), department-response consolidation table
- **Input source:** Planning owner (authoring, approval)
- **Output deliverables:** Issue list (fixed version, with a version number)
- **Granularity / completeness:** Fixed version — approved by the planning owner and distributed to the relevant departments
- **Predecessor / Successor:** Predecessor: SYS1-07-m / Successor: SYS1-08-a, SYS1-08-b
- **Entry:** The deadline for the department responses has passed
- **Exit (DoD):** ① The department responses are reflected ② the issue IDs are frozen and a version number is assigned ③ it has been distributed to the relevant departments
- **Concrete examples:** ① Reflect the additional issues from the department responses and freeze the issue IDs (from then on the IDs are not changed; to remove one, put it in a "withdrawn" state). ② Assign a version number (v1.0) and the date fixed, obtain the planning owner's approval, and distribute it to the relevant departments. ③ Summarize on one page the issue count, the breakdown by classification, and the top 5 highest-priority issues, and use it in the explanation when distributing.

---

### SYS1-08 (L2) — Discussing the issues and studying the response policies

- **ASPICE BP:** SYS.1 BP2, BP3
- **Purpose:** Discuss the issues in priority order, and agree a rationale-backed response policy (decided / conditionally decided / on hold) with the decision-makers.
- **Work content:** Carry out work items a–m, and obtain the response-policy list (fixed version) and the revised planning-related documents.
- **Input deliverables:** Issue list (fixed version), additional-research plan, owner & decision-maker assignment table, the various draft-version documents
- **Input source:** Own department (deliverables from the preceding step) / relevant departments (study owners, decision-makers)
- **Output deliverables:** Response-policy list (fixed version: issue ID × decision content × rationale × conditions × decision-maker × decision date), issue-study meeting minutes, revised documents (revised versions of the plan document, experience-scenario document, and integration policy), remaining-issue list
- **Granularity / completeness:** Fixed version — approved by the decision-makers
- **Predecessor / Successor:** Predecessor: SYS1-07 / Successor: SYS1-09
- **Entry:** The issue list (fixed version) has been distributed
- **Exit (DoD):** Every issue is classified as decided / conditionally decided / on hold, and the decision-makers' approval is recorded
- **Concrete examples:** (see the work items beneath) running the study meetings with option-comparison tables, confirming a shared interpretation of the decisions, managing the conditions of conditional decisions, and escalating to the decision-making meeting.

#### SYS1-08-a — Design the study forums and decision rules

- **Purpose:** Design the meeting bodies and decision rules for settling the issues.
- **Work content:** Design the issue-study meetings' participants, frequency, number of issues handled per session, advance-distribution rule, and decision rules (the decision-maker's approval, the handling of absences), and agree them with the relevant departments.
- **Input deliverables:** Issue list (fixed version), owner & decision-maker assignment table, study WBS
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Issue-study meeting operating rules (meeting body × participants × frequency × how it is run × decision rules)
- **Granularity / completeness:** Fixed version — agreed with the relevant departments
- **Predecessor / Successor:** Predecessor: SYS1-07-n, SYS1-07-k / Successor: SYS1-08-b, SYS1-08-d
- **Entry:** The issue list (fixed version) and the owner assignments are settled
- **Exit (DoD):** ① The meeting bodies and participants are defined ② the decision rules are stated explicitly ③ the meeting schedule fits within the start date of requirements definition
- **Concrete examples:** ① Split the technology & integration issues into a weekly 60-minute technical study meeting (IVI development, ADAS, vehicle control, cloud) and the planning & business issues into a biweekly planning study meeting (business planning, operations, legal). ② Make it a rule that no more than 5 issues are handled per study meeting and that the study material is distributed 2 business days in advance. ③ Decide in advance whether decision by proxy is permitted when the decision-maker is absent, or whether it is carried over to the next session.

#### SYS1-08-b — Prepare the study material per issue

- **Purpose:** Prepare study material comparing the options per issue, so the discussion settles quickly.
- **Work content:** Create for each issue a comparison table of options × merits × demerits × impact (experience, technology, cost, schedule) × recommended proposal, and document the reason for the recommendation with rationale.
- **Input deliverables:** Issue list (fixed version), issue description sheets, the various draft-version documents, survey tabulation results, integration cost estimate table
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Per-issue study material (option comparison table + recommended proposal)
- **Granularity / completeness:** Draft version — the version submitted to the study meeting
- **Predecessor / Successor:** Predecessor: SYS1-07-n, SYS1-08-a / Successor: SYS1-08-c, SYS1-08-d
- **Entry:** The study order of the issues and the study-meeting schedule are decided
- **Exit (DoD):** ① Every issue submitted has a comparison table ② the recommended proposal and its rationale are documented ③ the impact is documented across the 4 viewpoints of experience, technology, cost, and schedule
- **Concrete examples:** ① For "should a suggestion be issued during a traffic jam?", set out the three proposals issue it / do not issue it / issue it at a longer interval, and document the impact on the experience (annoyance), technology (the data needed to detect a traffic jam), cost, and schedule. ② Cite the interview utterances and the entries in the edge-case list as the rationale for the recommended proposal (do not issue it initially). ③ State explicitly the impact of postponing the decision (the trigger-condition definition is not settled and use-case creation is delayed), to discourage postponement.

#### SYS1-08-c — Carry out the additional research and technical confirmation

- **Purpose:** Fill in the information missing to decide, through additional research and technical confirmation.
- **Work content:** On the basis of the additional-research plan, carry out the survey of published information, re-analysis of the PoC data, technical confirmation with the IVI development department, and simple estimation, and reflect the results in the study material.
- **Input deliverables:** Additional-research plan, existing-verification-results reports and raw data, IVI technical constraints list, partner-department hearing minutes
- **Input source:** Own department (deliverables from the preceding step) / IVI development department / ADAS department / external (published information)
- **Output deliverables:** Additional-research results (issue ID × research content × result × reflection into the study material)
- **Granularity / completeness:** Fixed version — settled as the research result
- **Predecessor / Successor:** Predecessor: SYS1-07-i, SYS1-08-b / Successor: SYS1-08-d
- **Entry:** The owners and deadlines in the additional-research plan are set
- **Exit (DoD):** ① Every planned piece of research is recorded as either carried out or expired ② the results are reflected in the study material ③ for information that could not be obtained, an alternative decision method is documented
- **Concrete examples:** ① Re-analyze the PoC raw data to derive what percentage of the total driving time falls in congested sections (vehicle speed at or below 20 km/h), as a decision input for "whether to count during a traffic jam". ② Confirm with the IVI development department the scale of modification to the notification framework (the effort to add a banner type), and reflect it in the notification-means issue. ③ If the ADAS department does not respond on the delivery timing of the fatigue-estimate API, state explicitly in the study material that "after the response deadline, it is provisionally decided that there is no integration in the initial release".
- **AI hypothesis-driven applicability:** ★
- **Rationale:** Rather than presenting options, present a prototype and drive the decision on the basis of the experience.

#### SYS1-08-d — Run the issue-study meetings

- **Purpose:** Discuss the issues at the study meetings, and record the decisions, conditions, reasons for holding, and action items.
- **Work content:** Run the issue-study meetings, decide the response policy for each issue with the decision-maker, and leave the decision content, rationale, conditions, reasons for holding, and action items in the minutes.
- **Input deliverables:** Per-issue study material, additional-research results, issue-study meeting operating rules
- **Input source:** Own department (facilitation, recording) / relevant departments (study owners, decision-makers)
- **Output deliverables:** Issue-study meeting minutes (issue ID × decided / conditionally decided / on hold × rationale × conditions × action items × owner × deadline)
- **Granularity / completeness:** Fixed version — confirmed by the attendees
- **Predecessor / Successor:** Predecessor: SYS1-08-a, SYS1-08-b, SYS1-08-c / Successor: SYS1-08-e, SYS1-08-f, SYS1-08-g, SYS1-08-h
- **Entry:** The study material has been distributed in advance
- **Exit (DoD):** ① Every issue submitted has a conclusion (decided / conditionally decided / on hold) ② the rationale for the decision is recorded ③ the action items have an owner and a deadline ④ the minutes have been confirmed by the attendees by the next business day
- **Concrete examples:** ① At the study meeting, start the discussion of each issue from the recommended proposal; if there is no objection, decide on the recommended proposal, and if there is, record the reason for the objection and the alternative. ② Where it is decided that "the judgment logic sits on the IVI side", record the rationale (it can be changed via OTA, isolation is easy) and the decision-maker's name in the minutes. ③ For the issues put on hold, record "why it cannot be decided" (missing information / the decision-maker is absent / a conflict between departments) as the reason for holding, and decide the next action.

#### SYS1-08-e — Confirm a shared interpretation of the decisions

- **Purpose:** Confirm with concrete examples that the interpretation of the decision content is aligned across departments.
- **Work content:** Create confirmation statements applying the decisions to concrete situations (in this case it behaves like this), confirm them with the relevant departments, and eliminate any divergence in interpretation.
- **Input deliverables:** Issue-study meeting minutes, experience-scenario document
- **Input source:** Own department (deliverables from the preceding step) / relevant departments
- **Output deliverables:** Decision-interpretation confirmation table (decision × concrete example × each department's confirmation result × whether there is divergence)
- **Granularity / completeness:** Fixed version — confirmed by the relevant departments
- **Predecessor / Successor:** Predecessor: SYS1-08-d / Successor: SYS1-08-f, SYS1-08-k
- **Entry:** The issue-study meeting minutes have been confirmed by the attendees
- **Exit (DoD):** ① The main decisions have concrete examples attached ② the relevant departments have confirmed them ③ divergences in interpretation are resolved or re-raised as issues
- **Concrete examples:** ① For the decision "continuous driving time is not counted during a traffic jam", create the concrete example "on a 2-hour drive including 30 minutes of congestion, the continuous driving time is 90 minutes and no suggestion appears", and confirm that the IVI development department and the planning owner interpret it the same way. ② For the decision "while an instrument-cluster warning is active, the IVI shows supplementary information only", if the interpretation of the scope of "supplementary information" diverges (the facility name and distance only / also showing the response buttons), re-raise it as an issue. ③ Append the results of the interpretation confirmation to the minutes.

#### SYS1-08-f — Organize the impact of the decisions

- **Purpose:** Organize the changes the decisions cause in the planning-related documents, and grasp the impact on the requirements.
- **Work content:** Organize for each decision the documents affected, the passages, and the content of the change, and record the impact on the requirements list and the use cases.
- **Input deliverables:** Issue-study meeting minutes, decision-interpretation confirmation table, the various draft-version documents
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Decision-impact summary table (decision × affected document × passage changed × content of the change × impact on the requirements)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS1-08-d, SYS1-08-e / Successor: SYS1-08-j
- **Entry:** The decisions have been confirmed
- **Exit (DoD):** ① The affected documents are identified for every decision ② the content of the change is documented concretely ③ the impact on the requirements is documented
- **Concrete examples:** ① Organize that the decision "no fatigue-estimate integration initially" makes the adopted proposal in the domain-integration policy, the required-data list, and the false-detection mitigations in the experience-scenario document subject to change. ② Record that the decision "passenger-facing display is outside the initial scope" removes the passenger-facing layout proposal from the screen-layout rough proposals, and that the requirements list will record it as "future support". ③ Make the issues rendered unnecessary by a decision (privacy considerations for the passenger-facing display) candidates for withdrawal.

#### SYS1-08-g — Escalate to the decision-making meeting

- **ASPICE BP:** SYS.1 BP3
- **Purpose:** Raise to the decision-making meeting the issues that cannot be settled at the study meetings, and get them concluded.
- **Work content:** Refer to the decision-making meeting those held issues that are held because the decision-maker is absent or because departments are in conflict, and produce referral material (options, each department's position, the recommendation, the impact of not deciding).
- **Input deliverables:** Issue-study meeting minutes, per-issue study material
- **Input source:** Planning owner (referral, material preparation) / decision-making meeting
- **Output deliverables:** Escalation referral material, decision-making meeting minutes (decisions, conditions)
- **Granularity / completeness:** Fixed version — decided at the decision-making meeting
- **Predecessor / Successor:** Predecessor: SYS1-08-d / Successor: SYS1-08-h, SYS1-08-k
- **Entry:** The escalation targets among the held issues have been identified
- **Exit (DoD):** ① Every issue targeted for escalation has referral material ② it has been decided at the decision-making meeting or re-held with a deadline ③ the decision is reflected in the response-policy list
- **Concrete examples:** ① Refer the issue on which the IVI development and ADAS departments are in conflict — "should the fatigue-estimate judgment result be passed to the IVI, or the raw data before judgment?" — and organize each department's position and the recommended proposal onto one page. ② State explicitly "the impact of not deciding" (the addition of a vehicle-side signal becomes impossible before the specification freeze) to press for a decision within the deadline. ③ If the decision-making meeting decides "initially the judgment result only; the raw data is re-examined at the time of the OTA extension", record the decision-maker and the conditions.

#### SYS1-08-h — Manage the conditions of the conditional decisions

- **ASPICE BP:** SYS.1 BP5
- **Purpose:** Manage the conditions of the conditional decisions, and prepare alternatives for when a condition breaks down.
- **Work content:** Organize for each conditional decision the condition, how it is confirmed, the confirmation deadline, and the alternative if it is not met, and assign a confirmation owner.
- **Input deliverables:** Issue-study meeting minutes, decision-making meeting minutes
- **Input source:** Own department (deliverables from the preceding step) / the departments confirming the conditions
- **Output deliverables:** Condition management table (decision × condition × confirmation method × deadline × owner × alternative if not met × state)
- **Granularity / completeness:** Draft version — continuously updated
- **Predecessor / Successor:** Predecessor: SYS1-08-d, SYS1-08-g / Successor: SYS1-08-k, SYS1-09-b
- **Entry:** The conditional decisions have been identified
- **Exit (DoD):** ① Every conditional decision has a condition and a confirmation method ② there is a confirmation owner and a deadline ③ the alternative if it is not met is documented
- **Concrete examples:** ① For the conditional decision "the fatigue-estimate integration is included in the initial release if the ADAS department fixes the delivery timing by 2 months before the specification freeze", record the confirmation method (a written response from the ADAS department) and the deadline. ② Document the alternative if it is not met (release with the time-based logic only, and put the fatigue estimate in the OTA extension). ③ Update the state of the condition (unconfirmed / being confirmed / met / not met) weekly, and once non-fulfilment is confirmed, reflect the alternative into the response-policy list as the decision.

#### SYS1-08-i — Receive the specialist departments' answers

- **ASPICE BP:** SYS.1 BP1, BP3
- **Purpose:** Receive the specialist departments' answers on the safety, legal, and security issues, and reflect them in the response policies.
- **Work content:** Receive the answers to the study requests made to the specialist departments (functional safety, security, legal, quality assurance), separate what is handled in requirements definition from what is handled by the specialist departments, and reflect this in the response policies.
- **Input deliverables:** Security & functional-safety issue list, privacy & consent policy, distraction-constraint check sheet
- **Input source:** Functional safety department / security department / legal department / quality assurance department
- **Output deliverables:** Specialist-department answer list (issue ID × answer × treatment in requirements definition × treatment by the specialist department)
- **Granularity / completeness:** Fixed version — settled as the specialist departments' answers (non-answers stated explicitly)
- **Predecessor / Successor:** Predecessor: SYS1-05-n, SYS1-05-j, SYS1-04-q / Successor: SYS1-08-k, SYS1-09-c
- **Entry:** The study requests to the specialist departments have been issued
- **Exit (DoD):** ① Every issue requested has either an answer or a record of no answer ② the scope handled in requirements definition is clear ③ the answers are reflected in the response-policy list
- **Concrete examples:** ① If the functional safety department answers "the rest suggestion is treated as a comfort feature, not a safety function, and is outside the scope of ISO 26262", then in requirements definition treat it as "state as a premise that a failure to suggest does not affect safety". ② If the security department answers "acquiring vehicle signals requires no additional review if the existing authorized path is used", reflect this in the requirement on the acquisition path. ③ If legal answers that the wording of the consent screen must be confirmed, raise the wording confirmation as an issue, as a milestone during requirements definition.

#### SYS1-08-j — Reflect the decisions into the documents

- **ASPICE BP:** SYS.1 BP3
- **Purpose:** Reflect the decisions into the planning-related documents, bringing the documents that become the input to requirements definition up to date.
- **Work content:** On the basis of the decision-impact summary table, revise the plan document, experience-scenario document, trigger-condition definition, and domain-integration policy, and record the change history and its linkage to the decisions.
- **Input deliverables:** Decision-impact summary table, the various draft-version documents, issue-study meeting minutes
- **Input source:** Planning owner (revision, confirmation)
- **Output deliverables:** Revised documents (revised versions of the plan document, experience-scenario document, trigger-condition definition, and domain-integration policy, with change history)
- **Granularity / completeness:** Draft version — confirmed by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-08-f / Successor: SYS1-08-m, SYS2-10
- **Entry:** The decision-impact summary table has been created
- **Exit (DoD):** ① Every affected document has been revised ② the change history links to the issue ID of the decision ③ the revised version has been confirmed by the planning owner
- **Concrete examples:** ① Update the adopted proposal in the trigger-condition definition to "90 minutes of continuous driving / counting stops during a traffic jam / suppressed when within 10 minutes of the destination", and record the issue ID and the decision date in the change history. ② Change the fatigue estimate in the required-data list of the domain-integration policy from "required initially" to "OTA extension", and record the content of the conditional decision in the reason column. ③ Produce a summary of the revised version (a list of the changes), so the planning owner can review the changes alone.

#### SYS1-08-k — Record the response policies with the decision-makers' approval

- **ASPICE BP:** SYS.1 BP3
- **Purpose:** Record the response policies together with the decision-makers' approval, making them an agreement that will not be overturned later.
- **Work content:** List the response policies for all issues, and record them with the approval (signature, approval email, confirmation of the minutes) linked per decision-maker.
- **Input deliverables:** Issue-study meeting minutes, decision-interpretation confirmation table, decision-making meeting minutes, condition management table, specialist-department answer list
- **Input source:** Own department (authoring) / decision-makers (approval)
- **Output deliverables:** Response-policy list (issue ID × decision content × rationale × conditions × decision-maker × approval evidence × decision date)
- **Granularity / completeness:** Draft version — the decision-makers' approvals are still being collected
- **Predecessor / Successor:** Predecessor: SYS1-08-d, SYS1-08-e, SYS1-08-g, SYS1-08-h, SYS1-08-i / Successor: SYS1-08-l, SYS1-08-m
- **Entry:** Every issue has a conclusion
- **Exit (DoD):** ① The response policies for all issues are listed ② each decision has approval evidence from the decision-maker ③ the rationale and the conditions are recorded
- **Concrete examples:** ① Split the response-policy list by decision-maker and send it out, saving the approval reply (or the recorded confirmation of the minutes) as evidence. ② For an issue where the decision-maker says during the approval process "that was not what I meant", return it to the interpretation confirmation table for re-confirmation and, if necessary, send it back to the study meeting. ③ Distinguish approved decisions by marking them "fixed" and those awaiting approval "provisional".

#### SYS1-08-l — Sort the remaining issues

- **ASPICE BP:** SYS.1 BP3
- **Purpose:** Sort the issues that could not be settled into those carried over into requirements definition and those set aside.
- **Work content:** Sort the held issues into "to be decided during requirements definition (with a deadline)", "not handled in the initial release (set aside)", and "proceed on a premise (provisional decision)", and state the treatment explicitly.
- **Input deliverables:** Response-policy list (provisional), condition management table
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Remaining-issue list (issue ID × sorting × deadline or premise × reason)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS1-08-k / Successor: SYS1-08-m, SYS1-09-b
- **Entry:** The held issues are stated explicitly in the response-policy list
- **Exit (DoD):** ① Every held issue is sorted into one of the 3 categories ② the carried-over issues have a decision deadline ③ the premises of the provisional decisions are stated explicitly
- **Concrete examples:** ① Sort "whether facility-reservation integration is needed" as not handled in the initial release, and record the reason (the contract with the facility side has not been started). ② Sort "the vocabulary supported by voice response" as to be decided during requirements definition, and set the deadline (before the requirements list is created). ③ Make "the final wording of the suggestion text" a provisional decision, proceeding on the premise "within 2 lines and 15 characters, avoiding assertive phrasing", with the wording itself to be settled later with the design department.

#### SYS1-08-m — Review and fix the response-policy list

- **ASPICE BP:** SYS.1 BP3, BP4
- **Purpose:** Review and fix the response-policy list and the remaining-issue list, making them the input to creating the system issue list.
- **Work content:** Review the response-policy list, remaining-issue list, and revised documents with the planning owner, assign a version number as the fixed version, and distribute them to the relevant departments.
- **Input deliverables:** Response-policy list (provisional), remaining-issue list, revised documents
- **Input source:** Planning owner (authoring, approval) / relevant departments (confirmation)
- **Output deliverables:** Response-policy list (fixed version), remaining-issue list (fixed version), review minutes
- **Granularity / completeness:** Fixed version — approved by the planning owner and distributed to the relevant departments
- **Predecessor / Successor:** Predecessor: SYS1-08-j, SYS1-08-k, SYS1-08-l / Successor: SYS1-09-a, SYS1-09-b
- **Entry:** The decision-makers' approvals are in for every issue
- **Exit (DoD):** ① The response-policy list is a fixed version ② the remaining-issue list is settled ③ consistency between the revised documents and the response policies has been confirmed
- **Concrete examples:** ① Cross-check the response-policy list against the issue list (fixed version), confirming that every issue ID has a conclusion. ② Confirm one by one whether the change history of the revised documents matches the decision content in the response-policy list. ③ Summarize on one page the breakdown of the number decided, the number conditionally decided, and the number carried over, and use it in the explanation when distributing to the relevant departments.

---

### SYS1-09 (L2) — Creating the system issue list

- **ASPICE BP:** SYS.1 BP3–BP6
- **Purpose:** Structure the issues' response policies, remaining issues, constraints, and premises into a "system issue list", and agree and manage it as the official input (baseline) to requirements definition.
- **Work content:** Carry out work items a–m, create the system issue list (fixed version, baselined), and hand it over to the requirements-definition phase.
- **Input deliverables:** Response-policy list (fixed version), remaining-issue list (fixed version), condition management table, specialist-department answer list, revised documents, data-availability answer table, systemization vs. operations sorting table
- **Input source:** Own department (deliverables from the preceding step) / relevant departments
- **Output deliverables:** System issue list (fixed version, baselined: issue ID × classification × content × background × response policy × owner × deadline × state × related requirement ID), change-management rules, operating rules, handover material
- **Granularity / completeness:** Fixed version — agreed with the relevant departments and baselined
- **Predecessor / Successor:** Predecessor: SYS1-08 / Successor: SYS2-10 (start of PH3)
- **Entry:** The response-policy list (fixed version) and the remaining-issue list have been distributed
- **Exit (DoD):** The system issue list has been baselined and handed over to the requirements-definition phase together with the change-management and operating rules
- **Concrete examples:** (see the work items beneath) turning the decided matters into constraints and premises, transferring the held items into undecided issues, linking them to the candidate requirements, baselining with change-management rules, and designing the weekly-update operation.

#### SYS1-09-a — Define the system issue and its recording format

- **ASPICE BP:** SYS.1 BP4
- **Purpose:** Decide the definition of a system issue and its recording format, unifying the unit of management from then on.
- **Work content:** Design the definition of a "system issue" (undecided matters, constraints, premises, and risks that affect requirements definition and design) and the format of the list (items, state transitions, ID rules), and agree it with the planning owner and the IVI development department.
- **Input deliverables:** Response-policy list (fixed version), remaining-issue list, the IVI development department's existing issue-management format
- **Input source:** Own department (deliverables from the preceding step) / IVI development department
- **Output deliverables:** System issue list format (item definitions, state definitions, ID rules, filling-in guide)
- **Granularity / completeness:** Fixed version — agreed with the relevant departments
- **Predecessor / Successor:** Predecessor: SYS1-08-m / Successor: SYS1-09-b – e
- **Entry:** The response-policy list (fixed version) has been distributed
- **Exit (DoD):** ① The definition of an issue is documented ② the items, states, and ID rules are defined ③ the correspondence with the IVI development department's existing format has been confirmed
- **Concrete examples:** ① Define the issue classification in the 4 categories "undecided issue (awaiting a decision)", "constraint (a decided condition that cannot be changed)", "premise (a condition provisionally set to proceed)", and "risk". ② Set the items as issue ID, classification, content, background, response policy, owner, deadline, state (new / in progress / awaiting a condition / closed / withdrawn), related issue ID, and related requirement ID, and define the state transitions. ③ Build a correspondence table to the field names of the issue-management tool the IVI development department uses, so it can be migrated later.

#### SYS1-09-b — Transfer the issues from the response policies

- **ASPICE BP:** SYS.1 BP4
- **Purpose:** Transfer the issues from the response policies and remaining issues, leaving the decided matters as constraints and premises.
- **Work content:** Transfer the decisions in the response-policy list into constraints and premises, the conditional decisions into awaiting-a-condition issues, and the remaining issues into undecided issues, recording the correspondence with the issue IDs.
- **Input deliverables:** Response-policy list (fixed version), remaining-issue list, condition management table
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** System issue list (rough version: the transferred portion)
- **Granularity / completeness:** Rough version — transferred by the planning owner, not yet organized
- **Predecessor / Successor:** Predecessor: SYS1-08-m, SYS1-08-h, SYS1-08-l, SYS1-09-a / Successor: SYS1-09-e
- **Entry:** The format is settled
- **Exit (DoD):** ① Every issue ID is mapped to an issue or to a constraint or premise ② the conditional decisions have become awaiting-a-condition issues ③ the issue ID transferred from is recorded
- **Concrete examples:** ① Transfer the decision "the judgment logic sits on the IVI side" as a constraint, recording the reason for the decision and the decision-maker in the background. ② Transfer "the fatigue-estimate integration awaits the ADAS department's answer" as an awaiting-a-condition issue, recording the deadline and the alternative if it is not met in the response-policy column. ③ Transfer "the vocabulary supported by voice response is decided during requirements definition" as an undecided issue, recording the deadline (before the requirements list is created) and the owner.

#### SYS1-09-c — Add the technical issues

- **ASPICE BP:** SYS.1 BP1, BP4
- **Purpose:** Add the technical issues, reflecting without omission the constraints from the integration partners' answers and from data quality.
- **Work content:** From the data-availability answer table, data-quality assessment table, IVI technical constraints list, and specialist-department answer list, add the technical issues and constraints that affect requirements definition and design.
- **Input deliverables:** Data-availability answer table, data-quality assessment table, IVI technical constraints list, specialist-department answer list, partner-department hearing minutes
- **Input source:** Own department (deliverables from the preceding step) / IVI development department
- **Output deliverables:** System issue list (rough version: the technical-issue additions)
- **Granularity / completeness:** Rough version — before confirmation by the IVI development department
- **Predecessor / Successor:** Predecessor: SYS1-05-i, SYS1-05-f, SYS1-08-i, SYS1-09-b / Successor: SYS1-09-e
- **Entry:** The integration partners' and specialist departments' answers are all in
- **Exit (DoD):** ① Data for which availability has not been answered is turned into an issue ② the data-quality constraints are recorded as constraints ③ the confirmation items left over from the specialist departments' answers are turned into issues
- **Concrete examples:** ① If the provision of vehicle speed and shift position is "conditional (after internal review)", make "completion of the internal review" an awaiting-a-condition issue, and record in the background the impact if the review is not completed (the while-driving operation judgment cannot be made). ② Record the data-quality constraint "the continuous driving time is reset when the IVI restarts" as a constraint, attaching the response policy (correction using the vehicle-side trip information is considered for OTA). ③ If the security department's answer says "acquiring signals via anything other than the existing path requires additional review", turn the judgment of whether additional review is needed into an issue.

#### SYS1-09-d — Add the operational issues

- **ASPICE BP:** SYS.1 BP1, BP4
- **Purpose:** Add the operational issues, making clear the boundary between the systemization scope and the operating structure.
- **Work content:** From the operations-handled items in the systemization vs. operations sorting table and the response policies for the operational issues, add the issues and premises concerning the operating structure, data updates, and enquiry handling.
- **Input deliverables:** Systemization vs. operations sorting table, the operations department's business & operational requirements memo, response-policy list (operations-related), per-department hearing records
- **Input source:** Own department (deliverables from the preceding step) / operations department
- **Output deliverables:** System issue list (rough version: the operational-issue additions)
- **Granularity / completeness:** Rough version — before confirmation by the operations department
- **Predecessor / Successor:** Predecessor: SYS1-07-d, SYS1-09-b / Successor: SYS1-09-e
- **Entry:** The response policies for the operational issues are settled
- **Exit (DoD):** ① The items decided to be handled operationally are recorded as premises ② the items whose operating structure is undecided are turned into issues ③ the operation-support features needed on the system side are either issues or candidate requirements
- **Concrete examples:** ① If it is decided that "errors in the facility information are checked and corrected weekly by the operations department", record it as a premise and link the feature needed on the system side (a means of reflecting facility-information corrections) as a candidate requirement. ② If the "point of contact for complaints originating from a suggestion" is undecided, turn it into an issue with a deadline set at 3 months before release. ③ Turn the need for the report output required for KPI aggregation into an issue, with the operations department as the owner.

#### SYS1-09-e — Consolidate the duplicated issues

- **ASPICE BP:** SYS.1 BP2
- **Purpose:** Consolidate the duplicated issues, aligning everything to a granularity of one issue = one matter.
- **Work content:** Cross-check the transferred and added issues to consolidate duplicates, and split issues containing multiple matters so that one issue corresponds to one judgment or response.
- **Input deliverables:** System issue list (rough version: the transferred, technical, and operational additions)
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** System issue list (rough version: consolidated)
- **Granularity / completeness:** Rough version — organized by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-09-b, SYS1-09-c, SYS1-09-d / Successor: SYS1-09-f, SYS1-09-g
- **Entry:** All the additions are in
- **Exit (DoD):** ① The duplicated issues are consolidated and the IDs consolidated from are recorded ② the issues containing multiple matters are split ③ the content of each issue can be expressed in a single sentence
- **Concrete examples:** ① Consolidate "the delivery timing of the fatigue estimate is not fixed" (from the integration policy) and "the fatigue-estimate API specification has not been presented" (from the ADAS answer) into a single awaiting-a-condition issue, recording both sources. ② Split "the wording and display timing of the consent screen" into the 2 issues "the wording (legal confirmation)" and "the display timing (at first start-up or at the feature's first activation)". ③ Rewrite the content column of the issue into the single sentence "X is undecided" or "X is a constraint", moving the details into the background column.

#### SYS1-09-f — Link the issues to the candidate requirements

- **ASPICE BP:** SYS.1 BP4
- **Purpose:** Link the issues to the candidate requirements, making tracing possible during requirements definition.
- **Work content:** For each issue, link the candidate requirements it affects (the candidate-requirements memo, the item IDs of the revised documents), so that the requirements to update when an issue is closed can be identified.
- **Input deliverables:** System issue list (rough version: consolidated), candidate-requirements memo, revised documents (with item IDs)
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** System issue list (rough version: with related requirement IDs), issue × candidate-requirement correspondence table
- **Granularity / completeness:** Rough version — created by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-09-e, SYS1-07-j / Successor: SYS1-09-h, SYS2-12
- **Entry:** The candidate-requirements memo and the item IDs of the revised documents can be referenced
- **Exit (DoD):** ① Every issue has related candidate requirements linked (where there are none, this is stated explicitly) ② the candidate requirements affected by the decision on an undecided issue are identified
- **Concrete examples:** ① Link the candidate requirements "operation restriction while driving" and "voice response" to the undecided issue "the vocabulary supported by voice response". ② Link the candidate requirements "calculating the continuous driving time" and "behaviour on restart" to the constraint "the continuous driving time is reset when the IVI restarts". ③ Build the issue × candidate-requirement correspondence table and pass it to the creation of the requirements list (SYS2-12) as a checklist for when an issue is closed.

#### SYS1-09-g — Assign priorities and deadlines to the issues

- **ASPICE BP:** SYS.1 BP3
- **Purpose:** Attach priorities and deadlines to the issues, and align them with the requirements-definition schedule.
- **Work content:** Set the priority and deadline for each issue from its impact (the requirements-definition work that stalls) and by working back from the specification freeze and the SOP, and state explicitly the issues that must be decided before each requirements-definition activity starts.
- **Input deliverables:** System issue list (rough version: consolidated), study WBS, target-premises table (SOP, specification-freeze date)
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** System issue list (rough version: with priorities and deadlines), issue-decision milestones
- **Granularity / completeness:** Draft version — before confirmation by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-09-e, SYS1-07-h / Successor: SYS1-09-h, SYS1-09-l
- **Entry:** The planned dates of each requirements-definition activity exist
- **Exit (DoD):** ① Every issue has a priority and a deadline ② the deadlines are consistent with the requirements-definition work schedule ③ the issues that must be decided before an activity starts are stated explicitly
- **Concrete examples:** ① Because "the final numeric value of the trigger condition (90 minutes)" must be decided before use-case creation (SYS2-10), set its deadline at that activity's start date. ② Because "the wording of the consent screen" only needs to precede the screen-transition diagram (SYS2-11), align its deadline with that. ③ For issues whose deadline falls beyond the specification freeze, state the treatment explicitly as "proceed on a premise during requirements definition and settle it in the design phase".

#### SYS1-09-h — Have the relevant departments review the issue list

- **ASPICE BP:** SYS.1 BP3
- **Purpose:** Have the relevant departments review the issue list, and agree the content, owners, and deadlines.
- **Work content:** Distribute the system issue list (draft version) to the relevant departments, confirm the validity of the content, owners, and deadlines at a review meeting or in writing, and obtain their agreement.
- **Input deliverables:** System issue list (rough version: with priorities, deadlines, and related requirement IDs)
- **Input source:** Relevant departments (IVI development, ADAS, vehicle control, cloud, legal, quality assurance, operations) / own department (deliverables from the preceding step)
- **Output deliverables:** System issue list (draft version: review comments reflected), review minutes
- **Granularity / completeness:** Draft version — reviewed by the relevant departments
- **Predecessor / Successor:** Predecessor: SYS1-09-f, SYS1-09-g / Successor: SYS1-09-i
- **Entry:** Every field of the issue list is filled in
- **Exit (DoD):** ① All relevant departments have reviewed it ② the owning departments have accepted their ownership ③ the comments are either reflected or recorded with a reason for holding them
- **Concrete examples:** ① Confirm with the departments assigned as owners "can you take this on as owner?" and "is the deadline reasonable?", and save the reply accepting it as evidence. ② If the IVI development department comments that "recording this as a constraint narrows the design freedom too much", re-judge whether it is a constraint or a premise and change the classification. ③ Add the issues added at the review meeting under new IDs, and record the difference in the count before and after the review.

#### SYS1-09-i — Baseline the system issue list

- **ASPICE BP:** SYS.1 BP4
- **Purpose:** Baseline the system issue list, making it the official input to requirements definition.
- **Work content:** Attach a version number and approval to the issue list with the review comments reflected, fix it as the baseline, and distribute it to the relevant departments.
- **Input deliverables:** System issue list (draft version: review comments reflected), review minutes
- **Input source:** Planning owner (authoring, distribution, approval)
- **Output deliverables:** System issue list (fixed version, baseline v1.0)
- **Granularity / completeness:** Fixed version — approved by the planning owner and baselined
- **Predecessor / Successor:** Predecessor: SYS1-09-h / Successor: SYS1-09-j, SYS1-09-k, SYS1-09-m
- **Entry:** The relevant departments' review is complete
- **Exit (DoD):** ① The version number, approver, and approval date are recorded ② the count and breakdown at the point of baselining are recorded ③ it has been distributed to the relevant departments
- **Concrete examples:** ① Assign v1.0 to the issue list and save the planning owner's approval (an approval email or the minutes) as evidence. ② Summarize on one page the breakdown at the point of baselining (N undecided issues, N constraints, N premises, N risks) and the highest-priority issues. ③ Store the baseline version fixed as a file, and when distributing it, make everyone aware that subsequent updates follow the change-management rules.

#### SYS1-09-j — Define the issue change-management rules

- **ASPICE BP:** SYS.1 BP5
- **Purpose:** Define the procedure for adding, changing, and closing issues, and manage the changes from the baseline.
- **Work content:** Define the applicant, approver, and recording method for adding, changing, closing, and withdrawing an issue, and the procedure for assessing the impact of a change (the impact on the related requirements).
- **Input deliverables:** System issue list (fixed version), issue × candidate-requirement correspondence table, the IVI development department's change-management rules
- **Input source:** Own department (deliverables from the preceding step) / IVI development department
- **Output deliverables:** Issue change-management rules (application × approval × recording × impact assessment × version control)
- **Granularity / completeness:** Fixed version — agreed with the relevant departments
- **Predecessor / Successor:** Predecessor: SYS1-09-i / Successor: SYS1-09-k, SYS2-16
- **Entry:** Baselining is complete
- **Exit (DoD):** ① The procedures for adding, changing, closing, and withdrawing are defined ② the approver is defined ③ the impact-assessment procedure for a change is defined
- **Concrete examples:** ① Let anyone apply to add an issue, with the planning owner's representative as the approver, and make linking the related candidate requirements mandatory when adding one. ② When closing an issue, record the decision content, rationale, and decision-maker, and only move it to the closed state once its reflection into the related requirements is complete. ③ For a change to a constraint (e.g. changing where the judgment logic sits), carry out an impact assessment and require the approval of the decision-making meeting or the issue-study meeting.

#### SYS1-09-k — Design the issue operating rules

- **ASPICE BP:** SYS.1 BP6
- **Purpose:** Put in place a mechanism by which the stakeholders can grasp the state of the issues and make enquiries to the decision-makers.
- **Work content:** Define the update frequency, location shared, state-report format, enquiry route to the decision-makers, and answer-deadline rule for the issue list, and start the operation.
- **Input deliverables:** System issue list (fixed version), issue change-management rules, stakeholder map
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Issue operating rules (update frequency × location shared × report format × enquiry route × answer deadline), weekly issue-summary format
- **Granularity / completeness:** Fixed version — agreed with the relevant departments and the operation started
- **Predecessor / Successor:** Predecessor: SYS1-09-i, SYS1-09-j / Successor: SYS1-09-l, SYS2-16
- **Entry:** The change-management rules are defined
- **Exit (DoD):** ① The update frequency and the location shared are decided ② there is a format for the weekly summary ③ the enquiry route to the decision-makers and the answer deadline are defined
- **Concrete examples:** ① Manage the issue list as a single file in a shared folder, updated weekly by the planning owner, recording the update date and version. ② Distribute a weekly summary (issues past their deadline, issues needing a decision this week, new additions) to the relevant departments on one page. ③ Make enquiries to the decision-makers by email quoting the issue ID, with an answer deadline of 5 business days, escalating when the deadline is exceeded.

#### SYS1-09-l — Plan the issue decisions

- **ASPICE BP:** SYS.1 BP3, BP5
- **Purpose:** Plan who decides each undecided issue and when, making them decision milestones during requirements definition.
- **Work content:** Fix the decision-maker, decision forum, and decision deadline for each undecided and awaiting-a-condition issue, and build them into the requirements-definition WBS as decision milestones.
- **Input deliverables:** System issue list (fixed version), issue-decision milestones, study WBS
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Issue-decision plan (issue ID × decision-maker × decision forum × deadline), requirements-definition WBS (version with the decision milestones added)
- **Granularity / completeness:** Fixed version — approved by the planning owner
- **Predecessor / Successor:** Predecessor: SYS1-09-g, SYS1-09-k / Successor: SYS1-09-m, SYS2-10
- **Entry:** The issues' priorities and deadlines are settled
- **Exit (DoD):** ① Every undecided issue has a decision-maker, a decision forum, and a deadline ② the milestones are added to the requirements-definition WBS ③ the treatment when a deadline is exceeded is decided
- **Concrete examples:** ① Plan that "the final numeric value of the trigger condition" is decided by the head of the planning owner's department by the start date of use-case creation, with the issue-study meeting as the decision forum. ② Plan that "whether the fatigue-estimate integration goes ahead" is decided by the ADAS department's answer at the condition-confirmation deadline, writing into the plan the rule that the alternative (no integration) is automatically adopted if there is no answer. ③ Add the decision milestones to the requirements-definition WBS, recording that when a milestone is missed, the corresponding requirements-definition work proceeds on a premise.

#### SYS1-09-m — Hand over to the requirements-definition phase

- **ASPICE BP:** SYS.1 BP6
- **Purpose:** Hand over officially to the requirements-definition phase, sharing the inputs and the status of the issues.
- **Work content:** Hold the requirements-definition kick-off, hand over the plan document, revised documents, system issue list, response-policy list, and operating rules as one set, and explain the status of the issues and the decision plan.
- **Input deliverables:** Plan document (fixed version), revised documents, system issue list (fixed version), response-policy list (fixed version), issue-decision plan, issue operating rules
- **Input source:** Own department (deliverables from the preceding step) / IVI development department (the receiving side)
- **Output deliverables:** Requirements-definition kick-off material, handover-material list, kick-off minutes
- **Granularity / completeness:** Fixed version — the kick-off has been held
- **Predecessor / Successor:** Predecessor: SYS1-09-i, SYS1-09-l / Successor: SYS2-10-a (start of PH3)
- **Entry:** The full set of handover material is at fixed version
- **Exit (DoD):** ① The kick-off has been held ② the handover-material list records the version numbers ③ the receiving side (the requirements-definition owners) understands how to use the issue list
- **Concrete examples:** ① Explain the key points of the plan (the value proposition, the adopted trigger conditions, the integration scope, the scope) in 30 minutes at the kick-off, allowing time for the requirements-definition owners to ask questions. ② Record in the handover-material list each document's version number, date fixed, and storage location, and confirm that subsequent revisions follow the change-management rules. ③ Explain how to read the issue list (undecided issues are proceeded with on a premise; constraints are reflected into the requirements) and share the schedule up to the first decision milestone.

---

### PH3 (L1) — Phase ③ Creating the system requirements specification (use cases → requirements list → the various diagrams → integration into the specification document)

- **ASPICE BP:** SYS.2 BP1–BP8
- **Purpose:** Convert the fixed plan and the system issue list into a system requirements specification (use cases, screens, requirements list, function allocation, flows, sequences) from which the development vendor and the relevant domains can make implementation judgments, and after confirming its consistency, baseline and communicate it.
- **Work content:** Carry out activities 10–16, baseline the system requirements specification (draft version), and hand it over to the subsequent phases and the vendor.
- **Input deliverables:** Plan document (fixed version), revised documents (experience-scenario document, trigger-condition definition, domain-integration policy), system issue list (fixed version), response-policy list (fixed version), candidate-requirements memo
- **Input source:** Own department (deliverables from the preceding step) / IVI development department / the relevant domain departments
- **Output deliverables:** Use-case descriptions (fixed version), screen images & screen-transition diagram, requirements list (functional / non-functional), function allocation diagram, flowchart, sequence diagram, system requirements specification (draft version, baselined)
- **Granularity / completeness:** Draft version — reviewed by the relevant departments and baselined (before approval by the decision-making meeting)
- **Predecessor / Successor:** Predecessor: PH2 (SYS1-09) / Successor: the subsequent phases (architecture design, vendor selection / SYS.3 onward)
- **Entry:** The requirements-definition kick-off has been held and the full set of handover material is at fixed version
- **Exit (DoD):** The system requirements specification (draft version) has been baselined, and distributed and explained to the relevant departments and the vendor
- **Concrete examples:** (see the activities beneath) e.g. for a rest-suggestion service, bring it down to an implementable granularity in this order: experience scenarios → use cases → screens & transitions → functional / non-functional requirements → function allocation between the IVI and the other domains → the trigger-judgment flow → the integration sequences → integration into the specification document.

---

### SYS2-10 (L2) — Creating the use cases (fixed version)

- **ASPICE BP:** SYS.2 BP1
- **Purpose:** Convert the experience scenarios into use cases described down to the actors, pre- and post-conditions, and basic / alternative / exception flows, and settle the basis for extracting the requirements.
- **Work content:** Carry out work items a–n, create the use-case descriptions (fixed version) and the use-case diagram, and agree them with the relevant departments.
- **Input deliverables:** Plan document (fixed version), experience-scenario document & trigger-condition definition (revised versions), domain-integration policy (revised version), system issue list (fixed version)
- **Input source:** Own department (deliverables from the preceding step) / IVI development department
- **Output deliverables:** Use-case list, use-case descriptions (fixed version: UC-ID × actors × pre- and post-conditions × basic / alternative / exception flows), use-case diagram
- **Granularity / completeness:** Fixed version — reviewed by the relevant departments, IDs frozen
- **Predecessor / Successor:** Predecessor: SYS1-09 / Successor: SYS2-11, SYS2-12, SYS2-14, SYS2-15
- **Entry:** The requirements-definition kick-off is complete and the system issue list can be referenced
- **Exit (DoD):** The use-case descriptions are settled, the UC-IDs are frozen, and the downstream screen and requirements work can begin
- **Concrete examples:** (see the work items beneath) deriving the use cases from the experience scenarios, bringing the trigger conditions down into the flows, describing the integration with the other domains, and stating explicitly the premises set for the undecided issues.

#### SYS2-10-a — Define the use-case granularity and format

- **ASPICE BP:** SYS.2 BP1
- **Purpose:** Unify the granularity and recording format of the use cases, making the descriptions robust enough for the downstream requirements extraction.
- **Work content:** Define the use-case granularity (1 use case = the unit in which the user gains value in one go) and the recording format (items, flow numbering, actor notation), and write one example description.
- **Input deliverables:** The IVI development department's existing use-case format, in-house standards (if any), experience-scenario document (revised version)
- **Input source:** Own department (deliverables from the preceding step) / IVI development department
- **Output deliverables:** Use-case description guide (granularity definition, format, example description)
- **Granularity / completeness:** Fixed version — agreed with the IVI development department
- **Predecessor / Successor:** Predecessor: SYS1-09-m / Successor: SYS2-10-b, SYS2-10-c
- **Entry:** The requirements-definition kick-off is complete
- **Exit (DoD):** ① The criteria for judging granularity are defined with examples ② the rules for the description items and flow numbering are defined ③ there is one example description
- **Concrete examples:** ① State explicitly the granularity criterion that "being offered a rest, accepting, and stopping at a rest facility" is one use case, whereas "measuring the continuous driving time" is internal processing and not a use case. ② Set the items as UC-ID, name, primary actor, related actors, purpose, pre-conditions, post-conditions, basic flow, alternative flow, exception flow, and related issue ID, and number the flows as 1., 1a. (alternative), 1e. (exception). ③ Write one example description, "acceptance of the rest suggestion", as the model for the reviews.

#### SYS2-10-b — Identify the actors

- **ASPICE BP:** SYS.2 BP1
- **Purpose:** Identify without omission the parties that interact with the system.
- **Work content:** Enumerate the user-side actors (driver, passenger, operations staff) and the external systems (ADAS, vehicle control, cloud, map / facility information, instrument cluster), and define their roles.
- **Input deliverables:** Domain-integration policy (revised version), experience-scenario document (revised version), systemization vs. operations sorting table
- **Input source:** Own department (deliverables from the preceding step) / IVI development department
- **Output deliverables:** Actor list (actor × type × role × candidate related use cases)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS2-10-a / Successor: SYS2-10-c, SYS2-10-k, SYS2-13-a
- **Entry:** The domain-integration policy can be referenced
- **Exit (DoD):** ① Both the people and the external systems are enumerated ② each actor's role is defined in one sentence ③ the actors outside the scope are stated explicitly
- **Concrete examples:** ① Define the driver and the passenger as human actors, and the ADAS (fatigue estimation), vehicle control (vehicle speed, shift), cloud (facility information), and instrument cluster as external-system actors. ② Include the operations staff (correcting the facility information, aggregating KPIs) among the human actors, making them the primary actor of the administrative use cases. ③ State explicitly that the rear-seat display and the smartphone app are actors outside the initial scope, noting that they are future support.

#### SYS2-10-c — Derive the use cases from the experience scenarios

- **ASPICE BP:** SYS.2 BP1
- **Purpose:** Derive the use cases from the experience scenarios and list them without gaps.
- **Work content:** Cross-check the scenario IDs in the experience-scenario document against the actor list to derive the use cases, and create a list with UC-IDs assigned.
- **Input deliverables:** Experience-scenario document (revised version), actor list, use-case description guide
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Use-case list (UC-ID × name × primary actor × corresponding scenario ID × priority)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS2-10-a, SYS2-10-b, SYS1-04-t / Successor: SYS2-10-d, SYS2-10-i, SYS2-10-j
- **Entry:** The experience-scenario document (revised version) is settled
- **Exit (DoD):** ① Every scenario ID corresponds to some use case ② UC-IDs are assigned ③ the administrative use cases that do not appear in the scenarios are also included
- **Concrete examples:** ① From the scenario "being offered a rest during a long drive on the expressway", derive the 3 use cases "acceptance of the rest suggestion", "declining the rest suggestion", and "suppression of the rest suggestion". ② Add the use cases that are needed but do not appear in the scenarios (turning the feature on/off, obtaining consent, sending logs). ③ Build a correspondence table between the scenario IDs and the UC-IDs, and confirm that no scenario is left unmapped.

#### SYS2-10-d — Describe the basic flows

- **ASPICE BP:** SYS.2 BP1
- **Purpose:** Describe the standard course of a use case at a granularity at which the system's behaviour is clear.
- **Work content:** Create the basic flow of each use case in a form that alternates between the actor's operations and the system's responses.
- **Input deliverables:** Use-case list, experience-scenario document (storyboards), use-case description guide
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Use-case descriptions (basic flows)
- **Granularity / completeness:** Rough version — created by the planning owner
- **Predecessor / Successor:** Predecessor: SYS2-10-c / Successor: SYS2-10-e, SYS2-10-f, SYS2-11-a
- **Entry:** The use-case list has been created
- **Exit (DoD):** ① Every use case has a basic flow ② each step is described as a single action ③ the system's responses are written concretely
- **Concrete examples:** ① Describe the basic flow of "acceptance of the rest suggestion" in this order: the system detects that the trigger condition holds → displays the suggestion (banner and voice) → the driver selects "yes" → the system sets the next rest facility as a waypoint → guidance starts. ② Avoid vague descriptions like "the system displays it appropriately", and write concretely "the system displays the suggestion text, the facility name, and the estimated arrival time at the bottom of the screen". ③ Leave the details of the displayed content (the character limit) to the screen design, and write in the flow only the information items included.

#### SYS2-10-e — Describe the alternative flows

- **ASPICE BP:** SYS.2 BP1
- **Purpose:** Describe the non-standard courses as alternative flows, preventing gaps in the implementation.
- **Work content:** Describe as alternative flows the courses that branch off the basic flow — ignoring, declining, re-presentation, operation after stopping, and so on.
- **Input deliverables:** Use-case descriptions (basic flows), experience-scenario document (re-presentation rules, frequency & interval rules)
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Use-case descriptions (with alternative flows added)
- **Granularity / completeness:** Rough version — created by the planning owner
- **Predecessor / Successor:** Predecessor: SYS2-10-d, SYS1-04-g / Successor: SYS2-10-g, SYS2-14-f
- **Entry:** The basic flows have been created
- **Exit (DoD):** ① The main branches are described as alternative flows ② each alternative flow states its branch condition explicitly ③ the re-presentation rules are reflected
- **Concrete examples:** ① Describe the alternative flow in which selecting "later" closes the suggestion and it is re-presented 15 minutes later. ② Describe the course in which the suggestion is automatically closed after a certain time elapses with no response, noting the time until closing as an issue. ③ Describe browsing the facility details after stopping as an alternative flow, stating explicitly as a condition that it cannot be selected while driving.

#### SYS2-10-f — Describe the exception flows

- **ASPICE BP:** SYS.2 BP1
- **Purpose:** Describe the behaviour under abnormal conditions as exception flows, making the degraded operation clear.
- **Work content:** Describe the exception flows for the cases that do not complete normally — missing data, a communication break, conflict with another notification, the feature being off, and so on.
- **Input deliverables:** Use-case descriptions (basic flows), domain-integration policy (data-quality assessment table), system issue list (constraints)
- **Input source:** Own department (deliverables from the preceding step) / IVI development department
- **Output deliverables:** Use-case descriptions (with exception flows added)
- **Granularity / completeness:** Rough version — before confirmation by the IVI development department
- **Predecessor / Successor:** Predecessor: SYS2-10-d, SYS1-05-f / Successor: SYS2-10-g, SYS2-14-g, SYS2-15-f
- **Entry:** The data-quality constraints are understood
- **Exit (DoD):** ① The main abnormal cases are described as exception flows ② the behaviour when degraded is described ③ the detection conditions for the exceptions are described
- **Concrete examples:** ① Describe the exception flow that switches to a simple time-based judgment when the vehicle signals cannot be acquired for a certain time. ② Describe the degraded operation of displaying only "we recommend taking a rest soon", without naming a facility, when the facility information cannot be obtained from the cloud. ③ Describe the exception flow of not displaying the suggestion, or delaying its display, when it conflicts with a vehicle warning or an incoming call.

#### SYS2-10-g — Define the pre- and post-conditions

- **ASPICE BP:** SYS.2 BP1
- **Purpose:** Define each use case's entry conditions and end state, making the handover of state clear.
- **Work content:** Define each use case's pre-conditions (the feature is on, consent has been given, the vehicle is driving, etc.) and post-conditions (the suggestion history is updated, the state of the timer).
- **Input deliverables:** Use-case descriptions (basic / alternative / exception flows), experience-scenario document (settings-feature policy, post-acceptance experience definition)
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Use-case descriptions (with pre- and post-conditions added)
- **Granularity / completeness:** Rough version — before review
- **Predecessor / Successor:** Predecessor: SYS2-10-e, SYS2-10-f / Successor: SYS2-10-h, SYS2-14-h
- **Entry:** The flow descriptions are broadly complete
- **Exit (DoD):** ① Every use case has pre- and post-conditions ② the changes of state (history, timer) are described in the post-conditions ③ the handover of state between use cases has been confirmed
- **Concrete examples:** ① Define the pre-conditions of "acceptance of the rest suggestion" as: the feature is on, consent to data use has been given, the vehicle is driving, and the number of suggestions on the current trip is below the limit. ② Define the post-conditions as: one entry added to the suggestion history, and the continuous-driving timer is reset after a stop of 15 minutes or more. ③ Confirm that the post-conditions do not contradict another use case's pre-conditions (that the value used to judge the suggestion-count limit is the same).
- **AI hypothesis-driven applicability:** ◯

#### SYS2-10-h — Bring the trigger and suppression conditions into the use cases

- **ASPICE BP:** SYS.2 BP1
- **Purpose:** Bring the trigger and suppression conditions down into a form that can be handled within the use cases.
- **Work content:** Allocate the conditions, suppression conditions, and frequency rules from the trigger-condition definition to the pre-conditions and to the judgment steps of the basic flows.
- **Input deliverables:** Trigger-condition definition (revised version), use-case descriptions (with pre- and post-conditions added)
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Condition-allocation table (condition × allocated UC-ID × allocated step), use-case descriptions (with the conditions reflected)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS2-10-g, SYS1-04-t / Successor: SYS2-12-c, SYS2-14-c
- **Entry:** The trigger-condition definition (revised version) is settled
- **Exit (DoD):** ① Every trigger and suppression condition is allocated ② whether the allocation target is a pre-condition or a judgment step is stated explicitly ③ the conditions that cannot be allocated are turned into issues
- **Concrete examples:** ① Allocate the holding of 90 minutes of continuous driving to the judgment step that includes the "suppression of the rest suggestion" use case, and note that the counting stop during a traffic jam is a measurement rule of that same step. ② Allocate "within 10 minutes of the destination", "has just rested", and "on a call" to the pre-conditions as suppression conditions. ③ For conditions whose allocation cannot be settled (whether the interval should be shortened at night is undecided), link them to the system issue list and describe them on a premise.
- **AI hypothesis-driven applicability:** ◯

#### SYS2-10-i — Describe the integration with the other domains

- **ASPICE BP:** SYS.2 BP1
- **Purpose:** Describe the use cases involving interaction with other domains in a way that makes the division of responsibility clear.
- **Work content:** For the use cases involving integration, state explicitly within the flow which actor provides the data and where the judgment is made.
- **Input deliverables:** Domain-integration policy (revised version: the division-of-responsibility proposal), use-case list, actor list
- **Input source:** Own department (deliverables from the preceding step) / IVI development department / ADAS department
- **Output deliverables:** Use-case descriptions (with the integration described), integration-point list (UC-ID × step × counterpart actor × data)
- **Granularity / completeness:** Draft version — before confirmation by the relevant domains
- **Predecessor / Successor:** Predecessor: SYS2-10-c, SYS1-05-o / Successor: SYS2-13-a, SYS2-15-b
- **Entry:** The decision on the division of responsibility is recorded in the response-policy list
- **Exit (DoD):** ① The steps involving integration are identified ② each step's counterpart actor and the data exchanged are described ③ the party making the judgment is stated explicitly
- **Concrete examples:** ① State explicitly in the step that "the system obtains the vehicle speed from vehicle control and the fatigue-estimate result from the ADAS", and connect to the exception flow when they cannot be obtained. ② Following the decision that the IVI performs the judgment, describe it as "the IVI compares the obtained value against the threshold and judges whether to trigger". ③ Build the integration-point list and make it the input to the sequence diagram and the function allocation diagram.

#### SYS2-10-j — Describe the settings, consent, and operational use cases

- **ASPICE BP:** SYS.2 BP1
- **Purpose:** Describe the settings, consent, and operational use cases, ensuring the completeness of the feature as a whole.
- **Work content:** Describe the use cases at the periphery of the experience — turning the feature on/off, the frequency setting, obtaining consent, sending logs, checks by the operations staff, and so on.
- **Input deliverables:** Use-case list, settings-feature policy, privacy & consent policy, measurement-data item list
- **Input source:** Own department (deliverables from the preceding step) / operations department
- **Output deliverables:** Use-case descriptions (settings, consent, operational)
- **Granularity / completeness:** Rough version — before review
- **Predecessor / Successor:** Predecessor: SYS2-10-c, SYS1-05-j, SYS1-06-l / Successor: SYS2-11-f, SYS2-12-g, SYS2-12-h
- **Entry:** The consent policy and the measurement-data items are settled
- **Exit (DoD):** ① The settings, consent, and logging use cases are described ② the use cases whose primary actor is the operations staff are included ③ the degradation on refusal is described
- **Concrete examples:** ① Describe the use case in which consent to data use is obtained at first start-up, and only the simple time-based version operates if it is refused. ② Describe the use case of changing the frequency (more / standard / fewer / off) on the settings screen. ③ Describe the use case of sending the logs of suggestion display, response, and stop detection to the cloud when the conditions hold, noting as an issue the treatment — resend or discard — when they cannot be sent.

#### SYS2-10-k — Create the use-case diagram

- **ASPICE BP:** SYS.2 BP1
- **Purpose:** Make it possible to take in the relationships among all the use cases on one page.
- **Work content:** Create a use-case diagram of the relationships between the actors and the use cases and the include / extend relationships, stating the scope boundary explicitly.
- **Input deliverables:** Use-case list, actor list, use-case descriptions
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Use-case diagram (system boundary, actors, include / extend relationships)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS2-10-b, SYS2-10-c / Successor: SYS2-10-m, SYS2-13-c
- **Entry:** The use-case list and the actor list are both available
- **Exit (DoD):** ① The system boundary is drawn ② every use case is included in the diagram ③ the elements outside the scope are drawn distinguishably
- **Concrete examples:** ① Set the system boundary at the IVI (the in-vehicle side), and place the cloud, ADAS, and instrument cluster outside the boundary as external actors. ② Draw "judging the trigger conditions", which is common to "acceptance of the rest suggestion" and "declining", as an include relationship. ③ Show what is outside the initial scope (facility reservation, rear-seat display) with dashed lines, and write in the legend that it is future support.

#### SYS2-10-l — Describe the undecided points on a premise

- **ASPICE BP:** SYS.2 BP1
- **Purpose:** Describe the places where there is an undecided issue on a premise, so they can be updated later.
- **Work content:** State the premise and the issue ID explicitly at the passages affected by the undecided issues in the system issue list, so that the places to update after a decision can be identified.
- **Input deliverables:** Use-case descriptions, system issue list (fixed version), issue × candidate-requirement correspondence table
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** List of passages with premises (UC-ID × step × premise × issue ID)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS2-10-h, SYS2-10-i, SYS1-09-f / Successor: SYS2-10-m, SYS2-16-k
- **Entry:** The system issue list can be referenced
- **Exit (DoD):** ① The descriptions affected by an undecided issue carry a premise and an issue ID ② the value of the premise is stated explicitly ③ the places to update after a decision are listed
- **Concrete examples:** ① If the time until a suggestion is automatically closed with no response is undecided, proceed with the description annotated "premise: 20 seconds (issue ID recorded)". ② If the fatigue-estimate integration is awaiting a condition, separate the steps that use the integration out of the basic flow, stating explicitly "valid when the condition holds". ③ List the passages carrying premises, and make it the update checklist for when an issue is closed.
- **AI hypothesis-driven applicability:** ◯

#### SYS2-10-m — Review the use cases

- **ASPICE BP:** SYS.2 BP1
- **Purpose:** Confirm that the use cases satisfy both the intent of the plan and implementation feasibility.
- **Work content:** Review the use cases with the planning owner and the IVI development department, and raise and reflect divergences from the intent, feasibility concerns, and ambiguities in the descriptions.
- **Input deliverables:** Use-case descriptions, use-case diagram, list of passages with premises
- **Input source:** Own department (facilitation) / IVI development department
- **Output deliverables:** Use-case review minutes, use-case descriptions with the comments reflected
- **Granularity / completeness:** Draft version — review comments reflected
- **Predecessor / Successor:** Predecessor: SYS2-10-k, SYS2-10-l / Successor: SYS2-10-n
- **Entry:** The use-case descriptions and the diagram are broadly complete
- **Exit (DoD):** ① The planning owner has confirmed the match with the intent ② the IVI development department has raised its feasibility concerns ③ the comments are either reflected or turned into issues
- **Concrete examples:** ① With the planning owner, read through the representative use cases, confirming step by step "is this behaviour what was intended?". ② Have the IVI development department point out the gaps, such as "the treatment when an operation to change the map scale comes in while the suggestion is displayed is not written". ③ Add the comments that cannot be decided immediately to the system issue list, and link the issue ID to the description.

#### SYS2-10-n — Fix the use cases

- **ASPICE BP:** SYS.2 BP1
- **Purpose:** Settle the use cases, freezing the UC-IDs as the reference for the downstream work.
- **Work content:** Make the version with the review comments reflected the fixed version, freeze the UC-IDs and the version number, and distribute it to the relevant departments.
- **Input deliverables:** Use-case descriptions with the comments reflected, use-case review minutes
- **Input source:** Own department (authoring) / planning owner and IVI development department (confirmation)
- **Output deliverables:** Use-case descriptions (fixed version, with a version number), use-case diagram (fixed version)
- **Granularity / completeness:** Fixed version — reviewed by the relevant departments, IDs frozen
- **Predecessor / Successor:** Predecessor: SYS2-10-m / Successor: SYS2-11-a, SYS2-12-b, SYS2-14-a, SYS2-15-a
- **Entry:** The review comments have been reflected
- **Exit (DoD):** ① The UC-IDs are frozen and a version number is assigned ② it has been distributed to the relevant departments ③ everyone has been made aware that subsequent changes follow the change-management rules
- **Concrete examples:** ① Freeze the UC-IDs, and adopt the practice that from then on additions are given new IDs and deletions are left in a withdrawn state. ② Distribute the fixed version, stating explicitly that the screen design, requirements list, flow, and sequence work all take this version as their reference. ③ Record the version number, the date fixed, and the change history at the head of the document.

---

### SYS2-11 (L2) — Creating the screen images and transition diagram

- **ASPICE BP:** SYS.2 BP1, BP2
- **Purpose:** Define the information volume, layout, and transitions that work while driving, and create screen images and a transition diagram at a granularity from which the development vendor can draw up the screen specification (visual design is out of scope).
- **Work content:** Carry out work items a–n, create the screen list, screen images (wireframes), and screen-transition diagram, and agree them with the relevant departments.
- **Input deliverables:** Use-case descriptions (fixed version), experience-scenario document (screen-layout rough proposals, rough screen-transition diagram, notification-means design), IVI technical constraints list, HMI guidelines
- **Input source:** Own department (deliverables from the preceding step) / IVI development department / design department
- **Output deliverables:** Screen list, screen images (wireframes: information items and priorities), screen-transition diagram, per-notification-means expression definition, while-driving restriction definition
- **Granularity / completeness:** Fixed version — reviewed by the relevant departments (visual design is created downstream)
- **Predecessor / Successor:** Predecessor: SYS2-10 / Successor: SYS2-12, SYS2-14, SYS2-16
- **Entry:** The use-case descriptions (fixed version) have been distributed
- **Exit (DoD):** The screen list, screen images, and screen-transition diagram are settled, and the display and operation restrictions while driving are defined
- **Concrete examples:** (see the work items beneath) the wireframe for the suggestion display coexisting with the map display, the expression differences per notification means, the transition restrictions while driving vs. stopped, and the screen when data is missing.

#### SYS2-11-a — Enumerate the screens and notifications

- **ASPICE BP:** SYS.2 BP1, BP2
- **Purpose:** Extract the screens and notifications needed from the use cases, and fix them as the screen list.
- **Work content:** Extract the screens and notifications displayed at each step of the use-case descriptions, and list them with screen IDs.
- **Input deliverables:** Use-case descriptions (fixed version), notification-means design, screen-layout rough proposals
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Screen list (screen ID × name × type (screen / notification) × related UC-ID × display trigger)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS2-10-n, SYS2-10-d / Successor: SYS2-11-c – g, SYS2-11-h
- **Entry:** The use-case descriptions (fixed version) can be referenced
- **Exit (DoD):** ① The display elements of every use case are extracted as either a screen or a notification ② screen IDs are assigned ③ the display trigger is recorded
- **Concrete examples:** ① Register the suggestion banner, suggestion detail, facility list, settings, consent, and error display (data cannot be obtained) in the screen list. ② Distinguish the notifications (banner, pop-up, voice, instrument-cluster display) from the screens, making them identifiable in the type column. ③ Link each screen to the use case and step at which it is displayed.

#### SYS2-11-b — Define the display-information priorities

- **ASPICE BP:** SYS.2 BP1, BP2
- **Purpose:** Set the volume of information that can be read at a glance while driving, and settle the priorities of the display items.
- **Work content:** Define the upper limit on the volume of displayed information (line count, character count, element count) for driving and for stopped respectively, and the priority order of the display items.
- **Input deliverables:** Experience-scenario document (screen-layout rough proposals), HMI guidelines, distraction-constraint check sheet
- **Input source:** Own department (deliverables from the preceding step) / IVI development department
- **Output deliverables:** Display-information priority definition (screen ID × driving / stopped × display item × priority × upper limit)
- **Granularity / completeness:** Fixed version — confirmed by the IVI development department
- **Predecessor / Successor:** Predecessor: SYS2-11-a, SYS1-04-o, SYS1-04-q / Successor: SYS2-11-c, SYS2-11-d, SYS2-12-d
- **Entry:** The relevant requirements of the HMI guidelines can be confirmed
- **Exit (DoD):** ① The upper limit on the information volume while driving is defined numerically ② the display items have priorities ③ the difference from the stopped case is defined
- **Concrete examples:** ① Define the suggestion display while driving as within 2 lines and 15 characters, with the elements limited to the text, the facility name, the estimated arrival time, and at most 2 response buttons. ② Set the priority as suggestion text > response buttons > facility name > estimated arrival time, stating explicitly the order in which items are dropped when the display area is narrow. ③ Define as the difference that while stopped, detailed facility information (amenities, crowding) may additionally be displayed.
- **AI hypothesis-driven applicability:** ◯

#### SYS2-11-c — Fix the wireframe for the suggestion display

- **ASPICE BP:** SYS.2 BP1, BP2
- **Purpose:** Settle a wireframe for the suggestion display that does not obstruct the map display.
- **Work content:** Select from multiple proposals the placement, occupied area, and overlap with the map and route guidance for the suggestion display, and create it as a wireframe.
- **Input deliverables:** Screen list, display-information priority definition, experience-scenario document (screen-layout rough proposals), IVI technical constraints list (screen specification)
- **Input source:** Own department (deliverables from the preceding step) / design department / IVI development department
- **Output deliverables:** Suggestion-display wireframe (placement, occupancy ratio, overlap definition), record of the selection rationale
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS2-11-b, SYS1-04-o / Successor: SYS2-11-e, SYS2-11-h, SYS2-11-l
- **Entry:** The display-information priorities are settled
- **Exit (DoD):** ① There is a wireframe of the adopted proposal ② the occupied area and the overlap are defined ③ the rejected proposals and the selection rationale are recorded
- **Concrete examples:** ① Adopt as the selected proposal displaying the suggestion in a band at the bottom of the screen (specified as a height ratio), placed so as not to overlap the remaining-distance display of the route guidance. ② Define that the map scale and the current-position marker must not be hidden, and whether the suggestion drops a level or is hidden when a guidance-turn display appears. ③ Record the rejected proposal (a full-screen pop-up) and the reason (the eyes-off-road time while driving is too large), to prevent it being raised again later.

#### SYS2-11-d — Define the expression per notification means

- **ASPICE BP:** SYS.2 BP1, BP2
- **Purpose:** Define the expression differences per notification means, keeping the same suggestion consistent across the means.
- **Work content:** Define the display content, text length, presentation time, and priority order for each of the banner, pop-up, voice, and instrument-cluster display.
- **Input deliverables:** Notification-means design, display-information priority definition, other-domain information-expression policy, instrument-cluster warning specification
- **Input source:** Own department (deliverables from the preceding step) / IVI development department / instrument-cluster department
- **Output deliverables:** Per-notification-means expression definition (means × content × text × presentation time × whether operable)
- **Granularity / completeness:** Draft version — before confirmation by the instrument-cluster department
- **Predecessor / Successor:** Predecessor: SYS2-11-b, SYS1-04-k, SYS1-04-n / Successor: SYS2-11-h, SYS2-12-d, SYS2-15-g
- **Entry:** The adopted range of notification means is decided
- **Exit (DoD):** ① The display content and text of each means are defined ② the presentation time is defined ③ consistency with the instrument-cluster display has been confirmed
- **Concrete examples:** ① Define the content per means: the banner carries the text plus the facility name plus the response buttons, the voice a single sentence within 5 seconds, and the instrument cluster an icon and short text only. ② Define the time until the banner auto-dismisses, and the timing of the voice playback (simultaneous with the banner display or immediately after). ③ Reflect consistency rules such as changing the IVI's suggestion text to supplementary phrasing while a fatigue warning is displayed on the instrument-cluster side.

#### SYS2-11-e — Define the detail screens

- **ASPICE BP:** SYS.2 BP1, BP2
- **Purpose:** Define the suggestion-detail and facility-information screens on the premise of use while stopped.
- **Work content:** Define the display items, ordering, and operable elements of the suggestion-detail screen and the facility list / detail screens, stating explicitly the premise that they are not displayed while driving.
- **Input deliverables:** Screen list, suggestion-display wireframe, post-acceptance experience definition, cloud-provided information (facility-information items)
- **Input source:** Own department (deliverables from the preceding step) / IVI development department
- **Output deliverables:** Detail-screen wireframes (display items × ordering × operable elements × display conditions)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS2-11-c, SYS1-04-h / Successor: SYS2-11-h, SYS2-12-d
- **Entry:** The items obtainable as facility information are understood
- **Exit (DoD):** ① The display items are defined on the basis of the obtainable information ② the ordering rules are defined ③ the treatment while driving is stated explicitly
- **Concrete examples:** ① Set the display items as the facility name, distance, estimated arrival time, amenities (toilets, refuelling / charging), and crowding, and define the rule that items that cannot be obtained are hidden. ② Make distance order the default for the facility list, noting as an issue whether it can be filtered by condition (has amenities). ③ State explicitly the premise that the detail screen cannot be opened while driving, and is opened after stopping.

#### SYS2-11-f — Define the settings and consent screens

- **ASPICE BP:** SYS.2 BP1, BP2
- **Purpose:** Define the settings and consent screens, making the behaviour on refusal clear on the screen.
- **Work content:** Define the settings screen for the feature on/off, frequency, and notification means, and the consent screen for data use (first display, re-display conditions).
- **Input deliverables:** Settings-feature policy, privacy & consent policy, use-case descriptions (settings and consent)
- **Input source:** Own department (deliverables from the preceding step) / legal department
- **Output deliverables:** Settings-screen wireframe, consent-screen wireframe (display conditions, options, behaviour on refusal)
- **Granularity / completeness:** Draft version — before legal confirmation
- **Predecessor / Successor:** Predecessor: SYS2-11-a, SYS2-10-j, SYS1-05-j / Successor: SYS2-11-h, SYS2-12-g
- **Entry:** The consent policy and the settings-feature policy are settled
- **Exit (DoD):** ① The setting items and their defaults are defined on the screen ② the display conditions of the consent screen are defined ③ the behaviour on refusal is stated explicitly
- **Concrete examples:** ① Place the on/off, frequency (more / standard / fewer), and notification-means choices on the settings screen, and state the defaults (on, standard) explicitly in the screen specification. ② Set the display condition of the consent screen at first start-up, and define the conditions for re-displaying it after refusal (only when it is explicitly enabled from the settings screen). ③ Put a draft of the wording explaining on the consent screen that only the simple time-based version operates on refusal, noting the final wording as an issue for legal confirmation.

#### SYS2-11-g — Define the passenger-facing display

- **ASPICE BP:** SYS.2 BP1, BP2
- **Purpose:** Make the treatment of the passenger-facing display and the rear-seat / smartphone integration clear on the screen.
- **Work content:** Define whether there is a passenger-facing display and its extent as part of the screen specification, and state explicitly the elements outside the initial scope.
- **Input deliverables:** Passenger-facing display policy, screen list, suggestion-display wireframe
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Passenger-display definition (whether displayed × content displayed × out-of-scope elements)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS2-11-c, SYS1-04-m / Successor: SYS2-11-h, SYS2-12-d
- **Entry:** The policy for the passenger-facing display is decided
- **Exit (DoD):** ① Whether there is a passenger-facing display is stated explicitly ② the content is defined where there is one ③ the out-of-scope elements are stated explicitly
- **Concrete examples:** ① Define that in the initial release there is only the same screen as the driver-facing one, and no dedicated display on the passenger side. ② Reflect in the screen specification the policy that the driver's fatigue level is not displayed on a screen visible to passengers, only the suggestion text. ③ Record the rear-seat display and the smartphone-integration display in the screen list as "out of scope", as outside the initial scope.

#### SYS2-11-h — Create the screen-transition diagram

- **ASPICE BP:** SYS.2 BP1, BP2
- **Purpose:** Define the transitions between the screens and notifications on one page, stating the transition conditions explicitly.
- **Work content:** Create the screen-transition diagram, describing the triggers, conditions, and return targets of the transitions.
- **Input deliverables:** Screen list, the various wireframes, per-notification-means expression definition, use-case descriptions (fixed version)
- **Input source:** Own department (deliverables from the preceding step) / IVI development department
- **Output deliverables:** Screen-transition diagram (screen / notification × transition × trigger × condition × return target)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS2-11-c, -d, -e, -f, -g, SYS2-11-a / Successor: SYS2-11-i, SYS2-11-j, SYS2-14-f
- **Entry:** The wireframes of all the screens are available
- **Exit (DoD):** ① Every screen and notification is included in the transition diagram ② the transitions record a trigger and a condition ③ the return targets are defined
- **Concrete examples:** ① Draw with its trigger the transition suggestion banner → (selecting "yes") → waypoint-set confirmation display → map screen. ② Draw with its condition the transition suggestion banner → (a certain time with no response) → auto-dismiss → map screen. ③ Define the return target of the back operation from the detail screen (the map screen or the suggestion banner).

#### SYS2-11-i — Reflect the interruption relationships

- **ASPICE BP:** SYS.2 BP1, BP2
- **Purpose:** Reflect in the transition diagram the interruption relationships with the existing navigation screens and other notifications.
- **Work content:** Reflect in the transition diagram the interruptions and priority order relative to the existing features (route guidance, destination search, settings) and other notifications (vehicle warnings, incoming calls, traffic information).
- **Input deliverables:** Screen-transition diagram, IVI technical constraints list (notification framework), experience-scenario document (priority-order definition)
- **Input source:** IVI development department / own department (deliverables from the preceding step)
- **Output deliverables:** Interruption & priority-order definition (event × treatment of the suggestion × recovery behaviour)
- **Granularity / completeness:** Draft version — before confirmation by the IVI development department
- **Predecessor / Successor:** Predecessor: SYS2-11-h, SYS1-04-p / Successor: SYS2-11-j, SYS2-12-d, SYS2-15-g
- **Entry:** The specification of the notification framework can be referenced
- **Exit (DoD):** ① The treatment of the suggestion is defined for the main interrupting events ② the priority order is stated explicitly ③ the recovery behaviour is defined
- **Concrete examples:** ① Define the treatment per event: close the suggestion immediately when a vehicle warning or an incoming call occurs, and give the suggestion display priority over traffic information. ② Note the priority order in the transition diagram as vehicle warning > incoming call > suggestion > traffic information. ③ Define whether a suggestion closed by an interruption is re-presented later or discarded, stating explicitly that where it is re-presented, the re-presentation rules apply.

#### SYS2-11-j — Define the while-driving restrictions

- **ASPICE BP:** SYS.2 BP1, BP2
- **Purpose:** Define separately the transitions and operations permitted while driving and while stopped.
- **Work content:** Define the screen transitions and operations permitted according to the vehicle state (vehicle speed, shift, parking brake), and state explicitly the alternative means when restricted.
- **Input deliverables:** Screen-transition diagram, operability definition, IVI technical constraints list
- **Input source:** Own department (deliverables from the preceding step) / IVI development department
- **Output deliverables:** While-driving restriction definition (vehicle state × permitted transitions × permitted operations × alternative means)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS2-11-h, SYS1-04-l / Successor: SYS2-12-e, SYS2-14-d
- **Entry:** The decision on operability is recorded in the response-policy list
- **Exit (DoD):** ① The permitted transitions per vehicle state are defined ② the alternative means when restricted are defined ③ the vehicle state used in the judgment is stated explicitly
- **Concrete examples:** ① Define that while driving, only "yes / later" on the suggestion banner can be operated, and transition to the detail screen is not possible. ② Define whether, when details are requested while driving, voice read-out serves as the alternative means, or a message is shown to open it after stopping. ③ State explicitly the vehicle state used in the while-driving judgment (vehicle speed at or above N km/h, or the shift not in P), attaching an issue ID if the value is undecided.

#### SYS2-11-k — Define the error and degraded screens

- **ASPICE BP:** SYS.2 BP1, BP2
- **Purpose:** Define the screens for when data cannot be obtained and for errors.
- **Work content:** Define the display content when integration data is missing, communication is broken, or the facility information cannot be obtained, and whether the user is given an explanation.
- **Input deliverables:** Use-case descriptions (exception flows), data-quality assessment table, screen list
- **Input source:** Own department (deliverables from the preceding step) / IVI development department
- **Output deliverables:** Error & degraded-screen definition (event × display content × whether explained × recovery condition)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS2-11-h, SYS2-10-f / Successor: SYS2-12-j, SYS2-14-g
- **Entry:** The exception flows are described
- **Exit (DoD):** ① The main abnormal events have a display definition ② whether the user is given an explanation has been judged ③ the recovery conditions are defined
- **Concrete examples:** ① Define the policy that when the facility information cannot be obtained, only the suggestion text is displayed without naming a facility, and no error message is shown. ② Judge whether the state should be shown on the settings screen when the feature is temporarily unavailable (continued failure to obtain vehicle signals). ③ Define the recovery condition (normal operation from the next judgment after signal acquisition resumes).

#### SYS2-11-l — Check against the distraction constraints

- **ASPICE BP:** SYS.2 BP1, BP2
- **Purpose:** Confirm that the screen proposals satisfy the constraints from a distraction viewpoint.
- **Work content:** Confirm the displayed character count, number of operation steps, and depth of hierarchy while driving against a checklist, and either correct or turn into issues the places that conflict.
- **Input deliverables:** Distraction-constraint check sheet, suggestion-display wireframe, while-driving restriction definition, HMI guidelines
- **Input source:** IVI development department / quality assurance department / own department (deliverables from the preceding step)
- **Output deliverables:** Distraction check results (item × judgment × correction content / issue ID)
- **Granularity / completeness:** Draft version — the detailed evaluation is in a subsequent phase
- **Predecessor / Successor:** Predecessor: SYS2-11-c, SYS2-11-j, SYS1-04-q / Successor: SYS2-11-m, SYS2-12-k
- **Entry:** The check items of the HMI guidelines can be referenced
- **Exit (DoD):** ① A judgment is recorded for each check item ② the conflicting places are either corrected or turned into issues ③ it is stated explicitly that the full evaluation is carried out downstream
- **Concrete examples:** ① Confirm whether the suggestion display while driving exceeds the character limit, and whether a response completes in one operation. ② Confirm that the depth of the hierarchy (suggestion → detail → facility list) is unreachable while driving. ③ State explicitly that the full evaluation, such as eye-tracking measurement on the actual unit, is carried out in the design and evaluation phases, and record the upper-limit values as requirements.

#### SYS2-11-m — Review the screen images and transition diagram

- **ASPICE BP:** SYS.2 BP1, BP2
- **Purpose:** Have the relevant departments review the screen images and transition diagram.
- **Work content:** Review the screens and transitions with the planning owner, IVI development department, and design department, and reflect the comments on intent, feasibility, and consistency.
- **Input deliverables:** The various wireframes, screen-transition diagram, while-driving restriction definition, distraction check results
- **Input source:** Own department (facilitation) / IVI development department / design department
- **Output deliverables:** Screen review minutes, screen images and transition diagram with the comments reflected
- **Granularity / completeness:** Draft version — review comments reflected
- **Predecessor / Successor:** Predecessor: SYS2-11-l, SYS2-11-i / Successor: SYS2-11-n
- **Entry:** The screen images and the transition diagram are broadly complete
- **Exit (DoD):** ① The 3 departments have reviewed it ② the comments are either reflected or turned into issues ③ the design department has confirmed the premises for its downstream work
- **Concrete examples:** ① Have the design department confirm whether the information priorities and layout will hold up under visual design, and share the premise that the visuals are created downstream. ② Have the IVI development department confirm whether it is achievable with the existing notification framework. ③ Have the planning owner confirm whether the way the suggestion appears is reasonable as a way of conveying the value.

#### SYS2-11-n — Fix the screen specification

- **ASPICE BP:** SYS.2 BP1, BP2
- **Purpose:** Settle the screen specification, making it the reference for creating the requirements list and the diagrams.
- **Work content:** Make the version with the comments reflected the fixed version, freeze the screen IDs and the version number, and distribute it.
- **Input deliverables:** Screen images and transition diagram with the comments reflected, screen review minutes
- **Input source:** Own department (authoring) / IVI development department (confirmation)
- **Output deliverables:** Screen list, screen images, and screen-transition diagram (fixed version, with a version number)
- **Granularity / completeness:** Fixed version — reviewed by the relevant departments (visual design out of scope)
- **Predecessor / Successor:** Predecessor: SYS2-11-m / Successor: SYS2-12-d, SYS2-14-f, SYS2-16-b
- **Entry:** The review comments have been reflected
- **Exit (DoD):** ① The screen IDs and the version number are frozen ② it is stated explicitly that visual design is out of scope ③ it has been distributed to the relevant departments
- **Concrete examples:** ① Freeze the screen IDs, and adopt the practice that subsequent additions and changes follow the change-management rules. ② State explicitly at the head of the document that "the colour scheme, typeface, and icon design are outside the scope of this document", writing that they are created in the downstream design. ③ Distribute the fixed version, stating explicitly that the creation of the requirements list and the flowcharts takes this version as its reference.

### SYS2-12 (L2) — Creating the requirements list (functional / non-functional requirements)

- **ASPICE BP:** SYS.2 BP1, BP2, BP3
- **Purpose:** Extract verifiable and unambiguous functional and non-functional requirements from the use cases, screens, integration policy, and system issues, and structure them so that traceability is ensured.
- **Work content:** Carry out work items a–p, create the requirements list (functional / non-functional, fixed version) and the traceability matrix, and agree them with the relevant departments.
- **Input deliverables:** Use-case descriptions (fixed version), screen list, screen images, and screen-transition diagram (fixed version), domain-integration policy (revised version), system issue list (fixed version), candidate-requirements memo, measurement-data item list
- **Input source:** Own department (deliverables from the preceding step) / IVI development department / the relevant domain departments / legal and security departments
- **Output deliverables:** Requirements list (functional / non-functional requirements: REQ-ID × requirement statement × rationale × acceptance condition × priority × related UC-ID × related issue ID), traceability matrix
- **Granularity / completeness:** Fixed version — reviewed by the relevant departments, IDs frozen
- **Predecessor / Successor:** Predecessor: SYS2-10, SYS2-11, SYS1-05, SYS1-06 / Successor: SYS2-13, SYS2-14, SYS2-15, SYS2-16
- **Entry:** The use-case descriptions and the screen specification are at fixed version
- **Exit (DoD):** The requirements list is settled, and every requirement carries an acceptance condition, a rationale, and traceability
- **Concrete examples:** (see the work items beneath) extracting the functional requirements from the use cases, the logging requirements derived from the KPIs, the non-functional requirements for degradation and availability, and reflecting the constraints and premises into the requirements.

#### SYS2-12-a — Define the requirement-writing rules

- **ASPICE BP:** SYS.2 BP1
- **Purpose:** Unify how requirements are written, so that unverifiable requirements do not slip in.
- **Work content:** Define the requirement-writing rules (unique ID, the subject is the system, "shall do X", 1 requirement = 1 matter, verifiability, prohibited expressions), and give good and bad examples.
- **Input deliverables:** The IVI development department's existing requirement format, in-house standards (if any), use-case description guide
- **Input source:** Own department (deliverables from the preceding step) / IVI development department
- **Output deliverables:** Requirement-writing rules (ID rules, sentence pattern, prohibited expressions, how to write acceptance conditions, good / bad examples)
- **Granularity / completeness:** Fixed version — agreed with the IVI development department
- **Predecessor / Successor:** Predecessor: SYS1-09-m / Successor: SYS2-12-b – m
- **Entry:** The requirements-definition kick-off is complete
- **Exit (DoD):** ① The ID rules and the sentence pattern are defined ② the prohibited expressions are enumerated ③ good and bad examples are given
- **Concrete examples:** ① Set the ID rules as FR- for functional requirements and NFR- for non-functional requirements, numbered sequentially within each classification. ② Enumerate "promptly", "appropriately", "in an easy-to-understand way", and the like as prohibited expressions, and set out the policy of rewriting them with a numeric value or a condition. ③ Show side by side the good example "the system shall, when the continuous driving time reaches the threshold, display the suggestion as a banner" and the bad example "the system shall make the suggestion at an appropriate time".

#### SYS2-12-b — Extract the functional requirements from the use cases

- **ASPICE BP:** SYS.2 BP1
- **Purpose:** Extract the functional requirements from each step of the use cases, preventing gaps.
- **Work content:** Convert the steps of the basic, alternative, and exception flows of the use-case descriptions into requirement statements one by one, recording the UC-ID and step number as the rationale.
- **Input deliverables:** Use-case descriptions (fixed version), requirement-writing rules
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Functional requirements (extracted version: FR-ID × requirement statement × rationale UC-ID and step)
- **Granularity / completeness:** Rough version — created by the planning owner
- **Predecessor / Successor:** Predecessor: SYS2-10-n, SYS2-12-a / Successor: SYS2-12-c – g, SYS2-12-n
- **Entry:** The use-case descriptions (fixed version) can be referenced
- **Exit (DoD):** ① Every use-case step is either converted into a requirement or judged out of scope ② each requirement carries the rationale UC-ID and step number
- **Concrete examples:** ① Convert the basic flow's "the system displays the suggestion" into the requirement "the system shall display the suggestion as a banner when the trigger conditions hold". ② Turn the behaviour on selecting "later" in the alternative flow into a requirement, including the time until re-presentation in the requirement statement. ③ For the steps that do not become requirements (the user's operations themselves), state explicitly that they are out of scope, distinguishing them from gaps.

#### SYS2-12-c — Turn the trigger and frequency rules into requirements

- **ASPICE BP:** SYS.2 BP1
- **Purpose:** Settle the trigger conditions, suppression conditions, and frequency rules as requirements with numeric values.
- **Work content:** From the condition-allocation table and the trigger-condition definition, turn the trigger conditions, suppression conditions, frequency, and re-presentation rules into requirement statements with numeric values and judgment conditions.
- **Input deliverables:** Condition-allocation table, trigger-condition definition (revised version), response-policy list (decision content), system issue list
- **Input source:** Own department (deliverables from the preceding step) / IVI development department
- **Output deliverables:** Functional requirements (the trigger and frequency-control portion)
- **Granularity / completeness:** Rough version — before review
- **Predecessor / Successor:** Predecessor: SYS2-10-h, SYS1-04-t, SYS1-08-m / Successor: SYS2-12-n, SYS2-14-c
- **Entry:** The decision content of the trigger conditions is recorded in the response-policy list
- **Exit (DoD):** ① The trigger and suppression conditions are turned into requirements with numeric values ② the frequency and re-presentation rules are turned into requirements ③ undecided numeric values carry a premise and an issue ID
- **Concrete examples:** ① Write the requirement "the system shall make a suggestion when the continuous driving time reaches 90 minutes and the distance to the next rest facility is within 30 km". ② Write the requirement "the system shall stop accumulating continuous driving time while a traffic jam is judged (vehicle speed at or below 20 km/h continuing for 10 minutes)". ③ Write the requirements "the system shall limit the number of suggestions per trip to at most 3" and "the system shall re-present after 15 minutes when there is no response", annotating the undecided values with an issue ID.

#### SYS2-12-d — Turn the display and notification into requirements

- **ASPICE BP:** SYS.2 BP1
- **Purpose:** Settle the requirements on display and notification on the basis of the screen specification.
- **Work content:** From the screen specification and the per-notification-means expression definition, turn the display items, character limits, presentation times, use of the different notification means, and priority order into requirement statements.
- **Input deliverables:** Screen list, screen images, and screen-transition diagram (fixed version), per-notification-means expression definition, interruption & priority-order definition, passenger-display definition
- **Input source:** Own department (deliverables from the preceding step) / IVI development department
- **Output deliverables:** Functional requirements (the display and notification portion)
- **Granularity / completeness:** Rough version — before review
- **Predecessor / Successor:** Predecessor: SYS2-11-n, SYS2-11-d, SYS2-11-i, SYS2-11-b / Successor: SYS2-12-n
- **Entry:** The screen specification is at fixed version
- **Exit (DoD):** ① The display items and the upper limits are turned into requirements ② the use of the different notification means is turned into requirements ③ the priority order on interruption is turned into a requirement
- **Concrete examples:** ① Write the requirements "the system shall keep the suggestion display while driving within 2 lines and 15 characters" and "shall not hide the map's current-position display or the guidance-turn display". ② Write the requirement "the system shall, when suggesting, give a banner display and voice guidance (within 5 seconds)". ③ Write the requirement "the system shall end the suggestion display when a vehicle warning or an incoming call occurs".

#### SYS2-12-e — Turn the operations and input into requirements

- **ASPICE BP:** SYS.2 BP1
- **Purpose:** Settle the requirements on operations and input together with the while-driving restrictions.
- **Work content:** Turn the permitted operations and the restrictions according to the vehicle state into requirement statements, for the response operations, voice response, and settings operations.
- **Input deliverables:** While-driving restriction definition, operability definition, screen-transition diagram (fixed version)
- **Input source:** Own department (deliverables from the preceding step) / IVI development department
- **Output deliverables:** Functional requirements (the operation and input portion)
- **Granularity / completeness:** Rough version — before review
- **Predecessor / Successor:** Predecessor: SYS2-11-j, SYS1-04-l / Successor: SYS2-12-n
- **Entry:** The while-driving restriction definition is settled
- **Exit (DoD):** ① The permitted operations while driving are turned into requirements ② the scope of voice response is turned into a requirement ③ the vehicle state used in the judgment is included in the requirement statement
- **Concrete examples:** ① Write the requirement "the system shall, while driving, accept only the response operations to a suggestion (yes / later)". ② Write the requirement "the system shall accept responses by voice (yes / later / do not show again)". ③ State explicitly in the requirement statement the vehicle state used in the while-driving judgment (vehicle speed, shift position), attaching an issue ID if the threshold is undecided.

#### SYS2-12-f — Turn the data reception and degradation into requirements

- **ASPICE BP:** SYS.2 BP1, BP3
- **Purpose:** Settle as requirements the reception of data from the other domains and the behaviour when it is missing.
- **Work content:** Turn the reception requirements for the necessary data (items, period, freshness) and the degraded operation on loss, delay, or abnormal values into requirement statements.
- **Input deliverables:** Domain-integration policy (revised version), data-quality assessment table, use-case descriptions (exception flows), system issue list (technical issues)
- **Input source:** Own department (deliverables from the preceding step) / IVI development department / the relevant domain departments
- **Output deliverables:** Functional requirements (the data reception and degradation portion)
- **Granularity / completeness:** Rough version — before confirmation by the relevant domains
- **Predecessor / Successor:** Predecessor: SYS1-05-o, SYS1-09-c, SYS2-10-f / Successor: SYS2-12-n, SYS2-13-e, SYS2-15-e
- **Entry:** The adopted proposal for the integration scope is settled
- **Exit (DoD):** ① The reception requirements for the necessary data are described with items and periods ② the behaviour on loss or abnormal values is turned into requirements ③ the degradation when it cannot be obtained is turned into a requirement
- **Concrete examples:** ① Write the requirement "the system shall obtain the vehicle speed and shift position at a 1-second period". ② Write the requirement "the system shall switch to time-based judgment when the vehicle speed cannot be obtained for a certain time". ③ Write the requirement "the system shall not perform the judgment in question when the fatigue-estimate result is not a valid value", and link it to the awaiting-a-condition issue.

#### SYS2-12-g — Turn the settings and consent into requirements

- **ASPICE BP:** SYS.2 BP1
- **Purpose:** Settle the requirements on settings and consent, down to the behaviour on refusal.
- **Work content:** Turn the setting items, defaults, and timing at which a change takes effect, and the behaviour on obtaining, refusing, and withdrawing consent, into requirement statements.
- **Input deliverables:** Settings-screen wireframe, consent-screen wireframe, privacy & consent policy, use-case descriptions (settings and consent)
- **Input source:** Own department (deliverables from the preceding step) / legal department
- **Output deliverables:** Functional requirements (the settings and consent portion)
- **Granularity / completeness:** Rough version — before legal confirmation
- **Predecessor / Successor:** Predecessor: SYS2-11-f, SYS2-10-j, SYS1-05-j / Successor: SYS2-12-n, SYS2-12-k
- **Entry:** The consent policy is settled
- **Exit (DoD):** ① The setting items and the defaults are turned into requirements ② the behaviour on obtaining, refusing, and withdrawing consent is turned into requirements ③ the degradation on refusal is turned into a requirement
- **Concrete examples:** ① Write the requirement "the system shall provide settings for the feature on/off and the suggestion frequency (more / standard / fewer), with the defaults on and standard". ② Write the requirements "the system shall obtain consent to data use at first start-up" and "shall not perform judgments using the location or driving behaviour when consent is not obtained". ③ Turn the means of withdrawing consent, and the stopping of data transmission after withdrawal, into requirements.

#### SYS2-12-h — Turn the logging and measurement into requirements

- **ASPICE BP:** SYS.2 BP1
- **Purpose:** Settle as requirements the log acquisition and transmission needed for KPI measurement.
- **Work content:** From the measurement-data item list, turn the log items acquired, recording triggers, retention, and transmission conditions into requirement statements.
- **Input deliverables:** Measurement-data item list, success criteria, privacy & consent policy
- **Input source:** Own department (deliverables from the preceding step) / cloud department
- **Output deliverables:** Functional requirements (the logging and measurement portion)
- **Granularity / completeness:** Rough version — before confirmation by the cloud department
- **Predecessor / Successor:** Predecessor: SYS1-06-l, SYS1-06-k / Successor: SYS2-12-n, SYS2-12-k
- **Entry:** The measurement-data items are settled
- **Exit (DoD):** ① The log items and the recording triggers are turned into requirements ② the transmission conditions are turned into requirements ③ the relationship to consent is reflected in the requirement statements
- **Concrete examples:** ① Write the requirement "the system shall record each event of suggestion display, response, and auto-dismissal together with the time of occurrence". ② Write the requirement "the system shall send the recorded logs to the cloud when communication is possible", noting the retention count and its upper limit when they cannot be sent as an issue. ③ Write the requirement "the system shall not transmit items by which an individual could be identified when consent has not been obtained".

#### SYS2-12-i — Define the performance and responsiveness requirements

- **ASPICE BP:** SYS.2 BP1
- **Purpose:** Define the non-functional requirements on responsiveness and processing timing.
- **Work content:** Define as non-functional requirements the judgment period, the delay until the suggestion is displayed, the timing of the voice playback, and the upper limit on the operation response time.
- **Input deliverables:** Functional requirements (the trigger and display portions), IVI technical constraints list, experience-scenario document
- **Input source:** Own department (deliverables from the preceding step) / IVI development department
- **Output deliverables:** Non-functional requirements (the performance and responsiveness portion)
- **Granularity / completeness:** Rough version — before confirmation by the IVI development department
- **Predecessor / Successor:** Predecessor: SYS2-12-c, SYS2-12-d / Successor: SYS2-12-n, SYS2-15-d
- **Entry:** The skeleton of the functional requirements is in place
- **Exit (DoD):** ① The judgment period and the upper limit on the display delay are defined numerically ② the upper limit on the operation response time is defined ③ the rationale or the premise is recorded
- **Concrete examples:** ① Write the requirement "the system shall display the suggestion within 2 seconds of the trigger conditions holding", recording the rationale (a range within which no sense of oddness arises in the experience) or the premise. ② Write the requirement "the system shall reflect a response operation on the screen within 0.5 seconds". ③ For items whose numeric rationale is not settled, attach the premise value and an issue ID, noting that they are revisited downstream on the basis of actual measurement.

#### SYS2-12-j — Define the availability and degradation requirements

- **ASPICE BP:** SYS.2 BP1
- **Purpose:** Define the non-functional requirements on availability, degradation, and state retention.
- **Work content:** Define the requirements for continued operation and state retention across a communication break, a signal break, a restart, and a trip boundary.
- **Input deliverables:** Use-case descriptions (exception flows), error & degraded-screen definition, data-quality assessment table, system issue list (constraints)
- **Input source:** Own department (deliverables from the preceding step) / IVI development department
- **Output deliverables:** Non-functional requirements (the availability and degradation portion)
- **Granularity / completeness:** Rough version — before confirmation by the IVI development department
- **Predecessor / Successor:** Predecessor: SYS2-11-k, SYS2-12-f / Successor: SYS2-12-n, SYS2-14-h
- **Entry:** The exception flows and the degraded screens are defined
- **Exit (DoD):** ① Continued operation during a communication break is turned into a requirement ② state retention or initialization on restart is turned into a requirement ③ the treatment of the trip boundary is turned into a requirement
- **Concrete examples:** ① Write the requirement "the system shall continue to judge and display suggestions using only the in-vehicle data even when communication with the cloud is unavailable". ② Write the requirement "the system shall retain the number of suggestions within the same trip even after an IVI restart", noting the treatment as a constraint where retention is not possible. ③ Write the requirement "the system shall reset the continuous driving time when a stop continues for 15 minutes or more".

#### SYS2-12-k — Define the security and privacy requirements

- **ASPICE BP:** SYS.2 BP1
- **Purpose:** Define the non-functional requirements on security and privacy on the basis of the specialist departments' answers.
- **Work content:** Define the requirements on the protection of the data-acquisition path, the scope of storage, anonymization, and access control, with the specialist departments' answers as the rationale.
- **Input deliverables:** Specialist-department answer list, privacy & consent policy, security & functional-safety issue list, functional requirements (the logging and settings portions)
- **Input source:** Security department / legal department / own department (deliverables from the preceding step)
- **Output deliverables:** Non-functional requirements (the security and privacy portion)
- **Granularity / completeness:** Rough version — before confirmation by the specialist departments
- **Predecessor / Successor:** Predecessor: SYS1-08-i, SYS2-12-g, SYS2-12-h / Successor: SYS2-12-n, SYS2-16-l
- **Entry:** The specialist departments' answers have been received
- **Exit (DoD):** ① The requirements on data protection are defined ② the scope of storage and anonymization are turned into requirements ③ the specialist departments' answers are recorded as the rationale
- **Concrete examples:** ① Write the requirement "the system shall use the existing authorized path to acquire the vehicle signals", citing the answer document as the rationale. ② Write the requirement "the system shall process the location information within the vehicle and send only anonymized aggregate values to the cloud". ③ Record the detailed compliance with laws and standards (type-approval procedures, etc.) not as requirements but as premises and constraints, stating explicitly the responsible department.

#### SYS2-12-l — Define the maintainability and updatability requirements

- **ASPICE BP:** SYS.2 BP1
- **Purpose:** Define the non-functional requirements on maintainability and updatability.
- **Work content:** Define the requirements on the ease of changing the thresholds and the text, the unit of OTA update, and externalizing the setting values.
- **Input deliverables:** System issue list (constraints: whether OTA update is possible), IVI technical constraints list, response-policy list (where the judgment logic sits)
- **Input source:** Own department (deliverables from the preceding step) / IVI development department
- **Output deliverables:** Non-functional requirements (the maintainability and updatability portion)
- **Granularity / completeness:** Rough version — before confirmation by the IVI development department
- **Predecessor / Successor:** Predecessor: SYS1-09-c, SYS1-08-m / Successor: SYS2-12-n, SYS2-13-g
- **Entry:** Whether OTA update is possible and its unit are understood
- **Exit (DoD):** ① The requirements on ease of change are defined ② the target scope of OTA update is turned into a requirement ③ the underlying constraints are recorded
- **Concrete examples:** ① Write the requirement "the system shall hold the trigger-condition thresholds and the suggestion text in a form that can be updated without rebuilding the in-vehicle software". ② Write the requirement "the system shall include the judgment logic within the scope of OTA update", citing as the rationale the decision to place the judgment logic on the IVI side. ③ State explicitly as constraints the elements that cannot be updated (adding a vehicle-side signal).

#### SYS2-12-m — Reflect the constraints and premises

- **ASPICE BP:** SYS.2 BP1
- **Purpose:** Reflect the constraints and premises from the system issue list either as requirements or as pre-conditions.
- **Work content:** Sort the constraints and premises into those reflected into requirement statements and those recorded in the pre-conditions chapter of the specification document, and link the issue IDs.
- **Input deliverables:** System issue list (fixed version), issue × candidate-requirement correspondence table, requirements list (extracted version)
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Constraint & premise reflection table (issue ID × where reflected (requirement / pre-condition) × content reflected)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS1-09-f, SYS2-12-b – l / Successor: SYS2-12-n, SYS2-16-c
- **Entry:** The system issue list can be referenced
- **Exit (DoD):** ① Where every constraint and premise is reflected is decided ② those reflected into requirements have a requirement ID linked ③ those recorded in the pre-conditions chapter are listed
- **Concrete examples:** ① Reflect the constraint "the continuous driving time is reset when the IVI restarts" into both a requirement (retention on restart) and a pre-condition (the treatment when retention is not possible). ② Record the premise "errors in the facility information are corrected weekly by the operations department" not as a requirement but in the pre-conditions chapter. ③ Describe with a premise value the requirements that cannot be settled because of an undecided issue, linking the issue ID to the requirement.

#### SYS2-12-n — Structure the requirements

- **ASPICE BP:** SYS.2 BP2
- **Purpose:** Structure the requirements by functional group, and resolve the duplications and contradictions.
- **Work content:** Classify the extracted requirements into functional groups (trigger judgment / display & notification / operation / integration / settings & consent / logging / non-functional), and consolidate duplicates, resolve contradictions, and adjust the granularity.
- **Input deliverables:** Functional and non-functional requirements (each extracted version), constraint & premise reflection table, requirement-writing rules
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Requirements list (structured version: group × REQ-ID × requirement statement)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS2-12-b – m / Successor: SYS2-12-o, SYS2-13-a, SYS2-14-j
- **Entry:** The extraction of the requirements is broadly complete
- **Exit (DoD):** ① Every requirement is classified into a group ② the duplicates are consolidated and the IDs consolidated from are recorded ③ the contradictions are either resolved or turned into issues
- **Concrete examples:** ① Where the same content has been extracted from both the trigger judgment and the display, consolidate it into one entry, leaving the IDs consolidated from in the remarks. ② Detect contradictions such as "auto-dismiss when there is no response" versus "keep the display until the next judgment when there is no response", and adopt one of them on the basis of the decision. ③ Split a requirement that contains multiple matters (the display and the voice recorded in one sentence).

#### SYS2-12-o — Attach the attributes and traceability

- **ASPICE BP:** SYS.2 BP2, BP3
- **Purpose:** Attach the rationale, acceptance conditions, priority, and tracing relationships to the requirements.
- **Work content:** Attach to each requirement the rationale (plan, use case, issue), the acceptance condition, the priority (mandatory / recommended / future), and the related IDs, and create the traceability matrix.
- **Input deliverables:** Requirements list (structured version), use-case descriptions (fixed version), system issue list, scope-sorting table
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Requirements list (with the attributes attached), traceability matrix (plan → UC → requirement → issue)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS2-12-n, SYS1-06-n / Successor: SYS2-12-p, SYS2-16-f
- **Entry:** The structuring of the requirements is complete
- **Exit (DoD):** ① Every requirement has a rationale and an acceptance condition ② the priorities are consistent with the scope sorting ③ the traceability matrix has been created
- **Concrete examples:** ① Write the acceptance conditions in a form that makes the confirmation method clear, such as "after 90 minutes of continuous driving is reached, the suggestion is displayed at the next judgment period". ② Map the priorities to the scope-sorting table (initial release / OTA addition / set aside), and where they diverge, check the sorting table. ③ Use the matrix to detect requirements without a rationale (requirements not linked to any UC or issue), and use cases with no requirements.

#### SYS2-12-p — Review and fix the requirements list

- **ASPICE BP:** SYS.2 BP3, BP4
- **Purpose:** Have the relevant departments review the requirements list, settle it, and freeze the IDs.
- **Work content:** Review it by field with the IVI development department, the relevant domain departments, and the legal / security departments, reflect the comments, and make it the fixed version.
- **Input deliverables:** Requirements list (with the attributes attached), traceability matrix
- **Input source:** IVI development department / the relevant domain departments / legal and security departments / own department (deliverables from the preceding step)
- **Output deliverables:** Requirements list (fixed version, with a version number), requirements review minutes
- **Granularity / completeness:** Fixed version — reviewed by the relevant departments, IDs frozen
- **Predecessor / Successor:** Predecessor: SYS2-12-o / Successor: SYS2-13-h, SYS2-14-j, SYS2-15-i, SYS2-16-b
- **Entry:** The attributes have been attached to the requirements list
- **Exit (DoD):** ① The responsible departments have reviewed it by field ② the comments on feasibility and verifiability are reflected ③ the REQ-IDs and the version number are frozen
- **Concrete examples:** ① Split the review: the integration requirements with the relevant domain departments, the logging and consent requirements with the legal / security departments, and the performance requirements with the IVI development department. ② Rewrite the condition of any requirement for which the comment "pass or fail cannot be judged with this acceptance condition" is received. ③ Freeze the REQ-IDs, stating explicitly at distribution that subsequent changes follow the change-management rules.

---

### SYS2-13 (L2) — Creating the function allocation diagram (including the allocation across domains)

- **ASPICE BP:** SYS.2 BP2, BP3
- **Purpose:** Enumerate the function blocks that realize the requirements, decide with rationale where each is placed — the IVI, another domain, or the cloud — and make the division of responsibility and the interfaces clear.
- **Work content:** Carry out work items a–l, create the function allocation diagram (fixed version) and the division-of-responsibility and interface lists, and agree them with the relevant domain departments.
- **Input deliverables:** Requirements list (fixed version), use-case descriptions (fixed version), domain-integration policy (revised version: the division-of-responsibility proposal), system issue list (technical issues)
- **Input source:** Own department (deliverables from the preceding step) / IVI development department / ADAS department / vehicle control department / cloud department
- **Output deliverables:** Function allocation diagram (function block × allocated domain × data flow), division-of-responsibility list, candidate-interface list
- **Granularity / completeness:** Fixed version — reviewed by the relevant domain departments
- **Predecessor / Successor:** Predecessor: SYS2-12, SYS1-05 / Successor: SYS2-15, SYS2-16
- **Entry:** The requirements list (fixed version) has been distributed
- **Exit (DoD):** The function allocation is settled, and the division of responsibility and the candidate interfaces are agreed with the relevant domain departments
- **Concrete examples:** (see the work items beneath) reflecting where the judgment logic sits, comparing multiple allocation proposals, making the cross-domain data flows explicit, and evaluating by ease of change and responsiveness.

#### SYS2-13-a — Enumerate the function blocks

- **ASPICE BP:** SYS.2 BP2
- **Purpose:** Enumerate the function blocks needed to realize the requirements.
- **Work content:** Extract the function blocks (measurement, judgment, presentation, response handling, integration, logging, settings management) from the requirements list and the use cases, and link the requirement IDs each one carries.
- **Input deliverables:** Requirements list (fixed version), use-case descriptions (fixed version), actor list, integration-point list
- **Input source:** Own department (deliverables from the preceding step) / IVI development department
- **Output deliverables:** Function block list (block × requirement IDs carried × overview)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS2-12-n, SYS2-10-i, SYS2-10-b / Successor: SYS2-13-b, SYS2-13-c
- **Entry:** The requirements list is at fixed version
- **Exit (DoD):** ① Every requirement is linked to some function block ② the granularity of the blocks is consistent ③ each block's overview is described in one sentence
- **Concrete examples:** ① Extract as blocks: continuous-driving-time measurement, trigger judgment, frequency control, suggestion presentation, response handling, facility-information acquisition, vehicle-data reception, log recording & transmission, and settings & consent management. ② Confirm that no requirement is left unlinked to any block, and where one is, create a new block. ③ Where one block carries too many requirements (the conditions concentrate in the trigger judgment), split it into judgment and frequency control.

#### SYS2-13-b — Organize the candidate allocation domains

- **ASPICE BP:** SYS.2 BP2
- **Purpose:** Organize the candidate domains for allocation, making the allocation options clear.
- **Work content:** For each of the IVI, instrument cluster, ADAS, vehicle control, cloud, and smartphone domains, organize the possibility of allocation and the constraints.
- **Input deliverables:** Domain-integration policy (revised version), IVI technical constraints list, data-availability answer table, function block list
- **Input source:** Own department (deliverables from the preceding step) / IVI development department / the relevant domain departments
- **Output deliverables:** Candidate-allocation summary (domain × functions that can be allocated × constraints)
- **Granularity / completeness:** Draft version — before confirmation by the relevant domains
- **Predecessor / Successor:** Predecessor: SYS2-13-a, SYS1-05-o / Successor: SYS2-13-c
- **Entry:** The function block list has been created
- **Exit (DoD):** ① The possibility of allocation and the constraints of each domain are organized ② the domains where allocation is impossible are excluded with a reason
- **Concrete examples:** ① Organize the premise that the IVI can host judgment, presentation, and logging at the application layer, and that OTA update is also possible. ② Record constraints such as: vehicle control only provides signals, and adding judgment logic is impossible because its specification is already frozen. ③ Record that the cloud can provide the facility information and aggregate the logs, but with the constraint that the feature stops during a communication break.

#### SYS2-13-c — Create multiple allocation proposals

- **ASPICE BP:** SYS.2 BP2
- **Purpose:** Create multiple allocation proposals in a form that can be compared.
- **Work content:** Create the allocation of the function blocks in multiple proposals (IVI-centralized / distributed judgment / cloud-leveraging), and diagram the configuration of each.
- **Input deliverables:** Function block list, candidate-allocation summary, use-case diagram
- **Input source:** Own department (deliverables from the preceding step) / IVI development department
- **Output deliverables:** Allocation proposals (drafts of 2–3 function allocation diagrams)
- **Granularity / completeness:** Rough version — created by the planning owner
- **Predecessor / Successor:** Predecessor: SYS2-13-a, SYS2-13-b, SYS2-10-k / Successor: SYS2-13-d, SYS2-13-g
- **Entry:** The candidate allocation domains are organized
- **Exit (DoD):** ① At least 2 proposals have been created ② every function block is allocated in each proposal ③ the difference between the proposals can be explained
- **Concrete examples:** ① Proposal A: place the judgment, frequency control, and presentation all on the IVI, with the other domains providing signals only. ② Proposal B: place the fatigue judgment on the ADAS side, with the IVI carrying only the presentation and frequency control. ③ Proposal C: place the facility information and part of the judgment in the cloud, with the IVI centred on presentation.

#### SYS2-13-d — Reflect the decision on where the judgment logic sits

- **ASPICE BP:** SYS.2 BP2
- **Purpose:** Reflect the settled location of the judgment logic in the allocation, so as not to contradict the decision.
- **Work content:** Reflect the decisions on the division of responsibility in the response-policy list into each allocation proposal, and exclude or correct the proposals that contradict the decisions.
- **Input deliverables:** Response-policy list (fixed version), allocation proposals, division-of-responsibility proposal
- **Input source:** Own department (deliverables from the preceding step)
- **Output deliverables:** Allocation proposals (with the decisions reflected), the excluded proposals and the reasons
- **Granularity / completeness:** Rough version — before review
- **Predecessor / Successor:** Predecessor: SYS2-13-c, SYS1-08-m / Successor: SYS2-13-e, SYS2-13-g
- **Entry:** The decision on the division of responsibility is recorded
- **Exit (DoD):** ① The decisions are reflected in every proposal ② the proposals that contradict the decisions are excluded and the reasons are recorded
- **Concrete examples:** ① Following the decision "the judgment logic sits on the IVI side", exclude proposal B's configuration placing the fatigue judgment on the ADAS side as "contradicting the decision". ② However, keep the configuration that uses the fatigue-estimate result output by the ADAS as an input, since it does not contradict the decision. ③ Record the excluded proposals and the reasons, so they can be referred to at a future review.

#### SYS2-13-e — Make the cross-domain data flows explicit

- **ASPICE BP:** SYS.2 BP2, BP3
- **Purpose:** Make the cross-domain data flows explicit, so that what is exchanged where is clear.
- **Work content:** For each allocation proposal, make explicit in a diagram and a list the data items exchanged between the domains, their direction, and their period.
- **Input deliverables:** Allocation proposals (with the decisions reflected), required-data list, functional requirements (the data-reception portion), integration-point list
- **Input source:** Own department (deliverables from the preceding step) / IVI development department
- **Output deliverables:** Data-flow definition (source × destination × data item × direction × period)
- **Granularity / completeness:** Draft version — before confirmation by the relevant domains
- **Predecessor / Successor:** Predecessor: SYS2-13-d, SYS2-12-f / Successor: SYS2-13-f, SYS2-15-b
- **Entry:** The required-data list is settled
- **Exit (DoD):** ① The data exchanges between all domains are diagrammed ② the data items, directions, and periods are listed ③ they match the data-reception requirements in the requirements list
- **Concrete examples:** ① Define vehicle control → IVI: vehicle speed and shift position (1-second period), ADAS → IVI: fatigue-estimate result (when the conditions hold), IVI → cloud: logs (when communication is possible). ② Add instrument cluster → IVI: warning state (on state change), and map it to the expression-consistency requirement. ③ Cross-check the data-flow definition against the data-reception requirements in the requirements list, and identify the items that appear in only one of them.

#### SYS2-13-f — Organize the candidate interfaces

- **ASPICE BP:** SYS.2 BP2
- **Purpose:** Organize the candidate interfaces and whether existing ones can be reused.
- **Work content:** For each data flow, organize the candidate interfaces to be used (an existing API / an existing signal / a new addition) and whether reuse is possible.
- **Input deliverables:** Data-flow definition, IVI technical constraints list (existing interfaces), data-availability answer table
- **Input source:** IVI development department / the relevant domain departments
- **Output deliverables:** Candidate-interface list (data flow × candidate IF × whether an existing one can be reused × whether an addition is needed)
- **Granularity / completeness:** Draft version — before confirmation by the relevant domains
- **Predecessor / Successor:** Predecessor: SYS2-13-e, SYS1-05-e / Successor: SYS2-13-g, SYS2-13-i, SYS2-15-e
- **Entry:** The existing interface specifications can be referenced
- **Exit (DoD):** ① Every data flow has a candidate IF ② whether an existing one can be reused is judged ③ those requiring a new addition are identified and turned into issues
- **Concrete examples:** ① Judge that the vehicle speed and shift position can reuse the existing vehicle-signal acquisition API. ② Judge that the fatigue-estimate result is not included in the existing API and therefore requires a new addition, and register whether and when it can be added as an issue. ③ Note alongside it the alternative (via the cloud) for when a new addition cannot make the specification freeze.

#### SYS2-13-g — Evaluate the allocation proposals and select one

- **ASPICE BP:** SYS.2 BP3
- **Purpose:** Compare the allocation proposals along evaluation axes and select the adopted proposal.
- **Work content:** Evaluate each proposal on ease of change (can it be fixed over OTA), responsiveness, dependence on communication, cost, and schedule, and present a recommendation.
- **Input deliverables:** Allocation proposals (with the decisions reflected), candidate-interface list, non-functional requirements (maintainability & updatability, performance), integration cost & schedule estimate table
- **Input source:** Own department (deliverables from the preceding step) / IVI development department
- **Output deliverables:** Allocation-proposal evaluation table (proposal × evaluation axis × evaluation × recommendation)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS2-13-c, SYS2-13-d, SYS2-13-f, SYS2-12-l / Successor: SYS2-13-h
- **Entry:** The non-functional requirements needed for the evaluation are settled
- **Exit (DoD):** ① All proposals are evaluated on the same axes ② the recommended proposal and the reason are recorded ③ consistency with the non-functional requirements has been confirmed
- **Concrete examples:** ① On ease of change, rate proposal A highly, since a threshold change requires only an IVI OTA. ② On responsiveness, rate proposal C low, since it includes cloud-mediated judgment and is affected by communication delay. ③ Record the reason for the recommended proposal (A) linked to the non-functional requirement (thresholds can be changed over OTA).

#### SYS2-13-h — Fix the function allocation diagram

- **ASPICE BP:** SYS.2 BP2, BP3
- **Purpose:** Settle the adopted allocation as the function allocation diagram.
- **Work content:** Draw up the adopted proposal cleanly as the function allocation diagram, expressing the domain boundaries, function blocks, data flows, and external systems on one page.
- **Input deliverables:** Allocation-proposal evaluation table, data-flow definition, requirements list (fixed version)
- **Input source:** Own department (deliverables from the preceding step) / IVI development department
- **Output deliverables:** Function allocation diagram (the adopted proposal, cleanly drawn)
- **Granularity / completeness:** Draft version — before review
- **Predecessor / Successor:** Predecessor: SYS2-13-g, SYS2-12-p / Successor: SYS2-13-i, SYS2-13-j, SYS2-15-b
- **Entry:** The adopted proposal is decided
- **Exit (DoD):** ① The domain boundaries are made explicit ② every function block is allocated ③ the data flows are expressed in the diagram
- **Concrete examples:** ① Divide the IVI, instrument cluster, ADAS, vehicle control, and cloud into frames, and place the function blocks inside the corresponding frame. ② Attach the data-item names to the arrows between blocks, annotating the period or the trigger. ③ Distinguish what is in the initial release from what is an OTA extension by line style, and attach a legend.

#### SYS2-13-i — Organize the responsibility demarcation by department

- **ASPICE BP:** SYS.2 BP2
- **Purpose:** Make each department's scope of responsibility explicit, so that it can serve as the basis for deciding the development split.
- **Work content:** For the function blocks and the interfaces, organize specification responsibility, implementation responsibility and verification responsibility by department.
- **Input deliverables:** Function allocation diagram (clean version), interface candidate list, stakeholder map
- **Input source:** Own department (deliverables of the preceding step) / IVI development department / the related domain departments
- **Output deliverables:** Responsibility demarcation list (function block / IF × specification responsibility × implementation responsibility × verification responsibility × department)
- **Granularity / completeness:** Draft version: before confirmation by the related domains
- **Predecessor / Successor:** Predecessor: SYS2-13-h, SYS2-13-f / Successor: SYS2-13-k, SYS2-16-c
- **Entry:** The function allocation diagram has been drawn cleanly.
- **Exit (DoD):** ① A responsible department is assigned to every function block. ② The specification responsibility for the interfaces is made explicit. ③ The scope to be outsourced to the development vendor is distinguished.
- **Concrete examples:** ① Organize it so that the trigger-decision block is the specification responsibility of the IVI development department, implementation is by the development vendor, and verification is by the IVI development department together with the quality-assurance department. ② Organize it so that the vehicle-signal interface specification is the responsibility of the vehicle control department, while the IVI side, as the consumer, performs consistency confirmation. ③ For the places where responsibility is split (the wording of the meter display), state it explicitly as a matter agreed between both departments.

#### SYS2-13-j — Confirm that the allocation can satisfy the non-functional requirements

- **ASPICE BP:** SYS.2 BP3
- **Purpose:** Confirm whether the allocation can satisfy the non-functional requirements.
- **Work content:** For the non-functional requirements on responsiveness, availability, maintainability and security, confirm whether the adopted allocation can satisfy them; where it cannot, revise either the requirement or the allocation.
- **Input deliverables:** Function allocation diagram (clean version), non-functional requirements (fixed version)
- **Input source:** Own department (deliverables of the preceding step) / IVI development department
- **Output deliverables:** Non-functional consistency confirmation results (requirement ID × satisfiable or not × grounds × action)
- **Granularity / completeness:** Draft version: before review
- **Predecessor / Successor:** Predecessor: SYS2-13-h, SYS2-12-p / Successor: SYS2-13-k, SYS2-16-e
- **Entry:** The non-functional requirements are at the fixed version.
- **Exit (DoD):** ① For the principal non-functional requirements, satisfiability has been judged. ② The action for the requirements that cannot be satisfied has been decided. ③ The grounds for the judgement are recorded.
- **Concrete examples:** ① For the requirement "continue the decision and the display even when communication is unavailable", given that the facility information depends on the cloud, judge that it is satisfied by a degraded display without the facility name. ② For "delay until display within 2 seconds", confirm whether it can be satisfied given the acquisition cycle of the vehicle signals. ③ Where it cannot be satisfied, judge whether to revise the requirement value or to change the allocation, and record it as an issue.

#### SYS2-13-k — Review the function allocation and the responsibility demarcation with the related domain departments

- **ASPICE BP:** SYS.2 BP3
- **Purpose:** Review the function allocation and the responsibility demarcation with the related domain departments.
- **Work content:** Review the function allocation diagram, the responsibility demarcation list and the interface candidates with the related domain departments, and confirm feasibility and the appropriateness of the split.
- **Input deliverables:** Function allocation diagram (clean version), responsibility demarcation list, interface candidate list, non-functional consistency confirmation results
- **Input source:** IVI development department / ADAS department / vehicle control department / cloud department / own department (facilitation)
- **Output deliverables:** Allocation review minutes, function allocation diagram and responsibility demarcation list with the comments reflected
- **Granularity / completeness:** Draft version: review comments reflected
- **Predecessor / Successor:** Predecessor: SYS2-13-i, SYS2-13-j / Successor: SYS2-13-l
- **Entry:** The function allocation diagram and the responsibility demarcation list are both available.
- **Exit (DoD):** ① The related domain departments have reviewed it. ② The split of responsibility has been accepted by each department. ③ The comments have been reflected or turned into issues.
- **Concrete examples:** ① Confirm with the ADAS department the output format and the trigger of the fatigue-estimation result, and if it differs from the assumption, correct the allocation and the data flow. ② Confirm with the vehicle control department whether signals need to be added and the procedure for doing so; if addition is not possible, correct to an alternative path. ③ Leave each department's acceptance of the responsibility demarcation in the minutes.

#### SYS2-13-l — Fix the function allocation diagram and distribute it

- **ASPICE BP:** SYS.2 BP2・BP4
- **Purpose:** Fix the function allocation diagram and make it the baseline for the sequence diagrams and the specification document.
- **Work content:** Treat the version with the comments reflected as the fixed version, assign a version number and distribute it to the related departments.
- **Input deliverables:** Function allocation diagram and responsibility demarcation list with the comments reflected, allocation review minutes
- **Input source:** Own department (creation) / IVI development department (confirmation)
- **Output deliverables:** Function allocation diagram (fixed version), responsibility demarcation list (fixed version), interface candidate list (fixed version)
- **Granularity / completeness:** Fixed version: reviewed by the related domain departments
- **Predecessor / Successor:** Predecessor: SYS2-13-k / Successor: SYS2-15-b, SYS2-16-b
- **Entry:** The review comments have been reflected.
- **Exit (DoD):** ① A version number has been assigned. ② It has been distributed to the related departments. ③ It has been made known that it is the baseline for the subsequent work.
- **Concrete examples:** ① Version-number the function allocation diagram, the responsibility demarcation list and the interface candidate list as a single set. ② On distribution, state explicitly that the sequence diagrams and the specification-document integration take this version as their baseline. ③ Leave the not-yet-fixed interfaces (the newly added ones) in the diagram annotated with their issue IDs.

---

### SYS2-14 (L2) — Creating the flowcharts

- **ASPICE BP:** SYS.2 BP3
- **Purpose:** Draw the branches of the trigger decision, the frequency control, the response processing and the error handling without omission, reaching a state in which missing or contradictory requirements can be detected.
- **Work content:** Carry out works a–l, create the flowcharts (fixed version) for the target processes and confirm their consistency with the requirements list.
- **Input deliverables:** Use case descriptions (fixed version), requirements list (fixed version), screen transition diagram (fixed version), trigger condition definition document (revised version)
- **Input source:** Own department (deliverables of the preceding step) / IVI development department
- **Output deliverables:** Flowcharts (trigger decision / frequency control / response processing / error handling), branch coverage confirmation results, results of the cross-check against the requirements
- **Granularity / completeness:** Fixed version: reviewed by the IVI development department
- **Predecessor / Successor:** Predecessor: SYS2-10, SYS2-12, SYS2-11 / Successor: SYS2-15, SYS2-16
- **Entry:** The requirements list and the screen transition diagram are at the fixed version.
- **Exit (DoD):** The flowcharts for the target processes are fixed, and the omissions and contradictions have been resolved through the cross-check against the requirements list.
- **Concrete examples:** (see the activities beneath) The branches of the trigger decision, the priority order of the suppression conditions, the frequency / re-presentation control, the degraded branch when data is missing

#### SYS2-14-a — Select the target processes for the flowcharts

- **ASPICE BP:** SYS.2 BP3
- **Purpose:** Choose the processes for which flowcharts are to be made, to prevent making too many or too few.
- **Work content:** Select as targets the processes whose branching is complex and prone to misunderstanding, and state explicitly the processes excluded and the reason.
- **Input deliverables:** Use case descriptions (fixed version), requirements list (fixed version), function block list
- **Input source:** Own department (deliverables of the preceding step) / IVI development department
- **Output deliverables:** Flow-creation target list (target process × selection reason × excluded process × reason)
- **Granularity / completeness:** Fixed version: agreed with the IVI development department
- **Predecessor / Successor:** Predecessor: SYS2-10-n, SYS2-12-p / Successor: SYS2-14-b–h
- **Entry:** The requirements list is at the fixed version.
- **Exit (DoD):** ① The target processes have been selected and the reason is stated. ② The excluded processes and the reason are stated explicitly.
- **Concrete examples:** ① Select as targets the trigger decision, the frequency / re-presentation control, the response processing, the degraded processing when data is missing, and the trip-boundary processing. ② Exclude simple display processing (displaying the settings screen) because it has no branching, and state the reason. ③ Estimate the expected number of diagrams per target process, to grasp the volume of work.

#### SYS2-14-b — Define the notation and the granularity

- **ASPICE BP:** SYS.2 BP3
- **Purpose:** Unify the notation and the granularity so that the way of reading is aligned across departments.
- **Work content:** Define the symbols to be used, how branches are written, the granularity (one process ≈ one to a few requirements) and the naming rules, and create one description example.
- **Input deliverables:** The IVI development department's existing notation, flow-creation target list
- **Input source:** Own department (deliverables of the preceding step) / IVI development department
- **Output deliverables:** Flowchart description guide (symbols, granularity, naming rules, description example)
- **Granularity / completeness:** Fixed version: agreed with the IVI development department
- **Predecessor / Successor:** Predecessor: SYS2-14-a / Successor: SYS2-14-c–h
- **Entry:** The target processes have been selected.
- **Exit (DoD):** ① The symbols and the way of writing branches are defined. ② The criterion for granularity is illustrated with an example. ③ There is one description example.
- **Concrete examples:** ① Make decisions diamonds, processes rectangles and external data acquisition a separate symbol, and make it a rule that a branch condition is always written as a decision expression or a conditional statement. ② Make the granularity a unit corresponding to one to a few requirements of the form "the system shall …", with a criterion of not going down into internal processing that is too fine. ③ As a description example, make a simple flow for the frequency control, to serve as the model for the review.

#### SYS2-14-c — Create the trigger-decision flow

- **ASPICE BP:** SYS.2 BP3
- **Purpose:** Draw the branches of the trigger decision and detect missing conditions.
- **Work content:** Create the trigger-decision flow, including the measurement of continuous driving time, the threshold decision, the facility-distance decision and the handling of the fatigue estimation.
- **Input deliverables:** Requirements list (trigger / frequency-control portion), condition allocation table, trigger condition definition document (revised version), flowchart description guide
- **Input source:** Own department (deliverables of the preceding step) / IVI development department
- **Output deliverables:** Trigger-decision flowchart
- **Granularity / completeness:** Rough version: before review
- **Predecessor / Successor:** Predecessor: SYS2-14-b, SYS2-12-c, SYS2-10-h / Successor: SYS2-14-d, SYS2-14-i
- **Entry:** The requirements for the trigger conditions are fixed.
- **Exit (DoD):** ① The branches from the entry of the decision through to the display of the proposal are drawn. ② The condition on each branch is written as a number or a conditional statement. ③ The undecided conditions are annotated with the assumed value and the issue ID.
- **Concrete examples:** ① Draw the flow: measurement start (start of driving) → accumulation (accumulation stops on a traffic-jam decision) → threshold-reached decision → facility-distance decision → proposal. ② Show the branch that uses the fatigue estimation with a dashed line because it is awaiting conditions, and annotate that it is not taken in the initial release. ③ State the value of each decision (90 minutes, 30 km) explicitly in the diagram, and attach an issue ID to the undecided values.

#### SYS2-14-d — Draw the decision order of the suppression conditions

- **ASPICE BP:** SYS.2 BP3
- **Purpose:** Draw the decision order and the priority relationships of the suppression conditions.
- **Work content:** Draw the decision order of the suppression conditions such as just before the destination, having just rested, on a call, a vehicle warning being active, and not being in motion.
- **Input deliverables:** Requirements list (trigger / display portion), driving-restriction definition, interruption / priority-order definition, trigger-decision flowchart
- **Input source:** Own department (deliverables of the preceding step) / IVI development department
- **Output deliverables:** Suppression-condition decision flow (version integrated into the trigger-decision flow)
- **Granularity / completeness:** Rough version: before review
- **Predecessor / Successor:** Predecessor: SYS2-14-c, SYS2-11-j / Successor: SYS2-14-i, SYS2-14-j
- **Entry:** The suppression conditions have been turned into requirements.
- **Exit (DoD):** ① All suppression conditions are drawn as decisions. ② The decision order has been decided. ③ The behaviour on suppression (do nothing / set a re-decision time) is drawn.
- **Concrete examples:** ① Make the order such that a vehicle warning being active or an incoming call is decided before any other condition and suppresses. ② Draw "within 10 minutes of the destination" and "has just rested (stopped for 15 minutes or more within the last 30 minutes)" as suppression conditions. ③ Make clear in the diagram when the next decision is made if suppressed (from the next decision cycle / when the condition is released).

#### SYS2-14-e — Create the frequency / interval control flow

- **ASPICE BP:** SYS.2 BP3
- **Purpose:** Draw the control of the number of proposals and their interval, making the implementation of annoyance suppression clear.
- **Work content:** Create the control flow reflecting the upper limit on the number of proposals per trip, the minimum interval, and the change of frequency by user setting.
- **Input deliverables:** Requirements list (trigger / frequency-control portion, settings portion), frequency / interval rule definition
- **Input source:** Own department (deliverables of the preceding step) / IVI development department
- **Output deliverables:** Frequency / interval control flowchart
- **Granularity / completeness:** Rough version: before review
- **Predecessor / Successor:** Predecessor: SYS2-14-b, SYS2-12-c, SYS2-12-g / Successor: SYS2-14-i, SYS2-14-j
- **Entry:** The frequency rules have been turned into requirements.
- **Exit (DoD):** ① The decisions on the count limit and the minimum interval are drawn. ② The branch by setting value is drawn. ③ The place where the count is updated is made explicit.
- **Concrete examples:** ① Draw the branch that, immediately before displaying a proposal, decides on the count limit and the time elapsed since the previous proposal. ② Express, as a branch or as a parameter, how the limit and the interval change when the setting is "fewer". ③ Make explicit the place where the proposal count is incremented (at display or at acceptance), and make it match the requirements.

#### SYS2-14-f — Create the response-processing flow

- **ASPICE BP:** SYS.2 BP3
- **Purpose:** Draw the processing after a response (Yes / Later / no response).
- **Work content:** Draw the subsequent processing for each response type (waypoint setting, re-presentation reservation, history update, screen transition).
- **Input deliverables:** Use case descriptions (alternative flows), screen transition diagram (fixed version), requirements list (operation / display portion)
- **Input source:** Own department (deliverables of the preceding step) / IVI development department
- **Output deliverables:** Response-processing flowchart
- **Granularity / completeness:** Rough version: before review
- **Predecessor / Successor:** Predecessor: SYS2-14-b, SYS2-10-e, SYS2-11-h / Successor: SYS2-14-i, SYS2-14-j
- **Entry:** The screen transition diagram is at the fixed version.
- **Exit (DoD):** ① The branch for each response type is drawn. ② Whether there is a re-presentation reservation is drawn. ③ The places where the history and the state are updated are made explicit.
- **Concrete examples:** ① Draw the flow "Yes" → waypoint setting → guidance update → history update → end of proposal. ② Draw the flow "Later" → set the re-presentation time → end of proposal, and annotate how the re-presentation time is calculated. ③ Draw the flow no response → automatic dismissal after a fixed time → application of the re-presentation rule.

#### SYS2-14-g — Create the degraded / error-handling flow

- **ASPICE BP:** SYS.2 BP3
- **Purpose:** Draw the degraded branches for missing data and error situations.
- **Work content:** Draw how the decision and the display switch when the vehicle signals, the fatigue estimation or the facility information cannot be obtained.
- **Input deliverables:** Use case descriptions (exception flows), requirements list (data reception / degradation portion), error / degraded screen definition
- **Input source:** Own department (deliverables of the preceding step) / IVI development department
- **Output deliverables:** Degraded / error-handling flowchart
- **Granularity / completeness:** Rough version: before review
- **Predecessor / Successor:** Predecessor: SYS2-14-b, SYS2-12-f, SYS2-11-k, SYS2-10-f / Successor: SYS2-14-i, SYS2-14-j
- **Entry:** The degraded behaviour has been turned into requirements.
- **Exit (DoD):** ① The missing-data branch for each data type is drawn. ② The display content while degraded is drawn. ③ The recovery conditions are drawn.
- **Concrete examples:** ① Draw as a branch: vehicle speed unobtainable for a fixed time → switch to time-based decision. ② Draw as a branch: facility information unobtainable → display only the proposal wording without the facility name. ③ Draw the condition for returning to the normal decision after the signal recovers (from the next decision cycle).

#### SYS2-14-h — Create the state initialization / retention flow

- **ASPICE BP:** SYS.2 BP3
- **Purpose:** Draw the state handling at start-up, restart and trip boundaries.
- **Work content:** Draw the initialization / retention of the timer, the proposal count and the history at IVI start-up, at engine restart and after a long stop.
- **Input deliverables:** Requirements list (availability / degradation portion), use case descriptions (pre- and post-conditions), system issue list (constraints)
- **Input source:** Own department (deliverables of the preceding step) / IVI development department
- **Output deliverables:** State initialization / retention flowchart
- **Granularity / completeness:** Rough version: before review
- **Predecessor / Successor:** Predecessor: SYS2-14-b, SYS2-12-j, SYS2-10-g / Successor: SYS2-14-i, SYS2-15-h
- **Entry:** The requirements for state retention are fixed.
- **Exit (DoD):** ① The handling of the state is drawn for each of start-up, restart and stopping. ② The initialization conditions are drawn as numbers. ③ The handling when retention is not possible is annotated.
- **Concrete examples:** ① Draw the branch: stopped for 15 minutes or more → initialize the continuous driving time; less than 15 minutes → retain. ② Draw the processing that restores the proposal count at IVI restart, and annotate if there is a constraint that prevents restoration. ③ Draw the handling of the history at the end of the trip (ignition OFF).

#### SYS2-14-i — Confirm the coverage of the branches

- **ASPICE BP:** SYS.2 BP3
- **Purpose:** Confirm the coverage of the branches and detect combinations that are not defined.
- **Work content:** Expand the combinations of decision conditions into a table (a decision table) and detect the combinations that are not defined in the flows.
- **Input deliverables:** The individual flowcharts, requirements list (fixed version)
- **Input source:** Own department (deliverables of the preceding step) / IVI development department
- **Output deliverables:** Branch coverage confirmation results (condition combination × defined or not × action)
- **Granularity / completeness:** Draft version: before review
- **Predecessor / Successor:** Predecessor: SYS2-14-c–h / Successor: SYS2-14-j, SYS2-14-k
- **Entry:** The principal flows have been created.
- **Exit (DoD):** ① The combinations of the principal decisions have been expanded into a table. ② The undefined combinations have been detected. ③ The action (correct the flow / raise an issue) has been decided.
- **Concrete examples:** ① Expand the combinations of the three conditions "threshold reached", "a facility is near" and "a suppression condition applies", and confirm that a result is defined for every pattern. ② If the handling of "the threshold is not reached but the fatigue estimation is high" is undefined, detect it and raise it as an issue. ③ For each undefined pattern detected, decide whether to correct the flow or to add a requirement, and record it.

#### SYS2-14-j — Cross-check the flows against the requirements list

- **ASPICE BP:** SYS.2 BP3
- **Purpose:** Cross-check the flows against the requirements list, and resolve omissions and contradictions.
- **Work content:** Link the requirement IDs corresponding to each process and branch in the flows, detect processes with no requirement and requirements with no process, and resolve them.
- **Input deliverables:** The individual flowcharts, requirements list (fixed version), traceability matrix
- **Input source:** Own department (deliverables of the preceding step)
- **Output deliverables:** Flow × requirement cross-check results (process / branch × requirement ID × excess or shortfall × action)
- **Granularity / completeness:** Draft version: before review
- **Predecessor / Successor:** Predecessor: SYS2-14-c–h, SYS2-12-p / Successor: SYS2-14-k, SYS2-16-e
- **Entry:** The flows and the requirements list are both available.
- **Exit (DoD):** ① A requirement ID is linked to every process and branch (where none applies, this is stated). ② Processes that are in the requirements but not in the flows have been detected. ③ The differences have been resolved or turned into issues.
- **Concrete examples:** ① Write the corresponding requirement ID beside each decision in the diagram, and detect the decisions with no correspondence. ② If "accept a voice response", which is in the requirements list, does not appear in the flows, add a branch to the response-processing flow. ③ Leave the differences that cannot be resolved (those originating in open items) with an issue ID attached.

#### SYS2-14-k — Review the flowcharts with the IVI development department

- **ASPICE BP:** SYS.2 BP3
- **Purpose:** Review the flowcharts with the IVI development department.
- **Work content:** Review the flows with the IVI development department, and raise and reflect omissions, contradictions and excess or shortfall of granularity from the implementation viewpoint.
- **Input deliverables:** The individual flowcharts, branch coverage confirmation results, flow × requirement cross-check results
- **Input source:** IVI development department / own department (facilitation)
- **Output deliverables:** Flow review minutes, flowcharts with the comments reflected
- **Granularity / completeness:** Draft version: review comments reflected
- **Predecessor / Successor:** Predecessor: SYS2-14-i, SYS2-14-j / Successor: SYS2-14-l
- **Entry:** The flows and the confirmation results are both available.
- **Exit (DoD):** ① The IVI development department has reviewed them. ② The comments from the implementation viewpoint have been reflected or turned into issues. ③ The excess or shortfall of granularity has been adjusted.
- **Concrete examples:** ① Correct the diagrams in response to comments on the timing of obtaining the values used in a decision (obtained each time at the decision, or referring to a periodically obtained value). ② When details of internal implementation beyond the scope of requirements definition are demanded, separate them out as being in the scope of the design phase. ③ Add those comments that require a decision to the system issue list.

#### SYS2-14-l — Fix the flowcharts and distribute them

- **ASPICE BP:** SYS.2 BP3
- **Purpose:** Fix the flowcharts and make them the input to the sequence diagrams and the specification-document integration.
- **Work content:** Treat the version with the comments reflected as the fixed version, assign a version number and distribute it.
- **Input deliverables:** Flowcharts with the comments reflected, flow review minutes
- **Input source:** Own department (creation) / IVI development department (confirmation)
- **Output deliverables:** Flowcharts (fixed version, with version numbers)
- **Granularity / completeness:** Fixed version: reviewed by the IVI development department
- **Predecessor / Successor:** Predecessor: SYS2-14-k / Successor: SYS2-15-c, SYS2-16-b
- **Entry:** The review comments have been reflected.
- **Exit (DoD):** ① Version numbers have been assigned. ② The correspondence to the requirement IDs remains in the diagrams. ③ They have been distributed to the related departments.
- **Concrete examples:** ① For each flow, state explicitly the version number and the range of requirement IDs covered. ② Confirm that the assumptions originating in open items (assumed values, issue IDs) remain in the diagrams. ③ Distribute the fixed version and state explicitly that the sequence-diagram creation and the specification-document integration take this version as their baseline.

---

### SYS2-15 (L2) — Creating the sequence diagrams

- **ASPICE BP:** SYS.2 BP3
- **Purpose:** Show the exchanges between domains and between elements in time order, and make the timing, the order, the behaviour in error situations and the interface items clear.
- **Work content:** Carry out works a–l, create the sequence diagrams (fixed version) for the principal scenarios and the interface item list, and agree them with the related domain departments.
- **Input deliverables:** Use case descriptions (fixed version), function allocation diagram and data flow definition (fixed version), flowcharts (fixed version), requirements list (fixed version)
- **Input source:** Own department (deliverables of the preceding step) / IVI development department / ADAS department / vehicle control department / cloud department
- **Output deliverables:** Sequence diagrams (normal / integration / error / conflict), interface item list, consistency confirmation results
- **Granularity / completeness:** Fixed version: reviewed by the related domain departments
- **Predecessor / Successor:** Predecessor: SYS2-13, SYS2-14, SYS2-10 / Successor: SYS2-16
- **Entry:** The function allocation diagram and the flowcharts are at the fixed version.
- **Exit (DoD):** The sequence diagrams for the principal scenarios are fixed, and the interface items are reflected in the requirements list.
- **Concrete examples:** (see the activities beneath) The integration sequence up to the display of the proposal, the behaviour on timeout, conflict with other notifications, the exchanges for state reset

#### SYS2-15-a — Select the target scenarios for the sequence diagrams

- **ASPICE BP:** SYS.2 BP3
- **Purpose:** Select the target scenarios for which sequence diagrams are to be made.
- **Work content:** Among the use cases, select as targets the scenarios in which multiple domains are involved or in which timing becomes an issue.
- **Input deliverables:** Use case descriptions (fixed version), function allocation diagram (fixed version), integration point list
- **Input source:** Own department (deliverables of the preceding step) / IVI development department
- **Output deliverables:** Sequence-creation target list (target scenario × selection reason × involved domains)
- **Granularity / completeness:** Fixed version: agreed with the IVI development department
- **Predecessor / Successor:** Predecessor: SYS2-10-n, SYS2-13-l / Successor: SYS2-15-b–h
- **Entry:** The use cases and the function allocation diagram are at the fixed version.
- **Exit (DoD):** ① The target scenarios have been selected and the reason is stated. ② The involved domains are stated. ③ The excluded scenarios are stated explicitly.
- **Concrete examples:** ① Choose as a target the trigger → display → acceptance of the proposal (in which vehicle control, ADAS, the cloud and the meter are involved). ② Add as targets the timeout of data acquisition, conflict with other notifications, and state reset at trip boundaries. ③ Exclude scenarios that are completed within the IVI and whose order is self-evident (a settings change), and state the reason.

#### SYS2-15-b — Define the participating elements and the notation

- **ASPICE BP:** SYS.2 BP3
- **Purpose:** Unify the participating elements and the notation so that the way of reading the diagrams is aligned.
- **Work content:** Define the elements appearing in the sequence diagrams (the user, the IVI function blocks, the other domains, the cloud) and the notation rules (synchronous / asynchronous, how to write periodic processing).
- **Input deliverables:** Function allocation diagram (fixed version), data flow definition, actor list
- **Input source:** Own department (deliverables of the preceding step) / IVI development department
- **Output deliverables:** Sequence description guide (participating elements, notation rules, description example)
- **Granularity / completeness:** Fixed version: agreed with the IVI development department
- **Predecessor / Successor:** Predecessor: SYS2-15-a, SYS2-13-l, SYS2-13-e, SYS2-10-i / Successor: SYS2-15-c–h
- **Entry:** The element definitions of the function allocation diagram are fixed.
- **Exit (DoD):** ① The participating elements match the function allocation diagram. ② The notation for synchronous / asynchronous and for periodic processing is defined. ③ There is one description example.
- **Concrete examples:** ① Align the participating elements to the user, the IVI (decision, presentation, integration), vehicle control, ADAS, the meter and the cloud, and make them match the block names in the function allocation diagram. ② Make it a rule to express periodic acquisition as a loop annotated "cycle 1 second", and event notifications as asynchronous arrows. ③ As a description example, make a short sequence from vehicle-speed acquisition to the decision, to serve as the model.

#### SYS2-15-c — Create the normal-case sequence from trigger to display

- **ASPICE BP:** SYS.2 BP3
- **Purpose:** Create the normal-case sequence from the triggering of the proposal to its display.
- **Work content:** Draw, in time order, the order from data acquisition, the decision, the presentation, through to the invocation of the notification means.
- **Input deliverables:** Flowcharts (trigger decision, frequency control), requirements list (trigger / display portion), sequence description guide
- **Input source:** Own department (deliverables of the preceding step) / IVI development department
- **Output deliverables:** Normal-case sequence diagram (trigger → display)
- **Granularity / completeness:** Rough version: before review
- **Predecessor / Successor:** Predecessor: SYS2-15-b, SYS2-14-l, SYS2-12-c / Successor: SYS2-15-d, SYS2-15-i
- **Entry:** The flowcharts are at the fixed version.
- **Exit (DoD):** ① The order from data acquisition to display is drawn. ② The data items are stated on each message. ③ It does not contradict the branches of the flowcharts.
- **Concrete examples:** ① Draw the order: vehicle-speed acquisition from vehicle control (periodic) → time accumulation in the IVI → threshold reached → facility-information request to the cloud → response → proposal display. ② State the data items (vehicle speed, facility list) explicitly on the messages. ③ Where a display request to the meter is needed, add the message to the meter.

#### SYS2-15-d — Annotate the timing and duration constraints

- **ASPICE BP:** SYS.2 BP3
- **Purpose:** Make the timing and duration constraints explicit in the diagrams.
- **Work content:** Annotate the cycles, the waiting times, the timeout values and the permissible delay until display on the sequence diagrams.
- **Input deliverables:** Normal-case sequence diagram, non-functional requirements (performance, responsiveness), data quality evaluation table
- **Input source:** Own department (deliverables of the preceding step) / IVI development department
- **Output deliverables:** Sequence diagram with timing annotations
- **Granularity / completeness:** Rough version: before review
- **Predecessor / Successor:** Predecessor: SYS2-15-c, SYS2-12-i / Successor: SYS2-15-f, SYS2-15-i
- **Entry:** The non-functional requirements relating to performance are fixed.
- **Exit (DoD):** ① The cycles and the timeout values are annotated in the diagram. ② The permissible delay until display is drawn. ③ The not-yet-fixed values carry the assumption and the issue ID.
- **Concrete examples:** ① Annotate the cycle of vehicle-speed acquisition (1 second) and the timeout of the facility-information request (e.g. 3 seconds). ② Draw the permissible delay from the trigger condition being met to the display (within 2 seconds) as an interval. ③ Where the timeout value is undecided, annotate the assumed value and the issue ID, and state that it will be revisited after measurement.

#### SYS2-15-e — Create the integration sequence for data acquisition

- **ASPICE BP:** SYS.2 BP3
- **Purpose:** Create the sequence for acquiring data from the other domains, and make the interface assumptions clear.
- **Work content:** For the acquisition of the vehicle signals, the fatigue estimation and the facility information, draw the distinction between request/response and notification type, and the trigger for each.
- **Input deliverables:** Data flow definition, interface candidate list, requirements list (data reception portion)
- **Input source:** Own department (deliverables of the preceding step) / IVI development department / the related domain departments
- **Output deliverables:** Integration sequence diagram (data acquisition)
- **Granularity / completeness:** Rough version: before confirmation by the related domains
- **Predecessor / Successor:** Predecessor: SYS2-15-b, SYS2-13-f, SYS2-12-f / Successor: SYS2-15-i, SYS2-15-j
- **Entry:** The interface candidates have been organized.
- **Exit (DoD):** ① The acquisition method is drawn for each data type. ② The trigger (periodic / event / on request) is made explicit. ③ Whether it can be realized with an existing IF is annotated.
- **Concrete examples:** ① Draw vehicle speed and shift position as a periodic subscription on an existing API. ② Draw the fatigue-estimation result as an event notification from the ADAS, and annotate that a new IF needs to be added. ③ Draw the facility information as a request/response from the IVI to the cloud, and connect it to the following error case when communication is unavailable.

#### SYS2-15-f — Create the error-case sequences

- **ASPICE BP:** SYS.2 BP3
- **Purpose:** Create the error-case sequences for timeout, loss of communication and no response.
- **Work content:** Draw, in time order, the degraded behaviour in the case of failure, delay or abnormal values in data acquisition.
- **Input deliverables:** Sequence diagram with timing annotations, degraded / error-handling flowchart, requirements list (degradation portion)
- **Input source:** Own department (deliverables of the preceding step) / IVI development department
- **Output deliverables:** Error-case sequence diagrams
- **Granularity / completeness:** Rough version: before review
- **Predecessor / Successor:** Predecessor: SYS2-15-d, SYS2-14-g, SYS2-10-f / Successor: SYS2-15-i, SYS2-15-j
- **Entry:** The degraded behaviour has been turned into requirements and drawn.
- **Exit (DoD):** ① The principal errors are drawn in time order. ② The behaviour after degradation is drawn. ③ The trigger for recovery is drawn.
- **Concrete examples:** ① Draw the sequence in which, when the facility-information request times out, the proposal is displayed without the facility name. ② Draw the sequence in which, when the vehicle speed cannot be obtained for a fixed time, the decision switches to time-based. ③ Draw the trigger for returning to the normal decision when the signal recovers.

#### SYS2-15-g — Create the conflict sequences

- **ASPICE BP:** SYS.2 BP3
- **Purpose:** Create the sequences for the case of conflict with other notifications or other functions.
- **Work content:** Draw the order and the priority control when a vehicle warning, an incoming call or a guidance turn coincides with the display of the proposal.
- **Input deliverables:** Interruption / priority-order definition, definition of the expression per notification means, requirements list (display / notification portion)
- **Input source:** Own department (deliverables of the preceding step) / IVI development department / the meter department
- **Output deliverables:** Conflict sequence diagrams
- **Granularity / completeness:** Rough version: before review
- **Predecessor / Successor:** Predecessor: SYS2-15-b, SYS2-11-i, SYS2-11-d / Successor: SYS2-15-i, SYS2-15-j
- **Entry:** The interruptions and the priority order are defined.
- **Exit (DoD):** ① The principal conflict cases are drawn. ② The party that makes the priority-control judgement is made explicit. ③ The handling of the proposal (interrupt / delay / discard) is drawn.
- **Concrete examples:** ① Draw the sequence in which, when a vehicle warning occurs while a proposal is being displayed, the proposal is ended immediately. ② Draw the exchanges for expression consistency when the IVI makes a proposal while a fatigue warning is being displayed on the meter side. ③ Where an interrupted proposal is to be re-presented, draw the re-presentation reservation message.

#### SYS2-15-h — Create the state management sequences

- **ASPICE BP:** SYS.2 BP3
- **Purpose:** Draw the exchanges relating to the reset and the retention of state.
- **Work content:** Draw the exchanges for state initialization and retention at trip start and end, at IVI restart and on a long stop.
- **Input deliverables:** State initialization / retention flowchart, requirements list (availability / degradation portion)
- **Input source:** Own department (deliverables of the preceding step) / IVI development department
- **Output deliverables:** State management sequence diagram
- **Granularity / completeness:** Rough version: before review
- **Predecessor / Successor:** Predecessor: SYS2-15-b, SYS2-14-h / Successor: SYS2-15-i
- **Entry:** The requirements and the flow for state retention are fixed.
- **Exit (DoD):** ① The exchanges at start-up, at end and at restart are drawn. ② The information to be retained is made explicit. ③ The handling when retention is not possible is annotated.
- **Concrete examples:** ① Draw the sequence in which, on ignition ON, the IVI reads out the saved proposal count and timer. ② Draw the sequence in which a stop of 15 minutes or more is detected and the timer is initialized. ③ Annotate the handling when the storage area is unavailable (initialize and continue).

#### SYS2-15-i — Extract the interface items from the sequences and reflect them in the requirements

- **ASPICE BP:** SYS.2 BP3
- **Purpose:** Extract the interface items from the sequences and reflect them in the requirements.
- **Work content:** Extract the data items, direction, trigger and timeout of each message as an interface item list, and confirm the excess or shortfall against the requirements list.
- **Input deliverables:** The individual sequence diagrams, requirements list (fixed version), interface candidate list
- **Input source:** Own department (deliverables of the preceding step) / IVI development department
- **Output deliverables:** Interface item list (message × item × direction × trigger × timeout × related requirement ID)
- **Granularity / completeness:** Draft version: before review
- **Predecessor / Successor:** Predecessor: SYS2-15-c–h, SYS2-12-p / Successor: SYS2-15-j, SYS2-16-e
- **Entry:** A full set of sequence diagrams has been created.
- **Exit (DoD):** ① All messages have been listed. ② The excess or shortfall against the requirements list has been confirmed. ③ The shortfalls have been registered as added requirements or as issues.
- **Concrete examples:** ① List "fatigue-estimation result (value, confidence, timestamp)" as the message items from the ADAS to the IVI. ② Detect the items for which there is no corresponding requirement in the requirements list (the handling of the confidence value) and either add a requirement or raise an issue. ③ Leave the items whose timeout value is undecided with an issue ID attached.

#### SYS2-15-j — Confirm consistency with the function allocation diagram, the flowcharts and the screen transition diagram

- **ASPICE BP:** SYS.2 BP3
- **Purpose:** Confirm consistency with the function allocation diagram, the flowcharts and the screen transition diagram.
- **Work content:** Confirm that the participating elements, the branches and the screen-display timing in the sequence diagrams do not contradict the other diagrams, and resolve the differences.
- **Input deliverables:** The individual sequence diagrams, function allocation diagram (fixed version), flowcharts (fixed version), screen transition diagram (fixed version)
- **Input source:** Own department (deliverables of the preceding step)
- **Output deliverables:** Inter-diagram consistency confirmation results (confirmation viewpoint × difference × action)
- **Granularity / completeness:** Draft version: before review
- **Predecessor / Successor:** Predecessor: SYS2-15-e, SYS2-15-f, SYS2-15-g, SYS2-15-i / Successor: SYS2-15-k, SYS2-16-e
- **Entry:** Each of the diagrams is at the fixed version.
- **Exit (DoD):** ① The participating elements match the function allocation diagram. ② The branches match the flowcharts. ③ The display timing matches the screen transition diagram.
- **Concrete examples:** ① Confirm whether the function block names appearing in the sequence diagrams use exactly the same notation as the function allocation diagram. ② Confirm whether the branch conditions of the error-case sequences match the branches of the degraded flow. ③ Confirm whether the timing of displaying and dismissing the proposal contradicts the transition conditions of the screen transition diagram.

#### SYS2-15-k — Review the sequence diagrams with the related domain departments

- **ASPICE BP:** SYS.2 BP3
- **Purpose:** Review the sequence diagrams with the related domain departments.
- **Work content:** Review the sequences with the IVI development department and the related domain departments, and confirm the feasibility and the appropriateness of the triggers and the timing.
- **Input deliverables:** The individual sequence diagrams, interface item list, inter-diagram consistency confirmation results
- **Input source:** IVI development department / ADAS department / vehicle control department / cloud department / own department (facilitation)
- **Output deliverables:** Sequence review minutes, sequence diagrams with the comments reflected
- **Granularity / completeness:** Draft version: review comments reflected
- **Predecessor / Successor:** Predecessor: SYS2-15-i, SYS2-15-j / Successor: SYS2-15-l
- **Entry:** The sequence diagrams and the interface item list are both available.
- **Exit (DoD):** ① The related domain departments have reviewed them. ② The appropriateness of the triggers, the cycles and the timeouts has been confirmed. ③ The comments have been reflected or turned into issues.
- **Concrete examples:** ① Confirm with the ADAS department the notification trigger of the fatigue-estimation result (periodic or event), and if it differs from the assumption, correct the diagrams. ② Confirm with the cloud department the actual achievable response time for the facility information, and judge the appropriateness of the timeout value. ③ Connect comments about infeasibility to a revision of the allocation or the requirements, and record them as issues.

#### SYS2-15-l — Fix the sequence diagrams and distribute them

- **ASPICE BP:** SYS.2 BP3
- **Purpose:** Fix the sequence diagrams and make them the input to the specification-document integration.
- **Work content:** Treat the version with the comments reflected as the fixed version, assign a version number and distribute it together with the interface item list.
- **Input deliverables:** Sequence diagrams with the comments reflected, interface item list, sequence review minutes
- **Input source:** Own department (creation) / IVI development department (confirmation)
- **Output deliverables:** Sequence diagrams (fixed version), interface item list (fixed version)
- **Granularity / completeness:** Fixed version: reviewed by the related domain departments
- **Predecessor / Successor:** Predecessor: SYS2-15-k / Successor: SYS2-16-b, SYS2-16-e
- **Entry:** The review comments have been reflected.
- **Exit (DoD):** ① A version number has been assigned. ② The interface item list is linked to the requirements list. ③ It has been distributed to the related departments.
- **Concrete examples:** ① Version-number the sequence diagrams and the interface item list as a single set. ② Attach the related requirement IDs to the interface items, so that they can be used for traceability at specification-document integration. ③ Leave the not-yet-fixed timeout values and new IFs in the diagrams with their issue IDs.

---

### SYS2-16 (L2) — Integrating, reviewing and reflecting the PoC results into the system requirements specification (provisional)

- **ASPICE BP:** SYS.2 BP4–BP8
- **Purpose:** Integrate the individual deliverables into a single specification document, confirm its consistency and verifiability, then reflect the prototype / PoC results, baseline it, and communicate it to the related departments and the vendors.
- **Work content:** Carry out works a–p, baseline the system requirements specification (draft version), and distribute and explain it.
- **Input deliverables:** Use case descriptions, screen specification, requirements list, function allocation diagram, flowcharts, sequence diagrams (each at the fixed version), system issue list (fixed version), traceability matrix
- **Input source:** Own department (deliverables of the preceding step) / IVI development department / the related domain departments / the legal, security and quality-assurance departments
- **Output deliverables:** System requirements specification (draft version, baselined), traceability matrix (integrated version), PoC / prototype plan and record of the reflected results, review records, distribution and explanation records
- **Granularity / completeness:** Draft version: reviewed by the related departments and baselined (on the premise of further detailing in the design phase)
- **Predecessor / Successor:** Predecessor: SYS2-10–SYS2-15 / Successor: the following phases (architecture design, vendor selection)
- **Entry:** Each of the deliverables is at the fixed version.
- **Exit (DoD):** The system requirements specification (draft version) has been baselined and has been distributed to and explained to the related departments and the vendors together with the change-management rules.
- **Concrete examples:** (see the activities beneath) Integration of the deliverables, the consistency and verifiability checks, the PoC plan for the purpose of verifying requirements and the reflection of its results, baselining and communication

#### SYS2-16-a — Decide the structure of the specification document

- **ASPICE BP:** SYS.2 BP4
- **Purpose:** Decide the structure of the specification document, so that readers can reach the parts they need.
- **Work content:** Design the table of contents, the chapter structure, the scope of responsibility of each chapter and the description granularity, and agree them with the related departments.
- **Input deliverables:** The individual deliverables (fixed version), the IVI development department's existing specification template, internal standards (if any)
- **Input source:** Own department (deliverables of the preceding step) / IVI development department
- **Output deliverables:** Draft specification structure (table of contents, chapter structure, content of each chapter, granularity)
- **Granularity / completeness:** Fixed version: agreed with the IVI development department
- **Predecessor / Successor:** Predecessor: SYS2-12-p / Successor: SYS2-16-b, SYS2-16-c
- **Entry:** The requirements list is at the fixed version.
- **Exit (DoD):** ① The table of contents and the content of each chapter are defined. ② The readers (the vendors, the related domains) are assumed. ③ The differences from the existing template have been organized.
- **Concrete examples:** ① Make the chapter structure: purpose and scope / assumptions and constraints / terminology / use cases / screens and HMI / functional requirements / non-functional requirements / function allocation and interfaces / processing flows and sequences / open issues / appendix (traceability). ② Distinguish the chapters the development vendor uses for estimation (the requirements list, the interfaces) from those used for internal agreement (the assumptions, the open issues). ③ State explicitly the reason for adding a chapter that is not in the existing template (the open issues).

#### SYS2-16-b — Integrate the deliverables into a single specification document

- **ASPICE BP:** SYS.2 BP4
- **Purpose:** Integrate the individual deliverables into a single specification document, and make the cross-references work.
- **Work content:** Integrate the fixed versions of the deliverables along the chapter structure, and unify the figure/table numbers, the reference links and the ID notation.
- **Input deliverables:** Use case descriptions, screen specification, requirements list, function allocation diagram, flowcharts, sequence diagrams (each at the fixed version), draft specification structure
- **Input source:** Own department (deliverables of the preceding step)
- **Output deliverables:** System requirements specification (integrated draft)
- **Granularity / completeness:** Rough version: integrated by the planning owner, before review
- **Predecessor / Successor:** Predecessor: SYS2-16-a, SYS2-10-n, SYS2-11-n, SYS2-12-p, SYS2-13-l, SYS2-14-l, SYS2-15-l / Successor: SYS2-16-d, SYS2-16-e
- **Entry:** Each of the deliverables is at the fixed version.
- **Exit (DoD):** ① All deliverables have been integrated into the corresponding chapters. ② The figure/table numbers and the ID notation are unified. ③ The cross-references between chapters work.
- **Concrete examples:** ① From each requirement in the requirements list, place references to the figure/table numbers of the corresponding use case, screen and flow. ② Unify the notational inconsistencies in UC-IDs, REQ-IDs, screen IDs and issue IDs (full-width vs half-width, prefixes). ③ Confirm in a list the source version number of each chapter, so that no deliverable at an old version is mixed in at integration.

#### SYS2-16-c — State the assumptions, constraints and out-of-scope items explicitly

- **ASPICE BP:** SYS.2 BP4
- **Purpose:** State the assumptions, the constraints and the out-of-scope items explicitly, and narrow the room for interpretation.
- **Work content:** State explicitly in the specification document the preconditions, the constraints, the functions outside the initial scope, and the matters to be decided in the following phases.
- **Input deliverables:** Constraint / assumption reflection table, system issue list (fixed version), scope sorting table, responsibility demarcation list
- **Input source:** Own department (deliverables of the preceding step)
- **Output deliverables:** The "Assumptions and constraints" chapter of the specification document, out-of-scope list
- **Granularity / completeness:** Draft version: before review
- **Predecessor / Successor:** Predecessor: SYS2-16-a, SYS2-12-m, SYS2-13-i, SYS1-06-n / Successor: SYS2-16-e, SYS2-16-l
- **Entry:** The places where the constraints and the assumptions are to be reflected have been decided.
- **Exit (DoD):** ① The assumptions and the constraints have been listed. ② The out-of-scope functions are stated explicitly. ③ The matters to be decided in the following phases are stated explicitly.
- **Concrete examples:** ① State as assumptions that "the target vehicle models come with a DCM as standard" and that "the operations department confirms the facility information weekly". ② State facility reservation, rear-seat display and smartphone-linked display explicitly as out of scope, and annotate how future support is handled. ③ State explicitly that the visual design, the detailed internal implementation and the regulatory-certification procedures are outside the scope of this document and will be handled subsequently.

#### SYS2-16-d — Unify the terminology and the abbreviations

- **ASPICE BP:** SYS.2 BP4
- **Purpose:** Unify the terminology and the abbreviations, and prevent misunderstanding between departments.
- **Work content:** Cross-check the terminology across the deliverables to integrate the glossary, and reflect the notational inconsistencies in the body text.
- **Input deliverables:** Glossary (planning-assumption organization document), integrated draft, the individual deliverables
- **Input source:** Own department (deliverables of the preceding step)
- **Output deliverables:** The "Terminology" chapter of the specification document (integrated glossary), record of the notational corrections
- **Granularity / completeness:** Draft version: before review
- **Predecessor / Successor:** Predecessor: SYS2-16-b, SYS1-01-m / Successor: SYS2-16-e
- **Entry:** The integrated draft has been created.
- **Exit (DoD):** ① The principal terms are defined. ② The notational inconsistencies have been reflected in the body text. ③ Words whose meaning differs between domains are annotated.
- **Concrete examples:** ① Define the distinct usage of "proposal", "notification" and "warning", and correct the misuses in the body text. ② State the decision conditions for "in motion", "stopped" and "parked" explicitly in the glossary, and make them match the conditions in the requirement statements. ③ Where the meter side and the IVI side use different names (the expression of the warning levels), attach a correspondence table.

#### SYS2-16-e — Confirm the consistency between the deliverables

- **ASPICE BP:** SYS.2 BP7
- **Purpose:** Confirm the consistency between the deliverables and resolve the contradictions.
- **Work content:** Confirm and resolve the contradictions in the conditions, values, order and names between the requirements, the use cases, the screens, the flows, the sequences and the allocation diagram.
- **Input deliverables:** Integrated draft, flow × requirement cross-check results, inter-diagram consistency confirmation results, non-functional consistency confirmation results, interface item list
- **Input source:** Own department (deliverables of the preceding step) / IVI development department
- **Output deliverables:** Consistency confirmation results (confirmation viewpoint × inconsistency × action × place reflected)
- **Granularity / completeness:** Draft version: before review
- **Predecessor / Successor:** Predecessor: SYS2-16-b, SYS2-14-j, SYS2-15-j, SYS2-13-j, SYS2-15-i / Successor: SYS2-16-f, SYS2-16-l
- **Entry:** The integrated draft has been created.
- **Exit (DoD):** ① Consistency has been confirmed for the principal confirmation viewpoints. ② The inconsistencies detected have been resolved or turned into issues. ③ The results of the resolution have been reflected in the body text.
- **Concrete examples:** ① Confirm whether the numerical values of the trigger conditions match across the requirements list, the flowcharts and the use cases. ② Confirm whether the transition conditions of the screen transition diagram contradict the display timing of the sequence diagrams. ③ Confirm whether the block names in the function allocation diagram match the names of the participating elements in the sequence diagrams.

#### SYS2-16-f — Make the traceability work end to end

- **ASPICE BP:** SYS.2 BP7
- **Purpose:** Make the traceability work end to end, and detect requirements without grounds and planning items that are not realized.
- **Work content:** Integrate the traceability matrix from planning → use case → requirement → diagram → issue, and detect the items that are traced in only one direction.
- **Input deliverables:** Traceability matrix, integrated draft, system issue list (fixed version)
- **Input source:** Own department (deliverables of the preceding step)
- **Output deliverables:** Traceability matrix (integrated version), omission detection results
- **Granularity / completeness:** Draft version: before review
- **Predecessor / Successor:** Predecessor: SYS2-16-e, SYS2-12-o / Successor: SYS2-16-g, SYS2-16-n
- **Entry:** The requirements and the diagrams have been integrated.
- **Exit (DoD):** ① The trace relationships from planning through to the issues have been listed. ② Requirements without grounds have been detected. ③ Planning items that have not been carried down into requirements have been detected.
- **Concrete examples:** ① Confirm whether a requirement exists corresponding to each value proposition in the planning document, and if there is a value with no correspondence (the suppression of annoyance), consider adding a requirement. ② Detect the requirements that are not linked to any use case or issue, re-confirm their necessity, and either delete them or supply the grounds. ③ Extract the requirements linked to open issues and list them as the update targets for when the issues are closed.

#### SYS2-16-g — Confirm the verifiability of each requirement

- **ASPICE BP:** SYS.2 BP3・BP7
- **Purpose:** Confirm whether each requirement is verifiable, and put the acceptance conditions in order.
- **Work content:** For each requirement, confirm "how it can be checked so that pass/fail can be judged", and rewrite those whose acceptance conditions are insufficient.
- **Input deliverables:** Integrated draft (requirements list chapter), traceability matrix (integrated version), the quality-assurance department's confirmation viewpoints
- **Input source:** Own department (deliverables of the preceding step) / quality-assurance department / IVI development department
- **Output deliverables:** Verifiability check results (REQ-ID × verification method × acceptance conditions adequate or not × content of the correction)
- **Granularity / completeness:** Draft version: before review
- **Predecessor / Successor:** Predecessor: SYS2-16-f / Successor: SYS2-16-h, SYS2-16-l
- **Entry:** Acceptance conditions have been attached to the requirements list.
- **Exit (DoD):** ① A verification method is assumed for every requirement. ② The requirements whose acceptance conditions were insufficient have been corrected. ③ The requirements that can only be checked on an actual vehicle have been identified.
- **Concrete examples:** ① Rewrite unverifiable requirements such as "shall not make the driver feel annoyed" into requirements on a frequency cap or on providing a setting. ② For "delay until display within 2 seconds", add the measurement method (the definition of the moment the trigger condition is met) to the acceptance conditions. ③ Identify the requirements that can only be checked by driving an actual vehicle (the appropriateness of the traffic-jam decision) and register them as issues for the verification plan.

#### SYS2-16-h — Plan the prototype / PoC for confirming the validity of the requirements

- **ASPICE BP:** SYS.2 BP3
- **Purpose:** Plan the prototype / PoC for confirming the validity of the requirements.
- **Work content:** Taking as targets those matters among the assumed values, the validity of the experience and the technical feasibility that cannot be settled on paper, plan the verification purpose, method, scope of execution and criteria for judgement.
- **Input deliverables:** System issue list (open issues), verifiability check results, requirements list (requirements carrying assumed values), experience scenario document
- **Input source:** Own department (deliverables of the preceding step) / IVI development department
- **Output deliverables:** Requirement-verification PoC / prototype plan (verification item × purpose × method × scope × criteria for judgement × deadline)
- **Granularity / completeness:** Fixed version: approved by the planning owner and the IVI development department
- **Predecessor / Successor:** Predecessor: SYS2-16-g, SYS1-09-l / Successor: SYS2-16-i
- **Entry:** The open issues and the assumed values have been identified.
- **Exit (DoD):** ① The verification targets are linked to requirements and issues. ② The method and the criteria for judgement are defined. ③ The schedule fits within the planned completion of requirements definition.
- **Concrete examples:** ① Verify the appropriateness of the trigger-condition threshold (90 minutes or 120 minutes) by having several people experience it on an actual vehicle or in a driving simulator. ② Confirm the layout and the character-count limit of the proposal display on an actual-device mock, with legibility under driving-equivalent conditions as the criterion for judgement. ③ Technically verify on a bench whether the fatigue-estimation result can be obtained and with what delay, to confirm the assumption behind the timeout value.

#### SYS2-16-i — Receive the PoC / prototype results and sort out their impact on the requirements

- **ASPICE BP:** SYS.2 BP3
- **Purpose:** Receive the PoC / prototype results and sort out their impact on the requirements.
- **Work content:** Receive the results of the execution and sort them into those that allow a requirement value to be fixed, those that require the requirement to be revised, and those that require additional verification.
- **Input deliverables:** Requirement-verification PoC / prototype plan, PoC execution results (received from the executing department)
- **Input source:** IVI development department / external parties (test subjects, verification environments) / own department (deliverables of the preceding step)
- **Output deliverables:** Sorting table of the existing verification results (verification item × result × judgement × impact on the requirements × action)
- **Granularity / completeness:** Fixed version: fixed as the results
- **Predecessor / Successor:** Predecessor: SYS2-16-h / Successor: SYS2-16-j, SYS2-16-k
- **Entry:** The PoC / prototype has been executed.
- **Exit (DoD):** ① Every verification item has a result and a judgement. ② The impact on the requirements has been identified. ③ The items requiring additional verification are stated explicitly.
- **Concrete examples:** ① If, in the threshold verification, a proposal at 90 minutes was evaluated as "too early", sort it as a target for revising the requirement value. ② If it was judged that the character-count limit is not legible, treat both the display requirement and the screen specification as targets for revision. ③ If the technical verification showed the fatigue-estimation delay exceeding the assumption, treat the timeout value and the degradation requirements as targets for revision, and plan additional verification if necessary.

#### SYS2-16-j — Update the requirements and the diagrams based on the PoC results

- **ASPICE BP:** SYS.2 BP1・BP3
- **Purpose:** Update the requirements and the diagrams based on the PoC results, and record the reasons for the changes.
- **Work content:** In accordance with the sorting results, update the requirement values, the trigger conditions, the screen specification, the flows and the sequences, and record the reasons for the changes and the supporting data.
- **Input deliverables:** Sorting table of the existing verification results, integrated draft, the individual deliverables (fixed version)
- **Input source:** Own department (deliverables of the preceding step) / IVI development department
- **Output deliverables:** Updated requirements list, screen specification, flowcharts and sequence diagrams, change history (reason for the change, grounds)
- **Granularity / completeness:** Draft version: before confirmation by the related departments
- **Predecessor / Successor:** Predecessor: SYS2-16-i / Successor: SYS2-16-k, SYS2-16-l, SYS2-16-n
- **Entry:** The sorting of the PoC results is complete.
- **Exit (DoD):** ① The items marked for revision in the sorting have been updated. ② The reasons for the changes and the supporting data are recorded. ③ The affected diagrams have been updated together with them.
- **Concrete examples:** ① If the trigger-condition threshold was changed from 90 minutes to 120 minutes, update the requirement statement, the decision value in the flowcharts and the assumption in the use cases all together. ② Record the grounds in the change history as "based on the PoC results (○ out of ○ test subjects answered that 90 minutes is too early)". ③ Confirm whether the change to the requirement value has propagated to the non-functional requirements (timeout values, degradation conditions).

#### SYS2-16-k — Update the status of the open issues

- **ASPICE BP:** SYS.2 BP5
- **Purpose:** Update the status of the open issues and make clear the assumptions that remain in the specification document.
- **Work content:** Close the issues resolved by the PoC results and the decisions, and organize the remaining issues and assumptions into the open-issues chapter of the specification document.
- **Input deliverables:** System issue list (fixed version), sorting table of the existing verification results, list of the passages carrying assumptions, issue × candidate requirement correspondence table
- **Input source:** Own department (deliverables of the preceding step)
- **Output deliverables:** System issue list (updated version), the "Open issues" chapter of the specification document
- **Granularity / completeness:** Draft version: before review
- **Predecessor / Successor:** Predecessor: SYS2-16-i, SYS2-16-j, SYS2-10-l, SYS1-09-f / Successor: SYS2-16-l, SYS2-16-o
- **Entry:** The PoC results and the decisions have been reflected.
- **Exit (DoD):** ① The resolved issues have been closed. ② The remaining issues are stated with deadlines and owners. ③ The requirements carrying assumed values have been listed.
- **Concrete examples:** ① Because the threshold has been fixed, close the "final numerical value of the trigger condition" issue and remove the assumption annotations from the related requirements. ② Leave the issue of waiting on the conditions for fatigue-estimation integration as unresolved, and state explicitly in the specification document the deadline and the handling if it is not met (OTA extension). ③ List the requirements that remain at an assumed value (the timeout values) and state that they will be fixed in the design phase.

#### SYS2-16-l — Hold the related-department reviews by discipline and collect the comments

- **ASPICE BP:** SYS.2 BP3・BP7
- **Purpose:** Hold the related-department reviews by discipline and collect the comments.
- **Work content:** Have the business planning, IVI development, related domain, legal / security and quality-assurance departments review the chapters relevant to them, and collect the comments.
- **Input deliverables:** Integrated draft (with the updates reflected), consistency confirmation results, verifiability check results, the "Assumptions and constraints" and "Open issues" chapters of the specification document
- **Input source:** Own department (deliverables of the preceding step) / IVI development department / the related domain departments / the legal and security departments / quality-assurance department
- **Output deliverables:** Review comment list (department × chapter × comment × importance)
- **Granularity / completeness:** Draft version: comments collected
- **Predecessor / Successor:** Predecessor: SYS2-16-c, SYS2-16-e, SYS2-16-g, SYS2-16-j, SYS2-12-k / Successor: SYS2-16-m
- **Entry:** The integrated draft has had the updates reflected.
- **Exit (DoD):** ① All target departments have reviewed it. ② The comments have been listed with chapter and importance attached. ③ The review period and the deadline have been kept.
- **Concrete examples:** ① Have the planning owner focus on the match with the planning intent and the appropriateness of the scope, and the quality-assurance department focus on verifiability. ② Have the legal / security departments confirm the requirements and assumptions relating to consent, logging and data protection. ③ Classify the comments by importance (must-fix / to be considered / for reference) and use this in judging the response policy.

#### SYS2-16-m — Reflect the comments and record the disposition and the reasons

- **ASPICE BP:** SYS.2 BP3
- **Purpose:** Reflect the comments and record whether each was adopted and why.
- **Work content:** Sort the comments into reflected, deferred and not adopted and reflect them, and record the reason for the judgement and the decision-maker.
- **Input deliverables:** Review comment list, integrated draft (with the updates reflected)
- **Input source:** Own department (deliverables of the preceding step) / IVI development department
- **Output deliverables:** Comment disposition record (comment × disposition × reason × decision-maker), corrected specification draft
- **Granularity / completeness:** Draft version: corrections reflected
- **Predecessor / Successor:** Predecessor: SYS2-16-l / Successor: SYS2-16-n
- **Entry:** The review comments have been collected.
- **Exit (DoD):** ① Every comment has a disposition category and a reason. ② The not-adopted comments have a reason and a decision-maker recorded. ③ The corrections have been reflected in the body text.
- **Concrete examples:** ① For a must-fix comment (an acceptance condition that cannot be judged), correct the body text and record the corrected passage. ② Do not adopt a comment that would lead to a scope expansion (adding facility reservation), and record the reason (the decision that it is outside the initial scope) and the decision-maker. ③ Register the deferred comments in the system issue list, and set a deadline and an owner.

#### SYS2-16-n — Baseline the specification document

- **ASPICE BP:** SYS.2 BP4
- **Purpose:** Baseline the specification document and fix it as the reference version from here on.
- **Work content:** Attach a version number and approval to the corrected version to baseline it, and record the configuration (the deliverables included and their versions).
- **Input deliverables:** Corrected specification draft, comment disposition record, traceability matrix (integrated version)
- **Input source:** Own department (creation) / planning owner and IVI development department (approval)
- **Output deliverables:** System requirements specification (draft version, baseline v1.0), configuration record (deliverable included × version number)
- **Granularity / completeness:** Draft version: baselined (to be detailed further in the design phase)
- **Predecessor / Successor:** Predecessor: SYS2-16-m, SYS2-16-f, SYS2-16-j / Successor: SYS2-16-o, SYS2-16-p
- **Entry:** The disposition of the review comments is complete.
- **Exit (DoD):** ① The version number, the approver and the approval date are recorded. ② The deliverables included and their versions are recorded. ③ The baseline version has been stored in a fixed form.
- **Concrete examples:** ① Take the specification body together with the appendices (traceability, the full set of diagrams) as v1.0, and obtain approval. ② Record in the configuration record the breakdown such as use case descriptions v1.1, screen transition diagram v1.0. ③ State explicitly at the beginning the reason it is a "draft version" (it will be detailed in the design phase; open issues remain), and write the conditions for making it a fixed version.

#### SYS2-16-o — Apply the change-management rules for the specification document

- **ASPICE BP:** SYS.2 BP5
- **Purpose:** Apply the change-management rules for the specification document, and control the changes from here on.
- **Work content:** Define, as the operating rules of the specification document, the procedure for change requests, impact assessment, approval and version management for the requirements and the diagrams, and connect it to the change management of the issue list.
- **Input deliverables:** Issue change-management rules, system requirements specification (baseline), traceability matrix (integrated version)
- **Input source:** Own department (deliverables of the preceding step) / IVI development department
- **Output deliverables:** Specification change-management rules (request × impact assessment × approval × version management × notification)
- **Granularity / completeness:** Fixed version: agreed with the related departments
- **Predecessor / Successor:** Predecessor: SYS2-16-n, SYS1-09-j, SYS1-09-k / Successor: SYS2-16-p
- **Entry:** Baselining is complete.
- **Exit (DoD):** ① The change procedure and the approvers are defined. ② The scope of the impact assessment is defined on the basis of the traceability. ③ The method of notifying the related departments is defined.
- **Concrete examples:** ① Make it the procedure that, when a requirement change is requested, the related use cases, screens, flows and sequences are identified as the scope of impact via the traceability. ② Set the approver by category of requirement (functional ones by the IVI development department, ones bearing on business viability by the planning owner). ③ Make it the practice that, when a change is fixed, the version number is updated and a list of the changes is notified to the related departments and the vendors.

#### SYS2-16-p — Distribute and explain the specification, and hand over to the following phases

- **ASPICE BP:** SYS.2 BP6・BP8
- **Purpose:** Distribute and explain the specification to the related departments and the vendors, and hand over to the following phases.
- **Work content:** Distribute the baseline version, and at a briefing session share and hand over the key points of the specification, the open issues, the change-management rules and the route for enquiries.
- **Input deliverables:** System requirements specification (baseline v1.0), specification change-management rules, system issue list (updated version)
- **Input source:** Own department (deliverables of the preceding step) / IVI development department / the development vendors / the related domain departments
- **Output deliverables:** Distribution record, briefing materials and minutes, definition of the enquiry desk and the response deadline
- **Granularity / completeness:** Fixed version: distributed and explained
- **Predecessor / Successor:** Predecessor: SYS2-16-n, SYS2-16-o / Successor: the following phases (architecture design, vendor selection)
- **Entry:** The baseline version and the change-management rules are fixed.
- **Exit (DoD):** ① The recipients and the version distributed are recorded. ② The open issues and the assumptions have been shared at the briefing session. ③ The enquiry desk and the response deadline are defined.
- **Concrete examples:** ① Explain to the development vendors centring on the requirements list, the interface items and the assumptions and constraints, and state explicitly that some requirements carry assumed values at the time of estimation. ② Share the list of open issues and the planned timing of their decisions, and agree that the specification document will be updated after those decisions. ③ Define the enquiry desk for the specification (the IVI development department via the planning owner) and the response deadline (5 business days).
