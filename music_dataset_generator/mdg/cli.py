"""MDG command-line interface.

Each subcommand corresponds to a pipeline stage. All subcommands are stubs
that raise NotImplementedError until implemented in later slices.
"""

import argparse
import json
import sys
from typing import Optional


def _not_implemented(name: str) -> None:
    print(f"mdg {name}: not yet implemented", file=sys.stderr)
    raise SystemExit(1)


def _add_common_args(parser: argparse.ArgumentParser) -> None:
    """Add flags shared by all subcommands."""
    parser.add_argument(
        "--workspace",
        metavar="DIR",
        default=None,
        help=(
            "Override the generation workspace directory "
            "(default: AICA_GENERATION_WORKSPACE_DIR or <repo-root>/generation_workspace)"
        ),
    )
    parser.add_argument(
        "--dataset-dir",
        metavar="DIR",
        default=None,
        help=(
            "Override the proposal dataset directory "
            "(default: AICA_PROPOSAL_DATASET_DIR or <repo-root>/proposal_contracts/dataset)"
        ),
    )


def _cmd_plan(args: argparse.Namespace) -> None:
    _not_implemented("plan")


def _cmd_name(args: argparse.Namespace) -> None:
    _not_implemented("name")


def _cmd_resolve(args: argparse.Namespace) -> None:
    _not_implemented("resolve")


def _cmd_probe(args: argparse.Namespace) -> None:
    _not_implemented("probe")


def _cmd_harvest(args: argparse.Namespace) -> None:
    _not_implemented("harvest")


def _cmd_transform(args: argparse.Namespace) -> None:
    """S3–S6: transform the accumulated raw cache into a frozen catalog + manifest.

    Deterministic: no network, no LLM, no wall-clock. `--generated-at` is supplied by the
    operator so the core stays wall-clock-free; it defaults to a fixed sentinel when
    omitted for a local reproducibility run.
    """
    from pathlib import Path

    from mdg import config
    from mdg.transform import run_transform, write_dataset

    workspace = Path(args.workspace) if args.workspace else config.workspace_dir()
    dataset_dir = Path(args.dataset_dir) if args.dataset_dir else config.dataset_dir()
    cache_dir = workspace / "cache"
    if not cache_dir.is_dir():
        print(f"mdg transform: no cache directory at {cache_dir}", file=sys.stderr)
        raise SystemExit(1)

    seed = args.seed if args.seed is not None else 0
    result = run_transform(
        cache_dir,
        seed=seed,
        tier=args.tier,
        candidate_source=args.candidate_source,
        generated_at=args.generated_at,
    )
    out_dir = write_dataset(result, dataset_dir)
    print(json.dumps({
        "dataset_id": result.manifest["dataset_id"],
        "dataset_hash": result.manifest["dataset_hash"],
        "songs": len(result.catalog),
        "repairs": len(result.repairs),
        "output_dir": str(out_dir),
    }, ensure_ascii=False))


def _cmd_worlds(args: argparse.Namespace) -> None:
    _not_implemented("worlds")


def _cmd_judge(args: argparse.Namespace) -> None:
    _not_implemented("judge")


def _cmd_certify(args: argparse.Namespace) -> None:
    _not_implemented("certify")


def _cmd_report(args: argparse.Namespace) -> None:
    _not_implemented("report")


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="mdg",
        description="Offline Soundcharts-grounded music dataset generator.",
    )

    subparsers = parser.add_subparsers(
        dest="subcommand",
        metavar="<subcommand>",
        help="Pipeline stage to run",
    )
    subparsers.required = True

    # --- plan ---
    p_plan = subparsers.add_parser(
        "plan",
        help="S0: Generate coverage_plan.json from ledger and tier.",
    )
    _add_common_args(p_plan)
    p_plan.add_argument(
        "--tier",
        choices=["smoke", "demonstration", "stress"],
        required=True,
        help="Dataset tier to plan for.",
    )
    p_plan.add_argument(
        "--stress-size",
        type=int,
        metavar="N",
        default=None,
        help="Target size for stress tier.",
    )
    p_plan.set_defaults(func=_cmd_plan)

    # --- name ---
    p_name = subparsers.add_parser(
        "name",
        help="S1b: Prepare or ingest LLM-assisted candidate names.",
    )
    _add_common_args(p_name)
    name_group = p_name.add_mutually_exclusive_group(required=True)
    name_group.add_argument(
        "--write-input",
        action="store_true",
        help="Write handoff/s1b_input.json for agent consumption.",
    )
    name_group.add_argument(
        "--read-output",
        action="store_true",
        help="Read handoff/s1b_output.json and produce validated candidate_names.json.",
    )
    p_name.set_defaults(func=_cmd_name)

    # --- resolve ---
    p_resolve = subparsers.add_parser(
        "resolve",
        help="S2b: Resolve candidate names to ISRCs via MusicBrainz + Deezer.",
    )
    _add_common_args(p_resolve)
    p_resolve.set_defaults(func=_cmd_resolve)

    # --- probe ---
    p_probe = subparsers.add_parser(
        "probe",
        help="S2c pre: Probe a set of ISRCs against Soundcharts to validate coverage.",
    )
    _add_common_args(p_probe)
    p_probe.add_argument(
        "--isrcs",
        metavar="FILE",
        required=True,
        help="Path to a file containing ISRCs to probe.",
    )
    p_probe.set_defaults(func=_cmd_probe)

    # --- harvest ---
    p_harvest = subparsers.add_parser(
        "harvest",
        help="S2a/S2c: Fetch raw Soundcharts data for resolved ISRCs.",
    )
    _add_common_args(p_harvest)
    p_harvest.add_argument(
        "--candidate-source",
        choices=["isrc_resolved", "soundcharts_search"],
        required=True,
        help="Source strategy for candidate ISRCs.",
    )
    p_harvest.set_defaults(func=_cmd_harvest)

    # --- transform ---
    p_transform = subparsers.add_parser(
        "transform",
        help="S3-S6: Transform raw cache into frozen catalog and dataset_manifest.",
    )
    _add_common_args(p_transform)
    p_transform.add_argument(
        "--seed",
        type=int,
        metavar="N",
        default=None,
        help="Random seed pinning ID allocation + synthesized fields (FR-029).",
    )
    p_transform.add_argument(
        "--tier",
        choices=["smoke", "demonstration", "stress"],
        default="demonstration",
        help="Dataset tier recorded in the manifest.",
    )
    p_transform.add_argument(
        "--candidate-source",
        choices=["isrc_resolved", "soundcharts_search"],
        default="isrc_resolved",
        help="Provenance of the cached candidates (recorded in the manifest).",
    )
    p_transform.add_argument(
        "--generated-at",
        metavar="ISO8601",
        default="1970-01-01T00:00:00Z",
        help=(
            "Externally-supplied freeze timestamp (the deterministic core never reads "
            "the wall clock). Defaults to a fixed sentinel for reproducibility runs."
        ),
    )
    p_transform.set_defaults(func=_cmd_transform)

    # --- worlds ---
    p_worlds = subparsers.add_parser(
        "worlds",
        help="S7: Generate or ingest worlds and contrast pairs.",
    )
    _add_common_args(p_worlds)
    worlds_group = p_worlds.add_mutually_exclusive_group(required=True)
    worlds_group.add_argument(
        "--write-input",
        action="store_true",
        help="Write worlds input for agent consumption.",
    )
    worlds_group.add_argument(
        "--read-output",
        action="store_true",
        help="Read agent-written worlds output and validate.",
    )
    p_worlds.set_defaults(func=_cmd_worlds)

    # --- judge ---
    p_judge = subparsers.add_parser(
        "judge",
        help="S8: Generate or ingest blind test-case judgements.",
    )
    _add_common_args(p_judge)
    judge_group = p_judge.add_mutually_exclusive_group(required=True)
    judge_group.add_argument(
        "--write-input",
        action="store_true",
        help="Write judge input for agent consumption.",
    )
    judge_group.add_argument(
        "--read-output",
        action="store_true",
        help="Read agent-written judge output and validate.",
    )
    p_judge.set_defaults(func=_cmd_judge)

    # --- certify ---
    p_certify = subparsers.add_parser(
        "certify",
        help="S9: Run reversal assertions against test cases.",
    )
    _add_common_args(p_certify)
    p_certify.set_defaults(func=_cmd_certify)

    # --- report ---
    p_report = subparsers.add_parser(
        "report",
        help="Generate build_report.json from current run state.",
    )
    _add_common_args(p_report)
    p_report.set_defaults(func=_cmd_report)

    args = parser.parse_args(argv)
    args.func(args)
    return 0
