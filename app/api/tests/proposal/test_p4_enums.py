"""TDD: assert every new P4 enum value exists with the exact value, and that
the pre-existing members of DiscreteEventType / ProposalRunStatus are
unchanged (regression guard).

Phase 1 — T003 (RED before T002 lands) → T002 makes it GREEN.
"""
from __future__ import annotations

import pytest

from aica_api.models.proposal.enums import (
    DiscreteEventType,
    EligibilityReasonCode,
    JourneyActionType,
    PlaybackState,
    ProposalRunStatus,
)


# ---------------------------------------------------------------------------
# JourneyActionType — 12 members
# ---------------------------------------------------------------------------
class TestJourneyActionType:
    EXPECTED = {
        "accept",
        "reject",
        "postpone",
        "choose_another",
        "request_more",
        "complete",
        "continue",
        "stop",
        "motion_change",
        "rest_spot_arrived",
        "rest_started",
        "rest_completed",
    }

    def test_member_count(self):
        assert len(JourneyActionType) == 12

    def test_exact_members(self):
        assert {m.value for m in JourneyActionType} == self.EXPECTED

    def test_continue_member_name_and_value(self):
        # `continue` is a Python keyword — the member is named `continue_`
        # with value "continue".
        assert JourneyActionType.continue_.value == "continue"
        assert JourneyActionType("continue") is JourneyActionType.continue_

    def test_each_member_accessible(self):
        for value in self.EXPECTED:
            assert JourneyActionType(value) is not None


# ---------------------------------------------------------------------------
# PlaybackState — 6 members
# ---------------------------------------------------------------------------
class TestPlaybackState:
    EXPECTED = {"idle", "active", "backgrounded", "paused", "completed", "stopped"}

    def test_member_count(self):
        assert len(PlaybackState) == 6

    def test_exact_members(self):
        assert {m.value for m in PlaybackState} == self.EXPECTED


# ---------------------------------------------------------------------------
# EligibilityReasonCode — 6 members
# ---------------------------------------------------------------------------
class TestEligibilityReasonCode:
    EXPECTED = {
        "screen_dependent_while_driving",
        "stopped_only_while_driving",
        "full_karaoke_requires_stopped",
        "missing_required_entity",
        "catalog_item_unavailable",
        "not_in_allowed_row",
    }

    def test_member_count(self):
        assert len(EligibilityReasonCode) == 6

    def test_exact_members(self):
        assert {m.value for m in EligibilityReasonCode} == self.EXPECTED


# ---------------------------------------------------------------------------
# DiscreteEventType — new P4 members present + existing members unchanged
# ---------------------------------------------------------------------------
class TestDiscreteEventTypeP4Extension:
    NEW_MEMBERS = {
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
    }

    PRE_EXISTING_MEMBERS = {
        "OPPORTUNITY_OPENED",
        "SERVICE_SELECTED",
        "CONTENT_SELECTED",
        "TRIGGER_PURPOSE_CHANGED",
        "REST_SPOT_ARRIVED",
        "REST_COMPLETED",
        "CONTENT_COMPLETED",
        "ALGORITHM_ERROR",
    }

    def test_new_members_present_with_exact_value(self):
        for name in self.NEW_MEMBERS:
            member = DiscreteEventType[name]
            assert member.value == name

    def test_pre_existing_members_unchanged(self):
        for name in self.PRE_EXISTING_MEMBERS:
            member = DiscreteEventType[name]
            assert member.value == name

    def test_full_member_set_is_exactly_old_plus_new(self):
        # P7 additively extends DiscreteEventType further (RECOMPUTED /
        # CONTEXT_EDITED — see test_p1_enums.py::TestDiscreteEventType for the
        # current full closed set); this test only asserts the P1+P4 set is
        # still fully present and none of ITS members were removed/renamed.
        assert (self.PRE_EXISTING_MEMBERS | self.NEW_MEMBERS) <= {m.value for m in DiscreteEventType}


# ---------------------------------------------------------------------------
# ProposalRunStatus — new P4 members present + existing members unchanged
# ---------------------------------------------------------------------------
class TestProposalRunStatusP4Extension:
    NEW_MEMBERS = {"content_started", "content_completed", "content_stopped"}

    PRE_EXISTING_MEMBERS = {"created", "service_selected", "content_selected", "error"}

    def test_new_members_present_with_exact_value(self):
        for name in self.NEW_MEMBERS:
            member = ProposalRunStatus[name]
            assert member.value == name

    def test_pre_existing_members_unchanged(self):
        for name in self.PRE_EXISTING_MEMBERS:
            member = ProposalRunStatus[name]
            assert member.value == name

    def test_full_member_set_is_exactly_old_plus_new(self):
        assert {m.value for m in ProposalRunStatus} == (
            self.PRE_EXISTING_MEMBERS | self.NEW_MEMBERS
        )
