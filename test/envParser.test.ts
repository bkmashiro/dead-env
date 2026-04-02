import assert from 'node:assert';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseEnvFile } from '../src/envParser.ts';

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
});
