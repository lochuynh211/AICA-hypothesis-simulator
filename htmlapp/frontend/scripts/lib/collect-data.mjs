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
  const out = {}
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
    if (Object.prototype.hasOwnProperty.call(out, id)) {
      problems.push(`datasets/${entry.name}: duplicate dataset_id '${id}' — already declared by another directory`)
      continue
    }
    const affinityPath = join(dir, 'genre_affinity_v1.json')
    out[id] = {
      manifest,
      catalog,
      genreAffinity: existsSync(affinityPath) ? readJson(affinityPath, problems, repoRoot) : null,
    }
  }
  return out
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

    const collected = {}
    for (const file of files) {
      const doc = readJson(file, problems, repoRoot)
      if (!doc) continue
      const id = doc[src.idField]
      if (typeof id !== 'string' || !id) {
        problems.push(`${src.key}: ${relative(repoRoot, file)} has no string '${src.idField}'`)
        continue
      }
      // hasOwnProperty.call, not `id in collected`: `in` walks the prototype
      // chain, so an id of 'constructor' / 'toString' / '__proto__' would be
      // misreported as a duplicate and silently dropped.
      if (Object.prototype.hasOwnProperty.call(collected, id)) {
        problems.push(`${src.key}: duplicate id '${id}' from ${relative(repoRoot, file)}`)
        continue
      }
      collected[id] = doc
    }
    payload[src.key] = Object.fromEntries(Object.keys(collected).sort().map((k) => [k, collected[k]]))
  }

  return { payload, problems }
}
