"""US3 trust invariant — package independence (T038).

The mock service-selector and content-selector packages validate
independently against their own (family, approach) slot, a package of one
family is rejected from the other family's slot, and dispatching one never
consumes or contaminates the other's result. FR-014/015, SC-006.

Builds on (does not duplicate) ``test_proposal_registry.py`` (slot indexing)
and ``test_mock_packages.py`` (raw ``evaluate()`` -> output-model shape). This
file's distinct angle is the ``dispatch_selector`` boundary: the wrapped
``AlgorithmEvidence`` produced for each package/slot never leaks the other
family's fields, and a package's own ``family`` is what a caller (mirroring
``routers/proposal.py``) uses to reject a mis-slotted package — never an
assignment choice.
"""
from __future__ import annotations

from aica_api.config import settings
from aica_api.models.proposal.enums import ProposalPackageFamily
from aica_api.services.proposal_package_registry import ProposalPackageRegistry
from aica_api.services.proposal_selector import dispatch_selector

_MATRIX_VERSION = "test-v1"


def _registry() -> ProposalPackageRegistry:
    return ProposalPackageRegistry(settings.packages_dir)


def _service_context(allowed=None) -> dict:
    return {
        "contract_version": "1.0.0",
        "opportunity_id": "op-independence-test",
        "simulation_time": "2026-07-16T10:00:00Z",
        "trigger_purpose": "rest_recommended",
        "lifecycle_stage": "after_rest_before_restart",
        "allowed_service_ids": list(allowed) if allowed is not None else ["full_karaoke", "live_viewing"],
        "feature_snapshot": {},
        "feature_provenance": {},
        "enabled_feature_extensions": [],
        "selected_service_id": None,
        "eligible_candidates": [{"candidate_id": s} for s in (allowed or ["full_karaoke", "live_viewing"])],
        "excluded_candidates": [],
        "parameters": {},
        "hyperparameters": {},
        "package_runtime_state": {},
        "catalog_version": "n/a",
        "run_seed": "seed-independence-test",
    }


def _content_context(selected_service_id: str = "music_playlist") -> dict:
    return {
        "contract_version": "1.0.0",
        "opportunity_id": "op-independence-test",
        "simulation_time": "2026-07-16T10:00:00Z",
        "trigger_purpose": "route_music",
        "lifecycle_stage": "active_driving_content",
        "allowed_service_ids": [selected_service_id],
        "selected_service_id": selected_service_id,
        "feature_snapshot": {},
        "feature_provenance": {},
        "enabled_feature_extensions": [],
        "eligible_candidates": [],
        "excluded_candidates": [],
        "parameters": {},
        "hyperparameters": {},
        "package_runtime_state": {},
        "catalog_version": "n/a",
        "run_seed": "seed-independence-test",
    }


# ---------------------------------------------------------------------------
# Each package validates independently against its own slot
# ---------------------------------------------------------------------------


def test_service_and_content_manifests_fill_distinct_slots_independently():
    reg = _registry()
    service_pkg = reg.get("mock_service_selector_v1")
    content_pkg = reg.get("mock_content_selector_v1")
    assert service_pkg is not None
    assert content_pkg is not None
    assert service_pkg.family == ProposalPackageFamily.service_selector
    assert content_pkg.family == ProposalPackageFamily.content_selector
    assert service_pkg.slot != content_pkg.slot


def test_content_package_rejected_from_service_slot():
    """Mirrors routers/proposal.py's guard: `pkg.family != service_selector` =>
    reject as a service_package_id — a content package can never satisfy it."""
    content_pkg = _registry().get("mock_content_selector_v1")
    assert content_pkg.family != ProposalPackageFamily.service_selector


def test_service_package_rejected_from_content_slot():
    """Mirrors routers/proposal.py's guard: `pkg.family != content_selector` =>
    reject as a content_package_id — a service package can never satisfy it."""
    service_pkg = _registry().get("mock_service_selector_v1")
    assert service_pkg.family != ProposalPackageFamily.content_selector


def test_list_slots_never_cross_assigns_either_package():
    slots = {(s["family"], s["approach"]): s["package_id"] for s in _registry().list_slots()}
    # P3c (feature 014, T032) / P5 Unit A (feature 016, T001/T003): the REAL
    # content/service selectors now fill these slots (each sorts before its
    # mock alphabetically) — the "never cross-assigns" property under test
    # here is unaffected: neither package ever lands in the OTHER family's
    # slot.
    assert slots[("service_selector", "transparent")] == "aica_transparent_service_selector_v1"
    assert slots[("content_selector", "transparent")] == "aica_transparent_content_selector_v1"
    # Explicitly never the other way around.
    assert slots[("service_selector", "transparent")] != "mock_content_selector_v1"
    assert slots[("service_selector", "transparent")] != "aica_transparent_content_selector_v1"
    assert slots[("content_selector", "transparent")] != "mock_service_selector_v1"
    assert slots[("content_selector", "transparent")] != "aica_transparent_service_selector_v1"


# ---------------------------------------------------------------------------
# dispatch_selector: neither package's evidence leaks the other's fields
# ---------------------------------------------------------------------------

# Fields that only ever appear on a ServiceSelectorOutput-shaped output.
_SERVICE_ONLY_OUTPUT_KEYS = {"ranked_candidates", "next_package_runtime_state"}
# Fields that only ever appear on a CompletePlan-shaped output.
_CONTENT_ONLY_OUTPUT_KEYS = {
    "ordered_items", "mode", "expected_duration_sec", "lighting_configuration",
    "approval_policy", "completion_rule", "next_transition_policy", "excluded_items",
    "selected_service_id", "requested_item_count", "returned_item_count",
}


def test_dispatching_service_package_yields_service_shaped_evidence_only():
    reg = _registry()
    service_pkg = reg.get("mock_service_selector_v1")

    evidence = dispatch_selector(
        service_pkg, _service_context(), settings.packages_dir, matrix_version=_MATRIX_VERSION,
    )

    assert evidence.step == "service"
    assert evidence.package_id == "mock_service_selector_v1"
    assert evidence.error is None
    output_keys = set(evidence.output.keys())
    assert _SERVICE_ONLY_OUTPUT_KEYS <= output_keys
    assert not (_CONTENT_ONLY_OUTPUT_KEYS & output_keys), (
        f"service output leaked content-only keys: {_CONTENT_ONLY_OUTPUT_KEYS & output_keys}"
    )


def test_dispatching_content_package_yields_content_shaped_evidence_only():
    reg = _registry()
    content_pkg = reg.get("mock_content_selector_v1")

    evidence = dispatch_selector(
        content_pkg, _content_context(), settings.packages_dir, matrix_version=_MATRIX_VERSION,
    )

    assert evidence.step == "content"
    assert evidence.package_id == "mock_content_selector_v1"
    assert evidence.error is None
    output_keys = set(evidence.output.keys())
    assert _CONTENT_ONLY_OUTPUT_KEYS <= output_keys
    assert not (_SERVICE_ONLY_OUTPUT_KEYS & output_keys), (
        f"content output leaked service-only keys: {_SERVICE_ONLY_OUTPUT_KEYS & output_keys}"
    )


def test_dispatching_both_packages_in_sequence_does_not_cross_contaminate():
    """Dispatching the service package, then the content package, produces two
    fully independent AlgorithmEvidence objects — the second dispatch's
    input_snapshot/output carries none of the first's data, and vice versa."""
    reg = _registry()
    service_pkg = reg.get("mock_service_selector_v1")
    content_pkg = reg.get("mock_content_selector_v1")

    service_ctx = _service_context()
    content_ctx = _content_context()

    service_evidence = dispatch_selector(
        service_pkg, service_ctx, settings.packages_dir, matrix_version=_MATRIX_VERSION,
    )
    content_evidence = dispatch_selector(
        content_pkg, content_ctx, settings.packages_dir, matrix_version=_MATRIX_VERSION,
    )

    assert service_evidence.input_snapshot == service_ctx
    assert content_evidence.input_snapshot == content_ctx
    assert service_evidence.input_snapshot != content_evidence.input_snapshot
    assert service_evidence.step != content_evidence.step
    assert service_evidence.package_id != content_evidence.package_id

    # The context dicts passed in are untouched by the OTHER package's dispatch.
    assert service_ctx["allowed_service_ids"] == ["full_karaoke", "live_viewing"]
    assert content_ctx["selected_service_id"] == "music_playlist"


def test_evaluating_content_output_against_service_model_is_rejected():
    """Belt-and-suspenders: a content-selector's own output can never validate
    as a ServiceSelectorOutput (proves the two contracts are structurally
    independent, not just independently-labeled)."""
    from pydantic import ValidationError

    from aica_api.models.proposal.service_output import ServiceSelectorOutput

    reg = _registry()
    content_pkg = reg.get("mock_content_selector_v1")
    evidence = dispatch_selector(
        content_pkg, _content_context(), settings.packages_dir, matrix_version=_MATRIX_VERSION,
    )
    try:
        ServiceSelectorOutput(**evidence.output)
    except ValidationError:
        pass
    else:
        raise AssertionError("content output must not validate as a ServiceSelectorOutput")


def test_evaluating_service_output_against_content_model_is_rejected():
    from pydantic import ValidationError

    from aica_api.models.proposal.content_output import CompletePlan

    reg = _registry()
    service_pkg = reg.get("mock_service_selector_v1")
    evidence = dispatch_selector(
        service_pkg, _service_context(), settings.packages_dir, matrix_version=_MATRIX_VERSION,
    )
    try:
        CompletePlan(**evidence.output)
    except ValidationError:
        pass
    else:
        raise AssertionError("service output must not validate as a CompletePlan")
