"""Deterministic semantic Combined-catalog tooling."""

from __future__ import annotations

from typing import Any

__all__ = ["compile_artifacts", "load_catalog", "validate_catalog"]


def __getattr__(name: str) -> Any:
    """Resolve compiler exports lazily so ``python -m ...generator`` stays clean."""

    if name not in __all__:
        raise AttributeError(name)
    from . import generator

    return getattr(generator, name)
