import chalk from 'chalk';
import path from 'path';
import type { VarUsage } from './scanner.js';
import type { EnvFile } from './envParser.js';

export interface GhostVar {
  varName: string;
  usages: VarUsage[];
}

export interface ZombieVar {
  varName: string;
  definedIn: string; // file path
  value: string;
}

export interface DriftEntry {
  varName: string;
  values: { file: string; value: string }[];
}

export interface AnalysisResult {
  scannedDir: string;
  ghosts: GhostVar[];
  zombies: ZombieVar[];
  drifts: DriftEntry[];
}

/**
 * Analyze usages vs env files to produce ghosts, zombies, and drifts.
 */
export function analyze(
  usages: VarUsage[],
  envFiles: EnvFile[],
  scannedDir: string,
): AnalysisResult {
  // All defined vars across all env files
  const allDefined = new Map<string, { file: string; value: string }[]>();
  for (const envFile of envFiles) {
    for (const [key, value] of envFile.vars) {
      if (!allDefined.has(key)) allDefined.set(key, []);
      allDefined.get(key)!.push({ file: envFile.file, value });
    }
  }

  // All used var names -> their usages
  const usageMap = new Map<string, VarUsage[]>();
  for (const usage of usages) {
    if (!usageMap.has(usage.varName)) usageMap.set(usage.varName, []);
    usageMap.get(usage.varName)!.push(usage);
  }

  // Ghosts: used in code but not defined in any env file
  const ghosts: GhostVar[] = [];
  for (const [varName, varUsages] of usageMap) {
    if (!allDefined.has(varName)) {
      ghosts.push({ varName, usages: varUsages });
    }
  }
  ghosts.sort((a, b) => a.varName.localeCompare(b.varName));

  // Zombies: defined in env files but never used in code
  const zombies: ZombieVar[] = [];
  for (const [varName, definitions] of allDefined) {
    if (!usageMap.has(varName)) {
      for (const def of definitions) {
        zombies.push({ varName, definedIn: def.file, value: def.value });
      }
    }
  }
  zombies.sort((a, b) => a.varName.localeCompare(b.varName));

  // Drifts: same var has different values across env files
  const drifts: DriftEntry[] = [];
  for (const [varName, definitions] of allDefined) {
    if (definitions.length < 2) continue;
    const uniqueValues = new Set(definitions.map((d) => d.value));
    if (uniqueValues.size > 1) {
      drifts.push({ varName, values: definitions });
    }
  }
  drifts.sort((a, b) => a.varName.localeCompare(b.varName));

  return { scannedDir, ghosts, zombies, drifts };
}

function relPath(filePath: string, base: string): string {
  return path.relative(base, filePath);
}

/**
 * Group usages by file, returning "file:line1,line2" strings.
 */
function groupUsagesByFile(usages: VarUsage[], base: string): string[] {
  const byFile = new Map<string, number[]>();
  for (const u of usages) {
    if (!byFile.has(u.file)) byFile.set(u.file, []);
    byFile.get(u.file)!.push(u.line);
  }
  return Array.from(byFile.entries()).map(
    ([file, lines]) => `${relPath(file, base)}:${lines.join(',')}`,
  );
}

/**
 * Print a human-readable report to stdout.
 */
export function printReport(result: AnalysisResult): void {
  const { scannedDir, ghosts, zombies, drifts } = result;
  const divider = chalk.dim('─'.repeat(40));

  console.log('');
  console.log(chalk.bold(`dead-env scan: ${chalk.cyan(scannedDir)}`));
  console.log(divider);

  // Ghosts
  if (ghosts.length > 0) {
    console.log('');
    console.log(chalk.bold.yellow('👻 Ghost Variables') + chalk.dim(' (used in code, not defined):'));
    for (const ghost of ghosts) {
      console.log(`  ${chalk.yellow(ghost.varName)}`);
      for (const ref of groupUsagesByFile(ghost.usages, scannedDir)) {
        console.log(`    ${chalk.dim('└─')} ${chalk.dim(ref)}`);
      }
    }
  } else {
    console.log('');
    console.log(chalk.green('👻 No ghost variables found.'));
  }

  // Zombies
  if (zombies.length > 0) {
    console.log('');
    console.log(chalk.bold.magenta('🧟 Zombie Variables') + chalk.dim(' (defined in .env, never used):'));
    for (const zombie of zombies) {
      console.log(
        `  ${chalk.magenta(zombie.varName)}` +
        chalk.dim(`    (${relPath(zombie.definedIn, scannedDir)})`),
      );
    }
  } else {
    console.log('');
    console.log(chalk.green('🧟 No zombie variables found.'));
  }

  // Drifts
  if (drifts.length > 0) {
    console.log('');
    console.log(chalk.bold.blue('🔀 Drift') + chalk.dim(' (same var, different values across env files):'));
    for (const drift of drifts) {
      console.log(`  ${chalk.blue(drift.varName)}`);
      for (const v of drift.values) {
        console.log(
          `    ${chalk.dim('└─')} ${chalk.dim(relPath(v.file, scannedDir))}: ${chalk.italic(`"${v.value}"`)}`
        );
      }
    }
  } else {
    console.log('');
    console.log(chalk.green('🔀 No drift found.'));
  }

  console.log('');
  console.log(divider);

  const ghostCount = ghosts.length;
  const zombieCount = zombies.length;
  const driftCount = drifts.length;
  const total = ghostCount + zombieCount + driftCount;

  if (total === 0) {
    console.log(chalk.bold.green('All clear! No issues found.'));
  } else {
    const parts: string[] = [];
    if (ghostCount > 0) parts.push(chalk.yellow(`${ghostCount} ghost`));
    if (zombieCount > 0) parts.push(chalk.magenta(`${zombieCount} zombie`));
    if (driftCount > 0) parts.push(chalk.blue(`${driftCount} drift`));
    console.log(chalk.bold('Summary: ') + parts.join(', ') + chalk.bold(' issue(s)'));
  }
  console.log('');
}

/**
 * Return JSON-serializable representation of the analysis result.
 */
export function toJson(result: AnalysisResult): object {
  const { scannedDir, ghosts, zombies, drifts } = result;

  return {
    scannedDir,
    summary: {
      ghosts: ghosts.length,
      zombies: zombies.length,
      drifts: drifts.length,
      total: ghosts.length + zombies.length + drifts.length,
    },
    ghosts: ghosts.map((g) => ({
      varName: g.varName,
      usages: g.usages.map((u) => ({
        file: path.relative(scannedDir, u.file),
        line: u.line,
      })),
    })),
    zombies: zombies.map((z) => ({
      varName: z.varName,
      definedIn: path.relative(scannedDir, z.definedIn),
      value: z.value,
    })),
    drifts: drifts.map((d) => ({
      varName: d.varName,
      values: d.values.map((v) => ({
        file: path.relative(scannedDir, v.file),
        value: v.value,
      })),
    })),
  };
}
