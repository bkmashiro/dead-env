#!/usr/bin/env node
import { Command } from 'commander';
import path from 'path';
import { scanDirectory } from './scanner.js';
import { parseEnvFiles } from './envParser.js';
import { analyze, printReport, toJson } from './reporter.js';

const program = new Command();

program
  .name('dead-env')
  .description('Find ghost/zombie environment variables in your codebase')
  .version('1.0.0')
  .argument('[path]', 'Directory to scan', '.')
  .option('-e, --env <glob>', 'Env file pattern', '**/.env*')
  .option(
    '-x, --exclude',
    'Exclude node_modules, .git, dist (default: true)',
    true,
  )
  .option('--json', 'Output as JSON')
  .option('--ci', 'Exit with code 1 if any issues found (for CI use)')
  .action(async (scanPath: string, options: {
    env: string;
    exclude: boolean;
    json: boolean;
    ci: boolean;
  }) => {
    const resolvedPath = path.resolve(process.cwd(), scanPath);

    const excludePatterns = options.exclude
      ? ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/.next/**', '**/build/**']
      : [];

    // Run scan and env parse in parallel
    const [usages, envFiles] = await Promise.all([
      scanDirectory(resolvedPath, excludePatterns),
      parseEnvFiles(resolvedPath, options.env, excludePatterns),
    ]);

    const result = analyze(usages, envFiles, resolvedPath);

    if (options.json) {
      console.log(JSON.stringify(toJson(result), null, 2));
    } else {
      printReport(result);
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
