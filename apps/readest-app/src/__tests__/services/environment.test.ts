import { describe, test, expect, beforeEach, vi } from 'vitest';

// ── Mocks for constants ──────────────────────────────────────────
vi.mock('@/services/constants', () => ({
  CLOUD_ENABLED: false,
}));

// We need to reset modules between tests to pick up env var changes,
// so we import dynamically in each test or test group.

// Cast process.env to a mutable record for test manipulation
const env = process.env as Record<string, string | undefined>;
const originalEnv = { ...env };

beforeEach(() => {
  vi.resetModules();
  Object.keys(env).forEach((key) => delete env[key]);
  Object.assign(env, originalEnv);
  // Clean up any window globals we set
  delete (window as unknown as Record<string, unknown>)['__HERMES_CLI_ACCESS'];
});

describe('environment', () => {
  // ── isTauriAppPlatform ─────────────────────────────────────────
  describe('isTauriAppPlatform', () => {
    test('returns true when NEXT_PUBLIC_APP_PLATFORM is tauri', async () => {
      env['NEXT_PUBLIC_APP_PLATFORM'] = 'tauri';
      const { isTauriAppPlatform } = await import('@/services/environment');
      expect(isTauriAppPlatform()).toBe(true);
    });

    test('returns false when NEXT_PUBLIC_APP_PLATFORM is web', async () => {
      env['NEXT_PUBLIC_APP_PLATFORM'] = 'web';
      const { isTauriAppPlatform } = await import('@/services/environment');
      expect(isTauriAppPlatform()).toBe(false);
    });

    test('returns false when NEXT_PUBLIC_APP_PLATFORM is not set', async () => {
      delete env['NEXT_PUBLIC_APP_PLATFORM'];
      const { isTauriAppPlatform } = await import('@/services/environment');
      expect(isTauriAppPlatform()).toBe(false);
    });
  });

  // ── isWebAppPlatform ───────────────────────────────────────────
  describe('isWebAppPlatform', () => {
    test('returns true when NEXT_PUBLIC_APP_PLATFORM is web', async () => {
      env['NEXT_PUBLIC_APP_PLATFORM'] = 'web';
      const { isWebAppPlatform } = await import('@/services/environment');
      expect(isWebAppPlatform()).toBe(true);
    });

    test('returns false when NEXT_PUBLIC_APP_PLATFORM is tauri', async () => {
      env['NEXT_PUBLIC_APP_PLATFORM'] = 'tauri';
      const { isWebAppPlatform } = await import('@/services/environment');
      expect(isWebAppPlatform()).toBe(false);
    });

    test('returns false when NEXT_PUBLIC_APP_PLATFORM is not set', async () => {
      delete env['NEXT_PUBLIC_APP_PLATFORM'];
      const { isWebAppPlatform } = await import('@/services/environment');
      expect(isWebAppPlatform()).toBe(false);
    });
  });

  // ── hasCli ─────────────────────────────────────────────────────
  describe('hasCli', () => {
    test('returns true when __HERMES_CLI_ACCESS is true', async () => {
      window.__HERMES_CLI_ACCESS = true;
      const { hasCli } = await import('@/services/environment');
      expect(hasCli()).toBe(true);
    });

    test('returns false when __HERMES_CLI_ACCESS is not set', async () => {
      const { hasCli } = await import('@/services/environment');
      expect(hasCli()).toBe(false);
    });

    test('returns false when __HERMES_CLI_ACCESS is explicitly false', async () => {
      window.__HERMES_CLI_ACCESS = false;
      const { hasCli } = await import('@/services/environment');
      expect(hasCli()).toBe(false);
    });
  });

  // ── isPWA ──────────────────────────────────────────────────────
  describe('isPWA', () => {
    test('returns false by default (jsdom matchMedia mock returns false)', async () => {
      const { isPWA } = await import('@/services/environment');
      expect(isPWA()).toBe(false);
    });

    test('returns true when display-mode is standalone', async () => {
      const originalMatchMedia = window.matchMedia;
      window.matchMedia = vi
        .fn()
        .mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;

      const { isPWA } = await import('@/services/environment');
      expect(isPWA()).toBe(true);

      window.matchMedia = originalMatchMedia;
    });
  });

  // ── getBaseUrl ─────────────────────────────────────────────────
  describe('getBaseUrl', () => {
    test('returns NEXT_PUBLIC_API_BASE_URL when set', async () => {
      env['NEXT_PUBLIC_API_BASE_URL'] = 'https://custom-api.example.com';
      const { getBaseUrl } = await import('@/services/environment');
      expect(getBaseUrl()).toBe('https://custom-api.example.com');
    });

    test('returns empty string when NEXT_PUBLIC_API_BASE_URL is not set in offline mode', async () => {
      delete env['NEXT_PUBLIC_API_BASE_URL'];
      const { getBaseUrl } = await import('@/services/environment');
      expect(getBaseUrl()).toBe('');
    });
  });

  // ── getNodeBaseUrl ─────────────────────────────────────────────
  describe('getNodeBaseUrl', () => {
    test('returns NEXT_PUBLIC_NODE_BASE_URL when set', async () => {
      env['NEXT_PUBLIC_NODE_BASE_URL'] = 'https://custom-node.example.com';
      const { getNodeBaseUrl } = await import('@/services/environment');
      expect(getNodeBaseUrl()).toBe('https://custom-node.example.com');
    });

    test('returns empty string when NEXT_PUBLIC_NODE_BASE_URL is not set in offline mode', async () => {
      delete env['NEXT_PUBLIC_NODE_BASE_URL'];
      const { getNodeBaseUrl } = await import('@/services/environment');
      expect(getNodeBaseUrl()).toBe('');
    });
  });

  // ── isMacPlatform ──────────────────────────────────────────────
  describe('isMacPlatform', () => {
    test('returns true when navigator.platform contains Mac', async () => {
      Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
      const { isMacPlatform } = await import('@/services/environment');
      expect(isMacPlatform()).toBe(true);
    });

    test('returns true when navigator.platform is iPhone', async () => {
      Object.defineProperty(navigator, 'platform', { value: 'iPhone', configurable: true });
      const { isMacPlatform } = await import('@/services/environment');
      expect(isMacPlatform()).toBe(true);
    });

    test('returns true when navigator.platform is iPad', async () => {
      Object.defineProperty(navigator, 'platform', { value: 'iPad', configurable: true });
      const { isMacPlatform } = await import('@/services/environment');
      expect(isMacPlatform()).toBe(true);
    });

    test('returns true when navigator.platform is iPod', async () => {
      Object.defineProperty(navigator, 'platform', { value: 'iPod', configurable: true });
      const { isMacPlatform } = await import('@/services/environment');
      expect(isMacPlatform()).toBe(true);
    });

    test('returns false when navigator.platform is Win32', async () => {
      Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
      const { isMacPlatform } = await import('@/services/environment');
      expect(isMacPlatform()).toBe(false);
    });

    test('returns false when navigator.platform is Linux', async () => {
      Object.defineProperty(navigator, 'platform', { value: 'Linux x86_64', configurable: true });
      const { isMacPlatform } = await import('@/services/environment');
      expect(isMacPlatform()).toBe(false);
    });
  });

  // ── getCommandPaletteShortcut ──────────────────────────────────
  describe('getCommandPaletteShortcut', () => {
    test('returns Mac shortcut on Mac platforms', async () => {
      Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
      const { getCommandPaletteShortcut } = await import('@/services/environment');
      expect(getCommandPaletteShortcut()).toContain('P');
    });

    test('returns Ctrl shortcut on non-Mac platforms', async () => {
      Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
      const { getCommandPaletteShortcut } = await import('@/services/environment');
      expect(getCommandPaletteShortcut()).toBe('Ctrl+Shift+P');
    });
  });

  // ── getAPIBaseUrl ──────────────────────────────────────────────
  describe('getAPIBaseUrl', () => {
    test('returns /api in web development mode', async () => {
      env['NODE_ENV'] = 'development';
      env['NEXT_PUBLIC_APP_PLATFORM'] = 'web';
      const { getAPIBaseUrl } = await import('@/services/environment');
      expect(getAPIBaseUrl()).toBe('/api');
    });

    test('returns configured API URL in web development mode when set', async () => {
      env['NODE_ENV'] = 'development';
      env['NEXT_PUBLIC_APP_PLATFORM'] = 'web';
      env['NEXT_PUBLIC_API_BASE_URL'] = 'https://custom-api.example.com';
      const { getAPIBaseUrl } = await import('@/services/environment');
      expect(getAPIBaseUrl()).toBe('https://custom-api.example.com/api');
    });

    test('returns relative path in production when base URL is unset', async () => {
      env['NODE_ENV'] = 'production';
      env['NEXT_PUBLIC_APP_PLATFORM'] = 'web';
      delete env['NEXT_PUBLIC_API_BASE_URL'];
      const { getAPIBaseUrl } = await import('@/services/environment');
      expect(getAPIBaseUrl()).toBe('/api');
    });

    test('returns relative path for tauri platform even in development when base URL is unset', async () => {
      env['NODE_ENV'] = 'development';
      env['NEXT_PUBLIC_APP_PLATFORM'] = 'tauri';
      delete env['NEXT_PUBLIC_API_BASE_URL'];
      const { getAPIBaseUrl } = await import('@/services/environment');
      expect(getAPIBaseUrl()).toBe('/api');
    });
  });

  // ── getNodeAPIBaseUrl ──────────────────────────────────────────
  describe('getNodeAPIBaseUrl', () => {
    test('returns /api in web development mode', async () => {
      env['NODE_ENV'] = 'development';
      env['NEXT_PUBLIC_APP_PLATFORM'] = 'web';
      const { getNodeAPIBaseUrl } = await import('@/services/environment');
      expect(getNodeAPIBaseUrl()).toBe('/api');
    });

    test('returns configured node URL in web development mode when set', async () => {
      env['NODE_ENV'] = 'development';
      env['NEXT_PUBLIC_APP_PLATFORM'] = 'web';
      env['NEXT_PUBLIC_NODE_BASE_URL'] = 'https://custom-node.example.com';
      const { getNodeAPIBaseUrl } = await import('@/services/environment');
      expect(getNodeAPIBaseUrl()).toBe('https://custom-node.example.com/api');
    });

    test('returns relative node path in production when base URL is unset', async () => {
      env['NODE_ENV'] = 'production';
      env['NEXT_PUBLIC_APP_PLATFORM'] = 'web';
      delete env['NEXT_PUBLIC_NODE_BASE_URL'];
      const { getNodeAPIBaseUrl } = await import('@/services/environment');
      expect(getNodeAPIBaseUrl()).toBe('/api');
    });

    test('returns relative node path for tauri platform even in development when base URL is unset', async () => {
      env['NODE_ENV'] = 'development';
      env['NEXT_PUBLIC_APP_PLATFORM'] = 'tauri';
      delete env['NEXT_PUBLIC_NODE_BASE_URL'];
      const { getNodeAPIBaseUrl } = await import('@/services/environment');
      expect(getNodeAPIBaseUrl()).toBe('/api');
    });
  });

  // ── environmentConfig default export ───────────────────────────
  describe('environmentConfig', () => {
    test('exports an object with getAppService function', async () => {
      const envConfig = await import('@/services/environment');
      expect(typeof envConfig.default.getAppService).toBe('function');
    });
  });
});
