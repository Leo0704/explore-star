/**
 * src/cli/_shared.ts 单元测试
 *
 * 重点：selfInvoke 必须接受调用方模块的 import.meta.url 作为参数，
 * 内部 import.meta.url 永远指向 helper 模块本身（_shared.js），
 * 不能用来做"判断是否被直接 invoke"——这就是项目级 bug 的根因。
 */

import { describe, it, expect, vi } from 'vitest';
import { selfInvoke, extractFlag, showUsage } from '../../src/cli/_shared.js';

describe('selfInvoke', () => {
  it('calls runCLI when metaUrl matches process.argv[1]', async () => {
    const fakeUrl = `file://${process.argv[1]}`;
    const runCLI = vi.fn().mockResolvedValue(undefined);
    selfInvoke(fakeUrl, runCLI);
    // microtask flush
    await new Promise(r => setTimeout(r, 0));
    expect(runCLI).toHaveBeenCalledTimes(1);
    expect(runCLI).toHaveBeenCalledWith([]);
  });

  it('does NOT call runCLI when metaUrl mismatches process.argv[1]', async () => {
    const runCLI = vi.fn().mockResolvedValue(undefined);
    selfInvoke('file:///some/other/path.ts', runCLI);
    await new Promise(r => setTimeout(r, 0));
    expect(runCLI).not.toHaveBeenCalled();
  });

  it('passes process.argv.slice(2) as args', async () => {
    const origArgv = process.argv;
    process.argv = [origArgv[0], origArgv[1], '--business', './foo', '--days', '7'];
    try {
      const runCLI = vi.fn().mockResolvedValue(undefined);
      const fakeUrl = `file://${process.argv[1]}`;
      selfInvoke(fakeUrl, runCLI);
      await new Promise(r => setTimeout(r, 0));
      expect(runCLI).toHaveBeenCalledWith(['--business', './foo', '--days', '7']);
    } finally {
      process.argv = origArgv;
    }
  });

  it('catches runCLI rejection (does not throw unhandled)', async () => {
    const origArgv = process.argv;
    const origExit = process.exit;
    // 用 --help 之类的未知 flag 触发 runCLI 内部 error 不太可控；
    // 改用 mock runCLI 抛错，看 selfInvoke 是否吞掉
    const exitSpy = vi.fn();
    process.exit = exitSpy as any;
    process.argv = [origArgv[0], origArgv[1]];
    try {
      const runCLI = vi.fn().mockRejectedValue(new Error('boom'));
      const fakeUrl = `file://${process.argv[1]}`;
      selfInvoke(fakeUrl, runCLI);
      await new Promise(r => setTimeout(r, 0));
      // 兜底：必须 log + exit(1)
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      process.argv = origArgv;
      process.exit = origExit;
    }
  });
});

describe('extractFlag', () => {
  it('returns value after flag', () => {
    expect(extractFlag(['--business', '/tmp/x'], '--business')).toBe('/tmp/x');
  });
  it('returns undefined if flag missing', () => {
    expect(extractFlag(['--other', 'val'], '--business')).toBeUndefined();
  });
  it('returns undefined if flag is last arg (no value)', () => {
    expect(extractFlag(['--business'], '--business')).toBeUndefined();
  });
});

describe('showUsage', () => {
  it('prints usage and returns true when --help in args', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = showUsage('USAGE TEXT', ['--help']);
    expect(result).toBe(true);
    expect(logSpy).toHaveBeenCalledWith('USAGE TEXT');
    logSpy.mockRestore();
  });
  it('prints usage and returns true when -h in args', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = showUsage('USAGE TEXT', ['-h']);
    expect(result).toBe(true);
    logSpy.mockRestore();
  });
  it('returns false when no help flag', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = showUsage('USAGE TEXT', ['--business', '/tmp']);
    expect(result).toBe(false);
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
