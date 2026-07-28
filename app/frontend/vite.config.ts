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
      // allowed explicitly for the dev server.
      allow: [path.resolve(__dirname, '..', '..')],
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
