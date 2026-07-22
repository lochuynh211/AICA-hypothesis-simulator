"""service_explanation — service proposal explanation.

Builds the grounded prompt and the deterministic template for a service
RankedCandidate. Pure (no I/O). Uses the shared kernel in ``explanation_builder``.
"""
from __future__ import annotations

from typing import Any

from aica_api.models.proposal.explanation import ExplainMessage, ExplanationPrompt
from aica_api.services import explanation_builder as _k


def build_prompt(target: dict[str, Any], context: dict[str, Any]) -> ExplanationPrompt:
    """Service branch of the former build_explanation_prompt (is_service=True)."""
    kind_en = "service"
    target_id = str(target.get("candidate_id") or "")
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
    }

    # ── User message: the full grounding ────────────────────────────────────
    formula = "fit = clamp( sum over factors of (weight x response), -1..+1 )"
    lines: list[str] = []
    fit_txt = f"{fit:+.3f}" if isinstance(fit, (int, float)) else "n/a"
    rank_txt = f"rank {rank}, " if rank is not None else ""
    lines.append(f'The assistant selected {kind_en} "{target_id}" ({rank_txt}fit {fit_txt}).')
    if context.get("trigger_purpose"):
        lines.append(f"Trigger purpose: {context.get('trigger_purpose')}.")
    if context.get("lifecycle_stage"):
        lines.append(f"Driving stage: {context.get('lifecycle_stage')}.")

    if song_facts:
        lines.append("")
        lines.append("About the chosen song:")
        lines.extend(song_facts)

    lines.append("")
    lines.append("How to read the factors below:")
    lines.append(f"- {formula}; a higher fit means a stronger overall match.")
    lines.append(
        "- Each factor's contribution is POSITIVE when it pushed toward this choice and "
        "NEGATIVE when it pushed against it; a larger magnitude means a stronger influence."
    )
    lines.append(
        "- The number in [brackets] is that factor's raw value. A factor can be a top "
        "contributor without its raw value being high, so do NOT describe a value as "
        "'high' unless the bracketed value truly is."
    )

    if factors:
        lines.append("")
        lines.append("Factors, most influential first (label [raw value]: contribution — meaning):")
        for f in factors:
            val = "" if f["value"] in (None, "") else f" [{f['value']}]"
            meaning = f" — {f['meaning']}" if f["meaning"] else ""
            lines.append(f"- {f['label_ja']} / {f['label_en']}{val}: {f['contribution']:+.3f}{meaning}")
    if supporting:
        labs = ", ".join(_k.label_for(s)["en"] for s in supporting)
        lines.append(f"Overall pushed TOWARD this choice by: {labs}.")
    if opposing:
        labs = ", ".join(_k.label_for(o)["en"] for o in opposing)
        lines.append(f"Pushed AGAINST by: {labs}.")

    # Terminal format reminder (recency) — the last thing the model reads.
    lines.append("")
    lines.append(_k._FORMAT_REMINDER)

    messages = [
        ExplainMessage(role="system", content=_k._SYSTEM_TEMPLATE.format(kind=kind_en)),
        ExplainMessage(role="user", content="\n".join(lines)),
    ]
    return ExplanationPrompt(messages=messages, grounding=grounding)


def template(target: dict[str, Any]) -> list[str]:
    """Service branch of the former template_rationale (already-positional
    [ja, en] pair; pad/truncate to length 2)."""
    rationale = target.get("rationale") or []
    if not isinstance(rationale, list) or not rationale:
        return ["", ""]

    # Already a positional [ja, en] pair — pad/truncate to length 2.
    ja = str(rationale[0]) if len(rationale) >= 1 else ""
    en = str(rationale[1]) if len(rationale) >= 2 else ja
    return [ja, en]
