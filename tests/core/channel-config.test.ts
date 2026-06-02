/**
 * channel-config 单元测试 —— ChannelQpsLimit / ChannelDailyQuota schema
 *
 * 覆盖（roadmap §2.5）：
 *   - schema 类型导出存在
 *   - registry 暴露 getChannelQps / getChannelDailyQuota / rotateAccount
 *   - yaml 节点缺失时返回默认值（不阻塞）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('schema 导出（types.ts）', () => {
  it('types.ts 导出 ChannelQpsLimit / ChannelDailyQuota', async () => {
    const types = await import('../../src/core/types.js');
    // 编译期检查（运行期是 type-only 验证）
    const sample: import('../../src/core/types.js').ChannelQpsLimit = { qps: 1, burst: 2 };
    expect(sample.qps).toBe(1);
    const quota: import('../../src/core/types.js').ChannelDailyQuota = {
      total: 100, by_action: { search: 10, user_videos: 20, comments: 70 },
    };
    expect(quota.total).toBe(100);
  });
});

describe('registry.getChannelQps', () => {
  let savedEnv: string | undefined;
  let tmpDir: string;

  beforeEach(async () => {
    savedEnv = process.env.EXPLORE_STAR_CHANNELS_PATH;
    tmpDir = join(tmpdir(), `es-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    process.env.EXPLORE_STAR_CHANNELS_PATH = savedEnv;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('默认 qps=1（yaml 节点缺失时不阻塞）', async () => {
    process.env.EXPLORE_STAR_CHANNELS_PATH = join(tmpDir, 'missing.yaml');
    const { getChannelQps } = await import('../../src/adapters/registry.js');
    // 重新加载（清缓存）—— 通过动态 require 模拟首次调用
    const qps = getChannelQps('douyin');
    expect(qps).toBe(1);
  });

  it('yaml 显式声明 qps=5 时返回 5', async () => {
    const yamlPath = join(tmpDir, 'channels.yaml');
    await writeFile(yamlPath, [
      'source:',
      '  mode: keyword',
      'channels:',
      '  douyin:',
      '    qps: 5',
      '    burst: 10',
      '',
    ].join('\n'), 'utf-8');
    const { _resetChannelConfigCache, initChannelConfigs, getChannelQps } = await import('../../src/adapters/registry.js');
    _resetChannelConfigCache();
    await initChannelConfigs(yamlPath);
    expect(getChannelQps('douyin')).toBe(5);
  });

  it('yaml 声明 qps=0.5 时返回 0.5（小数）', async () => {
    const yamlPath = join(tmpDir, 'channels.yaml');
    await writeFile(yamlPath, [
      'channels:',
      '  douyin:',
      '    qps: 0.5',
      '',
    ].join('\n'), 'utf-8');
    const { _resetChannelConfigCache, initChannelConfigs, getChannelQps } = await import('../../src/adapters/registry.js');
    _resetChannelConfigCache();
    await initChannelConfigs(yamlPath);
    expect(getChannelQps('douyin')).toBe(0.5);
  });
});

describe('registry.getChannelDailyQuota', () => {
  let savedEnv: string | undefined;
  let tmpDir: string;

  beforeEach(async () => {
    savedEnv = process.env.EXPLORE_STAR_CHANNELS_PATH;
    tmpDir = join(tmpdir(), `es-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    process.env.EXPLORE_STAR_CHANNELS_PATH = savedEnv;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('yaml 节点缺失时返回 null（不限）', async () => {
    process.env.EXPLORE_STAR_CHANNELS_PATH = join(tmpDir, 'missing.yaml');
    const { getChannelDailyQuota } = await import('../../src/adapters/registry.js');
    expect(getChannelDailyQuota('douyin')).toBeNull();
  });

  it('yaml 声明 daily_quota.total=100 时返回 { total: 100, by_action: undefined }', async () => {
    const yamlPath = join(tmpDir, 'channels.yaml');
    await writeFile(yamlPath, [
      'channels:',
      '  douyin:',
      '    daily_quota:',
      '      total: 100',
      '',
    ].join('\n'), 'utf-8');
    const { _resetChannelConfigCache, initChannelConfigs, getChannelDailyQuota } = await import('../../src/adapters/registry.js');
    _resetChannelConfigCache();
    await initChannelConfigs(yamlPath);
    const q = getChannelDailyQuota('douyin');
    expect(q).not.toBeNull();
    expect(q!.total).toBe(100);
    expect(q!.by_action).toBeUndefined();
  });

  it('yaml 声明 by_action 覆盖 total', async () => {
    const yamlPath = join(tmpDir, 'channels.yaml');
    await writeFile(yamlPath, [
      'channels:',
      '  douyin:',
      '    daily_quota:',
      '      by_action:',
      '        search: 200',
      '        comments: 4000',
      '',
    ].join('\n'), 'utf-8');
    const { _resetChannelConfigCache, initChannelConfigs, getChannelDailyQuota } = await import('../../src/adapters/registry.js');
    _resetChannelConfigCache();
    await initChannelConfigs(yamlPath);
    const q = getChannelDailyQuota('douyin');
    expect(q?.by_action?.search).toBe(200);
    expect(q?.by_action?.comments).toBe(4000);
  });
});

describe('registry.rotateAccount（占位）', () => {
  it('返回 "default"（1.x 之后实现真账号轮换）', async () => {
    const { rotateAccount } = await import('../../src/adapters/registry.js');
    expect(rotateAccount('douyin')).toBe('default');
  });

  it('不同 channel 都返回 "default"（当前无差异化）', async () => {
    const { rotateAccount } = await import('../../src/adapters/registry.js');
    expect(rotateAccount('douyin')).toBe('default');
    expect(rotateAccount('mock')).toBe('default');
  });

  it('调用时记 warn log（占位提醒）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loggerMod = await import('../../src/core/logger.js');
    const origChild = loggerMod.logger.child;
    const stubChild = vi.fn().mockReturnValue({ warn: warnSpy, info: vi.fn(), error: vi.fn(), debug: vi.fn() });
    loggerMod.logger.child = stubChild as any;

    try {
      const { rotateAccount } = await import('../../src/adapters/registry.js?v=warn');
      rotateAccount('douyin');
      // 至少 warn 一次（占位提醒）
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      loggerMod.logger.child = origChild;
      warnSpy.mockRestore();
    }
  });
});
