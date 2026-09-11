import { drawingUrlQuerySchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function drawingFilesRoutes(app: FastifyInstance): Promise<void> {
  // The ONE route that hands out a link to a drawing. GET, because it returns a
  // link rather than changing anything — the activity_log row it writes is the
  // record of a read, not a mutation.
  app.get('/drawing-files/url', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = drawingUrlQuerySchema.parse(req.query);
    return service.getDrawingUrl(query, req.user);
  });
}
