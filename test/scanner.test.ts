import assert from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { scanDirectory, scanFile } from '../src/scanner.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures');
const sampleTs = path.join(fixtureDir, 'sample.ts');
const samplePy = path.join(fixtureDir, 'sample.py');
const sampleGo = path.join(fixtureDir, 'sample.go');

function getVarNames(filePath: string): string[] {
  return scanFile(filePath).map((usage) => usage.varName);
}

describe('scanFile', () => {
  test('detects process.env.MY_VAR in JS/TS', () => {
    const usages = scanFile(sampleTs);
    const match = usages.find((usage) => usage.varName === 'MY_VAR');

    assert.ok(match);
    assert.strictEqual(match.file, sampleTs);
    assert.strictEqual(match.line, 1);
  });

  test('detects process.env bracket notation', () => {
    assert.ok(getVarNames(sampleTs).includes('BRACKET_VAR'));
  });

  test('detects import.meta.env variables', () => {
    assert.ok(getVarNames(sampleTs).includes('VITE_VAR'));
  });

  test('detects env.MY_VAR patterns', () => {
    assert.ok(getVarNames(sampleTs).includes('GENERIC_VAR'));
  });

  test('ignores variables inside comments', () => {
    const varNames = getVarNames(sampleTs);

    assert.strictEqual(varNames.includes('IGNORED_COMMENT'), false);
    assert.strictEqual(varNames.includes('IGNORED_BLOCK'), false);
    assert.ok(varNames.includes('REAL_VAR'));
  });

  test('ignores variables inside strings that are not actual usages', () => {
    const varNames = getVarNames(sampleTs);

    assert.strictEqual(varNames.includes('IGNORED_STRING'), false);
    assert.strictEqual(varNames.includes('IGNORED_TEMPLATE'), false);
  });

  test('returns an empty array for files with no env usage', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'dead-env-scanner-'));
    const filePath = path.join(tempDir, 'plain.ts');
    writeFileSync(filePath, 'const message = "hello world";\nconst count = 1;\n');

    assert.deepStrictEqual(scanFile(filePath), []);
  });

  test('detects Python env access patterns', () => {
    assert.deepStrictEqual(getVarNames(samplePy), ['DB_HOST', 'SECRET_KEY', 'PORT']);
  });

  test('detects Go env access patterns', () => {
    assert.deepStrictEqual(getVarNames(sampleGo), ['DB_URL', 'API_KEY']);
  });

  test('returns an empty array for unsupported file extensions', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'dead-env-scanner-'));
    const filePath = path.join(tempDir, 'notes.txt');
    writeFileSync(filePath, 'process.env.SHOULD_NOT_MATCH\n');

    assert.deepStrictEqual(scanFile(filePath), []);
  });

  test('returns an empty array when a supported file cannot be read', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'dead-env-scanner-'));
    const filePath = path.join(tempDir, 'missing.ts');

    assert.deepStrictEqual(scanFile(filePath), []);
  });

  test('ignores env references across multiline block comments and escaped strings', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'dead-env-scanner-'));
    const filePath = path.join(tempDir, 'edge.ts');
    writeFileSync(
      filePath,
      [
        '/* process.env.BLOCK_START',
        'still commented process.env.BLOCK_CONTINUED */',
        'const real = process.env.REAL_AFTER_BLOCK;',
        'const escaped = "quoted \\"process.env.ESCAPED_STRING\\"";',
        'const template = `template with ${"process.env.TEMPLATE_LITERAL"}`;',
      ].join('\n'),
    );

    assert.deepStrictEqual(
      scanFile(filePath).map((usage) => usage.varName),
      ['REAL_AFTER_BLOCK'],
    );
  });
});

describe('scanDirectory', () => {
  test('filters scanned files with --lang-compatible language selection', async () => {
    const usages = await scanDirectory(fixtureDir, [], ['py']);

    assert.deepStrictEqual(
      usages.map((usage) => usage.varName),
      ['DB_HOST', 'SECRET_KEY', 'PORT'],
    );
  });

  test('defaults to all supported languages, deduplicates requested languages, and respects excludes', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'dead-env-scan-dir-'));
    const includedDir = path.join(tempDir, 'src');
    const ignoredDir = path.join(tempDir, 'ignored');

    mkdirSync(includedDir, { recursive: true });
    mkdirSync(ignoredDir, { recursive: true });
    writeFileSync(path.join(tempDir, 'app.ts'), 'process.env.APP_LEVEL\n');
    writeFileSync(path.join(tempDir, 'main.py'), 'os.getenv("PY_LEVEL")\n');
    writeFileSync(path.join(tempDir, 'skip.txt'), 'process.env.NOT_CODE\n');
    writeFileSync(path.join(includedDir, 'nested.js'), 'process.env.NESTED_JS\n');
    writeFileSync(path.join(ignoredDir, 'ignored.go'), 'os.Getenv("IGNORED_GO")\n');

    const allUsages = await scanDirectory(tempDir, ['**/ignored/**']);
    const dedupedUsages = await scanDirectory(tempDir, ['**/ignored/**'], ['ts', 'ts', 'js']);

    assert.deepStrictEqual(
      allUsages.map((usage) => usage.varName).sort(),
      ['APP_LEVEL', 'NESTED_JS', 'PY_LEVEL'],
    );
    assert.deepStrictEqual(
      dedupedUsages.map((usage) => usage.varName).sort(),
      ['APP_LEVEL', 'NESTED_JS'],
    );
  });
});
