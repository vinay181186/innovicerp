import type { UserRole } from '@innovic/shared';
import { and, eq, isNull } from 'drizzle-orm';
import fp from 'fastify-plugin';
import { db } from '../db/client';
import { users } from '../db/schema';
import { supabaseAdmin } from '../lib/supabase-admin';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      email: string;
      fullName?: string | null;
      companyId: string | null;
      role: UserRole;
      isActive: boolean;
    };
    /**
     * Why a syntactically valid bearer token did NOT produce a `user`.
     * Set by the auth hook; read by the error handler so the 401 tells the
     * person the real reason instead of a generic "Authentication required".
     * Undefined for anonymous callers — they are not "rejected", they simply
     * never presented a token.
     */
    authRejectedReason?: 'inactive';
  }
}

export const authPlugin = fp(async (app) => {
  // Global onRequest hook: it runs for EVERY route, including the public
  // /health and /readyz probes. It therefore never throws — it only decides
  // whether to attach `req.user`. Routes that need a user throw
  // AuthenticationError themselves when it is missing.
  app.addHook('onRequest', async (req) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return;
    const token = header.slice('Bearer '.length).trim();
    if (!token) return;

    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) return;

    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        companyId: users.companyId,
        role: users.role,
        isActive: users.isActive,
      })
      .from(users)
      .where(and(eq(users.id, data.user.id), isNull(users.deletedAt)))
      .limit(1);

    const row = rows[0];
    // Soft-deleted or no profile at all: stay silent, exactly as before.
    if (!row) return;
    // Deactivated in the Users screen (is_active = false). Previously this
    // column was selected and then ignored, so switching a user off did not
    // stop them — they kept full access. Refuse them here, and record the
    // reason so the 401 can say "deactivated" rather than "not logged in".
    if (!row.isActive) {
      req.authRejectedReason = 'inactive';
      return;
    }
    req.user = row;
  });
});
