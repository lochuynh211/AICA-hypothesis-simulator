#!/usr/bin/env python3
"""Generate committed proposal PRESETS (feature 018 — proposal-preset-testcases).

A *preset* is a parent test-case seed that binds a coherent situation + driver
profile into one selectable unit, with a bilingual brief, a machine-checkable
``expectation`` contract, and optional isolated ``algorithm_config_overrides``.

Like ``scripts/promote_seeds.py``, this is the SINGLE source of truth for the
committed ``proposal_contracts/presets/*.json`` artifacts — never hand-edit the
JSON; edit the compact specs here and re-run:

    cd app/api && uv run python ../../scripts/generate_presets.py

Both the STANDALONE presets (``scripts/preset_standalones.json``) and the
multi-stage JOURNEYS (``scripts/preset_journeys.json``) are data-driven: their
situation values are grounded in a real Tokyo→Osaka tick simulation and every
preset was tuned + adversarially audited against the REAL content and service
selectors (baseline + one-lever contrasts; driver history left BLANK except the
dedicated recovery/history presets, so the recovery leaf never silently
dominates a situation- or preference-driven contrast).

Idempotent: same specs + same frozen catalog => byte-identical output (a golden
test pins it). READ-ONLY toward the frozen dataset; imports only
``aica_api.models.proposal.*`` + stdlib (never ``mdg``).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parent.parent
_API = _REPO / "app" / "api"
if str(_API) not in sys.path:
    sys.path.insert(0, str(_API))

from aica_api.models.proposal.world import World  # noqa: E402

DATASET_ID = "soundcharts-grounded-spotify-compatible-demonstration-seed-1042"
_DATASET_DIR = _REPO / "proposal_contracts" / "dataset" / DATASET_ID
PRESETS_DIR = _REPO / "proposal_contracts" / "presets"
SCHEMA_VERSION = "1.0.0"

CATALOG_REF = {
    "dataset_hash": "sha256:83d8079c7a81bc6afbd01cdba65fe2330de66b900a113723814fa938fce516cd",
    "dataset_id": DATASET_ID,
    "dataset_version": {
        "schema_version": "1.0.0",
        "spotify_audio_features_reference_version": "1.0.0",
        "spotify_track_reference_version": "1.0.0",
    },
}

# --------------------------------------------------------------------------- #
# Frozen catalog (read-only) + trait helper (mirrors the content selector).
# Retained so the compact specs / tuning harness can resolve genre/artist tracks.
# --------------------------------------------------------------------------- #
_CATALOG = json.loads((_DATASET_DIR / "catalog.json").read_text(encoding="utf-8"))
_ARTIST_GENRES = json.loads(
    (_DATASET_DIR / "genre_affinity_v1.json").read_text(encoding="utf-8")
).get("artist_genres", {})
_BY_ID = {s["spotify_track"]["id"]: s for s in _CATALOG}


def _clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def _arousal(af: dict) -> float:
    nl = _clamp((af["loudness"] + 60) / 60)
    nt = _clamp((af["tempo"] - 60) / 120)
    return 0.30 * af["energy"] + 0.25 * nl + 0.25 * nt + 0.15 * af["danceability"] + 0.05 * (1 - af["acousticness"])


def artist_track_ids(artist_id: str) -> list[str]:
    """All track ids whose first/any artist == ``artist_id`` (sorted, deterministic)."""
    out = []
    for tid, s in _BY_ID.items():
        if any(a.get("id") == artist_id for a in (s["spotify_track"].get("artists") or [])):
            out.append(tid)
    return sorted(out)


def genres_of(tid: str) -> list[str]:
    gs: list[str] = []
    for a in _BY_ID[tid]["spotify_track"].get("artists") or []:
        gs += _ARTIST_GENRES.get(a.get("id"), [])
    return sorted(set(gs))


def genre_track_ids(genre: str, n: int, *, prefer_high_arousal: bool = True) -> list[str]:
    """Top-n track ids of a genre, ordered by arousal (desc/asc), deterministic."""
    hits = [tid for tid in _BY_ID if genre in genres_of(tid)]
    hits.sort(key=lambda t: (_arousal(_BY_ID[t]["spotify_audio_features"]), t),
              reverse=prefer_high_arousal)
    return hits[:n]


def rich_on(track_ids: list[str], *, acc: float = 95.0, rec: float = 90.0) -> dict:
    """Profile fragment: strong per-track history (activates the personalization weight)."""
    return {
        "catalog_item_usage_level": {t: "high" for t in track_ids},
        "content_proposal_acceptance_rate": {t: acc for t in track_ids},
        "content_recovery_rate": {t: rec for t in track_ids},
    }


def played_recent_on(track_ids: list[str], at: str = "2026-07-17T11:45:00Z") -> dict:
    """Profile fragment: mark tracks as just-played (novelty/operations penalty)."""
    return {"played_items": [{"track_id": t, "last_played_at": at} for t in track_ids]}


def strong_oshi(artist_id: str, genres: dict, *, age_band: str = "30s") -> dict:
    """Full strong-personalization profile fragment for an in-catalog oshi artist."""
    tids = artist_track_ids(artist_id)
    frag = {
        "oshi_registered": True, "oshi_mode": "on", "oshi_id": artist_id, "oshi_type": "artist",
        "age_band": age_band, "genre_affinity_v1_enabled": True, "usage_by_genre": genres,
    }
    frag.update(rich_on(tids))
    return frag


# --------------------------------------------------------------------------- #
# Canonical NEUTRAL base world (self-contained; every field a valid neutral).
# --------------------------------------------------------------------------- #
_NEUTRAL_PROFILE = {
    "oshi_registered": False, "oshi_mode": "off", "oshi_id": None, "oshi_type": None, "oshi_tags": [],
    "age_band": "30s", "gender": "unspecified", "hobby_interest_tags": [],
    "genre_affinity_v1_enabled": False, "usage_by_genre": None, "scene_genre_usage": None,
    "catalog_item_usage_level": {}, "catalog_item_recency_state": {},
    "content_tag_usage_level": {}, "content_tag_recency_state": {}, "scene_content_tag_usage_level": {},
    "content_proposal_acceptance_rate": {}, "content_proposal_acceptance_confidence": {},
    "content_recovery_rate": {}, "content_recovery_confidence": {},
    "service_usage_level": {}, "service_recency_state": {}, "scene_service_usage_level": {},
    "service_proposal_acceptance_rate": {}, "service_proposal_acceptance_confidence": {},
    "service_recovery_rate": {}, "service_recovery_confidence": {},
    "played_items": [], "skipped_items": [], "changed_from_items": [], "repeated_items": [],
    "completed_items": [], "manually_selected_items": [], "cancelled_content_plans": [],
    "scheduled_event_type": None, "scheduled_event_timing": None, "scheduled_event_tags": [],
}

_BASE_SITUATION = {
    "drowsiness_level": 25, "fatigue_level": 25, "monotony_level": 30,
    "traffic_state": "normal", "road_type": "highway", "night_state": "day",
    "motion_state": "driving", "route_tags": ["highway"], "destination_tags": [],
    "child_present": False, "multiple_passengers": False,
    "rest_spot_type": "unknown", "estimated_min_until_rest_spot": None,
    "active_service": None, "recent_service_rejections": [],
}
_BASE_CONTROL = {
    "dataset_id": DATASET_ID, "matrix_version": "v1", "motion_state": "driving",
    "trigger_purpose": "rest_recommended", "lifecycle_stage": "before_rest_until_stop",
}


def _neutral_world() -> dict:
    import copy
    return {
        "control_inputs": copy.deepcopy(_BASE_CONTROL),
        "situation": copy.deepcopy(_BASE_SITUATION),
        "driver_profile": copy.deepcopy(_NEUTRAL_PROFILE),
        "catalog_ref": copy.deepcopy(CATALOG_REF),
    }


def _apply(world: dict, *, situation=None, profile=None, control=None) -> dict:
    for k, v in (situation or {}).items():
        world["situation"][k] = v
    for k, v in (profile or {}).items():
        world["driver_profile"][k] = v
    for k, v in (control or {}).items():
        world["control_inputs"][k] = v
    # keep the two motion_state homes synced (project memory: sync BOTH seams)
    if control and "motion_state" in control:
        world["situation"]["motion_state"] = control["motion_state"]
    if situation and "motion_state" in situation:
        world["control_inputs"]["motion_state"] = situation["motion_state"]
    return world


def make_preset(preset_id, *, category, family, contrast_with, label, brief,
                situation=None, profile=None, control=None,
                overrides=None, expectation, journey=None) -> dict:
    world = _apply(_neutral_world(), situation=situation, profile=profile, control=control)
    World(**world)  # validate against the real model; raises on any bad field
    return {
        "preset_id": preset_id,
        "schema_version": SCHEMA_VERSION,
        "label": label,
        "brief": brief,
        "category": category,
        "family": family,
        "journey": journey,
        "contrast_with": contrast_with,
        "world": world,
        "algorithm_config_overrides": overrides,
        "expectation": expectation,
    }


def _exp(hypothesis, *, top=None, top_fit_min, gradient="none",
         service, override_required=False, should_rank_below=None):
    e = {
        "hypothesis": hypothesis,
        "expected_top": top or {},
        "top_fit_min": top_fit_min,
        "gradient": gradient,
        "expected_service": {"top_should_be_in": service},
        "override_required": override_required,
    }
    if should_rank_below:
        e["should_rank_below"] = should_rank_below
    return e


PRESETS: list = []


# --------------------------------------------------------------------------- #
# STANDALONE presets — data-driven, loaded from scripts/preset_standalones.json.
# Each is a baseline or a one-lever variant of a baseline (oshi gate, genre taste,
# era/age, recovery history, novelty penalty, route-genre) on a NEUTRAL situation
# so the isolated lever — not the road — drives the outcome. Concrete expanded
# driver_profile dicts (already resolved against the frozen catalog).
# --------------------------------------------------------------------------- #
_STANDALONES_DATA = json.loads(
    (_REPO / "scripts" / "preset_standalones.json").read_text(encoding="utf-8")
)


def _add_standalones() -> None:
    for s in _STANDALONES_DATA:
        PRESETS.append(make_preset(
            s["preset_id"], category=s["category"], family=s["family"],
            contrast_with=s.get("contrast_with"), label=s["label"], brief=s["brief"],
            situation=s.get("situation"), profile=s.get("profile"), control=s.get("control"),
            overrides=s.get("overrides"), expectation=s["expectation"]))


_add_standalones()


# --------------------------------------------------------------------------- #
# JOURNEY presets — multi-stage, same-driver driving timelines (grouped by
# category). Each journey's stages were designed + VERIFIED against the real
# content+service selectors and frozen in scripts/preset_journeys.json; every
# stage becomes one preset, linked by the `journey` field (id/step/of/label).
# --------------------------------------------------------------------------- #
_JOURNEY_LETTER = {
    "rest-monotony-day": "A", "rest-night": "B", "rest-mountain": "C",
    "traffic-jam": "D", "family-trip": "E", "oshi-event": "F",
}
_JOURNEYS_DATA = json.loads((_REPO / "scripts" / "preset_journeys.json").read_text(encoding="utf-8"))


def _add_journeys() -> None:
    for spec in sorted(_JOURNEYS_DATA, key=lambda s: _JOURNEY_LETTER[s["journey_id"]]):
        letter = _JOURNEY_LETTER[spec["journey_id"]]
        jid = f"journey-{letter.lower()}"
        of = len(spec["stages"])
        jlabel = {"en": f"{letter} · {spec['label']['en']}", "ja": f"{letter}・{spec['label']['ja']}"}
        driver = spec["driver_profile"]
        for st in spec["stages"]:
            step = st["step"]
            pid = f"preset-journey-{letter.lower()}-{step}-{st['slug']}"
            label = {"en": f"{letter} · {step}/{of} — {st['label']['en']}",
                     "ja": f"{letter}・{step}/{of} — {st['label']['ja']}"}
            e = st["expectation"]
            expectation = _exp(e["hypothesis"], top=e.get("expected_top"), top_fit_min=e["top_fit_min"],
                               gradient=e.get("gradient", "none"),
                               service=e["expected_service"]["top_should_be_in"],
                               override_required=e.get("override_required", False),
                               should_rank_below=e.get("should_rank_below"))
            PRESETS.append(make_preset(
                pid, category=spec["category"], family="journey",
                journey={"id": jid, "step": step, "of": of, "label": jlabel},
                contrast_with=None, label=label, brief=st["brief"],
                situation=st["situation"], profile=dict(driver), control=st["control"],
                overrides=st.get("overrides"), expectation=expectation))


_add_journeys()


def write() -> list[Path]:
    PRESETS_DIR.mkdir(parents=True, exist_ok=True)
    written = []
    for preset in PRESETS:
        path = PRESETS_DIR / f"{preset['preset_id']}.json"
        path.write_text(json.dumps(preset, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
                        encoding="utf-8")
        written.append(path)
    return written


if __name__ == "__main__":
    paths = write()
    print(f"wrote {len(paths)} presets to {PRESETS_DIR}")
    for p in paths:
        print("  ", p.name)
