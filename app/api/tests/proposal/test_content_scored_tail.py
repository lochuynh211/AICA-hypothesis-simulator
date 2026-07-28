"""B2 — the content selector records the scored candidates it did NOT pick.

Without this, "why isn't song X in the plan?" is unanswerable and plan
positions below rank 1 have no real runner-up to be compared against.
"""
from __future__ import annotations

from tests.proposal.conftest import load_content_selector

CS = load_content_selector()
TAIL_CAP = 20


def _plan(context):
    out = CS.evaluate(context)
    assert out["decision_type"] == "complete_plan", out
    return out


def test_tail_holds_the_scored_but_unpicked_candidates(content_context_factory):
    plan = _plan(content_context_factory(song_count=12, plan_item_count=5))
    assert len(plan["scored_tail"]) == 7
    assert plan["tail_truncated"] is False

    picked = {i["item_id"] for i in plan["ordered_items"]}
    assert picked.isdisjoint({t["item_id"] for t in plan["scored_tail"]})


def test_tail_ranks_continue_the_plan_ordering(content_context_factory):
    plan = _plan(content_context_factory(song_count=12, plan_item_count=5))
    assert [t["rank"] for t in plan["scored_tail"]] == [6, 7, 8, 9, 10, 11, 12]


def test_tail_is_sorted_by_fit_descending(content_context_factory):
    plan = _plan(content_context_factory(song_count=12, plan_item_count=5))
    fits = [t["item_fit"] for t in plan["scored_tail"]]
    assert fits == sorted(fits, reverse=True)


def test_tail_carries_full_contributions(content_context_factory):
    plan = _plan(content_context_factory(song_count=12, plan_item_count=5))
    first = plan["scored_tail"][0]
    assert first["feature_contributions"], "tail items need the same chain as picked items"
    keys = set(first["feature_contributions"][0])
    assert {"feature_id", "e_i", "a_i", "effective_weight", "contribution"} <= keys
    assert "leaf" not in keys      # same projection as ordered_items


def test_cut_margin_is_the_last_picked_minus_first_dropped(content_context_factory):
    plan = _plan(content_context_factory(song_count=12, plan_item_count=5))
    expected = plan["ordered_items"][-1]["item_fit"] - plan["scored_tail"][0]["item_fit"]
    assert plan["cut_margin"] == expected
    assert plan["cut_margin"] >= 0


def test_tail_is_capped_and_flagged(content_context_factory):
    plan = _plan(content_context_factory(song_count=40, plan_item_count=5))
    assert len(plan["scored_tail"]) == TAIL_CAP
    assert plan["tail_truncated"] is True


def test_no_tail_when_everything_was_picked(content_context_factory):
    plan = _plan(content_context_factory(song_count=5, plan_item_count=5))
    assert plan["scored_tail"] == []
    assert plan["cut_margin"] is None
    assert plan["tail_truncated"] is False


def test_model_accepts_and_defaults_the_new_fields():
    from aica_api.models.proposal.content_output import CompletePlan

    base = dict(
        decision_type="complete_plan", selected_service_id="music_playlist",
        requested_item_count=0, returned_item_count=0, ordered_items=[],
        mode={"service_id": "music_playlist", "mode_kind": "playlist",
              "chorus_only": None, "guide_vocal": None, "driving_lyrics": None,
              "fixed_segment_sec": None, "stopped_only": None, "simulated_queue": None},
        expected_duration_sec=0,
        lighting_configuration={"enabled": False, "cue_basis": None, "notes": None},
        approval_policy="explicit_opt_in", completion_rule="plan_exhausted",
        next_transition_policy="await_user", excluded_items=[],
        unused_available_features=[], missing_features=[], algorithm_provenance={},
    )
    # Absent → safe defaults, so pre-existing persisted evidence still parses.
    assert CompletePlan(**base).scored_tail == []
    assert CompletePlan(**base).cut_margin is None
    assert CompletePlan(**base).tail_truncated is False
