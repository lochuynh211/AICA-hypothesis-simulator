"""Isolation-guard test (T011, extended for P3 feature 014 T011, and further
extended by the P3 POLISH unit's MF3) — no module under models/proposal/, and
no proposal-scoped module under services/, may import ``aica_api.models``
(the trigger package) or ``mdg``.

Scans every ``.py`` source file's AST for ``import``/``from ... import``
statements. Imports of ``aica_api.models.proposal`` (this subpackage itself)
are allowed; any other ``aica_api.models*`` import is a violation of the
HARD ISOLATION RULE (CLAUDE.md / data-model.md preamble). Likewise, any
``mdg`` import (a prior unit deliberately removed the ``mdg`` runtime
dependency from proposal code — see ``services/dataset_catalog_registry.py``'s
module docstring) is a violation.

The models/proposal/ scan is directory-glob-based (``*.py`` under
``models/proposal/``), so new P3 modules — ``dataset.py`` (T003/T004) and
``world.py`` (T007/T008/T009/T010) — are automatically covered;
``test_source_files_discovered`` additionally asserts they are present so the
coverage is explicit, not just incidental.

The services/ scan (MF3, extended by whole-branch review FIX 6) is now a
GLOB over ``services/*.py`` — since ``services/`` also holds the TRIGGER's
own service modules (e.g. ``run_manager.py``/``tick_engine.py``, which
legitimately import the trigger ``aica_api.models`` and are out of scope
here), a module is auto-classified as "proposal-scoped" by whether IT ITSELF
imports ``aica_api.models.proposal`` (the same self-identifying signal every
existing proposal service already exhibits — every one of them works with
proposal models). This closes the gap where a new proposal service module
could silently escape the check simply by someone forgetting to add its
filename to a hand-maintained allowlist: the previous explicit allowlist is
gone, so this now scales automatically as proposal services are added.
"""
from __future__ import annotations

import ast
from pathlib import Path

import aica_api.models.proposal as proposal_pkg
import aica_api.services as services_pkg

PROPOSAL_MODELS_DIR = Path(proposal_pkg.__file__).resolve().parent
SERVICES_DIR = Path(services_pkg.__file__).resolve().parent


def _iter_source_files() -> list[Path]:
    return sorted(
        p for p in PROPOSAL_MODELS_DIR.glob("*.py") if p.name != "__pycache__"
    )


def _imports_proposal_models(source: str, filename: str) -> bool:
    """Return True if *source* imports ``aica_api.models.proposal`` (or any
    submodule of it) anywhere — the self-identifying signal used to classify
    a ``services/*.py`` module as proposal-scoped (FIX 6)."""
    tree = ast.parse(source, filename=filename)
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            if any(_is_proposal_models_path(alias.name) for alias in node.names):
                return True
        elif isinstance(node, ast.ImportFrom):
            if _is_proposal_models_path(node.module or ""):
                return True
    return False


def _is_proposal_models_path(module_path: str) -> bool:
    return module_path == "aica_api.models.proposal" or module_path.startswith(
        "aica_api.models.proposal."
    )


def _iter_proposal_service_files() -> list[Path]:
    """GLOB every ``services/*.py`` file and keep only the ones that
    self-identify as proposal-scoped (import ``aica_api.models.proposal``) —
    a future proposal service is picked up automatically, without needing to
    be hand-added to an allowlist."""
    candidates = sorted(p for p in SERVICES_DIR.glob("*.py") if p.name != "__init__.py")
    proposal_files = [
        p for p in candidates if _imports_proposal_models(p.read_text(encoding="utf-8"), str(p))
    ]
    return proposal_files


# Proposal-scoped service modules expected to be discovered by the glob above
# (sanity check only — NOT used to scope the isolation check itself).
_EXPECTED_PROPOSAL_SERVICE_MODULES: frozenset[str] = frozenset(
    {
        "dataset_catalog_registry.py",
        "world_seed_store.py",
        "world_clone_store.py",
        "driver_profile_store.py",
        "world_validation.py",
        "proposal_selector.py",
        "proposal_run_manager.py",
        "proposal_package_registry.py",
    }
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
    if module_path == "mdg" or module_path.startswith("mdg."):
        return True
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


class TestServicesProposalIsolation:
    """MF3 (P3 POLISH unit) — extend the import-guard to proposal-scoped
    services/ modules: none may import the trigger ``aica_api.models``
    namespace, and none may import ``mdg``."""

    def test_service_files_discovered(self):
        """Sanity check: every allowlisted proposal-service module exists."""
        for path in _iter_proposal_service_files():
            assert path.exists(), f"Expected proposal-scoped service module missing: {path}"

    def test_no_proposal_service_imports_trigger_models_or_mdg(self):
        offenders: dict[str, list[str]] = {}
        for path in _iter_proposal_service_files():
            source = path.read_text(encoding="utf-8")
            violations = _forbidden_imports(source, str(path))
            if violations:
                offenders[path.name] = violations

        assert not offenders, (
            "Isolation violation: the following services/ modules import the "
            f"trigger package (aica_api.models) or 'mdg': {offenders}"
        )
