"""Production runner for compiled semantic Combined-catalog cases."""

from __future__ import annotations

import copy
from contextlib import contextmanager
import hashlib
import json
import os
import subprocess
from collections.abc import Mapping
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .evaluator import EVALUATOR_VERSION

if TYPE_CHECKING:
    from fastapi.testclient import TestClient


_BASE_SEED_ID = "seed-night-highway-oshi"
_CODE_REPO_ROOT = Path(__file__).resolve().parents[2]
_REPORT_AUDIO_FEATURES = (
    "acousticness",
    "danceability",
    "duration_ms",
    "energy",
    "instrumentalness",
    "key",
    "liveness",
    "loudness",
    "mode",
    "speechiness",
    "tempo",
    "time_signature",
    "valence",
)
_REPO_ENV_PATHS = {
    "AICA_PACKAGES_DIR": Path("packages"),
    "AICA_SCENARIOS_DIR": Path("scenarios"),
    "AICA_ROUTES_DIR": Path("routes"),
    "AICA_PROPOSAL_CONTRACTS_DIR": Path("proposal_contracts"),
    "AICA_PROPOSAL_DATASET_DIR": Path("proposal_contracts/dataset"),
    "AICA_PROPOSAL_SEEDS_DIR": Path("proposal_contracts/seeds"),
    "AICA_PROPOSAL_PRESETS_DIR": Path("proposal_contracts/presets"),
}


def _load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot load semantic runner input {path}: {exc}") from exc


def _mapping(value: Any, *, where: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{where} must be an object")
    return value


def _sha256_file(path: Path) -> str:
    try:
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError as exc:
        raise ValueError(f"cannot hash semantic runner input {path}: {exc}") from exc
    return f"sha256:{digest}"


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _sha256_value(value: Any) -> str:
    return f"sha256:{hashlib.sha256(_canonical_bytes(value)).hexdigest()}"


def _normalize_response(value: Any, *, event_record: bool = False) -> Any:
    """Remove only response fields declared volatile by the audit contract."""

    if isinstance(value, Mapping):
        normalized: dict[str, Any] = {}
        for key, item in value.items():
            if key in {"run_id", "created_at", "opportunity_id"}:
                continue
            if event_record and key == "at":
                continue
            if key == "events" and isinstance(item, list):
                normalized[key] = [
                    _normalize_response(event, event_record=True) for event in item
                ]
            else:
                normalized[key] = _normalize_response(item)
        return normalized
    if isinstance(value, list):
        return [_normalize_response(item) for item in value]
    return copy.deepcopy(value)


def _git_commit() -> str:
    try:
        return subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=_CODE_REPO_ROOT,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError) as exc:
        raise ValueError(f"cannot resolve semantic runner git commit: {exc}") from exc


@contextmanager
def _configured_repo(repo_root: Path):
    previous = {key: os.environ.get(key) for key in _REPO_ENV_PATHS}
    try:
        for key, relative in _REPO_ENV_PATHS.items():
            os.environ[key] = str((repo_root / relative).resolve())
        yield
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def _resolve_driver_profile(profile_ref: str, repo_root: Path) -> dict[str, Any]:
    contracts = repo_root / "proposal_contracts"
    if profile_ref.startswith("profile-"):
        record = _mapping(
            _load_json(contracts / "profiles" / f"{profile_ref}.json"),
            where=f"profile {profile_ref}",
        )
        profile = _mapping(
            record.get("profile"),
            where=f"profile {profile_ref}.profile",
        )
    elif profile_ref.startswith("preset-"):
        record = _mapping(
            _load_json(contracts / "presets" / f"{profile_ref}.json"),
            where=f"preset {profile_ref}",
        )
        world = _mapping(
            record.get("world"),
            where=f"preset {profile_ref}.world",
        )
        profile = _mapping(
            world.get("driver_profile"),
            where=f"preset {profile_ref}.world.driver_profile",
        )
    else:
        raise ValueError(
            f"unsupported persona.profile_ref {profile_ref!r}; "
            "expected a profile-* or preset-* reference"
        )
    return copy.deepcopy(dict(profile))


def build_quickview_body(
    case: Mapping[str, Any],
    repo_root: Path,
) -> dict[str, Any]:
    """Compile one committed case into the exact merged-quickview request."""

    root = Path(repo_root)
    journey = _mapping(case.get("journey"), where="case.journey")
    fixed = _mapping(
        journey.get("fixed_overrides", {}),
        where="case.journey.fixed_overrides",
    )
    defaults = _mapping(
        case.get("algorithm_defaults"),
        where="case.algorithm_defaults",
    )
    persona = _mapping(case.get("persona"), where="case.persona")

    profile_ref = persona.get("profile_ref")
    if not isinstance(profile_ref, str) or not profile_ref:
        raise ValueError("case.persona.profile_ref must be a non-empty string")

    seed_record = _mapping(
        _load_json(
            root
            / "proposal_contracts"
            / "seeds"
            / f"{_BASE_SEED_ID}.json"
        ),
        where=f"seed {_BASE_SEED_ID}",
    )
    world = copy.deepcopy(
        dict(_mapping(seed_record.get("world"), where=f"seed {_BASE_SEED_ID}.world"))
    )
    world["driver_profile"] = _resolve_driver_profile(profile_ref, root)

    situation = copy.deepcopy(
        dict(_mapping(world.get("situation"), where="seed world.situation"))
    )
    context_overrides: dict[str, Any] = {}
    if "is_night" in fixed:
        is_night = bool(fixed["is_night"])
        context_overrides["is_night"] = is_night
        situation["night_state"] = "night" if is_night else "day"
    if "child_passenger" in fixed:
        child_present = bool(fixed["child_passenger"])
        context_overrides["child_passenger"] = child_present
        situation["child_present"] = child_present
    for key in ("route_tags", "destination_tags", "multiple_passengers"):
        if key in fixed:
            situation[key] = copy.deepcopy(fixed[key])
    world["situation"] = situation

    initial_state: dict[str, Any] = {}
    if "initial_drowsiness" in fixed:
        initial_state["drowsiness_level"] = fixed["initial_drowsiness"]
    if "initial_fatigue" in fixed:
        initial_state["fatigue_level"] = fixed["initial_fatigue"]

    scenario_id = journey.get("scenario_ref")
    if not isinstance(scenario_id, str) or not scenario_id:
        raise ValueError("case.journey.scenario_ref must be a non-empty string")
    scenario = _mapping(
        _load_json(root / "scenarios" / f"{scenario_id}.json"),
        where=f"scenario {scenario_id}",
    )
    speed_profile = _mapping(
        scenario.get("speed_profile", {}),
        where=f"scenario {scenario_id}.speed_profile",
    )

    return {
        "package_id": defaults.get("trigger"),
        "scenario_id": scenario_id,
        "route_preset_id": journey.get("route_preset_ref"),
        "run_seed": journey.get("seed"),
        "mountain_range_km": copy.deepcopy(fixed.get("mountain_range_km")),
        "jam_range_km": copy.deepcopy(fixed.get("jam_range_km")),
        "jam_speed_kph": speed_profile.get("traffic_jam_kph", 15.0),
        "hyperparameter_overrides": {},
        "rest_option_id": None,
        "context_overrides": context_overrides or None,
        "initial_state": initial_state or None,
        "profiles": None,
        "tick_seconds": journey.get("tick_seconds"),
        "world": world,
        "service_package_id": defaults.get("service"),
        "content_package_id": defaults.get("content"),
        "run_seed_proposal": str(journey.get("seed")),
        "service_parameters": {},
        "service_hyperparameters": {},
        "content_parameters": {},
        "content_hyperparameters": {},
    }


def load_track_index(repo_root: Path) -> dict[str, dict[str, Any]]:
    """Load report-facing metadata keyed by the frozen catalog track ID."""

    root = Path(repo_root)
    seed = _mapping(
        _load_json(
            root
            / "proposal_contracts"
            / "seeds"
            / f"{_BASE_SEED_ID}.json"
        ),
        where=f"seed {_BASE_SEED_ID}",
    )
    world = _mapping(seed.get("world"), where=f"seed {_BASE_SEED_ID}.world")
    catalog_ref = _mapping(
        world.get("catalog_ref"),
        where=f"seed {_BASE_SEED_ID}.world.catalog_ref",
    )
    dataset_id = catalog_ref.get("dataset_id")
    if not isinstance(dataset_id, str) or not dataset_id:
        raise ValueError(f"seed {_BASE_SEED_ID} has no dataset_id")

    dataset_dir = root / "proposal_contracts" / "dataset" / dataset_id
    catalog = _load_json(dataset_dir / "catalog.json")
    if not isinstance(catalog, list):
        raise ValueError(f"dataset {dataset_id}.catalog must be a list")
    affinity = _mapping(
        _load_json(dataset_dir / "genre_affinity_v1.json"),
        where=f"dataset {dataset_id}.genre_affinity_v1",
    )
    artist_genres = _mapping(
        affinity.get("artist_genres", {}),
        where=f"dataset {dataset_id}.genre_affinity_v1.artist_genres",
    )

    index: dict[str, dict[str, Any]] = {}
    for position, value in enumerate(catalog):
        song = _mapping(value, where=f"dataset {dataset_id}.catalog[{position}]")
        track = _mapping(
            song.get("spotify_track"),
            where=f"dataset {dataset_id}.catalog[{position}].spotify_track",
        )
        track_id = track.get("id")
        if not isinstance(track_id, str) or not track_id:
            raise ValueError(f"dataset {dataset_id}.catalog[{position}] has no track id")
        if track_id in index:
            raise ValueError(f"dataset {dataset_id} contains duplicate track id {track_id!r}")

        artist_values = track.get("artists")
        if not isinstance(artist_values, list):
            raise ValueError(f"catalog track {track_id!r} has no artist list")
        artists = [
            _mapping(artist, where=f"catalog track {track_id!r}.artists")
            for artist in artist_values
        ]
        artist_ids = [
            artist_id
            for artist in artists
            if isinstance((artist_id := artist.get("id")), str)
        ]
        artist_names = [
            artist_name
            for artist in artists
            if isinstance((artist_name := artist.get("name")), str)
        ]
        genres = sorted(
            {
                genre
                for artist_id in artist_ids
                for genre in (
                    artist_genres.get(artist_id)
                    if isinstance(artist_genres.get(artist_id), list)
                    else []
                )
                if isinstance(genre, str)
            }
        )

        album = _mapping(
            track.get("album", {}),
            where=f"catalog track {track_id!r}.album",
        )
        release_date = album.get("release_date")
        release_year = (
            int(release_date[:4])
            if isinstance(release_date, str)
            and len(release_date) >= 4
            and release_date[:4].isdigit()
            else None
        )
        raw_audio = _mapping(
            song.get("spotify_audio_features"),
            where=f"catalog track {track_id!r}.spotify_audio_features",
        )
        audio_features = {
            key: copy.deepcopy(raw_audio[key])
            for key in _REPORT_AUDIO_FEATURES
            if key in raw_audio
        }
        index[track_id] = {
            "track_id": track_id,
            "title": track.get("name"),
            "artist_ids": artist_ids,
            "artist_names": artist_names,
            "realized_genres": genres,
            "release_year": release_year,
            "audio_features": audio_features,
        }
    return index


def _content_track_ids(value: Any) -> tuple[list[str], list[str]]:
    returned: list[str] = []
    excluded: list[str] = []

    def append_ids(rows: Any, destination: list[str]) -> None:
        if not isinstance(rows, list):
            return
        for row in rows:
            if not isinstance(row, Mapping):
                continue
            track_id = row.get("item_id")
            if isinstance(track_id, str) and track_id and track_id not in destination:
                destination.append(track_id)

    def visit(node: Any) -> None:
        if isinstance(node, Mapping):
            if node.get("step") == "content":
                output = node.get("output")
                if isinstance(output, Mapping):
                    append_ids(output.get("ordered_items"), returned)
                    append_ids(output.get("excluded_items"), excluded)
            for child in node.values():
                visit(child)
        elif isinstance(node, list):
            for child in node:
                visit(child)

    visit(value)
    return returned, excluded


def _join_content_tracks(response: dict[str, Any], repo_root: Path) -> None:
    returned_ids, excluded_ids = _content_track_ids(response)
    referenced_ids = list(dict.fromkeys([*returned_ids, *excluded_ids]))
    if not referenced_ids:
        return

    frozen_index = load_track_index(repo_root)
    response["track_index"] = {
        track_id: copy.deepcopy(frozen_index[track_id])
        for track_id in referenced_ids
        if track_id in frozen_index
    }
    missing_returned = sorted(
        track_id for track_id in returned_ids if track_id not in frozen_index
    )
    if missing_returned:
        response["error"] = {
            "category": "structural_execution_error",
            "code": "missing_catalog_track",
            "message": "Returned track IDs are absent from the frozen catalog.",
            "track_ids": missing_returned,
        }


# Non-anchor re-fires keep their fire-control facts but drop the ~0.3 MB
# per-candidate proposal evidence: the anchor fire is what every check reads,
# and retaining all of them is what made the committed results file 110 MB.
_FIRE_SUMMARY_KEYS = ("category", "strength", "tick", "time_min", "criteria")


def _summarize_trigger_evidence(response: Mapping[str, Any]) -> dict[str, Any]:
    """Journey-level trigger facts every case needs — including quiet ones.

    Without this a no-fire control records nothing but ``fire_count: 0``, so a
    knife-edge miss (peak 0.6973 against a 0.7000 threshold) is indistinguishable
    from a genuinely calm drive, and a case whose score crossed the threshold but
    was suppressed cannot explain itself.
    """
    series = response.get("score_series")
    scores = [
        row.get("score")
        for row in (series if isinstance(series, list) else [])
        if isinstance(row, Mapping) and _is_number(row.get("score"))
    ]
    threshold = response.get("threshold")
    peak = response.get("peak_score")
    if not _is_number(peak):
        peak = max(scores) if scores else None
    segments = response.get("segments")
    journey_end_min = max(
        (
            segment.get("to_min")
            for segment in (segments if isinstance(segments, list) else [])
            if isinstance(segment, Mapping) and _is_number(segment.get("to_min"))
        ),
        default=None,
    )
    over = [index for index, score in enumerate(scores) if _is_number(threshold) and score >= threshold]
    monotony_series = response.get("monotony_series")
    monotony_scores = [
        row.get("score") if isinstance(row, Mapping) else row
        for row in (monotony_series if isinstance(monotony_series, list) else [])
    ]
    monotony_scores = [value for value in monotony_scores if _is_number(value)]
    monotony_threshold = response.get("monotony_threshold")
    monotony_peak = max(monotony_scores) if monotony_scores else None
    return {
        "peak_score": peak,
        "threshold": threshold,
        "margin_to_threshold": (
            peak - threshold if _is_number(peak) and _is_number(threshold) else None
        ),
        "monotony_peak_score": monotony_peak,
        "monotony_margin_to_threshold": (
            monotony_peak - monotony_threshold
            if _is_number(monotony_peak) and _is_number(monotony_threshold)
            else None
        ),
        "monotony_threshold": monotony_threshold,
        "ticks_evaluated": len(series) if isinstance(series, list) else 0,
        "ticks_at_or_over_threshold": len(over),
        "first_tick_over_threshold": over[0] if over else None,
        "journey_end_min": journey_end_min,
        "completed_min": response.get("completed_min"),
        "rest_spot_count": len(response.get("rest_spots") or []),
        "fire_control": copy.deepcopy(response.get("fire_control")),
        # Full per-tick trajectories so the report can DRAW the run the way the
        # Combined screen shows it, instead of only stating the outcome.
        "rest_score_series": [round(value, 5) for value in scores],
        "monotony_score_series": [round(value, 5) for value in monotony_scores],
        "tick_minutes": (
            round(journey_end_min / len(scores), 2)
            if journey_end_min and scores
            else None
        ),
        "segments": [
            {
                "type": segment.get("type"),
                "from_min": segment.get("from_min"),
                "to_min": segment.get("to_min"),
            }
            for segment in (segments if isinstance(segments, list) else [])
            if isinstance(segment, Mapping)
        ],
    }


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _bound_fire_evidence(response: dict[str, Any]) -> None:
    """Keep full proposal evidence on the first fire of EACH category.

    A case declares which category it evaluates, so its anchor is not always
    ``fires[0]``: TC-E06 fires monotony first and rest second, and rest is the
    anchor. Keeping one fire per category preserves every anchor while still
    dropping the repeat-proposal payloads that dominated the file size.
    """
    fires = response.get("fires")
    if not isinstance(fires, list):
        return
    anchors: set[Any] = set()
    for index, fire in enumerate(fires):
        if not isinstance(fire, dict):
            continue
        category = fire.get("category")
        if category not in anchors:
            anchors.add(category)
            continue
        proposal = fire.get("proposal")
        if isinstance(proposal, Mapping):
            fire["proposal"] = {
                "evidence_omitted": (
                    "Re-fire after cooldown expiry; full proposal evidence is retained "
                    "on the anchor fire only."
                ),
                "status": proposal.get("status"),
                "service_package_id": proposal.get("service_package_id"),
                "content_package_id": proposal.get("content_package_id"),
            }


def run_case(
    client: "TestClient",
    case: Mapping[str, Any],
    repo_root: Path,
) -> dict[str, Any]:
    """Execute one compiled case through ``POST /api/merged-runs/quickview``."""

    root = Path(repo_root)
    body = build_quickview_body(case, root)
    with _configured_repo(root):
        http_response = client.post("/api/merged-runs/quickview", json=body)
    response_value = http_response.json()
    if not isinstance(response_value, Mapping):
        response: dict[str, Any] = {
            "fires": [],
            "error": {
                "category": "invalid_http_response",
                "message": "Merged quickview returned a non-object JSON response.",
            },
        }
    else:
        response = copy.deepcopy(dict(response_value))
    _join_content_tracks(response, root)

    package_ids = {
        "trigger": body["package_id"],
        "service": body["service_package_id"],
        "content": body["content_package_id"],
    }
    package_hashes = {
        stage: _sha256_file(root / "packages" / package_id / "package.json")
        for stage, package_id in package_ids.items()
    }
    catalog = _mapping(
        _load_json(root / "scripts" / "semantic_combined_catalog.json"),
        where="semantic source catalog",
    )
    world = _mapping(body["world"], where="quickview body.world")
    catalog_ref = _mapping(
        world.get("catalog_ref"),
        where="quickview body.world.catalog_ref",
    )
    dataset_id = catalog_ref.get("dataset_id")
    if not isinstance(dataset_id, str) or not dataset_id:
        raise ValueError("quickview body.world.catalog_ref.dataset_id is missing")
    canonical_request = copy.deepcopy(body)
    # Hash the FULL normalized response (the reproducibility oracle) before
    # bounding the payload, so trimming never weakens drift detection.
    normalized_response = _normalize_response(response)
    normalized_response_sha256 = _sha256_value(normalized_response)
    trigger_evidence = _summarize_trigger_evidence(response)
    _bound_fire_evidence(response)
    return {
        "case_id": case.get("case_id"),
        "display_id": case.get("display_id"),
        "response": response,
        "trigger_evidence": trigger_evidence,
        "provenance": {
            "git_commit": _git_commit(),
            "catalog_version": catalog.get("catalog_version"),
            "case_schema_version": case.get("schema_version"),
            "evaluator_version": EVALUATOR_VERSION,
            "package_ids": package_ids,
            "package_manifest_sha256": package_hashes,
            "dataset_sha256": _sha256_file(
                root
                / "proposal_contracts"
                / "dataset"
                / dataset_id
                / "catalog.json"
            ),
            "matrix_sha256": _sha256_file(
                root
                / "proposal_contracts"
                / "matrix"
                / "purpose_stage_matrix.v1.json"
            ),
        },
        "audit": {
            "http_status": http_response.status_code,
            # ``request`` and ``canonical_request`` were byte-identical copies,
            # and ``normalized_response`` duplicated ``response`` in full. The
            # sha256 is what reproducibility actually needs.
            "canonical_request": canonical_request,
            "canonical_request_sha256": _sha256_value(canonical_request),
            "normalized_response_sha256": normalized_response_sha256,
        },
    }


def run_catalog(
    repo_root: Path,
    case_ids: set[str] | None = None,
) -> dict[str, Any]:
    """Run compiled semantic cases sequentially in stable display-ID order."""

    root = Path(repo_root)
    catalog = _mapping(
        _load_json(root / "scripts" / "semantic_combined_catalog.json"),
        where="semantic source catalog",
    )
    cases = [
        _mapping(_load_json(path), where=f"compiled case {path.name}")
        for path in (
            root / "combined_contracts" / "test_cases"
        ).glob("case-tc-*.json")
    ]
    cases.sort(key=lambda case: str(case.get("display_id") or ""))

    requested = set(case_ids) if case_ids is not None else None
    if requested is not None:
        known_ids = {
            identifier
            for case in cases
            for identifier in (case.get("case_id"), case.get("display_id"))
            if isinstance(identifier, str)
        }
        unknown = sorted(requested - known_ids)
        if unknown:
            raise ValueError(
                "unknown semantic case ID(s): " + ", ".join(unknown)
            )
        cases = [
            case
            for case in cases
            if case.get("case_id") in requested
            or case.get("display_id") in requested
        ]

    from fastapi.testclient import TestClient

    from aica_api.main import app

    with TestClient(app) as client:
        case_results = [run_case(client, case, root) for case in cases]

    return {
        "catalog_id": catalog.get("catalog_id"),
        "catalog_version": catalog.get("catalog_version"),
        "case_schema_version": catalog.get("case_schema_version"),
        "evaluator_version": EVALUATOR_VERSION,
        "git_commit": _git_commit(),
        "case_results": case_results,
    }


__all__ = [
    "build_quickview_body",
    "load_track_index",
    "run_case",
    "run_catalog",
]
