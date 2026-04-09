import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import packageJson from '../../../../package.json';

const repoRoot = path.resolve(import.meta.dirname, '../../../../../..');
const tauriConfigPath = path.resolve(import.meta.dirname, '../../../../src-tauri/tauri.conf.json');
const defaultCapabilityPath = path.resolve(import.meta.dirname, '../../../../src-tauri/capabilities/default.json');
const desktopCapabilityPath = path.resolve(import.meta.dirname, '../../../../src-tauri/capabilities/desktop.json');
const releaseWorkflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/release.yml'), 'utf8');
const prWorkflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/pull-request.yml'), 'utf8');
const workspaceCargo = fs.readFileSync(path.join(repoRoot, 'Cargo.toml'), 'utf8');
const sparseIo = fs.readFileSync(path.join(repoRoot, 'packages/turso-sync-engine/src/sparse_io.rs'), 'utf8');
const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, 'utf8')) as {
  build: { beforeDevCommand: string; beforeBuildCommand: string };
};
const defaultCapability = JSON.parse(fs.readFileSync(defaultCapabilityPath, 'utf8')) as {
  permissions: Array<string | { identifier: string }>;
};
const desktopCapability = JSON.parse(fs.readFileSync(desktopCapabilityPath, 'utf8')) as {
  permissions: Array<string | { identifier: string }>;
};
const prLines = prWorkflow.split('\n').map((line) => line.trim());
const releaseLines = releaseWorkflow.split('\n').map((line) => line.trim());

describe('workflow alignment', () => {
  test('PR workflow uses canonical app scripts', () => {
    expect(prLines).toContain('run: xvfb-run pnpm test:pr:tauri');
    expect(prWorkflow).toContain('pnpm test:pr:web');
    expect(prWorkflow).toContain('pnpm build-web && pnpm check:all');
    expect(prWorkflow).not.toContain('build-web:vinext');
  });

  test('release workflow matrix matches the normalized local wrapper set', () => {
    expect(releaseLines).toContain('rust_target: x86_64-pc-windows-msvc');
    expect(releaseLines).toContain('rust_target: aarch64-pc-windows-msvc');
    expect(releaseLines).toContain('rust_target: x86_64-unknown-linux-gnu');
    expect(releaseLines).toContain('rust_target: aarch64-unknown-linux-gnu');
    expect(releaseLines).toContain('rust_target: arm-unknown-linux-gnueabihf');
    expect(releaseWorkflow).toContain("args: '--target universal-apple-darwin'");
    expect(releaseLines).toContain(
      'rust_target: aarch64-linux-android,armv7-linux-androideabi,i686-linux-android,x86_64-linux-android',
    );

    expect(packageJson.scripts['build-win-x64']).toContain('x86_64-pc-windows-msvc');
    expect(packageJson.scripts['build-win-arm64']).toContain('aarch64-pc-windows-msvc');
    expect(packageJson.scripts['build-linux-x64']).toContain('x86_64-unknown-linux-gnu');
    expect(packageJson.scripts['build-linux-aarch64']).toContain('aarch64-unknown-linux-gnu');
    expect(packageJson.scripts['build-linux-armhf']).toContain('arm-unknown-linux-gnueabihf');
    expect(packageJson.scripts['build-macos-universal']).toContain('universal-apple-darwin');
  });

  test('desktop-only permissions stay out of the shared capability set', () => {
    expect(defaultCapability.permissions).not.toContain('turso:default');
    expect(desktopCapability.permissions).toContain('turso:default');
  });

  test('fork release workflow uses unsigned local packaging instead of release uploads', () => {
    expect(releaseWorkflow).toContain("if: matrix.config.release == 'android' && github.repository != 'readest/readest'");
    expect(releaseWorkflow).toContain("if: matrix.config.release != 'android' && github.repository != 'readest/readest'");
    expect(releaseWorkflow).toContain("name: upload Android apks to GitHub release (fork only)");
    expect(releaseWorkflow).toContain("name: upload desktop bundles to GitHub release (fork only)");
    expect(releaseWorkflow).toContain("find target -path '*/release/bundle/*' -type f");
    expect(releaseWorkflow).toContain("-name '*.AppImage'");
    expect(releaseWorkflow).toContain("-name '*.deb'");
    expect(releaseWorkflow).toContain("-name '*.dmg'");
    expect(releaseWorkflow).toContain("-name '*.exe'");
    expect(releaseWorkflow).toContain("-name '*.msi'");
    expect(releaseWorkflow).toContain("if: matrix.config.release != 'android' && github.repository == 'readest/readest'");
    expect(releaseWorkflow).toContain("if: github.repository == 'readest/readest'");
  });

  test('armhf release builds include the io-uring arch workaround', () => {
    expect(releaseWorkflow).toContain(
      "echo 'CARGO_TARGET_ARM_UNKNOWN_LINUX_GNUEABIHF_RUSTFLAGS=--cfg=io_uring_skip_arch_check' >> $GITHUB_ENV",
    );
  });

  test('workspace patches turso_sync_engine to the local armhf-safe fork', () => {
    expect(workspaceCargo).toContain('turso_sync_engine = { path = "packages/turso-sync-engine" }');
    expect(sparseIo).toContain('pos as libc::off_t');
    expect(sparseIo).toContain('len as libc::off_t');
  });

  test('workflow dispatch can create a release when the fork has no existing release object', () => {
    expect(releaseWorkflow).toContain('getReleaseByTag');
    expect(releaseWorkflow).toContain('createRelease');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: testing literal JS code content in workflow file
    expect(releaseWorkflow).toContain("const tag = `v${process.env.PACKAGE_VERSION}`;");
  });

  test('tauri hooks use the same package-manager entrypoint as local builds', () => {
    expect(tauriConfig.build.beforeDevCommand).toBe('corepack pnpm dev');
    expect(tauriConfig.build.beforeBuildCommand).toBe('corepack pnpm build');
  });
});
