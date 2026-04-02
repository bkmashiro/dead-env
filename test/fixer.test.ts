import assert from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { findMissingExampleVars, fixExampleFile } from '../src/fixer.ts';
import type { VarUsage } from '../src/scanner.ts';

function usage(varName: string): VarUsage {
  return { varName, file: '/repo/src/app.ts', line: 1 };
}

describe('findMissingExampleVars', () => {
  test('returns sorted unique detected vars missing from the example file', () => {
    const missing = findMissingExampleVars(
      [usage('API_URL'), usage('DB_HOST'), usage('API_URL')],
      new Map([['DB_HOST', 'localhost']]),
    );

    assert.deepStrictEqual(missing, ['API_URL']);
  });
});

describe('fixExampleFile', () => {
  test('creates the example file when it does not exist', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'dead-env-fixer-'));
    const exampleFile = path.join(tempDir, '.env.example');

    const result = fixExampleFile(exampleFile, [usage('DB_HOST'), usage('SECRET_KEY')]);

    assert.strictEqual(result.created, true);
    assert.deepStrictEqual(result.added, ['DB_HOST', 'SECRET_KEY']);
    assert.strictEqual(
      readFileSync(exampleFile, 'utf-8'),
      ['# Added by dead-env', 'DB_HOST=', 'SECRET_KEY=', ''].join('\n'),
    );
  });

  test('appends only missing vars to an existing example file', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'dead-env-fixer-'));
    const exampleFile = path.join(tempDir, '.env.example');
    writeFileSync(exampleFile, 'EXISTING=true\nDB_HOST=localhost\n', 'utf-8');

    const result = fixExampleFile(exampleFile, [usage('DB_HOST'), usage('SECRET_KEY')]);

    assert.strictEqual(result.created, false);
    assert.deepStrictEqual(result.added, ['SECRET_KEY']);
    assert.strictEqual(
      readFileSync(exampleFile, 'utf-8'),
      [
        'EXISTING=true',
        'DB_HOST=localhost',
        '',
        '# Added by dead-env',
        'SECRET_KEY=',
        '',
      ].join('\n'),
    );
  });

  test('does not change file contents when no vars are missing', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'dead-env-fixer-'));
    const exampleFile = path.join(tempDir, '.env.example');
    writeFileSync(exampleFile, 'DB_HOST=\n', 'utf-8');

    const before = readFileSync(exampleFile, 'utf-8');
    const result = fixExampleFile(exampleFile, [usage('DB_HOST')]);
    const after = readFileSync(exampleFile, 'utf-8');

    assert.deepStrictEqual(result.added, []);
    assert.strictEqual(after, before);
  });
});
