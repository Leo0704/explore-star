/**
 * health-check.ts 单元测试
 *
 * Bug 17：checkSystemHealth 之前把磁盘空间硬编码为 10GB，永远是 ok。
 * 修复后应使用 statfs（node:fs）读真实剩余空间（Node 18.15+）。
 * 如果 statfs 不可用，realFreeGb 应为 0（fail-loud），而不是伪造 10。
 */

import { describe, it, expect } from 'vitest';
import { checkSystemHealth } from '../../src/orchestration/health-check.js';

describe('checkSystemHealth — disk space (Bug 17)', () => {
  it('disk_space check 应有 details.realFreeGb 字段（不是硬编码 10）', async () => {
    const result = await checkSystemHealth();
    const diskCheck = result.checks.find(c => c.name === 'disk_space');
    expect(diskCheck).toBeDefined();

    // 修复后应输出 details.realFreeGb（来自 statfs）
    expect(diskCheck!.details).toBeDefined();
    const realFreeGb = (diskCheck!.details as { realFreeGb?: number }).realFreeGb;
    expect(typeof realFreeGb).toBe('number');

    // 如果 statfs 不可用，realFreeGb 应为 0（fail-loud）
    // 如果 statfs 可用，应是真实数字，且不应等于硬编码的 10
    // （真实环境恰好 10GB 的概率极小，作为可接受的环境假阳性）
    if (realFreeGb !== 0) {
      expect(realFreeGb).not.toBe(10);
    }
  });

  it('disk_space message 不应包含硬编码的 "10 GB" 字符串', async () => {
    // 修复前：message 永远是 "磁盘空间充足（10 GB 可用）"
    // 修复后：message 应包含真实数字（statfs 读到的）
    // 唯一可接受的 "10 GB" 情况：真实磁盘剩余恰好 ≈ 10GB
    const result = await checkSystemHealth();
    const diskCheck = result.checks.find(c => c.name === 'disk_space');
    expect(diskCheck).toBeDefined();

    // 关键：message 里不能是硬编码的 "(10 GB)" 模式
    // 用 details.realFreeGb 来验证它与 message 中数字是否一致
    const realFreeGb = (diskCheck!.details as { realFreeGb?: number }).realFreeGb;
    if (realFreeGb !== 0) {
      // 真实数字应出现在 message 中
      const expectedSubstr = `${realFreeGb.toFixed(2)} GB`;
      expect(diskCheck!.message).toContain(expectedSubstr);
    }
  });
});
