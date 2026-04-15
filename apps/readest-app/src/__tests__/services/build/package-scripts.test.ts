import { describe, expect, test } from 'vitest';
import packageJson from '../../../../package.json';

describe('package build scripts', () => {
  test('keeps upstream canonical script names', () => {
    expect(packageJson.scripts.dev).toBeDefined();
    expect(packageJson.scripts.build).toBeDefined();
    expect(packageJson.scripts.start).toBeDefined();
    expect(packageJson.scripts['dev-web']).toBeDefined();
    expect(packageJson.scripts['build-web']).toBeDefined();
    expect(packageJson.scripts['start-web']).toBeDefined();
    expect(packageJson.scripts['test:pr:web']).toBeDefined();
    expect(packageJson.scripts['test:pr:tauri']).toBeDefined();
  });

  test('keeps build-tauri as a pure alias to build', () => {
    expect(packageJson.scripts['build-tauri']).toBe(packageJson.scripts.build);
  });

  test('uses correct Windows x86_64 target', () => {
    expect(packageJson.scripts['build-win-x64']).toContain('x86_64-pc-windows-msvc');
    expect(packageJson.scripts['build-win-x64']).not.toContain('i686-pc-windows-msvc');
    expect(packageJson.scripts['build-win-x64']).toContain('src-tauri/tauri.local.conf.json');
  });

  test('keeps the other release wrapper targets aligned', () => {
    expect(packageJson.scripts['build-win-arm64']).toContain('aarch64-pc-windows-msvc');
    expect(packageJson.scripts['build-linux-x64']).toContain('x86_64-unknown-linux-gnu');
    expect(packageJson.scripts['build-linux-aarch64']).toContain('aarch64-unknown-linux-gnu');
    expect(packageJson.scripts['build-linux-armhf']).toContain('arm-unknown-linux-gnueabihf');
    expect(packageJson.scripts['build-win-arm64']).toContain('src-tauri/tauri.local.conf.json');
    expect(packageJson.scripts['build-linux-x64']).toContain('src-tauri/tauri.local.conf.json');
    expect(packageJson.scripts['build-linux-aarch64']).toContain('src-tauri/tauri.local.conf.json');
    expect(packageJson.scripts['build-linux-armhf']).toContain('src-tauri/tauri.local.conf.json');
  });

  test('exposes the corrected macOS canonical names', () => {
    expect(packageJson.scripts['build-macos-universal']).toContain('universal-apple-darwin');
    expect(packageJson.scripts['build-macos-universal']).toContain('src-tauri/tauri.local.conf.json');
    expect(packageJson.scripts['build-macos-universal-appstore']).toContain(
      'src-tauri/tauri.appstore.conf.json',
    );
    expect(packageJson.scripts['build-macos-universal-appstore-dev']).toContain(
      'src-tauri/tauri.appstore-dev.conf.json',
    );
    expect(packageJson.scripts['release-macos-universal-appstore']).toContain(
      'scripts/release-mac-appstore.sh',
    );
  });

  test('keeps a dedicated Cloudflare web build entrypoint', () => {
    expect(packageJson.scripts['build-web:cloudflare']).toContain('next build --webpack');
  });

  test('uses corepack for nested package-manager script orchestration', () => {
    expect(packageJson.scripts['setup-vendors']).toContain('corepack pnpm');
    expect(packageJson.scripts['copy-pdfjs']).toContain('corepack pnpm');
    expect(packageJson.scripts['build-check']).toContain('corepack pnpm');
  });

  test('routes build-output checks through the shared Node helper', () => {
    expect(packageJson.scripts['check:translations']).toContain('scripts/check-build-output.mjs');
    expect(packageJson.scripts['check:optional-chaining']).toContain(
      'scripts/check-build-output.mjs',
    );
    expect(packageJson.scripts['check:lookbehind-regex']).toContain(
      'scripts/check-build-output.mjs',
    );
  });

  test('routes generic local tauri commands through the local override config', () => {
    expect(packageJson.scripts['tauri']).toContain('scripts/tauri-local.mjs');
    expect(packageJson.scripts['tauri:build:test']).toContain('scripts/tauri-local.mjs');
  });
});
