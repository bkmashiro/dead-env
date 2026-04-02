#!/usr/bin/env node
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Use tsx ESM loader to run the TypeScript entry point
const { spawnSync } = require('child_process');
const indexPath = join(__dirname, '..', 'src', 'index.ts');

const result = spawnSync(
  process.execPath,
  ['--import', `tsx/esm`, indexPath, ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: { ...process.env, NODE_PATH: join(__dirname, '..', 'node_modules') },
  },
);

process.exit(result.status ?? 0);
