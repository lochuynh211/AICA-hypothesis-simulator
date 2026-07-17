"""ProposalPackageManifest contract (data-model.md §"ProposalPackageManifest").

A manifest describes one package that can fill one of the four
``(family, approach)`` slots: ``{service_selector, content_selector}`` ×
``{transparent, constrained_llm}``. ``python_module`` is the sole supported
algorithm type (Constitution Principle V) — mirrors the trigger package's
``error_mode`` convention (``blocking`` default / ``non_blocking``) but is
re-declared locally to preserve isolation (no import of ``aica_api.models``).

This module is ISOLATED from trigger models:
  - Do NOT import from ``aica_api.models`` (the trigger package).
  - Enums are imported from ``.enums`` only.

AMBIGUITY RESOLVED: data-model.md leaves the hyperparameter ``label`` field's
type unstated. Per FR-004 ("every panel and every label MUST exist in both
Japanese and English"), this module treats ``HyperparameterDef.label`` as the
same bilingual ``{ja, en}`` shape as the manifest's own ``label`` field,
rather than inventing a new untyped shape.
"""
from __future__ import annotations

from enum import Enum
from itertools import product
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, model_validator

from aica_api.models.proposal.enums import ProposalPackageApproach, ProposalPackageFamily, ServiceId

__all__ = [
    "BilingualLabel",
    "ProposalPackageFamilySlot",
    "ALL_FAMILY_SLOTS",
    "AlgorithmSpec",
    "HyperparameterDef",
    "ProposalPackageManifest",
]


# ---------------------------------------------------------------------------
# BilingualLabel
# ---------------------------------------------------------------------------


class BilingualLabel(BaseModel):
    """A ``{ja, en}`` bilingual label (data-model.md, FR-004)."""

    ja: str
    en: str


# ---------------------------------------------------------------------------
# ProposalPackageFamilySlot — the 4 valid (family, approach) slots
# ---------------------------------------------------------------------------


class ProposalPackageFamilySlot(str, Enum):
    """The four valid (family, approach) slots a package manifest can fill."""

    service_selector_transparent = "service_selector/transparent"
    service_selector_constrained_llm = "service_selector/constrained_llm"
    content_selector_transparent = "content_selector/transparent"
    content_selector_constrained_llm = "content_selector/constrained_llm"

    @classmethod
    def from_family_approach(
        cls, family: ProposalPackageFamily, approach: ProposalPackageApproach
    ) -> "ProposalPackageFamilySlot":
        return cls(f"{family.value}/{approach.value}")


# The full cartesian product of family x approach, as (family, approach) tuples.
ALL_FAMILY_SLOTS: tuple[tuple[ProposalPackageFamily, ProposalPackageApproach], ...] = tuple(
    product(ProposalPackageFamily, ProposalPackageApproach)
)


# ---------------------------------------------------------------------------
# AlgorithmSpec — { type: "python_module", entrypoint, error_mode }
# ---------------------------------------------------------------------------


class AlgorithmSpec(BaseModel):
    """Algorithm binding for a manifest. ``type`` is fixed to ``python_module``
    (the sole supported algorithm type per Constitution Principle V)."""

    type: Literal["python_module"]
    entrypoint: str
    error_mode: Literal["blocking", "non_blocking"] = "blocking"


# ---------------------------------------------------------------------------
# HyperparameterDef
# ---------------------------------------------------------------------------


class HyperparameterDef(BaseModel):
    """A single hyperparameter definition rendered as an editable control.

    ``extra="allow"`` because each ``kind`` carries kind-specific extra
    fields (e.g. ``rows``/``columns`` for ``matrix``, ``options`` for
    ``enum``) that data-model.md leaves open-ended ("…").
    """

    model_config = ConfigDict(extra="allow")

    key: str
    kind: Literal["matrix", "table", "map", "numeric", "enum", "string"]
    label: BilingualLabel
    default: Any


# ---------------------------------------------------------------------------
# ProposalPackageManifest
# ---------------------------------------------------------------------------


class ProposalPackageManifest(BaseModel):
    """A proposal package's manifest (``package.json``).

    Validator: ``family == content_selector`` REQUIRES a non-empty
    ``supported_services``; ``family == service_selector`` does not require
    it (may be empty).
    """

    id: str
    version: str
    label: BilingualLabel
    family: ProposalPackageFamily
    approach: ProposalPackageApproach
    contract_version: str
    algorithm: AlgorithmSpec
    supported_services: list[ServiceId] = []
    parameters: dict
    hyperparameters: list[HyperparameterDef]
    # Internal/fixture packages set this so the reviewer-facing selector can
    # hide them (the two mock_* packages stay on disk as test fixtures but must
    # not clutter the dropdown). Loading, slotting, and direct-by-id use are
    # unaffected — only the /packages listing filters on it.
    hidden: bool = False

    @model_validator(mode="after")
    def content_family_requires_supported_services(self) -> "ProposalPackageManifest":
        if self.family == ProposalPackageFamily.content_selector and not self.supported_services:
            raise ValueError(
                "A content_selector manifest requires a non-empty supported_services list."
            )
        return self

    @property
    def slot(self) -> ProposalPackageFamilySlot:
        """The (family, approach) slot this manifest fills."""
        return ProposalPackageFamilySlot.from_family_approach(self.family, self.approach)
