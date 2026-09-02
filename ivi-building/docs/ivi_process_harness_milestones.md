# IVI Process Agent Harness — Milestone Plan v1

**Document status:** Draft milestone plan
**Source design:** `docs/superpowers/specs/2026-09-01-ivi-process-agent-harness-design.md`
**Source process list:** `others/20260826_IVI_SYS1-2_Planning_Requirements_Definition_Process_List.md`
**Source application map:** `others/20260826_IVI_Process_x_AI_Hypothesis_Driven_Application_Map_v2.md`
**Schedule style:** Capability milestones only, no calendar dates
**Implementation strategy:** One real work item first, then one real activity, then widen

---

## 1. Milestone Strategy

Capability milestones, not calendar dates. Labels use an **H** (harness) prefix so they can never be
confused with the simulator's M0–M8 series.

```text
H0 — Process graph and repo scaffold
H1 — Firewall and domain pack
H2 — One work item, end to end
H3 — The activity loop and the first gate
H4 — Disciplines and registries          → SP1 complete
H5 — Phase ① complete (activities 1–6)   → SP2 complete
H6 — Phase ② complete (activities 7–9)   → SP3 complete
H7 — Phase ③ documents (activities 10–12) 
H8 — Flowcharts, codegen, evidence diff  → SP4 complete
H9 — Report and reuse seam
```

Milestone principle:

> Every milestone should leave the harness able to execute at least one more real work item than
> before, with its evidence auditable by someone who did not watch it run.

**The evidence run is reached at H8**, when a domain pack of upstream primary sources produces a
runnable algorithm package, scenario, and Combined-screen prototype in `generated/`, diffed against
`app/`.

Each milestone is one Spec-Kit feature: **brainstorm → `speckit-specify` → `speckit-plan` →
`speckit-tasks` → subagent-driven TDD**, on its own sequentially numbered feature branch. Milestones
are deliberately coarse; the per-task decomposition belongs to each milestone's own `tasks.md`.

**Two milestones are partially delivered already** — H0's directory tree and H0/H1's context scoping
(`ivi-building/CLAUDE.md`, the repo-root scoping table, `.claude/rules/ivi-building.md`) landed during
design. Each milestone below marks what remains.

---

## 2. H0 — Process Graph And Repo Scaffold

### Goal

Turn the two source documents into machine-readable data, and make the harness directory real. Nothing
executes yet, and the milestone does not pretend otherwise.

### Scope

- `ivi-building/` tree: `.claude/{skills,agents}/`, `hooks/`, `graph/`, `templates/`, `domain/`,
  `runs/`, `prototypes/`, `generated/`, `tests/`. **(delivered)**
- `ivi-building/CLAUDE.md`, repo-root scoping table, `.claude/rules/ivi-building.md`. **(delivered)**
- `ivi-graph-build` skill: a dialogue routine that runs the extractor, presents the findings for human
  triage, and refuses to guess on an edge syntax it has not seen. It holds no orchestration logic.
- **Two generated outputs**, both committed and both byte-identity guaranteed: `graph/process_graph.json`
  (structured, machine-read, the contract H1–H8 consume) and `graph/extraction_report.md` (generated,
  human-read). The report exists because H0's headline numbers — the 215 asymmetries, the 26 off-thread
  items, the 19 human stops — are numbers the final report may quote, and a reviewer who did not watch the
  run should not have to parse JSON to read them. Both are written atomically, so a failed extraction
  leaves committed output untouched; there is no staging path and no overwrite flag.
- The artifact's schema is published as a contract at
  `specs/020-ivi-h0-process-graph/contracts/process_graph.schema.json` and validated against the generated
  artifact by the test suite, so schema drift is a test failure rather than something a reviewer must
  notice by reading.
- `lib/` convention: `ivi-building/lib/` holds the harness's deterministic modules and grows **one flat
  module per milestone that needs one** — no package tree, no placeholders. H0 adds
  `lib/process_graph.py` (parse + derive) and `lib/graph_query.py` (traversal, reused by H3's auditor).
- Node schema per the design §3.2, including the derived fields:
  - `granularity_level` / `granularity_owner` / `human_gate_kind`, and `requires_human` = `fixed` ∧ gate
    kind ∈ {`decision_meeting`, `department_agreement`} — **19 nodes**. A bare *fixed ⇒ human* rule
    over-gates, because the Legend defines *fixed* as "approved by the decision-making meeting, **or
    settled as a fact / record**";
  - `critical_path` / `external_lead_time` / `hard_deadline`, resolved from the Dependency Summary sheet;
  - `conditional_skip`, capturing skips the doc prescribes itself — exactly one, `SYS1-01-e`;
  - `goal_relevant` and `on_thread` as two distinct booleans (design §4.5).
- Edges carry `kind: forward | revisit`. The source's one annotated `(revisit)` back edge is retained as
  data and excluded from ordering; without that, only 71 of 255 nodes sort.
- L2 nodes carry the Application Map's F-ratings (`primary` / `effective` / `auxiliary`) and the process
  list's per-activity Process Overview block (outline, main outputs, owner, departments, completion
  criterion, common pitfall) — H3's gate presentation needs the last two.
- The Dependency Summary transcribed whole: all 10 entries with their resolved node IDs, impact, and
  mitigation. H5's confluence rule and H6/H8's two rework paths read them.
- Goal-thread computation from the terminal set (`SYS2-16-n`, `SYS2-11-n`, `SYS2-14-l`), plus the
  containment rule that a thread holds the parent activity and phase of each on-thread work item.
- Graph test suite (design §7 layer 1).

### Acceptance Criteria

- `process_graph.json` contains exactly 3 L1 + 16 L2 + 236 L3 = 255 nodes.
- Every predecessor/successor ID resolves; edge asymmetries are reported as findings against the source
  document rather than crashing the build — **the count is measured and recorded** (215 at the
  2026-08-26 revision).
- Topological sort succeeds over `forward` edges — all 255 nodes — and exactly one `revisit` edge exists,
  `SYS1-05-f → SYS1-04-e`.
- **The process list's own stated critical path is a connected path in the extracted graph**, all 12
  nodes from `SYS1-01-o` to `SYS2-16-n`. This is the primary extraction test: it validates the parse
  against a claim the document makes independently. *Connected* means **reachable by a directed path** —
  0 of the 11 hops are adjacent edges — and the test says so in its own docstring.
- Every L3 node has ≥1 DoD clause, ≥1 declared output, and a non-empty entry condition.
- Every node whose granularity says "approved at the decision-making meeting" has
  `requires_human: true`; `SYS1-02-r`, whose granularity says "**not yet** approved by the
  decision-making meeting", has `requires_human: false`.
- The computed goal thread contains all 12 critical-path nodes plus `SYS2-11` and `SYS2-14`, with
  `goal_relevant` == 234 and `on_thread` == 210 of the 236 work items.
- Re-running `ivi-graph-build` on an unchanged source document produces byte-identical output in **both**
  generated files, and each committed file equals a fresh extraction. `meta` therefore carries no timestamp.
- **`graph/extraction_report.md` carries every headline number of the milestone** — row counts, edge counts
  by kind, findings by kind with totals, both thread memberships with the off-thread list, and the
  human-stop count — so a reviewer obtains them all without opening the structured artifact and without
  opening either source document.
- The generated artifact validates against the published JSON Schema contract.
- Every labelled bullet in the source is accounted for. `SYS1-08-c` carries an eleventh bullet
  (`Rationale`) that no other row has; it is transcribed, and an unrecognised bullet is a hard failure
  rather than silently dropped content.

### Scope Boundary

No agents, no skills beyond `ivi-graph-build`, no run workspace, no `pack.json`, no firewall hook, no
templates. H0 produces data and tests only.

**Design record:** `docs/superpowers/specs/2026-09-02-ivi-h0-design.md`.

---

## 3. H1 — Firewall And Domain Pack

### Goal

Make the input/output quarantine enforceable rather than aspirational, and give the harness a pack of
upstream primary sources to read.

### Scope

- `pack.json` schema with **phase-scoped** deny lists (`PH1`, `PH2`, `PH3`, `diff`).
- `hooks/firewall.py`, registered as a `PreToolUse` hook on `Read`/`Grep`/`Glob`/`Bash` from the
  repo-root `.claude/settings.json` — the one component that cannot live inside `ivi-building/`,
  because nested settings files are not read for hooks.
- `ACTIVE` marker semantics: with no active run the hook exits immediately and never interferes with
  ordinary work in this repository.
- `ivi-pack-build` skill: index pack sources into `index.md` (what · who provided it · date ·
  confidence), and **tag which slides of the plan-concept decks already carry use cases, requirements,
  issues and personas** so later artifacts can record them as `inherited:` rather than derived.
- **Deck ingestion (design §6.3 “Slide-deck sources”).** For every slide-deck source, produce four artifacts: the
  authoritative `.pptx`, a `.render/slide-NN.png` per slide (PowerPoint COM; `pdftoppm` is unavailable
  here so PNG, not PDF pages), an English per-slide index `.slides.md` (summary · retrieval keywords ·
  inherited/upstream tag), and a `.extract.txt` raw text/table dump as a grep target. Scripts printing
  Japanese must set `PYTHONIOENCODING=utf-8`.
- Enforce the retrieval protocol: **`.slides.md` → slide numbers → only those PNGs.** Never enumerate a
  render directory. This is a context-economy invariant as much as a correctness one.
- `domain/tym/` populated: the upstream primary sources, `inquiries/` (recorded ▲ answers including
  `refused` and `no answer by deadline`), `minutes/`.
- `domain/_template/` skeleton.
- Pack validator + hook test suite (design §7 layer 2).

### Acceptance Criteria

- With an `ACTIVE` marker and the current step in PH1: `Read docs/master/*.md` is denied, a pack read
  is allowed, and `Bash cat docs/master/...` is denied.
- With no `ACTIVE` marker every read is allowed.
- In the `diff` phase, `app/**` is readable and `docs/master/**` is readable; in PH1/PH2 neither is.
- `index.md` lists every pack source with its provider and date, and links each deck's per-slide index.
- **Every deck source has a `.slides.md` covering every slide with no gaps** — slide count in the index
  equals slide count in the deck equals the number of rendered PNGs. A deck with an incomplete index is
  not admitted.
- Each `.slides.md` row carries a summary, retrieval keywords, and an inherited/upstream/borderline tag,
  so an agent can select slides without opening any image.
- Image-only slides (no extractable text) are marked as such in the index, so they are known to require
  a visual read rather than appearing to be empty.
- **The pack validator rejects pre-seeded structured premises.** It cross-checks pack filenames and
  document titles against the output-deliverable names in `process_graph.json`; a match — a planted
  "IVI technical constraints list", "target-premises table", or glossary — is rejected, because those
  are outputs of `SYS1-01-k` / `-j` / `-m` and pre-seeding them turns work items into copy operations.
- The pack validator rejects any file resolving inside a denylisted path.

### Scope Boundary

H1 enforces and validates inputs. It does not read them for any purpose yet — no authoring agent
exists until H2.

---

## 4. H2 — One Work Item, End To End

### Goal

Prove the atomic cycle on one real work item: step brief → authoring subagent → artifact → cold
verifier → ledger.

### Scope

- `step_artifact` template and the artifact front-matter schema (`artifact_id`, `step`, `granularity`,
  `revision`, `derived_from`, `sources`, `inherited`, `ids_introduced`).
- `ivi-step-author` agent — Read/Write/Edit/Grep/Glob, **no Bash**; consumes a step brief carrying the
  process list's three concrete examples **verbatim**, since they are a calibration set written in the
  rest-suggestion domain.
- `ivi-step-verifier` agent — Read/Grep, **no Write**; reads the artifact cold, receiving only the DoD
  clause and the artifact, never the author's reasoning, and votes per clause with quoted evidence.
- Ledger event schema and append-only discipline; `run.json`; `ivi-run-init` (pack selection, thread
  computation, skip plan).
- Structural validators: front-matter completeness, `derived_from` resolvability.
- Seeded-defect test suite (design §7 layer 4).
- Target step: **`SYS1-01-a`** — confirm positioning against higher-level policy. Chosen because it has
  no predecessors and needs only `sources/higher_level_policy/`.

### Acceptance Criteria

- `SYS1-01-a` produces the higher-level-policy mapping table (policy × positioning × expected
  contribution × constraints) with valid front-matter.
- All three of `SYS1-01-a`'s DoD clauses carry an `ivi-step-verifier` verdict in the ledger.
- The artifact's `sources` provenance contains zero denylisted paths, and the firewall logged no denial
  during the run.
- The ledger replays to identical state in a fresh session.
- **Seeded-defect catch rate is measured and recorded.** Inject ~10 known DoD violations into a passing
  artifact — strip a falsification condition, remove a decision source, leave a changeable value
  `PROV-`-untagged, insert "appropriately" into a requirement — and assert the verifier fails the
  specific clause covering each. This is the milestone's most important criterion: if the cold verifier
  rubber-stamps, every artifact produced after H2 is worthless.

### Scope Boundary

One step, no orchestration, no gate, no skip logic. The human runs the step by hand.

---

## 5. H3 — The Activity Loop And The First Gate

### Goal

Run all 15 work items of `SYS1-01` under orchestration, with one human gate, and prove send-back and
skip behave as scoped operations rather than blunt restarts.

### Scope

- `ivi-run` orchestrator skill: resolve the next runnable step, dispatch author → verifier, retry,
  escalate, open the gate.
- Topological ordering of internal edges within an activity; activity-level unlock on predecessor
  approval.
- Bounded retry with revision bump; on exhaustion the step escalates to the gate carrying its failure
  rather than looping.
- Gate presentation: declared output deliverables, DoD table, new registry entries, assumptions taken,
  skipped-step list.
- Gate responses: **approve** / **send back with feedback** / **approve with conditions**.
- Send-back scoping: invalidate the targeted step and its internal successors only.
- Skip machinery: `skipped_conditional`, `skipped_off_thread`, `skipped_by_user`, kept distinct in the
  ledger; stub emission at `granularity: skipped`; `dod_blocked` marking.
- Assumption handling: a missing declared input becomes a recorded assumption with an owner and a
  deadline, never invention.
- Cross-session resume from `run.json` + ledger + front-matter.
- Loop-invariant test suite (design §7 layer 3), which doubles as the run auditor.

### Acceptance Criteria

- All 15 work items of `SYS1-01` produce an artifact or a stub with a recorded reason.
- Every DoD clause across the activity carries a verifier verdict.
- **`SYS1-01-e` is conditionally skipped** when `inquiries/` shows no existing PoC results — the
  cleanest available test of the skip machinery, because the process list prescribes this exact skip:
  *"if none exist, skip this work item and treat the matter as a hypothesis."*
- The planning-premises summary and undecided-items list exist, and **every undecided item has an owner
  and a deadline** — `SYS1-01-o`'s literal DoD.
- A deliberate send-back at `SYS1-01-c` re-runs `-c` and its internal successors only; untouched
  siblings remain at revision 1.
- A skipped step that is the sole source for a downstream DoD clause causes that clause to report
  `dod_blocked`, never pass.
- Killing the session mid-activity loses at most the step in flight; replay resumes at the correct step.
- One gate opened, its decision logged.

### Scope Boundary

The generic authoring worker only. No F-discipline enforcement yet, so hypotheses are not required to
carry falsification conditions until H4 — `SYS1-01`'s output is structurally correct but not yet
discipline-gated.

---

## 6. H4 — Disciplines And Registries — SP1 Complete

### Goal

Attach the F-disciplines that make output trustworthy, and stand up the living registries that carry
state across activities.

### Scope

- The discipline rule table (design §5.4), keyed on each step's declared output shape.
- **F3** — `ivi-references-researcher` as a pre-pass before an activity's first step, every claim
  citing its origin by slide anchor (`<deck>.pptx#slide-14`), written to `artifacts/_references/`.
  For deck sources it follows the design §6.3 “Slide-deck sources”: read the `.slides.md` index, choose
  slide numbers, open only those renders.
- **F1 / F2** — `ivi-discovery-init`: context organization, and hypotheses at the granularity of
  1 question = 1 hypothesis = 1 falsification condition. Abstract wording does not pass.
- **F9** — `ivi-issues`: post-pass routing of anything unresolved to the hypothesis sheet (as an
  unverified hypothesis) or the backlog (as a carry-over item).
- **F6** — `ivi-adr`: options / decision / rationale / rejected alternatives / conditions in one file,
  plus a `conditions.md` row. Required by *approve with conditions*, which exists from H3, so F6 is
  cross-cutting from the first gate onward.
- Living registries: `hypotheses.md`, `backlog.md`, `constraints.md`, `glossary.md`, `conditions.md`,
  `learning_log.md`, `adr/`, and `ids.json` as the single allocator for `HYP-`, `ISS-`, `UC-`, `REQ-`,
  `ADR-`, `PROV-`.
- Templates: `project_brief`, `product_constraints`, `hypothesis_sheet`, `backlog`, `adr`, `conditions`.
- Pack-level template override resolution (`domain/<pack>/templates/`).

### Acceptance Criteria

- `SYS1-01` re-runs green under discipline enforcement.
- `hypotheses.md` is non-empty and **every entry has a falsification condition**; an entry without one
  fails its DoD clause.
- The F3 pre-pass runs before `SYS1-01-a`, and at least one work item's artifact cites a reference
  summary rather than reading a raw source directly.
- Approving `SYS1-01` *with conditions* writes an ADR carrying both the condition and the alternative
  if unmet, and opens a `conditions.md` row.
- `ids.json` allocates without collision across two consecutive activities.
- A pack template override is picked up in preference to the harness template.
- SP1's nine acceptance criteria (design §9) all pass.

### Release Meaning

H4 completes **SP1**. The harness can now execute any activity whose primary functions are F1/F2/F3/F6/F9
— which by the Application Map's ratings covers activities 1, 2, 6, 7, 8, and 9.

---

## 7. H5 — Phase ① Complete — SP2 Complete

### Goal

Walk the whole planning brush-up: six activities, six gates, ending in a plan document.

### Scope

- **F4** — `ivi-experiment-design`: success criteria, UX flow, drop-off points, measurement methods,
  risks; fixes the shared design premises and the explicit branching axis across variants A/B/C.
  Primary in activity 4 (experience scenarios and trigger conditions).
- Pack-level F4 template extension for the IVI context — frequency, re-presentation, notification
  means, while-driving restrictions — which is the Application Map's own Priority 3.
- **Record-ingest steps**: the ~20 work items whose declared output is *minutes* of a meeting or
  hearing read from `minutes/` or `inquiries/`, or gate to the human. **They are never generated.**
- ▲ external-lead-time handling at scale: activities 2, 3, 5, and 6 resolve interview, research, and
  data-provision steps from recorded pack answers, or mark them blocked.
- The confluence rule: activity 6 cannot narrow the plan until activities 4, 5, and 6's own drafts all
  exist, per the Dependency Summary's plan-narrowing confluence.
- Off-thread auto-skip exercised at scale, with the skipped list surfaced at each of the six gates.

### Acceptance Criteria

- Six gates passed, each with its decision logged.
- The plan document exists, and the value proposition is stated in one sentence with its supporting
  evidence and falsification hypotheses linked.
- **Trigger-condition variants A/B/C are compared with an explicit branching axis**, one adopted, and
  the rest recorded as ADR alternatives — activity 4's stated completion criterion.
- Every hypothesis on the sheet carries a falsification condition and a status.
- No minutes artifact was generated by an agent; each traces to a pack file or a human gate.
- Steps whose ▲ answer is `refused` or `no answer by deadline` produce a conditional decision with a
  stated alternative, not a silent assumption.
- The coverage report distinguishes conditionally-skipped from off-thread from user-skipped.

### Scope Boundary

No prototypes yet. Activity 4's variant comparison is designed and recorded, but not built — F5 lands
in H7, so H5's comparison is on paper.

---

## 8. H6 — Phase ② Complete — SP3 Complete

### Goal

Surface, settle, and hand over: the issue list, the handling policies, the baselined system issue list,
and the graduation event that routes decisions into constraints.

### Scope

- **F9 at ◎ scale** — issue extraction across every Phase ① document at the granularity of
  1 issue = 1 question, with classification, dependencies, priority, decision-maker, and deadline.
- Handling-policy ADRs per issue: which option, and why the others were rejected.
- Conditional decisions tracked in `conditions.md` with their alternatives.
- System issue list baseline; change-management and weekly operating rules.
- **Graduation** — the second gate type. Criteria evaluated against the hypothesis sheet; passing routes
  every settled decision into `constraints.md` and every hold into `backlog.md`. Lands on activity 9,
  which is why activity 9 rates F1◎: the Application Map is saying activity 9 *is* the graduation event.
- **F7 (partial)** — `ivi-experiment-review` for status reflection, plus the gate distinguishing
  *a design hypothesis being wrong* from *the product hypothesis being wrong*.
- `ivi-retro` — weekly retrospective over `learning_log`, orthogonal to the activity gates.
- **Reopen propagation**, exercised for real: an unmet condition flips to its alternative along the
  Dependency Summary's path `SYS1-08-h → SYS1-09-b → SYS2-12-f, SYS2-13-e`.

### Acceptance Criteria

- The issue list is fixed, and every issue has a decision, a rationale, and — where conditional — a
  stated alternative recorded in an ADR.
- A `graduation` event is logged, and `constraints.md` / `backlog.md` are populated **by routing, not by
  hand** — the design's decision→constraint / hold→unresolved branch.
- Nine gates total passed across Phases ① and ②.
- **One reopen is exercised end to end:** a change request names the affected artifacts and clauses, a
  dedicated reopen gate approves it, and the reopened `fixed` artifact demotes to `draft` and is
  re-approved. Without demotion the harness would reproduce the pitfall `SYS2-16` names — provisional
  values fixed as final, change management broken.
- At least one `ivi-retro` pass is recorded in `learning_log.md`.

### Release Meaning

H6 completes **SP3**. Phases ① and ② are fully walkable, and the handover state the process list calls
the requirements-definition kickoff input exists.

---

## 9. H7 — Phase ③ Documents

### Goal

Convert the plan into specification documents an implementation decision can be made from: use cases,
screens, and a requirements list whose every entry is verifiable.

### Scope

- **F8** — `ivi-acceptance`: `story.md` + `acceptance.feature` created as a pair, Gherkin
  Given/When/Then for the basic flow, Scenario Outline for condition combinations, and an explicit
  edge-cases section so abnormal flows cannot be left blank.
- UC-ID and REQ-ID allocation and freezing; the traceability matrix generated from the
  `story` ↔ `acceptance.feature` correspondence.
- **`ivi-diagram-author`** — Mermaid/PlantUML for the use-case diagram and the screen transition
  diagram, validated by parse.
- **F5 first use** — `ivi-proto-build` for activity 11's screens: `ivi-proto-implementer` writes HTML
  prototypes into `prototypes/<run-id>/`, `ivi-proto-validator-naive` follows the ⭐ core steps blind,
  `ivi-proto-validator-inspector` hunts the failure, both under Playwright with a 3-level verdict, a
  bounded fix loop, and automatic before/after screenshots.
- `PROV-` tagging enforced at authoring time for thresholds, character limits, and timeouts.
- Activities 13 and 15 (function allocation, sequence diagrams) are **off-thread and auto-skipped**,
  emitting stubs with backlog items. The coverage report records this; the report must not claim them.

### Acceptance Criteria

- UC-IDs are frozen, with basic, alternative, and exception flows written in Gherkin for every use case.
- REQ-IDs are frozen, and **every requirement has acceptance criteria a pass/fail verdict can be made
  from**. A requirement whose acceptance criteria cannot be written is sent back as "no verdict
  possible" rather than accepted.
- The vague-wording check rejects "appropriately", "quickly", and equivalents.
- **The traceability matrix has zero dangling IDs**, verified by a structural validator rather than by
  reading.
- The screen prototype passes its ⭐ core steps under both validators.
- The while-driving restriction is actively verified: the "stop accepting input" condition is written in
  Gherkin and confirmed against the prototype, not merely asserted in prose.
- Diagrams parse, and the transition diagram's states reconcile with the screen list.
- Stubs exist for activities 13 and 15 with `dod_blocked` accounting for any clause that depended on
  them.

---

## 10. H8 — Flowcharts, Codegen, Evidence Diff — SP4 Complete

### Goal

Reach the evidence run: branch-complete flows, a runnable algorithm package and Combined-screen
prototype in `generated/`, and an honest diff against what humans built.

### Scope

- **Activity 14 — flowcharts**, pulled onto the thread despite being off the documented critical path,
  because trigger determination, suppression priority, frequency control, response handling, and
  abnormal handling are exactly what the algorithm encodes. Condition combinations expand into a Gherkin
  Scenario Outline; branch traversal is executed and counted.
- **`ivi-codegen` (F10, an extension beyond the Application Map)** — fixed UC + REQ + Gherkin produce,
  into `generated/<run-id>/`: an algorithm package (manifest + `algorithm.py`), a scenario JSON, a route
  preset, and a Combined-screen prototype.
- Structural validators for generated output: package manifest schema, scenario schema.
- **Activity 16** — specification integration, consistency and traceability checks, and PoC-result
  reflection through `experiment_design` → `design_doc` → `learning_log` → `hypothesis_sheet`.
- **Reopen from PoC results**, the second rework path: a PoC changes a `PROV-`-tagged requirement value,
  the affected set is computed by tag search, a reopen gate approves, and the requirements, screens, and
  flows demote and re-approve.
- **`ivi-evidence-diff` (F11, an extension)** — derived-vs-inherited accounting, the coverage report,
  and the behavioral diff, which reuses `scripts/calibrate_forecast_demo.py` (this repository's
  documented reference harness) pointed at the generated package.

### Acceptance Criteria

- The generated package loads in the simulator's package registry and evaluates without error.
- The generated scenario runs to completion through the existing tick engine.
- **A behavioral diff report exists**, comparing the generated algorithm's fire points against a shipped
  package on the same route, produced by the calibration harness rather than by inspection.
- **The coverage report gives all five counts** per activity: executed, conditionally-skipped,
  off-thread, user-skipped, `dod_blocked`.
- **Three counts are reported separately, not two.** *Inherited* — content traceable to a pack source
  anchor; the claim is reformatting and traceability, never derivation. *Derived* — output carrying no
  `inherited:` ID, which in practice means the verifiability layer: exception and alternative flows,
  Gherkin acceptance criteria, falsification conditions, ADRs with rejected alternatives, the issue
  list, the traceability matrix, branch coverage, and the runnable package. *Gap count* — how many
  inherited requirements arrived with **no acceptance criteria and no recorded rationale**. See design
  §6.2 “What the evidence claim actually is”; the pack's own index holds the per-slide tag map.
- **The gap count is the headline number.** It is a property of the customer's own source material
  rather than an assertion about the harness, which makes it the hardest number in the report to
  dispute. The richer source deck's use cases are basic flows only — exactly the pitfall `SYS2-10`
  names — so closing that is a measurable derivation result.
- The PoC-driven reopen is exercised: a `PROV-` value changes, the affected set is found by tag search,
  and every affected artifact demotes and is re-approved.
- The full traceability chain resolves from a generated code artifact back through REQ-ID → UC-ID →
  hypothesis → pack source.
- Sixteen gates total have been passed across the three phases.

### Release Meaning

H8 is the **evidence run**. It is the milestone the final report is written from.

---

## 11. H9 — Report And Reuse Seam

### Goal

Produce the deliverable, and prove the harness is a tool rather than a one-off by initializing a second
pack.

### Scope

- Final report assembled from measured numbers, not claims: coverage counts, seeded-defect catch rate,
  derived-vs-inherited split, behavioral diff, gate and reopen history.
- Close out the Application Map's own preparation priorities: C-layer customization (delivered as the
  CLAUDE.md / rules scoping), primary-source consolidation into the pack, the F4 IVI template
  extension, the `proto-build` in-vehicle drill, and **the ADR operating rules written down** —
  granularity, timing, and review structure — which is Priority 5.
- Validate `domain/_template/` by creating a second pack and running H0–H2's cycle against it.
- Document the F10/F11 extensions explicitly as extensions.

### Acceptance Criteria

- Every quantitative claim in the report traces to a ledger event, a test result, or a diff artifact.
- The report states plainly what the harness did **not** do: the ▲ steps whose lead time it cannot
  shorten, the approval events that remain human, the activities skipped off-thread, and the content
  inherited rather than derived.
- A second pack created from `_template` runs `SYS1-01-a` green with no harness code changes.
- The ADR operating rules exist as a document, not as tribal practice.

---

## 12. Schedule Reality

The Application Map names an end-of-September final report. Stated plainly:

- **H0–H4 (SP1) is the credible core.** It is mostly deterministic work — extraction, a hook, a loop,
  and two agents — and it is where the reusable value sits. If only this lands, the harness genuinely
  works on real work items and the report can show it.
- **H5–H6 widen coverage** and are largely more of the same machinery applied to more activities. Risk
  is schedule, not feasibility.
- **H7–H8 carry the real risk.** F5's Playwright loop and the codegen terminal are the two places where
  an unknown could cost days, and H8 is the only milestone whose output is executable code.
- **Fallback if H8 is at risk:** narrow the codegen target from *package + scenario + route preset +
  Combined-screen prototype* to *package + scenario only*, which the existing test suite and calibration
  harness can already validate end to end. The behavioral diff — the strongest single piece of evidence
  — survives that narrowing intact. Drop the prototype before dropping the diff.

Milestones are capability-defined, so a milestone slipping changes the report's scope, never its
honesty.

---

## 13. Evidence-Run Boundary Summary

The evidence run **includes**:

- the process graph extracted from the source documents, with its critical path verified;
- an enforced input/output quarantine, with per-artifact provenance;
- a swappable domain pack of upstream primary sources, with inherited content tagged;
- all three phases walked along the critical path plus `SYS2-11` and `SYS2-14`;
- 16 activity gates, plus the graduation gate and at least two reopen gates;
- nine F-disciplines enforced as DoD clauses, with a measured verifier catch rate;
- a runnable algorithm package and scenario in `generated/`, behaviorally diffed against `app/`;
- a coverage report separating executed, skipped, and blocked work.

The evidence run **excludes**:

- real user interviews, department inquiries, and research — recorded answers only;
- decision-meeting approval and inter-department agreement, which remain human events;
- P&L modelling;
- aesthetic design judgment;
- activities 13 and 15, auto-skipped off-thread and reported as such;
- parallel execution of the graph's parallelizable branches;
- any claim of derivation for content inherited from a pack source;
- regeneration of the whole simulator — the target is the Combined screen slice.
</content>
