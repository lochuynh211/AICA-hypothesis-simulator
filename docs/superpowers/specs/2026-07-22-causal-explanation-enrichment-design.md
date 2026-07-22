# Causal Explanation Enrichment — Design

**Date:** 2026-07-22
**Area:** `app/api/aica_api/services/explanation_builder.py` (+ two new sibling modules)
**Status:** Approved for planning

## Problem

The LLM-generated "why" for a service or song proposal is **score-shaped, not
causal**. It reports *which* factor scored highest ("selected because of high
drowsiness") but never the *reasoning chain* the algorithm actually encodes:
that high drowsiness makes the situation **call for energetic music**, and the
chosen song is energetic, which is *why* it won.

The explanation does not cooperate the three things the algorithm actually
weighs together:

1. **the driving situation** (what the world calls for),
2. **the driver's preferences** (taste — oshi, genre, era, singability),
3. **the driver's history** (past plays, skips, acceptance, recovery).

Concretely, for the drowsiness case the user wants: *"because drowsiness is
high, the situation calls for energetic music, and this high-arousal song
answers that"* — not merely *"because drowsiness is high."*

## Key finding: the causal arrow is already in the evidence

No new algorithm output is required. Everything needed is already persisted:

- Both `RankedCandidate` (service) and `OrderedItem` (content) already carry
  the §14 roll-up subtotals **`situation_fit` / `preference_fit` /
  `history_fit`** and **`strongest_support` / `strongest_oppose`**. The current
  prompt builder ignores all of them.
- Content items carry **`trait_values`** (arousal, valence, singability) — the
  song's *actual* energy/mood.
- Each content **`ItemFeatureContribution`** carries **`alpha`** (arousal
  demand) and **`beta`** (valence demand) for the six driver/environment
  features. Per the Context Response Matrix (content algorithm §5.1–5.2), the
  demand is the situation→music bridge:

  | Feature | `α` (arousal) | reading |
  |---|---:|---|
  | Drowsiness | **+0.80** | energize |
  | Fatigue | **−0.50** | soothe |
  | Monotony | **+0.90** | stimulate against boredom |
  | Traffic (congested) | **−0.40** | de-stress |
  | Night | **−0.50** | calm |
  | Road (highway/mountain) | **+1.00 / −1.00** | match road load |

  A **positive contribution** from a situation feature therefore means *the
  song's trait answered what that situation demands* — the exact causal arrow
  the explanation is missing.

The scoring identity we surface to the model (content algorithm §3.1):

> `contribution = effective_weight × (evidence × response)` — i.e. **how much
> this purpose cares about the factor × how well the choice answers what the
> situation calls for.**

## Reliability constraint (drives the whole approach)

The explain path runs on **weak local models** (qwen2.5:3b, Gemini Nano) with a
deterministic template fallback. The module is already full of anti-parroting /
anti-echo guards because these models parrot the format example, echo the fact
lines, or drop a language. A richer prompt increases fallback frequency — so the
**deterministic fallback must itself carry the causal story** (today it just
joins the package's shallow rationale strings).

### Decisions taken during brainstorming

1. **Reliability target:** improve *both* the LLM prompt *and* the deterministic
   template, so the causal story survives a fallback.
2. **Feed algorithm context:** give the model the §3.1/§5.1 reading and the
   three-category framing so it *interprets* scores instead of parroting them.
3. **LLM role — author from rich facts:** code composes a deterministic causal
   line (the reliable fallback); the LLM receives the *same structured facts*
   (not the finished line — avoids the parrot guard) and authors a richer
   narrative. LLM output is preferred when `response_is_usable`; the template is
   the fallback.
4. **Separate service and content** into their own modules for maintainability.
5. **Keep the 2-line `JA:`/`EN:` output contract** — `parse_bilingual`,
   `response_is_usable`, and the frontend all depend on it.

## Module layout

Split the single `explanation_builder.py` (which branches on `is_service`
throughout) into a shared kernel plus one module per step. The public functions
`build_explanation_prompt(step, target, context)` and
`template_rationale(step, target)` remain in `explanation_builder.py` as thin
**dispatchers**, so the caller in `routers/proposal.py` is untouched.

```
services/
  explanation_builder.py   # shared kernel + dispatchers (public API unchanged)
  service_explanation.py   # NEW — service grounding, composer, prompt text
  content_explanation.py   # NEW — content grounding, composer, prompt text
```

### `explanation_builder.py` (shared kernel + dispatch)

Retains everything step-agnostic:

- `FEATURE_LABELS`, `label_for`, `_FEATURE_MEANINGS`, `feature_meaning`
  (the union map — shared, both namespaces).
- Output parsing/guards: `parse_bilingual`, `response_is_usable`,
  `strip_placeholder_artifacts`, `_PLACEHOLDER_RE`.
- Format anchoring shared by both prompts: `_EXAMPLE_JA` / `_EXAMPLE_EN`
  (upgraded to a *causal-shape* placeholder example), `_FORMAT_REMINDER`,
  and the shared system-prompt rules.
- `_factors_from_target` (works on both contribution shapes).
- `category_readout(target)` — **new shared helper**: reads
  `situation_fit` / `preference_fit` / `history_fit`, returns the signed trio
  plus which family dominated, with a bilingual "driven mostly by …" phrase.
- `prompt_hash`.
- Dispatchers:
  - `build_explanation_prompt(step, target, context)` →
    `service_explanation.build_prompt` | `content_explanation.build_prompt`.
  - `template_rationale(step, target)` →
    `service_explanation.template` | `content_explanation.template`.

### `service_explanation.py`

- `build_prompt(target, context, kernel)` — assembles the service
  system+user `ExplanationPrompt` using shared kernel pieces + the category
  readout + factors + supporting/opposing.
- `template(target)` — deterministic causal composer (below).
- Service causal-structure prompt fragment. Service response is **hand-authored
  per (feature, service)** (no arousal/valence), so the service story is
  category-level: *"the driving situation — chiefly {strongest support} — most
  drove selecting {service}; {preference/history factor} reinforced/tempered
  it."*

### `content_explanation.py`

- `build_prompt(target, context, kernel)` — service's content counterpart,
  adding the song facts and the causal bridge lines.
- `template(target)` — deterministic causal composer (below).
- `_song_facts_lines` (moved from the current module).
- **Causal bridge lines** — for each contribution row whose `alpha`/`beta` is
  non-null, one line pairing demand with the song's actual trait:
  `- Drowsiness [72]: situation calls for energetic music; this song's energy is HIGH → matches (contribution +0.180).`
- **Bilingual phrase tables** (content-local): demand phrases
  (`α>0`→energetic/upbeat, `α<0`→calm/soothing, `β>0`→brighter/positive) and
  trait bands (reuse the thresholds already in `_song_facts_lines`).

## Grounding enrichment (facts fed to the prompt)

All additions are **read from evidence** — nothing invented.

**Both steps** — category readout: the three signed subtotals plus a derived
*"This choice was driven mostly by {the driving situation | the driver's taste |
the driver's history}."*

**Content only** — the causal bridge lines described above. This adjacency of
*demand* and *actual trait* is the fact today's prompt never provides.

**Service only** — category readout + `strongest_support`/`strongest_oppose` +
the existing factor list, framed at the category level.

## Deterministic causal composer (replaces the string-join in `template_rationale`)

Each module's `template(target)` builds a **2-sentence bilingual causal line**
from the structured facts:

- **Sentence 1 (situation → answer).**
  - *Content:* "{Situation feature} was high — the situation calls for
    {demand}; \"{song}\" is {trait}, matching that."
  - *Service:* "The {dominant category}, chiefly {strongest-support label}, most
    drove selecting {service}."
- **Sentence 2 (preference/history modifier).** "{Non-dominant-family factor}
  {reinforced | pushed against} the choice."

Rendered in JA + EN via `FEATURE_LABELS` + the content phrase tables. **Degrades
cleanly** to today's behavior when facts are absent (LLM-shaped plans, mock
selector, missing subtotals, null `alpha`/`beta`) → falls back to the current
package-rationale join, then `["", ""]`. Nothing regresses.

## Prompt rewrite

- **System prompt (shared base + per-step insert):** add a compact algorithm
  primer — *"A factor's contribution = how much this purpose cares about it ×
  how well the choice answers what the situation calls for. Factors group into
  three families: the driving situation, the driver's taste, the driver's
  history."* — and replace the flat "explain which factors drove it" instruction
  with the **causal structure**: situation → what it calls for → how the choice
  answers → reinforced/tempered by taste & history.
- **User message:** insert the category readout + (content) causal bridge lines
  into the existing factor block.
- **Format anchoring:** keep the 2-line contract and the **placeholder** example
  discipline (real-feature examples leaked; verbatim sentences got parroted),
  but upgrade the placeholder example to show the *causal shape*
  (「状況A（〜を必要とする）」に対しこの曲は〜で合致し、さらに「好みB」が後押ししたため選ばれました。).
  The finished deterministic sentence is **not** placed in the prompt — the
  model gets facts, not a line to copy — keeping `response_is_usable` intact.

## Testing

Extend `app/api/tests/proposal/test_explanation_builder.py` (and add per-module
test files mirroring the split):

- Causal bridge line appears for a drowsiness fixture with a high-arousal song.
- Demand phrase flips sign correctly (drowsiness `α+` "energetic" vs. fatigue
  `α−` "soothing").
- `category_readout` picks the right dominant family from the subtotals.
- `service_explanation.template` / `content_explanation.template` render
  faithful JA + EN, and degrade to the legacy join / `["", ""]` when facts are
  missing.
- `prompt_hash` stays deterministic (same inputs → same prompt).
- The parrot/echo guard still fires on the upgraded placeholder example.
- Dispatchers route `step` correctly and the public API is unchanged.

## Implementation risk to verify first

The `ItemFeatureContribution` model permits `alpha`/`beta` to be `None`. Before
relying on them, **verify a real persisted content run actually populates
`alpha`/`beta`** on the six driver/environment rows. If a run leaves them null,
the bridge falls back to deriving the demand from the feature id + trigger
purpose (a static, spec-sourced table), so the causal line still renders.

## Out of scope

- No change to algorithm packages or their output contracts.
- No change to the output format (`[ja, en]`) or the provider/fallback plumbing
  in `routers/proposal.py`.
- No new model / provider; weak-local-model + template fallback stays.
