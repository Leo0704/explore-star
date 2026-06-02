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

export function selfInvoke(runCLI: (args: string[]) => Promise<void>): void {
  if (import.meta.url === `file://${process.argv[1]}`) {
    runCLI(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
  }
}
