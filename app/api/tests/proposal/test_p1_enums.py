"""TDD: assert the exact member set of every P1-new enum in enums.py.

Phase 2 — T005 (RED before the new enums exist) → GREEN after they are added.
Mirrors the pattern of ``test_enums.py`` (the P0.5 enum suite) but scoped to
the six enums data-model.md marks **[new]** for P1.
"""
from __future__ import annotations


# ---------------------------------------------------------------------------
# Import guard — the new enum names must be importable from enums.py
# ---------------------------------------------------------------------------
from aica_api.models.proposal.enums import (
    MotionState,
    ProposalPackageFamily,
    ProposalPackageApproach,
    ServiceDecisionType,
    DiscreteEventType,
    ProposalRunStatus,
)


# ---------------------------------------------------------------------------
# MotionState — 2 members
# ---------------------------------------------------------------------------
class TestMotionState:
    EXPECTED = {"driving", "stopped"}

    def test_member_count(self):
        assert len(MotionState) == 2

    def test_exact_members(self):
        assert {m.value for m in MotionState} == self.EXPECTED


# ---------------------------------------------------------------------------
# ProposalPackageFamily — 2 members
# ---------------------------------------------------------------------------
class TestProposalPackageFamily:
    EXPECTED = {"service_selector", "content_selector"}

    def test_member_count(self):
        assert len(ProposalPackageFamily) == 2

    def test_exact_members(self):
        assert {m.value for m in ProposalPackageFamily} == self.EXPECTED


# ---------------------------------------------------------------------------
# ProposalPackageApproach — 2 members
# ---------------------------------------------------------------------------
class TestProposalPackageApproach:
    EXPECTED = {"transparent", "constrained_llm"}

    def test_member_count(self):
        assert len(ProposalPackageApproach) == 2

    def test_exact_members(self):
        assert {m.value for m in ProposalPackageApproach} == self.EXPECTED


# ---------------------------------------------------------------------------
# ServiceDecisionType — 2 members
# ---------------------------------------------------------------------------
class TestServiceDecisionType:
    EXPECTED = {"ranked_candidates", "no_proposal"}

    def test_member_count(self):
        assert len(ServiceDecisionType) == 2

    def test_exact_members(self):
        assert {m.value for m in ServiceDecisionType} == self.EXPECTED


# ---------------------------------------------------------------------------
# DiscreteEventType — 20 members (8 P1 + 10 P4 + 2 P7 additions)
# ---------------------------------------------------------------------------
class TestDiscreteEventType:
    EXPECTED = {
        "OPPORTUNITY_OPENED",
        "SERVICE_SELECTED",
        "CONTENT_SELECTED",
        "TRIGGER_PURPOSE_CHANGED",
        "REST_SPOT_ARRIVED",
        "REST_COMPLETED",
        "CONTENT_COMPLETED",
        "ALGORITHM_ERROR",
        # P4 additions (data-model.md "DiscreteEventType — new members")
        "SERVICE_REJECTED",
        "CONTENT_STARTED",
        "MOTION_CHANGED",
        "CONTINUE_REQUESTED",
        "RETURN_TO_PREVIOUS_CONTENT",
        "REST_STARTED",
        "POSTPONED",
        "CHOOSE_ANOTHER",
        "REQUEST_MORE",
        "NO_ELIGIBLE_CANDIDATE",
        # P7 additions (data-model.md "Modified enum: DiscreteEventType")
        "RECOMPUTED",
        "CONTEXT_EDITED",
    }

    def test_member_count(self):
        assert len(DiscreteEventType) == 20

    def test_exact_members(self):
        assert {m.value for m in DiscreteEventType} == self.EXPECTED


# ---------------------------------------------------------------------------
# ProposalRunStatus — 7 members (4 P1 + 3 P4 additions)
# ---------------------------------------------------------------------------
class TestProposalRunStatus:
    EXPECTED = {
        "created",
        "service_selected",
        "content_selected",
        "error",
        # P4 additions (data-model.md "ProposalRunStatus — new members")
        "content_started",
        "content_completed",
        "content_stopped",
    }

    def test_member_count(self):
        assert len(ProposalRunStatus) == 7

    def test_exact_members(self):
        assert {m.value for m in ProposalRunStatus} == self.EXPECTED
