# U3 Report — S3: JA/EN Language Switching (M6 T004, T005)

**Status:** DONE
**Branch:** `007-stabilization-uiux`
**Commit:** `5683236`
**Tests:** 179 frontend (22 new) + 939 backend (8 new) passed; `npm run build` clean

---

## t() signature

```typescript
// app/frontend/src/i18n/t.ts

export type UiLanguage = 'ja' | 'en'
export type BilingualLabel = { ja: string; en: string }
export type LabelItem = string | BilingualLabel
export type LocalizedLabel = LabelItem | LabelItem[]

export function t(label: LocalizedLabel | null | undefined, lang: UiLanguage): string
```

Rules:
- `null` / `undefined` → `''`
- plain `string` → returned as-is
- `{ ja, en }` → `label[lang]`, falling back to the other language if the primary is empty
- `LabelItem[]` → each item resolved recursively, joined with `' '`

---

## Audited `{ja,en}` render sites

| File | Old access | New |
|---|---|---|
| `src/components/setup/PackageSelector.tsx` | `p.label.en` | `t(p.label, uiLanguage)` |
| `src/components/playback/ProposalPanel.tsx` | `proposal.message.en` | `t(proposal.message, uiLanguage)` |
| `src/components/playback/ProposalPanel.tsx` | `explanation` (prop, plain string) | `t(explanation, uiLanguage)` — prop type widened to `LocalizedLabel` |
| `src/components/feedback/FeedbackForm.tsx` | `fd.label.en` | `t(fd.label, uiLanguage)` |
| `src/components/trace/DecisionTracePanel.tsx` | `entry.explanation` (string) | `t(entry.explanation as LocalizedLabel, uiLanguage)` |
| `src/components/playback/CockpitView.tsx` | `latestDecision.explanation` | `t(latestDecision.explanation as LocalizedLabel, uiLanguage)` |
| `src/components/evidence/EvidencePanel.tsx` | `getEvidence(runId)` | `getEvidence(runId, uiLanguage)` |

No stray `.ja` / `.en` accesses remain. `MapKeyAndRouteInput.tsx` `NOTICE_LABELS` are plain English strings (not bilingual objects) — no `t()` needed.

---

## Store changes

- `RunStoreState.uiLanguage: 'ja' | 'en'` added (default `'ja'`, session-only).
- `SET_LANGUAGE: { type: 'SET_LANGUAGE'; lang: 'ja' | 'en' }` action added.
- RESET does NOT clear `uiLanguage` (reviewer preference survives run reset).

---

## Backend changes

- `build_evidence_report(run_log, *, report_id, timestamp, ui_language="bilingual")` — new optional param, defaults to `"bilingual"` for back-compat.
- `GET /api/runs/{run_id}/evidence` — accepts `?ui_language=` query param (default `"bilingual"`).

---

## Frontend API changes

- `getEvidence(runId: string, uiLanguage?: string)` — optional second param added; appended as `?ui_language=` query string when present.
- `EvidenceReport.ui_language` type widened from literal `'bilingual'` to `string`.

---

## New files

- `app/frontend/src/i18n/t.ts` — t() helper
- `app/frontend/src/components/layout/LanguageToggle.tsx` — JA/EN toggle buttons (`data-testid="lang-toggle-ja"`, `data-testid="lang-toggle-en"`)
- `app/frontend/tests/i18n.test.tsx` — 22 TDD tests (t() unit, store, toggle, audit, getEvidence param)

---

## Existing tests updated

Tests that asserted English label text were updated to expect Japanese (the new default):
- `tests/errors.test.tsx` — `'Test (0.1.0)'` → `'テスト (0.1.0)'`
- `tests/setup.test.tsx` — `'Rule-Based Rest Proposal'` / `'Weighted Score Rest Proposal'` → Japanese equivalents
- `tests/feedback.test.tsx` — `'proposal timing'` / EN field labels → JA equivalents
- `tests/playback.test.tsx` — `'Take a rest'` → `'休憩を取ってください'`
- `tests/evidence.test.tsx` — `getEvidence(runId)` call assertion → `getEvidence(runId, 'ja')`
