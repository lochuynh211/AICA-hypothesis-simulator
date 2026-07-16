"""TDD (T025/T026): US4 — motion change deterministically applies
screen/background/stop behavior to an active plan and re-evaluates
eligibility (spec.md User Story 4; FR-014, SC-006; research.md D5).

Covers the ``motion_change`` handler on the PURE ``apply_action`` engine:

  - active `live_viewing` (``background_on_motion``) + motion -> `driving`
    => ``MOTION_CHANGED`` + ``playback_state=backgrounded``.
  - active `full_karaoke` (hard stopped-only) + motion -> `driving`
    => ``playback_state=stopped``.
  - active `music_playlist` (driving-capable audio) + motion -> `driving`
    => unchanged (`active`).
  - motion -> `stopped` from `backgrounded` => `active` (screen resumes).
  - The ``MOTION_CHANGED`` event carries recomputed ``eligible``/``excluded``
    (research.md D1/D2 eligibility, re-run per FR-014).
  - Calling ``motion_change`` twice with identical run state yields
    identical events (SC-006, determinism).
  - A ``motion_change`` with no/invalid ``capabilities`` or malformed
    ``motion_state`` payload is a structured rejection, never a crash
    (FR-012).

All state is built by driving REAL create-run (+ select-service, accept)
endpoint calls (mock packages) to get a genuinely active plan, then
``model_copy``'d to swap in the specific active service under test where the
mock content package doesn't support that service directly (mirrors the
"build such a run or set state" allowance in the P4 US4 brief) --
``mock_content_selector_v1`` only supports
``music_playlist``/``humming_karaoke``/``full_karaoke``, not
``live_viewing``, so the ``live_viewing`` scenario is reached by overriding
``active_service_id`` on an otherwise-real ``content_started`` run.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from aica_api.config import settings
from aica_api.main import app
from aica_api.models.proposal.enums import (
    DiscreteEventType,
    JourneyActionType,
    PlaybackState,
    ServiceId,
)
from aica_api.models.proposal.journey_action import JourneyAction
from aica_api.models.proposal.proposal_run import ProposalRunLog
from aica_api.models.proposal.service_capabilities import ServiceCapabilities
from aica_api.services.proposal_journey import apply_action

client = TestClient(app)

_CAPABILITIES_PATH = (
    settings.proposal_contracts_dir / "service_capabilities" / "service_capabilities.v1.json"
)

# rest_recommended / after_rest_before_restart allowed row (data-model.md /
# purpose_stage_matrix.v1.json) -- includes live_viewing (background_on_motion)
# and full_karaoke (hard stopped-only), both content-selectable/overridable.
_POST_REST_POOL = [
    "live_viewing",
    "stretch_video",
    "full_karaoke",
    "oshi_reexperience",
    "call_response_stopped",
]


@pytest.fixture(autouse=True)
def isolate_proposal_runs_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(tmp_path))
    yield


@pytest.fixture(scope="module")
def capabilities() -> ServiceCapabilities:
    return ServiceCapabilities.load(_CAPABILITIES_PATH)


def _create_run_body(**overrides) -> dict:
    body = {
        "trigger_purpose": "rest_recommended",
        "lifecycle_stage": "after_rest_before_restart",
        "motion_state": "stopped",
        "world_snapshot": {"feature_snapshot": {}, "feature_provenance": {}},
        "service_package_id": "mock_service_selector_v1",
        "content_package_id": "mock_content_selector_v1",
        "mode": "interactive",
        "enabled_feature_extensions": [],
        "parameters": {},
        "hyperparameters": {},
        "run_seed": "seed-1",
        "simulation_time": "2026-07-16T10:00:00Z",
    }
    body.update(overrides)
    return body


def _active_plan_run_log(selected_service_id: str, *, override_active_service_id: str | None = None) -> ProposalRunLog:
    """Drive create-run -> select-service(selected_service_id) -> accept via
    REAL endpoints (mock packages) to a genuinely `content_started`/`active`
    plan, then optionally override `active_service_id` (and mirror it into
    the opportunity's allowed row via `previous_content`-free journey_state
    copy) to reach a service the mock content package can't select directly
    (`live_viewing`)."""
    created = client.post("/api/proposal/runs", json=_create_run_body())
    assert created.status_code == 201, created.text
    run_id = created.json()["run_id"]

    selected = client.post(
        f"/api/proposal/runs/{run_id}/select-service",
        json={"selected_service_id": selected_service_id},
    )
    assert selected.status_code == 200, selected.text
    assert selected.json()["status"] == "content_selected"

    accepted = client.post(
        f"/api/proposal/runs/{run_id}/journey/action",
        json={"action_type": "accept", "payload": {}},
    )
    assert accepted.status_code == 200, accepted.text
    body = accepted.json()
    assert body["journey_state"]["playback_state"] == "active"
    run_log = ProposalRunLog(**body)

    if override_active_service_id is not None:
        run_log = run_log.model_copy(
            update={
                "journey_state": run_log.journey_state.model_copy(
                    update={"active_service_id": override_active_service_id}
                )
            }
        )
    return run_log


def _driving_capable_audio_run_log() -> ProposalRunLog:
    """A music_playlist active plan on the six-service driving row (all
    driving_capable, non-screen-dependent) -- used for the "unchanged while
    driving" scenario."""
    created = client.post(
        "/api/proposal/runs",
        json=_create_run_body(
            trigger_purpose="inattentive_driving_prevention_recovery",
            lifecycle_stage="active_driving_content",
            motion_state="stopped",
        ),
    )
    assert created.status_code == 201, created.text
    run_id = created.json()["run_id"]

    selected = client.post(
        f"/api/proposal/runs/{run_id}/select-service",
        json={"selected_service_id": "music_playlist"},
    )
    assert selected.status_code == 200, selected.text

    accepted = client.post(
        f"/api/proposal/runs/{run_id}/journey/action",
        json={"action_type": "accept", "payload": {}},
    )
    assert accepted.status_code == 200, accepted.text
    return ProposalRunLog(**accepted.json())


def _apply(run_log: ProposalRunLog, action_type: JourneyActionType, now: str, payload: dict | None = None, *, capabilities=None):
    action = JourneyAction(action_type=action_type, payload=payload or {})
    return apply_action(run_log, action, now=now, capabilities=capabilities)


# ---------------------------------------------------------------------------
# live_viewing (background_on_motion) -- backgrounded, not stopped
# ---------------------------------------------------------------------------


def test_live_viewing_active_plan_backgrounded_on_driving(capabilities):
    run_log = _active_plan_run_log("full_karaoke", override_active_service_id="live_viewing")

    transition = _apply(
        run_log,
        JourneyActionType.motion_change,
        now="2026-07-16T11:00:00Z",
        payload={"motion_state": "driving"},
        capabilities=capabilities,
    )

    assert transition.rejected is None
    js = transition.new_journey_state
    assert js.motion_state == "driving"
    assert js.playback_state == PlaybackState.backgrounded
    assert transition.new_status == run_log.status

    event_types = [e.event_type for e in transition.events]
    assert event_types == [DiscreteEventType.MOTION_CHANGED]
    payload = transition.events[0].payload
    assert payload["motion_state"] == "driving"
    assert payload["active_plan_disposition"] == "backgrounded"
    assert "live_viewing" in payload["eligible"]
    excluded_ids = {excl["candidate_id"] for excl in payload["excluded"]}
    assert "full_karaoke" in excluded_ids
    assert "stretch_video" in excluded_ids


# ---------------------------------------------------------------------------
# full_karaoke (hard stopped-only) -- stopped
# ---------------------------------------------------------------------------


def test_full_karaoke_active_plan_stopped_on_driving(capabilities):
    run_log = _active_plan_run_log("full_karaoke")
    assert run_log.journey_state.active_service_id == "full_karaoke"

    transition = _apply(
        run_log,
        JourneyActionType.motion_change,
        now="2026-07-16T11:00:00Z",
        payload={"motion_state": "driving"},
        capabilities=capabilities,
    )

    assert transition.rejected is None
    js = transition.new_journey_state
    assert js.motion_state == "driving"
    assert js.playback_state == PlaybackState.stopped
    event = transition.events[0]
    assert event.event_type == DiscreteEventType.MOTION_CHANGED
    assert event.payload["active_plan_disposition"] == "stopped"


# ---------------------------------------------------------------------------
# music_playlist (driving-capable audio) -- unchanged
# ---------------------------------------------------------------------------


def test_driving_capable_audio_plan_unchanged_on_driving(capabilities):
    run_log = _driving_capable_audio_run_log()
    assert run_log.journey_state.active_service_id == "music_playlist"
    assert run_log.journey_state.playback_state == PlaybackState.active

    transition = _apply(
        run_log,
        JourneyActionType.motion_change,
        now="2026-07-16T11:00:00Z",
        payload={"motion_state": "driving"},
        capabilities=capabilities,
    )

    assert transition.rejected is None
    js = transition.new_journey_state
    assert js.motion_state == "driving"
    assert js.playback_state == PlaybackState.active
    assert transition.events[0].payload["active_plan_disposition"] == "unchanged"


# ---------------------------------------------------------------------------
# stopped resumes a backgrounded plan
# ---------------------------------------------------------------------------


def test_motion_stopped_resumes_backgrounded_plan(capabilities):
    run_log = _active_plan_run_log("full_karaoke", override_active_service_id="live_viewing")
    driving = _apply(
        run_log,
        JourneyActionType.motion_change,
        now="2026-07-16T11:00:00Z",
        payload={"motion_state": "driving"},
        capabilities=capabilities,
    )
    assert driving.rejected is None
    assert driving.new_journey_state.playback_state == PlaybackState.backgrounded
    backgrounded_run_log = run_log.model_copy(
        update={
            "events": [*run_log.events, *driving.events],
            "journey_state": driving.new_journey_state,
            "status": driving.new_status,
        }
    )

    transition = _apply(
        backgrounded_run_log,
        JourneyActionType.motion_change,
        now="2026-07-16T11:01:00Z",
        payload={"motion_state": "stopped"},
        capabilities=capabilities,
    )

    assert transition.rejected is None
    js = transition.new_journey_state
    assert js.motion_state == "stopped"
    assert js.playback_state == PlaybackState.active


# ---------------------------------------------------------------------------
# determinism (SC-006)
# ---------------------------------------------------------------------------


def test_motion_change_is_deterministic(capabilities):
    run_log = _active_plan_run_log("full_karaoke", override_active_service_id="live_viewing")

    t1 = _apply(
        run_log,
        JourneyActionType.motion_change,
        now="2026-07-16T11:00:00Z",
        payload={"motion_state": "driving"},
        capabilities=capabilities,
    )
    t2 = _apply(
        run_log,
        JourneyActionType.motion_change,
        now="2026-07-16T11:00:00Z",
        payload={"motion_state": "driving"},
        capabilities=capabilities,
    )

    assert t1.events == t2.events
    assert t1.new_journey_state == t2.new_journey_state
    assert t1.new_status == t2.new_status


# ---------------------------------------------------------------------------
# no active plan -> disposition "none"
# ---------------------------------------------------------------------------


def test_motion_change_with_no_active_plan_has_none_disposition(capabilities):
    created = client.post("/api/proposal/runs", json=_create_run_body())
    assert created.status_code == 201, created.text
    run_log = ProposalRunLog(**created.json())
    assert run_log.journey_state.playback_state == PlaybackState.idle

    transition = _apply(
        run_log,
        JourneyActionType.motion_change,
        now="2026-07-16T11:00:00Z",
        payload={"motion_state": "driving"},
        capabilities=capabilities,
    )

    assert transition.rejected is None
    assert transition.events[0].payload["active_plan_disposition"] == "none"


# ---------------------------------------------------------------------------
# FR-012 payload hardening
# ---------------------------------------------------------------------------


def test_motion_change_without_capabilities_is_rejected():
    created = client.post("/api/proposal/runs", json=_create_run_body())
    run_log = ProposalRunLog(**created.json())

    transition = _apply(
        run_log,
        JourneyActionType.motion_change,
        now="2026-07-16T11:00:00Z",
        payload={"motion_state": "driving"},
        capabilities=None,
    )

    assert transition.rejected is not None
    assert transition.rejected.code == "capabilities_unavailable"
    assert transition.events == []


def test_motion_change_with_missing_motion_state_is_invalid_payload(capabilities):
    created = client.post("/api/proposal/runs", json=_create_run_body())
    run_log = ProposalRunLog(**created.json())

    transition = _apply(
        run_log,
        JourneyActionType.motion_change,
        now="2026-07-16T11:00:00Z",
        payload={},
        capabilities=capabilities,
    )

    assert transition.rejected is not None
    assert transition.rejected.code == "invalid_payload"
    assert transition.events == []


def test_motion_change_with_bogus_motion_state_is_invalid_payload(capabilities):
    created = client.post("/api/proposal/runs", json=_create_run_body())
    run_log = ProposalRunLog(**created.json())

    transition = _apply(
        run_log,
        JourneyActionType.motion_change,
        now="2026-07-16T11:00:00Z",
        payload={"motion_state": "flying"},
        capabilities=capabilities,
    )

    assert transition.rejected is not None
    assert transition.rejected.code == "invalid_payload"
    assert transition.events == []


def test_motion_change_endpoint_returns_422_never_500():
    """The router endpoint must never turn a malformed motion_change payload
    into an unhandled 500 (FR-012) -- it's a structured 422."""
    created = client.post("/api/proposal/runs", json=_create_run_body())
    run_id = created.json()["run_id"]

    response = client.post(
        f"/api/proposal/runs/{run_id}/journey/action",
        json={"action_type": "motion_change", "payload": {"motion_state": "sideways"}},
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_payload"
