"""content_explanation — content (song) proposal explanation.

Builds the grounded prompt and the deterministic template for a content
OrderedItem. Pure (no I/O). Uses the shared kernel in ``explanation_builder``
for labels, factor extraction, parsing, and format anchoring.
"""
from __future__ import annotations

from typing import Any

from aica_api.models.proposal.explanation import ExplainMessage, ExplanationPrompt
from aica_api.services import explanation_builder as _k  # shared kernel


def _song_facts_lines(target: dict[str, Any], context: dict[str, Any]) -> list[str]:
    """Semantic facts about the chosen song (content step) — derived from the
    item's decision-time trait values + its oshi-match contribution, so the
    model can tell the real story (energy, mood, sing-along ease, oshi match)
    instead of guessing from opaque feature ids. ``song_name`` is optional
    (resolved from the catalog by the caller when available)."""
    out: list[str] = []
    name = context.get("song_name")
    if name:
        out.append(f'- Title: "{name}"')
    tv = target.get("trait_values") or {}
    arousal = tv.get("arousal")
    if isinstance(arousal, (int, float)):
        band = "high (energetic/upbeat)" if arousal >= 0.62 else ("low (calm/relaxed)" if arousal < 0.40 else "medium")
        out.append(f"- Energy/arousal: {band}")
    valence = tv.get("valence")
    if isinstance(valence, (int, float)):
        mood = "bright/positive" if valence >= 0.55 else ("darker/melancholic" if valence < 0.40 else "neutral")
        out.append(f"- Mood/valence: {mood}")
    eases = [x for x in (tv.get("humming_ease"), tv.get("full_karaoke_ease")) if isinstance(x, (int, float))]
    if eases:
        ease = max(eases)
        out.append(f"- Sing-along ease: {'high' if ease >= 0.66 else ('low' if ease < 0.40 else 'medium')}")
    for fc in target.get("feature_contributions", []) or []:
        if fc.get("feature_id") == "oshi_id":
            is_oshi = bool(fc.get("exact_match")) or fc.get("e_i") == 1.0
            out.append(f"- By the driver's oshi (favorite artist): {'yes' if is_oshi else 'no'}")
            break
    return out


# Static Context Response Matrix demand (content algorithm §5.2), used when a
# contribution row does not carry alpha/beta. Values are the sign/intent only.
_STATIC_DEMAND = {
    "drowsiness_level": (0.80, 0.20), "drowsiness": (0.80, 0.20),
    "fatigue_level": (-0.50, 0.50), "fatigue": (-0.50, 0.50),
    "monotony_level": (0.90, 0.10), "monotony": (0.90, 0.10),
    "traffic_state": (-0.40, 0.60), "traffic": (-0.40, 0.60),
    "night_state": (-0.50, 0.50), "night": (-0.50, 0.50),
}


def demand_phrase(alpha, beta, feature_id):
    """Bilingual 'what this situation calls for' from arousal/valence demand.

    Returns None when there is no usable demand (both coefficients ~0 / absent
    and no static entry) — the feature is then not a causal bridge.
    """
    if alpha is None and beta is None:
        alpha, beta = _STATIC_DEMAND.get(feature_id, (None, None))
    if alpha is None and beta is None:
        return None
    a = float(alpha or 0.0)
    b = float(beta or 0.0)
    if abs(a) < 1e-6 and abs(b) < 1e-6:
        return None
    if a > 0:
        en, ja = "energetic, upbeat music", "活発で高揚感のある曲"
    elif a < 0:
        en, ja = "calm, soothing music", "穏やかで落ち着いた曲"
    else:
        en, ja = "brighter, more positive music", "より明るくポジティブな曲"
    if a != 0 and b > 0:
        en += " (and a bit brighter)"
        ja += "（やや明るめ）"
    return {"en": en, "ja": ja}


def _arousal_band(v):
    return "high" if v >= 0.62 else ("low" if v < 0.40 else "medium")


def causal_bridge_lines(target):
    """One line per situation feature that carries a demand, pairing the demand
    with the song's actual energy trait — the situation→trait causal arrow."""
    tv = target.get("trait_values") or {}
    arousal = tv.get("arousal")
    band = _arousal_band(float(arousal)) if isinstance(arousal, (int, float)) else None
    out = []
    for fc in target.get("feature_contributions", []) or []:
        fid = str(fc.get("feature_id", ""))
        dem = demand_phrase(fc.get("alpha"), fc.get("beta"), fid)
        if dem is None:
            continue
        lab = _k.label_for(fid)
        contribution = float(fc.get("contribution", 0.0) or 0.0)
        trait_txt = f"; this song's energy is {band.upper()}" if band else ""
        verdict = " (a strong match)" if contribution > 0 else (" (a mismatch)" if contribution < 0 else "")
        out.append(
            f"- {lab['ja']} / {lab['en']}: the situation calls for {dem['en']}"
            f"{trait_txt}{verdict} (contribution {contribution:+.3f})."
        )
    return out


def build_prompt(target: dict[str, Any], context: dict[str, Any]) -> ExplanationPrompt:
    """Content branch of the former build_explanation_prompt (is_service=False)."""
    kind_en = "song"
    target_id = str(target.get("item_id") or "")
    rank = target.get("position")
    fit = target.get("item_fit")

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

    song_facts = _song_facts_lines(target, context)
    bridge = causal_bridge_lines(target)
    readout = _k.category_readout(target)

    grounding: dict[str, Any] = {
        "step": "content",
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
        "causal_bridge": bridge,
        "category_readout": readout,
    }

    # ── User message: the full grounding ────────────────────────────────────
    formula = "fit = clamp( sum over factors of (weight x evidence x response), -1..+1 )"
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

    if readout:
        lines.append("")
        lines.append(readout["phrase_en"])
    if bridge:
        lines.append("")
        lines.append("How the driving situation shapes the music choice:")
        lines.extend(bridge)

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


def _legacy_join(target):
    """Former behavior: variable-length '<ja> / <en>' list → clean [ja, en]."""
    rationale = target.get("rationale") or []
    if not isinstance(rationale, list) or not rationale:
        return ["", ""]
    ja_parts, en_parts = [], []
    for entry in rationale:
        s = str(entry)
        if _k._CONTENT_LANG_SEP in s:
            left, right = s.split(_k._CONTENT_LANG_SEP, 1)
            ja_parts.append(left.strip()); en_parts.append(right.strip())
        else:
            ja_parts.append(s.strip()); en_parts.append(s.strip())
    return ["、".join(ja_parts), "; ".join(en_parts)]


def template(target):
    readout = _k.category_readout(target)
    tv = target.get("trait_values") or {}
    # Find the strongest situation feature that has a demand + a real trait to
    # anchor sentence 1; if none, fall back to the legacy join.
    best = None
    for fc in target.get("feature_contributions", []) or []:
        dem = demand_phrase(fc.get("alpha"), fc.get("beta"), str(fc.get("feature_id", "")))
        if dem is None:
            continue
        c = abs(float(fc.get("contribution", 0.0) or 0.0))
        if best is None or c > best[0]:
            best = (c, fc, dem)
    arousal = tv.get("arousal")
    if best is None or not isinstance(arousal, (int, float)):
        return _legacy_join(target)
    _, fc, dem = best
    lab = _k.label_for(str(fc.get("feature_id", "")))
    band = _arousal_band(float(arousal))
    band_ja = {"high": "活発", "medium": "中程度", "low": "落ち着いた"}[band]
    band_en = {"high": "energetic", "medium": "moderate", "low": "calm"}[band]
    ja = f"{lab['ja']}が高く、状況は{dem['ja']}を必要とします。この曲は{band_ja}で、それに合致します。"
    en = (f"{lab['en'].capitalize()} is high, so the situation calls for {dem['en']}; "
          f"this song is {band_en}, which matches.")
    # Sentence 2 — preference/history modifier from the dominant non-situation family.
    if readout:
        for fam in ("preference", "history"):
            val = readout.get(fam, 0.0)
            if abs(val) >= 0.02:
                fam_ja = {"preference": "好み", "history": "利用履歴"}[fam]
                fam_en = {"preference": "your taste", "history": "your history"}[fam]
                verb_ja = "も後押ししました" if val > 0 else "は反対に働きました"
                verb_en = "reinforced the choice" if val > 0 else "pushed against it"
                ja += f" さらに{fam_ja}{verb_ja}。"
                en += f" {fam_en.capitalize()} also {verb_en}."
                break
    return [ja, en]
