---

description: "Task list for IVI Harness H0 — Process Graph And Repo Scaffold"
---

# Tasks: IVI Harness H0 — Process Graph And Repo Scaffold

**Input**: Design documents from `/specs/020-ivi-h0-process-graph/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md — all present.

**Tests**: **MANDATORY and genuine.** Every component in this feature is deterministic code, so every
implementation task is preceded by a failing test. There is no agent behaviour in H0, so no fixture-run or
seeded-defect layer applies; those begin at H2. Claiming a behavioural test here would be false comfort.

**Organization**: grouped by the five user stories from spec.md.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel — different files, no dependency on an incomplete task
- **[Story]**: `[US1]`…`[US5]`, mapping to spec.md's user stories
- Every task names an exact file path

## Path Conventions

All work lands inside `ivi-building/`. Paths below are repository-relative.

- Extractor and traversal: `ivi-building/lib/`
- Generated data: `ivi-building/graph/`
- Skill: `ivi-building/.claude/skills/ivi-graph-build/`
- Tests: `ivi-building/tests/`
- Read-only inputs: `others/20260826_IVI_*.md`

**Gate command** (Docker is absent here and `uv` is proxy-blocked — neither may be used):

```bash
python -m pytest ivi-building/tests/ -v
```

---

## Phase 1: Setup

**Purpose**: make the test harness able to import the modules that do not exist yet.

- [x] T001 Create `ivi-building/lib/` with an empty `ivi-building/lib/.gitkeep`, and confirm no `__init__.py` is added — `lib/` is flat by decision, one module per milestone
- [x] T002 Create `ivi-building/tests/conftest.py` that inserts the absolute path of `ivi-building/lib` at the front of `sys.path`, resolving it from `Path(__file__).resolve().parents[1] / "lib"` so the suite runs from the repository root or from `ivi-building/`
- [x] T003 Add to `ivi-building/tests/conftest.py` a session-scoped `graph` fixture returning the loaded artifact via `graph_query.load()`, and a session-scoped `raw_sources` fixture returning the two source documents' UTF-8 text keyed by short name
- [x] T004 [P] Add to `ivi-building/tests/conftest.py` a session-scoped `contract_schema` fixture loading `specs/020-ivi-h0-process-graph/contracts/process_graph.schema.json`
- [x] T005 Run `python -m pytest ivi-building/tests/ -v` and confirm it **errors on collection** because `graph_query` does not exist — this is the expected starting state and proves the fixtures are wired

**Checkpoint**: the suite fails for the intended reason. FR-006 (explicit UTF-8) is exercised by T003 on its first read.

---

## Phase 2: Foundational — parsers no story can proceed without

**Purpose**: the row parser and the dependency-cell resolver. Every story reads them.

**⚠️ CRITICAL**: no user story work can begin until this phase is complete.

### Tests first

- [x] T006 [P] Write `ivi-building/tests/test_graph_schema.py::test_source_documents_are_read_as_utf8` asserting both source files load with explicit UTF-8 and that a known Japanese-containing line round-trips — must fail now (FR-006)
- [x] T007 [P] Write `ivi-building/tests/test_graph_schema.py::test_parse_rows_finds_255_headings` asserting `parse_rows` returns 3 `L1` + 16 `L2` + 236 `L3` — must fail now (FR-001, SC-001)
- [x] T008 [P] Write `ivi-building/tests/test_graph_edges.py::test_parse_edge_cell_*` as one test per notation, each using the real cell text from `research.md` R7: full ID, activity ID, phase ID with parenthetical (`PH2 (SYS1-07)`), suffix continuation (`SYS1-04-e, -g, -s`), all four range spellings (`SYS1-03-g through -n`, `SYS2-14-b–h`, `SYS1-07-a – d`, `SYS1-02 – SYS1-05`), prose target, and `none` — must fail now (FR-007, FR-008)
- [x] T009 [P] Write `ivi-building/tests/test_graph_edges.py::test_parse_edge_cell_rejects_unknown_notation` asserting an invented token raises rather than being dropped, and `::test_sys_dot_three_is_not_an_identifier` asserting `SYS.3` inside a prose target never becomes an ID — must fail now (FR-021, FR-008)
- [x] T009a [P] Write `ivi-building/tests/test_graph_schema.py::test_unknown_labelled_bullet_is_a_hard_failure` asserting `parse_rows` raises, naming the row and the label, when a row carries a labelled bullet the parser does not know — must fail now (FR-002a, FR-021)

### Implementation

- [x] T010 Create `ivi-building/lib/process_graph.py` with `read_source(path)` doing an explicit UTF-8 read and returning `(text, sha256)`, and a module-level `REPO_ROOT = Path(__file__).resolve().parents[2]` plus `HARNESS_ROOT = parents[1]` so paths never depend on the working directory (FR-006, FR-028)
- [x] T011 Implement `parse_rows(text)` in `ivi-building/lib/process_graph.py`: split section 4 on the three heading regexes, then capture the labelled bullets per row into a raw dict against an explicit label whitelist of the ten required plus the three optional (`ASPICE BP`, `AI hypothesis-driven applicability`, `Rationale`); **raise if a row is missing any of the ten, and equally if it carries a label not on the whitelist** — an unaccounted bullet means source content dropped silently (FR-001, FR-002, FR-002a, FR-021)
- [x] T012 Implement `parse_edge_cell(raw, owner_id)` in `ivi-building/lib/process_graph.py` handling all six notations of `research.md` R7, tracking the last full ID's activity prefix for suffix continuation, expanding ranges at both work-item and activity level, returning `(ids, external_refs)`, and **raising `UnknownNotation` on any unmatched token** (FR-007, FR-008, FR-021)
- [x] T013 Run `python -m pytest ivi-building/tests/test_graph_schema.py ivi-building/tests/test_graph_edges.py -v` and confirm T006–T009 pass; confirm `parse_edge_cell` in `ivi-building/lib/process_graph.py` resolves every one of the 255 rows' cells with **0 unresolved references**, and print that count

**Checkpoint**: rows and dependency cells parse. FR-001, FR-002 (partly), FR-006, FR-007, FR-008 satisfied.

---

## Phase 3: User Story 1 — Turn the process documents into a trustworthy graph (Priority: P1) 🎯 MVP

**Goal**: all 255 rows, every declared field populated, examples verbatim, activity rows carrying their
ratings and overview.

**Independent Test**: run the extraction, then confirm 255 rows with every declared field populated, and
that a randomly chosen work item matches its source row word for word.

### Tests for User Story 1

> Write these FIRST and confirm each fails for the intended reason.

- [x] T014 [P] [US1] Write `ivi-building/tests/test_graph_schema.py::test_every_l3_has_dod_output_and_entry` asserting all 236 work items have ≥1 DoD clause, ≥1 output and a non-empty entry, naming any offender (FR-002, SC-002)
- [x] T015 [P] [US1] Write `ivi-building/tests/test_graph_schema.py::test_dod_clause_counts` asserting the L3 clause histogram is exactly `{2: 20, 3: 211, 4: 5}` and that each of the 19 L1/L2 rows yields exactly 1 unnumbered clause (FR-002)
- [x] T016 [P] [US1] Write `ivi-building/tests/test_graph_schema.py::test_examples_are_verbatim` asserting, for `SYS1-01-a` and `SYS1-01-c`, that each example string is a literal substring of the source document — the guard against paraphrase (FR-003)
- [x] T017 [P] [US1] Write `ivi-building/tests/test_graph_schema.py::test_exit_dod_has_no_per_clause_human_flag` asserting every clause has exactly the keys `{index, clause}` — the deliberate correction to the parent design §3.2 (FR-017)
- [x] T018 [P] [US1] Write `ivi-building/tests/test_graph_schema.py::test_optional_fields_may_be_absent` asserting `aspice_bp` is non-null on exactly 135 rows, `ai_applicability` on exactly 7 and `rationale` on exactly 1, and that null is not an error (FR-002)
- [x] T018a [P] [US1] Write `ivi-building/tests/test_graph_schema.py::test_rationale_is_transcribed_on_sys1_08_c` asserting `SYS1-08-c` — the only row with an eleventh labelled bullet — has a non-null `rationale` whose text is a literal substring of the source, and that every other row has `rationale is None` (FR-002, FR-002a)
- [x] T018b [P] [US1] Write `ivi-building/tests/test_graph_schema.py::test_ai_applicability_values_are_preserved` asserting the 7 values are exactly 6 x `◯` (LARGE CIRCLE) and 1 x `★` (BLACK STAR), comparing by codepoint so a look-alike substitution fails (FR-002)
- [x] T019 [P] [US1] Write `ivi-building/tests/test_graph_schema.py::test_all_16_activities_carry_f_ratings` asserting each L2 row has `primary`/`effective`/`auxiliary` drawn only from `F1`…`F9` with no F number in two lists, and spot-checking `SYS1-01` → primary `["F1"]` and `SYS2-11` → primary `["F5"]` (FR-004)
- [x] T020 [P] [US1] Write `ivi-building/tests/test_graph_schema.py::test_all_16_activities_carry_overview` asserting all six overview fields are non-empty on every L2 row, including `SYS1-01` whose three labels carry a parenthetical suffix (FR-004)
- [x] T021 [P] [US1] Write `ivi-building/tests/test_graph_schema.py::test_dependency_summary_has_ten_entries` asserting 10 entries with kind distribution `critical_path` 1, `external_lead_time` 2, `hard_deadline` 1, `confluence` 2, `parallel` 2, `rework` 2, and that every `path_nodes` ID resolves (FR-005)
- [ ] T022 [P] [US1] Write `ivi-building/tests/test_graph_schema.py::test_artifact_satisfies_published_contract` validating the generated artifact against `contracts/process_graph.schema.json` with `jsonschema.Draft202012Validator`, reporting the first failure's JSON path — this is the schema-drift detector (FR-001–FR-020)
- [x] T023 [P] [US1] Write `ivi-building/tests/test_graph_schema.py::test_parent_and_phase_are_consistent` asserting L1 has `parent is None`, L2's parent is its phase, L3's parent is its activity, and activities 1–9 are `SYS1`/`PH1`–`PH2` while 10–16 are `SYS2`/`PH3` (FR-002)

### Implementation for User Story 1

- [x] T024 [US1] Implement `split_dod(raw)` in `ivi-building/lib/process_graph.py`: split on `①②③④` into `{index, clause}`; a single unnumbered sentence yields one clause at index 1; raise on zero clauses (FR-002, FR-017, FR-021)
- [x] T025 [P] [US1] Implement `parse_outputs(raw)` in `ivi-building/lib/process_graph.py` returning `[{name, shape}]`, where `shape` is the parenthetical column list or `None`; raise on zero outputs (FR-002, FR-021)
- [x] T026 [P] [US1] Implement `parse_examples(raw)` in `ivi-building/lib/process_graph.py` splitting on `①②③` and preserving each segment **verbatim** with no normalisation beyond stripping outer whitespace (FR-003)
- [x] T027 [P] [US1] Implement `parse_overview(text)` in `ivi-building/lib/process_graph.py` for the 16 Process Overview blocks, matching labels with a trailing parenthetical stripped so activity 1's three variant labels resolve (FR-004)
- [x] T028 [P] [US1] Implement `parse_f_ratings(text)` in `ivi-building/lib/process_graph.py` for the 16 `**F1–F9:**` lines, mapping the glyphs by **codepoint** per the table in `data-model.md` — `U+25CE`→primary, `U+25EF`→effective, `U+25B3`→auxiliary, `U+FF0D`→omitted. Use `U+25EF` LARGE CIRCLE, not `U+25CB` WHITE CIRCLE: the two look alike and a mismatch yields a silently empty `f_ratings` (FR-004)
- [x] T029 [P] [US1] Implement `parse_dependency_summary(text)` in `ivi-building/lib/process_graph.py` for the 10 blocks, retaining `path_raw` verbatim and resolving `path_nodes` to listed IDs only — not spans (FR-005)
- [x] T030 [US1] Implement `build_nodes(rows, overview, f_ratings)` in `ivi-building/lib/process_graph.py` assembling all transcribed fields plus `parent`/`phase`, carrying `aspice_bp` / `ai_applicability` / `rationale` as nullable, and attaching `f_ratings` and `overview` to L2 rows only (FR-002, FR-002a, FR-004)
- [x] T031 [US1] Implement `serialize(graph)` in `ivi-building/lib/process_graph.py`: `json.dumps(..., ensure_ascii=False, indent=2)` plus a trailing newline, encoded UTF-8, node order = document order (FR-027)
- [x] T032 [US1] Implement `write_atomic(path, data)` in `ivi-building/lib/process_graph.py` writing bytes to a temp file in the same directory then `os.replace`, with `newline` never translated (FR-029)
- [x] T033 [US1] Implement `main(argv)` in `ivi-building/lib/process_graph.py` per `contracts/cli.md`: `--out-dir`, `--check`, `--quiet`, exit codes 0/1/2, default output `ivi-building/graph/`
- [x] T034 [US1] Create `ivi-building/lib/graph_query.py` with `load(path=None)` and `Graph.node(id)` / `.by_level(level)` / `.nodes`, resolving the default path from the module's own location
- [x] T035 [US1] Run `python ivi-building/lib/process_graph.py` for the first time, then `python -m pytest ivi-building/tests/test_graph_schema.py -v`; fix until green. Record the produced counts in the Measured Results table of `specs/020-ivi-h0-process-graph/tasks.md`

**Checkpoint**: US1 is independently valuable — a correct, contract-validated graph of all 255 rows.

---

## Phase 4: User Story 2 — Prove the extraction is faithful, not merely plausible (Priority: P1)

**Goal**: dependencies resolve, the graph orders, and the source's own stated critical path is a real
connected route.

**Independent Test**: assert each consecutive critical-path pair is connected by a directed route, and
that the dependency network sorts.

### Tests for User Story 2

- [x] T036 [P] [US2] Write `ivi-building/tests/test_graph_edges.py::test_every_edge_endpoint_resolves` asserting **0** unresolved `from`/`to` across all edges (FR-009, SC-003)
- [x] T037 [P] [US2] Write `ivi-building/tests/test_graph_edges.py::test_exactly_one_revisit_edge` asserting exactly 1 edge has `kind == "revisit"` and it is `SYS1-05-f → SYS1-04-e` (FR-011, SC-006)
- [x] T038 [P] [US2] Write `ivi-building/tests/test_graph_edges.py::test_forward_graph_topologically_sorts` asserting `topo_order()` places all **255** nodes, and — as the regression guard — that including the revisit edge places only **71**, proving the exclusion is load-bearing rather than cosmetic (FR-012, SC-005)
- [x] T039 [P] [US2] Write `ivi-building/tests/test_graph_thread.py::test_stated_critical_path_is_reachable` asserting all **11** consecutive hops are reachable, with a docstring stating that reachability — not adjacency — is the correct assertion because **0 of 11** hops are adjacent edges (FR-012, SC-004)
- [x] T040 [P] [US2] Write `ivi-building/tests/test_graph_thread.py::test_no_critical_path_hop_is_adjacent` asserting the measured 0-of-11, so the reason for T039's shape is itself pinned by a test rather than only by a comment (SC-004)
- [x] T041 [P] [US2] Write `ivi-building/tests/test_graph_edges.py::test_declared_by_is_recorded` asserting every edge's `declared_by` ∈ {`successor`, `predecessor`, `both`} and that at least one of each value exists (FR-010)

### Implementation for User Story 2

- [x] T042 [US2] Implement `build_edges(rows)` in `ivi-building/lib/process_graph.py`: resolve both lists per row, union the directed pairs, set `declared_by`, set `kind = "revisit"` only where the source annotates `(revisit)`, and carry `raw` (FR-009, FR-010, FR-011)
- [x] T043 [US2] Add `successors` / `predecessors` / `reachable_from` / `ancestors_of` / `topo_order(kind="forward")` to `ivi-building/lib/graph_query.py`, with `topo_order` raising a named error listing unplaceable nodes on a remaining cycle (FR-012)
- [x] T044 [US2] Add the hard-failure check for a remaining forward-edge cycle to `build_graph` in `ivi-building/lib/process_graph.py`, exiting 2 with the offending node list (FR-021)
- [x] T045 [US2] Run `python -m pytest ivi-building/tests/test_graph_edges.py ivi-building/tests/test_graph_thread.py -v` and fix until green; record the reachability and topological-sort numbers in the Measured Results table of `specs/020-ivi-h0-process-graph/tasks.md`

**Checkpoint**: the parse is validated against an independent claim the source document makes. This is the milestone's primary extraction test.

---

## Phase 5: User Story 3 — Report what the source document gets wrong, without repairing it (Priority: P2)

**Goal**: the 215 one-directional dependencies counted and listed as observations, extraction still
succeeding.

**Independent Test**: run the extraction, confirm one finding per one-directional dependency plus a total,
and that the extraction succeeds.

### Tests for User Story 3

- [ ] T046 [P] [US3] Write `ivi-building/tests/test_graph_edges.py::test_edge_asymmetry_count_is_217` asserting exactly **215** findings of kind `edge_asymmetry` and that `meta.counts.findings` includes them (FR-022, SC-007)
- [ ] T047 [P] [US3] Write `ivi-building/tests/test_graph_edges.py::test_asymmetric_dependencies_are_still_usable` asserting a known one-directional dependency (`SYS1-01-b → SYS1-02-a`) is present as a usable edge — recorded, not discarded (FR-009, FR-024)
- [ ] T048 [P] [US3] Write `ivi-building/tests/test_graph_edges.py::test_findings_quote_real_source_text` asserting every finding's `raw` is a non-empty substring of the corresponding source document, and that `node`/`related` name real rows (FR-023)
- [ ] T049 [P] [US3] Write `ivi-building/tests/test_graph_edges.py::test_no_error_severity_on_success` asserting a successful extraction emits only `info` and `warning`, never `error`, and that `prose_target` and `revisit_edge` are `warning` while `edge_asymmetry` and `cross_level_edge` are `info` (FR-022, FR-023)
- [ ] T050 [P] [US3] Write `ivi-building/tests/test_graph_edges.py::test_cross_level_and_prose_findings_exist` asserting `SYS1-04-t → SYS2-10` produces a `cross_level_edge` finding and that `PH3`'s prose successor produces a `prose_target` finding with no corresponding edge (FR-008, FR-022)

### Implementation for User Story 3

- [ ] T051 [US3] Implement the finding record and `add_finding` helper in `ivi-building/lib/process_graph.py` with `{kind, severity, node, related, message, raw}` and the severity assignment of `data-model.md` (FR-023)
- [ ] T052 [US3] Emit `edge_asymmetry` findings from `build_edges` in `ivi-building/lib/process_graph.py` for every edge whose `declared_by != "both"`, without altering the edge itself (FR-022, FR-024)
- [ ] T053 [P] [US3] Emit `cross_level_edge` findings where an edge's endpoints differ in level, and `prose_target` findings for each `external_refs` entry, in `ivi-building/lib/process_graph.py` (FR-022)
- [ ] T054 [P] [US3] Emit the `revisit_edge` finding at `warning` severity for the single annotated back edge, in `ivi-building/lib/process_graph.py` (FR-022)
- [ ] T055 [US3] Sort findings by `(kind, node, message)` in `build_graph` and add `findings(kind=None)` to `ivi-building/lib/graph_query.py` (FR-027)
- [ ] T056 [US3] Run `python -m pytest ivi-building/tests/test_graph_edges.py -v` and fix until green. **Record the measured asymmetry count in the Measured Results table of `specs/020-ivi-h0-process-graph/tasks.md`** — this is a number the final report may quote

**Checkpoint**: source-document defects are measured and published, and nothing was repaired.

---

## Phase 6: User Story 4 — Know which steps this project will actually walk (Priority: P2)

**Goal**: two independent memberships per work item, with the excluded list visible.

**Independent Test**: confirm both memberships are reported with distinct counts matching a hand-check of
the excluded activities.

### Tests for User Story 4

- [ ] T057 [P] [US4] Write `ivi-building/tests/test_graph_thread.py::test_goal_relevant_count_is_234` asserting exactly **234** of 236 work items are `goal_relevant`, and that the 2 exclusions are `SYS2-16-o` and `SYS2-16-p` (FR-018, SC-009)
- [ ] T058 [P] [US4] Write `ivi-building/tests/test_graph_thread.py::test_on_thread_count_is_210` asserting exactly **210** work items are `on_thread` and that `on_thread` ⊆ `goal_relevant` (FR-018, SC-009)
- [ ] T059 [P] [US4] Write `ivi-building/tests/test_graph_thread.py::test_off_thread_is_26_and_names_its_activities` asserting the off-thread list is exactly `SYS2-13-a`…`-l` (12), `SYS2-15-a`…`-l` (12), `SYS2-16-o`, `SYS2-16-p` (FR-018, SC-009)
- [ ] T060 [P] [US4] Write `ivi-building/tests/test_graph_thread.py::test_critical_path_and_chosen_activities_are_on_thread` asserting all 12 critical-path nodes plus `SYS2-11` and `SYS2-14` are in `on_thread`, which exercises the containment rule since parent/child is not an edge (FR-020, SC-010)
- [ ] T061 [P] [US4] Write `ivi-building/tests/test_graph_thread.py::test_terminals_and_activities_are_recorded` asserting `thread.terminals` is the 3 declared terminals and `thread.activities` is the 14 declared activities excluding `SYS2-13` and `SYS2-15` (FR-019)
- [ ] T062 [P] [US4] Write `ivi-building/tests/test_graph_derived.py::test_requires_human_is_19` asserting exactly **19** rows require a human stop, that all 5 `fixed`+`decision_meeting` rows are included, and that **`SYS1-02-r` is excluded** because its qualifier says "not yet approved" (FR-014, SC-008)
- [ ] T063 [P] [US4] Write `ivi-building/tests/test_graph_derived.py::test_granularity_splits_on_both_separators` asserting all 255 rows parse into a level and a qualifier across both the em-dash and colon forms, and that the `human_gate_kind` distribution is exactly `decision_meeting` 13, `record` 12, `department_agreement` 14, `owner_approval` 8, `review_confirm` 48, `none` 160 (FR-013)
- [ ] T064 [P] [US4] Write `ivi-building/tests/test_graph_derived.py::test_record_kind_is_not_a_human_stop` asserting all 12 `fixed`+`record` rows have `requires_human is False`, quoting the Legend's "or settled as a fact / record" in the docstring (FR-014)
- [ ] T065 [P] [US4] Write `ivi-building/tests/test_graph_derived.py::test_dependency_summary_flags` asserting exactly **12** `critical_path`, **8** `external_lead_time`, **5** `hard_deadline` rows, and that each flag's rows equal the corresponding entry's `path_nodes` — proving the flags are resolved from the summary, not hardcoded (FR-015, SC-011)
- [ ] T066 [P] [US4] Write `ivi-building/tests/test_graph_derived.py::test_exactly_one_conditional_skip` asserting exactly **1** row has a non-null `conditional_skip` and it is `SYS1-01-e`, with its `raw` quoting the source's "if none exist, skip this work item" (FR-016, SC-011)

### Implementation for User Story 4

- [ ] T067 [US4] Implement `classify_granularity(raw)` in `ivi-building/lib/process_graph.py` returning `(level, owner, gate_kind)`, splitting on em dash or colon, with the six gate kinds matched in the precedence order of `data-model.md` — **`record` before the approval kinds** — and raising on an unparseable cell (FR-013, FR-021)
- [ ] T068 [US4] Implement `requires_human` in `derive_flags` as `level == "fixed"` ∧ `gate_kind` ∈ {`decision_meeting`, `department_agreement`} in `ivi-building/lib/process_graph.py` (FR-014)
- [ ] T069 [P] [US4] Implement `critical_path` / `external_lead_time` / `hard_deadline` in `derive_flags` in `ivi-building/lib/process_graph.py` by membership in the corresponding `dependency_summary` entry's `path_nodes` (FR-015)
- [ ] T070 [P] [US4] Implement `conditional_skip` detection in `derive_flags` in `ivi-building/lib/process_graph.py` from skip-prescribing language in the entry condition, capturing `{raw, condition}` (FR-016)
- [ ] T071 [US4] Implement `compute_thread(edges, nodes)` in `ivi-building/lib/process_graph.py`: `goal_relevant` by ancestry from the 3 terminals over forward edges; `on_thread` as that intersected with the 14 declared activities; containment adding each on-thread item's parent activity and phase; `off_thread` as the L3 complement, all lists sorted (FR-018, FR-019, FR-020)
- [ ] T072 [US4] Add `thread` to `ivi-building/lib/graph_query.py` as a property returning the artifact's thread block
- [ ] T073 [US4] Run `python -m pytest ivi-building/tests/test_graph_thread.py ivi-building/tests/test_graph_derived.py -v` and fix until green. **Record the measured membership and human-stop numbers in the Measured Results table of `specs/020-ivi-h0-process-graph/tasks.md`**

**Checkpoint**: what this project will and will not walk is data, with both claims sized honestly.

---

## Phase 7: User Story 5 — Re-run safely when a source document is revised (Priority: P3)

**Goal**: byte-identical re-extraction, a no-op on an unchanged source, and a reviewable delta on a
revision.

**Independent Test**: extract twice into separate temporary directories and compare bytes; compare the
committed artifact against a fresh extraction.

### Tests for User Story 5

- [ ] T074 [P] [US5] Write `ivi-building/tests/test_graph_determinism.py::test_two_extractions_are_byte_identical` running the extractor twice with `--out-dir` into two temp directories and asserting **0** differing bytes in both generated files (FR-027, SC-012, SC-014)
- [ ] T075 [P] [US5] Write `ivi-building/tests/test_graph_determinism.py::test_committed_output_equals_fresh_extraction` asserting the committed `graph/process_graph.json` and `graph/extraction_report.md` equal a fresh extraction — which is also the hand-edit detector (FR-027, FR-031, SC-012)
- [ ] T076 [P] [US5] Write `ivi-building/tests/test_graph_determinism.py::test_artifact_contains_no_varying_value` asserting no timestamp-shaped string, no absolute path, no drive letter and no interpreter version appears anywhere in either generated file (FR-027)
- [ ] T077 [P] [US5] Write `ivi-building/tests/test_graph_determinism.py::test_source_paths_are_repository_relative` asserting each `meta.sources[].path` starts with `others/` and contains no drive letter or backslash (FR-028)
- [ ] T078 [P] [US5] Write `ivi-building/tests/test_graph_determinism.py::test_check_mode_exit_codes` asserting `--check` exits `0` when committed output matches, and `1` after a deliberate one-byte edit to a copy (FR-027, FR-030)
- [ ] T079 [P] [US5] Write `ivi-building/tests/test_graph_determinism.py::test_failed_extraction_leaves_output_untouched` asserting that when parsing raises, no temp file survives and a pre-existing output file is byte-unchanged (FR-029)
- [ ] T080 [P] [US5] Write `ivi-building/tests/test_graph_determinism.py::test_report_contains_every_headline_number` asserting the report contains the row counts, both edge counts, each finding kind with its total, both memberships, the off-thread count and the human-stop count — SC-013's checkable form (FR-025, SC-013)
- [ ] T081 [P] [US5] Write `ivi-building/tests/test_graph_determinism.py::test_line_endings_are_lf_only` asserting neither generated file contains `\r` (FR-027)

### Implementation for User Story 5

- [ ] T082 [US5] Implement `render_report(graph)` in `ivi-building/lib/process_graph.py` producing the deterministic Markdown of `data-model.md` — source identities, row counts, edge counts by kind, findings grouped by kind with totals, both memberships with the off-thread list, human-stop count with node IDs, derived-flag counts — rendered from the finished graph only, with no timestamp (FR-025, FR-026)
- [ ] T083 [US5] Add `meta` assembly to `build_graph` in `ivi-building/lib/process_graph.py`: `schema_version` `"1.0"`, `extractor_version`, `sources[{path, sha256}]` with repository-relative forward-slash paths, and `counts` (FR-028)
- [ ] T084 [US5] Implement `--check` in `main` in `ivi-building/lib/process_graph.py` per `contracts/cli.md`: re-extract in memory, compare to committed bytes, report drift, write nothing, exit 0 or 1 (FR-027)
- [ ] T085 [US5] Implement the revision summary in `main` in `ivi-building/lib/process_graph.py`: when committed output exists and differs, print the count deltas, the findings deltas and any newly unrecognised notation before replacing (FR-030)
- [ ] T086 [US5] Ensure every list in the artifact whose natural order is not the document's is sorted explicitly — edges by `(from, to, kind)`, findings by `(kind, node, message)`, thread lists, `dependency_summary[].path_nodes` — in `ivi-building/lib/process_graph.py` (FR-027)
- [ ] T087 [US5] Run `python -m pytest ivi-building/tests/test_graph_determinism.py -v` and fix until green; record the byte-diff result in the Measured Results table of `specs/020-ivi-h0-process-graph/tasks.md`

**Checkpoint**: the artifact is maintainable rather than a one-off transcription.

---

## Phase 8: The skill, and closing the boundary

**Purpose**: the human entry point, plus the checks that H0 stayed inside its scope.

- [ ] T088 Create `ivi-building/.claude/skills/ivi-graph-build/SKILL.md` with frontmatter `name: ivi-graph-build` and a description naming when to use it; body: confirm the two source paths, run the extractor, report counts and findings by kind and both memberships, present the delta on a revision, hand the diff to the human. It MUST state that it holds no orchestration or parsing logic, that neither generated file is ever hand-edited, and that an extraction failure is escalated rather than worked around
- [ ] T089 [P] Add to `ivi-building/.claude/skills/ivi-graph-build/SKILL.md` the triage guidance for findings: `edge_asymmetry` and `cross_level_edge` are observations to note, `prose_target` and `revisit_edge` warrant a look, and a hard failure on an unrecognised notation means either extending the resolver with a test or recording a source-document defect — never widening the resolver to swallow it
- [ ] T090 [P] Write `ivi-building/tests/test_graph_schema.py::test_no_simulator_paths_are_referenced` asserting no file under `ivi-building/lib/`, `ivi-building/tests/` or the skill references `app/`, `htmlapp/`, `packages/`, `scenarios/`, `docs/master/` or `combined_contracts/` (FR-033, SC-015)
- [ ] T091 [P] Write `ivi-building/tests/test_graph_schema.py::test_h0_delivers_no_out_of_scope_component` asserting `ivi-building/` contains no agent file, no `pack.json`, no `hooks/firewall.py`, no run workspace and no template — H0's scope boundary as a test (FR-032)
- [ ] T092 Verify `ivi-building/lib/` contains no `__init__.py`, confirming the flat one-module-per-milestone convention (plan.md structure decision)

---

## Phase 9: Polish & verification close-out

- [ ] T093 Run the full gate `python -m pytest ivi-building/tests/ -v` and record the pass/fail counts verbatim
- [ ] T094 Run the milestone demonstration from `cd ivi-building` exactly as `specs/020-ivi-h0-process-graph/quickstart.md` states — `python lib/process_graph.py`, `python -m pytest tests/ -v`, re-extract, then `git diff --stat graph/` showing no output — and capture the transcript
- [ ] T095 [P] Confirm `git status` shows **0** modified files under `app/`, `htmlapp/`, `packages/`, `scenarios/`, `docs/master/`, `combined_contracts/` (SC-015)
- [ ] T096 [P] Fill in the Measured Results table in `specs/020-ivi-h0-process-graph/tasks.md` from the actual run, and reconcile any number that differs from `specs/020-ivi-h0-process-graph/research.md` or `docs/superpowers/specs/2026-09-02-ivi-h0-design.md` — the shipped extractor is correct and the document is stale
- [ ] T097 [P] Update `ivi-building/README.md` and `ivi-building/CLAUDE.md` if any delivered name or path differs from what they state
- [ ] T098 Re-read `docs/superpowers/specs/2026-09-02-ivi-h0-design.md` and `ivi-building/docs/ivi_process_harness_milestones.md` §2 against what was actually built, and correct either the documents or the code so no drift remains

---

## Measured Results

Filled in by T035, T056, T073 and T096 from the actual run. Expected values come from the pre-spec
measurement pass recorded in `research.md`; a mismatch is a finding, not something to paper over.

| Measurement | Expected | Actual | Task |
|---|---|---|---|
| L1 / L2 / L3 / total rows | 3 / 16 / 236 / 255 | 3 / 16 / 236 / 255 | T035 |
| unresolved dependency references | 0 | | T013 |
| `edge_asymmetry` findings | 215 | | T056 |
| `revisit` edges | 1 | 1 | T045 |
| forward-edge topological sort | 255 of 255 | 255 of 255 | T045 |
| topological sort including revisit | 71 of 255 | 71 of 255 (184 unplaceable) | T045 |
| critical-path hops reachable | 11 of 11 | 11 of 11 | T045 |
| critical-path hops adjacent | 0 of 11 | 0 of 11 | T045 |
| `goal_relevant` work items | 234 | | T073 |
| `on_thread` work items | 210 | | T073 |
| off-thread work items | 26 | | T073 |
| `requires_human` rows | 19 | | T073 |
| `critical_path` / `external_lead_time` / `hard_deadline` rows | 12 / 8 / 5 | | T073 |
| `conditional_skip` rows | 1 | | T073 |
| byte diff across two extractions | 0 | | T087 |
| simulator files modified | 0 | | T095 |

---

## Requirement Coverage

Every FR and SC maps to at least one implementation task and one verification task.

| Requirement | Implementation | Verification |
|---|---|---|
| FR-001 | T011 | T007, T022 |
| FR-002 | T011, T024, T025, T026, T030 | T014, T015, T018, T023 |
| FR-002a | T011 | T009a, T018a |
| FR-003 | T026 | T016 |
| FR-004 | T027, T028, T030 | T019, T020 |
| FR-005 | T029 | T021 |
| FR-006 | T010 | T006 |
| FR-007 | T012 | T008 |
| FR-008 | T012, T053 | T008, T009, T050 |
| FR-009 | T042 | T036, T047 |
| FR-010 | T042 | T041 |
| FR-011 | T042 | T037 |
| FR-012 | T043 | T038, T039 |
| FR-013 | T067 | T063 |
| FR-014 | T068 | T062, T064 |
| FR-015 | T069 | T065 |
| FR-016 | T070 | T066 |
| FR-017 | T024 | T017 |
| FR-018 | T071 | T057, T058, T059 |
| FR-019 | T071 | T061 |
| FR-020 | T071 | T060 |
| FR-021 | T012, T024, T025, T044 | T009, T038, T079 |
| FR-022 | T052, T053, T054 | T046, T049, T050 |
| FR-023 | T051 | T048, T049 |
| FR-024 | T052 | T047 |
| FR-025 | T082 | T080 |
| FR-026 | T082 | T075, T080 |
| FR-027 | T031, T055, T084, T086 | T074, T075, T076, T081 |
| FR-028 | T010, T083 | T077 |
| FR-029 | T032 | T079 |
| FR-030 | T085 | T078 |
| FR-031 | T088 | T075 |
| FR-032 | T088 | T091 |
| FR-033 | — (boundary) | T090, T095 |
| SC-001 | T011, T030 | T007 |
| SC-002 | T024, T025 | T014 |
| SC-003 | T042 | T036 |
| SC-004 | T043 | T039, T040 |
| SC-005 | T042, T043 | T038 |
| SC-006 | T042 | T037 |
| SC-007 | T052 | T046, T056 |
| SC-008 | T068 | T062, T073 |
| SC-009 | T071 | T057, T058, T059, T073 |
| SC-010 | T071 | T060 |
| SC-011 | T069, T070 | T065, T066 |
| SC-012 | T031, T086 | T074, T075 |
| SC-013 | T082 | T080 |
| SC-014 | T082, T086 | T074 |
| SC-015 | — (boundary) | T090, T095 |

**The five measured criteria produce their numbers rather than asserting a mechanism.** SC-007 (215),
SC-008 (19), SC-009 (234/210/26), SC-011 (12/8/5 and 1) and SC-012 (0 bytes) are each written into
`graph/extraction_report.md` by T082, asserted against exact values by their verification tasks, and
transcribed into the Measured Results table by T035/T056/T073/T096.

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 Setup** — no dependencies
- **Phase 2 Foundational** — depends on Phase 1; **blocks every user story**
- **Phase 3 US1** — depends on Phase 2
- **Phase 4 US2** — depends on Phase 3 (edges are built over parsed rows)
- **Phase 5 US3** — depends on Phase 4 (findings are emitted during edge construction)
- **Phase 6 US4** — depends on Phase 4 (thread membership traverses forward edges)
- **Phase 7 US5** — depends on Phases 3–6 (the report renders the finished graph)
- **Phase 8 skill and boundary** — depends on Phase 7 (the skill documents the finished command)
- **Phase 9 close-out** — depends on everything

### Story dependencies — honest about the coupling

Unlike a typical feature, these stories are **not** independently deliverable, because they are layers of
one artifact rather than separate slices:

- **US1** stands alone: a correct graph is useful by itself. This is the MVP.
- **US2** needs US1's parsed rows to build dependencies from.
- **US3** and **US4** both need US2's edges; they are independent of each other and can proceed in parallel.
- **US5** needs the finished graph, since the report renders it.

Each story remains independently *testable* — its own test file section passes or fails on its own — which
is what the checkpoints verify.

### Parallel opportunities

- T004 alongside T002–T003 (different concerns in the same file — sequence if editing concurrently)
- T006–T009 all in parallel: four independent test functions across two files
- T014–T023: ten independent test functions, all parallel
- T025–T029: five independent parser functions, all parallel
- T036–T041, T046–T050, T057–T066, T074–T081: every test block is fully parallel
- **Phase 5 and Phase 6 in parallel** once Phase 4 is green — findings and thread membership do not touch each other
- T089–T092 parallel; T095–T097 parallel

## Parallel Example: Phase 3 tests

```bash
# All ten US1 test functions can be written together — independent functions, two files:
Task: "test_every_l3_has_dod_output_and_entry in ivi-building/tests/test_graph_schema.py"
Task: "test_dod_clause_counts in ivi-building/tests/test_graph_schema.py"
Task: "test_examples_are_verbatim in ivi-building/tests/test_graph_schema.py"
Task: "test_exit_dod_has_no_per_clause_human_flag in ivi-building/tests/test_graph_schema.py"
Task: "test_optional_fields_may_be_absent in ivi-building/tests/test_graph_schema.py"
Task: "test_all_16_activities_carry_f_ratings in ivi-building/tests/test_graph_schema.py"
Task: "test_all_16_activities_carry_overview in ivi-building/tests/test_graph_schema.py"
Task: "test_dependency_summary_has_ten_entries in ivi-building/tests/test_graph_schema.py"
Task: "test_artifact_satisfies_published_contract in ivi-building/tests/test_graph_schema.py"
Task: "test_parent_and_phase_are_consistent in ivi-building/tests/test_graph_schema.py"
```

---

## Implementation Strategy

### MVP first (US1 only)

1. Phase 1 Setup → the suite fails for the intended reason
2. Phase 2 Foundational → rows and dependency cells parse
3. Phase 3 US1 → a contract-validated graph of all 255 rows exists
4. **STOP and VALIDATE**: `python -m pytest ivi-building/tests/test_graph_schema.py -v`
5. This alone is useful: a machine-readable process breakdown nobody has to re-read from prose

### Incremental delivery

1. Setup + Foundational → parsers ready
2. US1 → the graph exists and satisfies its published contract
3. US2 → the parse is validated against the document's independent claim
4. US3 + US4 in parallel → source defects measured; thread membership sized
5. US5 → re-runnable and byte-identical
6. Phase 8 → the human entry point and the scope boundary as tests
7. Phase 9 → measured numbers recorded, documents reconciled

### TDD discipline

Every implementation task has its test written first, and the test is run and seen to fail for the
intended reason before implementation begins. This is genuine here because every component is
deterministic code — there is no prompt text in H0 whose behaviour would have to be verified by fixture
run instead.

---

## Notes

- `[P]` = different files or independent functions, no dependency on an incomplete task
- Commit at each checkpoint, not at each task
- **Never weaken a test to make a task pass.** If a measured number differs from the expected value, the
  extractor is correct and the expectation is stale — record the discrepancy in Measured Results and fix
  the document, per T096
- **Never downgrade a hard failure to a finding.** The distinction is the milestone's safety property: an
  unrecognised dependency notation must reach the human, not be dropped
- Every subagent dispatched while executing these tasks passes `model: "opus"`, and overrides nothing else
