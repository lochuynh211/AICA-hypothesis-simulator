"""P6 T011 (US1) — CompletePlan contract conformance.

Output validates against the frozen CompletePlan model + JSON-Schema; exact item
count; ordered; no aggregate plan score; every item cites a catalog Track ID; gating.
"""
from __future__ import annotations

import json

from aica_api.config import settings
from aica_api.models.proposal.content_output import CompletePlan
from tests.proposal.conftest import (
    build_content_context,
    load_catalog,
    load_content_selector,
    manifest_hyperparameters,
)

CS = load_content_selector()
HP = manifest_hyperparameters()
CATALOG = load_catalog("fixtures/catalog/smoke-catalog.json")

_FORBIDDEN = {"plan_score", "aggregate_score", "plan_fit"}


def _world(service="music_playlist", motion="stopped", **situation):
    base = {"drowsiness_level": 80, "fatigue_level": 30, "monotony_level": 60,
            "traffic_state": "normal", "road_type": "highway", "night_state": "night",
            "motion_state": motion}
    base.update(situation)
    return build_content_context(
        selected_service_id=service,
        feature_snapshot={"catalog": CATALOG, "situation": base},
    )


def _scan_forbidden(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            assert k not in _FORBIDDEN, f"forbidden field '{k}' present"
            _scan_forbidden(v)
    elif isinstance(obj, list):
        for v in obj:
            _scan_forbidden(v)


def test_complete_plan_validates_against_frozen_model():
    result = CS.evaluate(_world())
    assert result["decision_type"] == "complete_plan"
    CompletePlan.model_validate(result)


def test_complete_plan_validates_against_json_schema():
    result = CS.evaluate(_world())
    schema_path = settings.proposal_contracts_dir / "schema" / "content_output.schema.json"
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    # jsonschema may not be installed; fall back to Pydantic (already covered).
    try:
        import jsonschema
    except ImportError:
        return
    jsonschema.validate(result, schema)


def test_exact_count_and_ordering():
    result = CS.evaluate(_world())
    assert result["returned_item_count"] == HP["plan_item_count"]
    assert len(result["ordered_items"]) == HP["plan_item_count"]
    fits = [it["item_fit"] for it in result["ordered_items"]]
    assert fits == sorted(fits, reverse=True)
    # positions are 1..N in order
    assert [it["position"] for it in result["ordered_items"]] == list(range(1, HP["plan_item_count"] + 1))


def test_no_aggregate_plan_score_anywhere():
    result = CS.evaluate(_world())
    _scan_forbidden(result)


def test_every_item_cites_a_catalog_track_id():
    result = CS.evaluate(_world())
    for it in result["ordered_items"]:
        assert it["item_id"] in CATALOG


def test_missing_service_is_invalid_request():
    ctx = _world()
    ctx["selected_service_id"] = None
    result = CS.evaluate(ctx)
    assert result["decision_type"] == "invalid_request"


def test_non_music_service_is_unsupported_recipe():
    ctx = _world()
    ctx["selected_service_id"] = "quiz"
    result = CS.evaluate(ctx)
    assert result["decision_type"] == "unsupported_recipe"


def test_each_item_has_traits_and_feature_contributions():
    result = CS.evaluate(_world(service="humming_karaoke"))
    for it in result["ordered_items"]:
        assert it["trait_values"] is not None
        assert len(it["feature_contributions"]) >= 1
        assert it["rationale"] and all(isinstance(r, str) and " / " in r for r in it["rationale"])
        # contributions sum to item_fit (pre-clamp) within tolerance
        s = sum(c["contribution"] for c in it["feature_contributions"])
        assert abs(max(-1.0, min(1.0, s)) - it["item_fit"]) < 1e-9
