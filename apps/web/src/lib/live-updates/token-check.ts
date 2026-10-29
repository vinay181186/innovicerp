// ADR-230 — can this login's token actually hear its company?
//
// Realtime checks each change against the table's RLS policy using the
// browser's token, and the policies read `company_id` from that token
// (`current_company_id()`, 0207). A token without it — or with another
// company's — still subscribes fine ("SUBSCRIBED") and then receives NOTHING,
// so the screen would look live while no change ever arrives. This check
// turns that silent case into the "Live updates paused" marker.

import { supabase } from '@/lib/supabase';

/** `company_id` from the token's claims (top level or app_metadata), or null. */
export function tokenCompanyId(accessToken: string | undefined): string | null {
  const part = accessToken?.split('.')[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const claims = JSON.parse(json) as {
      company_id?: unknown;
      app_metadata?: { company_id?: unknown };
    };
    const id = claims.company_id ?? claims.app_metadata?.company_id;
    return typeof id === 'string' && id !== '' ? id : null;
  } catch {
    return null;
  }
}

/**
 * Null when the session token names `companyId`; otherwise the problem as a
 * short log word. Never refreshes the token itself — a forced refresh racing
 * supabase-js's own can end the session. The provider re-checks on every
 * TOKEN_REFRESHED, so a token that gains company_id clears the marker.
 */
export async function tokenCompanyProblem(companyId: string): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    const company = tokenCompanyId(data.session?.access_token);
    if (company === companyId) return null;
    return company === null ? 'token_no_company' : 'token_other_company';
  } catch {
    // Cannot read the session at all — the transport's own status says the rest.
    return null;
  }
}
