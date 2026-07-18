# Feature 019 — LLM-generated rationale: implementation & benchmark report

**Status:** merged to `develop` (fast-forward, `73dd290`), 2026-07-18.
**Scope:** an optional LLM narration layer for the Service & Content proposal panels, with
two interchangeable local providers (server-side Ollama, in-browser Gemini Nano), plus a
full benchmark of both across the 32 designed presets.

---

## 1. Executive summary

The proposal panels show, per candidate/item, a one-line natural-language "reason". It used
to be a deterministic template. Feature 019 adds an **optional LLM** that regenerates *only
that sentence*, grounded strictly in the already-computed decision trace. It **never** changes
a score, ranking, or feature contribution — the numeric trace and supporting/opposing chips are
untouched (Constitution I / II / V).

Two providers behind a per-run flag on the setup panel:

| flag value | engine | persistence |
|---|---|---|
| `off` (default) | deterministic template (unchanged) | n/a |
| `backend` | local **Ollama** (`qwen2.5:3b` default), server-side | append-only `Explanation` in the run log |
| `browser` | Chrome **Gemini Nano** (on-device Prompt API) | display-only (not reproducible → not persisted) |

Both providers run the **same server-built prompt**, so the two engines are compared
apples-to-apples. No new Python dependency (stdlib `urllib`); no new JS dependency (Chrome's
Prompt API is built in).

**Headline benchmark result (32 presets):** after "Maximal grounding", both models reach
**100% top-factor citation with 0 hallucinations**. `qwen2.5:3b` produces real model prose on
~82% of steps (rest honest template fallback); **Gemini Nano produced usable output on 100% of
steps (0 fallbacks)** and was often *richer* (named song titles, cited negatives).

---

## 2. Architecture — how the LLM is wired in

The LLM is a **narration layer over an already-made deterministic decision**. It receives the
decision trace and rewrites the sentence; it can never influence the decision.

```
Deterministic selectors  ──►  ranked candidates / ordered items  (+ per-feature contributions)
        (unchanged)                        │
                                           ▼
                       explanation_builder.build_explanation_prompt()   ← ONE prompt, both providers
                                           │
              ┌────────────────────────────┴─────────────────────────────┐
   provider=backend                                               provider=browser
   Ollama /api/chat (urllib, temp 0)                     returns prompt only → Chrome Gemini Nano
   parse → usable-guard → strip → persist                parse → usable-guard → strip → display
        │                                                          │
        ▼                                                          ▼
   ReasonBreakdown italic line  ← "AI · <model>" badge; falls back to the template on any failure
```

### 2.1 Backend (`app/api/aica_api/`)

| file | role |
|---|---|
| `config.py` | `OLLAMA_BASE_URL` / `OLLAMA_MODEL` / `OLLAMA_TIMEOUT_SEC` (plain `os.environ`, no new dep) |
| `services/ollama_client.py` | stdlib-`urllib` POST to Ollama `/api/chat` (temp 0); injectable `_urlopen` seam + PYTEST live-net guard; typed `OllamaError` |
| `services/explanation_builder.py` | **the grounding engine** — feature labels + meanings, `build_explanation_prompt`, `parse_bilingual`, `response_is_usable`, `strip_placeholder_artifacts`, `template_rationale` (all pure/testable) |
| `models/proposal/explanation.py` | `Explanation` (append-only record), `ExplanationPrompt`, `ExplainMessage` |
| `models/proposal/proposal_run.py` | `explanations: list[Explanation]` (additive; old logs still load) |
| `services/proposal_run_manager.py` | `append_explanation()` (mirrors `append_evidence`, atomic re-persist) |
| `routers/proposal.py` | `POST .../explain` (per provider) + `POST .../nano-test/results` (eval sink) |

### 2.2 Frontend (`app/frontend/src/`)

| file | role |
|---|---|
| `state/proposalStore.ts` | `explanationProvider` flag (`off`/`backend`/`browser`) |
| `components/proposal/panels/WorldPanel.tsx` | the 3-way "Explanation source" selector |
| `api/proposalClient.ts` | `explain(runId, {step, targetId, provider})` |
| `lib/nano.ts` | Chrome Prompt API wrapper (`LanguageModel`/`window.ai`, dual API generations) |
| `components/proposal/useExplanation.ts` | on-demand + cached hook; browser branch parses Nano output with the **same** parse/usable/strip helpers as the backend |
| `components/proposal/ReasonBreakdown.tsx` | renders the AI sentence + "AI · model" badge; falls back to the template on error |

### 2.3 Infra

`docker-compose.yml` adds an **opt-in** `ollama` service under a `llm` profile
(`docker compose --profile llm up`), reachable at `http://ollama:11434`, with `ollama` in the
api service's `no_proxy` so the local call bypasses the corporate proxy.

### 2.4 The grounding prompt ("Maximal")

The prompt is where accuracy is won. The final prompt feeds the model:

- the decision (chosen id, rank/position, `fit` score, purpose, driving stage);
- **all** meaningfully-scored factors (not a top-N slice), each as
  `label_ja / label_en [raw value]: signed contribution — plain-English meaning`;
- a **"how to read"** block: the formula (`fit = clamp(Σ weight·response)`), that `+`/`−` =
  pushed toward/against, and explicitly that *a top contribution ≠ a high raw value*;
- for content: **semantic song facts** (energy/arousal, mood/valence, sing-along ease,
  is-oshi, and the song title via a catalog lookup);
- a strict two-line `JA:` / `EN:` output format, anchored by a **placeholder** example.

### 2.5 Honesty guards ("failures never disguised")

- `response_is_usable()` rejects empty output, verbatim-example parroting, and output that
  merely echoes the fact lines → the provider **falls back to the deterministic template**
  (labeled), never showing degenerate text as a real explanation. Ported to the browser/Nano
  path too, so the live app and the backend behave identically.
- `strip_placeholder_artifacts()` removes any leftover `(factor A)` / 「要因A」 tokens.
- `parse_bilingual()` is defensive (regex-first: handles `JA: … EN: …` inline *and*
  multi-line, then prefix lines, then plain lines).

---

## 3. Benchmark

### 3.1 Methodology

For each of the 32 committed presets (`proposal_contracts/presets/`), the harness runs the
**real pipeline** (create run → select service → `explain(provider=…)`), feeds the resulting
server-built prompt to the model, parses + strips the output, and grades it against:

1. **the actual top factors** the deterministic scorer produced (an automated keyword check:
   does the reason name the top-1/top-2 factor?), and
2. **the preset's documented `expectation.hypothesis`** (manual review for hallucination /
   wrong-signed claims / thematic misses).

Each preset yields up to two graded reasons (service + content) → **62 reasons per model**.

### 3.2 Models & environment

| model | where | size / notes | latency (CPU/on-device) |
|---|---|---|---|
| `qwen2.5:3b` | server-side Ollama v0.32.1, run on the Ubuntu dev box (CPU) | ~1.9 GB Q4 | ~15–30 s / reason |
| Gemini **Nano** | Chrome 150 on-device, real Windows PC (via `nano-test.html`) | Chrome built-in | ~20–38 s / reason |

Both were driven through the **identical** server-built prompt (`explain(provider=browser)`
returns the same prompt the backend runs through Ollama), so differences are model-only.
`qwen2.5:0.5b` was also tested during development — it motivated the usable/echo guards — but
is not a recommended production model and is excluded from the headline benchmark.

### 3.3 Results — `qwen2.5:3b` (server)

| step | reasons | real model prose | honest template fallback | cites top factor | hallucinations |
|---|---|---|---|---|---|
| service | 31 | 26 (84%) | 5 | **31/31** | **0** |
| content | 31 | 25 (81%) | 6 | **31/31** | **0** |

- Every reason correctly names the driving factor; across the 6-stage journeys the content
  reason tracks the shifting driver (oshi match when fresh → recovery rate when drowsy →
  singability when oshi is off).
- The ~18% template fallbacks are the guard correctly catching echo/parrot output.
- Before Maximal grounding, content reasons were poor (~2/8 acceptable: garbled labels like
  「オシアイド」, hallucinations like "calm truck sounds", wrong top-factor). Maximal grounding
  removed all of that.

### 3.4 Results — Gemini **Nano** (Chrome on-device, real Windows run)

Meta: `nano_availability = "available"`, Chrome 150, 32 presets.

| step | reasons | usable model prose | fallbacks | cites top factor | hallucinations |
|---|---|---|---|---|---|
| service | 31 | **31 (100%)** | **0** | **31/31** | **0** |
| content | 31 | **31 (100%)** | **0** | **31/31** | **0** |

- **Zero errors, zero fallbacks** — fewer than 3b.
- Frequently *richer* than 3b: named song titles the backend supplied (「Lemon」, 「さよならエレジー」,
  「崖の上のポニョ」, "READY STEADY GO"), and correctly cited negatives ("car motion pushed
  against", "genre play frequency offered minor opposition").
- The parity fix landed: the genz preset's content reason used the corrected `oshi_id`
  contribution (+0.072, override-applied) rather than the buggy +0.096.

### 3.5 Head-to-head

| dimension | `qwen2.5:3b` (server) | Gemini Nano (browser) |
|---|---|---|
| errors / 62 | 0 (1 preset had no service decision — see issues) | 0 |
| usable model prose | ~82% (rest = honest template) | **100%** |
| top-factor citation | 100% | 100% |
| hallucinations | 0 | 0 |
| bilingual compliance | high | high, but ~3% wrote the JA line in English |
| richness | good | often richer (song titles, secondary factors) |
| persistence | yes (append-only evidence) | no (display-only) |
| cost / dependency | +Ollama service, ~1.9 GB, CPU | none (built into Chrome) |

**Takeaway:** on these 32 presets, on-device Gemini Nano is a viable provider that **rivals or
exceeds** `qwen2.5:3b` on faithfulness and richness, at zero server cost — but its output is
display-only (not reproducible/persisted), whereas the backend path is auditable evidence.

### 3.6 The prompt-engineering journey (key lesson)

Getting to 100% took three iterations on the *format example*, worth recording:

1. **Concrete example** ("heavy traffic, nearby destination") → the model **reused** "traffic/
   destination" as fake content in unrelated reasons (leakage of real-feature words).
2. **Abstract generic example** → the model **copied it verbatim** (especially the JA line),
   tripping the usable-guard and discarding otherwise-good output.
3. **Placeholder example** (「要因A」「要因B」 / "factor A and factor B") → the model **substitutes
   the real factors** into the structure in both languages. This is the shipped version.

Lesson: few-shot examples must use *placeholders*, never real-domain content.

---

## 4. Open issues

| # | issue | severity | status |
|---|---|---|---|
| 1 | **`journey-e-3-rest-stop-stretch` service decision errors** (`candidate_outside_allowed_set`: the service-selector algorithm returns `oshi_reexperience`, which is excluded + not in the matrix's allowed set at the rest/stopped/oshi-off stage). | medium | **not a 019 issue** — a pre-existing 018 service-algorithm/matrix bug surfaced by the benchmark. Documented in `specs/018-proposal-preset-testcases/FINDING-e3-service-candidate-outside-allowed-set.md`. The explanation layer correctly had nothing to explain. |
| 2 | **Nano occasionally writes the JA line in English** (~2/62 reasons: `journey-c-4`, `journey-e-1`). Both fields end up the same English sentence. | low | model-compliance limitation; not parser-recoverable. A stronger JA nudge in the prompt could help. |
| 3 | **Nano emitted `JA: … EN: …` on one line** (8/62), which the original parser didn't split → duplicated fields. | low | **fixed** — `parse_bilingual` is now regex-first (inline + multi-line); recovers 6 of the 8 (the other 2 are issue #2). |
| 4 | **Minor-factor emphasis.** With Maximal grounding (all factors), the model sometimes highlights a real-but-secondary factor (e.g. "child in the car" — `child_present` *is* a real scored factor) alongside the top one. | low | grounded, not a hallucination; the trade-off of feeding all factors vs top-N. |
| 5 | **Placeholder artifact leak** ("(factor A)") appeared once (1/62) in raw output. | low | **guarded** — `strip_placeholder_artifacts()` removes it; a pure-placeholder output falls back to the template. |
| 6 | **Browser/Nano output is display-only** (not persisted, not reproducible). | by design | accepted trade-off; the `backend` provider is the auditable path. |
| 7 | **3b benchmark ran on the dev box** (39 GB RAM), not the 8 GB CPU target. Latency/quality on 8 GB may differ (use `qwen2.5:1.5b` if 3b is too slow). | info | `OLLAMA_MODEL` is configurable. |

---

## 5. How to run / reproduce

### Backend model (Ollama)
```bash
docker compose --profile llm up                                   # api + frontend + ollama
docker compose --profile llm exec ollama ollama pull qwen2.5:3b   # one-time (~1.9 GB)
```
Then set **Explanation source → Backend model** on the setup panel and expand a reason.

### Browser Gemini Nano
Open the app (or the harness) at a **`http://localhost`** URL (secure context) in desktop
Chrome with the on-device model enabled, then set **Explanation source → Browser (Gemini Nano)**.

### Full benchmark harness
Open **`http://localhost:5180/nano-test.html`** in Windows Chrome → **Run all presets**. It
drives the real flow for every preset through Nano and POSTs results to
`POST /api/proposal/nano-test/results` → `proposal_runs/nano-test/results.json` (git-ignored)
for review. The equivalent server-side (Ollama) benchmark is a straightforward pipeline script.

---

## 6. Verification & test coverage

- **Backend: 2274 tests pass.** Unit tests for the Ollama client (mocked transport + live-net
  guard), the prompt builder (grounding facts, `parse_bilingual` inc. inline split,
  `response_is_usable` echo/parrot, `strip_placeholder_artifacts`, `template_rationale`), the
  `/explain` endpoint (browser build-only, backend generate+persist, honest fallback, 404/422),
  `append_explanation` persistence + backward-compat, and the nano-test sink.
- **Frontend: 616 tests pass.** Store flag, `explain` client, `useExplanation` (off/backend/
  browser/error/cache/provider-switch), `responseIsUsable` guard, `parseBilingual` inline split,
  `stripPlaceholders`, `ReasonBreakdown` AI slot, `WorldPanel` selector, and the panel wiring.
- **Live end-to-end:** real `qwen2.5:3b` via a locally-installed Ollama (32 presets) and real
  Gemini Nano via Chrome 150 on a Windows PC (32 presets).

---

## Appendix — file map

- Spec: `specs/019-llm-rationale-explanation/spec.md`
- Backend: `config.py`, `services/ollama_client.py`, `services/explanation_builder.py`,
  `models/proposal/explanation.py`, `models/proposal/proposal_run.py`,
  `services/proposal_run_manager.py`, `routers/proposal.py`
- Frontend: `state/proposalStore.ts`, `api/proposalClient.ts`, `lib/nano.ts`,
  `components/proposal/useExplanation.ts`, `components/proposal/ReasonBreakdown.tsx`,
  `components/proposal/panels/{World,Service,Content}ProposalPanel.tsx`,
  `public/nano-test.html`
- Infra: `docker-compose.yml` (`ollama` service, `llm` profile)
- Related finding: `specs/018-proposal-preset-testcases/FINDING-e3-service-candidate-outside-allowed-set.md`
