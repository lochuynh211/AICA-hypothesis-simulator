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
def test_monotony_entries_do_not_claim_meaningful_drowsiness_recovery(path):
    """Design §6 case 1 — the @monotony effect is growth SUPPRESSION, not
    subtraction. UC-1's driver is not sleepy; content must not claim to fix
    sleep debt on that channel."""
    scenario = json.loads(path.read_text(encoding="utf-8"))
    recovery_model = (scenario.get("driver_signal_params") or {}).get("recovery_model", {})
    for key, entry in recovery_model.items():
        if key.endswith("@monotony"):
            assert entry.get("drowsiness_per_min", 0.0) <= 0.1, key


@pytest.mark.parametrize("path", SCENARIOS, ids=lambda p: p.name)
def test_pre_rest_entries_are_capped_so_content_cannot_replace_a_rest(path):
    scenario = json.loads(path.read_text(encoding="utf-8"))
    recovery_model = (scenario.get("driver_signal_params") or {}).get("recovery_model", {})
    for key, entry in recovery_model.items():
        if key.endswith("@pre_rest") and entry.get("drowsiness_per_min", 0.0) > 0.0:
            assert entry.get("cap_drowsiness") is not None, key
