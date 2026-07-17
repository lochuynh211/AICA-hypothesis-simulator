"""Feature 018 — golden test: the committed presets are exactly what the
generator produces (byte-for-byte), so ``proposal_contracts/presets/*.json`` are
never hand-edited out of sync with ``scripts/generate_presets.py``.

Mirrors ``test_seed_promotion.py`` for the seed promoter.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[4]
_SCRIPTS = _REPO / "scripts"
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

import generate_presets as GP  # noqa: E402

_PRESETS_DIR = _REPO / "proposal_contracts" / "presets"


def test_generator_output_matches_committed_bytes():
    for preset in GP.PRESETS:
        path = _PRESETS_DIR / f"{preset['preset_id']}.json"
        assert path.exists(), f"missing committed preset: {path.name}"
        expected = json.dumps(preset, indent=2, ensure_ascii=False, sort_keys=True) + "\n"
        assert path.read_text(encoding="utf-8") == expected, (
            f"{path.name} is out of sync with scripts/generate_presets.py — "
            f"re-run the generator and commit the result (never hand-edit)."
        )


def test_committed_dir_has_no_extra_presets():
    committed = {p.stem for p in _PRESETS_DIR.glob("preset-*.json")}
    generated = {p["preset_id"] for p in GP.PRESETS}
    assert committed == generated, f"extra/missing committed presets: {committed ^ generated}"


def test_all_presets_validate_as_world():
    # Every committed preset's `world` must satisfy the real World model.
    from aica_api.models.proposal.world import World
    for p in _PRESETS_DIR.glob("preset-*.json"):
        data = json.loads(p.read_text(encoding="utf-8"))
        World(**data["world"])  # raises on any invalid field
