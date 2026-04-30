// Phase A: users loader.
//
// Two-phase per legacy user record:
//   1. Resolve (or create) the auth.users row.
//      - If a public.users row already exists with the same email, we reuse
//        its id (the seed admin path).
//      - Otherwise, call supabase.auth.admin.inviteUserByEmail(email) which
//        creates an auth.users row AND triggers our handle_new_auth_user()
//        trigger to insert the matching public.users row (role=viewer,
//        is_active=false), AND sends an invitation email so the new user can
//        set their password. (Per user choice 2026-04-30 — option B.)
//   2. Update public.users — set company_id, role, full_name, is_active=true,
//      updated_by=adminId. Idempotent.
//
// Writes results to migration/load/users-loaded.json AND mutates the in-memory
// id_map (caller persists). Adds the resolved UUID under idMap.users[legacyId].

import { createClient } from '@supabase/supabase-js';
import { rawSql } from './db';
import type { IdMapPersisted, UserLoadOutcome } from './types';

interface TransformedUser {
  _legacyId: string;
  email: string;
  fullName: string | null;
  role: string;
  isActive: boolean;
  _legacyPin: string | null;
  _legacyExtras: Record<string, unknown>;
}

interface UsersLoaderInput {
  rows: TransformedUser[];
  companyId: string;
  adminUserId: string; // for created_by/updated_by audit columns
  dryRun: boolean;
}

function getSupabaseAdmin() {
  const url = process.env['SUPABASE_URL'];
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required for users loader');
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function findExistingPublicUser(email: string): Promise<string | null> {
  const rows = await rawSql<Array<{ id: string }>>`
    SELECT id FROM public.users WHERE lower(email) = lower(${email}) LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

export async function loadUsers(
  input: UsersLoaderInput,
  idMap: IdMapPersisted,
): Promise<UserLoadOutcome[]> {
  const outcomes: UserLoadOutcome[] = [];
  const supabase = getSupabaseAdmin();

  if (!idMap['users']) idMap['users'] = {};

  for (const row of input.rows) {
    const notes: string[] = [];

    if (input.dryRun) {
      const existing = await findExistingPublicUser(row.email);
      outcomes.push({
        legacyId: row._legacyId,
        email: row.email,
        newUserId: existing ?? '<would-be-invited>',
        action: existing ? 'reused_existing' : 'skipped',
        inviteEmailSent: false,
        notes: ['dry_run'],
      });
      if (existing) idMap['users']![row._legacyId] = existing;
      continue;
    }

    let userId: string | null = await findExistingPublicUser(row.email);
    let inviteEmailSent = false;
    let action: UserLoadOutcome['action'] = userId ? 'reused_existing' : 'invited_new';

    if (!userId) {
      const { data, error } = await supabase.auth.admin.inviteUserByEmail(row.email, {
        data: { full_name: row.fullName ?? row.email.split('@')[0] },
      });
      if (error) {
        notes.push(`invite_failed: ${error.message}`);
        outcomes.push({
          legacyId: row._legacyId,
          email: row.email,
          newUserId: '<error>',
          action: 'skipped',
          inviteEmailSent: false,
          notes,
        });
        continue;
      }
      userId = data.user?.id ?? null;
      inviteEmailSent = true;
      if (!userId) {
        notes.push('invite_returned_no_user');
        outcomes.push({
          legacyId: row._legacyId,
          email: row.email,
          newUserId: '<error>',
          action: 'skipped',
          inviteEmailSent,
          notes,
        });
        continue;
      }
      notes.push('invite_email_sent');
    }

    // The handle_new_auth_user() trigger may have created the row already.
    // UPSERT to be safe — and to update audit columns + activate.
    await rawSql`
      INSERT INTO public.users (
        id, email, full_name, role, company_id, is_active,
        created_by, updated_by
      )
      VALUES (
        ${userId}::uuid, ${row.email}, ${row.fullName}, ${row.role}::user_role,
        ${input.companyId}::uuid, ${row.isActive},
        ${input.adminUserId}::uuid, ${input.adminUserId}::uuid
      )
      ON CONFLICT (id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        role = EXCLUDED.role,
        company_id = EXCLUDED.company_id,
        is_active = EXCLUDED.is_active,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
    `;

    if (action === 'reused_existing') {
      action = 'updated_public_users';
    }

    idMap['users']![row._legacyId] = userId;

    outcomes.push({
      legacyId: row._legacyId,
      email: row.email,
      newUserId: userId,
      action,
      inviteEmailSent,
      notes,
    });
  }

  return outcomes;
}
