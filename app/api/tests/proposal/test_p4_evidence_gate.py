"""P4 POLISH cross-cutting guard (T033) — the evidence gate.

Constitution Principle II (append-only; failures are never disguised) and
spec.md FR-003/FR-018/FR-020 demand four invariants that no single P4 unit
test (A-I) asserts end-to-end in one place:

  1. Every eligibility decision made at STEP 1 (create-run) is represented in
     the append-only ``run_log.events`` AND the STEP-1 evidence
     ``input_snapshot`` carries the reason-coded exclusions (never silently
     dropped) — mirrors ``test_us1_eligibility_wiring.py``.
  2. Exclusions (both the STEP-1 evidence ``excluded_candidates`` and a
     ``NO_ELIGIBLE_CANDIDATE`` event's ``excluded`` payload) carry NO
     score/fit/weight/utility key anywhere (FR-003) — ``EligibilityExclusion``
     structurally has no such field; this pins that at the wire/JSON level.
  3. Every journey action (accept/complete/continue/stop) produces its own
     discrete event, persisted append-only, with no evidence recompute
     (mirrors ``test_us2_replay_no_recompute.py``); a forced selector failure
     surfaces as an explicit ``ALGORITHM_ERROR`` event (never a fabricated
     ``SERVICE_SELECTED``) — reuses the raising-package pattern from
     ``test_ep_create_run.py``/``test_us3_failure_visibility.py``.
  4. Reopening a run (``GET /runs/{id}``) never adds or recomputes evidence —
     repeat reads are byte-identical, including at the level of the
     persisted on-disk file (Principle III).
"""
from __future__ import annotations

import json
import shutil

import pytest
from fastapi.testclient import TestClient

from aica_api.config import settings
from aica_api.main import app
from aica_api.models.proposal.enums import EligibilityReasonCode
from aica_api.models.proposal.eligibility import EligibilityExclusion, EligibilityResult

client = TestClient(app)

_FORBIDDEN_EXCLUSION_KEYS = {"score", "fit", "weight", "utility"}


@pytest.fixture(autouse=True)
def isolate_proposal_runs_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(tmp_path))
    yield


def _create_run_body(**overrides) -> dict:
    body = {
        "trigger_purpose": "rest_recommended",
        "lifecycle_stage": "after_rest_before_restart",
        "motion_state": "driving",
        "world_snapshot": {
            "feature_snapshot": {"oshi_registered": False},
            "feature_provenance": {},
        },
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


def _no_forbidden_keys(obj) -> list[str]:
    """Recursively collect any dict key in *obj* that matches a forbidden
    score/fit/weight/utility name (case-insensitive substring match, so
    e.g. ``utility_score`` would also be caught)."""
    offenders: list[str] = []
    if isinstance(obj, dict):
        for key, value in obj.items():
            if any(bad in key.lower() for bad in _FORBIDDEN_EXCLUSION_KEYS):
                offenders.append(key)
            offenders.extend(_no_forbidden_keys(value))
    elif isinstance(obj, list):
        for item in obj:
            offenders.extend(_no_forbidden_keys(item))
    return offenders


# ---------------------------------------------------------------------------
# 1 + 2 — eligibility decision in the log; exclusions carry no score.
# ---------------------------------------------------------------------------


class TestEligibilityDecisionRecordedScoreFree:
    def test_excluded_candidates_in_step1_evidence_and_no_forbidden_keys(self):
        resp = client.post("/api/proposal/runs", json=_create_run_body())
        assert resp.status_code == 201
        body = resp.json()

        ev = body["evidence"][0]
        excluded = ev["input_snapshot"]["excluded_candidates"]
        assert excluded, "fixture (driving, no oshi) must exclude at least one service"
        excluded_ids = {c["candidate_id"] for c in excluded}
        assert "full_karaoke" in excluded_ids
        assert "stretch_video" in excluded_ids

        for candidate in excluded:
            assert set(candidate.keys()) == {"candidate_id", "platform_reason"}
        assert _no_forbidden_keys(excluded) == []

    def test_opportunity_opened_and_service_selected_events_recorded(self):
        resp = client.post("/api/proposal/runs", json=_create_run_body())
        body = resp.json()
        event_types = [e["event_type"] for e in body["events"]]
        assert event_types == ["OPPORTUNITY_OPENED", "SERVICE_SELECTED"]

        # The eligibility decision is not just implicit in the ranked output —
        # it is independently recoverable from the persisted evidence.
        ev = body["evidence"][0]
        eligible_ids = {c["candidate_id"] for c in ev["input_snapshot"]["eligible_candidates"]}
        assert eligible_ids == {"live_viewing"}
        assert body["journey_state"]["active_service_id"] == "live_viewing"

    def test_no_eligible_candidate_event_payload_is_also_score_free(self, monkeypatch):
        """Force every allowed service to be excluded (T017a branch) and
        confirm the NO_ELIGIBLE_CANDIDATE event's own excluded payload is
        equally score-free — this is a DIFFERENT persisted location than the
        STEP-1 evidence input_snapshot checked above."""

        def _fake_resolve_eligibility(
            allowed_service_ids,
            motion_state,
            capabilities,
            *,
            registered_entities,
            unavailable_service_ids=frozenset(),
        ):
            return EligibilityResult(
                eligible=[],
                excluded=[
                    EligibilityExclusion(
                        service_id=sid,
                        reason_codes=[EligibilityReasonCode.catalog_item_unavailable],
                    )
                    for sid in allowed_service_ids
                ],
            )

        monkeypatch.setattr(
            "aica_api.routers.proposal.resolve_eligibility", _fake_resolve_eligibility
        )

        resp = client.post("/api/proposal/runs", json=_create_run_body())
        assert resp.status_code == 201
        body = resp.json()

        event_types = [e["event_type"] for e in body["events"]]
        assert event_types == ["OPPORTUNITY_OPENED", "NO_ELIGIBLE_CANDIDATE"]

        no_eligible_event = body["events"][-1]
        excluded_payload = no_eligible_event["payload"]["excluded"]
        assert excluded_payload  # non-empty: every allowed service was excluded
        for entry in excluded_payload:
            assert set(entry.keys()) == {"service_id", "reason_codes"}
        assert _no_forbidden_keys(excluded_payload) == []
        # And: no service AlgorithmEvidence is fabricated for a run with
        # nothing eligible to rank.
        assert body["evidence"] == []


# ---------------------------------------------------------------------------
# 3 — every journey action recorded append-only; forced failure -> explicit
#     ALGORITHM_ERROR, never disguised.
# ---------------------------------------------------------------------------


def _content_selected_run() -> dict:
    created = client.post(
        "/api/proposal/runs",
        json=_create_run_body(motion_state="stopped", world_snapshot={
            "feature_snapshot": {"oshi_registered": True},
            "feature_provenance": {},
        }),
    )
    assert created.status_code == 201, created.text
    run_id = created.json()["run_id"]

    selected = client.post(
        f"/api/proposal/runs/{run_id}/select-service",
        json={"selected_service_id": "full_karaoke"},
    )
    assert selected.status_code == 200, selected.text
    body = selected.json()
    assert body["status"] == "content_selected"
    return body


def _action(run_id: str, action_type: str, payload: dict | None = None):
    return client.post(
        f"/api/proposal/runs/{run_id}/journey/action",
        json={"action_type": action_type, "payload": payload or {}},
    )


class TestJourneyActionsAppendOnly:
    def test_every_journey_action_produces_its_own_persisted_event(self):
        run = _content_selected_run()
        run_id = run["run_id"]
        baseline_evidence_count = len(run["evidence"])

        r1 = _action(run_id, "accept")
        assert r1.status_code == 200, r1.text
        r2 = _action(run_id, "complete")
        assert r2.status_code == 200, r2.text
        r3 = _action(run_id, "continue")
        assert r3.status_code == 200, r3.text
        r4 = _action(run_id, "stop")
        assert r4.status_code == 200, r4.text

        final = client.get(f"/api/proposal/runs/{run_id}").json()
        event_types = [e["event_type"] for e in final["events"]]
        assert event_types == [
            "OPPORTUNITY_OPENED",
            "SERVICE_SELECTED",
            "CONTENT_SELECTED",
            "CONTENT_STARTED",
            "CONTENT_COMPLETED",
            "CONTINUE_REQUESTED",
            "RETURN_TO_PREVIOUS_CONTENT",
        ]
        # Journey actions never trigger a selector re-invocation.
        assert len(final["evidence"]) == baseline_evidence_count


class TestForcedFailureIsExplicitAlgorithmError:
    def test_raising_service_package_yields_algorithm_error_not_disguised(self, tmp_path, monkeypatch):
        pkgs_dir = tmp_path / "pkgs"
        pkgs_dir.mkdir()

        shutil.copytree(
            settings.packages_dir / "mock_content_selector_v1",
            pkgs_dir / "mock_content_selector_v1",
        )

        broken_dir = pkgs_dir / "broken_service_selector"
        broken_dir.mkdir()
        (broken_dir / "package.json").write_text(
            json.dumps(
                {
                    "id": "broken_service_selector",
                    "version": "1.0.0",
                    "label": {"ja": "x", "en": "x"},
                    "kind": "service_selector",
                    "family": "service_selector",
                    "approach": "transparent",
                    "contract_version": "1.0.0",
                    "algorithm": {
                        "type": "python_module",
                        "entrypoint": "algorithm.py",
                        "error_mode": "blocking",
                    },
                    "supported_services": [],
                    "parameters": {},
                    "hyperparameters": [],
                }
            ),
            encoding="utf-8",
        )
        (broken_dir / "algorithm.py").write_text(
            "def evaluate(context):\n    raise RuntimeError('deliberate T033 failure')\n",
            encoding="utf-8",
        )

        monkeypatch.setenv("AICA_PACKAGES_DIR", str(pkgs_dir))

        resp = client.post(
            "/api/proposal/runs",
            json=_create_run_body(
                service_package_id="broken_service_selector",
                content_package_id="mock_content_selector_v1",
            ),
        )
        assert resp.status_code == 201
        body = resp.json()

        assert body["status"] == "error"
        assert len(body["evidence"]) == 1
        assert body["evidence"][0]["error"] is not None
        assert body["evidence"][0]["output"] is None
        assert "deliberate T033 failure" in body["evidence"][0]["error"]["message"]

        event_types = [e["event_type"] for e in body["events"]]
        assert "ALGORITHM_ERROR" in event_types
        # Never disguised as a normal proposal/transition.
        assert "SERVICE_SELECTED" not in event_types
        assert "NO_ELIGIBLE_CANDIDATE" not in event_types

        # And: a run that errored at STEP 1 has no active service to drive
        # a journey action against — the journey-action endpoint's own
        # precondition machinery rejects it rather than silently no-op'ing.
        run_id = body["run_id"]
        action_resp = _action(run_id, "accept")
        assert action_resp.status_code == 422
        reopened = client.get(f"/api/proposal/runs/{run_id}").json()
        assert reopened["events"] == body["events"]
        assert reopened["evidence"] == body["evidence"]


# ---------------------------------------------------------------------------
# 4 — reopening a run never adds or recomputes evidence (Principle III).
# ---------------------------------------------------------------------------


class TestReopenNeverRecomputes:
    def test_repeated_get_is_byte_identical_including_on_disk(self, tmp_path):
        run = _content_selected_run()
        run_id = run["run_id"]

        _action(run_id, "accept")
        _action(run_id, "complete")
        _action(run_id, "continue")
        after_actions = _action(run_id, "stop").json()

        on_disk_path = tmp_path / f"{run_id}.json"
        assert on_disk_path.exists()
        before_bytes = on_disk_path.read_bytes()

        # Reopen several times, including a non-binding preview read in
        # between — none of these may mutate the persisted file.
        reopened_1 = client.get(f"/api/proposal/runs/{run_id}").json()
        preview_resp = client.get(f"/api/proposal/runs/{run_id}/journey/preview")
        assert preview_resp.status_code == 200
        reopened_2 = client.get(f"/api/proposal/runs/{run_id}").json()

        assert reopened_1 == after_actions
        assert reopened_2 == after_actions
        assert on_disk_path.read_bytes() == before_bytes
        assert len(reopened_2["evidence"]) == len(after_actions["evidence"])
