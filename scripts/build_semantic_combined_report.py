#!/usr/bin/env python
"""CLI orchestration for the semantic Combined experience catalog.

Regenerates the runtime artifacts from the authored catalog, runs every case
through the production quickview endpoint, adjudicates the authored semantic
hypotheses, then writes the machine-readable results and the self-contained
customer HTML report.

Exit code is nonzero ONLY for contract/transport/execution failures. Semantic
mismatches are the requested scientific findings, not a build failure.

Usage:
    PYTHONWARNINGS=ignore PYTHONPATH=app/api:. app/api/.venv/bin/python \\
      scripts/build_semantic_combined_report.py \\
      --catalog scripts/semantic_combined_catalog.json \\
      --repo-root . \\
      --results combined_contracts/results/semantic-combined-results.v1.json \\
      --html docs/semantic-combined-test-case-report.html
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path

from semantic_catalog.evaluator import evaluate_suite
from semantic_catalog.generator import compile_artifacts, load_catalog
from semantic_catalog.report import render_report
from semantic_catalog.runner import run_catalog

_DEFAULT_CATALOG = Path("scripts/semantic_combined_catalog.json")
_DEFAULT_RESULTS = Path("combined_contracts/results/semantic-combined-results.v1.json")
_DEFAULT_HTML = Path("docs/semantic-combined-test-case-report.html")


def _parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compile, execute, adjudicate and render the semantic Combined catalog.",
    )
    parser.add_argument("--catalog", type=Path, default=_DEFAULT_CATALOG)
    parser.add_argument("--repo-root", type=Path, default=Path("."))
    parser.add_argument("--results", type=Path, default=_DEFAULT_RESULTS)
    parser.add_argument("--html", type=Path, default=_DEFAULT_HTML)
    parser.add_argument(
        "--case-id",
        action="append",
        default=[],
        help="Restrict the run to these case IDs (repeatable). Default: all cases.",
    )
    parser.add_argument(
        "--skip-compile",
        action="store_true",
        help="Run the committed artifacts as-is instead of regenerating them first.",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    repo_root = args.repo_root.resolve()

    catalog = load_catalog(args.catalog)
    print(f"catalog {catalog.get('catalog_id')} v{catalog.get('catalog_version')}: "
          f"{len(catalog.get('cases') or [])} cases", flush=True)

    if not args.skip_compile:
        written = compile_artifacts(catalog, repo_root)
        print(f"compiled {len(written)} runtime artifacts", flush=True)

    suite = run_catalog(repo_root, set(args.case_id) or None)
    executed = len(suite.get("case_results") or [])
    print(f"executed {executed} cases through /api/merged-runs/quickview", flush=True)

    evaluated = evaluate_suite(catalog, suite)

    args.results.parent.mkdir(parents=True, exist_ok=True)
    args.results.write_text(
        json.dumps(evaluated, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    args.html.parent.mkdir(parents=True, exist_ok=True)
    args.html.write_text(render_report(catalog, evaluated), encoding="utf-8")

    summary = evaluated.get("summary") or {}
    counts = summary.get("verdict_counts") or {}
    print(f"verdicts: {json.dumps(counts)}", flush=True)
    print(f"wrote {args.results} ({args.results.stat().st_size / 1e6:.1f} MB)", flush=True)
    print(f"wrote {args.html} ({args.html.stat().st_size / 1e6:.1f} MB)", flush=True)

    # Semantic mismatches are findings, not build failures. Only structural
    # execution errors fail the build.
    errors = int(counts.get("EXECUTION_ERROR", 0) or 0)
    if errors:
        print(f"FAILED: {errors} case(s) ended in an execution error", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
