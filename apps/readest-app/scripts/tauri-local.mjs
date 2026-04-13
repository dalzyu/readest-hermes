import { spawnSync } from 'node:child_process';
import process from 'node:process';

const npmExecPath = process.env.npm_execpath;
if (!npmExecPath) {
  console.error('npm_execpath is not set; run this script through pnpm.');
  process.exit(1);
}

const args = process.argv.slice(2);
const command = args[0];
const shouldInjectLocalConfig =
  (command === 'build' || command === 'dev') && !args.includes('--config');

const tauriArgs = ['exec', '--', 'tauri', ...args];
if (shouldInjectLocalConfig) {
  tauriArgs.splice(4, 0, '--config', 'src-tauri/tauri.local.conf.json');
}

const result = spawnSync(process.execPath, [npmExecPath, ...tauriArgs], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);
