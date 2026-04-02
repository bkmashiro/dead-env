import chalk from 'chalk';
import path from 'node:path';
import type { EnvFile } from './envParser.js';
import type { VarUsage } from './scanner.js';

export interface MatchedVar {
  varName: string;
}

export interface MissingVar {
  varName: string;
  usages: VarUsage[];
}

export interface UnusedVar {
  varName: string;
  declarations: Array<{ file: string; line: number }>;
}

export interface ValidationResult {
  scannedDir: string;
  matched: MatchedVar[];
  missing: MissingVar[];
  unused: UnusedVar[];
}

function relPath(filePath: string, base: string): string {
  return path.relative(base, filePath);
}

function formatCount(count: number): string {
  return `${count}`;
}

export function validateEnvUsage(
  usages: VarUsage[],
  envFiles: EnvFile[],
  scannedDir: string,
): ValidationResult {
  const usageMap = new Map<string, VarUsage[]>();
  for (const usage of usages) {
    if (!usageMap.has(usage.varName)) {
      usageMap.set(usage.varName, []);
    }
    usageMap.get(usage.varName)!.push(usage);
  }

  const declarationMap = new Map<string, Array<{ file: string; line: number }>>();
  for (const envFile of envFiles) {
    for (const [varName, declaration] of envFile.declarations) {
      if (!declarationMap.has(varName)) {
        declarationMap.set(varName, []);
      }
      declarationMap.get(varName)!.push({
        file: envFile.file,
        line: declaration.line,
      });
    }
  }

  const matched = [...usageMap.keys()]
    .filter((varName) => declarationMap.has(varName))
    .sort()
    .map((varName) => ({ varName }));

  const missing = [...usageMap.entries()]
    .filter(([varName]) => !declarationMap.has(varName))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([varName, usageEntries]) => ({ varName, usages: usageEntries }));

  const unused = [...declarationMap.entries()]
    .filter(([varName]) => !usageMap.has(varName))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([varName, declarations]) => ({ varName, declarations }));

  return {
    scannedDir,
    matched,
    missing,
    unused,
  };
}

export function printValidationReport(result: ValidationResult): void {
  console.log('Scanning src/ for env var usage...');
  console.log('Checking against discovered .env* files...');
  console.log('');

  console.log(chalk.green(`✅ Declared and used (${formatCount(result.matched.length)}):`));
  if (result.matched.length === 0) {
    console.log(chalk.dim('  none'));
  } else {
    console.log(`  ${result.matched.map((entry) => entry.varName).join(', ')}`);
  }

  console.log('');
  console.log(
    chalk.red(`❌ Used in code but NOT in any .env* file (${formatCount(result.missing.length)}):`),
  );
  if (result.missing.length === 0) {
    console.log(chalk.dim('  none'));
  } else {
    for (const entry of result.missing) {
      const firstUsage = entry.usages[0];
      if (!firstUsage) {
        continue;
      }
      console.log(`  ${entry.varName}   ${relPath(firstUsage.file, result.scannedDir)}:${firstUsage.line}`);
    }
    console.log(chalk.red('  → These are MISSING from your env files!'));
  }

  console.log('');
  console.log(
    chalk.yellow(`⚠️  Declared in .env* but NEVER used in code (${formatCount(result.unused.length)}):`),
  );
  if (result.unused.length === 0) {
    console.log(chalk.dim('  none'));
  } else {
    for (const entry of result.unused) {
      const firstDeclaration = entry.declarations[0];
      const suffix = firstDeclaration
        ? `   ${relPath(firstDeclaration.file, result.scannedDir)}:${firstDeclaration.line}`
        : '';
      console.log(`  ${entry.varName}${suffix}`);
    }
  }
}

function escapeWorkflowValue(value: string): string {
  return value
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A')
    .replace(/:/g, '%3A')
    .replace(/,/g, '%2C');
}

export function printValidationCi(result: ValidationResult): void {
  for (const entry of result.missing) {
    for (const usage of entry.usages) {
      const file = escapeWorkflowValue(relPath(usage.file, result.scannedDir));
      const title = escapeWorkflowValue('Missing env var');
      const message = escapeWorkflowValue(
        `${entry.varName} is used in code but not declared in any .env* file`,
      );
      console.log(`::error file=${file},line=${usage.line},title=${title}::${message}`);
    }
  }

  for (const entry of result.unused) {
    for (const declaration of entry.declarations) {
      const file = escapeWorkflowValue(relPath(declaration.file, result.scannedDir));
      const title = escapeWorkflowValue('Unused env var');
      const message = escapeWorkflowValue(
        `${entry.varName} is declared but never used in code`,
      );
      console.log(`::warning file=${file},line=${declaration.line},title=${title}::${message}`);
    }
  }
}

export function validationToJson(result: ValidationResult): object {
  return {
    scannedDir: result.scannedDir,
    summary: {
      matched: result.matched.length,
      missing: result.missing.length,
      unused: result.unused.length,
      total: result.matched.length + result.missing.length + result.unused.length,
    },
    matched: result.matched.map((entry) => entry.varName),
    missing: result.missing.map((entry) => ({
      varName: entry.varName,
      usages: entry.usages.map((usage) => ({
        file: relPath(usage.file, result.scannedDir),
        line: usage.line,
      })),
    })),
    unused: result.unused.map((entry) => ({
      varName: entry.varName,
      declarations: entry.declarations.map((declaration) => ({
        file: relPath(declaration.file, result.scannedDir),
        line: declaration.line,
      })),
    })),
  };
}
