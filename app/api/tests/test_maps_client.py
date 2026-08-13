"""Tests for maps_client (T001 + T003, + Places v1 migration) — all offline via
injectable transport.

TDD RED → GREEN cycle for:
  - directions() → list[RawRoute] (up to 3 alternatives) — legacy GET API, unchanged.
  - places_rest_stops() → list[RawPlace] (empty-list safe) — Places v1 POST API,
    Japanese Text/Nearby Search queries.
  - MapsError raised for directions_failure / places_failure / invalid_key / quota
  - Key sentinel never appears in any MapsError message

No live network calls — _urlopen is monkeypatched to return recorded fixtures
(or raise urllib.error.HTTPError / URLError to simulate transport failures).
"""

from __future__ import annotations

import json
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
    """Return a callable that yields the named fixture bytes regardless of
    URL/method — works for both legacy GET (directions) and v1 POST (places)
    calls since it ignores ``data``/``headers``."""
    data = _load_fixture(fixture_name)
    return lambda url, **kwargs: data


def _http_error(status: str, message: str = "simulated error", code: int = 400) -> urllib.error.HTTPError:
    """Build a urllib.error.HTTPError shaped like a Places v1 error response."""
    body = json.dumps({"error": {"status": status, "message": message}}).encode("utf-8")
    return urllib.error.HTTPError("https://places.googleapis.com/v1/places:searchText", code, status, {}, BytesIO(body))


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

# Starts at the same shared vertex as fixtures/maps/directions_3_alternatives.json's
# route-0/1/2 ((37.76439, -122.5244)). The shared places_service_area.json /
# places_convenience_store.json fixtures' coordinates (also consumed by
# tests/test_api_run_loop.py, tests/test_key_safety.py,
# tests/test_route_boundary.py, tests/test_run_plans_route_selection.py,
# tests/test_uc01_integration_s9.py, tests/test_maps_determinism.py,
# tests/test_routes_maps.py and tests/test_t012_rest_handling.py) are
# anchored within a couple hundred metres of that shared vertex — so those
# coordinates must stay in sync with this polyline's start point.
# TEST_POLYLINE's own SF/midpoint/LA line does not pass anywhere near those
# fixture coordinates, and the off-route filter (fixbug-0806) would otherwise
# drop every place TestPlacesParsing's tests expect to see — this dedicated
# polyline keeps that class's fixtures within the _PLACES_OFFROUTE_MAX_M cap
# without touching TEST_POLYLINE (used broadly elsewhere in this file).
#
# This polyline heads due north from the shared vertex — close to route-0's
# own real (northbound) heading, but chosen independently. That heading, and
# the places_service_area.json fixture's coordinates (both placed slightly
# WEST of the shared vertex: "Highway 5 Service Area" at
# (37.7644, -122.527) and "Rest Area Northbound Mile 220" at
# (37.7643, -122.529), neither of which carries a 上り/下り label), are
# chosen together so BOTH fall on the geometric LEFT (reachable) side of
# travel per `_facility_side_distance` with a comfortable margin — so
# `_filter_reachable_direction`'s ambiguous-facility fallback keeps both
# rather than treating one as an opposite-carriageway facility. (A
# north/south offset from the shared vertex is nearly PARALLEL to every
# route-0/1/2 heading there, which makes the perpendicular side sign flip on
# noise — hence the fixture points sit to the WEST/EAST instead, which is
# robustly perpendicular to a due-north heading.) This is independent of,
# and does not need to exactly match, route-0/1/2's own real heading —
# TestPlacesParsing only exercises this dedicated polyline.
PLACES_PARSING_POLYLINE = _encode_polyline([
    (37.76439, -122.5244),
    (38.04439, -122.5244),
])


# ---------------------------------------------------------------------------
# directions() — parsing tests  (legacy GET API, unchanged by the v1 migration)
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
        def fail_transport(url, **kwargs):
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
# places_rest_stops() — parsing tests (Places v1)
# ---------------------------------------------------------------------------

class TestPlacesParsing:
    def test_service_area_highway_context(self, monkeypatch):
        # Highway route_type → only Text Search calls (サービスエリア/パーキングエリア),
        # both bucketed "service_area" — the blanket fixture is consistent across
        # every call, so dedup-by-id collapses to the fixture's unique id count.
        monkeypatch.setattr(mc, "_urlopen", _make_transport("places_service_area.json"))
        places = mc.places_rest_stops(
            "FAKE_KEY", PLACES_PARSING_POLYLINE, {"route_type": "highway"}
        )
        assert len(places) == 2

    def test_service_area_type_label(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("places_service_area.json"))
        places = mc.places_rest_stops(
            "FAKE_KEY", PLACES_PARSING_POLYLINE, {"route_type": "highway"}
        )
        assert places[0]["type"] == "service_area"

    def test_raw_place_has_required_fields(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("places_service_area.json"))
        places = mc.places_rest_stops(
            "FAKE_KEY", PLACES_PARSING_POLYLINE, {"route_type": "highway"}
        )
        place = places[0]
        assert "name" in place
        assert "type" in place
        assert "location" in place
        assert "distance_along_route_m" in place

    def test_place_location_has_lat_lng(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("places_service_area.json"))
        places = mc.places_rest_stops(
            "FAKE_KEY", PLACES_PARSING_POLYLINE, {"route_type": "highway"}
        )
        loc = places[0]["location"]
        assert "lat" in loc
        assert "lng" in loc
        assert isinstance(loc["lat"], float)
        assert isinstance(loc["lng"], float)

    def test_distance_along_route_is_numeric(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("places_service_area.json"))
        places = mc.places_rest_stops(
            "FAKE_KEY", PLACES_PARSING_POLYLINE, {"route_type": "highway"}
        )
        assert isinstance(places[0]["distance_along_route_m"], (int, float))

    def test_convenience_store_urban_context(self, monkeypatch):
        """On an urban route, a place surfaced ONLY by the convenience_store
        Nearby Search (not by the 道の駅 Text Search or gas_station Nearby
        Search) is classified "convenience_store" via bucket-first
        classification."""
        conv_bytes = _load_fixture("places_convenience_store.json")
        empty_bytes = b'{"places": []}'

        def bucketed_transport(url, *, data=None, headers=None):
            body = json.loads(data) if data is not None else {}
            if body.get("includedTypes") == ["convenience_store"]:
                return conv_bytes
            return empty_bytes

        monkeypatch.setattr(mc, "_urlopen", bucketed_transport)
        places = mc.places_rest_stops(
            "FAKE_KEY", PLACES_PARSING_POLYLINE, {"route_type": "urban"}
        )
        assert len(places) == 1
        assert places[0]["type"] == "convenience_store"
        assert places[0]["name"] == "7-Eleven"

    def test_gas_station_no_longer_searched_on_urban_context(self, monkeypatch):
        """Task 2 (fixbug-0806): gas stations are not rest facilities and are
        no longer searched at all — even if the transport is primed to
        return a gas_station place for an ``includedTypes=["gas_station"]``
        Nearby Search body, no such call is ever issued, so a gas station
        can never surface in the results."""
        gas_bytes = json.dumps({
            "places": [
                {
                    "id": "gas_1",
                    "displayName": {"text": "ENEOS Chichibu"},
                    "types": ["gas_station", "point_of_interest", "establishment"],
                    "location": {"latitude": 36.0, "longitude": -120.5},
                }
            ]
        }).encode("utf-8")
        empty_bytes = b'{"places": []}'
        seen_gas_search = False

        def bucketed_transport(url, *, data=None, headers=None):
            nonlocal seen_gas_search
            body = json.loads(data) if data is not None else {}
            if body.get("includedTypes") == ["gas_station"]:
                seen_gas_search = True
                return gas_bytes
            return empty_bytes

        monkeypatch.setattr(mc, "_urlopen", bucketed_transport)
        places = mc.places_rest_stops(
            "FAKE_KEY", TEST_POLYLINE, {"route_type": "urban"}
        )
        assert not seen_gas_search, "gas_station Nearby Search must never be issued"
        assert places == []
        assert not any(p["type"] == "gas_station" for p in places)

    def test_place_type_is_valid_literal(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("places_service_area.json"))
        places = mc.places_rest_stops(
            "FAKE_KEY", PLACES_PARSING_POLYLINE, {"route_type": "highway"}
        )
        valid_types = {"service_area", "convenience_store", "gas_station", "other"}
        for p in places:
            assert p["type"] in valid_types

    def test_empty_places_not_an_error(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("places_empty.json"))
        places = mc.places_rest_stops(
            "FAKE_KEY", TEST_POLYLINE, {"route_type": "highway"}
        )
        assert places == []

    def test_missing_places_key_not_an_error(self, monkeypatch):
        """A 200 response with no 'places' key at all (not even an empty list)
        must also be treated as zero results, not an error."""
        monkeypatch.setattr(mc, "_urlopen", lambda url, **kwargs: b"{}")
        places = mc.places_rest_stops(
            "FAKE_KEY", TEST_POLYLINE, {"route_type": "highway"}
        )
        assert places == []

    def test_first_service_area_name_matches_fixture(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("places_service_area.json"))
        places = mc.places_rest_stops(
            "FAKE_KEY", PLACES_PARSING_POLYLINE, {"route_type": "highway"}
        )
        assert places[0]["name"] == "Highway 5 Service Area"

    def test_highway_route_only_issues_text_search_calls(self, monkeypatch):
        """Highway routes use サービスエリア/パーキングエリア Text Search only —
        no Nearby Search calls are made."""
        seen_urls: list[str] = []

        def recording_transport(url, **kwargs):
            seen_urls.append(url)
            return b'{"places": []}'

        monkeypatch.setattr(mc, "_urlopen", recording_transport)
        mc.places_rest_stops("FAKE_KEY", TEST_POLYLINE, {"route_type": "highway"})

        assert all(u == mc._PLACES_V1_TEXT_URL for u in seen_urls)
        assert len(seen_urls) == mc._PLACES_SAMPLE_POINTS * len(mc._HIGHWAY_TEXT_QUERIES)

    def test_urban_route_issues_text_and_nearby_search_calls(self, monkeypatch):
        """Urban routes use one Text Search (道の駅) plus two Nearby Searches
        (convenience_store, gas_station) per sample point."""
        seen_urls: list[str] = []

        def recording_transport(url, **kwargs):
            seen_urls.append(url)
            return b'{"places": []}'

        monkeypatch.setattr(mc, "_urlopen", recording_transport)
        mc.places_rest_stops("FAKE_KEY", TEST_POLYLINE, {"route_type": "urban"})

        text_calls = [u for u in seen_urls if u == mc._PLACES_V1_TEXT_URL]
        nearby_calls = [u for u in seen_urls if u == mc._PLACES_V1_NEARBY_URL]
        assert len(text_calls) == mc._PLACES_SAMPLE_POINTS * len(mc._LOCAL_TEXT_QUERIES)
        assert len(nearby_calls) == mc._PLACES_SAMPLE_POINTS * len(mc._LOCAL_NEARBY_TYPES)

    def test_highway_text_search_bodies_contain_jp_queries(self, monkeypatch):
        """Highway routes must query the exact JP terms サービスエリア and
        パーキングエリア (confirmed via live probe to give the best recall)."""
        bodies: list[dict] = []

        def recording_transport(url, *, data=None, headers=None):
            if data is not None:
                bodies.append(json.loads(data))
            return b'{"places": []}'

        monkeypatch.setattr(mc, "_urlopen", recording_transport)
        mc.places_rest_stops("FAKE_KEY", TEST_POLYLINE, {"route_type": "highway"})

        queries = {b["textQuery"] for b in bodies}
        assert queries == {"サービスエリア", "パーキングエリア"}
        assert all(b.get("languageCode") == "ja" for b in bodies)

    def test_urban_search_bodies_contain_jp_query_and_types(self, monkeypatch):
        """Urban routes must Text Search 道の駅 and Nearby Search
        includedTypes convenience_store only — gas_station is not a rest
        facility and is never searched (fixbug-0806 Task 2)."""
        text_bodies: list[dict] = []
        nearby_bodies: list[dict] = []

        def recording_transport(url, *, data=None, headers=None):
            body = json.loads(data) if data is not None else {}
            if url == mc._PLACES_V1_TEXT_URL:
                text_bodies.append(body)
            elif url == mc._PLACES_V1_NEARBY_URL:
                nearby_bodies.append(body)
            return b'{"places": []}'

        monkeypatch.setattr(mc, "_urlopen", recording_transport)
        mc.places_rest_stops("FAKE_KEY", TEST_POLYLINE, {"route_type": "urban"})

        assert {b["textQuery"] for b in text_bodies} == {"道の駅"}
        included_types = {tuple(b["includedTypes"]) for b in nearby_bodies}
        assert included_types == {("convenience_store",)}

    def test_places_v1_request_includes_field_mask_and_key_header(self, monkeypatch):
        captured_headers: list[dict] = []

        def recording_transport(url, *, data=None, headers=None):
            captured_headers.append(headers or {})
            return b'{"places": []}'

        monkeypatch.setattr(mc, "_urlopen", recording_transport)
        mc.places_rest_stops("FAKE_KEY", TEST_POLYLINE, {"route_type": "highway"})

        assert captured_headers, "Expected at least one Places v1 call"
        for headers in captured_headers:
            assert headers["X-Goog-Api-Key"] == "FAKE_KEY"
            assert headers["X-Goog-FieldMask"] == mc._PLACES_FIELD_MASK
            assert headers["Content-Type"] == "application/json"


# ---------------------------------------------------------------------------
# places_rest_stops() — error tests (Places v1 HTTP error mapping)
# ---------------------------------------------------------------------------

class TestPlacesErrors:
    def test_places_failure_raises_places_failure(self, monkeypatch):
        def fail_transport(url, **kwargs):
            raise _http_error("INTERNAL", "backend error", code=500)

        monkeypatch.setattr(mc, "_urlopen", fail_transport)
        with pytest.raises(mc.MapsError) as exc_info:
            mc.places_rest_stops("FAKE_KEY", TEST_POLYLINE, {"route_type": "highway"})
        assert exc_info.value.error_type == "places_failure"

    def test_places_invalid_key_raises_invalid_key(self, monkeypatch):
        def fail_transport(url, **kwargs):
            raise _http_error("PERMISSION_DENIED", "API key invalid", code=403)

        monkeypatch.setattr(mc, "_urlopen", fail_transport)
        with pytest.raises(mc.MapsError) as exc_info:
            mc.places_rest_stops("FAKE_KEY", TEST_POLYLINE, {"route_type": "highway"})
        assert exc_info.value.error_type == "invalid_key"

    def test_places_request_denied_raises_invalid_key(self, monkeypatch):
        def fail_transport(url, **kwargs):
            raise _http_error("REQUEST_DENIED", "API key invalid", code=403)

        monkeypatch.setattr(mc, "_urlopen", fail_transport)
        with pytest.raises(mc.MapsError) as exc_info:
            mc.places_rest_stops("FAKE_KEY", TEST_POLYLINE, {"route_type": "highway"})
        assert exc_info.value.error_type == "invalid_key"

    def test_places_unauthenticated_raises_invalid_key(self, monkeypatch):
        def fail_transport(url, **kwargs):
            raise _http_error("UNAUTHENTICATED", "missing credentials", code=401)

        monkeypatch.setattr(mc, "_urlopen", fail_transport)
        with pytest.raises(mc.MapsError) as exc_info:
            mc.places_rest_stops("FAKE_KEY", TEST_POLYLINE, {"route_type": "highway"})
        assert exc_info.value.error_type == "invalid_key"

    def test_places_resource_exhausted_raises_quota(self, monkeypatch):
        def fail_transport(url, **kwargs):
            raise _http_error("RESOURCE_EXHAUSTED", "quota exceeded", code=429)

        monkeypatch.setattr(mc, "_urlopen", fail_transport)
        with pytest.raises(mc.MapsError) as exc_info:
            mc.places_rest_stops("FAKE_KEY", TEST_POLYLINE, {"route_type": "highway"})
        assert exc_info.value.error_type == "quota"

    def test_places_transport_error_raises_places_failure(self, monkeypatch):
        def fail_transport(url, **kwargs):
            raise urllib.error.URLError("Connection refused")

        monkeypatch.setattr(mc, "_urlopen", fail_transport)
        with pytest.raises(mc.MapsError) as exc_info:
            mc.places_rest_stops("FAKE_KEY", TEST_POLYLINE, {"route_type": "highway"})
        assert exc_info.value.error_type == "places_failure"

    def test_places_invalid_json_raises_places_failure(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", lambda url, **kwargs: b"not json{{{")
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
        def fail_transport(url, **kwargs):
            raise _http_error("INTERNAL", "backend error", code=500)

        monkeypatch.setattr(mc, "_urlopen", fail_transport)
        with pytest.raises(mc.MapsError) as exc_info:
            mc.places_rest_stops(self.SENTINEL, TEST_POLYLINE, {"route_type": "highway"})
        err = exc_info.value
        assert self.SENTINEL not in err.message
        assert self.SENTINEL not in str(err)

    def test_sentinel_not_in_places_invalid_key_error(self, monkeypatch):
        def fail_transport(url, **kwargs):
            raise _http_error("PERMISSION_DENIED", "API key invalid", code=403)

        monkeypatch.setattr(mc, "_urlopen", fail_transport)
        with pytest.raises(mc.MapsError) as exc_info:
            mc.places_rest_stops(self.SENTINEL, TEST_POLYLINE, {"route_type": "highway"})
        err = exc_info.value
        assert self.SENTINEL not in err.message
        assert self.SENTINEL not in str(err)

    def test_sentinel_not_in_transport_error(self, monkeypatch):
        def fail_transport(url, **kwargs):
            raise urllib.error.URLError("Network unreachable")

        monkeypatch.setattr(mc, "_urlopen", fail_transport)
        with pytest.raises(mc.MapsError) as exc_info:
            mc.directions(self.SENTINEL, "start", "end")
        err = exc_info.value
        assert self.SENTINEL not in err.message
        assert self.SENTINEL not in str(err)

    def test_sentinel_not_in_places_request_headers_leaking_into_error(self, monkeypatch):
        """Even though the key IS sent in the X-Goog-Api-Key header (by design,
        that's how Places v1 auth works), it must never appear in the
        exception message raised back to callers."""
        def fail_transport(url, *, data=None, headers=None):
            assert headers is not None and headers.get("X-Goog-Api-Key") == self.SENTINEL
            raise _http_error("INTERNAL", "backend error", code=500)

        monkeypatch.setattr(mc, "_urlopen", fail_transport)
        with pytest.raises(mc.MapsError) as exc_info:
            mc.places_rest_stops(self.SENTINEL, TEST_POLYLINE, {"route_type": "highway"})
        assert self.SENTINEL not in str(exc_info.value)


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
#          (Directions legacy API only — Places quota is covered above via
#          RESOURCE_EXHAUSTED, the v1 equivalent.)
# ---------------------------------------------------------------------------

class TestQuotaErrors:
    def test_directions_over_daily_limit_raises_quota(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("quota.json"))
        with pytest.raises(mc.MapsError) as exc_info:
            mc.directions("FAKE_KEY", "start", "end")
        assert exc_info.value.error_type == "quota"

    def test_directions_over_query_limit_raises_quota(self, monkeypatch):
        monkeypatch.setattr(mc, "_urlopen", _make_transport("quota_query_limit.json"))
        with pytest.raises(mc.MapsError) as exc_info:
            mc.directions("FAKE_KEY", "start", "end")
        assert exc_info.value.error_type == "quota"

    def test_places_over_limit_status_string_raises_quota(self, monkeypatch):
        """Forward-compat: any v1 error.status starting with OVER_ is treated
        as quota, matching the legacy OVER_DAILY_LIMIT/OVER_QUERY_LIMIT spirit."""
        def fail_transport(url, **kwargs):
            raise _http_error("OVER_QUERY_LIMIT", "quota exceeded", code=429)

        monkeypatch.setattr(mc, "_urlopen", fail_transport)
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
# Fix 4b — _infer_road_class direct unit tests (expressway/toll keywords +
#            long-step heuristic)
# ---------------------------------------------------------------------------


class TestInferRoadClassDirect:
    """Unit tests for _infer_road_class covering all three classification paths:
    maneuver-based, keyword-based (English instructions), and long-step heuristic."""

    def test_expressway_keyword_in_instructions_maps_to_highway(self):
        """Step with 'Expressway' in html_instructions → HIGHWAY (English keyword match)."""
        step = {
            "distance": {"value": 2000},
            "maneuver": "straight",
            "html_instructions": "Continue on Tomei Expressway toward Nagoya",
        }
        assert mc._infer_road_class(step) == "HIGHWAY"

    def test_toll_keyword_in_instructions_maps_to_highway(self):
        """Step with 'toll' in html_instructions → HIGHWAY."""
        step = {
            "distance": {"value": 1500},
            "maneuver": "",
            "html_instructions": "Pass through the toll gate",
        }
        assert mc._infer_road_class(step) == "HIGHWAY"

    def test_long_step_no_keyword_no_maneuver_maps_to_highway(self):
        """Step >= 8 km with no highway keyword and no merge/ramp maneuver → HIGHWAY.

        This is the cross-language long-step heuristic: a continuous 30 km step
        with no maneuver is almost certainly an expressway main section even when
        the instruction text is not in English.
        """
        step = {
            "distance": {"value": 30_000},
            "maneuver": "",
            "html_instructions": "Continue straight on some road",
        }
        assert mc._infer_road_class(step) == "HIGHWAY"

    def test_exactly_threshold_distance_maps_to_highway(self):
        """Step at exactly _HIGHWAY_MIN_STEP_M (8 km) → HIGHWAY (boundary inclusive)."""
        step = {
            "distance": {"value": mc._HIGHWAY_MIN_STEP_M},
            "maneuver": "straight",
            "html_instructions": "Continue on some road",
        }
        assert mc._infer_road_class(step) == "HIGHWAY"

    def test_short_local_step_maps_to_local(self):
        """Short step (800 m), local instruction, non-highway maneuver → LOCAL."""
        step = {
            "distance": {"value": 800},
            "maneuver": "turn-left",
            "html_instructions": "Turn left onto Main St",
        }
        assert mc._infer_road_class(step) == "LOCAL"

    def test_ramp_maneuver_maps_to_highway(self):
        """Step with maneuver containing 'ramp' → HIGHWAY regardless of distance or text."""
        step = {
            "distance": {"value": 500},
            "maneuver": "ramp-right",
            "html_instructions": "Take the ramp onto the freeway",
        }
        assert mc._infer_road_class(step) == "HIGHWAY"

    def test_freeway_keyword_maps_to_highway(self):
        """Step with 'freeway' keyword → HIGHWAY."""
        step = {
            "distance": {"value": 1000},
            "maneuver": "straight",
            "html_instructions": "Merge onto the freeway",
        }
        assert mc._infer_road_class(step) == "HIGHWAY"

    def test_step_below_threshold_no_keyword_maps_to_local(self):
        """Step < 8 km with no highway keyword and no merge/ramp → LOCAL."""
        step = {
            "distance": {"value": 7_999},
            "maneuver": "straight",
            "html_instructions": "Head north on Park Ave",
        }
        assert mc._infer_road_class(step) == "LOCAL"


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


# ---------------------------------------------------------------------------
# Multi-point sampling: dedup + spanning + sort
# ---------------------------------------------------------------------------

# A longer polyline (8 points SF → LA via intermediate waypoints) ensures
# _PLACES_SAMPLE_POINTS distinct sample coordinates span the whole route.
LONG_POLYLINE = _encode_polyline([
    (37.7749, -122.4194),   # SF start
    (37.5,    -121.8),      # pt 1
    (37.0,    -121.2),      # pt 2
    (36.0,    -120.5),      # pt 3 (route midpoint)
    (35.5,    -119.8),      # pt 4
    (35.0,    -119.1),      # pt 5
    (34.5,    -118.7),      # pt 6
    (34.0522, -118.2437),   # LA end
])


# A finely-vertexed ~40km straight-line polyline (100 points, ~400m apart),
# for tests that need enough polyline resolution for several sample-point
# targets a few km apart to each snap to their OWN distinct vertex — unlike
# TEST_POLYLINE/LONG_POLYLINE's handful of widely-spaced real-world points,
# which is fine for whole-route/coarse tests but too coarse to tell apart
# sample points that are only a few km apart (see the sandwiched-run tests).
FINE_POLYLINE = _encode_polyline([
    (35.0, 139.0 + 0.005 * i) for i in range(100)
])


def _sticky_seq_transport(responses: list[bytes]):
    """Return a transport that pops responses in order; once exhausted, keeps
    returning the last response for any further calls.

    The highway/urban search strategies issue 2–3 HTTP calls per sample point
    (not 1, as under the legacy single-Nearby-Search-per-point model), so
    tests that only care about the union of results across all calls (dedup,
    spanning, sort) don't need to hand-compute the exact new call count —
    they just describe the interesting response sequence and let the tail
    repeat harmlessly (typically as further empty results).
    """
    calls = list(responses)
    state: dict[str, bytes] = {}

    def _transport(url, **kwargs):
        if calls:
            state["last"] = calls.pop(0)
        return state["last"]

    return _transport


class TestMultiPointSampling:
    """Prove dedup, route-spanning, and ascending sort across sample points."""

    def test_dedup_across_sample_points(self, monkeypatch):
        """Places with the same id, returned by multiple searches across
        multiple sample points, are deduped.

        Response sequence (repeats the last entry once exhausted — the highway
        search strategy issues 2 calls per sample point, more than the 6
        responses below, so later calls harmlessly get the tail ZERO/empty
        response):
        - calls 1–2: [place_a, place_b]
        - call  3:   [place_a, place_c]  (A duplicate, C is new)
        - call  4:   [place_b]           (duplicate)
        - call  5:   [place_c]           (duplicate)
        - call  6:   []

        Expected deduped output: 3 unique places sorted ascending by
        distance_along_route_m.
        """
        # place_a is near SF, projects to route start (low distance)
        place_a = {
            "id": "place_a_id",
            "displayName": {"text": "Start Rest Area"},
            "types": ["rest_stop"],
            "location": {"latitude": 37.7749, "longitude": -122.4194},
        }
        # place_b is near LA, projects to route end (high distance)
        place_b = {
            "id": "place_b_id",
            "displayName": {"text": "End Service Area"},
            "types": ["rest_stop"],
            "location": {"latitude": 34.0522, "longitude": -118.2437},
        }
        # place_c is at the midpoint, projects to middle (intermediate distance)
        place_c = {
            "id": "place_c_id",
            "displayName": {"text": "Mid Rest Stop"},
            "types": ["rest_stop"],
            "location": {"latitude": 36.0, "longitude": -120.5},
        }

        responses = [
            json.dumps({"places": [place_a, place_b]}).encode(),
            json.dumps({"places": [place_a, place_b]}).encode(),
            json.dumps({"places": [place_a, place_c]}).encode(),
            json.dumps({"places": [place_b]}).encode(),
            json.dumps({"places": [place_c]}).encode(),
            json.dumps({"places": []}).encode(),
        ]
        monkeypatch.setattr(mc, "_urlopen", _sticky_seq_transport(responses))

        places = mc.places_rest_stops(
            "FAKE_KEY", LONG_POLYLINE, {"route_type": "highway"}
        )

        # Exactly 3 unique places (no duplicates from repeated sample points/searches)
        assert len(places) == 3
        names = {p["name"] for p in places}
        assert names == {"Start Rest Area", "End Service Area", "Mid Rest Stop"}

        # Sorted ascending by distance_along_route_m
        dists = [p["distance_along_route_m"] for p in places]
        assert dists == sorted(dists), (
            f"Expected ascending sort; got distances: {dists}"
        )

    def test_dedup_without_place_id_uses_name_and_coords(self, monkeypatch):
        """Places without an id are deduped by (name, rounded lat, rounded lng)."""
        # A result without an "id" field — same name + same coords every time.
        place_no_id = {
            "displayName": {"text": "Unnamed Rest Stop"},
            "types": ["rest_stop"],
            "location": {"latitude": 36.0, "longitude": -120.5},
            # no "id" field
        }
        single_response = json.dumps({"places": [place_no_id]}).encode()
        empty_response = json.dumps({"places": []}).encode()
        responses = [single_response, empty_response]
        monkeypatch.setattr(mc, "_urlopen", _sticky_seq_transport(responses))

        places = mc.places_rest_stops(
            "FAKE_KEY", LONG_POLYLINE, {"route_type": "highway"}
        )
        assert len(places) == 1, (
            f"Dedup by (name, coords) should yield 1 place, got {len(places)}"
        )

    def test_highway_sample_point_call_count_bounded(self, monkeypatch):
        """Highway routes: exactly _PLACES_SAMPLE_POINTS * 2 Text Search calls
        (サービスエリア + パーキングエリア per point), zero Nearby Search calls."""
        text_calls = 0
        nearby_calls = 0

        def counting_transport(url: str, **kwargs) -> bytes:
            nonlocal text_calls, nearby_calls
            if url == mc._PLACES_V1_TEXT_URL:
                text_calls += 1
            elif url == mc._PLACES_V1_NEARBY_URL:
                nearby_calls += 1
            return b'{"places": []}'

        monkeypatch.setattr(mc, "_urlopen", counting_transport)
        mc.places_rest_stops("FAKE_KEY", LONG_POLYLINE, {"route_type": "highway"})

        assert text_calls == mc._PLACES_SAMPLE_POINTS * 2
        assert nearby_calls == 0

    def test_urban_sample_point_call_count_bounded(self, monkeypatch):
        """Urban routes: exactly _PLACES_SAMPLE_POINTS Text Search calls
        (道の駅) plus _PLACES_SAMPLE_POINTS Nearby Search calls
        (convenience_store only — gas_station is not searched, fixbug-0806
        Task 2) per point."""
        text_calls = 0
        nearby_calls = 0

        def counting_transport(url: str, **kwargs) -> bytes:
            nonlocal text_calls, nearby_calls
            if url == mc._PLACES_V1_TEXT_URL:
                text_calls += 1
            elif url == mc._PLACES_V1_NEARBY_URL:
                nearby_calls += 1
            return b'{"places": []}'

        monkeypatch.setattr(mc, "_urlopen", counting_transport)
        mc.places_rest_stops("FAKE_KEY", LONG_POLYLINE, {"route_type": "urban"})

        assert text_calls == mc._PLACES_SAMPLE_POINTS
        assert nearby_calls == mc._PLACES_SAMPLE_POINTS * len(mc._LOCAL_NEARBY_TYPES)

    def test_result_sorted_ascending_by_distance(self, monkeypatch):
        """Multi-point results are sorted ascending by distance_along_route_m."""
        monkeypatch.setattr(mc, "_urlopen", _make_transport("places_service_area.json"))
        places = mc.places_rest_stops(
            "FAKE_KEY", LONG_POLYLINE, {"route_type": "highway"}
        )
        dists = [p["distance_along_route_m"] for p in places]
        assert dists == sorted(dists), f"Places not sorted ascending: {dists}"


# ---------------------------------------------------------------------------
# Highway carriageway (up/down) direction filter
# ---------------------------------------------------------------------------
#
# A straight, due-north 6-point route. A same-name SA pair sits near the
# midpoint (vertex idx=2), one facility offset slightly west of the route
# (lng - 0.001) and one slightly east (lng + 0.001). Under the left-hand
# traffic assumption, facing north the LEFT side is WEST — so the "(上り)"
# facility (placed west) is on the reachable side and the "(下り)" facility
# (placed east) is on the opposite carriageway, regardless of which kanji
# label happens to be on which side (the routeDir inference is symmetric).
DIRECTION_TEST_POLYLINE = _encode_polyline([
    (35.00, 139.000),
    (35.02, 139.000),
    (35.04, 139.000),
    (35.06, 139.000),
    (35.08, 139.000),
    (35.10, 139.000),
])


class TestDirectionFilter:
    def test_highway_keeps_only_same_direction_facility(self, monkeypatch):
        """Highway context: of a same-name (上り)/(下り) pair on opposite sides
        of the route, only the reachable (same-carriageway) one survives."""
        monkeypatch.setattr(mc, "_urlopen", _make_transport("places_direction_pair.json"))
        places = mc.places_rest_stops(
            "FAKE_KEY", DIRECTION_TEST_POLYLINE, {"route_type": "highway"}
        )
        assert len(places) == 1
        assert places[0]["name"] == "海老名SA (上り)"

    def test_urban_route_is_not_direction_filtered(self, monkeypatch):
        """Non-highway routes have no up/down carriageway concept — the same
        (上り)/(下り) pair must NOT be filtered on an urban route."""
        monkeypatch.setattr(mc, "_urlopen", _make_transport("places_direction_pair.json"))
        places = mc.places_rest_stops(
            "FAKE_KEY", DIRECTION_TEST_POLYLINE, {"route_type": "urban"}
        )
        names = {p["name"] for p in places}
        assert names == {"海老名SA (上り)", "海老名SA (下り)"}

    def test_bidirectional_vote_flips_when_label_predominates_wrong_side(
        self, monkeypatch
    ):
        """routeDir must be a BIDIRECTIONAL weighted vote, not a naive
        LEFT-only majority among labeled facilities.

        Fixture `places_direction_vote.json` places (上り) facilities mostly
        on the RIGHT (east, unreachable) side — 3 of them — plus one lone
        (上り) on the LEFT and a single (下り) on the LEFT. A LEFT-only vote
        would tie (1 up vs 1 down) or otherwise mis-resolve; each RIGHT-side
        (上り) instead casts a vote for the OPPOSITE label ("下り"), so the
        3 right-side votes plus the 1 left-side down vote (4 total) beat the
        lone left-side up vote (1), correctly resolving routeDir to 下り —
        the direction actually reachable from this route. Once routeDir is
        下り, the per-facility label match keeps only the correctly-labeled
        下り facility: the mislabeled-but-geometrically-left (上り) facility
        is dropped (label is primary once routeDir is known), and all three
        right-side (上り) facilities are dropped as the unreachable
        carriageway."""
        monkeypatch.setattr(mc, "_urlopen", _make_transport("places_direction_vote.json"))
        places = mc.places_rest_stops(
            "FAKE_KEY", DIRECTION_TEST_POLYLINE, {"route_type": "highway"}
        )
        assert len(places) == 1
        assert places[0]["name"] == "SA-E (下り)"


# ---------------------------------------------------------------------------
# 道の駅 (roadside station) exclusion on highway routes
# ---------------------------------------------------------------------------
#
# Places v1 Text Search's ``locationBias`` is a SOFT bias, not a hard
# geographic filter — a サービスエリア/パーキングエリア query can still
# return a 道の駅 that happens to sit near a sample point. 道の駅 are
# registered on general (non-expressway) roads and are unreachable from an
# expressway, so they must be excluded on highway routes while remaining
# intact on urban routes, where 道の駅 are the intended target.
class TestRoadsideStationExclusion:
    def test_highway_excludes_leaked_roadside_station(self, monkeypatch):
        """A 道の駅 leaked into a highway-context SA/PA search must be
        dropped; the legitimate SA result must remain."""
        monkeypatch.setattr(mc, "_urlopen", _make_transport("places_michinoeki_leak.json"))
        places = mc.places_rest_stops(
            "FAKE_KEY", DIRECTION_TEST_POLYLINE, {"route_type": "highway"}
        )
        names = {p["name"] for p in places}
        assert names == {"海老名SA"}

    def test_urban_route_keeps_roadside_station(self, monkeypatch):
        """On urban routes 道の駅 is the intended search target and must NOT
        be excluded."""
        monkeypatch.setattr(mc, "_urlopen", _make_transport("places_michinoeki_leak.json"))
        places = mc.places_rest_stops(
            "FAKE_KEY", DIRECTION_TEST_POLYLINE, {"route_type": "urban"}
        )
        names = {p["name"] for p in places}
        assert names == {"海老名SA", "道の駅 談合坂"}


# ---------------------------------------------------------------------------
# Off-route filter (fixbug-0806)
# ---------------------------------------------------------------------------
#
# A large search radius (previously 25km) combined with Places Text Search's
# soft locationBias let facilities many km perpendicular from the route get
# returned, which _distance_along_route then silently projects onto the
# route as if they were reachable from it. Every place is now only kept if
# it sits within _PLACES_OFFROUTE_MAX_M of the route polyline itself
# (approximated as distance to the nearest polyline vertex) — this applies
# regardless of type/bucket/source, independent of the direction filter and
# roadside-station exclusion above.
class TestOffRouteFilter:
    def test_drops_place_beyond_offroute_cap_keeps_place_within_cap(self, monkeypatch):
        """Of two convenience_store results on the same DIRECTION_TEST_POLYLINE
        sample point, the one ~1.2km off the route (within the 2km cap)
        survives; the one ~2.9km off the route (beyond the cap) is dropped."""
        conv_bytes = json.dumps({
            "places": [
                {
                    "id": "conv_near",
                    "displayName": {"text": "Near Convenience Store"},
                    "types": ["convenience_store", "point_of_interest", "establishment"],
                    "location": {"latitude": 35.05, "longitude": 139.005},
                },
                {
                    "id": "conv_far",
                    "displayName": {"text": "Far Convenience Store"},
                    "types": ["convenience_store", "point_of_interest", "establishment"],
                    "location": {"latitude": 35.05, "longitude": 139.03},
                },
            ]
        }).encode("utf-8")
        empty_bytes = b'{"places": []}'

        def bucketed_transport(url, *, data=None, headers=None):
            body = json.loads(data) if data is not None else {}
            if body.get("includedTypes") == ["convenience_store"]:
                return conv_bytes
            return empty_bytes

        monkeypatch.setattr(mc, "_urlopen", bucketed_transport)
        places = mc.places_rest_stops(
            "FAKE_KEY", DIRECTION_TEST_POLYLINE, {"route_type": "urban"}
        )

        names = {p["name"] for p in places}
        assert names == {"Near Convenience Store"}, (
            f"Expected only the within-cap facility to survive; got {names!r}"
        )


# A 7-vertex, evenly-spaced (~1822m gaps) straight-line polyline dedicated to
# the road-class-match projection tests below. The segment bounds are
# deliberately offset half a gap from every vertex position (1500m/2000m/
# 2500m, not 1000m-aligned) so each vertex's road-class classification has a
# healthy margin from any segment boundary — vertices 0,1 classify HIGHWAY,
# 2,3 classify LOCAL, 4,5,6 classify HIGHWAY — see
# TestRoadClassMatchProjection. (An earlier version aligned segment bounds
# exactly on vertex positions, which put vertex 2 right on a HIGHWAY/LOCAL
# boundary and flipped its classification on float rounding — hence the
# offset.)
ROAD_CLASS_MATCH_POLYLINE = _encode_polyline([
    (35.0, 139.00 + 0.02 * i) for i in range(7)
])
ROAD_CLASS_MATCH_SEGMENTS = [
    {"road_class": "HIGHWAY", "maneuver": "merge", "distance_m": 1500},
    {"road_class": "LOCAL", "maneuver": "turn-right", "distance_m": 2000},
    {"road_class": "HIGHWAY", "maneuver": "merge", "distance_m": 2500},
]


class TestRoadClassMatchProjection:
    """fixbug-0806 Task 1 — the "7-Eleven on the highway" regression guard.

    A local-sourced place (convenience_store/道の駅) must project onto the
    nearest vertex of its OWN road class (LOCAL), never onto a nearer
    vertex of a different class (HIGHWAY) — a motor-only expressway has no
    at-grade access to a surface convenience store, so snapping onto the
    nearest vertex of ANY class (the pre-fix behaviour) could wrongly offer
    a driver on the expressway a "rest ahead" they have no ramp to reach.
    """

    def test_local_place_projects_onto_own_class_vertex_or_drops_if_out_of_cap(
        self, monkeypatch
    ):
        """Two convenience_store results on ROAD_CLASS_MATCH_POLYLINE:

        - "Reachable 7-Eleven" sits exactly at vertex 1 (HIGHWAY — the
          nearest vertex of ANY class), but vertex 2 (the nearest LOCAL
          vertex) is only ~1818m away — within the 2km off-route cap. The
          fix must project it onto vertex 2 and keep it, NOT snap it onto
          the nearer HIGHWAY vertex 1.
        - "Unreachable 7-Eleven" sits exactly at vertex 0 (HIGHWAY). Its
          nearest LOCAL vertex (vertex 2) is ~3636m away — beyond the 2km
          cap — so it must be dropped entirely, even though it is closer
          to the route (vertex 0, ~0m) than the survivor above.
        """
        conv_bytes = json.dumps({
            "places": [
                {
                    "id": "conv_reachable",
                    "displayName": {"text": "Reachable 7-Eleven"},
                    "types": ["convenience_store", "point_of_interest", "establishment"],
                    "location": {"latitude": 35.0, "longitude": 139.02},
                },
                {
                    "id": "conv_unreachable",
                    "displayName": {"text": "Unreachable 7-Eleven"},
                    "types": ["convenience_store", "point_of_interest", "establishment"],
                    "location": {"latitude": 35.0, "longitude": 139.00},
                },
            ]
        }).encode("utf-8")
        empty_bytes = b'{"places": []}'

        def bucketed_transport(url, *, data=None, headers=None):
            body = json.loads(data) if data is not None else {}
            if body.get("includedTypes") == ["convenience_store"]:
                return conv_bytes
            return empty_bytes

        monkeypatch.setattr(mc, "_urlopen", bucketed_transport)
        places = mc.places_rest_stops(
            "FAKE_KEY",
            ROAD_CLASS_MATCH_POLYLINE,
            {"route_type": "urban", "segments": ROAD_CLASS_MATCH_SEGMENTS},
        )

        names = {p["name"] for p in places}
        assert names == {"Reachable 7-Eleven"}, (
            f"Expected only the LOCAL-reachable facility to survive "
            f"road-class-match projection; got {names!r}"
        )
        # And it must have been projected onto vertex 2 (the LOCAL vertex,
        # ~2 gaps from the route start), not vertex 1 (the nearer HIGHWAY
        # vertex, ~1 gap from the start) — compare against the independently
        # computed cumulative distance of each candidate vertex.
        gap_m = mc._haversine_m(35.0, 139.00, 35.0, 139.02)
        survivor = next(p for p in places if p["name"] == "Reachable 7-Eleven")
        assert survivor["distance_along_route_m"] == pytest.approx(2 * gap_m, rel=0.01), (
            "Expected projection onto vertex 2 (LOCAL, ~2 gaps in), not "
            "vertex 1 (HIGHWAY, ~1 gap in)"
        )

    def test_gas_station_removed_from_local_nearby_types(self):
        """fixbug-0806 Task 2 — gas stations are not rest facilities and must
        never appear in the local Nearby Search type list."""
        assert "gas_station" not in mc._LOCAL_NEARBY_TYPES
        assert mc._LOCAL_NEARBY_TYPES == ("convenience_store",)


# ---------------------------------------------------------------------------
# Per-segment search classification (mixed routes)
# ---------------------------------------------------------------------------
#
# A single whole-route "highway"/"urban" verdict is wrong for a MIXED route
# (e.g. an urban approach onto an expressway, or an expressway exit back onto
# local roads): the urban stretch would wrongly run the SA/PA search and
# never the convenience search. Each sample point must classify itself
# against the ROUTE SEGMENT it actually falls in.
class TestPerSegmentSampling:
    def test_mixed_route_splits_search_strategy_by_segment(self, monkeypatch):
        """LONG_POLYLINE (~567km) with segments LOCAL 100km / HIGHWAY 400km /
        LOCAL 100km: per-run midpoint sampling (fixbug-0806, with the
        _PLACES_SAMPLE_STEP_M=8000/_PLACES_MAX_SAMPLE_POINTS=80 constants)
        puts candidate points in every run (12 in each 100km LOCAL run, 50 in
        the 400km HIGHWAY run — none dropped by the max-points cap, since
        12+50+12=74 <= 80), but LONG_POLYLINE only has 8 real vertices across
        the whole 567km route, so most candidates within a run snap to the
        same vertex or fall within the ~1500m dedup radius of an
        already-added point and are dropped — leaving 3 distinct
        local-classified points and 5 distinct highway-classified points
        surviving for this specific coarse test fixture. The
        highway-classified points must issue サービスエリア/パーキングエリア
        Text Search; the local-classified points must issue 道の駅 Text
        Search plus convenience_store Nearby Search — both strategies on the
        SAME route, not one verdict for the whole thing."""
        text_bodies: list[dict] = []
        nearby_bodies: list[dict] = []

        def capturing_transport(url: str, *, data: bytes | None = None, headers=None) -> bytes:
            body = json.loads(data)
            if url == mc._PLACES_V1_TEXT_URL:
                text_bodies.append(body)
            elif url == mc._PLACES_V1_NEARBY_URL:
                nearby_bodies.append(body)
            return b'{"places": []}'

        monkeypatch.setattr(mc, "_urlopen", capturing_transport)

        segments = [
            {"road_class": "LOCAL", "maneuver": "", "distance_m": 100_000},
            {"road_class": "HIGHWAY", "maneuver": "merge", "distance_m": 400_000},
            {"road_class": "LOCAL", "maneuver": "turn-right", "distance_m": 100_000},
        ]
        mc.places_rest_stops(
            "FAKE_KEY", LONG_POLYLINE, {"route_type": "highway", "segments": segments}
        )

        sa_pa_bodies = [b for b in text_bodies if b["textQuery"] in mc._HIGHWAY_TEXT_QUERIES]
        michi_bodies = [b for b in text_bodies if b["textQuery"] in mc._LOCAL_TEXT_QUERIES]

        assert {b["textQuery"] for b in sa_pa_bodies} == set(mc._HIGHWAY_TEXT_QUERIES), (
            f"Expected SA/PA text queries from highway-classified points; got {text_bodies!r}"
        )
        assert {b["textQuery"] for b in michi_bodies} == set(mc._LOCAL_TEXT_QUERIES), (
            f"Expected 道の駅 text query from local-classified points; got {text_bodies!r}"
        )
        included_types = {tuple(b["includedTypes"]) for b in nearby_bodies}
        assert included_types == {("convenience_store",)}, (
            f"Expected convenience_store-only Nearby Search from "
            f"local-classified points (gas_station is no longer searched, "
            f"fixbug-0806 Task 2); got {nearby_bodies!r}"
        )

        # 5 surviving highway-classified points x 2 queries; 3 surviving
        # local-classified points x (1 text query + 1 nearby search) — see
        # the dedup/vertex-snap collapse explained in the docstring above.
        assert len(sa_pa_bodies) == 5 * 2
        assert len(michi_bodies) == 3 * 1
        assert len(nearby_bodies) == 3 * 1

    def test_segments_absent_falls_back_to_whole_route_type(self, monkeypatch):
        """Back-compat: when context has no 'segments' key at all (an older
        caller, or any test that predates fix #3), every sample point must
        use the whole-route context['route_type'] verdict unchanged — the
        pre-fix-3 behaviour."""
        text_calls = 0
        nearby_calls = 0

        def counting_transport(url: str, **kwargs) -> bytes:
            nonlocal text_calls, nearby_calls
            if url == mc._PLACES_V1_TEXT_URL:
                text_calls += 1
            elif url == mc._PLACES_V1_NEARBY_URL:
                nearby_calls += 1
            return b'{"places": []}'

        monkeypatch.setattr(mc, "_urlopen", counting_transport)
        mc.places_rest_stops("FAKE_KEY", LONG_POLYLINE, {"route_type": "highway"})

        assert text_calls == mc._PLACES_SAMPLE_POINTS * 2
        assert nearby_calls == 0


# ---------------------------------------------------------------------------
# fixbug-0806 — per-run midpoint sampling guarantees a sample point on every
# contiguous road_class run, so a short genuine LOCAL stretch sandwiched
# between two HIGHWAY stretches (e.g. uc01_01_minatomirai_odawara segments
# [9]/[15]: a surface National Route crossing at an at-grade intersection)
# always gets searched for convenience_store/gas_station, instead of relying
# on evenly-spaced whole-route fractions that can skip it entirely.
# ---------------------------------------------------------------------------


class TestRunMidpointTargets:
    def test_short_local_run_sandwiched_by_highway_gets_its_own_midpoint(self):
        """A short LOCAL run flanked by two HIGHWAY runs still gets a sample
        point placed at exactly its own midpoint, classified LOCAL.

        Mirrors the real uc01_01 shape: HIGHWAY (13,273m) / LOCAL (1,923m,
        the genuine 国道1号 surface crossing) / HIGHWAY (6,071m). The LOCAL
        run is short enough that it gets exactly one point (its sole point,
        which is always "protected" from the max_points cap).
        """
        segments = [
            {"road_class": "HIGHWAY", "maneuver": "", "distance_m": 13_273},
            {"road_class": "LOCAL", "maneuver": "keep-right", "distance_m": 1_923},
            {"road_class": "HIGHWAY", "maneuver": "keep-right", "distance_m": 6_071},
        ]
        seg_bounds = mc._segment_bounds(segments)
        targets = mc._run_midpoint_targets(seg_bounds)

        local_targets = [t for t in targets if t[1] == "LOCAL"]
        assert len(local_targets) == 1

        seg_mid, road_class, protected, run_len = local_targets[0]
        local_run_start = 13_273.0
        local_run_len = 1_923.0
        assert seg_mid == local_run_start + local_run_len / 2
        assert road_class == "LOCAL"
        assert protected is True
        assert run_len == local_run_len

    def test_places_rest_stops_searches_sandwiched_local_run_midpoint(self, monkeypatch):
        """End-to-end through places_rest_stops: the sandwiched LOCAL run's
        midpoint sample point fires a 道の駅/convenience_store search, not a
        service_area (SA/PA) search — proving the fix reaches the public
        entry point, not just the internal helper."""
        text_bodies: list[dict] = []
        nearby_bodies: list[dict] = []

        def capturing_transport(url: str, *, data: bytes | None = None, headers=None) -> bytes:
            body = json.loads(data)
            if url == mc._PLACES_V1_TEXT_URL:
                text_bodies.append(body)
            elif url == mc._PLACES_V1_NEARBY_URL:
                nearby_bodies.append(body)
            return b'{"places": []}'

        monkeypatch.setattr(mc, "_urlopen", capturing_transport)

        segments = [
            {"road_class": "HIGHWAY", "maneuver": "", "distance_m": 13_273},
            {"road_class": "LOCAL", "maneuver": "keep-right", "distance_m": 1_923},
            {"road_class": "HIGHWAY", "maneuver": "keep-right", "distance_m": 6_071},
        ]
        mc.places_rest_stops(
            "FAKE_KEY", FINE_POLYLINE, {"route_type": "highway", "segments": segments}
        )

        michi_bodies = [b for b in text_bodies if b["textQuery"] in mc._LOCAL_TEXT_QUERIES]
        assert michi_bodies, "Expected a 道の駅 text query from the sandwiched LOCAL run's midpoint"
        included_types = {tuple(b["includedTypes"]) for b in nearby_bodies}
        assert ("convenience_store",) in included_types
        assert ("gas_station",) not in included_types, (
            "gas_station must never be searched (fixbug-0806 Task 2)"
        )
