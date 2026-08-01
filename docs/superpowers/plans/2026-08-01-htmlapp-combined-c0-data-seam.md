# HTMLApp Combined Export — C0: Data Seam + Sync Repair — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every piece of simulator data (presets, combined test cases, profiles, seeds, matrix, dispositions, service capabilities, song catalog, scenarios, route presets, package manifests) reach the offline htmlapp through a generated data bundle, so changing that data needs no code edit and no app rebuild — and repair `sync-from-app.mjs`, which is already broken.

**Architecture:** A committed manifest (`data.manifest.mjs`) declares which repo directories are data. `npm run build:data` copies them into a git-ignored `htmlapp/frontend/data/` tree and emits two derived artifacts from that tree: `data/aica-data.json` (for Node/Vitest) and `public/aica-data.js` (a `window.__AICA_DATA__ = Object.freeze(…)` assignment loaded by its own `<script>` tag, because Chrome blocks `fetch()` at `file://`). One module, `src/data/registry.ts`, is the sole reader of that payload; it validates shape and referential integrity once and fails fast with every problem listed. The backend worker is a separate global scope that a `<script>` tag cannot reach, so `WorkerTransport` installs the payload into it with a `data.install` op before any other call.

**Tech Stack:** TypeScript 5.8, React 18, Vite 5, Vitest 1.6, `idb` (IndexedDB), Node ESM scripts. No new dependencies.

## Global Constraints

- **No new runtime or dev dependencies.** (See the `httpx2` supply-chain incident — dependencies are pinned and new ones are not added without verifying upstream.) The glob matching in this plan is hand-rolled for exactly this reason.
- **No changes under `app/frontend/` or `app/api/`.** htmlapp is purely additive.
- **All work happens under `htmlapp/frontend/`**, except `.gitignore` at the repo root.
- **`file://` double-click delivery must keep working.** No `fetch()` of local files anywhere in the boot path.
- **Data vs source boundary:** manifests, parameters, hyperparameters, presets, cases, profiles, seeds and catalog are *data*; executable algorithm code (`src/data/packages/builtin/*.ts`) is *source* and stays in `src/`.
- **Payload keys are exactly:** `combinedCases`, `presets`, `profiles`, `seeds`, `scenarios`, `routePresets`, `packageManifests`, `matrix`, `dispositions`, `serviceCapabilities`, `datasets`. Plus `schema_version`.
- **The htmlapp Trigger screen must still work at the end of C0.** Every existing test stays green.
- Run all commands from `htmlapp/frontend/` unless stated otherwise.
- Verify with `npm test` (Vitest) and `npm run typecheck` (`tsc --noEmit --project tsconfig.authored.json`).

---

### Task 1: Data manifest and pure collector

The manifest is the contract; the collector turns it into a payload object. Split from file-writing so it can be unit-tested against the real repo.

**Files:**
- Create: `htmlapp/frontend/data.manifest.mjs`
- Create: `htmlapp/frontend/scripts/lib/collect-data.mjs`
- Test: `htmlapp/frontend/tests/collect_data.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `data.manifest.mjs` exports `SCHEMA_VERSION: number` and `SOURCES: Array<{ key, from, glob?, shape: 'byId'|'single'|'datasets', idField? }>`.
  - `collect-data.mjs` exports `collectData(repoRoot: string): { payload: object, problems: string[] }` and `listMatching(baseDir: string, pattern: string): string[]`.

- [ ] **Step 1: Write the failing test**

Create `htmlapp/frontend/tests/collect_data.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { collectData, listMatching } from '../scripts/lib/collect-data.mjs'
import { SOURCES } from '../data.manifest.mjs'

// htmlapp/frontend -> repo root
const REPO_ROOT = resolve(__dirname, '..', '..', '..')

describe('listMatching', () => {
  it('matches a flat glob', () => {
    const files = listMatching(resolve(REPO_ROOT, 'routes/presets'), '*.json')
    expect(files.length).toBe(3)
    expect(files.every((f) => f.endsWith('.json'))).toBe(true)
  })

  it('matches a one-level nested glob', () => {
    const files = listMatching(resolve(REPO_ROOT, 'packages'), '*/package.json')
    expect(files.length).toBeGreaterThanOrEqual(6)
  })

  it('returns [] for a missing directory instead of throwing', () => {
    expect(listMatching(resolve(REPO_ROOT, 'does/not/exist'), '*.json')).toEqual([])
  })

  it('returns results sorted so the payload is deterministic', () => {
    const files = listMatching(resolve(REPO_ROOT, 'routes/presets'), '*.json')
    expect(files).toEqual([...files].sort())
  })
})

describe('collectData', () => {
  const { payload, problems } = collectData(REPO_ROOT)

  it('reports no problems against the committed repo data', () => {
    expect(problems).toEqual([])
  })

  it('produces every manifest key', () => {
    for (const src of SOURCES) expect(payload).toHaveProperty(src.key)
  })

  it('keys byId collections by their declared id field', () => {
    for (const [id, doc] of Object.entries(payload.presets)) {
      expect((doc as any).preset_id).toBe(id)
    }
    for (const [id, doc] of Object.entries(payload.combinedCases)) {
      expect((doc as any).case_id).toBe(id)
    }
    for (const [id, doc] of Object.entries(payload.packageManifests)) {
      expect((doc as any).id).toBe(id)
    }
  })

  // Non-empty rather than exact counts: data churns by design, and a count
  // assertion would make retuning a preset a code change. Specific ids are
  // asserted only where other code hardcodes them.
  it('collects non-empty collections', () => {
    expect(Object.keys(payload.presets).length).toBeGreaterThan(0)
    expect(Object.keys(payload.combinedCases).length).toBeGreaterThan(0)
    expect(Object.keys(payload.profiles).length).toBeGreaterThan(0)
    expect(Object.keys(payload.seeds).length).toBeGreaterThan(0)
    expect(Object.keys(payload.scenarios).length).toBeGreaterThan(0)
    expect(Object.keys(payload.routePresets).length).toBeGreaterThan(0)
    expect(Object.keys(payload.packageManifests).length).toBeGreaterThan(0)
  })

  it('includes the case the Combined screen opens on', () => {
    expect(payload.combinedCases).toHaveProperty('case-c01-alert-daytime-control')
  })

  it('excludes README.md from id-keyed collections', () => {
    expect(Object.keys(payload.presets).some((k) => k.toLowerCase().includes('readme'))).toBe(false)
  })

  it('reads single-document sources as objects, not maps', () => {
    expect(payload.matrix).toHaveProperty('matrix_version')
    expect(payload.dispositions).toHaveProperty('registry_version')
    expect(payload.serviceCapabilities).toHaveProperty('capabilities_version')
  })

  it('collects each dataset with its manifest and catalog', () => {
    const ids = Object.keys(payload.datasets)
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      expect(payload.datasets[id].manifest.dataset_id).toBe(id)
      expect(payload.datasets[id].catalog).toBeTruthy()
    }
  })

  it('stamps the schema version', () => {
    expect(payload.schema_version).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- collect_data`
Expected: FAIL — cannot resolve `../scripts/lib/collect-data.mjs` and `../data.manifest.mjs`.

- [ ] **Step 3: Write the manifest**

Create `htmlapp/frontend/data.manifest.mjs`:

```js
/**
 * The data contract for the offline build.
 *
 * This file declares WHICH repo directories are data. Adding a preset, a
 * combined test case, a driver profile or a route preset is a change to those
 * directories only — never to this file and never to htmlapp source. Adding a
 * whole new KIND of data is the one change that belongs here.
 *
 * `from` paths are relative to the repo root. Consumed by
 * scripts/lib/collect-data.mjs (pure) and scripts/build-data.mjs (writes).
 */

export const SCHEMA_VERSION = 1

/**
 * shape:
 *   'byId'     — many files, keyed by `idField` into an object (keys sorted)
 *   'single'   — exactly one file, stored as-is
 *   'datasets' — one directory per dataset; see collectDatasets()
 */
export const SOURCES = [
  { key: 'combinedCases',       from: 'combined_contracts/test_cases',           glob: 'case-*.json',    shape: 'byId', idField: 'case_id' },
  { key: 'presets',             from: 'proposal_contracts/presets',              glob: 'preset-*.json',  shape: 'byId', idField: 'preset_id' },
  { key: 'profiles',            from: 'proposal_contracts/profiles',             glob: 'profile-*.json', shape: 'byId', idField: 'profile_id' },
  { key: 'seeds',               from: 'proposal_contracts/seeds',                glob: 'seed-*.json',    shape: 'byId', idField: 'seed_id' },
  { key: 'scenarios',           from: 'scenarios',                               glob: '*.json',         shape: 'byId', idField: 'id' },
  { key: 'routePresets',        from: 'routes/presets',                          glob: '*.json',         shape: 'byId', idField: 'id' },
  { key: 'packageManifests',    from: 'packages',                                glob: '*/package.json', shape: 'byId', idField: 'id' },
  { key: 'matrix',              from: 'proposal_contracts/matrix',               glob: '*.json',         shape: 'single' },
  { key: 'dispositions',        from: 'proposal_contracts/dispositions',         glob: '*.json',         shape: 'single' },
  { key: 'serviceCapabilities', from: 'proposal_contracts/service_capabilities', glob: '*.json',         shape: 'single' },
  { key: 'datasets',            from: 'proposal_contracts/dataset',                                      shape: 'datasets' },
]
```

- [ ] **Step 4: Write the collector**

Create `htmlapp/frontend/scripts/lib/collect-data.mjs`:

```js
/**
 * Pure data collection: repo directories -> one payload object.
 *
 * Reads only. Writing is scripts/build-data.mjs's job, so this module can be
 * unit-tested against the real committed data with no filesystem side effects.
 *
 * Glob support is hand-rolled (`*` within one path segment, at most one `/`)
 * because htmlapp takes no new dependencies.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'
import { SOURCES, SCHEMA_VERSION } from '../../data.manifest.mjs'

function segToRegExp(seg) {
  const escaped = seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')
  return new RegExp(`^${escaped}$`)
}

/** Files under `baseDir` matching `pattern`. Sorted, so payloads are deterministic. */
export function listMatching(baseDir, pattern) {
  const segs = pattern.split('/')
  let dirs = existsSync(baseDir) ? [baseDir] : []
  for (let i = 0; i < segs.length - 1; i++) {
    const re = segToRegExp(segs[i])
    dirs = dirs.flatMap((d) =>
      readdirSync(d, { withFileTypes: true })
        .filter((e) => e.isDirectory() && re.test(e.name))
        .map((e) => join(d, e.name)),
    )
  }
  const fileRe = segToRegExp(segs[segs.length - 1])
  return dirs
    .flatMap((d) =>
      readdirSync(d, { withFileTypes: true })
        .filter((e) => e.isFile() && fileRe.test(e.name))
        .map((e) => join(d, e.name)),
    )
    .sort()
}

function readJson(file, problems, repoRoot) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    problems.push(`${relative(repoRoot, file)}: invalid JSON — ${e.message}`)
    return null
  }
}

function collectDatasets(base, problems, repoRoot) {
  // A Map, not an object literal: ids come from data files and are
  // unconstrained, so `out['__proto__'] = …` on a plain object would reassign
  // the prototype instead of storing the record — dropping it with no trace.
  const out = new Map()
  if (!existsSync(base)) {
    problems.push(`datasets: missing directory ${relative(repoRoot, base)}`)
    return out
  }
  for (const entry of readdirSync(base, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue
    const dir = join(base, entry.name)
    const manifestPath = join(dir, 'dataset_manifest.json')
    const catalogPath = join(dir, 'catalog.json')
    if (!existsSync(manifestPath) || !existsSync(catalogPath)) {
      problems.push(`datasets/${entry.name}: needs both dataset_manifest.json and catalog.json`)
      continue
    }
    const manifest = readJson(manifestPath, problems, repoRoot)
    const catalog = readJson(catalogPath, problems, repoRoot)
    if (!manifest || !catalog) continue
    const id = manifest.dataset_id
    if (typeof id !== 'string' || !id) {
      problems.push(`datasets/${entry.name}: dataset_manifest.json has no string 'dataset_id'`)
      continue
    }
    if (out.has(id)) {
      problems.push(`datasets/${entry.name}: duplicate dataset_id '${id}' — already declared by another directory`)
      continue
    }
    const affinityPath = join(dir, 'genre_affinity_v1.json')
    out.set(id, {
      manifest,
      catalog,
      genreAffinity: existsSync(affinityPath) ? readJson(affinityPath, problems, repoRoot) : null,
    })
  }
  // Sorted by dataset_id (not directory name) to match the byId path's convention.
  return Object.fromEntries([...out.keys()].sort().map((k) => [k, out.get(k)]))
}

/** Collect every manifest source under `repoRoot`. Never throws — problems are returned. */
export function collectData(repoRoot) {
  const problems = []
  const payload = { schema_version: SCHEMA_VERSION }

  for (const src of SOURCES) {
    const base = resolve(repoRoot, src.from)

    if (src.shape === 'datasets') {
      payload[src.key] = collectDatasets(base, problems, repoRoot)
      continue
    }

    const files = listMatching(base, src.glob)
    if (files.length === 0) {
      problems.push(`${src.key}: no files matched ${src.from}/${src.glob}`)
    }

    if (src.shape === 'single') {
      if (files.length > 1) {
        problems.push(`${src.key}: expected exactly one file in ${src.from}, found ${files.length}`)
      }
      payload[src.key] = files.length ? readJson(files[0], problems, repoRoot) : null
      continue
    }

    // A Map, not an object literal — see collectDatasets for why.
    const collected = new Map()
    for (const file of files) {
      const doc = readJson(file, problems, repoRoot)
      if (!doc) continue
      const id = doc[src.idField]
      if (typeof id !== 'string' || !id) {
        problems.push(`${src.key}: ${relative(repoRoot, file)} has no string '${src.idField}'`)
        continue
      }
      if (collected.has(id)) {
        problems.push(`${src.key}: duplicate id '${id}' from ${relative(repoRoot, file)}`)
        continue
      }
      collected.set(id, doc)
    }
    // Object.fromEntries defines own properties, so '__proto__' survives the
    // conversion as real data — and JSON.parse restores it the same way.
    payload[src.key] = Object.fromEntries([...collected.keys()].sort().map((k) => [k, collected.get(k)]))
  }

  return { payload, problems }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- collect_data`
Expected: PASS, all cases.

If `problems` is non-empty, print it — a real repo-data defect (a duplicate id, an unparseable file) is a genuine finding, not a test to loosen.

- [ ] **Step 6: Commit**

```bash
git add htmlapp/frontend/data.manifest.mjs htmlapp/frontend/scripts/lib/collect-data.mjs htmlapp/frontend/tests/collect_data.test.ts
git commit -m "feat(htmlapp): declare the data manifest and a pure repo-data collector"
```

---

### Task 2: Generator script and npm wiring

Turns the payload into the three on-disk artifacts and wires it into the build/test lifecycle.

**Files:**
- Create: `htmlapp/frontend/scripts/build-data.mjs`
- Modify: `htmlapp/frontend/package.json` (scripts block)
- Modify: `.gitignore` (repo root)
- Test: `htmlapp/frontend/tests/build_data.test.ts`

**Interfaces:**
- Consumes: `collectData(repoRoot)` and `SOURCES` from Task 1.
- Produces: `scripts/build-data.mjs` exports `renderBundleJs(payload: object): string` and `buildData(opts: { repoRoot, outDir, publicDir, emitOnly?: string }): { payload, problems, written: string[] }`. On-disk artifacts: `data/**` (tree copy), `data/aica-data.json`, `public/aica-data.js`.

- [ ] **Step 1: Write the failing test**

Create `htmlapp/frontend/tests/build_data.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { buildData, renderBundleJs } from '../scripts/build-data.mjs'

const REPO_ROOT = resolve(__dirname, '..', '..', '..')

describe('renderBundleJs', () => {
  it('emits a frozen global assignment', () => {
    const js = renderBundleJs({ schema_version: 1, presets: {} })
    expect(js).toContain('window.__AICA_DATA__')
    expect(js).toContain('Object.freeze')
    expect(js.trimEnd().endsWith(')')).toBe(true)
  })

  it('escapes every < so the payload cannot close its own tag', () => {
    // Not just `</script>`: the HTML tokenizer also ends script data on
    // `</script `, `</script/` and `</script>`, so all three must be neutralised.
    for (const evil of ['</script><script>alert(1)</script>', '</script /><script>x</script>', '</script/>']) {
      const js = renderBundleJs({ evil })
      expect(js).not.toMatch(/<\/script/i)
      expect(js).not.toContain('<')
    }
  })

  it('round-trips through JSON.parse of the embedded literal', () => {
    const payload = { schema_version: 1, presets: { a: { preset_id: 'a' } } }
    const js = renderBundleJs(payload)
    const literal = js.slice(js.indexOf('Object.freeze(') + 'Object.freeze('.length, js.lastIndexOf(')'))
    expect(JSON.parse(literal)).toEqual(payload)
  })
})

describe('buildData', () => {
  let out: string
  let pub: string
  let result: ReturnType<typeof buildData>

  beforeAll(() => {
    const tmp = mkdtempSync(join(tmpdir(), 'aica-data-'))
    out = join(tmp, 'data')
    pub = join(tmp, 'public')
    result = buildData({ repoRoot: REPO_ROOT, outDir: out, publicDir: pub })
  })

  it('reports no problems against committed repo data', () => {
    expect(result.problems).toEqual([])
  })

  it('writes the merged payload JSON', () => {
    const p = join(out, 'aica-data.json')
    expect(existsSync(p)).toBe(true)
    const parsed = JSON.parse(readFileSync(p, 'utf8'))
    expect(parsed.schema_version).toBe(1)
    expect(Object.keys(parsed.presets).length).toBeGreaterThan(0)
  })

  it('writes the browser bundle', () => {
    expect(existsSync(join(pub, 'aica-data.js'))).toBe(true)
  })

  it('copies the source tree for inspection', () => {
    expect(existsSync(join(out, 'proposal_contracts', 'presets'))).toBe(true)
    expect(existsSync(join(out, 'combined_contracts', 'test_cases'))).toBe(true)
  })

  it('is idempotent — a second run produces an identical payload', () => {
    const again = buildData({ repoRoot: REPO_ROOT, outDir: out, publicDir: pub })
    expect(JSON.stringify(again.payload)).toBe(JSON.stringify(result.payload))
  })

  it('emitOnly writes just the bundle', () => {
    const tmp2 = mkdtempSync(join(tmpdir(), 'aica-emit-'))
    const r = buildData({ repoRoot: REPO_ROOT, outDir: out, publicDir: pub, emitOnly: tmp2 })
    expect(existsSync(join(tmp2, 'aica-data.js'))).toBe(true)
    expect(r.written).toEqual([join(tmp2, 'aica-data.js')])
    rmSync(tmp2, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- build_data`
Expected: FAIL — cannot resolve `../scripts/build-data.mjs`.

- [ ] **Step 3: Write the generator**

Create `htmlapp/frontend/scripts/build-data.mjs`:

```js
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
  // Escape EVERY `<`, not just the literal `</script>`. The HTML tokenizer ends
  // script data as soon as `</script` is followed by whitespace, `/` or `>`, so
  // `</script />` and `</script/>` break out of a `</script>`-only filter — and
  // once build:singlefile inlines this file into index.html, that breakout is a
  // live script element. `<` never appears in JSON structure, only inside string
  // values, so blanket-escaping it is safe; `<` is read back as `<` by both
  // the JS parser and JSON.parse, leaving the data itself unchanged.
  const json = JSON.stringify(payload).replace(/</g, '\\u003c')
  return `window.__AICA_DATA__ = Object.freeze(${json})\n`
}

/**
 * Guard the recursive delete below. `outDir` is a caller-supplied parameter and
 * `buildData` is exported, so a typo or a wrong call site could otherwise aim
 * `rmSync(…, { recursive: true })` at the repo itself. Two conditions make the
 * destructive operation provably scoped: the target may never be the repo root
 * or an ancestor of it, and it must be a directory literally named `data` —
 * the only directory this generator owns.
 */
function assertSafeOutDir(outDir, repoRoot) {
  const out = resolve(outDir)
  const root = resolve(repoRoot)
  if (out === root || root === join(out, '..') || root.startsWith(out + sep)) {
    throw new Error(`refusing to delete '${out}': it is the repo root or an ancestor of it`)
  }
  if (basename(out) !== 'data') {
    throw new Error(`refusing to delete '${out}': build-data only manages directories named 'data'`)
  }
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
  assertSafeOutDir(outDir, repoRoot)
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
```

- [ ] **Step 4: Wire the npm scripts**

In `htmlapp/frontend/package.json`, replace the `"scripts"` block's `build`, and add `build:data`, `prebuild` and `pretest`:

```json
  "scripts": {
    "dev": "npm run build:data && vite",
    "typecheck": "tsc --noEmit --project tsconfig.authored.json",
    "build:data": "node scripts/build-data.mjs",
    "prebuild": "npm run build:data",
    "build": "npm run typecheck && vite build && node scripts/check-size.mjs && node scripts/zip-dist.mjs",
    "build:singlefile": "npm run build:data && npm run typecheck && cross-env HTMLAPP_SINGLEFILE=1 vite build && node scripts/check-size.mjs --single",
    "build:customer": "node scripts/check-customer-config.mjs && npm run build",
    "preview": "vite preview",
    "pretest": "npm run build:data",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "sync": "node scripts/sync-from-app.mjs",
    "capture-fixtures": "echo 'Run from repo root: PYTHONPATH=app/api python htmlapp/frontend/scripts/gen/capture_all.py'"
  },
```

- [ ] **Step 5: Ignore the generated artifacts**

Append to the repo-root `.gitignore`:

```gitignore
# htmlapp generated data seam (regenerate with: npm run build:data)
htmlapp/frontend/data/
htmlapp/frontend/public/aica-data.js
```

- [ ] **Step 6: Run the generator and the tests**

Run: `npm run build:data && npm test -- build_data`
Expected: the generator prints a per-key count table and three `✓ wrote` lines; the test file PASSES.

- [ ] **Step 7: Commit**

```bash
git add htmlapp/frontend/scripts/build-data.mjs htmlapp/frontend/tests/build_data.test.ts htmlapp/frontend/package.json .gitignore
git commit -m "feat(htmlapp): build:data generator emitting the data tree, payload and browser bundle"
```

---

### Task 3: Registry — install and shape validation

The single reader of the payload. Everything else in the app goes through it.

**Files:**
- Create: `htmlapp/frontend/src/data/registry.ts`
- Test: `htmlapp/frontend/tests/registry.test.ts`

**Interfaces:**
- Consumes: the payload shape produced by Task 1.
- Produces:
  - `type AicaDataPayload` — the payload's TS shape.
  - `class DataRegistryError extends Error { problems: string[] }`
  - `installRegistry(payload: unknown): void` — validate and memoize; throws `DataRegistryError`.
  - `ensureRegistry(): AicaDataPayload` — install from `globalThis.__AICA_DATA__` on first call; throws `DataRegistryError` if absent or invalid.
  - `resetRegistryForTests(): void`
  - Accessors, all throwing `DataRegistryError` if the registry is not installed:
    `getCombinedCases(): CombinedCaseDoc[]`, `getCombinedCase(id): CombinedCaseDoc | null`,
    `getPresets(): PresetDoc[]`, `getPreset(id): PresetDoc | null`,
    `getProfiles(): ProfileDoc[]`, `getProfile(id): ProfileDoc | null`,
    `getSeeds(): SeedDoc[]`, `getSeed(id): SeedDoc | null`,
    `getScenarioDefs(): ScenarioDef[]`, `getScenarioDef(id): ScenarioDef | null`,
    `getRoutePresetDocs(): RoutePreset[]`, `getRoutePresetDoc(id): RoutePreset | null`,
    `getPackageManifests(): PackageManifest[]`, `getPackageManifest(id): PackageManifest | null`,
    `getMatrix(): unknown`, `getDispositions(): unknown`, `getServiceCapabilities(): unknown`,
    `getDatasetIds(): string[]`, `getDataset(id): DatasetEntry | null`.

- [ ] **Step 1: Write the failing test**

Create `htmlapp/frontend/tests/registry.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  installRegistry,
  ensureRegistry,
  resetRegistryForTests,
  DataRegistryError,
  getPresets,
  getPreset,
  getCombinedCases,
  getScenarioDefs,
  getRoutePresetDocs,
  getPackageManifests,
  getMatrix,
  getDatasetIds,
  getDataset,
} from '../src/data/registry'

const REAL = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'data', 'aica-data.json'), 'utf8'),
)

/** Structurally valid minimum, used for negative cases. */
function minimal(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    combinedCases: { c: { case_id: 'c' } },
    presets: { p: { preset_id: 'p' } },
    profiles: { pr: { profile_id: 'pr' } },
    seeds: { s: { seed_id: 's' } },
    scenarios: { sc: { id: 'sc' } },
    routePresets: { r: { id: 'r' } },
    packageManifests: { pk: { id: 'pk' } },
    matrix: { matrix_version: '1' },
    dispositions: { registry_version: '1' },
    serviceCapabilities: { capabilities_version: '1' },
    datasets: { d: { manifest: { dataset_id: 'd' }, catalog: {}, genreAffinity: null } },
    ...overrides,
  }
}

beforeEach(() => {
  resetRegistryForTests()
  delete (globalThis as any).__AICA_DATA__
})

describe('installRegistry', () => {
  it('accepts the real generated payload', () => {
    expect(() => installRegistry(REAL)).not.toThrow()
    expect(getPresets().length).toBeGreaterThan(0)
  })

  it('rejects a null payload with a readable error', () => {
    expect(() => installRegistry(null)).toThrow(DataRegistryError)
  })

  it('lists EVERY missing key, not just the first', () => {
    const broken = minimal()
    delete (broken as any).presets
    delete (broken as any).scenarios
    delete (broken as any).matrix
    try {
      installRegistry(broken)
      throw new Error('expected throw')
    } catch (e) {
      const problems = (e as DataRegistryError).problems
      expect(problems.some((p) => p.includes('presets'))).toBe(true)
      expect(problems.some((p) => p.includes('scenarios'))).toBe(true)
      expect(problems.some((p) => p.includes('matrix'))).toBe(true)
    }
  })

  it('rejects a schema_version it does not understand', () => {
    expect(() => installRegistry(minimal({ schema_version: 99 }))).toThrow(DataRegistryError)
  })

  it('rejects an empty id-keyed collection', () => {
    expect(() => installRegistry(minimal({ presets: {} }))).toThrow(DataRegistryError)
  })

  it('rejects a record whose id does not match its key', () => {
    expect(() => installRegistry(minimal({ presets: { p: { preset_id: 'MISMATCH' } } }))).toThrow(
      DataRegistryError,
    )
  })
})

describe('ensureRegistry', () => {
  it('installs from globalThis.__AICA_DATA__', () => {
    ;(globalThis as any).__AICA_DATA__ = REAL
    expect(ensureRegistry().schema_version).toBe(1)
  })

  it('throws a readable error when the bundle never loaded', () => {
    try {
      ensureRegistry()
      throw new Error('expected throw')
    } catch (e) {
      expect(e).toBeInstanceOf(DataRegistryError)
      expect((e as DataRegistryError).problems.join(' ')).toMatch(/aica-data\.js/)
    }
  })

  it('is memoized — a later global change does not take effect', () => {
    ;(globalThis as any).__AICA_DATA__ = REAL
    const first = ensureRegistry()
    ;(globalThis as any).__AICA_DATA__ = minimal()
    expect(ensureRegistry()).toBe(first)
  })
})

describe('accessors', () => {
  beforeEach(() => installRegistry(REAL))

  it('throws when the registry is not installed', () => {
    resetRegistryForTests()
    expect(() => getPresets()).toThrow(DataRegistryError)
  })

  it('returns collections as arrays in sorted-key order', () => {
    const ids = getPresets().map((p: any) => p.preset_id)
    expect(ids).toEqual([...ids].sort())
  })

  it('looks records up by id and returns null for unknown ids', () => {
    const first: any = getPresets()[0]
    expect(getPreset(first.preset_id)).toEqual(first)
    expect(getPreset('no-such-preset')).toBeNull()
  })

  it('exposes every collection', () => {
    expect(getCombinedCases().length).toBeGreaterThan(0)
    expect(getScenarioDefs().length).toBeGreaterThan(0)
    expect(getRoutePresetDocs().length).toBeGreaterThan(0)
    expect(getPackageManifests().length).toBeGreaterThan(0)
    expect(getMatrix()).toBeTruthy()
    expect(getDatasetIds().length).toBeGreaterThan(0)
    expect(getDataset(getDatasetIds()[0])).toBeTruthy()
    expect(getDataset('nope')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- registry`
Expected: FAIL — cannot resolve `../src/data/registry`.

- [ ] **Step 3: Write the registry**

Create `htmlapp/frontend/src/data/registry.ts`:

```ts
/**
 * registry — the ONLY reader of the generated data payload.
 *
 * The payload is installed either by `public/aica-data.js` (a <script> tag in
 * index.html, main thread) or by the `data.install` op (backend worker, whose
 * global scope a <script> tag cannot reach). Nothing else in the app touches
 * `globalThis.__AICA_DATA__`.
 *
 * Validation is fail-fast and exhaustive: every problem found is reported at
 * once, because a half-loaded registry surfaces later as a pile of unrelated
 * op failures that are far harder to diagnose than one honest boot error.
 */
import type { PackageManifest, ScenarioDef } from '../api/types'
import type { RoutePreset } from './types'

export const SUPPORTED_SCHEMA_VERSION = 1

export type CombinedCaseDoc = { case_id: string; [k: string]: unknown }
export type PresetDoc = { preset_id: string; [k: string]: unknown }
export type ProfileDoc = { profile_id: string; [k: string]: unknown }
export type SeedDoc = { seed_id: string; [k: string]: unknown }
export type DatasetEntry = {
  manifest: { dataset_id: string; [k: string]: unknown }
  catalog: unknown
  genreAffinity: unknown | null
}

export type AicaDataPayload = {
  schema_version: number
  combinedCases: Record<string, CombinedCaseDoc>
  presets: Record<string, PresetDoc>
  profiles: Record<string, ProfileDoc>
  seeds: Record<string, SeedDoc>
  scenarios: Record<string, ScenarioDef>
  routePresets: Record<string, RoutePreset>
  packageManifests: Record<string, PackageManifest>
  matrix: unknown
  dispositions: unknown
  serviceCapabilities: unknown
  datasets: Record<string, DatasetEntry>
}

export class DataRegistryError extends Error {
  readonly problems: string[]
  constructor(problems: string[]) {
    super(`simulator data could not be loaded:\n  - ${problems.join('\n  - ')}`)
    this.name = 'DataRegistryError'
    this.problems = problems
  }
}

/** id-keyed collections: payload key -> the id field each record must carry. */
const ID_KEYED: ReadonlyArray<readonly [keyof AicaDataPayload, string]> = [
  ['combinedCases', 'case_id'],
  ['presets', 'preset_id'],
  ['profiles', 'profile_id'],
  ['seeds', 'seed_id'],
  ['scenarios', 'id'],
  ['routePresets', 'id'],
  ['packageManifests', 'id'],
]

const SINGLETONS: ReadonlyArray<keyof AicaDataPayload> = [
  'matrix',
  'dispositions',
  'serviceCapabilities',
]

let installed: AicaDataPayload | null = null

function validate(raw: unknown): string[] {
  const problems: string[] = []
  if (raw === null || typeof raw !== 'object') {
    return ['payload is not an object']
  }
  const p = raw as Record<string, unknown>

  if (p.schema_version !== SUPPORTED_SCHEMA_VERSION) {
    problems.push(
      `schema_version is ${String(p.schema_version)}, this build supports ${SUPPORTED_SCHEMA_VERSION} — regenerate with 'npm run build:data'`,
    )
  }

  for (const [key, idField] of ID_KEYED) {
    const coll = p[key as string]
    if (coll === null || typeof coll !== 'object') {
      problems.push(`${String(key)}: missing or not an object`)
      continue
    }
    const entries = Object.entries(coll as Record<string, unknown>)
    if (entries.length === 0) {
      problems.push(`${String(key)}: is empty`)
      continue
    }
    for (const [id, doc] of entries) {
      if (doc === null || typeof doc !== 'object') {
        problems.push(`${String(key)}.${id}: not an object`)
        continue
      }
      const actual = (doc as Record<string, unknown>)[idField]
      if (actual !== id) {
        problems.push(`${String(key)}.${id}: '${idField}' is ${JSON.stringify(actual)}, expected ${JSON.stringify(id)}`)
      }
    }
  }

  for (const key of SINGLETONS) {
    const v = p[key as string]
    if (v === null || typeof v !== 'object') problems.push(`${String(key)}: missing or not an object`)
  }

  const datasets = p.datasets
  if (datasets === null || typeof datasets !== 'object') {
    problems.push('datasets: missing or not an object')
  } else {
    const entries = Object.entries(datasets as Record<string, unknown>)
    if (entries.length === 0) problems.push('datasets: is empty')
    for (const [id, entry] of entries) {
      const e = entry as Partial<DatasetEntry>
      if (!e || typeof e !== 'object') { problems.push(`datasets.${id}: not an object`); continue }
      if (!e.manifest || e.manifest.dataset_id !== id) {
        problems.push(`datasets.${id}: manifest.dataset_id does not match its key`)
      }
      if (e.catalog === undefined || e.catalog === null) problems.push(`datasets.${id}: missing catalog`)
    }
  }

  return problems
}

/** Validate and memoize `payload`. Throws DataRegistryError listing every problem. */
export function installRegistry(payload: unknown): void {
  const problems = validate(payload)
  if (problems.length) throw new DataRegistryError(problems)
  installed = payload as AicaDataPayload
}

/** Install from `globalThis.__AICA_DATA__` on first call, then memoize. */
export function ensureRegistry(): AicaDataPayload {
  if (installed) return installed
  const raw = (globalThis as Record<string, unknown>).__AICA_DATA__
  if (raw === undefined) {
    throw new DataRegistryError([
      "aica-data.js did not load — the <script src='./aica-data.js'> tag is missing, or the file was not generated (run 'npm run build:data')",
    ])
  }
  installRegistry(raw)
  // `return installed as AicaDataPayload` does NOT compile: the `if (installed)
  // return installed` guard above narrows `installed` to `null` for the rest of
  // the function, and tsc cannot see that installRegistry reassigns it (TS2352).
  // req() re-reads the module variable through a call, which defeats the
  // narrowing and keeps the null check.
  return req()
}

export function resetRegistryForTests(): void {
  installed = null
}

function req(): AicaDataPayload {
  if (!installed) {
    throw new DataRegistryError(['registry not installed — call ensureRegistry() during boot'])
  }
  return installed
}

const values = <T,>(rec: Record<string, T>): T[] => Object.keys(rec).sort().map((k) => rec[k])
const one = <T,>(rec: Record<string, T>, id: string): T | null =>
  Object.prototype.hasOwnProperty.call(rec, id) ? rec[id] : null

export const getCombinedCases = (): CombinedCaseDoc[] => values(req().combinedCases)
export const getCombinedCase = (id: string): CombinedCaseDoc | null => one(req().combinedCases, id)
export const getPresets = (): PresetDoc[] => values(req().presets)
export const getPreset = (id: string): PresetDoc | null => one(req().presets, id)
export const getProfiles = (): ProfileDoc[] => values(req().profiles)
export const getProfile = (id: string): ProfileDoc | null => one(req().profiles, id)
export const getSeeds = (): SeedDoc[] => values(req().seeds)
export const getSeed = (id: string): SeedDoc | null => one(req().seeds, id)
export const getScenarioDefs = (): ScenarioDef[] => values(req().scenarios)
export const getScenarioDef = (id: string): ScenarioDef | null => one(req().scenarios, id)
export const getRoutePresetDocs = (): RoutePreset[] => values(req().routePresets)
export const getRoutePresetDoc = (id: string): RoutePreset | null => one(req().routePresets, id)
export const getPackageManifests = (): PackageManifest[] => values(req().packageManifests)
export const getPackageManifest = (id: string): PackageManifest | null => one(req().packageManifests, id)
export const getMatrix = (): unknown => req().matrix
export const getDispositions = (): unknown => req().dispositions
export const getServiceCapabilities = (): unknown => req().serviceCapabilities
export const getDatasetIds = (): string[] => Object.keys(req().datasets).sort()
export const getDataset = (id: string): DatasetEntry | null => one(req().datasets, id)
```

- [ ] **Step 4: Create the shared data types module**

`registry.ts` imports `RoutePreset` from `./types`. Create `htmlapp/frontend/src/data/types.ts` by moving the type declarations out of `src/data/routes/index.ts` and `src/data/packages/index.ts` verbatim (they are code, not data, and Task 5 deletes those index modules):

```ts
/**
 * Shapes for records that arrive from the generated data payload.
 *
 * These live here rather than in `api/types.ts` because `api/types.ts` is
 * synced from app/frontend and must stay a faithful copy; these shapes mirror
 * on-disk JSON that has no counterpart there (the same reason
 * `engine/services/route_analysis.ts` declares its own RawRoute/RawPlace).
 */
import type { PackageManifest } from '../api/types'

export type RoutePresetRawSegment = {
  road_class: string
  maneuver?: string
  distance_m: number
}

export type RoutePresetRawRoute = {
  route_id: string
  summary?: string
  distance_m: number
  duration_s: number
  encoded_polyline?: string
  segments?: RoutePresetRawSegment[]
}

export type RoutePresetPlace = {
  name: string
  type?: string
  location: { lat: number; lng: number }
  distance_along_route_m: number
  synthetic?: boolean
}

export type RoutePreset = {
  id: string
  label: { ja: string; en: string }
  start: string
  end: string
  route_source: 'maps' | 'local'
  raw_route: RoutePresetRawRoute
  places: RoutePresetPlace[]
}

export type PackageRecord = {
  id: string
  manifest: PackageManifest
  origin: 'builtin' | 'user'
  /** declarative_rule | weighted_score | builtin_js_module | js_module */
  strategy: string
  source?: string
}
```

- [ ] **Step 5: Load the payload in the Vitest setup**

Replace `htmlapp/frontend/tests/setup.ts` with:

```ts
import '@testing-library/jest-dom'
import 'fake-indexeddb/auto'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// The data payload normally arrives via index.html's <script src="./aica-data.js">.
// Vitest has no index.html, so install it directly. `npm test` runs `pretest`
// (build:data) first; a bare `vitest run` on a clean tree would not.
const payloadPath = resolve(__dirname, '..', 'data', 'aica-data.json')
if (!existsSync(payloadPath)) {
  throw new Error(
    `missing ${payloadPath} — run 'npm run build:data' (or use 'npm test', which does it for you)`,
  )
}
;(globalThis as Record<string, unknown>).__AICA_DATA__ = JSON.parse(readFileSync(payloadPath, 'utf8'))
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- registry`
Expected: PASS, all cases.

- [ ] **Step 7: Commit**

```bash
git add htmlapp/frontend/src/data/registry.ts htmlapp/frontend/src/data/types.ts htmlapp/frontend/tests/registry.test.ts htmlapp/frontend/tests/setup.ts
git commit -m "feat(htmlapp): data registry with fail-fast shape validation"
```

---

### Task 4: Registry — referential integrity

Shape validation proves each record is well-formed. This proves they point at each other correctly — the failure mode that otherwise surfaces as a blank Combined screen.

**Files:**
- Modify: `htmlapp/frontend/src/data/registry.ts` (add `validateReferences`, call it from `validate`)
- Test: `htmlapp/frontend/tests/registry_references.test.ts`

**Interfaces:**
- Consumes: `installRegistry`, `DataRegistryError`, `AicaDataPayload` from Task 3.
- Produces: `validateReferences(p: AicaDataPayload): string[]` (exported for direct testing).

- [ ] **Step 1: Write the failing test**

Create `htmlapp/frontend/tests/registry_references.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  installRegistry,
  resetRegistryForTests,
  validateReferences,
  DataRegistryError,
  type AicaDataPayload,
} from '../src/data/registry'

const REAL: AicaDataPayload = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'data', 'aica-data.json'), 'utf8'),
)

const clone = (): AicaDataPayload => JSON.parse(JSON.stringify(REAL))

beforeEach(() => resetRegistryForTests())

describe('validateReferences', () => {
  it('passes on the real committed data', () => {
    expect(validateReferences(REAL)).toEqual([])
  })

  it('catches a case pointing at a missing profile preset', () => {
    const p = clone()
    const caseId = Object.keys(p.combinedCases)[0]
    ;(p.combinedCases[caseId] as any).persona.profile_ref = 'preset-does-not-exist'
    const problems = validateReferences(p)
    expect(problems.some((m) => m.includes('profile_ref') && m.includes('preset-does-not-exist'))).toBe(true)
  })

  it('catches a case pointing at a missing scenario', () => {
    const p = clone()
    const caseId = Object.keys(p.combinedCases)[0]
    ;(p.combinedCases[caseId] as any).journey.scenario_ref = 'no_such_scenario'
    expect(validateReferences(p).some((m) => m.includes('scenario_ref'))).toBe(true)
  })

  it('catches a case pointing at a missing route preset', () => {
    const p = clone()
    const caseId = Object.keys(p.combinedCases)[0]
    ;(p.combinedCases[caseId] as any).journey.route_preset_ref = 'no_such_route'
    expect(validateReferences(p).some((m) => m.includes('route_preset_ref'))).toBe(true)
  })

  it('catches a case naming an algorithm package that is not installed', () => {
    const p = clone()
    const caseId = Object.keys(p.combinedCases)[0]
    ;(p.combinedCases[caseId] as any).algorithm_defaults.trigger = 'ghost_package_v9'
    expect(validateReferences(p).some((m) => m.includes('ghost_package_v9'))).toBe(true)
  })

  it('reports every broken reference at once', () => {
    const p = clone()
    const ids = Object.keys(p.combinedCases)
    ;(p.combinedCases[ids[0]] as any).journey.scenario_ref = 'bad_a'
    ;(p.combinedCases[ids[1]] as any).journey.route_preset_ref = 'bad_b'
    const problems = validateReferences(p)
    expect(problems.some((m) => m.includes('bad_a'))).toBe(true)
    expect(problems.some((m) => m.includes('bad_b'))).toBe(true)
  })

  it('is enforced by installRegistry, not merely available', () => {
    const p = clone()
    const caseId = Object.keys(p.combinedCases)[0]
    ;(p.combinedCases[caseId] as any).journey.scenario_ref = 'no_such_scenario'
    expect(() => installRegistry(p)).toThrow(DataRegistryError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- registry_references`
Expected: FAIL — `validateReferences` is not exported from `../src/data/registry`.

- [ ] **Step 3: Implement referential validation**

In `htmlapp/frontend/src/data/registry.ts`, add this function immediately after `validate`:

```ts
/**
 * Cross-collection integrity. Separate from `validate` (which checks each
 * record in isolation) because these failures have a different cause: not a
 * malformed file, but two files that disagree. Reported together so one boot
 * error explains the whole problem.
 */
export function validateReferences(p: AicaDataPayload): string[] {
  const problems: string[] = []
  const has = (rec: Record<string, unknown>, id: unknown): boolean =>
    typeof id === 'string' && Object.prototype.hasOwnProperty.call(rec, id)

  for (const [caseId, doc] of Object.entries(p.combinedCases)) {
    const c = doc as Record<string, any>

    const profileRef = c.persona?.profile_ref
    if (!has(p.presets, profileRef)) {
      problems.push(`combinedCases.${caseId}: persona.profile_ref '${String(profileRef)}' is not a known preset`)
    }

    const scenarioRef = c.journey?.scenario_ref
    if (!has(p.scenarios, scenarioRef)) {
      problems.push(`combinedCases.${caseId}: journey.scenario_ref '${String(scenarioRef)}' is not a known scenario`)
    }

    const routeRef = c.journey?.route_preset_ref
    if (!has(p.routePresets, routeRef)) {
      problems.push(`combinedCases.${caseId}: journey.route_preset_ref '${String(routeRef)}' is not a known route preset`)
    }

    for (const slot of ['trigger', 'service', 'content'] as const) {
      const pkgId = c.algorithm_defaults?.[slot]
      if (!has(p.packageManifests, pkgId)) {
        problems.push(`combinedCases.${caseId}: algorithm_defaults.${slot} '${String(pkgId)}' is not an installed package`)
      }
    }
  }

  return problems
}
```

Then, in `installRegistry`, run it once the shape is known good — the reference pass assumes well-formed collections, so it must not run on a payload that failed shape validation:

```ts
export function installRegistry(payload: unknown): void {
  const problems = validate(payload)
  if (problems.length) throw new DataRegistryError(problems)
  const refProblems = validateReferences(payload as AicaDataPayload)
  if (refProblems.length) throw new DataRegistryError(refProblems)
  installed = payload as AicaDataPayload
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- registry`
Expected: PASS — both `registry.test.ts` and `registry_references.test.ts`.

If `validateReferences(REAL)` returns problems, that is a genuine defect in the committed data or a wrong field path — read the failing case JSON and fix the cause, do not weaken the check.

- [ ] **Step 5: Commit**

```bash
git add htmlapp/frontend/src/data/registry.ts htmlapp/frontend/tests/registry_references.test.ts
git commit -m "feat(htmlapp): registry validates cross-collection references at boot"
```

---

### Task 5: Repoint the data modules onto the registry

Deletes the hand-copied JSON — the drift this whole slice exists to remove — and turns the three `src/data` index modules into registry-backed accessors.

**Files:**
- Create: `htmlapp/frontend/src/data/builtinEvaluators.ts`
- Rewrite: `htmlapp/frontend/src/data/packages/index.ts`
- Rewrite: `htmlapp/frontend/src/data/routes/index.ts`
- Rewrite: `htmlapp/frontend/src/data/scenarios/index.ts`
- Delete: `htmlapp/frontend/src/data/packages/nri_fatigue_score_v1.json`, `htmlapp/frontend/src/data/packages/aica_transparent_hybrid_trigger_v1.json`, `htmlapp/frontend/src/data/routes/*.json`, `htmlapp/frontend/src/data/scenarios/*.json`
- Modify: `htmlapp/frontend/src/storage/db.ts:3-4,53,57`
- Modify: `htmlapp/frontend/src/storage/packages_store.ts:2`
- Modify: `htmlapp/frontend/src/engine/services/portability.ts:53`
- Modify: `htmlapp/frontend/src/engine/algorithms/adapter.ts:22`
- Modify: `htmlapp/frontend/src/engine/worker/handlers/routes.ts:3,46,59`

**Interfaces:**
- Consumes: `getPackageManifests`, `getScenarioDefs`, `getRoutePresetDocs` from Task 3; `PackageRecord`, `RoutePreset` from `src/data/types.ts`.
- Produces:
  - `src/data/builtinEvaluators.ts` exports `BuiltinPyContext`, `BuiltinEvaluateFn`, `BUILTIN_EVALUATORS` (unchanged shapes, moved).
  - `src/data/packages/index.ts` exports `builtinPackages(): PackageRecord[]` and re-exports `PackageRecord` plus the three evaluator symbols.
  - `src/data/routes/index.ts` exports `routePresets(): RoutePreset[]` and re-exports the `RoutePreset*` types.
  - `src/data/scenarios/index.ts` exports `builtinScenarios(): ScenarioDef[]`.

The `DEFAULT_*` **constants become functions**, because the registry is not installed at module-evaluation time. Every call site changes from `DEFAULT_PACKAGES` to `builtinPackages()`.

- [ ] **Step 1: Write the failing test**

Replace `htmlapp/frontend/tests/data.test.ts` with:

```ts
import { describe, it, expect } from 'vitest'
import { ensureRegistry } from '../src/data/registry'
import { builtinScenarios } from '../src/data/scenarios'
import { builtinPackages } from '../src/data/packages'
import { routePresets } from '../src/data/routes'
import { BUILTIN_EVALUATORS } from '../src/data/builtinEvaluators'

// tests/setup.ts installs globalThis.__AICA_DATA__ from the generated payload.
ensureRegistry()

describe('registry-backed defaults', () => {
  it('loads scenarios from the registry', () => {
    const ids = builtinScenarios().map((s) => s.id)
    expect(ids.length).toBeGreaterThan(0)
    expect(ids).toContain('uc01_fatigue_recovery_v0_1')
  })

  it('loads packages from the registry, all tagged builtin', () => {
    const pkgs = builtinPackages()
    expect(pkgs.length).toBeGreaterThan(0)
    expect(pkgs.every((p) => p.origin === 'builtin')).toBe(true)
  })

  it('remaps python_module manifests onto the builtin_js_module strategy', () => {
    const nri = builtinPackages().find((p) => p.id === 'nri_fatigue_score_v1')
    expect(nri).toBeDefined()
    expect(nri!.strategy).toBe('builtin_js_module')
  })

  it('loads route presets from the registry', () => {
    const ids = routePresets().map((r) => r.id).sort()
    expect(ids.length).toBeGreaterThan(0)
    expect(ids).toContain('long_tokyo_osaka')
  })

  it('keeps evaluators in SOURCE, keyed by package id', () => {
    expect(typeof BUILTIN_EVALUATORS.nri_fatigue_score_v1).toBe('function')
    expect(typeof BUILTIN_EVALUATORS.aica_transparent_hybrid_trigger_v1).toBe('function')
  })

  it('exposes an evaluator for every builtin_js_module package it ships', () => {
    // A manifest without a TS port would fail at run time inside adapter.ts;
    // catching it here names the missing port instead.
    for (const pkg of builtinPackages()) {
      if (pkg.strategy !== 'builtin_js_module') continue
      expect(BUILTIN_EVALUATORS[pkg.id], `no TS evaluator for ${pkg.id}`).toBeDefined()
    }
  })
})
```

Note: the last case is expected to **fail** until C1 ports the service and content selectors, because `packages/` ships six manifests and only two have TS ports. Implement it as written, watch it fail, then narrow it in Step 3 with an explicit allowlist that C1 deletes.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- data`
Expected: FAIL — cannot resolve `builtinScenarios` / `builtinPackages` / `routePresets` / `../src/data/builtinEvaluators`.

- [ ] **Step 3: Move the evaluator registry into its own module**

Create `htmlapp/frontend/src/data/builtinEvaluators.ts`. Move the `BuiltinPyContext`, `BuiltinEvaluateFn` and `BUILTIN_EVALUATORS` declarations out of the current `src/data/packages/index.ts` **verbatim**, keeping their docblocks, and fix the two import paths (`../../api/types` → `../api/types`, `./builtin/…` → `./packages/builtin/…`):

```ts
/**
 * builtin_js_module evaluate registry — the dispatch seam consulted by
 * `../engine/algorithms/adapter.ts` for any package whose
 * `manifest.algorithm.type` is `'python_module'` (the bundled manifests'
 * declared type, unchanged from the docker app's JSON) or
 * `'builtin_js_module'`. Keyed by package id — mirrors how Python's
 * `python_module.load_evaluate` resolves a package's `evaluate` by id.
 *
 * This is SOURCE, not data: manifests and parameters come from the generated
 * data payload, but the executable port lives in `./packages/builtin/*.ts`.
 */
import type { DecisionResult } from '../api/types'
import { evaluate as nriEvaluate } from './packages/builtin/nri_fatigue_score_v1'
import { evaluate as hybridEvaluate } from './packages/builtin/aica_transparent_hybrid_trigger_v1'

/**
 * Mirrors python_module.dispatch()'s `py_context` dict (feature 009 tiered
 * shape) — the input every builtin_js_module evaluate fn receives. The flat
 * `raw_state` is retired in favor of `signals` ({fixed, dynamic, simulated}),
 * plus the top-level `recovery_active` flag.
 */
export type BuiltinPyContext = {
  simulation_time_sec: number
  signals: Record<string, unknown>
  feature_groups: Record<string, unknown>
  parameters: Record<string, unknown>
  hyperparameters: Record<string, unknown>
  proposal_history: Record<string, unknown>
  user_action_history: unknown[]
  package_runtime_state: Record<string, unknown>
  recovery_active: boolean
}

export type BuiltinEvaluateFn = (input: BuiltinPyContext) => DecisionResult

export const BUILTIN_EVALUATORS: Record<string, BuiltinEvaluateFn> = {
  nri_fatigue_score_v1: nriEvaluate,
  aica_transparent_hybrid_trigger_v1: hybridEvaluate,
}

/**
 * Packages whose manifests ship in the data payload but whose TS ports do not
 * exist yet. C1 adds `aica_transparent_service_selector_v1` and
 * `aica_transparent_content_selector_v1` and deletes those two entries; the
 * mock packages are UI-hidden and never dispatched.
 */
export const UNPORTED_BUILTINS: ReadonlySet<string> = new Set([
  'aica_transparent_service_selector_v1',
  'aica_transparent_content_selector_v1',
  'mock_service_selector_v1',
  'mock_content_selector_v1',
])
```

Then narrow the last test case in `tests/data.test.ts` to respect the allowlist:

```ts
  it('exposes an evaluator for every ported builtin_js_module package', () => {
    for (const pkg of builtinPackages()) {
      if (pkg.strategy !== 'builtin_js_module') continue
      if (UNPORTED_BUILTINS.has(pkg.id)) continue
      expect(BUILTIN_EVALUATORS[pkg.id], `no TS evaluator for ${pkg.id}`).toBeDefined()
    }
  })
```

and add `UNPORTED_BUILTINS` to that file's import from `../src/data/builtinEvaluators`.

- [ ] **Step 4: Rewrite the three index modules**

`htmlapp/frontend/src/data/packages/index.ts`:

```ts
/**
 * Builtin package records, derived from the generated data payload.
 *
 * A function rather than a const: the registry is installed during boot (or by
 * the `data.install` op in the worker), which happens after module evaluation.
 */
import { getPackageManifests } from '../registry'
import type { PackageRecord } from '../types'

export type { PackageRecord } from '../types'
export {
  BUILTIN_EVALUATORS,
  UNPORTED_BUILTINS,
  type BuiltinEvaluateFn,
  type BuiltinPyContext,
} from '../builtinEvaluators'

function record(manifest: any): PackageRecord {
  const declared = manifest.algorithm?.type as string
  // python_module built-ins are served by the TS ports in ../builtinEvaluators.
  const strategy = declared === 'python_module' ? 'builtin_js_module' : declared
  return { id: manifest.id, manifest, origin: 'builtin', strategy }
}

export function builtinPackages(): PackageRecord[] {
  return getPackageManifests().map(record)
}
```

`htmlapp/frontend/src/data/routes/index.ts`:

```ts
/**
 * Route presets, derived from the generated data payload — the offline
 * replacement for `routes/presets/*.json` served by
 * `app/api/aica_api/routers/route_presets.py`.
 */
import { getRoutePresetDocs } from '../registry'
import type { RoutePreset } from '../types'

export type {
  RoutePreset,
  RoutePresetPlace,
  RoutePresetRawRoute,
  RoutePresetRawSegment,
} from '../types'

export function routePresets(): RoutePreset[] {
  return getRoutePresetDocs()
}
```

`htmlapp/frontend/src/data/scenarios/index.ts`:

```ts
/** Builtin scenarios, derived from the generated data payload. */
import { getScenarioDefs } from '../registry'
import type { ScenarioDef } from '../../api/types'

export function builtinScenarios(): ScenarioDef[] {
  return getScenarioDefs()
}
```

- [ ] **Step 5: Delete the hand-copied JSON**

```bash
cd htmlapp/frontend
git rm src/data/packages/nri_fatigue_score_v1.json \
       src/data/packages/aica_transparent_hybrid_trigger_v1.json \
       src/data/routes/long_tokyo_osaka.json \
       src/data/routes/middle_tokyo_karuizawa.json \
       src/data/routes/short_tokyo_chichibu.json \
       src/data/scenarios/uc01_fatigue_recovery_v0_1.json
```

`src/data/packages/builtin/*.ts` stays — it is source.

- [ ] **Step 6: Update the five consumers**

In `src/storage/db.ts`, change the imports on lines 3–4 and the two loops in `seedDefaults`:

```ts
import { builtinPackages } from '../data/packages'
import type { PackageRecord } from '../data/types'
import { builtinScenarios } from '../data/scenarios'
```

```ts
  for (const rec of builtinPackages()) {
```

```ts
  for (const def of builtinScenarios()) {
```

In `src/storage/packages_store.ts` line 2:

```ts
import type { PackageRecord } from '../data/types'
```

In `src/engine/services/portability.ts` line 53:

```ts
import type { PackageRecord } from '../../data/types'
```

In `src/engine/algorithms/adapter.ts` line 22:

```ts
import { BUILTIN_EVALUATORS, type BuiltinEvaluateFn, type BuiltinPyContext } from '../../data/builtinEvaluators'
```

In `src/engine/worker/handlers/routes.ts`, line 3 and the two use sites:

```ts
import { routePresets } from '../../../data/routes'
```

```ts
  const presets: RoutePresetSummary[] = routePresets().map((preset) => ({
```

```ts
  const preset = routePresets().find((p) => p.id === params.presetId)
```

- [ ] **Step 7: Update `tests/route_presets.test.ts`**

Change its import and the two references:

```ts
import { routePresets } from '../src/data/routes'
```

```ts
    expect(routePresets().length).toBeGreaterThan(0)
    const ids = routePresets().map((p) => p.id).sort()
```

The old assertion was `toBe(3)`. Relax it: an exact count over registry-backed
data would make *adding a route preset* a code change, which is precisely what
this slice exists to prevent. Keep whatever `toContain('long_tokyo_osaka')`-style
id assertions the file already has — those encode real coupling.

- [ ] **Step 8: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS. `tests/data.test.ts`, `tests/route_presets.test.ts`, `tests/client_run_loop.test.ts`, `tests/nri_port.test.ts` and `tests/hybrid_port.test.ts` all go green — the latter three only reference `BUILTIN_EVALUATORS` and the `builtin/*.ts` ports, which did not move in a way that changes their imports.

If any test fails on a missing registry, it constructs the engine before `tests/setup.ts` runs — add an explicit `ensureRegistry()` at the top of that file, as `tests/data.test.ts` does.

- [ ] **Step 9: Commit**

```bash
git add -A htmlapp/frontend/src/data htmlapp/frontend/src/storage htmlapp/frontend/src/engine htmlapp/frontend/tests
git commit -m "refactor(htmlapp): read scenarios, packages and route presets from the data registry"
```

---

### Task 6: Worker data handshake

The backend worker is a separate global scope. `index.html`'s `<script>` tag does not reach it, so without this task every op the worker serves loses its data.

**Files:**
- Modify: `htmlapp/frontend/src/api/rpc.ts` (add the op to the `RpcOp` union)
- Modify: `htmlapp/frontend/src/engine/worker/router.ts` (register the handler)
- Create: `htmlapp/frontend/src/engine/worker/handlers/data.ts`
- Modify: `htmlapp/frontend/src/engine/worker/backend.worker.ts`
- Modify: `htmlapp/frontend/src/api/transport.ts`
- Test: `htmlapp/frontend/tests/worker_data_install.test.ts`

**Interfaces:**
- Consumes: `installRegistry`, `ensureRegistry` from Task 3; `Transport`, `WorkerTransport`, `createTransport` from the existing `api/transport.ts`; `dispatch` from `engine/worker/dispatch.ts`.
- Produces: RpcOp `'data.install'` with `params: { payload: AicaDataPayload }` and result `{ installed: true }`. **htmlapp-only, like `packages.addUser`** — it has no Python counterpart and is exempt from contract parity.

- [ ] **Step 1: Write the failing test**

Create `htmlapp/frontend/tests/worker_data_install.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { dispatch } from '../src/engine/worker/dispatch'
import { resetRegistryForTests, getPresets, DataRegistryError } from '../src/data/registry'

const REAL = JSON.parse(readFileSync(resolve(__dirname, '..', 'data', 'aica-data.json'), 'utf8'))

beforeEach(() => resetRegistryForTests())

describe('data.install op', () => {
  it('installs the payload into the dispatching scope', async () => {
    expect(() => getPresets()).toThrow(DataRegistryError)
    const res = await dispatch({ op: 'data.install', params: { payload: REAL } })
    expect(res.ok).toBe(true)
    expect(getPresets().length).toBeGreaterThan(0)
  })

  it('returns a structured error for an invalid payload rather than throwing', async () => {
    const res = await dispatch({ op: 'data.install', params: { payload: { schema_version: 99 } } })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.type).toBe('DataRegistryError')
  })

  it('is idempotent', async () => {
    await dispatch({ op: 'data.install', params: { payload: REAL } })
    const again = await dispatch({ op: 'data.install', params: { payload: REAL } })
    expect(again.ok).toBe(true)
  })
})

describe('WorkerTransport handshake', () => {
  it('sends data.install before any queued call', async () => {
    const posted: any[] = []
    class FakeWorker {
      onmessage: ((ev: MessageEvent) => void) | null = null
      onerror: ((ev: ErrorEvent) => void) | null = null
      postMessage(msg: any) {
        posted.push(msg)
        // Echo an ok response so pending promises settle.
        queueMicrotask(() =>
          this.onmessage?.({ data: { id: msg.id, response: { ok: true, result: {} } } } as MessageEvent),
        )
      }
      terminate() {}
    }
    const { WorkerTransport } = await import('../src/api/transport')
    const w = new FakeWorker()
    const t = new WorkerTransport(w as unknown as Worker, REAL)
    await t.call({ op: 'health.get', params: {} })
    expect(posted[0].req.op).toBe('data.install')
    expect(posted[1].req.op).toBe('health.get')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- worker_data_install`
Expected: FAIL — `'data.install'` is not assignable to `RpcOp`, and `WorkerTransport`'s constructor takes one argument.

- [ ] **Step 3: Add the op to the contract**

In `htmlapp/frontend/src/api/rpc.ts`, add `'data.install'` to the `RpcOp` union, with a comment marking it htmlapp-only next to the existing `packages.addUser` note:

```ts
  // htmlapp-only: no Python counterpart, exempt from contract parity.
  | 'packages.addUser'
  | 'data.install'
```

- [ ] **Step 4: Write the handler**

Create `htmlapp/frontend/src/engine/worker/handlers/data.ts`:

```ts
/**
 * data.install — seed the generated data payload into THIS scope's registry.
 *
 * The worker is a separate global scope, so index.html's
 * <script src="./aica-data.js"> never reaches it. WorkerTransport posts this op
 * before any other call. In-process (file://) it is a harmless re-install:
 * boot already installed the same payload on the main thread.
 */
import { installRegistry, DataRegistryError } from '../../../data/registry'

// async, not sync: the router's handler map is typed to return Promise<unknown>,
// and a synchronous return does not satisfy it under tsc.
export async function installData(params: { payload: unknown }): Promise<{ installed: true }> {
  try {
    installRegistry(params.payload)
  } catch (e) {
    if (e instanceof DataRegistryError) throw e
    throw new DataRegistryError([String(e)])
  }
  return { installed: true }
}
```

- [ ] **Step 5: Register it in the router**

In `htmlapp/frontend/src/engine/worker/router.ts`, import `installData` from `./handlers/data` and add the entry to the handler map, following the file's existing entry style:

```ts
  'data.install': (params) => installData(params as { payload: unknown }),
```

Confirm `dispatch.ts` maps a thrown `DataRegistryError` to `{ ok: false, error: { type: 'DataRegistryError', message } }`. If it maps errors by a fixed type string, extend it to use `e.name` so the test's `error.type` assertion holds.

**Chicken-and-egg in `dispatch.ts` — this bit the implementation.** `dispatch()`
awaits an IndexedDB seed step before invoking any handler, and that seed reads the
data registry. So the very first `data.install` throws before it can install
anything. `data.install` must therefore **bypass the seed gate**: it is the one op
that must run with an empty registry. Every other op still seeds first, so no hole
opens — but verify that explicitly rather than assuming it.

- [ ] **Step 6: Serialize the worker entry behind the handshake**

Replace `htmlapp/frontend/src/engine/worker/backend.worker.ts` with:

```ts
/// <reference lib="webworker" />
import type { RpcRequest, RpcResponse } from '../../api/rpc'
import { dispatch } from './dispatch'

// Every op except data.install needs the data registry, and dispatch is async —
// without this gate a second message could interleave past an await and run
// against an empty registry. Resolved by the data.install message.
let markReady: () => void
const ready = new Promise<void>((resolve) => { markReady = resolve })

self.onmessage = async (ev: MessageEvent) => {
  const { id, req } = ev.data as { id: number; req: RpcRequest }
  let response: RpcResponse
  try {
    if (req.op !== 'data.install') await ready
    response = await dispatch(req)
    if (req.op === 'data.install' && response.ok) markReady()
  } catch (e) {
    response = { ok: false, error: { type: 'DispatchError', message: String(e) } }
  }
  ;(self as unknown as Worker).postMessage({ id, response })
}
```

- [ ] **Step 7: Send the payload from the transport**

In `htmlapp/frontend/src/api/transport.ts`, give `WorkerTransport` a second constructor parameter and post the handshake before anything else:

```ts
  constructor(worker: Worker, payload: unknown) {
    this.worker = worker
    this.worker.onmessage = (ev: MessageEvent) => { /* unchanged */ }
    this.worker.onerror = (ev: ErrorEvent) => { /* unchanged */ }
    // Must be the FIRST postMessage: the worker gates every other op on it.
    void this.call({ op: 'data.install', params: { payload } })
  }
```

and in `createTransport()`, install the registry on the main thread first, then hand the same payload to the worker:

```ts
export function createTransport(): Transport {
  // Main-thread install: also the source of the payload the worker receives,
  // and the only install that happens in file:// fallback mode.
  const payload = ensureRegistry()
  try {
    if (typeof Worker === 'undefined') throw new Error('no Worker')
    if (import.meta.env?.MODE === 'test') throw new Error('test environment — using in-process')
    const worker = new Worker(new URL('../engine/worker/backend.worker.ts', import.meta.url), { type: 'module' })
    return new WorkerTransport(worker, payload)
  } catch (e) {
    console.info('[htmlapp] backend worker unavailable; running engine in-process.', e)
    return new InProcessTransport()
  }
}
```

Add `import { ensureRegistry } from '../data/registry'` at the top.

Note the module-scope `export const transport = createTransport()` now calls `ensureRegistry()` at import time. That is intentional — a missing payload must fail at boot — and Task 7 puts the readable error screen around it.

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test && npm run typecheck`
Expected: PASS, whole suite.

- [ ] **Step 9: Commit**

```bash
git add htmlapp/frontend/src/api/rpc.ts htmlapp/frontend/src/api/transport.ts htmlapp/frontend/src/engine/worker htmlapp/frontend/tests/worker_data_install.test.ts
git commit -m "feat(htmlapp): install the data payload into the worker scope via a data.install handshake"
```

---

### Task 7: Boot wiring and the data error screen

**Files:**
- Modify: `htmlapp/frontend/index.html`
- Modify: `htmlapp/frontend/src/main.tsx`
- Create: `htmlapp/frontend/src/components/layout/DataErrorScreen.tsx`
- Test: `htmlapp/frontend/tests/data_error_screen.test.tsx`

**Interfaces:**
- Consumes: `DataRegistryError`, `ensureRegistry` from Task 3.
- Produces: `DataErrorScreen({ error }: { error: DataRegistryError })` — a default-exported React component.

- [ ] **Step 1: Write the failing test**

Create `htmlapp/frontend/tests/data_error_screen.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import DataErrorScreen from '../src/components/layout/DataErrorScreen'
import { DataRegistryError } from '../src/data/registry'

describe('DataErrorScreen', () => {
  it('lists every problem, not just the first', () => {
    const err = new DataRegistryError(['presets: is empty', 'scenarios: missing or not an object'])
    render(<DataErrorScreen error={err} />)
    expect(screen.getByText(/presets: is empty/)).toBeInTheDocument()
    expect(screen.getByText(/scenarios: missing or not an object/)).toBeInTheDocument()
  })

  it('tells the reader how to regenerate the data', () => {
    render(<DataErrorScreen error={new DataRegistryError(['presets: is empty'])} />)
    expect(screen.getByText(/npm run build:data/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- data_error_screen`
Expected: FAIL — cannot resolve `../src/components/layout/DataErrorScreen`.

- [ ] **Step 3: Write the component**

Create `htmlapp/frontend/src/components/layout/DataErrorScreen.tsx`:

```tsx
/**
 * Shown when the generated data payload is missing or invalid.
 *
 * Deliberately styled inline and importing nothing but React: a data failure
 * may precede the stylesheet, and this screen must never itself fail to render.
 */
import type { DataRegistryError } from '../../data/registry'

export default function DataErrorScreen({ error }: { error: DataRegistryError }) {
  return (
    <div style={{ padding: 24, fontFamily: 'monospace', color: '#e6e6f0', background: '#0f0f1e', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 18, marginBottom: 12 }}>Simulator data could not be loaded</h1>
      <ul style={{ marginBottom: 16, paddingLeft: 20 }}>
        {error.problems.map((p, i) => (
          <li key={i} style={{ marginBottom: 4 }}>{p}</li>
        ))}
      </ul>
      <p style={{ opacity: 0.75 }}>
        Regenerate the data bundle with <code>npm run build:data</code>, then reload.
      </p>
    </div>
  )
}
```

- [ ] **Step 4: Load the bundle from index.html**

In `htmlapp/frontend/index.html`, add the data script **before** the app module:

```html
  <body>
    <div id="root"></div>
    <!-- Generated by `npm run build:data`. A classic <script> rather than a
         fetch() of data/: Chrome blocks fetch() at file://, and double-click
         delivery must keep working. Must precede the app module. -->
    <script src="./aica-data.js"></script>
    <script type="module" src="/src/main.tsx"></script>
  </body>
```

- [ ] **Step 5: Guard the boot in main.tsx**

Replace `htmlapp/frontend/src/main.tsx` with:

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
// Global 3-panel layout shell (grid columns, panel backgrounds, scrollbars).
// Without this import the .app-shell grid never applies and the panels stack.
import './styles/app.css'
import { ensureRegistry, DataRegistryError } from './data/registry'
import DataErrorScreen from './components/layout/DataErrorScreen'

const root = ReactDOM.createRoot(document.getElementById('root')!)

// The registry must be installed before ANY module that reaches the engine is
// imported — `api/transport.ts` calls ensureRegistry() at module scope — so App
// is imported lazily, after this check.
try {
  ensureRegistry()
  const { default: App } = await import('./App')
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
} catch (e) {
  const err = e instanceof DataRegistryError ? e : new DataRegistryError([String(e)])
  root.render(<DataErrorScreen error={err} />)
}
```

Top-level `await` requires an ES module target; `build.target` is already `es2020` and Vite serves `main.tsx` as a module, so this is supported. If the build rejects it, wrap the body in an `async function boot() { … } void boot()` instead.

- [ ] **Step 6: Run tests and a real build**

Run: `npm test && npm run build`
Expected: tests PASS; the build emits `dist/aica-data.js` alongside `dist/index.html` and `dist/assets/*`.

Verify the tag survived: `grep -c 'aica-data.js' dist/index.html` → `1`.

- [ ] **Step 7: Commit**

```bash
git add htmlapp/frontend/index.html htmlapp/frontend/src/main.tsx htmlapp/frontend/src/components/layout/DataErrorScreen.tsx htmlapp/frontend/tests/data_error_screen.test.tsx
git commit -m "feat(htmlapp): load the data bundle at boot with a fail-fast error screen"
```

---

### Task 8: Single-file inlining and split size budgets

`public/` assets are copied verbatim and are not bundled, so `vite-plugin-singlefile` will not inline `aica-data.js`. Without this task `build:singlefile` silently stops producing a single file.

**Files:**
- Create: `htmlapp/frontend/scripts/inline-data.mjs`
- Modify: `htmlapp/frontend/scripts/check-size.mjs`
- Modify: `htmlapp/frontend/package.json` (`build:singlefile`)
- Test: `htmlapp/frontend/tests/inline_data.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks at run time; operates on `dist/`.
- Produces: `inline-data.mjs` exports `inlineDataScript(html: string, js: string): string`. `check-size.mjs` gains `sumDir` reuse plus separate `APP_MAX`/`DATA_MAX` budgets.

- [ ] **Step 1: Write the failing test**

Create `htmlapp/frontend/tests/inline_data.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { inlineDataScript } from '../scripts/inline-data.mjs'

const HTML = `<!doctype html><html><body><div id="root"></div><script src="./aica-data.js"></script><script type="module">1</script></body></html>`

describe('inlineDataScript', () => {
  it('replaces the external tag with an inline one', () => {
    const out = inlineDataScript(HTML, 'window.__AICA_DATA__ = Object.freeze({})\n')
    expect(out).not.toContain('src="./aica-data.js"')
    expect(out).toContain('window.__AICA_DATA__')
  })

  it('keeps the data script before the app module', () => {
    const out = inlineDataScript(HTML, 'window.__AICA_DATA__ = 1')
    expect(out.indexOf('__AICA_DATA__')).toBeLessThan(out.indexOf('type="module"'))
  })

  it('throws when the tag is absent, rather than silently shipping a broken build', () => {
    expect(() => inlineDataScript('<html><body></body></html>', 'x')).toThrow(/aica-data\.js/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- inline_data`
Expected: FAIL — cannot resolve `../scripts/inline-data.mjs`.

- [ ] **Step 3: Write the inliner**

Create `htmlapp/frontend/scripts/inline-data.mjs`:

```js
#!/usr/bin/env node
/**
 * inline-data — fold dist/aica-data.js into dist/index.html.
 *
 * Only for the single-file target. public/ assets are copied verbatim and are
 * never bundled, so vite-plugin-singlefile leaves the external <script src>
 * alone; without this step `build:singlefile` quietly emits two files.
 */
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const TAG = /<script src="\.\/aica-data\.js"><\/script>/

export function inlineDataScript(html, js) {
  if (!TAG.test(html)) {
    throw new Error('index.html has no <script src="./aica-data.js"> tag to inline')
  }
  // The payload is already </script>-escaped by build-data.mjs.
  return html.replace(TAG, `<script>${js}</script>`)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
  const htmlPath = join(dist, 'index.html')
  const jsPath = join(dist, 'aica-data.js')
  if (!existsSync(jsPath)) {
    console.error(`✗ ${jsPath} not found — run build:data before the vite build`)
    process.exit(1)
  }
  writeFileSync(htmlPath, inlineDataScript(readFileSync(htmlPath, 'utf8'), readFileSync(jsPath, 'utf8')), 'utf8')
  rmSync(jsPath)
  console.log('✓ inlined aica-data.js into dist/index.html')
}
```

- [ ] **Step 4: Split the size budgets**

Replace the reporting half of `htmlapp/frontend/scripts/check-size.mjs` (from `let bytes, label` to the end) with:

```js
// Data and app are budgeted separately: the song catalog grows on its own
// schedule, and without a split a dataset change silently eats the app's
// headroom and the next app change fails a check it did not cause.
const DATA_MAX = 2 * 1024 * 1024
const APP_MAX = 1.5 * 1024 * 1024
const mb = (b) => (b / 1024 / 1024).toFixed(2)

let failed = false

if (single) {
  const bytes = statSync(join(distDir, 'index.html')).size
  if (bytes > MAX) {
    console.error(`✗ dist/index.html is ${mb(bytes)} MB — over the 3 MB budget.`)
    failed = true
  } else {
    console.log(`✓ dist/index.html is ${mb(bytes)} MB — within the 3 MB budget.`)
  }
} else {
  const dataPath = join(distDir, 'aica-data.js')
  const dataBytes = existsSync(dataPath) ? statSync(dataPath).size : 0
  const totalBytes = sumDir(distDir)
  const appBytes = totalBytes - dataBytes

  console.log(`  app   ${mb(appBytes)} MB (budget ${mb(APP_MAX)} MB)`)
  console.log(`  data  ${mb(dataBytes)} MB (budget ${mb(DATA_MAX)} MB)`)
  console.log(`  total ${mb(totalBytes)} MB (cap ${mb(MAX)} MB)`)

  if (appBytes > APP_MAX) { console.error(`✗ app bundle over budget.`); failed = true }
  if (dataBytes > DATA_MAX) { console.error(`✗ data bundle over budget.`); failed = true }
  if (totalBytes > MAX) { console.error(`✗ dist/ over the 3 MB hard cap.`); failed = true }
  if (!failed) console.log(`✓ within budget.`)
}

process.exit(failed ? 1 : 0)
```

Add `existsSync` to the `node:fs` import at the top of that file.

- [ ] **Step 5: Wire the inliner into the single-file build**

In `htmlapp/frontend/package.json`:

```json
    "build:singlefile": "npm run build:data && npm run typecheck && cross-env HTMLAPP_SINGLEFILE=1 vite build && node scripts/inline-data.mjs && node scripts/check-size.mjs --single",
```

- [ ] **Step 6: Run tests and both builds**

Run: `npm test -- inline_data && npm run build && npm run build:singlefile`
Expected: tests PASS; `npm run build` prints the three-line app/data/total table; `npm run build:singlefile` prints `✓ inlined aica-data.js into dist/index.html` and leaves `dist/` with exactly one `index.html` and no `aica-data.js`.

Verify: `ls dist/aica-data.js` after the single-file build → "No such file or directory".

- [ ] **Step 7: Commit**

```bash
git add htmlapp/frontend/scripts/inline-data.mjs htmlapp/frontend/scripts/check-size.mjs htmlapp/frontend/package.json htmlapp/frontend/tests/inline_data.test.ts
git commit -m "build(htmlapp): inline the data bundle for single-file builds; split app/data size budgets"
```

---

### Task 9: Repair `sync-from-app.mjs`

This is a pre-existing break, not new work: `npm run sync` fails its own `tsc` gate today.

**Files:**
- Modify: `htmlapp/frontend/scripts/sync-from-app.mjs`
- Test: `htmlapp/frontend/tests/sync_config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `sync-from-app.mjs` exports `DIRS`, `FILES`, `PROTECTED`, `EXCLUDE` so its configuration is assertable without running a filesystem copy.

- [ ] **Step 1: Write the failing test**

Create `htmlapp/frontend/tests/sync_config.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { DIRS, PROTECTED, EXCLUDE } from '../scripts/sync-from-app.mjs'

describe('sync configuration', () => {
  it('syncs lib/ — five Trigger components import from it', () => {
    expect(DIRS).toContain('lib')
  })

  it('excludes surfaces whose clients do not exist in htmlapp yet', () => {
    for (const p of [
      'components/proposal',
      'components/merged',
      'components/review',
      'state/appMode.tsx',
      'state/proposalStore.ts',
      'state/mergedCoordinator.tsx',
      'state/reviewStore.tsx',
      'state/languageBridges.tsx',
      'api/proposalClient.ts',
      'api/mergedClient.ts',
      'replay/mergedReplaySource.ts',
    ]) {
      expect(EXCLUDE, `${p} must be excluded until its client is ported`).toContain(p)
    }
  })

  it('never overwrites the offline seam', () => {
    for (const p of ['api/client.ts', 'api/types.ts', 'engine', 'data', 'storage', 'config.ts', 'App.tsx']) {
      expect(PROTECTED).toContain(p)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- sync_config`
Expected: FAIL — `DIRS`, `PROTECTED` and `EXCLUDE` are not exported (and `DIRS` lacks `lib`).

- [ ] **Step 3: Export and repair the configuration**

In `htmlapp/frontend/scripts/sync-from-app.mjs`, export the four config arrays and add the missing entries:

```js
// Whole directories copied verbatim.
// `lib` is required: components/setup/situation/FixedConditionsSection.tsx,
// components/setup/formulationTemplates.ts, components/map/MapSurface.tsx,
// components/map/FallbackRouteMap.tsx and components/playback/ScoreTimeline.tsx
// all import from lib/ — without it the tsc gate below fails on a clean sync.
export const DIRS = ['components', 'state', 'i18n', 'styles', 'replay', 'lib']
// Individual files copied verbatim.
export const FILES = ['main.tsx', 'vite-env.d.ts']
```

```js
export const PROTECTED = [
  'api/client.ts',
  'api/types.ts',
  'engine',
  'data',
  'storage',
  'config.ts',
  'App.tsx',
  'main.tsx',
]
```

(`main.tsx` joins `PROTECTED` because Task 7 made it htmlapp-specific — it owns the data-registry boot guard.  Remove it from `FILES` in the same edit so the two lists do not contradict each other.)

```js
export const EXCLUDE = [
  'components/proposal',
  'components/merged',
  // Added by feature 023 after the P1 exclusion list was written; imports
  // mergedClient and lib/review, so it cannot compile until C5 lands.
  'components/review',
  'state/appMode.tsx',
  'state/proposalStore.ts',
  'state/mergedCoordinator.tsx',
  'state/reviewStore.tsx',
  'state/languageBridges.tsx',
  'api/proposalClient.ts',
  'api/mergedClient.ts',
  'replay/mergedReplaySource.ts',
]
```

Guard the CLI body so importing the module in a test does not copy files. Wrap everything from the first `for (const d of DIRS)` to the end in:

```js
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  // ...existing copy / exclude / restore / tsc body, unchanged...
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- sync_config`
Expected: PASS.

- [ ] **Step 5: Prove the sync itself works again**

Run: `npm run sync`
Expected: the copy log, the `excluded` lines including `components/review`, then `✓ synced tree typechecks`.

If `tsc` reports errors in newly-arrived `lib/review/*` files (they import `api/mergedClient`), add the offending paths to `EXCLUDE` — `lib/review/caseCatalog.ts` in particular uses the `@contracts` alias that htmlapp does not define, and C5 replaces it with a registry-backed version. Record each addition with a one-line reason, as the existing entries do.

- [ ] **Step 6: Verify the working tree is clean after the sync**

Run: `git status --short htmlapp/frontend/src`
Expected: only files you intended to change. A sync that rewrites unrelated components means `app/frontend` has drifted; review that diff before committing it.

- [ ] **Step 7: Commit**

```bash
git add htmlapp/frontend/scripts/sync-from-app.mjs htmlapp/frontend/tests/sync_config.test.ts
git commit -m "fix(htmlapp): repair sync-from-app — sync lib/, exclude review surfaces, assert config"
```

---

### Task 10: C0 acceptance

No new behavior — proves the slice's gate.

**Files:**
- Modify: `docs/superpowers/plans/2026-08-01-htmlapp-combined-c0-data-seam.md` (tick the boxes)

- [ ] **Step 1: Full verification from a clean tree**

```bash
cd htmlapp/frontend
rm -rf data public/aica-data.js dist
npm run build:data
npm test
npm run typecheck
npm run build
npm run build:singlefile
```

Expected: `build:data` prints the count table; `npm test` passes with **no** test importing a deleted `src/data/*.json`; both builds succeed and report within budget.

- [ ] **Step 2: Confirm the data seam actually decouples**

Edit any preset in `proposal_contracts/presets/`, then:

```bash
cd htmlapp/frontend && npm run build:data && grep -c "$(node -e 'process.stdout.write("preset_id")')" data/aica-data.json
```

Expected: the regenerated payload contains the edit, with **zero** changes to any file under `htmlapp/frontend/src/`. Revert the preset edit afterwards.

- [ ] **Step 3: Confirm the file:// deliverable still opens**

```bash
cd htmlapp/frontend && npm run build && (cd dist && xdg-open index.html)
```

Expected: the Trigger screen renders (not `DataErrorScreen`), a scenario is selectable, and the browser console shows the in-process transport downgrade notice — proving the `<script>` tag reached the main-thread registry at `file://`.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-08-01-htmlapp-combined-c0-data-seam.md
git commit -m "docs(htmlapp): mark C0 data seam complete"
```

---

## Self-Review

**Spec coverage.** Against the C0 row of the ADR: `data.manifest.mjs` (Task 1), `build:data` (Task 2), `src/data/registry.ts` with shape and referential validation (Tasks 3–4), delete hand-copied `src/data` JSON (Task 5), `prebuild` wiring (Task 2), split size budgets (Task 8), repair `sync-from-app.mjs` (Task 9), migrate the five tests importing `src/data/*` (Tasks 3, 5). All covered.

**Two additions the ADR did not anticipate**, both discovered while reading the code:
- **Task 6 (worker data handshake).** The ADR's data seam described a `<script>` tag only. The worker is a separate global scope that a script tag cannot reach, and `handlers/routes.ts` plus `storage/db.ts` both run there — so without `data.install` the served-`http://` worker path loses all data. Adds one htmlapp-only, parity-exempt op (making the C4 total 42, not 41).
- **Task 8 (single-file inlining).** `public/` assets are copied verbatim and never bundled, so `vite-plugin-singlefile` would leave the external tag alone and `build:singlefile` would stop producing a single file.

The ADR should be amended for both. That is a doc edit, not a plan change.

**Type consistency.** `PackageRecord` and `RoutePreset` are declared once in `src/data/types.ts` and imported everywhere else. `BUILTIN_EVALUATORS`, `BuiltinEvaluateFn`, `BuiltinPyContext` live in `src/data/builtinEvaluators.ts` and are re-exported from `src/data/packages/index.ts` so `adapter.ts` compiles either way. `DEFAULT_PACKAGES`/`DEFAULT_SCENARIOS`/`DEFAULT_ROUTE_PRESETS` are consistently replaced by `builtinPackages()`/`builtinScenarios()`/`routePresets()` at all six call sites and in both tests.

**Known-failing-by-design step.** Task 5 Step 1 deliberately writes an assertion that fails (evaluators for all six package manifests) and Step 3 narrows it with `UNPORTED_BUILTINS`, which C1 deletes. Flagged so an implementer does not "fix" it by deleting the test.
