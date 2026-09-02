# IVI Process Agent Harness — Design

*Date: 2026-09-01 · Status: approved for planning · Root directory: `ivi-building/`*

## 1. Purpose

The AICA Hypothesis Simulator is the *output* of a planning-and-PoC process, not the end goal. The
goal is to formalize that process so it can be re-run: an agent system that walks the documented IVI
SYS.1–SYS.2 planning and requirements-definition process step by step, with human review between
steps, and terminates in **runnable output** — algorithm packages, scenarios, and a Combined-screen
prototype — as evidence that the harness actually works.

Two source documents define what is being automated:

- `others/20260826_IVI_SYS1-2_Planning_Requirements_Definition_Process_List.md` — the work breakdown:
  3 phases (L1) → 16 activities (L2) → **236 work items** (L3). 255 rows total = 3 + 16 + 236.
  Each L3 row carries purpose, work content, input deliverables + source, output deliverables,
  granularity, predecessor/successor, entry condition, exit DoD, and three concrete examples.
- `others/20260826_IVI_Process_x_AI_Hypothesis_Driven_Application_Map_v2.md` — the overlay: nine agent
  functions F1–F9, rated ◎/◯/△/－ per activity, each naming the skill and template that delivers it.

Neither the F1–F9 skills nor their templates exist yet. A repo-wide search finds those names only
inside the Application Map. This design specifies building them.

## 2. Scope and decisions

Decisions taken during design, with their rationale:

| # | Decision | Rationale |
|---|---|---|
| D1 | Runnable harness in this repo, terminating in executable output | The evidence claim requires running code, not documents |
| D2 | Depth-first: one thread through all 3 phases | Proves the whole chain; breadth-first proves nothing runs |
| D3 | Thread = the doc's own critical path (12 nodes) **+ `SYS2-11` + `SYS2-14`** | Screens and flowcharts are off the critical path, but the Combined-screen target needs the screens and the algorithm needs the branch logic. Activities 13 and 15 stay off-thread. |
| D4 | Target = the **Combined screen** slice, not the whole simulator | Bounded enough to finish; richest part of the app |
| D5 | **16 gates, one per activity**, with self-verified DoD inside | 236 gates is unworkable; 3 gates lets a wrong turn burn a phase |
| D6 | Loop, not one-shot: feedback → refine → re-present | A single pass cannot produce a working app |
| D7 | Write target = `ivi-building/generated/<run-id>/`, diffed against `app/` | Measurable evidence, zero risk to working code |
| D8 | Inputs are a swappable **domain pack**; TYM is pack #1 | The TYM-injection seam, and the path to reuse |
| D9 | **`docs/master/` is output, never input** — enforced by a hook | If the answer leaks into the inputs the evidence is worthless |
| D10 | Raw sources in, structured premises derived | Pre-seeding an IVI-constraints list turns `SYS1-01-k` into a copy operation |
| D11 | CDC-SU inherited content is **tagged and subtracted** | It is a legitimate input, but UCs sitting on slide 1 are inherited, not derived |
| D12 | Off-thread steps auto-skip, listed at each gate | Fastest run with full visibility; nothing silent |
| D13 | Orchestration is skill-driven; Claude Code *is* the orchestrator | A Python engine re-walking a graph would be a worse copy of the session |
| D14 | Non-model code only where execution or enforcement is required | Graph extraction (once), firewall hook, structural validators, behavioral diff |
| D15 | Everything lives under `ivi-building/`; sessions run with cwd there | Self-contained and liftable; nested skills/agents need cwd rooted there |

**Non-goals.** Aesthetic design judgment. Real user interviews or department inquiries (the process
docs mark these ▲ and state their lead time cannot be shortened). P&L modelling. Decision-meeting
approval. Parallel execution of the graph's parallelizable branches — the edges are recorded, but v1
runs sequentially.

## 3. Architecture

Seven components:

1. **Process graph** — the 255 rows extracted once into `graph/process_graph.json`. Afterwards it is
   read-only data; no code runs at runtime.
2. **Domain pack** — `domain/<pack>/`, holding raw primary sources, recorded inquiry answers, meeting
   minutes, and optional template overrides. Swap the pack, keep the harness.
3. **Skills** — 14 dialogue routines, one of which (`ivi-run`) is the orchestrator.
4. **Agents** — 7 agent files doing the actual authoring, verification, and research in fresh
   contexts.
5. **Templates** — 13 recording media, overridable from the pack.
6. **Run workspace** — `runs/<run-id>/`: per-step artifacts, living registries, and an append-only
   ledger from which all run state is derived.
7. **Firewall + validators** — a `PreToolUse` hook enforcing the input/output quarantine, plus
   structural checks and the behavioral diff.

### 3.1 Directory layout

```
ivi-building/
  README.md
  .claude/
    skills/ivi-*/SKILL.md        # 14 skills
    agents/ivi-*.md              # 7 agent files, models pinned explicitly
  hooks/firewall.py              # registered from the repo-root .claude/settings.json
  lib/*.py                       # deterministic modules, one flat file per milestone that needs one
  graph/process_graph.json       # read-only data, committed; never hand-edited
  templates/*.md
  domain/
    _template/                   # empty skeleton for the next project
    tym/
      pack.json                  # phase-scoped allow/deny lists
      index.md                   # what is here · who provided it · date · confidence
      sources/
        higher_level_policy/     # mid-term plan, connected strategy, planning policy
        product_plan/            # target-model plan, equipment plan, schedule (SOP, spec-freeze)
        ivi_platform/            # platform spec, vehicle-signal API spec, OTA scope
        operations/              # existing operating rules, support structure
        plan_concept/            # the customer's own plan documents
          <deck>.pptx            #   authoritative binary
          <deck>.slides.md       #   English per-slide index — THE retrieval entry point
          <deck>.render/         #   slide-NN.png per slide, + a PDF
          <deck>.extract.txt     #   raw python-pptx text/table dump, a grep target
        user_research/  competitor_analysis/  market_research/  misc/
      inquiries/                 # recorded ▲ answers, incl. "refused" / "no answer by deadline"
      minutes/                   # records of real meetings; never generated
      templates/                 # pack-level template overrides
  runs/<run-id>/
    run.json  ledger.jsonl
    artifacts/<ACTIVITY>/*.md
    artifacts/_references/*.md
    registry/
      hypotheses.md  backlog.md  constraints.md  glossary.md
      learning_log.md  adr/ADR-*.md  conditions.md  ids.json
  prototypes/<run-id>/           # F5 HTML prototypes (the doc's own directory name)
  generated/<run-id>/            # codegen terminal: packages, scenarios, Combined prototype
  tests/                         # pytest over the graph, hook, loop invariants, seeded defects
```

The `sources/` categories are the process doc's own **"Input source"** column, one folder per
providing party. The four research buckets are named verbatim from F3 so `references-researcher`
finds what it expects.

`prototypes/` and `generated/` are distinct on purpose: the Application Map's F5 writes HTML
prototypes to `prototypes/`, whereas the codegen terminal emits algorithm packages and scenarios.
Different artifacts, different lifetimes.

### 3.2 Process graph schema

The L3 rows are regularly formatted, so one extraction pass suffices. `SYS1-01-c` becomes:

```json
{
  "id": "SYS1-01-c", "level": "L3", "parent": "SYS1-01", "phase": "PH1",
  "name": "Separate decided items, hypotheses, and undecided items",
  "purpose": "Separate what is settled from what is a hypothesis, and clarify what needs verification.",
  "work_content": "...",
  "inputs": ["One-page plan summary", "Higher-level-policy mapping table"],
  "input_sources": ["own department (plan concept)", "planning owner"],
  "outputs": [{ "name": "Separation table for decided / hypotheses / undecided items",
                "shape": "statement × classification × evidence × verification policy" }],
  "granularity_level": "draft", "granularity_owner": "before confirmation by the planning owner",
  "human_gate_kind": "none", "requires_human": false,
  "predecessors": ["SYS1-01-a", "SYS1-01-b"],
  "successors": ["SYS1-01-d", "SYS1-01-o", "SYS1-02-a", "SYS1-06-a"],
  "entry": "The one-page plan summary has been created",
  "exit_dod": [
    { "index": 1, "clause": "Every statement is classified into one of the three categories" },
    { "index": 2, "clause": "Every hypothesis has a verification policy attached" },
    { "index": 3, "clause": "Every decided item records the source of the decision" }
  ],
  "examples": ["Classify 'the target is our own connected-capable vehicles' as decided (source: product planning policy)…"],
  "critical_path": false, "external_lead_time": false, "hard_deadline": false,
  "conditional_skip": null, "goal_relevant": true, "on_thread": true
}
```

Fields derived rather than transcribed (measured against the source in H0):

- **`granularity_level` / `granularity_owner` / `human_gate_kind` / `requires_human`.** The granularity
  column carries two independent facts — a completeness level and who signs off — so it splits into a
  level (*rough* / *draft* / *fixed*) and the verbatim qualifier, from which a gate kind is classified
  (`decision_meeting` · `department_agreement` · `owner_approval` · `review_confirm` · `record` ·
  `none`). **`requires_human` = `fixed` ∧ gate kind ∈ {`decision_meeting`, `department_agreement`} — 19
  nodes.** A simple *fixed ⇒ hard stop* rule would over-gate: the Legend defines *fixed* as "approved by
  the decision-making meeting, **or settled as a fact / record**", and 12 `fixed` nodes are inquiry or
  analysis records where no party approves anything; a further 35 read "confirmed by the planning
  owner", which is what the 16 activity gates already are. Recording the gate kind on all 255 nodes lets
  H3 widen the hard-stop set without re-extracting.
- **`exit_dod` carries `{index, clause}` only.** Per-clause `requires_human` is *not derivable from the
  source document*, which states no per-clause signoff. Per-clause verification routing (structural /
  semantic / human, §4.3) is assigned by H2's verifier, where the information to assign it first exists.
- **`critical_path` / `external_lead_time` / `hard_deadline`** are resolved from the Dependency Summary
  sheet, so a revised source moves them automatically rather than requiring a code change.
- **`conditional_skip`** captures skips the doc itself prescribes. Exactly one exists: `SYS1-01-e`,
  *"if none exist, skip this work item and treat the matter as a hypothesis."*
- **`goal_relevant` / `on_thread`** are two distinct booleans, for the reason given in §4.5.

L2 nodes additionally carry the Application Map's F-ratings:
`{"primary": ["F1"], "effective": ["F2","F3","F9"], "auxiliary": []}`. Ratings are per activity, which
is why F-skills are capabilities an activity composes rather than one skill per activity.

### 3.3 Artifacts, registries, and the ledger

Per-step artifacts and living registries have different lifecycles and are kept apart: an artifact is
one step's output and changes only by revision, whereas the hypothesis sheet, constraints list,
backlog, and ADR set are written by many activities across the run. `ids.json` is the single allocator
for `HYP-`, `ISS-`, `UC-`, `REQ-`, `ADR-`, and `PROV-` so IDs never collide.

Every artifact carries front-matter:

```yaml
artifact_id: SYS1-01-c/separation_table
step: SYS1-01-c
granularity: draft          # rough | draft | fixed | skipped
revision: 1
derived_from: [SYS1-01-a/higher_level_policy_mapping, SYS1-01-b/one_page_plan_summary]
sources: [domain/tym/sources/plan_concept/cdc_su_specplan.md#slide-1]
inherited: [UC-draft-01]    # content traceable to a pack source, not derived
ids_introduced: [HYP-001, HYP-002, ISS-003]
```

`sources` is the audit trail proving no denylisted path entered the provenance chain: the hook
prevents, the provenance proves. `inherited` implements D11.

**Run state is derived from `ledger.jsonl`, never stored separately.** Events: `run_started`,
`step_started`, `artifact_written`, `dod_checked`, `step_skipped`, `gate_opened`, `gate_decision`,
`activity_approved`, `reopen_requested`, `reopen_approved`, `graduation`, `retro`. A separate state
file would become a second source of truth and drift the first time a session dies mid-activity —
and resuming across sessions is the normal case here. Append-only also matches the invariant the
simulator itself runs on.

## 4. The runner loop

### 4.1 Unlock and ordering

An activity opens when every predecessor activity is approved. Within it, steps run in topological
order of the internal edges. Cross-activity edges still matter — as input resolution, telling a step
which upstream artifact to read.

### 4.2 Running a work item

The runner builds a **step brief** from the graph node — purpose, work content, inputs resolved to
real paths, declared output columns, DoD clauses, and the doc's three concrete examples — and hands it
to `ivi-step-author` as a subagent.

The examples are passed **verbatim, not paraphrased**: the doc supplies three worked examples per work
item, in the rest-suggestion domain, which is our domain. It is a calibration set as much as a
process description.

Every authoring step runs in a **fresh subagent**. This is a firewall requirement, not a token
optimization: a hook cannot unlearn what is already in a context window, so the quarantine is only
credible because authoring starts from nothing but the step brief and the pack.

**Missing input never becomes silent invention.** If a declared input is absent from the pack, the
step records an assumption with an owner and a deadline and registers a backlog item — which is what
`SYS1-01-o`'s DoD already requires ("every undecided item has an owner and a deadline"). Assumptions
are listed at the gate.

### 4.3 DoD verification

Per clause, one of three routes:

- **Structural** — IDs resolve, every declared column present, every hypothesis has a falsification
  condition, every changeable value carries a `PROV-` tag. Deterministic validator.
- **Semantic** — `ivi-step-verifier` reads the artifact **cold**, receiving only the clause and the
  artifact, never the author's reasoning, and votes per clause with quoted evidence. It has no write
  tool, so it cannot fix what it grades. Author self-grading is close to worthless; this pattern is
  the Map's own (`proto-validator-naive` / `-inspector`) applied to documents.
- **Human** — hard stop, even mid-activity, per `requires_human`.

A failed clause triggers revise-in-place with a revision bump and a **bounded** retry count; on
exhaustion the step escalates to the gate carrying its failure rather than looping. F5's spec sets the
same discipline: "a fix loop until a pass/fail verdict is reached, with an upper bound."

### 4.4 The gate

When every step in the activity has a recorded verdict, the gate presents the activity's declared
output deliverables, the DoD table, what is newly on the hypothesis sheet / backlog / ADR set, the
assumptions taken, and the skipped-step list. Three responses:

- **Approve** — granularity set per the doc's column; `activity_approved` logged; successors unlock.
- **Send back with feedback** — feedback is mapped to specific steps; those artifacts and their
  *internal successors only* are invalidated and re-run with bumped revisions. Untouched siblings are
  left alone, which is the whole reason for holding a graph rather than a checklist. Feedback text is
  logged so a re-run cannot lose it.
- **Approve with conditions** — first-class, because `SYS1-08` sorts issues into decided /
  conditionally decided / on hold. Writes an ADR carrying the condition *and* the alternative if
  unmet, and opens a row in `conditions.md`.

### 4.5 Skip and bypass

Goal-relevance is computed, not guessed: a step is **`goal_relevant`** iff it is an ancestor of a
terminal node (`SYS2-16-n`, `SYS2-11-n`, `SYS2-14-l`; the codegen outputs are not graph nodes and so
cannot be terminals).

**That computation alone does not yield the thread, and H0 measured why.** Over the source document's
real edges, 234 of 236 work items are ancestors of a terminal — including every item of activities 13
and 15, which genuinely feed `SYS2-16-e`/`-c`. Taken alone it would contradict D3 and D12 and make
`skipped_off_thread` near-vacuous. So the graph carries **two** booleans with distinct, honest meanings:

- **`goal_relevant`** — pure ancestry from the terminal set. **234** L3 nodes.
- **`on_thread`** — `goal_relevant` ∩ nodes whose parent activity is in `thread_activities`, D3's
  declared selection of 14 activities (`SYS1-01`…`SYS1-09`, `SYS2-10`, `SYS2-11`, `SYS2-12`, `SYS2-14`,
  `SYS2-16`; excluding `SYS2-13` and `SYS2-15`). **210** L3 nodes.

A thread contains the parent activity and phase of every on-thread work item — parent/child is not an
edge, so `SYS2-11` the activity is not an ancestor of `SYS2-11-n`. Off-thread is therefore **26** L3
nodes: `SYS2-13` ×12, `SYS2-15` ×12, `SYS2-16-o`, `SYS2-16-p`. `skipped_off_thread` keys on
`on_thread == false`.

Three skip kinds stay distinct in the
ledger, because conflating them would let the final report claim clean coverage over a waived thread:

- `skipped_conditional` — the doc prescribes it. Not a deviation.
- `skipped_off_thread` — no path to a terminal node. Auto-skipped per D12, listed at the gate.
- `skipped_by_user` — an overridden goal-relevant step. Always carries a reason.

**A skip emits a stub, never a hole.** `SYS2-10`'s work content already includes "placeholder premises
for unresolved items", so a skipped step writes an artifact at `granularity: skipped` stating what it
would have produced, the assumption downstream consumers must adopt, and a backlog item with an owner.

**Safety property: a skip must never become a false pass.** If a skipped step is the only source for a
downstream DoD clause, that clause is marked `dod_blocked` and raised at the gate. Skip `SYS1-01-k`
(IVI technical constraints) and `SYS2-12`'s non-functional requirements lose their basis, so those
clauses report blocked rather than passing on invented constraints.

`run.json` declares the skip plan up front so a run is reproducible; gate-time skips append to the
ledger with the same fields. The run ends with a **coverage report**: executed / conditionally-skipped
/ off-thread / user-skipped / dod-blocked, per activity. That is the number the final report quotes.

### 4.6 Reopening an approved activity

The Dependency Summary names two rework paths: PoC results changing requirement values
(`SYS2-16-i → -j → requirements, screens, flows, sequences`) and an unmet condition flipping to its
alternative (`SYS1-08-h → SYS1-09-b → SYS2-12-f, SYS2-13-e`).

Reopening is **explicit and scoped, never an automatic cascade**. The runner computes the affected set
(transitive successors ∩ approved artifacts), writes a change request naming the artifacts and clauses
hit, and **opens a dedicated gate** — revising an approved deliverable is a change-management event,
not an agent's call.

Two mechanics make this real rather than aspirational:

- **`PROV-` tags.** `SYS2-16` prescribes tagging values that may change — thresholds, character
  limits, timeouts — with a provisional value and an issue ID. The runner *requires* this at authoring
  time, so the affected set is a search for the tag rather than a guess about semantic impact.
- **Granularity demotion.** A reopened `fixed` artifact drops to `draft` and must be re-approved.
  This is the direct counter to the pitfall `SYS2-16` names: "provisional values get fixed as final
  and change management stops working." Without demotion the harness reproduces that exact failure.

### 4.7 Graduation and the weekly retrospective

Two mechanisms the Application Map defines that are not activity gates:

- **Graduation** (F7: "if the graduation criteria are met, it also guides the graduation decision";
  §3-⑨: "the agent's graduation process is built exactly around the 'decision → constraint, hold →
  unresolved' branch"). A **second gate type**, evaluated against the hypothesis sheet; passing routes
  every settled decision into `constraints.md` and every hold into `backlog.md`. It lands on activity
  9, which is why activity 9 rates F1◎ — the doc is saying activity 9 *is* the graduation event.
  `graduation_criteria` lives in `run.json`; passing emits a `graduation` ledger event.
- **Weekly retrospective** (§3-⑨: "reviewing `learning_log` at a weekly retrospective can also be
  built in as a standard practice"). A recurring cadence over `learning_log`, orthogonal to the
  activity gates. Skill `ivi-retro`.

## 5. Component roster

### 5.1 Agents (`ivi-building/.claude/agents/`)

Models are pinned explicitly in frontmatter, because user-level agent files otherwise shadow the session
default: `~/.claude/agents/general-purpose.md` is pinned to `model: sonnet`, and
`CLAUDE_CODE_SUBAGENT_MODEL` is also `sonnet`. Resolution order is per-invocation `model` → frontmatter
(`inherit` = main conversation) → `CLAUDE_CODE_SUBAGENT_MODEL` → main conversation.

Two distinct cases:

- **Harness runtime agents** (the table below) pin a concrete model, because their behaviour is part of
  the evidence and must be reproducible across sessions. The cost lever, if 236 steps × 2 agents proves
  expensive, is Sonnet for off-thread `ivi-step-author` work.
- **Harness *development* subagents** — the implementer and reviewers dispatched while building the
  harness — are dispatched with **`model: "opus"`** and nothing else overridden. Measured 2026-09-01: a
  dispatch with no model resolves to `bedrock/global.anthropic.claude-sonnet-5`, while `model: "opus"`
  resolves to `bedrock/global.anthropic.claude-opus-5[1m]` — the session's own model, 1M context
  included. The per-invocation override is the whole mechanism: it needs no agent file and no session
  restart.

  **No project-specific development agent exists, deliberately.** One was written and then removed.
  Subagents load `CLAUDE.md`, so the project invariants already reach them through the repo-root
  `CLAUDE.md`, the path-scoped `.claude/rules/ivi-building.md`, and `ivi-building/CLAUDE.md` — a custom
  agent body would only duplicate them. Worse, it would compete with the driving workflow's own
  purpose-built role prompts: the removed agent instructed "do not commit unless the parent instructs",
  which directly contradicts the subagent-driven-development flow in which the implementer commits.
  The rule is therefore to override the model and leave dispatch mechanics alone. This also keeps the
  hook registration (§6.6) as the *only* exception to `ivi-building/` self-containment.

| Agent | Tools | Contract | SP |
|---|---|---|---|
| `ivi-step-author` | Read, Write, Edit, Grep, Glob — **no Bash** | Step brief → artifact + per-clause DoD self-report. Covers ~150 of the 236 steps. No Bash: unnecessary, and the leakiest firewall surface. | SP1 |
| `ivi-step-verifier` | Read, Grep — **no Write** | Clause + artifact → pass/fail with quoted evidence. Cannot fix what it grades. | SP1 |
| `ivi-references-researcher` | Read, Grep, Glob, Write | F3. Summarizes pack sources into `artifacts/_references/`, every claim citing its origin by slide anchor (`<deck>.pptx#slide-14`). Runs as a pre-pass. **For deck sources it must follow §6.3 “Slide-deck sources”: read `<deck>.slides.md`, pick slide numbers, open only those renders.** Enumerating a render directory is a defect, not an inefficiency. | SP1 |
| `ivi-diagram-author` | Read, Write, Bash | The ~22 diagram steps; Mermaid/PlantUML, Bash only to parse-validate and count branches. | SP4 |
| `ivi-proto-implementer` | full | F5's implementer: HTML prototype from a design doc into `prototypes/`. | SP4 |
| `ivi-proto-validator-naive` / `-inspector` | Read, Bash (Playwright) | F5's two graders. Kept separate because the Map names them separately and they differ: naive follows the ⭐ core steps blind, inspector hunts the failure. | SP4 |

### 5.2 Skills (`ivi-building/.claude/skills/`)

| Skill | Role | SP |
|---|---|---|
| `ivi-graph-build` | One-time extraction: both source docs → `process_graph.json`, incl. the derived fields of §3.2. Re-runnable when a doc revises; presents findings for human triage and hard-fails on an edge syntax it does not recognize. | SP1 |
| `ivi-run-init` | Creates a run: selects the pack, validates it against the denylist, computes the goal thread from terminal nodes, writes `run.json` + skip plan. | SP1 |
| `ivi-run` | **The orchestrator.** Next runnable step → author → verifier → retry → gate → send-back → reopen. | SP1 |
| `ivi-discovery-init` | F1 + F2. Context organization, and hypotheses at 1 question = 1 hypothesis = 1 falsification condition. Primary in activities 1, 2, 6, 9. | SP1 |
| `ivi-issues` | F9. 1 issue = 1 question; routes to hypothesis sheet vs backlog. Primary in activity 7. | SP1 |
| `ivi-adr` | F6. Options / decision / rationale / rejected alternatives / conditions in one file, plus a `conditions.md` row. Cross-cutting from day one. | SP1 |
| `ivi-pack-build` | Builds and validates a domain pack: indexes sources, tags CDC-SU inherited content, rejects denylisted material. | SP2 |
| `ivi-experiment-design` | F4. Shared premises + explicit branching axis for A/B/C variants. Primary in 4, 13, 15. | SP2 |
| `ivi-experiment-review` | F7. Results → design doc *Retrospective* → `learning_log` → hypothesis sheet; gates design-vs-product hypothesis; guides graduation. Primary in 16. | SP3 |
| `ivi-retro` | Weekly retrospective over `learning_log`. | SP3 |
| `ivi-acceptance` | F8. `story.md` + `acceptance.feature` as a pair; no vague words; Scenario Outline for combinations. Primary in 10, 12. | SP4 |
| `ivi-proto-build` | F5. Drives implementer + both validators with a bounded fix loop; before/after screenshots. Primary in 4, 11, 14, 16. | SP4 |
| `ivi-codegen` | **F10 (extension).** Fixed UC + REQ + Gherkin → algorithm package, scenario, route preset, Combined-screen prototype into `generated/<run>/`. | SP4 |
| `ivi-evidence-diff` | **F11 (extension).** Derived-vs-inherited accounting, coverage report, behavioral diff via the existing calibration harness. | SP4 |

`ivi-codegen` and `ivi-evidence-diff` carry no F-number in the source documents, because the
Application Map's process terminates at HTML prototypes and a baselined specification. The final
report should present them as extensions F10 and F11 rather than implying F1–F9 already covered them.

### 5.3 F1–F9 coverage audit

| F | Doc's declared name | Component(s) | SP |
|---|---|---|---|
| F1 | `discovery-init` | `ivi-discovery-init` + `project_brief`, `product_constraints`, `hypothesis_sheet` | SP1 |
| F2 | `discovery-init` / `experiment-review` | same skill in hypothesis mode; status updates via `ivi-experiment-review` | SP1 / SP3 |
| F3 | `references-researcher` (a subagent called by Discovery) | agent `ivi-references-researcher` | SP1 |
| F4 | `experiment-design` | `ivi-experiment-design` + `experiment_design` template | SP2 |
| F5 | `proto-build` → `proto-implementer` / `proto-validator-naive` / `-inspector` | `ivi-proto-build` + 3 agents + `prototypes/` | SP4 |
| F6 | `adr_template` (cross-cutting, all phases) | `ivi-adr` + `adr` template + `conditions.md` | SP1 |
| F7 | `experiment-review` | `ivi-experiment-review` + `learning_log` + graduation + `ivi-retro` | SP3 |
| F8 | `acceptance.feature` paired with `story.md` | `ivi-acceptance` + the template pair | SP4 |
| F9 | cross-cutting dialogue behavior | `ivi-issues` + `backlog` | SP1 |

### 5.4 Composition: one runner plus a discipline rule table

Most of the 236 work items are ordinary structured-document authoring — tallying the output-deliverable
column gives *list* 77, *table* 45, *definition* 30, *results* 23, *diagram* 22, *policy* 20,
*minutes* 20. Roughly 150 are the same act on different content: read declared inputs, emit a table
with the declared columns, satisfy three DoD clauses.

So there is **one generic step-runner** plus a rule table attaching *mandatory disciplines*, keyed on
the step's declared output shape, which the graph already carries:

| If the step's output… | …this discipline is mandatory |
|---|---|
| has a hypothesis or falsification column | **F2** — no hypothesis without a falsification condition |
| is a choice among options | **F6** — ADR with decision, rationale, rejected alternatives |
| is a use case or a requirement | **F8** — paired Gherkin, no vague words |
| declares pack `sources/` as input | **F3** pre-pass before the activity's first step |
| is a variant comparison (A/B/C) | **F4** — shared premises + explicit branching axis |
| is a prototype | **F5** — implement, drive, 3-level verdict |
| reflects an experiment result | **F7** — classify design- vs product-hypothesis before touching the sheet |
| leaves anything unresolved | **F9** post-pass — route to hypothesis sheet or backlog |

All nine survive as named, auditable disciplines; none has to pretend to be a general-purpose author.

Two output shapes need their own workers rather than the generic author:

- **~20 steps output *minutes*** of review meetings and hearings. An agent cannot author minutes of a
  meeting that did not happen, and inventing them would be the worst fabrication in the system. These
  are **record-ingest** steps: they read `minutes/` or `inquiries/` from the pack, or they gate to the
  human. They are never generated. This also makes them a large share of the human-gate load.
- **~22 steps output *diagrams***, which need a notation and a parse check — `ivi-diagram-author`.

### 5.5 Templates

`project_brief` · `product_constraints` · `hypothesis_sheet` · `backlog` · `adr` · `conditions` ·
`experiment_design` · `design_doc` · `learning_log` · `story` · `acceptance.feature` ·
`step_artifact` (the generic columned table covering ~150 steps) · `coverage_report`.

Any of these is overridable from `domain/<pack>/templates/`. That path is not speculative: the
Application Map's Priority 3 asks for exactly it — "extending the `experiment_design` template for IVI
trigger conditions … frequency, re-presentation, notification means, while-driving restrictions."
That content is TYM-flavoured, so it belongs to the pack, not the harness.

## 6. Domain pack and the firewall

### 6.1 What the pack may and may not contain

Raw primary sources in, structured premises derived (D10). Three of the four things named as "TYM
domain" — target-premises table, IVI technical constraints list, glossary — are *outputs* of
`SYS1-01` (`-j`, `-k`, `-m`), not inputs to it. `SYS1-01-k`'s declared input is "IVI platform
specifications, existing vehicle-signal acquisition interface specifications". So the pack holds the
platform spec and the harness derives the constraints list.

The customer's own plan-concept decks are legitimate inputs — the real project began from them, and the
process doc's Phase ① inputs include "the current plan concept". But they already contain personas,
use-case step sequences, service intent, and pre-identified risks. Per D11, `ivi-pack-build` records
per-slide which of those a deck carries, artifacts record them under `inherited:`, and
`ivi-evidence-diff` reports **derived** separately from **inherited**. The report must not claim
derivation for content sitting verbatim on a slide. Specifics per source live in the pack's own
`index.md` and per-deck `.slides.md`, which are confidential and therefore not restated here.

`inquiries/` carries recorded answers to the ▲ department questions — including `refused` and
`no answer by deadline`, which are the interesting cases because they drive the conditional-decision
rework path.

### 6.2 What the evidence claim actually is (2026-09-01)

Two customer decks are admitted whole under the use-whole-and-tag decision (D11) — a 89-slide
requirements deck and a later 40-slide narrower one. Together they already contain most Phase ③
*content*: use-case basic flows, functional requirements, the trigger features and the adopted firing
logic, fire control and priority, content classification and selection inputs, end conditions, and a
function-allocation pipeline. One of them annotates its own rows as being the final deliverable's
requirements list and screen list. So the naive claim "the harness derived the specification" is not
available, and the design must not imply it.

What the decks do **not** contain is the verifiability layer, and that is where derivation is real and
measurable:

| Absent from the sources | Produced by | Work item |
|---|---|---|
| Alternative and exception flows, pre/post-conditions, actor lists | F8 | `SYS2-10` |
| Gherkin acceptance criteria per requirement | F8 | `SYS2-12` |
| Falsification conditions per hypothesis | F2 | `SYS1-02`, `SYS1-06` |
| ADRs with rationale and **rejected alternatives** | F6 | `SYS1-08`, `SYS2-13` |
| Issue list at 1 issue = 1 question, with decision-maker and deadline | F9 | `SYS1-07` |
| Decided / hypothesis / undecided separation with sources | F1 | `SYS1-01` |
| Traceability matrix with no dangling IDs | F8 | `SYS2-12` |
| Branch coverage over condition combinations | F5 | `SYS2-14` |
| `PROV-` tagging of changeable values | — | `SYS2-16` |
| Runnable algorithm package and scenario | F10 | codegen |

Notably, the richer deck's use-case slides are **basic flows only** — no exception or alternative flows.
That is precisely the common pitfall `SYS2-10` names: *"thin exception flows, so the behavior in
abnormal situations never gets decided."* The source material exhibits the defect the process exists to
prevent, so closing that gap is a derivation claim the harness can legitimately make.

The claim therefore splits three ways, and `ivi-evidence-diff` (F11) must report all three:

1. **Inherited** — content traceable to a pack source slide. Claim reformatting and traceability: a
   resolvable chain from generated artifact → REQ-ID → UC-ID → hypothesis → source anchor. Not
   derivation.
2. **Derived** — output carrying no `inherited:` ID, i.e. the verifiability layer above.
3. **Gap count** — how many inherited requirements arrived with no acceptance criteria and no recorded
   rationale. This is the most persuasive number available, because it is a property of the customer's
   own material rather than an assertion about the harness.

### 6.3 Slide-deck sources: render, index, then read one slide

Several primary sources are PowerPoint decks, and they are the hardest source type to consume well. A
`python-pptx` text dump is not sufficient, because in these decks **meaning is carried by layout and
fill colour**: which display surface owns a function, which boxes are open discussion points, which
items are newly added, and the ordering implied by arrows all exist as geometry and colour, not text.
Equally, no agent should page through dozens of slide images — that is how a context window is
destroyed for no benefit.

So a deck is admitted in four parts, produced by `ivi-pack-build`:

| Artifact | Role |
|---|---|
| `<deck>.pptx` | the authoritative binary; never edited |
| `<deck>.render/slide-NN.png` | one image per slide at 1920×1080, plus a PDF — the source of record for *reading* |
| `<deck>.slides.md` | an **English per-slide index table**: summary, retrieval keywords, and the inherited/upstream tag per slide |
| `<deck>.extract.txt` | the raw per-slide text and table dump — a grep target for exact original wording |

**The retrieval protocol is mandatory and is an invariant, not a suggestion:**

1. read the deck's `.slides.md` table;
2. identify the slide numbers that matter;
3. open **only** those `render/slide-NN.png` files.

Never enumerate a render directory, and never read a deck's images speculatively. `.extract.txt` is for
locating exact phrasing when a term must be quoted verbatim; it is a search aid, not a substitute for
the image, because it has already lost the colour and geometry.

Citation is by slide anchor — `<deck>.pptx#slide-N` — in an artifact's `sources:` front-matter, which
is also how the inherited/derived accounting in §6.2 is computed.

Rendering requires PowerPoint COM on this machine (`pptx` → PNG per slide); `pdftoppm`/poppler is not
installed, so PDF page rendering is unavailable and PNG is the working route. Any script that prints
Japanese must set `PYTHONIOENCODING=utf-8` or the console mangles it. The exact command lives in the
pack's own `index.md`, next to the material it applies to.

The per-deck index is where a source's *specifics* live — structure, section boundaries, per-slide
tags, known authoring errors, and cross-deck divergences. This design document deliberately does not
restate them, both because pack contents change independently of the harness and because those files
are confidential (§6.4 “Confidentiality”).

### 6.4 Confidentiality

Pack sources are customer material marked `PROTECTED / 関係者外秘` and must not leave the local machine.
`ivi-building/domain/tym/**` is gitignored in full, with only `.gitkeep` files tracked, so a clone
receives the pack's shape without its contents. `domain/_template/` stays tracked because it holds no
customer content.

Run artifacts (`runs/`), prototypes, and codegen output (`generated/`) are **derived from** that
material and inherit its confidentiality, so they are gitignored on the same basis. This has a direct
consequence for H8 and H9: the evidence deliverable cannot be shipped by committing `generated/`.
Extracting anything for the final report is a deliberate, reviewed redaction step.

Confidentiality and the input/output firewall are independent controls solving different problems. The
firewall stops the harness reading its own answers during a run; `.gitignore` stops customer material
leaving the machine. Neither substitutes for the other.

### 6.5 `pack.json`

```json
{
  "pack_id": "tym",
  "allow": ["ivi-building/domain/tym/**"],
  "deny_by_phase": {
    "PH1": ["docs/master/**", "app/**", "htmlapp/**", "specs/**", "combined_contracts/**"],
    "PH2": ["docs/master/**", "app/**", "htmlapp/**", "specs/**", "combined_contracts/**"],
    "PH3": ["docs/master/**", "htmlapp/**"],
    "diff": []
  }
}
```

The denylist is phase-scoped. `app/**` must open in the diff phase — you cannot compare against a
baseline you cannot read — and `docs/master/**` unlocks only for `ivi-evidence-diff`.

### 6.6 The hook

`ivi-building/hooks/firewall.py`, registered as a `PreToolUse` hook on `Read`/`Grep`/`Glob`/`Bash`
from the repo-root `.claude/settings.json` (nested settings files are not read for hooks — the single
exception to self-containment). It keys off an `ACTIVE` marker in the run directory, so with no run in
flight it exits immediately and never interferes with ordinary work in this repo. It reads the current
step's phase from the ledger and denies matches against that phase's list.

`Bash` requires command-string inspection and is the leakiest surface: it will catch
`cat docs/master/...` but is not claimed to be airtight. The `sources:` front-matter provides the
after-the-fact half of the guarantee.

## 7. Testing

**Layer 1 — graph extraction (deterministic).** Counts are exactly 3 + 16 + 236 = 255. Every
predecessor/successor ID resolves; edge asymmetries are reported as findings in the source doc rather
than crashes — H0 measured **217** of them. Topological sort succeeds over `forward` edges, which is
255 of 255; the source's one annotated `(revisit)` back edge, `SYS1-05-f → SYS1-04-e`, is retained as
data with `kind: "revisit"` and excluded from ordering. **The doc's stated critical path must be a real
connected path in the extracted graph** — the strongest available test, because it validates the parse
against an independent claim the doc makes. Connected means **reachable**: H0 measured 0 of the 11 hops
as adjacent edges and 11 of 11 as directed paths. Every L3 has ≥1 DoD clause, ≥1 output, a non-empty
entry condition. Every node whose granularity says "approved at the decision-making meeting" has
`requires_human: true`. The goal thread contains all 12 critical-path nodes plus `SYS2-11` and
`SYS2-14`, with `goal_relevant` == 234 and `on_thread` == 210 per §4.5.

**Layer 2 — firewall hook.** Synthetic payloads, asserted exit codes: with an `ACTIVE` marker in PH1,
`Read docs/master/*.md` denied, pack read allowed, `Bash cat docs/master/...` denied; with no marker,
everything allowed.

**Layer 3 — loop invariants.** A fixture run over a ~5-step stub graph asserts: an unsatisfied
predecessor is never offered; send-back invalidates the target and its internal successors only, with
untouched siblings still at revision 1; a skip emits a stub plus a backlog entry and a clause sourced
only from it reports `dod_blocked`; reopen demotes fixed→draft and requires its own gate event; a
mid-activity kill replays to the correct next step. These assertions run against any real run's
ledger too — **the test suite and the run auditor are the same code.**

**Layer 4 — does the quality gate actually gate.** The most important test here: if the cold verifier
rubber-stamps, everything downstream is worthless. **Seeded-defect testing** — inject a known DoD
violation into a passing artifact (strip a falsification condition, remove a decision source, leave a
changeable value `PROV-`-untagged, insert "appropriately" into a requirement) and assert the verifier
fails *the specific clause* covering it. A library of ~10 seeded defects yields a measurable catch
rate for the final report.

**What is deliberately not tested in SP1:** whether the planning-premises summary is any *good*. That
is human judgment at the gate; a test claiming to cover it would be false comfort. Objective content
measurement arrives with `ivi-evidence-diff` in SP4.

Tests live in `ivi-building/tests/` as standalone pytest, run on the Anaconda interpreter (Docker is
absent in this environment and `uv` is proxy-blocked).

## 8. Decomposition

| Sub-project | Content | Proof |
|---|---|---|
| **SP1** | Graph + pack skeleton + firewall + the gated loop. 3 agents (`step-author`, `step-verifier`, `references-researcher`), 6 skills (`graph-build`, `run-init`, `run`, `discovery-init`, `issues`, `adr`), 7 templates (`step_artifact`, `project_brief`, `product_constraints`, `hypothesis_sheet`, `backlog`, `adr`, `conditions`). | `SYS1-01` runs end to end: 15 work items, one gate, a deliberate send-back |
| **SP2** | Phase ① functions: `ivi-pack-build`, F4. Activities 1–6. | Plan document produced; hypotheses carry falsification conditions |
| **SP3** | Phase ② + F7: issue list, handling policy, system issue list, graduation, retro. Activities 7–9. | System issue list baselined; decisions routed to constraints, holds to backlog |
| **SP4** | Phase ③ + F5/F8 + F10/F11: use cases → requirements → diagrams → codegen → diff. Activities 10–16. | Runnable algorithm package + Combined-screen prototype in `generated/`, diffed against `app/` |

The sub-projects are delivered as ten capability milestones **H0–H9**, defined in
`ivi-building/docs/ivi_process_harness_milestones.md`. SP1 spans H0–H4; SP2 is H5; SP3 is H6; SP4 spans
H7–H8; H9 is the report and reuse seam. Each milestone is one Spec-Kit feature. SP1's acceptance
criteria are below and are H4's release condition.

## 9. SP1 acceptance criteria

Run `SYS1-01` against the TYM pack: 15 work items, one gate. SP1 is done when:

1. 15 artifacts exist or are stubbed with a recorded reason; each has valid front-matter with
   resolvable `derived_from`.
2. Every DoD clause carries an `ivi-step-verifier` verdict in the ledger.
3. `SYS1-01-e` is *conditionally skipped* when `inquiries/` shows no existing PoC results — the
   cleanest available test of the skip machinery, because the doc prescribes this skip itself.
4. The planning-premises summary and undecided-items list exist, and **every undecided item has an
   owner and a deadline** (`SYS1-01-o`'s literal DoD).
5. `registry/hypotheses.md` is non-empty and every entry has a falsification condition.
6. Provenance across all 15 artifacts contains zero denylisted paths.
7. One gate opened with its decision logged; a deliberate send-back at `SYS1-01-c` re-runs `-c` and
   its internal successors only, leaving siblings at revision 1.
8. The ledger replays to identical state in a fresh session.
9. Layers 1–4 of the test suite pass, with the seeded-defect catch rate recorded.

## 10. Operating notes

- **Run harness sessions with cwd = `ivi-building/`.** Nested skills below the starting directory are
  not loaded at startup, and project agents are discovered by walking *up* from cwd. Rooting the
  session in `ivi-building/` loads its skills and agents natively with hot reload, and walking up
  still picks up the repo-root `.claude/` (speckit, superpowers). Fallback for a repo-root session:
  `--add-dir ivi-building`, though agent edits then need a restart.
- Spec-Kit and Superpowers artifacts stay where the simulator keeps them: `specs/`,
  `docs/superpowers/`.
- **Context scoping.** This repository now holds two projects, so instruction files are scoped in three
  places. `ivi-building/CLAUDE.md` governs harness work and claims first priority. The repo-root
  `CLAUDE.md` opens with a scoping table that cedes precedence for `ivi-building/**` and states that
  `docs/master/`, `app/`, `htmlapp/`, `specs/`, and `combined_contracts/` are this project's *output*.
  `.claude/rules/ivi-building.md` is path-scoped to `ivi-building/**` and repeats the precedence and
  firewall facts, closing the window in a repo-root session where the nested `CLAUDE.md` has not
  loaded yet — nested memory files load only once Claude reads a file in that directory.
  CLAUDE.md files are concatenated rather than overridden and are context rather than enforcement, so
  the precedence claim is guidance; the firewall hook remains the enforcement layer.
- Cost lever, if 236 steps × 2 agents proves expensive: pin `ivi-step-author` to Sonnet for
  off-thread steps while keeping Opus on thread steps and on `ivi-step-verifier`.
</content>
</invoke>
