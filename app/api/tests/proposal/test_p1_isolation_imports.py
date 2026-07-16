"""Isolation-guard test (T011, extended for P3 feature 014 T011) — no module
under models/proposal/ may import ``aica_api.models`` (the trigger package).

Scans every ``.py`` source file's AST for ``import``/``from ... import``
statements. Imports of ``aica_api.models.proposal`` (this subpackage itself)
are allowed; any other ``aica_api.models*`` import is a violation of the
HARD ISOLATION RULE (CLAUDE.md / data-model.md preamble).

The scan is directory-glob-based (``*.py`` under ``models/proposal/``), so new
P3 modules — ``dataset.py`` (T003/T004) and ``world.py`` (T007/T008/T009/T010)
— are automatically covered; ``test_source_files_discovered`` additionally
asserts they are present so the coverage is explicit, not just incidental.
"""
from __future__ import annotations

import ast
from pathlib import Path

import aica_api.models.proposal as proposal_pkg

PROPOSAL_MODELS_DIR = Path(proposal_pkg.__file__).resolve().parent


def _iter_source_files() -> list[Path]:
    return sorted(
        p for p in PROPOSAL_MODELS_DIR.glob("*.py") if p.name != "__pycache__"
    )


def _forbidden_imports(source: str, filename: str) -> list[str]:
    """Return a list of forbidden import module-path strings found in *source*."""
    tree = ast.parse(source, filename=filename)
    violations: list[str] = []

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if _is_forbidden(alias.name):
                    violations.append(alias.name)
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if _is_forbidden(module):
                violations.append(module)

    return violations


def _is_forbidden(module_path: str) -> bool:
    if not module_path.startswith("aica_api.models"):
        return False
    # aica_api.models.proposal(.anything) is this subpackage — allowed.
    if module_path == "aica_api.models.proposal" or module_path.startswith(
        "aica_api.models.proposal."
    ):
        return False
    return True


class TestModelsProposalIsolation:
    def test_source_files_discovered(self):
        """Sanity check: the scan actually covers the expected module set."""
        files = _iter_source_files()
        names = {f.name for f in files}
        assert "enums.py" in names
        assert "opportunity.py" in names
        assert "service_output.py" in names
        assert "events.py" in names
        assert "journey.py" in names
        assert "evidence.py" in names
        assert "proposal_run.py" in names
        assert "package_manifest.py" in names
        assert "dataset.py" in names
        assert "world.py" in names
        assert len(files) >= 8

    def test_no_module_imports_trigger_models(self):
        offenders: dict[str, list[str]] = {}
        for path in _iter_source_files():
            source = path.read_text(encoding="utf-8")
            violations = _forbidden_imports(source, str(path))
            if violations:
                offenders[path.name] = violations

        assert not offenders, (
            "Isolation violation: the following models/proposal/ modules import "
            f"the trigger package (aica_api.models): {offenders}"
        )
