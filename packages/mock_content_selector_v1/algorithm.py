"""mock_content_selector_v1 — a FIXED, valid CompletePlan-shaped mock.

Stand-in for the real transparent content-selector algorithm
(`packages/aica_transparent_content_selector_v1/`) until the P1 proposal
screen wires up a real content package for STEP 2. This package exercises
the World -> Service -> Content flow end-to-end against the real §5.4
contract shape, so the mock manifest carries a representative full
parameter/hyperparameter set mirroring the real P6 manifest (see
package.json) even though `evaluate()` below deliberately IGNORES those
values and returns a fixed, illustrative plan.

Contract:
  evaluate(context: dict) -> dict   # SelectorInput-shaped in, CompletePlan-shaped out

Rules preserved even in mock form:
  - `ordered_items` reference REAL track ids from the frozen P2 demonstration
    catalog (`proposal_contracts/dataset/soundcharts-grounded-spotify-compatible-
    demonstration-seed-1042/catalog.json`), never invented ids.
  - `context["selected_service_id"]` not in this package's `supported_services`
    ({music_playlist, humming_karaoke, full_karaoke}) => `decision_type:
    "unsupported_service"` with an empty plan, never a fabricated ranking.
  - NO `plan_score` / `aggregate_score` / `plan_fit` field anywhere (CRITICAL
    INVARIANT, data-model.md).
  - Pure dict in / dict out. No imports of `aica_api`. No file/network I/O, no
    clock, no randomness.
"""
from __future__ import annotations

_PACKAGE_ID = "mock_content_selector_v1"
_CONTRACT_VERSION = "1.0.0"
_SCHEMA_VERSION = "1.0.0"

_SUPPORTED_SERVICES = {"music_playlist", "humming_karaoke", "full_karaoke"}
_LIGHTING_COMPATIBLE = {"humming_karaoke", "full_karaoke"}

# Fixed illustrative plan: 5 REAL track ids from the frozen P2 demonstration
# catalog (proposal_contracts/dataset/soundcharts-grounded-spotify-compatible-
# demonstration-seed-1042/catalog.json), descending item_fit.
_PLAN_TRACKS = [
    {
        "item_id": "synthetic-track-0001",
        "title": "Jessica",
        "duration_ms": 448000,
        "item_fit": 0.81,
        "trait_values": {
            "arousal": 0.72, "valence": 0.65, "humming_ease": 0.40,
            "full_karaoke_ease": 0.35, "arousal_signed": 0.44, "valence_signed": 0.30,
        },
    },
    {
        "item_id": "synthetic-track-0002",
        "title": "Xtal",
        "duration_ms": 293000,
        "item_fit": 0.74,
        "trait_values": {
            "arousal": 0.55, "valence": 0.50, "humming_ease": 0.60,
            "full_karaoke_ease": 0.55, "arousal_signed": 0.10, "valence_signed": 0.00,
        },
    },
    {
        "item_id": "synthetic-track-0003",
        "title": "Desafinado",
        "duration_ms": 248000,
        "item_fit": 0.63,
        "trait_values": {
            "arousal": 0.35, "valence": 0.70, "humming_ease": 0.75,
            "full_karaoke_ease": 0.70, "arousal_signed": -0.30, "valence_signed": 0.40,
        },
    },
    {
        "item_id": "synthetic-track-0004",
        "title": "Corcovado",
        "duration_ms": 176000,
        "item_fit": 0.55,
        "trait_values": {
            "arousal": 0.30, "valence": 0.68, "humming_ease": 0.72,
            "full_karaoke_ease": 0.66, "arousal_signed": -0.40, "valence_signed": 0.36,
        },
    },
    {
        "item_id": "synthetic-track-0005",
        "title": "Wave - Ao Vivo",
        "duration_ms": 175000,
        "item_fit": 0.42,
        "trait_values": {
            "arousal": 0.40, "valence": 0.60, "humming_ease": 0.58,
            "full_karaoke_ease": 0.52, "arousal_signed": -0.20, "valence_signed": 0.20,
        },
    },
]

# One track excluded from the fixed plan (illustrative only) — also a REAL
# frozen-P2 catalog id, never invented.
_EXCLUDED_TRACK_ID = "synthetic-track-0006"


def _feature_contributions() -> list[dict]:
    """Fixed illustrative per-item feature-contribution rows (§14-style shape).

    Two rows (drowsiness, fatigue) reused for every item in this mock — the
    real algorithm derives per-song values from audio features; this mock
    returns a fixed, well-formed row set instead.
    """
    return [
        {
            "feature_id": "drowsiness_level",
            "e_i": 0.72,
            "a_i": 0.80,
            "alpha": 0.80,
            "beta": 0.20,
            "exact_match": None,
            "response_provenance": "cdc_su_explicit",
            "r_i": round(0.72 * 0.80, 6),
            "base_weight": 0.35,
            "purpose_multiplier": 1.50,
            "mask": 1,
            "effective_weight": round(0.35 * 1.50, 6),
            "contribution": round(0.35 * 1.50 * 0.72 * 0.80, 6),
            "formula_version": "1.0.0",
        },
        {
            "feature_id": "fatigue_level",
            "e_i": 0.55,
            "a_i": -0.50,
            "alpha": -0.50,
            "beta": 0.50,
            "exact_match": None,
            "response_provenance": "cdc_su_explicit",
            "r_i": round(0.55 * -0.50, 6),
            "base_weight": 0.30,
            "purpose_multiplier": 1.50,
            "mask": 1,
            "effective_weight": round(0.30 * 1.50, 6),
            "contribution": round(0.30 * 1.50 * 0.55 * -0.50, 6),
            "formula_version": "1.0.0",
        },
    ]


def _plan_mode(service_id: str) -> dict:
    if service_id == "humming_karaoke":
        return {
            "service_id": service_id, "mode_kind": "humming", "chorus_only": True,
            "guide_vocal": True, "driving_lyrics": False, "fixed_segment_sec": 30,
            "stopped_only": None, "simulated_queue": None,
        }
    if service_id == "full_karaoke":
        return {
            "service_id": service_id, "mode_kind": "full_karaoke", "chorus_only": None,
            "guide_vocal": None, "driving_lyrics": None, "fixed_segment_sec": None,
            "stopped_only": True, "simulated_queue": True,
        }
    # music_playlist, and the generic fallback for an unsupported service_id.
    return {
        "service_id": service_id, "mode_kind": "playlist", "chorus_only": None,
        "guide_vocal": None, "driving_lyrics": None, "fixed_segment_sec": None,
        "stopped_only": None, "simulated_queue": None,
    }


def _lighting_configuration(service_id: str) -> dict | None:
    if service_id not in _LIGHTING_COMPATIBLE:
        return None
    return {"enabled": True, "cue_basis": "valence", "notes": "warm_bright"}


def _ordered_items() -> list[dict]:
    items = []
    for position, track in enumerate(_PLAN_TRACKS, start=1):
        items.append(
            {
                "position": position,
                "item_id": track["item_id"],
                "item_fit": track["item_fit"],
                "trait_values": dict(track["trait_values"]),
                "feature_contributions": _feature_contributions(),
                "rationale": [
                    f"眠気・疲労の証拠が『{track['title']}』を支持します（固定モック説明）。",
                    f"Drowsiness/fatigue evidence supports '{track['title']}' (fixed mock rationale).",
                ],
            }
        )
    return items


def _algorithm_provenance() -> dict:
    return {
        "package_id": _PACKAGE_ID,
        "contract_version": _CONTRACT_VERSION,
        "schema_version": _SCHEMA_VERSION,
    }


def _unsupported_plan(service_id) -> dict:
    """A fully valid, empty CompletePlan for an unsupported service_id.

    `service_id` must still be a syntactically valid ServiceId for the
    caller's ServiceId-typed field to construct — "unsupported" means valid
    but not in `supported_services`, never a garbage identifier.
    """
    return {
        "decision_type": "unsupported_service",
        "selected_service_id": service_id,
        "requested_item_count": 5,
        "returned_item_count": 0,
        "ordered_items": [],
        "mode": _plan_mode(service_id),
        "expected_duration_sec": 0,
        "lighting_configuration": None,
        "approval_policy": "explicit_opt_in",
        "completion_rule": "plan_exhausted",
        "next_transition_policy": "await_user",
        "excluded_items": [],
        "unused_available_features": [],
        "missing_features": [],
        "algorithm_provenance": _algorithm_provenance(),
    }


def evaluate(context: dict) -> dict:
    """Return a fixed, valid CompletePlan-shaped dict for `context["selected_service_id"]`.

    NO `plan_score` / `aggregate_score` / `plan_fit` field anywhere in the
    returned structure — the content-selector output is a single ordered
    plan, never an aggregate score (data-model.md CRITICAL INVARIANT).
    """
    selected_service_id = context.get("selected_service_id")

    if selected_service_id not in _SUPPORTED_SERVICES:
        return _unsupported_plan(selected_service_id)

    ordered_items = _ordered_items()

    return {
        "decision_type": "complete_plan",
        "selected_service_id": selected_service_id,
        "requested_item_count": 5,
        "returned_item_count": len(ordered_items),
        "ordered_items": ordered_items,
        "mode": _plan_mode(selected_service_id),
        "expected_duration_sec": sum(t["duration_ms"] for t in _PLAN_TRACKS) // 1000,
        "lighting_configuration": _lighting_configuration(selected_service_id),
        "approval_policy": "explicit_opt_in",
        "completion_rule": "plan_exhausted",
        "next_transition_policy": "await_user",
        "excluded_items": [
            {
                "item_id": _EXCLUDED_TRACK_ID,
                "reason_codes": ["mock_selection_boundary"],
            }
        ],
        "unused_available_features": [],
        "missing_features": [],
        "algorithm_provenance": _algorithm_provenance(),
    }
