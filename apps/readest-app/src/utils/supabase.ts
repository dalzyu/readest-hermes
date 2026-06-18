import { createClient } from '@supabase/supabase-js';
import { getRuntimeConfig } from '@/services/runtimeConfig';

const _fallbackUrl = 'https://offline.invalid';
const _fallbackKey = 'offline-placeholder-key';

function _safeAtob(envKey: string): string {
  const raw = process.env[envKey];
  if (!raw) return '';
  try {
    return atob(raw);
  } catch {
    return '';
  }
}

const supabaseUrl =
  getRuntimeConfig()?.supabaseUrl ||
  process.env['SUPABASE_URL'] ||
  process.env['NEXT_PUBLIC_SUPABASE_URL'] ||
  _safeAtob('NEXT_PUBLIC_DEFAULT_SUPABASE_URL_BASE64') ||
  _fallbackUrl;
const supabaseAnonKey =
  getRuntimeConfig()?.supabaseAnonKey ||
  process.env['SUPABASE_ANON_KEY'] ||
  process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ||
  _safeAtob('NEXT_PUBLIC_DEFAULT_SUPABASE_KEY_BASE64') ||
  _fallbackKey;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const createSupabaseClient = (accessToken?: string) => {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: accessToken
        ? {
            Authorization: `Bearer ${accessToken}`,
          }
        : {},
    },
  });
};

export const createSupabaseAdminClient = () => {
  const supabaseAdminKey = process.env['SUPABASE_ADMIN_KEY'] || '';
  return createClient(supabaseUrl, supabaseAdminKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
};
