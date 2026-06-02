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
      // 基线（2026-06-02 实测）：lines 49.91% / branches 39.91% / functions 56.51% / statements 48.65%
      // 阈值 = 基线 + 5 个百分点，向上取整到 5 的倍数；后续每加测一个模块再上调
      thresholds: {
        lines: 55,
        functions: 60,
        branches: 45,
        statements: 55,
      },
      reportOnFailure: true,
    },
  },
});
