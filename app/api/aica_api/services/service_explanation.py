"""service_explanation — service proposal explanation.

Builds the grounded prompt and the deterministic template for a service
RankedCandidate. Pure (no I/O). Uses the shared kernel in ``explanation_builder``.
"""
from __future__ import annotations

from typing import Any

from aica_api.models.proposal.explanation import ExplainMessage, ExplanationPrompt
from aica_api.services import explanation_builder as _k

# Plain-English "what this service is" — one line each, driver-facing.
# Unlisted ids fall back to the raw candidate id.
_SERVICE_DESC: dict[str, str] = {
    "music_playlist": "a background music playlist",
    "humming_karaoke": "an interactive sing-along that keeps the driver engaged",
    "call_response_driving": "a hands-free call-and-response game",
    "call_response_stopped": "a call-and-response game for when the car is stopped",
    "quiz": "a driving quiz game",
    "ranking_creation": "a music ranking/creation activity",
    "radio_style": "a radio-style stream",
    "conversation_audio": "an audio conversation/chat companion",
    "live_viewing": "a live concert/performance viewing experience",
    "stretch_video": "a guided stretch/rest video",
    "full_karaoke": "a full karaoke session",
    "oshi_reexperience": "a favorite-artist re-experience",
    "relaxation_multisensory": "a multisensory relaxation experience",
    "linked_video_recommendation": "a linked video recommendation",
}


def build_prompt(target: dict[str, Any], context: dict[str, Any]) -> ExplanationPrompt:
    """Service branch — fact-rich reasoning-mode prompt (analogous to the
    content branch, see .superpowers/sdd/fix-reasoning-prompt-brief.md).

    Hands the model natural-language FACTS (what the service is, the trigger +
    car state, the situation, history with this service) plus the service
    response matrix in the system prompt, and lets it reason the causal story
    itself — no pre-baked verdict, no raw numbers in the user text (grounding
    still keeps the numeric factors/readout for auditability).
    """
    kind_en = "service"
    target_id = str(target.get("candidate_id"))
    rank = target.get("rank")
    fit = target.get("score")

    factors = _k._factors_from_target(target)
    # Service (RankedCandidate) carries supporting_/opposing_feature_ids lists;
    # content (OrderedItem) instead carries single strongest_support/oppose dicts
    # ({feature_id, contribution}). Fall back to those so BOTH shapes contribute
    # equivalent "factors in favor/against" grounding.
    supporting = [str(x) for x in (target.get("supporting_feature_ids") or [])]
    opposing = [str(x) for x in (target.get("opposing_feature_ids") or [])]
    if not supporting:
        ss = target.get("strongest_support")
        if isinstance(ss, dict) and ss.get("feature_id"):
            supporting = [str(ss["feature_id"])]
    if not opposing:
        so = target.get("strongest_oppose")
        if isinstance(so, dict) and so.get("feature_id"):
            opposing = [str(so["feature_id"])]

    song_facts: list[str] = []
    readout = _k.category_readout(target)

    grounding: dict[str, Any] = {
        "step": "service",
        "target_id": target_id,
        "kind": kind_en,
        "rank": rank,
        "fit": fit,
        "trigger_purpose": context.get("trigger_purpose"),
        "lifecycle_stage": context.get("lifecycle_stage"),
        "song_facts": song_facts,
        "factors": factors,
        "supporting": supporting,
        "opposing": opposing,
        "category_readout": readout,
    }

    # ── User message: natural-language facts, no scores-only, no verdict ────
    trigger_purpose = context.get("trigger_purpose")
    lifecycle_stage = context.get("lifecycle_stage")
    desc = _SERVICE_DESC.get(target_id, target_id)

    L: list[str] = []
    L.append(f'The assistant is considering offering the service "{target_id}" to the driver.')
    L.append("")
    L.append("THE SERVICE: " + desc + ".")

    L.append("")
    L.append("THE TRIGGER & CAR STATE: " + _k.trigger_sentence(trigger_purpose, target, lifecycle_stage))

    situation = _k.situation_sentence(target, trigger_purpose)
    if situation:
        L.append("")
        L.append("THE SITUATION RIGHT NOW: " + situation)

    history = _k.history_sentences(target)
    if history:
        L.append("")
        L.append("THE DRIVER'S HISTORY WITH THIS SERVICE: " + "; ".join(history) + ".")

    evidence = _k.score_evidence(factors)
    if evidence:
        L.append("")
        L.append("WHY THE ALGORITHM RANKED IT TOP (strongest reasons first):")
        L.extend(evidence)

    L.append("")
    L.append(_k._FORMAT_REMINDER)

    messages = [
        ExplainMessage(role="system", content=_k._SERVICE_REASON_SYSTEM),
        ExplainMessage(role="user", content="\n".join(L)),
    ]
    return ExplanationPrompt(messages=messages, grounding=grounding)


def _passthrough(target: dict[str, Any]) -> list[str]:
    """Former behavior: already-positional [ja, en] pair, pad/truncate to 2."""
    rationale = target.get("rationale") or []
    if not isinstance(rationale, list) or not rationale:
        return ["", ""]
    ja = str(rationale[0]) if len(rationale) >= 1 else ""
    en = str(rationale[1]) if len(rationale) >= 2 else ja
    return [ja, en]


def template(target: dict[str, Any]) -> list[str]:
    """Deterministic category-level causal composer, degrading to the former
    positional [ja, en] passthrough when subtotals or strongest_support are
    absent (service response has no arousal/valence, so its causal story is
    category-level: dominant family + strongest_support label)."""
    readout = _k.category_readout(target)
    ss = target.get("strongest_support")
    cid = str(target.get("candidate_id") or "")
    if not readout or not isinstance(ss, dict) or not ss.get("feature_id") or not cid:
        return _passthrough(target)
    dom = readout["dominant"]
    dom_ja = {"situation": "運転状況", "preference": "運転者の好み", "history": "利用履歴"}[dom]
    dom_en = {"situation": "the driving situation", "preference": "the driver's taste",
              "history": "the driver's history"}[dom]
    sup = _k.label_for(str(ss["feature_id"]))
    ja = f"主に{dom_ja}（特に{sup['ja']}）により、{cid}が選ばれました。"
    en = f"Mainly {dom_en}, chiefly {sup['en']}, drove selecting {cid}."
    so = target.get("strongest_oppose")
    if isinstance(so, dict) and so.get("feature_id"):
        opp = _k.label_for(str(so["feature_id"]))
        ja += f" 一方で{opp['ja']}は反対に働きました。"
        en += f" {opp['en'].capitalize()} pushed against it."
    return [ja, en]
