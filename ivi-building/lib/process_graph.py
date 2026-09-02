"""Deterministic extractor for the IVI SYS.1-SYS.2 process graph.

Transcribes the two tracked IVI process source documents into one machine-readable
artifact. Every function here is pure: it takes text and returns data, so none needs a
fixture larger than a string.

Two rules shape the whole module:

* **UTF-8 is pinned on every read and write.** The console default on this platform is
  cp932, under which a bare ``open()`` on either source document raises
  ``UnicodeDecodeError``.
* **Unrecognised input is a hard failure, never a silent drop.** A labelled bullet the
  parser does not know, a dependency notation it cannot resolve, a table row or rating
  glyph outside the whitelist, a heading it cannot read, or content stranded in a
  section's preamble would all mean source content disappearing without a trace. That is
  the one failure mode this milestone exists to prevent, so every one of them raises.

  The claim is about the whole extraction, so it holds section by section: sections 2, 3
  and 4 of the process list each carry the same four guards — a label whitelist, a
  heading guard, a preamble guard and a body-line guard — and the Application Map carries
  the two that apply to the single line H0 transcribes from it. A guard covering one
  section only would leave the claim untrue one section over.

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


#: The outer separator of an ``Input deliverables`` cell, used wherever the source writes
#: one. Two cells do: ``PH1`` and ``SYS1-02-r``. In ``SYS1-02-r`` the semicolon is what
#: keeps "Updated persona sheet, context matrix, and value statement" one deliverable
#: instead of three, so preferring it is load-bearing rather than cosmetic.
_INPUT_OUTER_SEPARATOR = ";"

#: The separator the other 253 cells use, at parenthesis depth zero only.
_INPUT_SEPARATOR = ","


def parse_inputs(raw):
    """Split an ``Input deliverables`` cell into its declared deliverables, **verbatim**.

    Returns a list of strings in source order. The separator is the document's own: where
    the cell states a ";" at parenthesis depth zero that is the outer separator and the
    commas inside an item belong to its name; where it states none, the top-level comma
    separates. Splitting a ";" cell on its commas as well would invent deliverables —
    ``SYS1-02-r``'s first item states three names inside one deliverable — which is the
    defect ``parse_outputs`` refuses to make for the same reason.

    Nothing is normalised beyond stripping outer whitespace. An empty cell raises: all 255
    rows declare at least one input deliverable.
    """
    field = "Input deliverables"
    text = raw.strip()
    if not text:
        raise ExtractionError(
            f"an '{field}' cell is empty, but every row declares at least one input"
        )

    items = _split_top_level(text, _INPUT_OUTER_SEPARATOR, field)
    if len(items) == 1:
        items = _split_top_level(text, _INPUT_SEPARATOR, field)
    if not items:
        raise ExtractionError(
            f"an '{field}' cell states only separators: {raw!r}"
        )
    return items


#: The separator between two declared input sources, at parenthesis depth zero only.
_INPUT_SOURCE_SEPARATOR = "/"

#: A "/" written tight against a neighbour. All 255 ``Input source`` cells spell the
#: separator " / ", spaces included, so a tight "/" is a spelling the document does not
#: use: either part of a source's own name, where splitting would invent a source, or a new
#: separator. Both are a human's call, so it raises rather than being absorbed.
_UNSPACED_SLASH = re.compile(r"\S/|/\S")


def parse_input_sources(raw):
    """Split an ``Input source`` cell into the sources it names, **verbatim**.

    Returns a list of strings in source order, split on the document's " / " at parenthesis
    depth zero. 104 of the 255 cells name a single source and state no separator, which
    yields one item rather than none; a parenthesised qualifier stays with the source it
    follows.

    An empty cell raises, as does a "/" not spelled the document's way.
    """
    field = "Input source"
    text = raw.strip()
    if not text:
        raise ExtractionError(
            f"an '{field}' cell is empty, but every row names at least one source"
        )

    unspaced = _UNSPACED_SLASH.search(text)
    if unspaced:
        raise ExtractionError(
            f"an '{field}' cell states a '/' that is not the document's ' / ' separator, "
            f"so splitting on it would invent a source: {text!r}"
        )

    items = _split_top_level(text, _INPUT_SOURCE_SEPARATOR, field)
    if not items:
        raise ExtractionError(f"an '{field}' cell states only separators: {raw!r}")
    return items


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


def parse_examples(raw):
    """Split a ``Concrete examples`` cell into its items, **verbatim**.

    Returns a list of strings in source order. The 236 work items number three items
    ①②③; the 19 phase and activity rows point at their children ("(see the work items
    beneath) …") in one unnumbered sentence, which yields exactly one item rather than
    none.

    Nothing is normalised beyond stripping outer whitespace — not the quote marks, not
    the internal spacing, not the "/" inside an item. These strings are the calibration
    set later milestones hand unmodified to an authoring step, so a paraphrase here is a
    defect rather than a tidy-up. An empty cell raises: every row states examples.

    The circled-marker split is shared with ``split_dod`` rather than reimplemented, so
    the two cannot disagree about what ① means — including the exclusion of the
    document's own ``Phase ①`` prose.
    """
    return _split_marked_cell(raw, "Concrete examples")


# --- table-shaped sections ----------------------------------------------------------
#
# Sections 2 and 3 of the process list, and section 2 of the Application Map, state their
# content as two-column Markdown tables under ``###``/``####`` headings rather than as the
# labelled bullets section 4 uses. They get the same accounting section 4 has — an
# explicit label whitelist, a heading guard, a preamble guard and a body-line guard —
# because this module's "unrecognised input is never a silent drop" claim is about the
# whole extraction, not about one section of one document.

#: Section names, used in both the section lookups and the error messages so a message
#: always names the region a reader has to open.
_PROCESS_OVERVIEW = "Process Overview"
_DEPENDENCY_SUMMARY = "Dependency Summary"
_AI_APPLICATION = "Process x AI Application"

_SECTION_2_HEADING = re.compile(r"^## 2\. Process Overview[^\n]*$", re.MULTILINE)
_SECTION_3_HEADING = re.compile(r"^## 3\. Dependency Summary[^\n]*$", re.MULTILINE)
#: The Application Map's own section 2. Its heading multiplication sign is U+00D7.
_MAP_SECTION_2_HEADING = re.compile(
    r"^## 2\. Process × AI Application[^\n]*$", re.MULTILINE
)

#: Any ``## `` heading, which is where one numbered section ends and the next begins.
_TOP_LEVEL_HEADING = re.compile(r"^## ", re.MULTILINE)

#: ``#### 1. Organizing the starting point …``. Both the Process Overview and the
#: Application Map's section 2 number their 16 activity blocks this way.
#: The block name is matched but not captured: H0 takes every node's name from section
#: 4's own row heading, so a second spelling of it here would be a field with two sources.
_ACTIVITY_BLOCK_HEADING = re.compile(
    r"^####[ ](?P<number>\d{1,2})\.[ ].+?[ ]*$", re.MULTILINE
)

#: ``### Phase ① …``. The three group headings inside those two sections. They introduce
#: blocks and hold no fields of their own, so they are allowed but never parsed.
_PHASE_GROUP_HEADING = re.compile(r"^###[ ]Phase[ ][①-③][ ].*$", re.MULTILINE)

#: The source document defines 16 activities. A block numbered outside that range names
#: no row, so its content could never be attached to anything.
_ACTIVITY_COUNT = 16

#: ``| **Label** | value |`` — one line per field. Neither section wraps a cell.
_TABLE_ROW = re.compile(
    r"^\|[ ]*\*\*(?P<label>[^|*]+?)\*\*[ ]*\|(?P<value>.*)\|[ ]*$", re.MULTILINE
)

#: The lines that open a Markdown table. Section 2 heads its columns "Item / Content";
#: section 3 leaves both header cells empty. Neither line carries content.
_TABLE_HEAD_LINES = ("| Item | Content |", "| | |", "|---|---|")

#: A trailing parenthetical on a label, stripped before matching. Three Process Overview
#: labels carry one on activity 1 only — ``Outline (what this step does)``,
#: ``Owner (executing party)``, ``Completion criterion (condition to move on)`` — so both
#: spellings must resolve to one field. No label's meaning lives in its parenthetical.
_TRAILING_PARENTHETICAL = re.compile(r"[ ]*\([^()]*\)$")


def _bounded_section(text, heading, section_name):
    """Return one numbered section's body, from its heading to the next ``## `` heading."""
    match = heading.search(text)
    if match is None:
        raise ExtractionError(f"the source document has no '{section_name}' section")
    following = _TOP_LEVEL_HEADING.search(text, match.end())
    end = following.start() if following else len(text)
    return text[match.end() : end]


def _canonical_label(label):
    """A table label with its trailing parenthetical stripped."""
    return _TRAILING_PARENTHETICAL.sub("", label.strip())


def _reject_unparsed_section_headings(section, headings, section_name):
    """Fail loudly on a heading the activity-block pattern did not match.

    Section 4's counterpart is ``_reject_unparsed_headings``. A heading that cannot be
    read loses its block's identity as well as its content, because the heading is what
    carries the activity number.
    """
    matched = {match.start() for match in headings}
    groups = {match.start() for match in _PHASE_GROUP_HEADING.finditer(section)}
    for candidate in _ANY_HEADING.finditer(section):
        if candidate.start() in matched or candidate.start() in groups:
            continue
        raise ExtractionError(
            f"unrecognised heading in the {section_name} section, which would drop an "
            f"activity block: {candidate.group(0)!r}"
        )


def _activity_blocks(section, section_name):
    """Split a ``#### N. name``-headed section into ``(preamble, blocks)``.

    ``blocks`` is ``[(activity_id, body)]`` in document order. The block number is
    translated to a row ID by the document's own rule — activities 1-9 are ``SYS1``,
    10-16 ``SYS2`` — so callers key their output by the ID the rows use rather than by a
    block number no node carries.

    ``preamble`` is returned rather than checked here, because what a preamble may
    legitimately hold differs per section: the Process Overview's holds nothing but its
    phase headings, while the Application Map's holds a rating legend. Each caller applies
    its own equivalent of ``_reject_unparsed_preamble``.

    No count is asserted. The 16-block expectation is a property of the assembled graph,
    checked where the 255-row count is, so a fixture holding one block stays parseable.
    """
    headings = list(_ACTIVITY_BLOCK_HEADING.finditer(section))
    _reject_unparsed_section_headings(section, headings, section_name)
    if not headings:
        raise ExtractionError(f"the {section_name} section holds no activity blocks")

    blocks = []
    for position, heading in enumerate(headings):
        end = (
            headings[position + 1].start()
            if position + 1 < len(headings)
            else len(section)
        )
        number = int(heading.group("number"))
        if not 1 <= number <= _ACTIVITY_COUNT:
            raise ExtractionError(
                f"the {section_name} section numbers an activity {number}, but the source "
                f"document defines {_ACTIVITY_COUNT}: {heading.group(0)!r}"
            )
        blocks.append((_activity_id(number), section[heading.end() : end]))

    return section[: headings[0].start()], blocks


def _parse_labelled_table(body, fields, context):
    """Capture one block's two-column table against an explicit label whitelist.

    ``fields`` maps each canonical label to its output key; ``context`` names the block in
    every error, since a table body carries no identity of its own. Values are returned
    verbatim apart from stripping outer whitespace, keyed in ``fields`` declaration order
    rather than in the order the rows happen to appear — byte-identical re-extraction
    depends on the output order, and it must not follow a source-formatting accident.

    Three conditions stop the extraction. A label outside ``fields`` means an unaccounted
    row, so source content would be dropped silently — the same reason ``_parse_bullets``
    hard-fails on an eleventh bullet. A missing label means a field the schema requires
    would be absent. And a non-blank line that is neither a parsed row nor a table head
    means a row whose formatting the pattern cannot read, which would be skipped between
    the two patterns without a trace. Headings are skipped here because
    ``_reject_unparsed_section_headings`` has already accounted for every one of them.
    """
    parsed = {match.group(0) for match in _TABLE_ROW.finditer(body)}
    for line in body.splitlines():
        stripped = line.strip()
        if (
            not stripped
            or stripped == _BODY_SEPARATOR
            or stripped.startswith("#")
            or stripped in _TABLE_HEAD_LINES
            or line in parsed
        ):
            continue
        raise ExtractionError(
            f"{context} holds content this extractor does not parse: {line!r}"
        )

    values = {}
    for row in _TABLE_ROW.finditer(body):
        label = _canonical_label(row.group("label"))
        if label not in fields:
            raise LabelError(
                f"{context} carries an unknown table label {label!r}; an unaccounted row "
                "means source content would be dropped silently"
            )
        key = fields[label]
        if key in values:
            raise LabelError(f"{context} repeats the table label {label!r}")
        value = row.group("value").strip()
        if not value:
            raise ExtractionError(f"{context} states an empty {label!r} value")
        values[key] = value

    missing = [label for label, key in fields.items() if key not in values]
    if missing:
        raise LabelError(
            f"{context} is missing the table row(s) "
            + ", ".join(repr(label) for label in missing)
        )

    return {key: values[key] for key in fields.values()}


# --- Process Overview (section 2) ---------------------------------------------------

#: The Process Overview's six labels in the document's own order, canonical spelling to
#: node field. Activity 1 spells three of them with a trailing parenthetical, which
#: ``_canonical_label`` strips so both spellings land on one field.
OVERVIEW_FIELDS = {
    "Outline": "outline",
    "Main outputs": "main_outputs",
    "Owner": "owner",
    "Departments involved": "departments",
    "Completion criterion": "completion_criterion",
    "Common pitfall": "common_pitfall",
}


def parse_overview(text):
    """Read the Process Overview into ``{activity_id: {six fields}}``.

    Keyed by activity ID — ``SYS1-01`` … ``SYS2-16`` — in document order, each value
    holding ``outline``, ``main_outputs``, ``owner``, ``departments``,
    ``completion_criterion`` and ``common_pitfall``.

    Returning a mapping rather than a per-row field is deliberate: the overview exists for
    the 16 activities only, and the published schema forbids the key on L1 and L3 nodes, so
    the node builder attaches it where the mapping has an entry and omits it — rather than
    writing ``null`` — everywhere else.

    Section 2 gets the same three guards section 4 has: an unreadable heading, stranded
    preamble content and an unparseable table row each stop the extraction.
    """
    section = _bounded_section(text, _SECTION_2_HEADING, _PROCESS_OVERVIEW)
    preamble, blocks = _activity_blocks(section, _PROCESS_OVERVIEW)
    _reject_unparsed_overview_preamble(preamble)

    overview = {}
    for activity_id, body in blocks:
        if activity_id in overview:
            raise ExtractionError(
                f"the {_PROCESS_OVERVIEW} section states {activity_id} twice"
            )
        overview[activity_id] = _parse_labelled_table(
            body, OVERVIEW_FIELDS, f"{_PROCESS_OVERVIEW} block {activity_id}"
        )

    return overview


def _reject_unparsed_overview_preamble(preamble):
    """Fail loudly on content between the section 2 heading and its first activity block.

    Section 2's preamble legitimately holds nothing but its phase group headings, so a
    table row stranded there belongs to no block and would vanish without the extractor
    ever noticing. This is ``_reject_unparsed_preamble`` one section over.
    """
    for line in preamble.splitlines():
        stripped = line.strip()
        if not stripped or stripped == _BODY_SEPARATOR or stripped.startswith("#"):
            continue
        raise ExtractionError(
            f"content between the {_PROCESS_OVERVIEW} heading and its first activity "
            f"block is not parsed by this extractor: {line!r}"
        )


# --- F1-F9 ratings (Application Map section 2) --------------------------------------

#: The four rating glyphs of data-model.md, **keyed by codepoint and never matched by
#: eye**. ``◯`` is U+25EF LARGE CIRCLE, not the visually near-identical U+25CB WHITE
#: CIRCLE; keying this table on the wrong one would empty ``effective`` on every activity
#: without raising anything, which is the one failure here that produces plausible-looking
#: output. An unlisted glyph therefore stops the extraction naming its codepoint.
RATING_GLYPHS = {
    "◎": "primary",  # ◎ BULLSEYE — "used as a primary function"
    "◯": "effective",  # ◯ LARGE CIRCLE — "usable effectively"
    "△": "auxiliary",  # △ WHITE UP-POINTING TRIANGLE — "usable as an auxiliary"
    "－": None,  # － FULLWIDTH HYPHEN-MINUS — "not used", so omitted entirely
}

#: The three rating lists, in the order the Legend states them. Fixes output key order,
#: which byte-identical re-extraction depends on.
RATING_KINDS = ("primary", "effective", "auxiliary")

#: The nine agent functions the Application Map rates on every activity.
_FUNCTION_COUNT = 9

#: ``**F1–F9:** F1 ◎ · F2 ◯ · …``, with U+2013 EN DASH in the heading. Anchored at the
#: line start so the section's own ``**Legend for F1–F9:**`` line is not read as a rating.
_MAP_RATING_LINE = re.compile(r"^\*\*F1–F9:\*\*[ ](?P<ratings>.+?)[ ]*$", re.MULTILINE)

#: The separator between two ratings on one line: U+00B7 MIDDLE DOT.
_RATING_SEPARATOR = " · "

#: ``F4 ◯`` — one function number and one glyph, and nothing else.
_RATING = re.compile(r"F(?P<number>\d)[ ](?P<glyph>.)")


def parse_f_ratings(text):
    """Read the Application Map's 16 rating lines into
    ``{activity_id: {primary, effective, auxiliary}}``.

    Each value lists the ``F1``…``F9`` names rated with that glyph, in function-number
    order; a ``U+FF0D`` rating is omitted from all three lists rather than recorded as a
    fourth, so the three lists partition the functions the source actually rates.

    Returned as a mapping for the same reason ``parse_overview`` is: ratings exist for the
    16 activities only, and the published schema forbids the ``f_ratings`` key on L1 and L3
    nodes, so the node builder omits the key rather than writing ``null``.

    A rating's *position* in the line is its only handle on which function it rates, so an
    out-of-order or missing function number stops the extraction rather than silently
    re-attributing a rating. So does an unlisted glyph, a block with no rating line, a
    block with two, and a rating line stranded ahead of the first block.
    """
    section = _bounded_section(text, _MAP_SECTION_2_HEADING, _AI_APPLICATION)
    preamble, blocks = _activity_blocks(section, _AI_APPLICATION)
    _reject_stranded_rating_line(preamble)

    ratings = {}
    for activity_id, body in blocks:
        if activity_id in ratings:
            raise ExtractionError(
                f"the {_AI_APPLICATION} section states {activity_id} twice"
            )
        ratings[activity_id] = _parse_rating_line(body, activity_id)

    return ratings


def _reject_stranded_rating_line(preamble):
    """Fail loudly on a rating line ahead of the first activity block.

    Every rating line belongs to exactly one block, and the blocks cover the section from
    the first heading onwards — so the preamble is the one region a rating line could hide
    in unaccounted, exactly as section 4's preamble was for a labelled bullet.

    This guard is narrowed to the rating line rather than rejecting all unrecognised
    preamble content, because H0 transcribes only that line from this document: the
    section legitimately opens with a rating legend and a cross-reference, and neither is
    extracted by anything.
    """
    stranded = _MAP_RATING_LINE.search(preamble)
    if stranded:
        raise ExtractionError(
            f"the {_AI_APPLICATION} section states a rating line ahead of its first "
            f"activity block, so it belongs to no activity: {stranded.group(0)!r}"
        )


def _parse_rating_line(body, activity_id):
    """Resolve one activity block's ``**F1–F9:**`` line into the three rating lists."""
    lines = list(_MAP_RATING_LINE.finditer(body))
    if not lines:
        raise ExtractionError(
            f"activity {activity_id} states no '**F1–F9:**' rating line, so it would "
            "silently carry no ratings at all"
        )
    if len(lines) > 1:
        raise ExtractionError(
            f"activity {activity_id} states {len(lines)} '**F1–F9:**' rating lines, so "
            "which one rates the activity is undetermined"
        )

    line = lines[0]
    entries = line.group("ratings").split(_RATING_SEPARATOR)
    if len(entries) != _FUNCTION_COUNT:
        raise ExtractionError(
            f"activity {activity_id} rates {len(entries)} functions rather than "
            f"{_FUNCTION_COUNT}: {line.group(0)!r}"
        )

    ratings = {kind: [] for kind in RATING_KINDS}
    for position, entry in enumerate(entries, start=1):
        match = _RATING.fullmatch(entry)
        if match is None:
            raise ExtractionError(
                f"activity {activity_id} states a rating this extractor cannot read: "
                f"{entry!r} (in {line.group(0)!r})"
            )
        if int(match.group("number")) != position:
            raise ExtractionError(
                f"activity {activity_id} numbers its ratings out of order at position "
                f"{position}, which would re-attribute a rating to another function: "
                f"{entry!r}"
            )

        glyph = match.group("glyph")
        if glyph not in RATING_GLYPHS:
            known = ", ".join(
                f"{candidate!r} (U+{ord(candidate):04X})" for candidate in RATING_GLYPHS
            )
            raise ExtractionError(
                f"activity {activity_id} rates F{position} with the unknown glyph "
                f"{glyph!r} (U+{ord(glyph):04X}); the Legend defines {known}"
            )

        kind = RATING_GLYPHS[glyph]
        if kind is not None:
            ratings[kind].append(f"F{position}")

    return ratings


# --- Dependency Summary (section 3) --------------------------------------------------

#: The section's ten headings, matched by prefix, to the entry kind. Prefix rather than
#: exact spelling because eight of the ten qualify themselves after a U+2014 em dash
#: ("External lead time — research"); of the other two, one qualifies itself in a
#: parenthetical and one is bare. Measured distribution: ``critical_path`` 1,
#: ``external_lead_time`` 2, ``hard_deadline`` 1, ``confluence`` 2, ``parallel`` 2,
#: ``rework`` 2. The kinds drive three derived node flags, so a heading matching no prefix
#: stops the extraction rather than defaulting — a mis-filed entry flags the wrong rows.
DEPENDENCY_KIND_PREFIXES = (
    ("Critical path", "critical_path"),
    ("External lead time", "external_lead_time"),
    ("Hard deadline", "hard_deadline"),
    ("Confluence point", "confluence"),
    ("Work that can run in parallel", "parallel"),
    ("Path prone to rework", "rework"),
)

#: The four table labels of a Dependency Summary entry, canonical spelling to output key.
DEPENDENCY_SUMMARY_FIELDS = {
    "Content": "content",
    "Path / target steps": "path_raw",
    "Impact if delayed": "impact",
    "What to get ahead of": "mitigation",
}

#: ``### Critical path (main series)`` — one heading per entry, all at one level.
_DEPENDENCY_ENTRY_HEADING = re.compile(r"^###[ ](?P<title>.+?)[ ]*$", re.MULTILINE)

#: The connectives the Dependency Summary writes between two path targets. Section 4's
#: dependency cells use none of them, so each is normalised to the "," that
#: ``parse_edge_cell`` already reads rather than taught to that resolver: one resolver,
#: two spellings of a target list. A connective this list does not name reaches
#: ``parse_edge_cell`` and raises there, which is the intended escalation.
#:
#: Note ``→`` is a *sequence*, not a range: ``SYS1-02-n → SYS1-02-p`` states two targets
#: and must not become the span ``n, o, p``. Turning it into a separator rather than a
#: range operator is what enforces that.
_DEPENDENCY_PATH_CONNECTIVES = (
    "→",  # U+2192, the sequence arrow — 8 of the 10 entries
    "+",  # a confluence of several series
    "/",  # two independent series stated in one entry
    " can start partway through ",
    " run in parallel after ",
    " and ",
)

#: Prose the Dependency Summary states in place of a path target. Like ``parse_edge_cell``'s
#: ``_PROSE`` it names nothing in this process, so it yields no node; unlike it, the entry
#: keeps ``path_raw`` verbatim, and that is where the prose stays accounted for rather than
#: being lost. Removed before the connectives, so an "and" it contains is not read as one.
_DEPENDENCY_PATH_PROSE = (
    "updates to the requirements list, screens, flows, and sequences",
)


def parse_dependency_summary(text):
    """Read the Dependency Summary into a list of 10 entries, in document order.

    Each entry holds ``kind``, ``title``, ``content``, ``path_raw``, ``path_nodes``,
    ``impact`` and ``mitigation``. ``path_raw`` is the source cell **verbatim**, so a later
    milestone can widen the resolved set without re-extracting.

    ``path_nodes`` holds only the IDs the source actually lists. ``SYS1-02-n → SYS1-02-p``
    yields two nodes, **not** the span ``n, o, p``: the arrow is a sequence, and expanding
    it would assert coverage the source never states — ``SYS1-02-o`` is plainly external
    work but is not listed, so it is not flagged. A notation the source writes *as* a range
    (``SYS1-03-a through -f``) does expand, because that is what it says. Both are resolved
    by ``parse_edge_cell``; no second resolver exists.

    Section 3 gets the same accounting sections 2 and 4 have: an unreadable or unknown
    heading, stranded preamble content, an unparseable table row, an unknown label, a
    missing label, and an identifier that resolved to no node each stop the extraction.
    """
    section = _bounded_section(text, _SECTION_3_HEADING, _DEPENDENCY_SUMMARY)

    headings = list(_DEPENDENCY_ENTRY_HEADING.finditer(section))
    _reject_unparsed_dependency_headings(section, headings)
    if not headings:
        raise ExtractionError(
            f"the {_DEPENDENCY_SUMMARY} section holds no dependency entries"
        )
    _reject_unparsed_dependency_preamble(section[: headings[0].start()])

    entries = []
    for position, heading in enumerate(headings):
        end = (
            headings[position + 1].start()
            if position + 1 < len(headings)
            else len(section)
        )
        title = heading.group("title")
        # Classified before the table is read, so an unrecognised heading is reported as
        # itself rather than as whatever its body happens to be missing.
        kind = _dependency_kind(title)
        cells = _parse_labelled_table(
            section[heading.end() : end],
            DEPENDENCY_SUMMARY_FIELDS,
            f"{_DEPENDENCY_SUMMARY} entry {title!r}",
        )

        entries.append(
            {
                "kind": kind,
                "title": title,
                "content": cells["content"],
                "path_raw": cells["path_raw"],
                "path_nodes": _dependency_path_nodes(cells["path_raw"], title),
                "impact": cells["impact"],
                "mitigation": cells["mitigation"],
            }
        )

    return entries


def _dependency_kind(title):
    """Classify one entry heading, or raise if it matches no known prefix."""
    for prefix, kind in DEPENDENCY_KIND_PREFIXES:
        if title.startswith(prefix):
            return kind
    raise ExtractionError(
        f"the {_DEPENDENCY_SUMMARY} section states the entry {title!r}, whose kind this "
        "extractor does not recognise; the kinds drive three derived node flags, so "
        "guessing one would flag the wrong rows"
    )


def _reject_unparsed_dependency_headings(section, headings):
    """Fail loudly on a heading the entry pattern did not match.

    Section 3 states its entries at one level, so a nested heading would put an entry's
    content inside its predecessor's body and lose the entry itself.
    """
    matched = {match.start() for match in headings}
    for candidate in _ANY_HEADING.finditer(section):
        if candidate.start() in matched:
            continue
        raise ExtractionError(
            f"unrecognised heading in the {_DEPENDENCY_SUMMARY} section, which would drop "
            f"an entry: {candidate.group(0)!r}"
        )


def _reject_unparsed_dependency_preamble(preamble):
    """Fail loudly on content between the section 3 heading and its first entry.

    Section 3's preamble legitimately holds nothing at all, so a table row stranded there
    belongs to no entry and would vanish unnoticed. ``_reject_unparsed_preamble``, one
    section over again.
    """
    for line in preamble.splitlines():
        stripped = line.strip()
        if not stripped or stripped == _BODY_SEPARATOR or stripped.startswith("#"):
            continue
        raise ExtractionError(
            f"content between the {_DEPENDENCY_SUMMARY} heading and its first entry is "
            f"not parsed by this extractor: {line!r}"
        )


def _dependency_path_nodes(path_raw, title):
    """Resolve one ``Path / target steps`` cell into the node IDs it lists."""
    reduced = path_raw
    for prose in _DEPENDENCY_PATH_PROSE:
        reduced = reduced.replace(prose, "")
    for connective in _DEPENDENCY_PATH_CONNECTIVES:
        reduced = reduced.replace(connective, ",")

    try:
        ids, external_refs = parse_edge_cell(reduced, title)
    except UnknownNotation as error:
        raise UnknownNotation(
            f"the {_DEPENDENCY_SUMMARY} entry {title!r} states a path target this "
            f"extractor does not recognise: {path_raw!r} (reduced to {reduced!r})"
        ) from error

    if external_refs:
        raise ExtractionError(
            f"the {_DEPENDENCY_SUMMARY} entry {title!r} states the prose target "
            f"{external_refs[0]!r}, which no entry of this section is known to use; its "
            "handling would be a guess"
        )
    if not ids:
        raise ExtractionError(
            f"the {_DEPENDENCY_SUMMARY} entry {title!r} resolved to no target at all: "
            f"{path_raw!r}"
        )

    _reject_dropped_path_identifiers(path_raw, ids, title)
    return ids


def _reject_dropped_path_identifiers(path_raw, ids, title):
    """Fail loudly on an identifier stated in the path cell that resolved to no node.

    Prose fragments and connectives are removed before the cell reaches
    ``parse_edge_cell``, so this is the check that the removal dropped no declared target:
    every ``SYS…``/``PH…`` token the source wrote must come back out. Without it, a revision
    that extended a prose fragment over an ID would lose it and nothing would notice.

    It compares identifier *tokens* rather than counts, because a range legitimately writes
    one token and yields six nodes. The pattern is the one ``parse_edge_cell`` uses for the
    same purpose, so the two cannot disagree about what an identifier is.
    """
    resolved = set(ids)
    for token in _IDENTIFIER_IN_PROSE.finditer(path_raw):
        if token.group(0) not in resolved:
            raise ExtractionError(
                f"the {_DEPENDENCY_SUMMARY} entry {title!r} states {token.group(0)!r} in "
                "its path but resolved it to no node, so a declared target would be "
                f"dropped silently: {path_raw!r}"
            )


# --- node assembly -------------------------------------------------------------------

#: The three phases and the activity numbers each covers, taken from the source's own
#: grouping: the process list heads its Process Overview blocks ``### Phase ①``
#: (activities 1-6), ``### Phase ②`` (7-9) and ``### Phase ③`` (10-16). The ``SYS1``/``SYS2``
#: prefix does **not** determine the phase — ``SYS1-07`` is in ``PH2`` — so the ranges are
#: stated here rather than derived from it.
PHASE_ACTIVITY_RANGES = (
    ("PH1", 1, 6),
    ("PH2", 7, 9),
    ("PH3", 10, 16),
)

#: The three phase IDs, derived from the ranges so the two cannot drift apart.
PHASE_IDS = tuple(phase for phase, _, _ in PHASE_ACTIVITY_RANGES)

#: The two values ``ai_applicability`` takes on the 7 rows that state it, **by codepoint**:
#: ``◯`` U+25EF LARGE CIRCLE on 6 rows and ``★`` U+2605 BLACK STAR on 1. Note U+25EF, *not*
#: the visually near-identical U+25CB WHITE CIRCLE. A third value stops the extraction
#: rather than being absorbed: a look-alike substitution changes what the field means and is
#: invisible to a reader comparing the output against the source by eye.
AI_APPLICABILITY_VALUES = ("◯", "★")

#: The three optional labels, the document's label to the node key. Absence yields ``None``,
#: which is what the contract requires: the key is ``required`` and its type includes
#: ``null``, so omitting it fails validation where ``null`` passes.
OPTIONAL_LABEL_FIELDS = (
    ("ASPICE BP", "aspice_bp"),
    ("AI hypothesis-driven applicability", "ai_applicability"),
    ("Rationale", "rationale"),
)

#: The length of an activity ID, which is also the prefix length of a work-item ID.
_ACTIVITY_ID_LENGTH = len("SYS1-01")


def build_nodes(rows, overview, f_ratings):
    """Assemble ``parse_rows`` output into nodes, in source-document order.

    ``overview`` and ``f_ratings`` are the two mappings ``parse_overview`` and
    ``parse_f_ratings`` return, both keyed by activity ID. They are attached to the 16 L2
    nodes **only**: the published contract sets ``additionalProperties: false`` on a node and
    states ``not: {required: [f_ratings, overview]}`` for L1 and L3, so a ``null`` there
    fails validation exactly as a populated object would. The three optional labels go the
    other way — ``aspice_bp``, ``ai_applicability`` and ``rationale`` are ``required`` keys
    whose type includes ``null``, so an absent label becomes ``None`` rather than a missing
    key.

    Key order is fixed by this function and matters: the artifact is serialised in insertion
    order and re-extraction must be byte-identical.

    ``conditional_skip`` is carried as the nullable key the contract names, and
    ``build_nodes`` never sets it non-null — detecting a skip-prescribing entry condition is
    a separate derivation, as are ``external_refs``, the granularity pair, the gate and
    dependency flags and the two thread memberships. Those fields are absent here rather
    than guessed.

    Everything that would otherwise attach source content to nothing, or nothing to a node,
    is a hard failure: a duplicate row ID, an activity number the three phases do not cover,
    a prefix contradicting that number, an activity with no overview block or no rating set,
    an overview block or rating set naming no activity row, an empty required cell, and an
    ``ai_applicability`` value outside the two the document states.
    """
    nodes = []
    seen = set()
    for row in rows:
        row_id = row["id"]
        if row_id in seen:
            raise ExtractionError(
                f"the process list states row {row_id!r} twice, so every later lookup of "
                "it would be ambiguous"
            )
        seen.add(row_id)
        nodes.append(_build_node(row, overview, f_ratings))

    # After the nodes exist, not before: a leftover key is only detectable against the set
    # of activities the rows actually declare.
    _reject_unclaimed_activity_content(nodes, overview, f_ratings)
    return nodes


def _build_node(row, overview, f_ratings):
    """Assemble one row into a node, naming the row in every error it raises."""
    row_id, level, labels = row["id"], row["level"], row["labels"]
    parent, phase = _parent_and_phase(row_id, level)

    node = {
        "id": row_id,
        "level": level,
        "parent": parent,
        "phase": phase,
        "name": _required_text(row["name"], "name", row_id),
        "purpose": _required_text(labels["Purpose"], "Purpose", row_id),
        "work_content": _required_text(labels["Work content"], "Work content", row_id),
    }
    node["inputs"] = _parsed_cell(parse_inputs, labels, "Input deliverables", row_id)
    node["input_sources"] = _parsed_cell(
        parse_input_sources, labels, "Input source", row_id
    )
    node["outputs"] = _parsed_cell(parse_outputs, labels, "Output deliverables", row_id)
    node["entry"] = _required_text(labels["Entry"], "Entry", row_id)
    node["exit_dod"] = _parsed_cell(split_dod, labels, "Exit (DoD)", row_id)
    node["examples"] = _parsed_cell(parse_examples, labels, "Concrete examples", row_id)

    for label, key in OPTIONAL_LABEL_FIELDS:
        node[key] = _optional_text(labels, label, row_id)
    _check_ai_applicability(node["ai_applicability"], row_id)

    node["predecessors_raw"] = _required_text(
        labels["Predecessor / Successor"], "Predecessor / Successor", row_id
    )
    node["conditional_skip"] = None

    if level == "L2":
        node["f_ratings"] = _activity_content(f_ratings, row_id, "'**F1–F9:**' rating set")
        node["overview"] = _activity_content(overview, row_id, f"{_PROCESS_OVERVIEW} block")

    return node


def _parent_and_phase(row_id, level):
    """Resolve one row's ``(parent, phase)`` from its ID and level.

    ``parent`` is ``None`` for a phase, the phase for an activity, and the activity for a
    work item — parent/child is stated by the ID, not by an edge.
    """
    if level == "L1":
        if row_id not in PHASE_IDS:
            raise ExtractionError(
                f"row {row_id} is an L1 row naming none of the document's three phases "
                f"{PHASE_IDS}"
            )
        return None, row_id

    activity = row_id if level == "L2" else row_id[:_ACTIVITY_ID_LENGTH]
    phase = _phase_of_activity(activity, row_id)
    return (phase if level == "L2" else activity), phase


def _phase_of_activity(activity, row_id):
    """Return the phase an activity belongs to, or raise if the ID contradicts the source.

    ``_ROW_HEADING`` admits any two-digit activity number, so both checks here are load
    bearing: ``SYS1-99`` names an activity the document does not define, and ``SYS2-05``
    contradicts the document's own rule about which prefix carries which numbers. Either
    one silently attaches the wrong overview block and rating set to a node.
    """
    number = int(activity[len("SYS1-") :])

    phase = None
    for candidate, first, last in PHASE_ACTIVITY_RANGES:
        if first <= number <= last:
            phase = candidate
            break
    if phase is None:
        raise ExtractionError(
            f"row {row_id} names activity {number}, but the source document groups its "
            f"{_ACTIVITY_COUNT} activities into {PHASE_IDS} and this one belongs to none"
        )

    expected = _activity_id(number)
    if expected != activity:
        raise ExtractionError(
            f"row {row_id} names activity {activity!r}, but the document prefixes activity "
            f"{number} {expected!r} — activities 1-{_SYS1_MAX_ACTIVITY} are SYS1 and the "
            "rest SYS2 — so which activity this row names is undetermined"
        )
    return phase


def _required_text(value, field, row_id):
    """One whole-cell string field, stripped, with emptiness a hard failure.

    ``parse_rows`` accepts an empty bullet value: its job is accounting for the label, not
    for the cell. The contract types five node fields ``nonEmptyString``, so this is where
    an empty one stops the extraction.
    """
    text = value.strip()
    if not text:
        raise ExtractionError(
            f"row {row_id} states an empty {field!r} cell, which the contract requires to "
            "be non-empty"
        )
    return text


def _optional_text(labels, label, row_id):
    """One of the three optional labels, or ``None`` where the row states none."""
    if label not in labels:
        return None
    return _required_text(labels[label], label, row_id)


def _parsed_cell(parser, labels, label, row_id):
    """Run one cell parser, re-raising with the row named.

    A cell parser sees a bare string and so reports the field rather than the row — the
    error message says which field is wrong, but a reader still has 255 rows to search. The
    original exception class is preserved, so a ``LabelError`` stays one.
    """
    try:
        return parser(labels[label])
    except ExtractionError as error:
        raise type(error)(f"row {row_id}: {error}") from error


def _check_ai_applicability(value, row_id):
    """Reject an ``ai_applicability`` value outside the two the document states."""
    if value is None or value in AI_APPLICABILITY_VALUES:
        return
    codepoints = " ".join(f"U+{ord(character):04X}" for character in value)
    known = ", ".join(
        f"{candidate!r} (U+{ord(candidate):04X})" for candidate in AI_APPLICABILITY_VALUES
    )
    raise ExtractionError(
        f"row {row_id} states the AI applicability value {value!r} ({codepoints}); the "
        f"document states only {known}"
    )


def _activity_content(source, activity_id, description):
    """Fetch one activity's L2-only content, or raise if the source document states none."""
    if activity_id not in source:
        raise ExtractionError(
            f"activity {activity_id} has no {description}, so it would silently carry none "
            "at all"
        )
    return source[activity_id]


def _reject_unclaimed_activity_content(nodes, overview, f_ratings):
    """Fail loudly on overview or rating content keyed to an activity no row declares.

    This is the silent drop in the other direction: the block parsed cleanly and then
    vanished, because no node claimed it.
    """
    activities = {node["id"] for node in nodes if node["level"] == "L2"}
    for source, description in (
        (overview, _PROCESS_OVERVIEW),
        (f_ratings, "F1–F9 rating"),
    ):
        unclaimed = sorted(key for key in source if key not in activities)
        if unclaimed:
            raise ExtractionError(
                f"the {description} content states {unclaimed[0]!r}, which no activity row "
                "of the process list names, so it would attach to nothing"
            )


# --- graph assembly ------------------------------------------------------------------

#: The schema version this extractor emits, per ``contracts/process_graph.schema.json``.
SCHEMA_VERSION = "1.0"

#: The row counts the source document states, by level, measured on the 2026-08-26
#: revision: 3 phases, 16 activities and 236 work items, 255 rows in total.
#:
#: ``parse_rows`` reports whatever the document holds, so this is the only place a document
#: one row short is caught. It is a hard failure rather than a finding because every count,
#: membership and derived flag this milestone publishes is computed over these rows: a
#: different total means the extractor read a different document than the one H0 was
#: measured against, which a human has to see.
EXPECTED_ROW_COUNTS = {"L1": 3, "L2": 16, "L3": 236}


def build_graph(process_list_text, application_map_text):
    """Assemble the whole artifact from the two source documents' text.

    Returns the six top-level keys the published contract names, in the order it lists them.
    Three of them are empty containers for now: ``edges``, ``thread`` and ``findings`` are
    built by later batches, and an empty container is honest where a plausible-looking
    placeholder would not be. ``meta`` likewise holds only what this function can know — the
    schema version and the four row counts; its provenance keys need each source's path and
    digest, which the text alone does not carry.

    Two checks live here because neither side can make them alone. The 255-row count is one:
    ``parse_rows`` counts nothing, and nothing downstream would notice a document a row
    short. A Dependency Summary path node naming no row is the other:
    ``parse_dependency_summary`` has no node list and ``build_nodes`` never sees the summary,
    so an ID that resolves to nothing would silently set a derived flag on a row no reader
    can look up.
    """
    rows = parse_rows(process_list_text)
    counts = _row_counts(rows)

    nodes = build_nodes(
        rows,
        parse_overview(process_list_text),
        parse_f_ratings(application_map_text),
    )
    dependency_summary = parse_dependency_summary(process_list_text)
    _reject_unresolved_path_nodes(nodes, dependency_summary)

    return {
        "meta": {"schema_version": SCHEMA_VERSION, "counts": counts},
        "nodes": nodes,
        "edges": [],
        "dependency_summary": dependency_summary,
        "thread": {},
        "findings": [],
    }


def _row_counts(rows):
    """Count the rows per level against ``EXPECTED_ROW_COUNTS``, or raise naming what it found.

    Returns ``{L1, L2, L3, total}``. The counts actually found are named in the error,
    because "the wrong number of rows" is not an actionable message for someone holding a
    revised document.
    """
    counts = {level: 0 for level in EXPECTED_ROW_COUNTS}
    for row in rows:
        if row["level"] not in counts:
            raise ExtractionError(
                f"row {row['id']} is at level {row['level']!r}, which this extractor does "
                f"not know; the source document states {tuple(EXPECTED_ROW_COUNTS)}"
            )
        counts[row["level"]] += 1

    if counts != EXPECTED_ROW_COUNTS:
        found = ", ".join(f"{counts[level]} {level}" for level in EXPECTED_ROW_COUNTS)
        expected = ", ".join(
            f"{EXPECTED_ROW_COUNTS[level]} {level}" for level in EXPECTED_ROW_COUNTS
        )
        raise ExtractionError(
            f"the process list holds {found} rows ({sum(counts.values())} in total), but "
            f"this extractor is measured against {expected} "
            f"({sum(EXPECTED_ROW_COUNTS.values())} in total); every count, membership and "
            "derived flag is computed over these rows, so a different document has to reach "
            "a human rather than be extracted as if it were this one"
        )

    return {**counts, "total": sum(counts.values())}


def _reject_unresolved_path_nodes(nodes, dependency_summary):
    """Fail loudly on a Dependency Summary path node that names no row.

    Worse than an unresolved dependency cell: the flags the summary drives — ``critical_path``,
    ``external_lead_time``, ``hard_deadline`` — would be set against an ID no reader can look
    up, and the summary would still look fully resolved.
    """
    node_ids = {node["id"] for node in nodes}
    for entry in dependency_summary:
        for node_id in entry["path_nodes"]:
            if node_id not in node_ids:
                raise ExtractionError(
                    f"the {_DEPENDENCY_SUMMARY} entry {entry['title']!r} states the path "
                    f"node {node_id!r}, which names no row of the process list, so a derived "
                    "flag would be set on an ID no reader can look up"
                )
