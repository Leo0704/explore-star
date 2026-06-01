import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    testTimeout: 10000,
    hookTimeout: 5000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['dist/**', 'node_modules/**', 'tests/**', '**/*.test.ts'],
    },
  },
});
