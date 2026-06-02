/**
 * run-daily feedback-applier 挂载测试（Phase 2 #3）
 *
 * 关键不变量（源级别测试，避免 mock 整个 run-dailyBody）：
 *   - run-daily.ts 在 finally 块末尾**新增**了 applyOutcomeFeedback 调用
 *   - applyOutcomeFeedback 在独立 try/catch 内（与 #2 worker 改的错误处理物理隔离）
 *   - 调用方 import 使用 dynamic import（避免循环依赖）
 */

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('run-daily.ts feedback-applier hook (source-level)', () => {
  it('contains applyOutcomeFeedback call inside finally block', async () => {
    const src = await readFile('src/orchestration/run-daily.ts', 'utf-8');
    expect(src).toMatch(/applyOutcomeFeedback\s*\(/);
    // 提取 finally 块: } finally { ... } (单层,匹配首个)
    const finallyMatch = src.match(/\} finally \{([\s\S]*?)\n  \}\n\}/);
    expect(finallyMatch, 'finally 块应存在且可解析').toBeTruthy();
    expect(finallyMatch![1]).toContain('applyOutcomeFeedback');
  });

  it('wraps applyOutcomeFeedback in its own try/catch (isolated failure)', async () => {
    const src = await readFile('src/orchestration/run-daily.ts', 'utf-8');
    // applyOutcomeFeedback 紧邻 try { ... } catch (learnErr) { log.error ... }
    expect(src).toMatch(/applyOutcomeFeedback[\s\S]{0,300}catch\s*\(\s*learnErr\s*\)/);
  });

  it('uses dynamic import to avoid circular deps', async () => {
    const src = await readFile('src/orchestration/run-daily.ts', 'utf-8');
    expect(src).toMatch(/await import\(['"]\.\.\/modules\/feedback-applier\/index\.js['"]\)/);
  });

  it('does not modify existing finally appendRunHistory block (no regression for #2)', async () => {
    const src = await readFile('src/orchestration/run-daily.ts', 'utf-8');
    // appendRunHistory 调用应仍在 finally 内
    expect(src).toContain('appendRunHistory');
    expect(src).toContain("title: `探星：run 失败");
  });
});
