import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Minimal .env loader — reads KEY=VALUE lines from a .env file at the project root
 * and sets any keys not already defined in process.env. No third-party deps.
 *
 * Lines starting with `#` are comments. Blank lines are skipped. Optional surrounding
 * double or single quotes on values are stripped. Existing process.env values win,
 * so real environment configuration always takes precedence over the file.
 */
export function loadDotenv(path = '.env'): void {
  const fullPath = resolve(process.cwd(), path);
  if (!existsSync(fullPath)) return;

  const text = readFileSync(fullPath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
