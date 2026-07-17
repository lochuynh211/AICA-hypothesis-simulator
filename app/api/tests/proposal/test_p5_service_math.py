"""TDD: P5 Unit B T010-T011 - the numerically-critical core.

T010: WeightResolver reproduces the doc's §6.2 normalized-weight table for
all 4 purposes (Sigma w = 1 within 1e-12; each cell matches the doc's
published 6-decimal figure).

T011: the §10 worked example (`humming_karaoke` under
inattentive_driving_prevention_recovery / active_driving_content) scores
+0.772349 and ranks above `music_playlist`.

See `proposal_contracts/fixtures/service/worked-example.golden.md` for the
full e/a/r/w/k reconciliation table and the documented ~1.4e-6 doc-rounding
finding behind this file's `_SCORE_TOLERANCE`.
"""
from __future__ import annotations

import copy

import pytest

from tests.proposal.conftest import (
    build_service_context,
    load_service_manifest,
    load_worked_example_context,
    service_manifest_hyperparameters,
)

# The doc's own §10 worked-example headline total (+0.772349) does not
# reproduce to 1e-12 from the doc's OWN fully-specified inputs (verified via
# independent exact-rational recomputation, see the golden note) - the true
# value is +0.7723503548287566..., a ~1.4e-6 doc rounding artifact. Per-row
# w_i/k_i values DO match the doc's published 6-decimal table exactly.
_ROW_TOLERANCE = 6e-7
_SCORE_TOLERANCE = 2e-6

_PURPOSES = [
    "rest_recommended",
    "inattentive_driving_prevention_recovery",
    "route_music",
    "child_passenger_experience",
]

# doc §6.2 "Resulting normalized weights" table, verbatim.
_DOC_WEIGHTS = {
    "rest_recommended": {
        "drowsiness_level": 0.256538, "fatigue_level": 0.209895, "traffic_state": 0.051308,
        "road_type": 0.051308, "night_state": 0.051308, "monotony_level": 0.102615,
        "route_tags": 0.027486, "destination_tags": 0.022489, "child_present": 0.032484,
        "multiple_passengers": 0.017491, "oshi_registered": 0.008746, "oshi_mode": 0.016242,
        "service_recency_state": 0.007996, "service_usage_level": 0.022489,
        "scene_service_usage_level": 0.039980, "service_proposal_acceptance_rate": 0.016658,
        "service_recovery_rate": 0.064968,
    },
    "inattentive_driving_prevention_recovery": {
        "drowsiness_level": 0.254551, "fatigue_level": 0.208269, "traffic_state": 0.060475,
        "road_type": 0.060475, "night_state": 0.060475, "monotony_level": 0.120950,
        "route_tags": 0.019091, "destination_tags": 0.015620, "child_present": 0.025571,
        "multiple_passengers": 0.013769, "oshi_registered": 0.006479, "oshi_mode": 0.012033,
        "service_recency_state": 0.007405, "service_usage_level": 0.020827,
        "scene_service_usage_level": 0.040728, "service_proposal_acceptance_rate": 0.015427,
        "service_recovery_rate": 0.057853,
    },
    "route_music": {
        "drowsiness_level": 0.233546, "fatigue_level": 0.191083, "traffic_state": 0.049540,
        "road_type": 0.049540, "night_state": 0.049540, "monotony_level": 0.099080,
        "route_tags": 0.058386, "destination_tags": 0.047771, "child_present": 0.027601,
        "multiple_passengers": 0.014862, "oshi_registered": 0.010218, "oshi_mode": 0.018976,
        "service_recency_state": 0.008493, "service_usage_level": 0.023885,
        "scene_service_usage_level": 0.046709, "service_proposal_acceptance_rate": 0.017693,
        "service_recovery_rate": 0.053079,
    },
    "child_passenger_experience": {
        "drowsiness_level": 0.234729, "fatigue_level": 0.192051, "traffic_state": 0.049791,
        "road_type": 0.049791, "night_state": 0.049791, "monotony_level": 0.099582,
        "route_tags": 0.022006, "destination_tags": 0.018005, "child_present": 0.069352,
        "multiple_passengers": 0.037343, "oshi_registered": 0.007002, "oshi_mode": 0.013003,
        "service_recency_state": 0.008536, "service_usage_level": 0.026674,
        "scene_service_usage_level": 0.051214, "service_proposal_acceptance_rate": 0.017783,
        "service_recovery_rate": 0.053348,
    },
}


@pytest.mark.parametrize("purpose", _PURPOSES)
def test_weight_resolution(service_selector, service_hyperparameters, purpose):
    weights = service_selector.resolve_weights(service_hyperparameters, purpose)

    total = sum(e["effective_weight"] for e in weights.values())
    assert total == pytest.approx(1.0, abs=1e-12)

    for feature_id, expected in _DOC_WEIGHTS[purpose].items():
        actual = weights[feature_id]["effective_weight"]
        assert actual == pytest.approx(expected, abs=_ROW_TOLERANCE), (
            f"{purpose}/{feature_id}: expected {expected}, got {actual}"
        )


def test_sibling_scale_invariance(service_hyperparameters, service_selector):
    """Scaling every sibling weight in a group by a constant changes nothing
    (SS16 required test / data-model.md SS6.1 'ratios, not absolutes')."""
    import copy

    base = service_hyperparameters
    scaled = copy.deepcopy(base)
    for cat_def in scaled["hierarchy_weights"].values():
        cat_def["share"] = cat_def["share"] * 10.0
        for sub in cat_def["subgroups"].values():
            sub["share"] = sub["share"] * 3.0
            for leaf_def in sub["leaves"].values():
                leaf_def["share"] = leaf_def["share"] * 7.0

    w_base = service_selector.resolve_weights(base, "inattentive_driving_prevention_recovery")
    w_scaled = service_selector.resolve_weights(scaled, "inattentive_driving_prevention_recovery")

    for fid in w_base:
        assert w_scaled[fid]["effective_weight"] == pytest.approx(
            w_base[fid]["effective_weight"], abs=1e-12
        )


def test_worked_example(service_selector):
    context = load_worked_example_context()
    out = service_selector.evaluate(context)

    assert out["decision_type"] == "ranked_candidates"
    by_id = {c["candidate_id"]: c for c in out["ranked_candidates"]}
    assert "humming_karaoke" in by_id

    humming = by_id["humming_karaoke"]
    assert humming["score"] == pytest.approx(0.772349, abs=_SCORE_TOLERANCE)

    # per-feature k_i reconciliation against the doc's §10 table.
    doc_k = {
        "drowsiness_level": 0.203641, "fatigue_level": 0.124961, "traffic_state": 0.060475,
        "road_type": 0.060475, "night_state": 0.060475, "monotony_level": 0.090713,
        "route_tags": 0.019091, "destination_tags": 0.007810, "child_present": 0.025571,
        "multiple_passengers": 0.013769, "oshi_registered": 0.003240, "oshi_mode": 0.006017,
        "service_recency_state": 0.003703, "service_usage_level": 0.020827,
        "scene_service_usage_level": 0.040728, "service_proposal_acceptance_rate": 0.007714,
        "service_recovery_rate": 0.023141,
    }
    contributions = {c["feature_id"]: c for c in humming["feature_contributions"]}
    assert set(contributions) == set(doc_k)
    for fid, expected_k in doc_k.items():
        assert contributions[fid]["contribution"] == pytest.approx(expected_k, abs=_ROW_TOLERANCE), fid

    # music_playlist scores strictly lower - humming dominates on this snapshot
    # (doc §10: "Humming therefore ranks well above playlist here").
    if "music_playlist" in by_id:
        assert by_id["music_playlist"]["score"] < humming["score"]

    ranks = [c["candidate_id"] for c in out["ranked_candidates"]]
    assert ranks[0] == "humming_karaoke"


def test_worked_example_music_playlist_in_expected_neighborhood(service_selector):
    """music_playlist's score is not doc-pinned (only the ordering is, see
    the golden note) but should land in the ballpark the doc's narrative
    describes ("approx +0.132"). music_playlist ranks below top_k=3 among
    all 6 driving candidates on this snapshot (the four activation services
    dominate) - narrow the eligible set to the two candidates under
    comparison so both appear in the output."""
    context = load_worked_example_context()
    context["allowed_service_ids"] = ["music_playlist", "humming_karaoke"]
    context["eligible_candidates"] = [{"candidate_id": "music_playlist"}, {"candidate_id": "humming_karaoke"}]
    out = service_selector.evaluate(context)
    by_id = {c["candidate_id"]: c for c in out["ranked_candidates"]}
    assert by_id["music_playlist"]["score"] == pytest.approx(0.132, abs=0.03)
    assert by_id["humming_karaoke"]["score"] > by_id["music_playlist"]["score"]


def test_manifest_loads_and_matches_algorithm_feature_order(service_selector):
    manifest = load_service_manifest()
    assert manifest["id"] == "aica_transparent_service_selector_v1"
    hp = service_manifest_hyperparameters()
    weights = service_selector.resolve_weights(hp, "rest_recommended")
    assert set(weights) == set(service_selector.FEATURE_ORDER)


# ---------------------------------------------------------------------------
# T020 (US2) - situation/preference/history subtotals reconcile to the
# unclamped Sigma k_i (doc SS9 step 6 / data-model.md SS3), and are never a
# sort key.
# ---------------------------------------------------------------------------

_NEGATIVE_FIT_SITUATION = {
    "drowsiness_level": 90, "fatigue_level": 90, "traffic_state": "congested",
    "road_type": "local", "night_state": "night", "monotony_level": 90,
    "route_tags": [], "destination_tags": [], "child_present": False,
    "multiple_passengers": False,
}


def _negative_fit_context():
    """`radio_style` under oshi-off (SS16 'low/negative fit still ranked'
    fixture, mirrored from `test_p5_eligibility_ranking.py`): neutral on
    every non-oshi feature and OPPOSED on oshi (mode off -> -1.0 for radio),
    so its unclamped sum is negative."""
    return build_service_context(
        allowed_service_ids=["radio_style"],
        eligible_candidates=[{"candidate_id": "radio_style"}],
        feature_snapshot={
            "situation": dict(_NEGATIVE_FIT_SITUATION),
            "preference": {"oshi_registered": True, "oshi_mode": "off"},
            "history": {},
            "additional_proposed": {},
        },
    )


@pytest.mark.parametrize(
    "context_factory",
    [load_worked_example_context, _negative_fit_context],
    ids=["worked_example_positive_fit", "radio_style_negative_fit"],
)
def test_subtotals_reconcile(service_selector, context_factory):
    context = context_factory()
    out = service_selector.evaluate(context)
    assert out["decision_type"] == "ranked_candidates"
    for candidate in out["ranked_candidates"]:
        unclamped_sum = sum(c["contribution"] for c in candidate["feature_contributions"])
        subtotal_sum = (
            candidate["situation_fit"] + candidate["preference_fit"] + candidate["history_fit"]
        )
        assert subtotal_sum == pytest.approx(unclamped_sum, abs=1e-12), candidate["candidate_id"]


def test_negative_fit_candidate_has_negative_unclamped_sum(service_selector):
    """Sanity check that `_negative_fit_context` actually exercises a
    negative-fit candidate (not merely a low-positive one), so T020's second
    parametrization is a real negative case, not a degenerate positive one."""
    out = service_selector.evaluate(_negative_fit_context())
    candidate = out["ranked_candidates"][0]
    unclamped_sum = sum(c["contribution"] for c in candidate["feature_contributions"])
    assert unclamped_sum < 0.0


def test_subtotals_are_not_a_sort_key(service_selector):
    """Construct two candidates where `situation_fit(A) > situation_fit(B)`
    but `score(A) < score(B)` (via a custom hierarchy that de-emphasizes
    Situation and emphasizes Preference/History), and confirm the ranking
    follows `score`, NOT `situation_fit` (doc SS9 step 6: 'explanatory only,
    never rescaled, never a sort key')."""
    hp = copy.deepcopy(service_manifest_hyperparameters())
    hw = hp["hierarchy_weights"]
    hw["Situation"]["share"] = 0.01
    hw["Preference"]["share"] = 0.90
    hw["History"]["share"] = 0.09

    situation = {
        "drowsiness_level": 100, "fatigue_level": 100, "traffic_state": "congested",
        "road_type": "highway", "night_state": "night", "monotony_level": 100,
        "route_tags": [], "destination_tags": [], "child_present": True,
        "multiple_passengers": True,
    }
    feature_snapshot = {
        "situation": situation,
        "preference": {
            "oshi_registered": False,
            "oshi_mode": "off",
            "service_recency_state": {"music_playlist": "never", "humming_karaoke": "recent"},
            "service_usage_level": {"music_playlist": "high", "humming_karaoke": "never"},
            "scene_service_usage_level": {},
        },
        "history": {
            "service_proposal_acceptance_rate": {"music_playlist": 100, "humming_karaoke": 0},
            "service_recovery_rate": {"music_playlist": 100, "humming_karaoke": 0},
        },
        "additional_proposed": {},
    }
    context = build_service_context(
        allowed_service_ids=["music_playlist", "humming_karaoke"],
        feature_snapshot=feature_snapshot,
        hyperparameters=hp,
    )
    out = service_selector.evaluate(context)
    by_id = {c["candidate_id"]: c for c in out["ranked_candidates"]}

    # humming_karaoke's situation responses are all +1.0 (SS5.2.1 activation
    # services) vs music_playlist's ~0 -> higher situation_fit for humming...
    assert by_id["humming_karaoke"]["situation_fit"] > by_id["music_playlist"]["situation_fit"]
    # ...but under this weighting, Preference/History dominate the total and
    # music_playlist's score wins -> the ranking is NOT sorted by situation_fit.
    assert by_id["music_playlist"]["score"] > by_id["humming_karaoke"]["score"]
    assert out["ranked_candidates"][0]["candidate_id"] == "music_playlist"


# ---------------------------------------------------------------------------
# T021 (US2) - the SS6.4 continuous default dominance invariant.
# ---------------------------------------------------------------------------

# doc SS6.4 table, verbatim (safety_share == W_D).
_DOC_DOMINANCE = {
    "rest_recommended": {"w_d": 0.787939, "w_l": 0.212061, "required_gap": 0.538266},
    "inattentive_driving_prevention_recovery": {"w_d": 0.823048, "w_l": 0.176952, "required_gap": 0.429991},
    "route_music": {"w_d": 0.725407, "w_l": 0.274593, "required_gap": 0.757073},
    "child_passenger_experience": {"w_d": 0.729083, "w_l": 0.270917, "required_gap": 0.743171},
}


@pytest.mark.parametrize("purpose", _PURPOSES)
def test_dominance_invariant_built_in_purposes(service_selector, service_hyperparameters, service_parameters, purpose):
    weights = service_selector.resolve_weights(service_hyperparameters, purpose)
    dominance = service_selector.compute_dominance(weights, service_hyperparameters, service_parameters)

    assert dominance["status"] == "default_dominance_preserved"
    expected = _DOC_DOMINANCE[purpose]
    assert dominance["w_d"] == pytest.approx(expected["w_d"], abs=6e-7)
    assert dominance["w_l"] == pytest.approx(expected["w_l"], abs=6e-7)
    assert dominance["required_gap"] == pytest.approx(expected["required_gap"], abs=6e-7)
    assert dominance["safety_share"] == pytest.approx(expected["w_d"], abs=6e-7)
    # W_D * material_safety_gap(1.00) > 2 * W_L for every built-in purpose.
    assert dominance["w_d"] * dominance["material_safety_gap"] > 2.0 * dominance["w_l"]


def test_dominance_adversarial_pair_dominant_gap_one_keeps_higher_safety_candidate_first(
    service_selector, service_hyperparameters,
):
    """P(A)-P(B) == material_safety_gap(1.00) exactly (A's D-set responses
    all +1.0, B's all 0.0) and the L-set is maximally reversed AGAINST A
    (Q(A)=-1, Q(B)=+1, the doc's worst case 'Q(A)-Q(B) = -2'). Even so, A
    (the higher-safety candidate) must still score above B, because
    `required_gap` (~0.43 for purpose (2)) is well under the configured
    `material_safety_gap` (1.00) -- doc SS6.4."""
    weights = service_selector.resolve_weights(
        service_hyperparameters, "inattentive_driving_prevention_recovery"
    )
    d_subgroups = {"driver_state", "driving_environment", "recovery"}

    r_a = {fid: (1.0 if e["subgroup"] in d_subgroups else -1.0) for fid, e in weights.items()}
    r_b = {fid: (0.0 if e["subgroup"] in d_subgroups else 1.0) for fid, e in weights.items()}

    def unclamped_score(r):
        return sum(weights[fid]["effective_weight"] * r[fid] for fid in weights)

    score_a = max(-1.0, min(1.0, unclamped_score(r_a)))
    score_b = max(-1.0, min(1.0, unclamped_score(r_b)))
    assert score_a > score_b


def test_dominance_invariant_violating_custom_weights_still_evaluates(
    service_selector, service_hyperparameters, service_parameters,
):
    """A customer profile that de-emphasizes Situation enough to break the
    invariant is still SCORED (never blocked) but reports
    `dominance_not_guaranteed` + the `required_gap` that would restore it
    (doc SS6.4: 'it never silently alters weights or ranks')."""
    hp = copy.deepcopy(service_hyperparameters)
    hp["hierarchy_weights"]["Situation"]["share"] = 0.15  # verified violating: W_D*1.00 < 2*W_L
    weights = service_selector.resolve_weights(hp, "inattentive_driving_prevention_recovery")
    dominance = service_selector.compute_dominance(weights, hp, service_parameters)

    assert dominance["status"] == "dominance_not_guaranteed"
    assert dominance["w_d"] * dominance["material_safety_gap"] <= 2.0 * dominance["w_l"]
    assert dominance["required_gap"] > dominance["material_safety_gap"]

    # The full evaluate() pipeline still produces a real ranking, not a block.
    context = load_worked_example_context(hyperparameters=hp)
    out = service_selector.evaluate(context)
    assert out["decision_type"] == "ranked_candidates"
    assert out["dominance"]["status"] == "dominance_not_guaranteed"
    assert out["ranked_candidates"][0]["dominance"]["status"] == "dominance_not_guaranteed"


# ---------------------------------------------------------------------------
# T026/T027/T028 (US3) - editability: purpose-multiplier reorder, sibling
# scale invariance (T027a, ABOVE, pre-existing), response-coefficient
# overrides, and both entered + resolved config recorded in evidence.
# ---------------------------------------------------------------------------


def _music_vs_humming_context(purpose: str) -> dict:
    """Same raw worked-example snapshot and response profiles, narrowed to
    the two candidates the doc §10 last paragraph contrasts, purpose varied."""
    context = load_worked_example_context()
    context["trigger_purpose"] = purpose
    context["allowed_service_ids"] = ["music_playlist", "humming_karaoke"]
    context["eligible_candidates"] = [{"candidate_id": "music_playlist"}, {"candidate_id": "humming_karaoke"}]
    return context


def test_purpose_multiplier_reorder(service_selector):
    """doc §10 last paragraph / §11 contrast #12: switching `trigger_purpose`
    from `inattentive_driving_prevention_recovery` to `route_music` on the
    SAME raw snapshot and response profiles raises the route/destination
    weight (§6.2 multiplier profile: route_context multiplier 0.75 -> 2.0)
    and narrows the music_playlist-vs-humming_karaoke gap -- doc: "narrowing
    the gap on the same raw snapshot and response profiles"."""
    hp = service_manifest_hyperparameters()

    w_inattentive = service_selector.resolve_weights(hp, "inattentive_driving_prevention_recovery")
    w_route_music = service_selector.resolve_weights(hp, "route_music")

    route_dest_inattentive = (
        w_inattentive["route_tags"]["effective_weight"] + w_inattentive["destination_tags"]["effective_weight"]
    )
    route_dest_route_music = (
        w_route_music["route_tags"]["effective_weight"] + w_route_music["destination_tags"]["effective_weight"]
    )
    # the doc's own §6.2 route_context multiplier rises 0.75 -> 2.0 for this purpose switch.
    assert route_dest_route_music > route_dest_inattentive

    def _gap(purpose: str) -> float:
        out = service_selector.evaluate(_music_vs_humming_context(purpose))
        by_id = {c["candidate_id"]: c for c in out["ranked_candidates"]}
        return by_id["humming_karaoke"]["score"] - by_id["music_playlist"]["score"]

    gap_inattentive = _gap("inattentive_driving_prevention_recovery")
    gap_route_music = _gap("route_music")

    # humming still ranks above music_playlist (every eligible candidate is
    # always ranked, never suppressed -- doc §11), but the gap narrows.
    assert gap_route_music > 0.0
    assert gap_route_music < gap_inattentive


def test_editable_response_override(service_selector):
    """§4.2/§12: a customer response-coefficient override on one
    candidate x feature cell (finite, in [-1,+1]) changes that candidate's
    score, and the evidence row RETAINS the original `response_provenance`
    while ADDING `customer_override` with the changed value (§4.2:
    "Customer edits retain the original provenance and add
    `customer_override` with the changed value")."""

    def _music_playlist_row(hp: dict) -> tuple[dict, dict]:
        context = load_worked_example_context(hyperparameters=hp)
        context["allowed_service_ids"] = ["music_playlist"]
        context["eligible_candidates"] = [{"candidate_id": "music_playlist"}]
        out = service_selector.evaluate(context)
        candidate = out["ranked_candidates"][0]
        row = next(c for c in candidate["feature_contributions"] if c["feature_id"] == "drowsiness_level")
        return candidate, row

    hp_base = service_manifest_hyperparameters()
    # music_playlist/drowsiness_level is `neutral_source_silent` @ 0.0 by
    # default (package.json) -- override it to a strongly-supportive +0.6.
    hp_override = copy.deepcopy(hp_base)
    hp_override["response_coefficient_overrides"] = {"music_playlist": {"drowsiness_level": 0.6}}

    candidate_base, row_base = _music_playlist_row(hp_base)
    candidate_override, row_override = _music_playlist_row(hp_override)

    assert row_base["response_coefficient"] == pytest.approx(0.0)
    assert row_base.get("customer_override") is None
    assert row_base["response_provenance"] == "neutral_source_silent"

    assert row_override["response_coefficient"] == pytest.approx(0.6)
    assert row_override.get("customer_override") == pytest.approx(0.6)
    # original provenance is RETAINED, not replaced.
    assert row_override["response_provenance"] == "neutral_source_silent"

    assert candidate_override["score"] > candidate_base["score"]


@pytest.mark.parametrize("bad_value", [1.5, -1.5, float("nan"), float("inf"), float("-inf")])
def test_override_rejected(service_selector, bad_value):
    """§12: out-of-range/NaN/inf response-coefficient overrides are REJECTED
    as invalid configuration -- never clamped into range."""
    hp = copy.deepcopy(service_manifest_hyperparameters())
    hp["response_coefficient_overrides"] = {"music_playlist": {"drowsiness_level": bad_value}}
    context = load_worked_example_context(hyperparameters=hp)
    context["allowed_service_ids"] = ["music_playlist"]
    context["eligible_candidates"] = [{"candidate_id": "music_playlist"}]

    with pytest.raises(Exception):
        service_selector.evaluate(context)


def test_entered_and_resolved_config_both_recorded(service_selector, service_hyperparameters):
    """T028: `evaluate()` records BOTH the reviewer-entered hierarchy
    weights/purpose multipliers (ratios, as configured) AND the
    Sigma=1-resolved `effective_weights`, and recomputes `dominance` for the
    resolved config actually used (doc §12 'the resolved normalized values
    are recorded beside the customer-entered ones' / §6.4 'recomputed after
    every config resolve')."""
    hp = copy.deepcopy(service_hyperparameters)
    hp["hierarchy_weights"]["Situation"]["subgroups"]["route_context"]["share"] *= 3.0

    context = load_worked_example_context(hyperparameters=hp)
    out = service_selector.evaluate(context)

    resolved = out["resolved_config_versions"]
    assert resolved["entered_hierarchy_weights"] == hp["hierarchy_weights"]
    assert resolved["entered_purpose_multipliers"] == hp["purpose_multipliers"]

    effective = out["effective_weights"]
    assert sum(effective.values()) == pytest.approx(1.0, abs=1e-12)

    # dominance is recomputed for the resolved weights that were actually
    # used for this call, not some other/default config.
    weights = service_selector.resolve_weights(hp, context["trigger_purpose"])
    expected_dominance = service_selector.compute_dominance(weights, hp, context["parameters"])
    assert out["dominance"] == expected_dominance
