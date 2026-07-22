import { defineConfig, devices } from '@playwright/test'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  testDir: 'tests/e2e',
  // Serve the pre-built dist/ on port 4174 for the "served build" (worker mode) tests.
  // The build must have run before `npm run test:e2e` (see the S8 task brief).
  webServer: {
    command: 'npx vite preview --port 4174',
    port: 4174,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    cwd: resolve(__dirname),
  },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:4174',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
