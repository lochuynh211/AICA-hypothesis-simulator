# ivi-building

The agent system that **builds** AICA-style deliverables by walking the documented IVI SYS.1–SYS.2
planning and requirements-definition process, step by step, with human review between activities.

This directory is self-contained: skills, agents, hooks, the process graph, domain packs, templates,
run workspaces, and tests all live here, so the harness can be lifted into another repository.

**Design document:** `docs/superpowers/specs/2026-09-01-ivi-process-agent-harness-design.md`

## Source documents being automated

| Document | Role |
|---|---|
| `others/20260826_IVI_SYS1-2_Planning_Requirements_Definition_Process_List.md` | The work breakdown: 3 phases → 16 activities → 236 work items (255 rows) |
| `others/20260826_IVI_Process_x_AI_Hypothesis_Driven_Application_Map_v2.md` | The nine agent functions F1–F9 and their per-activity ratings |

## Run sessions from this directory

```bash
cd ivi-building && claude
```

Nested `.claude/skills/` below a session's starting directory are not loaded at startup, and project
agents are discovered by walking *up* from the working directory. Starting here loads this directory's
skills and agents natively with hot reload, while walking up still picks up the repo-root `.claude/`
(speckit, superpowers). From a repo-root session, use `--add-dir ivi-building` instead — agent edits
then require a restart.

## Layout

```
.claude/skills/   14 skills; ivi-run is the orchestrator
.claude/agents/   7 agent files; models pinned explicitly in frontmatter
hooks/            firewall.py — registered from the repo-root .claude/settings.json
graph/            process_graph.json — the 255 rows, extracted once
templates/        the recording media; overridable per domain pack
domain/           input packs. tym/ is pack #1; _template/ is the skeleton
runs/             one workspace per run: artifacts, registries, append-only ledger
prototypes/       F5 HTML prototypes (the Application Map's own directory name)
generated/        codegen terminal: algorithm packages, scenarios, Combined-screen prototype
tests/            pytest over the graph, hook, loop invariants, and seeded defects
```

## Two invariants

**`docs/master/` is output, never input.** The harness must derive the AICA design, not read it. A
`PreToolUse` hook denies reads of `docs/master/`, `app/`, `htmlapp/`, and `specs/` during Phases ①–②;
each artifact's `sources:` front-matter provides the after-the-fact audit trail. If the answer leaks
into the inputs, the evidence is worthless.

**Raw sources in, structured premises derived.** A domain pack holds platform specs and policy
documents. It must not hold the IVI-constraints list or the target-premises table — those are outputs
of `SYS1-01`, and pre-seeding them turns work items into copy operations.
</content>
