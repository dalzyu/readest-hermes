import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createClient = vi.fn(() => ({ auth: {}, from: vi.fn(), rpc: vi.fn() }));

vi.mock('@supabase/supabase-js', () => ({
  createClient,
}));

describe('utils/supabase', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    createClient.mockClear();
    process.env = { ...originalEnv };
    delete process.env['SUPABASE_URL'];
    delete process.env['NEXT_PUBLIC_SUPABASE_URL'];
    delete process.env['SUPABASE_ANON_KEY'];
    delete process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
    delete process.env['SUPABASE_ADMIN_KEY'];
    delete process.env['NEXT_PUBLIC_DEFAULT_SUPABASE_URL_BASE64'];
    delete process.env['NEXT_PUBLIC_DEFAULT_SUPABASE_KEY_BASE64'];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('falls back to offline placeholders when no Supabase env is configured', async () => {
    await import('@/utils/supabase');

    expect(createClient).toHaveBeenCalledWith('https://offline.invalid', 'offline-placeholder-key');
  });

  it('ignores invalid default base64 env values instead of throwing on import', async () => {
    process.env['NEXT_PUBLIC_DEFAULT_SUPABASE_URL_BASE64'] = '!not-base64!';
    process.env['NEXT_PUBLIC_DEFAULT_SUPABASE_KEY_BASE64'] = '!not-base64!';

    await expect(import('@/utils/supabase')).resolves.toBeTruthy();
    expect(createClient).toHaveBeenCalledWith('https://offline.invalid', 'offline-placeholder-key');
  });
});
