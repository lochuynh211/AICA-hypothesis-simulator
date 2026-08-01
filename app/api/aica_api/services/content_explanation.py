"""content_explanation — content (song) proposal explanation.

Builds the grounded prompt and the deterministic template for a content
OrderedItem. Pure (no I/O). Uses the shared kernel in ``explanation_builder``
for labels, factor extraction, parsing, and format anchoring.
"""
from __future__ import annotations

from typing import Any

from aica_api.models.proposal.explanation import ExplainMessage, ExplanationPrompt
from aica_api.services import explanation_builder as _k  # shared kernel

# FIX-D3: motion_state/motion is not a causal, demand-bearing situation
# feature — narrating it produces nonsense like "car motion is high, so the
# situation calls for calm music". Never treat it as a bridge anchor.
_NON_BRIDGE_FEATURES = {"motion_state", "motion"}


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
        if fc.get("feature_id") == "oshi_artists":
            is_oshi = bool(fc.get("exact_match")) or fc.get("e_i") == 1.0
            out.append(f"- By the driver's oshi (favorite artist): {'yes' if is_oshi else 'no'}")
            break
    return out


# Static Context Response Matrix demand (content algorithm §5.2), used when a
# contribution row does not carry alpha/beta. Values are illustrative
# sign/intent only (they intentionally differ in magnitude from the package's
# runtime context_response_matrix) — only the SIGN is consumed by
# ``demand_phrase``.
_STATIC_DEMAND = {
    "drowsiness_level": (0.80, 0.20), "drowsiness": (0.80, 0.20),
    "fatigue_level": (-0.50, 0.50), "fatigue": (-0.50, 0.50),
    "monotony_level": (0.90, 0.10), "monotony": (0.90, 0.10),
    "traffic_state": (-0.40, 0.60), "traffic": (-0.40, 0.60),
    "night_state": (-0.50, 0.50), "night": (-0.50, 0.50),
}

# Directional features whose demand sign depends on the run's
# ``directional_hypothesis`` hyperparameter (see the transparent content
# selector's ``_mood``): a "keep_alert" run flips the sign the default
# ``_STATIC_DEMAND`` entry assumes. When a row for one of these carries no
# alpha/beta we cannot know which hypothesis produced it, so we stay silent
# rather than risk an inverted causal claim (no invented facts).
_DIRECTIONAL_STATIC_UNSAFE = {
    "fatigue_level", "fatigue",
    "traffic_state", "traffic",
    "night_state", "night",
}


def _effective_alpha_beta(alpha, beta, feature_id):
    """Resolve usable (alpha, beta) floats for a feature, falling back to the
    static Context Response Matrix demand when the row carries neither.

    Returns None when there is no usable demand at all (both ~0 / absent and
    no static entry, or a directional feature with no row alpha/beta) — the
    feature is then not a causal bridge.
    """
    if alpha is None and beta is None:
        if feature_id in _DIRECTIONAL_STATIC_UNSAFE:
            return None  # sign is hypothesis-dependent — don't guess
        alpha, beta = _STATIC_DEMAND.get(feature_id, (None, None))
    if alpha is None and beta is None:
        return None
    a = float(alpha or 0.0)
    b = float(beta or 0.0)
    if abs(a) < 1e-6 and abs(b) < 1e-6:
        return None
    return a, b


def demand_phrase(alpha, beta, feature_id):
    """Bilingual 'what this situation calls for' from arousal/valence demand.

    Returns None when there is no usable demand (both coefficients ~0 / absent
    and no static entry) — the feature is then not a causal bridge. Kept as
    the AROUSAL-led legacy phrasing helper (still importable with this exact
    contract); the axis-aware, satisfaction-honest logic used by
    ``causal_bridge_lines``/``template`` lives in ``_axis_bridge`` below.
    """
    resolved = _effective_alpha_beta(alpha, beta, feature_id)
    if resolved is None:
        return None
    a, b = resolved
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


# ── FIX-D2: axis-consistent demand + satisfaction (arousal vs valence) ──────

_AXIS_PHRASES = {
    ("arousal", "energize"): {"en": "energetic, upbeat music", "ja": "活発で高揚感のある曲"},
    ("arousal", "soothe"): {"en": "calm, soothing music", "ja": "穏やかで落ち着いた曲"},
    ("valence", "bright"): {"en": "brighter, more positive music", "ja": "より明るくポジティブな曲"},
    ("valence", "darker"): {"en": "more subdued, mellow music", "ja": "より落ち着いた雰囲気の曲"},
}


def _axis_satisfaction(axis, direction, arousal_band, valence):
    if axis == "arousal":
        return arousal_band == "high" if direction == "energize" else arousal_band == "low"
    if valence is None:
        return False
    return valence >= 0.55 if direction == "bright" else valence < 0.40


def _axis_trait_words(axis, arousal_band, valence):
    """Bilingual description of the song's ACTUAL trait on the given axis."""
    if axis == "arousal":
        band = arousal_band or "medium"
        en = {"high": "high-energy", "medium": "medium-energy", "low": "calm, low-energy"}[band]
        ja = {"high": "ハイエネルギー", "medium": "中程度のエネルギー", "low": "落ち着いた低めのエネルギー"}[band]
        return en, ja
    if valence is None:
        return "neutral in mood", "中立的な雰囲気"
    if valence >= 0.55:
        return "bright", "明るい雰囲気"
    if valence < 0.40:
        return "darker, more subdued", "より落ち着いた雰囲気"
    return "neutral in mood", "中立的な雰囲気"


def _axis_choice(a, b, arousal_band, valence):
    """Pick the (axis, direction, satisfied) the row's demand should be
    narrated with: prefer a SATISFIED axis; if both/neither axis is satisfied,
    pick the larger |coefficient| (tie -> arousal). None when neither
    coefficient carries a demand."""
    candidates = []
    if abs(a) > 1e-9:
        candidates.append(("arousal", "energize" if a > 0 else "soothe", abs(a)))
    if abs(b) > 1e-9:
        candidates.append(("valence", "bright" if b > 0 else "darker", abs(b)))
    if not candidates:
        return None
    scored = [
        (axis, direction, coeff, _axis_satisfaction(axis, direction, arousal_band, valence))
        for axis, direction, coeff in candidates
    ]
    satisfied = [c for c in scored if c[3]]
    pool = satisfied or scored
    pool.sort(key=lambda c: (-c[2], 0 if c[0] == "arousal" else 1))
    axis, direction, _coeff, is_satisfied = pool[0]
    return axis, direction, is_satisfied


def _axis_bridge(a, b, arousal_band, valence):
    """Full bilingual axis-consistent bridge facts for a row, or None."""
    choice = _axis_choice(a, b, arousal_band, valence)
    if choice is None:
        return None
    axis, direction, satisfied = choice
    phrase = _AXIS_PHRASES[(axis, direction)]
    trait_en, trait_ja = _axis_trait_words(axis, arousal_band, valence)
    return {
        "demand_en": phrase["en"], "demand_ja": phrase["ja"],
        "trait_en": trait_en, "trait_ja": trait_ja,
        "satisfied": satisfied,
    }


def causal_bridge_lines(target):
    """One line per situation feature that carries a demand, narrating the
    AXIS (arousal or valence) the song actually satisfies and only claiming a
    match when it truly does (FIX-D2) — the situation->trait causal arrow."""
    tv = target.get("trait_values") or {}
    arousal = tv.get("arousal")
    arousal_band = _arousal_band(float(arousal)) if isinstance(arousal, (int, float)) else None
    valence = tv.get("valence")
    valence = float(valence) if isinstance(valence, (int, float)) else None
    out = []
    for fc in target.get("feature_contributions", []) or []:
        fid = str(fc.get("feature_id", ""))
        if fid in _NON_BRIDGE_FEATURES:
            continue
        resolved = _effective_alpha_beta(fc.get("alpha"), fc.get("beta"), fid)
        if resolved is None:
            continue
        a, b = resolved
        info = _axis_bridge(a, b, arousal_band, valence)
        if info is None:
            continue
        lab = _k.label_for(fid)
        contribution = float(fc.get("contribution", 0.0) or 0.0)
        verdict = (
            f"; this song is {info['trait_en']}, which matches"
            if info["satisfied"]
            else f", though this song leans {info['trait_en']}"
        )
        out.append(
            f"- {lab['ja']} / {lab['en']}: the situation calls for {info['demand_en']}"
            f"{verdict} (contribution {contribution:+.3f})."
        )
    return out


def build_prompt(target: dict[str, Any], context: dict[str, Any]) -> ExplanationPrompt:
    """Content branch — fact-rich reasoning-mode prompt (validated on qwen2.5:3b,
    see .superpowers/sdd/fix-reasoning-prompt-brief.md).

    Hands the model natural-language FACTS (the song's character, the driver's
    situation/taste/history) plus the response matrix in the system prompt,
    and lets it reason the causal story itself — no pre-baked "driven mostly
    by X" verdict and no raw numbers in the user text (grounding still keeps
    the numeric bridge/readout/factors for auditability).
    """
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

    # ── User message: natural-language facts, no scores-only, no verdict ────
    name = context.get("song_name") or target_id
    song_artist = context.get("song_artist")
    oshi_artist = context.get("oshi_artist")
    tv = target.get("trait_values") or {}

    L: list[str] = []
    L.append(
        f'The assistant selected the song "{name}"'
        + (f" by {song_artist}" if song_artist else "")
        + " for the driver."
    )

    arousal = tv.get("arousal")
    valence = tv.get("valence")
    eases = [x for x in (tv.get("humming_ease"), tv.get("full_karaoke_ease")) if isinstance(x, (int, float))]
    desc: list[str] = []
    if isinstance(arousal, (int, float)):
        desc.append(
            "energetic and lively" if arousal >= 0.62 else
            ("calm and low-energy" if arousal < 0.40 else "moderate-energy")
        )
    if isinstance(valence, (int, float)):
        desc.append(
            "bright and positive in mood" if valence >= 0.55 else
            ("darker in mood" if valence < 0.40 else "neutral in mood")
        )
    if eases and max(eases) >= 0.66:
        desc.append("easy to sing along to")
    L.append("")
    L.append("THE SONG: " + ("a song that is " + ", ".join(desc) + "." if desc else "the chosen song."))

    situation = _k.situation_sentence(target, context.get("trigger_purpose"))
    if situation:
        L.append("")
        L.append("THE SITUATION RIGHT NOW: " + situation)

    preference = _k.preference_sentence(context)
    if preference:
        L.append("")
        L.append("THE DRIVER'S TASTE: " + preference)

    history = _k.history_sentences(target)
    if history:
        L.append("")
        L.append("THE DRIVER'S HISTORY WITH THIS SONG/GENRE: " + "; ".join(history) + ".")

    evidence = _k.score_evidence(factors, oshi_artist)
    if evidence:
        L.append("")
        L.append("WHY THE ALGORITHM RANKED IT TOP (strongest reasons first):")
        L.extend(evidence)

    L.append("")
    L.append(_k._FORMAT_REMINDER)

    messages = [
        ExplainMessage(role="system", content=_k._CONTENT_REASON_SYSTEM.format(kind=kind_en)),
        ExplainMessage(role="user", content="\n".join(L)),
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


# ── FIX-D1/D5: feature-family classifier (situation vs preference vs history)

_PREFERENCE_FEATURES = {
    "oshi_artists", "oshi_tags", "oshi_type", "oshi",
    "song_singability", "service_ease",
    "age_band", "age", "gender",
    "hobby_interest_tags", "hobbies",
    "usage_by_genre", "content_tag_usage_level", "scene_content_tag_usage_level",
    "genre_usage", "scene_genre", "genre_affinity",
}
_HISTORY_FEATURES = {
    "catalog_item_usage_level", "item_usage",
    "catalog_item_recency_state",
    "content_proposal_acceptance_rate", "acceptance",
    "content_recovery_rate", "recovery",
    "played_items", "played",
    "skipped_items", "skipped",
    "changed_from_items", "changed",
    "repeated_items", "completed_items", "cancelled_content_plans",
    "manually_selected_items", "content_tag_recency_state",
}
_SITUATION_FEATURES = {
    "drowsiness_level", "drowsiness", "fatigue_level", "fatigue",
    "monotony_level", "monotony", "traffic_state", "traffic",
    "night_state", "night", "road_type", "road",
    "route_tags", "route", "destination_tags", "destination",
    "child_present", "child", "multiple_passengers",
}


def _family_of(feature_id: str) -> str | None:
    if feature_id in _SITUATION_FEATURES:
        return "situation"
    if feature_id in _PREFERENCE_FEATURES:
        return "preference"
    if feature_id in _HISTORY_FEATURES:
        return "history"
    return None


_LEVEL_WORDS_EN = {"high": "high", "medium": "elevated", "low": "low"}
# Pre-conjugated so it drops directly in front of "、状況は…" (i-adjective
# renyoukei for high/low; "やや高めで" reads naturally as the medium band).
_LEVEL_WORDS_JA = {"high": "高く", "medium": "やや高めで", "low": "低く"}
_FAM_PHRASE = {
    "preference": {"ja": "運転者の好み", "en": "the driver's taste", "short_ja": "好み", "short_en": "your taste"},
    "history": {"ja": "利用履歴", "en": "the driver's history", "short_ja": "利用履歴", "short_en": "your history"},
}
# FIX-D4: only claim taste/history "also reinforced" the choice on a real
# signal — a blank-profile default (tiny preference_fit) must not invent it.
_REINFORCE_MIN_ABS = 0.05


def _dominant_family_sentence1(target: dict, dom: str):
    """FIX-D5: when preference/history dominates, lead with that family +
    its strongest POSITIVE supporting feature. None if no such feature (falls
    through to the situation branch)."""
    best = None
    for fc in target.get("feature_contributions", []) or []:
        fid = str(fc.get("feature_id", ""))
        if _family_of(fid) != dom:
            continue
        c = float(fc.get("contribution", 0.0) or 0.0)
        if c <= 0:
            continue
        if best is None or c > best[0]:
            best = (c, fc)
    if best is None:
        return None
    _, fc = best
    lab = _k.label_for(str(fc.get("feature_id", "")))
    ph = _FAM_PHRASE[dom]
    ja = f"この選択は主に{ph['ja']}、特に{lab['ja']}によって決まりました。"
    en = f"This choice was led mainly by {ph['en']}, especially {lab['en']}."
    return ja, en


def _situation_led_sentence1(target: dict, arousal_band, valence):
    """FIX-D1/D2: strongest demand-bearing SITUATION feature, narrated with
    its REAL value band and the axis the song actually satisfies. None
    (-> legacy join) when there is no such feature or no numeric arousal."""
    tv = target.get("trait_values") or {}
    best = None
    for fc in target.get("feature_contributions", []) or []:
        fid = str(fc.get("feature_id", ""))
        if fid in _NON_BRIDGE_FEATURES or _family_of(fid) != "situation":
            continue
        resolved = _effective_alpha_beta(fc.get("alpha"), fc.get("beta"), fid)
        if resolved is None:
            continue
        value = fc.get("e_i")
        if value is None:
            value = fc.get("feature_value")
        if not isinstance(value, (int, float)):
            continue
        c = abs(float(fc.get("contribution", 0.0) or 0.0))
        if best is None or c > best[0]:
            best = (c, fc, resolved, value)
    if best is None or arousal_band is None:
        return None
    _, fc, (a, b), value = best
    info = _axis_bridge(a, b, arousal_band, valence)
    if info is None:
        return None
    lab = _k.label_for(str(fc.get("feature_id", "")))
    level = _k._value_display(value)
    level_en, level_ja = _LEVEL_WORDS_EN[level], _LEVEL_WORDS_JA[level]
    if info["satisfied"]:
        clause_en, clause_ja = ", which matches.", "、それに合致します。"
    else:
        clause_en, clause_ja = " — a partial match.", "、部分的な一致です。"
    ja = (f"{lab['ja']}は{level_ja}、状況は{info['demand_ja']}を必要とします。"
          f"この曲は{info['trait_ja']}で{clause_ja}")
    en = (f"{lab['en'].capitalize()} is {level_en}, so the situation calls for {info['demand_en']}; "
          f"this song is {info['trait_en']}{clause_en}")
    return ja, en


def template(target):
    readout = _k.category_readout(target)
    tv = target.get("trait_values") or {}
    arousal = tv.get("arousal")
    arousal_band = _arousal_band(float(arousal)) if isinstance(arousal, (int, float)) else None
    valence = tv.get("valence")
    valence = float(valence) if isinstance(valence, (int, float)) else None

    dom = readout["dominant"] if readout else None
    lead_family = None
    sentence1 = None

    if dom in ("preference", "history"):
        sentence1 = _dominant_family_sentence1(target, dom)
        if sentence1 is not None:
            lead_family = dom

    if sentence1 is None:
        sentence1 = _situation_led_sentence1(target, arousal_band, valence)

    if sentence1 is None:
        return _legacy_join(target)

    ja, en = sentence1

    # Sentence 2 (FIX-D4) — taste/history reinforcement, only when that family
    # is NOT already the sentence-1 lead and it carries a real (>=0.05) signal.
    if readout:
        for fam in ("preference", "history"):
            if fam == lead_family:
                continue
            val = readout.get(fam, 0.0)
            if abs(val) >= _REINFORCE_MIN_ABS:
                ph = _FAM_PHRASE[fam]
                verb_ja = "も後押ししました" if val > 0 else "は反対に働きました"
                verb_en = "reinforced the choice" if val > 0 else "pushed against it"
                ja += f" さらに{ph['short_ja']}{verb_ja}。"
                en += f" {ph['short_en'].capitalize()} also {verb_en}."
                break
    return [ja, en]
