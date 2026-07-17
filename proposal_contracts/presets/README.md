# Proposal presets (feature 018)

Committed, read-only **preset test-cases**: each binds a coherent situation +
driver profile into one selectable unit, with a bilingual brief, a
machine-checkable `expectation` contract, and optional isolated
`algorithm_config_overrides`.

**Generated, never hand-edited.** Produced by `scripts/generate_presets.py` from
compact author-specs (idempotent: same specs + same frozen catalog => byte-
identical output; a golden test pins it). To change a preset, edit the spec in
the generator and re-run:

    cd app/api && uv run python ../../scripts/generate_presets.py

18 presets across 9 families with 7 contrast pairs. Every preset's real measured
outcome is asserted against its `expectation` by
`app/api/tests/proposal/test_presets_expectations.py`.
