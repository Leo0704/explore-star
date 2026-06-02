#!/usr/bin/env node
/**
 * 探星 CLI 入口
 *
 * 命令：
 *   explore-star init <name>              —— 复制 business.example
 *   explore-star doctor                  —— 5 类健康检查
 *   explore-star run --business=<dir>    —— 跑主流程
 *   explore-star analyze                 —— 单跑意图分析
 *   explore-star nurture                 —— 单跑引导引擎
 *   explore-star convert                 —— 单跑转化引擎
 *   explore-star insights                —— 跑反馈分析器
 *   explore-star reactivate              —— 再激活沉默客户
 *   explore-star watch-bookings          —— 监听预约
 *   explore-star configure               —— 修改业务配置
 */

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

全局选项：
  --help, -h               显示帮助
  --business <dir>         业务目录（默认 ./business.example/燃点-FDE）

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
        // 兼容旧命令：转发到 convert --verbose
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