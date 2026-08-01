"""TDD tests for `services/trigger_explanation.py` (feature 025, slice S6 —
the TRIGGER rank-1 rationale).

Every fire fixture below is built from a REAL `evaluate()` call against the
package's OWN algorithm module (loaded directly, mirroring
`test_nri_fatigue_score.py` / `test_transparent_hybrid.py`'s own
context-builder pattern) — never a hand-faked chain shape, per the slice's
explicit requirement ("do not hand-fake a chain shape that no package
emits").
"""
from __future__ import annotations

import importlib.util
import json

import pytest

from aica_api.config import settings
from aica_api.services import trigger_explanation as te

_NRI_DIR = settings.packages_dir / "nri_fatigue_score_v1"
_HYBRID_DIR = settings.packages_dir / "aica_transparent_hybrid_trigger_v1"


def _load_module(name: str, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


def _hp(pkg_dir) -> dict:
    data = json.loads((pkg_dir / "package.json").read_text(encoding="utf-8"))
    return {hp["key"]: hp["default"] for hp in data["hyperparameters"]}


nri = _load_module("nri_alg_trigger_explain_test", _NRI_DIR / "algorithm.py")
hybrid = _load_module("hybrid_alg_trigger_explain_test", _HYBRID_DIR / "algorithm.py")
NRI_HP = _hp(_NRI_DIR)
HYBRID_HP = _hp(_HYBRID_DIR)

_EMPTY_PH = {
    "lastProposalTimeSec": None,
    "lastProposalCategory": None,
    "lastProposalResult": None,
    "proposalCountLast30Min": 0,
    "acceptanceRateRecent": 0.0,
}


# ---------------------------------------------------------------------------
# NRI fire fixtures — one score banded by two thresholds (see
# packages/nri_fatigue_score_v1/algorithm.py's module docstring). Mirrors
# test_nri_fatigue_score.py's own `_primed_state` / `_score_between_thresholds_state`
# recipes for a single-tick, no-persistence fire.
# ---------------------------------------------------------------------------


def _nri_signals(**overrides) -> dict:
    signals = {
        "fixed": {
            "isNight": False, "familiarRoute": False, "childPassenger": False,
            "weatherRiskLevel": 0.0,
        },
        "dynamic": {
            "segmentType": "normal_road", "motionState": "MOVING",
            "continuousDrivingMin": 0.0, "speedKph": 80.0, "routeFraction": 0.0,
            "nextRestSpotMin": 9999.0, "isTrafficJam": False, "recoveryPhase": None,
        },
        "simulated": {"drowsiness": 0.0, "fatigue": 0.0, "anomaly_rate": 0.0},
    }
    for key, value in overrides.items():
        for group in signals.values():
            if key in group:
                group[key] = value
    return signals


def _nri_ctx(signals, prev_state=None, sim_time=60.0) -> dict:
    return {
        "simulation_time_sec": sim_time,
        "signals": signals,
        "feature_groups": {"normalized": {}, "ordinal": {"signal_duration": "transient"}},
        "hyperparameters": NRI_HP,
        "parameters": {},
        "proposal_history": dict(_EMPTY_PH),
        "user_action_history": [],
        "package_runtime_state": prev_state or {},
        "recovery_active": False,
    }


def _nri_primed_state(driving_min_since_rest=None) -> dict:
    if driving_min_since_rest is None:
        driving_min_since_rest = NRI_HP["threshold_fire"] / NRI_HP["w_base"]
    return {
        "cumulative_jam_min": 0.0, "cumulative_highway_min": 0.0,
        "cumulative_monotonous_min": 0.0,
        "driving_min_since_rest": driving_min_since_rest,
        "last_sim_time": 0.0, "was_in_recovery": False,
    }


def _nri_between_thresholds_state() -> dict:
    target = (NRI_HP["threshold_monotony"] + NRI_HP["threshold_fire"]) / 2.0
    driving_min = target / NRI_HP["w_base"] - 1.0
    return _nri_primed_state(driving_min_since_rest=driving_min)


def _fire_from_result(result: dict, tick: int = 1, time_min: float = 1.0) -> dict:
    """Flatten an `evaluate()` result into the `FirePoint` shape the endpoint
    actually receives (category/strength/tick/time_min/feature_contributions/
    criteria) — mirrors `services/preview.py`'s own fire-building."""
    category = result["selected_category"]
    strength = next((c.get("strength") for c in result["candidates"] if c["category"] == category), None)
    return {
        "category": category,
        "strength": strength,
        "tick": tick,
        "time_min": time_min,
        "feature_contributions": result["feature_contributions"],
        "criteria": result["criteria"],
    }


@pytest.fixture(scope="module")
def nri_rest_fire() -> dict:
    r = nri.evaluate(_nri_ctx(_nri_signals(), prev_state=_nri_primed_state(), sim_time=60.0))
    assert r["selected_category"] == "rest_required"  # setup sanity
    return _fire_from_result(r)


@pytest.fixture(scope="module")
def nri_monotony_fire() -> dict:
    r = nri.evaluate(_nri_ctx(_nri_signals(), prev_state=_nri_between_thresholds_state(), sim_time=60.0))
    assert r["selected_category"] == "monotony_prevention"  # setup sanity
    return _fire_from_result(r)


# ---------------------------------------------------------------------------
# Hybrid fire fixture — persistence cleared via a steady-state prev, mirrors
# test_transparent_hybrid.py's `_steady_state` + `_HIGH_SIGNALS` recipe.
# ---------------------------------------------------------------------------


def _hybrid_signals(**overrides) -> dict:
    signals = {
        "fixed": {
            "isNight": False, "familiarRoute": False, "childPassenger": False,
            "weatherRiskLevel": 0.0,
        },
        "dynamic": {
            "segmentType": "normal_road", "motionState": "MOVING",
            "continuousDrivingMin": 0.0, "speedKph": 80.0, "routeFraction": 0.0,
            "nextRestSpotMin": 9999.0, "isTrafficJam": False, "recoveryPhase": None,
        },
        "simulated": {"drowsiness": 0.0, "fatigue": 0.0, "anomaly_rate": 0.0},
    }
    for key, value in overrides.items():
        for group in signals.values():
            if key in group:
                group[key] = value
    return signals


_HYBRID_HIGH_SIGNALS = _hybrid_signals(drowsiness=85.0, fatigue=85.0, anomaly_rate=6.0, nextRestSpotMin=10.0)


def _hybrid_ctx(signals, prev_state=None, sim_time=3600.0) -> dict:
    return {
        "simulation_time_sec": sim_time,
        "signals": signals,
        "feature_groups": {"normalized": {}, "ordinal": {}},
        "hyperparameters": HYBRID_HP,
        "parameters": {},
        "proposal_history": dict(_EMPTY_PH),
        "user_action_history": [],
        "package_runtime_state": prev_state or {},
        "recovery_active": False,
    }


def _hybrid_steady_state(signals, counter_rest: int) -> dict:
    accumulators = {"jam_min": 0.0, "hw_min": 0.0, "mono_min": 0.0}
    feats = hybrid.extract_features(signals, accumulators, HYBRID_HP)
    scores = hybrid.category_scores(feats, HYBRID_HP)
    return {
        "smoothed_features": dict(feats),
        "smoothed_scores": {
            "rest_required_score": scores["rest_required_score"],
            "monotony_prevention_score": scores["monotony_prevention_score"],
        },
        "persistence_counters": {"rest_required": counter_rest, "monotony_prevention": 0},
        "states": {"rest_state": "REST_NORMAL", "monotony_state": "MONOTONY_NORMAL"},
        "accumulators": accumulators,
    }


@pytest.fixture(scope="module")
def hybrid_rest_fire() -> dict:
    prev = _hybrid_steady_state(_HYBRID_HIGH_SIGNALS, counter_rest=int(HYBRID_HP["rest_persistence_ticks"]) - 1)
    r = hybrid.evaluate(_hybrid_ctx(_HYBRID_HIGH_SIGNALS, prev_state=prev))
    assert r["selected_category"] == "rest_required"  # setup sanity
    return _fire_from_result(r)


# ---------------------------------------------------------------------------
# NRI fire fixture where a Tier-3a signal (drowsiness), not driving time,
# is the TOP contributing row — feature 025 slice S10, Defect 1: the bug
# report's own example ("主因は眠気（86分）") was exactly this shape, a
# drowsiness-led fire whose LEVEL value got a false minutes suffix.
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def nri_drowsiness_led_fire() -> dict:
    """drowsiness=100 contributes (100-60)*1.5=60; a 90-minute
    driving_min_since_rest contributes 90*0.5=45 — drowsiness ranks ABOVE
    continuous_driving_min, and s_total=105 clears threshold_fire=100."""
    signals = _nri_signals(drowsiness=100.0, fatigue=0.0)
    prev_state = _nri_primed_state(driving_min_since_rest=90.0)
    r = nri.evaluate(_nri_ctx(signals, prev_state=prev_state, sim_time=60.0))
    assert r["selected_category"] == "rest_required"  # setup sanity
    return _fire_from_result(r)


# ---------------------------------------------------------------------------
# resolve_category
# ---------------------------------------------------------------------------


def test_resolve_category_defaults_to_the_fires_own_category(nri_rest_fire):
    assert te.resolve_category(nri_rest_fire, None) == "rest_required"


def test_resolve_category_explicit_choice_wins_over_the_fires_own(nri_rest_fire):
    assert te.resolve_category(nri_rest_fire, "monotony_prevention") == "monotony_prevention"


def test_resolve_category_falls_back_to_highest_scoring_chain_when_both_absent():
    fire = {
        "category": None,
        "feature_contributions": {
            "rest_required": {"score": 12.0, "clamped": False, "rows": [], "gates": []},
            "monotony_prevention": {"score": 40.0, "clamped": False, "rows": [], "gates": []},
        },
    }
    assert te.resolve_category(fire, None) == "monotony_prevention"


def test_resolve_category_none_when_fire_carries_no_chains():
    assert te.resolve_category({"category": None, "feature_contributions": {}}, None) is None


def test_resolve_category_a_genuine_zero_score_chain_still_wins_when_it_is_the_highest():
    """Defect 3 (feature 025 slice S10), regression 1/2: `_chain_score`'s
    guard comment explicitly warns that `or float("-inf")` would treat a
    genuine 0.0 score as falsy and wrongly fall back to -inf. That mutant
    was previously caught by NO test — every existing fixture's "highest"
    chain happened to carry a nonzero score. Here rest_required's 0.0 is
    the genuinely higher score (monotony_prevention's -5.0 is lower), so a
    reintroduced `or float("-inf")` would silently pick monotony_prevention
    instead (0.0 reads falsy -> -inf loses to -5.0's truthy self)."""
    fire = {
        "category": None,
        "feature_contributions": {
            "rest_required": {"score": 0.0, "clamped": False, "rows": [], "gates": []},
            "monotony_prevention": {"score": -5.0, "clamped": False, "rows": [], "gates": []},
        },
    }
    assert te.resolve_category(fire, None) == "rest_required"


def test_resolve_category_picks_rest_required_when_it_is_the_higher_scoring_chain():
    """Defect 3, regression 2/2: an adversarial verifier found that
    hardcoding `return "monotony_prevention"` in place of
    `max(chains, key=_chain_score)` passed every existing test — every
    fixture's correct answer happened to BE monotony_prevention. Flip which
    category legitimately scores higher so a hardcoded stand-in fails."""
    fire = {
        "category": None,
        "feature_contributions": {
            "rest_required": {"score": 90.0, "clamped": False, "rows": [], "gates": []},
            "monotony_prevention": {"score": 40.0, "clamped": False, "rows": [], "gates": []},
        },
    }
    assert te.resolve_category(fire, None) == "rest_required"


# ---------------------------------------------------------------------------
# build_target
# ---------------------------------------------------------------------------


def test_build_target_flattens_the_chain_and_criteria(nri_rest_fire):
    target = te.build_target(nri_rest_fire, "rest_required")
    chain = nri_rest_fire["feature_contributions"]["rest_required"]
    assert target["category"] == "rest_required"
    assert target["score"] == chain["score"]
    assert target["clamped"] == chain["clamped"]
    assert target["rows"] == chain["rows"]
    assert target["criteria"] == nri_rest_fire["criteria"]


def test_build_target_degrades_to_an_empty_chain_for_an_unresolved_category():
    target = te.build_target({"feature_contributions": {}}, None)
    assert target["category"] is None
    assert target["score"] is None
    assert target["rows"] == []
    assert target["criteria"] == {}


# ---------------------------------------------------------------------------
# template() — names category / threshold / clearance, two strongest rows,
# and the strongest zero-contribution row.
# ---------------------------------------------------------------------------


def test_template_nri_rest_names_category_threshold_and_clearance(nri_rest_fire):
    target = te.build_target(nri_rest_fire, "rest_required")
    ja, en = te.template(target)
    assert ja and en

    threshold = nri_rest_fire["criteria"]["threshold_fire"]
    score = nri_rest_fire["feature_contributions"]["rest_required"]["score"]
    clearance = score - threshold
    assert clearance > 0  # setup sanity — this fire genuinely cleared its threshold

    # Category, in the app's own vocabulary (発火 for the decision event).
    assert "休憩" in ja and "発火" in ja
    assert "rest" in en.lower() and "fired" in en.lower()
    # The threshold value and the clearance both appear (using the SAME
    # display formatting `template()` itself applies — this asserts the
    # numbers are COMPOSED into the sentence, not that they are rounded a
    # particular way).
    threshold_ja, threshold_en = te._score_display(threshold)
    clearance_ja, clearance_en = te._signed_score_display(clearance)
    assert threshold_ja in ja and threshold_en in en
    assert clearance_ja in ja and clearance_en in en


def test_template_nri_monotony_names_its_own_threshold_not_the_fire_one(nri_monotony_fire):
    target = te.build_target(nri_monotony_fire, "monotony_prevention")
    ja, en = te.template(target)

    threshold = nri_monotony_fire["criteria"]["threshold_monotony"]
    fire_threshold = nri_monotony_fire["criteria"]["threshold_fire"]
    threshold_en = te._score_display(threshold)[1]
    fire_threshold_en = te._score_display(fire_threshold)[1]

    assert threshold_en in en
    # The monotony fire must cite ITS OWN threshold — not the (higher, unmet)
    # rest threshold, which would misreport why this fire happened at all.
    if threshold_en != fire_threshold_en:
        assert fire_threshold_en not in en


# Wording that would indicate a (vacuous, for NRI) "this category beat the
# other one" claim — the property under test is the ABSENCE of any of these,
# not the absence of any particular feature-id substring: NRI's `rest_required`
# chain legitimately carries its OWN "monotony" row (the env accumulator,
# `cumulative_monotonous_min` — see `_build_feature_contributions`), so
# checking for the bare substring "monotony"/"単調" would misfire on that
# unrelated, perfectly valid fact.
_COMPARISON_MARKERS_EN = ("than", "instead of", " over ", "beat", "compared", "rather than", "outscored")
_COMPARISON_MARKERS_JA = ("より", "の代わりに", "に勝", "上回っ", "比べ")


def _assert_no_comparison_claim(ja: str, en: str) -> None:
    low_en = f" {en.lower()} "
    for marker in _COMPARISON_MARKERS_EN:
        assert marker not in low_en, f"unexpected comparison wording {marker!r} in: {en}"
    for marker in _COMPARISON_MARKERS_JA:
        assert marker not in ja, f"unexpected comparison wording {marker!r} in: {ja}"


def test_template_nri_identical_scores_does_not_claim_it_beat_the_other_category(
    nri_rest_fire, nri_monotony_fire
):
    """NRI publishes ONE score banded by TWO thresholds — both chains on a
    single fire always carry the IDENTICAL score (see
    packages/nri_fatigue_score_v1/algorithm.py's `_build_feature_contributions`
    docstring). A sentence built from only the target's OWN category/chain
    must therefore never claim (or imply) it beat/outscored the sibling
    category — that claim would be vacuous (the scores are always equal) and
    is not one either package's fire-control actually makes."""
    rest_chain = nri_rest_fire["feature_contributions"]["rest_required"]
    mono_chain = nri_rest_fire["feature_contributions"]["monotony_prevention"]
    assert rest_chain["score"] == mono_chain["score"]  # setup sanity — NRI's defining property

    rest_target = te.build_target(nri_rest_fire, "rest_required")
    ja, en = te.template(rest_target)
    _assert_no_comparison_claim(ja, en)

    mono_target = te.build_target(nri_monotony_fire, "monotony_prevention")
    ja2, en2 = te.template(mono_target)
    _assert_no_comparison_claim(ja2, en2)


def test_template_hybrid_fire_produces_a_real_sentence(hybrid_rest_fire):
    target = te.build_target(hybrid_rest_fire, "rest_required")
    ja, en = te.template(target)
    assert ja and en
    assert "休憩" in ja
    assert "rest" in en.lower()


# ---------------------------------------------------------------------------
# Defect 1 (feature 025, slice S10) — row values render in THEIR OWN unit,
# never a magnitude-guessed one. The live bug: 「主因は眠気（86分）と連続運転
# 時間（61分）」 — drowsiness is a 0-100 LEVEL, not minutes, so the sentence
# stated a false fact. See services/trigger_explanation.py's `_UNIT_KIND`
# module comment for the full per-feature_id rationale.
# ---------------------------------------------------------------------------


def test_template_never_prints_a_minutes_suffix_on_a_level_value(nri_drowsiness_led_fire):
    """The fixture's TOP-contributing row is drowsiness (a 0-100 level, see
    the fixture's own docstring) — its sentence must never attach "分"/
    "min" to that row's value, while the driving-time row (a genuine
    minutes quantity) right next to it still gets one. Both assertions
    check the ACTUAL rendered sentence, not just the helper in isolation —
    Defect 1 was a customer-facing sentence bug."""
    target = te.build_target(nri_drowsiness_led_fire, "rest_required")
    ja, en = te.template(target)

    rows = te._ranked_rows(target["rows"])
    drowsiness_row = next(r for r in rows if r["feature_id"] == "drowsiness")
    assert drowsiness_row["contribution"] > 0  # setup sanity — a REAL contributor, not a zero one
    drowsiness_ja, drowsiness_en = te._row_value_display(drowsiness_row)
    assert "分" not in drowsiness_ja and "min" not in drowsiness_en
    assert drowsiness_ja in ja and drowsiness_en in en

    driving_row = next(r for r in rows if r["feature_id"] == "continuous_driving_min")
    assert driving_row["contribution"] > 0  # setup sanity
    driving_ja, driving_en = te._row_value_display(driving_row)
    assert "分" in driving_ja and "min" in driving_en
    assert driving_ja in ja and driving_en in en


def test_template_hybrid_rows_never_get_a_minutes_suffix(hybrid_rest_fire):
    """EVERY hybrid row is a normalized 0-1 feature (see
    packages/aica_transparent_hybrid_trigger_v1/algorithm.py's
    `extract_features`/`category_scores`) — none of hybrid's feature_ids
    are minutes-scaled, so none should ever render with a "分"/"min"
    suffix, however large the old `abs(value) > 1.5` magnitude heuristic
    used to (wrongly) think it needed one (impossible here since every
    hybrid value is clamped to [0, 1], but the point is this is now driven
    by the feature_id, not the number's size)."""
    target = te.build_target(hybrid_rest_fire, "rest_required")
    assert target["rows"], "setup sanity — the fixture must carry real rows"
    for row in target["rows"]:
        ja, en = te._row_value_display(row)
        assert "分" not in ja, f"{row['feature_id']!r} got a minutes suffix: {ja!r}"
        assert "min" not in en, f"{row['feature_id']!r} got a minutes suffix: {en!r}"


def test_template_renders_an_unrecognized_feature_id_bare_not_guessed():
    """A feature_id NOT in `_UNIT_KIND` must render as a bare number in the
    ACTUAL sentence — never inheriting a minutes suffix just because its
    value happens to be large (250 > the old 1.5 magnitude cutoff)."""
    fire = {
        "category": "rest_required",
        "feature_contributions": {
            "rest_required": {
                "score": 300.0, "clamped": False,
                "rows": [
                    {
                        "feature_id": "totally_new_signal_no_one_has_seen",
                        "value": 250.0, "band": None, "weight": 1.0, "contribution": 250.0,
                    },
                    {"feature_id": "continuous_driving_min", "value": 50.0, "band": None, "weight": 0.5, "contribution": 25.0},
                ],
                "gates": [],
            },
        },
        "criteria": {"threshold_fire": 100.0},
    }
    target = te.build_target(fire, "rest_required")
    ja, en = te.template(target)
    assert "250" in ja and "250" in en
    assert "250分" not in ja and "250 min" not in en


def test_row_value_display_renders_child_passenger_as_aboard_not_a_number():
    """Defect 1's explicit requirement: child_passenger is a BOOLEAN, so it
    must render as aboard/not-aboard, never as the raw float "1.00"/"0.00"
    both packages' rows actually store."""
    present_ja, present_en = te._row_value_display({"feature_id": "child_passenger", "value": 1.0})
    absent_ja, absent_en = te._row_value_display({"feature_id": "child_passenger", "value": 0.0})
    assert present_en == "aboard" and absent_en == "not aboard"
    assert present_ja != "1.00" and absent_ja != "0.00"


def test_row_value_display_renders_an_amplification_row_with_times_notation():
    """night_amplification/familiar_route_amplification report the
    MULTIPLIER itself as `value` (see
    packages/nri_fatigue_score_v1/algorithm.py's `_build_feature_contributions`
    docstring) — not a duration, not a bare count."""
    ja, en = te._row_value_display({"feature_id": "night_amplification", "value": 1.2})
    assert ja == en == "×1.2"
    assert "分" not in ja and "min" not in en

    # A neutral (flag-off) multiplier still reads as ×1.0, not the bare "1".
    ja_off, en_off = te._row_value_display({"feature_id": "familiar_route_amplification", "value": 1.0})
    assert ja_off == en_off == "×1.0"


def test_row_value_display_defaults_to_a_bare_number_for_an_unknown_feature_id():
    ja, en = te._row_value_display({"feature_id": "totally_unrecognized_feature", "value": 250.0})
    assert ja == "250" and en == "250"


def test_row_value_display_disambiguates_the_shared_monotony_feature_id_by_magnitude():
    """`monotony` is the one feature_id BOTH packages emit with genuinely
    different units — see `_UNIT_KIND`'s module comment in
    trigger_explanation.py for the full rationale. hybrid's row is clamped
    to [0, 1] and can NEVER exceed 1.0, so a value above that floor can
    only be NRI's raw minutes accumulator; at/below it, render bare rather
    than guess."""
    nri_style_row = {"feature_id": "monotony", "value": 42.0}  # unambiguously NRI (raw minutes)
    ja, en = te._row_value_display(nri_style_row)
    assert "分" in ja and "min" in en

    hybrid_style_row = {"feature_id": "monotony", "value": 0.75}  # clamped 0-1, genuinely ambiguous
    ja2, en2 = te._row_value_display(hybrid_style_row)
    assert "分" not in ja2 and "min" not in en2


# ---------------------------------------------------------------------------
# Defect 1's dead-band enhancement — when a drowsiness/fatigue row's own
# value/weight/contribution prove the zero came from NRI's θ dead-band, the
# sentence names that cause explicitly instead of the generic "contributed
# nothing".
# ---------------------------------------------------------------------------


def test_template_names_the_dead_band_reason_when_a_zero_row_proves_it():
    fire = {
        "category": "rest_required",
        "feature_contributions": {
            "rest_required": {
                "score": 105.0, "clamped": False,
                "rows": [
                    {"feature_id": "continuous_driving_min", "value": 150.0, "band": None, "weight": 0.5, "contribution": 75.0},
                    {"feature_id": "drowsiness", "value": 45.0, "band": None, "weight": 1.5, "contribution": 0.0},
                    {"feature_id": "fatigue", "value": 0.0, "band": None, "weight": 1.5, "contribution": 0.0},
                ],
                "gates": [],
            },
        },
        "criteria": {"threshold_fire": 100.0},
    }
    target = te.build_target(fire, "rest_required")
    ja, en = te.template(target)
    assert "不感帯" in ja
    assert "dead-band" in en.lower()
    # drowsiness (value=45, a genuine positive-but-below-threshold reading)
    # outranks fatigue (value=0, which proves nothing about a dead-band) as
    # the strongest zero-contribution row, so it is the one named.
    assert "眠気" in ja and "drowsiness" in en.lower()


def test_template_does_not_claim_the_dead_band_reason_when_the_row_does_not_support_it():
    """A drowsiness row whose own value is 0 can be fully explained by a
    plain zero (weight * 0 == 0 needs no dead-band at all) — the sentence
    must not claim the dead-band cause unless the row's own numbers prove
    it (see `_dead_band_reason_applies`'s docstring)."""
    fire = {
        "category": "rest_required",
        "feature_contributions": {
            "rest_required": {
                "score": 100.0, "clamped": False,
                "rows": [
                    {"feature_id": "continuous_driving_min", "value": 200.0, "band": None, "weight": 0.5, "contribution": 100.0},
                    {"feature_id": "drowsiness", "value": 0.0, "band": None, "weight": 1.5, "contribution": 0.0},
                ],
                "gates": [],
            },
        },
        "criteria": {"threshold_fire": 100.0},
    }
    target = te.build_target(fire, "rest_required")
    ja, en = te.template(target)
    assert "不感帯" not in ja
    assert "drowsiness contributed nothing" in en.lower()


def test_template_two_strongest_rows_and_the_zero_contribution_row_are_named():
    # A synthetic-but-legally-shaped chain (this module never inspects WHICH
    # package produced a row — only feature_id/value/band/contribution — so a
    # hand-built chain in the recorded SHAPE is fair game here, unlike the
    # package-behavior tests above which must use a REAL evaluate() call).
    fire = {
        "category": "rest_required",
        "feature_contributions": {
            "rest_required": {
                "score": 112.0, "clamped": False,
                "rows": [
                    {"feature_id": "continuous_driving_min", "value": 142.0, "band": None, "weight": 0.5, "contribution": 71.0},
                    {"feature_id": "monotony", "value": 96.0, "band": None, "weight": 0.3, "contribution": 28.8},
                    {"feature_id": "drowsiness", "value": 15.0, "band": None, "weight": 1.5, "contribution": 0.0},
                    {"feature_id": "child_passenger", "value": 0.0, "band": None, "weight": 20.0, "contribution": 0.0},
                ],
                "gates": [],
            },
        },
        "criteria": {"threshold_fire": 100.0},
    }
    target = te.build_target(fire, "rest_required")
    ja, en = te.template(target)

    assert "連続運転時間" in ja and "driving time" in en.lower()
    assert "単調" in ja and "monotony" in en.lower()
    # The strongest ZERO-contribution row is drowsiness (value 15 > child_passenger's 0).
    assert "眠気" in ja and "drowsiness" in en.lower()
    assert "子供" not in ja  # child_passenger's value (0.0) loses to drowsiness's (15.0)


def test_template_never_raises_on_an_empty_rows_list():
    fire = {
        "category": "rest_required",
        "feature_contributions": {
            "rest_required": {"score": 100.0, "clamped": False, "rows": [], "gates": []},
        },
        "criteria": {"threshold_fire": 90.0},
    }
    target = te.build_target(fire, "rest_required")
    ja, en = te.template(target)
    assert ja and en


def test_template_never_raises_on_missing_criteria():
    fire = {
        "category": "rest_required",
        "feature_contributions": {
            "rest_required": {"score": 100.0, "clamped": False, "rows": [], "gates": []},
        },
    }
    target = te.build_target(fire, "rest_required")
    ja, en = te.template(target)
    assert ja and en


def test_template_never_raises_on_a_null_category():
    target = te.build_target({"feature_contributions": {}}, None)
    ja, en = te.template(target)
    assert ja and en


def test_template_never_raises_on_malformed_rows():
    fire = {
        "category": "rest_required",
        "feature_contributions": {
            "rest_required": {
                "score": 100.0, "clamped": False,
                "rows": [None, {"feature_id": "x"}, "not_a_dict", {"contribution": "not_a_number"}],
                "gates": [],
            },
        },
        "criteria": {"threshold_fire": 90.0},
    }
    target = te.build_target(fire, "rest_required")
    ja, en = te.template(target)
    assert ja and en


# ---------------------------------------------------------------------------
# build_prompt() — fact-rich, no raw fractions/verdict, grounded correctly.
# ---------------------------------------------------------------------------


def test_build_prompt_is_grounded_and_fact_rich_not_scores_only(nri_rest_fire):
    target = te.build_target(nri_rest_fire, "rest_required")
    prompt = te.build_prompt(target, {})

    assert prompt.messages[0].role == "system"
    assert prompt.messages[1].role == "user"
    user = prompt.messages[1].content
    assert "THE FIRING:" in user
    assert "JA:" in user and "EN:" in user  # the format reminder

    assert prompt.grounding["step"] == "trigger"
    assert prompt.grounding["category"] == "rest_required"
    assert prompt.grounding["threshold"] == nri_rest_fire["criteria"]["threshold_fire"]


def test_build_prompt_never_names_the_sibling_category(nri_rest_fire):
    # The bare word "monotony" legitimately appears in a REST fire's own facts
    # (NRI's `rest_required` chain carries its own "monotony" row — the env
    # accumulator; see `_COMPARISON_MARKERS_EN`'s comment above for the same
    # reasoning). What must never appear is the SIBLING CATEGORY's own label
    # phrase (`CATEGORY_LABELS["monotony_prevention"]["en"]`).
    target = te.build_target(nri_rest_fire, "rest_required")
    prompt = te.build_prompt(target, {})
    user = prompt.messages[1].content
    assert te.CATEGORY_LABELS["monotony_prevention"]["en"] not in user.lower()


def test_build_prompt_never_raises_on_a_sparse_target():
    target = te.build_target({"feature_contributions": {}}, None)
    prompt = te.build_prompt(target, {})
    assert prompt.messages[0].role == "system"
    assert prompt.messages[1].role == "user"
