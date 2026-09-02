"""Row-level parse fidelity: UTF-8 reading, the 255 headings, and label accounting.

These tests exercise ``process_graph`` directly against the real source documents. They
deliberately do not use the ``graph`` fixture: the artifact and its loader arrive in a
later batch, and a test that depended on them would fail for the wrong reason.
"""

import pytest

import process_graph
from conftest import SOURCE_PATHS


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
