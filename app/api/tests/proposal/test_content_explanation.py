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


# ── Task 7: alpha/beta availability guardrail (verified against real runs) ──
#
# Inspected proposal_runs/*.json content-step evidence (416 files, 32995
# feature_contribution rows total). For every drowsiness_level/fatigue_level
# row across all persisted content decisions (1670 rows each), alpha/beta
# were NUMERIC — never None. Concrete example:
#   proposal_runs/prun_20260717-132339_c94b11.json, item "synthetic-track-0266":
#   {"feature_id": "fatigue_level", "alpha": 0.5, "beta": 0.5, "contribution": 0.089, ...}
# That alpha (+0.5) is the OPPOSITE sign from _STATIC_DEMAND's fatigue_level
# fallback entry (-0.50, 0.50), so the two tests below pin that the bridge
# actually reads the row's own alpha/beta rather than silently substituting
# the static table whenever a fatigue_level row is present.
#
# (rows with None alpha/beta do exist in real runs, but only for non-situation
# feature_ids like oshi_id/age_band/played_items that have no _STATIC_DEMAND
# entry at all — demand_phrase correctly returns None for those regardless of
# path, so they don't exercise the fallback either. No real content run was
# found where a drowsiness_level/fatigue_level row itself carried a None
# alpha, so the `_STATIC_DEMAND`-fires branch is not pinned against real data
# here; it remains covered by the isolated None-input case below.)

def test_demand_phrase_uses_populated_row_alpha_over_static_fallback():
    # Real row observed above: fatigue_level alpha=+0.5, beta=+0.5.
    p = ce.demand_phrase(0.5, 0.5, "fatigue_level")
    assert p is not None
    assert "energetic" in p["en"].lower()


def test_causal_bridge_uses_row_alpha_for_fatigue_not_static_calm_text():
    # Same real-observed row embedded in a target: the bridge line must read
    # "energetic" (from the row's +0.5 alpha), not "calm"/"soothing" (what
    # _STATIC_DEMAND's -0.50 fatigue_level entry would produce).
    target = {
        "item_id": "synthetic-track-0266", "position": 1, "item_fit": 0.4,
        "trait_values": {"arousal": 0.75},
        "feature_contributions": [
            {"feature_id": "fatigue_level", "alpha": 0.5, "beta": 0.5, "contribution": 0.089},
        ],
    }
    lines = ce.causal_bridge_lines(target)
    joined = " ".join(lines).lower()
    assert "energetic" in joined
    assert "calm" not in joined and "soothing" not in joined


def test_demand_uses_static_fallback_when_row_alpha_missing():
    # No persisted drowsiness_level/fatigue_level row was found with a None
    # alpha (see note above) — but the fallback is still reachable code (e.g.
    # a package that omits alpha/beta on the row) and must render, keyed by
    # feature_id, exactly as _STATIC_DEMAND specifies.
    p = ce.demand_phrase(None, None, "drowsiness_level")
    assert p is not None and "energetic" in p["en"].lower()
