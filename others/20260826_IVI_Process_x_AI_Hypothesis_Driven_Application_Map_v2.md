# IVI Process × AI Hypothesis-Driven Development — Application Map (v2)

*English translation of `20260826_IVIプロセス×AI仮説駆動_適用マップ_v2.xlsx` (2026-08-26).*

Sheets: [Agent Capability Definitions](#1-agent-capability-definitions) · [Process × AI Application](#2-process--ai-application) · [Summary](#3-summary)

---

## 1. Agent Capability Definitions

**Function / skill definitions of the AI hypothesis-driven development agent**

The agent provides the 9 functions below through dialogue (`AskUserQuestion`) and subagent invocation. Each function consists of a pair: a **template** (the deliverable) and a **skill** (the dialogue routine). The division of labor is: *the agent is the executor; the template is the recording medium.*

### F1 — Context organization

**Skill / template invoked:** `discovery-init`

Asks 1–2 questions at a time in dialogue to draw out project background, higher-level policy, IVI technical constraints, SOP, target vehicle models, and operational constraints; automatically sorts decided items into the "constraints" document and undecided items into the "hypotheses" document. If existing R&D results or domain specifications have been placed under `references`, `references-researcher` summarizes them in advance before the questioning starts.

### F2 — Hypothesis drafting & conversion into falsification conditions

**Skill / template invoked:** `discovery-init` / `experiment-review`

Drafts problem hypotheses, solution hypotheses, acceptability hypotheses, revenue hypotheses, and growth hypotheses through dialogue at the granularity of **1 question = 1 hypothesis = 1 falsification condition**. Abstract wording is not let through — you are made to write down how you would know if the hypothesis turned out wrong. Holds a status (unverified / verifying / confirmed / rejected) and updates it from experiment results.

### F3 — Summarizing and organizing primary sources

**Skill / template invoked:** `references-researcher` (a subagent called by Discovery)

Summarizes interview records, competitor materials, domain specifications, and regulatory documents placed in `references/user_research`, `competitor_analysis`, `market_research`, and `misc`. Only the portion needed for the next step's dialogue is quoted and embedded into the questions, so you are not asked everything from scratch.

### F4 — Experiment design & variant comparison

**Skill / template invoked:** `experiment-design`

Designs experiments one at a time from the unverified hypotheses in the hypothesis sheet. Has you fill in success criteria, UX flow, drop-off points, measurement methods, and risks through dialogue, and fixes the shared design premises and the branching axis across multiple variants (A/B/C). Holds a gate that prevents advancing to Phase 4 with blanks remaining.

### F5 — Automated prototype implementation + interaction verification

**Skill / template invoked:** `proto-build` (internally: `proto-implementer` / `proto-validator-naive` / `proto-validator-inspector`)

Autonomously implements HTML prototypes into `prototypes/` following the design doc, reproduces browser operations with Playwright, and judges the ⭐ core steps on a 3-level scale. Runs a fix loop until a pass/fail verdict is reached (with an upper bound). Also captures before/after screenshots automatically.

### F6 — Recording judgment & decision evidence (ADR)

**Skill / template invoked:** `adr_template` (cross-cutting, all phases)

Leaves options / decision / rationale / rejected alternatives / conditions of conditional decisions in a single file. When a judgment is reopened later, the evidence can be traced. Importance rises in the growth phase, because there the code persists.

### F7 — Recording learnings & deciding the next action

**Skill / template invoked:** `experiment-review`

Consistently updates the "Results" section of the experiment design doc, the "Retrospective" section of the design doc, `learning_log`, and `hypothesis_sheet`. Gates the distinction **"a design hypothesis being wrong ≠ the product hypothesis being wrong"**, and correctly reflects the learnings from failed experiments back into the hypothesis sheet. If the graduation criteria are met, it also guides the graduation decision.

### F8 — Turning acceptance criteria into Gherkin

**Skill / template invoked:** `acceptance.feature` (created paired with `story.md`)

Describes "who / what / and what counts as a pass" in Gherkin notation (Given/When/Then). Leaves no vague words ("appropriately", "quickly"). Uses Scenario Outline to cover combinations of conditions. Claude Code uses these acceptance criteria directly as E2E tests.

### F9 — Issue extraction & consolidation

**Skill / template invoked:** Cross-cutting dialogue skills (behavior shared by `discovery-init` / `experiment-design` / `experiment-review`)

Surfaces the discussion points and open items from multiple input documents and meeting notes, and consolidates them at the granularity of **1 issue = 1 question**. Shapes them into a form where classification, dependencies, priority, decision-maker, and deadline can be assigned. Sorts the destination: registered into the hypothesis sheet as unverified hypotheses, or into the backlog as unresolved issues.

---

## 2. Process × AI Application

**Legend for F1–F9:** ◎ = used as a primary function / ◯ = usable effectively / △ = usable as an auxiliary / － = not used
**▲** = work whose lead time depends on outside parties or other departments and cannot be predicted
For details of F1–F9, see [Agent Capability Definitions](#1-agent-capability-definitions).

### Phase ① Planning brush-up (pre-SYS.1 stage)

*Refine an idea into a plan that can withstand requirements definition → **Fixed by the end:** value proposition / differentiation axis / trigger conditions / integration scope / scope (plan document, approved version)*

#### 1. Organizing the starting point of the plan

| Item | Content |
|---|---|
| **Purpose (why do it)** | Turn an idea into premises that can be discussed and verified |
| **Main work (outline)** | Confirm positioning against higher-level policy and constraints / condense the concept onto one page / separate decided items, hypotheses, and undecided items / inquire whether existing R&D verification results exist and sort them / grasp target vehicle models, SOP, IVI technical constraints, and operational constraints / study WBS |
| **Main deliverables** | Planning-premises summary (draft), target-premises table, IVI technical constraints list, stakeholder map, study WBS |
| **To be judged / agreed** | What is a decision and what is a hypothesis (planning owner) |
| **Main departments involved** | Product planning, corporate planning, advanced development / R&D, IVI development, operations |
| **Common pitfall** | Treating a vague concept as a decided item |
| **AI application** | ◯ |
| **What AI can do (expected effect)** | Draws information out through dialogue, 1–2 questions at a time, and generates a first version of a document set (`project_brief` / `product_constraints` / `hypothesis_sheet`) in which higher-level policy, technical constraints, SOP, and vehicle models have been automatically sorted into "settled = constraint" and "unsettled = hypothesis". Existing R&D results are summarized in advance and reflected in the questions, compressing the interviewing effort. |

**F1–F9:** F1 ◎ · F2 ◯ · F3 ◯ · F4 － · F5 － · F6 － · F7 － · F8 － · F9 ◯

**Rationale (what the agent can do / does):** The agent generates the initial three-document set with decisions separated from hypotheses by launching `discovery-init` just once. If existing R&D results are placed under `references`, the questions arrive already informed by a summary of them, so the planner does not have to explain from zero. Even if you try to move ahead with vague wording, a dialogue gate blocks you until the falsification condition is written.

#### 2. Value proposition, persona, and usage context

| Item | Content |
|---|---|
| **Purpose (why do it)** | Make "whose problem, and what problem, are we solving" verifiable |
| **Main work (outline)** | Put the pain points into words with supporting data / persona × usage-context matrix / JTBD and falsification hypotheses / ▲ interview design, execution, and analysis (grasping the acceptable frequency) |
| **Main deliverables** | Value-proposition definition (draft), persona sheet, context matrix, interview analysis results |
| **To be judged / agreed** | Agreement on a one-sentence value statement |
| **Main departments involved** | External (interview subjects, recruiting) |
| **Common pitfall** | Staying at abstract wording that cannot be falsified |
| **AI application** | ◯ |
| **What AI can do (expected effect)** | Forces articulation per persona in the pattern "pain point → hypothesis → falsification condition". Has JTBD and falsification hypotheses filled in through dialogue, and does not let abstract wording pass. The same flow can also produce the success criteria and measurement method for the interview experiment. |

**F1–F9:** F1 － · F2 ◎ · F3 ◯ · F4 ◯ · F5 － · F6 － · F7 － · F8 － · F9 －

**Rationale:** The agent always asks "if this hypothesis turns out wrong, what will you see and how?", forcing an abstract value statement to be rewritten as a hypothesis with a falsification condition. Interviews are designed as a single experiment in `experiment-design`, and `learning_log` reflects the results back into the hypothesis status. Recruiting the subjects themselves, however, is outside the agent's scope.

#### 3. Competitor / alternative-means research and differentiation

| Item | Content |
|---|---|
| **Purpose (why do it)** | Be able to state outright why *we* must be the ones delivering this on IVI |
| **Main work (outline)** | Design the comparison targets and research items / ▲ benchmark public information, actual-vehicle test drives, and smartphone integration / feature comparison table and UX walkthrough / the necessity of IVI and the division of roles with the smartphone / price and monetization benchmarks |
| **Main deliverables** | Differentiation summary (draft), feature comparison table, IVI-necessity summary, pricing research |
| **To be judged / agreed** | Narrow the differentiation axes down to 1–2 / draw the line for features where parity is enough |
| **Main departments involved** | External (public information, actual vehicles), IVI development |
| **Common pitfall** | Investing in features that a smartphone already covers |
| **AI application** | ◯ |
| **What AI can do (expected effect)** | Consolidates public materials, test-drive notes, and smartphone-app screen captures into `references/competitor_analysis` and summarizes them. Drafts differentiation hypotheses and role-division hypotheses, and records the narrowing-down judgment as an ADR. |

**F1–F9:** F1 － · F2 ◯ · F3 ◎ · F4 △ · F5 － · F6 ◯ · F7 － · F8 － · F9 －

**Rationale:** The agent calls `references-researcher` to summarize competitor materials across sources, and reflects feature-comparison viewpoints (trigger timing, information granularity, offline capability) into its questions. The "narrow the differentiation axes to 1–2" judgment is recorded in an ADR together with the rejected alternatives, so the investment target cannot be reopened later.

#### 4. Experience scenarios and trigger conditions

| Item | Content |
|---|---|
| **Purpose (why do it)** | Decide when it appears, how it is shown, and what happens when it is wrong |
| **Main work (outline)** | Scenarios and storyboards / trade-off comparison of candidate trigger and suppression conditions / frequency and re-presentation rules / notification means, whether operation while driving is allowed, passenger-facing display / rough screen layouts / prototype evaluation |
| **Main deliverables** | Experience-scenario document and trigger-condition definition (draft), notification-means design, rough screens |
| **To be judged / agreed** | Decide on one trigger-condition proposal to adopt (record the remaining ones as alternatives) |
| **Main departments involved** | IVI development, design, quality assurance (HMI) |
| **Common pitfall** | Never fully nailing down false detection and annoyance |
| **AI application** | ◯ |
| **What AI can do (expected effect)** | Designs trigger-condition variants A/B/C in parallel with an explicit branching axis, auto-implements each as an HTML prototype, and captures before/after with Playwright for a 3-level verdict. Within days you can make a comparison that reaches into "false detection / annoyance". |

**F1–F9:** F1 － · F2 － · F3 － · F4 ◎ · F5 ◎ · F6 ◯ · F7 － · F8 △ · F9 －

**Rationale:** The agent turns trigger conditions into a single experiment via `experiment-design`, fixing the shared design premises and the branching axis. `proto-build` implements each variant and runs everything up to verifying the ⭐ core steps with one command. The adopted proposal and the remaining ones leave evidence in the ADR, so they can be explained to management later.

#### 5. Necessity and scope of domain integration

| Item | Content |
|---|---|
| **Purpose (why do it)** | Confirm whether it holds up on IVI alone, and decide the integration scope |
| **Main work (outline)** | Identify the required data and the domains that own it / whether IVI alone can substitute, and the added value on top / confirm acquisition means, accuracy, and freshness / where the decision logic lives / ▲ inquire whether provision is possible / compare 3 proposals: minimum, standard, full |
| **Main deliverables** | Domain-integration policy (draft), required-data list, responsibility-demarcation proposal, integration cost estimate |
| **To be judged / agreed** | The integration-scope proposal to adopt, and the fallback if provision is refused |
| **Main departments involved** | IVI development, vehicle control, ADAS, cloud, legal |
| **Common pitfall** | Assuming integration from the start and being unable to explain the added value |
| **AI application** | ◯ |
| **What AI can do (expected effect)** | Consolidates other domains' specifications into `references` and summarizes them. States the responsibility demarcation explicitly as a "constraint" and turns the 3-proposal comparison into an experiment design. The integration policy and the fallback are recorded as ADRs. However, the inquiry to other departments about whether provision is possible (▲) itself cannot be shortened. |

**F1–F9:** F1 ◯ · F2 － · F3 ◯ · F4 △ · F5 － · F6 ◎ · F7 － · F8 － · F9 －

**Rationale:** The agent puts the responsibility demarcation and integration scope into `product_constraints` so every later step can reference them. A conditional decision such as "if provision is refused, fallback X" fits directly into the ADR format. Because the delay in receiving answers cannot be absorbed, this step remains marked ▲.

#### 6. Acceptability / business-viability verification and scope

| Item | Content |
|---|---|
| **Purpose (why do it)** | Verify whether people will use it and pay for it, and assemble the material for the investment decision |
| **Main work (outline)** | Verification hypotheses and research design / ▲ quantitative research, PSM, analysis of reasons for non-use / revenue model, cost, and 3 profit-and-loss scenarios / KPIs and success criteria / sorting into initial release, OTA, or drop |
| **Main deliverables** | Plan document (approved version), business-viability assessment, scope-sorting table, risk & premise list |
| **To be judged / agreed** | Approval at the decision-making meeting (for conditional approval, state the conditions explicitly) |
| **Main departments involved** | External (research agencies), IVI development, decision-making meeting |
| **Common pitfall** | No record of the sorting rationale, so it gets reopened later |
| **AI application** | ◯ |
| **What AI can do (expected effect)** | Drafts acceptability and revenue hypotheses together with their KPIs (success criteria), and designs research such as PSM as a single experiment. `experiment-review` drives everything through reflecting the results and deciding the next action. However, the P&L model calculation itself and the meeting approval are out of scope. |

**F1–F9:** F1 － · F2 ◎ · F3 － · F4 ◯ · F5 － · F6 ◯ · F7 ◯ · F8 － · F9 －

**Rationale:** The agent manages the "will they use it / will they pay" hypotheses with falsification conditions attached, and feeds research results into status updates on the hypothesis sheet. Reasons for dropping something are kept in ADRs, so the sorting rationale can be presented at a later decision-making meeting. P&L scenario calculation is done outside the harness, in Excel or similar.

### Phase ② Issue extraction → system issue list (SYS.1 BP1–6)

*Surface what is unresolved and settle it; make the remainder manageable → **Fixed by the end:** the handling policy for each issue / the management unit for unresolved items (system issue list)*

#### 7. Extraction of points to be examined

| Item | Content |
|---|---|
| **Purpose (why do it)** | Surface everything that must be decided before requirements definition, with no gaps |
| **Main work (outline)** | Consolidate the discussion points and open items from each document / collect concerns via hearings with the departments involved / standardize to 1 issue = 1 question / organize classification and dependencies / assign priority, decision-maker, and deadline working backwards from the specification freeze |
| **Main deliverables** | Issue list (fixed: question × options × decision material × decision-maker × deadline), requirement-candidate notes |
| **To be judged / agreed** | Check for missing issues, and the deadline for soliciting additions |
| **Main departments involved** | All departments involved (engineering, legal, QA, operations) |
| **Common pitfall** | Failing to fully consolidate issues scattered across documents |
| **AI application** | ◯ |
| **What AI can do (expected effect)** | Reads plan documents, meeting notes, and technical materials across the board and surfaces the issues and open items. Shapes them to the granularity of "1 issue = 1 question" and has options, decision material, decision-maker, and deadline filled in through dialogue. Scattered issues can be consolidated into a single list. |

**F1–F9:** F1 － · F2 ◯ · F3 ◯ · F4 － · F5 － · F6 － · F7 － · F8 － · F9 ◎

**Rationale:** If you let the agent load multiple documents as `references`, `references-researcher` summarizes them, and from there candidate issues are extracted and turned into questions. Through dialogue, the extraction results are sorted by destination: registered on the `hypothesis_sheet` as unverified hypotheses, or on the `backlog` as carry-over items.

#### 8. Discussing the issues and examining the handling policy

| Item | Content |
|---|---|
| **Purpose (why do it)** | Settle things. For what will not be settled, decide how it will be handled |
| **Main work (outline)** | Prepare option-comparison tables / run the review meetings / additional research and technical confirmation / confirm the interpretation of the decisions using concrete examples / manage the conditions of conditional decisions / escalation / reflect into the planning documents |
| **Main deliverables** | Handling-policy list (fixed), revised documents, remaining-issue list, condition-management table |
| **To be judged / agreed** | The decision-maker for each issue approves (leave evidence) |
| **Main departments involved** | The decision-maker for each issue, specialist departments (safety, security) |
| **Common pitfall** | Proceeding without noticing a divergence in interpretation |
| **AI application** | ◯ |
| **What AI can do (expected effect)** | Records the options, decision, rationale, rejected alternatives, and the conditions of conditional decisions in the format of a single ADR. Issues requiring additional verification can be handed over to `experiment-design`. |

**F1–F9:** F1 － · F2 － · F3 － · F4 △ · F5 － · F6 ◎ · F7 － · F8 － · F9 ◯

**Rationale:** For each issue the agent asks, through dialogue, "which option are you taking, and why were the others rejected?", and captures it in an ADR. Conditional decisions are made to state explicitly "valid only if condition X is satisfied". The decision-maker's approval itself happens on the human side, and its signature date is kept in the ADR metadata.

#### 9. Creating the system issue list

| Item | Content |
|---|---|
| **Purpose (why do it)** | Hand over unresolved items, constraints, and premises in a manageable form |
| **Main work (outline)** | Define the format and the states / transfer decisions → constraints and premises, and holds → unresolved issues / add technical and operational issues / link to requirement candidates / priority and deadline / change management and weekly operating rules |
| **Main deliverables** | System issue list (baseline), change-management and operating rules, issue-resolution plan |
| **To be judged / agreed** | Baseline it and hand it over with the agreement of the departments involved |
| **Main departments involved** | IVI development (the receiver), operations, related domains |
| **Common pitfall** | Not recording decided items as constraints |
| **AI application** | ◯ |
| **What AI can do (expected effect)** | Automatically routes settled decisions into `product_constraints` and holds into unverified items on the `backlog`. Even the template-based operation of weekly retrospectives can be built in. |

**F1–F9:** F1 ◎ · F2 － · F3 － · F4 － · F5 － · F6 ◯ · F7 △ · F8 － · F9 ◯

**Rationale:** The agent's graduation process is built exactly around the "decision → constraint, hold → unresolved" branch as a pattern. Reviewing `learning_log` at a weekly retrospective can also be built in as a standard practice. Obtaining the departments' agreement for baselining is itself a human-side event.

### Phase ③ Creating the system requirements specification (SYS.2 BP1–8)

*Convert the plan into a specification you can make implementation decisions from → **Fixed by the end:** use cases / screens / requirements / function allocation / process flows (requirements specification, draft version)*

#### 10. Creating use cases

| Item | Content |
|---|---|
| **Purpose (why do it)** | Convert the experience into behavior you can make implementation decisions from |
| **Main work (outline)** | Define granularity and format / enumerate actors / basic, alternative, and exception flows / pre- and post-conditions / assign trigger and suppression conditions / make integration steps explicit / settings, consent, and operational aspects / placeholder premises for unresolved items |
| **Main deliverables** | Use-case descriptions (fixed, with UC-IDs), use-case diagram |
| **To be judged / agreed** | Confirm alignment with the planning intent and feasibility |
| **Main departments involved** | IVI development, operations |
| **Common pitfall** | Thin exception flows, so abnormal situations never get decided |
| **AI application** | ◯ |
| **What AI can do (expected effect)** | Shapes UCs to a value-oriented view using the naming pattern "beneficiary (who) – capability (what) – target (on what)". Because basic / alternative / exception flows must be written in Gherkin as a pattern, abnormal cases cannot be left blank and pass. |

**F1–F9:** F1 － · F2 － · F3 － · F4 － · F5 － · F6 － · F7 － · F8 ◎ · F9 △

**Rationale:** The agent enforces naming using the criterion "can a non-engineer explain the purpose from the directory name alone?" `acceptance.feature` has a pattern in which Scenario covers the basic flow, Scenario Outline covers combinations, and an additional "edge cases" section forces abnormal cases to be written.

#### 11. Screen mockups and transition diagrams

| Item | Content |
|---|---|
| **Purpose (why do it)** | Decide a presentation and an operation range that hold up while driving |
| **Main work (outline)** | Screen list / upper limit on information volume while driving, and priority / proposal display coexisting with the map / expression differences per notification means / detail, settings, and consent screens / transition diagram and interrupt priority / error and degraded screens |
| **Main deliverables** | Screen list, screen mockups, screen transition diagram, while-driving restriction definitions |
| **To be judged / agreed** | Agreement on display and operation restrictions while driving (visual/aesthetic design is out of scope) |
| **Main departments involved** | IVI development, design, quality assurance |
| **Common pitfall** | Postponing map coexistence and interrupt priority |
| **AI application** | ◯ |
| **What AI can do (expected effect)** | Implements variants of while-driving restrictions, map coexistence, and interrupt priority in parallel as HTML prototypes, and compares them by capturing before/after with Playwright. The design judgments are recorded in `design_doc`. |

**F1–F9:** F1 － · F2 － · F3 － · F4 ◯ · F5 ◎ · F6 － · F7 － · F8 △ · F9 －

**Rationale:** The agent implements HTML prototypes following the design doc and reproduces the ⭐ core-step operations simply by calling `proto-build`. For while-driving restrictions, if you write the "stop accepting input" condition in Gherkin, `proto-validator` actively confirms it. Aesthetic design is out of scope, but this is sufficient for validating the soundness of layout and transitions.

#### 12. Requirements list (functional / non-functional)

| Item | Content |
|---|---|
| **Purpose (why do it)** | Make the requirements verifiable and their rationale traceable |
| **Main work (outline)** | Description rules (forbidden expressions, acceptance criteria) / extract functional requirements from the UCs (trigger, display, operation, integration, settings, logging) / non-functional (performance, availability, security, maintenance / OTA) / reflect constraints and structure them |
| **Main deliverables** | Requirements list (fixed, with REQ-IDs), traceability matrix |
| **To be judged / agreed** | Confirm that a pass/fail verdict can be made from the acceptance criteria |
| **Main departments involved** | IVI development, related domains, legal, quality assurance |
| **Common pitfall** | Vague requirements remain and cannot be verified |
| **AI application** | ◯ |
| **What AI can do (expected effect)** | Because acceptance criteria must be written in Gherkin for every requirement, vague words such as "appropriately" or "quickly" do not pass. REQ-ID traceability is established automatically through the `story` ↔ `acceptance.feature` correspondence. |

**F1–F9:** F1 － · F2 － · F3 － · F4 － · F5 － · F6 － · F7 － · F8 ◎ · F9 △

**Rationale:** The agent sends back any requirement whose acceptance criteria cannot be written, as "no pass/fail verdict possible". Since the use case (`story`) and the acceptance criteria (`acceptance.feature`) are always created as a pair by pattern, the REQ-ID traceability matrix can be generated directly.

#### 13. Function allocation diagram

| Item | Content |
|---|---|
| **Purpose (why do it)** | Decide where each function is placed, and the responsibility demarcation |
| **Main work (outline)** | Enumerate the function blocks / compare multiple allocation proposals / reflect where the decision logic lives / inter-domain data flows / interface candidates and whether existing ones can be reused / evaluate on ease of change and responsiveness / confirm consistency with non-functional requirements |
| **Main deliverables** | Function allocation diagram, data-flow definitions, interface-candidate list, responsibility-demarcation list |
| **To be judged / agreed** | Agree the allocation and the development split with the related domains |
| **Main departments involved** | IVI development, ADAS, vehicle control, cloud |
| **Common pitfall** | The already-decided location of the decision logic contradicts the allocation |
| **AI application** | ◯ |
| **What AI can do (expected effect)** | Turns allocation proposals A/B/C into design docs in parallel and compares them from the viewpoints of ease of change, responsiveness, and non-functional consistency. The responsibility demarcation is fixed as a constraint, and the decision is recorded as an ADR. |

**F1–F9:** F1 ◯ · F2 － · F3 － · F4 ◎ · F5 － · F6 ◯ · F7 － · F8 － · F9 －

**Rationale:** Because the agent has a pattern for producing design docs for multiple variants through dialogue, it maps naturally onto "compare multiple allocation proposals". The already-decided location of the decision logic is referenced from `product_constraints`, so contradictions can be detected.

#### 14. Flowcharts

| Item | Content |
|---|---|
| **Purpose (why do it)** | Eliminate missing branches and undefined behavior |
| **Main work (outline)** | Select the target processes and unify the notation / trigger determination / priority order of suppression conditions / frequency and re-presentation control / response handling / degraded and abnormal handling / state at startup and trip boundaries / confirm coverage with a combination table and cross-check against the requirements |
| **Main deliverables** | Flowcharts (fixed), branch-coverage confirmation results, requirement cross-check results |
| **To be judged / agreed** | Confirm gaps and granularity from an implementation viewpoint |
| **Main departments involved** | IVI development |
| **Common pitfall** | Condition combinations are not exhaustively covered |
| **AI application** | ◯ |
| **What AI can do (expected effect)** | Lists the branch combinations with a Gherkin Scenario Outline, runs them on the prototype, and judges branch traversal. Degraded and abnormal handling is written using the same pattern. |

**F1–F9:** F1 － · F2 － · F3 － · F4 △ · F5 ◎ · F6 － · F7 － · F8 ◯ · F9 －

**Rationale:** The agent has the combination table written as a Scenario Outline in `acceptance.feature`, and `proto-build` executes all of those paths. Because the 3-level verdict makes the passed and non-passed paths visible, "not exhaustively covered" can be prevented.

#### 15. Sequence diagrams

| Item | Content |
|---|---|
| **Purpose (why do it)** | Nail down the order, timing, and interface items of the interactions |
| **Main work (outline)** | Select the target scenarios and unify the notation / normal cases / annotate periods and timeouts / acquisition of integration data / abnormal cases / contention with other notifications / state reset / extract interface items and reflect them into the requirements |
| **Main deliverables** | Sequence diagrams (fixed), interface-item list |
| **To be judged / agreed** | Confirm the soundness of triggers, periods, and timeouts |
| **Main departments involved** | IVI development, ADAS, vehicle control, cloud |
| **Common pitfall** | Contention and timeout cases are left undefined |
| **AI application** | ◯ |
| **What AI can do (expected effect)** | Has periods, timeouts, and contention patterns written explicitly as the experiment design's "signs of being wrong". If abnormal cases are missing from the sequence, it does not pass. |

**F1–F9:** F1 － · F2 － · F3 － · F4 ◎ · F5 － · F6 － · F7 － · F8 △ · F9 －

**Rationale:** The agent holds a gate in `experiment-design` that always requires "drop-off points" and "signs of being wrong" to be filled in. "Contention with other notifications" and "state reset after a timeout" can also be written with this same pattern.

#### 16. Specification integration, review, and PoC reflection

| Item | Content |
|---|---|
| **Purpose (why do it)** | Consolidate into one document, and for values that cannot be settled, verify and fix them |
| **Main work (outline)** | Design the table of contents and integrate / state premises, constraints, and out-of-scope items explicitly / check consistency, traceability, and verifiability / ▲ plan the requirement-verification PoC through to reflecting its results / update the unresolved issues / review by discipline / distribute and explain |
| **Main deliverables** | System requirements specification (draft version, baseline), PoC-result reflection record, change-management rules |
| **To be judged / agreed** | Approve and baseline after review |
| **Main departments involved** | Related domains, legal, quality assurance, development vendors |
| **Common pitfall** | Provisional values get fixed as final and change management stops working |
| **AI application** | ◯ |
| **What AI can do (expected effect)** | Implements and verifies the requirement-verification PoC with one command. The results are reflected consistently through `experiment_design` → `design_doc` → `learning_log` → `hypothesis_sheet`, so change management does not break. |

**F1–F9:** F1 ◯ · F2 － · F3 － · F4 － · F5 ◎ · F6 ◯ · F7 ◎ · F8 － · F9 －

**Rationale:** With the `experiment-review` skill, the agent reflects experiment results consistently into the four deliverables. Because it also gates the distinction "a design hypothesis being wrong ≠ the product hypothesis being wrong", it prevents "provisional values getting fixed as final". The approval for baselining is itself a human-side event.

---

## 3. Summary

**Premise: "all 16 work items are AI-applicable (◯)", but the function mix varies in intensity**

| | |
|---|---|
| **Why is everything ◯?** | The agent has 9 functions covering the entire cycle of "draft hypotheses through dialogue → design an experiment → verify with a prototype → record the learnings". This process runs up to requirements definition — i.e. it corresponds to Discovery through requirements specification — and overlaps with the agent's coverage. Hence every work item is ◯. |
| **So what actually differs?** | Which F is "used as a primary function" (◎) differs per work item. Phase ① planning brush-up is centered on F1–F4; phase ② issue extraction → issue list is centered on F6 and F9; phase ③ requirements specification is centered on F5 and F8. This distribution determines where the agent is best used. |

### ① Work items where AI hypothesis-driven development adds the most value

| Work item | Why |
|---|---|
| **Work 2 — Value proposition & persona (F2)** | Because the agent always asks "if this hypothesis turns out wrong, what will you see and how?", no value proposition survives in abstract wording. |
| **Work 4 — Experience scenarios & trigger conditions (F4 + F5)** | The agent prototypes trigger conditions A/B/C in parallel and compares them, capturing before/after with Playwright. Items conventionally "never nailed down" reach falsification within days. |
| **Work 11 & 14 — Screens & flows (F5 + F8)** | The agent has combination coverage written in Gherkin, and `proto-build` executes all those paths. While-driving restrictions and branch coverage are checked automatically. |
| **Work 16 — Specification integration & PoC reflection (F5 + F7)** | The agent reflects experiment results consistently through `experiment_design` → `design_doc` → `learning_log` → `hypothesis_sheet`. Change management does not break. |

### ② Where agent application is thin / the blank areas

| Area | Why |
|---|---|
| **▲ inquiries to outside parties and other departments (parts of works 3, 5, 6)** | The agent goes as far as storing and summarizing primary sources into `references`. But the response lead time of other departments and research agencies cannot itself be shortened. |
| **Decision-meeting approval and agreement of the departments involved (works 6, 9, 16)** | The agent only leaves evidence in ADR / `learning_log` / `hypothesis_sheet`. The approval event itself is on the human side. |
| **P&L scenario calculation for business viability (work 6)** | The agent covers KPIs and hypothesis management. The financial model calculation itself is delegated to external tools such as Excel. |
| **Fixing the aesthetic design (work 11)** | The agent verifies the soundness of layout and transitions with prototypes, but whether the aesthetics are good is a human judgment. |

### ③ Preparation priorities toward the final report (end of September)

| Priority | Action |
|---|---|
| **Priority 1 — C-layer customization (`Claude.md` / Skills / Rules)** | Consolidate the TYM premises (target vehicle models, SOP, IVI technical constraints, operational constraints) into the C layer, so that F1 (context organization) for works 1–9 can always be launched at maximum speed. |
| **Priority 2 — Consolidating primary sources into `references/`** | Store the TYM project's primary sources into `user_research` / `competitor_analysis` / `market_research`, so F3 (primary-source summarization) takes effect in works 1–3 and 5. |
| **Priority 3 — Extending the `experiment_design` template for IVI trigger conditions** | Extend F4 (experiment design) to the TYM context from the viewpoints of frequency, re-presentation, notification means, and while-driving restrictions, connecting it directly to work 4. |
| **Priority 4 — A drill applying `proto-build` to in-vehicle screens** | Run F5 (automated prototype implementation + verification) end-to-end once on the screen prototypes of works 11 and 14, and confirm how far Playwright can verify while-driving restrictions. |
| **Priority 5 — Writing down the ADR operating rules** | The policy is to concentrate the judgment evidence of works 8, 13, and 16 into ADRs. Embed the granularity, timing, and review structure of F6 (recording judgment evidence) into the process definition document. |
