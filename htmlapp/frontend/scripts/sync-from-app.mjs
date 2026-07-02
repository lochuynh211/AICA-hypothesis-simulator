// Refresh the copied presentation layer from app/frontend/src.
// NEVER overwrites the offline-specific seam: api/client.ts, engine/, data/,
// storage/, config.ts. Run before cutting a bundle to pick up UX fixes.
import { cpSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const APP = resolve(here, '..', '..', '..', 'app', 'frontend', 'src')
const OUT = resolve(here, '..', 'src')

// Whole directories copied verbatim.
const DIRS = ['components', 'state', 'i18n', 'styles', 'replay']
// Individual files copied verbatim.
const FILES = ['App.tsx', 'main.tsx', 'vite-env.d.ts', 'api/types.ts']
// Guard: these must never be overwritten by the sync.
const PROTECTED = ['api/client.ts', 'engine', 'data', 'storage', 'config.ts']

for (const d of DIRS) {
  const src = resolve(APP, d)
  const dst = resolve(OUT, d)
  if (!existsSync(src)) continue
  rmSync(dst, { recursive: true, force: true })
  cpSync(src, dst, { recursive: true })
  console.log(`synced dir  ${d}/`)
}
for (const f of FILES) {
  const src = resolve(APP, f)
  const dst = resolve(OUT, f)
  if (!existsSync(src)) continue
  mkdirSync(dirname(dst), { recursive: true })
  cpSync(src, dst)
  console.log(`synced file ${f}`)
}
console.log(`\nProtected (never synced): ${PROTECTED.join(', ')}`)
