# Phase 0 Research: M6 V1 Stabilization & UI/UX Polish

Most decisions were resolved in the ADR + spec clarifications; this records what the plan relies on.

- **R1 — S1 freeze is investigation-driven.** Reproduce the "buttons unresponsive / no playback
  animation" symptom (prime suspects: a runtime error from the Maps-JS script injection when a key is
  present, a thrown error in the analyze/preview path, or the Play→tick loop not advancing), fix the
  root cause, add a frontend regression test. Cause unknown until reproduced (browser console / repro).
- **R2 — Three-view shell, no router.** `viewMode: 'setup'|'review'|'runs'` in the store; App renders the
  matching screen. No router/i18n/markdown library (constitution VI). (ADR D2; clarify Q1.)
- **R3 — Profile overrides reuse an existing field.** `CreateRunPlanBody.profiles` ALREADY exists (M2)
  but is currently dropped (M2 carry-forward). S6 wires it: parse → validate against
  `DriverModelProfile`/`VehicleBehaviorProfile`/`SpeedProfile` → use as the effective profiles in the
  draft/run (override the scenario) → frozen at run start → the tick engine uses them. No mid-run change.
  (ADR D6.)
- **R4 — Profile field set.** Driver: drowsiness/fatigue/attention/recovery sub-models (~16 numeric
  fields); vehicle: steering/lane/pedal/adas sub-profiles + rolling_window (~14); speed: 5 kph fields
  (`extra="forbid"`). ~35 fields total — confirms the dedicated Setup screen. Editor pre-fills from the
  selected scenario's profiles; reset-to-scenario-default restores them.
- **R5 — Language + export.** `uiLanguage: 'ja'|'en'` (default ja, session-only). A `t(label, lang)`
  helper renders one language everywhere `{ja,en}` appears. `GET /evidence` takes an optional
  `ui_language` param (default the M5 `"bilingual"` for back-compat) and records the selected value.
  (ADR D3.)
- **R6 — Run management.** Reset = clear run + return to Setup. Restart = re-run the current frozen
  `plan_id` from tick 0 (session-scoped; the draft must still be live). Run list = the existing
  `GET /api/runs` (reads `runs/`). Past runs reopened from disk are read-only. (ADR D4; clarify Q2.)
- **R7 — Visual replay, read-only.** A replay source reads a persisted `RunLog` and exposes the
  recorded per-tick state (tick_state, raw_state, decision trace, route_fraction, markers). The playback
  components accept a source abstraction (live store | replay source). A tick scrubber/step drives it.
  NO engine, NO recalculation. (ADR D7; constitution III.)
- **R8 — Markdown export.** A pure-Python formatter renders `build_evidence_report` output as Markdown
  (`## Simulator Facts` vs `## Human Review`); `GET /evidence.md`. No Markdown library. (ADR D8.)
- **R9 — Errors + cleanup + key-verify.** A uniform error/notice component; sweep `app/` for
  prototype-only assumptions / dead code; a consolidated key-not-persisted verification (backend log +
  frontend storage — both already covered, pulled into one explicit check). (ADR D5.)
- **R10 — No new deps; integration.** Full UC-01 integration across all package types + mocked Maps +
  feedback + evidence + replay (S9). README run instructions. Final stabilization sweep.
