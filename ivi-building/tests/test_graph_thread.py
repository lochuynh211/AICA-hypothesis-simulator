"""The Dependency Summary's stated critical path, checked against the extracted edges.

This is H0's primary extraction test: the source document states, independently of its own
dependency cells, which twelve steps form the critical path. If the edges built from those
cells cannot walk that path, the extraction is wrong somewhere it would otherwise take a human
reading 255 rows to notice.

The thread computation — ``goal_relevant``, ``on_thread`` and the ``thread`` block — is a later
batch and is deliberately absent from this file.
"""

import pytest

import graph_query

#: The 12 steps the Dependency Summary's critical-path entry names, in its own order. Quoted
#: from the document so a regression in the entry itself is visible here, and cross-checked
#: against the extracted entry by ``test_the_stated_critical_path_is_the_documents_own``.
STATED_CRITICAL_PATH = [
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

#: 12 steps make 11 consecutive hops.
_HOPS = len(STATED_CRITICAL_PATH) - 1


def _hops():
    """The 11 consecutive ``(from, to)`` pairs of the stated path."""
    return list(zip(STATED_CRITICAL_PATH, STATED_CRITICAL_PATH[1:]))


def test_the_stated_critical_path_is_the_documents_own(graph):
    """The 12 steps above are the ones the extracted Dependency Summary entry states.

    Without this, the two tests below would be measuring a path this file invented.
    """
    entries = [
        entry
        for entry in graph.dependency_summary
        if entry["kind"] == "critical_path"
    ]

    assert len(entries) == 1
    assert entries[0]["path_nodes"] == STATED_CRITICAL_PATH
    assert entries[0]["title"] == "Critical path (main series)"


def test_stated_critical_path_is_reachable(graph):
    """FR-012 / SC-004: all 11 consecutive hops of the stated critical path are reachable.

    **Reachability, not adjacency, is the correct assertion here, because 0 of the 11 hops is
    an adjacent edge.** The document's dependency cells name the *first* work item of each
    downstream activity as a successor, never the last: ``SYS1-01-o`` declares
    ``SYS1-02-a, SYS1-03-a, SYS1-05-a, SYS1-06-a``, so the hop to ``SYS1-02-r`` runs through
    that activity's own internal chain rather than over one edge. An adjacency assertion would
    therefore fail on a correct extraction, and weakening it *after* seeing it fail would be
    the wrong repair. ``test_no_critical_path_hop_is_adjacent`` pins the 0-of-11 measurement so
    this reasoning is itself under test rather than only stated here.

    Reachability is over ``forward`` edges only: the one ``revisit`` edge the document
    annotates is a back edge, and admitting it would let the walk reach a step by going
    backwards, which is not what a critical path claims.
    """
    unreachable = [
        (source, target)
        for source, target in _hops()
        if target not in graph.reachable_from(source)
    ]

    assert unreachable == [], (
        f"{len(unreachable)} of {_HOPS} stated critical-path hops are not reachable over "
        f"forward edges: {unreachable}"
    )


def test_no_critical_path_hop_is_adjacent(graph):
    """SC-004: 0 of the 11 hops is a single declared edge — the measurement above's reason.

    Pinned as a number rather than left in a comment: if a future revision of the source
    started declaring last-item-to-next-activity successors, this test fails and tells the
    reader that the reachability assertion above could be tightened. A comment would not.
    """
    adjacent = [
        (source, target)
        for source, target in _hops()
        if target in graph.successors(source)
    ]

    assert len(_hops()) == _HOPS == 11
    assert adjacent == [], (
        f"{len(adjacent)} of {_HOPS} stated critical-path hops are adjacent edges, so the "
        f"reachability assertion in test_stated_critical_path_is_reachable could be "
        f"tightened for them: {adjacent}"
    )

    # The reason: the first work item of the next activity is declared, not the last one the
    # path names. Both are quoted from SYS1-01-o's own cell.
    declared = graph.successors("SYS1-01-o")
    assert "SYS1-02-a" in declared
    assert "SYS1-02-r" not in declared


def test_reachability_is_not_vacuous(graph):
    """Guards the two tests above: an empty edge index would make both pass trivially.

    ``reachable_from`` returning nothing would satisfy ``unreachable == []``'s inverse only by
    accident, but ``adjacent == []`` would pass on an empty graph, so the walk is shown to
    reach real distances here.
    """
    with pytest.raises(graph_query.GraphQueryError):
        graph.reachable_from("SYS9-99-z")

    # The first step of the path reaches every later step, and then some.
    #
    # 228 is measured, and it is not the count this test was first written with: 213 is the
    # closure of ``SYS1-02-o``, one activity over, and the number was transcribed from the
    # wrong row. The measurement is 221 of the document's 236 work items plus the 7
    # activities SYS2-10 to SYS2-16, which the document names at activity level in its own
    # range notation. The 26 nodes left out are SYS1-01's own work items, the three phases,
    # and the activity rows nothing downstream of this step declares.
    reached = graph.reachable_from(STATED_CRITICAL_PATH[0])
    assert set(STATED_CRITICAL_PATH[1:]) <= reached
    assert len(reached) == 228

    # The document's last row reaches nothing, which is the other end of the same guard: a
    # closure that answered "everything" would pass the assertion above too. Measured, the
    # document has exactly three sinks — PH3, SYS2-16 and SYS2-16-p — and this is the last
    # of its 236 work items. It is a sink over the *union* of both declaration directions,
    # so this is not one cell's successor side happening to be empty. Note the stated
    # critical path ends one row earlier, at SYS2-16-n, which does reach SYS2-16-o and
    # SYS2-16-p.
    assert graph.reachable_from("SYS2-16-p") == set()
