#!/usr/bin/env python3
"""Generate committed proposal PRESETS (feature 018 — proposal-preset-testcases).

A *preset* is a parent test-case seed that binds a coherent situation + driver
profile into one selectable unit, with a bilingual brief, a machine-checkable
``expectation`` contract, and optional isolated ``algorithm_config_overrides``.

Like ``scripts/promote_seeds.py``, this is the SINGLE source of truth for the
committed ``proposal_contracts/presets/*.json`` artifacts — never hand-edit the
JSON; edit the compact specs here and re-run:

    cd app/api && uv run python ../../scripts/generate_presets.py

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
    "usage_by_genre_v1_placeholder": None,
}
# Drop any key the model rejects (kept tolerant; validated below).
_NEUTRAL_PROFILE.pop("usage_by_genre_v1_placeholder", None)

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


def strong_oshi(artist_id: str, genres: dict, *, age_band: str = "30s") -> dict:
    """Full strong-personalization profile fragment for an in-catalog oshi artist."""
    tids = artist_track_ids(artist_id)
    frag = {
        "oshi_registered": True, "oshi_mode": "on", "oshi_id": artist_id, "oshi_type": "artist",
        "age_band": age_band, "genre_affinity_v1_enabled": True, "usage_by_genre": genres,
    }
    frag.update(rich_on(tids))
    return frag


def make_preset(preset_id, *, family, contrast_with, label, brief,
                situation=None, profile=None, control=None,
                overrides=None, expectation) -> dict:
    world = _apply(_neutral_world(), situation=situation, profile=profile, control=control)
    World(**world)  # validate against the real model; raises on any bad field
    return {
        "preset_id": preset_id,
        "schema_version": SCHEMA_VERSION,
        "label": label,
        "brief": brief,
        "family": family,
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


# --------------------------------------------------------------------------- #
# The 18 presets (9 families, 7 contrast pairs).  top_fit_min values are the
# honest measured floors finalized by the tune loop (see build report).
# --------------------------------------------------------------------------- #
HIGE = "synthetic-artist-0107"   # Official HIGE DANdism — j-pop/j-rock, high arousal
JOBIM = "synthetic-artist-0004"  # Antônio Carlos Jobim — jazz, calm
ADO = "synthetic-artist-0122"    # Ado — j-pop, 2020s
SEIKO = "synthetic-artist-0136"  # Seiko Matsuda — j-pop, 1980s
MIKU = "synthetic-artist-0115"   # Hatsune Miku — j-pop/j-rock, vocaloid/anime-adjacent

# Coherent (trigger_purpose, lifecycle_stage) contexts — the trigger must match
# the driving state: route_music = "playing music on an ordinary drive" (no
# fatigue implied), inattentive = "drowsy, keep alert", rest_recommended (base) =
# "tired, heading to a rest stop".
ROUTE_MUSIC = {"trigger_purpose": "route_music", "lifecycle_stage": "active_driving_content"}
INATTENTIVE = {"trigger_purpose": "inattentive_driving_prevention_recovery",
               "lifecycle_stage": "active_driving_content"}

AGE_BOOST = {"content": {"hierarchy_weights": {"Preference": {"upro_oshi": {"leaves": {
    "age": {"share": 0.35, "mask": 1, "feature_id": "age_band"},
    "oshi": {"share": 0.45, "mask": 1, "feature_id": "oshi_id"},
    "hobbies": {"share": 0.20, "mask": 0, "genre_gated": True, "feature_id": "hobby_interest_tags"},
    "gender": {"share": 0.00, "mask": 0, "feature_id": "gender"},
}}}}}}

PRESETS = []


def _p(*a, **k):
    PRESETS.append(make_preset(*a, **k))


# ---- Family A: mood coherence (1a ⇄ 1b) ----
_p("preset-monotone-highway-energize", family="mood_coherence",
   contrast_with="preset-late-night-winddown",
   label={"en": "Monotone highway — energize", "ja": "単調ハイウェイ — 元気づけ"},
   brief={"en": "Bored on a long monotonous highway with little fatigue. The driver's oshi (Official HIGE DANdism) and their high j-rock usage should push upbeat, high-energy tracks to the top — coherent 'wake me up' signals, no soothe/energize conflict.",
          "ja": "単調な高速道路で退屈、疲労は低め。推し（Official HIGE DANdism）とJ-ROCK嗜好により、アップテンポで高エネルギーな曲が上位に来るはず。"},
   situation={"drowsiness_level": 62, "fatigue_level": 30, "monotony_level": 90,
              "traffic_state": "normal", "night_state": "day", "road_type": "highway"},
   profile=strong_oshi(HIGE, {"j-rock": "high", "electronic": "med"}),
   control=INATTENTIVE,  # monotony-induced drowsiness → keep the driver alert (not "rest")
   expectation=_exp("coherent high-arousal world + oshi + j-rock usage → upbeat oshi track tops",
                    top={"must_be_oshi": True, "arousal_band": "high"}, top_fit_min=0.38,
                    gradient="arousal_up_implies_fit_up",
                    service=["humming_karaoke", "quiz", "call_response_driving", "music_playlist"]))

_p("preset-late-night-winddown", family="mood_coherence",
   contrast_with="preset-monotone-highway-energize",
   label={"en": "Late-night congestion — wind down", "ja": "深夜の渋滞 — 落ち着かせ"},
   brief={"en": "High fatigue, night, stuck in congestion. The driver's calm oshi (Antônio Carlos Jobim) and jazz/classical taste should surface soothing low-energy tracks — coherent 'calm me down' signals.",
          "ja": "疲労が高く夜間・渋滞。落ち着いた推し（Antônio Carlos Jobim）とジャズ/クラシック嗜好により、癒し系の低エネルギー曲が上位に。"},
   situation={"drowsiness_level": 45, "fatigue_level": 32, "monotony_level": 20,
              "traffic_state": "congested", "night_state": "night", "road_type": "highway"},
   profile=strong_oshi(JOBIM, {"jazz": "high", "classical": "high"}),
   control=ROUTE_MUSIC,  # a calm night drive, not a rest emergency — the jazz taste leads
   expectation=_exp("coherent low-arousal world + calm oshi + jazz usage → the calm oshi's track tops",
                    top={"must_be_oshi": True}, top_fit_min=0.33,
                    gradient="arousal_down_implies_fit_up",
                    service=["music_playlist", "radio_style", "humming_karaoke"]))

# ---- Family B: driver-state adaptation (fresh ⇄ drowsy, SAME driver) ----
# Realistic replacement for the (physically-impossible) directional-hypothesis pair:
# in the trigger model drowsiness always outpaces fatigue, so a tired driver's mood
# block always favours HIGH arousal — "soothe wins when tired" is not a real scenario.
# Instead: the SAME driver (same broad j-pop/j-rock taste + history), fresh vs. after a
# long monotonous stretch. The assistant adapts its pick to the driver's state — the
# real safety behaviour — and the #1 track changes.
_STATE_TRACKS = list(dict.fromkeys(
    genre_track_ids("j-pop", 10, prefer_high_arousal=True)
    + genre_track_ids("j-pop", 6, prefer_high_arousal=False)))
_STATE_PROF = {"genre_affinity_v1_enabled": True, "usage_by_genre": {"j-pop": "high", "j-rock": "med"},
               **rich_on(_STATE_TRACKS)}
_p("preset-fresh-alert-cruise", family="driver_state",
   contrast_with="preset-long-haul-drowsy",
   label={"en": "Fresh driver — early cruise", "ja": "元気なドライバー — 走り始め"},
   brief={"en": "A rested driver on an ordinary daytime highway, only just underway — drowsiness low (≈30, a few minutes in). With no fatigue pressure, the assistant leans on the driver's own j-pop/j-rock taste. Its partner preset is the SAME driver after a long monotonous stretch — watch the pick change.",
          "ja": "休息十分なドライバーが昼間の高速を走り始めたところ — 眠気は低い（約30、走行数分）。疲労の圧力がないため本人のJ-POP/J-ROCK嗜好が主導。対のプリセットは長い単調区間の後の同一ドライバー — 選曲の変化に注目。"},
   situation={"drowsiness_level": 30, "fatigue_level": 26, "monotony_level": 35,
              "night_state": "day", "road_type": "highway"},
   profile=dict(_STATE_PROF), control=ROUTE_MUSIC,
   expectation=_exp("fresh driver + own taste → an upbeat j-pop track tops (differs from the drowsy state)",
                    top={"genre": "j-pop"}, top_fit_min=0.28, gradient="none",
                    service=["music_playlist", "humming_karaoke", "radio_style"]))

_p("preset-long-haul-drowsy", family="driver_state",
   contrast_with="preset-fresh-alert-cruise",
   label={"en": "Long-haul — drowsy on a monotonous highway", "ja": "長距離 — 単調な高速で眠気"},
   brief={"en": "The SAME driver after ~50 minutes of monotonous highway: drowsiness has climbed to ≈82 — past the rest threshold, per the trigger model's realistic build-up (≈1.2/min on a monotonous road). The assistant now proposes to keep them alert, a different top pick than when they were fresh.",
          "ja": "同一ドライバーが単調な高速を約50分走った後：眠気は約82まで上昇 — トリガーモデルの現実的な蓄積（単調路で約1.2/分）により休憩閾値を超過。覚醒維持の選曲となり、走り始めとは異なる1位に。"},
   situation={"drowsiness_level": 82, "fatigue_level": 38, "monotony_level": 92,
              "night_state": "day", "road_type": "highway"},
   profile=dict(_STATE_PROF), control=INATTENTIVE,
   expectation=_exp("drowsy state → a high-arousal j-pop track tops (different track than fresh)",
                    top={"genre": "j-pop", "arousal_band": "high"}, top_fit_min=0.30, gradient="none",
                    service=["humming_karaoke", "quiz", "music_playlist", "call_response_driving"]))

# ---- Family C: oshi personalization (3a ⇄ 3b) ----
# Oshi gate isolated: oshi + genre usage but NO per-track history (rich history would
# keep the oshi's tracks on top even with the gate off, masking the gate's own effect).
_OSHI_SIT = {"drowsiness_level": 42, "fatigue_level": 28, "monotony_level": 40,
             "traffic_state": "normal", "night_state": "day", "road_type": "highway"}
_OSHI_ON = {"oshi_registered": True, "oshi_mode": "on", "oshi_id": ADO, "oshi_type": "artist",
            "age_band": "30s", "genre_affinity_v1_enabled": True, "usage_by_genre": {"j-pop": "high"}}
_p("preset-oshi-superfan", family="oshi_personalization",
   contrast_with="preset-oshi-off",
   label={"en": "Oshi fan (on)", "ja": "推しファン（ON）"},
   brief={"en": "A mild, neutral situation so preference — not the road — leads. The driver has registered Ado as their oshi. The oshi signal lifts Ado's tracks to the top; the partner preset flips oshi off to isolate exactly this contribution.",
          "ja": "状況は穏やかで中立。ドライバーはAdoを推し登録。推しシグナルがAdoの曲を上位に押し上げる。対のプリセットは推しOFFでこの寄与を分離。"},
   situation=_OSHI_SIT, profile=dict(_OSHI_ON),
   control=ROUTE_MUSIC,
   expectation=_exp("neutral situation + oshi on → the oshi's track tops",
                    top={"must_be_oshi": True}, top_fit_min=0.15, gradient="none",
                    service=["music_playlist", "humming_karaoke", "radio_style"]))

_p("preset-oshi-off", family="oshi_personalization",
   contrast_with="preset-oshi-superfan",
   label={"en": "Oshi off (same driver)", "ja": "推し OFF（同一ドライバー）"},
   brief={"en": "The same Ado fan and the same road — but with oshi mode switched OFF. With only the shared j-pop taste left, Ado no longer tops and a different track wins — isolating exactly what the oshi signal contributes.",
          "ja": "同じAdoファン・同じ状況で、推しモードをOFFに。共通のJ-POP嗜好だけが残り、Adoは上位から外れ別の曲が勝つ — 推しシグナルの寄与を分離。"},
   situation=_OSHI_SIT,
   profile={**_OSHI_ON, "oshi_mode": "off"},
   control=ROUTE_MUSIC,
   expectation=_exp("with oshi off the same driver's top track is no longer the oshi",
                    top={"must_be_oshi": False}, top_fit_min=0.10, gradient="none",
                    service=["music_playlist", "humming_karaoke", "radio_style"]))

# ---- Family D: genre usage (4a ⇄ 4b), no oshi ----
_GEN_SIT = {"drowsiness_level": 42, "fatigue_level": 28, "monotony_level": 45,
            "traffic_state": "normal", "night_state": "day", "road_type": "highway"}
_p("preset-jrock-enthusiast", family="genre_usage",
   contrast_with="preset-jazz-calm-listener",
   label={"en": "J-Rock enthusiast", "ja": "J-ROCK 愛好家"},
   brief={"en": "No registered oshi — taste alone. Heavy j-rock/electronic usage plus history on favourite j-rock tracks should lift the j-rock cluster to the top on an ordinary drive.",
          "ja": "登録推しなし、嗜好のみ。J-ROCK/エレクトロニカの多用と履歴により、J-ROCK群が上位に。"},
   situation=_GEN_SIT,
   profile={"genre_affinity_v1_enabled": True, "usage_by_genre": {"j-rock": "high", "electronic": "med"},
            **rich_on(genre_track_ids("j-rock", 6, prefer_high_arousal=True))},
   control=ROUTE_MUSIC,
   expectation=_exp("j-rock usage + history → a j-rock track tops",
                    top={"genre": "j-rock"}, top_fit_min=0.30, gradient="none",
                    service=["music_playlist", "humming_karaoke", "radio_style"]))

_p("preset-jazz-calm-listener", family="genre_usage",
   contrast_with="preset-jrock-enthusiast",
   label={"en": "Jazz / classical calm listener", "ja": "ジャズ/クラシック 静穏派"},
   brief={"en": "Same ordinary drive, opposite taste: heavy jazz/classical usage and history. The soothing jazz/classical cluster should rise instead — same road, different driver, different winner.",
          "ja": "同じ通常走行で正反対の嗜好：ジャズ/クラシックの多用と履歴。静穏なジャズ/クラシック群が上位に — 同じ道でも勝者が変わる。"},
   situation=_GEN_SIT,
   profile={"genre_affinity_v1_enabled": True, "usage_by_genre": {"jazz": "high", "classical": "high"},
            **rich_on(genre_track_ids("jazz", 5, prefer_high_arousal=False)
                      + genre_track_ids("classical", 4, prefer_high_arousal=False))},
   control=ROUTE_MUSIC,
   expectation=_exp("jazz/classical usage + history → a jazz/classical track tops",
                    top={"genre": "jazz"}, top_fit_min=0.17, gradient="none",
                    service=["music_playlist", "humming_karaoke", "radio_style"]))

# ---- Family E: route→genre + negative response (5a ⇄ 5b) ----
_p("preset-coastal-cruise", family="route_genre",
   contrast_with="preset-mountain-pass",
   label={"en": "Coastal cruise", "ja": "海岸クルーズ"},
   brief={"en": "A relaxed coastal local road. Route/destination genre affinity (coast → city-pop / jazz) should lift bright coastal-friendly tracks.",
          "ja": "のんびりした海岸沿いの一般道。ルート/目的地ジャンル親和（海岸→シティポップ/ジャズ）で明るい曲が上位に。"},
   situation={"road_type": "local", "route_tags": ["coastal"], "destination_tags": ["coast"],
              "monotony_level": 25, "drowsiness_level": 35, "fatigue_level": 28, "night_state": "day"},
   profile={"genre_affinity_v1_enabled": True, "usage_by_genre": {"city pop": "high", "jazz": "med"},
            **rich_on(genre_track_ids("city pop", 4) + genre_track_ids("jazz", 3))},
   control=ROUTE_MUSIC,
   expectation=_exp("coastal route/destination genre affinity → bright coastal track tops",
                    top={"arousal_band": "mid"}, top_fit_min=0.20, gradient="none",
                    service=["music_playlist", "radio_style", "humming_karaoke"]))

_p("preset-mountain-pass", family="route_genre",
   contrast_with="preset-coastal-cruise",
   label={"en": "Mountain pass", "ja": "山道"},
   brief={"en": "A winding mountain road. The algorithm's mountain response coefficient (α = −1.0) penalizes distracting high-energy tracks, and mountain genre affinity (folk / classical) surfaces calmer music — the opposite winner to the coastal cruise.",
          "ja": "曲がりくねった山道。山道の応答係数（α=−1.0）が高エネルギー曲を抑制し、山道ジャンル親和（フォーク/クラシック）で落ち着いた曲が上位に — 海岸とは逆の結果。"},
   situation={"road_type": "mountain", "route_tags": ["mountain"], "destination_tags": ["nature"],
              "monotony_level": 18, "drowsiness_level": 55, "fatigue_level": 45, "night_state": "day"},
   profile={"genre_affinity_v1_enabled": True, "usage_by_genre": {"classical": "high", "japanese folk": "high"},
            **rich_on(genre_track_ids("classical", 5, prefer_high_arousal=False))},
   control=ROUTE_MUSIC,
   expectation=_exp("mountain road penalizes high-arousal; calmer track tops (different from coastal)",
                    top={"arousal_band": "low"}, top_fit_min=0.20, gradient="arousal_down_implies_fit_up",
                    service=["music_playlist", "radio_style", "humming_karaoke"]))

# ---- Family F: era / age-band affinity (6a ⇄ 6b) ----
_p("preset-showa-nostalgia", family="era_age",
   contrast_with="preset-genz-now",
   label={"en": "Shōwa nostalgia (50s driver)", "ja": "昭和ノスタルジー（50代ドライバー）"},
   brief={"en": "A driver in their 50s whose oshi is Seiko Matsuda (1980s). With the era/age weight raised (per-preset override), 1980s tracks win — the same neutral road, a generation earlier.",
          "ja": "推しが松田聖子（1980年代）の50代ドライバー。年代/世代の重みを引き上げ（プリセット単位のオーバーライド）、1980年代の曲が上位に。"},
   situation=_OSHI_SIT,
   profile=strong_oshi(SEIKO, {"j-pop": "high", "jazz": "med"}, age_band="50s"),
   overrides=AGE_BOOST,
   control=ROUTE_MUSIC,
   expectation=_exp("50s age-band + 1980s oshi + raised age weight → a 1980s track tops",
                    top={"must_be_oshi": True}, top_fit_min=0.30, gradient="none",
                    service=["music_playlist", "humming_karaoke", "radio_style"],
                    override_required=True))

_p("preset-genz-now", family="era_age",
   contrast_with="preset-showa-nostalgia",
   label={"en": "Gen-Z now (teens driver)", "ja": "Z世代（10代ドライバー）"},
   brief={"en": "A teenage driver whose oshi is Ado (2020s). Same neutral road, same raised era/age weight — but now current 2020s tracks win. Age-band alone flips the era.",
          "ja": "推しがAdo（2020年代）の10代ドライバー。同じ道・同じ年代重みで、今度は2020年代の曲が上位に。世代だけで年代が反転。"},
   situation=_OSHI_SIT,
   profile=strong_oshi(ADO, {"j-pop": "high"}, age_band="teens"),
   overrides=AGE_BOOST,
   control=ROUTE_MUSIC,
   expectation=_exp("teens age-band + 2020s oshi + raised age weight → a 2020s track tops",
                    top={"must_be_oshi": True}, top_fit_min=0.30, gradient="none",
                    service=["music_playlist", "humming_karaoke", "radio_style"],
                    override_required=True))

# ---- Family G: passenger + genre gate (standalone) ----
_p("preset-child-family-drive", family="passenger_genre",
   contrast_with=None,
   label={"en": "Child on board — family drive", "ja": "子ども同乗 — 家族ドライブ"},
   brief={"en": "A daytime family drive with a child aboard. Child genre affinity (→ anime) plus anime usage should lift kid-friendly anime tracks; energetic adult rock is de-prioritized.",
          "ja": "子ども同乗の昼間の家族ドライブ。子ども向けジャンル親和（→アニメ）とアニメ利用で、アニメ曲が上位に。"},
   situation={"child_present": True, "multiple_passengers": True, "road_type": "local",
              "night_state": "day", "monotony_level": 30, "drowsiness_level": 28, "fatigue_level": 24},
   profile={"genre_affinity_v1_enabled": True, "hobby_interest_tags": ["anime-fan"],
            "usage_by_genre": {"anime": "high", "j-pop": "med"},
            **rich_on(genre_track_ids("anime", 6))},
   control={"trigger_purpose": "child_passenger_experience", "lifecycle_stage": "active_driving_content"},
   expectation=_exp("child + anime affinity/usage → an anime track tops",
                    top={"genre": "anime"}, top_fit_min=0.28, gradient="none",
                    service=["music_playlist", "quiz", "ranking_creation", "humming_karaoke"]))

# ---- Family H: singability + service link (standalone) ----
_p("preset-reststop-full-karaoke", family="singability_service",
   contrast_with=None,
   label={"en": "Rest-stop full karaoke", "ja": "休憩中フルカラオケ"},
   brief={"en": "Stopped at a rest area after the break, full-karaoke selected. With the karaoke service active the song-singability leaf turns on, so highly singable tracks by the driver's oshi rise.",
          "ja": "休憩後に停車、フルカラオケ選択。カラオケサービスで歌いやすさの要素が有効化され、歌いやすい推しの曲が上位に。"},
   situation={"drowsiness_level": 20, "fatigue_level": 15, "monotony_level": 20, "night_state": "day",
              "road_type": "highway", "motion_state": "stopped"},
   profile=strong_oshi(HIGE, {"j-pop": "high", "j-rock": "med"}),
   control={"trigger_purpose": "rest_recommended", "lifecycle_stage": "after_rest_before_restart",
            "motion_state": "stopped"},
   expectation=_exp("full-karaoke stage + oshi → a singable oshi track tops",
                    top={"must_be_oshi": True}, top_fit_min=0.35, gradient="none",
                    service=["full_karaoke", "live_viewing", "oshi_reexperience", "stretch_video",
                             "call_response_stopped"]))

# ---- Family I: history mechanics (standalone x2) ----
_REC3 = genre_track_ids("j-pop", 3, prefer_high_arousal=True)
_p("preset-high-recovery-regular", family="history_mechanics",
   contrast_with=None,
   label={"en": "High-recovery regulars", "ja": "回復実績の高い定番曲"},
   brief={"en": "No oshi, but three specific tracks have an excellent recovery record with this driver. The recovery-rate signal (the strongest History lever at rest) should lift exactly those three above equally-matched peers.",
          "ja": "推しはいないが、3曲がこのドライバーで高い回復実績を持つ。回復レートのシグナルにより、その3曲が同等の他曲より上位に。"},
   situation={"drowsiness_level": 78, "fatigue_level": 38, "monotony_level": 70, "night_state": "day",
              "road_type": "highway"},
   profile={**rich_on(_REC3, acc=90.0, rec=95.0)},
   expectation=_exp("strong per-track recovery history lifts exactly those tracks to the top",
                    top={"arousal_band": "high"}, top_fit_min=0.22, gradient="none",
                    service=["music_playlist", "humming_karaoke", "radio_style"]))

_PLAYED3 = genre_track_ids("j-pop", 3, prefer_high_arousal=True)
_p("preset-recently-played-fatigue", family="history_mechanics",
   contrast_with=None,
   label={"en": "Recently played — novelty penalty", "ja": "直近再生 — 新鮮さペナルティ"},
   brief={"en": "Three tracks that would otherwise score well were just played minutes ago. The recency/novelty penalty pushes them down, demonstrating that the algorithm avoids immediately repeating songs.",
          "ja": "本来は上位のはずの3曲を数分前に再生済み。新鮮さペナルティで順位が下がり、直近曲の繰り返しを避ける挙動を示す。"},
   situation={"drowsiness_level": 75, "fatigue_level": 40, "monotony_level": 62, "night_state": "day",
              "road_type": "highway"},
   profile={"genre_affinity_v1_enabled": True, "usage_by_genre": {"j-pop": "high"},
            **rich_on(genre_track_ids("j-pop", 8), acc=90.0, rec=85.0),
            **played_recent_on(_PLAYED3)},
   expectation=_exp("just-played tracks are demoted below other strong matches",
                    top={"genre": "j-pop"}, top_fit_min=0.22, gradient="none",
                    service=["music_playlist", "humming_karaoke", "radio_style"],
                    should_rank_below=[{"track_id": t} for t in _PLAYED3]))

# ---- Family J: baseline control ⇄ multi-lever combo (11 ⇄ 12) ----
_p("preset-coldstart-neutral", family="baseline",
   contrast_with="preset-anime-fan-event-night",
   label={"en": "Cold-start neutral (control)", "ja": "コールドスタート中立（対照）"},
   brief={"en": "The honest baseline: an unknown driver (no oshi, no history, no genre data) on an ordinary road. Scores stay low (~0.10) BY DESIGN — a third of the model's weight has nothing to act on. This control makes every personalized preset's lift meaningful.",
          "ja": "正直な基準：未知のドライバー（推し・履歴・ジャンル情報なし）で通常走行。設計上スコアは低いまま（約0.10）— モデル重みの約1/3が働く材料を持たない。対照として他プリセットの上振れを意味づける。"},
   situation={"drowsiness_level": 42, "fatigue_level": 28, "monotony_level": 40, "night_state": "day",
              "road_type": "highway"},
   profile={},  # pure neutral base
   control=ROUTE_MUSIC,
   expectation=_exp("cold-start: no personalization → low top score, documents the honest floor",
                    top={"arousal_band": "high"}, top_fit_min=0.08, gradient="none",
                    service=["music_playlist", "humming_karaoke", "radio_style"]))

_p("preset-anime-fan-event-night", family="combo",
   contrast_with="preset-coldstart-neutral",
   label={"en": "Anime fan — event night (all levers)", "ja": "アニメファン — イベントの夜（全レバー）"},
   brief={"en": "Everything on at once: a Hatsune Miku oshi, an anime-fan hobby, anime/vocaloid usage, and an event-hall destination at night. Anime/vocaloid tracks top strongly — the opposite extreme to the cold-start control.",
          "ja": "全レバー同時オン：初音ミク推し、アニメファン趣味、アニメ/ボカロ利用、夜のイベント会場。アニメ/ボカロ曲が強く上位に — 対照の真逆。"},
   situation={"night_state": "night", "destination_tags": ["event", "oshi_venue"],
              "route_tags": ["highway"], "monotony_level": 50, "drowsiness_level": 45, "fatigue_level": 30},
   profile={**strong_oshi(MIKU, {"anime": "high", "vocaloid": "high", "j-pop": "med"}),
            "hobby_interest_tags": ["anime-fan"]},
   control=ROUTE_MUSIC,
   expectation=_exp("stacked oshi + hobby + usage + destination → anime/vocaloid oshi track tops strongly",
                    top={"must_be_oshi": True}, top_fit_min=0.37, gradient="none",
                    service=["music_playlist", "humming_karaoke", "radio_style"]))


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
