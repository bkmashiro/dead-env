import { readFileSync } from 'fs';
import { glob } from 'glob';
import path from 'path';

export interface EnvFile {
  file: string;
  vars: Map<string, string>;
}

/**
 * Parse a single .env file, returning a map of key -> value.
 * Skips blank lines and comments. Handles quoted values.
 */
export function parseEnvFile(filePath: string): Map<string, string> {
  const vars = new Map<string, string>();

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return vars;
  }

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();

    // Skip blank lines and comments
    if (!line || line.startsWith('#')) continue;

    // Match KEY=value (with optional export prefix)
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)/);
    if (!match) continue;

    const key = match[1] as string;
    let value = (match[2] ?? '').trim();

    // Strip inline comments (but only outside quotes)
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      // Strip inline comment for unquoted values
      const commentIdx = value.indexOf(' #');
      if (commentIdx !== -1) {
        value = value.slice(0, commentIdx).trim();
      }
    }

    vars.set(key, value);
  }

  return vars;
}

/**
 * Find and parse all .env* files matching the given glob pattern under rootDir.
 */
export async function parseEnvFiles(
  rootDir: string,
  pattern: string = '**/.env*',
  excludePatterns: string[] = ['**/node_modules/**', '**/.git/**', '**/dist/**'],
): Promise<EnvFile[]> {
  const files = await glob(pattern, {
    cwd: rootDir,
    absolute: true,
    dot: true,
    ignore: excludePatterns,
    nodir: true,
  });

  // Filter to only real .env files (not .ts, .js, etc. that happen to match)
  const envFiles = files.filter((f) => {
    const base = path.basename(f);
    // Match .env, .env.production, .env.local, .env.example, etc.
    return /^\.env(\..+)?$/.test(base);
  });

  return envFiles.map((file) => ({
    file,
    vars: parseEnvFile(file),
  }));
}
