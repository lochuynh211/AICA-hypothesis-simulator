from aica_api.services import service_explanation as se


def _service_target():
    return {
        "candidate_id": "rest_stop", "rank": 1, "score": 0.42,
        "situation_fit": 0.33, "preference_fit": 0.02, "history_fit": 0.08,
        "strongest_support": {"feature_id": "drowsiness_level", "contribution": 0.30},
        "strongest_oppose": {"feature_id": "traffic_state", "contribution": -0.05},
        "supporting_feature_ids": ["drowsiness_level"],
        "opposing_feature_ids": ["traffic_state"],
        "feature_contributions": [
            {"feature_id": "drowsiness_level", "feature_value": "high", "contribution": 0.30},
            {"feature_id": "traffic_state", "feature_value": "heavy", "contribution": -0.05},
        ],
        "rationale": ["眠気が支持（+0.3000）。", "drowsiness supports this pick (+0.3000)."],
    }


def test_service_build_prompt_is_fact_rich_not_scores_only():
    prompt = se.build_prompt(_service_target(), {"trigger_purpose": "rest_recommended", "lifecycle_stage": "during_rest_stopped"})
    user = prompt.messages[1].content
    assert "THE SERVICE:" in user
    assert "THE TRIGGER & CAR STATE:" in user and "rest stop is now being recommended" in user
    assert "car is stopped" in user
    assert "THE SITUATION RIGHT NOW:" in user
    # the rest-recommendation clause must appear ONLY in the trigger section,
    # not duplicated into THE SITUATION RIGHT NOW below it (IMPORTANT fix).
    assert user.count("rest stop is now being recommended") == 1
    assert "WHY THE ALGORITHM RANKED IT TOP" in user
    # no pre-baked verdict / no raw contribution numbers in the user text
    assert "driven mostly by" not in user.lower()
    assert "+0.300" not in user and "-0.050" not in user
    # numeric readout still kept in grounding for auditability
    assert prompt.grounding["category_readout"]["dominant"] == "situation"
    # uses the service reasoning system prompt (its response matrix)
    system = prompt.messages[0].content.lower()
    assert "service" in system and "response" in system


def test_service_template_is_causal_when_facts_present():
    # A REAL catalog id is named by its specification service name, never by
    # the identifier: the sentence a reviewer reads is product vocabulary.
    target = {**_service_target(), "candidate_id": "music_playlist"}
    ja, en = se.template(target)
    assert "playlist playback" in en
    assert "プレイリスト再生" in ja
    assert "music_playlist" not in en and "music_playlist" not in ja
    assert "drowsiness" in en.lower()
    assert ja and en


def test_service_template_does_not_leak_an_unrecognised_candidate_id():
    # An id with no catalog entry is described as unnamed rather than printed —
    # an identifier must not reach the screen even on an unmapped value.
    ja, en = se.template(_service_target())  # candidate_id="rest_stop", not a V1 service
    assert "rest_stop" not in en and "rest_stop" not in ja
    assert "unnamed service" in en


def test_service_template_degrades_to_passthrough_pair():
    target = {"candidate_id": "rest_stop",
              "rationale": ["日本語の理由。", "English reason."]}
    assert se.template(target) == ["日本語の理由。", "English reason."]


def test_service_build_prompt_omits_situation_section_when_service_is_neutral_to_it():
    # music_playlist: background music that is NEUTRAL to drowsiness/monotony
    # (contribution ~0) — only route/music-purpose features actually drove it.
    # The prompt must NOT hand the model a prominent "getting drowsy" fact that
    # has nothing to do with why this (non-interactive) service was chosen —
    # that fact plus the system-prompt matrix was pulling qwen2.5:3b into
    # arguing for a DIFFERENT kind of service than the one picked (022 fix).
    target = {
        "candidate_id": "music_playlist", "rank": 1, "score": 0.20,
        "situation_fit": 0.0, "preference_fit": 0.02, "history_fit": 0.08,
        "strongest_support": {"feature_id": "route_tags", "contribution": 0.10},
        "supporting_feature_ids": ["route_tags"],
        "opposing_feature_ids": [],
        "feature_contributions": [
            {"feature_id": "drowsiness_level", "feature_value": 70, "contribution": 0.0},
            {"feature_id": "monotony_level", "feature_value": 65, "contribution": 0.0},
            {"feature_id": "route_tags", "feature_value": "highway", "contribution": 0.10},
        ],
        "rationale": ["ルート特性が支持（+0.1000）。", "route characteristics support this pick (+0.1000)."],
    }
    prompt = se.build_prompt(target, {"trigger_purpose": "route_music", "lifecycle_stage": "active_driving"})
    user = prompt.messages[1].content
    assert "THE SITUATION RIGHT NOW:" not in user
    assert "drowsy" not in user.lower()


def test_service_build_prompt_keeps_situation_section_when_service_responds_to_it():
    # humming_karaoke: interactive service where drowsiness genuinely drove the
    # pick — the situation section must stay.
    target = {
        "candidate_id": "humming_karaoke", "rank": 1, "score": 0.35,
        "situation_fit": 0.28, "preference_fit": 0.0, "history_fit": 0.05,
        "strongest_support": {"feature_id": "drowsiness_level", "contribution": 0.25},
        "supporting_feature_ids": ["drowsiness_level"],
        "opposing_feature_ids": [],
        "feature_contributions": [
            {"feature_id": "drowsiness_level", "feature_value": 70, "contribution": 0.25},
        ],
        "rationale": ["眠気が支持（+0.2500）。", "drowsiness supports this pick (+0.2500)."],
    }
    prompt = se.build_prompt(
        target, {"trigger_purpose": "inattentive_driving_prevention_recovery", "lifecycle_stage": "active_driving"}
    )
    user = prompt.messages[1].content
    assert "THE SITUATION RIGHT NOW:" in user
    assert "drowsy" in user.lower()


def test_service_build_prompt_situation_sentence_reads_categorical_feature_value():
    prompt = se.build_prompt(_service_target(), {"trigger_purpose": "drowsiness"})
    user = prompt.messages[1].content
    # drowsiness_level feature_value="high" is a categorical passthrough (not a
    # numeric band), so situation_sentence can't narrate a level from it, but
    # traffic_state's categorical value IS surfaced verbatim
    assert "traffic is heavy" in user
    grounding_factors = {f["feature_id"]: f for f in prompt.grounding["factors"]}
    assert grounding_factors["drowsiness_level"]["value_display"] == "high"
