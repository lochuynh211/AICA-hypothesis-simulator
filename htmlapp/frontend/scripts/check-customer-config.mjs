import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const configPath = resolve(here, '..', 'src', 'config.ts')
const src = readFileSync(configPath, 'utf8')
const match = src.match(/googleMapsApiKey:\s*['"]([^'"]*)['"]/)
if (!match || match[1].trim() === '') {
  console.error('✗ src/config.ts googleMapsApiKey is empty — cannot cut a customer bundle. Fill it in first.')
  process.exit(1)
}
console.log('✓ customer config has a map key.')
