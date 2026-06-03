import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';

const REQUIRED_ENV = ['CUSTOM_API_KEY', 'FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_APP_TOKEN', 'FEISHU_TABLE_ID'];
const missingEnv = REQUIRED_ENV.filter(k => !process.env[k]);

const describeE2E = missingEnv.length > 0 ? describe.skip : describe;
const SEP = '═'.repeat(60);

describeE2E('全链路 E2E（真实业务配置）', () => {
  const businessDir = resolve(__dirname, '../../business.example/燃点-FDE');

  beforeAll(() => {
    process.env.CUSTOM_MODEL = process.env.CUSTOM_MODEL || 'mimo-v2.5-pro';
    process.env.CUSTOM_BASE_URL = process.env.CUSTOM_BASE_URL || 'https://token-plan-sgp.xiaomimimo.com/v1';
  });

  afterAll(async () => {
    const { disconnectDouyinChannel } = await import('../../src/adapters/channel/douyin.js');
    await disconnectDouyinChannel();
  });

  it('跟 npx explore-star run 完全一样的流水线', async () => {
    console.log(`\n${SEP}`);
    console.log('🚀 E2E 全链路测试 — 真实业务配置 business.example/燃点-FDE/');
    console.log(`${SEP}\n`);

    console.log('📋 加载业务配置...');
    const { loadBusinessProfile } = await import('../../src/core/business-profile.js');
    const loaded = await loadBusinessProfile(businessDir);
    console.log(`   业务: ${loaded.profile.business.name}`);
    console.log(`   价值: ${loaded.profile.business.value_prop}`);
    console.log(`   LLM:  ${loaded.profile.llm.provider} / ${loaded.profile.llm.model}`);
    console.log(`   CRM:  ${loaded.profile.crm.type}`);
    console.log(`   渠道: ${loaded.channels.source?.mode}`);
    console.log(`   人设: ${loaded.profile.target_personas.map(p => p.name).join(', ')}`);
    console.log(`   关键词: ${Object.keys(loaded.channels.search?.keywords ?? {}).join(', ')}`);
    console.log('');

    console.log('🔌 检查 Adapter...');
    const { registerBuiltins, getLLM, getCRM, getChannel } = await import('../../src/adapters/registry.js');
    await registerBuiltins();

    const llm = getLLM(loaded.profile.llm.provider);
    const llmPing = await llm.ping();
    console.log(`   LLM (mimo):  ${llmPing.ok ? '✅' : '❌'} ${llmPing.latency_ms}ms`);

    const crm = getCRM(loaded.profile.crm.type);
    const crmOk = await crm.ping();
    console.log(`   CRM (飞书):  ${crmOk ? '✅' : '❌'}`);

    const channel = getChannel('douyin');
    const chPing = await channel.ping();
    console.log(`   Channel:     ${chPing.ok ? '✅' : '❌'} loggedIn=${chPing.loggedIn}`);

    if (!chPing.loggedIn) {
      console.log('\n   ⚠️  抖音未登录，请确保 Chrome 已登录且 opencli 扩展已连接');
    }
    console.log('');

    console.log('🏃 执行 runDaily（全真模式，含浏览器操作）...');
    const { runDaily } = await import('../../src/orchestration/run-daily.js');
    const t0 = Date.now();

    const result = await runDaily({
      businessDir,
      dryRun: false,
    });

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    console.log(`\n${SEP}`);
    console.log('📊 流水线结果');
    console.log(`${SEP}`);
    console.log(`   📅 日期:       ${result.date}`);
    console.log(`   🎬 扫描视频:   ${result.videosScanned}`);
    console.log(`   💬 采集评论:   ${result.commentsCollected}`);
    console.log(`   🎯 生成 Lead:  ${result.leadsCreated}`);
    console.log(`   📋 生成任务:   ${result.tasksGenerated}`);
    console.log(`   ⚡ 执行任务:   ${result.tasksExecuted} (read-only 跳过)`);
    console.log(`   ⏱️  耗时:       ${elapsed}s (API ${result.duration_ms}ms)`);
    console.log(`   ❌ 错误:       ${result.errors.length}`);

    if (result.errors.length > 0) {
      console.log('\n   错误:');
      for (const err of result.errors) {
        console.log(`     • ${err}`);
      }
    }

    const { loadState } = await import('../../src/orchestration/state.js');
    const state = await loadState();
    console.log(`\n   State: ${state.completed ? '✅ completed' : '⏳ 未完成'}`);
    for (const step of state.steps) {
      const icon = step.status === 'completed' ? '✅' : step.status === 'failed' ? '❌' : '⏳';
      console.log(`     ${icon} ${step.name}`);
    }

    console.log(`\n${SEP}`);
    console.log('✅ E2E 全链路测试完成');
    console.log(`${SEP}\n`);

    expect(result).toBeDefined();
    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.duration_ms).toBeGreaterThan(0);
    expect(state.completed).toBe(true);
    expect(result.tasksExecuted).toBeGreaterThanOrEqual(0);
  }, 600_000);
});

if (missingEnv.length > 0) {
  describe('E2E（已跳过）', () => {
    it(`缺少: ${missingEnv.join(', ')}`, () => {
      console.log(`\n⚠️  E2E 跳过 — 缺少: ${missingEnv.join(', ')}`);
    });
  });
}
