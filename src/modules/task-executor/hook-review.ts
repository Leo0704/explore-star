import type { Task } from '../../core/types.js';
import { generateReviewNote } from './hook-review-helper.js';
import { logger } from '../../core/logger.js';

const log = logger.child({ module: 'hook-review' });

export interface HookReviewResult {
  approved: boolean;
  modified_hook?: string;
  reason?: string;
}

export interface HookReviewConfig {
  enabled: boolean;
  timeoutSeconds?: number;
  tableId?: string;
  appIdEnv?: string;
  appSecretEnv?: string;
  baseUrl?: string;
}

const REVIEW_FIELDS = {
  taskId: 'task_id',
  leadCid: 'lead_cid',
  nickname: 'nickname',
  currentState: 'current_state',
  action: 'action',
  hook: 'hook',
  hookStyle: 'hook_style',
  scheduledAt: 'scheduled_at',
  reviewStatus: '审核',
  reviewModifiedHook: '修改后话术',
  reviewNote: '审核备注',
  createdAt: '创建时间',
} as const;

interface ReviewClientConfig {
  tableId: string;
  appIdEnv: string;
  appSecretEnv: string;
  baseUrl: string;
}

class FeishuReviewClient {
  private tokenCache?: { token: string; expiresAt: number };

  constructor(private readonly cfg: ReviewClientConfig) {}

  private async getToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 60_000) {
      return this.tokenCache.token;
    }
    const appId = process.env[this.cfg.appIdEnv];
    const appSecret = process.env[this.cfg.appSecretEnv];
    if (!appId || !appSecret) {
      throw new Error(`缺少环境变量 ${this.cfg.appIdEnv} 或 ${this.cfg.appSecretEnv}`);
    }
    const res = await fetch(`${this.cfg.baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    if (!res.ok) throw new Error(`飞书 token API ${res.status}`);
    const json = (await res.json()) as { tenant_access_token: string; expire: number };
    this.tokenCache = {
      token: json.tenant_access_token,
      expiresAt: Date.now() + json.expire * 1000,
    };
    return json.tenant_access_token;
  }

  async findRecordByTaskId(taskId: string): Promise<{ recordId: string; reviewStatus: string; modifiedHook: string } | null> {
    const token = await this.getToken();
    const url = `${this.cfg.baseUrl}/open-apis/bitable/v1/apps/${this.cfg.tableId}/records?field_name=${REVIEW_FIELDS.taskId}&field_value=${encodeURIComponent(taskId)}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { items?: Array<{ record_id: string; fields: Record<string, unknown> }> } };
    const item = json.data?.items?.[0];
    if (!item) return null;
    return {
      recordId: item.record_id,
      reviewStatus: String(item.fields[REVIEW_FIELDS.reviewStatus] ?? ''),
      modifiedHook: String(item.fields[REVIEW_FIELDS.reviewModifiedHook] ?? ''),
    };
  }

  async createReviewRecord(task: Task): Promise<{ recordId: string }> {
    const token = await this.getToken();
    const fields: Record<string, unknown> = {
      [REVIEW_FIELDS.taskId]: task.task_id,
      [REVIEW_FIELDS.leadCid]: task.lead_cid,
      [REVIEW_FIELDS.nickname]: task.nickname,
      [REVIEW_FIELDS.currentState]: task.current_state,
      [REVIEW_FIELDS.action]: task.next_action,
      [REVIEW_FIELDS.hook]: task.hook,
      [REVIEW_FIELDS.hookStyle]: task.hook_style,
      [REVIEW_FIELDS.scheduledAt]: task.scheduled_at,
      [REVIEW_FIELDS.createdAt]: new Date().toISOString(),
      [REVIEW_FIELDS.reviewNote]: generateReviewNote(task),
    };
    const res = await fetch(`${this.cfg.baseUrl}/open-apis/bitable/v1/apps/${this.cfg.tableId}/records`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ records: [{ fields }] }),
    });
    if (!res.ok) {
      throw new Error(`飞书创建审核记录失败 ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as { data?: { records?: Array<{ record_id: string }> } };
    const recordId = json.data?.records?.[0]?.record_id;
    if (!recordId) throw new Error('飞书创建审核记录无 record_id');
    return { recordId };
  }
}

export async function reviewHook(
  task: Task,
  config: HookReviewConfig = { enabled: false }
): Promise<HookReviewResult> {
  if (!config.enabled) {
    return { approved: true };
  }

  const tableId = config.tableId ?? process.env.FEISHU_REVIEW_TABLE_ID;
  const appIdEnv = config.appIdEnv ?? 'FEISHU_APP_ID';
  const appSecretEnv = config.appSecretEnv ?? 'FEISHU_APP_SECRET';
  if (!tableId || !process.env[appIdEnv] || !process.env[appSecretEnv]) {
    log.warn({ appIdEnv, appSecretEnv }, '飞书凭证缺失，降级为直接批准');
    return { approved: true };
  }

  const client = new FeishuReviewClient({
    tableId,
    appIdEnv,
    appSecretEnv,
    baseUrl: config.baseUrl ?? 'https://open.feishu.cn',
  });

  let record: Awaited<ReturnType<FeishuReviewClient['findRecordByTaskId']>>;
  try {
    record = await client.findRecordByTaskId(task.task_id);
    if (!record) {
      await client.createReviewRecord(task);
      record = await client.findRecordByTaskId(task.task_id);
    }
  } catch (e) {
    return {
      approved: false,
      reason: `飞书审核记录创建失败：${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (!record) {
    return { approved: false, reason: '飞书审核记录不存在' };
  }

  const timeoutMs = (config.timeoutSeconds ?? 60) * 1000;
  const pollIntervalMs = 5000;
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const status = record.reviewStatus.trim();
    if (status === '批准' || status === 'approve' || status === 'approved') {
      return { approved: true };
    }
    if (status === '修改' || status === 'modify' || status === 'modified') {
      return {
        approved: true,
        modified_hook: record.modifiedHook || task.hook,
      };
    }
    if (status === '跳过' || status === 'skip' || status === 'skipped' || status === '拒绝' || status === 'reject' || status === 'rejected') {
      return { approved: false, reason: '人工跳过/拒绝' };
    }
    await new Promise(r => setTimeout(r, pollIntervalMs));
    try {
      const next = await client.findRecordByTaskId(task.task_id);
      if (!next) {
        return { approved: false, reason: '飞书审核记录丢失' };
      }
      record = next;
    } catch {
    }
  }

  return { approved: false, reason: '审核超时' };
}

