import { describe, it, expect, vi } from 'vitest';
import { selfInvoke, extractFlag, showUsage } from '../../src/cli/_shared.js';

describe('selfInvoke', () => {
  it('calls runCLI when metaUrl matches process.argv[1]', async () => {
    const fakeUrl = `file://${process.argv[1]}`;
    const runCLI = vi.fn().mockResolvedValue(undefined);
    selfInvoke(fakeUrl, runCLI);
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
    const exitSpy = vi.fn();
    process.exit = exitSpy as any;
    process.argv = [origArgv[0], origArgv[1]];
    try {
      const runCLI = vi.fn().mockRejectedValue(new Error('boom'));
      const fakeUrl = `file://${process.argv[1]}`;
      selfInvoke(fakeUrl, runCLI);
      await new Promise(r => setTimeout(r, 0));
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
