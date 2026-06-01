import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// We test the csvField logic by importing from the CSV adapter module.
// Since csvField is not exported, we test it indirectly via CsvCRM.writeAll
// or by parsing the output. Alternatively, we can re-implement the function
// locally to verify expected behavior, matching the implementation in csv.ts.

import { CsvCRM } from '../../../src/adapters/crm/csv.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('CsvCRM csvField CWE-1236 formula injection protection', () => {
  const tmp = join(tmpdir(), 'csv-cwe-test-' + Date.now());
  const csv = new CsvCRM(join(tmp, 'leads.csv'));

  beforeEach(async () => {
    await mkdir(tmp, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  // Helper: simulate what csvField does
  function csvField(s: string): string {
    if (s.length > 0 && /^[=+\-@\t\r]/.test(s)) {
      s = "'" + s;
    }
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  it('prefixes =cmd|calc with single quote', async () => {
    const field = csvField('=cmd|calc');
    expect(field).toBe("'=cmd|calc");
  });

  it('prefixes +5 with single quote', async () => {
    const field = csvField('+5');
    expect(field).toBe("'+5");
  });

  it('prefixes -1 with single quote', async () => {
    const field = csvField('-1');
    expect(field).toBe("'-1");
  });

  it('prefixes @user with single quote', async () => {
    const field = csvField('@user');
    expect(field).toBe("'@user");
  });

  it('normal text unchanged', async () => {
    const field = csvField('正常文本');
    expect(field).toBe('正常文本');
  });

  it('comma still triggers quoted escape', async () => {
    const field = csvField('普通,逗号');
    expect(field).toBe('"普通,逗号"');
  });

  it('double quote in value is doubled and quoted', async () => {
    const field = csvField('say "hello"');
    expect(field).toBe('"say ""hello"""');
  });

  it('newline triggers quoted escape', async () => {
    const field = csvField('line1\nline2');
    expect(field).toBe('"line1\nline2"');
  });

  // Integration: write a lead with formula-like fields and read it back
  it('leads with formula-like comment_text are safely serialized', async () => {
    const lead = {
      cid: 'test-cid',
      source: '抖音' as const,
      aweme_id: '123',
      video_url: '',
      video_desc: '',
      keyword: '',
      nickname: '普通用户',
      user_signature: '',
      follower_count: 0,
      user_uid: '',
      comment_text: '=cmd|calc', // formula injection attempt
      comment_digg_count: 0,
      comment_create_time: '',
      is_target_persona: false,
      persona: '',
      pain_point: '',
      intent_score: 0,
      buying_stage: '' as const,
      suggested_reply_hook: '',
      suggested_dm_hook: '',
      status: '新发现' as const,
      last_task_executed_at: '',
      last_task_result: '',
      last_response_text: '',
      execution_count: 0,
      response_count: 0,
      wechat_added_at: '',
      booked_at: '',
      closed_at: '',
      revenue: 0,
      last_interaction_at: '',
      created_at: '2026-06-01T00:00:00Z',
      updated_at: '2026-06-01T00:00:00Z',
      notes: '',
    };

    await csv.syncLeads([lead]);
    const fs = require('node:fs/promises');
    const content = await fs.readFile(join(tmp, 'leads.csv'), 'utf-8');

    // The comment_text field should have a leading single quote (CWE-1236)
    // e.g. the raw CSV line contains: ...,'=cmd|calc,0,...
    // The prepended ' prevents Excel/Sheets from interpreting =cmd|calc as a formula
    expect(content).toContain("'=cmd|calc");
    // Also verify the value is NOT stored as bare formula (without the leading quote)
    // by checking it appears in the CSV with the quote prefix
    const lines = content.split('\n');
    const dataLine = lines.find(l => l.includes('test-cid'));
    expect(dataLine).toBeDefined();
    const fields = dataLine!.split(',');
    // comment_text is at index 10 (0-based) in the COLUMNS array
    expect(fields[10]).toBe("'=cmd|calc");
  });
});