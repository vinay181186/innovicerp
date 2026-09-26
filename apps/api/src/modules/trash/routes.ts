import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import { listTrashQuerySchema, restoreTrashInputSchema } from './schema';
import * as service from './service';

export async function trashRoutes(app: FastifyInstance): Promise<void> {
  app.get('/trash', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listTrashQuerySchema.parse(req.query);
    return service.listTrash(query, req.user);
  });

  app.post('/trash/restore', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const body = restoreTrashInputSchema.parse(req.body);
    return service.restoreFromTrash(body, req.user);
  });

  // ADR-188: no permanent delete inside the app. POST /trash/perm-delete and
  // POST /trash/empty were removed; hard deletes run only through documented
  // admin scripts after a backup (CLAUDE.md §6 rule 8).
}
