import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { describe, expect, test } from 'vitest';

import { middleware } from '@/middleware';
import packageJson from '../../../../package.json';

const repoRoot = path.resolve(import.meta.dirname, '../../../../../..');
const tauriConfigPath = path.resolve(import.meta.dirname, '../../../../src-tauri/tauri.conf.json');
const defaultCapabilityPath = path.resolve(
  import.meta.dirname,
  '../../../../src-tauri/capabilities/default.json',
);
const desktopCapabilityPath = path.resolve(
  import.meta.dirname,
  '../../../../src-tauri/capabilities/desktop.json',
);
const webdriverCapabilityPath = path.resolve(
  import.meta.dirname,
  '../../../../src-tauri/capabilities-extra/webdriver.json',
);
const releaseWorkflow = fs.readFileSync(
  path.join(repoRoot, '.github/workflows/release.yml'),
  'utf8',
);
const prWorkflow = fs.readFileSync(
  path.join(repoRoot, '.github/workflows/pull-request.yml'),
  'utf8',
);
const workspaceCargo = fs.readFileSync(path.join(repoRoot, 'Cargo.toml'), 'utf8');
const sparseIo = fs.readFileSync(
  path.join(repoRoot, 'packages/turso-sync-engine/src/sparse_io.rs'),
  'utf8',
);
const securityPolicy = fs.readFileSync(path.join(repoRoot, 'SECURITY.md'), 'utf8');
const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, 'utf8')) as {
  productName: string;
  mainBinaryName: string;
  version: string;
  build: { beforeDevCommand: string; beforeBuildCommand: string };
  app: { security: { csp: Record<string, string>; assetProtocol: { scope: { allow: string[] } } } };
  plugins: {
    'deep-link': {
      mobile: Array<{ host?: string; scheme?: string[]; pathPrefix?: string[] }>;
      desktop: { schemes: string[] };
    };
  };
};
const defaultCapability = JSON.parse(fs.readFileSync(defaultCapabilityPath, 'utf8')) as {
  permissions: Array<
    | string
    | {
        identifier: string;
        allow?: Array<{
          url?: string;
          path?: string;
          args?: Array<string | { validator?: string }>;
        }>;
      }
  >;
};
const desktopCapability = JSON.parse(fs.readFileSync(desktopCapabilityPath, 'utf8')) as {
  permissions: Array<string | { identifier: string }>;
};
const webdriverCapability = JSON.parse(fs.readFileSync(webdriverCapabilityPath, 'utf8')) as {
  permissions: Array<string | { identifier: string; allow?: Array<{ path: string }> }>;
};
const prLines = prWorkflow.split('\n').map((line) => line.trim());
const releaseLines = releaseWorkflow.split('\n').map((line) => line.trim());
const updaterWindow = fs.readFileSync(
  path.join(repoRoot, 'apps/readest-app/src/components/UpdaterWindow.tsx'),
  'utf8',
);
const authPage = fs.readFileSync(
  path.join(repoRoot, 'apps/readest-app/src/app/auth/page.tsx'),
  'utf8',
);
const iosSafariAuth = fs.readFileSync(
  path.join(repoRoot, 'apps/readest-app/src-tauri/src/macos/safari_auth.rs'),
  'utf8',
);
const iosNativeBridgeAuth = fs.readFileSync(
  path.join(
    repoRoot,
    'apps/readest-app/src-tauri/plugins/tauri-plugin-native-bridge/ios/Sources/NativeBridgePlugin.swift',
  ),
  'utf8',
);
const androidNativeBridgeAuth = fs.readFileSync(
  path.join(
    repoRoot,
    'apps/readest-app/src-tauri/plugins/tauri-plugin-native-bridge/android/src/main/java/NativeBridgePlugin.kt',
  ),
  'utf8',
);

describe('workflow alignment', () => {
  test('PR workflow uses canonical app scripts and the Hermes crate name', () => {
    expect(prLines).toContain('run: xvfb-run pnpm test:pr:tauri');
    expect(prWorkflow).toContain('pnpm test:pr:web');
    expect(prWorkflow).toContain('pnpm build-web && pnpm check:all');
    expect(prWorkflow).toContain('cargo clippy -p Hermes --no-deps -- -D warnings');
    expect(prWorkflow).not.toContain('cargo clippy -p Readest');
    expect(prWorkflow).not.toContain('build-web:vinext');
  });

  test('release workflow prepares vendor assets from the app directory instead of a stale package filter', () => {
    expect(releaseWorkflow).toContain('- name: copy pdfjs-dist and simplecc-dist to public directory');
    expect(releaseWorkflow).toContain('working-directory: apps/readest-app');
    expect(releaseWorkflow).toContain('run: pnpm setup-vendors');
    expect(releaseWorkflow).not.toContain('pnpm --filter @readest/readest-app setup-vendors');
  });

  test('Hermes release workflow no longer packages the KOReader plugin', () => {
    expect(releaseWorkflow).not.toContain('build-koreader-plugin');
    expect(releaseWorkflow).not.toContain('readest.koplugin');
    expect(releaseWorkflow).not.toContain('.koplugin.zip');
  });

  test('PR tauri job includes format and lint checks before tests', () => {
    expect(prWorkflow).toContain('- name: run format check');
    expect(prWorkflow).toContain('working-directory: apps/readest-app');
    expect(prWorkflow).toContain('pnpm format:check');
    expect(prWorkflow).toContain('- name: run lint');
    expect(prWorkflow).toContain('pnpm lint');
    expect(prWorkflow).toContain('cargo clippy -p Hermes --no-deps -- -D warnings');
    expect(prWorkflow).toContain('xvfb-run pnpm test:pr:tauri');
  });


  test('release workflow matrix matches the normalized local wrapper set', () => {
    expect(releaseLines).toContain('rust_target: x86_64-pc-windows-msvc');
    expect(releaseLines).toContain('rust_target: aarch64-pc-windows-msvc');
    expect(releaseLines).toContain('rust_target: x86_64-unknown-linux-gnu');
    expect(releaseWorkflow).toContain("args: '--target universal-apple-darwin'");
    expect(releaseLines).toContain(
      'rust_target: aarch64-linux-android,armv7-linux-androideabi,i686-linux-android,x86_64-linux-android',
    );

    expect(packageJson.scripts['build-win-x64']).toContain('x86_64-pc-windows-msvc');
    expect(packageJson.scripts['build-win-arm64']).toContain('aarch64-pc-windows-msvc');
    expect(packageJson.scripts['build-linux-x64']).toContain('x86_64-unknown-linux-gnu');
    expect(packageJson.scripts['build-macos-universal']).toContain('universal-apple-darwin');
  });

  test('release workflow targets only the supported 0.1.0 platforms', () => {
    expect(releaseWorkflow).toContain("- os: ubuntu-latest");
    expect(releaseWorkflow).toContain("release: android");
    expect(releaseWorkflow).toContain("- os: ubuntu-22.04");
    expect(releaseWorkflow).toContain("release: linux");
    expect(releaseWorkflow).toContain("rust_target: x86_64-unknown-linux-gnu");
    expect(releaseWorkflow).toContain("- os: macos-latest");
    expect(releaseWorkflow).toContain("release: macos");
    expect(releaseWorkflow).toContain("- os: windows-latest");
    expect(releaseWorkflow).toContain("rust_target: x86_64-pc-windows-msvc");
    expect(releaseWorkflow).toContain("rust_target: aarch64-pc-windows-msvc");
    expect(releaseWorkflow).not.toContain('ubuntu-22.04-arm');
    expect(releaseWorkflow).not.toContain('arm-unknown-linux-gnueabihf');
    expect(releaseWorkflow).not.toContain('aarch64-unknown-linux-gnu');
  });


  test('desktop tauri CSP and HTTP permissions keep required third-party domains without Readest hosts', () => {
    const { csp } = tauriConfig.app.security;

    expect(csp['connect-src']).not.toContain('https://*.readest.com');
    expect(csp['connect-src']).toContain('https://*.sentry.io');
    expect(csp['connect-src']).toContain('https://*.posthog.com');
    expect(csp['connect-src']).toContain('https://*.deepl.com');
    expect(csp['connect-src']).toContain('https://*.cloudflarestorage.com');
    expect(csp['connect-src']).toContain('https://translate.googleapis.com');
    expect(csp['connect-src']).toContain('https://translate.toil.cc');
    expect(csp['connect-src']).toContain('https://*.microsofttranslator.com');
    expect(csp['connect-src']).toContain('https://edge.microsoft.com');

    expect(csp['style-src']).not.toContain('https://storage.readest.com');
    expect(csp['style-src']).toContain('https://fonts.googleapis.com');
    expect(csp['style-src']).toContain('https://cdnjs.cloudflare.com');
    expect(csp['font-src']).not.toContain('https://storage.readest.com');
    expect(csp['font-src']).toContain('https://db.onlinewebfonts.com');
    expect(csp['font-src']).toContain('https://fonts.gstatic.com');
    expect(csp['font-src']).toContain('https://cdnjs.cloudflare.com');

    const httpDefaultCapability = defaultCapability.permissions.find(
      (permission): permission is {
        identifier: string;
        allow: Array<{ url?: string }>;
      } =>
        typeof permission !== 'string' &&
        permission.identifier === 'http:default' &&
        Array.isArray(permission.allow),
    );

    const allowedUrls = (httpDefaultCapability?.allow ?? [])
      .map((entry) => entry.url)
      .filter((url): url is string => typeof url === 'string');

    expect(allowedUrls).not.toContain('https://*.readest.com');
    expect(allowedUrls).toEqual(
      expect.arrayContaining([
        'https://github.com/dalzyu/readest-hermes/*',
        'https://*.deepl.com',
        'https://*.cloudflarestorage.com',
        'https://edge.microsoft.com',
        'https://translate.toil.cc',
        'https://*.microsofttranslator.com',
        'https://translate.googleapis.com',
        'http://*:*',
        'https://*:*',
        'http://*',
        'https://*',
      ]),
    );
  });

  test('desktop-only permissions stay out of the shared capability set', () => {
    expect(defaultCapability.permissions).not.toContain('turso:default');
    expect(desktopCapability.permissions).toContain('turso:default');
  });

  test('Hermes updater filenames match the shell allowlist', () => {
    expect(updaterWindow).toContain(`const exeFileName = \`Hermes_\${data.version}_\${arch}-portable.exe\`;`);
    expect(updaterWindow).toContain(`const appImageFileName = \`Hermes_\${data.version}_\${arch}.AppImage\`;`);

    const shellSpawnCapability = defaultCapability.permissions.find(
      (
        permission,
      ): permission is {
        identifier: string;
        allow: Array<{
          args?: Array<string | { validator?: string }>;
        }>;
      } =>
        typeof permission !== 'string' &&
        permission.identifier === 'shell:allow-spawn' &&
        Array.isArray(permission.allow),
    );

    const validators: string[] = [];
    for (const permissionEntry of shellSpawnCapability?.allow ?? []) {
      for (const argument of permissionEntry.args ?? []) {
        if (
          typeof argument === 'object' &&
          argument !== null &&
          'validator' in argument &&
          typeof argument.validator === 'string'
        ) {
          validators.push(argument.validator);
        }
      }
    }

    expect(validators).toContain('^.*Hermes(.*)\\.exe$');
    expect(validators).toContain('^.*Hermes(.*)\\.AppImage$');

    const exeValidatorSource = validators.find((validator) => validator.endsWith('\\.exe$'));
    const appImageValidatorSource = validators.find((validator) =>
      validator.endsWith('\\.AppImage$'),
    );

    expect(exeValidatorSource).toBeDefined();
    expect(appImageValidatorSource).toBeDefined();

    const exeValidator = new RegExp(exeValidatorSource!);
    const appImageValidator = new RegExp(appImageValidatorSource!);

    expect(exeValidator.test('Hermes_1.2.3_x64-portable.exe')).toBe(true);
    expect(exeValidator.test('Hermes_1.2.3_arm64-portable.exe')).toBe(true);
    expect(appImageValidator.test('Hermes_1.2.3_x86_64.AppImage')).toBe(true);
    expect(appImageValidator.test('Hermes_1.2.3_aarch64.AppImage')).toBe(true);
  });

  test('fork release workflow uses unsigned local packaging instead of release uploads', () => {
    expect(releaseWorkflow).toContain(
      "if: matrix.config.release == 'android' && github.repository != 'readest/readest'",
    );
    expect(releaseWorkflow).toContain(
      "if: matrix.config.release != 'android' && github.repository != 'readest/readest'",
    );
    expect(releaseWorkflow).toContain('name: upload Android apks to GitHub release (fork only)');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: testing literal shell variables in workflow content
    expect(releaseWorkflow).toContain('upload_name="Hermes_' + '${version}' + '_' + '${flavor}"');
    expect(releaseWorkflow).toContain('name: upload desktop bundles to GitHub release (fork only)');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: testing literal workflow expression in shell content
    expect(releaseWorkflow).toContain('case "' + '${{ matrix.config.release }}' + '" in');
    expect(releaseWorkflow).toContain("-path '*/release/bundle/appimage/*.AppImage'");
    expect(releaseWorkflow).toContain("-path '*/release/bundle/deb/*.deb'");
    expect(releaseWorkflow).toContain("-path '*/release/bundle/dmg/*.dmg'");
    expect(releaseWorkflow).toContain("-path '*/release/bundle/nsis/*.exe'");
    expect(releaseWorkflow).toContain("-path '*/release/bundle/msi/*.msi'");
    expect(releaseWorkflow).not.toContain("find target -path '*/release/bundle/*' -type f");
    expect(releaseWorkflow).toContain(
      "if: matrix.config.release != 'android' && github.repository == 'readest/readest'",
    );
    expect(releaseWorkflow).toContain("if: github.repository == 'readest/readest'");
  });

  test('android release flow keeps the freshly generated project instead of restoring stale tracked sources', () => {
    expect(releaseWorkflow).not.toContain('git checkout .');
  });

  test('android release flow restores the store flavor wiring after regenerating the project', () => {
    expect(releaseWorkflow).toContain('missingDimensionStrategy("store", storeFlavor)');
    expect(releaseWorkflow).toContain('ORG_GRADLE_PROJECT_storeFlavor=foss pnpm tauri android build');
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
    expect(releaseWorkflow).toContain('const tag = `v${process.env.PACKAGE_VERSION}`;');
  });

  test('Hermes release metadata stays decoupled from upstream versioning', () => {
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packageJson.version).not.toBe('0.0.0');
    expect(releaseWorkflow).toContain('name: Release Hermes');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: testing literal JS template expression embedded in workflow YAML
    expect(releaseWorkflow).toContain('name: `Hermes ' + '${process.env.PACKAGE_VERSION}' + '`');
    expect(releaseWorkflow).toContain("make_latest: 'true'");
    expect(tauriConfig.productName).toBe('Hermes');
    expect(tauriConfig.mainBinaryName).toBe('hermes');
    expect(tauriConfig.version).toBe('../package.json');
  });

  test('security support table reflects the current maintained Hermes line', () => {
    const [major, minor] = packageJson.version.split('.');
    const supportedLine = `${major}.${minor}.x`;

    expect(securityPolicy).toContain(`| ${supportedLine}   | :white_check_mark: |`);
    expect(securityPolicy).toContain(`| < ${major}.${minor}   | :x:                |`);
  });

  test('Cargo.toml version matches package.json version', () => {
    const cargoToml = fs.readFileSync(
      path.resolve(import.meta.dirname, '../../../../src-tauri/Cargo.toml'),
      'utf8',
    );
    const cargoVersionMatch = cargoToml.match(/^version\s*=\s*"([^"]+)"/m);
    expect(cargoVersionMatch?.[1]).toBe(packageJson.version);
  });

  test('release-notes.json has an entry for the current version', () => {
    const releaseNotes = JSON.parse(
      fs.readFileSync(
        path.resolve(import.meta.dirname, '../../../../release-notes.json'),
        'utf8',
      ),
    ) as { releases: Record<string, unknown> };
    expect(releaseNotes.releases).toHaveProperty(packageJson.version);
  });

  test('tauri hooks use the same package-manager entrypoint as local builds', () => {
    expect(tauriConfig.build.beforeDevCommand).toBe('corepack pnpm dev');
    expect(tauriConfig.build.beforeBuildCommand).toBe('corepack pnpm build');
  });

  test('Hermes OAuth callback URI stays aligned with Tauri deep-link registration', () => {
    expect(authPage).toContain("const DEEPLINK_CALLBACK = 'hermes://auth-callback';");
    expect(tauriConfig.plugins['deep-link'].desktop.schemes).toEqual(['hermes']);
    expect(tauriConfig.plugins['deep-link'].mobile).toEqual([
      { host: 'auth-callback', scheme: ['hermes'] },
    ]);
    expect(iosSafariAuth).toContain('NSString::from_str("hermes")');
    expect(iosNativeBridgeAuth).toContain('callbackURLScheme: "hermes"');
    expect(androidNativeBridgeAuth).toContain('private val redirectScheme = "hermes"');
    expect(androidNativeBridgeAuth).toContain('private val redirectHost = "auth-callback"');
    expect(androidNativeBridgeAuth).toContain('uri.scheme == redirectScheme &&');
    expect(androidNativeBridgeAuth).toContain('uri.host == redirectHost -> {');
  });

  test('middleware allows same-origin and local Tauri origins without upstream fallback', () => {
    const requestUrl = 'https://api.hermes.example/api/books';
    const sameOrigin = new URL(requestUrl).origin;
    const allowedOrigins = [
      sameOrigin,
      'http://localhost:3000',
      'http://localhost:3001',
      'http://tauri.localhost',
      'https://tauri.localhost',
      'tauri://localhost',
    ] as const;

    for (const method of ['GET', 'OPTIONS'] as const) {
      for (const origin of allowedOrigins) {
        const response = middleware(
          new NextRequest(requestUrl, {
            method,
            headers: { origin },
          }),
        );
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
      }

      const upstreamResponse = middleware(
        new NextRequest(requestUrl, {
          method,
          headers: { origin: 'https://web.readest.com' },
        }),
      );
      expect(upstreamResponse.headers.get('Access-Control-Allow-Origin')).toBeNull();
    }
  });

  test('desktop tauri scopes preserve legacy Readest paths and webdriver fixture access', () => {
    expect(tauriConfig.app.security.assetProtocol.scope.allow).toContain('**/Readest/**/*');

    const webdriverFsScope = webdriverCapability.permissions.find(
      (permission): permission is { identifier: string; allow: Array<{ path: string }> } =>
        typeof permission !== 'string' && permission.identifier === 'fs:scope',
    );

    expect(webdriverFsScope?.allow.map((entry) => entry.path)).toContain(
      '**/src/__tests__/fixtures/data/**/*',
    );
    expect(webdriverCapability.permissions).toContain('fs:allow-open');
  });
});
