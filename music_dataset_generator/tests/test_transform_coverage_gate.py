"""§17.6 coverage gate — enforced only when required_cells is supplied.

run_transform enforces the coverage contract when the caller passes required_cells (the
CLI's opt-in --enforce-coverage). Intermediate-loop freezes (required_cells=None) stay
legitimately partial per the loop model (§4.13).
"""
from __future__ import annotations

import pytest

from mdg.errors import ErrorCode, MdgFatalError
from mdg.transform import run_transform


def test_partial_catalog_fails_when_all_36_required(fixtures_dir) -> None:
    required = {  # a couple of cells the 11-song fixture cache does not cover
        "E-hi_T-hi_P-bv", "E-hi_T-hi_P-il", "E-lo_T-hi_P-dv",
    }
    with pytest.raises(MdgFatalError) as exc:
        run_transform(
            fixtures_dir / "cache", seed=1, tier="demonstration",
            candidate_source="isrc_resolved", generated_at="2026-07-16T00:00:00Z",
            required_cells=required,
        )
    assert exc.value.code == ErrorCode.coverage_contract_failed


def test_no_required_cells_allows_partial_freeze(fixtures_dir) -> None:
    # Intermediate-loop freeze: partial catalog is fine when coverage is not enforced.
    result = run_transform(
        fixtures_dir / "cache", seed=1, tier="demonstration",
        candidate_source="isrc_resolved", generated_at="2026-07-16T00:00:00Z",
    )
    assert result.catalog  # succeeds, partial


def test_enforcing_also_gates_quotas(fixtures_dir) -> None:
    # Even when the required cells are covered, the enforced path also checks §10.3/§10.4
    # quotas — the 11-song fixture cannot meet them, so the freeze fails (coupled §17.6).
    with pytest.raises(MdgFatalError) as exc:
        run_transform(
            fixtures_dir / "cache", seed=1, tier="demonstration",
            candidate_source="isrc_resolved", generated_at="2026-07-16T00:00:00Z",
            required_cells={"E-hi_T-hi_P-bv"},  # Night Runner covers this cell
        )
    assert exc.value.code == ErrorCode.coverage_contract_failed
    assert "checks failed" in exc.value.detail  # quota failure, not just cells
