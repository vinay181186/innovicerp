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

  app.post('/trash/perm-delete', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const body = restoreTrashInputSchema.parse(req.body);
    return service.permDeleteTrash(body, req.user);
  });

  app.post('/trash/empty', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.emptyTrash(req.user);
  });
}
