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

Traversal — ``successors``, ``predecessors``, ``reachable_from``, ``ancestors_of``,
``topo_order`` — plus ``findings()`` and ``thread`` are **not here yet**: they read the
``edges``, ``findings`` and ``thread`` blocks, which the extractor does not populate until
later batches. A traversal over an empty edge list would answer every question with
"nothing", which is a wrong answer rather than a missing one, so it is absent instead.
"""

from __future__ import annotations

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


class GraphQueryError(Exception):
    """The artifact is unreadable, or a query names something it does not hold."""


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

    @property
    def nodes(self):
        """Every node, in the source document's own row order."""
        return self._nodes

    @property
    def edges(self):
        """Every edge, in the artifact's own ``(from, to, kind)`` order."""
        return self._edges

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
