"""aica_transparent_service_selector_v1 — the REAL transparent service-fit
scorer (P5, `docs/master/aica_transparent_service_proposal_algorithm.md`).

Unit A (specs/016-proposal-p5-transparent-service-selector, T001) ships only
the package SKELETON: a manifest that validates and registers into the
`service_selector`/`transparent` slot, and this stub entrypoint. NO scoring
math lives here yet — that is Unit B/US1 (`FeatureNormalizer`,
`WeightResolver`, `ResponseResolver`, `CandidateScorer`, `Ranker`; see
tasks.md T015-T017).

Contract (unchanged from `mock_service_selector_v1`):
  evaluate(context: dict) -> dict   # SelectorInput-shaped in,
                                     # ServiceSelectorOutput-shaped out

Rules this package MUST preserve once implemented (see the algorithm doc and
`specs/016-proposal-p5-transparent-service-selector/data-model.md`):
  - Ranked candidates are drawn ONLY from `context["allowed_service_ids"]`.
  - Pure dict in / dict out. No imports of `aica_api`. No file/network I/O,
    no clock, no randomness — identical input always yields identical output.
  - Every `parameters`/`hyperparameters` cell used by the scorer is read from
    this package's own `package.json` (never hard-coded numerics).
"""
from __future__ import annotations


def evaluate(context: dict) -> dict:
    """Real transparent service-fit scorer — NOT YET IMPLEMENTED (Unit A stub).

    Raises ``NotImplementedError`` unconditionally. `dispatch_selector`
    (`aica_api.services.proposal_selector`) converts any exception raised
    here into an `AlgorithmEvidence.error` (category `algorithm_exception`)
    — never a fabricated result — so this stub is safe to register into the
    live package registry ahead of the real implementation landing in a
    later P5 unit.
    """
    raise NotImplementedError(
        "aica_transparent_service_selector_v1.evaluate() is not implemented yet "
        "(P5 Unit A ships the package skeleton only; the real scorer lands in "
        "Unit B / US1 — see specs/016-proposal-p5-transparent-service-selector/tasks.md T015-T017)."
    )
