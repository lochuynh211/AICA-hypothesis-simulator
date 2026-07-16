"""Read-only dataset/catalog provenance models — P3 Editable World (feature 014).

Implements ``DatasetProvenance`` and ``CatalogRef`` (tasks T003/T004): identity
and provenance data mirrored from the committed ``dataset_manifest.json`` for
the frozen P2 music dataset (``proposal_contracts/dataset/<dataset_id>/``).

These models are READ-ONLY: both are ``frozen=True`` (immutable after
construction) and expose no edit/mutate method. The dataset/catalog they
describe changes only by re-running the P2 generator — see
``specs/014-proposal-p3-editable-world/research.md`` §R3 ("Catalog is
read-only"). Loading and validating the actual catalog (list[Song]) is the
job of ``services/dataset_catalog_registry.py``, not this module.

Reuses the frozen ``Song`` model from ``song_schema.py`` for catalog entries
elsewhere — it is intentionally NOT redefined here.

Isolation (HARD ISOLATION RULE / CLAUDE.md, enforced by the import-guard
test): this module imports only ``aica_api.models.proposal.*``, stdlib, and
pydantic — never the trigger ``aica_api.models`` package.
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class DatasetVersion(BaseModel):
    """Schema / track / audio-feature reference versions for a dataset.

    Read-only, immutable — mirrors the corresponding ``dataset_manifest.json``
    fields verbatim.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: str
    spotify_track_reference_version: str
    spotify_audio_features_reference_version: str


class DatasetProvenance(BaseModel):
    """Read-only provenance summary for one frozen dataset.

    Mirrors the committed ``dataset_manifest.json`` (P2 Soundcharts-grounded
    dataset). Immutable: no field may be reassigned after construction (raises
    ``pydantic.ValidationError``/``frozen_instance``), and this model exposes
    no edit/mutate method of any kind — the catalog is changed only by
    re-running the P2 generator.

    ``model_config`` uses ``extra="ignore"`` so that manifest fields not
    surfaced here (e.g. ``generated_at``, ``random_seed``,
    ``validation_rules_version``) do not break construction from the raw
    manifest dict — the same forward-compatible posture as the Spotify
    sub-objects in ``song_schema.py``.
    """

    model_config = ConfigDict(extra="ignore", frozen=True)

    dataset_id: str
    dataset_version: DatasetVersion
    dataset_hash: str
    tier: str
    synthetic_only: bool
    provenance_note: str
    generator_version: str

    @classmethod
    def from_manifest(cls, manifest: dict) -> "DatasetProvenance":
        """Construct a DatasetProvenance from a parsed ``dataset_manifest.json`` dict."""
        return cls(
            dataset_id=manifest["dataset_id"],
            dataset_version=DatasetVersion(
                schema_version=manifest["schema_version"],
                spotify_track_reference_version=manifest["spotify_track_reference_version"],
                spotify_audio_features_reference_version=manifest[
                    "spotify_audio_features_reference_version"
                ],
            ),
            dataset_hash=manifest["dataset_hash"],
            tier=manifest["tier"],
            synthetic_only=manifest["synthetic_only"],
            provenance_note=manifest["provenance_note"],
            generator_version=manifest["generator_version"],
        )

    def to_catalog_ref(self) -> "CatalogRef":
        """Return the lightweight ``CatalogRef`` view of this provenance."""
        return CatalogRef(
            dataset_id=self.dataset_id,
            dataset_version=self.dataset_version,
            dataset_hash=self.dataset_hash,
        )


class CatalogRef(BaseModel):
    """Lightweight, immutable reference to a frozen dataset.

    ``dataset_id`` + ``dataset_version`` + ``dataset_hash`` — enough to pin
    exactly which frozen catalog a ``World`` (a later P3 task) is drawing
    songs from, without embedding the full provenance note. Read-only:
    ``frozen=True``, no edit/mutate method.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    dataset_id: str
    dataset_version: DatasetVersion
    dataset_hash: str
