"""Row-level parse fidelity: UTF-8 reading, the 255 headings, label accounting, and
the per-field parsers that turn a raw cell into structured data.

These tests exercise ``process_graph`` directly against the real source documents. They
deliberately do not use the ``graph`` fixture: the artifact and its loader arrive in a
later batch, and a test that depended on them would fail for the wrong reason.

Every cell string quoted below is copied verbatim out of a source document. A parser
test built only on invented strings proves that the parser handles the test author's
imagination, not the document.
"""

import pytest

import process_graph
from conftest import SOURCE_PATHS


def _process_list():
    """The process-list document's text, read the way the extractor reads it."""
    text, _ = process_graph.read_source(SOURCE_PATHS["process_list"])
    return text


def _application_map():
    """The application-map document's text, read the way the extractor reads it."""
    text, _ = process_graph.read_source(SOURCE_PATHS["application_map"])
    return text


def _rows_by_id():
    return {row["id"]: row for row in process_graph.parse_rows(_process_list())}


def test_source_documents_are_read_as_utf8():
    """FR-006: both sources read with an explicit UTF-8 encoding, Japanese intact.

    The console default on this platform is cp932, under which a bare ``open()`` on
    either document raises ``UnicodeDecodeError``. Each document's line 3 names the
    Japanese-titled source workbook it was translated from, so a mangled decode is
    visible rather than silent.
    """
    expected_workbook_titles = {
        "process_list": "企画要求定義プロセス一覧",
        "application_map": "適用マップ",
    }

    for name, path in SOURCE_PATHS.items():
        text, digest = process_graph.read_source(path)

        assert text, f"{name} read as empty text"
        assert len(digest) == 64, f"{name} digest is not a sha256 hex digest: {digest!r}"

        needle = expected_workbook_titles[name]
        assert needle in text, f"{name} lost its Japanese workbook title on read"

        # The needle survives a full UTF-8 round trip, so the decode was lossless.
        assert needle in text.encode("utf-8").decode("utf-8")


def test_parse_rows_finds_255_headings():
    """FR-001 / SC-001: the process list is 3 phases + 16 activities + 236 work items."""
    text, _ = process_graph.read_source(SOURCE_PATHS["process_list"])
    rows = process_graph.parse_rows(text)

    by_level = {"L1": [], "L2": [], "L3": []}
    for row in rows:
        by_level[row["level"]].append(row["id"])

    assert len(by_level["L1"]) == 3
    assert len(by_level["L2"]) == 16
    assert len(by_level["L3"]) == 236
    assert len(rows) == 255

    assert by_level["L1"] == ["PH1", "PH2", "PH3"]
    assert by_level["L2"][0] == "SYS1-01"
    assert by_level["L2"][-1] == "SYS2-16"
    assert len({row["id"] for row in rows}) == 255, "duplicate row id"


def test_parse_rows_accounts_for_every_labelled_bullet():
    """FR-002 / FR-002a: the ten required labels on all 255 rows, three optional.

    The optional counts are measured facts about this revision of the document
    (research.md R1), and ``Rationale`` is the row that motivates the whitelist at all.
    """
    text, _ = process_graph.read_source(SOURCE_PATHS["process_list"])
    rows = process_graph.parse_rows(text)

    for row in rows:
        for label in process_graph.REQUIRED_LABELS:
            assert label in row["labels"], f"{row['id']} is missing {label!r}"
        for label in row["labels"]:
            assert label in process_graph.KNOWN_LABELS

    def count(label):
        return sum(1 for row in rows if label in row["labels"])

    assert count("ASPICE BP") == 135
    assert count("AI hypothesis-driven applicability") == 7
    assert count("Rationale") == 1

    rationale_rows = [row["id"] for row in rows if "Rationale" in row["labels"]]
    assert rationale_rows == ["SYS1-08-c"]


#: The three optional labels and the node field each becomes, with the number of rows
#: that carry it — measured on the 2026-08-26 revision.
_OPTIONAL_LABEL_FIELDS = {
    "ASPICE BP": ("aspice_bp", 135),
    "AI hypothesis-driven applicability": ("ai_applicability", 7),
    "Rationale": ("rationale", 1),
}


def test_optional_fields_may_be_absent():
    """FR-002: ``aspice_bp`` on exactly 135 rows, ``ai_applicability`` 7, ``rationale`` 1
    — and the absence of one is never an error.

    The absence side is what this test is for. The parser hard-fails on an *unknown*
    label, so the risk in the other direction is that a row lacking an optional label
    gets treated the same way: 117 of the 255 rows carry none of the three, and all 255
    must still parse. Counts are pinned exactly, since "some rows have it" would also
    pass on a parser that found one.
    """
    rows = process_graph.parse_rows(_process_list())
    assert len(rows) == 255, "absence of an optional label lost a row"

    for label, (field, expected) in _OPTIONAL_LABEL_FIELDS.items():
        present = [row for row in rows if label in row["labels"]]
        absent = [row for row in rows if label not in row["labels"]]

        assert len(present) == expected, (
            f"{field} (from {label!r}) is present on {len(present)} rows, not {expected}"
        )
        assert len(absent) == 255 - expected
        for row in present:
            assert row["labels"][label].strip(), f"{row['id']} carries an empty {field}"

    assert [row["id"] for row in rows if "Rationale" in row["labels"]] == ["SYS1-08-c"]

    # 117 rows carry none of the three at all, and 5 carry two. A row with no optional
    # label is the common case, not an exception.
    carried = [
        sum(1 for label in _OPTIONAL_LABEL_FIELDS if label in row["labels"])
        for row in rows
    ]
    assert carried.count(0) == 117
    assert carried.count(1) == 133
    assert carried.count(2) == 5
    assert sum(carried) == 143 == 135 + 7 + 1


def test_ai_applicability_values_are_preserved():
    """FR-002: the 7 ``ai_applicability`` values are 6 x ``◯`` and 1 x ``★``, by codepoint.

    ``◯`` is ``U+25EF`` LARGE CIRCLE, **not** the visually near-identical ``U+25CB``
    WHITE CIRCLE, and ``★`` is ``U+2605`` BLACK STAR. Comparing by codepoint is the whole
    point: a look-alike substitution in the source — or a well-meant normalisation in the
    parser — is invisible to the eye and would silently change what the field means.
    """
    large_circle = "◯"
    black_star = "★"
    white_circle = "○"
    assert large_circle != white_circle, "the two look-alikes are not the same codepoint"

    rows = process_graph.parse_rows(_process_list())
    values = {
        row["id"]: row["labels"]["AI hypothesis-driven applicability"]
        for row in rows
        if "AI hypothesis-driven applicability" in row["labels"]
    }

    assert len(values) == 7
    assert values == {
        "SYS1-02-a": large_circle,
        "SYS1-07-e": large_circle,
        "SYS1-08-c": black_star,
        "SYS2-10-g": large_circle,
        "SYS2-10-h": large_circle,
        "SYS2-10-l": large_circle,
        "SYS2-11-b": large_circle,
    }

    codepoints = [[ord(character) for character in value] for value in values.values()]
    assert all(len(pair) == 1 for pair in codepoints), "a value is not a single glyph"
    flat = [pair[0] for pair in codepoints]
    assert flat.count(0x25EF) == 6
    assert flat.count(0x2605) == 1
    assert 0x25CB not in flat, "U+25CB WHITE CIRCLE was substituted for U+25EF"


def _synthetic_document(bullets):
    """A minimal section-4 document holding one L3 row with the given bullet lines."""
    return "\n".join(
        [
            "# Fixture",
            "",
            "## 4. Process List (detailed)",
            "",
            "### PH1 (L1) — Phase ① Fixture phase",
            "",
            *bullets,
            "",
            "#### SYS1-01-a — Fixture work item",
            "",
            *bullets,
            "",
        ]
    )


def _required_bullets():
    return [f"- **{label}:** fixture value" for label in process_graph.REQUIRED_LABELS]


def test_synthetic_document_fixture_is_itself_parseable():
    """Guards the two hard-failure tests below: the baseline fixture must parse."""
    rows = process_graph.parse_rows(_synthetic_document(_required_bullets()))
    assert [row["id"] for row in rows] == ["PH1", "SYS1-01-a"]


def test_unknown_labelled_bullet_is_a_hard_failure():
    """FR-002a / FR-021: an unrecognised label stops the parse, naming row and label.

    An unaccounted bullet means source content would be dropped silently — the one
    failure mode this milestone exists to prevent.
    """
    bullets = _required_bullets() + ["- **Undocumented extra field:** something new"]

    with pytest.raises(process_graph.LabelError) as excinfo:
        process_graph.parse_rows(_synthetic_document(bullets))

    message = str(excinfo.value)
    assert "PH1" in message, f"the offending row is not named: {message}"
    assert "Undocumented extra field" in message, f"the label is not named: {message}"


def test_unparsed_section_preamble_content_is_a_hard_failure():
    """FR-021: the preamble is the one region neither other guard inspects.

    Content between the ``## 4.`` heading and the first row heading belongs to no row
    body and is not a heading, so a labelled bullet stranded there would vanish without
    the module ever noticing.
    """
    document = _synthetic_document(_required_bullets()).replace(
        "## 4. Process List (detailed)",
        "## 4. Process List (detailed)\n\n- **Purpose:** stranded before the first row",
    )

    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.parse_rows(document)

    assert "stranded before the first row" in str(excinfo.value)


def test_real_section_preamble_is_accepted():
    """The real document's preamble holds one legend line, which must not hard-fail."""
    text, _ = process_graph.read_source(SOURCE_PATHS["process_list"])
    assert len(process_graph.parse_rows(text)) == 255


def test_unrecognised_row_heading_is_a_hard_failure():
    """FR-021: a heading the row pattern cannot read would drop a whole row silently.

    The *first* heading is malformed on purpose. A malformed later heading leaves its
    line inside the preceding row's body, where the body-content check catches it; a
    malformed first heading puts its row ahead of every body, so the heading check is
    the only thing standing between it and a silent disappearance.
    """
    document = _synthetic_document(_required_bullets()).replace(
        "### PH1 (L1) — Phase ① Fixture phase", "### PH1 — Phase ① Fixture phase"
    )

    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.parse_rows(document)

    assert "PH1" in str(excinfo.value)


def test_unparseable_row_content_is_a_hard_failure():
    """FR-021: a bullet the label pattern cannot match is flagged, not skipped.

    ``- **Purpose** no colon`` matches neither the bullet pattern nor the separator, so
    without this check it would vanish between the two.
    """
    bullets = _required_bullets() + ["- **Malformed bullet** with no colon"]

    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.parse_rows(_synthetic_document(bullets))

    message = str(excinfo.value)
    assert "PH1" in message
    assert "Malformed bullet" in message


def test_missing_required_label_is_a_hard_failure():
    """FR-002 / FR-021: a row missing one of the ten required labels stops the parse."""
    bullets = [b for b in _required_bullets() if not b.startswith("- **Entry:**")]

    with pytest.raises(process_graph.LabelError) as excinfo:
        process_graph.parse_rows(_synthetic_document(bullets))

    message = str(excinfo.value)
    assert "PH1" in message, f"the offending row is not named: {message}"
    assert "Entry" in message, f"the label is not named: {message}"


# --- Exit (DoD) clause splitting ---------------------------------------------------

#: ``SYS1-01-a``'s Exit (DoD) cell, verbatim. Three clauses behind ①②③.
_SYS1_01_A_DOD = (
    "\u2460 The higher-level policy this plan links to has been identified "
    "\u2461 the expected contribution is documented "
    "\u2462 constraints and prohibited items are enumerated"
)

#: ``PH1``'s Exit (DoD) cell, verbatim. One unnumbered sentence — the L1/L2 shape.
_PH1_DOD = (
    "The plan document is approved at the decision-making meeting and distributed as "
    "the official input to the requirements-definition phase"
)


def test_split_dod_indexes_the_numbered_clauses_in_source_order():
    """FR-002 / FR-017: ①②③ become clauses 1, 2, 3 with their text untouched."""
    assert process_graph.split_dod(_SYS1_01_A_DOD) == [
        {
            "index": 1,
            "clause": "The higher-level policy this plan links to has been identified",
        },
        {"index": 2, "clause": "the expected contribution is documented"},
        {
            "index": 3,
            "clause": "constraints and prohibited items are enumerated",
        },
    ]


def test_split_dod_yields_one_clause_for_an_unnumbered_sentence():
    """FR-002: the 19 L1/L2 rows carry a single unnumbered sentence, kept whole."""
    assert process_graph.split_dod(_PH1_DOD) == [{"index": 1, "clause": _PH1_DOD}]


def test_split_dod_rejects_an_empty_cell():
    """FR-021: every row states a DoD, so an empty cell is a source change."""
    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.split_dod("   ")

    assert "Exit (DoD)" in str(excinfo.value)


def test_split_dod_rejects_out_of_order_numbering():
    """FR-021: ①③ would silently renumber clause 3 as clause 2.

    Dropping ② from a real cell is the cheapest way to produce the misnumbering, and
    the marker set is the extractor's only handle on which clause is which.
    """
    damaged = _SYS1_01_A_DOD.replace(
        "\u2461 the expected contribution is documented ", ""
    )

    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.split_dod(damaged)

    message = str(excinfo.value)
    assert "\u2460" in message and "\u2462" in message


def test_split_dod_rejects_text_before_the_first_marker():
    """FR-021: a preamble ahead of ① would be swallowed or mistaken for clause 1."""
    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.split_dod("preamble " + _SYS1_01_A_DOD)

    assert "\u2460" in str(excinfo.value)


def test_dod_clause_counts():
    """FR-002: the L3 clause histogram is exactly ``{2: 20, 3: 211, 4: 5}``.

    Measured on the 2026-08-26 revision. The 19 L1/L2 rows each carry one unnumbered
    sentence, which must yield exactly one clause at index 1 rather than zero.
    """
    rows = process_graph.parse_rows(_process_list())

    histogram = {}
    group_rows = 0
    for row in rows:
        clauses = process_graph.split_dod(row["labels"]["Exit (DoD)"])
        if row["level"] == "L3":
            histogram[len(clauses)] = histogram.get(len(clauses), 0) + 1
            continue
        group_rows += 1
        assert clauses == [
            {"index": 1, "clause": row["labels"]["Exit (DoD)"]}
        ], f"{row['id']} did not yield one unnumbered clause: {clauses!r}"

    assert histogram == {2: 20, 3: 211, 4: 5}
    assert group_rows == 19


def test_exit_dod_has_no_per_clause_human_flag():
    """FR-017: a clause carries exactly ``{index, clause}`` and nothing else.

    A per-clause human-signoff flag is *not derivable* — the source states no per-clause
    signoff — so it is absent rather than invented. This is a deliberate correction to
    the parent design §3.2's example, and this test is what stops it creeping back in.
    """
    for row in process_graph.parse_rows(_process_list()):
        for clause in process_graph.split_dod(row["labels"]["Exit (DoD)"]):
            assert set(clause) == {"index", "clause"}, (
                f"{row['id']} carries an unexpected clause key: {sorted(clause)}"
            )


#: ``SYS1-07-a``'s Exit (DoD) cell, verbatim. The one cell in the document that writes a
#: phase name — ``Phase ①`` — inside a numbered cell, so its circled numbers read ①①②③
#: unless the phase-name usage is excluded from the delimiter.
_SYS1_07_A_DOD = (
    "\u2460 The passages recording issues in every Phase \u2460 document have been checked "
    "\u2461 the conditions and action items from the decision-making meeting are included "
    "\u2462 each candidate issue has its source recorded"
)


def test_split_dod_does_not_read_a_phase_name_as_an_item_marker():
    """FR-002 / FR-021: ``Phase ①`` in prose is not a clause delimiter.

    ``SYS1-07-a`` is the only row in the document whose ``Exit (DoD)`` names a phase
    inside a numbered cell. Reading that ① as a delimiter would renumber all three
    clauses and split the first one mid-sentence, so the phase-name spelling is excluded
    from the delimiter by name. Removing that exclusion makes this test fail.
    """
    clauses = process_graph.split_dod(_SYS1_07_A_DOD)

    assert [clause["index"] for clause in clauses] == [1, 2, 3]
    assert clauses[0]["clause"] == (
        "The passages recording issues in every Phase \u2460 document have been checked"
    )
    assert clauses[2]["clause"] == "each candidate issue has its source recorded"


# --- Output deliverables ------------------------------------------------------------

#: ``SYS1-01``'s Output deliverables cell, verbatim. Three deliverables; the first
#: carries a parenthetical column list that itself contains two commas, so a naive
#: comma split would shred it into five.
_SYS1_01_OUTPUTS = (
    "Planning-premises summary (draft version: one-page plan summary / separation of "
    "decided items, hypotheses, and undecided items / sorting of existing verification "
    "results / premises and constraints / terminology), stakeholder map, study WBS"
)

#: ``SYS2-11-a``'s Output deliverables cell, verbatim — one of the two cells in the
#: document whose column list nests a second parenthetical.
_SYS2_11_A_OUTPUTS = (
    "Screen list (screen ID \u00d7 name \u00d7 type (screen / notification) \u00d7 "
    "related UC-ID \u00d7 display trigger)"
)

#: ``SYS2-14-e``'s Output deliverables cell, verbatim. No parenthetical at all, and its
#: "/" belongs to the deliverable's *name* rather than separating two deliverables.
_SYS2_14_E_OUTPUTS = "Frequency / interval control flowchart"


def test_parse_outputs_splits_on_top_level_commas_only():
    """FR-002: a comma inside the parenthetical column list is not a separator."""
    assert process_graph.parse_outputs(_SYS1_01_OUTPUTS) == [
        {
            "name": "Planning-premises summary",
            "shape": (
                "draft version: one-page plan summary / separation of decided items, "
                "hypotheses, and undecided items / sorting of existing verification "
                "results / premises and constraints / terminology"
            ),
        },
        {"name": "stakeholder map", "shape": None},
        {"name": "study WBS", "shape": None},
    ]


def test_parse_outputs_keeps_a_nested_parenthetical_inside_the_shape():
    """FR-002: the shape runs from the first "(" to the closing ")", nesting included."""
    assert process_graph.parse_outputs(_SYS2_11_A_OUTPUTS) == [
        {
            "name": "Screen list",
            "shape": (
                "screen ID \u00d7 name \u00d7 type (screen / notification) \u00d7 "
                "related UC-ID \u00d7 display trigger"
            ),
        }
    ]


def test_parse_outputs_shape_is_none_without_a_parenthetical():
    """FR-002: ``shape`` is ``None`` — not an empty string — when none is supplied.

    "/" is *not* an output separator: it belongs inside a deliverable's own name in all
    nine cells that carry one at top level.
    """
    assert process_graph.parse_outputs(_SYS2_14_E_OUTPUTS) == [
        {"name": "Frequency / interval control flowchart", "shape": None}
    ]


def test_parse_outputs_rejects_an_empty_cell():
    """FR-002 / FR-021: every row declares at least one output."""
    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.parse_outputs("   ")

    assert "Output deliverables" in str(excinfo.value)


def test_parse_outputs_rejects_an_unbalanced_parenthetical():
    """FR-021: an unclosed "(" makes the top-level comma depth wrong for the rest of
    the cell, which would merge deliverables instead of splitting them."""
    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.parse_outputs(_SYS1_01_OUTPUTS.replace("terminology)", "terminology"))

    assert "unbalanced" in str(excinfo.value)


def test_parse_outputs_rejects_a_parenthetical_that_does_not_close_the_deliverable():
    """FR-021: in all 255 cells a parenthetical ends its deliverable.

    Text after the closing ")" means the parenthetical is not the trailing column list,
    so treating it as ``shape`` would silently mislabel part of the name.
    """
    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.parse_outputs("Screen list (screen ID) and more text")

    assert "Screen list (screen ID) and more text" in str(excinfo.value)


def test_every_l3_has_dod_output_and_entry():
    """FR-002 / SC-002: all 236 work items carry a DoD, an output and an entry.

    Offenders are named rather than counted, because "some row is short a field" is not
    an actionable failure message.
    """
    rows = process_graph.parse_rows(_process_list())
    work_items = [row for row in rows if row["level"] == "L3"]
    assert len(work_items) == 236

    missing_dod = []
    missing_outputs = []
    missing_entry = []
    for row in work_items:
        if not process_graph.split_dod(row["labels"]["Exit (DoD)"]):
            missing_dod.append(row["id"])
        if not process_graph.parse_outputs(row["labels"]["Output deliverables"]):
            missing_outputs.append(row["id"])
        if not row["labels"]["Entry"].strip():
            missing_entry.append(row["id"])

    assert missing_dod == [], f"work items with no DoD clause: {missing_dod}"
    assert missing_outputs == [], f"work items with no output: {missing_outputs}"
    assert missing_entry == [], f"work items with an empty entry: {missing_entry}"


def test_every_row_declares_at_least_one_named_output():
    """FR-002: parsing every one of the 255 output cells yields non-empty names.

    The exact per-row output counts are a measured property of this revision, pinned
    here as a histogram so a change in the source's cell punctuation is visible.
    """
    rows = process_graph.parse_rows(_process_list())

    histogram = {}
    for row in rows:
        outputs = process_graph.parse_outputs(row["labels"]["Output deliverables"])
        histogram[len(outputs)] = histogram.get(len(outputs), 0) + 1
        for output in outputs:
            assert set(output) == {"name", "shape"}
            assert output["name"], f"{row['id']} declares an unnamed output"
            assert output["shape"] is None or output["shape"]

    assert histogram == {1: 191, 2: 43, 3: 12, 4: 5, 5: 2, 7: 2}


# --- Concrete examples --------------------------------------------------------------

#: ``SYS1-01-a``'s Concrete examples cell, verbatim. Three items behind ①②③, each of
#: which itself contains parentheticals and "/" — none of which is a delimiter here.
_SYS1_01_A_EXAMPLES = (
    "① Identify which of the connected-service strategy's focus areas (promoting "
    "safety and peace of mind, expanding subscription revenue) this links to, and write "
    "out the form the contribution takes (subscription rate / brand appeal / safety "
    "metrics). ② From the product planning policy, confirm the concept of the "
    "target vehicle model (family-oriented, frequent long-distance use) and check that "
    "the plan's direction does not contradict it. ③ Put the constraints and "
    "prohibited items to be observed (no advertising display, no additional charges, "
    "etc.) in writing, and use them as the frame for all subsequent study."
)


def test_parse_examples_splits_the_three_numbered_items_verbatim():
    """FR-003: ①②③ become three strings whose text is otherwise untouched.

    Only outer whitespace is stripped. These strings are a calibration set that later
    milestones pass unmodified into authoring briefs, so any other normalisation — even
    collapsing a double space — would be a paraphrase.
    """
    # The quoted cell is the real one, so this test cannot pass on a cell shape the
    # document does not contain.
    assert _rows_by_id()["SYS1-01-a"]["labels"]["Concrete examples"] == (
        _SYS1_01_A_EXAMPLES
    )

    assert process_graph.parse_examples(_SYS1_01_A_EXAMPLES) == [
        "Identify which of the connected-service strategy's focus areas (promoting "
        "safety and peace of mind, expanding subscription revenue) this links to, and "
        "write out the form the contribution takes (subscription rate / brand appeal / "
        "safety metrics).",
        "From the product planning policy, confirm the concept of the target vehicle "
        "model (family-oriented, frequent long-distance use) and check that the plan's "
        "direction does not contradict it.",
        "Put the constraints and prohibited items to be observed (no advertising "
        "display, no additional charges, etc.) in writing, and use them as the frame "
        "for all subsequent study.",
    ]


def test_parse_examples_yields_one_item_for_an_unnumbered_cell():
    """FR-003: the 19 L1/L2 rows point at their children instead of numbering items.

    ``SYS1-01``'s cell opens "(see the work items beneath)" and runs on as one
    unnumbered sentence, which must yield exactly one item rather than none.
    """
    rows = _rows_by_id()
    raw = rows["SYS1-01"]["labels"]["Concrete examples"]

    assert raw.startswith("(see the work items beneath)")
    assert process_graph.parse_examples(raw) == [raw]


def test_parse_examples_rejects_an_empty_cell():
    """FR-003 / FR-021: all 255 rows state examples, so an empty cell is a source change."""
    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.parse_examples("   ")

    assert "Concrete examples" in str(excinfo.value)


def test_examples_are_verbatim():
    """FR-003: every example of ``SYS1-01-a`` and ``SYS1-01-c`` occurs literally in the
    source document — the guard against paraphrase.

    Substring identity against the whole document is a stronger check than comparing
    against a string this test file also authored: it cannot pass on a summary, a
    re-wrapped line or a normalised quote mark, because none of those appear in the file
    the extractor read.
    """
    text = _process_list()
    rows = _rows_by_id()

    checked = 0
    for row_id in ("SYS1-01-a", "SYS1-01-c"):
        examples = process_graph.parse_examples(rows[row_id]["labels"]["Concrete examples"])
        assert len(examples) == 3, f"{row_id} does not state three examples: {examples!r}"
        for example in examples:
            assert example in text, (
                f"{row_id} example is not literal source text: {example!r}"
            )
            checked += 1

    assert checked == 6


def test_example_counts():
    """FR-003: the 236 work items state exactly three examples each; the 19 group rows one.

    Measured on the 2026-08-26 revision and pinned exactly, because "at least one" would
    pass on a cell whose ② and ③ had been swallowed by a delimiter change.
    """
    rows = process_graph.parse_rows(_process_list())

    histogram = {}
    for row in rows:
        examples = process_graph.parse_examples(row["labels"]["Concrete examples"])
        histogram[(row["level"], len(examples))] = (
            histogram.get((row["level"], len(examples)), 0) + 1
        )
        for example in examples:
            assert example == example.strip(), f"{row['id']} example is not stripped"
            assert example, f"{row['id']} states an empty example"

    assert histogram == {("L1", 1): 3, ("L2", 1): 16, ("L3", 3): 236}


# --- Process Overview (section 2) ---------------------------------------------------

#: The six canonical Process Overview labels and the node field each becomes. Three of
#: them carry a trailing parenthetical on activity 1 only.
_OVERVIEW_FIELDS = {
    "Outline": "outline",
    "Main outputs": "main_outputs",
    "Owner": "owner",
    "Departments involved": "departments",
    "Completion criterion": "completion_criterion",
    "Common pitfall": "common_pitfall",
}

#: The 16 activity IDs, in the order the Process Overview numbers its blocks 1-16.
_ACTIVITY_IDS = tuple(f"SYS1-{number:02d}" for number in range(1, 10)) + tuple(
    f"SYS2-{number:02d}" for number in range(10, 17)
)


def test_parse_overview_reads_all_sixteen_blocks():
    """FR-004: 16 Process Overview blocks, six non-empty fields each, keyed by activity.

    Keyed by activity ID rather than by block number, because the source numbers its
    blocks 1-16 while the rows are ``SYS1-01``…``SYS2-16`` — activities 1-9 are ``SYS1``,
    10-16 are ``SYS2``, which is the document's own rule.
    """
    overview = process_graph.parse_overview(_process_list())

    assert list(overview) == list(_ACTIVITY_IDS)
    assert len(overview) == 16

    for activity_id, block in overview.items():
        # Key order is the label declaration order, not the order the source happens to
        # write the rows in — byte-identical re-extraction depends on the output order.
        assert list(block) == list(_OVERVIEW_FIELDS.values()), (
            f"{activity_id} lacks exactly the six overview fields, in order: {list(block)}"
        )
        for field, value in block.items():
            assert value.strip(), f"{activity_id} has an empty {field}"
            assert value == value.strip(), f"{activity_id}'s {field} is not stripped"


def test_parse_overview_resolves_activity_ones_parenthetical_labels():
    """FR-004: ``Outline (what this step does)`` resolves to the same field as ``Outline``.

    Activity 1 is the only block whose ``Outline``, ``Owner`` and ``Completion criterion``
    labels carry a trailing parenthetical. Matching the bare label alone would leave three
    of ``SYS1-01``'s six fields missing; matching only the parenthetical spelling would
    leave the other 15 blocks short. Both spellings must land on one field.
    """
    overview = process_graph.parse_overview(_process_list())

    assert overview["SYS1-01"]["owner"] == "Business planning department"
    assert overview["SYS1-01"]["completion_criterion"] == (
        "Premises, constraints, and hypotheses are organized into a single document, and "
        "every undecided item has an owner and a deadline"
    )
    assert overview["SYS1-01"]["outline"].startswith(
        "Write out the idea-stage plan concept on one page"
    )

    # Activity 2 writes the same three labels without a parenthetical.
    assert overview["SYS1-02"]["owner"] == "Business planning department"
    assert overview["SYS1-02"]["completion_criterion"] == (
        "The value proposition can be stated outright in one sentence, with supporting "
        "evidence and falsification hypotheses linked to it"
    )


def test_parse_overview_values_are_verbatim():
    """FR-004: all 96 overview values occur literally in the source document.

    The anti-paraphrase check the examples carry, applied to the field the harness will
    put in front of a human at an activity gate.
    """
    text = _process_list()
    overview = process_graph.parse_overview(text)

    checked = 0
    for activity_id, block in overview.items():
        for field, value in block.items():
            assert value in text, (
                f"{activity_id}'s {field} is not literal source text: {value!r}"
            )
            checked += 1

    assert checked == 96 == 16 * 6


def test_parse_overview_spot_checks_the_last_block():
    """FR-004: activity 16 maps to ``SYS2-16`` and carries its own fields, verbatim.

    Block 16 is the last one, so its body runs to the section boundary rather than to the
    next block heading, and it is the only block whose trailing ``---`` separator falls
    inside it. Its ``Owner`` value is also the one that carries a top-level "/", which is
    part of the value and never a delimiter here.
    """
    overview = process_graph.parse_overview(_process_list())

    assert overview["SYS2-16"]["common_pitfall"] == (
        "Fixing provisional values as final, so change management stops working"
    )
    assert overview["SYS2-16"]["owner"] == (
        "Business planning department (integration) / business planning & IVI development "
        "departments (approval)"
    )


def _overview_rows():
    """One fixture block's six table rows, in the document's own order."""
    return [f"| **{label}** | fixture {label.lower()} |" for label in _OVERVIEW_FIELDS]


def _synthetic_overview(rows, heading="#### 1. Fixture activity"):
    """A minimal section-2 document holding one Process Overview block."""
    return "\n".join(
        [
            "# Fixture",
            "",
            "## 2. Process Overview",
            "",
            "### Phase ① Fixture phase",
            "",
            heading,
            "",
            "| Item | Content |",
            "|---|---|",
            *rows,
            "",
            "---",
            "",
            "## 3. Dependency Summary",
            "",
        ]
    )


def test_synthetic_overview_fixture_is_itself_parseable():
    """Guards the hard-failure tests below: the baseline fixture must parse."""
    overview = process_graph.parse_overview(_synthetic_overview(_overview_rows()))

    assert list(overview) == ["SYS1-01"]
    assert overview["SYS1-01"]["outline"] == "fixture outline"


def test_parse_overview_rejects_an_unknown_table_label():
    """FR-021: section 2 gets the same label accounting section 4 has.

    ``parse_rows`` hard-fails on an unrecognised bullet so no row content can vanish. The
    module docstring claims that for *unrecognised input*, not for section 4 alone, so an
    unaccounted overview row must stop the extraction too.
    """
    rows = _overview_rows() + ["| **Budget envelope** | something new |"]

    with pytest.raises(process_graph.LabelError) as excinfo:
        process_graph.parse_overview(_synthetic_overview(rows))

    message = str(excinfo.value)
    assert "Budget envelope" in message, f"the label is not named: {message}"
    assert "SYS1-01" in message, f"the block is not named: {message}"


def test_parse_overview_rejects_a_missing_field():
    """FR-021: all six fields are stated on all 16 blocks, so a missing one is a change."""
    rows = [row for row in _overview_rows() if "Common pitfall" not in row]

    with pytest.raises(process_graph.LabelError) as excinfo:
        process_graph.parse_overview(_synthetic_overview(rows))

    message = str(excinfo.value)
    assert "Common pitfall" in message
    assert "SYS1-01" in message


def test_parse_overview_rejects_unparsed_block_content():
    """FR-021: content inside a block that is neither a table row nor the table head.

    Section 2's counterpart to ``_reject_unparsed_body_lines``. Without it a row whose
    label formatting the pattern cannot read — a missing asterisk, a stray pipe — would be
    skipped between the two patterns in silence.
    """
    rows = _overview_rows() + ["| **Malformed row with no closing pipe"]

    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.parse_overview(_synthetic_overview(rows))

    assert "Malformed row with no closing pipe" in str(excinfo.value)


def test_parse_overview_rejects_content_before_the_first_block():
    """FR-021: section 2's preamble is the region no other guard inspects.

    Section 4 has ``_reject_unparsed_preamble`` for exactly this. Section 2's preamble
    legitimately holds only its phase headings, so a stranded table row there would vanish
    without the extractor noticing.
    """
    document = _synthetic_overview(_overview_rows()).replace(
        "## 2. Process Overview",
        "## 2. Process Overview\n\n| **Outline** | stranded ahead of every block |",
    )

    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.parse_overview(document)

    assert "stranded ahead of every block" in str(excinfo.value)


def test_parse_overview_rejects_an_unrecognised_heading():
    """FR-021: a heading the block pattern cannot read would drop a whole activity.

    A numberless ``#### Fixture activity`` is the cheapest way to produce one, and the
    block heading is what carries the activity number — so an unreadable heading loses the
    block's identity as well as its content.
    """
    document = _synthetic_overview(
        _overview_rows(), heading="#### Fixture activity with no number"
    )

    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.parse_overview(document)

    assert "Fixture activity with no number" in str(excinfo.value)


def test_parse_overview_rejects_an_out_of_range_activity_number():
    """FR-021: the source numbers 16 activities, so a 17th names no row.

    An out-of-range number yields an overview keyed to an activity that does not exist,
    which the node builder would then silently fail to attach to anything.
    """
    document = _synthetic_overview(_overview_rows(), heading="#### 17. Fixture activity")

    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.parse_overview(document)

    assert "17" in str(excinfo.value)


def test_parse_overview_rejects_a_missing_section():
    """FR-021: a document with no section 2 is a source change, not an empty overview."""
    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.parse_overview("# Fixture\n\n## 9. Something else\n")

    assert "Process Overview" in str(excinfo.value)


# --- F1-F9 ratings (Application Map section 2) --------------------------------------

#: Activity 1's rating line from the Application Map, verbatim. The heading dash is
#: U+2013 EN DASH and the separator is U+00B7 MIDDLE DOT.
_SYS1_01_RATING_LINE = (
    "**F1–F9:** F1 ◎ · F2 ◯ · F3 ◯ · F4 － "
    "· F5 － · F6 － · F7 － · F8 － "
    "· F9 ◯"
)


def test_f_rating_glyphs_are_matched_by_codepoint():
    """FR-004: the four rating glyphs are exactly the codepoints of ``data-model.md``.

    ``U+25EF`` LARGE CIRCLE and ``U+25CB`` WHITE CIRCLE are visually near-identical, and
    keying the table on the wrong one yields a *silently empty* ``effective`` list rather
    than an error. So the table is pinned by codepoint here, where a look-alike edit to the
    module fails a test instead of quietly changing 24 ratings.
    """
    glyphs = process_graph.RATING_GLYPHS

    assert {ord(glyph): kind for glyph, kind in glyphs.items()} == {
        0x25CE: "primary",  # BULLSEYE
        0x25EF: "effective",  # LARGE CIRCLE
        0x25B3: "auxiliary",  # WHITE UP-POINTING TRIANGLE
        0xFF0D: None,  # FULLWIDTH HYPHEN-MINUS - omitted
    }
    assert 0x25CB not in {ord(glyph) for glyph in glyphs}, (
        "U+25CB WHITE CIRCLE was substituted for U+25EF LARGE CIRCLE"
    )
    assert process_graph.RATING_KINDS == ("primary", "effective", "auxiliary")

    # The rating line the fixtures below quote is the document's own, so a look-alike
    # substitution in the *test* cannot mask one in the module.
    assert _SYS1_01_RATING_LINE in _application_map()


def test_parse_f_ratings_reads_all_sixteen_lines():
    """FR-004: 16 rating lines, each partitioning F1-F9 across the three lists.

    The totals are pinned exactly — 18 primary, 24 effective, 10 auxiliary, so 92 of the
    144 ratings are ``U+FF0D`` and omitted. A glyph-table mismatch shows up here as a list
    that is empty rather than as an exception, so the totals are the detector.
    """
    ratings = process_graph.parse_f_ratings(_application_map())

    assert list(ratings) == list(_ACTIVITY_IDS)
    assert len(ratings) == 16

    totals = {"primary": 0, "effective": 0, "auxiliary": 0}
    for activity_id, rated in ratings.items():
        assert list(rated) == ["primary", "effective", "auxiliary"], (
            f"{activity_id} does not carry the three rating lists in order: {list(rated)}"
        )

        seen = []
        for kind, functions in rated.items():
            totals[kind] += len(functions)
            seen.extend(functions)
            for function in functions:
                assert function in {f"F{number}" for number in range(1, 10)}, (
                    f"{activity_id} rates {function!r}, which is not one of F1-F9"
                )

        assert len(seen) == len(set(seen)), (
            f"{activity_id} rates one function in two lists: {sorted(seen)}"
        )
        assert rated["primary"], f"{activity_id} names no primary function"

    assert totals == {"primary": 18, "effective": 24, "auxiliary": 10}
    assert 16 * 9 - sum(totals.values()) == 92


def test_parse_f_ratings_spot_checks_two_activities():
    """FR-004: ``SYS1-01`` → primary ``["F1"]`` and ``SYS2-11`` → primary ``["F5"]``.

    Both blocks are stated in full rather than only their primary list, because the whole
    point of the codepoint table is that ``effective`` and ``auxiliary`` are the lists a
    look-alike glyph empties without complaint.
    """
    ratings = process_graph.parse_f_ratings(_application_map())

    assert ratings["SYS1-01"] == {
        "primary": ["F1"],
        "effective": ["F2", "F3", "F9"],
        "auxiliary": [],
    }
    assert ratings["SYS2-11"] == {
        "primary": ["F5"],
        "effective": ["F4"],
        "auxiliary": ["F8"],
    }

    # The two activities that name two primary functions, and the only two that do.
    two_primaries = [
        activity_id
        for activity_id, rated in ratings.items()
        if len(rated["primary"]) == 2
    ]
    assert two_primaries == ["SYS1-04", "SYS2-16"]


def _synthetic_map(rating_lines, heading="#### 1. Fixture activity"):
    """A minimal Application-Map section 2 holding one activity block.

    The legend line is kept, because ``**Legend for F1–F9:**`` must *not* read as a
    rating line — the pattern is anchored at the line start for exactly that reason.
    """
    return "\n".join(
        [
            "# Fixture",
            "",
            "## 2. Process × AI Application",
            "",
            "**Legend for F1–F9:** ◎ = used as a primary function",
            "",
            "### Phase ① Fixture phase",
            "",
            heading,
            "",
            *rating_lines,
            "",
            "## 3. Summary",
            "",
        ]
    )


def test_synthetic_map_fixture_is_itself_parseable():
    """Guards the hard-failure tests below, and proves the legend line is not a rating."""
    ratings = process_graph.parse_f_ratings(_synthetic_map([_SYS1_01_RATING_LINE]))

    assert ratings == {
        "SYS1-01": {
            "primary": ["F1"],
            "effective": ["F2", "F3", "F9"],
            "auxiliary": [],
        }
    }


def test_parse_f_ratings_rejects_a_look_alike_glyph():
    """FR-004 / FR-021: ``U+25CB`` WHITE CIRCLE where ``U+25EF`` belongs is a hard failure.

    This is the failure this function is shaped around. Left untreated, an unrecognised
    glyph would drop three of activity 1's four ratings and leave a plausible-looking
    ``{"primary": ["F1"], "effective": [], "auxiliary": []}`` behind — wrong, and invisible
    to a reader comparing it against the source by eye. The error names the codepoint,
    because the two glyphs are indistinguishable in a terminal.
    """
    damaged = _SYS1_01_RATING_LINE.replace("◯", "○")

    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.parse_f_ratings(_synthetic_map([damaged]))

    message = str(excinfo.value)
    assert "U+25CB" in message, f"the offending codepoint is not named: {message}"
    assert "SYS1-01" in message, f"the activity is not named: {message}"


def test_parse_f_ratings_rejects_an_unknown_glyph():
    """FR-021: a glyph outside the Legend's four stops the extraction, naming it."""
    damaged = _SYS1_01_RATING_LINE.replace("F4 －", "F4 ☆")

    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.parse_f_ratings(_synthetic_map([damaged]))

    message = str(excinfo.value)
    assert "U+2606" in message
    assert "F4" in message


def test_parse_f_ratings_rejects_an_out_of_order_function_number():
    """FR-021: the position in the line is the rating's only handle on which F it rates.

    Swapping ``F3`` for ``F2`` at position three would silently re-attribute a rating to a
    function the source rated differently.
    """
    damaged = _SYS1_01_RATING_LINE.replace("F3 ◯", "F2 ◯")

    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.parse_f_ratings(_synthetic_map([damaged]))

    assert "out of order" in str(excinfo.value)


def test_parse_f_ratings_rejects_a_short_rating_line():
    """FR-021: all nine functions are rated on every line, so eight is a source change."""
    damaged = _SYS1_01_RATING_LINE.replace(" · F9 ◯", "")

    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.parse_f_ratings(_synthetic_map([damaged]))

    message = str(excinfo.value)
    assert "8" in message and "9" in message


def test_parse_f_ratings_rejects_a_block_with_no_rating_line():
    """FR-021: an activity with no rating line would silently carry no ratings at all."""
    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.parse_f_ratings(_synthetic_map(["Prose but no rating line."]))

    message = str(excinfo.value)
    assert "SYS1-01" in message
    assert "F1–F9" in message


def test_parse_f_ratings_rejects_two_rating_lines_in_one_block():
    """FR-021: two lines leave it undetermined which one rates the activity.

    Taking the first would be a guess, and the guess is invisible in the output.
    """
    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.parse_f_ratings(
            _synthetic_map([_SYS1_01_RATING_LINE, "", _SYS1_01_RATING_LINE])
        )

    message = str(excinfo.value)
    assert "SYS1-01" in message
    assert "2" in message


def test_parse_f_ratings_rejects_a_rating_line_stranded_in_the_preamble():
    """FR-021: a rating line ahead of the first block belongs to no activity.

    The Application Map's preamble is the one region no block body covers, so this is its
    counterpart to ``_reject_unparsed_preamble``. H0 transcribes only the rating line from
    this document, so the guard is narrowed to that line kind rather than pretending to
    account for the section's prose.
    """
    document = _synthetic_map([_SYS1_01_RATING_LINE]).replace(
        "### Phase ① Fixture phase",
        _SYS1_01_RATING_LINE + "\n\n### Phase ① Fixture phase",
    )

    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.parse_f_ratings(document)

    assert "belongs to no activity" in str(excinfo.value)


def test_parse_f_ratings_rejects_a_missing_section():
    """FR-021: no section 2 is a source change, not an empty rating set."""
    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.parse_f_ratings("# Fixture\n\n## 9. Something else\n")

    assert "AI Application" in str(excinfo.value)


# --- Dependency Summary (section 3) --------------------------------------------------

#: The critical-path entry's four cells, verbatim. The one entry whose path is a plain
#: arrow chain, and the one the derived ``critical_path`` flag is resolved from.
_CRITICAL_PATH_TITLE = "Critical path (main series)"
_CRITICAL_PATH_CONTENT = (
    "The shortest path that determines the skeleton of the plan. If this slips, every "
    "step slips with it."
)
_CRITICAL_PATH_RAW = (
    "SYS1-01-o → SYS1-02-r → SYS1-03-o → SYS1-04-t → SYS1-05-o → SYS1-06-q → "
    "SYS1-07-n → SYS1-08-m → SYS1-09-i → SYS2-10-n → SYS2-12-p → SYS2-16-n"
)
_CRITICAL_PATH_IMPACT = (
    "Each node cannot be started without the fixed version from the preceding step, so a "
    "single delay becomes a delay of the final baseline as-is"
)
_CRITICAL_PATH_MITIGATION = (
    "Reserve the review dates for each fixed version in advance, working backwards from "
    "the decision-making meeting (SYS1-01-n)"
)

#: The expected kind distribution, from data-model.md.
_DEPENDENCY_KIND_COUNTS = {
    "critical_path": 1,
    "external_lead_time": 2,
    "hard_deadline": 1,
    "confluence": 2,
    "parallel": 2,
    "rework": 2,
}


def _dependency_summary():
    return process_graph.parse_dependency_summary(_process_list())


def test_parse_dependency_summary_reads_ten_entries():
    """FR-005: 10 entries in document order, seven fields each, with the stated kinds.

    The kind distribution is pinned exactly rather than by presence, because two entries
    share each of four kinds and a prefix match that collapsed a pair would still look
    like a populated summary.
    """
    entries = _dependency_summary()

    assert len(entries) == 10

    histogram = {}
    for entry in entries:
        assert set(entry) == {
            "kind",
            "title",
            "content",
            "path_raw",
            "path_nodes",
            "impact",
            "mitigation",
        }, f"{entry.get('title')!r} does not carry the seven summary fields"
        histogram[entry["kind"]] = histogram.get(entry["kind"], 0) + 1

        for field in ("title", "content", "path_raw", "impact", "mitigation"):
            assert entry[field].strip(), f"{entry['title']!r} has an empty {field}"
        assert entry["path_nodes"], f"{entry['title']!r} resolved to no node"

    assert histogram == _DEPENDENCY_KIND_COUNTS
    assert sum(histogram.values()) == 10


def test_parse_dependency_summary_keeps_path_raw_verbatim():
    """FR-005: ``path_raw`` is the source cell untouched, arrows and all.

    It is retained so a later milestone can widen ``path_nodes`` — the span question below
    — without re-extracting, which only works if the cell was never normalised.
    """
    text = _process_list()
    entries = _dependency_summary()
    critical = {entry["kind"]: entry for entry in entries}["critical_path"]

    assert critical["title"] == _CRITICAL_PATH_TITLE
    assert critical["content"] == _CRITICAL_PATH_CONTENT
    assert critical["path_raw"] == _CRITICAL_PATH_RAW
    assert critical["impact"] == _CRITICAL_PATH_IMPACT
    assert critical["mitigation"] == _CRITICAL_PATH_MITIGATION

    for entry in entries:
        for field in ("title", "content", "path_raw", "impact", "mitigation"):
            assert entry[field] in text, (
                f"{entry['title']!r}'s {field} is not literal source text: "
                f"{entry[field]!r}"
            )


def test_parse_dependency_summary_resolves_the_critical_path_in_order():
    """FR-005: the 12 critical-path steps, in the order the source chains them."""
    entries = {entry["kind"]: entry for entry in _dependency_summary()}

    assert entries["critical_path"]["path_nodes"] == [
        "SYS1-01-o",
        "SYS1-02-r",
        "SYS1-03-o",
        "SYS1-04-t",
        "SYS1-05-o",
        "SYS1-06-q",
        "SYS1-07-n",
        "SYS1-08-m",
        "SYS1-09-i",
        "SYS2-10-n",
        "SYS2-12-p",
        "SYS2-16-n",
    ]


def test_parse_dependency_summary_does_not_expand_an_arrow_into_a_span():
    """FR-005: ``SYS1-02-n → SYS1-02-p`` is two nodes, not the span ``n, o, p``.

    A deliberate judgment call recorded in data-model.md. The arrow is a sequence, not a
    range: ``SYS1-02-o`` ("conduct the interviews") is plainly external work, but the
    source does not list it, so the extractor does not flag it. Expanding the span would
    put a claim the source never made into a derived flag — which is why ``path_raw`` is
    kept verbatim for a later milestone to widen deliberately.
    """
    lead_time = [
        entry
        for entry in _dependency_summary()
        if entry["kind"] == "external_lead_time"
    ]
    assert len(lead_time) == 2

    research = lead_time[0]
    assert research["path_raw"] == "SYS1-02-n → SYS1-02-p / SYS1-06-b → SYS1-06-d"
    assert research["path_nodes"] == [
        "SYS1-02-n",
        "SYS1-02-p",
        "SYS1-06-b",
        "SYS1-06-d",
    ]
    assert "SYS1-02-o" not in research["path_nodes"]

    assert lead_time[1]["path_nodes"] == [
        "SYS1-05-i",
        "SYS1-05-k",
        "SYS1-05-o",
        "SYS2-13-f",
    ]

    # data-model.md: external_lead_time therefore covers 8 nodes, not 10.
    covered = {node for entry in lead_time for node in entry["path_nodes"]}
    assert len(covered) == 8


def test_parse_dependency_summary_expands_a_stated_range():
    """FR-005: ``SYS1-03-a through -f`` *is* a range, so it does expand to six nodes.

    The counterpart to the arrow rule above, and the reason the two are tested together:
    the distinction is between a notation the source writes as a range and one it writes
    as a sequence, not between "expand" and "do not expand". ``through`` is one of the
    four range spellings ``parse_edge_cell`` already resolves, which is why no second
    resolver is written here.
    """
    parallel = [
        entry for entry in _dependency_summary() if entry["kind"] == "parallel"
    ]
    assert len(parallel) == 2

    competitor = parallel[0]
    assert competitor["path_raw"] == (
        "SYS1-03-a through -f can start partway through SYS1-02"
    )
    assert competitor["path_nodes"] == [
        "SYS1-03-a",
        "SYS1-03-b",
        "SYS1-03-c",
        "SYS1-03-d",
        "SYS1-03-e",
        "SYS1-03-f",
        "SYS1-02",
    ]

    assert parallel[1]["path_raw"] == (
        "SYS2-14 and SYS2-15 run in parallel after SYS2-12-p"
    )
    assert parallel[1]["path_nodes"] == ["SYS2-14", "SYS2-15", "SYS2-12-p"]


def test_parse_dependency_summary_drops_prose_but_keeps_it_in_path_raw():
    """FR-005: prose stating no step yields no node, and stays visible in ``path_raw``.

    The rework-PoC entry ends "→ updates to the requirements list, screens, flows, and
    sequences", which names a set of deliverables rather than a step. It cannot become a
    node — no such row exists — so the verbatim cell is where it remains accounted for.
    """
    rework = [entry for entry in _dependency_summary() if entry["kind"] == "rework"]
    assert len(rework) == 2

    poc = rework[0]
    assert poc["path_raw"] == (
        "SYS2-16-i → SYS2-16-j → updates to the requirements list, screens, flows, and "
        "sequences"
    )
    assert poc["path_nodes"] == ["SYS2-16-i", "SYS2-16-j"]
    assert "updates to the requirements list" in poc["path_raw"]

    assert rework[1]["path_nodes"] == [
        "SYS1-08-h",
        "SYS1-09-b",
        "SYS2-12-f",
        "SYS2-13-e",
    ]


def test_parse_dependency_summary_flag_coverage_matches_the_data_model():
    """FR-005 / FR-015: the three derived flags cover 12, 8 and 5 nodes.

    These are the counts the derived-flag task asserts against, so pinning them at the
    parser means a later disagreement is localised to one side of the boundary.
    """
    entries = _dependency_summary()

    def covered(kind):
        return {
            node
            for entry in entries
            if entry["kind"] == kind
            for node in entry["path_nodes"]
        }

    assert len(covered("critical_path")) == 12
    assert len(covered("external_lead_time")) == 8
    assert len(covered("hard_deadline")) == 5


def test_parse_dependency_summary_path_nodes_are_real_rows():
    """FR-005: every resolved path node names a row that exists in section 4.

    A path node that resolves to nothing is worse than an unresolved cell: it silently
    flags an ID no reader can look up. All 10 entries are checked, and the two activity-
    level targets — ``SYS1-02``, ``SYS2-14``, ``SYS2-15`` — must resolve as L2 rows.
    """
    row_ids = set(_rows_by_id())
    entries = _dependency_summary()

    unresolved = [
        (entry["title"], node)
        for entry in entries
        for node in entry["path_nodes"]
        if node not in row_ids
    ]
    assert unresolved == [], f"path nodes naming no row: {unresolved}"

    all_nodes = {node for entry in entries for node in entry["path_nodes"]}
    assert {"SYS1-02", "SYS2-14", "SYS2-15"} <= all_nodes


def _dependency_rows(path="SYS1-01-a → SYS1-01-b"):
    """One fixture entry's four table rows, in the document's own order."""
    return [
        "| **Content** | fixture content |",
        f"| **Path / target steps** | {path} |",
        "| **Impact if delayed** | fixture impact |",
        "| **What to get ahead of** | fixture mitigation |",
    ]


def _synthetic_dependency_summary(rows, title="Critical path (fixture)"):
    """A minimal section-3 document holding one Dependency Summary entry."""
    return "\n".join(
        [
            "# Fixture",
            "",
            "## 3. Dependency Summary",
            "",
            f"### {title}",
            "",
            "| | |",
            "|---|---|",
            *rows,
            "",
            "---",
            "",
            "## 4. Process List (detailed)",
            "",
        ]
    )


def test_synthetic_dependency_summary_fixture_is_itself_parseable():
    """Guards the hard-failure tests below: the baseline fixture must parse."""
    entries = process_graph.parse_dependency_summary(
        _synthetic_dependency_summary(_dependency_rows())
    )

    assert len(entries) == 1
    assert entries[0]["kind"] == "critical_path"
    assert entries[0]["title"] == "Critical path (fixture)"
    assert entries[0]["path_nodes"] == ["SYS1-01-a", "SYS1-01-b"]


def test_parse_dependency_summary_rejects_an_unknown_entry_kind():
    """FR-021: a heading naming no known kind would be filed under a guessed kind.

    The kinds drive three derived node flags, so a mis-filed entry silently flags the
    wrong rows — which is why an unrecognised heading stops the extraction instead of
    defaulting.
    """
    document = _synthetic_dependency_summary(
        _dependency_rows(), title="Budget contention — vendor capacity"
    )

    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.parse_dependency_summary(document)

    assert "Budget contention" in str(excinfo.value)


def test_parse_dependency_summary_rejects_an_unknown_table_label():
    """FR-021: section 3 gets the same label accounting sections 2 and 4 have."""
    rows = _dependency_rows() + ["| **Owning department** | something new |"]

    with pytest.raises(process_graph.LabelError) as excinfo:
        process_graph.parse_dependency_summary(_synthetic_dependency_summary(rows))

    message = str(excinfo.value)
    assert "Owning department" in message
    assert "Critical path (fixture)" in message


def test_parse_dependency_summary_rejects_a_missing_field():
    """FR-021: all four rows are stated on all 10 entries."""
    rows = [row for row in _dependency_rows() if "Impact if delayed" not in row]

    with pytest.raises(process_graph.LabelError) as excinfo:
        process_graph.parse_dependency_summary(_synthetic_dependency_summary(rows))

    assert "Impact if delayed" in str(excinfo.value)


def test_parse_dependency_summary_rejects_unparsed_block_content():
    """FR-021: a table row the pattern cannot read is flagged, not skipped."""
    rows = _dependency_rows() + ["| **Malformed row with no closing pipe"]

    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.parse_dependency_summary(_synthetic_dependency_summary(rows))

    assert "Malformed row with no closing pipe" in str(excinfo.value)


def test_parse_dependency_summary_rejects_content_before_the_first_entry():
    """FR-021: section 3's preamble holds nothing at all, so a row there belongs to none."""
    document = _synthetic_dependency_summary(_dependency_rows()).replace(
        "## 3. Dependency Summary",
        "## 3. Dependency Summary\n\n| **Content** | stranded ahead of every entry |",
    )

    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.parse_dependency_summary(document)

    assert "stranded ahead of every entry" in str(excinfo.value)


def test_parse_dependency_summary_rejects_a_nested_heading():
    """FR-021: section 3 states its entries at one level, so a ``####`` drops an entry."""
    document = _synthetic_dependency_summary(_dependency_rows()).replace(
        "### Critical path (fixture)", "#### Critical path (fixture)"
    )

    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.parse_dependency_summary(document)

    assert "Critical path (fixture)" in str(excinfo.value)


def test_parse_dependency_summary_rejects_an_unknown_path_notation():
    """FR-021 / FR-008: an unrecognised path token escalates rather than being dropped.

    The connectives and prose fragments the section uses are a closed list, so a revision
    that writes a new one reaches ``parse_edge_cell`` and raises there — the same hard
    failure a new section-4 notation gets, from the same resolver.
    """
    document = _synthetic_dependency_summary(
        _dependency_rows(path="SYS1-01-a → sometimes SYS1-01-b")
    )

    with pytest.raises(process_graph.UnknownNotation) as excinfo:
        process_graph.parse_dependency_summary(document)

    message = str(excinfo.value)
    assert "Critical path (fixture)" in message
    assert "sometimes" in message


def test_parse_dependency_summary_rejects_an_identifier_dropped_with_prose(monkeypatch):
    """FR-021: an ID removed along with a prose fragment is a dropped declared target.

    The prose fragments are a closed list and no ID sits inside one today, so this guard
    cannot fire from the document as it stands. It exists for the revision that extends a
    fragment over an ID: the fragment would still match, the ID would disappear with it,
    and nothing else in the module would notice. Monkeypatching the list simulates that
    revision without touching the read-only source, and the guard compares the identifier
    *tokens* in the cell against the resolved nodes rather than counting them, because a
    range legitimately writes one token and yields six nodes.
    """
    monkeypatch.setattr(
        process_graph,
        "_DEPENDENCY_PATH_PROSE",
        ("updates to SYS2-12-p and the screens",),
    )
    document = _synthetic_dependency_summary(
        _dependency_rows(path="SYS1-01-a → updates to SYS2-12-p and the screens")
    )

    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.parse_dependency_summary(document)

    assert "SYS2-12-p" in str(excinfo.value)


def test_parse_dependency_summary_rejects_a_missing_section():
    """FR-021: no section 3 is a source change, not an empty summary."""
    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.parse_dependency_summary("# Fixture\n\n## 9. Something else\n")

    assert "Dependency Summary" in str(excinfo.value)


# --- Input deliverables and Input source ---------------------------------------------

#: ``PH1``'s Input deliverables cell, verbatim. The outer separator is ";" and the second
#: item's parenthetical holds two commas, so a comma split would shred it into three.
_PH1_INPUTS = (
    "Study theme; higher-level policy (mid-term management plan, connected strategy, "
    "product planning policy); the current plan concept; in-house existing verification "
    "results (if any); market & competitor information"
)

#: ``SYS1-02-r``'s Input deliverables cell, verbatim — the reason the ";" rule exists.
#: Its first item states three deliverable *names* separated by commas at top level, so a
#: comma split would invent two deliverables the source never declares.
_SYS1_02_R_INPUTS = (
    "Updated persona sheet, context matrix, and value statement; JTBD summary table; "
    "usage-motivation & abandonment-factor hypothesis table"
)

#: ``SYS1-01-a``'s Input deliverables cell, verbatim. The common shape: 253 of the 255
#: cells state no ";" and separate their items with a top-level comma.
_SYS1_01_A_INPUTS = (
    "Mid-term management plan, connected-service strategy materials, product planning "
    "policy, the product concept of the target vehicle model"
)

#: ``SYS1-01-c``'s Input source cell, verbatim. " / " separates two sources and the
#: parenthetical belongs to the first.
_SYS1_01_C_INPUT_SOURCE = "Own department (plan concept) / planning owner"

#: ``SYS1-01-b``'s Input source cell, verbatim. 104 of the 255 cells name one source.
_SYS1_01_B_INPUT_SOURCE = "Own department (plan concept)"


def test_parse_inputs_splits_on_the_semicolon_when_the_cell_states_one():
    """FR-002: ";" is the outer separator wherever the source writes one.

    ``PH1`` is one of the two cells that do. Its second item's parenthetical holds two
    commas, so the semicolon is what keeps "higher-level policy (…)" a single deliverable.
    """
    assert process_graph.parse_inputs(_PH1_INPUTS) == [
        "Study theme",
        "higher-level policy (mid-term management plan, connected strategy, product "
        "planning policy)",
        "the current plan concept",
        "in-house existing verification results (if any)",
        "market & competitor information",
    ]


def test_parse_inputs_does_not_split_a_semicolon_cell_on_its_commas():
    """FR-002: ``SYS1-02-r`` is the row that makes the ";" rule load-bearing.

    Its first item — "Updated persona sheet, context matrix, and value statement" — states
    three names inside one deliverable. Splitting the cell on commas as well would invent
    two deliverables, which is the same class of defect ``parse_outputs`` refuses to make.
    """
    assert process_graph.parse_inputs(_SYS1_02_R_INPUTS) == [
        "Updated persona sheet, context matrix, and value statement",
        "JTBD summary table",
        "usage-motivation & abandonment-factor hypothesis table",
    ]


def test_parse_inputs_splits_on_top_level_commas_when_no_semicolon_is_stated():
    """FR-002: the shape 253 of the 255 cells use."""
    assert process_graph.parse_inputs(_SYS1_01_A_INPUTS) == [
        "Mid-term management plan",
        "connected-service strategy materials",
        "product planning policy",
        "the product concept of the target vehicle model",
    ]


def test_parse_inputs_keeps_a_comma_inside_a_parenthetical():
    """FR-002: a comma at parenthesis depth one is not a separator.

    ``SYS1-01``'s cell carries "(if any)" and every other parenthetical in the document is
    a qualifier of the deliverable it follows, never a list of further deliverables.
    """
    assert process_graph.parse_inputs(
        "in-house existing verification results (if any, from advanced development)"
    ) == ["in-house existing verification results (if any, from advanced development)"]


def test_parse_inputs_rejects_an_empty_cell():
    """FR-002 / FR-021: all 255 rows declare at least one input deliverable."""
    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.parse_inputs("   ")

    assert "Input deliverables" in str(excinfo.value)


def test_parse_inputs_rejects_unbalanced_parentheses():
    """FR-021: an unclosed "(" makes the depth wrong for the rest of the cell, which
    merges deliverables instead of separating them."""
    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.parse_inputs(_PH1_INPUTS.replace("(if any)", "(if any"))

    assert "unbalanced" in str(excinfo.value)


def test_parse_input_sources_splits_on_the_spaced_slash():
    """FR-002: " / " separates two sources; the parenthetical stays with its own."""
    assert process_graph.parse_input_sources(_SYS1_01_C_INPUT_SOURCE) == [
        "Own department (plan concept)",
        "planning owner",
    ]


def test_parse_input_sources_keeps_a_single_source_whole():
    """FR-002: 104 of the 255 cells name one source and state no separator at all."""
    assert process_graph.parse_input_sources(_SYS1_01_B_INPUT_SOURCE) == [
        "Own department (plan concept)"
    ]


def test_parse_input_sources_rejects_a_slash_that_is_not_the_documents_separator():
    """FR-021: all 255 cells spell the separator " / ", spaces included.

    A "/" written tight against its neighbours is a spelling the document does not use, so
    it is either part of a source's own name — in which case splitting on it would invent a
    source — or a new separator. Either way it is a human's call, not the extractor's.
    """
    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.parse_input_sources("IVI development/planning department")

    assert "IVI development/planning department" in str(excinfo.value)


def test_parse_input_sources_rejects_an_empty_cell():
    """FR-002 / FR-021: all 255 rows name at least one input source."""
    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.parse_input_sources("")

    assert "Input source" in str(excinfo.value)


def test_input_cells_of_all_255_rows_parse_into_verbatim_items():
    """FR-002: both cells of every row split into non-empty items that are source text.

    The two histograms are measured on the 2026-08-26 revision and pinned exactly, because
    "at least one item" would also pass on a separator rule that merged two items on every
    row.
    """
    text = _process_list()
    rows = process_graph.parse_rows(text)

    inputs_histogram = {}
    sources_histogram = {}
    for row in rows:
        inputs = process_graph.parse_inputs(row["labels"]["Input deliverables"])
        sources = process_graph.parse_input_sources(row["labels"]["Input source"])
        inputs_histogram[len(inputs)] = inputs_histogram.get(len(inputs), 0) + 1
        sources_histogram[len(sources)] = sources_histogram.get(len(sources), 0) + 1

        for item in inputs + sources:
            assert item == item.strip(), f"{row['id']} states an unstripped item {item!r}"
            assert item, f"{row['id']} states an empty item"
            assert item in text, (
                f"{row['id']} states an item that is not literal source text: {item!r}"
            )

    assert inputs_histogram == {1: 6, 2: 51, 3: 115, 4: 59, 5: 11, 6: 5, 7: 4, 8: 3, 10: 1}
    assert sources_histogram == {1: 104, 2: 113, 3: 25, 4: 7, 5: 5, 6: 1}
