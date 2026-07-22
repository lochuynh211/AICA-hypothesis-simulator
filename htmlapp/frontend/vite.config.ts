import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

const SINGLE = process.env.HTMLAPP_SINGLEFILE === '1'

export default defineConfig({
  base: './',
  plugins: [react(), ...(SINGLE ? [viteSingleFile()] : [])],
  build: {
    target: 'es2020',
    assetsInlineLimit: 100 * 1024, // inline assets <= 100 KB as base64
    cssCodeSplit: !SINGLE,
    rollupOptions: SINGLE ? { output: { inlineDynamicImports: true } } : {},
  },
  worker: { format: 'es' },
  server: { port: 5181, host: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['tests/setup.ts'],
    // tests/e2e/** are Playwright specs (run via `npm run test:e2e`), not Vitest —
    // Playwright's own `test()` throws if collected by Vitest, so exclude explicitly.
    exclude: ['node_modules/**', 'tests/e2e/**'],
  },
})
