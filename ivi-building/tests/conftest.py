"""Shared pytest wiring for the IVI process-graph test suite.

Puts ``ivi-building/lib`` at the front of ``sys.path`` so the harness's deterministic
modules are importable by name (``import process_graph``) without a package
``__init__.py`` — ``lib/`` is flat by decision, one module per milestone that needs one.

Every path here resolves from this file's own location, never from the working
directory, so the suite behaves identically whether pytest is invoked from the
repository root or from ``ivi-building/``.

Every read pins ``encoding="utf-8"`` explicitly: the console default on this platform
is cp932 and a bare ``open()`` on either source document raises ``UnicodeDecodeError``.
"""

import json
import sys
from pathlib import Path

import pytest

HARNESS_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[2]
LIB_DIR = HARNESS_ROOT / "lib"

if str(LIB_DIR) not in sys.path:
    sys.path.insert(0, str(LIB_DIR))

#: The two read-only source documents, keyed by short name.
SOURCE_PATHS = {
    "process_list": REPO_ROOT
    / "others"
    / "20260826_IVI_SYS1-2_Planning_Requirements_Definition_Process_List.md",
    "application_map": REPO_ROOT
    / "others"
    / "20260826_IVI_Process_x_AI_Hypothesis_Driven_Application_Map_v2.md",
}

#: The published contract the graph artifact must satisfy.
CONTRACT_SCHEMA_PATH = (
    REPO_ROOT
    / "specs"
    / "020-ivi-h0-process-graph"
    / "contracts"
    / "process_graph.schema.json"
)


@pytest.fixture(scope="session")
def graph():
    """The loaded ``graph/process_graph.json`` artifact.

    ``graph_query`` is imported inside the fixture rather than at module scope so a
    missing loader or a missing artifact fails only the tests that ask for the graph,
    instead of breaking collection for the whole suite.
    """
    import graph_query

    return graph_query.load()


@pytest.fixture(scope="session")
def raw_sources():
    """The two source documents' UTF-8 text, keyed by short name."""
    return {
        name: path.read_text(encoding="utf-8") for name, path in SOURCE_PATHS.items()
    }


@pytest.fixture(scope="session")
def contract_schema():
    """The published JSON Schema for the graph artifact."""
    return json.loads(CONTRACT_SCHEMA_PATH.read_text(encoding="utf-8"))
