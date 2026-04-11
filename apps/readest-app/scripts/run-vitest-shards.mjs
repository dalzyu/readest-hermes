import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const totalShards = Number.parseInt(process.argv[2] ?? '1', 10);

if (!Number.isInteger(totalShards) || totalShards < 1) {
  console.error('Expected a positive shard count.');
  process.exit(1);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, '..');
const corepackCommand = process.platform === 'win32' ? 'corepack.cmd' : 'corepack';

for (let shard = 1; shard <= totalShards; shard += 1) {
  const result = spawnSync(
    corepackCommand,
    [
      'pnpm',
      'exec',
      'dotenv',
      '-e',
      '.env',
      '-e',
      '.env.test.local',
      '--',
      'vitest',
      'run',
      `--shard=${shard}/${totalShards}`,
    ],
    {
      cwd: appRoot,
      stdio: 'inherit',
      env: process.env,
    },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}