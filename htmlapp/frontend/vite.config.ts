import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  build: {
    target: 'es2020',
    assetsInlineLimit: 100 * 1024, // inline assets <= 100 KB as base64
    cssCodeSplit: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
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
