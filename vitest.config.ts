import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    testTimeout: 10000,
    hookTimeout: 5000,
    exclude: [
      'node_modules/**',
      'dist/**',
      '.claude/worktrees/**',   // 排除 fixer agent 的 worktree 残留
      '**/dist/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['dist/**', 'node_modules/**', 'tests/**', '**/*.test.ts'],
    },
  },
});
