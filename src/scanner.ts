import { readFileSync } from 'fs';
import { glob } from 'glob';

export interface VarUsage {
  varName: string;
  file: string;
  line: number;
}

export type SupportedLanguage = 'js' | 'ts' | 'py' | 'go';

const LANGUAGE_EXTENSIONS: Record<SupportedLanguage, string[]> = {
  js: ['.js', '.jsx', '.mjs', '.cjs'],
  ts: ['.ts', '.tsx'],
  py: ['.py'],
  go: ['.go'],
};

const ALL_LANGUAGES = Object.keys(LANGUAGE_EXTENSIONS) as SupportedLanguage[];

const VAR_GROUP = '([A-Z_][A-Z0-9_]*)';
const QUOTE = `['"]`;
const JS_TS_PATTERNS: RegExp[] = [
  new RegExp(`process\\.env\\.${VAR_GROUP}`, 'g'),
  new RegExp(`process\\.env\\[${QUOTE}${VAR_GROUP}${QUOTE}\\]`, 'g'),
  new RegExp(`import\\.meta\\.env\\.${VAR_GROUP}`, 'g'),
  new RegExp(`(?<![A-Za-z0-9_.])env\\.${VAR_GROUP}`, 'g'),
];

const PYTHON_PATTERNS: RegExp[] = [
  new RegExp(`os\\.environ\\.get\\(${QUOTE}${VAR_GROUP}${QUOTE}\\)`, 'g'),
  new RegExp(`os\\.environ\\[${QUOTE}${VAR_GROUP}${QUOTE}\\]`, 'g'),
  new RegExp(`os\\.getenv\\(${QUOTE}${VAR_GROUP}${QUOTE}\\)`, 'g'),
];

const GO_PATTERNS: RegExp[] = [
  new RegExp(`os\\.Getenv\\(${QUOTE}${VAR_GROUP}${QUOTE}\\)`, 'g'),
  new RegExp(`os\\.LookupEnv\\(${QUOTE}${VAR_GROUP}${QUOTE}\\)`, 'g'),
];

function normalizeLanguages(languages?: SupportedLanguage[]): SupportedLanguage[] {
  if (!languages || languages.length === 0) {
    return ALL_LANGUAGES;
  }

  return [...new Set(languages)];
}

function getFileLanguage(filePath: string): SupportedLanguage | null {
  const lower = filePath.toLowerCase();

  for (const language of ALL_LANGUAGES) {
    if (LANGUAGE_EXTENSIONS[language].some((ext) => lower.endsWith(ext))) {
      return language;
    }
  }

  return null;
}

function isJsLikeFile(filePath: string): boolean {
  const language = getFileLanguage(filePath);
  return language === 'js' || language === 'ts';
}

function getPatternsForFile(filePath: string): RegExp[] {
  switch (getFileLanguage(filePath)) {
    case 'js':
    case 'ts':
      return JS_TS_PATTERNS;
    case 'py':
      return PYTHON_PATTERNS;
    case 'go':
      return GO_PATTERNS;
    default:
      return [];
  }
}

function getIgnoredRanges(
  line: string,
  filePath: string,
  inBlockComment: boolean,
): { ranges: Array<[number, number]>; inBlockComment: boolean } {
  if (!isJsLikeFile(filePath)) {
    return { ranges: [], inBlockComment };
  }

  const ranges: Array<[number, number]> = [];
  let idx = 0;
  let blockComment = inBlockComment;

  while (idx < line.length) {
    if (blockComment) {
      const endIdx = line.indexOf('*/', idx);
      if (endIdx === -1) {
        ranges.push([idx, line.length]);
        return { ranges, inBlockComment: true };
      }
      ranges.push([idx, endIdx + 2]);
      idx = endIdx + 2;
      blockComment = false;
      continue;
    }

    const char = line[idx];
    const next = line[idx + 1];

    if (char === '/' && next === '/') {
      ranges.push([idx, line.length]);
      break;
    }

    if (char === '/' && next === '*') {
      const endIdx = line.indexOf('*/', idx + 2);
      if (endIdx === -1) {
        ranges.push([idx, line.length]);
        return { ranges, inBlockComment: true };
      }
      ranges.push([idx, endIdx + 2]);
      idx = endIdx + 2;
      continue;
    }

    if (char === '"' || char === '\'' || char === '`') {
      const quote = char;
      const start = idx;
      idx++;

      while (idx < line.length) {
        if (line[idx] === '\\') {
          idx += 2;
          continue;
        }
        if (line[idx] === quote) {
          idx++;
          break;
        }
        idx++;
      }

      ranges.push([start, idx]);
      continue;
    }

    idx++;
  }

  return { ranges, inBlockComment: blockComment };
}

function isIgnored(index: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

/**
 * Scan a single file for env var references.
 */
export function scanFile(filePath: string): VarUsage[] {
  const usages: VarUsage[] = [];
  const patterns = getPatternsForFile(filePath);

  if (patterns.length === 0) {
    return usages;
  }

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return usages;
  }

  const lines = content.split('\n');

  let inBlockComment = false;
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx] ?? '';
    const ignored = getIgnoredRanges(line, filePath, inBlockComment);
    inBlockComment = ignored.inBlockComment;

    for (const pattern of patterns) {
      pattern.lastIndex = 0; // reset stateful regex
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(line)) !== null) {
        if (isIgnored(match.index, ignored.ranges)) {
          continue;
        }

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
  languages?: SupportedLanguage[],
): Promise<VarUsage[]> {
  const files = await glob('**/*', {
    cwd: rootDir,
    absolute: true,
    dot: false,
    ignore: excludePatterns,
    nodir: true,
  });

  const selectedLanguages = normalizeLanguages(languages);
  const codeFiles = files.filter((file) => {
    const language = getFileLanguage(file);
    return language !== null && selectedLanguages.includes(language);
  });

  const allUsages: VarUsage[] = [];
  for (const file of codeFiles) {
    allUsages.push(...scanFile(file));
  }

  return allUsages;
}
