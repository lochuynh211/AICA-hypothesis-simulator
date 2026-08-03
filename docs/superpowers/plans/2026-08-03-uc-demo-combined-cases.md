# UC Demo Combined Test Cases — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author 3 customer-demo combined test cases (`case-uc01-01-oshikatsu-c`, `case-uc01-02-commuter-b`, `case-uc03-01-monotony-a`) derived from 3 provided UC texts, alongside the existing 6, by adding only data artifacts (3 route presets, 3 proposal presets, 3 combined-case JSONs) plus 3 pre-authorized backend test-count edits — verified green in the test suite and in the running app.

**Architecture:** The combined screen auto-loads `combined_contracts/test_cases/case-*.json` via `import.meta.glob`. Each case ties a `persona.profile_ref` (→ a committed proposal preset's `driver_profile`, resolved by `getPreset()`), a `journey` (`scenario_ref` + `route_preset_ref` + `seed` + `tick_seconds` + `fixed_overrides` + `automatic_path`), and `algorithm_defaults` (trigger/service/content package ids). No case carries expected outcomes (Phase-1 discipline). The simulated drive length is fixed by the **scenario** (`total_duration_seconds: 7200` = 120 min / 40 ticks at `tick_seconds:180`), not the real route; the route preset supplies distance/geography for the progress→km mapping and any painted band. Proposal presets are generated (never hand-edited) from `scripts/preset_standalones.json` via `scripts/generate_presets.py`; route presets are extracted once from Google Maps via `scripts/extract_route_presets.py`.

**Tech Stack:** Python 3.12 (FastAPI backend, pydantic 2.8.2), pytest, TypeScript/React (Vite) frontend, JSON data files, Google Maps Directions/Places (BYO-key). Local test runner: Anaconda Python 3.12.7 at `/c/Users/l-huynh/AppData/Local/anaconda3/python.exe` with `PYTHONPATH=app/api` (Docker/uv unavailable for pytest here). App verification: Docker via `docker-start.bat` / `docker-stop.bat`.

## Global Constraints

Copied verbatim from the approved design spec (`docs/superpowers/specs/2026-08-03-uc-demo-combined-cases-design.md` §2), plus schema facts verified during planning. Every task's requirements implicitly include this section.

- **No algorithm changes.** Trigger (`nri_fatigue_score_v1`, `aica_transparent_hybrid_trigger_v1`), service (`aica_transparent_service_selector_v1`), content (`aica_transparent_content_selector_v1`) are used only as configured per-case (`algorithm_defaults`) and to calibrate inputs — never edited.
- **No app frontend/backend runtime code changes on `develop`.** New profiles are authored as **data specs** for the existing generator; new routes/cases are data files. The sole exception, pre-authorized, is the preset **count** assertions in 3 test files (Task 3).
- **BYO Google Maps key.** The key in `app/frontend/.env.local` is passed to the extraction script as a positional CLI argument only. It is never persisted, logged, printed, committed, or written into any output artifact.
- **Phase-1 discipline.** Combined test cases carry **no expected outcomes**. The underlying *proposal presets* do carry a machine-checked `expectation` contract — a separate artifact (Task 2).
- **Boundary-binned / qualitative trigger discipline** and **backend as source of truth** are unaffected — we only add inputs.
- **Case ids** match `^case-[a-z0-9-]+$`. **`schema_version` const `"1.0.0"`.** Every bilingual field is exactly `{ja, en}` (both non-empty; `ja != en` for title/brief/persona.narrative). `persona` requires `[persona_id, name, narrative, profile_ref]`; `journey` requires `[narrative, scenario_ref, route_preset_ref, seed, tick_seconds]`; `algorithm_defaults` requires `[trigger, service, content]`.
- **`automatic_path` enums (verified):** `service_choice ∈ {"rank_1"}`; `rest_response ∈ {"accept","decline","ignore"}` (there is **no** `"acknowledge"` — a monotony case sets only `service_choice`); `sleep_minutes` is `integer ≥ 0`.
- **`fixed_overrides` allowed keys only** (`additionalProperties:false`): `initial_drowsiness`, `initial_fatigue` (0–100), `is_night`, `child_passenger`, `multiple_passengers` (bool), `route_tags`, `destination_tags` (string[]), `mountain_range_km`, `jam_range_km` (2-number arrays).
- **Work on branch `develop`.** htmlapp changes are **documentation-only** here (Task 7); branch `026-htmlapp-combined-export` consumes them later.

---

## File Structure

**Created (data artifacts):**
- `routes/presets/uc01_01_minatomirai_odawara.json` — extracted Minatomirai→Odawara route (Task 1)
- `routes/presets/uc01_02_nagoya_inuyama.json` — extracted Nagoya→Inuyama route (Task 1)
- `routes/presets/uc03_01_funabashi_makuhari.json` — extracted Funabashi→Makuhari route (Task 1)
- `proposal_contracts/presets/preset-uc01-01-oshikatsu-c.json` — generated (Task 2)
- `proposal_contracts/presets/preset-uc01-02-commuter-b.json` — generated (Task 2)
- `proposal_contracts/presets/preset-uc03-01-monotony-a.json` — generated (Task 2)
- `combined_contracts/test_cases/case-uc01-01-oshikatsu-c.json` — combined case (Task 4)
- `combined_contracts/test_cases/case-uc01-02-commuter-b.json` — combined case (Task 4)
- `combined_contracts/test_cases/case-uc03-01-monotony-a.json` — combined case (Task 4)

**Modified (source-of-truth specs + authorized test edits):**
- `scripts/extract_route_presets.py` — append 3 entries to `ROUTES` (Task 1)
- `scripts/preset_standalones.json` — append 3 spec entries (Task 2)
- `app/api/tests/proposal/test_presets_expectations.py:32` — `35` → `38` (Task 3)
- `app/api/tests/proposal/test_ep_presets.py:31` — `35` → `38` (Task 3)
- `app/api/tests/proposal/test_preset_store.py:42` — `35` → `38` (Task 3)

**Documentation:**
- `docs/superpowers/specs/2026-08-03-uc-demo-combined-cases-design.md` §11 — finalize htmlapp increment with concrete artifact names (Task 7)

**Read-only (never edited):** the 4 algorithm packages under `packages/`; `scripts/generate_presets.py`; `scripts/preset_eval.py`; `combined_contracts/schema/combined_test_case.schema.json`; `scenarios/*.json`; all app runtime code.

**The three existing routes (`long_tokyo_osaka`, `middle_tokyo_karuizawa`, `short_tokyo_chichibu`) must stay byte-identical** — the extraction re-hits the API for all `ROUTES`, so Task 1 reverts them after the run.

---

## Environment & command cheatsheet

```bash
# Repo root
cd /c/Users/l-huynh/Desktop/AICA-hypothesis-simulator

# Python (tests + generators). Anaconda 3.12.7; PYTHONPATH=app/api.
PY=/c/Users/l-huynh/AppData/Local/anaconda3/python.exe

# Run a backend test locally:
PYTHONPATH=app/api "$PY" -m pytest app/api/tests/proposal/test_ep_presets.py -q

# Regenerate proposal presets (generate_presets.py self-inserts app/api into sys.path):
"$PY" scripts/generate_presets.py

# Headless preset calibration (glob preset-*.json, evaluate against real selectors):
PYTHONPATH=app/api "$PY" -c "
import sys; sys.path.insert(0,'scripts')
import preset_eval as PE
r = PE.evaluate_all()
for pid in ['preset-uc01-01-oshikatsu-c','preset-uc01-02-commuter-b','preset-uc03-01-monotony-a']:
    x=r[pid]; print(pid,'ok=',x['ok'],'top=',x['top_name'],'fit=',x['top_fit'],'svc=',x['service_top'],'fails=',x['fails'])
"
```

Concrete catalog ids used below (verified against the frozen dataset `soundcharts-grounded-spotify-compatible-demonstration-seed-1042`): Mrs. GREEN APPLE `synthetic-artist-0120` (tracks `0117/0129/0133/0134`), Aimyon `synthetic-artist-0176`, Seiko Matsuda `synthetic-artist-0136` (tracks `0148/0149/0150`, as used by the existing `preset-showa-nostalgia`).

---

## Task 1: Extract the 3 UC route presets

**Files:**
- Modify: `scripts/extract_route_presets.py` (append to `ROUTES`, lines 30–52)
- Create: `routes/presets/uc01_01_minatomirai_odawara.json`, `routes/presets/uc01_02_nagoya_inuyama.json`, `routes/presets/uc03_01_funabashi_makuhari.json`
- Test (existing): `app/api/tests/test_combined_case_contract.py::test_every_referenced_artifact_exists` (needs these files present; runs green only after Task 4 references them)

**Interfaces:**
- Produces: three `routes/presets/<id>.json` files, each with `raw_route.distance_m` (int, metres) and `raw_route.duration_s`, `label.{ja,en}`, `route_source:"maps"`, `places[]` — the shape `routers/route_presets.py::load_route_preset` and `test_combined_case_integration.py::_route_total_km` read.

- [ ] **Step 1: Append the 3 route definitions to `ROUTES`**

In `scripts/extract_route_presets.py`, insert these 3 entries into the `ROUTES` list (after the existing `short_tokyo_chichibu` entry, before the closing `]` on line 52):

```python
    {
        "id": "uc01_01_minatomirai_odawara",
        "label": {"ja": "みなとみらい→小田原（UC-01-01）", "en": "Minatomirai → Odawara (UC-01-01)"},
        "start": "みなとみらい駅 神奈川県横浜市西区みなとみらい3-5",
        "end": "小田原城 神奈川県小田原市城内",
        "avoid": None,
    },
    {
        "id": "uc01_02_nagoya_inuyama",
        "label": {"ja": "名古屋→犬山（UC-01-02）", "en": "Nagoya → Inuyama (UC-01-02)"},
        "start": "ミッドランドスクエア 愛知県名古屋市中村区名駅4-7-1",
        "end": "犬山駅 愛知県犬山市犬山西古券",
        "avoid": None,
    },
    {
        "id": "uc03_01_funabashi_makuhari",
        "label": {"ja": "ららぽーとTOKYO-BAY→海浜幕張（UC-03-01）", "en": "LaLaport TOKYO-BAY → Kaihin-Makuhari (UC-03-01)"},
        "start": "ららぽーとTOKYO-BAY 千葉県船橋市浜町2-1-1",
        "end": "海浜幕張駅 千葉県千葉市美浜区ひび野1-3",
        "avoid": None,
    },
```

- [ ] **Step 2: Read the key from `.env.local` and run extraction without echoing it**

Run exactly (the key is captured into a shell var, passed as `argv[1]`, then unset — never printed):

```bash
KEY="$(sed -n 's/^VITE_GOOGLE_MAPS_KEY=//p' app/frontend/.env.local | tr -d '"'\''\r')"
/c/Users/l-huynh/AppData/Local/anaconda3/python.exe scripts/extract_route_presets.py "$KEY"
unset KEY
```

Expected: console prints each route's summary/distance/duration and `Saved: routes/presets/<id>.json` for all 6 routes. If any new route prints `SKIPPED (no routes returned)` or an unexpected city, adjust that entry's `start`/`end` string in Step 1 and re-run.

- [ ] **Step 3: Revert the 3 pre-existing routes to keep them byte-stable**

The run re-wrote all 6 files. Restore the 3 originals:

```bash
git checkout -- routes/presets/long_tokyo_osaka.json routes/presets/middle_tokyo_karuizawa.json routes/presets/short_tokyo_chichibu.json
git status --short routes/presets/
```

Expected: `git status` shows only the 3 new files as untracked; the 3 existing files are unmodified.

- [ ] **Step 4: Verify the extracted shape and record real distances**

```bash
/c/Users/l-huynh/AppData/Local/anaconda3/python.exe -c "
import json, pathlib
for i in ['uc01_01_minatomirai_odawara','uc01_02_nagoya_inuyama','uc03_01_funabashi_makuhari']:
    d=json.loads(pathlib.Path('routes/presets/%s.json'%i).read_text(encoding='utf-8'))
    rr=d['raw_route']; print(i, 'km=%.1f'%(rr['distance_m']/1000), 'min=%.0f'%(rr['duration_s']/60), 'start=',d['start'][:16])
"
```

Expected: three lines, each with a positive `km`. **Record each `km`** — Task 4 uses it to size `jam_range_km` for UC-03-01 (band start must be `< observed_km`, band end `≤ observed_km`).

- [ ] **Step 5: Commit**

```bash
git add scripts/extract_route_presets.py routes/presets/uc01_01_minatomirai_odawara.json routes/presets/uc01_02_nagoya_inuyama.json routes/presets/uc03_01_funabashi_makuhari.json
git commit -m "feat(routes): add 3 UC demo route presets (Minatomirai→Odawara, Nagoya→Inuyama, Funabashi→Makuhari)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Author, generate, and calibrate the 3 proposal presets

**Files:**
- Modify: `scripts/preset_standalones.json` (append 3 entries to the top-level JSON array)
- Create (generated, do not hand-edit): `proposal_contracts/presets/preset-uc01-01-oshikatsu-c.json`, `…/preset-uc01-02-commuter-b.json`, `…/preset-uc03-01-monotony-a.json`
- Test (existing): `app/api/tests/proposal/test_preset_generation.py` (golden — re-pins on regenerate), `test_presets_expectations.py` (asserts each preset's `expectation` passes `preset_eval`)

**Interfaces:**
- Consumes: `make_preset()` in `scripts/generate_presets.py` — reads each entry's `preset_id, category, family, contrast_with, label, brief, situation, profile, control, overrides, expectation` and validates `World(**world)`.
- Produces: 3 committed preset JSONs whose `world.driver_profile` is what Task 4's combined cases resolve via `profile_ref`.

Each entry's `situation`/`profile`/`control` are **partial overrides** on the generator's neutral base (mirrors `preset-showa-nostalgia`: content-eval situation `drowsiness 40 / fatigue 28 / monotony 40`, control `trigger_purpose:"route_music"`, `lifecycle_stage:"active_driving_content"`, `motion_state:"driving"`). `contrast_with:null` keeps the "exactly 4 contrast pairs" test at 4.

- [ ] **Step 1: Append the 3 spec entries to `scripts/preset_standalones.json`**

Add these 3 objects to the JSON array (the file is a top-level `[ ... ]` of standalone specs):

```json
{
  "preset_id": "preset-uc01-01-oshikatsu-c",
  "category": "preference",
  "family": "oshi_personalization",
  "contrast_with": null,
  "label": {"en": "UC-01-01 · Oshi-katsu (20s, Mrs. GREEN APPLE + Aimyon)", "ja": "UC-01-01・推し活（20代、Mrs. GREEN APPLE＋あいみょん）"},
  "brief": {"en": "A woman in her early 20s deep in fan activities, with two in-catalog oshi (Mrs. GREEN APPLE 0.6, Aimyon 0.3) and history on Mrs. GREEN APPLE tracks. On a neutral road, checks that her oshi content tops the ranking for post-rest recovery.", "ja": "推し活に熱心な20代前半の女性。カタログ内の推しはMrs. GREEN APPLE（0.6）とあいみょん（0.3）で、Mrs. GREEN APPLEの曲に履歴あり。中立の道で、休憩後の回復コンテンツとして推しが上位に来ることを確認します。"},
  "situation": {"drowsiness_level": 40, "fatigue_level": 28, "monotony_level": 40},
  "profile": {
    "oshi_registered": true,
    "oshi_mode": "on",
    "oshi_artists": [
      {"artist_id": "synthetic-artist-0120", "oshi_type": "artist", "enthusiasm": 0.6},
      {"artist_id": "synthetic-artist-0176", "oshi_type": "artist", "enthusiasm": 0.3}
    ],
    "age_band": "20s",
    "gender": "female",
    "genre_affinity_v1_enabled": true,
    "usage_by_genre": {"j-pop": "high"},
    "catalog_item_usage_level": {"synthetic-track-0117": "high", "synthetic-track-0129": "high", "synthetic-track-0133": "high", "synthetic-track-0134": "high"},
    "content_proposal_acceptance_rate": {"synthetic-track-0117": 95.0, "synthetic-track-0129": 95.0, "synthetic-track-0133": 95.0, "synthetic-track-0134": 95.0},
    "content_recovery_rate": {"synthetic-track-0117": 90.0, "synthetic-track-0129": 90.0, "synthetic-track-0133": 90.0, "synthetic-track-0134": 90.0}
  },
  "control": {"trigger_purpose": "route_music", "lifecycle_stage": "active_driving_content", "motion_state": "driving"},
  "overrides": null,
  "expectation": {
    "hypothesis": "A woman in her early 20s with Mrs. GREEN APPLE (0.6) and Aimyon (0.3) as in-catalog oshi and strong history on Mrs. GREEN APPLE tracks. On a neutral road her oshi content should top the ranking.",
    "expected_top": {"must_be_oshi": true},
    "top_fit_min": 0.30,
    "gradient": "none",
    "expected_service": {"top_should_be_in": ["music_playlist", "humming_karaoke", "radio_style"]},
    "override_required": false
  }
},
{
  "preset_id": "preset-uc01-02-commuter-b",
  "category": "preference",
  "family": "oshi_personalization",
  "contrast_with": null,
  "label": {"en": "UC-01-02 · Efficiency commuter (30s, no oshi)", "ja": "UC-01-02・効率重視の通勤（30代、推しなし）"},
  "brief": {"en": "A man in his early 30s with oshi mode off and no registered oshi, j-pop as his main genre. On a neutral road, checks that a general j-pop track (not an oshi) tops and a low-burden service is offered.", "ja": "推しモードオフ・登録推しなしの30代前半の男性。主なジャンルはj-pop。中立の道で、推しではない一般的なj-popの曲が上位に来て、低負担のサービスが提案されることを確認します。"},
  "situation": {"drowsiness_level": 40, "fatigue_level": 28, "monotony_level": 40},
  "profile": {
    "oshi_registered": false,
    "oshi_mode": "off",
    "oshi_artists": [],
    "age_band": "30s",
    "gender": "male",
    "genre_affinity_v1_enabled": true,
    "usage_by_genre": {"j-pop": "high"}
  },
  "control": {"trigger_purpose": "route_music", "lifecycle_stage": "active_driving_content", "motion_state": "driving"},
  "overrides": null,
  "expectation": {
    "hypothesis": "A man in his early 30s, oshi mode off, no registered oshi, j-pop main genre. On a neutral road a general j-pop track (not an oshi) tops the ranking.",
    "expected_top": {"must_be_oshi": false},
    "top_fit_min": 0.10,
    "gradient": "none",
    "expected_service": {"top_should_be_in": ["music_playlist", "humming_karaoke", "radio_style"]},
    "override_required": false
  }
},
{
  "preset_id": "preset-uc03-01-monotony-a",
  "category": "preference",
  "family": "oshi_personalization",
  "contrast_with": null,
  "label": {"en": "UC-03-01 · Monotony oshi (50s, Seiko Matsuda)", "ja": "UC-03-01・単調×推し（50代、松田聖子）"},
  "brief": {"en": "A woman in her late 50s whose in-catalog oshi is Seiko Matsuda (enthusiasm 0.5), with history on Seiko tracks, j-pop main genre, and no hierarchy-weight override. On a neutral road, checks what content tops for a mother-daughter drive.", "ja": "カタログ内の推しが松田聖子（熱狂度0.5）の50代後半の女性。松田聖子の曲に履歴あり、主ジャンルはj-pop、重みのオーバーライドなし。中立の道で、母娘ドライブ向けにどのコンテンツが上位に来るかを確認します。"},
  "situation": {"drowsiness_level": 40, "fatigue_level": 28, "monotony_level": 40},
  "profile": {
    "oshi_registered": true,
    "oshi_mode": "on",
    "oshi_artists": [{"artist_id": "synthetic-artist-0136", "oshi_type": "artist", "enthusiasm": 0.5}],
    "age_band": "50s",
    "gender": "female",
    "genre_affinity_v1_enabled": true,
    "usage_by_genre": {"j-pop": "high"},
    "catalog_item_usage_level": {"synthetic-track-0148": "high", "synthetic-track-0149": "high", "synthetic-track-0150": "high"},
    "content_proposal_acceptance_rate": {"synthetic-track-0148": 95.0, "synthetic-track-0149": 95.0, "synthetic-track-0150": 95.0},
    "content_recovery_rate": {"synthetic-track-0148": 90.0, "synthetic-track-0149": 90.0, "synthetic-track-0150": 90.0}
  },
  "control": {"trigger_purpose": "route_music", "lifecycle_stage": "active_driving_content", "motion_state": "driving"},
  "overrides": null,
  "expectation": {
    "hypothesis": "A woman in her late 50s with Seiko Matsuda as her in-catalog oshi at enthusiasm 0.5 and history on Seiko tracks, no hierarchy override. On a neutral road either a Seiko track or a general j-pop track may top; the expectation is calibrated to the observed top.",
    "expected_top": {"must_be_oshi": false},
    "top_fit_min": 0.10,
    "gradient": "none",
    "expected_service": {"top_should_be_in": ["music_playlist", "humming_karaoke", "radio_style"]},
    "override_required": false
  }
}
```

- [ ] **Step 2: Regenerate the committed presets**

```bash
/c/Users/l-huynh/AppData/Local/anaconda3/python.exe scripts/generate_presets.py
```

Expected: prints `wrote 38 presets to …/proposal_contracts/presets` and lists the 3 new `preset-uc01-…`/`preset-uc03-…` filenames. If `World(**world)` raises, a `profile`/`situation` key is invalid — fix the spec entry and re-run.

- [ ] **Step 3: Calibrate each expectation against the real selectors**

Run the headless calibration command (see cheatsheet). For each preset, read `top` / `top_fit` / `svc` / `fails`, then adjust the entry in `preset_standalones.json` and re-run Steps 2–3 until `ok= True` for all three:
- Set `top_fit_min` to **just below** the observed `top_fit` (e.g. observed `0.41` → `top_fit_min: 0.40`).
- **UC-01-01:** confirm `top` is a Mrs. GREEN APPLE track and `must_be_oshi:true` holds. If a non-oshi track tops, raise the oshi enthusiasm toward its text value is NOT allowed (fixed by §3); instead confirm the history tracks (`0117/0129/0133/0134`) are Mrs. GREEN APPLE's — if `top_name` shows a different artist, correct the track ids and re-run.
- **UC-01-02:** confirm `must_be_oshi:false` and `svc` ∈ the expected service set.
- **UC-03-01:** if `top` is a Seiko track, flip `expected_top` to `{"must_be_oshi": true, "arousal_band": "mid"}`; otherwise keep `{"must_be_oshi": false}`. Either is a truthful contract — do **not** add an `algorithm_config_overrides` block (design §5: this preset omits the era/age override).

Expected end state: `ok= True` for all three.

- [ ] **Step 4: Run the preset backend tests (expect the 3 count tests to FAIL here)**

```bash
PYTHONPATH=app/api /c/Users/l-huynh/AppData/Local/anaconda3/python.exe -m pytest app/api/tests/proposal/test_preset_generation.py app/api/tests/proposal/test_presets_expectations.py -q
```

Expected: `test_preset_generation` PASS (golden re-pinned); `test_presets_expectations` PASS for the 3 new presets **except** its `assert len(_PRESETS) == 35` which now FAILS at 38 — that literal is bumped in Task 3. This is the expected red state that Task 3 turns green.

- [ ] **Step 5: Commit**

```bash
git add scripts/preset_standalones.json proposal_contracts/presets/preset-uc01-01-oshikatsu-c.json proposal_contracts/presets/preset-uc01-02-commuter-b.json proposal_contracts/presets/preset-uc03-01-monotony-a.json
git commit -m "feat(presets): add 3 UC demo proposal presets (oshi-katsu, commuter, monotony)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Bump the 3 authorized preset-count assertions (35 → 38)

**Files:**
- Modify: `app/api/tests/proposal/test_presets_expectations.py:32`
- Modify: `app/api/tests/proposal/test_ep_presets.py:31`
- Modify: `app/api/tests/proposal/test_preset_store.py:42`

**Interfaces:** none produced; this only updates hard-coded counts. `_EXPECTED_PRESET_IDS` in `test_ep_presets.py:18` and `test_preset_store.py:25` is a filesystem glob that auto-expands — **do not edit it**. `test_contrast_pairs_declared` (`== 4`) and the hard-coded strong-fit set (`test_presets_expectations.py:76-79`) stay unchanged (new presets set `contrast_with:null` and are not added to the strong-fit set).

- [ ] **Step 1: Verify the current red state**

```bash
PYTHONPATH=app/api /c/Users/l-huynh/AppData/Local/anaconda3/python.exe -m pytest app/api/tests/proposal/test_presets_expectations.py app/api/tests/proposal/test_ep_presets.py app/api/tests/proposal/test_preset_store.py -q -k "count or len or presets"
```

Expected: the three count assertions FAIL with `assert 38 == 35`.

- [ ] **Step 2: Edit the three literals**

`test_presets_expectations.py:32`:
```python
    assert len(_PRESETS) == 38, sorted(_PRESETS)
```
`test_ep_presets.py:31`:
```python
    assert len(presets) == 38
```
`test_preset_store.py:42`:
```python
    assert len(summaries) == 38
```

- [ ] **Step 3: Run the three files green**

```bash
PYTHONPATH=app/api /c/Users/l-huynh/AppData/Local/anaconda3/python.exe -m pytest app/api/tests/proposal/test_presets_expectations.py app/api/tests/proposal/test_ep_presets.py app/api/tests/proposal/test_preset_store.py -q
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add app/api/tests/proposal/test_presets_expectations.py app/api/tests/proposal/test_ep_presets.py app/api/tests/proposal/test_preset_store.py
git commit -m "test(presets): bump committed preset count 35->38 for 3 UC demo presets

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Author the 3 combined test-case files

**Files:**
- Create: `combined_contracts/test_cases/case-uc01-01-oshikatsu-c.json`, `…/case-uc01-02-commuter-b.json`, `…/case-uc03-01-monotony-a.json`
- Test (existing, auto-parametrized over every `case-*.json`): `app/api/tests/test_combined_case_contract.py`, `app/api/tests/test_combined_case_integration.py`, `app/frontend/tests/merged_setup_two_tier.test.tsx`

**Interfaces:**
- Consumes: the 3 route presets (Task 1), the 3 proposal presets (Task 2), scenarios `uc01_fatigue_recovery_v0_1` / `uc02_monotony_v0_1`, and the 4 algorithm packages — all must exist for `test_every_referenced_artifact_exists` and the live `POST /api/merged-runs/quickview`.
- Produces: 3 committed cases the combined screen auto-loads.

**Integration-test constraints these files must satisfy (verified in `test_combined_case_integration.py`):**
1. `result["error"] is None` — no algorithm error.
2. `result["fired"] is True` and at least one fire in `{rest_required, monotony_prevention}`, whose `feature_contributions` has **both** categories with non-empty rows (the merged runner records both regardless of trigger — confirmed for NRI cases c01–c03).
3. If a case paints `mountain_range_km`/`jam_range_km`, the first in-scope fire's km ≥ `band[0]`. **Do not paint a mid-route band on an early-firing fatigue case.**
4. `test_case_c01_is_a_comparison_baseline`: among cases sharing c01's scenario (`uc01_fatigue_recovery_v0_1`), c01 must stay the **mildest** — latest first fire, lowest peak, fewest fires. Both new UC-01 cases join this set, so each must fire **earlier**, with a **higher** peak, and **≥ as many** in-scope fires as c01 (currently first-fire 48 min / peak 0.814 / 2 fires). Their aggressive `initial_*` values ensure this; Task 5 verifies and gives the calibration lever.

- [ ] **Step 1: Write `case-uc01-01-oshikatsu-c.json`**

```json
{
  "case_id": "case-uc01-01-oshikatsu-c",
  "schema_version": "1.0.0",
  "version": "1.0.0",
  "title": {
    "ja": "UC-01-01 Cさん（20代前半女性）",
    "en": "UC-01-01 Ms. C (woman, early 20s)"
  },
  "brief": {
    "ja": "推し活で寝不足のまま、みなとみらいから小田原へ土曜夕方の帰路を走ります。本人は「まだいける」と感じていますが、疲労と眠気が水面下で蓄積しています。自覚の薄い高疲労が休憩提案を発火させるか、回復コンテンツが彼女の推し（Mrs. GREEN APPLE）になるかを確認します。",
    "en": "Sleep-deprived from her fandom activities, she drives home from Minatomirai to Odawara on a Saturday evening. She feels 'still fine', but fatigue and drowsiness build under the surface. Checks whether hidden high fatigue fires a rest proposal despite low self-awareness, and whether the recovery content is her oshi (Mrs. GREEN APPLE)."
  },
  "what_to_watch": [
    {"ja": "自覚の薄い高疲労が休憩提案を発火させるか", "en": "Whether hidden high fatigue fires a rest proposal despite low self-awareness"},
    {"ja": "休憩後の回復コンテンツが推し（Mrs. GREEN APPLE）になるか", "en": "Whether post-rest recovery content is her oshi (Mrs. GREEN APPLE)"},
    {"ja": "仮眠を促す低負担の休憩が選ばれるか", "en": "Whether a low-burden break that invites a nap is chosen"}
  ],
  "persona": {
    "persona_id": "persona-oshikatsu-c",
    "name": {"ja": "推し活帰りのCさん", "en": "Ms. C, heading home from a fan event"},
    "narrative": {
      "ja": "20代前半の女性。推し活（イベント遠征）で寝不足のまま運転しています。一番の推しはSnow Man、続いてMrs. GREEN APPLE、あいみょん。疲れていても「まだいける」と感じやすく、疲労と眠気の自覚が薄いタイプです。",
      "en": "A woman in her early 20s, driving on little sleep after a fan event. Her top oshi is Snow Man, then Mrs. GREEN APPLE and Aimyon. She tends to feel 'still fine' even when tired, with low awareness of her own fatigue and drowsiness."
    },
    "goals": [
      {"ja": "無理なく安全に帰宅する", "en": "Get home safely without pushing herself"},
      {"ja": "少し休んで推しの曲で気分を回復したい", "en": "Rest a little and recover her mood with her oshi's music"}
    ],
    "preferences": [
      {"ja": "推し（Snow Man / Mrs. GREEN APPLE / あいみょん）の曲を好む", "en": "Prefers songs by her oshi (Snow Man / Mrs. GREEN APPLE / Aimyon)"}
    ],
    "constraints": [
      {"ja": "眠気の自覚が薄く、自分からは休憩を取りにくい", "en": "Low awareness of drowsiness; unlikely to take a break on her own"}
    ],
    "assumptions": [
      {"ja": "出発時点で疲労・眠気はすでに水面下で高い", "en": "Fatigue and drowsiness are already elevated under the surface at departure"}
    ],
    "profile_ref": "preset-uc01-01-oshikatsu-c"
  },
  "journey": {
    "narrative": {
      "ja": "土曜夕方、みなとみらいから小田原の自宅までを走行します。横羽線の一部で渋滞が発生します。",
      "en": "A Saturday-evening drive from Minatomirai to home in Odawara, with congestion on part of the Yokohane route."
    },
    "scenario_ref": "uc01_fatigue_recovery_v0_1",
    "route_preset_ref": "uc01_01_minatomirai_odawara",
    "seed": 42,
    "tick_seconds": 180,
    "fixed_overrides": {
      "initial_drowsiness": 50,
      "initial_fatigue": 55,
      "is_night": false,
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

Note: the Yokohane congestion lives in the journey narrative, **not** as a painted `jam_range_km` — a high-fatigue driver fires early (before ~15 km), which would fail the band-position assertion (#3). If a painted jam is wanted for the demo visual, add `"jam_range_km": [0.0, 20.0]` (band start 0 is always satisfied) after confirming the route km in Task 1 Step 4.

- [ ] **Step 2: Write `case-uc01-02-commuter-b.json`**

```json
{
  "case_id": "case-uc01-02-commuter-b",
  "schema_version": "1.0.0",
  "version": "1.0.0",
  "title": {
    "ja": "UC-01-02 Bさん（30代前半男性）",
    "en": "UC-01-02 Mr. B (man, early 30s)"
  },
  "brief": {
    "ja": "残業後の夜、名古屋から犬山へ一人で帰宅します。「休憩＝時間ロス」と考え遠回りを嫌う効率重視のドライバーに、強い疲労が出ています。低負担で短い休憩（コンビニでの小休止）が提案されるか、コンテンツが馴染みのあるアップテンポ／ハミングカラオケになるかを確認します。",
    "en": "Driving home alone from Nagoya to Inuyama on a night after overtime. An efficiency-minded driver who treats breaks as lost time and dislikes detours is now strongly fatigued. Checks whether a low-burden, short break (a convenience-store stop) is proposed, and whether the content is familiar up-tempo music / humming karaoke."
  },
  "what_to_watch": [
    {"ja": "効率重視のドライバーに低負担で短い休憩が提案されるか", "en": "Whether a low-burden, short break is proposed to an efficiency-minded driver"},
    {"ja": "遠回りではなく最短ルート上の小休止が選ばれるか", "en": "Whether a quick stop on the shortest route (not a detour) is chosen"},
    {"ja": "コンテンツが馴染みのある低負担のもの（ハミングカラオケ／アップテンポ）か", "en": "Whether content is familiar and low-effort (humming karaoke / up-tempo)"}
  ],
  "persona": {
    "persona_id": "persona-commuter-b",
    "name": {"ja": "残業帰りのBさん", "en": "Mr. B, driving home after overtime"},
    "narrative": {
      "ja": "30代前半の男性。残業後、夜の道を一人で運転して帰宅します。「休憩＝時間ロス」と考え、遠回りを嫌います。馴染みのあるアップテンポな曲や軽いハミングカラオケを好みます。",
      "en": "A man in his early 30s, driving home alone at night after overtime. He treats breaks as lost time and dislikes detours. He likes familiar up-tempo songs and light humming karaoke."
    },
    "goals": [
      {"ja": "できるだけ早く効率的に帰宅する", "en": "Get home as quickly and efficiently as possible"}
    ],
    "preferences": [
      {"ja": "遠回りにならない短い休憩なら受け入れる", "en": "Will accept a short break only if it is not a detour"},
      {"ja": "馴染みのあるアップテンポな曲・軽いカラオケを好む", "en": "Prefers familiar up-tempo songs and light karaoke"}
    ],
    "constraints": [
      {"ja": "長い休憩や遠回りは受け入れにくい", "en": "Unlikely to accept a long break or a detour"}
    ],
    "assumptions": [
      {"ja": "出発時点で疲労がかなり高い", "en": "Fatigue is already quite high at departure"},
      {"ja": "走行はすべて夜間帯に行われる", "en": "The whole drive takes place at night"}
    ],
    "profile_ref": "preset-uc01-02-commuter-b"
  },
  "journey": {
    "narrative": {
      "ja": "夜、名古屋（ミッドランドスクエア）から犬山の自宅までを最短ルートで走行します。",
      "en": "A night-time drive on the shortest route from Nagoya (Midland Square) to home in Inuyama."
    },
    "scenario_ref": "uc01_fatigue_recovery_v0_1",
    "route_preset_ref": "uc01_02_nagoya_inuyama",
    "seed": 42,
    "tick_seconds": 180,
    "fixed_overrides": {
      "initial_drowsiness": 40,
      "initial_fatigue": 72,
      "is_night": true,
      "child_passenger": false
    },
    "automatic_path": {
      "service_choice": "rank_1",
      "rest_response": "accept"
    }
  },
  "algorithm_defaults": {
    "trigger": "nri_fatigue_score_v1",
    "service": "aica_transparent_service_selector_v1",
    "content": "aica_transparent_content_selector_v1"
  }
}
```

Note: `sleep_minutes` is **omitted** — accepting the rest without a nap signals the short `convenience_stretch` recovery rather than `nap_karaoke`. Confirm the recovery-option behavior in Task 6.

- [ ] **Step 3: Write `case-uc03-01-monotony-a.json`**

Set `jam_range_km` band start `< route_km` (from Task 1 Step 4) and band end `≤ route_km`; the values below assume a ~10 km extracted route — adjust `[2.0, 8.0]` if the recorded km differs.

```json
{
  "case_id": "case-uc03-01-monotony-a",
  "schema_version": "1.0.0",
  "version": "1.0.0",
  "title": {
    "ja": "UC-03-01（1-1） Aさん（50代後半女性）＋娘Cさん",
    "en": "UC-03-01 (1-1) Ms. A (woman, late 50s) with her daughter C"
  },
  "brief": {
    "ja": "土曜夕方、湾岸の渋滞にはまった母娘のドライブ。通い慣れた月例のモールへの短い道が、全面渋滞で通常20分から45〜50分に延びています。疲労ではなく単調さ・漫然運転が介入を促すか、提案が退屈を母娘の時間に変えるか、コンテンツが彼女の推し（松田聖子）になるかを確認します。",
    "en": "A Saturday-evening mother-and-daughter drive stuck in bay-area traffic. Their familiar monthly trip to the mall, normally 20 minutes, has stretched to 45–50 in full congestion. Checks whether monotony rather than fatigue drives the intervention, whether the proposal turns boredom into shared time, and whether the content is her oshi (Seiko Matsuda)."
  },
  "what_to_watch": [
    {"ja": "疲労ではなく単調さ・漫然が介入の決め手か", "en": "Monotony/inattention rather than fatigue as the deciding input"},
    {"ja": "日中の渋滞でも単調さの介入が発火するか", "en": "Whether a monotony intervention fires even in a daytime jam"},
    {"ja": "コンテンツが彼女の推し（松田聖子）になるか", "en": "Whether the content is her oshi (Seiko Matsuda)"}
  ],
  "persona": {
    "persona_id": "persona-monotony-a",
    "name": {"ja": "娘と出かけるAさん", "en": "Ms. A, out with her daughter"},
    "narrative": {
      "ja": "50代後半の女性。成人した娘Cさんと、通い慣れた月例のモールへ向かいます。土曜夕方の湾岸は全面渋滞で、単調な低速走行が続き漫然としがちです。推しは、なにわ男子、松田聖子、そして娘の影響でSnow Man。",
      "en": "A woman in her late 50s, heading to a familiar monthly mall with her adult daughter C. The Saturday-evening bayshore is fully congested; the monotonous slow crawl invites inattention. Her oshi are Naniwa Danshi, Seiko Matsuda, and — via her daughter — Snow Man."
    },
    "goals": [
      {"ja": "娘との時間を楽しみながら安全に着く", "en": "Arrive safely while enjoying time with her daughter"}
    ],
    "preferences": [
      {"ja": "推し（なにわ男子 / 松田聖子 / Snow Man）の曲を好む", "en": "Prefers songs by her oshi (Naniwa Danshi / Seiko Matsuda / Snow Man)"},
      {"ja": "母娘で一緒に楽しめるコンテンツを歓迎する", "en": "Welcomes content mother and daughter can enjoy together"}
    ],
    "constraints": [
      {"ja": "渋滞中は停車が必要なサービスを使いにくい", "en": "Hard to use services that require stopping while in the jam"}
    ],
    "assumptions": [
      {"ja": "出発時点の疲労・眠気は通常どおり（低め）", "en": "Fatigue and drowsiness are normal (low) at departure"},
      {"ja": "通い慣れた道で単調さを感じやすい", "en": "The familiar route makes monotony more likely"}
    ],
    "profile_ref": "preset-uc03-01-monotony-a"
  },
  "journey": {
    "narrative": {
      "ja": "土曜夕方、ららぽーとTOKYO-BAYから海浜幕張の自宅付近まで、湾岸の渋滞区間を含めて走行します。",
      "en": "A Saturday-evening drive from LaLaport TOKYO-BAY toward home near Kaihin-Makuhari, including a congested bayshore stretch."
    },
    "scenario_ref": "uc02_monotony_v0_1",
    "route_preset_ref": "uc03_01_funabashi_makuhari",
    "seed": 42,
    "tick_seconds": 180,
    "fixed_overrides": {
      "is_night": false,
      "child_passenger": false,
      "multiple_passengers": true,
      "jam_range_km": [2.0, 8.0]
    },
    "automatic_path": {
      "service_choice": "rank_1"
    }
  },
  "algorithm_defaults": {
    "trigger": "aica_transparent_hybrid_trigger_v1",
    "service": "aica_transparent_service_selector_v1",
    "content": "aica_transparent_content_selector_v1"
  }
}
```

Note: `automatic_path` sets **only** `service_choice` (a monotony proposal's own responses are acknowledge/decline, neither valid in `rest_response`; c03/c05 follow the same pattern). `initial_drowsiness`/`initial_fatigue` are **omitted** so the scenario default (`5/5`) applies — keeping fatigue low so **monotony**, not fatigue, drives the fire. The hybrid trigger is `uc02_monotony`'s native pairing (see the scenario's own `_comment`).

- [ ] **Step 4: Validate schema + references for the 3 new files**

```bash
PYTHONPATH=app/api /c/Users/l-huynh/AppData/Local/anaconda3/python.exe -m pytest "app/api/tests/test_combined_case_contract.py" -q
```

Expected: PASS for all cases including the 3 new ones (schema valid, `case_id` matches filename, no expectation fields, every referenced artifact exists, bilingual text with `ja != en`). If `unknown route_preset_ref`/`profile_ref` → Task 1/Task 2 output is missing; if a bilingual assertion fails → a `ja`/`en` pair is empty or identical.

- [ ] **Step 5: Commit**

```bash
git add combined_contracts/test_cases/case-uc01-01-oshikatsu-c.json combined_contracts/test_cases/case-uc01-02-commuter-b.json combined_contracts/test_cases/case-uc03-01-monotony-a.json
git commit -m "feat(cases): add 3 UC demo combined test cases (oshi-katsu, commuter, monotony)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Full backend verification + fire calibration

**Files:** none created; may re-touch `combined_contracts/test_cases/*.json` (Task 4) or `scripts/preset_standalones.json` (Task 2) if calibration requires it.

**Interfaces:** consumes all prior tasks; produces a green backend suite for every affected module.

- [ ] **Step 1: Run the combined-case integration test (the real merged path)**

```bash
PYTHONPATH=app/api /c/Users/l-huynh/AppData/Local/anaconda3/python.exe -m pytest app/api/tests/test_combined_case_integration.py -q
```

Expected: PASS for all cases. If a **new** case fails, apply the matching remedy and re-run:

- **`expected the run to fire` / `no in-scope fire`** (UC-03-01 most at risk):
  1. First try `aica_transparent_hybrid_trigger_v1` as authored (it is the scenario's native trigger).
  2. If still not firing, add modest `initial_drowsiness: 30, initial_fatigue: 30` to UC-03-01's `fixed_overrides` (keeps the monotony story: the jam + monotony remain the visible cause, fatigue stays sub-threshold).
  3. If still not firing, switch UC-03-01's trigger to `nri_fatigue_score_v1` (matches the proven `case-c03` on the same scenario; the merged runner still records both categories).
  4. Last resort — the design's authorized fallback (§8): author `scenarios/uc03_01_monotony_daytime_jam.json` as a copy of `uc02_monotony_v0_1.json` with `driver_signal_params.drowsiness_model.monotony_add_per_min` raised (e.g. `0.05` → `0.15`) so a daytime drive crosses the monotony bands, set `is_night:false` in the scenario, and point UC-03-01's `scenario_ref` at it. Record here why reuse was insufficient.
- **`fire falls BEFORE the painted band start`** (UC-03-01 if `jam_range_km[0]` is too high): lower `jam_range_km[0]` toward `0.0` (band start is only a lower bound on fire position).
- **`test_case_c01_is_a_comparison_baseline` fails** (a UC-01 case is milder than c01 on some axis): raise that case's `initial_drowsiness`/`initial_fatigue` so it fires earlier, peaks higher, and fires more often than c01 (48 min / 0.814 / 2). UC-01-01 is `50/55`, UC-01-02 is `40/72` — both should already exceed c01; nudge upward if the assertion message shows otherwise.

- [ ] **Step 2: Run the full affected backend set**

```bash
PYTHONPATH=app/api /c/Users/l-huynh/AppData/Local/anaconda3/python.exe -m pytest \
  app/api/tests/proposal/test_preset_generation.py \
  app/api/tests/proposal/test_presets_expectations.py \
  app/api/tests/proposal/test_ep_presets.py \
  app/api/tests/proposal/test_preset_store.py \
  app/api/tests/test_combined_case_contract.py \
  app/api/tests/test_combined_case_integration.py -q
```

Expected: all PASS. If calibration changed a preset spec, re-run `generate_presets.py` and re-commit (Task 2 Step 5) before this passes.

- [ ] **Step 3: Frontend two-tier catalog test**

```bash
cd app/frontend && npm test -- merged_setup_two_tier ; cd /c/Users/l-huynh/Desktop/AICA-hypothesis-simulator
```

Expected: PASS (the 3 new cases auto-load via the glob; if this test asserts a case count, update it the same way as Task 3 — note it in the commit). If `npm` is unavailable locally, defer this to the Docker app-verification in Task 6.

- [ ] **Step 4: Commit any calibration changes**

```bash
git add -A
git commit -m "test(cases): calibrate UC demo cases to pass merged integration + c01 baseline

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

(Skip if Step 1–3 required no changes.)

---

## Task 6: In-app verification + demo screenshots

**Files:** none. Produces the demo evidence (screenshots) and a functional sign-off.

- [ ] **Step 1: Start the stack**

```bash
cmd.exe /c docker-start.bat
```

Wait for API on `:8137` and frontend on `:5180`. If Docker is unavailable in this environment, fall back to two local processes: backend `PYTHONPATH=app/api "$PY" -m uvicorn aica_api.main:app --port 8137` and frontend `cd app/frontend && npm run dev`.

- [ ] **Step 2: Verify each case in the combined screen**

Open `http://localhost:5180`, go to the combined/merged screen, and for each of the 3 new cases confirm the story:
- **UC-01-01** — a REST proposal fires despite low self-awareness; on accept + nap, recovery content is a Mrs. GREEN APPLE track.
- **UC-01-02** — a REST proposal offers a short, low-burden break (convenience stretch, not a detour); content is familiar j-pop / humming-karaoke-capable service.
- **UC-03-01** — a MONOTONY proposal fires in a **daytime** jam; content reflects her profile (Seiko / j-pop); mother-daughter framing shows in the persona panel.

Confirm the case title matches the source text exactly (Global Constraint / design §12): `UC-01-01 Cさん（20代前半女性）`, `UC-01-02 Bさん（30代前半男性）`, `UC-03-01（1-1） Aさん（50代後半女性）＋娘Cさん`.

- [ ] **Step 3: Capture screenshots**

Capture one screenshot per case (setup + fired proposal + decision trace) into `docs/superpowers/plans/assets/uc-demo/` (create the dir). Screenshots are a manual/optional demo artifact — the functional confirmation in Step 2 is the required deliverable.

- [ ] **Step 4: Stop the stack**

```bash
cmd.exe /c docker-stop.bat
```

- [ ] **Step 5: Commit any captured assets**

```bash
git add docs/superpowers/plans/assets/uc-demo/ 2>/dev/null && git commit -m "docs(demo): add UC demo case verification screenshots

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" || echo "no screenshots to commit"
```

---

## Task 7: Finalize the htmlapp increment hand-off (documentation only)

**Files:**
- Modify: `docs/superpowers/specs/2026-08-03-uc-demo-combined-cases-design.md` §11 (fill in the concrete artifact names produced above)

**Interfaces:** none in code — this is the spec branch `026-htmlapp-combined-export` consumes later. **No htmlapp code is written on `develop`.**

- [ ] **Step 1: Cross-check §11 against the real artifact names**

Confirm §11's item list now names the exact files this plan produced: routes `uc01_01_minatomirai_odawara.json`, `uc01_02_nagoya_inuyama.json`, `uc03_01_funabashi_makuhari.json`; presets `preset-uc01-01-oshikatsu-c`, `preset-uc01-02-commuter-b`, `preset-uc03-01-monotony-a`; cases `case-uc01-01-oshikatsu-c.json`, `case-uc01-02-commuter-b.json`, `case-uc03-01-monotony-a.json`; scenario `uc03_01_monotony_daytime_jam` (new, for UC-03-01). Confirm §11 still notes: the combined-screen layer is wholesale absent from htmlapp today, so the increment must add routes + the `uc03_01_monotony_daytime_jam` scenario + a `getPreset` seam bundling the 3 driver profiles + the case glob + service/content selectors + catalog (`aica_transparent_hybrid_trigger_v1` is already bundled).

- [ ] **Step 2: Add a one-line trigger note to §11**

Record that all three new cases — including UC-03-01, which took the NRI fallback in Task 5 — ship with `nri_fatigue_score_v1`. The `aica_transparent_hybrid_trigger_v1` package is already bundled in htmlapp for the existing 6 cases and needs no change for the 3 new cases.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-03-uc-demo-combined-cases-design.md
git commit -m "docs(spec): finalize htmlapp increment with concrete UC demo artifact names

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage** (design doc §1–§12):
- §1 purpose / §2 constraints → Global Constraints + every task honors them (no algorithm/app-runtime edits; only the 3 authorized count literals in Task 3).
- §3 catalog fidelity (oshi mapping) → Task 2 preset profiles (Mrs. GREEN APPLE 0.6 + Aimyon 0.3; Seiko 0.5; absent idols display-only in Task 4 persona narratives).
- §4 case wiring → Task 4 (all 3 cases) + Task 1 routes + Task 2 profile_refs.
- §5 new proposal presets (generated, calibrated, no override) → Task 2.
- §6 backend count edits → Task 3 (3 literals; `_EXPECTED_PRESET_IDS` glob untouched — matches §6's correction).
- §7 route extraction (run now, key hygiene) → Task 1.
- §8 scenario reuse + fallback → Task 4 (reuse) + Task 5 Step 1 staged fallback.
- §9 combined case files → Task 4.
- §10 verification → Task 5 (backend) + Task 6 (app/screenshots).
- §11 htmlapp increment → Task 7.
- §12 open items (exact titles, ids, fixed_overrides) → titles pinned in Task 4 + confirmed in Task 6 Step 2; ids fixed; fixed_overrides given as starting values with Task 5 calibration levers.

**2. Placeholder scan:** All JSON artifacts (routes additions, 3 preset specs, 3 combined cases), the 3 count edits, and every command are literal and complete. Calibration steps give concrete observed→adjust rules, not "tune as needed". The only intentionally-deferred value is UC-03-01's `jam_range_km` band end (depends on the live-extracted route km, recorded in Task 1 Step 4) — stated explicitly with a default and an adjust rule.

**3. Type / name consistency:** `preset_id` ↔ `profile_ref` match across Task 2/Task 4 (`preset-uc01-01-oshikatsu-c` etc.). `case_id` = filename stem (contract test enforces). `automatic_path` uses only schema-valid enum values (`rest_response:"accept"`, never `"acknowledge"`). `fixed_overrides` uses only allowed keys. Trigger/service/content ids match real package dirs (`aica_transparent_hybrid_trigger_v1`, `nri_fatigue_score_v1`, `aica_transparent_service_selector_v1`, `aica_transparent_content_selector_v1`). Track/artist ids match the frozen catalog (`0120/0176/0136`, tracks `0117/0129/0133/0134` and `0148/0149/0150`).

**Dependency order:** Task 1 (routes) + Task 2 (presets) → Task 3 (counts, after Task 2) → Task 4 (cases, needs routes+presets) → Task 5 (integration+calibration) → Task 6 (app) → Task 7 (doc). Tasks 1 and 2 are independent and may run in parallel.
