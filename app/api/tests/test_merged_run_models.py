"""Tests for the merged-run Pydantic models (feature 020, Task 1: slice1 run models)."""

from aica_api.models.merged_run import (
    CorrelationEntry,
    CreateMergedRunBody,
    MergedRunHandle,
    MergedTickResponse,
)


def test_handle_roundtrips_and_defaults():
    h = MergedRunHandle(
        merged_run_id="m1",
        trigger_run_id="r1",
        world_template={},
        service_package_id="svc",
        content_package_id="cnt",
        run_seed="7",
    )
    assert h.proposal_run_ids == [] and h.current_proposal_run_id is None
    assert MergedRunHandle.model_validate(h.model_dump()) == h


def test_correlation_entry_shape():
    c = CorrelationEntry(trigger_tick_index=12, proposal_run_id="prun_x")
    assert c.proposal_event_ids == []
