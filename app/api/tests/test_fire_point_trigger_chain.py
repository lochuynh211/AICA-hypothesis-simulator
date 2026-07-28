"""A quickview fire carries the trigger chain recorded at that tick.

Without this the review's Trigger stage is unavailable on the pre-Play
quickview — the path a reviewer actually uses.
"""
from __future__ import annotations

from aica_api.models.run import FirePoint


def test_fire_point_accepts_the_trigger_chain():
    fire = FirePoint(
        category="rest_required", strength="clear", tick=42, time_min=63.0,
        feature_contributions={"rest_required": {"score": 0.72, "clamped": False, "rows": [], "gates": []}},
        criteria={"threshold_suggest": 0.70},
    )
    assert fire.feature_contributions["rest_required"]["score"] == 0.72
    assert fire.criteria["threshold_suggest"] == 0.70


def test_fire_point_defaults_keep_old_previews_parseable():
    fire = FirePoint(category="rest_required", strength=None, tick=1, time_min=1.0)
    assert fire.feature_contributions == {}
    assert fire.criteria == {}
