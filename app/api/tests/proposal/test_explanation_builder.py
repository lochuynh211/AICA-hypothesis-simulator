"""Tests for the explanation_builder (feature 019) — pure, deterministic.

Covers the merged feature-label map, grounded-prompt construction (grounds
ONLY on given facts, sorts factors, caps the list), the defensive bilingual
parser, and the deterministic template fallback for both selector shapes.
"""
from aica_api.services import explanation_builder as eb


# ── label map ────────────────────────────────────────────────────────────────

def test_label_for_known_service_and_content_keys():
    assert eb.label_for("drowsiness_level")["en"] == "drowsiness"
    assert eb.label_for("drowsiness")["en"] == "drowsiness"  # content leaf namespace
    assert eb.label_for("oshi")["ja"] == "推しとの一致"


def test_label_for_unknown_falls_back_to_raw_id():
    lab = eb.label_for("totally_unknown_feature")
    assert lab == {"ja": "totally_unknown_feature", "en": "totally_unknown_feature"}


# ── prompt builder ───────────────────────────────────────────────────────────

def _service_target():
    return {
        "candidate_id": "rest_stop",
        "rank": 1,
        "score": 0.42,
        "rationale": ["眠気が支持（+0.3000）。", "drowsiness supports this pick (+0.3000)."],
        "supporting_feature_ids": ["drowsiness_level"],
        "opposing_feature_ids": ["traffic_state"],
        "feature_contributions": [
            {"feature_id": "drowsiness_level", "feature_value": "high", "contribution": 0.30},
            {"feature_id": "traffic_state", "feature_value": "heavy", "contribution": -0.05},
            {"feature_id": "monotony_level", "feature_value": "high", "contribution": 0.12},
        ],
    }


def test_build_service_prompt_grounds_on_given_facts():
    prompt = eb.build_explanation_prompt(
        "service", _service_target(), {"trigger_purpose": "fatigue", "lifecycle_stage": "cruising"}
    )
    roles = [m.role for m in prompt.messages]
    assert roles == ["system", "user"]
    user = prompt.messages[1].content
    # chosen id + purpose + top factor label all present; numbers come only from facts
    assert "rest_stop" in user
    assert "fatigue" in user
    assert "drowsiness" in user
    # grounding is structured and factor-sorted by |contribution| desc, capped
    factors = prompt.grounding["factors"]
    assert [f["feature_id"] for f in factors][:2] == ["drowsiness_level", "monotony_level"]
    assert prompt.grounding["target_id"] == "rest_stop"
    assert prompt.grounding["supporting"] == ["drowsiness_level"]


def test_build_prompt_caps_factor_count():
    target = {
        "item_id": "song-1",
        "position": 1,
        "item_fit": 0.5,
        "rationale": ["a / b"],
        "feature_contributions": [
            {"feature_id": f"f{i}", "e_i": 1.0, "contribution": (0.1 * (i + 1))} for i in range(12)
        ],
    }
    prompt = eb.build_explanation_prompt("content", target, {"trigger_purpose": "boredom"})
    assert len(prompt.grounding["factors"]) <= eb.MAX_FACTORS


def test_system_prompt_forbids_fabrication_and_sets_output_format():
    prompt = eb.build_explanation_prompt("service", _service_target(), {})
    system = prompt.messages[0].content.lower()
    assert "only" in system  # "use only the facts"
    assert "ja:" in system and "en:" in system  # required output format
    # robustness: both languages explicitly required, exact-two-lines, no-echo
    assert "japanese" in system and "english" in system
    assert "exactly two lines" in system
    assert "do not copy" in system  # anti-echo instruction
    # a concrete format example anchors the two-line shape
    assert system.count("ja:") >= 2 and system.count("en:") >= 2


def test_user_message_ends_with_a_format_reminder():
    prompt = eb.build_explanation_prompt("service", _service_target(), {"trigger_purpose": "fatigue"})
    user = prompt.messages[1].content
    last = user.strip().splitlines()[-1].lower()
    assert "ja:" in last and "en:" in last and "two lines" in last


# ── bilingual parser ─────────────────────────────────────────────────────────

def test_parse_bilingual_prefixed():
    assert eb.parse_bilingual("JA: 眠気が高い\nEN: high drowsiness") == ["眠気が高い", "high drowsiness"]


def test_parse_bilingual_prefix_case_insensitive_and_trimmed():
    assert eb.parse_bilingual("  ja:  あ \n  en:  b  ") == ["あ", "b"]


def test_parse_bilingual_inline_ja_en_on_one_line():
    # Gemini Nano sometimes emits both on a single line — must still split.
    assert eb.parse_bilingual("JA: 眠気が強い。 EN: Drowsiness is strong.") == ["眠気が強い。", "Drowsiness is strong."]


def test_parse_bilingual_two_plain_lines():
    assert eb.parse_bilingual("日本語の文\nEnglish line") == ["日本語の文", "English line"]


def test_parse_bilingual_single_line_used_for_both():
    assert eb.parse_bilingual("only one sentence") == ["only one sentence", "only one sentence"]


def test_parse_bilingual_strips_code_fences():
    assert eb.parse_bilingual("```\nJA: あ\nEN: b\n```") == ["あ", "b"]


def test_parse_bilingual_empty_returns_empty_pair():
    assert eb.parse_bilingual("   ") == ["", ""]


# ── template fallback ────────────────────────────────────────────────────────

def test_template_rationale_service_passthrough_pair():
    out = eb.template_rationale("service", _service_target())
    assert out == ["眠気が支持（+0.3000）。", "drowsiness supports this pick (+0.3000)."]


def test_template_rationale_content_normalizes_combined_list_to_pair():
    target = {
        "item_id": "song-1",
        "rationale": [
            "眠気が推薦に寄与（+0.120） / drowsiness supports this pick (+0.120)",
            "疲労がマイナスに作用（-0.030） / fatigue weighs against it (-0.030)",
        ],
    }
    ja, en = eb.template_rationale("content", target)
    assert "眠気が推薦に寄与" in ja and "疲労がマイナス" in ja
    assert "drowsiness supports" in en and "fatigue weighs against" in en
    assert " / " not in ja and " / " not in en


def test_template_rationale_missing_rationale_is_safe():
    assert eb.template_rationale("content", {"item_id": "x"}) == ["", ""]


# ── response usability (echo detection) ──────────────────────────────────────

def test_response_is_usable_accepts_real_explanation():
    prompt = eb.build_explanation_prompt("service", _service_target(), {"trigger_purpose": "fatigue"})
    assert eb.response_is_usable(["眠気が高いため休憩を提案します。", "High drowsiness drives this."], prompt) is True


def test_response_is_usable_rejects_empty():
    prompt = eb.build_explanation_prompt("service", _service_target(), {"trigger_purpose": "fatigue"})
    assert eb.response_is_usable(["", "  "], prompt) is False


def test_response_is_usable_rejects_a_japanese_line_that_is_not_japanese():
    """The failure this exists for: asked for "Japanese, not English", qwen2.5:3b
    answered in KOREAN — on the greedy attempt AND both re-rolls — and every
    other check here passed it, because Hangul is neither empty, nor the format
    example, nor an echo of the facts. The panel therefore showed Korean under a
    「日本語」 heading. Verbatim output from that live run.
    """
    prompt = eb.build_explanation_prompt("service", _service_target(), {"trigger_purpose": "fatigue"})
    korean = "피로와 지루함이 높아진 탓에, 몰입 방지 프로포시온의 임계치를 넘겼습니다."
    english_en = "The high levels of fatigue pushed the threshold, firing a proposal."
    assert eb.response_is_usable([korean, english_en], prompt) is False
    # Latin-only in the JA slot is the same failure wearing a different hat.
    assert eb.response_is_usable(["Fatigue drove the firing.", english_en], prompt) is False
    # Kana, kanji, and a mixed line all count as Japanese.
    for ja in ("つかれがたまっています。", "疲労蓄積により発火。", "疲労がたまり、単調な走行が続いたため発火しました。"):
        assert eb.response_is_usable([ja, english_en], prompt) is True


def test_reason_prompt_names_the_japanese_SCRIPT_not_just_the_language():
    """Naming the language alone ("write Japanese") was not enough for a 3B
    model — naming the script and showing a specimen is what actually produced
    Japanese instead of Korean, so it must stay in the prompt.
    """
    prompt = eb.build_explanation_prompt("service", _service_target(), {"trigger_purpose": "fatigue"})
    system = prompt.messages[0].content
    assert "hiragana" in system and "katakana" in system and "kanji" in system
    assert "Hangul" in system


def test_response_is_usable_rejects_verbatim_prompt_echo():
    # A weak model that echoes the fact lines it was given (reproduced live with
    # qwen2.5:0.5b) must be treated as unusable → template fallback.
    prompt = eb.build_explanation_prompt(
        "service", _service_target(), {"trigger_purpose": "rest_recommended"}
    )
    user_lines = [ln.strip() for ln in prompt.messages[1].content.splitlines() if ln.strip()]
    echoed = [user_lines[0], user_lines[1]]  # two verbatim fact lines
    assert eb.response_is_usable(echoed, prompt) is False


def test_response_is_usable_rejects_verbatim_format_example_parroting():
    # A weak model that copies the format example instead of grounding in facts
    # must fall back to the template (reproduced live with qwen2.5:0.5b).
    prompt = eb.build_explanation_prompt("service", _service_target(), {"trigger_purpose": "fatigue"})
    assert eb.response_is_usable([eb._EXAMPLE_JA, eb._EXAMPLE_EN], prompt) is False
    # even a single parroted example line is enough to reject
    assert eb.response_is_usable(["本物の日本語の理由。", eb._EXAMPLE_EN], prompt) is False


def test_response_is_usable_accepts_partial_echo_with_real_line():
    # Unchanged intent — ONE echoed line must not condemn a response whose other
    # line is a real explanation. The echo moved from slot 0 to slot 1 because
    # the fact lines are English and slot 0 is the JAPANESE slot: with the
    # language guard added, an English line there is now its own (correct)
    # rejection, which would have made this test pass for the wrong reason.
    prompt = eb.build_explanation_prompt("service", _service_target(), {"trigger_purpose": "fatigue"})
    user_line = prompt.messages[1].content.splitlines()[0].strip()
    assert eb.response_is_usable(["本物の日本語の理由です。", user_line], prompt) is True


# ── placeholder artifact stripping ───────────────────────────────────────────

def test_strip_placeholder_artifacts_removes_trailing_paren_token():
    # the exact coastal-cruise artifact seen live with 3b
    assert (
        eb.strip_placeholder_artifacts("The choice was made based on the high acceptance rate of this song proposal (factor A).")
        == "The choice was made based on the high acceptance rate of this song proposal."
    )


def test_strip_placeholder_artifacts_removes_bracketed_japanese_token():
    assert eb.strip_placeholder_artifacts("推し一致「要因A」が寄与しました。") == "推し一致が寄与しました。"


def test_strip_placeholder_artifacts_handles_factor_b_and_both():
    assert eb.strip_placeholder_artifacts("Drowsiness (factor A) and fatigue (factor B) drove it.") == "Drowsiness and fatigue drove it."


def test_strip_placeholder_artifacts_does_not_touch_real_words():
    # "factor above" / "a bad factor" must be preserved (the a/b must stand alone)
    assert eb.strip_placeholder_artifacts("The factor above mattered most.") == "The factor above mattered most."
    assert eb.strip_placeholder_artifacts("眠気が最も強く働きました。") == "眠気が最も強く働きました。"


def test_strip_placeholder_artifacts_empty_and_noop():
    assert eb.strip_placeholder_artifacts("") == ""
    assert eb.strip_placeholder_artifacts("A clean grounded reason.") == "A clean grounded reason."


# ── prompt hash ──────────────────────────────────────────────────────────────

def test_prompt_hash_is_stable_and_sensitive():
    p1 = eb.build_explanation_prompt("service", _service_target(), {"trigger_purpose": "fatigue"})
    p2 = eb.build_explanation_prompt("service", _service_target(), {"trigger_purpose": "fatigue"})
    p3 = eb.build_explanation_prompt("service", _service_target(), {"trigger_purpose": "boredom"})
    assert eb.prompt_hash(p1) == eb.prompt_hash(p2)
    assert eb.prompt_hash(p1) != eb.prompt_hash(p3)
