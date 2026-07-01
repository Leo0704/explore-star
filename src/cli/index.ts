#!/usr/bin/env node

const USAGE = `
探星 CLI（Explore-Star v0.1.0）

命令：
  init <name>              复制 business.example/燃点-FDE/ 到 ./<name>/
  doctor                   5 类健康检查（环境/Adapter/限速/紧急停止）
  run                      跑每日主流程（需 --business=<dir>）
  analyze                  单跑意图分析
  nurture                  单跑引导引擎
  convert                  单跑转化引擎（转化日报，--verbose 详细输出）
  insights                 跑反馈分析器（生成 weekly-insights.json）
  reactivate               再激活沉默客户
  watch-bookings           启动预约监听循环
  configure                查看/修改业务配置
  retry-dlq                重试 CRM 同步失败队列（适合 cron）
  status                  查看 run 健康概览（--business 必填，--days / --json 可选）
  web                      启动 Web 仪表盘（默认端口 3827）

全局选项：
  --help, -h               显示帮助
  --business <dir>         业务目录（必填）

示例：
  npx explore-star init my-business
  npx explore-star doctor
  npx explore-star run --business=./my-business --dry-run
  npx explore-star insights --business=./my-business
  npx explore-star reactivate --business=./my-business --cid comment_xxx
`.trim();

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log(USAGE);
    return;
  }

  try {
    switch (cmd) {
      case 'init': {
        const { runCLI } = await import('./init.js');
        await runCLI(rest);
        break;
      }
      case 'doctor': {
        const { runCLI } = await import('./doctor.js');
        await runCLI(rest);
        break;
      }
      case 'run': {
        const { runCLI } = await import('./run.js');
        await runCLI(rest);
        break;
      }
      case 'analyze': {
        const { runCLI } = await import('./analyze.js');
        await runCLI(rest);
        break;
      }
      case 'nurture': {
        const { runCLI } = await import('./nurture.js');
        await runCLI(rest);
        break;
      }
      case 'convert': {
        const { runCLI } = await import('./convert.js');
        await runCLI(rest);
        break;
      }
      case 'insights': {
        const { runCLI } = await import('./insights.js');
        await runCLI(rest);
        break;
      }
      case 'conversion-report': {
        const { runCLI } = await import('./convert.js');
        await runCLI(['--verbose', ...rest]);
        break;
      }
      case 'reactivate': {
        const { runCLI } = await import('./reactivate.js');
        await runCLI(rest);
        break;
      }
      case 'watch-bookings': {
        const { runCLI } = await import('./watch-bookings.js');
        await runCLI(rest);
        break;
      }
      case 'configure': {
        const { runCLI } = await import('./configure.js');
        await runCLI(rest);
        break;
      }
      case 'retry-dlq': {
        const { runCLI } = await import('./retry-dlq.js');
        await runCLI(rest);
        break;
      }
      case 'status': {
        const { runCLI } = await import('./status.js');
        await runCLI(rest);
        break;
      }
      case 'schedule': {
        const { runCLI } = await import('./schedule.js');
        await runCLI(rest);
        break;
      }
      case 'web': {
        await import('../web/server.js');
        break;
      }
      default:
        console.error(`未知命令: ${cmd}`);
        console.log(USAGE);
        process.exit(1);
    }
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

main();