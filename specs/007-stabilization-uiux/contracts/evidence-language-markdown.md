# Contract: evidence ui_language + Markdown export

## GET /api/runs/{id}/evidence?ui_language=ja|en
- Optional `ui_language` query param. The derived report's `ui_language` field records the supplied
  value (the frontend passes the current UI language). Default (param absent) = the M5 `"bilingual"`
  constant (back-compat). Everything else unchanged from M5 (the §14.2 report, facts vs human_review).

## GET /api/runs/{id}/evidence.md (or ?format=markdown)
- Returns the SAME evidence report (from `build_evidence_report`) rendered as **Markdown** (text/markdown
  or a JSON string body — pick one, document it), via a **pure-Python** formatter (no Markdown library):
  - a title + run metadata (run_id, package/scenario id+version, ui_language, timestamp);
  - a `## Simulator Facts` section (route summary, route facts, plan/run_mode, setup values, profiles,
    a readable decision/proposal/action timeline, algorithm errors);
  - a separated `## Human Review` section (the feedback labels + the free-text comments).
- **Separation preserved**: human review only under `## Human Review`; facts never contain feedback.
- The document MUST NOT claim the simulator judged the algorithm.
- Works for any persisted run (active + on-disk), like the JSON evidence.

## Frontend
The evidence panel offers Markdown copy/download (`evidence-<run_id>.md`) alongside the JSON.

## Contract tests
- `ui_language=ja` → report `ui_language == "ja"`; absent → `"bilingual"`; otherwise identical to M5.
- The Markdown has a `## Simulator Facts` and a separate `## Human Review` section; feedback appears only
  under Human Review; no verdict language.
- A run with no feedback → an (empty) Human Review section; facts complete.
- Derived from `build_evidence_report` (same source as JSON) — the two stay consistent.
