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
  },
})
