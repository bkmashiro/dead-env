import assert from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseEnvFile, parseEnvFiles } from '../src/envParser.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sampleEnv = path.join(__dirname, 'fixtures', 'sample.env');

describe('parseEnvFile', () => {
  test('parses simple KEY=VALUE entries', () => {
    const vars = parseEnvFile(sampleEnv);

    assert.strictEqual(vars.get('SIMPLE'), 'value');
  });

  test('parses double-quoted values', () => {
    const vars = parseEnvFile(sampleEnv);

    assert.strictEqual(vars.get('QUOTED'), 'quoted value');
  });

  test('parses single-quoted values', () => {
    const vars = parseEnvFile(sampleEnv);

    assert.strictEqual(vars.get('SINGLE'), 'single quoted');
  });

  test('ignores comment lines', () => {
    const vars = parseEnvFile(sampleEnv);

    assert.strictEqual(vars.has('# comment'), false);
    assert.strictEqual(vars.has('comment'), false);
  });

  test('ignores empty lines', () => {
    const vars = parseEnvFile(sampleEnv);

    assert.strictEqual(vars.size, 5);
  });

  test('handles empty values', () => {
    const vars = parseEnvFile(sampleEnv);

    assert.strictEqual(vars.get('EMPTY'), '');
  });

  test('handles export KEY=VALUE syntax', () => {
    const vars = parseEnvFile(sampleEnv);

    assert.strictEqual(vars.get('EXPORTED'), 'from-export');
  });

  test('returns an empty map when the file does not exist', () => {
    const vars = parseEnvFile(path.join(__dirname, 'fixtures', 'missing.env'));

    assert.deepStrictEqual([...vars.entries()], []);
  });

  test('strips inline comments from unquoted values and skips invalid assignments', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'dead-env-envparser-'));
    const filePath = path.join(tempDir, '.env.inline');

    writeFileSync(
      filePath,
      [
        'WITH_COMMENT=value # remove this',
        'SPACED=  spaced value  # and this',
        'QUOTED_KEEP="value # keep this"',
        'NOT_AN_ENV_LINE',
        '1INVALID=value',
      ].join('\n'),
    );

    const vars = parseEnvFile(filePath);

    assert.strictEqual(vars.get('WITH_COMMENT'), 'value');
    assert.strictEqual(vars.get('SPACED'), 'spaced value');
    assert.strictEqual(vars.get('QUOTED_KEEP'), 'value # keep this');
    assert.strictEqual(vars.has('NOT_AN_ENV_LINE'), false);
    assert.strictEqual(vars.has('1INVALID'), false);
  });
});

describe('parseEnvFiles', () => {
  test('finds env files, parses them, and ignores non-env matches', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'dead-env-envfiles-'));
    mkdirSync(path.join(tempDir, 'config'), { recursive: true });

    writeFileSync(path.join(tempDir, '.env'), 'ROOT_VAR=root\n');
    writeFileSync(path.join(tempDir, '.env.production'), 'PROD_VAR=prod\n');
    writeFileSync(path.join(tempDir, '.env.ts'), 'NOT_ENV_FILE=true\n');
    writeFileSync(path.join(tempDir, 'config', '.env.local'), 'LOCAL_VAR=local\n');

    const envFiles = await parseEnvFiles(tempDir);

    assert.deepStrictEqual(
      envFiles.map((entry) => path.basename(entry.file)).sort(),
      ['.env', '.env.local', '.env.production'],
    );
    assert.strictEqual(envFiles.find((entry) => path.basename(entry.file) === '.env')?.vars.get('ROOT_VAR'), 'root');
    assert.strictEqual(envFiles.find((entry) => path.basename(entry.file) === '.env.local')?.vars.get('LOCAL_VAR'), 'local');
  });

  test('respects the glob pattern and exclude list', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'dead-env-envfiles-ignore-'));
    mkdirSync(path.join(tempDir, 'ignored'), { recursive: true });
    mkdirSync(path.join(tempDir, 'included'), { recursive: true });

    writeFileSync(path.join(tempDir, 'ignored', '.env.dev'), 'IGNORED_VAR=true\n');
    writeFileSync(path.join(tempDir, 'included', '.env.dev'), 'INCLUDED_VAR=true\n');

    const envFiles = await parseEnvFiles(tempDir, '**/.env.dev', ['**/ignored/**']);

    assert.deepStrictEqual(
      envFiles.map((entry) => path.relative(tempDir, entry.file)),
      [path.join('included', '.env.dev')],
    );
  });
});
