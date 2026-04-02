import { readFileSync } from 'fs';
import { glob } from 'glob';
import path from 'path';

export interface EnvVarDeclaration {
  value: string;
  line: number;
}

export interface EnvFile {
  file: string;
  vars: Map<string, string>;
  declarations: Map<string, EnvVarDeclaration>;
}

/**
 * Parse a single .env file, returning a map of key -> value.
 * Skips blank lines and comments. Handles quoted values.
 */
export function parseEnvFile(filePath: string): Map<string, string> {
  return parseEnvFileDetailed(filePath).vars;
}

/**
 * Parse a single .env file, returning key -> { value, line } metadata.
 */
export function parseEnvFileDetailed(filePath: string): {
  vars: Map<string, string>;
  declarations: Map<string, EnvVarDeclaration>;
} {
  const vars = new Map<string, string>();
  const declarations = new Map<string, EnvVarDeclaration>();

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return { vars, declarations };
  }

  for (const [lineIdx, rawLine] of content.split('\n').entries()) {
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
    declarations.set(key, { value, line: lineIdx + 1 });
  }

  return { vars, declarations };
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
    if (!/^\.env(\..+)?$/.test(base)) {
      return false;
    }

    return !/\.(?:[cm]?[jt]sx?|py|go)$/i.test(base);
  });

  return envFiles.map((file) => {
    const { vars, declarations } = parseEnvFileDetailed(file);
    return {
      file,
      vars,
      declarations,
    };
  });
}
