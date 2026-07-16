"""S5 — Validator: enforce the frozen `Song` schema + data-spec §17 rule families.

`validate_song(song)` runs the frozen `Song` model (imported from aica_api — never
redefined) and translates any failure into a typed `SongViolation` carrying:
- `code`     — the taxonomy code for reporting, and
- `category` — a repair hint for the S5 repair loop
               (`identity` / `url` / `schema` / `flag`).

`validate_coverage(...)` enforces the §17.6 coverage contract at freeze time and raises
`MdgFatalError(coverage_contract_failed)` when a required cell/quota is unmet.

Both are read-only; repair (mdg/repair.py) is the only stage that mutates a record.
"""
from __future__ import annotations

from pydantic import ValidationError

from aica_api.models.proposal.song_schema import Song

from mdg.errors import ErrorCode, MdgFatalError


class SongViolation(Exception):
    """A single-song validation failure, repairable by the S5 loop.

    Not an ``MdgFatalError``: a violation is a candidate for deterministic repair; only
    after 2 failed repairs does the loop escalate to ``catalog_generation_failed``.
    """

    def __init__(self, code: ErrorCode, category: str, detail: str = "") -> None:
        self.code = code
        self.category = category
        self.detail = detail
        super().__init__(f"[{code.value}/{category}] {detail}")


def _classify(exc: ValidationError) -> SongViolation:
    """Map a Pydantic ValidationError to a typed, categorised SongViolation."""
    messages = [str(err.get("msg", "")) for err in exc.errors()]
    locs = [tuple(err.get("loc", ())) for err in exc.errors()]
    blob = " ".join(messages)

    if "Cross-object identity mismatch" in blob:
        return SongViolation(
            ErrorCode.cross_object_identity_mismatch, "identity", blob
        )
    if "must start with 'synthetic-'" in blob:
        return SongViolation(
            ErrorCode.synthetic_identity_violation, "identity", blob
        )
    if "URL host" in blob or ".invalid" in blob:
        return SongViolation(
            ErrorCode.synthetic_identity_violation, "url", blob
        )
    if any("simulation_flags" in str(loc) for loc in locs):
        return SongViolation(ErrorCode.catalog_generation_failed, "flag", blob)
    # Generic schema/range breakage — repairable (clamp / regenerate).
    return SongViolation(ErrorCode.catalog_generation_failed, "schema", blob)


def validate_song(song: dict) -> None:
    """Validate one mapped song dict against the frozen schema. Raise on failure."""
    try:
        Song.model_validate(song)
    except ValidationError as exc:
        raise _classify(exc) from exc


def validate_coverage(
    *,
    covered_cells: set[str],
    required_cells: set[str],
    extra_checks: dict[str, bool] | None = None,
) -> None:
    """Enforce the §17.6 coverage contract; raise coverage_contract_failed if unmet.

    `extra_checks` maps a check name to its pass/fail bool (quotas, language, era); any
    False entry fails the contract. Kept generic so the freeze stage supplies the
    concrete quota/language/era results.
    """
    missing = required_cells - covered_cells
    if missing:
        raise MdgFatalError(
            ErrorCode.coverage_contract_failed,
            f"required coverage cells unmet: {sorted(missing)}",
        )
    failed = [name for name, ok in (extra_checks or {}).items() if not ok]
    if failed:
        raise MdgFatalError(
            ErrorCode.coverage_contract_failed,
            f"coverage checks failed: {sorted(failed)}",
        )
