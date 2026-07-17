# Service-selector fixtures (P5)

Frozen golden worlds for `aica_transparent_service_selector_v1`
(`packages/aica_transparent_service_selector_v1/`), authored by hand from
**`docs/master/aica_transparent_service_proposal_algorithm.md` §10 (Worked
example) and §11 (Contrast behavior)**.

These fixtures are **never score-derived** — every field value here is taken
directly from the algorithm doc's worked-example / contrast narrative, and
the expected golden scores recorded alongside them (`worked-example.json` →
`humming_karaoke = +0.772349`; `contrast-*.json` → documented reorder
directions) are the doc's own numbers, not numbers produced by running the
implementation and capturing its output. A fixture that drifted from the doc
would be a bug in the fixture, not a new "expected" value to chase.

- `worked-example.json` — the §10 inattentive② world.
- `contrast-*.json` — the §11 one-field contrast pairs (added in a later P5
  unit; see `specs/016-proposal-p5-transparent-service-selector/tasks.md`
  T033).

Consumed by `app/api/tests/proposal/test_p5_service_math.py`,
`test_p5_contrast_golden.py`, and friends — never by the package itself
(`evaluate()` never opens a file).
