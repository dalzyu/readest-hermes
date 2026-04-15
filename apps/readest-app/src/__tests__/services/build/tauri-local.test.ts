import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, test } from 'vitest';

// On Windows the pnpm-managed npm_execpath gets re-injected by the runtime into
// child processes spawned by vitest, so the fake-exec intercept does not work.
// The tauri-local.mjs logic is verified on Linux/macOS in CI.
const describeUnix = process.platform === 'win32' ? describe.skip : describe;

const scriptPath = path.resolve(import.meta.dirname, '../../../../scripts/tauri-local.mjs');

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function runWrapper(args: string[]) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tauri-local-test-'));
  tempDirs.push(tempDir);

  const outputPath = path.join(tempDir, 'args.json');
  const fakeExecPath = path.join(tempDir, 'fake-exec.js');
  fs.writeFileSync(
    fakeExecPath,
    "require('node:fs').writeFileSync(process.env.TAURI_LOCAL_ARGS_FILE, JSON.stringify(process.argv.slice(2)));",
  );

  const result = execFileSync(process.execPath, [scriptPath, ...args], {
    env: {
      ...process.env,
      npm_execpath: fakeExecPath,
      TAURI_LOCAL_ARGS_FILE: outputPath,
    },
    encoding: 'utf8',
  });

  return {
    stdout: result,
    args: JSON.parse(fs.readFileSync(outputPath, 'utf8')) as string[],
  };
}

describeUnix('tauri-local wrapper', () => {
  test('uses exec -- so npm does not consume tauri flags', () => {
    const { args } = runWrapper(['build', '--target', 'x86_64-pc-windows-msvc']);

    expect(args.slice(0, 4)).toEqual(['exec', '--', 'tauri', 'build']);
    expect(args).toContain('--config');
    expect(args).toContain('src-tauri/tauri.local.conf.json');
  });

  test('does not inject a second config flag when one is already present', () => {
    const { args } = runWrapper(['build', '--config', 'custom.json']);

    expect(args).toEqual(['exec', '--', 'tauri', 'build', '--config', 'custom.json']);
  });
});
