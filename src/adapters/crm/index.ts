import { CsvCRM } from './csv.js';
import { FeishuCRM } from './feishu.js';
import { registerCRM, listCRMs } from '../registry.js';
import { logger } from '../../core/logger.js';

const log = logger.child({ module: 'adapters/crm' });

export function registerAll(): void {
  registerCRM('csv', new CsvCRM('./data/leads.csv'));

  if (process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET && process.env.FEISHU_APP_TOKEN && process.env.FEISHU_TABLE_ID) {
    registerCRM('feishu', new FeishuCRM({
      appToken: process.env.FEISHU_APP_TOKEN,
      tableId: process.env.FEISHU_TABLE_ID,
      appIdEnv: 'FEISHU_APP_ID',
      appSecretEnv: 'FEISHU_APP_SECRET',
      fieldMapping: {
        cid: 'cid',
        nickname: '抖音昵称',
        comment_text: '评论原文',
        video_url: '视频链接',
        video_desc: '视频标题',
        keyword: '来源关键词',
        pain_point: '痛点',
        persona: '人设',
        intent_score: '意向分',
        buying_stage: '购买阶段',
        suggested_reply_hook: '钩子_评论用',
        suggested_dm_hook: '钩子_私信用',
        status: '状态',
        created_at: '创建时间',
      },
    }));
  }

  log.info({ crms: listCRMs() }, '已注册 CRM');
}

export { CsvCRM } from './csv.js';
export { FeishuCRM } from './feishu.js';
export type { CrmConfig } from './feishu.js';
