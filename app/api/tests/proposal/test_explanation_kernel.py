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


def test_content_reason_system_has_response_matrix_and_causal_instruction():
    sys = eb._CONTENT_REASON_SYSTEM.format(kind="song").lower()
    assert "how much" in sys and "answered" in sys  # contribution = weight × answer
    assert "situation" in sys and "taste" in sys and "history" in sys  # three families
    assert "calls for" in sys  # causal structure cue
    assert "drowsiness" in sys and "monotony" in sys and "fatigue" in sys  # the response matrix


def test_service_reason_system_has_response_matrix_and_causal_instruction():
    sys = eb._SERVICE_REASON_SYSTEM.lower()
    assert "situation" in sys and "taste" in sys and "history" in sys
    assert "trigger" in sys and "car state" in sys
    assert "drowsiness" in sys and "monotony" in sys
    assert "rest" in sys  # rest & recovery services family


def test_reasoning_system_prompts_satisfy_format_and_anti_parrot_guard():
    # Both new system prompts must independently satisfy the SAME guard the
    # dispatcher-level test pins (test_explanation_builder.py) — "only",
    # "do not copy", "exactly two lines", "japanese"/"english", ja:/en: x2.
    for sys in (eb._CONTENT_REASON_SYSTEM.format(kind="song").lower(), eb._SERVICE_REASON_SYSTEM.lower()):
        assert "only" in sys
        assert "do not copy" in sys
        assert "exactly two lines" in sys
        assert "japanese" in sys and "english" in sys
        assert sys.count("ja:") >= 2 and sys.count("en:") >= 2


def test_example_lines_still_use_strippable_placeholders():
    # the causal-shape example must still be caught by the placeholder guard
    assert eb.strip_placeholder_artifacts(eb._EXAMPLE_EN) != eb._EXAMPLE_EN


def test_reasoning_system_prompts_have_strong_japanese_anchor():
    # Regression: qwen2.5:3b wrote Line 1 in ENGLISH on most presets once the
    # fact sections became English-only, because the old prompt lost its
    # Japanese anchoring. Both reasoning system prompts must carry an
    # explicit, hard-to-miss instruction that Line 1 must be Japanese, plus a
    # placeholder-shaped example line so the model doesn't copy it verbatim.
    for sys in (eb._CONTENT_REASON_SYSTEM.format(kind="song"), eb._SERVICE_REASON_SYSTEM):
        assert "日本語" in sys
        assert "〔" in sys
        lowered = sys.lower()
        assert "must write line 1 in japanese" in lowered
        # existing guarantees must still hold after strengthening the ending
        assert "only" in lowered
        assert "japanese" in lowered and "english" in lowered
        assert "exactly two lines" in lowered
        assert "do not copy" in lowered
        assert lowered.count("ja:") >= 2 and lowered.count("en:") >= 2


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


# ── fact-rich reasoning prompt translators (022) ────────────────────────────

def test_feature_family_classifies_all_three():
    assert eb.feature_family("drowsiness_level") == "situation"
    assert eb.feature_family("oshi_id") == "preference"
    assert eb.feature_family("catalog_item_usage_level") == "history"
    assert eb.feature_family("service_recovery_rate") == "history"
    assert eb.feature_family("totally_unknown") is None


def test_situation_sentence_bands_drowsiness_and_monotony_from_content_e_i():
    target = {
        "feature_contributions": [
            {"feature_id": "drowsiness", "e_i": 0.72, "contribution": 0.1},  # ->72 -> very drowsy
            {"feature_id": "monotony", "e_i": 0.70, "contribution": 0.1},    # ->70 -> very monotonous
        ]
    }
    s = eb.situation_sentence(target, None)
    assert "very drowsy" in s
    assert "very monotonous" in s


def test_situation_sentence_alert_and_low_monotony():
    target = {
        "feature_contributions": [
            {"feature_id": "drowsiness_level", "feature_value": 10, "contribution": 0.05},
            {"feature_id": "monotony_level", "feature_value": 15, "contribution": 0.02},
        ]
    }
    s = eb.situation_sentence(target, None)
    assert "alert and awake" in s
    assert "engaging" in s


def test_situation_sentence_night_and_traffic_and_rest_trigger():
    target = {
        "feature_contributions": [
            {"feature_id": "night_state", "feature_value": "night", "contribution": 0.01},
            {"feature_id": "traffic_state", "feature_value": "heavy", "contribution": 0.02},
            {"feature_id": "road_type", "feature_value": "mountain_road", "contribution": 0.0},
        ]
    }
    s = eb.situation_sentence(target, "rest_recommended")
    assert "it is night" in s
    assert "traffic is heavy" in s
    assert "mountain road" in s
    # The rest-recommendation clause is carried by trigger_sentence (service's
    # "THE TRIGGER & CAR STATE" section) — situation_sentence must NOT repeat
    # it, or a rest_recommended service prompt shows the clause twice.
    assert "rest stop is now being recommended" not in s


def test_situation_sentence_none_when_no_situation_rows():
    target = {"feature_contributions": [{"feature_id": "oshi_id", "e_i": 1.0, "contribution": 0.1}]}
    assert eb.situation_sentence(target, None) is None


# ── contributing_only gate (022 fix — kills the music_playlist contradiction) ──

def test_situation_sentence_contributing_only_drops_zero_contribution_drowsiness():
    # drowsiness contribution ~0 (this candidate is NEUTRAL to it), but route
    # tags (not narrated by situation_sentence) is what actually drove it.
    target = {
        "feature_contributions": [
            {"feature_id": "drowsiness_level", "feature_value": 70, "contribution": 0.0},
            {"feature_id": "monotony_level", "feature_value": 65, "contribution": 0.0},
        ]
    }
    s = eb.situation_sentence(target, "route_music", contributing_only=True)
    assert s is None or "drowsy" not in s


def test_situation_sentence_contributing_only_keeps_meaningful_drowsiness():
    target = {
        "feature_contributions": [
            {"feature_id": "drowsiness_level", "feature_value": 70, "contribution": 0.25},
        ]
    }
    s = eb.situation_sentence(target, "inattentive_driving_prevention_recovery", contributing_only=True)
    assert s is not None
    assert "drowsy" in s


def test_situation_sentence_contributing_only_none_when_nothing_passes_gate():
    target = {
        "feature_contributions": [
            {"feature_id": "drowsiness_level", "feature_value": 70, "contribution": 0.0},
            {"feature_id": "monotony_level", "feature_value": 65, "contribution": 0.0},
            {"feature_id": "night_state", "feature_value": "night", "contribution": 0.0},
        ]
    }
    assert eb.situation_sentence(target, "route_music", contributing_only=True) is None
    # never the mild overclaim in this mode
    assert eb.situation_sentence(target, "route_music", contributing_only=True) != "The driver is in a neutral state."


def test_situation_sentence_content_default_ignores_contribution_magnitude():
    # Content path (contributing_only=False, the default) must be unaffected:
    # drowsiness contribution ~0 still gets narrated, since content reasoning
    # needs the full situation regardless of this item's own response to it.
    target = {
        "feature_contributions": [
            {"feature_id": "drowsiness_level", "feature_value": 70, "contribution": 0.0},
        ]
    }
    s = eb.situation_sentence(target, "route_music")
    assert s is not None
    assert "drowsy" in s


def test_trigger_sentence_maps_known_purposes_and_reads_motion_state():
    target = {"feature_contributions": [{"feature_id": "motion_state", "feature_value": "stopped", "contribution": 0.0}]}
    s = eb.trigger_sentence("rest_recommended", target, None)
    assert "rest stop is now being recommended" in s
    assert "car is stopped" in s


def test_trigger_sentence_infers_car_state_from_lifecycle_stage_when_no_motion_row():
    target = {"feature_contributions": []}
    s = eb.trigger_sentence("route_music", target, "active_driving_content")
    assert "routine in-drive music selection" in s
    assert "car is moving" in s

    s2 = eb.trigger_sentence("rest_recommended", target, "during_rest_stopped")
    assert "car is stopped" in s2

    # before_rest_until_stop: driving TOWARD the rest stop, still moving —
    # a bare "rest" substring check on the lifecycle stage wrongly reads this
    # as stopped (CRITICAL regression guard).
    s3 = eb.trigger_sentence("rest_recommended", target, "before_rest_until_stop")
    assert "car is moving" in s3
    assert "car is stopped" not in s3

    # after_rest_before_restart: genuinely stopped (paused after the rest, not
    # yet driving again).
    s4 = eb.trigger_sentence("rest_recommended", target, "after_rest_before_restart")
    assert "car is stopped" in s4


def test_preference_sentence_uses_oshi_artist_context_field():
    assert eb.preference_sentence({"oshi_artist": "YOASOBI"}) == "Their favorite artist (oshi) is YOASOBI."
    assert eb.preference_sentence({}) is None


def test_history_sentences_translate_content_history_rows():
    target = {
        "feature_contributions": [
            {"feature_id": "catalog_item_usage_level", "e_i": 0.9, "contribution": 0.1},
            {"feature_id": "content_proposal_acceptance_rate", "e_i": 0.95, "contribution": 0.1},
            {"feature_id": "played_items", "e_i": 1.0, "contribution": 0.05},
        ]
    }
    out = eb.history_sentences(target)
    assert any("plays this song often" in s for s in out)
    assert any("usually accepts song suggestions" in s for s in out)
    assert any("played this song recently" in s for s in out)


def test_history_sentences_translate_service_history_rows():
    target = {
        "feature_contributions": [
            {"feature_id": "service_recovery_rate", "e_i": 0.9, "contribution": 0.1},
            {"feature_id": "service_usage_level", "e_i": 0.5, "contribution": 0.05},
        ]
    }
    out = eb.history_sentences(target)
    assert any("reliably restored the driver's state before" in s for s in out)
    assert any("uses this service sometimes" in s for s in out)


def test_history_sentences_empty_when_no_history_rows():
    target = {"feature_contributions": [{"feature_id": "drowsiness_level", "feature_value": 80, "contribution": 0.1}]}
    assert eb.history_sentences(target) == []


def test_score_evidence_strength_words_and_oshi_naming():
    factors = [
        {"feature_id": "oshi_id", "label_en": "oshi (favorite-artist) match", "contribution": 0.30},
        {"feature_id": "drowsiness_level", "label_en": "drowsiness", "contribution": 0.02},
        {"feature_id": "traffic_state", "label_en": "traffic", "contribution": -0.02},
    ]
    lines = eb.score_evidence(factors, oshi_artist="YOASOBI")
    joined = " ".join(lines)
    assert "favorite artist (YOASOBI)" in joined
    assert "a major reason" in joined  # 0.30
    assert "a minor reason" in joined  # 0.02
    assert "pushed slightly against it" in joined  # -0.02
    # no raw numbers leak into the evidence lines
    assert "0.30" not in joined and "0.02" not in joined


def test_score_evidence_negative_tiers_are_magnitude_aware():
    # A strong opposing factor (-0.20) must NOT collapse to the same trivial
    # phrase as a barely-there one (-0.01) — IMPORTANT regression guard.
    factors = [
        {"feature_id": "traffic_state", "label_en": "traffic", "contribution": -0.20},
        {"feature_id": "night_state", "label_en": "night", "contribution": -0.05},
        {"feature_id": "road_type", "label_en": "road type", "contribution": -0.01},
    ]
    lines = eb.score_evidence(factors)
    joined = " ".join(lines)
    assert "pushed strongly against it" in joined  # -0.20
    assert "pushed moderately against it" in joined  # -0.05
    assert "pushed slightly against it" in joined  # -0.01


def test_score_evidence_oshi_phrasing_requires_positive_contribution():
    # A (hypothetical) negative oshi contribution must fall back to the plain
    # label, never render "favorite artist ... pushed against it" — MINOR
    # regression guard against an invented positive-sounding fact paired with
    # negative framing.
    factors = [
        {"feature_id": "oshi_id", "label_en": "oshi (favorite-artist) match", "contribution": -0.10},
    ]
    lines = eb.score_evidence(factors, oshi_artist="YOASOBI")
    joined = " ".join(lines)
    assert "favorite artist" not in joined
    assert "oshi (favorite-artist) match" in joined
    assert "pushed strongly against it" in joined
