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


def test_service_build_prompt_injects_readout():
    prompt = se.build_prompt(_service_target(), {"trigger_purpose": "drowsiness"})
    user = prompt.messages[1].content.lower()
    assert "driven mostly by" in user
    assert prompt.grounding["category_readout"]["dominant"] == "situation"


def test_service_template_is_causal_when_facts_present():
    ja, en = se.template(_service_target())
    assert "rest_stop" in en
    assert "drowsiness" in en.lower()
    assert ja and en


def test_service_template_degrades_to_passthrough_pair():
    target = {"candidate_id": "rest_stop",
              "rationale": ["日本語の理由。", "English reason."]}
    assert se.template(target) == ["日本語の理由。", "English reason."]
