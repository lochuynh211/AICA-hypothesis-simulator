"""proposal_selector dispatch (T016) — load a proposal package, call evaluate,
validate into the neutral contract for its family.

Self-contained ``importlib`` load — mirrors the *mechanism* used by
``aica_api.algorithms.python_module.load_evaluate`` (stdlib only, no
sandboxing, per-package module cache) but is otherwise entirely independent:
this module does NOT import or dispatch through the trigger algorithm
adapter (``aica_api.algorithms.*``), which normalises to a single
§11 ``DecisionResult`` contract. Proposal selectors instead validate into
one of TWO neutral contracts depending on the package's declared family:

  - ``service_selector`` -> ``ServiceSelectorOutput``
  - ``content_selector``  -> ``CompletePlan``

Constitution Principle V / FR-019-021: any exception, non-dict return, or
schema-invalid return becomes an explicit ``AlgorithmEvidence`` with
``error={category, message}`` set and ``output=None`` — NEVER a fabricated
result.

Public API:
  dispatch_selector(package, context, packages_dir, *, matrix_version,
                     used_feature_ids=None) -> AlgorithmEvidence
"""
from __future__ import annotations

import importlib.util
import pathlib
from typing import Any

from pydantic import ValidationError

from aica_api.models.proposal import SCHEMA_VERSION
from aica_api.models.proposal.content_output import CompletePlan
from aica_api.models.proposal.enums import ProposalPackageFamily
from aica_api.models.proposal.evidence import AlgorithmEvidence, EvidenceError
from aica_api.models.proposal.package_manifest import ProposalPackageManifest
from aica_api.models.proposal.service_output import ServiceSelectorOutput

__all__ = ["dispatch_selector"]


# ---------------------------------------------------------------------------
# Module cache: {package_id: (entry_path_str, loaded_module)}
# ---------------------------------------------------------------------------

_MODULE_CACHE: dict[str, tuple[str, Any]] = {}


class _SelectorLoadError(Exception):
    """Internal: wraps a load-time failure with a category label."""

    def __init__(self, category: str, message: str) -> None:
        super().__init__(message)
        self.category = category
        self.message = message


def _load_evaluate(package: ProposalPackageManifest, packages_dir: pathlib.Path):
    """Load (and cache) the package's ``evaluate`` callable by file path."""
    entry_path = packages_dir / package.id / package.algorithm.entrypoint
    entry_str = str(entry_path)

    cached = _MODULE_CACHE.get(package.id)
    if cached is not None:
        cached_path, module = cached
        if cached_path == entry_str:
            fn = getattr(module, "evaluate", None)
            if callable(fn):
                return fn

    if not entry_path.exists():
        raise _SelectorLoadError(
            category="missing_evaluate",
            message=f"Entrypoint not found: {entry_path}",
        )

    spec = importlib.util.spec_from_file_location(f"aica_proposal_pkg_{package.id}", entry_path)
    if spec is None or spec.loader is None:
        raise _SelectorLoadError(
            category="missing_evaluate",
            message=f"Cannot create a module spec for: {entry_path}",
        )
    module = importlib.util.module_from_spec(spec)

    try:
        spec.loader.exec_module(module)  # type: ignore[union-attr]
    except Exception as exc:  # noqa: BLE001
        raise _SelectorLoadError(
            category="algorithm_exception",
            message=f"Failed to load module {entry_path}: {exc}",
        ) from exc

    fn = getattr(module, "evaluate", None)
    if not callable(fn):
        raise _SelectorLoadError(
            category="missing_evaluate",
            message=f"Module at {entry_path} has no callable 'evaluate' attribute.",
        )

    _MODULE_CACHE[package.id] = (entry_str, module)
    return fn


def _output_model_for_family(family: ProposalPackageFamily) -> type:
    if family == ProposalPackageFamily.service_selector:
        return ServiceSelectorOutput
    return CompletePlan


def _step_for_family(family: ProposalPackageFamily) -> str:
    return "service" if family == ProposalPackageFamily.service_selector else "content"


def _error_evidence(
    *,
    step: str,
    package: ProposalPackageManifest,
    matrix_version: str,
    context: dict,
    category: str,
    message: str,
    used_feature_ids: list[str],
) -> AlgorithmEvidence:
    return AlgorithmEvidence(
        step=step,
        package_id=package.id,
        contract_version=package.contract_version,
        schema_version=SCHEMA_VERSION,
        matrix_version=matrix_version,
        input_snapshot=context,
        output=None,
        error=EvidenceError(category=category, message=message),
        used_feature_ids=used_feature_ids,
        unused_available_features=[],
        missing_features=[],
    )


def dispatch_selector(
    package: ProposalPackageManifest,
    context: dict,
    packages_dir: pathlib.Path,
    *,
    matrix_version: str,
    used_feature_ids: list[str] | None = None,
    allowed_service_ids: list[str] | None = None,
    evidence_input_snapshot: dict | None = None,
) -> AlgorithmEvidence:
    """Load ``package``'s ``algorithm.py``, call ``evaluate(context)``, and
    validate the result into the neutral contract for ``package.family``.

    Args:
        package:             A validated ``ProposalPackageManifest``.
        context:             The selector-input dict delivered to ``evaluate()``.
        packages_dir:        Directory containing ``<package.id>/<entrypoint>``.
        matrix_version:      The frozen matrix version to record on the evidence.
        used_feature_ids:    Feature ids the caller knows were used (optional;
                             defaults to an empty list — the endpoint layer
                             that has full context populates this).
        allowed_service_ids: The opportunity's frozen allowed set (FR-013,
                             SC-002), service-family calls only. When given,
                             every ``candidate_id`` in a valid
                             ``ServiceSelectorOutput``'s ``ranked_candidates``
                             and ``excluded_candidates`` MUST be a member of
                             this set — otherwise the result is downgraded to
                             an ``algorithm_error`` (category
                             ``candidate_outside_allowed_set``) rather than
                             persisted/shown as a legitimate recommendation.
                             ``None`` skips the check (non-service families,
                             or callers that don't yet have the allowed set).
        evidence_input_snapshot: MF2 (P3 POLISH unit) — the dict recorded as
                             the evidence's ``input_snapshot`` field, if given;
                             ``evaluate(context)`` is ALWAYS called with the
                             full, un-redacted ``context`` regardless of this
                             argument. Callers use this to redact bulky
                             read-only reference data (e.g. the full frozen
                             catalog) from the PERSISTED evidence without
                             changing runtime behavior. ``None`` (the default)
                             falls back to ``context`` itself, unchanged.

    Returns:
        An ``AlgorithmEvidence``. On ANY failure (missing entrypoint, load
        exception, ``evaluate()`` exception, non-dict return, schema-invalid
        return, or a candidate outside ``allowed_service_ids``) ``.error`` is
        set and ``.output`` is None — never a fabricated result (Constitution
        Principle V).
    """
    used = list(used_feature_ids) if used_feature_ids else []
    step = _step_for_family(package.family)
    model_cls = _output_model_for_family(package.family)
    persisted_snapshot = context if evidence_input_snapshot is None else evidence_input_snapshot

    try:
        fn = _load_evaluate(package, packages_dir)
    except _SelectorLoadError as exc:
        return _error_evidence(
            step=step, package=package, matrix_version=matrix_version, context=persisted_snapshot,
            category=exc.category, message=exc.message, used_feature_ids=used,
        )

    try:
        raw_result = fn(context)
    except Exception as exc:  # noqa: BLE001
        return _error_evidence(
            step=step, package=package, matrix_version=matrix_version, context=persisted_snapshot,
            category="algorithm_exception", message=str(exc), used_feature_ids=used,
        )

    if not isinstance(raw_result, dict):
        return _error_evidence(
            step=step, package=package, matrix_version=matrix_version, context=persisted_snapshot,
            category="invalid_result_shape",
            message=(
                f"evaluate() returned {type(raw_result).__name__!r}; expected a dict "
                f"matching the {model_cls.__name__} shape."
            ),
            used_feature_ids=used,
        )

    try:
        validated = model_cls(**raw_result)
    except (ValidationError, TypeError) as exc:
        return _error_evidence(
            step=step, package=package, matrix_version=matrix_version, context=persisted_snapshot,
            category="invalid_result_shape",
            message=f"evaluate() returned an invalid {model_cls.__name__} shape: {exc}",
            used_feature_ids=used,
        )

    if allowed_service_ids is not None and model_cls is ServiceSelectorOutput:
        allowed_set = set(allowed_service_ids)
        offending = [
            cand.candidate_id.value
            for cand in validated.ranked_candidates
            if cand.candidate_id.value not in allowed_set
        ]
        offending += [
            excl.candidate_id
            for excl in validated.excluded_candidates
            if excl.candidate_id not in allowed_set
        ]
        if offending:
            return _error_evidence(
                step=step, package=package, matrix_version=matrix_version, context=persisted_snapshot,
                category="candidate_outside_allowed_set",
                message=(
                    f"evaluate() returned candidate_id(s) {offending!r} not in the "
                    f"opportunity's frozen allowed_service_ids {sorted(allowed_set)!r}."
                ),
                used_feature_ids=used,
            )

    return AlgorithmEvidence(
        step=step,
        package_id=package.id,
        contract_version=package.contract_version,
        schema_version=SCHEMA_VERSION,
        matrix_version=matrix_version,
        input_snapshot=persisted_snapshot,
        output=validated.model_dump(mode="json"),
        error=None,
        used_feature_ids=used,
        unused_available_features=list(getattr(validated, "unused_available_features", []) or []),
        missing_features=list(getattr(validated, "missing_features", []) or []),
    )
