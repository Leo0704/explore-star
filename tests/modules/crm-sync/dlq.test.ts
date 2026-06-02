/**
 * crm-sync DLQ 消费者单元测试
 *
 * 覆盖：
 *  - 主路径：第一次 retry 全 fail，第二次 retry 全 succeed → 文件被删
 *  - 归档路径：maxRetries 次全 fail → 归档到 _archive + 调 notifier
 *  - dry-run：不删/不归档
 *  - 解析兼容：裸数组格式（手测 echo 创建的）
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { consumeDlq } from '../../../src/modules/crm-sync/dlq.js';
import type { CRMAdapter, Lead, Notifier, NotificationMessage, SendResult, SyncResult } from '../../../src/core/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function mkLead(overrides: Partial<Lead> = {}): Lead {
  return {
    cid: 'c_' + Math.random().toString(36).slice(2, 9),
    source: 'douyin_user_videos',
    aweme_id: 'v1',
    video_url: 'https://...',
    video_desc: 'desc',
    keyword: 'kw',
    nickname: 'Test',
    user_signature: '',
    follower_count: 0,
    user_uid: 'u1',
    comment_text: 'hi',
    comment_digg_count: 0,
    comment_create_time: new Date().toISOString(),
    is_target_persona: true,
    persona: 'self_media',
    pain_point: 'p',
    intent_score: 0.8,
    buying_stage: 'awareness',
    suggested_reply_hook: 'h1',
    suggested_dm_hook: 'h2',
    status: '新发现',
    status_history: [],
    execution_count: 0,
    response_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// Mock CRM: 第 N 次 syncLeads 调用返回什么
class ScriptedCRM implements CRMAdapter {
  callCount = 0;
  /** 每个 call 的结果（按调用顺序消费） */
  script: Array<SyncResult | 'throw'>;

  constructor(script: Array<SyncResult | 'throw'>) {
    this.script = script;
  }

  async syncLeads(leads: Lead[]): Promise<SyncResult> {
    const idx = this.callCount++;
    const step = this.script[Math.min(idx, this.script.length - 1)];
    if (step === 'throw') throw new Error('CRM unavailable');
    return {
      synced: leads.length - step.failed,
      failed: step.failed,
      errors: leads.slice(0, step.failed).map(l => ({ cid: l.cid, error: 'simulated' })),
    };
  }
  async getLead(): Promise<Lead | null> { return null; }
  async updateStatus(): Promise<void> {}
  async listLeads(): Promise<Lead[]> { return []; }
  async ping(): Promise<boolean> { return true; }
}

class SpyNotifier implements Notifier {
  readonly name = 'spy';
  messages: NotificationMessage[] = [];
  async send(message: NotificationMessage): Promise<SendResult> {
    this.messages.push(message);
    return { ok: true, message_id: `spy-${this.messages.length}` };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('crm-sync dlq', () => {
  let tmpDir: string;
  const noSleep = () => Promise.resolve();

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'dlq-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('第一次 retry 都 fail，第二次 retry 全 succeed → 文件被删', async () => {
    const lead1 = mkLead({ cid: 'cid-1', nickname: 'Lead 1' });
    const lead2 = mkLead({ cid: 'cid-2', nickname: 'Lead 2' });

    const fixture = {
      archived_at: new Date().toISOString(),
      report: { total: 2, synced: 0, failed: 2, failedCids: ['cid-1', 'cid-2'], errors: [] },
      leads: [lead1, lead2],
    };
    await writeFile(join(tmpDir, 'crm-sync-2026-06-02.json'), JSON.stringify(fixture, null, 2));

    // 每个 lead 都跑：call 1 fail → call 2 success
    // 2 leads × 2 calls = 4 calls total
    const crm = new ScriptedCRM([
      { synced: 0, failed: 1, errors: [] },   // call 1 (lead1): fail
      { synced: 0, failed: 1, errors: [] },   // call 2 (lead2): fail
      { synced: 1, failed: 0, errors: [] },   // call 3 (lead1): success
      { synced: 1, failed: 0, errors: [] },   // call 4 (lead2): success
    ]);

    const result = await consumeDlq({
      crm,
      failedDir: tmpDir,
      sleep: noSleep,
      notifier: new SpyNotifier(),
    });

    // 2 leads, each retried 2 attempts = 4 total attempts
    expect(crm.callCount).toBe(4);
    expect(result.retried).toBe(4);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.archived).toBe(0);

    // 原始文件被删
    const files = await readdir(tmpDir);
    expect(files.filter(f => f.startsWith('crm-sync-'))).toEqual([]);
    // _archive 不应存在（或为空）
    const archiveFiles = await readdir(join(tmpDir, '_archive')).catch(() => []);
    expect(archiveFiles).toEqual([]);
  });

  it('maxRetries 次仍失败 → 归档到 _archive，调用 notifier', async () => {
    const lead = mkLead({ cid: 'cid-1', nickname: 'Stubborn' });
    const fixture = {
      archived_at: new Date().toISOString(),
      report: { total: 1, synced: 0, failed: 1, failedCids: ['cid-1'], errors: [] },
      leads: [lead],
    };
    await writeFile(join(tmpDir, 'crm-sync-2026-06-02.json'), JSON.stringify(fixture, null, 2));

    // 全部 fail，script 只用第 1 项（数组被 clamp）
    const crm = new ScriptedCRM([{ synced: 0, failed: 1, errors: [] }]);
    const notifier = new SpyNotifier();

    const result = await consumeDlq({
      crm,
      failedDir: tmpDir,
      sleep: noSleep,
      notifier,
      maxRetries: 3,
    });

    // 1 lead × 3 attempts = 3 calls
    expect(crm.callCount).toBe(3);
    expect(result.retried).toBe(3);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.archived).toBe(1);

    // 原文件消失，_archive 里有归档
    const rootFiles = (await readdir(tmpDir)).filter(f => f !== '_archive');
    expect(rootFiles).toEqual([]);
    const archiveFiles = await readdir(join(tmpDir, '_archive'));
    expect(archiveFiles).toHaveLength(1);
    expect(archiveFiles[0]).toMatch(/^crm-sync-2026-06-02-run-1\.json$/);

    // 归档内容
    const archived = JSON.parse(await readFile(join(tmpDir, '_archive', archiveFiles[0]), 'utf-8'));
    expect(archived.leads).toHaveLength(1);
    expect(archived.leads[0].cid).toBe('cid-1');
    expect(archived.leads[0].retry_count).toBe(3);
    expect(archived.source_file).toBe('crm-sync-2026-06-02.json');

    // notifier 被调一次
    expect(notifier.messages).toHaveLength(1);
    expect(notifier.messages[0].level).toBe('critical');
    expect(notifier.messages[0].title).toContain('DLQ');
    expect(notifier.messages[0].body).toContain('cid-1');
  });

  it('dry-run 模式不删文件、不归档、不发告警', async () => {
    const lead = mkLead({ cid: 'cid-1' });
    const fixture = {
      archived_at: new Date().toISOString(),
      report: { total: 1, synced: 0, failed: 1, failedCids: ['cid-1'], errors: [] },
      leads: [lead],
    };
    await writeFile(join(tmpDir, 'crm-sync-2026-06-02.json'), JSON.stringify(fixture, null, 2));

    const crm = new ScriptedCRM([{ synced: 1, failed: 0, errors: [] }]);
    const notifier = new SpyNotifier();

    const result = await consumeDlq({
      crm,
      failedDir: tmpDir,
      sleep: noSleep,
      notifier,
      dryRun: true,
    });

    expect(result.succeeded).toBe(1);
    expect(result.archived).toBe(0);

    // 文件仍在原位
    const files = await readdir(tmpDir);
    expect(files).toContain('crm-sync-2026-06-02.json');
    // notifier 没被调
    expect(notifier.messages).toHaveLength(0);
  });

  it('兼容裸数组格式（手测 echo 创建的）', async () => {
    // 不带 { archived_at, report, leads } 包装，纯数组
    const lead1 = mkLead({ cid: 'cid-1' });
    const lead2 = mkLead({ cid: 'cid-2' });
    await writeFile(join(tmpDir, 'crm-sync-2026-06-02.json'), JSON.stringify([lead1, lead2], null, 2));

    const crm = new ScriptedCRM([
      { synced: 0, failed: 1, errors: [] },
      { synced: 0, failed: 1, errors: [] },
      { synced: 1, failed: 0, errors: [] },
      { synced: 1, failed: 0, errors: [] },
    ]);

    const result = await consumeDlq({
      crm,
      failedDir: tmpDir,
      sleep: noSleep,
      notifier: new SpyNotifier(),
    });

    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    const files = await readdir(tmpDir);
    expect(files.filter(f => f.startsWith('crm-sync-'))).toEqual([]);
  });

  it('无失败文件时直接返回零计数', async () => {
    const crm = new ScriptedCRM([]);
    const result = await consumeDlq({
      crm,
      failedDir: tmpDir,
      sleep: noSleep,
      notifier: new SpyNotifier(),
    });

    expect(result.retried).toBe(0);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.archived).toBe(0);
  });

  it('同一 date 多次归档 → run-{n} 编号递增', async () => {
    // 预置一份 run-1 归档，模拟"二次失败"
    await mkdir(join(tmpDir, '_archive'), { recursive: true });
    await writeFile(
      join(tmpDir, '_archive', 'crm-sync-2026-06-02-run-1.json'),
      JSON.stringify({ archived_at: 'old', leads: [] }),
    );
    // 失败文件
    const lead = mkLead({ cid: 'cid-1' });
    const fixture = {
      archived_at: new Date().toISOString(),
      report: { total: 1, synced: 0, failed: 1, failedCids: ['cid-1'], errors: [] },
      leads: [lead],
    };
    await writeFile(join(tmpDir, 'crm-sync-2026-06-02.json'), JSON.stringify(fixture, null, 2));

    const crm = new ScriptedCRM([{ synced: 0, failed: 1, errors: [] }]);
    const result = await consumeDlq({
      crm,
      failedDir: tmpDir,
      sleep: noSleep,
      notifier: new SpyNotifier(),
    });

    expect(result.archived).toBe(1);
    const archiveFiles = await readdir(join(tmpDir, '_archive'));
    expect(archiveFiles).toContain('crm-sync-2026-06-02-run-1.json');  // 预置的
    expect(archiveFiles).toContain('crm-sync-2026-06-02-run-2.json');  // 新生成的
  });

  it('CRM 抛错也视作本轮失败（被 try/catch 吞掉），下次重试', async () => {
    const lead = mkLead({ cid: 'cid-1' });
    const fixture = {
      archived_at: new Date().toISOString(),
      report: { total: 1, synced: 0, failed: 1, failedCids: ['cid-1'], errors: [] },
      leads: [lead],
    };
    await writeFile(join(tmpDir, 'crm-sync-2026-06-02.json'), JSON.stringify(fixture, null, 2));

    // call 1 throw, call 2 success
    const crm = new ScriptedCRM(['throw', { synced: 1, failed: 0, errors: [] }]);
    const result = await consumeDlq({
      crm,
      failedDir: tmpDir,
      sleep: noSleep,
      notifier: new SpyNotifier(),
    });

    expect(crm.callCount).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    const files = await readdir(tmpDir);
    expect(files.filter(f => f.startsWith('crm-sync-'))).toEqual([]);
  });

  it('解析失败的文件被记到 errors，不中断其他文件', async () => {
    // 第一个文件合法，第二个是乱码
    const lead = mkLead({ cid: 'cid-1' });
    await writeFile(
      join(tmpDir, 'crm-sync-2026-06-01.json'),
      JSON.stringify({ report: {}, leads: [lead] }, null, 2),
    );
    await writeFile(join(tmpDir, 'crm-sync-2026-06-02.json'), '{ not valid json');

    const crm = new ScriptedCRM([{ synced: 1, failed: 0, errors: [] }]);
    const result = await consumeDlq({
      crm,
      failedDir: tmpDir,
      sleep: noSleep,
      notifier: new SpyNotifier(),
    });

    expect(result.succeeded).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('crm-sync-2026-06-02.json');
  });
});
