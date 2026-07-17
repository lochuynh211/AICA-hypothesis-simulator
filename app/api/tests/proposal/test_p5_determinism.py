"""TDD: P5 Polish T034 - determinism + canonical-serialization guard for
`aica_transparent_service_selector_v1` (algorithm doc §14 "Reproducibility":
"Identical inputs + versions reproduce a semantically identical result
(1e-12); same-runtime canonical replay is byte-equivalent"; §16 required
tests reiterate the same 1e-12 bound).

Mirrors the content-selector's `test_content_selector_determinism.py` style:
(a) two independent `evaluate()` calls on the SAME frozen input+config are
byte-equal under canonical (sort_keys) JSON serialization, across several
distinct contexts (worked example, a no_proposal/empty-eligible case, and a
customer-edited-config case); (b) every float anywhere in the output is
within `1e-12` of itself across repeated calls (redundant with (a) but
pins the EXPLICIT numeric-tolerance requirement, not just byte identity);
(c) `-0.0` never appears anywhere in the output (§3.4 `_norm0` contract).
"""
from __future__ import annotations

import copy
import json
import math

import pytest

from tests.proposal.conftest import (
    build_service_context,
    load_worked_example_context,
    service_manifest_hyperparameters,
)


def _canonical(obj) -> str:
    """Byte-equality proxy: canonical (sorted-key) JSON serialization,
    exactly as a same-runtime canonical replay would compare two logged
    evidence blocks."""
    return json.dumps(obj, sort_keys=True, ensure_ascii=False)


def _walk_floats(obj):
    if isinstance(obj, dict):
        for v in obj.values():
            yield from _walk_floats(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk_floats(v)
    elif isinstance(obj, float):
        yield obj


def _no_proposal_context() -> dict:
    return build_service_context(
        trigger_purpose="inattentive_driving_prevention_recovery",
        lifecycle_stage="active_driving_content",
        allowed_service_ids=["music_playlist"],
        eligible_candidates=[],
        feature_snapshot={"situation": {"drowsiness_level": 50}},
    )


def _edited_config_context() -> dict:
    hp = copy.deepcopy(service_manifest_hyperparameters())
    hp["hierarchy_weights"]["Situation"]["subgroups"]["route_context"]["share"] *= 2.5
    hp["response_coefficient_overrides"] = {"music_playlist": {"drowsiness_level": 0.4}}
    return load_worked_example_context(hyperparameters=hp)


_CONTEXTS = {
    "worked_example": load_worked_example_context,
    "no_proposal": _no_proposal_context,
    "edited_config": _edited_config_context,
}


# ---------------------------------------------------------------------------
# (a) identical frozen input+config -> byte-equal canonical serialization
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("context_name", list(_CONTEXTS))
def test_repeated_evaluate_is_byte_equal(service_selector, context_name):
    build = _CONTEXTS[context_name]
    a = service_selector.evaluate(build())
    b = service_selector.evaluate(build())
    assert _canonical(a) == _canonical(b)


def test_many_repeated_calls_all_byte_equal(service_selector):
    """Not just two calls - N repeated calls on the identical frozen context
    all serialize identically (guards against any hidden iteration-order or
    hash-seed-dependent nondeterminism across the run)."""
    context = load_worked_example_context()
    results = [service_selector.evaluate(context) for _ in range(8)]
    canonical_forms = {_canonical(r) for r in results}
    assert len(canonical_forms) == 1


# ---------------------------------------------------------------------------
# (b) explicit 1e-12 numeric-tolerance bound (doc §14/§16), not just byte
# identity - every float in the output matches to that precision.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("context_name", list(_CONTEXTS))
def test_repeated_evaluate_floats_match_within_1e12(service_selector, context_name):
    build = _CONTEXTS[context_name]
    a = service_selector.evaluate(build())
    b = service_selector.evaluate(build())

    floats_a = list(_walk_floats(a))
    floats_b = list(_walk_floats(b))
    assert len(floats_a) == len(floats_b)
    for fa, fb in zip(floats_a, floats_b):
        assert fa == pytest.approx(fb, abs=1e-12)


# ---------------------------------------------------------------------------
# (c) -0.0 never appears anywhere in the output (§3.4 `_norm0`).
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("context_name", list(_CONTEXTS))
def test_no_negative_zero_anywhere(service_selector, context_name):
    result = service_selector.evaluate(_CONTEXTS[context_name]())
    for v in _walk_floats(result):
        if v == 0.0:
            assert math.copysign(1.0, v) > 0.0, "found signed negative zero in output"


def test_negative_zero_input_evidence_serializes_as_plus_zero(service_selector):
    """A feature whose raw evidence computes to exactly -0.0 internally
    (e.g. an all-neutral world scored under a purpose/response combination
    that nets to zero) must still be reported as +0.0, never -0.0 - the
    doc's own `-0 -> +0` normalization contract (§14, T034 explicit case)."""
    # An all-absent feature_snapshot: every scalar feature is `missing`
    # (e=0), every direct feature is `missing_neutral` (e=0) -> every
    # candidate's unclamped sum is an exact 0.0 accumulated from repeated
    # `w * 0.0` additions, which in IEEE-754 float64 can legitimately land
    # on -0.0 depending on summation order - exactly the case _norm0 exists
    # to guard.
    context = build_service_context(
        trigger_purpose="inattentive_driving_prevention_recovery",
        lifecycle_stage="active_driving_content",
        allowed_service_ids=["music_playlist", "humming_karaoke", "radio_style"],
        feature_snapshot={},
    )
    result = service_selector.evaluate(context)
    for candidate in result["ranked_candidates"]:
        assert candidate["score"] == 0.0
        assert math.copysign(1.0, candidate["score"]) > 0.0
        for contribution in candidate["feature_contributions"]:
            if contribution["contribution"] == 0.0:
                assert math.copysign(1.0, contribution["contribution"]) > 0.0
