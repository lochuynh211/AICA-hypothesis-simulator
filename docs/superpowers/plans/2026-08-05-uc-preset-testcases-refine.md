# UC Preset Test-Case Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retitle the three approved combined-screen UC cases, add a new oshi-mode case UC-04-01 (derived from C-02), and reorder the picker so the four UC cases lead.

**Architecture:** Combined test cases are static JSON validated against a strict schema; their driver profiles are generated proposal presets. UC-04-01 needs a new standalone preset spec (regenerated + calibrated) and a new case file. The one runtime code change is the picker sort comparator in `app/frontend`, mirrored into the PROTECTED `htmlapp/frontend` copy.

**Tech Stack:** Python 3.12 (preset generation/eval, pytest), TypeScript/React (Vite), JSON contracts.

## Global Constraints

- **No algorithm changes.** Trigger `nri_fatigue_score_v1`, service `aica_transparent_service_selector_v1`, content `aica_transparent_content_selector_v1` — used as configured only, never edited. Copy verbatim into every case's `algorithm_defaults`.
- **App-before-htmlapp edit protocol.** Any frontend/backend runtime change lands in `app/` first for owner review, then is mirrored into `htmlapp/`. **Skip htmlapp parity-fixture regeneration** (owner instruction) — note resulting fixture-test failures rather than chasing them.
- **Presets are generated, never hand-edited.** Source of truth: `scripts/preset_standalones.json` + `scripts/generate_presets.py`. Never edit files under `proposal_contracts/presets/` by hand.
- **Combined test cases carry no expected outcomes** (Phase-1 discipline). The machine-checked `expectation` lives on the proposal preset only.
- **Schema is strict** (`additionalProperties: false`) — no new fields on case JSON; ordering must live in the comparator, not the data.
- **Title style:** situation descriptor + `（persona・demographic）`, e.g. `（Cさん・20代前半女性）`.
- **Frozen catalog:** `soundcharts-grounded-spotify-compatible-demonstration-seed-1042`. Ado = `synthetic-artist-0122`; in-catalog tracks `synthetic-track-0121` (ギラギラ), `-0122` (踊), `-0130` (New Genesis), `-0135` (Show).
- **Local test env (project memory):** Docker/uv unavailable for pytest; use Anaconda Python 3.12.7 with `PYTHONPATH=app/api` and `PYTHONIOENCODING=utf-8`. Docker **is** available for the running app via `docker-start.bat` / `docker-stop.bat`.

---

### Task 1: Retitle the three approved UC cases

Only the `title` field of each JSON changes. No other data. No test asserts title text, so this task's verification is a JSON-parse + string check.

**Files:**
- Modify: `combined_contracts/test_cases/case-uc01-01-oshikatsu-c.json` (title block, lines 5-8)
- Modify: `combined_contracts/test_cases/case-uc01-02-commuter-b.json` (title block, lines 5-8)
- Modify: `combined_contracts/test_cases/case-uc03-01-monotony-a.json` (title block, lines 5-8)

**Interfaces:**
- Produces: three retitled case files; picker labels become self-explanatory. No API/signature change.

- [ ] **Step 1: Edit UC-01-01 title**

In `case-uc01-01-oshikatsu-c.json`, replace the `title` object:

```json
  "title": {
    "ja": "UC-01-01 推し活帰りの隠れ疲労（Cさん・20代前半女性）",
    "en": "UC-01-01 Hidden fatigue after a fan event (Ms. C, early-20s woman)"
  },
```

- [ ] **Step 2: Edit UC-01-02 title**

In `case-uc01-02-commuter-b.json`, replace the `title` object:

```json
  "title": {
    "ja": "UC-01-02 夜間通勤・効率重視の短時間休憩（Bさん・30代前半男性）",
    "en": "UC-01-02 Night commute, an efficient short break (Mr. B, early-30s man)"
  },
```

- [ ] **Step 3: Edit UC-03-01 title**

In `case-uc03-01-monotony-a.json`, replace the `title` object:

```json
  "title": {
    "ja": "UC-03-01（1-1） 日中の渋滞・親子の漫然運転（Aさん・50代後半女性＋娘Cさん）",
    "en": "UC-03-01 (1-1) Daytime jam, mother-daughter monotony (Ms. A, late-50s woman, + daughter C)"
  },
```

- [ ] **Step 4: Verify all three parse and match the schema**

Run:
```bash
PYTHONIOENCODING=utf-8 python -c "
import json,glob,jsonschema
schema=json.load(open('combined_contracts/schema/combined_test_case.schema.json',encoding='utf-8'))
for f in ['case-uc01-01-oshikatsu-c','case-uc01-02-commuter-b','case-uc03-01-monotony-a']:
    d=json.load(open(f'combined_contracts/test_cases/{f}.json',encoding='utf-8'))
    jsonschema.validate(d,schema)
    print(d['case_id'],'OK ->',d['title']['en'])
"
```
Expected: three `OK` lines with the new EN titles; no validation error.

- [ ] **Step 5: Commit**

```bash
git add combined_contracts/test_cases/case-uc01-01-oshikatsu-c.json \
        combined_contracts/test_cases/case-uc01-02-commuter-b.json \
        combined_contracts/test_cases/case-uc03-01-monotony-a.json
git commit -m "feat(combined): retitle UC-01-01/UC-01-02/UC-03-01 cases for clarity"
```

---

### Task 2: Add the UC-04-01 driver preset (standalone spec → generate → calibrate)

Add one standalone spec to `scripts/preset_standalones.json`, regenerate presets, and calibrate `top_fit_min` / `enthusiasm` until UC-04-01 passes its expectation (Ado tops, `must_be_oshi`, `arousal_band: high`). This mirrors the existing UC oshi presets (see `preset-uc01-01-oshikatsu-c`, `preset-genz-now` — the Gen-Z/Ado preset that lands `top_fit` ≈ 0.436 with a single Ado oshi at enthusiasm 1.0 and 4-track history).

**Files:**
- Modify: `scripts/preset_standalones.json` (append one object to the top-level array, after the last UC entry `preset-uc03-01-monotony-a`)
- Generated (do not hand-edit): `proposal_contracts/presets/preset-uc04-01-longhaul-d.json`

**Interfaces:**
- Consumes: `generate_presets.py` `make_preset(...)` (validates the world against the real `World` model — a bad field raises), `preset_eval.py` `evaluate_all()`.
- Produces: preset id `preset-uc04-01-longhaul-d`, referenced by Task 3's case `persona.profile_ref`.

- [ ] **Step 1: Append the UC-04-01 standalone spec**

In `scripts/preset_standalones.json`, append this object as the final array element (add a comma after the current last object). Start `enthusiasm` at `0.7` per design; Step 4 calibrates it up if Ado does not top.

```json
  {
    "preset_id": "preset-uc04-01-longhaul-d",
    "category": "preference",
    "family": "oshi_personalization",
    "contrast_with": null,
    "label": {"en": "UC-04-01 · Long-haul oshi recovery (40s male, Ado)", "ja": "UC-04-01・長距離×推しでの回復（40代男性、Ado）"},
    "brief": {"en": "A man in his 40s on a long night highway drive, oshi mode on with Ado as his in-catalog oshi and history on Ado tracks. On a neutral road, checks that his high-arousal oshi content tops the ranking for post-rest recovery — the oshi-ON contrast to C-02's same night-highway situation.", "ja": "夜間の長距離高速を走る40代の男性。推しモードON、カタログ内の推しはAdoで、Adoの曲に履歴あり。中立の道で、休憩後の回復コンテンツとして高覚醒の推しが上位に来ることを確認します。C-02と同じ夜間高速の状況に対する、推しONの対比です。"},
    "situation": {"drowsiness_level": 40, "fatigue_level": 28, "monotony_level": 40},
    "profile": {
      "oshi_registered": true,
      "oshi_mode": "on",
      "oshi_artists": [
        {"artist_id": "synthetic-artist-0122", "oshi_type": "artist", "enthusiasm": 0.7}
      ],
      "age_band": "40s",
      "gender": "male",
      "genre_affinity_v1_enabled": true,
      "usage_by_genre": {"j-pop": "high"},
      "catalog_item_usage_level": {"synthetic-track-0121": "high", "synthetic-track-0122": "high", "synthetic-track-0135": "high"},
      "content_proposal_acceptance_rate": {"synthetic-track-0121": 95.0, "synthetic-track-0122": 95.0, "synthetic-track-0135": 95.0},
      "content_recovery_rate": {"synthetic-track-0121": 90.0, "synthetic-track-0122": 90.0, "synthetic-track-0135": 90.0}
    },
    "control": {"trigger_purpose": "route_music", "lifecycle_stage": "active_driving_content", "motion_state": "driving"},
    "overrides": null,
    "expectation": {
      "hypothesis": "A man in his 40s, oshi mode on with Ado as his in-catalog oshi and history on Ado tracks. On a neutral road his high-arousal oshi content tops the ranking; must_be_oshi is confirmed true.",
      "expected_top": {"must_be_oshi": true, "arousal_band": "high"},
      "top_fit_min": 0.30,
      "gradient": "none",
      "expected_service": {"top_should_be_in": ["music_playlist", "humming_karaoke", "radio_style"]},
      "override_required": false
    }
  }
```

> **History-track choice:** uses Ado tracks `0121/0122/0135`, deliberately **omitting `0130`** (New Genesis) — `0130` is one of the three "recently-played" demotion tracks in `preset-recently-played-fatigue` (C-02's profile). UC-04-01 sets no `played_items`, so there is no recency penalty here regardless; omitting `0130` from history just keeps the two presets cleanly independent. `0122` (踊) is the same high-arousal track that tops `preset-genz-now` and `preset-oshi-superfan`, so Ado topping here is well-precedented.

- [ ] **Step 2: Regenerate presets**

Run:
```bash
PYTHONIOENCODING=utf-8 PYTHONPATH=app/api python scripts/generate_presets.py
```
Expected: writes `proposal_contracts/presets/preset-uc04-01-longhaul-d.json` (and rewrites the others idempotently). No `World(...)` validation error. If it raises on a bad field, fix the spec and re-run.

- [ ] **Step 3: Confirm the new preset file exists and is well-formed**

Run:
```bash
PYTHONIOENCODING=utf-8 python -c "
import json
p=json.load(open('proposal_contracts/presets/preset-uc04-01-longhaul-d.json',encoding='utf-8'))
print('preset_id:',p['preset_id'])
print('oshi_artists:',p['world']['driver_profile']['oshi_artists'])
print('age_band:',p['world']['driver_profile']['age_band'],'gender:',p['world']['driver_profile']['gender'])
"
```
Expected: `preset-uc04-01-longhaul-d`, one Ado oshi, `age_band: 40s`, `gender: male`.

- [ ] **Step 4: Calibrate against the real content/service selectors**

Run:
```bash
PYTHONIOENCODING=utf-8 PYTHONPATH=app/api python scripts/preset_eval.py 2>&1 | grep -i uc04
```
Read the row for `preset-uc04-01-longhaul-d`. Required outcome: `ok` (no fails), top track credited to Ado, arousal band `high`, and `top_fit >= top_fit_min`.

Calibration loop (iterate Step 1 → Step 2 → Step 4):
- If **Ado does not top** (fails `must_be_oshi`) — raise `enthusiasm` toward `1.0` (the existing UC presets went as high as 0.9; the Gen-Z Ado preset uses 1.0). Re-generate, re-eval.
- If it fails **only** `top_fit {tfit} < top_fit_min` — set `top_fit_min` in the spec to the measured `top_fit`, rounded **down** to 2 decimals (same convention as the other UC presets: UC-01-01 uses 0.33, UC-03-01 uses 0.36). Re-generate, re-eval.
- If the **arousal band** is not `high` — the top Ado track is not high-arousal; that should not happen for `0122`/`0121` (both high). If it does, drop the offending track from history and re-eval.

Record the final measured numbers; they are informational (the harness does not require a `measured` block, but the other specs carry one for reference — add it if matching the existing style).

- [ ] **Step 5: Verify no other preset regressed**

Run:
```bash
PYTHONIOENCODING=utf-8 PYTHONPATH=app/api python scripts/preset_eval.py 2>&1 | tail -5
```
Expected: the summary reports all presets pass (the tool prints a pass/fail tally). If a previously-passing preset now fails, the generation changed something global — investigate before continuing (it should not: the spec only appends).

- [ ] **Step 6: Commit**

```bash
git add scripts/preset_standalones.json proposal_contracts/presets/preset-uc04-01-longhaul-d.json
git commit -m "feat(presets): add preset-uc04-01-longhaul-d (40s male Ado oshi) for UC-04-01"
```

---

### Task 3: Author the UC-04-01 combined case file

Create `case-uc04-01-longhaul-d.json` following the UC-01-01 case shape. Reuses route `long_tokyo_osaka` and scenario `uc01_fatigue_recovery_v0_1` (both already bundled, from C-02). `fixed_overrides` match C-02 exactly so the only meaningful difference is the oshi profile.

**Files:**
- Create: `combined_contracts/test_cases/case-uc04-01-longhaul-d.json`

**Interfaces:**
- Consumes: preset `preset-uc04-01-longhaul-d` (Task 2) via `persona.profile_ref`; comparator ordering (Task 4) references `case_id: case-uc04-01-longhaul-d`.
- Produces: a schema-valid combined case the picker lists.

- [ ] **Step 1: Write the case file**

Create `combined_contracts/test_cases/case-uc04-01-longhaul-d.json`:

```json
{
  "case_id": "case-uc04-01-longhaul-d",
  "schema_version": "1.0.0",
  "version": "1.0.0",
  "title": {
    "ja": "UC-04-01 夜間長距離・注意力低下と推しでの回復（Dさん・40代男性）",
    "en": "UC-04-01 Long night drive, attention decline & oshi recovery (Mr. D, 40s man)"
  },
  "brief": {
    "ja": "深夜の東京→大阪、長距離高速を一人で走るドライバー。出発時から眠気があり、単調な夜間走行で注意力が徐々に低下していきます。その低下から休憩提案が発火するか、休憩後の回復コンテンツが彼の推し（Ado）の高覚醒な曲になるかを確認します。状況はC-02と同じで、違いは推しモードがONであること — コンテンツ側がどう変わるかを対比します。",
    "en": "A driver alone on the long Tokyo→Osaka highway late at night. Drowsy from departure, his attention slips as the monotonous night drive wears on. Checks whether that decline fires a rest proposal, and whether the post-rest recovery content is a high-arousal track by his oshi (Ado). Same situation as C-02; the difference is oshi mode ON — a contrast in how the content side changes."
  },
  "what_to_watch": [
    {"ja": "長距離の夜間走行で注意力が低下し休憩提案が発火するか", "en": "Whether attention declines on the long night drive and a rest proposal fires"},
    {"ja": "休憩後の回復コンテンツが推し（Ado）の高覚醒な曲になるか", "en": "Whether post-rest recovery content is a high-arousal track by his oshi (Ado)"},
    {"ja": "C-02（推しOFF）との対比でコンテンツ側がどう変わるか", "en": "How the content side differs versus C-02 (oshi OFF) in the same situation"}
  ],
  "persona": {
    "persona_id": "persona-longhaul-d",
    "name": {"ja": "夜間長距離のDさん", "en": "Mr. D, on a long night haul"},
    "narrative": {
      "ja": "40代の男性。深夜の高速道路を長時間、一人で運転します。出発時点ですでに眠気があり、単調な夜間走行で注意力が下がりやすいタイプです。一番の推しはAdoで、運転中もAdoのアップテンポなJ-POPを好みます。",
      "en": "A man in his 40s, driving a long stretch of highway alone late at night. Already drowsy at departure, his attention tends to slip on the featureless night drive. His top oshi is Ado, and he likes Ado's up-tempo J-pop even while driving."
    },
    "goals": [
      {"ja": "眠気に負けず安全に長距離を走り切る", "en": "Finish the long haul safely despite drowsiness"},
      {"ja": "少し休んで推しの曲で気分と覚醒を取り戻したい", "en": "Rest a little and recover his mood and alertness with his oshi's music"}
    ],
    "preferences": [
      {"ja": "推し（Ado）のアップテンポな曲を好む", "en": "Prefers up-tempo songs by his oshi (Ado)"}
    ],
    "constraints": [
      {"ja": "深夜のため立ち寄れる場所が限られる", "en": "Few places to stop this late at night"}
    ],
    "assumptions": [
      {"ja": "出発時点で眠気はすでに高い", "en": "Drowsiness is already elevated at departure"},
      {"ja": "走行はすべて夜間帯に行われる", "en": "The whole drive takes place at night"}
    ],
    "profile_ref": "preset-uc04-01-longhaul-d"
  },
  "journey": {
    "narrative": {
      "ja": "深夜、東京から大阪までの長距離ルートを一人で走行します。",
      "en": "A late-night solo drive on the long Tokyo–Osaka route."
    },
    "scenario_ref": "uc01_fatigue_recovery_v0_1",
    "route_preset_ref": "long_tokyo_osaka",
    "seed": 42,
    "tick_seconds": 180,
    "fixed_overrides": {
      "initial_drowsiness": 60,
      "initial_fatigue": 35,
      "is_night": true,
      "child_passenger": false
    },
    "automatic_path": {
      "service_choice": "rank_1",
      "rest_response": "accept",
      "sleep_minutes": 20
    }
  },
  "algorithm_defaults": {
    "trigger": "nri_fatigue_score_v1",
    "service": "aica_transparent_service_selector_v1",
    "content": "aica_transparent_content_selector_v1"
  }
}
```

- [ ] **Step 2: Validate the new case against the schema**

Run:
```bash
PYTHONIOENCODING=utf-8 python -c "
import json,jsonschema
schema=json.load(open('combined_contracts/schema/combined_test_case.schema.json',encoding='utf-8'))
d=json.load(open('combined_contracts/test_cases/case-uc04-01-longhaul-d.json',encoding='utf-8'))
jsonschema.validate(d,schema)
print('valid:',d['case_id'],'->',d['persona']['profile_ref'])
"
```
Expected: `valid: case-uc04-01-longhaul-d -> preset-uc04-01-longhaul-d`.

- [ ] **Step 3: Run the combined-case schema-validation test**

Run:
```bash
PYTHONIOENCODING=utf-8 PYTHONPATH=app/api python -m pytest app/api/tests -k "combined and (schema or case)" -q
```
Expected: PASS. (This is the pytest test that validates every committed combined case against the schema.)

- [ ] **Step 4: Commit**

```bash
git add combined_contracts/test_cases/case-uc04-01-longhaul-d.json
git commit -m "feat(combined): add UC-04-01 long-haul oshi-recovery case"
```

---

### Task 4: Reorder the picker (app first, then htmlapp mirror)

Add an explicit priority list to the sort comparator so the four UC cases lead in the order `UC-01-01 → UC-01-02 → UC-03-01 → UC-04-01`, with all other cases (`C-01…C-06`) below in `case_id` order. Change `app/frontend` first for owner review, then mirror the identical comparator into the PROTECTED htmlapp copy.

**Files:**
- Modify: `app/frontend/src/lib/review/caseCatalog.ts:76-80` (the `CASES` sort)
- Modify: `htmlapp/frontend/src/lib/review/caseCatalog.ts:150-154` (the `cases()` function)
- Test (app): `app/frontend/src/lib/review/__tests__/` (add an ordering test — see Step 1)

**Interfaces:**
- Consumes: `CombinedTestCase.case_id`.
- Produces: `listCases()` returns the four UC cases first in the fixed order; `getCase()` semantics unchanged. Exported signatures unchanged in both files.

- [ ] **Step 1: Write the failing ordering test (app)**

Create `app/frontend/src/lib/review/__tests__/caseCatalog.order.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { listCases } from '../caseCatalog'

describe('listCases ordering', () => {
  it('lists the four UC demo cases first in the fixed sequence', () => {
    const ids = listCases().map((c) => c.case_id)
    const ucOrder = [
      'case-uc01-01-oshikatsu-c',
      'case-uc01-02-commuter-b',
      'case-uc03-01-monotony-a',
      'case-uc04-01-longhaul-d',
    ]
    expect(ids.slice(0, 4)).toEqual(ucOrder)
    // every remaining id sorts after the UC block, in case_id order among themselves
    const rest = ids.slice(4)
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)))
    expect(rest.every((id) => !ucOrder.includes(id))).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
docker compose exec frontend npm test -- caseCatalog.order
```
(If Docker is down for the frontend: `cd app/frontend && npm test -- caseCatalog.order`.)
Expected: FAIL — current order is `case-c01…` first (`'c' < 'u'`), so `ids.slice(0,4)` is the C block, not the UC block.

- [ ] **Step 3: Implement the comparator (app)**

In `app/frontend/src/lib/review/caseCatalog.ts`, replace the `CASES` block (currently lines 76-80):

```ts
// Sorted once at module load — the picker's order must not depend on glob order,
// which is not guaranteed stable across platforms.
const CASES: CombinedTestCase[] = Object.values(MODULES).sort((a, b) =>
  a.case_id.localeCompare(b.case_id),
)
```

with:

```ts
// Picker order: the four UC demo cases lead, in this exact sequence; every
// other case (C-01…C-06) falls below, keeping case_id order among themselves.
// Ordering lives here, not in the case JSON — the schema is strict
// (additionalProperties:false), so an `order` field can't be added, and
// renaming case_ids is destructive (tests, run/feedback logs, htmlapp registry).
const CASE_ORDER = [
  'case-uc01-01-oshikatsu-c',
  'case-uc01-02-commuter-b',
  'case-uc03-01-monotony-a',
  'case-uc04-01-longhaul-d',
]
const orderRank = (id: string): number => {
  const i = CASE_ORDER.indexOf(id)
  return i === -1 ? CASE_ORDER.length : i
}

// Sorted once at module load — the picker's order must not depend on glob order,
// which is not guaranteed stable across platforms.
const CASES: CombinedTestCase[] = Object.values(MODULES).sort(
  (a, b) => orderRank(a.case_id) - orderRank(b.case_id) || a.case_id.localeCompare(b.case_id),
)
```

- [ ] **Step 4: Run the test to verify it passes (app)**

Run:
```bash
docker compose exec frontend npm test -- caseCatalog.order
```
Expected: PASS.

- [ ] **Step 5: Run the existing picker/selection tests (app), no regressions**

Run:
```bash
docker compose exec frontend npm test -- use_case_selection feedback_summary review_case_card
```
Expected: PASS. (These reference `case-c01` by id, not by list position, so reordering does not break them.)

- [ ] **Step 6: Commit the app change (owner-review point)**

```bash
git add app/frontend/src/lib/review/caseCatalog.ts \
        app/frontend/src/lib/review/__tests__/caseCatalog.order.test.ts
git commit -m "feat(review): order picker with the four UC demo cases first"
```

- [ ] **Step 7: Mirror the comparator into the PROTECTED htmlapp copy**

In `htmlapp/frontend/src/lib/review/caseCatalog.ts`, replace the `cases()` function (currently lines 150-154, the body after the long doc comment):

```ts
function cases(): CombinedTestCase[] {
  return (getCombinedCases() as unknown as CombinedTestCase[])
    .slice()
    .sort((a, b) => a.case_id.localeCompare(b.case_id))
}
```

with (same `CASE_ORDER`/`orderRank`, declared just above `cases()`):

```ts
// Picker order: mirror of app/frontend/src/lib/review/caseCatalog.ts — the four
// UC demo cases lead in this exact sequence, every other case falls below in
// case_id order. MUST stay identical to upstream (this file is PROTECTED and
// restored from git on sync; the mirror edit is committed, not synced).
const CASE_ORDER = [
  'case-uc01-01-oshikatsu-c',
  'case-uc01-02-commuter-b',
  'case-uc03-01-monotony-a',
  'case-uc04-01-longhaul-d',
]
const orderRank = (id: string): number => {
  const i = CASE_ORDER.indexOf(id)
  return i === -1 ? CASE_ORDER.length : i
}

function cases(): CombinedTestCase[] {
  return (getCombinedCases() as unknown as CombinedTestCase[])
    .slice()
    .sort((a, b) => orderRank(a.case_id) - orderRank(b.case_id) || a.case_id.localeCompare(b.case_id))
}
```

> Leave the existing module doc comment intact; only the `cases()` body changes and the `CASE_ORDER`/`orderRank` block is added above it.

- [ ] **Step 8: Rebuild the htmlapp data seam so UC-04-01's case + preset are bundled**

The htmlapp reads cases/presets through generated data, not the filesystem. Rebuild it so the new case and preset are present:

```bash
cd htmlapp/frontend && npm run build:data
```
Expected: regenerates the registry data (picks up `case-uc04-01-longhaul-d` and `preset-uc04-01-longhaul-d`). **Do NOT regenerate parity fixtures** (owner instruction).

- [ ] **Step 9: Run htmlapp caseCatalog tests (note, don't chase, fixture failures)**

Run:
```bash
cd htmlapp/frontend && npm test -- caseCatalog
```
Expected: caseCatalog ordering/behavior tests PASS. If any **parity-fixture** test fails, record it in the final report as a deferred regenerate — do not fix it here (owner instruction).

- [ ] **Step 10: Commit the htmlapp mirror + rebuilt data**

```bash
git add htmlapp/frontend/src/lib/review/caseCatalog.ts htmlapp/frontend/src/data
git commit -m "chore(htmlapp): mirror UC-first picker order; rebuild data seam for UC-04-01"
```

---

### Task 5: Bump the backend preset-count guards 38 → 39

Adding one preset trips three hard-coded count assertions. This is standard count maintenance; no production code changes.

**Files:**
- Modify: `app/api/tests/proposal/test_presets_expectations.py:32` (`== 38` → `== 39`)
- Modify: `app/api/tests/proposal/test_ep_presets.py:31` (`== 38` → `== 39`)
- Modify: `app/api/tests/proposal/test_preset_store.py:42` (`== 38` → `== 39`)

**Interfaces:**
- Consumes: the on-disk preset set now numbering 39 (after Task 2).
- Produces: green count guards.

- [ ] **Step 1: Confirm the on-disk preset count is 39**

Run:
```bash
python -c "import glob; print(len(glob.glob('proposal_contracts/presets/preset-*.json')))"
```
Expected: `39`.

- [ ] **Step 2: Edit the three count literals**

In each file, change the `38` in the length assertion to `39` (grep to confirm the exact line first, since line numbers may have drifted):

```bash
grep -rn "== 38" app/api/tests/proposal/test_presets_expectations.py app/api/tests/proposal/test_ep_presets.py app/api/tests/proposal/test_preset_store.py
```
Then edit each matched `== 38` to `== 39`.

- [ ] **Step 3: Run the three count tests**

Run:
```bash
PYTHONIOENCODING=utf-8 PYTHONPATH=app/api python -m pytest \
  app/api/tests/proposal/test_presets_expectations.py \
  app/api/tests/proposal/test_ep_presets.py \
  app/api/tests/proposal/test_preset_store.py -q
```
Expected: PASS. `_EXPECTED_PRESET_IDS` needs no edit (filesystem glob auto-expands); `test_contrast_pairs_declared` stays valid (`contrast_with: null`).

- [ ] **Step 4: Commit**

```bash
git add app/api/tests/proposal/test_presets_expectations.py \
        app/api/tests/proposal/test_ep_presets.py \
        app/api/tests/proposal/test_preset_store.py
git commit -m "test(presets): bump preset-count guards 38->39 for UC-04-01"
```

---

### Task 6: Full verification pass

Run the relevant backend + frontend suites and a Docker app smoke test. Baseline caveat (project memory): the full backend suite has ~26 PRE-EXISTING failures (cp932, schema drift, in-flight trigger-dedup) — do **not** treat those as introduced here; scope assertions to the preset/combined tests this work touches.

**Files:** none (verification only).

- [ ] **Step 1: Backend — preset + combined suites**

Run:
```bash
PYTHONIOENCODING=utf-8 PYTHONPATH=app/api python -m pytest \
  app/api/tests/proposal -q \
  && PYTHONIOENCODING=utf-8 PYTHONPATH=app/api python -m pytest app/api/tests -k combined -q
```
Expected: the preset-generation golden test, count guards, expectations, and combined-schema tests PASS. Compare any failure against the known-baseline list before flagging it as new.

- [ ] **Step 2: Frontend — review suite (app)**

Run:
```bash
docker compose exec frontend npm test -- caseCatalog use_case_selection feedback_summary review_case_card
```
Expected: PASS.

- [ ] **Step 3: Docker app smoke test**

Run `docker-start.bat`, open `http://localhost:5180`, go to the combined screen. Confirm:
- Picker order is `UC-01-01 → UC-01-02 → UC-03-01 → UC-04-01 → C-01…C-06`.
- The four retitled labels render correctly in both JA and EN.
- Selecting UC-04-01 runs: a rest proposal fires on the long night drive, and post-rest recovery content is an Ado track — visibly contrasting C-02 (oshi OFF, same situation).

Capture screenshots (picker list JA + EN; UC-04-01 recovery content; C-02 for contrast). Then `docker-stop.bat`.

- [ ] **Step 4: Final report**

Summarize: files changed, final calibrated `top_fit_min`/`enthusiasm` for UC-04-01, test results (with any pre-existing-baseline failures called out as such), any deferred htmlapp parity-fixture failures, and screenshot paths. No commit.

---

## Self-Review notes

- **Spec coverage:** Retitle (Task 1) ✓; UC-04-01 preset (Task 2) + case (Task 3) ✓; ordering app+htmlapp (Task 4) ✓; backend counts (Task 5) ✓; verification incl. Docker screenshots (Task 6) ✓. All design §3–§7 items map to a task.
- **Type consistency:** `CASE_ORDER`/`orderRank` identical in both `caseCatalog.ts` files; comparator `orderRank(a.case_id) - orderRank(b.case_id) || a.case_id.localeCompare(b.case_id)` identical. `preset_id`/`profile_ref` string `preset-uc04-01-longhaul-d` consistent across Tasks 2–3. `case_id` `case-uc04-01-longhaul-d` consistent across Tasks 3–4.
- **Constraint check:** no algorithm files touched; presets regenerated not hand-edited; app-before-htmlapp order preserved; htmlapp parity-fixture regeneration explicitly skipped; strict schema respected (ordering in comparator, not JSON).
