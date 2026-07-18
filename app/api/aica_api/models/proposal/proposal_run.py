"""ProposalRun / ProposalRunLog contracts (data-model.md §"ProposalRun / ProposalRunLog").

``ProposalRun`` is the list/summary shape; ``ProposalRunLog`` is the full
append-only record persisted to ``proposal_runs/<run_id>.json``. Both models
here only hold the shape — append-only enforcement (atomic persist after
each event, no recomputation on reopen) is the responsibility of the run
manager service (T017), not these models.

This module is ISOLATED from trigger models:
  - Do NOT import from ``aica_api.models`` (the trigger package).
  - Enums are imported from ``.enums`` only.
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from aica_api.models.proposal.enums import ProposalRunMode, ProposalRunStatus
from aica_api.models.proposal.events import DiscreteEvent
from aica_api.models.proposal.evidence import AlgorithmEvidence
from aica_api.models.proposal.explanation import Explanation
from aica_api.models.proposal.journey import JourneyState
from aica_api.models.proposal.opportunity import ProposalOpportunity
from aica_api.models.proposal.world import SetupSnapshot, World

__all__ = ["ProposalRun", "ProposalRunLog"]


class ProposalRun(BaseModel):
    """Summary shape for run listings (``GET /api/proposal/runs``)."""

    run_id: str
    status: ProposalRunStatus
    opportunity_id: str
    created_at: str
    service_package_id: str
    content_package_id: str | None
    # P7 addition (data-model.md §"Modified: ProposalRun summary") — additive,
    # defaulted so pre-P7 callers constructing a ProposalRun without `mode`
    # still work.
    mode: ProposalRunMode = ProposalRunMode.interactive


class ProposalRunLog(BaseModel):
    """Full append-only record persisted to ``proposal_runs/<run_id>.json``.

    Rules (enforced by the run manager, not this model): append-only;
    persisted atomically after each event; reopen renders from this log
    without recomputation; created/edited entirely within ``proposal_runs/``
    (never touches trigger ``runs/``).

    ``setup_snapshot`` (P3, feature 014) is an ADDITIVE field: it freezes the
    typed provenance of what produced the run (data-model.md §SetupSnapshot,
    research.md §R6). It is optional and defaults to ``None`` so that
    existing runs persisted before P3 (which only ever populated the opaque
    ``world_snapshot`` dict) still load unchanged. The run-create ENDPOINT
    migration to actually populate ``setup_snapshot`` (and eventually retire
    ``world_snapshot``) is a later P3 task — this model only adds the shape.
    """

    run_id: str
    created_at: str
    opportunity: ProposalOpportunity
    matrix_version: str
    world_snapshot: dict
    setup_snapshot: SetupSnapshot | None = None
    service_package_id: str
    content_package_id: str | None
    parameters: dict
    hyperparameters: dict
    content_parameters: dict = {}
    content_hyperparameters: dict = {}
    journey_state: JourneyState
    events: list[DiscreteEvent]
    evidence: list[AlgorithmEvidence]
    status: ProposalRunStatus
    # P7 additions (data-model.md §"Modified: ProposalRunLog") — additive,
    # all defaulted so a pre-P7 persisted log (none of these keys present)
    # loads unchanged.
    #
    # ``world``: the run's base typed World (typed-world path only); ``None``
    # for legacy world_snapshot-only runs -> recompute 422s (FR-006).
    # ``opportunity_history``/``setup_snapshot_history``: append-only prior
    # decision points, EXCLUDING the current head (``opportunity``/
    # ``setup_snapshot``), oldest -> newest, index-aligned with each other.
    # ``mode``: frozen per-run (interactive/quick_check).
    world: World | None = None
    opportunity_history: list[ProposalOpportunity] = []
    setup_snapshot_history: list[SetupSnapshot] = []
    mode: ProposalRunMode = ProposalRunMode.interactive
    # feature 019 — append-only LLM-narration records (one per generated
    # rationale). Additive/defaulted so pre-019 persisted logs load unchanged.
    # Only the server-side `backend`/`template` providers persist here; the
    # in-browser `browser` provider is display-only and never recorded.
    explanations: list[Explanation] = Field(default_factory=list)
