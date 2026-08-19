"""Rest-spot ETA must reflect the PLANNED route profile, not the instantaneous
speed the car happens to be doing at the fire tick.

fixbug-0806 (UC-01 Combined screen): the rest-proposal overlay lists candidate
rest spots with a distance and an ETA. Rest proposals commonly fire while the
driver is crawling through a traffic jam. The old endpoint computed
``eta_min = distance_km / current_speed_kph * 60`` from the MOMENTARY speed, so
a spot 13 km up a 60 kph road showed ~156 min (at a 5 kph crawl) instead of the
~13 min the frozen event plan actually implies — distance looked fine, ETA was
"weird".

The tick engine already integrates travel time over the planned segment/jam
profile (``_eta_min_to_km``, wired into ``nextRestSpotMin``). The endpoint must
use the SAME integration so the overlay ETA can never depend on a transient
crawl.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from aica_api.main import app
from aica_api.services import run_manager
from aica_api.services.tick_engine import _eta_min_to_km
from tests.helpers_recovery import create_paused_rest_run_multi_spots

client = TestClient(app)


def _spots(run_id: str, query: str = "") -> list[dict]:
    return client.get(f"/api/runs/{run_id}/rest-spots{query}").json()["rest_spots"]


def test_eta_ignores_a_transient_crawl_speed():
    """A 5 kph instantaneous speed at the fire tick must NOT inflate the ETA:
    the route ahead is ordinary road, so the ETA stays a handful of minutes."""
    run_id = create_paused_rest_run_multi_spots()

    # Simulate the driver being in a momentary crawl at the fire tick (as a
    # traffic jam would produce). The route_facts/event_plan carry NO jam, so a
    # profile-based ETA must be governed by the real road speed, not this 5 kph.
    prior = run_manager.get_prior_tick_state(run_id)
    assert prior is not None
    crawl_kph = 5.0
    prior.signals["dynamic"]["speedKph"] = crawl_kph

    spots = _spots(run_id)
    assert spots, "fixture must return at least one spot"

    nearest = spots[0]
    distance_km = nearest["distance_km"]
    eta_min = nearest["eta_min"]
    assert eta_min is not None

    # The naive instantaneous-speed formula the bug used.
    naive_eta = distance_km / crawl_kph * 60.0

    # The ETA must be the planned-profile integration, which for jam-free road
    # is many times smaller than the crawl-based naive value.
    assert eta_min < naive_eta / 3.0, (
        f"ETA {eta_min} min still looks derived from the {crawl_kph} kph crawl "
        f"(naive would be {naive_eta:.1f} min) instead of the road profile"
    )


def test_eta_matches_the_planned_profile_integration():
    """The endpoint's ETA equals the engine's own ``_eta_min_to_km`` integration
    over the frozen plan — the single source of truth for how fast the car moves."""
    run_id = create_paused_rest_run_multi_spots()

    prior = run_manager.get_prior_tick_state(run_id)
    assert prior is not None
    prior.signals["dynamic"]["speedKph"] = 5.0  # transient crawl — must be ignored

    rs = run_manager.get_run(run_id)
    scenario = run_manager.get_scenario(run_id)
    current_km = prior.distance_km or 0.0
    current_elapsed_min = prior.elapsed_seconds / 60.0

    spots = _spots(run_id)
    assert spots

    total_km = rs.route_facts.total_route_distance_km or 120.0
    for spot in spots:
        pos_km = spot["route_fraction"] * total_km
        expected = round(
            _eta_min_to_km(
                target_km=pos_km,
                from_km=current_km,
                from_elapsed_min=current_elapsed_min,
                route_facts=rs.route_facts,
                event_plan=rs.event_plan,
                sp=scenario.speed_profile,
            ),
            1,
        )
        assert spot["eta_min"] == expected
