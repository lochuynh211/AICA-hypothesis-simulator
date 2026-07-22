import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const dist = resolve(here, '..', 'dist')
const out = resolve(here, '..', 'dist-htmlapp.zip')

if (!existsSync(dist)) {
  console.error(`✗ dist/ does not exist — run vite build first`)
  process.exit(1)
}

try {
  if (process.platform === 'win32') {
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
