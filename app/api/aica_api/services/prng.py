"""Seeded deterministic PRNG helper (feature 009, T003+T004).

Used by the simulator's anomaly-event generator to draw reproducible random
values that are a pure function of (run_seed, tick, channel). Determinism
across processes and runs is required so evidence replay never diverges
(constitution III — determinism):

- MUST NOT use the builtin salted `hash` builtin on strings (randomized per
  process via PYTHONHASHSEED unless disabled).
- MUST NOT use the global `random` module state (order-dependent, mutated
  by unrelated callers).
- MUST NOT seed from the wall clock or any other non-deterministic source.

Instead, the sub-seed is derived with a stable hash (hashlib.sha256 over a
canonical byte string), and every draw happens on a fresh, locally scoped
random.Random instance seeded with that value.
"""

from __future__ import annotations

import hashlib
import random


def _subseed(run_seed: int, tick: int, channel: str) -> int:
    """Derive a stable 64-bit sub-seed from (run_seed, tick, channel).

    Uses hashlib.sha256 (not the builtin salted hash builtin) over a
    canonical byte string so the result is identical across processes and
    runs.
    """
    canonical = f"{run_seed}:{tick}:{channel}".encode()
    digest = hashlib.sha256(canonical).digest()
    return int.from_bytes(digest[-8:], "big")


def rng(run_seed: int, tick: int, channel: str) -> random.Random:
    """Return a fresh random.Random instance seeded deterministically from
    (run_seed, tick, channel). Does not touch the global random module
    state; safe to call repeatedly for several draws in one channel.
    """
    return random.Random(_subseed(run_seed, tick, channel))


def seeded_uniform(run_seed: int, tick: int, channel: str) -> float:
    """Return a deterministic float in [0.0, 1.0), a pure function of the
    three arguments — identical in every process and every run.
    """
    return rng(run_seed, tick, channel).random()
