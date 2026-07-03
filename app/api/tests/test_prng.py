"""TDD tests for the seeded deterministic PRNG helper (feature 009, T003+T004).

prng.py must provide two pure, replay-safe helpers used by the anomaly-event
generator:

    seeded_uniform(run_seed: int, tick: int, channel: str) -> float
    rng(run_seed: int, tick: int, channel: str) -> random.Random

Both derive a sub-seed via hashlib.sha256 over the canonical byte string
f"{run_seed}:{tick}:{channel}".encode(), taking the low 64 bits, then feed
that into random.Random(subseed). This MUST NOT use the builtin salted
hash() of strings, the global random module state, or wall-clock seeding —
stdlib only (hashlib, random), so results are identical across processes
and runs (constitution III — determinism).
"""

import inspect
import pathlib

import pytest

from aica_api.services.prng import rng, seeded_uniform

# Golden constant pinned once via the exact algorithm in the brief:
#   subseed = int.from_bytes(sha256(f"{run_seed}:{tick}:{channel}".encode()).digest()[-8:], "big")
#   random.Random(subseed).random()
# for (run_seed=42, tick=5, channel="anomaly"). Locks against silent hash changes.
GOLDEN_42_5_ANOMALY = 0.7002773130427511


# ─── Determinism ────────────────────────────────────────────────────────────


def test_seeded_uniform_matches_golden_constant():
    assert seeded_uniform(42, 5, "anomaly") == GOLDEN_42_5_ANOMALY


def test_seeded_uniform_is_stable_across_repeated_calls():
    first = seeded_uniform(42, 5, "anomaly")
    for _ in range(5):
        assert seeded_uniform(42, 5, "anomaly") == first


# ─── Range ──────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "run_seed,tick,channel",
    [
        (0, 0, "anomaly"),
        (42, 5, "anomaly"),
        (1, 2, "c"),
        (999999, 100000, "weather"),
        (-7, 3, "traffic"),
        (7, -3, "rest_opportunity"),
    ],
)
def test_seeded_uniform_is_in_unit_range(run_seed, tick, channel):
    value = seeded_uniform(run_seed, tick, channel)
    assert 0.0 <= value < 1.0


# ─── Distinctness ───────────────────────────────────────────────────────────


def test_changing_run_seed_changes_value():
    base = seeded_uniform(42, 5, "anomaly")
    assert seeded_uniform(43, 5, "anomaly") != base


def test_changing_tick_changes_value():
    base = seeded_uniform(42, 5, "anomaly")
    assert seeded_uniform(42, 6, "anomaly") != base


def test_changing_channel_changes_value():
    base = seeded_uniform(42, 5, "anomaly")
    assert seeded_uniform(42, 5, "other") != base


def test_several_arg_variations_are_pairwise_distinct():
    samples = {
        seeded_uniform(1, 1, "a"),
        seeded_uniform(1, 1, "b"),
        seeded_uniform(1, 2, "a"),
        seeded_uniform(2, 1, "a"),
        seeded_uniform(2, 2, "b"),
    }
    assert len(samples) == 5


# ─── Cross-instance agreement (rng helper) ─────────────────────────────────


def test_rng_two_fresh_instances_agree():
    assert rng(1, 2, "c").random() == rng(1, 2, "c").random()


def test_rng_returns_random_instance():
    import random as random_module

    instance = rng(1, 2, "c")
    assert isinstance(instance, random_module.Random)


def test_rng_different_args_disagree():
    assert rng(1, 2, "c").random() != rng(1, 2, "d").random()
    assert rng(1, 2, "c").random() != rng(1, 3, "c").random()
    assert rng(1, 2, "c").random() != rng(2, 2, "c").random()


def test_rng_and_seeded_uniform_agree_on_first_draw():
    """rng(...) is the same Random the scalar helper draws its one value from."""
    assert rng(42, 5, "anomaly").random() == seeded_uniform(42, 5, "anomaly")


# ─── No-builtin-hash guard ──────────────────────────────────────────────────


def test_module_source_does_not_use_builtin_hash():
    """Guard against silently swapping in the salted builtin hash() (non-deterministic
    across processes since PYTHONHASHSEED randomization), which would break replay."""
    import aica_api.services.prng as prng_module

    source = inspect.getsource(prng_module)
    assert "hash(" not in source


def test_module_does_not_touch_global_random_state():
    """seeded_uniform/rng must not call the module-level random.seed(...) or use
    random.random() directly (global state), which would make results order-dependent."""
    import random as random_module

    before_state = random_module.getstate()
    seeded_uniform(1, 2, "global-state-check")
    rng(3, 4, "global-state-check")
    after_state = random_module.getstate()
    assert before_state == after_state
