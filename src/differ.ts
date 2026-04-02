import chalk from 'chalk';
import path from 'node:path';
import { parseEnvFile } from './envParser.js';

export interface ChangedVar {
  key: string;
  firstValue: string;
  secondValue: string;
}

export interface EnvDiffResult {
  firstFile: string;
  secondFile: string;
  onlyInFirst: string[];
  onlyInSecond: string[];
  changed: ChangedVar[];
  sharedSameCount: number;
}

function deriveLabel(filePath: string, fallback: string): string {
  const base = path.basename(filePath);

  if (base === '.env') {
    return fallback;
  }

  const envSuffix = base.match(/^\.env\.(.+)$/)?.[1];
  const raw = envSuffix ?? path.parse(base).name;

  switch (raw) {
    case 'production':
      return 'prod';
    case 'development':
      return 'dev';
    default:
      return raw || fallback;
  }
}

export function diffEnvFiles(firstFile: string, secondFile: string): EnvDiffResult {
  const firstVars = parseEnvFile(firstFile);
  const secondVars = parseEnvFile(secondFile);
  const firstKeys = [...firstVars.keys()].sort();
  const secondKeys = [...secondVars.keys()].sort();

  const onlyInFirst = firstKeys.filter((key) => !secondVars.has(key));
  const onlyInSecond = secondKeys.filter((key) => !firstVars.has(key));
  const sharedKeys = firstKeys.filter((key) => secondVars.has(key));

  const changed: ChangedVar[] = [];
  let sharedSameCount = 0;

  for (const key of sharedKeys) {
    const firstValue = firstVars.get(key) ?? '';
    const secondValue = secondVars.get(key) ?? '';

    if (firstValue === secondValue) {
      sharedSameCount++;
      continue;
    }

    changed.push({ key, firstValue, secondValue });
  }

  return {
    firstFile,
    secondFile,
    onlyInFirst,
    onlyInSecond,
    changed,
    sharedSameCount,
  };
}

function printKeySection(title: string, color: (text: string) => string, keys: string[]): void {
  console.log(color(`${title} (${keys.length}):`));
  if (keys.length === 0) {
    console.log(chalk.dim('  none'));
    return;
  }

  for (const key of keys) {
    console.log(`  ${key}`);
  }
}

export function printDiff(result: EnvDiffResult, showValues: boolean = false): void {
  const firstLabel = deriveLabel(result.firstFile, 'first');
  const secondLabel = deriveLabel(result.secondFile, 'second');

  printKeySection(`Keys only in ${result.firstFile}`, chalk.red, result.onlyInFirst);
  console.log('');
  printKeySection(`Keys only in ${result.secondFile}`, chalk.green, result.onlyInSecond);
  console.log('');
  console.log(chalk.yellow(`Keys in both but different values (${result.changed.length}):`));
  if (result.changed.length === 0) {
    console.log(chalk.dim('  none'));
  } else {
    for (const entry of result.changed) {
      if (!showValues) {
        console.log(`  ${entry.key}`);
        continue;
      }

      console.log(
        `  ${entry.key.padEnd(20)} ${firstLabel}=${entry.firstValue}  ${secondLabel}=${entry.secondValue}`,
      );
    }
  }
  console.log('');
  console.log(`Shared keys: ${result.sharedSameCount}`);
}
