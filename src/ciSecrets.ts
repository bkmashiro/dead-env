import chalk from 'chalk';

export interface CiSecretsResult {
  repo: string;
  localVars: string[];
  githubSecrets: string[];
  missing: string[];   // in .env but not in GitHub secrets
  extra: string[];     // in GitHub secrets but not in .env
}

async function fetchGitHubSecrets(repo: string, token: string): Promise<string[]> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const allSecretNames: string[] = [];
  let page = 1;

  while (true) {
    const url = `https://api.github.com/repos/${repo}/actions/secrets?per_page=100&page=${page}`;
    const response = await fetch(url, { headers });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`GitHub API error for ${repo}: ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`);
    }

    const data = await response.json() as { secrets: Array<{ name: string }>; total_count: number };
    allSecretNames.push(...data.secrets.map((s) => s.name));

    if (allSecretNames.length >= data.total_count) break;
    page++;
  }

  return allSecretNames.sort();
}

export async function compareSecretsForRepo(
  repo: string,
  localVarNames: string[],
  token: string,
): Promise<CiSecretsResult> {
  const githubSecrets = await fetchGitHubSecrets(repo, token);
  const localSet = new Set(localVarNames);
  const githubSet = new Set(githubSecrets);

  const missing = localVarNames.filter((v) => !githubSet.has(v)).sort();
  const extra = githubSecrets.filter((v) => !localSet.has(v)).sort();

  return {
    repo,
    localVars: localVarNames.sort(),
    githubSecrets,
    missing,
    extra,
  };
}

export function printCiSecretsReport(result: CiSecretsResult): void {
  const divider = chalk.dim('─'.repeat(40));
  console.log('');
  console.log(chalk.bold(`CI secrets compare: ${chalk.cyan(result.repo)}`));
  console.log(divider);
  console.log(chalk.dim(`  Local .env vars:    ${result.localVars.length}`));
  console.log(chalk.dim(`  GitHub secrets:     ${result.githubSecrets.length}`));

  if (result.missing.length > 0) {
    console.log('');
    console.log(chalk.bold.red('❌ Missing in GitHub secrets') + chalk.dim(' (defined in .env, absent from repo secrets):'));
    for (const v of result.missing) {
      console.log(`  ${chalk.red(v)}`);
    }
  } else {
    console.log('');
    console.log(chalk.green('✅ No missing secrets.'));
  }

  if (result.extra.length > 0) {
    console.log('');
    console.log(chalk.bold.yellow('⚠️  Extra in GitHub secrets') + chalk.dim(' (in repo secrets, not in .env):'));
    for (const v of result.extra) {
      console.log(`  ${chalk.yellow(v)}`);
    }
  } else {
    console.log('');
    console.log(chalk.green('✅ No extra secrets.'));
  }

  console.log('');
  console.log(divider);
  if (result.missing.length === 0 && result.extra.length === 0) {
    console.log(chalk.bold.green('All clear! Secrets are in sync.'));
  } else {
    const parts: string[] = [];
    if (result.missing.length > 0) parts.push(chalk.red(`${result.missing.length} missing`));
    if (result.extra.length > 0) parts.push(chalk.yellow(`${result.extra.length} extra`));
    console.log(chalk.bold('Summary: ') + parts.join(', '));
  }
  console.log('');
}

export function printMultiCiSecretsReport(results: CiSecretsResult[]): void {
  for (const result of results) {
    printCiSecretsReport(result);
  }

  if (results.length > 1) {
    const divider = chalk.dim('═'.repeat(40));
    console.log(divider);
    console.log(chalk.bold('Multi-repo summary:'));
    for (const result of results) {
      const status = result.missing.length === 0 && result.extra.length === 0
        ? chalk.green('✅')
        : chalk.red('❌');
      const detail = result.missing.length === 0 && result.extra.length === 0
        ? chalk.dim('in sync')
        : [
            result.missing.length > 0 ? chalk.red(`${result.missing.length} missing`) : '',
            result.extra.length > 0 ? chalk.yellow(`${result.extra.length} extra`) : '',
          ].filter(Boolean).join(', ');
      console.log(`  ${status} ${chalk.cyan(result.repo)} — ${detail}`);
    }
    console.log('');
  }
}

export function ciSecretsToJson(results: CiSecretsResult[]): object {
  return {
    repos: results.map((r) => ({
      repo: r.repo,
      summary: {
        localVars: r.localVars.length,
        githubSecrets: r.githubSecrets.length,
        missing: r.missing.length,
        extra: r.extra.length,
      },
      missing: r.missing,
      extra: r.extra,
    })),
  };
}

/**
 * Infer the GitHub repo slug (owner/repo) from a local git remote.
 * Returns null if it cannot be determined.
 */
export async function inferGitHubRepo(dir: string): Promise<string | null> {
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);

    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd: dir });
    const remote = stdout.trim();

    // SSH: git@github.com:owner/repo.git
    const sshMatch = remote.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
    if (sshMatch?.[1]) return sshMatch[1];

    // HTTPS: https://github.com/owner/repo.git
    const httpsMatch = remote.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
    if (httpsMatch?.[1]) return httpsMatch[1];
  } catch {
    // not a git repo or no remote
  }
  return null;
}
