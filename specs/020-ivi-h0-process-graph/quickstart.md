# Quickstart: IVI Harness H0 — Process Graph

**Feature**: `specs/020-ivi-h0-process-graph` · **Date**: 2026-09-02

How to build, verify, and demonstrate the process graph. Everything runs on the local Python 3.12
interpreter — **Docker is absent in this environment and `uv` is proxy-blocked**, so neither appears here.

## Build the graph

```bash
cd ivi-building
python lib/process_graph.py
```

Expected summary:

```
rows        3 L1 + 16 L2 + 236 L3 = 255
edges       <N> forward, 1 revisit
findings    217 edge_asymmetry, <N> cross_level_edge, <N> prose_target, 1 revisit_edge
thread      goal_relevant 234, on_thread 210, off_thread 26
human stops 19
wrote       graph/process_graph.json
            graph/extraction_report.md
```

Working directory does not matter — the extractor resolves paths from its own location, so this works
identically from the repository root.

## Run the gate

```bash
python -m pytest ivi-building/tests/ -v
```

Five files. Each maps to a cluster of acceptance criteria:

| File | Covers |
|---|---|
| `test_graph_schema.py` | 255 rows; every work item has ≥1 DoD clause, ≥1 output, non-empty entry; the JSON Schema contract |
| `test_graph_edges.py` | every reference resolves; 217 asymmetries as findings; exactly 1 revisit edge; 255-node topological sort |
| `test_graph_derived.py` | 19 human stops; `SYS1-02-r` excluded; 1 conditional skip; 12/8/5 flag counts |
| `test_graph_thread.py` | 11 critical-path hops reachable; 234 / 210 / 26 memberships; `SYS2-11` and `SYS2-14` on thread |
| `test_graph_determinism.py` | two extractions byte-identical; committed output equals a fresh extraction |

## Verify determinism by hand

```bash
python ivi-building/lib/process_graph.py --check && echo "no drift"
```

Exit `0` means the committed files equal a fresh extraction. Exit `1` means drift — either a source
document changed or someone hand-edited a generated file. Both generated files are produced, never edited.

## Demonstrate the milestone

The milestone's exit demonstration, in three commands:

```bash
cd ivi-building

# 1. Run the extraction for real and read its counts and findings
python lib/process_graph.py

# 2. The gate
python -m pytest tests/ -v

# 3. Re-run and prove byte-identity
python lib/process_graph.py && git diff --stat graph/
#    expected: no output — zero bytes changed
```

Then read `graph/extraction_report.md`: every headline number of this milestone is in it, without opening
the JSON and without opening either source document.

## Read the graph from code

Later milestones must go through `graph_query`, never re-parse the source documents:

```python
import sys; sys.path.insert(0, "ivi-building/lib")
import graph_query

g = graph_query.load()
step = g.node("SYS1-01-a")
print(step["name"])                    # Confirm positioning against higher-level policy
print(len(step["exit_dod"]))           # 3
print(step["examples"][0][:40])        # verbatim from the source document

g.topo_order()                         # 255 ids, forward edges only; raises on a cycle
g.successors("SYS1-01-o")              # ['SYS1-02-a', 'SYS1-03-a', 'SYS1-05-a', 'SYS1-06-a']
"SYS2-13-a" in g.thread["on_thread"]   # False — activity 13 is off-thread
g.findings(kind="edge_asymmetry")      # 217 entries
```

## When a source document is revised

```bash
cd ivi-building
python lib/process_graph.py       # re-extracts; prints count and findings deltas
git diff graph/                   # the review surface — read it before committing
```

There is no staging path and no `--force`. Writes are atomic, so a failed extraction leaves the committed
files untouched.

If the extraction exits `2` complaining about an unrecognised dependency notation, **that is working as
designed**: the source has introduced a form the six-notation resolver does not know. Add the notation to
the resolver with a test, or record the text as a source-document defect. Do not widen the resolver to
swallow it silently, and do not hand-edit the artifact.

## Gotchas

- **Console encoding is cp932 here.** Anything printing Japanese needs `PYTHONIOENCODING=utf-8`, or the
  console mangles it. Every file read and write in the extractor already pins UTF-8.
- **Do not hand-edit `graph/process_graph.json` or `graph/extraction_report.md`.** Both are generated; the
  determinism test will catch it.
- **`graph/` holds data only.** Deterministic code lives in `lib/`, one flat module per milestone that needs
  one.
- **H0 delivers no agents and no run workspace.** If you are looking for the authoring agent, the cold
  verifier, or the ledger, those are H2.
