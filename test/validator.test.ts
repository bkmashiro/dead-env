import assert from 'node:assert';
import path from 'node:path';
import { describe, test } from 'node:test';
import type { EnvFile } from '../src/envParser.ts';
import { printValidationCi, printValidationReport, validateEnvUsage, validationToJson } from '../src/validator.ts';
import type { VarUsage } from '../src/scanner.ts';

const scannedDir = '/repo';
const appFile = path.join(scannedDir, 'src', 'app.ts');
const featureFile = path.join(scannedDir, 'src', 'features.ts');
const envFile = path.join(scannedDir, '.env');
const exampleFile = path.join(scannedDir, '.env.example');

describe('validateEnvUsage', () => {
  test('categorizes matched, missing, and unused vars across env files', () => {
    const usages: VarUsage[] = [
      { varName: 'API_URL', file: appFile, line: 3 },
      { varName: 'STRIPE_SECRET', file: featureFile, line: 18 },
    ];
    const envFiles: EnvFile[] = [
      {
        file: envFile,
        vars: new Map([
          ['API_URL', 'https://service'],
          ['OLD_REDIS_URL', 'redis://localhost'],
        ]),
        declarations: new Map([
          ['API_URL', { value: 'https://service', line: 1 }],
          ['OLD_REDIS_URL', { value: 'redis://localhost', line: 2 }],
        ]),
      },
      {
        file: exampleFile,
        vars: new Map([['API_URL', '']]),
        declarations: new Map([['API_URL', { value: '', line: 1 }]]),
      },
    ];

    const result = validateEnvUsage(usages, envFiles, scannedDir);

    assert.deepStrictEqual(result.matched.map((entry) => entry.varName), ['API_URL']);
    assert.deepStrictEqual(result.missing.map((entry) => entry.varName), ['STRIPE_SECRET']);
    assert.deepStrictEqual(result.unused.map((entry) => entry.varName), ['OLD_REDIS_URL']);
    assert.deepStrictEqual(result.unused[0]?.declarations, [{ file: envFile, line: 2 }]);
  });

  test('serializes validation results as relative JSON paths', () => {
    const result = validateEnvUsage(
      [{ varName: 'MISSING_VAR', file: appFile, line: 9 }],
      [],
      scannedDir,
    );

    const json = validationToJson(result) as {
      summary: { matched: number; missing: number; unused: number; total: number };
      missing: Array<{ varName: string; usages: Array<{ file: string; line: number }> }>;
    };

    assert.deepStrictEqual(json.summary, {
      matched: 0,
      missing: 1,
      unused: 0,
      total: 1,
    });
    assert.deepStrictEqual(json.missing, [
      {
        varName: 'MISSING_VAR',
        usages: [{ file: path.join('src', 'app.ts'), line: 9 }],
      },
    ]);
  });
});

describe('validation printers', () => {
  test('prints a human-readable validation report', () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.join(' '));
    };

    try {
      printValidationReport({
        scannedDir,
        matched: [{ varName: 'API_URL' }],
        missing: [{ varName: 'STRIPE_SECRET', usages: [{ varName: 'STRIPE_SECRET', file: featureFile, line: 18 }] }],
        unused: [{ varName: 'OLD_REDIS_URL', declarations: [{ file: envFile, line: 4 }] }],
      });
    } finally {
      console.log = originalLog;
    }

    const output = logs.join('\n');
    assert.match(output, /Declared and used \(1\)/);
    assert.match(output, /API_URL/);
    assert.match(output, /STRIPE_SECRET\s+src\/features\.ts:18/);
    assert.match(output, /OLD_REDIS_URL\s+\.env:4/);
  });

  test('prints GitHub Actions annotations for missing and unused vars', () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.join(' '));
    };

    try {
      printValidationCi({
        scannedDir,
        matched: [],
        missing: [{ varName: 'STRIPE_SECRET', usages: [{ varName: 'STRIPE_SECRET', file: featureFile, line: 18 }] }],
        unused: [{ varName: 'OLD_REDIS_URL', declarations: [{ file: envFile, line: 4 }] }],
      });
    } finally {
      console.log = originalLog;
    }

    assert.deepStrictEqual(logs, [
      '::error file=src/features.ts,line=18,title=Missing env var::STRIPE_SECRET is used in code but not declared in any .env* file',
      '::warning file=.env,line=4,title=Unused env var::OLD_REDIS_URL is declared but never used in code',
    ]);
  });
});
