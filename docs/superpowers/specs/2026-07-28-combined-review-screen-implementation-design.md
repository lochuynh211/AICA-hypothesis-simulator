# Combined Review Screen — Implementation Design

**Date:** 2026-07-28
**Status:** Approved design
**Scope:** The built Combined Simulator screen (`MergedShell`) and the evidence it reads

**Relationship to existing designs:**

- `2026-07-27-combined-rationale-review-design.md` — **the product specification.** What the
  screen shows, why, and what it must never do. Unchanged by this document; every acceptance
  criterion there still governs. Read it first.
- `2026-07-24-combined-test-case-evaluation-design.md` — Phase 2. Its checkpoint/expectation
  contract and evaluator remain deferred. This document borrows its *case* contract shape and
  drops every expectation field, exactly as 07-27 §3 requires.
- `others/aica_combined_testcase_review_prototype.html` — layout and interaction reference.
  Its *basic* views and two-tier switch are the specification; its *detailed* views are not
  (07-27 §9.2).

This document answers only the question 07-27 leaves open: **what actually gets built, and
where.**

---

## 1. The finding that shaped this design

07-27 §13 reads as a large feature. It is not, because most of the evidence it needs is
already recorded and already in the browser.

A survey of the built system:

| Stage | Per-feature contributions recorded? | Where |
|---|---|---|
| Trigger | **No** | `category_scores()` computes `w × feature` terms and discards them; `DecisionResult` keeps only aggregate `scores` and `features` as *ordinal band strings* |
| Bridge | No | `merged_adapter` carries facts, not influence (07-27 §11 gap 2) |
| Service | **Yes** | `FeatureContribution` — `feature_id`, world value, `response_coefficient`, `weight`, signed contribution |
| Content | **Yes**, for selected items only | `ItemFeatureContribution` — same grammar via `a_i` / `effective_weight` |

Both proposal stages are not merely recorded but already **normalized in the frontend**:
`ServiceResultOverlay` and `ContentResultOverlay` map both shapes into the shared `ReasonRow`
(`featureId`, `value`, `r`, `w`, `contribution`) before rendering `ReasonBreakdown`.

Two consequences follow, and they set this document's shape:

1. **No causal-evidence adapter is needed.** A backend projection of service and content
   evidence would re-serve data the frontend is already holding in the exact shape the review
   needs.
2. **Necessity and flip distance are not backend work.** 07-27 §8 describes them as
   re-running the decision. They re-run *the recorded chain*, not the algorithm: masking a
   feature is dropping one `w × r` term and re-summing; flip distance bisects a multiplier
   over those same recorded terms. Both are arithmetic over data already present.

What is genuinely missing is narrow: the trigger's per-feature terms, the content candidate
pool, and somewhere to put a reviewer's judgement.

## 2. Decisions taken

| Decision | Choice |
|---|---|
| Scope | All of 07-27 §13, as one feature |
| Case catalog | New committed contracts, no expectation fields |
| Catalog delivery | **Bundled JSON**, not a registry endpoint — chosen because it is the only option that survives a later htmlapp export unchanged, and it costs nothing now |
| Log panel | Dropped from Combined. **Correction:** the premise that it "stays available on the Runs/replay screens" was false — `MergedLogPanel` is imported by no other screen, so dropping it makes the event log unreachable in the UI. The decision to drop it stands as the owner's, but it was taken on a wrong fact and is worth revisiting |
| Content candidate pool | Recorded (07-27 §11 gap 1 fixed here) |
| Review math | Split at the formula boundary — which, given §1, places all of it in the frontend |
| Contrast | **Removed.** No paired cases, no A/B switch, no simulated-sensitivity delta table. Test cases only |

Removing contrast supersedes the parts of 07-27 that assume it: the contrast card in §6.1, the
contrast row of the left column, and §12's retention of "simulated sensitivity". Nothing else
in 07-27 depends on it — the review surface never used a pair to explain a single decision.

htmlapp is out of scope for this feature. No htmlapp file is touched.

## 3. Backend

Four additive changes. No new service module, no new router, no resolver, and no review
endpoint — the review reads evidence the frontend already holds. The one route added is B3's
feedback POST, on the existing `merged_runs` router.

### B1 — Trigger emits per-feature contributions

`packages/aica_transparent_hybrid_trigger_v1/algorithm.py` already computes every term it
needs inside `category_scores()`:

```python
base_safety_risk = clamp(w_drowsiness·drowsiness + w_fatigue·fatigue
                       + w_driving_anomaly·driving_anomaly
                       + w_driving_time·driving_time + w_env·env_load)
rest_required_score      = clamp(base_safety_risk + rest_bonus + child_bonus)
monotony_prevention_score = clamp(w_monotony·monotony + w_env_mono·env_load
                                + w_familiar·familiar_route)
```

`category_scores()` additionally returns the terms, and `evaluate()` emits them under a new
`DecisionResult` field. The shape deliberately mirrors `ReasonRow` so the trigger stage uses
the same grammar as the two proposal stages:

```text
feature_contributions: {
  "<category>": [
    { feature_id, value,        # the SMOOTHED numeric the formula consumed
      band,                     # the ordinal label already in `features`
      weight, contribution }    # contribution = weight × value
  ]
}
```

Emitted for **both** `rest_required` and `monotony_prevention` on every tick — 07-27 §7.3
compares the two categories, so the runner-up's terms must be recorded, not reconstructed.
This closes 07-27 §11 gap 3.

Three details that the review surface depends on and must not be lost:

- **`child_passenger`** appears as a pseudo-feature with weight `w_child_bonus` and value
  `0`/`1`, so its influence is visible rather than folded into a constant.
- **The `minimum_risk_for_rest_bonus` gate** is recorded as a `DecisionGate`-shaped entry:
  which inputs were evaluated, the threshold, whether it passed, and that its effect is to
  admit or zero the two rest-bonus terms. Without it a reviewer sees two features
  contributing nothing and cannot tell why.
- **Clamping is recorded.** `clamp` means `Σ contributions` can exceed the reported score.
  Where the clamp binds, the emitted record says so, and the panel states it rather than
  showing shares that do not reconcile.

`DecisionResult.feature_contributions` defaults to empty. Packages that do not populate it —
`nri_fatigue_score_v1` — are unaffected, and the review surface reports the trigger stage as
unavailable for them rather than inferring anything.

### B4 — The fire point carries the trigger chain

**Found during implementation planning, after this document's first draft.**

B1 puts the trigger chain into `DecisionResult`, which reaches the frontend on a *live run*
(`TickResponseSuccess.decision`). But the review's primary path before Play is the
**quickview**, and `FirePoint` carries only `{category, strength, tick, time_min}` — no
decision at all. Without carrying the chain onto the fire, the trigger stage would report
"unavailable" on the path reviewers actually use.

`FirePoint` gains `feature_contributions` and `criteria`, both defaulting to `{}` so every
previously persisted preview stays parseable. `criteria` travels with it because §7.3 requires
`firing threshold 0.70 · clearance +0.010` under the comparison pickers. The change is two
model fields and two lines in `services/preview.py`, where `decision` is already in scope at
the point the fire dict is built.

### B2 — Content selector records the scored tail

The content selector's evidence writer additionally records the non-selected candidates it
scored:

```text
scored_tail: [ { item_id, rank, fit, contributions[] } ]   # top 20 by fit, capped
cut_margin:  float                                          # fit gap, last selected → first excluded
tail_truncated: bool                                        # true when >20 were scored
```

`contributions[]` uses the same `ItemFeatureContribution` shape as a selected item, so no new
projection is required. This closes 07-27 §11 gap 1 and makes "why isn't song X here?"
answerable, plus gives every plan position below rank 1 a real runner-up.

### B3 — Review judgement on the existing M5 feedback store

M5 already has everything needed: `FeedbackEvent` (`kind`, `target`, `labels`, `comment`) is
appended into `RunLog.events` through `append_feedback`, which persists the whole log
atomically after every append. Feedback there is already evidence-only and already forbidden
from touching any algorithm.

The change is to `FeedbackTarget`: two new `scope` values and the fields that anchor a review
judgement, all optional and additive.

```text
scope: "review_input" | "review_decision"     # added to run|decision|proposal|action
case_id, checkpoint_id, stage, review_target  # the (case · decision point · stage · target) key
feature_id                                    # review_input only
```

- `review_input` — one per-input judgement. `labels: {judgment: rational | too_strong |
  too_weak | not_relevant_here | unsure}`.
- `review_decision` — one per-decision assessment. `labels: {assessment: appropriate |
  not_sure | not_appropriate}` plus `comment`.

A new `POST /api/merged-runs/{merged_run_id}/review-feedback` resolves the merged run's
`trigger_run_id` and delegates to `append_feedback`, so there remains exactly **one**
append-only feedback store rather than a second parallel one.

Export reuses the existing evidence-export separation of facts from review (§14.2), emitting
the 07-27 §10 JSON with the trigger, service and content package versions in play.

**"Not sure" is never counted as a flag** — not in the picker chip, not in the checkpoint
tally. It is a request for explanation. This is enforced in the counting function and covered
by a test, because it is the kind of rule that quietly regresses.

## 4. Case catalog

### 4.1 Contract

`combined_contracts/test_cases/case-<slug>.json`, validated against
`combined_contracts/schema/combined_test_case.schema.json`.

```text
CombinedTestCase
├── case_id, schema_version, version
├── title{ja,en}, brief{ja,en}          # the two-sentence card brief
├── what_to_watch[]                     # bilingual dimension chips
├── persona
│   ├── narrative{ja,en}, goals[], preferences[], constraints[], assumptions[]
│   └── profile_ref                     # a committed proposal preset, version- or hash-pinned
├── journey
│   ├── scenario_ref, route_preset_ref
│   ├── seed, tick_seconds
│   ├── fixed_overrides                 # situation/context the case pins
│   └── automatic_path                  # deterministic choices only (rank 1 unless named)
└── algorithm_defaults { trigger, service, content }   # defaults, not expectations
```

There is no `checkpoints`, no `expected`, no `hypothesis`, no `top_fit_min`, and no
`contrast`. 07-27 §5 is
explicit that Phase 1 authors no expectations; adding any field that records baseline
behaviour would recreate the problem 07-27 §2 was written to correct. Phase 2 adds
`checkpoints` additively.

Every reference is resolved against a version, or pinned to a SHA-256 content hash when the
artifact has no version. A drifted or missing reference makes the case unavailable and says
why; it never silently resolves to something else.

### 4.2 Delivery

Cases are imported into `app/frontend` through a Vite alias onto `combined_contracts/`, so the
committed contract directory is the single source of truth with no copies. Vite re-imports
JSON on change, so cases stay live in development; only a production image rebuild is needed
to ship an edit.

A pytest contract test reads the same directory from disk and validates every case against the
schema and the reference resolvability rules. This requires no endpoint — the test reads
files, exactly as the schema tests for the other committed contracts do.

### 4.3 Resolution

A TS resolver applies a case by dispatching into the scoped run and proposal stores that
`MergedSetupPanel` already drives — `SELECT_SCENARIO`, `SELECT_PACKAGE`, `LOAD_PRESET`,
`LOAD_PROFILE`, `SET_SERVICE_PACKAGE`, `SET_CONTENT_PACKAGE`, the route preset, seed and tick
overrides. The existing debounced auto-quickview then fires unchanged, and the review renders
from its result. No new run path is introduced.

The setup remains fully editable afterwards. The panel compares live setup against the
resolved snapshot and shows a "differs from the case as defined · Reset" note. Per 07-27 §9.3
there is no mode, no lock and no grey-out.

### 4.4 Catalog content

Six artifacts — the six complete journeys C-01…C-06 from 07-24 §13, with every expectation
field removed and `brief` / `what_to_watch` added:

| ID | Case | What it is for |
|---|---|---|
| C-01 | Alert daytime control | A journey where nothing should fire |
| C-02 | Night highway drowsiness | Rest-trigger timing and safety-oriented proposals |
| C-03 | Monotonous highway, low fatigue | Monotony rather than fatigue driving the intervention |
| C-04 | Mountain road, high workload | Distracting moving services excluded |
| C-05 | Late-night traffic jam | Fatigue, monotony, calming and energizing in conflict |
| C-06 | Full rest lifecycle | Before-rest proposal coherence across the lifecycle |

The four `X-` artifacts of 07-24 §13 existed only as contrast pairs and are dropped with
contrast. Personalization and recent-play history are still reviewable wherever they surface
inside these six journeys — they simply get no case aimed at them, and no case is authored to
differ from another by a single input.

One adjustment is forced by the 07-27 V1 scope boundary: **C-06 contributes only its first
checkpoint.** Its stopped and after-nap stages still simulate and display; they expose no
review target.

## 5. Frontend

### 5.1 Layout

`MergedShell` becomes three columns at **20 / 45 / 35**.

- **Left** — case picker, case card (+ details modal), setup panel.
- **Centre** — quickview timeline, playback controls, checkpoint rail, schematic map,
  decision band, then service and content proposals side by side at **42 / 58**.
- **Right** — stage tabs → what decided it → parameter rationale → your assessment.

`MergedLogPanel` is removed from Combined. It is imported by no other screen, so the component file remains but is unreferenced in production — see the correction in §2.

The playback loop redraws the timeline, rail, map and clock **only**. It must never redraw the
proposal cards, or an expanded contribution chain collapses mid-run. This is a structural
requirement, not a styling preference: the animated subtree and the proposal subtree are
siblings, and a test asserts an expanded chain survives a play/pause cycle.

### 5.2 Components — `components/review/`

| Column | Components |
|---|---|
| Left | `ExperienceCasePicker` (flag-count chip), `ExperienceCaseCard`, `CaseDetailsModal` |
| Centre | `CheckpointRail`, `DecisionBand`, `ProposalSplit` (re-lays out the existing `ServiceResultOverlay` / `ContentResultOverlay`) |
| Right | `ReviewColumn`, `StageTabs`, `WhatDecidedIt` (`ComparisonPickers`, `MarginBars`, `VerdictSentence`, `DomainGrouping`), `ParameterRationale`, `ConsequenceNotes`, `PlayedNoPart`, `DecisionAssessment` |

`MergedSetupPanel` gains the 🚗 *situation* / ⚙ *algorithm* badges, the differs-from-case note,
and the basic/detailed switch. The badges are labels only — nothing they mark is disabled.

### 5.3 Two-tier setup editors

Each of the five Edit popups opens a **basic** view carrying only what a reviewer routinely
turns (07-27 §9.1), with a `▸ Detailed setup — every parameter` button that swaps in the
existing component **verbatim**:

| Editor | Detailed view mounts |
|---|---|
| Situation | `FixedConditionsSection` + `SituationFieldRows` + `RouteConditionsPainter` + `SpeedProfileSection` + `SimulatedSignalsSection` |
| Driver profile | `PreferenceHistorySection` |
| Trigger | `AlgorithmFormulationPanel` |
| Service | `ServiceSetupSection` |
| Content | `ContentSetupSection` |

All inside the existing `Modal` at `size="wide"`. Not restyled, not re-grouped, not rebuilt
from manifests. Where a case pins nothing in a basic view's area, the view says so rather than
showing an empty box.

### 5.4 `lib/review/reviewMath.ts` + `lib/review/reviewVocabulary.ts`

Every derived number the right column shows, as pure functions over `ReasonRow`-shaped chains
already in the store. No fetch, no framework imports, unit-testable standalone.

| Function | Definition |
|---|---|
| `margin(a, b)` | per-feature `contribution_a − contribution_b`, plus the lean direction |
| `scaleBound(rows)` | one shared bound across both columns, rounded up to the first readable value strictly above the largest magnitude (`0.299 → ±0.3`, `0.11 → ±0.125`); always displayed |
| `realizedShare(rows)` | `\|contribution\| / Σ\|contribution\|` |
| `declaredShare(cfg)` | the feature's *intended* share of influence, normalized across the stage's declared weights — `base_weight × purpose_multiplier` for the two proposal stages, the plain `w_*` hyperparameter for the trigger, which has no purpose multiplier |
| `intentVsEffect()` | `realized / declared` → ↑ ↓ ≈ |
| `necessity(rows, id)` | drop that feature's term, redistribute its weight, re-sum → which option wins now |
| `flipDistance(a, b, id)` | bisect a multiplier on that feature's declared weight until the winner changes; `null` when no flip exists in a bounded range |
| `domainGroup(id)` | Driver state · Road & environment · Preferences & history · Content properties |
| `phrase(id)` | plain phrasing; the identifier stays visible in faint grey and is never the label |

Rules the functions enforce, each with a test:

- Necessity and flip distance are single-parameter, everything else fixed, local to one
  decision. No combinatorial search.
- Both are **suppressed on the trigger stage** — they only mean something against a named
  alternative option.
- "Played no part" lists inputs below 2 % realized share.
- Where required evidence is absent the projection returns an explicit *unavailable* result
  carrying the reason. It never returns a zero that reads as a measured zero, and never
  infers a contribution (07-27 acceptance criterion 9).

### 5.5 Checkpoints are derived

The checkpoint rail is computed from the run, not authored: the first `rest_required` fire and
the first `monotony_prevention` fire, each with the proposal made at that moment. Every other
journey stage — rest acceptance, the stopped stage, after-nap proposals — continues to animate
on the timeline and map and remains visible in the centre, but is not selectable as a review
target.

When a case produces neither fire, the rail is empty and says so. That is a legitimate and
informative outcome (C-01 is the alert daytime control), not an error.

## 6. Testing

**pytest**

- Contract: every committed case validates against the schema; references resolve; a drifted
  reference fails visibly.
- B1: contributions reconcile with the emitted category score, or the clamp is recorded as
  binding; both categories emitted every tick; the rest-bonus gate records its inputs,
  threshold, outcome and effect; `child_passenger` appears as a term; a package that emits no
  contributions is reported unavailable rather than inferred.
- B4: a quickview fire carries both categories' rows and the thresholds; a fire recorded
  before this change still parses, with the trigger stage reported unavailable.
- B2: the tail records only scored non-selected items, is capped at 20, sets
  `tail_truncated` when it truncates, and `cut_margin` matches the last-selected/first-excluded
  fit gap.
- B3: both new scopes round-trip; the log stays append-only; no feedback record reaches any
  algorithm; export separates simulator facts from human review and carries all three package
  versions.

**Vitest**

- `reviewMath.ts`: scale-bound rounding at the boundaries, margin signs, realized and
  declared shares, ↑↓≈, necessity flipping and not flipping, flip distance returning `null`,
  domain buckets, trigger-stage suppression, the 2 % played-no-part threshold, and the
  unavailable path for absent evidence.
- Counting: `unsure` is excluded from every flag count.
- Components: case selection resolves into the stores; stage tabs; a judgement is captured and
  exported; an expanded contribution chain survives a play/pause cycle; the panel states
  missing evidence instead of rendering a number.

**Integration**

One test per committed case: run it through the real merged path and assert a non-empty review
projection at its in-scope checkpoint — or, for C-01, an empty rail with its stated reason.

## 7. Slices

Each leaves Trigger, Proposal and Combined working.

1. **Evidence completion** — B1, B2, and the review-math modules with their tests. No UI.
2. **Case catalog** — schema, two cases, TS resolver, picker and case card.
3. **Right column** — B4 first (its consumer lives here), then stage tabs, comparison,
   parameter rationale, consequences, played-no-part.
4. **Feedback** — B3 capture, persistence, export.
5. **Reshape** — 20/45/35, proposals to centre, log panel out, two-tier setup, full catalog.

## 8. Out of scope

Carried forward from 07-27 and restated so nothing creeps back in:

- No pass/fail verdict, status aggregation, or first-divergence banner. Nothing is graded.
- No authored expectations, checkpoints or contracts.
- No automatic parameter optimisation or recommended values.
- No re-running of any algorithm to produce an explanation.
- No review of the rest-spot or after-rest stages, and no trigger category beyond
  `rest_required` and `monotony_prevention`.
- The "compare with an earlier moment" trigger mode (07-27 §7.3) — it needs per-tick factor
  snapshots that are not recorded (§11 gap 4).
- Cross-case aggregation and change preview (07-27 §10) — deferred until single-case review is
  trusted.
- Contrast in every form: paired cases, the A/B switch, and the simulated-sensitivity delta
  table. A case explains itself from its own recorded evidence, never by comparison to another
  case.
- No bridge-stage rationale: `merged_adapter` records no per-feature influence (§11 gap 2), so
  the bridge shows facts and exposes no review target.
- htmlapp.

## 9. Acceptance criteria

07-27 §14 governs unchanged. This document adds the implementation-level criteria that make
those testable:

1. The trigger stage renders from **recorded** contributions for both categories; with a
   package that emits none, it reports unavailable rather than rendering anything.
2. Content comparison can reach non-selected candidates, and states when the tail was
   truncated.
3. Every review judgement survives a page refresh through the existing append-only store.
4. Every case in the catalog resolves, or is unavailable with a stated reason — never silently
   substituted.
5. No file under `packages/` other than `aica_transparent_hybrid_trigger_v1/algorithm.py` and
   the content selector's evidence writer changes behaviour; no scoring, ranking or gate is
   altered anywhere.
6. `reviewMath.ts` and `reviewVocabulary.ts` import no framework and perform no I/O.

---

## 10. Post-implementation record

The feature was built across 19 tasks on branch `023-combined-review-screen`. Each task was
reviewed against this design and its own brief; a whole-branch review followed. What survives
below is what a future reader needs and cannot reconstruct from the diff.

### 10.1 Known gap — case pins do not reach the trigger in the pre-Play quickview

`MergedQuickviewBody` accepts neither `context_overrides`, `initial_state` nor `tick_seconds`,
and `services/merged_quickview.py` forwards none of them to `iter_preview_ticks` — which does
support them, and which the live-run path uses correctly.

**Consequence.** A case's pinned `is_night` and initial drowsiness/fatigue are causally inert
on the *trigger* side of the pre-Play quickview, which is the surface the review column reads
before the reviewer presses Play. `is_night` does reach the proposal side. Painted mountain and
jam bands *are* wired and were verified end-to-end.

It was measured, not inferred: C-06's request body returns a score series starting at 0.1063 —
the trajectory of the scenario's default `fatigue: 20`, not its pinned `82`.

**Handling.** All four affected cases (C-01, C-02, C-03, C-06) disclose this in their `brief`,
bilingually. Integration tests assert positionally only for C-04/C-05, where the pins genuinely
reach the engine; C-02/C-06 assert reachability with an inline comment saying why they cannot
assert more. C-01 and C-03 are unaffected today only because their pinned values coincide with
the scenario defaults — if a scenario default is retuned, they become affected silently, which
is why their disclosures exist too.

Fixing it is bounded: a few model fields, one service call, one frontend effect. It was deferred
because the path is shared by roughly twenty existing tests and the change is out of proportion
to a task's scope. **The natural follow-up is a badge on the checkpoint itself**, not only the
case card — that turns "won't be misled if they read the brief first" into "cannot be misled".

### 10.2 Correction to a decision recorded in §2

The log panel was dropped from the Combined layout on the stated grounds that it "stays
available on the Runs/replay screens". That was false: no screen imports `MergedLogPanel`. The
component file remains but is unreferenced in production, so the event log is currently
unreachable in the UI. The decision to drop it was the owner's and stands; the justification
given for it was wrong, and it is worth revisiting on that basis.

### 10.3 Parked findings — real, non-blocking, with rulings

- **`sameRecord` compares record values with `===`** (`lib/review/caseResolver.ts`). Array-valued
  situation fields (`route_tags`, `destination_tags`) would compare by reference, so drift could
  be mis-reported in either direction. *Ruling: dormant.* No committed case pins those fields, so
  `situationFields` currently carries only a boolean. Needs deep equality before any case pins a
  tag array.
- **The flag-chip wiring has no end-to-end regression test.** `MergedShell`'s `flagCounts` line
  is correct by direct reading, and the counting rule is well tested, but no test mounts the
  shell and asserts the chip reflects real store judgements — so a reversion to the empty stub
  would pass every test. *Ruling: coverage gap, not a defect.*

### 10.4 Follow-ups worth scheduling

Ordered by value, none blocking:

1. Thread the quickview pins (§10.1), then drop the case disclosures.
2. Decide the log panel's fate (§10.2) — restore it somewhere, or delete the dead component.
3. Deep equality in `sameRecord`, before a case pins a tag array.
4. An integration test for the flag-chip wiring.
5. `flipDistance` only searches upward (multiplier 1→10) — it answers "how much stronger would
   this need to be to flip the outcome", never "how much weaker". Confirm that is deliberate.
6. Case references are not version- or hash-pinned as §4.1 claims. Either build it or soften
   the claim.
7. `WhatDecidedIt` has no `initialLanguage="ja"` test, despite being the component class where
   two real Japanese-leak defects were found. The assembled-column test's stray-English regex
   backstops it, but only heuristically.
8. Accessibility: the case picker's `<select>` has no accessible name; the assessment buttons
   have no `role="group"`.

---

## 11. Owner-review revisions (2026-07-29)

Two rounds of live review after the branch was complete. Recorded here because
several of these changed decisions taken earlier in this document.

### 11.1 Layout and defaults

Combined is now the **default screen**. The centre column runs controls → map →
service|content **side by side at 40/60** → quickview strip at the bottom. The
standalone animation timeline was removed: it plotted the same distance axis as
the quickview and earned no space. The explanation-source selector moved to the
Setup panel — choosing *how* a rationale is generated is a setup decision, while
the centre column is for what the product did.

**Why the split looked broken:** `MergedProposalPanel` stacked its two halves in
a flex column, so the split grid one level up had a single child and nothing to
split. The panel now owns its own split.

Animation defaults to 4x; the map's car is a dot rather than a heading arrow (no
bearing is computed).

### 11.2 The quickview threading gap is closed

§10.1 recorded this as a deferred gap needing an owner decision. The owner hit it
directly: the projection and the live run showed **different drowsiness/fatigue**,
because the Play path sent `initial_state`/`context_overrides` and the quickview
sent neither.

`MergedQuickviewBody` now accepts `context_overrides`, `initial_state`,
`profiles` and `tick_seconds`, and threads them to the tick engine. The pins
participate in the preview draft-cache key — two projections differing only by
initial state are different projections, and a shared key would serve one's draft
for the other.

The case-brief disclosures added for C-01/C-02/C-03/C-06 are now **stale** and
should be removed on the next touch.

### 11.3 The rest-spot ceiling no longer strands the driver

Once current drowsiness reached the ceiling, every spot failed its projection —
including one with a zero-minute ETA — so the whole list came back unreachable
and the driver could only decline. The ceiling exists to rule out spots that
cannot be safely *reached*, not to remove the option of resting.

The nearest spot is now kept selectable and flagged `reachable_fallback`. Two
existing tests asserted the old all-unreachable behaviour and were re-aimed at
the new rule rather than weakened.

### 11.4 A case's route now actually applies

Selecting a case showed the wrong route (C-01 running Tokyo–Osaka). Two effects
both owned the selection: the registry loader auto-selected `presets[0]` while
the case effect selected the case's route, both async — so the default could land
last and silently replace the case's. One effect now owns it: the case's route
wins, otherwise the first registry entry.

### 11.5 Results are visible before pressing Play

With no live run and nothing explicitly inspected, the proposal panel now falls
back to the **first projected fire**, so a service and content result is on
screen immediately. The read-only "inspecting" badge stays hidden, because a
default projection is not an inspection.

The map shows the projected trigger and rest positions before playback, sourced
from the same timeline the quickview strip draws — one source, so the two views
cannot disagree. Clicking a trigger marker inspects that fire, exactly as
clicking it on the strip does.

### 11.6 Keyless map is a real schematic

Without a Google key the map was a grey box. It now draws the **same route**:
the preset's encoded polyline decoded in-house (`components/map/polyline.ts`, no
dependency — the SDK decoder is unavailable precisely when it is needed),
projected with longitude scaled by cos(latitude) so the route's shape survives,
with real start/destination names, real total distance, and every marker at its
true route fraction. Markers are placed by cumulative path *distance*, not vertex
index, because the engine's fractions are fractions of distance and polyline
vertices are unevenly spaced.

### 11.7 After-rest status is inert, not deleted

The after-nap dots still render — where the driver stops is journey context worth
seeing — but the centre panel no longer supplies a click handler, so no hit areas
are drawn. The coordinator's after-rest projection is untouched; only the UI
affordance is gone.

### 11.8 Deployment defect found while starting the app

`combined_contracts/` was never mounted into the frontend container, so under
`docker compose` the `@contracts` alias resolved to a non-existent path and the
case picker would have come up empty — the same trap the `proposal_contracts`
mount hit previously. Fixed in `docker-compose.yml`.
