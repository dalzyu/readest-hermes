import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

function runCommand(command, args, env) {
  return spawnSync(command, args, {
    env,
    stdio: 'inherit',
    shell: true,
  });
}

export function buildCloudflareCommand(mode) {
  const validModes = new Set(['preview', 'deploy', 'upload']);
  if (!validModes.has(mode)) {
    throw new Error(`Unsupported Cloudflare mode: ${mode}`);
  }

  const previewArgs = mode === 'preview' ? ['--ip', '0.0.0.0', '--port', '3001'] : [];

  return {
    env: { ...process.env, NEXT_PUBLIC_APP_PLATFORM: 'web' },
    prebuildCommand: ['pnpm', 'build-web:cloudflare'],
    buildArgs: ['exec', 'opennextjs-cloudflare', 'build'],
    runArgs: ['exec', 'opennextjs-cloudflare', mode, ...previewArgs],
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  const command = buildCloudflareCommand(mode);

  if (dryRun) {
    process.stdout.write(
      JSON.stringify({
        prebuild: command.prebuildCommand,
        build: ['pnpm', ...command.buildArgs],
        run: ['pnpm', ...command.runArgs],
      }),
    );
    process.exit(0);
  }

  const prebuildResult = runCommand(
    command.prebuildCommand[0],
    command.prebuildCommand.slice(1),
    command.env,
  );
  if (prebuildResult.status !== 0) {
    process.exit(prebuildResult.status ?? 1);
  }

  const buildResult = runCommand('pnpm', command.buildArgs, command.env);
  if (buildResult.status !== 0) {
    process.exit(buildResult.status ?? 1);
  }

  const runResult = runCommand('pnpm', command.runArgs, command.env);
  process.exit(runResult.status ?? 1);
}
