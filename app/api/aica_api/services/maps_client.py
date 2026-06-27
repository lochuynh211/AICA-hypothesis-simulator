"""maps_client — stdlib-urllib Google Directions + Places edge module (M4 T003).

The ONLY module that touches the BYO API key server-side.  Pure I/O at the
edge; everything above it works on the returned plain dicts (RawRoute /
RawPlace).

Public API
----------
directions(key, start, end) -> list[RawRoute]
    Call Google Directions for free-text start/end; return up to 3 route
    alternatives as plain dicts.  Raises MapsError on any failure.

places_rest_stops(key, polyline, context) -> list[RawPlace]
    Find rest POIs near the route (encoded polyline), biased by context.
    Returns [] when none found — an empty result is NOT an error.
    Raises MapsError on transport/HTTP/quota failure.

RawRoute shape (plain dict, stable contract for route_analysis)
---------------------------------------------------------------
{
  "route_id":         str,          # "route-0" … "route-2" (stable per alternative)
  "summary":          str,          # human-readable route label
  "distance_m":       int,          # total route distance in metres
  "duration_s":       int,          # total route duration in seconds
  "encoded_polyline": str,          # Google encoded-polyline for the overview path
  "segments": [                     # one entry per Directions step
    {
      "road_class":  str,           # "HIGHWAY" | "LOCAL"
      "maneuver":    str,           # Google maneuver hint (may be "")
      "distance_m":  int            # step distance in metres
    },
    ...
  ]
}

RawPlace shape (plain dict, stable contract for route_analysis)
--------------------------------------------------------------
{
  "name":                   str,    # place display name
  "type":                   str,    # "service_area" | "convenience_store" | "other"
  "location": {
    "lat": float,
    "lng": float
  },
  "distance_along_route_m": float   # approximate distance along route from start (metres)
}

Injectable transport seam
-------------------------
The module exposes ``_urlopen: Callable[[str], bytes]`` at module level.
Tests monkeypatch this attribute to feed recorded fixtures — **no live network
in any test**.  The default implementation wraps ``urllib.request.urlopen``.

Key handling
------------
``key`` is a parameter only — never stored on the module, never logged.
Error messages MUST NOT include the key or a full request URL embedding it.
"""

from __future__ import annotations

import json
import math
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

# ---------------------------------------------------------------------------
# Type aliases (for documentation only — plain dicts at runtime)
# ---------------------------------------------------------------------------

RawRoute = dict[str, Any]
RawPlace = dict[str, Any]

# ---------------------------------------------------------------------------
# Google API endpoint constants
# ---------------------------------------------------------------------------

_DIRECTIONS_URL = "https://maps.googleapis.com/maps/api/directions/json"
_PLACES_NEARBY_URL = "https://maps.googleapis.com/maps/api/place/nearbysearch/json"

# Maximum number of route alternatives the client will return.
_MAX_ALTERNATIVES = 3

# Search radius (metres) for Places nearby search centred on route midpoint.
_PLACES_RADIUS_M = 50_000


# ---------------------------------------------------------------------------
# Public exception
# ---------------------------------------------------------------------------


class MapsError(Exception):
    """Raised for any Google Maps API or transport failure.

    Attributes
    ----------
    error_type : str
        One of: "directions_failure", "places_failure", "invalid_key", "quota".
    message : str
        Human-readable description.  MUST NOT contain the API key.
    """

    def __init__(self, error_type: str, message: str) -> None:
        super().__init__(message)
        self.error_type = error_type
        self.message = message


# ---------------------------------------------------------------------------
# Injectable transport seam
# ---------------------------------------------------------------------------


def _default_urlopen(url: str) -> bytes:
    """Fetch *url* and return the response body as bytes.

    Uses stdlib urllib.request.  The URL includes the API key — it is never
    stored or logged by this module.

    Guard: if this function is called inside a pytest run (PYTEST_CURRENT_TEST
    is set by pytest), it raises RuntimeError immediately instead of making a
    live network call.  Tests that need network responses must monkeypatch
    ``_urlopen`` before calling any maps_client function.
    """
    if os.getenv("PYTEST_CURRENT_TEST"):
        raise RuntimeError(
            "_urlopen not mocked — no live network allowed in tests. "
            "Monkeypatch maps_client._urlopen in your test."
        )
    req = urllib.request.Request(url, headers={"User-Agent": "aica-simulator/1.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310
        return resp.read()


# Module-level injectable transport.  Tests monkeypatch this attribute.
_urlopen: Callable[[str], bytes] = _default_urlopen


# ---------------------------------------------------------------------------
# Private helpers — URL building (key appended last, never echoed in errors)
# ---------------------------------------------------------------------------


def _build_url(base: str, params: dict[str, Any], key: str) -> str:
    """Build a full Google API request URL.

    The key is appended last; it is intentionally excluded from any log or
    error message produced by this module.
    """
    query = urllib.parse.urlencode({k: str(v) for k, v in params.items()})
    return f"{base}?{query}&key={key}"


# ---------------------------------------------------------------------------
# Private helpers — JSON fetching and status checking
# ---------------------------------------------------------------------------


def _fetch_json(url: str, error_type: str) -> dict[str, Any]:
    """Fetch *url* and parse the body as JSON.

    Raises
    ------
    MapsError(error_type, ...)
        On transport error (URLError) or malformed JSON.  The URL (and thus
        the API key) never appears in the error message.
    """
    try:
        data = _urlopen(url)
    except urllib.error.URLError as exc:
        raise MapsError(error_type, f"Network error: {type(exc).__name__}") from exc
    try:
        return json.loads(data)
    except (json.JSONDecodeError, ValueError) as exc:
        raise MapsError(error_type, "Invalid JSON in API response") from exc


def _check_status(
    payload: dict[str, Any],
    error_type: str,
    *,
    zero_results_is_error: bool = True,
) -> None:
    """Inspect the Google API ``status`` field; raise MapsError for failures.

    Parameters
    ----------
    zero_results_is_error:
        True for Directions (no route = failure).
        False for Places (no results = acceptable empty list).
    """
    status = payload.get("status", "")
    if status == "OK":
        return
    if status == "ZERO_RESULTS":
        if not zero_results_is_error:
            return  # Places — empty list is fine
        raise MapsError(error_type, "No results found (ZERO_RESULTS)")
    if status == "REQUEST_DENIED":
        # Never echo the key; the denial message is sufficient.
        raise MapsError("invalid_key", "API key was rejected (REQUEST_DENIED)")
    if status in {"OVER_DAILY_LIMIT", "OVER_QUERY_LIMIT"}:
        raise MapsError("quota", f"Quota exceeded ({status})")
    raise MapsError(error_type, f"API returned status {status!r}")


# ---------------------------------------------------------------------------
# Private helpers — Google encoded polyline decoder
# ---------------------------------------------------------------------------


def _decode_polyline(encoded: str) -> list[tuple[float, float]]:
    """Decode a Google encoded polyline string to a list of (lat, lng) tuples.

    Implements the standard variable-length encoding described at:
    https://developers.google.com/maps/documentation/utilities/polylinealgorithm
    """
    points: list[tuple[float, float]] = []
    index = 0
    length = len(encoded)
    lat = 0
    lng = 0

    while index < length:
        # Decode one coordinate component (latitude, then longitude).
        for coord_idx in range(2):
            result = 0
            shift = 0
            while True:
                if index >= length:
                    raise ValueError("Truncated encoded polyline")
                b = ord(encoded[index]) - 63
                index += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            delta = ~(result >> 1) if (result & 1) else (result >> 1)
            if coord_idx == 0:
                lat += delta
            else:
                lng += delta

        points.append((lat / 1e5, lng / 1e5))

    return points


# ---------------------------------------------------------------------------
# Private helpers — distance calculations (haversine, projection)
# ---------------------------------------------------------------------------


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Return the great-circle distance in metres between two lat/lng points."""
    R = 6_371_000.0  # Earth mean radius in metres
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lam = math.radians(lng2 - lng1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lam / 2) ** 2
    return 2.0 * R * math.asin(math.sqrt(a))


def _cumulative_distances(points: list[tuple[float, float]]) -> list[float]:
    """Return cumulative great-circle distances (metres) for decoded polyline points.

    The first entry is always 0.0.  The list has the same length as *points*.
    """
    cum: list[float] = [0.0]
    for i in range(1, len(points)):
        seg_dist = _haversine_m(
            points[i - 1][0], points[i - 1][1],
            points[i][0], points[i][1],
        )
        cum.append(cum[-1] + seg_dist)
    return cum


def _distance_along_route(
    poi: tuple[float, float],
    route_points: list[tuple[float, float]],
    cum_dist: list[float],
) -> float:
    """Approximate the along-route distance (metres) for a POI.

    Finds the closest polyline vertex to the POI and returns the cumulative
    distance to that vertex.
    """
    if not route_points:
        return 0.0
    best_idx = 0
    best_d = _haversine_m(poi[0], poi[1], route_points[0][0], route_points[0][1])
    for i, pt in enumerate(route_points[1:], 1):
        d = _haversine_m(poi[0], poi[1], pt[0], pt[1])
        if d < best_d:
            best_d = d
            best_idx = i
    return cum_dist[best_idx]


# ---------------------------------------------------------------------------
# Private helpers — road class inference
# ---------------------------------------------------------------------------


def _infer_road_class(step: dict[str, Any]) -> str:
    """Infer a simplified road class from a Directions step dict."""
    maneuver = step.get("maneuver", "").lower()
    instructions = step.get("html_instructions", "").lower()
    if (
        "merge" in maneuver
        or "ramp" in maneuver
        or "motorway" in instructions
        or "highway" in instructions
    ):
        return "HIGHWAY"
    return "LOCAL"


# ---------------------------------------------------------------------------
# Private helpers — POI type classification
# ---------------------------------------------------------------------------


def _classify_place_type(google_types: list[str], route_type: str) -> str:
    """Map Google Places ``types`` list to the RawPlace type literal.

    Vocabulary: "service_area" | "convenience_store" | "other"

    On highway routes, gas stations and parking/rest stops are classified as
    service areas.  Convenience stores are identified by their explicit type.
    """
    type_set = set(google_types)
    if "service_area" in type_set or "rest_stop" in type_set:
        return "service_area"
    if route_type == "highway" and (
        "gas_station" in type_set or "parking" in type_set
    ):
        return "service_area"
    if "convenience_store" in type_set:
        return "convenience_store"
    return "other"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def directions(key: str, start: str, end: str) -> list[RawRoute]:
    """Call Google Directions API and return up to 3 RawRoute alternatives.

    Parameters
    ----------
    key:   Google Maps API key (never stored, never logged, never in errors).
    start: Free-text origin address (Directions geocodes it).
    end:   Free-text destination address.

    Returns
    -------
    list[RawRoute]
        Between 0 and 3 items; may be empty only when a non-error status
        provides no routes (callers should treat an empty list as a soft
        failure and use the local fallback).

    Raises
    ------
    MapsError("directions_failure", ...)
        ZERO_RESULTS, transport error, or any non-key/quota API error.
    MapsError("invalid_key", ...)
        REQUEST_DENIED from Google.
    MapsError("quota", ...)
        OVER_DAILY_LIMIT or OVER_QUERY_LIMIT.
    """
    params: dict[str, Any] = {
        "origin": start,
        "destination": end,
        "alternatives": "true",
        "mode": "driving",
    }
    url = _build_url(_DIRECTIONS_URL, params, key)
    payload = _fetch_json(url, "directions_failure")
    _check_status(payload, "directions_failure", zero_results_is_error=True)

    routes: list[RawRoute] = []
    for i, route in enumerate(payload.get("routes", [])[:_MAX_ALTERNATIVES]):
        legs = route.get("legs", [])
        leg = legs[0] if legs else {}

        segments: list[dict[str, Any]] = [
            {
                "road_class": _infer_road_class(step),
                "maneuver": step.get("maneuver", ""),
                "distance_m": step.get("distance", {}).get("value", 0),
            }
            for step in leg.get("steps", [])
        ]

        routes.append(
            {
                "route_id": f"route-{i}",
                "summary": route.get("summary", ""),
                "distance_m": leg.get("distance", {}).get("value", 0),
                "duration_s": leg.get("duration", {}).get("value", 0),
                "encoded_polyline": route.get("overview_polyline", {}).get("points", ""),
                "segments": segments,
            }
        )

    return routes


def places_rest_stops(
    key: str,
    polyline: str,
    context: dict[str, Any],
) -> list[RawPlace]:
    """Find rest POIs near the route and return a list of RawPlace dicts.

    Uses Google Places Nearby Search, biased by *context*.  On highway
    routes, searches for gas stations / service areas; otherwise searches for
    convenience stores.

    Parameters
    ----------
    key:      Google Maps API key (never stored, never logged, never in errors).
    polyline: Google encoded overview polyline from a RawRoute.
    context:  Dict with at least ``{"route_type": "highway" | "urban" | ...}``.

    Returns
    -------
    list[RawPlace]
        May be empty — an empty result means "none found" and is NOT an error.

    Raises
    ------
    MapsError("places_failure", ...)
        Transport error or any non-key/quota server error.
    MapsError("invalid_key", ...)
        REQUEST_DENIED from Google.
    MapsError("quota", ...)
        Quota exceeded.
    """
    # Decode polyline to derive a search centre (route midpoint).
    try:
        route_points = _decode_polyline(polyline)
    except (ValueError, IndexError):
        # Invalid/empty polyline — cannot search; return graceful empty.
        return []

    if not route_points:
        return []

    mid_idx = len(route_points) // 2
    center_lat, center_lng = route_points[mid_idx]

    # Choose POI type based on route context.
    route_type = context.get("route_type", "urban")
    place_type = "gas_station" if route_type == "highway" else "convenience_store"

    params: dict[str, Any] = {
        "location": f"{center_lat},{center_lng}",
        "radius": _PLACES_RADIUS_M,
        "type": place_type,
    }
    url = _build_url(_PLACES_NEARBY_URL, params, key)
    payload = _fetch_json(url, "places_failure")
    _check_status(payload, "places_failure", zero_results_is_error=False)

    results = payload.get("results", [])
    if not results:
        return []

    # Pre-compute cumulative distances for along-route projection.
    cum_dist = _cumulative_distances(route_points)

    places: list[RawPlace] = []
    for result in results:
        geom = result.get("geometry", {}).get("location", {})
        lat = float(geom.get("lat", 0.0))
        lng = float(geom.get("lng", 0.0))
        google_types: list[str] = result.get("types", [])

        dist_along = _distance_along_route((lat, lng), route_points, cum_dist)

        places.append(
            {
                "name": result.get("name", ""),
                "type": _classify_place_type(google_types, route_type),
                "location": {"lat": lat, "lng": lng},
                "distance_along_route_m": dist_along,
            }
        )

    return places
