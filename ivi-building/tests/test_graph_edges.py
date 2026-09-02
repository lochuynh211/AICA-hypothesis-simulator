"""The dependency-cell resolver: all six notations of research.md R7.

Every cell text quoted below is real text from
``others/20260826_IVI_SYS1-2_Planning_Requirements_Definition_Process_List.md``, not an
invented example, so a rule that only works on a made-up shape cannot pass.

``parse_edge_cell`` resolves **one side** of a ``Predecessor / Successor`` cell — the
target list that follows ``Predecessor:`` or ``Successor:``. ``split_edge_cell`` divides the
cell into those two sides and attributes the source's ``(revisit)`` annotation to the target
it names; ``build_edges`` unions the two declaration directions into the edge list.
"""

import collections
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


def test_parse_edge_cell_rejects_prose_that_hides_an_identifier():
    """FR-021: prose is a *no-target* form, so an ID inside it is a contradiction.

    Neither real prose cell names anything in this process — that is what makes them
    prose. A revision that puts an ID inside one is stating a dependency, and resolving
    it to an ``external_ref`` would drop that declared target with no hard failure.
    """
    for raw in (
        "the following phases (SYS1-07)",
        "the following phases (architecture design, SYS2-16-b onward)",
        "the subsequent phases (PH3)",
    ):
        with pytest.raises(process_graph.UnknownNotation) as excinfo:
            process_graph.parse_edge_cell(raw, "SYS2-16")
        assert "SYS2-16" in str(excinfo.value)

    # The two real prose cells name nothing in this process and must still resolve.
    ids, external = process_graph.parse_edge_cell(
        "the following phases (architecture design, vendor selection)", "SYS2-16"
    )
    assert (ids, external) == (
        [],
        ["the following phases (architecture design, vendor selection)"],
    )


def test_parse_edge_cell_rejects_a_malformed_compound_suffix():
    """An unlisted spelling is escalated, never normalised into plausible IDs.

    ``-g-h`` is not a notation R7 inventories. Reading it as two suffix continuations
    would invent two IDs from a shape no human wrote deliberately.
    """
    for raw in ("SYS1-04-e, -g-h", "SYS1-04-e-h", "SYS1-04-e, -g-"):
        with pytest.raises(process_graph.UnknownNotation) as excinfo:
            process_graph.parse_edge_cell(raw, "SYS1-04-t")
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

    # Pinned, not merely non-zero: this total encodes every expansion decision the
    # resolver makes — range expansion at both levels, `PH2 (SYS1-07)` yielding two
    # targets, per-side dedup — and the edge count and asymmetry count both derive from
    # it. A regression that halved it would survive a `> 0` assertion.
    assert resolved_total == 1147
    assert prose_total == 3, "the document states exactly three prose dependency targets"


# --- the cell split -------------------------------------------------------------------


def test_split_edge_cell_separates_the_two_sides():
    """The cell's two sides, split on the document's own ``/ Successor:`` marker.

    ``PH3``'s cell is what makes the split non-trivial: its prose successor target writes a
    second ``/`` inside a parenthetical, so a split on *any* ``/`` would cut the prose in
    half and lose part of a declared target.
    """
    # SYS1-02-b — the suffix continuation on the predecessor side.
    sides = process_graph.split_edge_cell(
        "Predecessor: SYS1-02-a, SYS1-01-e, -h / Successor: SYS1-02-c, SYS1-02-m",
        "SYS1-02-b",
    )
    assert sides["predecessors"] == ["SYS1-02-a", "SYS1-01-e", "SYS1-01-h"]
    assert sides["successors"] == ["SYS1-02-c", "SYS1-02-m"]
    assert sides["external_refs"] == []
    assert sides["revisit"] == set()

    # PH3 — the cell whose successor side states a "/" inside its prose target.
    sides = process_graph.split_edge_cell(
        "Predecessor: PH2 (SYS1-09) / Successor: the subsequent phases "
        "(architecture design, vendor selection / SYS.3 onward)",
        "PH3",
    )
    assert sides["predecessors"] == ["PH2", "SYS1-09"]
    assert sides["successors"] == []
    assert sides["external_refs"] == [
        "the subsequent phases (architecture design, vendor selection / SYS.3 onward)"
    ]


def test_split_edge_cell_attributes_the_revisit_annotation_to_its_target():
    """SYS1-05-f states the document's one ``(revisit)``, and it names its own target.

    ``parse_edge_cell`` strips the annotation before tokenising, so the classification has to
    be read off the verbatim side. The pair is directed the way the side declares it: on the
    successor side the owning row is the ``from``.
    """
    sides = process_graph.split_edge_cell(
        "Predecessor: SYS1-05-e / Successor: SYS1-05-g, SYS1-04-e (revisit)",
        "SYS1-05-f",
    )
    assert sides["successors"] == ["SYS1-05-g", "SYS1-04-e"]
    assert sides["revisit"] == {("SYS1-05-f", "SYS1-04-e")}


def test_split_edge_cell_rejects_a_cell_stating_only_one_side():
    """FR-021: a cell shape the split cannot read would lose one whole side of it.

    Hand-written, because all 255 real cells state both sides — which
    ``test_every_edge_cell_states_both_sides`` measures.
    """
    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.split_edge_cell("Predecessor: SYS1-01-a", "SYS1-01-b")

    message = str(excinfo.value)
    assert "SYS1-01-b" in message, f"the owning row is not named: {message}"
    assert "Successor" in message, f"the missing marker is not named: {message}"

    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.split_edge_cell("Successor: SYS1-01-c", "SYS1-01-b")

    assert "Predecessor" in str(excinfo.value)


def test_split_edge_cell_rejects_a_revisit_annotation_it_cannot_attribute():
    """FR-021: an annotation the split cannot pin to a target would silently downgrade a
    ``revisit`` edge to a ``forward`` one, which the topological sort then places.

    ``parse_edge_cell`` strips ``(revisit)`` wherever it appears, so nothing downstream would
    notice. Hand-written, because the real document states the annotation only in the one
    shape this extractor reads — the test below is what guards that.
    """
    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.split_edge_cell(
            "Predecessor: none / Successor: (revisit) SYS1-04-e", "SYS1-05-f"
        )

    message = str(excinfo.value)
    assert "SYS1-05-f" in message, f"the owning row is not named: {message}"
    assert "revisit" in message, f"the annotation is not named: {message}"


def test_the_revisit_fixture_shape_is_the_one_the_document_states():
    """Guards the hard-failure test above: the same annotation written the document's way is
    attributed rather than rejected, so that test cannot pass for the wrong reason."""
    sides = process_graph.split_edge_cell(
        "Predecessor: none / Successor: SYS1-04-e (revisit)", "SYS1-05-f"
    )

    assert sides["revisit"] == {("SYS1-05-f", "SYS1-04-e")}


def test_every_edge_cell_states_both_sides():
    """All 255 cells are the shape ``split_edge_cell`` reads, and only one states ``(revisit)``.

    The sweep is what makes the two hand-written fixtures above legitimate: the shapes they
    exercise are absent from the real document, so nothing but a fixture can reach the guard.
    """
    text, _ = process_graph.read_source(SOURCE_PATHS["process_list"])
    rows = process_graph.parse_rows(text)

    annotated = [
        row["id"]
        for row in rows
        if "(revisit)" in row["labels"]["Predecessor / Successor"]
    ]
    assert annotated == ["SYS1-05-f"]

    revisit_pairs = set()
    for row in rows:
        sides = process_graph.split_edge_cell(
            row["labels"]["Predecessor / Successor"], row["id"]
        )
        assert sides["predecessors"] or sides["successors"] or sides["external_refs"], (
            f"{row['id']} resolved to nothing at all"
        )
        revisit_pairs |= sides["revisit"]

    assert revisit_pairs == {("SYS1-05-f", "SYS1-04-e")}


# --- the assembled edge list ----------------------------------------------------------

#: The union of both declaration directions over the document's 1147 stated targets.
_TOTAL_EDGES = 681


def test_every_edge_endpoint_resolves(graph):
    """FR-009 / SC-003: all 681 edges, with 0 endpoints naming no node.

    The total is pinned rather than merely non-zero because it encodes the union: the
    document states 1147 targets across the two sides of its 255 cells, and 681 distinct
    directed pairs is what is left once the two declaration directions are merged. A
    regression that dropped one side entirely would still leave every endpoint resolving.
    """
    edges = graph.edges
    assert len(edges) == _TOTAL_EDGES

    known = {node["id"] for node in graph.nodes}
    unresolved = [
        (edge["from"], edge["to"], endpoint)
        for edge in edges
        for endpoint in (edge["from"], edge["to"])
        if endpoint not in known
    ]
    assert unresolved == [], f"{len(unresolved)} unresolved endpoints: {unresolved[:10]}"

    # Sorted the way the contract states, so a review diff of the artifact is readable.
    keys = [(edge["from"], edge["to"], edge["kind"]) for edge in edges]
    assert keys == sorted(keys)
    assert len(set(keys)) == _TOTAL_EDGES, "the union left a duplicated directed pair"

    # Every edge carries the cell it came from, verbatim.
    for edge in edges:
        assert edge["raw"].startswith("Predecessor: "), edge


def test_exactly_one_revisit_edge(graph):
    """FR-011 / SC-006: the source annotates exactly one back edge, and only that one.

    ``SYS1-05-f``'s cell reads ``Successor: SYS1-05-g, SYS1-04-e (revisit)``. The
    classification is the document's own statement, never this extractor's inference: an edge
    the source does not annotate stays ``forward`` even where it points backwards through the
    row order.
    """
    revisits = [edge for edge in graph.edges if edge["kind"] == "revisit"]

    assert len(revisits) == 1
    assert (revisits[0]["from"], revisits[0]["to"]) == ("SYS1-05-f", "SYS1-04-e")
    assert "(revisit)" in revisits[0]["raw"]

    forward = [edge for edge in graph.edges if edge["kind"] == "forward"]
    assert len(forward) == _TOTAL_EDGES - 1


def test_declared_by_is_recorded(graph):
    """FR-010: every edge records which side of the source declared it.

    The distribution is pinned, not just its domain: the whole point of unioning both
    directions is that the document states most dependencies once, and 215 of the 681 edges
    being one-directional is the measurement that says so. Repairing them is forbidden —
    filling in the missing direction would assert a dependency the source states one way
    only.
    """
    counted = collections.Counter(edge["declared_by"] for edge in graph.edges)

    assert set(counted) == {"successor", "predecessor", "both"}
    assert counted == {"both": 466, "predecessor": 129, "successor": 86}
    assert counted["predecessor"] + counted["successor"] == 215


def test_prose_targets_become_node_external_refs(graph):
    """FR-009: a prose target is recorded on the node and is never an edge.

    Three of the document's stated targets name nothing inside this process. They are kept on
    the node whose cell declared them, because dropping them would lose a stated dependency
    and resolving them would invent a node.
    """
    carried = {
        node["id"]: node["external_refs"]
        for node in graph.nodes
        if node["external_refs"]
    }

    assert carried == {
        "PH3": [
            "the subsequent phases (architecture design, vendor selection / SYS.3 onward)"
        ],
        "SYS2-16": ["the following phases (architecture design, vendor selection)"],
        "SYS2-16-p": ["the following phases (architecture design, vendor selection)"],
    }
    assert all(
        node["external_refs"] == []
        for node in graph.nodes
        if node["id"] not in carried
    )
    assert not any(
        "phases" in edge["from"] or "phases" in edge["to"] for edge in graph.edges
    )


# --- traversal ------------------------------------------------------------------------


def test_successors_and_predecessors_read_the_union(graph):
    """FR-012: a neighbour set holds every declared dependency, from either direction.

    ``SYS1-01-a``'s own cell declares three successors — ``SYS1-01-b, SYS1-01-c, SYS1-06-g``.
    ``SYS1-01-j`` is a fourth, declared from the other side: its cell names ``SYS1-01-a`` as a
    predecessor and nothing names it as ``SYS1-01-a``'s successor. A traversal that read only
    the successor declarations would miss it, which is what the union exists to prevent.
    """
    assert graph.successors("SYS1-01-a") == {
        "SYS1-01-b",
        "SYS1-01-c",
        "SYS1-01-j",
        "SYS1-06-g",
    }
    assert "SYS1-01-j" not in graph.node("SYS1-01-a")["predecessors_raw"]

    # The document's first work item has no predecessor, and its last has no successor.
    assert graph.predecessors("SYS1-01-a") == set()
    assert graph.successors("SYS2-16-p") == set()
    assert graph.predecessors("SYS2-16-p") == {"SYS2-16-n", "SYS2-16-o"}


def test_traversal_excludes_the_revisit_edge_unless_asked_for_it(graph):
    """FR-011 / FR-012: ``forward`` is the default, and ``all`` is how the back edge is seen.

    ``SYS1-05-f``'s cell declares four successors and annotates one of them ``(revisit)``. The
    default answer holds the other three, because ordering and thread computation are over
    forward edges; the annotated one is reachable only by asking for it, so it is recorded and
    still queryable rather than dropped.
    """
    assert graph.successors("SYS1-05-f") == {
        "SYS1-05-g",
        "SYS1-09-c",
        "SYS2-10-f",
    }
    assert graph.successors("SYS1-05-f", kind="all") == {
        "SYS1-04-e",
        "SYS1-05-g",
        "SYS1-09-c",
        "SYS2-10-f",
    }
    assert "SYS1-05-f" not in graph.predecessors("SYS1-04-e")
    assert "SYS1-05-f" in graph.predecessors("SYS1-04-e", kind="all")


def test_traversal_rejects_an_unknown_kind_and_an_unknown_node(graph):
    """An empty answer to a mistyped argument would read as a fact about the document."""
    import graph_query

    with pytest.raises(graph_query.GraphQueryError) as excinfo:
        graph.successors("SYS1-01-a", kind="forwards")
    assert "forwards" in str(excinfo.value)

    for query in (graph.successors, graph.predecessors, graph.reachable_from,
                  graph.ancestors_of):
        with pytest.raises(graph_query.GraphQueryError):
            query("SYS9-99-z")


def test_reachable_from_and_ancestors_of_are_transitive_and_exclude_self(graph):
    """FR-012: the closures the thread computation is defined over.

    ``goal_relevant`` is "an ancestor of a terminal node, or a terminal itself", so the closure
    must **exclude** the start node — the "or itself" in that definition is what adds it back,
    and a closure that included it would make the clause meaningless.
    """
    # PH1 -> PH2 -> PH3 is the L1 chain, stated as `PH2 (SYS1-07)` and `PH3 (SYS2-10)`.
    assert graph.successors("PH1") == {"PH2", "SYS1-07"}
    assert {"PH2", "PH3"} <= graph.reachable_from("PH1")
    assert "PH1" not in graph.reachable_from("PH1")

    assert graph.ancestors_of("PH3") >= {"PH1", "PH2"}
    assert "PH3" not in graph.ancestors_of("PH3")

    # The document's first work item is nobody's descendant.
    assert graph.ancestors_of("SYS1-01-a") == set()

    # A one-hop neighbour is in the closure, and so is a two-hop one.
    assert graph.successors("SYS1-01-a") <= graph.reachable_from("SYS1-01-a")
    assert "SYS1-01-o" in graph.reachable_from("SYS1-01-a")


def test_forward_graph_topologically_sorts(graph):
    """FR-012 / SC-005: ``topo_order()`` places all 255 nodes over ``forward`` edges.

    The regression guard is the contrast: including the one ``revisit`` edge, only **71** of the
    255 nodes place. That is what makes excluding it load-bearing rather than cosmetic — a
    single annotated back edge puts 184 nodes inside a cycle, so an extractor that classified it
    ``forward`` would publish an artifact no consumer could order at all.
    """
    import graph_query

    order = graph.topo_order()
    assert len(order) == 255
    assert len(set(order)) == 255
    assert set(order) == {node["id"] for node in graph.nodes}

    # Document order is the tie-break, so the first row of the document places first.
    assert order[0] == "PH1"

    position = {node_id: index for index, node_id in enumerate(order)}
    out_of_order = [
        (edge["from"], edge["to"])
        for edge in graph.edges
        if edge["kind"] == "forward"
        and position[edge["from"]] > position[edge["to"]]
    ]
    assert out_of_order == [], f"{len(out_of_order)} forward edges run backwards"

    with pytest.raises(graph_query.CycleError) as excinfo:
        graph.topo_order(kind="all")

    assert len(excinfo.value.placed) == 71
    assert len(excinfo.value.unplaceable) == 184
    assert len(excinfo.value.placed) + len(excinfo.value.unplaceable) == 255

    # The nodes the back edge strands include both of its own endpoints.
    assert {"SYS1-04-e", "SYS1-05-f"} <= set(excinfo.value.unplaceable)
    assert "SYS1-05-f" in str(excinfo.value)


def test_topo_order_is_deterministic(graph):
    """Two sorts of the same graph agree, so nothing downstream depends on set iteration."""
    assert graph.topo_order() == graph.topo_order()


def test_build_graph_rejects_a_remaining_forward_edge_cycle(monkeypatch):
    """FR-021: forward edges that do not sort stop the extraction; they are never a finding.

    An artifact carrying a forward cycle cannot be ordered by anything that reads it, so
    recording the observation would move the failure to the first consumer rather than
    prevent it — and repairing it would mean deciding which declared dependency to
    disbelieve.

    The real document sorts, which is what ``test_forward_graph_topologically_sorts``
    measures, so the only way to reach this guard is to inject the defect. Monkeypatching the
    edge builder is the same technique, and for the same reason, as
    ``test_parse_dependency_summary_rejects_an_identifier_dropped_with_prose``: the shape does
    not exist in the source, so nothing but a fixture can reach the check.
    """
    stated = process_graph.build_edges

    def with_an_unannotated_back_edge(rows):
        # SYS1-01-o -> SYS1-02-a is declared; this is its reverse, classified `forward`
        # exactly as an unannotated back edge in a revised document would be.
        return stated(rows) + [
            {
                "from": "SYS1-02-a",
                "to": "SYS1-01-o",
                "kind": "forward",
                "declared_by": "successor",
                "raw": "Predecessor: fixture / Successor: fixture",
            }
        ]

    monkeypatch.setattr(process_graph, "build_edges", with_an_unannotated_back_edge)

    process_list, _ = process_graph.read_source(SOURCE_PATHS["process_list"])
    application_map, _ = process_graph.read_source(SOURCE_PATHS["application_map"])

    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.build_graph(process_list, application_map)

    message = str(excinfo.value)
    assert "SYS1-01-o" in message, f"an endpoint of the cycle is not named: {message}"
    assert "SYS1-02-a" in message, f"an endpoint of the cycle is not named: {message}"
    assert "revisit" in message, (
        "the message does not say that an unannotated back edge is one way to cause this: "
        f"{message}"
    )
