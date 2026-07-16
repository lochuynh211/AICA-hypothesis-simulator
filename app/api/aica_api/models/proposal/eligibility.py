"""EligibilityExclusion / EligibilityResult contract (data-model.md
§"EligibilityExclusion / EligibilityResult").

Score-free eligibility shapes (research.md D1/D3): a service is either
eligible or excluded-with-reason-codes; no numeric score/fit/weight/utility
field is ever attached (FR-003/FR-004).

This module is ISOLATED from trigger models:
  - Do NOT import from ``aica_api.models`` (the trigger package).
  - Do NOT import from ``aica_api.algorithms``.
  - Enums are imported from ``.enums`` only.
"""
from __future__ import annotations

from pydantic import BaseModel, field_validator

from aica_api.models.proposal.enums import EligibilityReasonCode, ServiceId

__all__ = [
    "EligibilityExclusion",
    "EligibilityResult",
]


class EligibilityExclusion(BaseModel):
    """A service excluded from the eligible set, with >=1 reason code.

    NO score/fit/weight/utility field — reasons are a closed vocabulary
    (research.md D3), never a numeric ranking signal.
    """

    service_id: ServiceId
    reason_codes: list[EligibilityReasonCode]

    @field_validator("reason_codes")
    @classmethod
    def reason_codes_non_empty(
        cls, value: list[EligibilityReasonCode]
    ) -> list[EligibilityReasonCode]:
        if not value:
            raise ValueError("reason_codes must contain at least one EligibilityReasonCode")
        return value


class EligibilityResult(BaseModel):
    """The eligible/excluded split for one allowed-services row.

    NO score/fit/weight/utility field on this model either — ``eligible`` is
    an unranked subset of the allowed row (order preserved); ranking is the
    selector's job, strictly downstream of eligibility.
    """

    eligible: list[ServiceId]
    excluded: list[EligibilityExclusion]
