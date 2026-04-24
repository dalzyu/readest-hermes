import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { User } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => {
  const authProvider = vi.fn(({ children }: { children: unknown }) => children);
  const syncProvider = vi.fn(({ children }: { children: unknown }) => children);
  const syncBooks = vi.fn();
  const loadSettings = vi.fn().mockResolvedValue({
    globalViewSettings: {
      uiLanguage: 'en',
      backgroundTextureId: 'none',
      backgroundOpacity: 0,
      backgroundSize: 'auto',
      isEink: false,
    },
  });
  const applyUILanguage = vi.fn();
  const applyBackgroundTexture = vi.fn();
  const applyEinkMode = vi.fn();
  const useEnv = vi.fn(() => ({
    envConfig: {},
    appService: {
      loadSettings,
      generateCoverImageUrl: vi.fn(),
      downloadBookCovers: vi.fn(),
      saveLibraryBooks: vi.fn(),
    },
  }));
  const useSettingsStore = vi.fn(() => ({ applyUILanguage }));
  const useDefaultIconSize = vi.fn(() => 20);
  const useSafeAreaInsets = vi.fn();
  const loadDataTheme = vi.fn();
  const initSystemThemeListener = vi.fn();
  const useTranslation = vi.fn(() => (key: string) => key);

  return {
    authProvider,
    syncProvider,
    syncBooks,
    loadSettings,
    applyUILanguage,
    applyBackgroundTexture,
    applyEinkMode,
    useEnv,
    useSettingsStore,
    useDefaultIconSize,
    useSafeAreaInsets,
    loadDataTheme,
    initSystemThemeListener,
    useTranslation,
  };
});

vi.mock('@/utils/supabase', () => ({
  supabase: {
    auth: {
      refreshSession: vi.fn(),
      onAuthStateChange: vi.fn(() => ({
        data: {
          subscription: {
            unsubscribe: vi.fn(),
          },
        },
      })),
      signOut: vi.fn(),
    },
  },
}));

vi.mock('@/context/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/AuthContext')>();
  return {
    ...actual,
    AuthProvider: mocks.authProvider,
  };
});

vi.mock('@/context/SyncContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/SyncContext')>();
  return {
    ...actual,
    SyncProvider: mocks.syncProvider,
  };
});

vi.mock('@/context/EnvContext', () => ({
  useEnv: mocks.useEnv,
}));

vi.mock('@/context/PHContext', () => ({
  CSPostHogProvider: ({ children }: { children: unknown }) => children,
}));

vi.mock('@/context/DropdownContext', () => ({
  DropdownProvider: ({ children }: { children: unknown }) => children,
}));

vi.mock('@/components/command-palette', () => ({
  CommandPaletteProvider: ({ children }: { children: unknown }) => children,
  CommandPalette: () => null,
}));

vi.mock('@/components/AtmosphereOverlay', () => ({
  default: () => null,
}));

vi.mock('@/hooks/useSafeAreaInsets', () => ({
  useSafeAreaInsets: mocks.useSafeAreaInsets,
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useDefaultIconSize: mocks.useDefaultIconSize,
}));

vi.mock('@/hooks/useBackgroundTexture', () => ({
  useBackgroundTexture: () => ({ applyBackgroundTexture: mocks.applyBackgroundTexture }),
}));

vi.mock('@/hooks/useEinkMode', () => ({
  useEinkMode: () => ({ applyEinkMode: mocks.applyEinkMode }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: mocks.useSettingsStore,
}));

vi.mock('@/store/themeStore', () => ({
  initSystemThemeListener: mocks.initSystemThemeListener,
  loadDataTheme: mocks.loadDataTheme,
}));

vi.mock('@/hooks/useSync', () => ({
  useSync: () => ({
    useSyncInited: true,
    syncedBooks: null,
    syncBooks: mocks.syncBooks,
    lastSyncedAtBooks: 0,
  }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: mocks.useTranslation,
}));

vi.mock('@/i18n/i18n', () => ({
  default: {
    on: vi.fn(),
    off: vi.fn(),
    changeLanguage: vi.fn(),
  },
}));

import Providers from '@/components/Providers';
import { useAuth } from '@/context/AuthContext';
import { useBooksSync } from '@/app/library/hooks/useBooksSync';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const OfflineProbe = () => {
  const { token, user, login, logout, refresh } = useAuth();
  const { pullLibrary, pushLibrary } = useBooksSync();
  const offlineUser = { id: 'offline-user' } as User;

  return (
    <div>
      <span data-testid='token'>{token ?? 'null'}</span>
      <span data-testid='user'>{user ? user.id : 'null'}</span>
      <button
        type='button'
        onClick={() => {
          login('offline-token', offlineUser);
          logout();
          refresh();
        }}
      >
        trigger-auth
      </button>
      <button
        type='button'
        onClick={() => {
          void pullLibrary();
          void pushLibrary();
        }}
      >
        trigger-sync
      </button>
    </div>
  );
};

describe('Providers offline contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips auth and sync provider mounts when cloud is disabled', () => {
    render(
      <Providers>
        <div data-testid='child'>child</div>
      </Providers>,
    );

    expect(screen.getByTestId('child').textContent).toBe('child');
    expect(mocks.authProvider).not.toHaveBeenCalled();
    expect(mocks.syncProvider).not.toHaveBeenCalled();
  });

  it('returns no-op auth state and does not sync when the offline probe invokes the hook', async () => {
    render(
      <Providers>
        <OfflineProbe />
      </Providers>,
    );

    expect(screen.getByTestId('token').textContent).toBe('null');
    expect(screen.getByTestId('user').textContent).toBe('null');

    fireEvent.click(screen.getByRole('button', { name: 'trigger-auth' }));
    fireEvent.click(screen.getByRole('button', { name: 'trigger-sync' }));

    await waitFor(() => {
      expect(mocks.syncBooks).not.toHaveBeenCalled();
    });
  });
});
