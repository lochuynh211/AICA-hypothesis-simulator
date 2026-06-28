"""TDD feedback-models tests (M5 T002) — written BEFORE models exist; confirm RED, implement to GREEN.

Tests for:
  - FieldDef validates with all fields
  - FeedbackTarget validates / optional fields default to None
  - FeedbackEvent validates + serialises with kind="feedback"
  - V1_FEEDBACK_SCHEMA: exactly 9 fields with the exact §13.2 option values
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError


# ---------------------------------------------------------------------------
# FieldDef
# ---------------------------------------------------------------------------


def test_fielddef_choice_valid():
    from aica_api.models.feedback import FieldDef

    fd = FieldDef(
        key="proposal_timing",
        label={"ja": "提案タイミング", "en": "Proposal Timing"},
        type="choice",
        options=["too_early", "appropriate", "too_late"],
    )
    assert fd.key == "proposal_timing"
    assert fd.type == "choice"
    assert fd.options == ["too_early", "appropriate", "too_late"]
    assert fd.note is False
    assert fd.min is None
    assert fd.max is None


def test_fielddef_scale_valid():
    from aica_api.models.feedback import FieldDef

    fd = FieldDef(
        key="comfort_level",
        label={"ja": "快適度", "en": "Comfort Level"},
        type="scale",
        min=1.0,
        max=5.0,
    )
    assert fd.type == "scale"
    assert fd.min == 1.0
    assert fd.max == 5.0


def test_fielddef_text_valid():
    from aica_api.models.feedback import FieldDef

    fd = FieldDef(
        key="open_comment",
        label={"ja": "コメント", "en": "Comment"},
        type="text",
    )
    assert fd.type == "text"
    assert fd.options is None


def test_fielddef_note_true():
    from aica_api.models.feedback import FieldDef

    fd = FieldDef(
        key="acceptance_reason",
        label={"ja": "承諾理由", "en": "Acceptance Reason"},
        type="choice",
        options=["rest_needed", "other"],
        note=True,
    )
    assert fd.note is True


def test_fielddef_invalid_type_rejected():
    from aica_api.models.feedback import FieldDef

    with pytest.raises(ValidationError):
        FieldDef(
            key="bad",
            label={"ja": "悪い", "en": "Bad"},
            type="radio",  # not a valid Literal
        )


# ---------------------------------------------------------------------------
# FeedbackTarget
# ---------------------------------------------------------------------------


def test_feedback_target_run_scope():
    from aica_api.models.feedback import FeedbackTarget

    t = FeedbackTarget(scope="run")
    assert t.scope == "run"
    assert t.event_ref is None
    assert t.tick_index is None
    assert t.proposal_id is None
    assert t.action is None


def test_feedback_target_decision_scope():
    from aica_api.models.feedback import FeedbackTarget

    t = FeedbackTarget(scope="decision", event_ref=3, tick_index=5)
    assert t.scope == "decision"
    assert t.event_ref == 3
    assert t.tick_index == 5


def test_feedback_target_proposal_scope():
    from aica_api.models.feedback import FeedbackTarget

    t = FeedbackTarget(scope="proposal", event_ref=7, proposal_id="rest_guidance")
    assert t.scope == "proposal"
    assert t.proposal_id == "rest_guidance"


def test_feedback_target_action_scope():
    from aica_api.models.feedback import FeedbackTarget

    t = FeedbackTarget(scope="action", event_ref=9, action="accept_rest")
    assert t.scope == "action"
    assert t.action == "accept_rest"


def test_feedback_target_invalid_scope_rejected():
    from aica_api.models.feedback import FeedbackTarget

    with pytest.raises(ValidationError):
        FeedbackTarget(scope="setup_change")  # not yet implemented in V1


# ---------------------------------------------------------------------------
# FeedbackEvent
# ---------------------------------------------------------------------------


def test_feedback_event_minimal():
    from aica_api.models.feedback import FeedbackEvent, FeedbackTarget

    evt = FeedbackEvent(
        kind="feedback",
        target=FeedbackTarget(scope="run"),
    )
    assert evt.kind == "feedback"
    assert evt.labels == {}
    assert evt.comment is None


def test_feedback_event_with_labels_and_comment():
    from aica_api.models.feedback import FeedbackEvent, FeedbackTarget

    evt = FeedbackEvent(
        kind="feedback",
        target=FeedbackTarget(scope="proposal", event_ref=2, proposal_id="rest_guidance"),
        labels={"proposal_timing": "appropriate", "overall_judgment": "good_trigger"},
        comment="Timing felt right.",
    )
    assert evt.labels["proposal_timing"] == "appropriate"
    assert evt.comment == "Timing felt right."


def test_feedback_event_kind_is_feedback_literal():
    from aica_api.models.feedback import FeedbackEvent, FeedbackTarget

    with pytest.raises((ValidationError, Exception)):
        FeedbackEvent(
            kind="tick",  # wrong kind
            target=FeedbackTarget(scope="run"),
        )


def test_feedback_event_serialises_kind_feedback():
    from aica_api.models.feedback import FeedbackEvent, FeedbackTarget

    evt = FeedbackEvent(kind="feedback", target=FeedbackTarget(scope="run"))
    data = evt.model_dump()
    assert data["kind"] == "feedback"


# ---------------------------------------------------------------------------
# V1_FEEDBACK_SCHEMA — exactly 9 fields with the §13.2 option values
# ---------------------------------------------------------------------------

EXPECTED_V1 = {
    "proposal_timing": ["too_early", "appropriate", "too_late", "unnecessary", "missed_opportunity"],
    "safety_impression": ["safe", "somewhat_risky", "unsafe", "unclear"],
    "intrusiveness": ["not_intrusive", "acceptable", "intrusive", "very_intrusive"],
    "understandability": ["clear", "somewhat_clear", "unclear"],
    "rest_spot_suitability": ["suitable", "acceptable", "unsuitable", "no_suitable_rest_spot"],
    "proposal_content_suitability": ["suitable", "acceptable", "unsuitable"],
    "acceptance_reason": ["rest_needed", "convenient_timing", "trusted_suggestion", "other"],
    "rejection_reason": ["not_tired", "bad_timing", "unsuitable_rest_spot", "distrust", "other"],
    "overall_judgment": ["good_trigger", "acceptable", "poor_trigger"],
}


def test_v1_schema_has_exactly_9_fields():
    from aica_api.models.feedback import V1_FEEDBACK_SCHEMA

    assert len(V1_FEEDBACK_SCHEMA) == 9


def test_v1_schema_keys_match():
    from aica_api.models.feedback import V1_FEEDBACK_SCHEMA

    actual_keys = [fd.key for fd in V1_FEEDBACK_SCHEMA]
    assert set(actual_keys) == set(EXPECTED_V1.keys())


def test_v1_schema_options_exact():
    from aica_api.models.feedback import V1_FEEDBACK_SCHEMA

    schema_by_key = {fd.key: fd for fd in V1_FEEDBACK_SCHEMA}
    for key, expected_options in EXPECTED_V1.items():
        assert schema_by_key[key].options == expected_options, (
            f"V1_FEEDBACK_SCHEMA[{key!r}].options mismatch: "
            f"got {schema_by_key[key].options!r}, expected {expected_options!r}"
        )


def test_v1_schema_note_true_for_reason_fields():
    from aica_api.models.feedback import V1_FEEDBACK_SCHEMA

    schema_by_key = {fd.key: fd for fd in V1_FEEDBACK_SCHEMA}
    assert schema_by_key["acceptance_reason"].note is True
    assert schema_by_key["rejection_reason"].note is True


def test_v1_schema_note_false_for_other_fields():
    from aica_api.models.feedback import V1_FEEDBACK_SCHEMA

    schema_by_key = {fd.key: fd for fd in V1_FEEDBACK_SCHEMA}
    for key in EXPECTED_V1:
        if key not in ("acceptance_reason", "rejection_reason"):
            assert schema_by_key[key].note is False, (
                f"Expected note=False for {key!r}"
            )


def test_v1_schema_all_have_bilingual_labels():
    from aica_api.models.feedback import V1_FEEDBACK_SCHEMA

    for fd in V1_FEEDBACK_SCHEMA:
        assert "ja" in fd.label, f"Missing 'ja' label for {fd.key!r}"
        assert "en" in fd.label, f"Missing 'en' label for {fd.key!r}"
        assert fd.label["ja"], f"Empty 'ja' label for {fd.key!r}"
        assert fd.label["en"], f"Empty 'en' label for {fd.key!r}"


def test_v1_schema_all_are_fielddefs():
    from aica_api.models.feedback import FieldDef, V1_FEEDBACK_SCHEMA

    for fd in V1_FEEDBACK_SCHEMA:
        assert isinstance(fd, FieldDef), f"{fd!r} is not a FieldDef instance"
