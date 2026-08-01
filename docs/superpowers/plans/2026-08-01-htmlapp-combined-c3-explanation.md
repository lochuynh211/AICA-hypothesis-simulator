# HTMLApp Combined Export — C3: Explanation Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the explanation layer — the bilingual rationale sentences the Combined screen shows for every trigger, service and content decision — and drop the Ollama provider the offline build cannot have.

**Architecture:** New `src/engine/explanation/` modules mirroring `app/api/aica_api/services/`. `explanation_builder` is the façade (`build_explanation_prompt`, `template_rationale`, plus the LLM-response helpers); `trigger_explanation`, `service_explanation` and `content_explanation` each supply `build_prompt` and `template` for their step.

**Tech Stack:** TypeScript 5.8, Vitest 1.6, Python 3.12 for capture. No new dependencies.

## Global Constraints

- **No new runtime or dev dependencies.**
- **The Python is the behaviour of record.** Never edit `packages/`, `app/api/`, or `app/frontend/`. If port and Python disagree, the port is wrong; if you believe the Python is wrong, stop and report.
- **Never edit a golden** to make a port pass.
- No changes under `src/components/**`.
- Reuse, do not rewrite: `src/data/packages/builtin/mathUtils.ts` (`neumaierSum`, `pyFixed`).
- Capture rig: `PYTHONPATH=app/api app/api/.venv/bin/python htmlapp/frontend/scripts/gen/capture_all.py` from the repo root; deterministic, a re-run leaves `git status` clean.
- `grep -rn "PINNED-TO-C1" htmlapp/frontend/tests` must keep returning nothing.
- Run npm commands from `htmlapp/frontend/`. Verify with `npm test` and `npm run typecheck`.
- **Report the single-file build size in every task.** `build:singlefile` is the customer deliverable against a hard 3 MB cap (owner decision); it was 1.42 MB entering C3.

## This slice's dominant risk: strings, not numbers

Every other slice ported logic that produces numbers. This one produces **bilingual prose containing formatted numbers**, and the conformance tests compare those strings **character-exactly** — including Japanese punctuation (`、`, `。`, `（）`, the wave dash `〜`) and every `:.Nf` format spec.

That inverts the usual hazard ranking:

- **Hazard 7 (`toFixed` is not `:.Nf`) is the primary risk.** `trigger_explanation` alone has `_fmt_num`, `_score_display`, `_signed_score_display`, `_fmt_multiplier` and `_row_value_display`; `explanation_builder` has `_value_display`. **Every one is a format-spec site.** Use `pyFixed` at each, and only where Python uses a spec. Grep both sides and reconcile the counts.
- **Hazard 5 (float→string)** applies wherever a bare `str(float)` or f-string interpolation of a float appears — that is Python's `repr` semantics, which is *not* `pyFixed`. C1's service-selector port needed a separate `pyFloatRepr` helper for exactly this; check whether it exists before writing another, and do not conflate the two.
- **Hazards 1–4 and 6** still apply but are secondary here. Report them honestly rather than skipping the check.

## Branch coverage — mandatory, and unusually large here

These modules select *which sentence to emit* through dense conditionals: `_axis_choice`, `_axis_bridge`, `_axis_satisfaction`, `_dominant_family_sentence1` vs `_situation_led_sentence1`, `_dead_band_reason_applies`, `_score_strength`'s bands, `_lvl3`. Each branch is a different user-visible sentence.

C1 found four cases where a port passed its golden and still diverged because no fixture reached the other branch. Here the branch count is far higher and the consequence is directly visible to the reviewer using the tool.

**Every task's report must contain a per-branch coverage table** naming, for each conditional that selects or shapes a sentence, whether a golden case reaches it. Where a branch is reachable by varying an input, **add a case**. Where a case reaches a branch but produces a string identical to a neighbour, say so explicitly. Cover error/empty paths with direct assertions in a validation test file, labelled TS-logic rather than parity.

---

### Task 1: `explanation_builder` core

The shared vocabulary and sentence machinery every step depends on. Port this first — the three step modules build on it.

**Files:**
- Create: `src/engine/explanation/builder.ts`
- Modify: `scripts/gen/capture_all.py`
- Test: `tests/explanation_builder_port.test.ts`
- Reference (read, never edit): `services/explanation_builder.py` (905 LOC)

**Interfaces produced:** `labelFor`, `featureMeaning`, `featureFamily`, `situationSentence`, `triggerSentence`, `preferenceSentence`, `historySentences`, `scoreEvidence`, and the internal display/factor helpers the step modules need.

- [ ] **Step 1** — enumerate the contract and the full list of exported and internal functions; report before coding. Note which are pure vocabulary tables (`label_for`, `feature_meaning`) and which are conditional sentence builders — the tables are mechanical, the builders are where the branch coverage work is.
- [ ] **Step 2** — add captures driven from committed data; each case named for the sentence branch it targets.
- [ ] **Step 3** — failing conformance test comparing strings exactly; confirm it fails because the module does not exist.
- [ ] **Step 4** — port, mirroring decomposition.
- [ ] **Step 5** — hazard pass with **explicit reconciliation of format-spec counts** between the Python and the TS.
- [ ] **Step 6** — branch-coverage table; add cases for reachable gaps.
- [ ] **Step 7** — verify, report single-file size, commit.

---

### Task 2: `trigger_explanation`

**Files:**
- Create: `src/engine/explanation/trigger.ts`
- Modify: `scripts/gen/capture_all.py`
- Test: `tests/explanation_trigger_port.test.ts`
- Reference: `services/trigger_explanation.py` (593 LOC) — `resolve_category`, `build_target`, `template`, and the display helpers

- [ ] **Step 1** — enumerate; report before coding.
- [ ] **Step 2** — capture. Trigger targets come from a fire's `feature_contributions`/`criteria`; drive them from real captured trigger runs rather than synthesising shapes, so the fixture exercises what the app will really pass.
- [ ] **Step 3** — failing test, then port.
- [ ] **Step 4** — hazard pass. `_score_display` / `_signed_score_display` / `_fmt_multiplier` / `_row_value_display` are all format-spec sites; `_fmt_num` may have `repr` semantics — check which, and use the right helper.
- [ ] **Step 5** — branch coverage: `resolve_category` with and without an explicit category; `_dead_band_reason_applies` both ways; `_unit_kind_for` across its unit kinds; `_row_phrase`'s variants.
- [ ] **Step 6** — verify, size, commit.

---

### Task 3: `service_explanation` and `content_explanation`

Ported together — both are step modules with the same `build_prompt` / `template` shape, and both consume Task 1's builder.

**Files:**
- Create: `src/engine/explanation/service.ts`, `src/engine/explanation/content.ts`
- Modify: `scripts/gen/capture_all.py`
- Test: `tests/explanation_service_port.test.ts`, `tests/explanation_content_port.test.ts`
- Reference: `services/service_explanation.py` (186 LOC), `services/content_explanation.py` (521 LOC)

- [ ] **Step 1** — enumerate both; report before coding.
- [ ] **Step 2** — capture, driven from the selector goldens C1 already committed where possible, so the explanation fixtures line up with real selector output.
- [ ] **Step 3** — failing tests, then port.
- [ ] **Step 4** — hazard pass.
- [ ] **Step 5** — **branch coverage is heaviest here.** `content_explanation`'s causal-bridge machinery (`_axis_satisfaction`, `_axis_trait_words`, `_axis_choice`, `_axis_bridge`, `_arousal_band`, `demand_phrase`, `_effective_alpha_beta`) and its two competing opening sentences (`_dominant_family_sentence1` vs `_situation_led_sentence1`) are a large conditional matrix. Enumerate it and prove coverage case by case; add cases for reachable gaps. Also cover `_legacy_join` — confirm whether it is still reachable at all, and say so.
- [ ] **Step 6** — verify, size, commit.

---

### Task 4: The façade and the LLM-response helpers

**Files:**
- Modify: `src/engine/explanation/builder.ts` (add the façade functions)
- Create: `src/engine/worker/handlers/explanation.ts` if the ops need one — check whether C4's merged handlers will own them instead, and say which you chose
- Test: `tests/explanation_facade.test.ts`
- Reference: `services/explanation_builder.py` — `build_explanation_prompt`, `template_rationale`, `parse_bilingual`, `response_is_usable`, `strip_placeholder_artifacts`

- [ ] **Step 1** — enumerate. `build_explanation_prompt(step, target, context)` and `template_rationale(step, target)` dispatch by step to the three modules from Tasks 2–3.
- [ ] **Step 2 — drop the Ollama provider.** Python supports `backend` (Ollama), `browser` (Chrome Gemini Nano) and `off` (deterministic template). The offline build has no server, so **`backend` is not ported**. `off` and `browser` both remain. Mirror Python's behaviour for the two that survive exactly; for `backend`, decide and document what an htmlapp caller receives if it asks for it — a clear structured error is better than silently falling back, because a silent fallback would misreport which provider produced a rationale.
- [ ] **Step 3** — `parse_bilingual`, `response_is_usable` and `strip_placeholder_artifacts` guard against a model returning blanks, echoes or placeholder artifacts. These are **pure string functions and are highly testable** — port them with direct unit assertions covering each rejection reason, not only a golden.
- [ ] **Step 4** — failing tests, port, verify.
- [ ] **Step 5** — branch coverage across the three step dispatches and every rejection reason in `response_is_usable`.
- [ ] **Step 6** — verify, size, commit.

---

### Task 5: C3 acceptance

- [ ] **Step 1** — clean-state: `rm -rf data public/aica-data.js dist`, then `npm run build:data && npm test && npm run typecheck && npm run build && npm run build:singlefile`. Expect 0 failing, 0 skipped; both builds exit 0. **Report single-file size against the 3 MB cap.**
- [ ] **Step 2** — capture reproducibility: re-run the rig, `git status` clean.
- [ ] **Step 3** — port boundary: `git diff --stat $(git merge-base develop HEAD)..HEAD -- app/ packages/` empty.
- [ ] **Step 4** — **independent spot-check:** pick one explanation module, re-run its Python directly against one golden input, and compare the emitted strings byte-for-byte. Strings are this slice's product; verify the capture is honest, not just that the TS matches it.
- [ ] **Step 5** — confirm no `backend`/Ollama code path shipped: grep the built output for any HTTP call to a local model server.
- [ ] **Step 6** — tick the checkboxes and commit, only if every check passed.

---

## Self-Review

**Spec coverage.** Against the ADR's C3 row — `engine/explanation/*` with `provider:'backend'` removed: builder core (T1), trigger (T2), service and content (T3), façade plus LLM-response helpers with Ollama dropped (T4), acceptance (T5). Covered.

**Why the hazard ranking is restated per-slice.** C1's hazard list was written for numeric ports. This slice's output is prose, so hazard 7 moves from a footnote to the primary risk and hazard 5 splits into two distinct helpers (`pyFixed` for format specs, `pyFloatRepr` for bare interpolation). Stating that once at the top is cheaper than each task rediscovering it.

**Why branch coverage gets extra weight here.** Elsewhere an unexercised branch produces a wrong number. Here it produces a *different sentence shown to the reviewer* — the tool's whole purpose is explaining decisions, so a wrong explanation is a product defect even when every score is right.

**Type consistency.** `build_prompt` → `buildPrompt`, `template` → `template`, `build_explanation_prompt` → `buildExplanationPrompt`, `template_rationale` → `templateRationale`, `parse_bilingual` → `parseBilingual`, `response_is_usable` → `responseIsUsable`, `strip_placeholder_artifacts` → `stripPlaceholderArtifacts`. Step modules export the same two names each; the façade dispatches by step string exactly as Python does.
