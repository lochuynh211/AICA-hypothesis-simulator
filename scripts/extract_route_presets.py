"""One-time script to extract route presets from Google Maps Directions API.

Usage:
    python scripts/extract_route_presets.py <GOOGLE_MAPS_API_KEY>

Extracts 6 routes and saves them as JSON presets in routes/presets/:
  - long_tokyo_osaka.json    (~500km, highway)
  - middle_tokyo_karuizawa.json (~180km, avoid highways)
  - short_tokyo_chichibu.json   (~80km, local roads)
  - uc01_01_minatomirai_odawara.json (~57km, UC-01-01 demo)
  - uc01_02_nagoya_inuyama.json      (~28km, UC-01-02 demo)
  - uc03_01_funabashi_makuhari.json  (~7km,  UC-03-01 demo)

Each preset contains the full directions response processed into the
same RawRoute format used by maps_client.directions(), plus Places data.
"""

from __future__ import annotations

import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
PRESETS_DIR = REPO_ROOT / "routes" / "presets"

DIRECTIONS_URL = "https://maps.googleapis.com/maps/api/directions/json"
PLACES_NEARBY_URL = "https://maps.googleapis.com/maps/api/place/nearbysearch/json"

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
]

HIGHWAY_MIN_STEP_M = 8_000
HIGHWAY_INSTRUCTION_KEYWORDS = (
    "highway", "motorway", "freeway", "expressway", "expwy", "interstate", "toll",
)
PLACES_SAMPLE_POINTS = 6
PLACES_RADIUS_M = 25_000


def fetch_json(url: str) -> dict[str, Any]:
    req = urllib.request.Request(url, headers={"User-Agent": "aica-route-extractor/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def infer_road_class(step: dict[str, Any]) -> str:
    maneuver = step.get("maneuver", "").lower()
    instructions = step.get("html_instructions", "").lower()
    distance_m: int = step.get("distance", {}).get("value", 0)
    if (
        "merge" in maneuver
        or "ramp" in maneuver
        or any(kw in instructions for kw in HIGHWAY_INSTRUCTION_KEYWORDS)
        or distance_m >= HIGHWAY_MIN_STEP_M
    ):
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
        segments = [
            {
                "road_class": infer_road_class(step),
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


import math

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


def distance_along_route(poi: tuple[float, float], route_points: list[tuple[float, float]], cum_dist: list[float]) -> float:
    if not route_points:
        return 0.0
    best_idx = 0
    best_d = haversine_m(poi[0], poi[1], route_points[0][0], route_points[0][1])
    for i, pt in enumerate(route_points[1:], 1):
        d = haversine_m(poi[0], poi[1], pt[0], pt[1])
        if d < best_d:
            best_d = d
            best_idx = i
    return cum_dist[best_idx]


def classify_place_type(google_types: list[str], route_type: str) -> str:
    type_set = set(google_types)
    if "service_area" in type_set or "rest_stop" in type_set:
        return "service_area"
    if route_type == "highway" and ("gas_station" in type_set or "parking" in type_set):
        return "service_area"
    if "convenience_store" in type_set:
        return "convenience_store"
    return "other"


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

    has_highway = any(s.get("road_class") == "HIGHWAY" for s in raw_route.get("segments", []))
    route_type = "highway" if has_highway else "urban"

    sample_points: list[tuple[float, float]] = []
    for i in range(1, PLACES_SAMPLE_POINTS + 1):
        target = total_dist * i / (PLACES_SAMPLE_POINTS + 1)
        best_idx = min(range(len(cum_dist)), key=lambda j: abs(cum_dist[j] - target))
        sample_points.append(route_points[best_idx])

    all_results: list[dict[str, Any]] = []
    for s_lat, s_lng in sample_points:
        params: dict[str, Any] = {
            "location": f"{s_lat},{s_lng}",
            "radius": PLACES_RADIUS_M,
            "keyword": "service area rest area",
        }
        if route_type == "highway":
            params["type"] = "gas_station"
        query = urllib.parse.urlencode(params)
        url = f"{PLACES_NEARBY_URL}?{query}&key={key}"
        try:
            payload = fetch_json(url)
            if payload.get("status") in ("OK", "ZERO_RESULTS"):
                all_results.extend(payload.get("results", []))
        except Exception as e:
            print(f"    Places search error: {e}")

    # Dedupe
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

    # Project onto route
    places: list[dict[str, Any]] = []
    for result in deduped:
        geom = result.get("geometry", {}).get("location", {})
        plat = float(geom.get("lat", 0.0))
        plng = float(geom.get("lng", 0.0))
        google_types: list[str] = result.get("types", [])
        dist_along = distance_along_route((plat, plng), route_points, cum_dist)
        places.append({
            "name": result.get("name", ""),
            "type": classify_place_type(google_types, route_type),
            "location": {"lat": plat, "lng": plng},
            "distance_along_route_m": dist_along,
        })

    places.sort(key=lambda p: p["distance_along_route_m"])
    return places


def main():
    if len(sys.argv) < 2:
        print("Usage: python scripts/extract_route_presets.py <GOOGLE_MAPS_API_KEY>")
        sys.exit(1)

    key = sys.argv[1]
    PRESETS_DIR.mkdir(parents=True, exist_ok=True)

    for route_def in ROUTES:
        print(f"\nExtracting: {route_def['label']['en']}")
        print(f"  {route_def['start']} → {route_def['end']}")

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
