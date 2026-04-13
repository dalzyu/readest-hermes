import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { describe, expect, test } from 'vitest';
import packageJson from '../../../../package.json';
import { buildCloudflareCommand } from '../../../../scripts/cloudflare-build.mjs';

describe('Cloudflare build orchestration', () => {
  test('package scripts do not mutate tracked files in place', () => {
    expect(packageJson.scripts.preview).not.toContain('patch-build-webpack');
    expect(packageJson.scripts.deploy).not.toContain('restore-build-original');
    expect(packageJson.scripts.upload).not.toContain('patch-build-webpack');
    expect((packageJson.scripts as Record<string, string | undefined>)['config-wrangler']).toBeUndefined();
  });

  test('helper builds preview command without package mutation', () => {
    const command = buildCloudflareCommand('preview');

    expect(command.prebuildCommand).toEqual(['pnpm', 'build-web:cloudflare']);
    expect(command.buildArgs).toEqual(['exec', 'opennextjs-cloudflare', 'build']);
    expect(command.runArgs).toEqual([
      'exec',
      'opennextjs-cloudflare',
      'preview',
      '--ip',
      '0.0.0.0',
      '--port',
      '3001',
    ]);
    expect(command.env.NEXT_PUBLIC_APP_PLATFORM).toBe('web');
  });

  test('helper builds deploy and upload commands without preview-only flags', () => {
    expect(buildCloudflareCommand('deploy').runArgs).toEqual([
      'exec',
      'opennextjs-cloudflare',
      'deploy',
    ]);
    expect(buildCloudflareCommand('upload').runArgs).toEqual([
      'exec',
      'opennextjs-cloudflare',
      'upload',
    ]);
  });

  test('helper script supports dry-run execution as a real script entrypoint', () => {
    const result = spawnSync('node', ['scripts/cloudflare-build.mjs', 'preview', '--dry-run'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"build-web:cloudflare"');
    expect(result.stdout).toContain('"preview"');
    expect(result.stdout).toContain('"0.0.0.0"');
  });

  test('helper source contains no sed-based tracked-file mutation', () => {
    const helperSource = fs.readFileSync('scripts/cloudflare-build.mjs', 'utf8');

    expect(helperSource).not.toContain('sed -i');
  });
});
