import { describe, it, expect } from 'vitest';
import { checkSystemHealth } from '../../src/orchestration/health-check.js';

describe('checkSystemHealth — disk space (Bug 17)', () => {
  it('disk_space check 应有 details.realFreeGb 字段（不是硬编码 10）', async () => {
    const result = await checkSystemHealth();
    const diskCheck = result.checks.find(c => c.name === 'disk_space');
    expect(diskCheck).toBeDefined();

    expect(diskCheck!.details).toBeDefined();
    const realFreeGb = (diskCheck!.details as { realFreeGb?: number }).realFreeGb;
    expect(typeof realFreeGb).toBe('number');

    if (realFreeGb !== 0) {
      expect(realFreeGb).not.toBe(10);
    }
  });

  it('disk_space message 不应包含硬编码的 "10 GB" 字符串', async () => {
    const result = await checkSystemHealth();
    const diskCheck = result.checks.find(c => c.name === 'disk_space');
    expect(diskCheck).toBeDefined();

    const realFreeGb = (diskCheck!.details as { realFreeGb?: number }).realFreeGb;
    if (realFreeGb !== 0) {
      const expectedSubstr = `${realFreeGb.toFixed(2)} GB`;
      expect(diskCheck!.message).toContain(expectedSubstr);
    }
  });
});
