"""explanation_builder — pure grounding + parsing helpers (feature 019).

Turns an already-computed decision (a service ``RankedCandidate`` or a content
``OrderedItem`` dict, read back out of the persisted evidence) into:

  - ``build_explanation_prompt`` — a provider-agnostic ``ExplanationPrompt``
    (system + user messages) grounded STRICTLY in the given facts, used
    identically by the backend (Ollama) and browser (Gemini Nano) providers,
  - ``parse_bilingual`` — a defensive parser turning model output into the
    positional ``[ja, en]`` pair the frontend expects,
  - ``template_rationale`` — the deterministic fallback that reuses the
    package-produced ``rationale`` already on the target (normalizing the
    content selector's variable-length ``"<ja> / <en>"`` list into a clean
    ``[ja, en]`` pair), used whenever the LLM is unavailable/fails.

Everything here is pure (no I/O), so it is exhaustively unit-testable. The
builder never invents data — it only reshapes facts already present in the
decision trace, preserving the transparency contract (Constitution I/II/V).
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from aica_api.models.proposal.explanation import ExplainMessage, ExplanationPrompt

# Maximal grounding (feature 019): hand the model EVERY meaningfully-scored
# contribution (not just a top-N slice). Exact-zero / negligible contributions
# are dropped as noise; the list is still bounded for safety.
MAX_FACTORS = 24
_MIN_ABS_CONTRIBUTION = 1e-6

# Separator the content selector uses between the ja and en halves of each
# combined rationale entry (see packages/aica_transparent_content_selector_v1).
_CONTENT_LANG_SEP = " / "


# ---------------------------------------------------------------------------
# Feature labels — merged union of BOTH packages' _FEATURE_LABELS maps.
# The service selector keys by full feature_id (e.g. "drowsiness_level"); the
# content selector keys by short leaf id (e.g. "drowsiness"). We union both
# namespaces so a lookup by whatever `feature_id` appears in a contribution
# resolves; unknown ids fall back to the raw id string.
# ---------------------------------------------------------------------------
FEATURE_LABELS: dict[str, dict[str, str]] = {
    # service selector namespace
    "drowsiness_level": {"ja": "眠気", "en": "drowsiness"},
    "fatigue_level": {"ja": "疲労", "en": "fatigue"},
    "traffic_state": {"ja": "渋滞", "en": "traffic"},
    "road_type": {"ja": "道路種別", "en": "road type"},
    "night_state": {"ja": "夜間", "en": "night"},
    "monotony_level": {"ja": "単調性", "en": "monotony"},
    "route_tags": {"ja": "ルート特性", "en": "route characteristics"},
    "destination_tags": {"ja": "目的地特性", "en": "destination characteristics"},
    "child_present": {"ja": "子供同乗", "en": "child present"},
    "multiple_passengers": {"ja": "複数乗員", "en": "multiple passengers"},
    "oshi_registered": {"ja": "推し登録", "en": "oshi registered"},
    "oshi_mode": {"ja": "推しモード", "en": "oshi mode"},
    "service_recency_state": {"ja": "サービス未使用度", "en": "service recency"},
    "service_usage_level": {"ja": "サービス利用頻度", "en": "overall service usage"},
    "scene_service_usage_level": {"ja": "場面別サービス利用", "en": "scene-specific service usage"},
    "service_proposal_acceptance_rate": {"ja": "提案受諾率", "en": "proposal acceptance rate"},
    "service_recovery_rate": {"ja": "回復率", "en": "recovery rate"},
    # content selector leaf namespace
    "drowsiness": {"ja": "眠気", "en": "drowsiness"},
    "fatigue": {"ja": "疲労", "en": "fatigue"},
    "monotony": {"ja": "単調性", "en": "monotony"},
    "traffic": {"ja": "渋滞", "en": "traffic"},
    "road": {"ja": "道路種別", "en": "road type"},
    "night": {"ja": "夜間", "en": "night"},
    "motion": {"ja": "走行状態", "en": "motion"},
    "service_ease": {"ja": "歌いやすさ", "en": "singability"},
    "oshi": {"ja": "推し一致", "en": "oshi match"},
    "age": {"ja": "年代適合", "en": "era fit"},
    "item_usage": {"ja": "利用頻度", "en": "usage"},
    "played": {"ja": "再生履歴", "en": "recent play"},
    "skipped": {"ja": "スキップ履歴", "en": "skip history"},
    "changed": {"ja": "変更履歴", "en": "change history"},
    "acceptance": {"ja": "受容率", "en": "acceptance rate"},
    "recovery": {"ja": "回復率", "en": "recovery rate"},
    "route": {"ja": "ルート適合", "en": "route fit"},
    "destination": {"ja": "目的地適合", "en": "destination fit"},
    "child": {"ja": "子供向け", "en": "child-friendly"},
    "hobbies": {"ja": "趣味適合", "en": "hobby fit"},
    "genre_usage": {"ja": "ジャンル利用", "en": "genre usage"},
    "scene_genre": {"ja": "シーン別ジャンル", "en": "scene genre"},
    # content selector FULL feature_id namespace — what ItemFeatureContribution
    # actually reports (distinct from the short leaf keys above). Without these
    # the content prompt showed raw ids like "oshi_id / oshi_id", which the model
    # transliterated to 「オシアイド」. These fix the content labels.
    "oshi_id": {"ja": "推し一致", "en": "oshi (favorite-artist) match"},
    "oshi_tags": {"ja": "推しタグ一致", "en": "oshi-tag match"},
    "oshi_type": {"ja": "推しタイプ", "en": "oshi type"},
    "song_singability": {"ja": "歌いやすさ", "en": "sing-along ease"},
    "catalog_item_usage_level": {"ja": "この曲の利用頻度", "en": "how often this song is played"},
    "catalog_item_recency_state": {"ja": "この曲の未再生度", "en": "time since this song was played"},
    "content_tag_usage_level": {"ja": "ジャンル利用頻度", "en": "genre/tag play frequency"},
    "content_tag_recency_state": {"ja": "ジャンル未再生度", "en": "genre/tag recency"},
    "scene_content_tag_usage_level": {"ja": "場面別ジャンル利用", "en": "scene-specific genre usage"},
    "usage_by_genre": {"ja": "ジャンル別利用", "en": "usage by genre"},
    "scene_genre_usage": {"ja": "場面別ジャンル", "en": "scene genre usage"},
    "content_proposal_acceptance_rate": {"ja": "曲提案の受諾率", "en": "song-proposal acceptance rate"},
    "content_recovery_rate": {"ja": "曲による回復率", "en": "recovery rate from this song"},
    "played_items": {"ja": "再生履歴", "en": "recently played"},
    "skipped_items": {"ja": "スキップ履歴", "en": "recently skipped"},
    "changed_from_items": {"ja": "変更履歴", "en": "recently switched away from"},
    "repeated_items": {"ja": "繰り返し再生", "en": "repeated plays"},
    "completed_items": {"ja": "完了履歴", "en": "played to completion"},
    "cancelled_content_plans": {"ja": "取消履歴", "en": "cancelled plans"},
    "manually_selected_items": {"ja": "手動選択", "en": "manually chosen"},
    "motion_state": {"ja": "走行状態", "en": "car motion"},
    "age_band": {"ja": "年代", "en": "driver age band"},
    "gender": {"ja": "性別", "en": "driver gender"},
    "hobby_interest_tags": {"ja": "趣味関心", "en": "hobby interests"},
}

# Plain-English "what this feature is" — one line each, driver-facing and
# step-agnostic. Deliberately NOT the cryptic scoring formulas from the
# disposition registry (e.g. "2·rate/100−1"), which a small model would parrot.
# Missing → "" (the label alone is shown).
_FEATURE_MEANINGS: dict[str, str] = {
    "drowsiness_level": "how sleepy the driver is (0 = alert … 100 = very drowsy)",
    "fatigue_level": "how physically tired the driver is (0–100)",
    "monotony_level": "how monotonous/boring the road feels (0–100)",
    "traffic_state": "the current traffic level",
    "road_type": "the kind of road (e.g. highway vs local)",
    "night_state": "whether it is day or night",
    "route_tags": "characteristics of the route (e.g. highway)",
    "destination_tags": "characteristics of the destination",
    "child_present": "whether a child is in the car",
    "multiple_passengers": "whether there are several passengers",
    "motion_state": "whether the car is moving or stopped",
    "oshi_registered": "whether the driver has registered a favorite artist (oshi)",
    "oshi_mode": "whether oshi (favorite-artist) mode is turned on",
    "oshi_id": "whether this song is by the driver's registered oshi (favorite artist)",
    "oshi_tags": "whether the song matches the driver's oshi tags",
    "song_singability": "how easy this song is to sing or hum along to",
    "service_recency_state": "how long since this service was last used",
    "service_usage_level": "how often the driver uses this service overall",
    "scene_service_usage_level": "how often the driver uses this service in this kind of scene",
    "service_proposal_acceptance_rate": "how often the driver accepts this service when offered",
    "service_recovery_rate": "how well this service has restored the driver's state before",
    "catalog_item_usage_level": "how often the driver plays this particular song",
    "catalog_item_recency_state": "how long since the driver last played this song",
    "content_tag_usage_level": "how much the driver plays this song's genre/tags",
    "content_tag_recency_state": "how long since the driver played this genre/tags",
    "content_proposal_acceptance_rate": "how often the driver accepts this song when proposed",
    "content_recovery_rate": "how well this song has restored the driver's state before",
    "played_items": "whether the driver played this song recently",
    "skipped_items": "whether the driver skipped this song recently",
    "changed_from_items": "whether the driver recently switched away from this song",
    "age_band": "the driver's age group",
    "hobby_interest_tags": "the driver's hobby interests",
}


def label_for(feature_id: str) -> dict[str, str]:
    """Bilingual label for a feature id, falling back to the raw id."""
    return FEATURE_LABELS.get(feature_id, {"ja": feature_id, "en": feature_id})


def feature_meaning(feature_id: str) -> str:
    """Plain-English meaning of a feature id (``""`` when unknown)."""
    return _FEATURE_MEANINGS.get(feature_id, "")


# ---------------------------------------------------------------------------
# Prompt construction
# ---------------------------------------------------------------------------

# The two-line example that anchors the output FORMAT. It uses obvious
# PLACEHOLDERS ("factor A/B", "要因A/B") rather than real features or a copyable
# generic sentence, because:
#   - a concrete example naming real features leaked into reasons (3b reused
#     "traffic / destination"), and
#   - a generic-but-complete sentence got copied VERBATIM (esp. the JA line),
#     tripping response_is_usable and nuking otherwise-good output.
# Placeholders force the model to substitute the real top factors in BOTH lines
# while still demonstrating the JA:/EN: shape. Verbatim parroting → template.
_EXAMPLE_JA = "「要因A」と「要因B」が最も強く働いたため、この選択に至りました。"
_EXAMPLE_EN = "Factor A and factor B contributed the most, which is why this choice was made."

# Robust, example-anchored format instruction. Small local models tend to
# (a) ignore the format and echo the facts, or (b) reply in one language only —
# both seen live with qwen2.5:0.5b. The rules are therefore explicit and
# imperative, the two-language requirement is stated per line, and a concrete
# two-line example fixes the shape. A matching one-line reminder is appended to
# the END of the user message (recency) in build_explanation_prompt. Output that
# still doesn't comply is caught by response_is_usable() → template fallback.
_SYSTEM_TEMPLATE = (
    "You write a short, faithful explanation of why an in-car assistant selected "
    "a {kind} for the driver — in BOTH Japanese and English.\n"
    "\n"
    "Rules:\n"
    "- Use ONLY the facts in the next message. Never invent features, numbers, "
    "songs, or driver preferences that are not listed.\n"
    "- Do NOT copy or repeat the fact lines, and do NOT restate the raw numeric "
    "scores. Explain qualitatively which factors most drove the choice and which "
    "pushed against it.\n"
    "- Reply with EXACTLY two lines and NOTHING else: no preamble, no greeting, "
    "no notes, no markdown, no blank line between them.\n"
    "- Line 1 MUST start with 'JA:' and be written in Japanese. Line 2 MUST "
    "start with 'EN:' and be written in English. ALWAYS output both lines, each "
    "one or two natural sentences.\n"
    "\n"
    "Follow this exact shape (copy the format, NOT the wording):\n"
    "JA: " + _EXAMPLE_JA + "\n"
    "EN: " + _EXAMPLE_EN
)

# Appended to the end of the user message so the format is the last thing the
# model reads before generating.
_FORMAT_REMINDER = (
    "Reply with exactly two lines and nothing else: a 'JA:' line in Japanese, "
    "then an 'EN:' line in English."
)


def _factors_from_target(target: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract, label, define, and rank the contributions of a candidate/item.

    Works for both shapes: service ``FeatureContribution`` (``feature_value``)
    and content ``ItemFeatureContribution`` (``e_i``). Drops negligible (~0)
    contributions, sorts by ``|contribution|`` descending, caps at ``MAX_FACTORS``.
    """
    factors: list[dict[str, Any]] = []
    for fc in target.get("feature_contributions", []) or []:
        contribution = float(fc.get("contribution", 0.0) or 0.0)
        if abs(contribution) < _MIN_ABS_CONTRIBUTION:
            continue
        fid = str(fc.get("feature_id", ""))
        lab = label_for(fid)
        value = fc.get("feature_value")
        if value is None:
            value = fc.get("e_i")
        factors.append(
            {
                "feature_id": fid,
                "label_ja": lab["ja"],
                "label_en": lab["en"],
                "contribution": contribution,
                "value": value,
                "meaning": feature_meaning(fid),
            }
        )
    factors.sort(key=lambda f: abs(f["contribution"]), reverse=True)
    return factors[:MAX_FACTORS]


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


def build_explanation_prompt(
    step: str,
    target: dict[str, Any],
    context: dict[str, Any],
) -> ExplanationPrompt:
    """Build the grounded ``ExplanationPrompt`` for a candidate/item.

    ``step`` is ``"service"`` or ``"content"``; ``target`` is the candidate/item
    dict from the persisted evidence output; ``context`` carries run-level facts
    (``trigger_purpose``, ``lifecycle_stage``). Deterministic — same inputs
    always produce the same prompt (so ``prompt_hash`` is stable).
    """
    is_service = step == "service"
    kind_en = "service" if is_service else "song"
    target_id = str(target.get("candidate_id") if is_service else target.get("item_id") or "")
    rank = target.get("rank") if is_service else target.get("position")
    fit = target.get("score") if is_service else target.get("item_fit")

    factors = _factors_from_target(target)
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

    song_facts = _song_facts_lines(target, context) if not is_service else []

    grounding: dict[str, Any] = {
        "step": step,
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
    formula = (
        "fit = clamp( sum over factors of (weight x response), -1..+1 )"
        if is_service
        else "fit = clamp( sum over factors of (weight x evidence x response), -1..+1 )"
    )
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
        labs = ", ".join(label_for(s)["en"] for s in supporting)
        lines.append(f"Overall pushed TOWARD this choice by: {labs}.")
    if opposing:
        labs = ", ".join(label_for(o)["en"] for o in opposing)
        lines.append(f"Pushed AGAINST by: {labs}.")

    # Terminal format reminder (recency) — the last thing the model reads.
    lines.append("")
    lines.append(_FORMAT_REMINDER)

    messages = [
        ExplainMessage(role="system", content=_SYSTEM_TEMPLATE.format(kind=kind_en)),
        ExplainMessage(role="user", content="\n".join(lines)),
    ]
    return ExplanationPrompt(messages=messages, grounding=grounding)


def prompt_hash(prompt: ExplanationPrompt) -> str:
    """Stable content hash of a prompt (for auditability / cache keys)."""
    blob = json.dumps(
        [[m.role, m.content] for m in prompt.messages],
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Output parsing
# ---------------------------------------------------------------------------

def response_is_usable(rationale: list[str], prompt: ExplanationPrompt) -> bool:
    """Reject empty or prompt-echoing output from a weak/misconfigured model.

    A small model that ignores the format instruction often just echoes the
    fact lines it was given (verified with qwen2.5:0.5b). ``parse_bilingual``
    would then present that echo as a real generation. Treat output as unusable
    when it is empty, OR when EVERY non-empty produced line is a verbatim echo
    of a fact line from the user prompt — so the caller falls back honestly to
    the template instead of showing echoed nonsense as an AI explanation.
    """
    texts = [t.strip() for t in rationale if t and t.strip()]
    if not texts:
        return False
    # A model that parrots the format example verbatim (instead of grounding in
    # the facts) is not a real explanation → unusable.
    if any(t == _EXAMPLE_JA or t == _EXAMPLE_EN for t in texts):
        return False
    user_lines: set[str] = set()
    for m in prompt.messages:
        if m.role == "user":
            for ln in m.content.splitlines():
                s = ln.strip().lstrip("-").strip()
                if s:
                    user_lines.add(s)
    non_echo = [t for t in texts if t not in user_lines and t.lstrip("-").strip() not in user_lines]
    return len(non_echo) > 0


# Leftover format-example PLACEHOLDER tokens a weak model sometimes copies
# literally ("factor A/B", "要因A/B", optionally wrapped in brackets/quotes).
# `\bfactors?\s+[ab]\b` requires the a/b to stand alone, so real words like
# "factor above" are never touched.
_PLACEHOLDER_RE = re.compile(
    r"[（(「\[]?\s*(?:\bfactors?\s+[ab]\b|要因[abＡＢ])\s*[)\]」）]?",
    re.IGNORECASE,
)


def strip_placeholder_artifacts(text: str) -> str:
    """Remove any leftover format-example placeholder tokens and tidy the
    surrounding punctuation/whitespace. Applied to displayable output ONLY after
    ``response_is_usable`` has run (so it never weakens the echo/parrot guard)."""
    if not text:
        return text
    out = _PLACEHOLDER_RE.sub("", text)
    out = re.sub(r"[（(「\[]\s*[)\]」）]", "", out)             # empty bracket pairs left behind
    out = re.sub(r"\s{2,}", " ", out)                          # collapse doubled spaces
    out = re.sub(r"\s+([.,!?;:。、！？)）])", r"\1", out)       # space before punctuation
    out = re.sub(r"^\s*(?:and|、|,)\s+", "", out.strip())      # dangling leading conjunction
    out = re.sub(r"\s*(?:and|、|,)\s*$", "", out.strip())      # dangling trailing conjunction
    return out.strip()


def parse_bilingual(text: str) -> list[str]:
    """Parse model output into a positional ``[ja, en]`` pair, defensively.

    Order of attempts: ``JA:``/``EN:`` prefixed lines (case-insensitive) →
    first two non-empty lines → the whole text used for both. Code fences and
    surrounding whitespace are stripped. Empty input yields ``["", ""]``.
    """
    cleaned = (text or "").strip()
    # strip ``` fences
    lines_all = [ln for ln in cleaned.splitlines() if ln.strip().strip("`") != ""]
    ja: str | None = None
    en: str | None = None
    plain: list[str] = []
    for raw in lines_all:
        ln = raw.strip().strip("`").strip()
        low = ln.lower()
        if low.startswith("ja:"):
            ja = ln[3:].strip()
        elif low.startswith("en:"):
            en = ln[3:].strip()
        else:
            plain.append(ln)

    if ja is not None or en is not None:
        return [ja or en or "", en or ja or ""]
    if len(plain) >= 2:
        return [plain[0], plain[1]]
    if len(plain) == 1:
        return [plain[0], plain[0]]
    return ["", ""]


# ---------------------------------------------------------------------------
# Deterministic template fallback (reuses the package-produced rationale)
# ---------------------------------------------------------------------------

def template_rationale(step: str, target: dict[str, Any]) -> list[str]:
    """Return the deterministic ``[ja, en]`` fallback for a candidate/item.

    Reuses the ``rationale`` the algorithm package already computed (so the
    fallback is byte-identical to today's behavior). The content selector emits
    a variable-length list of ``"<ja> / <en>"`` strings; this normalizes that
    into a single ``[ja, en]`` pair. Missing/empty rationale → ``["", ""]``.
    """
    rationale = target.get("rationale") or []
    if not isinstance(rationale, list) or not rationale:
        return ["", ""]

    if step == "service":
        # Already a positional [ja, en] pair — pad/truncate to length 2.
        ja = str(rationale[0]) if len(rationale) >= 1 else ""
        en = str(rationale[1]) if len(rationale) >= 2 else ja
        return [ja, en]

    # content: list of combined "<ja> / <en>" entries → clean pair
    ja_parts: list[str] = []
    en_parts: list[str] = []
    for entry in rationale:
        s = str(entry)
        if _CONTENT_LANG_SEP in s:
            left, right = s.split(_CONTENT_LANG_SEP, 1)
            ja_parts.append(left.strip())
            en_parts.append(right.strip())
        else:
            ja_parts.append(s.strip())
            en_parts.append(s.strip())
    return ["、".join(ja_parts), "; ".join(en_parts)]
