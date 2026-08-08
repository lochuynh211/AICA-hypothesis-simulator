"""Every REACHABLE (service, purpose) pair must have a recovery_model entry.

Recovery design §5. The matrix is deliberately sparse — 停車中コンテンツ at the
rest spot gets no driving-content relief at all (slide 38: ご褒美, not a
countermeasure) — so this test derives reachability from the eligibility
capabilities rather than asserting a full product.
"""
import json
import pathlib

import pytest

from aica_api.config import settings
from aica_api.models.proposal.service_capabilities import ServiceCapabilities

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
SCENARIOS = sorted((_REPO_ROOT / "scenarios").glob("*.json"))

_CAPABILITIES_PATH = (
    settings.proposal_contracts_dir / "service_capabilities" / "service_capabilities.v1.json"
)
_PURPOSES = ("monotony", "pre_rest", "post_rest")


def _reachable_pairs() -> set[tuple[str, str]]:
    """Services that can be playing while the car is MOVING, x every purpose.

    Driving-content relief is MOVING-only (design §4), so a service that can
    never play while moving needs no entry at all. `driving_capable` covers
    audio content; `background_on_motion` covers screen content that keeps
    playing in the background once the car starts (CDC-SU slide 81
    走行開始時の挙動).

    Deliberately a SUPERSET of what the response matrix actually offers per
    lifecycle stage — authoring a few unused entries is cheap, and it
    guarantees no reachable pair can be silently missing.
    """
    caps = ServiceCapabilities.load(_CAPABILITIES_PATH)
    return {
        (service_id.value, purpose)
        for service_id, cap in caps.services.items()
        if cap.driving_capable or cap.background_on_motion
        for purpose in _PURPOSES
    }


@pytest.mark.parametrize("path", SCENARIOS, ids=lambda p: p.name)
def test_every_reachable_pair_has_a_recovery_entry(path):
    scenario = json.loads(path.read_text(encoding="utf-8"))
    recovery_model = (scenario.get("driver_signal_params") or {}).get("recovery_model", {})
    missing = [
        f"{service}@{purpose}"
        for service, purpose in sorted(_reachable_pairs())
        if f"{service}@{purpose}" not in recovery_model
    ]
    assert not missing, f"{path.name} is missing recovery entries: {missing}"


@pytest.mark.parametrize("path", SCENARIOS, ids=lambda p: p.name)
def test_monotony_entries_produce_a_real_dip_but_never_rival_a_rest(path):
    """Owner requirement (2026-08-08): accepting the inattentive proposal must
    produce a SHORT, VISIBLE decrease in drowsiness/fatigue — "15 minutes of
    humming karaoke helps a bit" — not merely a slower climb.

    This REVERSES the original design's `@monotony` rule (drowsiness_per_min ~= 0,
    growth-suppression only). The rate must now exceed the driver model's own
    growth so the net per-tick change goes negative; the cap is what keeps one
    episode far below a nap, so content still cannot stand in for a rest.
    """
    scenario = json.loads(path.read_text(encoding="utf-8"))
    dsp = scenario.get("driver_signal_params") or {}
    recovery_model = dsp.get("recovery_model", {})
    # Growth the relief has to beat: base + night, with the monotony term already
    # suppressed by the content itself.
    dm = dsp.get("drowsiness_model", {})
    growth_per_min = dm.get("base_growth_per_min", 0.0) + dm.get("night_add_per_min", 0.0)
    nap = recovery_model.get("sleep", {})
    nap_total = nap.get("drowsiness", 0.0)
    for key, entry in recovery_model.items():
        if not key.endswith("@monotony"):
            continue
        rate = entry.get("drowsiness_per_min", 0.0)
        assert rate > growth_per_min, (
            f"{key}: {rate}/min cannot outpace {growth_per_min}/min of growth, so "
            "accepting the proposal would only slow the climb, never dip"
        )
        cap = entry.get("cap_drowsiness")
        assert cap is not None, f"{key}: an uncapped dip could substitute for a rest"
        assert cap < nap_total, (
            f"{key}: cap {cap} is not clearly below a nap's {nap_total} — content "
            "must never rival an actual rest"
        )


@pytest.mark.parametrize("path", SCENARIOS, ids=lambda p: p.name)
def test_pre_rest_entries_are_capped_so_content_cannot_replace_a_rest(path):
    scenario = json.loads(path.read_text(encoding="utf-8"))
    recovery_model = (scenario.get("driver_signal_params") or {}).get("recovery_model", {})
    for key, entry in recovery_model.items():
        if key.endswith("@pre_rest") and entry.get("drowsiness_per_min", 0.0) > 0.0:
            assert entry.get("cap_drowsiness") is not None, key
