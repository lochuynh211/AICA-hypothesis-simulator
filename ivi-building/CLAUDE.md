# CLAUDE.md — ivi-building

**This file governs all work under `ivi-building/`. It takes precedence over the repository-root
`CLAUDE.md`, which describes a different project.** Where the two conflict, this file wins. The root
file's guidance about the AICA simulator's architecture, milestones, and invariants describes the
*subject matter* of this project's evidence run — not the code you are working on.

## What this project is

The **IVI process agent harness**: an agent system that walks the documented IVI SYS.1–SYS.2 planning
and requirements-definition process step by step, with human review between activities, terminating in
runnable output as evidence that the harness works.

The AICA Hypothesis Simulator is the *output* of that process, not the goal. This project formalizes
the process that produced it so it can be re-run for the next plan.

**Design document:** `docs/superpowers/specs/2026-09-01-ivi-process-agent-harness-design.md` — read it
before making architectural decisions. It is authoritative over assumptions.

**Milestone plan:** `ivi-building/docs/ivi_process_harness_milestones.md` — H0–H9, capability-defined.
Each milestone is one Spec-Kit feature: brainstorm → specify → plan → tasks → subagent-driven TDD.

**Milestone session prompt:** `ivi-building/docs/ivi_harness_milestone_implementation_prompt_template.md`
— paste it with `{{MILESTONE}}` set to run one milestone per fresh session.

## Source documents being automated

| Document | Role |
|---|---|
| `others/20260826_IVI_SYS1-2_Planning_Requirements_Definition_Process_List.md` | 3 phases (L1) → 16 activities (L2) → **236 work items** (L3). 255 rows = 3 + 16 + 236. |
| `others/20260826_IVI_Process_x_AI_Hypothesis_Driven_Application_Map_v2.md` | The nine agent functions F1–F9 and their ◎/◯/△/－ rating per activity |

Terminology follows those documents exactly: **phase** (3), **activity** (16), **work item** (236).
Do not call activities "phases".

## Non-negotiable invariants

1. **`docs/master/` is output, never input.** The harness must *derive* the AICA design, not read it.
   The `PreToolUse` firewall hook denies reads of `docs/master/`, `app/`, `htmlapp/`, `specs/`, and
   `combined_contracts/` during Phases ①–②. Never work around it. If a step seems to need one of
   those, the step is wrong or the pack is missing a source.
2. **Raw sources in, structured premises derived.** A domain pack holds platform specs and policy
   documents. It must never hold the IVI-constraints list, the target-premises table, or the
   glossary — those are outputs of `SYS1-01` (`-k`, `-j`, `-m`), and pre-seeding them turns work
   items into copy operations and destroys the evidence.
3. **The ledger is append-only, and run state is derived from it.** Never write a `state.json`.
   Never rewrite history in `ledger.jsonl`.
4. **A skip is never a false pass.** If a skipped step is the only source for a downstream DoD
   clause, mark that clause `dod_blocked` and raise it at the gate.
5. **Minutes are never generated.** ~20 work items output minutes of meetings and hearings. Read them
   from the pack's `minutes/` or `inquiries/`, or gate to the human. Inventing them is the worst
   possible fabrication here.
6. **Missing input becomes a recorded assumption, not invention** — with an owner and a deadline, plus
   a backlog item.
7. **Every authoring step runs in a fresh subagent.** This is a firewall requirement, not a token
   optimization: a hook cannot unlearn what is already in a context window.
8. **Provisional values carry `PROV-<id>` tags** at authoring time, so the reopen-affected set is a
   search rather than a guess.
9. **Domain pack material is customer-confidential and stays on this machine.** Sources are marked
   `PROTECTED / 関係者外秘`. `ivi-building/domain/tym/**` is gitignored in full (only `.gitkeep` is
   tracked), as are `runs/`, `prototypes/`, and `generated/`, which are derived from it. Never quote
   pack content — including source titles — into a tracked file, a commit message, or a PR, and never
   send it to any service outside this machine. Cite sources by anchor (`<file>#slide-N`) instead.
   `ivi-building/domain/tym/index.md` (itself gitignored) is the source inventory, the version lineage,
   and the inherited-content map. Read it before touching the pack.
10. **Read slide decks through their index, never by paging images.** Each deck source has an English
    per-slide index (`<deck>.slides.md`), one PNG per slide (`<deck>.render/slide-NN.png`), and a raw
    text dump (`<deck>.extract.txt`). Protocol: **index → slide numbers → only those PNGs.** Enumerating
    a render directory exhausts context for no benefit. Cite by anchor (`<deck>.pptx#slide-N`). The
    extract loses fill colour and layout, which in these decks carry meaning, so it locates a slide
    rather than replacing it. See design §6.3 “Slide-deck sources”.
11. **Claim reformatting, not derivation, for inherited content.** A plan-concept source admitted whole
    contains Phase ③ deliverable material. Output tracing to an `inherited:` ID supports a
    traceability claim only; derivation may be claimed only for output that carries none.
12. **The process graph is extracted deterministically and is never hand-edited.** Re-extraction from an
    unchanged source document must be byte-identical, so `graph/process_graph.json` carries no timestamp.
    Findings about the source document — declaration asymmetries, prose edge targets, the annotated
    `(revisit)` back edge — are *recorded*, never repaired: repairing one would assert a dependency the
    source states only in one direction. An edge syntax the extractor does not recognize is a hard
    failure that reaches the human, never a silently dropped edge.

## Gate discipline

16 gates, one per activity. Inside an activity, work items run back-to-back with each machine-checkable
exit DoD self-verified by a cold reader (`ivi-step-verifier`, which has no write tool). Additional hard
stop wherever the process doc's granularity column says *fixed version* — that denotes a real human
approval event.

At a gate the human may **approve**, **send back with feedback** (re-runs the targeted work items and
their internal successors only — never untouched siblings), or **approve with conditions** (writes an
ADR carrying the condition *and* the alternative if unmet).

Reopening an already-approved activity requires its own gate. A reopened `fixed` artifact demotes to
`draft` and must be re-approved.

## Layout

```
.claude/skills/   14 skills; ivi-run is the orchestrator
.claude/agents/   7 agent files; pin `model` explicitly in frontmatter
hooks/            firewall.py — registered from the repo-root .claude/settings.json
lib/              deterministic modules; one flat file per milestone that needs one
graph/            process_graph.json — extracted once, then read-only data (committed)
templates/        13 recording media; overridable per domain pack
domain/           input packs; tym/ is pack #1, _template/ is the skeleton
runs/<run-id>/    run.json, ledger.jsonl, artifacts/, registry/
prototypes/       F5 HTML prototypes (the Application Map's own directory name)
generated/        codegen terminal: algorithm packages, scenarios, Combined prototype
tests/            pytest over the graph, hook, loop invariants, seeded defects
```

## Subagent dispatch

**Always pass `model: "opus"` when dispatching a subagent. That is the only dispatch parameter to
override** — leave `subagent_type` and role prompts to whatever workflow is driving.

Dispatching with no model runs on **Sonnet 5**: the user-level `general-purpose` agent is pinned to
`model: sonnet` and `CLAUDE_CODE_SUBAGENT_MODEL` is also `sonnet`. That is wrong for work that is mostly
skill, agent and prompt authoring plus schema design. Measured 2026-09-01: no model →
`bedrock/global.anthropic.claude-sonnet-5`; `model: "opus"` →
`bedrock/global.anthropic.claude-opus-5[1m]`, this session's model including its 1M context.

**No project-specific subagent is needed.** Subagents load `CLAUDE.md`, so these invariants reach them
via the repo-root `CLAUDE.md`, the path-scoped `.claude/rules/ivi-building.md` (fires on any
`ivi-building/**` read), and this file. A custom agent would duplicate that and risk contradicting a
workflow's own role prompts.

## Commands

```bash
# Run harness sessions from this directory, so nested skills and agents load natively
cd ivi-building && claude

# Tests (Docker is absent in this environment and uv is proxy-blocked; use Anaconda Python 3.12)
cd ivi-building && python -m pytest tests/
```

Nested `.claude/skills/` below a session's start directory do not load at startup, and project agents
are discovered by walking *up* from the working directory. Starting here loads this directory's skills
and agents with hot reload, while walking up still picks up the repo-root `.claude/` (speckit,
superpowers). From a repo-root session use `--add-dir ivi-building`; agent edits then need a restart.

## Working in this project

Feature work follows the Superpowers flow (brainstorm → design doc → `writing-plans` → execute), with
design docs and plans in the repo-root `docs/superpowers/`. Spec-Kit artifacts stay in the repo-root
`specs/`. Those two locations are shared with the simulator project deliberately.

Sub-projects build in order: **SP1** graph + pack + firewall + gated loop · **SP2** Phase ① functions ·
**SP3** Phase ② + graduation · **SP4** Phase ③ + codegen + evidence diff.

Do not commit unless explicitly asked.
</content>
