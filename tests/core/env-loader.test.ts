import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDotenv } from '../../src/core/env-loader.js';

describe('loadDotenv', () => {
  let dir: string;
  let envFile: string;
  const originalCwd = process.cwd();

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'env-loader-'));
    envFile = join(dir, '.env');
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
    for (const k of ['EXPLORE_STAR_TEST_FOO', 'EXPLORE_STAR_TEST_BAR', 'EXPLORE_STAR_TEST_BAZ']) {
      delete process.env[k];
    }
    vi.restoreAllMocks();
  });

  it('loads KEY=VALUE pairs from a .env file', () => {
    writeFileSync(envFile, 'EXPLORE_STAR_TEST_FOO=hello\nEXPLORE_STAR_TEST_BAR=world\n');
    loadDotenv();
    expect(process.env.EXPLORE_STAR_TEST_FOO).toBe('hello');
    expect(process.env.EXPLORE_STAR_TEST_BAR).toBe('world');
  });

  it('strips surrounding double and single quotes from values', () => {
    writeFileSync(envFile, 'EXPLORE_STAR_TEST_FOO="quoted"\nEXPLORE_STAR_TEST_BAR=\'single\'\n');
    loadDotenv();
    expect(process.env.EXPLORE_STAR_TEST_FOO).toBe('quoted');
    expect(process.env.EXPLORE_STAR_TEST_BAR).toBe('single');
  });

  it('skips blank lines and comments', () => {
    writeFileSync(envFile, '# this is a comment\n\nEXPLORE_STAR_TEST_FOO=value\n');
    loadDotenv();
    expect(process.env.EXPLORE_STAR_TEST_FOO).toBe('value');
  });

  it('does not overwrite existing process.env values', () => {
    process.env.EXPLORE_STAR_TEST_FOO = 'preset';
    writeFileSync(envFile, 'EXPLORE_STAR_TEST_FOO=fromfile\n');
    loadDotenv();
    expect(process.env.EXPLORE_STAR_TEST_FOO).toBe('preset');
  });

  it('does not throw when .env file does not exist', () => {
    expect(() => loadDotenv()).not.toThrow();
    expect(process.env.EXPLORE_STAR_TEST_BAZ).toBeUndefined();
  });
});
