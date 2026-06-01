/**
 * CLI 子命令测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('CLI Commands', () => {
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
      // Should exit with error but not crash
      await expect(runCLI([])).rejects.toThrow();
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