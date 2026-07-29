# Semantic Combined Experience Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the six weak Combined presets with 36 real-world semantic
cases, execute every case through the frozen trigger/service/content quickview
chain, adjudicate the hypotheses, and generate one self-contained customer HTML
report.

**Architecture:** A single authored JSON catalog is compiled into normal trigger
scenarios, built-in driver profiles, and Combined case artifacts. A read-only
Python runner calls the production FastAPI quickview endpoint, a pure evaluator
compares recorded evidence with typed semantic predicates, and a pure renderer
turns the catalog plus normalized results into an offline HTML report. The
frontend keeps using its build-time case glob and resolves either a profile or
legacy preset reference.

**Tech Stack:** Python 3.12, FastAPI TestClient, Pydantic v2, JSON Schema draft
07, TypeScript/React/Vite, Vitest, pytest, HTML5/CSS/vanilla JavaScript.

## Global Constraints

- Do not modify any file under `packages/aica_transparent_hybrid_trigger_v1`,
  `packages/aica_transparent_service_selector_v1`, or
  `packages/aica_transparent_content_selector_v1`.
- Only `rest_required` and `monotony_prevention` fires are in scope.
- Evaluate only the proposal attached directly to an in-scope fire; rest-place,
  during-rest, after-rest, and resume-driving behavior are excluded.
- Exactly 36 independently runnable case artifacts must be generated.
- Every case title states its behavioral purpose.
- Every contrast variant title ends with
  `(contrast with test case ID TC-...)`; baseline titles do not use a generic
  “baseline” label.
- Expectations remain authored hypotheses. A mismatch is retained and reported;
  expectations are never rewritten to make a frozen algorithm pass.
- All production requests use the three frozen package IDs and pin every
  supported quickview input explicitly.
- Content parameters/hyperparameters are not varied because the current
  quickview accepts but does not apply them.
- The HTML report embeds all CSS, JavaScript, catalog data, results, and
  audit evidence; it makes no network request.
- The report must not claim medical validation, road-safety certification, or
  physical-world causality.

---

## File map

### Authored and generated data

- Create: `scripts/semantic_combined_catalog.json` — sole human-authored catalog
  source containing profiles, scenario recipes, case narratives, hypotheses,
  checks, contrasts, and CDC-SU references.
- Create: `scripts/semantic_catalog/__init__.py` — package boundary and catalog
  version.
- Create: `scripts/semantic_catalog/generator.py` — validates the authored source
  and compiles runtime JSON artifacts.
- Generate: `scenarios/semantic_tc_*.json` — one deterministic trigger scenario
  per case.
- Generate: `proposal_contracts/profiles/profile-semantic-*.json` — reusable
  driver profiles referenced by the cases.
- Generate: `combined_contracts/test_cases/case-tc-*.json` — the 36 selectable
  Combined cases.
- Delete: the six existing `combined_contracts/test_cases/case-c0*.json`
  artifacts after the replacement catalog validates.

### Runtime contract and screen compatibility

- Modify: `combined_contracts/schema/combined_test_case.schema.json` — semantic
  group, purpose, real-world story, hypothesis/checks, contrast metadata, and
  direct profile references.
- Modify: `app/frontend/src/lib/review/caseCatalog.ts` — mirror additive semantic
  fields.
- Modify: `app/frontend/src/components/merged/useCaseSelection.ts` — resolve
  `profile-*` through `getProfile` while preserving legacy `preset-*`.
- Modify: `app/frontend/src/api/mergedClient.ts` — add the four backend-supported
  quickview pins currently omitted from the TypeScript request type.
- Modify: `app/frontend/tests/use_case_selection.test.tsx` and
  `app/frontend/tests/case_resolver.test.ts`.

### Execution, evaluation, and reporting

- Create: `scripts/semantic_catalog/runner.py` — compile exact quickview requests,
  call the production endpoint, normalize evidence, and record provenance.
- Create: `scripts/semantic_catalog/evaluator.py` — pure semantic predicate
  evaluator and verdict aggregation.
- Create: `scripts/semantic_catalog/report.py` — pure self-contained HTML
  renderer.
- Create: `scripts/build_semantic_combined_report.py` — CLI orchestration.
- Generate:
  `combined_contracts/results/semantic-combined-results.v1.json` — normalized
  machine-readable results and bounded audit evidence.
- Generate: `docs/semantic-combined-test-case-report.html` — the only artifact
  required for customer review.

### Tests and documentation

- Modify: `app/api/tests/test_combined_case_contract.py`.
- Replace semantic assumptions in:
  `app/api/tests/test_combined_case_integration.py`.
- Create: `app/api/tests/test_semantic_catalog_generator.py`.
- Create: `app/api/tests/test_semantic_catalog_evaluator.py`.
- Create: `app/api/tests/test_semantic_catalog_runner.py`.
- Create: `app/api/tests/test_semantic_catalog_report.py`.
- Modify: `combined_contracts/test_cases/README.md`.

---

### Task 1: Add the semantic case contract and direct-profile screen support

**Files:**

- Modify: `combined_contracts/schema/combined_test_case.schema.json`
- Modify: `app/api/tests/test_combined_case_contract.py`
- Modify: `app/frontend/src/lib/review/caseCatalog.ts`
- Modify: `app/frontend/src/components/merged/useCaseSelection.ts`
- Modify: `app/frontend/src/api/mergedClient.ts`
- Modify: `app/frontend/tests/use_case_selection.test.tsx`

**Interfaces:**

- Produces: `CombinedTestCase` with `display_id`, `group`, `purpose`,
  `real_world`, `hypothesis`, `expectations`, and optional `contrast`.
- Produces: `resolveDriverProfile(profileRef: string): Promise<DriverProfile>`
  inside `useCaseSelection.ts`.
- Produces: `MergedQuickviewReq.context_overrides`, `.initial_state`,
  `.profiles`, and `.tick_seconds`.

- [ ] **Step 1: Replace the “no expectations” contract test with failing semantic-contract tests**

Add assertions equivalent to:

```python
def test_exactly_36_semantic_cases_are_committed():
    assert len(_CASE_FILES) == 36

@pytest.mark.parametrize("path", _CASE_FILES, ids=lambda p: p.stem)
def test_case_has_customer_semantics(path):
    case = _load(path)
    assert case["display_id"].startswith("TC-")
    assert case["purpose"]["en"].strip()
    assert case["real_world"]["before_trip"]["en"].strip()
    assert case["real_world"]["trip_reason"]["en"].strip()
    assert case["real_world"]["state_at_departure"]["en"].strip()
    assert case["real_world"]["journey_evolution"]["en"].strip()
    assert case["hypothesis"]["rationale"]["en"].strip()
    assert case["expectations"]["trigger"]["outcome"] in {
        "rest_required", "monotony_prevention", "none"
    }

def test_contrast_titles_name_their_baseline():
    by_id = {_load(p)["display_id"]: _load(p) for p in _CASE_FILES}
    for case in by_id.values():
        contrast = case.get("contrast")
        if contrast and contrast["role"] == "variant":
            baseline = contrast["with_case_id"]
            assert f"(contrast with test case ID {baseline})" in case["title"]["en"]
            assert baseline in by_id
```

- [ ] **Step 2: Run the contract tests and verify they fail**

Run:

```bash
cd app/api
.venv/bin/pytest -q tests/test_combined_case_contract.py
```

Expected: failures because the old six cases have no semantic fields and the
schema still forbids them.

- [ ] **Step 3: Extend the JSON schema and TypeScript reader**

Add closed definitions for:

```typescript
type CaseGroup = 'rest' | 'monotony' | 'environment' | 'service' | 'content' | 'integrated'
type TriggerOutcome = 'rest_required' | 'monotony_prevention' | 'none'
type CaseContrast = {
  role: 'baseline' | 'variant'
  with_case_id: string
  kind: 'controlled_one_factor' | 'semantic_real_world'
  changed_inputs: string[]
  expected_delta: BilingualLabel
}
```

`expectations.trigger` accepts outcome, optional inclusive time window, maximum
fire count, and required positive feature IDs. `expectations.service` accepts
rank-1 acceptable IDs, top-three required/prohibited IDs, and required positive
feature IDs. `expectations.content` accepts expected stage outcome
(`complete_plan`, `unsupported_service`, or `not_applicable`), returned count,
required/excluded track IDs, optional OSHI artist ID, and optional mean-arousal
range. All nested objects remain `additionalProperties: false`.

- [ ] **Step 4: Write the failing direct-profile selection test**

Mock `getProfile('profile-semantic-neutral')` to return:

```typescript
{
  profile_id: 'profile-semantic-neutral',
  label: { ja: '標準', en: 'Neutral' },
  builtin: true,
  profile: neutralDriverProfile,
}
```

Select a case whose `persona.profile_ref` starts with `profile-`, then assert
`LOAD_PROFILE` receives `neutralDriverProfile`. Retain a separate assertion
that `preset-*` still uses `getPreset`.

- [ ] **Step 5: Implement profile/preset dispatch and quickview request pins**

Use:

```typescript
async function resolveDriverProfile(profileRef: string): Promise<DriverProfile> {
  if (profileRef.startsWith('profile-')) {
    return (await getProfile(profileRef)).profile
  }
  return (await getPreset(profileRef)).world.driver_profile
}
```

Add to `MergedQuickviewReq`:

```typescript
context_overrides?: Record<string, unknown> | null
initial_state?: Record<string, unknown> | null
profiles?: Record<string, unknown> | null
tick_seconds?: number | null
```

- [ ] **Step 6: Run focused frontend tests**

Run:

```bash
cd app/frontend
npm test -- --run tests/use_case_selection.test.tsx tests/case_resolver.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 7: Commit**

```bash
git add combined_contracts/schema/combined_test_case.schema.json \
  app/api/tests/test_combined_case_contract.py \
  app/frontend/src/lib/review/caseCatalog.ts \
  app/frontend/src/components/merged/useCaseSelection.ts \
  app/frontend/src/api/mergedClient.ts \
  app/frontend/tests/use_case_selection.test.tsx
git commit -m "feat: add semantic combined case contract"
```

### Task 2: Build the deterministic artifact compiler

**Files:**

- Create: `scripts/semantic_catalog/__init__.py`
- Create: `scripts/semantic_catalog/generator.py`
- Create: `scripts/semantic_combined_catalog.json`
- Create: `app/api/tests/test_semantic_catalog_generator.py`

**Interfaces:**

- Produces:
  `load_catalog(path: Path) -> dict[str, Any]`.
- Produces:
  `validate_catalog(catalog: Mapping[str, Any]) -> None`.
- Produces:
  `compile_artifacts(catalog: Mapping[str, Any], repo_root: Path) -> list[Path]`.
- The first source revision contains two complete fixture cases (`TC-R01` and
  `TC-R02`); Task 6 expands it to 36 without changing compiler code.

- [ ] **Step 1: Write failing compiler tests**

Cover:

```python
def test_compiler_emits_scenario_profile_and_case(tmp_path):
    written = compile_artifacts(two_case_catalog(), tmp_path)
    assert tmp_path / "scenarios/semantic_tc_r01.json" in written
    assert tmp_path / "proposal_contracts/profiles/profile-semantic-neutral.json" in written
    assert tmp_path / "combined_contracts/test_cases/case-tc-r01.json" in written

def test_scenario_validates_with_real_model(tmp_path):
    compile_artifacts(two_case_catalog(), tmp_path)
    scenario = json.loads((tmp_path / "scenarios/semantic_tc_r01.json").read_text())
    ScenarioDef.model_validate(scenario)

def test_profile_validates_with_real_model(tmp_path):
    compile_artifacts(two_case_catalog(), tmp_path)
    record = json.loads(
        (tmp_path / "proposal_contracts/profiles/profile-semantic-neutral.json").read_text()
    )
    DriverProfile.model_validate(record["profile"])

def test_strict_pair_rejects_an_undeclared_business_difference():
    catalog = two_case_catalog()
    catalog["cases"][1]["journey"]["scenario"]["weather_risk"] = 80
    with pytest.raises(ValueError, match="undeclared strict-contrast difference"):
        validate_catalog(catalog)
```

- [ ] **Step 2: Run compiler tests and verify they fail**

Run:

```bash
cd app/api
PYTHONPATH=../..:. .venv/bin/pytest -q tests/test_semantic_catalog_generator.py
```

Expected: import failure for the not-yet-created generator.

- [ ] **Step 3: Implement deterministic generation**

The scenario compiler expands each recipe into the existing `ScenarioDef`
shape with:

- one start, one rest, one primary road, and one end segment;
- explicit initial drowsiness/fatigue;
- explicit drowsiness/fatigue growth models;
- explicit anomaly model;
- explicit route distance, traffic and weather events;
- explicit night/child/familiar/weather values;
- fixed tick size, duration, seed, speed profile, and in-scope actions.

Use `json.dumps(..., ensure_ascii=False, indent=2, sort_keys=True) + "\n"`.
Validate each scenario with `ScenarioDef`, each profile with `DriverProfile`,
and each case with the committed JSON schema before replacing a generated file.
Only manage files with prefixes `semantic_tc_`, `profile-semantic-`, and
`case-tc-`.

- [ ] **Step 4: Add the complete R01/R02 source records**

R01 title:
`Protect a sleep-deprived late-shift worker with an early rest proposal`.
R02 title:
`Keep a well-rested late-shift worker driving without a premature rest proposal (contrast with test case ID TC-R01)`.

Use a semantic-real-world contrast: the route, algorithms, seed, and profile are
held constant; initial signals and growth rates differ together because they
represent poor sleep versus adequate sleep.

- [ ] **Step 5: Run compiler tests**

Run:

```bash
cd app/api
PYTHONPATH=../..:. .venv/bin/pytest -q tests/test_semantic_catalog_generator.py
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/semantic_catalog scripts/semantic_combined_catalog.json \
  app/api/tests/test_semantic_catalog_generator.py
git commit -m "feat: compile semantic combined artifacts"
```

### Task 3: Implement the pure evidence evaluator

**Files:**

- Create: `scripts/semantic_catalog/evaluator.py`
- Create: `app/api/tests/test_semantic_catalog_evaluator.py`

**Interfaces:**

- Consumes: one compiled case and one quickview response.
- Produces:
  `evaluate_case(case: Mapping[str, Any], result: Mapping[str, Any]) -> dict`.
- Produces:
  `aggregate_suite(case_results: Sequence[Mapping[str, Any]]) -> dict`.
- Produces:
  `evaluate_suite(catalog: Mapping[str, Any], run_suite: Mapping[str, Any]) -> dict`,
  which calls `evaluate_case`, computes reciprocal contrast deltas, and attaches
  `aggregate_suite`.

- [ ] **Step 1: Write failing evaluator tests**

Fixtures must cover:

```python
def test_expected_rest_with_matching_service_and_plan_is_match(): ...
def test_expected_no_fire_is_match_and_downstream_not_applicable(): ...
def test_missing_expected_fire_is_mismatch_and_downstream_not_evaluated(): ...
def test_right_category_wrong_time_is_partial_match(): ...
def test_visible_output_with_missing_required_reason_is_partial_match(): ...
def test_unsupported_content_is_read_from_algorithm_error_event(): ...
def test_unexpected_content_error_is_execution_error(): ...
def test_multiple_fires_selects_declared_category_and_occurrence(): ...
def test_empty_candidate_list_never_vacuously_matches(): ...
def test_suite_aggregation_uses_documented_precedence(): ...
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd app/api
PYTHONPATH=../..:. .venv/bin/pytest -q tests/test_semantic_catalog_evaluator.py
```

Expected: import failure for `semantic_catalog.evaluator`.

- [ ] **Step 3: Implement normalized extraction**

Use `fires`, never singular `fire`. Sort by `(tick, category)`, then select the
declared category and occurrence. Treat `fire.time_min` as authoritative.

Read selected-category trigger evidence from:

```python
chain = fire["feature_contributions"][fire["category"]]
score = chain["score"]
rows = chain["rows"]
gates = chain["gates"]
```

Resolve exactly one `step == "service"` evidence record. Resolve zero or one
`step == "content"` record, with fallback to the first `ALGORITHM_ERROR` event
whose payload step is `content`.

- [ ] **Step 4: Implement checks and verdict aggregation**

Each check result contains:

```python
{
    "check_id": "trigger.category",
    "stage": "trigger",
    "expected": "rest_required",
    "actual": "rest_required",
    "status": "MATCH",
    "explanation": "The first rest_required fire occurred at 18.0 min.",
    "evidence_path": "$.fires[category=rest_required][occurrence=1].category",
}
```

Use the design statuses and precedence:

```text
EXECUTION_ERROR > MISMATCH > UNVERIFIABLE > PARTIAL_MATCH > MATCH
```

An expected upstream fire that is absent yields one trigger `MISMATCH`; dependent
service/content checks are `NOT_EVALUATED`, not additional mismatches.

- [ ] **Step 5: Run evaluator tests**

Run:

```bash
cd app/api
PYTHONPATH=../..:. .venv/bin/pytest -q tests/test_semantic_catalog_evaluator.py
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/semantic_catalog/evaluator.py \
  app/api/tests/test_semantic_catalog_evaluator.py
git commit -m "feat: evaluate semantic combined evidence"
```

### Task 4: Implement the production quickview runner

**Files:**

- Create: `scripts/semantic_catalog/runner.py`
- Create: `app/api/tests/test_semantic_catalog_runner.py`
- Modify: `app/api/tests/test_combined_case_integration.py`

**Interfaces:**

- Consumes generated case/scenario/profile artifacts and the existing proposal
  seed world.
- Produces:
  `build_quickview_body(case: Mapping[str, Any], repo_root: Path) -> dict`.
- Produces:
  `run_case(client: TestClient, case: Mapping[str, Any], repo_root: Path) -> dict`.
- Produces:
  `run_catalog(repo_root: Path, case_ids: set[str] | None = None) -> dict`.
- Produces:
  `load_track_index(repo_root: Path) -> dict[str, dict[str, Any]]`, keyed by
  frozen catalog track ID, so OSHI artist/genre/title checks are joins against
  committed data rather than guesses from item IDs.

- [ ] **Step 1: Write failing request-parity tests**

Assert the request contains every backend field:

```python
EXPECTED_KEYS = {
    "package_id", "scenario_id", "route_preset_id", "run_seed",
    "mountain_range_km", "jam_range_km", "jam_speed_kph",
    "hyperparameter_overrides", "rest_option_id", "context_overrides",
    "initial_state", "profiles", "tick_seconds", "world",
    "service_package_id", "content_package_id", "run_seed_proposal",
    "service_parameters", "service_hyperparameters",
    "content_parameters", "content_hyperparameters",
}
assert set(build_quickview_body(case, _REPO_ROOT)) == EXPECTED_KEYS
```

Also assert night and child pins are synchronized into both trigger
`context_overrides` and proposal `world.situation`.

- [ ] **Step 2: Write the failing production-path smoke test**

Execute the R01 fixture through `client.post("/api/merged-runs/quickview")` and
assert HTTP 200, no top-level error, package provenance matches the three frozen
IDs, and the response contains either a completed in-scope proposal or a
recorded stage error.

- [ ] **Step 3: Run runner tests and verify they fail**

Run:

```bash
cd app/api
PYTHONPATH=../..:. .venv/bin/pytest -q \
  tests/test_semantic_catalog_runner.py \
  tests/test_combined_case_integration.py
```

Expected: runner import failure and old integration assumptions tied to C-01.

- [ ] **Step 4: Implement exact request compilation and provenance**

Run cases sequentially in sorted display-ID order. Record:

- git commit;
- catalog/schema/evaluator versions;
- package IDs plus package manifest SHA-256;
- dataset and matrix SHA-256;
- canonical request SHA-256;
- HTTP status; elapsed milliseconds may be logged to the console but are not
  committed as semantic evidence because wall-clock duration is nondeterministic;
- normalized response SHA-256 after recursively removing only `run_id`,
  `created_at`, `opportunity_id`, and event `at` timestamps.

Keep full numeric values; rounding is display-only.
Join every returned/excluded item to the frozen catalog and record its title,
artist IDs/names, realized genres, release year, and audio features needed by
the report. A missing returned track ID is a structural execution error.

- [ ] **Step 5: Generalize the existing integration test**

Resolve `profile-*` from `proposal_contracts/profiles` and `preset-*` from
`proposal_contracts/presets`. Build requests with the production runner so tests
and the report cannot drift. For every case assert:

- HTTP execution completed;
- top-level trigger preview has no unexpected error;
- an expected fire/no-fire outcome was evaluable;
- both trigger category contribution chains exist on every in-scope fire;
- every attached proposal has one service result or an explicit service error;
- content has a complete plan or an explicit recorded limitation/error.

- [ ] **Step 6: Run focused production tests**

Run:

```bash
cd app/api
PYTHONPATH=../..:. .venv/bin/pytest -q \
  tests/test_semantic_catalog_runner.py \
  tests/test_combined_case_integration.py
```

Expected: all tests pass for the two-case fixture.

- [ ] **Step 7: Commit**

```bash
git add scripts/semantic_catalog/runner.py \
  app/api/tests/test_semantic_catalog_runner.py \
  app/api/tests/test_combined_case_integration.py
git commit -m "feat: run semantic cases through merged quickview"
```

### Task 5: Implement the self-contained customer HTML renderer

**Files:**

- Create: `scripts/semantic_catalog/report.py`
- Create: `app/api/tests/test_semantic_catalog_report.py`

**Interfaces:**

- Consumes authored catalog plus evaluated suite JSON.
- Produces:
  `render_report(catalog: Mapping[str, Any], suite: Mapping[str, Any]) -> str`.

- [ ] **Step 1: Write failing report tests**

Assert:

```python
html = render_report(two_case_catalog(), evaluated_fixture())
assert "<!doctype html>" in html.lower()
assert "TC-R01" in html and "TC-R02" in html
assert "Expected vs actual" in html
assert "Frozen algorithm finding" in html
assert "https://" not in html and "http://" not in html
assert html.count('class="case-detail"') == 2
assert 'aria-label="Filter by verdict"' in html
assert "<script" in html and "<style" in html
```

Parse the document with the repository-available HTML parser or Python
`html.parser` and assert one unique element ID per case and no duplicate IDs.

- [ ] **Step 2: Run report tests and verify they fail**

Run:

```bash
cd app/api
PYTHONPATH=../..:. .venv/bin/pytest -q tests/test_semantic_catalog_report.py
```

Expected: import failure for `semantic_catalog.report`.

- [ ] **Step 3: Implement the overview and filters**

Render verdict counts, group coverage, frozen package IDs, scope/caveat copy,
key findings, and controls for group, expected trigger, verdict, and contrast
role. Filters operate entirely on embedded `data-*` attributes.

- [ ] **Step 4: Implement complete case details**

Every case section includes:

- full real-world setup;
- relevant exact scenario/profile values;
- expected behavior and rationale;
- actual fire timeline;
- expected-versus-actual check table;
- trigger contribution/gate table;
- three ranked services with strongest support/opposition;
- five content items with catalog title/artist/genre/arousal/valence, or explicit
  limitation/error;
- contrast delta;
- data-scientist verdict and caveat;
- collapsible bounded request/response audit JSON.

The report must not embed every 300 KB raw response. Preserve full audit data in
the machine JSON and embed the normalized facts and evidence used by checks.

- [ ] **Step 5: Run report tests**

Run:

```bash
cd app/api
PYTHONPATH=../..:. .venv/bin/pytest -q tests/test_semantic_catalog_report.py
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/semantic_catalog/report.py \
  app/api/tests/test_semantic_catalog_report.py
git commit -m "feat: render semantic combined customer report"
```

### Task 6: Author and generate the complete 36-case catalog

**Files:**

- Modify: `scripts/semantic_combined_catalog.json`
- Generate: `scenarios/semantic_tc_*.json`
- Generate: `proposal_contracts/profiles/profile-semantic-*.json`
- Generate: `combined_contracts/test_cases/case-tc-*.json`
- Delete: `combined_contracts/test_cases/case-c01-alert-daytime-control.json`
- Delete: `combined_contracts/test_cases/case-c02-night-highway-drowsiness.json`
- Delete: `combined_contracts/test_cases/case-c03-monotonous-highway.json`
- Delete: `combined_contracts/test_cases/case-c04-mountain-road-workload.json`
- Delete: `combined_contracts/test_cases/case-c05-late-night-traffic-jam.json`
- Delete: `combined_contracts/test_cases/case-c06-full-rest-lifecycle.json`
- Modify: `combined_contracts/test_cases/README.md`

**Interfaces:**

- Expands the two-case source to these exact 36 IDs/titles.

| ID | English purpose-led title |
|---|---|
| TC-R01 | Protect a sleep-deprived late-shift worker with an early rest proposal |
| TC-R02 | Keep a well-rested late-shift worker driving without a premature rest proposal (contrast with test case ID TC-R01) |
| TC-R03 | Recognize post-shift exhaustion even before strong sleepiness appears |
| TC-R04 | Avoid mistaking an ordinary post-work drive for exhaustion (contrast with test case ID TC-R03) |
| TC-R05 | Time an urgent rest proposal before the last reachable service area |
| TC-R06 | Avoid an unactionable early proposal while the next rest stop is still distant (contrast with test case ID TC-R05) |
| TC-M01 | Interrupt automatic driving on a familiar featureless night commute |
| TC-M02 | Avoid treating a first drive on the same route as habitual monotony (contrast with test case ID TC-M01) |
| TC-M03 | Detect monotony on a long straight daytime expressway while the driver remains rested |
| TC-M04 | Stay quiet on an equally long but varied local-road trip (contrast with test case ID TC-M03) |
| TC-M05 | Intervene before attention fades in prolonged late-night congestion |
| TC-M06 | Delay the intervention on the same route when traffic flows freely (contrast with test case ID TC-M05) |
| TC-E01 | Protect a sleep-deprived parent carrying children on an overnight drive |
| TC-E02 | Prefer non-distracting support for an exhausted worker crossing a mountain pass |
| TC-E03 | Explain an early rest proposal primarily through rapidly rising drowsiness |
| TC-E04 | Recognize accumulating fatigue even while alertness remains stable |
| TC-E05 | Account for heavy rain during a late-night highway journey |
| TC-E06 | Choose rest over entertainment when severe fatigue and monotony coexist |
| TC-S01 | Prioritize humming karaoke that repeatedly restores this driver’s alertness |
| TC-S02 | Offer an alternative after humming repeatedly failed (contrast with test case ID TC-S01) |
| TC-S03 | Prioritize a playlist that this driver consistently accepts and benefits from |
| TC-S04 | Demote a familiar playlist that has not improved alertness (contrast with test case ID TC-S03) |
| TC-S05 | Surface underused call-and-response with strong recovery history |
| TC-S06 | Reduce immediate repetition of call-and-response just used (contrast with test case ID TC-S05) |
| TC-P01 | Personalize an alertness playlist with the driver’s registered OSHI artist |
| TC-P02 | Build a preference-based playlist when OSHI mode is off (contrast with test case ID TC-P01) |
| TC-P03 | Avoid replaying a favorite song heard twenty minutes ago |
| TC-P04 | Keep the same favorite eligible when it has not been heard recently (contrast with test case ID TC-P03) |
| TC-P05 | Exclude a song the driver skipped moments ago |
| TC-P06 | Allow the same song when there is no recent skip (contrast with test case ID TC-P05) |
| TC-I01 | Persuade a rest-averse worker rushing home to stop safely |
| TC-I02 | Protect sleep-deprived friends returning from a late event |
| TC-I03 | Break automatic driving before congestion on a familiar commute |
| TC-I04 | Restore attention for a mentally preoccupied commuter on a repetitive route |
| TC-I05 | Give an older driver familiar, low-friction support after a long community event |
| TC-I06 | Energize a J-rock fan on the highway to a concert without confusing monotony with exhaustion |

- [ ] **Step 1: Author all bilingual narratives before running the algorithms**

For each record, provide non-empty Japanese and English values for title,
purpose, who, before-trip context, trip reason/route, departure state, journey
evolution, relevant profile/history, expected AICA behavior, and rational basis.
Attach CDC-SU section/line references where the source supports the hypothesis;
label simulator-only exploratory hypotheses as such.

- [ ] **Step 2: Author all semantic expectations before execution**

Use broad time windows and acceptable service sets. Strict content mechanics use:

- OSHI artist `synthetic-artist-0068`, track `synthetic-track-0058`;
- recent-play and recent-skip target `synthetic-track-0058`;
- reference time `2026-07-29T12:00:00Z`;
- played timestamp `2026-07-29T11:40:00Z`;
- skipped timestamp `2026-07-29T11:55:00Z`.

Content pairs keep the trigger scenario, seed, and all profile fields identical
except the declared OSHI/history field.

- [ ] **Step 3: Generate the artifacts**

Run:

```bash
PYTHONPATH=app/api:. app/api/.venv/bin/python -m scripts.semantic_catalog.generator \
  --catalog scripts/semantic_combined_catalog.json \
  --repo-root .
```

Expected: 36 cases, 36 scenarios, and the declared reusable profile set are
written deterministically.

- [ ] **Step 4: Remove the superseded six case files**

Delete only the six exact files listed above, then confirm the generated
`case-tc-*.json` set remains.

- [ ] **Step 5: Run contract, generator, and frontend tests**

Run:

```bash
cd app/api
PYTHONPATH=../..:. .venv/bin/pytest -q \
  tests/test_combined_case_contract.py \
  tests/test_semantic_catalog_generator.py
cd ../frontend
npm test -- --run tests/use_case_selection.test.tsx tests/case_resolver.test.ts
```

Expected: all tests pass and exactly 36 cases are discovered.

- [ ] **Step 6: Commit**

```bash
git add scripts/semantic_combined_catalog.json scenarios/semantic_tc_*.json \
  proposal_contracts/profiles/profile-semantic-*.json \
  combined_contracts/test_cases combined_contracts/test_cases/README.md
git commit -m "data: replace combined presets with semantic catalog"
```

### Task 7: Execute, adjudicate, and render all cases

**Files:**

- Create: `scripts/build_semantic_combined_report.py`
- Generate:
  `combined_contracts/results/semantic-combined-results.v1.json`
- Generate: `docs/semantic-combined-test-case-report.html`
- Modify only scenario/profile inputs in
  `scripts/semantic_combined_catalog.json` when execution proves they do not
  represent the authored story.

**Interfaces:**

- CLI flags:
  `--catalog`, `--repo-root`, `--results`, `--html`, and repeatable `--case-id`.
- The CLI regenerates artifacts, runs sorted cases, evaluates them, adds contrast
  deltas and cross-case findings, writes JSON, then writes HTML.

- [ ] **Step 1: Write the CLI orchestration**

Use:

```python
catalog = load_catalog(args.catalog)
compile_artifacts(catalog, args.repo_root)
suite = run_catalog(args.repo_root, set(args.case_id) or None)
evaluated = evaluate_suite(catalog, suite)
args.results.write_text(json.dumps(evaluated, indent=2, ensure_ascii=False) + "\n")
args.html.write_text(render_report(catalog, evaluated), encoding="utf-8")
```

Return nonzero only for contract/transport/execution errors, not semantic
mismatches; mismatches are the requested scientific findings.

- [ ] **Step 2: Run all 36 cases once**

Run:

```bash
PYTHONWARNINGS=ignore PYTHONPATH=app/api:. \
  app/api/.venv/bin/python scripts/build_semantic_combined_report.py \
  --catalog scripts/semantic_combined_catalog.json \
  --repo-root . \
  --results combined_contracts/results/semantic-combined-results.v1.json \
  --html docs/semantic-combined-test-case-report.html
```

Expected: 36/36 cases executed; no case omitted.

- [ ] **Step 3: Audit story-to-input fidelity**

For each case, compare the recorded first-fire world and trigger rows with the
authored story. Correct only objective encoding errors such as a “day” story
running at night, a “slow growth” story using high growth, or a strict pair
containing an undeclared difference. Do not change a hypothesis because the
algorithm output is undesirable.

- [ ] **Step 4: Re-run after any input correction**

Repeat the exact command from Step 2 until every case is structurally
evaluable and every remaining mismatch is an algorithm finding rather than an
authoring/wiring mistake.

- [ ] **Step 5: Add deterministic suite findings**

Derive findings from evaluated data, including:

- cases where no expected trigger occurred;
- rest-versus-monotony priority conflicts;
- service rank changes in controlled pairs;
- unsupported rank-1 service/content boundaries;
- OSHI rank/composition changes;
- played/skip history behavior;
- inputs recorded as unused or context-only.

Do not hand-edit observed numeric results in the HTML.

- [ ] **Step 6: Run result/report tests**

Run:

```bash
cd app/api
PYTHONPATH=../..:. .venv/bin/pytest -q \
  tests/test_semantic_catalog_runner.py \
  tests/test_semantic_catalog_evaluator.py \
  tests/test_semantic_catalog_report.py \
  tests/test_combined_case_integration.py
```

Expected: all structural/execution tests pass. Semantic mismatches are asserted
as recorded verdicts, not test-suite failures.

- [ ] **Step 7: Commit**

```bash
git add scripts/build_semantic_combined_report.py \
  scripts/semantic_combined_catalog.json \
  scenarios/semantic_tc_*.json \
  proposal_contracts/profiles/profile-semantic-*.json \
  combined_contracts/test_cases/case-tc-*.json \
  combined_contracts/results/semantic-combined-results.v1.json \
  docs/semantic-combined-test-case-report.html
git commit -m "feat: publish evaluated combined case report"
```

### Task 8: Full verification and customer-artifact audit

**Files:**

- Verify all files modified in Tasks 1–7.

**Interfaces:**

- Produces final evidence that the report and dataset are reproducible and the
  frozen packages are unchanged.

- [ ] **Step 1: Verify generated artifacts are reproducible**

Run the full report command twice and assert every case keeps the same canonical
request SHA-256 and normalized response SHA-256. Display-only generation time
and HTML serialization are not used as the reproducibility oracle.

- [ ] **Step 2: Verify the frozen algorithm directories are untouched**

Run:

```bash
git diff afb72db -- packages/aica_transparent_hybrid_trigger_v1 \
  packages/aica_transparent_service_selector_v1 \
  packages/aica_transparent_content_selector_v1
```

Expected: empty output.

- [ ] **Step 3: Run backend verification**

Run:

```bash
cd app/api
PYTHONPATH=../..:. .venv/bin/pytest -q \
  tests/test_combined_case_contract.py \
  tests/test_combined_case_integration.py \
  tests/test_semantic_catalog_generator.py \
  tests/test_semantic_catalog_evaluator.py \
  tests/test_semantic_catalog_runner.py \
  tests/test_semantic_catalog_report.py \
  tests/test_merged_quickview.py
```

Expected: all selected tests pass.

- [ ] **Step 4: Run frontend verification**

Run:

```bash
cd app/frontend
npm test -- --run \
  tests/use_case_selection.test.tsx \
  tests/case_resolver.test.ts \
  tests/merged_quickview_ui.test.tsx
npm run build
```

Expected: tests pass and production build succeeds.

- [ ] **Step 5: Audit the HTML as a customer**

Open the report locally and verify:

- exactly 36 visible case summaries and 36 detail sections;
- every filter returns the correct subset;
- every contrast link reaches its paired case;
- every case shows input, result, verdict, and evidence;
- mismatches are as prominent as matches;
- no rest-place/post-rest output is presented as in scope;
- no external request appears in the browser network log;
- Japanese and English text render without replacement characters.

- [ ] **Step 6: Run final hygiene checks**

Run:

```bash
git diff --check
git status --short
sha256sum docs/semantic-combined-test-case-report.html \
  combined_contracts/results/semantic-combined-results.v1.json
```

Expected: no whitespace errors, only intended files, and stable artifact hashes.

- [ ] **Step 7: Commit any verification-only corrections**

```bash
git add -A
git commit -m "test: verify semantic combined catalog"
```
