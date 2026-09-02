"""Read path for the extracted IVI process graph.

Loads ``graph/process_graph.json`` and answers questions about it. **This is the only
way later milestones read the process graph**: no consumer re-parses the source
documents, so a question about the process is answered from one extraction that a human
reviewed rather than from a second parser nobody tested.

Load and query only — no parsing, no deriving, no writing. Producing the artifact belongs
to ``process_graph.py``, and keeping the two apart is what lets the test suite and H3's
run auditor read the graph through the same code.

Two module-wide rules, the same ones the extractor follows:

* **The default path resolves from this file's own location**, never from the working
  directory, so a caller in ``ivi-building/`` and one in the repository root read the same
  file.
* **UTF-8 is pinned on the read.** The console default on this platform is cp932, under
  which a bare ``open()`` on the artifact raises ``UnicodeDecodeError`` — the artifact
  holds Japanese, because the source documents do.

Traversal — ``successors``, ``predecessors``, ``reachable_from``, ``ancestors_of`` and
``topo_order`` — reads the ``edges`` block, which the extractor populates. ``findings()``
and ``thread`` are **not here yet**: they read the ``findings`` and ``thread`` blocks,
which the extractor does not populate until later batches. An accessor over an empty
container would answer every question with "nothing", which is a wrong answer rather than
a missing one, so it is absent instead.

Every traversal takes ``kind``, and its default is ``forward``. That is not a convenience:
the source document annotates one back edge, and admitting it strands 184 of the 255 nodes
inside a cycle, so a default of ``all`` would make ``topo_order`` fail for every caller
that did not know to ask otherwise. ``all`` exists because the back edge is *recorded*
rather than dropped, and a recorded edge no query can reach is not recorded at all.
"""

from __future__ import annotations

import heapq
import json
from pathlib import Path

HARNESS_ROOT = Path(__file__).resolve().parents[1]

#: The committed artifact, resolved from this file's location.
DEFAULT_ARTIFACT_PATH = HARNESS_ROOT / "graph" / "process_graph.json"

#: The command that produces the artifact, named in the error a missing one raises: it is
#: the only remedy, so the message states it rather than leaving a reader to work it out.
_EXTRACTOR_COMMAND = "python ivi-building/lib/process_graph.py"

#: The three levels every node carries. A level outside them is a hard failure rather than
#: an empty answer.
LEVELS = ("L1", "L2", "L3")

#: The two edge kinds the artifact declares. An edge outside them is a hard failure: a
#: traversal that quietly ignored it would answer with a subgraph and look like it answered
#: about the whole document.
EDGE_KINDS = ("forward", "revisit")

#: The edge keys every traversal reads. ``declared_by`` and ``raw`` are not among them — they
#: are recorded observations rather than traversal inputs — so an artifact is not rejected for
#: a key no query here consults.
_EDGE_KEYS = frozenset({"from", "to", "kind"})

#: The edge kinds each traversal kind walks. ``forward`` is every query's default, because
#: ordering, reachability and the thread computation are all defined over the forward
#: dependencies only; ``all`` admits the ``revisit`` back edge the source annotates, so the
#: recorded edge stays queryable rather than being recorded and then unreachable.
#:
#: ``all`` is derived from ``EDGE_KINDS`` rather than listed, so an edge kind added to the
#: artifact cannot be left out of it — which would silently narrow every "whole graph"
#: answer to a subgraph while still calling itself ``all``.
TRAVERSAL_KINDS = {
    "forward": frozenset({"forward"}),
    "all": frozenset(EDGE_KINDS),
}

#: The kind every traversal walks unless the caller states another.
DEFAULT_TRAVERSAL_KIND = "forward"


class GraphQueryError(Exception):
    """The artifact is unreadable, or a query names something it does not hold."""


class CycleError(GraphQueryError):
    """A topological sort could not place every node, because a cycle remains.

    Carries both halves of the measurement rather than only the failure: ``placed`` is the
    order the sort got to, in the order it placed them, and ``unplaceable`` is every node
    left over, in the source document's own row order. Both are needed to act on it — the
    count says how much of the graph the cycle strands, and the list says where to look.
    """

    def __init__(self, message, placed, unplaceable):
        super().__init__(message)
        self.placed = placed
        self.unplaceable = unplaceable


def load(path=None):
    """Load the artifact and return a :class:`Graph`.

    ``path`` defaults to the committed ``graph/process_graph.json``. Every failure becomes
    a ``GraphQueryError`` naming the file, because the caller is usually a test or a skill
    for which a traceback out of ``json`` is not an actionable message.
    """
    path = Path(DEFAULT_ARTIFACT_PATH if path is None else path)

    if not path.is_file():
        raise GraphQueryError(
            f"the process graph {path} does not exist; generate it with "
            f"`{_EXTRACTOR_COMMAND}`"
        )

    try:
        artifact = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise GraphQueryError(
            f"the process graph {path} is not readable JSON: {error}; it is generated, so "
            f"regenerate it with `{_EXTRACTOR_COMMAND}` rather than repairing it by hand"
        ) from error

    return Graph(artifact)


class Graph:
    """The loaded artifact, indexed for lookup by ID and by level.

    Both indexes are built once in the constructor, so every guard fires at load time
    rather than on the unlucky query that happens to touch a malformed node.
    """

    def __init__(self, artifact):
        if not isinstance(artifact, dict):
            raise GraphQueryError(
                "the process graph is not a JSON object, so it holds no nodes at all"
            )

        nodes = artifact.get("nodes")
        if not isinstance(nodes, list) or not nodes:
            raise GraphQueryError(
                "the process graph states no 'nodes' list, so every query would answer "
                "'nothing' about a document that has 255 rows"
            )

        by_id = {}
        by_level = {level: [] for level in LEVELS}
        for position, node in enumerate(nodes):
            if not isinstance(node, dict) or "id" not in node or "level" not in node:
                raise GraphQueryError(
                    f"the node at position {position} of the process graph states no 'id' "
                    f"or no 'level': {node!r}"
                )

            node_id, level = node["id"], node["level"]
            if node_id in by_id:
                raise GraphQueryError(
                    f"the process graph states the node {node_id!r} twice, so every lookup "
                    "of it would be ambiguous"
                )
            if level not in by_level:
                raise GraphQueryError(
                    f"the node {node_id!r} is at level {level!r}, which is none of {LEVELS}"
                )

            by_id[node_id] = node
            by_level[level].append(node)

        # The whole artifact is retained, not just the nodes: it also holds ``meta``, the
        # dependency summary and the three blocks the traversal accessors will read. A
        # loader that kept only what it currently answers questions about would drop the
        # rest of the extraction on the read path.
        self._artifact = artifact
        self._nodes = nodes
        self._by_id = by_id
        self._by_level = by_level
        self._edges = self._checked_edges(artifact)
        self._dependency_summary = self._checked_dependency_summary(artifact)

        # A node's position in the source document, which is every traversal's tie-break:
        # two nodes ready at the same moment are placed in the order the document states
        # them, so an order is reproducible instead of following set iteration.
        self._position = {node["id"]: position for position, node in enumerate(nodes)}
        self._successor_index = self._neighbour_indexes("from", "to")
        self._predecessor_index = self._neighbour_indexes("to", "from")

    def _checked_edges(self, artifact):
        """Validate the ``edges`` block at load time and return it.

        Every guard here fires once, on load, rather than on the unlucky traversal that
        happens to touch a malformed edge. An endpoint naming no node is the one that
        matters most: a traversal would walk into an ID no reader can look up, and every
        answer downstream of it would be about a document this one is not.
        """
        edges = artifact.get("edges")
        if not isinstance(edges, list):
            raise GraphQueryError(
                "the process graph states no 'edges' list, so every traversal would answer "
                "'nothing' about a document that declares dependencies on all 255 rows"
            )

        for position, edge in enumerate(edges):
            if not isinstance(edge, dict) or not _EDGE_KEYS.issubset(edge):
                raise GraphQueryError(
                    f"the edge at position {position} of the process graph does not state "
                    f"{sorted(_EDGE_KEYS)}: {edge!r}"
                )
            if edge["kind"] not in EDGE_KINDS:
                raise GraphQueryError(
                    f"the edge {edge['from']!r} -> {edge['to']!r} is of kind "
                    f"{edge['kind']!r}, which is none of {EDGE_KINDS}"
                )
            for role in ("from", "to"):
                if edge[role] not in self._by_id:
                    raise GraphQueryError(
                        f"the edge {edge['from']!r} -> {edge['to']!r} states the {role} "
                        f"endpoint {edge[role]!r}, which the process graph holds no node "
                        "for, so a traversal would walk into an ID no reader can look up"
                    )

        return edges

    def _checked_dependency_summary(self, artifact):
        """Validate the ``dependency_summary`` block at load time and return it.

        The block states the source document's own claims about its dependencies — the
        critical path among them — and those claims are what the extraction is checked
        against. A missing block would turn every such check into "the document claims
        nothing", which passes while measuring nothing at all.
        """
        summary = artifact.get("dependency_summary")
        if not isinstance(summary, list):
            raise GraphQueryError(
                "the process graph states no 'dependency_summary' list, so the document's "
                "own claims about its dependencies could not be read back at all"
            )
        return summary

    def _neighbour_indexes(self, role_from, role_to):
        """One neighbour index per traversal kind, keyed by node ID.

        ``role_from``/``role_to`` are the edge keys read as origin and neighbour, so the
        successor and predecessor indexes are the same code walked in opposite directions —
        a second implementation of one of them could disagree with the other about the
        union.

        Every node gets an entry, including one with no neighbours: a node absent from the
        index would raise ``KeyError`` on a query about a node the artifact does hold, which
        sends a reader looking for a missing node rather than for an empty answer.
        """
        indexes = {}
        for kind, edge_kinds in TRAVERSAL_KINDS.items():
            index = {node_id: set() for node_id in self._by_id}
            for edge in self._edges:
                if edge["kind"] in edge_kinds:
                    index[edge[role_from]].add(edge[role_to])
            indexes[kind] = index
        return indexes

    def _checked_kind(self, kind):
        """Return ``kind``, or raise naming it and the kinds that exist.

        An unrecognised kind must never answer: ``successors(node, kind="forwards")``
        returning an empty set reads as a fact about the document rather than as a typo.
        """
        if kind not in TRAVERSAL_KINDS:
            raise GraphQueryError(
                f"{kind!r} is not one of the traversal kinds this graph walks "
                f"{tuple(TRAVERSAL_KINDS)}"
            )
        return kind

    @property
    def nodes(self):
        """Every node, in the source document's own row order."""
        return self._nodes

    @property
    def edges(self):
        """Every edge, in the artifact's own ``(from, to, kind)`` order."""
        return self._edges

    @property
    def dependency_summary(self):
        """The Dependency Summary's entries, in the source document's own order."""
        return self._dependency_summary

    def node(self, node_id):
        """One node by ID, or ``GraphQueryError`` naming the ID the artifact does not hold.

        Raising beats returning ``None``: a caller that dereferenced the ``None`` would
        report a missing field on a node that does not exist, which sends a reader looking
        for the wrong defect.
        """
        try:
            return self._by_id[node_id]
        except KeyError:
            raise GraphQueryError(
                f"the process graph holds no node {node_id!r}"
            ) from None

    def by_level(self, level):
        """Every node at one level — ``L1``, ``L2`` or ``L3`` — in document order.

        An unrecognised level raises rather than answering with an empty list, which would
        read as a fact about the document instead of as a mistyped argument.
        """
        if level not in self._by_level:
            raise GraphQueryError(
                f"{level!r} is not one of the process graph's levels {LEVELS}"
            )
        return self._by_level[level]

    # --- traversal --------------------------------------------------------------------
    #
    # Five queries, all of them over the same two neighbour indexes and all of them
    # answering about a node the artifact holds — an unknown node ID and an unknown
    # ``kind`` both raise, because an empty set is an answer and neither of those is a
    # question this graph can answer.

    def successors(self, node_id, kind=DEFAULT_TRAVERSAL_KIND):
        """The nodes one node declares, or is declared by, as coming after it.

        The answer is the **union of both declaration directions**: the source states most
        dependencies once, so a node's successors include every target its own cell names
        *and* every row whose cell names it as a predecessor. Reading one direction only
        would report a subgraph as if it were the document.
        """
        return set(
            self._successor_index[self._checked_kind(kind)][self._checked_node(node_id)]
        )

    def predecessors(self, node_id, kind=DEFAULT_TRAVERSAL_KIND):
        """The nodes one node declares, or is declared by, as coming before it."""
        return set(
            self._predecessor_index[self._checked_kind(kind)][self._checked_node(node_id)]
        )

    def reachable_from(self, node_id, kind=DEFAULT_TRAVERSAL_KIND):
        """Every node reachable from ``node_id`` by one or more edges.

        The start node is **not** in the answer, because the thread computation is defined
        over "an ancestor of a terminal node, or a terminal itself": the "or itself" clause
        is what adds it back, and a closure that included it would make that clause say
        nothing. It is absent by *not being seeded*, not by being removed afterwards — so a
        node a cycle genuinely leads back to still reports itself, which over ``forward``
        edges never happens and under ``kind="all"`` is the truth about the back edge.
        """
        return self._closure(self._successor_index, node_id, kind)

    def ancestors_of(self, node_id, kind=DEFAULT_TRAVERSAL_KIND):
        """Every node that reaches ``node_id`` by one or more edges, excluding itself."""
        return self._closure(self._predecessor_index, node_id, kind)

    def _closure(self, indexes, node_id, kind):
        """The transitive closure of one neighbour index from one node."""
        index = indexes[self._checked_kind(kind)]
        frontier = [self._checked_node(node_id)]

        reached = set()
        while frontier:
            for neighbour in index[frontier.pop()]:
                if neighbour not in reached:
                    reached.add(neighbour)
                    frontier.append(neighbour)
        return reached

    def topo_order(self, kind=DEFAULT_TRAVERSAL_KIND):
        """Every node in a dependency-respecting order, or ``CycleError`` if one remains.

        Kahn's algorithm with the **source document's row order as the tie-break**: where
        several nodes are ready at once the one the document states first is placed first,
        so the order is reproducible rather than a function of set iteration. Two calls on
        one graph therefore agree, and so do two processes.

        A remaining cycle raises rather than returning the part it could place. A truncated
        order is the dangerous answer: it satisfies "every edge runs forwards" for the nodes
        it holds, so a consumer checking that property would accept an order missing most of
        the graph. ``CycleError`` carries both halves — what placed, and what did not.
        """
        kind = self._checked_kind(kind)
        successors = self._successor_index[kind]
        # The in-degree counted as *distinct* predecessors, which is what the index holds, so
        # it stays in step with the one decrement each distinct successor takes below.
        remaining = {
            node_id: len(neighbours)
            for node_id, neighbours in self._predecessor_index[kind].items()
        }

        # A heap of document positions rather than of IDs: the tie-break is the document's
        # order, and comparing IDs would order `SYS1-10` ahead of `SYS1-9` alphabetically.
        ready = [
            self._position[node_id]
            for node_id, count in remaining.items()
            if count == 0
        ]
        heapq.heapify(ready)

        order = []
        while ready:
            node_id = self._nodes[heapq.heappop(ready)]["id"]
            order.append(node_id)
            for neighbour in successors[node_id]:
                remaining[neighbour] -= 1
                if remaining[neighbour] == 0:
                    heapq.heappush(ready, self._position[neighbour])

        if len(order) != len(self._nodes):
            raise self._cycle_error(kind, order)
        return order

    def _cycle_error(self, kind, placed):
        """The ``CycleError`` a truncated sort raises, naming every node left unplaced.

        Every one of them, not a sample: the list is already computed, and a reader handed
        the first few has to run the sort again to see the rest. The count contrast is
        stated too, because "184 of 255 unplaceable" is what says a single back edge strands
        most of the graph rather than a corner of it.
        """
        seen = set(placed)
        unplaceable = [node["id"] for node in self._nodes if node["id"] not in seen]
        listed = ", ".join(unplaceable)
        message = (
            f"the process graph does not sort topologically over its {kind!r} edges: "
            f"{len(placed)} of {len(self._nodes)} nodes placed and {len(unplaceable)} "
            f"could not, because each of the latter lies on a cycle or downstream of one. "
            f"The unplaceable nodes are: {listed}"
        )
        return CycleError(message, placed, unplaceable)

    def _checked_node(self, node_id):
        """Return ``node_id``, or raise naming the ID the artifact holds no node for."""
        self.node(node_id)
        return node_id
