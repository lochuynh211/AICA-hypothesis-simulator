import { statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const dist = resolve(here, '..', 'dist', 'index.html')
const MAX = 3 * 1024 * 1024
const TARGET = 2 * 1024 * 1024

const bytes = statSync(dist).size
const mb = (bytes / 1024 / 1024).toFixed(2)
if (bytes > MAX) {
  console.error(`✗ dist/index.html is ${mb} MB — over the 3 MB budget.`)
  process.exit(1)
}
if (bytes > TARGET) {
  console.warn(`⚠ dist/index.html is ${mb} MB — over the 2 MB target (under 3 MB hard cap).`)
} else {
  console.log(`✓ dist/index.html is ${mb} MB — within budget.`)
}
