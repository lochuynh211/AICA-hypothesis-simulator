"""Pure-Python Markdown formatter for the §14.2 evidence report (S8 / T012).

Design constraints:
  - render_evidence_markdown(report) -> str: takes the SAME dict returned by
    build_evidence_report and formats it as human-readable Markdown.
  - Hand-rolled string building only — NO markdown/jinja/template library.
  - NO new dependencies.
  - Facts vs Human-Review separation invariant preserved:
      ## Simulator Facts  — objective recorded facts; no feedback values.
      ## Human Review     — feedback labels + free-text comments only.
  - NEVER a verdict: the output presents facts and, separately, the human's
    recorded feedback. It never claims the algorithm was right or wrong.
  - Deterministic ordering: sections rendered in a fixed, documented order.
  - Profile overrides (driver_profile / vehicle_profile from the RunLog, set by
    the Profile Editor) appear under ## Simulator Facts as objective run setup.
"""

from __future__ import annotations

import json
from typing import Any


# ── Private helpers ────────────────────────────────────────────────────────────


def _safe_str(value: Any) -> str:
    """Convert any value to a safe inline string for Markdown."""
    if value is None:
        return "N/A"
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        return value
    # Complex types → compact JSON (no pretty-printing in line context)
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _kv(key: str, value: Any) -> str:
    """Render a single ``- **key**: value`` bullet line."""
    return f"- **{key}**: {_safe_str(value)}\n"


def _dict_bullets(d: dict[str, Any], indent: str = "") -> list[str]:
    """Render each k/v of a dict as bullet lines, with an optional indent prefix."""
    lines = []
    for k, v in d.items():
        lines.append(f"{indent}- {k}: {_safe_str(v)}\n")
    return lines


# ── Public API ─────────────────────────────────────────────────────────────────


def render_evidence_markdown(report: dict[str, Any]) -> str:
    """Render a §14.2 evidence report dict to a human-readable Markdown string.

    The caller passes the dict returned by ``build_evidence_report`` — this
    function only formats it; it never re-reads the run or recomputes decisions.

    Section layout:
      # Evidence Report: {run_id}         ← title + top-level metadata
      ## Simulator Facts                   ← objective recorded facts
        ### Run Mode
        ### Route
        ### Parameters
        ### Hyperparameters
        ### Profiles        ← driver/vehicle profiles (U5 overrides stored here)
        ### Event Plan
        ### Timeline Highlights
        ### Algorithm Errors
      ## Human Review                      ← feedback only; never facts
        ### Feedback Labels
        ### Free-Text Comments

    Args:
        report: Dict matching the §14.2 evidence report shape (output of
                ``build_evidence_report``).

    Returns:
        A UTF-8 Markdown string.  Always contains both ``## Simulator Facts``
        and ``## Human Review`` sections, even when the run has no feedback.
    """
    lines: list[str] = []

    # ── Title + top-level metadata ─────────────────────────────────────────────
    run_id = report.get("run_id", "")
    lines.append(f"# Evidence Report: {run_id}\n\n")

    lines.append(_kv("Report ID", report.get("report_id")))
    lines.append(_kv("Run ID", run_id))
    lines.append(_kv("Timestamp", report.get("timestamp")))
    lines.append(_kv("UI Language", report.get("ui_language")))
    lines.append(_kv("Simulator Version", report.get("simulator_version")))

    pkg = report.get("package") or {}
    lines.append(_kv("Package", f"{pkg.get('id', '')} v{pkg.get('version', '')}"))

    sc = report.get("scenario") or {}
    lines.append(_kv("Scenario", f"{sc.get('id', '')} v{sc.get('version', '')}"))

    lines.append("\n")

    # ── ## Simulator Facts ─────────────────────────────────────────────────────
    # NOTE: feedback values are NEVER written below this heading.
    # All feedback appears exclusively under ## Human Review.
    lines.append("## Simulator Facts\n\n")

    sf = report.get("simulator_facts") or {}

    # ── Run mode / status ──────────────────────────────────────────────────────
    lines.append("### Run Mode\n\n")
    lines.append(_kv("run_mode", sf.get("run_mode")))
    lines.append(_kv("evidence_status", sf.get("evidence_status")))
    lines.append("\n")

    # ── Route ──────────────────────────────────────────────────────────────────
    lines.append("### Route\n\n")
    route_snapshot = sf.get("route_snapshot")
    if route_snapshot is not None and isinstance(route_snapshot, dict):
        lines.append(_kv("summary", route_snapshot.get("summary")))
        lines.append(_kv("start", route_snapshot.get("start_label")))
        lines.append(_kv("end", route_snapshot.get("end_label")))
    else:
        lines.append("- Local/deterministic route (no Maps snapshot)\n")

    route_facts = sf.get("route_facts")
    if route_facts is not None and isinstance(route_facts, dict):
        lines.append(_kv("total_route_distance_km", route_facts.get("total_route_distance_km")))
        lines.append(_kv("estimated_duration_seconds", route_facts.get("estimated_duration_seconds")))
        lines.append(_kv("route_source", route_facts.get("route_source")))
    lines.append("\n")

    # ── Parameters ─────────────────────────────────────────────────────────────
    lines.append("### Parameters\n\n")
    initial_params = sf.get("initial_parameters") or {}
    if initial_params and isinstance(initial_params, dict):
        lines.append("**Initial Parameters:**\n\n")
        lines.extend(_dict_bullets(initial_params))
    else:
        lines.append("- (no parameters)\n")

    final_params = sf.get("final_parameters")
    if final_params is not None and isinstance(final_params, dict) and final_params:
        lines.append("\n**Final Parameters (changed during run):**\n\n")
        lines.extend(_dict_bullets(final_params))
    lines.append("\n")

    # ── Hyperparameters ────────────────────────────────────────────────────────
    lines.append("### Hyperparameters\n\n")
    initial_hyper = sf.get("initial_hyperparameters") or {}
    if initial_hyper and isinstance(initial_hyper, dict):
        lines.append("**Initial Hyperparameters:**\n\n")
        lines.extend(_dict_bullets(initial_hyper))
    else:
        lines.append("- (no hyperparameters)\n")

    final_hyper = sf.get("final_hyperparameters")
    if final_hyper is not None and isinstance(final_hyper, dict) and final_hyper:
        lines.append("\n**Final Hyperparameters (changed during run):**\n\n")
        lines.extend(_dict_bullets(final_hyper))
    lines.append("\n")

    # ── Profiles (driver + vehicle) — U5 profile overrides stored here ─────────
    lines.append("### Profiles\n\n")

    driver = sf.get("driver_profile")
    if driver is not None and isinstance(driver, dict) and driver:
        lines.append("**Driver Profile:**\n\n")
        lines.extend(_dict_bullets(driver))
    else:
        lines.append("- driver_profile: N/A (pre-M5 run or no override)\n")

    vehicle = sf.get("vehicle_profile")
    if vehicle is not None and isinstance(vehicle, dict) and vehicle:
        lines.append("\n**Vehicle Profile:**\n\n")
        lines.extend(_dict_bullets(vehicle))
    else:
        lines.append("- vehicle_profile: N/A (pre-M5 run or no override)\n")
    lines.append("\n")

    # ── Event Plan ─────────────────────────────────────────────────────────────
    lines.append("### Event Plan\n\n")
    event_plan = sf.get("event_plan")
    ticks = []
    if event_plan is not None and isinstance(event_plan, dict):
        ticks = event_plan.get("ticks") or []
    lines.append(_kv("total_ticks", len(ticks)))
    lines.append("\n")

    # ── Timeline Highlights ────────────────────────────────────────────────────
    # Only proposals fired + actions recorded; not the full decision trace.
    lines.append("### Timeline Highlights\n\n")

    proposal_events = sf.get("proposal_events") or []
    if proposal_events:
        lines.append(f"**Proposals fired ({len(proposal_events)}):**\n\n")
        for pe in proposal_events:
            tick_idx = pe.get("tick_index", "?")
            # Proposal id is nested in trace.decision_result.proposal.id
            trace = pe.get("trace") or {}
            dr = trace.get("decision_result") or {}
            proposal = dr.get("proposal") or {}
            prop_id = (proposal.get("id") if isinstance(proposal, dict) else None) or "unknown"
            lines.append(f"- tick {tick_idx}: proposal `{prop_id}` fired\n")
    else:
        lines.append("- No proposals fired during this run.\n")

    actions = sf.get("actions") or []
    if actions:
        lines.append(f"\n**Actions taken ({len(actions)}):**\n\n")
        for ae in actions:
            tick_idx = ae.get("tick_index", "?")
            action_name = ae.get("action", "?")
            status = ae.get("resulting_status", "?")
            lines.append(f"- tick {tick_idx}: `{action_name}` → {status}\n")
    else:
        lines.append("\n- No actions taken during this run.\n")
    lines.append("\n")

    # ── Algorithm Errors ───────────────────────────────────────────────────────
    lines.append("### Algorithm Errors\n\n")
    alg_errors = sf.get("algorithm_errors") or []
    if alg_errors:
        for err in alg_errors:
            tick_idx = err.get("tick_index", "?")
            err_type = err.get("error_type", "?")
            msg = err.get("message", "")
            lines.append(f"- tick {tick_idx}: [{err_type}] {msg}\n")
    else:
        lines.append("- No algorithm errors recorded.\n")
    lines.append("\n")

    # ── ## Human Review ────────────────────────────────────────────────────────
    # This section contains ONLY human feedback values.
    # It NEVER repeats simulator facts; it NEVER claims a verdict.
    lines.append("## Human Review\n\n")

    hr = report.get("human_review") or {}
    feedback_labels = hr.get("feedback_labels") or []
    free_text_comments = hr.get("free_text_comments") or []

    # ── Feedback Labels ────────────────────────────────────────────────────────
    lines.append("### Feedback Labels\n\n")
    if feedback_labels:
        for entry in feedback_labels:
            target = entry.get("target") or {}
            scope = target.get("scope", "?")
            tick_idx = target.get("tick_index")
            event_ref = target.get("event_ref")
            labels = entry.get("labels") or {}

            target_parts = [f"scope={scope}"]
            if tick_idx is not None:
                target_parts.append(f"tick={tick_idx}")
            if event_ref is not None:
                target_parts.append(f"event_ref={event_ref}")
            target_str = ", ".join(target_parts)

            lines.append(f"- **{target_str}**:\n")
            for label_key, label_val in labels.items():
                lines.append(f"  - {label_key}: {_safe_str(label_val)}\n")
    else:
        lines.append("- (no feedback labels)\n")
    lines.append("\n")

    # ── Free-Text Comments ─────────────────────────────────────────────────────
    lines.append("### Free-Text Comments\n\n")
    if free_text_comments:
        for entry in free_text_comments:
            target = entry.get("target") or {}
            scope = target.get("scope", "?")
            tick_idx = target.get("tick_index")
            comment = entry.get("comment", "")

            target_parts = [f"scope={scope}"]
            if tick_idx is not None:
                target_parts.append(f"tick={tick_idx}")
            target_str = ", ".join(target_parts)

            lines.append(f"- **{target_str}**: {comment}\n")
    else:
        lines.append("- (no free-text comments)\n")
    lines.append("\n")

    return "".join(lines)
