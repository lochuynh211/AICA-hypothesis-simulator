"""T024 — Docs naming-consistency guard and §17 resolution verification.

Asserts:
1. The dotted control-input form (``trigger.purpose`` / ``trigger.stage``) does
   not appear in any ``*.md`` file under ``docs/master/``.  The underscore form
   (``trigger_purpose`` / ``lifecycle_stage``) is the single canonical form.
2. ``docs/master/aica_proposal_simulator_milestones.md`` §17 marks the four
   content-touching items RESOLVED.

Both assertions are portable: paths are resolved relative to the repo root,
which is walked up from this test file's location (the layout is
``<repo>/app/api/tests/proposal/test_docs_naming_consistency.py``).
"""
from __future__ import annotations

from pathlib import Path


# ---------------------------------------------------------------------------
# Repo-root resolution (portable: no hardcoded absolute paths)
# ---------------------------------------------------------------------------

def _repo_root() -> Path:
    """Walk up from this file to the repo root.

    Layout: ``<repo>/app/api/tests/proposal/test_docs_naming_consistency.py``
             parents[0] = ``proposal/``
             parents[1] = ``tests/``
             parents[2] = ``api/``
             parents[3] = ``app/``
             parents[4] = ``<repo>``
    """
    return Path(__file__).resolve().parents[4]


_REPO_ROOT = _repo_root()
_DOCS_MASTER = _REPO_ROOT / "docs" / "master"
_MILESTONES_DOC = _DOCS_MASTER / "aica_proposal_simulator_milestones.md"

# Dotted forms that must NOT appear anywhere under docs/master/
_FORBIDDEN_DOTTED_FORMS = ("trigger.purpose", "trigger.stage")

# The four §17 content-touching items and the expected RESOLVED marker text
# (exact text confirmed by reading the doc — each item carries the literal
# ``RESOLVED`` inside a parenthetical marker such as ``*(RESOLVED — P0.5...)*``)
_RESOLVED_MARKER = "RESOLVED"

_FOUR_RESOLVED_ITEMS = (
    "Schedule-field ownership",
    "Content `Additional proposed` coverage",
    "Content-doc field renames",
    "Control-input naming",
)


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _read_utf8(path: Path) -> str:
    """Read a file as UTF-8 text (docs contain Japanese multibyte characters)."""
    return path.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# Test 1: no dotted control-input form in any docs/master/*.md
# ---------------------------------------------------------------------------

class TestNoDottedControlInputForm:
    """Guard: ``trigger.purpose`` / ``trigger.stage`` must not appear anywhere
    under ``docs/master/``."""

    def test_no_dotted_forms_in_master_docs(self) -> None:
        """Scan every *.md under docs/master/ for the forbidden dotted forms.

        On failure the assertion message names every offending file and the
        forbidden term(s) found so the regression is immediately attributable.
        """
        assert _DOCS_MASTER.is_dir(), (
            f"docs/master/ directory not found at expected location: {_DOCS_MASTER}"
        )

        offending: list[str] = []
        md_files = list(_DOCS_MASTER.glob("*.md"))
        assert md_files, (
            f"No *.md files found under {_DOCS_MASTER} — check the path."
        )

        for md_path in sorted(md_files):
            content = _read_utf8(md_path)
            found_terms = [term for term in _FORBIDDEN_DOTTED_FORMS if term in content]
            if found_terms:
                offending.append(
                    f"  {md_path.name}: contains {found_terms}"
                )

        assert not offending, (
            "Dotted control-input form(s) found in docs/master/ — "
            "normalize to trigger_purpose / lifecycle_stage everywhere:\n"
            + "\n".join(offending)
        )


# ---------------------------------------------------------------------------
# Test 2: §17 marks the four content-touching items RESOLVED
# ---------------------------------------------------------------------------

class TestSection17Resolutions:
    """Verify that aica_proposal_simulator_milestones.md §17 records all four
    content-touching items as RESOLVED with the expected marker text."""

    def _load_section_17(self) -> str:
        """Extract the §17 section text from the milestones doc."""
        assert _MILESTONES_DOC.exists(), (
            f"Milestones doc not found: {_MILESTONES_DOC}"
        )
        full_text = _read_utf8(_MILESTONES_DOC)

        # Locate §17 and extract until the next top-level heading (## \d+\.)
        # or end of file.
        import re
        match = re.search(r"^## 17\.", full_text, re.MULTILINE)
        assert match, (
            f"§17 section header '## 17.' not found in {_MILESTONES_DOC.name}"
        )
        section_start = match.start()
        # Find the next ## heading after §17, if any
        next_section = re.search(r"^## \d+\.", full_text[section_start + 1:], re.MULTILINE)
        if next_section:
            section_text = full_text[section_start: section_start + 1 + next_section.start()]
        else:
            section_text = full_text[section_start:]
        return section_text

    def test_four_items_present_in_section_17(self) -> None:
        """All four content-touching item headings appear in §17."""
        section = self._load_section_17()
        missing = [item for item in _FOUR_RESOLVED_ITEMS if item not in section]
        assert not missing, (
            f"The following §17 item(s) were not found in "
            f"{_MILESTONES_DOC.name}:\n"
            + "\n".join(f"  - {m}" for m in missing)
        )

    def test_four_items_carry_resolved_marker(self) -> None:
        """Each of the four content-touching items carries a RESOLVED marker.

        Strategy: for each item, locate the line(s) containing its heading
        text in §17 and assert that ``RESOLVED`` appears on the same line
        (the doc format is ``**<heading>.** *(RESOLVED — P0.5...)*``).
        """
        import re
        section = self._load_section_17()
        not_resolved: list[str] = []

        for item in _FOUR_RESOLVED_ITEMS:
            # Find the bullet line that contains this item's heading
            pattern = re.compile(re.escape(item))
            # Search across entire section — the RESOLVED marker may be on
            # the same paragraph line as the heading
            item_match = pattern.search(section)
            if item_match is None:
                not_resolved.append(f"{item!r} — item not found")
                continue

            # Extract the paragraph/bullet block starting at the item heading
            # (up to the next bullet ``- **`` or end of section)
            block_start = item_match.start()
            next_bullet = re.search(r"\n- \*\*", section[block_start + 1:])
            if next_bullet:
                block = section[block_start: block_start + 1 + next_bullet.start()]
            else:
                block = section[block_start:]

            if _RESOLVED_MARKER not in block:
                not_resolved.append(
                    f"{item!r} — '{_RESOLVED_MARKER}' marker not found in its §17 entry"
                )

        assert not not_resolved, (
            f"The following §17 item(s) in {_MILESTONES_DOC.name} "
            f"are missing the '{_RESOLVED_MARKER}' marker:\n"
            + "\n".join(f"  - {e}" for e in not_resolved)
        )
