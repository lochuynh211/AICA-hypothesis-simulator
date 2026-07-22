# app/api/tests/proposal/test_content_explanation.py
from aica_api.services import content_explanation as ce


def _drowsy_song_target():
    # drowsiness demands high arousal (alpha +0.80); this song IS high-arousal.
    return {
        "item_id": "song-1", "position": 1, "item_fit": 0.52,
        "trait_values": {"arousal": 0.80, "valence": 0.60, "humming_ease": 0.5,
                         "full_karaoke_ease": 0.4, "arousal_signed": 0.6, "valence_signed": 0.2},
        "situation_fit": 0.30, "preference_fit": 0.05, "history_fit": 0.01,
        "feature_contributions": [
            {"feature_id": "drowsiness_level", "e_i": 0.72, "a_i": 0.6, "alpha": 0.80,
             "beta": 0.20, "contribution": 0.18},
            {"feature_id": "oshi_id", "e_i": 1.0, "a_i": 1.0, "alpha": None,
             "beta": None, "exact_match": True, "contribution": 0.05},
        ],
        "rationale": ["眠気が寄与 / drowsiness supports"],
    }


def test_demand_phrase_drowsiness_is_energetic():
    p = ce.demand_phrase(0.80, 0.20, "drowsiness_level")
    assert "energetic" in p["en"].lower()


def test_demand_phrase_fatigue_is_soothing():
    p = ce.demand_phrase(-0.50, 0.50, "fatigue_level")
    assert "calm" in p["en"].lower() or "soothing" in p["en"].lower()


def test_causal_bridge_pairs_demand_with_actual_trait():
    lines = ce.causal_bridge_lines(_drowsy_song_target())
    joined = " ".join(lines).lower()
    # names the situation, what it calls for, and the song's actual energy
    assert "drowsiness" in joined
    assert "energetic" in joined
    assert "high" in joined  # song energy band
    # oshi_id has no alpha/beta → not a bridge line
    assert "oshi" not in joined


def test_causal_bridge_empty_when_no_traits():
    assert ce.causal_bridge_lines({"item_id": "x", "feature_contributions": []}) == []


def test_build_prompt_injects_bridge_and_readout():
    prompt = ce.build_prompt(_drowsy_song_target(), {"trigger_purpose": "drowsiness"})
    user = prompt.messages[1].content.lower()
    assert "energetic" in user and "driven mostly by" in user
    assert "causal_bridge" in prompt.grounding
    assert prompt.grounding["category_readout"]["dominant"] == "situation"


def test_content_template_is_causal_when_facts_present():
    ja, en = ce.template(_drowsy_song_target())
    assert "energetic" in en.lower()
    assert ja and en
    assert " / " not in ja  # not the raw combined form


def test_content_template_degrades_to_legacy_join():
    target = {"item_id": "x", "rationale": [
        "眠気が寄与（+0.120） / drowsiness supports this (+0.120)"]}
    ja, en = ce.template(target)
    assert "drowsiness supports" in en
    assert " / " not in ja and " / " not in en


def test_content_template_empty_is_safe():
    assert ce.template({"item_id": "x"}) == ["", ""]
