# AICA Proposal Simulator — Milestone Implementation Session Prompt Template

**How to use:** start a fresh implementation session, change only the `{{MILESTONE}}` value below to one milestone from `P1` through `P11`, then paste the block between the markers as the first message. Implement one milestone per session. `P0` is the approved design/feature-contract freeze and is not an implementation session.

===================== BEGIN PROMPT =====================

**PARAMETER — change only this value:** `{{MILESTONE}}` = `P2`

You are implementing milestone **{{MILESTONE}}** from `docs/master/aica_proposal_simulator_milestones.md` in the AICA Hypothesis Simulator repository.

This is a fresh session. Do not rely on prior conversation memory. Derive the milestone title, scope, dependencies, acceptance criteria, verification focus, and branch slug from the repository. Complete the following five steps in order.

You are authorized to create a feature branch, edit documentation and code, run the application and tests, and make logical commits. Preserve unrelated user changes. Do not merge or push unless explicitly requested.

The two planned interactive checkpoints are Step 2 design approval and Step 3 clarification. Otherwise continue autonomously, stopping only for a genuine blocker such as an unmet milestone dependency, an unresolved specification contradiction, unavailable required credentials/data with no deterministic fallback, or a failing gate that cannot be repaired safely.

---

## Step 1 — Grounding and dependency gate

Before editing anything:

1. Read the repository instructions (`AGENTS.md` when present, `CLAUDE.md`, and `.specify/memory/constitution.md`). Treat current code, current master documents, and the constitution as authoritative when older guidance is stale.
2. Read the complete **{{MILESTONE}}** section in `docs/master/aica_proposal_simulator_milestones.md`, plus its cross-milestone quality gates and relevant Appendix A feature contract.
3. Read the relevant parts of:
   - `docs/master/aica_proposal_simulator_specification.md` — the consolidated spec (product boundary, contracts, acceptance criteria);
   - `docs/master/aica_transparent_service_proposal_algorithm.md` and `docs/master/aica_transparent_content_proposal_algorithm.md` — the **authoritative** transparent-scoring math, weights, gating, and explainability (they supersede the placeholder scoring in the design decision record);
   - `docs/master/aica_synthetic_music_data_and_generation_specification.md` — the Spotify-compatible dataset, its staged generator, validation, tiers, base worlds, and contrasts;
   - `docs/master/aica_proposal_overview_en_ja.html` — the approved 4-panel first-screen UI/UX;
   - `docs/master/aica_proposal_design_reference_draft.md` — the design **decision record** (product/architecture rationale, the constrained-LLM package family, the full/raw feature inventory, non-feature exclusions); it is not the implementation contract;
   - `docs/master/aica_hypothesis_simulator_specification.md`;
   - `docs/master/aica_hypothesis_simulator_architecture.md`;
   - `docs/master/aica_hypothesis_simulator_runtime_workflow.md`;
   - the existing SpecKit feature artifacts under `specs/` that own code or contracts this milestone will extend.
4. When source traceability matters, read the relevant slides in `others/CDC-SU_specplan.md` and the relevant rules in `others/aica_stage_constrained_llm_proposal_selector_spec.md`. Do not reinterpret the approved feature tables without raising the change in Step 2. Check the milestone document's **§17 Open Source-Reconciliation Items** for known cross-document divergences that touch this milestone (e.g. the post-rest 4-vs-5 candidate count) and resolve them with written rationale before freezing a contract.
5. Inspect the current implementation. If `.codegraph/` exists, use CodeGraph before text search when locating or understanding code. Identify the exact backend, frontend, package, persistence, and test seams this milestone changes. Determine whether `htmlapp/` synchronization is required; do not duplicate changes blindly.
6. Verify that every prerequisite milestone is actually present and passing on the current `develop` baseline. Never emulate a missing dependency inside the new milestone.
7. Check the worktree and create a dedicated branch from `develop` named `proposal-<milestone-lowercase>-<short-slug>` unless the user has already provided an appropriate branch/worktree.

Produce a concise **Grounding Recap** containing:

- milestone goal and customer-visible outcome;
- exact in-scope and out-of-scope work;
- acceptance criteria and verification focus;
- prerequisite milestones and evidence they are present;
- existing files/symbols/contracts to extend;
- expected test and end-to-end commands;
- specification conflicts or stale guidance discovered.

If a required dependency is missing or the authoritative documents materially contradict each other, stop and report the blocker. Otherwise continue to Step 2.

## Step 2 — Design the milestone ⟪STOP: interactive approval⟫

Use the superpowers brainstorming workflow to design **{{MILESTONE}}** with the user. Cover only decisions needed for this milestone:

- smallest runnable vertical slice;
- backend/frontend/package boundaries;
- request, response, persistence, event, and evidence contracts;
- simulator state and discrete-event behavior;
- safety and eligibility behavior;
- synthetic data/catalog requirements;
- migration and compatibility with the existing trigger simulator;
- test strategy, failure behavior, and milestone exit demonstration.

Present alternatives where a material choice exists and state a recommendation. Do not implement until the user approves the design.

After approval, without another proceed question:

1. Record the agreed design in `docs/superpowers/specs/<date>-proposal-<milestone-lowercase>-design.md`.
2. Reconcile affected master documents only where the approved decision changes or clarifies them. Keep the main specification, design reference, milestone plan, and presentation consistent.
3. Self-review for placeholders, contradictions, unclear ownership, and scope leakage.
4. Commit the approved documentation as one logical checkpoint.

Then continue to Step 3.

## Step 3 — Create and validate the executable plan ⟪clarification is interactive⟫

Use this repository's SpecKit workflow and the next valid feature number:

1. `speckit-specify` — create the milestone feature specification from the approved design and master documents.
2. `speckit-clarify` — ask the user only the unresolved questions that materially affect behavior or acceptance. **Stop here until clarification is complete.** Encode every answer into the specification.
3. `speckit-plan` — create the technical plan and contract/data-model artifacts. The constitution check must pass.
4. `speckit-tasks` — create dependency-ordered, vertical-slice-first tasks with exact files and verification commands.
5. `speckit-analyze` — check cross-artifact consistency. Repair every reported issue and rerun until clean.

The plan must map every milestone acceptance criterion to at least one implementation task and one verification step. It must preserve independently selectable service/content algorithm packages and must not hide proposal behavior inside generic trigger code.

Commit the clean specification and plan, then continue to Step 4.

## Step 4 — Using Superpowers /subagent-driven-development with TDD style to implement the milestone

Execute the approved tasks one at a time using superpowers subagent-driven implementation with TDD development:

1. Write a failing contract, unit, integration, or UI test for the current behavior slice.
2. Run it and confirm it fails for the intended reason.
3. Implement the smallest coherent change that makes it pass.
4. Refactor without changing behavior.
5. Run the affected test layers and review the work unit before moving on.
6. Post a short progress update after each logical task and commit at stable checkpoints.

Use the commands that the current repository actually defines. At minimum, evaluate and run the applicable gates:

```bash
cd app/api && uv run pytest
cd app/frontend && npm test
cd app/frontend && npm run build
docker compose config
```

If `htmlapp/` is intentionally affected, run its required sync, unit, build, and applicable Playwright gates according to the repository's current policy. For an end-to-end milestone, run the containerized application and exercise the real user flow; unit tests alone are insufficient.

Do not weaken existing trigger behavior or tests to make proposal work pass. If a contract changes, update backend validation, frontend types, persistence/evidence, package fixtures, and tests together.

## Step 5 — Verify and close the milestone

Use the verification-before-completion and code-review workflows before claiming success.

1. Run all targeted tests, then the full applicable backend/frontend/build gates from Step 4.
2. Exercise the milestone's real end-to-end review flow and record evidence for every acceptance criterion.
3. Verify deterministic replay/persistence where applicable and confirm failures are visible rather than converted into normal proposals.
4. Confirm the existing trigger simulator still works and that proposal setup/run state remains isolated unless this milestone explicitly introduces a reviewed adapter.
5. Review the whole branch for contract drift, unsafe driving behavior, hidden package coupling, ungrounded LLM output, incomplete bilingual UI, and accidental edits to generated artifacts.
6. Fix critical and high-severity findings, rerun affected gates, and update the SpecKit artifacts and master documents to match the implementation.

Finish with a **Milestone Completion Report** containing:

- what shipped;
- files/contracts/packages added or changed;
- acceptance-criterion evidence;
- exact test/build/end-to-end results;
- compatibility result for the current trigger simulator;
- known limitations and explicitly deferred work;
- branch and commit summary.

Then stop. Do not merge or push until the user asks.

---

## Project invariants for every milestone

- The backend remains the runtime and evidence authority; frontend calculations are display-only.
- Proposal simulation uses a separate standalone **4-panel screen** (① Input · ② Setup · ③ Service proposal · ④ Content proposal) and simulation context on the same backend. It must remain composable with the trigger simulator later.
- V1 proposal progression is discrete event-driven. A future tick adapter must not be required for standalone operation.
- `trigger_purpose`, `lifecycle_stage`, and stage-allowed services are explicit control inputs, not inferred preference scores.
- Safety and eligibility dominate ranking (the continuous dominance invariant `W_D · material_safety_gap > 2·W_L`), but the system remains advisory: it proposes and never forces the driver.
- Service selection and concrete-content selection are separate algorithms. Transparent and LLM implementations are separate packages. Packages share contracts and hard constraints, never scores or rankings.
- Transparent service scoring is `service_fit = clamp(Σ wᵢ·rᵢ, −1, +1)`; transparent content scoring is `item_fit = clamp(Σ wᵢ·eᵢ·aᵢ, −1, +1)` with the two-axis (arousal/valence) song-trait model. Song traits (arousal, valence, humming_ease, full_karaoke_ease) are derived at decision time from Spotify Audio Features and never stored as catalog metadata.
- The Section 8 service feature table and Section 9 content feature table are independent complete contracts. CDC-SU rows and `Additional proposed` rows retain visible provenance. Every contract row is marked used, `context_only`, or `available_but_not_used` — never silently dropped.
- LLM packages may select only supplied candidates/catalog records and must cite supplied evidence. They may not invent user facts, services, content, schedules, or safety claims.
- V1 uses a built-in, **frozen, versioned Spotify-compatible music dataset** that is **Soundcharts-grounded** (P2): real data is harvested from the Soundcharts API and mapped into the schema via the **S0–S9 pipeline** (see `docs/master/p2-soundcharts-grounded-data-generation-design.md` and data spec §0), keeping **real names + verbatim real audio** while IDs/URLs stay synthetic; worlds/histories are grounded to catalog IDs; editable worlds only, no customer catalog import. The committed frozen dataset (not a model rerun of the harvest) is the replay boundary; **no live LLM/network call occurs during a transparent simulation run** — the harvest is one-time offline, cached, and the transform raw-cache→catalog is byte-identical.
- Every record has **synthetic IDs (`synthetic-…`) and `.invalid` links** (enforced), keeps **real song/artist names** and verbatim real audio, and is schema/range/identity/coverage-valid, versioned, and hash-stamped before use. Catalog selection is **coverage-driven, never score-driven**; the catalog is label-free (no `recommended`/`best_for_world`/`target_rank`), and a separate labeled **test-case set** is judged by the LLM **blind** with the P6 score as a cross-check. The `genre_affinity_v1` extension is opt-in; with it off, the six genre-scored content features are `context_only` and reproduce the no-extension result exactly.
- Evidence separates simulator facts from human review and does not claim customer validation as objective correctness.
- Japanese and English are supported, with Japanese as the default presentation language.
- Generated artifacts (including the synthetic dataset and any generated HTML/data) are changed through their generators/schema-aware editors, never edited directly.
- Preserve unrelated work and never use destructive Git operations.

====================== END PROMPT ======================

## Notes

- Use one fresh session per milestone. Later milestones must verify earlier milestone outputs rather than reimplementing them.
- This template intentionally stays short relative to the reference cycle template. The milestone document, the consolidated specification, the two transparent-algorithm docs, the synthetic-data-and-generation spec, the overview UI/UX, the design decision record, the constitution, SpecKit artifacts, and current code provide the details.
- P2 is the music-dataset generation milestone: it delivers the **Soundcharts-grounded** offline generator (S0–S9 pipeline) + deterministic validator/repair loop that freezes the versioned dataset every later milestone consumes, plus a labeled test-case set. See `docs/master/p2-soundcharts-grounded-data-generation-design.md` and data spec §0. Treat it as tooling that produces a committed, reproducible artifact (transform reproducible from a cached one-time harvest), not a runtime feature.
- The five-step structure is fixed; milestone-specific scope is derived during Step 1.
