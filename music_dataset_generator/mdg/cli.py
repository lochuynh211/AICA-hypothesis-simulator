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
    from mdg.sources.soundcharts import SoundchartsClient

    auth = config.soundcharts_auth()
    if auth is None:
        print(
            "mdg: no Soundcharts credentials — set SOUNDCHARTS_CLIENT_ID + "
            "SOUNDCHARTS_CLIENT_SECRET (OAuth) or SOUNDCHARTS_APP_ID + SOUNDCHARTS_API_KEY "
            "(legacy) in the environment or generation_workspace/soundcharts.env",
            file=sys.stderr,
        )
        raise SystemExit(2)
    if auth["mode"] == "oauth":
        return SoundchartsClient(
            client_id=auth["client_id"], client_secret=auth["client_secret"],
            team_id=auth.get("team_id"),
        )
    return SoundchartsClient(app_id=auth["app_id"], api_key=auth["api_key"])


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
        plan = build_coverage_plan(args.tier, ledger=ledger)
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
    from mdg.ledger import append_entry, is_known, load_ledger
    from mdg.sources.deezer import DeezerClient
    from mdg.sources.musicbrainz import MusicBrainzClient
    from mdg.sources.resolver import ISRCResolver
    from mdg.transform import normalized_name

    workspace, _ = _paths(args)
    candidates = json.loads((workspace / "candidate_names.json").read_text(encoding="utf-8"))
    ledger_path = workspace / "ledger.json"
    ledger = load_ledger(ledger_path)
    loop = _current_loop(ledger)
    resolver = ISRCResolver(MusicBrainzClient(), DeezerClient())

    out = []
    for cand in candidates:
        norm = normalized_name(cand["title"], cand["artist"])
        if is_known(ledger, {"normalized_name": norm}):
            continue  # ledger exclusion — never re-resolve a known name (accepted or miss)
        try:
            isrcs = resolver.resolve(cand["title"], cand["artist"], cand.get("release_year"))
        except MdgMissSignal as miss:
            # Ledger the miss so later loops never re-propose/re-resolve this name (SC-007).
            entry = {"keys": {"normalized_name": norm}, "outcome": "miss",
                     "miss_reason": miss.code.value, "cell": None, "loop": loop}
            append_entry(ledger_path, entry)
            ledger.append(entry)
            out.append({**cand, "candidate_isrcs": [], "miss": miss.code.value})
            continue
        out.append({**cand, "candidate_isrcs": isrcs})
    dest = workspace / "resolved_candidates.json"
    dest.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"resolved": sum(1 for c in out if c["candidate_isrcs"]),
                      "misses": sum(1 for c in out if not c["candidate_isrcs"]),
                      "wrote": str(dest)}))


def _cmd_probe(args: argparse.Namespace) -> None:
    """S2c pre-flight: probe ISRCs and enforce the 60% populated-audio gate."""
    from mdg.harvest.probe import run_probe

    from pathlib import Path

    isrcs = json.loads(Path(args.isrcs).read_text(encoding="utf-8"))
    if isinstance(isrcs, dict):
        isrcs = isrcs.get("isrcs", [])
    sc = _require_soundcharts()
    workspace, _ = _paths(args)
    result = run_probe(sc, isrcs)
    # Persist for the build report (run_probe raises before this on gate failure).
    (workspace / "probe_result.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result))


def _cmd_harvest(args: argparse.Namespace) -> None:
    """S2a/S2c: fetch raw Soundcharts data for resolved candidates into cache + lineage."""
    if args.candidate_source == "soundcharts_search":
        # Live search-by-metric is off-subscription; surface the typed error.
        _require_soundcharts().search(query="")

    from mdg.binner import bin_song
    from mdg.harvest.by_isrc import harvest_by_isrc
    from mdg.harvest.cache import store_accepted
    from mdg.ledger import append_entry, is_known, load_ledger
    from mdg.transform import normalized_name

    workspace, _ = _paths(args)
    resolved = json.loads((workspace / "resolved_candidates.json").read_text(encoding="utf-8"))
    sc = _require_soundcharts()
    cache_dir = workspace / "cache"
    lineage_path = workspace / "lineage.json"
    ledger_path = workspace / "ledger.json"
    ledger = load_ledger(ledger_path)
    loop = _current_loop(ledger)

    accepted = skipped_known = 0
    for cand in resolved:
        isrcs = cand.get("candidate_isrcs") or []
        if not isrcs:
            continue
        norm = normalized_name(cand["title"], cand["artist"])
        # Ledger exclusion before spending quota: skip a name or any candidate ISRC
        # already processed (accepted or a known miss) in a prior loop (§4.13).
        if is_known(ledger, {"normalized_name": norm}) or any(
            is_known(ledger, {"isrc": i}) for i in isrcs
        ):
            skipped_known += 1
            continue
        target_language = cand.get("expected_language")
        outcome = harvest_by_isrc(sc, isrcs, target_language=target_language)
        if outcome.status == "accepted":
            cell = bin_song(outcome.song)["cell_id"]  # real binned cell (firewall)
            store_accepted(
                outcome.song, cache_dir=cache_dir, lineage_path=lineage_path,
                soundcharts_uuid=outcome.song.get("uuid", outcome.isrc),
                resolved_isrc=outcome.isrc, candidate_isrcs=isrcs, loop=loop,
            )
            entry = {
                "keys": {"isrc": outcome.isrc, "normalized_name": norm},
                "outcome": "accepted", "miss_reason": None, "cell": cell, "loop": loop,
            }
            accepted += 1
        else:
            entry = {
                "keys": {"normalized_name": norm},
                "outcome": "miss", "miss_reason": outcome.status, "cell": None, "loop": loop,
            }
        append_entry(ledger_path, entry)
        ledger.append(entry)  # keep in-memory ledger current for later candidates this loop
    stats = {"accepted": accepted, "skipped_known": skipped_known,
             "soundcharts_calls": sc.quota_used, "loop": loop}
    # Persist for the build report (accumulate quota across loops).
    prev = json.loads((workspace / "harvest_stats.json").read_text(encoding="utf-8")) \
        if (workspace / "harvest_stats.json").exists() else {"soundcharts_calls": 0}
    stats["soundcharts_calls"] += prev.get("soundcharts_calls", 0)
    (workspace / "harvest_stats.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(stats))


def _current_loop(ledger) -> int:
    loops = [e.get("loop", 0) for e in (ledger or [])]
    return (max(loops) + 1) if loops else 1


def _cmd_transform(args: argparse.Namespace) -> None:
    """S3–S6: transform the accumulated raw cache into a frozen catalog + manifest.

    Deterministic: no network, no LLM, no wall-clock. `--generated-at` is supplied by the
    operator so the core stays wall-clock-free; it defaults to a fixed sentinel when
    omitted for a local reproducibility run.
    """
    from mdg.harvest.cache import backfill_lineage_ids
    from mdg.transform import run_transform, write_dataset

    workspace, dataset_dir = _paths(args)
    cache_dir = workspace / "cache"
    if not cache_dir.is_dir():
        print(f"mdg transform: no cache directory at {cache_dir}", file=sys.stderr)
        raise SystemExit(1)

    # NOTE: the transform does NOT apply ledger dedup. The raw cache contains only accepted
    # songs (harvest never caches a miss), keyed by ISRC (so duplicates overwrite, never
    # double-count). Cross-loop dedup happens at HARVEST time (_cmd_harvest skips
    # ledger-known identities before spending quota); excluding ledger-accepted identities
    # here would wrongly drop the very songs the accumulated cache is meant to freeze.

    # §17.6 coverage gate is OPT-IN: intermediate-loop freezes are legitimately partial
    # (§4.13), so enforcement is off by default and the operator enables it for the final
    # demonstration freeze. When on, all cells the tier's plan targets must be covered.
    required_cells = None
    if args.enforce_coverage:
        from mdg.coverage.plan import build_coverage_plan

        plan = build_coverage_plan(args.tier, ledger=None)
        required_cells = {c.cell_id for c in plan.cells}

    seed = args.seed if args.seed is not None else 0
    result = run_transform(
        cache_dir,
        seed=seed,
        tier=args.tier,
        candidate_source=args.candidate_source,
        generated_at=args.generated_at,
        required_cells=required_cells,
    )
    out_dir = write_dataset(result, dataset_dir)
    # Backfill lineage synthetic_id ↔ isrc now that IDs are allocated (audit integrity).
    backfill_lineage_ids(workspace / "lineage.json", result.catalog)
    # Persist the repair log for the build report.
    (workspace / "repairs.json").write_text(
        json.dumps(result.repairs, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "dataset_id": result.manifest["dataset_id"],
        "dataset_hash": result.manifest["dataset_hash"],
        "songs": len(result.catalog),
        "repairs": len(result.repairs),
        "output_dir": str(out_dir),
    }, ensure_ascii=False))


def _load_frozen_catalog(dataset_dir):
    """Load the most-recently-frozen catalog under dataset_dir (post-freeze).

    Selects by file mtime (newest freeze wins) — NOT lexicographic dataset_id sort, which
    misorders bare integer seeds (e.g. seed-100 < seed-42, seed-7 > seed-42).
    """
    from pathlib import Path

    catalogs = list(Path(dataset_dir).glob("*/catalog.json"))
    if not catalogs:
        print(f"mdg: no frozen catalog under {dataset_dir} — run `transform` first",
              file=sys.stderr)
        raise SystemExit(1)
    newest = max(catalogs, key=lambda p: p.stat().st_mtime)
    return json.loads(newest.read_text(encoding="utf-8"))


def _catalog_ids_from_dataset(dataset_dir):
    """Return sorted (track_ids, artist_ids) from the frozen catalog."""
    catalog = _load_frozen_catalog(dataset_dir)
    track_ids, artist_ids = set(), set()
    for song in catalog:
        track_ids.add(song["spotify_track"]["id"])
        for artist in song["spotify_track"].get("artists") or []:
            artist_ids.add(artist["id"])
    return sorted(track_ids), sorted(artist_ids)


def _cmd_worlds(args: argparse.Namespace) -> None:
    """S7: build base worlds + contrast pairs against the frozen catalog (post-freeze)."""
    from mdg.worlds import (
        apply_profiles,
        build_base_worlds,
        build_contrast_pairs,
        validate_world_references,
    )

    workspace, dataset_dir = _paths(args)
    track_ids, artist_ids = _catalog_ids_from_dataset(dataset_dir)

    if args.write_input:
        payload = {"track_ids": track_ids, "artist_ids": artist_ids,
                   "instructions": "Compose coherent histories/oshi grounded to these IDs."}
        out = workspace / "handoff" / "s7_input.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({"wrote": str(out), "tracks": len(track_ids)}))
        return

    worlds = build_base_worlds(track_ids=track_ids, artist_ids=artist_ids)
    bundle = build_contrast_pairs(track_ids=track_ids, artist_ids=artist_ids)

    # Merge the S7 agent's composed histories/oshi (if present) into the base worlds.
    s7_output = workspace / "handoff" / "s7_output.json"
    merged_profiles = 0
    if s7_output.exists():
        profiles = json.loads(s7_output.read_text(encoding="utf-8"))
        worlds = apply_profiles(worlds, profiles)
        merged_profiles = sum(1 for w in worlds if w["world_id"] in profiles)

    track_set, artist_set = set(track_ids), set(artist_ids)
    for world in worlds + bundle["worlds"]:
        validate_world_references(world, track_ids=track_set, artist_ids=artist_set)

    (workspace / "worlds.json").write_text(
        json.dumps(worlds, ensure_ascii=False, indent=2), encoding="utf-8")
    (workspace / "contrast_pairs.json").write_text(
        json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"base_worlds": len(worlds), "contrast_pairs": len(bundle["pairs"]),
                      "merged_profiles": merged_profiles}))


def _cmd_judge(args: argparse.Namespace) -> None:
    """S8: write the blind-judge handoff input, or finalize test cases after reveal."""
    from mdg.judge import finalize_test_cases, read_blind_labels

    workspace, _ = _paths(args)
    handoff_dir = workspace / "handoff"
    if args.write_input:
        # Input pairs (world, candidate song) WITHOUT any P6 score (blind).
        worlds = json.loads((workspace / "worlds.json").read_text(encoding="utf-8"))
        payload = {"worlds": [w["world_id"] for w in worlds],
                   "instructions": "Assign positive/negative/neutral BLIND; never include a score."}
        out = handoff_dir / "s8_input.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({"wrote": str(out)}))
        return

    from pathlib import Path

    from mdg.certify import load_evaluate
    from mdg.p6_adapter import score_song

    labels = read_blind_labels(
        json.loads((handoff_dir / "s8_output.json").read_text(encoding="utf-8"))
    )
    # Reveal the P6 score AFTER reading the blind labels (SC-009): compute it here from the
    # real P6 evaluate over the frozen catalog + the label's world — never an external file.
    workspace, dataset_dir = _paths(args)
    catalog = _load_frozen_catalog(dataset_dir)
    worlds = {w["world_id"]: w
              for w in json.loads((workspace / "worlds.json").read_text(encoding="utf-8"))}
    evaluate = load_evaluate(_p6_package_path(args))
    scores = {
        lbl["test_case_id"]: score_song(
            evaluate, worlds[lbl["world_ref"]], catalog, lbl["candidate_song_ref"])
        for lbl in labels
    }
    cases = finalize_test_cases(labels, scores)

    tc_dir = Path(dataset_dir).parent / "test_cases"
    tc_dir.mkdir(parents=True, exist_ok=True)
    (tc_dir / "test_cases.json").write_text(
        json.dumps(cases, ensure_ascii=False, indent=2), encoding="utf-8")
    agree = sum(1 for c in cases if c["agreement"] == "agree")
    print(json.dumps({"test_cases": len(cases), "agree": agree,
                      "disagree": len(cases) - agree}))


_DEFAULT_P6_PACKAGE = "packages/aica_transparent_content_selector_v1"


def _p6_package_path(args) -> "Path":
    """Resolve the P6 package path relative to the repo root (not the CWD or env dirs).

    Uses --p6-package when the subcommand defines it (certify); judge falls back to the
    default location. Repo root is derived from the package file location, NOT from
    config.workspace_dir() (which honors AICA_GENERATION_WORKSPACE_DIR and would point
    elsewhere).
    """
    from pathlib import Path

    from mdg.p6_adapter import _repo_root

    rel = getattr(args, "p6_package", None) or _DEFAULT_P6_PACKAGE
    p = Path(rel)
    if p.is_absolute() or p.exists():
        return p
    return _repo_root() / rel  # repo-root-relative, env-independent


def _pick_contrast_songs(catalog: list[dict]) -> tuple[str, str]:
    """Pick the highest- and lowest-arousal catalog songs as the default contrast pair."""
    by_energy = sorted(catalog, key=lambda s: s["spotify_audio_features"]["energy"])
    return by_energy[-1]["spotify_track"]["id"], by_energy[0]["spotify_track"]["id"]


def _cmd_certify(args: argparse.Namespace) -> None:
    """S9: certify contrast reversals with the real P6 evaluate over the frozen catalog."""
    from pathlib import Path

    from mdg.certify import certify_reversals, load_evaluate
    from mdg.p6_adapter import make_rank_fn

    workspace, dataset_dir = _paths(args)
    catalog = _load_frozen_catalog(dataset_dir)
    evaluate = load_evaluate(_p6_package_path(args))
    bundle = json.loads((workspace / "contrast_pairs.json").read_text(encoding="utf-8"))
    worlds = {w["world_id"]: w for w in bundle["worlds"]}

    # Default per-pair contrast songs: highest- vs lowest-arousal catalog song. (The
    # operator may override per pair for non-arousal contrasts.)
    song_hi, song_lo = _pick_contrast_songs(catalog)
    pairs = [{**p, "song_hi": song_hi, "song_lo": song_lo} for p in bundle["pairs"]]

    rank_fn = make_rank_fn(evaluate, catalog)
    report = certify_reversals(rank_fn, pairs, worlds)

    out_dir = Path(dataset_dir).parent / "build_reports"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "certification_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "certified": len(report["certified"]),
        "re_harvest_signals": len(report["re_harvest_signals"]),
        "all_reversed": report["all_reversed"],
    }))


def _cmd_report(args: argparse.Namespace) -> None:
    """Assemble the committed build_report.json from generation-side state."""
    from pathlib import Path

    from mdg.coverage.plan import build_coverage_plan
    from mdg.ledger import load_ledger
    from mdg.report import build_report

    workspace, dataset_dir = _paths(args)
    ledger = load_ledger(workspace / "ledger.json")

    def _load(name):
        path = workspace / name
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None

    plan = build_coverage_plan(args.tier, ledger=ledger)
    required_cells = {c.cell_id for c in plan.cells}
    test_cases = None
    tc_path = Path(dataset_dir).parent / "test_cases" / "test_cases.json"
    if tc_path.exists():
        test_cases = json.loads(tc_path.read_text(encoding="utf-8"))

    report = build_report(
        candidate_source=args.candidate_source,
        ledger=ledger,
        required_cells=required_cells,
        soundcharts_calls=(_load("harvest_stats.json") or {}).get("soundcharts_calls", 0),
        probe_result=_load("probe_result.json"),
        repairs=_load("repairs.json"),
        test_cases=test_cases,
    )
    out_dir = Path(dataset_dir).parent / "build_reports"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "build_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"wrote": str(out_dir / "build_report.json"),
                      "coverage_passed": report["coverage_checklist"]["passed"]}))


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
    p_name.add_argument(
        "--tier",
        choices=["smoke", "demonstration", "stress"],
        default="demonstration",
        help="Tier whose coverage targets drive the naming handoff (must match `plan`).",
    )
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
    p_transform.add_argument(
        "--enforce-coverage",
        action="store_true",
        help=(
            "Enforce the §17.6 coverage contract (all tier-planned cells covered) at "
            "freeze. Off by default so intermediate-loop freezes may be partial; enable "
            "for the final demonstration freeze."
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
    p_certify.add_argument(
        "--p6-package",
        metavar="DIR",
        default="packages/aica_transparent_content_selector_v1",
        help="Path to the P6 content-selector package (loads evaluate by file path).",
    )
    p_certify.set_defaults(func=_cmd_certify)

    # --- report ---
    p_report = subparsers.add_parser(
        "report",
        help="Generate build_report.json from current run state.",
    )
    _add_common_args(p_report)
    p_report.add_argument("--tier", choices=["smoke", "demonstration", "stress"],
                          default="demonstration",
                          help="Tier whose coverage checklist the report evaluates.")
    p_report.add_argument("--candidate-source",
                          choices=["isrc_resolved", "soundcharts_search"],
                          default="isrc_resolved",
                          help="Strategy recorded in the report.")
    p_report.set_defaults(func=_cmd_report)

    args = parser.parse_args(argv)
    from mdg.errors import MdgFatalError
    from mdg.handoff import HandoffValidationError
    from mdg.judge import BlindOrderingError

    try:
        args.func(args)
    except MdgFatalError as exc:
        # Taxonomy contract: print {"error": code, "detail": …} and exit non-zero.
        print(json.dumps({"error": exc.code.value, "detail": exc.detail}), file=sys.stderr)
        return 1
    except HandoffValidationError as exc:
        # FR-005 firewall breach in an LLM handoff → clean envelope, not a traceback.
        print(json.dumps({"error": "handoff_validation_failed",
                          "detail": f"[{exc.stage}] {exc.reason}"}), file=sys.stderr)
        return 1
    except BlindOrderingError as exc:
        # SC-009 blind-order breach → clean envelope.
        print(json.dumps({"error": "blind_ordering_violation", "detail": str(exc)}),
              file=sys.stderr)
        return 1
    return 0
