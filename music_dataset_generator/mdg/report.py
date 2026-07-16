"""Build report aggregation (§6.3, data-model BuildReport).

`build_report(...)` assembles the committed `build_report.json` from the generation-side
state: candidate_source, loop, per-loop new-vs-skipped counts, Soundcharts quota, the
step-zero probe result, repairs, the coverage checklist, agreement stats, and typed
errors. It validates against the `BuildReport` model before writing.
"""
from __future__ import annotations

from collections import Counter
from typing import Any

from mdg.models import BuildReport


def _coverage_checklist(ledger: list[dict], required_cells: set[str]) -> dict:
    from mdg.ledger import accepted_cells

    covered = set(accepted_cells(ledger))
    return {
        "required": len(required_cells),
        "covered": len(covered & required_cells),
        "unmet": sorted(required_cells - covered),
        "passed": required_cells.issubset(covered) if required_cells else True,
    }


def _agreement_stats(test_cases: list[dict]) -> dict:
    counts = Counter(c.get("agreement") for c in (test_cases or []))
    disagreements = [c["test_case_id"] for c in (test_cases or [])
                     if c.get("agreement") == "disagree"]
    return {
        "agree": counts.get("agree", 0),
        "disagree": counts.get("disagree", 0),
        "disagreements": disagreements,
    }


def build_report(
    *,
    candidate_source: str,
    ledger: list[dict],
    required_cells: set[str] | None = None,
    soundcharts_calls: int = 0,
    probe_result: dict | None = None,
    repairs: list[dict] | None = None,
    test_cases: list[dict] | None = None,
) -> dict[str, Any]:
    """Assemble and validate the BuildReport dict from generation state."""
    from mdg.ledger import current_loop_number

    loop = current_loop_number(ledger)
    per_loop = Counter()
    miss_counts = Counter()
    for entry in ledger or []:
        outcome = entry.get("outcome")
        per_loop[(entry.get("loop"), outcome)] += 1
        if outcome == "miss" and entry.get("miss_reason"):
            miss_counts[entry["miss_reason"]] += 1

    new_vs_skipped = {
        "accepted": sum(1 for e in ledger or [] if e.get("outcome") == "accepted"),
        "miss": sum(1 for e in ledger or [] if e.get("outcome") == "miss"),
        "by_loop": {f"loop{lp}:{oc}": n for (lp, oc), n in sorted(
            per_loop.items(), key=lambda kv: (kv[0][0] or 0, str(kv[0][1])))},
    }

    report = BuildReport(
        candidate_source=candidate_source,
        loop=loop,
        new_vs_skipped=new_vs_skipped,
        soundcharts_calls=soundcharts_calls,
        probe_result=probe_result or {},
        repairs=repairs or [],
        coverage_checklist=_coverage_checklist(ledger, required_cells or set()),
        agreement_stats=_agreement_stats(test_cases),
        errors=[{"code": code, "count": n} for code, n in sorted(miss_counts.items())],
    )
    return report.model_dump()
