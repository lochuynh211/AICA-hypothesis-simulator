"""Tests for maps_client (T001 + T003) — all offline via injectable transport.

TDD RED → GREEN cycle for:
  - directions() → list[RawRoute] (up to 3 alternatives)
  - places_rest_stops() → list[RawPlace] (empty-list safe)
  - MapsError raised for directions_failure / places_failure / invalid_key
  - Key sentinel never appears in any MapsError message

No live network calls — _urlopen is monkeypatched to return recorded fixtures.
"""

from __future__ import annotations

import json
import math
import pathlib
import urllib.error
from io import BytesIO

import pytest

import aica_api.services.maps_client as mc

# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

FIXTURES_DIR = pathlib.Path(__file__).parent / "fixtures" / "maps"


def _load_fixture(name: str) -> bytes:
    """Return raw bytes for a recorded Google JSON fixture."""
    return (FIXTURES_DIR / name).read_bytes()


def _make_transport(fixture_name: str):
    """Return a callable that yields the named fixture bytes regardless of URL."""
    data = _load_fixture(fixture_name)
    return lambda url: data


# ---------------------------------------------------------------------------
# Minimal Google Encoded Polyline encoder — used to generate valid test inputs
# ---------------------------------------------------------------------------

def _encode_polyline(points: list[tuple[float, float]]) -> str:
    """Standard Google encoded polyline encoding. Test-use only."""
    result: list[str] = []
    prev_lat = prev_lng = 0
    for lat, lng in points:
        lat_e5 = round(lat * 1e5)
        lng_e5 = round(lng * 1e5)
        for delta in [lat_e5 - prev_lat, lng_e5 - prev_lng]:
            val = delta << 1
            if val < 0:
                val = ~val
            while val >= 0x20:
                result.append(chr((0x20 | (val & 0x1f)) + 63))
                val >>= 5
            result.append(chr(val + 63))
        prev_lat = lat_e5
        prev_lng = lng_e5
    return "".join(result)


# A valid 3-point polyline spanning San Francisco → midpoint → Los Angeles.
# Decodable by the implementation's _decode_polyline. The transport is mocked,
# so these coordinates don't need to match any real API search.
TEST_POLYLINE = _encode_polyline([
    (37.7749, -122.4194),  # San Francisco
    (36.0, -120.5),        # midpoint (rough)
    (34.0522, -118.2437),  # Los Angeles
])


# ---------------------------------------------------------------------------
# directions() — parsing tests
# ---------------------------------------------------------------------------

class TestDirectionsParsing:
    def test_parses_three_alternatives(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("directions_3_alternatives.json"))
        routes = mc.directions("FAKE_KEY", "San Francisco, CA", "Sacramento, CA")
        assert len(routes) == 3

    def test_route_ids_are_stable(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("directions_3_alternatives.json"))
        routes = mc.directions("FAKE_KEY", "San Francisco, CA", "Sacramento, CA")
        assert [r["route_id"] for r in routes] == ["route-0", "route-1", "route-2"]

    def test_raw_route_has_required_fields(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("directions_3_alternatives.json"))
        routes = mc.directions("FAKE_KEY", "San Francisco, CA", "Sacramento, CA")
        route = routes[0]
        assert "route_id" in route
        assert "summary" in route
        assert "distance_m" in route
        assert "duration_s" in route
        assert "encoded_polyline" in route
        assert "segments" in route

    def test_first_route_summary_matches_fixture(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("directions_3_alternatives.json"))
        routes = mc.directions("FAKE_KEY", "San Francisco, CA", "Sacramento, CA")
        assert routes[0]["summary"] == "via I-5 N"

    def test_first_route_distance_and_duration(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("directions_3_alternatives.json"))
        routes = mc.directions("FAKE_KEY", "San Francisco, CA", "Sacramento, CA")
        assert routes[0]["distance_m"] == 150000
        assert routes[0]["duration_s"] == 5400

    def test_first_route_segments_non_empty(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("directions_3_alternatives.json"))
        routes = mc.directions("FAKE_KEY", "San Francisco, CA", "Sacramento, CA")
        segs = routes[0]["segments"]
        assert isinstance(segs, list)
        assert len(segs) > 0

    def test_segment_has_required_fields(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("directions_3_alternatives.json"))
        routes = mc.directions("FAKE_KEY", "San Francisco, CA", "Sacramento, CA")
        seg = routes[0]["segments"][0]
        assert "road_class" in seg
        assert "maneuver" in seg
        assert "distance_m" in seg

    def test_parses_single_alternative(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("directions_1_alternative.json"))
        routes = mc.directions("FAKE_KEY", "Nice, France", "Cannes, France")
        assert len(routes) == 1
        assert routes[0]["route_id"] == "route-0"
        assert routes[0]["summary"] == "via A8"
        assert routes[0]["distance_m"] == 45000

    def test_returns_at_most_three_alternatives(self, monkeypatch):
        # Even if the fixture had more than 3, the client caps at 3
        monkeypatch.setattr(mc, "_urlopen", _make_transport("directions_3_alternatives.json"))
        routes = mc.directions("FAKE_KEY", "start", "end")
        assert len(routes) <= 3

    def test_encoded_polyline_is_string(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("directions_3_alternatives.json"))
        routes = mc.directions("FAKE_KEY", "start", "end")
        assert isinstance(routes[0]["encoded_polyline"], str)
        assert len(routes[0]["encoded_polyline"]) > 0


# ---------------------------------------------------------------------------
# directions() — error tests
# ---------------------------------------------------------------------------

class TestDirectionsErrors:
    def test_zero_results_raises_directions_failure(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("directions_failure.json"))
        with pytest.raises(mc.MapsError) as exc_info:
            mc.directions("FAKE_KEY", "start", "end")
        assert exc_info.value.error_type == "directions_failure"

    def test_invalid_key_raises_invalid_key(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("invalid_key.json"))
        with pytest.raises(mc.MapsError) as exc_info:
            mc.directions("FAKE_KEY", "start", "end")
        assert exc_info.value.error_type == "invalid_key"

    def test_transport_error_raises_directions_failure(self, monkeypatch):
        def fail_transport(url):
            raise urllib.error.URLError("Connection refused")

        monkeypatch.setattr(mc, "_urlopen", fail_transport)
        with pytest.raises(mc.MapsError) as exc_info:
            mc.directions("FAKE_KEY", "start", "end")
        assert exc_info.value.error_type == "directions_failure"

    def test_maps_error_has_error_type_and_message(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("directions_failure.json"))
        with pytest.raises(mc.MapsError) as exc_info:
            mc.directions("FAKE_KEY", "start", "end")
        err = exc_info.value
        assert hasattr(err, "error_type")
        assert hasattr(err, "message")
        assert isinstance(err.message, str)


# ---------------------------------------------------------------------------
# places_rest_stops() — parsing tests
# ---------------------------------------------------------------------------

class TestPlacesParsing:
    def test_service_area_highway_context(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("places_service_area.json"))
        places = mc.places_rest_stops(
            "FAKE_KEY", TEST_POLYLINE, {"route_type": "highway"}
        )
        assert len(places) == 2

    def test_service_area_type_label(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("places_service_area.json"))
        places = mc.places_rest_stops(
            "FAKE_KEY", TEST_POLYLINE, {"route_type": "highway"}
        )
        assert places[0]["type"] == "service_area"

    def test_raw_place_has_required_fields(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("places_service_area.json"))
        places = mc.places_rest_stops(
            "FAKE_KEY", TEST_POLYLINE, {"route_type": "highway"}
        )
        place = places[0]
        assert "name" in place
        assert "type" in place
        assert "location" in place
        assert "distance_along_route_m" in place

    def test_place_location_has_lat_lng(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("places_service_area.json"))
        places = mc.places_rest_stops(
            "FAKE_KEY", TEST_POLYLINE, {"route_type": "highway"}
        )
        loc = places[0]["location"]
        assert "lat" in loc
        assert "lng" in loc
        assert isinstance(loc["lat"], float)
        assert isinstance(loc["lng"], float)

    def test_distance_along_route_is_numeric(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("places_service_area.json"))
        places = mc.places_rest_stops(
            "FAKE_KEY", TEST_POLYLINE, {"route_type": "highway"}
        )
        assert isinstance(places[0]["distance_along_route_m"], (int, float))

    def test_convenience_store_urban_context(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("places_convenience_store.json"))
        places = mc.places_rest_stops(
            "FAKE_KEY", TEST_POLYLINE, {"route_type": "urban"}
        )
        assert len(places) == 1
        assert places[0]["type"] == "convenience_store"
        assert places[0]["name"] == "7-Eleven"

    def test_place_type_is_valid_literal(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("places_service_area.json"))
        places = mc.places_rest_stops(
            "FAKE_KEY", TEST_POLYLINE, {"route_type": "highway"}
        )
        valid_types = {"service_area", "convenience_store", "other"}
        for p in places:
            assert p["type"] in valid_types

    def test_empty_places_not_an_error(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("places_empty.json"))
        places = mc.places_rest_stops(
            "FAKE_KEY", TEST_POLYLINE, {"route_type": "highway"}
        )
        assert places == []

    def test_first_service_area_name_matches_fixture(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("places_service_area.json"))
        places = mc.places_rest_stops(
            "FAKE_KEY", TEST_POLYLINE, {"route_type": "highway"}
        )
        assert places[0]["name"] == "Highway 5 Service Area"


# ---------------------------------------------------------------------------
# places_rest_stops() — error tests
# ---------------------------------------------------------------------------

class TestPlacesErrors:
    def test_places_failure_raises_places_failure(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("places_failure.json"))
        with pytest.raises(mc.MapsError) as exc_info:
            mc.places_rest_stops("FAKE_KEY", TEST_POLYLINE, {"route_type": "highway"})
        assert exc_info.value.error_type == "places_failure"

    def test_places_invalid_key_raises_invalid_key(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("invalid_key.json"))
        with pytest.raises(mc.MapsError) as exc_info:
            mc.places_rest_stops("FAKE_KEY", TEST_POLYLINE, {"route_type": "highway"})
        assert exc_info.value.error_type == "invalid_key"

    def test_places_transport_error_raises_places_failure(self, monkeypatch):
        def fail_transport(url):
            raise urllib.error.URLError("Connection refused")

        monkeypatch.setattr(mc, "_urlopen", fail_transport)
        with pytest.raises(mc.MapsError) as exc_info:
            mc.places_rest_stops("FAKE_KEY", TEST_POLYLINE, {"route_type": "highway"})
        assert exc_info.value.error_type == "places_failure"


# ---------------------------------------------------------------------------
# Key never leaks into error messages
# ---------------------------------------------------------------------------

class TestKeyDoesNotLeak:
    SENTINEL = "TEST_SENTINEL_KEY_ZZ_99_XY"

    def test_sentinel_not_in_directions_invalid_key_error(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("invalid_key.json"))
        with pytest.raises(mc.MapsError) as exc_info:
            mc.directions(self.SENTINEL, "start", "end")
        err = exc_info.value
        assert self.SENTINEL not in err.message
        assert self.SENTINEL not in str(err)

    def test_sentinel_not_in_directions_failure_error(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("directions_failure.json"))
        with pytest.raises(mc.MapsError) as exc_info:
            mc.directions(self.SENTINEL, "start", "end")
        err = exc_info.value
        assert self.SENTINEL not in err.message
        assert self.SENTINEL not in str(err)

    def test_sentinel_not_in_places_failure_error(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("places_failure.json"))
        with pytest.raises(mc.MapsError) as exc_info:
            mc.places_rest_stops(self.SENTINEL, TEST_POLYLINE, {"route_type": "highway"})
        err = exc_info.value
        assert self.SENTINEL not in err.message
        assert self.SENTINEL not in str(err)

    def test_sentinel_not_in_places_invalid_key_error(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("invalid_key.json"))
        with pytest.raises(mc.MapsError) as exc_info:
            mc.places_rest_stops(self.SENTINEL, TEST_POLYLINE, {"route_type": "highway"})
        err = exc_info.value
        assert self.SENTINEL not in err.message
        assert self.SENTINEL not in str(err)

    def test_sentinel_not_in_transport_error(self, monkeypatch):
        def fail_transport(url):
            raise urllib.error.URLError("Network unreachable")

        monkeypatch.setattr(mc, "_urlopen", fail_transport)
        with pytest.raises(mc.MapsError) as exc_info:
            mc.directions(self.SENTINEL, "start", "end")
        err = exc_info.value
        assert self.SENTINEL not in err.message
        assert self.SENTINEL not in str(err)


# ---------------------------------------------------------------------------
# Fix 1 — fail-loud guard: _urlopen not monkeypatched → RuntimeError in pytest
# ---------------------------------------------------------------------------

class TestLiveNetworkGuard:
    def test_unmocked_urlopen_raises_in_pytest(self, monkeypatch):
        """When _urlopen is not monkeypatched the default guard fires under pytest."""
        # Explicitly restore _urlopen to the real (unpatched) default so this test
        # is independent of ordering with other tests that monkeypatch it.
        monkeypatch.setattr(mc, "_urlopen", mc._default_urlopen)
        # PYTEST_CURRENT_TEST is set by pytest during all test runs.
        with pytest.raises(RuntimeError, match="_urlopen not mocked"):
            mc.directions("FAKE_KEY", "start", "end")

    def test_guard_message_does_not_contain_key(self, monkeypatch):
        """Guard RuntimeError message must never expose the API key."""
        sentinel = "GUARD_SENTINEL_KEY_77_ZZ"
        monkeypatch.setattr(mc, "_urlopen", mc._default_urlopen)
        with pytest.raises(RuntimeError) as exc_info:
            mc.directions(sentinel, "start", "end")
        assert sentinel not in str(exc_info.value)

    def test_guard_fires_for_places_too(self, monkeypatch):
        """Guard fires for places_rest_stops as well (not just directions)."""
        monkeypatch.setattr(mc, "_urlopen", mc._default_urlopen)
        with pytest.raises(RuntimeError, match="_urlopen not mocked"):
            mc.places_rest_stops("FAKE_KEY", TEST_POLYLINE, {"route_type": "highway"})


# ---------------------------------------------------------------------------
# Fix 2 — quota error_type coverage: OVER_DAILY_LIMIT and OVER_QUERY_LIMIT
# ---------------------------------------------------------------------------

class TestQuotaErrors:
    def test_directions_over_daily_limit_raises_quota(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("quota.json"))
        with pytest.raises(mc.MapsError) as exc_info:
            mc.directions("FAKE_KEY", "start", "end")
        assert exc_info.value.error_type == "quota"

    def test_places_over_daily_limit_raises_quota(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("quota.json"))
        with pytest.raises(mc.MapsError) as exc_info:
            mc.places_rest_stops("FAKE_KEY", TEST_POLYLINE, {"route_type": "highway"})
        assert exc_info.value.error_type == "quota"

    def test_directions_over_query_limit_raises_quota(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("quota_query_limit.json"))
        with pytest.raises(mc.MapsError) as exc_info:
            mc.directions("FAKE_KEY", "start", "end")
        assert exc_info.value.error_type == "quota"

    def test_places_over_query_limit_raises_quota(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("quota_query_limit.json"))
        with pytest.raises(mc.MapsError) as exc_info:
            mc.places_rest_stops("FAKE_KEY", TEST_POLYLINE, {"route_type": "highway"})
        assert exc_info.value.error_type == "quota"


# ---------------------------------------------------------------------------
# Fix 3 — cap at 3: fixture with 4 routes → only 3 returned
# ---------------------------------------------------------------------------

class TestAlternativesCap:
    def test_cap_truncates_four_alternatives_to_three(self, monkeypatch):
        """directions() must truncate a 4-route response to exactly 3."""
        monkeypatch.setattr(mc, "_urlopen", _make_transport("directions_4_alternatives.json"))
        routes = mc.directions("FAKE_KEY", "start", "end")
        assert len(routes) == 3


# ---------------------------------------------------------------------------
# Fix 4 — assert road_class VALUES from the 3-alternatives fixture steps
# ---------------------------------------------------------------------------

class TestRoadClassValues:
    def test_merge_step_maps_to_highway(self, monkeypatch):
        """A step with maneuver='merge' must produce road_class='HIGHWAY'."""
        monkeypatch.setattr(mc, "_urlopen", _make_transport("directions_3_alternatives.json"))
        routes = mc.directions("FAKE_KEY", "start", "end")
        # routes[0].segments[1] has maneuver="merge" (Merge onto I-5 N)
        seg = routes[0]["segments"][1]
        assert seg["maneuver"] == "merge"
        assert seg["road_class"] == "HIGHWAY"

    def test_straight_step_maps_to_local(self, monkeypatch):
        """A step with maneuver='straight' and no highway keywords → road_class='LOCAL'."""
        monkeypatch.setattr(mc, "_urlopen", _make_transport("directions_3_alternatives.json"))
        routes = mc.directions("FAKE_KEY", "start", "end")
        # routes[0].segments[0] has maneuver="straight" (Head north on Market St)
        seg = routes[0]["segments"][0]
        assert seg["maneuver"] == "straight"
        assert seg["road_class"] == "LOCAL"


# ---------------------------------------------------------------------------
# Fix 5 — invalid polyline → graceful [] with no exception
# ---------------------------------------------------------------------------

class TestInvalidPolyline:
    def test_empty_polyline_returns_empty_list(self, monkeypatch):
        """An empty polyline string must return [] without raising."""
        monkeypatch.setattr(mc, "_urlopen", _make_transport("places_service_area.json"))
        result = mc.places_rest_stops("FAKE_KEY", "", {"route_type": "highway"})
        assert result == []

    def test_garbage_polyline_returns_empty_list(self, monkeypatch):
        """A garbage/invalid polyline string must return [] without raising."""
        monkeypatch.setattr(mc, "_urlopen", _make_transport("places_service_area.json"))
        result = mc.places_rest_stops("FAKE_KEY", "!!!INVALID@@@", {"route_type": "highway"})
        assert result == []
