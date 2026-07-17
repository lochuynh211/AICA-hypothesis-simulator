"""TDD: P5 Unit A T009 — verify `_build_service_context`
(`app/api/aica_api/routers/proposal.py`) actually delivers every A.1 field
the real transparent service selector will score.

Drives a typed-World run through `POST /api/proposal/runs` (mirrors
`test_ep_create_run.py`'s `_typed_world_body()` pattern) using the committed
`seed-night-highway-oshi` seed, then inspects the persisted STEP-1
`AlgorithmEvidence.input_snapshot["feature_snapshot"]` — the exact dict
`_build_service_context` hands to `evaluate()` (`evidence_input_snapshot`
is never set for the service step, so the STORED snapshot is the SAME dict
passed to the package; see `service_output_extension.md` §"Evidence &
persistence").

IMPORTANT (documented, not a bug): `World.project()` (`models/proposal/world.py`)
groups `feature_snapshot` as `{situation, preference, history,
additional_proposed, ...}` per the (content-selector-authored, but shared)
`CONTENT_FEATURE_DISPOSITIONS` registry (`models/proposal/dispositions.py`).
Every A.1 field this test checks for IS present in that registry — just
nested under a group key, not flat at the top level:

  - situation:           drowsiness_level, fatigue_level, traffic_state,
                          road_type, night_state, monotony_level, route_tags,
                          destination_tags, child_present, multiple_passengers
  - preference:           oshi_registered, oshi_mode, service_recency_state,
                          service_usage_level, scene_service_usage_level
  - history:              service_proposal_acceptance_rate,
                          service_recovery_rate
  - additional_proposed:  service_proposal_acceptance_confidence,
                          service_recovery_confidence

Per tasks.md T009: "If ANY field is absent from the projection, extend the
projection ADDITIVELY... if all present, the test just documents the
contract." Every field below IS present (verified by this test) — so NO
projection extension was made in this unit; this test exists purely to
document/pin the (nested) contract the real scorer will read from in a
later P5 unit.
"""
from __future__ import annotations

import json
import os

import pytest
from fastapi.testclient import TestClient

from aica_api.config import settings
from aica_api.main import app

client = TestClient(app)

_SEED_ID = "seed-night-highway-oshi"


def _load_seed_world_dict(seed_id: str = _SEED_ID) -> dict:
    path = settings.proposal_contracts_dir / "seeds" / f"{seed_id}.json"
    return json.loads(path.read_text(encoding="utf-8"))["world"]


@pytest.fixture(scope="module")
def service_feature_snapshot(tmp_path_factory) -> dict:
    """POST the run under an isolated ``AICA_PROPOSAL_RUNS_DIR``.

    Module-scoped (the run is created once and every parametrized field-check
    reads the same snapshot) — a plain function-scoped ``monkeypatch`` fixture
    would NOT isolate this: pytest sets up broader-scoped fixtures before
    narrower-scoped ones, so a module-scoped fixture that depends on a
    function-scoped ``monkeypatch`` still runs (and would persist a REAL run
    file) before that ``monkeypatch`` takes effect. Save/restore the env var
    directly instead, scoped to this fixture's own lifetime.
    """
    runs_dir = tmp_path_factory.mktemp("p5_context_fields_runs")
    previous = os.environ.get("AICA_PROPOSAL_RUNS_DIR")
    os.environ["AICA_PROPOSAL_RUNS_DIR"] = str(runs_dir)
    try:
        body = {
            "world": _load_seed_world_dict(),
            "service_package_id": "mock_service_selector_v1",
            "content_package_id": "mock_content_selector_v1",
            "mode": "interactive",
            "run_seed": "seed-1",
            "simulation_time": "2026-07-16T10:00:00Z",
        }
        resp = client.post("/api/proposal/runs", json=body)
        assert resp.status_code == 201, resp.text
        body = resp.json()
        service_evidence = next(ev for ev in body["evidence"] if ev["step"] == "service")
        return service_evidence["input_snapshot"]["feature_snapshot"]
    finally:
        if previous is None:
            os.environ.pop("AICA_PROPOSAL_RUNS_DIR", None)
        else:
            os.environ["AICA_PROPOSAL_RUNS_DIR"] = previous


# ---------------------------------------------------------------------------
# situation group — the 10 A.1 scene fields (excl. motion_state, which is
# not part of T009's list)
# ---------------------------------------------------------------------------

_SITUATION_FIELDS = [
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
]


@pytest.mark.parametrize("field_id", _SITUATION_FIELDS)
def test_situation_field_present(service_feature_snapshot, field_id):
    assert field_id in service_feature_snapshot["situation"], (
        f"{field_id!r} missing from feature_snapshot['situation']"
    )


# ---------------------------------------------------------------------------
# preference group — oshi + candidate-indexed usage/recency/scene fields
# ---------------------------------------------------------------------------

_PREFERENCE_FIELDS = [
    "oshi_registered",
    "oshi_mode",
    "service_recency_state",
    "service_usage_level",
    "scene_service_usage_level",
]


@pytest.mark.parametrize("field_id", _PREFERENCE_FIELDS)
def test_preference_field_present(service_feature_snapshot, field_id):
    assert field_id in service_feature_snapshot["preference"], (
        f"{field_id!r} missing from feature_snapshot['preference']"
    )


def test_preference_candidate_indexed_fields_are_service_id_keyed_maps(service_feature_snapshot):
    pref = service_feature_snapshot["preference"]
    for field_id in ("service_recency_state", "service_usage_level"):
        assert isinstance(pref[field_id], dict)


# ---------------------------------------------------------------------------
# history group — acceptance/recovery rate (candidate-indexed)
# ---------------------------------------------------------------------------

_HISTORY_FIELDS = ["service_proposal_acceptance_rate", "service_recovery_rate"]


@pytest.mark.parametrize("field_id", _HISTORY_FIELDS)
def test_history_field_present(service_feature_snapshot, field_id):
    assert field_id in service_feature_snapshot["history"], (
        f"{field_id!r} missing from feature_snapshot['history']"
    )
    assert isinstance(service_feature_snapshot["history"][field_id], dict)


# ---------------------------------------------------------------------------
# additional_proposed group — the two confidence maps (candidate-indexed)
# ---------------------------------------------------------------------------

_ADDITIONAL_PROPOSED_FIELDS = [
    "service_proposal_acceptance_confidence",
    "service_recovery_confidence",
]


@pytest.mark.parametrize("field_id", _ADDITIONAL_PROPOSED_FIELDS)
def test_additional_proposed_field_present(service_feature_snapshot, field_id):
    assert field_id in service_feature_snapshot["additional_proposed"], (
        f"{field_id!r} missing from feature_snapshot['additional_proposed']"
    )
    assert isinstance(service_feature_snapshot["additional_proposed"][field_id], dict)


# ---------------------------------------------------------------------------
# Whole-set sanity: every A.1 field T009 lists is reachable SOMEWHERE in the
# nested feature_snapshot (documents the contract even if a future reader
# doesn't know the exact group).
# ---------------------------------------------------------------------------


def test_every_t009_field_is_reachable_somewhere_in_feature_snapshot(service_feature_snapshot):
    all_fields = (
        _SITUATION_FIELDS + _PREFERENCE_FIELDS + _HISTORY_FIELDS + _ADDITIONAL_PROPOSED_FIELDS
    )
    reachable = {
        *service_feature_snapshot.get("situation", {}).keys(),
        *service_feature_snapshot.get("preference", {}).keys(),
        *service_feature_snapshot.get("history", {}).keys(),
        *service_feature_snapshot.get("additional_proposed", {}).keys(),
    }
    missing = [f for f in all_fields if f not in reachable]
    assert not missing, f"Fields absent from the projection entirely: {missing}"
