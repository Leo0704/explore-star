/**
 * CLI 子命令共享工具
 */

export function extractFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

export function showUsage(usage: string, args: string[]): boolean {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage);
    return true;
  }
  return false;
}

export function selfInvoke(metaUrl: string, runCLI: (args: string[]) => Promise<void>): void {
  // metaUrl 必须是 *调用方* 模块的 import.meta.url，不能是 helper 自己模块的。
  // 因为 selfInvoke 写在 _shared.ts 里，函数内部的 import.meta.url 永远指向 _shared.js，
  // 而 process.argv[1] 是入口脚本（status.js 等），二者永远不匹配 → 原本的写法 selfInvoke
  // 永远不 fire。
  if (metaUrl === `file://${process.argv[1]}`) {
    runCLI(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
  }
}
