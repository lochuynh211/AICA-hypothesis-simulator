"""aica_transparent_content_selector_v1 — transparent music content selector.

Two-axis (arousal/valence) song-trait content selector. After a music *service* has
been selected, this package ranks concrete songs for `music_playlist`,
`humming_karaoke`, and `full_karaoke` and returns one ordered `complete_plan`
(no aggregate plan score). Authoritative math:
`docs/master/aica_transparent_content_proposal_algorithm.md`.

Contract (see `specs/011-p6-content-selector/contracts/evaluate_contract.md`):
  evaluate(context: dict) -> dict   # SelectorInput-shaped in, CompletePlan-shaped out

Purity: no file/network I/O, no clock, no randomness. The eligible song catalog is
supplied already-loaded in `context["feature_snapshot"]["catalog"]` (a harness reads the
one JSON song DB; the package never opens files). Identical inputs + versions reproduce an
identical plan and evidence.

Pipeline (evaluate):
  1. validate control inputs + service gating (present+supported => proceed);
  2. resolve effective weights once (base x purpose x mask -> normalize, §6);
  3. per eligible candidate: resolve the Song, run hard eligibility (§7);
  4. derive four traits (§4.4) and compute r_i = e_i * a_i for every scored feature (§5);
  5. item_fit = clamp(Σ w_i·r_i, -1, +1); sort (item_fit desc, id asc); take plan_item_count;
  6. build plan modes / duration / lighting / bilingual reasons / evidence (§9, §14).

Every hyperparameter is read via direct `hp[key]` indexing; a missing key is a real
configuration bug surfaced as `invalid_configuration`, never a silent default.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone

FORMULA_ORDER = [
    "drowsiness", "fatigue", "monotony", "traffic", "road", "night", "motion",
    "service_ease", "route", "destination", "child", "hobbies",
    "oshi", "age", "item_usage", "genre_usage", "scene_genre",
    "played", "skipped", "changed", "acceptance", "recovery",
]

_KARAOKE_SERVICES = {"humming_karaoke", "full_karaoke"}
_MUSIC_SERVICES = {"music_playlist", "humming_karaoke", "full_karaoke"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, v))


def _norm0(v: float) -> float:
    """Normalize -0.0 to +0.0 for deterministic serialization."""
    return v + 0.0 if v == 0 else v


class _ConfigError(Exception):
    """Raised for invalid_configuration conditions."""


class _CatalogError(Exception):
    """Raised for invalid_catalog conditions."""


# ---------------------------------------------------------------------------
# Trait derivation (§4.4, Table 1)
# ---------------------------------------------------------------------------


def _audio_components(af: dict, b: dict) -> dict:
    """Compute the canonical trait input components from Audio Features + bounds."""
    required = ("energy", "loudness", "tempo", "danceability", "acousticness",
                "valence", "mode", "instrumentalness", "speechiness", "duration_ms")
    for key in required:
        if key not in af or af[key] is None:
            raise _CatalogError(f"audio_features missing required field '{key}'")
        val = af[key]
        if isinstance(val, float) and not math.isfinite(val):
            raise _CatalogError(f"audio_features '{key}' not finite")

    norm_loudness = _clamp((af["loudness"] - b["loudness_min"]) / b["loudness_range"])
    norm_tempo = _clamp((af["tempo"] - b["tempo_min"]) / b["tempo_range"])
    tempo_ease = 1.0 - _clamp(abs(af["tempo"] - b["tempo_ease_center"]) / b["tempo_ease_span"])
    speech_ease = 1.0 - _clamp((af["speechiness"] - b["speech_ease_threshold"]) / b["speech_ease_span"])
    duration_ease = 1.0 - _clamp((af["duration_ms"] - b["duration_ease_center"]) / b["duration_ease_span"])
    return {
        "energy": af["energy"],
        "norm_loudness": norm_loudness,
        "norm_tempo": norm_tempo,
        "danceability": af["danceability"],
        "acousticness_inv": 1.0 - af["acousticness"],
        "valence": af["valence"],
        "mode": float(af["mode"]),
        "instrumentalness_inv": 1.0 - af["instrumentalness"],
        "speech_ease": speech_ease,
        "tempo_ease": tempo_ease,
        "duration_ease": duration_ease,
    }


def derive_traits(af: dict, hp: dict) -> dict:
    """Derive the four traits (§4.4) and their signed forms. Values in [0,1]."""
    matrix = hp["trait_composition_matrix"]
    bounds = hp["norm_bounds"]
    comp = _audio_components(af, bounds)
    traits = {}
    for trait_name, weights in matrix.items():
        traits[trait_name] = _clamp(sum(w * comp[field] for field, w in weights.items()))
    return {
        "arousal": traits["arousal"],
        "valence": traits["valence"],
        "humming_ease": traits["humming_ease"],
        "full_karaoke_ease": traits["full_karaoke_ease"],
        "arousal_signed": 2.0 * traits["arousal"] - 1.0,
        "valence_signed": 2.0 * traits["valence"] - 1.0,
    }


# ---------------------------------------------------------------------------
# Effective weights (§6)
# ---------------------------------------------------------------------------


def resolve_weights(hp: dict, service_id: str, purpose: str, genre_on: bool) -> dict:
    """Resolve normalized effective weights once. Returns {leaf_key: entry}.

    entry = {feature_id, category, subgroup, base_weight, purpose_multiplier, mask,
             raw, effective_weight, genre_gated, karaoke_only}
    """
    cat_w = hp["content_category_weights"]
    hierarchy = hp["hierarchy_weights"]
    multipliers = hp["purpose_multipliers"]
    entries: dict = {}
    raw_total = 0.0

    for category, subgroups in hierarchy.items():
        for subgroup, sub in subgroups.items():
            for leaf, leaf_def in sub["leaves"].items():
                mask = int(leaf_def.get("mask", 0))
                if leaf_def.get("karaoke_only"):
                    mask = 1 if service_id in _KARAOKE_SERVICES else 0
                if leaf_def.get("genre_gated"):
                    mask = 1 if genre_on else 0
                base = cat_w[category] * sub["share"] * leaf_def["share"]
                pmult = multipliers.get(subgroup, {}).get(purpose, 1.0)
                raw = base * pmult * mask
                raw_total += raw
                entries[leaf] = {
                    "feature_id": leaf_def["feature_id"],
                    "category": category,
                    "subgroup": subgroup,
                    "base_weight": base,
                    "purpose_multiplier": pmult,
                    "mask": mask,
                    "raw": raw,
                    "genre_gated": bool(leaf_def.get("genre_gated", False)),
                    "karaoke_only": bool(leaf_def.get("karaoke_only", False)),
                    "effective_weight": 0.0,
                }

    if raw_total <= 0 or not math.isfinite(raw_total):
        raise _ConfigError("zero or non-finite active-weight denominator")
    for e in entries.values():
        e["effective_weight"] = e["raw"] / raw_total
    return entries


# ---------------------------------------------------------------------------
# Evidence + response per feature (§5)
# ---------------------------------------------------------------------------


def _parse_dt(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value), tz=timezone.utc)
    try:
        s = str(value).replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return None


def _era_bucket(release_date):
    if not release_date:
        return None
    try:
        year = int(str(release_date)[:4])
    except (ValueError, TypeError):
        return None
    if year < 1980:
        return "pre1980"
    if year < 1990:
        return "1980s"
    if year < 2000:
        return "1990s"
    if year < 2010:
        return "2000s"
    if year < 2020:
        return "2010s"
    return "2020s"


def _mood(alpha: float, beta: float, directional: bool, A_s: float, V_s: float, hp: dict):
    """Return (a_i, alpha_used, beta_used) applying the directional_hypothesis flip."""
    a_used = alpha
    if directional and hp["directional_hypothesis"] == "keep_alert":
        a_used = -alpha
    return a_used * A_s + beta * V_s, a_used, beta


def _genre_set(track: dict, gav1: dict) -> set:
    artist_genres = (gav1 or {}).get("artist_genres", {}) or {}
    genres: set = set()
    for artist in track.get("artists") or []:
        for g in artist_genres.get(artist.get("id"), []):
            genres.add(g)
    return genres


def _best_match(g_song: set, g_target: dict):
    """max over g in G_song of g_target[g], clamped to [-1,1]; None if no overlap."""
    vals = [g_target[g] for g in g_song if g in g_target]
    if not vals:
        return None
    return _clamp(max(vals), -1.0, 1.0)


def _usage_curve(level, curve):
    if level is None:
        return 0.0
    return curve.get(level, 0.0)


def _feature_e_a(leaf, entry, snap, track, traits, hp, sim_dt, genre_on, gav1, scene):
    """Compute (e_i, a_i, meta) for a leaf. meta carries alpha/beta/exact_match/provenance.

    Returns None to signal 'not applicable / masked out' (contributes nothing, but still
    listed). Absent scored field => (0, 0, missing_neutral) per §8.
    """
    fid = entry["feature_id"]
    situation = snap.get("situation", {}) or {}
    preference = snap.get("preference", {}) or {}
    history = snap.get("history", {}) or {}
    A_s, V_s = traits["arousal_signed"], traits["valence_signed"]
    crm = hp["context_response_matrix"]
    curves = hp["history_curves"]
    tid = track["id"]

    def mood_meta(a, alpha, beta):
        return {"alpha": alpha, "beta": beta, "exact_match": None, "provenance": "normalized_context_hypothesis"}

    # --- six driver/environment mood features ---
    if leaf == "drowsiness":
        e = _clamp(float(situation.get("drowsiness_level", 0)) / 100.0)
        a, al, be = _mood(crm["drowsiness"]["alpha"], crm["drowsiness"]["beta"], False, A_s, V_s, hp)
        return e, a, mood_meta(a, al, be)
    if leaf == "fatigue":
        e = _clamp(float(situation.get("fatigue_level", 0)) / 100.0)
        a, al, be = _mood(crm["fatigue"]["alpha"], crm["fatigue"]["beta"], True, A_s, V_s, hp)
        return e, a, mood_meta(a, al, be)
    if leaf == "monotony":
        e = _clamp(float(situation.get("monotony_level", 0)) / 100.0)
        a, al, be = _mood(crm["monotony"]["alpha"], crm["monotony"]["beta"], False, A_s, V_s, hp)
        return e, a, mood_meta(a, al, be)
    if leaf == "traffic":
        congested = situation.get("traffic_state") == "congested"
        e = 1.0 if congested else 0.0
        a, al, be = _mood(crm["traffic_congested"]["alpha"], crm["traffic_congested"]["beta"], True, A_s, V_s, hp)
        return e, a, mood_meta(a, al, be)
    if leaf == "road":
        rtype = situation.get("road_type", "local")
        road_cfg = crm["road"].get(rtype, {"alpha": 0.0, "beta": 0.0})
        e = 1.0
        a = road_cfg["alpha"] * A_s + road_cfg["beta"] * V_s
        return e, a, mood_meta(a, road_cfg["alpha"], road_cfg["beta"])
    if leaf == "night":
        night = situation.get("night_state") == "night"
        e = 1.0 if night else 0.0
        a, al, be = _mood(crm["night"]["alpha"], crm["night"]["beta"], True, A_s, V_s, hp)
        return e, a, mood_meta(a, al, be)
    if leaf == "motion":
        driving = situation.get("motion_state") == "driving"
        e = 1.0 if driving else 0.0
        a, al, be = _mood(crm["motion_driving"]["alpha"], crm["motion_driving"]["beta"], False, A_s, V_s, hp)
        return e, a, mood_meta(a, al, be)

    # --- song singability (added construct, karaoke only) ---
    if leaf == "service_ease":
        service = snap.get("_service_id")
        ease = traits["humming_ease"] if service == "humming_karaoke" else traits["full_karaoke_ease"]
        e = 1.0
        a = 2.0 * ease - 1.0
        return e, a, {"alpha": None, "beta": None, "exact_match": None, "provenance": "service_definition"}

    # --- genre-gated features (only meaningful when extension on) ---
    if leaf in ("route", "destination", "child", "hobbies", "genre_usage", "scene_genre"):
        if not genre_on:
            return 0.0, 0.0, {"alpha": None, "beta": None, "exact_match": None, "provenance": "normalized_context_hypothesis"}
        maps = hp["genre_affinity_maps"]
        g_song = _genre_set(track, gav1)
        g_target = {}
        e = 0.0
        if leaf == "route":
            tags = situation.get("route_tags", []) or []
            recog = [t for t in tags if t in maps["route"]]
            for t in recog:
                for g, w in maps["route"][t].items():
                    g_target[g] = max(g_target.get(g, -2.0), w)
            e = 1.0 if recog else 0.0
        elif leaf == "destination":
            tags = situation.get("destination_tags", []) or []
            recog = [t for t in tags if t in maps["destination"]]
            for t in recog:
                for g, w in maps["destination"][t].items():
                    g_target[g] = max(g_target.get(g, -2.0), w)
            e = 1.0 if recog else 0.0
        elif leaf == "child":
            if situation.get("child_present"):
                g_target = dict(maps["child"])
                e = 1.0
        elif leaf == "hobbies":
            tags = preference.get("hobby_interest_tags", []) or []
            recog = [t for t in tags if t in maps["hobby"]]
            for t in recog:
                for g, w in maps["hobby"][t].items():
                    g_target[g] = max(g_target.get(g, -2.0), w)
            e = 1.0 if recog else 0.0
        elif leaf == "genre_usage":
            usage = (gav1 or {}).get("usage_by_genre")
            if usage:
                g_target = {g: _usage_curve(lvl, maps["usage_curve"]) for g, lvl in usage.items()}
                e = 1.0
        elif leaf == "scene_genre":
            scene_usage = (gav1 or {}).get("scene_genre_usage") or {}
            cur = scene_usage.get(scene) if scene else None
            if cur:
                g_target = {g: _usage_curve(lvl, maps["usage_curve"]) for g, lvl in cur.items()}
                e = 1.0
        a = _best_match(g_song, g_target)
        if a is None:
            a = 0.0  # missing_neutral (no overlap / empty G_song)
        return e, a, {"alpha": None, "beta": None, "exact_match": None, "provenance": "normalized_context_hypothesis"}

    # --- oshi (gate + exact artist match) ---
    if leaf == "oshi":
        registered = bool(preference.get("oshi_registered"))
        mode_on = preference.get("oshi_mode") == "on"
        oshi_id = preference.get("oshi_id")
        gate = 1.0 if (registered and mode_on and oshi_id) else 0.0
        match = any(a.get("id") == oshi_id for a in (track.get("artists") or [])) if oshi_id else False
        return gate, (1.0 if match else 0.0), {"alpha": None, "beta": None, "exact_match": bool(match), "provenance": "cdc_su_explicit"}

    # --- age/era affinity ---
    if leaf == "age":
        band = preference.get("age_band")
        album = track.get("album") or {}
        era = _era_bucket(album.get("release_date"))
        if band and era:
            e = 1.0
            a = _clamp(hp["age_era_affinity"].get(band, {}).get(era, 0.0), -1.0, 1.0)
        else:
            e, a = 0.0, 0.0
        return e, a, {"alpha": None, "beta": None, "exact_match": None, "provenance": "normalized_context_hypothesis"}

    # --- exact-ID history features (e signed, a = +1 on own id) ---
    if leaf == "item_usage":
        levels = preference.get("catalog_item_usage_level", {}) or {}
        e = _usage_curve(levels.get(tid), curves["item_usage"])
        return e, 1.0, {"alpha": None, "beta": None, "exact_match": True, "provenance": "cdc_su_explicit"}
    if leaf == "played":
        e = _played_evidence(preference.get("played_items", []) or [], tid, sim_dt, curves["played"])
        return e, 1.0, {"alpha": None, "beta": None, "exact_match": True, "provenance": "cdc_su_explicit"}
    if leaf == "skipped":
        # in-window skips are excluded by eligibility; older skips score -0.5
        e = _older_skip_evidence(preference.get("skipped_items", []) or [], tid, sim_dt, hp, curves["skipped_older"])
        return e, 1.0, {"alpha": None, "beta": None, "exact_match": True, "provenance": "cdc_su_explicit"}
    if leaf == "changed":
        e = _changed_evidence(preference.get("changed_from_items", []) or [], tid, sim_dt, hp, curves["changed_in_window"])
        return e, 1.0, {"alpha": None, "beta": None, "exact_match": True, "provenance": "cdc_su_explicit"}
    if leaf == "acceptance":
        rates = history.get("content_proposal_acceptance_rate", {}) or {}
        if tid in rates:
            e = 2.0 * float(rates[tid]) / curves["rate_scale"] - 1.0
        else:
            e = 0.0
        return e, 1.0, {"alpha": None, "beta": None, "exact_match": True, "provenance": "cdc_su_explicit"}
    if leaf == "recovery":
        rates = history.get("content_recovery_rate", {}) or {}
        if tid in rates:
            e = 2.0 * float(rates[tid]) / curves["rate_scale"] - 1.0
        else:
            e = 0.0
        return e, 1.0, {"alpha": None, "beta": None, "exact_match": True, "provenance": "cdc_su_explicit"}

    # Unknown leaf => neutral
    return 0.0, 0.0, {"alpha": None, "beta": None, "exact_match": None, "provenance": None}


def _seconds_since(events_dt, sim_dt):
    if sim_dt is None or events_dt is None:
        return None
    return (sim_dt - events_dt).total_seconds()


def _played_evidence(played_items, tid, sim_dt, curve):
    best = None  # most negative (strongest) evidence
    for item in played_items:
        if item.get("track_id") != tid:
            continue
        dt = _parse_dt(item.get("last_played_at"))
        delta = _seconds_since(dt, sim_dt)
        if delta is None:
            val = 0.0
        elif delta <= 1800:
            val = curve["le_30m"]
        elif delta <= 86400:
            val = curve["today"]
        elif delta <= 604800:
            val = curve["le_7d"]
        else:
            val = curve["else"]
        best = val if best is None else min(best, val)
    return best if best is not None else 0.0


def _older_skip_evidence(skipped_items, tid, sim_dt, hp, older_val):
    window = hp["skip_exclusion_window_sec"]
    for item in skipped_items:
        if item.get("track_id") != tid:
            continue
        dt = _parse_dt(item.get("skipped_at"))
        delta = _seconds_since(dt, sim_dt)
        if delta is not None and delta > window:
            return older_val
    return 0.0


def _changed_evidence(changed_items, tid, sim_dt, hp, changed_val):
    window = hp["skip_exclusion_window_sec"]
    for item in changed_items:
        if item.get("track_id") != tid:
            continue
        dt = _parse_dt(item.get("changed_at"))
        delta = _seconds_since(dt, sim_dt)
        if delta is None or delta <= window:
            return changed_val
    return 0.0


# ---------------------------------------------------------------------------
# Eligibility (§7)
# ---------------------------------------------------------------------------


def eligibility_reasons(song: dict, snap: dict, service_id: str, sim_dt, hp: dict, seen_ids: set) -> list:
    """Return a list of reason codes; empty means eligible."""
    reasons = []
    track = song.get("spotify_track", {})
    af = song.get("spotify_audio_features", {})
    flags = song.get("simulation_flags", {}) or {}
    tid = track.get("id")

    # schema/identity
    if track.get("id") != af.get("id") or track.get("uri") != af.get("uri") or track.get("duration_ms") != af.get("duration_ms"):
        reasons.append("identity_mismatch")
    if track.get("is_playable") is False:
        reasons.append("not_playable")
    market = snap.get("market")
    if market is not None:
        markets = track.get("available_markets")
        if markets is not None and market not in markets:
            reasons.append("market_unavailable")
    if track.get("restrictions"):
        reasons.append("restricted")
    if track.get("explicit") and (snap.get("situation", {}) or {}).get("child_present"):
        reasons.append("explicit_under_child")
    # recent skip window
    window = hp["skip_exclusion_window_sec"]
    for item in (snap.get("preference", {}) or {}).get("skipped_items", []) or []:
        if item.get("track_id") == tid:
            delta = _seconds_since(_parse_dt(item.get("skipped_at")), sim_dt)
            if delta is not None and delta <= window:
                reasons.append("recent_skip")
                break
    if tid in seen_ids:
        reasons.append("duplicate")
    # karaoke gates
    if service_id == "humming_karaoke" and int(flags.get("humming_karaoke_available", 1)) != 1:
        reasons.append("humming_unavailable")
    if service_id == "full_karaoke":
        if int(flags.get("full_karaoke_available", 1)) != 1:
            reasons.append("full_karaoke_unavailable")
    return reasons


# ---------------------------------------------------------------------------
# Reasons (bilingual)
# ---------------------------------------------------------------------------

_FEATURE_LABELS = {
    "drowsiness": {"ja": "眠気", "en": "drowsiness"},
    "fatigue": {"ja": "疲労", "en": "fatigue"},
    "monotony": {"ja": "単調性", "en": "monotony"},
    "traffic": {"ja": "渋滞", "en": "traffic"},
    "road": {"ja": "道路種別", "en": "road type"},
    "night": {"ja": "夜間", "en": "night"},
    "motion": {"ja": "走行状態", "en": "motion"},
    "service_ease": {"ja": "歌いやすさ", "en": "singability"},
    "oshi": {"ja": "推し一致", "en": "oshi match"},
    "age": {"ja": "年代適合", "en": "era fit"},
    "item_usage": {"ja": "利用頻度", "en": "usage"},
    "played": {"ja": "再生履歴", "en": "recent play"},
    "skipped": {"ja": "スキップ履歴", "en": "skip history"},
    "changed": {"ja": "変更履歴", "en": "change history"},
    "acceptance": {"ja": "受容率", "en": "acceptance rate"},
    "recovery": {"ja": "回復率", "en": "recovery rate"},
    "route": {"ja": "ルート適合", "en": "route fit"},
    "destination": {"ja": "目的地適合", "en": "destination fit"},
    "child": {"ja": "子供向け", "en": "child-friendly"},
    "hobbies": {"ja": "趣味適合", "en": "hobby fit"},
    "genre_usage": {"ja": "ジャンル利用", "en": "genre usage"},
    "scene_genre": {"ja": "シーン別ジャンル", "en": "scene genre"},
}


def _build_reasons(contributions: list) -> list:
    """Top positive/negative contributions as bilingual reason strings.

    The frozen ``OrderedItem.rationale`` contract is ``list[str]``; each entry is a
    single JA-first bilingual string (``"<ja> / <en>"``) — Japanese is the default
    presentation language, English follows.
    """
    ranked = sorted(contributions, key=lambda c: c["contribution"], reverse=True)
    reasons = []
    pos = [c for c in ranked if c["contribution"] > 1e-9][:2]
    neg = [c for c in ranked if c["contribution"] < -1e-9][-2:]
    for c in pos:
        lab = _FEATURE_LABELS.get(c["leaf"], {"ja": c["leaf"], "en": c["leaf"]})
        reasons.append(
            f"{lab['ja']}が推薦に寄与（+{c['contribution']:.3f}） / "
            f"{lab['en']} supports this pick (+{c['contribution']:.3f})"
        )
    for c in neg:
        lab = _FEATURE_LABELS.get(c["leaf"], {"ja": c["leaf"], "en": c["leaf"]})
        reasons.append(
            f"{lab['ja']}がマイナスに作用（{c['contribution']:.3f}） / "
            f"{lab['en']} weighs against it ({c['contribution']:.3f})"
        )
    if not reasons:
        reasons.append("中立的なスコア。 / Neutral score.")
    return reasons


# ---------------------------------------------------------------------------
# Plan mode / duration / lighting
# ---------------------------------------------------------------------------


def _plan_mode(service_id: str) -> dict:
    if service_id == "humming_karaoke":
        return {"service_id": service_id, "mode_kind": "humming", "chorus_only": True,
                "guide_vocal": True, "driving_lyrics": False, "fixed_segment_sec": None,
                "stopped_only": None, "simulated_queue": None}
    if service_id == "full_karaoke":
        return {"service_id": service_id, "mode_kind": "full_karaoke", "chorus_only": None,
                "guide_vocal": None, "driving_lyrics": None, "fixed_segment_sec": None,
                "stopped_only": True, "simulated_queue": True}
    return {"service_id": service_id, "mode_kind": "playlist", "chorus_only": None,
            "guide_vocal": None, "driving_lyrics": None, "fixed_segment_sec": None,
            "stopped_only": None, "simulated_queue": None}


def _lighting(service_id: str, hp: dict, params: dict, top_valence: float):
    compatible = params.get("lighting_compatible_services", [])
    if service_id not in compatible:
        return None
    lut = hp["lighting_lookup"]
    if top_valence >= lut["high_threshold"]:
        cue = lut["high_cue"]
    elif top_valence <= lut["low_threshold"]:
        cue = lut["low_cue"]
    else:
        cue = lut["mid_cue"]
    return {"enabled": True, "cue_basis": lut["cue_basis"], "notes": cue}


# ---------------------------------------------------------------------------
# Result helpers
# ---------------------------------------------------------------------------


def _error(decision_type: str, service_id, hp: dict, reason: str) -> dict:
    return {
        "decision_type": decision_type,
        "selected_service_id": service_id if service_id in _MUSIC_SERVICES else "music_playlist",
        "requested_item_count": hp.get("plan_item_count", 5) if isinstance(hp, dict) else 5,
        "returned_item_count": 0,
        "ordered_items": [],
        "mode": _plan_mode(service_id if service_id in _MUSIC_SERVICES else "music_playlist"),
        "expected_duration_sec": 0,
        "lighting_configuration": None,
        "approval_policy": "explicit_opt_in",
        "completion_rule": "plan_exhausted",
        "next_transition_policy": "await_user",
        "excluded_items": [],
        "unused_available_features": [],
        "missing_features": [],
        "algorithm_provenance": {"error_reason": reason},
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def evaluate(context: dict) -> dict:
    """Rank songs for the selected music service; return a CompletePlan-shaped dict."""
    hp = context["hyperparameters"]
    params = context.get("parameters", {}) or {}
    service_id = context.get("selected_service_id")
    purpose = context.get("trigger_purpose")
    extensions = context.get("enabled_feature_extensions", []) or []
    genre_on = "genre_affinity_v1" in extensions
    snap = dict(context.get("feature_snapshot", {}) or {})
    snap["_service_id"] = service_id
    catalog = snap.get("catalog", {}) or {}
    situation = snap.get("situation", {}) or {}
    scene = snap.get("current_scene")
    gav1 = snap.get("genre_affinity_v1") if genre_on else None
    sim_dt = _parse_dt(context.get("simulation_time"))

    # 1. service gating (FR-003a)
    if not service_id:
        return _error("invalid_request", service_id, hp, "missing_selected_service_id")
    if service_id not in _MUSIC_SERVICES:
        return _error("unsupported_recipe", service_id, hp, "service_not_a_music_recipe")

    # full-karaoke stopped-motion gate (before scoring)
    if service_id == "full_karaoke" and situation.get("motion_state") == "driving":
        return _error("full_karaoke_requires_stopped", service_id, hp, "full_karaoke_while_moving")

    # 2. resolve effective weights once
    try:
        weights = resolve_weights(hp, service_id, purpose, genre_on)
    except _ConfigError as exc:
        return _error("invalid_configuration", service_id, hp, str(exc))

    scored_leaves = {k: e for k, e in weights.items() if e["mask"] == 1}

    # 3-5. per candidate: eligibility, traits, scoring
    eligible_ids = [c["candidate_id"] for c in context.get("eligible_candidates", []) or []]
    excluded_items = [{"item_id": c["candidate_id"], "reason_codes": [c.get("platform_reason", "platform_excluded")]}
                      for c in context.get("excluded_candidates", []) or []]

    seen: set = set()
    scored_songs = []
    try:
        for cid in eligible_ids:
            if cid not in catalog:
                raise _CatalogError(f"candidate '{cid}' not present in catalog")
            song = catalog[cid]
            reasons = eligibility_reasons(song, snap, service_id, sim_dt, hp, seen)
            if reasons:
                excluded_items.append({"item_id": cid, "reason_codes": reasons})
                continue
            seen.add(cid)
            track = song["spotify_track"]
            af = song["spotify_audio_features"]
            traits = derive_traits(af, hp)
            contributions = []
            item_fit_sum = 0.0
            # §14 roll-up: subtotal contributions by top-level category.
            cat_subtotals = {"situation": 0.0, "preference": 0.0, "history": 0.0}
            for leaf, entry in scored_leaves.items():
                e_i, a_i, meta = _feature_e_a(leaf, entry, snap, track, traits, hp, sim_dt, genre_on, gav1, scene)
                r_i = e_i * a_i
                contribution = entry["effective_weight"] * r_i
                item_fit_sum += contribution
                _cat = str(entry.get("category", "")).lower()
                if _cat in cat_subtotals:
                    cat_subtotals[_cat] += contribution
                contributions.append({
                    "leaf": leaf,
                    "feature_id": entry["feature_id"],
                    "e_i": _norm0(e_i), "a_i": _norm0(a_i),
                    "alpha": meta["alpha"], "beta": meta["beta"],
                    "exact_match": meta["exact_match"],
                    "response_provenance": meta["provenance"],
                    "r_i": _norm0(r_i),
                    "base_weight": entry["base_weight"],
                    "purpose_multiplier": entry["purpose_multiplier"],
                    "mask": entry["mask"],
                    "effective_weight": entry["effective_weight"],
                    "contribution": _norm0(contribution),
                    "formula_version": hp["formula_version"],
                })
            item_fit = _norm0(_clamp(item_fit_sum, -1.0, 1.0))
            # Strongest supporting (max positive) / opposing (min negative) feature.
            _support = max(contributions, key=lambda c: c["contribution"], default=None)
            _oppose = min(contributions, key=lambda c: c["contribution"], default=None)
            strongest_support = (
                {"feature_id": _support["feature_id"], "contribution": _support["contribution"]}
                if _support is not None and _support["contribution"] > 0
                else None
            )
            strongest_oppose = (
                {"feature_id": _oppose["feature_id"], "contribution": _oppose["contribution"]}
                if _oppose is not None and _oppose["contribution"] < 0
                else None
            )
            scored_songs.append({
                "track": track, "traits": traits, "item_fit": item_fit,
                "contributions": contributions,
                "situation_fit": _norm0(cat_subtotals["situation"]),
                "preference_fit": _norm0(cat_subtotals["preference"]),
                "history_fit": _norm0(cat_subtotals["history"]),
                "strongest_support": strongest_support,
                "strongest_oppose": strongest_oppose,
            })
    except _CatalogError as exc:
        return _error("invalid_catalog", service_id, hp, str(exc))
    except _ConfigError as exc:
        return _error("invalid_configuration", service_id, hp, str(exc))

    plan_count = int(hp["plan_item_count"])

    if not scored_songs:
        return _error("no_proposal", service_id, hp, "all_candidates_excluded") | {"excluded_items": excluded_items}
    if len(scored_songs) < plan_count:
        out = _error("insufficient_eligible_items", service_id, hp, "fewer_eligible_than_count")
        out["excluded_items"] = excluded_items
        return out

    # sort (item_fit desc, id asc), take N
    scored_songs.sort(key=lambda s: (-s["item_fit"], s["track"]["id"]))
    chosen = scored_songs[:plan_count]

    # 6. build plan
    ordered_items = []
    for pos, s in enumerate(chosen, start=1):
        t = s["traits"]
        ordered_items.append({
            "position": pos,
            "item_id": s["track"]["id"],
            "item_fit": s["item_fit"],
            "trait_values": {
                "arousal": t["arousal"], "valence": t["valence"],
                "humming_ease": t["humming_ease"], "full_karaoke_ease": t["full_karaoke_ease"],
                "arousal_signed": t["arousal_signed"], "valence_signed": t["valence_signed"],
            },
            "feature_contributions": [{k: v for k, v in c.items() if k != "leaf"} for c in s["contributions"]],
            "rationale": _build_reasons(s["contributions"]),
            "situation_fit": s["situation_fit"],
            "preference_fit": s["preference_fit"],
            "history_fit": s["history_fit"],
            "strongest_support": s["strongest_support"],
            "strongest_oppose": s["strongest_oppose"],
        })

    mode = _plan_mode(service_id)
    if service_id == "humming_karaoke":
        mode["fixed_segment_sec"] = int(hp["fixed_humming_segment_sec"])
        expected_duration = plan_count * int(hp["fixed_humming_segment_sec"])
        duration_basis = "simulated_fixed_segment"
    else:
        expected_duration = sum(int(s["track"]["duration_ms"]) for s in chosen) // 1000
        duration_basis = "summed_track_durations"

    top_valence = chosen[0]["traits"]["valence"]
    lighting = _lighting(service_id, hp, params, top_valence)

    # ---- disposition-driven provenance over the full frozen registry (§9 / A.2) ----
    # Every registry row is classified active / context_only / missing_neutral so the
    # plan accounts for the selector's entire feature surface, not just its scored leaves.
    registry = context.get("feature_dispositions") or []
    reg_by_id = {r["feature_id"]: r for r in registry}

    scored_fids = {e["feature_id"] for e in scored_leaves.values()}
    all_leaf_fids = {e["feature_id"] for e in weights.values()}
    masked_fids = all_leaf_fids - scored_fids  # leaves present but effective mask 0

    # A scored feature is "present" when it carried evidence for any chosen song.
    present_fids: set = set()
    resp_prov_by_fid: dict = {}
    for s in chosen:
        for c in s["contributions"]:
            fid = c["feature_id"]
            resp_prov_by_fid.setdefault(fid, c["response_provenance"])
            if c["e_i"] != 0.0 or c["a_i"] != 0.0:
                present_fids.add(fid)

    eff_weight_by_fid = {e["feature_id"]: e["effective_weight"] for e in scored_leaves.values()}

    def _effective(fid):
        if fid in scored_fids:
            return "active" if fid in present_fids else "missing_neutral"
        return "context_only"

    report_ids = list(reg_by_id.keys())
    for fid in sorted(all_leaf_fids):  # added constructs (e.g. song_singability) not in registry
        if fid not in reg_by_id:
            report_ids.append(fid)

    feature_dispositions = []
    active_features, context_only_features, missing_features = [], [], []
    for fid in report_ids:
        reg = reg_by_id.get(fid)
        eff = _effective(fid)
        feature_dispositions.append({
            "feature_id": fid,
            "category": reg["category"] if reg else "Added construct",
            "feature_origin": reg["feature_origin"] if reg else "added_construct",
            "registry_disposition": reg["disposition"] if reg else "scored",
            "response_provenance": (
                resp_prov_by_fid.get(fid)
                or (reg.get("response_provenance") if reg else None)
                or "context_only"),
            "effective_disposition": eff,
            "effective_weight": eff_weight_by_fid.get(fid),
        })
        if eff == "active":
            active_features.append(fid)
        elif eff == "missing_neutral":
            missing_features.append(fid)
        else:
            context_only_features.append(fid)

    active_features = sorted(set(active_features))
    context_only_features = sorted(set(context_only_features))
    missing_features = sorted(set(missing_features))
    unused_available = context_only_features

    provenance = {
        "selected_service_id": service_id,
        "trigger_purpose": purpose,
        "lifecycle_stage": context.get("lifecycle_stage"),
        "plan_item_count": plan_count,
        "contract_version": context.get("contract_version"),
        "catalog_version": context.get("catalog_version"),
        "parameter_set_version": hp["parameter_set_version"],
        "formula_version": hp["formula_version"],
        "genre_affinity_v1_enabled": genre_on,
        "directional_hypothesis": hp["directional_hypothesis"],
        "active_features": active_features,
        "context_only_features": context_only_features,
        "missing_features": missing_features,
        "feature_dispositions": feature_dispositions,
        "normalized_effective_weights": {e["feature_id"]: e["effective_weight"] for e in scored_leaves.values()},
        "sort_rule": "item_fit desc, track_id asc",
        "duration_basis": duration_basis,
        "ordered_track_ids": [it["item_id"] for it in ordered_items],
    }

    return {
        "decision_type": "complete_plan",
        "selected_service_id": service_id,
        "requested_item_count": plan_count,
        "returned_item_count": len(ordered_items),
        "ordered_items": ordered_items,
        "mode": mode,
        "expected_duration_sec": expected_duration,
        "lighting_configuration": lighting,
        "approval_policy": "explicit_opt_in",
        "completion_rule": "plan_exhausted",
        "next_transition_policy": "await_user",
        "excluded_items": excluded_items,
        "unused_available_features": unused_available,
        "missing_features": missing_features,
        "algorithm_provenance": provenance,
    }
