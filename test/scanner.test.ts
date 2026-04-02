import assert from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
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
});

describe('scanDirectory', () => {
  test('filters scanned files with --lang-compatible language selection', async () => {
    const usages = await scanDirectory(fixtureDir, [], ['py']);

    assert.deepStrictEqual(
      usages.map((usage) => usage.varName),
      ['DB_HOST', 'SECRET_KEY', 'PORT'],
    );
  });
});
