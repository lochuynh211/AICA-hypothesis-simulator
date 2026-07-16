"""TDD tests for the `PurposeStageServiceMatrix` loader/resolver (T012).

Covers:
  - Loading the frozen artifact (`proposal_contracts/matrix/purpose_stage_matrix.v1.json`),
    tolerating the `_note` key present on the `during_rest_stopped` row.
  - All 6 rows resolve via `resolve(trigger_purpose, lifecycle_stage)`.
  - The post-rest row resolves to exactly the 5 expected services incl.
    `call_response_stopped`.
  - `during_rest_stopped` resolves to an empty list (journey-engine-owned rest
    actions have no ServiceId members).
  - An incompatible or unknown `(purpose, stage)` pair raises the typed
    `MatrixResolutionError`.
  - Model validators: exactly 6 rows; the post-rest row lists exactly the 5
    expected services; every non-empty `allowed_service_ids` entry is a valid
    `ServiceId`.
"""
from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from aica_api.config import settings
from aica_api.models.proposal.enums import LifecycleStage, ServiceId, TriggerPurpose
from aica_api.models.proposal.matrix import (
    MatrixResolutionError,
    MatrixRow,
    PurposeStageServiceMatrix,
)

_MATRIX_PATH = settings.proposal_contracts_dir / "matrix" / "purpose_stage_matrix.v1.json"

_POST_REST_EXPECTED = {
    ServiceId.live_viewing,
    ServiceId.stretch_video,
    ServiceId.full_karaoke,
    ServiceId.oshi_reexperience,
    ServiceId.call_response_stopped,
}

_ACTIVE_DRIVING_SERVICES = {
    ServiceId.music_playlist,
    ServiceId.humming_karaoke,
    ServiceId.quiz,
    ServiceId.ranking_creation,
    ServiceId.radio_style,
    ServiceId.call_response_driving,
}


def _raw_matrix() -> dict:
    with _MATRIX_PATH.open(encoding="utf-8") as fh:
        return json.load(fh)


@pytest.fixture()
def matrix() -> PurposeStageServiceMatrix:
    return PurposeStageServiceMatrix.load(_MATRIX_PATH)


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------


def test_loads_from_frozen_artifact(matrix: PurposeStageServiceMatrix):
    assert matrix.matrix_version == "v1"
    assert len(matrix.rows) == 6


def test_load_tolerates_note_key_on_rows(matrix: PurposeStageServiceMatrix):
    """The during_rest_stopped row carries an explanatory `_note` key in the
    frozen JSON; loading must not choke on it."""
    raw = _raw_matrix()
    assert any("_note" in row for row in raw["rows"])
    # If load() got this far (fixture succeeded), the note was tolerated.
    during_rest = [
        r
        for r in matrix.rows
        if r.trigger_purpose == TriggerPurpose.rest_recommended
        and r.lifecycle_stage == LifecycleStage.during_rest_stopped
    ]
    assert len(during_rest) == 1


# ---------------------------------------------------------------------------
# All 6 rows resolve
# ---------------------------------------------------------------------------


def test_all_six_rows_resolve(matrix: PurposeStageServiceMatrix):
    raw = _raw_matrix()
    assert len(raw["rows"]) == 6
    for row in raw["rows"]:
        purpose = TriggerPurpose(row["trigger_purpose"])
        stage = LifecycleStage(row["lifecycle_stage"])
        resolved = matrix.resolve(purpose, stage)
        assert [s.value for s in resolved] == row["allowed_service_ids"]


def test_active_driving_rows_resolve_six_services(matrix: PurposeStageServiceMatrix):
    for purpose in (
        TriggerPurpose.inattentive_driving_prevention_recovery,
        TriggerPurpose.route_music,
        TriggerPurpose.child_passenger_experience,
    ):
        resolved = matrix.resolve(purpose, LifecycleStage.active_driving_content)
        assert set(resolved) == _ACTIVE_DRIVING_SERVICES


def test_before_rest_resolves_six_services(matrix: PurposeStageServiceMatrix):
    resolved = matrix.resolve(
        TriggerPurpose.rest_recommended, LifecycleStage.before_rest_until_stop
    )
    assert set(resolved) == _ACTIVE_DRIVING_SERVICES


# ---------------------------------------------------------------------------
# Post-rest / during-rest special cases
# ---------------------------------------------------------------------------


def test_post_rest_resolves_five_incl_call_response_stopped(
    matrix: PurposeStageServiceMatrix,
):
    resolved = matrix.resolve(
        TriggerPurpose.rest_recommended, LifecycleStage.after_rest_before_restart
    )
    assert len(resolved) == 5
    assert ServiceId.call_response_stopped in resolved
    assert set(resolved) == _POST_REST_EXPECTED


def test_during_rest_stopped_resolves_to_empty_list(matrix: PurposeStageServiceMatrix):
    resolved = matrix.resolve(
        TriggerPurpose.rest_recommended, LifecycleStage.during_rest_stopped
    )
    assert resolved == []


# ---------------------------------------------------------------------------
# Incompatible / unknown pairs raise a typed error
# ---------------------------------------------------------------------------


def test_incompatible_pair_raises_matrix_resolution_error(
    matrix: PurposeStageServiceMatrix,
):
    with pytest.raises(MatrixResolutionError):
        matrix.resolve(TriggerPurpose.route_music, LifecycleStage.before_rest_until_stop)


def test_unknown_pair_raises_matrix_resolution_error(matrix: PurposeStageServiceMatrix):
    with pytest.raises(MatrixResolutionError):
        matrix.resolve(
            TriggerPurpose.child_passenger_experience, LifecycleStage.during_rest_stopped
        )


def test_resolution_error_message_names_the_pair(matrix: PurposeStageServiceMatrix):
    with pytest.raises(MatrixResolutionError, match="route_music"):
        matrix.resolve(TriggerPurpose.route_music, LifecycleStage.before_rest_until_stop)


# ---------------------------------------------------------------------------
# Model validators
# ---------------------------------------------------------------------------


def test_validator_rejects_wrong_row_count():
    raw = _raw_matrix()
    with pytest.raises(ValidationError):
        PurposeStageServiceMatrix(matrix_version="v1", rows=raw["rows"][:5])


def test_validator_rejects_malformed_post_rest_row():
    raw = _raw_matrix()
    rows = [dict(r) for r in raw["rows"]]
    for row in rows:
        if (
            row["trigger_purpose"] == "rest_recommended"
            and row["lifecycle_stage"] == "after_rest_before_restart"
        ):
            row["allowed_service_ids"] = ["live_viewing"]  # tamper: only 1, not 5
    with pytest.raises(ValidationError):
        PurposeStageServiceMatrix(matrix_version="v1", rows=rows)


def test_validator_rejects_invalid_service_id():
    with pytest.raises(ValidationError):
        MatrixRow(
            trigger_purpose="rest_recommended",
            lifecycle_stage="before_rest_until_stop",
            allowed_service_ids=["not_a_real_service_id"],
        )


def test_row_tolerates_note_key_directly():
    """MatrixRow itself (not just the loader) tolerates the `_note` key."""
    row = MatrixRow(
        trigger_purpose="rest_recommended",
        lifecycle_stage="during_rest_stopped",
        allowed_service_ids=[],
        _note="explanatory text, not part of the contract",
    )
    assert row.allowed_service_ids == []
