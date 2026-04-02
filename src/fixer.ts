import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import type { VarUsage } from './scanner.js';
import { parseEnvFile } from './envParser.js';

export interface FixResult {
  exampleFile: string;
  created: boolean;
  added: string[];
}

export function findMissingExampleVars(
  usages: VarUsage[],
  exampleVars: Map<string, string>,
): string[] {
  const detected = [...new Set(usages.map((usage) => usage.varName))].sort();
  return detected.filter((key) => !exampleVars.has(key));
}

export function fixExampleFile(exampleFile: string, usages: VarUsage[]): FixResult {
  const resolvedFile = path.resolve(exampleFile);
  const created = !existsSync(resolvedFile);
  const exampleVars = created ? new Map<string, string>() : parseEnvFile(resolvedFile);
  const added = findMissingExampleVars(usages, exampleVars);

  if (added.length === 0) {
    if (created) {
      writeFileSync(resolvedFile, '', 'utf-8');
    }

    return { exampleFile: resolvedFile, created, added };
  }

  const lines = ['# Added by dead-env', ...added.map((key) => `${key}=`)];
  const prefix = created ? '' : '\n';
  const content = `${prefix}${lines.join('\n')}\n`;

  if (created) {
    writeFileSync(resolvedFile, content, 'utf-8');
  } else {
    appendFileSync(resolvedFile, content, 'utf-8');
  }

  return { exampleFile: resolvedFile, created, added };
}

export function printFixResult(result: FixResult): void {
  if (result.added.length === 0) {
    console.log(chalk.green(`No missing env vars found for ${result.exampleFile}.`));
    return;
  }

  console.log(`Found ${result.added.length} env vars not in ${result.exampleFile}:`);
  for (const key of result.added) {
    console.log(`  ${chalk.green('+')} ${key}=`);
  }
  console.log(chalk.green(`Updated ${result.exampleFile} with ${result.added.length} new entr${result.added.length === 1 ? 'y' : 'ies'}.`));
}
