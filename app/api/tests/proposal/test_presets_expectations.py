"""Feature 018 — the preset test-case GUARANTEE.

For every committed preset, run BOTH the real content and service selectors and
assert the preset's ``expectation`` contract holds (top predicate, per-preset
``top_fit_min``, gradient-consistent arousal, expected service set). Also assert
each contrast pair's #1 content track diverges. If any preset stops behaving as
its brief claims, this fails loudly — a preset is never shipped mis-describing
itself (spec US3, SC-001/SC-002).

The faithful evaluator lives in ``scripts/preset_eval.py`` (reused by the human
report generator); this test is the assertion gate over it.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

_REPO = Path(__file__).resolve().parents[4]
_SCRIPTS = _REPO / "scripts"
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

import preset_eval as PE  # noqa: E402

_PRESETS = PE.load_presets()
_RESULTS = PE.evaluate_all()


def test_all_presets_committed():
    assert len(_PRESETS) == 32, sorted(_PRESETS)


@pytest.mark.parametrize("pid", sorted(_PRESETS))
def test_preset_meets_its_expectation(pid):
    r = _RESULTS[pid]
    assert r["ok"], f"{pid}: " + "; ".join(r["fails"])


def test_all_presets_pass_as_a_set():
    failing = {pid: r["fails"] for pid, r in _RESULTS.items() if not r["ok"]}
    assert not failing, f"{len(failing)} preset(s) failed: {failing}"


def _pairs():
    seen = set()
    for pid, preset in _PRESETS.items():
        cw = preset.get("contrast_with")
        if cw and (pid, cw) not in seen and (cw, pid) not in seen:
            seen.add((pid, cw))
            yield pid, cw


def test_contrast_pairs_declared():
    assert len(list(_pairs())) == 3, list(_pairs())


@pytest.mark.parametrize("pid,cw", list(_pairs()))
def test_contrast_pair_top_track_differs(pid, cw):
    a, b = _RESULTS[pid]["top"], _RESULTS[cw]["top"]
    assert a is not None and b is not None, (pid, cw)
    assert a != b, f"{pid} and {cw} share top track {a} — contrast not demonstrated"


def test_contrast_pairs_are_symmetric():
    for pid, preset in _PRESETS.items():
        cw = preset.get("contrast_with")
        if cw:
            assert _PRESETS[cw]["contrast_with"] == pid, f"{pid}->{cw} not symmetric"


def test_strong_fit_presets_clear_threshold():
    # Presets designed as strong personalization cases declare (and must meet) >= 0.35.
    strong = {"preset-journey-a-1-cruising-fresh-monotonous", "preset-journey-f-2-highway-excitement",
              "preset-showa-nostalgia", "preset-genz-now"}
    for pid in strong:
        assert _RESULTS[pid]["top_fit"] >= 0.35, (pid, _RESULTS[pid]["top_fit"])


def test_coldstart_control_stays_low():
    # The honest baseline must remain low by design (documents the missing-data floor).
    assert _RESULTS["preset-coldstart-neutral"]["top_fit"] <= 0.20
