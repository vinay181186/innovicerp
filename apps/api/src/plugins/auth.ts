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
  }
}

export const authPlugin = fp(async (app) => {
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
    if (!row) return;
    req.user = row;
  });
});
