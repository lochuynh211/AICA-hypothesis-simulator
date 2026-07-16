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


def _paths(args: argparse.Namespace):
    """Resolve (workspace, dataset_dir) honoring flags then config defaults."""
    from pathlib import Path

    from mdg import config

    workspace = Path(args.workspace) if args.workspace else config.workspace_dir()
    dataset_dir = Path(args.dataset_dir) if args.dataset_dir else config.dataset_dir()
    return workspace, dataset_dir


def _require_soundcharts():
    from mdg import config

    creds = config.soundcharts_credentials()
    if creds is None:
        print(
            "mdg: SOUNDCHARTS_APP_ID / SOUNDCHARTS_API_KEY not set in the environment",
            file=sys.stderr,
        )
        raise SystemExit(2)
    from mdg.sources.soundcharts import SoundchartsClient

    return SoundchartsClient(app_id=creds[0], api_key=creds[1])


def _cmd_plan(args: argparse.Namespace) -> None:
    """S0: write coverage_plan.json for the tier (deterministic, ledger-relative)."""
    from mdg.coverage.plan import build_coverage_plan
    from mdg.ledger import load_ledger

    workspace, _ = _paths(args)
    ledger = load_ledger(workspace / "ledger.json")
    plan = build_coverage_plan(args.tier, ledger=ledger)
    out = workspace / "coverage_plan.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(plan.model_dump_json(indent=2), encoding="utf-8")
    print(json.dumps({"coverage_plan": str(out), "cells": len(plan.cells)}))


def _cmd_name(args: argparse.Namespace) -> None:
    """S1b: write the naming handoff input, or validate the agent's output."""
    from mdg import handoff

    workspace, _ = _paths(args)
    handoff_dir = workspace / "handoff"
    if args.write_input:
        from mdg.coverage.plan import build_coverage_plan
        from mdg.ledger import load_ledger

        ledger = load_ledger(workspace / "ledger.json")
        plan = build_coverage_plan("demonstration", ledger=ledger)
        payload = {
            "remaining_cells": plan.remaining.get("cells", []),
            "language_targets": plan.language_targets,
            "already_named": [e.get("keys", {}).get("normalized_name") for e in (ledger or [])],
            "instructions": "Propose real songs per remaining cell; NEVER emit isrc/audio.",
        }
        handoff.write_input("s1b_naming", payload, handoff_dir / "s1b_input.json")
        print(json.dumps({"wrote": str(handoff_dir / "s1b_input.json")}))
    else:
        candidates = handoff.read_output("s1b_naming", handoff_dir / "s1b_output.json")
        out = workspace / "candidate_names.json"
        out.write_text(json.dumps(candidates, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({"validated_candidates": len(candidates), "wrote": str(out)}))


def _cmd_resolve(args: argparse.Namespace) -> None:
    """S2b: resolve candidate names to ordered candidate ISRCs (MusicBrainz + Deezer)."""
    from mdg.errors import MdgMissSignal
    from mdg.ledger import load_ledger
    from mdg.sources.deezer import DeezerClient
    from mdg.sources.musicbrainz import MusicBrainzClient
    from mdg.sources.resolver import ISRCResolver
    from mdg.transform import normalized_name

    workspace, _ = _paths(args)
    candidates = json.loads((workspace / "candidate_names.json").read_text(encoding="utf-8"))
    ledger = load_ledger(workspace / "ledger.json")
    resolved_names = {e.get("keys", {}).get("normalized_name") for e in (ledger or [])}
    resolver = ISRCResolver(MusicBrainzClient(), DeezerClient())

    out = []
    for cand in candidates:
        norm = normalized_name(cand["title"], cand["artist"])
        if norm in resolved_names:
            continue  # ledger exclusion — never re-resolve
        try:
            isrcs = resolver.resolve(cand["title"], cand["artist"], cand.get("release_year"))
        except MdgMissSignal as miss:
            out.append({**cand, "candidate_isrcs": [], "miss": miss.code.value})
            continue
        out.append({**cand, "candidate_isrcs": isrcs})
    dest = workspace / "resolved_candidates.json"
    dest.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"resolved": len(out), "wrote": str(dest)}))


def _cmd_probe(args: argparse.Namespace) -> None:
    """S2c pre-flight: probe ISRCs and enforce the 60% populated-audio gate."""
    from mdg.harvest.probe import run_probe

    isrcs = json.loads(open(args.isrcs, encoding="utf-8").read())
    if isinstance(isrcs, dict):
        isrcs = isrcs.get("isrcs", [])
    sc = _require_soundcharts()
    result = run_probe(sc, isrcs)
    print(json.dumps(result))


def _cmd_harvest(args: argparse.Namespace) -> None:
    """S2a/S2c: fetch raw Soundcharts data for resolved candidates into cache + lineage."""
    if args.candidate_source == "soundcharts_search":
        # Live search-by-metric is off-subscription; surface the typed error.
        _require_soundcharts().search(query="")

    from mdg.harvest.by_isrc import harvest_by_isrc
    from mdg.harvest.cache import store_accepted
    from mdg.ledger import append_entry, load_ledger

    workspace, _ = _paths(args)
    resolved = json.loads((workspace / "resolved_candidates.json").read_text(encoding="utf-8"))
    sc = _require_soundcharts()
    cache_dir = workspace / "cache"
    lineage_path = workspace / "lineage.json"
    ledger_path = workspace / "ledger.json"
    loop = _current_loop(load_ledger(ledger_path))

    accepted = 0
    seq = _existing_track_count(cache_dir)
    for cand in resolved:
        isrcs = cand.get("candidate_isrcs") or []
        if not isrcs:
            continue
        target_language = cand.get("expected_language")
        outcome = harvest_by_isrc(sc, isrcs, target_language=target_language)
        from mdg.transform import normalized_name
        norm = normalized_name(cand["title"], cand["artist"])
        if outcome.status == "accepted":
            seq += 1
            synthetic_id = f"synthetic-track-{seq:04d}"
            store_accepted(
                outcome.song, cache_dir=cache_dir, lineage_path=lineage_path,
                synthetic_id=synthetic_id,
                soundcharts_uuid=outcome.song.get("uuid", outcome.isrc),
                resolved_isrc=outcome.isrc, candidate_isrcs=isrcs, loop=loop,
            )
            append_entry(ledger_path, {
                "keys": {"isrc": outcome.isrc, "normalized_name": norm},
                "outcome": "accepted", "miss_reason": None, "cell": None, "loop": loop,
            })
            accepted += 1
        else:
            append_entry(ledger_path, {
                "keys": {"normalized_name": norm},
                "outcome": "miss", "miss_reason": outcome.status, "cell": None, "loop": loop,
            })
    print(json.dumps({"accepted": accepted, "soundcharts_calls": sc.quota_used}))


def _existing_track_count(cache_dir) -> int:
    from pathlib import Path

    cache_dir = Path(cache_dir)
    return len(list(cache_dir.glob("*.json"))) if cache_dir.is_dir() else 0


def _current_loop(ledger) -> int:
    loops = [e.get("loop", 0) for e in (ledger or [])]
    return (max(loops) + 1) if loops else 1


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
    from mdg.errors import MdgFatalError

    try:
        args.func(args)
    except MdgFatalError as exc:
        # Taxonomy contract: print {"error": code, "detail": …} and exit non-zero.
        print(json.dumps({"error": exc.code.value, "detail": exc.detail}), file=sys.stderr)
        return 1
    return 0
