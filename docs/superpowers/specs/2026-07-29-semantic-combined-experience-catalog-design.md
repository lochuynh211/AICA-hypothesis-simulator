# Semantic Combined Experience Catalog and Customer Report

**Date:** 2026-07-29  
**Status:** Approved for autonomous implementation  
**Scope:** Frozen hybrid trigger, service selector, and content selector on the
Combined screen  
**Primary review artifact:** One self-contained HTML document

## 1. Purpose

The customer needs realistic situations they can recognize, run, and discuss.
The catalog is not a collection of threshold probes disguised as use cases.
Every case starts with a credible driver, a reason for the trip, relevant events
before departure, a route and environment, and a state that changes during the
journey.

Each case asks a plain-language hypothesis:

> Given this real-world driver and journey, should AICA propose a rest or an
> attention-recovery intervention, and are the immediately proposed service and
> content appropriate?

The existing algorithms remain frozen:

- `aica_transparent_hybrid_trigger_v1`
- `aica_transparent_service_selector_v1`
- `aica_transparent_content_selector_v1`

The catalog changes only simulator inputs: scenario, driver profile, history,
preferences, and deterministic run settings. The evaluator observes and
classifies the frozen algorithms' output; it cannot change a score, threshold,
ranking, eligibility decision, or content plan.

## 2. Customer-facing outcome

The implementation produces one portable HTML report that can be opened without
a server. It contains:

1. An executive summary of coverage and verdict counts.
2. A coverage matrix for rest, monotony, service, content, environment, and
   integrated CDC-SU use cases.
3. A card and full detail section for every test case.
4. Exact scenario and driver-profile inputs used by the run.
5. Actual trigger timing, category, score evidence, and firing reason.
6. Actual ranked services and their strongest supporting/opposing evidence.
7. Actual content plan, or a clearly identified content-stage limitation/error.
8. Expected-versus-actual checks and an overall verdict.
9. Pairwise deltas for controlled contrast cases.
10. Known frozen-algorithm limitations discovered by the cases.

The report is the next review checkpoint. The customer does not need to inspect
JSON, source code, test logs, or the live Combined screen to understand a case.

## 3. Scope boundary

### Included

- `rest_required` trigger behavior while the vehicle is moving.
- `monotony_prevention` trigger behavior while the vehicle is moving.
- The immediate ranked service proposal after that trigger.
- The immediate content proposal when the selected rank-1 service supports a
  content plan.
- No-trigger controls that test whether AICA remains quiet.
- Controlled contrasts for journey state, environment, preference, OSHI, and
  recent history.
- Ambiguous/conflicting real-world situations where the frozen algorithms must
  choose between rest and monotony.

### Excluded

- Arrival at a rest spot.
- Actions performed while stopped at the rest spot.
- Naps, recovery activities, post-rest content, and resume-driving behavior.
- Route guidance implementation after accepting a rest.
- New trigger categories.
- Algorithm tuning, replacement, or parameter optimization.
- Claims of medical validation, road-safety certification, or causal validity in
  the physical world.

## 4. Case design grammar

Every authored case contains the following semantic layers.

### 4.1 Purpose-led identity

- Stable ID such as `TC-R01`.
- Title that tells the customer what behavior the case is testing.
- Group: rest, monotony, environment/conflict, service, content, or integrated
  CDC-SU.
- Baseline or contrast role.
- For a contrast, a title suffix in the exact form
  `(contrast with test case ID TC-...)`.

### 4.2 Real-world narrative

- Who is driving.
- Why and where they are driving.
- What happened before the trip.
- State at departure.
- How the state and environment change during the journey.
- Which profile/history facts matter to this hypothesis.
- What AICA should do, in customer language.

Decorative demographic details are excluded unless they affect the experience
or an algorithm input.

### 4.3 Executable setup

- Versioned scenario reference.
- Versioned proposal-world/profile reference.
- Fixed seed, reference timestamp, and tick size.
- Frozen package IDs.
- Initial drowsiness and fatigue.
- Drowsiness, fatigue, anomaly, route, weather, night, passenger, familiarity,
  congestion, and rest-opportunity inputs.
- OSHI identity/mode, service usage/recency, acceptance/recovery, genre
  preference, and track-history inputs where relevant.

The setup must express the story in fields actually consumed by the frozen
pipeline. A narrative statement that is not represented in an algorithm input
is labeled as context only and cannot be used as proof of a verdict.

### 4.4 Hypothesis and checks

Expectations are authored before the corresponding result is adjudicated. They
use semantic sets, windows, ranks, and properties instead of exact floating
point scores.

Checks may cover:

- trigger count;
- trigger category;
- first-fire time window;
- absence of an early or any trigger;
- dominant trigger feature or reason;
- rank-1 service in an acceptable set;
- prohibited driving service;
- expected service evidence direction;
- content-stage success;
- OSHI artist represented in the top-five plan;
- recently skipped item excluded;
- recently played item demoted or absent;
- higher/lower arousal tendency;
- changed outcome or contribution in a contrast pair.

Exact track IDs are used only for identity/history mechanics, where an exact item
is the point of the case.

## 5. Catalog structure

The target catalog contains 36 independently runnable cases:

| Group | Count | Purpose |
|---|---:|---|
| Rest behavior | 6 | Current drowsiness, fatigue, actionability, and quiet controls |
| Monotony behavior | 6 | Familiarity, road monotony, night, congestion, and quiet controls |
| Environment and conflicts | 6 | Passenger, weather, mountain, signal causality, and priority |
| Service personalization | 6 | Usage, acceptance, recovery, rejection, and recency |
| Content personalization | 6 | OSHI, play history, and skip-history mechanics |
| Integrated CDC-SU journeys | 6 | End-to-end stories grounded in the source use cases |

Twelve baseline/contrast pairs are included. The remaining twelve cases are
standalone integrated journeys or conflict cases. A contrast remains a credible
real-world journey; it is never titled only as “factor on/off.”

The exact numeric inputs may be calibrated during execution so the simulator
faithfully represents the authored story. The semantic hypothesis may not be
rewritten merely to make the frozen algorithm pass.

## 6. Controlled contrast rules

A contrast pair declares:

- baseline case ID;
- changed business input;
- baseline and variant values;
- fields allowed to differ because they are identifiers or explanatory text;
- expected observable delta.

For strict mechanics cases, only the declared resolved business input may differ.
For semantic journey contrasts, correlated inputs may change when real-world
coherence requires them—for example a well-rested worker reasonably has both
lower initial sleepiness and slower sleepiness growth. Those cases are labeled
**semantic contrast**, not one-factor sensitivity.

The report distinguishes:

- **Controlled one-factor contrast:** suitable for simulated sensitivity.
- **Semantic real-world contrast:** suitable for customer experience comparison,
  but not a causal attribution claim.

## 7. Execution model

Each case is executed through the same production quickview path used by the
Combined screen:

```text
scenario + initial state
  → tick engine
  → frozen hybrid trigger
  → merged trigger-to-proposal adapter
  → frozen service selector
  → frozen content selector, when supported
  → recorded evidence
  → read-only evaluator
```

The evaluator consumes the completed quickview response. It does not import or
reimplement algorithm formulae to manufacture an expected result.

Every report records:

- execution timestamp;
- case/catalog/schema versions;
- scenario/profile refs;
- package IDs and parameter snapshots;
- deterministic request snapshot;
- all fire events;
- the first in-scope fire selected for evaluation;
- proposal evidence for service and content;
- evaluator version.

## 8. Verdict semantics

Checks use the following statuses:

- `MATCH`: observed output satisfies the authored semantic predicate.
- `MISMATCH`: an observed output contradicts a required predicate.
- `PARTIAL_MATCH`: required outcome is appropriate, but timing, rank, content,
  or causal evidence only partly supports the purpose.
- `NOT_EVALUATED`: an upstream expected event did not occur, so the dependent
  stage could not run.
- `UNVERIFIABLE`: the run completed but the frozen evidence does not expose the
  fact needed for the check.
- `EXECUTION_ERROR`: orchestration or an algorithm stage failed unexpectedly.
- `EXPECTED_LIMITATION`: the observed content-stage limitation is an explicitly
  predicted property of the frozen package boundary, not a hidden pass.

Overall aggregation is deterministic:

1. Any unexpected execution error yields `EXECUTION_ERROR`.
2. Any required output mismatch yields `MISMATCH`.
3. Otherwise any required unverifiable check yields `UNVERIFIABLE`.
4. Otherwise any partial check yields `PARTIAL_MATCH`.
5. Otherwise all checks match and the case yields `MATCH`.

`EXPECTED_LIMITATION` can satisfy a case only when the case explicitly exists to
demonstrate that limitation. It is shown separately from successful product
behavior in summary counts.

The customer-facing wording is:

- **Appropriate for this hypothesis** for `MATCH`.
- **Partly appropriate; review details** for `PARTIAL_MATCH`.
- **Not appropriate for this hypothesis** for `MISMATCH`.
- A direct plain-language explanation for the other states.

These verdicts express fitness against the authored simulator hypothesis, not an
independent safety certification.

## 9. Adjudication rules

1. The hypothesis is authored before inspecting that case's final result.
2. Inputs may be corrected when they fail to encode the intended story.
3. Expectations are not weakened after seeing an undesirable result.
4. A matching visible output for the wrong dominant reason is partial, not full.
5. A missing expected trigger is a trigger mismatch; service/content become
   `NOT_EVALUATED`.
6. A no-trigger control passes only if no in-scope fire occurs during the entire
   declared journey.
7. Content is not fabricated for an unsupported rank-1 service.
8. Frozen-package errors/limitations are reported with their recorded evidence.
9. Multiple fires are retained in the detail view even when the first in-scope
   fire is the evaluation anchor.
10. Numeric traces are evidence, while deterministic prose summarizes them.

## 10. Artifact architecture

### 10.1 Authored source

A compact, reviewable semantic catalog source owns:

- case narratives;
- scenario recipes;
- driver-profile recipes;
- hypotheses;
- checks;
- contrast metadata.

### 10.2 Generated runtime artifacts

Generation produces:

- Combined case JSON files consumed by the current selector.
- Trigger scenario JSON files consumed by the scenario registry.
- Proposal preset/profile JSON files consumed by the existing proposal setup.
- A machine-readable execution/evaluation result JSON.
- The self-contained HTML report.

Generated files carry source and catalog-version provenance. Existing unrelated
presets remain intact.

### 10.3 Compatibility

The existing Combined screen continues to work with its current six presets
while the new catalog is introduced. The new contract adds semantic hypothesis
and result-report fields without changing the frozen packages. The selector uses
the same scenario/profile resolution path and package defaults.

## 11. HTML information design

The report is optimized for customer reading rather than developer debugging.

### Overview

- Title, scope, catalog version, and generation time.
- Frozen algorithm versions.
- Total cases and verdict distribution.
- Plain-language key findings.
- Coverage table.
- Filters for group, trigger expectation, verdict, and contrast role.

### Case summary row

- Case ID and purpose-led title.
- Short real-world story.
- Expected behavior.
- Actual first trigger and timing.
- Actual rank-1 service.
- Actual content summary.
- Overall verdict.

### Expanded case detail

- Full persona and journey.
- “Why this case matters.”
- Exact relevant inputs in readable tables.
- Timeline summary.
- Expected-versus-actual check table.
- Trigger score/reason evidence.
- Ranked service table with contribution highlights.
- Content top-five table with artist, genre, arousal/valence, and fit.
- Error/limitation evidence where applicable.
- Contrast link and delta table.
- Data-scientist adjudication and caveat.
- Collapsible raw request/response evidence for auditability.

The file embeds all CSS, JavaScript, and result data. It makes no network
requests and uses no CDN assets.

## 12. Quality gates

The catalog is complete only when:

1. Exactly 36 case artifacts validate against schema.
2. Every title states its behavioral purpose.
3. Every contrast title names its baseline case ID.
4. Every narrative specifies pre-trip context, trip purpose, initial state, and
   journey evolution.
5. Every case references valid scenario, profile/preset, and package artifacts.
6. Every strict contrast differs only on its declared business input.
7. Every semantic contrast declares why correlated differences are necessary.
8. Every case runs through the production quickview route.
9. Every check has expected, actual, status, and evidence/explanation.
10. The evaluator never mutates algorithm inputs after execution starts.
11. The HTML contains all 36 details and passes structural/accessibility smoke
    checks.
12. Existing Combined contract/integration tests remain green.
13. A fresh catalog execution reproduces the stored semantic results.

## 13. Relationship to the 2026-07-24 deferred design

`2026-07-24-combined-test-case-evaluation-design.md` correctly warns that
algorithm-generated expectations cannot be treated as an independent,
authoritative regression oracle.

This catalog addresses a different, explicitly requested purpose:

- a data scientist authors real-world hypotheses;
- the frozen algorithms are executed;
- the result is judged for customer exploration;
- mismatches and limitations remain visible;
- no verdict is presented as ratified safety ground truth.

If customers later ratify individual expectations, those cases can become
authoritative regression references without changing the frozen execution data
captured here.

## 14. Acceptance criteria

1. A customer can understand every case without knowing an algorithm feature
   name.
2. A customer can see exactly what AICA did after the trigger and why the
   evaluator considered it appropriate, partial, or inappropriate.
3. Rest and monotony are exercised both independently and in realistic conflict.
4. Driver profile, OSHI, service history, content history, environment, and route
   hypotheses are demonstrated through real-world stories.
5. The Combined screen can load the new cases using normal artifacts.
6. All cases are executed against the three named frozen packages.
7. Rest-place and post-rest activity remain out of scope.
8. One self-contained HTML file contains the complete catalog, results,
   evidence, contrast comparisons, limitations, and summary.
