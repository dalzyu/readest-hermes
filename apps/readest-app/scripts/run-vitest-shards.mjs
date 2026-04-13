import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const totalShards = Number.parseInt(process.argv[2] ?? '1', 10);
const isolatedFiles = ['src/__tests__/hooks/useContextDictionary.test.ts'];

if (!Number.isInteger(totalShards) || totalShards < 1) {
  console.error('Expected a positive shard count.');
  process.exit(1);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, '..');
const spawnCommand = process.platform === 'win32' ? 'corepack.cmd' : 'corepack';

const runVitest = (args) => {
  const result = spawnSync(
    spawnCommand,
    ['pnpm', 'exec', 'dotenv', '-e', '.env', '-e', '.env.test.local', '--', 'vitest', ...args],
    {
      cwd: appRoot,
      stdio: 'inherit',
      env: process.env,
      shell: process.platform === 'win32',
    },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

for (let shard = 1; shard <= totalShards; shard += 1) {
  runVitest([
    'run',
    `--shard=${shard}/${totalShards}`,
    ...isolatedFiles.flatMap((file) => ['--exclude', file]),
  ]);
}

for (const file of isolatedFiles) {
  runVitest(['run', '--pool=threads', '--maxWorkers=1', file]);
}
