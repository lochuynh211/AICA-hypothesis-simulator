"""declarative_rule algorithm (T013) — porting evaluate_trigger.mjs to Python.

Pure, deterministic, side-effect-free.  Same inputs → same DecisionResult.
All values are qualitative ordinals; no raw numbers enter the decision path.

Decision flow (first-match R1–R5):
  R1  SEVERE_INTERVENTION        drowsiness=severe OR damped ≥ severeCut
  R2  NO_PRACTICAL_ACTION_FALLBACK  damped ≥ proposalCut AND rest NOT reachable
  R3  REST_PROPOSAL               damped ≥ proposalCut AND rest reachable
  R4  SOFT_WARNING                damped ≥ reactionPoint
  R5  NO_TRIGGER                  catch-all

Cut-points (ordinal arithmetic, hyperparameter-driven):
  reactionPoint = 1.8 − ord(trigger_sensitivity) × 0.4
  proposalCut   = 2.0 + ord(proposal_threshold)  × 1.0
  severeCut     = 3.0 + ord(severe_threshold)    × 1.0

Blend and persistence damping (porting functional skeleton):
  blend  = drowsiness×(0.5+0.25×wD) + fatigue×(0.2×wF) + drive×0.4
  damped = max(0, blend − shortfall + persistenceLift)
    shortfall       = max(0, (req+1) − dur)
    persistenceLift = max(0, dur−1) × 0.6

wD and wF default to 1 (medium) when absent from the hyperparameters dict.
"""

from __future__ import annotations

from aica_api.models.decision import (
    Candidate,
    DecisionResult,
    FireControl,
    Proposal,
    ResultType,
)

# ---------------------------------------------------------------------------
# ORD table (mirrors the JS ORD constant in evaluate_trigger.mjs exactly)
# Key insight: "moderate" is set once (ord=2, from the drowsiness group) and
# shared across features.  continuous_driving_time="moderate" therefore maps
# to ord=2 — the same value as "long" — which preserves prototype fidelity.
# ---------------------------------------------------------------------------

_ORD: dict[str, int] = {
    # drowsiness_level
    "none": 0, "weak": 1, "moderate": 2, "strong": 3, "severe": 4,
    # fatigue_level / band weights / thresholds / sensitivities
    "low": 0, "medium": 1, "high": 2,
    # signal_duration
    "transient": 0, "brief": 1, "sustained": 2, "persistent": 3,
    # continuous_driving_time — "moderate" already defined above (→ 2)
    "short": 0, "long": 2,
    # rest_spot_eta — "none" already defined above (→ 0)
    "near": 1, "far": 2,
}


def _ord(value: object) -> int:
    """Return the ordinal position of a qualitative band value (default 0)."""
    if isinstance(value, str) and value in _ORD:
        return _ORD[value]
    return 0


def _resolve_ordinals(ctx: dict) -> dict:
    """Extract the ordinal bands dict from either M1 (flat) or M2 context.

    For M2 context (with feature_groups.ordinal): returns the ordinal sub-dict.
    For M1 context (flat string values at the top level): returns ctx directly.

    This lets the algorithm work with both context formats without branching
    throughout every helper.
    """
    fg = ctx.get("feature_groups")
    if isinstance(fg, dict):
        ordinal = fg.get("ordinal")
        if isinstance(ordinal, dict):
            return ordinal
    return ctx


# ---------------------------------------------------------------------------
# Stage 1: blend danger signals
# ---------------------------------------------------------------------------


def _blend(ordinals: dict, hp: dict) -> float:
    """Weighted ordinal blend of drowsiness, fatigue, and driving time.

    The blend is ordinal arithmetic — all values are positions in an
    ordered band catalog, never raw magnitudes.

    Args:
        ordinals: The resolved ordinal bands dict (from _resolve_ordinals).
        hp:       Hyperparameters dict.
    """
    w_d = _ord(hp.get("weight_drowsiness", "medium"))  # 0..2, default medium
    w_f = _ord(hp.get("weight_fatigue", "medium"))      # 0..2, default medium
    drowsiness = _ord(ordinals.get("drowsiness_level", "none"))
    fatigue = _ord(ordinals.get("fatigue_level", "low"))
    drive = _ord(ordinals.get("continuous_driving_time", "short"))
    return drowsiness * (0.5 + 0.25 * w_d) + fatigue * (0.2 * w_f) + drive * 0.4


# ---------------------------------------------------------------------------
# Stage 2: persistence damping
# ---------------------------------------------------------------------------


def _damped(ordinals: dict, hp: dict) -> float:
    """Damp the blend by signal persistence.

    A signal that is too brief relative to the persistence_requirement is
    damped; a sustained/persistent signal lifts the reading.

    Args:
        ordinals: The resolved ordinal bands dict (from _resolve_ordinals).
        hp:       Hyperparameters dict.
    """
    blend = _blend(ordinals, hp)
    dur = _ord(ordinals.get("signal_duration", "transient"))   # 0..3
    req = _ord(hp.get("persistence_requirement", "medium"))  # 0..2
    shortfall = max(0, (req + 1) - dur)
    persistence_lift = max(0, dur - 1) * 0.6
    return max(0.0, blend - shortfall + persistence_lift)


# ---------------------------------------------------------------------------
# Stage 3: cut-points
# ---------------------------------------------------------------------------


def _reaction_point(hp: dict) -> float:
    return 1.8 - _ord(hp.get("trigger_sensitivity", "medium")) * 0.4


def _proposal_cut(hp: dict) -> float:
    return 2.0 + _ord(hp.get("proposal_threshold", "medium")) * 1.0


def _severe_cut(hp: dict) -> float:
    return 3.0 + _ord(hp.get("severe_threshold", "medium")) * 1.0


# ---------------------------------------------------------------------------
# Actionability guard
# ---------------------------------------------------------------------------


def _rest_reachable(ordinals: dict, hp: dict) -> bool:
    """Return True if a rest action is practically reachable.

    Mirrors ``restReachable`` in evaluate_trigger.mjs:
      - require_actionable=False → always reachable.
      - rest_spot_eta='none'    → not reachable.
      - rest_spot_eta='far' AND rest_spot_sensitivity=low → not reachable.
      - Otherwise               → reachable.

    Args:
        ordinals: The resolved ordinal bands dict (from _resolve_ordinals).
        hp:       Hyperparameters dict.
    """
    if hp.get("require_actionable", True) is not True:
        return True
    eta = ordinals.get("rest_spot_eta", "none")
    if eta == "none":
        return False
    if eta == "far" and _ord(hp.get("rest_spot_sensitivity", "medium")) == 0:
        return False
    return True


# ---------------------------------------------------------------------------
# Candidate and result builders
# ---------------------------------------------------------------------------


def _make_candidate(
    *,
    category: str,
    score: float,
    exists: bool,
    fired: bool,
    suppressed: bool,
    strength: str | None,
    reason: str,
) -> Candidate:
    return Candidate(
        category=category,
        exists=exists,
        score=score,
        state=None,
        strength=strength,
        fire_control=FireControl(
            fired=fired,
            suppressed=suppressed,
            override=False,
            reason=reason,
        ),
    )


def _fire_control(*, suppressed: bool, reason: str | None) -> FireControl:
    return FireControl(fired=not suppressed, suppressed=suppressed,
                       override=False, reason=reason)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def evaluate(
    context: dict,
    parameters: dict,  # noqa: ARG001 — setup-time, not used by rule engine
    hyperparameters: dict,
) -> DecisionResult:
    """Evaluate the declarative_rule algorithm and return a full DecisionResult.

    Args:
        context:        Fully-banded tick context (string values only).
        parameters:     Setup-time parameters (unused by the rule engine in M1).
        hyperparameters: Tuning bands from the package manifest defaults
                        (possibly overridden by the user at setup time).

    Returns:
        A fully-populated ``DecisionResult`` with the §11 normalized shape.
        Hybrid-only fields (``scores``, ``states``,
        ``next_package_runtime_state``) are always empty for this algorithm.
    """
    hp = hyperparameters
    # Resolve M2 (feature_groups.ordinal) or M1 (flat) context to the ordinal bands dict.
    ordinals = _resolve_ordinals(context)
    damped = _damped(ordinals, hp)
    reaction = _reaction_point(hp)
    prop_cut = _proposal_cut(hp)
    sev_cut = _severe_cut(hp)
    reachable = _rest_reachable(ordinals, hp)

    criteria = {
        "reaction_point": reaction,
        "proposal_cut": prop_cut,
        "severe_cut": sev_cut,
    }
    # Features come from the ordinal bands dict, not from the raw context.
    # This ensures raw_state numerics and feature_groups dicts are excluded.
    features = {k: v for k, v in ordinals.items() if isinstance(v, str)}

    # ------------------------------------------------------------------
    # R1 — SEVERE_INTERVENTION
    # ------------------------------------------------------------------
    if ordinals.get("drowsiness_level") == "severe" or damped >= sev_cut:
        if context.get("drowsiness_level") == "severe":
            reason_inputs = ["drowsiness_level"]
            explanation = "Drowsiness is at the severe level — immediate intervention required."
        else:
            reason_inputs = [
                "drowsiness_level", "fatigue_level", "signal_duration",
                "weight_drowsiness", "severe_threshold",
            ]
            explanation = (
                "Damped fatigue/drowsiness blend reached the severe cut-point."
            )
        candidate = _make_candidate(
            category="rest_required", score=damped, exists=True,
            fired=True, suppressed=False, strength="severe",
            reason="severe_cut_passed",
        )
        return DecisionResult(
            result_type=ResultType.SEVERE_INTERVENTION,
            trigger_candidate=True,
            selected_category="rest_required",
            score=damped,
            features=features,
            scores={}, states={},
            criteria=criteria,
            candidates=[candidate],
            fire_control=_fire_control(suppressed=False, reason="severe_cut_passed"),
            proposal=None,
            reason_inputs=reason_inputs,
            explanation=explanation,
            next_package_runtime_state={},
        )

    # ------------------------------------------------------------------
    # Proposing band: damped ≥ proposalCut
    # ------------------------------------------------------------------
    if damped >= prop_cut:
        # R2 — NO_PRACTICAL_ACTION_FALLBACK (proposing band, rest unreachable)
        if not reachable:
            candidate = _make_candidate(
                category="rest_required", score=damped, exists=True,
                fired=False, suppressed=True, strength="clear",
                reason="actionability_guard_rest_not_reachable",
            )
            return DecisionResult(
                result_type=ResultType.NO_PRACTICAL_ACTION_FALLBACK,
                trigger_candidate=False,
                selected_category=None,
                score=damped,
                features=features,
                scores={}, states={},
                criteria=criteria,
                candidates=[candidate],
                fire_control=_fire_control(
                    suppressed=True,
                    reason="actionability_guard_rest_not_reachable",
                ),
                proposal=None,
                reason_inputs=[
                    "drowsiness_level", "signal_duration", "continuous_driving_time",
                    "proposal_threshold", "require_actionable", "rest_spot_eta",
                ],
                explanation=(
                    "Damped blend passed the proposal threshold but no actionable "
                    "rest spot is reachable."
                ),
                next_package_runtime_state={},
            )

        # R3 — REST_PROPOSAL
        candidate = _make_candidate(
            category="rest_required", score=damped, exists=True,
            fired=True, suppressed=False, strength="clear",
            reason="proposal_cut_passed_rest_reachable",
        )
        proposal = Proposal(
            id="rest_guidance",
            message={
                "ja": "長時間の運転が続いています。近くの休憩施設でご休憩をお勧めします。",
                "en": (
                    "You have been driving for a long time. "
                    "We recommend resting at the nearby facility."
                ),
            },
            options=["accept_rest", "postpone"],
        )
        return DecisionResult(
            result_type=ResultType.REST_PROPOSAL,
            trigger_candidate=True,
            selected_category="rest_required",
            score=damped,
            features=features,
            scores={}, states={},
            criteria=criteria,
            candidates=[candidate],
            fire_control=_fire_control(
                suppressed=False,
                reason="proposal_cut_passed_rest_reachable",
            ),
            proposal=proposal,
            reason_inputs=[
                "drowsiness_level", "signal_duration", "continuous_driving_time",
                "weight_drowsiness", "persistence_requirement",
                "proposal_threshold", "rest_spot_eta",
            ],
            explanation=(
                "Damped fatigue/drowsiness blend passed the proposal threshold "
                "and a rest spot is reachable."
            ),
            next_package_runtime_state={},
        )

    # ------------------------------------------------------------------
    # R4 — SOFT_WARNING
    # ------------------------------------------------------------------
    if damped >= reaction:
        candidate = _make_candidate(
            category="rest_required", score=damped, exists=True,
            fired=False, suppressed=False, strength="forming",
            reason="below_proposal_cut",
        )
        return DecisionResult(
            result_type=ResultType.SOFT_WARNING,
            trigger_candidate=False,
            selected_category=None,
            score=damped,
            features=features,
            scores={}, states={},
            criteria=criteria,
            candidates=[candidate],
            fire_control=FireControl(fired=False, suppressed=False, override=False, reason="below_proposal_cut"),
            proposal=None,
            reason_inputs=[
                "drowsiness_level", "signal_duration",
                "trigger_sensitivity", "proposal_threshold",
            ],
            explanation=(
                "Damped blend reached the reaction point but has not yet crossed "
                "the proposal threshold."
            ),
            next_package_runtime_state={},
        )

    # ------------------------------------------------------------------
    # R5 — NO_TRIGGER (catch-all)
    # ------------------------------------------------------------------
    candidate = _make_candidate(
        category="rest_required", score=damped, exists=False,
        fired=False, suppressed=False, strength=None,
        reason="below_reaction_point",
    )
    return DecisionResult(
        result_type=ResultType.NO_TRIGGER,
        trigger_candidate=False,
        selected_category=None,
        score=damped,
        features=features,
        scores={}, states={},
        criteria=criteria,
        candidates=[candidate],
        fire_control=FireControl(fired=False, suppressed=False, override=False, reason="below_reaction_point"),
        proposal=None,
        reason_inputs=["drowsiness_level", "signal_duration", "trigger_sensitivity"],
        explanation="Damped blend is below the reaction point — no action required.",
        next_package_runtime_state={},
    )
