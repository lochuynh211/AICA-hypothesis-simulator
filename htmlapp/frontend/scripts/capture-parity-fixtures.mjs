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
// (populated starting in Task S2.4)

console.log('capture complete')
