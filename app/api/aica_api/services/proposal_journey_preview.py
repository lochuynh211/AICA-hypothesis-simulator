"""Pure, read-only journey preview projection (US5 — data-model.md
§"JourneyPreview", contracts/journey-api.md §"GET .../journey/preview";
spec.md User Story 5, FR-017, SC-007).

``preview(run_log) -> JourneyPreview`` is a PURE projection over
``run_log.opportunity.trigger_purpose`` and ``run_log.journey_state.
lifecycle_stage`` (plus the committed CONTENT-step evidence's
``next_transition_policy``, if any, folded into a step's ``note``). It:

  - invokes NO selector,
  - appends NO event/evidence,
  - mutates NO run state,
  - performs NO filesystem/network I/O.

The caller (``routers/proposal.py``'s ``GET .../journey/preview`` route)
must not persist anything either — the run's on-disk file and
``GET /runs/{id}`` response stay byte-identical before and after a preview
(SC-007). ``binding`` is always ``False`` (enforced by the
``JourneyPreview`` model default).

This module is ISOLATED from trigger models/algorithms:
  - Do NOT import from ``aica_api.models`` (the trigger package).
  - Do NOT import from ``aica_api.algorithms``.
"""
from __future__ import annotations

from aica_api.models.proposal.enums import LifecycleStage, TriggerPurpose
from aica_api.models.proposal.journey_preview import JourneyPreview, PreviewStep
from aica_api.models.proposal.proposal_run import ProposalRunLog

__all__ = ["preview"]


# The §3.2 rolling-horizon rest chain, in order. Each entry is
# ``(lifecycle_stage, bilingual_label)`` — mirrors contracts/journey-api.md's
# example response verbatim.
_REST_CHAIN: list[tuple[LifecycleStage, str]] = [
    (
        LifecycleStage.before_rest_until_stop,
        "Now — guide to rest spot / いま — 休憩スポットへ案内",
    ),
    (
        LifecycleStage.during_rest_stopped,
        "At rest — nap / 休憩中 — 仮眠",
    ),
    (
        LifecycleStage.after_rest_before_restart,
        "After rest — stopped full karaoke / 休憩後 — 停車中フルカラオケ",
    ),
]


def _committed_plan_policy(run_log: ProposalRunLog) -> str | None:
    """Return the last committed (non-error) CONTENT-step evidence's
    ``next_transition_policy``, or ``None`` — a pure, read-only lookup over
    the EXISTING evidence list (never dispatches a selector)."""
    for evidence in reversed(run_log.evidence):
        if evidence.step == "content" and evidence.error is None and evidence.output:
            policy = evidence.output.get("next_transition_policy")
            if policy is not None:
                return policy
    return None


def _rest_chain_from(stage: LifecycleStage) -> list[PreviewStep]:
    """The before/during/after-rest chain, starting at the run's CURRENT
    stage and proceeding forward. Falls back to the full chain if ``stage``
    is not itself one of the three rest stages (e.g. a rest_recommended run
    whose journey_state hasn't been driven into the rest stages yet)."""
    start = next((i for i, (s, _) in enumerate(_REST_CHAIN) if s == stage), 0)
    remaining = _REST_CHAIN[start:] or _REST_CHAIN[-1:]
    return [
        PreviewStep(label=label, lifecycle_stage=chain_stage, note=None)
        for chain_stage, label in remaining
    ]


def _active_content_chain(run_log: ProposalRunLog, stage: LifecycleStage) -> list[PreviewStep]:
    """A short current-content -> continue/complete chain for non-rest
    purposes, folding the committed plan's ``next_transition_policy`` (if
    any) into the first step's ``note`` for extra context — never a
    fabricated value; ``None`` when no content plan has been committed yet."""
    policy = _committed_plan_policy(run_log)
    return [
        PreviewStep(
            label="Now — current content continues / いま — 現在のコンテンツを継続",
            lifecycle_stage=stage,
            note=(f"next_transition_policy: {policy}" if policy else None),
        ),
        PreviewStep(
            label="Next — continue or complete / 次へ — 継続または完了",
            lifecycle_stage=stage,
            note=None,
        ),
    ]


def preview(run_log: ProposalRunLog) -> JourneyPreview:
    """Pure, read-only rolling-horizon preview projection — see module
    docstring for the full purity/no-persistence contract."""
    stage = run_log.journey_state.lifecycle_stage
    purpose = run_log.opportunity.trigger_purpose

    if purpose == TriggerPurpose.rest_recommended:
        steps = _rest_chain_from(stage)
    else:
        steps = _active_content_chain(run_log, stage)

    return JourneyPreview(steps=steps)
