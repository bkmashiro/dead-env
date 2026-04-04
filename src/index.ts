#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import path from 'path';
import { glob } from 'glob';
import { scanDirectory, type SupportedLanguage } from './scanner.js';
import { parseEnvFiles } from './envParser.js';
import { analyze, printReport, toJson } from './reporter.js';
import { fixExampleFile, printFixResult } from './fixer.js';
import { diffEnvFiles, printDiff } from './differ.js';
import {
  printValidationCi,
  printValidationReport,
  validateEnvUsage,
  validationToJson,
} from './validator.js';
import {
  compareSecretsForRepo,
  printMultiCiSecretsReport,
  ciSecretsToJson,
  inferGitHubRepo,
} from './ciSecrets.js';

const program = new Command();
const SUPPORTED_LANGUAGES: SupportedLanguage[] = ['js', 'ts', 'py', 'go'];
const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
) as { version: string };

function parseLangOption(value: string): SupportedLanguage[] {
  const languages = value
    .split(',')
    .map((language) => language.trim().toLowerCase())
    .filter(Boolean);

  if (languages.length === 0) {
    throw new Error('Expected at least one language for --lang');
  }

  for (const language of languages) {
    if (!SUPPORTED_LANGUAGES.includes(language as SupportedLanguage)) {
      throw new Error(
        `Unsupported language "${language}". Use one or more of: ${SUPPORTED_LANGUAGES.join(', ')}`,
      );
    }
  }

  return languages as SupportedLanguage[];
}

/**
 * Resolve a list of repo paths/globs to absolute directory paths.
 * Supports:
 *   - plain directory paths (absolute or relative)
 *   - glob patterns that expand to directories
 */
async function resolveRepoPaths(patterns: string[]): Promise<string[]> {
  const resolved: string[] = [];
  for (const pattern of patterns) {
    const abs = path.resolve(process.cwd(), pattern);
    // Try as a literal path first
    try {
      const { statSync } = await import('node:fs');
      const stat = statSync(abs);
      if (stat.isDirectory()) {
        resolved.push(abs);
        continue;
      }
    } catch {
      // fall through to glob
    }

    // Treat as glob
    const matches = await glob(pattern, {
      cwd: process.cwd(),
      absolute: true,
      dot: false,
      nodir: false,
    });
    for (const m of matches) {
      try {
        const { statSync } = await import('node:fs');
        if (statSync(m).isDirectory()) resolved.push(m);
      } catch {
        // skip
      }
    }
  }
  return [...new Set(resolved)];
}

program
  .name('dead-env')
  .description('Find ghost/zombie environment variables in your codebase')
  .version(packageJson.version)
  .argument('[path]', 'Directory to scan', '.')
  .option('--fix', 'Append missing detected vars to the example file')
  .option('--example-file <path>', 'Example file path for --fix', '.env.example')
  .option('--diff <files...>', 'Compare two env files')
  .option('--values', 'Show actual values in --diff output')
  .option('--validate', 'Validate env vars used in code against discovered .env* files')
  .option('--strict', 'With --validate, exit with code 1 on unused env vars too')
  .option('-e, --env <glob>', 'Env file pattern', '**/.env*')
  .option(
    '-x, --exclude',
    'Exclude node_modules, .git, dist (default: true)',
    true,
  )
  .option('--lang <langs>', 'Languages to scan: js,ts,py,go', parseLangOption)
  .option('--json', 'Output as JSON')
  .option('--ci', 'Exit with code 1 if any issues found (for CI use)')
  .option(
    '--ci-secrets [repo]',
    'Compare local .env vars against GitHub Actions secrets. ' +
    'Optionally pass owner/repo; otherwise inferred from git remote. ' +
    'Requires GITHUB_TOKEN env var.',
  )
  .option(
    '--multi-repo <paths...>',
    'Scan multiple repo paths or globs and produce a merged report',
  )
  .action(async (scanPath: string, options: {
    fix: boolean;
    exampleFile: string;
    diff?: string[];
    values: boolean;
    validate: boolean;
    strict: boolean;
    env: string;
    exclude: boolean;
    lang?: SupportedLanguage[];
    json: boolean;
    ci: boolean;
    ciSecrets?: string | boolean;
    multiRepo?: string[];
  }) => {
    if (options.diff) {
      if (options.diff.length !== 2) {
        throw new Error('--diff expects exactly two env files');
      }

      const [firstFile, secondFile] = options.diff.map((file) => path.resolve(process.cwd(), file));
      const result = diffEnvFiles(firstFile, secondFile);
      printDiff(result, options.values);
      return;
    }

    const excludePatterns = options.exclude
      ? ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/.next/**', '**/build/**']
      : [];

    // ── Multi-repo scan ────────────────────────────────────────────────────
    if (options.multiRepo && options.multiRepo.length > 0) {
      const repoDirs = await resolveRepoPaths(options.multiRepo);
      if (repoDirs.length === 0) {
        throw new Error('--multi-repo: no matching directories found');
      }

      const repoResults = await Promise.all(
        repoDirs.map(async (repoDir) => {
          const [usages, envFiles] = await Promise.all([
            scanDirectory(repoDir, excludePatterns, options.lang),
            parseEnvFiles(repoDir, options.env, excludePatterns),
          ]);
          return analyze(usages, envFiles, repoDir);
        }),
      );

      if (options.json) {
        console.log(JSON.stringify(repoResults.map(toJson), null, 2));
      } else {
        for (const result of repoResults) {
          printReport(result);
        }

        if (repoResults.length > 1) {
          const chalk = (await import('chalk')).default;
          const divider = chalk.dim('═'.repeat(40));
          console.log(divider);
          console.log(chalk.bold('Multi-repo summary:'));
          for (const result of repoResults) {
            const hasIssues = result.ghosts.length > 0 || result.zombies.length > 0 || result.drifts.length > 0;
            const status = hasIssues ? chalk.red('❌') : chalk.green('✅');
            const detail = hasIssues
              ? [
                  result.ghosts.length > 0 ? chalk.yellow(`${result.ghosts.length} ghost`) : '',
                  result.zombies.length > 0 ? chalk.magenta(`${result.zombies.length} zombie`) : '',
                  result.drifts.length > 0 ? chalk.blue(`${result.drifts.length} drift`) : '',
                ].filter(Boolean).join(', ')
              : chalk.dim('all clear');
            console.log(`  ${status} ${chalk.cyan(result.scannedDir)} — ${detail}`);
          }
          console.log('');
        }
      }

      if (options.ci) {
        const anyIssues = repoResults.some(
          (r) => r.ghosts.length > 0 || r.zombies.length > 0 || r.drifts.length > 0,
        );
        if (anyIssues) process.exit(1);
      }
      return;
    }

    // ── CI secrets compare ─────────────────────────────────────────────────
    if (options.ciSecrets !== undefined) {
      const token = process.env['GITHUB_TOKEN'] ?? '';
      if (!token) {
        throw new Error('--ci-secrets requires GITHUB_TOKEN environment variable');
      }

      const resolvedPath = path.resolve(process.cwd(), scanPath);
      const envFiles = await parseEnvFiles(resolvedPath, options.env, excludePatterns);
      const localVarNames = [...new Set(envFiles.flatMap((f) => [...f.vars.keys()]))].sort();

      let repoSlug: string;
      if (typeof options.ciSecrets === 'string' && options.ciSecrets.includes('/')) {
        repoSlug = options.ciSecrets;
      } else {
        const inferred = await inferGitHubRepo(resolvedPath);
        if (!inferred) {
          throw new Error(
            '--ci-secrets: could not infer GitHub repo from git remote. ' +
            'Pass owner/repo explicitly: --ci-secrets owner/repo',
          );
        }
        repoSlug = inferred;
      }

      const result = await compareSecretsForRepo(repoSlug, localVarNames, token);

      if (options.json) {
        console.log(JSON.stringify(ciSecretsToJson([result]), null, 2));
      } else {
        printMultiCiSecretsReport([result]);
      }

      if (options.ci && (result.missing.length > 0 || result.extra.length > 0)) {
        process.exit(1);
      }
      return;
    }

    // ── Default single-repo scan ───────────────────────────────────────────
    const resolvedPath = path.resolve(process.cwd(), scanPath);

    const [usages, envFiles] = await Promise.all([
      scanDirectory(resolvedPath, excludePatterns, options.lang),
      parseEnvFiles(resolvedPath, options.env, excludePatterns),
    ]);

    if (options.validate) {
      const validation = validateEnvUsage(usages, envFiles, resolvedPath);

      if (options.json) {
        console.log(JSON.stringify(validationToJson(validation), null, 2));
      } else {
        printValidationReport(validation);
        if (options.ci) {
          printValidationCi(validation);
        }
      }

      const shouldFail = validation.missing.length > 0 || (options.strict && validation.unused.length > 0);
      if (shouldFail) {
        process.exit(1);
      }
      return;
    }

    const result = analyze(usages, envFiles, resolvedPath);

    if (options.json) {
      console.log(JSON.stringify(toJson(result), null, 2));
    } else {
      printReport(result);
    }

    if (options.fix) {
      const exampleFile = path.resolve(resolvedPath, options.exampleFile);
      const fixResult = fixExampleFile(exampleFile, usages);
      printFixResult(fixResult);
    }

    const { ghosts, zombies, drifts } = result;
    const hasIssues = ghosts.length > 0 || zombies.length > 0 || drifts.length > 0;

    if (options.ci && hasIssues) {
      process.exit(1);
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error('Error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
