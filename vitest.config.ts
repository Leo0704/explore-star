import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    testTimeout: 10000,
    hookTimeout: 5000,
    exclude: [
      'node_modules/**',
      'dist/**',
      '.claude/worktrees/**',
      '**/dist/**',
      'vendor/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: [['text', { skipFull: false }], 'text-summary', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'dist/**',
        'node_modules/**',
        'tests/**',
        '**/*.test.ts',
        'src/**/*.d.ts',
        'src/cli/_shared.ts',
      ],
      thresholds: {
        lines: 55,
        functions: 60,
        branches: 45,
        statements: 50,
      },
      reportOnFailure: true,
    },
  },
});
