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
