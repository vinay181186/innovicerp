import { and, asc, count, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireAdminRole } from '../../lib/auth';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { supabaseAdmin } from '../../lib/supabase-admin';
import type {
  CreateUserInput,
  ListUsersQuery,
  ListUsersResponse,
  SetUserPasswordInput,
  UpdateUserInput,
  User,
} from './schema';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

function emptyToNull(s: string | undefined): string | null {
  if (s === undefined) return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Escape the ILIKE metacharacters in a user's search term. Without this a user
 *  typing "%" in the Users search box gets a wildcard pattern instead of a
 *  literal search — i.e. the search box becomes a "show everything" button.
 *  Postgres's DEFAULT LIKE/ILIKE escape character is backslash, so no explicit
 *  ESCAPE clause is needed here (and drizzle's `ilike()` builder, which this
 *  list is written with, cannot emit one) — verified against the live database.
 *  Deliberately a local copy of the sales-orders / purchase-orders helper
 *  rather than an export across modules: it is three lines, and each list must
 *  be free to change its own search behaviour without dragging the others. */
function escapeLikeTerm(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export async function listUsers(
  input: ListUsersQuery,
  user: AuthContext,
): Promise<ListUsersResponse> {
  requireAdminRole(user);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const conditions: SQL[] = [eq(users.companyId, companyId), isNull(users.deletedAt)];
    if (input.search) {
      // Search covers the columns of THIS table that the user list (users/
      // routes/list.tsx) prints: Name, Email, Phone and the Active/Inactive
      // Status badge. Nothing else on `users` is searchable.
      //
      // This is a sensitive table, so the exclusions are deliberate:
      //  - No credential can be reached from here. public.users holds no
      //    password hash, no token and no reset secret — logins live in
      //    Supabase Auth — and nothing here is to go looking for them.
      //  - `role` is NOT searched: the list has no Role column (it drives the
      //    Approver tick and the role dropdown filter, neither of which prints
      //    the value), and there is already a dedicated All-roles filter.
      //  - `approval_limit` is money and is not on this screen.
      //  - Department / Access are on screen but are NOT columns of this
      //    table: they come from the separate admin access endpoint and are
      //    rendered as client-side labels, so there is no column here to match.
      const pattern = `%${escapeLikeTerm(input.search)}%`;
      const s = or(
        ilike(users.fullName, pattern),
        ilike(users.email, pattern),
        ilike(users.phone, pattern),
        // Status badge — is_active is a boolean, and 'true'/'false' is not what
        // the screen prints, so match the rendered word instead. Note "active"
        // is a substring of "Inactive", so that term matches both; "inactive"
        // narrows to the disabled logins, which is the useful direction.
        sql`(CASE WHEN ${users.isActive} THEN 'Active' ELSE 'Inactive' END) ILIKE ${pattern}`,
      );
      if (s) conditions.push(s);
    }
    if (input.role) conditions.push(eq(users.role, input.role));
    if (input.isActive !== undefined) conditions.push(eq(users.isActive, input.isActive));

    const where = and(...conditions);

    const [rows, totals] = await Promise.all([
      tx
        .select()
        .from(users)
        .where(where)
        .orderBy(asc(users.email))
        .limit(input.limit)
        .offset(input.offset),
      tx.select({ value: count() }).from(users).where(where),
    ]);

    return {
      items: rows as unknown as User[],
      total: totals[0]?.value ?? 0,
      limit: input.limit,
      offset: input.offset,
    };
  });
}

// Find an existing Supabase Auth user by email (paginate the admin list).
// `lastSignInAt` rides along because the revive decision below needs to know
// whether the login has ever actually been used.
async function findAuthUserByEmail(
  email: string,
): Promise<{ id: string; lastSignInAt: string | null } | undefined> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new ValidationError(error.message);
    const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === target);
    if (hit) return { id: hit.id, lastSignInAt: hit.last_sign_in_at ?? null };
    if (data.users.length < 200) break; // last page
  }
  return undefined;
}

export async function createUser(input: CreateUserInput, user: AuthContext): Promise<User> {
  requireAdminRole(user);
  const companyId = requireCompany(user);

  const email = input.email.toLowerCase().trim();

  // 1. Create the Supabase Auth account. `email_confirm: true` skips the
  //    verification email — the admin sets the initial password and hands it
  //    over directly. This INSERT into auth.users fires the
  //    `on_auth_user_created` trigger (0001_post_init.sql), which seeds a
  //    public.users row (role=viewer, is_active=false, company_id=NULL).
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.fullName },
  });

  let userId: string;
  if (error || !data.user) {
    const msg = error?.message ?? 'Failed to create the auth account';
    // Supabase returns 422 with this wording when the email already has a login.
    if (!/already.*regist|already.*been.*regist|already.*exist/i.test(msg)) {
      throw new ValidationError(msg);
    }
    // The Auth identity already exists. Our "delete user" is a SOFT delete of
    // public.users — the auth account is never removed (and Trash doesn't cover
    // users), so re-adding a previously-deleted email lands here. REVIVE it
    // rather than dead-ending. See ADR-050 for the guard: we must never
    // silently reset a colleague's password or absorb another company's user.
    //
    // Revive is allowed when the account cannot belong to a working colleague
    // elsewhere:
    //   a) no profile row at all, or
    //   b) the profile is soft-deleted, or
    //   c) the profile is orphaned (company_id NULL), or
    //   d) the login has NEVER been signed into AND the profile is already in
    //      THIS admin's own company.
    // (d) is the "+ Add User can't repair an unused account" case: the person
    // was added, the password never reached them, and they have never got in.
    // Nobody is using that login, so no working access is taken away — and the
    // `companyId` match keeps ADR-050's cross-company rule intact: a
    // never-signed-in user belonging to a DIFFERENT company still refuses.
    const existingAuth = await findAuthUserByEmail(email);
    if (!existingAuth) throw new ConflictError('A user with this email already exists');
    const profile = (await db.select().from(users).where(eq(users.id, existingAuth.id)).limit(1))[0];
    const neverSignedIn = existingAuth.lastSignInAt === null;
    const canRevive =
      !profile ||
      profile.deletedAt !== null ||
      profile.companyId === null ||
      (neverSignedIn && profile.companyId === companyId);
    if (!canRevive) {
      throw new ConflictError(
        'A user with this email already exists and has signed in before — open that user and use the "Set / reset password" panel on their edit screen instead.',
      );
    }
    // Reset the password to the new one the admin just entered, and confirm the
    // email — admin-provisioned accounts have no verification flow, so an
    // unconfirmed revived account would hit "email not confirmed" at login.
    const { error: pwErr } = await supabaseAdmin.auth.admin.updateUserById(existingAuth.id, {
      password: input.password,
      email_confirm: true,
    });
    if (pwErr) throw new ValidationError(pwErr.message);
    userId = existingAuth.id;
  } else {
    userId = data.user.id;
  }

  // 2. Promote/revive the row into this company with the chosen role. Touch it
  //    via the plain (RLS-bypassing) `db` client: a fresh trigger row has
  //    company_id NULL (and a revived row may be soft-deleted), so a
  //    company-scoped context can't see it yet. Authorization was already
  //    enforced above (requireAdminRole/Company). deletedAt:null un-deletes.
  const updates = {
    companyId,
    email,
    fullName: input.fullName.trim(),
    role: input.role,
    phone: emptyToNull(input.phone),
    isActive: input.isActive,
    approvalLimit:
      input.approvalLimit === undefined || input.approvalLimit === null
        ? null
        : String(input.approvalLimit),
    deletedAt: null,
    updatedBy: user.id,
    updatedAt: new Date(),
  };

  const updated = await db.update(users).set(updates).where(eq(users.id, userId)).returning();
  let row = updated[0];
  if (!row) {
    // Defensive: trigger somehow didn't seed the row — insert it ourselves.
    const inserted = await db
      .insert(users)
      .values({ id: userId, createdBy: user.id, ...updates })
      .returning();
    row = inserted[0];
  }
  return row as unknown as User;
}

export async function getUser(id: string, user: AuthContext): Promise<User> {
  requireAdminRole(user);
  requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError(`User ${id} not found`);
    return row as unknown as User;
  });
}

export async function updateUser(
  id: string,
  input: UpdateUserInput,
  user: AuthContext,
): Promise<User> {
  requireAdminRole(user);
  requireCompany(user);

  // Guard self-demotion + self-deactivation so an admin can't lock themselves
  // out of their own account in one click. They can still hand admin to
  // someone else first then have *that* admin demote them.
  if (id === user.id) {
    if (input.role !== undefined && input.role !== 'admin') {
      throw new ValidationError('Cannot demote yourself — ask another admin to do it');
    }
    if (input.isActive === false) {
      throw new ValidationError('Cannot deactivate yourself');
    }
  }

  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select()
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);
    if (existing.length === 0) throw new NotFoundError(`User ${id} not found`);
    if (existing[0]!.companyId !== user.companyId) {
      throw new NotFoundError(`User ${id} not found`);
    }

    const updates: Record<string, unknown> = { updatedBy: user.id, updatedAt: new Date() };
    if (input.fullName !== undefined) updates.fullName = emptyToNull(input.fullName);
    if (input.role !== undefined) updates.role = input.role;
    if (input.phone !== undefined) updates.phone = emptyToNull(input.phone);
    if (input.isActive !== undefined) updates.isActive = input.isActive;
    // approval_limit is a numeric column → store as string; null clears it.
    if (input.approvalLimit !== undefined) {
      updates.approvalLimit = input.approvalLimit === null ? null : String(input.approvalLimit);
    }

    const updated = await tx.update(users).set(updates).where(eq(users.id, id)).returning();
    return updated[0] as unknown as User;
  });
}

// Admin sets/resets another user's Supabase Auth password directly. No email is
// sent, so this is immune to Supabase's email rate limit (the reason this exists
// — see ADR-049). public.users.id == auth.users.id (the on_auth_user_created
// trigger seeds the row with the auth uid), so the same id addresses both.
export async function setUserPassword(
  id: string,
  input: SetUserPasswordInput,
  user: AuthContext,
): Promise<{ ok: true }> {
  requireAdminRole(user);
  requireCompany(user);

  // Confirm the target is a live user in the admin's company BEFORE touching
  // Auth — prevents an admin in company A from resetting a user in company B.
  await withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row || row.companyId !== user.companyId) throw new NotFoundError(`User ${id} not found`);
  });

  // email_confirm: true so a never-confirmed account becomes login-ready too —
  // admin-set passwords have no separate email-verification step.
  const { error } = await supabaseAdmin.auth.admin.updateUserById(id, {
    password: input.password,
    email_confirm: true,
  });
  if (error) throw new ValidationError(error.message);
  return { ok: true };
}

export async function softDeleteUser(id: string, user: AuthContext): Promise<{ ok: true }> {
  requireAdminRole(user);
  requireCompany(user);

  if (id === user.id) {
    throw new ValidationError('Cannot delete yourself');
  }

  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select()
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);
    if (existing.length === 0) throw new NotFoundError(`User ${id} not found`);
    if (existing[0]!.companyId !== user.companyId) {
      throw new NotFoundError(`User ${id} not found`);
    }

    await tx
      .update(users)
      .set({ deletedAt: new Date(), isActive: false, updatedBy: user.id })
      .where(eq(users.id, id));
    return { ok: true };
  });
}
