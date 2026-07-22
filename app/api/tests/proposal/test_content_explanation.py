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


# ── FIX-D3: motion_state/motion is not a causal anchor ──────────────────────

def test_causal_bridge_skips_motion_state():
    target = {
        "item_id": "x",
        "trait_values": {"arousal": 0.80},
        "feature_contributions": [
            {"feature_id": "motion_state", "alpha": 0.5, "beta": 0.0, "contribution": 0.10},
        ],
    }
    assert ce.causal_bridge_lines(target) == []


def test_template_skips_motion_state_as_sentence1_anchor():
    target = {
        "item_id": "x",
        "trait_values": {"arousal": 0.80},
        "feature_contributions": [
            {"feature_id": "motion_state", "alpha": 0.5, "beta": 0.0, "contribution": 0.50},
        ],
    }
    ja, en = ce.template(target)
    assert "motion" not in en.lower() and "走行状態" not in ja
    # no other demand-bearing feature -> falls back to legacy join (empty rationale here -> blank pair)
    assert [ja, en] == ["", ""]


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


# ── FIX-D1: sentence 1 states the feature's REAL value band, never "is high"
# when it isn't ──────────────────────────────────────────────────────────────

def test_content_template_low_drowsiness_does_not_say_is_high():
    target = {
        "item_id": "song-low", "position": 1, "item_fit": 0.20,
        "trait_values": {"arousal": 0.80, "valence": 0.60},
        "situation_fit": 0.10, "preference_fit": 0.01, "history_fit": 0.0,
        "feature_contributions": [
            {"feature_id": "drowsiness_level", "e_i": 0.15, "alpha": 0.80, "beta": 0.20,
             "contribution": 0.05},
        ],
    }
    ja, en = ce.template(target)
    assert "drowsiness is high" not in en.lower()
    assert "drowsiness is low" in en.lower()


# ── FIX-D5: sentence 1 leads with the dominant preference/history family ────

def test_content_template_leads_with_preference_when_dominant():
    target = {
        "item_id": "song-pref", "position": 1, "item_fit": 0.30,
        "trait_values": {"arousal": 0.80, "valence": 0.60},
        "situation_fit": 0.02, "preference_fit": 0.35, "history_fit": 0.01,
        "feature_contributions": [
            {"feature_id": "drowsiness_level", "e_i": 0.72, "alpha": 0.80, "beta": 0.20,
             "contribution": 0.02},
            {"feature_id": "oshi_id", "e_i": 1.0, "contribution": 0.30},
        ],
    }
    ja, en = ce.template(target)
    assert "taste" in en.lower()
    assert "oshi" in en.lower() or "favorite" in en.lower()
    assert "situation calls for" not in en.lower()


def test_content_template_leads_with_history_when_dominant():
    target = {
        "item_id": "song-hist", "position": 1, "item_fit": 0.30,
        "trait_values": {"arousal": 0.80, "valence": 0.60},
        "situation_fit": 0.02, "preference_fit": 0.01, "history_fit": 0.30,
        "feature_contributions": [
            {"feature_id": "drowsiness_level", "e_i": 0.72, "alpha": 0.80, "beta": 0.20,
             "contribution": 0.02},
            {"feature_id": "catalog_item_usage_level", "e_i": 0.9, "contribution": 0.28},
        ],
    }
    ja, en = ce.template(target)
    assert "history" in en.lower()
    assert "situation calls for" not in en.lower()


# ── FIX-D4: taste/history reinforcement needs a real signal (>= 0.05) ───────

def test_content_template_blank_profile_does_not_claim_taste_reinforced():
    target = {
        "item_id": "song-blank", "position": 1, "item_fit": 0.20,
        "trait_values": {"arousal": 0.80, "valence": 0.60},
        "situation_fit": 0.30, "preference_fit": 0.03, "history_fit": 0.0,
        "feature_contributions": [
            {"feature_id": "drowsiness_level", "e_i": 0.72, "alpha": 0.80, "beta": 0.20,
             "contribution": 0.18},
        ],
    }
    ja, en = ce.template(target)
    assert "your taste" not in en.lower()
    assert "reinforced" not in en.lower()


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


# ── FIX-SCALE: factor list shows a qualitative band, not a raw fraction ──────

def test_build_prompt_factor_list_shows_band_not_raw_fraction():
    prompt = ce.build_prompt(_drowsy_song_target(), {"trigger_purpose": "drowsiness"})
    user = prompt.messages[1].content
    assert "[0.7" not in user and "[0.72]" not in user
    assert "[high]" in user  # drowsiness e_i=0.72 -> high band
    assert "(0-100)" not in user and "(0–100)" not in user


# ── FIX-D2: bridge narrates the axis the song actually satisfies ────────────

def test_bridge_fatigue_style_row_reads_as_coherent_valence_match():
    # alpha<0 (soothe demand) but beta>0 (bright demand); song is HIGH arousal
    # (soothe unsatisfied) AND bright (bright satisfied) -> must narrate the
    # valence axis honestly, never claim a soothe/calm match that isn't real.
    target = {
        "item_id": "x", "position": 1, "item_fit": 0.4,
        "trait_values": {"arousal": 0.80, "valence": 0.70},
        "feature_contributions": [
            {"feature_id": "fatigue_level", "alpha": -0.5, "beta": 0.5, "contribution": 0.089},
        ],
    }
    lines = ce.causal_bridge_lines(target)
    joined = " ".join(lines).lower()
    assert not ("calm" in joined and "a strong match" in joined)
    assert "brighter" in joined or "bright" in joined
    assert "matches" in joined
    assert "calm" not in joined and "soothing" not in joined


def test_bridge_drowsiness_stays_arousal_energize_match():
    lines = ce.causal_bridge_lines(_drowsy_song_target())
    joined = " ".join(lines).lower()
    assert "energetic" in joined and "matches" in joined


def test_bridge_never_pairs_calm_demand_with_strong_match_wording():
    # Across a battery of alpha/beta combos with a high-energy song, no bridge
    # line may claim "(a strong match)" (the old buggy phrasing) at all, and
    # none may pair calm/soothing with a match claim.
    for alpha, beta in [(-0.5, 0.5), (-0.8, 0.1), (-0.3, 0.7)]:
        target = {
            "item_id": "x",
            "trait_values": {"arousal": 0.85, "valence": 0.75},
            "feature_contributions": [
                {"feature_id": "fatigue_level", "alpha": alpha, "beta": beta, "contribution": 0.05},
            ],
        }
        joined = " ".join(ce.causal_bridge_lines(target)).lower()
        assert "a strong match" not in joined
        assert not ("calm" in joined and "match" in joined)


def test_demand_phrase_directional_features_stay_silent_without_row_alpha():
    # sign of fatigue/traffic/night demand is directional_hypothesis-dependent;
    # with no row alpha/beta we cannot know it, so return None (no invented facts)
    for fid in ("fatigue_level", "traffic_state", "night_state"):
        assert ce.demand_phrase(None, None, fid) is None
    # non-directional drowsiness still uses the stable static fallback
    assert ce.demand_phrase(None, None, "drowsiness_level") is not None
