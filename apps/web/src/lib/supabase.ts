import { createClient } from '@supabase/supabase-js';
import { createBrowserSessionStorage } from './browser-session';
import { env } from './env';

// The session is kept in a session cookie (user decision 2026-09-19): shared by all tabs of the
// browser, gone when the browser closes, no idle timeout. See lib/browser-session.ts.
export const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    ...(typeof window !== 'undefined' ? { storage: createBrowserSessionStorage() } : {}),
  },
});
