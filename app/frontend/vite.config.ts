import path from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:8137'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // The committed contract directory is the SINGLE source of truth — the
      // frontend reads the same files pytest validates, with no copies.
      '@contracts': path.resolve(__dirname, '../../combined_contracts'),
    },
  },
  server: {
    port: 5180,
    host: true,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
    fs: {
      // combined_contracts/ lives above the Vite root, so serving it must be
      // allowed explicitly. Scoped to exactly the two directories needed — the
      // dev server binds 0.0.0.0 via `host: true`, and allowing the repo root
      // would serve .git/ history and every unrelated subproject to the LAN.
      allow: [path.resolve(__dirname), path.resolve(__dirname, '../../combined_contracts')],
    },
    watch: {
      usePolling: !!process.env.CHOKIDAR_USEPOLLING,
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['tests/setup.ts'],
  },
})
