# Phase 0 Research: IVI Harness H0

**Feature**: `specs/020-ivi-h0-process-graph` · **Date**: 2026-09-02

No `NEEDS CLARIFICATION` markers entered Phase 0. Every open question was closed by **measuring the
source documents** before the specification was written, or by a decision taken with the user during
design. This document records what was measured, what was decided, and what was rejected — so a later
reader can tell a measurement from an assumption.

---

## R1 — How regular is the source document?

**Measured.** All 255 rows carry the same ten labelled bullets, with no exceptions:

```
255  - **Purpose:**              255  - **Predecessor / Successor:**
255  - **Work content:**         255  - **Entry:**
255  - **Input deliverables:**   255  - **Exit (DoD):**
255  - **Input source:**         255  - **Concrete examples:**
255  - **Output deliverables:**  255  - **Granularity / completeness:**
135  - **ASPICE BP:**              7  - **AI hypothesis-driven applicability:**
```

Row headings are equally regular: 3 `### PHn (L1)`, 16 `### SYS[12]-nn (L2)`, 236 `#### SYS[12]-nn-x`.

**Decision**: heading-anchored parsing with ten label regexes. The two low-count labels are optional
per-row fields (`aspice_bp`, `ai_applicability`); their absence is not an error.

**Alternatives rejected**: parsing the source `.xlsx` workbooks directly — the Markdown translations are
the tracked, reviewable, human-readable source of truth, and adding an Excel reader would introduce a
third-party dependency for no gain. Treating the document as free text and extracting with a model — see
R8.

---

## R2 — Is the stated critical path a connected path?

**Measured.** For all 11 consecutive pairs on the document's stated 12-step critical path:

| Hop | Adjacent edge? | Reachable? |
|---|---|---|
| all 11 | **no — 0 of 11** | **yes — 11 of 11** |

`SYS1-01-o`'s declared successors are `SYS1-02-a, SYS1-03-a, SYS1-05-a, SYS1-06-a` — the *first* work item
of each downstream activity, never the *last*. The critical path names each activity's terminal step, so
consecutive critical-path nodes are always separated by an activity's worth of intermediate steps.

**Decision**: the criterion is satisfied by **reachability through a directed path**, asserted per hop,
with the reason stated in the test's docstring.

**Alternatives rejected**: asserting adjacency — it is simply false of this document, and weakening the
test to "the nodes all exist" would remove the only independent validation of the parse.

---

## R3 — Is the dependency graph acyclic?

**Measured.** As literally transcribed: **71 of 255** rows topologically sort. Strongly-connected-component
analysis finds exactly **one** non-trivial component, of 20 rows spanning `SYS1-04` and `SYS1-05`. It is caused by **exactly one back edge**, and the source document annotates that edge itself:

```
SYS1-05-f  — **Predecessor / Successor:** Predecessor: SYS1-05-e /
             Successor: SYS1-05-g, SYS1-04-e (revisit)
```

Excluding it: **255 of 255** rows sort.

**Decision**: every edge carries `kind: forward | revisit`. Only edges the document annotates may be
`revisit`. Ordering and thread computation use `forward` only; revisit edges are retained because the
parent design §4.6's rework paths and H6's reopen propagation need them.

**Alternatives rejected**: dropping the edge and recording only a finding — it discards a real documented
rework seam that H6 would have to re-derive from prose. Leaving edges undifferentiated and scoping the
acyclicity test to exclude anything whose raw text contains `(revisit)` — pushes source-text parsing into
the test layer and into every later consumer.

---

## R4 — How many dependencies does the document state in only one direction?

**Measured.** **215** of them. Examples:

```
SYS1-01-b lists succ SYS1-02-a, but SYS1-02-a does not list pred SYS1-01-b
SYS1-01-l lists pred SYS1-01-k, but SYS1-01-k does not list succ SYS1-01-l
PH1       lists succ SYS1-07,   but SYS1-07   does not list pred PH1
```

**Decision**: the edge set is the **union of both declaration directions**, each edge records which
direction declared it, and each one-directional declaration becomes an `info` finding. The extraction
succeeds.

**Alternatives rejected**: treating asymmetry as a parse failure — 215 failures would make the document
unparseable when it is merely one-sidedly authored. Repairing them silently — that asserts a dependency
the document states only once, which is a claim about the process, not about the parse. Keeping only
declared-successor edges — loses 215 real dependencies and would break the critical-path reachability
test.

---

## R5 — What is the goal thread, really?

**Measured.** Ancestors of the terminal set `{SYS2-16-n, SYS2-11-n, SYS2-14-l}` over forward edges:

| Set | Count |
|---|---|
| L3 work items total | 236 |
| ancestors of a terminal node | **234** |
| off-thread under pure ancestry | 2 — `SYS2-16-o`, `SYS2-16-p` |

Activities 13 and 15 come out **on**-thread: `SYS2-13-*` and `SYS2-15-*` genuinely feed `SYS2-16-e`/`-c`.
That contradicts the parent design's D3, D12 and milestone H7, which all state those two activities are
off-thread and auto-skipped. Both statements cannot be true of this document.

**Decision** (taken with the user): **two fields with distinct meanings.**

| Field | Definition | Count |
|---|---|---|
| `goal_relevant` | ancestor of a terminal node — keeps the parent design's computed rule literally true | **234** |
| `on_thread` | `goal_relevant` ∩ parent activity in `thread_activities` (D3's 14 activities) | **210** |

Off-thread is then 26: `SYS2-13` ×12, `SYS2-15` ×12, `SYS2-16-o`, `SYS2-16-p`. A containment rule adds
each on-thread item's parent activity and phase, because parent/child is not an edge — without it
`SYS2-11` the activity would not be in the thread and the milestone's own criterion could not hold.
Verified: all 12 critical-path nodes plus `SYS2-11` and `SYS2-14` are in the thread.

**Alternatives rejected**: pure computed ancestry alone — makes `skipped_off_thread` cover 2 items and
forces D12/H7 to be rewritten. Declared activity selection alone — abandons "computed, not guessed" and
puts `SYS2-16-o`/`-p` back on-thread.

---

## R6 — Which rows are genuine human approval events?

**Measured.** The granularity column carries two independent facts, separated sometimes by an em dash and
sometimes by a colon. Cross-tabulating level against the kind of sign-off named:

| level | gate kind | count |
|---|---|---|
| fixed | decision_meeting | **5** |
| fixed | department_agreement | **14** |
| fixed | owner_approval | 7 |
| fixed | review_confirm | 28 |
| fixed | record | 12 |
| fixed | none | 5 |
| draft | decision_meeting | 8 |
| draft | review_confirm | 15 |
| draft | owner_approval | 1 |
| draft | none | 90 |
| rough | review_confirm | 5 |
| rough | none | 65 |

All 255 rows parse; there is no unparseable granularity cell.

Two traps, both real:

- `SYS1-02-r` reads "Draft version — reviewed by the planning owner, **not yet approved by the
  decision-making meeting**". A substring match on "decision-making meeting" marks it a human stop when
  the text says the opposite.
- 12 `fixed` rows read "settled as the analysis result", "fixed as the results", "settled as the result of
  the inquiry". The Legend explicitly defines *fixed* as "approved by the decision-making meeting, **or
  settled as a fact / record**", so these are records, not approvals.

**Decision** (taken with the user): `requires_human` = `fixed` ∧ gate kind ∈ {`decision_meeting`,
`department_agreement`} → **19** rows. All 255 rows carry `granularity_level`, verbatim
`granularity_owner` and `human_gate_kind`, so H3 can widen the hard-stop set without re-extracting.

**Alternatives rejected**: every `fixed` row (71) — creates 71 hard stops in a 236-item run, 12 of them on
rows where nobody approves anything. Decision-meeting only (5) — drops all 14 inter-department agreements,
which the parent design's non-goals list explicitly names as human events.

---

## R7 — Which dependency-cell notations exist?

**Measured.** Six forms, inventoried across all 26 irregular lines:

| Form | Instances in the source |
|---|---|
| full work-item ID | `SYS1-01-b` |
| activity ID where a work item is expected | `SYS1-04-t → SYS2-10`, `SYS1-05-o → SYS2-13` |
| phase ID with a parenthetical | `PH2 (SYS1-07)`, `PH1 (SYS1-06)` |
| suffix continuation | `SYS1-04-e, -g, -s`, `SYS1-05-j, -k, -l, -m, -n` |
| range — four spellings | `SYS1-03-g through -n` · `SYS2-14-b–h` · `SYS1-07-a – d` · `SYS1-02 – SYS1-05` |
| prose, naming nothing in this process | `the following phases (architecture design, vendor selection / SYS.3 onward)` |
| the literal `none` | 3 rows |

Annotations to strip: `(revisit)`, `(and all other work items)`, `(start of PH2)`, `(start of PH3)`.

**Decision**: a single resolver handling all six, with suffix continuation tracking the last full ID's
activity prefix and ranges expanding at both work-item and activity level. Prose targets become
`external_refs` and never edges. **`SYS.3` must not be mistaken for an ID** — the ID pattern requires a
hyphen, not a dot. **An unmatched token is a hard failure**, so a revised document surfaces a new notation
loudly instead of losing a dependency.

**Validation of this decision**: a probe implementation of exactly these rules resolved **255 of 255 rows
with 0 unresolved references**.

---

## R8 — Should the extraction be code or a model pass?

**Decision** (taken with the user): a deterministic parser, roughly 400 lines across two modules, driven
by a thin skill. Orchestration remains entirely Claude Code, per the parent design's D13; this is the
enforcement case D14 carves out.

**Rationale**: the interesting output of H0 is the 215 asymmetry count and the single revisit edge —
claims about defects in the customer's own source document, which the final report may quote. "A parser
derived them and a test asserts them" is materially stronger provenance than "a model counted them while
reading". Byte-identical re-extraction (FR-027) is also unachievable in its literal form under a model
pass, and the source documents are dated and will be revised.

**Alternatives rejected**: a model transcription pass with tests only (~330 lines) — smallest surface and
closest to a pure skill-driven harness, but FR-027 would have to be reinterpreted as a source-hash no-op,
and a revision would mean a fresh manual pass. A parser without the shared traversal module — saves ~80
lines now, but H3's run auditor then duplicates traversal, against the parent design §7's requirement that
the test suite and the run auditor be the same code.

---

## R9 — Where does deterministic code live?

**Decision** (taken with the user): `ivi-building/lib/`, flat, growing **one module per milestone that
needs one**. No package `__init__` tree and no directories for milestones that have not happened. H0 adds
`lib/process_graph.py` and `lib/graph_query.py`. Tests add `lib/` to `sys.path` in `conftest.py`; the
extractor runs as a plain script, so no `__init__.py` is needed and each module stays liftable.

**Alternatives rejected**: flat modules inside `graph/` — mixes code into the directory the parent design
calls read-only data, and leaves H1's firewall hook nowhere to share path-matching from. Code inside the
skill directory — self-contained but awkward to import from tests and unshareable with hooks and later
validators.

---

## R10 — Is `jsonschema` available for a machine-checked contract?

**Measured.** `jsonschema` 4.23.0 and `pytest` 7.4.4 are both installed on the local Python 3.12.7
interpreter. `hashlib`, `json` and `re` are standard library.

**Decision**: publish `contracts/process_graph.schema.json` as the artifact contract H1–H8 consume, and
validate the generated artifact against it in the test suite. This makes schema drift between design and
implementation a test failure rather than something a reviewer must notice by reading — which is exactly
one of the defects the milestone's own closing review looks for.

The extractor itself takes **no third-party dependency**; `jsonschema` is used only by the test suite.

**Alternatives rejected**: prose-only contract with hand-rolled structural assertions — no external
dependency, but drift becomes invisible and every later milestone re-invents the checks. Skipping the
schema test when `jsonschema` is absent — a skip that converts into a false pass, which this project
forbids on principle.

---

## R11 — Environment constraints that bound the gate

**Measured.** Docker is absent in this environment and `uv` is proxy-blocked, so neither may become a
dependency of the gate. The console default encoding is **cp932**, which raised
`UnicodeDecodeError: 'cp932' codec can't decode byte 0x94` during probing until every read pinned UTF-8.

**Decision**: the gate is `python -m pytest ivi-building/tests/` on the local Python 3.12 interpreter.
Every file read and write pins UTF-8 explicitly; report output is written as bytes; any script printing
Japanese sets `PYTHONIOENCODING=utf-8`. Paths resolve from the module's own location so the extractor
behaves identically from `ivi-building/` and from the repository root.

**Alternatives rejected**: a Docker-based or `uv`-based gate — neither works here.

---

## Measurement provenance

Every number in this document was produced by a throwaway probe implementation run against the
2026-08-26 revision of the two source documents, before the specification was written. The probe was
exploratory and is not part of the deliverable; the shipped extractor re-derives every number, and the
test suite asserts them. If a shipped number disagrees with this document, the shipped extractor is
correct and this document is stale.
