"""One-time script to extract route presets from Google Maps Directions API.

Usage:
    python scripts/extract_route_presets.py [GOOGLE_MAPS_API_KEY]

If no key is given on the command line, the key is read from
``app/frontend/.env.local`` (the ``VITE_GOOGLE_MAPS_KEY=`` line) — this avoids
putting the secret on the shell command line / shell history.

Extracts 8 routes and saves them as JSON presets in routes/presets/:
  - long_tokyo_osaka.json    (~500km, highway)
  - middle_tokyo_karuizawa.json (~180km, avoid highways)
  - short_tokyo_chichibu.json   (~80km, local roads)
  - uc01_01_minatomirai_odawara.json (~57km, UC-01-01 demo)
  - uc01_02_nagoya_inuyama.json      (~28km, UC-01-02 demo)
  - uc03_01_funabashi_makuhari.json  (~7km,  UC-03-01 demo)
  - uc01_01_minatomirai_odawara_half_highway.json (Task 3 variant: same
    endpoints as uc01_01, but built from TWO real legs — a natural highway leg
    to a midpoint + an avoid=highways surface leg to the end — stitched into one
    genuinely part-expressway, part-normal-road route)
  - uc01_02_nagoya_inuyama_all_normal.json (Task 3 variant: same endpoints as
    uc01_02, but a real avoid=highways search — a genuine all-surface-road route)

Each preset contains the full directions response processed into the
same RawRoute format used by maps_client.directions(), plus Places data.

Places search strategy (Places API v1, Japanese queries — confirmed via live
probe to give the best recall for Japanese rest facilities):
  - Highway routes:   Text Search "サービスエリア" + "パーキングエリア".
  - Non-highway routes: Text Search "道の駅" + Nearby Search
    includedTypes=["convenience_store"]. Gas stations are not rest
    facilities and are not searched (fixbug-0806 Task 2).
Directions stays on the legacy GET API with language=en (road-class
inference depends on English step text) — only Places moved to v1.
"""

from __future__ import annotations

import json
import math
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
PRESETS_DIR = REPO_ROOT / "routes" / "presets"
ENV_LOCAL_PATH = REPO_ROOT / "app" / "frontend" / ".env.local"

DIRECTIONS_URL = "https://maps.googleapis.com/maps/api/directions/json"
PLACES_V1_TEXT_URL = "https://places.googleapis.com/v1/places:searchText"
PLACES_V1_NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby"
PLACES_FIELD_MASK = "places.id,places.displayName,places.types,places.location"

ROUTES = [
    {
        "id": "long_tokyo_osaka",
        "label": {"ja": "東京→大阪（高速）", "en": "Tokyo → Osaka (highway)"},
        "start": "Tokyo Station",
        "end": "Osaka Station",
        "avoid": None,
    },
    {
        "id": "middle_tokyo_karuizawa",
        "label": {"ja": "東京→軽井沢（一般道）", "en": "Tokyo → Karuizawa (no highway)"},
        "start": "Tokyo Station",
        "end": "Karuizawa Station",
        "avoid": "highways",
    },
    {
        "id": "short_tokyo_chichibu",
        "label": {"ja": "東京→秩父（短距離）", "en": "Tokyo → Chichibu (short)"},
        "start": "Tokyo Station",
        "end": "Chichibu Station",
        "avoid": None,
    },
    {
        "id": "uc01_01_minatomirai_odawara",
        "label": {"ja": "みなとみらい→小田原（UC-01-01）", "en": "Minatomirai → Odawara (UC-01-01)"},
        "start": "みなとみらい駅 神奈川県横浜市西区みなとみらい3-5",
        "end": "小田原城 神奈川県小田原市城内",
        "avoid": None,
    },
    {
        "id": "uc01_02_nagoya_inuyama",
        "label": {"ja": "名古屋→犬山（UC-01-02）", "en": "Nagoya → Inuyama (UC-01-02)"},
        "start": "ミッドランドスクエア 愛知県名古屋市中村区名駅4-7-1",
        "end": "犬山駅 愛知県犬山市犬山西古券",
        "avoid": None,
    },
    {
        "id": "uc03_01_funabashi_makuhari",
        "label": {"ja": "ららぽーとTOKYO-BAY→海浜幕張（UC-03-01）", "en": "LaLaport TOKYO-BAY → Kaihin-Makuhari (UC-03-01)"},
        "start": "ららぽーとTOKYO-BAY 千葉県船橋市浜町2-1-1",
        "end": "海浜幕張駅 千葉県千葉市美浜区ひび野1-3",
        "avoid": None,
    },
    {
        "id": "uc05_01_minatomirai_gotemba",
        "label": {"ja": "みなとみらい→御殿場アウトレット（UC-05-01）", "en": "Minatomirai → Gotemba Outlets (UC-05-01)"},
        "start": "みなとみらい駅 神奈川県横浜市西区みなとみらい3-5",
        "end": "御殿場プレミアム・アウトレット 静岡県御殿場市深沢1312",
        "avoid": None,
    },
    # ── Verification variants (Task 3, fixbug-0806) ─────────────────────────
    # SAME endpoints as their base route above, but shaped by REAL Google
    # searches so the geometry, road classes and Places all match what a driver
    # would actually see — NOT relabeled after the fact. A relabel keeps the old
    # highway polyline, so the map (which draws the polyline) still shows a
    # highway while the road-bar (which reads road_class) shows normal road:
    # the two disagree because the data is fake. Instead:
    #   - half_highway: TWO stitched legs (start→midpoint natural = highway,
    #     midpoint→end with avoid=highways = real surface road), so the route
    #     genuinely runs on an expressway then a national/surface road.
    #   - all_normal:   a SINGLE request with avoid=highways, so Google returns
    #     a genuine all-surface-road route.
    {
        "id": "uc01_01_minatomirai_odawara_half_highway",
        "label": {
            "ja": "みなとみらい→小田原（前半高速・後半一般道）",
            "en": "Minatomirai → Odawara (first half highway, second half normal)",
        },
        "start": "みなとみらい駅 神奈川県横浜市西区みなとみらい3-5",
        "end": "小田原城 神奈川県小田原市城内",
        "avoid": None,
        # Two real legs stitched into one route. The midpoint is the calibration
        # knob: leg 1 (natural) rides the expressway to it, leg 2 (avoid=highways)
        # drops onto Route 1 / surface roads for the rest. Chosen ≈ halfway so the
        # HIGHWAY and LOCAL runs come out roughly even.
        "legs": [
            {
                "start": "みなとみらい駅 神奈川県横浜市西区みなとみらい3-5",
                "end": "厚木駅 神奈川県厚木市泉町",
                "avoid": None,
            },
            {
                "start": "厚木駅 神奈川県厚木市泉町",
                "end": "小田原城 神奈川県小田原市城内",
                "avoid": "highways",
            },
        ],
    },
    {
        "id": "uc01_02_nagoya_inuyama_all_normal",
        "label": {
            "ja": "名古屋→犬山（全線一般道）",
            "en": "Nagoya → Inuyama (all normal road)",
        },
        "start": "ミッドランドスクエア 愛知県名古屋市中村区名駅4-7-1",
        "end": "犬山駅 愛知県犬山市犬山西古券",
        "avoid": "highways",
    },
]

HIGHWAY_MIN_STEP_M = 8_000
HIGHWAY_INSTRUCTION_KEYWORDS = (
    "highway", "motorway", "freeway", "expressway", "expwy", "interstate", "toll",
)
# Japanese designations for ORDINARY (non-expressway) roads. A merge/ramp
# maneuver onto one of these, with no highway/toll keyword in the same step, is
# a surface-road maneuver — see maps_client._ORDINARY_ROAD_MARKERS (fixbug-0806).
ORDINARY_ROAD_MARKERS = ("国道", "県道", "府道", "道道", "市道")
PLACES_SAMPLE_POINTS = 6

# Search radius (metres) for each per-point Places search. Kept small and
# paired with PLACES_OFFROUTE_MAX_M / the off-route filter in fetch_places
# (fixbug-0806): a large radius (previously 25km) lets a Text Search's soft
# locationBias pull in facilities many km perpendicular from the route
# (median SA/PA ~9km off-route observed; 道の駅 leaking 17-62km off-route),
# which then get silently projected onto the route by distance_along_route
# as if they were reachable from it. Mirrors maps_client._PLACES_RADIUS_M.
PLACES_RADIUS_M = 5_000

HIGHWAY_TEXT_QUERIES = ("サービスエリア", "パーキングエリア")
LOCAL_TEXT_QUERIES = ("道の駅",)
# Gas stations are NOT rest facilities — removed from this search
# (fixbug-0806 Task 2). Mirrors maps_client._LOCAL_NEARBY_TYPES.
LOCAL_NEARBY_TYPES = ("convenience_store",)


def _read_key_from_env_local() -> str:
    """Read VITE_GOOGLE_MAPS_KEY from app/frontend/.env.local.

    The key is read in-process only — it is never printed, logged, or passed
    on a shell command line by this path.
    """
    if not ENV_LOCAL_PATH.exists():
        print(f"ERROR: no key on argv and {ENV_LOCAL_PATH} does not exist.")
        sys.exit(1)
    for line in ENV_LOCAL_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("VITE_GOOGLE_MAPS_KEY="):
            value = line.split("=", 1)[1].strip().strip('"').strip("'")
            if value:
                return value
    print(f"ERROR: VITE_GOOGLE_MAPS_KEY not found in {ENV_LOCAL_PATH}.")
    sys.exit(1)


def fetch_json(url: str) -> dict[str, Any]:
    req = urllib.request.Request(url, headers={"User-Agent": "aica-route-extractor/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def places_v1_fetch(url: str, body: dict[str, Any], key: str) -> list[dict[str, Any]]:
    """POST body to a Places v1 endpoint; return the 'places' list (or [])."""
    payload_bytes = json.dumps(body).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": PLACES_FIELD_MASK,
    }
    req = urllib.request.Request(url, data=payload_bytes, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        try:
            err_payload = json.loads(exc.read())
        except Exception:
            err_payload = {}
        status = err_payload.get("error", {}).get("status", "")
        message = err_payload.get("error", {}).get("message", "")
        print(f"    Places v1 error ({exc.code} {status}): {message}")
        return []
    except urllib.error.URLError as exc:
        print(f"    Places v1 network error: {exc}")
        return []
    return payload.get("places") or []


def text_search_body(query: str, lat: float, lng: float) -> dict[str, Any]:
    return {
        "textQuery": query,
        "languageCode": "ja",
        "maxResultCount": 20,
        "locationBias": {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": float(PLACES_RADIUS_M),
            }
        },
    }


def nearby_search_body(included_type: str, lat: float, lng: float) -> dict[str, Any]:
    return {
        "includedTypes": [included_type],
        "maxResultCount": 5,
        "languageCode": "ja",
        "locationRestriction": {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": float(PLACES_RADIUS_M),
            }
        },
    }


def infer_road_class(step: dict[str, Any]) -> str:
    maneuver = step.get("maneuver", "").lower()
    raw_instructions = step.get("html_instructions", "")
    instructions = raw_instructions.lower()
    distance_m: int = step.get("distance", {}).get("value", 0)
    if (
        any(kw in instructions for kw in HIGHWAY_INSTRUCTION_KEYWORDS)
        or distance_m >= HIGHWAY_MIN_STEP_M
    ):
        return "HIGHWAY"
    names_ordinary_road = any(marker in raw_instructions for marker in ORDINARY_ROAD_MARKERS)
    if ("merge" in maneuver or "ramp" in maneuver) and not names_ordinary_road:
        return "HIGHWAY"
    return "LOCAL"


def fetch_directions(key: str, start: str, end: str, avoid: str | None) -> list[dict[str, Any]]:
    params: dict[str, str] = {
        "origin": start,
        "destination": end,
        "alternatives": "true",
        "mode": "driving",
        "language": "en",
    }
    if avoid:
        params["avoid"] = avoid

    query = urllib.parse.urlencode(params)
    url = f"{DIRECTIONS_URL}?{query}&key={key}"
    payload = fetch_json(url)

    status = payload.get("status", "")
    if status != "OK":
        print(f"  ERROR: Directions API returned {status}")
        return []

    routes: list[dict[str, Any]] = []
    for i, route in enumerate(payload.get("routes", [])[:3]):
        legs = route.get("legs", [])
        leg = legs[0] if legs else {}
        # When Google was explicitly told to avoid highways, every step it
        # returns is by construction a surface / national road — so trust that
        # over infer_road_class's 8km-long-step fallback, which otherwise
        # mislabels a long uninterrupted 国道/バイパス straightaway as HIGHWAY
        # (e.g. 名濃バイパス/国道41号, 国道1号) even though no expressway was used.
        avoid_highways = bool(avoid and "highways" in avoid.lower())
        segments = [
            {
                "road_class": "LOCAL" if avoid_highways else infer_road_class(step),
                "maneuver": step.get("maneuver", ""),
                "distance_m": step.get("distance", {}).get("value", 0),
            }
            for step in leg.get("steps", [])
        ]
        routes.append({
            "route_id": f"route-{i}",
            "summary": route.get("summary", ""),
            "distance_m": leg.get("distance", {}).get("value", 0),
            "duration_s": leg.get("duration", {}).get("value", 0),
            "encoded_polyline": route.get("overview_polyline", {}).get("points", ""),
            "segments": segments,
        })
    return routes


def encode_polyline(points: list[tuple[float, float]]) -> str:
    """Encode (lat, lng) vertices into a Google-format polyline string.

    Inverse of ``decode_polyline`` above (same 1e5 fixed-point precision and
    zig-zag/base64 chunking). Used by ``stitch_leg_routes`` to fold the
    decoded vertices of two Directions legs back into the single
    ``encoded_polyline`` string a preset's ``raw_route`` expects.
    """
    result: list[str] = []
    prev_lat = 0
    prev_lng = 0
    for lat, lng in points:
        ilat = round(lat * 1e5)
        ilng = round(lng * 1e5)
        for delta in (ilat - prev_lat, ilng - prev_lng):
            v = delta << 1
            if delta < 0:
                v = ~v
            while v >= 0x20:
                result.append(chr((0x20 | (v & 0x1F)) + 63))
                v >>= 5
            result.append(chr(v + 63))
        prev_lat = ilat
        prev_lng = ilng
    return "".join(result)


def stitch_leg_routes(leg_routes: list[dict[str, Any]]) -> dict[str, Any]:
    """Fold several sequential Directions legs into ONE raw_route.

    Each leg is a best-route dict from ``fetch_directions`` (route-0 of its own
    request). The stitched route concatenates the legs' polyline vertices and
    segment lists, and sums their distances/durations — so a route built from a
    natural (highway) leg + an ``avoid=highways`` (surface) leg is genuinely
    part-expressway, part-normal-road, with real geometry the map can draw and
    real per-segment road classes ``fetch_places`` can search against.

    The join vertex (leg N's end == leg N+1's start) is de-duplicated when the
    two decoded endpoints coincide, so the polyline has no zero-length hop.
    """
    all_points: list[tuple[float, float]] = []
    segments: list[dict[str, Any]] = []
    total_dist = 0
    total_dur = 0
    summaries: list[str] = []
    for i, r in enumerate(leg_routes):
        pts = decode_polyline(r.get("encoded_polyline", ""))
        if i > 0 and all_points and pts and all_points[-1] == pts[0]:
            pts = pts[1:]  # drop the shared join vertex
        all_points.extend(pts)
        segments.extend(r.get("segments", []))
        total_dist += int(r.get("distance_m", 0) or 0)
        total_dur += int(r.get("duration_s", 0) or 0)
        summ = r.get("summary")
        if summ:
            summaries.append(summ)
    return {
        "route_id": "route-0",
        "summary": " → ".join(summaries),
        "distance_m": total_dist,
        "duration_s": total_dur,
        "encoded_polyline": encode_polyline(all_points),
        "segments": segments,
    }


def decode_polyline(encoded: str) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    index = 0
    length = len(encoded)
    lat = 0
    lng = 0
    while index < length:
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


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6_371_000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lam = math.radians(lng2 - lng1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lam / 2) ** 2
    return 2.0 * R * math.asin(math.sqrt(a))


def cumulative_distances(points: list[tuple[float, float]]) -> list[float]:
    cum: list[float] = [0.0]
    for i in range(1, len(points)):
        seg_dist = haversine_m(points[i-1][0], points[i-1][1], points[i][0], points[i][1])
        cum.append(cum[-1] + seg_dist)
    return cum


def nearest_vertex_index(poi: tuple[float, float], route_points: list[tuple[float, float]]) -> int:
    """Return the index of the polyline vertex nearest (great-circle) to *poi*.

    Shared by ``distance_along_route`` and the direction-filter helpers below.
    """
    best_idx = 0
    best_d = haversine_m(poi[0], poi[1], route_points[0][0], route_points[0][1])
    for i, pt in enumerate(route_points[1:], 1):
        d = haversine_m(poi[0], poi[1], pt[0], pt[1])
        if d < best_d:
            best_d = d
            best_idx = i
    return best_idx


def distance_along_route(poi: tuple[float, float], route_points: list[tuple[float, float]], cum_dist: list[float]) -> float:
    if not route_points:
        return 0.0
    return cum_dist[nearest_vertex_index(poi, route_points)]


# ---------------------------------------------------------------------------
# Highway carriageway (up/down) direction filter — mirrors
# aica_api.services.maps_client._filter_reachable_direction identically.
#
# Japanese expressway Service Areas (SA/サービスエリア) and Parking Areas
# (PA/パーキングエリア) are direction-specific: the 上り (inbound, generally
# toward Tokyo) and 下り (outbound) facilities sit on opposite sides of the
# median and are physically unreachable from the opposite carriageway. Places
# Text Search is only geographically radius-biased, so it returns BOTH
# directions' facilities indiscriminately — roughly half of what comes back
# is a rest stop the driver can never actually pull into.
#
# Japan drives on the LEFT. Facing the direction of travel, the reachable
# SA/PA is therefore on the LEFT; the opposite-direction facility is across
# the median, to the RIGHT. ``filter_reachable_direction`` below keeps only
# same-side (reachable) facilities on highway routes.
# ---------------------------------------------------------------------------

EARTH_RADIUS_M = 6_371_000.0

# A facility's side-of-travel is only meaningful when it actually sits close
# to the route (a real SA/PA offset from the centerline is at most a couple
# hundred metres). Beyond this distance from its nearest route vertex, the
# geometric side test would be noise rather than signal — treat as ambiguous
# (kept) instead of rejecting on a meaningless sign.
DIRECTION_SIDE_MAX_DIST_M = 5_000.0


def local_xy(lat: float, lng: float, olat: float, olng: float) -> tuple[float, float]:
    """Convert (lat, lng) to local (east, north) metres relative to origin.

    Small-angle equirectangular approximation — accurate enough at the
    few-hundred-metre scale of a highway median / facility offset.
    """
    x = math.radians(lng - olng) * math.cos(math.radians(olat)) * EARTH_RADIUS_M
    y = math.radians(lat - olat) * EARTH_RADIUS_M
    return x, y


def facility_side_distance(
    poi: tuple[float, float],
    idx: int,
    route_points: list[tuple[float, float]],
) -> float:
    """Signed perpendicular distance (metres) of *poi* from the route heading.

    See maps_client._facility_side_distance for the full rationale: builds a
    smoothed local heading from route vertices around *idx* (a +/-2 vertex
    window), then normalizes the cross product with the facility's local
    displacement by the heading's magnitude so the result is an actual
    physical distance. > 0 means LEFT (reachable side under left-hand
    traffic); < 0 means RIGHT (opposite carriageway). A collapsed window
    (near a route endpoint) or degenerate heading is ambiguous (0.0).
    """
    n = len(route_points)
    i0 = max(0, idx - 2)
    i1 = min(n - 1, idx + 2)
    if i1 <= i0:
        return 0.0
    olat, olng = route_points[idx]
    hx0, hy0 = local_xy(route_points[i0][0], route_points[i0][1], olat, olng)
    hx1, hy1 = local_xy(route_points[i1][0], route_points[i1][1], olat, olng)
    hx, hy = hx1 - hx0, hy1 - hy0
    h_mag = math.hypot(hx, hy)
    if h_mag == 0.0:
        return 0.0
    dx, dy = local_xy(poi[0], poi[1], olat, olng)
    return (hx * dy - hy * dx) / h_mag


# A facility whose perpendicular distance from the route heading is within
# this many metres of the line is too close to the centerline to trust its
# side for VOTING purposes — see maps_client._DIRECTION_VOTE_MIN_SIDE_M.
DIRECTION_VOTE_MIN_SIDE_M = 3.0


def opposite_label(label: str) -> str:
    return "down" if label == "up" else "up"


def extract_direction_label(name: str) -> str | None:
    """Extract a carriageway direction label from a facility display name.

    e.g. "海老名SA (上り)" (up/inbound) vs "海老名SA (下り)" (down/outbound) —
    a plain substring check on the raw kanji handles half-width and
    full-width parens alike. About 87% of highway facility names carry a
    label; the rest fall back to the geometric left/right test.
    """
    if "上り" in name:
        return "up"
    if "下り" in name:
        return "down"
    return None


def filter_reachable_direction(
    deduped: list[tuple[dict[str, Any], str]],
    route_points: list[tuple[float, float]],
) -> list[tuple[dict[str, Any], str]]:
    """Keep only same-carriageway (reachable) SA/PA facilities on a highway route.

    See maps_client._filter_reachable_direction for the full algorithm: infer
    the route's travel direction via a BIDIRECTIONAL weighted vote over
    labeled facilities on either side (a LEFT-side facility votes for its
    own label; a RIGHT-side facility votes for the OPPOSITE of its own
    label; near-centerline/far-from-route facilities do not vote) — this is
    far more robust than a LEFT-only majority vote, which can flip on a
    short/winding route with few labeled facilities. Then keep a facility
    iff its label matches route_dir (when both are known), else fall back to
    the geometric left/right test (a near-zero/far-from-route, ambiguous
    reading defaults to "keep" rather than discard).
    """
    if len(route_points) < 2:
        return deduped

    computed: list[tuple[dict[str, Any], str, float, str | None]] = []
    for result, bucket in deduped:
        loc = result.get("location", {})
        plat = float(loc.get("latitude", 0.0))
        plng = float(loc.get("longitude", 0.0))
        name = result.get("displayName", {}).get("text", "")
        idx = nearest_vertex_index((plat, plng), route_points)
        nearest_dist = haversine_m(plat, plng, route_points[idx][0], route_points[idx][1])
        if nearest_dist > DIRECTION_SIDE_MAX_DIST_M:
            # Too far from the route to trust a local median-side reading.
            side_m = 0.0
        else:
            side_m = facility_side_distance((plat, plng), idx, route_points)
        label = extract_direction_label(name)
        computed.append((result, bucket, side_m, label))

    # Bidirectional weighted vote for route_dir (see docstring above).
    votes = {"up": 0, "down": 0}
    for _, _, side_m, label in computed:
        if label is None or abs(side_m) <= DIRECTION_VOTE_MIN_SIDE_M:
            continue
        voted_label = label if side_m > 0 else opposite_label(label)
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
            # Ambiguous (near-zero/far-from-route) readings default to "keep".
            keep = side_m >= 0
        if keep:
            kept.append((result, bucket))
    return kept


def classify_place_type(google_types: list[str], bucket: str) -> str:
    """Bucket-first classification — see maps_client._classify_place_type."""
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


def segment_bounds(segments: list[dict[str, Any]]) -> list[tuple[float, float, str]]:
    """Mirrors maps_client._segment_bounds — see that docstring."""
    bounds: list[tuple[float, float, str]] = []
    cursor = 0.0
    for seg in segments:
        dist = float(seg.get("distance_m", 0) or 0)
        road_class = seg.get("road_class", "LOCAL")
        bounds.append((cursor, cursor + dist, road_class))
        cursor += dist
    return bounds


def road_class_at(seg_target: float, seg_bounds: list[tuple[float, float, str]]) -> str:
    """Mirrors maps_client._road_class_at — see that docstring."""
    for start_m, end_m, road_class in seg_bounds:
        if start_m <= seg_target < end_m:
            return road_class
    if seg_bounds:
        return seg_bounds[-1][2]
    return "LOCAL"


# Sample spacing (metres). Chosen so consecutive sample points' 5km search
# radii still overlap along the route even after accounting for the 2km
# off-route cap: STEP <= 2*sqrt(radius^2 - off_cap^2) = 2*sqrt(5000^2-2000^2)
# ~= 9.2km, with margin (fixbug-0806). Mirrors
# maps_client._PLACES_SAMPLE_STEP_M.
PLACES_SAMPLE_STEP_M = 8_000

# Runaway backstop only — NOT meant to bind in practice. At 8km spacing this
# covers ~640km of contiguous same-road_class runs; every real preset route
# (longest is ~500km) sits comfortably under it. If this cap ever truncates
# candidates, the "drop interior points from the longest runs first" logic
# in run_midpoint_targets reintroduces >8km sampling gaps — i.e. the exact
# missed-facility bug this file exists to fix — so treat hitting this cap as
# a bug to investigate, not a normal/expected code path. Mirrors
# maps_client._PLACES_MAX_SAMPLE_POINTS.
PLACES_MAX_SAMPLE_POINTS = 80

PLACES_DEDUP_RADIUS_M = 1_500

# A Places result is only kept if it is within this distance (metres) of the
# route polyline itself (approximated as distance to the nearest polyline
# vertex — real Google polylines are dense at 91-174m gaps, so vertex
# distance is an accurate stand-in for point-to-segment distance). Without
# this, a large search radius (or a soft locationBias leak) can surface a
# facility many km perpendicular from the route, which distance_along_route
# then silently projects onto the route as if it were reachable from it
# (fixbug-0806: median SA/PA leak was ~9km off-route, 道の駅 leaked
# 17-62km off-route). Mirrors maps_client._PLACES_OFFROUTE_MAX_M.
PLACES_OFFROUTE_MAX_M = 2_000


def collapse_segment_runs(
    seg_bounds: list[tuple[float, float, str]],
) -> list[tuple[float, float, str]]:
    """Mirrors maps_client._collapse_segment_runs — see that docstring."""
    runs: list[tuple[float, float, str]] = []
    for start_m, end_m, road_class in seg_bounds:
        if runs and runs[-1][2] == road_class:
            prev_start, _prev_end, prev_rc = runs[-1]
            runs[-1] = (prev_start, end_m, prev_rc)
        else:
            runs.append((start_m, end_m, road_class))
    return runs


def run_midpoint_targets(
    seg_bounds: list[tuple[float, float, str]],
    step_m: float = PLACES_SAMPLE_STEP_M,
    max_points: int = PLACES_MAX_SAMPLE_POINTS,
) -> list[tuple[float, str, bool, float]]:
    """Mirrors maps_client._run_midpoint_targets — see that docstring."""
    candidates: list[tuple[float, str, bool, float]] = []
    for run_start, run_end, road_class in collapse_segment_runs(seg_bounds):
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


def fetch_places(key: str, raw_route: dict[str, Any]) -> list[dict[str, Any]]:
    polyline = raw_route.get("encoded_polyline", "")
    if not polyline:
        return []

    try:
        route_points = decode_polyline(polyline)
    except (ValueError, IndexError):
        return []

    if not route_points:
        return []

    cum_dist = cumulative_distances(route_points)
    total_dist = cum_dist[-1]

    # route_type is the whole-route fallback verdict (used when segments is
    # empty); segments — always present here, straight off raw_route — lets
    # each sample point classify itself against the stretch of route it
    # actually falls on, so a mixed route (e.g. urban approach + expressway)
    # searches the right strategy at each point instead of one verdict for
    # the whole route. Mirrors maps_client.places_rest_stops.
    segments = raw_route.get("segments", []) or []
    has_highway = any(s.get("road_class") == "HIGHWAY" for s in segments)
    route_type = "highway" if has_highway else "urban"
    seg_bounds = segment_bounds(segments) if segments else []
    total_seg_m = seg_bounds[-1][1] if seg_bounds else 0.0

    # Each point carries its INTENDED along-route distance (``target``, not
    # the snapped vertex's own cumulative distance) for segment
    # classification — see maps_client.places_rest_stops for why: on a
    # coarse/sparse polyline several intended targets can snap to the SAME
    # nearest vertex, which would otherwise collapse their segment lookup
    # onto that one vertex's position instead of each point's own place in
    # the route.
    #
    # When segment data is available, run_midpoint_targets guarantees every
    # contiguous road_class run gets at least one sample point at its own
    # midpoint (mirrors maps_client.places_rest_stops); falls back to the
    # legacy evenly-spaced fractions when no segment data exists.
    sample_points: list[tuple[float, float, float]] = []
    if seg_bounds and total_seg_m > 0:
        used_vertex_idx: set[int] = set()
        added_coords: list[tuple[float, float]] = []
        for seg_mid, _road_class, _protected, _run_len in run_midpoint_targets(seg_bounds):
            target = (seg_mid / total_seg_m) * total_dist
            best_idx = min(range(len(cum_dist)), key=lambda j: abs(cum_dist[j] - target))
            if best_idx in used_vertex_idx:
                continue
            lat, lng = route_points[best_idx]
            if any(
                haversine_m(lat, lng, alat, alng) < PLACES_DEDUP_RADIUS_M
                for alat, alng in added_coords
            ):
                continue
            used_vertex_idx.add(best_idx)
            added_coords.append((lat, lng))
            sample_points.append((lat, lng, target))
    else:
        for i in range(1, PLACES_SAMPLE_POINTS + 1):
            target = total_dist * i / (PLACES_SAMPLE_POINTS + 1)
            best_idx = min(range(len(cum_dist)), key=lambda j: abs(cum_dist[j] - target))
            lat, lng = route_points[best_idx]
            sample_points.append((lat, lng, target))

    all_results: list[tuple[dict[str, Any], str, bool]] = []
    for s_lat, s_lng, s_target in sample_points:
        if seg_bounds and total_seg_m > 0 and total_dist > 0:
            seg_target = (s_target / total_dist) * total_seg_m
            point_is_highway = road_class_at(seg_target, seg_bounds) == "HIGHWAY"
        else:
            point_is_highway = route_type == "highway"

        if point_is_highway:
            for query in HIGHWAY_TEXT_QUERIES:
                body = text_search_body(query, s_lat, s_lng)
                found = places_v1_fetch(PLACES_V1_TEXT_URL, body, key)
                all_results.extend((place, "service_area", True) for place in found)
        else:
            for query in LOCAL_TEXT_QUERIES:
                body = text_search_body(query, s_lat, s_lng)
                found = places_v1_fetch(PLACES_V1_TEXT_URL, body, key)
                all_results.extend((place, "service_area", False) for place in found)
            for included_type in LOCAL_NEARBY_TYPES:
                body = nearby_search_body(included_type, s_lat, s_lng)
                found = places_v1_fetch(PLACES_V1_NEARBY_URL, body, key)
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

    # Dedupe by id (fall back to name + rounded coords) — first-seen bucket
    # AND source_highway both win.
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
        highway_sourced = filter_reachable_direction(highway_sourced, route_points)
    # The source-highway flag is carried through into the projection loop
    # below — a place's own search intent (SA/PA vs 道の駅/convenience)
    # determines which road class it must project onto to be reachable.
    # Mirrors maps_client.places_rest_stops.
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
    # Only built when segment data is available; when absent, both lists
    # stay empty and the projection loop below falls back to the legacy
    # nearest-vertex-of-any-class behaviour unchanged. Mirrors
    # maps_client.places_rest_stops.
    hw_vertex_idx: list[int] = []
    local_vertex_idx: list[int] = []
    has_vertex_class_index = bool(seg_bounds and total_seg_m > 0 and total_dist > 0)
    if has_vertex_class_index:
        for i, cd in enumerate(cum_dist):
            seg_target_i = (cd / total_dist) * total_seg_m
            if road_class_at(seg_target_i, seg_bounds) == "HIGHWAY":
                hw_vertex_idx.append(i)
            else:
                local_vertex_idx.append(i)

    # Project onto route. Off-route filter (fixbug-0806): a place is only
    # kept if it sits within PLACES_OFFROUTE_MAX_M of the route polyline
    # itself (approximated as distance to the nearest polyline vertex —
    # point-to-segment would be more exact, but real Google polylines are
    # dense enough, at 91-174m vertex gaps, that vertex distance is an
    # accurate stand-in). Applies to EVERY place regardless of
    # type/bucket/source — a large search radius or a soft locationBias
    # leak can otherwise surface a facility many km perpendicular from the
    # route, which would still get silently projected onto the route by
    # distance_along_route as if it were reachable. Mirrors
    # maps_client.places_rest_stops's projection loop.
    places: list[dict[str, Any]] = []
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
            # route has no stretch of the place's own class at all, it
            # cannot be reachable from this route — drop it.
            cand_idx = hw_vertex_idx if src_hw else local_vertex_idx
            if not cand_idx:
                continue
            nearest_idx = min(
                cand_idx,
                key=lambda i: haversine_m(
                    plat, plng, route_points[i][0], route_points[i][1]
                ),
            )
        else:
            # Legacy fallback: no segment data at all — keep the original
            # nearest-vertex-of-any-class behaviour unchanged.
            nearest_idx = nearest_vertex_index((plat, plng), route_points)

        off_route_m = haversine_m(
            plat, plng, route_points[nearest_idx][0], route_points[nearest_idx][1]
        )
        if off_route_m > PLACES_OFFROUTE_MAX_M:
            continue

        dist_along = cum_dist[nearest_idx]
        places.append({
            "name": name,
            "type": classify_place_type(google_types, bucket),
            "location": {"lat": plat, "lng": plng},
            "distance_along_route_m": dist_along,
        })

    places.sort(key=lambda p: p["distance_along_route_m"])
    return places


def main():
    # Windows consoles often default to a legacy codepage (e.g. cp932) that
    # cannot encode some punctuation (em dash, arrow) used in these progress
    # messages. Force UTF-8 stdout so printing never crashes the extraction.
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except (ValueError, OSError):
            pass

    # `--only id1,id2` limits the run to those preset ids. Re-extraction fetches
    # live Google data, so a targeted re-run keeps the untouched presets
    # byte-stable instead of churning every route's geometry.
    argv = sys.argv[1:]
    only_ids: set[str] | None = None
    for i, arg in enumerate(list(argv)):
        if arg == "--only" and i + 1 < len(argv):
            only_ids = {s.strip() for s in argv[i + 1].split(",") if s.strip()}
            del argv[i : i + 2]
            break
        if arg.startswith("--only="):
            only_ids = {s.strip() for s in arg.split("=", 1)[1].split(",") if s.strip()}
            argv.remove(arg)
            break

    if argv:
        key = argv[0]
    else:
        print(f"No key on argv — reading VITE_GOOGLE_MAPS_KEY from {ENV_LOCAL_PATH.relative_to(REPO_ROOT)}")
        key = _read_key_from_env_local()

    if only_ids:
        known = {r["id"] for r in ROUTES}
        unknown = only_ids - known
        if unknown:
            print(f"ERROR: unknown preset id(s) in --only: {', '.join(sorted(unknown))}")
            sys.exit(1)
        print(f"Limiting extraction to: {', '.join(sorted(only_ids))}")

    PRESETS_DIR.mkdir(parents=True, exist_ok=True)

    for route_def in ROUTES:
        if only_ids is not None and route_def["id"] not in only_ids:
            continue
        print(f"\nExtracting: {route_def['label']['en']}")
        print(f"  {route_def['start']} → {route_def['end']}")

        legs = route_def.get("legs")
        if legs:
            # Multi-leg stitch (fixbug-0806 verification variant): each leg is a
            # separate real Directions request; a natural leg rides the
            # expressway, an avoid=highways leg stays on surface roads. Folding
            # them yields a genuinely mixed route (real geometry + real classes).
            leg_best: list[dict[str, Any]] = []
            leg_ok = True
            for leg in legs:
                lr = fetch_directions(key, leg["start"], leg["end"], leg.get("avoid"))
                if not lr:
                    leg_ok = False
                    break
                mode = f"avoid={leg['avoid']}" if leg.get("avoid") else "natural"
                print(
                    f"  Leg ({mode}): {leg['start']} → {leg['end']}: "
                    f"{lr[0]['summary']} {lr[0]['distance_m'] / 1000:.1f} km"
                )
                leg_best.append(lr[0])
            if not leg_ok:
                print("  SKIPPED (a leg returned no routes)")
                continue
            best_route = stitch_leg_routes(leg_best)
        else:
            raw_routes = fetch_directions(key, route_def["start"], route_def["end"], route_def["avoid"])
            if not raw_routes:
                print("  SKIPPED (no routes returned)")
                continue
            # Use the first (best) route
            best_route = raw_routes[0]

        print(f"  Route: {best_route['summary']}")
        print(f"  Distance: {best_route['distance_m'] / 1000:.1f} km")
        print(f"  Duration: {best_route['duration_s'] / 60:.0f} min")

        # Fetch places along route
        print("  Fetching rest stops...")
        places = fetch_places(key, best_route)
        print(f"  Found {len(places)} rest stops")

        # Build preset JSON
        preset = {
            "id": route_def["id"],
            "label": route_def["label"],
            "start": route_def["start"],
            "end": route_def["end"],
            "route_source": "maps",
            "raw_route": best_route,
            "places": places,
        }

        out_path = PRESETS_DIR / f"{route_def['id']}.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(preset, f, ensure_ascii=False, indent=2)
        print(f"  Saved: {out_path.relative_to(REPO_ROOT)}")

    print("\nDone! Presets saved to routes/presets/")


if __name__ == "__main__":
    main()
