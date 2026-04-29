import type { UserRole } from '@innovic/shared';
import { createClient } from '@supabase/supabase-js';
import { and, eq, isNull } from 'drizzle-orm';
import fp from 'fastify-plugin';
import { db } from '../db/client';
import { users } from '../db/schema';
import { env } from '../lib/env';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      email: string;
      companyId: string | null;
      role: UserRole;
      isActive: boolean;
    };
  }
}

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export const authPlugin = fp(async (app) => {
  app.addHook('onRequest', async (req) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return;
    const token = header.slice('Bearer '.length).trim();
    if (!token) return;

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return;

    const rows = await db
      .select({
        id: users.id,
        email: users.email,
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
