"""The dependency-cell resolver: all six notations of research.md R7.

Every cell text quoted below is real text from
``others/20260826_IVI_SYS1-2_Planning_Requirements_Definition_Process_List.md``, not an
invented example, so a rule that only works on a made-up shape cannot pass.

``parse_edge_cell`` resolves **one side** of a ``Predecessor / Successor`` cell — the
target list that follows ``Predecessor:`` or ``Successor:``. Splitting the cell into its
two sides belongs to ``build_edges``, which arrives in a later batch.
"""

import re

import pytest

import process_graph
from conftest import SOURCE_PATHS

#: Non-greedy on the predecessor side: the successor side of ``PH3`` contains a ``/``
#: inside its prose target, so a greedy split would land in the wrong place.
_CELL = re.compile(r"^Predecessor: (?P<pred>.*?) / Successor: (?P<succ>.*)$")


# --- notation 1: full work-item ID -----------------------------------------------


def test_parse_edge_cell_full_work_item_id():
    # SYS1-01-c — Predecessor
    ids, external = process_graph.parse_edge_cell("SYS1-01-a, SYS1-01-b", "SYS1-01-c")
    assert ids == ["SYS1-01-a", "SYS1-01-b"]
    assert external == []


# --- notation 2: activity ID where a work item is expected -----------------------


def test_parse_edge_cell_activity_id_where_work_item_expected():
    # SYS1-04-t — Successor
    ids, external = process_graph.parse_edge_cell(
        "SYS1-05-a, SYS1-06-m, SYS2-10", "SYS1-04-t"
    )
    assert ids == ["SYS1-05-a", "SYS1-06-m", "SYS2-10"]
    assert external == []

    # SYS1-05-o — Successor
    ids, _ = process_graph.parse_edge_cell(
        "SYS1-06-h, SYS1-06-m, SYS1-06-o, SYS2-13", "SYS1-05-o"
    )
    assert ids == ["SYS1-06-h", "SYS1-06-m", "SYS1-06-o", "SYS2-13"]


# --- notation 3: phase ID with a parenthetical -----------------------------------


def test_parse_edge_cell_phase_id_with_parenthetical():
    """Both targets are emitted: the phase the source names and its stated entry step.

    ``PH2 (SYS1-07)`` declares PH2 as the successor and SYS1-07 as where it begins.
    Dropping either would silently discard a declared edge, which invariant 12 forbids.
    """
    # PH1 — Successor
    ids, external = process_graph.parse_edge_cell("PH2 (SYS1-07)", "PH1")
    assert ids == ["PH2", "SYS1-07"]
    assert external == []

    # PH2 — the whole cell, both sides
    ids, _ = process_graph.parse_edge_cell("PH1 (SYS1-06)", "PH2")
    assert ids == ["PH1", "SYS1-06"]
    ids, _ = process_graph.parse_edge_cell("PH3 (SYS2-10)", "PH2")
    assert ids == ["PH3", "SYS2-10"]

    # PH3 — Predecessor
    ids, _ = process_graph.parse_edge_cell("PH2 (SYS1-09)", "PH3")
    assert ids == ["PH2", "SYS1-09"]


# --- notation 4: suffix continuation --------------------------------------------


def test_parse_edge_cell_suffix_continuation():
    """A bare ``-x`` continues the activity prefix of the last full ID in the list."""
    # SYS1-04-t — Predecessor, with the annotation stripped
    ids, external = process_graph.parse_edge_cell(
        "SYS1-04-e, -g, -s (and all other work items)", "SYS1-04-t"
    )
    assert ids == ["SYS1-04-e", "SYS1-04-g", "SYS1-04-s"]
    assert external == []

    # SYS1-05-o — Predecessor
    ids, _ = process_graph.parse_edge_cell("SYS1-05-j, -k, -l, -m, -n", "SYS1-05-o")
    assert ids == [
        "SYS1-05-j",
        "SYS1-05-k",
        "SYS1-05-l",
        "SYS1-05-m",
        "SYS1-05-n",
    ]

    # SYS1-06-o — Predecessor: the prefix switches mid-list, so the tracked prefix
    # must follow the most recent full ID rather than the first one.
    ids, _ = process_graph.parse_edge_cell(
        "SYS1-06-n, -f, -i, SYS1-05-n, -o", "SYS1-06-o"
    )
    assert ids == [
        "SYS1-06-n",
        "SYS1-06-f",
        "SYS1-06-i",
        "SYS1-05-n",
        "SYS1-05-o",
    ]


# --- notation 5: ranges, all four spellings --------------------------------------


def test_parse_edge_cell_range_spelled_through():
    # SYS1-03-o — Predecessor
    ids, external = process_graph.parse_edge_cell("SYS1-03-g through -n", "SYS1-03-o")
    assert ids == [
        "SYS1-03-g",
        "SYS1-03-h",
        "SYS1-03-i",
        "SYS1-03-j",
        "SYS1-03-k",
        "SYS1-03-l",
        "SYS1-03-m",
        "SYS1-03-n",
    ]
    assert external == []


def test_parse_edge_cell_range_spelled_en_dash_without_spaces():
    # SYS2-14-a — Successor
    ids, _ = process_graph.parse_edge_cell("SYS2-14-b–h", "SYS2-14-a")
    assert ids == [
        "SYS2-14-b",
        "SYS2-14-c",
        "SYS2-14-d",
        "SYS2-14-e",
        "SYS2-14-f",
        "SYS2-14-g",
        "SYS2-14-h",
    ]


def test_parse_edge_cell_range_spelled_en_dash_with_spaces():
    # SYS1-07-e — Predecessor
    ids, _ = process_graph.parse_edge_cell("SYS1-07-a – d", "SYS1-07-e")
    assert ids == ["SYS1-07-a", "SYS1-07-b", "SYS1-07-c", "SYS1-07-d"]


def test_parse_edge_cell_range_at_activity_level():
    # SYS1-06 — Predecessor
    ids, _ = process_graph.parse_edge_cell("SYS1-02 – SYS1-05", "SYS1-06")
    assert ids == ["SYS1-02", "SYS1-03", "SYS1-04", "SYS1-05"]

    # SYS2-16 — Predecessor, the same notation without spaces
    ids, _ = process_graph.parse_edge_cell("SYS2-10–SYS2-15", "SYS2-16")
    assert ids == [
        "SYS2-10",
        "SYS2-11",
        "SYS2-12",
        "SYS2-13",
        "SYS2-14",
        "SYS2-15",
    ]


# --- notation 6: prose target ----------------------------------------------------


def test_parse_edge_cell_prose_target():
    """Prose naming nothing in this process becomes an ``external_ref``, never an edge."""
    # SYS2-16 / SYS2-16-p — Successor
    raw = "the following phases (architecture design, vendor selection)"
    ids, external = process_graph.parse_edge_cell(raw, "SYS2-16")
    assert ids == []
    assert external == [raw]

    # PH3 — Successor
    raw = "the subsequent phases (architecture design, vendor selection / SYS.3 onward)"
    ids, external = process_graph.parse_edge_cell(raw, "PH3")
    assert ids == []
    assert external == [raw]


# --- the literal `none` ----------------------------------------------------------


def test_parse_edge_cell_none():
    ids, external = process_graph.parse_edge_cell("none", "PH1")
    assert ids == []
    assert external == []


# --- annotations that are stripped, not resolved ---------------------------------


def test_parse_edge_cell_strips_documented_annotations():
    # SYS1-05-f — Successor: the one back edge the document annotates itself.
    ids, _ = process_graph.parse_edge_cell(
        "SYS1-05-g, SYS1-04-e (revisit)", "SYS1-05-f"
    )
    assert ids == ["SYS1-05-g", "SYS1-04-e"]

    # SYS1-06-q — Successor
    ids, _ = process_graph.parse_edge_cell("SYS1-07-a (start of PH2)", "SYS1-06-q")
    assert ids == ["SYS1-07-a"]

    # SYS1-09 — Successor
    ids, _ = process_graph.parse_edge_cell("SYS2-10 (start of PH3)", "SYS1-09")
    assert ids == ["SYS2-10"]


# --- hard failure and the SYS.3 trap --------------------------------------------


def test_parse_edge_cell_rejects_unknown_notation():
    """FR-021: an unrecognised token stops the extraction; it is never dropped."""
    with pytest.raises(process_graph.UnknownNotation) as excinfo:
        process_graph.parse_edge_cell("SYS1-01-a, ZZ9-42-q", "SYS1-01-b")

    message = str(excinfo.value)
    assert "SYS1-01-b" in message, f"the owning row is not named: {message}"
    assert "ZZ9-42-q" in message, f"the offending text is not quoted: {message}"

    # A near-miss that must not be quietly coerced into the closest known form.
    with pytest.raises(process_graph.UnknownNotation):
        process_graph.parse_edge_cell("SYS3-01-a", "SYS1-01-b")


def test_parse_edge_cell_rejects_a_phase_id_standing_alone():
    """R7's inventory has no bare phase ID, and an unlisted notation is a hard failure.

    The source always writes a phase target with its entry step, as ``PH2 (SYS1-07)``.
    Accepting a bare ``PH2`` would be untested tolerance for a form the document does not
    use; a revision that introduces one should reach the human instead.
    """
    with pytest.raises(process_graph.UnknownNotation):
        process_graph.parse_edge_cell("PH2", "PH1")


def test_parse_edge_cell_rejects_a_leading_suffix_continuation():
    """A suffix continuation continues the last full ID, so it cannot come first.

    Inferring the owning row's own activity would invent a prefix the source never
    states. No cell in the document opens this way.
    """
    with pytest.raises(process_graph.UnknownNotation) as excinfo:
        process_graph.parse_edge_cell("-g, -h", "SYS1-04-t")

    assert "SYS1-04-t" in str(excinfo.value)


def test_sys_dot_three_is_not_an_identifier():
    """FR-008: the ID pattern requires a hyphen, so ``SYS.3`` never becomes a node ID."""
    raw = "the subsequent phases (architecture design, vendor selection / SYS.3 onward)"
    ids, external = process_graph.parse_edge_cell(raw, "PH3")

    assert ids == []
    assert not any("SYS.3" in i for i in ids)
    assert any("SYS.3" in ref for ref in external), "the prose was not retained verbatim"

    # Standing alone it is not an identifier either — it is an unknown notation.
    with pytest.raises(process_graph.UnknownNotation):
        process_graph.parse_edge_cell("SYS.3", "PH3")


# --- the whole document ----------------------------------------------------------


def test_every_dependency_cell_resolves_to_a_known_node():
    """FR-007 / FR-008: all 255 rows' cells resolve with 0 unresolved references.

    This is the measurement that validates the six-notation inventory as complete for
    this revision of the document (research.md R7). A non-zero count means the resolver
    has a gap, not that the token should be swallowed.
    """
    text, _ = process_graph.read_source(SOURCE_PATHS["process_list"])
    rows = process_graph.parse_rows(text)
    known = {row["id"] for row in rows}
    assert len(known) == 255

    unresolved = []
    resolved_total = 0
    prose_total = 0

    for row in rows:
        cell = row["labels"]["Predecessor / Successor"]
        match = _CELL.match(cell)
        assert match is not None, f"{row['id']} has an unrecognised cell shape: {cell!r}"

        for side in ("pred", "succ"):
            ids, external = process_graph.parse_edge_cell(
                match.group(side), row["id"]
            )
            resolved_total += len(ids)
            prose_total += len(external)
            unresolved.extend(
                (row["id"], side, ref) for ref in ids if ref not in known
            )

    assert unresolved == [], f"{len(unresolved)} unresolved references: {unresolved[:10]}"
    assert resolved_total > 0
    assert prose_total == 3, "the document states exactly three prose dependency targets"
