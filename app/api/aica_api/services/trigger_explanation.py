"""trigger_explanation — trigger-fire rank-1 rationale (feature 025, slice S6).

Builds the grounded prompt and the deterministic template for a TRIGGER fire,
mirroring the two-function shape ``service_explanation.py`` /
``content_explanation.py`` already establish for the service/content steps —
``template(target) -> [ja, en]`` and ``build_prompt(target, context) ->
ExplanationPrompt`` — and reusing the same shared kernel
(``explanation_builder`` — labels, format anchoring, parsing) they do. Pure
(no I/O), so it is exhaustively unit-testable, exactly like its two siblings.

TRIGGER evidence is structurally different from service/content, though:
there is no ``ProposalRunLog`` evidence stream to read a "target" candidate
out of (see ``routers/proposal.py::_find_explain_target``, which only ever
resolves a ``service``/``content`` target). It lives instead on
``MergedFirePoint``/``FirePoint`` (``models/merged_run.py`` /
``models/run.py``) — one ``category`` (``"rest_required"`` or
``"monotony_prevention"``) fired, and the fire carries a
``feature_contributions`` dict of BOTH categories' recorded
``TriggerCategoryChain`` (score/clamped/rows/gates) plus the ``criteria``
dict (thresholds in force at that tick).

So the caller (``routers/merged_runs.py``'s ``explain_trigger_endpoint``)
first resolves WHICH chain is the review target (``resolve_category``) and
flattens the fire into the ``target`` shape ``template()``/``build_prompt()``
below actually consume (``build_target``) — the recorded chain's own
score/clamped/rows/gates, plus the criteria dict and the category id, and
NOTHING from the sibling category's chain. That last point is load-bearing:
NRI publishes ONE score banded by TWO thresholds, so its two categories
always carry the IDENTICAL score (see ``packages/nri_fatigue_score_v1
/algorithm.py``'s ``_build_feature_contributions``) — a sentence that
compared "this category's score" against "the other category's score" would
therefore be vacuous for NRI (they are always equal) and, worse, a
`fabricated` "beat the other option" claim neither package's fire-control
actually makes (the two categories are mutually exclusive bands on ONE
score, not competitors). By construction, this module never even SEES the
sibling chain, so that claim cannot be made by accident.
"""
from __future__ import annotations

from typing import Any

from aica_api.models.proposal.explanation import ExplainMessage, ExplanationPrompt
from aica_api.services import explanation_builder as _k  # shared kernel

# Bilingual short-noun label for a trigger category — deliberately NOT the
# long descriptive `CATEGORY_LABELS` sentences in
# `app/frontend/src/lib/review/reviewVocabulary.ts` ("危険運転防止のため休憩推奨"
# etc — a full purpose statement, not a name), which read awkwardly inline
# before "threshold" ("休憩しきい値" reads naturally; the full sentence does
# not). "発火" (fired) — the app's own word for the decision event, per
# reviewVocabulary.ts / InstantResultStrip.tsx — is used directly in the
# sentence built by `template()` below instead of being folded into this table.
CATEGORY_LABELS: dict[str, dict[str, str]] = {
    "rest_required": {"ja": "休憩", "en": "rest"},
    "monotony_prevention": {"ja": "単調運転防止", "en": "monotony prevention"},
}

# The threshold key(s) to cite for a category, IN PRIORITY ORDER. This can't
# be a single fixed key per category — the two trigger packages disagree on
# both the NAME and the SCALE of "the threshold this category's score is
# banded against":
#
#   - NRI (packages/nri_fatigue_score_v1/algorithm.py) publishes ONE raw
#     `s_total` score (same scale as the chain's `score` field here, easily
#     >1.5 — up to ~150) banded by TWO RAW-scale thresholds:
#     `threshold_fire` (rest_required) / `threshold_monotony`
#     (monotony_prevention). Its `criteria` dict ALSO carries a
#     `monotony_suggest_threshold` key, but that one is NORMALIZED to the
#     top-level 0-1 `score` field — a DIFFERENT scale than the chain's raw
#     `score` used here — so `threshold_monotony` (the raw-scale key) must
#     be tried first, or a monotony fire would compare a ~100-scale score
#     against a ~0.6-scale "threshold" and report an absurd clearance.
#
#   - The hybrid (packages/aica_transparent_hybrid_trigger_v1/algorithm.py)
#     publishes TWO independent CLAMPED 0-1 scores, each with its own 0-1
#     threshold: `threshold_suggest` (rest_required) /
#     `monotony_suggest_threshold` (monotony_prevention).
#
# Trying NRI's key first for each category and falling back to the hybrid's
# lets ONE lookup work for either package's `criteria` dict without this
# module ever needing to know which package produced the fire.
_CATEGORY_THRESHOLD_KEYS: dict[str, tuple[str, ...]] = {
    "rest_required": ("threshold_fire", "threshold_suggest"),
    "monotony_prevention": ("threshold_monotony", "monotony_suggest_threshold"),
}

# A row's |contribution| below this reads as "contributed nothing" — same
# epsilon `explanation_builder` uses to drop negligible service/content
# factors (`_MIN_ABS_CONTRIBUTION`), reused here for the SAME reason: it is
# below float noise, not a judgement call about what counts as "small".
_ZERO_CONTRIBUTION = _k._MIN_ABS_CONTRIBUTION


def resolve_category(fire: dict[str, Any], category: str | None) -> str | None:
    """Which of a fire's ``feature_contributions`` chains is the review target.

    Priority: the explicit ``category`` argument (a reviewer's own choice)
    wins; else the fire's OWN recorded ``category`` (what actually fired);
    else — both absent, which should not happen for a genuinely actionable
    fire, but this stays honest rather than guessing wrong — the
    highest-scoring recorded chain. ``None`` only when the fire carries no
    chains at all (nothing to resolve).
    """
    if category:
        return category
    fire_category = fire.get("category")
    if fire_category:
        return fire_category
    chains = fire.get("feature_contributions") or {}
    if not chains:
        return None

    def _chain_score(cat: str) -> float:
        # `or float(...)` would treat a genuine 0.0 score as falsy and wrongly
        # fall back to -inf — check for `None` explicitly instead.
        score = (chains.get(cat) or {}).get("score")
        return float(score) if isinstance(score, (int, float)) else float("-inf")

    return max(chains, key=_chain_score)


def build_target(fire: dict[str, Any], category: str | None) -> dict[str, Any]:
    """Flatten a fire + resolved category into the ``target`` shape
    ``template()``/``build_prompt()`` below consume: the recorded chain's
    own score/clamped/rows/gates, the criteria dict, the category id, and a
    few fire-level facts (tick/time_min/strength) carried along for the
    prompt's grounding bundle.

    Degrades to an EMPTY chain (never raises) when ``category`` is ``None``
    or missing from ``fire["feature_contributions"]`` — a caller that needs a
    hard 422 for an UNKNOWN category checks that itself before calling this
    (see ``routers/merged_runs.py::explain_trigger_endpoint``); this function
    only ever produces an honestly-empty target, never an error.
    """
    chains = fire.get("feature_contributions") or {}
    chain = (chains.get(category) if category else None) or {}
    return {
        "category": category,
        "score": chain.get("score"),
        "clamped": chain.get("clamped"),
        "rows": chain.get("rows") or [],
        "gates": chain.get("gates") or [],
        "criteria": fire.get("criteria") or {},
        "tick": fire.get("tick"),
        "time_min": fire.get("time_min"),
        "strength": fire.get("strength"),
    }


def _num(v: Any) -> float:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else 0.0


def _threshold_for(category: str | None, criteria: dict[str, Any]) -> float | None:
    """The threshold this category's score is banded against, or ``None``
    when the criteria dict carries none of the candidate keys (degraded
    evidence — never raises)."""
    for key in _CATEGORY_THRESHOLD_KEYS.get(category or "", ()):
        v = criteria.get(key)
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return float(v)
    return None


def _ranked_rows(rows: list[Any]) -> list[dict[str, Any]]:
    """Rows sorted by |contribution| descending; drops anything malformed
    (not a dict) rather than raising."""
    safe = [r for r in (rows or []) if isinstance(r, dict)]
    return sorted(safe, key=lambda r: abs(_num(r.get("contribution"))), reverse=True)


def _fmt_num(v: float) -> str:
    """Plain numeric text, adaptive to the two packages' very different
    scales: NRI's raw `s_total`/row values read as whole numbers (up to the
    ~150 range); the hybrid's clamped 0-1 scores/features read as a
    fraction. `abs(v) > 1.5` cleanly separates the two without this module
    ever needing to know which package produced the number — neither
    package's 0-1 clamped quantities exceed 1.0."""
    return f"{v:.0f}" if abs(v) > 1.5 else f"{v:.2f}"


def _score_display(v: float) -> tuple[str, str]:
    """Bilingual display for a score/threshold: NRI's raw scale reads as
    "points"; the hybrid's 0-1 scale reads as a plain fraction (calling a
    0-1 clamped score "points" would misrepresent its unit)."""
    n = _fmt_num(v)
    if abs(v) > 1.5:
        return f"{n}点", f"{n} pts"
    return n, n


def _signed_score_display(v: float) -> tuple[str, str]:
    """`_score_display` with an explicit +/- sign, for the clearance clause."""
    ja, en = _score_display(abs(v))
    sign = "+" if v >= 0 else "-"
    return f"{sign}{ja}", f"{sign}{en}"


# ---------------------------------------------------------------------------
# Row-value units (feature 025, slice S10 — Defect 1)
# ---------------------------------------------------------------------------
#
# The rendered sentence used to append a "分"/" min" suffix to EVERY row's
# numeric value whenever it read as "large" (the old ``abs(value) > 1.5``
# rule) — a MAGNITUDE heuristic standing in for a UNITS one. That put false
# statements in front of the reviewer: drowsiness/fatigue are 0-100 LEVELS
# under NRI, so "86" became "86分" (86 *minutes* of drowsiness — nonsense),
# and child_passenger is a BOOLEAN encoded as 0.0/1.0, which that same
# heuristic never flagged as needing a unit at all, yet never rendered as
# "aboard"/"not aboard" either — it printed the bare "1.00".
#
# The fix: each row's `feature_id` looks up its OWN unit in `_UNIT_KIND`
# below. A `feature_id` NOT in the table renders as a bare number, NEVER
# with a guessed unit — the same "never guess a label" discipline
# `explanation_builder.label_for` already applies to feature NAMES, extended
# here to feature VALUES. A bare number is honest; a wrong unit is not.
#
#   "minutes"    — an accumulated-time-scale quantity. NRI's own additive
#                   rows read straight off its minute accumulators (see
#                   packages/nri_fatigue_score_v1/algorithm.py's
#                   `_build_feature_contributions`): `continuous_driving_min`
#                   (= driving_min_since_rest), `traffic_jam`
#                   (= cumulative_jam_min), `long_highway`
#                   (= cumulative_highway_min). None of these feature_ids is
#                   ever produced by the hybrid package, so there is no
#                   cross-package ambiguity for any of the three.
#   "level"      — a 0-100 (NRI) or 0-1 normalized (hybrid) SCORE, not a
#                   duration: `drowsiness`/`fatigue` are levels in BOTH
#                   packages (NRI's `drowsiness_level`/`fatigue_level`;
#                   hybrid's clamped-0-1 `drowsiness`/`fatigue` features in
#                   packages/aica_transparent_hybrid_trigger_v1/algorithm.py's
#                   `extract_features`) — "no unit suffix" is the right
#                   answer for BOTH packages' scale, so one table entry
#                   safely serves either without this module ever needing to
#                   know which package produced the row.
#   "boolean"    — a flag encoded as a 0.0/1.0 float, not a quantity — both
#                   packages do this identically for `child_passenger` (see
#                   NRI's `_row("child_passenger", 1.0 if child_passenger
#                   else 0.0, ...)` and hybrid's `category_scores`'s
#                   identical pattern), so this too needs only one entry.
#   "multiplier" — NRI's night/familiar-route AMPLIFICATION rows report the
#                   multiplier itself as `value` (1.0 when the corresponding
#                   flag is off, e.g. `m_night`/`m_familiar` when on — see
#                   `_build_feature_contributions`'s docstring) — neither a
#                   duration nor a bare count, so it gets its own ×N display.
#                   NRI-only feature_ids (hybrid has no equivalent row), so
#                   no cross-package ambiguity here either.
_UNIT_KIND: dict[str, str] = {
    "continuous_driving_min": "minutes",
    "traffic_jam": "minutes",
    "long_highway": "minutes",
    "drowsiness": "level",
    "fatigue": "level",
    "child_passenger": "boolean",
    "night_amplification": "multiplier",
    "familiar_route_amplification": "multiplier",
}

# `monotony` is the ONE feature_id BOTH packages emit with genuinely
# DIFFERENT units — deliberately left OUT of `_UNIT_KIND` above rather than
# forced into either bucket:
#
#   - NRI's `monotony` row (packages/nri_fatigue_score_v1/algorithm.py's
#     `_build_feature_contributions`) is the raw `cumulative_monotonous_min`
#     accumulator — genuinely minutes, unbounded above zero.
#   - hybrid's `monotony` row (packages/aica_transparent_hybrid_trigger_v1
#     /algorithm.py's `_monotony_score`) is CLAMPED to `_clamp(..., hi=1.0)`
#     — a normalized 0-1 feature, never minutes.
#
# The row alone doesn't say which package produced it, so guessing either
# unit unconditionally would sometimes be wrong — exactly Defect 1's
# complaint, just for a second feature_id. But `_clamp`'s hi=1.0 ceiling
# gives one fact we can lean on WITHOUT guessing: hybrid's feature can NEVER
# exceed 1.0, so any observed value strictly above the floor below can only
# be NRI's raw minutes. At or below it the two are genuinely
# indistinguishable from the row alone, so — per this module's own "never
# guess" rule — it renders bare rather than picking a side.
_MONOTONY_MINUTES_FLOOR = 1.0


def _unit_kind_for(feature_id: str, value: Any) -> str | None:
    """The unit `_row_value_display` should use for this row, or ``None``
    for "render bare" — see `_UNIT_KIND`'s module comment for the full
    rationale, including why `monotony` is resolved separately."""
    kind = _UNIT_KIND.get(feature_id)
    if kind is not None:
        return kind
    if (
        feature_id == "monotony"
        and isinstance(value, (int, float))
        and not isinstance(value, bool)
        and abs(float(value)) > _MONOTONY_MINUTES_FLOOR
    ):
        return "minutes"
    return None


def _fmt_multiplier(v: float) -> str:
    """``×1.2``-style display for an amplification row's `value` (the
    multiplier itself, not a quantity). Trims the trailing zero ``:.2f``
    would otherwise always add (``1.20`` -> ``1.2``) but keeps at least one
    decimal place (``1.00`` -> ``1.0``, not the bare integer ``1`` — a
    multiplier reads as "no amplification", not "one of something")."""
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    if "." not in s:
        s += ".0"
    return f"×{s}"


def _row_value_display(row: dict[str, Any]) -> tuple[str, str]:
    """Bilingual raw-value display for one row, in THAT ROW'S OWN unit (see
    `_UNIT_KIND` above — feature 025 slice S10, Defect 1).

    A RECORDED ``band`` word always wins (mirrors
    ``app/frontend/src/lib/review/reviewVocabulary.ts``'s ``bandWord`` — a
    recorded band is never overridden by a derived reading). Otherwise the
    unit is looked up by `feature_id`; a `feature_id` NOT in the table (or
    genuinely ambiguous, like `monotony` below its disambiguation floor)
    renders as a bare number — never with a guessed unit."""
    band = row.get("band")
    if isinstance(band, str) and band:
        return band, band

    feature_id = str(row.get("feature_id", ""))
    value = row.get("value")
    kind = _unit_kind_for(feature_id, value)

    if kind == "boolean":
        is_true = bool(value) if isinstance(value, bool) else (
            isinstance(value, (int, float)) and float(value) != 0.0
        )
        return ("あり" if is_true else "なし"), ("aboard" if is_true else "not aboard")

    if isinstance(value, bool):
        # A row not in the boolean table but whose recorded `value` IS a
        # genuine Python bool (no current package's rows do this —
        # defensive only) still reads as yes/no, never as the numeric
        # 1.00/0.00 a bare `float(value)` would print.
        return ("あり" if value else "なし"), ("yes" if value else "no")

    if not isinstance(value, (int, float)):
        return "—", "—"

    v = float(value)
    if kind == "minutes":
        return f"{v:.0f}分", f"{v:.0f} min"
    if kind == "multiplier":
        disp = _fmt_multiplier(v)
        return disp, disp
    # kind in {"level", None}: a 0-100/0-1 score or an unrecognized
    # feature_id — EITHER WAY, no unit suffix. This is Defect 1's core fix:
    # a bare number is honest, a guessed unit is not.
    n = _fmt_num(v)
    return n, n


def _row_phrase(row: dict[str, Any]) -> tuple[str, str]:
    """Bilingual "<label>（<value>）" phrase for one row, value/band leading
    per the review's convention (a reviewer reads the recognizable value
    before the raw number)."""
    lab = _k.label_for(str(row.get("feature_id", "")))
    disp_ja, disp_en = _row_value_display(row)
    return f"{lab['ja']}（{disp_ja}）", f"{lab['en']} ({disp_en})"


# Feature ids whose NRI row formula subtracts a θ dead-band before weighting
# (`max(0, value - theta) * weight` — packages/nri_fatigue_score_v1
# /algorithm.py's `_compute_realtime_score`). Hybrid's rows of the SAME
# feature_ids use a plain linear `weight * value` term instead (see
# `category_scores`'s `_row` helper in
# packages/aica_transparent_hybrid_trigger_v1/algorithm.py) — no dead-band
# concept at all.
_DEAD_BAND_FEATURE_IDS = ("drowsiness", "fatigue")


def _dead_band_reason_applies(row: dict[str, Any]) -> bool:
    """True when a drowsiness/fatigue row's OWN recorded value/weight/
    contribution triple can ONLY be explained by a θ dead-band, never by a
    plain linear ``weight * value`` term.

    A linear term with a strictly positive weight and a strictly positive
    value can never land at EXACTLY zero — only NRI's ``max(0, value -
    theta) * weight`` subtraction can produce that combination (value > 0,
    weight > 0, contribution ~= 0). That lets the sentence name the
    dead-band cause without ever knowing theta's actual number (never
    recorded on the row or the criteria dict at all) and without this
    module needing to know which package produced the row — the row's own
    numbers prove it either way. Only ``drowsiness``/``fatigue`` carry this
    mechanism at all (see `_DEAD_BAND_FEATURE_IDS`), so every other
    feature_id short-circuits to ``False`` immediately.
    """
    if str(row.get("feature_id", "")) not in _DEAD_BAND_FEATURE_IDS:
        return False
    value = _num(row.get("value"))
    weight = _num(row.get("weight"))
    contribution = _num(row.get("contribution"))
    return value > 0.0 and weight > 0.0 and abs(contribution) < _ZERO_CONTRIBUTION


def template(target: dict[str, Any]) -> list[str]:
    """Deterministic ``[ja, en]`` rationale for a trigger fire, built ONLY
    from RECORDED evidence (``target``'s chain score/rows + criteria — see
    ``build_target``) — never re-derives or re-scores anything. Must:

      - name which category fired, in the app's own vocabulary (発火);
      - name the score and the threshold it crossed, plus the clearance
        (score - threshold);
      - name the two strongest contributing rows (value/band leading); and
      - name the strongest row that contributed ~nothing, when one exists —
        an absent-but-present input is often the most reviewable fact.

    Degrades gracefully (never raises) on missing/null fields: an empty rows
    list, a missing criteria dict, or ``target["category"] is None`` (should
    not happen for a genuinely-fired evidence record, but a review screen
    must never crash over it) each fall through to an honest, shorter
    sentence instead.
    """
    category = target.get("category")
    cat = CATEGORY_LABELS.get(category or "")
    if cat is None:
        return [
            "この記録には発火した分類がありません。",
            "No fired category is recorded for this evidence.",
        ]

    score = target.get("score")
    criteria = target.get("criteria") or {}
    threshold = _threshold_for(category, criteria)
    has_score = isinstance(score, (int, float)) and not isinstance(score, bool)
    has_threshold = isinstance(threshold, (int, float))

    if has_threshold:
        threshold_ja, threshold_en = _score_display(threshold)
        ja = f"{cat['ja']}しきい値（{threshold_ja}）を超えて発火"
        en = f"Fired above the {cat['en']} threshold ({threshold_en})"
        if has_score:
            score_ja, score_en = _score_display(score)
            ja += f"（スコア{score_ja}"
            en += f" (score {score_en}"
            clearance = score - threshold
            clearance_ja, clearance_en = _signed_score_display(clearance)
            ja += f"・余裕{clearance_ja}）"
            en += f", clearance {clearance_en})"
        ja += "。"
        en += "."
    else:
        # No recorded threshold — still name what fired, just without the
        # numeric clearance clause the review can't back with evidence.
        ja = f"{cat['ja']}が発火。"
        en = f"{cat['en'].capitalize()} fired."

    rows = _ranked_rows(target.get("rows"))
    contributing = [r for r in rows if abs(_num(r.get("contribution"))) >= _ZERO_CONTRIBUTION]
    top2 = contributing[:2]
    if top2:
        phrases = [_row_phrase(r) for r in top2]
        ja += "主因は" + "と".join(p[0] for p in phrases) + "。"
        en += " Chiefly " + " and ".join(p[1] for p in phrases) + "."

    # The strongest row that carries a real recorded value but contributed
    # ~nothing — its ABSENCE is often the most reviewable fact (e.g. a signal
    # that sat below its own dead-band, or a flag that was simply off).
    zero_rows = [
        r for r in rows
        if abs(_num(r.get("contribution"))) < _ZERO_CONTRIBUTION and r.get("value") is not None
    ]
    zero_rows.sort(key=lambda r: abs(_num(r.get("value"))), reverse=True)
    if zero_rows:
        top_zero = zero_rows[0]
        lab = _k.label_for(str(top_zero.get("feature_id", "")))
        if _dead_band_reason_applies(top_zero):
            # The single most reviewable fact NRI produces: a "moderately
            # drowsy"/"moderately fatigued" driver reads as IDENTICAL to an
            # alert one until the value clears its own θ dead-band — say so
            # explicitly (only when the row's own numbers actually prove
            # it — see `_dead_band_reason_applies`) rather than the generic
            # "contributed nothing", which is accurate but hides WHY.
            ja += f"{lab['ja']}は不感帯（しきい値以下）のため寄与なし。"
            en += f" {lab['en'].capitalize()} stayed at or below its own dead-band, so it contributed nothing."
        else:
            ja += f"{lab['ja']}は寄与なし。"
            en += f" {lab['en'].capitalize()} contributed nothing."

    return [ja, en]


_TRIGGER_REASON_SYSTEM = (
    "You explain WHY an in-car assistant's trigger algorithm fired a proposal "
    "for the driver — in BOTH Japanese and English. You are given the raw "
    "scoring facts; work out the causal story yourself. Do not just restate "
    "numbers.\n\n"
    "WHAT THE ALGORITHM DOES\n"
    "The trigger continuously scores the driving situation (drowsiness, "
    "fatigue, monotony, driving time, traffic, night, and similar signals) "
    "into ONE category score. It FIRES the moment that score crosses the "
    "threshold set for that category — a REST proposal (the driver should "
    "stop and recover) or a MONOTONY-PREVENTION proposal (something to keep "
    "an under-stimulated driver engaged). A fire belongs to exactly one "
    "category; never argue a different category should have fired instead — "
    "only explain the one given.\n\n"
    "HOW A FACTOR SCORES\n"
    "Each contributing signal adds (its weight × how much of that signal is "
    "present) to the total score. A signal can be PRESENT yet contribute "
    "EXACTLY ZERO — e.g. it has not yet crossed its own sensitivity floor, or "
    "the condition it represents (a passenger, a special route) simply is not "
    "true right now. That is a real, reviewable fact, not an omission.\n\n"
    "YOUR TASK\n"
    "Reason the causal story: (1) how far the score cleared the threshold "
    "(the clearance); (2) which one or two signals actually drove it there; "
    "(3) any notable signal that, despite being present, contributed "
    "nothing.\n\n" + _k._REASON_CLOSING
)


def build_prompt(target: dict[str, Any], context: dict[str, Any]) -> ExplanationPrompt:
    """Trigger branch — fact-rich reasoning-mode prompt (mirrors
    ``service_explanation.build_prompt``/``content_explanation.build_prompt``'s
    shape and grounding discipline: natural-language FACTS only in the user
    message, never a raw fraction or a pre-baked verdict).

    ``context`` is accepted for interface parity with the other two branches
    (``explanation_builder.build_explanation_prompt`` dispatches all three
    identically) but unused — everything this prompt needs already lives in
    ``target`` (see ``build_target``); a trigger fire carries no run-level
    ``trigger_purpose``/``lifecycle_stage`` of its own the way a service/
    content candidate does.
    """
    category = target.get("category")
    cat_label = CATEGORY_LABELS.get(category or "", {"ja": category or "不明", "en": category or "unknown"})
    score = target.get("score")
    criteria = target.get("criteria") or {}
    threshold = _threshold_for(category, criteria)
    rows = _ranked_rows(target.get("rows"))
    clearance = (
        score - threshold
        if isinstance(score, (int, float)) and isinstance(threshold, (int, float))
        else None
    )

    contributing = [r for r in rows if abs(_num(r.get("contribution"))) >= _ZERO_CONTRIBUTION]
    zero_rows = [
        r for r in rows
        if abs(_num(r.get("contribution"))) < _ZERO_CONTRIBUTION and r.get("value") is not None
    ]
    zero_rows.sort(key=lambda r: abs(_num(r.get("value"))), reverse=True)

    def _fact_line(row: dict[str, Any]) -> str:
        lab = _k.label_for(str(row.get("feature_id", "")))
        band = row.get("band")
        disp = band if isinstance(band, str) and band else _k._value_display(row.get("value"))
        return f"- {lab['en']}: {disp}" if disp else f"- {lab['en']}"

    top_facts = [_fact_line(r) for r in contributing[:6]]
    absent_fact = _fact_line(zero_rows[0]) if zero_rows else None

    grounding: dict[str, Any] = {
        "step": "trigger",
        "category": category,
        "score": score,
        "threshold": threshold,
        "clearance": clearance,
        "rows": rows,
        "criteria": criteria,
    }

    L: list[str] = []
    L.append(f'The assistant\'s trigger algorithm just fired a "{cat_label["en"]}" proposal for the driver.')
    L.append("")
    if threshold is not None and isinstance(score, (int, float)):
        span = abs(threshold) if abs(threshold) > 1e-9 else 1.0
        margin = "just barely" if clearance is not None and abs(clearance) / span < 0.05 else "clearly"
        L.append(f"THE FIRING: the score {margin} cleared the {cat_label['en']} threshold for this category.")
    else:
        L.append(f"THE FIRING: a {cat_label['en']} proposal fired; the recorded threshold is unavailable.")

    if top_facts:
        L.append("")
        L.append("WHAT DROVE IT (strongest signals first):")
        L.extend(top_facts)

    if absent_fact:
        L.append("")
        L.append("NOTABLY ABSENT (present, but contributed nothing):")
        L.append(absent_fact)

    L.append("")
    L.append(_k._FORMAT_REMINDER)

    messages = [
        ExplainMessage(role="system", content=_TRIGGER_REASON_SYSTEM),
        ExplainMessage(role="user", content="\n".join(L)),
    ]
    return ExplanationPrompt(messages=messages, grounding=grounding)
