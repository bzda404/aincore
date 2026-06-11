import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/main/**/__tests__/**/*.spec.ts', 'test/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/main/**/*.ts'],
      exclude: ['src/main/**/__tests__/**', 'src/renderer/**'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/main'),
    },
  },
})
