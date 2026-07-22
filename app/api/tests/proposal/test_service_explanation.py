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
    ja, en = se.template(_service_target())
    assert "rest_stop" in en
    assert "drowsiness" in en.lower()
    assert ja and en


def test_service_template_degrades_to_passthrough_pair():
    target = {"candidate_id": "rest_stop",
              "rationale": ["日本語の理由。", "English reason."]}
    assert se.template(target) == ["日本語の理由。", "English reason."]


def test_service_build_prompt_situation_sentence_reads_categorical_feature_value():
    prompt = se.build_prompt(_service_target(), {"trigger_purpose": "drowsiness"})
    user = prompt.messages[1].content
    # drowsiness_level feature_value="high" is a categorical passthrough (not a
    # numeric band), so situation_sentence can't narrate a level from it, but
    # traffic_state's categorical value IS surfaced verbatim
    assert "traffic is heavy" in user
    grounding_factors = {f["feature_id"]: f for f in prompt.grounding["factors"]}
    assert grounding_factors["drowsiness_level"]["value_display"] == "high"
