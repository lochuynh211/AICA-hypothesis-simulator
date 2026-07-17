"""Tests for the pure algorithm-config deep-merge (feature 018 — Proposal
Preset Test-Cases).

Covers (data-model.md §AlgorithmConfigOverrides,
``services/algorithm_config.py::merge_algorithm_config``):
  - deep-merge correctness (nested dict keys merge recursively; a non-dict
    override value replaces the default wholesale);
  - ``defaults`` is NEVER mutated (isolation — a fresh deep copy every call);
  - ``None``/``{}`` overrides pass through an unmodified copy of ``defaults``.
"""
from __future__ import annotations

import copy

from aica_api.services.algorithm_config import merge_algorithm_config

# ---------------------------------------------------------------------------
# None / empty overrides -> unmodified deep copy of defaults
# ---------------------------------------------------------------------------


def test_none_override_returns_defaults_unchanged():
    defaults = {"a": 1, "nested": {"x": 1, "y": 2}}
    result = merge_algorithm_config(defaults, None)
    assert result == defaults


def test_empty_dict_override_returns_defaults_unchanged():
    defaults = {"a": 1, "nested": {"x": 1, "y": 2}}
    result = merge_algorithm_config(defaults, {})
    assert result == defaults


def test_none_override_result_is_a_copy_not_the_same_object():
    defaults = {"nested": {"x": 1}}
    result = merge_algorithm_config(defaults, None)
    assert result == defaults
    assert result is not defaults
    assert result["nested"] is not defaults["nested"]


# ---------------------------------------------------------------------------
# Deep-merge correctness
# ---------------------------------------------------------------------------


def test_top_level_scalar_override_replaces_value():
    defaults = {"directional_hypothesis": "soothe", "other_key": "unchanged"}
    result = merge_algorithm_config(defaults, {"directional_hypothesis": "keep_alert"})
    assert result == {"directional_hypothesis": "keep_alert", "other_key": "unchanged"}


def test_nested_dict_override_merges_recursively_leaving_siblings_untouched():
    defaults = {
        "hierarchy_weights": {
            "Preference": {
                "upro_oshi": {
                    "leaves": {
                        "age": {"feature_id": "age_band", "mask": 1, "share": 0.2},
                        "oshi": {"feature_id": "oshi_id", "mask": 1, "share": 0.3},
                    }
                }
            }
        },
        "norm_bounds": {"loudness_min": -60},
    }
    overrides = {
        "hierarchy_weights": {
            "Preference": {"upro_oshi": {"leaves": {"age": {"share": 0.35}}}}
        }
    }
    result = merge_algorithm_config(defaults, overrides)

    # The overridden leaf value changed...
    assert result["hierarchy_weights"]["Preference"]["upro_oshi"]["leaves"]["age"]["share"] == 0.35
    # ...but sibling keys inside the SAME nested dict survive untouched.
    assert result["hierarchy_weights"]["Preference"]["upro_oshi"]["leaves"]["age"]["feature_id"] == "age_band"
    assert result["hierarchy_weights"]["Preference"]["upro_oshi"]["leaves"]["age"]["mask"] == 1
    assert result["hierarchy_weights"]["Preference"]["upro_oshi"]["leaves"]["oshi"] == {
        "feature_id": "oshi_id", "mask": 1, "share": 0.3
    }
    # A sibling top-level key untouched by the override survives too.
    assert result["norm_bounds"] == {"loudness_min": -60}


def test_non_dict_override_value_replaces_default_wholesale_even_if_default_is_a_dict():
    defaults = {"norm_bounds": {"loudness_min": -60, "loudness_range": 40}}
    overrides = {"norm_bounds": "not-a-dict-anymore"}
    result = merge_algorithm_config(defaults, overrides)
    assert result["norm_bounds"] == "not-a-dict-anymore"


def test_list_override_value_replaces_default_list_wholesale():
    defaults = {"tags": ["a", "b", "c"]}
    overrides = {"tags": ["z"]}
    result = merge_algorithm_config(defaults, overrides)
    assert result["tags"] == ["z"]


def test_new_key_in_overrides_not_present_in_defaults_is_added():
    defaults = {"a": 1}
    overrides = {"b": 2}
    result = merge_algorithm_config(defaults, overrides)
    assert result == {"a": 1, "b": 2}


# ---------------------------------------------------------------------------
# defaults is never mutated (isolation)
# ---------------------------------------------------------------------------


def test_defaults_dict_never_mutated_by_a_deep_override():
    defaults = {
        "hierarchy_weights": {"Preference": {"upro_oshi": {"leaves": {"age": {"share": 0.2}}}}}
    }
    before = copy.deepcopy(defaults)

    merge_algorithm_config(defaults, {"hierarchy_weights": {"Preference": {"upro_oshi": {"leaves": {"age": {"share": 0.99}}}}}})

    assert defaults == before


def test_repeated_merges_against_the_same_defaults_do_not_accumulate_state():
    defaults = {"x": {"y": 1}}
    r1 = merge_algorithm_config(defaults, {"x": {"y": 2}})
    r2 = merge_algorithm_config(defaults, {"x": {"y": 3}})
    assert r1["x"]["y"] == 2
    assert r2["x"]["y"] == 3
    assert defaults == {"x": {"y": 1}}
