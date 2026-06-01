/**
 * CRM Adapters 索引
 */
import { CsvCRM } from './csv.js';
import { registerCRM, listCRMs } from '../registry.js';
export function registerAll() {
    // CSV：始终注册（开发/调试零配置）
    registerCRM('csv', new CsvCRM('./data/leads.csv'));
    // 飞书：仅在环境变量存在时注册
    if (process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET) {
        // 注意：业务方应在 business/crm.yaml 配置具体 table_id + field_mapping
        // V1.4: 这里不直接注册实例，由 run-daily.ts 按 crm.yaml 动态创建
    }
    // Notion
    if (process.env.NOTION_API_KEY) {
        // V2: 按 crm.yaml 配置动态创建实例
    }
    // Airtable
    if (process.env.AIRTABLE_API_KEY && process.env.AIRTABLE_BASE_ID) {
        // V2: 按 crm.yaml 配置动态创建实例
    }
    console.log(`[adapters/crm] 已注册：${listCRMs().join(', ')}`);
}
export { CsvCRM } from './csv.js';
export { FeishuCRM } from './feishu.js';
export { NotionCRM } from './notion.js';
export { AirtableCRM } from './airtable.js';
//# sourceMappingURL=index.js.map