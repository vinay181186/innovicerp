// Service-role Supabase client. Bypasses RLS and can call the Auth Admin API
// (createUser, deleteUser, getUser by token). NEVER expose the service-role key
// to the browser — this lives on the API only.

import { createClient } from '@supabase/supabase-js';
import { env } from './env';

export const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
