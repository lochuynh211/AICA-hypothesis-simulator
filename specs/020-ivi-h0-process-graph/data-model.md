# Phase 1 Data Model: IVI Harness H0

**Feature**: `specs/020-ivi-h0-process-graph` · **Date**: 2026-09-02

The machine-checkable form of this model is
[`contracts/process_graph.schema.json`](./contracts/process_graph.schema.json). This document explains
the fields, the derivation rules, and the validation each one carries.

Terminology, per the spec's Terminology section: the spec says **process row** and **dependency**; the
design and this model say **node** and **edge**. Same things, different audiences.

---

## Top-level artifact

`ivi-building/graph/process_graph.json`

| Key | Type | Notes |
|---|---|---|
| `meta` | object | provenance and counts; **no timestamp** |
| `nodes` | array[255] | source-document order |
| `edges` | array | sorted by `(from, to, kind)` |
| `dependency_summary` | array[10] | the source's Dependency Summary sheet |
| `thread` | object | terminals, declared activities, and the two memberships |
| `findings` | array | sorted by `(kind, node, message)` |

### `meta`

| Field | Type | Rule |
|---|---|---|
| `schema_version` | string | `"1.0"` for H0 |
| `extractor_version` | string | bumped when parsing behaviour changes; a bump is expected to change output |
| `sources` | array[2] | `{path, sha256}`; `path` is **repository-relative** — an absolute path would break byte-identity across machines |
| `counts` | object | `{L1, L2, L3, total, edges_forward, edges_revisit, findings}` |

**Validation**: `counts.L1 == 3`, `counts.L2 == 16`, `counts.L3 == 236`, `counts.total == 255`.
`counts.edges_revisit == 1`. No key anywhere in `meta` may vary between two runs on identical input.

---

## Entity: node (process row)

One of the 255 rows. Three levels, distinguished by `level`.

### Transcribed fields — all levels

| Field | Type | Source column | Rule |
|---|---|---|---|
| `id` | string | Step ID | `PH1`\|`PH2`\|`PH3`, or `SYS[12]-NN`, or `SYS[12]-NN-x` |
| `level` | enum | Process hierarchy | `L1` \| `L2` \| `L3` |
| `parent` | string \| null | derived from `id` | `null` for L1; phase for L2; activity for L3 |
| `phase` | enum | derived from `id` | `PH1` \| `PH2` \| `PH3`; activities 1–9 are `SYS1`, 10–16 are `SYS2` |
| `name` | string | Activity name | from the heading, non-empty |
| `purpose` | string | Purpose | non-empty |
| `work_content` | string | Work content | non-empty |
| `inputs` | array[string] | Input deliverables | split on the document's own separators |
| `input_sources` | array[string] | Input source | split on ` / ` |
| `outputs` | array[object] | Output deliverables | `{name, shape}`; ≥1 required; `shape` is the parenthetical column list, else `null` |
| `entry` | string | Entry condition | **non-empty required** |
| `exit_dod` | array[object] | Exit (DoD) | `{index, clause}`; ≥1 required |
| `examples` | array[string] | Concrete examples | **verbatim**, split on `①②③`; never paraphrased |
| `aspice_bp` | string \| null | Corresponding ASPICE BP | present on 135 rows; absence is not an error |
| `ai_applicability` | string \| null | AI applicability | present on 7 rows, taking **two values — `◯` on 6 and `★` on 1**; preserved as written, never normalised |
| `rationale` | string \| null | Rationale | present on **exactly one row, `SYS1-08-c`** — the only row in the document with an eleventh labelled bullet; transcribed rather than dropped |
| `predecessors_raw` | string | Predecessor / Successor | the verbatim cell, retained for audit |
| `external_refs` | array[string] | — | prose dependency targets naming nothing in this process |

`exit_dod` carries **`{index, clause}` only**. A per-clause human-signoff flag is *not derivable* — the
source states no per-clause signoff — so it is absent, and per-clause verification routing is assigned by
H2's verifier. This is a deliberate correction to the parent design §3.2's example.

**Every labelled bullet is accounted for, and an unknown label is a hard failure.** Ten labels appear on
all 255 rows; three more are optional (`aspice_bp` 135, `ai_applicability` 7, `rationale` 1). A label the
parser does not recognise stops the extraction naming the row and the label, because an unaccounted bullet
means source content would be discarded silently — the one failure mode this feature exists to prevent.
`SYS1-08-c` is the reason this rule is explicit: it carries a `Rationale` bullet no other row has.

### Derived fields — all levels

| Field | Type | Derivation |
|---|---|---|
| `granularity_level` | enum | `rough` \| `draft` \| `fixed`, from the leading word of the granularity cell |
| `granularity_owner` | string | the qualifier after the separator, **verbatim**; separator is `—` or `:` |
| `human_gate_kind` | enum | classified from `granularity_owner` — see the table below |
| `requires_human` | bool | `granularity_level == "fixed"` ∧ `human_gate_kind` ∈ {`decision_meeting`, `department_agreement`} |
| `critical_path` | bool | `id` appears in the `critical_path` dependency-summary entry |
| `external_lead_time` | bool | `id` appears in either `external_lead_time` entry |
| `hard_deadline` | bool | `id` appears in the `hard_deadline` entry |
| `conditional_skip` | object \| null | `{raw, condition}` when the entry condition prescribes skipping |
| `goal_relevant` | bool | ancestor of a terminal node over `forward` edges, or a terminal itself |
| `on_thread` | bool | `goal_relevant` ∧ (`parent` ∈ `thread.activities`), plus containment for L1/L2 |

#### `human_gate_kind` classification, in precedence order

Precedence matters: the qualifier text can contain more than one signal, and the first match wins.

| Order | Kind | Matches when the qualifier says | Count |
|---|---|---|---|
| 1 | `decision_meeting` | decision-making meeting | 13 |
| 2 | `record` | settled as… / fixed as… | 12 |
| 3 | `department_agreement` | agreed (with a department) | 14 |
| 4 | `owner_approval` | approved | 8 |
| 5 | `review_confirm` | confirmed / reviewed | 48 |
| 6 | `none` | nothing of the above | 160 |

`record` is checked **before** the approval kinds, so "Fixed version — settled as the analysis result"
classifies as a record rather than being caught by a later approval pattern.

**Validation**: exactly **19** nodes have `requires_human == true`; all 5 `fixed` + `decision_meeting`
nodes are among them; `SYS1-02-r` — whose qualifier reads "not yet approved by the decision-making
meeting" — is **not**. Exactly **1** node has a non-null `conditional_skip`, and it is `SYS1-01-e`.
Exactly **12** nodes have `critical_path == true`, **8** `external_lead_time`, **5** `hard_deadline`.

### Additional fields — L2 nodes only

| Field | Type | Source |
|---|---|---|
| `f_ratings` | object | Application Map's 16 `**F1–F9:**` lines → `{primary[], effective[], auxiliary[]}` |
| `overview` | object | Process Overview block → `{outline, main_outputs, owner, departments, completion_criterion, common_pitfall}` |

Label matching for `overview` strips a trailing parenthetical, because three labels carry one on activity
1 only (`Outline (what this step does)`, `Owner (executing party)`, `Completion criterion (condition to
move on)`).

#### Rating glyphs — exact codepoints, verified against the source

These are easy to get wrong by eye and a mismatch yields a silently empty `f_ratings`, so they are pinned
here rather than left to the implementer to guess:

| Glyph | Codepoint | Unicode name | Maps to |
|---|---|---|---|
| ◎ | `U+25CE` | BULLSEYE | `primary` |
| ◯ | `U+25EF` | LARGE CIRCLE | `effective` |
| △ | `U+25B3` | WHITE UP-POINTING TRIANGLE | `auxiliary` |
| － | `U+FF0D` | FULLWIDTH HYPHEN-MINUS | omitted |

Note **`U+25EF` LARGE CIRCLE, not `U+25CB` WHITE CIRCLE** — the two are visually near-identical. The same
`U+25EF` is the `◯` value of `ai_applicability`. The rating line's separator is `·` and its heading dash is
`U+2013` EN DASH (`**F1–F9:**`), not a hyphen.

**Validation**: all 16 L2 nodes carry both objects; every `f_ratings` list holds only `F1`…`F9`; no F
number appears in two of the three lists for one activity.

---

## Entity: edge (dependency)

| Field | Type | Rule |
|---|---|---|
| `from` | string | must resolve to an existing node |
| `to` | string | must resolve to an existing node |
| `kind` | enum | `forward` \| `revisit` |
| `declared_by` | enum | `successor` \| `predecessor` \| `both` |
| `raw` | string | the source cell text the edge came from |

**Construction.** For each node, both the predecessor list and the successor list are resolved and
normalised into directed pairs; the two sets are **unioned**. `declared_by` records which side declared
it. `kind` is `revisit` only when the source annotates the target with `(revisit)`.

Edges may cross hierarchy levels — an L3 row legitimately names an activity as its successor. These are
kept and emit an `info` finding.

**Validation**: every `from`/`to` resolves — 0 unresolved. Exactly **1** edge has `kind == "revisit"`, and
it is `SYS1-05-f → SYS1-04-e`. Topological sort over `forward` edges places all **255** nodes. Edges where
`declared_by != "both"` number **217**.

---

## Entity: dependency_summary entry

Ten entries from the source's Dependency Summary sheet.

| Field | Type | Rule |
|---|---|---|
| `kind` | enum | `critical_path` \| `external_lead_time` \| `hard_deadline` \| `confluence` \| `parallel` \| `rework` |
| `title` | string | the source's own heading |
| `content` | string | the "Content" row |
| `path_raw` | string | the "Path / target steps" row, **verbatim** |
| `path_nodes` | array[string] | IDs resolved from `path_raw`; each must resolve |
| `impact` | string | the "Impact if delayed" row |
| `mitigation` | string | the "What to get ahead of" row |

Expected distribution: `critical_path` 1, `external_lead_time` 2, `hard_deadline` 1, `confluence` 2,
`parallel` 2, `rework` 2 — total 10.

**Interpretation rule, recorded because it is a judgment call.** `path_nodes` holds only the IDs the
source actually lists. `SYS1-02-n → SYS1-02-p` yields two nodes, not the span `n, o, p`. So
`external_lead_time` covers 8 nodes; `SYS1-02-o` ("conduct the interviews") is plainly external work but
is not listed, so it is not flagged. `path_raw` is retained verbatim so H5 can widen the set without
re-extraction.

---

## Entity: thread

| Field | Type | Rule |
|---|---|---|
| `terminals` | array[3] | `["SYS2-11-n", "SYS2-14-l", "SYS2-16-n"]`, sorted |
| `activities` | array[14] | the declared activities to walk, sorted: `SYS1-01`…`SYS1-09`, `SYS2-10`, `SYS2-11`, `SYS2-12`, `SYS2-14`, `SYS2-16` |
| `goal_relevant` | array[string] | node IDs, sorted; **234** L3 |
| `on_thread` | array[string] | node IDs, sorted; **210** L3 |
| `off_thread` | array[string] | L3 nodes not on thread, sorted; **26** |

`on_thread` ⊆ `goal_relevant` for L3 nodes. The containment rule adds each on-thread work item's parent
activity and phase to `on_thread`, because parent/child is not an edge.

**Validation**: all 12 critical-path nodes ∈ `on_thread`; `SYS2-11` ∈ `on_thread`; `SYS2-14` ∈
`on_thread`; `off_thread` is exactly `SYS2-13-a`…`-l`, `SYS2-15-a`…`-l`, `SYS2-16-o`, `SYS2-16-p`.

---

## Entity: finding

| Field | Type | Rule |
|---|---|---|
| `kind` | enum | `edge_asymmetry` \| `cross_level_edge` \| `prose_target` \| `revisit_edge` |
| `severity` | enum | `info` \| `warning` |
| `node` | string | the node the observation is about |
| `related` | string \| null | the other node, where the finding concerns a pair |
| `message` | string | one sentence |
| `raw` | string | the quoted source text |

Severity assignment: `edge_asymmetry` and `cross_level_edge` are `info` — observations that change
nothing. `prose_target` and `revisit_edge` are `warning` — a reader should look at them. **A successful
extraction never emits `severity: "error"`**; the conditions that would warrant one instead stop the
extraction (FR-021).

**Findings are never repaired.** Repairing a one-directional dependency would assert a dependency the
source states only once, which is a claim about the process rather than about the parse.

**Validation**: `edge_asymmetry` count == 217; `revisit_edge` count == 1; every `raw` is a non-empty
substring of the corresponding source document.

---

## Generated report

`ivi-building/graph/extraction_report.md`, rendered from the finished graph only — so it cannot disagree
with it. Sections: source identities · row counts · edge counts by kind · findings grouped by kind with
totals · thread memberships with the off-thread list · human-stop count with the node IDs · derived-flag
counts. No timestamp.

**Validation**: every headline number of this milestone is obtainable from this file alone, without
opening the structured artifact and without opening either source document.

---

## State transitions

None. Both generated files are produced whole by a single extraction and are read-only thereafter. There
is no lifecycle, no mutation and no in-place update: a source revision re-derives everything, written
atomically. Artifact revision, granularity demotion and reopen lifecycles belong to run artifacts, which
arrive in H2 and H3 — not to the process graph.
