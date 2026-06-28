# U8 Report — S8: Markdown evidence export (T012, T013)

**Status:** DONE

---

## Formatter signature

```python
# app/api/aica_api/services/evidence_markdown.py
def render_evidence_markdown(report: dict[str, Any]) -> str
```

Takes the **exact same dict** returned by `build_evidence_report` and formats it as
human-readable Markdown. Hand-rolled string building only — no Markdown/Jinja/template
library. No new dependencies added.

---

## Route shape

```
GET /api/runs/{run_id}/evidence.md?ui_language={lang}
```

- Accepts the same `ui_language` query param as `GET /evidence` (default `"bilingual"`).
- Returns `text/markdown; charset=utf-8` response body.
- Resolution path: `_resolve_run_log(run_id)` — active run (in-memory) or on-disk
  (`runs/{run_id}.json`). Same as the JSON endpoint. 404 if neither.
- Internally calls `build_evidence_report(...)` then `render_evidence_markdown(report)`.
  **No divergent computation** — same facts as the JSON route, only the format differs.

---

## How it reuses build_evidence_report

`get_evidence_markdown` (router) calls `_resolve_run_log` → `build_evidence_report` →
`render_evidence_markdown`. The JSON `build_evidence_report` output is the single
source of truth; `render_evidence_markdown` only formats the already-built dict.
Neither the route nor the formatter re-reads the run log or recomputes decisions.

---

## U5 profile_overrides under Simulator Facts

The U5 `profile_overrides` are persisted in `RunLog.driver_profile` and
`RunLog.vehicle_profile`, which `build_evidence_report` puts into
`simulator_facts.driver_profile` and `simulator_facts.vehicle_profile`.
`render_evidence_markdown` renders both fields under `### Profiles` inside
`## Simulator Facts`. If either is `None` (pre-M5 run or no override), a note
`N/A (pre-M5 run or no override)` is rendered instead of crashing.

---

## Facts vs Human-Review separation

The Markdown layout:

```
# Evidence Report: {run_id}          ← metadata (report_id, timestamp, ui_language,
                                        package, scenario, simulator_version)
## Simulator Facts                    ← objective recorded facts only
  ### Run Mode
  ### Route
  ### Parameters
  ### Hyperparameters
  ### Profiles                        ← driver_profile / vehicle_profile (U5)
  ### Event Plan
  ### Timeline Highlights             ← proposals fired, actions taken
  ### Algorithm Errors
## Human Review                       ← feedback ONLY; never simulator facts
  ### Feedback Labels
  ### Free-Text Comments
```

- Feedback values (`feedback_labels`, `free_text_comments`) are written **exclusively**
  under `## Human Review` — the formatter never touches them under Simulator Facts.
- No verdict language: the formatter never claims the algorithm was right or wrong.
  It presents objective facts and, separately, the human's recorded feedback.

---

## Frontend additions (T013)

- New client function `getEvidenceMarkdown(runId, uiLanguage?)` in
  `app/frontend/src/api/client.ts` — fetches `GET /api/runs/{runId}/evidence.md`
  and returns the response as `text()`.
- `EvidencePanel.tsx` now has four buttons: Copy JSON / Download JSON (existing) +
  **Copy .md** / **Download .md** (new, `data-testid` = `evidence-copy-md-btn` /
  `evidence-download-md-btn`).
- Both .md buttons work for active run (from store) **and** past run (via `runId` prop).
- `uiLanguage` from the store is passed through to `getEvidenceMarkdown` in both cases.
- Download filename: `evidence-{runId}.md`.

---

## Test summary

| Suite | Tests | Result |
|---|---|---|
| Backend (`uv run pytest`) | 992 passed, 3 skipped | GREEN |
| Frontend (`npm test`) | 237 passed | GREEN |
| Frontend build (`npm run build`) | 63 modules | CLEAN |

New test file: `app/api/tests/test_evidence_markdown.py` — 33 tests covering:
- `## Simulator Facts` / `## Human Review` headings present and ordered
- Package/scenario id, driver_profile value, algorithm error appear under Facts
- Feedback label/comment appears under Human Review and NOT under Facts
- No verdict language
- No-feedback run renders without crashing
- Route: 200, text/markdown, correct headings, separation, 404 for unknown, ui_language honored

Frontend tests added to `app/frontend/tests/evidence.test.tsx` — 5 new tests:
- .md buttons present for active run and past run (runId prop)
- Copy .md calls `getEvidenceMarkdown(runId, uiLanguage)` and writes text to clipboard
- Download .md calls `getEvidenceMarkdown` and downloads `evidence-{runId}.md`
- Past run via prop calls `getEvidenceMarkdown` with the prop run_id
