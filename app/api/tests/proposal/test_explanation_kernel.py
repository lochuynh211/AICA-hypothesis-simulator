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
