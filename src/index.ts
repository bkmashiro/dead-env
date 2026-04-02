#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import path from 'path';
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

    const resolvedPath = path.resolve(process.cwd(), scanPath);

    const excludePatterns = options.exclude
      ? ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/.next/**', '**/build/**']
      : [];

    // Run scan and env parse in parallel
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
