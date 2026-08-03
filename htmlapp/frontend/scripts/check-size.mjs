#!/usr/bin/env node
/**
 * check-size — enforce the app/data/hard-cap size budgets against whatever
 * actually ships, for either deliverable.
 *
 * Two deliverables, two measurement strategies:
 *
 *   - multi-file (`npm run build`): dist/ in full is the deliverable, so
 *     every file in it is summed. dist/aica-data.js sits there untouched, so
 *     the data figure is read directly off disk.
 *
 *   - single-file (`npm run build:singlefile` / `build:customer`): the
 *     deliverable is dist/index.html PLUS any sibling chunk vite/rollup
 *     could not inline. Today that is exactly one file, backend.worker-*.js
 *     (~299 KB) — a dynamically-constructed Worker can't be turned into
 *     inline source, so it ships as a separate file next to index.html. It
 *     is inert at file:// (the Worker constructor throws SecurityError there
 *     and the engine falls back in-process) but would activate if a customer
 *     instead serves the folder over http — see zip-dist.mjs for why both
 *     files ship together. Every file in dist/, not just index.html, is
 *     summed here for exactly that reason: a gate that measures index.html
 *     alone is blind to that sibling file, which is precisely the bug this
 *     script used to have (298,587 B unmeasured, unnoticed, invisible to the
 *     budget it was meant to enforce).
 *
 *     The data payload itself is inlined into index.html by inline-data.mjs,
 *     which then deletes its standalone dist/aica-data.js — so by the time
 *     this script runs, dist/ no longer has a data file to read. But
 *     inline-data.mjs's source for that inlining is public/aica-data.js,
 *     which vite copies byte-for-byte into dist/aica-data.js before
 *     inline-data.mjs consumes it (public/ assets are never transformed).
 *     So public/aica-data.js is an EXACT measurement of the bytes now
 *     sitting inside index.html's <script> tag — not an estimate. This was
 *     verified directly: the embedded `<script>window.__AICA_DATA__…`
 *     content and public/aica-data.js are byte-identical (same length,
 *     Buffer.compare equal). build:singlefile always runs `npm run
 *     build:data` as its first step, so public/aica-data.js is guaranteed
 *     fresh — regenerated in the same invocation — by the time this script
 *     runs; if it is ever missing, that is treated as a hard failure rather
 *     than papered over with a guess.
 *
 * Budget arithmetic: APP_MAX + DATA_MAX (3.5 MB) is deliberately larger than
 * MAX (3 MB). These are not a partition that must sum to the cap — they are
 * independent per-category ceilings, each catching a regression in its own
 * area (a dataset change silently eating the app's headroom, or vice versa)
 * before it becomes a mystery failure in someone else's check. MAX is the
 * one gate that actually blocks shipping, and it is asserted unconditionally
 * against the real total bytes on every path below, independently of
 * whether the two sub-budgets pass — so a build can fail MAX while passing
 * both sub-budgets (e.g. app 1.4 MB + data 1.9 MB = 3.3 MB: both sub-budgets
 * pass, MAX does not), and that is by design, not an inconsistency: passing
 * app+data is never treated as sufficient on its own.
 */
import { statSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const distDir = resolve(here, '..', 'dist')
const publicDataPath = resolve(here, '..', 'public', 'aica-data.js')

export const MAX = 3 * 1024 * 1024
export const DATA_MAX = 2 * 1024 * 1024
export const APP_MAX = 1.5 * 1024 * 1024

export const mb = (bytes) => (bytes / 1024 / 1024).toFixed(2)

export function sumDir(dir) {
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    total += entry.isDirectory() ? sumDir(full) : statSync(full).size
  }
  return total
}

/**
 * Multi-file deliverable: dist/ in full is what ships. aica-data.js sits in
 * dist/ untouched by any later step, so it is read directly.
 */
export function measureMulti(dir) {
  const dataPath = join(dir, 'aica-data.js')
  const dataBytes = existsSync(dataPath) ? statSync(dataPath).size : 0
  const totalBytes = sumDir(dir)
  return { appBytes: totalBytes - dataBytes, dataBytes, totalBytes }
}

/**
 * Single-file deliverable: every file in dist/ ships (index.html plus any
 * sibling chunk vite could not inline) and is summed into totalBytes. The
 * data payload inlined into index.html is measured via dataSourcePath — see
 * the header comment for why that is exact, not estimated. Throws rather
 * than guessing if dataSourcePath is missing.
 */
export function measureSingle(dir, dataSourcePath) {
  if (!existsSync(dataSourcePath)) {
    throw new Error(
      `${dataSourcePath} not found — run \`npm run build:data\` before check-size.mjs --single ` +
        `(build:singlefile does this automatically as its first step).`
    )
  }
  const totalBytes = sumDir(dir)
  const dataBytes = statSync(dataSourcePath).size
  return { appBytes: totalBytes - dataBytes, dataBytes, totalBytes }
}

/**
 * The three budget checks, applied identically regardless of which
 * deliverable produced the measurement — see the header comment on why MAX
 * is always asserted independently of the two sub-budgets.
 */
export function evaluateBudget({ appBytes, dataBytes, totalBytes }) {
  const lines = [
    `  app   ${mb(appBytes)} MB (budget ${mb(APP_MAX)} MB)`,
    `  data  ${mb(dataBytes)} MB (budget ${mb(DATA_MAX)} MB)`,
    `  total ${mb(totalBytes)} MB (cap ${mb(MAX)} MB)`,
  ]
  const errors = []
  if (appBytes > APP_MAX) errors.push('app bundle over budget.')
  if (dataBytes > DATA_MAX) errors.push('data bundle over budget.')
  if (totalBytes > MAX) errors.push('over the 3 MB hard cap.')
  return { lines, errors, ok: errors.length === 0 }
}

function main() {
  const single = process.argv.includes('--single')
  const measurement = single ? measureSingle(distDir, publicDataPath) : measureMulti(distDir)
  const { lines, errors, ok } = evaluateBudget(measurement)

  for (const line of lines) console.log(line)
  for (const err of errors) console.error(`✗ ${err}`)
  if (ok) console.log(`✓ within budget.`)

  process.exit(ok ? 0 : 1)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main()
}
