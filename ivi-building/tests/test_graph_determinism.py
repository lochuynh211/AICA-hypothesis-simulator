"""Serialisation, the atomic write and the command line: the surfaces byte-identical
re-extraction depends on.

These tests exercise ``process_graph`` directly rather than through the ``graph``
fixture, because they are about *producing* the artifact rather than reading it.

Every write in this module is a byte write with an explicit ``\\n``. The platform here
translates ``\\n`` to ``\\r\\n`` in text mode, and git normalises the result back to
``\\n`` on commit — so a CRLF leak would be invisible on this machine and would only
surface as drift in a fresh clone. That asymmetry is why the assertions below are on
bytes rather than on text.
"""

import json

import pytest

import process_graph
from conftest import SOURCE_PATHS


def _source_texts():
    """The two source documents' text, read the way the extractor reads them."""
    process_list, _ = process_graph.read_source(SOURCE_PATHS["process_list"])
    application_map, _ = process_graph.read_source(SOURCE_PATHS["application_map"])
    return process_list, application_map


def _graph():
    """The assembled artifact, built from the two real source documents."""
    return process_graph.build_graph(*_source_texts())


# --- serialize -----------------------------------------------------------------------

#: A miniature artifact whose serialisation pins all four serialisation decisions at
#: once: ``indent=2``, ``ensure_ascii=False``, the trailing newline, and UTF-8 bytes.
#: The Japanese string is the process list's own workbook title, so an ``ensure_ascii``
#: regression shows up as ``\\u4f01`` escapes rather than as a mangled comparison.
_SAMPLE_GRAPH = {
    "meta": {"schema_version": "1.0"},
    "nodes": [{"id": "PH1", "name": "企画要求定義プロセス一覧"}],
}

_SAMPLE_BYTES = (
    "{\n"
    '  "meta": {\n'
    '    "schema_version": "1.0"\n'
    "  },\n"
    '  "nodes": [\n'
    "    {\n"
    '      "id": "PH1",\n'
    '      "name": "企画要求定義プロセス一覧"\n'
    "    }\n"
    "  ]\n"
    "}\n"
).encode("utf-8")


def test_serialize_pins_indent_encoding_and_trailing_newline():
    """FR-027: two-space indent, unescaped non-ASCII, one trailing ``\\n``, UTF-8 bytes.

    Asserted as an exact byte string rather than field by field, because every one of the
    four decisions changes the bytes and byte-identity is the criterion. ``bytes`` is also
    the return type the atomic write needs: handing ``str`` to a text-mode write is how a
    ``\\r`` gets injected on this platform.
    """
    assert process_graph.serialize(_SAMPLE_GRAPH) == _SAMPLE_BYTES


def test_serialize_emits_no_carriage_return():
    """FR-027: not one ``\\r`` anywhere in the serialised artifact.

    Run against the real 255-node artifact rather than the sample, since a cell of the
    source document could carry one and it would travel straight through the parser.
    """
    data = process_graph.serialize(_graph())

    assert b"\r" not in data
    assert data.endswith(b"\n")
    assert not data.endswith(b"\n\n"), "a second trailing newline would be a varying tail"


def test_serialize_keeps_the_documents_node_order():
    """FR-027: the serialised node order is the source document's own row order.

    Round-tripped through ``json.loads`` and compared against the rows the parser
    reports, so the assertion is about the bytes rather than about the dict handed in.
    """
    process_list, application_map = _source_texts()
    rows = process_graph.parse_rows(process_list)
    graph = process_graph.build_graph(process_list, application_map)

    restored = json.loads(process_graph.serialize(graph).decode("utf-8"))

    assert [node["id"] for node in restored["nodes"]] == [row["id"] for row in rows]
    assert len(restored["nodes"]) == 255
    assert list(restored) == list(graph)


def test_serialize_is_byte_identical_across_two_assemblies():
    """FR-027 / SC-012: two independent assemblies serialise to the same bytes.

    Serialising one dict twice would only prove ``json.dumps`` is a function. Building
    the graph twice from the same text exercises the whole assembly, so a set iteration
    or a dict whose key order came from a source-formatting accident shows up here.
    """
    first = process_graph.serialize(_graph())
    second = process_graph.serialize(_graph())

    assert first == second
    assert len(first) == len(second)


def test_serialize_output_holds_japanese_verbatim():
    """FR-027: ``ensure_ascii=False`` — the artifact reads as the document reads.

    An escaped artifact would still round-trip, so the check is on the bytes: the
    document's own Japanese workbook title must be present as UTF-8, and the ``\\u``
    escape that ``ensure_ascii=True`` would produce for it must not be.
    """
    data = process_graph.serialize(_SAMPLE_GRAPH)

    assert "企画要求定義プロセス一覧".encode("utf-8") in data

    # U+4F01 is 企, the title's first character. ``ensure_ascii=True`` would write it as
    # the six characters "u4f01" behind a backslash, so the marker is asserted absent
    # without the test itself having to spell an escape.
    assert b"u4f01" not in data
    assert data != json.dumps(_SAMPLE_GRAPH, ensure_ascii=True, indent=2).encode("utf-8")


# --- write_atomic --------------------------------------------------------------------

#: Bytes shaped like the artifact: UTF-8 Japanese, and two ``\n`` line endings that a
#: text-mode write on this platform would turn into ``\r\n``.
_PAYLOAD = '{\n  "name": "企画要求定義プロセス一覧"\n}\n'.encode("utf-8")


def test_write_atomic_writes_the_bytes_verbatim(tmp_path):
    """FR-029 / FR-027: what goes in is what lands on disk, ``\n`` included.

    The two newlines are the assertion that matters. ``Path.write_text`` in text mode
    would write ``\r\n`` here, git would normalise it back on commit, and the drift would
    only appear in a fresh clone — so the test compares bytes, not lines.
    """
    target = tmp_path / "process_graph.json"

    process_graph.write_atomic(target, _PAYLOAD)

    assert target.read_bytes() == _PAYLOAD
    assert b"\r" not in target.read_bytes()
    assert list(tmp_path.iterdir()) == [target], "a temporary file survived a good write"


def test_write_atomic_replaces_an_existing_file(tmp_path):
    """FR-029: the write is a move into place, so the previous content is gone whole."""
    target = tmp_path / "process_graph.json"
    target.write_bytes(b"stale\n")

    process_graph.write_atomic(target, _PAYLOAD)

    assert target.read_bytes() == _PAYLOAD
    assert list(tmp_path.iterdir()) == [target]


def test_write_atomic_leaves_the_previous_file_untouched_on_failure(tmp_path, monkeypatch):
    """FR-029: a failed move leaves the committed file byte-unchanged and no debris.

    The failure is injected at ``os.replace`` because that is the only step that can fail
    after the new bytes are complete — which is exactly the moment a non-atomic
    implementation would already have overwritten the previous file. The directory listing
    is asserted too: a leftover temporary file is a partially written artifact left
    observable, which the contract forbids.
    """
    target = tmp_path / "process_graph.json"
    target.write_bytes(b"previously committed\n")

    def refuse(*args, **kwargs):
        raise OSError("injected failure")

    monkeypatch.setattr("os.replace", refuse)

    with pytest.raises(OSError):
        process_graph.write_atomic(target, _PAYLOAD)

    assert target.read_bytes() == b"previously committed\n"
    assert list(tmp_path.iterdir()) == [target], "a temporary file survived a failed write"


def test_write_atomic_refuses_text(tmp_path):
    """FR-029: ``str`` is refused at the boundary rather than encoded here.

    Accepting text would mean choosing an encoding and a newline policy in the writer,
    which is the ``\r`` injection this whole module is shaped to avoid. ``serialize``
    already returns bytes, so text arriving here is a defect in the caller.
    """
    target = tmp_path / "process_graph.json"

    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.write_atomic(target, _PAYLOAD.decode("utf-8"))

    assert "bytes" in str(excinfo.value)
    assert not target.exists(), "a refused write still created the file"


def test_write_atomic_requires_an_existing_directory(tmp_path):
    """FR-029: the temporary file lives beside the target, so its directory must exist.

    A move within one directory is what makes the write atomic; a missing directory means
    there is nowhere to stage, so it is named rather than created behind the caller's back.
    """
    target = tmp_path / "absent" / "process_graph.json"

    with pytest.raises(process_graph.ExtractionError) as excinfo:
        process_graph.write_atomic(target, _PAYLOAD)

    assert "absent" in str(excinfo.value)
