"""TDD: proposal_selector dispatch — T016.

Loads a proposal package's `algorithm.py` (self-contained importlib load,
mirroring `aica_api.algorithms.python_module.load_evaluate` but NOT routing
through the trigger adapter / DecisionResult contract), calls `evaluate()`,
and validates the returned dict into the neutral contract for the package's
family (`ServiceSelectorOutput` for service_selector, `CompletePlan` for
content_selector).

Covers:
  - Valid dispatch for both real mock packages.
  - A deliberately-raising fake package -> algorithm_error AlgorithmEvidence
    (never a faked result).
  - A fake package returning a schema-invalid dict -> algorithm_error
    AlgorithmEvidence.
  - A fake package returning a non-dict -> algorithm_error AlgorithmEvidence.
  - A fake package with a missing entrypoint file -> algorithm_error
    AlgorithmEvidence.
  - Confirms this module does NOT import/use the trigger adapter
    (aica_api.algorithms.*).
"""
from __future__ import annotations

import ast
import inspect
import json
import pathlib

import pytest

from aica_api.config import settings
from aica_api.models.proposal.evidence import AlgorithmEvidence
from aica_api.models.proposal.package_manifest import (
    AlgorithmSpec,
    BilingualLabel,
    ProposalPackageManifest,
)
from aica_api.services import proposal_selector
from aica_api.services.proposal_selector import dispatch_selector

_REPO_ROOT = settings.proposal_contracts_dir.parent
_PACKAGES_DIR = _REPO_ROOT / "packages"


def _load_manifest(pkg_id: str) -> ProposalPackageManifest:
    data = json.loads((_PACKAGES_DIR / pkg_id / "package.json").read_text(encoding="utf-8"))
    return ProposalPackageManifest(**data)


def _fake_manifest(pkg_id: str, family: str, approach: str = "transparent") -> ProposalPackageManifest:
    return ProposalPackageManifest(
        id=pkg_id,
        version="1.0.0",
        label=BilingualLabel(ja="x", en="x"),
        family=family,
        approach=approach,
        contract_version="1.0.0",
        algorithm=AlgorithmSpec(type="python_module", entrypoint="algorithm.py", error_mode="blocking"),
        supported_services=["music_playlist"] if family == "content_selector" else [],
        parameters={},
        hyperparameters=[],
    )


def _write_algorithm(pkg_dir: pathlib.Path, code: str) -> None:
    pkg_dir.mkdir(parents=True, exist_ok=True)
    (pkg_dir / "algorithm.py").write_text(code, encoding="utf-8")


# ---------------------------------------------------------------------------
# Valid dispatch — both real mock packages
# ---------------------------------------------------------------------------


def test_dispatch_valid_service_selector():
    manifest = _load_manifest("mock_service_selector_v1")
    context = {"allowed_service_ids": ["music_playlist", "humming_karaoke"]}

    evidence = dispatch_selector(
        manifest, context, _PACKAGES_DIR, matrix_version="v1"
    )

    assert isinstance(evidence, AlgorithmEvidence)
    assert evidence.error is None
    assert evidence.step == "service"
    assert evidence.package_id == "mock_service_selector_v1"
    assert evidence.output is not None
    assert evidence.output["decision_type"] == "ranked_candidates"


def test_dispatch_valid_content_selector():
    manifest = _load_manifest("mock_content_selector_v1")
    context = {"selected_service_id": "music_playlist"}

    evidence = dispatch_selector(
        manifest, context, _PACKAGES_DIR, matrix_version="v1"
    )

    assert evidence.error is None
    assert evidence.step == "content"
    assert evidence.output["decision_type"] == "complete_plan"


def test_dispatch_service_no_proposal_on_empty_allowed_set():
    manifest = _load_manifest("mock_service_selector_v1")
    evidence = dispatch_selector(
        manifest, {"allowed_service_ids": []}, _PACKAGES_DIR, matrix_version="v1"
    )
    assert evidence.error is None
    assert evidence.output["decision_type"] == "no_proposal"


# ---------------------------------------------------------------------------
# Raising package -> algorithm_error evidence, never a faked result
# ---------------------------------------------------------------------------


def test_raising_package_produces_algorithm_error_evidence(tmp_path):
    pkg_id = "raising_service_selector"
    _write_algorithm(
        tmp_path / pkg_id,
        "def evaluate(context):\n    raise RuntimeError('boom')\n",
    )
    manifest = _fake_manifest(pkg_id, "service_selector")

    evidence = dispatch_selector(manifest, {}, tmp_path, matrix_version="v1")

    assert evidence.error is not None
    assert evidence.output is None
    assert "boom" in evidence.error.message
    assert evidence.error.category


# ---------------------------------------------------------------------------
# Schema-invalid return -> algorithm_error evidence
# ---------------------------------------------------------------------------


def test_schema_invalid_return_produces_algorithm_error_evidence(tmp_path):
    pkg_id = "invalid_service_selector"
    _write_algorithm(
        tmp_path / pkg_id,
        "def evaluate(context):\n    return {'not_a_valid_field': True}\n",
    )
    manifest = _fake_manifest(pkg_id, "service_selector")

    evidence = dispatch_selector(manifest, {}, tmp_path, matrix_version="v1")

    assert evidence.error is not None
    assert evidence.output is None


def test_non_dict_return_produces_algorithm_error_evidence(tmp_path):
    pkg_id = "non_dict_content_selector"
    _write_algorithm(
        tmp_path / pkg_id,
        "def evaluate(context):\n    return ['not', 'a', 'dict']\n",
    )
    manifest = _fake_manifest(pkg_id, "content_selector")

    evidence = dispatch_selector(manifest, {}, tmp_path, matrix_version="v1")

    assert evidence.error is not None
    assert evidence.output is None


def test_missing_entrypoint_produces_algorithm_error_evidence(tmp_path):
    manifest = _fake_manifest("nonexistent_pkg", "service_selector")
    evidence = dispatch_selector(manifest, {}, tmp_path, matrix_version="v1")
    assert evidence.error is not None
    assert evidence.output is None


def test_missing_evaluate_attribute_produces_algorithm_error_evidence(tmp_path):
    pkg_id = "no_evaluate_fn"
    _write_algorithm(tmp_path / pkg_id, "X = 1\n")
    manifest = _fake_manifest(pkg_id, "service_selector")
    evidence = dispatch_selector(manifest, {}, tmp_path, matrix_version="v1")
    assert evidence.error is not None
    assert evidence.output is None


# ---------------------------------------------------------------------------
# Isolation — proposal_selector must NOT route through the trigger adapter
# ---------------------------------------------------------------------------


def test_does_not_import_trigger_adapter():
    source = inspect.getsource(proposal_selector)
    tree = ast.parse(source)
    forbidden_prefixes = ("aica_api.algorithms", "aica_api.models.decision", "aica_api.models.package")

    offending: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.startswith(forbidden_prefixes):
                    offending.append(alias.name)
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if module.startswith(forbidden_prefixes):
                offending.append(module)

    assert not offending, f"proposal_selector.py must not import the trigger adapter: {offending}"
