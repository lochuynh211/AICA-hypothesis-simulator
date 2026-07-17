"""aica_transparent_service_selector_v1 - the REAL transparent service-fit
scorer (P5, `docs/master/aica_transparent_service_proposal_algorithm.md`).

Unit B (specs/016-proposal-p5-transparent-service-selector, T004-T005,
T010-T017) implements the numerically-critical scoring core: the 17-feature
evidence/response/weight pipeline (SS3-SS9 of the algorithm doc), reproducing
the SS10 worked example (`humming_karaoke == +0.772349`) exactly.

Scope note (Unit B, not later units): this module emits the MINIMUM SS14
explainability row (`feature_id`/`feature_value`/`response_coefficient`/
`weight`/`contribution`) plus the cheap-to-populate optional extension
fields that fall out of the same computation (raw_value, normalization
detail, provenance, hierarchy path, base/purpose/effective weight, status).
It deliberately does NOT compute `situation_fit`/`preference_fit`/
`history_fit` subtotals, `strongest_support`/`strongest_oppose`, or the
SS6.4 `dominance` readout -- those are Unit D's (US2 EvidenceBuilder)
responsibility (data-model.md SS2-SS3; see contracts/evaluate_contract.md).

Documented limitation (Unit A CRITICAL CONTEXT #3, preserved here): the
frozen purpose/stage matrix resolves `during_rest_stopped` to an EMPTY
candidate family (SS2.4 table) and its SS5.2.3 "during-rest actions" are not
`ServiceId` members at all -- so this package implements NO during-rest
response profiles. An eligible-candidate list under that stage is therefore
always empty in practice (no_proposal); a caller that erroneously supplies a
candidate for that stage hits `candidate_stage_family` validation below
(`_CatalogError`).

Contract:
  evaluate(context: dict) -> dict   # SelectorInput-shaped in,
                                     # ServiceSelectorOutput-shaped out

Purity: no file/network I/O, no clock, no randomness, no `aica_api` import.
Every `parameters`/`hyperparameters` value used by the scorer is read from
this package's own `package.json` via direct-index helpers (`_hp`/`_param`)
-- a missing key is a real configuration bug, surfaced as a raised
`_ConfigError` (dispatch_selector converts ANY raised exception into an
`AlgorithmEvidence.error`, category `algorithm_exception` -- never a
fabricated ranking; see `aica_api.services.proposal_selector`).
"""
from __future__ import annotations

import math

# ---------------------------------------------------------------------------
# Contract-order feature ids (SS5.3, the 17 CDC-SU baseline service features)
# ---------------------------------------------------------------------------

FEATURE_ORDER = [
    "drowsiness_level",
    "fatigue_level",
    "traffic_state",
    "road_type",
    "night_state",
    "monotony_level",
    "route_tags",
    "destination_tags",
    "child_present",
    "multiple_passengers",
    "oshi_registered",
    "oshi_mode",
    "service_recency_state",
    "service_usage_level",
    "scene_service_usage_level",
    "service_proposal_acceptance_rate",
    "service_recovery_rate",
]

# Features scored via the candidate-indexed direct-value maps (SS5.4):
# response coefficient is fixed +1.0 for every candidate; evidence comes
# from a per-candidate raw value inside feature_snapshot.
_DIRECT_FEATURES = frozenset(
    {
        "service_recency_state",
        "service_usage_level",
        "scene_service_usage_level",
        "service_proposal_acceptance_rate",
        "service_recovery_rate",
    }
)

_VALID_PURPOSES = frozenset(
    {
        "rest_recommended",
        "inattentive_driving_prevention_recovery",
        "route_music",
        "child_passenger_experience",
    }
)
_VALID_STAGES = frozenset(
    {
        "before_rest_until_stop",
        "during_rest_stopped",
        "after_rest_before_restart",
        "active_driving_content",
    }
)
_REST_STAGES = frozenset({"before_rest_until_stop", "during_rest_stopped", "after_rest_before_restart"})
_ACTIVE_DRIVING_PURPOSES = frozenset(
    {"inattentive_driving_prevention_recovery", "route_music", "child_passenger_experience"}
)

_FEATURE_LABELS = {
    "drowsiness_level": {"ja": "眠気", "en": "drowsiness"},
    "fatigue_level": {"ja": "疲労", "en": "fatigue"},
    "traffic_state": {"ja": "渋滞", "en": "traffic"},
    "road_type": {"ja": "道路種別", "en": "road type"},
    "night_state": {"ja": "夜間", "en": "night"},
    "monotony_level": {"ja": "単調性", "en": "monotony"},
    "route_tags": {"ja": "ルート特性", "en": "route characteristics"},
    "destination_tags": {"ja": "目的地特性", "en": "destination characteristics"},
    "child_present": {"ja": "子供同乗", "en": "child present"},
    "multiple_passengers": {"ja": "複数乗員", "en": "multiple passengers"},
    "oshi_registered": {"ja": "推し登録", "en": "oshi registered"},
    "oshi_mode": {"ja": "推しモード", "en": "oshi mode"},
    "service_recency_state": {"ja": "サービス未使用度", "en": "service recency"},
    "service_usage_level": {"ja": "サービス利用頻度", "en": "overall service usage"},
    "scene_service_usage_level": {"ja": "場面別サービス利用", "en": "scene-specific service usage"},
    "service_proposal_acceptance_rate": {"ja": "提案受諾率", "en": "proposal acceptance rate"},
    "service_recovery_rate": {"ja": "回復率", "en": "recovery rate"},
}


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class _RequestError(Exception):
    """Invalid opportunity/feature input (SS13 invalid_request)."""


class _CatalogError(Exception):
    """A candidate outside the frozen allowed/stage-family row (SS13 invalid_catalog)."""


class _ConfigError(Exception):
    """Invalid/missing parameters or hyperparameters (SS13 invalid_configuration)."""


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def _clamp(v: float, lo: float = -1.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, v))


def _norm0(v: float) -> float:
    """Normalize -0.0 to +0.0 for deterministic serialization (SS3.4)."""
    return v + 0.0 if v == 0 else v


def _scalarize(v):
    """Coerce a raw/feature value to the `str | float | int | None` shape the
    `FeatureContribution` contract requires (data-model.md SS1). Only
    `route_tags`/`destination_tags` (list[str]) and the derived scene-id list
    for `scene_service_usage_level` are ever non-scalar here; represent them
    as a comma-joined display string rather than widen the shared contract.
    """
    if v is None or isinstance(v, (str, float, int)):
        return v
    if isinstance(v, list):
        return ", ".join(str(item) for item in v)
    return str(v)


def _hp(hp: dict, key: str):
    """Direct-index hyperparameter read; a missing key is invalid_configuration."""
    if key not in hp:
        raise _ConfigError(f"missing hyperparameter '{key}'")
    return hp[key]


def _param(params: dict, key: str):
    """Direct-index parameter read; a missing key is invalid_configuration."""
    if key not in params:
        raise _ConfigError(f"missing parameter '{key}'")
    return params[key]


def _finite(v, label: str) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        raise _ConfigError(f"{label} is not numeric: {v!r}")
    if not math.isfinite(f):
        raise _ConfigError(f"{label} is not finite: {v!r}")
    return f


# ---------------------------------------------------------------------------
# WeightResolver (SS6): normalize siblings -> base = cat x subgroup x leaf ->
# apply purpose multipliers -> renormalize Sigma=1.
# ---------------------------------------------------------------------------


def _normalize_siblings(shares: dict, label: str) -> dict:
    for k, v in shares.items():
        fv = _finite(v, f"{label}[{k}]")
        if fv < 0:
            raise _ConfigError(f"{label}[{k}] is negative: {fv!r}")
    total = sum(float(v) for v in shares.values())
    if not math.isfinite(total) or total <= 0:
        raise _ConfigError(f"all-zero or non-finite sibling weight group: {label}")
    return {k: float(v) / total for k, v in shares.items()}


def resolve_weights(hp: dict, purpose: str) -> dict:
    """Return {feature_id: entry} with base_weight/purpose_multiplier/raw/
    effective_weight/category/subgroup/hierarchy_path, Sigma(effective_weight) == 1.
    """
    hierarchy = _hp(hp, "hierarchy_weights")
    multipliers = _hp(hp, "purpose_multipliers")

    if not hierarchy:
        raise _ConfigError("hierarchy_weights is empty")

    cat_shares = {cat: cat_def["share"] for cat, cat_def in hierarchy.items()}
    norm_cats = _normalize_siblings(cat_shares, "categories")

    entries: dict = {}
    raw_total = 0.0
    for cat, cat_def in hierarchy.items():
        subgroups = cat_def.get("subgroups") or {}
        sub_shares = {sg: sub["share"] for sg, sub in subgroups.items()}
        norm_subs = _normalize_siblings(sub_shares, f"{cat} subgroups")
        for sg, sub in subgroups.items():
            leaves = sub.get("leaves") or {}
            leaf_shares = {leaf: ld["share"] for leaf, ld in leaves.items()}
            norm_leaves = _normalize_siblings(leaf_shares, f"{cat}/{sg} leaves")
            sg_multipliers = multipliers.get(sg)
            if sg_multipliers is None:
                raise _ConfigError(f"purpose_multipliers missing subgroup '{sg}'")
            if purpose not in sg_multipliers:
                raise _ConfigError(f"purpose_multipliers['{sg}'] missing purpose '{purpose}'")
            pmult = _finite(sg_multipliers[purpose], f"purpose_multipliers['{sg}']['{purpose}']")
            if pmult < 0:
                raise _ConfigError(f"purpose_multipliers['{sg}']['{purpose}'] is negative: {pmult!r}")
            for leaf in leaves:
                base = norm_cats[cat] * norm_subs[sg] * norm_leaves[leaf]
                raw = base * pmult
                raw_total += raw
                entries[leaf] = {
                    "feature_id": leaf,
                    "category": cat,
                    "subgroup": sg,
                    "hierarchy_path": f"{cat}/{sg}/{leaf}",
                    "base_weight": base,
                    "purpose_multiplier": pmult,
                    "raw": raw,
                }

    if not math.isfinite(raw_total) or raw_total <= 0:
        raise _ConfigError("zero or non-finite active-weight denominator")

    for e in entries.values():
        e["effective_weight"] = e["raw"] / raw_total

    missing = [fid for fid in FEATURE_ORDER if fid not in entries]
    if missing:
        raise _ConfigError(f"hierarchy_weights is missing leaves for feature(s): {missing}")

    return entries


# ---------------------------------------------------------------------------
# SceneResolver (SS5.7): derive the current scene ids from situation, then
# average usage-normalized values over matching scene records.
# ---------------------------------------------------------------------------


def derive_scene_ids(situation: dict, hp: dict, params: dict) -> list:
    scenes: list = []
    if situation.get("traffic_state") == "congested":
        scenes.append("traffic:congested")
    road = situation.get("road_type")
    if road in ("highway", "local", "mountain", "parking"):
        scenes.append(f"road:{road}")
    if situation.get("night_state") == "night":
        scenes.append("time:night")
    monotony = situation.get("monotony_level")
    if isinstance(monotony, (int, float)):
        med_min = _finite(_hp(hp, "monotony_medium_min"), "monotony_medium_min")
        high_min = _finite(_hp(hp, "monotony_high_min"), "monotony_high_min")
        if monotony >= high_min:
            scenes.append("monotony:high")
        elif monotony >= med_min:
            scenes.append("monotony:medium")
    if situation.get("child_present"):
        scenes.append("passenger:child")
    if situation.get("multiple_passengers"):
        scenes.append("passenger:group")

    recognized_route = set(_param(params, "recognized_route_tags"))
    recognized_dest = set(_param(params, "recognized_destination_tags"))
    for t in situation.get("route_tags") or []:
        if t in recognized_route:
            scenes.append(f"route:{t}")
    for t in situation.get("destination_tags") or []:
        if t in recognized_dest:
            scenes.append(f"destination:{t}")

    seen: set = set()
    out = []
    for s in scenes:
        if s not in seen:
            seen.add(s)
            out.append(s)
    return out


def _scene_usage_evidence(candidate_id: str, scene_ids: list, scene_map: dict, usage_map: dict):
    vals = []
    for sid in scene_ids:
        rec = (scene_map or {}).get(sid) or {}
        if candidate_id in rec:
            level = rec[candidate_id]
            if level in usage_map:
                vals.append(usage_map[level])
    if not vals:
        return 0.0, "missing_neutral"
    return sum(vals) / len(vals), "used"


# ---------------------------------------------------------------------------
# FeatureNormalizer (SS5.3/SS5.7): (raw_value, e_i, normalization_function,
# status) per non-candidate-indexed feature. Candidate-indexed features are
# resolved per-candidate inside the scoring loop.
# ---------------------------------------------------------------------------


def _pow_evidence(x, gamma: float) -> float:
    return _clamp((float(x) / 100.0) ** gamma, 0.0, 1.0)


def resolve_scalar_evidence(feature_id: str, situation: dict, hp: dict, params: dict) -> dict:
    """Return {raw_value, e, normalization_function, status} for one of the
    10 Situation-group features + oshi_registered/oshi_mode (12 non-candidate
    -indexed features). Road type is handled separately (categorical, e=1,
    scored via road_response_profiles rather than a matrix column).
    """
    present = feature_id in situation
    raw = situation.get(feature_id) if present else None

    if feature_id in ("drowsiness_level", "fatigue_level", "monotony_level"):
        gamma_key = {"drowsiness_level": "gamma_drowsiness", "fatigue_level": "gamma_fatigue", "monotony_level": "gamma_monotony"}[feature_id]
        gamma = _finite(_hp(hp, gamma_key), gamma_key)
        if not present or raw is None:
            return {"raw_value": None, "e": 0.0, "normalization_function": "(x/100)^gamma", "status": "missing"}
        if not isinstance(raw, (int, float)) or isinstance(raw, bool) or not (0 <= raw <= 100):
            raise _RequestError(f"{feature_id} must be numeric in [0,100], got {raw!r}")
        return {"raw_value": raw, "e": _pow_evidence(raw, gamma), "normalization_function": "(x/100)^gamma", "status": "used"}

    if feature_id == "traffic_state":
        if not present or raw is None:
            return {"raw_value": None, "e": 0.0, "normalization_function": "categorical(congested=1,normal=0)", "status": "missing"}
        if raw not in ("normal", "congested"):
            raise _RequestError(f"traffic_state must be 'normal' or 'congested', got {raw!r}")
        return {"raw_value": raw, "e": 1.0 if raw == "congested" else 0.0, "normalization_function": "categorical(congested=1,normal=0)", "status": "used"}

    if feature_id == "night_state":
        if not present or raw is None:
            return {"raw_value": None, "e": 0.0, "normalization_function": "categorical(night=1,day=0)", "status": "missing"}
        if raw not in ("day", "night"):
            raise _RequestError(f"night_state must be 'day' or 'night', got {raw!r}")
        return {"raw_value": raw, "e": 1.0 if raw == "night" else 0.0, "normalization_function": "categorical(night=1,day=0)", "status": "used"}

    if feature_id in ("route_tags", "destination_tags"):
        sat_key = "route_tag_saturation" if feature_id == "route_tags" else "destination_tag_saturation"
        recog_key = "recognized_route_tags" if feature_id == "route_tags" else "recognized_destination_tags"
        saturation = _finite(_hp(hp, sat_key), sat_key)
        recognized_vocab = set(_param(params, recog_key))
        tags = raw if present and isinstance(raw, list) else []
        recognized = sorted({t for t in tags if t in recognized_vocab})
        unknown = sorted({t for t in tags if t not in recognized_vocab})
        e = min(1.0, len(recognized) / saturation) if saturation > 0 else 0.0
        status = "used" if present else "missing"
        return {
            "raw_value": tags if present else None,
            "e": e,
            "normalization_function": "min(1, recognized_unique_tags/saturation)",
            "status": status,
            "unknown_tags": unknown,
        }

    if feature_id in ("child_present", "multiple_passengers"):
        if not present or raw is None:
            return {"raw_value": None, "e": 0.0, "normalization_function": "bool(true=1,false=0)", "status": "missing"}
        if not isinstance(raw, bool):
            raise _RequestError(f"{feature_id} must be boolean, got {raw!r}")
        return {"raw_value": raw, "e": 1.0 if raw else 0.0, "normalization_function": "bool(true=1,false=0)", "status": "used"}

    if feature_id == "oshi_registered":
        if not present or raw is None:
            return {"raw_value": None, "e": 0.0, "normalization_function": "bool(true=1,false=0)", "status": "missing"}
        if not isinstance(raw, bool):
            raise _RequestError(f"oshi_registered must be boolean, got {raw!r}")
        return {"raw_value": raw, "e": 1.0 if raw else 0.0, "normalization_function": "bool(true=1,false=0)", "status": "used"}

    if feature_id == "oshi_mode":
        if not present or raw is None:
            return {"raw_value": None, "e": 0.0, "normalization_function": "signed(on=+1,off=-1)", "status": "missing"}
        if raw not in ("on", "off"):
            raise _RequestError(f"oshi_mode must be 'on' or 'off', got {raw!r}")
        return {"raw_value": raw, "e": 1.0 if raw == "on" else -1.0, "normalization_function": "signed(on=+1,off=-1)", "status": "used"}

    raise _ConfigError(f"resolve_scalar_evidence: unknown feature_id '{feature_id}'")


def resolve_road_evidence(situation: dict) -> dict:
    present = "road_type" in situation
    raw = situation.get("road_type")
    if not present or raw is None:
        return {"raw_value": None, "e": 0.0, "normalization_function": "categorical(e=1)", "status": "missing"}
    if raw not in ("highway", "local", "mountain", "parking"):
        raise _RequestError(f"road_type must be one of highway/local/mountain/parking, got {raw!r}")
    return {"raw_value": raw, "e": 1.0, "normalization_function": "categorical(e=1)", "status": "used"}


def resolve_direct_evidence(feature_id: str, candidate_id: str, snapshot: dict, hp: dict, situation: dict, params: dict) -> dict:
    """Evidence for the 5 candidate-indexed direct features (SS5.4)."""
    preference = snapshot.get("preference") or {}
    history = snapshot.get("history") or {}

    if feature_id == "service_recency_state":
        recency_map = _param(params, "recency_ordinal_map")
        table = preference.get("service_recency_state") or {}
        if candidate_id not in table:
            return {"raw_value": None, "e": 0.0, "normalization_function": "recency_ordinal_map", "status": "missing_neutral"}
        level = table[candidate_id]
        if level not in recency_map:
            raise _RequestError(f"service_recency_state[{candidate_id}] has unknown level {level!r}")
        return {"raw_value": level, "e": recency_map[level], "normalization_function": "recency_ordinal_map", "status": "used"}

    if feature_id == "service_usage_level":
        usage_map = _param(params, "usage_ordinal_map")
        table = preference.get("service_usage_level") or {}
        if candidate_id not in table:
            return {"raw_value": None, "e": 0.0, "normalization_function": "usage_ordinal_map", "status": "missing_neutral"}
        level = table[candidate_id]
        if level not in usage_map:
            raise _RequestError(f"service_usage_level[{candidate_id}] has unknown level {level!r}")
        return {"raw_value": level, "e": usage_map[level], "normalization_function": "usage_ordinal_map", "status": "used"}

    if feature_id == "scene_service_usage_level":
        usage_map = _param(params, "usage_ordinal_map")
        scene_map = preference.get("scene_service_usage_level") or {}
        scene_ids = derive_scene_ids(situation, hp, params)
        e, status = _scene_usage_evidence(candidate_id, scene_ids, scene_map, usage_map)
        return {"raw_value": scene_ids, "e": e, "normalization_function": "mean(usage_ordinal_map over current scene ids)", "status": status}

    if feature_id == "service_proposal_acceptance_rate":
        table = history.get("service_proposal_acceptance_rate") or {}
        if candidate_id not in table:
            return {"raw_value": None, "e": 0.0, "normalization_function": "2*rate/100-1", "status": "missing_neutral"}
        rate = table[candidate_id]
        if not isinstance(rate, (int, float)) or isinstance(rate, bool) or not (0 <= rate <= 100):
            raise _RequestError(f"service_proposal_acceptance_rate[{candidate_id}] must be numeric in [0,100], got {rate!r}")
        return {"raw_value": rate, "e": 2.0 * rate / 100.0 - 1.0, "normalization_function": "2*rate/100-1", "status": "used"}

    if feature_id == "service_recovery_rate":
        table = history.get("service_recovery_rate") or {}
        if candidate_id not in table:
            return {"raw_value": None, "e": 0.0, "normalization_function": "2*rate/100-1", "status": "missing_neutral"}
        rate = table[candidate_id]
        if not isinstance(rate, (int, float)) or isinstance(rate, bool) or not (0 <= rate <= 100):
            raise _RequestError(f"service_recovery_rate[{candidate_id}] must be numeric in [0,100], got {rate!r}")
        return {"raw_value": rate, "e": 2.0 * rate / 100.0 - 1.0, "normalization_function": "2*rate/100-1", "status": "used"}

    raise _ConfigError(f"resolve_direct_evidence: unknown feature_id '{feature_id}'")


# ---------------------------------------------------------------------------
# ResponseResolver (SS5.2): candidate + road profiles from `parameters`.
# ---------------------------------------------------------------------------


def resolve_response(candidate_id: str, feature_id: str, road_type, params: dict) -> dict:
    if feature_id == "road_type":
        table = _param(params, "road_response_profiles")
        cand_table = table.get(candidate_id)
        if cand_table is None:
            raise _ConfigError(f"road_response_profiles missing candidate '{candidate_id}'")
        if road_type is None:
            return {"coefficient": 0.0, "provenance": None, "source_reference": None}
        cell = cand_table.get(road_type)
        if cell is None:
            raise _ConfigError(f"road_response_profiles['{candidate_id}'] missing road type '{road_type}'")
        return cell

    table = _param(params, "service_response_profiles")
    cand_table = table.get(candidate_id)
    if cand_table is None:
        raise _ConfigError(f"service_response_profiles missing candidate '{candidate_id}'")
    cell = cand_table.get(feature_id)
    if cell is None:
        raise _ConfigError(f"service_response_profiles['{candidate_id}'] missing feature '{feature_id}'")
    return cell


def _validate_response_cell(candidate_id: str, feature_id: str, cell: dict) -> float:
    coef = cell.get("coefficient")
    fcoef = _finite(coef, f"response coefficient for {candidate_id}/{feature_id}")
    if not (-1.0 <= fcoef <= 1.0):
        raise _ConfigError(f"response coefficient for {candidate_id}/{feature_id} out of [-1,1]: {fcoef!r}")
    return fcoef


# ---------------------------------------------------------------------------
# InputValidator (SS9 step 1) helpers
# ---------------------------------------------------------------------------


def _validate_purpose_stage(purpose, stage) -> None:
    if purpose not in _VALID_PURPOSES:
        raise _RequestError(f"invalid trigger_purpose: {purpose!r}")
    if stage not in _VALID_STAGES:
        raise _RequestError(f"invalid lifecycle_stage: {stage!r}")
    if stage in _REST_STAGES and purpose != "rest_recommended":
        raise _RequestError(f"lifecycle_stage '{stage}' is only compatible with trigger_purpose 'rest_recommended', got '{purpose}'")
    if stage == "active_driving_content" and purpose not in _ACTIVE_DRIVING_PURPOSES:
        raise _RequestError(f"lifecycle_stage 'active_driving_content' is not compatible with trigger_purpose '{purpose}'")


def _validate_oshi_consistency(situation: dict) -> None:
    if situation.get("oshi_registered") is False and situation.get("oshi_mode") == "on":
        raise _RequestError("oshi_registered=false and oshi_mode='on' is invalid input")


# ---------------------------------------------------------------------------
# Rationale (bilingual, top contributions)
# ---------------------------------------------------------------------------


def _build_rationale(contributions: list) -> list:
    ranked = sorted(contributions, key=lambda c: c["contribution"], reverse=True)
    pos = [c for c in ranked if c["contribution"] > 1e-9][:2]
    neg = [c for c in ranked if c["contribution"] < -1e-9][-2:]
    lines_ja, lines_en = [], []
    for c in pos:
        lab = _FEATURE_LABELS.get(c["feature_id"], {"ja": c["feature_id"], "en": c["feature_id"]})
        lines_ja.append(f"{lab['ja']}が支持（+{c['contribution']:.4f}）")
        lines_en.append(f"{lab['en']} supports this pick (+{c['contribution']:.4f})")
    for c in neg:
        lab = _FEATURE_LABELS.get(c["feature_id"], {"ja": c["feature_id"], "en": c["feature_id"]})
        lines_ja.append(f"{lab['ja']}が抑制（{c['contribution']:.4f}）")
        lines_en.append(f"{lab['en']} weighs against it ({c['contribution']:.4f})")
    if not lines_ja:
        return ["中立的なスコアです。", "Neutral score."]
    return ["、".join(lines_ja) + "。", "; ".join(lines_en) + "."]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def evaluate(context: dict) -> dict:
    hp = context["hyperparameters"]
    params = context.get("parameters") or {}
    purpose = context.get("trigger_purpose")
    stage = context.get("lifecycle_stage")

    _validate_purpose_stage(purpose, stage)

    snapshot = context.get("feature_snapshot") or {}
    situation = snapshot.get("situation") or {}
    preference = snapshot.get("preference") or {}
    _validate_oshi_consistency(preference)

    allowed = set(context.get("allowed_service_ids") or [])
    eligible_ids = [c["candidate_id"] for c in (context.get("eligible_candidates") or [])]

    stage_family_cfg = _param(params, "candidate_stage_family")
    stage_family = set(stage_family_cfg.get(stage, []))

    for cid in eligible_ids:
        if cid not in allowed:
            raise _CatalogError(f"eligible candidate '{cid}' is not in allowed_service_ids")
        if cid not in stage_family:
            raise _CatalogError(f"candidate '{cid}' is not a supported service for lifecycle_stage '{stage}'")

    excluded_candidates = list(context.get("excluded_candidates") or [])

    # Resolve effective weights once (SS9 step 3).
    weights = resolve_weights(hp, purpose)

    # Response-profile completeness sweep (SS9 step 1) for every eligible candidate.
    for cid in eligible_ids:
        for fid in FEATURE_ORDER:
            if fid == "road_type":
                cell = resolve_response(cid, fid, "highway", params)
            else:
                cell = resolve_response(cid, fid, None, params)
            _validate_response_cell(cid, fid, cell)

    # Pre-compute the non-candidate-indexed evidence once (SS9 step 4).
    scalar_evidence = {}
    unknown_tags: set = set()
    for fid in FEATURE_ORDER:
        if fid in _DIRECT_FEATURES:
            continue
        if fid == "road_type":
            scalar_evidence[fid] = resolve_road_evidence(situation)
        elif fid in ("oshi_registered", "oshi_mode"):
            scalar_evidence[fid] = resolve_scalar_evidence(fid, preference, hp, params)
        else:
            scalar_evidence[fid] = resolve_scalar_evidence(fid, situation, hp, params)
            for t in scalar_evidence[fid].get("unknown_tags", []) or []:
                unknown_tags.add(t)

    missing_features: set = set()
    for fid, info in scalar_evidence.items():
        if info["status"] in ("missing", "missing_neutral"):
            missing_features.add(fid)

    if not eligible_ids:
        return {
            "decision_type": "no_proposal",
            "ranked_candidates": [],
            "excluded_candidates": excluded_candidates,
            "unused_available_features": sorted(
                unknown_tags | {"service_proposal_acceptance_confidence", "service_recovery_confidence"}
            ),
            "missing_features": sorted(missing_features),
            "next_package_runtime_state": {},
            "algorithm_provenance": {
                "package_id": "aica_transparent_service_selector_v1",
                "contract_version": context.get("contract_version"),
                "schema_version": context.get("schema_version"),
                "purpose": purpose,
                "lifecycle_stage": stage,
                "extensions_on": [],
                "reason": "empty_eligible_candidate_set",
            },
        }

    road_type = situation.get("road_type")
    scored = []
    for cid in eligible_ids:
        contributions = []
        unclamped_sum = 0.0
        for fid in FEATURE_ORDER:
            w_entry = weights[fid]
            w = w_entry["effective_weight"]

            if fid in _DIRECT_FEATURES:
                ev = resolve_direct_evidence(fid, cid, snapshot, hp, situation, params)
                if ev["status"] == "missing_neutral":
                    missing_features.add(fid)
                resp = {"coefficient": 1.0, "provenance": "cdc_su_direct_candidate_feature", "source_reference": "Slides 66-67 (direct candidate feature)"}
            elif fid == "road_type":
                ev = scalar_evidence[fid]
                resp = resolve_response(cid, fid, road_type, params)
            else:
                ev = scalar_evidence[fid]
                resp = resolve_response(cid, fid, None, params)

            e_i = ev["e"]
            a_i = _validate_response_cell(cid, fid, resp)
            r_i = _clamp(e_i * a_i)
            k_i = w * r_i
            unclamped_sum += k_i

            status = ev["status"]
            if status == "missing_neutral":
                status = "missing"
            elif status == "used" and w <= 0.0:
                status = "zero_weight"

            contributions.append({
                "feature_id": fid,
                "feature_value": _scalarize(ev["raw_value"]) if ev["raw_value"] is not None else "",
                "response_coefficient": a_i,
                "weight": w,
                "contribution": _norm0(k_i),
                "source_reference": resp.get("source_reference"),
                "raw_value": _scalarize(ev["raw_value"]),
                "normalization_function": ev["normalization_function"],
                "normalized_evidence": _norm0(e_i),
                "response_provenance": resp.get("provenance"),
                "normalized_feature_response": _norm0(r_i),
                "hierarchy_path": w_entry["hierarchy_path"],
                "base_weight": w_entry["base_weight"],
                "purpose_multiplier": w_entry["purpose_multiplier"],
                "effective_weight": w,
                "status": status,
            })

        score = _norm0(_clamp(unclamped_sum, -1.0, 1.0))
        supporting = [c["feature_id"] for c in contributions if c["contribution"] > 1e-9]
        opposing = [c["feature_id"] for c in contributions if c["contribution"] < -1e-9]
        scored.append({
            "candidate_id": cid,
            "score": score,
            "contributions": contributions,
            "supporting": supporting,
            "opposing": opposing,
        })

    # Rank: (service_fit desc, candidate_id asc); take top_k (SS9 step 7).
    scored.sort(key=lambda s: (-s["score"], s["candidate_id"]))
    top_k = int(_param(params, "top_k"))
    chosen = scored[:top_k]

    ranked_candidates = []
    for rank, s in enumerate(chosen, start=1):
        ranked_candidates.append({
            "rank": rank,
            "candidate_id": s["candidate_id"],
            "score": s["score"],
            "rationale": _build_rationale(s["contributions"]),
            "supporting_feature_ids": s["supporting"],
            "opposing_feature_ids": s["opposing"],
            "uncertainty": None,
            "feature_contributions": s["contributions"],
        })

    return {
        "decision_type": "ranked_candidates",
        "ranked_candidates": ranked_candidates,
        "excluded_candidates": excluded_candidates,
        "unused_available_features": sorted(
            unknown_tags | {"service_proposal_acceptance_confidence", "service_recovery_confidence"}
        ),
        "missing_features": sorted(missing_features),
        "next_package_runtime_state": {},
        "algorithm_provenance": {
            "package_id": "aica_transparent_service_selector_v1",
            "contract_version": context.get("contract_version"),
            "schema_version": context.get("schema_version"),
            "purpose": purpose,
            "lifecycle_stage": stage,
            "extensions_on": [],
        },
    }
