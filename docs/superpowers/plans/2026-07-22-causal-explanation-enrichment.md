# Causal Explanation Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make service and song proposal explanations *causal* — "drowsiness is high → the situation calls for energetic music → this high-arousal song answers that" — instead of merely score-shaped, on both the LLM path and the deterministic fallback.

**Architecture:** Split the single `explanation_builder.py` (which branches on `is_service` everywhere) into a shared kernel plus `service_explanation.py` and `content_explanation.py`. All facts come from evidence already on disk (category subtotals, `trait_values`, per-row `alpha`/`beta`). A deterministic causal composer produces the reliable fallback; the LLM is fed the same structured facts to author a richer narrative. The public API (`build_explanation_prompt`, `template_rationale`, `parse_bilingual`, `response_is_usable`, `strip_placeholder_artifacts`, `prompt_hash`) stays on `explanation_builder`, so `routers/proposal.py` is untouched.

**Tech Stack:** Python 3.12, Pydantic v2 models (`ExplanationPrompt`, `ExplainMessage`), pytest. Pure functions only (no I/O).

## Global Constraints

- **No invented facts.** Every line fed to the model or emitted by the template must be reshaped from data already present on the `target`/`context`. Copied verbatim from the module docstring and design (Constitution I/II/V).
- **Output contract is `[ja, en]`** — a positional two-element list; the model prompt requires exactly two lines, `JA:` then `EN:`. Do not change this shape (parser, `response_is_usable`, and the frontend depend on it).
- **Public API unchanged.** `explanation_builder.build_explanation_prompt(step, target, context)`, `.template_rationale(step, target)`, `.parse_bilingual`, `.response_is_usable`, `.strip_placeholder_artifacts`, `.prompt_hash`, `.label_for`, `.MAX_FACTORS`, `._EXAMPLE_JA`, `._EXAMPLE_EN` must all remain importable from `aica_api.services.explanation_builder` (existing tests + `routers/proposal.py:76,2053-2117` rely on them).
- **Determinism.** Same inputs → same prompt (so `prompt_hash` is stable). No `datetime.now`, no randomness in these modules.
- **Test-run command (this environment — Docker absent, uv proxy-blocked, per project memory):**
  from repo root: `PYTHONPATH=app/api python -m pytest app/api/tests/proposal/test_explanation_builder.py -v`
  (New per-module test files run the same way with their own paths.)

---

### Task 1: Split into shared kernel + two step modules (pure refactor, tests stay green)

Mechanical extraction. No behavior change. The existing test suite is the safety net — it must pass before and after with **zero edits to the test file**.

**Files:**
- Modify: `app/api/aica_api/services/explanation_builder.py`
- Create: `app/api/aica_api/services/service_explanation.py`
- Create: `app/api/aica_api/services/content_explanation.py`
- Test (unchanged, used as regression gate): `app/api/tests/proposal/test_explanation_builder.py`

**Interfaces:**
- Produces (kernel, `explanation_builder`): `label_for(feature_id)->dict[str,str]`, `feature_meaning(feature_id)->str`, `FEATURE_LABELS`, `_FEATURE_MEANINGS`, `MAX_FACTORS`, `_MIN_ABS_CONTRIBUTION`, `_CONTENT_LANG_SEP`, `_factors_from_target(target)->list[dict]`, `parse_bilingual`, `response_is_usable`, `strip_placeholder_artifacts`, `_PLACEHOLDER_RE`, `_EXAMPLE_JA`, `_EXAMPLE_EN`, `_FORMAT_REMINDER`, `_SYSTEM_TEMPLATE`, `prompt_hash`, and dispatchers `build_explanation_prompt(step,target,context)`, `template_rationale(step,target)`.
- Produces (`service_explanation`): `build_prompt(target, context)->ExplanationPrompt`, `template(target)->list[str]`.
- Produces (`content_explanation`): `build_prompt(target, context)->ExplanationPrompt`, `template(target)->list[str]`, `_song_facts_lines(target, context)->list[str]`.

- [ ] **Step 1: Run the existing suite to establish a green baseline**

Run: `PYTHONPATH=app/api python -m pytest app/api/tests/proposal/test_explanation_builder.py -v`
Expected: PASS (all ~30 tests). This is the regression contract for the refactor.

- [ ] **Step 2: Create `content_explanation.py` and move the content-only body**

Move `_song_facts_lines` (currently `explanation_builder.py:252-280`) here verbatim, and add `build_prompt` + `template` holding the **content branch** of the current `build_explanation_prompt` / `template_rationale` (the `is_service == False` paths, lines ~283-388 and ~522-534). Import shared helpers from the kernel.

```python
"""content_explanation — content (song) proposal explanation.

Builds the grounded prompt and the deterministic template for a content
OrderedItem. Pure (no I/O). Uses the shared kernel in ``explanation_builder``
for labels, factor extraction, parsing, and format anchoring.
"""
from __future__ import annotations

from typing import Any

from aica_api.models.proposal.explanation import ExplainMessage, ExplanationPrompt
from aica_api.services import explanation_builder as _k  # shared kernel


def _song_facts_lines(target: dict[str, Any], context: dict[str, Any]) -> list[str]:
    ...  # moved verbatim from the current explanation_builder._song_facts_lines


def build_prompt(target: dict[str, Any], context: dict[str, Any]) -> ExplanationPrompt:
    """Content branch of the former build_explanation_prompt (is_service=False)."""
    ...  # moved verbatim; kind_en="song", uses target["item_id"]/["position"]/["item_fit"],
         # _song_facts_lines(...), _k._factors_from_target, _k.label_for, _k._SYSTEM_TEMPLATE,
         # _k._FORMAT_REMINDER, strongest_support/oppose fallback for supporting/opposing.


def template(target: dict[str, Any]) -> list[str]:
    """Content branch of the former template_rationale (variable-length
    '<ja> / <en>' list → clean [ja, en] pair)."""
    ...  # moved verbatim from the content half of template_rationale
```

- [ ] **Step 3: Create `service_explanation.py` and move the service-only body**

```python
"""service_explanation — service proposal explanation.

Builds the grounded prompt and the deterministic template for a service
RankedCandidate. Pure (no I/O). Uses the shared kernel in ``explanation_builder``.
"""
from __future__ import annotations

from typing import Any

from aica_api.models.proposal.explanation import ExplainMessage, ExplanationPrompt
from aica_api.services import explanation_builder as _k


def build_prompt(target: dict[str, Any], context: dict[str, Any]) -> ExplanationPrompt:
    """Service branch of the former build_explanation_prompt (is_service=True)."""
    ...  # moved verbatim; kind_en="service", uses target["candidate_id"]/["rank"]/["score"],
         # no song_facts, supporting_/opposing_feature_ids directly.


def template(target: dict[str, Any]) -> list[str]:
    """Service branch of the former template_rationale (already-positional
    [ja, en] pair; pad/truncate to length 2)."""
    ...  # moved verbatim from the service half of template_rationale
```

- [ ] **Step 4: Reduce `explanation_builder.py` to kernel + dispatchers**

Keep every shared constant/function listed in the Interfaces block. Delete `_song_facts_lines` (moved). Replace the bodies of the two public entry points with dispatchers that import the step modules **inside the function** (avoids a circular import, since the step modules import the kernel at module load):

```python
def build_explanation_prompt(step: str, target: dict[str, Any], context: dict[str, Any]) -> ExplanationPrompt:
    """Dispatch to the per-step builder. ``step`` is 'service' or 'content'."""
    from aica_api.services import service_explanation, content_explanation
    if step == "service":
        return service_explanation.build_prompt(target, context)
    return content_explanation.build_prompt(target, context)


def template_rationale(step: str, target: dict[str, Any]) -> list[str]:
    """Dispatch to the per-step deterministic template."""
    from aica_api.services import service_explanation, content_explanation
    if step == "service":
        return service_explanation.template(target)
    return content_explanation.template(target)
```

- [ ] **Step 5: Run the suite — refactor must be behavior-preserving**

Run: `PYTHONPATH=app/api python -m pytest app/api/tests/proposal/test_explanation_builder.py -v`
Expected: PASS (identical result to Step 1, test file unedited).

- [ ] **Step 6: Sanity-check the caller still imports cleanly**

Run: `PYTHONPATH=app/api python -c "from aica_api.routers import proposal; from aica_api.services import service_explanation, content_explanation; print('ok')"`
Expected: prints `ok` (no ImportError, no circular-import error).

- [ ] **Step 7: Commit**

```bash
git add app/api/aica_api/services/explanation_builder.py app/api/aica_api/services/service_explanation.py app/api/aica_api/services/content_explanation.py
git commit -m "refactor(explain): split explanation_builder into service/content modules + shared kernel"
```

---

### Task 2: Shared `category_readout` helper

Turns the three §14 subtotals into a signed trio plus the dominant family and a bilingual "driven mostly by …" phrase. Used by both step modules (Tasks 4–6).

**Files:**
- Modify: `app/api/aica_api/services/explanation_builder.py`
- Test: `app/api/tests/proposal/test_explanation_kernel.py` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces: `category_readout(target: dict) -> dict | None` returning
  `{"situation": float, "preference": float, "history": float, "dominant": "situation"|"preference"|"history", "phrase_ja": str, "phrase_en": str}`,
  or `None` when none of the three `*_fit` keys is a number.

- [ ] **Step 1: Write the failing test**

```python
# app/api/tests/proposal/test_explanation_kernel.py
from aica_api.services import explanation_builder as eb


def test_category_readout_picks_dominant_situation():
    target = {"situation_fit": 0.30, "preference_fit": 0.05, "history_fit": -0.02}
    r = eb.category_readout(target)
    assert r["dominant"] == "situation"
    assert "situation" in r["phrase_en"].lower()
    assert r["phrase_ja"]  # non-empty JA phrase


def test_category_readout_picks_dominant_preference_by_magnitude():
    target = {"situation_fit": 0.04, "preference_fit": -0.20, "history_fit": 0.03}
    r = eb.category_readout(target)
    assert r["dominant"] == "preference"


def test_category_readout_none_when_no_subtotals():
    assert eb.category_readout({"item_id": "x"}) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=app/api python -m pytest app/api/tests/proposal/test_explanation_kernel.py -v`
Expected: FAIL with `AttributeError: module ... has no attribute 'category_readout'`.

- [ ] **Step 3: Implement `category_readout` in the kernel**

```python
_CATEGORY_PHRASES = {
    "situation": {"ja": "運転状況", "en": "the driving situation"},
    "preference": {"ja": "運転者の好み", "en": "the driver's taste"},
    "history": {"ja": "運転者の利用履歴", "en": "the driver's history"},
}


def category_readout(target: dict[str, Any]) -> dict[str, Any] | None:
    """Bilingual 'what dominated' readout from the §14 fit subtotals.

    Returns None when the target carries no numeric situation/preference/history
    subtotal (LLM-shaped plans, mock selector), so callers can skip the line.
    """
    subs = {
        cat: target.get(f"{cat}_fit")
        for cat in ("situation", "preference", "history")
    }
    nums = {c: float(v) for c, v in subs.items() if isinstance(v, (int, float))}
    if not nums:
        return None
    dominant = max(nums, key=lambda c: abs(nums[c]))
    ph = _CATEGORY_PHRASES[dominant]
    return {
        "situation": nums.get("situation", 0.0),
        "preference": nums.get("preference", 0.0),
        "history": nums.get("history", 0.0),
        "dominant": dominant,
        "phrase_ja": f"この選択は主に{ph['ja']}によって決まりました。",
        "phrase_en": f"This choice was driven mostly by {ph['en']}.",
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=app/api python -m pytest app/api/tests/proposal/test_explanation_kernel.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/aica_api/services/explanation_builder.py app/api/tests/proposal/test_explanation_kernel.py
git commit -m "feat(explain): shared category_readout helper from §14 fit subtotals"
```

---

### Task 3: Content causal bridge lines (demand ⇄ trait)

The core fix. For each situation feature carrying a demand, emit one line pairing what the situation *calls for* with the song's *actual* trait. Demand is read from the row's `alpha`/`beta` when present; otherwise from a static spec table keyed by `feature_id` (Context Response Matrix §5.2), so a run with null `alpha`/`beta` still renders.

**Files:**
- Modify: `app/api/aica_api/services/content_explanation.py`
- Test: `app/api/tests/proposal/test_content_explanation.py` (new)

**Interfaces:**
- Consumes: `_k.label_for`, `_song_facts_lines`.
- Produces:
  - `demand_phrase(alpha: float | None, beta: float | None, feature_id: str) -> dict[str,str] | None`
  - `causal_bridge_lines(target: dict) -> list[str]`
  - `build_prompt` now injects these lines + `_k.category_readout` into the user message and grounding under keys `"causal_bridge"` and `"category_readout"`.

- [ ] **Step 1: Write the failing tests**

```python
# app/api/tests/proposal/test_content_explanation.py
from aica_api.services import content_explanation as ce


def _drowsy_song_target():
    # drowsiness demands high arousal (alpha +0.80); this song IS high-arousal.
    return {
        "item_id": "song-1", "position": 1, "item_fit": 0.52,
        "trait_values": {"arousal": 0.80, "valence": 0.60, "humming_ease": 0.5,
                         "full_karaoke_ease": 0.4, "arousal_signed": 0.6, "valence_signed": 0.2},
        "situation_fit": 0.30, "preference_fit": 0.05, "history_fit": 0.01,
        "feature_contributions": [
            {"feature_id": "drowsiness_level", "e_i": 0.72, "a_i": 0.6, "alpha": 0.80,
             "beta": 0.20, "contribution": 0.18},
            {"feature_id": "oshi_id", "e_i": 1.0, "a_i": 1.0, "alpha": None,
             "beta": None, "exact_match": True, "contribution": 0.05},
        ],
        "rationale": ["眠気が寄与 / drowsiness supports"],
    }


def test_demand_phrase_drowsiness_is_energetic():
    p = ce.demand_phrase(0.80, 0.20, "drowsiness_level")
    assert "energetic" in p["en"].lower()


def test_demand_phrase_fatigue_is_soothing():
    p = ce.demand_phrase(-0.50, 0.50, "fatigue_level")
    assert "calm" in p["en"].lower() or "soothing" in p["en"].lower()


def test_causal_bridge_pairs_demand_with_actual_trait():
    lines = ce.causal_bridge_lines(_drowsy_song_target())
    joined = " ".join(lines).lower()
    # names the situation, what it calls for, and the song's actual energy
    assert "drowsiness" in joined
    assert "energetic" in joined
    assert "high" in joined  # song energy band
    # oshi_id has no alpha/beta → not a bridge line
    assert "oshi" not in joined


def test_causal_bridge_empty_when_no_traits():
    assert ce.causal_bridge_lines({"item_id": "x", "feature_contributions": []}) == []


def test_build_prompt_injects_bridge_and_readout():
    prompt = ce.build_prompt(_drowsy_song_target(), {"trigger_purpose": "drowsiness"})
    user = prompt.messages[1].content.lower()
    assert "energetic" in user and "driven mostly by" in user
    assert "causal_bridge" in prompt.grounding
    assert prompt.grounding["category_readout"]["dominant"] == "situation"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PYTHONPATH=app/api python -m pytest app/api/tests/proposal/test_content_explanation.py -v`
Expected: FAIL (`demand_phrase`/`causal_bridge_lines` undefined; grounding keys absent).

- [ ] **Step 3: Implement demand phrases + bridge lines**

```python
# Static Context Response Matrix demand (content algorithm §5.2), used when a
# contribution row does not carry alpha/beta. Values are the sign/intent only.
_STATIC_DEMAND = {
    "drowsiness_level": (0.80, 0.20), "drowsiness": (0.80, 0.20),
    "fatigue_level": (-0.50, 0.50), "fatigue": (-0.50, 0.50),
    "monotony_level": (0.90, 0.10), "monotony": (0.90, 0.10),
    "traffic_state": (-0.40, 0.60), "traffic": (-0.40, 0.60),
    "night_state": (-0.50, 0.50), "night": (-0.50, 0.50),
}


def demand_phrase(alpha, beta, feature_id):
    """Bilingual 'what this situation calls for' from arousal/valence demand.

    Returns None when there is no usable demand (both coefficients ~0 / absent
    and no static entry) — the feature is then not a causal bridge.
    """
    if alpha is None and beta is None:
        alpha, beta = _STATIC_DEMAND.get(feature_id, (None, None))
    if alpha is None and beta is None:
        return None
    a = float(alpha or 0.0)
    b = float(beta or 0.0)
    if abs(a) < 1e-6 and abs(b) < 1e-6:
        return None
    if a > 0:
        en, ja = "energetic, upbeat music", "活発で高揚感のある曲"
    elif a < 0:
        en, ja = "calm, soothing music", "穏やかで落ち着いた曲"
    else:
        en, ja = "brighter, more positive music", "より明るくポジティブな曲"
    if a != 0 and b > 0:
        en += " (and a bit brighter)"
        ja += "（やや明るめ）"
    return {"en": en, "ja": ja}


def _arousal_band(v):
    return "high" if v >= 0.62 else ("low" if v < 0.40 else "medium")


def causal_bridge_lines(target):
    """One line per situation feature that carries a demand, pairing the demand
    with the song's actual energy trait — the situation→trait causal arrow."""
    tv = target.get("trait_values") or {}
    arousal = tv.get("arousal")
    band = _arousal_band(float(arousal)) if isinstance(arousal, (int, float)) else None
    out = []
    for fc in target.get("feature_contributions", []) or []:
        fid = str(fc.get("feature_id", ""))
        dem = demand_phrase(fc.get("alpha"), fc.get("beta"), fid)
        if dem is None:
            continue
        lab = _k.label_for(fid)
        contribution = float(fc.get("contribution", 0.0) or 0.0)
        trait_txt = f"; this song's energy is {band.upper()}" if band else ""
        verdict = " (a strong match)" if contribution > 0 else (" (a mismatch)" if contribution < 0 else "")
        out.append(
            f"- {lab['ja']} / {lab['en']}: the situation calls for {dem['en']}"
            f"{trait_txt}{verdict} (contribution {contribution:+.3f})."
        )
    return out
```

- [ ] **Step 4: Wire the bridge + readout into `build_prompt`**

In `content_explanation.build_prompt`, after building `song_facts` and `factors`, add:

```python
    bridge = causal_bridge_lines(target)
    readout = _k.category_readout(target)
    grounding["causal_bridge"] = bridge
    grounding["category_readout"] = readout
    # ...in the user-message line assembly, right after the "About the chosen song"
    # block and before the factor list:
    if readout:
        lines.append("")
        lines.append(readout["phrase_en"])
    if bridge:
        lines.append("")
        lines.append("How the driving situation shapes the music choice:")
        lines.extend(bridge)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `PYTHONPATH=app/api python -m pytest app/api/tests/proposal/test_content_explanation.py -v`
Expected: PASS.

- [ ] **Step 6: Regression — the original suite still passes**

Run: `PYTHONPATH=app/api python -m pytest app/api/tests/proposal/test_explanation_builder.py -v`
Expected: PASS (grounding additions are additive; `MAX_FACTORS` cap test unaffected).

- [ ] **Step 7: Commit**

```bash
git add app/api/aica_api/services/content_explanation.py app/api/tests/proposal/test_content_explanation.py
git commit -m "feat(explain): content causal bridge lines pairing situation demand with song trait"
```

---

### Task 4: Content deterministic causal composer (`content_explanation.template`)

Rewrite the content template so the fallback carries the causal story: sentence 1 = situation→song answer, sentence 2 = preference/history modifier. Degrade to the legacy `<ja> / <en>` join when facts are absent.

**Files:**
- Modify: `app/api/aica_api/services/content_explanation.py`
- Test: `app/api/tests/proposal/test_content_explanation.py`

**Interfaces:**
- Consumes: `causal_bridge_lines`, `demand_phrase`, `_k.category_readout`, `_k.label_for`.
- Produces: `template(target) -> [ja, en]` (causal when facts present; legacy join otherwise; `["",""]` when nothing).

- [ ] **Step 1: Write the failing tests**

```python
def test_content_template_is_causal_when_facts_present():
    ja, en = ce.template(_drowsy_song_target())
    assert "energetic" in en.lower()
    assert ja and en
    assert " / " not in ja  # not the raw combined form


def test_content_template_degrades_to_legacy_join():
    target = {"item_id": "x", "rationale": [
        "眠気が寄与（+0.120） / drowsiness supports this (+0.120)"]}
    ja, en = ce.template(target)
    assert "drowsiness supports" in en
    assert " / " not in ja and " / " not in en


def test_content_template_empty_is_safe():
    assert ce.template({"item_id": "x"}) == ["", ""]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PYTHONPATH=app/api python -m pytest app/api/tests/proposal/test_content_explanation.py -k template -v`
Expected: FAIL (`test_content_template_is_causal_when_facts_present` fails — current template only joins rationale).

- [ ] **Step 3: Implement the causal composer with legacy fallback**

```python
def _legacy_join(target):
    """Former behavior: variable-length '<ja> / <en>' list → clean [ja, en]."""
    rationale = target.get("rationale") or []
    if not isinstance(rationale, list) or not rationale:
        return ["", ""]
    ja_parts, en_parts = [], []
    for entry in rationale:
        s = str(entry)
        if _k._CONTENT_LANG_SEP in s:
            left, right = s.split(_k._CONTENT_LANG_SEP, 1)
            ja_parts.append(left.strip()); en_parts.append(right.strip())
        else:
            ja_parts.append(s.strip()); en_parts.append(s.strip())
    return ["、".join(ja_parts), "; ".join(en_parts)]


def template(target):
    readout = _k.category_readout(target)
    tv = target.get("trait_values") or {}
    # Find the strongest situation feature that has a demand + a real trait to
    # anchor sentence 1; if none, fall back to the legacy join.
    best = None
    for fc in target.get("feature_contributions", []) or []:
        dem = demand_phrase(fc.get("alpha"), fc.get("beta"), str(fc.get("feature_id", "")))
        if dem is None:
            continue
        c = abs(float(fc.get("contribution", 0.0) or 0.0))
        if best is None or c > best[0]:
            best = (c, fc, dem)
    arousal = tv.get("arousal")
    if best is None or not isinstance(arousal, (int, float)):
        return _legacy_join(target)
    _, fc, dem = best
    lab = _k.label_for(str(fc.get("feature_id", "")))
    band = _arousal_band(float(arousal))
    band_ja = {"high": "活発", "medium": "中程度", "low": "落ち着いた"}[band]
    band_en = {"high": "energetic", "medium": "moderate", "low": "calm"}[band]
    ja = f"{lab['ja']}が高く、状況は{dem['ja']}を必要とします。この曲は{band_ja}で、それに合致します。"
    en = (f"{lab['en'].capitalize()} is high, so the situation calls for {dem['en']}; "
          f"this song is {band_en}, which matches.")
    # Sentence 2 — preference/history modifier from the dominant non-situation family.
    if readout:
        for fam in ("preference", "history"):
            val = readout.get(fam, 0.0)
            if abs(val) >= 0.02:
                fam_ja = {"preference": "好み", "history": "利用履歴"}[fam]
                fam_en = {"preference": "your taste", "history": "your history"}[fam]
                verb_ja = "も後押ししました" if val > 0 else "は反対に働きました"
                verb_en = "reinforced the choice" if val > 0 else "pushed against it"
                ja += f" さらに{fam_ja}{verb_ja}。"
                en += f" {fam_en.capitalize()} also {verb_en}."
                break
    return [ja, en]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `PYTHONPATH=app/api python -m pytest app/api/tests/proposal/test_content_explanation.py -v`
Expected: PASS.

- [ ] **Step 5: Regression**

Run: `PYTHONPATH=app/api python -m pytest app/api/tests/proposal/test_explanation_builder.py -v`
Expected: PASS. Note: `test_template_rationale_content_normalizes_combined_list_to_pair` uses a target with no `feature_contributions`/`trait_values`, so it hits `_legacy_join` — behavior identical.

- [ ] **Step 6: Commit**

```bash
git add app/api/aica_api/services/content_explanation.py app/api/tests/proposal/test_content_explanation.py
git commit -m "feat(explain): deterministic causal content template with legacy fallback"
```

---

### Task 5: Service grounding + deterministic causal composer

Service response is hand-authored per service (no arousal/valence), so the story is category-level. Add the category readout to grounding + user message, and make `service_explanation.template` compose a category-level causal line, degrading to the current positional passthrough.

**Files:**
- Modify: `app/api/aica_api/services/service_explanation.py`
- Test: `app/api/tests/proposal/test_service_explanation.py` (new)

**Interfaces:**
- Consumes: `_k.category_readout`, `_k.label_for`.
- Produces: `build_prompt` injects `grounding["category_readout"]` + a readout line; `template(target) -> [ja, en]` (causal when subtotals + strongest_support present; else current passthrough pair).

- [ ] **Step 1: Write the failing tests**

```python
# app/api/tests/proposal/test_service_explanation.py
from aica_api.services import service_explanation as se


def _service_target():
    return {
        "candidate_id": "rest_stop", "rank": 1, "score": 0.42,
        "situation_fit": 0.33, "preference_fit": 0.02, "history_fit": 0.08,
        "strongest_support": {"feature_id": "drowsiness_level", "contribution": 0.30},
        "strongest_oppose": {"feature_id": "traffic_state", "contribution": -0.05},
        "supporting_feature_ids": ["drowsiness_level"],
        "opposing_feature_ids": ["traffic_state"],
        "feature_contributions": [
            {"feature_id": "drowsiness_level", "feature_value": "high", "contribution": 0.30},
            {"feature_id": "traffic_state", "feature_value": "heavy", "contribution": -0.05},
        ],
        "rationale": ["眠気が支持（+0.3000）。", "drowsiness supports this pick (+0.3000)."],
    }


def test_service_build_prompt_injects_readout():
    prompt = se.build_prompt(_service_target(), {"trigger_purpose": "drowsiness"})
    user = prompt.messages[1].content.lower()
    assert "driven mostly by" in user
    assert prompt.grounding["category_readout"]["dominant"] == "situation"


def test_service_template_is_causal_when_facts_present():
    ja, en = se.template(_service_target())
    assert "rest_stop" in en
    assert "drowsiness" in en.lower()
    assert ja and en


def test_service_template_degrades_to_passthrough_pair():
    target = {"candidate_id": "rest_stop",
              "rationale": ["日本語の理由。", "English reason."]}
    assert se.template(target) == ["日本語の理由。", "English reason."]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PYTHONPATH=app/api python -m pytest app/api/tests/proposal/test_service_explanation.py -v`
Expected: FAIL (readout not in grounding; template still plain passthrough for the causal case).

- [ ] **Step 3: Inject the readout in `build_prompt`**

In `service_explanation.build_prompt`, after computing `grounding`:

```python
    readout = _k.category_readout(target)
    grounding["category_readout"] = readout
    # in the user-message assembly, right after the trigger_purpose/stage lines:
    if readout:
        lines.append("")
        lines.append(readout["phrase_en"])
```

- [ ] **Step 4: Implement the causal `template` with passthrough fallback**

```python
def _passthrough(target):
    """Former behavior: already-positional [ja, en] pair, pad/truncate to 2."""
    rationale = target.get("rationale") or []
    if not isinstance(rationale, list) or not rationale:
        return ["", ""]
    ja = str(rationale[0]) if len(rationale) >= 1 else ""
    en = str(rationale[1]) if len(rationale) >= 2 else ja
    return [ja, en]


def template(target):
    readout = _k.category_readout(target)
    ss = target.get("strongest_support")
    cid = str(target.get("candidate_id") or "")
    if not readout or not isinstance(ss, dict) or not ss.get("feature_id") or not cid:
        return _passthrough(target)
    dom = readout["dominant"]
    dom_ja = {"situation": "運転状況", "preference": "運転者の好み", "history": "利用履歴"}[dom]
    dom_en = {"situation": "the driving situation", "preference": "the driver's taste",
              "history": "the driver's history"}[dom]
    sup = _k.label_for(str(ss["feature_id"]))
    ja = f"主に{dom_ja}（特に{sup['ja']}）により、{cid}が選ばれました。"
    en = f"Mainly {dom_en}, chiefly {sup['en']}, drove selecting {cid}."
    so = target.get("strongest_oppose")
    if isinstance(so, dict) and so.get("feature_id"):
        opp = _k.label_for(str(so["feature_id"]))
        ja += f" 一方で{opp['ja']}は反対に働きました。"
        en += f" {opp['en'].capitalize()} pushed against it."
    return [ja, en]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `PYTHONPATH=app/api python -m pytest app/api/tests/proposal/test_service_explanation.py -v`
Expected: PASS.

- [ ] **Step 6: Regression**

Run: `PYTHONPATH=app/api python -m pytest app/api/tests/proposal/test_explanation_builder.py -v`
Expected: PASS. Note: `test_template_rationale_service_passthrough_pair` uses a target with no subtotals → hits `_passthrough` → identical output.

- [ ] **Step 7: Commit**

```bash
git add app/api/aica_api/services/service_explanation.py app/api/tests/proposal/test_service_explanation.py
git commit -m "feat(explain): service category readout grounding + causal template"
```

---

### Task 6: Prompt rewrite — algorithm primer, causal instruction, causal-shape example

Upgrade the shared system prompt so the model interprets scores causally, and change the placeholder example to demonstrate the causal *shape* (not real features, not a copyable sentence). The parrot-guard tests reference `eb._EXAMPLE_JA`/`_EXAMPLE_EN` by value, so they stay green automatically.

**Files:**
- Modify: `app/api/aica_api/services/explanation_builder.py`
- Test: `app/api/tests/proposal/test_explanation_builder.py` (extend), `app/api/tests/proposal/test_explanation_kernel.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: updated `_SYSTEM_TEMPLATE` (still `.format(kind=...)`-compatible), updated `_EXAMPLE_JA`/`_EXAMPLE_EN` (causal shape, placeholder features 要因A/要因B retained so `_PLACEHOLDER_RE` still strips them).

- [ ] **Step 1: Write the failing tests**

```python
# add to test_explanation_kernel.py
from aica_api.services import explanation_builder as eb


def test_system_prompt_has_algorithm_primer_and_causal_instruction():
    sys = eb._SYSTEM_TEMPLATE.format(kind="song").lower()
    assert "how much" in sys and "answers" in sys  # contribution = importance × answer
    assert "situation" in sys and "taste" in sys and "history" in sys  # three families
    assert "calls for" in sys  # causal structure cue


def test_example_lines_still_use_strippable_placeholders():
    # the causal-shape example must still be caught by the placeholder guard
    assert eb.strip_placeholder_artifacts(eb._EXAMPLE_EN) != eb._EXAMPLE_EN
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PYTHONPATH=app/api python -m pytest app/api/tests/proposal/test_explanation_kernel.py -v`
Expected: FAIL (`calls for`/`taste` not yet in the system prompt).

- [ ] **Step 3: Rewrite the example + system template**

```python
_EXAMPLE_JA = "「状況A」は「〜」を必要とし、この選択はそれに合致します。さらに「要因B」が後押ししました。"
_EXAMPLE_EN = "Situation A calls for a certain kind of choice, and this one matches it; factor B further reinforced it."

_SYSTEM_TEMPLATE = (
    "You write a short, faithful explanation of why an in-car assistant selected "
    "a {kind} for the driver — in BOTH Japanese and English.\n"
    "\n"
    "How the scoring works (use this to interpret, do NOT restate it):\n"
    "- A factor's influence = how much this trigger purpose cares about it, TIMES "
    "how well the chosen {kind} answers what the current situation calls for.\n"
    "- Factors group into three families: the driving SITUATION (drowsiness, "
    "fatigue, traffic, road, night, monotony), the driver's TASTE (favorite "
    "artist, genre, era, singability), and the driver's HISTORY (past plays, "
    "skips, acceptance, recovery).\n"
    "\n"
    "Rules:\n"
    "- Use ONLY the facts in the next message. Never invent features, numbers, "
    "songs, or driver preferences that are not listed.\n"
    "- Do NOT copy or repeat the fact lines, and do NOT restate the raw numeric "
    "scores.\n"
    "- Tell the CAUSAL story in this order when the facts support it: what the "
    "driving situation calls for -> how the chosen {kind} answers that -> how the "
    "driver's taste or history reinforced or tempered it.\n"
    "- Reply with EXACTLY two lines and NOTHING else: no preamble, no greeting, "
    "no notes, no markdown, no blank line between them.\n"
    "- Line 1 MUST start with 'JA:' and be written in Japanese. Line 2 MUST "
    "start with 'EN:' and be written in English. ALWAYS output both lines, each "
    "one or two natural sentences.\n"
    "\n"
    "Follow this exact shape (copy the format, NOT the wording):\n"
    "JA: " + _EXAMPLE_JA + "\n"
    "EN: " + _EXAMPLE_EN
)
```

- [ ] **Step 4: Run the new + existing suites**

Run: `PYTHONPATH=app/api python -m pytest app/api/tests/proposal/test_explanation_kernel.py app/api/tests/proposal/test_explanation_builder.py -v`
Expected: PASS. In particular `test_system_prompt_forbids_fabrication_and_sets_output_format` (asserts `only`, `ja:`/`en:` ×2, `japanese`/`english`, `exactly two lines`, `do not copy`) still holds against the new template, and the parrot-guard tests still reject `_EXAMPLE_JA`/`_EXAMPLE_EN` by value.

- [ ] **Step 5: Full regression across all three explanation test files + the caller import**

Run: `PYTHONPATH=app/api python -m pytest app/api/tests/proposal/test_explanation_builder.py app/api/tests/proposal/test_explanation_kernel.py app/api/tests/proposal/test_content_explanation.py app/api/tests/proposal/test_service_explanation.py -v`
Then: `PYTHONPATH=app/api python -m pytest app/api/tests/proposal/test_ep_explain.py -v` (endpoint test that exercises `build_explanation_prompt`/`template_rationale` through the router).
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/aica_api/services/explanation_builder.py app/api/tests/proposal/test_explanation_kernel.py
git commit -m "feat(explain): causal algorithm primer + causal-shape example in system prompt"
```

---

### Task 7: Verify `alpha`/`beta` on a real persisted run (guardrail check)

Confirms the design's stated risk is handled. If a real content run populates `alpha`/`beta`, the bridge uses them; if not, `demand_phrase`'s `_STATIC_DEMAND` fallback covers it — this task proves at least one of those paths fires on real data.

**Files:**
- Test: `app/api/tests/proposal/test_content_explanation.py` (extend)

- [ ] **Step 1: Inspect a persisted content decision for `alpha`/`beta` presence**

Run: `PYTHONPATH=app/api python -m pytest app/api/tests/proposal/test_p7_e2e_reference_journey.py -v` to confirm a full content run exists, then locate a persisted run JSON and check a content `feature_contributions` row:
Run: `python -c "import json,glob; f=sorted(glob.glob('runs/*.json'))[-1]; d=json.load(open(f,encoding='utf-8')); print([ (c.get('feature_id'), c.get('alpha')) for ev in d.get('events',[]) for it in (ev.get('output',{}) or {}).get('ordered_items',[]) for c in it.get('feature_contributions',[]) ][:8])"`
Expected: prints feature/alpha pairs. Record whether `alpha` is a number or `None` for `drowsiness_level`/`fatigue_level` rows.

- [ ] **Step 2: Add a regression test pinning the observed behavior**

If `alpha` is populated: assert the bridge uses the row value. If `None`: assert the static fallback fires. Write whichever matches the observation:

```python
def test_demand_uses_static_fallback_when_row_alpha_missing():
    # mirrors persisted runs where alpha/beta are not recorded on the row
    p = ce.demand_phrase(None, None, "drowsiness_level")
    assert p is not None and "energetic" in p["en"].lower()
```

- [ ] **Step 3: Run the test**

Run: `PYTHONPATH=app/api python -m pytest app/api/tests/proposal/test_content_explanation.py -k demand -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/api/tests/proposal/test_content_explanation.py
git commit -m "test(explain): pin alpha/beta availability behavior on real content runs"
```

---

## Self-Review

**Spec coverage:**
- Grounding enrichment (category readout both steps; content bridge) → Tasks 2, 3, 5. ✓
- Deterministic causal composer, both steps, with graceful degrade → Tasks 4, 5. ✓
- Prompt rewrite (primer + causal instruction + causal-shape example, keep guards) → Task 6. ✓
- Module split service/content + shared kernel, public API unchanged → Task 1. ✓
- Keep 2-line `[ja, en]` contract → enforced in every template/prompt task; regression via existing suite. ✓
- `alpha`/`beta` availability risk → Task 7 (+ `_STATIC_DEMAND` fallback baked into Task 3). ✓
- Testing coverage listed in spec → Tasks 2–7 each add tests; endpoint regression in Task 6 Step 5. ✓

**Placeholder scan:** Moved-verbatim bodies in Task 1 are the only non-inlined code; they are explicitly identified by current line ranges and are behavior-preserving moves gated by the unedited existing suite (Steps 1 & 5). All new code is shown in full.

**Type consistency:** `category_readout` returns the same dict shape consumed in Tasks 3/5 (`["dominant"]`, `["phrase_en"]`, `[fam]` floats). `demand_phrase(alpha, beta, feature_id)` signature matches its callers in `causal_bridge_lines` and `template`. `_arousal_band` defined in Task 3, reused in Task 4. Templates everywhere return a 2-element `[ja, en]` list. Dispatchers keep the `(step, target, context)` / `(step, target)` signatures the router calls.
