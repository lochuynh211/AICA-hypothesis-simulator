"""T019 [US1] — S3 selector tests.

The selector admits songs to satisfy coverage by **pigeonhole on the real binned
cell, never by score** (design §4.6). Cells may hold multiple songs (D13); a song is
skipped only when it is a ledger-known identity (dup), never merely because its cell is
already filled. A candidate's LLM-guessed `target_cell_id` never assigns the cell — the
real binned `coords.cell_id` does (the `wrong_cell` firewall case).
"""
from __future__ import annotations

from mdg.selector import select_catalog


def _cand(isrc: str, cell_id: str, *, target_cell_id: str | None = None,
          name: str | None = None) -> dict:
    """Build a minimal selector candidate: identity + binned coords."""
    return {
        "identity": {
            "isrc": isrc,
            "soundcharts_uuid": f"uuid-{isrc}",
            "normalized_name": name or f"song {isrc}|artist",
        },
        "coords": {"cell_id": cell_id, "energy_band": "high"},
        "target_cell_id": target_cell_id,  # LLM guess — advisory only
    }


def test_pigeonhole_admission_by_real_cell() -> None:
    cands = [_cand("A", "E-hi_T-hi_P-bv"), _cand("B", "E-lo_T-lo_P-bv")]
    result = select_catalog(cands)
    accepted_isrcs = {c["identity"]["isrc"] for c in result["accepted"]}
    assert accepted_isrcs == {"A", "B"}
    assert set(result["cells"].keys()) == {"E-hi_T-hi_P-bv", "E-lo_T-lo_P-bv"}


def test_wrong_cell_guess_lands_in_actual_cell() -> None:
    # LLM guessed cell HI, but the real audio bins into cell LO.
    cand = _cand("A", "E-lo_T-lo_P-bv", target_cell_id="E-hi_T-hi_P-bv")
    result = select_catalog([cand])
    assert "A" in result["cells"]["E-lo_T-lo_P-bv"]
    assert "E-hi_T-hi_P-bv" not in result["cells"]


def test_multiple_songs_per_cell_allowed() -> None:
    cands = [_cand("A", "E-hi_T-hi_P-bv"), _cand("B", "E-hi_T-hi_P-bv")]
    result = select_catalog(cands)
    assert len(result["accepted"]) == 2
    assert set(result["cells"]["E-hi_T-hi_P-bv"]) == {"A", "B"}


def test_ledger_identity_skip_by_isrc() -> None:
    cands = [_cand("A", "E-hi_T-hi_P-bv"), _cand("B", "E-hi_T-hi_P-bv")]
    ledger_keys = [{"isrc": "A"}]
    result = select_catalog(cands, ledger_keys=ledger_keys)
    accepted_isrcs = {c["identity"]["isrc"] for c in result["accepted"]}
    assert accepted_isrcs == {"B"}
    assert any(s["reason"] == "ledger_duplicate" for s in result["skipped"])


def test_ledger_identity_skip_by_normalized_name() -> None:
    cand = _cand("A", "E-hi_T-hi_P-bv", name="night runner|real band")
    ledger_keys = [{"normalized_name": "night runner|real band"}]
    result = select_catalog([cand], ledger_keys=ledger_keys)
    assert result["accepted"] == []
    assert result["skipped"][0]["reason"] == "ledger_duplicate"


def test_within_batch_duplicate_identity_skipped() -> None:
    cands = [_cand("A", "E-hi_T-hi_P-bv"), _cand("A", "E-hi_T-hi_P-bv")]
    result = select_catalog(cands)
    assert len(result["accepted"]) == 1
    assert any(s["reason"] == "batch_duplicate" for s in result["skipped"])


def test_selection_emits_no_score_or_label() -> None:
    result = select_catalog([_cand("A", "E-hi_T-hi_P-bv")])
    forbidden = {"score", "item_fit", "rank", "label", "recommended", "target_rank"}
    for c in result["accepted"]:
        assert forbidden.isdisjoint(c.keys())
    assert forbidden.isdisjoint(result.keys())


def test_input_order_preserved_deterministic() -> None:
    cands = [_cand("C", "E-hi_T-hi_P-bv"), _cand("A", "E-hi_T-hi_P-bv"),
             _cand("B", "E-lo_T-lo_P-bv")]
    result = select_catalog(cands)
    assert [c["identity"]["isrc"] for c in result["accepted"]] == ["C", "A", "B"]
