import { createClient } from '@supabase/supabase-js';

function decodeOptionalBase64(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return atob(value);
  } catch {
    return undefined;
  }
}

function resolveSupabaseUrl(): string {
  return (
    process.env['SUPABASE_URL'] ||
    process.env['NEXT_PUBLIC_SUPABASE_URL'] ||
    decodeOptionalBase64(process.env['NEXT_PUBLIC_DEFAULT_SUPABASE_URL_BASE64']) ||
    // Offline-only Hermes builds intentionally ship without a real Supabase backend.
    // Use a harmless placeholder so importing this module never throws before cloud gating short-circuits.
    'https://offline.invalid'
  );
}

function resolveSupabaseAnonKey(): string {
  return (
    process.env['SUPABASE_ANON_KEY'] ||
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ||
    decodeOptionalBase64(process.env['NEXT_PUBLIC_DEFAULT_SUPABASE_KEY_BASE64']) ||
    'offline-placeholder-key'
  );
}

const supabaseUrl = resolveSupabaseUrl();
const supabaseAnonKey = resolveSupabaseAnonKey();

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
  const supabaseAdminKey = process.env['SUPABASE_ADMIN_KEY'] || 'offline-admin-key';
  return createClient(supabaseUrl, supabaseAdminKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
};
