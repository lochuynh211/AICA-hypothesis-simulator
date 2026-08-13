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
  "type":                   str,    # "service_area" | "convenience_store" |
                                     # "gas_station" | "other"
  "location": {
    "lat": float,
    "lng": float
  },
  "distance_along_route_m": float   # approximate distance along route from start (metres)
}

Injectable transport seam
-------------------------
The module exposes ``_urlopen: Callable[..., bytes]`` at module level.  Tests
monkeypatch this attribute to feed recorded fixtures — **no live network in
any test**.  The default implementation wraps ``urllib.request.urlopen``.  It
accepts an optional ``data``/``headers`` keyword pair: when ``data`` is not
None a POST is issued (used by the Places v1 endpoints); otherwise a GET is
issued (used by Directions, unchanged).

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

# Directions stays on the legacy (GET) API — language=en is required so the
# English step text keeps the road-class keyword heuristic reliable.
_DIRECTIONS_URL = "https://maps.googleapis.com/maps/api/directions/json"

# Places moved to the v1 (POST, JSON body) API for both search modes.
_PLACES_V1_TEXT_URL = "https://places.googleapis.com/v1/places:searchText"
_PLACES_V1_NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby"
_PLACES_FIELD_MASK = "places.id,places.displayName,places.types,places.location"

# Maximum number of route alternatives the client will return.
_MAX_ALTERNATIVES = 3

# Number of evenly-spaced sample points along the route for Places searches.
# Each sample point triggers one or more searches (bounded to cap quota).
_PLACES_SAMPLE_POINTS = 6

# Search radius (metres) for each per-point Places search. Kept small and
# paired with _PLACES_OFFROUTE_MAX_M / the off-route filter in
# places_rest_stops (fixbug-0806): a large radius (previously 25km) lets a
# Text Search's soft locationBias pull in facilities many km perpendicular
# from the route (median SA/PA ~9km off-route observed; 道の駅 leaking
# 17-62km off-route), which then get silently projected onto the route by
# _distance_along_route as if they were reachable from it.
_PLACES_RADIUS_M = 5_000

# Japanese-language search terms — confirmed via live probe to give the best
# recall for Japanese expressway/roadside rest facilities (far better than
# English keywords or a bare POI-type filter, which mostly surfaces gas
# stations).
#
# Highway (expressway) routes: search for service areas (サービスエリア) and
# parking areas (パーキングエリア) via Text Search.
_HIGHWAY_TEXT_QUERIES: tuple[str, ...] = ("サービスエリア", "パーキングエリア")

# Non-highway (local/urban) routes: search for roadside stations (道の駅) via
# Text Search, plus Nearby Search for convenience stores to broaden recall
# beyond the (much rarer) 道の駅 facilities. Gas stations are NOT rest
# facilities — they were removed from this search (fixbug-0806 Task 2).
_LOCAL_TEXT_QUERIES: tuple[str, ...] = ("道の駅",)
_LOCAL_NEARBY_TYPES: tuple[str, ...] = ("convenience_store",)

# Minimum step distance (metres) that triggers the long-step HIGHWAY heuristic.
# A continuous step of 8 km or more with no maneuver and no highway keyword is
# almost always an expressway main section (e.g. a 30–100 km stretch on the
# Tomei or Meishin expressway that Google returns as a single step with no
# "Merge" maneuver and whose Japanese-language html_instructions won't match
# English keywords).  This acts as a cross-language safety net so that routes
# returned without language=en still classify correctly.
_HIGHWAY_MIN_STEP_M = 8_000

# Keywords in (lowercased) html_instructions that indicate a highway-class step.
# These appear when Google returns step text in English (language=en param).
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


def _default_urlopen(
    url: str,
    *,
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
) -> bytes:
    """Fetch *url* and return the response body as bytes.

    Uses stdlib urllib.request.  When *data* is provided a POST request is
    issued with *headers* attached (used by the Places v1 JSON endpoints);
    otherwise a GET request is issued (used by Directions).  The URL/body may
    include the API key — it is never stored or logged by this module.

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
    if data is not None:
        req = urllib.request.Request(url, data=data, headers=headers or {}, method="POST")
    else:
        req = urllib.request.Request(url, headers={"User-Agent": "aica-simulator/1.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310
        return resp.read()


# Module-level injectable transport.  Tests monkeypatch this attribute.
_urlopen: Callable[..., bytes] = _default_urlopen


# ---------------------------------------------------------------------------
# Private helpers — URL building (key appended last, never echoed in errors)
# ---------------------------------------------------------------------------


def _build_url(base: str, params: dict[str, Any], key: str) -> str:
    """Build a full Google API request URL (legacy GET endpoints only).

    The key is appended last; it is intentionally excluded from any log or
    error message produced by this module.
    """
    query = urllib.parse.urlencode({k: str(v) for k, v in params.items()})
    return f"{base}?{query}&key={key}"


# ---------------------------------------------------------------------------
# Private helpers — JSON fetching and status checking (legacy Directions API)
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

    Used by the legacy Directions API only (Places moved to v1, which reports
    errors via HTTP status codes instead of a ``status`` field — see
    ``_places_v1_fetch``).

    Parameters
    ----------
    zero_results_is_error:
        True for Directions (no route = failure).
    """
    status = payload.get("status", "")
    if status == "OK":
        return
    if status == "ZERO_RESULTS":
        if not zero_results_is_error:
            return
        raise MapsError(error_type, "No results found (ZERO_RESULTS)")
    if status == "REQUEST_DENIED":
        # Never echo the key; the denial message is sufficient.
        raise MapsError("invalid_key", "API key was rejected (REQUEST_DENIED)")
    if status in {"OVER_DAILY_LIMIT", "OVER_QUERY_LIMIT"}:
        raise MapsError("quota", f"Quota exceeded ({status})")
    raise MapsError(error_type, f"API returned status {status!r}")


# ---------------------------------------------------------------------------
# Private helpers — Places v1 JSON POST fetching and error mapping
# ---------------------------------------------------------------------------

# Google Places v1 ``error.status`` values that indicate a rejected/invalid key.
_PLACES_V1_KEY_ERROR_STATUSES = {"PERMISSION_DENIED", "REQUEST_DENIED", "UNAUTHENTICATED"}

# Google Places v1 ``error.status`` values that indicate quota exhaustion.
_PLACES_V1_QUOTA_ERROR_STATUSES = {"RESOURCE_EXHAUSTED"}


def _places_v1_fetch(url: str, body: dict[str, Any], key: str) -> list[dict[str, Any]]:
    """POST *body* to a Places v1 endpoint and return the ``places`` list.

    Returns
    -------
    list[dict]
        The ``places`` array from the response, or [] when absent/empty — an
        empty result is NOT an error under Places v1.

    Raises
    ------
    MapsError("invalid_key", ...)
        HTTP error with ``error.status`` in {PERMISSION_DENIED, REQUEST_DENIED,
        UNAUTHENTICATED}.
    MapsError("quota", ...)
        HTTP error with ``error.status`` == RESOURCE_EXHAUSTED (or any status
        starting with "OVER_", kept for forward compatibility with legacy-style
        quota status strings).
    MapsError("places_failure", ...)
        Any other HTTP error, network error, or malformed JSON.  The key and
        request URL never appear in the message.
    """
    payload_bytes = json.dumps(body).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": _PLACES_FIELD_MASK,
    }
    try:
        data = _urlopen(url, data=payload_bytes, headers=headers)
    except urllib.error.HTTPError as exc:
        try:
            err_payload = json.loads(exc.read())
        except (json.JSONDecodeError, ValueError, AttributeError, OSError):
            err_payload = {}
        error_obj = err_payload.get("error", {}) if isinstance(err_payload, dict) else {}
        status = error_obj.get("status", "")
        if status in _PLACES_V1_KEY_ERROR_STATUSES:
            raise MapsError("invalid_key", f"API key was rejected ({status})") from exc
        if status in _PLACES_V1_QUOTA_ERROR_STATUSES or status.startswith("OVER_"):
            raise MapsError("quota", f"Quota exceeded ({status})") from exc
        if status:
            raise MapsError("places_failure", f"API returned status {status!r}") from exc
        raise MapsError("places_failure", f"HTTP error ({exc.code})") from exc
    except urllib.error.URLError as exc:
        raise MapsError("places_failure", f"Network error: {type(exc).__name__}") from exc

    try:
        parsed = json.loads(data)
    except (json.JSONDecodeError, ValueError) as exc:
        raise MapsError("places_failure", "Invalid JSON in API response") from exc

    return parsed.get("places") or []


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


def _nearest_vertex_index(
    poi: tuple[float, float],
    route_points: list[tuple[float, float]],
) -> int:
    """Return the index of the polyline vertex nearest (great-circle) to *poi*.

    Shared by ``_distance_along_route`` (along-route projection) and the
    direction-filter helpers below (which need the vertex index itself, not
    just the cumulative distance to it).
    """
    best_idx = 0
    best_d = _haversine_m(poi[0], poi[1], route_points[0][0], route_points[0][1])
    for i, pt in enumerate(route_points[1:], 1):
        d = _haversine_m(poi[0], poi[1], pt[0], pt[1])
        if d < best_d:
            best_d = d
            best_idx = i
    return best_idx


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
    return cum_dist[_nearest_vertex_index(poi, route_points)]


# ---------------------------------------------------------------------------
# Private helpers — highway carriageway (up/down) direction filter
# ---------------------------------------------------------------------------
#
# Japanese expressway Service Areas (SA/サービスエリア) and Parking Areas
# (PA/パーキングエリア) are direction-specific: the 上り (inbound, generally
# toward Tokyo) and 下り (outbound) facilities sit on opposite sides of the
# median and are physically unreachable from the opposite carriageway. The
# live Places Text Search is only geographically radius-biased, so it returns
# BOTH directions' facilities indiscriminately — roughly half of what comes
# back is a rest stop the driver can never actually pull into.
#
# Japan drives on the LEFT. Facing the direction of travel, the reachable
# SA/PA is therefore on the LEFT; the opposite-direction facility is across
# the median, to the RIGHT. ``_filter_reachable_direction`` below uses this
# to keep only same-side (reachable) facilities on highway routes.

_EARTH_RADIUS_M = 6_371_000.0

# A facility's side-of-travel is only meaningful when it actually sits close
# to the route (a real SA/PA offset from the centerline is at most a couple
# hundred metres — the width of an expressway plus median). Beyond this
# distance from its nearest route vertex, the "nearest vertex" is not really
# describing a local median offset at all, so the geometric side test would
# be noise rather than signal — treat it as ambiguous (kept) instead of
# rejecting on a meaningless sign.
_DIRECTION_SIDE_MAX_DIST_M = 5_000.0


def _local_xy(lat: float, lng: float, olat: float, olng: float) -> tuple[float, float]:
    """Convert (lat, lng) to local (east, north) metres relative to origin.

    Small-angle equirectangular approximation — accurate enough at the
    few-hundred-metre scale of a highway median / facility offset.
    """
    x = math.radians(lng - olng) * math.cos(math.radians(olat)) * _EARTH_RADIUS_M
    y = math.radians(lat - olat) * _EARTH_RADIUS_M
    return x, y


def _facility_side_distance(
    poi: tuple[float, float],
    idx: int,
    route_points: list[tuple[float, float]],
) -> float:
    """Signed perpendicular distance (metres) of *poi* from the route heading.

    Builds a smoothed local heading ``H`` from route vertices around *idx*
    (a +/-2 vertex window), then projects the facility's displacement ``D``
    from the route onto the perpendicular of ``H`` — i.e. the cross product
    ``H x D`` normalized by ``|H|`` so the result is an actual physical
    distance rather than a raw (heading-magnitude-dependent) cross-product
    area term. ``> 0`` means the facility is on the LEFT of the travel
    direction (the reachable side under left-hand traffic); ``< 0`` means the
    RIGHT (opposite carriageway, unreachable). A window that collapses at a
    route endpoint, or a degenerate (zero-length) heading, is ambiguous and
    returns ``0.0``.
    """
    n = len(route_points)
    i0 = max(0, idx - 2)
    i1 = min(n - 1, idx + 2)
    if i1 <= i0:
        return 0.0
    olat, olng = route_points[idx]
    hx0, hy0 = _local_xy(route_points[i0][0], route_points[i0][1], olat, olng)
    hx1, hy1 = _local_xy(route_points[i1][0], route_points[i1][1], olat, olng)
    hx, hy = hx1 - hx0, hy1 - hy0
    h_mag = math.hypot(hx, hy)
    if h_mag == 0.0:
        return 0.0
    dx, dy = _local_xy(poi[0], poi[1], olat, olng)
    return (hx * dy - hy * dx) / h_mag


# A facility whose perpendicular distance from the route heading is within
# this many metres of the line is too close to the centerline to trust its
# side for VOTING purposes (it may just be noise from the +/-2 vertex
# smoothing window). It can still be kept/dropped by the geometric fallback
# in `_filter_reachable_direction` — this floor only excludes it from
# contributing a vote toward `route_dir`.
_DIRECTION_VOTE_MIN_SIDE_M = 3.0


def _opposite_label(label: str) -> str:
    return "down" if label == "up" else "up"


def _extract_direction_label(name: str) -> str | None:
    """Extract a carriageway direction label from a facility display name.

    Highway SA/PA names commonly carry an explicit suffix, e.g.
    ``"海老名SA (上り)"`` (up/inbound) vs ``"海老名SA (下り)"`` (down/outbound).
    A plain substring check on the raw kanji handles both half-width and
    full-width parens (and any other punctuation) around the label. About
    87% of highway facility names carry a label; the rest fall back to the
    geometric left/right test in ``_filter_reachable_direction``.
    """
    if "上り" in name:
        return "up"
    if "下り" in name:
        return "down"
    return None


def _filter_reachable_direction(
    deduped: list[tuple[dict[str, Any], str]],
    route_points: list[tuple[float, float]],
) -> list[tuple[dict[str, Any], str]]:
    """Keep only same-carriageway (reachable) SA/PA facilities on a highway route.

    For each facility: locate its nearest route vertex, compute its signed
    perpendicular distance from the smoothed route heading (see
    ``_facility_side_distance``), and extract any 上り/下り name label.

    The route's own travel-direction label (``route_dir``) is then inferred
    via a BIDIRECTIONAL weighted vote over labeled facilities on EITHER side
    (excluding near-centerline/far-from-route ones too ambiguous to trust) —
    not just a majority among LEFT-side facilities. A short/winding route can
    have its LEFT-only vote flip on noise; voting both sides is far more
    robust:
      - a LEFT-side (reachable-side) facility votes for its OWN label — a
        LEFT-side 下り facility means we are traveling 下り;
      - a RIGHT-side (opposite-carriageway) facility votes for the OPPOSITE
        of its own label — a RIGHT-side 上り facility means WE are NOT
        traveling 上り, i.e. it's evidence FOR 下り.
    ``route_dir`` is the label with strictly more votes; a tie (including
    0-0) leaves it ``None``.

    A facility is kept iff:
      - the route direction was established AND the facility has a label:
        keep iff the label matches the route direction (label is primary —
        most reliable near interchanges/ramps where geometry gets noisy);
      - otherwise (no label on the facility, or no reliable route direction):
        fall back to geometry — keep iff the facility is NOT clearly on the
        RIGHT (perpendicular distance ``>= 0``, i.e. LEFT or ambiguous). A
        near-zero/far-from-route reading (e.g. a shared/集約 facility sitting
        right on the road, or a facility beyond ``_DIRECTION_SIDE_MAX_DIST_M``)
        is genuinely ambiguous, not evidence of unreachability, so it is kept
        rather than discarded.

    No-op (returns *deduped* unchanged) if there are too few route vertices
    to compute any heading.
    """
    if len(route_points) < 2:
        return deduped

    computed: list[tuple[dict[str, Any], str, float, str | None]] = []
    for result, bucket in deduped:
        loc = result.get("location", {})
        plat = float(loc.get("latitude", 0.0))
        plng = float(loc.get("longitude", 0.0))
        name = result.get("displayName", {}).get("text", "")
        idx = _nearest_vertex_index((plat, plng), route_points)
        nearest_dist = _haversine_m(plat, plng, route_points[idx][0], route_points[idx][1])
        if nearest_dist > _DIRECTION_SIDE_MAX_DIST_M:
            # Too far from the route to trust a local median-side reading.
            side_m = 0.0
        else:
            side_m = _facility_side_distance((plat, plng), idx, route_points)
        label = _extract_direction_label(name)
        computed.append((result, bucket, side_m, label))

    # Bidirectional weighted vote for route_dir (see docstring above).
    votes = {"up": 0, "down": 0}
    for _, _, side_m, label in computed:
        if label is None or abs(side_m) <= _DIRECTION_VOTE_MIN_SIDE_M:
            continue
        voted_label = label if side_m > 0 else _opposite_label(label)
        votes[voted_label] += 1

    if votes["up"] > votes["down"]:
        route_dir: str | None = "up"
    elif votes["down"] > votes["up"]:
        route_dir = "down"
    else:
        route_dir = None

    kept: list[tuple[dict[str, Any], str]] = []
    for result, bucket, side_m, label in computed:
        if label is not None and route_dir is not None:
            keep = label == route_dir
        else:
            # Ambiguous (near-zero/far-from-route) readings default to
            # "keep" — see docstring above.
            keep = side_m >= 0
        if keep:
            kept.append((result, bucket))
    return kept


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


def _classify_place_type(google_types: list[str], bucket: str) -> str:
    """Map a Places v1 result to the RawPlace type literal.

    Vocabulary: "service_area" | "convenience_store" | "gas_station" | "other"

    Classification is bucket-first: *bucket* names the search that found this
    place (e.g. "service_area" for a サービスエリア/パーキングエリア/道の駅
    Text Search hit, "convenience_store"/"gas_station" for a Nearby Search
    hit) — the search that found it is a strong signal of intent.  The Google
    ``types`` list is used as a cross-check/override: a place explicitly typed
    ``rest_stop`` or ``service_area`` by Google is always classified as a
    service area regardless of which search surfaced it.
    """
    type_set = set(google_types)
    if "rest_stop" in type_set or "service_area" in type_set:
        return "service_area"
    if bucket:
        return bucket
    if "convenience_store" in type_set:
        return "convenience_store"
    if "gas_station" in type_set:
        return "gas_station"
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


def _text_search_body(query: str, lat: float, lng: float) -> dict[str, Any]:
    return {
        "textQuery": query,
        "languageCode": "ja",
        "maxResultCount": 20,
        "locationBias": {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": float(_PLACES_RADIUS_M),
            }
        },
    }


def _nearby_search_body(included_type: str, lat: float, lng: float) -> dict[str, Any]:
    return {
        "includedTypes": [included_type],
        "maxResultCount": 5,
        "languageCode": "ja",
        "locationRestriction": {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": float(_PLACES_RADIUS_M),
            }
        },
    }


def _segment_bounds(segments: list[dict[str, Any]]) -> list[tuple[float, float, str]]:
    """Turn a route's per-step ``segments`` into cumulative-distance bounds.

    Returns ``[(start_m, end_m, road_class), ...]`` in step order, where
    ``start_m``/``end_m`` are cumulative distances along the ORIGINAL
    Directions step sequence (not the decoded polyline). Used to look up
    which road_class a given fraction of the route falls under — see
    ``_road_class_at``.
    """
    bounds: list[tuple[float, float, str]] = []
    cursor = 0.0
    for seg in segments:
        dist = float(seg.get("distance_m", 0) or 0)
        road_class = seg.get("road_class", "LOCAL")
        bounds.append((cursor, cursor + dist, road_class))
        cursor += dist
    return bounds


def _road_class_at(seg_target: float, seg_bounds: list[tuple[float, float, str]]) -> str:
    """Return the road_class of the segment containing ``seg_target`` metres.

    Falls back to the last segment's road_class if ``seg_target`` lands
    exactly on (or past, from float rounding) the route end, and to "LOCAL"
    if there are no segments at all.
    """
    for start_m, end_m, road_class in seg_bounds:
        if start_m <= seg_target < end_m:
            return road_class
    if seg_bounds:
        return seg_bounds[-1][2]
    return "LOCAL"


# Sample spacing (metres). Chosen so consecutive sample points' 5km search
# radii still overlap along the route even after accounting for the 2km
# off-route cap: STEP <= 2*sqrt(radius^2 - off_cap^2) = 2*sqrt(5000^2-2000^2)
# ~= 9.2km, with margin (fixbug-0806).
_PLACES_SAMPLE_STEP_M = 8_000

# Runaway backstop only — NOT meant to bind in practice. At 8km spacing this
# covers ~640km of contiguous same-road_class runs; every real preset route
# (longest is ~500km) sits comfortably under it. If this cap ever truncates
# candidates, the "drop interior points from the longest runs first" logic
# in _run_midpoint_targets reintroduces >8km sampling gaps — i.e. the exact
# missed-facility bug this file exists to fix — so treat hitting this cap as
# a bug to investigate, not a normal/expected code path.
_PLACES_MAX_SAMPLE_POINTS = 80

_PLACES_DEDUP_RADIUS_M = 1_500

# A Places result is only kept if it is within this distance (metres) of the
# route polyline itself (approximated as distance to the nearest polyline
# vertex — real Google polylines are dense at 91-174m gaps, so vertex
# distance is an accurate stand-in for point-to-segment distance). Without
# this, a large search radius (or a soft locationBias leak) can surface a
# facility many km perpendicular from the route, which _distance_along_route
# then silently projects onto the route as if it were reachable from it
# (fixbug-0806: median SA/PA leak was ~9km off-route, 道の駅 leaked
# 17-62km off-route).
_PLACES_OFFROUTE_MAX_M = 2_000


def _collapse_segment_runs(
    seg_bounds: list[tuple[float, float, str]],
) -> list[tuple[float, float, str]]:
    """Merge adjacent ``(start_m, end_m, road_class)`` bounds into runs.

    ``_segment_bounds`` returns one entry per Directions step; consecutive
    steps often share a road_class (e.g. several HIGHWAY steps in a row),
    which for sampling purposes should be treated as a single contiguous
    run so a run's "midpoint" is the middle of the whole stretch, not of
    one step.
    """
    runs: list[tuple[float, float, str]] = []
    for start_m, end_m, road_class in seg_bounds:
        if runs and runs[-1][2] == road_class:
            prev_start, _prev_end, prev_rc = runs[-1]
            runs[-1] = (prev_start, end_m, prev_rc)
        else:
            runs.append((start_m, end_m, road_class))
    return runs


def _run_midpoint_targets(
    seg_bounds: list[tuple[float, float, str]],
    step_m: float = _PLACES_SAMPLE_STEP_M,
    max_points: int = _PLACES_MAX_SAMPLE_POINTS,
) -> list[tuple[float, str, bool, float]]:
    """Pick sample targets that guarantee every road_class run gets sampled.

    Every contiguous run (see ``_collapse_segment_runs``) of length L gets
    ``max(1, round(L / step_m))`` points, evenly spaced within the run at
    ``run_start + ((k + 0.5) / n) * L`` for ``k in range(n)`` — a run with a
    single point gets exactly its own midpoint, and long runs get several
    evenly-spaced points instead of being under-sampled. This is what lets a
    short genuine LOCAL stretch flanked by two HIGHWAY stretches still get a
    sample point of its own, which a purely evenly-spaced whole-route
    sampling could skip entirely.

    Returns a list of ``(seg_mid, road_class, protected, run_length)``
    tuples in route order. ``protected`` marks a run's sole point, or the
    middle point of a multi-point run — these are never dropped by the
    ``max_points`` cap below. If the total number of candidate points
    exceeds ``max_points``, non-protected ("interior") points are dropped
    first, starting with points belonging to the LONGEST runs — a run's
    sole/midpoint point is always kept, even if that leaves the result over
    the cap.
    """
    candidates: list[tuple[float, str, bool, float]] = []
    for run_start, run_end, road_class in _collapse_segment_runs(seg_bounds):
        length = run_end - run_start
        if length <= 0:
            continue
        n_in_run = max(1, round(length / step_m))
        mid_idx = n_in_run // 2
        for k in range(n_in_run):
            seg_mid = run_start + ((k + 0.5) / n_in_run) * length
            candidates.append((seg_mid, road_class, k == mid_idx, length))

    if len(candidates) > max_points:
        droppable = sorted(
            (i for i, c in enumerate(candidates) if not c[2]),
            key=lambda i: candidates[i][3],
            reverse=True,
        )
        excess = len(candidates) - max_points
        drop = set(droppable[:excess])
        candidates = [c for i, c in enumerate(candidates) if i not in drop]

    return candidates


def places_rest_stops(
    key: str,
    polyline: str,
    context: dict[str, Any],
) -> list[RawPlace]:
    """Find rest POIs along the whole route and return a list of RawPlace dicts.

    Strategy: decode the polyline, then choose sample points along the route.

      - If ``context["segments"]`` is present (a route's per-step segment
        list, each with ``road_class`` and ``distance_m``), ``segments`` is
        collapsed into contiguous runs of equal ``road_class``
        (``_segment_bounds`` returns per-step bounds; adjacent steps sharing
        a road_class are merged into one run) and EVERY run gets at least
        one sample point at its own midpoint — long runs (> ``_PLACES_SAMPLE_STEP_M``)
        get additional evenly-spaced points so they aren't under-sampled.
        This guarantees a short genuine LOCAL stretch sandwiched between two
        HIGHWAY stretches (e.g. a surface National Route crossing) still
        gets searched for convenience_store, which a purely evenly-spaced
        whole-route sampling could skip entirely.
      - If ``context["segments"]`` is absent/empty (older caller / test),
        falls back to the previous whole-route behaviour: ``_PLACES_SAMPLE_POINTS``
        evenly-spaced points (at 1/(n+1), 2/(n+1) … n/(n+1) of total route
        distance), all using ``context["route_type"]`` ("highway" or "urban").

    Each sample point is classified INDEPENDENTLY (not once for the whole
    route) so a mixed route — e.g. an urban approach onto an expressway, or
    an expressway exit back onto local roads — searches the right strategy
    on each stretch. A "HIGHWAY" point searches like a highway point below;
    anything else ("LOCAL" or unknown) searches like an urban point.

    A HIGHWAY point runs two Text Searches — "サービスエリア" (service area)
    and "パーキングエリア" (parking area) — both bucketed "service_area" and
    tagged ``source_highway=True``. Japanese queries were confirmed via live
    probe to give far better recall than English keywords or a bare POI-type
    filter. A non-HIGHWAY point runs one Text Search — "道の駅" (roadside
    station, bucketed "service_area") — plus one Nearby Search
    (``includedTypes=["convenience_store"]``, bucketed accordingly) to
    broaden recall beyond the rarer 道の駅 facilities; all are tagged
    ``source_highway=False``. Gas stations are not rest facilities and are
    NOT searched (fixbug-0806 Task 2).

    Two source_highway=True-only cleanup passes then run, BEFORE dedup:

      1. 道の駅 exclusion: Places v1 Text Search's ``locationBias`` is a SOFT
         bias, not a hard geographic filter, so a サービスエリア/パーキング
         エリア query can still leak in a 道の駅 that happens to sit near a
         highway sample point. 道の駅 are registered on general
         (non-expressway) roads — a driver on the expressway has no ramp to
         reach one — so any leaked 道の駅 result sourced from a highway point
         is dropped. A 道の駅 sourced from a LOCAL point is legitimate and is
         NEVER touched by this exclusion.

    Results are then merged and deduped by Places v1 ``id`` (falling back to
    name + rounded lat/lng when absent — the FIRST-seen bucket AND
    source_highway both win, so the highest-intent search label is kept, and
    sample points are walked in route order for determinism).

      2. Direction filter: the deduped source_highway=True subset is passed
         through ``_filter_reachable_direction`` to drop opposite-carriageway
         SA/PA facilities (see that function's docstring) — Japanese
         expressway rest facilities are direction-specific (上り/下り) and
         unreachable from the opposite side. The source_highway=False subset
         (道の駅/convenience) is NEVER direction-filtered — it has no
         up/down carriageway concept regardless of what the rest of the route
         looks like.

    The combined (filtered highway-sourced + untouched local-sourced) list is
    then projected onto the route to compute ``distance_along_route_m``. When
    segment data is available, each place is projected onto the nearest
    polyline vertex OF ITS OWN SOURCE ROAD CLASS — a highway-sourced SA/PA
    onto a HIGHWAY vertex, a local-sourced 道の駅/convenience_store onto a
    LOCAL vertex — instead of the nearest vertex of any class (fixbug-0806
    "7-Eleven on the highway": a convenience store found on a genuine LOCAL
    stretch must not be snapped onto an adjacent HIGHWAY vertex and offered
    as reachable when the driver has no ramp to it). A place whose own road
    class doesn't occur anywhere on the route is dropped outright. At that
    same projection step, an additional off-route filter (fixbug-0806) drops
    any place whose distance to that (matching-class) nearest polyline
    vertex exceeds ``_PLACES_OFFROUTE_MAX_M`` — this applies to every place
    regardless of type/source, independent of the two cleanup passes above,
    and guards against a facility that is merely nearby in a
    straight-line/search-radius sense but many km perpendicular from the
    route (and therefore not actually reachable from it). When segment data
    is absent (older caller / test), projection falls back unchanged to the
    nearest vertex of any class. The surviving list is returned sorted
    ascending by distance along the route.

    When ``segments`` is present, the number of sample points varies with the
    route's run structure (at least one per contiguous road_class run, more
    for long runs), capped at ``_PLACES_MAX_SAMPLE_POINTS``; when absent,
    exactly ``_PLACES_SAMPLE_POINTS`` points are chosen (some may coincide
    for very short polylines — duplicates are removed by the dedup step).
    Each point triggers 2 (highway-classified) or 2 (local-classified) HTTP
    calls.

    Parameters
    ----------
    key:      Google Maps API key (never stored, never logged, never in errors).
    polyline: Google encoded overview polyline from a RawRoute.
    context:  Dict with ``{"route_type": "highway" | "urban" | ...}`` and,
              preferably, ``{"segments": [{"road_class": ..., "distance_m":
              ...}, ...]}`` for accurate per-point classification on mixed
              routes. ``segments`` absent/empty falls back to whole-route
              ``route_type`` for every sample point.

    Returns
    -------
    list[RawPlace]
        May be empty — an empty result means "none found" and is NOT an error.

    Raises
    ------
    MapsError("places_failure", ...)
        Transport error or any non-key/quota server error.
    MapsError("invalid_key", ...)
        Rejected API key (PERMISSION_DENIED / REQUEST_DENIED / UNAUTHENTICATED).
    MapsError("quota", ...)
        Quota exceeded (RESOURCE_EXHAUSTED).
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

    # Route context controls search strategy. ``route_type`` is the
    # whole-route fallback verdict (used when ``segments`` is absent, and
    # kept for back-compat); ``segments`` — when present — lets each sample
    # point classify itself against the stretch of route it actually falls
    # on, so a mixed route (e.g. urban approach + expressway) searches the
    # right strategy at each point instead of one verdict for the whole route.
    route_type = context.get("route_type", "urban")
    segments = context.get("segments") or []
    seg_bounds = _segment_bounds(segments) if segments else []
    total_seg_m = seg_bounds[-1][1] if seg_bounds else 0.0

    # ── Sample point selection ────────────────────────────────────────────────
    # When segment data is available, ``_run_midpoint_targets`` guarantees
    # every contiguous road_class run gets at least one sample point at its
    # own midpoint (long runs get extra evenly-spaced points too) — this is
    # what lets a short genuine LOCAL stretch flanked by HIGHWAY stretches
    # still get searched, which the legacy purely evenly-spaced whole-route
    # sampling could skip entirely. Falls back to the legacy behaviour when
    # no segment data exists (older caller / test).
    #
    # Each point carries its INTENDED along-route distance (``target``, not
    # the snapped vertex's own cumulative distance) for segment
    # classification below — on a coarse/sparsely-vertexed polyline several
    # intended targets can snap to the SAME nearest vertex, which would
    # otherwise collapse their segment lookup onto that one vertex's
    # (possibly unrepresentative) position rather than each point's own
    # place in the route. Real Google polylines have enough vertices that
    # this rarely matters, but ``target`` is the truer position regardless.
    sample_points: list[tuple[float, float, float]] = []
    if seg_bounds and total_seg_m > 0:
        used_vertex_idx: set[int] = set()
        added_coords: list[tuple[float, float]] = []
        for seg_mid, _road_class, _protected, _run_len in _run_midpoint_targets(seg_bounds):
            target = (seg_mid / total_seg_m) * total_dist
            # Find the polyline vertex whose cumulative distance is closest to target.
            best_idx = min(range(len(cum_dist)), key=lambda j: abs(cum_dist[j] - target))
            if best_idx in used_vertex_idx:
                continue
            lat, lng = route_points[best_idx]
            if any(
                _haversine_m(lat, lng, alat, alng) < _PLACES_DEDUP_RADIUS_M
                for alat, alng in added_coords
            ):
                continue
            used_vertex_idx.add(best_idx)
            added_coords.append((lat, lng))
            sample_points.append((lat, lng, target))
    else:
        # No usable segment data — fall back to the legacy evenly-spaced
        # fractions: 1/(n+1), 2/(n+1) … n/(n+1) of total route distance. For
        # n=6: 1/7, 2/7, 3/7, 4/7, 5/7, 6/7 — spans the whole route without
        # clustering at the endpoints. For short polylines multiple fractions
        # may map to the same vertex; the dedup step below handles that.
        n_samples = _PLACES_SAMPLE_POINTS
        for i in range(1, n_samples + 1):
            target = total_dist * i / (n_samples + 1)
            best_idx = min(range(len(cum_dist)), key=lambda j: abs(cum_dist[j] - target))
            lat, lng = route_points[best_idx]
            sample_points.append((lat, lng, target))

    # ── Per-point searches (bucket- and source-tagged) ─────────────────────────
    # Order matters for dedup: service_area is searched before convenience_store,
    # so the highest-intent bucket wins for a place found by more than one
    # search. Points are walked in route order (sample_points is already
    # route-ordered) so ties are resolved deterministically.
    all_results: list[tuple[dict[str, Any], str, bool]] = []
    for s_lat, s_lng, s_target in sample_points:
        if seg_bounds and total_seg_m > 0 and total_dist > 0:
            seg_target = (s_target / total_dist) * total_seg_m
            point_is_highway = _road_class_at(seg_target, seg_bounds) == "HIGHWAY"
        else:
            # No usable segment data for this point — fall back to the
            # whole-route verdict (old behaviour, and the only option when
            # the caller never supplied segments).
            point_is_highway = route_type == "highway"

        if point_is_highway:
            for query in _HIGHWAY_TEXT_QUERIES:
                body = _text_search_body(query, s_lat, s_lng)
                found = _places_v1_fetch(_PLACES_V1_TEXT_URL, body, key)
                all_results.extend((place, "service_area", True) for place in found)
        else:
            for query in _LOCAL_TEXT_QUERIES:
                body = _text_search_body(query, s_lat, s_lng)
                found = _places_v1_fetch(_PLACES_V1_TEXT_URL, body, key)
                all_results.extend((place, "service_area", False) for place in found)
            for included_type in _LOCAL_NEARBY_TYPES:
                body = _nearby_search_body(included_type, s_lat, s_lng)
                found = _places_v1_fetch(_PLACES_V1_NEARBY_URL, body, key)
                all_results.extend((place, included_type, False) for place in found)

    # Highway-SOURCED results only: Places v1 Text Search's ``locationBias``
    # is a SOFT bias, not a hard geographic filter, so a サービスエリア/
    # パーキングエリア query can still leak in a 道の駅 (roadside station)
    # that happens to sit near a highway-classified sample point. 道の駅 are
    # registered on general (non-expressway) roads — a driver on the
    # expressway has no ramp to reach one — so any leaked 道の駅 result is
    # dropped, but ONLY when it came from a highway-classified point. A
    # 道の駅 sourced from a local-classified point is the intended target of
    # that point's own search and must never be excluded.
    all_results = [
        (place, bucket, src_hw)
        for place, bucket, src_hw in all_results
        if not (src_hw and "道の駅" in place.get("displayName", {}).get("text", ""))
    ]

    if not all_results:
        return []

    # ── Dedupe by id (fall back to name + rounded coords if absent) ──────────
    # First-seen bucket AND source_highway both win.
    seen: set[str] = set()
    deduped: list[tuple[dict[str, Any], str, bool]] = []
    for result, bucket, src_hw in all_results:
        pid = result.get("id")
        if pid:
            dedup_key = f"pid:{pid}"
        else:
            loc = result.get("location", {})
            rlat = round(float(loc.get("latitude", 0.0)), 4)
            rlng = round(float(loc.get("longitude", 0.0)), 4)
            name = result.get("displayName", {}).get("text", "")
            dedup_key = f"name:{name}:{rlat}:{rlng}"
        if dedup_key in seen:
            continue
        seen.add(dedup_key)
        deduped.append((result, bucket, src_hw))

    # Highway-SOURCED results only: SA/PA are carriageway-direction-specific
    # (up/down facilities are separated by the median and mutually
    # unreachable) — drop the opposite-direction half. Local-sourced
    # (道の駅/convenience) results have no up/down carriageway concept
    # and are NEVER direction-filtered, regardless of what the rest of the
    # route looks like.
    highway_sourced = [(r, b) for r, b, sh in deduped if sh]
    local_sourced = [(r, b) for r, b, sh in deduped if not sh]
    if highway_sourced:
        highway_sourced = _filter_reachable_direction(highway_sourced, route_points)
    # The source-highway flag is carried through into the projection loop
    # below (see the road-class-match projection comment) — a place's own
    # search intent (SA/PA vs 道の駅/convenience) determines which road class
    # it must project onto to be reachable.
    combined = [(r, b, True) for (r, b) in highway_sourced] + [
        (r, b, False) for (r, b) in local_sourced
    ]

    # ── Per-vertex road-class index (fixbug-0806 "7-Eleven on the highway") ──
    # Motor-only expressways have no at-grade access to surface facilities,
    # and SA/PA are highway-only — so a place is only actually reachable from
    # the route if it projects onto a stretch of ITS OWN road class. Simply
    # projecting onto the nearest polyline vertex of ANY road class (the old
    # behaviour) could snap a convenience_store/道の駅 found on a genuine
    # LOCAL stretch onto an adjacent HIGHWAY vertex — offering a driver on a
    # motor-only expressway a "rest ahead" they have no ramp to reach. To fix
    # this, classify every polyline vertex by the road_class of the route
    # stretch it falls on (using the same cum_dist -> segment-space ratio
    # already used to classify sample points above), and later project each
    # place only onto the nearest vertex among ITS matching class.
    #
    # Only built when segment data is available (mirrors the sample-point
    # classification guard above); when absent (older caller / test path),
    # both lists stay empty and the projection loop below falls back to the
    # legacy nearest-vertex-of-any-class behaviour unchanged.
    hw_vertex_idx: list[int] = []
    local_vertex_idx: list[int] = []
    has_vertex_class_index = bool(seg_bounds and total_seg_m > 0 and total_dist > 0)
    if has_vertex_class_index:
        for i, cd in enumerate(cum_dist):
            seg_target_i = (cd / total_dist) * total_seg_m
            if _road_class_at(seg_target_i, seg_bounds) == "HIGHWAY":
                hw_vertex_idx.append(i)
            else:
                local_vertex_idx.append(i)

    # ── Project onto route, build RawPlace list, sort ascending ──────────────
    # Off-route filter: a place is only kept if it sits within
    # _PLACES_OFFROUTE_MAX_M of the route polyline itself (approximated as
    # distance to the nearest polyline vertex — point-to-segment would be
    # more exact, but real Google polylines are dense enough, at 91-174m
    # vertex gaps, that vertex distance is an accurate stand-in). Applies to
    # EVERY place regardless of type/bucket/source — a large search radius
    # or a soft locationBias leak can otherwise surface a facility many km
    # perpendicular from the route, which would still get silently projected
    # onto the route by _distance_along_route as if it were reachable.
    places: list[RawPlace] = []
    for result, bucket, src_hw in combined:
        loc = result.get("location", {})
        plat = float(loc.get("latitude", 0.0))
        plng = float(loc.get("longitude", 0.0))
        google_types: list[str] = result.get("types", [])
        name = result.get("displayName", {}).get("text", "")

        if has_vertex_class_index:
            # Road-class-match projection (fixbug-0806): a highway-sourced
            # place (SA/PA) must sit on a HIGHWAY stretch; a local-sourced
            # place (道の駅/convenience) must sit on a LOCAL stretch. If this
            # route has no stretch of the place's own class at all, it cannot
            # be reachable from this route — drop it.
            cand_idx = hw_vertex_idx if src_hw else local_vertex_idx
            if not cand_idx:
                continue
            nearest_idx = min(
                cand_idx,
                key=lambda i: _haversine_m(
                    plat, plng, route_points[i][0], route_points[i][1]
                ),
            )
        else:
            # Legacy fallback: no segment data at all (older caller / test) —
            # there is no per-vertex road class to match against, so keep the
            # original nearest-vertex-of-any-class behaviour unchanged.
            nearest_idx = _nearest_vertex_index((plat, plng), route_points)

        off_route_m = _haversine_m(
            plat, plng, route_points[nearest_idx][0], route_points[nearest_idx][1]
        )
        if off_route_m > _PLACES_OFFROUTE_MAX_M:
            continue

        dist_along = cum_dist[nearest_idx]

        places.append(
            {
                "name": name,
                "type": _classify_place_type(google_types, bucket),
                "location": {"lat": plat, "lng": plng},
                "distance_along_route_m": dist_along,
            }
        )

    places.sort(key=lambda p: p["distance_along_route_m"])
    return places
