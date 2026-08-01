#!/usr/bin/env node
/**
 * zip-dist — package dist/ into dist-htmlapp.zip. A convenience wrapper, not
 * the deliverable: dist/ itself is what ships, so a missing archiver must
 * not fail the build. A genuine archiving failure (archiver present but
 * erroring) still must.
 */
import { existsSync } from 'node:fs'
import { resolve, dirname, join, delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const dist = resolve(here, '..', 'dist')
const out = resolve(here, '..', 'dist-htmlapp.zip')

/**
 * Pure archiver-detection decision, factored out so it is unit-testable
 * without mocking `node:child_process` or touching the real filesystem/PATH:
 * `pathDirs` and `exists` are injected rather than read from the environment.
 *
 * On Windows, PowerShell's Compress-Archive ships with the OS, so it is
 * always available. Elsewhere we need a `zip` executable somewhere on PATH.
 */
export function pickArchiver(platform, pathDirs, exists) {
  if (platform === 'win32') {
    return { archiver: 'powershell', reason: null }
  }
  const found = pathDirs.some((dir) => dir && exists(join(dir, 'zip')))
  if (found) return { archiver: 'zip', reason: null }
  return { archiver: null, reason: 'no `zip` executable found on PATH' }
}

function main() {
  if (!existsSync(dist)) {
    console.error(`✗ dist/ does not exist — run vite build first`)
    process.exit(1)
  }

  const pathDirs = (process.env.PATH || '').split(delimiter)
  const { archiver, reason } = pickArchiver(process.platform, pathDirs, existsSync)

  if (!archiver) {
    console.warn(
      `⚠ skipping dist-htmlapp.zip: ${reason}. dist/ is the deliverable — the zip is a convenience wrapper, not required.`
    )
    process.exit(0)
  }

  try {
    if (archiver === 'powershell') {
      execFileSync(
        'powershell',
        ['-NoProfile', '-Command', `Compress-Archive -Path '${dist}\\*' -DestinationPath '${out}' -Force`],
        { stdio: 'inherit' }
      )
    } else {
      execFileSync('zip', ['-r', out, '.'], { cwd: dist, stdio: 'inherit' })
    }
    console.log(`✓ packaged ${out}`)
  } catch (e) {
    console.error('zip failed:', e.message)
    process.exit(1)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main()
}
