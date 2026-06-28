"""Feedback domain models — FeedbackEvent, FeedbackTarget, FieldDef, V1_FEEDBACK_SCHEMA.

M5 additions:
- FieldDef: describes one review label (choice/text/scale, bilingual label, options).
- V1_FEEDBACK_SCHEMA: the 9 master §13.2 baseline review labels (constant).
- FeedbackTarget: identifies what a feedback record is about (run/decision/proposal/action).
- FeedbackEvent: append-only log event carrying a reviewer's structured labels + comment.

FeedbackEvent is a log event only — it does NOT touch the decision/adapter pipeline.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel


# ─── FieldDef ────────────────────────────────────────────────────────────────


class FieldDef(BaseModel):
    """Definition of a single review label field.

    ``note=True`` on a choice field means the reviewer may also supply an
    optional free-text note alongside their categorical selection (used for
    acceptance_reason and rejection_reason in V1).
    ``min``/``max`` are meaningful only for type="scale" fields.
    """

    key: str
    label: dict[str, str]                  # {"ja": "...", "en": "..."}
    type: Literal["choice", "text", "scale"]
    options: list[str] | None = None
    note: bool = False
    min: float | None = None
    max: float | None = None


# ─── V1 baseline feedback schema (§13.2) ─────────────────────────────────────

V1_FEEDBACK_SCHEMA: list[FieldDef] = [
    FieldDef(
        key="proposal_timing",
        label={"ja": "提案タイミング", "en": "Proposal Timing"},
        type="choice",
        options=["too_early", "appropriate", "too_late", "unnecessary", "missed_opportunity"],
    ),
    FieldDef(
        key="safety_impression",
        label={"ja": "安全性の印象", "en": "Safety Impression"},
        type="choice",
        options=["safe", "somewhat_risky", "unsafe", "unclear"],
    ),
    FieldDef(
        key="intrusiveness",
        label={"ja": "煩わしさ", "en": "Intrusiveness"},
        type="choice",
        options=["not_intrusive", "acceptable", "intrusive", "very_intrusive"],
    ),
    FieldDef(
        key="understandability",
        label={"ja": "わかりやすさ", "en": "Understandability"},
        type="choice",
        options=["clear", "somewhat_clear", "unclear"],
    ),
    FieldDef(
        key="rest_spot_suitability",
        label={"ja": "休憩場所の適切さ", "en": "Rest Spot Suitability"},
        type="choice",
        options=["suitable", "acceptable", "unsuitable", "no_suitable_rest_spot"],
    ),
    FieldDef(
        key="proposal_content_suitability",
        label={"ja": "提案内容の適切さ", "en": "Proposal Content Suitability"},
        type="choice",
        options=["suitable", "acceptable", "unsuitable"],
    ),
    FieldDef(
        key="acceptance_reason",
        label={"ja": "承諾理由", "en": "Acceptance Reason"},
        type="choice",
        options=["rest_needed", "convenient_timing", "trusted_suggestion", "other"],
        note=True,
    ),
    FieldDef(
        key="rejection_reason",
        label={"ja": "拒否理由", "en": "Rejection Reason"},
        type="choice",
        options=["not_tired", "bad_timing", "unsuitable_rest_spot", "distrust", "other"],
        note=True,
    ),
    FieldDef(
        key="overall_judgment",
        label={"ja": "総合評価", "en": "Overall Judgment"},
        type="choice",
        options=["good_trigger", "acceptable", "poor_trigger"],
    ),
]


# ─── FeedbackTarget ───────────────────────────────────────────────────────────


class FeedbackTarget(BaseModel):
    """Identifies what a feedback record is about.

    ``scope`` is the kind of target:
    - "run"       — the run as a whole (no event_ref needed).
    - "decision"  — a specific tick's decision (event_ref → index in RunLog.events).
    - "proposal"  — a specific fired proposal (event_ref → tick event index).
    - "action"    — a specific reviewer action (event_ref → action event index).

    ``event_ref`` is the index into RunLog.events that uniquely anchors the
    target — required for decision/proposal/action, absent for run.

    The display-metadata fields (tick_index, proposal_id, action) are included
    for UI convenience and are not the authoritative anchor (event_ref is).
    """

    scope: Literal["run", "decision", "proposal", "action"]
    event_ref: int | None = None
    tick_index: int | None = None
    proposal_id: str | None = None
    action: str | None = None


# ─── FeedbackEvent ───────────────────────────────────────────────────────────


class FeedbackEvent(BaseModel):
    """An append-only reviewer feedback event recorded in RunLog.events.

    ``labels`` is a free-form dict keyed by FieldDef.key; values are the
    selected option string, or a dict ``{"choice": ..., "note": ...}`` for
    note-enabled fields.  All fields are optional — empty feedback is accepted.

    FeedbackEvent is evidence only — it never influences any algorithm and
    never alters any recorded simulator decision.
    """

    kind: Literal["feedback"]
    target: FeedbackTarget
    labels: dict[str, Any] = {}
    comment: str | None = None
