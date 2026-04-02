import assert from 'node:assert';
import path from 'node:path';
import { describe, test } from 'node:test';
import { analyze, toJson } from '../src/reporter.ts';
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
});
