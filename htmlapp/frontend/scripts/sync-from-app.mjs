// Refresh the copied presentation layer from app/frontend/src.
// NEVER overwrites the offline-specific seam: api/client.ts, api/types.ts,
// engine/, data/, storage/, config.ts, App.tsx, or any RESTORE_FROM_GIT
// path. Run before cutting a bundle to pick up UX fixes.
import { cpSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { execSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const APP = resolve(here, '..', '..', '..', 'app', 'frontend', 'src')
const OUT = resolve(here, '..', 'src')

// Whole directories copied verbatim.
const DIRS = ['components', 'state', 'i18n', 'styles', 'replay']
// Individual files copied verbatim.
const FILES = ['main.tsx', 'vite-env.d.ts']
// Guard: these must never be overwritten by the sync.
// api/types.ts is htmlapp-specific (superset of upstream; adds fields used by
// engine/recovery.ts that are not yet in app/frontend/src/api/types.ts).
const PROTECTED = [
  'api/client.ts',
  'api/types.ts',
  'engine',
  'data',
  'storage',
  'config.ts',
  'App.tsx',
]

// Files inside synced directories that are htmlapp-maintained overrides
// (upstream added imports the htmlapp cannot use yet).  After the bulk copy
// these are restored from git HEAD so the htmlapp version is used.
const RESTORE_FROM_GIT = [
  'src/components/playback/timelineData.ts',
]

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
  if (PROTECTED.some((p) => f === p || f.startsWith(p + '/'))) {
    console.log(`protected   ${f}  (skipped)`)
    continue
  }
  mkdirSync(dirname(dst), { recursive: true })
  cpSync(src, dst)
  console.log(`synced file ${f}`)
}
console.log(`\nProtected (never synced): ${PROTECTED.join(', ')}`)

// Not-yet-ported surfaces (P2 proposal, P3 merged): copied by cpSync above,
// removed here so tsc cannot break on clients that don't exist in htmlapp yet.
const EXCLUDE = [
  'components/proposal',
  'components/merged',
  'state/appMode.tsx',
  'state/proposalStore.ts',
  'state/mergedCoordinator.tsx',
  'state/languageBridges.tsx',
  'api/proposalClient.ts',
  'api/mergedClient.ts',
  'replay/mergedReplaySource.ts',
]
console.log()
for (const p of EXCLUDE) {
  rmSync(resolve(OUT, p), { recursive: true, force: true })
  console.log(`excluded    ${p}`)
}

// Restore htmlapp-maintained overrides from git HEAD.
console.log()
const repoRoot = resolve(here, '..', '..', '..')
for (const rel of RESTORE_FROM_GIT) {
  const gitPath = `htmlapp/frontend/${rel}`
  execSync(`git checkout HEAD -- "${gitPath}"`, { cwd: repoRoot, stdio: 'inherit', shell: true })
  console.log(`restored    ${rel}  (from git HEAD)`)
}

console.log('\nrunning tsc --noEmit --project tsconfig.authored.json to verify the synced tree compiles...')
// Use shell:true so npx resolves correctly on all platforms (Windows/Linux/macOS).
execSync('npx tsc --noEmit --project tsconfig.authored.json', {
  cwd: resolve(here, '..'),
  stdio: 'inherit',
  shell: true,
})
console.log('✓ synced tree typechecks')
