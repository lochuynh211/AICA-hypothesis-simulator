import { statSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const distDir = resolve(here, '..', 'dist')
const MAX = 3 * 1024 * 1024
const TARGET = 2 * 1024 * 1024

const single = process.argv.includes('--single')

function sumDir(dir) {
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      total += sumDir(full)
    } else {
      total += statSync(full).size
    }
  }
  return total
}

let bytes, label
if (single) {
  const indexHtml = join(distDir, 'index.html')
  bytes = statSync(indexHtml).size
  label = 'dist/index.html'
} else {
  bytes = sumDir(distDir)
  label = 'dist/ (all files)'
}

const mb = (bytes / 1024 / 1024).toFixed(2)
if (bytes > MAX) {
  console.error(`✗ ${label} is ${mb} MB — over the 3 MB budget.`)
  process.exit(1)
}
if (bytes > TARGET) {
  console.warn(`⚠ ${label} is ${mb} MB — over the 2 MB target (under 3 MB hard cap).`)
} else {
  console.log(`✓ ${label} is ${mb} MB — within budget.`)
}
