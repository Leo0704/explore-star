import { resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  const invoked = pathResolve(fileURLToPath(metaUrl));
  const entry = pathResolve(process.argv[1] ?? '');
  if (invoked === entry) {
    runCLI(process.argv.slice(2)).catch(e => { console.error(e); process.exit(1); });
  }
}
