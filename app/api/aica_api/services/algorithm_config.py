"""Pure algorithm-config deep-merge (feature 018 — Proposal Preset Test-Cases).

``merge_algorithm_config`` deep-merges a preset's per-selector
``algorithm_config_overrides`` sub-dict (``content`` or ``service`` —
``models/proposal/preset.py::AlgorithmConfigOverrides``) over a package's
already-resolved ``hyperparameters``/``parameters`` dict, at DISPATCH time
only — it never touches the package's own ``package.json`` on disk
(data-model.md §AlgorithmConfigOverrides: "Overrides never mutate
package.json; the merge operates on a fresh copy per dispatch").

Deliberately pure (no I/O, no clock/random, stdlib only) so it is trivially
unit-testable and safe to call on every request.
"""
from __future__ import annotations

import copy
from typing import Any

__all__ = ["merge_algorithm_config"]


def merge_algorithm_config(
    defaults: dict[str, Any], overrides: dict[str, Any] | None
) -> dict[str, Any]:
    """Return a deep copy of ``defaults`` with ``overrides`` deep-merged over it.

    ``defaults`` is NEVER mutated — a fresh ``deepcopy`` is always returned,
    even when ``overrides`` is ``None``/empty (isolation: repeated calls with
    the same ``defaults`` never accumulate state across dispatches). Nested
    dict values are merged key-by-key, recursively; any non-dict override
    value (including a list/scalar) REPLACES the corresponding default value
    wholesale — only dict-vs-dict pairs recurse.

    Args:
        defaults:  The package's resolved hyperparameters/parameters dict
                   (e.g. ``{hp.key: hp.default for hp in pkg.hyperparameters}``
                   or a caller-supplied override of it). Never mutated.
        overrides: The preset's per-selector override dict (``content`` or
                   ``service`` from ``AlgorithmConfigOverrides``), or
                   ``None``/``{}`` for "no override" — in which case an
                   unmodified deep copy of ``defaults`` is returned.

    Returns:
        A new dict: ``defaults`` deep-merged with ``overrides`` applied on top.
    """
    merged = copy.deepcopy(defaults)
    if not overrides:
        return merged
    _deep_merge_into(merged, overrides)
    return merged


def _deep_merge_into(target: dict[str, Any], overrides: dict[str, Any]) -> None:
    """Recursively merge ``overrides`` into ``target`` IN PLACE.

    Only called on ``target``/nested dicts already owned by ``merge_algorithm_config``'s
    fresh deep copy — never on a caller-owned dict.
    """
    for key, value in overrides.items():
        if isinstance(value, dict) and isinstance(target.get(key), dict):
            _deep_merge_into(target[key], value)
        else:
            target[key] = copy.deepcopy(value)
