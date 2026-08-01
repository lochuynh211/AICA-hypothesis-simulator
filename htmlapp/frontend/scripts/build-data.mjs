#!/usr/bin/env node
/**
 * build-data — materialise repo data for the offline build.
 *
 * Emits three artifacts, all derived from the SAME copied tree so that
 * hand-editing data/ and re-running is a coherent workflow:
 *
 *   data/**                  the copied JSON tree (git-ignored, inspectable)
 *   data/aica-data.json      merged payload, read by Node/Vitest
 *   public/aica-data.js      window.__AICA_DATA__ = Object.freeze(<payload>)
 *
 * A <script> tag rather than fetch() of data/ is load-bearing: Chrome blocks
 * fetch() at file://, and double-click delivery is non-negotiable.
 *
 * Usage:
 *   node scripts/build-data.mjs                 # full build
 *   node scripts/build-data.mjs --emit-only DIR # regenerate the bundle only
 */
import { cpSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectData } from './lib/collect-data.mjs'
import { SOURCES } from '../data.manifest.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const FRONTEND = resolve(here, '..')
const REPO_ROOT = resolve(FRONTEND, '..', '..')

/** Serialize the payload as a self-contained global assignment. */
export function renderBundleJs(payload) {
  // `</script>` inside any string would close the host <script> tag early.
  const json = JSON.stringify(payload).replace(/<\/script>/gi, '<\\/script>')
  return `window.__AICA_DATA__ = Object.freeze(${json})\n`
}

export function buildData({ repoRoot, outDir, publicDir, emitOnly }) {
  const { payload, problems } = collectData(repoRoot)
  const written = []

  if (emitOnly) {
    mkdirSync(emitOnly, { recursive: true })
    const target = join(emitOnly, 'aica-data.js')
    writeFileSync(target, renderBundleJs(payload), 'utf8')
    written.push(target)
    return { payload, problems, written }
  }

  // Copy the source tree. Removed first so a deleted upstream file does not
  // linger in data/ and reappear in a later hand-edit workflow.
  rmSync(outDir, { recursive: true, force: true })
  for (const src of SOURCES) {
    const from = resolve(repoRoot, src.from)
    const to = join(outDir, src.from)
    mkdirSync(dirname(to), { recursive: true })
    cpSync(from, to, { recursive: true })
  }

  const jsonPath = join(outDir, 'aica-data.json')
  writeFileSync(jsonPath, JSON.stringify(payload), 'utf8')
  written.push(jsonPath)

  mkdirSync(publicDir, { recursive: true })
  const jsPath = join(publicDir, 'aica-data.js')
  writeFileSync(jsPath, renderBundleJs(payload), 'utf8')
  written.push(jsPath)

  return { payload, problems, written }
}

// CLI entry — only when run directly, so importing this module in tests is inert.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const emitIdx = process.argv.indexOf('--emit-only')
  const emitOnly = emitIdx !== -1 ? resolve(process.argv[emitIdx + 1]) : undefined
  const { payload, problems, written } = buildData({
    repoRoot: REPO_ROOT,
    outDir: join(FRONTEND, 'data'),
    publicDir: join(FRONTEND, 'public'),
    emitOnly,
  })
  for (const p of problems) console.error(`✗ ${p}`)
  if (problems.length) {
    console.error(`\n✗ build-data found ${problems.length} problem(s) in repo data.`)
    process.exit(1)
  }
  for (const src of SOURCES) {
    const v = payload[src.key]
    const n = v == null ? 0 : Array.isArray(v) ? v.length : typeof v === 'object' ? Object.keys(v).length : 1
    console.log(`  ${src.key.padEnd(20)} ${String(n).padStart(4)}  ← ${src.from}`)
  }
  for (const w of written) console.log(`✓ wrote ${w}`)
}
