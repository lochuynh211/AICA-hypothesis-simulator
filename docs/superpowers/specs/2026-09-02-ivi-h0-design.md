# IVI Process Agent Harness — H0 Design: Process Graph And Repo Scaffold

*Date: 2026-09-02 · Status: approved · Milestone: **H0** · Branch: `ivi-h0-process-graph`*

**Parent design:** `docs/superpowers/specs/2026-09-01-ivi-process-agent-harness-design.md` — authoritative
except where this document records a decision that corrects or refines it (§8 lists every such edit).

**Milestone plan:** `ivi-building/docs/ivi_process_harness_milestones.md` §2.

---

## 1. What H0 delivers

Turn the two source documents into machine-readable data, and make the harness directory real.
**Nothing executes yet, and the milestone does not pretend otherwise.**

What becomes demonstrable that was not before: the 255-row process breakdown becomes a queryable graph
whose parse is validated against a claim the source document makes independently — its own stated
critical path — so every later milestone resolves "what is the next runnable step" from data rather
than from prose.

Out of scope, per the milestone's own boundary: no agents, no skills beyond `ivi-graph-build`, no run
workspace, no ledger, no `pack.json`, no firewall hook, no templates. H0 produces data and tests only.

## 2. Measurements that drove the design

Every number below was measured against the source documents before the design was written, not
assumed. They are restated as test assertions in §6.

| Measurement | Value |
|---|---|
| Rows | 3 L1 + 16 L2 + 236 L3 = **255** |
| Predecessor/successor references unresolved after expansion | **0** |
| Declaration asymmetries (edge stated in one direction only) | **217** |
| Back edges | **1** — `SYS1-05-f → SYS1-04-e`, annotated `(revisit)` in the source |
| Topological sort including the back edge | **69 of 255** |
| Topological sort over forward edges only | **255 of 255** |
| Critical-path hops that are adjacent edges | **0 of 11** |
| Critical-path hops reachable by a directed path | **11 of 11** |
| L3 nodes that are ancestors of a terminal node | **234 of 236** |
| L3 nodes on the declared thread | **210** |
| Nodes with `requires_human` | **19** |
| `conditional_skip` nodes | **1** — `SYS1-01-e` |
| L3 DoD clause counts | 2 clauses ×20, 3 ×211, 4 ×5 |
| Dependency Summary entries | **10**, four rows each |
| Process Overview activity blocks | **16**, six rows each |
| Application Map F-rating lines | **16** |

## 3. Component boundary

Three pieces. The split follows the parent design's D13 (Claude Code is the orchestrator) and D14
(non-model code only where execution or enforcement is required).

| Piece | Owner | Why it is what it is |
|---|---|---|
| `.claude/skills/ivi-graph-build/SKILL.md` | Claude Code | Confirm sources, run the extractor, present the findings table, triage with the human, refuse to guess on unseen syntax |
| `lib/process_graph.py`, `lib/graph_query.py` | deterministic code | Transcription carrying an exact-count acceptance criterion; traversal shared by the tests and, from H3, by the run auditor |
| `tests/test_graph_*.py` | deterministic code | The acceptance gate itself |

**Zero orchestration code.** From H3 on, the runner reads `process_graph.json` and reasons; no Python
re-walks the graph on the harness's behalf.

### 3.1 `lib/` convention

`ivi-building/lib/` holds the harness's deterministic modules and **grows one flat module per milestone
as that milestone needs it**. No package `__init__` tree, no directories for milestones that have not
happened. `tests/conftest.py` puts `lib/` on `sys.path` and exposes a session-scoped fixture holding the
loaded graph.

H0 adds exactly two modules:

```
ivi-building/
  lib/
    process_graph.py     parse both source documents, derive, serialize
    graph_query.py       load + traverse: reachability, ancestors, topological sort
  graph/
    process_graph.json   read-only data, committed
  .claude/skills/ivi-graph-build/SKILL.md
  tests/
    conftest.py
    test_graph_schema.py  test_graph_edges.py  test_graph_derived.py
    test_graph_thread.py  test_graph_determinism.py
```

`graph/` stays pure data, as the parent design intends. `hooks/firewall.py` in H1 may import shared
path-matching from `lib/` rather than duplicating it.

### 3.2 The artifact is committed

`graph/process_graph.json` is tracked in git. The parent design calls it "extracted once, then read-only
data" and H1 onward depend on it existing; it contains nothing confidential, only content already
tracked under `others/`; and committing it makes byte-identity checkable as a diff against `HEAD` rather
than only as a self-comparison. It is a generated artifact and is never hand-edited, matching the
constitution's "generated artifacts are never hand-edited" rule that `speckit-plan` will check this
feature against.

## 4. Schema

```
process_graph.json
  meta                     schema_version, extractor_version,
                           sources[{path, sha256}], counts{L1,L2,L3,total,edges,findings}
  nodes[255]               document order
  edges[]                  sorted by (from, to, kind)
  dependency_summary[10]
  thread                   terminals, thread_activities, goal_relevant[], on_thread[]
  findings[]               sorted; {severity, kind, node, message, raw}
```

**`meta` carries no timestamp.** A timestamp would break the byte-identity criterion by construction.

### 4.1 Node fields — transcribed

`id` · `level` · `parent` · `phase` · `name` · `purpose` · `work_content` · `inputs[]` ·
`input_sources[]` · `outputs[{name, shape}]` · `entry` · `exit_dod[{index, clause}]` · `examples[]` ·
`aspice_bp?` · `ai_applicability?`

L1 and L2 nodes carry a single unnumbered DoD clause at `index: 1`; L3 nodes split on the source's
`①②③④` markers. `outputs[].shape` is the parenthetical column list where the source supplies one, else
`null`.

The three concrete examples per L3 row are transcribed **verbatim**. They are a calibration set written
in the rest-suggestion domain and are passed unmodified into step briefs from H2 on; paraphrasing them
would destroy their purpose.

### 4.2 Node fields — derived

**Granularity and human gating.** Three fields plus a boolean, because the source's granularity column
carries two independent facts — a completeness level and who signs off — and the Legend defines *fixed*
as "approved by the decision-making meeting, **or settled as a fact / record**". The separator is
sometimes an em dash and sometimes a colon.

- `granularity_level` ∈ `rough` | `draft` | `fixed`
- `granularity_owner` — the qualifier text, verbatim
- `human_gate_kind` ∈ `decision_meeting` | `department_agreement` | `owner_approval` |
  `review_confirm` | `record` | `none`
- **`requires_human` = `granularity_level == "fixed"` ∧ `human_gate_kind` ∈ {`decision_meeting`,
  `department_agreement`} → 19 nodes** (5 + 14)

Rationale for the rule: the 16 activity gates already *are* the planning owner's confirmation, so
routing `owner_approval` and `review_confirm` to a hard stop would double-gate 35 nodes; and `record`
denotes an inquiry or analysis result where no party approves anything. `human_gate_kind` is recorded on
all 255 nodes, so H3 can widen the hard-stop set without re-extracting.

Two traps this rule avoids, both real in the source: `SYS1-02-r`'s granularity reads "**not yet**
approved by the decision-making meeting", so a substring match on "decision-making meeting" would mark
it human when the text says the opposite; and 12 `fixed` nodes read "settled as the analysis result" or
equivalent.

**Dependency-summary flags.** `critical_path` (12 nodes), `external_lead_time` (8), `hard_deadline` (5)
— each resolved from the `dependency_summary` block rather than hardcoded, so a revised source moves
them automatically.

**`conditional_skip`** — `{raw, condition}` or `null`, derived from skip-prescribing language in the
entry condition. Exactly one exists: `SYS1-01-e`, *"if none exist, skip this work item and treat the
matter as a hypothesis."*

**Thread membership** — two separate booleans, `goal_relevant` and `on_thread`. See §5.

**L2 only** — `f_ratings {primary[], effective[], auxiliary[]}` from the Application Map's 16
`**F1–F9:**` lines (◎ → primary, ◯ → effective, △ → auxiliary, － → omitted); and
`overview {outline, main_outputs, owner, departments, completion_criterion, common_pitfall}` from the
process list's Process Overview section. Three of those six labels carry a parenthetical suffix on
activity 1 only, so label matching strips a trailing parenthetical.

The `overview` block is transcribed now because H3's gate presentation needs `completion_criterion` and
`common_pitfall`, and re-extracting later means touching a frozen artifact.

### 4.3 Edges

`{from, to, kind, declared_by, raw}` where `kind` ∈ `forward` | `revisit` and `declared_by` ∈
`successor` | `predecessor` | `both`.

The edge set is the **union of both declaration directions**. The source states most dependencies only
once — 217 of them — which is exactly what generates the asymmetry findings. Unioning is what makes
"every predecessor/successor ID resolves" a meaningful claim rather than a claim about half the data.

Edges may cross levels: an L3 row legitimately names an activity as its successor (`SYS1-04-t →
SYS2-10`), which the parent design §4.1 describes as input resolution. Cross-level edges are kept and
emit an informational finding.

### 4.4 `dependency_summary`

All ten entries, each `{kind, title, content, path_raw, path_nodes[], impact, mitigation}`. Kinds:
`critical_path`, `external_lead_time` ×2, `hard_deadline`, `confluence` ×2, `parallel` ×2, `rework` ×2.

Transcribing the whole sheet now serves three later milestones directly: H5's plan-narrowing confluence
rule, and H6's and H8's two rework paths, which the parent design §4.6 names as the reopen propagation
paths.

**Interpretation recorded, because it is a judgment call.** The sheet writes paths with `→`, and
`path_nodes[]` holds only the IDs actually listed — `SYS1-02-n → SYS1-02-p` yields two nodes, not the
span `n, o, p`. So `external_lead_time` covers 8 nodes. This is conservative: `SYS1-02-o` ("conduct the
interviews") is plainly external work but is not listed, so it is not flagged. H5, whose scope is
"▲ external-lead-time handling at scale", may widen the set using the Application Map's per-activity ▲
markers; `path_raw` is retained so that widening needs no re-extraction. Recorded here as a known
limitation rather than silently resolved.

## 5. The thread: two fields, not one

The parent design §4.5 states goal-relevance is "computed, not guessed: a step is goal-relevant iff it
is an ancestor of a terminal node". Computing that over the real edges puts **234 of 236** work items
on-thread, and activities 13 and 15 come out **on**-thread — `SYS2-13-*` and `SYS2-15-*` genuinely feed
`SYS2-16-e`/`-c`. That contradicts D3 ("activities 13 and 15 stay off-thread"), D12, and H7's
"off-thread and auto-skipped". The two statements cannot both be true of this document.

Resolution: **two fields with distinct, honest meanings.**

- **`goal_relevant`** — pure ancestry over forward edges from the terminal set. **234 L3 nodes.** The
  parent design's computed claim stays literally true.
- **`on_thread`** — `goal_relevant` ∩ nodes whose parent activity is in `thread_activities`.
  **210 L3 nodes.**

`thread_activities` is the parent design's D3 selection, stated once and held in the artifact: the 14
activities `SYS1-01`…`SYS1-09`, `SYS2-10`, `SYS2-11`, `SYS2-12`, `SYS2-14`, `SYS2-16`. `SYS2-13` and
`SYS2-15` are excluded.

`terminals` = `SYS2-16-n`, `SYS2-11-n`, `SYS2-14-l` — the parent design §4.5's set. The codegen outputs
it also mentions are not graph nodes, so they cannot be terminals here.

Off-thread is therefore **26** L3 nodes: `SYS2-13` ×12, `SYS2-15` ×12, and `SYS2-16-o`/`-p`. From H3 on,
`skipped_off_thread` keys on `on_thread == false`, which keeps that skip kind meaningful; H7's claim
that activities 13 and 15 auto-skip becomes true of the data.

**Containment rule.** A thread contains the parent activity and phase of every on-thread work item.
Parent/child is not an edge, so `SYS2-11` (the L2 node) is not an ancestor of `SYS2-11-n`; without this
rule the milestone's "thread contains … plus `SYS2-11`" criterion could not hold. With it, all 12
critical-path nodes plus `SYS2-11` and `SYS2-14` are in the thread — verified.

## 6. Extraction, and the fail-hard / finding split

Parsing anchors on heading regexes (`### PHn (L1)`, `### SYS[12]-nn (L2)`, `#### SYS[12]-nn-x`) and the
ten bold bullet labels every one of the 255 rows carries. **Every file is opened and written with
explicit UTF-8**; the console default in this environment is cp932, and any script printing Japanese
sets `PYTHONIOENCODING=utf-8`.

The predecessor/successor cell needs six forms. All 26 irregular lines were inventoried:

| Form | Examples from the source |
|---|---|
| full / activity / phase ID | `SYS1-01-b` · `SYS2-10` · `PH2 (SYS1-07)` |
| suffix continuation | `SYS1-04-e, -g, -s` |
| range, four spellings | `SYS1-03-g through -n` · `SYS2-14-b–h` · `SYS1-07-a – d` · `SYS1-02 – SYS1-05` |
| prose target, not an ID | `the following phases (architecture design, vendor selection / SYS.3 onward)` |
| annotation | `SYS1-04-e (revisit)` · `(and all other work items)` |
| `none` | — |

Prose targets become `external_refs` on the node and never become edges. `SYS.3` must not be mistaken
for an ID.

**Fail hard** — node count ≠ 255; an ID that does not resolve; a cycle among forward edges; an
unparseable granularity or DoD cell; an edge-cell token matching none of the six forms.

**Emit a finding** — declaration asymmetry (217, severity `info`); cross-level edge; prose target;
`revisit` edge.

The distinction is the whole point of the split: a new syntax in a revised source document must stop the
build and reach the human, not get silently dropped. Findings are observations about the source
document; failures are statements that the extractor does not understand its input.

### 6.1 The revisit edge

Every edge carries `kind`. The one edge the source itself annotates `(revisit)` — `SYS1-05-f →
SYS1-04-e` — is `kind: "revisit"`. Topological sort and thread computation use `forward` edges only.
Revisit edges are **retained as data**, because the parent design §4.6's rework paths and H6's reopen
propagation need them; dropping the edge would mean re-deriving it from prose later.

## 7. Tests

Five files. Every one is ordinary deterministic code, so H0 is genuine TDD throughout: failing test
first, no exceptions. There is no agent behavior in H0, so the fixture-run and seeded-defect layers
(parent design §7 layers 3–4) do not apply; they begin at H2.

| File | Assertions |
|---|---|
| `test_graph_schema.py` | 3 / 16 / 236 = 255 · every L3 has ≥1 DoD clause, ≥1 output, non-empty entry · field types · parent and phase consistency · L2 nodes carry `f_ratings` and `overview` |
| `test_graph_edges.py` | every predecessor/successor ID resolves · asymmetries are findings, not failures, **count == 217** · exactly one `revisit` edge, and it is `SYS1-05-f → SYS1-04-e` · forward-edge topological sort yields all 255 |
| `test_graph_derived.py` | `requires_human` true on exactly 19 · true for all 5 fixed+`decision_meeting` nodes · **false for `SYS1-02-r`** · one `conditional_skip`, `SYS1-01-e` · 12 `critical_path`, 8 `external_lead_time`, 5 `hard_deadline` |
| `test_graph_thread.py` | **all 11 critical-path hops reachable** · all 12 critical-path nodes plus `SYS2-11` and `SYS2-14` in the thread · `goal_relevant` == 234 · `on_thread` == 210 · off-thread == 26, being `SYS2-13` ×12 + `SYS2-15` ×12 + `SYS2-16-o`/`-p` |
| `test_graph_determinism.py` | two extractions into separate temp directories are byte-identical · the committed artifact equals a fresh extraction |

**The critical-path test asserts reachability, not adjacency**, because zero of the 11 hops are adjacent
edges — `SYS1-01-o`'s successors are `SYS1-02-a, SYS1-03-a, SYS1-05-a, SYS1-06-a`, not `SYS1-02-r`. The
test's docstring states this, so nobody later mistakes it for a weakened assertion. It remains the
strongest available extraction test: it validates the parse against a claim the document makes
independently of the rows the parse reads.

**What H0 deliberately does not test:** whether the transcribed prose is any *good*. That is not a
property of an extraction.

## 8. Failure behavior and the exit demonstration

`ivi-graph-build` on an unchanged source: reports "no change" and writes nothing. On a revision: hash
mismatch → re-extract → diff old against new → present the counts, the findings delta, and any newly
unparseable cell → the human decides. The skill never edits `process_graph.json` by hand and never
suppresses a hard failure.

**Exit demonstration.** From `cd ivi-building`: run `ivi-graph-build` for real, showing the 255 / 16 /
236 counts and the findings report; `python -m pytest tests/ -v` green; re-run the extractor and show a
zero-byte diff.

## 9. Corrections to the parent design and the milestone plan

The approved decisions change four statements in existing documents. Each edit is narrow.

**Parent design §3.2 — `requires_human` derivation.** "*`fixed` ⇒ hard human stop*" becomes the gate-kind
rule of §4.2, citing the Legend's "or settled as a fact / record" as the reason the simple rule
over-gates 12 record nodes.

**Parent design §3.2 — per-clause `requires_human`.** The schema example shows `requires_human` on each
DoD clause. **That field is not derivable from the source document**, which states no per-clause signoff;
`exit_dod` entries therefore carry `{index, clause}` only, and node-level `requires_human` drives the
human route. Per-clause verification routing (structural / semantic / human, parent design §4.3) is
assigned by H2's verifier, where the information to assign it first exists.

**Parent design §4.5 — goal relevance.** Gains the `goal_relevant` / `on_thread` distinction of §5, so
D3's exclusion of activities 13 and 15 stops contradicting the computed rule. The terminal set is stated
once: `SYS2-16-n`, `SYS2-11-n`, `SYS2-14-l`.

**Milestone plan H0.** Acceptance criterion on the critical path is reworded to reachability; the
goal-thread criterion is reworded to the terminal set and the containment rule; the scope list gains the
`dependency_summary` and `overview` blocks and the `lib/` convention.

**`ivi-building/CLAUDE.md`.** One invariant added: the process graph is extracted deterministically and
re-extraction on an unchanged source must be byte-identical, so `meta` carries no timestamp and the
artifact is never hand-edited.

## 10. Known limitations, carried forward deliberately

- `external_lead_time` flags only the 8 nodes the Dependency Summary lists, not every ▲ step. H5 may
  widen it; `path_raw` is retained so that needs no re-extraction (§4.4).
- 217 declaration asymmetries are reported, not repaired. Repairing them would mean asserting a
  dependency the source document states in only one direction — a claim about the process, not about the
  parse.
- The single `revisit` edge is data, not behavior. Nothing consumes rework edges until H6.
- `conditional_skip` finds one node because the source prescribes exactly one skip. H3's skip machinery
  is therefore exercised by one real case, which is what the milestone plan already anticipates.
