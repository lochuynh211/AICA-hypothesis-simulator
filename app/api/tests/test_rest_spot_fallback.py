"""Rest-spot reachability uses the SHARED 30-minute ETA actionability rule —
the SAME rule the NRI trigger uses (spec Sec79, Sec82, Sec195, Sec982) — read
from the run's own hyperparameters (`rest_spot_eta_filter_min`, default 30.0).
A spot is `reachable` iff its `eta_min <= eta_filter_min`; spots beyond the
filter stay VISIBLE in the picker (for transparency) but disabled.

The former projected-drowsiness reachability rule, `scenario.
rest_drowsiness_ceiling`, the `drowsiness_ceiling` query param, and the
"never strand the driver" `reachable_fallback` rescue are all removed: a fire
only happens once a spot within the actionability window already exists, so
the picker is never left with zero reachable options after a fire.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from aica_api.main import app
from aica_api.services.run_manager import get_run
from tests.helpers_recovery import create_paused_rest_run, create_paused_rest_run_multi_spots

client = TestClient(app)


def _spots(run_id: str, query: str = "") -> list[dict]:
    return client.get(f"/api/runs/{run_id}/rest-spots{query}").json()["rest_spots"]


def test_reachable_is_eta_within_shared_filter():
    """A spot is reachable iff its ETA <= the run's rest_spot_eta_filter_min;
    over-limit spots stay visible in the response but disabled, and there is
    no reachable_fallback key at all."""
    run_id = create_paused_rest_run_multi_spots()
    rs = get_run(run_id)
    eta_filter_min = float(rs.current_hyperparameters.get("rest_spot_eta_filter_min", 30.0))

    spots = _spots(run_id)
    assert len(spots) > 1, "fixture must return several spots for this to mean anything"

    for s in spots:
        if s["eta_min"] is not None:
            assert s["reachable"] == (s["eta_min"] <= eta_filter_min)
        assert "reachable_fallback" not in s   # removed

    # Sanity: the fixture is pinned (rest_spot_eta_filter_min=60.0, pause ~72km,
    # spots at 85/105/125/145km) to produce a genuine mix, so this isn't
    # vacuously true for every spot.
    assert any(s["reachable"] for s in spots)
    assert any(not s["reachable"] for s in spots)


def test_drowsiness_ceiling_param_no_longer_influences_reachability():
    """The drowsiness_ceiling query param is gone; passing it changes nothing."""
    run_id = create_paused_rest_run_multi_spots()
    base = _spots(run_id)
    with_param = _spots(run_id, "?drowsiness_ceiling=0")
    assert [s["reachable"] for s in base] == [s["reachable"] for s in with_param]
    assert all("reachable_fallback" not in s for s in with_param)


def test_a_genuinely_reachable_run_has_at_least_one_reachable_spot():
    """A normal run already has a spot within the ETA filter — no rescue needed."""
    spots = _spots(create_paused_rest_run())

    assert any(s["reachable"] for s in spots)
    assert all("reachable_fallback" not in s for s in spots)
