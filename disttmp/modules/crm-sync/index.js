/**
 * CRM 同步模块（§3.5）
 *
 * 从 Lead[] 调 CRMAdapter.syncLeads，错误归档到 data/failed/
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
// ---------------------------------------------------------------------------
// CRM 同步主函数
// ---------------------------------------------------------------------------
export async function syncLeads(crm, leads, opts = {}) {
    const failedDir = opts.failedDir ?? 'data/failed';
    const failedPrefix = opts.failedPrefix ?? 'crm-sync';
    if (leads.length === 0) {
        return { total: 0, synced: 0, failed: 0, failedCids: [], errors: [] };
    }
    let result;
    try {
        result = await crm.syncLeads(leads);
    }
    catch (err) {
        // CRM 调用直接失败，全部归档
        const errorMsg = err instanceof Error ? err.message : String(err);
        const report = {
            total: leads.length,
            synced: 0,
            failed: leads.length,
            failedCids: leads.map(l => l.cid),
            errors: leads.map(l => ({ cid: l.cid, error: errorMsg })),
        };
        await archiveFailedLeads(failedDir, failedPrefix, report, leads);
        return report;
    }
    const report = {
        total: leads.length,
        synced: result.synced,
        failed: result.failed,
        failedCids: result.errors.map(e => e.cid),
        errors: result.errors,
    };
    // 归档失败记录
    if (result.failed > 0) {
        const failedLeads = leads.filter(l => result.errors.some(e => e.cid === l.cid));
        await archiveFailedLeads(failedDir, failedPrefix, report, failedLeads);
    }
    return report;
}
// ---------------------------------------------------------------------------
// 失败归档
// ---------------------------------------------------------------------------
async function archiveFailedLeads(failedDir, failedPrefix, report, leads) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const date = timestamp.split('T')[0];
    const fileName = `${failedPrefix}-${date}.json`;
    const filePath = join(failedDir, fileName);
    await mkdir(dirname(filePath), { recursive: true });
    const archive = {
        archived_at: new Date().toISOString(),
        report,
        leads,
    };
    await writeFile(filePath, JSON.stringify(archive, null, 2), 'utf-8');
    console.log(`[crm-sync] 归档 ${report.failed} 条失败记录 → ${filePath}`);
}
// ---------------------------------------------------------------------------
// CLI 入口
// ---------------------------------------------------------------------------
export async function runCLI(args) {
    const get = (flag) => {
        const i = args.indexOf(flag);
        return i >= 0 ? args[i + 1] : undefined;
    };
    const crmType = get('--crm') || 'csv';
    const crmConfigPath = get('--crm-config') || 'business.example/燃点-FDE/crm.yaml';
    const inputPath = get('--input') || 'data/tmp/leads.json';
    const outputPath = get('--output') || 'data/tmp/sync-report.json';
    const { readFile, writeFile, mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    // 读取输入
    const inputRaw = await readFile(inputPath, 'utf-8');
    const leads = JSON.parse(inputRaw);
    // 创建 CRM adapter
    const crm = await createCrmAdapter(crmType, crmConfigPath);
    // 同步
    const report = await syncLeads(crm, leads);
    // 输出报告
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`[crm-sync] 同步完成：${report.synced}/${report.total} 成功`);
}
// ---------------------------------------------------------------------------
// CRM Adapter 工厂（支持多类型）
// ---------------------------------------------------------------------------
async function createCrmAdapter(type, configPath) {
    switch (type) {
        case 'csv': {
            const { CsvCRM } = await import('../../adapters/crm/csv.js');
            return new CsvCRM(configPath);
        }
        case 'feishu': {
            const { FeishuCRM } = await import('../../adapters/crm/feishu.js');
            const configRaw = await readFile(configPath, 'utf-8');
            const config = JSON.parse(configRaw);
            return new FeishuCRM(config);
        }
        default:
            throw new Error(`不支持的 CRM 类型: ${type}`);
    }
}
if (import.meta.url === `file://${process.argv[1]}`) {
    runCLI(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
}
//# sourceMappingURL=index.js.map