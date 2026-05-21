import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import { soOverviewRoutes } from './routes';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
let admin: AuthContext;

async function buildApp(user: AuthContext | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (user) req.user = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(soOverviewRoutes);
  return app;
}

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
});

describe('so-overview routes', () => {
  let app: FastifyInstance;

  it('GET /so-overview returns 401 without auth', async () => {
    app = await buildApp(null);
    try {
      const res = await app.inject({ method: 'GET', url: '/so-overview' });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('GET /so-overview returns 400 on invalid status filter', async () => {
    app = await buildApp(admin);
    try {
      const res = await app.inject({ method: 'GET', url: '/so-overview?status=banana' });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('GET /so-overview returns 200 with envelope for authed admin', async () => {
    app = await buildApp(admin);
    try {
      const res = await app.inject({ method: 'GET', url: '/so-overview' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('generatedAt');
      expect(body).toHaveProperty('filter');
      expect(body).toHaveProperty('summary');
      expect(body).toHaveProperty('rows');
      expect(Array.isArray(body.rows)).toBe(true);
      expect(body.filter.status).toBe('open'); // default
    } finally {
      await app.close();
    }
  });

  it('GET /so-overview?status=all echoes status=all back', async () => {
    app = await buildApp(admin);
    try {
      const res = await app.inject({ method: 'GET', url: '/so-overview?status=all' });
      expect(res.statusCode).toBe(200);
      expect(res.json().filter.status).toBe('all');
    } finally {
      await app.close();
    }
  });
});
