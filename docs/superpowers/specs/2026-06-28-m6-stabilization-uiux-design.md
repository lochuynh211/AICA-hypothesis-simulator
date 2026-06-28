# M6 — V1 Stabilization & UI/UX Polish (Design / ADR)

**Date:** 2026-06-28
**Milestone:** M6 (V1 stabilization — the V1 release candidate)
**Status:** Approved design — pre-spec
**Branch (planned):** `007-stabilization-uiux`

## Context

M0–M5 are complete and merged to `develop`: the full UC-01 V1 feature set — deterministic
tick engine + algorithm adapter (declarative_rule, weighted_score, python_module incl. the
transparent hybrid), append-only evidence, the BYO-key Google Maps route surface, and the
human-review feedback + evidence-export loop. M6 is the **V1 release candidate**: make the
UC-01 simulator stable enough for real review sessions, fix the outstanding UI blocker, and
fold in the UI/UX-polish enhancements the user requested.

Master scope (milestones §8): tighten the skeleton-layout UX; JA/EN label switching; verify
all V1 labels display; reset/restart run; basic run list from `runs/`; improve error displays;
full UC-01 integration tests; README run instructions; remove prototype-only assumptions;
verify no Maps key persisted. User-requested additions (see the M6 backlog memory): a setup-time
driver/vehicle/speed **profile editor**, a **visual scrubbable replay**, **Markdown export**, a
**ui_language selector**, and fixing the **"can't press any button / no playback animation"** bug
hit during M4 testing.

This is a **single large milestone built as internal slices** (the user's choice), ordered so
the release candidate becomes shippable and each slice leaves the app runnable.

## Slices (S1–S9)

| # | Slice | Summary |
|---|---|---|
| S1 | **Fix the UI freeze** | The "buttons unresponsive / no animation" blocker — FIRST. |
| S2 | **Two-view app shell** | A `viewMode: setup\|review` toggle; relocate the setup editors to a dedicated **Setup screen**. |
| S3 | Language switching | JA/EN toggle; `t()` picks one language everywhere; export records the real `ui_language`. |
| S4 | Run management | Reset (new run / back to Setup) + Restart (re-run the same plan) + run list from `runs/`. |
| S5 | Errors + cleanup + key-verify | Uniform error surfacing; remove prototype-only assumptions; verify no Maps key persisted. |
| S6 | Full profile editor | Edit every driver/vehicle/speed profile field on the Setup screen; frozen at run start. |
| S7 | Visual replay | Full read-only 3-panel re-drive from a persisted log via a tick scrubber. |
| S8 | Markdown export | Evidence as a human-readable Markdown report (facts vs review separated). |
| S9 | Integration + docs | Full UC-01 integration tests, README run instructions, final stabilization sweep. |

## Decisions

### D1 — S1 fix is investigation-driven, lands first
Reproduce the "buttons unresponsive / no playback animation" symptom, find the root cause (prime
suspects: a runtime error from the Maps-JS script injection when a key is present, a thrown error
in the analyze/preview path leaving the flow stuck, or the Play→tick loop not advancing), fix it,
and add a **frontend regression test**. Diagnosis needs the running app's browser console (the
Chrome extension connected, or a reproduction + the console error). S1 lands before everything
else because M6's goal — "run UC-01 end-to-end without developer help" — depends on it.

### D2 — Two-view app shell via a store toggle (no router dependency)
A store `viewMode: 'setup' | 'review'` (default `setup`) swaps the rendered screen — a lightweight
toggle, **not** a router library (no new npm dep). **Setup screen**: package + scenario selectors,
parameter + hyperparameter editors, the new profile editor, the Maps key/route input, the plan
preview; **"Start Run"** freezes the plan and switches to `review`. **Review screen**: the existing
accepted 3-panel skeleton (left context/route, center playback + cockpit/map, right trace +
feedback + evidence) — unchanged for the review experience; a **"← New run / Setup"** affordance
returns to setup (this also provides the S4 reset behavior). The setup editors **move** from the
left panel onto the Setup screen, de-cluttering the review screen (and likely easing the
"cramped/unresponsive" feel).

### D3 — Language switching; export records the selected language
A store `uiLanguage: 'ja' | 'en'` (default `ja`, the AICA-primary language) with a header toggle.
A small `t(label) → label[uiLanguage]` helper renders one language everywhere `{ja,en}` content
appears (package/scenario labels, proposals, explanations, feedback field labels, notices) — never
raw JSON or both languages. Audit all label sites so every V1 label displays correctly. The
evidence export's `ui_language` stops being the fixed `"bilingual"`: `GET /evidence` takes an
optional `ui_language` param the frontend supplies from the toggle and records the real selected
value (the backend still owns the report). Selection is in-memory store state (not persisted to disk).

### D4 — Run management on the existing endpoints
- **Reset** → "New run / Setup" clears the current run state and returns to the Setup screen.
- **Restart** → create a new run from the *same* frozen `plan_id` (re-run from tick 0), no re-setup.
- **Run list** → the existing `GET /api/runs` (reads `runs/`) surfaced as a browsable list
  (run_id, package, scenario, status, created_at); selecting a past run opens its evidence
  (timeline + export + the S7 visual replay), read-only.

### D5 — Uniform errors, prototype cleanup, key-safety verification
Consistent error/notice presentation for the scattered states (setup/validation/run/maps/feedback)
so failures are legible. Sweep `app/` for leftover prototype hacks / TODOs / dead code (the
`others/prototype_*` reference is untouched). A consolidated **verify-no-Maps-key** check (backend:
key absent from any `runs/` log; frontend: key never in localStorage/sessionStorage) so the V1-RC
criterion is provably met.

### D6 — Full profile editor as setup-time overrides, frozen at run start
The Setup screen renders **every** field of `driver_profile` / `vehicle_profile` / `speed_profile`
(nested rate/behavior models + speed-kph-per-road-type) as editable inputs, pre-filled from the
selected scenario's profiles, with "reset to scenario default." Edits are **overrides threaded
setup-time only**: the run-plan/run-create body accepts optional profile overrides → validated
against the profile models → **frozen at run start** into the run snapshot (same immutability as
hyperparameters) → the tick engine uses the *effective* (overridden-or-scenario) profiles. They are
already in the M5 evidence export, so the snapshot/export reflect what actually ran. No mid-run
change (determinism preserved).

### D7 — Visual replay = read-only 3-panel re-drive from the log (no recalculation)
A **replay source** reads a persisted `RunLog` and exposes the recorded state at a given
tick_index (tick_state, raw_state, decision trace, `route_fraction`, markers). The playback
components (cockpit, route/map, decision trace) gain a small abstraction so they render from
either the **live store** or the **replay source**; a tick **scrubber/step** sets the current
replay tick. Entry from the run list: pick a past run → Replay → read-only 3-panel re-drive — NO
engine, NO recalculation (constitution III). It is the visual companion to M5's structured
timeline; feedback/events stay visible.

### D8 — Markdown export (pure Python, no library)
The same evidence report (M5 §14.2) is also emitted as Markdown: run metadata, a `## Simulator
Facts` section (route, plan, profiles, setup values, decision/proposal/action timeline highlights,
errors) and a separated `## Human Review` section (feedback labels + free-text comments). Backend
`GET /api/runs/{id}/evidence.md` (or a `format` param) derives it from `build_evidence_report` via
a **pure-Python Markdown formatter** (no Markdown library — no new dep). Frontend copy/download
`.md` alongside the JSON. Facts-vs-review separation preserved; never claims a verdict.

### D9 — No new dependencies
A view-mode toggle (not a router), a `t()` helper (not an i18n library), a pure-Python Markdown
formatter (not a Markdown library). Backend stdlib + existing FastAPI/Pydantic; frontend existing
React/Vite. See the supply-chain discipline.

## Components (high level)
- **Frontend**: an app shell with `SetupScreen` + `ReviewScreen` (driven by `viewMode`); the setup
  editors relocated; a `ProfileEditor`; a `LanguageToggle` + `t()` helper; a `RunList`; a `ReplayController`
  + a replay-source abstraction the playback components consume; Markdown copy/download; a uniform
  error component; store additions (`viewMode`, `uiLanguage`, profile overrides, replay state).
- **Backend**: run-plan/run-create accept profile overrides (validated + frozen + threaded to the
  tick engine); `GET /evidence` takes `ui_language`; `GET /evidence.md` (pure-Python formatter);
  reset/restart via the existing endpoints; the run list via the existing `GET /api/runs`.

## Testing Strategy (per slice, TDD)
- S1 regression test reproducing the freeze. S2 view-mode toggle + setup-editors-on-setup-screen.
  S3 `t()` language pick + toggle switches all labels + export records selected `ui_language`.
  S4 reset clears+returns, restart re-runs the plan, run list renders + opens evidence/replay.
  S5 uniform error rendering + consolidated key-not-persisted guard. S6 profile form renders/validates
  all fields, overrides thread into the plan + freeze + appear in evidence, reset-to-default.
  S7 replay source exposes recorded per-tick state, the scrubber re-drives the 3 panels read-only with
  no recalculation, renders from log not engine. S8 Markdown separates facts vs review, derived from
  build_evidence_report, copy/download. S9 full UC-01 integration (all package types + Maps mocked +
  feedback + evidence + replay) + docker validation.

## Non-Goals (YAGNI)
Run comparison (master: "still not required for V1"); expert_override mode; auth/accounts/multi-user/
cloud; a router or i18n or Markdown library; persisting the language or Maps key to disk.

## Constitution Check (preliminary)
- I Backend source of truth — PASS (profile overrides validated+frozen backend; export+markdown
  backend; replay renders the recorded log).
- II Append-only / failures never hidden — PASS (evidence unchanged; errors surfaced honestly;
  overrides recorded in the snapshot/export).
- III Deterministic/replayable — PASS (overrides frozen at run start; replay renders recorded values
  with NO recalculation).
- IV Qualitative trigger discipline — PASS (profile editing is setup-time scenario-behavior config,
  not external-service numerics on a trigger path).
- V One adapter contract — PASS (adapter/decision pipeline untouched).
- VI Local-first / YAGNI / no new deps — PASS (toggle/helper/formatter, no libraries).
- Security — the Maps key is still never persisted (now explicitly verified).

## Open Questions for the Spec Phase
- The exact root cause of the S1 freeze (found during diagnosis) and the regression-test shape.
- Whether the run list + replay live as a third "Evidence/Runs" view or within the Setup screen.
- Profile-editor field grouping/validation specifics (the profile models have many nested numeric
  fields) and whether "reset to scenario default" is per-field or whole-profile.
- The Markdown report's exact section layout.
