#!/usr/bin/env python3
"""One-time promotion script (T014) — P3 Editable World (feature 014).

Reads the committed generator worlds (``generation_workspace/worlds.json`` —
a JSON list produced by ``music_dataset_generator``'s S7 stage, build area,
never read by the running app) and maps + COMPLETES five of them into the
canonical ``SeedWorld``/``World`` shape (``aica_api.models.proposal.world``),
per the milestones §5 "5 representative base seeds" and
``specs/014-proposal-p3-editable-world/research.md`` §R5.

Run (one-time, from the repo root, using the app/api venv so ``pydantic`` —
already an ``aica-api`` dependency — is available; no new dependency is
added anywhere):

    cd app/api && uv run python ../../scripts/promote_seeds.py

Writes exactly 5 files to ``proposal_contracts/seeds/*.json``. These are
COMMITTED artifacts — re-run this script only to intentionally regenerate
them (it is idempotent: same generator input + same frozen catalog =>
byte-identical output), then review the diff before committing.

READ-ONLY toward the frozen dataset and the generator workspace: this
script only *reads* ``generation_workspace/worlds.json`` and the frozen
``proposal_contracts/dataset/<id>/`` files; it never writes to either.

Not runtime app code (lives under ``scripts/``, not ``aica_api``), so it may
read the frozen catalog + generator worlds directly by path — but it still
imports only ``aica_api.models.proposal.*``, ``aica_api.config``, stdlib,
and pydantic (never ``mdg``, matching the isolation rule the runtime app
code follows).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parent.parent
_API_SRC = _REPO_ROOT / "app" / "api"
if str(_API_SRC) not in sys.path:
    sys.path.insert(0, str(_API_SRC))

from aica_api.config import settings  # noqa: E402
from aica_api.models.proposal.dataset import CatalogRef, DatasetProvenance  # noqa: E402
from aica_api.models.proposal.enums import (  # noqa: E402
    AgeBand,
    Gender,
    LifecycleStage,
    MotionState,
    NightState,
    OshiMode,
    OshiType,
    RestSpotType,
    RoadType,
    ScheduledEventTiming,
    ScheduledEventType,
    ServiceId,
    TrafficState,
    TriggerPurpose,
)
from aica_api.models.proposal.package_manifest import BilingualLabel  # noqa: E402
from aica_api.models.proposal.world import (  # noqa: E402
    ControlInputs,
    DriverProfile,
    PlayedItem,
    SeedWorld,
    Situation,
    World,
)

DATASET_ID = "soundcharts-grounded-spotify-compatible-demonstration-seed-1042"

GENERATOR_WORLDS_PATH = settings.generation_workspace_dir / "worlds.json"
DATASET_DIR = settings.proposal_dataset_dir / DATASET_ID
SEEDS_DIR = settings.proposal_contracts_dir / "seeds"


# ---------------------------------------------------------------------------
# Loading generator worlds + the frozen catalog reference
# ---------------------------------------------------------------------------


def load_generator_worlds() -> dict[str, dict]:
    """Load ``generation_workspace/worlds.json`` (a JSON list) as a {world_id: world} map."""
    raw = json.loads(GENERATOR_WORLDS_PATH.read_text(encoding="utf-8"))
    return {w["world_id"]: w for w in raw}


def load_catalog_ref() -> CatalogRef:
    """Build the CatalogRef pinning the frozen dataset, from its committed manifest."""
    manifest = json.loads((DATASET_DIR / "dataset_manifest.json").read_text(encoding="utf-8"))
    return DatasetProvenance.from_manifest(manifest).to_catalog_ref()


def load_matrix_version() -> str:
    """Read the frozen purpose/stage matrix's own version string (never hardcoded)."""
    matrix = json.loads(
        (settings.proposal_contracts_dir / "matrix" / "purpose_stage_matrix.v1.json").read_text(
            encoding="utf-8"
        )
    )
    return matrix["matrix_version"]


# ---------------------------------------------------------------------------
# Generator-world -> World field mapping (T014 "complete" the seed)
# ---------------------------------------------------------------------------


def _control_inputs(
    gw: dict,
    *,
    dataset_id: str,
    matrix_version: str,
    trigger_purpose: str | None = None,
    lifecycle_stage: str | None = None,
) -> ControlInputs:
    """Map trigger/environment fields; defaults to the generator world's own trigger."""
    trig = gw["trigger"]
    return ControlInputs(
        trigger_purpose=TriggerPurpose(trigger_purpose or trig["trigger_purpose"]),
        lifecycle_stage=LifecycleStage(lifecycle_stage or trig["lifecycle_stage"]),
        motion_state=MotionState(gw["environment"]["motion_state"]),
        matrix_version=matrix_version,
        dataset_id=dataset_id,
    )


def _situation(
    gw: dict,
    *,
    rest_spot_type: RestSpotType,
    estimated_min_until_rest_spot: int | None = None,
    route_tags: list[str] | None = None,
    destination_tags: list[str] | None = None,
    active_service: str | None = "__from_generator__",
) -> Situation:
    """Map the 11 core-scene fields + the 4 additional-proposed scene fields.

    ``route_tags``/``destination_tags`` default to the generator world's own
    (usually uninteresting) tags; a seed may override them to be
    "characteristic" (seed 3). ``active_service`` defaults to the generator
    world's own selected service; pass ``None`` explicitly to mean "no active
    service" for a seed.
    """
    env = gw["environment"]
    passengers = gw["passengers"]
    driver = gw["driver"]

    if active_service == "__from_generator__":
        svc_id = gw["selected_service"]["selected_service_id"]
        active_service_value: str | None = svc_id
    else:
        active_service_value = active_service

    return Situation(
        drowsiness_level=driver["drowsiness_level"],
        fatigue_level=driver["fatigue_level"],
        traffic_state=TrafficState(env["traffic_state"]),
        road_type=RoadType(env["road_type"]),
        night_state=NightState(env["night_state"]),
        monotony_level=env["monotony_level"],
        route_tags=list(route_tags) if route_tags is not None else list(env["route_tags"]),
        destination_tags=(
            list(destination_tags) if destination_tags is not None else list(env["destination_tags"])
        ),
        child_present=passengers["child_present"],
        multiple_passengers=passengers["multiple_passengers"],
        motion_state=MotionState(env["motion_state"]),
        estimated_min_until_rest_spot=estimated_min_until_rest_spot,
        rest_spot_type=rest_spot_type,
        active_service=ServiceId(active_service_value) if active_service_value else None,
        recent_service_rejections=[],
    )


def _history_from_generator(gw: dict) -> dict[str, Any]:
    """Map ``direct_item_history`` into the granular history/preference fields.

    Generator entries carry richer per-track stats than any single World
    field, so this spreads them across the closest-matching fields:
    ``played_items`` (last_played_at) and ``content_proposal_acceptance_rate``/
    ``content_recovery_rate`` (rescaled from the generator's 0-1 fraction to
    the World's 0-100 percent range).
    """
    played_items: list[PlayedItem] = []
    content_proposal_acceptance_rate: dict[str, float] = {}
    content_recovery_rate: dict[str, float] = {}
    for track_id, hist in gw.get("direct_item_history", {}).items():
        played_items.append(PlayedItem(track_id=track_id, last_played_at=hist["last_played_at"]))
        content_proposal_acceptance_rate[track_id] = hist["acceptance_rate"] * 100
        content_recovery_rate[track_id] = hist["recovery_rate"] * 100
    return dict(
        played_items=played_items,
        content_proposal_acceptance_rate=content_proposal_acceptance_rate,
        content_recovery_rate=content_recovery_rate,
    )


def _driver_profile(
    gw: dict,
    *,
    gender: Gender = Gender.unspecified,
    hobby_interest_tags: list[str] | None = None,
    scheduled_event_type: ScheduledEventType | None = None,
    scheduled_event_timing: ScheduledEventTiming | None = None,
    scheduled_event_tags: list[str] | None = None,
    multiple_passengers_override: bool | None = None,
) -> DriverProfile:
    """Map ``upro`` + ``driver.age_band`` + history; complete the rest via model defaults.

    Fields the generator schema has no equivalent for at all (``gender``,
    ``hobby_interest_tags``, the schedule-promotion triple, the usage/recency
    maps, granular-operation lists, ...) rely on ``DriverProfile``'s own field
    defaults ({}/[]/None) — per T014's "COMPLETE every field, relying on the
    model's defaults for what the generator doesn't cover".
    """
    upro = gw["upro"]
    history = _history_from_generator(gw)
    return DriverProfile(
        oshi_registered=upro["oshi_registered"],
        oshi_mode=OshiMode(upro["oshi_mode"]),
        oshi_id=upro["oshi_id"],
        oshi_type=OshiType(upro["oshi_type"]) if upro.get("oshi_type") else None,
        oshi_tags=list(upro.get("oshi_tags", [])),
        age_band=AgeBand(gw["driver"]["age_band"]),
        gender=gender,
        hobby_interest_tags=list(hobby_interest_tags) if hobby_interest_tags else [],
        scheduled_event_type=scheduled_event_type,
        scheduled_event_timing=scheduled_event_timing,
        scheduled_event_tags=list(scheduled_event_tags) if scheduled_event_tags else [],
        **history,
    )


def build_seed_world(
    generator_worlds: dict[str, dict],
    catalog_ref: CatalogRef,
    matrix_version: str,
    *,
    seed_id: str,
    label: dict[str, str],
    description: dict[str, str],
    generator_world_id: str,
    trigger_purpose: str | None = None,
    lifecycle_stage: str | None = None,
    situation_kwargs: dict[str, Any] | None = None,
    profile_kwargs: dict[str, Any] | None = None,
) -> SeedWorld:
    """Build one complete, valid SeedWorld from a named generator world."""
    gw = generator_worlds[generator_world_id]
    control_inputs = _control_inputs(
        gw,
        dataset_id=catalog_ref.dataset_id,
        matrix_version=matrix_version,
        trigger_purpose=trigger_purpose,
        lifecycle_stage=lifecycle_stage,
    )
    situation = _situation(gw, **(situation_kwargs or {}))
    driver_profile = _driver_profile(gw, **(profile_kwargs or {}))
    world = World(
        control_inputs=control_inputs,
        situation=situation,
        driver_profile=driver_profile,
        catalog_ref=catalog_ref,
    )
    return SeedWorld(
        seed_id=seed_id,
        label=BilingualLabel(**label),
        description=BilingualLabel(**description),
        world=world,
    )


# ---------------------------------------------------------------------------
# The 5 representative base seeds (milestones §5)
# ---------------------------------------------------------------------------


def build_all_seeds(
    generator_worlds: dict[str, dict], catalog_ref: CatalogRef, matrix_version: str
) -> list[SeedWorld]:
    seeds: list[SeedWorld] = []

    # 1. "Night highway, rest nearby, oshi on"
    seeds.append(
        build_seed_world(
            generator_worlds,
            catalog_ref,
            matrix_version,
            seed_id="seed-night-highway-oshi",
            label={"ja": "夜間高速、休憩地点近く、推し ON", "en": "Night highway, rest nearby, oshi on"},
            description={
                "ja": "夜間の高速道路を走行中、眠気と疲労が高く、近くに休憩スポットがあり、推し（お気に入りアーティスト）機能が有効な状態。",
                "en": (
                    "Driving a congested night highway with high drowsiness and fatigue, a "
                    "rest spot nearby, and the driver's oshi (favorite-artist) personalization "
                    "enabled."
                ),
            },
            generator_world_id="world-night-highway-high-drowsiness",
            trigger_purpose="rest_recommended",
            lifecycle_stage="before_rest_until_stop",
            situation_kwargs=dict(
                rest_spot_type=RestSpotType.sa_pa,
                estimated_min_until_rest_spot=8,
                active_service=None,
            ),
        )
    )

    # 2. "Ordinary daytime route, low risk"
    seeds.append(
        build_seed_world(
            generator_worlds,
            catalog_ref,
            matrix_version,
            seed_id="seed-daytime-ordinary",
            label={"ja": "通常の日中ルート、低リスク", "en": "Ordinary daytime route, low risk"},
            description={
                "ja": "日中の空いた高速道路を走行中、眠気・疲労・単調さがいずれも低い、低リスクな基準状態。",
                "en": (
                    "A daytime commute on a clear highway with low drowsiness, fatigue, and "
                    "monotony — a low-risk baseline scene."
                ),
            },
            generator_world_id="world-daytime-commute",
            situation_kwargs=dict(
                rest_spot_type=RestSpotType.unknown,
                estimated_min_until_rest_spot=None,
                active_service=None,
            ),
            profile_kwargs=dict(hobby_interest_tags=["driving", "music"]),
        )
    )

    # 3. "Characteristic route and event destination"
    seeds.append(
        build_seed_world(
            generator_worlds,
            catalog_ref,
            matrix_version,
            seed_id="seed-characteristic-route-event",
            label={
                "ja": "特徴的なルートとイベント目的地",
                "en": "Characteristic route and event destination",
            },
            description={
                "ja": "景観の良い山道を走行し、目的地はオシ関連の会場でのコンサート。イベントが近日中に予定されている。",
                "en": (
                    "A scenic mountain route heading to an oshi-related event venue, with a "
                    "concert scheduled soon."
                ),
            },
            generator_world_id="world-mountain-road",
            trigger_purpose="route_music",
            situation_kwargs=dict(
                rest_spot_type=RestSpotType.unknown,
                estimated_min_until_rest_spot=None,
                route_tags=["mountain", "scenic_byway"],
                destination_tags=["oshi_venue", "event_hall"],
            ),
            profile_kwargs=dict(
                scheduled_event_type=ScheduledEventType.concert,
                scheduled_event_timing=ScheduledEventTiming.soon,
                scheduled_event_tags=["oshi_concert"],
            ),
        )
    )

    # 4. "Multiple passengers with child present"
    seeds.append(
        build_seed_world(
            generator_worlds,
            catalog_ref,
            matrix_version,
            seed_id="seed-multiple-passengers-child",
            label={
                "ja": "子供同乗、複数乗員",
                "en": "Multiple passengers with child present",
            },
            description={
                "ja": "子供が同乗しており、他にも複数の乗員がいる状態で走行中。",
                "en": "Driving with a child present and multiple other passengers on board.",
            },
            generator_world_id="world-child-present",
            trigger_purpose="child_passenger_experience",
            lifecycle_stage="active_driving_content",
            situation_kwargs=dict(
                rest_spot_type=RestSpotType.unknown,
                estimated_min_until_rest_spot=None,
            ),
        )
    )
    # world-child-present has multiple_passengers=False in the generator data;
    # this seed needs both True — override after construction (Situation is
    # immutable-by-convention but not frozen, so a plain field set is fine;
    # re-validate via model_validate to be safe against future frozen=True).
    idx = len(seeds) - 1
    seeds[idx] = SeedWorld(
        seed_id=seeds[idx].seed_id,
        label=seeds[idx].label,
        description=seeds[idx].description,
        world=World(
            control_inputs=seeds[idx].world.control_inputs,
            situation=Situation(
                **{
                    **seeds[idx].world.situation.model_dump(mode="json"),
                    "multiple_passengers": True,
                }
            ),
            driver_profile=seeds[idx].world.driver_profile,
            catalog_ref=seeds[idx].world.catalog_ref,
        ),
    )

    # 5. "Upcoming synthetic live/oshi event"
    seeds.append(
        build_seed_world(
            generator_worlds,
            catalog_ref,
            matrix_version,
            seed_id="seed-upcoming-oshi-live-event",
            label={
                "ja": "近日開催の推しライブ／イベント（合成）",
                "en": "Upcoming synthetic live/oshi event",
            },
            description={
                "ja": "推し機能が有効な状態で、近日中に推し関連のライブイベントが予定されている。",
                "en": (
                    "Oshi personalization is enabled, with an oshi-related live event scheduled "
                    "soon."
                ),
            },
            generator_world_id="world-oshi-enabled",
            situation_kwargs=dict(
                rest_spot_type=RestSpotType.unknown,
                estimated_min_until_rest_spot=None,
            ),
            profile_kwargs=dict(
                scheduled_event_type=ScheduledEventType.live_show,
                scheduled_event_timing=ScheduledEventTiming.soon,
                scheduled_event_tags=["live_show", "oshi"],
            ),
        )
    )

    return seeds


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def write_seed(seed: SeedWorld, seeds_dir: Path) -> Path:
    seeds_dir.mkdir(parents=True, exist_ok=True)
    path = seeds_dir / f"{seed.seed_id}.json"
    payload = seed.model_dump(mode="json")
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return path


def main() -> None:
    generator_worlds = load_generator_worlds()
    catalog_ref = load_catalog_ref()
    matrix_version = load_matrix_version()

    seeds = build_all_seeds(generator_worlds, catalog_ref, matrix_version)
    assert len(seeds) == 5, f"expected exactly 5 representative seeds, built {len(seeds)}"

    for seed in seeds:
        path = write_seed(seed, SEEDS_DIR)
        print(f"wrote {path.relative_to(_REPO_ROOT)}")


if __name__ == "__main__":
    main()
