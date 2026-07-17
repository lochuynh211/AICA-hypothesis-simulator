"""TDD: P5 Polish T035 - isolation guard for the P5 service-selector surface,
mirroring the P4 isolation guard (`test_p4_isolation.py`) and the P1/P3 guard
(`test_p1_isolation_imports.py`).

Two static AST scans (constitution HARD ISOLATION RULE / spec.md FR-021-
style invariant, algorithm doc §15 "must not call the content selector or
consume another package's score" + module purity docstring):

  1. `packages/aica_transparent_service_selector_v1/algorithm.py` is a
     STANDALONE `python_module` package — it imports NOTHING from
     `aica_api` at all (not just the trigger models: the whole namespace,
     since a `python_module` package must be loadable/runnable with zero
     `aica_api` coupling, exactly as the runtime adapter loads it by file
     path — see `tests/proposal/conftest.py::load_service_selector`). Its
     own module docstring already declares this ("no `aica_api` import");
     this test pins it as an executable assertion. The only import allowed
     is `math` (plus `from __future__ import annotations`).
  2. `app/api/aica_api/models/proposal/service_output.py` imports nothing
     from `aica_api.models` (the trigger package) — only
     `aica_api.models.proposal.*` (its own subpackage) is allowed, mirroring
     every other models/proposal/ module already covered by
     `test_p1_isolation_imports.py`'s glob (this file adds an explicit,
     named pin for `service_output.py` specifically, per the P5 Unit G
     brief).
"""
from __future__ import annotations

import ast
from pathlib import Path

import aica_api.models.proposal.service_output as service_output_module

_REPO_ROOT = Path(__file__).resolve().parents[4]
_SERVICE_PKG_ALGORITHM = (
    _REPO_ROOT / "packages" / "aica_transparent_service_selector_v1" / "algorithm.py"
)
_SERVICE_OUTPUT_FILE = Path(service_output_module.__file__).resolve()


def _top_level_import_modules(source: str, filename: str) -> list[str]:
    """Return every module path named in a top-level `import X` /
    `from X import ...` statement (module-level only — the package's own
    purity docstring forbids ANY import beyond stdlib `math`, so even a
    function-local import would violate it, but scanning the whole tree
    catches both)."""
    tree = ast.parse(source, filename=filename)
    modules: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.module is not None:
                modules.append(node.module)
    return modules


class TestAlgorithmModuleIsStandalone:
    def test_file_exists(self):
        assert _SERVICE_PKG_ALGORITHM.exists(), f"missing: {_SERVICE_PKG_ALGORITHM}"

    def test_imports_nothing_from_aica_api(self):
        source = _SERVICE_PKG_ALGORITHM.read_text(encoding="utf-8")
        modules = _top_level_import_modules(source, str(_SERVICE_PKG_ALGORITHM))
        offenders = [m for m in modules if m == "aica_api" or m.startswith("aica_api.")]
        assert offenders == [], (
            "aica_transparent_service_selector_v1/algorithm.py must be a "
            f"standalone python_module with zero aica_api coupling: {offenders}"
        )

    def test_only_imports_math(self):
        """Positive assertion (not just an absence-of-forbidden-imports
        check): the package's ENTIRE import surface is exactly `math` —
        pins the module docstring's "no file/network I/O, no clock, no
        randomness, no aica_api import" purity claim precisely, so any new
        dependency (even a harmless-looking stdlib one) is a deliberate,
        reviewed decision rather than a silent drift."""
        source = _SERVICE_PKG_ALGORITHM.read_text(encoding="utf-8")
        modules = _top_level_import_modules(source, str(_SERVICE_PKG_ALGORITHM))
        # `__future__` (postponed annotation evaluation) is a language
        # pragma, not a runtime dependency — `math` is the sole real import.
        assert modules == ["__future__", "math"], (
            f"expected algorithm.py's imports to be exactly __future__ + math, found: {modules}"
        )


class TestServiceOutputModelIsolatedFromTrigger:
    def test_file_exists(self):
        assert _SERVICE_OUTPUT_FILE.exists(), f"missing: {_SERVICE_OUTPUT_FILE}"

    def test_imports_nothing_from_trigger_models(self):
        source = _SERVICE_OUTPUT_FILE.read_text(encoding="utf-8")
        modules = _top_level_import_modules(source, str(_SERVICE_OUTPUT_FILE))

        offenders = [
            m
            for m in modules
            if m.startswith("aica_api.models")
            and m != "aica_api.models.proposal"
            and not m.startswith("aica_api.models.proposal.")
        ]
        assert offenders == [], (
            "service_output.py must import only aica_api.models.proposal.* "
            f"(never the trigger aica_api.models package): {offenders}"
        )
