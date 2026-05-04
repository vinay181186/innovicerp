// Idempotent bootstrap seed. Creates the first auth user (magic-link invite),
// the first company, and promotes the user to role=admin / is_active=true.
// Re-runnable: detects existing admin and existing company; only updates state.

import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const ADMIN_FULL_NAME = 'Innovic Admin';
const COMPANY_NAME = 'Innovic Technology';
const COMPANY_SLUG = 'innovic';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!SUPABASE_URL || !SERVICE_ROLE || !DATABASE_URL) {
  console.error('seed: missing env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL)');
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const sql = postgres(DATABASE_URL, { max: 1, prepare: false });

try {
  console.log('[1/3] looking up admin via supabase auth admin api...');
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listErr) throw listErr;

  const existing = list.users.find((u) => u.email === ADMIN_EMAIL);
  let adminUserId: string;
  let isFreshInvite = false;

  if (existing) {
    adminUserId = existing.id;
    console.log(`      found existing admin user id=${adminUserId}`);
  } else {
    console.log(`      inviting ${ADMIN_EMAIL} via magic link...`);
    const { data: invited, error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(
      ADMIN_EMAIL,
      { data: { full_name: ADMIN_FULL_NAME } },
    );
    if (inviteErr) throw inviteErr;
    if (!invited.user) throw new Error('invite returned no user');
    adminUserId = invited.user.id;
    isFreshInvite = true;
    console.log(`      invited; user id=${adminUserId}`);
  }

  console.log(
    '[2/3] ensuring public.users row exists (defensive insert; trigger should have run)...',
  );
  await sql`
    insert into public.users (id, email, full_name, role, is_active, created_by, updated_by)
    values (${adminUserId}, ${ADMIN_EMAIL}, ${ADMIN_FULL_NAME}, 'viewer', false, ${adminUserId}, ${adminUserId})
    on conflict (id) do nothing
  `;

  console.log(`[3/3] ensuring company "${COMPANY_NAME}" exists; promoting user to admin...`);
  await sql.begin(async (tx) => {
    const found = await tx<{ id: string }[]>`
      select id from companies where slug = ${COMPANY_SLUG} and deleted_at is null limit 1
    `;
    let companyId: string;
    if (found.length > 0) {
      companyId = found[0]!.id;
      console.log(`      company exists: ${companyId}`);
    } else {
      const inserted = await tx<{ id: string }[]>`
        insert into companies (name, slug, created_by, updated_by)
        values (${COMPANY_NAME}, ${COMPANY_SLUG}, ${adminUserId}, ${adminUserId})
        returning id
      `;
      companyId = inserted[0]!.id;
      console.log(`      created company: ${companyId}`);
    }

    await tx`
      update public.users
      set company_id = ${companyId}, role = 'admin', is_active = true
      where id = ${adminUserId}
    `;
    console.log(`      promoted user ${adminUserId} to admin of company ${companyId}`);
  });

  console.log('');
  console.log('--- final state ---');
  const cnt = await sql<{ companies: number; users: number; admins: number }[]>`
    select
      (select count(*)::int from companies where deleted_at is null) as companies,
      (select count(*)::int from users where deleted_at is null) as users,
      (select count(*)::int from users where role = 'admin' and is_active = true and deleted_at is null) as admins
  `;
  console.log(
    `      companies=${cnt[0]!.companies} users=${cnt[0]!.users} active_admins=${cnt[0]!.admins}`,
  );

  console.log('');
  console.log('=== seed complete ===');
  if (isFreshInvite) {
    console.log(`Magic-link invite sent to ${ADMIN_EMAIL}.`);
    console.log('Check that inbox and click the link to confirm + sign in.');
  } else {
    console.log('No fresh invite sent (auth user already existed).');
  }
} catch (err) {
  console.error('SEED FAILED:', err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
