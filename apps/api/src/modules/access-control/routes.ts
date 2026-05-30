import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import { saveUserAccessInputSchema } from './schema';
import * as service from './service';

const userIdParamSchema = z.object({ userId: z.string().uuid() });

export async function accessControlRoutes(app: FastifyInstance): Promise<void> {
  // Caller's own effective access — any role. Used by the web shell to
  // gate buttons/sidebar without a separate /me payload bloat.
  app.get('/access-control/me', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getMyAccess(req.user);
  });

  // Admin matrix list — one row per user with counts.
  app.get('/access-control/users', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listUserAccess(req.user);
  });

  // Admin: one user's full matrix (for Configure modal).
  app.get('/access-control/users/:userId', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { userId } = userIdParamSchema.parse(req.params);
    return service.getUserAccess(userId, req.user);
  });

  // Admin: save one user's matrix.
  app.put('/access-control/users/:userId', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { userId } = userIdParamSchema.parse(req.params);
    const body = saveUserAccessInputSchema.parse(req.body);
    return service.saveUserAccess(userId, body, req.user);
  });
}
