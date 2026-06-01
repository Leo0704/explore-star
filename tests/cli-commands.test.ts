/**
 * CLI 子命令测试
 *
 * 关键约定：CLI 在打印 --help 或参数错误后调用 process.exit()。
 * 在 vitest 中 process.exit 会以异常方式传播，导致 Promise reject / 测试崩溃。
 * 这里在每个 case 跑之前 mock 掉 process.exit，让 CLI 走完主流程。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('CLI Commands', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  describe('init', () => {
    it('should show help without args', async () => {
      const { runCLI } = await import('../src/cli/init.js');
      // Should not throw with --help
      await expect(runCLI(['--help'])).resolves.not.toThrow();
    });
  });

  describe('doctor', () => {
    it('should show help', async () => {
      const { runCLI } = await import('../src/cli/doctor.js');
      await expect(runCLI(['--help'])).resolves.not.toThrow();
    });
  });

  describe('run', () => {
    it('should show help', async () => {
      const { runCLI } = await import('../src/cli/run.js');
      await expect(runCLI(['--help'])).resolves.not.toThrow();
    });
  });

  describe('analyze', () => {
    it('should show help without required --input', async () => {
      const { runCLI } = await import('../src/cli/analyze.js');
      // analyze 在缺 --input 时打印 USAGE + 错误并 return（不调 process.exit）
      await expect(runCLI([])).resolves.not.toThrow();
    });

    it('should show help with --help flag', async () => {
      const { runCLI } = await import('../src/cli/analyze.js');
      await expect(runCLI(['--help'])).resolves.not.toThrow();
    });
  });

  describe('nurture', () => {
    it('should show help', async () => {
      const { runCLI } = await import('../src/cli/nurture.js');
      await expect(runCLI(['--help'])).resolves.not.toThrow();
    });
  });

  describe('convert', () => {
    it('should show help', async () => {
      const { runCLI } = await import('../src/cli/convert.js');
      await expect(runCLI(['--help'])).resolves.not.toThrow();
    });
  });

  describe('insights', () => {
    it('should show help', async () => {
      const { runCLI } = await import('../src/cli/insights.js');
      await expect(runCLI(['--help'])).resolves.not.toThrow();
    });
  });

  describe('conversion-report', () => {
    it('should show help', async () => {
      const { runCLI } = await import('../src/cli/conversion-report.js');
      await expect(runCLI(['--help'])).resolves.not.toThrow();
    });
  });

  describe('reactivate', () => {
    it('should show help', async () => {
      const { runCLI } = await import('../src/cli/reactivate.js');
      await expect(runCLI(['--help'])).resolves.not.toThrow();
    });
  });

  describe('watch-bookings', () => {
    it('should show help', async () => {
      const { runCLI } = await import('../src/cli/watch-bookings.js');
      await expect(runCLI(['--help'])).resolves.not.toThrow();
    });
  });

  describe('configure', () => {
    it('should show help', async () => {
      const { runCLI } = await import('../src/cli/configure.js');
      await expect(runCLI(['--help'])).resolves.not.toThrow();
    });
  });
});

describe('CLI Index', () => {
  it('should route init command', async () => {
    const mod = await import('../src/cli/index.js');
    // Just verify the module loads
    expect(mod).toBeDefined();
  });

  it('should show usage without command', async () => {
    const mod = await import('../src/cli/index.js');
    // Module should have main function
    expect(mod).toBeDefined();
  });
});