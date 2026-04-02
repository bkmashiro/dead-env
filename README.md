# dead-env

Hunt down ghost and zombie environment variables haunting your codebase.

## What it does

Every project accumulates env var debt:

- **👻 Ghost variables** — referenced in code (`process.env.STRIPE_KEY`) but never defined in any `.env` file. These will blow up silently at runtime.
- **🧟 Zombie variables** — defined in `.env` but never actually referenced anywhere in the code. Dead weight you're carrying around for no reason.
- **🔀 Drift** — the same variable is defined in multiple `.env` files (`.env`, `.env.production`, etc.) with different values, which may indicate a misconfiguration or forgotten update.

## Install

Once published to npm:

```bash
npm install -g dead-env
```

Or run without installing:

```bash
npx dead-env .
```

Or clone and run locally:

```bash
git clone https://github.com/yourname/dead-env
cd dead-env
pnpm install
pnpm start -- /path/to/your/project
```

## Usage

```
Usage: dead-env [path] [options]

Arguments:
  path              Directory to scan (default: current directory)

Options:
  -e, --env <glob>  Env file pattern (default: "**/.env*")
  -x, --exclude     Exclude node_modules, .git, dist (default: true)
  --lang <langs>    Languages to scan: js,ts,py,go
  --json            Output as JSON
  --ci              Exit with code 1 if any issues found (for CI use)
  -V, --version     Output the version number
  -h, --help        Show help
```

### Examples

Scan the current directory:

```bash
dead-env
```

Scan a specific project:

```bash
dead-env ~/projects/myapp
```

Output JSON (pipe-friendly):

```bash
dead-env --json | jq '.ghosts'
```

Only look at `.env` and `.env.production`:

```bash
dead-env -e ".env{,.production}"
```

Only scan Python and Go files:

```bash
dead-env --lang py,go
```

### Example output

```
dead-env scan: ~/projects/myapp
────────────────────────────────

👻 Ghost Variables (used in code, not defined):
  STRIPE_SECRET_KEY
    └─ src/payments.ts:42, src/webhook.ts:8
  NODE_ENV
    └─ src/config.ts:3

🧟 Zombie Variables (defined in .env, never used):
  OLD_API_ENDPOINT    (.env)

🔀 Drift (same var, different across env files):
  DATABASE_URL
    └─ .env: "postgres://localhost/dev"
    └─ .env.production: "postgres://prod/app"

────────────────────────────────
Summary: 2 ghost, 1 zombie, 1 drift issue(s)
```

## CI Integration

Add to your GitHub Actions workflow to catch env problems before they ship:

```yaml
# .github/workflows/env-check.yml
name: Env Check

on:
  push:
    branches: [main]
  pull_request:

jobs:
  dead-env:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Run dead-env
        run: npx dead-env --ci .
        # Exits with code 1 if any ghosts, zombies, or drift are found
```

You can also make it non-blocking (report only, don't fail the build):

```yaml
      - name: Run dead-env (advisory)
        run: npx dead-env --json . | tee env-report.json || true

      - name: Upload env report
        uses: actions/upload-artifact@v4
        with:
          name: env-report
          path: env-report.json
```

## Supported languages

dead-env recognizes env var access patterns from:

- **JavaScript / TypeScript** — `process.env.VAR`, `process.env['VAR']`
- **Python** — `os.environ.get('VAR')`, `os.environ['VAR']`, `os.getenv('VAR')`
- **Go** — `os.Getenv("VAR")`, `os.LookupEnv("VAR")`

## License

MIT
