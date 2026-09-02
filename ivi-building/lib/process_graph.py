"""Deterministic extractor for the IVI SYS.1-SYS.2 process graph.

Transcribes the two tracked IVI process source documents into one machine-readable
artifact. Every function here is pure: it takes text and returns data, so none needs a
fixture larger than a string.

Two rules shape the whole module:

* **UTF-8 is pinned on every read and write.** The console default on this platform is
  cp932, under which a bare ``open()`` on either source document raises
  ``UnicodeDecodeError``.
* **Unrecognised input is a hard failure, never a silent drop.** A labelled bullet the
  parser does not know, or a dependency notation it cannot resolve, would mean source
  content disappearing without a trace. That is the one failure mode this milestone
  exists to prevent, so both raise.

Paths resolve from this file's own location, never from the working directory, so the
extractor behaves identically run from ``ivi-building/`` and from the repository root.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

HARNESS_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[2]


class ExtractionError(Exception):
    """Base class for every condition that stops an extraction."""


class LabelError(ExtractionError):
    """A row is missing a required labelled bullet, or carries an unknown one."""


class UnknownNotation(ExtractionError):
    """A dependency-cell token matches none of the notations the source document uses."""


#: The ten labelled bullets present on all 255 rows, in the document's own order.
REQUIRED_LABELS = (
    "Purpose",
    "Work content",
    "Input deliverables",
    "Input source",
    "Output deliverables",
    "Granularity / completeness",
    "Predecessor / Successor",
    "Entry",
    "Exit (DoD)",
    "Concrete examples",
)

#: Labels present on some rows only. Counts measured on the 2026-08-26 revision:
#: ``ASPICE BP`` 135 rows, ``AI hypothesis-driven applicability`` 7, ``Rationale`` 1
#: (``SYS1-08-c``, the only row in the document with an eleventh labelled bullet).
OPTIONAL_LABELS = (
    "ASPICE BP",
    "AI hypothesis-driven applicability",
    "Rationale",
)

#: The whitelist. A label outside it stops the extraction.
KNOWN_LABELS = frozenset(REQUIRED_LABELS + OPTIONAL_LABELS)


def read_source(path):
    """Read a source document as UTF-8 and return ``(text, sha256)``.

    The digest is taken over the decoded text re-encoded as UTF-8, not over the raw
    bytes on disk, so a checkout that materialises CRLF line endings produces the same
    digest as one that does not. Byte-identical re-extraction across machines is a
    requirement, and a line-ending-sensitive digest would break it.
    """
    text = Path(path).read_text(encoding="utf-8")
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    return text, digest


# --- row parsing -------------------------------------------------------------------

#: Section 4 holds the 255-row table; the three earlier sections have headings of their
#: own that must not be mistaken for rows.
_SECTION_4_HEADING = re.compile(r"^## 4\. Process List \(detailed\)[^\n]*$", re.MULTILINE)

#: ``### PH1 (L1) — name`` and ``### SYS1-01 (L2) — name`` for phases and activities,
#: ``#### SYS1-01-a — name`` for work items. The em dash is U+2014.
_ROW_HEADING = re.compile(
    r"^(?:###[ ](?P<gid>PH[123]|SYS[12]-\d{2})[ ]\((?P<glevel>L1|L2)\)"
    r"|####[ ](?P<wid>SYS[12]-\d{2}-[a-z]))"
    r"[ ]—[ ](?P<name>.+?)[ ]*$",
    re.MULTILINE,
)

#: Any heading line inside section 4. Used to catch a heading the row pattern would
#: skip over, which would silently drop a row.
_ANY_HEADING = re.compile(r"^#{1,6}[ ].*$", re.MULTILINE)

#: ``- **Label:** value`` — one line per bullet; the source never wraps a cell.
_BULLET = re.compile(r"^-[ ]\*\*(?P<label>[^*]+?):\*\*[ ]*(?P<value>.*?)[ ]*$", re.MULTILINE)

#: The only non-bullet content a row body legitimately holds: the horizontal rules that
#: separate the phase and activity groups.
_BODY_SEPARATOR = "---"

#: Non-blank content section 4's preamble legitimately holds, matched by prefix. Today
#: that is one legend line naming the source sheet's columns.
_ALLOWED_PREAMBLE_PREFIXES = ("Column meanings",)


def _section_4(text):
    """Return the text of section 4, which runs from its heading to the end of file."""
    match = _SECTION_4_HEADING.search(text)
    if match is None:
        raise ExtractionError(
            "the process list document has no '## 4. Process List (detailed)' section"
        )
    return text[match.start() :]


def parse_rows(text):
    """Split the process list into its 255 rows, capturing every labelled bullet.

    Returns a list of dicts in source-document order, each holding ``id``, ``level``
    (``L1``/``L2``/``L3``), ``name`` and ``labels`` — the raw bullet text keyed by the
    document's own label string, uninterpreted. Turning those strings into node fields
    is the job of the per-column parsers, not of this function.

    Raises ``LabelError`` when a row is missing any of the ten required labels **and
    equally** when it carries a label outside the whitelist. An unaccounted bullet means
    source content dropped silently, so an eleventh label is a stop, not a shrug.
    """
    section = _section_4(text)

    headings = list(_ROW_HEADING.finditer(section))
    _reject_unparsed_headings(section, headings)
    if not headings:
        raise ExtractionError("section 4 of the process list holds no process rows")
    _reject_unparsed_preamble(section[: headings[0].start()])

    rows = []
    for position, heading in enumerate(headings):
        end = headings[position + 1].start() if position + 1 < len(headings) else len(section)
        body = section[heading.end() : end]

        if heading.group("wid") is not None:
            row_id, level = heading.group("wid"), "L3"
        else:
            row_id, level = heading.group("gid"), heading.group("glevel")

        rows.append(
            {
                "id": row_id,
                "level": level,
                "name": heading.group("name"),
                "labels": _parse_bullets(body, row_id),
            }
        )

    return rows


def _reject_unparsed_headings(section, headings):
    """Fail loudly on a heading inside section 4 that the row pattern did not match.

    Offset 0 is section 4's own ``## 4. …`` heading, which is not a row.
    """
    matched = {match.start() for match in headings}
    for candidate in _ANY_HEADING.finditer(section):
        if candidate.start() in matched or candidate.start() == 0:
            continue
        raise ExtractionError(
            "unrecognised heading in the process list, which would drop a row: "
            f"{candidate.group(0)!r}"
        )


def _reject_unparsed_preamble(preamble):
    """Fail loudly on content between the section heading and the first process row.

    The preamble is the one region neither of the other two guards inspects: it belongs
    to no row body, and it is not a heading. A labelled bullet stranded here would vanish
    without the extractor ever noticing, which would make this module's "never a silent
    drop" claim untrue.
    """
    for line in preamble.splitlines():
        stripped = line.strip()
        if (
            not stripped
            or stripped == _BODY_SEPARATOR
            or stripped.startswith("#")
            or stripped.startswith(_ALLOWED_PREAMBLE_PREFIXES)
        ):
            continue
        raise ExtractionError(
            "content between the section heading and the first process row is not "
            f"parsed by this extractor: {line!r}"
        )


def _reject_unparsed_body_lines(body, row_id):
    """Fail loudly on row content that is neither a parsed bullet nor a separator.

    Without this, a bullet whose formatting the label pattern cannot match — a stray
    asterisk, a missing colon — would be skipped in silence, which is exactly the
    dropped-content failure the whitelist exists to prevent.
    """
    parsed = {match.group(0) for match in _BULLET.finditer(body)}
    for line in body.splitlines():
        stripped = line.strip()
        if not stripped or stripped == _BODY_SEPARATOR or line in parsed:
            continue
        raise ExtractionError(
            f"row {row_id} holds content this extractor does not parse: {line!r}"
        )


def _parse_bullets(body, row_id):
    """Capture ``- **Label:** value`` bullets for one row against the whitelist."""
    _reject_unparsed_body_lines(body, row_id)

    labels = {}
    for bullet in _BULLET.finditer(body):
        label, value = bullet.group("label"), bullet.group("value")
        if label not in KNOWN_LABELS:
            raise LabelError(
                f"row {row_id} carries an unknown labelled bullet {label!r}; "
                "an unaccounted bullet means source content would be dropped silently"
            )
        if label in labels:
            raise LabelError(f"row {row_id} repeats the labelled bullet {label!r}")
        labels[label] = value

    missing = [label for label in REQUIRED_LABELS if label not in labels]
    if missing:
        raise LabelError(
            f"row {row_id} is missing the required labelled bullet(s) "
            + ", ".join(repr(label) for label in missing)
        )

    return labels


# --- dependency-cell resolution ----------------------------------------------------

#: The annotations the source document attaches to a dependency target. They carry
#: commentary, not a target, so they are stripped before tokenising. ``(revisit)`` also
#: classifies an edge, which ``build_edges`` reads from the verbatim cell.
_ANNOTATION = re.compile(
    r"[ ]*\((?:revisit|and all other work items|start of PH[123])\)"
)

#: Separators between targets. Section 4 uses ", " throughout — the Legend's "・" does not
#: survive into the Markdown translation. A revision that reintroduces it raises
#: ``UnknownNotation`` naming the row, which is the intended escalation rather than a
#: tolerance nothing in the document exercises.
_SEPARATORS = " \t,"

#: An activity number of 1-9 is prefixed SYS1, 10-16 SYS2 — the document's own rule.
_SYS1_MAX_ACTIVITY = 9

#: Every notation must end at a separator or at the end of the list. Derived from
#: ``_SEPARATORS`` so the two cannot drift apart.
#:
#: This is what stops a malformed compound being normalised into plausible IDs: without
#: it, ``-g-h`` reads as two suffix continuations and ``SYS1-04-e-h`` as an ID plus one,
#: inventing targets from a shape no human wrote deliberately. An unlisted spelling must
#: reach a human instead.
_TOKEN_END = r"(?=[" + re.escape(_SEPARATORS) + r"]|\Z)"

# One pattern per notation of research.md R7. Tried in this order, so a range is never
# read as the bare ID that starts it, and a work item is never read as its activity.
_NONE = re.compile(r"none" + _TOKEN_END)
_PHASE_WITH_PARENTHETICAL = re.compile(
    r"(PH[123])[ ]\((SYS[12]-\d{2}(?:-[a-z])?)\)" + _TOKEN_END
)
_ACTIVITY_RANGE = re.compile(r"SYS[12]-(\d{2})[ ]*–[ ]*SYS[12]-(\d{2})" + _TOKEN_END)
_ITEM_RANGE_THROUGH = re.compile(
    r"(SYS[12]-\d{2})-([a-z])[ ]through[ ]-([a-z])" + _TOKEN_END
)
_ITEM_RANGE_DASH = re.compile(
    r"(SYS[12]-\d{2})-([a-z])[ ]*–[ ]*-?([a-z])" + _TOKEN_END
)
_ITEM = re.compile(r"(SYS[12]-\d{2})-([a-z])" + _TOKEN_END)
_ACTIVITY = re.compile(r"SYS[12]-\d{2}" + _TOKEN_END)
_SUFFIX_CONTINUATION = re.compile(r"-([a-z])" + _TOKEN_END)

#: Prose naming nothing in this process, e.g. "the following phases (architecture design,
#: vendor selection)". Deliberately narrow: a looser rule would swallow an unrecognised
#: token as prose, and hard-failing on a new notation is the point.
_PROSE = re.compile(r"the[ ]\w+[ ]phases[ ]\([^)]*\)" + _TOKEN_END)

#: An identifier inside a prose match. Prose is by definition a target naming nothing in
#: this process, so an ID inside one is a contradiction and must be escalated rather than
#: filed away as an ``external_ref`` — that would drop a declared target silently.
#: ``SYS.3`` is deliberately not matched: the ID pattern requires a hyphen, never a dot.
_IDENTIFIER_IN_PROSE = re.compile(r"SYS[12]-\d{2}(?:-[a-z])?|PH[123]")


def _activity_id(number):
    prefix = "SYS1" if number <= _SYS1_MAX_ACTIVITY else "SYS2"
    return f"{prefix}-{number:02d}"


def parse_edge_cell(raw, owner_id):
    """Resolve one side of a ``Predecessor / Successor`` cell into ``(ids, external_refs)``.

    ``raw`` is the target list that follows ``Predecessor:`` or ``Successor:`` — splitting
    the cell into its two sides belongs to the edge builder. ``owner_id`` is the row the
    cell is on, and names the row in every error this function raises.

    All six notations of research.md R7 are handled: a full work-item ID; an activity ID
    where a work item is expected; a phase ID with a parenthetical entry step, which
    yields **both** targets because the source declares both; a suffix continuation
    (``-g``) against the last full ID's activity; ranges in all four spellings, at
    work-item and at activity level; and prose, which becomes an ``external_ref`` and
    never an edge. The literal ``none`` yields nothing. A phase ID standing alone is not
    among them, so it raises — the inventory is the specification.

    Raises ``UnknownNotation`` on any token that matches none of them, so a revised
    document surfaces a new notation loudly instead of losing a dependency. Note that
    ``SYS.3`` — which occurs inside a prose target — is not an identifier: the ID pattern
    requires a hyphen, never a dot.
    """
    text = _ANNOTATION.sub("", raw).strip()

    ids = []
    external_refs = []
    # A suffix continuation continues the last *full* ID's activity, so nothing is in
    # scope until one has been seen.
    activity_prefix = None
    position = 0

    while position < len(text):
        if text[position] in _SEPARATORS:
            position += 1
            continue

        remainder = text[position:]
        matched, consumed, activity_prefix = _match_notation(
            remainder, owner_id, activity_prefix, ids, external_refs
        )
        if not matched:
            raise UnknownNotation(
                f"row {owner_id} states a dependency target this extractor does not "
                f"recognise: {remainder!r} (in {raw!r})"
            )
        position += consumed

    return _deduplicated(ids), _deduplicated(external_refs)


def _match_notation(remainder, owner_id, activity_prefix, ids, external_refs):
    """Consume one notation from the front of ``remainder``.

    Returns ``(matched, characters_consumed, activity_prefix)``. Appends to ``ids`` and
    ``external_refs`` in place, so target order follows the source document.
    """
    match = _NONE.match(remainder)
    if match:
        return True, match.end(), activity_prefix

    match = _PHASE_WITH_PARENTHETICAL.match(remainder)
    if match:
        # Both are declared: the phase, and the step the source says it starts at.
        ids.append(match.group(1))
        ids.append(match.group(2))
        return True, match.end(), activity_prefix

    match = _ACTIVITY_RANGE.match(remainder)
    if match:
        first, last = int(match.group(1)), int(match.group(2))
        _check_range(remainder, owner_id, first, last)
        ids.extend(_activity_id(number) for number in range(first, last + 1))
        return True, match.end(), activity_prefix

    for pattern in (_ITEM_RANGE_THROUGH, _ITEM_RANGE_DASH):
        match = pattern.match(remainder)
        if match:
            activity, first, last = match.group(1), match.group(2), match.group(3)
            _check_range(remainder, owner_id, ord(first), ord(last))
            ids.extend(
                f"{activity}-{chr(letter)}"
                for letter in range(ord(first), ord(last) + 1)
            )
            return True, match.end(), activity

    match = _ITEM.match(remainder)
    if match:
        ids.append(match.group(0))
        return True, match.end(), match.group(1)

    match = _ACTIVITY.match(remainder)
    if match:
        ids.append(match.group(0))
        return True, match.end(), match.group(0)

    match = _SUFFIX_CONTINUATION.match(remainder)
    if match:
        if activity_prefix is None:
            raise UnknownNotation(
                f"row {owner_id} opens with the suffix continuation {match.group(0)!r}, "
                "but no activity prefix is in scope to continue"
            )
        ids.append(f"{activity_prefix}-{match.group(1)}")
        return True, match.end(), activity_prefix

    match = _PROSE.match(remainder)
    if match:
        hidden = _IDENTIFIER_IN_PROSE.search(match.group(0))
        if hidden:
            raise UnknownNotation(
                f"row {owner_id} states the prose dependency target {match.group(0)!r}, "
                f"which names {hidden.group(0)!r} in this process; prose is a no-target "
                "form, so resolving it would drop a declared dependency"
            )
        external_refs.append(match.group(0))
        return True, match.end(), activity_prefix

    return False, 0, activity_prefix


def _check_range(remainder, owner_id, first, last):
    if last < first:
        raise UnknownNotation(
            f"row {owner_id} states a descending dependency range: {remainder!r}"
        )


def _deduplicated(values):
    """First-occurrence order, so output follows the source document and is stable."""
    seen = set()
    unique = []
    for value in values:
        if value not in seen:
            seen.add(value)
            unique.append(value)
    return unique


# --- cell field parsing ------------------------------------------------------------

#: Section 1 ("Delimiters within a cell") states that multiple items inside one cell are
#: separated by the circled numbers or by "/". This pattern matches the whole circled
#: range ①-⑳ rather than only the ①②③④ this revision uses, so a revision that adds a
#: fifth item numbers it correctly instead of leaving ⑤ buried inside clause four.
#: Measured maxima on the 2026-08-26 revision: ④ for ``Exit (DoD)``, ③ for
#: ``Concrete examples``.
#:
#: The lookbehind excludes the document's own phase names — ``Phase ①``,
#: ``Phase ②`` and ``Phase ③``, which name the three L1 rows and head the Process
#: Overview's three groups (13 occurrences). ``SYS1-07-a`` is the one row that writes
#: one inside a *numbered* cell: its ``Exit (DoD)`` reads "① The passages recording
#: issues in every Phase ① document have been checked ② …", which without the
#: exclusion numbers as ``①①②③`` and misnumbers every clause. This *narrows*
#: the delimiter to exclude a known prose usage; any other circled number outside
#: the ① ② ③ … series still stops the extraction.
_CIRCLED_MARKER = re.compile(r"(?<!Phase )[\u2460-\u2473]")

#: ① U+2460 CIRCLED DIGIT ONE, the first of that range.
_FIRST_CIRCLED_MARKER = "\u2460"


def _split_marked_cell(raw, field):
    """Split one cell on its circled item markers, or return it whole when unmarked.

    ``field`` is the document's own label for the cell and appears in every error, since
    a bare cell string carries no row identity — the caller names the row when it
    re-raises. Segments are returned **verbatim** apart from stripping outer whitespace:
    these cells are transcribed, not summarised, so any other normalisation would be a
    paraphrase.

    Three conditions stop the extraction rather than producing plausible-looking output:
    an empty cell, numbering that is not ① ② ③ … in order, and text ahead of ①. The last
    two both misnumber items — the numbering *is* the item's identity — and the first
    would yield a field the schema requires to be non-empty.
    """
    text = raw.strip()
    if not text:
        raise ExtractionError(f"a '{field}' cell is empty, so it states no item at all")

    markers = [match.group(0) for match in _CIRCLED_MARKER.finditer(text)]
    if not markers:
        return [text]

    expected = [chr(ord(_FIRST_CIRCLED_MARKER) + offset) for offset in range(len(markers))]
    if markers != expected:
        raise ExtractionError(
            f"a '{field}' cell numbers its items {''.join(markers)!r} rather than "
            f"{''.join(expected)!r}, which would misnumber them: {raw!r}"
        )
    if not text.startswith(_FIRST_CIRCLED_MARKER):
        raise ExtractionError(
            f"a '{field}' cell holds text ahead of its {_FIRST_CIRCLED_MARKER!r} "
            f"marker, which would be read as item one: {raw!r}"
        )

    # The split's first element is the empty string ahead of ①, verified just above.
    segments = [segment.strip() for segment in _CIRCLED_MARKER.split(text)[1:]]
    if not all(segments):
        raise ExtractionError(
            f"a '{field}' cell holds an empty numbered item: {raw!r}"
        )
    return segments


def split_dod(raw):
    """Split an ``Exit (DoD)`` cell into indexed clauses.

    Returns ``[{index, clause}]``, one-based, in source order. The 236 work items number
    their clauses ①②③④; the 19 phase and activity rows state a single unnumbered
    sentence, which yields exactly one clause at index 1 rather than none.

    A clause carries **``index`` and ``clause`` only**. No per-clause human-signoff flag
    is derivable — the source states no per-clause signoff — so none is invented here;
    per-clause verification routing is assigned downstream. This is a deliberate
    correction to the parent design §3.2's example.
    """
    return [
        {"index": index, "clause": clause}
        for index, clause in enumerate(_split_marked_cell(raw, "Exit (DoD)"), start=1)
    ]


#: The separator between two declared deliverables in one ``Output deliverables`` cell.
#: Only at parenthesis depth zero: 43 cells put a comma *inside* the parenthetical column
#: list, where it separates columns rather than deliverables.
_OUTPUT_SEPARATOR = ","

#: "/" is deliberately **not** a separator here. Nine cells carry one at top level and in
#: every case it belongs to the deliverable's own name — "Frequency / interval control
#: flowchart", "Price / monetization-model research table" — so splitting on it would
#: invent deliverables that the source never declares.


def _split_top_level(text, separator, field):
    """Split ``text`` on ``separator``, ignoring separators inside parentheses.

    Unbalanced parentheses raise: they make the depth wrong for the whole remainder of
    the cell, which merges deliverables instead of separating them.
    """
    parts = []
    current = []
    depth = 0
    for character in text:
        if character == "(":
            depth += 1
        elif character == ")":
            depth -= 1
            if depth < 0:
                raise ExtractionError(
                    f"a '{field}' cell has unbalanced parentheses: {text!r}"
                )
        if character == separator and depth == 0:
            parts.append("".join(current))
            current = []
        else:
            current.append(character)
    if depth != 0:
        raise ExtractionError(f"a '{field}' cell has unbalanced parentheses: {text!r}")

    parts.append("".join(current))
    return [part.strip() for part in parts if part.strip()]


def parse_outputs(raw):
    """Split an ``Output deliverables`` cell into ``[{name, shape}]``.

    ``shape`` is the parenthetical column list the source attaches to a deliverable —
    "(policy × this plan's positioning × expected contribution × constraints)" — or
    ``None`` where it attaches none. It is kept as a single string rather than split into
    columns: the separator inside it varies (``×``, ``/``, ``:``) and H0 transcribes the
    declaration rather than interpreting it.

    Every one of the 255 rows declares at least one output, so an empty cell raises. So
    does a parenthetical that does not close its deliverable: in all 255 cells the column
    list is the deliverable's tail, and text after the closing ")" would mean the
    parenthetical is something else, part of which would then be mislabelled as a shape.
    """
    field = "Output deliverables"
    parts = _split_top_level(raw.strip(), _OUTPUT_SEPARATOR, field)
    if not parts:
        raise ExtractionError(
            f"a '{field}' cell is empty, but every row declares at least one output"
        )

    outputs = []
    for part in parts:
        opened = part.find("(")
        if opened < 0:
            outputs.append({"name": part, "shape": None})
            continue
        if not part.endswith(")"):
            raise ExtractionError(
                f"a '{field}' cell states a parenthetical that does not close its "
                f"deliverable, so part of the name would be read as its shape: {part!r}"
            )
        name = part[:opened].strip()
        shape = part[opened + 1 : -1].strip()
        if not name or not shape:
            raise ExtractionError(
                f"a '{field}' cell declares a deliverable with an empty name or an "
                f"empty shape: {part!r}"
            )
        outputs.append({"name": name, "shape": shape})

    return outputs
