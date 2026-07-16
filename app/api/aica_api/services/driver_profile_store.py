"""Driver-profile store (T015/T016) — P3 Editable World (feature 014).

Driver profiles are a first-class, reusable store (research.md §R4): a small
set of **built-in**, named profiles ship read-only under
``proposal_contracts/profiles/`` (mirrors the base-seed pattern in
``world_seed_store.py``), and reviewers can save/reuse/delete their own
**user** profiles, persisted with the atomic ``file_store`` writer under
``settings.proposal_profiles_dir`` (git-ignored — mirrors
``proposal_run_manager``'s per-file atomic-persist + id-minting pattern).

Design constraints (mirrors ``proposal_run_manager``'s discipline):
  - ``profile_id`` generation (timestamp + random hex) happens ONLY in
    ``_make_profile_id`` — the sole place randomness/clock is allowed in this
    module, and only ever invoked for a NEW user profile (``save_profile``).
  - Built-in profiles are loaded once at construction (``_load_builtins``)
    and never written back — this store's write path
    (``save_profile``/``delete_profile``) only ever touches
    ``profiles_dir`` (the user-profile directory), never ``builtin_dir``.
  - User profiles are read fresh from disk on every ``list_profiles``/
    ``get_profile`` call (mirrors ``proposal_run_manager.list_runs``/
    ``get_run`` re-reading rather than caching), so a save from one store
    instance is visible to any other.
  - Save validates the label + profile via Pydantic; an invalid profile
    raises ``pydantic.ValidationError`` (or ``pydantic.ValidationError``-like
    field-level errors) rather than being silently persisted.
  - Deleting a built-in profile raises ``DriverProfileConflictError`` — the
    router maps this to an HTTP 409 (deleting a user profile that doesn't
    exist raises ``DriverProfileNotFoundError``, mapped to 404).

Isolation (HARD ISOLATION RULE / CLAUDE.md): this module imports only
``aica_api.models.proposal.*``, ``aica_api.config``, ``aica_api.storage.file_store``,
stdlib, and pydantic — never the trigger ``aica_api.models`` package, and
never ``mdg``.

Public API:
  DriverProfileStore(profiles_dir: Path, builtin_dir: Path | None = None)
    .list_profiles()                    -> list[dict]   — {profile_id, label, builtin} summaries
    .list_errors()                      -> list[dict]   — {file, message} for quarantined built-ins
    .get_profile(profile_id)            -> DriverProfileRecord | None
    .save_profile(label, profile)       -> DriverProfileRecord — persists a NEW user profile
    .delete_profile(profile_id)         -> None          — raises on unknown/built-in
"""
from __future__ import annotations

import os
import pathlib
from datetime import datetime, timezone
from typing import Any

from aica_api.config import settings
from aica_api.models.proposal.package_manifest import BilingualLabel
from aica_api.models.proposal.world import DriverProfile, DriverProfileRecord
from aica_api.storage.file_store import read_json, write_json_atomic

__all__ = [
    "DriverProfileNotFoundError",
    "DriverProfileConflictError",
    "DriverProfileStore",
]


class DriverProfileNotFoundError(Exception):
    """Raised when a profile_id has no matching built-in or user profile."""


class DriverProfileConflictError(Exception):
    """Raised when an operation is disallowed on a built-in profile (e.g. delete)."""


def _make_profile_id() -> str:
    """Generate a unique user profile_id: dprof_<YYYYMMDD-HHMMSS>_<6-hex>.

    The ONLY place timestamp/randomness is generated in this module, and only
    ever called for a brand-new user profile (``save_profile``).
    """
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    rand = os.urandom(3).hex()
    return f"dprof_{ts}_{rand}"


def _default_builtin_dir() -> pathlib.Path:
    return settings.proposal_contracts_dir / "profiles"


class DriverProfileStore:
    """Built-in (read-only) + user (read/write) driver-profile store."""

    def __init__(self, profiles_dir: pathlib.Path, builtin_dir: pathlib.Path | None = None) -> None:
        self._profiles_dir = pathlib.Path(profiles_dir)
        self._builtin_dir = pathlib.Path(builtin_dir) if builtin_dir is not None else _default_builtin_dir()
        self._errors: list[dict[str, Any]] = []
        self._builtins: dict[str, DriverProfileRecord] = self._load_builtins(self._builtin_dir)

    # ── Public API ─────────────────────────────────────────────────────────

    def list_profiles(self) -> list[dict[str, Any]]:
        """Return {profile_id, label, builtin} summaries: built-ins then user profiles."""
        summaries = [self._summarize(record) for record in self._builtins.values()]
        summaries.extend(self._summarize(record) for record in self._scan_user_profiles().values())
        return summaries

    def list_errors(self) -> list[dict[str, Any]]:
        """Return {file, message} entries for built-in profile files that failed
        to validate (quarantined — mirrors ``WorldSeedStore.list_errors``/
        ``DatasetCatalogRegistry.list_errors``)."""
        return list(self._errors)

    def get_profile(self, profile_id: str) -> DriverProfileRecord | None:
        """Return the full DriverProfileRecord for profile_id, checking built-ins first."""
        if profile_id in self._builtins:
            return self._builtins[profile_id]
        return self._scan_user_profiles().get(profile_id)

    def save_profile(self, label: dict | BilingualLabel, profile: dict | DriverProfile) -> DriverProfileRecord:
        """Validate and persist a NEW user profile (``builtin=False``).

        Raises:
            pydantic.ValidationError: If *label* or *profile* fails validation
                (field-level messages via ``ValidationError.errors()``).
        """
        validated_label = label if isinstance(label, BilingualLabel) else BilingualLabel.model_validate(label)
        validated_profile = profile if isinstance(profile, DriverProfile) else DriverProfile.model_validate(profile)

        record = DriverProfileRecord(
            profile_id=_make_profile_id(),
            label=validated_label,
            builtin=False,
            profile=validated_profile,
        )
        write_json_atomic(str(self._user_profile_path(record.profile_id)), record.model_dump(mode="json"))
        return record

    def delete_profile(self, profile_id: str) -> None:
        """Delete a user profile.

        Raises:
            DriverProfileConflictError: If profile_id is a built-in profile.
            DriverProfileNotFoundError: If profile_id has no user profile on disk.
        """
        if profile_id in self._builtins:
            raise DriverProfileConflictError(f"Cannot delete built-in driver profile: {profile_id!r}")

        path = self._user_profile_path(profile_id)
        if not path.exists():
            raise DriverProfileNotFoundError(f"Unknown driver profile_id: {profile_id!r}")
        path.unlink()

    # ── Private helpers ────────────────────────────────────────────────────

    @staticmethod
    def _summarize(record: DriverProfileRecord) -> dict[str, Any]:
        return {
            "profile_id": record.profile_id,
            "label": record.label.model_dump(),
            "builtin": record.builtin,
        }

    def _load_builtins(self, builtin_dir: pathlib.Path) -> dict[str, DriverProfileRecord]:
        """Load every ``*.json`` built-in profile file, quarantining (never
        raising for) any file that fails to parse/validate — mirrors
        ``WorldSeedStore._scan``/``DatasetCatalogRegistry._scan``: one
        malformed built-in profile must not crash store construction, and a
        quarantined file is simply absent from ``self._builtins`` (never
        partially exposed) while being recorded in ``self._errors``.
        """
        builtins: dict[str, DriverProfileRecord] = {}
        if not builtin_dir.exists():
            return builtins
        for path in sorted(builtin_dir.glob("*.json")):
            try:
                data = read_json(str(path))
                record = DriverProfileRecord.model_validate(data)
            except Exception as exc:
                self._errors.append({"file": path.name, "message": str(exc)})
                continue
            builtins[record.profile_id] = record
        return builtins

    def _user_profile_path(self, profile_id: str) -> pathlib.Path:
        return self._profiles_dir / f"{profile_id}.json"

    def _scan_user_profiles(self) -> dict[str, DriverProfileRecord]:
        profiles: dict[str, DriverProfileRecord] = {}
        if not self._profiles_dir.exists():
            return profiles
        for path in sorted(self._profiles_dir.glob("*.json")):
            try:
                data = read_json(str(path))
                record = DriverProfileRecord.model_validate(data)
            except Exception:
                continue
            profiles[record.profile_id] = record
        return profiles
