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
import os
import subprocess
import sys

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


# --- the command line ----------------------------------------------------------------

_ARTIFACT_NAME = "process_graph.json"


def _extract_into(directory, *arguments):
    """Run the extractor in-process into ``directory`` and return its exit code."""
    return process_graph.main(["--out-dir", str(directory), *arguments])


def test_main_reads_the_two_tracked_sources_from_the_module_location():
    """cli.md: the source paths are the module's own, not the caller's.

    Pinned against ``conftest``'s independently-written paths, so the extractor and the
    test suite cannot disagree about which two documents H0 transcribes.
    """
    assert process_graph.PROCESS_LIST_PATH == SOURCE_PATHS["process_list"]
    assert process_graph.APPLICATION_MAP_PATH == SOURCE_PATHS["application_map"]
    assert process_graph.PROCESS_LIST_PATH.is_file()
    assert process_graph.APPLICATION_MAP_PATH.is_file()


def test_main_default_out_dir_is_the_harness_graph_directory():
    """cli.md: ``--out-dir`` defaults to ``ivi-building/graph/``, resolved from the module."""
    assert process_graph.DEFAULT_OUT_DIR == process_graph.HARNESS_ROOT / "graph"
    assert process_graph.DEFAULT_OUT_DIR.as_posix().endswith("ivi-building/graph")
    assert process_graph.ARTIFACT_NAME == _ARTIFACT_NAME


def test_main_writes_the_serialised_artifact_into_out_dir(tmp_path):
    """cli.md: exit ``0``, and the file holds exactly what ``serialize`` produced.

    Compared against ``serialize(build_graph(...))`` rather than against a parsed copy,
    because the command's contract is about bytes: a re-serialisation with different
    options would still load as an equal object.
    """
    assert _extract_into(tmp_path, "--quiet") == 0

    written = (tmp_path / _ARTIFACT_NAME).read_bytes()

    assert written == process_graph.serialize(_graph())
    assert b"\r" not in written
    assert list(tmp_path.iterdir()) == [tmp_path / _ARTIFACT_NAME]


def test_main_creates_an_absent_out_dir(tmp_path):
    """cli.md: ``--out-dir`` names a destination, so the command makes it rather than
    failing on a directory the caller has not created."""
    destination = tmp_path / "fresh" / "graph"

    assert _extract_into(destination, "--quiet") == 0
    assert (destination / _ARTIFACT_NAME).read_bytes().endswith(b"}\n")


def test_main_writes_byte_identical_output_into_two_directories(tmp_path):
    """FR-027 / SC-012: two consecutive extractions on unchanged sources agree, byte for
    byte, through the whole command rather than only through ``serialize``."""
    first = tmp_path / "first"
    second = tmp_path / "second"

    assert _extract_into(first, "--quiet") == 0
    assert _extract_into(second, "--quiet") == 0

    assert (first / _ARTIFACT_NAME).read_bytes() == (second / _ARTIFACT_NAME).read_bytes()


def test_main_prints_the_headline_counts_unless_quiet(tmp_path, capsys):
    """cli.md: the summary states the row counts; ``--quiet`` suppresses it entirely.

    The numbers are asserted exactly. A summary saying "extraction complete" and nothing
    else would satisfy a laxer test while telling the human nothing they could check the
    artifact against.
    """
    assert _extract_into(tmp_path / "loud") == 0
    loud = capsys.readouterr()

    assert "3 L1" in loud.out
    assert "16 L2" in loud.out
    assert "236 L3" in loud.out
    assert "255" in loud.out
    assert loud.err == ""

    assert _extract_into(tmp_path / "quiet", "--quiet") == 0
    quiet = capsys.readouterr()

    assert quiet.out == ""
    assert quiet.err == ""


def test_main_exits_2_and_writes_nothing_when_the_extraction_fails(tmp_path, monkeypatch):
    """cli.md: exit ``2`` names the offending source text, and nothing was written.

    A pre-existing file in the output directory stands in for committed output: an
    extraction that fails must leave it byte-unchanged, which is what makes re-running the
    command after a source revision safe.
    """
    source = tmp_path / "damaged_process_list.md"
    source.write_text("# Fixture\n\n## 2. Process Overview\n", encoding="utf-8")
    monkeypatch.setattr(process_graph, "PROCESS_LIST_PATH", source)

    destination = tmp_path / "graph"
    destination.mkdir()
    committed = destination / _ARTIFACT_NAME
    committed.write_bytes(b"previously committed\n")

    assert process_graph.main(["--out-dir", str(destination)]) == 2

    assert committed.read_bytes() == b"previously committed\n"
    assert list(destination.iterdir()) == [committed], "a staged file survived a failure"


def test_main_reports_a_failure_on_stderr_even_when_quiet(tmp_path, monkeypatch, capsys):
    """cli.md: ``--quiet`` suppresses the summary, never the reason for a non-zero exit."""
    source = tmp_path / "damaged_process_list.md"
    source.write_text("# Fixture\n\n## 2. Process Overview\n", encoding="utf-8")
    monkeypatch.setattr(process_graph, "PROCESS_LIST_PATH", source)

    assert process_graph.main(["--out-dir", str(tmp_path), "--quiet"]) == 2

    captured = capsys.readouterr()
    assert "Process List (detailed)" in captured.err
    assert captured.out == ""


def test_main_rejects_an_argument_the_contract_does_not_state(tmp_path):
    """cli.md: "No other arguments. There is deliberately no ``--force``".

    A tolerated unknown flag would let a caller believe an option exists that changes
    nothing — and the review surface for a change is the version-control working tree,
    not a staging switch.
    """
    with pytest.raises(SystemExit) as excinfo:
        process_graph.main(["--out-dir", str(tmp_path), "--force"])

    assert excinfo.value.code == 2


def test_main_refuses_check_until_the_comparison_is_implemented(tmp_path, capsys):
    """``--check`` is declared by cli.md and **not implemented here** — it is a later task.

    The flag is accepted by the parser so the argument surface matches the contract, but
    the drift comparison is not written yet, and a flag that silently exited ``0`` would
    read as "no drift" on output nobody compared. So it refuses loudly instead, which no
    later drift test can pass by accident.
    """
    assert process_graph.main(["--check"]) == 2

    captured = capsys.readouterr()
    assert "--check" in captured.err
    assert "not implemented" in captured.err
    assert not (tmp_path / _ARTIFACT_NAME).exists()


def test_main_behaves_identically_from_either_working_directory(tmp_path):
    """cli.md: "Working directory is irrelevant" — a contract, not an implementation detail.

    The skill runs the command from ``ivi-building/`` while the suite may run it from the
    repository root, so this is checked as a real subprocess from both, comparing the
    resulting bytes. ``PYTHONIOENCODING`` is set because the console default here is cp932.
    """
    from_root = tmp_path / "from_root"
    from_harness = tmp_path / "from_harness"
    script = process_graph.HARNESS_ROOT / "lib" / "process_graph.py"

    environment = dict(os.environ, PYTHONIOENCODING="utf-8")
    for working_directory, destination in (
        (process_graph.REPO_ROOT, from_root),
        (process_graph.HARNESS_ROOT, from_harness),
    ):
        completed = subprocess.run(
            [sys.executable, str(script), "--out-dir", str(destination)],
            cwd=str(working_directory),
            env=environment,
            capture_output=True,
        )
        assert completed.returncode == 0, completed.stderr.decode("utf-8", "replace")

    assert (from_root / _ARTIFACT_NAME).read_bytes() == (
        from_harness / _ARTIFACT_NAME
    ).read_bytes()
    assert (from_root / _ARTIFACT_NAME).read_bytes() == process_graph.serialize(_graph())
