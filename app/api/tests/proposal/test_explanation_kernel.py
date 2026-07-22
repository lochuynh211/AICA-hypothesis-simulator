# app/api/tests/proposal/test_explanation_kernel.py
from aica_api.services import explanation_builder as eb


def test_category_readout_picks_dominant_situation():
    target = {"situation_fit": 0.30, "preference_fit": 0.05, "history_fit": -0.02}
    r = eb.category_readout(target)
    assert r["dominant"] == "situation"
    assert "situation" in r["phrase_en"].lower()
    assert r["phrase_ja"]  # non-empty JA phrase


def test_category_readout_picks_dominant_preference_by_magnitude():
    target = {"situation_fit": 0.04, "preference_fit": -0.20, "history_fit": 0.03}
    r = eb.category_readout(target)
    assert r["dominant"] == "preference"


def test_category_readout_none_when_no_subtotals():
    assert eb.category_readout({"item_id": "x"}) is None


def test_system_prompt_has_algorithm_primer_and_causal_instruction():
    sys = eb._SYSTEM_TEMPLATE.format(kind="song").lower()
    assert "how much" in sys and "answers" in sys  # contribution = importance × answer
    assert "situation" in sys and "taste" in sys and "history" in sys  # three families
    assert "calls for" in sys  # causal structure cue


def test_example_lines_still_use_strippable_placeholders():
    # the causal-shape example must still be caught by the placeholder guard
    assert eb.strip_placeholder_artifacts(eb._EXAMPLE_EN) != eb._EXAMPLE_EN


# ── FIX-SCALE: factor value_display is a qualitative band, not a raw number ──

def test_factors_from_target_numeric_value_gets_banded_display():
    target = {
        "feature_contributions": [
            {"feature_id": "drowsiness_level", "e_i": 0.72, "contribution": 0.18},  # >=0.62 -> high
            {"feature_id": "monotony_level", "e_i": 0.50, "contribution": 0.10},    # medium
            {"feature_id": "traffic_state", "e_i": 0.20, "contribution": 0.05},     # <0.40 -> low
        ]
    }
    factors = eb._factors_from_target(target)
    by_id = {f["feature_id"]: f for f in factors}
    assert by_id["drowsiness_level"]["value_display"] == "high"
    assert by_id["monotony_level"]["value_display"] == "medium"
    assert by_id["traffic_state"]["value_display"] == "low"
    # raw value field is preserved as-is
    assert by_id["drowsiness_level"]["value"] == 0.72


def test_factors_from_target_string_value_passes_through():
    target = {
        "feature_contributions": [
            {"feature_id": "drowsiness_level", "feature_value": "heavy", "contribution": 0.3},
        ]
    }
    factors = eb._factors_from_target(target)
    assert factors[0]["value_display"] == "heavy"


def test_factors_from_target_missing_value_is_blank_display():
    target = {"feature_contributions": [{"feature_id": "oshi_id", "contribution": 0.05}]}
    factors = eb._factors_from_target(target)
    assert factors[0]["value_display"] == ""


def test_feature_meanings_have_no_numeric_range_parentheticals():
    for fid, meaning in eb._FEATURE_MEANINGS.items():
        assert "0–100" not in meaning and "0-100" not in meaning
        assert "0–1)" not in meaning and "0-1)" not in meaning
        assert "0 = " not in meaning, f"{fid}: {meaning!r} still has a numeric-range parenthetical"
