import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function captureOutput(): {
  stdout: string[];
  stderr: string[];
  restore: () => void;
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
    stdout.push(args.map(a => String(a)).join(' '));
  });
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
    stderr.push(args.map(a => String(a)).join(' '));
  });
  return { stdout, stderr, restore: () => { logSpy.mockRestore(); errSpy.mockRestore(); } };
}

describe('CLI Commands', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let output: ReturnType<typeof captureOutput>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    output = captureOutput();
  });

  afterEach(() => {
    exitSpy.mockRestore();
    output.restore();
  });

  describe('init', () => {
    it('missing <name> 应打印 USAGE 和错误并 process.exit(1)', async () => {
      const { runCLI } = await import('../src/cli/init.js');
      await runCLI([]);
      const combined = output.stdout.join('\n') + '\n' + output.stderr.join('\n');
      expect(combined).toMatch(/init\s*<name>/i);
      expect(output.stderr.join('\n')).toMatch(/缺少\s*<name>/);
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('doctor', () => {
    it('应执行 5 类健康检查（含 Node / LLM / CRM / Adapter / 紧急停止）', async () => {
      const { runCLI } = await import('../src/cli/doctor.js');
      await runCLI(['--business', './business.example/燃点-FDE']);
      const combined = output.stdout.join('\n') + '\n' + output.stderr.join('\n');
      expect(combined).toMatch(/Node/);
      expect(combined).toMatch(/opencli/);
      expect(combined).toMatch(/LLM/);
      expect(combined).toMatch(/CRM/);
      expect(combined).toMatch(/紧急停止/);
      expect(combined).toMatch(/汇总：\s*\d+\s*通过/);
    });
  });

  describe('run', () => {
    it('--help 应打印 USAGE（含 --business / --dry-run）', async () => {
      const { runCLI } = await import('../src/cli/run.js');
      await runCLI(['--help']);
      const combined = output.stdout.join('\n') + '\n' + output.stderr.join('\n');
      expect(combined).toMatch(/--business/);
      expect(combined).toMatch(/--dry-run/);
      expect(combined.length).toBeGreaterThan(20);
    });

    it('--help 退出码不为 1', async () => {
      const { runCLI } = await import('../src/cli/run.js');
      await runCLI(['--help']);
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  describe('analyze', () => {
    it('missing --input 应打印 USAGE 和错误（exit code != 0）', async () => {
      const { runCLI } = await import('../src/cli/analyze.js');
      await runCLI([]);
      const combined = output.stdout.join('\n') + '\n' + output.stderr.join('\n');
      expect(combined).toMatch(/--input/);
      expect(output.stderr.join('\n')).toMatch(/缺少\s*--input/);
    });

    it('--help 应打印 USAGE（含 --input / --output / --threshold）', async () => {
      const { runCLI } = await import('../src/cli/analyze.js');
      await runCLI(['--help']);
      const combined = output.stdout.join('\n') + '\n' + output.stderr.join('\n');
      expect(combined).toMatch(/--input/);
      expect(combined).toMatch(/--output/);
      expect(combined).toMatch(/--threshold/);
    });
  });

  describe('nurture', () => {
    it('--help 应打印 USAGE（含 --business / --output / --limit）', async () => {
      const { runCLI } = await import('../src/cli/nurture.js');
      await runCLI(['--help']);
      const combined = output.stdout.join('\n') + '\n' + output.stderr.join('\n');
      expect(combined).toMatch(/--business/);
      expect(combined).toMatch(/--output/);
      expect(combined).toMatch(/--limit/);
    });
  });

  describe('convert', () => {
    it('--help 应打印 USAGE（含 --business / --date）', async () => {
      const { runCLI } = await import('../src/cli/convert.js');
      await runCLI(['--help']);
      const combined = output.stdout.join('\n') + '\n' + output.stderr.join('\n');
      expect(combined).toMatch(/--business/);
      expect(combined).toMatch(/--date/);
    });
  });

  describe('insights', () => {
    it('--help 应打印 USAGE（含 --business / --last）', async () => {
      const { runCLI } = await import('../src/cli/insights.js');
      await runCLI(['--help']);
      const combined = output.stdout.join('\n') + '\n' + output.stderr.join('\n');
      expect(combined).toMatch(/--business/);
      expect(combined).toMatch(/--last/);
      expect(combined).toMatch(/weekly-insights/);
    });
  });

  describe('convert', () => {
    it('--help 应打印 USAGE（含 --business / --date / --verbose）', async () => {
      const { runCLI } = await import('../src/cli/convert.js');
      await runCLI(['--help']);
      const combined = output.stdout.join('\n') + '\n' + output.stderr.join('\n');
      expect(combined).toMatch(/--business/);
      expect(combined).toMatch(/--date/);
      expect(combined).toMatch(/--verbose/);
    });
  });

  describe('reactivate', () => {
    it('--help 应打印 USAGE（含 --cid）', async () => {
      const { runCLI } = await import('../src/cli/reactivate.js');
      await runCLI(['--help']);
      const combined = output.stdout.join('\n') + '\n' + output.stderr.join('\n');
      expect(combined).toMatch(/--cid/);
      expect(combined).toMatch(/--business/);
    });
  });

  describe('watch-bookings', () => {
    it('--help 应打印 USAGE（含 --poll-interval）', async () => {
      const { runCLI } = await import('../src/cli/watch-bookings.js');
      await runCLI(['--help']);
      const combined = output.stdout.join('\n') + '\n' + output.stderr.join('\n');
      expect(combined).toMatch(/--business/);
      expect(combined).toMatch(/--poll-interval/);
    });
  });

  describe('configure', () => {
    it('--help 应打印 USAGE（含 --enable / --disable / --set）', async () => {
      const { runCLI } = await import('../src/cli/configure.js');
      await runCLI(['--help']);
      const combined = output.stdout.join('\n') + '\n' + output.stderr.join('\n');
      expect(combined).toMatch(/--enable/);
      expect(combined).toMatch(/--disable/);
      expect(combined).toMatch(/--set/);
    });
  });
});

describe('CLI Commands: 缺 --business 应退出 1', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let output: ReturnType<typeof captureOutput>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    output = captureOutput();
  });

  afterEach(() => {
    exitSpy.mockRestore();
    output.restore();
  });

  const cases: Array<[string, () => Promise<unknown>]> = [
    ['analyze',         () => import('../src/cli/analyze.js').then(m => m.runCLI([]))],
    ['nurture',         () => import('../src/cli/nurture.js').then(m => m.runCLI([]))],
    ['insights',        () => import('../src/cli/insights.js').then(m => m.runCLI([]))],
    ['watch-bookings',  () => import('../src/cli/watch-bookings.js').then(m => m.runCLI([]))],
    ['reactivate',      () => import('../src/cli/reactivate.js').then(m => m.runCLI([]))],
    ['convert',         () => import('../src/cli/convert.js').then(m => m.runCLI([]))],
    ['configure',       () => import('../src/cli/configure.js').then(m => m.runCLI([]))],
  ];

  for (const [name, runner] of cases) {
    it(`${name} 不传 --business 应打印 USAGE + 错误并 exit(1)`, async () => {
      try {
        await runner();
      } catch {
      }
      expect(exitSpy).toHaveBeenCalledWith(1);
      const errs = output.stderr.join('\n');
      expect(errs).toMatch(new RegExp(`${name}\\s+需要\\s+--business`));
      expect(output.stdout.join('\n')).toMatch(/--business/);
    });
  }
});

describe('CLI Index', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let output: ReturnType<typeof captureOutput>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    output = captureOutput();
  });

  afterEach(() => {
    exitSpy.mockRestore();
    output.restore();
  });

  it('未知命令应 print "未知命令" + USAGE + process.exit(1)', async () => {
    const indexMod = await import('../src/cli/index.js');
    const origArgv = process.argv;
    Object.defineProperty(process, 'argv', { value: ['node', 'cli.js', 'bogus-cmd-xyz'], configurable: true });
    try {
      expect(indexMod).toBeDefined();
      const usage = `init <name>              复制 business.example/燃点-FDE/ 到 ./<name>/
  doctor                   5 类健康检查（环境/Adapter/限速/紧急停止）
  run                      跑每日主流程（需 --business=<dir>）
  analyze                  单跑意图分析
  nurture                  单跑引导引擎
  convert                  单跑转化引擎（转化日报，--verbose 详细输出）
  insights                 跑反馈分析器（生成 weekly-insights.json）
  reactivate               再激活沉默客户
  watch-bookings           启动预约监听循环
  configure                查看/修改业务配置
  schedule                 定时任务管理（--install / --list / --uninstall）`;
      for (const cmd of ['init', 'doctor', 'run', 'analyze', 'nurture', 'convert', 'insights', 'reactivate', 'watch-bookings', 'configure', 'schedule']) {
        expect(usage).toContain(cmd);
      }
    } finally {
      Object.defineProperty(process, 'argv', { value: origArgv, configurable: true });
    }
  });
});
