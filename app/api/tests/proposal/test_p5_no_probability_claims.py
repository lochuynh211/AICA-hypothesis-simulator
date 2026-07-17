"""TDD: P5 Unit D T025a (FR-023) — the transparent service selector's output
and evidence never labels `service_fit` (or anything derived from it, e.g.
the SS6.4 dominance/`safety_share` readout) as an acceptance probability, a
recovery probability, or a safety certification (doc SS17 acceptance
criterion 10 / spec.md FR-023).

Scans every string reachable from THREE sources, recursively:
  1. `evaluate()`'s actual output for a few representative contexts (the
     runtime evidence a reviewer would see) — rationale text, provenance,
     source_reference, hierarchy_path, feature_value, dominance status.
  2. `package.json` (every source_reference/provenance/label string —
     everything a reviewer can inspect even before running anything).
  3. `algorithm.py`'s own source text — a durable guard against a FUTURE
     edit introducing a forbidden phrase anywhere in the module (comments,
     f-strings, labels), not just the paths these tests happen to exercise.
"""
from __future__ import annotations

from aica_api.config import settings

from tests.proposal.conftest import (
    build_service_context,
    load_service_manifest,
    load_worked_example_context,
)

_REPO_ROOT = settings.proposal_contracts_dir.parent
_PKG_DIR = _REPO_ROOT / "packages" / "aica_transparent_service_selector_v1"

# Case-insensitive English fragments + exact Japanese fragments (doc SS17
# acceptance criterion 10 / spec.md FR-023).
_FORBIDDEN_EN = ("probability", "certified", "certification", "safety certif")
_FORBIDDEN_JA = ("確率", "安全保証")


def _forbidden_hits(text: str) -> list[str]:
    lowered = text.lower()
    hits = [frag for frag in _FORBIDDEN_EN if frag in lowered]
    hits += [frag for frag in _FORBIDDEN_JA if frag in text]
    return hits


def _walk_strings(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from _walk_strings(v)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            yield from _walk_strings(v)


def _assert_clean(obj, label: str) -> None:
    for s in _walk_strings(obj):
        hits = _forbidden_hits(s)
        assert not hits, f"{label}: forbidden phrase {hits} found in {s!r}"


# ---------------------------------------------------------------------------
# 1. Runtime evaluate() output
# ---------------------------------------------------------------------------


def test_worked_example_output_has_no_forbidden_phrasing(service_selector):
    out = service_selector.evaluate(load_worked_example_context())
    _assert_clean(out, "worked-example evaluate() output")


def test_dominance_not_guaranteed_output_has_no_forbidden_phrasing(service_selector, service_hyperparameters):
    import copy

    hp = copy.deepcopy(service_hyperparameters)
    hp["hierarchy_weights"]["Situation"]["share"] = 0.15  # violates the invariant (see test_p5_service_math.py)
    out = service_selector.evaluate(load_worked_example_context(hyperparameters=hp))
    _assert_clean(out, "dominance_not_guaranteed evaluate() output")


def test_low_negative_fit_output_has_no_forbidden_phrasing(service_selector):
    context = build_service_context(
        allowed_service_ids=["radio_style"],
        eligible_candidates=[{"candidate_id": "radio_style"}],
        feature_snapshot={
            "situation": {
                "drowsiness_level": 90, "fatigue_level": 90, "traffic_state": "congested",
                "road_type": "local", "night_state": "night", "monotony_level": 90,
                "route_tags": [], "destination_tags": [], "child_present": False,
                "multiple_passengers": False,
            },
            "preference": {"oshi_registered": True, "oshi_mode": "off"},
            "history": {},
            "additional_proposed": {},
        },
    )
    out = service_selector.evaluate(context)
    _assert_clean(out, "low/negative-fit evaluate() output")


# ---------------------------------------------------------------------------
# 2. package.json — every static string a reviewer can inspect
# ---------------------------------------------------------------------------


def test_package_manifest_has_no_forbidden_phrasing():
    manifest = load_service_manifest()
    _assert_clean(manifest, "package.json")


# ---------------------------------------------------------------------------
# 3. algorithm.py source text — durable guard against future regressions
# ---------------------------------------------------------------------------


def test_algorithm_source_has_no_forbidden_phrasing():
    source = (_PKG_DIR / "algorithm.py").read_text(encoding="utf-8")
    lowered = source.lower()
    for frag in _FORBIDDEN_EN:
        assert frag not in lowered, f"algorithm.py source contains forbidden phrase {frag!r}"
    for frag in _FORBIDDEN_JA:
        assert frag not in source, f"algorithm.py source contains forbidden phrase {frag!r}"
