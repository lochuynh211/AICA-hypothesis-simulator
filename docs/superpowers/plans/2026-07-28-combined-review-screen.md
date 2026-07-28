# Combined Review Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the built Combined Simulator screen into a parameter-rationale review surface — run a committed experience test case through the three real algorithms, explain why each decision happened, and let a reviewer judge every input.

**Architecture:** Three additive backend changes complete the recorded evidence (trigger per-feature contributions, the content scored tail, two feedback record kinds). Everything else is frontend: a bundled case catalog resolved in TS, all review arithmetic in pure functions over chains already in the store, and a 20/45/35 reshape of `MergedShell`.

**Tech Stack:** Python 3 + FastAPI + Pydantic v2 (`app/api`, pytest); React 18 + TypeScript + Vite (`app/frontend`, Vitest + Testing Library); committed JSON contracts at repo root.

## Global Constraints

- **Nothing is graded.** No pass/fail verdict, status aggregation, or first-divergence banner anywhere in this feature.
- **No component may invoke an algorithm or alter a score, ranking, threshold or gate.** All review output is arithmetic over recorded evidence.
- **Where evidence is absent, say so.** Never infer or default a contribution to zero.
- **Review scope is `rest_required` and `monotony_prevention` only**, and only the proposal made at the moment each fires. Other lifecycle stages still simulate and display but expose no review target.
- **No contrast.** No paired cases, no A/B switch, no sensitivity delta table. A case explains itself from its own evidence.
- **Detailed setup popups mount existing components verbatim** — never restyled, re-grouped, or rebuilt from manifests.
- **Bilingual (ja/en) for every user-visible string**, via `t()` from `src/i18n/t`. JA is the default language.
- **No new runtime dependencies** in either `app/api` or `app/frontend`.
- Backend tests: `cd app/api && python -m pytest`. Frontend tests: `cd app/frontend && npx vitest run`.
- **`npx tsc --noEmit` is NOT clean on this branch's baseline — it reports 167 pre-existing
  errors (21 in `src/`, 146 in `tests/`).** Never treat a clean typecheck as the gate. The gate
  is: no NEW errors naming a file you created or modified, and `npx vite build` succeeds.
  Capture the baseline with `npx tsc --noEmit 2>&1 | grep -c "error TS"` before you start and
  compare after. Do not "fix" unrelated pre-existing errors — that is outside every task here.
- htmlapp is out of scope. Do not modify any file under `htmlapp/`.

---

## File Structure

**Backend — modified only, no new modules**

| File | Responsibility |
|---|---|
| `packages/aica_transparent_hybrid_trigger_v1/algorithm.py` | `category_scores()` also returns per-feature terms + gate + clamp flag; `evaluate()` emits them |
| `app/api/aica_api/models/decision.py` | `DecisionResult.feature_contributions` |
| `packages/aica_transparent_content_selector_v1/algorithm.py` | Emit `scored_tail`, `cut_margin`, `tail_truncated` |
| `app/api/aica_api/models/proposal/content_output.py` | `ScoredTailItem` + three `CompletePlan` fields |
| `app/api/aica_api/models/feedback.py` | Two `FeedbackTarget.scope` values + review anchor fields |
| `app/api/aica_api/routers/merged_runs.py` | `POST /api/merged-runs/{id}/review-feedback` |

**Contracts — new**

| File | Responsibility |
|---|---|
| `combined_contracts/schema/combined_test_case.schema.json` | JSON Schema for a case |
| `combined_contracts/test_cases/case-c0{1..6}-*.json` | The six committed cases |

**Frontend — new**

| File | Responsibility |
|---|---|
| `src/lib/review/types.ts` | Shared review types — one definition, imported everywhere |
| `src/lib/review/reviewMath.ts` | Scale, margin, shares, intent-vs-effect, necessity, flip distance, played-no-part |
| `src/lib/review/reviewVocabulary.ts` | Domain grouping, plain phrasing, band words |
| `src/lib/review/checkpoints.ts` | Derive in-scope decision points from a run |
| `src/lib/review/chains.ts` | Build `ReviewOption`s from recorded trigger/service/content evidence |
| `src/lib/review/caseCatalog.ts` | Load + type the bundled cases |
| `src/lib/review/caseResolver.ts` | Apply a case to the scoped stores |
| `src/components/review/ExperienceCasePicker.tsx` | Case `<select>` + flag chip |
| `src/components/review/ExperienceCaseCard.tsx` | Brief, what-to-watch, persona line |
| `src/components/review/CaseDetailsModal.tsx` | Persona narrative, goals, constraints, fixed conditions |
| `src/components/review/CheckpointRail.tsx` | In-scope decision points |
| `src/components/review/DecisionBand.tsx` | Names the selected decision point |
| `src/components/review/WhatDecidedIt.tsx` | Comparison pickers, margin bars, verdict, domain grouping |
| `src/components/review/ParameterRationale.tsx` | Rationale table + consequences + played-no-part |
| `src/components/review/DecisionAssessment.tsx` | Per-decision assessment + export |
| `src/components/review/ReviewColumn.tsx` | Stage tabs + assembly |
| `src/state/reviewStore.tsx` | Selected case / checkpoint / stage / target / judgements |

**Frontend — modified**

| File | Responsibility |
|---|---|
| `src/components/merged/MergedShell.tsx` | 3 columns; log panel removed |
| `src/styles/app.css` | `.merged-shell` grid → 20/45/35 |
| `src/components/merged/MergedCenterPanel.tsx` | Hosts rail, decision band, proposal split |
| `src/components/merged/MergedSetupPanel.tsx` | Badges, differs-from-case note, two-tier switch |
| `vite.config.ts` | `@contracts` alias onto `combined_contracts/` |

---

## Slice 1 — Evidence completion and review math

### Task 1: Trigger emits per-feature contributions

**Files:**
- Modify: `packages/aica_transparent_hybrid_trigger_v1/algorithm.py:249-289` (`category_scores`), `:777-806` (`evaluate` return)
- Modify: `app/api/aica_api/models/decision.py:112-125` (`DecisionResult`)
- Test: `app/api/tests/test_transparent_hybrid_contributions.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `DecisionResult.feature_contributions: dict`, shaped as
  ```
  { "<category>": { "score": float, "clamped": bool,
                    "rows": [{feature_id, value, band, weight, contribution}],
                    "gates": [{gate_id, evaluated_inputs, threshold, passed, effect}] } }
  ```
  Categories are exactly `"rest_required"` and `"monotony_prevention"`. Task 11 reads this.

**Context:** `category_scores()` computes `w × feature` terms for both categories and discards them; `DecisionResult` keeps only aggregate `scores` and `features` (ordinal band *strings*). Pydantic drops unknown keys in `DecisionResult(**raw_result)` (`app/api/aica_api/algorithms/python_module.py:208`), so the model field is required for anything to survive.

`rest_required` terms: `drowsiness`, `fatigue`, `driving_anomaly`, `driving_time`, `env_load` (the base-safety block), then `rest_window` and `rest_scarcity` (gated on `base_safety_risk >= minimum_risk_for_rest_bonus`), then `child_passenger` as a pseudo-feature with weight `w_child_bonus` and value `0.0`/`1.0`.
`monotony_prevention` terms: `monotony`, `env_load`, `familiar_route`.

- [ ] **Step 1: Write the failing test**

```python
# app/api/tests/test_transparent_hybrid_contributions.py
"""B1 — the hybrid trigger records the per-feature terms it computes.

Without these the review screen has no numeric trigger evidence at all and
would have to reconstruct contributions from a hardcoded weight table, which
the design forbids (acceptance criterion 9).
"""
from __future__ import annotations

import importlib.util
import json
import pathlib

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
_PKG_DIR = _REPO_ROOT / "packages" / "aica_transparent_hybrid_trigger_v1"


def _load_module():
    spec = importlib.util.spec_from_file_location(
        "hybrid_alg_contrib", _PKG_DIR / "algorithm.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


mod = _load_module()
HP = {
    hp["key"]: hp["default"]
    for hp in json.loads((_PKG_DIR / "package.json").read_text(encoding="utf-8"))["hyperparameters"]
}

# A feature vector well above the rest-bonus gate.
HIGH = {
    "drowsiness": 0.9, "fatigue": 0.8, "driving_anomaly": 0.4, "driving_time": 0.7,
    "env_load": 0.5, "monotony": 0.6, "rest_window": 0.5, "rest_scarcity": 0.3,
    "familiar_route": 1.0,
}
# Below the gate: the five base-safety features are 0 so base_safety_risk stays
# under minimum_risk_for_rest_bonus, but rest_window/rest_scarcity are NONZERO.
# They are not inputs to base_safety_risk, so they can carry real values while the
# gate stays blocked — which is what makes the zeroing assertion below meaningful.
# With them at 0.0 the test would pass whether or not the gate zeroed anything.
LOW = dict.fromkeys(HIGH, 0.0) | {"monotony": 0.4, "rest_window": 0.7, "rest_scarcity": 0.6}


def _rows(result, category):
    return {r["feature_id"]: r for r in result["feature_contributions"][category]["rows"]}


def test_both_categories_are_recorded():
    out = mod.category_scores(HIGH, HP)
    assert set(out["feature_contributions"]) == {"rest_required", "monotony_prevention"}


def test_each_row_is_weight_times_value():
    out = mod.category_scores(HIGH, HP)
    for category in ("rest_required", "monotony_prevention"):
        for row in out["feature_contributions"][category]["rows"]:
            assert row["contribution"] == row["weight"] * row["value"], row["feature_id"]


def test_monotony_rows_are_exactly_its_three_terms():
    rows = _rows(mod.category_scores(HIGH, HP), "monotony_prevention")
    assert set(rows) == {"monotony", "env_load", "familiar_route"}
    assert rows["monotony"]["weight"] == HP["w_monotony"]
    assert rows["env_load"]["weight"] == HP["w_env_mono"]


def test_child_passenger_is_a_visible_pseudo_feature():
    rows = _rows(mod.category_scores(HIGH, HP, child_passenger=True), "rest_required")
    assert rows["child_passenger"]["value"] == 1.0
    assert rows["child_passenger"]["weight"] == HP["w_child_bonus"]
    assert rows["child_passenger"]["contribution"] == HP["w_child_bonus"]

    off = _rows(mod.category_scores(HIGH, HP, child_passenger=False), "rest_required")
    assert off["child_passenger"]["value"] == 0.0
    assert off["child_passenger"]["contribution"] == 0.0


def test_rest_bonus_gate_is_recorded_when_it_passes():
    out = mod.category_scores(HIGH, HP)
    gates = out["feature_contributions"]["rest_required"]["gates"]
    gate = next(g for g in gates if g["gate_id"] == "minimum_risk_for_rest_bonus")
    assert gate["passed"] is True
    assert gate["threshold"] == HP["minimum_risk_for_rest_bonus"]
    assert gate["effect"] == "allow"
    assert set(gate["evaluated_inputs"]) == {"base_safety_risk"}


def test_rest_bonus_gate_zeroes_its_terms_when_it_blocks():
    out = mod.category_scores(LOW, HP)
    gate = next(
        g for g in out["feature_contributions"]["rest_required"]["gates"]
        if g["gate_id"] == "minimum_risk_for_rest_bonus"
    )
    assert gate["passed"] is False
    assert gate["effect"] == "exclude"

    rows = _rows(out, "rest_required")
    # BOTH halves matter. The contribution is zeroed...
    assert rows["rest_window"]["contribution"] == 0.0
    assert rows["rest_scarcity"]["contribution"] == 0.0
    # ...AND the row stays visible carrying its real input and declared weight, so
    # "admitted but gated to zero" is distinguishable from "not present at all".
    # Without these three, the assertions above pass on an all-zero fixture too.
    assert rows["rest_window"]["value"] == 0.7
    assert rows["rest_scarcity"]["value"] == 0.6
    assert rows["rest_window"]["weight"] == HP["w_rest_window"]


def test_clamp_is_flagged_when_it_binds():
    saturated = dict.fromkeys(HIGH, 1.0)
    out = mod.category_scores(saturated, HP)
    block = out["feature_contributions"]["rest_required"]
    total = sum(r["contribution"] for r in block["rows"])
    assert total > block["score"]      # the clamp bit
    assert block["clamped"] is True


def test_clamp_flag_is_false_when_it_does_not_bind():
    out = mod.category_scores(LOW, HP)
    assert out["feature_contributions"]["monotony_prevention"]["clamped"] is False


def test_recorded_score_matches_the_reported_category_score():
    out = mod.category_scores(HIGH, HP)
    fc = out["feature_contributions"]
    assert fc["rest_required"]["score"] == out["rest_required_score"]
    assert fc["monotony_prevention"]["score"] == out["monotony_prevention_score"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/api && python -m pytest tests/test_transparent_hybrid_contributions.py -v`
Expected: FAIL — `KeyError: 'feature_contributions'`

- [ ] **Step 3: Implement in `category_scores`**

Replace the body of `category_scores` (`packages/aica_transparent_hybrid_trigger_v1/algorithm.py:249`) from `base_safety_risk = _clamp(` through its `return`:

```python
    def _row(feature_id: str, value: float, weight: float) -> dict:
        return {
            "feature_id": feature_id,
            "value": value,
            "band": None,          # filled in by evaluate() from features_ordinal
            "weight": weight,
            "contribution": weight * value,
        }

    base_terms = [
        _row("drowsiness", features["drowsiness"], hp["w_drowsiness"]),
        _row("fatigue", features["fatigue"], hp["w_fatigue"]),
        _row("driving_anomaly", features["driving_anomaly"], hp["w_driving_anomaly"]),
        _row("driving_time", features["driving_time"], hp["w_driving_time"]),
        _row("env_load", features["env_load"], hp["w_env"]),
    ]
    base_unclamped = sum(t["contribution"] for t in base_terms)
    base_safety_risk = _clamp(base_unclamped)

    gate_passed = base_safety_risk >= hp["minimum_risk_for_rest_bonus"]
    rest_bonus_terms = [
        _row("rest_window", features["rest_window"], hp["w_rest_window"]),
        _row("rest_scarcity", features["rest_scarcity"], hp["w_rest_scarcity"]),
    ]
    if gate_passed:
        rest_bonus = sum(t["contribution"] for t in rest_bonus_terms)
    else:
        # Keep the rows VISIBLE with their declared weight so a reviewer can see
        # they were gated out rather than simply absent; zero only the effect.
        rest_bonus = 0.0
        for term in rest_bonus_terms:
            term["contribution"] = 0.0

    child_term = _row("child_passenger", 1.0 if child_passenger else 0.0, hp["w_child_bonus"])
    child_bonus = child_term["contribution"]

    rest_unclamped = base_safety_risk + rest_bonus + child_bonus
    rest_required_score = _clamp(rest_unclamped)

    mono_terms = [
        _row("monotony", features["monotony"], hp["w_monotony"]),
        _row("env_load", features["env_load"], hp["w_env_mono"]),
        _row("familiar_route", features["familiar_route"], hp["w_familiar"]),
    ]
    mono_unclamped = sum(t["contribution"] for t in mono_terms)
    monotony_prevention_score = _clamp(mono_unclamped)

    rest_rows = base_terms + rest_bonus_terms + [child_term]

    return {
        "base_safety_risk": base_safety_risk,
        "rest_required_score": rest_required_score,
        "monotony_prevention_score": monotony_prevention_score,
        "feature_contributions": {
            "rest_required": {
                "score": rest_required_score,
                # `clamp` means Σcontributions can exceed the reported score, so
                # realized shares stop reconciling. The panel must be able to SAY so.
                "clamped": sum(r["contribution"] for r in rest_rows) > rest_required_score,
                "rows": rest_rows,
                "gates": [{
                    "gate_id": "minimum_risk_for_rest_bonus",
                    "evaluated_inputs": {"base_safety_risk": base_safety_risk},
                    "threshold": hp["minimum_risk_for_rest_bonus"],
                    "passed": gate_passed,
                    "effect": "allow" if gate_passed else "exclude",
                }],
            },
            "monotony_prevention": {
                "score": monotony_prevention_score,
                "clamped": mono_unclamped > monotony_prevention_score,
                "rows": mono_terms,
                "gates": [],
            },
        },
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app/api && python -m pytest tests/test_transparent_hybrid_contributions.py -v`
Expected: PASS (9 tests)

- [ ] **Step 5: Emit from `evaluate()` and add the model field**

In `evaluate()`, immediately after `features_ordinal = {k: str(v) for k, v in ordinal.items()}` (`algorithm.py:775`), enrich each row's band, then add the key to the returned dict:

```python
    # Attach the ordinal band word each row's raw value falls in, so the review
    # panel can lead with the value a reviewer already understands. `ordinal` is
    # keyed independently of FEATURE_KEYS, so a miss stays None rather than guessing.
    feature_contributions = scores["feature_contributions"]
    for block in feature_contributions.values():
        for row in block["rows"]:
            row["band"] = features_ordinal.get(row["feature_id"])
```

Add to the returned dict, after `"scores": {...}`:

```python
        "feature_contributions": feature_contributions,
```

In `app/api/aica_api/models/decision.py`, add to `DecisionResult` after `criteria: dict`:

```python
    # Per-category per-feature terms recorded by transparent packages (B1).
    # Empty for packages that do not populate it — consumers must report the
    # trigger stage as unavailable rather than inferring contributions.
    feature_contributions: dict = {}
```

- [ ] **Step 6: Write the end-to-end test**

```python
# append to app/api/tests/test_transparent_hybrid_contributions.py
def test_evaluate_emits_contributions_with_bands():
    from tests.test_transparent_hybrid import _EMPTY_PH

    result = mod.evaluate({
        "simulation_time_sec": 3600.0,
        "signals": {
            "fixed": {"isNight": True, "familiarRoute": False, "weatherRiskLevel": 0.2},
            "dynamic": {"isTrafficJam": False, "nextRestSpotMin": 12.0,
                        "continuousDrivingMin": 120.0, "roadType": "highway", "speedKph": 90.0},
            "simulated": {"drowsiness": 78.0, "fatigue": 65.0, "anomaly_rate": 2.0},
        },
        "feature_groups": {"ordinal": {"drowsiness": "very_high", "fatigue": "high"}},
        "parameters": {}, "hyperparameters": HP,
        "proposal_history": _EMPTY_PH, "user_action_history": [],
        "package_runtime_state": {}, "recovery_active": False,
    })

    fc = result["feature_contributions"]
    assert set(fc) == {"rest_required", "monotony_prevention"}
    rows = {r["feature_id"]: r for r in fc["rest_required"]["rows"]}
    assert rows["drowsiness"]["band"] == "very_high"
    # A feature with no ordinal entry stays None — never a guessed band.
    assert rows["rest_window"]["band"] is None


def test_decision_result_model_preserves_the_field():
    from aica_api.models.decision import DecisionResult

    parsed = DecisionResult(
        result_type="NO_TRIGGER", trigger_candidate=False, selected_category=None,
        score=None, features={}, criteria={}, candidates=[],
        fire_control={"fired": False, "suppressed": False, "override": False, "reason": None},
        proposal=None, reason_inputs=[], explanation="",
        feature_contributions={"rest_required": {"score": 0.4, "clamped": False, "rows": [], "gates": []}},
    )
    assert parsed.feature_contributions["rest_required"]["score"] == 0.4


def test_field_defaults_empty_for_packages_that_do_not_emit_it():
    from aica_api.models.decision import DecisionResult

    parsed = DecisionResult(
        result_type="NO_TRIGGER", trigger_candidate=False, selected_category=None,
        score=None, features={}, criteria={}, candidates=[],
        fire_control={"fired": False, "suppressed": False, "override": False, "reason": None},
        proposal=None, reason_inputs=[], explanation="",
    )
    assert parsed.feature_contributions == {}
```

- [ ] **Step 7: Run the full trigger suite for regressions**

Run: `cd app/api && python -m pytest tests/test_transparent_hybrid_contributions.py tests/test_transparent_hybrid.py -v`
Expected: PASS — all new tests plus the existing hybrid suite unchanged.

- [ ] **Step 8: Run the whole backend suite**

Run: `cd app/api && python -m pytest -q`
Expected: PASS, no regressions. `category_scores` returns a superset of its previous keys, so existing callers are unaffected.

- [ ] **Step 9: Commit**

```bash
git add packages/aica_transparent_hybrid_trigger_v1/algorithm.py \
        app/api/aica_api/models/decision.py \
        app/api/tests/test_transparent_hybrid_contributions.py
git commit -m "feat(trigger): record per-feature contributions for both categories

The hybrid trigger computed every w*feature term inside category_scores and
discarded it, leaving the review surface with no numeric trigger evidence.
Records both categories' terms plus the rest-bonus gate, the child_passenger
pseudo-feature, and a flag for when clamping binds."
```

---

### Task 2: Content selector records the scored tail

**Files:**
- Modify: `packages/aica_transparent_content_selector_v1/algorithm.py:741-745` and its final `return` (`:860-877`)
- Modify: `app/api/aica_api/models/proposal/content_output.py:150-190`
- Test: `app/api/tests/proposal/test_content_scored_tail.py`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `CompletePlan.scored_tail: list[ScoredTailItem]`, `.cut_margin: float | None`, `.tail_truncated: bool`.
  `ScoredTailItem` = `{item_id: str, rank: int, item_fit: float, feature_contributions: list[ItemFeatureContribution]}`.
  Task 11 reads these to give plan positions a real runner-up.

**Context:** `scored_songs` already holds every scored candidate with its full `contributions` list; `chosen = scored_songs[:plan_count]` throws the rest away (`algorithm.py:742-743`). `excluded_items` records only *ineligible* items with reason codes — never scored ones. Cap the tail at 20 to bound the run log.

- [ ] **Step 1: Write the failing test**

```python
# app/api/tests/proposal/test_content_scored_tail.py
"""B2 — the content selector records the scored candidates it did NOT pick.

Without this, "why isn't song X in the plan?" is unanswerable and plan
positions below rank 1 have no real runner-up to be compared against.
"""
from __future__ import annotations

from tests.proposal.conftest import load_content_selector

CS = load_content_selector()
TAIL_CAP = 20


def _plan(context):
    out = CS.evaluate(context)
    assert out["decision_type"] == "complete_plan", out
    return out


def test_tail_holds_the_scored_but_unpicked_candidates(content_context_factory):
    plan = _plan(content_context_factory(song_count=12, plan_item_count=5))
    assert len(plan["scored_tail"]) == 7
    assert plan["tail_truncated"] is False

    picked = {i["item_id"] for i in plan["ordered_items"]}
    assert picked.isdisjoint({t["item_id"] for t in plan["scored_tail"]})


def test_tail_ranks_continue_the_plan_ordering(content_context_factory):
    plan = _plan(content_context_factory(song_count=12, plan_item_count=5))
    assert [t["rank"] for t in plan["scored_tail"]] == [6, 7, 8, 9, 10, 11, 12]


def test_tail_is_sorted_by_fit_descending(content_context_factory):
    plan = _plan(content_context_factory(song_count=12, plan_item_count=5))
    fits = [t["item_fit"] for t in plan["scored_tail"]]
    assert fits == sorted(fits, reverse=True)


def test_tail_carries_full_contributions(content_context_factory):
    plan = _plan(content_context_factory(song_count=12, plan_item_count=5))
    first = plan["scored_tail"][0]
    assert first["feature_contributions"], "tail items need the same chain as picked items"
    keys = set(first["feature_contributions"][0])
    assert {"feature_id", "e_i", "a_i", "effective_weight", "contribution"} <= keys
    assert "leaf" not in keys      # same projection as ordered_items


def test_cut_margin_is_the_last_picked_minus_first_dropped(content_context_factory):
    plan = _plan(content_context_factory(song_count=12, plan_item_count=5))
    expected = plan["ordered_items"][-1]["item_fit"] - plan["scored_tail"][0]["item_fit"]
    assert plan["cut_margin"] == expected
    assert plan["cut_margin"] >= 0


def test_tail_is_capped_and_flagged(content_context_factory):
    plan = _plan(content_context_factory(song_count=40, plan_item_count=5))
    assert len(plan["scored_tail"]) == TAIL_CAP
    assert plan["tail_truncated"] is True


def test_no_tail_when_everything_was_picked(content_context_factory):
    plan = _plan(content_context_factory(song_count=5, plan_item_count=5))
    assert plan["scored_tail"] == []
    assert plan["cut_margin"] is None
    assert plan["tail_truncated"] is False


def test_model_accepts_and_defaults_the_new_fields():
    from aica_api.models.proposal.content_output import CompletePlan

    base = dict(
        decision_type="complete_plan", selected_service_id="music_playlist",
        requested_item_count=0, returned_item_count=0, ordered_items=[],
        mode={"service_id": "music_playlist", "mode_kind": "playlist",
              "chorus_only": None, "guide_vocal": None, "driving_lyrics": None,
              "fixed_segment_sec": None, "stopped_only": None, "simulated_queue": None},
        expected_duration_sec=0,
        lighting_configuration={"enabled": False, "cue_basis": None, "notes": None},
        approval_policy="explicit_opt_in", completion_rule="plan_exhausted",
        next_transition_policy="await_user", excluded_items=[],
    )
    # Absent → safe defaults, so pre-existing persisted evidence still parses.
    assert CompletePlan(**base).scored_tail == []
    assert CompletePlan(**base).cut_margin is None
    assert CompletePlan(**base).tail_truncated is False
```

- [ ] **Step 2: Add the shared context factory fixture**

`app/api/tests/proposal/conftest.py` — append. Check first whether an equivalent factory already exists there and reuse it rather than adding a second one.

```python
import pytest


@pytest.fixture
def content_context_factory():
    """Build a minimal valid content-selector context with N synthetic songs.

    Songs are given monotonically varying audio features so their item_fit
    values are distinct and the sort order is unambiguous.
    """
    def _build(song_count: int, plan_item_count: int = 5) -> dict:
        base = load_catalog("fixtures/catalog/worked-example.json")
        template = base["songs"][0]
        songs = []
        for i in range(song_count):
            song = json.loads(json.dumps(template))
            song["spotify_track"]["id"] = f"trk{i:03d}"
            song["spotify_track"]["name"] = f"Track {i}"
            af = song["spotify_track"]["audio_features"]
            af["energy"] = 0.05 + (i * 0.9 / max(1, song_count - 1))
            af["valence"] = 0.95 - (i * 0.9 / max(1, song_count - 1))
            songs.append(song)
        catalog = dict(base, songs=songs)

        hp = dict(manifest_hyperparameters(), plan_item_count=plan_item_count)
        return {
            "catalog": catalog,
            "hyperparameters": hp,
            "parameters": {},
            "selected_service_id": "music_playlist",
            "trigger_purpose": "rest_recommended",
            "lifecycle_stage": "before_rest_until_stop",
            "eligible_candidates": [{"candidate_id": s["spotify_track"]["id"]} for s in songs],
            "world": base.get("world", {}),
            "feature_dispositions": [],
        }
    return _build
```

Note: the exact context keys must match what `load_content_selector().evaluate` requires. Read `packages/aica_transparent_content_selector_v1/algorithm.py:623-660` and an existing passing test (`tests/proposal/test_content_selector_scoring.py`) and mirror their context construction — the sketch above shows intent, not a verified key list.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd app/api && python -m pytest tests/proposal/test_content_scored_tail.py -v`
Expected: FAIL — `KeyError: 'scored_tail'`

- [ ] **Step 4: Implement in the algorithm**

In `packages/aica_transparent_content_selector_v1/algorithm.py`, after `chosen = scored_songs[:plan_count]` (`:743`):

```python
    # ---- scored tail (B2) ----------------------------------------------------
    # The candidates that WERE scored but not picked. `excluded_items` records
    # only INELIGIBLE items, so without this the plan cannot be compared against
    # anything outside itself.
    _TAIL_CAP = 20
    dropped = scored_songs[plan_count:]
    scored_tail = [
        {
            "item_id": s["track"]["id"],
            "rank": plan_count + offset + 1,
            "item_fit": s["item_fit"],
            "feature_contributions": [
                {k: v for k, v in c.items() if k != "leaf"} for c in s["contributions"]
            ],
        }
        for offset, s in enumerate(dropped[:_TAIL_CAP])
    ]
    cut_margin = (chosen[-1]["item_fit"] - dropped[0]["item_fit"]) if dropped else None
    tail_truncated = len(dropped) > _TAIL_CAP
```

Add to the final returned dict, after `"excluded_items": excluded_items,`:

```python
        "scored_tail": scored_tail,
        "cut_margin": cut_margin,
        "tail_truncated": tail_truncated,
```

- [ ] **Step 5: Implement the model**

In `app/api/aica_api/models/proposal/content_output.py`, add before `class CompletePlan`:

```python
# ---------------------------------------------------------------------------
# ScoredTailItem  (B2)
# ---------------------------------------------------------------------------


class ScoredTailItem(BaseModel):
    """A candidate that was scored but did not make the plan.

    Carries the same contribution chain as an OrderedItem so a reviewer can ask
    why it lost. Ineligible candidates are NOT here — they stay in
    ``excluded_items`` with their reason codes.
    """

    item_id: str
    rank: int                       # continues ordered_items' numbering
    item_fit: float
    feature_contributions: list[ItemFeatureContribution]
```

Add to `CompletePlan`, after `excluded_items: list[ExcludedItem]`:

```python
    # B2 — the scored-but-unpicked tail, capped. Defaults keep every previously
    # persisted plan parseable.
    scored_tail: list[ScoredTailItem] = []
    cut_margin: float | None = None
    tail_truncated: bool = False
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd app/api && python -m pytest tests/proposal/test_content_scored_tail.py -v`
Expected: PASS (8 tests)

- [ ] **Step 7: Run the content and proposal suites for regressions**

Run: `cd app/api && python -m pytest tests/proposal -q`
Expected: PASS. Watch specifically for `test_content_output_contract.py` and `test_content_selector_determinism.py` — the additions are new keys only, so both should be unaffected.

- [ ] **Step 8: Commit**

```bash
git add packages/aica_transparent_content_selector_v1/algorithm.py \
        app/api/aica_api/models/proposal/content_output.py \
        app/api/tests/proposal/test_content_scored_tail.py \
        app/api/tests/proposal/conftest.py
git commit -m "feat(content): record the scored-but-unpicked tail with cut margin

A completed plan kept only its 5 items, so no plan position had a runner-up to
be compared against and 'why isn't song X here?' was unanswerable. Records the
top 20 dropped candidates with their full contribution chains."
```

---

### Task 3: Review types and core math

**Files:**
- Create: `app/frontend/src/lib/review/types.ts`, `app/frontend/src/lib/review/reviewMath.ts`
- Test: `app/frontend/tests/review_math.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces — every later frontend task imports these exact names:
  ```ts
  type ReviewChainRow = { featureId: string; value: number; band: string | null; r: number; w: number; contribution: number }
  type ReviewOption   = { id: string; label: string; score: number; rows: ReviewChainRow[]; clamped?: boolean }
  type MarginRow      = { featureId: string; left: number; right: number; margin: number; lean: 'left' | 'right' | 'none' }
  type Unavailable    = { available: false; reason: string }

  scaleBound(magnitudes: number[]): number
  marginRows(left: ReviewOption, right: ReviewOption): MarginRow[]
  realizedShares(rows: ReviewChainRow[]): Record<string, number>
  declaredShares(weights: Record<string, number>): Record<string, number>
  intentVsEffect(realized: number, declared: number): 'up' | 'down' | 'even'
  ```

**Context:** `ReviewChainRow` is deliberately the shape `ReasonRow` already uses in `src/components/proposal/ReasonBreakdown.tsx:23` (`featureId`, `value`, `r`, `w`, `contribution`) plus `band`. The trigger has no response coefficient, so trigger rows set `r = 1`. Keep this module framework-free and I/O-free — it must be unit-testable standalone.

- [ ] **Step 1: Write the failing test**

```ts
// app/frontend/tests/review_math.test.ts
import {
  scaleBound, marginRows, realizedShares, declaredShares, intentVsEffect,
} from '../src/lib/review/reviewMath'
import type { ReviewOption } from '../src/lib/review/types'

const row = (featureId: string, contribution: number, w = 0.5) => ({
  featureId, value: contribution / w, band: null, r: 1, w, contribution,
})

const opt = (id: string, rows: ReturnType<typeof row>[]): ReviewOption => ({
  id, label: id, score: rows.reduce((a, r) => a + r.contribution, 0), rows,
})

describe('scaleBound', () => {
  it('rounds up to the first readable value strictly above the largest magnitude', () => {
    expect(scaleBound([0.299, -0.1])).toBe(0.3)
    expect(scaleBound([0.11])).toBe(0.125)
  })

  it('is strictly above the magnitude even at an exact step value', () => {
    // 0.3 must NOT bound itself — a bar would touch the edge and read as clipped.
    // Pinned to the NEXT step, not merely "something bigger": toBeGreaterThan
    // alone would pass for a bound of 10, which would squash every bar flat.
    expect(scaleBound([0.3])).toBe(0.4)
  })


  it('uses absolute magnitude, so sign never changes the bound', () => {
    expect(scaleBound([-0.299])).toBe(scaleBound([0.299]))
  })

  it('returns a positive bound for an all-zero or empty input', () => {
    expect(scaleBound([])).toBeGreaterThan(0)
    expect(scaleBound([0, 0])).toBeGreaterThan(0)
  })
})

describe('marginRows', () => {
  const left = opt('rest_required', [row('fatigue', 0.30), row('monotony', 0.05)])
  const right = opt('monotony_prevention', [row('monotony', 0.25), row('fatigue', 0.00)])

  it('pairs each feature across both options', () => {
    const rows = marginRows(left, right)
    const fatigue = rows.find((r) => r.featureId === 'fatigue')!
    expect(fatigue.left).toBe(0.30)
    expect(fatigue.right).toBe(0.00)
    expect(fatigue.margin).toBeCloseTo(0.30)
    expect(fatigue.lean).toBe('left')
  })

  it('leans right when the right option gains more from the feature', () => {
    const monotony = marginRows(left, right).find((r) => r.featureId === 'monotony')!
    expect(monotony.margin).toBeCloseTo(-0.20)
    expect(monotony.lean).toBe('right')
  })

  it('includes a feature present on only one side, with zero on the other', () => {
    const rows = marginRows(opt('a', [row('solo', 0.4)]), opt('b', []))
    expect(rows).toHaveLength(1)
    expect(rows[0].right).toBe(0)
  })

  it('orders rows by descending absolute margin', () => {
    const rows = marginRows(left, right)
    expect(rows.map((r) => r.featureId)).toEqual(['fatigue', 'monotony'])
  })

  it('reports no lean when a feature contributes identically to both', () => {
    const rows = marginRows(opt('a', [row('x', 0.2)]), opt('b', [row('x', 0.2)]))
    expect(rows[0].lean).toBe('none')
  })
})

describe('realizedShares', () => {
  it('is the absolute share of total absolute contribution', () => {
    const shares = realizedShares([row('a', 0.3), row('b', -0.1)])
    expect(shares.a).toBeCloseTo(0.75)
    expect(shares.b).toBeCloseTo(0.25)
  })

  it('uses magnitude, so an opposing feature still shows its influence', () => {
    const shares = realizedShares([row('a', 0.2), row('b', -0.2)])
    expect(shares.a).toBeCloseTo(0.5)
    expect(shares.b).toBeCloseTo(0.5)
  })

  it('returns zero shares rather than NaN when nothing contributed', () => {
    const shares = realizedShares([row('a', 0), row('b', 0)])
    expect(shares.a).toBe(0)
    expect(shares.b).toBe(0)
  })
  it('represents a categorical value, which carries no derived band', () => {
    const categorical = { featureId: 'road_type', value: 'highway', band: null, r: 1, w: 0.2, contribution: 0.2 }
    expect(realizedShares([categorical]).road_type).toBe(1)
  })
})

describe('declaredShares', () => {
  it('normalizes declared weights to sum to 1', () => {
    const shares = declaredShares({ a: 0.3, b: 0.1 })
    expect(shares.a).toBeCloseTo(0.75)
    expect(shares.b).toBeCloseTo(0.25)
  })

  it('returns zero shares when every declared weight is zero', () => {
    expect(declaredShares({ a: 0, b: 0 })).toEqual({ a: 0, b: 0 })
  })
})

describe('intentVsEffect', () => {
  it('flags a feature whose evidence was unusually extreme here', () => {
    expect(intentVsEffect(0.6, 0.3)).toBe('up')
  })

  it('flags a feature that under-delivered against its declared share', () => {
    expect(intentVsEffect(0.1, 0.3)).toBe('down')
  })

  it('treats a small deviation as even', () => {
    expect(intentVsEffect(0.31, 0.30)).toBe('even')
  })

  it('is even when the declared share is zero and nothing was realized', () => {
    expect(intentVsEffect(0, 0)).toBe('even')
  })

  it('is up when something was realized from a zero declared share', () => {
    expect(intentVsEffect(0.2, 0)).toBe('up')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/frontend && npx vitest run tests/review_math.test.ts`
Expected: FAIL — cannot resolve `../src/lib/review/reviewMath`

- [ ] **Step 3: Write `types.ts`**

```ts
// app/frontend/src/lib/review/types.ts
/**
 * Shared review types.
 *
 * `ReviewChainRow` is deliberately the shape `ReasonRow` already uses
 * (see components/proposal/ReasonBreakdown.tsx) plus the ordinal `band`, so
 * service and content evidence needs no re-projection — the review reads the
 * chains where they already are.
 */

/** One feature's recorded link in a decision chain. */
export type ReviewChainRow = {
  featureId: string
  /**
   * The raw value the formula consumed. `string | number` to match `ReasonRow`
   * exactly — service and content features include categoricals (`road_type`
   * is "highway"), and narrowing to number would leave Task 11's mapping with
   * nowhere to put them. A categorical carries no derived band.
   */
  value: string | number
  /** Ordinal band word for `value`, or null when none was recorded. */
  band: string | null
  /** Response coefficient. The trigger has none, so trigger rows use 1. */
  r: number
  /** Effective weight. */
  w: number
  /** Signed contribution as recorded — never recomputed here. */
  contribution: number
}

/** One comparable option: a trigger category, a service candidate, a plan item. */
export type ReviewOption = {
  id: string
  label: string
  /** The score as RECORDED, which may differ from Σcontribution when clamped. */
  score: number
  rows: ReviewChainRow[]
  /** True when clamping bound, so shares will not reconcile with `score`. */
  clamped?: boolean
}

export type MarginRow = {
  featureId: string
  left: number
  right: number
  /** left − right. Positive pulls toward the left option. */
  margin: number
  lean: 'left' | 'right' | 'none'
}

/** Returned wherever required evidence was not recorded. Never a zero. */
export type Unavailable = { available: false; reason: string }

export const unavailable = (reason: string): Unavailable => ({ available: false, reason })
```

- [ ] **Step 4: Write `reviewMath.ts`**

```ts
// app/frontend/src/lib/review/reviewMath.ts
/**
 * Presentation arithmetic over ALREADY-RECORDED decision chains.
 *
 * Nothing here invokes an algorithm or alters a score. Framework-free and
 * I/O-free by design so it stays unit-testable standalone.
 */
import type { MarginRow, ReviewChainRow, ReviewOption } from './types'

/** Readable axis steps, ascending within each decade. */
const STEPS = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]

/**
 * One shared bound across both comparison columns, rounded up to the first
 * readable value STRICTLY above the largest magnitude — 0.299 → 0.3,
 * 0.11 → 0.125. Strictness matters: a bar that exactly fills its track reads
 * as clipped rather than as the maximum.
 */
export function scaleBound(magnitudes: number[]): number {
  const peak = Math.max(0, ...magnitudes.map((m) => Math.abs(m)))
  if (peak === 0) return STEPS[0] / 100 // a visible, honest axis for an all-zero chain
  const decade = Math.pow(10, Math.floor(Math.log10(peak)))
  for (const step of STEPS) {
    // `step * decade` is not exact in IEEE-754 — 3 * 0.1 is 0.30000000000000004,
    // 1.5 * 0.1 is 0.15000000000000002. The bound is DISPLAYED ("±0.3"), so it
    // has to be the clean decimal a reader expects, not its float residue.
    const candidate = Number((step * decade).toPrecision(12))
    if (candidate > peak) return candidate
  }
  return Number((10 * decade).toPrecision(12))
}

/**
 * Per-feature contribution to the LEFT option minus to the RIGHT one — the
 * decomposition of the margin, not of either total. A feature can be the
 * largest contributor to the winner and contribute nothing to the gap.
 */
export function marginRows(left: ReviewOption, right: ReviewOption): MarginRow[] {
  const byId = (rows: ReviewChainRow[]) =>
    new Map(rows.map((r) => [r.featureId, r.contribution]))
  const l = byId(left.rows)
  const r = byId(right.rows)

  const featureIds = Array.from(new Set([...l.keys(), ...r.keys()]))
  return featureIds
    .map((featureId) => {
      const leftValue = l.get(featureId) ?? 0
      const rightValue = r.get(featureId) ?? 0
      const margin = leftValue - rightValue
      return {
        featureId,
        left: leftValue,
        right: rightValue,
        margin,
        lean: margin > 1e-9 ? 'left' : margin < -1e-9 ? 'right' : 'none',
      } as MarginRow
    })
    .sort((a, b) => Math.abs(b.margin) - Math.abs(a.margin))
}

/** |contribution| / Σ|contribution| — the share a feature ACTUALLY took. */
export function realizedShares(rows: ReviewChainRow[]): Record<string, number> {
  const total = rows.reduce((sum, row) => sum + Math.abs(row.contribution), 0)
  const shares: Record<string, number> = {}
  for (const row of rows) {
    shares[row.featureId] = total === 0 ? 0 : Math.abs(row.contribution) / total
  }
  return shares
}

/** The INTENDED share of influence, normalized across the stage's weights. */
export function declaredShares(weights: Record<string, number>): Record<string, number> {
  const total = Object.values(weights).reduce((sum, w) => sum + Math.abs(w), 0)
  const shares: Record<string, number> = {}
  for (const [featureId, w] of Object.entries(weights)) {
    shares[featureId] = total === 0 ? 0 : Math.abs(w) / total
  }
  return shares
}

/** Deviation below this reads as agreement rather than as a finding. */
const EVEN_BAND = 0.15

/**
 * realized / declared. Algebraically this reduces to the feature's evidence
 * magnitude relative to the weighted average, so 'up' means *this feature's
 * evidence is unusually extreme here* — not that its weight is wrong.
 */
export function intentVsEffect(realized: number, declared: number): 'up' | 'down' | 'even' {
  if (declared === 0) return realized > 1e-9 ? 'up' : 'even'
  const ratio = realized / declared
  if (ratio > 1 + EVEN_BAND) return 'up'
  if (ratio < 1 - EVEN_BAND) return 'down'
  return 'even'
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd app/frontend && npx vitest run tests/review_math.test.ts`
Expected: PASS (18 tests)

- [ ] **Step 6: Commit**

```bash
git add app/frontend/src/lib/review/types.ts \
        app/frontend/src/lib/review/reviewMath.ts \
        app/frontend/tests/review_math.test.ts
git commit -m "feat(review): shared review types and core margin math

Margin decomposition, shared scale bound, realized vs declared shares, and the
intent-vs-effect ratio. Pure functions over recorded chains, no framework,
no I/O."
```

---

### Task 4: Consequence math — necessity, flip distance, played-no-part

**Files:**
- Modify: `app/frontend/src/lib/review/reviewMath.ts`
- Test: `app/frontend/tests/review_consequences.test.ts`

**Interfaces:**
- Consumes: `ReviewOption`, `ReviewChainRow`, `Unavailable` from Task 3.
- Produces:
  ```ts
  necessity(left: ReviewOption, right: ReviewOption, featureId: string): { winnerId: string; changed: boolean } | Unavailable
  flipDistance(left: ReviewOption, right: ReviewOption, featureId: string): { factor: number } | null | Unavailable
  playedNoPart(rows: ReviewChainRow[], threshold?: number): string[]
  ```
  Task 13 renders all three as sentences.

**Context:** These re-run *the recorded chain*, never an algorithm. Necessity drops one `w × r` term and redistributes its weight proportionally across the remaining features of the same option, then re-sums. Flip distance bisects a multiplier on that one feature's weight until the winner changes. Both are single-parameter with everything else held fixed, local to one decision — no combinatorial search. Both are meaningless without a named alternative, so Task 13 suppresses them on the trigger stage.

- [ ] **Step 1: Write the failing test**

```ts
// app/frontend/tests/review_consequences.test.ts
import { necessity, flipDistance, playedNoPart } from '../src/lib/review/reviewMath'
import type { ReviewOption } from '../src/lib/review/types'

const row = (featureId: string, w: number, value: number) => ({
  featureId, value, band: null, r: 1, w, contribution: w * value,
})

const opt = (id: string, rows: ReturnType<typeof row>[]): ReviewOption => ({
  id, label: id, score: rows.reduce((a, r) => a + r.contribution, 0), rows,
})

// Winner leans on fatigue; runner-up leans on monotony.
const winner = opt('rest_required', [row('fatigue', 0.5, 1.0), row('monotony', 0.1, 0.2)])
const runnerUp = opt('monotony_prevention', [row('monotony', 0.4, 0.9), row('fatigue', 0.1, 0.1)])

describe('necessity', () => {
  it('reports the alternative winning when the decisive feature is removed', () => {
    const result = necessity(winner, runnerUp, 'fatigue')
    expect('available' in result).toBe(false)
    expect(result).toMatchObject({ winnerId: 'monotony_prevention', changed: true })
  })

  it('reports the same winner when a minor feature is removed', () => {
    expect(necessity(winner, runnerUp, 'monotony')).toMatchObject({
      winnerId: 'rest_required', changed: false,
    })
  })

  it('redistributes the masked weight rather than shrinking the option', () => {
    // With fatigue masked, its 0.5 weight spreads over monotony, whose value is
    // 0.2 — so the option keeps a score instead of collapsing to nothing.
    const single = opt('a', [row('x', 0.5, 1.0), row('y', 0.5, 0.4)])
    const other = opt('b', [row('z', 0.5, 0.5)])
    expect(necessity(single, other, 'x')).toMatchObject({ winnerId: 'a' })
  })

  it('is unavailable for a feature that is not in the chain', () => {
    expect(necessity(winner, runnerUp, 'nonexistent')).toMatchObject({ available: false })
  })

  it('is unavailable when the option has no other feature to absorb the weight', () => {
    const lonely = opt('a', [row('only', 0.5, 1.0)])
    expect(necessity(lonely, runnerUp, 'only')).toMatchObject({ available: false })
  })

  it('takes the baseline winner from the RECORDED score, not the raw sum', () => {
    // Clamping makes Σcontribution exceed the reported score, so the two can
    // disagree about who won: raw sums say `clamped` (1.03 > 1.02), recorded
    // scores say `plain` (1.02 > 1.0). The recorded outcome is the real one.
    //
    // The masked feature's value must DIFFER from the remaining row's value.
    // When they are equal, redistribution reproduces Σcontribution exactly and
    // the same option wins under either baseline — the test would then pass
    // against the bug too.
    const clamped = { id: 'clamped', label: 'C', score: 1.0, clamped: true,
                      rows: [row('fatigue', 1.0, 1.0), row('monotony', 0.3, 0.1)] }
    const plain = { id: 'plain', label: 'P', score: 1.02, rows: [row('monotony', 1.02, 1.0)] }
    // Masking fatigue leaves clamped at 0.13 and plain at 1.02, so `plain` wins
    // post-mask and was already ahead on recorded score — unchanged. A raw-sum
    // baseline would call `clamped` the original winner and report changed:true.
    expect(necessity(clamped, plain, 'fatigue')).toMatchObject({
      winnerId: 'plain', changed: false,
    })
  })
})

describe('flipDistance', () => {
  it('finds the factor at which the outcome changes', () => {
    // Boosting monotony on the runner-up eventually overtakes the winner.
    const result = flipDistance(winner, runnerUp, 'monotony')
    expect(result).not.toBeNull()
    expect((result as { factor: number }).factor).toBeGreaterThan(1)
  })

  it('re-scores BOTH sides, since a feature can appear on each', () => {
    // monotony sits on both options, so a naive one-sided rescale would report
    // a flip that cannot happen.
    const result = flipDistance(winner, runnerUp, 'monotony') as { factor: number }
    const scaled = (o: ReviewOption, f: number) =>
      o.rows.reduce((a, r) => a + (r.featureId === 'monotony' ? r.contribution * f : r.contribution), 0)
    expect(scaled(runnerUp, result.factor)).toBeGreaterThanOrEqual(scaled(winner, result.factor) - 1e-3)
  })

  it('returns null when no flip exists in the bounded range', () => {
    const dominant = opt('a', [row('x', 0.9, 1.0), row('tiny', 0.001, 0.001)])
    const weak = opt('b', [row('y', 0.05, 0.1)])
    expect(flipDistance(dominant, weak, 'tiny')).toBeNull()
  })

  it('is unavailable for a feature absent from both chains', () => {
    expect(flipDistance(winner, runnerUp, 'nope')).toMatchObject({ available: false })
  })
})

describe('playedNoPart', () => {
  it('names inputs below the 2 percent realized share', () => {
    const rows = [row('big', 1.0, 1.0), row('trace', 0.001, 0.001), row('zero', 0.5, 0)]
    expect(playedNoPart(rows).sort()).toEqual(['trace', 'zero'])
  })

  it('excludes a feature at or above the threshold', () => {
    expect(playedNoPart([row('a', 1, 1), row('b', 1, 0.5)])).toEqual([])
  })

  it('names every input when nothing contributed at all', () => {
    expect(playedNoPart([row('a', 1, 0), row('b', 1, 0)]).sort()).toEqual(['a', 'b'])
  })

  it('honours an explicit threshold', () => {
    const rows = [row('a', 1, 1), row('b', 1, 0.05)]
    expect(playedNoPart(rows, 0.1)).toEqual(['b'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/frontend && npx vitest run tests/review_consequences.test.ts`
Expected: FAIL — `necessity is not a function`

- [ ] **Step 3: Implement**

Append to `app/frontend/src/lib/review/reviewMath.ts`:

```ts
import { unavailable } from './types'
import type { Unavailable } from './types'

const total = (rows: ReviewChainRow[]) => rows.reduce((sum, r) => sum + r.contribution, 0)

/**
 * Mask one feature, redistribute its weight proportionally across the option's
 * remaining features, re-sum, and report who wins now.
 *
 * Redistribution — rather than simply deleting the term — keeps the option's
 * total declared weight constant, so the comparison stays like-for-like instead
 * of penalising whichever side the masked feature happened to sit on.
 */
export function necessity(
  left: ReviewOption,
  right: ReviewOption,
  featureId: string,
): { winnerId: string; changed: boolean } | Unavailable {
  const present = [left, right].some((o) => o.rows.some((r) => r.featureId === featureId))
  if (!present) return unavailable(`no recorded contribution for ${featureId}`)

  const masked = (option: ReviewOption): number | null => {
    const target = option.rows.find((r) => r.featureId === featureId)
    if (!target) return total(option.rows)
    const rest = option.rows.filter((r) => r.featureId !== featureId)
    const restWeight = rest.reduce((sum, r) => sum + Math.abs(r.w), 0)
    if (rest.length === 0 || restWeight === 0) return null
    const scale = (restWeight + Math.abs(target.w)) / restWeight
    return rest.reduce((sum, r) => sum + r.contribution * scale, 0)
  }

  const leftScore = masked(left)
  const rightScore = masked(right)
  if (leftScore === null || rightScore === null) {
    return unavailable('no other feature could absorb the redistributed weight')
  }

  const winnerId = leftScore >= rightScore ? left.id : right.id
  // The baseline winner comes from the RECORDED scores, never from re-summing
  // contributions: a clamped option's Σcontribution exceeds its reported score,
  // so the two can disagree about who actually won. Only the post-mask scores
  // are re-summed, because no recorded value exists for a hypothetical.
  const originalWinner = left.score >= right.score ? left.id : right.id
  return { winnerId, changed: winnerId !== originalWinner }
}

/** Bisection bounds for the weight multiplier, and the resolution we report to. */
const FLIP_MAX = 10
const FLIP_TOLERANCE = 1e-3

/**
 * The factor by which this feature's declared weight would have to change for
 * the outcome to flip. Bisects over the RECORDED chain — it never re-invokes
 * the algorithm. Returns null when no flip exists below FLIP_MAX.
 *
 * Both sides are re-scored, because a feature (env_load, monotony) can appear
 * in both options and scaling only one would report an impossible flip.
 */
export function flipDistance(
  left: ReviewOption,
  right: ReviewOption,
  featureId: string,
): { factor: number } | null | Unavailable {
  const present = [left, right].some((o) => o.rows.some((r) => r.featureId === featureId))
  if (!present) return unavailable(`no recorded contribution for ${featureId}`)

  const scoreAt = (option: ReviewOption, factor: number) =>
    option.rows.reduce(
      (sum, r) => sum + (r.featureId === featureId ? r.contribution * factor : r.contribution),
      0,
    )
  // Positive while the original winner still leads.
  const gapAt = (factor: number) => scoreAt(left, factor) - scoreAt(right, factor)

  const startsLeft = gapAt(1) >= 0
  const flipped = (factor: number) => (startsLeft ? gapAt(factor) < 0 : gapAt(factor) > 0)

  if (!flipped(FLIP_MAX)) return null

  let low = 1
  let high = FLIP_MAX
  while (high - low > FLIP_TOLERANCE) {
    const mid = (low + high) / 2
    if (flipped(mid)) high = mid
    else low = mid
  }
  return { factor: high }
}

/**
 * Inputs whose realized share is below the threshold. Their absence is often
 * the most reviewable fact on the screen — "the driver's registered favourite
 * artist played no part" may well be a bug.
 */
export function playedNoPart(rows: ReviewChainRow[], threshold = 0.02): string[] {
  const shares = realizedShares(rows)
  return rows.filter((r) => (shares[r.featureId] ?? 0) < threshold).map((r) => r.featureId)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app/frontend && npx vitest run tests/review_consequences.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: Run both review-math suites together**

Run: `cd app/frontend && npx vitest run tests/review_math.test.ts tests/review_consequences.test.ts`
Expected: PASS (31 tests)

- [ ] **Step 6: Commit**

```bash
git add app/frontend/src/lib/review/reviewMath.ts \
        app/frontend/tests/review_consequences.test.ts
git commit -m "feat(review): necessity, flip distance and played-no-part

All three re-run the RECORDED chain, never an algorithm: necessity masks one
term and redistributes its weight, flip distance bisects a weight multiplier
re-scoring both sides, played-no-part names inputs below a 2% realized share."
```

---

### Task 5: Review vocabulary — domain grouping and plain phrasing

**Files:**
- Create: `app/frontend/src/lib/review/reviewVocabulary.ts`
- Test: `app/frontend/tests/review_vocabulary.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  type DomainGroup = 'driver_state' | 'road_environment' | 'preferences_history' | 'content_properties' | 'other'
  domainGroup(featureId: string): DomainGroup
  groupLabel(group: DomainGroup): BilingualLabel
  phrase(featureId: string): BilingualLabel      // plain phrasing; identifier stays separate
  bandWord(band: string | null, value: number): BilingualLabel
  ```
  Tasks 12 and 13 render these. `BilingualLabel` is `{ ja: string; en: string }`, the existing repo-wide shape consumed by `t()`.

**Context:** 07-27 §7.2 — `monotony_level` must read as *"how monotonous the road is"*, with the identifier visible only in faint grey. Bucket assignment is a **product** decision: `driving_time` and `motion_state` are arguable and belong to whoever owns the spec, so the map is a single exported table that is easy to argue with, not logic scattered across components. An unknown feature falls to `other` and keeps its raw id rather than being silently mislabelled.

- [ ] **Step 1: Write the failing test**

```ts
// app/frontend/tests/review_vocabulary.test.ts
import { domainGroup, groupLabel, phrase, bandWord } from '../src/lib/review/reviewVocabulary'

describe('domainGroup', () => {
  it('buckets driver-state features', () => {
    expect(domainGroup('drowsiness')).toBe('driver_state')
    expect(domainGroup('fatigue')).toBe('driver_state')
    expect(domainGroup('driving_anomaly')).toBe('driver_state')
  })

  it('buckets road and environment features', () => {
    expect(domainGroup('monotony')).toBe('road_environment')
    expect(domainGroup('env_load')).toBe('road_environment')
    expect(domainGroup('rest_window')).toBe('road_environment')
  })

  it('buckets preference and history features', () => {
    expect(domainGroup('oshi_affinity')).toBe('preferences_history')
    expect(domainGroup('recent_play_penalty')).toBe('preferences_history')
    expect(domainGroup('familiar_route')).toBe('preferences_history')
  })

  it('buckets content-property features', () => {
    expect(domainGroup('song_arousal')).toBe('content_properties')
    expect(domainGroup('song_valence')).toBe('content_properties')
  })

  it('falls back to other for an unrecognised feature', () => {
    expect(domainGroup('some_future_feature')).toBe('other')
  })
})

describe('groupLabel', () => {
  it('is bilingual for every group', () => {
    const groups = ['driver_state', 'road_environment', 'preferences_history', 'content_properties', 'other'] as const
    for (const g of groups) {
      const label = groupLabel(g)
      expect(label.ja.length).toBeGreaterThan(0)
      expect(label.en.length).toBeGreaterThan(0)
      expect(label.ja).not.toBe(label.en)
    }
  })
})

describe('phrase', () => {
  it('reads as plain language, not as an identifier', () => {
    expect(phrase('monotony').en).toBe('how monotonous the road is')
    expect(phrase('fatigue').en).toBe('how tired the driver is')
  })

  it('is bilingual', () => {
    expect(phrase('monotony').ja).not.toBe(phrase('monotony').en)
  })

  it('returns the raw id for an unknown feature rather than inventing prose', () => {
    expect(phrase('unknown_feature')).toEqual({ ja: 'unknown_feature', en: 'unknown_feature' })
  })
})

describe('bandWord', () => {
  it('prefers the recorded band over the derived one', () => {
    expect(bandWord('very_high', 0.1).en).toBe('very high')
  })

  it('derives a band from the value when none was recorded', () => {
    expect(bandWord(null, 0.9).en).toBe('very high')
    expect(bandWord(null, 0.5).en).toBe('moderate')
    expect(bandWord(null, 0.05).en).toBe('very low')
  })

  it('is bilingual', () => {
    expect(bandWord(null, 0.9).ja).not.toBe(bandWord(null, 0.9).en)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/frontend && npx vitest run tests/review_vocabulary.test.ts`
Expected: FAIL — cannot resolve `../src/lib/review/reviewVocabulary`

- [ ] **Step 3: Implement**

```ts
// app/frontend/src/lib/review/reviewVocabulary.ts
/**
 * Plain phrasing and domain grouping for review features.
 *
 * The GROUP MAP IS A PRODUCT DECISION, not a technical one. `driving_time` and
 * `familiar_route` in particular are arguable, and they belong to whoever owns
 * the specification — so the whole assignment lives in one table here rather
 * than scattered through components, to stay easy to challenge and change.
 *
 * An unrecognised feature is NEVER given invented prose. It falls to `other`
 * and keeps its raw identifier, so a new feature shows up as unlabelled rather
 * than as quietly mislabelled.
 */

export type BilingualLabel = { ja: string; en: string }

export type DomainGroup =
  | 'driver_state'
  | 'road_environment'
  | 'preferences_history'
  | 'content_properties'
  | 'other'

const GROUP_MEMBERS: Record<Exclude<DomainGroup, 'other'>, string[]> = {
  driver_state: ['drowsiness', 'fatigue', 'driving_anomaly', 'driving_time', 'child_passenger'],
  road_environment: [
    'monotony', 'env_load', 'rest_window', 'rest_scarcity',
    'road_type', 'traffic_jam', 'night_state', 'weather_risk', 'motion_state',
  ],
  preferences_history: [
    'familiar_route', 'oshi_affinity', 'oshi_mode', 'recent_play_penalty',
    'genre_affinity', 'skip_penalty', 'changed_penalty',
  ],
  content_properties: [
    'song_arousal', 'song_valence', 'song_tempo', 'song_loudness',
    'song_singability', 'song_era', 'humming_ease', 'full_karaoke_ease',
  ],
}

const GROUP_OF = new Map<string, DomainGroup>(
  Object.entries(GROUP_MEMBERS).flatMap(([group, members]) =>
    members.map((m) => [m, group as DomainGroup] as const),
  ),
)

export function domainGroup(featureId: string): DomainGroup {
  return GROUP_OF.get(featureId) ?? 'other'
}

const GROUP_LABELS: Record<DomainGroup, BilingualLabel> = {
  driver_state: { ja: 'ドライバーの状態', en: 'Driver state' },
  road_environment: { ja: '道路と環境', en: 'Road & environment' },
  preferences_history: { ja: '嗜好と履歴', en: 'Preferences & history' },
  content_properties: { ja: 'コンテンツの性質', en: 'Content properties' },
  other: { ja: 'その他', en: 'Other' },
}

export const groupLabel = (group: DomainGroup): BilingualLabel => GROUP_LABELS[group]

/** Plain phrasing. The identifier is shown separately in faint grey, never as the label. */
const PHRASES: Record<string, BilingualLabel> = {
  drowsiness: { ja: 'ドライバーの眠気', en: 'how drowsy the driver is' },
  fatigue: { ja: 'ドライバーの疲労', en: 'how tired the driver is' },
  driving_anomaly: { ja: '運転の乱れ', en: 'how erratic the driving is' },
  driving_time: { ja: '連続運転時間の長さ', en: 'how long they have been driving' },
  env_load: { ja: '走行環境の負荷', en: 'how demanding the environment is' },
  monotony: { ja: '道路の単調さ', en: 'how monotonous the road is' },
  rest_window: { ja: '休憩機会の近さ', en: 'how soon a rest stop is available' },
  rest_scarcity: { ja: '休憩機会の少なさ', en: 'how scarce rest stops are' },
  familiar_route: { ja: 'ルートへの慣れ', en: 'how familiar the route is' },
  child_passenger: { ja: '子供の同乗', en: 'whether a child is aboard' },
  oshi_affinity: { ja: '推しアーティストとの一致', en: 'the match to their favourite artist' },
  recent_play_penalty: { ja: '直近再生による減点', en: 'how recently this was played' },
  song_arousal: { ja: '曲の高揚感', en: 'how energising the song is' },
  song_valence: { ja: '曲の明るさ', en: 'how bright the song is' },
}

export const phrase = (featureId: string): BilingualLabel =>
  PHRASES[featureId] ?? { ja: featureId, en: featureId }

const BAND_LABELS: Record<string, BilingualLabel> = {
  very_high: { ja: '非常に高い', en: 'very high' },
  high: { ja: '高い', en: 'high' },
  moderate: { ja: '中程度', en: 'moderate' },
  low: { ja: '低い', en: 'low' },
  very_low: { ja: '非常に低い', en: 'very low' },
}

/**
 * The strength word for a raw value. A RECORDED band always wins — the derived
 * fallback exists only so a chain without ordinal data still reads in words,
 * and it must never override what the algorithm actually binned.
 */
export function bandWord(band: string | null, value: number): BilingualLabel {
  if (band && BAND_LABELS[band]) return BAND_LABELS[band]
  const key =
    value >= 0.8 ? 'very_high'
    : value >= 0.6 ? 'high'
    : value >= 0.4 ? 'moderate'
    : value >= 0.2 ? 'low'
    : 'very_low'
  return BAND_LABELS[key]
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app/frontend && npx vitest run tests/review_vocabulary.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add app/frontend/src/lib/review/reviewVocabulary.ts \
        app/frontend/tests/review_vocabulary.test.ts
git commit -m "feat(review): domain grouping and plain phrasing vocabulary

One arguable product table rather than logic spread across components.
Unknown features fall to 'other' and keep their raw id — never invented prose."
```

**Slice 1 checkpoint.** Run the full suites before moving on:
`cd app/api && python -m pytest -q` and `cd app/frontend && npx vitest run`.
Both must be green. The recorded evidence is now complete and every review
computation exists and is tested — with no UI depending on it yet.

---

## Slice 2 — Case catalog

### Task 6: Case schema, first two cases, contract test

**Files:**
- Create: `combined_contracts/schema/combined_test_case.schema.json`
- Create: `combined_contracts/test_cases/case-c01-alert-daytime-control.json`
- Create: `combined_contracts/test_cases/case-c03-monotonous-highway.json`
- Test: `app/api/tests/test_combined_case_contract.py`

**Interfaces:**
- Consumes: nothing.
- Produces: the on-disk case contract. Task 7 types it in TS; Task 8 resolves it.

**Context — real IDs to reference (do not invent):**
- Scenarios: `uc01_fatigue_recovery_v0_1`, `uc02_monotony_v0_1`
- Route presets: `long_tokyo_osaka`, `middle_tokyo_karuizawa`, `short_tokyo_chichibu`
- Trigger packages: `aica_transparent_hybrid_trigger_v1`, `nri_fatigue_score_v1`
- Service package: `aica_transparent_service_selector_v1`; content: `aica_transparent_content_selector_v1`
- Driver profiles: any `preset_id` under `proposal_contracts/presets/`, e.g. `preset-journey-a-1-cruising-fresh`

**Note:** `uc02_monotony_v0_1` is in `HIDDEN_SCENARIO_IDS` (`MergedSetupPanel.tsx:114`), which hides it from the *manual* dropdown. A case may still reference it — Task 8 resolves scenarios directly and must not consult that hidden set.

There is no `checkpoints`, `expected`, `hypothesis`, `top_fit_min` or `contrast` field. Adding any of them recreates the problem this design exists to correct: a record of baseline behaviour masquerading as an independent expectation.

- [ ] **Step 1: Write the failing contract test**

```python
# app/api/tests/test_combined_case_contract.py
"""Every committed experience test case validates and resolves.

These tests read the contract directory from disk — no endpoint is involved,
because the catalog is bundled into the frontend rather than served.
"""
from __future__ import annotations

import json
import pathlib

import pytest

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
_CASES_DIR = _REPO_ROOT / "combined_contracts" / "test_cases"
_SCHEMA = _REPO_ROOT / "combined_contracts" / "schema" / "combined_test_case.schema.json"

_CASE_FILES = sorted(_CASES_DIR.glob("case-*.json")) if _CASES_DIR.exists() else []


def _load(path: pathlib.Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_schema_file_exists():
    assert _SCHEMA.exists(), "the case schema must be committed beside the cases"


def test_at_least_one_case_is_committed():
    assert _CASE_FILES, "no case-*.json found in combined_contracts/test_cases"


@pytest.mark.parametrize("path", _CASE_FILES, ids=lambda p: p.stem)
def test_case_validates_against_the_schema(path):
    jsonschema = pytest.importorskip("jsonschema")
    jsonschema.validate(instance=_load(path), schema=_load(_SCHEMA))


@pytest.mark.parametrize("path", _CASE_FILES, ids=lambda p: p.stem)
def test_case_id_matches_its_filename(path):
    assert _load(path)["case_id"] == path.stem


@pytest.mark.parametrize("path", _CASE_FILES, ids=lambda p: p.stem)
def test_case_carries_no_expectation_fields(path):
    """Phase 1 authors NO expectations — the expectation is review's OUTPUT."""
    case = _load(path)
    forbidden = {"checkpoints", "expected", "hypothesis", "top_fit_min", "contrast"}
    assert forbidden.isdisjoint(case), f"{sorted(forbidden & set(case))} must not be authored"


@pytest.mark.parametrize("path", _CASE_FILES, ids=lambda p: p.stem)
def test_every_referenced_artifact_exists(path):
    case = _load(path)
    journey = case["journey"]

    scenario = _REPO_ROOT / "scenarios" / f"{journey['scenario_ref']}.json"
    assert scenario.exists(), f"unknown scenario_ref {journey['scenario_ref']}"

    route = _REPO_ROOT / "routes" / "presets" / f"{journey['route_preset_ref']}.json"
    assert route.exists(), f"unknown route_preset_ref {journey['route_preset_ref']}"

    profile = _REPO_ROOT / "proposal_contracts" / "presets" / f"{case['persona']['profile_ref']}.json"
    assert profile.exists(), f"unknown profile_ref {case['persona']['profile_ref']}"

    for key, package_id in case["algorithm_defaults"].items():
        assert (_REPO_ROOT / "packages" / package_id).is_dir(), f"unknown {key} package {package_id}"


@pytest.mark.parametrize("path", _CASE_FILES, ids=lambda p: p.stem)
def test_user_facing_text_is_bilingual(path):
    case = _load(path)
    for field in (case["title"], case["brief"], case["persona"]["narrative"]):
        assert field["ja"].strip() and field["en"].strip()
        assert field["ja"] != field["en"]
    for chip in case["what_to_watch"]:
        assert chip["ja"].strip() and chip["en"].strip()


@pytest.mark.parametrize("path", _CASE_FILES, ids=lambda p: p.stem)
def test_journey_is_deterministic(path):
    journey = _load(path)["journey"]
    assert isinstance(journey["seed"], int)
    assert isinstance(journey["tick_seconds"], int) and journey["tick_seconds"] > 0


def test_case_ids_are_unique():
    ids = [_load(p)["case_id"] for p in _CASE_FILES]
    assert len(ids) == len(set(ids))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/api && python -m pytest tests/test_combined_case_contract.py -v`
Expected: FAIL — `test_schema_file_exists` and `test_at_least_one_case_is_committed`

- [ ] **Step 3: Write the schema**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "combined_test_case.schema.json",
  "title": "CombinedTestCase",
  "description": "One reviewable experience test case. Phase 1 authors NO expectations: the expectation is what human review produces, not an input.",
  "type": "object",
  "additionalProperties": false,
  "required": ["case_id", "schema_version", "version", "title", "brief", "what_to_watch", "persona", "journey", "algorithm_defaults"],
  "properties": {
    "case_id": { "type": "string", "pattern": "^case-[a-z0-9-]+$" },
    "schema_version": { "type": "string", "const": "1.0.0" },
    "version": { "type": "string" },
    "title": { "$ref": "#/definitions/bilingual" },
    "brief": {
      "description": "Two sentences: what the case is, and why it is worth running.",
      "$ref": "#/definitions/bilingual"
    },
    "what_to_watch": {
      "description": "Situation/preference dimensions to focus on, rendered as chips.",
      "type": "array", "minItems": 1,
      "items": { "$ref": "#/definitions/bilingual" }
    },
    "persona": {
      "type": "object",
      "additionalProperties": false,
      "required": ["persona_id", "name", "narrative", "profile_ref"],
      "properties": {
        "persona_id": { "type": "string" },
        "name": { "$ref": "#/definitions/bilingual" },
        "narrative": { "$ref": "#/definitions/bilingual" },
        "goals": { "type": "array", "items": { "$ref": "#/definitions/bilingual" } },
        "preferences": { "type": "array", "items": { "$ref": "#/definitions/bilingual" } },
        "constraints": { "type": "array", "items": { "$ref": "#/definitions/bilingual" } },
        "assumptions": {
          "description": "ONLY assumptions relevant to this case. No decorative demographics.",
          "type": "array", "items": { "$ref": "#/definitions/bilingual" }
        },
        "profile_ref": {
          "description": "A committed proposal preset id; its driver_profile is resolved and frozen into the run.",
          "type": "string"
        },
        "profile_ref_version": { "type": "string" }
      }
    },
    "journey": {
      "type": "object",
      "additionalProperties": false,
      "required": ["narrative", "scenario_ref", "route_preset_ref", "seed", "tick_seconds"],
      "properties": {
        "narrative": { "$ref": "#/definitions/bilingual" },
        "scenario_ref": { "type": "string" },
        "route_preset_ref": { "type": "string" },
        "seed": { "type": "integer" },
        "tick_seconds": { "type": "integer", "minimum": 1 },
        "fixed_overrides": {
          "description": "Situation/context this case pins. Live values (drowsiness, fatigue, monotony, traffic, road) still come from the tick engine.",
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "initial_drowsiness": { "type": "number", "minimum": 0, "maximum": 100 },
            "initial_fatigue": { "type": "number", "minimum": 0, "maximum": 100 },
            "is_night": { "type": "boolean" },
            "child_passenger": { "type": "boolean" },
            "route_tags": { "type": "array", "items": { "type": "string" } },
            "destination_tags": { "type": "array", "items": { "type": "string" } },
            "multiple_passengers": { "type": "boolean" },
            "mountain_range_km": { "type": "array", "items": { "type": "number" }, "minItems": 2, "maxItems": 2 },
            "jam_range_km": { "type": "array", "items": { "type": "number" }, "minItems": 2, "maxItems": 2 }
          }
        },
        "automatic_path": {
          "description": "Deterministic choices only — NOT a general walkthrough language. Omitted means the quickview convention: rank 1.",
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "service_choice": { "type": "string", "enum": ["rank_1"] },
            "rest_response": { "type": "string", "enum": ["accept", "decline", "ignore"] },
            "sleep_minutes": { "type": "integer", "minimum": 0 }
          }
        }
      }
    },
    "algorithm_defaults": {
      "description": "Defaults, NOT part of expected behaviour. A candidate version may be substituted while the case stays the same.",
      "type": "object",
      "additionalProperties": false,
      "required": ["trigger", "service", "content"],
      "properties": {
        "trigger": { "type": "string" },
        "service": { "type": "string" },
        "content": { "type": "string" }
      }
    }
  },
  "definitions": {
    "bilingual": {
      "type": "object",
      "additionalProperties": false,
      "required": ["ja", "en"],
      "properties": { "ja": { "type": "string" }, "en": { "type": "string" } }
    }
  }
}
```

- [ ] **Step 4: Write C-01 — the alert daytime control**

`combined_contracts/test_cases/case-c01-alert-daytime-control.json`:

```json
{
  "case_id": "case-c01-alert-daytime-control",
  "schema_version": "1.0.0",
  "version": "1.0.0",
  "title": { "ja": "C-01 日中・覚醒状態の対照ケース", "en": "C-01 Alert daytime control" },
  "brief": {
    "ja": "十分に休養したドライバーが、日中の短いルートを走ります。トリガーが一切発火しないことを確認するための対照ケースです。",
    "en": "A well-rested driver on a short daytime route. The control case: it exists to confirm nothing fires when nothing should."
  },
  "what_to_watch": [
    { "ja": "早すぎる休憩提案がないか", "en": "No premature rest proposal" },
    { "ja": "単調さスコアが閾値未満に留まるか", "en": "Monotony stays below threshold" }
  ],
  "persona": {
    "persona_id": "persona-rested-commuter",
    "name": { "ja": "休養十分の通勤ドライバー", "en": "Well-rested commuter" },
    "narrative": {
      "ja": "前夜に十分な睡眠をとり、通い慣れた道を昼間に短時間운転します。運転支援からの介入を特に必要としていません。",
      "en": "Slept well last night and is driving a familiar road for a short daytime trip. Needs no intervention from the assistant."
    },
    "goals": [{ "ja": "予定通りに目的地へ着く", "en": "Arrive on schedule" }],
    "preferences": [{ "ja": "不要な通知を好まない", "en": "Dislikes unnecessary notifications" }],
    "constraints": [],
    "assumptions": [
      { "ja": "出発時の眠気・疲労はいずれも低い", "en": "Both drowsiness and fatigue start low" }
    ],
    "profile_ref": "preset-journey-a-1-cruising-fresh"
  },
  "journey": {
    "narrative": {
      "ja": "日中、東京から秩父までの短いルートを走行します。",
      "en": "A short daytime drive from Tokyo to Chichibu."
    },
    "scenario_ref": "uc01_fatigue_recovery_v0_1",
    "route_preset_ref": "short_tokyo_chichibu",
    "seed": 1042,
    "tick_seconds": 60,
    "fixed_overrides": {
      "initial_drowsiness": 10,
      "initial_fatigue": 12,
      "is_night": false,
      "child_passenger": false
    },
    "automatic_path": { "service_choice": "rank_1" }
  },
  "algorithm_defaults": {
    "trigger": "aica_transparent_hybrid_trigger_v1",
    "service": "aica_transparent_service_selector_v1",
    "content": "aica_transparent_content_selector_v1"
  }
}
```

- [ ] **Step 5: Write C-03 — monotonous highway, low fatigue**

`combined_contracts/test_cases/case-c03-monotonous-highway.json`:

```json
{
  "case_id": "case-c03-monotonous-highway",
  "schema_version": "1.0.0",
  "version": "1.0.0",
  "title": { "ja": "C-03 単調な高速道路・低疲労", "en": "C-03 Monotonous highway, low fatigue" },
  "brief": {
    "ja": "疲労は低いまま、変化の乏しい高速道路を長く走り続けます。介入の理由が疲労ではなく単調さであることを確認します。",
    "en": "A long stretch of featureless highway while fatigue stays low. Checks that any intervention is caused by monotony rather than by fatigue."
  },
  "what_to_watch": [
    { "ja": "単調さと疲労のどちらが決め手か", "en": "Monotony versus fatigue as the deciding input" },
    { "ja": "走行中でも使えるサービスが選ばれるか", "en": "A driving-capable service is chosen" },
    { "ja": "選ばれた曲の高揚感", "en": "How energising the chosen songs are" }
  ],
  "persona": {
    "persona_id": "persona-long-haul-regular",
    "name": { "ja": "長距離運転に慣れたドライバー", "en": "Seasoned long-haul driver" },
    "narrative": {
      "ja": "長距離運転に慣れており体力にも余裕がありますが、単調な高速道路では注意が散漫になりがちです。音楽や声かけによる働きかけを歓迎します。",
      "en": "Comfortable with long drives and physically fresh, but prone to drifting attention on featureless highway. Welcomes music or a spoken prompt."
    },
    "goals": [{ "ja": "集中を保ったまま走り切る", "en": "Stay engaged for the whole drive" }],
    "preferences": [{ "ja": "対話的なコンテンツを好む", "en": "Prefers interactive content" }],
    "constraints": [
      { "ja": "走行中は停車が必要なサービスを使えない", "en": "Cannot use services that require stopping" }
    ],
    "assumptions": [
      { "ja": "疲労は介入時点でも低いままである", "en": "Fatigue remains low at the moment of intervention" }
    ],
    "profile_ref": "preset-journey-a-2-monotony-building"
  },
  "journey": {
    "narrative": {
      "ja": "東京から大阪までの長距離ルートを、変化の乏しい高速区間を含めて走行します。",
      "en": "The long Tokyo–Osaka route, including a long featureless highway stretch."
    },
    "scenario_ref": "uc02_monotony_v0_1",
    "route_preset_ref": "long_tokyo_osaka",
    "seed": 1042,
    "tick_seconds": 60,
    "fixed_overrides": {
      "initial_drowsiness": 15,
      "initial_fatigue": 18,
      "is_night": false,
      "child_passenger": false
    },
    "automatic_path": { "service_choice": "rank_1" }
  },
  "algorithm_defaults": {
    "trigger": "aica_transparent_hybrid_trigger_v1",
    "service": "aica_transparent_service_selector_v1",
    "content": "aica_transparent_content_selector_v1"
  }
}
```

- [ ] **Step 6: Run the contract test to verify it passes**

Run: `cd app/api && python -m pytest tests/test_combined_case_contract.py -v`
Expected: PASS. If `jsonschema` is not installed the schema test skips — check the skip reason and, if it is absent, keep the remaining structural tests as the real gate rather than adding a dependency.

- [ ] **Step 7: Verify the referenced profile presets actually exist**

Run: `ls proposal_contracts/presets/preset-journey-a-1-cruising-fresh.json proposal_contracts/presets/preset-journey-a-2-monotony-building.json`
Expected: both listed. If either is missing, substitute a real `preset_id` from that directory and re-run Step 6.

- [ ] **Step 8: Commit**

```bash
git add combined_contracts/ app/api/tests/test_combined_case_contract.py
git commit -m "feat(cases): case schema and the first two experience test cases

C-01 (alert daytime control) and C-03 (monotonous highway, low fatigue), with
a schema that structurally forbids checkpoints, expected, hypothesis and
contrast — Phase 1 authors no expectations."
```

---

### Task 7: Bundle the catalog into the frontend

**Files:**
- Modify: `app/frontend/vite.config.ts`
- Create: `app/frontend/src/lib/review/caseCatalog.ts`
- Test: `app/frontend/tests/case_catalog.test.ts`

**Interfaces:**
- Consumes: the committed JSON from Task 6.
- Produces:
  ```ts
  type BilingualLabel = { ja: string; en: string }   // re-exported from reviewVocabulary
  type CombinedTestCase = { case_id, schema_version, version, title, brief, what_to_watch,
                            persona: CasePersona, journey: CaseJourney, algorithm_defaults: CaseAlgorithmDefaults }
  listCases(): CombinedTestCase[]         // sorted by case_id
  getCase(caseId: string): CombinedTestCase | null
  ```
  Tasks 8 and 9 consume both functions.

**Context:** Cases are bundled, not fetched — chosen because bundling is the only option that survives a later htmlapp export (htmlapp has no backend and already bundles scenarios/routes/packages as TS-imported JSON). `import.meta.glob` with `eager: true` inlines every matching file at build time, and Vite re-imports on change, so cases stay live in dev.

`combined_contracts/` sits at the repo root, outside `app/frontend`, so Vite needs both an alias and filesystem permission to read it.

- [ ] **Step 1: Write the failing test**

```ts
// app/frontend/tests/case_catalog.test.ts
import { listCases, getCase } from '../src/lib/review/caseCatalog'

describe('listCases', () => {
  it('loads every committed case', () => {
    const cases = listCases()
    expect(cases.length).toBeGreaterThanOrEqual(2)
  })

  it('is sorted by case id, so the picker order is stable', () => {
    const ids = listCases().map((c) => c.case_id)
    expect(ids).toEqual([...ids].sort())
  })

  it('includes the two slice-2 cases', () => {
    const ids = listCases().map((c) => c.case_id)
    expect(ids).toContain('case-c01-alert-daytime-control')
    expect(ids).toContain('case-c03-monotonous-highway')
  })

  it('exposes bilingual title, brief and what-to-watch', () => {
    const c = getCase('case-c03-monotonous-highway')!
    expect(c.title.ja).toBeTruthy()
    expect(c.title.en).toBeTruthy()
    expect(c.brief.ja).not.toBe(c.brief.en)
    expect(c.what_to_watch.length).toBeGreaterThan(0)
  })

  it('exposes the journey references the resolver needs', () => {
    const j = getCase('case-c03-monotonous-highway')!.journey
    expect(j.scenario_ref).toBe('uc02_monotony_v0_1')
    expect(j.route_preset_ref).toBe('long_tokyo_osaka')
    expect(j.seed).toBe(1042)
    expect(j.tick_seconds).toBe(60)
  })

  it('exposes the three algorithm defaults', () => {
    const d = getCase('case-c01-alert-daytime-control')!.algorithm_defaults
    expect(d.trigger).toBe('aica_transparent_hybrid_trigger_v1')
    expect(d.service).toBe('aica_transparent_service_selector_v1')
    expect(d.content).toBe('aica_transparent_content_selector_v1')
  })

  it('carries no authored expectation fields', () => {
    for (const c of listCases()) {
      for (const forbidden of ['checkpoints', 'expected', 'hypothesis', 'contrast']) {
        expect(c as Record<string, unknown>).not.toHaveProperty(forbidden)
      }
    }
  })
})

describe('getCase', () => {
  it('returns null for an unknown id rather than throwing', () => {
    expect(getCase('case-does-not-exist')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/frontend && npx vitest run tests/case_catalog.test.ts`
Expected: FAIL — cannot resolve `../src/lib/review/caseCatalog`

- [ ] **Step 3: Add the Vite alias**

In `app/frontend/vite.config.ts`, add the import and two config blocks:

```ts
import path from 'node:path'
```

Inside `defineConfig({...})`, alongside `plugins`:

```ts
  resolve: {
    alias: {
      // The committed contract directory is the SINGLE source of truth — the
      // frontend reads the same files pytest validates, with no copies.
      '@contracts': path.resolve(__dirname, '../../combined_contracts'),
    },
  },
```

And inside the existing `server: {...}` block, alongside `proxy`:

```ts
    fs: {
      // combined_contracts/ lives above the Vite root, so serving it must be
      // allowed explicitly for the dev server.
      allow: [path.resolve(__dirname, '..', '..')],
    },
```

- [ ] **Step 4: Write the catalog loader**

```ts
// app/frontend/src/lib/review/caseCatalog.ts
/**
 * The committed experience test cases, bundled at build time.
 *
 * Bundled rather than fetched: there is no registry endpoint, and a bundled
 * catalog is the form that survives a later export to a server-less
 * distribution unchanged. `import.meta.glob(..., { eager: true })` inlines
 * every matching file; Vite re-imports on change so cases stay live in dev.
 *
 * The shapes here mirror combined_contracts/schema/combined_test_case.schema.json.
 * That schema is the authority, and pytest validates every committed file
 * against it — these types are the reader's view, not a second contract.
 */
import type { BilingualLabel } from './reviewVocabulary'

export type { BilingualLabel }

export type CasePersona = {
  persona_id: string
  name: BilingualLabel
  narrative: BilingualLabel
  goals?: BilingualLabel[]
  preferences?: BilingualLabel[]
  constraints?: BilingualLabel[]
  assumptions?: BilingualLabel[]
  /** A committed proposal preset id; its driver_profile is resolved into the run. */
  profile_ref: string
  profile_ref_version?: string
}

export type CaseFixedOverrides = {
  initial_drowsiness?: number
  initial_fatigue?: number
  is_night?: boolean
  child_passenger?: boolean
  route_tags?: string[]
  destination_tags?: string[]
  multiple_passengers?: boolean
  mountain_range_km?: [number, number]
  jam_range_km?: [number, number]
}

export type CaseJourney = {
  narrative: BilingualLabel
  scenario_ref: string
  route_preset_ref: string
  seed: number
  tick_seconds: number
  fixed_overrides?: CaseFixedOverrides
  automatic_path?: {
    service_choice?: 'rank_1'
    rest_response?: 'accept' | 'decline' | 'ignore'
    sleep_minutes?: number
  }
}

export type CaseAlgorithmDefaults = { trigger: string; service: string; content: string }

export type CombinedTestCase = {
  case_id: string
  schema_version: string
  version: string
  title: BilingualLabel
  brief: BilingualLabel
  what_to_watch: BilingualLabel[]
  persona: CasePersona
  journey: CaseJourney
  algorithm_defaults: CaseAlgorithmDefaults
}

const MODULES = import.meta.glob<CombinedTestCase>('@contracts/test_cases/case-*.json', {
  eager: true,
  import: 'default',
})

// Sorted once at module load — the picker's order must not depend on glob order,
// which is not guaranteed stable across platforms.
const CASES: CombinedTestCase[] = Object.values(MODULES).sort((a, b) =>
  a.case_id.localeCompare(b.case_id),
)

const BY_ID = new Map(CASES.map((c) => [c.case_id, c]))

export const listCases = (): CombinedTestCase[] => CASES

/** Null rather than a throw: an unknown id is a stale selection, not a crash. */
export const getCase = (caseId: string): CombinedTestCase | null => BY_ID.get(caseId) ?? null
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd app/frontend && npx vitest run tests/case_catalog.test.ts`
Expected: PASS (8 tests)

If the glob resolves to nothing, the alias is not reaching Vitest. `vite.config.ts` here is a `vitest/config` `defineConfig`, so `resolve.alias` applies to both — confirm the alias path resolves by running `node -e "console.log(require('path').resolve('app/frontend', '../../combined_contracts'))"` from the repo root and checking the directory exists.

- [ ] **Step 6: Verify the production build inlines the cases**

Run: `cd app/frontend && npx tsc --noEmit && npx vite build`
Expected: clean typecheck and a successful build. A build-time failure here means the alias works in test but not in build — fix before proceeding, since every later task depends on the catalog loading.

- [ ] **Step 7: Commit**

```bash
git add app/frontend/vite.config.ts \
        app/frontend/src/lib/review/caseCatalog.ts \
        app/frontend/tests/case_catalog.test.ts
git commit -m "feat(cases): bundle the committed case catalog into the frontend

Vite alias onto combined_contracts/ plus an eager glob, so the frontend reads
the same files pytest validates with no copies and no registry endpoint."
```

---

### Task 8: Case resolver — apply a case to the scoped stores

**Files:**
- Create: `app/frontend/src/lib/review/caseResolver.ts`
- Test: `app/frontend/tests/case_resolver.test.ts`

**Interfaces:**
- Consumes: `CombinedTestCase` from Task 7.
- Produces:
  ```ts
  type ResolvedCaseSetup = {
    scenarioId, routePresetId, triggerPackageId, servicePackageId, contentPackageId: string
    seed, tickSeconds: number
    initialDrowsiness, initialFatigue: number | null
    contextOverrides, situationFields: Record<string, unknown>
    mountainRangeKm, jamRangeKm: [number, number] | null
    profileRef: string
  }
  resolveCase(testCase: CombinedTestCase): ResolvedCaseSetup
  caseDispatches(setup: ResolvedCaseSetup): { run: RunAction[]; proposal: ProposalAction[] }
  differsFromCase(setup: ResolvedCaseSetup, live: LiveSetupSnapshot): string[]
  ```
  Task 9 calls all three. `differsFromCase` returns the drifted field keys so the panel can show its "differs from the case as defined · Reset" note.

**Context — the real action names** (verified against `src/state/runStore.ts` and `src/state/proposalStore.ts`; do not guess):

- runStore: `SELECT_SCENARIO`, `SELECT_PACKAGE`, `SET_RUN_SEED`, `SET_TICK_SECONDS`, `SET_INITIAL_DROWSINESS`, `SET_INITIAL_FATIGUE`, `SET_CONTEXT_OVERRIDE`
- proposalStore: `SET_SERVICE_PACKAGE`, `SET_CONTENT_PACKAGE`, `LOAD_PROFILE`, `SET_SITUATION_FIELD`

The route preset is **panel-local** in `MergedSetupPanel`, not in runStore — `SELECT_SCENARIO` clears a local-source route, so keeping it local avoids that interaction (`MergedSetupPanel.tsx:146-153`). `resolveCase` therefore returns `routePresetId` for the panel to apply through its own `handleSelectRoutePreset`, and emits no route dispatch. Same for `mountainRangeKm` / `jamRangeKm`, which are panel-local `useState`.

`uc02_monotony_v0_1` is in `HIDDEN_SCENARIO_IDS`, which governs the manual dropdown only. Case resolution dispatches `SELECT_SCENARIO` regardless — the hidden set is a picker concern, not a resolution rule.

This module builds plain objects and dispatches nothing, which is what makes it testable without mounting React.

- [ ] **Step 1: Write the failing test**

```ts
// app/frontend/tests/case_resolver.test.ts
import { resolveCase, caseDispatches, differsFromCase } from '../src/lib/review/caseResolver'
import { getCase } from '../src/lib/review/caseCatalog'

const c01 = getCase('case-c01-alert-daytime-control')!
const c03 = getCase('case-c03-monotonous-highway')!

describe('resolveCase', () => {
  it('resolves the journey references', () => {
    const setup = resolveCase(c03)
    expect(setup.scenarioId).toBe('uc02_monotony_v0_1')
    expect(setup.routePresetId).toBe('long_tokyo_osaka')
    expect(setup.seed).toBe(1042)
    expect(setup.tickSeconds).toBe(60)
  })

  it('resolves all three algorithm defaults', () => {
    const setup = resolveCase(c01)
    expect(setup.triggerPackageId).toBe('aica_transparent_hybrid_trigger_v1')
    expect(setup.servicePackageId).toBe('aica_transparent_service_selector_v1')
    expect(setup.contentPackageId).toBe('aica_transparent_content_selector_v1')
  })

  it('resolves the persona profile reference', () => {
    expect(resolveCase(c01).profileRef).toBe('preset-journey-a-1-cruising-fresh')
  })

  it('maps fixed overrides onto initial state and context overrides', () => {
    const setup = resolveCase(c01)
    expect(setup.initialDrowsiness).toBe(10)
    expect(setup.initialFatigue).toBe(12)
    expect(setup.contextOverrides.is_night).toBe(false)
    expect(setup.contextOverrides.child_passenger).toBe(false)
  })

  it('leaves unset overrides null rather than inventing a default', () => {
    const bare = { ...c01, journey: { ...c01.journey, fixed_overrides: undefined } }
    const setup = resolveCase(bare)
    expect(setup.initialDrowsiness).toBeNull()
    expect(setup.initialFatigue).toBeNull()
    expect(setup.contextOverrides).toEqual({})
    expect(setup.mountainRangeKm).toBeNull()
  })

  it('carries painted ranges through when the case pins them', () => {
    const painted = {
      ...c03,
      journey: { ...c03.journey, fixed_overrides: { ...c03.journey.fixed_overrides, jam_range_km: [40, 60] } },
    }
    expect(resolveCase(painted as typeof c03).jamRangeKm).toEqual([40, 60])
  })
})

describe('caseDispatches', () => {
  const { run, proposal } = caseDispatches(resolveCase(c03))
  const runTypes = run.map((a) => a.type)

  it('selects the scenario even though it is hidden from the manual picker', () => {
    expect(run).toContainEqual({ type: 'SELECT_SCENARIO', id: 'uc02_monotony_v0_1' })
  })

  it('selects the trigger package and pins the seed and tick', () => {
    expect(runTypes).toContain('SELECT_PACKAGE')
    expect(run).toContainEqual({ type: 'SET_RUN_SEED', seed: 1042 })
    expect(run).toContainEqual({ type: 'SET_TICK_SECONDS', seconds: 60 })
  })

  it('sets both proposal packages and loads the persona profile', () => {
    const types = proposal.map((a) => a.type)
    expect(types).toContain('SET_SERVICE_PACKAGE')
    expect(types).toContain('SET_CONTENT_PACKAGE')
    expect(types).toContain('LOAD_PROFILE')
  })

  it('emits no route dispatch — the route is panel-local', () => {
    expect(runTypes).not.toContain('SELECT_ROUTE')
    expect(runTypes).not.toContain('SET_ALTERNATIVES')
  })

  it('emits no initial-state dispatch when the case pins none', () => {
    const bare = { ...c01, journey: { ...c01.journey, fixed_overrides: undefined } }
    const types = caseDispatches(resolveCase(bare)).run.map((a) => a.type)
    expect(types).not.toContain('SET_INITIAL_DROWSINESS')
    expect(types).not.toContain('SET_CONTEXT_OVERRIDE')
  })
})

describe('differsFromCase', () => {
  const setup = resolveCase(c03)
  const asLive = {
    scenarioId: setup.scenarioId, routePresetId: setup.routePresetId,
    triggerPackageId: setup.triggerPackageId, servicePackageId: setup.servicePackageId,
    contentPackageId: setup.contentPackageId, seed: setup.seed, tickSeconds: setup.tickSeconds,
    initialDrowsiness: setup.initialDrowsiness, initialFatigue: setup.initialFatigue,
    profileRef: setup.profileRef,
  }

  it('reports nothing when the live setup matches the case', () => {
    expect(differsFromCase(setup, asLive)).toEqual([])
  })

  it('names the drifted field', () => {
    expect(differsFromCase(setup, { ...asLive, seed: 7 })).toEqual(['seed'])
  })

  it('names every drifted field', () => {
    expect(differsFromCase(setup, { ...asLive, seed: 7, tickSeconds: 30 }).sort())
      .toEqual(['seed', 'tickSeconds'])
  })

  it('treats a swapped algorithm package as drift, since it is the tuning loop', () => {
    expect(differsFromCase(setup, { ...asLive, triggerPackageId: 'nri_fatigue_score_v1' }))
      .toEqual(['triggerPackageId'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/frontend && npx vitest run tests/case_resolver.test.ts`
Expected: FAIL — cannot resolve `../src/lib/review/caseResolver`

- [ ] **Step 3: Implement**

```ts
// app/frontend/src/lib/review/caseResolver.ts
/**
 * Resolve a committed case into the existing Combined setup.
 *
 * Builds PLAIN objects and dispatches nothing itself — that is what lets it be
 * tested without mounting React, and it keeps the panel in charge of what the
 * panel owns (the route preset and painted ranges are panel-local `useState`,
 * NOT store state, because SELECT_SCENARIO clears a local-source route).
 *
 * Selecting a case SEEDS the setup; it does not lock it. Any later edit is
 * legitimate — `differsFromCase` exists so the panel can SAY the setup drifted,
 * not to prevent it.
 */
import type { CombinedTestCase } from './caseCatalog'

export type ResolvedCaseSetup = {
  scenarioId: string
  routePresetId: string
  triggerPackageId: string
  servicePackageId: string
  contentPackageId: string
  seed: number
  tickSeconds: number
  initialDrowsiness: number | null
  initialFatigue: number | null
  contextOverrides: Record<string, unknown>
  situationFields: Record<string, unknown>
  mountainRangeKm: [number, number] | null
  jamRangeKm: [number, number] | null
  profileRef: string
}

/** The subset of live setup compared against a case. */
export type LiveSetupSnapshot = Pick<
  ResolvedCaseSetup,
  | 'scenarioId' | 'routePresetId' | 'triggerPackageId' | 'servicePackageId'
  | 'contentPackageId' | 'seed' | 'tickSeconds' | 'initialDrowsiness'
  | 'initialFatigue' | 'profileRef'
>

export type RunAction = { type: string; [key: string]: unknown }
export type ProposalAction = { type: string; [key: string]: unknown }

export function resolveCase(testCase: CombinedTestCase): ResolvedCaseSetup {
  const { journey, persona, algorithm_defaults: defaults } = testCase
  const fixed = journey.fixed_overrides ?? {}

  // ONLY what the case actually pins reaches the setup. An absent override stays
  // null/absent so the scenario's own default applies — never a guessed value.
  const contextOverrides: Record<string, unknown> = {}
  if (fixed.is_night !== undefined) contextOverrides.is_night = fixed.is_night
  if (fixed.child_passenger !== undefined) contextOverrides.child_passenger = fixed.child_passenger

  const situationFields: Record<string, unknown> = {}
  if (fixed.route_tags !== undefined) situationFields.route_tags = fixed.route_tags
  if (fixed.destination_tags !== undefined) situationFields.destination_tags = fixed.destination_tags
  if (fixed.multiple_passengers !== undefined) {
    situationFields.multiple_passengers = fixed.multiple_passengers
  }

  return {
    scenarioId: journey.scenario_ref,
    routePresetId: journey.route_preset_ref,
    triggerPackageId: defaults.trigger,
    servicePackageId: defaults.service,
    contentPackageId: defaults.content,
    seed: journey.seed,
    tickSeconds: journey.tick_seconds,
    initialDrowsiness: fixed.initial_drowsiness ?? null,
    initialFatigue: fixed.initial_fatigue ?? null,
    contextOverrides,
    situationFields,
    mountainRangeKm: fixed.mountain_range_km ?? null,
    jamRangeKm: fixed.jam_range_km ?? null,
    profileRef: persona.profile_ref,
  }
}

/**
 * The store actions that apply a resolved case.
 *
 * No route action: the route preset is panel-local. The profile uses
 * LOAD_PROFILE (replaces ONLY world.driver_profile) rather than LOAD_PRESET
 * (replaces the whole world), so the case's situation overrides are not
 * immediately overwritten by the preset's own world.
 */
export function caseDispatches(setup: ResolvedCaseSetup): {
  run: RunAction[]
  proposal: ProposalAction[]
} {
  const run: RunAction[] = [
    { type: 'SELECT_PACKAGE', id: setup.triggerPackageId },
    { type: 'SELECT_SCENARIO', id: setup.scenarioId },
    { type: 'SET_RUN_SEED', seed: setup.seed },
    { type: 'SET_TICK_SECONDS', seconds: setup.tickSeconds },
  ]
  if (setup.initialDrowsiness !== null) {
    run.push({ type: 'SET_INITIAL_DROWSINESS', value: setup.initialDrowsiness })
  }
  if (setup.initialFatigue !== null) {
    run.push({ type: 'SET_INITIAL_FATIGUE', value: setup.initialFatigue })
  }
  for (const [key, value] of Object.entries(setup.contextOverrides)) {
    run.push({ type: 'SET_CONTEXT_OVERRIDE', key, value })
  }

  const proposal: ProposalAction[] = [
    { type: 'SET_SERVICE_PACKAGE', packageId: setup.servicePackageId },
    { type: 'SET_CONTENT_PACKAGE', packageId: setup.contentPackageId },
    { type: 'LOAD_PROFILE', profileId: setup.profileRef },
  ]
  for (const [key, value] of Object.entries(setup.situationFields)) {
    proposal.push({ type: 'SET_SITUATION_FIELD', field: key, value })
  }

  return { run, proposal }
}

const COMPARED_KEYS: (keyof LiveSetupSnapshot)[] = [
  'scenarioId', 'routePresetId', 'triggerPackageId', 'servicePackageId',
  'contentPackageId', 'seed', 'tickSeconds', 'initialDrowsiness',
  'initialFatigue', 'profileRef',
]

/**
 * Which setup fields have drifted from the case as defined.
 *
 * A swapped algorithm package counts as drift and is REPORTED, not prevented —
 * reviewing the same situation under a different configuration is the tuning
 * loop, and the note exists so the reviewer knows which loop they are in.
 */
export function differsFromCase(setup: ResolvedCaseSetup, live: LiveSetupSnapshot): string[] {
  return COMPARED_KEYS.filter((key) => setup[key] !== live[key]) as string[]
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app/frontend && npx vitest run tests/case_resolver.test.ts`
Expected: PASS (15 tests)

- [ ] **Step 5: Verify every action name and payload key against the real reducers**

Run:
```bash
cd app/frontend
grep -oE "type: '(SELECT_SCENARIO|SELECT_PACKAGE|SET_RUN_SEED|SET_TICK_SECONDS|SET_INITIAL_DROWSINESS|SET_INITIAL_FATIGUE|SET_CONTEXT_OVERRIDE)'" src/state/runStore.ts | sort -u
grep -oE "type: '(SET_SERVICE_PACKAGE|SET_CONTENT_PACKAGE|LOAD_PROFILE|SET_SITUATION_FIELD)'" src/state/proposalStore.ts | sort -u
```

Expected: all eleven listed. Then read each action's case in the reducer and confirm its **payload key names** — the test asserts `{ id }`, `{ seed }`, `{ seconds }`, `{ value }`, `{ key, value }`, `{ packageId }`, `{ profileId }`, `{ field, value }`. Any mismatch is fixed in `caseResolver.ts` to match the reducer, never the reverse.

Note: `MergedSetupPanel.tsx:292` dispatches `LOAD_PROFILE` as `{ type, profileId, profile }` — it carries the resolved `DriverProfile` object. `caseDispatches` emits the id only; Task 9 fetches the preset with `getPreset(profileRef)` and attaches `profile` before dispatching.

- [ ] **Step 6: Commit**

```bash
git add app/frontend/src/lib/review/caseResolver.ts \
        app/frontend/tests/case_resolver.test.ts
git commit -m "feat(cases): resolve a case into the existing Combined setup

Plain setup record plus plain store actions, dispatching nothing itself. Route
preset and painted ranges stay panel-local; differsFromCase reports drift
rather than preventing it."
```

---

### Task 9: Case picker, case card, details modal

**Files:**
- Create: `app/frontend/src/components/review/ExperienceCasePicker.tsx`
- Create: `app/frontend/src/components/review/ExperienceCaseCard.tsx`
- Create: `app/frontend/src/components/review/CaseDetailsModal.tsx`
- Test: `app/frontend/tests/review_case_card.test.tsx`

**Interfaces:**
- Consumes: `listCases`, `getCase`, `CombinedTestCase` (Task 7); `resolveCase` (Task 8); `Modal` from `../merged/Modal`; `t` from `../../i18n/t`; `useLanguage` from `../../state/language`.
- Produces:
  ```tsx
  <ExperienceCasePicker selectedCaseId={string | null} flagCounts={Record<string, number>} onSelect={(caseId: string) => void} />
  <ExperienceCaseCard testCase={CombinedTestCase} onOpenDetails={() => void} />
  <CaseDetailsModal open={boolean} testCase={CombinedTestCase | null} onClose={() => void} />
  ```
  Task 17 mounts all three in the left column.

**Context:** `Modal` (`src/components/merged/Modal.tsx`) takes `{ open, title, onClose, children, size }` and portals to `document.body`. The card shows the brief, the what-to-watch chips, and a one-line persona + duration. Per 07-27 §6.1 the card **deliberately omits** expected outcome, expected causal path, journey narrative, event list, automatic path and resolved artifact references — the customer does not read them. The details modal carries persona narrative, goals, preferences, constraints, assumptions and the conditions the case fixes.

The flag chip counts only the three criticisms. **"Not sure" is never a flag** — it is a request for explanation, and must not inflate a number that means "these need attention". `flagCounts` is supplied by the caller (Task 16 owns the judgement store); the picker only renders it.

- [ ] **Step 1: Write the failing test**

```tsx
// app/frontend/tests/review_case_card.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import ExperienceCasePicker from '../src/components/review/ExperienceCasePicker'
import ExperienceCaseCard from '../src/components/review/ExperienceCaseCard'
import CaseDetailsModal from '../src/components/review/CaseDetailsModal'
import { getCase, listCases } from '../src/lib/review/caseCatalog'
import { LanguageProvider } from '../src/state/language'

const c03 = getCase('case-c03-monotonous-highway')!
const wrap = (ui: React.ReactNode) => render(<LanguageProvider>{ui}</LanguageProvider>)

describe('ExperienceCasePicker', () => {
  it('lists every committed case', () => {
    wrap(<ExperienceCasePicker selectedCaseId={null} flagCounts={{}} onSelect={() => {}} />)
    const select = screen.getByTestId('experience-case-select') as HTMLSelectElement
    expect(select.options.length).toBe(listCases().length)
  })

  it('reports the chosen case id', () => {
    const onSelect = vi.fn()
    wrap(<ExperienceCasePicker selectedCaseId={null} flagCounts={{}} onSelect={onSelect} />)
    fireEvent.change(screen.getByTestId('experience-case-select'), {
      target: { value: 'case-c03-monotonous-highway' },
    })
    expect(onSelect).toHaveBeenCalledWith('case-c03-monotonous-highway')
  })

  it('shows the flag count for the selected case', () => {
    wrap(
      <ExperienceCasePicker
        selectedCaseId="case-c03-monotonous-highway"
        flagCounts={{ 'case-c03-monotonous-highway': 3 }}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByTestId('case-flag-chip')).toHaveTextContent('3')
  })

  it('shows no chip when nothing is flagged', () => {
    wrap(
      <ExperienceCasePicker
        selectedCaseId="case-c03-monotonous-highway"
        flagCounts={{ 'case-c03-monotonous-highway': 0 }}
        onSelect={() => {}}
      />,
    )
    expect(screen.queryByTestId('case-flag-chip')).toBeNull()
  })
})

describe('ExperienceCaseCard', () => {
  it('shows the brief and the what-to-watch chips', () => {
    wrap(<ExperienceCaseCard testCase={c03} onOpenDetails={() => {}} />)
    expect(screen.getByTestId('case-brief')).toHaveTextContent(c03.brief.ja)
    expect(screen.getAllByTestId('case-watch-chip')).toHaveLength(c03.what_to_watch.length)
  })

  it('shows a one-line persona summary', () => {
    wrap(<ExperienceCaseCard testCase={c03} onOpenDetails={() => {}} />)
    expect(screen.getByTestId('case-persona-line')).toHaveTextContent(c03.persona.name.ja)
  })

  it('omits everything the customer does not read', () => {
    // 07-27 §6.1: no expected outcome, no expected causal path, no journey
    // narrative, no event list, no automatic path, no artifact references.
    wrap(<ExperienceCaseCard testCase={c03} onOpenDetails={() => {}} />)
    const text = screen.getByTestId('experience-case-card').textContent ?? ''
    expect(text).not.toContain(c03.journey.narrative.ja)
    expect(text).not.toContain(c03.journey.scenario_ref)
    expect(text).not.toContain(c03.journey.route_preset_ref)
    expect(text).not.toContain(c03.algorithm_defaults.trigger)
  })

  it('opens the details popup', () => {
    const onOpenDetails = vi.fn()
    wrap(<ExperienceCaseCard testCase={c03} onOpenDetails={onOpenDetails} />)
    fireEvent.click(screen.getByTestId('case-details-button'))
    expect(onOpenDetails).toHaveBeenCalled()
  })
})

describe('CaseDetailsModal', () => {
  it('renders nothing when closed', () => {
    wrap(<CaseDetailsModal open={false} testCase={c03} onClose={() => {}} />)
    expect(screen.queryByTestId('case-details-modal')).toBeNull()
  })

  it('shows the persona narrative and the conditions the case fixes', () => {
    wrap(<CaseDetailsModal open testCase={c03} onClose={() => {}} />)
    expect(screen.getByTestId('case-details-modal')).toHaveTextContent(c03.persona.narrative.ja)
    expect(screen.getByTestId('case-fixed-conditions')).toBeTruthy()
  })

  it('survives a case with no goals or constraints', () => {
    const bare = { ...c03, persona: { ...c03.persona, goals: undefined, constraints: undefined } }
    wrap(<CaseDetailsModal open testCase={bare} onClose={() => {}} />)
    expect(screen.getByTestId('case-details-modal')).toBeTruthy()
  })

  it('renders nothing when no case is selected', () => {
    wrap(<CaseDetailsModal open testCase={null} onClose={() => {}} />)
    expect(screen.queryByTestId('case-details-modal')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/frontend && npx vitest run tests/review_case_card.test.tsx`
Expected: FAIL — cannot resolve the three components

Check first that `LanguageProvider` is the real export name in `src/state/language.tsx`; an existing test such as `tests/i18n.test.tsx` shows the established wrapper pattern — copy that rather than the sketch above if they differ.

- [ ] **Step 3: Write `ExperienceCasePicker.tsx`**

```tsx
// app/frontend/src/components/review/ExperienceCasePicker.tsx
/**
 * The experience test-case picker.
 *
 * A flat <select>: there are no case groups in V1 because contrast pairs were
 * removed, so optgroups would carry no information.
 *
 * The flag chip counts ONLY the three criticisms. "Not sure" is deliberately
 * excluded — it is a request for explanation, not a complaint, and must not
 * inflate a number that means "these need attention".
 */
import { listCases } from '../../lib/review/caseCatalog'
import { useLanguage } from '../../state/language'
import { t } from '../../i18n/t'

const LABELS = {
  testCase: { ja: '体験テストケース', en: 'Experience test case' },
  flagged: { ja: '要確認の入力', en: 'flagged inputs' },
}

export default function ExperienceCasePicker({
  selectedCaseId,
  flagCounts,
  onSelect,
}: {
  selectedCaseId: string | null
  flagCounts: Record<string, number>
  onSelect: (caseId: string) => void
}): JSX.Element {
  const { lang } = useLanguage()
  const flags = selectedCaseId ? (flagCounts[selectedCaseId] ?? 0) : 0

  return (
    <div data-testid="experience-case-picker" style={{ marginBottom: '8px' }}>
      <label style={{ display: 'block', fontSize: '0.78em', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
        {t(LABELS.testCase, lang)}
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <select
          data-testid="experience-case-select"
          value={selectedCaseId ?? ''}
          onChange={(e) => onSelect(e.target.value)}
          style={{ flex: 1, fontSize: '0.84em', padding: '5px' }}
        >
          {listCases().map((c) => (
            <option key={c.case_id} value={c.case_id}>
              {t(c.title, lang)}
            </option>
          ))}
        </select>
        {flags > 0 && (
          <span
            data-testid="case-flag-chip"
            title={t(LABELS.flagged, lang)}
            style={{
              fontSize: '0.72em', fontWeight: 800, padding: '1px 7px', borderRadius: '999px',
              color: '#b45309', background: '#fffbeb', border: '1px solid #fcd34d',
            }}
          >
            {flags}
          </span>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Write `ExperienceCaseCard.tsx`**

```tsx
// app/frontend/src/components/review/ExperienceCaseCard.tsx
/**
 * The compact case card: brief, what-to-watch chips, one-line persona.
 *
 * DELIBERATELY ABSENT (07-27 §6.1): expected outcome, expected causal path,
 * journey narrative, event list, automatic path, resolved artifact references.
 * The customer does not read them, and an "expected outcome" would contradict
 * the whole premise — the expectation is what review PRODUCES.
 */
import type { CombinedTestCase } from '../../lib/review/caseCatalog'
import { useLanguage } from '../../state/language'
import { t } from '../../i18n/t'

const LABELS = {
  watch: { ja: '注目点', en: 'What to watch' },
  details: { ja: 'ケースの詳細', en: 'Case details' },
}

export default function ExperienceCaseCard({
  testCase,
  onOpenDetails,
}: {
  testCase: CombinedTestCase
  onOpenDetails: () => void
}): JSX.Element {
  const { lang } = useLanguage()

  return (
    <div
      data-testid="experience-case-card"
      style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '9px', padding: '10px 11px', marginBottom: '9px' }}
    >
      <p data-testid="case-brief" style={{ fontSize: '0.82em', lineHeight: 1.6, margin: 0 }}>
        {t(testCase.brief, lang)}
      </p>

      <p style={{ fontSize: '0.68em', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', margin: '9px 0 3px' }}>
        {t(LABELS.watch, lang)}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
        {testCase.what_to_watch.map((chip, i) => (
          <span
            key={i}
            data-testid="case-watch-chip"
            style={{ fontSize: '0.72em', padding: '1px 7px', borderRadius: '5px', color: '#1d4ed8', background: '#eff4ff', border: '1px solid #bfdbfe' }}
          >
            {t(chip, lang)}
          </span>
        ))}
      </div>

      <p data-testid="case-persona-line" style={{ fontSize: '0.76em', color: '#475569', margin: '9px 0 0' }}>
        {t(testCase.persona.name, lang)}
      </p>

      <button
        type="button"
        data-testid="case-details-button"
        onClick={onOpenDetails}
        style={{ marginTop: '7px', fontSize: '0.76em', padding: '4px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', color: '#475569' }}
      >
        {t(LABELS.details, lang)}
      </button>
    </div>
  )
}
```

- [ ] **Step 5: Write `CaseDetailsModal.tsx`**

```tsx
// app/frontend/src/components/review/CaseDetailsModal.tsx
/**
 * The case-details popup: persona narrative, goals, preferences, constraints,
 * assumptions, and the conditions the case fixes.
 *
 * Every list is optional in the contract, so each section renders only when it
 * has content — an empty box says nothing and costs space.
 */
import { Modal } from '../merged/Modal'
import type { BilingualLabel, CombinedTestCase } from '../../lib/review/caseCatalog'
import { useLanguage } from '../../state/language'
import { t } from '../../i18n/t'

const LABELS = {
  title: { ja: 'ケースの詳細', en: 'Case details' },
  goals: { ja: '目的', en: 'Goals' },
  preferences: { ja: '嗜好', en: 'Preferences' },
  constraints: { ja: '制約', en: 'Constraints' },
  assumptions: { ja: '前提', en: 'Assumptions' },
  fixed: { ja: 'このケースが固定する条件', en: 'Conditions this case fixes' },
  fixesNothing: { ja: 'このケースは固定条件を設定していません。', en: 'This case pins no conditions.' },
}

const sectionStyle: React.CSSProperties = {
  fontSize: '0.68em', fontWeight: 800, textTransform: 'uppercase',
  letterSpacing: '0.05em', color: '#94a3b8', margin: '10px 0 3px',
}

export default function CaseDetailsModal({
  open,
  testCase,
  onClose,
}: {
  open: boolean
  testCase: CombinedTestCase | null
  onClose: () => void
}): JSX.Element | null {
  const { lang } = useLanguage()
  if (!open || !testCase) return null

  const section = (label: BilingualLabel, items?: BilingualLabel[]) =>
    items && items.length > 0 ? (
      <>
        <p style={sectionStyle}>{t(label, lang)}</p>
        <ul style={{ fontSize: '0.8em', color: '#334155', margin: 0, paddingLeft: '1.05em' }}>
          {items.map((item, i) => <li key={i}>{t(item, lang)}</li>)}
        </ul>
      </>
    ) : null

  const fixed = testCase.journey.fixed_overrides ?? {}
  const fixedEntries = Object.entries(fixed)

  return (
    <Modal open title={t(LABELS.title, lang)} onClose={onClose}>
      <div data-testid="case-details-modal">
        <p style={{ fontSize: '0.83em', lineHeight: 1.6, color: '#475569', margin: 0 }}>
          {t(testCase.persona.narrative, lang)}
        </p>

        {section(LABELS.goals, testCase.persona.goals)}
        {section(LABELS.preferences, testCase.persona.preferences)}
        {section(LABELS.constraints, testCase.persona.constraints)}
        {section(LABELS.assumptions, testCase.persona.assumptions)}

        <p style={sectionStyle}>{t(LABELS.fixed, lang)}</p>
        <div data-testid="case-fixed-conditions" style={{ fontSize: '0.78em', color: '#334155' }}>
          {fixedEntries.length === 0 ? (
            // Saying so beats an empty box (07-27 §9.1).
            <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>{t(LABELS.fixesNothing, lang)}</span>
          ) : (
            <ul style={{ margin: 0, paddingLeft: '1.05em' }}>
              {fixedEntries.map(([key, value]) => (
                <li key={key}>
                  <code style={{ color: '#64748b' }}>{key}</code>: {String(value)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd app/frontend && npx vitest run tests/review_case_card.test.tsx`
Expected: PASS (13 tests)

- [ ] **Step 7: Typecheck**

Run: `cd app/frontend && npx tsc --noEmit 2>&1 | grep "error TS" | grep -F "<your files>"`
Expected: no output — no new errors naming your files. (167 pre-existing errors elsewhere are the baseline; ignore them.)

- [ ] **Step 8: Commit**

```bash
git add app/frontend/src/components/review/ app/frontend/tests/review_case_card.test.tsx
git commit -m "feat(review): case picker, case card and details popup

The card deliberately omits expected outcome, causal path, journey narrative
and artifact references. The flag chip counts only the three criticisms —
'Not sure' is a request for explanation, never a flag."
```

**Slice 2 checkpoint.** `cd app/api && python -m pytest -q` and `cd app/frontend && npx vitest run` both green. A case can now be selected and resolved into the existing setup, with nothing yet reviewing it.

---

## Slice 3 — The review column

> **Spec amendment discovered during planning.** The design's §3 lists three
> backend changes. A fourth is required and is Task 10 below.
>
> B1 puts the trigger's contributions into `DecisionResult`, which reaches the
> frontend on a **live run** (`TickResponseSuccess.decision`). But the review's
> primary path before Play is the **quickview**, and `FirePoint` carries only
> `{category, strength, tick, time_min}` — no decision at all. Without carrying
> the fired tick's chain onto the fire, the Trigger stage would report
> "unavailable" on the path reviewers actually use.
>
> The fix is small and additive: `decision` is already in scope where the fire
> dict is built (`services/preview.py:505-517`).

### Task 10: Carry the trigger chain onto the fire point

**Files:**
- Modify: `app/api/aica_api/services/preview.py:511-516` (the `fire` dict)
- Modify: `app/api/aica_api/models/run.py:406-412` (`FirePoint`)
- Modify: `app/frontend/src/api/types.ts:350` (`FirePoint`) and `:543` (`DecisionResult`)
- Test: `app/api/tests/test_fire_point_trigger_chain.py`

**Interfaces:**
- Consumes: `DecisionResult.feature_contributions` from Task 1.
- Produces: `FirePoint.feature_contributions: dict` and `FirePoint.criteria: dict` (thresholds), plus the matching TS fields. Task 11 reads both.

**Context:** `criteria` carries `threshold_suggest`, `monotony_suggest_threshold` and the persistence ladders — 07-27 §7.3 requires `firing threshold 0.70 · clearance +0.010` under the comparison pickers, so the thresholds must travel with the fire too. Both fields default to `{}` so every existing persisted preview stays parseable.

- [ ] **Step 1: Write the failing test**

```python
# app/api/tests/test_fire_point_trigger_chain.py
"""A quickview fire carries the trigger chain recorded at that tick.

Without this the review's Trigger stage is unavailable on the pre-Play
quickview — the path a reviewer actually uses.
"""
from __future__ import annotations

from aica_api.models.run import FirePoint


def test_fire_point_accepts_the_trigger_chain():
    fire = FirePoint(
        category="rest_required", strength="clear", tick=42, time_min=63.0,
        feature_contributions={"rest_required": {"score": 0.72, "clamped": False, "rows": [], "gates": []}},
        criteria={"threshold_suggest": 0.70},
    )
    assert fire.feature_contributions["rest_required"]["score"] == 0.72
    assert fire.criteria["threshold_suggest"] == 0.70


def test_fire_point_defaults_keep_old_previews_parseable():
    fire = FirePoint(category="rest_required", strength=None, tick=1, time_min=1.0)
    assert fire.feature_contributions == {}
    assert fire.criteria == {}
```

Add an integration assertion to the existing merged-quickview suite. Open
`app/api/tests/test_merged_quickview.py`, find a test that already builds a
quickview producing at least one fire, and copy its setup verbatim into:

```python
def test_quickview_fire_carries_both_trigger_categories(<same fixtures as the sibling test>):
    result = <same call as the sibling test>
    assert result.fires, "this fixture must produce at least one fire"

    chain = result.fires[0].feature_contributions
    assert set(chain) == {"rest_required", "monotony_prevention"}
    assert chain["rest_required"]["rows"], "the winning category needs its terms"
    # The runner-up's terms must be RECORDED, not reconstructed — §7.3 compares
    # the two categories against each other.
    assert chain["monotony_prevention"]["rows"]
    assert result.fires[0].criteria.get("threshold_suggest") is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/api && python -m pytest tests/test_fire_point_trigger_chain.py -v`
Expected: FAIL — `FirePoint` rejects the unknown fields.

- [ ] **Step 3: Implement**

`app/api/aica_api/models/run.py`, in `FirePoint`:

```python
    # The trigger chain recorded AT this fire (B1). Empty for packages that emit
    # no contributions and for previews recorded before this field existed —
    # consumers report the trigger stage unavailable rather than inferring.
    feature_contributions: dict = {}
    # Thresholds and ladders in force at this tick, so the review can show
    # "firing threshold 0.70 · clearance +0.010" without a second lookup.
    criteria: dict = {}
```

`app/api/aica_api/services/preview.py`, in the `fire` dict:

```python
                fire = {
                    "category": decision.selected_category,
                    "strength": strength,
                    "tick": tick_index,
                    "time_min": elapsed_min,
                    "feature_contributions": decision.feature_contributions,
                    "criteria": decision.criteria,
                }
```

`app/frontend/src/api/types.ts` — extend both types:

```ts
export type FirePoint = {
  category: string | null
  strength: string | null
  tick: number
  time_min: number
  /** The trigger chain recorded at this fire. Empty when the package emits none. */
  feature_contributions?: Record<string, TriggerCategoryChain>
  /** Thresholds/ladders in force at this tick. */
  criteria?: Record<string, number>
}

/** One trigger category's recorded terms, as emitted by a transparent package. */
export type TriggerCategoryChain = {
  score: number
  /** True when clamping bound, so shares will not reconcile with `score`. */
  clamped: boolean
  rows: {
    feature_id: string
    value: number
    band: string | null
    weight: number
    contribution: number
  }[]
  gates: {
    gate_id: string
    evaluated_inputs: Record<string, number>
    threshold: number
    passed: boolean
    effect: 'allow' | 'exclude' | 'suppress' | 'override'
  }[]
}
```

And add to `DecisionResult` (`types.ts:543`), so the live tick path carries it too:

```ts
  feature_contributions: Record<string, TriggerCategoryChain>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app/api && python -m pytest tests/test_fire_point_trigger_chain.py tests/test_merged_quickview.py -v`
Expected: PASS

- [ ] **Step 5: Run the full backend suite and typecheck the frontend**

Run: `cd app/api && python -m pytest -q` then `cd app/frontend && npx tsc --noEmit`
Expected: both clean. Adding a **required** field to the TS `DecisionResult` may break existing test fixtures that construct one — if so, make it optional (`feature_contributions?:`) rather than editing every fixture, since a package legitimately may not emit it.

- [ ] **Step 6: Commit**

```bash
git add app/api/aica_api/models/run.py app/api/aica_api/services/preview.py \
        app/frontend/src/api/types.ts app/api/tests/test_fire_point_trigger_chain.py \
        app/api/tests/test_merged_quickview.py
git commit -m "feat(trigger): carry the trigger chain and thresholds onto a fire point

DecisionResult reaches the frontend only on a live run; the review's primary
path is the pre-Play quickview, whose FirePoint carried no decision at all."
```

---

### Task 11: Derive checkpoints and build review options

**Files:**
- Create: `app/frontend/src/lib/review/checkpoints.ts`, `app/frontend/src/lib/review/chains.ts`
- Test: `app/frontend/tests/review_checkpoints.test.ts`, `app/frontend/tests/review_chains.test.ts`

**Interfaces:**
- Consumes: `MergedInstantResult`, `MergedFirePoint`, `ProposalRunLog` from `src/api/mergedClient.ts`; `ReviewOption`, `ReviewChainRow`, `Unavailable` from Task 3.
- Produces:
  ```ts
  type ReviewStage = 'trigger' | 'service' | 'content'
  type Checkpoint = { id: string; category: 'rest_required' | 'monotony_prevention'
                      fireIndex: number; tick: number; timeMin: number; label: BilingualLabel }
  deriveCheckpoints(result: MergedInstantResult | null): Checkpoint[]
  triggerOptions(fire: MergedFirePoint): ReviewOption[] | Unavailable
  serviceOptions(proposal: ProposalRunLog | null): ReviewOption[] | Unavailable
  contentOptions(proposal: ProposalRunLog | null): ReviewOption[] | Unavailable
  ```
  Tasks 12–14 consume all four.

**Context:** Checkpoints are **derived, not authored** — the first `rest_required` fire and the first `monotony_prevention` fire, each with its immediate proposal. Every other journey stage animates but exposes no review target. An empty rail is a legitimate outcome (C-01 is the control case), not an error.

Service evidence already carries `FeatureContribution` (`feature_id`, world value, `response_coefficient`, `weight`, signed contribution); content carries `ItemFeatureContribution` (`e_i`, `a_i`, `r_i`, `effective_weight`, `contribution`). `ServiceResultOverlay`/`ContentResultOverlay` already map both into `ReasonRow` — read those two components and mirror their field mapping exactly rather than inventing a second one.

Content options are the ordered plan items **plus** the `scored_tail` from Task 2, so a position below rank 1 has a real runner-up.

- [ ] **Step 1: Write the failing checkpoint test**

```ts
// app/frontend/tests/review_checkpoints.test.ts
import { deriveCheckpoints } from '../src/lib/review/checkpoints'
import type { MergedInstantResult } from '../src/api/mergedClient'

const fire = (category: string, tick: number, timeMin: number) =>
  ({ category, strength: 'clear', tick, time_min: timeMin, proposal: null, proposal_error: null }) as never

const result = (fires: unknown[]) => ({ fires } as unknown as MergedInstantResult)

describe('deriveCheckpoints', () => {
  it('takes the FIRST fire of each in-scope category', () => {
    const cps = deriveCheckpoints(result([
      fire('rest_required', 10, 12), fire('rest_required', 40, 48), fire('monotony_prevention', 60, 70),
    ]))
    expect(cps.map((c) => c.category)).toEqual(['rest_required', 'monotony_prevention'])
    expect(cps[0].tick).toBe(10)
  })

  it('orders checkpoints by time, not by category', () => {
    const cps = deriveCheckpoints(result([
      fire('monotony_prevention', 20, 25), fire('rest_required', 50, 60),
    ]))
    expect(cps.map((c) => c.category)).toEqual(['monotony_prevention', 'rest_required'])
  })

  it('ignores every out-of-scope category', () => {
    expect(deriveCheckpoints(result([fire('route_music', 10, 12)]))).toEqual([])
  })

  it('returns an empty rail for a run that never fires', () => {
    // C-01 is the control case: nothing firing is the POINT, not an error.
    expect(deriveCheckpoints(result([]))).toEqual([])
  })

  it('returns an empty rail before any run exists', () => {
    expect(deriveCheckpoints(null)).toEqual([])
  })

  it('keeps the fire index so the proposal can be found', () => {
    const cps = deriveCheckpoints(result([fire('monotony_prevention', 20, 25), fire('rest_required', 50, 60)]))
    expect(cps.find((c) => c.category === 'rest_required')!.fireIndex).toBe(1)
  })

  it('gives every checkpoint a stable id and a bilingual label', () => {
    const cps = deriveCheckpoints(result([fire('rest_required', 10, 12)]))
    expect(cps[0].id).toBe('rest_required')
    expect(cps[0].label.ja).not.toBe(cps[0].label.en)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd app/frontend && npx vitest run tests/review_checkpoints.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `checkpoints.ts`**

```ts
// app/frontend/src/lib/review/checkpoints.ts
/**
 * Derive the reviewable decision points from a run.
 *
 * Checkpoints are DERIVED, never authored — the design's Phase 1 authors no
 * expectations, so there is nothing to anchor an authored checkpoint to.
 *
 * V1 scope is exactly the FIRST `rest_required` fire and the FIRST
 * `monotony_prevention` fire, each with the proposal made at that moment.
 * Rest acceptance, the stopped stage and after-nap proposals still animate on
 * the timeline and stay visible in the centre — they are simply not selectable
 * as a review target.
 *
 * An EMPTY rail is a legitimate, informative outcome (the alert-daytime control
 * case exists to produce exactly that), never an error state.
 */
import type { MergedInstantResult } from '../../api/mergedClient'
import type { BilingualLabel } from './reviewVocabulary'

export type ReviewStage = 'trigger' | 'service' | 'content'

export type ReviewableCategory = 'rest_required' | 'monotony_prevention'

const IN_SCOPE: ReviewableCategory[] = ['rest_required', 'monotony_prevention']

const CATEGORY_LABELS: Record<ReviewableCategory, BilingualLabel> = {
  rest_required: { ja: '休憩の提案', en: 'Rest proposal' },
  monotony_prevention: { ja: '単調さへの介入', en: 'Monotony intervention' },
}

export type Checkpoint = {
  /** Stable within a run — the category is unique because we take only the first. */
  id: ReviewableCategory
  category: ReviewableCategory
  /** Index into `result.fires`, so the proposal at this moment can be found. */
  fireIndex: number
  tick: number
  timeMin: number
  label: BilingualLabel
}

export function deriveCheckpoints(result: MergedInstantResult | null): Checkpoint[] {
  if (!result?.fires?.length) return []

  const seen = new Set<string>()
  const checkpoints: Checkpoint[] = []

  result.fires.forEach((fire, fireIndex) => {
    const category = fire.category as ReviewableCategory | null
    if (!category || !IN_SCOPE.includes(category) || seen.has(category)) return
    seen.add(category)
    checkpoints.push({
      id: category,
      category,
      fireIndex,
      tick: fire.tick,
      timeMin: fire.time_min,
      label: CATEGORY_LABELS[category],
    })
  })

  // Journey order, not category order — the rail reads as a timeline.
  return checkpoints.sort((a, b) => a.timeMin - b.timeMin)
}
```

- [ ] **Step 4: Run the checkpoint test to verify it passes**

Run: `cd app/frontend && npx vitest run tests/review_checkpoints.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Write the failing chains test**

```ts
// app/frontend/tests/review_chains.test.ts
import { triggerOptions, serviceOptions, contentOptions } from '../src/lib/review/chains'

const chainRow = (feature_id: string, value: number, weight: number) => ({
  feature_id, value, band: null, weight, contribution: value * weight,
})

const fireWith = (chain: unknown) => ({ feature_contributions: chain, criteria: {} }) as never

describe('triggerOptions', () => {
  const fire = fireWith({
    rest_required: { score: 0.72, clamped: false, gates: [], rows: [chainRow('fatigue', 0.8, 0.2)] },
    monotony_prevention: { score: 0.55, clamped: false, gates: [], rows: [chainRow('monotony', 0.9, 0.4)] },
  })

  it('returns BOTH categories as comparable options', () => {
    const options = triggerOptions(fire)
    expect(Array.isArray(options)).toBe(true)
    expect((options as { id: string }[]).map((o) => o.id).sort())
      .toEqual(['monotony_prevention', 'rest_required'])
  })

  it('uses the RECORDED score, not the sum of contributions', () => {
    const options = triggerOptions(fire) as { id: string; score: number }[]
    expect(options.find((o) => o.id === 'rest_required')!.score).toBe(0.72)
  })

  it('sets r=1, since the trigger has no response coefficient', () => {
    const options = triggerOptions(fire) as { rows: { r: number }[] }[]
    expect(options[0].rows[0].r).toBe(1)
  })

  it('propagates the clamped flag so the panel can say shares will not reconcile', () => {
    const clamped = fireWith({
      rest_required: { score: 1.0, clamped: true, gates: [], rows: [chainRow('fatigue', 1, 1.5)] },
      monotony_prevention: { score: 0.1, clamped: false, gates: [], rows: [] },
    })
    const options = triggerOptions(clamped) as { id: string; clamped?: boolean }[]
    expect(options.find((o) => o.id === 'rest_required')!.clamped).toBe(true)
  })

  it('is unavailable when the package recorded no contributions', () => {
    expect(triggerOptions(fireWith({}))).toMatchObject({ available: false })
  })

  it('is unavailable when the fire predates the recording change', () => {
    expect(triggerOptions({} as never)).toMatchObject({ available: false })
  })
})

describe('serviceOptions', () => {
  it('is unavailable when no service evidence was recorded', () => {
    expect(serviceOptions(null)).toMatchObject({ available: false })
  })
})

describe('contentOptions', () => {
  it('is unavailable when no content plan was recorded', () => {
    expect(contentOptions(null)).toMatchObject({ available: false })
  })
})
```

- [ ] **Step 6: Implement `chains.ts`**

Write `triggerOptions` first — it is fully specified by Task 10's shape:

```ts
// app/frontend/src/lib/review/chains.ts
/**
 * Build comparable `ReviewOption`s from RECORDED evidence.
 *
 * Nothing here recomputes a score: `score` is always the value the algorithm
 * reported, which can differ from Σcontribution when clamping bound. Where
 * evidence is absent these return `Unavailable` with a reason — never an
 * empty option list that would read as "nothing contributed".
 */
import type { MergedFirePoint, ProposalRunLog } from '../../api/mergedClient'
import { unavailable } from './types'
import type { ReviewOption, Unavailable } from './types'
import type { BilingualLabel } from './reviewVocabulary'

const CATEGORY_LABELS: Record<string, BilingualLabel> = {
  rest_required: { ja: '休憩の提案', en: 'Rest proposal' },
  monotony_prevention: { ja: '単調さへの介入', en: 'Monotony intervention' },
}

/**
 * The two trigger categories as comparable options.
 *
 * In V1 this is the COMPLETE category set, so the comparison is exhaustive
 * rather than a top-2 slice — and the runner-up's terms are read from the
 * record, never reconstructed from a weight table.
 */
export function triggerOptions(fire: MergedFirePoint): ReviewOption[] | Unavailable {
  const chains = fire?.feature_contributions
  if (!chains || Object.keys(chains).length === 0) {
    return unavailable('this trigger package recorded no per-feature contributions')
  }

  return Object.entries(chains).map(([category, chain]) => ({
    id: category,
    label: (CATEGORY_LABELS[category] ?? { ja: category, en: category }).en,
    score: chain.score,
    clamped: chain.clamped,
    rows: chain.rows.map((row) => ({
      featureId: row.feature_id,
      value: row.value,
      band: row.band,
      r: 1,          // the trigger is a plain weighted sum — no response coefficient
      w: row.weight,
      contribution: row.contribution,
    })),
  }))
}
```

Then write `serviceOptions` and `contentOptions`. **Before writing them, read
`src/components/merged/ServiceResultOverlay.tsx` and
`src/components/merged/ContentResultOverlay.tsx`** and copy their existing
`ReasonRow` field mapping exactly — those components already normalize
`FeatureContribution` and `ItemFeatureContribution`, and a second, subtly
different mapping here would be the drift this design exists to avoid.

`serviceOptions` returns one option per ranked candidate, ordered as recorded.
`contentOptions` returns the ordered plan items **followed by** `scored_tail`
entries (Task 2), so every position below rank 1 has a real runner-up; when
`scored_tail` is empty and `tail_truncated` is false, that is a genuine "nothing
else was scored", and when `tail_truncated` is true the caller must say so.

Both return `unavailable(...)` when their evidence is missing.

- [ ] **Step 7: Extend the chains test for service and content**

Using a real recorded fixture rather than a hand-built one: run the app or an
existing backend test to capture one `ProposalRunLog` JSON, save it to
`app/frontend/tests/fixtures/proposal_run_log.json`, and assert that
`serviceOptions` returns one option per ranked candidate with rows matching what
`ServiceResultOverlay` renders, and that `contentOptions` returns
`ordered_items.length + scored_tail.length` options.

Check `app/frontend/tests/` for an existing proposal fixture first — several
tests already build proposal logs, and reusing one is better than adding a
second source of truth.

- [ ] **Step 8: Run both chain suites**

Run: `cd app/frontend && npx vitest run tests/review_chains.test.ts tests/review_checkpoints.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add app/frontend/src/lib/review/checkpoints.ts \
        app/frontend/src/lib/review/chains.ts \
        app/frontend/tests/review_checkpoints.test.ts \
        app/frontend/tests/review_chains.test.ts
git commit -m "feat(review): derive checkpoints and build review options

Checkpoints are derived from the run, not authored; an empty rail is a
legitimate outcome. Options read recorded scores and chains — never recomputed,
and Unavailable where evidence is missing."
```

---

### Task 12: What decided it — comparison, margin bars, verdict, grouping

**Files:**
- Create: `app/frontend/src/components/review/WhatDecidedIt.tsx`
- Test: `app/frontend/tests/review_what_decided_it.test.tsx`

**Interfaces:**
- Consumes: `ReviewOption` (Task 3); `marginRows`, `scaleBound`, `realizedShares` (Tasks 3–4); `domainGroup`, `groupLabel`, `phrase`, `bandWord` (Task 5).
- Produces:
  ```tsx
  <WhatDecidedIt options={ReviewOption[]} leftId={string} rightId={string}
                 onChangeLeft={(id: string) => void} onChangeRight={(id: string) => void}
                 thresholdNote={string | null} />
  ```
  Task 14 mounts it.

**Context (07-27 §7):** two dropdowns choose what is compared, defaulting to 1st vs 2nd. Every parameter is a **mirrored bar pair on one shared scale** with a `◀ / ▶` lean marker. The bound is **always displayed** — bars are never shown without it.

Why the margin rather than the total: a feature can be the largest contributor to the winner and contribute nothing to the gap. The verdict sentence leads, then the domain grouping, then per-row bars with the raw value first (`88 · very high`) before any derived number. The identifier stays visible in faint grey and is never the label.

- [ ] **Step 1: Write the failing test**

```tsx
// app/frontend/tests/review_what_decided_it.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import WhatDecidedIt from '../src/components/review/WhatDecidedIt'
import { LanguageProvider } from '../src/state/language'
import type { ReviewOption } from '../src/lib/review/types'

const row = (featureId: string, value: number, w: number, band: string | null = null) => ({
  featureId, value, band, r: 1, w, contribution: value * w,
})

const options: ReviewOption[] = [
  { id: 'rest_required', label: 'Rest proposal', score: 0.72, clamped: false,
    rows: [row('fatigue', 0.8, 0.3, 'high'), row('monotony', 0.2, 0.1)] },
  { id: 'monotony_prevention', label: 'Monotony intervention', score: 0.55, clamped: false,
    rows: [row('monotony', 0.9, 0.4), row('fatigue', 0.1, 0.1)] },
]

const wrap = (ui: React.ReactNode) => render(<LanguageProvider>{ui}</LanguageProvider>)
const mount = (extra: Partial<React.ComponentProps<typeof WhatDecidedIt>> = {}) =>
  wrap(
    <WhatDecidedIt
      options={options} leftId="rest_required" rightId="monotony_prevention"
      onChangeLeft={() => {}} onChangeRight={() => {}} thresholdNote={null} {...extra}
    />,
  )

describe('WhatDecidedIt', () => {
  it('displays the shared scale bound — bars are never shown without it', () => {
    mount()
    expect(screen.getByTestId('margin-scale-bound')).toHaveTextContent(/±/)
  })

  it('draws one mirrored row per feature across both options', () => {
    mount()
    expect(screen.getAllByTestId('margin-row')).toHaveLength(2)
  })

  it('orders rows by how much they decided the GAP, not by size in the winner', () => {
    mount()
    // fatigue margin = +0.23; monotony margin = −0.34 → monotony decided more of the gap
    const ids = screen.getAllByTestId('margin-feature-id').map((n) => n.textContent)
    expect(ids[0]).toContain('monotony')
  })

  it('marks which side each feature pulls toward', () => {
    mount()
    const leans = screen.getAllByTestId('margin-lean').map((n) => n.textContent)
    expect(leans.join('')).toMatch(/[◀▶]/)
  })

  it('leads each row with the raw value the reviewer already understands', () => {
    mount()
    expect(screen.getByTestId('margin-anchor-fatigue')).toHaveTextContent('high')
  })

  it('shows plain phrasing as the label and the identifier only in support', () => {
    mount()
    expect(screen.getByTestId('margin-row-fatigue')).toHaveTextContent('how tired the driver is')
  })

  it('opens with a verdict sentence naming both sides', () => {
    mount()
    const verdict = screen.getByTestId('verdict-sentence').textContent ?? ''
    expect(verdict.length).toBeGreaterThan(0)
  })

  it('groups contributions into the four domains', () => {
    mount()
    expect(screen.getAllByTestId('domain-group').length).toBeGreaterThan(0)
  })

  it('shows the threshold note under the pickers when one is given', () => {
    mount({ thresholdNote: 'firing threshold 0.70 · clearance +0.010' })
    expect(screen.getByTestId('threshold-note')).toHaveTextContent('0.70')
  })

  it('reports the comparison change', () => {
    const onChangeRight = vi.fn()
    mount({ onChangeRight })
    fireEvent.change(screen.getByTestId('compare-right'), { target: { value: 'rest_required' } })
    expect(onChangeRight).toHaveBeenCalledWith('rest_required')
  })

  it('says shares will not reconcile when clamping bound', () => {
    const clamped = [{ ...options[0], clamped: true }, options[1]]
    mount({ options: clamped })
    expect(screen.getByTestId('clamp-note')).toBeTruthy()
  })

  it('says so instead of drawing bars when there is nothing to compare', () => {
    mount({ options: [], leftId: '', rightId: '' })
    expect(screen.getByTestId('comparison-unavailable')).toBeTruthy()
    expect(screen.queryByTestId('margin-row')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd app/frontend && npx vitest run tests/review_what_decided_it.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

Build the component in this order, so each test goes green in turn:

1. **Unavailable guard** — when `options.length < 2` or either id is missing, render only `data-testid="comparison-unavailable"` with a reason. Never render an axis.
2. **Pickers** — two `<select>`s (`compare-left`, `compare-right`) listing every option by `label`, plus `data-testid="threshold-note"` beneath when `thresholdNote` is non-null.
3. **Verdict sentence** (`verdict-sentence`) — built from the top margin row: *"X was chosen mainly because of `phrase(topSupporting)`, despite `phrase(topOpposing)`."* Both clauses bilingual via `t()`; omit the "despite" clause when nothing pulls the other way.
4. **Domain grouping** (`domain-group`) — bucket both options' contributions with `domainGroup`, show each group's share of total absolute contribution for both sides. This is the specification-level judgement no per-parameter view offers.
5. **Scale + bars** — `scaleBound(rows.flatMap(r => [r.left, r.right]))` rendered as `data-testid="margin-scale-bound"` reading `±0.3`; then one `margin-row` per `marginRows()` entry, each with `margin-feature-id` (faint grey identifier), the `phrase()` label, `margin-anchor-<featureId>` leading with `value · bandWord(band, value)`, a mirrored bar pair against the shared bound, and `margin-lean` showing `◀` or `▶`.
6. **Clamp note** (`clamp-note`) — when either option has `clamped`, state that contributions sum past the reported score so the shares do not reconcile.

Keep every user-visible string in a `LABELS` object resolved through `t()`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app/frontend && npx vitest run tests/review_what_decided_it.test.tsx`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add app/frontend/src/components/review/WhatDecidedIt.tsx \
        app/frontend/tests/review_what_decided_it.test.tsx
git commit -m "feat(review): side-by-side margin comparison with verdict and grouping

Mirrored bar pairs on one displayed shared scale, ordered by contribution to
the GAP rather than to the winner. Raw value leads every row; the identifier is
never the label."
```

---

### Task 13: Parameter rationale, consequences, played-no-part

**Files:**
- Create: `app/frontend/src/components/review/ParameterRationale.tsx`
- Test: `app/frontend/tests/review_parameter_rationale.test.tsx`

**Interfaces:**
- Consumes: `ReviewOption`; `realizedShares`, `declaredShares`, `intentVsEffect`, `necessity`, `flipDistance`, `playedNoPart` (Tasks 3–4); `phrase`, `bandWord` (Task 5).
- Produces:
  ```tsx
  <ParameterRationale stage={ReviewStage} left={ReviewOption} right={ReviewOption | null}
                      declaredWeights={Record<string, number>}
                      judgments={Record<string, string>}
                      onJudge={(featureId: string, judgment: string) => void} />
  ```
  Task 14 mounts it; Task 16 supplies `judgments`/`onJudge`.

**Context (07-27 §8):** a table ordered by realized influence, with columns *input · situation · declared · realized · ↑↓≈ · your view*. Necessity and flip distance are **not columns** — reviewers could not interpret them numerically. They appear as sentences under **What a different setting would do**, naming the alternative:

> Remove *how tired the driver is* and this decision becomes Call & response (driving).
> If *how monotonous the road is* mattered about 35 % more, Call & response (driving) would have been chosen instead.

**Both sections are suppressed for the trigger stage** — they only mean something against a named alternative option.

The judgement dropdown options are `— not judged —`, `Makes sense`, `Too strong`, `Too weak`, `Not relevant here`, `Not sure`.

- [ ] **Step 1: Write the failing test**

```tsx
// app/frontend/tests/review_parameter_rationale.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import ParameterRationale from '../src/components/review/ParameterRationale'
import { LanguageProvider } from '../src/state/language'
import type { ReviewOption } from '../src/lib/review/types'

const row = (featureId: string, value: number, w: number, band: string | null = null) => ({
  featureId, value, band, r: 1, w, contribution: value * w,
})

const left: ReviewOption = {
  id: 'music_playlist', label: 'Music playlist', score: 0.5, rows: [
    row('fatigue', 0.8, 0.3, 'high'), row('monotony', 0.6, 0.2), row('oshi_affinity', 0.01, 0.01),
  ],
}
const right: ReviewOption = {
  id: 'call_response_driving', label: 'Call & response (driving)', score: 0.42,
  rows: [row('monotony', 0.9, 0.3), row('fatigue', 0.1, 0.1)],
}
const declared = { fatigue: 0.3, monotony: 0.2, oshi_affinity: 0.01 }

const wrap = (ui: React.ReactNode) => render(<LanguageProvider>{ui}</LanguageProvider>)
const mount = (extra: Partial<React.ComponentProps<typeof ParameterRationale>> = {}) =>
  wrap(
    <ParameterRationale
      stage="service" left={left} right={right} declaredWeights={declared}
      judgments={{}} onJudge={() => {}} {...extra}
    />,
  )

describe('ParameterRationale', () => {
  it('orders rows by realized influence', () => {
    mount()
    const ids = screen.getAllByTestId('rationale-feature').map((n) => n.textContent ?? '')
    expect(ids[0]).toContain('fatigue')
  })

  it('leads the situation column with the raw value and its strength word', () => {
    mount()
    expect(screen.getByTestId('rationale-situation-fatigue')).toHaveTextContent('high')
  })

  it('shows declared and realized shares', () => {
    mount()
    expect(screen.getByTestId('rationale-declared-fatigue')).toBeTruthy()
    expect(screen.getByTestId('rationale-realized-fatigue')).toBeTruthy()
  })

  it('shows the intent-vs-effect marker', () => {
    mount()
    expect(screen.getByTestId('rationale-ratio-fatigue').textContent).toMatch(/[↑↓≈]/)
  })

  it('offers the six judgement options', () => {
    mount()
    const select = screen.getByTestId('rationale-judge-fatigue') as HTMLSelectElement
    expect(select.options.length).toBe(6)
  })

  it('reports a judgement', () => {
    const onJudge = vi.fn()
    mount({ onJudge })
    fireEvent.change(screen.getByTestId('rationale-judge-fatigue'), { target: { value: 'too_strong' } })
    expect(onJudge).toHaveBeenCalledWith('fatigue', 'too_strong')
  })

  it('states consequences as sentences naming the alternative, not as bare numbers', () => {
    mount()
    const text = screen.getByTestId('different-setting').textContent ?? ''
    expect(text).toContain('Call & response (driving)')
  })

  it('names inputs that played no part', () => {
    mount()
    expect(screen.getByTestId('played-no-part')).toHaveTextContent('oshi_affinity')
  })

  it('suppresses both consequence sections on the trigger stage', () => {
    // They only mean something against a NAMED alternative option.
    mount({ stage: 'trigger' })
    expect(screen.queryByTestId('different-setting')).toBeNull()
    expect(screen.queryByTestId('played-no-part')).toBeNull()
  })

  it('suppresses consequences when there is no alternative to name', () => {
    mount({ right: null })
    expect(screen.queryByTestId('different-setting')).toBeNull()
  })

  it('renders the table even with no alternative, since the shares still hold', () => {
    mount({ right: null })
    expect(screen.getAllByTestId('rationale-feature').length).toBe(3)
  })

  it('reflects an existing judgement', () => {
    mount({ judgments: { fatigue: 'too_strong' } })
    expect((screen.getByTestId('rationale-judge-fatigue') as HTMLSelectElement).value).toBe('too_strong')
  })

  it('says so when a flip does not exist rather than printing a number', () => {
    const dominant: ReviewOption = { id: 'a', label: 'A', score: 9, rows: [row('fatigue', 1, 9)] }
    const weak: ReviewOption = { id: 'b', label: 'B', score: 0.01, rows: [row('monotony', 0.1, 0.1)] }
    mount({ left: dominant, right: weak, declaredWeights: { fatigue: 9 } })
    expect(screen.getByTestId('different-setting').textContent).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd app/frontend && npx vitest run tests/review_parameter_rationale.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

In this order:

1. **The table.** One row per `left.rows`, sorted by `realizedShares(left.rows)` descending. Columns: `rationale-feature` (plain `phrase()`, identifier faint grey), `rationale-situation-<id>` (`value · bandWord(band, value)`), `rationale-declared-<id>`, `rationale-realized-<id>`, `rationale-ratio-<id>` (`↑`/`↓`/`≈` from `intentVsEffect`), and `rationale-judge-<id>` (the six-option `<select>`, value from `judgments[featureId] ?? ''`, firing `onJudge`).
2. **Consequences** (`different-setting`) — rendered **only** when `stage !== 'trigger'` **and** `right !== null`. For each of the top three rows by realized share:
   - `necessity(left, right, id)`: when `changed`, *"Remove `phrase(id)` and this decision becomes `<winner label>`."* When unchanged, say the decision holds without it. When `Unavailable`, print its reason.
   - `flipDistance(left, right, id)`: when a factor is returned, *"If `phrase(id)` mattered about N % more, `<right.label>` would have been chosen instead"* (N = `Math.round((factor - 1) * 100)`). When `null`, say no setting of that input alone changes the outcome — never a number. When `Unavailable`, print its reason.
3. **Played no part** (`played-no-part`) — same suppression rule; lists `playedNoPart(left.rows)` with plain phrasing, framed as the reviewable fact it is.

All strings bilingual through `t()`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app/frontend && npx vitest run tests/review_parameter_rationale.test.tsx`
Expected: PASS (13 tests)

- [ ] **Step 5: Commit**

```bash
git add app/frontend/src/components/review/ParameterRationale.tsx \
        app/frontend/tests/review_parameter_rationale.test.tsx
git commit -m "feat(review): parameter rationale table with consequence sentences

Necessity and flip distance are stated as sentences naming the alternative,
never as bare numbers, and both are suppressed on the trigger stage where no
alternative option is named."
```

---

### Task 14: Review store and column assembly

**Files:**
- Create: `app/frontend/src/state/reviewStore.tsx`, `app/frontend/src/components/review/ReviewColumn.tsx`
- Test: `app/frontend/tests/review_column.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 3–13.
- Produces:
  ```tsx
  <ReviewStoreProvider>{children}</ReviewStoreProvider>
  useReviewStore(): { state: ReviewState; dispatch: (a: ReviewAction) => void }
  type ReviewState = {
    selectedCaseId: string | null
    checkpointId: string | null
    stage: ReviewStage
    targetId: string | null           // which service candidate / plan item is under review
    compareLeftId: string | null
    compareRightId: string | null
    judgments: Record<string, string>       // key: `${case}|${checkpoint}|${stage}|${target}|${feature}`
    assessments: Record<string, { assessment: string; comment: string }>
  }
  <ReviewColumn result={MergedInstantResult | null} />
  ```
  Task 16 adds persistence over `judgments`/`assessments`; Task 17 mounts `ReviewColumn`.

**Context:** stage tabs (Trigger / Service / Content), then What decided it → Parameter rationale → Your assessment. A stage with no recorded evidence is **disabled with a reason**, never silently empty. The trigger tab compares the two categories; service compares ranked candidates; content compares position 1 with the runner-up, and any other position with **the item above it** — so the margin reads negative and the decomposition shows what it lacks.

Judgement keys are `(case · checkpoint · stage · target · feature)` so a judgement made at one decision point never leaks into another.

- [ ] **Step 1: Write the failing test**

```tsx
// app/frontend/tests/review_column.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import ReviewColumn from '../src/components/review/ReviewColumn'
import { ReviewStoreProvider } from '../src/state/reviewStore'
import { LanguageProvider } from '../src/state/language'
import type { MergedInstantResult } from '../src/api/mergedClient'

const chain = (score: number, rows: { feature_id: string; value: number; weight: number }[]) => ({
  score, clamped: false, gates: [],
  rows: rows.map((r) => ({ ...r, band: null, contribution: r.value * r.weight })),
})

const withFire = {
  fires: [{
    category: 'rest_required', strength: 'clear', tick: 20, time_min: 30,
    proposal: null, proposal_error: null,
    criteria: { threshold_suggest: 0.7 },
    feature_contributions: {
      rest_required: chain(0.72, [{ feature_id: 'fatigue', value: 0.8, weight: 0.3 }]),
      monotony_prevention: chain(0.55, [{ feature_id: 'monotony', value: 0.9, weight: 0.4 }]),
    },
  }],
} as unknown as MergedInstantResult

const mount = (result: MergedInstantResult | null) =>
  render(
    <LanguageProvider>
      <ReviewStoreProvider>
        <ReviewColumn result={result} />
      </ReviewStoreProvider>
    </LanguageProvider>,
  )

describe('ReviewColumn', () => {
  it('offers the three stage tabs', () => {
    mount(withFire)
    expect(screen.getByTestId('stage-tab-trigger')).toBeTruthy()
    expect(screen.getByTestId('stage-tab-service')).toBeTruthy()
    expect(screen.getByTestId('stage-tab-content')).toBeTruthy()
  })

  it('opens on the trigger stage with both categories compared', () => {
    mount(withFire)
    expect(screen.getByTestId('margin-scale-bound')).toBeTruthy()
  })

  it('shows the firing threshold under the pickers', () => {
    mount(withFire)
    expect(screen.getByTestId('threshold-note')).toHaveTextContent('0.7')
  })

  it('disables a stage with no recorded evidence, and says why', () => {
    mount(withFire)   // this fire has no proposal at all
    const serviceTab = screen.getByTestId('stage-tab-service') as HTMLButtonElement
    expect(serviceTab.disabled).toBe(true)
    expect(serviceTab.title.length).toBeGreaterThan(0)
  })

  it('suppresses the consequence sections on the trigger stage', () => {
    mount(withFire)
    expect(screen.queryByTestId('different-setting')).toBeNull()
  })

  it('says so when the run produced no reviewable decision point', () => {
    mount({ fires: [] } as unknown as MergedInstantResult)
    expect(screen.getByTestId('no-checkpoints')).toBeTruthy()
  })

  it('says so before any run exists', () => {
    mount(null)
    expect(screen.getByTestId('no-checkpoints')).toBeTruthy()
  })

  it('reports the trigger stage unavailable when the package recorded no chain', () => {
    const bare = {
      fires: [{ category: 'rest_required', strength: null, tick: 1, time_min: 1,
                proposal: null, proposal_error: null, feature_contributions: {}, criteria: {} }],
    } as unknown as MergedInstantResult
    mount(bare)
    expect(screen.getByTestId('comparison-unavailable')).toBeTruthy()
  })

  it('keeps a judgement scoped to its decision point', () => {
    mount(withFire)
    fireEvent.change(screen.getByTestId('rationale-judge-fatigue'), { target: { value: 'too_strong' } })
    expect((screen.getByTestId('rationale-judge-fatigue') as HTMLSelectElement).value).toBe('too_strong')
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd app/frontend && npx vitest run tests/review_column.test.tsx`
Expected: FAIL — modules not found

- [ ] **Step 3: Write `reviewStore.tsx`**

Follow the shape of `src/state/proposalStore.ts` exactly — plain `createContext` +
`useReducer`, a `Provider` component and a `useReviewStore()` hook that throws a
clear error outside the provider. Actions:

```
SELECT_CASE {caseId}          SELECT_CHECKPOINT {checkpointId}
SELECT_STAGE {stage}          SELECT_TARGET {targetId}
SET_COMPARISON {leftId, rightId}
SET_JUDGMENT {key, judgment}  SET_ASSESSMENT {key, assessment, comment}
RESET
```

`SELECT_CHECKPOINT` and `SELECT_STAGE` both clear `targetId`, `compareLeftId` and
`compareRightId` — a comparison chosen at one decision point is meaningless at
another, and leaving it set would silently compare unrelated options.

Export the key builder so Task 16 uses the identical string:

```ts
export const judgmentKey = (
  caseId: string, checkpointId: string, stage: string, targetId: string, featureId: string,
): string => [caseId, checkpointId, stage, targetId, featureId].join('|')
```

- [ ] **Step 4: Write `ReviewColumn.tsx`**

1. `deriveCheckpoints(result)`. When empty, render `data-testid="no-checkpoints"`
   stating that this run produced no reviewable decision point — and, when a case
   is selected whose point is exactly that, say so as an outcome rather than a
   problem.
2. Resolve the active checkpoint's fire, then build each stage's options:
   `triggerOptions(fire)`, `serviceOptions(fire.proposal)`, `contentOptions(fire.proposal)`.
3. Render the three stage tabs. A stage whose options are `Unavailable` renders
   `disabled` with the reason in `title`.
4. Default the comparison per stage: trigger → the two categories; service →
   ranked 1 vs 2; content → position 1 vs runner-up, and any other selected
   position vs **the item above it**.
5. Mount `<WhatDecidedIt>` (passing `thresholdNote` built from `fire.criteria` on
   the trigger stage, `null` elsewhere), then `<ParameterRationale>`, then a
   placeholder slot where Task 16 mounts `<DecisionAssessment>`.
6. Wire `judgments` and `onJudge` through `useReviewStore()` and `judgmentKey`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd app/frontend && npx vitest run tests/review_column.test.tsx`
Expected: PASS (9 tests)

- [ ] **Step 6: Run every review suite and typecheck**

Run: `cd app/frontend && npx vitest run tests/review_*.test.* tests/case_*.test.* && npx tsc --noEmit 2>&1 | grep "error TS" | grep -F "<your files>"`
Expected: tests green, and no new type errors naming your files.

- [ ] **Step 7: Commit**

```bash
git add app/frontend/src/state/reviewStore.tsx \
        app/frontend/src/components/review/ReviewColumn.tsx \
        app/frontend/tests/review_column.test.tsx
git commit -m "feat(review): review store and stage-tab column assembly

Selecting a checkpoint or stage clears the comparison, so a comparison chosen
at one decision point can never silently apply to another. A stage without
recorded evidence is disabled with its reason, never silently empty."
```

**Slice 3 checkpoint.** Both full suites green. Every decision at an in-scope
checkpoint can now be explained from recorded evidence — nothing is persisted yet.

---

## Slice 4 — Feedback capture and persistence

### Task 15: Two review record kinds on the M5 feedback store

**Files:**
- Modify: `app/api/aica_api/models/feedback.py:104-125` (`FeedbackTarget`)
- Modify: `app/api/aica_api/routers/merged_runs.py` (new route)
- Test: `app/api/tests/test_review_feedback.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `POST /api/merged-runs/{merged_run_id}/review-feedback` taking
  ```
  { scope: "review_input" | "review_decision",
    case_id, checkpoint_id, stage, review_target: str,
    feature_id: str | None,       # review_input only
    labels: dict, comment: str | None }
  ```
  and `GET /api/merged-runs/{merged_run_id}/review-feedback` returning every recorded review event plus the three package versions. Task 16 calls both.

**Context:** M5 already has everything needed. `FeedbackEvent` (`kind`, `target`, `labels`, `comment`) is appended into `RunLog.events` by `append_feedback(run_id, event, runs_dir)` (`services/feedback.py:348`), which persists the whole log atomically and never rewrites prior events. Feedback there is already evidence-only.

The route resolves the merged run's `trigger_run_id` (from `MergedRunHandle`, `models/merged_run.py:52`) and delegates, so there remains exactly **one** append-only feedback store rather than a second parallel one.

`labels` for `review_input` is `{judgment: rational | too_strong | too_weak | not_relevant_here | unsure}`; for `review_decision` it is `{assessment: appropriate | not_sure | not_appropriate}` plus `comment`.

- [ ] **Step 1: Write the failing test**

```python
# app/api/tests/test_review_feedback.py
"""Review judgements ride the existing M5 append-only feedback store."""
from __future__ import annotations

import pytest

from aica_api.models.feedback import FeedbackEvent, FeedbackTarget


def test_target_accepts_the_review_input_scope():
    target = FeedbackTarget(
        scope="review_input", case_id="case-c03-monotonous-highway",
        checkpoint_id="monotony_prevention", stage="service",
        review_target="music_playlist", feature_id="monotony",
    )
    assert target.scope == "review_input"
    assert target.feature_id == "monotony"


def test_target_accepts_the_review_decision_scope_without_a_feature():
    target = FeedbackTarget(
        scope="review_decision", case_id="case-c03-monotonous-highway",
        checkpoint_id="monotony_prevention", stage="service", review_target="music_playlist",
    )
    assert target.feature_id is None


def test_existing_scopes_still_validate():
    assert FeedbackTarget(scope="run").scope == "run"
    assert FeedbackTarget(scope="decision", event_ref=3).event_ref == 3


def test_an_unknown_scope_is_rejected():
    with pytest.raises(Exception):
        FeedbackTarget(scope="not_a_scope")


def test_review_event_round_trips():
    event = FeedbackEvent(
        kind="feedback",
        target=FeedbackTarget(
            scope="review_input", case_id="c", checkpoint_id="rest_required",
            stage="trigger", review_target="rest_required", feature_id="fatigue",
        ),
        labels={"judgment": "too_strong"},
    )
    assert FeedbackEvent(**event.model_dump()).labels["judgment"] == "too_strong"
```

Then the router tests, using the FastAPI `TestClient` fixture the existing
`tests/test_feedback_router.py` already sets up — read that file and reuse its
fixtures verbatim rather than building a second client:

```python
def test_posting_a_review_judgement_appends_to_the_trigger_run_log(<same fixtures>):
    # POST /api/merged-runs/{id}/review-feedback with a review_input body → 201,
    # and the trigger run's log gains exactly one feedback event.

def test_posting_twice_appends_rather_than_replacing(<same fixtures>):
    # Two judgements on the SAME feature → two events. Append-only means the
    # reviewer's earlier opinion is never overwritten.

def test_getting_review_feedback_returns_the_package_versions(<same fixtures>):
    # The export must carry the trigger/service/content package versions in play.

def test_an_unknown_merged_run_is_404(<same fixtures>):
    ...
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd app/api && python -m pytest tests/test_review_feedback.py -v`
Expected: FAIL — `FeedbackTarget` rejects `review_input`

- [ ] **Step 3: Extend `FeedbackTarget`**

```python
    scope: Literal["run", "decision", "proposal", "action", "review_input", "review_decision"]
    event_ref: int | None = None
    tick_index: int | None = None
    proposal_id: str | None = None
    action: str | None = None
    # Review anchors (feature: combined review screen). A review judgement is
    # keyed by (case · decision point · stage · target), plus the feature for a
    # per-input judgement. All optional so existing scopes are unchanged.
    case_id: str | None = None
    checkpoint_id: str | None = None
    stage: str | None = None
    review_target: str | None = None
    feature_id: str | None = None
```

- [ ] **Step 4: Add the routes**

In `app/api/aica_api/routers/merged_runs.py`, following the existing route style
(read `POST /api/merged-runs/{merged_run_id}/decline` for the handle-lookup and
404 pattern and mirror it):

```python
class ReviewFeedbackBody(BaseModel):
    """POST body for /api/merged-runs/{id}/review-feedback."""

    scope: Literal["review_input", "review_decision"]
    case_id: str
    checkpoint_id: str
    stage: str
    review_target: str
    feature_id: str | None = None
    labels: dict = {}
    comment: str | None = None
```

The POST handler resolves the merged-run handle (404 when absent), builds a
`FeedbackEvent(kind="feedback", target=FeedbackTarget(**body-fields), labels=..., comment=...)`,
and calls `append_feedback(handle.trigger_run_id, event, settings.runs_dir)`.
Returns 201.

The GET handler reads the trigger run's log, filters `events` to feedback events
whose `target.scope` starts with `review_`, and returns them alongside the three
package ids/versions recorded on the merged run.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd app/api && python -m pytest tests/test_review_feedback.py tests/test_feedback_router.py tests/test_feedback_models.py -v`
Expected: PASS — new tests plus the existing feedback suites unchanged.

- [ ] **Step 6: Run the whole backend suite**

Run: `cd app/api && python -m pytest -q`
Expected: PASS. `FeedbackTarget` gained only optional fields and two `Literal` members, so existing callers are unaffected.

- [ ] **Step 7: Commit**

```bash
git add app/api/aica_api/models/feedback.py app/api/aica_api/routers/merged_runs.py \
        app/api/tests/test_review_feedback.py
git commit -m "feat(feedback): review-input and review-decision records on the M5 store

Delegates to the existing append-only append_feedback rather than standing up a
second feedback store. Two judgements on one feature append twice — the
reviewer's earlier opinion is never overwritten."
```

---

### Task 16: Assessment card, persistence, export

**Files:**
- Create: `app/frontend/src/components/review/DecisionAssessment.tsx`
- Modify: `app/frontend/src/api/mergedClient.ts` (two client functions)
- Modify: `app/frontend/src/components/review/ReviewColumn.tsx` (mount + persist)
- Test: `app/frontend/tests/review_assessment.test.tsx`

**Interfaces:**
- Consumes: `useReviewStore`, `judgmentKey` (Task 14); the two routes from Task 15.
- Produces:
  ```tsx
  <DecisionAssessment caseId={string} checkpointId={string} stage={ReviewStage} targetId={string}
                      judgmentSummary={{ judged: number; total: number; flags: number }}
                      assessment={string | null} comment={string}
                      onAssess={(assessment: string) => void} onComment={(text: string) => void}
                      onExport={() => void} />
  postReviewFeedback(mergedRunId: string, body: ReviewFeedbackBody): Promise<void>
  getReviewFeedback(mergedRunId: string): Promise<ReviewFeedbackExport>
  ```

**Context (07-27 §10):** the card opens with a **summary of the per-input judgements made at that decision**, and an *n / m inputs judged · k still open* count so the reviewer can see how much of the decision they have actually examined. Export produces the §10 JSON plus the package versions.

**"Not sure" is not a flag.** It counts toward `judged` but never toward `flags`. This is the rule most likely to regress, so it gets its own test.

- [ ] **Step 1: Write the failing test**

```tsx
// app/frontend/tests/review_assessment.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import DecisionAssessment from '../src/components/review/DecisionAssessment'
import { LanguageProvider } from '../src/state/language'
import { summarizeJudgments } from '../src/components/review/DecisionAssessment'

const wrap = (ui: React.ReactNode) => render(<LanguageProvider>{ui}</LanguageProvider>)
const mount = (extra = {}) =>
  wrap(
    <DecisionAssessment
      caseId="case-c03-monotonous-highway" checkpointId="monotony_prevention"
      stage="service" targetId="music_playlist"
      judgmentSummary={{ judged: 3, total: 8, flags: 2 }}
      assessment={null} comment="" onAssess={() => {}} onComment={() => {}} onExport={() => {}}
      {...extra}
    />,
  )

describe('summarizeJudgments', () => {
  it('counts a judged input even when the reviewer is unsure', () => {
    const s = summarizeJudgments({ a: 'unsure', b: 'rational' }, 5)
    expect(s.judged).toBe(2)
    expect(s.total).toBe(5)
  })

  it('never counts "not sure" as a flag', () => {
    // It is a request for EXPLANATION, not a complaint, and must not inflate a
    // number that means "these need attention".
    const s = summarizeJudgments({ a: 'unsure', b: 'unsure' }, 4)
    expect(s.flags).toBe(0)
  })

  it('never counts "makes sense" as a flag', () => {
    expect(summarizeJudgments({ a: 'rational' }, 3).flags).toBe(0)
  })

  it('counts exactly the three criticisms as flags', () => {
    const s = summarizeJudgments(
      { a: 'too_strong', b: 'too_weak', c: 'not_relevant_here', d: 'rational', e: 'unsure' }, 5)
    expect(s.flags).toBe(3)
  })

  it('ignores an unset judgement', () => {
    expect(summarizeJudgments({ a: '' }, 2).judged).toBe(0)
  })
})

describe('DecisionAssessment', () => {
  it('opens with the judgement summary and the open count', () => {
    mount()
    const summary = screen.getByTestId('judgment-summary').textContent ?? ''
    expect(summary).toContain('3')
    expect(summary).toContain('8')
    expect(summary).toContain('5')       // 8 − 3 still open
  })

  it('offers the three assessments', () => {
    mount()
    expect(screen.getByTestId('assess-appropriate')).toBeTruthy()
    expect(screen.getByTestId('assess-not-sure')).toBeTruthy()
    expect(screen.getByTestId('assess-not-appropriate')).toBeTruthy()
  })

  it('reports the chosen assessment', () => {
    const onAssess = vi.fn()
    mount({ onAssess })
    fireEvent.click(screen.getByTestId('assess-not-appropriate'))
    expect(onAssess).toHaveBeenCalledWith('not_appropriate')
  })

  it('takes a free comment for what they expected instead', () => {
    const onComment = vi.fn()
    mount({ onComment })
    fireEvent.change(screen.getByTestId('assess-comment'), { target: { value: 'expected rest' } })
    expect(onComment).toHaveBeenCalledWith('expected rest')
  })

  it('reflects an existing assessment', () => {
    mount({ assessment: 'appropriate' })
    expect(screen.getByTestId('assess-appropriate').getAttribute('aria-pressed')).toBe('true')
  })

  it('exports', () => {
    const onExport = vi.fn()
    mount({ onExport })
    fireEvent.click(screen.getByTestId('assess-export'))
    expect(onExport).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd app/frontend && npx vitest run tests/review_assessment.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `DecisionAssessment.tsx`**

Export `summarizeJudgments` from the same module so the rule is testable without
rendering:

```tsx
/** The three criticisms. "Not sure" and "Makes sense" are deliberately absent. */
const FLAG_JUDGMENTS = new Set(['too_strong', 'too_weak', 'not_relevant_here'])

export function summarizeJudgments(
  judgments: Record<string, string>,
  total: number,
): { judged: number; total: number; flags: number } {
  const set = Object.values(judgments).filter(Boolean)
  return {
    judged: set.length,
    total,
    // "Not sure" is a request for explanation, not a complaint — counting it
    // here would inflate a number that means "these need attention".
    flags: set.filter((j) => FLAG_JUDGMENTS.has(j)).length,
  }
}
```

The card renders `judgment-summary` (*n / m inputs judged · k still open*), the
three assessment buttons with `aria-pressed`, `assess-comment` for what they
expected instead and why, and `assess-export`. All strings bilingual.

- [ ] **Step 4: Add the client functions**

In `src/api/mergedClient.ts`, following the existing fetch helpers there:

```ts
export type ReviewFeedbackBody = {
  scope: 'review_input' | 'review_decision'
  case_id: string
  checkpoint_id: string
  stage: string
  review_target: string
  feature_id?: string | null
  labels: Record<string, unknown>
  comment?: string | null
}
```

`postReviewFeedback` POSTs to `/api/merged-runs/${mergedRunId}/review-feedback`;
`getReviewFeedback` GETs the same path. Mirror the existing error handling in that
file rather than inventing a new one.

- [ ] **Step 5: Wire persistence into `ReviewColumn`**

- Mount `<DecisionAssessment>` in the slot Task 14 left for it.
- On every `onJudge`, dispatch `SET_JUDGMENT` **and** fire `postReviewFeedback`
  with `scope: 'review_input'`. A failed POST must surface an error, never fail
  silently — a judgement the reviewer believes was recorded but was not is worse
  than an unrecorded one.
- Same for `onAssess`/`onComment` with `scope: 'review_decision'`.
- `onExport` calls `getReviewFeedback` and downloads the JSON.
- When there is no live merged run yet, the card still records into the store and
  states that persistence begins once a run exists.

- [ ] **Step 6: Run the test and the full frontend suite**

Run: `cd app/frontend && npx vitest run tests/review_assessment.test.tsx && npx vitest run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add app/frontend/src/components/review/DecisionAssessment.tsx \
        app/frontend/src/api/mergedClient.ts \
        app/frontend/src/components/review/ReviewColumn.tsx \
        app/frontend/tests/review_assessment.test.tsx
git commit -m "feat(review): decision assessment, judgement persistence and export

The summary counts 'Not sure' as judged but never as a flag — it is a request
for explanation, not a complaint."
```

**Slice 4 checkpoint.** Both suites green; a reviewer's judgement now survives a refresh.

---

## Slice 5 — Reshape

### Task 17: Three-column layout with proposals in the centre

**Files:**
- Modify: `app/frontend/src/components/merged/MergedShell.tsx:98-113`
- Modify: `app/frontend/src/styles/app.css:84-125`
- Modify: `app/frontend/src/components/merged/MergedCenterPanel.tsx`
- Create: `app/frontend/src/components/review/CheckpointRail.tsx`, `app/frontend/src/components/review/DecisionBand.tsx`
- Test: `app/frontend/tests/merged_review_layout.test.tsx`

**Interfaces:**
- Consumes: `deriveCheckpoints`, `Checkpoint` (Task 11); `useReviewStore` (Task 14); `ExperienceCasePicker`/`ExperienceCaseCard`/`CaseDetailsModal` (Task 9); `ReviewColumn` (Task 14).
- Produces: the reshaped shell. Task 18 modifies the setup panel inside it.

**Context:** today the shell is `2fr 5fr 3fr` with the left panel stacking `.merged-left-setup` over `.merged-left-log`, and `MergedProposalPanel` in the right panel (`MergedShell.tsx:98-113`). The reshape:

- Grid → `20 / 45 / 35`.
- Left → case picker, case card, setup panel. `.merged-left-log` and its CSS rule are **removed**; `MergedLogPanel` is no longer imported here. The component file stays — `MergedRunsScreen`/`MergedReplayViewer` still use it.
- Centre → existing timeline/playback/map, then `CheckpointRail`, `DecisionBand`, then the service and content cards at **42 / 58**.
- Right → `ReviewColumn`.

**The playback redraw rule is structural, not cosmetic.** The animated subtree (timeline, rail, map, clock) and the proposal subtree must be **siblings**, so a playback tick never re-renders the proposal cards and collapses an expanded contribution chain mid-run. There is a test for exactly this.

- [ ] **Step 1: Write the failing test**

```tsx
// app/frontend/tests/merged_review_layout.test.tsx
import { render, screen, fireEvent, within } from '@testing-library/react'
import MergedShell from '../src/components/merged/MergedShell'
import { LanguageProvider } from '../src/state/language'

const mount = () => render(<LanguageProvider><MergedShell /></LanguageProvider>)

describe('Combined review layout', () => {
  it('keeps the three-panel shell', () => {
    mount()
    expect(screen.getByTestId('merged-shell')).toBeTruthy()
  })

  it('puts the case picker and the setup panel in the left column', () => {
    mount()
    const left = screen.getByTestId('merged-shell').querySelector('.left-panel')!
    expect(within(left as HTMLElement).getByTestId('experience-case-picker')).toBeTruthy()
    expect(within(left as HTMLElement).getByTestId('merged-setup-panel')).toBeTruthy()
  })

  it('moves the proposal output into the centre column', () => {
    mount()
    const centre = screen.getByTestId('merged-shell').querySelector('.center-panel')!
    expect(within(centre as HTMLElement).getByTestId('merged-proposal-panel')).toBeTruthy()
  })

  it('puts the review column on the right', () => {
    mount()
    const right = screen.getByTestId('merged-shell').querySelector('.right-panel')!
    expect(within(right as HTMLElement).getByTestId('review-column')).toBeTruthy()
  })

  it('drops the log panel from the review layout', () => {
    mount()
    expect(screen.queryByTestId('merged-log-panel')).toBeNull()
  })

  it('keeps the log available on the Runs screen', () => {
    mount()
    fireEvent.click(screen.getByTestId('merged-view-runs'))
    expect(screen.getByTestId('merged-runs-screen')).toBeTruthy()
  })

  it('keeps the animated subtree a SIBLING of the proposal subtree', () => {
    // Structural guarantee: a playback tick must not re-render the proposal
    // cards, or an expanded contribution chain collapses mid-run.
    mount()
    const playback = screen.getByTestId('merged-playback-subtree')
    const proposals = screen.getByTestId('merged-proposal-panel')
    expect(playback.contains(proposals)).toBe(false)
    expect(proposals.contains(playback)).toBe(false)
  })
})
```

Confirm the real test ids for the setup, proposal, runs and log panels first —
`grep -rn "data-testid=\"merged-" src/components/merged/` — and use those exact
strings rather than the ones assumed above.

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd app/frontend && npx vitest run tests/merged_review_layout.test.tsx`
Expected: FAIL

- [ ] **Step 3: Update the CSS**

In `src/styles/app.css`, replace the `.merged-shell` grid and delete the
`.merged-left-log` rule:

```css
/* 20 : 45 : 35 — left case+setup, centre simulation+proposals, right review. */
.merged-shell {
  display: grid;
  grid-template-columns: 20fr 45fr 35fr;
  grid-template-rows: 1fr;
  height: 100%;
  width: 100%;
  overflow: hidden;
}

/* Left column is a single scrolling stack now that the log has moved out. */
.merged-shell .left-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
}

/* Service and content side by side; content is wider because it carries more. */
.merged-proposal-split {
  display: grid;
  grid-template-columns: minmax(0, 42fr) minmax(0, 58fr);
  gap: 9px;
  align-items: start;
}
@media (max-width: 1400px) {
  .merged-proposal-split { grid-template-columns: 1fr; }
}
```

Keep the existing `.merged-shell .right-panel { background: #ffffff }` override —
the right column is still light-themed.

- [ ] **Step 4: Write `CheckpointRail.tsx` and `DecisionBand.tsx`**

`CheckpointRail` takes `{ checkpoints, selectedId, onSelect }` and renders one
row per checkpoint (`data-testid="checkpoint-row"`) with its time and bilingual
label. With no checkpoints it renders a short line saying this run produced no
reviewable decision point — informative, not an error.

`DecisionBand` takes `{ checkpoint }` and names the decision point under review
(`data-testid="decision-band"`), with its category label and time.

- [ ] **Step 5: Reshape `MergedShell` and `MergedCenterPanel`**

In `MergedShell.tsx`, remove the `MergedLogPanel` import and the
`.merged-left-log` wrapper, then:

```tsx
<div className="merged-shell" data-testid="merged-shell">
  <div className="left-panel">
    <ExperienceCasePicker ... />
    {selectedCase && <ExperienceCaseCard testCase={selectedCase} onOpenDetails={...} />}
    <MergedSetupPanel />
    <CaseDetailsModal ... />
  </div>
  <div className="center-panel">
    <MergedCenterPanel />
  </div>
  <div className="right-panel">
    <ReviewColumn result={...} />
  </div>
</div>
```

Wrap the whole shell in `<ReviewStoreProvider>` inside the existing
`ProposalStoreProvider`, so the review store is scoped exactly like the other two.

Selecting a case applies it: `resolveCase` → `caseDispatches` → dispatch each
action into the two stores, fetch the profile with `getPreset(profileRef)` and
attach it to the `LOAD_PROFILE` dispatch, and hand `routePresetId` /
`mountainRangeKm` / `jamRangeKm` to `MergedSetupPanel` (Task 18 adds the props).

In `MergedCenterPanel.tsx`, wrap the existing timeline/playback/map in a
`data-testid="merged-playback-subtree"` element, then render `CheckpointRail`,
`DecisionBand`, and `<div className="merged-proposal-split"><MergedProposalPanel /></div>`
as **siblings** of that element — never as descendants.

- [ ] **Step 6: Run the layout test and the whole frontend suite**

Run: `cd app/frontend && npx vitest run tests/merged_review_layout.test.tsx && npx vitest run`
Expected: PASS. Existing merged tests asserting the old 4-panel structure will
fail — update them to the new structure, but **do not** weaken an assertion that
was checking real behaviour just to make it pass.

- [ ] **Step 7: Commit**

```bash
git add app/frontend/src/components/merged/MergedShell.tsx \
        app/frontend/src/components/merged/MergedCenterPanel.tsx \
        app/frontend/src/components/review/CheckpointRail.tsx \
        app/frontend/src/components/review/DecisionBand.tsx \
        app/frontend/src/styles/app.css \
        app/frontend/tests/merged_review_layout.test.tsx
git commit -m "feat(review): reshape Combined to 20/45/35 with proposals in the centre

Log panel drops out of the review layout and stays on the Runs/replay screens.
The animated subtree is a sibling of the proposal subtree so playback cannot
collapse an expanded contribution chain."
```

---

### Task 18: Two-tier setup editors

**Files:**
- Modify: `app/frontend/src/components/merged/MergedSetupPanel.tsx`
- Test: `app/frontend/tests/merged_setup_two_tier.test.tsx`

**Interfaces:**
- Consumes: `differsFromCase`, `ResolvedCaseSetup` (Task 8).
- Produces: the five two-tier editors, the 🚗/⚙ badges, and the differs-from-case note.

**Context — the most important constraint in the design.** The detailed view of
every editor **mounts the existing component verbatim**. Not re-styled, not
re-laid-out, not re-grouped, not rebuilt from the package manifests. `MergedSetupPanel`
already mounts all nine; this task adds a basic view *in front of* them, and a
button that switches between the two.

Verified component paths:

| Edit button | Detailed view mounts |
|---|---|
| Situation | `components/setup/situation/FixedConditionsSection` + `components/proposal/panels/sections/SituationFieldRows` + `components/merged/RouteConditionsPainter` + `components/setup/situation/SpeedProfileSection` + `components/setup/situation/SimulatedSignalsSection` |
| Driver profile | `components/proposal/panels/sections/PreferenceHistorySection` |
| Trigger | `components/setup/AlgorithmFormulationPanel` |
| Service | `components/proposal/panels/sections/ServiceSetupSection` |
| Content | `components/proposal/panels/sections/ContentSetupSection` |

All inside `Modal` at `size="wide"`.

Basic tier content (07-27 §9.1) — only what a reviewer routinely turns:

| Editor | Basic content |
|---|---|
| Trigger | `threshold_suggest`, `monotony_suggest_threshold` |
| Service | the three top-level `hierarchy_weights` shares + `top_k` |
| Content | the three `content_category_weights` + `plan_item_count` + the α/β `context_response_matrix` |
| Situation | only what **this case fixes** + driver state at departure |
| Driver profile | only what **this case fixes** + the persona's defining preferences |

Where a case pins nothing in that area, **say so** rather than showing an empty box.

Badges: 🚗 *situation* (changing it reviews the same algorithm somewhere else) and
⚙ *algorithm* (changing it reviews the same situation under a different
configuration — the tuning loop). **Labels only. Nothing is disabled, nothing greys out.**

- [ ] **Step 1: Write the failing test**

```tsx
// app/frontend/tests/merged_setup_two_tier.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import MergedSetupPanel from '../src/components/merged/MergedSetupPanel'
// Mount with the same provider stack MergedShell uses — copy it from
// tests/merged_center.test.tsx rather than reinventing it here.

describe('two-tier setup editors', () => {
  it('opens the trigger editor in the basic view', () => {
    // click Edit on Trigger → basic view visible, detailed component absent
    expect(screen.getByTestId('setup-basic-trigger')).toBeTruthy()
    expect(screen.queryByTestId('algorithm-formulation-panel')).toBeNull()
  })

  it('shows only the two thresholds in the basic trigger view', () => {
    expect(screen.getByTestId('basic-threshold_suggest')).toBeTruthy()
    expect(screen.getByTestId('basic-monotony_suggest_threshold')).toBeTruthy()
  })

  it('reveals the EXISTING editor component on the detailed switch', () => {
    fireEvent.click(screen.getByTestId('setup-detailed-toggle'))
    expect(screen.getByTestId('algorithm-formulation-panel')).toBeTruthy()
  })

  it('switches back to basic', () => {
    fireEvent.click(screen.getByTestId('setup-detailed-toggle'))
    fireEvent.click(screen.getByTestId('setup-detailed-toggle'))
    expect(screen.getByTestId('setup-basic-trigger')).toBeTruthy()
  })

  it('mounts the detailed editor in a WIDE modal', () => {
    fireEvent.click(screen.getByTestId('setup-detailed-toggle'))
    expect(document.querySelector('.modal-card--wide')).toBeTruthy()
  })

  it('says so when the case pins nothing in this area', () => {
    // Rather than showing an empty box (07-27 §9.1).
    expect(screen.getByTestId('basic-pins-nothing')).toBeTruthy()
  })

  it('badges each control as situation or algorithm', () => {
    expect(screen.getAllByTestId('setup-badge').length).toBeGreaterThan(0)
  })

  it('never disables a control — the badges are labels, not locks', () => {
    for (const el of screen.getAllByRole('combobox')) {
      expect((el as HTMLSelectElement).disabled).toBe(false)
    }
  })

  it('notes when the setup differs from the case, and offers Reset', () => {
    // change the seed → note appears with a Reset button
    expect(screen.getByTestId('differs-from-case')).toBeTruthy()
    expect(screen.getByTestId('reset-to-case')).toBeTruthy()
  })

  it('shows no note while the setup matches the case', () => {
    expect(screen.queryByTestId('differs-from-case')).toBeNull()
  })
})
```

Fill in each test's arrange step from the existing `tests/merged_center.test.tsx`
provider stack and the panel's real Edit-button test ids
(`grep -n 'data-testid' src/components/merged/MergedSetupPanel.tsx`).

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd app/frontend && npx vitest run tests/merged_setup_two_tier.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement**

Add `const [detailed, setDetailed] = useState(false)` alongside the existing
`openEdit` state, reset to `false` whenever `openEdit` changes so every popup
opens basic. Inside each editor's `Modal`, render the `▸ Detailed setup — every
parameter` toggle, then either the new basic view or **the existing mounts,
completely untouched**.

Add `props` for the case: `caseSetup: ResolvedCaseSetup | null`, plus the
route-preset and painted-range values Task 17 hands down. Compute the live
snapshot and call `differsFromCase` to drive the note and Reset.

- [ ] **Step 4: Verify no existing editor markup changed**

Run: `git diff --stat app/frontend/src/components/setup/ app/frontend/src/components/proposal/panels/sections/`
Expected: **empty**. Any change to those files means an editor was modified rather
than mounted, which the design forbids. Revert and mount instead.

- [ ] **Step 5: Run the test and the full frontend suite**

Run: `cd app/frontend && npx vitest run tests/merged_setup_two_tier.test.tsx && npx vitest run && npx tsc --noEmit 2>&1 | grep "error TS" | grep -F "<your files>"`
Expected: tests green, and no new type errors naming your files.

- [ ] **Step 6: Commit**

```bash
git add app/frontend/src/components/merged/MergedSetupPanel.tsx \
        app/frontend/tests/merged_setup_two_tier.test.tsx
git commit -m "feat(setup): basic/detailed two-tier editors with situation and algorithm badges

The detailed tier mounts the existing components verbatim — no restyle, no
regroup, no rebuild from manifests. Badges are labels; nothing is disabled."
```

---

### Task 19: The remaining four cases and integration coverage

**Files:**
- Create: `combined_contracts/test_cases/case-c02-night-highway-drowsiness.json`, `case-c04-mountain-road-workload.json`, `case-c05-late-night-traffic-jam.json`, `case-c06-full-rest-lifecycle.json`
- Test: `app/api/tests/test_combined_case_integration.py`

**Interfaces:**
- Consumes: the schema (Task 6), the review pipeline (Slices 1–4).
- Produces: the complete six-case catalog.

**Context:** each new case follows C-01/C-03's structure exactly. Assignments:

| Case | Scenario | Route | Pins |
|---|---|---|---|
| C-02 Night highway drowsiness | `uc01_fatigue_recovery_v0_1` | `long_tokyo_osaka` | `is_night: true`, elevated initial drowsiness |
| C-04 Mountain road, high workload | `uc01_fatigue_recovery_v0_1` | `middle_tokyo_karuizawa` | a `mountain_range_km` band |
| C-05 Late-night traffic jam | `uc01_fatigue_recovery_v0_1` | `long_tokyo_osaka` | `is_night: true` + a `jam_range_km` band |
| C-06 Full rest lifecycle | `uc01_fatigue_recovery_v0_1` | `long_tokyo_osaka` | high initial fatigue; `automatic_path.rest_response: "accept"` |

**C-06 contributes only its first checkpoint.** Its stopped and after-nap stages
simulate and display but expose no review target — that is the V1 boundary, and
its brief should say so plainly so a reviewer is not left hunting for the rest of
the lifecycle in the rail.

Choose each `profile_ref` from `proposal_contracts/presets/` by reading the preset
and picking one whose driver profile actually matches the persona — a mismatched
profile makes the case incoherent even though it validates.

- [ ] **Step 1: Write the four case files**

Model each on `case-c03-monotonous-highway.json`. Every one needs a bilingual
title, a two-sentence brief, at least one `what_to_watch` chip, a persona with a
narrative and only case-relevant assumptions, a journey with `seed` and
`tick_seconds`, and the three algorithm defaults.

- [ ] **Step 2: Run the contract test over all six**

Run: `cd app/api && python -m pytest tests/test_combined_case_contract.py -v`
Expected: PASS, parametrized across six files.

- [ ] **Step 3: Write the integration test**

```python
# app/api/tests/test_combined_case_integration.py
"""Every committed case runs through the real merged path and yields a review.

This is the test that would catch a case whose journey never reaches the
decision point it was written to examine.
"""
```

For each case: resolve its references, build the merged quickview request the
frontend would build, run it through the real production path (copy the setup
from `tests/test_merged_quickview.py`), and assert:

- The run completes without an algorithm error.
- For every case except C-01, at least one in-scope fire occurs, and that fire's
  `feature_contributions` carries **both** categories with non-empty rows.
- For C-01, **no** in-scope fire occurs — its whole point.
- Wherever a fire has a proposal, its content plan has either a non-empty
  `scored_tail` or `tail_truncated is False` with a genuinely exhausted pool.

Assert acceptable sets, ranges and predicates — **not** exact floating-point
values, except where a test explicitly targets formula math.

- [ ] **Step 4: Run the integration test**

Run: `cd app/api && python -m pytest tests/test_combined_case_integration.py -v`
Expected: PASS.

A case that fails here is a **case-authoring** problem, not a code problem: its
journey does not reach the decision point it was written to examine. Retune the
case's pins (initial drowsiness/fatigue, painted bands, route) until it does.
Do **not** weaken the assertion, and do **not** retune an algorithm to make a case
pass — that would make the catalog a record of tuned behaviour, which is exactly
what this design exists to avoid.

- [ ] **Step 5: Run both full suites**

Run: `cd app/api && python -m pytest -q` then `cd app/frontend && npx vitest run && npx vite build`
Expected: tests green and build clean. Also confirm `npx tsc --noEmit 2>&1 | grep -c "error TS"` has not risen above the 167-error baseline.

- [ ] **Step 6: Commit**

```bash
git add combined_contracts/test_cases/ app/api/tests/test_combined_case_integration.py
git commit -m "feat(cases): complete the six-case catalog with integration coverage

One test per case through the real merged path. C-01 asserts NO fire — a
control case earns its place by producing nothing."
```

---

## Done

All five slices complete. Final verification:

```bash
cd app/api && python -m pytest -q
cd app/frontend && npx vitest run && npx vite build
# and confirm tsc error count has not risen above the 167 baseline
```

Then walk the running app: `docker compose up`, open the Combined screen, select
each of the six cases, and confirm the rail, the three stage tabs, a judgement
and an export behave as described. Tests do not catch a layout that technically
renders but cannot be read.
