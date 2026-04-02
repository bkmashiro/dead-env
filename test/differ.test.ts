import assert from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { diffEnvFiles, printDiff } from '../src/differ.ts';

describe('diffEnvFiles', () => {
  test('reports keys only in each file, changed values, and shared matches', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'dead-env-differ-'));
    const firstFile = path.join(tempDir, '.env.staging');
    const secondFile = path.join(tempDir, '.env.production');

    writeFileSync(
      firstFile,
      ['API_URL=https://staging.api.com', 'DEBUG_MODE=true', 'SHARED=same', 'LOG_LEVEL=debug'].join('\n'),
      'utf-8',
    );
    writeFileSync(
      secondFile,
      ['API_URL=https://api.com', 'SENTRY_DSN=dsn', 'SHARED=same', 'LOG_LEVEL=error'].join('\n'),
      'utf-8',
    );

    const result = diffEnvFiles(firstFile, secondFile);

    assert.deepStrictEqual(result.onlyInFirst, ['DEBUG_MODE']);
    assert.deepStrictEqual(result.onlyInSecond, ['SENTRY_DSN']);
    assert.deepStrictEqual(result.changed, [
      {
        key: 'API_URL',
        firstValue: 'https://staging.api.com',
        secondValue: 'https://api.com',
      },
      {
        key: 'LOG_LEVEL',
        firstValue: 'debug',
        secondValue: 'error',
      },
    ]);
    assert.strictEqual(result.sharedSameCount, 1);
  });
});

describe('printDiff', () => {
  test('hides values by default', () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.join(' '));
    };

    try {
      printDiff(
        {
          firstFile: '.env.staging',
          secondFile: '.env.production',
          onlyInFirst: ['DEBUG_MODE'],
          onlyInSecond: ['SENTRY_DSN'],
          changed: [{ key: 'API_URL', firstValue: 'a', secondValue: 'b' }],
          sharedSameCount: 12,
        },
        false,
      );
    } finally {
      console.log = originalLog;
    }

    const output = logs.join('\n');
    assert.match(output, /Keys only in \.env\.staging \(1\):/);
    assert.match(output, /DEBUG_MODE/);
    assert.match(output, /Keys in both but different values \(1\):/);
    assert.match(output, /API_URL/);
    assert.doesNotMatch(output, /staging=a/);
    assert.match(output, /Shared keys: 12/);
  });

  test('shows values when requested', () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.join(' '));
    };

    try {
      printDiff(
        {
          firstFile: '.env.staging',
          secondFile: '.env.production',
          onlyInFirst: [],
          onlyInSecond: [],
          changed: [{ key: 'API_URL', firstValue: 'https://staging.api.com', secondValue: 'https://api.com' }],
          sharedSameCount: 0,
        },
        true,
      );
    } finally {
      console.log = originalLog;
    }

    const output = logs.join('\n');
    assert.match(output, /staging=https:\/\/staging\.api\.com/);
    assert.match(output, /prod=https:\/\/api\.com/);
  });
});
