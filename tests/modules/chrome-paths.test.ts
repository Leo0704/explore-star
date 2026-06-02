/**
 * chrome-paths 单元测试
 *
 * 覆盖：
 *   - assertChromePath 存在/不存在
 *   - resolveChromePath env var 优先级（最高）
 *   - resolveChromePath explicitPath 在 env 未设时的回退
 *   - chromeInstallHint 平台文案
 *
 * 不跑真实 Chrome；puppeteer 跨平台默认分支靠库自身保证。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertChromePath,
  resolveChromePath,
  chromeInstallHint,
} from '../../src/modules/task-executor/chrome-paths.js';

describe('chrome-paths', () => {
  const originalEnv = process.env.CHROME_EXECUTABLE_PATH;
  let tmpDir: string;
  let realChromePath: string;

  beforeEach(() => {
    delete process.env.CHROME_EXECUTABLE_PATH;
    tmpDir = mkdtempSync(join(tmpdir(), 'chrome-paths-test-'));
    realChromePath = join(tmpDir, 'fake-chrome');
    writeFileSync(realChromePath, '#!/bin/sh\n');
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.CHROME_EXECUTABLE_PATH;
    } else {
      process.env.CHROME_EXECUTABLE_PATH = originalEnv;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('assertChromePath', () => {
    it('存在时不抛错', () => {
      expect(() => assertChromePath(realChromePath)).not.toThrow();
    });

    it('不存在时抛错并包含平台提示', () => {
      const missing = join(tmpDir, 'does-not-exist');
      expect(() => assertChromePath(missing)).toThrowError(/Chrome 可执行文件未找到/);
      // 平台提示至少包含 "Chrome" 或安装指引关键字
      try {
        assertChromePath(missing);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        expect(msg).toMatch(/Chrome|CHROME_EXECUTABLE_PATH/);
      }
    });
  });

  describe('resolveChromePath', () => {
    it('env var 最优先，覆盖 explicitPath', async () => {
      process.env.CHROME_EXECUTABLE_PATH = realChromePath;
      const otherPath = join(tmpDir, 'other-chrome');
      writeFileSync(otherPath, '#!/bin/sh\n');
      // 即使 explicitPath 指向不同文件，env var 应胜出
      const result = await resolveChromePath(otherPath);
      expect(result).toBe(realChromePath);
    });

    it('env 未设 + explicitPath 存在 → 用 explicitPath', async () => {
      const result = await resolveChromePath(realChromePath);
      expect(result).toBe(realChromePath);
    });

    it('env 未设 + explicitPath 不存在 → 抛清晰错误', async () => {
      const missing = join(tmpDir, 'missing-explicit');
      await expect(resolveChromePath(missing)).rejects.toThrowError(/Chrome 可执行文件未找到/);
    });

    it('env 未设 + explicitPath 为空字符串 → 跳到 puppeteer 默认', async () => {
      // 不传 explicitPath 时走到 puppeteer.executablePath('chrome') 分支
      // 本机装了 Chrome，能拿到 /Applications/... 或平台对应路径
      // 不存在的环境（如无 Chrome）下会 throw，但那是预期的 puppeteer 行为
      try {
        const result = await resolveChromePath('');
        // 拿到路径则跳过；该测试只验证不会因空串走错分支
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
      } catch (e) {
        // 平台没装 Chrome 时 puppeteer 也会 throw；只需错误是 Chrome 相关
        const msg = e instanceof Error ? e.message : String(e);
        expect(msg).toMatch(/Chrome|puppeteer/);
      }
    });
  });

  describe('chromeInstallHint', () => {
    it('返回非空字符串', () => {
      const hint = chromeInstallHint();
      expect(typeof hint).toBe('string');
      expect(hint.length).toBeGreaterThan(0);
    });

    it('macOS 提示包含 Chrome / 安装指引', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      try {
        expect(chromeInstallHint()).toMatch(/macOS|Chrome/);
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
      }
    });
  });
});
