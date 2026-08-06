"""Dev-only harness: predict a merged-run's simulated completion time.

Mirrors the distance/jam loop of aica_api.services.tick_engine.advance_tick for
a route-preset-backed merged run: per tick, pick traffic_jam_kph while a
time-based traffic-event window is active, else the segment's speed_profile
speed; advance distance; complete when distance >= the preset's total km. Used
to calibrate scenarios/*.json presets.traffic_events to a target route time.

Run from repo root with:
  PYTHONPATH=app/api PYTHONIOENCODING=utf-8 python scripts/dev/calibrate_route_time.py <preset_id> [--hwy 80] [--normal 40]
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from aica_api.services.route_analysis import _build_route_segments_maps

REPO_ROOT = Path(__file__).resolve().parents[2]


def load_preset(preset_id: str) -> dict:
    path = REPO_ROOT / "routes" / "presets" / f"{preset_id}.json"
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _segment_type_at(distance_km: float, segments) -> str:
    current = "normal_road"
    for seg in segments:
        if seg.start_km <= distance_km:
            current = seg.segment_type
    return current


def _active_jam(elapsed_min: float, traffic_events) -> bool:
    for e in traffic_events:
        if e["start_min"] <= elapsed_min < e["start_min"] + e["duration_min"]:
            return True
    return False


def simulate_completion_minutes(
    preset_id: str,
    speed_profile: dict,
    traffic_events: list[dict],
    tick_seconds: int = 180,
    total_duration_seconds: int = 7200,
) -> float:
    preset = load_preset(preset_id)
    raw = preset["raw_route"]
    total_km = raw["distance_m"] / 1000.0
    segments = _build_route_segments_maps(raw.get("segments", []))
    max_ticks = total_duration_seconds // tick_seconds

    distance_km = 0.0
    for tick_index in range(max_ticks):
        seg_type = _segment_type_at(distance_km, segments)
        elapsed_min = tick_index * tick_seconds / 60.0
        if _active_jam(elapsed_min, traffic_events):
            eff = float(speed_profile["traffic_jam_kph"])
        else:
            speed_map = {
                "normal_road": float(speed_profile["normal_road_kph"]),
                "highway": float(speed_profile["highway_kph"]),
                "mountain_road": float(speed_profile["mountain_road_kph"]),
                "sightseeing_road": float(speed_profile["sightseeing_road_kph"]),
            }
            eff = speed_map.get(seg_type, 60.0)
        distance_km += eff * tick_seconds / 3600.0
        if distance_km >= total_km:
            return (tick_index + 1) * tick_seconds / 60.0
    return max_ticks * tick_seconds / 60.0


def _print_segments(preset_id: str) -> None:
    preset = load_preset(preset_id)
    raw = preset["raw_route"]
    segs = _build_route_segments_maps(raw.get("segments", []))
    total_km = raw["distance_m"] / 1000.0
    hwy = sum(s.length_km for s in segs if s.segment_type == "highway")
    nrm = sum(s.length_km for s in segs if s.segment_type == "normal_road")
    print(f"preset={preset_id} total_km={total_km:.3f} highway={hwy:.3f} normal_road={nrm:.3f}")
    for s in segs:
        print(f"  start={s.start_km:7.3f} len={s.length_km:7.3f} type={s.segment_type}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("preset_id")
    ap.add_argument("--hwy", type=float, default=80.0)
    ap.add_argument("--normal", type=float, default=40.0)
    ap.add_argument("--jam", type=float, default=20.0)
    args = ap.parse_args()
    _print_segments(args.preset_id)
    sp = {
        "highway_kph": args.hwy,
        "normal_road_kph": args.normal,
        "mountain_road_kph": 40.0,
        "sightseeing_road_kph": 30.0,
        "traffic_jam_kph": args.jam,
    }
    free = simulate_completion_minutes(args.preset_id, sp, [])
    print(f"free-flow completion: {free:.1f} min")
