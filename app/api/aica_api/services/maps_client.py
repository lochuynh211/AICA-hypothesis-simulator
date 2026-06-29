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

# Number of evenly-spaced sample points along the route for Places searches.
# Exactly this many Nearby Search calls are made per route (bounded to cap quota).
_PLACES_SAMPLE_POINTS = 6

# Search radius (metres) for each per-point Places Nearby Search.
# Reduced from the former 50 km single-midpoint radius because we now have
# multiple overlapping bubbles spanning the whole route.
_PLACES_RADIUS_M = 25_000

# Minimum step distance (metres) that triggers the long-step HIGHWAY heuristic.
# A continuous step of 8 km or more with no maneuver and no highway keyword is
# almost always an expressway main section (e.g. a 30–100 km stretch on the
# Tomei or Meishin expressway that Google returns as a single step with no
# "Merge" maneuver and whose Japanese-language html_instructions won't match
# English keywords).  This acts as a cross-language safety net so that routes
# returned without language=en still classify correctly.
_HIGHWAY_MIN_STEP_M = 8_000

# Keywords in (lowercased) html_instructions that indicate a highway-class step.
# These appear when Google returns step text in English (language=en request param).
_HIGHWAY_INSTRUCTION_KEYWORDS: tuple[str, ...] = (
    "highway",
    "motorway",
    "freeway",
    "expressway",
    "expwy",
    "interstate",
    "toll",
)


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
    """Infer a simplified road class from a raw Google Directions step dict.

    Returns "HIGHWAY" when ANY of the following conditions hold:
      1. Maneuver — step.maneuver contains "merge" or "ramp".
      2. Keyword   — step.html_instructions (lowercased) contains any of the
                     strings in _HIGHWAY_INSTRUCTION_KEYWORDS (highway, motorway,
                     freeway, expressway, expwy, interstate, toll).  These appear
                     when Google returns English text (language=en param).
      3. Long-step — step.distance.value >= _HIGHWAY_MIN_STEP_M (8 km).  A
                     multi-km step with no maneuver and no keyword is almost
                     certainly an expressway main section — this is the
                     cross-language safety net for routes whose step text arrives
                     in a non-English script.
    Otherwise returns "LOCAL".
    """
    maneuver = step.get("maneuver", "").lower()
    instructions = step.get("html_instructions", "").lower()
    distance_m: int = step.get("distance", {}).get("value", 0)

    if (
        "merge" in maneuver
        or "ramp" in maneuver
        or any(kw in instructions for kw in _HIGHWAY_INSTRUCTION_KEYWORDS)
        or distance_m >= _HIGHWAY_MIN_STEP_M
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
        "language": "en",  # ensure step text is English so keyword checks are reliable
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
    """Find rest POIs along the whole route and return a list of RawPlace dicts.

    Strategy: decode the polyline, pick ``_PLACES_SAMPLE_POINTS`` evenly-spaced
    sample points (at 1/(n+1), 2/(n+1) … n/(n+1) of total route distance), and
    run one Places Nearby Search per point.  Results from all points are merged,
    deduped by ``place_id`` (falling back to name + rounded lat/lng when absent),
    projected onto the route to compute ``distance_along_route_m``, and returned
    sorted ascending by that distance.

    Search params per point:
      - ``keyword="service area rest area"`` — the primary broadening term; finds
        Japanese expressway service areas (サービスエリア) and roadside rest stops
        beyond what a single POI type can capture.
      - ``type="gas_station"`` (highway routes only) — additional bias per spec;
        omitted on urban routes to maximise recall via keyword alone.
      - ``radius=_PLACES_RADIUS_M`` (25 km) — smaller per-point bubble because
        multiple overlapping bubbles now span the whole route.

    Exactly ``_PLACES_SAMPLE_POINTS`` HTTP calls are made per invocation (the
    sample algorithm always picks that many, some may coincide for very short
    polylines — duplicates are removed by the dedup step).

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
    # Decode polyline to a list of (lat, lng) vertices.
    try:
        route_points = _decode_polyline(polyline)
    except (ValueError, IndexError):
        # Invalid/empty polyline — cannot search; return graceful empty.
        return []

    if not route_points:
        return []

    # Pre-compute cumulative distances for sample-point selection and projection.
    cum_dist = _cumulative_distances(route_points)
    total_dist = cum_dist[-1]

    # Route context controls search params.
    route_type = context.get("route_type", "urban")

    # ── Sample point selection ────────────────────────────────────────────────
    # Pick _PLACES_SAMPLE_POINTS interior fractions: 1/(n+1), 2/(n+1) … n/(n+1)
    # of total route distance.  For n=6: 1/7, 2/7, 3/7, 4/7, 5/7, 6/7 — spans
    # the whole route without clustering at the endpoints.  For short polylines
    # multiple fractions may map to the same vertex; the dedup step handles that.
    n_samples = _PLACES_SAMPLE_POINTS
    sample_points: list[tuple[float, float]] = []
    for i in range(1, n_samples + 1):
        target = total_dist * i / (n_samples + 1)
        # Find the polyline vertex whose cumulative distance is closest to target.
        best_idx = min(range(len(cum_dist)), key=lambda j: abs(cum_dist[j] - target))
        sample_points.append(route_points[best_idx])

    # ── Per-point Nearby Searches ─────────────────────────────────────────────
    all_results: list[dict[str, Any]] = []
    for s_lat, s_lng in sample_points:
        params: dict[str, Any] = {
            "location": f"{s_lat},{s_lng}",
            "radius": _PLACES_RADIUS_M,
            "keyword": "service area rest area",
        }
        if route_type == "highway":
            # Keep gas_station as an additional bias on highway routes (spec §3).
            params["type"] = "gas_station"
        # (Urban routes: keyword alone to avoid narrowing recall via type.)
        url = _build_url(_PLACES_NEARBY_URL, params, key)
        payload = _fetch_json(url, "places_failure")
        _check_status(payload, "places_failure", zero_results_is_error=False)
        all_results.extend(payload.get("results", []))

    if not all_results:
        return []

    # ── Dedupe by place_id (fall back to name + rounded coords if absent) ────
    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for result in all_results:
        pid = result.get("place_id")
        if pid:
            dedup_key = f"pid:{pid}"
        else:
            geom = result.get("geometry", {}).get("location", {})
            rlat = round(float(geom.get("lat", 0.0)), 4)
            rlng = round(float(geom.get("lng", 0.0)), 4)
            dedup_key = f"name:{result.get('name', '')}:{rlat}:{rlng}"
        if dedup_key in seen:
            continue
        seen.add(dedup_key)
        deduped.append(result)

    # ── Project onto route, build RawPlace list, sort ascending ──────────────
    places: list[RawPlace] = []
    for result in deduped:
        geom = result.get("geometry", {}).get("location", {})
        plat = float(geom.get("lat", 0.0))
        plng = float(geom.get("lng", 0.0))
        google_types: list[str] = result.get("types", [])

        dist_along = _distance_along_route((plat, plng), route_points, cum_dist)

        places.append(
            {
                "name": result.get("name", ""),
                "type": _classify_place_type(google_types, route_type),
                "location": {"lat": plat, "lng": plng},
                "distance_along_route_m": dist_along,
            }
        )

    places.sort(key=lambda p: p["distance_along_route_m"])
    return places
