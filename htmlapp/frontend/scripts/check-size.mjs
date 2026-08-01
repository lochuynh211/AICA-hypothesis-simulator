import { statSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const distDir = resolve(here, '..', 'dist')
const MAX = 3 * 1024 * 1024

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
