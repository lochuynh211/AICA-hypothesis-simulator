"""S6 — Freeze: build the dataset manifest + dataset_hash over the frozen catalog.

The frozen catalog is the replay boundary (design §4.9). Freeze:
- asserts the catalog is **label-free** (FR-019): no `recommended`/`best_for_world`/
  `target_rank`/score/label key appears anywhere; else `catalog_generation_failed`;
- computes a stable `dataset_hash` over the canonical catalog JSON; and
- builds a `DatasetManifest` with `generated_at` **supplied externally** (the deterministic
  core forbids wall-clock).
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

from mdg import (
    GENERATOR_VERSION,
    PROMPT_TEMPLATE_VERSION,
    VALIDATION_RULES_VERSION,
)
from mdg.errors import ErrorCode, MdgFatalError
from mdg.models import DatasetManifest

# Keys that must never appear anywhere in a frozen catalog (§11 / FR-019).
_FORBIDDEN_LABEL_KEYS = frozenset({
    "recommended", "best_for_world", "target_rank", "item_fit",
    "score", "label", "rank", "why_fits_cell", "web_evidence",
    "normalized_evidence", "response_coefficient", "normalized_feature_response",
})

_SCHEMA_VERSION = "1.0.0"
_TRACK_REF_VERSION = "1.0.0"
_AUDIO_REF_VERSION = "1.0.0"

_PROVENANCE_NOTE = (
    "Soundcharts-grounded, Spotify-compatible synthetic dataset. Real song/artist "
    "names and verbatim real audio features are retained for reviewer realism; all IDs "
    "are synthetic- and all URLs use .invalid hosts. Not a live Spotify response. "
    "Audio measurements are Spotify-derived via Soundcharts; use is limited to local "
    "internal algorithm review."
)


def _find_forbidden_key(node: Any) -> str | None:
    """Recursively search a JSON-like structure for a forbidden label key."""
    if isinstance(node, dict):
        for key, value in node.items():
            if key in _FORBIDDEN_LABEL_KEYS:
                return key
            found = _find_forbidden_key(value)
            if found:
                return found
    elif isinstance(node, list):
        for item in node:
            found = _find_forbidden_key(item)
            if found:
                return found
    return None


def assert_label_free(catalog: list[dict]) -> None:
    """Raise catalog_generation_failed if any forbidden label/score key is present."""
    found = _find_forbidden_key(catalog)
    if found is not None:
        raise MdgFatalError(
            ErrorCode.catalog_generation_failed,
            f"frozen catalog must be label-free; found forbidden key '{found}' (FR-019)",
        )


def compute_dataset_hash(catalog: list[dict]) -> str:
    """A stable sha256 over the canonical catalog JSON (sorted keys, compact)."""
    canonical = json.dumps(
        catalog, sort_keys=True, ensure_ascii=False, separators=(",", ":")
    )
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def build_manifest(
    catalog: list[dict],
    *,
    seed: int,
    tier: str,
    candidate_source: str,
    generated_at: str,
    build_report_ref: str = "build_report.json",
    dataset_id: str | None = None,
) -> dict[str, Any]:
    """Build and validate the DatasetManifest dict for a frozen catalog."""
    assert_label_free(catalog)
    if dataset_id is None:
        dataset_id = f"soundcharts-grounded-spotify-compatible-{tier}-seed-{seed}"

    manifest = DatasetManifest(
        dataset_id=dataset_id,
        dataset_kind="soundcharts_grounded_spotify_compatible",
        schema_version=_SCHEMA_VERSION,
        spotify_track_reference_version=_TRACK_REF_VERSION,
        spotify_audio_features_reference_version=_AUDIO_REF_VERSION,
        generator_version=GENERATOR_VERSION,
        prompt_template_version=PROMPT_TEMPLATE_VERSION,
        validation_rules_version=VALIDATION_RULES_VERSION,
        random_seed=seed,
        generated_at=generated_at,
        synthetic_only=False,
        dataset_hash=compute_dataset_hash(catalog),
        provenance_note=_PROVENANCE_NOTE,
        candidate_source=candidate_source,  # type: ignore[arg-type]
        tier=tier,  # type: ignore[arg-type]
        build_report_ref=build_report_ref,
    )
    return manifest.model_dump()
