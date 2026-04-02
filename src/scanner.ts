import { readFileSync } from 'fs';
import { glob } from 'glob';

export interface VarUsage {
  varName: string;
  file: string;
  line: number;
}

// Patterns for various languages/runtimes
// Note: Using RegExp constructor to avoid esbuild's regex literal parser
// choking on patterns with unbalanced parens (e.g. \( capturing group \) ).
const VAR_GROUP = '([A-Z_][A-Z0-9_]*)';
const QUOTE = `['"]`;
const CODE_PATTERNS: RegExp[] = [
  // Node.js / JS / TS: process.env.VAR_NAME
  new RegExp(`process\\.env\\.${VAR_GROUP}`, 'g'),
  // Node.js / JS / TS: process.env['VAR_NAME'] or process.env["VAR_NAME"]
  new RegExp(`process\\.env\\[${QUOTE}${VAR_GROUP}${QUOTE}\\]`, 'g'),
  // Python: os.environ.get('VAR') or os.environ.get("VAR")
  new RegExp(`os\\.environ\\.get\\(${QUOTE}${VAR_GROUP}${QUOTE}\\)`, 'g'),
  // Python: os.environ['VAR'] or os.environ["VAR"]
  new RegExp(`os\\.environ\\[${QUOTE}${VAR_GROUP}${QUOTE}\\]`, 'g'),
  // Python: os.getenv('VAR') or os.getenv("VAR")
  new RegExp(`os\\.getenv\\(${QUOTE}${VAR_GROUP}${QUOTE}\\)`, 'g'),
];

// Shell patterns — handled separately with line-level context
const SHELL_PATTERNS: RegExp[] = [
  // ${VAR_NAME}
  new RegExp('\\$\\{([A-Z_][A-Z0-9_]*)\\}', 'g'),
  // $VAR_NAME (2+ chars to avoid $0, $1, etc.)
  new RegExp('\\$([A-Z_][A-Z0-9_]+)', 'g'),
];

// File extensions to scan
const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.java', '.php', '.cs',
  '.sh', '.bash', '.zsh', '.fish',
  '.yml', '.yaml', '.toml', '.json',
  'Makefile', 'Dockerfile',
]);

function isCodeFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  for (const ext of CODE_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  // Bare filenames like Makefile, Dockerfile
  const base = filePath.split('/').pop() ?? '';
  return CODE_EXTENSIONS.has(base);
}

function isShellFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.endsWith('.sh') || lower.endsWith('.bash') ||
    lower.endsWith('.zsh') || lower.endsWith('.fish') ||
    lower.endsWith('Makefile');
}

/**
 * Scan a single file for env var references.
 */
export function scanFile(filePath: string): VarUsage[] {
  const usages: VarUsage[] = [];

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return usages;
  }

  const lines = content.split('\n');

  const patterns = isShellFile(filePath)
    ? [...CODE_PATTERNS, ...SHELL_PATTERNS]
    : CODE_PATTERNS;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx] ?? '';

    for (const pattern of patterns) {
      pattern.lastIndex = 0; // reset stateful regex
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(line)) !== null) {
        const varName = match[1];
        if (varName) {
          usages.push({
            varName,
            file: filePath,
            line: lineIdx + 1,
          });
        }
      }
    }
  }

  return usages;
}

/**
 * Scan all code files under rootDir, returning all env var usages.
 */
export async function scanDirectory(
  rootDir: string,
  excludePatterns: string[] = ['**/node_modules/**', '**/.git/**', '**/dist/**'],
): Promise<VarUsage[]> {
  const files = await glob('**/*', {
    cwd: rootDir,
    absolute: true,
    dot: false,
    ignore: excludePatterns,
    nodir: true,
  });

  const codeFiles = files.filter(isCodeFile);

  const allUsages: VarUsage[] = [];
  for (const file of codeFiles) {
    allUsages.push(...scanFile(file));
  }

  return allUsages;
}
