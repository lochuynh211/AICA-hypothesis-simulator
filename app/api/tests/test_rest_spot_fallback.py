"""The rest-spot ceiling must never leave the driver with nothing to choose.

The ceiling rules out spots the driver cannot safely REACH. But once current
drowsiness is already at or above it, every projection fails — including one
with a zero-minute ETA — so without a fallback the whole list comes back
unreachable and the driver can only decline. That is the outcome the ceiling
exists to prevent, so the closest spot stays selectable.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from aica_api.main import app
from tests.helpers_recovery import create_paused_rest_run, create_paused_rest_run_multi_spots

client = TestClient(app)


def _spots(run_id: str, query: str = "") -> list[dict]:
    return client.get(f"/api/runs/{run_id}/rest-spots{query}").json()["rest_spots"]


def test_closest_spot_stays_selectable_when_none_would_be_reachable():
    """Ceiling below current drowsiness: the nearest spot survives, the rest do not."""
    run_id = create_paused_rest_run_multi_spots()
    spots = _spots(run_id, "?drowsiness_ceiling=1.0")

    assert len(spots) > 1, "fixture must return several spots for this to mean anything"
    assert spots[0]["reachable"] is True
    assert spots[0]["reachable_fallback"] is True

    # Only the nearest is rescued. A blanket approval would defeat the ceiling
    # entirely, which is the opposite failure.
    assert all(s["reachable"] is False for s in spots[1:])
    assert all("reachable_fallback" not in s for s in spots[1:])


def test_spots_are_ordered_so_the_rescued_one_is_genuinely_closest():
    """The fallback trusts list order; prove that order really is by distance."""
    spots = _spots(create_paused_rest_run_multi_spots(), "?drowsiness_ceiling=1.0")
    distances = [s["distance_km"] for s in spots]

    assert distances == sorted(distances), "rescue picks index 0, so order must be ascending"


def test_a_genuinely_reachable_run_is_left_untouched():
    """A normal run already has reachable spots — nothing is rescued, nothing flagged."""
    spots = _spots(create_paused_rest_run())

    assert any(s["reachable"] for s in spots)
    assert all("reachable_fallback" not in s for s in spots), (
        "no rescue should occur when the real computation already found one"
    )
