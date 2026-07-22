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

from aica_api.models.proposal.explanation import ExplanationPrompt

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
    "drowsiness_level": "how sleepy the driver is (alert → very drowsy)",
    "fatigue_level": "how physically tired the driver is",
    "monotony_level": "how monotonous/boring the road feels",
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

# The two-line example, kept ONLY as a parrot-guard fixture (response_is_usable
# rejects output that copies it verbatim, and strip_placeholder_artifacts still
# strips its "factor A/B" placeholders). It uses obvious PLACEHOLDERS
# ("situation A", "factor B", "要因B") rather than real features or a copyable
# generic sentence, because:
#   - a concrete example naming real features leaked into reasons (3b reused
#     "traffic / destination"), and
#   - a generic-but-complete sentence got copied VERBATIM (esp. the JA line),
#     tripping response_is_usable and nuking otherwise-good output.
# The reasoning-mode system prompts below deliberately do NOT embed this (or
# any) example — a concrete example is exactly what got parroted — but the
# guard functions still reference these constants defensively.
_EXAMPLE_JA = "「状況A」は「〜」を必要とし、この選択はそれに合致します。さらに「要因B」が後押ししました。"
_EXAMPLE_EN = "Situation A calls for a certain kind of choice, and this one matches it; factor B further reinforced it."

# Appended to the end of the user message so the format is the last thing the
# model reads before generating.
_FORMAT_REMINDER = (
    "Reply with exactly two lines and nothing else: a 'JA:' line in Japanese, "
    "then an 'EN:' line in English."
)

# ---------------------------------------------------------------------------
# Reasoning-mode system prompts (validated by A/B on qwen2.5:3b over 35
# presets — see .superpowers/sdd/fix-reasoning-prompt-brief.md). Each carries
# ITS OWN response matrix (what the algorithm does + what each situation/
# trigger calls for) so the model reasons the causal story itself from
# natural-language FACTS in the user message, instead of being handed a
# pre-baked "driven mostly by X" verdict (which biases the model and caused
# situation/oshi hallucinations in the old numbers-only design).
# ---------------------------------------------------------------------------

# Shared closing paragraph: mentions 'JA:'/'EN:' twice each (format guard) and
# explicitly forbids copying the fact lines verbatim (anti-parrot), WITHOUT
# embedding a concrete copyable example.
_REASON_CLOSING = (
    "Use ONLY the given facts; never invent features, numbers, songs, or driver "
    "preferences that are not listed. Do NOT copy the fact lines verbatim.\n\n"
    "Reply with EXACTLY two lines and nothing else: a 'JA:' line in Japanese, "
    "then an 'EN:' line in English. Line 1 starts 'JA:', line 2 starts 'EN:', "
    "each one or two natural sentences."
)

_CONTENT_REASON_SYSTEM = (
    "You explain why an in-car assistant selected a {kind} for the driver — in BOTH "
    "Japanese and English. You are given the raw scoring facts; work out the causal story "
    "yourself. Do not just restate numbers.\n\n"
    "WHAT THE ALGORITHM DOES\n"
    "Each song is distilled into traits: arousal (energy — how lively the song is), valence "
    "(brightness/positivity of its mood), and sing-along ease. The driver's current situation "
    "CALLS FOR a certain kind of music, and a song scores well when its traits answer that call.\n\n"
    "WHAT EACH SITUATION CALLS FOR (the response model — apply this):\n"
    "- Drowsiness -> MORE energetic (higher arousal) AND brighter music (re-energize).\n"
    "- Monotony -> MORE energetic and brighter music (counter boredom).\n"
    "- Fatigue -> CALMER (lower arousal) but brighter music (soothe without dulling).\n"
    "- Heavy traffic -> CALMER but brighter music (de-stress).\n"
    "- Night -> CALMER, brighter music.\n"
    "- Winding/mountain road -> CALMER music (matches the heavier driving load).\n"
    "- Highway / local roads -> no particular energy demand.\n\n"
    "HOW A FACTOR SCORES\n"
    "A factor's contribution = how much the trigger purpose weights it TIMES how well the "
    "chosen {kind} answered what it calls for. So a POSITIVE contribution from, say, drowsiness "
    "means the song was energetic/bright enough to answer it. Factors group into three families: "
    "the driving SITUATION (above), the driver's TASTE (favorite artist, genre, era, singability), "
    "and the driver's HISTORY (past plays, skips, acceptance, recovery). The family with the "
    "largest subtotal drove the choice most.\n\n"
    "YOUR TASK\n"
    "Reason the causal story: (1) which family dominated (compare the subtotals); (2) what its "
    "top factors called for; (3) how the {kind}'s actual character answered that; (4) how the "
    "other families reinforced or tempered it.\n\n" + _REASON_CLOSING
)

_SERVICE_REASON_SYSTEM = (
    "You explain why an in-car assistant proposed a SERVICE (not a song) to the driver — in "
    "BOTH Japanese and English. Work out the causal story from the facts; do not just restate "
    "numbers.\n\n"
    "WHAT THE ALGORITHM DOES\n"
    "After a trigger decides a proposal is warranted, it ranks which service to offer. Each "
    "candidate service has a RESPONSE to the current situation — how well that service answers "
    "what the situation needs. A factor's contribution = how strong that situation signal is "
    "TIMES how well this service responds to it, shaped by the trigger purpose.\n\n"
    "WHAT EACH KIND OF SERVICE IS FOR (the response model — apply this):\n"
    "- Interactive / engaging services (humming karaoke, call-and-response, quiz, ranking) keep "
    "a drowsy or bored driver alert — they strongly respond to drowsiness, fatigue, monotony.\n"
    "- Background music (music playlist, radio) is a low-demand default — mainly driven by the "
    "route/music purpose, largely neutral to driver state.\n"
    "- Rest & recovery services (stretch video, full karaoke, live viewing, oshi re-experience) "
    "are for when the car is stopped or after a rest — they fit rest/stopped stages, not "
    "active driving.\n"
    "The trigger purpose steers the emphasis: a rest recommendation favors rest bridging; "
    "inattentive-driving prevention favors engaging services; routine music favors the music "
    "services; a child aboard favors child-friendly ones.\n\n"
    "HOW A FACTOR SCORES\n"
    "Factors group into three families: the driving SITUATION (drowsiness, fatigue, traffic, "
    "road, night, monotony) plus the trigger and car state; the driver's service TASTE; and the "
    "driver's HISTORY with this service (past acceptance, recovery, usage). The family with the "
    "largest subtotal drove the choice most.\n\n"
    "YOUR TASK\n"
    "Reason the causal story: (1) what the trigger + situation call for; (2) how the chosen "
    "service answers that; (3) how history/other factors reinforced or tempered it.\n\n"
    "Explain using the ranked reasons below; only cite a situation as a reason if it drove THIS "
    "service. Never argue that a different kind of service is needed than the one that was "
    "chosen.\n\n"
    + _REASON_CLOSING
)


def _value_display(value: Any) -> str:
    """Qualitative band for a factor's raw value (FIX-SCALE).

    Numeric ``e_i``/``feature_value`` (0–1 normalized evidence) is banded into
    "high"/"medium"/"low" so it reads consistently against the 0–100 style
    meanings, instead of showing a raw fraction like ``0.7`` that looks low
    against a 0–100 scale. Non-empty strings (service categoricals like
    "heavy"/"high") pass through unchanged. Missing/blank -> "".
    """
    if isinstance(value, bool):
        return "high" if value else "low"
    if isinstance(value, (int, float)):
        v = float(value)
        if v >= 0.62:
            return "high"
        if v < 0.40:
            return "low"
        return "medium"
    if isinstance(value, str) and value:
        return value
    return ""


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
                "value_display": _value_display(value),
                "meaning": feature_meaning(fid),
            }
        )
    factors.sort(key=lambda f: abs(f["contribution"]), reverse=True)
    return factors[:MAX_FACTORS]


# ---------------------------------------------------------------------------
# Shared natural-language fact translators (fact-rich reasoning prompts).
#
# These turn a target's ``feature_contributions`` rows into plain-language
# FACTS (bands/strength words, never raw numbers) for the fact-rich user
# messages built by ``content_explanation.build_prompt`` /
# ``service_explanation.build_prompt``. This classifier is intentionally
# SEPARATE from content_explanation's private ``_family_of``/feature sets
# (which the UNCHANGED deterministic ``template()`` still uses) so nothing
# here can alter template output.
# ---------------------------------------------------------------------------

_REASON_SITUATION_FEATURES = {
    "drowsiness_level", "drowsiness", "fatigue_level", "fatigue",
    "monotony_level", "monotony", "traffic_state", "traffic",
    "night_state", "night", "road_type", "road",
    "route_tags", "route", "destination_tags", "destination",
    "child_present", "child", "multiple_passengers",
}
_REASON_PREFERENCE_FEATURES = {
    "oshi_id", "oshi_tags", "oshi_type", "oshi",
    "song_singability", "service_ease",
    "age_band", "age", "gender",
    "hobby_interest_tags", "hobbies",
    "usage_by_genre", "genre_usage", "scene_genre", "genre_affinity",
}
_REASON_HISTORY_FEATURES = {
    "catalog_item_usage_level", "item_usage",
    "catalog_item_recency_state",
    "content_proposal_acceptance_rate", "acceptance",
    "content_recovery_rate", "recovery",
    "played_items", "played",
    "skipped_items", "skipped",
    "changed_from_items", "changed",
    "repeated_items", "completed_items", "cancelled_content_plans",
    "manually_selected_items", "content_tag_recency_state",
    "content_tag_usage_level", "scene_content_tag_usage_level",
    "service_recency_state", "service_usage_level", "scene_service_usage_level",
    "service_proposal_acceptance_rate", "service_recovery_rate",
}


def feature_family(feature_id: str) -> str | None:
    """``"situation"`` | ``"preference"`` | ``"history"`` | ``None`` for a feature id.

    Used ONLY by the new fact-rich reasoning prompts (see module docstring
    above) — independent of ``content_explanation``'s own classifier.
    """
    if feature_id in _REASON_SITUATION_FEATURES:
        return "situation"
    if feature_id in _REASON_PREFERENCE_FEATURES:
        return "preference"
    if feature_id in _REASON_HISTORY_FEATURES:
        return "history"
    return None


def _lvl3(v: float | None, lo: float, hi: float) -> str | None:
    if v is None:
        return None
    return "low" if v < lo else ("high" if v >= hi else "mid")


def _reason_row_value(target: dict[str, Any], *feature_ids: str) -> Any:
    """Raw ``feature_value`` (preferred) or ``e_i`` scaled to 0–100 for the
    first matching row among ``feature_ids`` (full + short leaf forms)."""
    for fc in target.get("feature_contributions", []) or []:
        if str(fc.get("feature_id", "")) in feature_ids:
            v = fc.get("feature_value")
            if v is not None:
                return v
            e = fc.get("e_i")
            if isinstance(e, (int, float)):
                return float(e) * 100.0
            return None
    return None


def _reason_row_contribution(target: dict[str, Any], *feature_ids: str) -> float | None:
    """``contribution`` float for the first matching row among ``feature_ids``
    (full + short leaf forms), or ``None`` when no such row is present."""
    for fc in target.get("feature_contributions", []) or []:
        if str(fc.get("feature_id", "")) in feature_ids:
            c = fc.get("contribution")
            if isinstance(c, (int, float)):
                return float(c)
            return None
    return None


# Minimum |contribution| for a situation feature to count as actually having
# driven THIS candidate, used by situation_sentence's contributing_only gate
# (see module docstring / feature 022 fix). Below this, the row is present but
# effectively inert for this candidate (e.g. a NEUTRAL service like background
# music, where drowsiness/monotony contribute ~0).
_CONTRIBUTING_THRESHOLD = 0.005


def situation_sentence(
    target: dict[str, Any],
    trigger_purpose: str | None,
    contributing_only: bool = False,
) -> str | None:
    """Plain-language driver/road state from the target's situation-family
    rows (drowsiness/fatigue/monotony levels; traffic/night/road state).
    ``None`` when no situation row is present at all.

    When ``contributing_only`` is True (used by the SERVICE prompt — see
    ``service_explanation.build_prompt``), each situation piece is gated
    independently on whether ITS row actually contributed to this candidate
    (``abs(contribution) >= _CONTRIBUTING_THRESHOLD``). This stops a service
    that is NEUTRAL to drowsiness/monotony (e.g. background music, contribution
    ~0) from being handed a prominent "the driver is getting drowsy" fact that
    has nothing to do with why it was picked — which was pulling the model
    into arguing for a different (interactive) kind of service than the one
    actually chosen. When nothing passes the gate, returns ``None`` (the
    caller omits the whole SITUATION section) rather than the mild overclaim
    "the driver is in a neutral state".

    ``contributing_only=False`` (the default, used by the CONTENT prompt) is
    unchanged: every situation row present is narrated regardless of its
    contribution to this particular item.
    """
    d = _reason_row_value(target, "drowsiness_level", "drowsiness")
    f = _reason_row_value(target, "fatigue_level", "fatigue")
    m = _reason_row_value(target, "monotony_level", "monotony")
    night = _reason_row_value(target, "night_state", "night")
    traffic = _reason_row_value(target, "traffic_state", "traffic")
    road = _reason_row_value(target, "road_type", "road")
    if d is None and f is None and m is None and night is None and traffic is None and road is None:
        return None

    def _passes(*feature_ids: str) -> bool:
        if not contributing_only:
            return True
        c = _reason_row_contribution(target, *feature_ids)
        return c is not None and abs(c) >= _CONTRIBUTING_THRESHOLD

    parts = []
    if isinstance(d, (int, float)) and _passes("drowsiness_level", "drowsiness"):
        parts.append(
            "alert and awake" if d < 30 else ("very drowsy" if d >= 60 else "getting drowsy")
        )
    if isinstance(f, (int, float)) and f >= 55 and _passes("fatigue_level", "fatigue"):
        parts.append("physically tired")

    env = []
    if isinstance(m, (int, float)) and _passes("monotony_level", "monotony"):
        env.append(
            "the road is very monotonous and boring" if m >= 60 else
            ("the road is a little monotonous" if m >= 35 else "the road is engaging")
        )
    if isinstance(night, str) and night == "night" and _passes("night_state", "night"):
        env.append("it is night")
    if isinstance(traffic, str) and traffic and traffic != "normal" and _passes("traffic_state", "traffic"):
        env.append(f"traffic is {traffic}")
    if isinstance(road, str) and road and _passes("road_type", "road"):
        env.append(f"they are on a {road.replace('_', ' ')}")

    if contributing_only and not parts and not env:
        # Nothing about the driver/road situation actually contributed to this
        # candidate — omit the section entirely rather than emit the mild
        # overclaim "the driver is in a neutral state" (contributing_only mode
        # only; the default/content path never hits this branch below).
        return None

    lead = "The driver is " + (", ".join(parts) if parts else "in a neutral state")
    env_s = ("; " + ", ".join(env) + ".") if env else "."
    # The rest-recommendation clause is carried by trigger_sentence's "THE
    # TRIGGER & CAR STATE" section for service prompts — do not repeat it
    # here, or a rest_recommended service prompt shows it twice.
    return lead + env_s


_TRIGGER_SENTENCES = {
    "rest_recommended": "A rest stop is now being recommended",
    "inattentive_driving_prevention_recovery": "The assistant is trying to keep the driver alert",
    "route_music": "This is routine in-drive music selection",
    "child_passenger_experience": "A child is aboard",
}

# Genuinely-stopped LifecycleStage values ONLY (see
# aica_api.models.proposal.enums.LifecycleStage). A bare substring check like
# ``"rest" in ls`` wrongly catches ``before_rest_until_stop``, which means the
# car is STILL DRIVING toward the rest stop — an invented fact. Use an
# explicit set instead.
_STOPPED_STAGES = {"during_rest_stopped", "after_rest_before_restart"}


def trigger_sentence(
    trigger_purpose: str | None, target: dict[str, Any], lifecycle_stage: str | None
) -> str:
    """Service-step fact: what the trigger is asking for + the car's motion
    state (moving vs stopped)."""
    lead = _TRIGGER_SENTENCES.get(trigger_purpose) if trigger_purpose else None
    if lead is None:
        lead = f"The trigger purpose is {trigger_purpose}" if trigger_purpose else "A proposal is being made"

    motion = _reason_row_value(target, "motion_state", "motion")
    if isinstance(motion, str) and motion:
        stopped = motion.lower() in ("stopped", "parked", "parking")
    else:
        stopped = (lifecycle_stage or "") in _STOPPED_STAGES
    car = "the car is stopped" if stopped else "the car is moving (active driving)"
    return f"{lead}; {car}."


def preference_sentence(context: dict[str, Any]) -> str | None:
    """Content-step fact: the driver's registered favorite artist (oshi) and,
    when available, top genres / age band. Purely best-effort from ``context``
    — absent fields are silently skipped (never invented)."""
    oshi_artist = context.get("oshi_artist")
    dp = context.get("driver_profile") or {}
    parts: list[str] = []
    if oshi_artist:
        parts.append(f"Their favorite artist (oshi) is {oshi_artist}")
    elif dp.get("oshi_registered") is False:
        parts.append("They have no registered favorite artist")
    genres = [g for g, lv in (dp.get("usage_by_genre") or {}).items() if lv in ("high", "mid")]
    if genres:
        parts.append("they often listen to " + "/".join(genres))
    age_band = dp.get("age_band") or context.get("age_band")
    if age_band:
        parts.append(f"they are in their {age_band}")
    if not parts:
        return None
    return ". ".join(p[0].upper() + p[1:] for p in parts) + "."


def history_sentences(target: dict[str, Any]) -> list[str]:
    """Driver-history facts (recovery/usage/acceptance/played/skipped) for
    either a content item or a service candidate, translated from the
    history-family rows' evidence — never a raw number."""
    out: list[str] = []
    for fc in target.get("feature_contributions", []) or []:
        fid = str(fc.get("feature_id", ""))
        if feature_family(fid) != "history":
            continue
        e = fc.get("e_i")
        if not isinstance(e, (int, float)):
            fv = fc.get("feature_value")
            if isinstance(fv, (int, float)):
                e = float(fv) / 100.0 if fv > 1 else float(fv)
        lvl = _lvl3(e, 0.34, 0.66) if isinstance(e, (int, float)) else None

        if fid == "content_recovery_rate" and lvl == "high":
            out.append("this song has reliably restored the driver's state before")
        elif fid == "service_recovery_rate" and lvl == "high":
            out.append("this service has reliably restored the driver's state before")
        elif fid == "catalog_item_usage_level" and lvl in ("high", "mid"):
            out.append(f"the driver plays this song {'often' if lvl == 'high' else 'sometimes'}")
        elif fid in ("service_usage_level", "scene_service_usage_level") and lvl in ("high", "mid"):
            out.append(f"the driver uses this service {'often' if lvl == 'high' else 'sometimes'}")
        elif fid == "content_proposal_acceptance_rate" and lvl == "high":
            out.append("the driver usually accepts song suggestions")
        elif fid == "service_proposal_acceptance_rate" and lvl == "high":
            out.append("the driver usually accepts this service when offered")
        elif fid == "played_items" and isinstance(e, (int, float)) and e >= 0.99:
            out.append("the driver played this song recently")
        elif fid == "skipped_items" and isinstance(e, (int, float)) and e >= 0.99:
            out.append("the driver recently skipped this song")
        elif fid in ("content_tag_usage_level", "scene_content_tag_usage_level") and lvl in ("high", "mid"):
            out.append(f"the driver {'often' if lvl == 'high' else 'sometimes'} plays this song's genre")
        elif fid == "service_recency_state" and isinstance(fc.get("feature_value"), str):
            fv = fc["feature_value"]
            if fv and fv != "normal":
                out.append(f"it has been {fv} since the driver last used this service")

    seen: set[str] = set()
    uniq: list[str] = []
    for s in out:
        if s not in seen:
            seen.add(s)
            uniq.append(s)
    return uniq


def _score_strength(c: float) -> str:
    a = abs(c)
    if c > 0:
        tier = (
            "a major reason" if a >= 0.08 else
            ("a significant reason" if a >= 0.04 else
             ("a minor reason" if a >= 0.015 else "a slight factor"))
        )
        return tier
    # Negative contributions are magnitude-aware too (mirroring the positive
    # tiers), so a strong opposing factor doesn't collapse into the same
    # trivial phrase as a barely-there one.
    tier_word = "strongly" if a >= 0.08 else ("moderately" if a >= 0.04 else "slightly")
    return f"pushed {tier_word} against it"


def score_evidence(factors: list[dict[str, Any]], oshi_artist: str | None = None) -> list[str]:
    """Top |contribution| factors (already extracted by ``_factors_from_target``)
    as strength words — never the raw fraction."""
    lines: list[str] = []
    for f in factors[:6]:
        c = f["contribution"]
        if abs(c) < 0.008:
            continue
        if f["feature_id"] == "oshi_id" and c > 0:
            what = f"it is by the driver's favorite artist{f' ({oshi_artist})' if oshi_artist else ''}"
        else:
            what = f["label_en"]
        lines.append(f"- {what}: {_score_strength(c)}")
    return lines


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

    Dispatches to the per-step builder.
    """
    from aica_api.services import service_explanation, content_explanation

    if step == "service":
        return service_explanation.build_prompt(target, context)
    return content_explanation.build_prompt(target, context)


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
    # case-insensitive to match the JS mirrors (nano-test.html / useExplanation.ts)
    out = re.sub(r"^\s*(?:and|、|,)\s+", "", out.strip(), flags=re.IGNORECASE)   # dangling leading conjunction
    out = re.sub(r"\s*(?:and|、|,)\s*$", "", out.strip(), flags=re.IGNORECASE)   # dangling trailing conjunction
    return out.strip()


def parse_bilingual(text: str) -> list[str]:
    """Parse model output into a positional ``[ja, en]`` pair, defensively.

    Order of attempts: ``JA:``/``EN:`` prefixed lines (case-insensitive) →
    first two non-empty lines → the whole text used for both. Code fences and
    surrounding whitespace are stripped. Empty input yields ``["", ""]``.
    """
    cleaned = (text or "").strip().strip("`").strip()
    # Primary: match "JA: <ja> ... EN: <en>" whether the two are on separate
    # lines OR inline on one line (Gemini Nano sometimes emits both on a single
    # line, which the line-by-line pass below would fail to split).
    m = re.search(r"ja:\s*(.+?)\s*en:\s*(.+)", cleaned, re.IGNORECASE | re.DOTALL)
    if m:
        ja = m.group(1).strip().strip("`").strip()
        en = m.group(2).strip().strip("`").strip()
        if ja or en:
            return [ja or en, en or ja]
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

    Dispatches to the per-step deterministic template.
    """
    from aica_api.services import service_explanation, content_explanation

    if step == "service":
        return service_explanation.template(target)
    return content_explanation.template(target)


# ---------------------------------------------------------------------------
# Shared category readout (§14 fit subtotals -> signed trio + dominant + phrase)
# ---------------------------------------------------------------------------

_CATEGORY_PHRASES = {
    "situation": {"ja": "運転状況", "en": "the driving situation"},
    "preference": {"ja": "運転者の好み", "en": "the driver's taste"},
    "history": {"ja": "運転者の利用履歴", "en": "the driver's history"},
}


def category_readout(target: dict[str, Any]) -> dict[str, Any] | None:
    """Bilingual 'what dominated' readout from the §14 fit subtotals.

    Returns None when the target carries no numeric situation/preference/history
    subtotal (LLM-shaped plans, mock selector), so callers can skip the line.
    """
    subs = {
        cat: target.get(f"{cat}_fit")
        for cat in ("situation", "preference", "history")
    }
    nums = {c: float(v) for c, v in subs.items() if isinstance(v, (int, float))}
    if not nums:
        return None
    dominant = max(nums, key=lambda c: abs(nums[c]))
    ph = _CATEGORY_PHRASES[dominant]
    return {
        "situation": nums.get("situation", 0.0),
        "preference": nums.get("preference", 0.0),
        "history": nums.get("history", 0.0),
        "dominant": dominant,
        "phrase_ja": f"この選択は主に{ph['ja']}によって決まりました。",
        "phrase_en": f"This choice was driven mostly by {ph['en']}.",
    }
