# Contract: extractor command line

**Feature**: `specs/020-ivi-h0-process-graph` · **Module**: `ivi-building/lib/process_graph.py`

The extractor is a plain script, not a package entry point, so no `__init__.py` is needed and the module
stays liftable. It is invoked by the `ivi-graph-build` skill, by the test suite, and directly by a human.

## Invocation

```bash
# Extract (default): parse, derive, write both outputs atomically, print the summary
python ivi-building/lib/process_graph.py

# Verify only: compare committed output against a fresh extraction; write nothing
python ivi-building/lib/process_graph.py --check

# Write elsewhere (used by the determinism test)
python ivi-building/lib/process_graph.py --out-dir <dir>
```

**Working directory is irrelevant.** All paths resolve from `Path(__file__).resolve().parents[1]`, so the
command behaves identically from `ivi-building/` and from the repository root. This is a contract, not an
implementation detail: the skill runs from `ivi-building/` while the test suite may run from either.

## Arguments

| Argument | Default | Meaning |
|---|---|---|
| `--out-dir DIR` | `ivi-building/graph/` | Destination for both generated files |
| `--check` | off | Compare committed output to a fresh extraction, report drift, write nothing |
| `--quiet` | off | Suppress the human summary; exit code still carries the verdict |

No other arguments. There is deliberately **no `--force` and no staging path**: writes are atomic and the
review surface for a change is the version-control working tree.

## Outputs

| Path | Content |
|---|---|
| `<out-dir>/process_graph.json` | The structured artifact, satisfying `process_graph.schema.json` |
| `<out-dir>/extraction_report.md` | The generated human-readable report |

Both are written **atomically**: produced in full to a temporary file in the same directory, then moved
into place only after the whole extraction succeeds. A partially written file is never observable, and a
failure leaves previously committed output untouched.

Both are UTF-8 with `\n` line endings, written as bytes so the platform cannot inject `\r`.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Extraction succeeded; or `--check` found no drift |
| `1` | `--check` found drift between committed output and a fresh extraction |
| `2` | Extraction failed — see the hard-failure conditions below. Nothing was written. |

## Hard-failure conditions

Each of these stops the extraction with exit code `2` and a message naming the offending source text.
None of them may be downgraded to a finding.

- Row count is not exactly 3 + 16 + 236 = 255.
- A referenced step identifier does not resolve to an existing row.
- A cycle remains among `forward` edges.
- A granularity cell cannot be split into a level and a qualifier.
- A definition-of-done cell yields zero clauses.
- A declared-output cell yields zero outputs, or an entry condition is empty.
- **A dependency-cell token matches none of the six known notations.** This is the important one: a
  revised source document introducing a new notation must stop the build and reach the human, never lose a
  dependency silently.

## Findings, by contrast

A finding is an observation about the source document. It is recorded in the artifact, counted in the
report, and the extraction still **succeeds** with exit code `0`. Findings are never repaired: repairing a
one-directional dependency would assert a dependency the source states only once, which is a claim about
the process rather than about the parse.

## Summary output

On success without `--quiet`, the command prints the same headline numbers the report contains: row counts
by level, edge counts by kind, findings by kind, both thread memberships, and the human-stop count. On a
source revision it additionally prints the count and findings deltas against the previously committed
artifact, and any newly unrecognised notation.

## Stability guarantee

Two consecutive invocations on unchanged sources produce **byte-identical** output in both files. Neither
file contains a timestamp, an absolute path, an interpreter version, or any other varying value.
`meta.sources[].path` is repository-relative for exactly this reason.

Consequently `--check` doubles as a hand-edit detector: an edited generated file shows up as drift.

## Consumers

| Consumer | Uses |
|---|---|
| `ivi-graph-build` skill | Runs the command, presents the summary, triages findings with the human |
| `lib/graph_query.py` | Loads the artifact; the only read path later milestones should use |
| `tests/` | Runs `--out-dir` into temporary directories for the determinism test |
| H1–H8 | Read the artifact through `graph_query`, never by re-parsing the source documents |
