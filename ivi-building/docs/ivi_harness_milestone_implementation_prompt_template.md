# IVI Process Agent Harness — Milestone Implementation Session Prompt Template

**How to use:** start a fresh implementation session, change only the `{{MILESTONE}}` value below to one
milestone from `H0` through `H9`, then paste the block between the markers as the first message.
Implement one milestone per session.

**Where to run it:** start the session at the **repository root**, not inside `ivi-building/`.
Implementation edits reach outside `ivi-building/` (the hook registration in the repo-root
`.claude/settings.json`, the milestone and design documents), and the Spec-Kit and Superpowers skills
live at the root. Harness *execution* is the opposite — Step 5's demonstration runs from
`cd ivi-building` so the harness's own nested skills and agents load. The prompt says so where it
matters.

===================== BEGIN PROMPT =====================

**PARAMETER — change only this value:** `{{MILESTONE}}` = `H0`

You are implementing milestone **{{MILESTONE}}** from
`ivi-building/docs/ivi_process_harness_milestones.md` in the AICA Hypothesis Simulator repository.

**This is a different project from the AICA simulator.** `ivi-building/` holds the **IVI process agent
harness**: an agent system that walks the documented IVI SYS.1–SYS.2 planning process step by step and
terminates in runnable output. `ivi-building/CLAUDE.md` governs this work and takes precedence over the
repository-root `CLAUDE.md`. The simulator under `app/`, `htmlapp/`, `docs/master/`, and `specs/` is the
harness's **expected output**, not the code you are editing.

This is a fresh session. Do not rely on prior conversation memory. Derive the milestone title, scope,
dependencies, acceptance criteria, and branch slug from the repository. Complete the following five
steps in order.

You are authorized to create a feature branch, edit documentation and code, author skills and agents,
run tests, execute the harness, and make logical commits. Preserve unrelated user changes. Do not merge
or push unless explicitly requested.

The two planned interactive checkpoints are Step 2 design approval and Step 3 clarification. Otherwise
continue autonomously, stopping only for a genuine blocker: an unmet milestone dependency, an
unresolved contradiction between the source documents, a source document that cannot support what the
milestone requires, or a failing gate that cannot be repaired safely.

---

## Step 1 — Grounding and dependency gate

Before editing anything:

1. Read `ivi-building/CLAUDE.md` first, then the repository-root `CLAUDE.md` and
   `.specify/memory/constitution.md`. Where the two `CLAUDE.md` files conflict, the `ivi-building/` one
   wins for this work.
2. Read the complete **{{MILESTONE}}** section in `ivi-building/docs/ivi_process_harness_milestones.md`,
   plus §1 (milestone strategy), §12 (schedule reality), and §13 (evidence-run boundary).
3. Read the design document,
   `docs/superpowers/specs/2026-09-01-ivi-process-agent-harness-design.md`. It is authoritative over
   assumptions. Pay particular attention to the sections this milestone touches: §3.2 graph schema,
   §3.3 artifacts and ledger, §4 the runner loop, §5 the component roster and discipline rule table,
   §6 the domain pack and firewall, §7 testing.
4. Read the parts of the two source documents this milestone depends on:
   - `others/20260826_IVI_SYS1-2_Planning_Requirements_Definition_Process_List.md` — the work
     breakdown. For any activity in scope, read its L2 summary **and every L3 work item beneath it**,
     including the entry condition, the exit DoD clauses, and the three concrete examples. The
     examples are a calibration set written in the rest-suggestion domain and are used verbatim in step
     briefs; do not paraphrase them.
   - `others/20260826_IVI_Process_x_AI_Hypothesis_Driven_Application_Map_v2.md` — the nine functions
     F1–F9, their per-activity ◎/◯/△/－ ratings, and the skill and template each names.
5. Inspect the current implementation of the harness. If `.codegraph/` exists, use CodeGraph before
   text search. Identify the exact skills, agents, templates, hooks, graph fields, ledger events, and
   tests this milestone changes.
6. Verify every prerequisite milestone is actually present and passing, by running its tests and
   inspecting its artifacts — not by reading the milestone document. **Never emulate a missing
   dependency inside the new milestone.** Some of H0 and H1 was delivered during design (the
   `ivi-building/` tree, the three context-scoping files); verify what exists rather than rebuilding it,
   and report anything the milestone claims as delivered that is in fact absent.
7. Create a branch from the current harness baseline named `ivi-<milestone-lowercase>-<short-slug>`
   (e.g. `ivi-h0-process-graph`), unless the user has already provided a branch or worktree. Confirm the
   baseline branch with the user if it is ambiguous.

Produce a concise **Grounding Recap** containing:

- milestone goal and what becomes demonstrable that was not before;
- exact in-scope and out-of-scope work;
- acceptance criteria, restated as checkable statements;
- prerequisite milestones and the evidence they are present and passing;
- existing skills/agents/templates/graph fields/ledger events to extend;
- which source-document activities and work items are in scope;
- expected test and harness-execution commands;
- contradictions or gaps discovered in the source documents.

If a prerequisite is missing, or the source documents materially contradict each other on something
this milestone must encode, stop and report the blocker. Otherwise continue to Step 2.

## Step 2 — Design the milestone ⟪STOP: interactive approval⟫

Use the Superpowers brainstorming workflow to design **{{MILESTONE}}** with the user. Cover only
decisions this milestone needs:

- the smallest slice that leaves the harness able to execute more real work than before;
- schema decisions: graph node fields, artifact front-matter, ledger event shapes, `pack.json` keys;
- skill and agent boundaries — which agent owns what, and its exact tool list;
- what is enforced by a hook or a validator versus what is instructed in a skill;
- template structure and the pack-override resolution order;
- how the milestone's behavior is verified when it is agent behavior rather than deterministic code;
- failure behavior: what happens on DoD failure, retry exhaustion, missing input, and denied read;
- the milestone's exit demonstration.

Present alternatives where a material choice exists and state a recommendation. Do not implement until
the user approves the design.

After approval, without another proceed question:

1. Record the agreed design in
   `docs/superpowers/specs/<date>-ivi-<milestone-lowercase>-design.md`.
2. Reconcile the harness design document and the milestone plan **only** where the approved decision
   changes or clarifies them. Keep `ivi-building/CLAUDE.md` consistent with any new invariant.
3. Self-review for placeholders, contradictions, and scope leakage. Check counts and names across
   documents: a component named one thing in the design and another in the plan is a defect.
4. Commit the approved documentation as one logical checkpoint.

Then continue to Step 3.

## Step 3 — Create and validate the executable plan ⟪clarification is interactive⟫

Use this repository's Spec-Kit workflow and the next valid feature number:

1. `speckit-specify` — create the milestone feature specification from the approved design, the
   milestone plan, and the two source documents.
2. `speckit-clarify` — ask only the unresolved questions that materially affect behavior or acceptance.
   **Stop here until clarification is complete.** Encode every answer into the specification.
3. `speckit-plan` — create the technical plan and any contract/schema artifacts. The constitution check
   must pass.
4. `speckit-tasks` — create dependency-ordered tasks with exact files and verification commands.
5. `speckit-analyze` — check cross-artifact consistency. Repair every reported issue and rerun until
   clean.

The plan must map **every** milestone acceptance criterion to at least one implementation task and one
verification step. Criteria that are measurements rather than booleans — the seeded-defect catch rate,
the coverage counts, the behavioral diff — must have a task that produces the number and records it,
not a task that merely asserts the mechanism exists.

Commit the clean specification and plan, then continue to Step 4.

## Step 4 — Implement with subagent-driven TDD

Execute the approved tasks one at a time using Superpowers subagent-driven development with TDD:

1. Write a failing test for the current behavior slice.
2. Run it and confirm it fails for the intended reason.
3. Implement the smallest coherent change that makes it pass.
4. Refactor without changing behavior.
5. Run the affected test layers and review the work unit before moving on.
6. Post a short progress update after each logical task and commit at stable checkpoints.

**How TDD applies here, because much of this milestone may be prompt text rather than code.** Split
the work honestly:

- **Deterministic components — genuine TDD.** The graph extractor, the firewall hook, structural
  validators, front-matter and ledger schemas, thread and affected-set computation, and the coverage
  report are ordinary code. Write the failing test first; no exceptions.
- **Agent and skill behavior — fixture-based verification.** A skill's prose cannot be unit-tested, so
  verify the *recorded consequences* instead: drive a fixture run over a small stub graph and assert
  against `ledger.jsonl` and artifact front-matter. The design's loop invariants (§7 layer 3) are the
  assertions, and the same code audits real runs later. Where the milestone introduces a quality gate,
  add seeded defects (§7 layer 4) and record the catch rate.
- **Never weaken a gate to make a milestone pass.** If the cold verifier fails an artifact, fix the
  artifact or the authoring brief — never soften the DoD clause or grant the verifier a write tool.

Test and gate commands actually available in this environment:

```bash
# Harness tests. Docker is absent here and uv is proxy-blocked; use the Anaconda Python 3.12 interpreter.
python -m pytest ivi-building/tests/ -v

# A single test file or test
python -m pytest ivi-building/tests/test_process_graph.py -v
python -m pytest ivi-building/tests/test_firewall.py -k "denies_docs_master" -v

# Simulator suites — only if this milestone touches the diff harness or generated packages
PYTHONPATH=app/api python -m pytest app/api/tests/ -v
```

Do not add a Docker or `uv`-based gate to this project; neither works in this environment.

## Step 5 — Verify and close the milestone

Use the verification-before-completion and code-review workflows before claiming success.

1. Run the milestone's targeted tests, then the full harness test suite.
2. **Demonstrate the milestone by running the harness for real, from `cd ivi-building`** so its nested
   skills and agents load. Unit tests are insufficient for any milestone from H2 onward: the deliverable
   is agent behavior, and the evidence is the ledger. Record the actual command, the ledger excerpt, and
   the artifacts produced.
3. Record evidence for every acceptance criterion, quoting real output rather than describing it.
   For measured criteria, state the number.
4. Verify the firewall did not fire during the run, and that every artifact's `sources` provenance
   contains zero denylisted paths.
5. Verify cross-session resume: kill the run mid-activity where applicable, replay the ledger in a
   fresh session, and confirm the next runnable step is correct.
6. Confirm the simulator is unaffected — no edits to `app/`, `htmlapp/`, `packages/`, or `scenarios/`
   unless this milestone explicitly targets the diff harness or the codegen terminal, and if it does,
   confirm writes went to `ivi-building/generated/` rather than into the live simulator.
7. Review the whole branch for: schema drift between design and implementation, a gate weakened to pass
   a test, an agent granted tools it does not need, invented content where a source was missing, a skip
   converted into a false pass, minutes generated rather than ingested, and accidental edits outside
   `ivi-building/`.
8. Fix critical and high-severity findings, rerun affected gates, and update the Spec-Kit artifacts, the
   design document, and the milestone plan to match what was actually built.

Finish with a **Milestone Completion Report** containing:

- what shipped, and what is newly demonstrable;
- skills, agents, templates, schemas, hooks, and tests added or changed;
- acceptance-criterion evidence, one line each, with measured numbers where the criterion is a
  measurement;
- exact test results and the harness-execution transcript summary;
- confirmation the simulator is untouched;
- known limitations and explicitly deferred work;
- branch and commit summary.

Then stop. Do not merge or push until the user asks.

---

## Project invariants for every milestone

These are the harness's invariants, from `ivi-building/CLAUDE.md` and the design document. They hold in
every milestone.

- **`docs/master/` is output, never input.** The harness must derive the AICA design, not read it. The
  `PreToolUse` firewall hook denies reads of `docs/master/`, `app/`, `htmlapp/`, `specs/`, and
  `combined_contracts/` during a run's Phases ①–②. Never work around it. If a step appears to need one
  of those, either the step is wrong or the domain pack is missing a source. *Note the scope:* the hook
  keys off an `ACTIVE` marker in the run directory, so an implementation session with no run in flight
  is not blocked — the quarantine constrains harness runs, not harness development.
- **Raw sources in, structured premises derived.** A domain pack holds platform specs and policy
  documents. It must never hold the IVI-constraints list, the target-premises table, or the glossary:
  those are outputs of `SYS1-01-k` / `-j` / `-m`, and pre-seeding them turns work items into copy
  operations and destroys the evidence.
- **Content inherited from a pack source is never claimed as derived.** `CDC-SU_specplan.md` already
  contains use cases, personas, and anticipated issues; artifacts record those under `inherited:` and
  the evidence report counts them separately.
- **The ledger is append-only and run state is derived from it.** Never write a `state.json`. Never
  rewrite history in `ledger.jsonl`.
- **A skip is never a false pass.** If a skipped step is the only source for a downstream DoD clause,
  mark that clause `dod_blocked` and raise it at the gate.
- **Minutes are never generated.** The ~20 work items whose output is minutes of a meeting or hearing
  are read from the pack's `minutes/` or `inquiries/`, or gated to the human.
- **Missing input becomes a recorded assumption** with an owner and a deadline, plus a backlog item —
  never invention.
- **Every authoring step runs in a fresh subagent.** This is a firewall requirement, not a token
  optimization: a hook cannot unlearn what is already in a context window.
- **The verifier reads cold and cannot write.** `ivi-step-verifier` receives only the DoD clause and the
  artifact, never the author's reasoning, and has no write tool.
- **Provisional values carry `PROV-<id>` tags** at authoring time, so a reopen's affected set is a
  search rather than a guess. A reopened `fixed` artifact demotes to `draft` and must be re-approved.
- **Terminology is the source documents', used exactly:** 3 **phases**, 16 **activities**, 236 **work
  items** (255 rows = 3 + 16 + 236). Activities are not phases.
- **Do not confuse the harness's runtime gates with this session's checkpoints.** The 16 activity gates,
  the graduation gate, and the reopen gates are features being built. The two interactive checkpoints in
  this session are Step 2 and Step 3.
- **F10 (`ivi-codegen`) and F11 (`ivi-evidence-diff`) are extensions beyond the source documents.** The
  Application Map's process terminates at HTML prototypes and a baselined specification. Present them
  as extensions; never imply F1–F9 covered them.
- Preserve unrelated work. Never use destructive Git operations. Do not commit unless asked.

====================== END PROMPT ======================

## Notes

- One fresh session per milestone. Later milestones verify earlier milestone outputs rather than
  reimplementing them.
- The five-step structure is fixed; milestone-specific scope is derived in Step 1.
- Implementation sessions start at the repository root. Harness execution — Step 5's demonstration, and
  any interactive use of `ivi-run` — starts from `cd ivi-building`, because nested skills below a
  session's starting directory do not load at startup and project agents are discovered by walking *up*
  from the working directory. `--add-dir ivi-building` is the fallback from a root session, though agent
  edits then require a restart.
- **H0 and H1 are partially delivered.** The `ivi-building/` tree, `ivi-building/CLAUDE.md`, the
  repo-root scoping table, and `.claude/rules/ivi-building.md` landed during design. Step 1 verifies
  them; it does not rebuild them.
- **H2 is the first milestone whose deliverable is agent behavior.** From H2 onward, a green test suite
  is necessary but not sufficient — the milestone is not done until the harness has been run and the
  ledger shows it.
- **H8 is the evidence run** and the milestone the final report is written from. §12 of the milestone
  plan records the fallback if it is at risk: narrow the codegen target to *package + scenario only*,
  which the existing test suite and `scripts/calibrate_forecast_demo.py` can already validate end to
  end. The behavioral diff survives that narrowing; drop the prototype before dropping the diff.
</content>
