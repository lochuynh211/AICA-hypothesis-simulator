---
paths:
  - "ivi-building/**"
---

# You are in the ivi-building project

`ivi-building/CLAUDE.md` governs this work and **takes first priority over the repository-root
`CLAUDE.md`**. Read it now if it is not already in context.

This is the **IVI process agent harness**, not the AICA simulator. Two consequences that bite
immediately:

- **`docs/master/`, `app/`, `htmlapp/`, `specs/`, and `combined_contracts/` are this project's expected
  output, not its input.** A `PreToolUse` firewall hook denies reading them during Phases ①–②. Never
  work around it; if a step appears to need one, either the step is wrong or the domain pack is missing
  a source.
- **Terminology is the process documents', used exactly:** 3 **phases**, 16 **activities**, 236 **work
  items**. Activities are not phases.

Design document: `docs/superpowers/specs/2026-09-01-ivi-process-agent-harness-design.md`.
</content>
