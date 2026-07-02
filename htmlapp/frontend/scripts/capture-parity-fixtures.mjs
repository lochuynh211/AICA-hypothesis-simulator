// Drives the running docker API (http://localhost:8137) and writes golden
// parity fixtures to src/engine/__fixtures__/parity/. Run manually with the
// docker stack up:  docker compose up -d  &&  node scripts/capture-parity-fixtures.mjs
// Each port task ADDS a capture block here; committing the JSON is the contract.
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(here, '..', 'src', 'engine', '__fixtures__', 'parity')
mkdirSync(OUT, { recursive: true })
const BASE = process.env.AICA_API || 'http://localhost:8137'

export function write(name, obj) {
  writeFileSync(resolve(OUT, `${name}.json`), JSON.stringify(obj, null, 2) + '\n')
  console.log(`wrote ${name}.json`)
}
export async function api(path, init) {
  const r = await fetch(`${BASE}${path}`, init)
  if (!r.ok) throw new Error(`${path} → ${r.status}`)
  return r.json()
}

// ── Captures (each port task appends here) ──────────────────────────────────

// binning: mirror the canonical inputs/outputs asserted in test_binning.py.
// If no HTTP surface exists, hand-transcribe {input, output} pairs from that
// test into binning.json (the test file is the reference).
//
// binning.py's build_feature_groups/bin_context are internal service
// functions with no dedicated debug HTTP endpoint, so binning.json was
// hand-derived directly from app/api/tests/test_binning.py's asserted
// thresholds/bands rather than captured from a running docker endpoint.

// declarative_rule / weighted_score: adapter.py, declarative_rule.py, and
// weighted_score.py are pure internal functions with no dedicated debug HTTP
// endpoint (they are invoked by the tick engine mid-run, not exposed as a
// standalone route). declarative_rule.json and weighted_score.json were
// derived by importing the actual Python modules from app/api's project
// venv (`./.venv/bin/python`) and calling `evaluate(...)` directly on inputs
// transcribed from app/api/tests/test_declarative_rule.py and
// test_weighted_score.py (R1-R5 result types for declarative_rule; fire /
// no-fire / boundary-strength / high-monotony / suppressed-candidate cases
// for weighted_score), capturing `result.model_dump_json()` as the golden
// output. This is more reliable than hand-computing the float arithmetic
// and exact `.3f`-formatted explanation strings by hand.

console.log('capture complete')
