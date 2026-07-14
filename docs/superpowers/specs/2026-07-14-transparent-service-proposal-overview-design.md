# Transparent Service-Proposal Overview — HTML Design

**Date:** 2026-07-14  
**Status:** Approved page design awaiting written-spec review  
**Target artifact:** `others/aica_transparent_service_proposal_overview_en_ja.html`

## 1. Purpose

Create a standalone customer-facing HTML document that explains the transparent
service-proposal algorithm defined in
`docs/master/aica_transparent_service_proposal_algorithm.md`.

The page is for beginner customers who need to understand and evaluate the
hypothesis. It must remain technical enough to explain the calculation,
features, candidate responses, editable parameters, and evidence output without
reproducing the full implementation specification.

## 2. Scope

The page covers only the transparent service-proposal algorithm.

It includes enough trigger-purpose, lifecycle, and eligibility context to show
what enters the algorithm and which services may be ranked. It does not explain
the separate trigger algorithm, concrete-content selector, simulator
architecture, or LLM alternative in detail.

## 3. Language and Delivery

- Provide complete Japanese and English content.
- Default to Japanese.
- Use an in-page Japanese/English toggle matching the behavior of
  `docs/master/aica_proposal_overview_en_ja.html`.
- Produce one self-contained HTML file under `others/`.
- Use no external libraries, fonts, images, or network resources.
- Support desktop, narrow-screen horizontal table scrolling, and printing.

## 4. Presentation Approach

Use a guided technical overview rather than a dense reference dashboard or a
lightweight slide deck.

The visual language should follow the existing AICA bilingual overview:

- blue gradient header;
- sticky section navigation;
- cards, callouts, flow steps, and responsive grids;
- bordered, scrollable tables;
- Japanese and English elements controlled by CSS classes;
- accessible semantic headings and controls.

Support, neutrality, and opposition use consistent colors. Safety constraints
must be visually separated from editable ranking weights so customers do not
mistake a weight for a permission rule.

## 5. Page Structure

### 5.1 What the algorithm decides

Explain that the algorithm ranks only already-eligible service candidates and
returns up to three. It does not decide whether a proposal opportunity exists
and does not select concrete songs, modes, or plans.

### 5.2 Safety and eligibility before ranking

Show the order:

1. receive trigger purpose and lifecycle stage;
2. apply the allowed-service and platform eligibility constraints;
3. rank only the remaining candidates;
4. preserve exclusion reasons.

State clearly that no feature, response, or weight can restore an excluded
service.

### 5.3 Five-step transparent calculation

Present this flow:

1. normalize each baseline feature;
2. resolve the candidate response coefficient;
3. calculate the normalized feature response;
4. multiply it by the effective feature weight;
5. sum all feature contributions into `service_fit` and rank descending.

### 5.4 Normalized scales

Explain the ranges with beginner examples:

- raw drowsiness, fatigue, and monotony `[0,100]` become normalized evidence
  `[0,1]`;
- signed evidence and response coefficients use `[-1,+1]`;
- effective weights use `[0,1]` and sum to `1`;
- each feature contribution lies in `[-w_i,+w_i]`;
- `service_fit` lies in `[-1,+1]`, with `0` neutral.

Use inclusive brackets because the endpoints are valid.

### 5.5 Complete baseline feature table

Show all 17 baseline features grouped into Situation, Preference, and History.
Columns:

- group and subgroup;
- feature;
- raw input example/type;
- normalization rule;
- normalized range;
- beginner interpretation.

### 5.6 Candidate-response matrix

Use a scrollable color-coded matrix. Rows are candidate service families or
explicit service candidates; columns are the meaningful baseline features or
feature groups.

Cell notation:

- `--` / `-1.0`: strongly opposes;
- `-` / `-0.5`: opposes;
- `0` / `0.0`: neutral;
- `+` / `+0.5`: supports;
- `++` / `+1.0`: strongly supports.

Include a legend and explain that the coefficient means how a service responds
to evidence, not how important the feature is. Where a full candidate-level
matrix would be too wide, use separate matrices for driving services and rest
services rather than omitting response information.

### 5.7 Hierarchical weights and trigger-purpose adjustment

Explain the initial top-level weights:

- Situation `0.80`;
- Preference `0.12`;
- History `0.08`.

Show category → subgroup → feature weight multiplication and the purpose
multiplier followed by final normalization. Explain that weights mean
importance, while response coefficients mean direction and compatibility.

### 5.8 Formula and interpretation

Show the formulas:

    normalized_feature_response_i(c)
      = normalized_evidence_i(c) * response_coefficient_i(c)

    feature_contribution_i(c)
      = effective_weight_i * normalized_feature_response_i(c)

    service_fit(c)
      = sum_i(feature_contribution_i(c))

Explain `-1`, `0`, and `+1`, and state that service fit is not a probability,
effectiveness measurement, or safety certification.

### 5.9 Worked example

Use the humming-karaoke inattentive-driving example from the detailed
specification. Show a readable subset of the strongest contributions, the
Situation/Preference/History subtotals, and the final approximately `+0.778`
service fit. Provide a disclosure control or secondary table for the complete
17-row arithmetic so the overview stays approachable without hiding evidence.

### 5.10 Customer tuning

Explain what customers may edit:

- category, subgroup, and feature weights;
- trigger-purpose multipliers;
- normalization curve and saturation hyperparameters;
- advanced candidate response coefficients.

Explain recommended tuning order and that every change creates a new
versioned hypothesis. Show the dominance warning as advisory and
evidence-visible, never as a silent correction.

### 5.11 Limits and evidence output

Summarize missing-as-neutral behavior, invalid-input blocking, deterministic
tie-breaking, evidence provenance, and reproducibility. End with a clear list
of what the model does not claim.

## 6. Interaction and Accessibility

- Language buttons must expose active state and update the document language.
- Navigation links must target stable section IDs.
- Tables must retain headers and be horizontally scrollable on narrow screens.
- Meaning must not rely on color alone; every response cell includes notation
  or text.
- Text contrast must remain readable in screen and print modes.
- JavaScript is limited to language switching and optional disclosure controls.

## 7. Validation

Before delivery:

- confirm valid document structure and balanced HTML tags;
- confirm Japanese is visible by default and each language button works;
- confirm all 17 features appear in the feature table;
- confirm formulas and ranges match the detailed Markdown specification;
- confirm the worked example reconciles to approximately `+0.778`;
- confirm no point-scale or `[0,100]` service score remains;
- confirm no placeholder text, external dependency, or unrelated algorithm
  content is present;
- inspect desktop and narrow viewport renderings;
- verify print CSS does not hide the substantive content.

## 8. Acceptance Criteria

The artifact is acceptable when a beginner customer can answer:

1. what the algorithm ranks and what it does not decide;
2. why excluded services cannot be restored by scoring;
3. how a raw feature becomes normalized evidence;
4. the difference between a feature weight and candidate response;
5. how contributions sum to `service_fit` in `[-1,+1]`;
6. which parameters customers may edit;
7. why the result is explainable but not a probability or certification.
