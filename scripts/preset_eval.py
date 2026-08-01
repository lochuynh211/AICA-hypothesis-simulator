"""Faithful preset evaluator (feature 018) — run the REAL content + service
selectors on a committed preset and check its ``expectation`` contract.

Production-faithful: builds the content/service context exactly as
``routers/proposal.py`` does (``World.project()`` + catalog/genre merge) and calls
each package's ``evaluate`` through the same shape ``dispatch_selector`` uses.

Reused by:
  - app/api/tests/proposal/test_presets_expectations.py  (the assertion gate)
  - scripts/preset_analysis_report.py                    (the human report)

Read-only toward all frozen artifacts; imports only aica_api.models.proposal.* +
stdlib (never mdg), mirroring the isolation rule the runtime app follows.
"""
from __future__ import annotations

import copy
import importlib.util
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
_CONTENT_PKG = _REPO / "packages" / "aica_transparent_content_selector_v1"
_SERVICE_PKG = _REPO / "packages" / "aica_transparent_service_selector_v1"
PRESETS_DIR = _REPO / "proposal_contracts" / "presets"
_MATRIX = _REPO / "proposal_contracts" / "matrix" / "purpose_stage_matrix.v1.json"

# ---- Arousal-band thresholds (calibrated to this catalog; median arousal ~0.68).
BAND_HIGH = 0.70
BAND_LOW = 0.53


# --------------------------------------------------------------------------- #
# Frozen data (read-only, cached).
# --------------------------------------------------------------------------- #
def _load_json(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


_CATALOG = _load_json(_DATASET_DIR / "catalog.json")
_BY_ID = {s["spotify_track"]["id"]: s for s in _CATALOG}
_ARTIST_GENRES = _load_json(_DATASET_DIR / "genre_affinity_v1.json").get("artist_genres", {})
_MATRIX_ROWS = _load_json(_MATRIX).get("rows", [])


def _manifest(pkg: Path) -> dict:
    return _load_json(pkg / "package.json")


def _hp(pkg: Path) -> dict:
    return {h["key"]: h["default"] for h in _manifest(pkg)["hyperparameters"]}


_EVAL_CACHE: dict[str, object] = {}


def _evaluate(pkg: Path):
    key = str(pkg)
    if key not in _EVAL_CACHE:
        path = pkg / "algorithm.py"
        spec = importlib.util.spec_from_file_location(f"preseteval_{pkg.name}", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _EVAL_CACHE[key] = mod.evaluate
    return _EVAL_CACHE[key]


def _deep_merge(base: dict, over: dict | None) -> dict:
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        elif v is not None:
            out[k] = copy.deepcopy(v)
    return out


# --------------------------------------------------------------------------- #
# Track helpers.
# --------------------------------------------------------------------------- #
def _clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def arousal(tid: str) -> float:
    af = _BY_ID[tid]["spotify_audio_features"]
    nl = _clamp((af["loudness"] + 60) / 60)
    nt = _clamp((af["tempo"] - 60) / 120)
    return 0.30 * af["energy"] + 0.25 * nl + 0.25 * nt + 0.15 * af["danceability"] + 0.05 * (1 - af["acousticness"])


def band(a: float) -> str:
    return "high" if a >= BAND_HIGH else ("low" if a < BAND_LOW else "mid")


def genres_of(tid: str) -> set[str]:
    gs: set[str] = set()
    for a in _BY_ID[tid]["spotify_track"].get("artists") or []:
        gs.update(_ARTIST_GENRES.get(a.get("id"), []))
    return gs


def artists_of(tid: str) -> list[str]:
    return [a.get("id") for a in _BY_ID[tid]["spotify_track"].get("artists") or []]


def track_name(tid: str) -> str:
    t = _BY_ID[tid]["spotify_track"]
    arts = t.get("artists") or []
    return f"{t.get('name', '?')} — {(arts[0]['name'] if arts else '?')}"


def _allowed_services(purpose: str, stage: str) -> list[str]:
    for row in _MATRIX_ROWS:
        if row["trigger_purpose"] == purpose and row["lifecycle_stage"] == stage:
            return list(row["allowed_service_ids"])
    return []


# --------------------------------------------------------------------------- #
# Context builders (faithful to routers/proposal.py).
# --------------------------------------------------------------------------- #
def _content_context(world_dict: dict, *, overrides: dict | None, service_id: str,
                     plan_item_count: int | None = None) -> dict:
    world = World(**world_dict)
    fsnap, _ = world.project()
    fsnap = dict(fsnap)
    ext: list[str] = []
    if fsnap.get("_genre_extension_enabled"):
        gav = dict(fsnap.get("genre_affinity_v1") or {})
        gav["artist_genres"] = _ARTIST_GENRES
        fsnap["genre_affinity_v1"] = gav
        ext = ["genre_affinity_v1"]
    fsnap["catalog"] = _BY_ID
    fsnap["_service_id"] = service_id
    hp = _deep_merge(_hp(_CONTENT_PKG), overrides)
    hp["plan_item_count"] = plan_item_count if plan_item_count is not None else max(1, len(_BY_ID))
    ci = world_dict["control_inputs"]
    return {
        "contract_version": _manifest(_CONTENT_PKG).get("contract_version", "1.0.0"),
        "opportunity_id": "preset-eval", "simulation_time": "2026-07-17T12:00:00Z",
        "trigger_purpose": ci["trigger_purpose"], "lifecycle_stage": ci["lifecycle_stage"],
        "allowed_service_ids": [service_id], "selected_service_id": service_id,
        "feature_snapshot": fsnap, "feature_provenance": {}, "enabled_feature_extensions": ext,
        "eligible_candidates": [{"candidate_id": t} for t in _BY_ID], "excluded_candidates": [],
        "parameters": _manifest(_CONTENT_PKG).get("parameters", {}), "hyperparameters": hp,
        "package_runtime_state": {}, "catalog_version": "preset-eval", "run_seed": "preset-eval",
    }


_CONTENT_SUPPORTED = ("music_playlist", "humming_karaoke", "full_karaoke")


def content_service_id(preset: dict) -> str | None:
    """The service the app would dispatch content for: the highest-ranked
    content-supported service in the REAL service ranking (mirrors the app —
    content only renders for music_playlist/humming_karaoke/full_karaoke). None
    if no content-supported service is eligible (content genuinely unavailable)."""
    for c in rank_service(preset):
        if c["candidate_id"] in _CONTENT_SUPPORTED:
            return c["candidate_id"]
    return None


def rank_content(preset: dict) -> list[dict]:
    """Ordered items [{item_id, position, item_fit}] from the real content selector,
    scored for the service the app would actually use (faithful singability)."""
    world = preset["world"]
    ov = (preset.get("algorithm_config_overrides") or {}).get("content")
    service_id = content_service_id(preset) or "music_playlist"
    evaluate = _evaluate(_CONTENT_PKG)
    ctx = _content_context(world, overrides=ov, service_id=service_id)
    res = evaluate(ctx)
    if not res.get("ordered_items") and res.get("decision_type") == "insufficient_eligible_items":
        eligible = len(_BY_ID) - len(res.get("excluded_items", []))
        if eligible >= 1:
            res = evaluate(_content_context(world, overrides=ov, service_id=service_id,
                                            plan_item_count=eligible))
    return res.get("ordered_items", []) or []


def rank_service(preset: dict) -> list[dict]:
    """Ranked candidates [{candidate_id, score}] from the real service selector."""
    world = preset["world"]
    ov = (preset.get("algorithm_config_overrides") or {}).get("service")
    ci = world["control_inputs"]
    allowed = _allowed_services(ci["trigger_purpose"], ci["lifecycle_stage"])
    if not allowed:
        return []
    w = World(**world)
    fsnap, _ = w.project()
    hp = _deep_merge(_hp(_SERVICE_PKG), ov)
    ctx = {
        "contract_version": _manifest(_SERVICE_PKG).get("contract_version", "1.0.0"),
        "opportunity_id": "preset-eval", "simulation_time": "2026-07-17T12:00:00Z",
        "trigger_purpose": ci["trigger_purpose"], "lifecycle_stage": ci["lifecycle_stage"],
        "allowed_service_ids": allowed, "feature_snapshot": dict(fsnap), "feature_provenance": {},
        "enabled_feature_extensions": [], "selected_service_id": None,
        "eligible_candidates": [{"candidate_id": s} for s in allowed], "excluded_candidates": [],
        "parameters": _manifest(_SERVICE_PKG).get("parameters", {}), "hyperparameters": hp,
        "package_runtime_state": {}, "catalog_version": "preset-eval", "run_seed": "preset-eval",
    }
    res = _evaluate(_SERVICE_PKG)(ctx)
    out = []
    for c in res.get("ranked_candidates", []):
        cid = c.get("candidate_id")
        out.append({"candidate_id": cid.get("value") if isinstance(cid, dict) else cid,
                    "score": c.get("score")})
    return out


# --------------------------------------------------------------------------- #
# Expectation checking.
# --------------------------------------------------------------------------- #
def load_presets() -> dict[str, dict]:
    return {p.stem: _load_json(p) for p in sorted(PRESETS_DIR.glob("preset-*.json"))}


def evaluate_preset(preset: dict) -> dict:
    """Return a result row: real outcome + list of expectation failures (empty == pass)."""
    pid = preset["preset_id"]
    exp = preset["expectation"]
    # oshi_artists (feature 025 slice S2) replaces the old single oshi_id: any
    # of the driver's registered artist_ids counts as "the oshi" here,
    # regardless of each one's own 熱狂度 (enthusiasm) — must_be_oshi asks
    # "is the top track credited to a registered oshi at all", not which one.
    oshi_ids = {a["artist_id"] for a in preset["world"]["driver_profile"].get("oshi_artists", [])}
    items = rank_content(preset)
    fails: list[str] = []
    if not items:
        return {"preset_id": pid, "ok": False, "fails": ["content produced no ranked items"],
                "top": None, "top_fit": None, "top_name": None, "arousal": None, "service_top": None}
    top = items[0]
    tid, tfit = top["item_id"], top["item_fit"]
    et = exp.get("expected_top") or {}
    is_oshi_top = bool(oshi_ids & set(artists_of(tid)))
    if et.get("must_be_oshi") is True and not is_oshi_top:
        fails.append(f"top is not the oshi ({sorted(oshi_ids)})")
    if et.get("must_be_oshi") is False and is_oshi_top:
        fails.append("top IS the oshi but expected otherwise")
    if et.get("genre") and et["genre"] not in genres_of(tid):
        fails.append(f"top genre {sorted(genres_of(tid))} lacks '{et['genre']}'")
    if et.get("arousal_band") and band(arousal(tid)) != et["arousal_band"]:
        fails.append(f"top arousal band '{band(arousal(tid))}' != '{et['arousal_band']}'")
    if et.get("track_id") and tid != et["track_id"]:
        fails.append(f"top track {tid} != expected {et['track_id']}")
    if tfit < exp["top_fit_min"] - 1e-9:
        fails.append(f"top_fit {tfit:.3f} < top_fit_min {exp['top_fit_min']}")
    for srb in exp.get("should_rank_below", []):
        rtid = srb.get("track_id")
        if rtid:
            rpos = next((it["position"] for it in items if it["item_id"] == rtid), None)
            if rpos is not None and rpos <= top["position"]:
                fails.append(f"{rtid} ranked {rpos} not below the top")
    svc = rank_service(preset)
    svc_top = svc[0]["candidate_id"] if svc else None
    if svc_top and svc_top not in exp["expected_service"]["top_should_be_in"]:
        fails.append(f"service top '{svc_top}' not in {exp['expected_service']['top_should_be_in']}")
    return {"preset_id": pid, "ok": not fails, "fails": fails, "top": tid, "top_fit": round(tfit, 4),
            "top_name": track_name(tid), "arousal": round(arousal(tid), 3), "service_top": svc_top,
            "service_score": round(svc[0]["score"], 3) if svc else None,
            "contrast_with": preset.get("contrast_with")}


def evaluate_all() -> dict[str, dict]:
    return {pid: evaluate_preset(p) for pid, p in load_presets().items()}
