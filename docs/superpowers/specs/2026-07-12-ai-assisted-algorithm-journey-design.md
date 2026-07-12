# AI-Assisted Algorithm Journey — Presentation Design

## Purpose

Create a self-contained English HTML presentation in `others/` that explains how a team and AI can collaboratively turn project material into an algorithm specification, implement it, gather feedback, and improve it through repeated cycles. The AICA Hybrid Trigger is the concrete example, but the presentation must remain reusable for future projects.

## Audience and communication level

The primary audience is a mixed, largely non-technical team. Every stage must first be explained in plain business language. Technical details may appear in compact examples or expandable sections, but the main story must remain understandable without mathematics or programming knowledge.

The presentation must avoid implying that AI independently invents or validates an algorithm. It will show human responsibilities, AI assistance, review gates, evidence, and iteration at every stage.

## Format

- One dependency-free HTML file with embedded CSS and JavaScript.
- A responsive, vertical scroll narrative that works in a browser, on a projector, and when printed to PDF.
- A polished visual system that can be reused by replacing project-specific content and accent colors.
- Lightweight navigation, progress indication, and expandable technical detail where useful.
- No external fonts, frameworks, images, or network requirements.

## Narrative structure

1. **Opening:** The outcome and central message: algorithm creation is a managed learning cycle, not a one-shot prompt.
2. **Cycle overview:** Input → Understand → First idea → Specify → Implement and test → Review → Improve → Repeat.
3. **Team capability map:** Domain analysis, use-case analysis, data science, algorithm design, software engineering, testing and validation, facilitation, and documentation.
4. **Exact input set:** Clearly state that AI needs the complete source set, including a project overview (for example, the overall music-project overview), all four use cases, business constraints, available signals/data, expected outputs, and success/safety criteria. Real file names are unnecessary.
5. **Input preparation:** Show how the team removes contradictions, marks assumptions, identifies missing facts, and establishes a shared vocabulary before algorithm ideation.
6. **First algorithm idea:** Present the initial AICA direction in accessible terms: combine transparent rules with weighted signals, then use state, persistence, and firing controls to avoid unstable or repetitive proposals.
7. **Idea-generation rationale:** Explain how requirements map to algorithm components and why transparency, tunability, traceability, and safety boundaries guided the hybrid approach.
8. **Specification:** Show the specification as a contract: inputs, feature transformations, scores, states, decision rules, outputs, parameters, edge cases, and explanation/evidence requirements.
9. **Implementation and testing:** Translate the specification into executable behavior, connect it to the simulator, test normal/boundary/failure cases, and compare results with intended use-case behavior.
10. **Feedback:** Capture domain, product, technical, and observed-run feedback as structured evidence rather than vague comments.
11. **Improvement:** Show representative refinements visible in repository history, such as compact tiered features, time-on-task handling, clearer formulation, single-source defaults, recovery behavior, and UI explanation improvements.
12. **Reusable operating model:** Provide prompt/input guidance, stage deliverables, human review gates, a definition of done, and a compact checklist teams can copy into the next project.
13. **Closing:** Emphasize that AI accelerates synthesis and iteration, while people remain accountable for context, judgment, validation, and approval.

## Visual design

Use a dark navy foundation with luminous cyan/blue and warm amber accents. The cycle is the main visual motif, supported by numbered stage cards, artifact chips, role markers, before/after comparisons, and a horizontal or circular process diagram. Motion must be restrained and respect `prefers-reduced-motion`.

Content density will alternate between concise full-width statements and structured cards. Technical material should be visually subordinate to business meaning. Important warnings—such as incomplete inputs producing confident but weak specifications—will use a distinct caution treatment.

## Interaction and accessibility

- Sticky section navigation and reading progress.
- Expand/collapse controls for optional detail.
- Semantic headings, keyboard-accessible controls, visible focus states, sufficient contrast, and reduced-motion support.
- Print rules that remove navigation controls, expand important content, and preserve readable page breaks.
- JavaScript is enhancement-only; the complete story remains readable if scripting is unavailable.

## Content accuracy rules

- Separate repository-backed AICA history from generic recommended practice.
- Use input categories and friendly labels instead of exposing unnecessary exact source-document names.
- Explicitly show all four use cases as required inputs, even if the worked algorithm focuses most heavily on a subset.
- Mark assumptions and illustrative examples as such.
- Do not claim that implementation or tests prove real-world safety or business effectiveness.

## Verification

- Validate the HTML structure and confirm it opens without network access.
- Check desktop and narrow viewport rendering.
- Verify navigation, expand/collapse behavior, keyboard focus, and reduced-motion behavior.
- Check print preview or print CSS behavior.
- Scan visible copy for placeholders, contradictions, unexplained jargon, and accidental Japanese text in this English version.

