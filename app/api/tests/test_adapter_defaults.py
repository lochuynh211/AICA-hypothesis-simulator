"""Tests for manifest-single-source hyperparameter/parameter resolution (feature 009, Unit D/C3).

Contract: `specs/009-signal-tier-redesign/contracts/tiered-context.md` —
"`hyperparameters` is fully resolved by the adapter from the manifest defaults + overrides;
algorithms MUST NOT apply their own hardcoded fallback defaults (FR-009)."

Covers:
  1. `resolve_manifest_defaults` (the per-key merge helper used by `run_manager.tick()`):
     no overrides -> pure manifest defaults; overrides win per key; extra manifest keys
     the override dict doesn't mention are still present (the `or`-shortcut regression
     this guards against).
  2. The real `aica_transparent_hybrid_trigger_v1` package manifest resolves to a complete
     hyperparameter dict, and its `algorithm.py` (which indexes `hp[key]` directly, no
     `.get(key, default)` fallback per FR-009) evaluates without KeyError on that resolved
     dict — proving the manifest is genuinely the single source of truth end to end.
"""

from __future__ import annotations

import importlib.util
import pathlib

import pytest

from aica_api.config import settings
from aica_api.models.package import HyperparameterDef
from aica_api.services.package_registry import PackageRegistry
from aica_api.services.run_manager import resolve_manifest_defaults

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
_HYBRID_PKG_DIR = _REPO_ROOT / "packages" / "aica_transparent_hybrid_trigger_v1"


# ---------------------------------------------------------------------------
# 1. resolve_manifest_defaults — the per-key merge primitive
# ---------------------------------------------------------------------------


def test_no_overrides_resolves_to_pure_manifest_defaults():
    defaults = {"w_drowsiness": 0.40, "w_fatigue": 0.25, "K": 5}
    resolved = resolve_manifest_defaults(defaults, {})
    assert resolved == defaults
    # Also covers the falsy-but-not-None case (None overrides, as current_hyperparameters
    # may legitimately start out).
    assert resolve_manifest_defaults(defaults, None) == defaults


def test_overrides_win_per_key_others_stay_default():
    defaults = {"w_drowsiness": 0.40, "w_fatigue": 0.25, "K": 5, "smoothing_alpha": 0.35}
    overrides = {"w_drowsiness": 0.55}
    resolved = resolve_manifest_defaults(defaults, overrides)
    assert resolved["w_drowsiness"] == 0.55  # overridden
    assert resolved["w_fatigue"] == 0.25  # untouched -> manifest default
    assert resolved["K"] == 5  # untouched -> manifest default
    assert resolved["smoothing_alpha"] == 0.35  # untouched -> manifest default
    assert set(resolved) == set(defaults)  # every declared key present, nothing dropped


def test_partial_overrides_do_not_shadow_the_whole_defaults_dict():
    """Regression guard: `current_hyperparameters or {defaults}` would swap in the
    override dict WHOLESALE the moment it's non-empty, silently dropping any manifest
    key the override dict doesn't mention. A single-key override must not erase the
    rest of the manifest's declared keys."""
    defaults = {"a": 1, "b": 2, "c": 3}
    overrides = {"a": 999}  # does not mention b or c
    resolved = resolve_manifest_defaults(defaults, overrides)
    assert resolved == {"a": 999, "b": 2, "c": 3}


def test_empty_dict_overrides_is_falsy_but_still_per_key_merged():
    """An empty (but non-None) overrides dict must resolve to pure defaults — not
    accidentally treated as "no defaults" by an `or`-based implementation."""
    defaults = {"a": 1, "b": 2}
    resolved = resolve_manifest_defaults(defaults, {})
    assert resolved == defaults


# ---------------------------------------------------------------------------
# 2. Real package manifest -> fully resolved -> algorithm reads it with no KeyError
# ---------------------------------------------------------------------------


def _load_hybrid_algorithm_module():
    spec = importlib.util.spec_from_file_location(
        "hybrid_alg_adapter_defaults_test", _HYBRID_PKG_DIR / "algorithm.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


def test_hybrid_manifest_hyperparameters_declare_every_key_the_algorithm_reads():
    """No un-defaulted key: every hyperparameter the Hybrid algorithm indexes via
    hp[key] must have a manifest-declared default (FR-009 guard)."""
    registry = PackageRegistry(settings.packages_dir)
    pkg = registry.get("aica_transparent_hybrid_trigger_v1")
    assert pkg is not None

    declared_keys = {hp.key for hp in pkg.hyperparameters}
    expected_keys = {
        "smoothing_alpha", "w_drowsiness", "w_fatigue", "w_driving_anomaly", "w_env", "K",
        "minimum_risk_for_rest_bonus", "w_rest_window", "w_rest_scarcity",
        "w_monotony", "w_env_mono", "w_familiar",
        "rest_watch_threshold", "threshold_suggest", "threshold_recommend", "threshold_urgent",
        "monotony_watch_threshold", "monotony_suggest_threshold",
        "monotony_recommend_threshold", "monotony_urgent_threshold",
        "rest_persistence_ticks", "monotony_persistence_ticks",
        "skip_if_score", "skip_if_velocity", "emergency_override_threshold",
        "rest_cooldown_sec", "monotony_cooldown_sec", "max_proposals_per_30min",
    }
    assert expected_keys <= declared_keys

    # Obsolete pre-009 per-feature weights must be gone (no longer read, no longer declared).
    obsolete_keys = {"w_future_fatigue", "w_familiar_route", "w_attention_drop", "w_traffic_jam", "w_long_highway"}
    assert declared_keys.isdisjoint(obsolete_keys)


def test_hybrid_evaluate_runs_with_no_overrides_no_keyerror():
    """context["hyperparameters"] = manifest defaults ⊕ {} (no overrides) -> the
    algorithm's direct hp[key] indexing never raises KeyError."""
    registry = PackageRegistry(settings.packages_dir)
    pkg = registry.get("aica_transparent_hybrid_trigger_v1")
    assert pkg is not None

    defaults = {hp.key: hp.default for hp in pkg.hyperparameters}
    resolved = resolve_manifest_defaults(defaults, {})

    mod = _load_hybrid_algorithm_module()
    context = {
        "simulation_time_sec": 0.0,
        "signals": {
            "fixed": {"isNight": False, "familiarRoute": False, "childPassenger": False, "weatherRiskLevel": 0.0},
            "dynamic": {
                "segmentType": "normal_road", "motionState": "MOVING",
                "continuousDrivingMin": 0.0, "speedKph": 80.0, "routeFraction": 0.0,
                "nextRestSpotMin": 30.0, "isTrafficJam": False, "recoveryPhase": None,
            },
            "simulated": {"drowsiness": 20.0, "fatigue": 15.0, "anomaly_rate": 0.0},
        },
        "feature_groups": {"normalized": {}, "ordinal": {}},
        "hyperparameters": resolved,
        "parameters": {},
        "proposal_history": {
            "lastProposalTimeSec": None, "lastProposalCategory": None,
            "lastProposalResult": None, "proposalCountLast30Min": 0,
            "acceptanceRateRecent": 0.0,
        },
        "user_action_history": [],
        "package_runtime_state": {},
        "recovery_active": False,
    }

    result = mod.evaluate(context)  # must not raise KeyError
    assert result["result_type"] in ("NO_PROPOSAL", "SUPPRESSED", "REST_PROPOSAL", "MONOTONY_PROPOSAL")


def test_hybrid_evaluate_runs_with_partial_override_others_still_default():
    """A user overriding a SINGLE hyperparameter must not strip the rest of the
    manifest defaults out from under the algorithm (the exact `or`-shortcut bug
    this unit fixes in run_manager.tick())."""
    registry = PackageRegistry(settings.packages_dir)
    pkg = registry.get("aica_transparent_hybrid_trigger_v1")
    assert pkg is not None

    defaults = {hp.key: hp.default for hp in pkg.hyperparameters}
    single_override = {"w_drowsiness": defaults["w_drowsiness"] + 0.05}
    resolved = resolve_manifest_defaults(defaults, single_override)

    # Every manifest key still present; only the overridden one changed.
    assert set(resolved) == set(defaults)
    assert resolved["w_drowsiness"] == defaults["w_drowsiness"] + 0.05
    for key, value in defaults.items():
        if key != "w_drowsiness":
            assert resolved[key] == value

    mod = _load_hybrid_algorithm_module()
    context = {
        "simulation_time_sec": 0.0,
        "signals": {
            "fixed": {"isNight": True, "familiarRoute": True, "childPassenger": False, "weatherRiskLevel": 10.0},
            "dynamic": {
                "segmentType": "highway", "motionState": "MOVING",
                "continuousDrivingMin": 45.0, "speedKph": 100.0, "routeFraction": 0.3,
                "nextRestSpotMin": 8.0, "isTrafficJam": True, "recoveryPhase": None,
            },
            "simulated": {"drowsiness": 75.0, "fatigue": 60.0, "anomaly_rate": 3.0},
        },
        "feature_groups": {"normalized": {}, "ordinal": {}},
        "hyperparameters": resolved,
        "parameters": {},
        "proposal_history": {
            "lastProposalTimeSec": None, "lastProposalCategory": None,
            "lastProposalResult": None, "proposalCountLast30Min": 0,
            "acceptanceRateRecent": 0.0,
        },
        "user_action_history": [],
        "package_runtime_state": {},
        "recovery_active": False,
    }

    result = mod.evaluate(context)  # must not raise KeyError despite the partial override
    assert result["result_type"] in ("NO_PROPOSAL", "SUPPRESSED", "REST_PROPOSAL", "MONOTONY_PROPOSAL")


# ---------------------------------------------------------------------------
# 3. FR-009 guard: an algorithm reading a key with no manifest default fails loudly
# ---------------------------------------------------------------------------


def test_algorithm_reading_undeclared_key_raises_keyerror():
    """A package manifest that DOESN'T declare a hyperparameter the algorithm reads
    must not silently default it — resolve_manifest_defaults only ever knows about
    declared keys, so the algorithm's direct hp[key] indexing raises KeyError."""
    partial_defaults = {
        hp.key: hp.default
        for hp in [
            HyperparameterDef(key="smoothing_alpha", label={"ja": "", "en": ""}, kind="numeric", default=0.35),
            # Intentionally omit every other Hybrid hyperparameter.
        ]
    }
    resolved = resolve_manifest_defaults(partial_defaults, {})
    assert resolved == {"smoothing_alpha": 0.35}

    mod = _load_hybrid_algorithm_module()
    context = {
        "simulation_time_sec": 0.0,
        "signals": {
            "fixed": {"isNight": False, "familiarRoute": False, "childPassenger": False, "weatherRiskLevel": 0.0},
            "dynamic": {
                "segmentType": "normal_road", "motionState": "MOVING",
                "nextRestSpotMin": 30.0, "isTrafficJam": False, "recoveryPhase": None,
            },
            "simulated": {"drowsiness": 20.0, "fatigue": 15.0, "anomaly_rate": 0.0},
        },
        "feature_groups": {"normalized": {}, "ordinal": {}},
        "hyperparameters": resolved,
        "parameters": {},
        "proposal_history": {
            "lastProposalTimeSec": None, "lastProposalCategory": None,
            "lastProposalResult": None, "proposalCountLast30Min": 0,
            "acceptanceRateRecent": 0.0,
        },
        "user_action_history": [],
        "package_runtime_state": {},
        "recovery_active": False,
    }

    with pytest.raises(KeyError):
        mod.evaluate(context)
