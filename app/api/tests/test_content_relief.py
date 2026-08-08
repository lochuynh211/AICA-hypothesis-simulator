"""Content-relief model tests (recovery semantics refactor, Task 1)."""
import pytest
from pydantic import ValidationError

from aica_api.models.profile import ActivityRecovery
from aica_api.models.run import ContentContext, ContentReliefState


def test_activity_recovery_stimulus_fields_default_to_inert():
    rec = ActivityRecovery()
    assert rec.stimulus_relief_per_min == 0.0
    assert rec.cap_stimulus is None


def test_activity_recovery_rejects_negative_stimulus_rate():
    with pytest.raises(ValidationError):
        ActivityRecovery(stimulus_relief_per_min=-1.0)


def test_content_context_builds_the_recovery_key():
    ctx = ContentContext(service_id="humming_karaoke", purpose="pre_rest")
    assert ctx.recovery_key == "humming_karaoke@pre_rest"


def test_content_context_rejects_an_unknown_purpose():
    with pytest.raises(ValidationError):
        ContentContext(service_id="humming_karaoke", purpose="nap")


def test_content_relief_state_starts_with_zero_accrual():
    state = ContentReliefState(content_key="quiz@monotony")
    assert state.accrued_drowsiness == 0.0
    assert state.accrued_fatigue == 0.0
    assert state.accrued_stimulus == 0.0
