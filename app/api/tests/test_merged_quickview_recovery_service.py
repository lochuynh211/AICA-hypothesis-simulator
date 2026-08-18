"""Regression test — fixbug-0806: the merged quickview's projected recovery
curve must use the SAME content service the proposal selector actually
picks (the service the live merged run plays), not the scenario's
``default_content_service_id``.

Root cause (confirmed, see fixbug-0806 investigation): the quickview curve
comes from ``merged_quickview.project()`` -> ``preview.iter_preview_ticks()``,
which used to always resolve content recovery from the scenario's
``default_content_service_id`` ("quiz" for every shipped scenario). The LIVE
merged run instead uses the proposal selector's chosen ``active_service_id``
("humming_karaoke" for UC-01's default situation). Recovery rates are
per-service (``quiz@monotony`` = 2.65/min, ``humming_karaoke@monotony`` =
3.32/min), so the two Combined-screen charts diverged during the monotony
content-recovery episode.

Fix: ``merged_quickview.project()`` now discovers the selector's pick at the
first actionable fire and passes it to ``iter_preview_ticks`` as the new
``content_service_id`` override, so the projected curve matches what the
live run will actually play.
"""
from __future__ import annotations

from aica_api.config import settings
from aica_api.models.merged_run import MergedQuickviewBody
from aica_api.models.proposal.dataset import CatalogRef, DatasetVersion
from aica_api.models.proposal.enums import (
    AgeBand,
    Gender,
    LifecycleStage,
    MotionState,
    NightState,
    OshiMode,
    RestSpotType,
    RoadType,
    TrafficState,
    TriggerPurpose,
)
from aica_api.models.proposal.world import ControlInputs, DriverProfile, Situation, World
from aica_api.services import merged_quickview
from aica_api.services.preview import iter_preview_ticks

_PACKAGE_ID = "aica_transparent_hybrid_trigger_v1"
_SCENARIO_ID = "uc01_fatigue_recovery_v0_1"
_SERVICE_PACKAGE_ID = "aica_transparent_service_selector_v1"
_CONTENT_PACKAGE_ID = "aica_transparent_content_selector_v1"


def base_world_template() -> World:
    """Same fixture builder as test_merged_adapter.py's base_world_template()."""
    return World(
        control_inputs=ControlInputs(
            trigger_purpose=TriggerPurpose.rest_recommended,
            lifecycle_stage=LifecycleStage.before_rest_until_stop,
            motion_state=MotionState.driving,
            matrix_version="1.0.0",
            dataset_id="soundcharts-grounded-spotify-compatible-demonstration-seed-1042",
        ),
        situation=Situation(
            drowsiness_level=50,
            fatigue_level=30,
            traffic_state=TrafficState.normal,
            road_type=RoadType.highway,
            night_state=NightState.night,
            monotony_level=60,
            route_tags=["highway"],
            destination_tags=["urban"],
            child_present=False,
            multiple_passengers=False,
            motion_state=MotionState.driving,
            estimated_min_until_rest_spot=25,
            rest_spot_type=RestSpotType.sa_pa,
            active_service=None,
            recent_service_rejections=[],
        ),
        driver_profile=DriverProfile(
            oshi_registered=False,
            oshi_mode=OshiMode.off,
            age_band=AgeBand.thirties,
            gender=Gender.unspecified,
            hobby_interest_tags=["music", "driving"],
        ),
        catalog_ref=CatalogRef(
            dataset_id="soundcharts-grounded-spotify-compatible-demonstration-seed-1042",
            dataset_version=DatasetVersion(
                schema_version="1.0.0",
                spotify_track_reference_version="1.0.0",
                spotify_audio_features_reference_version="1.0.0",
            ),
            dataset_hash="deadbeef",
        ),
    )


def _drive_to_completion(**kwargs) -> dict:
    """Drive iter_preview_ticks to completion, the same way evaluate_preview does,
    to retrieve the generator's accumulated return value (StopIteration.value)."""
    ticks = iter_preview_ticks(**kwargs)
    try:
        while True:
            next(ticks)
    except StopIteration as stop:
        return stop.value


def _body() -> MergedQuickviewBody:
    return MergedQuickviewBody(
        package_id=_PACKAGE_ID,
        scenario_id=_SCENARIO_ID,
        run_seed=42,
        world=base_world_template(),
        service_package_id=_SERVICE_PACKAGE_ID,
        content_package_id=_CONTENT_PACKAGE_ID,
        run_seed_proposal="seed-proposal-42",
    )


def test_quickview_projects_selected_service_not_scenario_default():
    body = _body()
    packages_dir = settings.packages_dir
    scenarios_dir = settings.scenarios_dir

    res = merged_quickview.project(
        body,
        packages_dir=packages_dir,
        scenarios_dir=scenarios_dir,
    )
    dumped = res.model_dump()

    fires = dumped["fires"]
    assert fires, "expected at least one fire"
    first_proposal = fires[0]["proposal"]
    assert first_proposal is not None, f"expected a proposal on the first fire; fires={fires}"
    assert first_proposal["journey_state"]["active_service_id"] == "humming_karaoke"

    # Reference curves computed directly from iter_preview_ticks (the
    # underlying engine merged_quickview.project() calls) — one with the
    # selector's actual pick (humming_karaoke), one with the scenario's old
    # default (quiz).
    common_kwargs = dict(
        package_id=_PACKAGE_ID,
        scenario_id=_SCENARIO_ID,
        hyperparameter_overrides=body.hyperparameter_overrides,
        run_seed=body.run_seed,
        rest_option_id=body.rest_option_id,
        packages_dir=packages_dir,
        scenarios_dir=scenarios_dir,
        profiles=body.profiles,
        context_overrides=body.context_overrides,
        initial_state=body.initial_state,
    )
    humming_result = _drive_to_completion(**common_kwargs, content_service_id="humming_karaoke")
    quiz_result = _drive_to_completion(**common_kwargs, content_service_id="quiz")

    humming_signal_series = humming_result["signal_series"]
    quiz_signal_series = quiz_result["signal_series"]

    projected_signal_series = dumped["signal_series"]

    # The fixed curve must equal the humming_karaoke reference exactly...
    assert len(projected_signal_series) == len(humming_signal_series)
    for got, expected in zip(projected_signal_series, humming_signal_series):
        assert got["t"] == expected["t"]
        assert abs(got["drowsiness"] - expected["drowsiness"]) < 1e-6
        assert abs(got["fatigue"] - expected["fatigue"]) < 1e-6

    # ...and must genuinely differ from the quiz baseline at some tick (proof
    # the fix actually changed the curve, not a no-op).
    quiz_by_t = {p["t"]: p["drowsiness"] for p in quiz_signal_series}
    max_abs_diff = max(
        abs(p["drowsiness"] - quiz_by_t[p["t"]])
        for p in projected_signal_series
        if p["t"] in quiz_by_t
    )
    assert max_abs_diff > 1.0, (
        f"expected the humming_karaoke-projected curve to diverge from the quiz "
        f"baseline by >1.0 drowsiness pts somewhere; max_abs_diff={max_abs_diff}"
    )
