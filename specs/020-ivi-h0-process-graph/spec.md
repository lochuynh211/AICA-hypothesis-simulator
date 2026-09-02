# Feature Specification: IVI Harness H0 — Process Graph And Repo Scaffold

**Feature Branch**: `ivi-h0-process-graph`

**Created**: 2026-09-02

**Status**: Draft

**Input**: Milestone H0 of the IVI process agent harness. Approved design:
`docs/superpowers/specs/2026-09-02-ivi-h0-design.md`. Milestone plan:
`ivi-building/docs/ivi_process_harness_milestones.md` §2. Parent design:
`docs/superpowers/specs/2026-09-01-ivi-process-agent-harness-design.md`.

> **Project scope note.** This feature belongs to `ivi-building/`, the IVI process agent harness, which
> is governed by `ivi-building/CLAUDE.md`. The AICA simulator (`app/`, `htmlapp/`, `docs/master/`,
> `packages/`, `scenarios/`) is this project's *expected output* and is not touched by this feature.

## Clarifications

### Session 2026-09-02

- Q: Are the extraction's findings a durable human-readable deliverable, or session output only? → A:
  Both — findings stay structured inside the graph artifact, and a generated human-readable extraction
  report is committed beside it, covered by the same byte-identity guarantee.
- Q: Where does new output sit while a source revision is reviewed, and what happens to the committed
  artifact on a hard failure? → A: Written atomically in place — temp file moved on full success only, so
  a failure leaves the committed output untouched and no partial file can exist. The review surface is
  the git working tree; no staging path and no overwrite flag are introduced.

## User Scenarios & Testing *(mandatory)*

The user of this feature is a **planning engineer running the harness**, and — for one story — the
**report reader** who must be able to trust the harness's numbers without having watched it run.

### User Story 1 - Turn the process documents into a trustworthy graph (Priority: P1)

A planning engineer points the harness at the two source documents and gets back a single
machine-readable file describing all 255 rows of the documented process: 3 phases, 16 activities, 236
work items, with each work item's purpose, declared inputs and outputs, entry condition, exit
definition-of-done clauses, and its three worked examples. Nothing about the process has to be re-read
from prose again.

**Why this priority**: Every later milestone resolves "what is the next runnable step" from this file.
Without it there is no harness. It is also the only story that delivers value on its own — a correct
graph is useful to a human reading the process even if nothing else is ever built.

**Independent Test**: Run the extraction, then confirm the artifact contains exactly 255 rows with every
declared field populated, and that a work item picked at random matches its row in the source document
word for word.

**Acceptance Scenarios**:

1. **Given** the two source documents at their 2026-08-26 revision, **When** the engineer runs the
   extraction, **Then** the artifact holds exactly 3 phase rows, 16 activity rows and 236 work-item rows,
   totalling 255.
2. **Given** the extracted artifact, **When** any work item is inspected, **Then** it carries at least
   one definition-of-done clause, at least one declared output, and a non-empty entry condition.
3. **Given** a work item that the source document illustrates with three worked examples, **When** those
   examples are read from the artifact, **Then** they are identical to the source text, not summarised.
4. **Given** an activity row, **When** it is inspected, **Then** it carries the nine capability ratings
   the second source document assigns to that activity, and the activity's completion criterion and
   common pitfall.

---

### User Story 2 - Prove the extraction is faithful, not merely plausible (Priority: P1)

The engineer needs evidence that the extraction did not quietly mangle the process. The strongest
available evidence is that the source document's own separately-stated critical path — twelve steps from
the first activity's consolidation step to the final baseline step — turns out to be a real connected
route through the extracted dependencies. That claim is made in a different part of the document from
the rows the extraction reads, so agreement between them cannot be an artefact of the parse.

**Why this priority**: Equal to Story 1. A graph nobody can trust is worse than no graph, because later
milestones would build on it silently. This is the milestone's primary extraction test.

**Independent Test**: Assert that each consecutive pair on the stated critical path is connected by a
directed route through the extracted dependencies, and that the dependency network sorts into a
consistent order.

**Acceptance Scenarios**:

1. **Given** the extracted dependencies, **When** the stated twelve-step critical path is traced,
   **Then** every consecutive pair is connected by a directed route.
2. **Given** the extracted dependencies excluding the one route the source document itself marks as a
   revisit, **When** they are sorted into execution order, **Then** all 255 rows are placed with no
   circular dependency remaining.
3. **Given** the extracted dependencies, **When** every referenced step identifier is looked up, **Then**
   all of them resolve to a row that exists.
4. **Given** a source document revision that introduces a dependency notation the extraction has never
   seen, **When** the extraction runs, **Then** it stops with a clear error naming the unrecognised text
   rather than dropping the dependency.

---

### User Story 3 - Report what the source document gets wrong, without repairing it (Priority: P2)

The source document states most dependencies in only one direction: step A names B as its successor, but
B does not name A as its predecessor. The engineer needs those discrepancies counted and listed as
observations about the document — not silently fixed, and not treated as extraction failures.

**Why this priority**: It is the milestone's first honest measurement, and the count is a number the
final report may quote. It ranks below Stories 1 and 2 because the graph is usable before the
discrepancies are catalogued.

**Independent Test**: Run the extraction and confirm the findings list contains one entry per
one-directional dependency, with a total count, and that the extraction still succeeds.

**Acceptance Scenarios**:

1. **Given** the source documents, **When** the extraction runs, **Then** every dependency declared in
   only one direction appears as a finding, the total is reported, and the extraction succeeds.
2. **Given** the findings list, **When** it is reviewed, **Then** each finding names the two rows
   involved and quotes the source text it came from.
3. **Given** the extraction has recorded findings, **When** the artifact's dependency network is used,
   **Then** the one-directional dependencies are still present as usable dependencies — recorded, not
   discarded.

---

### User Story 4 - Know which steps this project will actually walk (Priority: P2)

The harness will not execute all 236 work items. The engineer needs the artifact to say, per work item,
whether it contributes to the project's declared end products, and separately whether it falls inside
the set of activities this project has chosen to walk. Two different questions, two different answers,
neither one overstated.

**Why this priority**: Later milestones' skip accounting and the final coverage report depend on this
distinction. It ranks P2 because it is derived from Stories 1 and 2's output rather than standing alone.

**Independent Test**: Confirm the artifact reports both memberships per work item with distinct counts,
and that the counts match a hand-check of the excluded activities.

**Acceptance Scenarios**:

1. **Given** the extracted dependencies, **When** contribution to the declared end products is computed,
   **Then** each work item is marked accordingly and the total is reported.
2. **Given** the project's declared set of activities to walk, **When** membership is computed, **Then**
   each work item is marked accordingly, the total is reported, and it is a subset of the contribution
   set.
3. **Given** the two memberships, **When** the excluded work items are listed, **Then** the list names
   the activities they belong to, so a reader can see exactly what this project is choosing not to do.
4. **Given** the memberships, **When** the critical path and the two additional chosen activities are
   checked, **Then** all of them are inside the walked set.

---

### User Story 5 - Re-run safely when a source document is revised (Priority: P3)

The source documents are dated and will be revised. The engineer re-runs the extraction: if nothing
changed, nothing is rewritten; if something changed, the differences are presented for review before
anything is accepted.

**Why this priority**: Real but not needed to complete the milestone's own work. It is what makes the
artifact maintainable rather than a one-off transcription.

**Independent Test**: Run the extraction twice against unchanged sources and confirm the two results are
byte-for-byte identical; confirm the stored artifact equals a fresh extraction.

**Acceptance Scenarios**:

1. **Given** unchanged source documents, **When** the extraction runs twice, **Then** the two results are
   byte-for-byte identical.
2. **Given** unchanged source documents and an existing stored artifact, **When** the engineer re-runs,
   **Then** the harness reports no change and rewrites nothing.
3. **Given** a revised source document, **When** the engineer re-runs, **Then** the harness presents the
   changed counts and the change in findings before the new artifact is accepted.

---

### Edge Cases

Every case below is a real form present in the source documents, not a hypothetical. Counts come from a
measurement pass over the 2026-08-26 revision.

- **A dependency written as an abbreviated suffix.** A row lists `SYS1-04-e, -g, -s` — the second and
  third entries inherit the activity prefix from the first. The extraction must resolve them, not skip
  them.
- **A dependency written as a range, in four different spellings.** `SYS1-03-g through -n`,
  `SYS2-14-b–h`, `SYS1-07-a – d`, and `SYS1-02 – SYS1-05` all appear. All four must expand.
- **A dependency naming an activity where a work item is expected.** A work item legitimately names a
  whole activity as its successor. Kept as a dependency, flagged as an observation.
- **A dependency that is prose, not an identifier.** `the following phases (architecture design, vendor
  selection / SYS.3 onward)` names no row in this process. It must be recorded as an outside reference
  and must never become a dependency — and the `SYS.3` inside it must not be mistaken for a step
  identifier.
- **A dependency the document marks as going backwards.** Exactly one exists, annotated `(revisit)`.
  Including it in execution ordering leaves only 69 of 255 rows placeable, so it must be kept as data but
  excluded from ordering.
- **A completeness level that reads like an approval but is not one.** One row reads "not yet approved by
  the decision-making meeting", and twelve read "settled as the analysis result" or equivalent. Neither
  is a human approval event, and neither may be recorded as one.
- **Two different label spellings for the same field.** Three activity-summary labels carry a
  parenthetical suffix on the first activity only. Both spellings must match the same field.
- **A source document containing Japanese text on a machine whose console default is not Unicode.** Every
  read and write must specify Unicode explicitly, or the extraction fails on character decoding.
- **A row whose definition-of-done is a single unnumbered sentence.** The 19 phase and activity rows are
  like this, while work-item rows are numbered. Both must yield at least one clause.
- **A single row carrying a labelled field no other row has.** `SYS1-08-c` alone carries a `Rationale`
  field. It must be transcribed, not dropped, and a label the extraction has never seen must stop the
  extraction rather than pass unnoticed.
- **An optional field taking more than one value.** The applicability rating is present on 7 rows and
  takes two distinct values, one of which appears exactly once. Both must be preserved as written; neither
  may be normalised away.

## Requirements *(mandatory)*

### Functional Requirements

**Extraction**

- **FR-001**: The harness MUST extract all 255 rows of the process breakdown — 3 phases, 16 activities,
  236 work items — into a single machine-readable artifact.
- **FR-002**: Each row MUST carry its identifier, hierarchy level, parent, phase, name, purpose, work
  content, declared inputs and their sources, declared outputs, entry condition, exit
  definition-of-done clauses, and worked examples. Where the source document also supplies a
  corresponding process-standard practice reference, an applicability rating, or a stated rationale for
  that row, those MUST be carried too; they are present on some rows and absent on others, and absence
  MUST NOT be an error.
- **FR-002a**: Every labelled field the source document supplies MUST be accounted for. A labelled field
  the extraction does not recognise MUST be a hard failure naming the row and the label, never silently
  discarded — dropping source content is the failure this feature exists to prevent. One row carries an
  eleventh labelled field that no other row has, and it MUST be transcribed rather than lost.
- **FR-003**: Worked examples MUST be recorded verbatim from the source document. They are a calibration
  set written in the project's own subject domain and are passed unmodified into later milestones'
  authoring briefs; paraphrasing them MUST NOT occur.
- **FR-004**: Activity rows MUST additionally carry the nine capability ratings the second source
  document assigns per activity, classified into primary, effective and auxiliary, and the activity's
  outline, main outputs, owner, departments involved, completion criterion, and common pitfall.
- **FR-005**: The artifact MUST carry all ten dependency-summary entries from the source document, each
  with its kind, the step identifiers it names, its stated impact, and its stated mitigation.
- **FR-006**: Every file read and written MUST specify Unicode encoding explicitly, independent of the
  machine's console default.

**Dependencies**

- **FR-007**: The extraction MUST resolve all six dependency notations present in the source: full step
  identifiers, activity identifiers, phase identifiers, abbreviated suffixes, ranges in four spellings,
  and the literal `none`.
- **FR-008**: Prose dependency targets that name nothing inside this process MUST be recorded as outside
  references and MUST NOT become dependencies.
- **FR-009**: The dependency set MUST be the union of both declaration directions, so that a dependency
  stated only once is still usable.
- **FR-010**: Each dependency MUST record which direction or directions declared it, and the source text
  it came from.
- **FR-011**: Each dependency MUST be classified as forward or as a revisit. Only dependencies the source
  document itself annotates as revisits may be classified as such.
- **FR-012**: Execution ordering and end-product-contribution computation MUST use forward dependencies
  only. Revisit dependencies MUST be retained in the artifact for later milestones' rework handling.

**Derived properties**

- **FR-013**: Each row MUST carry a completeness level, the verbatim text naming who signs it off, and a
  classification of what kind of sign-off that is.
- **FR-014**: A row MUST be marked as requiring a human stop when, and only when, its completeness level
  is *fixed* **and** its sign-off kind is a decision-meeting approval or an inter-department agreement.
  Rows whose completeness is *fixed* because a fact or a result was recorded MUST NOT be marked as
  requiring a human stop.
- **FR-015**: Each row MUST be flagged for critical path, external lead time, and hard deadline according
  to the dependency-summary entries that name it — not according to any list held in the extraction
  itself.
- **FR-016**: A row MUST carry a conditional-skip record when the source document's entry condition
  prescribes skipping it, capturing the condition and the source text.
- **FR-017**: Definition-of-done clauses MUST carry an index and the clause text only. A per-clause
  sign-off requirement MUST NOT be recorded, because the source document states none.
- **FR-018**: Each work item MUST carry two independent memberships: whether it contributes to the
  declared end products, and whether it lies within the set of activities this project will walk. The
  second MUST be a subset of the first.
- **FR-019**: The set of activities to walk and the declared end products MUST be recorded in the
  artifact, so a reader can see what the memberships were computed against.
- **FR-020**: Membership MUST include the parent activity and phase of every included work item, because
  containment is not a dependency.

**Failure and findings**

- **FR-021**: The extraction MUST stop with a clear error when the row count is not 255, a referenced
  identifier does not resolve, a circular dependency remains among forward dependencies, a completeness
  or definition-of-done field cannot be parsed, or a dependency notation matches none of the six known
  forms.
- **FR-022**: The extraction MUST record a finding, and still succeed, for each dependency declared in
  only one direction, each dependency crossing hierarchy levels, each prose dependency target, and each
  revisit dependency.
- **FR-023**: Each finding MUST name the rows involved, state a severity, and quote the source text.
- **FR-024**: Findings MUST NOT be repaired. Repairing a one-directional dependency would assert a
  dependency the source document states only once, which is a claim about the process rather than about
  the extraction.
- **FR-025**: The extraction MUST also produce a generated, human-readable extraction report holding the
  row counts, the dependency counts split by kind, the findings grouped by kind with their totals, the
  two thread membership counts and the excluded work items, and the count of rows requiring a human stop.
  A reader MUST be able to obtain every headline number of this milestone from that report without
  opening the structured artifact and without opening either source document.
- **FR-026**: The extraction report MUST be generated, never hand-written, and MUST be subject to the same
  byte-identity guarantee as the structured artifact.

**Re-running**

- **FR-027**: Re-extraction from unchanged source documents MUST produce byte-identical output — both the
  structured artifact and the extraction report. Neither MUST contain a timestamp or any other varying
  value.
- **FR-028**: The structured artifact MUST record the identity of each source document it was extracted
  from, so a revision is detectable without re-parsing.
- **FR-029**: Both generated files MUST be written atomically — produced in full, then moved into place
  only on complete success. A failed extraction MUST leave the previously committed output untouched, and
  a partially written file MUST NOT be observable at any point.
- **FR-030**: On a source revision, the harness MUST present the changed counts, the change in findings,
  and any newly unrecognised notation. The review surface for the change itself is the version-control
  working tree; the harness MUST NOT introduce a separate staging path or an overwrite flag.
- **FR-031**: Neither generated file MUST be edited by hand.

**Boundary**

- **FR-032**: This feature MUST NOT deliver any authoring or verification agent, any run workspace,
  ledger, domain-pack definition, access-control enforcement, or recording template. It produces data
  and tests only.
- **FR-033**: This feature MUST NOT modify the AICA simulator — `app/`, `htmlapp/`, `packages/`,
  `scenarios/`, `docs/master/`, or `combined_contracts/`.

### Terminology

The source documents' own vocabulary is used exactly, per `ivi-building/CLAUDE.md`: there are 3
**phases**, 16 **activities**, and 236 **work items**. Activities are never called phases.

This specification says **process row** and **dependency** where the design documents say *node* and
*edge*. They denote the same things; the spec uses the process vocabulary because its audience is the
planning engineer, and the design uses graph vocabulary because its audience is the implementer. Both
are canonical in their own document, and no third term is introduced.

### Key Entities

- **Process row** — one of the 255 rows: a phase, an activity, or a work item. Carries the transcribed
  columns of the source document plus the derived properties above. Related to its parent and, for
  activities, to its capability ratings.
- **Dependency** — a directed relation between two process rows, carrying its direction of declaration,
  its source text, and whether it is a forward step or a revisit.
- **Dependency-summary entry** — one of ten named characteristics of the process (critical path, external
  lead times, hard deadline, confluence points, parallelisable work, rework paths), each naming the rows
  it concerns.
- **Finding** — an observation about the source document, carrying a severity, the rows involved, and the
  quoted source text. Never a repair.
- **Thread** — the declared end products, the declared set of activities to walk, and the two resulting
  membership sets over work items.
- **Process graph artifact** — the single generated file holding all of the above plus the identity of
  the source documents it came from. Read-only after generation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The artifact contains exactly 255 process rows: 3 phases, 16 activities, 236 work items.
- **SC-002**: All 236 work items carry at least one definition-of-done clause, at least one declared
  output, and a non-empty entry condition — no exceptions.
- **SC-003**: Every dependency reference in the artifact resolves to an existing row; the count of
  unresolved references is **0**.
- **SC-004**: All 11 consecutive pairs on the source document's separately-stated 12-step critical path
  are connected by a directed route through the extracted dependencies.
- **SC-005**: All 255 rows place into a consistent execution order once the one source-annotated revisit
  dependency is excluded; the count of rows left unplaceable is **0**.
- **SC-006**: Exactly **1** revisit dependency exists, and it is the one the source document annotates.
- **SC-007**: The number of dependencies declared in only one direction is measured and recorded in the
  artifact; at the 2026-08-26 revision it is **217**, and the extraction succeeds despite them.
- **SC-008**: **19** rows are marked as requiring a human stop, and the row whose completeness text reads
  "not yet approved by the decision-making meeting" is **not** among them.
- **SC-009**: **234** of 236 work items are marked as contributing to the declared end products, and
  **210** are marked as within the set of activities to walk; the 26 excluded work items are listed with
  the activities they belong to.
- **SC-010**: All 12 critical-path rows plus the two additionally chosen activities are inside the walked
  set.
- **SC-011**: Exactly **1** work item carries a conditional-skip record, matching the one skip the source
  document prescribes.
- **SC-012**: Two consecutive extractions from unchanged sources differ by **0** bytes, and the stored
  artifact differs from a fresh extraction by **0** bytes.
- **SC-013**: A planning engineer can run the extraction and read every headline number of this milestone
  — row counts, dependency counts by kind, findings by kind, both thread memberships, and the human-stop
  count — from the generated extraction report, without opening the structured artifact and without
  opening either source document.
- **SC-014**: The generated extraction report reproduces byte-identically alongside the structured
  artifact: two consecutive extractions differ by **0** bytes in both files.
- **SC-015**: The AICA simulator is unchanged: **0** files modified under `app/`, `htmlapp/`, `packages/`,
  `scenarios/`, `docs/master/`, or `combined_contracts/`.

## Assumptions

- **Source revision.** All measured numbers in the success criteria describe the 2026-08-26 revision of
  the two source documents. A revision may legitimately change them; SC-012's byte-identity and the
  re-run review flow (FR-027) are what make such a change visible rather than silent.
- **English translations are the source of truth.** The Markdown translations under `others/` are what
  the extraction reads. The original workbooks sit beside them but are not parsed.
- **The declared end products are the parent design's.** The three terminal steps and the 14 activities
  to walk come from the parent design's threading decision, restated in the H0 design. This feature
  records them; it does not choose them.
- **One-directional dependencies are a property of the document.** They are treated as an authoring
  characteristic of the source, not as an error to be corrected, per FR-024.
- **The external-lead-time flag covers only the steps the dependency summary names** — 8 of them. Other
  steps are plainly external work but are not named there, so they are not flagged. A later milestone may
  widen this using the second source document's per-activity markers; the source text is retained so
  that widening needs no re-extraction.
- **No agent behaviour is exercised.** This feature has no authoring or verification agent, so its
  verification is entirely deterministic. Fixture-run and seeded-defect verification begin in milestone
  H2.
- **Environment.** Tests run on the local Python 3.12 interpreter. Docker is absent in this environment
  and the `uv` package manager is proxy-blocked, so neither may become a dependency of this feature's
  gate.
- **Both generated files and the extraction code are version-controlled.** They are derived from documents
  already under version control and contain no confidential customer material.
- **Finding severity has three levels**, defaulted rather than asked because no reasonable alternative
  exists: `info` for an observation that changes nothing (a one-directional dependency, a cross-level
  dependency), `warning` for something a reader should look at (a prose dependency target, the revisit
  dependency), and `error` reserved for conditions that instead stop the extraction under FR-021 — so a
  successful extraction never emits an `error` finding.
- **Source-document identity is a content hash.** FR-028's "identity" is a digest of the file's bytes,
  which is what makes an unchanged source detectable without re-parsing and makes a revision impossible
  to miss.
