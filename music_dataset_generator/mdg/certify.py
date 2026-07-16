"""S9 — P6 contrast certifier (design §4.12, SC-004, FR-027).

Runs the P6 content selector over each contrast pair's two worlds and asserts the required
**reversal** of the two contrast songs' relative ordering. A pair that fails to reverse
emits a **re-harvest signal** for that cell — the fix is a different real song, **never** a
numeric tweak toward a target score (FR-027).

`load_evaluate` imports the P6 package's `evaluate(context) -> result` by file path (no
runtime dependency on the app test harness). The reversal logic works over an injected
`rank_fn(world) -> {song_id: position}` so it is deterministically testable; the operator's
live certify supplies a `rank_fn` backed by the real P6 evaluate over the frozen catalog.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any, Callable


def load_evaluate(package_path: Path) -> Callable:
    """Import a package's `algorithm.evaluate` by file path and return it."""
    path = Path(package_path)
    if path.is_dir():
        path = path / "algorithm.py"
    spec = importlib.util.spec_from_file_location(f"p6_algo_{path.stem}", path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load evaluate from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    evaluate = getattr(module, "evaluate", None)
    if not callable(evaluate):
        raise ImportError(f"{path} has no callable `evaluate`")
    return evaluate


def _reverses(rank_fn: Callable, world_a: dict, world_b: dict,
              song_hi: str, song_lo: str) -> bool:
    """True iff the two contrast songs' relative order flips between the two worlds."""
    ra, rb = rank_fn(world_a), rank_fn(world_b)
    # position: lower is better. A reversal means "who ranks ahead" flips.
    hi_ahead_a = ra[song_hi] < ra[song_lo]
    hi_ahead_b = rb[song_hi] < rb[song_lo]
    return hi_ahead_a != hi_ahead_b


def certify_reversals(
    rank_fn: Callable[[dict], dict[str, int]],
    pairs: list[dict],
    worlds: dict[str, dict],
) -> dict[str, Any]:
    """Certify that every pair reverses; emit a re-harvest signal for any that does not.

    Each pair dict must carry `pair_id`, `world_a_ref`, `world_b_ref`, `song_hi`,
    `song_lo`, and optionally `cell`. Returns a report; **never** mutates any score.
    """
    certified: list[str] = []
    re_harvest_signals: list[dict] = []
    for pair in pairs:
        world_a = worlds[pair["world_a_ref"]]
        world_b = worlds[pair["world_b_ref"]]
        if _reverses(rank_fn, world_a, world_b, pair["song_hi"], pair["song_lo"]):
            certified.append(pair["pair_id"])
        else:
            re_harvest_signals.append({
                "pair_id": pair["pair_id"],
                "cell": pair.get("cell"),
                "signal": "re_harvest_cell",
                "reason": "contrast pair did not reverse; harvest a different real song "
                          "for this cell (never tune numbers, FR-027)",
            })
    return {
        "certified": certified,
        "re_harvest_signals": re_harvest_signals,
        "all_reversed": not re_harvest_signals,
    }
