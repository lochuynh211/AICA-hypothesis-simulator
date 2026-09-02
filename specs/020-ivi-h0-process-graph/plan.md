# Implementation Plan: IVI Harness H0 — Process Graph And Repo Scaffold

**Branch**: `ivi-h0-process-graph` | **Date**: 2026-09-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/020-ivi-h0-process-graph/spec.md`

**Approved design**: `docs/superpowers/specs/2026-09-02-ivi-h0-design.md` — authoritative for component
boundary, schema, extraction rules and test layout. **Parent design**:
`docs/superpowers/specs/2026-09-01-ivi-process-agent-harness-design.md`.

> This feature belongs to `ivi-building/`, the IVI process agent harness, governed by
> `ivi-building/CLAUDE.md`. The AICA simulator is this project's expected *output* and is not edited here.

## Summary

Transcribe the two IVI process source documents into one machine-readable artifact — 3 phases, 16
activities, 236 work items — plus a generated human-readable extraction report, and prove the parse
faithful by validating it against a claim the source document makes independently of the rows being
parsed: its own separately-stated 12-step critical path.

Technical approach: a single deterministic parser module driven by a thin skill. Heading-anchored parsing
of ten regular bullet labels present on all 255 rows; a six-form dependency-cell resolver; four derived
property groups; union-of-both-directions edge construction with `forward`/`revisit` classification;
two-field thread membership. Byte-identical re-extraction is achieved by fixed serialisation order and
the deliberate absence of any timestamp. Findings about the source document are recorded, never repaired;
an unrecognised dependency notation is a hard failure, not a dropped edge.

## Technical Context

**Language/Version**: Python 3.12.7 (local Anaconda interpreter)

**Primary Dependencies**: standard library only for the extractor (`re`, `json`, `hashlib`, `pathlib`,
`argparse`). `pytest` 7.4.4 and `jsonschema` 4.23.0 for the gate — both already installed. No new
third-party runtime dependency.

**Storage**: files. `ivi-building/graph/process_graph.json` (structured, committed) and
`ivi-building/graph/extraction_report.md` (generated, committed). No database, no service.

**Testing**: `pytest`, five files under `ivi-building/tests/`, plus a JSON Schema contract validated with
`jsonschema`.

**Target Platform**: local developer machine, Windows 11 with Git Bash. Must not depend on Docker (absent
here) or `uv` (proxy-blocked). Console default encoding is cp932, so every file read and write pins
UTF-8 explicitly and any script printing Japanese sets `PYTHONIOENCODING=utf-8`.

**Project Type**: offline data-extraction tool plus its test suite. No server, no UI.

**Performance Goals**: not a driver. The extractor parses ~4,250 lines across two documents; a whole run
should stay well under 5 seconds so it is cheap to re-run on every source revision.

**Constraints**: byte-identical re-extraction (the artifact therefore holds no timestamp); atomic writes
so a failure leaves committed output untouched; paths resolved relative to the module's own location so
the extractor behaves identically from `ivi-building/` and from the repository root.

**Scale/Scope**: 255 rows, ~2,600 dependency references after range and suffix expansion, 10
dependency-summary entries, 16 activity F-rating lines, 16 activity overview blocks. Fixed and known —
this is a bounded transcription, not an open-ended data pipeline.

**No NEEDS CLARIFICATION remain.** Every value above is measured or already decided; see
[research.md](./research.md).

## Constitution Check

*GATE: must pass before Phase 0 research; re-checked after Phase 1 design.*

The constitution governs the AICA simulator. This feature is in a different project in the same
repository, so each principle is evaluated for whether it binds here, and the harness's analogous
invariant is named where it does not.

| Principle | Binds? | Assessment |
|---|---|---|
| **I. Backend is the source of truth** | No | No simulator runtime is involved. The harness's analogue — run state is derived from the append-only ledger — is not exercised until H2. |
| **II. Evidence is append-only and failures are never hidden** | **Yes, by analogy** | **PASS.** FR-021 makes an unparseable input a hard failure that names the offending source text; FR-022/024 record source-document defects as findings and forbid repairing them. Nothing is disguised as success. |
| **III. Deterministic, replayable** | **Yes, by analogy** | **PASS.** FR-027 requires byte-identical re-extraction and forbids any varying value in the output, which is why `meta` carries no timestamp. |
| **IV. Qualitative trigger discipline** | No | No triggers, no numeric binning. |
| **V. One generic algorithm adapter contract** | No | No algorithms. |
| **VI. Local-first simplicity (YAGNI)** | **Yes** | **PASS.** File-based, single-user, offline, standard library only. `lib/` grows one flat module per milestone with no speculative package tree, and H0 adds exactly two modules. |

| Security & Safety boundary | Assessment |
|---|---|
| BYO-key only | Not applicable — no external service, no key. |
| Local trusted code only | **PASS.** The extractor is local trusted code reading two tracked documents. |
| Setup-time mutation only | Not applicable. |
| **No silent failure into trusted evidence** | **PASS, and it is the load-bearing one here.** An unrecognised dependency notation stops the extraction rather than silently dropping an edge; a partially written file is never observable (FR-029). |

| Development workflow gate | Assessment |
|---|---|
| Spec-driven development | **PASS.** This feature runs the full cycle; the constitution check is this section. |
| **Contract surfaces are tested first** | **PASS.** The graph artifact *is* the contract surface for milestones H1–H8, so it carries a published JSON Schema in `contracts/` validated by the test suite, and every acceptance criterion is a test. TDD is genuine throughout because every component is deterministic code. |
| Every milestone stays runnable | **PASS.** H0 leaves the harness testable via one command and easier to review than prose. |
| **Generated artifacts are never hand-edited** | **PASS.** FR-031 covers both generated files; the determinism test detects a hand edit as a diff against a fresh extraction. |

**Result: PASS, no violations.** Complexity Tracking is therefore omitted.

**Post-Phase-1 re-check: PASS.** The Phase 1 design added one contract artifact (a JSON Schema) and no
new dependency beyond the already-installed `jsonschema`. It introduced no service, no persistence layer
and no abstraction not required by an acceptance criterion, so Principle VI still holds.

## Project Structure

### Documentation (this feature)

```text
specs/020-ivi-h0-process-graph/
├── spec.md                            # feature specification (complete, clarified)
├── plan.md                            # this file
├── research.md                        # Phase 0: decisions with measurements
├── data-model.md                      # Phase 1: entities and derivation rules
├── quickstart.md                      # Phase 1: how to run and verify
├── contracts/
│   ├── process_graph.schema.json      # the artifact contract H1–H8 consume
│   └── cli.md                         # extractor command contract
├── checklists/
│   └── requirements.md                # spec quality checklist (16/16)
└── tasks.md                           # Phase 2 output (/speckit-tasks)
```

### Source code

All work lands inside `ivi-building/`. Nothing outside it is touched.

```text
ivi-building/
├── .claude/skills/ivi-graph-build/
│   └── SKILL.md                       # NEW — dialogue routine; runs the extractor, triages findings
├── lib/
│   ├── process_graph.py               # NEW — parse both sources, derive, serialise, report, CLI
│   └── graph_query.py                 # NEW — load + traverse; reused by H3's run auditor
├── graph/
│   ├── process_graph.json             # NEW, generated + committed — read-only data afterwards
│   └── extraction_report.md           # NEW, generated + committed — the human-readable numbers
└── tests/
    ├── conftest.py                    # NEW — puts lib/ on sys.path; session-scoped graph fixture
    ├── test_graph_schema.py           # NEW — counts, per-row completeness, JSON Schema contract
    ├── test_graph_edges.py            # NEW — resolution, 215 asymmetries, 1 revisit, topo sort
    ├── test_graph_derived.py          # NEW — granularity, 19 human stops, flags, conditional skip
    ├── test_graph_thread.py           # NEW — critical-path reachability, 234/210/26 memberships
    └── test_graph_determinism.py      # NEW — byte-identity, committed == fresh, report too
```

Read-only inputs, never modified:

```text
others/20260826_IVI_SYS1-2_Planning_Requirements_Definition_Process_List.md
others/20260826_IVI_Process_x_AI_Hypothesis_Driven_Application_Map_v2.md
```

**Structure Decision.** The single-project layout applies, rooted at `ivi-building/` rather than at the
repository root, because that directory is a self-contained project with its own governing `CLAUDE.md`.
`lib/` is flat by decision — one deterministic module per milestone that needs one, no package `__init__`
tree — so `graph/` stays pure read-only data as the parent design intends. Modules are imported by name
(`import process_graph`) via a `sys.path` entry added in `conftest.py`, and the extractor runs as a plain
script, which avoids a package `__init__.py` and keeps each module liftable.

## Module design

### `lib/process_graph.py`

Pure functions, one concern each, so every one is independently testable and none needs a fixture larger
than a string.

| Function | Responsibility |
|---|---|
| `read_source(path)` | UTF-8 read + content digest |
| `parse_rows(text)` | heading-anchored split into 255 raw rows, capturing bullets against an explicit label whitelist — ten required, three optional (`ASPICE BP` 135 rows, `AI hypothesis-driven applicability` 7, `Rationale` 1); raises on a missing required label **and** on a label not on the whitelist |
| `parse_edge_cell(raw, owner_id)` | the six dependency notations → resolved IDs + prose `external_refs`; raises on an unknown form |
| `classify_granularity(raw)` | → `(level, owner, gate_kind)`; raises if unparseable |
| `split_dod(raw)` | `①②③④` markers → indexed clauses; single unnumbered sentence → one clause |
| `parse_outputs(raw)` | declared output name + parenthetical column shape |
| `parse_dependency_summary(text)` | 10 entries with resolved node IDs |
| `parse_overview(text)` | 16 activity blocks, tolerant of the parenthetical label suffix |
| `parse_f_ratings(text)` | 16 rating lines → primary / effective / auxiliary |
| `build_edges(rows)` | union of both directions, `declared_by`, `forward`/`revisit`, asymmetry findings |
| `derive_flags(rows, dep_summary)` | `critical_path`, `external_lead_time`, `hard_deadline`, `conditional_skip`, `requires_human` |
| `compute_thread(edges, rows)` | `goal_relevant`, `on_thread`, containment, excluded list |
| `build_graph(...)` | assemble `meta` / `nodes` / `edges` / `dependency_summary` / `thread` / `findings` |
| `serialize(graph)` | deterministic UTF-8 bytes |
| `render_report(graph)` | deterministic Markdown report |
| `write_atomic(path, data)` | temp file + move on success only |
| `main(argv)` | `--extract` (default) and `--check` |

Paths resolve from `Path(__file__).resolve().parents[1]`, so behaviour is identical whether invoked from
`ivi-building/` or from the repository root.

### `lib/graph_query.py`

Load-and-traverse only; no parsing, no writing. `load(path=None) -> Graph`; `Graph.node(id)`,
`.by_level(level)`, `.successors(id, kind="forward")`, `.predecessors(...)`, `.reachable_from(id)`,
`.ancestors_of(ids)`, `.topo_order(kind="forward")` (raises on a remaining cycle), `.findings(kind=None)`,
`.thread`. The parent design §7 requires the test suite and H3's run auditor to be the same code, which
is why traversal is a module rather than test-local helpers.

### `.claude/skills/ivi-graph-build/SKILL.md`

Holds no orchestration and no parsing logic. It: confirms the two source paths; runs the extractor;
reports counts, findings by kind, and thread memberships; on a revision presents the count and findings
deltas plus any newly unrecognised notation and hands the diff to the human; refuses to hand-edit either
generated file; and states that an extraction failure is escalated, never worked around.

## Determinism mechanics

The single hardest criterion, so its mechanics are fixed here rather than left to implementation taste:

- `json.dumps(graph, ensure_ascii=False, indent=2)` followed by a trailing newline, encoded UTF-8 and
  written with `newline="\n"` so Windows cannot inject `\r`.
- **No timestamp, no absolute path, no interpreter version, no run counter** anywhere in either output.
- Node order = source-document order. Edge order = sorted by `(from, to, kind)`. Findings order = sorted
  by `(kind, node, message)`. Every list whose natural order is not the document's is sorted explicitly.
- `meta.sources[]` holds each source's repository-relative path and content digest — relative, because an
  absolute path would differ per machine and break byte-identity.
- The report is rendered from the finished graph only, so it cannot disagree with it.

## Verification strategy

Every acceptance criterion maps to a test; `tasks.md` carries the full matrix. Four points of substance:

1. **The critical-path test asserts reachability, not adjacency**, and says so in its docstring, because 0
   of the 11 hops are adjacent edges. Without that note a later reader would reasonably mistake it for a
   weakened assertion.
2. **The measured criteria produce their numbers as output, not as an assertion that a mechanism exists.**
   The 215 asymmetries, the 234/210/26 memberships and the 19 human stops are written into the extraction
   report by the extractor and asserted by tests against exact values.
3. **The determinism test extracts twice into separate temporary directories** and compares bytes, then
   compares the committed artifact against a fresh extraction — which is also what catches a hand edit.
4. **No agent behaviour is verified in H0** because none exists. Fixture-run and seeded-defect layers
   begin at H2. Claiming otherwise here would be false comfort.

Gate command, from the repository root or from `ivi-building/`:

```bash
python -m pytest ivi-building/tests/ -v
```

## Risks

| Risk | Handling |
|---|---|
| A dependency notation exists that the six-form inventory missed | The probe pass resolved 255/255 rows with 0 unresolved references, so the inventory is complete for this revision. An unknown form is a hard failure by design, so a future revision surfaces it loudly rather than silently. |
| A labelled field exists that the parser drops silently | Found during cross-artifact analysis: `SYS1-08-c` alone carries an eleventh `Rationale` bullet. Handled by parsing against an explicit label whitelist and hard-failing on an unknown label, so dropped source content becomes impossible rather than merely unlikely. |
| A look-alike glyph breaks rating parsing | The F-ratings use `U+25EF` LARGE CIRCLE, not `U+25CB` WHITE CIRCLE, and a mismatch would yield a silently empty `f_ratings` rather than an error. Codepoints are pinned in `data-model.md` and asserted by codepoint in T018b and T019. |
| cp932 console mangles Japanese output | Every read and write pins UTF-8; the report is written as bytes. Any script printing Japanese sets `PYTHONIOENCODING=utf-8`. |
| Byte-identity broken by an incidental varying value | Enumerated and forbidden above; the determinism test is the check, and it runs on every gate. |
| Windows line endings injected on write | Writes are binary with an explicit `\n`; `.gitattributes` already exists in this repository and is not modified. |
| Scope creep into H1 territory | FR-032 forbids agents, run workspace, ledger, pack and templates in this feature; `tasks.md` contains no task touching them. |
