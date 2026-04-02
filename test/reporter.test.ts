import assert from 'node:assert';
import path from 'node:path';
import { describe, test } from 'node:test';
import { analyze, printReport, toJson } from '../src/reporter.ts';
import type { EnvFile } from '../src/envParser.ts';
import type { VarUsage } from '../src/scanner.ts';

const scannedDir = '/repo';
const srcFile = path.join(scannedDir, 'src', 'app.ts');
const envFilePath = path.join(scannedDir, '.env');

describe('analyze', () => {
  test('categorizes used+defined, used+undefined, and defined+unused vars', () => {
    const usages: VarUsage[] = [
      { varName: 'OK_VAR', file: srcFile, line: 1 },
      { varName: 'GHOST_VAR', file: srcFile, line: 2 },
    ];
    const envFiles: EnvFile[] = [
      {
        file: envFilePath,
        vars: new Map([
          ['OK_VAR', 'present'],
          ['ZOMBIE_VAR', 'stale'],
        ]),
      },
    ];

    const result = analyze(usages, envFiles, scannedDir);

    assert.deepStrictEqual(result.ghosts.map((ghost) => ghost.varName), ['GHOST_VAR']);
    assert.deepStrictEqual(result.zombies.map((zombie) => zombie.varName), ['ZOMBIE_VAR']);
    assert.deepStrictEqual(result.drifts, []);
  });

  test('does not report used+defined vars as ghost or zombie', () => {
    const usages: VarUsage[] = [{ varName: 'OK_VAR', file: srcFile, line: 3 }];
    const envFiles: EnvFile[] = [
      {
        file: envFilePath,
        vars: new Map([['OK_VAR', 'present']]),
      },
    ];

    const result = analyze(usages, envFiles, scannedDir);

    assert.strictEqual(result.ghosts.length, 0);
    assert.strictEqual(result.zombies.length, 0);
  });

  test('returns correct counts in JSON summary', () => {
    const usages: VarUsage[] = [{ varName: 'GHOST_VAR', file: srcFile, line: 2 }];
    const envFiles: EnvFile[] = [
      {
        file: envFilePath,
        vars: new Map([['ZOMBIE_VAR', 'stale']]),
      },
    ];

    const json = toJson(analyze(usages, envFiles, scannedDir)) as {
      summary: { ghosts: number; zombies: number; drifts: number; total: number };
    };

    assert.deepStrictEqual(json.summary, {
      ghosts: 1,
      zombies: 1,
      drifts: 0,
      total: 2,
    });
  });

  test('handles empty usage and env sets', () => {
    const result = analyze([], [], scannedDir);
    const json = toJson(result) as {
      summary: { ghosts: number; zombies: number; drifts: number; total: number };
    };

    assert.strictEqual(result.ghosts.length, 0);
    assert.strictEqual(result.zombies.length, 0);
    assert.strictEqual(result.drifts.length, 0);
    assert.deepStrictEqual(json.summary, {
      ghosts: 0,
      zombies: 0,
      drifts: 0,
      total: 0,
    });
  });

  test('detects drift, sorts entries, and serializes relative paths', () => {
    const otherSrcFile = path.join(scannedDir, 'src', 'worker.ts');
    const prodEnvFile = path.join(scannedDir, '.env.production');
    const usages: VarUsage[] = [
      { varName: 'ZZZ_GHOST', file: otherSrcFile, line: 8 },
      { varName: 'AAA_GHOST', file: srcFile, line: 2 },
      { varName: 'AAA_GHOST', file: srcFile, line: 5 },
    ];
    const envFiles: EnvFile[] = [
      {
        file: envFilePath,
        vars: new Map([
          ['ZZZ_ZOMBIE', 'one'],
          ['DRIFTED', 'alpha'],
        ]),
      },
      {
        file: prodEnvFile,
        vars: new Map([
          ['AAA_ZOMBIE', 'two'],
          ['DRIFTED', 'beta'],
        ]),
      },
    ];

    const result = analyze(usages, envFiles, scannedDir);
    const json = toJson(result) as {
      ghosts: Array<{ varName: string; usages: Array<{ file: string; line: number }> }>;
      zombies: Array<{ varName: string; definedIn: string; value: string }>;
      drifts: Array<{ varName: string; values: Array<{ file: string; value: string }> }>;
    };

    assert.deepStrictEqual(result.ghosts.map((ghost) => ghost.varName), ['AAA_GHOST', 'ZZZ_GHOST']);
    assert.deepStrictEqual(
      result.zombies.map((zombie) => zombie.varName),
      ['AAA_ZOMBIE', 'DRIFTED', 'DRIFTED', 'ZZZ_ZOMBIE'],
    );
    assert.deepStrictEqual(result.drifts.map((drift) => drift.varName), ['DRIFTED']);
    assert.deepStrictEqual(json.ghosts[0], {
      varName: 'AAA_GHOST',
      usages: [{ file: path.join('src', 'app.ts'), line: 2 }, { file: path.join('src', 'app.ts'), line: 5 }],
    });
    assert.deepStrictEqual(json.zombies[0], {
      varName: 'AAA_ZOMBIE',
      definedIn: '.env.production',
      value: 'two',
    });
    assert.deepStrictEqual(json.drifts[0], {
      varName: 'DRIFTED',
      values: [
        { file: '.env', value: 'alpha' },
        { file: '.env.production', value: 'beta' },
      ],
    });
  });
});

describe('printReport', () => {
  test('prints a detailed report when issues are present', () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.join(' '));
    };

    try {
      printReport(
        analyze(
          [
            { varName: 'GHOST_VAR', file: srcFile, line: 2 },
            { varName: 'GHOST_VAR', file: srcFile, line: 7 },
          ],
          [
            {
              file: envFilePath,
              vars: new Map([
                ['ZOMBIE_VAR', 'stale'],
                ['DRIFT_VAR', 'one'],
              ]),
            },
            {
              file: path.join(scannedDir, '.env.production'),
              vars: new Map([['DRIFT_VAR', 'two']]),
            },
          ],
          scannedDir,
        ),
      );
    } finally {
      console.log = originalLog;
    }

    const output = logs.join('\n');
    assert.match(output, /dead-env scan: \/repo/);
    assert.match(output, /GHOST_VAR/);
    assert.match(output, /src\/app\.ts:2,7/);
    assert.match(output, /ZOMBIE_VAR/);
    assert.match(output, /\.env\)/);
    assert.match(output, /DRIFT_VAR/);
    assert.match(output, /\.env\.production/);
    assert.match(output, /Summary: .*1 ghost.*3 zombie.*1 drift.*issue\(s\)/);
  });

  test('prints the all-clear report when there are no issues', () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.join(' '));
    };

    try {
      printReport(analyze([], [], scannedDir));
    } finally {
      console.log = originalLog;
    }

    const output = logs.join('\n');
    assert.match(output, /No ghost variables found/);
    assert.match(output, /No zombie variables found/);
    assert.match(output, /No drift found/);
    assert.match(output, /All clear! No issues found/);
  });
});
